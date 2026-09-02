import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Spinner } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { useModulePermission } from '../../hooks/useModulePermission';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import { Shimmer, ShimmerTableRows } from '../../components/ui/Shimmer';
import '../../../css/recruitment.css';

type RecruitmentStatus = 'In Progress' | 'Completed' | 'Cancelled' | 'Expired';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type WorkMode = 'On-site' | 'Remote' | 'Hybrid' | 'Flexible';
type EmployType = 'Full Time' | 'Part Time' | 'Contract' | 'Internship';

interface RecruitmentRow {
  id: string;
  code: string;
  jobTitle: string;

  department: string;
  designation: string;
  primaryRole: string;

  departmentId: number | null;
  designationId: number | null;
  primaryRoleId: number | null;
  hiringManagerId: number | null;
  assignedHrId: number | null;
  hiringRequestId: number | null;

  employmentType: EmployType;
  openings: number;
  experience: string;
  qualification: string;
  workMode: WorkMode;
  ctcRange: string;
  priority: Priority;

  hiringManagerName: string;
  hiringManagerRole: string;
  hiringManagerInitials: string;
  hiringManagerAccent: string;
  hiringManagerState: 'ok' | 'disabled' | 'inactive' | 'missing';
  assignedHrName: string;
  assignedHrInitials: string;
  assignedHrAccent: string;
  assignedHrState: 'ok' | 'disabled' | 'inactive' | 'missing';

  startDate: string;
  deadline: string;

  jobDescription: string;
  requirements: string;
  postOnPortal: boolean;
  notifyTeamLeads: boolean;
  enableReferralBonus: boolean;

  status: RecruitmentStatus;
}

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
  const stateOf = (emp: any): 'ok' | 'disabled' | 'inactive' | 'missing' => {
    if (!emp) return 'missing';
    if (emp.deleted_at) return 'disabled';
    if (emp.status && emp.status !== 'Active') return 'inactive';
    return 'ok';
  };
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
    hiringRequestId: api?.hiring_request_id ?? null,

    employmentType: (api?.employment_type || 'Full Time') as EmployType,
    openings:       Number(api?.openings) || 1,
    experience:     api?.experience || '',
    qualification:  api?.qualification || '',
    workMode:       (api?.work_mode || 'Hybrid') as WorkMode,
    ctcRange:       api?.ctc_range || '',
    priority:       (api?.priority || 'Medium') as Priority,

    hiringManagerName:     mgrName,
    hiringManagerRole:     '',
    hiringManagerInitials: initialsOf(mgrName),
    hiringManagerAccent:   pickAccent(api?.hiring_manager_id ?? mgrName),
    hiringManagerState:    stateOf(mgrEmp),
    assignedHrName:        hrName,
    assignedHrInitials:    initialsOf(hrName),
    assignedHrAccent:      pickAccent(api?.assigned_hr_id ?? hrName),
    assignedHrState:       stateOf(hrEmp),

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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

const ucFirst = (s: string): string => {
  const i = s.search(/\S/);
  if (i < 0) return s;                       // empty or all-whitespace
  const c = s[i];
  const upper = c.toUpperCase();
  if (c === upper) return s;                 // already capital / not a letter
  return s.slice(0, i) + upper + s.slice(i + 1);
};
const shortenServerError = (msg: string): string => {
  const m = msg.toLowerCase();
  if (m.includes('required'))                                   return 'Required';
  if (m.includes('already been taken') || m.includes('unique')) return 'Already exists';
  if (m.includes('integer') || m.includes('whole number'))      return 'Whole numbers only';
  if (m.includes('special characters') || m.includes('format') || m.includes('regex')) return 'No special characters';
  if (m.includes('must be a number') || m.includes('numeric'))  return 'Enter a number';
  if (m.includes('after'))                                      return 'Date is too early';
  if (m.includes('before'))                                     return 'Date is too late';
  if (m.includes('not be greater') || m.includes('max'))        return 'Value is too long';
  if (m.includes('at least') || m.includes('min'))              return 'Value is too short';
  if (m.includes('valid'))                                      return 'Not valid';

  return msg.split(/[.;]/)[0].trim() || 'Invalid';
};

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
  id: string;
  code: string;
  position: string;
  positionType: EmployType | 'Intern';
  positionMode: WorkMode;
  department: string;
  departmentId: number | null;
  requestedByName: string;
  openings: number;
  requestType: RequestType;
  urgency: RequestUrgency;
  status: RequestStatus;
  requestDate: string;
  targetJoinDate: string;
  _raw?: any;
}

