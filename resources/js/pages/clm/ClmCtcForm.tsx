import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorkerUrl as unknown as string;
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import ClmInsertPlaceholderModal from './ClmInsertPlaceholderModal';
import ClmClauseInsertPanel from './ClmClauseInsertPanel';
import HeaderFooterPanel, { DEFAULT_HEADER, DEFAULT_FOOTER, type HeaderConfig, type FooterConfig } from '../hrms/doc-templates/HeaderFooterPanel';
import { pad2, type CtcContract } from './clmOpsData';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import { VersionHistoryModal, type CtcVersion } from './clmCtcModals';
import ClmCtcSignPositionModal from './ClmCtcSignPositionModal';
import { Shimmer } from '../../components/ui/Shimmer';
import { checkSpelling } from '../../utils/spellCheck';

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

type CP = { name: string; initials: string; country: string; phone: string; email: string; grad: string; badge: string; referred: string; sourceType?: string; sourceId?: string | number };

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
  const [signPos, setSignPos] = useState<{ name: string; email: string }[] | null>(null);  // open → signature positioning step
  const [hydrating, setHydrating] = useState(!!editing?.dbId);  // edit-mode initial fetch in progress
  // Page-shell header/footer config — lifted to the parent so it survives the
  // stage change and the Stage-2 preview can render the same logo/header/footer.
  const [header, setHeader] = useState<HeaderConfig>(DEFAULT_HEADER);
  const [footer, setFooter] = useState<FooterConfig>(DEFAULT_FOOTER);
  // Note: the selected organization is intentionally NOT injected into the
  // document header title — the org name should not appear in the draft's
  // top-right corner. The header title stays user-configurable (Stage 1).

  const errMsg = (e: unknown) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  const refreshRecord = async (id?: number | null) => {
    const rid = id ?? workingId;
    if (!rid) return;
    // When a Zoho signature request is live, hit the sync endpoint so the
    // Stage-3 tracker reflects each signer's status; it's a superset of show
    // (returns the contract + org_signature_url, syncing Zoho only if linked).
    const url = record?.zoho_request_id ? `/clm/ctc-contracts/${rid}/sync-signature` : `/clm/ctc-contracts/${rid}`;
    try { const res = await api.get(url); setRecord((res.data?.data ?? res.data ?? null) as Record<string, unknown>); }
    catch { /* keep last snapshot */ }
  };
  // Poll for approver / signer activity while we sit on a review/signing stage.
  useEffect(() => {
    if (!workingId || stage < 2) return;
    const iv = window.setInterval(() => { refreshRecord(); }, 10000);
    return () => window.clearInterval(iv);
  }, [workingId, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const approval = String((record?.approval_status as string) ?? (sentForApproval ? 'pending' : ''));
  // Counterparty e-sign decline (if any) — surfaced on the editor while the
  // user revises the draft to address the signer's remark.
  const signDecline = (() => {
    const recs = (Array.isArray(record?.signing_recipients) ? record!.signing_recipients : []) as { name?: string; declined?: boolean; decline_reason?: string }[];
    const d = recs.find(r => r.declined);
    return d ? { by: d.name || 'a signer', reason: d.decline_reason || '' } : null;
  })();
  // Once every counterparty has signed (or the contract is signed/stored) the
  // agreement is locked: it can be viewed (form + signed document) but never
  // re-submitted for approval or re-sent for signing.
  const signedLock = (() => {
    const recs = (Array.isArray(record?.signing_recipients) ? record!.signing_recipients : []) as { signed?: boolean }[];
    const allSigned = recs.length > 0 && recs.every(r => r.signed);
    return allSigned || String(record?.status ?? '') === 'signed' || (Number(record?.stage) || 0) >= 4;
  })();
  const signedDocUrl = String((record?.signed_document_url as string) ?? '');
  // The DRAFT itself is editable only in three states: a fresh draft never sent
  // for approval, an internally-rejected draft, or one the counterparty declined.
  // While it's awaiting internal approval, approved/out-for-signature, or signed,
  // it is view-only — see the user's lifecycle rules.
  const editLock = !( !approval || approval === 'rejected' || !!signDecline );
  // Why it's locked — drives the Stage-1 banner copy.
  const lockReason: 'approval' | 'signing' | 'signed' | null =
    !editLock ? null : signedLock ? 'signed' : (approval === 'approved' || stage >= 3) ? 'signing' : 'approval';

  useEffect(() => { document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }; }, []);

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
  // Furthest stage the contract has actually reached (its persisted stage, or
  // the stage currently being viewed). Mirrors My Workplace: every reached
  // stage stays marked "done" and freely navigable from the stepper — so when
  // you edit a contract that's progressed and step back to an earlier stage,
  // stages 2-4 keep their completed styling instead of reverting to a greyed
  // "not started" look that hides that you can still click into them.
  const furthestStage = Math.max(stage, Number(record?.stage) || 1);
  // Stepper click is gated: you can revisit any stage the contract has reached,
  // but can't skip ahead to a stage it hasn't reached yet (parity with My
  // Workplace). Internal lifecycle transitions call goStage() directly and so
  // bypass this lock.
  const goStageFromStepper = (n: number) => { if (n > furthestStage) return; goStage(n); };

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
      setCps(cpArr.map((c, i) => ({ name: String(c.name ?? ''), initials: orgInitials(String(c.name ?? '')), country: String(c.country ?? ''), phone: String(c.phone ?? ''), email: String(c.email ?? ''), grad: ORG_GRADS[i % ORG_GRADS.length], badge: String(c.badge ?? ''), referred: String(c.referred ?? c.name ?? ''), sourceType: c.source_type ? String(c.source_type) : undefined, sourceId: (c.source_id as string | number | undefined) ?? undefined })));
      if (r.header_config) setHeader({ ...DEFAULT_HEADER, ...(r.header_config as object) } as HeaderConfig);
      if (r.footer_config) setFooter({ ...DEFAULT_FOOTER, ...(r.footer_config as object) } as FooterConfig);
    }).catch(() => { if (alive) toast.error('Could not load', 'Failed to open this agreement for editing.'); })
      .finally(() => { if (alive) setHydrating(false); });
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
        counterparties: cps.map(c => ({ name: c.name, country: c.country, phone: c.phone, email: c.email, badge: c.badge, referred: c.referred, source_type: c.sourceType ?? null, source_id: c.sourceId ?? null })),
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
  const submitForApproval = async (approval: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }): Promise<boolean> => {
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title in Step 2.'); return false; }
    const payload = {
      title: agTitle, agreement_type: agType || null,
      org_name: org?.name ?? null, org_short_code: org?.shortCode ?? null, org_state: org?.state ?? null, org_country: org?.country ?? null,
      counterparties: cps.map(c => ({ name: c.name, country: c.country, phone: c.phone, email: c.email, badge: c.badge, referred: c.referred, source_type: c.sourceType ?? null, source_id: c.sourceId ?? null })),
      eff_date: effDate || null, end_date: endDate || null,
      content: draft || null, header_config: header, footer_config: footer,
      approvers: approval.approvers, days_to_approve: approval.days, reminder_days: approval.reminder,
    };
    try {
      if (workingId) {
        // Editing an existing contract → update it AND re-enter Stage 2
        // approval (same destination as a fresh create, but on the existing
        // row, so no duplicate). resubmit applies the edited fields + new
        // approver list and resets the all-must-approve gate.
        await api.post(`/clm/ctc-contracts/${workingId}/resubmit`, payload);
        toast.success('Sent for approval', `${agTitle} is back in the approval queue.`);
        setSentForApproval(true);
        await refreshRecord(workingId);
        goStage(2);
      } else {
        const res = await api.post('/clm/ctc-contracts', payload);
        const newId = Number((res.data?.data as { dbId?: number } | undefined)?.dbId ?? 0) || null;
        toast.success('Sent for approval', `${agTitle} is now in the approval queue.`);
        setSentForApproval(true);
        setWorkingId(newId);
        await refreshRecord(newId);
        goStage(2);
      }
      return true;
    } catch (e) {
      toast.error('Could not submit', errMsg(e) || 'Please try again.');
      return false;
    }
  };

  // Sender replies to an approver's clarification query (from the Stage-2
  // review panel). Keeps the contract in the clarification state until the
  // approver acts again, so the query + reply stay visible to both sides.
  const respondToClarification = async (response: string): Promise<boolean> => {
    if (!workingId) return false;
    try {
      await api.post(`/clm/ctc-contracts/${workingId}/respond`, { response });
      toast.success('Response sent', 'Your reply was sent to the approver.');
      await refreshRecord();
      return true;
    } catch (e) { toast.error('Could not send', errMsg(e) || 'Please try again.'); return false; }
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

  // Approved → after choosing signers, open the positioning step where the
  // user drags each signer's signature box, then sends via Zoho Sign.
  const sendForSigning = (recipients: { name: string; email: string; role: string; contact: string }[], _days: number | null) => {
    if (!workingId) { toast.error('Not saved', 'Submit the draft for approval first.'); return; }
    const list = recipients.map(r => ({ name: r.name, email: r.email })).filter(s => s.email);
    if (!list.length) { toast.error('No signers', 'Select at least one contact person to sign.'); return; }
    setSignPos(list);
  };

  const recordSignature = async (payload: { index?: number; all?: boolean }) => {
    if (!workingId) return;
    try { await api.post(`/clm/ctc-contracts/${workingId}/record-signature`, payload); await refreshRecord(); }
    catch (e) { toast.error('Could not update', errMsg(e) || 'Please try again.'); }
  };

  // Nudge the counterparty signers via Zoho Sign.
  const remindSigning = async () => {
    if (!workingId) return;
    try { const res = await api.post(`/clm/ctc-contracts/${workingId}/remind-signing`); toast.success('Reminder sent', res.data?.message ?? 'Signers reminded via Zoho Sign.'); }
    catch (e) { toast.error('Could not send reminder', errMsg(e) || 'Please try again.'); }
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
                const active = s.n === stage;
                // "done" = any stage we've reached but aren't currently viewing,
                // so reached stages stay completed/navigable even after stepping
                // back (parity with My Workplace's furthest-stage stepper).
                const done = !active && s.n <= furthestStage;
                // Locked = a stage the contract hasn't reached yet — not
                // clickable from the stepper (advance via the stage's own
                // action button instead).
                const locked = s.n > furthestStage;
                const isLast = i === STAGES.length - 1;
                const num = String(s.n).padStart(2, '0');
                return (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div onClick={() => goStageFromStepper(s.n)} title={locked ? 'Complete the current stage to unlock this step' : undefined} style={{
                        position: 'relative', overflow: 'hidden', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? .6 : 1, height: '100%', padding: '11px 12px 10px', minHeight: 88, borderRadius: 10,
                        background: active ? 'linear-gradient(140deg,#5B21B6 0%,#6D28D9 45%,#7C3AED 100%)' : done ? (t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(140deg,#EDE9FE 0%,#DDD6FE 100%)') : (t.dark ? 'rgba(255,255,255,.04)' : '#F0F1F8'),
                        border: active ? 'none' : done ? `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}` : `1.5px solid ${t.dark ? 'rgba(148,163,184,.18)' : '#E2E4F0'}`,
                        boxShadow: active ? '0 6px 20px rgba(109,40,217,.35)' : done ? '0 2px 8px rgba(124,58,237,.1)' : '0 1px 4px rgba(15,23,42,.04)' }}>
                        {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(180deg,rgba(255,255,255,.1),transparent)', pointerEvents: 'none', borderRadius: '10px 10px 0 0' }} />}
                        {active && <span style={{ position: 'absolute', top: 9, right: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.32)', borderRadius: 20, padding: '2px 8px', fontSize: 7, fontWeight: 800, color: '#fff', letterSpacing: '.5px', textTransform: 'uppercase', zIndex: 2 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />Active</span>}
                        {done && <span style={{ position: 'absolute', top: 9, right: 10, width: 17, height: 17, borderRadius: '50%', background: 'linear-gradient(135deg,#A78BFA,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(124,58,237,.28)', zIndex: 2 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></span>}
                        {locked && <span style={{ position: 'absolute', top: 9, right: 10, width: 17, height: 17, borderRadius: '50%', background: t.dark ? 'rgba(148,163,184,.18)' : '#E2E4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#94a3b8' : '#94A3B8'} strokeWidth="2.4" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>}
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
          {hydrating && <CtcFormShimmer t={t} />}
          {!hydrating && stage === 1 && (
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
              editLock={editLock} lockReason={lockReason} signedUrl={signedDocUrl}
              resubmitMode={!!workingId && (approval === 'rejected' || !!signDecline)} onResubmit={resubmitDraft}
              declineReason={signDecline?.reason} declinedBy={signDecline?.by}
              onNext={() => goStage(2)}
            />
          )}
          {!hydrating && stage > 1 && <StageReview t={t} stage={stage} cps={cps} org={org} agTitle={agTitle} agType={agType} effDate={effDate} endDate={endDate} draft={draft} header={header} footer={footer} sentForApproval={sentForApproval} workingId={workingId} record={record} approval={approval} onResubmitEdit={() => goStage(1)} onSendForSigning={sendForSigning} onRecordSignature={recordSignature} onMoveToRepository={moveToRepository} onRefresh={refreshRecord} onRemind={remindSigning} onRespondClarification={respondToClarification} onExit={onClose} onBack={() => goStage(stage - 1)} onNext={() => goStage(stage + 1)} onSave={save} />}
        </div>
      </div>

      {picker && (
        <CpPicker
          t={t}
          slot={cps.length + 1}
          usedTypes={cps.map(c => (c.sourceType || c.badge || '').toLowerCase())}
          onClose={() => setPicker(false)}
          onPick={(cp) => {
            // One of each only: at most a single Customer (buyer), Consignee and
            // Supplier per agreement — fewer is fine, more is blocked.
            const type = (cp.sourceType || cp.badge || '').toLowerCase();
            const labelOf: Record<string, string> = { buyer: 'customer', consignee: 'consignee', supplier: 'supplier' };
            if (cps.some(c => (c.sourceType || c.badge || '').toLowerCase() === type)) {
              toast.error('Already added', `Only one ${labelOf[type] ?? type} is allowed. Remove the existing one to change it.`);
              return;
            }
            setCps([...cps, cp]);
            setPicker(false);
          }}
        />
      )}

      {signPos && workingId && (
        <ClmCtcSignPositionModal
          t={t} contractId={workingId} code={String((record?.code as string) ?? '')} title={agTitle}
          signers={signPos} header={header} footer={footer} content={draft}
          onClose={() => setSignPos(null)}
          onSent={async () => { setSignPos(null); await refreshRecord(); goStage(3); }}
        />
      )}
    </div>
  );
}

/* ── Edit-mode hydration shimmer — mirrors the 3-panel workspace layout ── */
function CtcFormShimmer({ t }: { t: OpsTokens }) {
  const card: React.CSSProperties = { flex: 1, minHeight: 0, background: t.surface, borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : 'rgba(124,58,237,.18)'}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(109,40,217,.08)' };
  const head = (grad: string) => (
    <div style={{ padding: '13px 14px', background: `linear-gradient(118deg,${grad})`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.28)' }} />
      <div style={{ width: '46%', height: 12, borderRadius: 6, background: 'rgba(255,255,255,.26)' }} />
    </div>
  );
  const body = (n: number) => (
    <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'hidden', padding: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
      {Array.from({ length: n }).map((_, i) => (
        i % 4 === 0
          ? <Shimmer key={i} height={48} radius={12} />
          : <Shimmer key={i} height={12} width={i % 3 === 0 ? '70%' : i % 5 === 0 ? '55%' : '100%'} radius={6} />
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, width: '100%' }}>
      <div style={{ flex: 2, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><div style={card}>{head('#4C1D95,#6D28D9,#7C3AED,#8B5CF6')}{body(6)}</div></div>
      <div style={{ flex: 5.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><div style={card}>{head('#3B0764,#5B21B6,#7C3AED,#8B5CF6')}{body(11)}</div></div>
      <div style={{ flex: 2.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><div style={card}>{head('#6D28D9,#7C3AED,#8B5CF6,#A78BFA')}{body(7)}</div></div>
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
  onSubmitForApproval: (approval: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }) => Promise<boolean>;
  resubmitMode: boolean; onResubmit: () => void;
  declineReason?: string; declinedBy?: string;
  // Draft is view-only unless it's fresh / internally-rejected / counterparty-
  // declined. lockReason explains why (awaiting approval, out for signature, signed).
  editLock?: boolean; lockReason?: 'approval' | 'signing' | 'signed' | null; signedUrl?: string;
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
  // Stage-1 validation — counterparty + organisation (Step 1), then title,
  // type and dates (Step 2) are all required before the draft can be submitted.
  const toast = useToast();
  // Inline field errors (Step 2 required *). Flags set on a failed validate;
  // each field's red state auto-clears once it has a value (see the `error`
  // props on the Fields below), so we never have to manually reset them.
  const [errors, setErrors] = useState<{ title?: boolean; type?: boolean; effDate?: boolean; endDate?: boolean; term?: boolean }>({});
  // Agreement length in days (end − start) and whether the termination notice
  // exceeds it — a 30-day notice on a 1-day agreement makes no sense, so it's
  // blocked. Computed here so both validate() and the inline Field error use it.
  const agreementDays = (p.effDate && p.endDate)
    ? Math.round((new Date(p.endDate).getTime() - new Date(p.effDate).getTime()) / 86400000)
    : null;
  const termDays = parseInt(termNotice || '', 10);
  const termInvalid = agreementDays !== null && agreementDays >= 0 && Number.isFinite(termDays) && termDays > agreementDays;
  const validateStep1 = (): boolean => {
    if (!p.cps.length) { toast.error('Counterparty required', 'Add at least one counterparty before continuing.'); setMidStep(1); return false; }
    if (!p.org)        { toast.error('Organisation required', 'Select your organisation details before continuing.'); setMidStep(1); return false; }
    return true;
  };
  const validateStep2 = (): boolean => {
    // Mark every empty required field so all of them highlight inline at once…
    const e = { title: !p.agTitle.trim(), type: !p.agType, effDate: !p.effDate, endDate: !p.endDate, term: termInvalid };
    setErrors(e);
    // …while the toaster still calls out the first one (unchanged behaviour).
    if (e.title)   { toast.error('Agreement name required', 'Enter the agreement title.'); setMidStep(2); return false; }
    if (e.type)    { toast.error('Agreement type required', 'Select the agreement type.'); setMidStep(2); return false; }
    if (e.effDate) { toast.error('Effective date required', 'Select the effective date.'); setMidStep(2); return false; }
    if (e.endDate) { toast.error('End date required', 'Select the end date.'); setMidStep(2); return false; }
    if (e.term)    { toast.error('Invalid termination notice', `Termination period (${termDays} days) can't exceed the agreement length (${agreementDays} day${agreementDays === 1 ? '' : 's'}).`); setMidStep(2); return false; }
    return true;
  };
  const validateAll = (): boolean => validateStep1() && validateStep2();
  const midNext = () => {
    if (midStep === 1) { if (!validateStep1()) return; setMidStep(2); }
    else if (midStep === 2) { if (!validateStep2()) return; setMidStep(3); }
    else p.onNext();
  };
  const midBack = () => { if (midStep > 1) setMidStep((midStep - 1) as 1 | 2 | 3); };
  // Section completion chips (Figma-style) — counterparty section is "done"
  // once at least one party is added; organisation once one is selected.
  const cpPct = p.cps.length ? 100 : 0;
  const orgPct = p.org ? 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, width: '100%' }}>
      {/* LEFT — Counterparty Details */}
      <div style={{ flex: leftOpen ? 2 : '0 0 48px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex .25s cubic-bezier(.22,1,.36,1)' }}>
        {!leftOpen ? <CollapsedBar t={t} title="Counterparty Details" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA" dir="left" onExpand={() => setLeftOpen(true)} /> :
        <Panel t={t} header="Panel 01" title="Counterparty Details" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA" onCollapse={() => setLeftOpen(false)} collapseDir="left">
          <div className="ctc-mid-scroll ctc-noshrink" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto' }}>
            {/* Counterparty sub-card */}
            <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#E4DCFB'}`, background: t.surface, boxShadow: '0 4px 14px rgba(109,40,217,.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(110deg,#4C1D95,#6D28D9,#7C3AED)', backgroundSize: '14px 14px, auto' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                </div>
                <span style={{ flex: 1, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '-.2px' }}>Counterparty Details</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.32)', borderRadius: 20, padding: '3px 9px' }}>{cpPct}%</span>
              </div>
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                  {/* Max one of each (Customer / Consignee / Supplier) ⇒ at most 3.
                      Hide the add button once all three slots are filled. */}
                  {(() => {
                    const usedTypes = new Set(p.cps.map(c => (c.sourceType || c.badge || '').toLowerCase()));
                    const allFilled = ['buyer', 'consignee', 'supplier'].every(tp => usedTypes.has(tp));
                    if (allFilled) {
                      return (
                        <div style={{ fontSize: 8.5, fontWeight: 600, color: t.textMuted, textAlign: 'center', padding: '8px 10px', border: `1.5px dashed ${t.dark ? 'rgba(124,58,237,.25)' : '#E2D9FB'}`, borderRadius: 10 }}>
                          All parties added — one Customer, one Consignee and one Supplier.
                        </div>
                      );
                    }
                    return (
                      <button onClick={p.onAddCp} style={{ border: `1.5px dashed ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, borderRadius: 10, width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#7C3AED' }}>{total === 0 ? 'Add Counter Party' : 'Add more Counter Party'}</span>
                      </button>
                    );
                  })()}
                </>
              );
            })()}
              </div>
            </div>
            {/* Our Organisation sub-card */}
            <div style={{ borderRadius: 14, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#E4DCFB'}`, background: t.surface, boxShadow: '0 4px 14px rgba(109,40,217,.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: '13px 13px 0 0', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(110deg,#4C1D95,#6D28D9,#7C3AED)', backgroundSize: '14px 14px, auto' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="9" y1="12" x2="9" y2="12" /><line x1="9" y1="15" x2="9" y2="15" /></svg>
                </div>
                <span style={{ flex: 1, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '-.2px' }}>Our Organisation Details</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.32)', borderRadius: 20, padding: '3px 9px' }}>{orgPct}%</span>
              </div>
              <div style={{ padding: 10 }}>
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
            </div>
          </div>
        </Panel>}
      </div>

      {/* MIDDLE — Draft workspace */}
      <div style={{ flex: 5.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Panel t={t} header="Panel 02 · Main Workspace" title="Agreement Draft Workspace" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>}>
          <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── inner STEP stepper ── */}
            <div style={{ display: 'flex', alignItems: 'center', background: t.surface, borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, padding: '10px 14px', flexShrink: 0, boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
              {MID_STEPS.map((s, i) => {
                const on = midStep === s.n, done = midStep > s.n;
                const stroke = on || done ? '#fff' : (t.dark ? '#a78bfa' : '#C4B5FD');
                // done = green + check, active = purple + step icon, upcoming = light.
                const boxBg = done ? 'linear-gradient(135deg,#059669,#10B981)' : on ? 'linear-gradient(135deg,#4F46E5,#7C3AED)' : (t.dark ? 'rgba(255,255,255,.05)' : '#F5F0FF');
                const boxShadow = done ? '0 4px 12px rgba(16,185,129,.4)' : on ? '0 4px 12px rgba(79,70,229,.4)' : 'none';
                const titleColor = done ? (t.dark ? '#6ee7b7' : '#059669') : on ? (t.dark ? '#c4b5fd' : '#4F46E5') : (t.dark ? '#7c87a8' : '#C4B5FD');
                const labelColor = done ? (t.dark ? '#34d399' : '#10B981') : on ? (t.dark ? '#a78bfa' : '#A78BFA') : (t.dark ? '#7c87a8' : '#C4B5FD');
                return (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : '0 1 auto', minWidth: 0 }}>
                    <div onClick={() => setMidStep(s.n)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: boxBg, border: on || done ? 'none' : `2px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, boxShadow }}>
                        {done
                          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          : s.n === 1
                          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                          : s.n === 2
                          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 6, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: labelColor, lineHeight: 1, marginBottom: 1 }}>Step {pad2(s.n)}</div>
                        <div style={{ fontSize: 8.5, fontWeight: on ? 800 : 700, color: titleColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{s.label}</div>
                      </div>
                    </div>
                    {i < 2 && <div style={{ flex: 1, height: 2, margin: '0 8px', borderRadius: 2, background: done ? 'linear-gradient(90deg,#10b981,#a7f3d0)' : (t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE') }} />}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'radial-gradient(rgba(255,255,255,.28) 1.3px, transparent 1.3px), linear-gradient(118deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA)', backgroundSize: '14px 14px, auto', borderRadius: '14px 14px 0 0' }}>
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
                    <Field t={t} label="Agreement Title *" error={errors.title && !p.agTitle.trim() ? 'Agreement title is required' : undefined}><input value={p.agTitle} onChange={e => p.setAgTitle(e.target.value)} placeholder="e.g. Supply Agreement — GreenHarvest × AgroSource" style={ipt} /></Field>
                    <Field t={t} label="Agreement Type *" error={errors.type && !p.agType ? 'Agreement type is required' : undefined}>
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
                      <Field t={t} label="Effective Date *" green error={errors.effDate && !p.effDate ? 'Effective date is required' : undefined}><MasterDatePicker value={p.effDate} onChange={p.setEffDate} placeholder="Select date" /></Field>
                      <Field t={t} label="End Date *" green error={errors.endDate && !p.endDate ? 'End date is required' : undefined}><MasterDatePicker value={p.endDate} onChange={p.setEndDate} minDate={p.effDate || undefined} placeholder="Select date" /></Field>
                      <Field t={t} label="Termination Notice" green error={(errors.term && termInvalid) ? `Cannot exceed agreement length (${agreementDays} day${agreementDays === 1 ? '' : 's'})` : undefined}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min="1" max={agreementDays ?? undefined} value={termNotice} onChange={e => setTermNotice(e.target.value)} style={{ ...ipt, borderColor: termInvalid ? '#ef4444' : (t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0'), width: 60, textAlign: 'center', padding: '0 6px' }} />
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
                : { flex: 1, minHeight: 0, background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.08)', display: 'flex', flexDirection: 'column' }}>
                {/* header with actions */}
                <div style={{ padding: '12px 14px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#4C1D95 0%,#6D28D9 40%,#7C3AED 75%,#8B5CF6 100%)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '7px 10px', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.18)' : '#ECE6FB'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#F6F3FF', flexWrap: 'wrap' }}>
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
                <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: t.dark ? '#100c1c' : '#eef0f6', padding: 14 }}>
                  <HeaderFooterPanel header={header} setHeader={setHeader} footer={footer} setFooter={setFooter} uploadLogoEndpoint="/clm/trade-doc-library/upload-header-logo">
                    <div ref={editorRef} className="ctc-editor" contentEditable={!p.editLock} suppressContentEditableWarning data-ph="Start drafting your agreement content here…  This Agreement is entered into between [Counter Party 1] and [Counter Party 2]…" onInput={p.editLock ? undefined : syncDraft} onBlur={p.editLock ? undefined : syncDraft} style={{ minHeight: 220, padding: '14px 16px', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'inherit', color: t.dark ? '#e8eaed' : '#1f2937', lineHeight: 1.8, background: t.dark ? '#1b2230' : '#fff', boxSizing: 'border-box' }} />
                  </HeaderFooterPanel>
                </div>
                {/* footer hint */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', borderTop: `1px solid ${t.dark ? 'rgba(124,58,237,.18)' : '#F1EEFF'}`, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg><span style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#A78BFA', fontWeight: 500, fontStyle: 'italic' }}>Placeholders auto-fill on agreement generation</span></div>
                  <span style={{ fontSize: 8, fontWeight: 700, color: t.dark ? '#a78bfa' : '#C4B5FD', letterSpacing: '.05em' }}>{'{{PLACEHOLDER}}'}</span>
                </div>
                {phOpen && <ClmInsertPlaceholderModal open={phOpen} hideProductTab counterparties={p.cps.map(c => ({ name: c.name, code: String(c.sourceId ?? ''), role: (c.sourceType || c.badge || '').toLowerCase(), type: c.sourceType, id: c.sourceId }))} onClose={() => setPhOpen(false)} onInsert={tok => { if (/^\s*</.test(tok)) insertHtml(tok); else insertText(tok); }} />}
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
            ) : p.editLock ? (
              // Draft is locked (awaiting approval / out for signature / signed).
              // View only — no edit, resubmit or approval from here.
              (() => {
                const lk = p.lockReason === 'signed'
                  ? { txt: 'Signed & locked — view only', bg: t.dark ? 'rgba(16,185,129,.12)' : '#ECFDF5', bd: t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0', fg: t.dark ? '#6ee7b7' : '#059669' }
                  : p.lockReason === 'signing'
                    ? { txt: 'Out for counterparty signature — view only (editable only if they decline)', bg: t.dark ? 'rgba(8,145,178,.12)' : '#ECFEFF', bd: t.dark ? 'rgba(6,182,212,.35)' : '#A5F3FC', fg: t.dark ? '#67e8f9' : '#0E7490' }
                    : { txt: 'Awaiting internal approval — view only (editable only if rejected)', bg: t.dark ? 'rgba(245,158,11,.12)' : '#FFFBEB', bd: t.dark ? 'rgba(245,158,11,.35)' : '#FDE68A', fg: t.dark ? '#fcd34d' : '#B45309' };
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: lk.bg, border: `1.5px solid ${lk.bd}`, color: lk.fg, fontSize: 9.5, fontWeight: 800 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      {lk.txt}
                    </span>
                    {p.lockReason === 'signed' && p.signedUrl && (
                      <button onClick={() => window.open(p.signedUrl, '_blank')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(5,150,105,.32)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>View Signed Document</span>
                      </button>
                    )}
                  </div>
                );
              })()
            ) : p.resubmitMode ? (
              <button onClick={() => { if (validateAll()) p.onResubmit(); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#B45309,#D97706,#F59E0B)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(217,119,6,.4)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>Resubmit for Review</span>
              </button>
            ) : (
              // Both add AND edit end Step 3 the same way: open the approval
              // workflow and send for approval (edit updates the existing row
              // via resubmit; see submitForApproval). No more "Save Changes"
              // dead-end that redirected to the list.
              <button onClick={() => { if (validateAll()) setApprovalOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(109,40,217,.4)' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{p.isEditing ? 'Update & Send for Approval' : 'Submit & Send for Approval'}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            )}
          </div>
        </Panel>
      </div>
      {approvalOpen && <ApprovalWorkflowModal t={t} orgName={p.org?.name ?? 'Our Organisation'} onClose={() => setApprovalOpen(false)} onSubmit={(data) => p.onSubmitForApproval(data)} />}

      {/* RIGHT — Summary */}
      <div style={{ flex: rightOpen ? 2.5 : '0 0 48px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex .25s cubic-bezier(.22,1,.36,1)' }}>
        {!rightOpen ? <CollapsedBar t={t} title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" dir="right" onExpand={() => setRightOpen(true)} /> :
        <Panel t={t} header="Panel 03" title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" onCollapse={() => setRightOpen(false)} collapseDir="right" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></svg>}>
          <RightTools t={t} active={midStep === 3 && !p.editLock} draft={p.draft} declineReason={p.declineReason} declinedBy={p.declinedBy} onInsert={(tok) => { if (midStep !== 3 || p.editLock) return; if (editorRef.current) insertText(tok); else p.setDraft((p.draft ? p.draft + ' ' : '') + tok); }} summary={[['Agreement', p.agTitle || '—'], ['Type', p.agType || '—'], ['Eff. Date', p.effDate || '—'], ['End Date', p.endDate || '—'], ['Counterparties', p.cps.length ? `${p.cps.length} added` : '—'], ['CP 1', cp1?.name || '—'], ['Organisation', p.org?.name || '—']]} />
        </Panel>}
      </div>
    </div>
  );
}

/* ── Stages 2–4: shared LEFT (read-only counterparty) + RIGHT (review) panels, changing MIDDLE ── */
type SignRecipient = { name: string; email: string; role: string; contact: string; signed: boolean; signed_at: string | null; declined?: boolean; decline_reason?: string };

function StageReview({ t, stage, cps, org, agTitle, agType, effDate, endDate, draft, header, footer, sentForApproval, workingId, record, approval, onResubmitEdit, onSendForSigning, onRecordSignature, onMoveToRepository, onRefresh, onRemind, onRespondClarification, onExit, onBack, onNext, onSave }: {
  t: OpsTokens; stage: number; cps: CP[]; org: Org | null; agTitle: string; agType: string; effDate: string; endDate: string; draft: string; header: HeaderConfig; footer: FooterConfig; sentForApproval: boolean;
  workingId: number | null; record: Record<string, unknown> | null; approval: string;
  onResubmitEdit: () => void;
  onSendForSigning: (recipients: { name: string; email: string; role: string; contact: string }[], days: number | null) => void;
  onRecordSignature: (payload: { index?: number; all?: boolean }) => void;
  onMoveToRepository: () => void; onRefresh: () => void; onRemind: () => void; onExit: () => void;
  onRespondClarification: (response: string) => Promise<boolean>;
  onBack: () => void; onNext: () => void; onSave: () => void;
}) {
  const [reminded, setReminded] = useState(false);
  const [reminding, setReminding] = useState(false);   // in-flight guard for the Send Reminder button
  const [signingOpen, setSigningOpen] = useState(false);
  const [vhOpen, setVhOpen] = useState(false);
  const [signedCelebrationOpen, setSignedCelebrationOpen] = useState(false);
  const celebratedRef = useRef(false);
  const loadedSignedRef = useRef<boolean | null>(null);   // signed-state at first record load
  const [clarReply, setClarReply] = useState('');     // sender's reply to an open clarification
  const [clarSending, setClarSending] = useState(false);
  const versions = (Array.isArray(record?.versions) ? record!.versions : []) as CtcVersion[];
  const draftCount = versions.filter(v => (v.status || '').toLowerCase() === 'under review').length;
  const signers = (Array.isArray(record?.signing_recipients) ? record!.signing_recipients : []) as SignRecipient[];
  const allSigned = signers.length > 0 && signers.every(s => s.signed);
  const declinedSigner = signers.find(s => s.declined);
  const isDeclined = !!declinedSigner;
  // Fully signed / stored → locked. No re-send for signing, no resubmit — only
  // viewing (and the legitimate "Move to Final Repository" once all signed).
  const signedLock = allSigned || String(record?.status ?? '') === 'signed' || stage >= 4;
  const code = String((record?.code as string) ?? 'CTC');
  // Fully signed when every recipient signed OR a counterparty-signed date /
  // signed status is already on record (covers reopening an already-signed CTC).
  const fullySigned = allSigned || !!record?.cp_signed_date || String(record?.status ?? '') === 'signed';
  // Celebrate ONLY when signing completes LIVE this session — i.e. the contract
  // loaded as NOT-signed and then became fully signed while on Stage 3. Don't
  // pop it when opening an already-signed contract to view, nor on Stage 4→3.
  useEffect(() => {
    if (!record) return;                                  // wait for the record to load
    if (loadedSignedRef.current === null) {               // first load → remember, never celebrate
      loadedSignedRef.current = fullySigned;
      return;
    }
    if (!loadedSignedRef.current && fullySigned && stage === 3 && !isDeclined && !celebratedRef.current) {
      celebratedRef.current = true;
      setSignedCelebrationOpen(true);
    }
  }, [record, fullySigned, stage, isDeclined]);
  const rejReason = String((record?.rejection_reason as string) ?? '');
  // Clarification thread raised by an approver from "Agreements To Approve".
  // Surfaced here so the sender sees the query in Stage 2 and can reply without
  // leaving the form. Stays visible while the contract sits in 'clarification'
  // (i.e. until the sender resubmits a fresh draft or the approver decides).
  const clarifications = (Array.isArray(record?.clarifications) ? record!.clarifications : []) as { query?: string; date?: string; response?: string; resolved?: boolean }[];
  const inClarification = approval === 'clarification';
  const openClar = inClarification ? clarifications[clarifications.length - 1] ?? null : null;
  const sendClarReply = async () => {
    if (clarSending || !clarReply.trim()) return;
    setClarSending(true);
    const ok = await onRespondClarification(clarReply.trim());
    setClarSending(false);
    if (ok) setClarReply('');
  };
  const apprName = String((record?.primary_approver_name as string) ?? 'Approver');
  const apprInit = apprName.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'AP';
  // Multi-approver gate: the contract only becomes "approved" (and can advance
  // to Stage 3 signing) once EVERY approver has approved. Surface the running
  // tally so the sender sees how many of the selected approvers have signed off.
  const approverList = (Array.isArray(record?.approvers) ? record!.approvers : []) as { name?: string; status?: string }[];
  const approverCount = approverList.length;
  const approvedCount = approverList.filter(a => (a.status || 'pending') === 'approved').length;
  const fmtNice = (s: unknown) => { if (!s) return '—'; const d = new Date(String(s)); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const executedOn = fmtNice(record?.cp_signed_date);
  // Once approved, the {{signature}} placeholder (receiving-party / our org)
  // resolves to the branch's signature + stamp image; before that it stays a
  // muted placeholder so reviewers see where the signature will land.
  const orgSig = String((record?.org_signature_url as string) ?? '');
  const isSignedOff = approval === 'approved' || stage >= 3;
  const signedUrl = String((record?.signed_document_url as string) ?? '');
  const sigToken = isSignedOff && orgSig
    ? `<img src="${orgSig}" alt="Authorised Signatory" style="max-height:78px;max-width:200px;object-fit:contain;display:inline-block;vertical-align:middle;" />`
    : '<span style="color:#94a3b8;font-style:italic;">{{signature}}</span>';
  // Prefer the server-resolved preview (party {{customer.*}}/{{consignee.*}}/
  // {{supplier.*}} + org tokens filled with real data) so Stage 2+ shows actual
  // values, not raw placeholders. Falls back to the raw draft when absent.
  const resolvedPreview = typeof record?.content_preview === 'string' && record.content_preview
    ? (record.content_preview as string)
    : draft;
  const previewDraft = (resolvedPreview || '').replace(/\{\{\s*signature\s*\}\}/gi, sigToken);
  const MID = {
    2: { head: '#3B0764,#5B21B6,#7C3AED,#8B5CF6', sup: 'Panel 02 · Agreement Preview', title: 'Agreement Preview' },
    3: { head: '#3B0764,#5B21B6,#7C3AED,#8B5CF6', sup: 'Panel 02 · Negotiation & Signing', title: 'Counterparty Negotiation & Signing' },
    4: { head: '#064E3B,#059669,#10B981', sup: 'Panel 02 · Executed Agreement', title: 'Signed Agreement' },
  }[stage]!;
  const cp1 = cps[0] ?? null;
  const cp2 = cps[1] ?? null;
  const summary: [string, string][] = [['Agreement', agTitle || 'Agreement Draft'], ['Type', agType || '—'], ['Eff. Date', effDate || '—'], ['End Date', endDate || '—'], ['Renewable', 'No'], ['Term', '30 days']];

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, width: '100%' }}>

      {/* LEFT — Counterparty Details (stages 2-3) · Contract Summary (stage 4) */}
      <div style={{ flex: 2, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff,#f3effe 50%,#ede8fd)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.22)'}`, boxShadow: '0 4px 20px rgba(109,40,217,.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stage === 4
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}</div>
              <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Panel 01</div><div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{stage === 4 ? 'Contract Summary' : 'Counterparty Details'}</div></div>
            </div>
            {stage === 4
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.3)' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6ee7b7' }} /><span style={{ fontSize: 7.5, fontWeight: 800, color: '#fff' }}>Executed</span></span>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg><span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>Read Only</span></span>}
          </div>
          <div className="ctc-mid-scroll ctc-noshrink" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stage === 4 ? (
              <ContractSummaryCard t={t} code={code} agTitle={agTitle} agType={agType} cps={cps} org={org} effDate={effDate} endDate={endDate} executedOn={executedOn} signers={signers} />
            ) : (<>
              {cps.map((cp, i) => <CpCard key={i} t={t} slot={i + 1} cp={cp} readOnly />)}
              {org && <OrgMiniCard t={t} org={org} />}
              {cps.length === 0 && !org && <div style={{ fontSize: 10, color: t.textMuted, textAlign: 'center', padding: 20 }}>No counterparty details captured.</div>}
            </>)}
          </div>
        </div>
      </div>

      {/* MIDDLE — changes per stage */}
      <div style={{ flex: 5.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: t.surface, borderRadius: 16, border: `1.5px solid ${stage === 4 ? 'rgba(5,150,105,.25)' : (t.dark ? 'rgba(124,58,237,.25)' : 'rgba(124,58,237,.18)')}`, boxShadow: '0 4px 20px rgba(109,40,217,.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', background: `radial-gradient(rgba(255,255,255,.26) 1.2px, transparent 1.2px), linear-gradient(118deg,${MID.head})`, backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
              <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>{MID.sup}</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{MID.title}</div></div>
            </div>
            <span onClick={() => setVhOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg><span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>Download</span></span>
          </div>
          <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: t.dark ? '#100c1c' : '#F0EFF8', padding: '18px 24px' }}>
            {stage === 4 && signedUrl ? (
              /* Final repository → the fully-signed PDF rendered as page canvases
                 (pdf.js) so it flows inside this column's own scrollbar — no black
                 native-viewer chrome, no inner scrollbar. */
              <SignedPdfViewer t={t} signatureRequestId={Number(record?.signature_request_id) || null} signedUrl={signedUrl} />
            ) : (
            <div style={{ width: '100%', maxWidth: 820, margin: '0 auto', background: t.dark ? '#1a1530' : '#fff', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,.1)', padding: '36px 48px', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: stage === 4 ? 'linear-gradient(90deg,#047857,#059669,#10B981)' : 'linear-gradient(90deg,#4C1D95,#7C3AED,#A78BFA)', borderRadius: '6px 6px 0 0' }} />
              {/* Configured document header from Stage 1 — logo + title are
                  free-positioned via logo_pos / title_pos (% of the band, centre
                  anchor), matching HeaderFooterPanel so the preview lands the
                  logo exactly where it was placed. */}
              {(header.show_logo || header.show_title) && (() => {
                const logoH = Math.max(24, Math.min(200, header.logo_height ?? 62));
                const cp = (p?: { x?: number; y?: number }) => ({ x: Math.max(0, Math.min(100, p?.x ?? 50)), y: Math.max(0, Math.min(100, p?.y ?? 50)) });
                const lp = cp(header.logo_pos), tp = cp(header.title_pos);
                return (
                  <div style={{ position: 'relative', minHeight: Math.max(64, logoH + 24), marginBottom: 14, borderBottom: '2px solid rgba(124,58,237,.18)', background: header.background, color: header.text_color, borderRadius: 6 }}>
                    {header.show_logo && header.logo_url && <img src={header.logo_url} alt="logo" style={{ position: 'absolute', left: `${lp.x}%`, top: `${lp.y}%`, transform: 'translate(-50%,-50%)', height: logoH, maxWidth: Math.max(180, logoH * 3), objectFit: 'contain' }} />}
                    {header.show_title && (
                      <div style={{ position: 'absolute', left: `${tp.x}%`, top: `${tp.y}%`, transform: 'translate(-50%,-50%)', textAlign: header.align, maxWidth: '60%' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>{header.title}</div>
                        {header.subtitle && <div style={{ fontSize: 9, opacity: .7, marginTop: 1 }}>{header.subtitle}</div>}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Only the drafted agreement content — no auto-generated title / id / parties scaffold. */}
              {draft
                ? <div className="ctc-editor" style={{ fontSize: 10, color: t.textSub, lineHeight: 1.7, overflowWrap: 'anywhere', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: previewDraft }} />
                : <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.7, textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }}>No agreement content drafted yet.</div>}
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
            )}
          </div>
          {/* footer nav */}
          <div style={{ flexShrink: 0, padding: '10px 16px', background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Signed & locked — viewing an earlier stage of a completed
                  agreement. No re-send / resubmit; just a view-only notice. */}
              {signedLock && stage < 3 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: t.dark ? 'rgba(16,185,129,.12)' : '#ECFDF5', border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0'}`, color: t.dark ? '#6ee7b7' : '#059669', fontSize: 9.5, fontWeight: 800 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Signed &amp; locked — view only
                </span>
              )}
              {/* Stage 2 — Internal Review & Approval outcomes */}
              {!signedLock && stage === 2 && approval === 'rejected' && (
                <button onClick={onResubmitEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#B45309,#D97706,#F59E0B)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(217,119,6,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> Edit &amp; Resubmit for Review</button>
              )}
              {!signedLock && stage === 2 && approval === 'approved' && (
                <button onClick={() => setSigningOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(8,145,178,.35)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send for Signing &amp; Negotiation</button>
              )}
              {!signedLock && stage === 2 && approval !== 'approved' && approval !== 'rejected' && (
                <button disabled title={inClarification ? 'Reply to the clarification in the review panel — the approver decides after you respond' : approverCount > 1 ? `All ${approverCount} approvers must approve before this can be sent for signing` : "Waiting for the approver's decision"} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.04)' : '#F1F5F9', border: `1.5px solid ${t.dark ? 'rgba(148,163,184,.2)' : '#E2E8F0'}`, cursor: 'not-allowed', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: t.textMuted }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> {inClarification ? 'Clarification Requested' : `Awaiting Approval${approverCount > 1 ? ` · ${approvedCount} of ${approverCount} approved` : ''}`}</button>
              )}
              {/* Stage 3 — declined → must re-run internal approval before it can
                  go back to the counterparty, so route to Stage 1 / resubmit. */}
              {stage === 3 && isDeclined && (
                <button onClick={onResubmitEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#B45309,#D97706,#F59E0B)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(217,119,6,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> Edit &amp; Resubmit for Approval</button>
              )}
              {/* Stage 3 — awaiting e-signatures → nudge the signers via Zoho Sign */}
              {stage === 3 && !isDeclined && !allSigned && !signedLock && (
                <button onClick={async () => { if (reminding || signers.length === 0) return; setReminding(true); try { await onRemind(); } finally { setReminding(false); } }} disabled={signers.length === 0 || reminding} title="Re-email the counterparty signers via Zoho Sign" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: (signers.length === 0 || reminding) ? (t.dark ? 'rgba(255,255,255,.04)' : '#F1F5F9') : 'linear-gradient(135deg,#5B21B6,#6D28D9,#7C3AED)', border: 'none', cursor: (signers.length === 0 || reminding) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: (signers.length === 0 || reminding) ? t.textMuted : '#fff', boxShadow: (signers.length === 0 || reminding) ? 'none' : '0 3px 10px rgba(109,40,217,.35)' }}>{reminding ? <><svg className="ctc-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Sending…</> : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg> Send Reminder</>}</button>
              )}
              {stage === 3 && !isDeclined && allSigned && (
                <button onClick={onMoveToRepository} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(5,150,105,.35)' }}>Move to Final Repository <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg></button>
              )}
              {/* Stage 4 — store finalized agreement */}
              {stage === 4 && (
                <button onClick={onSave} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(5,150,105,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Contract Stored in Repository</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — Internal Review & Approval (2-3) · Contract History (stage 4) */}
      <div style={{ flex: 2.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: stage === 4 ? (t.dark ? '#0e1f1a' : 'linear-gradient(160deg,#f0fdf6,#ecfdf3 45%,#e3fbec)') : (t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff,#f3effe 40%,#ede8fd)'), borderRadius: 16, border: `1.5px solid ${stage === 4 ? (t.dark ? 'rgba(16,185,129,.3)' : 'rgba(16,185,129,.3)') : (t.dark ? 'rgba(167,139,250,.3)' : 'rgba(167,139,250,.28)')}`, boxShadow: '0 4px 24px rgba(109,40,217,.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', background: stage === 4 ? 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#064E3B,#047857,#059669,#10B981)' : 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#6D28D9,#7C3AED,#8B5CF6,#A78BFA)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stage === 4
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}</div>
            <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Panel 03</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{stage === 4 ? 'Contract History' : stage === 3 ? 'Negotiation Status' : 'Internal Review & Approval'}</div></div>
          </div>
          <div className="ctc-mid-scroll ctc-noshrink" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stage === 4 ? <ContractHistoryPanel t={t} draftCount={draftCount} signedUrl={signedUrl} signatureRequestId={Number(record?.signature_request_id) || null} onVersionHistory={() => setVhOpen(true)} onExit={onExit} /> : (<>
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
            {/* Clarification banner — an approver asked for clarification before
                deciding. Shows the query (reason) + a reply box; persists until
                the contract leaves the clarification state. */}
            {inClarification && openClar && (
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.45)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.1)' : '#F5F3FF', padding: '9px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#7C3AED', textTransform: 'uppercase', letterSpacing: '.08em' }}>Clarification Requested{apprName ? ` · ${apprName}` : ''}</span>
                </div>
                <div style={{ fontSize: 9, color: t.dark ? '#ddd6fe' : '#4C1D95', lineHeight: 1.5 }}>{openClar.query || 'The approver requested clarification before deciding.'}</div>
                {openClar.response
                  ? <div style={{ marginTop: 7, padding: '6px 9px', borderRadius: 8, background: t.dark ? 'rgba(16,185,129,.12)' : '#ECFDF5', border: `1px solid ${t.dark ? 'rgba(16,185,129,.38)' : '#A7F3D0'}` }}>
                      <div style={{ fontSize: 7.5, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Your Response</div>
                      <div style={{ fontSize: 9, color: t.dark ? '#a7f3d0' : '#065F46', lineHeight: 1.5 }}>{openClar.response}</div>
                      <div style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#7C3AED', marginTop: 4, fontWeight: 600 }}>Awaiting the approver's decision.</div>
                    </div>
                  : <div style={{ marginTop: 7 }}>
                      <textarea value={clarReply} onChange={e => setClarReply(e.target.value)} placeholder="Type your reply to the approver…" style={{ width: '100%', height: 52, padding: '7px 9px', borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#DDD6FE'}`, background: t.surface, color: t.text, fontFamily: 'inherit', fontSize: 9, resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: 1.5 }} />
                      <button disabled={!clarReply.trim() || clarSending} onClick={sendClarReply} style={{ width: '100%', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px', borderRadius: 8, border: 'none', background: (!clarReply.trim() || clarSending) ? (t.dark ? 'rgba(124,58,237,.25)' : '#C4B5FD') : 'linear-gradient(135deg,#6D28D9,#7C3AED)', color: '#fff', fontFamily: 'inherit', fontSize: 9, fontWeight: 800, cursor: (!clarReply.trim() || clarSending) ? 'not-allowed' : 'pointer', opacity: (!clarReply.trim() || clarSending) ? .65 : 1 }}>
                        {clarSending
                          ? <svg className="ctc-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
                        {clarSending ? 'Sending…' : 'Send Response'}
                      </button>
                    </div>}
              </div>
            )}
            {/* Version History trigger */}
            <button onClick={() => setVhOpen(true)} style={{ width: '100%', padding: '9px 12px', borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></div>
                <div style={{ textAlign: 'left' }}><div style={{ fontSize: 9, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Version History</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#A78BFA', marginTop: 1 }}>View &amp; download all versions</div></div>
              </div>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 7.5, fontWeight: 800, color: '#fff' }}>{draftCount ? `${draftCount} ver` : 'v1'}</span>
            </button>
            {/* Stage 3 — counterparty e-signing (Zoho Sign) tracker */}
            {stage === 3 && (<>
              {isDeclined && (
                <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(239,68,68,.4)' : '#FECACA'}`, background: t.dark ? 'rgba(239,68,68,.1)' : '#FEF2F2', padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#fca5a5' : '#DC2626'} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#fca5a5' : '#DC2626', textTransform: 'uppercase', letterSpacing: '.08em' }}>Declined by {declinedSigner?.name || 'a signer'}</span>
                  </div>
                  <div style={{ fontSize: 9, color: t.dark ? '#fecaca' : '#991B1B', lineHeight: 1.5 }}>{declinedSigner?.decline_reason || 'The signer declined the document.'}</div>
                  <div style={{ fontSize: 8, color: t.dark ? '#fca5a5' : '#B91C1C', marginTop: 5, fontWeight: 600 }}>Edit the draft, resubmit for internal approval, then send for signing again.</div>
                </div>
              )}
              <div style={{ borderRadius: 11, border: `1.5px solid ${isDeclined ? (t.dark ? 'rgba(239,68,68,.3)' : '#FECACA') : (t.dark ? 'rgba(6,182,212,.3)' : '#A5F3FC')}`, background: t.surface, overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', background: t.dark ? 'rgba(6,182,212,.14)' : 'linear-gradient(110deg,#ECFEFF,#CFFAFE)', borderBottom: `1px solid ${t.dark ? 'rgba(6,182,212,.25)' : '#A5F3FC'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0E7490', letterSpacing: '.1em', textTransform: 'uppercase' }}>Signing Status · Zoho Sign</span>
                  <span style={{ fontSize: 7, fontWeight: 700, color: t.dark ? '#67e8f9' : '#0891b2' }}>{signers.filter(s => s.signed).length}/{signers.length} signed</span>
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {signers.length === 0 && <div style={{ fontSize: 9, color: t.textMuted, textAlign: 'center', padding: 8 }}>No recipients yet.</div>}
                  {signers.map((s, i) => {
                    const dec = !!s.declined;
                    const bd = s.signed ? (t.dark ? 'rgba(16,185,129,.3)' : '#A7F3D0') : dec ? (t.dark ? 'rgba(239,68,68,.3)' : '#FECACA') : (t.dark ? 'rgba(6,182,212,.2)' : '#CFFAFE');
                    const av = s.signed ? '#059669,#047857' : dec ? '#DC2626,#B91C1C' : '#0891b2,#0e7490';
                    return (
                      <div key={i} style={{ padding: '7px 8px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.03)' : '#F8FEFF', border: `1.5px solid ${bd}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 7, background: `linear-gradient(135deg,${av})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 800, color: '#fff' }}>{(s.name || '?').slice(0, 2).toUpperCase()}</span></div>
                          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div><div style={{ fontSize: 7.5, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.email || '—'}</div></div>
                          {s.signed
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 8, background: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', fontSize: 7, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>Signed</span>
                            : dec
                              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 8, background: t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2', fontSize: 7, fontWeight: 800, color: t.dark ? '#fca5a5' : '#DC2626' }}>✕ Declined</span>
                              : <span style={{ padding: '3px 7px', borderRadius: 8, background: t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7', fontSize: 7, fontWeight: 800, color: t.dark ? '#fcd34d' : '#D97706' }}>● Awaiting</span>}
                        </div>
                        {dec && s.decline_reason && <div style={{ fontSize: 7.5, color: t.dark ? '#fca5a5' : '#B91C1C', marginTop: 5, paddingLeft: 32, lineHeight: 1.4 }}>“{s.decline_reason}”</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>)}
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
                  const lbl = approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : inClarification ? 'Clarification' : stage === 4 ? 'Completed' : 'Pending';
                  const ok = approval === 'approved' || stage === 4, bad = approval === 'rejected';
                  const bg = ok ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : bad ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2') : inClarification ? (t.dark ? 'rgba(124,58,237,.18)' : '#F5F3FF') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7');
                  const fg = ok ? (t.dark ? '#6ee7b7' : '#059669') : bad ? (t.dark ? '#fca5a5' : '#DC2626') : inClarification ? (t.dark ? '#c4b5fd' : '#7C3AED') : (t.dark ? '#fcd34d' : '#D97706');
                  return <span style={{ padding: '2px 7px', borderRadius: 10, background: bg, border: `1px solid ${fg}33`, fontSize: 7, fontWeight: 700, color: fg }}>● {lbl}</span>;
                })()}
              </div>
              <div style={{ padding: '10px 10px 14px' }}>
                {(() => {
                  // Render EVERY selected approver with their own decision so the
                  // sender can see each name + individual status (Approved /
                  // Rejected / Pending). Legacy drafts (no per-approver list)
                  // fall back to the single primary-approver row driven by the
                  // contract-level approval_status.
                  const rows = approverList.length > 0
                    ? approverList.map((a, i) => ({
                        name: String(a.name || `Approver ${i + 1}`),
                        status: String(a.status || 'pending'),
                        mandatory: !!(a as { mandatory?: boolean }).mandatory,
                      }))
                    : [{ name: apprName, status: approval === 'approved' ? 'approved' : approval === 'rejected' ? 'rejected' : 'pending', mandatory: true }];
                  return rows.map((a, i) => {
                    const init = a.name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'AP';
                    const ok = a.status === 'approved', bad = a.status === 'rejected';
                    const stBg = ok ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : bad ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7');
                    const stFg = ok ? (t.dark ? '#6ee7b7' : '#059669') : bad ? (t.dark ? '#fca5a5' : '#DC2626') : (t.dark ? '#fcd34d' : '#D97706');
                    return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.03)' : 'linear-gradient(135deg,#FAFBFF,#F5F0FF)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, marginBottom: i === rows.length - 1 ? 14 : 7 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#F97316,#EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{init}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9.5, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div><div style={{ display: 'flex', gap: 3, marginTop: 3 }}><span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7', color: t.dark ? '#fcd34d' : '#D97706' }}>APPROVER</span>{a.mandatory && <span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2', color: t.dark ? '#fca5a5' : '#DC2626' }}>Mandatory</span>}</div></div>
                  <span style={{ padding: '3px 8px', borderRadius: 8, background: stBg, fontSize: 7, fontWeight: 700, color: stFg }}>{ok ? 'Approved' : bad ? 'Rejected' : 'Pending'}</span>
                </div>
                    );
                  });
                })()}
                {/* Approval reminder — only while still awaiting the approver's
                    decision (Stage 2, pending). Hidden once approved / at Stage 3+. */}
                {approval !== 'approved' && stage < 3 && (
                <button onClick={() => sentForApproval && setReminded(true)} disabled={!sentForApproval || reminded} title={sentForApproval ? '' : 'Send the draft for approval first'} style={{ width: '100%', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 9, border: `1.5px solid ${reminded ? (t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0') : sentForApproval ? (t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD') : (t.dark ? 'rgba(148,163,184,.2)' : '#E2E8F0')}`, background: reminded ? (t.dark ? 'rgba(16,185,129,.12)' : '#ECFDF5') : sentForApproval ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : (t.dark ? 'rgba(255,255,255,.02)' : '#F8FAFC'), cursor: sentForApproval && !reminded ? 'pointer' : 'not-allowed', opacity: sentForApproval ? 1 : .55, fontFamily: 'inherit' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={reminded ? (t.dark ? '#6ee7b7' : '#059669') : sentForApproval ? (t.dark ? '#c4b5fd' : '#7C3AED') : (t.dark ? '#94a3b8' : '#94A3B8')} strokeWidth="2.2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  <span style={{ fontSize: 9, fontWeight: 800, color: reminded ? (t.dark ? '#6ee7b7' : '#059669') : sentForApproval ? (t.dark ? '#c4b5fd' : '#6D28D9') : (t.dark ? '#94a3b8' : '#94A3B8') }}>{reminded ? 'Reminder Sent' : 'Send Reminder'}</span>
                </button>
                )}
                <div style={{ fontSize: 7, fontWeight: 800, color: t.textMuted, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} />Review Timeline<div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} /></div>
                {/* Full audit trail from the contract's version history — every
                    submission, approval, rejection, send, sign & decline, each
                    with its stored date & time (oldest first). */}
                {(() => {
                  // Combined timeline = the contract's version history PLUS the
                  // approver's clarification thread (each query + the sender's
                  // reply). The clarification log lives in record.clarifications
                  // but was previously only shown in the live banner, so it
                  // vanished from the audit trail once the contract moved on.
                  type TL = { tone: 'done' | 'active' | 'bad'; title: string; badge: string; sub: string; date?: string; by?: string };
                  const base: TL[] = versions.length === 0
                    ? [{ tone: 'active', title: 'Draft Submitted', badge: 'Pending', sub: 'Agreement drafted & submitted for internal review' }]
                    : versions.map(v => {
                        const meta = ctcTimelineMeta(v.status);
                        const reason = (v as { reason?: string }).reason;
                        return { tone: meta.tone, title: meta.title, badge: v.status || meta.title, sub: reason && !v.label.includes(reason) ? `${v.label} — ${reason}` : v.label, date: v.date, by: v.by };
                      });
                  // One "Requested" item per query + a "Answered" item when the
                  // sender has replied. (Stored clarifications carry a date only,
                  // no time, so they can't be reliably interleaved by timestamp.)
                  const clarItems: TL[] = clarifications.flatMap(c => {
                    const items: TL[] = [{ tone: 'active', title: 'Clarification Requested', badge: 'Clarification', sub: c.query || 'The approver requested clarification before deciding.', date: c.date, by: apprName }];
                    if (c.response) items.push({ tone: 'done', title: 'Clarification Answered', badge: 'Responded', sub: c.response, date: c.date });
                    return items;
                  });
                  // Clarifications happen during review, between submission and the
                  // final approve/reject outcome — slot them in just before the
                  // last (terminal) version item.
                  const tl: TL[] = clarItems.length === 0 || base.length <= 1
                    ? [...base, ...clarItems]
                    : [...base.slice(0, base.length - 1), ...clarItems, base[base.length - 1]];
                  return tl.map((it, i) => (
                    <TimelineItem key={i} t={t} tone={it.tone} title={it.title} badge={it.badge} sub={it.sub} date={it.date} by={it.by} last={i === tl.length - 1} />
                  ));
                })()}
              </div>
            </div>
            </>)}
          </div>
        </div>
      </div>

      {vhOpen && <VersionHistoryModal t={t} code={code} workingId={workingId} versions={versions} onClose={() => setVhOpen(false)} />}
      {signingOpen && <SendForSigningModal t={t} cps={cps} org={org} code={code} title={agTitle} onClose={() => setSigningOpen(false)} onSend={(recipients, days) => { setSigningOpen(false); onSendForSigning(recipients, days); }} />}
      {signedCelebrationOpen && (
        <div onClick={() => setSignedCelebrationOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,7,50,.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Rubik',system-ui,sans-serif", overflow: 'hidden' }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', zIndex: 1, width: 'min(330px,90vw)', background: '#fff', borderRadius: 22, padding: '28px 26px 22px', textAlign: 'center', boxShadow: '0 40px 90px rgba(8,3,28,.4)', border: '1.5px solid #A7F3D0', animation: 'ataSlideUp .26s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ fontSize: 44, lineHeight: 1 }}>🎉</div>
            <div style={{ width: 56, height: 56, borderRadius: 16, margin: '14px auto 0', background: 'linear-gradient(135deg,#059669,#10B981)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 26px rgba(16,185,129,.45)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e1b4b', marginTop: 16, letterSpacing: '-.3px' }}>Agreement Signed! 🎉</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#059669', marginTop: 5 }}>All parties have signed the agreement</div>
            <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 8, lineHeight: 1.55, maxWidth: 270, marginInline: 'auto' }}>The agreement is now legally binding and ready to be moved to the Final Contract Repository.</div>
            <button onClick={() => { setSignedCelebrationOpen(false); onMoveToRepository(); }} style={{ width: '100%', marginTop: 20, padding: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#5B21B6,#6D28D9,#7C3AED)', color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: '0 6px 18px rgba(109,40,217,.4)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Move to Final Contract Repository
            </button>
            <button onClick={() => setSignedCelebrationOpen(false)} style={{ width: '100%', marginTop: 8, padding: 11, borderRadius: 12, border: '1.5px solid #DDD6FE', background: '#F5F0FF', color: '#6D28D9', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Stay in Stage 3</button>
          </div>
          {/* Confetti rain — continuous (infinite), above the card (pointerEvents none). */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', overflow: 'hidden' }}>
            {Array.from({ length: 90 }).map((_, i) => {
              const colors = ['#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06b6d4', '#EC4899', '#A78BFA', '#34d399', '#FBBF24', '#38bdf8'];
              const left = (i * 1.13) % 100;
              const delay = (i % 16) * 0.16;
              const dur = 2.6 + (i % 6) * 0.45;
              const anim = `confettiFall ${dur}s linear ${delay}s infinite`;
              // ~1 golden star for every 5 other pieces, and kept small.
              if (i % 6 === 0) {
                const ssize = 10 + (i % 2) * 2;
                return <span key={i} style={{ position: 'absolute', top: -24, left: `${left}%`, color: '#FFC400', fontSize: ssize, lineHeight: 1, textShadow: '0 0 4px rgba(251,191,36,.6)', animation: anim }}>★</span>;
              }
              const c = colors[i % colors.length];
              const size = 5 + (i % 5) * 2;
              const round = i % 3 === 1;
              return <span key={i} style={{ position: 'absolute', top: -24, left: `${left}%`, width: size, height: round ? size : size * 0.55, background: c, borderRadius: round ? '50%' : 2, opacity: 0.92, animation: anim }} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Send for Signing & Negotiation — pick recipients (counterparties + contact + days) ── */
type SignContact = { name: string; email: string; designation: string; phone: string; is_primary: boolean };
function SendForSigningModal({ t, cps, org, code, title, onClose, onSend }: { t: OpsTokens; cps: CP[]; org: Org | null; code: string; title: string; onClose: () => void; onSend: (recipients: { name: string; email: string; role: string; contact: string }[], days: number | null) => void }) {
  const toast = useToast();
  const [contacts, setContacts] = useState<SignContact[][]>(() => cps.map(() => []));
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [days, setDays] = useState('14');

  // For each counterparty, pull the contact persons captured on its own form
  // (customer / consignee / vendor addresses). Primary contacts pre-selected.
  useEffect(() => {
    let alive = true;
    Promise.all(cps.map(cp => {
      if (cp.sourceId === undefined || cp.sourceId === null || !cp.sourceType) return Promise.resolve([] as SignContact[]);
      return api.get('/clm/ctc-contracts/contact-persons', { params: { type: cp.sourceType, id: cp.sourceId } })
        .then(r => ((r.data?.data ?? []) as SignContact[])).catch(() => [] as SignContact[]);
    })).then(results => {
      if (!alive) return;
      const norm = results.map((list, i) => list.length ? list : (cps[i].email ? [{ name: cps[i].name, email: cps[i].email, designation: 'Primary Contact', phone: cps[i].phone, is_primary: true }] : []));
      setContacts(norm);
      const pre = new Set<string>();
      norm.forEach((list, i) => list.forEach((c, j) => { if (c.is_primary || j === 0) pre.add(`${i}:${j}`); }));
      setSel(pre);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const badgeTone = (badge: string) => badge === 'SUPPLIER' ? { fg: t.dark ? '#6ee7b7' : '#059669' } : badge === 'CONSIGNEE' ? { fg: t.dark ? '#67e8f9' : '#0891b2' } : { fg: t.dark ? '#c4b5fd' : '#7C3AED' };
  const submit = () => {
    const recipients = cps.map((cp, i) => {
      const chosen = (contacts[i] || []).filter((_, j) => sel.has(`${i}:${j}`));
      if (!chosen.length) return null;
      const primary = chosen[0];
      return { name: cp.name, email: primary.email || cp.email, role: cp.badge || 'Counterparty', contact: chosen.map(c => c.name).filter(Boolean).join(', ') };
    }).filter(Boolean) as { name: string; email: string; role: string; contact: string }[];
    if (!recipients.length) { toast.error('No recipients', 'Select at least one contact person to notify.'); return; }
    onSend(recipients, days ? Number(days) : null);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,7,50,.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Rubik',system-ui,sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(500px,94vw)', maxHeight: '88vh', background: t.surface, borderRadius: 20, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}`, boxShadow: '0 40px 80px rgba(109,40,217,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '16px 20px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(120deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg></div>
            <div><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Send for Signature &amp; Negotiation · {code}</div><div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-.3px', marginTop: 1 }}>{title || 'Agreement'}</div><div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg><span style={{ fontSize: 9, color: 'rgba(255,255,255,.72)', fontWeight: 500 }}>Sent via secure e-sign link · All parties notified</span></div></div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {/* body */}
        <div className="ctc-mid-scroll ctc-noshrink" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg><span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#a78bfa' : '#6D28D9' }}>Select Recipients &amp; Contact Persons</span></div>
          {cps.length === 0 && <div style={{ fontSize: 11, color: t.textMuted, textAlign: 'center', padding: 24 }}>No counterparties on this agreement. Add them in Stage 1 first.</div>}
          {cps.map((cp, i) => {
            const tone = badgeTone(cp.badge);
            const list = contacts[i] || [];
            return (
              <div key={i} style={{ borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.surface, overflow: 'hidden', boxShadow: '0 3px 12px rgba(109,40,217,.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: t.dark ? 'rgba(124,58,237,.08)' : '#FAFBFF', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.15)' : '#F1EEFF'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 11, background: `linear-gradient(135deg,${cp.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{cp.initials}</span></div>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cp.name}</div><div style={{ fontSize: 9, fontWeight: 600, color: tone.fg, marginTop: 1 }}>Counter Party {i + 1} · Will receive agreement</div></div>
                  </div>
                  <span style={{ padding: '4px 11px', borderRadius: 20, border: `1.5px solid ${tone.fg}55`, fontSize: 8.5, fontWeight: 800, color: tone.fg, flexShrink: 0 }}>Will receive</span>
                </div>
                <div style={{ padding: '10px 14px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg><span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.textMuted }}>Select Contact Persons to Notify</span></div>
                  {loading ? <div style={{ fontSize: 9.5, color: t.textMuted, padding: '8px 2px' }}>Loading contacts…</div>
                    : list.length === 0 ? <div style={{ fontSize: 9.5, color: t.textMuted, padding: '8px 2px' }}>No contact persons found on this party's form.</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {list.map((c, j) => {
                          const k = `${i}:${j}`; const on = sel.has(k);
                          return (
                            <div key={j} onClick={() => toggle(k)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', border: `1.5px solid ${on ? `${tone.fg}66` : (t.dark ? 'rgba(148,163,184,.18)' : '#EDE9FE')}`, background: on ? (t.dark ? 'rgba(124,58,237,.1)' : '#F7F4FF') : t.surface }}>
                              <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${on ? tone.fg : (t.dark ? 'rgba(148,163,184,.4)' : '#CBD5E1')}`, background: on ? `linear-gradient(135deg,${cp.grad})` : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</div>
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${cp.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>C{j + 1}</span></div>
                              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 10.5, fontWeight: 600, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || `Contact ${j + 1}`}</div><div style={{ fontSize: 8, color: t.textMuted, fontWeight: 600 }}>{c.designation || (c.is_primary ? 'Primary Contact' : 'Contact')}</div></div>
                              {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg><span style={{ fontSize: 8.5, color: t.textMuted, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{c.email}</span></div>}
                            </div>
                          );
                        })}
                      </div>}
                </div>
              </div>
            );
          })}
          {/* Our Organisation — always the initiator, signs first. */}
          {org && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0'}`, background: t.dark ? 'rgba(16,185,129,.10)' : 'linear-gradient(110deg,#ECFDF5,#F0FDF9)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#059669,#10B981)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{orgInitials(org.name)}</span></div>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.name}</div><div style={{ fontSize: 9, fontWeight: 600, color: t.dark ? '#6ee7b7' : '#059669', marginTop: 1 }}>Our Organisation · Signs first · Always included</div></div>
              </div>
              <span style={{ padding: '4px 11px', borderRadius: 20, border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.5)' : '#6EE7B7'}`, fontSize: 8.5, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669', flexShrink: 0 }}>Initiator</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF' }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 9.5, fontWeight: 600, color: t.textStrong }}>Days to Sign</div><div style={{ fontSize: 8, color: t.textMuted, marginTop: 1 }}>Deadline for all parties to complete signing</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setDays(String(Math.max(1, (Number(days) || 14) - 1)))} style={{ width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 15, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>−</button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 15, fontWeight: 800, color: t.textStrong }}>{days}</span>
              <button onClick={() => setDays(String(Math.min(365, (Number(days) || 14) + 1)))} style={{ width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 15, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>+</button>
            </div>
          </div>
        </div>
        {/* footer */}
        <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 600, color: t.textMuted }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>Sent via secure e-sign link</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.1)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={submit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', color: '#fff', fontSize: 10.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(109,40,217,.4)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send for Signing &amp; Negotiation</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Signed-PDF viewer — renders the executed document as page canvases via pdf.js
   so it scrolls with the parent column (single scrollbar) on a white background,
   instead of the browser's black native PDF chrome inside an iframe. */
function SignedPdfViewer({ t, signatureRequestId, signedUrl }: { t: OpsTokens; signatureRequestId: number | null; signedUrl: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let buf: ArrayBuffer;
        if (signatureRequestId) {
          const res = await api.get(`/clm/signature-requests/${signatureRequestId}/download-file/0`, { responseType: 'blob' });
          buf = await (res.data as Blob).arrayBuffer();
        } else {
          const r = await fetch(signedUrl); buf = await (await r.blob()).arrayBuffer();
        }
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        const wrap = wrapRef.current; if (!wrap) return;
        wrap.innerHTML = '';
        const width = Math.min(640, wrap.clientWidth || 600);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          canvas.style.cssText = 'width:100%;max-width:640px;height:auto;display:block;margin:0 auto 14px;border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,.12);background:#fff;';
          wrap.appendChild(canvas);
          const ctx = canvas.getContext('2d'); if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (cancelled) return;
        }
        setLoading(false);
      } catch { if (!cancelled) { setError(true); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [signatureRequestId, signedUrl]);
  return (
    <div>
      <div ref={wrapRef} />
      {loading && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 0', color: t.textMuted, fontSize: 12, fontWeight: 600 }}><svg className="ctc-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Loading signed document…</div>}
      {error && <div style={{ textAlign: 'center', padding: '40px 0', color: '#dc2626', fontSize: 12, fontWeight: 600 }}>Could not load the signed document.</div>}
    </div>
  );
}

/* Stage 4 right panel — repository status, completed timeline, quick actions. */
function ContractHistoryPanel({ t, draftCount, signedUrl, signatureRequestId, onVersionHistory, onExit }: { t: OpsTokens; draftCount: number; signedUrl?: string; signatureRequestId?: number | null; onVersionHistory: () => void; onExit: () => void }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const downloadSigned = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (signatureRequestId) {
        try {
          const res = await api.get(`/clm/signature-requests/${signatureRequestId}/download-file/0`, { responseType: 'blob' });
          const url = URL.createObjectURL(res.data as Blob);
          const a = document.createElement('a'); a.href = url; a.download = 'signed-agreement.pdf'; document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url); return;
        } catch { /* fall through to direct URL */ }
      }
      if (signedUrl) { window.open(signedUrl, '_blank'); return; }
      toast.info('Not ready yet', 'The signed copy will be available once all parties have signed.');
    } finally {
      setDownloading(false);
    }
  };
  const steps = [
    { title: 'Contract Stored', sub: 'Moved to Final Contract Repository' },
    { title: 'Agreement Signed', sub: 'All parties executed the agreement' },
    { title: 'Sent for Signing', sub: 'Agreement sent via secure e-sign link' },
    { title: 'Internal Approval', sub: 'Agreement approved internally' },
    { title: 'Draft Created', sub: 'Agreement draft authored and reviewed' },
  ];
  const doneBadge = <span style={{ padding: '2px 8px', borderRadius: 20, background: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', border: `1px solid ${t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0'}`, fontSize: 7.5, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669', flexShrink: 0 }}>Done</span>;
  return (
    <>
      {/* Repository status */}
      <div style={{ flexShrink: 0, borderRadius: 12, padding: '13px 14px', background: 'linear-gradient(135deg,#064E3B,#047857,#059669)', boxShadow: '0 6px 18px rgba(5,150,105,.3)' }}>
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.65)' }}>Repository Status</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginTop: 3 }}>Final Contract Repository</div>
        <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,.72)', fontWeight: 500, marginTop: 2 }}>Stored · Searchable · Auditable</div>
      </div>
      {/* completed timeline */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#6ee7b7' : '#047857', margin: '4px 2px 10px' }}>Agreement Timeline</div>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 11 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#059669,#047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(5,150,105,.3)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
              {i < steps.length - 1 && <div style={{ width: 2, height: 20, background: t.dark ? 'rgba(16,185,129,.3)' : '#A7F3D0', margin: '3px 0' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: i < steps.length - 1 ? 8 : 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: t.textStrong }}>{s.title}</span>{doneBadge}
              </div>
              <div style={{ fontSize: 8.5, color: t.textMuted, fontWeight: 500, marginTop: 2 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>
      {/* quick actions */}
      <div style={{ flexShrink: 0, borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.25)' : '#A7F3D0'}`, background: t.surface }}>
        <div style={{ padding: '7px 12px', background: t.dark ? 'rgba(16,185,129,.12)' : 'linear-gradient(110deg,#D1FAE5,#ECFDF5)' }}><span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#6ee7b7' : '#047857' }}>Quick Actions</span></div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onVersionHistory} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></div>
            <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontSize: 9.5, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Version History</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#A78BFA', marginTop: 1 }}>View all drafts &amp; revisions</div></div>
            <span style={{ padding: '2px 8px', borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 7.5, fontWeight: 800, color: '#fff', flexShrink: 0 }}>v{draftCount || 1}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#C4B5FD'} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          {/* Download the fully-signed copy */}
          <button onClick={downloadSigned} disabled={!signedUrl || downloading} title={signedUrl ? '' : 'Available once all parties have signed'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px', borderRadius: 10, border: 'none', background: (signedUrl && !downloading) ? 'linear-gradient(135deg,#059669,#047857)' : (t.dark ? 'rgba(255,255,255,.06)' : '#E2E8F0'), cursor: (!signedUrl || downloading) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: (signedUrl && !downloading) ? '0 4px 12px rgba(5,150,105,.3)' : 'none' }}>
            {downloading
              ? <><svg className="ctc-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>Downloading…</span></>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={signedUrl ? '#fff' : (t.dark ? '#94a3b8' : '#94A3B8')} strokeWidth="2.3" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg><span style={{ fontSize: 10, fontWeight: 800, color: signedUrl ? '#fff' : (t.dark ? '#94a3b8' : '#94A3B8') }}>{signedUrl ? 'Download Signed Copy' : 'Awaiting Signed Copy'}</span></>}
          </button>
          {/* Back to the CTC list */}
          <button onClick={onExit} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.1)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back to CTC List
          </button>
        </div>
      </div>
    </>
  );
}

/* Map a stored version status → a timeline title + dot colour tone. */
function ctcTimelineMeta(status: string): { title: string; tone: 'done' | 'active' | 'bad' } {
  switch ((status || '').toLowerCase()) {
    case 'approved':        return { title: 'Approved', tone: 'done' };
    case 'signed':          return { title: 'Signed', tone: 'done' };
    case 'rejected':        return { title: 'Rejected', tone: 'bad' };
    case 'declined':        return { title: 'Declined', tone: 'bad' };
    case 'sent for signing':return { title: 'Sent for Signing', tone: 'active' };
    case 'approving':       return { title: 'Partial Approval', tone: 'active' };
    case 'under review':    return { title: 'Submitted for Review', tone: 'active' };
    default:                return { title: status || 'Update', tone: 'active' };
  }
}

function TimelineItem({ t, tone, title, badge, sub, date, by, last }: { t: OpsTokens; tone: 'done' | 'active' | 'bad'; title: string; badge: string; sub: string; date?: string; by?: string; last?: boolean }) {
  const c = tone === 'done' ? '#059669' : tone === 'bad' ? '#DC2626' : '#7C3AED';
  const grad = tone === 'done' ? '#059669,#047857' : tone === 'bad' ? '#EF4444,#DC2626' : '#7C3AED,#5B21B6';
  const badgeBg = tone === 'done' ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : tone === 'bad' ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEF2F2') : (t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)');
  const badgeFg = tone === 'done' ? (t.dark ? '#6ee7b7' : '#059669') : tone === 'bad' ? (t.dark ? '#fca5a5' : '#DC2626') : (t.dark ? '#c4b5fd' : '#6D28D9');
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 24 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {tone === 'done'
            ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            : tone === 'bad'
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              : <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,.9)' }} />}
        </div>
        {!last && <div style={{ width: 2, height: 28, background: `linear-gradient(180deg,${c},${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'})`, margin: '3px 0' }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: c }}>{title}</div>
          <span style={{ fontSize: 7, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badgeBg, color: badgeFg, whiteSpace: 'nowrap', flexShrink: 0 }}>{badge}</span>
        </div>
        <div style={{ fontSize: 8, color: t.textMuted, lineHeight: 1.55 }}>{sub}</div>
        {(date || by) && (
          <div style={{ fontSize: 7.5, color: t.textMuted, fontWeight: 700, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, opacity: .9 }}>
            {date && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{date}</span>}
            {date && by && <span style={{ opacity: .5 }}>·</span>}
            {by && <span>{by}</span>}
          </div>
        )}
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

/* Stage 4 — Contract Summary card: agreement-id hero, fully-executed banner,
 * summary rows + stage pill, and the signed parties. */
function ContractSummaryCard({ t, code, agTitle, agType, cps, org, effDate, endDate, executedOn, signers }: { t: OpsTokens; code: string; agTitle: string; agType: string; cps: CP[]; org: Org | null; effDate: string; endDate: string; executedOn: string; signers: SignRecipient[] }) {
  const cp1 = cps[0] ?? null;
  const rows: [string, string][] = [
    ['Agreement', agTitle || '—'], ['Type', agType || '—'],
    ['Counterparty', cp1?.name || '—'], ['Organisation', org?.name || '—'],
    ['Eff. Date', effDate || '—'], ['End Date', endDate || '—'], ['Executed On', executedOn || '—'],
  ];
  const parties = signers.length
    ? signers.map((s, i) => ({ role: i === 0 ? 'Disclosing Party' : 'Receiving Party', name: s.name, signed: !!s.signed }))
    : [{ role: 'Disclosing Party', name: cp1?.name || '—', signed: true }, { role: 'Receiving Party', name: org?.name || cps[1]?.name || '—', signed: true }];
  return (
    <>
      <div style={{ flexShrink: 0, position: 'relative', overflow: 'hidden', borderRadius: 14, padding: '10px 16px', background: 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', boxShadow: '0 6px 20px rgba(109,40,217,.3)' }}>
        <div style={{ position: 'absolute', bottom: -14, right: 6, fontSize: 54, fontWeight: 900, color: 'rgba(255,255,255,.1)', lineHeight: 1, pointerEvents: 'none' }}>04</div>
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Agreement ID</div>
        <div style={{ fontSize: 19, fontWeight: 900, color: '#fff', letterSpacing: '-.5px', margin: '2px 0 1px' }}>{code}</div>
        <div style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,.72)' }}>{agType || agTitle || '—'}</div>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0'}`, background: t.dark ? 'rgba(16,185,129,.1)' : '#ECFDF5' }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#059669,#047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
        <div><div style={{ fontSize: 10.5, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#047857' }}>Fully Executed</div><div style={{ fontSize: 8.5, color: t.dark ? '#34d399' : '#059669', fontWeight: 500 }}>All parties have signed · Legally binding</div></div>
      </div>
      <div style={{ flexShrink: 0, borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE'}`, background: t.surface }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', background: i % 2 ? (t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF') : 'transparent', borderBottom: `1px solid ${t.dark ? 'rgba(148,163,184,.08)' : '#F4F1FF'}` }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>{k}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: t.textStrong, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF' }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Stage</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', border: `1px solid ${t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0'}`, fontSize: 8, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>Stage 4 — Repository</span>
        </div>
      </div>
      <div style={{ flexShrink: 0, borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE'}`, background: t.surface }}>
        <div style={{ padding: '7px 12px', background: t.dark ? 'rgba(124,58,237,.12)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)' }}><span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Parties</span></div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {parties.map((p, i) => {
            const grad = i === 0 ? '#4C1D95,#6D28D9,#7C3AED' : '#047857,#059669,#10b981';
            const roleClr = i === 0 ? (t.dark ? '#c4b5fd' : '#7C3AED') : (t.dark ? '#6ee7b7' : '#059669');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>{p.role.split(' ').map(w => w[0]).join('').slice(0, 2)}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 7.5, fontWeight: 800, color: roleClr, textTransform: 'uppercase', letterSpacing: '.06em' }}>{p.role}</div><div style={{ fontSize: 10.5, fontWeight: 700, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div></div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 8, background: p.signed ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7'), fontSize: 7.5, fontWeight: 800, color: p.signed ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#fcd34d' : '#D97706'), flexShrink: 0 }}>{p.signed && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}{p.signed ? 'Signed' : 'Pending'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function CpReadCard({ t, idx, cp }: { t: OpsTokens; idx: number; cp: CP }) {
  return (
    <div style={{ flexShrink: 0, background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 4px 16px rgba(109,40,217,.08)' }}>
      <div style={{ background: `radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,${cp.badge === 'BUYER' ? '#0e7490,#0891b2,#06b6d4' : cp.badge === 'SUPPLIER' ? '#047857,#059669,#10b981' : '#4C1D95,#6D28D9,#7C3AED'})`, backgroundSize: '14px 14px, auto', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>Counter Party {idx}</span>
          {cp.badge && <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.35)', color: '#fff', textTransform: 'uppercase' }}>{cp.badge === 'BUYER' ? 'CUSTOMER' : cp.badge}</span>}
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
function RightTools({ t, draft, onInsert, summary, declineReason, declinedBy, active = true }: { t: OpsTokens; draft: string; onInsert: (tok: string) => void; summary: string[][]; declineReason?: string; declinedBy?: string; active?: boolean }) {
  // Grammarly-style live review: score = % of words spelled correctly, with
  // the flagged misspellings (and suggestions) listed below the score.
  const { score, words, issues } = checkSpelling(draft);
  const clean = score >= 90, mild = score >= 60 && score < 90;
  const scoreClr = words === 0 ? '#EF4444' : clean ? (t.dark ? '#6ee7b7' : '#059669') : mild ? (t.dark ? '#fcd34d' : '#D97706') : (t.dark ? '#fca5a5' : '#DC2626');
  const statusLabel = words === 0 ? 'Not Started' : clean ? 'Looks Clean' : mild ? 'Minor Issues' : 'Needs Review';
  const statusBg = words === 0 ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEF2F2') : clean ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : mild ? (t.dark ? 'rgba(245,158,11,.16)' : '#FFFBEB') : (t.dark ? 'rgba(239,68,68,.16)' : '#FEF2F2');
  const statusBd = words === 0 ? (t.dark ? 'rgba(239,68,68,.4)' : '#FECACA') : clean ? (t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0') : mild ? (t.dark ? 'rgba(245,158,11,.4)' : '#FDE68A') : (t.dark ? 'rgba(239,68,68,.4)' : '#FECACA');
  // Tokens auto-fill from the "Our Organisation" (Company Details master) row
  // at agreement generation — see CtcContractController::downloadVersion.
  const FIELDS = [['SIGNATURE', 'signature'], ['COMPANY NAME', 'company_name'], ['COMPANY NO', 'company_no'], ['EMAIL', 'email'], ['CONTACT NO', 'contact_no'], ['ADDRESS', 'address']];
  // Signature is a one-time placeholder — once {{signature}} is in the draft
  // its tile is locked so it can't be inserted a second time.
  const sigUsed = /\{\{\s*signature\s*\}\}/i.test(draft);
  const cardBd = `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`;
  return (
    <div className="ctc-mid-scroll ctc-noshrink" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Signer decline remark — shown while revising the draft to address it */}
      {(declineReason || declinedBy) && (
        <div style={{ borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(239,68,68,.4)' : '#FECACA'}`, background: t.dark ? 'rgba(239,68,68,.1)' : '#FEF2F2', overflow: 'hidden', boxShadow: '0 2px 10px rgba(239,68,68,.08)' }}>
          <div style={{ padding: '7px 11px', background: t.dark ? 'rgba(239,68,68,.16)' : 'linear-gradient(110deg,#FEE2E2,#FEF2F2)', borderBottom: `1px solid ${t.dark ? 'rgba(239,68,68,.3)' : '#FECACA'}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#fca5a5' : '#DC2626'} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#fca5a5' : '#DC2626' }}>Declined by {declinedBy || 'a signer'}</span>
          </div>
          <div style={{ padding: '9px 11px' }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Signer's remark — revise the draft to address it</div>
            <div style={{ fontSize: 10, color: t.dark ? '#fecaca' : '#991B1B', lineHeight: 1.55, fontWeight: 500 }}>{declineReason ? `“${declineReason}”` : 'No remark was provided.'}</div>
          </div>
        </div>
      )}
      {/* Placeholder fields — only insertable on Step 3 (the editor step).
          Disabled + dimmed on Steps 1–2 so a click can't mutate the draft
          before the editor is active. */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden', boxShadow: '0 2px 10px rgba(109,40,217,.07)', opacity: active ? 1 : 0.55 }}>
        <div style={{ padding: '9px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
          <div><div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Standard Placeholder Fields</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>{active ? 'Click a field to insert into the editor' : 'Available in Step 3 — open the draft editor first'}</div></div>
        </div>
        <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          {FIELDS.map(([lbl, tok]) => {
            const lockedSig = tok === 'signature' && sigUsed;   // one-time signature
            const off = !active || lockedSig;
            return (
            <button key={tok} disabled={off} onClick={() => { if (!off) onInsert(`{{${tok}}}`); }} title={lockedSig ? 'Signature already added — only one is allowed' : (active ? '' : 'Available in Step 3')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${lockedSig ? (t.dark ? 'rgba(16,185,129,.4)' : '#a7f3d0') : (t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE')}`, background: lockedSig ? (t.dark ? 'rgba(16,185,129,.10)' : '#f0fdf4') : (t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF'), cursor: off ? 'not-allowed' : 'pointer', opacity: lockedSig ? 0.85 : 1, fontFamily: 'inherit' }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: lockedSig ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#cbd5e1' : '#475569') }}>{lbl}</span>
              {lockedSig
                ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#6ee7b7' : '#059669'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#A78BFA'} strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>}
            </button>
            );
          })}
        </div>
        <div style={{ padding: '0 10px 10px' }}><div style={{ border: `1px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#C4B5FD'}`, borderRadius: 8, padding: '8px 10px', textAlign: 'center', fontSize: 8.5, fontWeight: 600, color: t.dark ? '#a78bfa' : '#7C3AED' }}>{active ? '✦ Drag to editor or click to insert at cursor' : '✦ Insert becomes available on Step 3'}</div></div>
      </div>

      {/* AI Writing Assistant */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden', boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
        <div style={{ padding: '9px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></svg></div>
          <div><div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>AI Writing Assistant</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Live review as you type</div></div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div><div style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: t.textMuted }}>Quality Score</div><div style={{ fontSize: 24, fontWeight: 900, color: scoreClr }}>{score}<span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted }}>/100</span></div></div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 8.5, fontWeight: 800, background: statusBg, color: scoreClr, border: `1px solid ${statusBd}` }}>{statusLabel}</span>
              <div style={{ fontSize: 8.5, color: t.textMuted, fontWeight: 600, marginTop: 4 }}>{words} words · {issues.length} {issues.length === 1 ? 'issue' : 'issues'}</div>
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: t.dark ? 'rgba(255,255,255,.06)' : '#EDE9FE', overflow: 'hidden' }}><div style={{ height: '100%', width: `${score}%`, background: `linear-gradient(90deg,#7C3AED,${scoreClr})`, transition: 'width .25s' }} /></div>
          {/* Spelling feedback — flagged words with suggestions where known. */}
          {words === 0 ? (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: `1px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, textAlign: 'center', fontSize: 9, fontWeight: 600, color: t.dark ? '#a78bfa' : '#7C3AED' }}>Start typing in the editor to see live spelling review</div>
          ) : issues.length === 0 ? (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0'}`, background: t.dark ? 'rgba(16,185,129,.1)' : '#F0FDF4', display: 'flex', alignItems: 'center', gap: 7, fontSize: 9.5, fontWeight: 700, color: t.dark ? '#6ee7b7' : '#059669' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              No spelling issues found — looks clean.
            </div>
          ) : (
            <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 8, border: `1px solid ${t.dark ? 'rgba(239,68,68,.35)' : '#FECACA'}`, background: t.dark ? 'rgba(239,68,68,.08)' : '#FEF2F2' }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: t.dark ? '#fca5a5' : '#DC2626', marginBottom: 6 }}>{issues.length} possible spelling {issues.length === 1 ? 'issue' : 'issues'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {issues.slice(0, 8).map((iss, i) => (
                  <span key={i} title={iss.suggestion ? `Did you mean “${iss.suggestion}”?` : 'Possible misspelling'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: t.dark ? 'rgba(239,68,68,.14)' : '#fff', border: `1px solid ${t.dark ? 'rgba(239,68,68,.35)' : '#FECACA'}`, color: t.dark ? '#fecaca' : '#B91C1C' }}>
                    <span style={{ textDecoration: 'underline wavy', textDecorationColor: t.dark ? '#f87171' : '#EF4444' }}>{iss.word}</span>
                    {iss.suggestion && <><span style={{ color: t.textMuted }}>→</span><span style={{ color: t.dark ? '#6ee7b7' : '#059669' }}>{iss.suggestion}</span></>}
                  </span>
                ))}
                {issues.length > 8 && <span style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, alignSelf: 'center' }}>+{issues.length - 8} more</span>}
              </div>
            </div>
          )}
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
function Panel({ t, header, title, headGrad, children, onCollapse, collapseDir, icon }: { t: OpsTokens; header: string; title: string; headGrad: string; children: React.ReactNode; onCollapse?: () => void; collapseDir?: 'left' | 'right'; icon?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff 0%,#f5f0fe 35%,#ede8fd 100%)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.28)'}`, boxShadow: '0 6px 32px rgba(109,40,217,.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0, position: 'relative', overflow: 'hidden', background: `radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,${headGrad})`, backgroundSize: '14px 14px, auto', borderRadius: '14px 14px 0 0' }}>
        <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent)', pointerEvents: 'none', borderRadius: '14px 14px 0 0' }} />
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', zIndex: 1 }}>{icon ?? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>}</div>
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

function CpCard({ t, slot, cp, onRemove, readOnly }: { t: OpsTokens; slot: number; cp: CP; onRemove?: () => void; readOnly?: boolean }) {
  const badgeGrad = cp.badge === 'BUYER' ? '#0891b2,#0e7490' : cp.badge === 'SUPPLIER' ? '#16A34A,#059669' : '#6D28D9,#4C1D95';
  return (
    <div style={{ flexShrink: 0, borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(110deg,#EDE9FE,#DDD6FE)' }}>
        <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Counter Party {slot}</span>
        {cp.badge && <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: `linear-gradient(135deg,${badgeGrad})`, color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em' }}>{cp.badge === 'BUYER' ? 'CUSTOMER' : cp.badge}</span>}
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
        {!readOnly && onRemove && <button onClick={onRemove} style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
      </div>
      <div style={{ borderTop: `1px solid ${t.dark ? 'rgba(148,163,184,.12)' : '#F1EEFF'}`, padding: '5px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <OrgDetail t={t} text={cp.country} /><OrgDetail t={t} text={cp.phone} /><OrgDetail t={t} text={cp.email} />
      </div>
    </div>
  );
}

/* Read-only organisation card matching the Stage-1 left-panel style. */
function OrgMiniCard({ t, org }: { t: OpsTokens; org: Org }) {
  return (
    <div style={{ flexShrink: 0, borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(110deg,#EDE9FE,#DDD6FE)' }}><span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Organisation</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px 6px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${org.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 3px 8px rgba(109,40,217,.3)' }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{org.initials}</span></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong, lineHeight: 1.3 }}>{org.name}</div><div style={{ fontSize: 8.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500, marginTop: 2 }}>{org.sub}</div></div>
      </div>
      <div style={{ borderTop: `1px solid ${t.dark ? 'rgba(148,163,184,.12)' : '#F1EEFF'}`, padding: '5px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <OrgDetail t={t} label="Country" text={org.country} /><OrgDetail t={t} label="State" text={org.state} /><OrgDetail t={t} label="Short Code" text={org.shortCode} />
      </div>
    </div>
  );
}

function OrgDetail({ t, label, text }: { t: OpsTokens; label?: string; text: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /></svg>{label && <span style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>}<span style={{ fontSize: 9, color: t.textSub, fontWeight: 600 }}>{text}</span></div>;
}

function Field({ t, label, green, error, children }: { t: OpsTokens; label: string; green?: boolean; error?: string; children: React.ReactNode }) {
  const labelColor = error ? '#ef4444' : (green ? (t.dark ? '#34d399' : '#059669') : (t.dark ? '#a78bfa' : '#7C3AED'));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: labelColor }}>{label}</label>
      {/* Red ring hugs whatever control sits inside (input / select / date) so a
          single wrapper validates every field type uniformly. */}
      <div style={{ borderRadius: 9, boxShadow: error ? '0 0 0 1.5px #ef4444' : 'none' }}>{children}</div>
      {error && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontWeight: 700, color: '#ef4444' }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {error}
        </span>
      )}
    </div>
  );
}

/* ── Counterparty picker modal ── */
/* ── Stage-1 Step-3 "Submit & Send for Approval" → Review & Approval Workflow popup ── */
type Approver = { name: string; email: string; initials: string; grad: string; tags: [string, string][]; locked: boolean };
function ApprovalWorkflowModal({ t, orgName, onClose, onSubmit }: { t: OpsTokens; orgName: string; onClose: () => void; onSubmit: (data: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }) => Promise<boolean> }) {
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [days, setDays] = useState(7);
  const [reminder, setReminder] = useState(5);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);   // in-flight guard — blocks duplicate submits
  const addApprover = () => setPickerOpen(true);
  // Single-flight submit: disable + show a loader the moment it's clicked so
  // rapid repeat clicks can't fire multiple approval requests. On failure we
  // re-enable; on success the parent advances to Stage 2 and unmounts us.
  const submit = async () => {
    if (submitting || approvers.length === 0) return;
    setSubmitting(true);
    const ok = await onSubmit({ approvers: approvers.map(a => ({ name: a.name, email: a.email, role: a.tags[0]?.[0] ?? '', mandatory: a.locked || a.tags.some(tg => tg[0] === 'Mandatory') })), days, reminder });
    if (!ok) setSubmitting(false);
  };
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
  // Realistic dates: approval starts today, is due after `days`, and the
  // reminder fires `reminder` days before the due date (clamped to ≥ start).
  const fmtD = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const startD = new Date();
  const dueD = new Date(startD); dueD.setDate(dueD.getDate() + days);
  let remindD = new Date(dueD); remindD.setDate(remindD.getDate() - reminder); if (remindD < startD) remindD = new Date(startD);
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,7,50,.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Rubik', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 420, borderRadius: 20, overflow: 'hidden', boxShadow: '0 40px 80px rgba(109,40,217,.3)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}` }}>
        {/* header */}
        <div style={{ background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#3B0764,#5B21B6,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          {/* Realistic timeline derived from the steppers above */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 11px', borderRadius: 10, background: t.dark ? 'rgba(124,58,237,.10)' : '#F6F3FF', border: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#E4DEFF'}` }}>
            {([['Starts', startD, '#7C3AED'], ['Due by', dueD, '#0891b2'], ['Reminder', remindD, '#D97706']] as [string, Date, string][]).map(([lbl, d, c], i) => (
              <div key={lbl} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }}>
                <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#a78bfa' : c, marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap' }}>{fmtD(d)}</div>
              </div>
            ))}
          </div>
          {/* submit */}
          <button disabled={approvers.length === 0 || submitting} onClick={submit} title={approvers.length === 0 ? 'Add at least one approver' : ''} style={{ width: '100%', padding: 11, borderRadius: 11, border: 'none', background: (approvers.length === 0 || submitting) ? (t.dark ? 'rgba(124,58,237,.25)' : '#C4B5FD') : 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', color: '#fff', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: (approvers.length === 0 || submitting) ? 'not-allowed' : 'pointer', opacity: (approvers.length === 0 || submitting) ? .6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: (approvers.length === 0 || submitting) ? 'none' : '0 4px 14px rgba(109,40,217,.4)' }}>
            {submitting
              ? <svg className="ctc-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
            {submitting ? 'Submitting…' : 'Submit for Approval'}
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
  const toast = useToast();
  type Emp = { name: string; email: string; title: string; role: string; roleFg: string; initials: string; grad: string; branch: string };
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
          return { name, email: String(e.email ?? ''), title, role, roleFg, initials: orgInitials(name), grad: ORG_GRADS[i % ORG_GRADS.length], branch: branchName };
        }));
        setLoading(false);
      })
      .catch(() => { if (alive) { setEmps([]); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  const q = search.trim().toLowerCase();
  const list = q ? emps.filter(e => (e.name + e.role + e.title + e.email).toLowerCase().includes(q)) : emps;
  const keyOf = (e: Emp) => e.email || e.name;
  // All approvers must belong to the SAME branch — lock to the branch of the
  // first selected (branch-scoped) person; client-level entries (no branch)
  // never lock and are never locked out.
  const selBranch = emps.find(e => sel.has(keyOf(e)) && e.branch)?.branch ?? '';
  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const confirm = () => {
    const picked: Approver[] = emps.filter(e => sel.has(keyOf(e))).map(e => ({ name: e.name, email: e.email, initials: e.initials, grad: e.grad, tags: e.role ? [[e.role, e.roleFg]] as [string, string][] : [], locked: false }));
    onAdd(picked);
  };
  const roleBg = (fg: string) => t.dark ? fg + '28' : fg + '1f';
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 99999999, background: 'rgba(15,7,50,.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Rubik', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 40px 80px rgba(109,40,217,.3)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}` }}>
        <div style={{ background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#5B21B6,#6D28D9,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg></div>
            <div><div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Select Approvers</div><div style={{ fontSize: 8.5, color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>Same branch only — select multiple</div></div>
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
            // Different branch than the one already chosen → not selectable.
            const crossBranch = !on && !!e.branch && !!selBranch && e.branch !== selBranch;
            const blocked = already || crossBranch;
            return (
              <div key={k} onClick={() => { if (already) return; if (crossBranch) { toast.warning('Same branch only', 'All approvers must be from the same branch.'); return; } toggle(k); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 12, border: `1.5px solid ${on ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')}`, background: blocked ? (t.dark ? 'rgba(255,255,255,.02)' : '#F8FAFC') : on ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : t.surface, cursor: crossBranch ? 'not-allowed' : already ? 'not-allowed' : 'pointer', opacity: blocked ? .5 : 1 }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${on || already ? '#7C3AED' : (t.dark ? 'rgba(148,163,184,.4)' : '#C4B5FD')}`, background: on || already ? '#7C3AED' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(on || already) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</div>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${e.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{e.initials}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><span style={{ fontSize: 12.5, fontWeight: 800, color: t.textStrong }}>{e.name}</span>{e.role && <span style={{ padding: '1px 7px', borderRadius: 5, background: roleBg(e.roleFg), border: `1px solid ${e.roleFg}55`, fontSize: 7.5, fontWeight: 800, color: e.roleFg, letterSpacing: '.04em' }}>{e.role}</span>}{already && <span style={{ fontSize: 8, fontWeight: 700, color: t.textMuted }}>· added</span>}{crossBranch && <span style={{ fontSize: 8, fontWeight: 700, color: '#D97706' }}>· other branch</span>}</div>
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

function CpPicker({ t, slot, usedTypes = [], onClose, onPick }: { t: OpsTokens; slot: number; usedTypes?: string[]; onClose: () => void; onPick: (cp: CP) => void }) {
  // Types already added to this agreement — their tabs are disabled so only one
  // Customer (buyer) / Consignee / Supplier can ever be selected.
  const used = new Set(usedTypes.map(s => s.toLowerCase()));
  const firstAvail = (['buyer', 'consignee', 'supplier'] as const).find(tb => !used.has(tb)) ?? 'buyer';
  const [tab, setTab] = useState<'buyer' | 'consignee' | 'supplier'>(firstAvail);
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
    ? { label: 'Customer', bg: t.dark ? 'rgba(8,145,178,.18)' : '#E0F7FA', bd: t.dark ? 'rgba(6,182,212,.4)' : '#A5F3FC', fg: t.dark ? '#67e8f9' : '#0891b2' }
    : tab === 'supplier'
      ? { label: 'Supplier', bg: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', bd: t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0', fg: t.dark ? '#6ee7b7' : '#059669' }
      : { label: 'Consignee', bg: t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE', bd: t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD', fg: t.dark ? '#c4b5fd' : '#7C3AED' };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,5,40,.42)', backdropFilter: 'blur(6px)' }} />
      <div style={{ position: 'relative', zIndex: 1, width: pending ? 440 : 460, maxWidth: 'calc(100vw - 32px)', background: t.surface, borderRadius: 16, boxShadow: '0 10px 48px rgba(109,40,217,.32)', overflow: 'hidden', fontFamily: "'Rubik', system-ui, sans-serif" }}>
        <div style={{ background: 'linear-gradient(118deg,#4C1D95,#6D28D9,#8B5CF6)', padding: '12px 14px 11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{pending ? `Confirm CP ${slot}` : `Add Counter Party ${slot}`}</div>
          <button onClick={onClose} style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {!pending ? (
          <div style={{ padding: '10px 12px 12px' }}>
            <div style={{ display: 'flex', gap: 3, background: t.dark ? 'rgba(255,255,255,.05)' : '#F3F0FD', borderRadius: 9, padding: 3, marginBottom: 9 }}>
              {(['buyer', 'consignee', 'supplier'] as const).map(tb => {
                const isUsed = used.has(tb);
                return (
                  <button key={tb} disabled={isUsed} onClick={() => { if (isUsed) return; setTab(tb); setSearch(''); }}
                    title={isUsed ? 'Already added — only one allowed' : undefined}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: isUsed ? 'not-allowed' : 'pointer', opacity: isUsed ? .4 : 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, textTransform: 'capitalize', background: tab === tb && !isUsed ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'transparent', color: tab === tb && !isUsed ? '#fff' : t.textMuted, boxShadow: tab === tb && !isUsed ? '0 2px 6px rgba(109,40,217,.3)' : 'none' }}>
                    {tb === 'buyer' ? 'Customer' : tb}{isUsed ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width: '100%', padding: '10px 12px 10px 32px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'min(60vh, 440px)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {list.map(p => (
                <div key={p.id} onClick={() => { setPending(p); setReferred(p.name); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', borderRadius: 10, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${p.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{p.initials}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={{ flexShrink: 0, fontFamily: "'Geist Mono', monospace", fontSize: 9.5, fontWeight: 800, color: tabBadge.fg, background: tabBadge.bg, border: `1px solid ${tabBadge.bd}`, padding: '2px 7px', borderRadius: 6, letterSpacing: '.02em' }}>{p.id}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: tabBadge.fg, background: tabBadge.bg, border: `1px solid ${tabBadge.bd}`, padding: '2px 8px', borderRadius: 20 }}>{tabBadge.label}</span>
                      <span style={{ fontSize: 10.5, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.country}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!list.length && <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 12, color: t.textMuted }}>{loading ? 'Loading…' : `No ${tab === 'buyer' ? 'customer' : tab}s found`}</div>}
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
              <button onClick={() => onPick({ name: pending.name, initials: pending.initials, country: pending.country, phone: pending.phone, email: pending.email, grad: pending.grad, badge: tab.toUpperCase(), referred: referred || pending.name, sourceType: tab, sourceId: pending.id })} style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, color: '#fff', boxShadow: '0 3px 12px rgba(109,40,217,.38)' }}>Confirm &amp; Add</button>
              <button onClick={() => setPending(null)} style={{ padding: '8px 13px', borderRadius: 8, background: t.dark ? 'rgba(255,255,255,.05)' : '#F8F6FF', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600, color: t.textSub }}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CTC_FORM_CSS = `
/* Keep cards/rows in a flex-column scroll list at their natural height — without
   this, children with overflow:hidden get min-height:0 and compress to fit
   instead of overflowing, so the scrollbar never appears. */
.ctc-noshrink > * { flex-shrink: 0; }
/* Default browser scrollbar — no custom colour. */
.ctc-editor { overflow-wrap: anywhere; word-break: break-word; }
.ctc-editor:empty:before { content: attr(data-ph); color: #94a3b8; pointer-events: none; white-space: pre-wrap; }
.ctc-editor h1, .ctc-editor h2, .ctc-editor h3 { font-weight: 800; margin: 8px 0 4px; }
.ctc-editor ul, .ctc-editor ol { padding-left: 22px; margin: 6px 0; }
.ctc-spin { animation: ctcSpin .7s linear infinite; }
@keyframes ctcSpin { to { transform: rotate(360deg); } }
@keyframes ataSlideUp { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes confettiFall { 0% { transform: translateY(-24px) rotate(0deg); } 100% { transform: translateY(100vh) rotate(560deg); } }
`;
