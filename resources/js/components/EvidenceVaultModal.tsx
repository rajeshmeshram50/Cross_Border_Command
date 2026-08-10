import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import ProgressDial from './ui/ProgressDial';
import '../../css/recruitment.css';

type DocStatus = 'Verified' | 'Uploaded' | 'Signed' | 'Sent' | 'Pending' | 'Not Generated' | 'Optional' | 'Generated' | 'Completed';

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

  useEffect(() => {
    if (!employee) {
      setEmpDocs([]); setOrgTemplates([]); setExitTemplates([]); setSigningRuns([]);
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
    ]).then(results => {
      if (cancelled) return;
      const [docsR, orgR, exitR, runsR] = results;
      setEmpDocs(docsR.status === 'fulfilled' && Array.isArray(docsR.value.data) ? docsR.value.data : []);
      setOrgTemplates(orgR.status === 'fulfilled' && Array.isArray(orgR.value.data?.templates) ? orgR.value.data.templates : []);
      setExitTemplates(exitR.status === 'fulfilled' && Array.isArray(exitR.value.data?.templates) ? exitR.value.data.templates : []);
      setSigningRuns(runsR.status === 'fulfilled' && Array.isArray(runsR.value.data) ? runsR.value.data : []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

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
    const docs = templates.map(tpl => {
      const run = runByTemplateId.get(tpl.id) || null;
      const status: DocStatus =
        run?.status === 'Completed'   ? 'Completed'
        : run?.status === 'In Progress' ? 'Sent'
        : run?.status === 'Pending'     ? 'Sent'
        : run?.status === 'Rejected'    ? 'Pending'
        : run?.status === 'Cancelled'   ? 'Not Generated'
        : tpl.status === 'Active'       ? 'Not Generated'
        : 'Not Generated';
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
    const orphanDocs = orphanRuns.map(run => ({
      id: run.template_id || run.id, key: `run-${run.id}`,
      name: run.template?.name || run.code || 'Signed document',
      sub: `${run.template?.doc_type || 'Document'}${run.code ? ` · ${run.code}` : ''} · Run #${run.id}`,
      icon: 'ri-file-text-line', iconBg: groupBg, iconFg: groupFg,
      category: run.trigger_point_name || 'Document',
      status: runStatusToDoc(run),
      url: null as string | null,
      runId: run.status === 'Completed' ? run.id : null,
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

  const allDocs: { status: DocStatus }[] = [...empDocsView, ...orgGroups.flatMap(g => g.docs), ...exitGroups.flatMap(g => g.docs)];
  const total      = allDocs.length;
  const signed     = allDocs.filter(d => d.status === 'Signed' || d.status === 'Generated' || d.status === 'Completed').length;
  const pending    = allDocs.filter(d => d.status === 'Pending' || d.status === 'Sent').length;
  const notGen     = allDocs.filter(d => d.status === 'Not Generated' || d.status === 'Optional').length;
  const completionPct = total > 0 ? Math.round(((total - notGen) / total) * 100) : 0;

  const empCount  = empDocsView.length;
  const orgCount  = orgGroups.reduce((a, g) => a + g.docs.length, 0);
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
                  ? 'No onboarding-trigger documents on record. Create templates under HR > Document Templates with trigger “Onboarding”.'
                  : 'No exit-trigger documents on record. Create templates under HR > Document Templates with trigger “Exit Management”.'}
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
                      <span className="ev-doc-cat">{d.category}</span>
                      <span className={`ev-doc-status ev-doc-status--${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
                      <button type="button"
                        className={`ev-doc-btn ev-doc-btn--view${status === 'Generated' ? ' ev-doc-btn--preview' : ''}`}
                        disabled={disabled || busyKey === d.key}
                        onClick={() => handleViewRow(d)}
                      >
                        {busyKey === d.key && busyAction === 'view'
                          ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Opening…</>
                          : <><i className="ri-eye-line" />{status === 'Generated' ? 'Preview' : 'View'}</>}
                      </button>
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
