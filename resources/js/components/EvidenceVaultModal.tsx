import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import { downloadFile, assertApiBlob } from '../utils/downloadFile';
import ProgressDial from './ui/ProgressDial';
import Tooltip from './ui/Tooltip';
import '../../css/recruitment.css';
import './ui/DataTable.css';   // .dt-tabrail / .dt-tab — the shared tab rail
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../pages/hrms/doc-templates/HeaderFooterPanel';

type DocStatus = 'Verified' | 'Uploaded' | 'Signed' | 'Sent' | 'Pending' | 'Not Generated' | 'Optional' | 'Generated' | 'Completed' | 'Rejected' | 'Cancelled';

/** States that mean the document is actually IN the vault — these carry the
 *  green pill and the tick. 'Sent' and 'Pending' deliberately don't: something
 *  is still owed on those. */
const DONE_STATUSES = new Set<DocStatus>(['Uploaded', 'Verified', 'Signed', 'Generated', 'Completed']);

export type VaultTab = 'employee' | 'organizational';

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
type OrgRow =
  | { kind: 'run'; run: VaultRun }
  | { kind: 'promo'; tpl: VaultTemplate; run: VaultRun | null };
type VaultTemplate = {
  id: number;
  code: string | null;
  name: string | null;
  doc_type: string | null;
  status: string | null;
  version?: string | null;
  /** Original upload name. Null for templates composed in the web editor —
   *  those have no file behind them, so the row shows nothing rather than a
   *  blank slot. */
  docx_original_name?: string | null;
  trigger_point?: { module_name?: string | null } | null;
};
type VaultSigner = {
  name?: string | null; role_name?: string | null; designation?: string | null;
  status?: string; note?: string | null; action?: string | null;
  user_id?: number | null; acted_at?: string | null; consent_at?: string | null;
  /* Captured at signing time — the typed name and the drawn mark. */
  signed_name?: string | null; signature_url?: string | null;
};
type VaultAudit = { at?: string | null; actor_name?: string | null; action?: string | null; message?: string | null };
type VaultRun = {
  id: number;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
  template_id: number;
  template_version?: string | null;
  code?: string | null;
  trigger_keyword?: string | null;
  trigger_point_name?: string | null;
  current_index?: number | null;
  created_at?: string | null;
  template?: { name?: string | null; doc_type?: string | null; code?: string | null; version?: string | null } | null;
  /* Full routing + history for the Organizational Document tracking view. */
  signers?: VaultSigner[];
  audit_log?: VaultAudit[];
};

