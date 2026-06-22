import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Input } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { ShimmerTableRows } from '../components/ui/Shimmer';
import Tooltip from '../components/ui/Tooltip';
import WorklistPager from '../components/ui/WorklistPager';
import SignaturePad from '../components/ui/SignaturePad';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from './hrms/doc-templates/HeaderFooterPanel';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
interface TeamScope { kind: 'all' | 'client' | 'branch' | 'reports' | 'none'; label: string }

interface TeamEmployee {
  id: number;
  emp_code: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  department?: { id: number; name: string } | null;
  designation?: { id: number; name: string; level?: string | null } | null;
  reportingManager?: { id: number; display_name: string; emp_code: string } | null;
  branch?: { id: number; name: string } | null;
  status: string;
}

type ApprovalModule = 'document_signature' | 'expense' | 'leave';
interface ApprovalItem {
  module: ApprovalModule;
  id: number;
  code: string | null;
  title: string;
  subject_name: string;
  subject_dept: string;
  action: string;            // Sign | Approve | Review & Acknowledge
  status: string;
  days_left: number | null;
  created_at: string;
  raw: any;                  // full signature row (frozen content + signers)
}

interface ApprovalsResponse {
  scope: TeamScope;
  approvals: ApprovalItem[];
  counts: { total: number; document_signature: number; expense: number; leave: number };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function MyTeam() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [tab, setTab] = useState<'employees' | 'approvals'>('employees');
  const [scope, setScope] = useState<TeamScope | null>(null);

  // Employees tab
  const [empLoading, setEmpLoading] = useState(true);
  const [employees, setEmployees] = useState<TeamEmployee[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  // Approvals tab
  const [apprLoading, setApprLoading] = useState(true);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalCounts, setApprovalCounts] = useState<ApprovalsResponse['counts']>({ total: 0, document_signature: 0, expense: 0, leave: 0 });

