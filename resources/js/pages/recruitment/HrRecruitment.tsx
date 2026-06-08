import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Spinner } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { Shimmer, ShimmerTableRows } from '../../components/ui/Shimmer';
import '../../../css/recruitment.css';

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

export interface HiringRequestRow {
  id: string;            // numeric DB id, stringified — used as the React key
  code: string;          // HRQ-### shown in the table pill
  position: string;
  positionType: EmployType | 'Intern';
  positionMode: WorkMode;
  department: string;
  departmentId: number | null;
  requestedByName: string;
  requestedByInitials: string;
  requestedByAccent: string;
  openings: number;
  requestType: RequestType;
  urgency: RequestUrgency;
  status: RequestStatus;
  requestDate: string;
  targetJoinDate: string;
  // Original API row — stashed so consumers (e.g. the "Create Recruitment
  // from Hiring Request" prefill flow) can read fields that the row
  // interface doesn't surface (job_description, required_skills, etc.).
  _raw?: any;
}

/* ── Backend → UI converter for hiring requests ──────────────────────────────
 * The API stores `Full-time` / `Part-time` / `Intern` / `Onsite` (matching the
 * Raise Hiring Request form), but the list table's tone maps key off
 * `Full Time` / `Part Time` / `Internship` / `On-site` (matching the
 * Recruitment form). We normalize at the boundary so existing colour lookups
 * keep working without churn.
 */
const HR_EMP_TYPE_MAP: Record<string, EmployType | 'Intern'> = {
  'Full-time':  'Full Time',
  'Part-time':  'Part Time',
  'Contract':   'Contract',
  'Intern':     'Intern',
  // Pass-through if the row already arrived in the table's preferred format.
  'Full Time':  'Full Time',
  'Part Time':  'Part Time',
  'Internship': 'Internship' as any,
};
const HR_WORK_MODE_MAP: Record<string, WorkMode> = {
  'Onsite':   'On-site',
  'Remote':   'Remote',
  'Hybrid':   'Hybrid',
  'Flexible': 'Flexible',
  'On-site':  'On-site',
};

function apiToHiringRequestRow(api: any): HiringRequestRow {
  const dept = api?.department?.name || '';
  const requestedBy = api?.requested_by_name || api?.creator?.name || '';

  return {
    id: String(api?.id ?? ''),
    code: api?.code || `HRQ-${api?.id ?? ''}`,

    // The table column is "Position" — we put the form's `job_role` there
    // (the actual role title), falling back to `title` if a draft only
    // captured that.
    position: api?.job_role || api?.title || '',

    positionType: (HR_EMP_TYPE_MAP[api?.employment_type] || 'Full Time') as EmployType | 'Intern',
    positionMode: (HR_WORK_MODE_MAP[api?.work_mode] || 'Hybrid') as WorkMode,

    department:   dept,
    departmentId: api?.department_id ?? null,

    requestedByName:     requestedBy,
    requestedByInitials: initialsOf(requestedBy),
    requestedByAccent:   pickAccent(api?.id ?? requestedBy),

    openings:       Number(api?.openings) || 1,
    requestType:    (api?.request_type || 'New Position') as RequestType,
    urgency:        (api?.urgency       || 'Medium')      as RequestUrgency,
    status:         (api?.status        || 'Submitted')   as RequestStatus,
    // "Req Date" in the list = when the row was actually created on the
    // server (auto-stamped). The form's date picker now feeds
    // `target_join_date` instead, shown in the "Target Join" column.
    // We slice the ISO timestamp to YYYY-MM-DD so formatDate() doesn't
    // include the time portion.
    requestDate:    (api?.created_at ? String(api.created_at).slice(0, 10) : api?.request_date) || '',
    targetJoinDate: api?.target_join_date || '',
    _raw:           api,
  };
}


// ── Lookup palettes ─────────────────────────────────────────────────────────
/* Tinted-glass tokens — semi-transparent backgrounds so the pill
 * inherits the surface tone and reads cleanly on both light and dark
 * themes (parallels the SalesCustomers / SalesConsignee pills). The
 * legacy flat pastel hex codes (#dbeafe, #fed7aa, …) rendered as
 * washed-out stickers on dark canvas. */
const PRIORITY_TONES: Record<Priority, { bg: string; fg: string }> = {
  Low:      { bg: 'rgba(34,197,94,0.14)',  fg: '#16a34a' },
  Medium:   { bg: 'rgba(245,158,11,0.14)', fg: '#d97706' },
  High:     { bg: 'rgba(249,115,22,0.16)', fg: '#ea580c' },
  Critical: { bg: 'rgba(236,72,153,0.16)', fg: '#db2777' },
};

const WORK_MODE_TONES: Record<WorkMode, { bg: string; fg: string }> = {
  'On-site':  { bg: 'rgba(59,130,246,0.14)',  fg: '#2563eb' },
  Remote:     { bg: 'rgba(124,58,237,0.14)',  fg: '#7c3aed' },
  Hybrid:     { bg: 'rgba(20,184,166,0.14)',  fg: '#0d9488' },
  Flexible:   { bg: 'rgba(236,72,153,0.14)',  fg: '#db2777' },
};

const EMPLOY_TYPE_TONES: Record<EmployType, { bg: string; fg: string }> = {
  'Full Time':  { bg: 'rgba(59,130,246,0.14)', fg: '#2563eb' },
  'Part Time':  { bg: 'rgba(249,115,22,0.14)', fg: '#ea580c' },
  Contract:     { bg: 'rgba(20,184,166,0.14)', fg: '#0d9488' },
  Internship:   { bg: 'rgba(236,72,153,0.14)', fg: '#db2777' },
};