/** What the preview needs — a run fetched whole, with its stored document. */
type PreviewRun = Omit<VaultRun, 'status'> & {
  /* A template that has not been sent has no run status — it is not
     Pending, it simply has not happened yet (QA #35). */
  status: VaultRun['status'] | 'Not sent yet';
  updated_at?: string | null;
  content_html?: string | null;
  header_config?: Partial<HeaderConfig> | null;
  footer_config?: Partial<FooterConfig> | null;
  /* Set when the preview is an UNSENT template rather than a run (QA #35).
     There is no signature row behind it, so the footer has to download from
     the template endpoint instead — asking /hr-document-signatures for an id
     that does not exist would 404. */
  tplId?: number;
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
  /**
   * The document on screen — the stored HTML, header and footer, exactly as
   * the onboarding hub shows it. Not the rendered PDF: that is a download, and
   * an iframe of it is a viewer inside a viewer.
   *
   * Fetched on demand rather than carried in the vault list, because the list
   * returns many runs and the content of each is the largest thing on the row.
   *
   * Declared HERE, with the other state. It sat beside viewRun further down,
   * which is past `if (!employee) return null` — so on a render with no
   * employee this hook never ran, the hook count changed between renders and
   * React threw "Rendered more hooks than during the previous render".
   */
  const [preview, setPreview] = useState<PreviewRun | null>(null);

  const [empDocs, setEmpDocs]               = useState<EmpDocApiRow[]>([]);
  const [orgTemplates, setOrgTemplates]     = useState<VaultTemplate[]>([]);
  const [exitTemplates, setExitTemplates]   = useState<VaultTemplate[]>([]);
  const [signingRuns, setSigningRuns]       = useState<VaultRun[]>([]);
  /* #43: the fetch is kicked off by an effect, which runs AFTER the first
     paint — so a vault opened with `loading` false rendered one frame of a
     finished-looking, empty vault before the loader appeared. Starting busy
     means the dialog never claims to know anything it has not read yet. */
  const [loading, setLoading]               = useState(true);
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
  /* Organizational Document tracking (QA spec): the status sub-tab, and which
     run's routing/history panel is expanded. */
  const [orgSub, setOrgSub]       = useState<'pending' | 'complete'>('pending');
  /* Which run's Track popup is open. */
  const [sigView, setSigView] = useState<VaultRun | null>(null);
  /* Group headings fold away; keyed by heading, open unless listed. */
  const [shutGroups, setShutGroups] = useState<Record<string, boolean>>({});
  /**
   * Groups start CLOSED, and open when asked.
   *
   * A vault with ten categories opened as ten expanded tables, so finding one
   * document meant scrolling past every other. Headings with counts fit on one
   * screen; the reader opens the one they came for.
   *
   * The exception is a single group: collapsing the only thing in the tab
   * leaves a heading and nothing else, which reads as "no documents" rather
   * than "one group, closed".
   *
   * `undefined` means "never touched", so an explicit open or close always
   * wins over the default.
   */
  const groupShut = (k: string, total: number) => {
    /* Searching opens everything. A filtered group that is still collapsed
       hides the one row the search just found, and the search reads as broken
       when it worked perfectly. */
    if (search.trim()) return false;

    return shutGroups[k] ?? (total > 1);
  };
  const toggleGroup = (k: string, total: number) =>
    setShutGroups(p => ({ ...p, [k]: !(p[k] ?? (total > 1)) }));
  /* Filters both tabs' lists by document name or code. */
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!employee) {
      setEmpDocs([]); setOrgTemplates([]); setExitTemplates([]); setSigningRuns([]);
      setPromoTemplates([]); setOnboardingDone(false);
      setTab(initialTab);
      // Closed: back to the busy default, ready for the next open.
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTab(initialTab);
    /* The three template-match calls are now ONE. They differed only by
       trigger_keyword, so the screen was paying three round trips to answer
       one question — and the work itself is 9-54ms, so the trips were the
       cost. ?trigger_keywords= returns a group per word, each in the same
       shape a single-keyword call returns. Six requests down to four. (QA #32) */
    Promise.allSettled([
      api.get(`/employees/${employee.id}/documents`),
      api.get('/hr-document-templates/match', {
        params: { employee_id: employee.id, trigger_keywords: 'onboarding,exit,promotion' },
      }),
      api.get('/hr-document-signatures', { params: { employee_id: employee.id } }),
      api.get(`/employees/${employee.id}`),
    ]).then(results => {
      if (cancelled) return;
      const [docsR, matchR, runsR, empR] = results;
      const groups = matchR.status === 'fulfilled' ? (matchR.value.data?.groups ?? {}) : {};
      const groupTemplates = (k: string) =>
        Array.isArray(groups?.[k]?.templates) ? groups[k].templates : [];
      const orgR   = { status: 'fulfilled' as const, value: { data: { templates: groupTemplates('onboarding') } } };
      const exitR  = { status: 'fulfilled' as const, value: { data: { templates: groupTemplates('exit') } } };
      const promoR = { status: 'fulfilled' as const, value: { data: { templates: groupTemplates('promotion') } } };
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
      /* The employee_documents row id, so Download can go through the API
         instead of the public storage URL. Set ONLY on these rows — template
         and orphan-run rows carry a template id in `id` and must not be
         mistaken for a document. (#142) */
      docId: d.id as number,
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
    /* Say what happened. Rejected used to read 'Pending' and Cancelled fell
       through to 'Not Generated' — a refused document described as merely
       waiting, and a withdrawn one as never sent. (QA #34) */
    : run.status === 'Rejected'    ? 'Rejected'
    : run.status === 'Cancelled'   ? 'Cancelled'
    : 'Not Generated';

  const buildTplGroup = (templates: VaultTemplate[], orphanRuns: VaultRun[], title: string, groupIcon: string, groupBg: string, groupFg: string) => {
    /* SIGNED ONLY. The vault is the evidence view: a template nobody has sent
       yet ("Not Generated"), one still going round the signers, a cancelled or
       rejected run — none of them is a document, and listing them buried the
       three real signed files among rows with a greyed-out View button. A
       deprecated template can't reach here at all: /hr-document-templates/match
       returns Active ones only, so anything deprecated would have to come
       through a run, and only a fully signed run now does. */
    /* …plus REJECTED and CANCELLED. The signed-only rule above is right about
       "Not Generated" and in-flight rows — they are noise. A refused one is
       not: it is the one row that needs somebody to act, and filtering it out
       meant a rejected organizational document vanished from the vault with no
       way to re-send it. Not a missing button — a missing ROW. (QA #34) */
    const ACTIONABLE = new Set(['Completed', 'Rejected', 'Cancelled']);
    const docs = templates
      .filter(tpl => ACTIONABLE.has(runByTemplateId.get(tpl.id)?.status ?? ''))
      .map(tpl => {
      const run = runByTemplateId.get(tpl.id) || null;
      // The filter above guarantees a run; the fallback is for the compiler.
      const status: DocStatus = run ? runStatusToDoc(run) : 'Not Generated';
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
      .filter(run => ACTIONABLE.has(run.status))   // signed, or refused and re-sendable
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

  /* Exit paperwork is the employee's own record too — it sits as a group under
     Employee Documents rather than behind a tab of its own. */
  const groupsAll = tab === 'employee' ? [...empGroups, ...exitGroups] : orgGroups;
  /* Search filters the rows and drops any group it empties. */
  const q = search.trim().toLowerCase();
  const matchDoc = (d: { name?: string | null; sub?: string | null }) =>
    !q || `${d.name ?? ''} ${d.sub ?? ''}`.toLowerCase().includes(q);
  const groups = !q ? groupsAll
    : groupsAll.map(g => ({ ...g, docs: g.docs.filter(matchDoc) })).filter(g => g.docs.length);

  /* Promotion documents this employee's current grade calls for and which have
     NOT been dispatched. Deliberately outside `groups` and outside the KPI
     totals below: those describe signed evidence, and folding an unsent
     requirement into them would drop a fully-signed vault off 100% for work
     that has not been asked of anyone yet. This block is an action, not a
     record, so it sits above the record and counts separately. */
  /* All promotion paperwork not yet complete — feeds the KPI totals so a sent
     promotion doc still counts as outstanding work. */
  const promoRows = !onboardingDone ? [] : promoTemplates
    .map(t => ({ tpl: t, run: runByTemplateId.get(t.id) ?? null }))
    .filter(r => r.run?.status !== 'Completed');
  /* What the yellow block SHOWS: only docs that still need an action here —
     never sent, or back from a signer (rejected / cancelled) and re-sendable.
     A sent one has moved to the Pending/Complete table below; listing it here
     too showed one document twice. The block is the action, the table the record. */
  const promoToSend = promoRows.filter(r =>
    !r.run || r.run.status === 'Rejected' || r.run.status === 'Cancelled');

  /** In flight with the signers — nothing to do but wait. */
  const promoLocked = (run: VaultRun | null) => run?.status === 'Pending' || run?.status === 'In Progress';

  /**
   * Send (or re-send) any template for this employee.
   *
   * Named sendPromoDoc when only the promotion block could reach it. It posts
   * a template id and an employee id, which is the same request for an
   * onboarding or exit document — and a rejected one of those needs it just
   * as much.
   */
  /**
   * Fold a just-created run into what is already on screen.
   *
   * This reproduces exactly what re-opening the modal would produce: the
   * run joins the list, and the template it came from picks up the four
   * signature_* attributes /hr-document-templates/match stamps on it. The
   * other three opening requests cannot change on a send, so re-running
   * them only bought a second round trip — 4 seconds of it on the server.
   */
  const applySentRun = (run: any) => {
    if (!run?.id) { setReloadKey(k => k + 1); return; }   // shape we don't know — fall back

    setSigningRuns(prev => [run, ...prev.filter((r: any) => Number(r.id) !== Number(run.id))]);

    const stamp = (list: any[]) => list.map(t => Number(t.id) === Number(run.template_id)
      ? { ...t, signature_status: run.status, signature_id: run.id, signature_code: run.code, is_sent: true }
      : t);
    setOrgTemplates(stamp);
    setExitTemplates(stamp);
    setPromoTemplates(stamp);
  };

  const sendDocForSignature = async (tplId: number, name: string | null) => {
    if (!employee || sendingTplId) return;
    setSendingTplId(tplId);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: tplId,
        employee_id: employee.id,
      });
      toast.success('Sent for signing', `${data?.code || name || 'Document'} entered the workflow.`);
      applySentRun(data);
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
  // Distinct rows the org tab shows: sent documents in the table, plus the
  // promotion docs still to send — a rejected/cancelled promo counts once, as
  // the promo row that replaces its run.
  const orgPromoRunCount = promoToSend.filter(p => p.run).length;
  const orgCount  = signingRuns.length - orgPromoRunCount + promoToSend.length;
  const exitCount = exitGroups.reduce((a, g) => a + g.docs.length, 0);

  type VaultDoc = { url: string | null; key: string; id: number; name: string; runId?: number | null; docId?: number | null };
  // View — show the SIGNED PDF inline for completed runs (opens the
  // authenticated blob in a new tab); falls back to an uploaded file URL.
  const handleViewRow = async (d: VaultDoc) => {
    if (busyKey) return;
    if (d.runId) {
      /* Open the tab NOW, before the fetch. (CBC #7)
       *
       * This used to await the PDF and then call window.open() with the blob
       * URL. A popup only inherits the click's user activation while the click
       * is still on the stack — after an await it is not, so the browser
       * blocked the window and View appeared to do nothing at all: no tab, no
       * error, and (because the block is silent) nothing in the console for
       * the user to report.
       *
       * Opening a blank tab synchronously keeps the activation, and the blob
       * URL is pushed into it once the bytes arrive. If the tab is blocked
       * anyway — a blocker that stops even same-gesture popups — we say so
       * instead of failing silently, and the row's Download button is still
       * there as the way through.
       *
       * NO 'noopener' in the features: window.open() returns NULL when it is
       * specified, so the handle needed to navigate the tab never came back —
       * every click reported "pop-up blocked" and left a stray about:blank tab
       * behind. Every other place in this app that keeps the handle opens the
       * same way. The opener link is severed on the line below instead, which
       * gets the same protection without throwing away the reference. */
      const win = window.open('', '_blank');
      if (win) win.opener = null;
      setBusyKey(d.key); setBusyAction('view');
      try {
        const resp = await api.get(`/hr-document-signatures/${d.runId}/download-pdf`, { responseType: 'blob' });
        /* Check the bytes are actually a PDF before declaring them one. (CBC #23)
         *
         * The Blob below asserts `application/pdf` whatever came back, so a
         * response that is really an HTML page or a JSON error — which a 200
         * carries without axios throwing — opened in the viewer as a perfectly
         * BLANK document. Nothing on screen said the file had not been
         * fetched. */
        await assertApiBlob(resp.data as Blob, 'pdf');
        const objUrl = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        if (win && !win.closed) {
          win.location.href = objUrl;
        } else {
          toast.info('Pop-up blocked', 'Allow pop-ups for this site to view documents, or use Download.');
        }
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      } catch (err: any) {
        // The placeholder tab must not be left sitting on about:blank.
        if (win && !win.closed) win.close();
        toast.error('Could not open', err?.response?.data?.message || err?.message || 'Please try again.');
      } finally { setBusyKey(null); setBusyAction(null); }
      return;
    }
    if (d.url) { window.open(d.url, '_blank', 'noopener,noreferrer'); return; }
    toast.info('Not available yet', 'This document has not been generated / signed yet.');
  };
  /** The filename the server sent, else the category label plus whatever
   *  extension the stored URL carries. (#142) */
  const filenameFromResponse = (resp: any, d: VaultDoc): string => {
    const cd = String(resp?.headers?.['content-disposition'] ?? '');
    // RFC 5987 `filename*=UTF-8''…` first, then the plain quoted form.
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (star?.[1]) {
      try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ }
    }
    const plain = cd.match(/filename="?([^";]+)"?/i);
    if (plain?.[1]) return plain[1].trim();

    const base = (d.name || 'document').replace(/\s+/g, '-');
    const ext = String(d.url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1];
    return ext ? `${base}.${ext.toLowerCase()}` : base;
  };

  /* Save an in-memory blob under a filename.
   *
   * The revoke is deferred. It used to run on the line after a.click(), and a
   * synchronous revoke can pull the object URL out from under a save the
   * browser has not started yet — the same reason utils/downloadFile.ts waits.
   * Shared by both branches below so the two cannot drift. */
  const saveBlobAs = (blob: Blob, filename: string) => {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
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
        // Same guard as View: never save a web page under a .pdf name. (CBC #23)
        await assertApiBlob(resp.data as Blob, 'pdf');
        saveBlobAs(
          new Blob([resp.data], { type: 'application/pdf' }),
          `${(d.name || 'document').replace(/\s+/g, '-')}-signed.pdf`,
        );
        toast.success('Downloaded', 'Signed PDF saved.');
      } else if (d.docId) {
        /* Uploaded employee documents come back through the API, not off their
           public /storage URL. (#142)
           downloadFile() fetches that URL and falls back to window.open() when
           the fetch fails — and it fails whenever the SPA is not served from
           the same origin as storage (the Vite dev server, or storage moved to
           Azure), because the path then answers with the SPA's index.html and
           the HTML guard rejects it. The fallback OPENS the file in a tab,
           which is the preview this ticket reports: Download quietly became
           View whenever the direct fetch could not reach the bytes.
           GET /documents/{id}/download streams the file same-origin, already
           authenticated and tenant-scoped, with an attachment disposition — so
           there is no origin to mismatch and no fallback to reach. */
        toast.info('Downloading…', 'Preparing the document.');
        const resp = await api.get(`/documents/${d.docId}/download`, { responseType: 'blob' });
        /* Name it the way the server does. `d.name` is the CATEGORY label
           ("PAN Card") and carries no extension, so saving under it would hand
           the user an extensionless file nothing opens. The endpoint already
           sends the stored original_name in Content-Disposition; the URL's own
           extension is the fallback. */
        saveBlobAs(resp.data as Blob, filenameFromResponse(resp, d));
        toast.success('Downloaded', 'Document saved.');
      } else if (d.url) {
        // No row id (legacy shapes) — fall back to the URL-based helper.
        await downloadFile(d.url, d.name || undefined);
        toast.success('Downloaded', 'Document saved.');
      } else {
        toast.info('Not available yet', 'This document has not been generated / signed yet.');
      }
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  /* ───── Organizational Document tracking (QA #Evidence-Vault) ─────
     Two status tabs (Pending for Signature / Complete Signature), each holding
     the three categories, with a routing + history panel on a selected row.
     All data is already on the signing run — no extra fetch. */
  const CAT_ORDER = ['Employee Onboarding Document', 'Exit Document', 'Promotion Document', 'Other Document'];
  const categoryOf = (r: VaultRun): string => {
    const hay = `${r.trigger_keyword || ''} ${r.trigger_point_name || ''} ${r.template?.doc_type || ''}`.toLowerCase();
    if (hay.includes('onboard')) return 'Employee Onboarding Document';
    if (hay.includes('exit'))    return 'Exit Document';
    if (hay.includes('promo'))   return 'Promotion Document';
    return 'Other Document';
  };
  const catIcon = (c: string) => c.includes('Onboarding') ? 'ri-user-add-line' : c.includes('Exit') ? 'ri-logout-box-r-line' : c.includes('Promotion') ? 'ri-user-star-line' : 'ri-file-text-line';
  const isComplete = (r: VaultRun) => r.status === 'Completed';
  const orgPendingRuns  = signingRuns.filter(r => !isComplete(r));
  const orgCompleteRuns = signingRuns.filter(r =>  isComplete(r));
  /* Runs that an unsent-promo row already represents (rejected / cancelled
     promotion runs) — so the pending table doesn't list them twice. */
  const promoRunIds = new Set(promoToSend.map(p => p.run?.id).filter(Boolean) as number[]);
  /* A table row is either a sent document (a run) or a promotion document still
     to send (a template, with its last run if it was rejected/cancelled). */
  const orgTrackGroups = (sub: 'pending' | 'complete'): { category: string; rows: OrgRow[] }[] => {
    const q = search.trim().toLowerCase();
    const hit = (name?: string | null, code?: string | null) =>
      !q || `${name ?? ''} ${code ?? ''}`.toLowerCase().includes(q);
    const by: Record<string, OrgRow[]> = {};
    const push = (cat: string, row: OrgRow) => (by[cat] = by[cat] || []).push(row);

    (sub === 'complete' ? orgCompleteRuns : orgPendingRuns)
      .filter(r => !promoRunIds.has(r.id) && hit(r.template?.name, r.code))
      .forEach(r => push(categoryOf(r), { kind: 'run', run: r }));

    // Unsent / re-sendable promotion docs live in the pending view, as rows.
    if (sub === 'pending')
      promoToSend.filter(({ tpl }) => hit(tpl.name, tpl.code))
        .forEach(({ tpl, run }) => push('Promotion Document', { kind: 'promo', tpl, run }));

    return CAT_ORDER.filter(c => by[c]?.length).map(c => ({ category: c, rows: by[c] }));
  };
  /* Latest signature that actually landed — null while anyone is still out. */
  const signedAtOf = (r: VaultRun) => (r.signers || [])
    .filter(s => (s.status || '') === 'Done')
    .map(s => s.acted_at || s.consent_at || '')
    .filter(Boolean).sort().pop() || null;
  const fmtDate = (x?: string | null) => { if (!x) return ''; const d = new Date(x); return isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const fmtStamp = (x?: string | null) => { if (!x) return ''; const d = new Date(x); return isNaN(+d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); };

  const downloadRun = async (r: VaultRun | PreviewRun) => {
    if (busyKey) return;
    setBusyKey(`run-${r.id}`); setBusyAction('download');
    try {
      const resp = await api.get(`/hr-document-signatures/${r.id}/download-pdf`, { responseType: 'blob' });
      saveBlobAs(new Blob([resp.data], { type: 'application/pdf' }), `${(r.template?.name || r.code || 'document').replace(/\s+/g, '-')}-signed.pdf`);
      toast.success('Downloaded', 'Signed PDF saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  /**
   * Open the document itself, rather than saving it (QA #29).
   *
   * Organizational rows offered Track and Download only, so the one thing an
   * approver actually wants — to read the document before acting on it — meant
   * downloading a file to disk first. Employee rows have had an eye for this
   * all along.
   *
   * Same endpoint as the download: it renders from the run's stored config, so
   * it answers for a rejected or in-flight run too, not just a completed one.
   */
  const closePreview = () => setPreview(null);

  const viewRun = async (r: VaultRun) => {
    if (busyKey) return;
    setBusyKey(`view-${r.id}`); setBusyAction('view');
    try {
      const { data } = await api.get(`/hr-document-signatures/${r.id}`);
      setPreview({ ...(data || {}), id: r.id, code: data?.code ?? r.code, template: data?.template ?? r.template });
    } catch (err: any) {
      toast.error('Could not open', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  /**
   * Read a template before anyone is asked to sign it (QA #35).
   *
   * /preview resolves the tokens against this employee, so what opens is the
   * document as the signer will receive it — not the raw template with
   * {{placeholders}} still in it. That is the whole point of looking: the
   * wording is checkable only once the names and dates are filled in.
   */
  const previewTemplate = async (t: VaultTemplate) => {
    if (!employee || busyKey) return;
    setBusyKey(`tpl-${t.id}`); setBusyAction('view');
    try {
      const { data } = await api.get(`/hr-document-templates/${t.id}/preview`, {
        params: { employee_id: employee.id },
      });
      setPreview({
        id: t.id,
        tplId: t.id,
        template_id: t.id,
        code: data?.code ?? t.code,
        template: { name: data?.name ?? t.name },
        // Nothing has been sent, so there is no status and no signer trail —
        // the head reads "Not sent yet" rather than borrowing a run's words.
        status: 'Not sent yet',
        signers: [],
        content_html: data?.content_html ?? null,
        header_config: data?.header_config ?? null,
        footer_config: data?.footer_config ?? null,
      } as PreviewRun);
    } catch (err: any) {
      toast.error('Could not open', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  /** Latest signature, else the row's own timestamps — the onboarding hub's rule. */
  const previewStamp = (r: PreviewRun): string => {
    const acted = (r.signers || []).map(s => s.acted_at).filter(Boolean) as string[];
    const iso = acted.length ? acted.slice().sort()[acted.length - 1] : (r.updated_at || r.created_at || null);
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${d.getFullYear()}, `
      + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const runPillCls = (s: VaultRun['status']) =>
    s === 'Completed' ? 'completed' : s === 'In Progress' || s === 'Pending' ? 'sent' : 'pending';
  /** Every step this document has been through, in one lifecycle: sent, each
   *  signer, reminders, anything else the audit log recorded, completion. */
  const trailSteps = (r: VaultRun) => {
    const audit = (r.audit_log || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const signers = r.signers || [];
    const cur = typeof r.current_index === 'number' ? r.current_index : -1;
    const done = r.status === 'Completed';
    const act = (e: VaultAudit) => String(e.action || '').toLowerCase();
    type State = 'Done' | 'In Progress' | 'Pending' | 'Rejected';
    const steps: { icon: string; title: string; desc?: string; at?: string | null; state: State; sig?: string | null }[] = [];

    const sent = audit.find(e => act(e) === 'sent');
    steps.push({
      icon: 'ri-send-plane-fill',
      title: 'Sent for signature',
      desc: sent?.message || 'Document sent via secure e-sign link',
      at: sent?.at || r.created_at,
      state: 'Done',
    });

    signers.forEach((s, i) => {
      const st = s.status || 'Pending';
      const who = s.signed_name || s.name || s.role_name || `Signer ${i + 1}`;
      const role = s.role_name || s.designation;
      if (st === 'Done') {
        steps.push({
          icon: 'ri-quill-pen-fill', title: `Signed by ${who}`,
          desc: role ? `${role} — signature captured` : 'Signature captured',
          at: s.acted_at || s.consent_at, state: 'Done', sig: s.signature_url,
        });
      } else if (st === 'Rejected') {
        /* Labelled "Reason:", because every other step's desc is a role or a
           status — an unlabelled sentence here read as one of those, and the
           one thing the reader opened Track to find looked like a job title. */
        const reason = (s.note || '').trim();
        steps.push({
          icon: 'ri-close-circle-fill', title: `Rejected by ${who}`,
          desc: reason
            ? `Reason: ${reason}`
            : `${role ? `${role} — ` : ''}rejected without a reason`,
          at: s.acted_at, state: 'Rejected',
        });
      } else {
        const isCur = !done && i === cur;
        steps.push({
          icon: 'ri-eye-fill',
          title: isCur ? 'Awaiting signature' : `Next — ${who}`,
          desc: isCur ? `In progress — with ${who}${role ? ` (${role})` : ''}` : (role || 'Waiting their turn'),
          state: isCur ? 'In Progress' : 'Pending',
        });
      }
    });

    const rem = audit.filter(e => act(e).includes('remind'));
    if (rem.length) steps.push({
      icon: 'ri-notification-3-fill',
      title: `${rem.length} reminder${rem.length === 1 ? '' : 's'} sent`,
      desc: 'Signing reminders',
      at: rem[rem.length - 1].at, state: 'Done',
    });

    /* Anything the log holds that the steps above don't already tell — recall,
       cancel, a re-send — so nothing is hidden from the trail. */
    audit.filter(e => !['sent', 'sign', 'signed'].includes(act(e)) && !act(e).includes('remind'))
      .forEach(e => steps.push({
        icon: 'ri-information-fill',
        title: (e.action || 'Event').replace(/^./, c => c.toUpperCase()),
        desc: `${e.message || ''}${e.actor_name ? ` · ${e.actor_name}` : ''}`.trim() || undefined,
        at: e.at, state: 'Done',
      }));

    steps.push({
      icon: 'ri-check-double-fill',
      title: 'Signed & completed',
      desc: done ? 'Every required signature is in' : 'Awaiting completion — the document is not yet fully signed',
      at: done ? signedAtOf(r) : null,
      state: done ? 'Done' : 'Pending',
    });
    return steps;
  };

  /* Two letters for a chain node — first + last initial, or the first two. */
  const chainInitials = (label: string) => {
    const parts = label.trim().split(/\s+/).filter(Boolean);
    const two = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
    return two.toUpperCase();
  };
  /* "Reporting Manager" → "RM", others left as-is (Employee, CEO, Client). */
  const shortRole = (role: string) => {
    const r = role.trim();
    if (/reporting\s*manager/i.test(r)) return 'RM';
    return r;
  };
  /* The signing chain inline: per signer a coloured initial circle with its ROLE
     below (Employee / RM / CEO …), joined by arrows — green signed, amber the one
     it's with now, red rejected, grey still to come. The column has the room, so
     the role labels fill it rather than leaving bare dots. No signers → the pill. */
  const renderChain = (r: VaultRun) => {
    const signers = r.signers || [];
    if (!signers.length)
      return <span className={`ev-doc-status ev-doc-status--${runPillCls(r.status)}`}>{r.status === 'Completed' && <i className="ri-check-line" />}{r.status}</span>;
    const cur = typeof r.current_index === 'number' ? r.current_index : -1;
    const done = r.status === 'Completed';
    return (
      <div className="ev-chain">
        {signers.map((s, i) => {
          const stt = s.status || 'Pending';
          const dh = stt === 'Done';
          const isCur = !done && i === cur && !dh;
          const bg = dh ? '#16a34a' : stt === 'Rejected' ? '#dc2626' : isCur ? '#f59e0b' : '#cbd5e1';
          const name = s.signed_name || s.name || s.role_name || `Signer ${i + 1}`;
          const role = s.role_name || s.designation || `Signer ${i + 1}`;
          const state = dh ? 'Signed' : stt === 'Rejected' ? 'Rejected' : isCur ? 'Awaiting' : 'Pending';
          return (
            <span key={i} className="ev-chain-node">
              {i > 0 && <i className="ri-arrow-right-line ev-chain-arrow" />}
              <span className="ev-chain-cell">
                <Tooltip label={`${name} · ${role} — ${state}`}>
                  <span className="ev-chain-dot" style={{ background: bg }}>{chainInitials(name)}</span>
                </Tooltip>
                <span className="ev-chain-role" style={isCur ? { color: '#b45309', fontWeight: 700 } : dh ? { color: '#15803d' } : undefined}>{shortRole(role)}</span>
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  const renderOrgTracking = () => {
    const groupsSub = orgTrackGroups(orgSub);
    // Pending now also carries the promotion docs still to send (minus the
    // rejected/cancelled runs those rows replace).
    const pendingCount = orgPendingRuns.length - promoRunIds.size + promoToSend.length;
    const subs: [typeof orgSub, string, string, number][] = [
      ['pending', 'Pending for Signature', 'ri-time-line', pendingCount],
      ['complete', 'Complete Signature', 'ri-checkbox-circle-line', orgCompleteRuns.length],
    ];
    return (
      <>
        {/* Underline tabs for Pending / Complete (the vault's own .ev-tabs). */}
        <div className="ev-tabs ev-subtabs" role="tablist">
          {subs.map(([key, label, icon, count]) => (
            <button key={key} type="button" role="tab" aria-selected={orgSub === key}
              className={`ev-tab${orgSub === key ? ' is-active' : ''}`}
              onClick={() => { setOrgSub(key); setSigView(null); }}>
              <i className={icon} />{label}
              <span className="ev-tab-badge">{count}</span>
            </button>
          ))}
        </div>

        {groupsSub.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 10, fontSize: 13 }}>
            <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
            {search.trim()
              ? `No documents match “${search.trim()}”.`
              : orgSub === 'pending'
              ? 'No documents are waiting for signature. Generate one from Document Template and send it for signing.'
              : 'No fully-signed documents yet. A document moves here once every required signer has signed it.'}
          </div>
        ) : groupsSub.map(g => (
          <div key={g.category} className="ev-group">
            <div className="ev-group-head">
              <span className="ev-group-icon" style={{ background: '#eef2ff', color: '#4338ca' }}><i className={catIcon(g.category)} /></span>
              <div className="ev-group-title">{g.category}</div>
              <span className="ev-group-count">{g.rows.length} docs</span>
              <button type="button" className="ev-group-toggle" aria-expanded={!groupShut(g.category, groupsSub.length)}
                aria-label={groupShut(g.category, groupsSub.length) ? 'Expand group' : 'Collapse group'}
                onClick={() => toggleGroup(g.category, groupsSub.length)}>
                <i className={groupShut(g.category, groupsSub.length) ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} />
              </button>
            </div>
            {!groupShut(g.category, groupsSub.length) && (
            <div className="ev-table-wrap">
            <table className="ev-table">
              <thead>
                <tr>
                  <th style={{ width: 56, textAlign: 'center' }}>Sr No</th>
                  <th style={{ width: 130, textAlign: 'center' }}>Document Code</th>
                  <th style={{ width: 230 }}>Document Name</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Version</th>
                  {/* Two columns, not one. "Signing Status" carried both the
                      routing chain AND the state chip, so a rejected document
                      showed a chip where a sent one showed avatars and the
                      column meant something different on every row. */}
                  <th style={{ minWidth: 120, textAlign: 'center' }}>Signers</th>
                  <th style={{ width: 120, textAlign: 'center' }}>Status</th>
                  <th style={{ width: 110 }}>Generated On</th>
                  <th style={{ width: 190, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row, ri) => {
                  const sr = ri + 1;
                  /* A promotion doc still to send — no run yet (or a rejected /
                     cancelled one), so its action is Send for Signature. */
                  if (row.kind === 'promo') {
                    const { tpl: t, run } = row;
                    const st = run?.status === 'Rejected' ? { label: 'Rejected', cls: 'rejected' }
                             : run?.status === 'Cancelled' ? { label: 'Cancelled', cls: 'cancelled' }
                             : { label: 'Not Sent', cls: 'not-sent' };
                    const rejectedBy = run?.status === 'Rejected'
                      ? (run.signers ?? []).find(s => s.status === 'Rejected') ?? null : null;
                    return (
                      <tr key={`promo-${t.id}`}>
                        <td style={{ textAlign: 'center', color: 'var(--vz-secondary-color)' }}>{sr}</td>
                        <td className="ev-code" style={{ textAlign: 'center' }}>{t.code || '—'}</td>
                        <td>
                          <Tooltip label={t.name || ''}>
                            <span className="ev-td-name ev-td-name--trunc">{t.name}</span>
                          </Tooltip>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {t.version
                            ? <span className="ev-ver" title={`Template version ${t.version}`}>{t.version}</span>
                            : <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>}
                        </td>
                        {/* Nothing has been routed yet, or the routing is over. */}
                        <td style={{ textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
                          {run ? renderChain(run) : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {/* The chip alone. The reason lives in Track, which is
                              one click away and has room for the whole sentence
                              plus who said it and when — a row does not. */}
                          <span className={`ev-doc-status ev-doc-status--${st.cls}`}
                            title={rejectedBy?.note?.trim() || undefined}>{st.label}</span>
                        </td>
                        <td style={{ color: 'var(--vz-secondary-color)', whiteSpace: 'nowrap' }}>—</td>
                        <td className="ev-td-actions ev-td-actions--center">
                          {/* A rejected or cancelled run still HAPPENED — it was
                              sent, somebody read it and said no. Offering only
                              Re-send threw that away: who refused it and why
                              were a click that did not exist. */}
                          {run && (
                            <>
                              <button type="button" className="ev-doc-btn ev-doc-btn--soft"
                                onClick={() => setSigView(run)}
                                title="Who it went to, who refused it, and when">
                                <i className="ri-file-history-line" />Track
                              </button>
                              <button type="button" className="ev-doc-btn ev-doc-btn--open"
                                disabled={busyKey === `view-${run.id}`} onClick={() => viewRun(run)}
                                title="Open the document">
                                {busyKey === `view-${run.id}`
                                  ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />View</>
                                  : <><i className="ri-eye-line" />View</>}
                              </button>
                            </>
                          )}
                          {/* Outside the run guard on purpose (QA #35): before
                              anything is sent there is no run, and that is
                              exactly when someone needs to read the document. */}
                          {!run && (
                            <button type="button" className="ev-doc-btn ev-doc-btn--open"
                              disabled={busyKey === `tpl-${t.id}`} onClick={() => previewTemplate(t)}
                              title="Read it before it goes out for signature">
                              {busyKey === `tpl-${t.id}`
                                ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />View</>
                                : <><i className="ri-eye-line" />View</>}
                            </button>
                          )}
                          <button type="button" className="ev-doc-btn ev-doc-btn--send"
                            disabled={sendingTplId != null} onClick={() => sendDocForSignature(t.id, t.name)}>
                            {sendingTplId === t.id
                              ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Sending…</>
                              : <><i className="ri-send-plane-line" />{run ? 'Re-send' : 'Send'}</>}
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  const r = row.run;
                  const docName = r.template?.name || r.code || 'Document';
                  return (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'center', color: 'var(--vz-secondary-color)' }}>{sr}</td>
                      <td className="ev-code" style={{ textAlign: 'center' }}>{r.code || '—'}</td>
                      <td>
                        <Tooltip label={docName}>
                          <span className="ev-td-name ev-td-name--trunc">{docName}</span>
                        </Tooltip>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {/* The version this document was SENT on (frozen at send),
                            NOT the template's current version. '*' flags that the
                            template has since moved to a newer version. */}
                        {(() => {
                          const sent = r.template_version;
                          const cur = r.template?.version;
                          if (!sent) return <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>;
                          const moved = cur && cur !== sent;
                          return (
                            <span className="ev-ver"
                              title={moved ? `Sent on ${sent}; template is now ${cur}` : `Sent on ${sent}`}>
                              {sent}{moved ? '*' : ''}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ textAlign: 'center' }}>{renderChain(r)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {/* "Pending" is the column in the database, not a thing
                            a reader understands: the document HAS been sent and
                            is out with its signers. Say that. */}
                        <span className={`ev-doc-status ev-doc-status--${runPillCls(r.status)}`}>
                          {r.status === 'Pending' || r.status === 'In Progress' ? 'Awaiting Sign' : r.status}
                        </span>
                      </td>
                      <td style={{ color: 'var(--vz-secondary-color)', whiteSpace: 'nowrap' }}>{fmtDate(r.created_at) || '—'}</td>
                      {/* One button (Track) centres; two (Track + Download) stay right. */}
                      <td className={`ev-td-actions${r.status === 'Completed' ? '' : ' ev-td-actions--center'}`}>
                        {/* Pending rows: the only thing to do is watch where it
                            is, so Track stands alone. Completed: add the
                            signed-PDF download. */}
                        <button type="button" className="ev-doc-btn ev-doc-btn--soft"
                          onClick={() => setSigView(r)}
                          title="Who signed, when, and every step in between">
                          {/* "Track" on every row. A completed document said
                              "Audit Trail" and a pending one "Track" — two
                              names for one button, so the column read as two
                              different actions depending on the row. */}
                          <i className="ri-file-history-line" />Track
                        </button>
                        {/* Read it without saving it first. Employee rows have
                            had this eye since the start; these had Download or
                            nothing, which is a poor way to check a document
                            before approving it. */}
                        <button type="button" className="ev-doc-btn ev-doc-btn--open"
                          disabled={busyKey === `view-${r.id}`} onClick={() => viewRun(r)}
                          title="Open the document">
                          {busyKey === `view-${r.id}`
                            ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />View</>
                            : <><i className="ri-eye-line" />View</>}
                        </button>
                        {(r.status === 'Pending' || r.status === 'In Progress') && (
                          <span className="ev-doc-btn ev-doc-btn--await" aria-disabled="true"
                            title="Out with the signers — nothing to do here yet">
                            <i className="ri-time-line" />Awaiting Sign
                          </span>
                        )}
                        {/* Refused or withdrawn — so it is settled, and the only
                            way forward is to send it again.
                            Only PROMOTION documents had this, because Re-send
                            lived on the promo row and promo rows are built from
                            promotion templates. A rejected onboarding or exit
                            document reached this table instead and offered
                            Track and View — nothing that moved it on. */}
                        {(r.status === 'Rejected' || r.status === 'Cancelled') && (
                          <button type="button" className="ev-doc-btn ev-doc-btn--send"
                            disabled={sendingTplId != null}
                            onClick={() => sendDocForSignature(r.template_id, r.template?.name ?? null)}>
                            {sendingTplId === r.template_id
                              ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Sending…</>
                              : <><i className="ri-send-plane-line" />Re-send</>}
                          </button>
                        )}
                        {r.status === 'Completed' && (
                          <button type="button" className="ev-doc-btn ev-doc-btn--download"
                            disabled={busyKey === `run-${r.id}`} onClick={() => downloadRun(r)}>
                            {busyKey === `run-${r.id}`
                              ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                              : <><i className="ri-download-line" />Download</>}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            )}
          </div>
        ))}
      </>
    );
  };

  return (
    <>
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
            {/* #43: zeros here read as "this vault is empty", which is an
                answer — and the wrong one — while the documents are still on
                the wire. Nothing states a figure until the fetch settles. */}
            <ProgressDial value={loading ? 0 : completionPct} />
            <div className="ev-head-status-text">
              <div className="ev-head-status-label">Vault Status</div>
              <div className="ev-head-status-num">
                {loading ? 'Loading…' : `${completionPct}% Complete`}
              </div>
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
                <span className="rec-kpi-num" style={{ color: k.deep }}>
                  {loading ? <span className="ev-kpi-skeleton" aria-label="Loading" /> : k.value}
                </span>
              </div>
              <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                <i className={k.icon} />
              </span>
            </div>
          ))}
        </div>

        {/* Main tabs: the roster's pill rail (.dt-tabrail / .dt-tabs / .dt-tab).
            Two tabs: the employee's own files, exit paperwork among them as a
            group, and the documents that went out for signature. */}
        <div className="ev-tabstrip">
          <div className="dt-tabrail dt-tabs ev-softrail" role="tablist">
            {([
              ['employee', 'Employee Documents', 'ri-user-line', empCount + exitCount],
              ['organizational', 'Organizational Documents', 'ri-briefcase-4-line', orgCount],
            ] as const).map(([key, label, icon, count]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key}
                className={`dt-tab ${tab === key ? 'on' : 'off'}`} onClick={() => setTab(key)}>
                <i className={icon} />{label}
                <span className="dt-tab-count">{loading ? <span className="ev-kpi-skeleton" style={{ width: 12, height: 8 }} aria-label="Loading" /> : count}</span>
              </button>
            ))}
          </div>
          <div className="ev-search">
            <i className="ri-search-line" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by document name or code…" aria-label="Search documents" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><i className="ri-close-line" /></button>
            )}
          </div>
        </div>

        <div className="ev-body" aria-busy={loading}>
          {loading ? (
            /* #43 — the loader was a STATIC ri-loader-4-line. A loader icon
               that does not turn is indistinguishable from an error glyph, and
               it was the only thing on a blank panel, so the vault read as
               broken rather than busy.
               A turning spinner says the work is live; the skeleton beneath
               traces the real group → rows layout, so the panel keeps its shape
               and the documents land in place instead of pushing the view. */
            <div className="ev-loading" aria-busy="true" aria-label="Loading vault">
              {[0, 1].map(gi => (
                <div className="ev-group" key={`ev-skel-${gi}`} aria-hidden="true">
                  <div className="ev-group-head">
                    <span className="ev-skel ev-skel--icon" />
                    <span className="ev-skel" style={{ height: 11, width: gi === 0 ? 132 : 94 }} />
                    <span className="ev-skel ev-skel--pill" />
                  </div>
                  <div className="ev-doc-list">
                    {[0, 1, 2].map(ri => (
                      <div className="ev-doc" key={ri}>
                        <span className="ev-skel ev-skel--icon" />
                        <div className="ev-doc-info">
                          <span className="ev-skel" style={{ height: 11, width: `${58 - ri * 9}%`, display: 'block' }} />
                          <span className="ev-skel" style={{ height: 9, width: `${38 - ri * 5}%`, display: 'block', marginTop: 6 }} />
                        </div>
                        <span className="ev-skel ev-skel--status" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'organizational' ? (
            renderOrgTracking()
          ) : groups.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 10, fontSize: 13 }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
              {search.trim() ? `No documents match “${search.trim()}”.` : 'No documents uploaded yet by this employee.'}
            </div>
          ) : groups.map((g, gi) => (
            <div key={gi} className="ev-group">
              <div className="ev-group-head">
                <span className="ev-group-icon" style={{ background: g.iconBg, color: g.iconFg }}>
                  <i className={g.icon} />
                </span>
                <div className="ev-group-title">{g.title}</div>
                <span className="ev-group-count">{g.docs.length} docs</span>
                <button type="button" className="ev-group-toggle" aria-expanded={!groupShut(g.title, groups.length)}
                  aria-label={groupShut(g.title, groups.length) ? 'Expand group' : 'Collapse group'}
                  onClick={() => toggleGroup(g.title, groups.length)}>
                  <i className={groupShut(g.title, groups.length) ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} />
                </button>
              </div>
              {!groupShut(g.title, groups.length) && (
              <div className="ev-table-wrap">
              <table className="ev-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Sr No</th>
                    <th>Document Name</th>
                    <th style={{ width: 150 }}>Status</th>
                    <th style={{ width: 190, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.docs.map((d, di) => {
                    const status = d.status as DocStatus;
                    /* A refused run has no signed PDF to download, but it does
                       have the document that was sent — so View stays, Download
                       goes, and Re-send appears. (QA #34) */
                    const refused  = status === 'Rejected' || status === 'Cancelled';
                    const disabled = status === 'Not Generated' || status === 'Optional';
                    return (
                      <tr key={d.key}>
                        <td style={{ color: 'var(--vz-secondary-color)' }}>{di + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="ev-doc-icon" style={{ background: d.iconBg, color: d.iconFg, flexShrink: 0 }}>
                              <i className={d.icon} />
                            </span>
                            {/* minWidth:0 lets the flex child shrink; without it
                                the text sets the floor and nothing ellipsises.
                                The full name rides on the title, since a
                                truncated one is useless on its own. */}
                            <div style={{ minWidth: 0 }}>
                              <div className="ev-td-name ev-td-name--trunc" title={d.name}>{d.name}</div>
                              <div className="ev-td-sub ev-td-name--trunc" title={d.sub}>{d.sub}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`ev-doc-status ev-doc-status--${status.toLowerCase().replace(/\s+/g, '-')}`}>
                            {/* Tick on the states that mean "this document is in" —
                                the pill's colour says it, the mark confirms it at a
                                glance without reading. */}
                            {DONE_STATUSES.has(status) && <i className="ri-check-line" />}
                            {status}
                          </span>
                        </td>
                        <td className="ev-td-actions">
                          {/* Icon only, and labelled by the app's own Tooltip rather
                              than the browser's `title` — same treatment as the
                              ActionBtn icons in the employee table. */}
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
                          {!refused && (
                            <button type="button"
                              className="ev-doc-btn ev-doc-btn--download"
                              disabled={disabled || busyKey === d.key}
                              onClick={() => handleDownloadRow(d)}
                            >
                              {busyKey === d.key && busyAction === 'download'
                                ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                                : <><i className="ri-download-line" />Download</>}
                            </button>
                          )}
                          {/* The only way forward for a refused document. It is
                              why the row is listed at all. (QA #34) */}
                          {refused && (
                            <button type="button" className="ev-doc-btn ev-doc-btn--send"
                              disabled={sendingTplId != null}
                              onClick={() => sendDocForSignature(d.id, d.name)}>
                              {sendingTplId === d.id
                                ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Sending…</>
                                : <><i className="ri-send-plane-line" />Re-send</>}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              )}
            </div>
          ))}
        </div>
      </ModalBody>
    </Modal>

    {/* The document itself, in the vault rather than a new tab.
        Deliberately the SAME popup the Onboarding Hub shows — same green head,
        same HeaderFooterPanel rendering the stored header, body and footer,
        same Close / Download PDF foot. A second design for the same document
        would be a second thing to keep in step.

        ev-sig-content rather than the hub's vault-preview-modal: that class
        lives in a page-scoped stylesheet the vault does not load, so the green
        head's rounded top would sit on square corners everywhere else the
        vault opens. This one is already here and does the same job. */}
    {preview && (
      <Modal isOpen toggle={closePreview} size="lg" centered zIndex={1075}
        contentClassName="border-0 ev-sig-content ev-prev-content" backdrop="static">
        <ModalBody className="p-0">
          {/* The vault's own head — .ev-head and friends, the same classes the
              Evidence Vault title bar uses. The hub's green was right there and
              wrong here: a document opened from a violet vault should not
              arrive in another product's colour. */}
          <div className="ev-head">
            <span className="ev-head-icon"><i className="ri-file-shield-2-line" /></span>
            <div className="ev-head-text">
              <div className="ev-head-title ev-td-name--trunc"
                title={preview.template?.name || preview.code || 'Document'}>
                {preview.template?.name || preview.code || 'Document'}
              </div>
              <div className="ev-head-sub">
                {preview.status === 'Completed' ? 'Signed copy' : preview.status}
                {previewStamp(preview) ? ` · ${previewStamp(preview)}` : ''}
              </div>
              {(preview.code || preview.template_version) && (
                <div className="ev-head-meta">
                  {preview.code && <span className="rec-id-pill">{preview.code}</span>}
                  {preview.template_version && <span className="rec-id-pill">v{preview.template_version}</span>}
                </div>
              )}
            </div>
            <button type="button" className="ev-close" onClick={closePreview} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>

          <div style={{ padding: 16, background: 'var(--vz-secondary-bg, #f9fafb)', maxHeight: '70vh', overflowY: 'auto' }}>
            <HeaderFooterPanel
              header={{ ...DEFAULT_HEADER, ...(preview.header_config || {}) } as HeaderConfig} setHeader={() => {}}
              footer={{ ...DEFAULT_FOOTER, ...(preview.footer_config || {}) } as FooterConfig} setFooter={() => {}}
              readOnly
            >
              <div className="tpl-readonly-preview"
                style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                dangerouslySetInnerHTML={{ __html: preview.content_html || '<p style="color:#9ca3af;font-style:italic;">(no stored content for this run)</p>' }}
              />
            </HeaderFooterPanel>
          </div>

          <div className="tpl-prev-foot" style={{ padding: 12, borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-card-bg, #fff)', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 6px 6px' }}>
            {/* The vault's row buttons, so the foot matches the table the
                document was opened from. */}
            <button type="button" className="ev-doc-btn ev-doc-btn--soft" onClick={closePreview}>
              <i className="ri-close-line" />Close
            </button>
            {/* Only a run has a PDF worth saving. The template endpoint renders
                the RAW content_html — tokens unresolved — so a Download here
                would save a different document from the one on screen. */}
            {!preview.tplId && (
              <button type="button" className="ev-doc-btn ev-doc-btn--download"
                disabled={busyKey === `run-${preview.id}`} onClick={() => downloadRun(preview)}>
                {busyKey === `run-${preview.id}`
                  ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                  : <><i className="ri-download-line" />Download PDF</>}
              </button>
            )}
          </div>
        </ModalBody>
      </Modal>
    )}

    {/* Track — the whole e-signature lifecycle in one timeline, stacked
        above the vault (zIndex beats its 1050). */}
    {sigView && (() => {
      const r = sigView;
      const steps = trailSteps(r);
      const doneSteps = steps.filter(s => s.state === 'Done').length;
      const pct = steps.length ? Math.round((doneSteps / steps.length) * 100) : 0;
      const tone = (state: string) =>
        state === 'Done' ? { bg: '#16a34a', pill: '#dcfce7', ink: '#15803d', label: '✓ Done' }
        : state === 'In Progress' ? { bg: '#f59e0b', pill: '#fef3c7', ink: '#92400e', label: 'In Progress' }
        : state === 'Rejected' ? { bg: '#dc2626', pill: '#fee2e2', ink: '#b91c1c', label: 'Rejected' }
        : { bg: '#cbd5e1', pill: '#f1f5f9', ink: '#64748b', label: 'Pending' };
      return (
      <Modal isOpen centered toggle={() => setSigView(null)} zIndex={1060} contentClassName="border-0 ev-sig-content"
        style={{ maxWidth: 580, width: '92vw' }}>
        <ModalBody className="p-0" style={{ borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px', color: '#fff', background: 'linear-gradient(135deg,#6d28d9 0%,#7c3aed 55%,#a855f7 100%)' }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.18)', flexShrink: 0, fontSize: 20 }}>
              <i className="ri-file-history-line" />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.8)' }}>
                {r.code ? `${r.code} · ` : ''}Signing Workflow
              </div>
              <div style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.2, marginTop: 2 }}>Track</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.85)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {r.template?.name || 'Document'} · e-Signature lifecycle
                <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,.22)' }}>{r.status}</span>
              </div>
            </div>
            <button type="button" onClick={() => setSigView(null)} aria-label="Close"
              style={{ background: 'rgba(255,255,255,.18)', border: 0, color: '#fff', width: 32, height: 32, borderRadius: 9, cursor: 'pointer', flexShrink: 0 }}>
              <i className="ri-close-line" />
            </button>
          </div>

          <div style={{ padding: '14px 20px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)' }}>Overall progress</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vz-body-color)' }}>{doneSteps} / {steps.length} steps complete</span>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: 'var(--vz-secondary-bg)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: 'linear-gradient(90deg,#7c3aed,#16a34a)' }} />
            </div>
          </div>

          <div style={{ padding: '16px 20px 6px', maxHeight: '58vh', overflowY: 'auto' }}>
            {steps.map((s, i) => {
              const t = tone(s.state);
              return (
                <div key={i} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: i === steps.length - 1 ? 0 : 18 }}>
                  {i < steps.length - 1 && (
                    <span style={{ position: 'absolute', left: 17, top: 36, bottom: 4, width: 2, background: 'var(--vz-border-color)' }} aria-hidden />
                  )}
                  <span style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: t.bg, color: '#fff', fontSize: 16, zIndex: 1 }}>
                    <i className={s.icon} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: s.state === 'Pending' ? 'var(--vz-secondary-color)' : 'var(--vz-body-color)' }}>{s.title}</span>
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: t.pill, color: t.ink }}>{t.label}</span>
                    </div>
                    {s.desc && <div style={{ fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>{s.desc}</div>}
                    {s.at && (
                      <div style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <i className="ri-calendar-line" />{fmtStamp(s.at)}
                      </div>
                    )}
                    {s.sig && (
                      <img src={resolveFileUrl(s.sig)} alt="Signature"
                        style={{ display: 'block', maxHeight: 38, maxWidth: 150, objectFit: 'contain', marginTop: 6 }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {r.status === 'Completed' && (
            <div style={{ padding: '12px 20px 18px' }}>
              <button type="button" className="ev-doc-btn ev-doc-btn--download" style={{ width: '100%', height: 40 }}
                disabled={busyKey === `run-${r.id}`} onClick={() => downloadRun(r)}>
                {busyKey === `run-${r.id}`
                  ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                  : <><i className="ri-download-line" />Download signed PDF</>}
              </button>
            </div>
          )}
        </ModalBody>
      </Modal>
      );
    })()}
    </>
  );
}
