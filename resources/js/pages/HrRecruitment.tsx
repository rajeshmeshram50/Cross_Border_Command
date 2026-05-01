import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Spinner } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type RecruitmentStatus = 'In Progress' | 'Completed' | 'Cancelled';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type WorkMode = 'On-site' | 'Remote' | 'Hybrid' | 'Flexible';
type EmployType = 'Full Time' | 'Part Time' | 'Contract' | 'Internship';

interface RecruitmentRow {
  id: string;            // numeric DB id, stringified — used as the React key
  code: string;          // REC-### shown in the table pill
  jobTitle: string;

  // Display labels (resolved from the backend's eager-loaded relations).
  department: string;
  designation: string;
  primaryRole: string;

  // Backing master IDs — populated from the API so the edit modal can
  // pre-select the dropdowns instead of trying to match by name.
  departmentId: number | null;
  designationId: number | null;
  primaryRoleId: number | null;
  hiringManagerId: number | null;
  assignedHrId: number | null;

  employmentType: EmployType;
  openings: number;
  experience: string;
  workMode: WorkMode;
  ctcRange: string;
  priority: Priority;

  // Manager + HR display fields (avatar initials, accent and label).
  hiringManagerName: string;
  hiringManagerRole: string;
  hiringManagerInitials: string;
  hiringManagerAccent: string;
  assignedHrName: string;
  assignedHrInitials: string;
  assignedHrAccent: string;

  startDate: string;
  deadline: string;

  // Job description + requirements + toggles — pre-filled into the edit modal.
  jobDescription: string;
  requirements: string;
  postOnPortal: boolean;
  notifyTeamLeads: boolean;
  enableReferralBonus: boolean;

  status: RecruitmentStatus;
}

/* ── Backend → UI row converter ──────────────────────────────────────────────
 * The /recruitments API returns snake_case fields with eager-loaded relation
 * objects (department, designation, primaryRole, hiringManager, assignedHr).
 * We flatten that into the RecruitmentRow shape the table + filters expect,
 * synthesising avatar initials/accents from the manager/HR display name.
 */
