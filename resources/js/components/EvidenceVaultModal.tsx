import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import ProgressDial from './ui/ProgressDial';
import Tooltip from './ui/Tooltip';
import '../../css/recruitment.css';

type DocStatus = 'Verified' | 'Uploaded' | 'Signed' | 'Sent' | 'Pending' | 'Not Generated' | 'Optional' | 'Generated' | 'Completed';

/** States that mean the document is actually IN the vault — these carry the
 *  green pill and the tick. 'Sent' and 'Pending' deliberately don't: something
 *  is still owed on those. */
const DONE_STATUSES = new Set<DocStatus>(['Uploaded', 'Verified', 'Signed', 'Generated', 'Completed']);

export type VaultTab = 'employee' | 'organizational' | 'exit';

export type EvidenceVaultEmployee = {
  /** employees.id — every fetch below is keyed on it. */
  id: number;
  empId: string;
  name: string;
  department?: string | null;
  designation?: string | null;
};

const DOC_KEY_CATALOGUE: Record<string, { name: string; desc: string; icon: string; iconBg: string; iconFg: string; category: string }> = {
  aadhaar:     { name: 'Aadhaar Card',           desc: 'Government issued 12-digit unique identity',     icon: 'ri-fingerprint-line',         iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Identity'        },
  pan:         { name: 'PAN Card',               desc: 'Permanent Account Number for taxation',          icon: 'ri-bank-card-2-line',         iconBg: '#fef3c7', iconFg: '#92400e', category: 'Identity'        },
  p_photo:     { name: 'Passport Photo',         desc: 'Recent passport-size photograph',                icon: 'ri-camera-line',              iconBg: '#fdd9ea', iconFg: '#a02960', category: 'Identity'        },
  p_copy:      { name: 'Passport Copy',          desc: 'Govt issued travel document (if applicable)',    icon: 'ri-passport-line',            iconBg: '#dceefe', iconFg: '#0c63b0', category: 'Identity'        },
  cur_addr:    { name: 'Current Address Proof',  desc: 'Utility bill or bank statement (last 3 months)', icon: 'ri-home-4-line',              iconBg: '#dcfce7', iconFg: '#15803d', category: 'Address'         },
  perm_addr:   { name: 'Permanent Address Proof',desc: 'Aadhaar / Voter ID — permanent address proof',   icon: 'ri-map-pin-line',             iconBg: '#fee2e2', iconFg: '#b91c1c', category: 'Address'         },
  edu_10:      { name: '10th Marksheet',         desc: 'Secondary school certification',                 icon: 'ri-file-text-line',           iconBg: '#fef3c7', iconFg: '#92400e', category: 'Education'       },
  edu_12:      { name: '12th Marksheet',         desc: 'Higher secondary certification',                 icon: 'ri-file-text-line',           iconBg: '#fef3c7', iconFg: '#92400e', category: 'Education'       },
  edu_deg:     { name: 'Graduation Degree',      desc: "Bachelor's degree certificate",                  icon: 'ri-graduation-cap-line',      iconBg: '#dcfce7', iconFg: '#15803d', category: 'Education'       },
  edu_pg:      { name: 'Post Graduation',        desc: "Master's or postgraduate diploma",               icon: 'ri-award-line',               iconBg: '#dceefe', iconFg: '#0c63b0', category: 'Education'       },
  rel_letter:  { name: 'Relieving Letter',       desc: 'Final relieving from previous employer',         icon: 'ri-mail-send-line',           iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Prev. Employment'},
  exp_cert:    { name: 'Experience Letter',      desc: 'Past employment experience certificate',         icon: 'ri-briefcase-4-line',         iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Prev. Employment'},
  pay_slip:    { name: 'Last 3 Pay Slips',       desc: 'Most recent salary slips for reference',         icon: 'ri-money-rupee-circle-line',  iconBg: '#fef3c7', iconFg: '#92400e', category: 'Prev. Employment'},
};
const labelForDocKey = (key: string) => DOC_KEY_CATALOGUE[key] || {
  name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  desc: 'Uploaded document',
  icon: 'ri-file-text-line',
  iconBg: '#eef2f6',
  iconFg: '#475569',
  category: 'Other',
};

type EmpDocApiRow = {
  id: number;
  document_key: string;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  original_name: string | null;
  url: string | null;
  uploaded_at: string | null;
};
type VaultTemplate = {
  id: number;
  code: string | null;
  name: string | null;
  doc_type: string | null;
  status: string | null;
  /** Original upload name. Null for templates composed in the web editor —
   *  those have no file behind them, so the row shows nothing rather than a
   *  blank slot. */
  docx_original_name?: string | null;
  trigger_point?: { module_name?: string | null } | null;
};
type VaultRun = {
  id: number;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
  template_id: number;
  code?: string | null;
  trigger_keyword?: string | null;
  trigger_point_name?: string | null;
  template?: { name?: string | null; doc_type?: string | null; code?: string | null } | null;
};

export default function EvidenceVaultModal({ employee, onClose, extraChips = [], initialTab = 'employee' }: {
  /** Null closes the modal. */
  employee: EvidenceVaultEmployee | null;
  onClose: () => void;
  /** Caller-specific header pills (Exit passes the last working day). */
  extraChips?: string[];
  initialTab?: VaultTab;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<VaultTab>(initialTab);
  // Which doc row is mid view/download — drives the spinner + blocks a second
  // click (multiple concurrent downloads were hanging the UI).
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'view' | 'download' | null>(null);

  const [empDocs, setEmpDocs]               = useState<EmpDocApiRow[]>([]);
  const [orgTemplates, setOrgTemplates]     = useState<VaultTemplate[]>([]);
  const [exitTemplates, setExitTemplates]   = useState<VaultTemplate[]>([]);
  const [signingRuns, setSigningRuns]       = useState<VaultRun[]>([]);
  const [loading, setLoading]               = useState(false);
  /* Promotion-triggered templates matching the employee's CURRENT department
     and designation. Kept apart from `orgTemplates` (which is onboarding) so
     the signed groups below stay exactly what they were: a record. These are
     the opposite — work still to do. */
  const [promoTemplates, setPromoTemplates] = useState<VaultTemplate[]>([]);
  const [sendingTplId, setSendingTplId]     = useState<number | null>(null);
  /** Bumped after a send so the vault re-reads without closing and reopening. */
  const [reloadKey, setReloadKey]           = useState(0);
  /** Onboarding finished (stage 6 of 6). Gates the promotion block. */
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    if (!employee) {
      setEmpDocs([]); setOrgTemplates([]); setExitTemplates([]); setSigningRuns([]);
      setPromoTemplates([]); setOnboardingDone(false);
      setTab(initialTab);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTab(initialTab);
    Promise.allSettled([
      api.get(`/employees/${employee.id}/documents`),
      api.get('/hr-document-templates/match', { params: { employee_id: employee.id, trigger_keyword: 'onboarding' } }),
      api.get('/hr-document-templates/match', { params: { employee_id: employee.id, trigger_keyword: 'exit' } }),
      api.get('/hr-document-signatures', { params: { employee_id: employee.id } }),
      api.get('/hr-document-templates/match', { params: { employee_id: employee.id, trigger_keyword: 'promotion' } }),
      api.get(`/employees/${employee.id}`),
    ]).then(results => {
      if (cancelled) return;
      const [docsR, orgR, exitR, runsR, promoR, empR] = results;
      setEmpDocs(docsR.status === 'fulfilled' && Array.isArray(docsR.value.data) ? docsR.value.data : []);
      setOrgTemplates(orgR.status === 'fulfilled' && Array.isArray(orgR.value.data?.templates) ? orgR.value.data.templates : []);
      setExitTemplates(exitR.status === 'fulfilled' && Array.isArray(exitR.value.data?.templates) ? exitR.value.data.templates : []);
      setSigningRuns(runsR.status === 'fulfilled' && Array.isArray(runsR.value.data) ? runsR.value.data : []);
      setPromoTemplates(promoR.status === 'fulfilled' && Array.isArray(promoR.value.data?.templates) ? promoR.value.data.templates : []);
      /* Promotion paperwork belongs to life AFTER onboarding — while the
         wizard is still running, its Stage 5 is where documents are sent from.
         Read from the record rather than taken as a prop: this modal opens
         from several places, and one that forgot to pass it would silently
         bring the bug back. Anything unreadable counts as NOT complete, so the
         block stays hidden rather than appearing when we cannot tell. */
      const empRow = empR.status === 'fulfilled' ? (empR.value.data?.data ?? empR.value.data) : null;
      setOnboardingDone(Number(empRow?.onboarding_stage_completed ?? 0) >= 6);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id, reloadKey]);

  const runByTemplateId = useMemo(() => {
    const m = new Map<number, VaultRun>();
    for (const r of signingRuns) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [signingRuns]);

  if (!employee) return null;

  const empDocsView = empDocs.map(d => {
    const cat = labelForDocKey(d.document_key);
    const status: DocStatus =
      d.status === 'verified' ? 'Verified'
      : d.status === 'uploaded' ? 'Uploaded'
      : d.status === 'rejected' ? 'Pending'
      : 'Pending';
    return {
      id: d.id, key: d.document_key, name: cat.name, sub: cat.desc, icon: cat.icon, iconBg: cat.iconBg, iconFg: cat.iconFg,
      // Resolved once here so both View and Download below get an absolute URL.
      category: cat.category, status, url: d.url ? resolveFileUrl(d.url) : null,
    };
  });

  const empGroups = (() => {
    const buckets: Record<string, typeof empDocsView> = {};
    for (const d of empDocsView) {
      const k = d.category || 'Other';
      (buckets[k] = buckets[k] || []).push(d);
    }
    return Object.entries(buckets).map(([title, docs]) => ({
      title,
      icon: docs[0]?.icon || 'ri-folder-line',
      iconBg: docs[0]?.iconBg || '#eef2f6',
      iconFg: docs[0]?.iconFg || '#475569',
      docs,
    }));
  })();

  const runStatusToDoc = (run: VaultRun): DocStatus =>
    run.status === 'Completed'   ? 'Completed'
    : run.status === 'In Progress' ? 'Sent'
    : run.status === 'Pending'     ? 'Sent'
    : run.status === 'Rejected'    ? 'Pending'
    : 'Not Generated';

  const buildTplGroup = (templates: VaultTemplate[], orphanRuns: VaultRun[], title: string, groupIcon: string, groupBg: string, groupFg: string) => {
    /* SIGNED ONLY. The vault is the evidence view: a template nobody has sent
       yet ("Not Generated"), one still going round the signers, a cancelled or
       rejected run — none of them is a document, and listing them buried the
       three real signed files among rows with a greyed-out View button. A
       deprecated template can't reach here at all: /hr-document-templates/match
       returns Active ones only, so anything deprecated would have to come
       through a run, and only a fully signed run now does. */
    const docs = templates
      .filter(tpl => runByTemplateId.get(tpl.id)?.status === 'Completed')
      .map(tpl => {
      const run = runByTemplateId.get(tpl.id) || null;
      const status: DocStatus = 'Completed';
      return {
        id: tpl.id, key: `tpl-${tpl.id}`,
        name: tpl.name || '(unnamed template)',
        sub: `${tpl.doc_type || 'Document'}${tpl.code ? ` · ${tpl.code}` : ''}${run ? ` · Run #${run.id}` : ''}`,
        icon: 'ri-file-text-line', iconBg: groupBg, iconFg: groupFg,
        category: tpl.trigger_point?.module_name || 'Template',
        status,
        url: null as string | null,
        // Signed-PDF source once the run is fully signed — View/Download use this
        // instead of the template /generate endpoint (which 401→login-redirects
        // when opened directly in a browser tab).
        runId: run?.status === 'Completed' ? run.id : null,
      };
    });
    // Orphan runs — signing runs whose template no longer matches this employee
    // (e.g. after they're disabled / exited, or after a department change,
    // /hr-document-templates/match returns nothing). Without this, completed
    // signed documents silently vanish from the vault and the counts read 0
    // even though the signed PDFs exist. Render them straight off the run.
    const orphanDocs = orphanRuns
      .filter(run => run.status === 'Completed')   // signed only, as above
      .map(run => ({
        id: run.template_id || run.id, key: `run-${run.id}`,
        name: run.template?.name || run.code || 'Signed document',
        sub: `${run.template?.doc_type || 'Document'}${run.code ? ` · ${run.code}` : ''} · Run #${run.id}`,
        icon: 'ri-file-text-line', iconBg: groupBg, iconFg: groupFg,
        category: run.trigger_point_name || 'Document',
        status: runStatusToDoc(run),
        url: null as string | null,
        runId: run.id,
      }));
    const all = [...docs, ...orphanDocs];
    return all.length ? [{ title, icon: groupIcon, iconBg: groupBg, iconFg: groupFg, docs: all }] : [];
  };

  // Split runs whose template isn't in the matched set into exit vs. non-exit
  // (organizational) by their trigger keyword, so they land in the right tab.
  const exitTplIds = new Set(exitTemplates.map(t => t.id));
  const orgTplIds  = new Set(orgTemplates.map(t => t.id));
  const isExitRun  = (r: VaultRun) => String(r.trigger_keyword || '').toLowerCase() === 'exit';
  const exitOrphanRuns = signingRuns.filter(r =>  isExitRun(r) && !exitTplIds.has(r.template_id));
  const orgOrphanRuns  = signingRuns.filter(r => !isExitRun(r) && !orgTplIds.has(r.template_id));

  const orgGroups  = buildTplGroup(orgTemplates,  orgOrphanRuns,  'Signed Company Documents', 'ri-file-shield-2-line', '#fef3c7', '#92400e');
  const exitGroups = buildTplGroup(exitTemplates, exitOrphanRuns, 'Exit Process Documents',   'ri-logout-box-r-line',  '#dcfce7', '#15803d');

  const groups =
    tab === 'employee'       ? empGroups
    : tab === 'organizational' ? orgGroups
    : exitGroups;

  /* Promotion documents this employee's current grade calls for and which have
     NOT been dispatched. Deliberately outside `groups` and outside the KPI
     totals below: those describe signed evidence, and folding an unsent
     requirement into them would drop a fully-signed vault off 100% for work
     that has not been asked of anyone yet. This block is an action, not a
     record, so it sits above the record and counts separately. */
  /* Promotion paperwork that is not finished yet — whether or not it has been
     sent. Sending used to make the row VANISH, which read as "it went
     somewhere I can no longer see" rather than "it is now with the signers";
     the row stays and its button goes quiet instead.
     A completed run drops out because it has moved on: it appears below under
     the signed documents, and keeping it here as well would list one document
     twice. Rejected and cancelled runs stay, and stay re-sendable. */
  const promoRows = !onboardingDone ? [] : promoTemplates
    .map(t => ({ tpl: t, run: runByTemplateId.get(t.id) ?? null }))
    .filter(r => r.run?.status !== 'Completed');

  /** In flight with the signers — nothing to do but wait. */
  const promoLocked = (run: VaultRun | null) => run?.status === 'Pending' || run?.status === 'In Progress';

  const sendPromoDoc = async (tplId: number, name: string | null) => {
    if (!employee || sendingTplId) return;
    setSendingTplId(tplId);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: tplId,
        employee_id: employee.id,
      });
      toast.success('Sent for signing', `${data?.code || name || 'Document'} entered the workflow.`);
      setReloadKey(k => k + 1);
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      setSendingTplId(null);
    }
  };

  /* The KPIs and the tab badges count what the tabs actually SHOW.
     The promotion rows were left out of both, so a tab displaying two
     documents carried a badge reading 1, and a vault with a promotion document
     nobody had sent still reported 100% complete. They are real outstanding
     work — an unsent one is Pending, one with the signers is Sent — so they
     count exactly like any other row on this screen. */
  const promoDocs: { status: DocStatus }[] = promoRows.map(r => ({
    status: promoLocked(r.run) ? 'Sent' : 'Pending',
  }));
  const allDocs: { status: DocStatus }[] = [
    ...empDocsView,
    ...orgGroups.flatMap(g => g.docs),
    ...exitGroups.flatMap(g => g.docs),
    ...promoDocs,
  ];
  const total      = allDocs.length;
  const signed     = allDocs.filter(d => d.status === 'Signed' || d.status === 'Generated' || d.status === 'Completed').length;
  const pending    = allDocs.filter(d => d.status === 'Pending' || d.status === 'Sent').length;
  const completionPct = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;

  const empCount  = empDocsView.length;
  const orgCount  = orgGroups.reduce((a, g) => a + g.docs.length, 0) + promoRows.length;
  const exitCount = exitGroups.reduce((a, g) => a + g.docs.length, 0);

  type VaultDoc = { url: string | null; key: string; id: number; name: string; runId?: number | null };
  // View — show the SIGNED PDF inline for completed runs (opens the
  // authenticated blob in a new tab); falls back to an uploaded file URL.
  const handleViewRow = async (d: VaultDoc) => {
    if (busyKey) return;
    if (d.runId) {
      setBusyKey(d.key); setBusyAction('view');
      try {
        const resp = await api.get(`/hr-document-signatures/${d.runId}/download-pdf`, { responseType: 'blob' });
        const objUrl = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        window.open(objUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      } catch (err: any) {
        toast.error('Could not open', err?.response?.data?.message || 'Please try again.');
      } finally { setBusyKey(null); setBusyAction(null); }
      return;
    }
    if (d.url) { window.open(d.url, '_blank', 'noopener,noreferrer'); return; }
    toast.info('Not available yet', 'This document has not been generated / signed yet.');
  };
  // Download — signed PDF for completed runs; uploaded file otherwise. Shows a
  // "downloading" toast, a button spinner, and blocks concurrent clicks.
  const handleDownloadRow = async (d: VaultDoc) => {
    if (busyKey) return;
    setBusyKey(d.key); setBusyAction('download');
    try {
      if (d.runId) {
        toast.info('Downloading…', 'Preparing the signed PDF.');
        const resp = await api.get(`/hr-document-signatures/${d.runId}/download-pdf`, { responseType: 'blob' });
        const objUrl = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = objUrl; a.download = `${(d.name || 'document').replace(/\s+/g, '-')}-signed.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(objUrl);
        toast.success('Downloaded', 'Signed PDF saved.');
      } else if (d.url) {
        // Direct anchor download — NOT fetch(): uploaded files are served from
        // storage / a different origin, and fetch() trips a CORS error there.
        // An anchor download works for same-origin files and falls back to
        // opening the file in a new tab cross-origin (no CORS preflight).
        const a = document.createElement('a');
        a.href = d.url;
        a.download = d.name || 'document';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        toast.success('Downloaded', 'Document saved.');
      } else {
        toast.info('Not available yet', 'This document has not been generated / signed yet.');
      }
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  return (
    <Modal isOpen={!!employee} toggle={onClose} centered size="xl" backdrop="static" contentClassName="border-0 ev-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="ev-head">
          <span className="ev-head-icon"><i className="ri-archive-2-line" /></span>
          <div className="ev-head-text">
            <div className="ev-head-title">Evidence Vault</div>
            <div className="ev-head-sub">Centralized document repository for onboarding, signed organizational, and exit documents</div>
            <div className="ev-head-meta">
              <span className="rec-id-pill">{employee.empId}</span>
              <span className="rec-id-pill">{employee.name}</span>
              {(employee.department || employee.designation) && (
                <span className="rec-id-pill">
                  {[employee.department, employee.designation].filter(Boolean).join(' - ')}
                </span>
              )}
              {extraChips.map(c => <span key={c} className="rec-id-pill">{c}</span>)}
            </div>
          </div>
          <div className="ev-head-status">
            <ProgressDial value={completionPct} />
            <div className="ev-head-status-text">
              <div className="ev-head-status-label">Vault Status</div>
              <div className="ev-head-status-num">{completionPct}% Complete</div>
            </div>
          </div>
          <button type="button" className="ev-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="ev-kpis rec-page-kpis">
          {[
            { label: 'Total Docs',      value: total,    icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
            { label: 'Signed',          value: signed,   icon: 'ri-quill-pen-line',       gradient: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 60%, #a78bfa 100%)', deep: '#6d28d9' },
            { label: 'Pending',         value: pending,  icon: 'ri-time-line',            gradient: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
          ].map(k => (
            <div key={k.label} className="rec-kpi-card">
              <span className="rec-kpi-strip" style={{ background: k.gradient }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">{k.label}</span>
                <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value}</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                <i className={k.icon} />
              </span>
            </div>
          ))}
        </div>

        <div className="ev-tabs">
          <button type="button" className={`ev-tab${tab === 'employee' ? ' is-active' : ''}`} onClick={() => setTab('employee')}>
            <i className="ri-user-line" />Employee Documents<span className="ev-tab-badge">{empCount}</span>
          </button>
          <button type="button" className={`ev-tab${tab === 'organizational' ? ' is-active' : ''}`} onClick={() => setTab('organizational')}>
            <i className="ri-briefcase-4-line" />Organizational Documents<span className="ev-tab-badge">{orgCount}</span>
          </button>
          <button type="button" className={`ev-tab${tab === 'exit' ? ' is-active' : ''}`} onClick={() => setTab('exit')}>
            <i className="ri-logout-box-r-line" />Exit Documents<span className="ev-tab-badge">{exitCount}</span>
          </button>
        </div>

        <div className="ev-body">
          {/* Promotion paperwork the new grade calls for. Shown before the
              signed record because it is the only thing here anyone can act
              on, and hidden entirely when there is nothing outstanding. */}
          {!loading && tab === 'organizational' && promoRows.length > 0 && (
            <div className="ev-promo-block">
              <div className="ev-promo-head">
                <span className="ev-promo-icon"><i className="ri-user-star-line" /></span>
                <div className="min-w-0">
                  <div className="ev-promo-title">Promotion documents</div>
                  <div className="ev-promo-sub">
                    Matched to this employee&rsquo;s current department and designation. Sending is manual — changing a designation never sends anything on its own.
                  </div>
                </div>
                <span className="ev-promo-count">{promoRows.length}</span>
              </div>
              {/* Built from `ev-doc`, the same row the signed documents below
                  use — icon tile, name, meta line, status pill, action on the
                  right. These are the same kind of thing at a different point
                  in their life, so they should not look like a different
                  component; only the amber panel around them says they still
                  need doing. */}
              {promoRows.map(({ tpl: t, run }) => {
                const locked = promoLocked(run);
                const status = run?.status === 'Rejected'  ? { label: 'Rejected',      cls: 'pending'  }
                             : run?.status === 'Cancelled' ? { label: 'Cancelled',     cls: 'not-sent' }
                             : locked                      ? { label: 'Awaiting Sign', cls: 'sent'     }
                             :                               { label: 'Not Sent',      cls: 'not-sent' };
                return (
                <div key={t.id} className="ev-doc ev-doc--promo">
                  <span className="ev-doc-icon ev-doc-icon--promo">
                    <i className="ri-file-text-line" />
                  </span>
                  <div className="ev-doc-info">
                    <div className="ev-doc-name">{t.name}</div>
                    {/* Same shape as the signed rows' meta line. The run code
                        joins it once sent, so the row can be matched against
                        the signing workflow. The file name joins it only for
                        upload-built templates — an editor template has no file,
                        and an empty slot would read as a missing attachment
                        rather than a different kind of template. */}
                    <div className="ev-doc-sub">
                      {['Document', t.code, run ? `Run #${run.id}` : null, t.docx_original_name].filter(Boolean).join(' • ')}
                    </div>
                  </div>
                  <span className={`ev-doc-status ev-doc-status--${status.cls}`}>{status.label}</span>
                  {/* Same filled button the Download action uses on the signed
                      rows — this is the primary action of its row, so it should
                      carry the same weight rather than read as a link.
                      Once sent it stays in place and goes quiet: the row is
                      still the record of that requirement, and removing it
                      would look like the document had gone missing. */}
                  <button
                    type="button"
                    className="ev-doc-btn ev-doc-btn--download"
                    disabled={locked || sendingTplId != null}
                    title={locked ? 'Already sent — waiting on the signers.' : undefined}
                    onClick={() => sendPromoDoc(t.id, t.name)}
                  >
                    <i className={`${sendingTplId === t.id ? 'ri-loader-4-line ev-promo-spin' : locked ? 'ri-check-line' : 'ri-quill-pen-line'} me-1`} />
                    {sendingTplId === t.id ? 'Sending…' : locked ? 'Sent' : 'Send for Signature'}
                  </button>
                </div>
                );
              })}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
              <i className="ri-loader-4-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
              Loading vault…
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 10, fontSize: 13 }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
              {tab === 'employee'
                ? 'No documents uploaded yet by this employee.'
                : tab === 'organizational'
                  ? 'No signed onboarding documents yet. A document appears here once every signer in its workflow has signed it — send it from Onboarding, Stage 5.'
                  : 'No signed exit documents yet. A document appears here once every signer in its workflow has signed it — send it from the Exit wizard’s Exit Documents stage.'}
            </div>
          ) : groups.map((g, gi) => (
            <div key={gi} className="ev-group">
              <div className="ev-group-head">
                <span className="ev-group-icon" style={{ background: g.iconBg, color: g.iconFg }}>
                  <i className={g.icon} />
                </span>
                <div className="ev-group-title">{g.title}</div>
                <span className="ev-group-count">{g.docs.length} docs</span>
              </div>
              <div className="ev-doc-list">
                {g.docs.map(d => {
                  const status = d.status as DocStatus;
                  const disabled = status === 'Not Generated' || status === 'Optional';
                  return (
                    <div key={d.key} className="ev-doc">
                      <span className="ev-doc-icon" style={{ background: d.iconBg, color: d.iconFg }}>
                        <i className={d.icon} />
                      </span>
                      <div className="ev-doc-info">
                        <div className="ev-doc-name">{d.name}</div>
                        <div className="ev-doc-sub">{d.sub}</div>
                      </div>
                      {/* Category chip dropped — the row already sits under a
                          group heading that names the category ("Identity",
                          "Other"), so it repeated the line above it on every
                          row and pushed the status pill out of alignment. */}
                      <span className={`ev-doc-status ev-doc-status--${status.toLowerCase().replace(/\s+/g, '-')}`}>
                        {/* Tick on the states that mean "this document is in" —
                            the pill's colour says it, the mark confirms it at a
                            glance without reading. */}
                        {DONE_STATUSES.has(status) && <i className="ri-check-line" />}
                        {status}
                      </span>
                      {/* Icon only, and labelled by the app's own Tooltip rather
                          than the browser's `title` — same treatment as the
                          ActionBtn icons in the employee table, so the two read
                          as the same kind of control. aria-label stays for
                          screen readers; a tooltip is not an accessible name. */}
                      <Tooltip label={status === 'Generated' ? 'Preview' : 'View'}>
                        <button type="button"
                          className={`ev-doc-btn ev-doc-btn--icon ev-doc-btn--view${status === 'Generated' ? ' ev-doc-btn--preview' : ''}`}
                          disabled={disabled || busyKey === d.key}
                          onClick={() => handleViewRow(d)}
                          aria-label={status === 'Generated' ? 'Preview' : 'View'}
                        >
                          {busyKey === d.key && busyAction === 'view'
                            ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                            : <i className="ri-eye-line" />}
                        </button>
                      </Tooltip>
                      <button type="button"
                        className="ev-doc-btn ev-doc-btn--download"
                        disabled={disabled || busyKey === d.key}
                        onClick={() => handleDownloadRow(d)}
                      >
                        {busyKey === d.key && busyAction === 'download'
                          ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                          : <><i className="ri-download-line" />Download</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}
