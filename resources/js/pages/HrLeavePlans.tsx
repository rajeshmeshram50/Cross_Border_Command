import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { MasterFormStyles } from './master/masterFormKit';
import '../../css/recruitment.css';
import '../../css/leave.css';
import './employee-onboarding/HrEmployeeOnboarding.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type CalendarStart = 'fixed_month' | 'joining_date';

interface LeaveTypeRow {
  id: string;
  name: string;
  color: string;
  quotaLabel: string;        // "12 days/year" once configured, "Not Setup" otherwise
  endOfYearLabel: string;    // "Carry forward 5 / Encash 5" or "Not Setup"
  configured: boolean;
}

interface LeavePlan {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  calendarStart: CalendarStart;
  startDate?: string;        // when calendarStart === 'fixed_month'
  showSystemPolicy: boolean;
  customPolicyFile?: string;
  employees: PlanEmployee[];
  leaveTypes: LeaveTypeRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Type Setup config — the wide popup that opens from the Setup button
// on each row. Shape mirrors the six side-tab sections in the screenshots
// (Accrual / Leave Application / Approval / Year End / Probation / Notice
// Period). Backend will eventually persist this per (plan_id, leave_type_id);
// for now it lives in component state so the demo flow is end-to-end.
// ─────────────────────────────────────────────────────────────────────────────
interface AccrualConfig {
  unit: 'days' | 'hours';
  unlimited: boolean;
  yearlyQuota: number;
  mode: 'periodic' | 'attendance' | 'immediate';
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  dayOfMonth: number;
  variesEachMonth: boolean;
  // Accrual Restrictions
  leaveExpires: { enabled: boolean; unit: 'day' | 'month' | 'year'; days: number };
  restrictByAttendance: boolean;
  noAccrualIfOnLeaveFor: { enabled: boolean; days: number };
  noAccrualIfBalanceExceeds: { enabled: boolean; days: number };
  noAccrualIfJoiningAfter: { enabled: boolean; day: number };
  // Extra Leave
  managersCanGrantExtra: boolean;
  employeeOverdraft: { enabled: boolean; days: number };
  accrueByTenure: boolean;
}

interface LeaveAppConfig {
  allowHalfDay: boolean;
  priorNoticeNeeded: boolean;
  limitBackdated: boolean;
  backdatedWithin: { enabled: boolean; days: number };
  backdatedBefore: { enabled: boolean; day: number };
  roundBalances: { enabled: boolean; direction: string; unit: string };
  commentMandatory: boolean;
  preventSelfApply: boolean;
  attachmentsAfter: { enabled: boolean; days: number };
  earliestApply: { enabled: boolean; days: number };
  cannotUseSameYear: boolean;
  preventFutureExpected: boolean;
  minIfBalanceMore: { enabled: boolean; balance: number; minDays: number };
}

interface ApprovalConfig {
  required: boolean;
  approverRole: string;
  autoApproveIfMissing: boolean;
  doNotEmailEveryRequest: boolean;
}

interface YearEndConfig {
  encashmentAllowed: boolean;
  carryForward: 'reset' | 'carry_capped' | 'carry_all';
  carryForwardCap: number;
  carriedExpiresIn: { enabled: boolean; days: number };
  expiryUnchanged: boolean;
  applyForNextYear: boolean;
}

interface ProbationConfig {
  prorateFirstMonth: { enabled: boolean; basis: 'date' | 'range' };
  accrueDuringProbation: boolean;
  afterProbationStart: 'after_wait' | 'immediate';
  waitingDays: number;
  prorateAfterProbationBasis: 'date' | 'range';
  newJoinersAfter: { enabled: boolean; days: number; basis: string };
  maxDuringProbation: { enabled: boolean; days: number };
}

interface NoticePeriodConfig {
  prorateOnExit: boolean;
  noticeExtension: { enabled: boolean; times: number };
}

interface LeaveTypeConfig {
  accrual: AccrualConfig;
  leaveApp: LeaveAppConfig;
  approval: ApprovalConfig;
  yearEnd: YearEndConfig;
  probation: ProbationConfig;
  noticePeriod: NoticePeriodConfig;
}

const defaultLeaveTypeConfig = (): LeaveTypeConfig => ({
  accrual: {
    unit: 'days', unlimited: false, yearlyQuota: 12,
    mode: 'periodic', frequency: 'monthly', dayOfMonth: 1,
    variesEachMonth: false,
    leaveExpires: { enabled: false, unit: 'day', days: 0 },
    restrictByAttendance: false,
    noAccrualIfOnLeaveFor: { enabled: false, days: 30 },
    noAccrualIfBalanceExceeds: { enabled: false, days: 20 },
    noAccrualIfJoiningAfter: { enabled: false, day: 4 },
    managersCanGrantExtra: true,
    employeeOverdraft: { enabled: false, days: 1 },
    accrueByTenure: false,
  },
  leaveApp: {
    allowHalfDay: false, priorNoticeNeeded: false,
    limitBackdated: true,
    backdatedWithin: { enabled: true, days: 25 },
    backdatedBefore: { enabled: false, day: 1 },
    roundBalances: { enabled: false, direction: '', unit: '' },
    commentMandatory: true,
    preventSelfApply: false,
    attachmentsAfter: { enabled: false, days: 0 },
    earliestApply: { enabled: false, days: 0 },
    cannotUseSameYear: false,
    preventFutureExpected: true,
    minIfBalanceMore: { enabled: false, balance: 0, minDays: 0 },
  },
  approval: {
    required: true, approverRole: 'reporting_manager',
    autoApproveIfMissing: false, doNotEmailEveryRequest: false,
  },
  yearEnd: {
    encashmentAllowed: false, carryForward: 'reset', carryForwardCap: 0,
    carriedExpiresIn: { enabled: false, days: 90 },
    expiryUnchanged: true, applyForNextYear: false,
  },
  probation: {
    prorateFirstMonth: { enabled: true, basis: 'date' },
    accrueDuringProbation: false,
    afterProbationStart: 'immediate', waitingDays: 10,
    prorateAfterProbationBasis: 'date',
    newJoinersAfter: { enabled: true, days: 0, basis: 'joining_date' },
    maxDuringProbation: { enabled: false, days: 0 },
  },
  noticePeriod: {
    prorateOnExit: false,
    noticeExtension: { enabled: true, times: 0 },
  },
});

interface PlanEmployee {
  id: string;
  name: string;
  empNo: string;
  department: string;
  jobTitle: string;
  jobTitleTone: { bg: string; fg: string };
  reportingTo: { initials: string; name: string; accent: string };
  location: string;
  initials: string;
  accent: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo data — replace with GET /api/leave-plans + GET /api/leave-plans/:id
// when the backend is ready.
// ─────────────────────────────────────────────────────────────────────────────
const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

const JOB_TITLE_TONES = [
  { bg: '#dceefe', fg: '#0c63b0' },
  { bg: '#fde8c4', fg: '#a4661c' },
  { bg: '#d3f0ee', fg: '#0a716a' },
  { bg: '#ece6ff', fg: '#5a3fd1' },
  { bg: '#fdd9ea', fg: '#a02960' },
  { bg: '#fee2e2', fg: '#b91c1c' },
];

const buildSampleLeaveTypes = (full = false): LeaveTypeRow[] => {
  const all: LeaveTypeRow[] = [
    { id: 'casual',   name: 'Casual Leave',     color: '#7c5cfc', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'sick',     name: 'Sick Leave',       color: '#dc2626', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'paid_h',   name: 'Paid Leave (Half Day)', color: '#f59e0b', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'annual',   name: 'Annual Leave',     color: '#22c55e', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'paid_h2',  name: 'Paid Leave (Half Day)', color: '#fb923c', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'special',  name: 'Special Leave',    color: '#a78bfa', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
    { id: 'unpaid',   name: 'Unpaid Leave',     color: '#ef4444', quotaLabel: 'Not Setup', endOfYearLabel: 'Not Setup', configured: false },
  ];
  return full ? all : all.slice(1, 3);
};

const buildEmployees = (): PlanEmployee[] => [
  { id: 'EMP-001', name: 'Gaurav Jagtap',  empNo: 'EMP-001', department: 'Software Development', jobTitle: 'Engineering Manager', jobTitleTone: JOB_TITLE_TONES[0], reportingTo: { initials: 'VN', name: 'Vikram Nair', accent: accent(4) }, location: 'Pune',  initials: 'GJ', accent: accent(0) },
  { id: 'EMP-002', name: 'Ritika Chauhan', empNo: 'EMP-002', department: 'UI/UX Designing',     jobTitle: 'Senior Designer',    jobTitleTone: JOB_TITLE_TONES[3], reportingTo: { initials: 'GJ', name: 'Gaurav Jagtap', accent: accent(0) }, location: 'Pune', initials: 'RC', accent: accent(5) },
  { id: 'EMP-003', name: 'Swati Joshi',    empNo: 'EMP-003', department: 'Software Testing',    jobTitle: 'QA Lead',            jobTitleTone: JOB_TITLE_TONES[2], reportingTo: { initials: 'GJ', name: 'Gaurav Jagtap', accent: accent(0) }, location: 'Pune', initials: 'SJ', accent: accent(1) },
  { id: 'EMP-004', name: 'Yash Bhosale',   empNo: 'EMP-004', department: 'Mobile App Dev',      jobTitle: 'Mobile Developer',   jobTitleTone: JOB_TITLE_TONES[2], reportingTo: { initials: 'GJ', name: 'Gaurav Jagtap', accent: accent(0) }, location: 'Pune', initials: 'YB', accent: accent(1) },
  { id: 'EMP-005', name: 'Tanya More',     empNo: 'EMP-005', department: 'Data Science',        jobTitle: 'Data Analyst',       jobTitleTone: JOB_TITLE_TONES[5], reportingTo: { initials: 'RP', name: 'Rajesh Pande',  accent: accent(3) }, location: 'Pune', initials: 'TM', accent: accent(3) },
  { id: 'EMP-006', name: 'Harsh Thakur',   empNo: 'EMP-006', department: 'Business Analysis',   jobTitle: 'Business Analyst',   jobTitleTone: JOB_TITLE_TONES[1], reportingTo: { initials: 'NK', name: 'Nisha Kapoor',   accent: accent(2) }, location: 'Pune', initials: 'HT', accent: accent(2) },
];

const buildPlans = (): LeavePlan[] => [
  {
    id: 'plan-execs',
    name: 'Leave plan for Executives',
    isDefault: false,
    calendarStart: 'fixed_month',
    startDate: '2025-04-01',
    showSystemPolicy: true,
    employees: buildEmployees(),
    leaveTypes: buildSampleLeaveTypes(),
  },
  {
    id: 'plan-default',
    name: 'Leave Policy',
    isDefault: true,
    calendarStart: 'fixed_month',
    startDate: '2025-04-01',
    showSystemPolicy: true,
    employees: Array.from({ length: 30 }, (_, i) => ({
      id: `EMP-${String(i + 7).padStart(3, '0')}`,
      name: ['Aarav Mehta', 'Priya Sharma', 'Rohan Desai', 'Sneha Kulkarni', 'Vikram Nair', 'Anjali Patil', 'Karan Joshi', 'Divya Iyer', 'Manish Verma', 'Pooja Reddy'][i % 10],
      empNo: `EMP-${String(i + 7).padStart(3, '0')}`,
      department: ['Software Development', 'Human Resources', 'Product Management', 'Finance & Accounts', 'Sales & Marketing', 'UI/UX Designing', 'Data Science', 'Quality Assurance', 'DevOps & Infrastructure'][i % 9],
      jobTitle: ['Senior Developer', 'HR Manager', 'Product Manager', 'Finance Analyst', 'Sales Head', 'UX Designer', 'ML Engineer', 'QA Engineer', 'DevOps Engineer'][i % 9],
      jobTitleTone: JOB_TITLE_TONES[i % JOB_TITLE_TONES.length],
      reportingTo: { initials: ['GJ', 'SG', 'VN', 'NK', 'RP', 'RC', 'TM', 'SJ'][i % 8], name: ['Gaurav Jagtap', 'Sunita Ghosh', 'Vikram Nair', 'Nisha Kapoor', 'Rajesh Pande', 'Ritika Chauhan', 'Tanya More', 'Swati Joshi'][i % 8], accent: accent(i) },
      location: ['Pune', 'Mumbai', 'Bengaluru', 'Pune', 'Mumbai'][i % 5],
      initials: (['Aarav Mehta', 'Priya Sharma', 'Rohan Desai', 'Sneha Kulkarni', 'Vikram Nair', 'Anjali Patil', 'Karan Joshi', 'Divya Iyer', 'Manish Verma', 'Pooja Reddy'][i % 10]).split(' ').map(s => s[0]).join(''),
      accent: accent(i),
    })),
    leaveTypes: buildSampleLeaveTypes(true),
  },
  {
    id: 'plan-managers',
    name: 'Leave plan for Managers',
    isDefault: false,
    calendarStart: 'fixed_month',
    startDate: '2025-04-01',
    showSystemPolicy: true,
    employees: [],
    leaveTypes: [],
  },
  {
    id: 'plan-tl',
    name: 'tl plan',
    isDefault: false,
    calendarStart: 'fixed_month',
    startDate: '2025-04-01',
    showSystemPolicy: true,
    employees: [],
    leaveTypes: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
type TopTab = 'plans' | 'types' | 'balances' | 'adjustments';
type SubTab = 'config' | 'employees';

export default function HrLeavePlans() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<LeavePlan[]>(buildPlans);
  const [topTab, setTopTab] = useState<TopTab>('plans');
  const [subTab, setSubTab] = useState<SubTab>('config');
  const [activePlanId, setActivePlanId] = useState<string>('plan-execs');
  const [planSearch, setPlanSearch] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showAssignTypes, setShowAssignTypes] = useState(false);
  // Setup modal — `setupTypeId` is the leave-type id whose configuration
  // popup is currently open. Null when closed. Each (plan, type) pair has
  // its own config, so configs are keyed by `${planId}::${typeId}`.
  const [setupTypeId, setSetupTypeId] = useState<string | null>(null);
  const [typeConfigs, setTypeConfigs] = useState<Record<string, LeaveTypeConfig>>({});
  // 3-dot menu on the active plan header
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  // Add / Edit Leave Type popup — `editingTypeId` is null for "create" mode
  // and the row id when editing an existing entry. Same modal handles both.
  const [showAddType, setShowAddType] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  // Mutable catalog state so newly-added leave types persist while the page
  // is open. Backend will replace this with a /api/leave-types fetch.
  const [catalog, setCatalog] = useState<CatalogType[]>(LEAVE_TYPE_CATALOG);

  const editingType = catalog.find(t => t.id === editingTypeId) ?? null;

  const onSaveLeaveType = (t: Omit<CatalogType, 'id' | 'initials' | 'bg' | 'fg'>) => {
    if (editingTypeId) {
      // Edit mode — keep id + colour palette, just patch the editable fields
      // and refresh `initials` to reflect the new code.
      setCatalog(prev => prev.map(row =>
        row.id === editingTypeId
          ? { ...row, ...t, initials: t.code.toUpperCase().slice(0, 3) }
          : row
      ));
    } else {
      // Create mode — assign a fresh palette tone so each new row reads
      // distinct in the table.
      const palette = [
        { bg: '#fee2e2', fg: '#b91c1c' }, { bg: '#fde8c4', fg: '#a4661c' },
        { bg: '#ece6ff', fg: '#5a3fd1' }, { bg: '#d3f0ee', fg: '#0a716a' },
        { bg: '#dceefe', fg: '#0c63b0' }, { bg: '#fdd9ea', fg: '#a02960' },
      ];
      const tone = palette[catalog.length % palette.length];
      setCatalog(prev => [
        ...prev,
        { ...t, id: `lt-${Date.now()}`, initials: t.code.toUpperCase().slice(0, 3), bg: tone.bg, fg: tone.fg },
      ]);
    }
    setShowAddType(false);
    setEditingTypeId(null);
  };

  const onEditLeaveType = (id: string) => {
    setEditingTypeId(id);
    setShowAddType(true);
  };
  const onCloseTypeModal = () => {
    setShowAddType(false);
    setEditingTypeId(null);
  };

  const onMakeDefault = () => {
    if (!activePlanId) return;
    setPlans(prev => prev.map(p => ({ ...p, isDefault: p.id === activePlanId })));
    setPlanMenuOpen(false);
  };
  const onDeletePlan = () => {
    if (!activePlanId) return;
    setPlans(prev => {
      const next = prev.filter(p => p.id !== activePlanId);
      if (next.length > 0) setActivePlanId(next[0].id);
      return next;
    });
    setPlanMenuOpen(false);
  };
  const onClonePlan = () => {
    if (!activePlanId) return;
    const source = plans.find(p => p.id === activePlanId);
    if (!source) return;
    const id = `plan-${Date.now()}`;
    setPlans(prev => [
      ...prev,
      {
        ...source,
        id,
        name: `${source.name} (Copy)`,
        isDefault: false,
        // Cloned plans start with no employees so HR explicitly assigns them.
        employees: [],
      },
    ]);
    setActivePlanId(id);
    setPlanMenuOpen(false);
  };
  const onEditPlan = () => {
    setShowAddPlan(true);
    setPlanMenuOpen(false);
  };

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter(p => p.name.toLowerCase().includes(q));
  }, [plans, planSearch]);