const HR_EMP_TYPE_MAP: Record<string, EmployType | 'Intern'> = {
  'Full-time':  'Full Time',
  'Part-time':  'Part Time',
  'Contract':   'Contract',
  'Intern':     'Intern',
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

export function apiToHiringRequestRow(api: any): HiringRequestRow {
  const dept = api?.department?.name || '';
  const requestedBy = api?.requested_by_name || api?.creator?.name || '';

  return {
    id: String(api?.id ?? ''),
    code: api?.code || `HRQ-${api?.id ?? ''}`,

    position: api?.job_role || api?.title || '',

    positionType: (HR_EMP_TYPE_MAP[api?.employment_type] || 'Full Time') as EmployType | 'Intern',
    positionMode: (HR_WORK_MODE_MAP[api?.work_mode] || 'Hybrid') as WorkMode,

    department:   dept,
    departmentId: api?.department_id ?? null,

    requestedByName:     requestedBy,

    openings:       Number(api?.openings) || 1,
    requestType:    (api?.request_type || 'New Position') as RequestType,
    urgency:        (api?.urgency       || 'Medium')      as RequestUrgency,
    status:         (api?.status        || 'Submitted')   as RequestStatus,
    requestDate:    (api?.created_at ? String(api.created_at).slice(0, 10) : api?.request_date) || '',
    targetJoinDate: api?.target_join_date || '',
    _raw:           api,
  };
}


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

const KPI_CARDS = [
  { key: 'total',          label: 'Total Recruitments',     icon: 'ri-briefcase-4-line',     gradient: 'linear-gradient(135deg,#299cdb 0%,#4dabf7 100%)', deep: '#1e6dd6' },
  { key: 'active',         label: 'Active Hiring',          icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
  { key: 'hiringRequests', label: 'Hiring Requests',        icon: 'ri-inbox-archive-line',   gradient: 'linear-gradient(135deg,#6366f1 0%,#818cf8 100%)', deep: '#4f46e5' },
  { key: 'converted',      label: 'Converted to Recruitment', icon: 'ri-exchange-funds-line', gradient: 'linear-gradient(135deg,#8b5cf6 0%,#a78bfa 100%)', deep: '#6d28d9' },
  { key: 'completed',      label: 'Completed Recruitment',  icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#10b981 0%,#34d399 100%)', deep: '#059669' },
  { key: 'cancelled',      label: 'Cancelled Recruitment',  icon: 'ri-close-circle-fill',    gradient: 'linear-gradient(135deg,#f06548 0%,#f47c5d 100%)', deep: '#d63a5e' },
] as const;

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

export default function HrRecruitment() {
  const toast = useToast();
  /* One module governs this whole area: recruitments, hiring requests and the
     candidate pipeline all key off `hr.recruitment`. View-only therefore reads
     every list — recruitments, requests, candidates — and changes nothing;
     granting Add or Edit here is what unlocks the candidate actions too. */
  const perm = useModulePermission('hr.recruitment', 'recruitments');
  const navigate = useNavigate();

  const [recruitments, setRecruitments] = useState<RecruitmentRow[]>([]);
  const [loadingRecruitments, setLoadingRecruitments] = useState(true);
  const [tab, setTab] = useState<RecruitmentStatus>('In Progress');
  const [q, setQ] = useState('');
  /* Paging lives in <DataTable> now. */


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
  const [hiringRequests, setHiringRequests] = useState<HiringRequestRow[]>([]);

  /* Paging, the status tab and search are the SERVER's job.
     The page used to pull every recruitment and sort them into tabs in the
     browser, which meant serialising the whole table on each load and grew
     with the tenant. RecruitmentController::index answers one page and
     ::stats answers the counts. */
  const [page, setPage]       = useState(0);
  const [total, setTotal]     = useState(0);
  /* Starts at 10 — the value minAutoRows floors the auto-fit to, so the first
     request and the post-measure request usually agree and no second fetch
     goes out. Same pairing as Exit Management and HR Employees. */
  const [perPage, setPerPage] = useState(10);

  /* Typing is not a request. Without the debounce every letter fires a page-1
     fetch and the answers arrive out of order. */
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  /* Roster-wide counts, fetched alongside the page. Search-aware so the tab
     badges never contradict the rows beneath them; NOT tab-aware, since the
     badges are the breakdown the tabs are cut from. */
  const ZERO_REC_STATS = { total: 0, inProgress: 0, completed: 0, cancelled: 0, expired: 0, converted: 0 };
  const [recStats, setRecStats] = useState(ZERO_REC_STATS);

  const fetchRecruitments = async () => {
    try {
      const [listRes, recStatsRes, statsRes, hrRes] = await Promise.all([
        api.get('/recruitments', {
          params: {
            page: page + 1,          // the API counts from 1, DataTable from 0
            per_page: perPage,
            status: tab,
            ...(debouncedQ ? { search: debouncedQ } : {}),
          },
        }),
        api.get('/recruitments/stats', {
          params: { ...(debouncedQ ? { search: debouncedQ } : {}) },
        }).catch(() => ({ data: ZERO_REC_STATS })),
        api.get('/candidates/stats').catch(() => ({ data: ZERO_STATS })),
        api.get('/hiring-requests').catch(() => ({ data: [] })),
      ]);
      /* Paginated now, so the rows arrive under .data with the envelope around
         them. The Array.isArray fallback keeps this working if the request
         ever goes out without page params. */
      const body: any = listRes.data;
      const rows: any[] = Array.isArray(body) ? body : (body?.data ?? []);
      setRecruitments(rows.map(apiToRow));
      setTotal(Number(body?.total ?? rows.length));
      setRecStats({ ...ZERO_REC_STATS, ...(recStatsRes.data || {}) });
      setCandidateStats({ ...ZERO_STATS, ...(statsRes.data || {}) });
      const hrRows: any[] = Array.isArray(hrRes.data) ? hrRes.data : [];
      setHiringRequests(hrRows.map(apiToHiringRequestRow));
    } catch (err: any) {
      toast.error('Could not load recruitments', err?.response?.data?.message || 'Please try again.');
      setRecruitments([]);
      setTotal(0);
      setRecStats(ZERO_REC_STATS);
      setCandidateStats(ZERO_STATS);
      setHiringRequests([]);
    } finally {
      setLoadingRecruitments(false);
    }
  };
  useEffect(() => { fetchRecruitments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
    [page, perPage, tab, debouncedQ]);

  /* A narrowed result set can leave you past the last page — searching on
     page 4 of 5 otherwise shows an empty table rather than the matches. */
  useEffect(() => { setPage(0); }, [tab, debouncedQ]);

  /* Counts come from /recruitments/stats, NOT from the rows on screen.
     Deriving them from `recruitments` only worked while the endpoint returned
     every row; against one page it would report "Total Recruitments 10" on a
     tenant of 50. Hiring requests stay browser-side — that endpoint is
     unpaginated and the list is short. */
  const counts = useMemo(() => {
    const submittedRequests = hiringRequests.filter(r => r.status !== 'Draft').length;

    return {
      total:          recStats.total,
      active:         recStats.inProgress,
      hiringRequests: submittedRequests,
      converted:      recStats.converted,
      completed:      recStats.completed,
      cancelled:      recStats.cancelled,
      tabs: {
        'In Progress': recStats.inProgress,
        Completed:     recStats.completed,
        Cancelled:     recStats.cancelled,
        Expired:       recStats.expired,
      },
    };
  }, [recStats, hiringRequests]);

  /* The server already applied the status tab and the search, so the page it
     returned IS the filtered set. Filtering again here would be a second,
     narrower pass over one page — which is how a paginated list ends up
     showing four rows out of a page of ten and calling it a match. */
  const filtered = recruitments;


  const [createOpen, setCreateOpen]                 = useState(false);
  const [createMode, setCreateMode]                 = useState<'add' | 'edit'>('add');
  const [createEditingId, setCreateEditingId]       = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen]                   = useState(false);
  const [requestsOpen, setRequestsOpen]             = useState(false);
  const [cancelTarget, setCancelTarget]             = useState<RecruitmentRow | null>(null);
  const [cancelInitialAction, setCancelInitialAction] = useState<'cancel' | 'complete'>('cancel');
  const [candidatesTarget, setCandidatesTarget]     = useState<RecruitmentRow | null>(null);
  const [hiringRefreshKey, setHiringRefreshKey]     = useState(0);
  const [createPrefillFromHr, setCreatePrefillFromHr] = useState<any | null>(null);
  const columns = useMemo<DataTableColumn<RecruitmentRow>[]>(() => [
    {
      header: 'REC ID',
      id: 'code',
      accessorFn: (r: RecruitmentRow) => r.code || r.id,
      sortingFn: (a, b, id) => String(a.getValue(id)).localeCompare(String(b.getValue(id)), undefined, { numeric: true, sensitivity: 'base' }),
      meta: { width: '6%', align: 'center' },
      cell: info => <span className="rec-id-pill">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Job Title',
      accessorKey: 'jobTitle',
      meta: { width: '13%' },
      cell: info => (
        <Tooltip label={info.row.original.jobTitle}>
          <span className="fw-bold fs-13" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'middle' }}>
            {info.row.original.jobTitle}
          </span>
        </Tooltip>
      ),
    },
    { header: 'Department',  accessorKey: 'department',  meta: { width: '8%', align: 'center' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Designation', accessorKey: 'designation', meta: { width: '9%', align: 'center' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Employment',
      accessorKey: 'employmentType',
      meta: { width: '8%', align: 'center' },
      cell: info => {
        const et = EMPLOY_TYPE_TONES[info.row.original.employmentType];
        return <span className="rec-pill" style={{ background: et.bg, color: et.fg }}>{info.row.original.employmentType}</span>;
      },
    },
    {
      header: () => <div className="text-center">Openings</div>,
      accessorKey: 'openings',
      meta: { width: '5%', align: 'center' },
      cell: info => <span className="rec-num">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: () => <div className="text-center">Experience</div>,
      accessorKey: 'experience',
      meta: { width: '6%', align: 'center' },
      cell: info => <span className="text-muted fs-13">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Work Mode',
      accessorKey: 'workMode',
      meta: { width: '7%', align: 'center' },
      cell: info => {
        const wm = WORK_MODE_TONES[info.row.original.workMode];
        return <span className="rec-pill" style={{ background: wm.bg, color: wm.fg }}>{info.row.original.workMode}</span>;
      },
    },
    {
      header: 'Priority',
      accessorKey: 'priority',
      meta: { width: '6%', align: 'center' },
      cell: info => {
        const pri = PRIORITY_TONES[info.row.original.priority];
        return <span className="rec-pill" style={{ background: pri.bg, color: pri.fg }}>{info.row.original.priority}</span>;
      },
    },
    {
      header: 'Hiring Manager',
      accessorKey: 'hiringManagerName',
      meta: { width: '11%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <span className="fs-13 text-truncate">{r.hiringManagerRole ? `${r.hiringManagerRole} – ` : ''}{r.hiringManagerName}</span>
            {(r.hiringManagerState === 'disabled' || r.hiringManagerState === 'inactive') && (
              <span className={`rec-mgr-flag rec-mgr-flag--${r.hiringManagerState}`}>{r.hiringManagerState === 'disabled' ? 'Disabled' : 'Inactive'}</span>
            )}
          </div>
        );
      },
    },
    {
      header: 'Assigned HR',
      accessorKey: 'assignedHrName',
      meta: { width: '10%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <span className="fs-13 text-truncate">{r.assignedHrName}</span>
            {(r.assignedHrState === 'disabled' || r.assignedHrState === 'inactive') && (
              <span className={`rec-mgr-flag rec-mgr-flag--${r.assignedHrState}`}>{r.assignedHrState === 'disabled' ? 'Disabled' : 'Inactive'}</span>
            )}
          </div>
        );
      },
    },
    {
     
      header: 'Start Date',
      accessorKey: 'startDate',
      meta: { width: '6%', align: 'center' },
      cell: info => <span className="rec-date fs-13">{formatDate(info.row.original.startDate)}</span>,
    },
    {
      header: 'Deadline',
      accessorKey: 'deadline',
      meta: { width: '6%', align: 'center' },
      cell: info => <span className="rec-date fs-13">{formatDate(info.row.original.deadline)}</span>,
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: '9%', align: 'center', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center align-items-center">
            <ActionBtn
              title={
                r.status === 'Cancelled' ? 'Cannot edit — recruitment is cancelled'
                : r.status === 'Completed' ? 'Cannot edit — recruitment is completed'
                : (perm.lockedTitle('edit') ?? 'Edit Recruitment')
              }
              icon="ri-pencil-line"
              color="info"
              disabled={r.status === 'Cancelled' || r.status === 'Completed'}
              locked={!perm.canEdit}
              onClick={() => perm.guard('edit', () => { setCreateMode('edit'); setCreateEditingId(r.id); setCreateOpen(true); })}
            />
            <ActionBtn
              title={
                r.status === 'Cancelled' ? 'Cancelled — no candidates can be added'
                : r.status === 'Expired' ? 'Recruitment expired — candidates unavailable'
                : 'View Candidates'
              }
              icon="ri-team-line"
              color="primary"
              disabled={r.status === 'Cancelled' || r.status === 'Expired'}
              onClick={() => navigate(`/hr/recruitment/${r.id}/candidates`)}
            />
            <ActionBtn
              title={
                r.status === 'Cancelled' ? 'Already Cancelled'
                : r.status === 'Completed' ? 'Already Completed'
                : r.status === 'Expired' ? 'Recruitment expired — cannot complete'
                : (perm.lockedTitle('edit') ?? 'Mark Recruitment Completed')
              }
              icon="ri-checkbox-circle-line"
              color="success"
              disabled={r.status === 'Cancelled' || r.status === 'Completed' || r.status === 'Expired'}
              locked={!perm.canEdit}
              onClick={() => perm.guard('edit', () => { setCancelInitialAction('complete'); setCancelTarget(r); })}
            />
            <ActionBtn
              title={
                r.status === 'Cancelled' ? 'Already Cancelled'
                : r.status === 'Completed' ? 'Already Completed'
                : r.status === 'Expired' ? 'Recruitment expired — cannot cancel'
                : (perm.lockedTitle('edit') ?? 'Cancel Recruitment')
              }
              icon="ri-forbid-2-line"
              color="danger"
              disabled={r.status === 'Cancelled' || r.status === 'Completed' || r.status === 'Expired'}
              locked={!perm.canEdit}
              onClick={() => perm.guard('edit', () => { setCancelInitialAction('cancel'); setCancelTarget(r); })}
            />
          </div>
        );
      },
    },
  ], [navigate, perm.canEdit]);

  return (
    <>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div className="rec-page recruit-page">
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-briefcase-4-fill" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Recruitment Management</span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Create recruitments, track candidates, and manage the end-to-end hiring pipeline
                  </div>
                </div>
              </div>
              <div className="rec-hero-actions d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
                <button
                  type="button"
                  className="rec-btn-primary"
                  aria-disabled={!perm.canAdd || undefined}
                  title={perm.lockedTitle('add')}
                  style={perm.canAdd ? undefined : { opacity: .5, cursor: 'not-allowed', filter: 'grayscale(0.7)' }}
                  onClick={() => perm.guard('add', () => { setCreateMode('add'); setCreateEditingId(null); setCreateOpen(true); })}
                >
                  <i className="ri-add-line" />Create Recruitment
                </button>
                <button
                  type="button"
                  className="rec-btn-teal"
                  onClick={() => setRequestsOpen(true)}
                >
                  <i className="ri-eye-line" />View Hiring Requests
                </button>
              </div>
            </div>

            <Row className="g-1 mb-3 align-items-stretch rec-page-kpis">
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

            <DataTable<RecruitmentRow>
              data={filtered}
              columns={columns}
              serial
              accent="violet"
              minWidth={1800}
              fitToViewport
              autoFitRows
              /* Floor the fit at 10 rows, matching Exit Management and HR
                 Employees. minAutoRows defaults to 2, which on a short
                 viewport served a two-row page. */
              minAutoRows={10}
              /* The rows are one page fetched by fetchRecruitments; the table
                 stops slicing and reports page moves back here instead.
                 onPageSizeChange covers autoFitRows re-measuring on resize as
                 well as the rows-per-page picker. */
              serverPagination={{
                total,
                pageIndex: page,
                onPageChange: setPage,
                onPageSizeChange: setPerPage,
              }}
              loading={loadingRecruitments}
              searchValue={q}
              onSearchChange={setQ}
              searchPlaceholder="Search ID, job title, HR…"
              tabs={[
                { key: 'In Progress', label: 'In Progress', icon: 'ri-time-line',            count: counts.tabs['In Progress'] },
                { key: 'Completed',   label: 'Completed',   icon: 'ri-checkbox-circle-line', count: counts.tabs.Completed },
                { key: 'Cancelled',   label: 'Cancelled',   icon: 'ri-close-circle-line',    count: counts.tabs.Cancelled },
                { key: 'Expired',     label: 'Expired',     icon: 'ri-alarm-warning-line',   count: counts.tabs.Expired },
              ]}
              activeTab={tab}
              onTabChange={k => setTab(k as RecruitmentStatus)}
              emptyMessage={
                <>
                  <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No recruitments match your filters
                </>
              }
            />
          </div>
        </Col>
      </Row>

      <RaiseHiringRequestModal
        isOpen={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        onSubmit={(savedRow, asDraft) => {
          setRaiseOpen(false);
          setHiringRefreshKey(k => k + 1);
          if (asDraft) toast.success('Saved as draft', `${savedRow.code || 'Hiring request'} saved to drafts.`);
          else toast.success('Hiring request submitted', `${savedRow.code || 'Hiring request'} sent to HR for review.`);
        }}
      />

      <HiringRequestsListModal
        isOpen={requestsOpen}
        refreshKey={hiringRefreshKey}
        onClose={() => setRequestsOpen(false)}
        onCreateRecruitment={(req) => perm.guard('add', () => {
          setRequestsOpen(false);
          setCreateMode('add');
          setCreateEditingId(null);
          setCreatePrefillFromHr(req?._raw || null);
          setCreateOpen(true);
        })}
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
            const fieldErr = err?.response?.data?.errors?.status?.[0];
            const message  = fieldErr || err?.response?.data?.message || 'Please try again.';
            toast.error(isComplete ? 'Cannot mark as Completed' : 'Could not cancel', message);
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


interface RaiseHiringRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (savedRow: HiringRequestRow, asDraft: boolean) => void;
  editing?: HiringRequestRow | null;
  zIndex?: number;
}

export function RaiseHiringRequestModal({ isOpen, onClose, onSubmit, editing, zIndex = 2100 }: RaiseHiringRequestModalProps) {
  const toast = useToast();

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

  const [title, setTitle]               = useState('');
  const [jobRole, setJobRole]           = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [targetDate, setTargetDate]     = useState('');

  const [openings, setOpenings]         = useState('');
  const [employType, setEmployType]     = useState('');
  const [workMode, setWorkMode]         = useState<'' | 'Onsite' | 'Remote' | 'Hybrid' | 'Flexible'>('');
  const [urgency, setUrgency]           = useState<'' | RequestUrgency>('');

  const [jobDesc, setJobDesc]                 = useState('');
  const [dailyResp, setDailyResp]             = useState('');
  const [requiredSkills, setRequiredSkills]   = useState('');
  const [requiredExp, setRequiredExp]         = useState('');
  const [requiredQual, setRequiredQual]       = useState('');


  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  type RaiseErrors = Partial<Record<
    'title' | 'jobRole' | 'department' | 'targetDate' | 'openings' | 'employType' | 'workMode' | 'urgency'
    | 'jobDesc' | 'dailyResp' | 'requiredSkills' | 'requiredExp' | 'requiredQual',
    string
  >>;
  const [errors, setErrors] = useState<RaiseErrors>({});

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
      setOpenings(''); setEmployType(''); setWorkMode(''); setUrgency('');
      setJobDesc(''); setDailyResp(''); setRequiredSkills(''); setRequiredExp(''); setRequiredQual('');
    }
    setErrors({}); setSaving(null);
  }, [isOpen, editing]);

  const clear = (k: keyof RaiseErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): RaiseErrors => {
    const e: RaiseErrors = {};
    const titleRe = /^[A-Za-z0-9 .,\-\/]+$/;
    const titleMsg = 'No special characters';
    if (!title.trim())          e.title          = 'Required';
    else if (!titleRe.test(title.trim())) e.title = titleMsg;
    if (!jobRole.trim())        e.jobRole        = 'Required';
    else if (!titleRe.test(jobRole.trim())) e.jobRole = titleMsg;
    if (!departmentId)          e.department     = 'Required';
    if (targetDate) {
      const tomorrow = new Date(); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
      const picked = new Date(targetDate); picked.setHours(0, 0, 0, 0);
      if (picked.getTime() < tomorrow.getTime()) {
        e.targetDate = 'Must be tomorrow or later';
      }
    }
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Minimum 1';
    if (!employType)            e.employType     = 'Required';
    if (!workMode)              e.workMode       = 'Required';
    if (!urgency)               e.urgency        = 'Required';
    const jd = jobDesc.trim();
    if (!jd)                   e.jobDesc = 'Required';
    else if (jd.length < 20)   e.jobDesc = 'Min 20 characters';
    else if (jd.length > 5000) e.jobDesc = 'Max 5000 characters';

    const dr = dailyResp.trim();
    if (dr) {
      if (dr.length < 20)        e.dailyResp = 'Min 20 characters';
      else if (dr.length > 3000) e.dailyResp = 'Max 3000 characters';
    }

    const skillList = requiredSkills.split(/[\n,;•|]+/).map(s => s.trim()).filter(Boolean);
    const TOO_LONG = skillList.find(s => s.length > 100);

    if (skillList.length === 0) {
      e.requiredSkills = 'Required';
    } else if (skillList.length < 2) {
      e.requiredSkills = 'Separate each skill with a comma — at least 2 required';
    } else if (skillList.length > 20) {
      e.requiredSkills = 'Max 20 skills';
    } else if (TOO_LONG) {
      e.requiredSkills = 'Each skill must be 100 characters or less — enter skills, not a description';
    }

    if (!requiredExp)           e.requiredExp    = 'Required';

    const rq = requiredQual.trim();
    if (!rq)                  e.requiredQual = 'Required';
    else if (rq.length < 2)   e.requiredQual = 'Min 2 characters';
    else if (rq.length > 255) e.requiredQual = 'Max 255 characters';
    else if (!/[A-Za-z]/.test(rq))
      e.requiredQual = 'Must contain letters';
    else if (!/^[A-Za-z0-9 .,/&()+\-]+$/.test(rq))
      e.requiredQual = 'No special characters';
    return e;
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (asDraft) {
      const draftErrs: RaiseErrors = {};
      if (!title.trim())   draftErrs.title   = 'Required for a draft';
      if (!jobRole.trim()) draftErrs.jobRole = 'Required for a draft';
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

    const payload: Record<string, any> = {
      title:                  title.trim() || null,
      job_role:               jobRole.trim() || null,
      department_id:          departmentId ? Number(departmentId) : null,
      target_join_date:       targetDate || null,
      openings:               Number(openings) || 1,
      employment_type:        employType || null,
      work_mode:              workMode || null,
      urgency:                urgency || 'Medium',
      job_description:        jobDesc || null,
      daily_responsibilities: dailyResp || null,
      required_skills:        requiredSkills || null,
      required_experience:    requiredExp || null,
      required_qualification: requiredQual || null,
      status:                 asDraft ? 'Draft' : 'Submitted',
    };

    setSaving(asDraft ? 'draft' : 'submit');
    try {
      const { data } = editing?.id
        ? await api.put(`/hiring-requests/${editing.id}`, payload)
        : await api.post('/hiring-requests', payload);
      onSubmit(apiToHiringRequestRow(data), asDraft);
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const fieldMap: Record<string, keyof RaiseErrors> = {
          title: 'title', job_role: 'jobRole', department_id: 'department',
          openings: 'openings', employment_type: 'employType', work_mode: 'workMode', urgency: 'urgency',
          job_description: 'jobDesc', required_skills: 'requiredSkills', required_experience: 'requiredExp',
        };
        const mapped: RaiseErrors = {};
        let firstRaw = '';
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          const raw = Array.isArray(v) ? String(v[0]) : String(v);
          if (!firstRaw) firstRaw = raw;
          const ui = fieldMap[k];
          if (ui) mapped[ui] = shortenServerError(raw);
        }
        setErrors(mapped);
        toast.error('Validation failed', firstRaw || 'Please fix the highlighted fields.');
      } else {
        const raw = String(err?.response?.data?.message || '');
        const sqlMatch = /not[- ]null|null value in column ["`']?(\w+)["`']?/i.exec(raw);
        if (sqlMatch) {
          const col = sqlMatch[1] || 'a required field';
          const colToField: Record<string, keyof RaiseErrors> = {
            title: 'title', job_role: 'jobRole', department_id: 'department',
            openings: 'openings', employment_type: 'employType', work_mode: 'workMode', urgency: 'urgency',
            job_description: 'jobDesc', required_skills: 'requiredSkills', required_experience: 'requiredExp',
          };
          const ui = colToField[col];
          if (ui) {
            setErrors(prev => ({ ...prev, [ui]: 'Required' }));
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
      setSaving(null);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal rec-form-modal-navy" backdropClassName="rec-modal-backdrop" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false} zIndex={zIndex}>
      <ModalBody className="p-0">
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

        <div className="rec-form-body">
          <div className="rec-form-card">
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#5b3fd1 0%,#7c5cfc 50%,#a78bfa 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(124,92,252,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-calendar-event-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 1 · Request Basics</p>
              </div>
            </div>
          
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

          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: 'linear-gradient(135deg,#0c63b0 0%,#3b82f6 50%,#60a5fa 100%)', color: '#ffffff', boxShadow: '0 4px 12px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.30)' }}>
                <i className="ri-time-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 2 · Hiring Need</p>
              </div>
            </div>
           
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
        </div>

        <div className="rec-form-footer">
          <span className="hint">Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)} disabled={!!saving}>
              {saving === 'draft' ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-save-3-line" />}
              Save as Draft
            </button>
            <button type="button" className="rec-btn-primary" onClick={() => handleSubmit(false)} disabled={!!saving}>
              {saving === 'submit' ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-send-plane-line" />}
              Submit to HR
              {saving !== 'submit' && <i className="ri-arrow-right-line" />}
            </button>
          </div>
        </div>
        {/* While a Save is in flight, lock the WHOLE modal (#49) — the button
            spinner alone didn't stop the user editing fields or hitting the
            other action mid-save. Absolute inset:0 resolves against
            .modal-content, so it covers the header and footer too. Same pattern
            as the CLM trade-document / agreement wizards. */}
        {!!saving && (
          <div className="rec-save-lock">
            <div className="rec-save-lock-box">
              <Spinner size="sm" style={{ width: 18, height: 18 }} />
              <span>{saving === 'draft' ? 'Saving draft…' : 'Submitting…'}</span>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}


interface HiringRequestsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateRecruitment: (req: HiringRequestRow) => void;
}

export function HiringRequestsListModal({ isOpen, onClose, onCreateRecruitment, refreshKey }: HiringRequestsListModalProps & { refreshKey?: number }) {
  const toast = useToast();

  const [tab, setTab] = useState<'pending' | 'created' | 'rejected'>('pending');

  const [statusFilter, setStatusFilter]   = useState<string>('All');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('All');
  const [q, setQ] = useState('');

  /* Paging lives in <DataTable> now. */

  const [requests, setRequests] = useState<HiringRequestRow[]>([]);
  const [linkedHrIds, setLinkedHrIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [reqRes, linkedRes] = await Promise.all([
          api.get('/hiring-requests'),
          /* Just the ids. This used to be a full GET /recruitments — every row
             with every eager-loaded relation, 118 kB and ~1.8s, to build a Set
             of integers the server can produce in one DISTINCT pluck. */
          api.get('/recruitments/linked-hiring-requests').catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const rows: any[] = Array.isArray(reqRes.data) ? reqRes.data : [];
        setRequests(rows.map(apiToHiringRequestRow).filter(r => r.status !== 'Draft'));
        const linked: any[] = Array.isArray(linkedRes.data) ? linkedRes.data : [];
        const ids = new Set<number>();
        for (const v of linked) {
          const id = Number(v);
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
  }, [isOpen, refreshKey]);

  const [viewing, setViewing] = useState<HiringRequestRow | null>(null);

  useEffect(() => { if (!isOpen) { setStatusFilter('All'); setUrgencyFilter('All'); setQ(''); setViewing(null); setTab('pending'); } }, [isOpen]);

  const stats = useMemo(() => {
    const total              = requests.length;
    const rejected           = requests.filter(r => r.status === 'Rejected').length;
    const submitted          = requests.filter(r => r.status === 'Submitted').length;
    const critical           = requests.filter(r => r.urgency === 'Critical').length;
    const recruitmentCreated = requests.filter(r => linkedHrIds.has(Number(r.id)) && r.status !== 'Rejected').length;
    return { total, rejected, submitted, critical, recruitmentCreated };
  }, [requests, linkedHrIds]);

  const tabRequests = useMemo(() => {
    return requests.filter(r => {
      const linked = linkedHrIds.has(Number(r.id));
      const rejected = r.status === 'Rejected';
      // Rejected always wins: a rejected request belongs only in the Rejected
      // tab, even if a recruitment was created before it was rejected. Without
      // excluding rejected here, such rows leaked into "Recruitment Created".
      if (tab === 'created')  return linked && !rejected;
      if (tab === 'rejected') return rejected;
      return !linked && !rejected;
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

  const pendingCount  = useMemo(() => requests.filter(r => !linkedHrIds.has(Number(r.id)) && r.status !== 'Rejected').length, [requests, linkedHrIds]);
  const createdCount  = useMemo(() => requests.filter(r =>  linkedHrIds.has(Number(r.id)) && r.status !== 'Rejected').length, [requests, linkedHrIds]);
  const rejectedCount = useMemo(() => requests.filter(r => r.status === 'Rejected').length, [requests, linkedHrIds]);

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     8+10+9+9+8+8+10+9+9+20. Openings went 5% -> 8%: at 5% the header word plus
     the sort arrows had no room and the arrows collided with the label. The 3%
     comes off Requested By and the two date columns (10% -> 9% each), all of
     which had slack — the dates render a fixed "13-Aug-2026" and the name cell
     already truncates. Request Type was dropped from the grid; the field
     is still mapped on the row (and still saved), it just isn't a column any
     more — nothing else on this screen renders it, so removing the column is
     the only place it was visible.
     Sr No is NOT declared here: DataTable's `serial` prop prepends it, which
     is what the main Recruitment list does too. It numbers ROWS ON THE PAGE
     (page offset included), so it renumbers on sort/filter rather than
     claiming to be a stable identifier — REQ ID is the identifier. */
  const columns = useMemo<DataTableColumn<HiringRequestRow>[]>(() => [
    {
      header: 'REQ ID',
      id: 'code',
      accessorFn: (r: HiringRequestRow) => r.code || r.id,
      sortingFn: (a, b, id) => String(a.getValue(id)).localeCompare(String(b.getValue(id)), undefined, { numeric: true, sensitivity: 'base' }),
      meta: { width: '8%', align: 'center' },
      cell: info => <span className="rec-id-pill">{String(info.getValue() ?? '')}</span>,
    },
    {
      // Job title only. The employment-type and work-mode mini-chips are gone;
      // both are still on the row and both are shown in the View drawer, so
      // nothing is lost from the record — the grid just stops carrying them.
      // No `wrap` any more either: the chips were the only reason the cell
      // needed a second line.
      //
      // max={10} — hard character cap, not just a CSS ellipsis at the column
      // edge. TruncCell clips to 10 chars, appends "…" and puts the FULL title
      // in a hover tooltip, so the column can stay narrow at any zoom or
      // viewport instead of its cut point drifting with the rendered width.
      header: 'Position',
      accessorKey: 'position',
      meta: { width: '10%' },
      cell: info => <TruncCell value={info.row.original.position} max={10} caseSensitive className="fw-bold fs-13" />,
    },
    { header: 'Department', accessorKey: 'department', meta: { width: '9%', align: 'center' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      // Name only — the initials avatar carried no information the name did
      // not already give, and its accent colour is derived from the id rather
      // than meaning anything.
      header: 'Requested By',
      accessorKey: 'requestedByName',
      meta: { width: '9%' },
      cell: info => <TruncCell value={info.row.original.requestedByName} caseSensitive />,
    },
    {
      header: () => <div className="text-center">Openings</div>,
      accessorKey: 'openings',
      meta: { width: '8%', align: 'center' },
      cell: info => <span className="rec-num">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Urgency',
      accessorKey: 'urgency',
      meta: { width: '8%' },
      cell: info => {
        const u = REQUEST_URGENCY_TONES[info.row.original.urgency];
        return <span className="rec-pill" style={{ background: u.bg, color: u.fg, ['--pill-fg' as string]: u.fg } as React.CSSProperties}>{info.row.original.urgency}</span>;
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '10%', align: 'center' },
      cell: info => {
        const statusColor = REQUEST_STATUS_COLOR[info.row.original.status];
        return (
          <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
            {info.row.original.status}
          </span>
        );
      },
    },
    { header: 'Req Date',    accessorKey: 'requestDate',    meta: { width: '9%', align: 'center' }, cell: info => <span className="rec-date fs-13">{formatDate(info.row.original.requestDate)}</span> },
    { header: 'Target Join', accessorKey: 'targetJoinDate', meta: { width: '9%', align: 'center' }, cell: info => <span className="rec-date fs-13">{formatDate(info.row.original.targetJoinDate)}</span> },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: '20%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="rec-row-actions justify-content-center">
            <Tooltip label="View">
              <button type="button" className="rec-act rec-act-view rec-act--icon" onClick={() => setViewing(r)} aria-label="View">
                <i className="ri-eye-line" />
              </button>
            </Tooltip>
            {/* LABELLED, not an icon tile — this is the primary action of the
                whole screen (a hiring request exists to become a recruitment),
                and as a bare icon it read as a peer of View. Same treatment as
                Exit Management's "Initiate Exit": one prominent labelled button
                next to the quiet icon actions. Dropping `rec-act--icon` is what
                restores the solid gradient — that modifier deliberately
                neutralises it back to the soft violet icon chrome. */}
            {tab === 'pending' && (
              <Tooltip label="Create a recruitment from this request">
                <button type="button" className="rec-act rec-act-create" onClick={() => onCreateRecruitment(r)}>
                  <i className="ri-user-search-line" />Create Recruitment
                </button>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tab, onCreateRecruitment]);


  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-req-modal" backdropClassName="rec-modal-backdrop" contentClassName="rec-req-content border-0" backdrop="static" keyboard={false} zIndex={2100}>
      <ModalBody className="p-0">
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
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div className="rec-req-stats">
          {[
            { label: 'Total',                value: stats.total,              icon: 'ri-file-list-3-line',     accent: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
            { label: 'Rejected',             value: stats.rejected,           icon: 'ri-close-circle-line',    accent: 'linear-gradient(135deg, #be123c 0%, #f43f5e 60%, #fb7185 100%)', deep: '#be123c' },
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

        {/* Shared list table (components/ui/DataTable) — same component the main
            Recruitment list uses, so the modal's list reads identically.
            NOT autoFitRows (the one HRMS table without it): auto-fit measures
            from the card top to the viewport bottom, which inside a modal body
            would ask for more rows than the modal can show. Fixed page size
            instead; the Rows-per-page selector still works.

            The wrapper is what separates this panel from the KPI band above:
            the band keeps its tinted violet wash, the table sits on a plain
            surface, and the 4px side inset lets the card's rounded corners
            read as a card instead of butting into the modal edge. */}
        <div className="rec-req-tablewrap">
        <DataTable<HiringRequestRow>
          data={filtered}
          columns={columns}
          serial={{ width: 52 }}
          accent="violet"
          minWidth={1150}
          /* 10, the same page size as HR Employees, Exit Management and the
             Recruitment list behind this modal. Still a FIXED size rather than
             autoFitRows — auto-fit measures from the card top to the viewport
             bottom, which inside a modal body asks for more rows than the
             modal can show. */
          pageSize={10}
          disableSorting
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder="Search requests…"
          tabs={[
            { key: 'pending',  label: 'Pending Hiring Requests', icon: 'ri-time-line',         count: pendingCount },
            { key: 'created',  label: 'Recruitment Created',     icon: 'ri-user-search-line',  count: createdCount },
            { key: 'rejected', label: 'Rejected',                icon: 'ri-close-circle-line', count: rejectedCount },
          ]}
          activeTab={tab}
          onTabChange={k => setTab(k as typeof tab)}
          emptyMessage={
            <>
              <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
              {requests.length === 0
                ? 'No hiring requests yet — managers raise these from their Employee Profile > Hiring Requests tab.'
                : tabRequests.length === 0
                  ? (tab === 'created'
                      ? 'No hiring requests have been promoted into a recruitment yet.'
                      : tab === 'rejected'
                        ? 'No hiring requests have been rejected.'
                        : 'Every hiring request has been moved into a recruitment.')
                  : 'No requests match your filters'}
            </>
          }
        />
        </div>
      </ModalBody>

      <ViewHiringRequestModal
        request={viewing}
        onClose={() => setViewing(null)}
        canCreate={!!viewing && !linkedHrIds.has(Number(viewing.id)) && viewing.status !== 'Rejected'}
        recruitmentCreated={!!viewing && linkedHrIds.has(Number(viewing.id))}
        onCreate={(req) => { setViewing(null); onCreateRecruitment(req); }}
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

    </Modal>
  );
}


export function ViewHiringRequestModal({ request, onClose, onReject, onCreate, canCreate, recruitmentCreated }: {
  request: HiringRequestRow | null;
  onClose: () => void;
  onReject?: (req: HiringRequestRow) => Promise<void>;
  onCreate?: (req: HiringRequestRow) => void;
  canCreate?: boolean;
  recruitmentCreated?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  if (!request) return null;
  const r = request;
  // Once a recruitment exists for this request, it's read-only: no rejecting.
  const canReject = !!onReject && !recruitmentCreated && !['Rejected', 'Approved'].includes(r.status);
  const showCreate = !!onCreate && !!canCreate;
  const raw = r._raw || {};
  const u = REQUEST_URGENCY_TONES[r.urgency];
  const statusColor = REQUEST_STATUS_COLOR[r.status];
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="rec-view-field">
      <div className="rec-view-label">{label}</div>
      <div className="rec-view-value">{value !== undefined && value !== null && value !== '' ? value : <span className="text-muted">—</span>}</div>
    </div>
  );
  /* margin 8px above and below — was 14px above, which made the run between one
     section's card and the next header wider than every other gap in the modal.
     Matches the 8px rhythm of the Hiring Requests popup. */
  const SectionHeader = ({ icon, title }: { icon: string; title: string }) => (
    <div className="d-flex align-items-center gap-2" style={{ margin: '8px 0' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className={icon} style={{ fontSize: 14 }} />
      </span>
      <div className="fw-bold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{title}</div>
    </div>
  );
  const LongText = ({ label, value }: { label: string; value: any }) => {
    if (!value) return null;
    return (
      <div style={{ padding: '10px 14px', background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
        {/* Clamped to 2 lines, then ellipsised, with the full text on hover.
            Two separate problems were showing here:
              1. an unbroken run of characters (no spaces) never found a wrap
                 point, so it ran straight off the card — `overflowWrap:
                 anywhere` forces a break mid-word;
              2. a genuinely long description grew the block without limit and
                 pushed the sections below it out of the modal.
            -webkit-line-clamp is the only cross-browser 2-line ellipsis, and it
            needs the -webkit-box display + orient pair to engage; pre-wrap is
            swapped for pre-line so the clamp isn't defeated by trailing
            whitespace while newlines in the value still break. */}
        <div
          title={String(value)}
          style={{
            fontSize: 13, color: 'var(--vz-body-color)', lineHeight: 1.5,
            whiteSpace: 'pre-line', overflowWrap: 'anywhere', wordBreak: 'break-word',
            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
        >{value}</div>
      </div>
    );
  };
  return (
    <Modal isOpen={!!request} toggle={onClose} centered size="lg" backdrop="static" modalClassName="rec-view-modal" contentClassName="rec-view-content border-0" zIndex={2200}>
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
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* 8px top/bottom — the same gap the Hiring Requests popup now uses
            above its KPI cards and below its table, so the two modals breathe
            identically. Sides stay at 18px: the section cards are the content
            here, not a full-width table, and pulling them to 8px put them
            almost against the modal edge. */}
        <div className="rec-view-body" style={{ padding: '8px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          <SectionHeader icon="ri-calendar-event-line" title="Section 1 · Request Basics" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="Request Title"    value={raw.title} />
              <Field label="Job Role"         value={raw.job_role || r.position} />
              <Field label="Department"       value={r.department} />
              <Field label="Target Join Date" value={formatDate(r.targetJoinDate)} />
            </div>
          </div>

          <SectionHeader icon="ri-time-line" title="Section 2 · Hiring Need" />
          <div className="rec-view-card">
            <div className="rec-view-grid">
              <Field label="No. of Openings"  value={r.openings} />
              <Field label="Employment Type"  value={raw.employment_type || r.positionType} />
              <Field label="Work Mode"        value={raw.work_mode || r.positionMode} />
              <Field label="Urgency Level"    value={<span className="rec-pill" style={{ background: u.bg, color: u.fg }}>{r.urgency}</span>} />
            </div>
          </div>

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

        {/* Footer only exists to hold decisions. On a read-only request — a
            rejected one, or the Employee Profile > Hiring Requests eye action,
            which passes neither callback — there is nothing to decide, so the
            whole bar goes rather than rendering a "Read-only view" label next
            to a lone Close. The header × dismisses the modal in every case. */}
        {(canReject || showCreate) && (
        <div className="rec-form-footer">
          <span className="hint">Review this request — create a recruitment or reject it</span>
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
            {showCreate && (
              <button
                type="button"
                className="rec-btn-primary"
                disabled={rejecting}
                onClick={() => onCreate?.(r)}
              >
                <i className="ri-user-search-line" />Create Recruitment
              </button>
            )}
          </div>
        </div>
        )}
      </ModalBody>
    </Modal>
  );
}


interface CreateRecruitmentModalProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  editingId: string | null;
  recruitments: RecruitmentRow[];
  prefillFromHr?: any | null;
  onSaved: (row: RecruitmentRow) => void;
  onClose: () => void;
}


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

type RecMastersCache = {
  deptOptions: { value: string; label: string }[];
  desigOptions: { value: string; label: string }[];
  desigByDept: Record<string, { value: string; label: string }[]>;
  roleOptions: { value: string; label: string }[];
  employeeOptions: { value: string; label: string }[];
  hrEmployeeOptions: { value: string; label: string }[];
  hiringManagerOptions: { value: string; label: string }[];
};
let recMastersCache: RecMastersCache | null = null;
/* Which branch the cache above was built for. The employee list is
   branch-scoped (the Axios interceptor injects branch_id), so a cache filled
   under one branch must not paint the picker after the user switches to
   another — they'd see, and could assign, the previous branch's people until
   the refetch landed. A mismatch skips the instant paint; the fetch below
   still runs either way. */
let recMastersCacheBranch: number | null | undefined;

function buildRecMasters(deptData: any, desigData: any, roleData: any, empData: any): RecMastersCache {
  const asRows = (d: any): any[] => Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
  const deptRows  = asRows(deptData);
  const desigRows = asRows(desigData);
  const roleRows  = asRows(roleData);
  const empRows   = asRows(empData);

  const isActiveLower = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';

  const deptOptions = deptRows
    .filter(isActiveLower)
    .map(r => ({ value: String(r.id), label: r.name as string }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

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

  // Primary Role picker must exclude roles marked "Ancillary" in Role Master —
  // only Primary (or legacy/unclassified) roles are selectable (bug #37). Roles
  // with no role_type set (legacy/seed data) stay visible so tenants that never
  // classified their roles don't get an empty dropdown.
  const roleOptions = roleRows
    .filter(isActiveLower)
    .filter(r => String(r.role_type ?? '').trim().toLowerCase() !== 'ancillary')
    .map(r => ({ value: String(r.id), label: r.name as string }))
    .sort((a, b) => a.label.localeCompare(b.label));

  /* Mirror of EmployeeController::isTrainee(). Kept in step with these three
   * signals: designation.level is the canonical, actually-populated tier;
   * employee_type is a closed vocabulary that was backfilled from the free-text
   * work_type and left NULL wherever the old text didn't map, so all three have
   * to be consulted. Returns false when every signal is blank — an employee is
   * hidden only when something concretely says "trainee". */
  const TRAINEE_WORDS = ['intern', 'trainee', 'apprentice', 'articleship'];
  const saysTrainee = (v: unknown) => {
    const s = String(v ?? '').toLowerCase();
    return s !== '' && TRAINEE_WORDS.some(w => s.includes(w));
  };
  const isTraineeRow = (e: any) =>
    saysTrainee(e?.designation?.level) || saysTrainee(e?.employee_type) || saysTrainee(e?.work_type);

  /* Mirror of EmployeeController::isHrEligible(). HR-ness comes from the
   * DEPARTMENT first, then designation / primary role NAME — never from
   * role_category, which is NULL for every role and is what made the original
   * attempt at this filter (#38) match nobody. 'hr' is matched as a whole word
   * so "Warehouse" and "Chairman" don't false-positive. */
  const saysHr = (v: unknown) => {
    const s = String(v ?? '').toLowerCase();
    return s !== '' && (s.includes('human resource') || /\bhr\b/.test(s));
  };
  const isHrRow = (e: any) =>
    !isTraineeRow(e)
    && (saysHr(e?.department?.name) || saysHr(e?.designation?.name) || saysHr(e?.primary_role?.name));

  const empToOpt = (e: any) => {
    const name = e.display_name
      || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ')
      || `Employee #${e.id}`;
    const desig = e?.designation?.name ? ` — ${e.designation.name}` : '';
    return { value: String(e.id), label: `${name}${desig}` };
  };
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  /* `empRows` comes from GET /employees, which the Axios interceptor scopes to
   * the active branch, so "all employees" already means "all employees of this
   * branch" — no extra branch filter needed here.
   *
   * Assigned HR lists only HR staff (bug #66) — see isHrRow. The earlier
   * attempt at this (#38) filtered on primary_role.role_category, which is
   * NULL for every role, so it matched nobody; this reads the department and
   * the role/designation NAME instead. If a tenant has nobody in an HR
   * department the list is legitimately empty, and the field renders a hint
   * saying so rather than silently offering the whole company.
   *
   * Hiring Manager DOES exclude interns / trainees (bug #65) — a trainee can't
   * be accountable for a hire. The rule is an exclude-on-positive-match (see
   * isTraineeRow), never an include-on-match, so it can't repeat #38's failure
   * of emptying the list when the classifying field is blank. The backend
   * applies the same rule via ?exclude_trainees=1; this mirror keeps the list
   * correct even if a cached/legacy response arrives unfiltered.
   */
  const employeeOptions = empRows.map(empToOpt).sort(byLabel);
  const hrEmployeeOptions = empRows.filter(isHrRow).map(empToOpt).sort(byLabel);
  const hiringManagerOptions = empRows.filter(e => !isTraineeRow(e)).map(empToOpt).sort(byLabel);

  return { deptOptions, desigOptions, desigByDept, roleOptions, employeeOptions, hrEmployeeOptions, hiringManagerOptions };
}

function CreateRecruitmentModal({ isOpen, mode, editingId, recruitments, prefillFromHr, onSaved, onClose }: CreateRecruitmentModalProps) {
  const toast = useToast();
  // The employee pickers below list this branch's people, so the masters cache
  // has to follow the branch switcher rather than outlive it.
  const { selectedBranchId } = useBranchSwitcher();
  const editing = mode === 'edit' && editingId ? recruitments.find(r => String(r.id) === String(editingId)) : null;

  const [jobTitle, setJobTitle]               = useState('');
  const [departmentId, setDepartmentId]       = useState('');
  const [designationId, setDesignationId]     = useState('');
  const [primaryRoleId, setPrimaryRoleId]     = useState('');
  const [employmentType, setEmploymentType]   = useState<EmployType | ''>('');
  const [openings, setOpenings]               = useState('');
  const [experience, setExperience]           = useState('');
  const [qualification, setQualification]     = useState('');
  const [workMode, setWorkMode]               = useState<WorkMode | ''>('');
  const [priority, setPriority]               = useState<Priority | ''>('');
  const [hiringManagerId, setHiringManagerId] = useState('');
  const [assignedHrId, setAssignedHrId]       = useState('');
  const [startDate, setStartDate]             = useState('');
  const [deadline, setDeadline]               = useState('');
  const [jobDescription, setJobDescription]   = useState('');
  const [requirements, setRequirements]       = useState('');
  const [ctcRange, setCtcRange]               = useState('');
  const [postOnPortal, setPostOnPortal]       = useState(false);
  const [notifyTeamLeads, setNotifyTeamLeads] = useState(false);
  const [enableReferralBonus, setEnableReferralBonus] = useState(false);

  const [deptOptions, setDeptOptions]   = useState<{ value: string; label: string }[]>([]);
  const [desigOptions, setDesigOptions] = useState<{ value: string; label: string }[]>([]);
  const [desigByDept, setDesigByDept]   = useState<Record<string, { value: string; label: string }[]>>({});
  const [roleOptions, setRoleOptions]   = useState<{ value: string; label: string }[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<{ value: string; label: string }[]>([]);
  // Assigned HR lists everyone; Hiring Manager lists everyone except interns
  // and trainees (#65).
  const [hrEmployeeOptions, setHrEmployeeOptions] = useState<{ value: string; label: string }[]>([]);
  const [hiringManagerOptions, setHiringManagerOptions] = useState<{ value: string; label: string }[]>([]);
  const [mastersLoading, setMastersLoading] = useState(false);

  // The Hiring Manager / Assigned HR pickers list only onboarded + active
  // employees. But a recruitment being edited may point at someone who has
  // since resigned or been removed — they won't be in that list, so the select
  // would show a raw id (e.g. "4"). Inject the saved manager/HR (with their
  // resolved name) as options so the dropdown always shows a name, flagged
  // "(unavailable)" when they're no longer selectable.
  const ensureInList = (
    base: { value: string; label: string }[],
    id: number | null,
    name: string | undefined,
    state?: RecruitmentRow['hiringManagerState'],
  ) => {
    if (id == null) return base;
    const v = String(id);
    if (base.some(o => o.value === v)) return base;
    const suffix = state === 'disabled' ? ' (disabled)'
      : state === 'inactive' ? ' (inactive)'
      : ' (unavailable)';
    // Prefer the resolved name; only when it can't be resolved at all
    // (e.g. the record was hard-removed) fall back to a labelled
    // "unavailable employee" rather than a bare raw id.
    return [...base, { value: v, label: name ? `${name}${suffix}` : `Unavailable employee${suffix}` }];
  };

  // A recruitment being edited may point at someone the picker no longer
  // lists — they resigned, or (for Hiring Manager) their designation was
  // changed to a trainee tier after they were assigned. Inject just that saved
  // person so the dropdown still shows their name, flagged "(unavailable)"
  // when relevant, without loosening the filter for new recruitments. Note the
  // server-side rule still rejects a trainee on SAVE, so a re-save of such a
  // row surfaces the validation error rather than silently keeping them.
  const hiringManagerOptionsForEdit = useMemo(
    () => (editing ? ensureInList(hiringManagerOptions, editing.hiringManagerId, editing.hiringManagerName, editing.hiringManagerState) : hiringManagerOptions),
    [hiringManagerOptions, editing],
  );
  const hrEmployeeOptionsForEdit = useMemo(
    () => (editing ? ensureInList(hrEmployeeOptions, editing.assignedHrId, editing.assignedHrName, editing.assignedHrState) : hrEmployeeOptions),
    [hrEmployeeOptions, editing],
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const hydrate = (c: RecMastersCache) => {
      setDeptOptions(c.deptOptions);
      setDesigOptions(c.desigOptions);
      setDesigByDept(c.desigByDept);
      setRoleOptions(c.roleOptions);
      setEmployeeOptions(c.employeeOptions);
      setHrEmployeeOptions(c.hrEmployeeOptions);
      setHiringManagerOptions(c.hiringManagerOptions);
    };

    if (recMastersCache && recMastersCacheBranch === selectedBranchId) {
      hydrate(recMastersCache);
      setMastersLoading(false);
    } else {
      setMastersLoading(true);
    }

    (async () => {
      try {
        const [deptRes, desigRes, roleRes, empRes] = await Promise.all([
          api.get('/master/departments').catch(() => ({ data: [] })),
          api.get('/master/designations').catch(() => ({ data: [] })),
          api.get('/master/roles').catch(() => ({ data: [] })),
          api.get('/employees', { params: { onboarded_only: 1 } }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const cache = buildRecMasters(deptRes.data, desigRes.data, roleRes.data, empRes.data);
        recMastersCache = cache;
        recMastersCacheBranch = selectedBranchId;
        hydrate(cache);
      } catch {
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
    // Refetch on branch change too — the employee list differs per branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedBranchId]);

  const filteredDesigOptions = useMemo(() => {
    if (departmentId && desigByDept[departmentId]?.length) {
      return desigByDept[departmentId];
    }
    return desigOptions;
  }, [departmentId, desigByDept, desigOptions]);

  type CreateErrors = Partial<Record<
    'jobTitle' | 'department' | 'designation' | 'primaryRole' | 'employmentType' | 'openings' | 'experience'
    | 'workMode' | 'priority' | 'hiringManager' | 'assignedHr' | 'startDate' | 'deadline'
    | 'jobDescription' | 'requirements' | 'ctcRange' | 'qualification',
    string
  >>;
  const [errors, setErrors] = useState<CreateErrors>({});

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setJobTitle(ucFirst(editing.jobTitle));
      setDepartmentId(editing.departmentId != null ? String(editing.departmentId) : '');
      setDesignationId(editing.designationId != null ? String(editing.designationId) : '');
      setPrimaryRoleId(editing.primaryRoleId != null ? String(editing.primaryRoleId) : '');
      setCtcRange(editing.ctcRange || '');
      setEmploymentType(editing.employmentType);
      setOpenings(String(editing.openings));
      setExperience(editing.experience || '');
      setQualification(editing.qualification || '');
      setWorkMode(editing.workMode);
      setPriority(editing.priority);
      setHiringManagerId(editing.hiringManagerId != null ? String(editing.hiringManagerId) : '');
      setAssignedHrId(editing.assignedHrId != null ? String(editing.assignedHrId) : '');
      setStartDate(editing.startDate ? String(editing.startDate).slice(0, 10) : '');
      setDeadline(editing.deadline ? String(editing.deadline).slice(0, 10) : '');
      setJobDescription(ucFirst(editing.jobDescription || ''));
      setRequirements(ucFirst(editing.requirements || ''));
      setPostOnPortal(editing.postOnPortal);
      setNotifyTeamLeads(editing.notifyTeamLeads);
      setEnableReferralBonus(editing.enableReferralBonus);
      // Proactively flag a hiring manager / assigned HR that has since been
      // disabled or exited. The dropdown still shows them (flagged) so the
      // field isn't blank, but we surface a red inline error + a toast on
      // open so the user knows to reassign before saving — instead of a
      // confusing raw "Employee #47" with no explanation.
      const isStale = (s?: RecruitmentRow['hiringManagerState']) => s === 'disabled' || s === 'inactive' || s === 'missing';
      const initErrs: CreateErrors = {};
      // Short inline strip; the toast below carries the full explanation.
      if (isStale(editing.hiringManagerState)) initErrs.hiringManager = 'Inactive — reselect';
      if (isStale(editing.assignedHrState))    initErrs.assignedHr    = 'Inactive — reselect';
      setErrors(initErrs);
      if (Object.keys(initErrs).length) {
        const who = [isStale(editing.hiringManagerState) && 'hiring manager', isStale(editing.assignedHrState) && 'assigned HR'].filter(Boolean).join(' and ');
        toast.warning('Reassignment required', `The ${who} is disabled or has exited. Please select an active employee before saving.`);
      }
    } else if (prefillFromHr) {
      const hr = prefillFromHr;
      setJobTitle(ucFirst((hr.job_role || hr.title || '') as string));
      setDepartmentId(hr.department_id != null ? String(hr.department_id) : '');
      setDesignationId('');
      setPrimaryRoleId('');
      setCtcRange('');
      setEmploymentType((HR_TO_REC_EMP_TYPE[hr.employment_type] || '') as EmployType | '');
      setOpenings(hr.openings ? String(hr.openings) : '');
      setExperience((hr.required_experience || '') as string);
      setQualification((hr.required_qualification || '') as string);
      setWorkMode((HR_TO_REC_WORK_MODE[hr.work_mode] || '') as WorkMode | '');
      setPriority((hr.urgency || '') as Priority | '');
      setHiringManagerId('');
      setAssignedHrId('');
      setStartDate('');
      setDeadline(hr.target_join_date ? String(hr.target_join_date).slice(0, 10) : '');
      setJobDescription(ucFirst((hr.job_description || '') as string));
      setRequirements(ucFirst((hr.required_skills || '') as string));
      setPostOnPortal(false); setNotifyTeamLeads(false); setEnableReferralBonus(false);
      setErrors({});
    } else {
      setJobTitle(''); setDepartmentId(''); setDesignationId(''); setPrimaryRoleId('');
      setCtcRange(''); setEmploymentType('');
      setOpenings(''); setExperience(''); setQualification(''); setWorkMode(''); setPriority('');
      setHiringManagerId(''); setAssignedHrId(''); setStartDate(''); setDeadline('');
      setJobDescription(''); setRequirements('');
      setPostOnPortal(false); setNotifyTeamLeads(false); setEnableReferralBonus(false);
      setErrors({});
    }
  }, [isOpen, editingId, prefillFromHr]);

  const clear = (k: keyof CreateErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): CreateErrors => {
    const e: CreateErrors = {};
    /* Terse by design — see the note in RaiseHiringRequestModal's validate().
       These fields sit three and four to a row, so anything longer than a few
       words wraps and pushes the section below it down. */
    const jobTitleTrim = jobTitle.trim();
    if (!jobTitleTrim) {
      e.jobTitle = 'Required';
    } else if (!/^[A-Za-z0-9 .,\-/]+$/.test(jobTitleTrim)) {
      e.jobTitle = 'No special characters';
    }
    if (!departmentId)           e.department      = 'Required';
    if (!designationId)          e.designation     = 'Required';
    if (!primaryRoleId)          e.primaryRole     = 'Required';
    if (!employmentType)         e.employmentType  = 'Required';
    const openingsTrim = openings.trim();
    if (!openingsTrim) {
      e.openings = 'Required';
    } else {
      const n = Number(openingsTrim);
      if (!Number.isFinite(n)) {
        e.openings = 'Enter a number';
      } else if (!Number.isInteger(n) || /[^0-9]/.test(openingsTrim)) {
        e.openings = 'Whole numbers only';
      } else if (n < 1) {
        e.openings = 'Minimum 1';
      } else if (n > 9999) {
        e.openings = 'Maximum 9,999';
      }
    }
    const ctc = ctcRange.trim();
    // CTC range is OPTIONAL (bug #28) — only validate format/bounds when a
    // value is actually entered; an empty value is allowed.
    if (ctc) {
      if (ctc.length > 50) {
        e.ctcRange = 'Max 50 characters';
      } else if (!/^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?$/.test(ctc)) {
        e.ctcRange = 'Use 8 or 8-12';
      } else {
        const nums = ctc.match(/\d+(?:\.\d+)?/g) || [];
        if (nums.some(num => Number(num) > 9999.99)) {
          e.ctcRange = 'Max 9,999.99 LPA';
        } else if (nums.length === 2 && Number(nums[0]) > Number(nums[1])) {
          e.ctcRange = 'Min is above max';
        }
      }
    }
    if (!priority)               e.priority        = 'Required';
    if (!experience)             e.experience      = 'Required';
    // Optional, but capped. maxLength on the input stops typing at 255 and the
    // server rejects beyond it — neither tells the user why, and a PASTED value
    // longer than the cap is silently truncated by the browser. This is the
    // only place that says what happened.
    if (qualification.trim().length > 255) e.qualification = 'Max 255 characters';
    if (!hiringManagerId)        e.hiringManager   = 'Required';
    if (!assignedHrId)           e.assignedHr      = 'Required';
    // A disabled/inactive person (only present as an injected option, not in the
    // live active list) can't stay assigned — force picking an active employee.
    // Guarded on options being loaded so we don't false-flag during the fetch.
    if (employeeOptions.length > 0) {
      const activeIds = new Set(employeeOptions.map(o => o.value));
      if (hiringManagerId && !activeIds.has(hiringManagerId)) {
        e.hiringManager = 'No longer active — reselect';
      }
      if (assignedHrId && !activeIds.has(assignedHrId)) {
        e.assignedHr = 'No longer active — reselect';
      }
    }
    if (!startDate)              e.startDate       = 'Required';
    if (!deadline)               e.deadline        = 'Required';
    const todayIso = new Date().toISOString().slice(0, 10);
    if (startDate && startDate < todayIso) {
      e.startDate = 'Cannot be in the past';
    }
    if (deadline && startDate && deadline <= startDate) {
      e.deadline = 'Must be after start date';
    }
    const jd = jobDescription.trim();
    if (!jd)                  e.jobDescription = 'Required';
    else if (jd.length < 2)   e.jobDescription = 'Min 2 characters';
    const rq = requirements.trim();
    if (!rq)                  e.requirements   = 'Required';
    else if (rq.length < 2)   e.requirements   = 'Min 2 characters';
    return e;
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const keys = Object.keys(errs);
      const heading = 'Please fix the highlighted fields';
      /* The toast no longer echoes the first inline message. Those are now one
         or two words ("Required"), which told the user nothing on its own once
         it was lifted out of the field it sits under — the count plus the red
         fields themselves carry more. */
      const body = keys.length === 1
        ? 'One field needs attention.'
        : `${keys.length} fields need attention.`;
      toast.error(heading, body);
      return;
    }

    /* Capitalise HERE rather than on keystroke — the stored value is the same
       as before, so an edit re-opens with the capital already in place, but
       the user's cursor is left alone while they type. */
    const payload: Record<string, any> = {
      job_title:             ucFirst(jobTitle.trim()),
      department_id:         Number(departmentId),
      designation_id:        Number(designationId),
      primary_role_id:       primaryRoleId ? Number(primaryRoleId) : null,
      employment_type:       employmentType,
      openings:              Number(openings) || 1,
      experience:            experience || null,
      qualification:         qualification.trim() || null,
      work_mode:             workMode || null,
      ctc_range:             ctcRange || null,
      priority,
      hiring_manager_id:     hiringManagerId ? Number(hiringManagerId) : null,
      assigned_hr_id:        assignedHrId ? Number(assignedHrId) : null,
      start_date:            startDate || null,
      deadline:              deadline || null,
      job_description:       jobDescription ? ucFirst(jobDescription) : null,
      requirements:          requirements ? ucFirst(requirements) : null,
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
      onSaved(apiToRow(data));
    } catch (err: any) {
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
        /* Column-specific short forms where the generic compressor would lose
           the number that matters; everything else falls through to it. */
        const rewrite = (col: string, msg: string): string => {
          const lower = msg.toLowerCase();
          if (col === 'openings') {
            if (lower.includes('integer'))                                 return 'Whole numbers only';
            if (lower.includes('max') || lower.includes('not be greater')) return 'Maximum 9,999';
            if (lower.includes('min') || lower.includes('at least'))       return 'Minimum 1';
          }
          if (col === 'ctc_range' && (lower.includes('max') || lower.includes('characters')))
            return 'Max 50 characters';
          return shortenServerError(msg);
        };
        let firstRaw = '';
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          const raw = Array.isArray(v) ? String(v[0]) : String(v);
          if (!firstRaw) firstRaw = raw;
          mapped[fieldMap[k] || k] = rewrite(k, raw);
        }
        setErrors(mapped);
        toast.error('Please fix the highlighted fields', firstRaw || 'Some inputs need attention.');
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

        <div className="rec-form-body">
          {mode === 'add' && prefillFromHr && (
            <div className="rec-prefill-note">
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
                    /* Raw while typing — see ucFirst's note. Capitalisation
                       happens once, in the save payload below. */
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
              <Col md={4}>
                {/* Optional by design (CBC #56) — no asterisk, no validation
                    entry. A recruitment may have no formal qualification
                    requirement, and requiring it would block every existing
                    row from being edited. */}
                {/* Counter sits on the LABEL row, not over the input: the field is
                    a third of the row wide, and an absolutely-positioned count
                    inside it would sit on top of a long value. */}
                <div className="rec-label-row">
                  <label className="rec-form-label"><i className="ri-graduation-cap-line" />Qualification</label>
                  <span className={`rec-charcount${qualification.length >= 255 ? ' is-max' : ''}`}>
                    {qualification.length}/255
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={255}
                  className={`rec-input${errors.qualification ? ' is-invalid' : ''}`}
                  placeholder="e.g. B.Tech, MBA"
                  value={qualification}
                  onChange={e => { setQualification(e.target.value); clear('qualification'); }}
                />
                {errors.qualification && <div className="rec-error"><i className="ri-error-warning-line" />{errors.qualification}</div>}
              </Col>
              <Col md={4}>
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
              <Col md={4}>
                <label className="rec-form-label"><i className="ri-money-rupee-circle-line" />CTC Range (LPA)</label>
                <input
                  type="text"
                  maxLength={50}
                  inputMode="decimal"
                  className={`rec-input${errors.ctcRange ? ' is-invalid' : ''}`}
                  placeholder="e.g. 8-12"
                  value={ctcRange}
                  onChange={e => {
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
                  options={hiringManagerOptionsForEdit}
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
                  options={hrEmployeeOptionsForEdit}
                  placeholder={
                    employeeOptions.length === 0 ? 'Loading employees…'
                      : hrEmployeeOptionsForEdit.length === 0 ? 'No HR employees found'
                      : '— Select —'
                  }
                  invalid={!!errors.assignedHr}
                />
                {/* An empty list here means the branch has nobody in an HR
                    department — a data gap, not a glitch. Say so, otherwise the
                    field reads as broken. */}
                {!errors.assignedHr && employeeOptions.length > 0 && hrEmployeeOptionsForEdit.length === 0 && (
                  <div className="rec-hint"><i className="ri-information-line" /> Nobody in this branch is in an HR department or role. Set an employee's department to Human Resources to make them selectable.</div>
                )}
                {errors.assignedHr && <div className="rec-error"><i className="ri-error-warning-line" />{errors.assignedHr}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label"><i className="ri-calendar-line" />Start Date<span className="req">*</span></label>
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
                <MasterDatePicker
                  value={deadline}
                  onChange={(v) => { setDeadline(v); clear('deadline'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.deadline}
                  minDate={(() => {
                    const floor = startDate || new Date().toISOString().slice(0, 10);
                    const d = new Date(floor);
                    d.setDate(d.getDate() + 1);
                    return d.toISOString().slice(0, 10);
                  })()}
                />
                {errors.deadline && <div className="rec-error"><i className="ri-error-warning-line" />{errors.deadline}</div>}
              </Col>
            </Row>
          </div>

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

               </div>

        {/* Save is the only footer action. Cancel was redundant with the
            header × and the "Fields marked * are required" hint restated what
            the red asterisks on every label already say. ms-auto keeps the
            button hard right now that the hint is no longer holding the other
            end of the footer's space-between. */}
        <div className="rec-form-footer">
          <div className="d-flex gap-2 ms-auto">
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
        {/* Same modal-wide save lock as the Raise-Request form (#49). */}
        {saving && (
          <div className="rec-save-lock">
            <div className="rec-save-lock-box">
              <Spinner size="sm" style={{ width: 18, height: 18 }} />
              <span>{mode === 'edit' ? 'Saving changes…' : 'Saving recruitment…'}</span>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}


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
  initialAction?: StatusAction;
  onClose: () => void;
  onConfirm: (action: StatusAction, reason: string, notes: string) => void | Promise<void>;
}) {
  const [action, setAction]   = useState<StatusAction>('cancel');
  const [reason, setReason]   = useState<string>('');
  const [notes, setNotes]     = useState<string>('');
  const [reasonErr, setReasonErr] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);

  useEffect(() => {
    if (target) { setAction(initialAction || 'cancel'); setReason(''); setNotes(''); setReasonErr(false); setConfirming(false); }
  }, [target, initialAction]);

  const handleConfirm = async () => {
    if (confirming) return;
    if (action === 'cancel' && !reason) { setReasonErr(true); return; }
    setConfirming(true);
    try {
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

            <div className="rec-cancel-body">

              <div className="rec-cancel-summary">
                {/* Job title leads on the left, the REC-### pill sits hard
                    right. The title is what identifies the requisition to a
                    reader; the code is the reference you check afterwards.
                    `nowrap` + ms-auto rather than justify-content-between so a
                    long title pushes the pill instead of the two drifting apart
                    with a gap in the middle. */}
                <div className="d-flex align-items-center gap-2 flex-nowrap mb-1">
                  <span className="rec-cancel-summary-title">{target.jobTitle}</span>
                  <span className="rec-id-pill ms-auto flex-shrink-0">{target.code || target.id}</span>
                </div>
                <div className="rec-cancel-summary-meta">
                  <span><strong>Dept:</strong> {target.department}</span>
                  <span className="dot">·</span>
                  <span><strong>Openings:</strong> {target.openings}</span>
                  <span className="dot">·</span>
                  <span><strong>HR:</strong> {target.assignedHrName}</span>
                </div>
              </div>

              <div className={`rec-cancel-impact${isComplete ? ' rec-cancel-impact--complete' : ''}`}>
                <i className={isComplete ? 'ri-information-line' : 'ri-alert-line'} />
                <div>
                  {isComplete ? (
                    /* Two lines. The old four-line version spelled out that the
                       SERVER does the checking and what a validation error looks
                       like — mechanism the user doesn't act on. What they need is
                       the precondition and the consequence. */
                    <>
                      <strong>Heads-up:</strong> Every opening needs a <em>Selected</em> candidate —
                      otherwise this is rejected and the requisition stays open.
                    </>
                  ) : (
                    <>
                      <strong>Impact:</strong> {countLabel} linked to this recruitment will be preserved
                      but no longer actionable. This cannot be undone from the UI.
                    </>
                  )}
                </div>
              </div>

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

            {/* Confirm is the only footer action — "Keep Active" did the same
                job as the header ×, which stays. The complete variant carries a
                modifier class rather than an inline `background`: overriding only
                the background left .rec-cancel-confirm's ORANGE shadow glowing
                under a green button. */}
            <div className="rec-cancel-footer">
              <button
                type="button"
                className={`rec-cancel-confirm${isComplete ? ' rec-cancel-confirm--complete' : ''}`}
                onClick={handleConfirm}
                disabled={confirming}
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


/**
 * `disabled` = the row can't take this action (cancelled / completed /
 * expired) — truly inert, the tooltip carries the reason.
 * `locked`   = the USER lacks the permission — looks the same but stays
 * clickable, so the handler can raise the "you don't have permission" toast.
 */
function ActionBtn({
  title, icon, color, onClick, disabled, locked,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean; locked?: boolean }) {
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
        aria-disabled={locked || undefined}
        onClick={onClick}
        style={locked && !disabled ? { opacity: .45, cursor: 'not-allowed', filter: 'grayscale(0.7)' } : undefined}
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