const ROW_PALETTE = ['#7c5cfc', '#0ab39c', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#f97316', '#ec4899', '#06b6d4'];
function pickAccent(seed: string | number): string {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ROW_PALETTE[h % ROW_PALETTE.length];
}
function initialsOf(name: string): string {
  if (!name) return '–';
  const dashSplit = name.split('–').map((s) => s.trim()).filter(Boolean);
  const display = dashSplit.length > 1 ? dashSplit[1] : name;
  return display
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
function apiToRow(api: any): RecruitmentRow {
  const dept = api?.department?.name || '';
  const desig = api?.designation?.name || '';
  const role = api?.primary_role?.name || '';

  const mgrEmp = api?.hiring_manager;
  const mgrName = mgrEmp?.display_name || [mgrEmp?.first_name, mgrEmp?.last_name].filter(Boolean).join(' ') || '';
  const hrEmp = api?.assigned_hr;
  const hrName = hrEmp?.display_name || [hrEmp?.first_name, hrEmp?.last_name].filter(Boolean).join(' ') || '';

  return {
    id: String(api?.id ?? ''),
    code: api?.code || `REC-${api?.id ?? ''}`,
    jobTitle: api?.job_title || '',

    department: dept,
    designation: desig,
    primaryRole: role,

    departmentId:    api?.department_id ?? null,
    designationId:   api?.designation_id ?? null,
    primaryRoleId:   api?.primary_role_id ?? null,
    hiringManagerId: api?.hiring_manager_id ?? null,
    assignedHrId:    api?.assigned_hr_id ?? null,

    employmentType: (api?.employment_type || 'Full Time') as EmployType,
    openings:       Number(api?.openings) || 1,
    experience:     api?.experience || '',
    workMode:       (api?.work_mode || 'Hybrid') as WorkMode,
    ctcRange:       api?.ctc_range || '',
    priority:       (api?.priority || 'Medium') as Priority,

    hiringManagerName:     mgrName,
    hiringManagerRole:     '', // backend doesn't carry a separate "role" label
    hiringManagerInitials: initialsOf(mgrName),
    hiringManagerAccent:   pickAccent(api?.hiring_manager_id ?? mgrName),
    assignedHrName:        hrName,
    assignedHrInitials:    initialsOf(hrName),
    assignedHrAccent:      pickAccent(api?.assigned_hr_id ?? hrName),

    startDate: api?.start_date || '',
    deadline:  api?.deadline   || '',

    jobDescription:      api?.job_description || '',
    requirements:        api?.requirements    || '',
    postOnPortal:        !!api?.post_on_portal,
    notifyTeamLeads:     !!api?.notify_team_leads,
    enableReferralBonus: !!api?.enable_referral_bonus,

    status: (api?.status || 'In Progress') as RecruitmentStatus,
  };
}

// ── Date formatting helper ─────────────────────────────────────────────────
// Renders dates as "05-Apr-2026" (DD-MMM-YYYY) — used by every date cell in
// the recruitment + hiring-requests tables.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

type RequestStatus = 'Approved' | 'Under Review' | 'Submitted' | 'Sent Back' | 'Draft' | 'Rejected';
type RequestUrgency = 'Low' | 'Medium' | 'High' | 'Critical';
type RequestType =
  | 'New Position'
  | 'Replacement Hiring'
  | 'Intern Requirement'
  | 'Backfill'
  | 'Expansion Hiring'
  | 'Urgent Temporary Support';

interface HiringRequestRow {
  id: string;
  position: string;
  positionType: EmployType | 'Intern';
  positionMode: WorkMode;
  department: string;
  requestedByName: string;
  requestedByInitials: string;
  requestedByAccent: string;
  openings: number;
  requestType: RequestType;
  urgency: RequestUrgency;
  status: RequestStatus;
  requestDate: string;
  targetJoinDate: string;
}

// ── Hiring Requests (mock) ──
const HIRING_REQUESTS: HiringRequestRow[] = [
  { id: 'HRQ-001', position: 'Senior ML Engineer',   positionType: 'Full Time',  positionMode: 'Hybrid',  department: 'Engineering', requestedByName: 'Gaurav Jagtap',  requestedByInitials: 'GJ', requestedByAccent: '#0c63b0', openings: 2, requestType: 'New Position',          urgency: 'High',     status: 'Approved',    requestDate: 'Apr 1, 2026',  targetJoinDate: 'May 15, 2026' },
  { id: 'HRQ-002', position: 'HR Executive',          positionType: 'Full Time',  positionMode: 'On-site', department: 'HR',          requestedByName: 'Priya Mehta',    requestedByInitials: 'PM', requestedByAccent: '#7c5cfc', openings: 1, requestType: 'Replacement Hiring',    urgency: 'Medium',   status: 'Under Review',requestDate: 'Apr 5, 2026',  targetJoinDate: 'May 1, 2026' },
  { id: 'HRQ-003', position: 'React Native Intern',   positionType: 'Intern',     positionMode: 'Hybrid',  department: 'Mobile',      requestedByName: 'Mayur Thorat',   requestedByInitials: 'MT', requestedByAccent: '#0ab39c', openings: 3, requestType: 'Intern Requirement',    urgency: 'Low',      status: 'Submitted',   requestDate: 'Apr 7, 2026',  targetJoinDate: 'Jun 1, 2026' },
  { id: 'HRQ-004', position: 'Finance Analyst',       positionType: 'Full Time',  positionMode: 'On-site', department: 'Finance',     requestedByName: 'Nisha Kapoor',   requestedByInitials: 'NK', requestedByAccent: '#f06548', openings: 1, requestType: 'Backfill',              urgency: 'Critical', status: 'Sent Back',   requestDate: 'Apr 3, 2026',  targetJoinDate: 'Apr 20, 2026' },
  { id: 'HRQ-005', position: 'QA Lead',               positionType: 'Full Time',  positionMode: 'On-site', department: 'Engineering', requestedByName: 'Atharv Patekar', requestedByInitials: 'AP', requestedByAccent: '#0ea5e9', openings: 1, requestType: 'New Position',          urgency: 'High',     status: 'Draft',       requestDate: 'Apr 9, 2026',  targetJoinDate: 'May 10, 2026' },
  { id: 'HRQ-006', position: 'Business Analyst',      positionType: 'Contract',   positionMode: 'Remote',  department: 'Product',     requestedByName: 'Rajesh Meshram', requestedByInitials: 'RM', requestedByAccent: '#e83e8c', openings: 1, requestType: 'Expansion Hiring',      urgency: 'Medium',   status: 'Rejected',    requestDate: 'Mar 28, 2026', targetJoinDate: 'Apr 30, 2026' },
  { id: 'HRQ-007', position: 'DevOps Engineer',       positionType: 'Full Time',  positionMode: 'Hybrid',  department: 'Engineering', requestedByName: 'Atharv Patekar', requestedByInitials: 'AP', requestedByAccent: '#0ea5e9', openings: 1, requestType: 'Urgent Temporary Support', urgency: 'Critical', status: 'Approved',    requestDate: 'Apr 2, 2026',  targetJoinDate: 'Apr 25, 2026' },
];

// ── Lookup palettes ─────────────────────────────────────────────────────────
const PRIORITY_TONES: Record<Priority, { bg: string; fg: string }> = {
  Low:      { bg: '#d1fae5', fg: '#047857' },
  Medium:   { bg: '#fef3c7', fg: '#b45309' },
  High:     { bg: '#fed7aa', fg: '#c2410c' },
  Critical: { bg: '#fce7f3', fg: '#be185d' },
};

const WORK_MODE_TONES: Record<WorkMode, { bg: string; fg: string }> = {
  'On-site':  { bg: '#dbeafe', fg: '#1d4ed8' },
  Remote:     { bg: '#ede9fe', fg: '#6d28d9' },
  Hybrid:     { bg: '#ccfbf1', fg: '#0f766e' },
  Flexible:   { bg: '#fce7f3', fg: '#be185d' },
};

const EMPLOY_TYPE_TONES: Record<EmployType, { bg: string; fg: string }> = {
  'Full Time':  { bg: '#dbeafe', fg: '#1d4ed8' },
  'Part Time':  { bg: '#fed7aa', fg: '#c2410c' },
  Contract:     { bg: '#ccfbf1', fg: '#0f766e' },
  Internship:   { bg: '#fce7f3', fg: '#be185d' },
};

const REQUEST_STATUS_TONES: Record<RequestStatus, { bg: string; fg: string; dot: string }> = {
  Approved:      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Under Review':{ bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  Submitted:     { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Sent Back':   { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  Draft:         { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
  Rejected:      { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
};

const REQUEST_URGENCY_TONES: Record<RequestUrgency, { bg: string; fg: string }> = {
  Low:      { bg: '#d6f4e3', fg: '#108548' },
  Medium:   { bg: '#fde8c4', fg: '#a4661c' },
  High:     { bg: '#fdd9d6', fg: '#b1401d' },
  Critical: { bg: '#fdd9ea', fg: '#a02960' },
};

// ── KPI cards (6 tiles) — same look as master pages: top accent strip,
// label + tabular number on the left, gradient icon tile on the right.
const KPI_CARDS = [
  { key: 'total',       label: 'Total Recruitments', icon: 'ri-briefcase-4-line',     gradient: 'linear-gradient(135deg,#299cdb 0%,#4dabf7 100%)', deep: '#1e6dd6' },
  { key: 'active',      label: 'Active Hiring',      icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
  { key: 'candidates',  label: 'Total Candidates',   icon: 'ri-team-line',            gradient: 'linear-gradient(135deg,#6366f1 0%,#818cf8 100%)', deep: '#4f46e5' },
  { key: 'selected',    label: 'Selected',           icon: 'ri-user-follow-line',     gradient: 'linear-gradient(135deg,#10b981 0%,#34d399 100%)', deep: '#059669' },
  { key: 'rejected',    label: 'Rejected',           icon: 'ri-close-circle-fill',    gradient: 'linear-gradient(135deg,#f06548 0%,#f47c5d 100%)', deep: '#d63a5e' },
  { key: 'pending',     label: 'Pending Interviews', icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b 0%,#fbc763 100%)', deep: '#a4661c' },
] as const;

// ── Filter option lists ────────────────────────────────────────────────────
const DEPARTMENT_FILTER_OPTIONS = [
  { value: 'All',         label: 'All' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Design',      label: 'Design' },
  { value: 'Sales',       label: 'Sales' },
  { value: 'HR',          label: 'HR' },
  { value: 'Finance',     label: 'Finance' },
  { value: 'Marketing',   label: 'Marketing' },
  { value: 'Operations',  label: 'Operations' },
  { value: 'Mobile',      label: 'Mobile' },
  { value: 'Product',     label: 'Product' },
];
const PRIORITY_FILTER_OPTIONS = [
  { value: 'All',      label: 'All' },
  { value: 'Low',      label: 'Low' },
  { value: 'Medium',   label: 'Medium' },
  { value: 'High',     label: 'High' },
  { value: 'Critical', label: 'Critical' },
];
const JOB_TYPE_FILTER_OPTIONS = [
  { value: 'All',         label: 'All' },
  { value: 'Full Time',   label: 'Full Time' },
  { value: 'Part Time',   label: 'Part Time' },
  { value: 'Contract',    label: 'Contract' },
  { value: 'Internship',  label: 'Internship' },
];

// ── Form option lists for Raise Hiring Request modal ───────────────────────
// Department options are now loaded from the Departments master at runtime
// (see RaiseHiringRequestModal / CreateRecruitmentModal). Designation is
// loaded from the Designations master in CreateRecruitmentModal.
const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'Full-time', label: 'Full-time' },
  { value: 'Part-time', label: 'Part-time' },
  { value: 'Contract',  label: 'Contract' },
  { value: 'Intern',    label: 'Intern' },
];
const REQUIRED_EXPERIENCE_OPTIONS = [
  { value: '0-1',  label: '0 – 1 yr (Entry)' },
  { value: '1-3',  label: '1 – 3 yr (Junior)' },
  { value: '3-5',  label: '3 – 5 yr (Mid)' },
  { value: '5-8',  label: '5 – 8 yr (Senior)' },
  { value: '8+',   label: '8+ yr (Lead/Principal)' },
];
const REQUEST_TYPE_OPTIONS = [
  { value: 'New Position',           label: 'New Position' },
  { value: 'Replacement Hiring',     label: 'Replacement Hiring' },
  { value: 'Backfill',               label: 'Backfill' },
  { value: 'Expansion Hiring',       label: 'Expansion Hiring' },
  { value: 'Intern Requirement',     label: 'Intern Requirement' },
  { value: 'Urgent Temporary Support', label: 'Urgent Temporary Support' },
];

// ── Hiring Manager / HR options for Create Recruitment ─────────────────────
const HIRING_MANAGER_OPTIONS = [
  { value: 'CEO – Vishal Rao',           label: 'CEO – Vishal Rao' },
  { value: 'CTO – Arun Gupta',           label: 'CTO – Arun Gupta' },
  { value: 'CFO – Nikhil Mehra',         label: 'CFO – Nikhil Mehra' },
  { value: 'CMO – Ritu Khanna',          label: 'CMO – Ritu Khanna' },
  { value: 'COO – Ritu Khanna',          label: 'COO – Ritu Khanna' },
  { value: 'HR Head – Sneha Chavan',     label: 'HR Head – Sneha Chavan' },
  { value: 'Sales Lead – Priya Iyer',    label: 'Sales Lead – Priya Iyer' },
  { value: 'Design Head – Neha Kulkarni',label: 'Design Head – Neha Kulkarni' },
  { value: 'HOD – Amit Shah',            label: 'HOD – Amit Shah' },
];
const ASSIGNED_HR_OPTIONS = [
  { value: 'Sneha Chavan', label: 'Sneha Chavan' },
  { value: 'Pooja Mehta',  label: 'Pooja Mehta' },
  { value: 'Rahul Verma',  label: 'Rahul Verma' },
  { value: 'Anjali Rao',   label: 'Anjali Rao' },
  { value: 'Karan Singh',  label: 'Karan Singh' },
];
const WORK_MODE_OPTIONS = [
  { value: 'On-site',  label: 'On-site' },
  { value: 'Remote',   label: 'Remote' },
  { value: 'Hybrid',   label: 'Hybrid' },
  { value: 'Flexible', label: 'Flexible' },
];
const REC_EMPLOYMENT_OPTIONS = [
  { value: 'Full Time',  label: 'Full Time' },
  { value: 'Part Time',  label: 'Part Time' },
  { value: 'Contract',   label: 'Contract' },
  { value: 'Internship', label: 'Internship' },
];
// Priority is rendered as colored pill buttons (High / Medium / Low) inside
// CreateRecruitmentModal — no dropdown options needed here.

// ── Page ────────────────────────────────────────────────────────────────────
export default function HrRecruitment() {
  const toast = useToast();
  const navigate = useNavigate();

  // List state — fetched from /api/recruitments and kept in local state so
  // creates / updates / cancels reflect instantly.
  const [recruitments, setRecruitments] = useState<RecruitmentRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [tab, setTab] = useState<RecruitmentStatus>('In Progress');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [jobTypeFilter, setJobTypeFilter]   = useState<string>('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when tab / filters change
  useEffect(() => { setPage(1); }, [tab, q, deptFilter, priorityFilter, jobTypeFilter]);

  // Initial load — pull all recruitments from the backend and convert each
  // row into the UI shape (label-resolved + initials + accent).
  const fetchRecruitments = async () => {
    try {
      setLoadingList(true);
      const { data } = await api.get('/recruitments');
      const rows: any[] = Array.isArray(data) ? data : [];
      setRecruitments(rows.map(apiToRow));
    } catch (err: any) {
      toast.error('Could not load recruitments', err?.response?.data?.message || 'Please try again.');
      setRecruitments([]);
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { fetchRecruitments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Counts — derived from the fetched list so KPI badges update on every change.
  // Candidate-based KPIs (candidates/selected/rejected/pending) will be wired
  // up once the candidate pipeline is built; for now they reflect the actual
  // current data, which is 0.
  const counts = useMemo(() => {
    const total = recruitments.length;
    const inProgress = recruitments.filter(r => r.status === 'In Progress').length;
    const completed  = recruitments.filter(r => r.status === 'Completed').length;
    const cancelled  = recruitments.filter(r => r.status === 'Cancelled').length;
    // Sum openings across active recruitments — gives a meaningful "total
    // open positions" number until candidates are tracked.
    const openings = recruitments
      .filter(r => r.status === 'In Progress')
      .reduce((sum, r) => sum + (Number(r.openings) || 0), 0);
    return {
      total,
      active: inProgress,
      candidates: 0,
      selected: 0,
      rejected: 0,
      pending: openings,
      tabs: { 'In Progress': inProgress, Completed: completed, Cancelled: cancelled },
    };
  }, [recruitments]);

  // Filtered rows
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recruitments.filter(r => r.status === tab)
      .filter(r => deptFilter === 'All' || r.department === deptFilter)
      .filter(r => priorityFilter === 'All' || r.priority === priorityFilter)
      .filter(r => jobTypeFilter === 'All' || r.employmentType === jobTypeFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          String(r.id).toLowerCase().includes(needle) ||
          (r.code || '').toLowerCase().includes(needle) ||
          r.jobTitle.toLowerCase().includes(needle) ||
          (r.department || '').toLowerCase().includes(needle) ||
          (r.assignedHrName || '').toLowerCase().includes(needle) ||
          (r.hiringManagerName || '').toLowerCase().includes(needle)
        );
      });
  }, [recruitments, tab, q, deptFilter, priorityFilter, jobTypeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);

  // ── Modal switches ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]                 = useState(false);
  const [createMode, setCreateMode]                 = useState<'add' | 'edit'>('add');
  const [createEditingId, setCreateEditingId]       = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen]                   = useState(false);
  const [requestsOpen, setRequestsOpen]             = useState(false);
  const [cancelTarget, setCancelTarget]             = useState<RecruitmentRow | null>(null);
  const [candidatesTarget, setCandidatesTarget]     = useState<RecruitmentRow | null>(null);

  // Pagination helpers
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  return (
    <>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* ── Header ── */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-2">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0 position-relative"
                  style={{
                    width: 48, height: 48,
                    background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 60%, #7c3aed 100%)',
                    boxShadow:
                      '0 8px 18px rgba(147,51,234,0.38), 0 2px 4px rgba(124,58,237,0.22), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(0,0,0,0.10)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 45%)',
                      pointerEvents: 'none',
                    }}
                  />
                  <i
                    className="ri-briefcase-4-fill"
                    style={{ color: '#fff', fontSize: 24, position: 'relative', lineHeight: 1 }}
                  />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Recruitment Management</h5>
                    <span className="rec-header-count">
                      <span className="dot" />
                      {recruitments.length} recruitment{recruitments.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Create recruitments, track candidates, and manage the end-to-end hiring pipeline
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => { setCreateMode('add'); setCreateEditingId(null); setCreateOpen(true); }}
                >
                  <i className="ri-add-line" />Create Recruitment
                </button>
                <button
                  type="button"
                  className="rec-btn-soft"
                  onClick={() => setRaiseOpen(true)}
                >
                  <i className="ri-file-add-line" />Raise Hiring Request
                </button>
                <button
                  type="button"
                  className="rec-btn-ghost"
                  onClick={() => setRequestsOpen(true)}
                >
                  <i className="ri-eye-line" />View Hiring Requests
                </button>
              </div>
            </div>

            {/* ── KPI cards (6 tiles) — master-style with top accent strip ── */}
            <Row className="g-3 mb-2 align-items-stretch rec-page-kpis">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
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

            {/* ── Tabs (In Progress / Completed / Cancelled) — segmented control ── */}
            <div className="rec-tab-track mb-2">
              {([
                { key: 'In Progress' as const, label: 'In Progress', count: counts.tabs['In Progress'], icon: 'ri-time-line',           variant: 'in-progress' },
                { key: 'Completed'   as const, label: 'Completed',   count: counts.tabs.Completed,     icon: 'ri-checkbox-circle-line',variant: 'completed'   },
                { key: 'Cancelled'   as const, label: 'Cancelled',   count: counts.tabs.Cancelled,     icon: 'ri-close-circle-line',   variant: 'cancelled'   },
              ]).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rec-tab ${tab === t.key ? `is-active ${t.variant}` : ''}`}
                >
                  <i className={t.icon} />
                  {t.label}
                  <span className="badge">{t.count}</span>
                </button>
              ))}
            </div>

            {/* ── Search + Filters + Table — inside ONE card frame ── */}
            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input
                        type="text"
                        className="form-control"
                        placeholder="Search ID, job title, HR…"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                      />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Department</span>
                    <div style={{ minWidth: 150 }}>
                      <MasterSelect value={deptFilter} onChange={setDeptFilter} options={DEPARTMENT_FILTER_OPTIONS} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Priority</span>
                    <div style={{ minWidth: 130 }}>
                      <MasterSelect value={priorityFilter} onChange={setPriorityFilter} options={PRIORITY_FILTER_OPTIONS} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Job Type</span>
                    <div style={{ minWidth: 140 }}>
                      <MasterSelect value={jobTypeFilter} onChange={setJobTypeFilter} options={JOB_TYPE_FILTER_OPTIONS} placeholder="All" />
                    </div>
                    <span className="cand-result-chip ms-auto">
                      <i className="ri-filter-3-line" />
                      {filtered.length} result{filtered.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="rec-list-scroll">
                  <table className="rec-list-table align-middle table-nowrap mb-0">
                    <thead>
                      <tr>
                        <th scope="col" className="ps-3 text-center" style={{ width: 50 }}>SR.</th>
                        <th scope="col" style={{ width: 90 }}>REC ID</th>
                        <th scope="col">Job Title</th>
                        <th scope="col" style={{ width: 110 }}>Department</th>
                        <th scope="col" style={{ width: 130 }}>Designation</th>
                        <th scope="col" style={{ width: 110 }}>Employment</th>
                        <th scope="col" className="text-center" style={{ width: 80 }}>Openings</th>
                        <th scope="col" className="text-center" style={{ width: 100 }}>Experience</th>
                        <th scope="col" style={{ width: 100 }}>Work Mode</th>
                        <th scope="col" style={{ width: 90 }}>Priority</th>
                        <th scope="col">Hiring Manager</th>
                        <th scope="col">Assigned HR</th>
                        <th scope="col" style={{ width: 110 }}>Start Date</th>
                        <th scope="col" style={{ width: 120 }}>Deadline</th>
                        <th scope="col" className="text-center pe-3" style={{ width: 110 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 ? (
                        <tr>
                          <td colSpan={15} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No recruitments match your filters
                          </td>
                        </tr>
                      ) : visible.map((r, idx) => {
                        const pri = PRIORITY_TONES[r.priority];
                        const wm  = WORK_MODE_TONES[r.workMode];
                        const et  = EMPLOY_TYPE_TONES[r.employmentType];
                        return (
                          <tr key={r.id}>
                            <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                            <td><span className="rec-id-pill">{r.code || r.id}</span></td>
                            <td className="fw-bold fs-13" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{r.jobTitle}</td>
                            <td className="fs-13">{r.department}</td>
                            <td className="fs-13">{r.designation}</td>
                            <td>
                              <span className="rec-pill" style={{ background: et.bg, color: et.fg }}>
                                {r.employmentType}
                              </span>
                            </td>
                            <td className="text-center"><span className="rec-num">{r.openings}</span></td>
                            <td className="fs-13 text-center"><span className="text-muted">{r.experience}</span></td>
                            <td><span className="rec-pill" style={{ background: wm.bg, color: wm.fg }}>{r.workMode}</span></td>
                            <td><span className="rec-pill" style={{ background: pri.bg, color: pri.fg }}>{r.priority}</span></td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.hiringManagerAccent}, ${r.hiringManagerAccent}cc)` }}
                                >
                                  {r.hiringManagerInitials}
                                </div>
                                <span className="fs-13">{r.hiringManagerRole ? `${r.hiringManagerRole} – ` : ''}{r.hiringManagerName}</span>
                              </div>
                            </td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.assignedHrAccent}, ${r.assignedHrAccent}cc)` }}
                                >
                                  {r.assignedHrInitials}
                                </div>
                                <span className="fs-13">{r.assignedHrName}</span>
                              </div>
                            </td>
                            <td className="fs-13"><span className="rec-date">{formatDate(r.startDate)}</span></td>
                            <td className="fs-13"><span className="rec-date">{formatDate(r.deadline)}</span></td>
                            <td className="pe-3">
                              <div className="d-flex gap-1 justify-content-center align-items-center">
                                <ActionBtn
                                  title="Edit Recruitment"
                                  icon="ri-pencil-line"
                                  color="info"
                                  onClick={() => { setCreateMode('edit'); setCreateEditingId(r.id); setCreateOpen(true); }}
                                />
                                <ActionBtn
                                  title="View Candidates"
                                  icon="ri-team-line"
                                  color="primary"
                                  onClick={() => navigate(`/hr/recruitment/${r.id}/candidates`)}
                                />
                                <ActionBtn
                                  title={r.status === 'Cancelled' ? 'Already Cancelled' : 'Cancel Recruitment'}
                                  icon="ri-close-circle-line"
                                  color="danger"
                                  disabled={r.status === 'Cancelled'}
                                  onClick={() => setCancelTarget(r)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>

                  {/* Pagination footer — sits inside the same elevated frame */}
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
                      <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>
                        ‹ Prev
                      </button>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <button
                          key={i}
                          className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                          onClick={() => goto(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>
                        Next ›
                      </button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {/* ── Modals ── */}
      <RaiseHiringRequestModal
        isOpen={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        onSubmit={(asDraft) => {
          setRaiseOpen(false);
          if (asDraft) toast.success('Saved as draft', 'Hiring request saved to drafts.');
          else toast.success('Hiring request submitted', 'HR will review your request shortly.');
        }}
      />

      <HiringRequestsListModal
        isOpen={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onRaiseNew={() => { setRequestsOpen(false); setRaiseOpen(true); }}
        onCreateRecruitment={() => {
          // Close the Hiring Requests modal and open Create Recruitment.
          // (The form's defaults can be wired in a follow-up to pre-fill from
          // the request's department/position/openings, etc.)
          setRequestsOpen(false);
          setCreateMode('add');
          setCreateEditingId(null);
          setCreateOpen(true);
        }}
      />

      <CreateRecruitmentModal
        isOpen={createOpen}
        mode={createMode}
        editingId={createEditingId}
        recruitments={recruitments}
        onClose={() => setCreateOpen(false)}
        onSaved={(row) => {
          setRecruitments(prev => {
            const idx = prev.findIndex(r => String(r.id) === String(row.id));
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [row, ...prev];
          });
          setCreateOpen(false);
        }}
      />

      <CancelConfirmModal
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason, notes) => {
          if (!cancelTarget) return;
          try {
            // Backend exposes a single PUT for updates — we flip status to
            // Cancelled and stash the reason/notes alongside for audit.
            const { data } = await api.put(`/recruitments/${cancelTarget.id}`, {
              status: 'Cancelled',
              cancel_reason: reason,
              cancel_notes:  notes || null,
            });
            const row = apiToRow(data);
            setRecruitments(prev => prev.map(r => String(r.id) === String(row.id) ? row : r));
            toast.success('Recruitment cancelled', `${row.code || row.id} has been moved to Cancelled.`);
          } catch (err: any) {
            toast.error('Could not cancel', err?.response?.data?.message || 'Please try again.');
          } finally {
            setCancelTarget(null);
          }
        }}
      />

      <CandidatesPlaceholderModal
        target={candidatesTarget}
        onClose={() => setCandidatesTarget(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Raise Hiring Request — 4-section modal
// ─────────────────────────────────────────────────────────────────────────────

interface RaiseHiringRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (asDraft: boolean) => void;
}

function RaiseHiringRequestModal({ isOpen, onClose, onSubmit }: RaiseHiringRequestModalProps) {
  const toast = useToast();

  // Department options pulled from the Departments master so the dropdown
  // mirrors what's actually configured in Master → Departments.
  const [deptOptions, setDeptOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/master/departments');
        if (cancelled) return;
        const rows: any[] = Array.isArray(data) ? data : [];
        setDeptOptions(
          rows
            .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
            .map(r => ({ value: r.name, label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch {
        if (!cancelled) setDeptOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Section 1 — Basics
  const [title, setTitle]           = useState('');
  const [jobRole, setJobRole]       = useState('');
  const [department, setDepartment] = useState('');
  const [team, setTeam]             = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [reqDate, setReqDate]       = useState(today);

  // Section 2 — Hiring Need
  const [openings, setOpenings]         = useState('1');
  const [employType, setEmployType]     = useState('Full-time');
  const [workMode, setWorkMode]         = useState<'Onsite' | 'Remote' | 'Hybrid' | 'Flexible'>('Onsite');
  const [urgency, setUrgency]           = useState<RequestUrgency>('Medium');

  // Section 3 — Role Details
  const [jobDesc, setJobDesc]                 = useState('');
  const [dailyResp, setDailyResp]             = useState('');
  const [requiredSkills, setRequiredSkills]   = useState('');
  const [requiredExp, setRequiredExp]         = useState('');
  const [requiredQual, setRequiredQual]       = useState('');
  const [preferred, setPreferred]             = useState('');

  // Section 4 — Business Justification
  const [needReason, setNeedReason]       = useState('');
  const [requestType, setRequestType]     = useState<RequestType>('New Position');
  const [businessJust, setBusinessJust]   = useState('');
  const [teamGap, setTeamGap]             = useState('');
  const [whatIfNot, setWhatIfNot]         = useState('');

  // Errors
  type RaiseErrors = Partial<Record<
    'title' | 'jobRole' | 'department' | 'openings' | 'employType' | 'workMode' | 'urgency'
    | 'jobDesc' | 'requiredSkills' | 'requiredExp' | 'needReason' | 'requestType' | 'businessJust',
    string
  >>;
  const [errors, setErrors] = useState<RaiseErrors>({});

  // Reset when reopened
  useEffect(() => {
    if (!isOpen) return;
    setTitle(''); setJobRole(''); setDepartment(''); setTeam(''); setRequestedBy(''); setReqDate(today);
    setOpenings('1'); setEmployType('Full-time'); setWorkMode('Onsite'); setUrgency('Medium');
    setJobDesc(''); setDailyResp(''); setRequiredSkills(''); setRequiredExp(''); setRequiredQual(''); setPreferred('');
    setNeedReason(''); setRequestType('New Position'); setBusinessJust(''); setTeamGap(''); setWhatIfNot('');
    setErrors({});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof RaiseErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): RaiseErrors => {
    const e: RaiseErrors = {};
    if (!title.trim())          e.title          = 'Request title is required';
    if (!jobRole.trim())        e.jobRole        = 'Job role is required';
    if (!department)            e.department     = 'Department is required';
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Openings must be at least 1';
    if (!employType)            e.employType     = 'Employment type is required';
    if (!workMode)              e.workMode       = 'Work mode is required';
    if (!urgency)               e.urgency        = 'Urgency is required';
    if (!jobDesc.trim())        e.jobDesc        = 'Job description is required';
    if (!requiredSkills.trim()) e.requiredSkills = 'Required skills are required';
    if (!requiredExp)           e.requiredExp    = 'Required experience is required';
    if (!needReason.trim())     e.needReason     = 'Hiring need reason is required';
    if (!requestType)           e.requestType    = 'Request type is required';
    if (!businessJust.trim())   e.businessJust   = 'Business justification is required';
    return e;
  };

  const handleSubmit = (asDraft: boolean) => {
    if (!asDraft) {
      const errs = validate();
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        toast.error('Please complete required fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need attention.`);
        return;
      }
    }
    onSubmit(asDraft);
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal rec-form-modal-navy" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header — dark navy gradient (matches the Assign Assets reference) */}
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <i className="ri-file-add-line" style={{ fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>Raise Hiring Request</h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Internal workforce demand · Reviewed by HR before job posting
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* Body — all 4 sections live inside a single gradient-accented card
            so they read as one cohesive form (matching Create Recruitment). */}
        <div className="rec-form-body">
          <div className="rec-form-card">
          {/* Section 1 — Basics */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#5b3fd1 0%,#7c5cfc 50%,#a78bfa 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(124,92,252,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-calendar-event-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 1 · Request Basics</p>
                <p className="rec-form-section-sub">Core identification of the hiring request</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={4}>
                <label className="rec-form-label">Request Title<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.title ? ' is-invalid' : ''}`}
                  placeholder="e.g. Senior ML Engineer for AI Team"
                  value={title}
                  onChange={e => { setTitle(e.target.value); clear('title'); }}
                />
                {errors.title && <div className="rec-error"><i className="ri-error-warning-line" />{errors.title}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Job Role / Position Name<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.jobRole ? ' is-invalid' : ''}`}
                  placeholder="e.g. DevOps Engineer"
                  value={jobRole}
                  onChange={e => { setJobRole(e.target.value); clear('jobRole'); }}
                />
                {errors.jobRole && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobRole}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Department<span className="req">*</span></label>
                <MasterSelect
                  value={department}
                  onChange={(v) => { setDepartment(v); clear('department'); }}
                  options={deptOptions}
                  placeholder={deptOptions.length === 0 ? 'Loading…' : 'Select Department'}
                  invalid={!!errors.department}
                />
                {errors.department && <div className="rec-error"><i className="ri-error-warning-line" />{errors.department}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Team / Sub-Department</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. AI/ML, Infrastructure"
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                />
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Requested By</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="Your Name (Role)"
                  value={requestedBy}
                  onChange={e => setRequestedBy(e.target.value)}
                />
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Request Date</label>
                <MasterDatePicker
                  value={reqDate}
                  onChange={setReqDate}
                  placeholder="dd-mm-yyyy"
                />
              </Col>
            </Row>
          </div>

          {/* Section 2 — Hiring Need */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#0c63b0 0%,#3b82f6 50%,#60a5fa 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-time-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 2 · Hiring Need</p>
                <p className="rec-form-section-sub">Openings, type, mode and urgency</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={4}>
                <label className="rec-form-label">No. of Openings<span className="req">*</span></label>
                <input
                  type="number"
                  min={1}
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={8}>
                <label className="rec-form-label">Employment Type<span className="req">*</span></label>
                <MasterSelect
                  value={employType}
                  onChange={(v) => { setEmployType(v); clear('employType'); }}
                  options={EMPLOYMENT_TYPE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.employType}
                />
                {errors.employType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.employType}</div>}
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Work Mode<span className="req">*</span></label>
                <div className="rec-mode-grid">
                  {([
                    { val: 'Onsite',   icon: 'ri-building-line',     variant: 'onsite'   },
                    { val: 'Remote',   icon: 'ri-globe-line',        variant: 'remote'   },
                    { val: 'Hybrid',   icon: 'ri-flashlight-line',   variant: 'hybrid'   },
                    { val: 'Flexible', icon: 'ri-shuffle-line',      variant: 'flexible' },
                  ] as const).map(m => (
                    <button
                      key={m.val}
                      type="button"
                      className={`rec-mode-btn${workMode === m.val ? ` is-active ${m.variant}` : ''}`}
                      onClick={() => { setWorkMode(m.val); clear('workMode'); }}
                    >
                      <i className={m.icon} />
                      {m.val}
                    </button>
                  ))}
                </div>
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Urgency Level<span className="req">*</span></label>
                <div className="rec-urgency-row">
                  {(['Low', 'Medium', 'High', 'Critical'] as RequestUrgency[]).map(u => {
                    const tone = REQUEST_URGENCY_TONES[u];
                    const active = urgency === u;
                    return (
                      <button
                        key={u}
                        type="button"
                        className={`rec-urgency${active ? ' is-active' : ''}`}
                        style={{
                          background: active ? tone.bg : '#fff',
                          color: tone.fg,
                          borderColor: active ? tone.fg : '#e5e7eb',
                        }}
                        onClick={() => { setUrgency(u); clear('urgency'); }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.fg }} />
                        {u}
                      </button>
                    );
                  })}
                </div>
              </Col>
            </Row>
          </div>

          {/* Section 3 — Role Details */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#a4661c 0%,#f59e0b 50%,#fbbf24 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-team-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 3 · Role Details</p>
                <p className="rec-form-section-sub">Job description, skills and qualifications</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={6}>
                <label className="rec-form-label">Job Description<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.jobDesc ? ' is-invalid' : ''}`}
                  placeholder="Key responsibilities and scope of work…"
                  value={jobDesc}
                  onChange={e => { setJobDesc(e.target.value); clear('jobDesc'); }}
                />
                {errors.jobDesc && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobDesc}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Daily Responsibilities</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Day-to-day tasks and deliverables…"
                  value={dailyResp}
                  onChange={e => setDailyResp(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Required Skills<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.requiredSkills ? ' is-invalid' : ''}`}
                  placeholder="e.g. React, Node.js, AWS"
                  value={requiredSkills}
                  onChange={e => { setRequiredSkills(e.target.value); clear('requiredSkills'); }}
                />
                {errors.requiredSkills && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requiredSkills}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Required Experience<span className="req">*</span></label>
                <MasterSelect
                  value={requiredExp}
                  onChange={(v) => { setRequiredExp(v); clear('requiredExp'); }}
                  options={REQUIRED_EXPERIENCE_OPTIONS}
                  placeholder="Select Experience"
                  invalid={!!errors.requiredExp}
                />
                {errors.requiredExp && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requiredExp}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Required Qualification</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. B.Tech, MBA"
                  value={requiredQual}
                  onChange={e => setRequiredQual(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Preferred Candidate Profile</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="Ideal candidate background…"
                  value={preferred}
                  onChange={e => setPreferred(e.target.value)}
                />
              </Col>
            </Row>
          </div>

          {/* Section 4 — Business Justification */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#b1401d 0%,#ef4444 50%,#f87171 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(239,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-flashlight-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 4 · Business Justification</p>
                <p className="rec-form-section-sub">Why this hire is needed now</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={4}>
                <label className="rec-form-label">Request Type<span className="req">*</span></label>
                <MasterSelect
                  value={requestType}
                  onChange={(v) => { setRequestType(v as RequestType); clear('requestType'); }}
                  options={REQUEST_TYPE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.requestType}
                />
                {errors.requestType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requestType}</div>}
              </Col>
              <Col md={8}>
                <label className="rec-form-label">Business Justification<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.businessJust ? ' is-invalid' : ''}`}
                  placeholder="Business impact and value of this hire…"
                  value={businessJust}
                  onChange={e => { setBusinessJust(e.target.value); clear('businessJust'); }}
                />
                {errors.businessJust && <div className="rec-error"><i className="ri-error-warning-line" />{errors.businessJust}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Hiring Need Reason<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.needReason ? ' is-invalid' : ''}`}
                  placeholder="Why is this position needed now?…"
                  value={needReason}
                  onChange={e => { setNeedReason(e.target.value); clear('needReason'); }}
                />
                {errors.needReason && <div className="rec-error"><i className="ri-error-warning-line" />{errors.needReason}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Current Team Gap</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Describe the current gap or overload…"
                  value={teamGap}
                  onChange={e => setTeamGap(e.target.value)}
                />
              </Col>
              <Col md={4}>
                <label className="rec-form-label">What If Not Filled?</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Consequence of not hiring…"
                  value={whatIfNot}
                  onChange={e => setWhatIfNot(e.target.value)}
                />
              </Col>
            </Row>
          </div>
          </div>
          {/* /rec-form-card */}
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)}>
              <i className="ri-save-3-line" />Save as Draft
            </button>
            <button type="button" className="rec-btn-primary" onClick={() => handleSubmit(false)}>
              <i className="ri-send-plane-line" />Submit to HR <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hiring Requests — list modal