  const activePlan = plans.find(p => p.id === activePlanId) ?? plans[0];

  const filteredEmployees = useMemo(() => {
    if (!activePlan) return [];
    const q = empSearch.trim().toLowerCase();
    if (!q) return activePlan.employees;
    return activePlan.employees.filter(e =>
      [e.name, e.empNo, e.department, e.jobTitle, e.location].some(v => v.toLowerCase().includes(q))
    );
  }, [activePlan, empSearch]);

  const onCreatePlan = (plan: Omit<LeavePlan, 'id' | 'employees' | 'leaveTypes'>) => {
    const id = `plan-${Date.now()}`;
    setPlans(prev => [
      ...prev,
      { ...plan, id, employees: [], leaveTypes: [] },
    ]);
    setActivePlanId(id);
    setShowAddPlan(false);
  };

  const onAssignTypes = (chosen: LeaveTypeRow[]) => {
    setPlans(prev =>
      prev.map(p =>
        p.id === activePlanId
          ? {
              ...p,
              leaveTypes: [
                ...p.leaveTypes,
                ...chosen.filter(c => !p.leaveTypes.some(t => t.id === c.id)),
              ],
            }
          : p
      )
    );
    setShowAssignTypes(false);
  };

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          <div className="lp-shell">
            {/* Header */}
            <div className="lp-header">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 44, height: 44,
                    background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
                    boxShadow: '0 8px 18px rgba(124,92,252,0.32)',
                  }}
                >
                  <i className="ri-calendar-2-line" style={{ color: '#fff', fontSize: 20 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0">Leave Plans</h5>
                  <div className="text-muted fs-13 mt-1">Configure leave policies for employee groups</div>
                </div>
              </div>
              <button
                type="button"
                className="lp-close-btn"
                onClick={() => navigate('/hr/leave')}
                aria-label="Back to leave management"
                title="Back to leave management"
              >
                <i className="ri-close-line" />
              </button>
            </div>

            {/* Top tabs + Add Leave Plan */}
            <div className="lp-top-tabs">
              <div className="lp-tabs-row">
                {([
                  { key: 'plans',       label: 'Leave Plans' },
                  { key: 'types',       label: 'Leave Types' },
                  { key: 'balances',    label: 'Leave Balances' },
                  { key: 'adjustments', label: 'Initial Adjustments' },
                ] as const).map(t => (
                  <button
                    key={t.key}
                    type="button"
                    className={`lp-top-tab ${topTab === t.key ? 'is-active' : ''}`}
                    onClick={() => setTopTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {topTab === 'plans' && (
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => setShowAddPlan(true)}
                >
                  <i className="ri-add-line" />Add Leave Plan
                </button>
              )}
              {topTab === 'types' && (
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => setShowAddType(true)}
                >
                  <i className="ri-add-line" />Add Leave Type
                </button>
              )}
            </div>

            {topTab === 'plans' ? (
              <div className="lp-body">
                {/* Sidebar — list of plans */}
                <aside className="lp-sidebar">
                  <div className="lp-search-box">
                    <i className="ri-search-line" />
                    <input
                      type="text"
                      placeholder="Search plans..."
                      value={planSearch}
                      onChange={e => setPlanSearch(e.target.value)}
                    />
                  </div>
                  <div className="lp-section-label">LEAVE PLANS</div>
                  <div className="lp-plan-list">
                    {filteredPlans.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActivePlanId(p.id)}
                        className={`lp-plan-item ${p.id === activePlanId ? 'is-active' : ''}`}
                      >
                        <div className="d-flex align-items-center justify-content-between gap-2">
                          <div className="lp-plan-name">{p.name}</div>
                          {p.isDefault && (
                            <span className="lp-default-pill">DEFAULT</span>
                          )}
                        </div>
                        <div className="lp-plan-count">
                          {p.employees.length} {p.employees.length === 1 ? 'Employee' : 'Employees'}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="lp-new-plan-btn"
                    onClick={() => setShowAddPlan(true)}
                  >
                    <i className="ri-add-line" />New Plan
                  </button>
                </aside>

                {/* Main panel */}
                <main className="lp-main">
                  {!activePlan ? (
                    <div className="text-muted text-center py-5">No plans yet. Click "+ Add Leave Plan" to create one.</div>
                  ) : (
                    <>
                      <div className="lp-main-head">
                        <div className="min-w-0">
                          <h5 className="fw-bold mb-1">{activePlan.name}</h5>
                          <div className="text-muted fs-13 d-flex align-items-center gap-1">
                            <i className="ri-calendar-line" />
                            Apr – Mar
                          </div>
                        </div>
                        <Dropdown isOpen={planMenuOpen} toggle={() => setPlanMenuOpen(o => !o)}>
                          <DropdownToggle tag="button" type="button" className="lp-icon-btn" aria-label="More options">
                            <i className="ri-more-2-fill" />
                          </DropdownToggle>
                          <DropdownMenu end className="lp-plan-menu">
                            <DropdownItem onClick={onEditPlan}>
                              <i className="ri-pencil-line me-2" />Edit
                            </DropdownItem>
                            <DropdownItem onClick={onDeletePlan} disabled={activePlan.isDefault}>
                              <i className="ri-delete-bin-line me-2" />Delete Plan
                            </DropdownItem>
                            <DropdownItem onClick={onMakeDefault} disabled={activePlan.isDefault}>
                              <i className="ri-star-line me-2" />Make as Default
                            </DropdownItem>
                            <DropdownItem onClick={onClonePlan}>
                              <i className="ri-file-copy-line me-2" />Clone Leave Plan
                            </DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      <div className="lp-sub-tabs">
                        {([
                          { key: 'config',    label: 'Configuration' },
                          { key: 'employees', label: 'Employees' },
                        ] as const).map(t => (
                          <button
                            key={t.key}
                            type="button"
                            className={`lp-sub-tab ${subTab === t.key ? 'is-active' : ''}`}
                            onClick={() => setSubTab(t.key)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>

                      {subTab === 'config' && (
                        <ConfigurationTab
                          plan={activePlan}
                          onAssignTypes={() => setShowAssignTypes(true)}
                          onSetupType={(typeId) => setSetupTypeId(typeId)}
                        />
                      )}
                      {subTab === 'employees' && (
                        <EmployeesTab
                          employees={filteredEmployees}
                          totalCount={activePlan.employees.length}
                          search={empSearch}
                          onSearch={setEmpSearch}
                        />
                      )}
                    </>
                  )}
                </main>
              </div>
            ) : topTab === 'types' ? (
              <LeaveTypesTab catalog={catalog} onEdit={onEditLeaveType} />
            ) : topTab === 'balances' ? (
              <LeaveBalancesTab employees={plans.flatMap(p => p.employees)} />
            ) : (
              <InitialAdjustmentsTab />
            )}
          </div>
        </Col>
      </Row>

      <AddLeavePlanModal
        isOpen={showAddPlan}
        onClose={() => setShowAddPlan(false)}
        onSave={onCreatePlan}
      />

      <AddLeaveTypeModal
        isOpen={showAddType}
        editing={editingType}
        onClose={onCloseTypeModal}
        onSave={onSaveLeaveType}
      />

      <AssignLeaveTypesModal
        isOpen={showAssignTypes}
        planName={activePlan?.name ?? ''}
        existingTypeIds={new Set(activePlan?.leaveTypes.map(t => t.id) ?? [])}
        onClose={() => setShowAssignTypes(false)}
        onSave={onAssignTypes}
      />

      <LeaveTypeSetupModal
        isOpen={!!setupTypeId}
        leaveType={activePlan?.leaveTypes.find(t => t.id === setupTypeId) ?? null}
        config={
          setupTypeId && activePlan
            ? typeConfigs[`${activePlan.id}::${setupTypeId}`] ?? defaultLeaveTypeConfig()
            : defaultLeaveTypeConfig()
        }
        onClose={() => setSetupTypeId(null)}
        onChange={(next) => {
          if (!setupTypeId || !activePlan) return;
          setTypeConfigs(prev => ({
            ...prev,
            [`${activePlan.id}::${setupTypeId}`]: next,
          }));
          // Marking the row "configured" so the table flips its Quota/EOY pills
          // from red (Not Setup) to green once HR has touched the popup.
          setPlans(prev => prev.map(p =>
            p.id === activePlan.id
              ? {
                  ...p,
                  leaveTypes: p.leaveTypes.map(t =>
                    t.id === setupTypeId
                      ? {
                          ...t,
                          configured: true,
                          quotaLabel: next.accrual.unlimited ? 'Unlimited' : `${next.accrual.yearlyQuota} ${next.accrual.unit}/year`,
                          endOfYearLabel:
                            next.yearEnd.carryForward === 'reset'   ? 'Reset to zero'
                            : next.yearEnd.carryForward === 'carry_all' ? 'Carry all forward'
                            : `Carry up to ${next.yearEnd.carryForwardCap || 0}`,
                        }
                      : t
                  ),
                }
              : p
          ));
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration tab — leave-type table with Setup buttons
// ─────────────────────────────────────────────────────────────────────────────
function ConfigurationTab({ plan, onAssignTypes, onSetupType }: { plan: LeavePlan; onAssignTypes: () => void; onSetupType: (typeId: string) => void }) {
  return (
    <div className="lp-config">
      <div className="lp-config-actions">
        <button type="button" className="rec-btn-primary" onClick={onAssignTypes}>
          <i className="ri-add-line" />Add leave type
        </button>
        <span className="lp-help-chip">
          <i className="ri-information-line" />
          Need help configuring? <a href="#guide">Check the guide here.</a>
        </span>
      </div>

      <div className="lp-config-table-wrap">
        <table className="lp-config-table">
          <thead>
            <tr>
              <th>LEAVE TYPE</th>
              <th>QUOTA</th>
              <th>END OF YEAR</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {plan.leaveTypes.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-5">
                  <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.35 }} />
                  <div className="fw-semibold">No leave types added yet</div>
                  <div className="text-muted fs-13 mt-1">Click <strong>+ Add leave type</strong> to configure leave categories for this plan.</div>
                </td>
              </tr>
            ) : plan.leaveTypes.map(t => (
              <tr key={t.id}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <span className="lp-type-dot" style={{ background: t.color }} />
                    <span className="fw-semibold fs-13">{t.name}</span>
                  </div>
                </td>
                <td>
                  <span className={t.configured ? 'lp-status-ok' : 'lp-status-todo'}>
                    {t.configured ? <i className="ri-check-line" /> : <i className="ri-error-warning-line" />}
                    {t.quotaLabel}
                  </span>
                </td>
                <td>
                  <span className={t.configured ? 'lp-status-ok' : 'lp-status-todo'}>
                    {t.configured ? <i className="ri-check-line" /> : <i className="ri-error-warning-line" />}
                    {t.endOfYearLabel}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="lp-setup-btn" onClick={() => onSetupType(t.id)}>Setup</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.isDefault && (
        <div className="lp-info-banner">
          <i className="ri-information-line" />
          This is the default plan — showing {plan.leaveTypes.length} of 7 leave types.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employees tab — list of employees assigned to the plan
// ─────────────────────────────────────────────────────────────────────────────
function EmployeesTab({
  employees, totalCount, search, onSearch,
}: {
  employees: PlanEmployee[];
  totalCount: number;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <div className="lp-employees">
      <div className="lp-employees-head">
        <div className="d-flex align-items-center gap-2">
          <h6 className="mb-0 fw-bold">All Employees</h6>
          <span className="lp-count-pill">{totalCount}</span>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="lp-search-box" style={{ width: 220 }}>
            <i className="ri-search-line" />
            <input
              type="text"
              placeholder="Search employees..."
              value={search}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
          <button type="button" className="rec-btn-primary">
            <i className="ri-user-add-line" />Assign Employee
          </button>
        </div>
      </div>

      <div className="lp-config-table-wrap">
        <table className="lp-emp-table">
          <thead>
            <tr>
              <th>EMPLOYEE NAME</th>
              <th>EMPLOYEE NUMBER</th>
              <th>DEPARTMENT</th>
              <th>JOB TITLE</th>
              <th>REPORTING TO</th>
              <th>LOCATION</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-5 text-muted">
                  <i className="ri-team-line d-block mb-2" style={{ fontSize: 32, opacity: 0.35 }} />
                  No employees match your search
                </td>
              </tr>
            ) : employees.map(e => (
              <tr key={e.id}>
                <td>
                  <a href="#" className="lp-emp-name">{e.name}</a>
                </td>
                <td>
                  <a href="#" className="lp-emp-link">{e.empNo}</a>
                </td>
                <td className="fs-13">{e.department}</td>
                <td>
                  <span className="rec-pill" style={{ background: e.jobTitleTone.bg, color: e.jobTitleTone.fg }}>
                    {e.jobTitle}
                  </span>
                </td>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                      style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${e.reportingTo.accent}, ${e.reportingTo.accent}cc)` }}
                    >
                      {e.reportingTo.initials}
                    </span>
                    <span className="fs-13">{e.reportingTo.name}</span>
                  </div>
                </td>
                <td className="fs-13 text-muted">
                  <i className="ri-map-pin-line me-1" />
                  {e.location}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Types tab — master catalog. Two visual groups: Regular leave-types
// (Sick, Casual, Paid, Comp Off, Unpaid) and Statutory / Incidental ones
// (Floater, Special, Maternity, Paternity, Bereavement). Each row exposes an
// "is paid" pill, a short code badge, and view/edit actions.
// ─────────────────────────────────────────────────────────────────────────────
type CatalogType = {
  id: string;
  name: string;
  type: string;            // Regular / Compensatory offs / Unpaid / Incident based
  isPaid: 'Paid' | 'Unpaid';
  code: string;
  initials: string;        // small badge text (e.g. SL)
  bg: string;
  fg: string;
  group: 'regular' | 'incidental';
};

const LEAVE_TYPE_CATALOG: CatalogType[] = [
  { id: 'sick',       name: 'Sick Leave',           type: 'Regular',          isPaid: 'Paid',   code: 'SL',  initials: 'SL',  bg: '#fee2e2', fg: '#b91c1c', group: 'regular' },
  { id: 'paid_h',     name: 'Paid Leave (Half Day)',type: 'Regular',          isPaid: 'Paid',   code: 'PL',  initials: 'PL',  bg: '#fde8c4', fg: '#a4661c', group: 'regular' },
  { id: 'casual',     name: 'Casual Leave',         type: 'Regular',          isPaid: 'Paid',   code: 'CL',  initials: 'CL',  bg: '#ece6ff', fg: '#5a3fd1', group: 'regular' },
  { id: 'comp',       name: 'Comp Offs',            type: 'Compensatory offs',isPaid: 'Paid',   code: 'CO',  initials: 'CO',  bg: '#d3f0ee', fg: '#0a716a', group: 'regular' },
  { id: 'unpaid',     name: 'Unpaid Leave',         type: 'Unpaid',           isPaid: 'Unpaid', code: 'UL',  initials: 'UL',  bg: '#fee2e2', fg: '#b91c1c', group: 'regular' },
  { id: 'floater',    name: 'Floater Leave',        type: 'Incident based',   isPaid: 'Paid',   code: 'FL',  initials: 'FL',  bg: '#d3f0ee', fg: '#0a716a', group: 'incidental' },
  { id: 'special',    name: 'Special Leave',        type: 'Incident based',   isPaid: 'Paid',   code: 'SPL', initials: 'SPL', bg: '#ece6ff', fg: '#5a3fd1', group: 'incidental' },
  { id: 'maternity',  name: 'Maternity Leave',      type: 'Incident based',   isPaid: 'Paid',   code: 'ML',  initials: 'ML',  bg: '#fdd9ea', fg: '#a02960', group: 'incidental' },
  { id: 'paternity',  name: 'Paternity Leave',      type: 'Incident based',   isPaid: 'Paid',   code: 'PT',  initials: 'PT',  bg: '#dceefe', fg: '#0c63b0', group: 'incidental' },
  { id: 'bereavement',name: 'Bereavement Leave',    type: 'Incident based',   isPaid: 'Paid',   code: 'BL',  initials: 'BL',  bg: '#eef2f6', fg: '#374151', group: 'incidental' },
];

function LeaveTypesTab({ catalog, onEdit }: { catalog: CatalogType[]; onEdit: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const filter = (rows: CatalogType[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.name, r.type, r.code].some(v => v.toLowerCase().includes(q)));
  };
  const regular     = filter(catalog.filter(t => t.group === 'regular'));
  const incidental  = filter(catalog.filter(t => t.group === 'incidental'));

  return (
    <div className="lp-types-pane">
      <div className="lp-info-banner-blue">
        <i className="ri-information-line" />
        Setting up new leave plans or types? <a href="#guide">Here's a quick guide to get you started!</a>
      </div>

      <div className="lp-types-head">
        <h6 className="mb-1 fw-bold">Leave types</h6>
        <div className="text-muted fs-13">
          Below are the leave types that you'd like to use in your organisation or you can add a new leave type as you desire.
        </div>
      </div>

      <div className="lp-search-box mb-3" style={{ maxWidth: 360 }}>
        <i className="ri-search-line" />
        <input
          type="text"
          placeholder="Search leave types..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="lp-config-table-wrap">
        <table className="lp-config-table lp-types-table">
          <thead>
            <tr>
              <th style={{ width: '36%' }}>NAME</th>
              <th>TYPE</th>
              <th style={{ width: 110 }}>IS PAID</th>
              <th style={{ width: 100 }}>CODE</th>
              <th style={{ width: 110, textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {regular.map(t => <CatalogRow key={t.id} t={t} onEdit={onEdit} />)}
            {incidental.length > 0 && (
              <tr className="lp-group-row">
                <td colSpan={5}>STATUTORY / INCIDENTAL</td>
              </tr>
            )}
            {incidental.map(t => <CatalogRow key={t.id} t={t} onEdit={onEdit} />)}
            {regular.length === 0 && incidental.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-5 text-muted">
                  <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                  No leave types match your search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatalogRow({ t, onEdit }: { t: CatalogType; onEdit: (id: string) => void }) {
  return (
    <tr>
      <td>
        <div className="d-flex align-items-center gap-2">
          <span className="lp-code-pill" style={{ background: t.bg, color: t.fg }}>{t.initials}</span>
          <span className="fw-semibold fs-13">{t.name}</span>
        </div>
      </td>
      <td className="fs-13 text-muted">{t.type}</td>
      <td>
        <span
          className="rec-pill"
          style={{
            background: t.isPaid === 'Paid' ? '#d3f0ee' : '#eef2f6',
            color:      t.isPaid === 'Paid' ? '#0a716a' : '#374151',
          }}
        >
          {t.isPaid}
        </span>
      </td>
      <td>
        <span className="lp-code-pill" style={{ background: t.bg, color: t.fg }}>{t.code}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className="d-flex justify-content-end gap-1">
          <button type="button" className="lp-row-action" aria-label="View" onClick={() => onEdit(t.id)} title="View / edit">
            <i className="ri-eye-line" />
          </button>
          <button type="button" className="lp-row-action" aria-label="Edit" onClick={() => onEdit(t.id)} title="Edit leave type">
            <i className="ri-pencil-line" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Balances tab — every employee × every leave-type. Each cell shows a
// used/total fraction with a thin progress bar so HR can read consumption at
// a glance. Rows derive from whatever PlanEmployees the parent passes in.
// ─────────────────────────────────────────────────────────────────────────────
// Columns mirror the Figma reference (Sick → Casual). Comp Offs lives in
// the catalog but is hidden here since it's accrual-driven and isn't a
// fixed-quota balance the row needs to render.
const BALANCE_COLUMNS = [
  { id: 'sick',        label: 'Sick Leave',           total: 12 },
  { id: 'paid_h',      label: 'Paid Leave (Half Day)',total: 6  },
  { id: 'unpaid',      label: 'Unpaid Leave',         total: 0  },     // Unlimited
  { id: 'floater',     label: 'Floater Leave',        total: 2  },
  { id: 'special',     label: 'Special Leave',        total: 5  },
  { id: 'maternity',   label: 'Maternity Leave',      total: 90 },
  { id: 'paternity',   label: 'Paternity Leave',      total: 7  },
  { id: 'bereavement', label: 'Bereavement Leave',    total: 5  },
  { id: 'casual',      label: 'Casual Leave',         total: 8  },
];

function pseudoUsed(seed: string, total: number, idx: number): number {
  if (total === 0) return 0;
  let h = 0;
  const key = `${seed}-${idx}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % (total + 1);
}

function LeaveBalancesTab({ employees }: { employees: PlanEmployee[] }) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('All');
  const [location, setLocation] = useState('All');

  const uniq = (key: keyof PlanEmployee) =>
    Array.from(new Set(employees.map(e => String(e[key])))).filter(Boolean).sort();

  const DEPT_OPTS = [{ value: 'All', label: 'Department' }, ...uniq('department').map(v => ({ value: v, label: v }))];
  const LOC_OPTS  = [{ value: 'All', label: 'Location'   }, ...uniq('location').map(v => ({ value: v, label: v }))];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e => {
      if (department !== 'All' && e.department !== department) return false;
      if (location   !== 'All' && e.location   !== location)   return false;
      if (!q) return true;
      return [e.name, e.empNo, e.department, e.jobTitle].some(v => v.toLowerCase().includes(q));
    });
  }, [employees, search, department, location]);

  return (
    <div className="lp-balances-pane">
      <div className="lp-types-head">
        <h6 className="mb-1 fw-bold">Leave Balances</h6>
        <div className="text-muted fs-13">View and configure leave balances of all employees</div>
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
        <div style={{ minWidth: 150 }}>
          <select className="lp-field-input" value={department} onChange={e => setDepartment(e.target.value)}>
            {DEPT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <select className="lp-field-input" value={location} onChange={e => setLocation(e.target.value)}>
            {LOC_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="lp-search-box flex-grow-1" style={{ minWidth: 240 }}>
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="lp-icon-btn" aria-label="More filters">
          <i className="ri-equalizer-2-line" />
        </button>
      </div>

      <div className="lp-config-table-wrap lp-balances-wrap">
        <table className="lp-config-table lp-balances-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>EMPLOYEE NAME</th>
              <th style={{ minWidth: 100 }}>EMP NO.</th>
              <th style={{ minWidth: 110 }}>LOCATION</th>
              {BALANCE_COLUMNS.map(c => (
                <th key={c.id} style={{ minWidth: 140 }}>{c.label.toUpperCase()}</th>
              ))}
              <th style={{ minWidth: 100, textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3 + BALANCE_COLUMNS.length + 1} className="text-center py-5 text-muted">
                  <i className="ri-team-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                  No employees match your filters
                </td>
              </tr>
            ) : filtered.map((e, idx) => (
              <tr key={e.id}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                      style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)` }}
                    >
                      {e.initials}
                    </span>
                    <div>
                      <a href="#" className="lp-emp-name d-block fs-13">{e.name}</a>
                      <span className="text-muted" style={{ fontSize: 11 }}>{e.jobTitle}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <a href="#" className="lp-emp-link fs-13">{e.empNo}</a>
                </td>
                <td className="fs-13 text-muted">
                  <i className="ri-map-pin-line me-1" />{e.location}
                </td>
                {BALANCE_COLUMNS.map((c, ci) => {
                  if (c.id === 'unpaid') {
                    return (
                      <td key={c.id}>
                        <span className="rec-pill" style={{ background: '#d1fae5', color: '#065f46', fontSize: 10.5 }}>
                          <i className="ri-infinity-line me-1" />Unlimited
                        </span>
                      </td>
                    );
                  }
                  if (c.total === 0) {
                    return <td key={c.id} className="text-muted">—</td>;
                  }
                  const used = pseudoUsed(e.id, c.total, ci + idx);
                  const pct = Math.min(100, Math.round((used / c.total) * 100));
                  const tone = pct >= 100 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#7c5cfc';
                  return (
                    <td key={c.id}>
                      <div className="lp-balance-cell">
                        <div className="d-flex align-items-center justify-content-between">
                          <span className="fw-semibold fs-13">{used}/{c.total}</span>
                          <span className="text-muted" style={{ fontSize: 10.5 }}>{pct}%</span>
                        </div>
                        <span className="lp-balance-track">
                          <span className="lp-balance-fill" style={{ width: `${pct}%`, background: tone }} />
                        </span>
                      </div>
                    </td>
                  );
                })}
                <td style={{ textAlign: 'right' }}>
                  <div className="d-flex justify-content-end gap-1">
                    <button type="button" className="lp-row-action" aria-label="Edit balances" title="Edit balances">
                      <i className="ri-pencil-line" />
                    </button>
                    <button type="button" className="lp-row-action" aria-label="Reset balances" title="Reset balances">
                      <i className="ri-refresh-line" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial Adjustments tab — empty-state placeholder. Adjustments are an
// admin-driven feature so the default view is an explainer + a CTA. Once HR
// adds the first adjustment, this swaps to a row table (TODO when the
// backend exposes /api/leave-adjustments).
// ─────────────────────────────────────────────────────────────────────────────
function InitialAdjustmentsTab() {
  return (
    <div className="lp-adj-pane">
      <div className="lp-types-head">
        <h6 className="mb-1 fw-bold">Initial Adjustments</h6>
        <div className="text-muted fs-13">Set opening leave balances for employees</div>
      </div>

      <div className="lp-adj-empty">
        <span className="lp-adj-empty-icon">
          <i className="ri-pencil-line" />
        </span>
        <div className="fw-bold mt-3" style={{ fontSize: 14 }}>Initial Adjustments</div>
        <div className="text-muted fs-13 mt-1 mb-3">
          Configure opening leave balance adjustments for employees at the start of the period.
        </div>
        <button type="button" className="rec-btn-primary">
          <i className="ri-add-line" />Add Adjustment
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Leave Plan modal — right-side drawer
// ─────────────────────────────────────────────────────────────────────────────
function AddLeavePlanModal({
  isOpen, onClose, onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (plan: Omit<LeavePlan, 'id' | 'employees' | 'leaveTypes'>) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [calendarStart, setCalendarStart] = useState<CalendarStart>('fixed_month');
  const [startDate, setStartDate] = useState('');
  const [showSystemPolicy, setShowSystemPolicy] = useState(true);
  const [uploadCustom, setUploadCustom] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const reset = () => {
    setName(''); setDescription(''); setShowDescription(false);
    setCalendarStart('fixed_month'); setStartDate('');
    setShowSystemPolicy(true); setUploadCustom(false); setIsDefault(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      calendarStart,
      startDate: calendarStart === 'fixed_month' ? startDate : undefined,
      showSystemPolicy,
      isDefault,
    });
    reset();
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      size="lg"
      backdrop="static"
      modalClassName="rec-form-modal"
      contentClassName="rec-form-content border-0"
    >
      <ModalBody className="p-0">
        {/* Header — purple gradient with glossy overlay (rec-form-header). */}
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className="ri-calendar-2-line" style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  Add Leave Plan
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Create a new leave policy group
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* Body — sectioned form using the shared rec-form-section primitives. */}
        <div className="rec-form-body">
          {/* Section 1 — Plan Identity */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span
                className="rec-form-section-icon"
                style={{
                  background: 'linear-gradient(135deg,#5b3fd1 0%,#7c5cfc 50%,#a78bfa 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(124,92,252,0.35), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-shield-user-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 1 · Plan Identity</p>
                <p className="rec-form-section-sub">A short name and optional description help HR pick the right plan.</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={12}>
                <label className="rec-form-label">Leave Plan Name<span className="req">*</span></label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. Leave plan for Executives"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </Col>
              <Col md={12}>
                {showDescription ? (
                  <>
                    <label className="rec-form-label">Description</label>
                    <textarea
                      className="rec-input rec-textarea"
                      rows={2}
                      placeholder="What's this plan for?"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className="rec-btn-ghost"
                    style={{ marginTop: 4 }}
                    onClick={() => setShowDescription(true)}
                  >
                    <i className="ri-add-line" />Add description
                  </button>
                )}
              </Col>
            </Row>
          </div>

          {/* Section 2 — Calendar Year */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span
                className="rec-form-section-icon"
                style={{
                  background: 'linear-gradient(135deg,#a4661c 0%,#f59e0b 50%,#fbbf24 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-calendar-event-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 2 · Calendar Year</p>
                <p className="rec-form-section-sub">When does this plan's leave cycle reset?</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={12}>
                <label className={`lp-radio-card ${calendarStart === 'fixed_month' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="calendar-start"
                    checked={calendarStart === 'fixed_month'}
                    onChange={() => setCalendarStart('fixed_month')}
                  />
                  <div className="flex-grow-1">
                    <div className="fw-semibold" style={{ fontSize: 13 }}>Starts from a particular month</div>
                    {calendarStart === 'fixed_month' && (
                      <input
                        type="date"
                        className="rec-input mt-2"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                      />
                    )}
                  </div>
                </label>
              </Col>
              <Col md={12}>
                <label className={`lp-radio-card ${calendarStart === 'joining_date' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="calendar-start"
                    checked={calendarStart === 'joining_date'}
                    onChange={() => setCalendarStart('joining_date')}
                  />
                  <div className="flex-grow-1">
                    <div className="fw-semibold" style={{ fontSize: 13 }}>From employee joining date</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      The calendar year for the employee will start from the date of their joining and end on their work anniversary.
                    </div>
                  </div>
                </label>
              </Col>
            </Row>
          </div>

          {/* Section 3 — Policy Explanation + Plan Settings */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span
                className="rec-form-section-icon"
                style={{
                  background: 'linear-gradient(135deg,#0c63b0 0%,#3b82f6 50%,#60a5fa 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-settings-3-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 3 · Policy &amp; Settings</p>
                <p className="rec-form-section-sub">How the plan explains itself, and whether it's the org default.</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={12}>
                <label className="lp-checkbox-row">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={showSystemPolicy}
                    onChange={e => setShowSystemPolicy(e.target.checked)}
                  />
                  <span className="flex-grow-1">Show leave policy explanation generated by system</span>
                  <i className="ri-information-line text-muted" title="Auto-generated from configured leave types" />
                </label>
              </Col>
              <Col md={12}>
                <label className="lp-checkbox-row">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={uploadCustom}
                    onChange={e => setUploadCustom(e.target.checked)}
                  />
                  <span>Upload custom leave policy document</span>
                </label>
              </Col>
              <Col md={12}>
                <div className="lp-toggle-row" style={{ marginTop: 8 }}>
                  <div>
                    <div className="fw-semibold" style={{ fontSize: 13 }}>Set as default plan</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      All new employees will be assigned this plan
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`lp-switch ${isDefault ? 'is-on' : ''}`}
                    onClick={() => setIsDefault(v => !v)}
                    role="switch"
                    aria-checked={isDefault}
                  >
                    <span className="lp-switch-thumb" />
                  </button>
                </div>
              </Col>
            </Row>
          </div>
        </div>

        {/* Footer — shared rec-form-footer chrome. */}
        <div className="rec-form-footer">
          <span className="hint">
            Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required
          </span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={handleClose}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={!name.trim()}
            >
              <i className="ri-save-3-line" />Save Plan
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddLeaveTypeModal — centered popup opened from the Leave Types tab. One
// modal handles two modes: create (when `editing` is null) and edit
// (when `editing` carries the row to update). The form fields hydrate from
// `editing` on open so HR sees the current values, not blanks.
// ─────────────────────────────────────────────────────────────────────────────
function AddLeaveTypeModal({
  isOpen, editing, onClose, onSave,
}: {
  isOpen: boolean;
  editing: CatalogType | null;
  onClose: () => void;
  onSave: (t: Omit<CatalogType, 'id' | 'initials' | 'bg' | 'fg'>) => void;
}) {
  const [name, setName]   = useState('');
  const [type, setType]   = useState<string>('Regular');
  const [isPaid, setIsPaid] = useState<'Paid' | 'Unpaid'>('Paid');
  const [code, setCode]   = useState('');

  // Hydrate from the row being edited each time the popup opens. When
  // `editing` is null we reset to a clean create-mode form.
  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setIsPaid(editing.isPaid);
      setCode(editing.code);
    } else {
      setName(''); setType('Regular'); setIsPaid('Paid'); setCode('');
    }
  }, [isOpen, editing]);

  const reset = () => { setName(''); setType('Regular'); setIsPaid('Paid'); setCode(''); };
  const handleClose = () => { reset(); onClose(); };

  const TYPE_OPTIONS = ['Regular', 'Compensatory offs', 'Unpaid', 'Incident based'];
  // Statutory/Incidental types group under the second table section; everything
  // else lives under Regular. Driven by the chosen `type` so HR doesn't have
  // to think about it.
  const group: CatalogType['group'] = type === 'Incident based' ? 'incidental' : 'regular';

  const canSave = name.trim().length > 0 && code.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      type,
      isPaid: type === 'Unpaid' ? 'Unpaid' : isPaid,
      code: code.trim().toUpperCase(),
      group,
    });
    reset();
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      size="lg"
      backdrop="static"
      modalClassName="rec-form-modal"
      contentClassName="rec-form-content border-0"
    >
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className={editing ? 'ri-pencil-line' : 'ri-add-line'} style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  {editing ? 'Edit Leave Type' : 'Add Leave Type'}
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  {editing ? `Update "${editing.name}" in the catalog` : 'Add a new leave type to the catalog'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="rec-form-body">
          {/* Section 1 — Identity */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span
                className="rec-form-section-icon"
                style={{
                  background: 'linear-gradient(135deg,#5b3fd1 0%,#7c5cfc 50%,#a78bfa 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(124,92,252,0.35), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-bookmark-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 1 · Identity</p>
                <p className="rec-form-section-sub">Name and short code that identify this leave type across the app.</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={7}>
                <label className="rec-form-label">Leave Type Name<span className="req">*</span></label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. Bereavement Leave"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </Col>
              <Col md={5}>
                <label className="rec-form-label">Code<span className="req">*</span></label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. BL"
                  maxLength={4}
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  style={{ textTransform: 'uppercase' }}
                />
              </Col>
              <Col md={12}>
                <label className="rec-form-label">Type Category</label>
                <select className="rec-input" value={type} onChange={e => setType(e.target.value)}>
                  {TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Col>
            </Row>
          </div>

          {/* Section 2 — Compensation */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span
                className="rec-form-section-icon"
                style={{
                  background: 'linear-gradient(135deg,#0a716a 0%,#10b981 50%,#34d399 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-money-dollar-circle-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 2 · Compensation</p>
                <p className="rec-form-section-sub">Decides whether days off this type are paid or count as loss-of-pay.</p>
              </div>
            </div>
            <Row className="g-2">
              <Col md={6}>
                <label className={`lp-radio-card ${isPaid === 'Paid' ? 'is-active' : ''}`} style={{ marginBottom: 0 }}>
                  <input
                    type="radio"
                    name="lt-paid"
                    checked={isPaid === 'Paid'}
                    onChange={() => setIsPaid('Paid')}
                    disabled={type === 'Unpaid'}
                  />
                  <div className="flex-grow-1">
                    <div className="fw-semibold" style={{ fontSize: 13 }}>Paid</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      Counts toward salary; deducted from the configured quota.
                    </div>
                  </div>
                </label>
              </Col>
              <Col md={6}>
                <label className={`lp-radio-card ${isPaid === 'Unpaid' || type === 'Unpaid' ? 'is-active' : ''}`} style={{ marginBottom: 0 }}>
                  <input
                    type="radio"
                    name="lt-paid"
                    checked={isPaid === 'Unpaid' || type === 'Unpaid'}
                    onChange={() => setIsPaid('Unpaid')}
                  />
                  <div className="flex-grow-1">
                    <div className="fw-semibold" style={{ fontSize: 13 }}>Unpaid</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      Loss of pay — no salary credited for these days.
                    </div>
                  </div>
                </label>
              </Col>
            </Row>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint">
            Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required
          </span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={handleClose}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={!canSave}
            >
              <i className={editing ? 'ri-save-line' : 'ri-add-line'} />
              {editing ? 'Update Leave Type' : 'Save Leave Type'}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AssignLeaveTypesModal — categorised picker. Opens from the Configuration
// tab's "Add leave type" button. Each category carries its own accent so the
// chosen rows read at a glance (Regular = purple, Incident = teal, Unpaid =
// red, Comp Off = green). The progress strip at the top reflects how many
// of the available types HR has picked.
// ─────────────────────────────────────────────────────────────────────────────
type AssignableType = {
  id: string;
  name: string;
  description: string;
  category: 'regular' | 'incident' | 'unpaid' | 'compoff';
  color: string;
};

const ASSIGNABLE_TYPES: AssignableType[] = [
  // Regular
  { id: 'casual',     name: 'Casual Leave',           description: 'For short-notice personal needs (1–3 days).',                 category: 'regular',  color: '#7c5cfc' },
  { id: 'paid_half',  name: 'Paid Leave (Half Day)',  description: 'Half-day paid leave for short personal errands.',             category: 'regular',  color: '#7c5cfc' },
  { id: 'sick',       name: 'Sick Leave',             description: 'Medical leave with optional doctor proof.',                   category: 'regular',  color: '#7c5cfc' },
  // Incident
  { id: 'special',    name: 'Special Leave',          description: 'Manager-approved discretionary leave.',                       category: 'incident', color: '#0ea5e9' },
  { id: 'paternity',  name: 'Paternity Leave',        description: 'Statutory paternity benefit per company policy.',             category: 'incident', color: '#0ea5e9' },
  { id: 'maternity',  name: 'Maternity Leave',        description: 'Statutory maternity benefit per company policy.',             category: 'incident', color: '#0ea5e9' },
  { id: 'floater',    name: 'Floater Leave',          description: 'Optional holiday(s) employees can choose from a list.',       category: 'incident', color: '#0ea5e9' },
  { id: 'bereavement',name: 'Bereavement Leave',      description: 'Leave for the loss of an immediate family member.',           category: 'incident', color: '#0ea5e9' },
  // Unpaid
  { id: 'unpaid',     name: 'Unpaid Leave',           description: 'Loss-of-pay leave once paid balance is exhausted.',           category: 'unpaid',   color: '#dc2626' },
  // Comp Off
  { id: 'compoff',    name: 'Comp Offs',              description: 'Earned by working on holidays or weekends.',                  category: 'compoff',  color: '#16a34a' },
];

const CATEGORY_META: Record<AssignableType['category'], { label: string; color: string }> = {
  regular:  { label: 'REGULAR',  color: '#7c5cfc' },
  incident: { label: 'INCIDENT', color: '#0ea5e9' },
  unpaid:   { label: 'UNPAID',   color: '#dc2626' },
  compoff:  { label: 'COMPOFF',  color: '#16a34a' },
};

function AssignLeaveTypesModal({
  isOpen, planName, existingTypeIds, onClose, onSave,
}: {
  isOpen: boolean;
  planName: string;
  existingTypeIds: Set<string>;
  onClose: () => void;
  onSave: (types: LeaveTypeRow[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleSelectedCount = selected.size;

  const toggle = (id: string) => {
    if (existingTypeIds.has(id)) return; // already on the plan
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    if (selected.size === 0) return;
    const rows: LeaveTypeRow[] = ASSIGNABLE_TYPES
      .filter(t => selected.has(t.id))
      .map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        quotaLabel: 'Not Setup',
        endOfYearLabel: 'Not Setup',
        configured: false,
      }));
    onSave(rows);
    setSelected(new Set());
  };

  const handleClose = () => { setSelected(new Set()); onClose(); };

  const grouped = (cat: AssignableType['category']) =>
    ASSIGNABLE_TYPES.filter(t => t.category === cat);

  // Progress: out of the *assignable* (not-yet-on-plan) types, how many
  // selected. Caps at 100% so the bar reads correctly when the plan already
  // owns most types.
  const assignablePool = ASSIGNABLE_TYPES.filter(t => !existingTypeIds.has(t.id)).length || ASSIGNABLE_TYPES.length;
  const progressPct = Math.min(100, Math.round((visibleSelectedCount / assignablePool) * 100));

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      size="md"
      backdrop="static"
      modalClassName="rec-form-modal"
      contentClassName="rec-form-content border-0"
    >
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className="ri-checkbox-multiple-line" style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  Assign Leave Types
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  to {planName || 'this plan'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="alt-progress-strip">
          <div className="alt-progress-info">
            <span
              className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 28, height: 28, fontSize: 12, background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' }}
            >
              {visibleSelectedCount}
            </span>
            <span className="fw-semibold" style={{ fontSize: 13 }}>
              {visibleSelectedCount} leave type{visibleSelectedCount === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="alt-progress-track">
            <div className="alt-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="rec-form-body" style={{ paddingTop: 14 }}>
          <div className="text-muted mb-2" style={{ fontSize: 12.5 }}>
            Select the leave types from below to add to the leave plan
          </div>

          {(['regular', 'incident', 'unpaid', 'compoff'] as const).map(cat => {
            const meta = CATEGORY_META[cat];
            const items = grouped(cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="alt-category">
                <div className="alt-category-head">
                  <span className="alt-category-dot" style={{ background: meta.color }} />
                  <span className="alt-category-label" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                </div>
                <div className="alt-list">
                  {items.map(t => {
                    const isExisting = existingTypeIds.has(t.id);
                    const isSelected = selected.has(t.id) || isExisting;
                    return (
                      <label
                        key={t.id}
                        className={`alt-row ${isSelected ? 'is-selected' : ''} ${isExisting ? 'is-locked' : ''}`}
                        style={isSelected ? {
                          // Tint matches the category accent so the selected
                          // state reads coherent across groups.
                          background: meta.color === '#dc2626' ? '#fee2e2'
                            : meta.color === '#16a34a' ? '#d1fae5'
                            : meta.color === '#0ea5e9' ? '#dbeafe'
                            : '#ece6ff',
                          borderColor: meta.color,
                        } : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isExisting}
                          onChange={() => toggle(t.id)}
                          style={{ accentColor: meta.color }}
                        />
                        <span className="alt-row-name">{t.name}</span>
                        {isExisting && <span className="alt-existing-pill">Already added</span>}
                        <i
                          className="ri-information-line alt-info-icon"
                          title={t.description}
                          aria-label={t.description}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rec-form-footer">
          <span className="hint">
            {visibleSelectedCount === 0 ? 'Pick at least one leave type to enable Save' : `${visibleSelectedCount} selected · ready to save`}
          </span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={handleClose}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={visibleSelectedCount === 0}
            >
              <i className="ri-save-3-line" />Save ({visibleSelectedCount})
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveTypeSetupModal — wide popup that opens from the Setup button on each
// row. Six side-tab sections, each with its own card-based form. State is
// owned by the parent (plan-scoped) so closing the popup never loses work.
// ─────────────────────────────────────────────────────────────────────────────
type SetupSection = 'accrual' | 'leaveApp' | 'approval' | 'yearEnd' | 'probation' | 'noticePeriod';

const SETUP_SECTIONS: { key: SetupSection; label: string; icon: string; tone: string }[] = [
  { key: 'accrual',      label: 'Accrual',           icon: 'ri-time-line',           tone: '#7c5cfc' },
  { key: 'leaveApp',     label: 'Leave Application', icon: 'ri-file-list-3-line',    tone: '#0ea5e9' },
  { key: 'approval',     label: 'Approval',          icon: 'ri-checkbox-circle-line',tone: '#16a34a' },
  { key: 'yearEnd',      label: 'Year End Processing', icon: 'ri-calendar-check-line', tone: '#f59e0b' },
  { key: 'probation',    label: 'Probation',         icon: 'ri-user-3-line',         tone: '#7c5cfc' },
  { key: 'noticePeriod', label: 'Notice Period',     icon: 'ri-cup-line',            tone: '#dc2626' },
];

function LeaveTypeSetupModal({
  isOpen, leaveType, config, onClose, onChange,
}: {
  isOpen: boolean;
  leaveType: LeaveTypeRow | null;
  config: LeaveTypeConfig;
  onClose: () => void;
  onChange: (next: LeaveTypeConfig) => void;
}) {
  const [active, setActive] = useState<SetupSection>('accrual');
  const sectionIndex = SETUP_SECTIONS.findIndex(s => s.key === active);
  const sectionMeta = SETUP_SECTIONS[sectionIndex] ?? SETUP_SECTIONS[0];

  // Helpers — produce a slice updater that doesn't trample the rest of the
  // config when an inner field changes.
  const updateAccrual      = (patch: Partial<AccrualConfig>)      => onChange({ ...config, accrual:      { ...config.accrual,      ...patch } });
  const updateLeaveApp     = (patch: Partial<LeaveAppConfig>)     => onChange({ ...config, leaveApp:     { ...config.leaveApp,     ...patch } });
  const updateApproval     = (patch: Partial<ApprovalConfig>)     => onChange({ ...config, approval:     { ...config.approval,     ...patch } });
  const updateYearEnd      = (patch: Partial<YearEndConfig>)      => onChange({ ...config, yearEnd:      { ...config.yearEnd,      ...patch } });
  const updateProbation    = (patch: Partial<ProbationConfig>)    => onChange({ ...config, probation:    { ...config.probation,    ...patch } });
  const updateNoticePeriod = (patch: Partial<NoticePeriodConfig>) => onChange({ ...config, noticePeriod: { ...config.noticePeriod, ...patch } });

  if (!leaveType) return null;

  const goNext = () => {
    if (sectionIndex < SETUP_SECTIONS.length - 1) {
      setActive(SETUP_SECTIONS[sectionIndex + 1].key);
    } else {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      backdrop="static"
      size="xl"
      contentClassName="lts-content"
      modalClassName="lts-modal"
    >
      <ModalBody className="p-0">
        <div className="lts-shell">
          {/* Header */}
          <div className="lts-header">
            <button type="button" className="lts-back-btn" onClick={onClose}>
              <i className="ri-arrow-left-s-line" />Back to Plan
            </button>
            <div className="lts-divider" />
            <div className="d-flex align-items-center gap-2 min-w-0">
              <span className="lts-type-icon" style={{ background: `${leaveType.color}20` }}>
                <i className="ri-file-list-3-line" style={{ color: leaveType.color }} />
              </span>
              <div className="min-w-0">
                <div className="fw-bold" style={{ fontSize: 14 }}>{leaveType.name}</div>
                <div className="text-muted" style={{ fontSize: 11 }}>Leave Type Configuration</div>
              </div>
            </div>
            <div className="ms-auto d-flex align-items-center gap-2">
              <span className="text-muted" style={{ fontSize: 11.5 }}>All changes are auto-saved</span>
              <button type="button" className="lts-icon-btn" onClick={onClose} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="lts-body">
            <aside className="lts-sidebar">
              <div className="lts-section-label">CONFIGURATION</div>
              {SETUP_SECTIONS.map(s => (
                <button
                  key={s.key}
                  type="button"
                  className={`lts-side-item ${active === s.key ? 'is-active' : ''}`}
                  style={active === s.key ? { color: s.tone } : undefined}
                  onClick={() => setActive(s.key)}
                >
                  <span
                    className="lts-side-icon"
                    style={{
                      background: active === s.key ? `${s.tone}20` : '#f3f4f6',
                      color: active === s.key ? s.tone : '#6b7280',
                    }}
                  >
                    <i className={s.icon} />
                  </span>
                  {s.label}
                </button>
              ))}
            </aside>

            <main className="lts-main">
              {active === 'accrual'      && <AccrualSectionView      cfg={config.accrual}      update={updateAccrual} />}
              {active === 'leaveApp'     && <LeaveAppSectionView     cfg={config.leaveApp}     update={updateLeaveApp} />}
              {active === 'approval'     && <ApprovalSectionView     cfg={config.approval}     update={updateApproval} />}
              {active === 'yearEnd'      && <YearEndSectionView      cfg={config.yearEnd}      update={updateYearEnd} />}
              {active === 'probation'    && <ProbationSectionView    cfg={config.probation}    update={updateProbation} />}
              {active === 'noticePeriod' && <NoticePeriodSectionView cfg={config.noticePeriod} update={updateNoticePeriod} />}
            </main>
          </div>

          {/* Footer */}
          <div className="lts-footer">
            <span className="text-muted" style={{ fontSize: 12 }}>
              Section <strong className="text-body">{sectionIndex + 1}</strong> of {SETUP_SECTIONS.length}
              <span className="mx-2">·</span>
              {sectionMeta.label}
            </span>
            <div className="d-flex gap-2">
              <button type="button" className="rec-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="rec-btn-primary" onClick={goNext}>
                {sectionIndex === SETUP_SECTIONS.length - 1 ? 'Save & Close' : 'Save & Next'}
              </button>
            </div>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable building blocks — small primitives that keep each section's JSX
// readable without dragging in a full form library.
// ─────────────────────────────────────────────────────────────────────────────
function SectionCard({
  icon, iconBg, title, children,
}: {
  icon: string; iconBg: string; title: string; children: React.ReactNode;
}) {
  return (
    <div className="lts-card">
      <div className="lts-card-head">
        <span className="lts-card-icon" style={{ background: iconBg }}>
          <i className={icon} />
        </span>
        <h6 className="fw-bold mb-0" style={{ fontSize: 13.5 }}>{title}</h6>
      </div>
      <div className="lts-card-body">{children}</div>
    </div>
  );
}

function CheckRow({
  checked, onChange, label, sub, children,
}: {
  checked: boolean; onChange: (v: boolean) => void;
  label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="lts-check-row">
      <label className="d-flex align-items-start gap-2 mb-0" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          className="form-check-input mt-1"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ accentColor: '#7c5cfc' }}
        />
        <div className="flex-grow-1 min-w-0">
          <div className="fw-semibold" style={{ fontSize: 13 }}>{label}</div>
          {sub && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
        </div>
      </label>
      {checked && children && <div className="lts-check-nested">{children}</div>}
    </div>
  );
}

function RadioRow({
  selected, onSelect, label, sub,
}: {
  selected: boolean; onSelect: () => void;
  label: React.ReactNode; sub?: React.ReactNode;
}) {
  return (
    <label className="d-flex align-items-start gap-2 mb-2" style={{ cursor: 'pointer' }}>
      <input
        type="radio"
        className="form-check-input mt-1"
        checked={selected}
        onChange={onSelect}
        style={{ accentColor: '#7c5cfc' }}
      />
      <div className="flex-grow-1">
        <div className="fw-semibold" style={{ fontSize: 13 }}>{label}</div>
        {sub && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
      </div>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Accrual
// ─────────────────────────────────────────────────────────────────────────────
function AccrualSectionView({ cfg, update }: { cfg: AccrualConfig; update: (p: Partial<AccrualConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Accrual</h5>

      <div className="lts-info-banner mb-3">
        <i className="ri-information-line" />
        Wondering how employees can request leave? <a href="#guide">Here's a quick guide you can share!</a>
      </div>

      <SectionCard icon="ri-information-line" iconBg="#ece6ff" title="Yearly Quota">
        <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
          <span className="text-muted" style={{ fontSize: 12.5 }}>This leave is calculated in</span>
          <div className="lts-toggle-group">
            <button
              type="button"
              className={`lts-toggle ${cfg.unit === 'days' ? 'is-on' : ''}`}
              onClick={() => update({ unit: 'days' })}
            >Days</button>
            <button
              type="button"
              className={`lts-toggle ${cfg.unit === 'hours' ? 'is-on' : ''}`}
              onClick={() => update({ unit: 'hours' })}
            >Hours</button>
          </div>
        </div>
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <span className="text-muted" style={{ fontSize: 12.5, minWidth: 80 }}>Yearly quota</span>
          <label className="d-flex align-items-center gap-2 mb-0" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              className="form-check-input"
              checked={!cfg.unlimited}
              onChange={() => update({ unlimited: false })}
              style={{ accentColor: '#7c5cfc' }}
            />
            <input
              type="number"
              className="lts-input"
              style={{ width: 70 }}
              value={cfg.yearlyQuota}
              onChange={e => update({ yearlyQuota: Number(e.target.value) || 0, unlimited: false })}
              disabled={cfg.unlimited}
            />
            <span className="text-muted" style={{ fontSize: 12.5 }}>{cfg.unit}</span>
          </label>
          <label className="d-flex align-items-center gap-2 mb-0" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              className="form-check-input"
              checked={cfg.unlimited}
              onChange={() => update({ unlimited: true })}
              style={{ accentColor: '#7c5cfc' }}
            />
            <span style={{ fontSize: 13 }}>Unlimited</span>
          </label>
        </div>
      </SectionCard>

      <SectionCard icon="ri-pulse-line" iconBg="#dbeafe" title="Allocation & Accrual Rate">
        <RadioRow
          selected={cfg.mode === 'periodic'}
          onSelect={() => update({ mode: 'periodic' })}
          label="Leave accrued periodically"
        />
        {cfg.mode === 'periodic' && (
          <div className="lts-nested-block">
            <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
              <span className="text-muted" style={{ fontSize: 12.5 }}>Accrue leave</span>
              <select
                className="lts-input"
                style={{ width: 160 }}
                value={cfg.frequency}
                onChange={e => update({ frequency: e.target.value as AccrualConfig['frequency'] })}
              >
                <option value="monthly">Once every month</option>
                <option value="quarterly">Once every quarter</option>
                <option value="half_yearly">Twice a year</option>
                <option value="yearly">Once a year</option>
              </select>
              <span className="text-muted" style={{ fontSize: 12.5 }}>on</span>
              <select
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.dayOfMonth}
                onChange={e => update({ dayOfMonth: Number(e.target.value) })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-muted" style={{ fontSize: 12.5 }}>{cfg.dayOfMonth === 1 ? 'st' : cfg.dayOfMonth === 2 ? 'nd' : cfg.dayOfMonth === 3 ? 'rd' : 'th'} day of the month</span>
            </div>
            <div className="lts-info-row">
              Employee will accrue {(cfg.yearlyQuota / 12).toFixed(0)} day(s) of leave once every month
            </div>
            <CheckRow
              checked={cfg.variesEachMonth}
              onChange={v => update({ variesEachMonth: v })}
              label="Leave accrual varies each month"
            />
          </div>
        )}
        <RadioRow
          selected={cfg.mode === 'attendance'}
          onSelect={() => update({ mode: 'attendance' })}
          label="Leave accrues based on attendance"
        />
        <RadioRow
          selected={cfg.mode === 'immediate'}
          onSelect={() => update({ mode: 'immediate' })}
          label="Leave quota available immediately"
        />
      </SectionCard>

      <SectionCard icon="ri-prohibited-line" iconBg="#fde8c4" title="Accrual Restrictions">
        <CheckRow
          checked={cfg.leaveExpires.enabled}
          onChange={v => update({ leaveExpires: { ...cfg.leaveExpires, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Leave expires
              <select
                className="lts-input"
                style={{ width: 100 }}
                value={cfg.leaveExpires.unit}
                onChange={e => update({ leaveExpires: { ...cfg.leaveExpires, unit: e.target.value as 'day' | 'month' | 'year' } })}
                disabled={!cfg.leaveExpires.enabled}
              >
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </span>
          }
        >
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span style={{ fontSize: 12.5 }}>Leave expires after</span>
            <input
              type="number"
              className="lts-input"
              style={{ width: 80 }}
              value={cfg.leaveExpires.days}
              onChange={e => update({ leaveExpires: { ...cfg.leaveExpires, days: Number(e.target.value) || 0 } })}
            />
            <span className="text-muted" style={{ fontSize: 12.5 }}>days from the date of credit</span>
          </div>
        </CheckRow>

        <CheckRow
          checked={cfg.restrictByAttendance}
          onChange={v => update({ restrictByAttendance: v })}
          label="Restrict accrual based on attendance"
        />

        <CheckRow
          checked={cfg.noAccrualIfOnLeaveFor.enabled}
          onChange={v => update({ noAccrualIfOnLeaveFor: { ...cfg.noAccrualIfOnLeaveFor, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              No leave is accrued if an employee is on leave for more than
              <input
                type="number"
                className="lts-input"
                style={{ width: 80 }}
                placeholder="Ex: 30"
                value={cfg.noAccrualIfOnLeaveFor.days || ''}
                onChange={e => update({ noAccrualIfOnLeaveFor: { ...cfg.noAccrualIfOnLeaveFor, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.noAccrualIfOnLeaveFor.enabled}
              />
              days in previous accrual period
            </span>
          }
        />

        <CheckRow
          checked={cfg.noAccrualIfBalanceExceeds.enabled}
          onChange={v => update({ noAccrualIfBalanceExceeds: { ...cfg.noAccrualIfBalanceExceeds, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              No leave is accrued when the total leave balance exceeds
              <input
                type="number"
                className="lts-input"
                style={{ width: 80 }}
                placeholder="Ex: 20"
                value={cfg.noAccrualIfBalanceExceeds.days || ''}
                onChange={e => update({ noAccrualIfBalanceExceeds: { ...cfg.noAccrualIfBalanceExceeds, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.noAccrualIfBalanceExceeds.enabled}
              />
              days
            </span>
          }
        />

        <CheckRow
          checked={cfg.noAccrualIfJoiningAfter.enabled}
          onChange={v => update({ noAccrualIfJoiningAfter: { ...cfg.noAccrualIfJoiningAfter, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              No leave is awarded to employees if the joining date is after
              <select
                className="lts-input"
                style={{ width: 90 }}
                value={cfg.noAccrualIfJoiningAfter.day}
                onChange={e => update({ noAccrualIfJoiningAfter: { ...cfg.noAccrualIfJoiningAfter, day: Number(e.target.value) } })}
                disabled={!cfg.noAccrualIfJoiningAfter.enabled}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span>th day of the month.</span>
            </span>
          }
        />
      </SectionCard>

      <SectionCard icon="ri-add-circle-line" iconBg="#d3f0ee" title="Extra Leave">
        <CheckRow
          checked={cfg.managersCanGrantExtra}
          onChange={v => update({ managersCanGrantExtra: v })}
          label="Allow Reporting Managers to grant more leave than accrued balance"
          sub="Global admins, HR managers, etc., retain the authority to do so regardless."
        />
        <CheckRow
          checked={cfg.employeeOverdraft.enabled}
          onChange={v => update({ employeeOverdraft: { ...cfg.employeeOverdraft, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Employee can take
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.employeeOverdraft.days}
                onChange={e => update({ employeeOverdraft: { ...cfg.employeeOverdraft, days: Number(e.target.value) || 0 } })}
                onClick={e => e.preventDefault()}
                disabled={!cfg.employeeOverdraft.enabled}
              />
              leave more than their balance
            </span>
          }
        />
        <CheckRow
          checked={cfg.accrueByTenure}
          onChange={v => update({ accrueByTenure: v })}
          label="Accrue leave based on employee tenure"
          sub="Calculated from employee's joining date"
        />
      </SectionCard>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Leave Application
// ─────────────────────────────────────────────────────────────────────────────
function LeaveAppSectionView({ cfg, update }: { cfg: LeaveAppConfig; update: (p: Partial<LeaveAppConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Leave Application</h5>

      <SectionCard icon="ri-file-list-3-line" iconBg="#dbeafe" title="Leave Application Rules">
        <CheckRow checked={cfg.allowHalfDay}      onChange={v => update({ allowHalfDay: v })}      label="Allow half day leave" />
        <CheckRow checked={cfg.priorNoticeNeeded} onChange={v => update({ priorNoticeNeeded: v })} label="Prior notice needed" />
        <CheckRow
          checked={cfg.limitBackdated}
          onChange={v => update({ limitBackdated: v })}
          label="Limit backdated leave applications"
        >
          <CheckRow
            checked={cfg.backdatedWithin.enabled}
            onChange={v => update({ backdatedWithin: { ...cfg.backdatedWithin, enabled: v } })}
            label={
              <span className="d-inline-flex align-items-center gap-2 flex-wrap">
                Within
                <input
                  type="number"
                  className="lts-input"
                  style={{ width: 70 }}
                  value={cfg.backdatedWithin.days}
                  onChange={e => update({ backdatedWithin: { ...cfg.backdatedWithin, days: Number(e.target.value) || 0 } })}
                  disabled={!cfg.backdatedWithin.enabled}
                />
                days of leave
              </span>
            }
          />
          <CheckRow
            checked={cfg.backdatedBefore.enabled}
            onChange={v => update({ backdatedBefore: { ...cfg.backdatedBefore, enabled: v } })}
            label={
              <span className="d-inline-flex align-items-center gap-2 flex-wrap">
                Before
                <input
                  type="number"
                  className="lts-input"
                  style={{ width: 70 }}
                  value={cfg.backdatedBefore.day}
                  onChange={e => update({ backdatedBefore: { ...cfg.backdatedBefore, day: Number(e.target.value) || 1 } })}
                  disabled={!cfg.backdatedBefore.enabled}
                />
                th day of the month for past-dated leave
              </span>
            }
          />
        </CheckRow>
        <CheckRow
          checked={cfg.commentMandatory}
          onChange={v => update({ commentMandatory: v })}
          label="Comment is mandatory when requesting"
        />
      </SectionCard>

      <SectionCard icon="ri-prohibited-line" iconBg="#fee2e2" title="Leave Application Restrictions">
        <CheckRow checked={cfg.preventSelfApply}      onChange={v => update({ preventSelfApply: v })}      label="Prevent employees from viewing and applying for this leave on their own" />
        <CheckRow
          checked={cfg.attachmentsAfter.enabled}
          onChange={v => update({ attachmentsAfter: { ...cfg.attachmentsAfter, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Attachments are mandatory if the leave request exceeds
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.attachmentsAfter.days}
                onChange={e => update({ attachmentsAfter: { ...cfg.attachmentsAfter, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.attachmentsAfter.enabled}
              />
              days
            </span>
          }
        />
        <CheckRow
          checked={cfg.earliestApply.enabled}
          onChange={v => update({ earliestApply: { ...cfg.earliestApply, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Leave applications are not allowed earlier than
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.earliestApply.days}
                onChange={e => update({ earliestApply: { ...cfg.earliestApply, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.earliestApply.enabled}
              />
              days before the leave start date
            </span>
          }
        />
        <CheckRow
          checked={cfg.cannotUseSameYear}
          onChange={v => update({ cannotUseSameYear: v })}
          label="Leave cannot be used by employees in the same year they are accrued"
        />
        <CheckRow
          checked={cfg.preventFutureExpected}
          onChange={v => update({ preventFutureExpected: v })}
          label="Employees cannot request leave with future dates based on expected accrual"
        />
      </SectionCard>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Approval
// ─────────────────────────────────────────────────────────────────────────────
function ApprovalSectionView({ cfg, update }: { cfg: ApprovalConfig; update: (p: Partial<ApprovalConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Approval</h5>

      <SectionCard icon="ri-checkbox-circle-line" iconBg="#d3f0ee" title="Leave Approval Chain">
        <CheckRow
          checked={cfg.required}
          onChange={v => update({ required: v })}
          label="Leave request requires an approval"
        >
          <div className="lts-approval-chain">
            <div className="lts-section-label" style={{ marginBottom: 10 }}>APPROVAL CHAIN</div>
            <div className="lts-approval-card">
              <div className="d-flex align-items-center gap-3 mb-2">
                <span className="lts-level-pill">LEVEL 1</span>
                <span className="lts-level-pill" style={{ background: '#ece6ff', color: '#5a3fd1' }}>APPROVAL</span>
              </div>
              <div className="text-muted mb-2" style={{ fontSize: 12 }}>Assignees</div>
              <div className="lts-assignee-row">
                <span
                  className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                  style={{ width: 32, height: 32, fontSize: 11, background: '#0ab39c' }}
                >RM</span>
                <span className="fw-semibold" style={{ fontSize: 13 }}>Reporting Manager</span>
              </div>
            </div>
          </div>
        </CheckRow>
        <CheckRow
          checked={cfg.autoApproveIfMissing}
          onChange={v => update({ autoApproveIfMissing: v })}
          label="Auto-approve if approver is missing"
        />
        <CheckRow
          checked={cfg.doNotEmailEveryRequest}
          onChange={v => update({ doNotEmailEveryRequest: v })}
          label="Do not email approvers for every request"
          sub="They will view these requests as part of the daily email digest."
        />
      </SectionCard>

      <div className="lts-info-banner lts-info-banner-success">
        <i className="ri-information-line" />
        Changed your leave plan after YEP and then rolled it back? <a href="#yep-rollback">Know the repercussions here.</a>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Year End Processing
// ─────────────────────────────────────────────────────────────────────────────
function YearEndSectionView({ cfg, update }: { cfg: YearEndConfig; update: (p: Partial<YearEndConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Year End Processing</h5>

      <SectionCard icon="ri-money-dollar-circle-line" iconBg="#fde8c4" title="Encashment">
        <CheckRow
          checked={cfg.encashmentAllowed}
          onChange={v => update({ encashmentAllowed: v })}
          label="Leave encashment is allowed"
        />
      </SectionCard>

      <SectionCard icon="ri-arrow-go-back-line" iconBg="#fde8c4" title="Carry Forward">
        <div className="text-muted mb-2" style={{ fontSize: 12.5 }}>
          What happens to the remaining leave balances (if any) at the end of the year?
        </div>
        <select
          className="lts-input"
          style={{ width: '100%', maxWidth: 360 }}
          value={cfg.carryForward}
          onChange={e => update({ carryForward: e.target.value as YearEndConfig['carryForward'] })}
        >
          <option value="reset">Reset to zero</option>
          <option value="carry_capped">Carry forward (capped)</option>
          <option value="carry_all">Carry forward all</option>
        </select>

        <div className="mt-3">
          <CheckRow
            checked={cfg.carriedExpiresIn.enabled}
            onChange={v => update({ carriedExpiresIn: { ...cfg.carriedExpiresIn, enabled: v } })}
            label={
              <span className="d-inline-flex align-items-center gap-2 flex-wrap">
                Carried forward leave expire in
                <input
                  type="number"
                  className="lts-input"
                  style={{ width: 80 }}
                  placeholder="ex: 90"
                  value={cfg.carriedExpiresIn.days}
                  onChange={e => update({ carriedExpiresIn: { ...cfg.carriedExpiresIn, days: Number(e.target.value) || 0 } })}
                  disabled={!cfg.carriedExpiresIn.enabled}
                />
                days
              </span>
            }
          />
          <CheckRow
            checked={cfg.expiryUnchanged}
            onChange={v => update({ expiryUnchanged: v })}
            label="Expiry date of any leave remains unchanged whether through previous carry forward or the expiry settings."
          />
          <CheckRow
            checked={cfg.applyForNextYear}
            onChange={v => update({ applyForNextYear: v })}
            label="Employees can apply leave for next calendar year"
          />
        </div>
      </SectionCard>

      <div className="lts-info-banner lts-info-banner-success">
        <i className="ri-information-line" />
        Changed your leave plan after YEP and then rolled it back? <a href="#yep-rollback">Know the repercussions here.</a>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Probation
// ─────────────────────────────────────────────────────────────────────────────
function ProbationSectionView({ cfg, update }: { cfg: ProbationConfig; update: (p: Partial<ProbationConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Probation</h5>

      <SectionCard icon="ri-user-3-line" iconBg="#ece6ff" title="Accrual for Probation">
        <CheckRow
          checked={cfg.prorateFirstMonth.enabled}
          onChange={v => update({ prorateFirstMonth: { ...cfg.prorateFirstMonth, enabled: v } })}
          label="Prorate leave in the 1st month of joining based on"
        >
          <RadioRow
            selected={cfg.prorateFirstMonth.basis === 'date'}
            onSelect={() => update({ prorateFirstMonth: { ...cfg.prorateFirstMonth, basis: 'date' } })}
            label="Date of Joining"
          />
          <RadioRow
            selected={cfg.prorateFirstMonth.basis === 'range'}
            onSelect={() => update({ prorateFirstMonth: { ...cfg.prorateFirstMonth, basis: 'range' } })}
            label="Range of date of joining"
          />
        </CheckRow>
        <CheckRow
          checked={cfg.accrueDuringProbation}
          onChange={v => update({ accrueDuringProbation: v })}
          label="During probation accrue leave"
        />
        <div className="lts-nested-block">
          <div className="text-muted mb-2" style={{ fontSize: 12.5 }}>After probation ends, start accrual:</div>
          <RadioRow
            selected={cfg.afterProbationStart === 'after_wait'}
            onSelect={() => update({ afterProbationStart: 'after_wait' })}
            label={
              <span className="d-inline-flex align-items-center gap-2 flex-wrap">
                After a waiting period of
                <input
                  type="number"
                  className="lts-input"
                  style={{ width: 80 }}
                  placeholder="Ex: 10"
                  value={cfg.waitingDays}
                  onChange={e => update({ waitingDays: Number(e.target.value) || 0 })}
                  disabled={cfg.afterProbationStart !== 'after_wait'}
                />
                days
              </span>
            }
          />
          <RadioRow
            selected={cfg.afterProbationStart === 'immediate'}
            onSelect={() => update({ afterProbationStart: 'immediate' })}
            label="Immediately"
          />

          <div className="text-muted mt-3 mb-2" style={{ fontSize: 12.5 }}>Prorate leave after probation end based on:</div>
          <RadioRow
            selected={cfg.prorateAfterProbationBasis === 'date'}
            onSelect={() => update({ prorateAfterProbationBasis: 'date' })}
            label="Probation end date"
          />
          <RadioRow
            selected={cfg.prorateAfterProbationBasis === 'range'}
            onSelect={() => update({ prorateAfterProbationBasis: 'range' })}
            label="Range of probation end date"
          />
        </div>
      </SectionCard>

      <SectionCard icon="ri-file-list-3-line" iconBg="#dbeafe" title="Leave Application During Probation">
        <CheckRow
          checked={cfg.newJoinersAfter.enabled}
          onChange={v => update({ newJoinersAfter: { ...cfg.newJoinersAfter, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              New joiners can request leave after
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.newJoinersAfter.days}
                onChange={e => update({ newJoinersAfter: { ...cfg.newJoinersAfter, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.newJoinersAfter.enabled}
              />
              days of their
              <select
                className="lts-input"
                style={{ width: 150 }}
                value={cfg.newJoinersAfter.basis}
                onChange={e => update({ newJoinersAfter: { ...cfg.newJoinersAfter, basis: e.target.value } })}
                disabled={!cfg.newJoinersAfter.enabled}
              >
                <option value="joining_date">Joining Date</option>
                <option value="probation_end">Probation End</option>
                <option value="confirmation_date">Confirmation Date</option>
              </select>
            </span>
          }
        />
        <CheckRow
          checked={cfg.maxDuringProbation.enabled}
          onChange={v => update({ maxDuringProbation: { ...cfg.maxDuringProbation, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Maximum
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.maxDuringProbation.days}
                onChange={e => update({ maxDuringProbation: { ...cfg.maxDuringProbation, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.maxDuringProbation.enabled}
              />
              days of leave is allowed during probation
            </span>
          }
        />
      </SectionCard>

      <SectionCard icon="ri-calendar-check-line" iconBg="#fde8c4" title="Year End Processing for Probation">
        <div className="text-muted" style={{ fontSize: 12.5 }}>
          Inherits the parent leave-type's Year End Processing rules. Override only if probation employees should follow a different carry-forward / encashment policy.
        </div>
      </SectionCard>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Notice Period
// ─────────────────────────────────────────────────────────────────────────────
function NoticePeriodSectionView({ cfg, update }: { cfg: NoticePeriodConfig; update: (p: Partial<NoticePeriodConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Notice Period</h5>

      <SectionCard icon="ri-cup-line" iconBg="#fee2e2" title="Accrual for Notice Period">
        <CheckRow
          checked={cfg.prorateOnExit}
          onChange={v => update({ prorateOnExit: v })}
          label="For employees leaving, leave is prorated based on their exit date"
        />
      </SectionCard>

      <SectionCard icon="ri-file-list-3-line" iconBg="#dbeafe" title="Leave Application During Notice Period">
        <CheckRow
          checked={cfg.noticeExtension.enabled}
          onChange={v => update({ noticeExtension: { ...cfg.noticeExtension, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Leave taken in notice period will extend it by
              <input
                type="number"
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.noticeExtension.times}
                onChange={e => update({ noticeExtension: { ...cfg.noticeExtension, times: Number(e.target.value) || 0 } })}
                disabled={!cfg.noticeExtension.enabled}
              />
              time(s) for each leave availed
            </span>
          }
        />
      </SectionCard>

      <SectionCard icon="ri-calendar-check-line" iconBg="#fde8c4" title="Year End Processing for Notice Period">
        <div className="text-muted" style={{ fontSize: 12.5 }}>
          Inherits the parent leave-type's Year End Processing rules during notice. Override only if exiting employees should follow a different carry-forward / encashment policy.
        </div>
      </SectionCard>
    </>
  );
}