  // Action modal for "Take Action" buttons
  const [actionItem, setActionItem] = useState<ApprovalItem | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionName, setActionName] = useState('');
  const [actionNote, setActionNote] = useState('');
  // Signature mode + drawn-PNG state for the Sign step. Reset each time the
  // action modal opens (see openAction below).
  // Single PNG data URL produced by the signature pad regardless of which
  // mode (Type/Draw/Upload) the user picked.
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);

  // View-only preview modal — opens the locked document without the
  // action form, so approvers can read first and decide later.
  const [viewItem, setViewItem] = useState<ApprovalItem | null>(null);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadEmployees = async () => {
    try {
      setEmpLoading(true);
      const { data } = await api.get('/my-team/employees');
      setEmployees(Array.isArray(data?.employees) ? data.employees : []);
      if (data?.scope) setScope(data.scope);
    } catch (err: any) {
      toast.error('Could not load team', err?.response?.data?.message || 'Please try again.');
      setEmployees([]);
    } finally {
      setEmpLoading(false);
    }
  };

  const loadApprovals = async () => {
    try {
      setApprLoading(true);
      const { data } = await api.get<ApprovalsResponse>('/my-team/approvals');
      setApprovals(Array.isArray(data?.approvals) ? data.approvals : []);
      setApprovalCounts(data?.counts || { total: 0, document_signature: 0, expense: 0, leave: 0 });
      if (data?.scope) setScope(data.scope);
    } catch (err: any) {
      toast.error('Could not load approvals', err?.response?.data?.message || 'Please try again.');
      setApprovals([]);
    } finally {
      setApprLoading(false);
    }
  };

  useEffect(() => { loadEmployees(); loadApprovals(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Action handlers ───────────────────────────────────────────────────────
  const openAction = (item: ApprovalItem) => {
    setActionItem(item);
    // Pre-fill the typed-signature field with the user's name for Sign rows.
    setActionName(user?.name || '');
    setActionNote('');
    setDrawnSignature(null);
  };

  const submitAction = async () => {
    if (!actionItem) return;

    // Expense approvals route through the expense-claims controller. Stage
    // (manager vs HR) was resolved server-side in MyTeamController and lives
    // on raw.stage — the SPA just dispatches the matching endpoint.
    if (actionItem.module === 'expense') {
      const stage = actionItem.raw?.stage === 'hr' ? 'hr' : 'manager';
      setActionSubmitting(true);
      try {
        await api.post(`/expense-claims/${actionItem.id}/${stage}-approve`,
          actionNote.trim() ? { comment: actionNote.trim() } : {});
        toast.success('Approved', `${actionItem.code || `Claim #${actionItem.id}`} updated.`);
        setActionItem(null);
        loadApprovals();
      } catch (err: any) {
        toast.error('Could not approve', err?.response?.data?.message || 'Please try again.');
      } finally {
        setActionSubmitting(false);
      }
      return;
    }

    // Leave requests route through the leave-requests controller (manager / HR
    // chain). Remark is optional on approve, posts as `comment`.
    if (actionItem.module === 'leave') {
      setActionSubmitting(true);
      try {
        await api.post(`/leave-requests/${actionItem.id}/approve`,
          actionNote.trim() ? { comment: actionNote.trim() } : {});
        toast.success('Approved', `${actionItem.code || `Leave #${actionItem.id}`} approved.`);
        setActionItem(null);
        loadApprovals();
      } catch (err: any) {
        toast.error('Could not approve', err?.response?.data?.message || 'Please try again.');
      } finally {
        setActionSubmitting(false);
      }
      return;
    }

    const apiAction = actionItem.action === 'Sign' ? 'Sign'
                    : actionItem.action === 'Approve' ? 'Approve'
                    : 'Acknowledge';
    if (apiAction === 'Sign') {
      if (!actionName.trim()) {
        toast.error('Signature required', 'Please type your name to sign.');
        return;
      }
      if (!drawnSignature) {
        toast.error('Signature required', 'Please type, draw, or upload your signature.');
        return;
      }
    }
    setActionSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${actionItem.id}/action`, {
        action:          apiAction,
        signed_name:     apiAction === 'Sign' ? actionName.trim() : null,
        signature_image: apiAction === 'Sign' ? drawnSignature : null,
        note:            actionNote.trim() || null,
      });
      toast.success(
        apiAction === 'Sign' ? 'Signed' : apiAction === 'Approve' ? 'Approved' : 'Acknowledged',
        `${actionItem.code || `Run #${actionItem.id}`} updated.`,
      );
      setActionItem(null);
      loadApprovals();
    } catch (err: any) {
      toast.error('Could not record action', err?.response?.data?.message || 'Please try again.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Rejection — reuses the Note field as the required rejection reason.
  // Hits the controller's /reject endpoint which halts the workflow and
  // stamps an audit-log entry with the reason for the next reviewer.
  const submitReject = async () => {
    if (!actionItem) return;
    const reason = actionNote.trim();
    if (!reason) {
      toast.error('Reason required', 'Add a suggestion in the Note field explaining what should change.');
      return;
    }

    // Expense claims have a dedicated reject endpoint per stage. The remark
    // posts as `comment` (not `reason`) to match ExpenseClaimController.
    if (actionItem.module === 'expense') {
      const stage = actionItem.raw?.stage === 'hr' ? 'hr' : 'manager';
      const targetItem = actionItem;
      const itemId = targetItem.id;
      const claimCode = targetItem.code || 'this expense claim';
      // Close the action modal while confirming so we don't stack two
      // popups. Restore on cancel / API error so the user keeps their
      // reason and can retry.
      setActionItem(null);
      const okClaim = await confirmDialog({
        title: 'Reject Expense Claim?',
        message: (
          <>
            Reject <strong>{claimCode}</strong>? The employee will see your remark in the audit log.
          </>
        ),
        confirmLabel: 'Yes, Reject',
        cancelLabel:  'Cancel',
        tone:         'danger',
        icon:         'close-circle-line',
      });
      if (!okClaim) {
        setActionItem(targetItem);
        return;
      }
      setActionSubmitting(true);
      try {
        await api.post(`/expense-claims/${itemId}/${stage}-reject`, { comment: reason });
        toast.success('Rejected', `${claimCode} returned to the employee with your remark.`);
        loadApprovals();
      } catch (err: any) {
        toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
        setActionItem(targetItem);
      } finally {
        setActionSubmitting(false);
      }
      return;
    }

    // Leave requests — dedicated reject endpoint; remark posts as `comment`.
    if (actionItem.module === 'leave') {
      const targetItem = actionItem;
      const itemId = targetItem.id;
      const lvCode = targetItem.code || 'this leave request';
      setActionItem(null);
      const okLeave = await confirmDialog({
        title: 'Reject Leave Request?',
        message: (
          <>
            Reject <strong>{lvCode}</strong>? The employee will see your remark.
          </>
        ),
        confirmLabel: 'Yes, Reject',
        cancelLabel:  'Cancel',
        tone:         'danger',
        icon:         'close-circle-line',
      });
      if (!okLeave) {
        setActionItem(targetItem);
        return;
      }
      setActionSubmitting(true);
      try {
        await api.post(`/leave-requests/${itemId}/reject`, { comment: reason });
        toast.success('Rejected', `${lvCode} returned to the employee with your remark.`);
        loadApprovals();
      } catch (err: any) {
        toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
        setActionItem(targetItem);
      } finally {
        setActionSubmitting(false);
      }
      return;
    }

    const targetItem = actionItem;
    const itemId = targetItem.id;
    const docCode = targetItem.code || 'this document';
    setActionItem(null);
    const okDoc = await confirmDialog({
      title: 'Reject Document?',
      message: (
        <>
          Reject <strong>{docCode}</strong>? The workflow will halt and the sender will see your reason.
        </>
      ),
      confirmLabel: 'Yes, Reject',
      cancelLabel:  'Cancel',
      tone:         'danger',
      icon:         'close-circle-line',
    });
    if (!okDoc) {
      setActionItem(targetItem);
      return;
    }
    setActionSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${itemId}/reject`, { reason });
      toast.success('Rejected', `${docCode} returned to the sender with your reason.`);
      loadApprovals();
    } catch (err: any) {
      toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
      // On API failure, bring the action modal back so the user keeps
      // their reason and can retry without re-opening from the list.
      setActionItem(targetItem);
    } finally {
      setActionSubmitting(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    const needle = empSearch.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter(e =>
      (e.display_name || '').toLowerCase().includes(needle) ||
      (e.emp_code || '').toLowerCase().includes(needle) ||
      (e.email || '').toLowerCase().includes(needle) ||
      (e.department?.name || '').toLowerCase().includes(needle)
    );
  }, [employees, empSearch]);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="rec-page myteam-page">
            <MyTeamDarkStyles />
            {/* Header strip — same shape as the Clients / Branches module headers. */}
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-team-line" /></div>
                <div className="min-w-0">
                  <div className="frm-cstrip-title">My Team</div>
                  <div className="frm-cstrip-sub">{scope?.label || 'Loading…'}</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="d-flex gap-2 mb-3">
              <button type="button" onClick={() => setTab('employees')}
                className={`myteam-tab${tab === 'employees' ? ' is-active' : ''}`}
                style={tabBtnStyle(tab === 'employees', '#6366f1')}>
                <i className="ri-team-line me-1" /> Employee List
                <span className={`myteam-tab-count${tab === 'employees' ? ' is-active' : ''}`} style={countPillStyle(tab === 'employees')}>{employees.length}</span>
              </button>
              <button type="button" onClick={() => setTab('approvals')}
                className={`myteam-tab${tab === 'approvals' ? ' is-active' : ''}`}
                style={tabBtnStyle(tab === 'approvals', '#16a34a')}>
                <i className="ri-checkbox-circle-line me-1" /> Approval List
                <span className={`myteam-tab-count${tab === 'approvals' ? ' is-active' : ''}`} style={countPillStyle(tab === 'approvals')}>{approvalCounts.total}</span>
              </button>
            </div>

            {tab === 'employees' && (
              <EmployeesPanel
                rows={filteredEmployees}
                loading={empLoading}
                search={empSearch}
                setSearch={setEmpSearch}
              />
            )}

            {tab === 'approvals' && (
              <ApprovalsPanel
                rows={approvals}
                loading={apprLoading}
                counts={approvalCounts}
                onAct={openAction}
                onView={(item) => setViewItem(item)}
              />
            )}
          </div>
        </Col>
      </Row>

      {/* Action modal — opens for Sign / Approve / Acknowledge.
          Renders the locked document preview so the signer reviews before
          committing. Same shape as the modal inside the Evidence Vault. */}
      {actionItem && (
        <ActionModal
          item={actionItem}
          onClose={() => setActionItem(null)}
          actionName={actionName} setActionName={setActionName}
          actionNote={actionNote} setActionNote={setActionNote}
          drawnSignature={drawnSignature} setDrawnSignature={setDrawnSignature}
          submitting={actionSubmitting}
          onSubmit={submitAction}
          onReject={submitReject}
        />
      )}

      {/* Read-only view modal — pure preview, no action form. The footer
          carries a CTA that hands off to the action modal so the user can
          review first and act from inside the preview without losing context. */}
      {viewItem && (
        <ViewModal
          item={viewItem}
          onClose={() => setViewItem(null)}
          onTakeAction={() => { const v = viewItem; setViewItem(null); openAction(v); }}
        />
      )}
    </>
  );
}

/* ── Employees panel ───────────────────────────────────────────────────────── */
function EmployeesPanel({
  rows, loading, search, setSearch,
}: {
  rows: TeamEmployee[]; loading: boolean;
  search: string; setSearch: (v: string) => void;
}) {
  // Dynamic pagination — same WorklistPager the recruitment table uses.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = rows.slice(sliceFrom, sliceFrom + pageSize);
  useEffect(() => { setPage(1); }, [search, rows.length]);
  return (
    <Card style={{ borderRadius: 12 }}>
      <CardBody style={{ padding: 0 }}>
        <div className="myteam-filter-row d-flex flex-wrap gap-2 align-items-center" style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
          <div className="rec-req-search search-box" style={{ flex: '1 1 260px', minWidth: 260 }}>
            <Input type="text" className="form-control" placeholder="Search by name, code, email…" value={search} onChange={e => setSearch(e.target.value)} />
            <i className="ri-search-line search-icon" />
          </div>
          <span className="ms-auto" style={{ fontSize: 11.5, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', padding: '5px 12px', borderRadius: 999 }}>
            {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
          </span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0 myteam-table" style={{ fontSize: 13 }}>
            <thead className="myteam-thead" style={{ background: '#f5f3ff' }}>
              <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                <th style={{ padding: '10px 12px', width: 44 }}>Sr No</th>
                <th>Employee</th>
                <th>Code</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Reports To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <ShimmerTableRows rows={5} cols={8} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="myteam-empty" style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                  <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                  No employees in your team yet.
                </td></tr>
              ) : (
                visible.map((e, i) => (
                  <tr key={e.id}>
                    <td>{sliceFrom + i + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span className="myteam-avatar" style={{ width: 32, height: 32, borderRadius: '50%', background: '#eef2ff', color: '#4338ca', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                          {(e.display_name || e.first_name || 'E').split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase()}
                        </span>
                        <div>
                          <div className="myteam-emp-name" style={{ fontWeight: 700 }}>{e.display_name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || '—'}</div>
                          <div className="myteam-muted" style={{ fontSize: 11.5, color: '#6b7280' }}>{e.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><code className="myteam-code-pill" style={{ fontSize: 11, background: '#fef3c7', color: '#a16207', padding: '2px 6px', borderRadius: 4 }}>{e.emp_code || '—'}</code></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.designation?.name || '—'}</div>
                      {e.designation?.level && <div className="myteam-muted" style={{ fontSize: 11.5, color: '#6b7280' }}>{e.designation.level}</div>}
                    </td>
                    <td>{e.department?.name || '—'}</td>
                    <td>{e.branch?.name || '—'}</td>
                    <td>{e.reportingManager?.display_name || '—'}</td>
                    <td>
                      <span className="myteam-status-pill" style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: '#dcfce7', color: '#15803d' }}>
                        {e.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination — same WorklistPager (dynamic rows-per-page) as the
            recruitment table. */}
        <WorklistPager
          total={rows.length}
          page={safePage}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      </CardBody>
    </Card>
  );
}

/* ── Approvals panel ───────────────────────────────────────────────────────── */
function ApprovalsPanel({
  rows, loading, counts, onAct, onView,
}: {
  rows: ApprovalItem[]; loading: boolean;
  counts: ApprovalsResponse['counts'];
  onAct: (item: ApprovalItem) => void;
  onView: (item: ApprovalItem) => void;
}) {
  return (
    <>
      {/* KPI strip — module breakdown */}
      <div className="row g-2 mb-3">
        {[
          { label: 'Total Pending',     value: counts.total,              icon: 'ri-inbox-line',         gradient: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)', deep: '#4338ca' },
          { label: 'Document Signing',  value: counts.document_signature, icon: 'ri-quill-pen-line',     gradient: 'linear-gradient(135deg,#0ea5e9 0%,#3b82f6 100%)', deep: '#1d4ed8' },
          { label: 'Expense Approvals', value: counts.expense,            icon: 'ri-bill-line',          gradient: 'linear-gradient(135deg,#f7b84b 0%,#fbc763 100%)', deep: '#a16207' },
          { label: 'Leave Approvals',   value: counts.leave,              icon: 'ri-calendar-2-line',    gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
        ].map(k => (
          <div key={k.label} className="col-md-3 col-sm-6">
            <div className="myteam-kpi-tile" style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden', cursor: 'default' }}>
              <div style={{ height: 4, background: k.gradient }} />
              <div className="d-flex align-items-center justify-content-between" style={{ padding: '12px 14px' }}>
                <div>
                  <div className="myteam-kpi-num" style={{ fontSize: 24, fontWeight: 800, color: k.deep, lineHeight: 1 }}>{k.value}</div>
                  <div className="myteam-kpi-label" style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', letterSpacing: 0.05, textTransform: 'uppercase', marginTop: 6 }}>{k.label}</div>
                </div>
                <span className="myteam-kpi-icon" style={{ width: 40, height: 40, borderRadius: 10, background: k.gradient, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                  <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Card style={{ borderRadius: 12 }}>
        <CardBody style={{ padding: 0 }}>
          <div className="table-responsive">
            <table className="table align-middle mb-0 myteam-table" style={{ fontSize: 13 }}>
              <thead className="myteam-thead-green" style={{ background: '#f0fdf4' }}>
                <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                  <th style={{ padding: '10px 12px', width: 44 }}>Sr No</th>
                  <th>Module</th>
                  <th>Document / Request</th>
                  <th>Subject</th>
                  <th>Action</th>
                  <th>Sent</th>
                  <th style={{ width: 240 }}>Take Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ShimmerTableRows rows={5} cols={7} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="myteam-empty" style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                    <i className="ri-checkbox-circle-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                    No pending approvals — you're all caught up.
                  </td></tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.module}-${r.id}`}>
                      <td>{i + 1}</td>
                      <td>
                        <span
                          className="myteam-module-pill"
                          style={{
                            padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                            background: r.module === 'expense' ? '#fef3c7' : r.module === 'leave' ? '#dcfce7' : '#dbeafe',
                            color:      r.module === 'expense' ? '#a16207' : r.module === 'leave' ? '#15803d' : '#1d4ed8',
                          }}
                        >
                          <i
                            className={
                              r.module === 'expense' ? 'ri-bill-line me-1'
                              : r.module === 'leave' ? 'ri-calendar-2-line me-1'
                              : 'ri-quill-pen-line me-1'
                            }
                          />
                          {moduleLabel(r.module)}
                        </span>
                      </td>
                      <td>
                        <div className="myteam-emp-name" style={{ fontWeight: 700 }}>{r.title}</div>
                        {r.code && <code className="myteam-code-pill" style={{ fontSize: 10.5, background: '#fef3c7', color: '#a16207', padding: '1px 6px', borderRadius: 4 }}>{r.code}</code>}
                      </td>
                      <td>
                        <div>{r.subject_name}</div>
                        <div className="myteam-muted" style={{ fontSize: 11.5, color: '#6b7280' }}>{r.subject_dept}</div>
                      </td>
                      <td>
                        <span className={`myteam-action-pill myteam-action-${r.action}`} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                          background: r.action === 'Sign' ? '#fef3c7' : r.action === 'Approve' ? '#dcfce7' : '#e0e7ff',
                          color: r.action === 'Sign' ? '#92400e' : r.action === 'Approve' ? '#15803d' : '#4338ca' }}>
                          {r.action}
                        </span>
                      </td>
                      <td className="myteam-muted" style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <div className="d-flex gap-1 flex-wrap">
                          {r.module === 'document_signature' && (
                            <Tooltip label="Preview the document before taking action">
                              <button type="button" onClick={() => onView(r)}
                                aria-label="Preview document"
                                className="myteam-view-btn"
                                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                <i className="ri-eye-line me-1" />View
                              </button>
                            </Tooltip>
                          )}
                          {/* Neutral "Review" trigger — opens the decision
                              dialog where the user can add a remark and
                              choose Approve or Reject. Action verb sits in
                              the ACTION column so it's still discoverable. */}
                          <Tooltip label="Open the decision dialog to Approve or Reject">
                            <button type="button" onClick={() => onAct(r)}
                              aria-label="Review and decide"
                              style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              <i className="ri-checkbox-circle-line me-1" />
                              Review &amp; Decide
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Action modal ──────────────────────────────────────────────────────────── */
function ActionModal({
  item, onClose,
  actionName, setActionName,
  actionNote, setActionNote,
  drawnSignature, setDrawnSignature,
  submitting, onSubmit, onReject,
}: {
  item: ApprovalItem; onClose: () => void;
  actionName: string; setActionName: (v: string) => void;
  actionNote: string; setActionNote: (v: string) => void;
  drawnSignature: string | null; setDrawnSignature: (v: string | null) => void;
  submitting: boolean; onSubmit: () => void; onReject: () => void;
}) {
  const isSign = item.action === 'Sign';
  const isExpense = item.module === 'expense';
  const header = { ...DEFAULT_HEADER, ...(item.raw?.header_config || {}) } as HeaderConfig;
  const footer = { ...DEFAULT_FOOTER, ...(item.raw?.footer_config || {}) } as FooterConfig;

  return (
    <div className="myteam-modal-backdrop" style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="myteam-modal-card" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <strong style={{ fontSize: 15 }}><i className="ri-checkbox-circle-line me-2" />Review &amp; Decide</strong>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>
                Action requested: <strong>{item.action}</strong>{item.code ? ` · ${item.code}` : ''}
                {isExpense && item.raw?.stage ? ` · ${item.raw.stage === 'hr' ? 'HR / Finance stage' : 'Manager stage'}` : ''}
              </div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                Add a remark below, then choose <strong>{item.action}</strong> or <strong>Reject</strong>.
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div className="myteam-modal-body" style={{ padding: 16, overflowY: 'auto', background: '#f9fafb', flex: 1 }}>
          {isExpense ? (
            <ExpenseSummaryCard item={item} />
          ) : (
            <HeaderFooterPanel header={header} setHeader={() => {}} footer={footer} setFooter={() => {}} readOnly>
              <div className="tpl-readonly-preview"
                style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 220 }}
                dangerouslySetInnerHTML={{ __html: item.raw?.content_html || '<p>(empty)</p>' }}
              />
            </HeaderFooterPanel>
          )}

          <div className="myteam-form-card" style={{ marginTop: 14, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
            {isSign && (
              <>
                <label className="myteam-input-label" style={inputLabelStyle}>
                  Signer name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input type="text" value={actionName} onChange={e => setActionName(e.target.value)}
                  placeholder="Your full name (used in the audit trail)"
                  className="myteam-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 12 }} />
                <label className="myteam-input-label" style={inputLabelStyle}>
                  Signature <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <SignaturePad
                  typedName={actionName}
                  onChange={(v) => setDrawnSignature(v.dataUrl)}
                  height={150}
                />
              </>
            )}
            <label className="myteam-input-label" style={{ ...inputLabelStyle, marginTop: isSign ? 12 : 0 }}>Remark</label>
            <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
              placeholder="Add a remark — optional when approving, REQUIRED when rejecting (describe what should change)."
              rows={3} className="myteam-input" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
            <div className="myteam-hint" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Remarks land in the audit trail. Rejection also halts the workflow and returns the document to the sender.
            </div>
          </div>
        </div>
        <div className="myteam-modal-footer" style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Reject lives on the left so it's visually separated from the
              positive action; both are still primary buttons. */}
          <button type="button" onClick={onReject} disabled={submitting || !actionNote.trim()}
            title={actionNote.trim() ? 'Reject with this reason' : 'Add a reason in the Note field first'}
            style={{ padding: '7px 14px', background: actionNote.trim() ? 'linear-gradient(135deg,#dc2626,#ef4444)' : '#fee2e2', color: actionNote.trim() ? '#fff' : '#b91c1c', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: actionNote.trim() ? 'pointer' : 'not-allowed', opacity: actionNote.trim() ? 1 : 0.7 }}>
            <i className="ri-close-circle-line me-1" />Reject &amp; Send Back
          </button>
          <div className="d-flex gap-2">
            <button type="button" onClick={onClose} disabled={submitting}
              className="myteam-btn-ghost"
              style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Cancel
            </button>
            {/* Primary action — green for Approve, blue for Sign, indigo
                for Review & Acknowledge. Colour cues match the meaning of
                the button so the decision is unambiguous. */}
            <button type="button" onClick={onSubmit}
              disabled={submitting || (isSign && (!actionName.trim() || !drawnSignature))}
              style={{
                padding: '7px 16px',
                background: item.action === 'Approve'
                  ? 'linear-gradient(135deg,#16a34a,#22c55e)'
                  : isSign
                    ? 'linear-gradient(135deg,#0ea5e9,#3b82f6)'
                    : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
              }}>
              <i className={isSign ? 'ri-quill-pen-line' : item.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
              {submitting ? 'Submitting…' : item.action}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Read-only view modal ──────────────────────────────────────────────────── */
function ViewModal({
  item, onClose, onTakeAction,
}: {
  item: ApprovalItem; onClose: () => void; onTakeAction: () => void;
}) {
  const header = { ...DEFAULT_HEADER, ...(item.raw?.header_config || {}) } as HeaderConfig;
  const footer = { ...DEFAULT_FOOTER, ...(item.raw?.footer_config || {}) } as FooterConfig;
  return (
    <div className="myteam-modal-backdrop" style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="myteam-modal-card" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)', color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="min-w-0">
              <strong style={{ fontSize: 15 }}><i className="ri-file-search-line me-2" />Document Preview</strong>
              <div style={{ fontSize: 11.5, opacity: 0.85 }}>{item.title} · {item.code}</div>
              <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>
                Subject: <strong>{item.subject_name}</strong> · Pending {item.action}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div className="myteam-modal-body" style={{ padding: 16, overflowY: 'auto', background: '#f9fafb', flex: 1 }}>
          <HeaderFooterPanel header={header} setHeader={() => {}} footer={footer} setFooter={() => {}} readOnly>
            <div className="tpl-readonly-preview"
              style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
              dangerouslySetInnerHTML={{ __html: item.raw?.content_html || '<p>(empty)</p>' }}
            />
          </HeaderFooterPanel>
        </div>
        <div className="myteam-modal-footer" style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}
            className="myteam-btn-ghost"
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Close
          </button>
          <button type="button" onClick={onTakeAction}
            style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
            <i className={item.action === 'Sign' ? 'ri-quill-pen-line' : item.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
            Proceed to {item.action}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Expense summary card ──────────────────────────────────────────────────
   Rendered in place of the document preview when the approval item is an
   expense claim. Keeps the same modal chrome (remark + Approve/Reject
   buttons) so the manager / branch user flow feels consistent with the
   document-signature one. */
function ExpenseSummaryCard({ item }: { item: ApprovalItem }) {
  const raw = item.raw || {};
  const stageLabel = raw.stage === 'hr' ? 'HR / Finance approval' : 'Manager approval';
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount || 0);
  const fmtAmount = `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const fmtDate = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  return (
    <div className="myteam-form-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {stageLabel}
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 2 }}>
            {item.title}{item.code ? <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}> · {item.code}</span> : null}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#a16207' }}>{fmtAmount}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{(raw.currency as string) || 'INR'}</div>
        </div>
      </div>
      <div className="row g-3" style={{ fontSize: 13 }}>
        <ExpenseField label="Employee"   value={(raw.employee_name as string) || item.subject_name} sub={(raw.employee_code as string) || ''} />
        <ExpenseField label="Department" value={(raw.department_name as string) || item.subject_dept} />
        <ExpenseField label="Category"   value={(raw.category_name as string) || '—'} />
        <ExpenseField label="Expense Date" value={fmtDate(raw.expense_date as string)} />
        <ExpenseField label="Supplier"   value={(raw.vendor as string) || '—'} />
        <ExpenseField label="Project"    value={(raw.project as string) || '—'} />
        <ExpenseField label="Payment"    value={(raw.payment_method as string) || '—'} />
        <ExpenseField label="Reporting Manager" value={(raw.manager_name as string) || '—'} />
      </div>
      {raw.purpose ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
            Purpose
          </div>
          <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{raw.purpose}</div>
        </div>
      ) : null}
    </div>
  );
}

function ExpenseField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="col-md-6">
      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', marginTop: 2 }}>{value || '—'}</div>
      {sub ? <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div> : null}
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────────── */
function moduleLabel(m: ApprovalModule): string {
  return m === 'document_signature' ? 'Document Signing'
       : m === 'expense'           ? 'Expense Claim'
       : m === 'leave'             ? 'Leave Request'
       : m;
}

function tabBtnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', borderRadius: 10,
    border: '1px solid ' + (active ? color : '#e5e7eb'),
    background: active ? color : '#fff',
    color: active ? '#fff' : '#374151',
    cursor: 'pointer', fontWeight: 700, fontSize: 13.5,
  };
}
function countPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '2px 9px', borderRadius: 999, fontSize: 11,
    background: active ? 'rgba(255,255,255,0.25)' : '#f3f4f6',
    color: active ? '#fff' : '#6b7280', fontWeight: 800,
  };
}
const inputLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4,
};

/* Dark-theme overrides. Page-scoped via .myteam-page; modals (rendered as
   siblings of the page) are matched on their own class names so the overrides
   land regardless of mount location. */
function MyTeamDarkStyles() {
  return (
    <style>{`
      /* ── KPI card polish — mirrors the .hr-emp-kpi-card pattern on the
         HR Employees page so both pages feel like the same product:
         soft elevation in rest, a 4px translateY lift + richer shadow
         + violet border + icon scale on hover. Tile-level transition
         covers transform, shadow and border to keep the motion buttery. */
      .myteam-page .myteam-kpi-tile {
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        box-shadow:
          0 6px 16px -4px rgba(15, 23, 42, 0.10),
          0 2px 4px rgba(15, 23, 42, 0.06);
        background-image: linear-gradient(180deg, rgba(124,92,252,0.04) 0%, rgba(124,92,252,0) 60%);
      }
      .myteam-page .myteam-kpi-tile:hover {
        transform: translateY(-4px);
        box-shadow:
          0 16px 32px -8px rgba(15, 23, 42, 0.18),
          0 4px 10px rgba(124, 92, 252, 0.10);
        border-color: rgba(124, 92, 252, 0.45) !important;
      }
      .myteam-page .myteam-kpi-icon {
        transition: transform .18s ease, box-shadow .18s ease;
      }
      .myteam-page .myteam-kpi-tile:hover .myteam-kpi-icon {
        transform: scale(1.06);
        box-shadow: 0 8px 18px rgba(0,0,0,0.18);
      }

      /* ── Table polish — align with HrEmployees / Branches tables:
         consistent 12.5–13px body font, snug header (10.5px,
         uppercase, 0.05em letter-spacing), generous 12px vertical
         row padding so chips/avatars breathe, and a hover row tint
         that matches the violet brand wash. */
      .myteam-page .myteam-table tbody td {
        padding: 12px 12px;
        font-size: 12.75px;
        vertical-align: middle;
        border-bottom: 1px solid var(--vz-border-color, #f3f4f6);
      }
      .myteam-page .myteam-table tbody tr {
        transition: background .15s ease;
      }
      .myteam-page .myteam-table tbody tr:hover td {
        background: rgba(124,92,252,0.04);
      }
      .myteam-page .myteam-thead th,
      .myteam-page .myteam-thead-green th {
        padding: 11px 12px !important;
        font-size: 10.5px !important;
        font-weight: 800 !important;
        letter-spacing: 0.05em !important;
        text-transform: uppercase;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-table tbody tr:hover td {
        background: rgba(124,92,252,0.10);
      }
      [data-bs-theme="dark"] .myteam-page .myteam-kpi-tile {
        background-image: linear-gradient(180deg, rgba(124,92,252,0.10) 0%, rgba(124,92,252,0) 70%);
        box-shadow:
          0 8px 20px -4px rgba(0, 0, 0, 0.55),
          0 2px 6px rgba(0, 0, 0, 0.35);
      }
      [data-bs-theme="dark"] .myteam-page .myteam-kpi-tile:hover {
        box-shadow:
          0 18px 36px -8px rgba(0, 0, 0, 0.65),
          0 4px 12px rgba(124, 92, 252, 0.25);
      }

      [data-bs-theme="dark"] .myteam-page .myteam-header-icon {
        background: linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25)) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-tab:not(.is-active) {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-tab-count:not(.is-active) {
        background: rgba(255,255,255,0.08) !important;
        color: rgba(255,255,255,0.65) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-filter-row {
        border-bottom-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-kpi-tile {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-kpi-num { color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-kpi-label { color: rgba(255,255,255,0.55) !important; }

      [data-bs-theme="dark"] .myteam-page .myteam-thead {
        background: rgba(124,92,252,0.14) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-thead-green {
        background: rgba(34,197,94,0.10) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-thead tr,
      [data-bs-theme="dark"] .myteam-page .myteam-thead th,
      [data-bs-theme="dark"] .myteam-page .myteam-thead-green tr,
      [data-bs-theme="dark"] .myteam-page .myteam-thead-green th {
        color: rgba(255,255,255,0.65) !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-table tbody td {
        border-bottom-color: var(--vz-border-color) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .myteam-page .myteam-emp-name { color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-muted { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-empty { color: rgba(255,255,255,0.5) !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-avatar {
        background: rgba(124,92,252,0.20) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-code-pill {
        background: rgba(251,191,36,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-status-pill {
        background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-module-pill {
        background: rgba(96,165,250,0.18) !important; color: #93c5fd !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-action-Sign    { background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-action-Approve { background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important; }
      [data-bs-theme="dark"] .myteam-page .myteam-action-Review\\ \\&\\ Acknowledge,
      [data-bs-theme="dark"] .myteam-page [class*="myteam-action-"]:not(.myteam-action-Sign):not(.myteam-action-Approve) {
        background: rgba(124,92,252,0.18) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .myteam-page .myteam-view-btn {
        background: rgba(99,102,241,0.18) !important; color: #c4b5fd !important;
        border-color: rgba(124,92,252,0.35) !important;
      }

      /* Modals — un-scoped because they render as siblings of the page. */
      [data-bs-theme="dark"] .myteam-modal-card {
        background: var(--vz-card-bg) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .myteam-modal-body {
        background: var(--vz-secondary-bg) !important;
      }
      [data-bs-theme="dark"] .myteam-modal-footer {
        border-top-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .myteam-form-card {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .myteam-input {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .myteam-input::placeholder { color: rgba(255,255,255,0.45) !important; }
      [data-bs-theme="dark"] .myteam-input-label { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .myteam-hint { color: rgba(255,255,255,0.45) !important; }
      [data-bs-theme="dark"] .myteam-btn-ghost {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
    `}</style>
  );
}
