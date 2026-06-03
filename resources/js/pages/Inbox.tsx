import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { ShimmerTableRows, Shimmer } from '../components/ui/Shimmer';
import SignaturePad from '../components/ui/SignaturePad';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from './hrms/doc-templates/HeaderFooterPanel';
import { leaveRequestsApi, ApiLeaveRequest } from './hrms/leavePlansApi';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type SignerState = {
  index: number; role_name: string; action: string; days: number;
  user_id: number | null; name: string;
  status: 'Pending' | 'Done' | 'Rejected' | 'Skipped';
  acted_at: string | null; signed_name: string | null; note: string | null;
};

interface SignatureRun {
  id: number;
  code: string | null;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
  template_id: number;
  template?: { id: number; code: string; name: string; doc_type: string | null } | null;
  employee_id: number;
  employee?: {
    id: number; display_name: string | null; first_name: string | null; last_name: string | null;
    emp_code: string | null; department?: { id: number; name: string } | null;
  } | null;
  content_html: string | null;
  header_config: HeaderConfig | null;
  footer_config: FooterConfig | null;
  signers: SignerState[];
  current_index: number;
  audit_log?: AuditEvent[];
  created_at: string;
}

// One entry in a run's audit trail. A 'reminded' event carries signer_index
// so we can tell whether the nudge was aimed at the slot the current viewer
// is sitting on.
type AuditEvent = {
  at: string;
  actor_id: number | null;
  actor_name: string;
  action: string;
  message: string;
  signer_index?: number;
};