// Status → Bootstrap badge color. Used to render the Status pill with the
// same `badge rounded-pill bg-{color}-subtle text-{color}` classes the
// Clients table uses, so every status badge across the recruitment area
// reads as one design system.
const REQUEST_STATUS_COLOR: Record<RequestStatus, 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'secondary'> = {
  Approved:       'success',
  'Under Review': 'info',
  Submitted:      'info',
  'Sent Back':    'warning',
  Draft:          'secondary',
  Rejected:       'danger',
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
// Department options used to be a hardcoded list which silently broke
// for any tenant whose dept names didn't match (e.g. "Export-Import",
// "Logistics"). The filter dropdown is now derived from the actual
// recruitments list at render time — see `deptFilterOptions` below.
// Priority + Job Type stay hardcoded because they're closed enums.
// Priority filter — kept in lockstep with the Create Recruitment form
// (which exposes High / Medium / Low only). 'Critical' used to be in
// this list but the form never produces it, so the filter dropdown had
// a permanent dead option.
const PRIORITY_FILTER_OPTIONS = [
  { value: 'All',    label: 'All' },
  { value: 'High',   label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low',    label: 'Low' },
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
  // Drives the table shimmer; flips off once the first /recruitments
  // response (success or error) settles.
  const [loadingRecruitments, setLoadingRecruitments] = useState(true);
  const [tab, setTab] = useState<RecruitmentStatus>('In Progress');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [jobTypeFilter, setJobTypeFilter]   = useState<string>('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when tab / filters change
  useEffect(() => { setPage(1); }, [tab, q, deptFilter, priorityFilter, jobTypeFilter]);

  // Aggregate candidate counts driving the KPI strip — fetched in parallel
  // with the recruitments list and re-fetched whenever the list changes
  // (status flips on a row may add a Selected / Rejected somewhere upstream).
  type CandidateStats = {
    total: number;
    applied: number;
    shortlisted: number;
    in_interview: number;
    final_interview: number;
    selected: number;
    offered: number;
    rejected: number;
    on_hold: number;
  };
  const ZERO_STATS: CandidateStats = {
    total: 0, applied: 0, shortlisted: 0, in_interview: 0, final_interview: 0,
    selected: 0, offered: 0, rejected: 0, on_hold: 0,
  };
  const [candidateStats, setCandidateStats] = useState<CandidateStats>(ZERO_STATS);

  // Initial load — pull all recruitments + the aggregate candidate counts
  // in parallel. Two endpoints, one render.
  const fetchRecruitments = async () => {
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/recruitments'),
        // Stats may 404 in environments that haven't run the latest
        // routes — fall back to zeros instead of breaking the whole list.
        api.get('/candidates/stats').catch(() => ({ data: ZERO_STATS })),
      ]);
      const rows: any[] = Array.isArray(listRes.data) ? listRes.data : [];
      setRecruitments(rows.map(apiToRow));
      setCandidateStats({ ...ZERO_STATS, ...(statsRes.data || {}) });
    } catch (err: any) {
      toast.error('Could not load recruitments', err?.response?.data?.message || 'Please try again.');
      setRecruitments([]);
      setCandidateStats(ZERO_STATS);
    } finally {
      setLoadingRecruitments(false);
    }
  };
  useEffect(() => { fetchRecruitments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Counts — derived from the fetched list (recruitment-based) and the
  // /candidates/stats payload (candidate-based). KPI cards stay in sync
  // with whatever the server actually has, no client-side aggregation.
  const counts = useMemo(() => {
    const total = recruitments.length;
    const inProgress = recruitments.filter(r => r.status === 'In Progress').length;
    const completed  = recruitments.filter(r => r.status === 'Completed').length;
    const cancelled  = recruitments.filter(r => r.status === 'Cancelled').length;
    return {
      total,
      active:     inProgress,
      candidates: candidateStats.total,
      selected:   candidateStats.selected,
      rejected:   candidateStats.rejected,
      // "Pending Interviews" = every candidate still in the pipeline,
      // i.e. NOT yet Selected / Offered / Rejected. This matches the
      // count under the "Final Round Selected" tab on the candidate
      // detail page — the bucket of names HR is still actively chasing.
      // Earlier this only counted Final Interview which masked anyone
      // sitting on Applied / Shortlisted / In Interview / On Hold.
      pending: Math.max(
        0,
        candidateStats.total
          - candidateStats.selected
          - candidateStats.offered
          - candidateStats.rejected,
      ),
      tabs: { 'In Progress': inProgress, Completed: completed, Cancelled: cancelled },
    };
  }, [recruitments, candidateStats]);

  // Filtered rows
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const df = deptFilter.trim().toLowerCase();
    return recruitments.filter(r => r.status === tab)
      // Case- and whitespace-tolerant dept compare — guards against
      // a tenant with trailing spaces / capitalisation drift between
      // the master row and what's stored on the recruitment.
      .filter(r => df === 'all' || String(r.department || '').trim().toLowerCase() === df)
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

  // Department dropdown options — pulled from the Departments master so
  // every dept (including those without recruitments yet) appears in the
  // filter. We still merge in any dept names that exist on recruitment
  // rows so legacy / orphaned values stay reachable even if the master
  // row was renamed or removed. Sorted; "All" sits at the top.
  const [masterDepts, setMasterDepts] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.get('/master/departments')
      .then(({ data }) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(data) ? data : [];
        const names = rows
          .filter((r: any) => !r.status || String(r.status).toLowerCase() === 'active')
          .map((r: any) => String(r.name || '').trim())
          .filter(Boolean);
        setMasterDepts(names);
      })
      .catch(() => { if (!cancelled) setMasterDepts([]); });
    return () => { cancelled = true; };
  }, []);
  const deptFilterOptions = useMemo(() => {
    const fromMaster = masterDepts;
    const fromRows   = recruitments
      .map(r => (r.department || '').trim())
      .filter(d => d && d !== '—');
    const names = Array.from(new Set([...fromMaster, ...fromRows]))
      .sort((a, b) => a.localeCompare(b));
    return [{ value: 'All', label: 'All' }, ...names.map(n => ({ value: n, label: n }))];
  }, [masterDepts, recruitments]);

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
  // Which path the user clicked into the close modal with — drives the
  // pre-selected tab inside CancelConfirmModal. Reset alongside the
  // target so a stale value can't carry over between rows.
  const [cancelInitialAction, setCancelInitialAction] = useState<'cancel' | 'complete'>('cancel');
  const [candidatesTarget, setCandidatesTarget]     = useState<RecruitmentRow | null>(null);
  // Bumped after a Raise Hiring Request submit so the list modal refetches
  // the next time it's opened (or while it's already open).
  const [hiringRefreshKey, setHiringRefreshKey]     = useState(0);
  // When the user clicks "Create Recruitment" on a row inside the Hiring
  // Requests modal, we stash the source row here so the Create Recruitment
  // form opens pre-filled with the request's department / openings / target
  // date / job description / etc. Cleared when the modal closes or the row
  // is saved.
  const [createPrefillFromHr, setCreatePrefillFromHr] = useState<any | null>(null);

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
                {/* "Raise Hiring Request" intentionally removed — managers
                    raise hires from their own Employee Profile > Hiring
                    Requests tab, where the requester context (creator,
                    reporting line, team size) is automatic. HR's side
                    keeps the View button only, used for review +
                    converting an existing request into a recruitment. */}
                <button
                  type="button"
                  className="rec-btn-teal"
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
                        {loadingRecruitments
                          ? <Shimmer height={22} width={56} />
                          : <AnimatedNumber value={(counts as any)[k.key]} />}
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
                      <MasterSelect value={deptFilter} onChange={setDeptFilter} options={deptFilterOptions} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Priority</span>
                    <div style={{ minWidth: 130 }}>
                      <MasterSelect value={priorityFilter} onChange={setPriorityFilter} options={PRIORITY_FILTER_OPTIONS} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>work Type</span>
                    <div style={{ minWidth: 140 }}>
                      <MasterSelect value={jobTypeFilter} onChange={setJobTypeFilter} options={JOB_TYPE_FILTER_OPTIONS} placeholder="All" />
                    </div>
                    
                  </div>
                  <div className="p-2 rec-list-scroll">
                  <table className="rec-list-table align-middle table-nowrap mb-0">
                    <thead>
                      <tr>
                        <th scope="col" className="ps-3 text-center" style={{ width: 60 }}>Sr No</th>
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
                      {loadingRecruitments ? (
                        <ShimmerTableRows rows={6} cols={15} keyPrefix="rec" />
                      ) : visible.length === 0 ? (
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
                            <td className="fw-bold fs-13" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.jobTitle}>{r.jobTitle}</td>
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
                                  title={
                                    r.status === 'Cancelled' ? 'Cannot edit — recruitment is cancelled'
                                    : r.status === 'Completed' ? 'Cannot edit — recruitment is completed'
                                    : 'Edit Recruitment'
                                  }
                                  icon="ri-pencil-line"
                                  color="info"
                                  disabled={r.status === 'Cancelled' || r.status === 'Completed'}
                                  onClick={() => { setCreateMode('edit'); setCreateEditingId(r.id); setCreateOpen(true); }}
                                />
                                <ActionBtn
                                  title="View Candidates"
                                  icon="ri-team-line"
                                  color="primary"
                                  onClick={() => navigate(`/hr/recruitment/${r.id}/candidates`)}
                                />
                                {/* Two distinct close-out actions —
                                    Complete (green check) for the
                                    happy-path "all openings filled",
                                    Cancel (red forbid) for the
                                    destructive path. Both open the same
                                    CancelConfirmModal but pre-select
                                    the matching tab so the user lands
                                    on the right path immediately. */}
                                <ActionBtn
                                  title={
                                    r.status === 'Cancelled' ? 'Already Cancelled'
                                    : r.status === 'Completed' ? 'Already Completed'
                                    : 'Mark Recruitment Completed'
                                  }
                                  icon="ri-checkbox-circle-line"
                                  color="success"
                                  disabled={r.status === 'Cancelled' || r.status === 'Completed'}
                                  onClick={() => { setCancelInitialAction('complete'); setCancelTarget(r); }}
                                />
                                <ActionBtn
                                  title={
                                    r.status === 'Cancelled' ? 'Already Cancelled'
                                    : r.status === 'Completed' ? 'Already Completed'
                                    : 'Cancel Recruitment'
                                  }
                                  icon="ri-forbid-2-line"
                                  color="danger"
                                  disabled={r.status === 'Cancelled' || r.status === 'Completed'}
                                  onClick={() => { setCancelInitialAction('cancel'); setCancelTarget(r); }}
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
        onSubmit={(savedRow, asDraft) => {
          setRaiseOpen(false);
          // Bump the refresh key so the Hiring Requests list re-fetches the
          // moment the user opens it (or keeps it open across submits).
          setHiringRefreshKey(k => k + 1);
          if (asDraft) toast.success('Saved as draft', `${savedRow.code || 'Hiring request'} saved to drafts.`);
          else toast.success('Hiring request submitted', `${savedRow.code || 'Hiring request'} sent to HR for review.`);
        }}
      />

      <HiringRequestsListModal
        isOpen={requestsOpen}
        refreshKey={hiringRefreshKey}
        onClose={() => setRequestsOpen(false)}
        onRaiseNew={() => { setRequestsOpen(false); setRaiseOpen(true); }}
        onCreateRecruitment={(req) => {
          // Close the Hiring Requests modal and open Create Recruitment
          // pre-filled with everything the hiring request already captured.
          // The user fills in the recruitment-specific extras (designation,
          // primary role, hiring manager, assigned HR, dates).
          setRequestsOpen(false);
          setCreateMode('add');
          setCreateEditingId(null);
          // _raw carries the full API payload including job_description,
          // required_skills, target_join_date, etc. — fields that the
          // trimmed HiringRequestRow doesn't surface on its own.
          setCreatePrefillFromHr(req?._raw || null);
          setCreateOpen(true);
        }}
      />

      <CreateRecruitmentModal
        isOpen={createOpen}
        mode={createMode}
        editingId={createEditingId}
        recruitments={recruitments}
        prefillFromHr={createPrefillFromHr}
        onClose={() => { setCreateOpen(false); setCreatePrefillFromHr(null); }}
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
          setCreatePrefillFromHr(null);
        }}
      />

      <CancelConfirmModal
        target={cancelTarget}
        initialAction={cancelInitialAction}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (action, reason, notes) => {
          if (!cancelTarget) return;
          const isComplete = action === 'complete';
          // Single PUT endpoint — payload differs only in `status` and
          // whether the cancellation reason is included.
          const payload: Record<string, any> = {
            status:       isComplete ? 'Completed' : 'Cancelled',
            cancel_notes: notes || null,
          };
          if (!isComplete) payload.cancel_reason = reason;

          try {
            const { data } = await api.put(`/recruitments/${cancelTarget.id}`, payload);
            const row = apiToRow(data);
            setRecruitments(prev => prev.map(r => String(r.id) === String(row.id) ? row : r));
            toast.success(
              isComplete ? 'Recruitment completed' : 'Recruitment cancelled',
              `${row.code || row.id} has been moved to ${isComplete ? 'Completed' : 'Cancelled'}.`,
            );
            setCancelTarget(null);
          } catch (err: any) {
            // The backend's `guardStatusTransition` returns a 422 with the
            // message attached to the `status` field when an opening
            // requirement isn't met — surface that verbatim in a toast so
            // the user knows exactly how many more selections are needed.
            const fieldErr = err?.response?.data?.errors?.status?.[0];
            const message  = fieldErr || err?.response?.data?.message || 'Please try again.';
            toast.error(isComplete ? 'Cannot mark as Completed' : 'Could not cancel', message);
            // Keep the modal open on validation errors so the user can pick
            // the other action without re-clicking the row icon.
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
  // Returns the saved row (already converted to UI shape) so the list modal
  // can prepend it without a refetch. asDraft signals which toast to show.
  onSubmit: (savedRow: HiringRequestRow, asDraft: boolean) => void;
  /* When supplied, the modal opens in EDIT mode: every field is
   * prefilled from this row and Save sends a PUT instead of POST.
   * Drafts are the typical use-case (admin saves a draft, comes back
   * later to finish it), but the same flow works for re-opening any
   * existing request. */
  editing?: HiringRequestRow | null;
  /* Override the default Modal zIndex (2100). Used when this modal
   * is mounted as a SUB-modal of HiringRequestsListModal (also at
   * 2100) so the edit form stacks above its parent's backdrop. */
  zIndex?: number;
}

export function RaiseHiringRequestModal({ isOpen, onClose, onSubmit, editing, zIndex = 2100 }: RaiseHiringRequestModalProps) {
  const toast = useToast();

  // Department options pulled from the Departments master so the dropdown
  // mirrors what's actually configured in Master → Departments. Values are
  // master IDs (stringified) so the FK can be sent without name-matching.
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
            .map(r => ({ value: String(r.id), label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch {
        if (!cancelled) setDeptOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Section 1 — Basics. Team / Sub-Department and Requested By were
  // removed per product call (the requester is already captured by
  // created_by on the row, and Sub-Department wasn't being used
  // downstream).
  const [title, setTitle]               = useState('');
  const [jobRole, setJobRole]           = useState('');
  const [departmentId, setDepartmentId] = useState('');
  // The form's last column was relabelled from Request Date → Target Join
  // Date. The submission timestamp is now sourced from the row's
  // server-generated created_at, so this picker captures *when the user
  // wants the position filled by* and starts blank.
  const [targetDate, setTargetDate]     = useState('');

  // Section 2 — Hiring Need
  // Start EMPTY so the manager makes an explicit choice for every Hiring
  // Need field — no silent pre-selected defaults (1 / Full-time / Onsite /
  // Medium). All four are required, so the validator gates the submit.
  const [openings, setOpenings]         = useState('');
  const [employType, setEmployType]     = useState('');
  const [workMode, setWorkMode]         = useState<'' | 'Onsite' | 'Remote' | 'Hybrid' | 'Flexible'>('');
  const [urgency, setUrgency]           = useState<'' | RequestUrgency>('');

  // Section 3 — Role Details. Preferred Candidate Profile was dropped
  // per product call (overlapped with required_qualification).
  const [jobDesc, setJobDesc]                 = useState('');
  const [dailyResp, setDailyResp]             = useState('');
  const [requiredSkills, setRequiredSkills]   = useState('');
  const [requiredExp, setRequiredExp]         = useState('');
  const [requiredQual, setRequiredQual]       = useState('');

  // Section 4 (Business Justification) was removed entirely. The
  // request_type column on the backend stays nullable; new rows now
  // submit with request_type = null. Hiring Need Reason / Business
  // Justification / Current Team Gap / What If Not Filled were all
  // free-text rationales that the recruitment team rarely consumed.

  const [saving, setSaving] = useState(false);

  // Errors — only fields still on the form.
  type RaiseErrors = Partial<Record<
    'title' | 'jobRole' | 'department' | 'targetDate' | 'openings' | 'employType' | 'workMode' | 'urgency'
    | 'jobDesc' | 'dailyResp' | 'requiredSkills' | 'requiredExp' | 'requiredQual',
    string
  >>;
  const [errors, setErrors] = useState<RaiseErrors>({});

  // Reset / prefill when reopened. When `editing` is supplied (e.g.
  // user clicked Edit on a Draft row), every field is hydrated from
  // the row's _raw payload so the user resumes exactly where they
  // left off. Otherwise we wipe back to defaults for a fresh entry.
  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      const raw: any = editing._raw || {};
      setTitle(String(raw.title || ''));
      setJobRole(String(raw.job_role || editing.position || ''));
      setDepartmentId(raw.department_id != null ? String(raw.department_id) : '');
      setTargetDate(raw.target_join_date ? String(raw.target_join_date).slice(0, 10) : '');
      setOpenings(String(raw.openings ?? editing.openings ?? '1'));
      setEmployType(String(raw.employment_type || editing.positionType || 'Full-time'));
      setWorkMode((raw.work_mode || editing.positionMode || 'Onsite') as any);
      setUrgency((raw.urgency || editing.urgency || 'Medium') as RequestUrgency);
      setJobDesc(String(raw.job_description || ''));
      setDailyResp(String(raw.daily_responsibilities || ''));
      setRequiredSkills(String(raw.required_skills || ''));
      setRequiredExp(String(raw.required_experience || ''));
      setRequiredQual(String(raw.required_qualification || ''));
    } else {
      setTitle(''); setJobRole(''); setDepartmentId(''); setTargetDate('');
      // Empty defaults — manager must pick these explicitly.
      setOpenings(''); setEmployType(''); setWorkMode(''); setUrgency('');
      setJobDesc(''); setDailyResp(''); setRequiredSkills(''); setRequiredExp(''); setRequiredQual('');
    }
    setErrors({}); setSaving(false);
  }, [isOpen, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof RaiseErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): RaiseErrors => {
    const e: RaiseErrors = {};
    if (!title.trim())          e.title          = 'Request title is required';
    if (!jobRole.trim())        e.jobRole        = 'Job role is required';
    if (!departmentId)          e.department     = 'Department is required';
    // Target Join Date — optional, but if supplied must not be in the
    // past. Backs up the picker's minDate guard (paste / devtools /
    // legacy row hydration can bypass the UI control).
    if (targetDate) {
      // Joining date must be from tomorrow onward — today is not allowed.
      const tomorrow = new Date(); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
      const picked = new Date(targetDate); picked.setHours(0, 0, 0, 0);
      if (picked.getTime() < tomorrow.getTime()) {
        e.targetDate = 'Target join date must be from tomorrow onward';
      }
    }
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Openings must be at least 1';
    if (!employType)            e.employType     = 'Employment type is required';
    if (!workMode)              e.workMode       = 'Work mode is required';
    if (!urgency)               e.urgency        = 'Urgency is required';
    // Job Description — required, 20–5000 chars.
    const jd = jobDesc.trim();
    if (!jd)                   e.jobDesc = 'Job description is required';
    else if (jd.length < 20)   e.jobDesc = 'Job description must be at least 20 characters';
    else if (jd.length > 5000) e.jobDesc = 'Job description must be at most 5000 characters';

    // Daily Responsibilities — optional, but 20–3000 chars when provided.
    const dr = dailyResp.trim();
    if (dr) {
      if (dr.length < 20)        e.dailyResp = 'Daily responsibilities must be at least 20 characters';
      else if (dr.length > 3000) e.dailyResp = 'Daily responsibilities must be at most 3000 characters';
    }

    // Required Skills — required, 2–20 skills (comma / new-line separated).
    const skillList = requiredSkills.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (skillList.length === 0)     e.requiredSkills = 'Required skills are required';
    else if (skillList.length < 2)  e.requiredSkills = 'Enter at least 2 skills (separate with commas or new lines)';
    else if (skillList.length > 20) e.requiredSkills = 'Enter at most 20 skills';

    if (!requiredExp)           e.requiredExp    = 'Required experience is required';

    // Required Qualification — required, 2–255 chars.
    const rq = requiredQual.trim();
    if (!rq)                  e.requiredQual = 'Required qualification is required';
    else if (rq.length < 2)   e.requiredQual = 'Qualification must be at least 2 characters';
    else if (rq.length > 255) e.requiredQual = 'Qualification must be at most 255 characters';
    return e;
  };

  const handleSubmit = async (asDraft: boolean) => {
    // Submit-to-HR enforces the full required-field set. Save-as-Draft
    // still requires the minimum needed for the row to exist — Title
    // and Job Role are NOT NULL columns on the hiring_requests table
    // (they identify the draft in the list), so blank values bounce
    // out of the DB as a raw not-null-violation. Catch it client-side
    // and surface clean inline errors instead.
    if (asDraft) {
      const draftErrs: RaiseErrors = {};
      if (!title.trim())   draftErrs.title   = 'Add a title before saving the draft';
      if (!jobRole.trim()) draftErrs.jobRole = 'Add a job role before saving the draft';
      if (Object.keys(draftErrs).length > 0) {
        setErrors(draftErrs);
        toast.error(
          'A few details are required',
          `Add a title and job role first — the rest can wait. ${Object.keys(draftErrs).length} field${Object.keys(draftErrs).length === 1 ? '' : 's'} need attention.`,
        );
        return;
      }
    } else {
      const errs = validate();
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        toast.error('Please complete required fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need attention.`);
        return;
      }
    }

    // Build the API payload — snake_case keys matching the controller.
    // team / requested_by_name / preferred_profile and the whole
    // Business Justification block were removed from the form; their
    // columns stay nullable on the backend so we just send null (or
    // omit). Sending null keeps existing rows intact if the column
    // exists, and is a no-op on installs without it.
    const payload: Record<string, any> = {
      title:                  title.trim() || null,
      job_role:               jobRole.trim() || null,
      department_id:          departmentId ? Number(departmentId) : null,
      // The picker now captures the desired target join date; the
      // server-generated created_at is used for the list's "Req Date"
      // column, so request_date is intentionally not sent.
      target_join_date:       targetDate || null,
      openings:               Number(openings) || 1,
      employment_type:        employType || null,
      work_mode:              workMode || null,
      urgency,
      job_description:        jobDesc || null,
      daily_responsibilities: dailyResp || null,
      required_skills:        requiredSkills || null,
      required_experience:    requiredExp || null,
      required_qualification: requiredQual || null,
      status:                 asDraft ? 'Draft' : 'Submitted',
    };

    setSaving(true);
    try {
      /* Edit mode → PUT to the existing row, create mode → POST.
       * The same payload shape works for both since the backend
       * accepts a full replacement on PUT. */
      const { data } = editing?.id
        ? await api.put(`/hiring-requests/${editing.id}`, payload)
        : await api.post('/hiring-requests', payload);
      onSubmit(apiToHiringRequestRow(data), asDraft);
    } catch (err: any) {
      // Surface server-side validation errors back into the form so the user
      // can correct each field inline rather than chasing a single toast.
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const fieldMap: Record<string, keyof RaiseErrors> = {
          title: 'title', job_role: 'jobRole', department_id: 'department',
          openings: 'openings', employment_type: 'employType', work_mode: 'workMode', urgency: 'urgency',
          job_description: 'jobDesc', required_skills: 'requiredSkills', required_experience: 'requiredExp',
        };
        const mapped: RaiseErrors = {};
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          const ui = fieldMap[k];
          if (ui) mapped[ui] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setErrors(mapped);
        toast.error('Validation failed', 'Please fix the highlighted fields.');
      } else {
        // Detect raw DB-constraint failures bubbling up from a 500. The
        // server returns the full SQLSTATE trace in `message` — surface
        // a friendly version that names the offending column when we
        // can spot it, instead of dumping the connection details into
        // the toast.
        const raw = String(err?.response?.data?.message || '');
        const sqlMatch = /not[- ]null|null value in column ["`']?(\w+)["`']?/i.exec(raw);
        if (sqlMatch) {
          const col = sqlMatch[1] || 'a required field';
          // Reverse-map the DB column → form field so we can highlight it.
          const colToField: Record<string, keyof RaiseErrors> = {
            title: 'title', job_role: 'jobRole', department_id: 'department',
            openings: 'openings', employment_type: 'employType', work_mode: 'workMode', urgency: 'urgency',
            job_description: 'jobDesc', required_skills: 'requiredSkills', required_experience: 'requiredExp',
          };
          const ui = colToField[col];
          if (ui) {
            setErrors(prev => ({ ...prev, [ui]: 'This field is required.' }));
          }
          toast.error(
            'Some details are missing',
            ui ? 'The highlighted field is required.' : `Please fill in ${col.replace(/_/g, ' ')}.`,
          );
        } else {
          toast.error('Could not save', err?.response?.data?.message?.split('\n')[0] || 'Please try again.');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal rec-form-modal-navy" backdropClassName="rec-modal-backdrop" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false} zIndex={zIndex}>
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
              </div>
            </div>
            {/* Section 1 — all four fields share one row at md+; the
                Col span dropped from md={4} → md={3} so 4 columns fit
                across the 12-grid (md={4} gave 3-per-row, wrapping the
                4th onto its own line). */}
            <Row className="g-2">
              <Col md={3}>
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
              <Col md={3}>
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
              <Col md={3}>
                <label className="rec-form-label">Department<span className="req">*</span></label>
                <MasterSelect
                  value={departmentId}
                  onChange={(v) => { setDepartmentId(v); clear('department'); }}
                  options={deptOptions}
                  placeholder={deptOptions.length === 0 ? 'Loading…' : 'Select Department'}
                  invalid={!!errors.department}
                />
                {errors.department && <div className="rec-error"><i className="ri-error-warning-line" />{errors.department}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Target Join Date</label>
                {/* minDate = today so the picker physically blocks
                    selecting a date in the past. errors.targetDate
                    catches values that bypass the picker (paste,
                    devtools, hydration of legacy rows). */}
                <MasterDatePicker
                  value={targetDate}
                  onChange={(v) => { setTargetDate(v); clear('targetDate'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.targetDate}
                  minDate={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                />
                {errors.targetDate && <div className="rec-error"><i className="ri-error-warning-line" />{errors.targetDate}</div>}
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
              </div>
            </div>
            {/* Section 2 — all four fields share one row at md+. Work
                Mode used to be a button grid and Urgency a chip row;
                both became MasterSelect dropdowns so they line up
                with Openings + Employment Type. */}
            <Row className="g-2">
              <Col md={3}>
                <label className="rec-form-label">No. of Openings<span className="req">*</span></label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 1"
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={3}>
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
              <Col md={3}>
                <label className="rec-form-label">Work Mode<span className="req">*</span></label>
                <MasterSelect
                  value={workMode}
                  onChange={(v) => { setWorkMode(v as 'Onsite' | 'Remote' | 'Hybrid' | 'Flexible'); clear('workMode'); }}
                  options={[
                    { value: 'Onsite',   label: 'Onsite'   },
                    { value: 'Remote',   label: 'Remote'   },
                    { value: 'Hybrid',   label: 'Hybrid'   },
                    { value: 'Flexible', label: 'Flexible' },
                  ]}
                  placeholder="Select"
                  invalid={!!errors.workMode}
                />
                {errors.workMode && <div className="rec-error"><i className="ri-error-warning-line" />{errors.workMode}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Urgency Level<span className="req">*</span></label>
                <MasterSelect
                  value={urgency}
                  onChange={(v) => { setUrgency(v as RequestUrgency); clear('urgency'); }}
                  options={(['Low', 'Medium', 'High', 'Critical'] as RequestUrgency[]).map(u => ({ value: u, label: u }))}
                  placeholder="Select"
                  invalid={!!errors.urgency}
                />
                {errors.urgency && <div className="rec-error"><i className="ri-error-warning-line" />{errors.urgency}</div>}
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
                  className={`rec-input rec-textarea${errors.dailyResp ? ' is-invalid' : ''}`}
                  placeholder="Day-to-day tasks and deliverables…"
                  value={dailyResp}
                  onChange={e => { setDailyResp(e.target.value); clear('dailyResp'); }}
                />
                {errors.dailyResp && <div className="rec-error"><i className="ri-error-warning-line" />{errors.dailyResp}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Required Skills<span className="req">*</span></label>
                {/* Textarea (rec-textarea) instead of single-line so the
                    requester can list as many skills as they need —
                    one per line or comma-separated. Width bumped to
                    md=6 to give the longer text room to breathe. */}
                <textarea
                  className={`rec-input rec-textarea${errors.requiredSkills ? ' is-invalid' : ''}`}
                  rows={3}
                  placeholder="e.g. React, Node.js, AWS, Docker, Kubernetes…"
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
                <label className="rec-form-label">Required Qualification<span className="req">*</span></label>
                <input
                  type="text"
                  maxLength={255}
                  className={`rec-input${errors.requiredQual ? ' is-invalid' : ''}`}
                  placeholder="e.g. B.Tech, MBA"
                  value={requiredQual}
                  onChange={e => { setRequiredQual(e.target.value); clear('requiredQual'); }}
                />
                {errors.requiredQual && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requiredQual}</div>}
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
            <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)} disabled={saving}>
              {saving ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-save-3-line" />}
              Save as Draft
            </button>
            <button type="button" className="rec-btn-primary" onClick={() => handleSubmit(false)} disabled={saving}>
              {saving ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-send-plane-line" />}
              Submit to HR
              {!saving && <i className="ri-arrow-right-line" />}
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

export function HiringRequestsListModal({ isOpen, onClose, onRaiseNew, onCreateRecruitment, refreshKey }: HiringRequestsListModalProps & { refreshKey?: number }) {
  const toast = useToast();

  // Top-level tab — splits the list into "Pending" (no recruitment row
  // yet) vs "Recruitment Created" (one or more recruitments link back
  // via hiring_request_id). The membership Set is rebuilt every time
  // the modal opens / the refresh key changes.
  const [tab, setTab] = useState<'pending' | 'created'>('pending');

  const [statusFilter, setStatusFilter]   = useState<string>('All');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('All');
  const [q, setQ] = useState('');

  // Pagination — 5 rows per page by default; configurable via dropdown.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Server-fed list — loaded every time the modal opens (or whenever the
  // parent bumps `refreshKey` after a new request is submitted). We
  // also fetch /recruitments alongside so we can build the set of
  // hiring_request_ids that already have a recruitment, which powers
  // the Pending / Recruitment-Created tab split.
  const [requests, setRequests] = useState<HiringRequestRow[]>([]);
  const [linkedHrIds, setLinkedHrIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [reqRes, recRes] = await Promise.all([
          api.get('/hiring-requests'),
          api.get('/recruitments').catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const rows: any[] = Array.isArray(reqRes.data) ? reqRes.data : [];
        setRequests(rows.map(apiToHiringRequestRow));
        const recs: any[] = Array.isArray(recRes.data) ? recRes.data : [];
        const ids = new Set<number>();
        for (const r of recs) {
          const id = Number(r?.hiring_request_id);
          if (id) ids.add(id);
        }
        setLinkedHrIds(ids);
      } catch (err: any) {
        if (!cancelled) {
          toast.error('Could not load hiring requests', err?.response?.data?.message || 'Please try again.');
          setRequests([]);
          setLinkedHrIds(new Set());
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detail-view sub-modal (when "View" is clicked on a row).
  const [viewing, setViewing] = useState<HiringRequestRow | null>(null);
  /* Draft being edited from the row's pencil-icon button. When set,
   * the RaiseHiringRequestModal opens in edit mode prefilled from
   * this row; a successful save replaces the matching entry in
   * `requests` so the list reflects the new content without a refetch. */
  const [editingDraft, setEditingDraft] = useState<HiringRequestRow | null>(null);

  useEffect(() => { if (!isOpen) { setStatusFilter('All'); setUrgencyFilter('All'); setQ(''); setViewing(null); setEditingDraft(null); setPage(1); setTab('pending'); } }, [isOpen]);
  // Reset to page 1 whenever filters, search or the active tab change
  // so the user never ends up on an empty page after narrowing.
  useEffect(() => { setPage(1); }, [statusFilter, urgencyFilter, q, tab]);

  const stats = useMemo(() => {
    // Counts driven by what the workflow actually produces today:
    // requests start as Draft → Submitted, and once a recruitment is
    // raised they show up under the cross-referenced "Recruitment
    // Created" bucket. Under Review / Approved / Sent Back / Rejected
    // KPIs were retired because no path in the app sets those statuses
    // — they were aspirational and always read as zero.
    const total              = requests.length;
    const draft              = requests.filter(r => r.status === 'Draft').length;
    const submitted          = requests.filter(r => r.status === 'Submitted').length;
    const critical           = requests.filter(r => r.urgency === 'Critical').length;
    const recruitmentCreated = requests.filter(r => linkedHrIds.has(Number(r.id))).length;
    return { total, draft, submitted, critical, recruitmentCreated };
  }, [requests, linkedHrIds]);

  // Tab partition runs FIRST so the count on each tab reflects the
  // server-fed list, not the post-filter slice. Subsequent filters
  // (status / urgency / search) then narrow within the active tab.
  const tabRequests = useMemo(() => {
    return requests.filter(r => {
      const linked = linkedHrIds.has(Number(r.id));
      return tab === 'created' ? linked : !linked;
    });
  }, [requests, linkedHrIds, tab]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tabRequests
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => urgencyFilter === 'All' || r.urgency === urgencyFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          (r.code || '').toLowerCase().includes(needle) ||
          r.position.toLowerCase().includes(needle) ||
          r.department.toLowerCase().includes(needle) ||
          r.requestedByName.toLowerCase().includes(needle)
        );
      });
  }, [tabRequests, statusFilter, urgencyFilter, q]);

  // Per-tab counts for the badge pills.
  const pendingCount = useMemo(() => requests.filter(r => !linkedHrIds.has(Number(r.id))).length, [requests, linkedHrIds]);
  const createdCount = useMemo(() => requests.filter(r =>  linkedHrIds.has(Number(r.id))).length, [requests, linkedHrIds]);

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
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-req-modal" backdropClassName="rec-modal-backdrop" contentClassName="rec-req-content border-0" backdrop="static" keyboard={false} zIndex={2100}>
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
            {/* "Raise New Request" intentionally removed — hiring
                requests can only originate from a manager's own Employee
                Profile > Hiring Requests tab. HR uses this modal to
                review + convert to a recruitment. */}
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {/* KPI strip — premium vivid gradient palette per status */}
        <div className="rec-req-stats">
          {[
            { label: 'Total',                value: stats.total,              icon: 'ri-file-list-3-line',     accent: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
            { label: 'Draft',                value: stats.draft,              icon: 'ri-draft-line',           accent: 'linear-gradient(135deg, #525252 0%, #737373 60%, #a3a3a3 100%)', deep: '#525252' },
            { label: 'Submitted',            value: stats.submitted,          icon: 'ri-send-plane-line',      accent: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 60%, #a855f7 100%)', deep: '#7c3aed' },
            { label: 'Recruitment Created',  value: stats.recruitmentCreated, icon: 'ri-user-search-line',     accent: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
            { label: 'Critical',             value: stats.critical,           icon: 'ri-flashlight-line',      accent: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
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

        {/* Tab strip — Pending Requests vs Recruitment Created. The
            count badge reflects the server-fed list, not the filtered
            view, so the user can see at a glance how many sit in each
            bucket regardless of search / status filters. */}
        <div className="rec-req-tab-strip d-flex align-items-center gap-2 flex-wrap" style={{ padding: '8px 18px 0' }}>
          {([
            { key: 'pending', label: 'Pending Hiring Requests', icon: 'ri-time-line',  count: pendingCount },
            { key: 'created', label: 'Recruitment Created',     icon: 'ri-user-search-line', count: createdCount },
          ] as const).map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="btn d-inline-flex align-items-center gap-2 fw-semibold"
                style={{
                  background: active ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'var(--vz-secondary-bg)',
                  color: active ? '#fff' : 'var(--vz-secondary-color)',
                  border: active ? 'none' : '1px solid var(--vz-border-color)',
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  boxShadow: active ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
                }}
              >
                <i className={t.icon} style={{ fontSize: 14 }} />
                {t.label}
                <span style={{
                  marginLeft: 2,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: active ? 'rgba(255,255,255,0.25)' : '#fff',
                  color: active ? '#fff' : '#4338ca',
                }}>{t.count}</span>
              </button>
            );
          })}
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
                    {requests.length === 0
                      ? 'No hiring requests yet — managers raise these from their Employee Profile > Hiring Requests tab.'
                      : tabRequests.length === 0
                        ? (tab === 'created'
                            ? 'No hiring requests have been promoted into a recruitment yet.'
                            : 'Every hiring request has been moved into a recruitment.')
                        : 'No requests match your filters'}
                  </td>
                </tr>
              ) : visible.map(r => {
                const u = REQUEST_URGENCY_TONES[r.urgency];
                const statusColor = REQUEST_STATUS_COLOR[r.status];
                return (
                  <tr key={r.id}>
                    <td className="ps-4"><span className="rec-id-pill">{r.code || r.id}</span></td>
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
                      <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
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
                        {/* Edit — Draft rows only. Once a request is
                            Submitted it's committed for HR review and
                            shouldn't be editable in place; the admin
                            would create a new request instead. */}
                        {r.status === 'Draft' && (
                          <button
                            type="button"
                            className="rec-act rec-act-edit rec-act--icon"
                            onClick={() => setEditingDraft(r)}
                            title="Edit Draft"
                            aria-label="Edit Draft"
                          >
                            <i className="ri-pencil-line" />
                          </button>
                        )}
                        {/* Create-Recruitment is only meaningful for
                            rows in the Pending tab. Rows in the
                            "Recruitment Created" tab already have one,
                            so we hide the button to prevent a second
                            recruitment from being raised against the
                            same hiring request. */}
                        {tab === 'pending' && (
                          <button
                            type="button"
                            className="rec-act rec-act-create rec-act--icon"
                            onClick={() => onCreateRecruitment(r)}
                            title="Create Recruitment"
                            aria-label="Create Recruitment"
                          >
                            <i className="ri-user-search-line" />
                          </button>
                        )}
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
      <ViewHiringRequestModal
        request={viewing}
        onClose={() => setViewing(null)}
        onReject={async (req) => {
          try {
            const { data } = await api.put(`/hiring-requests/${req.id}`, { status: 'Rejected' });
            const saved = apiToHiringRequestRow(data);
            setRequests(prev => prev.map(x => x.id === saved.id ? saved : x));
            toast.success('Request rejected', `${saved.code || saved.id} has been moved to Rejected.`);
            setViewing(null);
          } catch (err: any) {
            const message = err?.response?.data?.message || 'Please try again.';
            toast.error('Could not reject request', message);
          }
        }}
      />

      {/* Edit Draft sub-modal — opens when the pencil-icon button on a
          Draft row is clicked. Reuses RaiseHiringRequestModal in edit
          mode (PUT instead of POST). On save we splice the updated row
          back into `requests` so the list reflects the change without
          a full refetch round-trip. */}
      <RaiseHiringRequestModal
        isOpen={!!editingDraft}
        onClose={() => setEditingDraft(null)}
        editing={editingDraft}
        zIndex={2200}
        onSubmit={(saved) => {
          setRequests(prev => prev.map(r => r.id === saved.id ? saved : r));
          setEditingDraft(null);
        }}
      />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View Hiring Request — read-only detail modal
// ─────────────────────────────────────────────────────────────────────────────

function ViewHiringRequestModal({ request, onClose, onReject }: {
  request: HiringRequestRow | null;
  onClose: () => void;
  /** Rejects the request (PUT status=Rejected) — handled by the parent so
   *  the list row updates in place. Resolves when the API call settles. */
  onReject?: (req: HiringRequestRow) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  if (!request) return null;
  const r = request;
  // Already-closed requests can't be rejected again.
  const canReject = !!onReject && !['Rejected', 'Approved'].includes(r.status);
  // _raw carries the full API row including the long-text fields
  // (job_description, daily_responsibilities, required_skills, …).
  // We read everything off it so the view matches every field on the
  // raise form one-to-one.
  const raw = r._raw || {};
  const u = REQUEST_URGENCY_TONES[r.urgency];
  const statusColor = REQUEST_STATUS_COLOR[r.status];
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="rec-view-field">
      <div className="rec-view-label">{label}</div>
      <div className="rec-view-value">{value !== undefined && value !== null && value !== '' ? value : <span className="text-muted">—</span>}</div>
    </div>
  );
  const SectionHeader = ({ icon, title }: { icon: string; title: string }) => (
    <div className="d-flex align-items-center gap-2" style={{ margin: '14px 0 8px' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className={icon} style={{ fontSize: 14 }} />
      </span>
      <div className="fw-bold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{title}</div>
    </div>
  );
  // Long-text fields look nicer in their own paragraph below the grid
  // instead of squashed into a single Field cell.
  const LongText = ({ label, value }: { label: string; value: any }) => {
    if (!value) return null;
    return (
      <div style={{ padding: '10px 14px', background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--vz-body-color)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{value}</div>
      </div>
    );
  };
  return (
    /* zIndex must clear the parent HiringRequestsListModal's 2100.
     * Without this the View sub-modal opened but rendered behind the
     * parent modal's backdrop — clicking the eye icon appeared to "do
     * nothing" because the user never saw the new layer. */
    <Modal isOpen={!!request} toggle={onClose} centered size="lg" backdrop="static" contentClassName="rec-view-content border-0" zIndex={2200}>
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-eye-line" style={{ fontSize: 18 }} />
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  {r.position} <span style={{ opacity: 0.8 }}>· {r.code || r.id}</span>
                </h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Requested by {r.requestedByName} · {r.department}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rec-view-body" style={{ padding: '14px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {/* Section 1 — Request Basics */}
          <SectionHeader icon="ri-calendar-event-line" title="Section 1 · Request Basics" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="Request Title"    value={raw.title} />
              <Field label="Job Role"         value={raw.job_role || r.position} />
              <Field label="Department"       value={r.department} />
              <Field label="Target Join Date" value={formatDate(r.targetJoinDate)} />
            </div>
          </div>

          {/* Section 2 — Hiring Need */}
          <SectionHeader icon="ri-time-line" title="Section 2 · Hiring Need" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="No. of Openings"  value={r.openings} />
              <Field label="Employment Type"  value={raw.employment_type || r.positionType} />
              <Field label="Work Mode"        value={raw.work_mode || r.positionMode} />
              <Field label="Urgency Level"    value={<span className="rec-pill" style={{ background: u.bg, color: u.fg }}>{r.urgency}</span>} />
            </div>
          </div>

          {/* Section 3 — Role Details */}
          <SectionHeader icon="ri-team-line" title="Section 3 · Role Details" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="Required Experience"   value={raw.required_experience} />
              <Field label="Required Qualification" value={raw.required_qualification} />
            </div>
            <div style={{ marginTop: 10 }}>
              <LongText label="Job Description"         value={raw.job_description} />
              <LongText label="Daily Responsibilities"  value={raw.daily_responsibilities} />
              <LongText label="Required Skills"         value={raw.required_skills} />
            </div>
          </div>

          {/* Meta — surface status + request timestamps below so the
              read-only view still shows the lifecycle context. */}
          <SectionHeader icon="ri-information-line" title="Status &amp; Timeline" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="Status" value={
                <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
                  {r.status}
                </span>
              } />
              <Field label="Request Date" value={formatDate(r.requestDate)} />
              <Field label="Requested By" value={r.requestedByName} />
              <Field label="Request Code" value={r.code} />
            </div>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint">{canReject ? 'Review this request — reject it if it should not proceed' : 'Read-only view'}</span>
          <div className="d-flex gap-2">
            {canReject && (
              <button
                type="button"
                className="rec-cancel-confirm"
                disabled={rejecting}
                onClick={async () => {
                  if (rejecting || !onReject) return;
                  setRejecting(true);
                  try { await onReject(r); }
                  finally { setRejecting(false); }
                }}
                style={{ background: 'linear-gradient(135deg, #b42318 0%, #f04438 100%)' }}
              >
                {rejecting ? (
                  <><Spinner size="sm" style={{ width: 14, height: 14 }} /><span>Rejecting…</span></>
                ) : (
                  <><i className="ri-close-circle-line" />Reject Request</>
                )}
              </button>
            )}
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={rejecting}>
              <i className="ri-close-line" />Close
            </button>
          </div>
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
  // Optional raw hiring-request API row. When provided in 'add' mode the
  // form pre-fills with values mapped from the request — the user only
  // has to fill in the recruitment-specific extras (designation, primary
  // role, hiring manager, assigned HR, dates). Ignored in 'edit' mode.
  prefillFromHr?: any | null;
  onSaved: (row: RecruitmentRow) => void;
  onClose: () => void;
}


/* Skeleton for the Create / Edit Recruitment form body. Renders while
 * the four parallel master fetches (departments / designations / roles
 * / employees) are in flight on modal open. Mirrors the actual section
 * layout so the swap to the populated form is a single repaint instead
 * of a layout-shift jolt. */
function RecruitmentFormShimmer() {
  const SectionHead = ({ title }: { title: string }) => (
    <div className="rec-form-section-head" style={{ marginBottom: 10 }}>
      <span className="rec-form-section-icon rec-form-section-icon--soft">
        <Shimmer width={18} height={18} radius={4} />
      </span>
      <Shimmer width={Math.max(120, title.length * 7)} height={14} />
    </div>
  );
  const FieldBlock = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Shimmer width={90} height={10} />
      <Shimmer height={34} radius={8} />
    </div>
  );
  const Grid = ({ cols, items }: { cols: number; items: number }) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12, marginBottom: 14 }}>
      {Array.from({ length: items }).map((_, i) => <FieldBlock key={i} />)}
    </div>
  );
  return (
    <div className="rec-form-section">
      <SectionHead title="Position Details" />
      <Grid cols={1} items={1} />
      <Grid cols={3} items={3} />
      <Grid cols={3} items={3} />
      <Grid cols={2} items={2} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <Shimmer width={70} height={28} radius={14} />
        <Shimmer width={70} height={28} radius={14} />
        <Shimmer width={70} height={28} radius={14} />
      </div>

      <SectionHead title="Hiring Configuration" />
      <Grid cols={4} items={4} />

      <SectionHead title="Job Details" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Shimmer width={90} height={10} />
          <Shimmer height={72} radius={8} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Shimmer width={90} height={10} />
          <Shimmer height={72} radius={8} />
        </div>
      </div>
    </div>
  );
}

const HR_TO_REC_EMP_TYPE: Record<string, EmployType> = {
  'Full-time':  'Full Time',
  'Part-time':  'Part Time',
  'Contract':   'Contract',
  'Intern':     'Internship',
  // Pass-through if the value is already in the recruitment shape.
  'Full Time':  'Full Time',
  'Part Time':  'Part Time',
  'Internship': 'Internship',
};
const HR_TO_REC_WORK_MODE: Record<string, WorkMode> = {
  'Onsite':   'On-site',
  'Remote':   'Remote',
  'Hybrid':   'Hybrid',
  'Flexible': 'Flexible',
  'On-site':  'On-site',
};

/* Processed master-data the Create/Edit Recruitment modal needs. Cached at
 * module scope so we only pay the 4-call master fetch once per session — the
 * first open shows a skeleton, every open after that hydrates instantly and
 * refreshes silently in the background (fixes the ~5s reopen wait). */
type RecMastersCache = {
  deptOptions: { value: string; label: string }[];
  desigOptions: { value: string; label: string }[];
  desigByDept: Record<string, { value: string; label: string }[]>;
  roleOptions: { value: string; label: string }[];
  employeeOptions: { value: string; label: string }[];
};
let recMastersCache: RecMastersCache | null = null;

function buildRecMasters(deptData: any, desigData: any, roleData: any, empData: any): RecMastersCache {
  const deptRows: any[]  = Array.isArray(deptData)  ? deptData  : [];
  const desigRows: any[] = Array.isArray(desigData) ? desigData : [];
  const roleRows: any[]  = Array.isArray(roleData)  ? roleData  : [];
  const empRows: any[]   = Array.isArray(empData)   ? empData   : [];

  // Active-only filter — masters expose a 'status' column; treat
  // missing/blank status as active so older rows still show up.
  const isActiveLower = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';

  const deptOptions = deptRows
    .filter(isActiveLower)
    .map(r => ({ value: String(r.id), label: r.name as string }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  // Designations grouped by department_id so picking a department narrows
  // the list, with the full list kept as a fallback.
  const desigByDept: Record<string, { value: string; label: string }[]> = {};
  const desigOptions: { value: string; label: string }[] = [];
  desigRows.filter(isActiveLower).forEach(r => {
    if (!r.name) return;
    const opt = { value: String(r.id), label: r.name as string };
    desigOptions.push(opt);
    if (r.department_id != null) {
      const k = String(r.department_id);
      (desigByDept[k] ||= []).push(opt);
    }
  });
  Object.keys(desigByDept).forEach(k => desigByDept[k].sort((a, b) => a.label.localeCompare(b.label)));
  desigOptions.sort((a, b) => a.label.localeCompare(b.label));

  const roleOptions = roleRows
    .filter(isActiveLower)
    .map(r => ({ value: String(r.id), label: r.name as string }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Employees → Hiring Manager + Assigned HR dropdowns. The /employees
  // endpoint already restricts to onboarded + active staff (see
  // EmployeeController::index) so only valid pickers reach here.
  const employeeOptions = empRows
    .map(e => {
      const name = e.display_name
        || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ')
        || `Employee #${e.id}`;
      const desig = e?.designation?.name ? ` — ${e.designation.name}` : '';
      return { value: String(e.id), label: `${name}${desig}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { deptOptions, desigOptions, desigByDept, roleOptions, employeeOptions };
}

function CreateRecruitmentModal({ isOpen, mode, editingId, recruitments, prefillFromHr, onSaved, onClose }: CreateRecruitmentModalProps) {
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
  // Open blank so the user makes a deliberate choice — these used to be
  // pre-filled (Full Time / 1 / Hybrid) which QA flagged as silent defaults.
  const [employmentType, setEmploymentType]   = useState<EmployType | ''>('');
  const [openings, setOpenings]               = useState('');
  const [experience, setExperience]           = useState('');
  const [workMode, setWorkMode]               = useState<WorkMode | ''>('');
  const [priority, setPriority]               = useState<Priority>('Medium');
  const [hiringManagerId, setHiringManagerId] = useState('');
  const [assignedHrId, setAssignedHrId]       = useState('');
  const [startDate, setStartDate]             = useState('');
  const [deadline, setDeadline]               = useState('');
  const [jobDescription, setJobDescription]   = useState('');
  const [requirements, setRequirements]       = useState('');
  const [ctcRange, setCtcRange]               = useState('');
  // Defaults flipped to off — admins were complaining the toggles
  // came pre-checked, which made the form look stuck in "yes to
  // everything" mode. They opt in explicitly now.
  const [postOnPortal, setPostOnPortal]       = useState(false);
  const [notifyTeamLeads, setNotifyTeamLeads] = useState(false);
  const [enableReferralBonus, setEnableReferralBonus] = useState(false);

  // ── Master dropdown options — values are master IDs (stringified) so the
  // payload can send the FK without name-matching. Labels come from the
  // master tables and remain user-friendly.
  const [deptOptions, setDeptOptions]   = useState<{ value: string; label: string }[]>([]);
  const [desigOptions, setDesigOptions] = useState<{ value: string; label: string }[]>([]);
  const [desigByDept, setDesigByDept]   = useState<Record<string, { value: string; label: string }[]>>({});
  const [roleOptions, setRoleOptions]   = useState<{ value: string; label: string }[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<{ value: string; label: string }[]>([]);
  /* Master-data loading flag — flipped on while the four parallel
   * master fetches run so the form body can show a skeleton instead
   * of empty fields + non-selectable dropdowns. Used to be hidden:
   * dropdowns rendered with `[]` options the moment the modal opened
   * and the user saw "no items" until the fetch landed, which made
   * Edit Recruitment look broken on slow networks. */
  const [mastersLoading, setMastersLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const hydrate = (c: RecMastersCache) => {
      setDeptOptions(c.deptOptions);
      setDesigOptions(c.desigOptions);
      setDesigByDept(c.desigByDept);
      setRoleOptions(c.roleOptions);
      setEmployeeOptions(c.employeeOptions);
    };

    // Cache hit → render instantly (no skeleton) and refresh silently below.
    // Cache miss → show the skeleton while the first fetch runs.
    if (recMastersCache) {
      hydrate(recMastersCache);
      setMastersLoading(false);
    } else {
      setMastersLoading(true);
    }

    (async () => {
      try {
        const [deptRes, desigRes, roleRes, empRes] = await Promise.all([
          api.get('/master/departments'),
          api.get('/master/designations'),
          api.get('/master/roles'),
          // onboarded_only → Hiring Manager / Assigned HR dropdowns only list
          // fully-onboarded, active employees (HRMS-BUG-048 / 049).
          api.get('/employees', { params: { onboarded_only: 1 } }),
        ]);
        if (cancelled) return;
        const cache = buildRecMasters(deptRes.data, desigRes.data, roleRes.data, empRes.data);
        recMastersCache = cache;
        hydrate(cache);
      } catch {
        // Soft-fail — only blank the dropdowns if we never had cached data,
        // otherwise keep the (stale-but-usable) cached values on screen.
        if (!cancelled && !recMastersCache) {
          setDeptOptions([]);
          setDesigOptions([]);
          setDesigByDept({});
          setRoleOptions([]);
          setEmployeeOptions([]);
        }
      } finally {
        if (!cancelled) setMastersLoading(false);
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
    } else if (prefillFromHr) {
      // "Create Recruitment" was clicked from a hiring request — seed the
      // form with everything the request already captured. The user still
      // has to pick the recruitment-only fields (designation / primary
      // role / hiring manager / assigned HR / dates).
      const hr = prefillFromHr;
      setJobTitle((hr.job_role || hr.title || '') as string);
      setDepartmentId(hr.department_id != null ? String(hr.department_id) : '');
      // Designation and primary role aren't captured on the hiring request
      // — leave blank so the user is forced to make an explicit choice.
      setDesignationId('');
      setPrimaryRoleId('');
      setCtcRange('');
      // Seed from the request's own values; if a field is missing/unmapped
      // leave it blank rather than forcing a silent default (HRMS-BUG-076).
      setEmploymentType((HR_TO_REC_EMP_TYPE[hr.employment_type] || '') as EmployType | '');
      setOpenings(hr.openings ? String(hr.openings) : '');
      setExperience((hr.required_experience || '') as string);
      setWorkMode((HR_TO_REC_WORK_MODE[hr.work_mode] || '') as WorkMode | '');
      // urgency on the request maps directly to priority on the recruitment
      // (same Critical / High / Medium / Low vocabulary).
      setPriority((hr.urgency || 'Medium') as Priority);
      setHiringManagerId('');
      setAssignedHrId('');
      // Start date is "now" semantically; the request only captures a
      // target join date, which feeds the recruitment's TAT/deadline.
      setStartDate('');
      setDeadline(hr.target_join_date ? String(hr.target_join_date).slice(0, 10) : '');
      setJobDescription((hr.job_description || '') as string);
      // Combine skills + qualifications into the recruitment's single
      // Requirements field — the request splits them, the recruitment
      // doesn't.
      const reqParts = [hr.required_skills, hr.required_qualification].filter(Boolean);
      setRequirements(reqParts.join('\n'));
      setPostOnPortal(false); setNotifyTeamLeads(false); setEnableReferralBonus(false);
      setErrors({});
    } else {
      setJobTitle(''); setDepartmentId(''); setDesignationId(''); setPrimaryRoleId('');
      setCtcRange(''); setEmploymentType('');
      setOpenings(''); setExperience(''); setWorkMode(''); setPriority('Medium');
      setHiringManagerId(''); setAssignedHrId(''); setStartDate(''); setDeadline('');
      setJobDescription(''); setRequirements('');
      setPostOnPortal(false); setNotifyTeamLeads(false); setEnableReferralBonus(false);
      setErrors({});
    }
  }, [isOpen, editingId, prefillFromHr]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof CreateErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): CreateErrors => {
    const e: CreateErrors = {};
    if (!jobTitle.trim())        e.jobTitle        = 'Job title is required';
    if (!departmentId)           e.department      = 'Department is required';
    if (!designationId)          e.designation     = 'Designation is required';
    if (!primaryRoleId)          e.primaryRole     = 'Primary role is required';
    if (!employmentType)         e.employmentType  = 'Employment type is required';
    // Openings — required + positive integer + within the DB cap (9999).
    // The backend's plain "must be an integer" message used to leak when
    // a JS-stringified very-large number was coerced to a float; catch
    // each case here with a clear, actionable explanation.
    const openingsTrim = openings.trim();
    if (!openingsTrim) {
      e.openings = 'No. of openings is required';
    } else {
      const n = Number(openingsTrim);
      if (!Number.isFinite(n)) {
        e.openings = 'Enter a valid number';
      } else if (!Number.isInteger(n) || /[^0-9]/.test(openingsTrim)) {
        e.openings = 'Openings must be a whole number (no decimals or symbols)';
      } else if (n < 1) {
        e.openings = 'Openings must be at least 1';
      } else if (n > 9999) {
        e.openings = 'Openings cannot exceed 9,999 — split this requisition if you need more';
      }
    }
    // CTC range — optional free text but the column tops out at 50
    // chars and the salary range itself shouldn't exceed 9999.99 LPA
    // per opening. Pull every numeric token out and bounds-check it
    // so "1000000-2000000" type pastes get a clear inline error
    // instead of a silent 422 from the server.
    const ctc = ctcRange.trim();
    if (!ctc) {
      e.ctcRange = 'CTC range is required';
    } else if (ctc.length > 50) {
      e.ctcRange = 'CTC range cannot exceed 50 characters';
    } else {
      const nums = ctc.match(/\d+(?:\.\d+)?/g) || [];
      if (nums.length === 0) {
        e.ctcRange = 'Enter a valid CTC range (e.g. 8-12)';
      } else if (nums.some(num => Number(num) > 9999.99)) {
        e.ctcRange = 'CTC values cannot exceed 9,999.99 LPA';
      }
    }
    if (!priority)               e.priority        = 'Priority is required';
    if (!experience)             e.experience      = 'Experience level is required';
    if (!hiringManagerId)        e.hiringManager   = 'Hiring manager is required';
    if (!assignedHrId)           e.assignedHr      = 'Assigned HR is required';
    /* Hiring Manager and Assigned HR must be different employees —
     * they have different responsibilities on the recruitment workflow
     * (HM owns interviews, HR owns coordination/offer), so the same
     * person can't hold both seats. Without this check, users were
     * accidentally selecting the same employee in both dropdowns and
     * downstream notification routing got confused. */
    if (hiringManagerId && assignedHrId && hiringManagerId === assignedHrId) {
      e.assignedHr = 'Assigned HR must be a different person from the Hiring Manager';
    }
    if (!startDate)              e.startDate       = 'Start date is required';
    if (!deadline)               e.deadline        = 'TAT/Deadline is required';
    // ISO yyyy-mm-dd values compare lexicographically — no Date()
    // ceremony needed. Start date can't be in the past, and the
    // deadline can't be before the start date. Both checks run only
    // when the respective fields are non-empty so the "required"
    // errors above stay the primary message.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (startDate && startDate < todayIso) {
      e.startDate = 'Start date cannot be in the past';
    }
    if (deadline && startDate && deadline < startDate) {
      e.deadline = 'TAT/Deadline cannot be before the start date';
    }
    if (!jobDescription.trim()) e.jobDescription = 'Job description is required';
    if (!requirements.trim())   e.requirements   = 'Requirements are required';
    return e;
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Surface the first error verbatim in the toast so the user
      // sees the actual constraint (e.g. "Openings cannot exceed
      // 9,999") instead of a generic count. Falls back to the count
      // when more than one field is wrong.
      const keys = Object.keys(errs);
      const firstMsg = errs[keys[0] as keyof CreateErrors] as string | undefined;
      const heading  = 'Please fix the highlighted fields';
      const body = keys.length === 1
        ? (firstMsg || 'One field needs attention.')
        : `${firstMsg || ''}${firstMsg ? ' ' : ''}(${keys.length - 1} more ${keys.length === 2 ? 'field needs' : 'fields need'} attention.)`;
      toast.error(heading, body);
      return;
    }

    // Backend payload — snake_case keys, FK ids cast back to integers.
    // When the form opened pre-filled from a hiring request, stamp that
    // id on the new recruitment so the Hiring Requests list's
    // "Recruitment Created" tab can surface it. Edit mode leaves the
    // existing link untouched (omits the key).
    const payload: Record<string, any> = {
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
    if (mode === 'add' && prefillFromHr?.id) {
      payload.hiring_request_id = Number(prefillFromHr.id);
    }

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
      // Surface any per-field validation errors back into the form,
      // rewriting the Laravel-default phrasing for openings / ctc so
      // a runaway number doesn't read as "must be an integer".
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        const fieldMap: Record<string, string> = {
          job_title: 'jobTitle', employment_type: 'employmentType',
          department_id: 'department', designation_id: 'designation', primary_role_id: 'primaryRole',
          hiring_manager_id: 'hiringManager', assigned_hr_id: 'assignedHr',
          start_date: 'startDate', deadline: 'deadline', work_mode: 'workMode',
          openings: 'openings', ctc_range: 'ctcRange',
        };
        // Friendlier wording for the two fields that historically
        // surfaced Laravel's terse defaults.
        const rewrite = (col: string, msg: string): string => {
          const lower = msg.toLowerCase();
          if (col === 'openings') {
            if (lower.includes('integer'))             return 'Openings must be a whole number (no decimals or symbols).';
            if (lower.includes('max') || lower.includes('not be greater')) return 'Openings cannot exceed 9,999 — split this requisition if you need more.';
            if (lower.includes('min') || lower.includes('at least'))       return 'Openings must be at least 1.';
          }
          if (col === 'ctc_range' && (lower.includes('max') || lower.includes('characters')))
            return 'CTC range cannot exceed 50 characters.';
          return msg;
        };
        let firstMsg = '';
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          const raw = Array.isArray(v) ? String(v[0]) : String(v);
          const pretty = rewrite(k, raw);
          mapped[fieldMap[k] || k] = pretty;
          if (!firstMsg) firstMsg = pretty;
        }
        setErrors(mapped);
        toast.error('Please fix the highlighted fields', firstMsg || 'Some inputs need attention.');
      } else {
        toast.error('Could not save', err?.response?.data?.message?.split('\n')[0] || 'Please try again.');
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
          {/* Source banner — only shown when this Create Recruitment was
              opened from a hiring request, so the recruiter knows where the
              prefilled values came from. */}
          {mode === 'add' && prefillFromHr && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: 10,
                borderRadius: 10,
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                color: '#3730a3',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <i className="ri-link" />
              <span>
                Prefilled from hiring request <strong>{prefillFromHr.code || `HRQ-${prefillFromHr.id}`}</strong>
                {prefillFromHr.title ? <> — {prefillFromHr.title}</> : null}
                . Pick the recruitment-only fields (Designation, Primary Role, Hiring Manager, Assigned HR, dates) and save.
              </span>
            </div>
          )}
          <div className="rec-form-card">
          {mastersLoading ? (
            <RecruitmentFormShimmer />
          ) : (
          <>
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
                {/* min/max + step=1 also gate the spinner buttons so
                    the picker can't crawl past 9999 without the user
                    typing or pasting a runaway value. The validator
                    catches typed/pasted overruns. */}
                <input
                  type="number"
                  min={1}
                  max={9999}
                  step={1}
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-history-line" />Experience Required<span className="req">*</span></label>
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
                <label className="rec-form-label"><i className="ri-money-rupee-circle-line" />CTC Range (LPA)<span className="req">*</span></label>
                <input
                  type="text"
                  maxLength={50}
                  inputMode="decimal"
                  className={`rec-input${errors.ctcRange ? ' is-invalid' : ''}`}
                  placeholder="e.g. 8-12"
                  value={ctcRange}
                  // Live-validate as the user types so a too-large value
                  // surfaces inline + via toast immediately, instead of
                  // waiting for submit. Field is denominated in LPA, so
                  // a value > 9,999.99 is almost certainly the user
                  // pasting raw rupees by mistake.
                  onChange={e => {
                    // Restrict to digits, spaces, hyphen and dot — block
                    // alphabets and other special characters outright so the
                    // field can only ever hold a salary range like "8-12".
                    const v = e.target.value.replace(/[^0-9.\s-]/g, '');
                    setCtcRange(v);
                    const trimmed = v.trim();
                    if (!trimmed) { clear('ctcRange'); return; }
                    if (trimmed.length > 50) {
                      setErrors(prev => ({ ...prev, ctcRange: 'CTC range cannot exceed 50 characters' }));
                      return;
                    }
                    const nums = trimmed.match(/\d+(?:\.\d+)?/g) || [];
                    const bad  = nums.find(n => Number(n) > 9999.99);
                    if (bad) {
                      setErrors(prev => ({
                        ...prev,
                        ctcRange: `${Number(bad).toLocaleString('en-IN')} exceeds the 9,999.99 LPA cap — values are in lakhs per annum`,
                      }));
                      // One-shot toast — only when there wasn't already an
                      // error on this field, otherwise the user gets
                      // spammed on every keystroke.
                      if (!errors.ctcRange) {
                        toast.error('CTC out of range', 'Values are in LPA. The cap is 9,999.99 — looks like raw rupees were entered.');
                      }
                      return;
                    }
                    clear('ctcRange');
                  }}
                />
                {errors.ctcRange && <div className="rec-error"><i className="ri-error-warning-line" />{errors.ctcRange}</div>}
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
                {/* Picker can't open on a day before today; the inline
                    error in validate() catches values that bypass the
                    picker (paste, devtools, etc.). */}
                <MasterDatePicker
                  value={startDate}
                  onChange={(v) => { setStartDate(v); clear('startDate'); clear('deadline'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.startDate}
                  minDate={new Date().toISOString().slice(0, 10)}
                />
                {errors.startDate && <div className="rec-error"><i className="ri-error-warning-line" />{errors.startDate}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-calendar-event-line" />TAT / Deadline<span className="req">*</span></label>
                {/* Deadline picker floor = start date (or today as a
                    fallback when start hasn't been picked yet) so the
                    user can't choose a deadline before the kickoff. */}
                <MasterDatePicker
                  value={deadline}
                  onChange={(v) => { setDeadline(v); clear('deadline'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.deadline}
                  minDate={startDate || new Date().toISOString().slice(0, 10)}
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
                <label className="rec-form-label"><i className="ri-file-text-line" />Job Description<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.jobDescription ? ' is-invalid' : ''}`}
                  placeholder="Key responsibilities, expectations, and role overview…"
                  value={jobDescription}
                  onChange={e => { setJobDescription(e.target.value); clear('jobDescription'); }}
                />
                {errors.jobDescription && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobDescription}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label"><i className="ri-list-check-2" />Requirements<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.requirements ? ' is-invalid' : ''}`}
                  placeholder="Required skills, qualifications, certifications…"
                  value={requirements}
                  onChange={e => { setRequirements(e.target.value); clear('requirements'); }}
                />
                {errors.requirements && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requirements}</div>}
              </Col>
            </Row>
          </div>
          </>
          )}
          </div>
          {/* /rec-form-card */}

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

type StatusAction = 'cancel' | 'complete';

function CancelConfirmModal({
  target, candidateCount, initialAction, onClose, onConfirm,
}: {
  target: RecruitmentRow | null;
  candidateCount?: number;
  /** Pre-selects the action chooser based on which row-button was
   *  clicked. The user can still flip between Cancel / Complete once
   *  the modal is open. */
  initialAction?: StatusAction;
  onClose: () => void;
  // Returns the chosen action so the parent can flip the status to either
  // 'Cancelled' or 'Completed'. The reason field is only meaningful for
  // cancellations and is sent as an empty string for completions.
  onConfirm: (action: StatusAction, reason: string, notes: string) => void | Promise<void>;
}) {
  const [action, setAction]   = useState<StatusAction>('cancel');
  const [reason, setReason]   = useState<string>('');
  const [notes, setNotes]     = useState<string>('');
  const [reasonErr, setReasonErr] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);

  // Reset form whenever a new target is selected / modal closes. The
  // pre-selected action comes from whichever button the user clicked
  // on the row (Complete / Cancel) so they land on the right tab.
  useEffect(() => {
    if (target) { setAction(initialAction || 'cancel'); setReason(''); setNotes(''); setReasonErr(false); setConfirming(false); }
  }, [target, initialAction]);

  const handleConfirm = async () => {
    if (confirming) return;
    if (action === 'cancel' && !reason) { setReasonErr(true); return; }
    setConfirming(true);
    try {
      // Await the parent's API call so the spinner stays up until the
      // request resolves (or rejects, leaving the modal open on error).
      await onConfirm(action, action === 'cancel' ? reason : '', notes);
    } finally {
      setConfirming(false);
    }
  };

  const countLabel = candidateCount != null
    ? `${candidateCount} candidate record${candidateCount === 1 ? '' : '(s)'}`
    : 'Candidate records';

  const isComplete = action === 'complete';

  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="md" backdrop="static" keyboard={false}
      contentClassName="border-0 rec-cancel-modal"
    >
      <ModalBody className="p-0">
        {target && (
          <>
            {/* Header — colour swaps to green when the user selects Complete
                so the gradient telegraphs the destructive vs. happy-path
                outcome. */}
            <div
              className="rec-cancel-head"
              style={isComplete ? { background: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)' } : undefined}
            >
              <div className="rec-cancel-head-inner">
                <span className="rec-cancel-head-icon">
                  <i className={isComplete ? 'ri-checkbox-circle-line' : 'ri-forbid-2-line'} />
                </span>
                <div className="rec-cancel-head-text">
                  <h5 className="mb-0">{isComplete ? 'Mark Recruitment Completed' : 'Cancel Recruitment'}</h5>
                  <div className="rec-cancel-head-sub">
                    {isComplete
                      ? 'Closes the requisition once every opening has been filled'
                      : 'This action will move the recruitment to the Cancelled tab'}
                  </div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="rec-cancel-close">
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="rec-cancel-body">
              {/* Action picker was retired — the row now has two
                  separate buttons (Complete / Cancel), each entering
                  this modal with `initialAction` pre-selected. Showing
                  the picker again here just duplicated the choice the
                  user had already made. */}

              {/* Recruitment summary card */}
              <div className="rec-cancel-summary">
                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                  <span className="rec-id-pill">{target.code || target.id}</span>
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

              {/* Impact warning — distinct copy per action so the user
                  understands what each option actually does. */}
              <div className={`rec-cancel-impact${isComplete ? ' rec-cancel-impact--complete' : ''}`}>
                <i className={isComplete ? 'ri-information-line' : 'ri-alert-line'} />
                <div>
                  {isComplete ? (
                    <>
                      <strong>Heads-up:</strong> The server will only accept this if the recruitment has
                      enough <em>Selected</em> candidates to cover every opening — otherwise you'll see
                      a validation error and the requisition stays open.
                    </>
                  ) : (
                    <>
                      <strong>Impact:</strong> {countLabel} linked to this recruitment will be preserved
                      but no longer actionable. This cannot be undone from the UI.
                    </>
                  )}
                </div>
              </div>

              {/* Reason — only relevant for cancellations. Hidden on the
                  complete path so the user isn't asked for a justification
                  they don't need to provide. */}
              {!isComplete && (
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
              )}

              {/* Additional notes — kept on both paths since the audit
                  trail benefits from a free-form note either way. */}
              <div className="rec-cancel-field">
                <label className="rec-cancel-label">
                  Additional Notes <span className="opt">(OPTIONAL)</span>
                </label>
                <textarea
                  className="rec-cancel-textarea"
                  rows={3}
                  placeholder={isComplete
                    ? 'Add context — final headcount, joining dates, etc.'
                    : 'Add context for the audit trail — stakeholders informed, next steps, etc.'}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Footer — confirm button colour + label flips to match action. */}
            <div className="rec-cancel-footer">
              <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={confirming}>
                Keep Active
              </button>
              <button
                type="button"
                className="rec-cancel-confirm"
                onClick={handleConfirm}
                disabled={confirming}
                style={isComplete ? { background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)' } : undefined}
              >
                {confirming ? (
                  <>
                    <Spinner size="sm" style={{ width: 14, height: 14 }} />
                    <span>{isComplete ? 'Completing…' : 'Cancelling…'}</span>
                  </>
                ) : (
                  <>
                    <i className={isComplete ? 'ri-checkbox-circle-line' : 'ri-forbid-2-line'} />
                    {isComplete ? 'Confirm Completion' : 'Confirm Cancellation'}
                  </>
                )}
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

