import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody } from 'reactstrap';
import { MasterFormStyles, MasterSelect } from './master/masterFormKit';
import '../../css/recruitment.css';
import '../../css/leave.css';
// Reuses the purple hero-card & hero-pill that HrEmployeeOnboarding ships
// (.onb-hero-card / .onb-hero-pill) so the page header reads the same as the
// Onboarding Hub.
import './employee-onboarding/HrEmployeeOnboarding.css';

// Renders dates as "05-Apr-2026" (DD-MMM-YYYY) — same project-standard format
// used by HrRecruitment so every HR module reads dates the same way.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}
// Date range formatter — collapses to a single date when from/to are equal.
function formatRange(from: string, to: string): string {
  if (!from) return '—';
  if (!to || to === from) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types — wire to GET /api/leaves when the backend is available.
//
// Workflow mirrors the project's existing Attendance Regularization pattern
// (Employee → Reporting Manager → HR). Manager is the primary approver; HR
// only steps in when (a) manager rejected (override), (b) request aged out
// past 7 days (auto-escalation), or (c) HR raised the request on the
// employee's behalf (manager step skipped).
// ─────────────────────────────────────────────────────────────────────────────
type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Earned' | 'Maternity' | 'Comp Off' | 'LOP';
type LeaveStage =
  | 'Approved'           // final state — manager approved (or HR overrode)
  | 'Pending (Manager)'  // sitting with the reporting manager
  | 'Pending (HR)'       // escalated to HR (override / age-out / HR-raised)
  | 'Rejected'           // both levels rejected (or final no)
  | 'Cancelled';         // employee withdrew before action
type ApprovalState = 'Pending' | 'Approved' | 'Rejected' | 'NA';
type PayrollMode = 'Paid Leave' | 'Unpaid' | 'Half-Pay';
type ProofState = 'Uploaded' | 'Missing' | 'N/A';
type EscalationReason = 'manager_rejected' | 'aged_out' | 'manager_unavailable' | 'hr_raised' | 'none';

interface PersonRef {
  initials: string;
  name: string;
  designation: string;
}

interface LeaveRequest {
  id: string;                          // LV-1042 (matches approval_queue.id)
  empCode: string;                     // employee.emp_code
  empInitials: string;
  empName: string;
  empRole: string;                     // designation + department
  // New facets used by the Figma filter chips (Department / Location /
  // Legal Entity). Backend will eventually expose these as employee-level
  // attributes; for the dummy rows below they're seeded so each row exercises
  // the filter logic.
  department: string;
  location: string;
  legalEntity: string;
  accent: string;
  type: LeaveType;
  durationDays: number;
  durationLabel: string;
  // ISO dates (YYYY-MM-DD). Display strings are computed via formatDate /
  // formatRange so the format stays consistent with HrRecruitment.
  fromDate: string;
  toDate: string;
  appliedOn: string;
  raisedBy: 'employee' | 'hr';

  reportingManager: PersonRef;
  hrApprover?: PersonRef;

  managerStatus: ApprovalState;
  managerActionAt?: string;            // ISO
  managerComment?: string;

  hrStatus: ApprovalState;
  hrActionAt?: string;                 // ISO
  hrComment?: string;

  escalatedToHr: boolean;
  escalationReason: EscalationReason;

  stage: LeaveStage;
  // Short SLA / state hint shown next to the status pill ("3d pending",
  // "auto-escalated", "HR override"). Date-bearing notes (like
  // "Approved: 13-Apr-2026") are derived at render time, not stored here.
  stageNote?: string;

  payroll: PayrollMode;
  proof: ProofState;
  proofVia?: string;
  // Supporting-document metadata. Backend will expose these when the
  // /api/leaves endpoint lands; for now they're dummy strings so HR can
  // see realistic file chips in the table.
  proofType?: string;        // human-friendly category, e.g. "Medical Certificate"
  proofFileName?: string;    // actual file name, e.g. "medical-certificate.pdf"
  proofUrl?: string;         // download/preview URL — left blank in dummy data
  proofUploadedAt?: string;  // ISO timestamp of upload
  proofMimeType?: string;    // "application/pdf", "image/jpeg", …
  proofSizeKb?: number;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tone palettes — bg/fg pairs consumed by `.rec-pill` (which only carries the
// shape; colour comes through inline style — same convention HrRecruitment
// uses for priority / employment-type pills).
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

const PAYROLL_TONE: Record<PayrollMode, { fg: string; bg: string }> = {
  'Paid Leave': { fg: '#5a3fd1', bg: '#ece6ff' },
  'Unpaid':     { fg: '#374151', bg: '#eef2f6' },
  'Half-Pay':   { fg: '#a4661c', bg: '#fde8c4' },
};

// SLA traffic-light: green (fresh) → red (aging) → solid amber (breached).
// Anchored against `appliedOn`; the 7-day cutoff matches deriveChain()'s
// `aged_out` rule so the pill flips to OVERDUE the same moment HR auto-
// escalation kicks in.
type SlaTone = { label: string; bg: string; fg: string; solid?: boolean };
function computeSla(r: LeaveRequest, today = new Date()): SlaTone | null {
  if (!r.stage.startsWith('Pending')) return null;
  const applied = new Date(r.appliedOn);
  if (isNaN(applied.getTime())) return null;
  const days = Math.max(0, Math.round((today.getTime() - applied.getTime()) / (1000 * 60 * 60 * 24)));
  if (days >= 7) return { label: 'OVERDUE',           bg: '#fde68a', fg: '#92400e', solid: true };
  if (days >= 3) return { label: `${days}d pending`,  bg: '#fee2e2', fg: '#b91c1c' };
  return            { label: `${days || 1}d pending`, bg: '#d1fae5', fg: '#065f46' };
}

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

// ─────────────────────────────────────────────────────────────────────────────
// Dummy data — replace with `GET /api/leaves?fy=2025-26` when wired.
// Each row exercises a distinct branch of the approval workflow.
// ─────────────────────────────────────────────────────────────────────────────
const buildRequests = (): LeaveRequest[] => [
  {
    id: 'LV-1042', empCode: 'LV-001',
    empInitials: 'GJ', empName: 'Gaurav Jagtap', empRole: 'Software Development', accent: accent(0),
    department: 'Engineering', location: 'Mumbai', legalEntity: 'IGC India Pvt Ltd',
    type: 'Annual', durationDays: 3, durationLabel: '3 days',
    fromDate: '2026-04-14', toDate: '2026-04-16', appliedOn: '2026-04-12',
    raisedBy: 'employee',
    reportingManager: { initials: 'PL', name: 'Pranav Lokhande', designation: 'Project Manager' },
    managerStatus: 'Approved', managerActionAt: '2026-04-13', managerComment: 'Approved — please share handover notes before EOD.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Parth',
    proofType: 'Function Card', proofFileName: 'wedding-card.pdf', proofMimeType: 'application/pdf',
    proofSizeKb: 412, proofUploadedAt: '2026-04-12',
    reason: 'Family function',
  },
  {
    id: 'LV-1043', empCode: 'LV-002',
    empInitials: 'RC', empName: 'Ritika Chauhan', empRole: 'UI/UX Designing', accent: accent(1),
    department: 'Design', location: 'Mumbai', legalEntity: 'IGC India Pvt Ltd',
    type: 'Sick', durationDays: 2, durationLabel: '2 days',
    fromDate: '2026-04-09', toDate: '2026-04-10', appliedOn: '2026-04-07',
    raisedBy: 'employee',
    reportingManager: { initials: 'PL', name: 'Pranav Lokhande', designation: 'Team Lead — Design' },
    managerStatus: 'Approved', managerActionAt: '2026-04-08', managerComment: 'Get well soon.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Parth',
    proofType: 'Medical Certificate',
    reason: 'Fever — medical leave',
  },
  {
    id: 'LV-1044', empCode: 'LV-003',
    empInitials: 'HT', empName: 'Harsh Thakur', empRole: 'Business Analyst', accent: accent(2),
    department: 'Operations', location: 'Pune', legalEntity: 'IGC India Pvt Ltd',
    type: 'Casual', durationDays: 1, durationLabel: '1 day',
    fromDate: '2026-04-11', toDate: '2026-04-11', appliedOn: '2026-04-08',
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
    department: 'Engineering', location: 'Bengaluru', legalEntity: 'IGC India Pvt Ltd',
    type: 'Sick', durationDays: 1, durationLabel: '1 day',
    fromDate: '2026-04-08', toDate: '2026-04-08', appliedOn: '2026-04-06',
    raisedBy: 'employee',
    reportingManager: { initials: 'AP', name: 'Atharv Patil', designation: 'QA Lead' },
    managerStatus: 'Approved', managerActionAt: '2026-04-07',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Atharv',
    proofType: 'Medical Prescription',
    reason: 'Medical appointment',
  },
  {
    id: 'LV-1046', empCode: 'LV-005',
    empInitials: 'NK', empName: 'Neha Kulkarni', empRole: 'Product Design', accent: accent(4),
    department: 'Design', location: 'Bengaluru', legalEntity: 'IGC India Pvt Ltd',
    type: 'Earned', durationDays: 5, durationLabel: '5 days',
    fromDate: '2026-04-21', toDate: '2026-04-25', appliedOn: '2026-04-14',
    raisedBy: 'hr',
    reportingManager: { initials: 'VR', name: 'Vishal Rao', designation: 'Design Head' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'NA',
    hrStatus: 'Pending',
    escalatedToHr: true, escalationReason: 'hr_raised',
    stage: 'Pending (HR)', stageNote: '1d pending · HR-raised',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Vishal',
    proofType: 'Travel Itinerary', proofFileName: 'goa-itinerary.pdf', proofMimeType: 'application/pdf',
    proofSizeKb: 287, proofUploadedAt: '2026-04-14',
    reason: 'Carry-forward leave — vacation',
  },
  {
    id: 'LV-1047', empCode: 'LV-006',
    empInitials: 'RG', empName: 'Rahul Gupta', empRole: 'Account Executive', accent: accent(5),
    department: 'Sales', location: 'Delhi', legalEntity: 'IGC India Pvt Ltd',
    type: 'LOP', durationDays: 2, durationLabel: '2 days',
    fromDate: '2026-04-02', toDate: '2026-04-03', appliedOn: '2026-04-01',
    raisedBy: 'employee',
    reportingManager: { initials: 'PI', name: 'Priya Iyer', designation: 'Sales Lead' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Rejected', managerActionAt: '2026-04-02', managerComment: 'Quarter close week — cannot release.',
    hrStatus: 'Approved', hrActionAt: '2026-04-02', hrComment: 'Approved as exception — verified personal emergency.',
    escalatedToHr: true, escalationReason: 'manager_rejected',
    stage: 'Approved', stageNote: 'HR override',
    payroll: 'Unpaid', proof: 'N/A', reason: 'Personal emergency',
  },
  {
    id: 'LV-1048', empCode: 'LV-007',
    empInitials: 'KS', empName: 'Karan Singh', empRole: 'Software Engineer', accent: accent(6),
    department: 'Engineering', location: 'Pune', legalEntity: 'IGC India Pvt Ltd',
    type: 'Casual', durationDays: 4, durationLabel: '4 days',
    fromDate: '2026-04-17', toDate: '2026-04-20', appliedOn: '2026-04-12',
    raisedBy: 'employee',
    reportingManager: { initials: 'AG', name: 'Arun Gupta', designation: 'Engineering Manager' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Rejected', managerActionAt: '2026-04-13', managerComment: 'Sprint close conflicts with these dates.',
    hrStatus: 'Rejected', hrActionAt: '2026-04-14', hrComment: 'Concur with manager — re-apply for next sprint.',
    escalatedToHr: true, escalationReason: 'manager_rejected',
    stage: 'Rejected',
    payroll: 'Paid Leave', proof: 'N/A', reason: 'Wedding in family',
  },
  {
    id: 'LV-1049', empCode: 'LV-008',
    empInitials: 'DN', empName: 'Deepa Nair', empRole: 'Finance Analyst', accent: accent(7),
    department: 'Finance', location: 'Mumbai', legalEntity: 'IGC India Pvt Ltd',
    type: 'Earned', durationDays: 3, durationLabel: '3 days',
    fromDate: '2026-04-28', toDate: '2026-04-30', appliedOn: '2026-04-04',
    raisedBy: 'employee',
    reportingManager: { initials: 'NM', name: 'Nikhil Mehra', designation: 'Finance Lead' },
    hrApprover: { initials: 'RV', name: 'Rajesh Verma', designation: 'HR Manager' },
    managerStatus: 'Pending',
    hrStatus: 'Pending',
    escalatedToHr: true, escalationReason: 'aged_out',
    stage: 'Pending (HR)', stageNote: '8d pending · auto-escalated',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Self',
    proofType: 'Booking Confirmation', proofFileName: 'flight-tickets.pdf', proofMimeType: 'application/pdf',
    proofSizeKb: 198, proofUploadedAt: '2026-04-04',
    reason: 'Annual vacation — pre-booked tickets',
  },
  // ── Approved leaves spanning today (TODAY_DEMO = 2026-04-22) so the
  //    "On Leave Today" panel always has someone to surface in the demo. ──
  {
    id: 'LV-1050', empCode: 'LV-009',
    empInitials: 'AM', empName: 'Aarav Mehta', empRole: 'Software Development', accent: accent(0),
    department: 'Engineering', location: 'Bengaluru', legalEntity: 'IGC India Pvt Ltd',
    type: 'Annual', durationDays: 6, durationLabel: '6 days',
    fromDate: '2026-04-20', toDate: '2026-04-25', appliedOn: '2026-04-08',
    raisedBy: 'employee',
    reportingManager: { initials: 'GJ', name: 'Gaurav Jagtap', designation: 'Engineering Manager' },
    managerStatus: 'Approved', managerActionAt: '2026-04-09', managerComment: 'Enjoy your break.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Self',
    proofType: 'Travel Itinerary', proofFileName: 'goa-trip.pdf', proofMimeType: 'application/pdf',
    proofSizeKb: 234, proofUploadedAt: '2026-04-08',
    reason: 'Pre-planned vacation',
  },
  {
    id: 'LV-1051', empCode: 'LV-010',
    empInitials: 'PS', empName: 'Priya Sharma', empRole: 'Human Resources', accent: accent(2),
    department: 'HR', location: 'Mumbai', legalEntity: 'IGC India Pvt Ltd',
    type: 'Casual', durationDays: 1, durationLabel: '1 day',
    fromDate: '2026-04-22', toDate: '2026-04-22', appliedOn: '2026-04-19',
    raisedBy: 'employee',
    reportingManager: { initials: 'SG', name: 'Sunita Ghosh', designation: 'HR Head' },
    managerStatus: 'Approved', managerActionAt: '2026-04-20',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'N/A',
    reason: 'Personal work',
  },
  {
    id: 'LV-1052', empCode: 'LV-011',
    empInitials: 'VN', empName: 'Vikram Nair', empRole: 'Product Management', accent: accent(4),
    department: 'Product', location: 'Mumbai', legalEntity: 'IGC India Pvt Ltd',
    type: 'Sick', durationDays: 3, durationLabel: '3 days',
    fromDate: '2026-04-21', toDate: '2026-04-23', appliedOn: '2026-04-21',
    raisedBy: 'employee',
    reportingManager: { initials: 'AG', name: 'Arun Gupta', designation: 'CTO' },
    managerStatus: 'Approved', managerActionAt: '2026-04-21', managerComment: 'Get well soon.',
    hrStatus: 'NA', escalatedToHr: false, escalationReason: 'none',
    stage: 'Approved',
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Self',
    proofType: 'Medical Certificate', proofFileName: 'med-cert.pdf', proofMimeType: 'application/pdf',
    proofSizeKb: 158, proofUploadedAt: '2026-04-21',
    reason: 'Viral fever',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedNumber — same count-up the recruitment KPIs use.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Approval-chain projection. The backend stores the workflow as discrete
// fields (managerStatus / hrStatus / escalatedToHr); the table and timeline
// both consume a flat 3-node list, so this projection happens at render-time.
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
// HrLeave — page component. Layout, classes and table mirror HrRecruitment.
// ─────────────────────────────────────────────────────────────────────────────
// The page now surfaces "On Leave Today" as its own employee panel below
// the KPI strip (avatar chips, not a count tile), so the KPI row drops to
// four cards. Anchoring against a fixed demo date so the panel is always
// populated until the backend feeds real `LEAVE_REQUESTS.startDate <= today
// <= endDate` data.
const TODAY_DEMO = '2026-04-22';
const KPI_CARDS = [
  { key: 'total',    label: 'Total Requests',   icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#0c63b0,#0ea5e9)' },
  { key: 'pending',  label: 'Pending Approval', icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
  { key: 'approved', label: 'Approved (Month)', icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#22c8a9)' },
  { key: 'rejected', label: 'Rejected',         icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#f06548,#fda192)' },
] as const;

export default function HrLeave() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<LeaveRequest[]>(buildRequests);

  // Confirmation popup for the Approve / Reject row actions. Open state
  // carries which row is being actioned and the intent so the modal copy +
  // accent colour can react accordingly.
  const [confirmAction, setConfirmAction] = useState<
    { row: LeaveRequest; action: 'approve' | 'reject' } | null
  >(null);

  const applyAction = (comment: string) => {
    if (!confirmAction) return;
    const { row, action } = confirmAction;
    const today = new Date().toISOString().slice(0, 10);
    setRequests(prev => prev.map(r => {
      if (r.id !== row.id) return r;
      if (action === 'approve') {
        return {
          ...r,
          managerStatus: 'Approved',
          managerActionAt: today,
          managerComment: comment.trim() || r.managerComment,
          stage: 'Approved',
          stageNote: undefined,
        };
      }
      return {
        ...r,
        managerStatus: 'Rejected',
        managerActionAt: today,
        managerComment: comment.trim() || r.managerComment,
        stage: 'Rejected',
        stageNote: undefined,
      };
    }));
    setConfirmAction(null);
  };

  // Filter state. Tabs drive the Status filter (no separate dropdown for it
  // since the segmented control owns that pivot). Dropdowns cover the
  // remaining facets — Department / Type / Stage / Payroll.
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState<string>('All');
  const [department, setDepartment] = useState<string>('All');
  const [type,    setType]    = useState<string>('All');
  const [stage,   setStage]   = useState<string>('All');
  const [payroll, setPayroll] = useState<string>('All');
  const [page,    setPage]    = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Drawer state — opens the read-only details modal for a single row.
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  // Collapsible state for the "On Leave Today" panel.
  const [todayOpen, setTodayOpen] = useState(true);

  // Bulk-selection state — only Pending rows are selectable since terminal
  // states can't be re-actioned. The header checkbox cycles select-all /
  // deselect-all over the *currently visible* pending rows.
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
      tabs: {
        All:      requests.length,
        Pending:  pending.length,
        Approved: approved.length,
        Rejected: rejected.length,
      },
    };
  }, [requests]);

  // Employees whose approved leave overlaps "today". Used by the avatar
  // panel right under the KPI strip. Backend will replace TODAY_DEMO with
  // the server-side current date once /api/leaves is wired.
  const onLeaveToday = useMemo(() => {
    const today = TODAY_DEMO;
    return requests.filter(r =>
      r.stage === 'Approved' && r.fromDate <= today && r.toDate >= today
    );
  }, [requests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(r => {
      if (status === 'Pending'  && !r.stage.startsWith('Pending')) return false;
      if (status === 'Approved' && r.stage !== 'Approved')          return false;
      if (status === 'Rejected' && r.stage !== 'Rejected')          return false;

      if (stage !== 'All') {
        const matchesStage =
          stage === 'Submitted'      ? false
          : stage === 'Manager Review' ? r.stage === 'Pending (Manager)'
          : stage === 'HR Review'    ? r.stage === 'Pending (HR)'
          : stage === 'Approved'     ? r.stage === 'Approved'
          : stage === 'Rejected'     ? r.stage === 'Rejected'
          : true;
        if (!matchesStage) return false;
      }

      if (type       !== 'All' && r.type       !== type)       return false;
      if (payroll    !== 'All' && r.payroll    !== payroll)    return false;
      if (department !== 'All' && r.department !== department) return false;

      if (!q) return true;
      return [r.empName, r.empRole, r.id, r.empCode, r.type].some(v => v.toLowerCase().includes(q));
    });
  }, [requests, search, status, type, stage, payroll, department]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  // Department options derived from the rows themselves so the dropdown
  // never offers a value with zero matches.
  const DEPT_OPTIONS = [
    { value: 'All', label: 'All Departments' },
    ...Array.from(new Set(requests.map(r => r.department))).filter(Boolean).sort()
      .map(v => ({ value: v, label: v })),
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

  return (
    <>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* ── Hero card — purple-tinted banner, mirrors Onboarding Hub.
                  Uses the existing .onb-hero-card / .onb-hero-pill classes
                  shipped by HrEmployeeOnboarding. ── */}
            <div className="onb-hero-card mb-3">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 48, height: 48,
                    background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
                    boxShadow: '0 8px 18px rgba(124,92,252,0.32)',
                  }}
                >
                  <i className="ri-calendar-2-line" style={{ color: '#fff', fontSize: 22 }} />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0">Leave Management</h5>
                    <span className="onb-hero-pill">
                      <span className="dot" />
                      FY 2025–26
                    </span>
                  </div>
                  <div className="text-muted mt-1 fs-13">
                    Leave requests, balances, and approval pipeline across all employees
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <button type="button" className="rec-btn-ghost">
                  <i className="ri-calendar-event-line" />Holidays
                </button>
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => navigate('/hr/leave-plans')}
                >
                  <i className="ri-settings-3-line" />Leave Plans
                </button>
              </div>
            </div>

            {/* ── KPI cards (4 tiles) ── */}
            <Row className="g-3 mb-3 align-items-stretch rec-page-kpis">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={3} md={6} sm={6} xs={12}>
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

            {/* ── On Leave Today — collapsible avatar strip. Header doubles
                  as a toggle so the panel can fold away when HR wants more
                  vertical space. Decorative gradient banner + by-leave-type
                  mini-summary ("3 Sick · 2 Annual") makes the strip readable
                  at a glance even before the chips render. */}
            <div className={`lv-today-card mb-3 ${todayOpen ? 'is-open' : 'is-closed'}`}>
              <button
                type="button"
                className="lv-today-head lv-today-head-btn"
                onClick={() => setTodayOpen(o => !o)}
                aria-expanded={todayOpen}
              >
                <span className="lv-today-banner">
                  <span className="lv-today-banner-icon">
                    <i className="ri-user-follow-line" />
                  </span>
                  <span className="lv-today-banner-text">
                    <span className="lv-today-banner-title">On Leave Today</span>
                    <span className="lv-today-banner-sub">
                      <i className="ri-calendar-event-line" />
                      {formatDate(TODAY_DEMO)}
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
                <span className="lv-today-banner-end">
                  <span className={`lv-today-count ${onLeaveToday.length === 0 ? 'is-empty' : ''}`}>
                    <i className={onLeaveToday.length === 0 ? 'ri-emotion-happy-line' : 'ri-team-line'} />
                    {onLeaveToday.length} {onLeaveToday.length === 1 ? 'person' : 'people'}
                  </span>
                  <i className={`lv-today-caret ri-arrow-${todayOpen ? 'up' : 'down'}-s-line`} />
                </span>
              </button>

              {todayOpen && (
                onLeaveToday.length === 0 ? (
                  <div className="lv-today-empty">
                    <span className="lv-today-empty-icon">
                      <i className="ri-emotion-happy-line" />
                    </span>
                    <div className="fw-bold mt-2" style={{ fontSize: 13 }}>Everyone is in today</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      No approved leaves overlap {formatDate(TODAY_DEMO)}.
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
                          onClick={() => setDetail(r)}
                          title={`${r.empName} · ${r.type} · until ${formatDate(r.toDate)}`}
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
                              <span className="rec-pill" style={{ background: tType.bg, color: tType.fg, padding: '1px 7px', fontSize: 10 }}>
                                {r.type}
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

            {/* ── Tabs (All / Pending / Approved / Rejected) — segmented control,
                  drives the Status filter so the dropdown stays in sync. ── */}
            <div className="rec-tab-track mb-2">
              {([
                { key: 'All',      label: 'All Leaves',      count: counts.tabs.All,      icon: 'ri-stack-line',          variant: 'in-progress' },
                { key: 'Pending',  label: 'Pending',         count: counts.tabs.Pending,  icon: 'ri-time-line',           variant: 'in-progress' },
                { key: 'Approved', label: 'Approved',        count: counts.tabs.Approved, icon: 'ri-checkbox-circle-line',variant: 'completed'   },
                { key: 'Rejected', label: 'Rejected',        count: counts.tabs.Rejected, icon: 'ri-close-circle-line',   variant: 'cancelled'   },
              ] as const).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setStatus(t.key); setPage(1); }}
                  className={`rec-tab ${status === t.key ? `is-active ${t.variant}` : ''}`}
                >
                  <i className={t.icon} />
                  {t.label}
                  <span className="badge">{t.count}</span>
                </button>
              ))}
            </div>

            {/* ── Bulk-action bar — only renders when at least one row is
                  selected. Composed from existing recruitment classes
                  (rec-header-count, rec-act-icon, rec-btn-primary,
                  rec-btn-ghost) + Bootstrap utilities. */}
            {selectedIds.size > 0 && (
              <div className="d-flex align-items-center gap-2 flex-wrap p-2 rounded-3 border mb-2 bg-light">
                <span className="rec-header-count">
                  <span className="dot" />
                  {selectedIds.size} selected
                </span>
                <button type="button" className="rec-btn-primary">
                  <i className="ri-check-double-line" />Approve Selected
                </button>
                <button type="button" className="rec-btn-soft">
                  <i className="ri-close-line" />Reject Selected
                </button>
                <button type="button" className="rec-btn-ghost ms-auto" onClick={clearSelection}>
                  <i className="ri-close-circle-line" />Clear
                </button>
              </div>
            )}

            {/* ── Search + Filters + Table — single rec-list-frame ── */}
            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input
                        type="text"
                        className="form-control"
                        placeholder="Search name, ID, type…"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                      />
                      <i className="ri-search-line search-icon" />
                    </div>
                    <span className="text-uppercase fw-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>Department</span>
                    <div style={{ minWidth: 160 }}>
                      <MasterSelect value={department} onChange={v => { setDepartment(v); setPage(1); }} options={DEPT_OPTIONS} placeholder="All Departments" />
                    </div>
                    <span className="text-uppercase fw-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>Type</span>
                    <div style={{ minWidth: 140 }}>
                      <MasterSelect value={type} onChange={v => { setType(v); setPage(1); }} options={TYPE_OPTIONS} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>Stage</span>
                    <div style={{ minWidth: 160 }}>
                      <MasterSelect value={stage} onChange={v => { setStage(v); setPage(1); }} options={STAGE_OPTIONS} placeholder="All Stages" />
                    </div>
                    <span className="text-uppercase fw-semibold text-muted" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>Payroll</span>
                    <div style={{ minWidth: 140 }}>
                      <MasterSelect value={payroll} onChange={v => { setPayroll(v); setPage(1); }} options={PAYROLL_OPTIONS} placeholder="All" />
                    </div>
                  </div>


                  <div className="rec-list-scroll">
                    {(() => {
                      // Header checkbox toggles all *visible pending* rows on
                      // the current page. Tri-state: indeterminate when only
                      // some are selected, checked when all are.
                      const visiblePending = visible.filter(isPendingRow);
                      const visiblePendingIds = visiblePending.map(r => r.id);
                      const selectedVisible = visiblePendingIds.filter(id => selectedIds.has(id)).length;
                      const allVisibleChecked = visiblePending.length > 0 && selectedVisible === visiblePending.length;
                      const someVisibleChecked = selectedVisible > 0 && selectedVisible < visiblePending.length;
                      const togglePageSelection = () => {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (allVisibleChecked) {
                            visiblePendingIds.forEach(id => next.delete(id));
                          } else {
                            visiblePendingIds.forEach(id => next.add(id));
                          }
                          return next;
                        });
                      };
                      return (
                    <table className="rec-list-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th scope="col" className="ps-3 text-center" style={{ width: 38 }}>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={allVisibleChecked}
                              ref={el => { if (el) el.indeterminate = someVisibleChecked; }}
                              disabled={visiblePending.length === 0}
                              onChange={togglePageSelection}
                              aria-label="Select all pending requests on this page"
                            />
                          </th>
                          <th scope="col" className="text-center" style={{ width: 50 }}>SR.</th>
                          <th scope="col" style={{ width: 240 }}>Employee</th>
                          <th scope="col" style={{ width: 100 }}>Type</th>
                          <th scope="col" style={{ width: 80 }}>Duration</th>
                          <th scope="col" style={{ width: 220 }}>Date Range</th>
                          <th scope="col" style={{ width: 200 }}>Approval Chain</th>
                          <th scope="col" style={{ width: 120 }}>Payroll</th>
                          <th scope="col" style={{ width: 110 }}>Proof</th>
                          <th scope="col" style={{ width: 180 }}>Status</th>
                          <th scope="col" style={{ width: 120 }}>SLA</th>
                          <th scope="col" className="text-center pe-3" style={{ width: 130 }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.length === 0 ? (
                          <tr>
                            <td colSpan={12} className="text-center py-5 text-muted">
                              <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                              No leave requests match your filters
                            </td>
                          </tr>
                        ) : visible.map((r, idx) => {
                          const tone = STAGE_TONE[r.stage];
                          const tType = TYPE_TONE[r.type];
                          const tPay = PAYROLL_TONE[r.payroll];
                          const isPending = r.stage.startsWith('Pending');
                          const isSelected = selectedIds.has(r.id);
                          return (
                            <tr key={r.id} className={isSelected ? 'table-active' : undefined}>
                              <td className="ps-3 text-center">
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={isSelected}
                                  disabled={!isPending}
                                  onChange={() => toggleRow(r.id)}
                                  aria-label={`Select request ${r.id}`}
                                  title={isPending ? 'Select for bulk action' : 'Only pending requests can be bulk-actioned'}
                                />
                              </td>
                              <td className="text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  <div
                                    className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                    style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}
                                  >
                                    {r.empInitials}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="fw-semibold fs-13">{r.empName}</div>
                                    <div className="text-muted" style={{ fontSize: 11.5 }}>{r.empCode} · {r.empRole}</div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="rec-pill" style={{ background: tType.bg, color: tType.fg }}>
                                  {r.type}
                                </span>
                              </td>
                              <td className="fs-13">{r.durationLabel}</td>
                              <td>
                                <div className="fs-13 fw-semibold"><span className="rec-date">{formatRange(r.fromDate, r.toDate)}</span></div>
                                <div className="text-muted" style={{ fontSize: 11 }}>Applied: {formatDate(r.appliedOn)}</div>
                              </td>
                              <td>
                                <ChainDots row={r} />
                              </td>
                              <td>
                                <span className="rec-pill" style={{ background: tPay.bg, color: tPay.fg }}>
                                  {r.payroll}
                                </span>
                              </td>
                              <td>
                                {r.proof === 'Uploaded' ? (
                                  // Uploaded → pill-button with eye icon. The
                                  // proof is a file (image / PDF / etc.) so
                                  // the click opens the proofUrl directly
                                  // when one is present; the form-popup is
                                  // *not* used because that's for request
                                  // metadata, not files. Backend will fill
                                  // proofUrl from the storage layer.
                                  <button
                                    type="button"
                                    className="lv-proof-btn lv-proof-uploaded"
                                    onClick={() => {
                                      if (r.proofUrl) window.open(r.proofUrl, '_blank', 'noopener');
                                    }}
                                    title={r.proofFileName ? `Preview ${r.proofFileName}` : 'Preview proof'}
                                  >
                                    <i className="ri-check-line" />
                                    <span>Uploaded</span>
                                    <i className="ri-eye-line lv-proof-view" />
                                  </button>
                                ) : (
                                  // Missing and N/A both render as a quiet
                                  // dash — keeps the column scannable for
                                  // rows where proof isn't actionable.
                                  <span className="text-muted fs-13">—</span>
                                )}
                              </td>
                              <td>
                                <span className="rec-pill" style={{ background: tone.bg, color: tone.fg }}>
                                  {r.stage}
                                </span>
                                {isPending && r.stageNote && (
                                  <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>{r.stageNote}</div>
                                )}
                              </td>
                              <td>
                                {(() => {
                                  const sla = computeSla(r);
                                  return sla ? (
                                    <span
                                      className="rec-pill"
                                      style={{ background: sla.bg, color: sla.fg, fontWeight: sla.solid ? 800 : 700 }}
                                    >
                                      {sla.label}
                                    </span>
                                  ) : <span className="text-muted fs-13">—</span>;
                                })()}
                              </td>
                              <td className="pe-3">
                                <div className="d-flex gap-1 justify-content-center align-items-center">
                                  <ActionBtn
                                    title="View details"
                                    icon="ri-eye-line"
                                    tone="info"
                                    onClick={() => setDetail(r)}
                                  />
                                  <ActionBtn
                                    title={
                                      r.stage === 'Approved'  ? 'Already approved'
                                      : r.stage === 'Cancelled' ? 'Request cancelled'
                                      : 'Approve'
                                    }
                                    icon="ri-check-line"
                                    tone="success"
                                    disabled={r.stage === 'Approved' || r.stage === 'Cancelled'}
                                    onClick={() => setConfirmAction({ row: r, action: 'approve' })}
                                  />
                                  <ActionBtn
                                    title={
                                      r.stage === 'Rejected'  ? 'Already rejected'
                                      : r.stage === 'Cancelled' ? 'Request cancelled'
                                      : 'Reject'
                                    }
                                    icon="ri-close-line"
                                    tone="danger"
                                    disabled={r.stage === 'Rejected' || r.stage === 'Cancelled'}
                                    onClick={() => setConfirmAction({ row: r, action: 'reject' })}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                      );
                    })()}
                  </div>

                  {/* Pagination footer — same shape as recruitment */}
                  <div className="rec-list-footer">
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
                      <div style={{ width: 80 }}>
                        <MasterSelect
                          value={String(pageSize)}
                          onChange={(v) => { setPageSize(Number(v) || 10); setPage(1); }}
                          options={['10', '25', '50'].map(v => ({ value: v, label: v }))}
                          placeholder="10"
                        />
                      </div>
                      <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
                        Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>‹ Prev</button>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <button
                          key={i}
                          className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                          onClick={() => goto(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>Next ›</button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {/* ── Read-only details modal — mirrors HrRecruitment's view modal. ── */}
      <LeaveDetailsModal row={detail} onClose={() => setDetail(null)} />
      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={applyAction}
      />
    </>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// LeaveDetailsModal — read-only Reactstrap Modal using the rec-form-modal
// shell (same chrome HrRecruitment uses for its View modal). All copy lives
// in tagged sub-components so the body reads top-to-bottom.
// ─────────────────────────────────────────────────────────────────────────────
function LeaveDetailsModal({ row, onClose }: { row: LeaveRequest | null; onClose: () => void }) {
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
        {/* Header */}
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

        {/* Body */}
        <div className="rec-view-body" style={{ padding: '14px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>

          {/* Leave Details — 3-column grid so values like the manager
              "Name · Designation" line don't wrap awkwardly. */}
          <div className="rec-view-card">
            <div className="rec-view-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              <Field label="Leave Type" value={
                <span className="rec-pill" style={{ background: tType.bg, color: tType.fg }}>{row.type}</span>
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
                <span className="rec-pill" style={{ background: tPay.bg, color: tPay.fg }}>{row.payroll}</span>
              } />
              <Field label="Status" value={
                <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: tStage.bg, color: tStage.fg }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: tStage.dot }} />
                  {row.stage}
                </span>
              } />
              <Field label="Reason" value={row.reason} />
            </div>
          </div>

          {/* Approval Timeline — clean vertical list. Each step is a row:
              colored dot + role/name/action/date + comment block beneath. */}
          <div className="rec-view-card mt-3">
            <div className="rec-view-label mb-2">Approval Timeline</div>
            <ApprovalTimelineList chain={chain} reportingManager={row.reportingManager} appliedOn={row.appliedOn} />
            {row.escalatedToHr && (
              <div className="mt-2 d-flex align-items-start gap-2 p-2 rounded" style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f' }}>
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

          {/* Policy Flags — auto-derived from the request shape (short
              notice, long duration, manager rejection, etc). HR uses these
              to spot-check requests that need a closer look. */}
          {(() => {
            const flags: { label: string; tone: { bg: string; fg: string } }[] = [];

            // "Short Notice" — applied less than 2 days before the leave starts.
            const applied = new Date(row.appliedOn);
            const startsAt = new Date(row.fromDate);
            const noticeDays = Math.round((startsAt.getTime() - applied.getTime()) / (1000 * 60 * 60 * 24));
            if (!isNaN(noticeDays) && noticeDays < 2 && row.type !== 'Sick' && row.type !== 'Maternity') {
              flags.push({ label: 'Short Notice', tone: { bg: '#fde2dc', fg: '#b91c1c' } });
            }

            // "Long Duration" — more than 5 working days.
            if (row.durationDays > 5) {
              flags.push({ label: 'Long Duration', tone: { bg: '#fde8c4', fg: '#a4661c' } });
            }

            // "Manager Override" — HR overrode a manager rejection.
            if (row.escalationReason === 'manager_rejected' && row.hrStatus === 'Approved') {
              flags.push({ label: 'HR Override', tone: { bg: '#ede9fe', fg: '#5a3fd1' } });
            }

            // "SLA Breached" — pending more than 7 days (auto-escalation cutoff).
            if (row.escalationReason === 'aged_out') {
              flags.push({ label: 'SLA Breached', tone: { bg: '#fef3c7', fg: '#92400e' } });
            }

            // "Missing Proof" — required document hasn't been uploaded yet.
            if (row.proof === 'Missing') {
              flags.push({ label: 'Missing Proof', tone: { bg: '#fde2dc', fg: '#b91c1c' } });
            }

            return (
              <div className="rec-view-card mt-3">
                <div className="rec-view-label mb-2">Policy Flags</div>
                {flags.length === 0 ? (
                  <span className="text-muted fst-italic" style={{ fontSize: 12 }}>No policy flags</span>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {flags.map((f, i) => (
                      <span
                        key={i}
                        className="rec-pill"
                        style={{ background: f.tone.bg, color: f.tone.fg }}
                      >
                        <i className="ri-flag-2-line me-1" />{f.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Payroll & Balance Impact — per-leave-type usage bars + the
              payroll mode this request will be charged against. Numbers are
              dummy until the backend exposes /api/employees/:id/leave-balances. */}
          <div className="rec-view-card mt-3">
            <div className="rec-view-label mb-2">Payroll &amp; Balance Impact</div>
            {[
              { label: 'Annual Leave', used: 14, total: 18, color: '#7c5cfc' },
              { label: 'Sick Leave',   used: 6,  total: 12, color: '#dc2626' },
              { label: 'Casual Leave', used: 5,  total: 8,  color: '#c2410c' },
              { label: 'WFH Days',     used: 16, total: 24, color: '#0ea5e9' },
              { label: 'Comp-off',     used: 5,  total: 5,  color: '#9ca3af' },
            ].map(b => {
              const pct = b.total === 0 ? 0 : Math.min(100, (b.used / b.total) * 100);
              return (
                <div key={b.label} className="d-flex align-items-center gap-3 py-1">
                  <span className="fs-13" style={{ width: 110, flexShrink: 0 }}>{b.label}</span>
                  <span
                    className="flex-grow-1 rounded-pill"
                    style={{ height: 6, background: '#f3f4f6', overflow: 'hidden', minWidth: 0 }}
                  >
                    <span
                      className="d-block rounded-pill"
                      style={{ height: '100%', width: `${pct}%`, background: b.color }}
                    />
                  </span>
                  <span className="fw-semibold fs-13 text-muted" style={{ width: 50, textAlign: 'right', flexShrink: 0 }}>
                    {b.used}/{b.total}
                  </span>
                </div>
              );
            })}
            <div className="d-flex align-items-center gap-2 mt-2 pt-2 border-top">
              <span className="text-muted" style={{ fontSize: 12 }}>Impact:</span>
              <span className="rec-pill" style={{ background: tPay.bg, color: tPay.fg }}>{row.payroll}</span>
            </div>
          </div>

          {/* Audit trail */}
          <div className="rec-view-card mt-3">
            <div className="rec-view-label mb-2">Audit Trail</div>
            <ul className="list-unstyled mb-0">
              {chain
                .filter(n => n.decision === 'approved' || n.decision === 'rejected')
                .map((n, i) => {
                  const verb =
                    n.role === 'Self' ? `submitted ${row.type} request (${row.id})`
                    : n.decision === 'approved' && n.role === 'HR' && row.escalationReason === 'manager_rejected' ? 'override-approved (manager had rejected)'
                    : n.decision === 'approved' ? 'approved'
                    : 'rejected';
                  const date = formatDate(n.actionAt || (n.role === 'Self' ? row.appliedOn : ''));
                  return (
                    <li key={i} className="text-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                      {date} — <strong className="text-body">{n.name}</strong> {verb}
                    </li>
                  );
                })}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Read-only view · Use the row actions to approve / reject</span>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" />Close
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalTimelineList — horizontal stepper for the details modal.
//   [Dot] —— [Dot] —— [Dot]
//    You    Manager   HR
//   Name    Name      Name
//   Date    Date      Date
// Uses a CSS grid (3 step columns Ã— auto-sized connector tracks) so the dots
// always sit at fixed positions; connectors take only the leftover space
// between them — no more stretched-out lines or off-centre dots.
// Comments render as a single quote block underneath the row, attributed to
// whichever actor left them, so a long comment doesn't break the alignment.
// ─────────────────────────────────────────────────────────────────────────────
function ApprovalTimelineList({
  chain, reportingManager, appliedOn,
}: {
  chain: ApprovalNode[];
  reportingManager: PersonRef;
  appliedOn: string;
}) {
  // Comments live below the row — one entry per actor that left a note.
  const comments = chain
    .filter(n => !!n.comment)
    .map(n => ({
      role: n.role === 'Self' ? 'Maker' : n.role === 'Manager' ? 'Reporting Manager' : 'HR',
      name: n.name,
      comment: n.comment!,
    }));

  return (
    <div>
      {/* Step row — 3 columns of equal width with dots centred. The
          connector line is painted as a flat ::before pseudo via inline
          style on the rail. */}
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
          const isPending  = n.decision === 'pending';
          const isRejected = n.decision === 'rejected';
          const isSkipped  = n.decision === 'skipped';
          const isLast = i === chain.length - 1;

          const dotBg =
            isApproved ? 'linear-gradient(135deg,#0ab39c,#108548)'
            : isRejected ? 'linear-gradient(135deg,#f06548,#dc2626)'
            : isPending  ? 'linear-gradient(135deg,#f59e0b,#d97706)'
            : isSkipped  ? '#f3f4f6'
            : '#fff';
          const dotColor = isApproved || isRejected || isPending ? '#fff' : '#9ca3af';
          const dotBorder = isSkipped ? '1.5px dashed #d1d5db' : !isApproved && !isRejected && !isPending ? '1.5px solid #e5e7eb' : 'none';
          const dotIcon =
            isApproved ? 'ri-check-line'
            : isRejected ? 'ri-close-line'
            : isSkipped  ? 'ri-subtract-line'
            : isPending  ? 'ri-time-line'
            : n.role === 'Self' ? 'ri-user-3-line'
            : n.role === 'Manager' ? 'ri-user-star-line'
            : 'ri-shield-user-line';

          const role = n.role === 'Self' ? 'You' : n.role === 'Manager' ? 'Manager' : 'HR';
          const dateLabel = formatDate(n.actionAt || (n.role === 'Self' ? appliedOn : ''));

          // Connector colour reflects state of the *current* step.
          const connectorColor =
            isApproved ? '#10b981' : isRejected ? '#dc2626' : '#e5e7eb';

          return (
            <div key={i} className="text-center position-relative" style={{ minWidth: 0, opacity: isSkipped ? 0.6 : 1 }}>
              {/* Connector — sits at dot's vertical centre, painted from the
                  middle of this step's column to the start of the next. The
                  fixed offsets keep it from clipping into the dots. */}
              {!isLast && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 14,            // half the dot height
                    left: 'calc(50% + 16px)',
                    right: 'calc(-50% + 16px)',
                    height: 2,
                    background: connectorColor,
                    zIndex: 0,
                  }}
                />
              )}

              {/* Dot */}
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

              {/* Labels */}
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

      {/* Comment block — one collapsed area below the row. Attributes each
          comment to the actor who left it so HR can read them in context. */}
      {comments.length > 0 && (
        <div className="mt-3 px-3 py-2 rounded" style={{ background: '#f3eeff', border: '1px solid #d8c8ff' }}>
          {comments.map((c, i) => (
            <div key={i} className="text-body" style={{ fontSize: 11.5, marginTop: i > 0 ? 6 : 0 }}>
              <span className="fw-bold" style={{ color: '#5a3fd1' }}>{c.role}</span>
              <span className="text-muted"> · {c.name}: </span>
              <span className="fst-italic">"{c.comment}"</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmActionModal — guard-rail popup for Approve / Reject row actions.
// HR sees the request summary, can leave a comment (mandatory for Reject so
// the audit trail captures *why*), and confirms before the row mutates.
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmActionModal({
  state, onClose, onConfirm,
}: {
  state: { row: LeaveRequest; action: 'approve' | 'reject' } | null;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  // Reset the comment whenever the popup opens so a previous draft doesn't
  // leak between rows.
  useEffect(() => { if (state) setComment(''); }, [state?.row.id, state?.action]);

  if (!state) return null;
  const { row, action } = state;
  const isApprove = action === 'approve';
  const tType = TYPE_TONE[row.type];
  // Reject without a reason is bad for the audit trail; require a comment
  // to flip the confirm button on.
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
              <span className="rec-pill" style={{ background: tType.bg, color: tType.fg }}>{row.type}</span>
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
            className="form-control"
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
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={isApprove ? 'lv-btn-success' : 'lv-btn-danger'}
            onClick={() => onConfirm(comment)}
            disabled={!canConfirm}
          >
            <i className={isApprove ? 'ri-check-line' : 'ri-close-line'} />
            {isApprove ? 'Confirm Approve' : 'Confirm Reject'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionBtn — row-level icon button. Mirrors the helper in HrRecruitment.tsx
// so the leave row-actions share the exact same chrome (rec-act-icon +
// rec-act-tone-*) and disabled handling already defined in recruitment.css.
// ─────────────────────────────────────────────────────────────────────────────
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
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rec-act-icon ${toneClass}`}
    >
      <i className={icon} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChainDots — compact in-row approval-chain renderer.
//   Self → Manager → HR rendered as 3 small connected avatars with a single
//   caption underneath surfacing the latest decision / SLA hint.
//
// Visual states (mirrors the Onboarding-Hub stepper convention):
//   approved  → solid green dot, white check icon, soft green ring
//   rejected  → solid red dot, white close icon, soft red ring
//   pending   → solid amber dot, white initials of the actor on duty
//   skipped   → soft grey dot with dash icon, dimmed (HR-raised case)
//   idle      → outlined grey dot with the ROLE abbreviation in muted text
//               ("HR" when HR isn't yet involved)
// ─────────────────────────────────────────────────────────────────────────────
function ChainDots({ row }: { row: LeaveRequest }) {
  const chain = deriveChain(row);

  // Caption — always reflects the *most recent* signal on the row:
  //   resolved approved → "Approved: <last action date>"
  //   resolved rejected → "Rejected: <last action date>"
  //   pending           → SLA hint stored on the row (e.g., "3d pending")
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
          const isApproved = n.decision === 'approved';
          const isRejected = n.decision === 'rejected';
          const isPending  = n.decision === 'pending';
          const isSkipped  = n.decision === 'skipped';
          const isLast     = i === chain.length - 1;

          // Resolve the dot's visual treatment as a single object so the JSX
          // stays readable. Approved / Rejected / Pending circles all carry
          // the actor's initials so HR sees *who* acted at each step;
          // colour alone conveys the decision. Idle / Skipped fall back to
          // a role abbreviation since there's no actor history yet.
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
            : /* idle */ {
              bg: '#fff', fg: '#9ca3af',
              border: '1.5px solid #e5e7eb',
              shadow: 'none',
              content: (
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>
                  {n.role === 'Self' ? 'YOU' : n.role === 'Manager' ? 'MGR' : 'HR'}
                </span>
              ),
            };

          // Connector colour reflects whether the *current* step is past:
          // green when this step is approved, red when rejected, otherwise grey.
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

