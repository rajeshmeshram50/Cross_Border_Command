import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { LFM_CSS } from '../sales/opportunity-pipeline/LeadFilterModal';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Spinner } from 'reactstrap';
import { MasterFormStyles, MasterSelect, MasterDatePicker } from '../master/masterFormKit';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import { Shimmer } from '../../components/ui/Shimmer';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';
import { leaveRequestsApi, ApiLeaveRequest } from './leavePlansApi';
import '../../../css/recruitment.css';
import '../../../css/leave.css';
import '../employee-onboarding/HrEmployeeOnboarding.css';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}
function formatRange(from: string, to: string): string {
  if (!from) return '—';
  if (!to || to === from) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Earned' | 'Maternity' | 'Comp Off' | 'LOP';
type LeaveStage =
  | 'Approved'
  | 'Pending (Manager)'
  | 'Pending (HR)'
  | 'Rejected'
  | 'Cancelled';
type ApprovalState = 'Pending' | 'Approved' | 'Rejected' | 'NA';
// Payroll classification is binary — a leave type is either Paid or Unpaid.
// 'Half-Pay' was never produced by the system (see the classification in
// apiToRow) so it was dropped from the type + the Payroll filter (bug #69).
type PayrollMode = 'Paid Leave' | 'Unpaid';
type ProofState = 'Uploaded' | 'Missing' | 'N/A';
type EscalationReason = 'manager_rejected' | 'aged_out' | 'manager_unavailable' | 'hr_raised' | 'none';

interface PersonRef {
  initials: string;
  name: string;
  designation: string;
}

interface LeaveRequest {
  id: string;
  empCode: string;
  empInitials: string;
  empName: string;
  empRole: string;
  department: string;
  location: string;
  legalEntity: string;
  accent: string;
  type: LeaveType;        // coarse bucket — drives the badge COLOUR only
  typeName: string;       // the real leave-type name as configured (badge LABEL)
  durationDays: number;
  durationLabel: string;
  fromDate: string;
  toDate: string;
  appliedOn: string;
  raisedBy: 'employee' | 'hr';

  reportingManager: PersonRef;
  hrApprover?: PersonRef;

  managerStatus: ApprovalState;
  managerActionAt?: string;
  managerComment?: string;

  hrStatus: ApprovalState;
  hrActionAt?: string;
  hrComment?: string;
  /** Set when a view-only HR user has opened the request — drives the green
   *  "Reviewed by HR" node. Persisted server-side. */
  hrViewedAt?: string;

  escalatedToHr: boolean;
  escalationReason: EscalationReason;

  // Whether the logged-in viewer can Approve/Reject this row right now (it's
  // pending AND it's their turn in the manager→HR chain). Server-computed.
  canActNow: boolean;

  stage: LeaveStage;
  stageNote?: string;

  payroll: PayrollMode;
  proof: ProofState;
  proofVia?: string;
  proofType?: string;
  proofFileName?: string;
  proofUrl?: string;
  proofUploadedAt?: string;
  proofMimeType?: string;
  proofSizeKb?: number;
  reason: string;
}

const STAGE_TONE: Record<LeaveStage, { fg: string; bg: string; dot: string }> = {
  'Approved':          { fg: '#0a716a', bg: '#d3f0ee', dot: '#0ab39c' },
  'Pending (Manager)': { fg: '#a4661c', bg: '#fde8c4', dot: '#f59e0b' },
  'Pending (HR)':      { fg: '#a4661c', bg: '#fde8c4', dot: '#f59e0b' },
  'Rejected':          { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444' },
  'Cancelled':         { fg: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
};

const TYPE_TONE: Record<LeaveType, { fg: string; bg: string }> = {
  'Annual':    { fg: '#5a3fd1', bg: '#ece6ff' },
  'Sick':      { fg: '#b91c1c', bg: '#fee2e2' },
  'Casual':    { fg: '#0c63b0', bg: '#dceefe' },
  'Earned':    { fg: '#0a716a', bg: '#d3f0ee' },
  'Maternity': { fg: '#a02960', bg: '#fdd9ea' },
  'Comp Off':  { fg: '#a4661c', bg: '#fde8c4' },
  'LOP':       { fg: '#374151', bg: '#eef2f6' },
};

const PAYROLL_TONE: Record<PayrollMode, { fg: string; bg: string }> = {
  'Paid Leave': { fg: '#5a3fd1', bg: '#ece6ff' },
  'Unpaid':     { fg: '#374151', bg: '#eef2f6' },
};

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const end = value;
    if (!end) { setDisplay(0); return; }
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(end * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

interface ApprovalNode {
  initials: string;
  name: string;
  role: 'Self' | 'Manager' | 'HR';
  decision: 'approved' | 'viewed' | 'pending' | 'idle' | 'rejected' | 'skipped';
  detail?: string;
  actionAt?: string;
  comment?: string;
}

const deriveChain = (r: LeaveRequest): ApprovalNode[] => {
  const self: ApprovalNode = {
    initials: r.empInitials,
    name: r.empName,
    role: 'Self',
    decision: 'approved',
    detail: r.raisedBy === 'hr' ? 'HR raised on behalf' : 'Leave request submitted',
    actionAt: r.appliedOn,
  };

  const managerSkipped = r.raisedBy === 'hr';
  const managerDecision: ApprovalNode['decision'] =
    managerSkipped ? 'skipped'
    : r.managerStatus === 'Approved' ? 'approved'
    : r.managerStatus === 'Rejected' ? 'rejected'
    : r.managerStatus === 'Pending'  ? 'pending'
    : 'idle';
  const managerDetail =
    managerSkipped ? 'Skipped — HR-raised'
    : r.managerStatus === 'Approved' ? 'Reviewed & approved'
    : r.managerStatus === 'Rejected' ? `Rejected${r.escalatedToHr ? ' — escalated to HR' : ''}`
    : r.managerStatus === 'Pending'  ? 'Awaiting decision'
    : 'Pending';
  const manager: ApprovalNode = {
    initials: r.reportingManager.initials,
    name: r.reportingManager.name,
    role: 'Manager',
    decision: managerDecision,
    detail: managerDetail,
    actionAt: r.managerActionAt,
    comment: r.managerComment,
  };

  // HR is view-only (leave is reporting-manager-only). When HR isn't an acting
  // level, the node only turns green ("Reviewed by HR") once HR has opened the
  // request (r.hrViewedAt) AND the reporting manager has already decided — it
  // stays idle/grey while the request is still awaiting the manager.
  const rmDecided = r.managerStatus === 'Approved' || r.managerStatus === 'Rejected';
  const hrReviewed = !!r.hrViewedAt && rmDecided;
  const hrDecision: ApprovalNode['decision'] =
    !r.escalatedToHr ? (hrReviewed ? 'viewed' : 'idle')
    : r.hrStatus === 'Approved' ? 'approved'
    : r.hrStatus === 'Rejected' ? 'rejected'
    : r.hrStatus === 'Pending'  ? 'pending'
    : 'idle';
  const hrDetail =
    !r.escalatedToHr ? (hrReviewed ? 'Reviewed by HR' : 'CC — informational only')
    : r.escalationReason === 'manager_rejected' && r.hrStatus === 'Approved' ? 'Override approved'
    : r.escalationReason === 'manager_rejected' && r.hrStatus === 'Rejected' ? 'Concurred with manager'
    : r.escalationReason === 'aged_out'         ? 'Auto-escalated · 7-day rule'
    : r.escalationReason === 'hr_raised'        ? 'HR raised the request'
    : r.hrStatus === 'Pending'  ? 'Awaiting HR review'
    : r.hrStatus === 'Approved' ? 'Approved'
    : r.hrStatus === 'Rejected' ? 'Rejected'
    : 'Pending';
  const hr: ApprovalNode = {
    initials: r.hrApprover?.initials || 'HR',
    name: r.hrApprover?.name || 'HR Team',
    role: 'HR',
    decision: hrDecision,
    detail: hrDetail,
    actionAt: r.hrActionAt || (hrDecision === 'viewed' ? r.hrViewedAt : undefined),
    comment: r.hrComment,
  };

  return [self, manager, hr];
};

function apiToLeaveRequest(api: ApiLeaveRequest, idx: number): LeaveRequest {
  const emp = api.employee;
  const empName = emp
    ? (emp.display_name?.trim() || `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim())
    : '—';
  const initials = empName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  const empRole = emp?.designation?.name
    || emp?.department?.name
    || '—';

  const chain = (api as any).approval_chain as Array<{ status?: string; acted_at?: string | null; comment?: string | null }> | null;
  const status = api.status;
  const mapNode = (s?: string): ApprovalState =>
    s === 'Approved' ? 'Approved'
    : s === 'Rejected' ? 'Rejected'
    : s === 'Skipped' ? 'NA'
    : 'Pending';

  let stage: LeaveStage = 'Pending (Manager)';
  let managerStatus: ApprovalState = 'Pending';
  let hrStatus: ApprovalState = 'Pending';
  if (status === 'Cancelled') {
    stage = 'Cancelled';
    managerStatus = 'NA';
    hrStatus = 'NA';
  } else if (chain && chain.length > 0) {
    // Read EACH level's own status so a decision is attributed to whoever
    // actually acted — manager (level 1) vs HR (level 2) — instead of always
    // blaming the manager whenever the overall request is Rejected. (Bug: HR
    // rejection showed up as a reporting-manager rejection in the chain.)
    managerStatus = mapNode(chain[0]?.status);
    hrStatus = chain.length > 1 ? mapNode(chain[1]?.status) : 'NA';
    stage = status === 'Approved' ? 'Approved'
      : status === 'Rejected' ? 'Rejected'
      : (((api as any).current_approval_level ?? 1) > 1 ? 'Pending (HR)' : 'Pending (Manager)');
  } else {
    // Legacy rows with no approval chain — fall back to the overall status.
    if (status === 'Approved') { stage = 'Approved'; managerStatus = 'Approved'; }
    else if (status === 'Rejected') { stage = 'Rejected'; managerStatus = 'Rejected'; }
    else {
      const level = (api as any).current_approval_level ?? 1;
      stage = level > 1 ? 'Pending (HR)' : 'Pending (Manager)';
    }
  }
  // HR is a real approval step (not just informational CC) only when the chain
  // has a second level that wasn't auto-skipped. Drives whether the HR node
  // renders its own decision in the timeline.
  const hasHrLevel = !!chain && chain.length > 1 && chain[1]?.status !== 'Skipped';

  const typeMap: Record<string, LeaveType> = {
    'Sick Leave': 'Sick', 'Casual Leave': 'Casual', 'Annual Leave': 'Annual',
    'Earned Leave': 'Earned', 'Comp Off': 'Comp Off',
  };
  // `type` is only a COARSE colour bucket. Any leave type not in typeMap
  // (e.g. "Emergency Leave") used to be silently shown AS 'Casual' — the
  // badge label must instead reflect the real configured name, so we keep
  // that separately in `typeName`. The colour falls back to Casual/LOP tone
  // for unmapped names, which is fine; the label stays accurate.
  const type: LeaveType = typeMap[api.leave_type?.name ?? ''] ?? (
    (api.leave_type?.type === 'Unpaid Leave') ? 'LOP' : 'Casual'
  );
  const typeName: string = (api.leave_type?.name ?? '').trim() || type;

  const days = Number(api.days);
  return {
    id: String(api.id),
    empCode: emp?.emp_code || `EMP-${emp?.id ?? idx}`,
    empInitials: initials,
    empName,
    empRole,
    department: emp?.department?.name || '—',
    location: '—',
    legalEntity: '—',
    accent: accent(idx),
    type,
    typeName,
    durationDays: days,
    durationLabel: days === 1 ? '1 day' : `${days} days`,
    fromDate: typeof api.from_date === 'string' ? api.from_date.slice(0, 10) : '',
    toDate: typeof api.to_date === 'string' ? api.to_date.slice(0, 10) : '',
    appliedOn: typeof api.created_at === 'string' ? api.created_at.slice(0, 10) : '',
    raisedBy: 'employee',
    reportingManager: (() => {
      const rm = (emp as any)?.reporting_manager;
      const rmu = (emp as any)?.reporting_manager_user;
      const nm = (rm?.display_name
        || [rm?.first_name, rm?.last_name].filter(Boolean).join(' ').trim()
        || rmu?.name
        || '').trim();
      const ini = nm ? nm.split(/\s+/).filter(Boolean).map((s: string) => s[0]).join('').slice(0, 2).toUpperCase() : '—';
      return { initials: nm ? ini : '—', name: nm || '—', designation: 'Reporting Manager' };
    })(),
    hrApprover: api.approver ? { initials: (api.approver.name || '?').split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase(), name: api.approver.name, designation: 'Approver' } : undefined,
    managerStatus,
    managerActionAt: chain?.[0]?.acted_at ? chain[0].acted_at.slice(0, 10) : (api.approved_at ? api.approved_at.slice(0, 10) : undefined),
    managerComment: chain?.[0]?.comment ?? api.approver_comment ?? undefined,
    hrStatus,
    hrActionAt: chain?.[1]?.acted_at ? chain[1].acted_at.slice(0, 10) : undefined,
    hrComment: chain?.[1]?.comment ?? undefined,
    hrViewedAt: (api as any).hr_viewed_at ? String((api as any).hr_viewed_at).slice(0, 10) : undefined,
    escalatedToHr: hasHrLevel,
    escalationReason: 'none',
    canActNow: !!(api as any).can_act_now,
    stage,
    stageNote: undefined,
    // Payroll classification comes from the master leave type's Paid/Unpaid
    // setting (fallback to the legacy 'Unpaid Leave' type for older rows).
    payroll: ((api.leave_type?.paid_unpaid === 'Unpaid' || api.leave_type?.type === 'Unpaid Leave')
      ? 'Unpaid' : 'Paid Leave') as PayrollMode,
    proof: 'N/A',
    reason: api.reason ?? '',
  };
}

const KPI_CARDS = [
  { key: 'total',    label: 'Total Requests',   icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#0c63b0,#0ea5e9)' },
  { key: 'pending',  label: 'Pending Approval', icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
  { key: 'approved', label: 'Approved (Month)', icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#22c8a9)' },
  { key: 'rejected', label: 'Rejected',         icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#f06548,#fda192)' },
] as const;

export default function HrLeave() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const leavePerm = user?.permissions?.['hr.leave'];
  const canApprove = isSuperAdmin || !!leavePerm?.can_approve;
  const canManagePlans = isSuperAdmin || !!leavePerm?.can_add || !!leavePerm?.can_edit;
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const list = await leaveRequestsApi.approvals({ status: 'All' });
      setRequests(list.map(apiToLeaveRequest));
    } catch (err) {
      console.warn('[HrLeave] failed to load leave requests', err);
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  const [confirmAction, setConfirmAction] = useState<
    { row: LeaveRequest; action: 'approve' | 'reject' } | null
  >(null);

  const applyAction = async (comment: string) => {
    if (!confirmAction) return;
    const { row, action } = confirmAction;
    const id = Number(row.id);
    if (!Number.isFinite(id)) {
      setConfirmAction(null);
      return;
    }
    try {
      if (action === 'approve') {
        await leaveRequestsApi.approve(id, comment.trim() || undefined);
      } else {
        await leaveRequestsApi.reject(id, comment.trim() || undefined);
      }
      await loadRequests();
      toast.success(action === 'approve' ? 'Leave approved' : 'Leave rejected', 'The request has been updated.');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Action failed';
      toast.error('Action failed', msg);
    } finally {
      setConfirmAction(null);
    }
  };

  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState<string>('All');
  const [department, setDepartment] = useState<string>('All');
  const [type,    setType]    = useState<string>('All');
  const [payroll, setPayroll] = useState<string>('All');
  /* Paging lives in <DataTable> now. */
  // Filter modal (Department / Type / Payroll live inside it now) — same
  // two-pane shell the Customers list uses, via the shared LFM_CSS sheet.
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = [department, type, payroll].filter(v => v !== 'All').length;

  const [detail, setDetail] = useState<LeaveRequest | null>(null);

  // Open a request's detail. Leave is reporting-manager-only, so HR/admins are
  // view-only — opening the detail marks it "Reviewed by HR" (persisted), which
  // turns the HR node green. Idempotent server-side; fire-and-forget.
  const isHrViewer = ['super_admin', 'client_admin', 'branch_user'].includes(String(user?.user_type || ''));
  const openDetail = (r: LeaveRequest) => {
    setDetail(r);
    if (!isHrViewer || r.hrViewedAt) return;
    const stamp = new Date().toISOString().slice(0, 10);
    setDetail(prev => (prev && prev.id === r.id ? { ...prev, hrViewedAt: stamp } : prev));
    setRequests(prev => prev.map(x => (x.id === r.id ? { ...x, hrViewedAt: stamp } : x)));
    leaveRequestsApi.hrView(Number(r.id)).catch(err => console.warn('[HrLeave] hr-view failed', err));
  };
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(true);
  const [onLeaveDate, setOnLeaveDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isPendingRow = (r: LeaveRequest) => r.stage.startsWith('Pending');
  const toggleRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Bulk approve / reject for every selected (always pending — the row
  // checkbox is disabled otherwise) request. Each id hits the same
  // approve/reject endpoint as the single-row action; allSettled lets the
  // batch finish even if one request fails, then we reload, clear the
  // selection, and surface a single summary toast.
  // Tracks which bulk action is in flight ('approve' | 'reject') so only the
  // clicked button shows its spinner while both stay disabled; null when idle.
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'reject' | null>(null);
  const runBulkAction = async (action: 'approve' | 'reject') => {
    if (bulkBusy) return;
    const ids = requests
      .filter(r => selectedIds.has(r.id) && isPendingRow(r) && r.canActNow)
      .map(r => Number(r.id))
      .filter(id => Number.isFinite(id));
    if (ids.length === 0) return;
    setBulkBusy(action);
    try {
      const results = await Promise.allSettled(
        ids.map(id => (action === 'approve' ? leaveRequestsApi.approve(id) : leaveRequestsApi.reject(id))),
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      await loadRequests();
      clearSelection();
      if (ok > 0) {
        toast.success(
          action === 'approve' ? 'Leaves approved' : 'Leaves rejected',
          `${ok} request${ok === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : 'rejected'}${failed ? `, ${failed} failed` : ''}.`,
        );
      } else {
        toast.error('Bulk action failed', `Could not ${action} the selected request${failed === 1 ? '' : 's'}.`);
      }
    } catch (err: any) {
      toast.error('Bulk action failed', err?.response?.data?.message || err?.message || 'Action failed');
    } finally {
      setBulkBusy(null);
    }
  };

  const counts = useMemo(() => {
    const approved = requests.filter(r => r.stage === 'Approved');
    const pending  = requests.filter(r => r.stage.startsWith('Pending'));
    const rejected = requests.filter(r => r.stage === 'Rejected');
    const cancelled = requests.filter(r => r.stage === 'Cancelled');
    return {
      total:        requests.length,
      pending:      pending.length,
      approved:     approved.length,
      approvedDays: approved.reduce((s, r) => s + r.durationDays, 0),
      rejected:     rejected.length,
      cancelled:    cancelled.length,
      tabs: {
        All:       requests.length,
        Pending:   pending.length,
        Approved:  approved.length,
        Rejected:  rejected.length,
        Cancelled: cancelled.length,
      },
    };
  }, [requests]);

  const onLeaveToday = useMemo(() => {
    return requests.filter(r =>
      r.stage === 'Approved' && r.fromDate <= onLeaveDate && r.toDate >= onLeaveDate
    );
  }, [requests, onLeaveDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(r => {
      if (status === 'Pending'  && !r.stage.startsWith('Pending')) return false;
      if (status === 'Approved' && r.stage !== 'Approved')          return false;
      if (status === 'Rejected' && r.stage !== 'Rejected')          return false;
      if (status === 'Cancelled' && r.stage !== 'Cancelled')        return false;

      if (type       !== 'All' && r.typeName   !== type)       return false;
      if (payroll    !== 'All' && r.payroll    !== payroll)    return false;
      if (department !== 'All' && r.department !== department) return false;

      if (!q) return true;
      return [r.empName, r.empRole, r.id, r.empCode, r.type].some(v => v.toLowerCase().includes(q));
    });
  }, [requests, search, status, type, payroll, department]);

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     4+19+9+7+17+15+9+11+9. */
  const columns = useMemo<DataTableColumn<LeaveRequest>[]>(() => [
    {
      header: 'Employee',
      id: 'employee',
      accessorFn: (r: LeaveRequest) => r.empName,
      // wrap: code · role sits on a second line under the name.
      meta: { width: '19%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}
            >
              {r.empInitials}
            </div>
            <div className="min-w-0">
              <div className="fw-semibold fs-13 text-truncate">{r.empName}</div>
              <div className="text-muted text-truncate" style={{ fontSize: 11.5 }}>{r.empCode} · {r.empRole}</div>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Type',
      accessorKey: 'typeName',
      meta: { width: '9%' },
      cell: info => {
        const t = TYPE_TONE[info.row.original.type];
        return (
          <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: t.bg, ['--lvp-fg' as string]: t.fg, ['--lvp-accent' as string]: t.fg } as CSSProperties}>
            {info.row.original.typeName}
          </span>
        );
      },
    },
    { header: 'Duration', accessorKey: 'durationLabel', meta: { width: '7%' }, cell: info => <span className="fs-13">{String(info.getValue() ?? '')}</span> },
    {
      /* Sorts on the ISO from-date so the column is chronological, not
         alphabetical on "05-Aug-2026 → 07-Aug-2026". */
      header: 'Date Range',
      id: 'fromDate',
      accessorFn: (r: LeaveRequest) => r.fromDate,
      meta: { width: '17%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <>
            <div className="fs-13 fw-semibold"><span className="rec-date">{formatRange(r.fromDate, r.toDate)}</span></div>
            <div className="text-muted" style={{ fontSize: 11 }}>Applied: {formatDate(r.appliedOn)}</div>
          </>
        );
      },
    },
    {
      header: 'Approval Chain',
      id: 'chain',
      enableSorting: false,
      meta: { width: '15%', wrap: true },
      cell: info => <ChainDots row={info.row.original} />,
    },
    {
      header: 'Payroll',
      accessorKey: 'payroll',
      meta: { width: '9%' },
      cell: info => {
        const t = PAYROLL_TONE[info.row.original.payroll];
        return (
          <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: t.bg, ['--lvp-fg' as string]: t.fg, ['--lvp-accent' as string]: t.fg } as CSSProperties}>
            {info.row.original.payroll}
          </span>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'stage',
      // wrap: pending rows carry a stage note under the pill.
      meta: { width: '11%', wrap: true },
      cell: info => {
        const r = info.row.original;
        const t = STAGE_TONE[r.stage];
        const isPending = r.stage.startsWith('Pending');
        return (
          <>
            <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: t.bg, ['--lvp-fg' as string]: t.fg, ['--lvp-accent' as string]: t.dot } as CSSProperties}>
              {r.stage}
            </span>
            {isPending && r.stageNote && (
              <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>{r.stageNote}</div>
            )}
          </>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: '9%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center align-items-center">
            <ActionBtn title="View details" icon="ri-eye-line" tone="info" onClick={() => openDetail(r)} />
            {/* Approve / Reject appear ONLY when it's the viewer's turn in the
                manager→HR chain (server-computed canActNow). HR therefore can't
                act while it sits at the manager level, and a manager-rejected
                request (now in the Rejected tab) shows View-only. */}
            {canApprove && r.canActNow && (
              <>
                <ActionBtn title="Approve" icon="ri-check-line" tone="success" onClick={() => setConfirmAction({ row: r, action: 'approve' })} />
                <ActionBtn title="Reject"  icon="ri-close-line" tone="danger"  onClick={() => setConfirmAction({ row: r, action: 'reject' })} />
              </>
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canApprove]);

  const DEPT_OPTIONS = [
    { value: 'All', label: 'All Departments' },
    ...Array.from(new Set(requests.map(r => r.department))).filter(Boolean).sort()
      .map(v => ({ value: v, label: v })),
  ];
  // Only the real, operational leave types that actually appear in requests
  // (i.e. types assigned inside active plans) — NOT a hardcoded list of generic
  // categories that may not exist in any plan.
  const TYPE_OPTIONS = [
    { value: 'All', label: 'All' },
    ...Array.from(new Set(requests.map(r => r.typeName))).filter(Boolean).sort()
      .map(v => ({ value: v, label: v })),
  ];
  const PAYROLL_OPTIONS = [
    { value: 'All',        label: 'All' },
    { value: 'Paid Leave', label: 'Paid Leave' },
    { value: 'Unpaid',     label: 'Unpaid' },
  ];

  return (
    <>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div className="rec-page">
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-calendar-2-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Leave Management</span>
                    <span className="onb-hero-pill">
                      <span className="dot" />
                      FY 2025–26
                    </span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Leave requests, balances, and approval pipeline across all employees
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <button type="button" className="rec-btn-ghost" onClick={() => setHolidaysOpen(true)}>
                  <i className="ri-calendar-event-line" />Holidays
                </button>
                {canManagePlans && (
                  <button
                    type="button"
                    className="rec-btn-primary"
                    onClick={() => navigate('/hr/leave-plans')}
                  >
                    <i className="ri-settings-3-line" />Leave Plans
                  </button>
                )}
              </div>
            </div>

            <Row className="g-3 mb-3 align-items-stretch rec-page-kpis">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={3} md={6} sm={6} xs={6}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">{k.label}</span>
                      <span className="rec-kpi-num">
                        <AnimatedNumber value={(counts as any)[k.key]} />
                      </span>
                    </div>
                    <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                      <i className={k.icon} />
                    </span>
                  </div>
                </Col>
              ))}
            </Row>

            <div className={`lv-today-card mb-3 ${todayOpen ? 'is-open' : 'is-closed'}`}>
              <div className="lv-today-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="lv-today-head-btn"
                  onClick={() => setTodayOpen(o => !o)}
                  aria-expanded={todayOpen}
                  style={{ flex: '1 1 320px', minWidth: 0 }}
                >
                  <span className="lv-today-banner">
                    <span className="lv-today-banner-icon">
                      <i className="ri-user-follow-line" />
                    </span>
                    <span className="lv-today-banner-text">
                      <span className="lv-today-banner-title">
                        {onLeaveDate === new Date().toISOString().slice(0, 10) ? 'On Leave Today' : 'On Leave'}
                      </span>
                      <span className="lv-today-banner-sub">
                        <i className="ri-calendar-event-line" />
                        {formatDate(onLeaveDate)}
                        {onLeaveToday.length > 0 && (
                          <>
                            <span className="lv-today-banner-dot" />
                            {Array.from(new Set(onLeaveToday.map(r => r.type)))
                              .map(t => `${onLeaveToday.filter(r => r.type === t).length} ${t}`)
                              .join(' · ')}
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                </button>

                <div className="d-flex align-items-center gap-2" style={{ marginLeft: 'auto' }}>
                  <label className="text-muted" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    Date
                  </label>
                  <div className="att-date-nav">
                    <button
                      type="button"
                      className="att-date-nav-btn"
                      aria-label="Previous day"
                      onClick={() => {
                        const d = new Date(onLeaveDate); d.setDate(d.getDate() - 1);
                        setOnLeaveDate(d.toISOString().slice(0, 10));
                      }}
                    >
                      <i className="ri-arrow-left-s-line" />
                    </button>
                    <div className="att-date-nav-pick">
                      <MasterDatePicker
                        value={onLeaveDate}
                        onChange={v => setOnLeaveDate(v || new Date().toISOString().slice(0, 10))}
                        placeholder="Pick date"
                      />
                    </div>
                    <button
                      type="button"
                      className="att-date-nav-btn"
                      aria-label="Next day"
                      onClick={() => {
                        const d = new Date(onLeaveDate); d.setDate(d.getDate() + 1);
                        setOnLeaveDate(d.toISOString().slice(0, 10));
                      }}
                    >
                      <i className="ri-arrow-right-s-line" />
                    </button>
                    {onLeaveDate !== new Date().toISOString().slice(0, 10) && (
                      <button
                        type="button"
                        className="att-date-nav-today"
                        onClick={() => setOnLeaveDate(new Date().toISOString().slice(0, 10))}
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <span className={`lv-today-count ${onLeaveToday.length === 0 ? 'is-empty' : ''}`}>
                    <i className={onLeaveToday.length === 0 ? 'ri-emotion-happy-line' : 'ri-team-line'} />
                    {onLeaveToday.length} {onLeaveToday.length === 1 ? 'person' : 'people'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTodayOpen(o => !o)}
                    aria-label={todayOpen ? 'Collapse' : 'Expand'}
                    className="rec-btn-ghost"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  >
                    <i className={`ri-arrow-${todayOpen ? 'up' : 'down'}-s-line`} />
                  </button>
                </div>
              </div>

              {todayOpen && (
                onLeaveToday.length === 0 ? (
                  <div className="lv-today-empty">
                    <span className="lv-today-empty-icon">
                      <i className="ri-emotion-happy-line" />
                    </span>
                    <div className="fw-bold mt-2" style={{ fontSize: 13 }}>
                      {onLeaveDate === new Date().toISOString().slice(0, 10)
                        ? 'No one is on leave today'
                        : onLeaveDate < new Date().toISOString().slice(0, 10)
                          ? `No one was on leave on ${formatDate(onLeaveDate)}`
                          : `No one is on leave on ${formatDate(onLeaveDate)}`}
                    </div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      No approved leaves overlap {formatDate(onLeaveDate)}.
                    </div>
                  </div>
                ) : (
                  <div className="lv-today-strip">
                    {onLeaveToday.map(r => {
                      const tType = TYPE_TONE[r.type];
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className="lv-today-chip"
                          onClick={() => openDetail(r)}
                          title={`${r.empName} · ${r.typeName} · until ${formatDate(r.toDate)}`}
                        >
                          <span
                            className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{
                              width: 36, height: 36, fontSize: 12,
                              background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                            }}
                          >
                            {r.empInitials}
                          </span>
                          <span className="lv-today-chip-body">
                            <span className="lv-today-chip-name">{r.empName}</span>
                            <span className="lv-today-chip-meta">
                              <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: tType.bg, ['--lvp-fg' as string]: tType.fg, ['--lvp-accent' as string]: tType.fg, padding: '1px 7px', fontSize: 10 } as CSSProperties}>
                                {r.typeName}
                              </span>
                              <span className="text-muted" style={{ fontSize: 10.5 }}>
                                <i className="ri-arrow-right-line me-1" />till {formatDate(r.toDate)}
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {canApprove && selectedIds.size > 0 && (
              <div className="d-flex align-items-center gap-2 flex-wrap p-2 rounded-3 border mb-2 bg-light">
                <span className="rec-header-count">
                  <span className="dot" />
                  {selectedIds.size} selected
                </span>
                <button type="button" className="rec-btn-primary" disabled={!!bulkBusy} onClick={() => void runBulkAction('approve')}>
                  {bulkBusy === 'approve'
                    ? <><Spinner size="sm" className="me-1" style={{ width: 14, height: 14 }} />Approving…</>
                    : <><i className="ri-check-double-line" />Approve Selected</>}
                </button>
                <button type="button" className="rec-btn-soft" disabled={!!bulkBusy} onClick={() => void runBulkAction('reject')}>
                  {bulkBusy === 'reject'
                    ? <><Spinner size="sm" className="me-1" style={{ width: 14, height: 14 }} />Rejecting…</>
                    : <><i className="ri-close-line" />Reject Selected</>}
                </button>
                <button type="button" className="rec-btn-ghost ms-auto" disabled={!!bulkBusy} onClick={clearSelection}>
                  <i className="ri-close-circle-line" />Clear
                </button>
              </div>
            )}

            {/* Shared list table (components/ui/DataTable) — status tabs,
                search, sortable headers and the rows-per-page pager all come
                from the component; the Filter button (Department / Type /
                Payroll modal) rides in its toolbar. */}
            <DataTable<LeaveRequest>
              data={filtered}
              columns={columns}
              serial={{ header: 'SR.' }}
              accent="violet"
              autoFitRows
              minWidth={1320}
              loading={requestsLoading}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search name, ID, type…"
              tabs={[
                { key: 'All',       label: 'All Leaves', icon: 'ri-stack-line',           count: counts.tabs.All },
                { key: 'Pending',   label: 'Pending',    icon: 'ri-time-line',            count: counts.tabs.Pending },
                { key: 'Approved',  label: 'Approved',   icon: 'ri-checkbox-circle-line', count: counts.tabs.Approved },
                { key: 'Rejected',  label: 'Rejected',   icon: 'ri-close-circle-line',    count: counts.tabs.Rejected },
                { key: 'Cancelled', label: 'Cancelled',  icon: 'ri-forbid-line',          count: counts.tabs.Cancelled },
              ]}
              activeTab={status}
              onTabChange={k => setStatus(k as typeof status)}
              activeFilterCount={activeFilterCount}
              onFilterClick={() => setFilterOpen(true)}
              emptyMessage={
                <>
                  <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No leave requests match your filters
                </>
              }
            />
          </div>
        </Col>
      </Row>

      <LeaveDetailsModal row={detail} onClose={() => setDetail(null)} />
      <LeaveFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initial={{ department, type, payroll }}
        deptOptions={DEPT_OPTIONS}
        typeOptions={TYPE_OPTIONS}
        payrollOptions={PAYROLL_OPTIONS}
        onApply={(f) => { setDepartment(f.department); setType(f.type); setPayroll(f.payroll); }}
      />
      <HolidayListModal open={holidaysOpen} onClose={() => setHolidaysOpen(false)} />
      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={applyAction}
      />
    </>
  );
}

/* Leave filter modal — same two-pane shell as the Customers list's filter
 * (left menu picks a facet, right pane lists its single-select options), reusing
 * that modal's shared LFM_CSS sheet + lfm-* class names. Facets: Department /
 * Type / Payroll. Each is single-select; "no selection" means "All". Collects a
 * draft and commits on Apply, so the table only re-filters once. */
type LeaveFacetKey = 'department' | 'type' | 'payroll';
type LeaveFilterValues = { department: string; type: string; payroll: string };

const LEAVE_FACET_ICONS: Record<LeaveFacetKey, ReactNode> = {
  department: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  type: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" /><polyline points="8 12 11 15 16 9" />
    </svg>
  ),
  payroll: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

function LeaveFilterModal({
  open, onClose, onApply, initial, deptOptions, typeOptions, payrollOptions,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (f: LeaveFilterValues) => void;
  initial: LeaveFilterValues;
  deptOptions: { value: string; label: string }[];
  typeOptions: { value: string; label: string }[];
  payrollOptions: { value: string; label: string }[];
}) {
  const [active, setActive] = useState<LeaveFacetKey>('department');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<LeaveFilterValues>(initial);

  useEffect(() => {
    if (open) { setDraft(initial); setActive('department'); setSearch(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // Scroll lock (both <html> and <body>) while open — same as PartyFilterModal.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;

  const FACETS: { key: LeaveFacetKey; label: string }[] = [
    { key: 'department', label: 'Department' },
    { key: 'type',       label: 'Type' },
    { key: 'payroll',    label: 'Payroll' },
  ];
  const optsFor = (k: LeaveFacetKey) =>
    (k === 'department' ? deptOptions : k === 'type' ? typeOptions : payrollOptions)
      // Drop the 'All' sentinel — an empty selection already means "All".
      .filter(o => o.value !== 'All');

  const facetCount = (k: LeaveFacetKey) => (draft[k] !== 'All' ? 1 : 0);
  const selectedCount = FACETS.reduce((n, f) => n + facetCount(f.key), 0);
  const isChecked = (value: string) => draft[active] === value;
  // Re-clicking the chosen option clears it back to "All".
  const pick = (value: string) => setDraft(prev => ({ ...prev, [active]: prev[active] === value ? 'All' : value }));

  const currentList = optsFor(active);
  const searched = search.trim()
    ? currentList.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : currentList;

  const onApplyClick = () => { onApply(draft); onClose(); };
  const onReset = () => {
    const cleared: LeaveFilterValues = { department: 'All', type: 'All', payroll: 'All' };
    setDraft(cleared);
    onApply(cleared);
  };

  return createPortal((
    <div className="lfm-backdrop lfm-purple">
      <style>{LFM_CSS}</style>
      <div className="lfm-modal">
        <div className="lfm-head">
          <div className="lfm-head-left">
            <div className="lfm-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="9" y1="18" x2="15" y2="18" />
              </svg>
            </div>
            <div>
              <div className="lfm-head-title">Filter Leaves</div>
              <div className="lfm-head-sub">Select filters to narrow down results</div>
            </div>
          </div>
          {selectedCount > 0 && <span className="lfm-head-count">{selectedCount} selected</span>}
          <button className="lfm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="lfm-body">
          <div className="lfm-left">
            <div className="lfm-left-label">FILTER BY</div>
            <div className="lfm-menu">
              {FACETS.map(f => {
                const count = facetCount(f.key);
                return (
                  <button
                    type="button"
                    key={f.key}
                    className={`lfm-menu-item ${active === f.key ? 'on' : ''}`}
                    onClick={() => { setActive(f.key); setSearch(''); }}
                  >
                    <span className="lfm-menu-ico">{LEAVE_FACET_ICONS[f.key]}</span>
                    <span className="lfm-menu-label">{f.label}</span>
                    {count > 0 && <span className="lfm-menu-count" aria-hidden="true">{count}</span>}
                  </button>
                );
              })}
            </div>
            <div className="lfm-left-foot">
              <button className="lfm-btn lfm-btn-primary" onClick={onApplyClick}>Apply Filter</button>
              <button className="lfm-btn-reset" onClick={onReset}>Reset All</button>
            </div>
          </div>

          <div className="lfm-right">
            <div className="lfm-search-wrap">
              <svg className="lfm-search-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="lfm-search"
                placeholder={`Search ${FACETS.find(f => f.key === active)?.label.toLowerCase()}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="lfm-options">
              {searched.length === 0 ? (
                <div className="lfm-empty">No options available</div>
              ) : (
                searched.map(opt => {
                  const checked = isChecked(opt.value);
                  return (
                    <label key={opt.value} className={`lfm-card ${checked ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name={`leave-facet-${active}`}
                        checked={checked}
                        readOnly
                        onClick={() => pick(opt.value)}
                      />
                      <span className="lfm-check lfm-check-round" aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="lfm-card-label">
                        <span className="lfm-card-name">{opt.label}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function HolidayListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/holidays')
      .then(res => setRows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  const WK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const fmt = (raw: any) => {
    const d = new Date(String(raw));
    if (isNaN(d.getTime())) return String(raw ?? '—');
    return `${String(d.getDate()).padStart(2, '0')} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  };
  const weekday = (raw: any) => {
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? '—' : WK[d.getDay()];
  };
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" scrollable contentClassName="border-0">
      <ModalBody className="p-0" style={{ background: dark ? '#1f2937' : '#fff', color: dark ? '#e5e7eb' : undefined }}>
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 60%, #a78bfa 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-calendar-event-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16 }}>Holidays</h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                  {loading ? 'Loading…' : `${sorted.length} holiday${sorted.length === 1 ? '' : 's'} configured`}
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', maxHeight: '65vh', overflowY: 'auto' }}>
          {loading ? (
            <div className="text-center py-5 text-muted">
              <i className="ri-loader-4-line" style={{ fontSize: 26, animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: 13, marginTop: 8 }}>Loading holidays…</div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="ri-calendar-2-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
              No holidays configured yet.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle table-nowrap mb-0">
                <thead style={{ background: dark ? 'rgba(255,255,255,0.06)' : '#f8f9fa', color: dark ? 'rgba(255,255,255,0.65)' : undefined }}>
                  <tr>
                    <th className="text-center" style={{ width: 60, background: 'transparent', color: 'inherit' }}>Sr No</th>
                    <th style={{ background: 'transparent', color: 'inherit' }}>Holiday</th>
                    <th style={{ width: 135, background: 'transparent', color: 'inherit' }}>Date</th>
                    <th style={{ width: 110, background: 'transparent', color: 'inherit' }}>Day</th>
                    <th style={{ width: 120, background: 'transparent', color: 'inherit' }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h, i) => (
                    <tr key={h.id ?? i}>
                      <td className="text-center text-muted" style={{ fontSize: 12.5, background: 'transparent' }}>{i + 1}</td>
                      <td style={{ background: 'transparent' }}>
                        <div className="fw-semibold" style={{ fontSize: 13, color: dark ? '#f1f5f9' : undefined }}>{h.name}</div>
                        {h.group?.name && <div className="text-muted" style={{ fontSize: 11 }}>{h.group.name}</div>}
                      </td>
                      <td style={{ fontSize: 13, background: 'transparent', color: dark ? '#e5e7eb' : undefined }}>{fmt(h.date)}</td>
                      <td className="text-muted" style={{ fontSize: 13, background: 'transparent' }}>{weekday(h.date)}</td>
                      <td style={{ background: 'transparent' }}><span className="rec-pill" style={{ background: dark ? 'rgba(124,92,252,0.20)' : '#ede9fe', color: dark ? '#c4b5fd' : '#5b3fd1', fontSize: 11 }}>{h.type || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

function LeaveDetailsModal({ row, onClose }: { row: LeaveRequest | null; onClose: () => void }) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  if (!row) return null;

  const tType = TYPE_TONE[row.type];
  const tPay = PAYROLL_TONE[row.payroll];
  const tStage = STAGE_TONE[row.stage];
  const chain = deriveChain(row);

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="rec-view-field">
      <div className="rec-view-label">{label}</div>
      <div className="rec-view-value">{value || <span className="text-muted">—</span>}</div>
    </div>
  );

  return (
    <Modal
      isOpen={!!row}
      toggle={onClose}
      centered
      size="lg"
      backdrop="static"
      contentClassName="rec-view-content border-0"
    >
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{
                  width: 38, height: 38,
                  background: `linear-gradient(135deg, ${row.accent}, ${row.accent}cc)`,
                  color: '#fff', fontWeight: 700, fontSize: 13,
                }}
              >
                {row.empInitials}
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  {row.empName} <span style={{ opacity: 0.8 }}>· {row.id}</span>
                </h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  {row.empRole} · Reporting to {row.reportingManager.name}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="rec-view-body" style={{ padding: '14px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>

          <div className="rec-view-card">
            <div className="rec-view-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              <Field label="Leave Type" value={
                <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: tType.bg, ['--lvp-fg' as string]: tType.fg, ['--lvp-accent' as string]: tType.fg } as CSSProperties}>{row.typeName}</span>
              } />
              <Field label="Duration" value={row.durationLabel} />
              <Field label="Dates" value={formatRange(row.fromDate, row.toDate)} />
              <Field label="Reporting Manager" value={
                <span>
                  {row.reportingManager.name}
                  <span className="text-muted d-block" style={{ fontSize: 11 }}>{row.reportingManager.designation}</span>
                </span>
              } />
              <Field label="Submitted" value={formatDate(row.appliedOn)} />
              <Field label="Payroll" value={
                <span className="rec-pill lv-tone-pill" style={{ ['--lvp-bg' as string]: tPay.bg, ['--lvp-fg' as string]: tPay.fg, ['--lvp-accent' as string]: tPay.fg } as CSSProperties}>{row.payroll}</span>
              } />
              <Field label="Status" value={
                <span className="rec-pill lv-tone-pill d-inline-flex align-items-center gap-1" style={{ ['--lvp-bg' as string]: tStage.bg, ['--lvp-fg' as string]: tStage.fg, ['--lvp-accent' as string]: tStage.dot } as CSSProperties}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: tStage.dot }} />
                  {row.stage}
                </span>
              } />
              <Field label="Reason" value={row.reason} />
            </div>
          </div>

          <div className="rec-view-card mt-3">
            <div className="rec-view-label mb-2">Approval Timeline</div>
            <ApprovalTimelineList chain={chain} reportingManager={row.reportingManager} appliedOn={row.appliedOn} />
            {row.escalatedToHr && (
              <div className="mt-2 d-flex align-items-start gap-2 p-2 rounded" style={{ background: dark ? 'rgba(245,158,11,0.16)' : '#fef3c7', border: `1px solid ${dark ? 'rgba(245,158,11,0.35)' : '#fde68a'}`, color: dark ? '#fcd34d' : '#78350f' }}>
                <i className="ri-information-line" style={{ fontSize: 16, marginTop: 1 }} />
                <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                  <strong style={{ display: 'block' }}>
                    {row.escalationReason === 'manager_rejected' && 'Manager rejected — escalated to HR'}
                    {row.escalationReason === 'aged_out'         && 'Auto-escalated to HR (>7 days)'}
                    {row.escalationReason === 'hr_raised'        && 'HR raised on behalf of employee'}
                    {row.escalationReason === 'manager_unavailable' && 'Manager unavailable — escalated to HR'}
                  </strong>
                  <span>
                    {row.escalationReason === 'manager_rejected' && 'HR can override the manager\'s decision after reviewing context.'}
                    {row.escalationReason === 'aged_out'         && 'Request sat with the manager for over 7 days; HR has been pulled in.'}
                    {row.escalationReason === 'hr_raised'        && 'Manager step is skipped — HR is the sole approver.'}
                    {row.escalationReason === 'manager_unavailable' && 'Reporting manager is on leave — HR is acting in their place.'}
                  </span>
                </div>
              </div>
            )}
          </div>

        </div>
      </ModalBody>
    </Modal>
  );
}

function ApprovalTimelineList({
  chain, reportingManager, appliedOn,
}: {
  chain: ApprovalNode[];
  reportingManager: PersonRef;
  appliedOn: string;
}) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const comments = chain
    .filter(n => !!n.comment)
    .map(n => ({
      role: n.role === 'Self' ? 'Maker' : n.role === 'Manager' ? 'Reporting Manager' : 'HR',
      name: n.name,
      comment: n.comment!,
    }));

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
          alignItems: 'flex-start',
          gap: 0,
        }}
      >
        {chain.map((n, i) => {
          const isApproved = n.decision === 'approved';
          const isViewed   = n.decision === 'viewed'; // HR reviewed (view-only)
          const isPending  = n.decision === 'pending';
          const isRejected = n.decision === 'rejected';
          const isSkipped  = n.decision === 'skipped';
          const isGreen    = isApproved || isViewed;
          const isLast = i === chain.length - 1;

          const dotBg =
            isGreen ? 'linear-gradient(135deg,#0ab39c,#108548)'
            : isRejected ? 'linear-gradient(135deg,#f06548,#dc2626)'
            : isPending  ? 'linear-gradient(135deg,#f59e0b,#d97706)'
            : isSkipped  ? (dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6')
            : (dark ? 'rgba(255,255,255,0.08)' : '#fff');
          const dotColor = isGreen || isRejected || isPending ? '#fff' : (dark ? 'rgba(255,255,255,0.55)' : '#9ca3af');
          const dotBorder = isSkipped ? `1.5px dashed ${dark ? 'rgba(255,255,255,0.20)' : '#d1d5db'}` : !isGreen && !isRejected && !isPending ? `1.5px solid ${dark ? 'rgba(255,255,255,0.18)' : '#e5e7eb'}` : 'none';
          const dotIcon =
            isViewed   ? 'ri-eye-line'
            : isApproved ? 'ri-check-line'
            : isRejected ? 'ri-close-line'
            : isSkipped  ? 'ri-subtract-line'
            : isPending  ? 'ri-time-line'
            : n.role === 'Self' ? 'ri-user-3-line'
            : n.role === 'Manager' ? 'ri-user-star-line'
            : 'ri-shield-user-line';

          const role = n.role === 'Self' ? 'You' : n.role === 'Manager' ? 'Manager' : 'HR';
          const dateLabel = formatDate(n.actionAt || (n.role === 'Self' ? appliedOn : ''));

          const connectorColor =
            isGreen ? '#10b981' : isRejected ? '#dc2626' : '#e5e7eb';

          return (
            <div key={i} className="text-center position-relative" style={{ minWidth: 0, opacity: isSkipped ? 0.6 : 1 }}>
              {!isLast && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 14,
                    left: 'calc(50% + 16px)',
                    right: 'calc(-50% + 16px)',
                    height: 2,
                    background: connectorColor,
                    zIndex: 0,
                  }}
                />
              )}

              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle position-relative"
                style={{
                  width: 28, height: 28,
                  background: dotBg, color: dotColor, fontSize: 13,
                  border: dotBorder,
                  zIndex: 1,
                }}
              >
                <i className={dotIcon} />
              </span>

              <div className="text-uppercase fw-bold mt-2" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--vz-secondary-color)' }}>
                {role}
              </div>
              {n.role === 'Manager' && reportingManager.designation && (
                <div className="text-muted" style={{ fontSize: 10, marginTop: 1 }}>
                  {reportingManager.designation}
                </div>
              )}
              <div className="fw-semibold fs-13 mt-1 px-1" style={{ lineHeight: 1.2 }}>{n.name}</div>
              {n.detail && (
                <div className="text-muted px-1" style={{ fontSize: 11, marginTop: 2 }}>{n.detail}</div>
              )}
              {(n.actionAt || n.role === 'Self') && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{dateLabel}</div>
              )}
            </div>
          );
        })}
      </div>

      {comments.length > 0 && (
        <div className="mt-3 px-3 py-2 rounded" style={{ background: dark ? 'rgba(124,92,252,0.16)' : '#f3eeff', border: `1px solid ${dark ? 'rgba(124,92,252,0.35)' : '#d8c8ff'}` }}>
          {comments.map((c, i) => (
            <div key={i} className="text-body" style={{ fontSize: 11.5, marginTop: i > 0 ? 6 : 0 }}>
              <span className="fw-bold" style={{ color: dark ? '#c4b5fd' : '#5a3fd1' }}>{c.role}</span>
              <span className="text-muted"> · {c.name}: </span>
              <span className="fst-italic">"{c.comment}"</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmActionModal({
  state, onClose, onConfirm,
}: {
  state: { row: LeaveRequest; action: 'approve' | 'reject' } | null;
  onClose: () => void;
  onConfirm: (comment: string) => void | Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (state) { setComment(''); setSubmitting(false); } }, [state?.row.id, state?.action]);

  if (!state) return null;
  const { row, action } = state;
  const isApprove = action === 'approve';
  const tType = TYPE_TONE[row.type];
  const canConfirm = isApprove || comment.trim().length > 0;

  return (
    <Modal
      isOpen={!!state}
      toggle={onClose}
      centered
      size="md"
      backdrop="static"
      contentClassName="lv-confirm-content"
    >
      <ModalBody className="p-0">
        <div className={`lv-confirm-header ${isApprove ? 'is-approve' : 'is-reject'}`}>
          <span className="lv-confirm-icon">
            <i className={isApprove ? 'ri-check-double-line' : 'ri-close-circle-line'} />
          </span>
          <div className="min-w-0">
            <h6 className="fw-bold mb-0" style={{ fontSize: 14 }}>
              {isApprove ? 'Approve leave request' : 'Reject leave request'}
            </h6>
            <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
              {isApprove
                ? 'The employee will be notified once approved.'
                : 'The employee will be notified with your reason.'}
            </div>
          </div>
          <button type="button" className="lv-confirm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="lv-confirm-body">
          <div className="lv-confirm-summary">
            <span
              className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 36, height: 36, fontSize: 12, background: `linear-gradient(135deg, ${row.accent}, ${row.accent}cc)` }}
            >
              {row.empInitials}
            </span>
            <div className="min-w-0 flex-grow-1">
              <div className="fw-semibold" style={{ fontSize: 13 }}>{row.empName}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>
                {row.id} · {row.empCode} · {row.empRole}
              </div>
            </div>
          </div>

          <div className="lv-confirm-meta">
            <div>
              <div className="lv-confirm-label">Type</div>
              <span className="rec-pill" style={{ background: tType.bg, color: tType.fg }}>{row.typeName}</span>
            </div>
            <div>
              <div className="lv-confirm-label">Duration</div>
              <div className="fw-semibold fs-13">{row.durationLabel}</div>
            </div>
            <div>
              <div className="lv-confirm-label">Dates</div>
              <div className="fw-semibold fs-13">{formatRange(row.fromDate, row.toDate)}</div>
            </div>
          </div>

          <label className="lv-confirm-label mt-3 d-block">
            Comment {isApprove ? <span className="text-muted">(optional)</span> : <span className="text-danger">*</span>}
          </label>
          <textarea
            className="form-control lv-confirm-textarea"
            rows={3}
            placeholder={
              isApprove
                ? 'Optional note (visible to the employee)…'
                : 'Reason for rejection — visible to the employee'
            }
            value={comment}
            onChange={e => setComment(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="lv-confirm-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="button"
            className={isApprove ? 'lv-btn-success' : 'lv-btn-danger'}
            onClick={async () => {
              if (submitting || !canConfirm) return;
              setSubmitting(true);
              try { await onConfirm(comment); } finally { setSubmitting(false); }
            }}
            disabled={!canConfirm || submitting}
          >
            <i
              className={submitting ? 'ri-loader-4-line' : (isApprove ? 'ri-check-line' : 'ri-close-line')}
              style={submitting ? { animation: 'spin 1s linear infinite' } : undefined}
            />
            {submitting ? 'Processing…' : (isApprove ? 'Confirm Approve' : 'Confirm Reject')}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function ActionBtn({
  title, icon, tone, onClick, disabled,
}: {
  title: string;
  icon: string;
  tone: 'info' | 'success' | 'danger' | 'neutral';
  onClick?: () => void;
  disabled?: boolean;
}) {
  const toneClass =
    tone === 'info'    ? 'rec-act-tone-info'
    : tone === 'success' ? 'rec-act-tone-success'
    : tone === 'danger'  ? 'rec-act-tone-danger'
    : 'rec-act-tone-neutral';
  return (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className={`rec-act-icon ${toneClass}`}
      >
        <i className={icon} />
      </button>
    </Tooltip>
  );
}

function ChainDots({ row }: { row: LeaveRequest }) {
  const chain = deriveChain(row);

  const lastAction = row.hrActionAt || row.managerActionAt;
  const caption =
    row.stage === 'Approved' && lastAction ? { text: `Approved: ${formatDate(lastAction)}`, tone: 'text-success' }
    : row.stage === 'Rejected' && lastAction ? { text: `Rejected: ${formatDate(lastAction)}`, tone: 'text-danger' }
    : row.stage === 'Cancelled' ? { text: 'Cancelled', tone: 'text-muted' }
    : row.stageNote ? { text: row.stageNote, tone: 'text-warning' }
    : null;

  return (
    <div>
      <div className="d-inline-flex align-items-center">
        {chain.map((n, i) => {
          const isApproved = n.decision === 'approved' || n.decision === 'viewed'; // HR-viewed reads green
          const isRejected = n.decision === 'rejected';
          const isPending  = n.decision === 'pending';
          const isSkipped  = n.decision === 'skipped';
          const isLast     = i === chain.length - 1;

          const initialsContent = (
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.02em' }}>
              {n.initials || (n.role === 'Self' ? 'YOU' : n.role === 'Manager' ? 'MGR' : 'HR')}
            </span>
          );
          const state =
            isApproved ? {
              bg: 'linear-gradient(135deg,#16a34a,#108548)', fg: '#fff',
              border: 'none',
              shadow: '0 0 0 3px rgba(22,163,74,0.14), 0 2px 4px rgba(22,163,74,0.22)',
              content: initialsContent,
            }
            : isRejected ? {
              bg: 'linear-gradient(135deg,#dc2626,#b91c1c)', fg: '#fff',
              border: 'none',
              shadow: '0 0 0 3px rgba(220,38,38,0.14), 0 2px 4px rgba(220,38,38,0.22)',
              content: initialsContent,
            }
            : isPending ? {
              bg: 'linear-gradient(135deg,#f59e0b,#d97706)', fg: '#fff',
              border: 'none',
              shadow: '0 0 0 3px rgba(245,158,11,0.16), 0 2px 4px rgba(245,158,11,0.24)',
              content: initialsContent,
            }
            : isSkipped ? {
              bg: '#f3f4f6', fg: '#9ca3af',
              border: '1.5px dashed #d1d5db',
              shadow: 'none',
              content: <i className="ri-subtract-line" />,
            }
            : {
              bg: '#fff', fg: '#9ca3af',
              border: '1.5px solid #e5e7eb',
              shadow: 'none',
              content: (
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>
                  {n.role === 'Self' ? 'YOU' : n.role === 'Manager' ? 'MGR' : 'HR'}
                </span>
              ),
            };

          const connectorColor =
            isApproved ? '#16a34a' : isRejected ? '#dc2626' : '#cbd5e1';

          return (
            <span key={i} className="d-inline-flex align-items-center">
              <span
                className="rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0"
                title={`${n.role === 'Self' ? 'Maker' : n.role === 'Manager' ? 'Reporting Manager' : 'HR'}: ${n.name}${n.detail ? ' — ' + n.detail : ''}`}
                style={{
                  width: 30, height: 30,
                  fontSize: 11,
                  background: state.bg,
                  color: state.fg,
                  border: state.border,
                  boxShadow: state.shadow,
                  opacity: isSkipped ? 0.7 : 1,
                }}
              >
                {state.content}
              </span>
              {!isLast && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 22, height: 2,
                    margin: '0 4px',
                    background: connectorColor,
                    borderRadius: 2,
                    position: 'relative',
                  }}
                >
                  <i
                    className="ri-arrow-right-s-line"
                    style={{
                      position: 'absolute',
                      right: -7, top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 14,
                      color: connectorColor,
                      lineHeight: 1,
                    }}
                  />
                </span>
              )}
            </span>
          );
        })}
      </div>
      {caption && (
        <div className={`${caption.tone} mt-1`} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.01em' }}>
          {caption.text}
        </div>
      )}
    </div>
  );
}

