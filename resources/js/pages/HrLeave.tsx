import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardBody, Col, Row, Input, Button } from 'reactstrap';
import { MasterFormStyles, MasterSelect } from './master/masterFormKit';
import './employee-onboarding/HrEmployeeOnboarding.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors the project's existing Attendance-Regularization workflow:
// Employee → Reporting Manager → HR. Manager is the primary approver; HR is
// only involved when (a) manager rejected (HR override), (b) request aged out
// (>7d auto-escalation), (c) HR raised the request on the employee's behalf.
//
// All field names track the same shape used by `ApprovalRequest` in
// HrAttendance.tsx and by the polymorphic `approval_queue` table on the
// backend, so wiring up `GET /api/leaves` later is a 1-to-1 mapping.
// ─────────────────────────────────────────────────────────────────────────────
type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Earned' | 'Maternity' | 'Comp Off' | 'LOP';
type LeaveStage =
  | 'Approved'           // final state — manager approved (or HR overrode)
  | 'Pending (Manager)'  // sitting with the reporting manager
  | 'Pending (HR)'       // escalated to HR (auto-escalation, override, or HR-raised)
  | 'Rejected'           // final state — both levels rejected (or manager rejected and HR concurred)
  | 'Cancelled';         // employee withdrew before action
type ApprovalState = 'Pending' | 'Approved' | 'Rejected' | 'NA';
type PayrollMode = 'Paid Leave' | 'Unpaid' | 'Half-Pay';
type ProofState = 'Uploaded' | 'Missing' | 'N/A';
type EscalationReason = 'manager_rejected' | 'aged_out' | 'manager_unavailable' | 'hr_raised' | 'none';

// Lightweight reference to a person in the org chart. Only the fields needed
// for rendering are kept here; the live backend will hydrate from `employees`.
interface PersonRef {
  initials: string;
  name: string;
  designation: string;   // "Reporting Manager" / "Project Manager" / "Team Lead"
}

interface LeaveRequest {
  id: string;                          // LV-1042 (matches approval_queue.id pattern)
  empCode: string;                     // LV-001 (employee.emp_code)
  empInitials: string;
  empName: string;
  empRole: string;                     // designation + department
  accent: string;
  type: LeaveType;
  durationDays: number;
  durationLabel: string;
  rangeLabel: string;
  appliedOn: string;
  raisedBy: 'employee' | 'hr';         // hr = on-behalf submission, skips manager step

  // Reporting hierarchy from the employee record. The leave request gets
  // routed to `reportingManager` first; HR steps in only on escalation.
  reportingManager: PersonRef;
  hrApprover?: PersonRef;              // populated once an HR user picks up the request

  // Two-stage workflow — same shape as Attendance Regularization
  managerStatus: ApprovalState;
  managerActionAt?: string;
  managerComment?: string;

  hrStatus: ApprovalState;             // 'NA' until escalated
  hrActionAt?: string;
  hrComment?: string;

  escalatedToHr: boolean;              // true once HR can act on this request
  escalationReason: EscalationReason;  // why HR was pulled in (drives the badge)

  // Cached final state — derived from manager/hr status above
  stage: LeaveStage;
  stageNote?: string;                  // "Approved: Apr 13" / "3d pending"