// Most-recent 'reminded' event aimed at this run's CURRENT signer (the person
// whose turn it is, i.e. whoever is looking at this inbox row). Returns null
// when nobody has nudged them yet.
function latestReminder(run: SignatureRun): AuditEvent | null {
  const hits = (run.audit_log || []).filter(
    e => e.action === 'reminded' && (e.signer_index ?? -1) === run.current_index,
  );
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (a.at >= b.at ? a : b));
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Inbox() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();

  const [rows, setRows] = useState<SignatureRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Leave approvals — pending leave requests where the current user is
  // an approver. Reporting managers see their direct reports;
  // branch_user / client_admin / super_admin see every pending request
  // in their tenant (parallel approval — the first one to act wins).
  const [leaveRows, setLeaveRows] = useState<ApiLeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(true);
  const [leaveActing, setLeaveActing] = useState<{ id: number; verdict: 'approve' | 'reject' } | null>(null);
  const [leaveComment, setLeaveComment] = useState<Record<number, string>>({});

  // Expense approvals — pending claims pulled from /my-team/approvals where
  // module = 'expense'. Combines manager-stage (when the user is the assigned
  // reporting manager) and HR-stage (when the user has hr.expense approval
  // permission, e.g. branch admins / client admins). Stage lives on raw.stage
  // so the dispatch knows whether to hit manager-approve or hr-approve.
  type ExpenseApprovalRow = {
    id: number;
    code: string | null;
    title: string;
    subject_name: string;
    subject_dept: string;
    created_at: string;
    raw: {
      stage: 'manager' | 'hr';
      amount: number;
      currency: string | null;
      expense_date: string | null;
      category_name: string | null;
      vendor: string | null;
      employee_name: string | null;
      employee_code: string | null;
      department_name: string | null;
      manager_name: string | null;
      purpose: string | null;
    };
  };
  const [expenseRows, setExpenseRows] = useState<ExpenseApprovalRow[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(true);
  const [expenseActing, setExpenseActing] = useState<{ id: number; verdict: 'approve' | 'reject' } | null>(null);
  const [expenseComment, setExpenseComment] = useState<Record<number, string>>({});

  // Personal claim/advance updates — FYI notifications for claims THIS
  // user filed that managers or HR have just acted on. Read-only; no
  // approve/reject buttons. Sourced from /api/my-team/my-updates.
  type MyUpdate = {
    module: 'expense' | 'advance';
    id: number;
    code: string | null;
    title: string;
    amount: number;
    currency: string | null;
    category: string | null;
    stage: 'manager' | 'hr';
    verdict: 'approved' | 'rejected';
    actor_name: string | null;
    comment: string | null;
    acted_at: string | null;
    final: boolean;
  };
  const [myUpdates, setMyUpdates] = useState<MyUpdate[]>([]);
  const [myUpdatesLoading, setMyUpdatesLoading] = useState(true);

  // Page cursors (4 entries per page). One cursor per section so a
  // scroll-heavy inbox stays manageable without affecting the others.
  const PAGE_SIZE = 4;
  const [leavePage,    setLeavePage]    = useState(0);
  const [expensePage,  setExpensePage]  = useState(0);
  const [updatesPage,  setUpdatesPage]  = useState(0);
  const [docsPage,     setDocsPage]     = useState(0);

  // View modal (read-only preview)
  const [viewRun, setViewRun] = useState<SignatureRun | null>(null);

  // Decision modal — same shape as MyTeam: doc preview + remark + Reject /
  // Approve|Sign|Acknowledge in the footer.
  const [actionRun, setActionRun] = useState<SignatureRun | null>(null);
  const [actionName, setActionName] = useState('');
  const [actionNote, setActionNote] = useState('');
  // Single PNG data URL produced by the signature pad, regardless of which
  // mode (Type/Draw/Upload) the user picked. Reset every time the action
  // modal opens (see openAction).
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get<SignatureRun[]>('/hr-document-signatures/inbox');
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error('Could not load inbox', err?.response?.data?.message || 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Pull pending leave approvals scoped to this user. Same endpoint
  // HrLeaveApprovals uses, just rendered inline in the inbox so the
  // user has one place to clear all pending decisions from.
  const loadLeaves = async () => {
    setLeaveLoading(true);
    try {
      const list = await leaveRequestsApi.approvals({ status: 'Pending' });
      setLeaveRows(list);
    } catch (err: any) {
      console.warn('[Inbox] leave approvals load failed', err);
      setLeaveRows([]);
    } finally {
      setLeaveLoading(false);
    }
  };
  useEffect(() => { loadLeaves(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Pull pending expense approvals scoped to this user. Hits the same
  // unified endpoint MyTeam uses and filters for the expense module so
  // both surfaces stay in sync without duplicating server-side logic.
  const loadExpenses = async () => {
    setExpenseLoading(true);
    try {
      const { data } = await api.get('/my-team/approvals');
      const all = Array.isArray(data?.approvals) ? data.approvals : [];
      const expense: ExpenseApprovalRow[] = all
        .filter((a: any) => a.module === 'expense')
        .map((a: any) => ({
          id: a.id, code: a.code, title: a.title,
          subject_name: a.subject_name, subject_dept: a.subject_dept,
          created_at: a.created_at, raw: a.raw,
        }));
      setExpenseRows(expense);
    } catch (err: any) {
      console.warn('[Inbox] expense approvals load failed', err);
      setExpenseRows([]);
    } finally {
      setExpenseLoading(false);
    }
  };
  useEffect(() => { loadExpenses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Pull FYI notifications about THIS user's own claims (manager/HR has
  // approved or rejected). Distinct from the approvals list — no action
  // buttons, just a status line + actor + comment.
  const loadMyUpdates = async () => {
    setMyUpdatesLoading(true);
    try {
      const { data } = await api.get('/my-team/my-updates');
      setMyUpdates(Array.isArray(data?.updates) ? data.updates : []);
    } catch (err: any) {
      console.warn('[Inbox] my-updates load failed', err);
      setMyUpdates([]);
    } finally {
      setMyUpdatesLoading(false);
    }
  };
  useEffect(() => { loadMyUpdates(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Helper: slice an array for the current page. PAGE_SIZE controls how
  // many rows are shown per section before the user has to page forward.
  const paginate = <T,>(arr: T[], page: number): T[] => arr.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // Tiny pager rendered at the bottom of each section when the list has
  // more than PAGE_SIZE entries. Keeps the inbox compact without dropping
  // any rows from view.
  const Pager = ({ total, page, onChange }: { total: number; page: number; onChange: (n: number) => void }) => {
    if (total <= PAGE_SIZE) return null;
    const pages = Math.ceil(total / PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, pages - 1));
    return (
      <div className="d-flex align-items-center justify-content-between gap-2" style={{ padding: '10px 18px', borderTop: '1px solid #f3f4f6' }}>
        <small style={{ color: '#6b7280', fontSize: 11.5 }}>
          Page {safePage + 1} of {pages} · {total} total
        </small>
        <div className="d-flex gap-1">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            style={{
              border: '1px solid #e5e7eb', background: '#fff',
              padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
              color: safePage === 0 ? '#cbd5e1' : '#374151',
              cursor: safePage === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <i className="ri-arrow-left-s-line" /> Prev
          </button>
          <button
            type="button"
            onClick={() => onChange(Math.min(pages - 1, safePage + 1))}
            disabled={safePage >= pages - 1}
            style={{
              border: '1px solid #e5e7eb', background: '#fff',
              padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
              color: safePage >= pages - 1 ? '#cbd5e1' : '#374151',
              cursor: safePage >= pages - 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Next <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
    );
  };

  const actOnExpense = async (row: ExpenseApprovalRow, verdict: 'approve' | 'reject') => {
    const comment = (expenseComment[row.id] || '').trim();
    if (verdict === 'reject' && !comment) {
      toast.error('Reason required', 'Please add a short comment explaining the rejection.');
      return;
    }
    const stage = row.raw.stage === 'hr' ? 'hr' : 'manager';
    setExpenseActing({ id: row.id, verdict });
    try {
      await api.post(`/expense-claims/${row.id}/${stage}-${verdict}`, comment ? { comment } : {});
      toast.success(
        verdict === 'approve' ? 'Claim approved' : 'Claim rejected',
        verdict === 'approve' ? 'The employee will be notified.' : 'The employee will see your remark.',
      );
      setExpenseComment(prev => { const next = { ...prev }; delete next[row.id]; return next; });
      await loadExpenses();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Action failed';
      toast.error('Could not act on this claim', msg);
    } finally {
      setExpenseActing(null);
    }
  };

  const actOnLeave = async (id: number, verdict: 'approve' | 'reject') => {
    const comment = (leaveComment[id] || '').trim();
    if (verdict === 'reject' && !comment) {
      toast.error('Reason required', 'Please add a short comment explaining the rejection.');
      return;
    }
    setLeaveActing({ id, verdict });
    try {
      if (verdict === 'approve') {
        await leaveRequestsApi.approve(id, comment || undefined);
        toast.success('Leave approved', 'The employee will be notified.');
      } else {
        await leaveRequestsApi.reject(id, comment);
        toast.success('Leave rejected', 'The employee will see your remark.');
      }
      // Clear the comment for this row and refetch so the row drops out
      // of the pending list.
      setLeaveComment(prev => { const next = { ...prev }; delete next[id]; return next; });
      await loadLeaves();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Action failed';
      toast.error('Could not act on this request', msg);
    } finally {
      setLeaveActing(null);
    }
  };

  const openAction = (run: SignatureRun) => {
    const current = run.signers[run.current_index];
    setActionRun(run);
    setActionName(user?.name || current?.name || '');
    setActionNote('');
    setDrawnSignature(null);
  };

  const submitDecision = async (verdict: 'approve' | 'reject') => {
    if (!actionRun) return;
    const current = actionRun.signers[actionRun.current_index];
    if (!current) return;
    const apiAction = current.action === 'Sign' ? 'Sign'
                    : current.action === 'Approve' ? 'Approve'
                    : 'Acknowledge';

    if (verdict === 'reject') {
      const reason = actionNote.trim();
      if (!reason) {
        toast.error('Remark required', 'Add a remark explaining what should change.');
        return;
      }
      // Snapshot the run + close the action modal so the confirm
      // popup isn't stacked on top of the open acknowledge modal.
      // Restore if the user cancels.
      const targetRun = actionRun;
      const runId = targetRun.id;
      const code  = targetRun.code || 'this document';
      setActionRun(null);
      const ok = await confirmDialog({
        title: 'Reject Document?',
        message: (
          <>
            Reject <strong>{code}</strong>? The workflow will halt and the sender will see your remark.
          </>
        ),
        confirmLabel: 'Yes, Reject',
        cancelLabel:  'Cancel',
        tone:         'danger',
        icon:         'close-circle-line',
      });
      if (!ok) {
        setActionRun(targetRun);
        return;
      }
      setSubmitting(true);
      try {
        await api.post(`/hr-document-signatures/${runId}/reject`, { reason });
        toast.success('Rejected', `${code} returned with your remark.`);
        load();
      } catch (err: any) {
        toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
        setActionRun(targetRun);
      } finally { setSubmitting(false); }
      return;
    }

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
    setSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${actionRun.id}/action`, {
        action:          apiAction,
        signed_name:     apiAction === 'Sign' ? actionName.trim() : null,
        // PNG data URL from the signature pad — produced regardless of which
        // mode (Type/Draw/Upload) the user picked. Backend falls back to a
        // cursive-rendered name when this is absent.
        signature_image: apiAction === 'Sign' ? drawnSignature : null,
        note:            actionNote.trim() || null,
      });
      toast.success(
        apiAction === 'Sign' ? 'Signed' : apiAction === 'Approve' ? 'Approved' : 'Acknowledged',
        `${actionRun.code || `Run #${actionRun.id}`} updated.`,
      );
      setActionRun(null);
      load();
    } catch (err: any) {
      toast.error('Could not record action', err?.response?.data?.message || 'Please try again.');
    } finally { setSubmitting(false); }
  };

  // How many pending documents carry a reminder aimed at the current viewer —
  // drives the header strip badge so "someone nudged you" is visible without
  // opening the bell.
  const reminderCount = rows.filter(r => latestReminder(r) !== null).length;

  return (
    <Row>
      <Col xs={12}>
        <div className="rec-page inbox-page">
          <InboxDarkStyles />
          {/* Header */}
          <Card className="mb-3" style={{ borderRadius: 14 }}>
            <CardBody className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div className="d-flex align-items-center gap-3">
                {/* Back button — uses history.back() when there's prior
                    navigation in the stack, otherwise falls back to the
                    dashboard so a direct-link visit still has somewhere
                    to land. */}
                <button
                  type="button"
                  onClick={() => {
                    if (window.history.length > 1) navigate(-1);
                    else                            navigate('/dashboard');
                  }}
                  aria-label="Back"
                  className="inbox-back-btn d-inline-flex align-items-center justify-content-center"
                  style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: 'var(--vz-card-bg)',
                    border: '1px solid var(--vz-border-color)',
                    color: 'var(--vz-body-color)', cursor: 'pointer',
                    transition: 'background .15s ease, transform .15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--vz-secondary-bg)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--vz-card-bg)'; }}
                >
                  <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                </button>
                {/* Matches the saturated gradient + white-icon treatment
                    the Master category tiles use (see MasterDashboard's
                    CAT_META map). The previous pastel cream-on-brown
                    combo read as washed-out next to the rest of the
                    page; this lifts the icon to brand-equivalent
                    presence. Drop shadow tied to the same amber so the
                    chip floats off the card surface. */}
                <span className="inbox-header-icon" style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: 'linear-gradient(135deg,#f7b84b,#fad07e)',
                  boxShadow: '0 4px 12px rgba(247, 184, 75, 0.32)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <i className="ri-inbox-line" style={{ fontSize: 22, color: '#ffffff' }} />
                </span>
                <div>
                  <h4 className="mb-0 fw-bold">Inbox</h4>
                  <div className="text-muted" style={{ fontSize: 12.5 }}>
                    Documents waiting on your action — sign, approve, or acknowledge.
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                {!loading && reminderCount > 0 && (
                  <span className="inbox-reminder-pill inbox-reminder-pill--header"
                    title="Someone has reminded you to act on these documents">
                    <i className="ri-notification-badge-line" />
                    {reminderCount} reminder{reminderCount === 1 ? '' : 's'}
                  </span>
                )}
                <span style={{ padding: '6px 14px', borderRadius: 999, background: 'linear-gradient(135deg,#f7b84b,#fbc763)', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                  <i className="ri-mail-unread-line me-1" />
                  {loading || leaveLoading || expenseLoading || myUpdatesLoading
                    ? '…'
                    : `${rows.length + leaveRows.length + expenseRows.length} pending${myUpdates.length ? ` · ${myUpdates.length} update${myUpdates.length === 1 ? '' : 's'}` : ''}`}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Leave approval requests ─ shown above the documents section so
              time-sensitive items (people waiting on a yes/no) bubble to the
              top of the inbox. Same endpoint HrLeaveApprovals uses; either
              the reporting manager OR a branch admin can act (first one to
              click wins). */}
          <Card className="mb-3" style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="d-flex align-items-center justify-content-between"
                   style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                <div className="d-flex align-items-center gap-2">
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#ede9fe,#c4b5fd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ri-calendar-2-line" style={{ fontSize: 16, color: '#5a3fd1' }} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Leave Requests</h6>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>
                      Approvals waiting on you. Either the reporting manager or a branch admin can decide.
                    </div>
                  </div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: '#ede9fe', color: '#5a3fd1', fontWeight: 700, fontSize: 11.5 }}>
                  {leaveLoading ? '…' : `${leaveRows.length}`}
                </span>
              </div>

              {leaveLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`leave-shim-${i}`} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div style={{ flex: '1 1 320px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div className="d-flex align-items-center gap-2">
                            <Shimmer width={140} height={13} />
                            <Shimmer width={80} height={11} />
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            <Shimmer width={60} height={18} radius={6} />
                            <Shimmer width={180} height={11} />
                          </div>
                          <Shimmer height={32} radius={6} />
                        </div>
                        <div className="d-flex flex-column gap-2" style={{ minWidth: 140 }}>
                          <Shimmer height={32} radius={8} />
                          <Shimmer height={32} radius={8} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : leaveRows.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                  <i className="ri-flight-takeoff-line" style={{ fontSize: 30, display: 'block', marginBottom: 6 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No pending leave requests</div>
                  <div style={{ fontSize: 11.5 }}>You're all caught up on approvals.</div>
                </div>
              ) : (
                <div>
                  {paginate(leaveRows, leavePage).map((r) => {
                    const emp = r.employee;
                    const empName = emp
                      ? (emp.display_name?.trim() || `${emp.first_name} ${emp.last_name ?? ''}`.trim())
                      : '—';
                    const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0,2).toUpperCase() || '?';
                    const acting = leaveActing?.id === r.id;
                    const isApproving = acting && leaveActing?.verdict === 'approve';
                    const isRejecting = acting && leaveActing?.verdict === 'reject';
                    const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                    return (
                      <div key={r.id} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          {/* Avatar */}
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{ width: 38, height: 38, fontSize: 12, background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' }}>
                            {initials}
                          </span>
                          {/* Body */}
                          <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong style={{ fontSize: 13.5 }}>{empName}</strong>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>
                                {emp?.emp_code || '—'}
                                {emp?.department?.name ? ` · ${emp.department.name}` : ''}
                              </span>
                            </div>
                            <div className="mt-1" style={{ fontSize: 12.5 }}>
                              <span style={{ padding: '2px 8px', borderRadius: 6, background: '#ede9fe', color: '#5a3fd1', fontWeight: 700, fontSize: 11 }}>
                                {r.leave_type?.name || 'Leave'}
                              </span>
                              <span className="ms-2 text-muted">{fmt(r.from_date)} – {fmt(r.to_date)}</span>
                              <span className="ms-2 fw-semibold">{Number(r.days)} {Number(r.days) === 1 ? 'day' : 'days'}</span>
                            </div>
                            {r.reason && (
                              <div className="mt-1 text-muted" style={{ fontSize: 12 }}>
                                <i className="ri-double-quotes-l me-1" />{r.reason}
                              </div>
                            )}
                            {/* Comment input — required when rejecting, optional when approving */}
                            <input
                              type="text"
                              className="form-control mt-2"
                              placeholder="Add a remark (required for reject, optional for approve)"
                              value={leaveComment[r.id] || ''}
                              onChange={e => setLeaveComment(prev => ({ ...prev, [r.id]: e.target.value }))}
                              style={{ fontSize: 12.5 }}
                            />
                          </div>
                          {/* Actions */}
                          <div className="d-flex flex-column gap-2" style={{ minWidth: 140 }}>
                            <button
                              type="button"
                              onClick={() => actOnLeave(r.id, 'approve')}
                              disabled={acting}
                              style={{
                                padding: '8px 12px', borderRadius: 8, border: 0,
                                background: 'linear-gradient(135deg,#10b981,#059669)',
                                color: '#fff', fontSize: 12, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer',
                                opacity: acting ? 0.6 : 1,
                              }}
                            >
                              {isApproving ? <><i className="ri-loader-4-line ri-spin me-1" />Approving…</> : <><i className="ri-check-line me-1" />Accept</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnLeave(r.id, 'reject')}
                              disabled={acting}
                              style={{
                                padding: '8px 12px', borderRadius: 8,
                                border: '1px solid #fecaca',
                                background: '#fff', color: '#b91c1c',
                                fontSize: 12, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer',
                                opacity: acting ? 0.6 : 1,
                              }}
                            >
                              {isRejecting ? <><i className="ri-loader-4-line ri-spin me-1" />Rejecting…</> : <><i className="ri-close-line me-1" />Reject</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Pager total={leaveRows.length} page={leavePage} onChange={setLeavePage} />
            </CardBody>
          </Card>

          {/* Expense claims ─ pending approvals where the current user is
              either the assigned reporting manager (manager stage) or
              someone with HR/Finance approval rights (hr stage). raw.stage
              decides which controller endpoint each action call dispatches. */}
          <Card className="mb-3" style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="d-flex align-items-center justify-content-between"
                   style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                <div className="d-flex align-items-center gap-2">
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ri-bill-line" style={{ fontSize: 16, color: '#a16207' }} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Expense Claims</h6>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>
                      Approvals waiting on you — reporting managers see manager-stage rows, branch admins see HR-stage rows.
                    </div>
                  </div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: '#fef3c7', color: '#a16207', fontWeight: 700, fontSize: 11.5 }}>
                  {expenseLoading ? '…' : `${expenseRows.length}`}
                </span>
              </div>

              {expenseLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`exp-shim-${i}`} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div style={{ flex: '1 1 320px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div className="d-flex align-items-center gap-2">
                            <Shimmer width={140} height={13} />
                            <Shimmer width={90} height={11} />
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            <Shimmer width={70} height={18} radius={6} />
                            <Shimmer width={100} height={11} />
                            <Shimmer width={80} height={11} />
                          </div>
                          <Shimmer height={32} radius={6} />
                        </div>
                        <div className="d-flex flex-column gap-2" style={{ minWidth: 140 }}>
                          <Shimmer height={32} radius={8} />
                          <Shimmer height={32} radius={8} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : expenseRows.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                  <i className="ri-wallet-3-line" style={{ fontSize: 30, display: 'block', marginBottom: 6 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No pending expense claims</div>
                  <div style={{ fontSize: 11.5 }}>You're all caught up on reimbursements.</div>
                </div>
              ) : (
                <div>
                  {paginate(expenseRows, expensePage).map((r) => {
                    const empName = r.raw.employee_name || r.subject_name || '—';
                    const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
                    const acting = expenseActing?.id === r.id;
                    const isApproving = acting && expenseActing?.verdict === 'approve';
                    const isRejecting = acting && expenseActing?.verdict === 'reject';
                    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                    const fmtAmt = `₹${Number(r.raw.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                    const stageLabel = r.raw.stage === 'hr' ? 'HR / Finance stage' : 'Manager stage';
                    return (
                      <div key={r.id} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{ width: 38, height: 38, fontSize: 12, background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                            {initials}
                          </span>
                          <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong style={{ fontSize: 13.5 }}>{empName}</strong>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>
                                {r.raw.employee_code || '—'}
                                {r.raw.department_name ? ` · ${r.raw.department_name}` : ''}
                              </span>
                            </div>
                            <div className="mt-1 d-flex align-items-center flex-wrap gap-2" style={{ fontSize: 12.5 }}>
                              <span style={{ padding: '2px 8px', borderRadius: 6, background: '#fef3c7', color: '#a16207', fontWeight: 700, fontSize: 11 }}>
                                {r.raw.category_name || 'Expense'}
                              </span>
                              {r.code && (
                                <code style={{ fontSize: 10.5, background: '#f3f4f6', color: '#4b5563', padding: '1px 6px', borderRadius: 4 }}>
                                  {r.code}
                                </code>
                              )}
                              <span className="text-muted">· {fmtDate(r.raw.expense_date)}</span>
                              <span className="fw-bold" style={{ color: '#a16207' }}>· {fmtAmt}</span>
                              <span style={{ padding: '1px 7px', borderRadius: 999, background: r.raw.stage === 'hr' ? '#e0e7ff' : '#dcfce7', color: r.raw.stage === 'hr' ? '#4338ca' : '#15803d', fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                                {stageLabel}
                              </span>
                            </div>
                            {r.title && r.title !== 'Expense Claim' && (
                              <div className="mt-1" style={{ fontSize: 12, color: '#374151' }}>
                                <strong>{r.title}</strong>
                                {r.raw.vendor ? <span className="text-muted"> · {r.raw.vendor}</span> : null}
                              </div>
                            )}
                            {r.raw.purpose && (
                              <div className="mt-1 text-muted" style={{ fontSize: 12 }}>
                                <i className="ri-double-quotes-l me-1" />{r.raw.purpose}
                              </div>
                            )}
                            <input
                              type="text"
                              className="form-control mt-2"
                              placeholder="Add a remark (required for reject, optional for approve)"
                              value={expenseComment[r.id] || ''}
                              onChange={e => setExpenseComment(prev => ({ ...prev, [r.id]: e.target.value }))}
                              style={{ fontSize: 12.5 }}
                            />
                          </div>
                          <div className="d-flex flex-column gap-2" style={{ minWidth: 140 }}>
                            <button
                              type="button"
                              onClick={() => actOnExpense(r, 'approve')}
                              disabled={acting}
                              style={{
                                padding: '8px 12px', borderRadius: 8, border: 0,
                                background: 'linear-gradient(135deg,#10b981,#059669)',
                                color: '#fff', fontSize: 12, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer',
                                opacity: acting ? 0.6 : 1,
                              }}
                            >
                              {isApproving ? <><i className="ri-loader-4-line ri-spin me-1" />Approving…</> : <><i className="ri-check-line me-1" />Approve</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnExpense(r, 'reject')}
                              disabled={acting}
                              style={{
                                padding: '8px 12px', borderRadius: 8,
                                border: '1px solid #fecaca',
                                background: '#fff', color: '#b91c1c',
                                fontSize: 12, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer',
                                opacity: acting ? 0.6 : 1,
                              }}
                            >
                              {isRejecting ? <><i className="ri-loader-4-line ri-spin me-1" />Rejecting…</> : <><i className="ri-close-line me-1" />Reject</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Pager total={expenseRows.length} page={expensePage} onChange={setExpensePage} />
            </CardBody>
          </Card>

          {/* Personal claim/advance updates ─ FYI notifications for the
              current user about their own filings that a manager or HR
              just acted on. Read-only — no approve / reject controls.
              Source: /api/my-team/my-updates (last 30 days, max 50). */}
          <Card className="mb-3" style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="d-flex align-items-center justify-content-between"
                   style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                <div className="d-flex align-items-center gap-2">
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ri-notification-3-line" style={{ fontSize: 16, color: '#1d4ed8' }} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Your Claim Updates</h6>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>
                      Expense claims and advance requests you filed — recent manager / HR decisions.
                    </div>
                  </div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontWeight: 700, fontSize: 11.5 }}>
                  {myUpdatesLoading ? '…' : `${myUpdates.length}`}
                </span>
              </div>

              {myUpdatesLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`upd-shim-${i}`} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div style={{ flex: '1 1 320px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <Shimmer width={160} height={13} />
                          <Shimmer width={220} height={11} />
                          <Shimmer width={140} height={11} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : myUpdates.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                  <i className="ri-mail-check-line" style={{ fontSize: 30, display: 'block', marginBottom: 6 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No recent updates</div>
                  <div style={{ fontSize: 11.5 }}>Manager or HR decisions on your filings will appear here.</div>
                </div>
              ) : (
                <div>
                  {paginate(myUpdates, updatesPage).map((u) => {
                    const isApproved = u.verdict === 'approved';
                    const stageLabel = u.stage === 'hr' ? 'HR / Finance' : 'Reporting Manager';
                    const moduleLabel = u.module === 'advance' ? 'Advance' : 'Expense';
                    const tone = isApproved
                      ? { bg: '#d1fae5', fg: '#047857', ring: '#a7f3d0', icon: 'ri-checkbox-circle-line' }
                      : { bg: '#fee2e2', fg: '#b91c1c', ring: '#fecaca', icon: 'ri-close-circle-line' };
                    const fmtTime = (iso: string | null) => {
                      if (!iso) return '—';
                      const d = new Date(iso);
                      if (isNaN(d.getTime())) return iso;
                      return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    };
                    return (
                      <div key={`${u.module}-${u.id}-${u.stage}`} style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 38, height: 38, background: tone.bg, color: tone.fg, border: `1px solid ${tone.ring}` }}>
                            <i className={tone.icon} style={{ fontSize: 18 }} />
                          </span>
                          <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong style={{ fontSize: 13.5 }}>
                                {u.code ? `${u.code} · ` : ''}{u.title}
                              </strong>
                              <span style={{
                                padding: '2px 8px', borderRadius: 6,
                                background: tone.bg, color: tone.fg,
                                fontWeight: 700, fontSize: 10.5,
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                              }}>
                                {moduleLabel} · {isApproved ? 'Approved' : 'Rejected'}
                              </span>
                              {!u.final && (
                                <span style={{
                                  padding: '2px 8px', borderRadius: 6,
                                  background: '#fef3c7', color: '#92400e',
                                  fontWeight: 700, fontSize: 10.5,
                                  textTransform: 'uppercase', letterSpacing: '0.04em',
                                }}>
                                  Awaiting next stage
                                </span>
                              )}
                            </div>
                            <div className="mt-1" style={{ fontSize: 12.5, color: '#374151' }}>
                              <strong style={{ color: tone.fg }}>{stageLabel}</strong>
                              {u.actor_name ? ` (${u.actor_name})` : ''} {isApproved ? 'approved' : 'rejected'} your {u.module === 'advance' ? 'advance request' : 'claim'}
                              {u.amount ? <> for <strong>₹{Number(u.amount).toLocaleString('en-IN')}</strong></> : null}.
                            </div>
                            {u.comment && (
                              <div className="mt-1 text-muted" style={{ fontSize: 12 }}>
                                <i className="ri-double-quotes-l me-1" />{u.comment}
                              </div>
                            )}
                            <small className="text-muted d-inline-flex align-items-center gap-1 mt-1" style={{ fontSize: 11 }}>
                              <i className="ri-time-line" /> {fmtTime(u.acted_at)}
                            </small>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Pager total={myUpdates.length} page={updatesPage} onChange={setUpdatesPage} />
            </CardBody>
          </Card>

          {/* Document signatures (existing) */}
          <Card style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="table-responsive">
                <table className="table align-middle mb-0 inbox-table" style={{ fontSize: 13 }}>
                  <thead className="inbox-thead" style={{ background: '#fffbeb' }}>
                    <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px', width: 44 }}>Sr No</th>
                      <th>Document</th>
                      <th>Subject Employee</th>
                      <th>Action Requested</th>
                      <th>Step</th>
                      <th>Received</th>
                      <th style={{ width: 240 }}>Take Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={5} cols={7} />
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={7} className="inbox-empty" style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
                        <i className="ri-checkbox-circle-line" style={{ fontSize: 36, display: 'block', marginBottom: 8 }} />
                        <div style={{ fontSize: 14, fontWeight: 600 }}>No pending documents</div>
                        <div style={{ fontSize: 12 }}>You're all caught up. Anything sent to you will land here.</div>
                      </td></tr>
                    ) : (
                      paginate(rows, docsPage).map((r, i) => {
                        const current = r.signers[r.current_index];
                        const empName = r.employee?.display_name
                          || `${r.employee?.first_name || ''} ${r.employee?.last_name || ''}`.trim()
                          || '—';
                        const actionTone =
                          current?.action === 'Sign'    ? { bg: '#fef3c7', fg: '#92400e' }
                          : current?.action === 'Approve'? { bg: '#dcfce7', fg: '#15803d' }
                          :                                { bg: '#e0e7ff', fg: '#4338ca' };
                        const reminder = latestReminder(r);
                        return (
                          <tr key={r.id} className={reminder ? 'inbox-row--reminded' : undefined}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="inbox-doc-name" style={{ fontWeight: 700 }}>{r.template?.name || '(template removed)'}</div>
                              {r.code && <code className="inbox-code-pill" style={{ fontSize: 10.5, background: '#fef3c7', color: '#a16207', padding: '1px 6px', borderRadius: 4 }}>{r.code}</code>}
                              {reminder && (
                                <div className="inbox-reminder-pill" style={{ marginTop: 5 }}
                                  title={`${reminder.actor_name || 'Someone'} reminded you on ${new Date(reminder.at).toLocaleString()}`}>
                                  <i className="ri-notification-badge-line" />
                                  Reminder{reminder.actor_name ? ` from ${reminder.actor_name}` : ''}
                                </div>
                              )}
                            </td>
                            <td>
                              <div>{empName}</div>
                              <div className="inbox-muted" style={{ fontSize: 11.5, color: '#6b7280' }}>
                                {r.employee?.emp_code || '—'}
                                {r.employee?.department?.name ? ` · ${r.employee.department.name}` : ''}
                              </div>
                            </td>
                            <td>
                              <span className={`inbox-action-pill inbox-action-${current?.action || 'Other'}`} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: actionTone.bg, color: actionTone.fg }}>
                                {current?.action || '—'}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>
                              Step <strong>{r.current_index + 1}</strong> of {r.signers.length}
                            </td>
                            <td className="inbox-muted" style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.created_at).toLocaleString()}</td>
                            <td>
                              <div className="d-flex gap-1 flex-wrap">
                                <button type="button" onClick={() => setViewRun(r)}
                                  title="Preview the document before deciding"
                                  className="inbox-view-btn"
                                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  <i className="ri-eye-line me-1" />View
                                </button>
                                <button type="button" onClick={() => openAction(r)}
                                  style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  <i className="ri-checkbox-circle-line me-1" />Review &amp; Decide
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <Pager total={rows.length} page={docsPage} onChange={setDocsPage} />
            </CardBody>
          </Card>
        </div>
      </Col>

      {/* View modal — pure preview */}
      {viewRun && (
        <ModalShell onClose={() => setViewRun(null)} title="Document Preview"
          subtitle={`${viewRun.template?.name || ''} · ${viewRun.code || ''}`}
          gradient="linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)">
          <div className="inbox-modal-body" style={{ padding: 16, background: '#f9fafb', overflowY: 'auto', flex: 1 }}>
            <HeaderFooterPanel
              header={{ ...DEFAULT_HEADER, ...(viewRun.header_config || {}) } as HeaderConfig}
              setHeader={() => {}}
              footer={{ ...DEFAULT_FOOTER, ...(viewRun.footer_config || {}) } as FooterConfig}
              setFooter={() => {}}
              readOnly
            >
              <div className="tpl-readonly-preview"
                style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                dangerouslySetInnerHTML={{ __html: viewRun.content_html || '<p>(empty)</p>' }}
              />
            </HeaderFooterPanel>
          </div>
          <div className="inbox-modal-footer" style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 -3px 10px rgba(15,23,42,0.05)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button type="button" onClick={() => setViewRun(null)}
              className="inbox-btn-ghost"
              style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Close
            </button>
            <button type="button" onClick={() => { const v = viewRun; setViewRun(null); openAction(v); }}
              style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              <i className="ri-checkbox-circle-line me-1" />Review &amp; Decide
            </button>
          </div>
        </ModalShell>
      )}

      {/* Decision modal */}
      {actionRun && (() => {
        const current = actionRun.signers[actionRun.current_index];
        const isSign = current?.action === 'Sign';
        return (
          <ModalShell onClose={() => setActionRun(null)} title="Review & Decide"
            subtitle={`Action requested: ${current?.action} · ${actionRun.code || ''}`}
            hint={`Add a remark below, then choose ${current?.action} or Reject.`}
            gradient="linear-gradient(135deg,#6366f1,#8b5cf6)">
            <div className="inbox-modal-body" style={{ padding: 16, background: '#f9fafb', overflowY: 'auto', flex: 1 }}>
              <HeaderFooterPanel
                header={{ ...DEFAULT_HEADER, ...(actionRun.header_config || {}) } as HeaderConfig}
                setHeader={() => {}}
                footer={{ ...DEFAULT_FOOTER, ...(actionRun.footer_config || {}) } as FooterConfig}
                setFooter={() => {}}
                readOnly
              >
                <div className="tpl-readonly-preview"
                  style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 220 }}
                  dangerouslySetInnerHTML={{ __html: actionRun.content_html || '<p>(empty)</p>' }}
                />
              </HeaderFooterPanel>

              <div className="inbox-form-card" style={{ marginTop: 14, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                {isSign && (
                  <>
                    <label className="inbox-input-label" style={inputLabelStyle}>
                      Signer name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input type="text" value={actionName} onChange={e => setActionName(e.target.value)}
                      placeholder="Your full name (used in the audit trail)"
                      className="inbox-input"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 12 }} />
                    <label className="inbox-input-label" style={inputLabelStyle}>
                      Signature <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <SignaturePad
                      typedName={actionName}
                      onChange={(v) => setDrawnSignature(v.dataUrl)}
                      height={150}
                    />
                  </>
                )}
                <label className="inbox-input-label" style={{ ...inputLabelStyle, marginTop: isSign ? 12 : 0 }}>Remark</label>
                <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
                  placeholder="Add a remark — optional when approving, REQUIRED when rejecting (describe what should change)."
                  rows={3} className="inbox-input" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
                <div className="inbox-hint" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  Remarks land in the audit trail. Rejection halts the workflow and returns the document to the sender.
                </div>
              </div>
            </div>
            <div className="inbox-modal-footer" style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 -3px 10px rgba(15,23,42,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              <button type="button" onClick={() => submitDecision('reject')}
                disabled={submitting || !actionNote.trim()}
                title={actionNote.trim() ? 'Reject with this remark' : 'Add a remark first'}
                style={{ padding: '7px 14px', background: actionNote.trim() ? 'linear-gradient(135deg,#dc2626,#ef4444)' : '#fee2e2', color: actionNote.trim() ? '#fff' : '#b91c1c', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: actionNote.trim() ? 'pointer' : 'not-allowed', opacity: actionNote.trim() ? 1 : 0.7 }}>
                <i className="ri-close-circle-line me-1" />Reject &amp; Send Back
              </button>
              <div className="d-flex gap-2">
                <button type="button" onClick={() => setActionRun(null)} disabled={submitting}
                  className="inbox-btn-ghost"
                  style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={() => submitDecision('approve')}
                  disabled={submitting || (isSign && (!actionName.trim() || !drawnSignature))}
                  style={{
                    padding: '7px 16px',
                    background: current?.action === 'Approve'
                      ? 'linear-gradient(135deg,#16a34a,#22c55e)'
                      : isSign
                        ? 'linear-gradient(135deg,#0ea5e9,#3b82f6)'
                        : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                    border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
                  }}>
                  <i className={isSign ? 'ri-quill-pen-line' : current?.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
                  {submitting ? 'Submitting…' : current?.action}
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}
    </Row>
  );
}

/* ── Lightweight modal shell — local to this file to keep Inbox self-contained.
    Provides the dark backdrop + click-outside-to-close + gradient header pattern
    so the View and Decision modals share their chrome. */
function ModalShell({
  onClose, title, subtitle, hint, gradient, children,
}: {
  onClose: () => void; title: string; subtitle?: string; hint?: string;
  gradient: string; children: React.ReactNode;
}) {
  return (
    <div className="inbox-modal-backdrop" style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="inbox-modal-card" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: gradient, color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="min-w-0">
              <strong style={{ fontSize: 15 }}><i className="ri-checkbox-circle-line me-2" />{title}</strong>
              {subtitle && <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>{subtitle}</div>}
              {hint && <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>{hint}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4,
};

/* Dark-theme overrides. Page-scoped rules use .inbox-page; modal rules use
   class names that don't require the wrapper since the modal is rendered as
   a sibling of the page container. */
function InboxDarkStyles() {
  return (
    <style>{`
      /* Reminder highlight — drawn in both themes (not dark-only). A pending
         row that has been nudged gets an amber left-rail + tinted cells, and
         a pulsing pill so the signer reads "you've been reminded" at a glance. */
      @keyframes inboxReminderPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.45); }
        50%      { box-shadow: 0 0 0 4px rgba(245,158,11,0); }
      }
      .inbox-reminder-pill {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 9px; border-radius: 999px;
        background: #fef3c7; color: #b45309;
        font-size: 10.5px; font-weight: 800; letter-spacing: 0.2px;
        animation: inboxReminderPulse 1.8s ease-in-out infinite;
      }
      .inbox-reminder-pill--header {
        padding: 6px 12px; font-size: 12px; color: #92400e;
        background: #fde68a;
      }
      .inbox-page .inbox-row--reminded > td { background: #fff8eb; }
      .inbox-page .inbox-row--reminded > td:first-child { box-shadow: inset 3px 0 0 0 #f59e0b; }
      [data-bs-theme="dark"] .inbox-page .inbox-row--reminded > td { background: rgba(245,158,11,0.09) !important; }
      [data-bs-theme="dark"] .inbox-reminder-pill { background: rgba(245,158,11,0.20); color: #fbbf24; }
      [data-bs-theme="dark"] .inbox-reminder-pill--header { background: rgba(245,158,11,0.22); color: #fcd34d; }

      [data-bs-theme="dark"] .inbox-page .inbox-header-icon {
        /* Stay on the same saturated amber gradient as light mode so the
         * icon chip matches the Master-tile treatment in both themes,
         * rather than the older translucent variant that washed out
         * against the dark canvas. */
        background: linear-gradient(135deg, #f7b84b, #fad07e) !important;
        box-shadow: 0 4px 14px rgba(247, 184, 75, 0.38) !important;
      }
      [data-bs-theme="dark"] .inbox-page .inbox-thead {
        background: rgba(251,191,36,0.10) !important;
      }
      [data-bs-theme="dark"] .inbox-page .inbox-thead tr,
      [data-bs-theme="dark"] .inbox-page .inbox-thead th {
        color: rgba(255,255,255,0.65) !important;
      }
      [data-bs-theme="dark"] .inbox-page .inbox-table tbody td {
        border-bottom-color: var(--vz-border-color) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .inbox-page .inbox-doc-name { color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-muted { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-empty { color: rgba(255,255,255,0.5) !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-code-pill {
        background: rgba(251,191,36,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .inbox-page .inbox-action-Sign    { background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-action-Approve { background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-action-Other   { background: rgba(124,92,252,0.18) !important; color: #c4b5fd !important; }
      [data-bs-theme="dark"] .inbox-page .inbox-view-btn {
        background: rgba(99,102,241,0.18) !important; color: #c4b5fd !important;
        border-color: rgba(124,92,252,0.35) !important;
      }

      /* Modals — rendered as siblings of the page card, scoped only by the
         class names on the modal itself. */
      [data-bs-theme="dark"] .inbox-modal-card {
        background: var(--vz-card-bg) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .inbox-modal-body {
        background: var(--vz-secondary-bg) !important;
      }
      [data-bs-theme="dark"] .inbox-modal-footer {
        background: var(--vz-card-bg) !important;
        border-top-color: var(--vz-border-color) !important;
        box-shadow: 0 -3px 10px rgba(0,0,0,0.25) !important;
      }
      [data-bs-theme="dark"] .inbox-form-card {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .inbox-input {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .inbox-input::placeholder { color: rgba(255,255,255,0.45) !important; }
      [data-bs-theme="dark"] .inbox-input-label { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .inbox-hint { color: rgba(255,255,255,0.45) !important; }
      [data-bs-theme="dark"] .inbox-btn-ghost {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
    `}</style>
  );
}
