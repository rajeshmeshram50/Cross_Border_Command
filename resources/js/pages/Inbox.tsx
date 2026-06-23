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
import './Inbox.css';

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

// Hex → rgba with the given alpha (used to derive the dark-mode translucent
// chip tint for the history section headers).
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Inbox() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();

  const [rows, setRows] = useState<SignatureRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Inbox tabs — "New" holds everything still waiting on your sign/approve
  // action (Leave · Expense · Documents); "Updated" is the history of items
  // already acted on (Your Claim Updates). The containers themselves are
  // unchanged — they're just grouped under the matching tab.
  const [tab, setTab] = useState<'new' | 'updated'>('new');

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
    // Both expense claims and advance requests share this row shape and the
    // same two-stage approval flow; `module` decides which endpoint the
    // approve/reject action hits (/expense-claims vs /advance-requests).
    module: 'expense' | 'advance';
    code: string | null;
    title: string;
    subject_name: string;
    subject_dept: string;
    created_at: string;
    raw: {
      stage: 'manager' | 'hr';
      amount: number;
      currency: string | null;
      expense_date?: string | null;
      category_name: string | null;
      vendor?: string | null;
      employee_name: string | null;
      employee_code: string | null;
      department_name: string | null;
      manager_name: string | null;
      purpose?: string | null;
      reason?: string | null;       // advance requests carry `reason` not `purpose`
    };
  };
  const [expenseRows, setExpenseRows] = useState<ExpenseApprovalRow[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(true);
  // Expense and advance IDs share the same number space, so per-row state
  // (in-flight action + draft comment) is keyed by `<module>-<id>` rather
  // than the bare id — otherwise claim #5 and advance #5 would clobber each
  // other's comment box and spinner.
  const [expenseActing, setExpenseActing] = useState<{ key: string; verdict: 'approve' | 'reject' } | null>(null);
  const [expenseComment, setExpenseComment] = useState<Record<string, string>>({});
  const expRowKey = (r: { module: string; id: number }) => `${r.module}-${r.id}`;

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

  // ── Updated (History) tab data — the same Leave / Expense / Document
  //    containers, but listing items this user has already acted on. ──
  type ActedExpenseRow = ExpenseApprovalRow & { verdict: 'approved' | 'rejected'; acted_at: string | null };
  const [histLeave, setHistLeave]     = useState<ApiLeaveRequest[]>([]);
  const [histExpense, setHistExpense] = useState<ActedExpenseRow[]>([]);
  const [histDocs, setHistDocs]       = useState<SignatureRun[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histLeavePage,   setHistLeavePage]   = useState(0);
  const [histExpensePage, setHistExpensePage] = useState(0);
  const [histDocsPage,    setHistDocsPage]    = useState(0);

  const loadHistory = async () => {
    setHistLoading(true);
    const [lv, ex, dc] = await Promise.allSettled([
      leaveRequestsApi.approvals({ status: 'All' }),
      api.get('/my-team/approvals', { params: { history: 1 } }),
      api.get<SignatureRun[]>('/hr-document-signatures/inbox', { params: { history: 1 } }),
    ]);
    setHistLeave(lv.status === 'fulfilled' ? (Array.isArray(lv.value) ? lv.value : []).filter(r => r.status === 'Approved' || r.status === 'Rejected') : []);
    setHistExpense(ex.status === 'fulfilled' ? ((ex.value.data?.approvals ?? []) as any[]).filter(a => a.module === 'expense' || a.module === 'advance') : []);
    setHistDocs(dc.status === 'fulfilled' ? (Array.isArray(dc.value.data) ? dc.value.data : []) : []);
    setHistLoading(false);
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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
        .filter((a: any) => a.module === 'expense' || a.module === 'advance')
        .map((a: any) => ({
          id: a.id, module: a.module, code: a.code, title: a.title,
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
      <div className="d-flex align-items-center justify-content-between gap-2 ib-pager">
        <small className="ib-pager-info">
          Page {safePage + 1} of {pages} · {total} total
        </small>
        <div className="d-flex gap-1">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="ib-pager-btn"
          >
            <i className="ri-arrow-left-s-line" /> Prev
          </button>
          <button
            type="button"
            onClick={() => onChange(Math.min(pages - 1, safePage + 1))}
            disabled={safePage >= pages - 1}
            className="ib-pager-btn"
          >
            Next <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
    );
  };

  const actOnExpense = async (row: ExpenseApprovalRow, verdict: 'approve' | 'reject') => {
    const key = expRowKey(row);
    const comment = (expenseComment[key] || '').trim();
    if (verdict === 'reject' && !comment) {
      toast.error('Reason required', 'Please add a short comment explaining the rejection.');
      return;
    }
    const stage = row.raw.stage === 'hr' ? 'hr' : 'manager';
    // Route to the right module's approve/reject endpoint. Both follow the
    // identical /{id}/{stage}-{verdict} shape.
    const base = row.module === 'advance' ? 'advance-requests' : 'expense-claims';
    const noun = row.module === 'advance' ? 'Advance request' : 'Claim';
    setExpenseActing({ key, verdict });
    try {
      await api.post(`/${base}/${row.id}/${stage}-${verdict}`, comment ? { comment } : {});
      toast.success(
        verdict === 'approve' ? `${noun} approved` : `${noun} rejected`,
        verdict === 'approve' ? 'The employee will be notified.' : 'The employee will see your remark.',
      );
      setExpenseComment(prev => { const next = { ...prev }; delete next[key]; return next; });
      await loadExpenses();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Action failed';
      toast.error(`Could not act on this ${row.module === 'advance' ? 'advance request' : 'claim'}`, msg);
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
          {/* Header strip — same shape as the Clients / Branches module
              headers (violet border + left accent strip + violet icon). */}
          <div className="frm-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-inbox-line" /></div>
              <div className="min-w-0">
                <div className="frm-cstrip-title">Inbox</div>
                <div className="frm-cstrip-sub">Documents waiting on your action — sign, approve, or acknowledge.</div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-shrink-0 flex-wrap">
              {!loading && reminderCount > 0 && (
                <span className="inbox-reminder-pill inbox-reminder-pill--header"
                  title="Someone has reminded you to act on these documents">
                  <i className="ri-notification-badge-line" />
                  {reminderCount} reminder{reminderCount === 1 ? '' : 's'}
                </span>
              )}
              <span className="ib-pending-badge">
                <i className="ri-mail-unread-line me-1" />
                {loading || leaveLoading || expenseLoading || myUpdatesLoading
                  ? '…'
                  : `${rows.length + leaveRows.length + expenseRows.length} pending${myUpdates.length ? ` · ${myUpdates.length} update${myUpdates.length === 1 ? '' : 's'}` : ''}`}
              </span>
              {/* Back — history.back() with a /dashboard fallback. */}
              <button
                type="button"
                className="frm-cstrip-back"
                onClick={() => {
                  if (window.history.length > 1) navigate(-1);
                  else                            navigate('/dashboard');
                }}
              >
                <i className="ri-arrow-left-line" />
                Back
              </button>
            </div>
          </div>

          {/* New / Updated tabs — segregate items waiting on your action from
              the history of items you've already signed/approved. */}
          {(() => {
            const newCount = rows.length + leaveRows.length + expenseRows.length;
            const updatedCount = histLeave.length + histExpense.length + histDocs.length + myUpdates.length;
            const TabBtn = ({ id, label, icon, count, tone }: { id: 'new' | 'updated'; label: string; icon: string; count: number; tone: string }) => {
              const active = tab === id;
              return (
                <button type="button" onClick={() => setTab(id)}
                  className={`inbox-tab ib-tab-btn${active ? ' is-active' : ''}`}
                  style={{ ['--ib-tab-tone' as any]: tone }}>
                  <i className={`${icon} ib-tab-icon`} />
                  {label}
                  <span className="ib-tab-count">{count}</span>
                </button>
              );
            };
            return (
              <Card className="mb-3 ep-section-card-flat">
                <CardBody className="ib-tab-cardbody">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <TabBtn id="new" label="New" icon="ri-inbox-unarchive-line" count={newCount} tone="#f59e0b" />
                    <TabBtn id="updated" label="Updated (History)" icon="ri-history-line" count={updatedCount} tone="#1d4ed8" />
                  </div>
                </CardBody>
              </Card>
            );
          })()}

          {/* Leave approval requests ─ shown above the documents section so
              time-sensitive items (people waiting on a yes/no) bubble to the
              top of the inbox. Same endpoint HrLeaveApprovals uses; either
              the reporting manager OR a branch admin can act (first one to
              click wins). */}
          {tab === 'new' && (
          <Card className="mb-3 ep-section-card-flat">
            <CardBody className="ib-cardbody-0">
              <div className="d-flex align-items-center justify-content-between ib-section-head">
                <div className="d-flex align-items-center gap-2">
                  <span className="ib-head-chip ib-head-chip--leave">
                    <i className="ri-calendar-2-line ib-head-icon ib-head-icon--leave" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold ib-head-title">Leave Requests</h6>
                    <div className="text-muted ib-head-sub">
                      Approvals waiting on you. Either the reporting manager or a branch admin can decide.
                    </div>
                  </div>
                </div>
                <span className="ib-head-count ib-head-count--leave">
                  {leaveLoading ? '…' : `${leaveRows.length}`}
                </span>
              </div>

              {leaveLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`leave-shim-${i}`} className="ib-row">
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div className="ib-shim-col">
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
                        <div className="d-flex flex-column gap-2 ib-actions-col">
                          <Shimmer height={32} radius={8} />
                          <Shimmer height={32} radius={8} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : leaveRows.length === 0 ? (
                <div className="ib-empty">
                  <i className="ri-flight-takeoff-line ib-empty-icon" />
                  <div className="ib-empty-title">No pending leave requests</div>
                  <div className="ib-empty-sub">You're all caught up on approvals.</div>
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
                      <div key={r.id} className="ib-row">
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          {/* Avatar */}
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0 ib-avatar ib-avatar--leave">
                            {initials}
                          </span>
                          {/* Body */}
                          <div className="ib-body-col">
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong className="ib-name">{empName}</strong>
                              <span className="ib-sub-meta">
                                {emp?.emp_code || '—'}
                                {emp?.department?.name ? ` · ${emp.department.name}` : ''}
                              </span>
                            </div>
                            <div className="mt-1 ib-line">
                              <span className="ib-pill-leave">
                                {r.leave_type?.name || 'Leave'}
                              </span>
                              <span className="ms-2 text-muted">{fmt(r.from_date)} – {fmt(r.to_date)}</span>
                              <span className="ms-2 fw-semibold">{Number(r.days)} {Number(r.days) === 1 ? 'day' : 'days'}</span>
                            </div>
                            {r.reason && (
                              <div className="mt-1 text-muted ib-quote">
                                <i className="ri-double-quotes-l me-1" />{r.reason}
                              </div>
                            )}
                            {/* Comment input — required when rejecting, optional when approving */}
                            <input
                              type="text"
                              className="form-control mt-2 ib-remark-input"
                              placeholder="Add a remark (required for reject, optional for approve)"
                              value={leaveComment[r.id] || ''}
                              onChange={e => setLeaveComment(prev => ({ ...prev, [r.id]: e.target.value }))}
                            />
                          </div>
                          {/* Actions */}
                          <div className="d-flex flex-column gap-2 ib-actions-col">
                            <button
                              type="button"
                              onClick={() => actOnLeave(r.id, 'approve')}
                              disabled={acting}
                              className="ib-btn-approve"
                            >
                              {isApproving ? <><i className="ri-loader-4-line ri-spin me-1" />Approving…</> : <><i className="ri-check-line me-1" />Accept</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnLeave(r.id, 'reject')}
                              disabled={acting}
                              className="ib-btn-reject"
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
          )}

          {/* Expense claims ─ pending approvals where the current user is
              either the assigned reporting manager (manager stage) or
              someone with HR/Finance approval rights (hr stage). raw.stage
              decides which controller endpoint each action call dispatches. */}
          {tab === 'new' && (
          <Card className="mb-3 ep-section-card-flat">
            <CardBody className="ib-cardbody-0">
              <div className="d-flex align-items-center justify-content-between ib-section-head">
                <div className="d-flex align-items-center gap-2">
                  <span className="ib-head-chip ib-head-chip--exp">
                    <i className="ri-bill-line ib-head-icon ib-head-icon--exp" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold ib-head-title">Expense &amp; Advance Requests</h6>
                    <div className="text-muted ib-head-sub">
                      Expense claims and advance requests waiting on you — reporting managers see manager-stage rows, branch admins see HR-stage rows.
                    </div>
                  </div>
                </div>
                <span className="ib-head-count ib-head-count--exp">
                  {expenseLoading ? '…' : `${expenseRows.length}`}
                </span>
              </div>

              {expenseLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`exp-shim-${i}`} className="ib-row">
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div className="ib-shim-col">
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
                        <div className="d-flex flex-column gap-2 ib-actions-col">
                          <Shimmer height={32} radius={8} />
                          <Shimmer height={32} radius={8} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : expenseRows.length === 0 ? (
                <div className="ib-empty">
                  <i className="ri-wallet-3-line ib-empty-icon" />
                  <div className="ib-empty-title">No pending expense or advance requests</div>
                  <div className="ib-empty-sub">You're all caught up on reimbursements and advances.</div>
                </div>
              ) : (
                <div>
                  {paginate(expenseRows, expensePage).map((r) => {
                    const rk = expRowKey(r);
                    const isAdvance = r.module === 'advance';
                    const empName = r.raw.employee_name || r.subject_name || '—';
                    const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
                    const acting = expenseActing?.key === rk;
                    const isApproving = acting && expenseActing?.verdict === 'approve';
                    const isRejecting = acting && expenseActing?.verdict === 'reject';
                    const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                    const fmtAmt = `₹${Number(r.raw.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                    const stageLabel = r.raw.stage === 'hr' ? 'HR / Finance stage' : 'Manager stage';
                    const note = r.raw.purpose || r.raw.reason;
                    return (
                      <div key={rk} className="ib-row">
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0 ib-avatar ib-avatar--exp">
                            {initials}
                          </span>
                          <div className="ib-body-col">
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong className="ib-name">{empName}</strong>
                              <span className="ib-sub-meta">
                                {r.raw.employee_code || '—'}
                                {r.raw.department_name ? ` · ${r.raw.department_name}` : ''}
                              </span>
                            </div>
                            <div className="mt-1 d-flex align-items-center flex-wrap gap-2 ib-line">
                              <span className={`ib-pill-type ${isAdvance ? 'ib-pill-type--adv' : 'ib-pill-type--exp'}`}>
                                {isAdvance ? 'Advance' : 'Expense'}
                              </span>
                              <span className="ib-pill-cat">
                                {r.raw.category_name || (isAdvance ? 'Advance' : 'Expense')}
                              </span>
                              {r.code && (
                                <code className="ib-code-grey">
                                  {r.code}
                                </code>
                              )}
                              {r.raw.expense_date && <span className="text-muted">· {fmtDate(r.raw.expense_date)}</span>}
                              <span className="fw-bold ib-amt">· {fmtAmt}</span>
                              <span className={`ib-pill-stage ${r.raw.stage === 'hr' ? 'ib-pill-stage--hr' : 'ib-pill-stage--mgr'}`}>
                                {stageLabel}
                              </span>
                            </div>
                            {r.title && r.title !== 'Expense Claim' && r.title !== 'Advance Request' && (
                              <div className="mt-1 ib-title-line">
                                <strong>{r.title}</strong>
                                {r.raw.vendor ? <span className="text-muted"> · {r.raw.vendor}</span> : null}
                              </div>
                            )}
                            {note && (
                              <div className="mt-1 text-muted ib-quote">
                                <i className="ri-double-quotes-l me-1" />{note}
                              </div>
                            )}
                            <input
                              type="text"
                              className="form-control mt-2 ib-remark-input"
                              placeholder="Add a remark (required for reject, optional for approve)"
                              value={expenseComment[rk] || ''}
                              onChange={e => setExpenseComment(prev => ({ ...prev, [rk]: e.target.value }))}
                            />
                          </div>
                          <div className="d-flex flex-column gap-2 ib-actions-col">
                            <button
                              type="button"
                              onClick={() => actOnExpense(r, 'approve')}
                              disabled={acting}
                              className="ib-btn-approve"
                            >
                              {isApproving ? <><i className="ri-loader-4-line ri-spin me-1" />Approving…</> : <><i className="ri-check-line me-1" />Approve</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnExpense(r, 'reject')}
                              disabled={acting}
                              className="ib-btn-reject"
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
          )}

          {/* ── Updated (History) tab: the same Leave / Expense / Document
                 containers, listing items you've already acted on. ── */}
          {tab === 'updated' && (() => {
            const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            const StatusPill = ({ ok, label }: { ok: boolean; label: string }) => (
              <span className={`ib-status-pill ${ok ? 'ib-status-pill--ok' : 'ib-status-pill--bad'}`}>
                <i className={ok ? 'ri-checkbox-circle-line me-1' : 'ri-close-circle-line me-1'} />{label}
              </span>
            );
            const HistHead = ({ icon, bg, fg, darkFg, title, sub, count }: { icon: string; bg: string; fg: string; darkFg: string; title: string; sub: string; count: number }) => {
              // Light values drive --ib-hist-bg/--ib-hist-fg directly; the dark
              // override (in Inbox.css) reads the *-d custom properties below.
              const darkBg = hexA(darkFg, 0.18);
              const vars = {
                ['--ib-hist-bg' as any]: bg, ['--ib-hist-fg' as any]: fg,
                ['--ib-hist-bg-d' as any]: darkBg, ['--ib-hist-fg-d' as any]: darkFg,
              };
              return (
              <div className="d-flex align-items-center justify-content-between ib-section-head" style={vars}>
                <div className="d-flex align-items-center gap-2">
                  <span className="ib-hist-chip"><i className={`${icon} ib-hist-icon`} /></span>
                  <div><h6 className="mb-0 fw-bold ib-head-title">{title}</h6><div className="text-muted ib-head-sub">{sub}</div></div>
                </div>
                <span className="ib-hist-count">{histLoading ? '…' : count}</span>
              </div>
              );
            }
            return (
              <>
                {/* Leave — decided */}
                <Card className="mb-3 ep-section-card-flat">
                  <CardBody className="ib-cardbody-0">
                    <HistHead icon="ri-calendar-2-line" bg="#ede9fe" fg="#5a3fd1" darkFg="#c4b5fd" title="Leave Requests" sub="Requests you've approved or rejected." count={histLeave.length} />
                    {histLoading ? (
                      <div className="ib-shim-wrap">{Array.from({ length: 2 }).map((_, i) => <Shimmer key={i} height={40} radius={8} />)}</div>
                    ) : histLeave.length === 0 ? (
                      <div className="ib-hist-empty">No decided leave requests yet.</div>
                    ) : paginate(histLeave, histLeavePage).map((r) => {
                      const emp = r.employee; const empName = emp ? (emp.display_name?.trim() || `${emp.first_name} ${emp.last_name ?? ''}`.trim()) : '—';
                      const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
                      return (
                        <div key={r.id} className="ib-row-hist">
                          <div className="d-flex align-items-center gap-3 flex-wrap">
                            <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0 ib-avatar-sm ib-avatar-sm--leave">{initials}</span>
                            <div className="ib-body-col-hist">
                              <div className="d-flex align-items-center gap-2 flex-wrap"><strong className="ib-name-sm">{empName}</strong><span className="ib-sub-meta">{emp?.emp_code || '—'}{emp?.department?.name ? ` · ${emp.department.name}` : ''}</span></div>
                              <div className="ib-hist-type-line"><span className="ib-pill-leave-sm">{r.leave_type?.name || 'Leave'}</span><span className="ms-2 text-muted">{fmtD(r.from_date)} – {fmtD(r.to_date)}</span></div>
                            </div>
                            <StatusPill ok={r.status === 'Approved'} label={r.status} />
                          </div>
                        </div>
                      );
                    })}
                    <Pager total={histLeave.length} page={histLeavePage} onChange={setHistLeavePage} />
                  </CardBody>
                </Card>

                {/* Expense — decided */}
                <Card className="mb-3 ep-section-card-flat">
                  <CardBody className="ib-cardbody-0">
                    <HistHead icon="ri-bill-line" bg="#fef3c7" fg="#a16207" darkFg="#fcd34d" title="Expense & Advance Requests" sub="Requests you've approved or rejected at your stage." count={histExpense.length} />
                    {histLoading ? (
                      <div className="ib-shim-wrap">{Array.from({ length: 2 }).map((_, i) => <Shimmer key={i} height={40} radius={8} />)}</div>
                    ) : histExpense.length === 0 ? (
                      <div className="ib-hist-empty">No decided expense or advance requests yet.</div>
                    ) : paginate(histExpense, histExpensePage).map((r) => {
                      const empName = r.raw.employee_name || r.subject_name || '—';
                      const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
                      const amt = `₹${Number(r.raw.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                      return (
                        <div key={expRowKey(r)} className="ib-row-hist">
                          <div className="d-flex align-items-center gap-3 flex-wrap">
                            <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0 ib-avatar-sm ib-avatar-sm--exp">{initials}</span>
                            <div className="ib-body-col-hist">
                              <div className="d-flex align-items-center gap-2 flex-wrap"><strong className="ib-name-sm">{empName}</strong>{r.code && <code className="ib-code-grey">{r.code}</code>}</div>
                              <div className="ib-hist-type-line"><span className="ib-pill-cat-sm">{r.raw.category_name || 'Expense'}</span><span className="ms-2 fw-bold ib-amt">{amt}</span><span className="ms-2 text-muted ib-hist-stage">{r.raw.stage === 'hr' ? 'HR stage' : 'Manager stage'}</span></div>
                            </div>
                            <StatusPill ok={r.verdict === 'approved'} label={r.verdict === 'approved' ? 'Approved' : 'Rejected'} />
                          </div>
                        </div>
                      );
                    })}
                    <Pager total={histExpense.length} page={histExpensePage} onChange={setHistExpensePage} />
                  </CardBody>
                </Card>

                {/* Documents — acted */}
                <Card className="mb-3 ep-section-card-flat">
                  <CardBody className="ib-cardbody-0">
                    <HistHead icon="ri-file-text-line" bg="#e0e7ff" fg="#4338ca" darkFg="#a5b4fc" title="Documents" sub="Documents you've signed, approved or acknowledged." count={histDocs.length} />
                    {histLoading ? (
                      <div className="ib-shim-wrap">{Array.from({ length: 2 }).map((_, i) => <Shimmer key={i} height={40} radius={8} />)}</div>
                    ) : histDocs.length === 0 ? (
                      <div className="ib-hist-empty">No signed or approved documents yet.</div>
                    ) : paginate(histDocs, histDocsPage).map((r) => {
                      const mine = r.signers.find(s => s.user_id === user?.id);
                      const empName = r.employee?.display_name || `${r.employee?.first_name || ''} ${r.employee?.last_name || ''}`.trim() || '—';
                      const rejected = mine?.status === 'Rejected';
                      return (
                        <div key={r.id} className="ib-row-hist">
                          <div className="d-flex align-items-center gap-3 flex-wrap">
                            <span className="d-inline-flex align-items-center justify-content-center flex-shrink-0 ib-doc-chip"><i className="ri-file-text-line ib-doc-chip-icon" /></span>
                            <div className="ib-body-col-hist">
                              <div className="d-flex align-items-center gap-2 flex-wrap"><strong className="ib-name-sm">{r.template?.name || '(template removed)'}</strong>{r.code && <code className="ib-code-amber">{r.code}</code>}</div>
                              <div className="text-muted ib-hist-meta">Subject: {empName}{mine?.acted_at ? ` · ${fmtD(mine.acted_at)}` : ''}</div>
                            </div>
                            <StatusPill ok={!rejected} label={rejected ? 'Rejected' : (mine?.action === 'Sign' ? 'Signed' : mine?.action === 'Approve' ? 'Approved' : 'Acknowledged')} />
                            <button type="button" onClick={() => setViewRun(r)} className="inbox-view-btn ib-view-btn"><i className="ri-eye-line me-1" />View</button>
                          </div>
                        </div>
                      );
                    })}
                    <Pager total={histDocs.length} page={histDocsPage} onChange={setHistDocsPage} />
                  </CardBody>
                </Card>
              </>
            );
          })()}

          {/* Personal claim/advance updates ─ FYI notifications for the
              current user about their own filings that a manager or HR
              just acted on. Read-only — no approve / reject controls.
              Source: /api/my-team/my-updates (last 30 days, max 50).
              Lives under the "Updated (History)" tab. */}
          {tab === 'updated' && (
          <Card className="mb-3 ep-section-card-flat">
            <CardBody className="ib-cardbody-0">
              <div className="d-flex align-items-center justify-content-between ib-section-head">
                <div className="d-flex align-items-center gap-2">
                  <span className="claim-upd-icon ib-upd-chip">
                    <i className="ri-notification-3-line ib-upd-chip-icon" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold ib-head-title">Your Claim Updates</h6>
                    <div className="text-muted ib-head-sub">
                      Expense claims and advance requests you filed — recent manager / HR decisions.
                    </div>
                  </div>
                </div>
                <span className="claim-upd-badge ib-upd-badge">
                  {myUpdatesLoading ? '…' : `${myUpdates.length}`}
                </span>
              </div>

              {myUpdatesLoading ? (
                <div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`upd-shim-${i}`} className="ib-row">
                      <div className="d-flex align-items-start gap-3 flex-wrap">
                        <Shimmer width={38} height={38} radius={999} />
                        <div className="ib-shim-col">
                          <Shimmer width={160} height={13} />
                          <Shimmer width={220} height={11} />
                          <Shimmer width={140} height={11} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : myUpdates.length === 0 ? (
                <div className="ib-empty">
                  <i className="ri-mail-check-line ib-empty-icon" />
                  <div className="ib-empty-title">No recent updates</div>
                  <div className="ib-empty-sub">Manager or HR decisions on your filings will appear here.</div>
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
                      <div key={`${u.module}-${u.id}-${u.stage}`} className="ib-row"
                        style={{ ['--ib-tone-bg' as any]: tone.bg, ['--ib-tone-fg' as any]: tone.fg, ['--ib-tone-ring' as any]: tone.ring }}>
                        <div className="d-flex align-items-start gap-3 flex-wrap">
                          <span className="rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0 ib-upd-avatar">
                            <i className={`${tone.icon} ib-upd-icon`} />
                          </span>
                          <div className="ib-body-col">
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <strong className="ib-name">
                                {u.code ? `${u.code} · ` : ''}{u.title}
                              </strong>
                              <span className="ib-upd-verdict">
                                {moduleLabel} · {isApproved ? 'Approved' : 'Rejected'}
                              </span>
                              {!u.final && (
                                <span className="ib-upd-pending">
                                  Awaiting next stage
                                </span>
                              )}
                            </div>
                            <div className="mt-1 ib-upd-desc">
                              <strong className="ib-upd-stage">{stageLabel}</strong>
                              {u.actor_name ? ` (${u.actor_name})` : ''} {isApproved ? 'approved' : 'rejected'} your {u.module === 'advance' ? 'advance request' : 'claim'}
                              {u.amount ? <> for <strong>₹{Number(u.amount).toLocaleString('en-IN')}</strong></> : null}.
                            </div>
                            {u.comment && (
                              <div className="mt-1 text-muted ib-quote">
                                <i className="ri-double-quotes-l me-1" />{u.comment}
                              </div>
                            )}
                            <small className="text-muted d-inline-flex align-items-center gap-1 mt-1 ib-upd-time">
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
          )}

          {/* Document signatures (existing) */}
          {tab === 'new' && (
          <Card className="ep-section-card-flat">
            <CardBody className="ib-cardbody-0">
              <div className="table-responsive">
                <table className="table align-middle mb-0 inbox-table ib-table">
                  <thead className="inbox-thead ib-thead-bg">
                    <tr className="ib-thead-row">
                      <th className="ib-th-srno">Sr No</th>
                      <th>Document</th>
                      <th>Subject Employee</th>
                      <th>Action Requested</th>
                      <th>Step</th>
                      <th>Received</th>
                      <th className="ib-th-action">Take Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={5} cols={7} />
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={7} className="inbox-empty ib-empty-cell">
                        <i className="ri-checkbox-circle-line ib-empty-cell-icon" />
                        <div className="ib-empty-cell-title">No pending documents</div>
                        <div className="ib-empty-cell-sub">You're all caught up. Anything sent to you will land here.</div>
                      </td></tr>
                    ) : (
                      paginate(rows, docsPage).map((r, i) => {
                        const current = r.signers[r.current_index];
                        const empName = r.employee?.display_name
                          || `${r.employee?.first_name || ''} ${r.employee?.last_name || ''}`.trim()
                          || '—';
                        const actionToneClass =
                          current?.action === 'Sign'    ? 'ib-action-pill--sign'
                          : current?.action === 'Approve'? 'ib-action-pill--approve'
                          :                                'ib-action-pill--other';
                        return (
                          <tr key={r.id}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="inbox-doc-name ib-doc-name-cell">{r.template?.name || '(template removed)'}</div>
                              {r.code && <code className="inbox-code-pill ib-code-amber">{r.code}</code>}
                            </td>
                            <td>
                              <div>{empName}</div>
                              <div className="inbox-muted ib-muted-cell">
                                {r.employee?.emp_code || '—'}
                                {r.employee?.department?.name ? ` · ${r.employee.department.name}` : ''}
                              </div>
                            </td>
                            <td>
                              <span className={`inbox-action-pill inbox-action-${current?.action || 'Other'} ib-action-pill ${actionToneClass}`}>
                                {current?.action || '—'}
                              </span>
                            </td>
                            <td className="ib-step-cell">
                              Step <strong>{r.current_index + 1}</strong> of {r.signers.length}
                            </td>
                            <td className="inbox-muted ib-received-cell">{new Date(r.created_at).toLocaleString()}</td>
                            <td>
                              <div className="d-flex gap-1 flex-wrap">
                                <button type="button" onClick={() => setViewRun(r)}
                                  title="Preview the document before deciding"
                                  className="inbox-view-btn ib-view-btn">
                                  <i className="ri-eye-line me-1" />View
                                </button>
                                <button type="button" onClick={() => openAction(r)}
                                  className="ib-decide-btn">
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
          )}
        </div>
      </Col>

      {/* View modal — pure preview */}
      {viewRun && (
        <ModalShell onClose={() => setViewRun(null)} title="Document Preview"
          subtitle={`${viewRun.template?.name || ''} · ${viewRun.code || ''}`}
          gradient="linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)">
          <div className="inbox-modal-body ib-modal-body">
            <HeaderFooterPanel
              header={{ ...DEFAULT_HEADER, ...(viewRun.header_config || {}) } as HeaderConfig}
              setHeader={() => {}}
              footer={{ ...DEFAULT_FOOTER, ...(viewRun.footer_config || {}) } as FooterConfig}
              setFooter={() => {}}
              readOnly
            >
              <div className="tpl-readonly-preview ib-preview ib-preview--view"
                dangerouslySetInnerHTML={{ __html: viewRun.content_html || '<p>(empty)</p>' }}
              />
            </HeaderFooterPanel>
          </div>
          <div className="inbox-modal-footer ib-modal-footer ib-modal-footer--end">
            <button type="button" onClick={() => setViewRun(null)}
              className="inbox-btn-ghost ib-btn-ghost">
              Close
            </button>
            <button type="button" onClick={() => { const v = viewRun; setViewRun(null); openAction(v); }}
              className="ib-btn-decide">
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
            <div className="inbox-modal-body ib-modal-body">
              <HeaderFooterPanel
                header={{ ...DEFAULT_HEADER, ...(actionRun.header_config || {}) } as HeaderConfig}
                setHeader={() => {}}
                footer={{ ...DEFAULT_FOOTER, ...(actionRun.footer_config || {}) } as FooterConfig}
                setFooter={() => {}}
                readOnly
              >
                <div className="tpl-readonly-preview ib-preview ib-preview--action"
                  dangerouslySetInnerHTML={{ __html: actionRun.content_html || '<p>(empty)</p>' }}
                />
              </HeaderFooterPanel>

              <div className="inbox-form-card ib-form-card">
                {isSign && (
                  <>
                    <label className="inbox-input-label ib-input-label">
                      Signer name <span className="ib-req">*</span>
                    </label>
                    <input type="text" value={actionName} onChange={e => setActionName(e.target.value)}
                      placeholder="Your full name (used in the audit trail)"
                      className="inbox-input ib-input-text" />
                    <label className="inbox-input-label ib-input-label">
                      Signature <span className="ib-req">*</span>
                    </label>
                    <SignaturePad
                      typedName={actionName}
                      onChange={(v) => setDrawnSignature(v.dataUrl)}
                      height={150}
                    />
                  </>
                )}
                <label className={`inbox-input-label ib-input-label${isSign ? ' ib-input-label--mt' : ''}`}>Remark</label>
                <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
                  placeholder="Add a remark — optional when approving, REQUIRED when rejecting (describe what should change)."
                  rows={3} className="inbox-input ib-input-textarea" />
                <div className="inbox-hint ib-input-hint">
                  Remarks land in the audit trail. Rejection halts the workflow and returns the document to the sender.
                </div>
              </div>
            </div>
            <div className="inbox-modal-footer ib-modal-footer ib-modal-footer--between">
              <button type="button" onClick={() => submitDecision('reject')}
                disabled={submitting || !actionNote.trim()}
                title={actionNote.trim() ? 'Reject with this remark' : 'Add a remark first'}
                className={`inbox-btn-reject ib-btn-sendback ${actionNote.trim() ? 'is-ready' : 'is-blocked'}`}>
                <i className="ri-close-circle-line me-1" />Reject &amp; Send Back
              </button>
              <div className="d-flex gap-2">
                <button type="button" onClick={() => setActionRun(null)} disabled={submitting}
                  className="inbox-btn-ghost ib-btn-ghost">
                  Cancel
                </button>
                <button type="button" onClick={() => submitDecision('approve')}
                  disabled={submitting || (isSign && (!actionName.trim() || !drawnSignature))}
                  className={`ib-btn-submit ${current?.action === 'Approve' ? 'ib-btn-submit--approve' : isSign ? 'ib-btn-submit--sign' : 'ib-btn-submit--ack'}`}>
                  <i className={`${isSign ? 'ri-quill-pen-line' : current?.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} ib-btn-submit-icon`} />
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
    <div className="inbox-modal-backdrop ib-modal-backdrop" onClick={onClose}>
      <div className="inbox-modal-card ib-modal-card"
        style={{ ['--ib-modal-gradient' as any]: gradient }}
        onClick={(e) => e.stopPropagation()}>
        <div className="ib-modal-head">
          <div className="d-flex align-items-center justify-content-between">
            <div className="min-w-0">
              <strong className="ib-modal-title"><i className="ri-checkbox-circle-line me-2" />{title}</strong>
              {subtitle && <div className="ib-modal-subtitle">{subtitle}</div>}
              {hint && <div className="ib-modal-hint">{hint}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="ib-modal-close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