  payroll: PayrollMode;
  proof: ProofState;
  proofVia?: string;
  reason: string;                      // "Family function", etc.
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette helpers
// ─────────────────────────────────────────────────────────────────────────────
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

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

// ─────────────────────────────────────────────────────────────────────────────
// Dummy data — replace with `GET /api/leaves?fy=2025-26` when wired.
// Designed to exercise every branch of the approval workflow:
//   • LV-1042 — Manager approved (final)
//   • LV-1043 — Manager approved (final)
//   • LV-1044 — Pending with manager (3d in queue)
//   • LV-1045 — Manager approved (final)
//   • LV-1046 — HR-raised on behalf (skips manager step, HR-only review)
//   • LV-1047 — Manager rejected → HR override approved
//   • LV-1048 — Manager rejected → HR concurred (final reject)
//   • LV-1049 — Aged out >7d → auto-escalated to HR
// ─────────────────────────────────────────────────────────────────────────────
const buildRequests = (): LeaveRequest[] => [
  {
    id: 'LV-1042', empCode: 'LV-001',
    empInitials: 'GJ', empName: 'Gaurav Jagtap', empRole: 'Software Development', accent: accent(0),
    type: 'Annual', durationDays: 3, durationLabel: '3 days', rangeLabel: 'Apr 14 – Apr 16', appliedOn: 'Apr 12, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'PL', name: 'Pranav Lokhande', designation: 'Project Manager' },
    managerStatus: 'Approved', managerActionAt: 'Apr 13, 2026', managerComment: 'Approved — please share handover notes before EOD.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved', stageNote: 'Approved: Apr 13',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Parth', reason: 'Family function',
  },
  {
    id: 'LV-1043', empCode: 'LV-002',
    empInitials: 'RC', empName: 'Ritika Chauhan', empRole: 'UI/UX Designing', accent: accent(1),
    type: 'Sick', durationDays: 2, durationLabel: '2 days', rangeLabel: 'Apr 09 – Apr 10', appliedOn: 'Apr 07, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'PL', name: 'Pranav Lokhande', designation: 'Team Lead — Design' },
    managerStatus: 'Approved', managerActionAt: 'Apr 08, 2026', managerComment: 'Get well soon.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved', stageNote: 'Approved: Apr 08',
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Parth', reason: 'Fever — medical leave',
  },
  {
    id: 'LV-1044', empCode: 'LV-003',
    empInitials: 'HT', empName: 'Harsh Thakur', empRole: 'Business Analyst', accent: accent(2),
    type: 'Casual', durationDays: 1, durationLabel: '1 day', rangeLabel: 'Apr 11', appliedOn: 'Apr 08, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'AG', name: 'Arun Gupta', designation: 'Reporting Manager' },
    managerStatus: 'Pending',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Pending (Manager)', stageNote: '3d pending',
    payroll: 'Paid Leave', proof: 'N/A', reason: 'Personal work',
  },
  {
    id: 'LV-1045', empCode: 'LV-004',
    empInitials: 'SJ', empName: 'Swati Joshi', empRole: 'Software Testing', accent: accent(3),
    type: 'Sick', durationDays: 1, durationLabel: '1 day', rangeLabel: 'Apr 08', appliedOn: 'Apr 06, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'AP', name: 'Atharv Patil', designation: 'QA Lead' },
    managerStatus: 'Approved', managerActionAt: 'Apr 07, 2026',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved', stageNote: 'Approved: Apr 07',
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Atharv', reason: 'Medical appointment',
  },
  {
    id: 'LV-1046', empCode: 'LV-005',
    empInitials: 'NK', empName: 'Neha Kulkarni', empRole: 'Product Design', accent: accent(4),
    type: 'Earned', durationDays: 5, durationLabel: '5 days', rangeLabel: 'Apr 21 – Apr 25', appliedOn: 'Apr 14, 2026',
    raisedBy: 'hr',
    reportingManager: { initials: 'VR', name: 'Vishal Rao', designation: 'Design Head' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'NA',
    hrStatus: 'Pending',
    escalatedToHr: true, escalationReason: 'hr_raised',
    stage: 'Pending (HR)', stageNote: '1d pending · HR-raised',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Vishal', reason: 'Carry-forward leave — vacation',
  },
  {
    id: 'LV-1047', empCode: 'LV-006',
    empInitials: 'RG', empName: 'Rahul Gupta', empRole: 'Account Executive', accent: accent(5),
    type: 'LOP', durationDays: 2, durationLabel: '2 days', rangeLabel: 'Apr 02 – Apr 03', appliedOn: 'Apr 01, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'PI', name: 'Priya Iyer', designation: 'Sales Lead' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Rejected', managerActionAt: 'Apr 02, 2026', managerComment: 'Quarter close week — cannot release.',
    hrStatus: 'Approved', hrActionAt: 'Apr 02, 2026', hrComment: 'Approved as exception — verified personal emergency.',
    escalatedToHr: true, escalationReason: 'manager_rejected',
    stage: 'Approved', stageNote: 'HR override · Apr 02',
    payroll: 'Unpaid', proof: 'N/A', reason: 'Personal emergency',
  },
  {
    id: 'LV-1048', empCode: 'LV-007',
    empInitials: 'KS', empName: 'Karan Singh', empRole: 'Software Engineer', accent: accent(6),
    type: 'Casual', durationDays: 4, durationLabel: '4 days', rangeLabel: 'Apr 17 – Apr 20', appliedOn: 'Apr 12, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'AG', name: 'Arun Gupta', designation: 'Engineering Manager' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Rejected', managerActionAt: 'Apr 13, 2026', managerComment: 'Sprint close conflicts with these dates.',
    hrStatus: 'Rejected', hrActionAt: 'Apr 14, 2026', hrComment: 'Concur with manager — re-apply for next sprint.',
    escalatedToHr: true, escalationReason: 'manager_rejected',
    stage: 'Rejected', stageNote: 'Rejected: Apr 14',
    payroll: 'Paid Leave', proof: 'N/A', reason: 'Wedding in family',
  },
  {
    id: 'LV-1049', empCode: 'LV-008',
    empInitials: 'DN', empName: 'Deepa Nair', empRole: 'Finance Analyst', accent: accent(7),
    type: 'Earned', durationDays: 3, durationLabel: '3 days', rangeLabel: 'Apr 28 – Apr 30', appliedOn: 'Apr 04, 2026',
    raisedBy: 'employee',
    reportingManager: { initials: 'NM', name: 'Nikhil Mehra', designation: 'Finance Lead' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Pending',
    hrStatus: 'Pending',
    escalatedToHr: true, escalationReason: 'aged_out',
    stage: 'Pending (HR)', stageNote: '8d pending · auto-escalated',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Self', reason: 'Annual vacation — pre-booked tickets',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedNumber — same simple count-up the Onboarding KPIs use
// ─────────────────────────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  return <>{value.toLocaleString()}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render-friendly approval-chain projection. The backend stores the workflow
// as discrete fields (managerStatus / hrStatus / escalatedToHr); the table
// and timeline both want a flat 3-node list so they can paint avatars in a
// row or vertical timeline. `deriveChain` does the projection.
// ─────────────────────────────────────────────────────────────────────────────
interface ApprovalNode {
  initials: string;
  name: string;
  role: 'Self' | 'Manager' | 'HR';
  decision: 'approved' | 'pending' | 'idle' | 'rejected' | 'skipped';
  detail?: string;
  actionAt?: string;
  comment?: string;
}

const deriveChain = (r: LeaveRequest): ApprovalNode[] => {
  // Maker — always the employee, always considered "submitted"
  const self: ApprovalNode = {
    initials: r.empInitials,
    name: r.empName,
    role: 'Self',
    decision: 'approved',
    detail: r.raisedBy === 'hr' ? 'HR raised on behalf' : 'Leave request submitted',
    actionAt: r.appliedOn,
  };

  // Manager — primary approver. Skipped entirely when HR raises on behalf.
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

  // HR — only "active" when escalated. Otherwise sits idle as a notification step.
  const hrDecision: ApprovalNode['decision'] =
    !r.escalatedToHr ? 'idle'
    : r.hrStatus === 'Approved' ? 'approved'
    : r.hrStatus === 'Rejected' ? 'rejected'
    : r.hrStatus === 'Pending'  ? 'pending'
    : 'idle';
  const hrDetail =
    !r.escalatedToHr ? 'CC — informational only'
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
    actionAt: r.hrActionAt,
    comment: r.hrComment,
  };

  return [self, manager, hr];
};

// ─────────────────────────────────────────────────────────────────────────────
// Tiny atoms for the approval chain
// ─────────────────────────────────────────────────────────────────────────────
const ChainAvatar = ({ node }: { node: ApprovalNode }) => {
  const isPending  = node.decision === 'pending';
  const isApproved = node.decision === 'approved';
  const isRejected = node.decision === 'rejected';
  const isSkipped  = node.decision === 'skipped';
  const isIdle     = node.decision === 'idle';

  const bg =
    isApproved ? 'linear-gradient(135deg,#0ab39c,#108548)'
    : isRejected ? 'linear-gradient(135deg,#f06548,#dc2626)'
    : isPending ? 'linear-gradient(135deg,#f7b84b,#f59e0b)'
    : isSkipped ? '#f3f4f6'
    : '#e5e7eb';
  const fg = isIdle || isSkipped ? '#9ca3af' : '#ffffff';
  const ring =
    isApproved ? '0 0 0 3px rgba(10,179,156,0.18)'
    : isRejected ? '0 0 0 3px rgba(220,38,38,0.18)'
    : isPending ? '0 0 0 3px rgba(245,158,11,0.18)'
    : 'none';

  return (
    <span
      className="lv-chain-avatar"
      title={`${node.role}: ${node.name}${node.detail ? ' — ' + node.detail : ''}`}
      style={{ background: bg, color: fg, boxShadow: ring, opacity: isSkipped ? 0.5 : 1 }}
    >
      {isSkipped ? <i className="ri-subtract-line" /> :
       isApproved && !node.initials ? <i className="ri-check-line" /> :
       isRejected && !node.initials ? <i className="ri-close-line" /> :
       (node.initials || <i className="ri-time-line" />)}
    </span>
  );
};

const ApprovalChain = ({ chain }: { chain: ApprovalNode[] }) => (
  <div className="lv-chain">
    {chain.map((n, i) => (
      <span key={i} className="lv-chain-item">
        <ChainAvatar node={n} />
        {i < chain.length - 1 && <i className="ri-arrow-right-line lv-chain-arrow" />}
      </span>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// HrLeave — page component (Onboarding-Hub style)
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 8;

export default function HrLeave() {
  const [requests] = useState<LeaveRequest[]>(buildRequests);

  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState<string>('All');
  const [type,    setType]    = useState<string>('All');
  const [stage,   setStage]   = useState<string>('All');
  const [payroll, setPayroll] = useState<string>('All');
  const [page,    setPage]    = useState(1);

  // Detail drawer — opens when HR clicks "View Details" on any leave row.
  // Holds the row whose details are being inspected; null when closed.
  const [detail, setDetail] = useState<LeaveRequest | null>(null);

  const counts = useMemo(() => {
    const approved = requests.filter(r => r.stage === 'Approved');
    const pending  = requests.filter(r => r.stage.startsWith('Pending'));
    const rejected = requests.filter(r => r.stage === 'Rejected');
    return {
      total:        requests.length,
      pending:      pending.length,
      approved:     approved.length,
      approvedDays: approved.reduce((s, r) => s + r.durationDays, 0),
      rejected:     rejected.length,
      onLeaveToday: 1,
    };
  }, [requests]);

  // Search + filter pipeline. STATUS is the coarse bucket (All / Pending /
  // Approved / Rejected) while STAGE drills further into the workflow step
  // (Submitted / Manager Review / HR Review / Approved / Rejected).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(r => {
      // STATUS filter — coarse: maps the granular `r.stage` onto a bucket
      if (status === 'Pending'  && !r.stage.startsWith('Pending')) return false;
      if (status === 'Approved' && r.stage !== 'Approved') return false;
      if (status === 'Rejected' && r.stage !== 'Rejected') return false;

      // STAGE filter — granular workflow step
      if (stage !== 'All') {
        const matchesStage =
          stage === 'Submitted'      ? false  // dummy data has no submitted-only rows yet
          : stage === 'Manager Review' ? r.stage === 'Pending (Manager)'
          : stage === 'HR Review'    ? r.stage === 'Pending (HR)'
          : stage === 'Approved'     ? r.stage === 'Approved'
          : stage === 'Rejected'     ? r.stage === 'Rejected'
          : true;
        if (!matchesStage) return false;
      }

      if (type    !== 'All' && r.type    !== type)    return false;
      if (payroll !== 'All' && r.payroll !== payroll) return false;
      if (!q) return true;
      return [r.empName, r.empRole, r.id, r.empCode, r.type].some(v => v.toLowerCase().includes(q));
    });
  }, [requests, search, status, type, stage, payroll]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const sliceFrom = (safePage - 1) * PAGE_SIZE;
  const visible   = filtered.slice(sliceFrom, sliceFrom + PAGE_SIZE);
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  const STATUS_OPTIONS = [
    { value: 'All',      label: 'All Requests' },
    { value: 'Pending',  label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
  ];
  const STAGE_OPTIONS = [
    { value: 'All',             label: 'All Stages' },
    { value: 'Submitted',       label: 'Submitted' },
    { value: 'Manager Review',  label: 'Manager Review' },
    { value: 'HR Review',       label: 'HR Review' },
    { value: 'Approved',        label: 'Approved' },
    { value: 'Rejected',        label: 'Rejected' },
  ];
  const TYPE_OPTIONS = [
    { value: 'All',       label: 'All' },
    { value: 'Annual',    label: 'Annual' },
    { value: 'Sick',      label: 'Sick' },
    { value: 'Casual',    label: 'Casual' },
    { value: 'Earned',    label: 'Earned' },
    { value: 'Maternity', label: 'Maternity' },
    { value: 'Comp Off',  label: 'Comp Off' },
    { value: 'LOP',       label: 'LOP' },
  ];
  const PAYROLL_OPTIONS = [
    { value: 'All',        label: 'All' },
    { value: 'Paid Leave', label: 'Paid Leave' },
    { value: 'Unpaid',     label: 'Unpaid' },
    { value: 'Half-Pay',   label: 'Half-Pay' },
  ];

  // KPI cards definition — mirrors Onboarding Hub (strip + tinted icon)
  const KPI_CARDS = [
    { key: 'pending',      label: 'Pending Approval',   icon: 'ri-time-line',           strip: 'linear-gradient(90deg,#7c5cfc,#a78bfa)', tint: '#ece6ff', fg: '#5a3fd1' },
    { key: 'approved',     label: 'Approved (Month)',   icon: 'ri-checkbox-circle-line',strip: 'linear-gradient(90deg,#0ab39c,#34d399)', tint: '#d3f0ee', fg: '#0a716a' },
    { key: 'onLeaveToday', label: 'On Leave Today',     icon: 'ri-user-3-line',         strip: 'linear-gradient(90deg,#3b82f6,#60a5fa)', tint: '#dceefe', fg: '#0c63b0' },
    { key: 'rejected',     label: 'Rejected',           icon: 'ri-close-circle-line',   strip: 'linear-gradient(90deg,#f06548,#fda192)', tint: '#fde2dc', fg: '#b91c1c' },
    { key: 'total',        label: 'Total Requests',     icon: 'ri-stack-line',          strip: 'linear-gradient(90deg,#f59e0b,#fbcc77)', tint: '#fde8c4', fg: '#a4661c' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <MasterFormStyles />
      <LeaveStyles />

      {/* ── Hero card (purple-tinted, separate container — matches Onboarding Hub) ── */}
      <div className="onb-hero-card mb-3">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
            style={{
              width: 46, height: 46,
              background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
              boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
            }}
          >
            <i className="ri-calendar-2-line" style={{ color: '#fff', fontSize: 21 }} />
          </span>
          <div className="min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Leave Management</h5>
              <span className="onb-hero-pill"><span className="dot" />FY 2025–26</span>
            </div>
            <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
              Leave requests, balances, and approval pipeline across all employees
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Button className="lv-secondary-btn rounded-pill">
            <i className="ri-calendar-event-line me-2" style={{ fontSize: 15 }} />Holidays
          </Button>
          <Button className="onb-checklist-cta rounded-pill">
            <i className="ri-check-double-line me-2" style={{ fontSize: 16 }} />
            Approve All
          </Button>
        </div>
      </div>

      {/* ── KPI cards row ── */}
      <Row className="g-3 mb-3 align-items-stretch">
        {KPI_CARDS.map(k => (
          <Col key={k.key} xl={true} md={4} sm={6} xs={12}>
            <div
              className="onb-surface onb-kpi-card"
              style={{
                borderRadius: 14,
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                padding: '16px 18px',
                position: 'relative',
                overflow: 'hidden',
                height: '100%',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.strip }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                <div className="min-w-0">
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                    {k.label}
                  </p>
                  <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                    <AnimatedNumber value={(counts as any)[k.key] ?? 0} />
                  </h3>
                </div>
                <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Tabs (pill-style — quick toggle that drives the Status filter) ── */}
      <div className="d-flex mb-3" style={{ gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'All',      label: 'All Leaves',        count: counts.total,    icon: 'ri-stack-line' },
          { key: 'Pending',  label: 'Pending Leaves',    count: counts.pending,  icon: 'ri-time-line' },
          { key: 'Approved', label: 'Approved Leaves',   count: counts.approved, icon: 'ri-checkbox-circle-line' },
        ].map(t => {
          const on = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setStatus(t.key); setPage(1); }}
              className="btn d-inline-flex align-items-center gap-2 fw-semibold"
              style={{
                borderRadius: 999,
                padding: '8px 16px',
                fontSize: 13,
                background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'var(--vz-card-bg)',
                color: on ? '#fff' : 'var(--vz-secondary-color)',
                border: on ? 'none' : '1px solid var(--vz-border-color)',
                boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
              }}
            >
              <i className={t.icon} style={{ fontSize: 14 }} />
              {t.label}
              <span
                className="badge rounded-pill"
                style={{
                  fontSize: 11,
                  background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                  color: on ? '#fff' : 'var(--vz-secondary-color)',
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters + Table — own card, like Employee Onboarding list ── */}
      <Card>
        <CardBody>
          <Row className="g-2 align-items-center mb-3">
            <Col xl={4} md={12} sm={12}>
              <div className="search-box">
                <Input
                  type="text"
                  className="form-control"
                  placeholder="Search name, ID, type…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
                <i className="ri-search-line search-icon"></i>
              </div>
            </Col>
            <Col xl={8} md={12} sm={12} className="d-flex justify-content-xl-end gap-3 flex-wrap align-items-center">
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Status</span>
                <div style={{ minWidth: 150 }}>
                  <MasterSelect
                    value={status}
                    onChange={v => { setStatus(v); setPage(1); }}
                    options={STATUS_OPTIONS}
                    placeholder="All Requests"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Type</span>
                <div style={{ minWidth: 140 }}>
                  <MasterSelect
                    value={type}
                    onChange={v => { setType(v); setPage(1); }}
                    options={TYPE_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Stage</span>
                <div style={{ minWidth: 160 }}>
                  <MasterSelect
                    value={stage}
                    onChange={v => { setStage(v); setPage(1); }}
                    options={STAGE_OPTIONS}
                    placeholder="All Stages"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Payroll</span>
                <div style={{ minWidth: 140 }}>
                  <MasterSelect
                    value={payroll}
                    onChange={v => { setPayroll(v); setPage(1); }}
                    options={PAYROLL_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {filtered.length} results
              </div>
            </Col>
          </Row>

          <div className="table-responsive table-card rounded p-2">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col" className="ps-3" style={{ width: 60 }}>Sr. No.</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Type</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Date Range</th>
                  <th scope="col">Approval Chain</th>
                  <th scope="col">Payroll</th>
                  <th scope="col">Proof</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pe-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-5 text-muted">
                      <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                      No leave requests match your filters
                    </td>
                  </tr>
                ) : visible.map((r, idx) => {
                  const tone = STAGE_TONE[r.stage];
                  const tType = TYPE_TONE[r.type];
                  return (
                    <tr key={r.id}>
                      <td className="ps-3 fs-13 text-muted">{sliceFrom + idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div
                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{
                              width: 34, height: 34, fontSize: 12,
                              background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                              boxShadow: `0 2px 6px ${r.accent}40`,
                            }}
                          >
                            {r.empInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="fw-semibold fs-13">{r.empName}</div>
                            <div className="text-muted" style={{ fontSize: 11.5 }}>{r.empRole}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="lv-type-pill" style={{ background: tType.bg, color: tType.fg }}>
                          {r.type}
                        </span>
                      </td>
                      <td className="fs-13">{r.durationLabel}</td>
                      <td>
                        <div className="lv-range-cell">
                          <div className="lv-range-text">{r.rangeLabel}</div>
                          <div className="lv-range-applied">Applied: {r.appliedOn}</div>
                        </div>
                      </td>
                      <td>
                        <ApprovalChain chain={deriveChain(r)} />
                      </td>
                      <td>
                        <span className="onb-role-pill">{r.payroll}</span>
                      </td>
                      <td>
                        {r.proof === 'Uploaded' ? (
                          <div className="lv-proof-cell">
                            <span className="lv-proof-ok">
                              <i className="ri-check-line" />Uploaded
                            </span>
                            {r.proofVia && <div className="lv-proof-via">via {r.proofVia}</div>}
                          </div>
                        ) : r.proof === 'Missing' ? (
                          <div className="lv-proof-cell">
                            <span className="lv-proof-bad">
                              <i className="ri-close-line" />Missing
                            </span>
                            {r.proofVia && <div className="lv-proof-via">via {r.proofVia}</div>}
                          </div>
                        ) : (
                          <span className="fs-13 text-muted">N/A</span>
                        )}
                      </td>
                      <td>
                        <span className="onb-pill" style={{ background: tone.bg, color: tone.fg }}>
                          <span className="d" style={{ background: tone.dot }} />
                          {r.stage}
                        </span>
                        {r.stage.startsWith('Pending') && r.stageNote && (
                          <div className="lv-sla-chip" title="SLA">{r.stageNote}</div>
                        )}
                      </td>
                      <td className="pe-3">
                        <div className="lv-actions">
                          <button
                            type="button"
                            className="lv-icon-btn lv-icon-btn--view"
                            title="View details"
                            aria-label="View details"
                            onClick={() => setDetail(r)}
                          >
                            <i className="ri-eye-line" />
                          </button>
                          {r.stage.startsWith('Pending') && (
                            <>
                              <button
                                type="button"
                                className="lv-icon-btn lv-icon-btn--approve"
                                title="Approve"
                                aria-label="Approve"
                              >
                                <i className="ri-check-line" />
                              </button>
                              <button
                                type="button"
                                className="lv-icon-btn lv-icon-btn--reject"
                                title="Reject"
                                aria-label="Reject"
                              >
                                <i className="ri-close-line" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination — same layout as master TableContainer / onboarding */}
          <Row className="align-items-center mt-2 g-3 text-center text-sm-start">
            <div className="col-sm">
              <div className="text-muted">
                Showing
                <span className="fw-semibold ms-1">{visible.length}</span>
                {' '}of <span className="fw-semibold">{filtered.length}</span> Results
              </div>
            </div>
            <div className="col-sm-auto">
              <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
                <li className={safePage <= 1 ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage - 1); }}>Previous</a>
                </li>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                  <li key={p} className={p === safePage ? 'page-item active' : 'page-item'}>
                    <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(p); }}>{p}</a>
                  </li>
                ))}
                <li className={safePage >= pageCount ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage + 1); }}>Next</a>
                </li>
              </ul>
            </div>
          </Row>
        </CardBody>
      </Card>

      {/* ── Leave Details drawer — opens from the row's "View Details" button.
            Read-only summary of the leave + approval timeline + balance impact
            + audit trail. Wire to GET /api/leaves/:id when backend lands. */}
      <LeaveDetailsDrawer row={detail} onClose={() => setDetail(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveStyles — page-scoped CSS for the few `lv-*` extras we add on top of
// the Onboarding-Hub classes (chain avatars, type pill, proof cell, SLA chip).
// ─────────────────────────────────────────────────────────────────────────────
function LeaveStyles(): ReactNode {
  return (
    <style>{`
      .lv-secondary-btn {
        background: rgba(255,255,255,0.85) !important;
        color: #5a3fd1 !important;
        border: 1px solid rgba(124,92,252,0.30) !important;
        font-size: 13px;
        font-weight: 700;
        padding: 9px 16px;
        display: inline-flex;
        align-items: center;
        transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
      }
      .lv-secondary-btn:hover {
        background: #ffffff !important;
        transform: translateY(-1px);
        box-shadow: 0 6px 14px rgba(124,92,252,0.18);
      }
      [data-bs-theme="dark"] .lv-secondary-btn {
        background: rgba(255,255,255,0.06) !important;
        color: #c4b5fd !important;
        border-color: rgba(124,92,252,0.40) !important;
      }

      /* Type pill — solid-coloured chip in the table (matches Employee
         table role-pill weight: 600 / semibold). */
      .lv-type-pill {
        display: inline-flex; align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px; font-weight: 600;
        letter-spacing: 0.01em;
      }

      /* Date range cell — primary line + applied-on subtitle.
         Weight matches the Employee-table convention: semibold on the
         emphasized value, muted text-secondary on the helper line. */
      .lv-range-cell { line-height: 1.3; }
      .lv-range-text { font-size: 13px; font-weight: 600; color: var(--vz-body-color); }
      .lv-range-applied { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 2px; }

      /* SLA chip under the status pill */
      .lv-sla-chip {
        display: inline-flex; align-items: center;
        margin-top: 4px;
        padding: 2px 8px;
        border-radius: 6px;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fde68a;
        font-size: 10px; font-weight: 600;
      }
      [data-bs-theme="dark"] .lv-sla-chip {
        background: rgba(245,158,11,0.16);
        color: #fbbf24;
        border-color: rgba(245,158,11,0.40);
      }

      /* Approval chain — small avatars connected with arrows */
      .lv-chain { display: inline-flex; align-items: center; gap: 3px; }
      .lv-chain-item { display: inline-flex; align-items: center; gap: 3px; }
      .lv-chain-arrow { color: #cbd5e1; font-size: 13px; }
      .lv-chain-avatar {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 50%;
        font-size: 10px; font-weight: 800;
        flex-shrink: 0;
        transition: transform .15s ease;
      }
      .lv-chain-avatar:hover { transform: scale(1.10); }
      .lv-chain-avatar i { font-size: 12px; }

      /* Proof cell */
      .lv-proof-cell { line-height: 1.3; }
      .lv-proof-ok {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px;
        border-radius: 999px;
        background: #d3f0ee; color: #0a716a;
        font-size: 11px; font-weight: 600;
        border: 1px solid #b6e4dd;
      }
      .lv-proof-bad {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px;
        border-radius: 999px;
        background: #fde2dc; color: #b91c1c;
        font-size: 11px; font-weight: 600;
        border: 1px solid #fecaca;
      }
      .lv-proof-via {
        font-size: 11.5px;
        color: var(--vz-secondary-color);
        margin-top: 3px;
      }

      /* ── Row action buttons ────────────────────────────────────────────
           Compact icon-only buttons. Same 32px square footprint regardless
           of whether the row needs 1 button (View only) or 3 (View / Approve
           / Reject) — keeps the Action column tight and visually consistent.
           Tooltips surface what each icon does on hover. */
      .lv-actions {
        display: inline-flex; align-items: center;
        gap: 6px; flex-wrap: nowrap;
      }
      .lv-icon-btn {
        position: relative;
        width: 32px; height: 32px;
        border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center;
        background: #ffffff;
        border: 1px solid var(--vz-border-color);
        color: var(--vz-secondary-color);
        cursor: pointer;
        padding: 0;
        transition: transform .15s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease, color .15s ease;
      }
      .lv-icon-btn i { font-size: 15px; line-height: 1; }
      .lv-icon-btn:hover { transform: translateY(-1px); }
      .lv-icon-btn:active { transform: translateY(0); }
      .lv-icon-btn:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 2px;
      }
      [data-bs-theme="dark"] .lv-icon-btn {
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.78);
      }

      /* View — neutral default; on hover gains the project's purple accent. */
      .lv-icon-btn--view:hover {
        background: #f5f3ff;
        color: #5a3fd1;
        border-color: #c4b5fd;
        box-shadow: 0 4px 10px rgba(124,92,252,0.18);
      }
      [data-bs-theme="dark"] .lv-icon-btn--view:hover {
        background: rgba(124,92,252,0.16);
        color: #c4b5fd;
        border-color: rgba(124,92,252,0.40);
      }

      /* Approve — soft tinted green by default, deepens on hover. The slight
         green tint on idle state makes the action immediately readable. */
      .lv-icon-btn--approve {
        background: #ecfdf5;
        color: #059669;
        border-color: #a7f3d0;
      }
      .lv-icon-btn--approve:hover {
        background: linear-gradient(135deg,#10b981 0%,#059669 100%);
        color: #ffffff;
        border-color: transparent;
        box-shadow: 0 4px 12px rgba(16,185,129,0.36);
      }
      [data-bs-theme="dark"] .lv-icon-btn--approve {
        background: rgba(16,185,129,0.14);
        color: #6ee7b7;
        border-color: rgba(16,185,129,0.40);
      }

      /* Reject — soft tinted red by default, fills on hover. */
      .lv-icon-btn--reject {
        background: #fef2f2;
        color: #dc2626;
        border-color: #fecaca;
      }
      .lv-icon-btn--reject:hover {
        background: linear-gradient(135deg,#ef4444 0%,#b91c1c 100%);
        color: #ffffff;
        border-color: transparent;
        box-shadow: 0 4px 12px rgba(220,38,38,0.32);
      }
      [data-bs-theme="dark"] .lv-icon-btn--reject {
        background: rgba(220,38,38,0.14);
        color: #fca5a5;
        border-color: rgba(220,38,38,0.40);
      }
    `}</style>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveDetailsDrawer — modal dialog opened from a row's "View Details" button.
// Renders directly to document.body via createPortal so it always escapes the
// table's stacking context. Read-only for now; the Cancel Leave button is a
// stub until the backend exposes a cancellation endpoint.
// ─────────────────────────────────────────────────────────────────────────────
function LeaveDetailsDrawer({ row, onClose }: { row: LeaveRequest | null; onClose: () => void }) {
  if (!row) return null;

  const tType = TYPE_TONE[row.type];

  // Approval-chain projection (Self → Manager → HR) computed once for the
  // drawer; consumed by the timeline and the audit-trail derivation below.
  const chain = deriveChain(row);
  const managerName = row.reportingManager.name;

  // Audit trail rows derived from the approval chain — replace when the
  // backend exposes a real audit log.
  const auditRows = chain
    .filter(n => n.decision === 'approved' || n.decision === 'rejected')
    .map(n => {
      const verb =
        n.role === 'Self'      ? `submitted ${row.type} request (${row.id})`
        : n.decision === 'approved' && n.role === 'HR' && row.escalationReason === 'manager_rejected' ? 'override-approved (manager had rejected)'
        : n.decision === 'approved' ? 'approved'
        : 'rejected';
      const date = n.actionAt || (n.role === 'Self' ? row.appliedOn : '—');
      return { date, name: n.name, action: verb };
    });

  // Balance impact rows — kept hardcoded as visual placeholders. Replace with
  // GET /api/employees/:id/leave-balances once the backend lands.
  const balanceRows = [
    { label: 'Annual',   used: 14, total: 18, color: '#7c5cfc', icon: 'ri-flight-takeoff-line' },
    { label: 'Sick',     used: 6,  total: 12, color: '#dc2626', icon: 'ri-emotion-sad-line' },
    { label: 'Casual',   used: 5,  total: 8,  color: '#c2410c', icon: 'ri-focus-3-line' },
    { label: 'WFH',      used: 16, total: 24, color: '#0ea5e9', icon: 'ri-home-office-line' },
    { label: 'Comp-off', used: 5,  total: 5,  color: '#10b981', icon: 'ri-time-line' },
  ];
  const totalUsed = balanceRows.reduce((s, b) => s + b.used, 0);
  const totalQuota = balanceRows.reduce((s, b) => s + b.total, 0);
  const overallPct = totalQuota === 0 ? 0 : Math.round((totalUsed / totalQuota) * 100);

  return createPortal(
    <div
      className="lvd-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <style>{`
        .lvd-card {
          background: #fff;
          width: 100%;
          max-width: 820px;
          max-height: calc(100vh - 32px);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 24px 60px rgba(15,23,42,0.30);
          display: flex; flex-direction: column;
        }
        [data-bs-theme="dark"] .lvd-card { background: #1c2531; }

        /* Header — purple-tinted identity bar */
        .lvd-header {
          background: linear-gradient(135deg, #f3edff 0%, #ede4ff 100%);
          border-bottom: 1px solid #e3d6ff;
          padding: 8px 14px;
          display: flex; align-items: center; gap: 10px;
        }
        [data-bs-theme="dark"] .lvd-header {
          background: linear-gradient(135deg, rgba(124,92,252,0.18) 0%, rgba(167,139,250,0.10) 100%);
          border-color: rgba(124,92,252,0.32);
        }
        .lvd-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          color: #fff; font-size: 11.5px; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(0,0,0,0.14);
        }
        .lvd-head-meta { flex: 1; min-width: 0; }
        .lvd-head-name { font-size: 14px; font-weight: 800; color: var(--vz-body-color); margin: 0; line-height: 1.2; }
        [data-bs-theme="dark"] .lvd-head-name { color: #fff; }
        .lvd-head-sub { font-size: 11px; color: #5a3fd1; font-weight: 600; margin-top: 1px; }
        [data-bs-theme="dark"] .lvd-head-sub { color: #c4b5fd; }
        .lvd-head-pills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
        .lvd-head-x {
          width: 26px; height: 26px;
          border-radius: 7px;
          background: #fff;
          border: 1px solid var(--vz-border-color);
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--vz-secondary-color);
          cursor: pointer; flex-shrink: 0;
          transition: background .15s ease, color .15s ease;
        }
        .lvd-head-x:hover { background: var(--vz-light); color: var(--vz-body-color); }
        [data-bs-theme="dark"] .lvd-head-x { background: rgba(255,255,255,0.06); }

        /* Body — scrollable */
        .lvd-body {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 8px 12px 2px;
        }
        .lvd-section-title {
          font-size: 9.5px; font-weight: 800;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--vz-secondary-color);
          margin: 8px 0 4px;
        }
        .lvd-section-title:first-child { margin-top: 0; }

        /* Details card — 3-column grid keeps the section ~half its old height */
        .lvd-details-card {
          background: #fff;
          border: 1px solid var(--vz-border-color);
          border-radius: 8px;
          padding: 8px 10px;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 6px 10px;
        }
        [data-bs-theme="dark"] .lvd-details-card { background: var(--vz-card-bg); }
        .lvd-field-label { font-size: 9px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); margin-bottom: 1px; }
        .lvd-field-value { font-size: 12px; font-weight: 500; color: var(--vz-body-color); line-height: 1.25; }
        [data-bs-theme="dark"] .lvd-field-value { color: #fff; }

        /* Approval timeline — horizontal stepper.
             Each step is a centered column: dot on top, role + name below.
             The connector to the next step is painted as a ::after pseudo
             on the step itself, sitting at the dot's vertical center, which
             keeps the dot horizontally aligned with its label underneath. */
        .lvd-stepper {
          display: flex; align-items: flex-start;
          padding: 6px 0 2px;
        }
        .lvd-step {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; align-items: center;
          gap: 6px;
          position: relative;
        }
        .lvd-step-dot {
          width: 32px; height: 32px;
          border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: #f3f4f6;
          color: #9ca3af;
          font-size: 14px;
          flex-shrink: 0;
          border: 2px solid #fff;
          box-shadow: 0 0 0 1.5px #e5e7eb;
          transition: background .25s ease, color .25s ease, box-shadow .25s ease;
          position: relative;
          z-index: 1;
        }
        /* Connector to NEXT step. Anchored at the dot's vertical centre
           (top: 16px = half the 32-px dot) and extends right across the
           gap until the next dot's centre. */
        .lvd-step:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 21px; /* 6px stepper top padding + 16px (dot half) - 1px (line half) */
          left: calc(50% + 18px);
          right: calc(-50% + 18px);
          height: 2px;
          background: #e5e7eb;
          border-radius: 999px;
          z-index: 0;
        }
        .lvd-step.has-connector-filled:not(:last-child)::after {
          background: linear-gradient(90deg,#7c5cfc,#5a3fd1);
        }
        .lvd-step-meta {
          text-align: center;
          line-height: 1.2;
          width: 100%;
          padding: 0 4px;
        }
        .lvd-step-role {
          font-size: 10.5px; font-weight: 800;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--vz-secondary-color);
        }
        .lvd-step-name {
          font-size: 11.5px; font-weight: 600;
          color: var(--vz-body-color);
          margin-top: 1px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        [data-bs-theme="dark"] .lvd-step-name { color: #fff; }

        /* Step states */
        .lvd-step.is-done .lvd-step-dot {
          background: linear-gradient(135deg,#7c5cfc,#5a3fd1);
          color: #fff;
          box-shadow: 0 0 0 1.5px rgba(124,92,252,0.30);
        }
        .lvd-step.is-done .lvd-step-role { color: #5a3fd1; }
        [data-bs-theme="dark"] .lvd-step.is-done .lvd-step-role { color: #c4b5fd; }
        .lvd-step.is-active .lvd-step-dot {
          background: linear-gradient(135deg,#f59e0b,#d97706);
          color: #fff;
          box-shadow: 0 0 0 1.5px rgba(245,158,11,0.30), 0 0 0 6px rgba(245,158,11,0.12);
        }
        .lvd-step.is-active .lvd-step-role { color: #b45309; }
        .lvd-step.is-rejected .lvd-step-dot {
          background: linear-gradient(135deg,#f06548,#dc2626);
          color: #fff;
          box-shadow: 0 0 0 1.5px rgba(220,38,38,0.30);
        }
        .lvd-step.is-rejected .lvd-step-role { color: #b91c1c; }
        .lvd-step.is-skipped .lvd-step-dot {
          background: #f3f4f6; color: #9ca3af;
          box-shadow: 0 0 0 1.5px #e5e7eb;
        }
        .lvd-step.is-skipped { opacity: 0.55; }

        /* Active-step detail panel below the stepper */
        .lvd-step-detail {
          margin-top: 6px;
          background: #f3eeff;
          border: 1px solid #d8c8ff;
          border-radius: 6px;
          padding: 6px 10px;
        }
        [data-bs-theme="dark"] .lvd-step-detail { background: rgba(124,92,252,0.10); border-color: rgba(124,92,252,0.30); }
        .lvd-step-detail-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px;
          font-size: 9.5px; font-weight: 800;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--vz-secondary-color);
        }
        .lvd-step-detail-when { font-weight: 700; }
        .lvd-step-detail-body {
          display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
          margin-top: 2px;
        }
        .lvd-step-detail-body strong {
          font-size: 12.5px; font-weight: 700; color: var(--vz-body-color);
        }
        [data-bs-theme="dark"] .lvd-step-detail-body strong { color: #fff; }
        .lvd-step-detail-action { font-size: 11px; color: var(--vz-secondary-color); }
        .lvd-step-detail-comment {
          margin-top: 4px;
          padding: 4px 8px;
          background: rgba(255,255,255,0.70);
          border-left: 2px solid #c4b5fd;
          border-radius: 4px;
          font-size: 10.5px;
          color: var(--vz-body-color);
          font-style: italic;
        }
        [data-bs-theme="dark"] .lvd-step-detail-comment { background: rgba(0,0,0,0.20); color: rgba(255,255,255,0.86); }

        /* Footer — clock icon + ETA + audit-trail pill */
        .lvd-step-foot {
          display: flex; align-items: center; gap: 6px;
          margin-top: 4px;
          font-size: 10.5px;
          color: var(--vz-secondary-color);
        }
        .lvd-step-foot-eta { display: inline-flex; align-items: center; gap: 4px; }
        .lvd-step-foot-eta i { font-size: 13px; }
        .lvd-step-foot-sep { font-weight: 800; opacity: 0.5; }
        .lvd-step-foot-pill {
          display: inline-flex; align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          background: #ede9fe;
          color: #5a3fd1;
          font-size: 9.5px; font-weight: 800;
          letter-spacing: 0.06em;
        }
        [data-bs-theme="dark"] .lvd-step-foot-pill { background: rgba(124,92,252,0.20); color: #c4b5fd; }

        /* Escalation banner — only rendered when a request has been pulled
           into HR's queue. Reason colour-codes the strip. */
        .lvd-escalation {
          margin-top: 6px;
          padding: 6px 10px;
          border-radius: 6px;
          display: flex; align-items: flex-start; gap: 8px;
          font-size: 10.5px; line-height: 1.3;
        }
        .lvd-escalation i { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .lvd-escalation strong { font-weight: 800; font-size: 11px; display: block; }
        .lvd-escalation-sub { font-size: 10px; opacity: 0.85; margin-top: 1px; }
        .lvd-escalation--manager_rejected {
          background: #fee2e2; border: 1px solid #fecaca; color: #991b1b;
        }
        .lvd-escalation--manager_rejected i { color: #b91c1c; }
        .lvd-escalation--aged_out {
          background: #fef3c7; border: 1px solid #fde68a; color: #78350f;
        }
        .lvd-escalation--aged_out i { color: #b45309; }
        .lvd-escalation--hr_raised {
          background: #ede9fe; border: 1px solid #d8c8ff; color: #4c1d95;
        }
        .lvd-escalation--hr_raised i { color: #5a3fd1; }
        .lvd-escalation--manager_unavailable {
          background: #dbeafe; border: 1px solid #bfdbfe; color: #1e40af;
        }
        .lvd-escalation--manager_unavailable i { color: #1d4ed8; }
        .lvd-escalation--none { display: none; }

        /* Policy flags */
        .lvd-empty {
          font-size: 12px;
          color: var(--vz-secondary-color);
          font-style: italic;
        }

        /* Balance impact — analytics format */
        .lvd-bal-summary {
          position: relative;
          background: linear-gradient(135deg,#f3eeff 0%,#ede4ff 100%);
          border: 1px solid #d8c8ff;
          border-radius: 8px;
          padding: 6px 12px 8px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 4px 10px;
          margin-bottom: 6px;
          overflow: hidden;
        }
        [data-bs-theme="dark"] .lvd-bal-summary {
          background: linear-gradient(135deg, rgba(124,92,252,0.16) 0%, rgba(124,92,252,0.08) 100%);
          border-color: rgba(124,92,252,0.32);
        }
        .lvd-bal-summary-meta { min-width: 0; }
        .lvd-bal-summary-label {
          font-size: 9px; font-weight: 800;
          letter-spacing: 0.10em; text-transform: uppercase;
          color: #5a3fd1;
        }
        [data-bs-theme="dark"] .lvd-bal-summary-label { color: #c4b5fd; }
        .lvd-bal-summary-num { display: flex; align-items: baseline; gap: 5px; margin-top: 2px; }
        .lvd-bal-summary-used { font-size: 17px; font-weight: 800; color: #1f2937; line-height: 1; letter-spacing: -0.01em; }
        [data-bs-theme="dark"] .lvd-bal-summary-used { color: #fff; }
        .lvd-bal-summary-total { font-size: 11px; font-weight: 600; color: var(--vz-secondary-color); }
        .lvd-bal-summary-right { text-align: right; }
        .lvd-bal-summary-pct { font-size: 17px; font-weight: 800; color: #5a3fd1; line-height: 1; letter-spacing: -0.01em; }
        [data-bs-theme="dark"] .lvd-bal-summary-pct { color: #c4b5fd; }
        .lvd-bal-summary-pct-label { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); margin-top: 1px; }
        .lvd-bal-summary-track {
          grid-column: 1 / -1;
          height: 4px;
          background: rgba(124,92,252,0.18);
          border-radius: 999px;
          overflow: hidden;
        }
        .lvd-bal-summary-fill {
          height: 100%;
          background: linear-gradient(90deg,#5a3fd1,#7c5cfc,#a78bfa);
          border-radius: 999px;
          transition: width .35s ease;
          box-shadow: 0 0 10px rgba(124,92,252,0.40);
        }

        .lvd-bal-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        @media (max-width: 600px) {
          .lvd-bal-grid { grid-template-columns: 1fr 1fr; }
        }
        .lvd-bal-card {
          border: 1px solid var(--vz-border-color);
          border-radius: 8px;
          padding: 6px 9px 7px;
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .lvd-bal-card:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(15,23,42,0.06); }
        .lvd-bal-head {
          display: flex; align-items: center; gap: 6px;
          margin-bottom: 4px;
        }
        .lvd-bal-icon {
          width: 22px; height: 22px;
          border-radius: 6px;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .lvd-bal-icon i { font-size: 12px; }
        .lvd-bal-label {
          flex: 1; min-width: 0;
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--vz-body-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        [data-bs-theme="dark"] .lvd-bal-label { color: #fff; }
        .lvd-bal-pct-chip {
          display: inline-flex; align-items: center;
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 9px; font-weight: 800;
          flex-shrink: 0;
        }
        .lvd-bal-stat {
          display: flex; align-items: baseline; gap: 4px;
          margin-bottom: 3px;
        }
        .lvd-bal-num { font-size: 17px; font-weight: 800; line-height: 1; letter-spacing: -0.01em; }
        .lvd-bal-num-sub { font-size: 9.5px; font-weight: 600; color: var(--vz-secondary-color); text-transform: lowercase; letter-spacing: 0.02em; }
        .lvd-bal-track {
          height: 3px;
          background: rgba(0,0,0,0.05);
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 4px;
        }
        [data-bs-theme="dark"] .lvd-bal-track { background: rgba(255,255,255,0.10); }
        .lvd-bal-fill { height: 100%; border-radius: 999px; transition: width .25s ease; }
        .lvd-bal-foot {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 9px; font-weight: 700;
          color: var(--vz-secondary-color);
          letter-spacing: 0.02em;
        }
        .lvd-bal-impact-row {
          margin-top: 6px;
          padding: 5px 10px;
          background: #faf6ff;
          border: 1px dashed #c4b5fd;
          border-radius: 6px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; flex-wrap: wrap;
        }
        [data-bs-theme="dark"] .lvd-bal-impact-row {
          background: rgba(124,92,252,0.08);
          border-color: rgba(124,92,252,0.40);
        }
        .lvd-bal-impact-label {
          font-size: 10px; font-weight: 700;
          color: var(--vz-secondary-color);
          letter-spacing: 0.04em; text-transform: uppercase;
        }

        /* Team availability warning */
        .lvd-warn {
          display: flex; align-items: flex-start; gap: 8px;
          background: #fef9c3;
          border: 1px solid #fde68a;
          color: #78350f;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 10.5px; line-height: 1.35;
        }
        .lvd-warn i { font-size: 14px; color: #b45309; flex-shrink: 0; }
        .lvd-warn strong { color: #78350f; font-weight: 700; }

        /* Audit trail */
        .lvd-audit {
          background: #fff;
          border: 1px solid var(--vz-border-color);
          border-radius: 6px;
          padding: 6px 10px;
        }
        [data-bs-theme="dark"] .lvd-audit { background: var(--vz-card-bg); }
        .lvd-audit-row { font-size: 10.5px; color: var(--vz-secondary-color); padding: 0; line-height: 1.5; }
        .lvd-audit-row strong { color: var(--vz-body-color); font-weight: 700; }
        [data-bs-theme="dark"] .lvd-audit-row strong { color: #fff; }

        /* Footer */
        .lvd-footer {
          padding: 6px 14px;
          border-top: 1px solid var(--vz-border-color);
          background: #fff;
        }
        [data-bs-theme="dark"] .lvd-footer { background: var(--vz-card-bg); }
        .lvd-cancel-btn {
          width: 100%;
          padding: 6px 12px;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 11.5px; font-weight: 700;
          color: var(--vz-secondary-color);
          display: inline-flex; align-items: center; justify-content: center; gap: 5px;
          cursor: pointer;
          transition: background .15s ease, color .15s ease, border-color .15s ease;
        }
        .lvd-cancel-btn:hover {
          background: #fee2e2;
          border-color: #fecaca;
          color: #b91c1c;
        }
      `}</style>

      <div className="lvd-card" onClick={e => e.stopPropagation()}>

        {/* Header — identity only. Stage / Payroll / Proof live further down
            in their proper sections so the header stays clean. */}
        <div className="lvd-header">
          <span className="lvd-avatar" style={{ background: row.accent }}>{row.empInitials}</span>
          <div className="lvd-head-meta">
            <h5 className="lvd-head-name">{row.empName}</h5>
            <div className="lvd-head-sub">{row.empRole} · {row.id}</div>
          </div>
          <button type="button" className="lvd-head-x" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="lvd-body">

          {/* Leave Details */}
          <p className="lvd-section-title">Leave Details</p>
          <div className="lvd-details-card">
            <div>
              <div className="lvd-field-label">Leave Type</div>
              <div><span className="lv-type-pill" style={{ background: tType.bg, color: tType.fg }}>{row.type}</span></div>
            </div>
            <div>
              <div className="lvd-field-label">Duration</div>
              <div className="lvd-field-value">{row.durationLabel}</div>
            </div>
            <div>
              <div className="lvd-field-label">Dates</div>
              <div className="lvd-field-value">{row.rangeLabel}</div>
            </div>
            <div>
              <div className="lvd-field-label">Manager</div>
              <div className="lvd-field-value">{managerName}</div>
            </div>
            <div>
              <div className="lvd-field-label">Reason</div>
              <div className="lvd-field-value">{row.reason || '—'}</div>
            </div>
            <div>
              <div className="lvd-field-label">Submitted</div>
              <div className="lvd-field-value">{row.appliedOn}</div>
            </div>
          </div>

          {/* Approval Timeline — horizontal stepper. Each dot represents one
              actor in the chain (You → Manager → HR). Filled connectors show
              progress; the active step's name + comment renders below. */}
          <p className="lvd-section-title">Approval Timeline</p>
          <div className="lvd-stepper">
            {chain.map((n, i) => {
              const isActive   = n.decision === 'pending';
              const isApproved = n.decision === 'approved';
              const isRejected = n.decision === 'rejected';
              const isSkipped  = n.decision === 'skipped';

              const stepClass =
                isApproved ? 'is-done'
                : isActive ? 'is-active'
                : isRejected ? 'is-rejected'
                : isSkipped ? 'is-skipped'
                : 'is-idle';

              // Connector to NEXT step is "filled" only when THIS step is past.
              // We attach it as a modifier on this step so the ::after pseudo
              // can pick the right colour without needing to inspect siblings.
              const stepConnectorClass = isApproved ? ' has-connector-filled' : '';

              const baseIcon =
                n.role === 'Self'    ? 'ri-user-3-line'
                : n.role === 'Manager' ? 'ri-user-star-line'
                : 'ri-shield-user-line';
              const overlayIcon =
                isApproved ? 'ri-check-line'
                : isRejected ? 'ri-close-line'
                : isSkipped  ? 'ri-subtract-line'
                : null;

              const role = n.role === 'Self' ? 'You' : n.role === 'Manager' ? 'Manager' : 'HR';
              return (
                <div
                  key={i}
                  className={`lvd-step ${stepClass}${stepConnectorClass}`}
                  title={`${role}: ${n.name} — ${n.detail || ''}`}
                >
                  <span className="lvd-step-dot">
                    <i className={overlayIcon || baseIcon} />
                  </span>
                  <div className="lvd-step-meta">
                    <div className="lvd-step-role">{role}</div>
                    <div className="lvd-step-name">{n.name}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active-step detail panel — surfaces the most relevant actor's
              name, action time, and comment without bloating the stepper. */}
          {(() => {
            const pending = chain.find(n => n.decision === 'pending');
            const lastActed = [...chain].reverse().find(n => n.decision === 'approved' || n.decision === 'rejected');
            const focal = pending || lastActed;
            if (!focal) return null;
            const roleLabel =
              focal.role === 'Self' ? 'Maker'
              : focal.role === 'Manager'
                ? `Reporting Manager${row.reportingManager.designation ? ' · ' + row.reportingManager.designation : ''}`
                : 'HR';
            return (
              <div className="lvd-step-detail">
                <div className="lvd-step-detail-head">
                  <span className="lvd-step-detail-role">{roleLabel}</span>
                  <span className="lvd-step-detail-when">
                    {focal.actionAt || (focal.role === 'Self' ? row.appliedOn : 'Awaiting action')}
                  </span>
                </div>
                <div className="lvd-step-detail-body">
                  <strong>{focal.name}</strong>
                  <span className="lvd-step-detail-action">{focal.detail || '—'}</span>
                </div>
                {focal.comment && (
                  <div className="lvd-step-detail-comment">"{focal.comment}"</div>
                )}
              </div>
            );
          })()}

          {/* Footer — ETA + audit-trail pill, modeled on the reference image. */}
          <div className="lvd-step-foot">
            <span className="lvd-step-foot-eta">
              <i className="ri-time-line" />
              {row.stage === 'Approved' || row.stage === 'Rejected' || row.stage === 'Cancelled'
                ? 'Resolved'
                : 'Typically resolved in 24–48 hrs'}
            </span>
            <span className="lvd-step-foot-sep">·</span>
            <span className="lvd-step-foot-pill">AUDIT TRAIL GENERATED</span>
          </div>

          {/* Escalation banner — explains why HR is reviewing this request.
              Only shown when escalation actually happened. */}
          {row.escalatedToHr && (
            <div className={`lvd-escalation lvd-escalation--${row.escalationReason}`}>
              <i className={
                row.escalationReason === 'manager_rejected' ? 'ri-shield-cross-line'
                : row.escalationReason === 'aged_out' ? 'ri-timer-flash-line'
                : row.escalationReason === 'hr_raised' ? 'ri-user-star-line'
                : 'ri-information-line'
              } />
              <div>
                <strong>
                  {row.escalationReason === 'manager_rejected' && 'Manager rejected — escalated to HR'}
                  {row.escalationReason === 'aged_out'         && 'Auto-escalated to HR (>7 days)'}
                  {row.escalationReason === 'hr_raised'        && 'HR raised on behalf of employee'}
                  {row.escalationReason === 'manager_unavailable' && 'Manager unavailable — escalated to HR'}
                </strong>
                <div className="lvd-escalation-sub">
                  {row.escalationReason === 'manager_rejected' && 'HR can override the manager\'s decision after reviewing context.'}
                  {row.escalationReason === 'aged_out'         && 'Request sat with the manager for over 7 days; HR has been pulled in.'}
                  {row.escalationReason === 'hr_raised'        && 'Manager step is skipped — HR is the sole approver.'}
                  {row.escalationReason === 'manager_unavailable' && 'Reporting manager is on leave — HR is acting in their place.'}
                </div>
              </div>
            </div>
          )}

          {/* Payroll & Balance Impact — analytics-style summary header + grid
              of per-leave-type cards with consumption % and remaining days. */}
          <p className="lvd-section-title">Payroll &amp; Balance Impact</p>

          <div className="lvd-bal-summary">
            <div className="lvd-bal-summary-meta">
              <div className="lvd-bal-summary-label">Year-to-Date Consumption</div>
              <div className="lvd-bal-summary-num">
                <span className="lvd-bal-summary-used">{totalUsed}</span>
                <span className="lvd-bal-summary-total">/ {totalQuota} days</span>
              </div>
            </div>
            <div className="lvd-bal-summary-right">
              <div className="lvd-bal-summary-pct">{overallPct}%</div>
              <div className="lvd-bal-summary-pct-label">consumed</div>
            </div>
            <div className="lvd-bal-summary-track">
              <div className="lvd-bal-summary-fill" style={{ width: `${overallPct}%` }} />
            </div>
          </div>

          <div className="lvd-bal-grid">
            {balanceRows.map(b => {
              const pct = b.total === 0 ? 0 : Math.round((b.used / b.total) * 100);
              const remaining = Math.max(0, b.total - b.used);
              const exhausted = remaining === 0;
              return (
                <div
                  key={b.label}
                  className="lvd-bal-card"
                  style={{
                    background: `linear-gradient(135deg, ${b.color}10 0%, ${b.color}03 100%)`,
                    borderColor: `${b.color}26`,
                  }}
                >
                  <div className="lvd-bal-head">
                    <span className="lvd-bal-icon" style={{ background: `${b.color}1f`, color: b.color }}>
                      <i className={b.icon} />
                    </span>
                    <span className="lvd-bal-label">{b.label}</span>
                    <span
                      className="lvd-bal-pct-chip"
                      style={{
                        background: exhausted ? '#fee2e2' : `${b.color}1a`,
                        color: exhausted ? '#b91c1c' : b.color,
                      }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="lvd-bal-stat">
                    <span className="lvd-bal-num" style={{ color: exhausted ? '#b91c1c' : b.color }}>
                      {remaining}
                    </span>
                    <span className="lvd-bal-num-sub">{exhausted ? 'exhausted' : 'days left'}</span>
                  </div>
                  <div className="lvd-bal-track">
                    <div
                      className="lvd-bal-fill"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${b.color}, ${b.color}cc)`,
                      }}
                    />
                  </div>
                  <div className="lvd-bal-foot">
                    <span>Used {b.used}</span>
                    <span>Quota {b.total}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lvd-bal-impact-row">
            <span className="lvd-bal-impact-label">This request impacts</span>
            <span className="onb-role-pill" style={{ background: '#ddd6fe', color: '#5a3fd1', padding: '5px 14px' }}>
              <i className="ri-arrow-right-line me-1" />{row.payroll}
            </span>
          </div>

          {/* Team Availability */}
          <p className="lvd-section-title">Team Availability</p>
          <div className="lvd-warn">
            <i className="ri-alert-line" />
            <div>2 colleagues in <strong>{row.empRole}</strong> also on approved leave this month. Verify team availability.</div>
          </div>

          {/* Audit Trail */}
          <p className="lvd-section-title">Audit Trail</p>
          <div className="lvd-audit">
            {auditRows.length === 0 ? (
              <div className="lvd-empty">No audit entries yet.</div>
            ) : auditRows.map((a, i) => (
              <div key={i} className="lvd-audit-row">
                {a.date} — <strong>{a.name}</strong> {a.action}
              </div>
            ))}
          </div>

        </div>

        {/* Footer */}
        <div className="lvd-footer">
          <button type="button" className="lvd-cancel-btn">
            <i className="ri-close-line" /> Cancel Leave
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