// ─────────────────────────────────────────────────────────────────────────────

interface HiringRequestsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRaiseNew: () => void;
  onCreateRecruitment: (req: HiringRequestRow) => void;
}

function HiringRequestsListModal({ isOpen, onClose, onRaiseNew, onCreateRecruitment }: HiringRequestsListModalProps) {
  const [statusFilter, setStatusFilter]   = useState<string>('All');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('All');
  const [q, setQ] = useState('');

  // Pagination — 5 rows per page by default; configurable via dropdown.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Local copy of requests so action buttons (Approve / Reject / Send Back /
  // Job Post) can mutate status optimistically. Resets when modal opens so a
  // fresh view always reflects the latest mock data.
  const [requests, setRequests] = useState<HiringRequestRow[]>(HIRING_REQUESTS);
  useEffect(() => { if (isOpen) setRequests([...HIRING_REQUESTS]); }, [isOpen]);

  // Detail-view sub-modal (when "View" is clicked on a row).
  const [viewing, setViewing] = useState<HiringRequestRow | null>(null);

  useEffect(() => { if (!isOpen) { setStatusFilter('All'); setUrgencyFilter('All'); setQ(''); setViewing(null); setPage(1); } }, [isOpen]);
  // Reset to page 1 whenever filters or search change so the user never
  // ends up on an empty page after narrowing the result set.
  useEffect(() => { setPage(1); }, [statusFilter, urgencyFilter, q]);

  const stats = useMemo(() => {
    const total       = requests.length;
    const underReview = requests.filter(r => r.status === 'Under Review').length;
    const approved    = requests.filter(r => r.status === 'Approved').length;
    const critical    = requests.filter(r => r.urgency === 'Critical').length;
    const sentBack    = requests.filter(r => r.status === 'Sent Back').length;
    return { total, underReview, approved, critical, sentBack };
  }, [requests]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return requests
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => urgencyFilter === 'All' || r.urgency === urgencyFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.id.toLowerCase().includes(needle) ||
          r.position.toLowerCase().includes(needle) ||
          r.department.toLowerCase().includes(needle) ||
          r.requestedByName.toLowerCase().includes(needle)
        );
      });
  }, [requests, statusFilter, urgencyFilter, q]);

  // Derive page slice — clamp `page` so a stale value can't land us past
  // the end of the list when filters shrink the result set.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  // requests state used to drive optimistic status changes; status-mutator
  // handlers were removed when the action column shrank to View + Create
  // Recruitment. Bring them back if approve / reject / send-back UI returns.

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-req-modal" contentClassName="rec-req-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header */}
        <div className="rec-req-header">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className="ri-file-list-3-line" style={{ fontSize: 22 }} />
            </span>
            <div>
              <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18 }}>Hiring Requests</h5>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                Internal workforce demand · Reviewed by HR before job posting
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              onClick={onRaiseNew}
              className="rec-req-raise-btn d-inline-flex align-items-center gap-2"
            >
              <i className="ri-add-line" />Raise New Request
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {/* KPI strip — premium vivid gradient palette per status */}
        <div className="rec-req-stats">
          {[
            { label: 'Total',        value: stats.total,       icon: 'ri-file-list-3-line',     accent: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
            { label: 'Under Review', value: stats.underReview, icon: 'ri-time-line',            accent: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 60%, #a855f7 100%)', deep: '#7c3aed' },
            { label: 'Approved',     value: stats.approved,    icon: 'ri-checkbox-circle-line', accent: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
            { label: 'Critical',     value: stats.critical,    icon: 'ri-flashlight-line',      accent: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
            { label: 'Sent Back',    value: stats.sentBack,    icon: 'ri-arrow-go-back-line',   accent: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
          ].map(k => (
            <div className="rec-kpi-card" key={k.label}>
              <span className="rec-kpi-strip" style={{ background: k.accent }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">{k.label}</span>
                <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value.toLocaleString()}</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: k.accent }}>
                <i className={k.icon} />
              </span>
            </div>
          ))}
        </div>

        {/* Filter row */}
        <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
          <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220, maxWidth: 380 }}>
            <Input
              type="text"
              className="form-control"
              placeholder="Search requests…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <i className="ri-search-line search-icon"></i>
          </div>
          <div style={{ width: 130 }}>
            <MasterSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'All',          label: 'All Status' },
                { value: 'Approved',     label: 'Approved' },
                { value: 'Under Review', label: 'Under Review' },
                { value: 'Submitted',    label: 'Submitted' },
                { value: 'Sent Back',    label: 'Sent Back' },
                { value: 'Draft',        label: 'Draft' },
                { value: 'Rejected',     label: 'Rejected' },
              ]}
              placeholder="All Status"
            />
          </div>
          <div style={{ width: 130 }}>
            <MasterSelect
              value={urgencyFilter}
              onChange={setUrgencyFilter}
              options={[
                { value: 'All',      label: 'All Urgency' },
                { value: 'Low',      label: 'Low' },
                { value: 'Medium',   label: 'Medium' },
                { value: 'High',     label: 'High' },
                { value: 'Critical', label: 'Critical' },
              ]}
              placeholder="All Urgency"
            />
          </div>
        </div>

        {/* List — minHeight pinned so the modal keeps the same overall
            footprint whether the current page shows 5 rows or fewer. */}
        <div
          className="rec-req-table-wrap"
          style={{ maxHeight: '50vh', minHeight: 'calc(48px + 56px * 5)', overflowY: 'auto' }}
        >
          <table className="rec-req-table table align-middle table-nowrap mb-0">
            <thead>
              <tr>
                <th className="ps-4">REQ ID</th>
                <th>Position</th>
                <th>Department</th>
                <th>Requested By</th>
                <th className="text-center">Openings</th>
                <th>Request Type</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Req Date</th>
                <th>Target Join</th>
                <th className="pe-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-5 text-muted">
                    <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                    No requests match your filters
                  </td>
                </tr>
              ) : visible.map(r => {
                const u = REQUEST_URGENCY_TONES[r.urgency];
                const s = REQUEST_STATUS_TONES[r.status];
                return (
                  <tr key={r.id}>
                    <td className="ps-4"><span className="rec-id-pill">{r.id}</span></td>
                    <td>
                      <span className="fw-bold fs-13">{r.position}</span>
                      <span className="rec-mini-chip" style={{ background: '#eef2f6', color: '#475569' }}>{r.positionType}</span>
                      <span
                        className="rec-mini-chip"
                        style={{
                          background: WORK_MODE_TONES[r.positionMode]?.bg || '#eef2f6',
                          color: WORK_MODE_TONES[r.positionMode]?.fg || '#475569',
                        }}
                      >
                        {r.positionMode}
                      </span>
                    </td>
                    <td className="fs-13">{r.department}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                          style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.requestedByAccent}, ${r.requestedByAccent}cc)` }}
                        >
                          {r.requestedByInitials}
                        </div>
                        <span className="fs-13">{r.requestedByName}</span>
                      </div>
                    </td>
                    <td className="text-center"><span className="rec-num">{r.openings}</span></td>
                    <td className="fs-13">{r.requestType}</td>
                    <td><span className="rec-pill" style={{ background: u.bg, color: u.fg }}>{r.urgency}</span></td>
                    <td>
                      <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: s.bg, color: s.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                        {r.status}
                      </span>
                    </td>
                    <td className="fs-13"><span className="rec-date">{formatDate(r.requestDate)}</span></td>
                    <td className="fs-13"><span className="rec-date">{formatDate(r.targetJoinDate)}</span></td>
                    <td className="pe-4">
                      <div className="rec-row-actions">
                        <button
                          type="button"
                          className="rec-act rec-act-view rec-act--icon"
                          onClick={() => setViewing(r)}
                          title="View"
                          aria-label="View"
                        >
                          <i className="ri-eye-line" />
                        </button>
                        <button
                          type="button"
                          className="rec-act rec-act-create rec-act--icon"
                          onClick={() => onCreateRecruitment(r)}
                          title="Create Recruitment"
                          aria-label="Create Recruitment"
                        >
                          <i className="ri-user-search-line" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination — 5 rows per page by default; configurable */}
        <div className="rec-list-footer">
          <div className="d-flex align-items-center gap-2">
            <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
            <div style={{ width: 80 }}>
              <MasterSelect
                value={String(pageSize)}
                onChange={(v) => { setPageSize(Number(v) || 5); setPage(1); }}
                options={['5', '10', '25', '50'].map(v => ({ value: v, label: v }))}
                placeholder="5"
              />
            </div>
            <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
              Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
            </span>
          </div>
          <div className="d-flex align-items-center gap-1">
            <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>
              ‹ Prev
            </button>
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                onClick={() => goto(i + 1)}
              >
                {i + 1}
              </button>
            ))}
            <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>
              Next ›
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Status changes are applied immediately and visible to all HR users</span>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" />Close
          </button>
        </div>
      </ModalBody>

      {/* View detail sub-modal — shows full request details when "View" clicked */}
      <ViewHiringRequestModal request={viewing} onClose={() => setViewing(null)} />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View Hiring Request — read-only detail modal
// ─────────────────────────────────────────────────────────────────────────────

function ViewHiringRequestModal({ request, onClose }: { request: HiringRequestRow | null; onClose: () => void }) {
  if (!request) return null;
  const r = request;
  const u = REQUEST_URGENCY_TONES[r.urgency];
  const s = REQUEST_STATUS_TONES[r.status];
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="rec-view-field">
      <div className="rec-view-label">{label}</div>
      <div className="rec-view-value">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
  return (
    <Modal isOpen={!!request} toggle={onClose} centered size="lg" backdrop="static" contentClassName="rec-view-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-eye-line" style={{ fontSize: 18 }} />
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  {r.position} <span style={{ opacity: 0.8 }}>· {r.id}</span>
                </h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Requested by {r.requestedByName} · {r.department}
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="rec-view-body" style={{ padding: '14px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="Position Type" value={r.positionType} />
              <Field label="Work Mode" value={r.positionMode} />
              <Field label="Openings" value={r.openings} />
              <Field label="Request Type" value={r.requestType} />
              <Field label="Urgency" value={<span className="rec-pill" style={{ background: u.bg, color: u.fg }}>{r.urgency}</span>} />
              <Field label="Status" value={
                <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: s.bg, color: s.fg }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                  {r.status}
                </span>
              } />
              <Field label="Request Date" value={formatDate(r.requestDate)} />
              <Field label="Target Join Date" value={formatDate(r.targetJoinDate)} />
            </div>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint">Read-only view · Use the row actions to change status</span>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" />Close
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit Recruitment modal
// ─────────────────────────────────────────────────────────────────────────────

interface CreateRecruitmentModalProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  editingId: string | null;
  recruitments: RecruitmentRow[];
  onSaved: (row: RecruitmentRow) => void;
  onClose: () => void;
}

function CreateRecruitmentModal({ isOpen, mode, editingId, recruitments, onSaved, onClose }: CreateRecruitmentModalProps) {
  const toast = useToast();
  const editing = mode === 'edit' && editingId ? recruitments.find(r => String(r.id) === String(editingId)) : null;

  // ── Form state ─────────────────────────────────────────────────────────
  // Department / Designation / Primary Role / Hiring Manager / Assigned HR
  // hold backing-master IDs as strings (MasterSelect emits strings); names
  // are looked up from the option lists for display only.
  const [jobTitle, setJobTitle]               = useState('');
  const [departmentId, setDepartmentId]       = useState('');
  const [designationId, setDesignationId]     = useState('');
  const [primaryRoleId, setPrimaryRoleId]     = useState('');
  const [employmentType, setEmploymentType]   = useState<EmployType>('Full Time');
  const [openings, setOpenings]               = useState('1');
  const [experience, setExperience]           = useState('');
  const [workMode, setWorkMode]               = useState<WorkMode>('Hybrid');
  const [priority, setPriority]               = useState<Priority>('Medium');
  const [hiringManagerId, setHiringManagerId] = useState('');
  const [assignedHrId, setAssignedHrId]       = useState('');
  const [startDate, setStartDate]             = useState('');
  const [deadline, setDeadline]               = useState('');
  const [jobDescription, setJobDescription]   = useState('');
  const [requirements, setRequirements]       = useState('');
  const [ctcRange, setCtcRange]               = useState('');
  const [postOnPortal, setPostOnPortal]       = useState(true);
  const [notifyTeamLeads, setNotifyTeamLeads] = useState(true);
  const [enableReferralBonus, setEnableReferralBonus] = useState(false);

  // ── Master dropdown options — values are master IDs (stringified) so the
  // payload can send the FK without name-matching. Labels come from the
  // master tables and remain user-friendly.
  const [deptOptions, setDeptOptions]   = useState<{ value: string; label: string }[]>([]);
  const [desigOptions, setDesigOptions] = useState<{ value: string; label: string }[]>([]);
  const [desigByDept, setDesigByDept]   = useState<Record<string, { value: string; label: string }[]>>({});
  const [roleOptions, setRoleOptions]   = useState<{ value: string; label: string }[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [deptRes, desigRes, roleRes, empRes] = await Promise.all([
          api.get('/master/departments'),
          api.get('/master/designations'),
          api.get('/master/roles'),
          api.get('/employees'),
        ]);
        if (cancelled) return;

        const deptRows: any[]  = Array.isArray(deptRes.data)  ? deptRes.data  : [];
        const desigRows: any[] = Array.isArray(desigRes.data) ? desigRes.data : [];
        const roleRows: any[]  = Array.isArray(roleRes.data)  ? roleRes.data  : [];
        const empRows: any[]   = Array.isArray(empRes.data)   ? empRes.data   : [];

        // Active-only filter — masters and employees both expose a 'status'
        // column; treat missing/blank status as active so older rows show up.
        const isActiveLower = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';

        // ── Departments — { id => name } pairs.
        const deptList = deptRows
          .filter(isActiveLower)
          .map(r => ({ id: r.id, name: r.name }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setDeptOptions(deptList.map(d => ({ value: String(d.id), label: d.name })));

        // ── Designations — group by department_id (string-keyed map) so
        // picking a department narrows the list. Fall back to the full list
        // when a department has no children.
        const groups: Record<string, { value: string; label: string }[]> = {};
        const allDesig: { value: string; label: string }[] = [];
        desigRows.filter(isActiveLower).forEach(r => {
          if (!r.name) return;
          const opt = { value: String(r.id), label: r.name };
          allDesig.push(opt);
          if (r.department_id != null) {
            const k = String(r.department_id);
            if (!groups[k]) groups[k] = [];
            groups[k].push(opt);
          }
        });
        Object.keys(groups).forEach(k => groups[k].sort((a, b) => a.label.localeCompare(b.label)));
        setDesigByDept(groups);
        setDesigOptions(allDesig.sort((a, b) => a.label.localeCompare(b.label)));

        // ── Roles master → Primary Role dropdown.
        setRoleOptions(
          roleRows
            .filter(isActiveLower)
            .map(r => ({ value: String(r.id), label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );

        // ── Employees → Hiring Manager + Assigned HR dropdowns. Show the
        // employee's display_name and EMP-### so a recruiter can pick the
        // right person even when two share a name.
        const empOpts = empRows
          .map(e => {
            const name = e.display_name
              || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ')
              || `Employee #${e.id}`;
            const desig = e?.designation?.name ? ` — ${e.designation.name}` : '';
            const code  = e.emp_code ? ` (${e.emp_code})` : '';
            return { value: String(e.id), label: `${name}${desig}${code}` };
          })
          .sort((a, b) => a.label.localeCompare(b.label));
        setEmployeeOptions(empOpts);
      } catch {
        // Soft-fail — leave the options empty; user sees empty dropdowns
        // rather than a broken modal.
        if (!cancelled) {
          setDeptOptions([]);
          setDesigOptions([]);
          setDesigByDept({});
          setRoleOptions([]);
          setEmployeeOptions([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // When the user picks a department, narrow the designation list to that
  // department's designations (falling back to the full list if none).
  const filteredDesigOptions = useMemo(() => {
    if (departmentId && desigByDept[departmentId]?.length) {
      return desigByDept[departmentId];
    }
    return desigOptions;
  }, [departmentId, desigByDept, desigOptions]);

  type CreateErrors = Partial<Record<
    'jobTitle' | 'department' | 'designation' | 'primaryRole' | 'employmentType' | 'openings' | 'experience'
    | 'workMode' | 'priority' | 'hiringManager' | 'assignedHr' | 'startDate' | 'deadline'
    | 'jobDescription' | 'requirements' | 'ctcRange',
    string
  >>;
  const [errors, setErrors] = useState<CreateErrors>({});

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setJobTitle(editing.jobTitle);
      setDepartmentId(editing.departmentId != null ? String(editing.departmentId) : '');
      setDesignationId(editing.designationId != null ? String(editing.designationId) : '');
      setPrimaryRoleId(editing.primaryRoleId != null ? String(editing.primaryRoleId) : '');
      setCtcRange(editing.ctcRange || '');
      setEmploymentType(editing.employmentType);
      setOpenings(String(editing.openings));
      setExperience(editing.experience || '');
      setWorkMode(editing.workMode);
      setPriority(editing.priority);
      setHiringManagerId(editing.hiringManagerId != null ? String(editing.hiringManagerId) : '');
      setAssignedHrId(editing.assignedHrId != null ? String(editing.assignedHrId) : '');
      // Dates from the API arrive as ISO strings (YYYY-MM-DD or full ISO);
      // MasterDatePicker accepts the ISO date prefix, so slice safely.
      setStartDate(editing.startDate ? String(editing.startDate).slice(0, 10) : '');
      setDeadline(editing.deadline ? String(editing.deadline).slice(0, 10) : '');
      setJobDescription(editing.jobDescription || '');
      setRequirements(editing.requirements || '');
      setPostOnPortal(editing.postOnPortal);
      setNotifyTeamLeads(editing.notifyTeamLeads);
      setEnableReferralBonus(editing.enableReferralBonus);
      setErrors({});
    } else {
      setJobTitle(''); setDepartmentId(''); setDesignationId(''); setPrimaryRoleId('');
      setCtcRange(''); setEmploymentType('Full Time');
      setOpenings('1'); setExperience(''); setWorkMode('Hybrid'); setPriority('Medium');
      setHiringManagerId(''); setAssignedHrId(''); setStartDate(''); setDeadline('');
      setJobDescription(''); setRequirements('');
      setPostOnPortal(true); setNotifyTeamLeads(true); setEnableReferralBonus(false);
      setErrors({});
    }
  }, [isOpen, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof CreateErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): CreateErrors => {
    const e: CreateErrors = {};
    if (!jobTitle.trim())        e.jobTitle        = 'Job title is required';
    if (!departmentId)           e.department      = 'Department is required';
    if (!designationId)          e.designation     = 'Designation is required';
    if (!primaryRoleId)          e.primaryRole     = 'Primary role is required';
    if (!employmentType)         e.employmentType  = 'Employment type is required';
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Openings must be at least 1';
    if (!priority)               e.priority        = 'Priority is required';
    if (!hiringManagerId)        e.hiringManager   = 'Hiring manager is required';
    if (!assignedHrId)           e.assignedHr      = 'Assigned HR is required';
    if (!startDate)              e.startDate       = 'Start date is required';
    if (!deadline)               e.deadline        = 'TAT/Deadline is required';
    return e;
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error('Please complete required fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need attention.`);
      return;
    }

    // Backend payload — snake_case keys, FK ids cast back to integers.
    const payload = {
      job_title:             jobTitle.trim(),
      department_id:         Number(departmentId),
      designation_id:        Number(designationId),
      primary_role_id:       primaryRoleId ? Number(primaryRoleId) : null,
      employment_type:       employmentType,
      openings:              Number(openings) || 1,
      experience:            experience || null,
      work_mode:             workMode || null,
      ctc_range:             ctcRange || null,
      priority,
      hiring_manager_id:     hiringManagerId ? Number(hiringManagerId) : null,
      assigned_hr_id:        assignedHrId ? Number(assignedHrId) : null,
      start_date:            startDate || null,
      deadline:              deadline || null,
      job_description:       jobDescription || null,
      requirements:          requirements || null,
      post_on_portal:        !!postOnPortal,
      notify_team_leads:     !!notifyTeamLeads,
      enable_referral_bonus: !!enableReferralBonus,
    };

    setSaving(true);
    try {
      const isEdit = mode === 'edit' && editingId != null;
      const { data } = isEdit
        ? await api.put(`/recruitments/${editingId}`, payload)
        : await api.post('/recruitments', payload);
      toast.success(isEdit ? 'Recruitment updated' : 'Recruitment created',
        isEdit ? 'Changes saved successfully.' : `${data.code || 'New recruitment'} is now live.`);
      // The backend returns the saved row with eager-loaded relations —
      // convert into the UI shape so the parent list updates without a refetch.
      onSaved(apiToRow(data));
    } catch (err: any) {
      // Surface any per-field validation errors back into the form.
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        const fieldMap: Record<string, string> = {
          job_title: 'jobTitle', employment_type: 'employmentType',
          department_id: 'department', designation_id: 'designation', primary_role_id: 'primaryRole',
          hiring_manager_id: 'hiringManager', assigned_hr_id: 'assignedHr',
          start_date: 'startDate', deadline: 'deadline', work_mode: 'workMode',
        };
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          mapped[fieldMap[k] || k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setErrors(mapped);
        toast.error('Validation failed', 'Please fix the highlighted fields.');
      } else {
        toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header */}
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <i className={mode === 'edit' ? 'ri-pencil-line' : 'ri-add-circle-line'} style={{ fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  {mode === 'edit' ? `Edit Recruitment ${editing ? `(${editing.id})` : ''}` : 'Create Recruitment'}
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1, lineHeight: 1.2 }}>
                  Fill in the details to open a new hiring position
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* Body — all 3 sections live inside ONE card so they read as a
            single, continuous form rather than 3 separate panels. */}
        <div className="rec-form-body">
          <div className="rec-form-card">
          {/* Position Details */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon rec-form-section-icon--soft">
                <i className="ri-briefcase-4-line" />
              </span>
              <div>
                <p className="rec-form-section-title">Position Details</p>
              </div>
            </div>
            <Row className="g-2">
              <Col xs={12}>
                <label className="rec-form-label"><i className="ri-briefcase-4-line" />Job Title<span className="req">*</span></label>
                <div className={`rec-input-icon${errors.jobTitle ? ' is-invalid' : ''}`}>
                  <i className="ri-briefcase-4-line rec-input-icon-leading" />
                  <input
                    type="text"
                    className={`rec-input has-leading-icon${errors.jobTitle ? ' is-invalid' : ''}`}
                    placeholder="e.g. Senior Backend Engineer"
                    value={jobTitle}
                    onChange={e => { setJobTitle(e.target.value); clear('jobTitle'); }}
                  />
                </div>
                {errors.jobTitle && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobTitle}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-building-2-line" />Department<span className="req">*</span></label>
                <MasterSelect
                  value={departmentId}
                  onChange={(v) => {
                    setDepartmentId(v);
                    clear('department');
                    // Clear designation when department changes so the user
                    // re-picks from the now-narrowed list.
                    if (designationId) setDesignationId('');
                  }}
                  options={deptOptions}
                  placeholder={deptOptions.length === 0 ? 'Loading…' : '— Select —'}
                  invalid={!!errors.department}
                />
                {errors.department && <div className="rec-error"><i className="ri-error-warning-line" />{errors.department}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-medal-line" />Designation<span className="req">*</span></label>
                <MasterSelect
                  value={designationId}
                  onChange={(v) => { setDesignationId(v); clear('designation'); }}
                  options={filteredDesigOptions}
                  placeholder={
                    filteredDesigOptions.length === 0
                      ? (departmentId ? 'No designations for this department' : 'Loading…')
                      : '— Select —'
                  }
                  invalid={!!errors.designation}
                />
                {errors.designation && <div className="rec-error"><i className="ri-error-warning-line" />{errors.designation}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-user-star-line" />Primary Role<span className="req">*</span></label>
                <MasterSelect
                  value={primaryRoleId}
                  onChange={(v) => { setPrimaryRoleId(v); clear('primaryRole' as any); }}
                  options={roleOptions}
                  placeholder={roleOptions.length === 0 ? 'Loading…' : '— Select —'}
                  invalid={!!errors.primaryRole}
                />
                {errors.primaryRole && <div className="rec-error"><i className="ri-error-warning-line" />{errors.primaryRole}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-time-line" />Employment Type<span className="req">*</span></label>
                <MasterSelect
                  value={employmentType}
                  onChange={(v) => { setEmploymentType(v as EmployType); clear('employmentType'); }}
                  options={REC_EMPLOYMENT_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.employmentType}
                />
                {errors.employmentType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.employmentType}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-team-line" />No. of Openings<span className="req">*</span></label>
                <input
                  type="number"
                  min={1}
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-history-line" />Experience Required</label>
                <MasterSelect
                  value={experience}
                  onChange={(v) => { setExperience(v); clear('experience'); }}
                  options={REQUIRED_EXPERIENCE_OPTIONS}
                  placeholder="— Select —"
                  invalid={!!errors.experience}
                />
                {errors.experience && <div className="rec-error"><i className="ri-error-warning-line" />{errors.experience}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label"><i className="ri-map-pin-line" />Work Mode</label>
                <MasterSelect
                  value={workMode}
                  onChange={(v) => { setWorkMode(v as WorkMode); clear('workMode'); }}
                  options={WORK_MODE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.workMode}
                />
                {errors.workMode && <div className="rec-error"><i className="ri-error-warning-line" />{errors.workMode}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label"><i className="ri-money-rupee-circle-line" />CTC Range (LPA)</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. 8-12"
                  value={ctcRange}
                  onChange={e => setCtcRange(e.target.value)}
                />
              </Col>
              <Col xs={12}>
                <label className="rec-form-label"><i className="ri-flag-line" />Priority<span className="req">*</span></label>
                <div className="rec-priority-row">
                  {(['High', 'Medium', 'Low'] as Priority[]).map((p) => {
                    const dotColor = p === 'High' ? '#ef4444' : p === 'Medium' ? '#f5d000' : '#3b82f6';
                    const active = priority === p;
                    return (
                      <button
                        type="button"
                        key={p}
                        className={`rec-priority-pill${active ? ` is-active priority-${p.toLowerCase()}` : ''}`}
                        onClick={() => { setPriority(p); clear('priority'); }}
                      >
                        <span className="rec-priority-dot" style={{ background: dotColor }} />
                        {p}
                      </button>
                    );
                  })}
                </div>
                {errors.priority && <div className="rec-error"><i className="ri-error-warning-line" />{errors.priority}</div>}
              </Col>
            </Row>
          </div>

          {/* Hiring Configuration */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon rec-form-section-icon--soft">
                <i className="ri-user-settings-line" />
              </span>
              <div>
                <p className="rec-form-section-title">Hiring Configuration</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-user-settings-line" />Hiring Manager<span className="req">*</span></label>
                <MasterSelect
                  value={hiringManagerId}
                  onChange={(v) => { setHiringManagerId(v); clear('hiringManager'); }}
                  options={employeeOptions}
                  placeholder={employeeOptions.length === 0 ? 'Loading employees…' : '— Select —'}
                  invalid={!!errors.hiringManager}
                />
                {errors.hiringManager && <div className="rec-error"><i className="ri-error-warning-line" />{errors.hiringManager}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-user-2-line" />Assigned HR<span className="req">*</span></label>
                <MasterSelect
                  value={assignedHrId}
                  onChange={(v) => { setAssignedHrId(v); clear('assignedHr'); }}
                  options={employeeOptions}
                  placeholder={employeeOptions.length === 0 ? 'Loading employees…' : '— Select —'}
                  invalid={!!errors.assignedHr}
                />
                {errors.assignedHr && <div className="rec-error"><i className="ri-error-warning-line" />{errors.assignedHr}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-calendar-line" />Start Date<span className="req">*</span></label>
                <MasterDatePicker
                  value={startDate}
                  onChange={(v) => { setStartDate(v); clear('startDate'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.startDate}
                />
                {errors.startDate && <div className="rec-error"><i className="ri-error-warning-line" />{errors.startDate}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-calendar-event-line" />TAT / Deadline<span className="req">*</span></label>
                <MasterDatePicker
                  value={deadline}
                  onChange={(v) => { setDeadline(v); clear('deadline'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.deadline}
                />
                {errors.deadline && <div className="rec-error"><i className="ri-error-warning-line" />{errors.deadline}</div>}
              </Col>
            </Row>
          </div>

          {/* Job content */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon rec-form-section-icon--soft">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <p className="rec-form-section-title">Job Details</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={6}>
                <label className="rec-form-label"><i className="ri-file-text-line" />Job Description</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Key responsibilities, expectations, and role overview…"
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label"><i className="ri-list-check-2" />Requirements</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Required skills, qualifications, certifications…"
                  value={requirements}
                  onChange={e => setRequirements(e.target.value)}
                />
              </Col>
            </Row>
          </div>
          </div>
          {/* /rec-form-card */}

          {/* Toggle row — 3 inline checkbox preferences */}
          <div className="rec-toggle-row">
            <label className="rec-toggle">
              <input
                type="checkbox"
                checked={postOnPortal}
                onChange={e => setPostOnPortal(e.target.checked)}
              />
              <i className="ri-global-line" />
              <span>Post on careers portal</span>
            </label>
            <label className="rec-toggle">
              <input
                type="checkbox"
                checked={notifyTeamLeads}
                onChange={e => setNotifyTeamLeads(e.target.checked)}
              />
              <i className="ri-notification-3-line" />
              <span>Notify team leads</span>
            </label>
            <label className="rec-toggle">
              <input
                type="checkbox"
                checked={enableReferralBonus}
                onChange={e => setEnableReferralBonus(e.target.checked)}
              />
              <i className="ri-star-line" />
              <span>Enable referral bonus</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="rec-btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <>
                  <Spinner size="sm" style={{ width: 14, height: 14 }} />
                  <span>{mode === 'edit' ? 'Saving…' : 'Saving…'}</span>
                </>
              ) : (
                <>
                  <i className={mode === 'edit' ? 'ri-save-3-line' : 'ri-check-line'} />
                  {mode === 'edit' ? 'Save Changes' : 'Save Recruitment'}
                </>
              )}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel confirmation
// ─────────────────────────────────────────────────────────────────────────────

const CANCEL_REASONS = [
  { value: 'Position no longer required',  label: 'Position no longer required' },
  { value: 'Hiring freeze',                 label: 'Hiring freeze / budget hold' },
  { value: 'Internal candidate selected',   label: 'Internal candidate selected' },
  { value: 'Reassigned to another team',    label: 'Reassigned to another team' },
  { value: 'Duplicate of another req',      label: 'Duplicate of another requisition' },
  { value: 'Role redefined',                label: 'Role / scope redefined' },
  { value: 'Other',                         label: 'Other (add notes below)' },
];

function CancelConfirmModal({
  target, candidateCount, onClose, onConfirm,
}: { target: RecruitmentRow | null; candidateCount?: number; onClose: () => void; onConfirm: (reason: string, notes: string) => void }) {
  const [reason, setReason]   = useState<string>('');
  const [notes, setNotes]     = useState<string>('');
  const [reasonErr, setReasonErr] = useState<boolean>(false);

  // Reset form whenever a new target is selected / modal closes
  useEffect(() => {
    if (target) { setReason(''); setNotes(''); setReasonErr(false); }
  }, [target]);

  const handleConfirm = () => {
    if (!reason) { setReasonErr(true); return; }
    onConfirm(reason, notes);
  };

  const countLabel = candidateCount != null
    ? `${candidateCount} candidate record${candidateCount === 1 ? '' : '(s)'}`
    : 'Candidate records';

  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="md" backdrop="static" keyboard={false}
      contentClassName="border-0 rec-cancel-modal"
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 18, overflow: 'hidden' }}>
        {target && (
          <>
            {/* Header — vivid orange gradient banner */}
            <div className="rec-cancel-head">
              <div className="rec-cancel-head-inner">
                <span className="rec-cancel-head-icon">
                  <i className="ri-forbid-2-line" />
                </span>
                <div className="rec-cancel-head-text">
                  <h5 className="mb-0">Cancel Recruitment</h5>
                  <div className="rec-cancel-head-sub">
                    This action will move the recruitment to the Cancelled tab
                  </div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="rec-cancel-close">
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="rec-cancel-body">
              {/* Recruitment summary card */}
              <div className="rec-cancel-summary">
                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                  <span className="rec-id-pill">{target.id}</span>
                  <span className="rec-cancel-summary-title">{target.jobTitle}</span>
                </div>
                <div className="rec-cancel-summary-meta">
                  <span><strong>Dept:</strong> {target.department}</span>
                  <span className="dot">·</span>
                  <span><strong>Openings:</strong> {target.openings}</span>
                  <span className="dot">·</span>
                  <span><strong>HR:</strong> {target.assignedHrName}</span>
                </div>
              </div>

              {/* Impact warning */}
              <div className="rec-cancel-impact">
                <i className="ri-alert-line" />
                <div>
                  <strong>Impact:</strong> {countLabel} linked to this recruitment will be preserved
                  but no longer actionable. This cannot be undone from the UI.
                </div>
              </div>

              {/* Reason for cancellation */}
              <div className="rec-cancel-field">
                <label className="rec-cancel-label">
                  Reason for Cancellation<span className="req">*</span>
                </label>
                <div className={`rec-cancel-select${reasonErr ? ' is-invalid' : ''}`}>
                  <MasterSelect
                    value={reason}
                    onChange={(v) => { setReason(v); if (v) setReasonErr(false); }}
                    options={CANCEL_REASONS}
                    placeholder="— Select a reason —"
                  />
                </div>
                {reasonErr && (
                  <div className="rec-cancel-error">
                    <i className="ri-error-warning-line" />Please select a reason before confirming
                  </div>
                )}
              </div>

              {/* Additional notes */}
              <div className="rec-cancel-field">
                <label className="rec-cancel-label">
                  Additional Notes <span className="opt">(OPTIONAL)</span>
                </label>
                <textarea
                  className="rec-cancel-textarea"
                  rows={3}
                  placeholder="Add context for the audit trail — stakeholders informed, next steps, etc."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="rec-cancel-footer">
              <button type="button" className="rec-btn-ghost" onClick={onClose}>
                Keep Active
              </button>
              <button type="button" className="rec-cancel-confirm" onClick={handleConfirm}>
                <i className="ri-forbid-2-line" />Confirm Cancellation
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidates placeholder modal
// ─────────────────────────────────────────────────────────────────────────────

function CandidatesPlaceholderModal({
  target, onClose,
}: { target: RecruitmentRow | null; onClose: () => void }) {
  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="lg" backdrop="static"
      contentClassName="border-0" style={{ borderRadius: 20 }}
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 20, overflow: 'hidden' }}>
        {target && (
          <>
            <div className="rec-form-header">
              <div className="d-flex align-items-center justify-content-between gap-3">
                <div className="d-flex align-items-center gap-3">
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className="ri-team-line" style={{ fontSize: 22 }} />
                  </span>
                  <div>
                    <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18 }}>Candidates · {target.id}</h5>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                      {target.jobTitle} · {target.openings} opening{target.openings === 1 ? '' : 's'} · {target.workMode}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={onClose} className="rec-close-btn d-inline-flex align-items-center justify-content-center">
                  <i className="ri-close-line" style={{ fontSize: 20 }} />
                </button>
              </div>
            </div>
            <div style={{ padding: '40px 32px', textAlign: 'center' }}>
              <div
                className="d-inline-flex align-items-center justify-content-center"
                style={{ width: 72, height: 72, borderRadius: 20, background: '#ece6ff', color: '#5a3fd1' }}
              >
                <i className="ri-user-search-line" style={{ fontSize: 32 }} />
              </div>
              <h5 className="fw-bold mt-3 mb-1">Candidate Pipeline</h5>
              <p className="text-muted mb-3" style={{ fontSize: 13.5 }}>
                Detailed candidate pipeline (Sourced → Screened → Interview → Offer → Joined) opens here.
                Wire it up to the Candidate API once the endpoints are ready.
              </p>
              <button type="button" className="rec-btn-primary" onClick={onClose}>
                <i className="ri-check-line" />Got it
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ActionBtn({
  title, icon, color, onClick, disabled,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) {
  // Map semantic colors → tinted glossy tone classes that already exist in
  // recruitment.css (rec-act-view / approve / reject) so the buttons share
  // the same look as the row actions on the Candidate page.
  const toneClass =
    color === 'info' || color === 'primary' ? 'rec-act-tone-info'
    : color === 'success' ? 'rec-act-tone-success'
    : color === 'danger'  ? 'rec-act-tone-danger'
    : 'rec-act-tone-neutral';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rec-act-icon ${toneClass}`}
    >
      <i className={icon} />
    </button>
  );
}

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (!end) { setDisplay(0); return; }
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{display}{suffix}</>;
}

