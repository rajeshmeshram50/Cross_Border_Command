import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { MasterFormStyles } from '../master/masterFormKit';
import '../../../css/recruitment.css';
import '../../../css/leave.css';
import '../employee-onboarding/HrEmployeeOnboarding.css';
import { leavePlansApi, leaveTypesApi, leaveBalancesApi, ApiLeavePlan, ApiLeaveType, ApiPlanEmployee, ApiLeaveBalancesResponse } from './leavePlansApi';
import EmployeePicker, { PickedEmployee } from '../../components/ui/EmployeePicker';
import api from '../../api';

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

// Multi-level approval chain. Each entry describes who acts at that
// level — `reporting_manager` resolves to the employee's RM at submit
// time, `role` matches a named role (HR / branch_admin), `user` /
// `employee` reference a specific person. Backend snapshots this on
// the leave_request so changing the chain doesn't reroute in-flight
// approvals.
interface ApprovalLevel {
  approver_kind: 'reporting_manager' | 'role' | 'user' | 'employee';
  approver_role?: string | null;
  approver_user_id?: number | null;
  approver_employee_id?: number | null;
  label?: string | null;
  // Optional auto-skip rule evaluated at submission time. When the
  // request's day count matches the rule, this level is marked
  // Skipped without anyone having to act. Supported keys:
  //   days_lt / days_lte / days_gt / days_gte
  skip_if?: {
    days_lt?: number;
    days_lte?: number;
    days_gt?: number;
    days_gte?: number;
  } | null;
}

interface ApprovalConfig {
  required: boolean;
  approverRole: string;
  autoApproveIfMissing: boolean;
  doNotEmailEveryRequest: boolean;
  // New optional chain — when empty/missing the backend falls back to a
  // single Reporting Manager level so old plans keep working.
  chain?: ApprovalLevel[];
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
    chain: [{ approver_kind: 'reporting_manager' }],
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

/**
 * Deep-merge an incoming (possibly partial) config_json blob with the
 * default. Loaded rows from the DB may pre-date a section (e.g. an
 * older config without `yearEnd`) — passing it raw to the section
 * views crashes them when they read `cfg.something` on undefined.
 * One-level deep merge is enough — the inner shapes never change
 * without a code-side type update.
 */
function mergeWithDefaultConfig(raw: Partial<LeaveTypeConfig> | undefined | null): LeaveTypeConfig {
  const def = defaultLeaveTypeConfig();
  if (!raw || typeof raw !== 'object') return def;
  return {
    accrual:      { ...def.accrual,      ...(raw.accrual      ?? {}) },
    leaveApp:     { ...def.leaveApp,     ...(raw.leaveApp     ?? {}) },
    approval:     { ...def.approval,     ...(raw.approval     ?? {}) },
    yearEnd:      { ...def.yearEnd,      ...(raw.yearEnd      ?? {}) },
    probation:    { ...def.probation,    ...(raw.probation    ?? {}) },
    noticePeriod: { ...def.noticePeriod, ...(raw.noticePeriod ?? {}) },
  };
}

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
// Visual constants — accent palette + job-title tone presets used by the
// API adapters when rendering employee avatars and pills. Demo-data builders
// from the page's pre-API era were removed; only these helpers remain.
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

// ─────────────────────────────────────────────────────────────────────────────
// API → frontend adapters. The page was originally built against in-memory
// demo data with hand-crafted shapes; the backend talks in raw rows. These
// helpers convert between the two so the JSX downstream stays untouched.
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_PALETTE: Array<{ bg: string; fg: string; color: string }> = [
  { bg: '#fee2e2', fg: '#b91c1c', color: '#dc2626' },
  { bg: '#fde8c4', fg: '#a4661c', color: '#f59e0b' },
  { bg: '#ece6ff', fg: '#5a3fd1', color: '#7c5cfc' },
  { bg: '#d3f0ee', fg: '#0a716a', color: '#0a716a' },
  { bg: '#dceefe', fg: '#0c63b0', color: '#0ea5e9' },
  { bg: '#fdd9ea', fg: '#a02960', color: '#e83e8c' },
  { bg: '#dcfce7', fg: '#15803d', color: '#16a34a' },
];
const paletteFor = (id: number) => TYPE_PALETTE[id % TYPE_PALETTE.length];

function mapApiTypeCategory(t: ApiLeaveType['type']): string {
  if (t === 'Compoff') return 'Compensatory offs';
  if (t === 'Incident Based Leave') return 'Incident based';
  if (t === 'Unpaid Leave') return 'Unpaid';
  return 'Regular';
}

function apiTypeToCatalog(api: ApiLeaveType): CatalogType {
  const tone = paletteFor(api.id);
  return {
    id: String(api.id),
    name: api.name,
    type: mapApiTypeCategory(api.type),
    isPaid: api.paid_unpaid === 'Unpaid' || api.type === 'Unpaid Leave' ? 'Unpaid' : 'Paid',
    code: api.short_code,
    initials: (api.short_code || api.name).slice(0, 3).toUpperCase(),
    bg: tone.bg,
    fg: tone.fg,
    group: api.type === 'Incident Based Leave' ? 'incidental' : 'regular',
  };
}

function apiTypeToAssigned(api: ApiLeaveType): LeaveTypeRow {
  const tone = paletteFor(api.id);
  return {
    id: String(api.id),
    name: api.name,
    color: tone.color,
    quotaLabel: api.pivot?.quota_summary || 'Not Setup',
    endOfYearLabel: api.pivot?.eoy_summary || 'Not Setup',
    configured: !!api.pivot?.is_setup,
  };
}

function apiEmployeeToPlanEmployee(api: ApiPlanEmployee, idx: number): PlanEmployee {
  const fullName = api.display_name?.trim() || `${api.first_name} ${api.last_name ?? ''}`.trim();
  const initials = fullName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  /* Reporting manager name — try the Employee-side relation first, then
   * fall back to the User-side relation (Branch/Client admin assigned
   * as manager but not onboarded as an Employee). */
  const rmName = api.reporting_manager
    ? (api.reporting_manager.display_name?.trim() || `${api.reporting_manager.first_name} ${api.reporting_manager.last_name ?? ''}`.trim())
    : (api.reporting_manager_user?.name?.trim() || '');
  const rmInitials = rmName ? rmName.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() : '';
  return {
    id: String(api.id),
    name: fullName,
    empNo: api.emp_code || `EMP-${api.id}`,
    department: api.department?.name ?? '',
    jobTitle: api.designation?.name ?? '',
    jobTitleTone: JOB_TITLE_TONES[idx % JOB_TITLE_TONES.length],
    reportingTo: { initials: rmInitials, name: rmName, accent: accent(idx + 3) },
    location: api.location ?? '',
    initials,
    accent: accent(idx),
  };
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function apiPlanToFrontend(api: ApiLeavePlan): LeavePlan {
  // Reconstruct a YYYY-MM-01 string for the <input type="date"> from the
  // separately-stored from_month + calendar_year. The original adapter
  // shoved calendar_year ("2025") straight into the date input, which
  // browsers reject and silently render as empty.
  let startDate: string | undefined;
  if (api.from_month && api.calendar_year) {
    const monthIdx = MONTH_NAMES.indexOf(api.from_month);
    if (monthIdx >= 0) {
      startDate = `${api.calendar_year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
    }
  }
  return {
    id: String(api.id),
    name: api.plan_name,
    description: api.description ?? undefined,
    isDefault: !!api.is_default,
    calendarStart: api.from_month_type === 'If Joining' ? 'joining_date' : 'fixed_month',
    startDate,
    showSystemPolicy: api.policy_explanation_mode !== 'Custom',
    customPolicyFile: api.policy_doc_path ?? undefined,
    employees: (api.employees ?? []).map(apiEmployeeToPlanEmployee),
    leaveTypes: (api.leave_types ?? []).map(apiTypeToAssigned),
  };
}

/**
 * Convert the frontend Add Leave Plan modal payload into the shape
 * LeavePlanController::store expects. The modal carries `calendarStart`
 * + `startDate` (a calendar string); the API splits this into
 * from_month_type + from_month + calendar_year.
 */
function frontendPlanToApi(p: Partial<LeavePlan>): Partial<ApiLeavePlan> {
  let from_month: string | null = null;
  let calendar_year: string | null = null;
  if (p.calendarStart === 'fixed_month' && p.startDate) {
    const d = new Date(p.startDate);
    if (!Number.isNaN(d.getTime())) {
      from_month = MONTH_NAMES[d.getMonth()] ?? null;
      calendar_year = String(d.getFullYear());
    } else {
      // Already in YYYY-MM-DD or just a year — store as-is.
      calendar_year = p.startDate;
    }
  }
  return {
    plan_name: p.name,
    description: p.description ?? null,
    from_month_type: p.calendarStart === 'joining_date' ? 'If Joining' : 'Calendar',
    from_month,
    calendar_year,
    policy_explanation_mode: p.showSystemPolicy === false ? 'Custom' : 'System',
    policy_doc_path: p.customPolicyFile ?? null,
    is_default: !!(p as any).isDefault,
    status: 'Active',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
type TopTab = 'plans' | 'types' | 'balances';

export default function HrLeavePlans() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<LeavePlan[]>([]);
  const [topTab, setTopTab] = useState<TopTab>('plans');
  const [activePlanId, setActivePlanId] = useState<string>('');
  const [planSearch, setPlanSearch] = useState('');
  const [showAddPlan, setShowAddPlan] = useState(false);
  // Null = create mode. A plan id = edit that plan.
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
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
  // Read-only View popup for a leave type (eye icon).
  const [viewingTypeId, setViewingTypeId] = useState<string | null>(null);
  // "Need help configuring?" guidance modal.
  const [showGuide, setShowGuide] = useState(false);
  // Catalog of leave types for this branch — fetched from /master/leave_type.
  const [catalog, setCatalog] = useState<CatalogType[]>([]);

  // ──────────────────────────────────────────────────────────────────────
  // API loaders
  // ──────────────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    try {
      const list = await leavePlansApi.list();
      // Hydrate each plan's full detail so the Configuration table has
      // data without needing a follow-up click. Promise.allSettled so a
      // single bad row doesn't blank the whole sidebar.
      const settled = await Promise.allSettled(list.map(p => leavePlansApi.show(p.id)));
      const detailed = settled.flatMap(s => s.status === 'fulfilled' ? [s.value] : []);
      const mapped = detailed.map(apiPlanToFrontend);
      setPlans(mapped);
      // Seed typeConfigs from the persisted pivot rows so the Setup popup
      // opens with the saved values instead of the empty default. Deep-
      // merge each loaded config with defaultLeaveTypeConfig() so any
      // missing section (e.g. an old row that was saved before YearEnd
      // existed) gets defaulted instead of crashing the section view
      // when it reads `cfg.unit` on undefined.
      const seeded: Record<string, LeaveTypeConfig> = {};
      detailed.forEach(p => {
        (p.leave_types ?? []).forEach(t => {
          if (t.pivot?.config_json) {
            seeded[`${p.id}::${t.id}`] = mergeWithDefaultConfig(t.pivot.config_json as Partial<LeaveTypeConfig>);
          }
        });
      });
      setTypeConfigs(seeded);
      // Functional updater so we don't need activePlanId in the dep array
      // — clicking the sidebar shouldn't trigger a full refetch.
      setActivePlanId(curr => curr || mapped[0]?.id || '');
    } catch (err) {
      console.warn('[HrLeavePlans] failed to load plans', err);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const list = await leaveTypesApi.list();
      setCatalog(list.map(apiTypeToCatalog));
    } catch (err) {
      console.warn('[HrLeavePlans] failed to load leave-type catalog', err);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const editingType = catalog.find(t => t.id === editingTypeId) ?? null;

  // ──────────────────────────────────────────────────────────────────────
  // Mutation handlers — each calls the API then refetches the affected
  // collection. Optimistic updates were tempting but the source of truth
  // for quota_summary / eoy_summary lives on the pivot row, so a refetch
  // keeps the Configuration table consistent with the backend.
  // ──────────────────────────────────────────────────────────────────────
  const onSaveLeaveType = async (t: Omit<CatalogType, 'id' | 'initials' | 'bg' | 'fg'>) => {
    const apiType = (() => {
      if (t.type === 'Compensatory offs') return 'Compoff' as const;
      if (t.type === 'Incident based') return 'Incident Based Leave' as const;
      if (t.type === 'Unpaid') return 'Unpaid Leave' as const;
      return 'Regular' as const;
    })();
    const payload: Partial<ApiLeaveType> = {
      name: t.name,
      type: apiType,
      short_code: t.code,
      paid_unpaid: t.isPaid,
      status: 'Active',
    };
    try {
      if (editingTypeId) {
        await leaveTypesApi.update(Number(editingTypeId), payload);
      } else {
        await leaveTypesApi.create(payload);
      }
      await loadCatalog();
    } catch (err) {
      console.error('[HrLeavePlans] save leave type failed', err);
    } finally {
      setShowAddType(false);
      setEditingTypeId(null);
    }
  };

  const onEditLeaveType = (id: string) => {
    setEditingTypeId(id);
    setShowAddType(true);
  };
  const onViewLeaveType = (id: string) => {
    setViewingTypeId(id);
  };
  const onDeleteLeaveType = async (id: string) => {
    const row = catalog.find(c => c.id === id);
    const label = row ? `"${row.name}"` : 'this leave type';
    if (!window.confirm(`Delete ${label}? This cannot be undone. The type will also be removed from any leave plan it's assigned to.`)) return;
    try {
      await leaveTypesApi.remove(Number(id));
      await loadCatalog();
      // Plans may have referenced this type — refetch so the Configuration
      // table for any open plan reflects the removal.
      await loadPlans();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Delete failed';
      alert(msg);
    }
  };
  const onCloseTypeModal = () => {
    setShowAddType(false);
    setEditingTypeId(null);
  };

  const onMakeDefault = async () => {
    if (!activePlanId) return;
    try {
      await leavePlansApi.makeDefault(Number(activePlanId));
      await loadPlans();
    } catch (err) {
      console.error('[HrLeavePlans] make-default failed', err);
    } finally {
      setPlanMenuOpen(false);
    }
  };

  const onDeletePlan = async () => {
    if (!activePlanId) return;
    try {
      await leavePlansApi.remove(Number(activePlanId));
      const remaining = plans.filter(p => p.id !== activePlanId);
      setActivePlanId(remaining[0]?.id ?? '');
      await loadPlans();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Delete failed';
      alert(msg);
    } finally {
      setPlanMenuOpen(false);
    }
  };

  const onClonePlan = async () => {
    if (!activePlanId) return;
    const source = plans.find(p => p.id === activePlanId);
    if (!source) return;
    try {
      const cloned = await leavePlansApi.clone(Number(activePlanId), `${source.name} (Copy)`);
      await loadPlans();
      setActivePlanId(String(cloned.id));
    } catch (err) {
      console.error('[HrLeavePlans] clone failed', err);
    } finally {
      setPlanMenuOpen(false);
    }
  };

  const onEditPlan = () => {
    if (!activePlanId) return;
    setEditingPlanId(activePlanId);
    setShowAddPlan(true);
    setPlanMenuOpen(false);
  };

  const onClosePlanModal = () => {
    setShowAddPlan(false);
    setEditingPlanId(null);
  };

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter(p => p.name.toLowerCase().includes(q));
  }, [plans, planSearch]);

  const activePlan = plans.find(p => p.id === activePlanId) ?? plans[0];

  const onSavePlan = async (plan: Omit<LeavePlan, 'id' | 'employees' | 'leaveTypes'>) => {
    try {
      if (editingPlanId) {
        await leavePlansApi.update(Number(editingPlanId), frontendPlanToApi(plan));
        await loadPlans();
      } else {
        const created = await leavePlansApi.create(frontendPlanToApi(plan));
        await loadPlans();
        setActivePlanId(String(created.id));
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Save failed';
      alert(msg);
      return;
    } finally {
      setShowAddPlan(false);
      setEditingPlanId(null);
    }
  };

  const onAssignTypes = async (chosen: LeaveTypeRow[]) => {
    if (!activePlanId) return;
    const existingIds = new Set(activePlan?.leaveTypes.map(t => Number(t.id)) ?? []);
    const newIds = chosen.map(c => Number(c.id)).filter(id => !existingIds.has(id));
    const allIds = [...existingIds, ...newIds];
    try {
      await leavePlansApi.assignTypes(Number(activePlanId), allIds, 'replace');
      await loadPlans();
    } catch (err) {
      console.error('[HrLeavePlans] assign types failed', err);
    } finally {
      setShowAssignTypes(false);
    }
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
                  { key: 'plans',    label: 'Leave Plans' },
                  { key: 'types',    label: 'Leave Types' },
                  { key: 'balances', label: 'Leave Balances' },
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
                        <span className="lp-sub-tab is-active">Configuration</span>
                      </div>

                      <ConfigurationTab
                        plan={activePlan}
                        onAssignTypes={() => setShowAssignTypes(true)}
                        onSetupType={(typeId) => setSetupTypeId(typeId)}
                        onShowGuide={() => setShowGuide(true)}
                      />
                    </>
                  )}
                </main>
              </div>
            ) : topTab === 'types' ? (
              <LeaveTypesTab
                catalog={catalog}
                onView={onViewLeaveType}
                onEdit={onEditLeaveType}
                onDelete={onDeleteLeaveType}
                onShowGuide={() => setShowGuide(true)}
              />
            ) : (
              <LeaveBalancesTab />
            )}
          </div>
        </Col>
      </Row>

      <AddLeavePlanModal
        isOpen={showAddPlan}
        editing={plans.find(p => p.id === editingPlanId) ?? null}
        onClose={onClosePlanModal}
        onSave={onSavePlan}
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
        catalog={catalog}
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
          // 1) Optimistically update local state so the popup reflects edits
          //    immediately without waiting for a round-trip.
          setTypeConfigs(prev => ({
            ...prev,
            [`${activePlan.id}::${setupTypeId}`]: next,
          }));
          const quotaLabel = next.accrual.unlimited ? 'Unlimited' : `${next.accrual.yearlyQuota} ${next.accrual.unit}/year`;
          const eoyLabel =
            next.yearEnd.carryForward === 'reset'   ? 'Reset to zero'
            : next.yearEnd.carryForward === 'carry_all' ? 'Carry all forward'
            : `Carry up to ${next.yearEnd.carryForwardCap || 0}`;
          setPlans(prev => prev.map(p =>
            p.id === activePlan.id
              ? {
                  ...p,
                  leaveTypes: p.leaveTypes.map(t =>
                    t.id === setupTypeId
                      ? { ...t, configured: true, quotaLabel, endOfYearLabel: eoyLabel }
                      : t
                  ),
                }
              : p
          ));
          // 2) Persist to backend. Fire-and-forget — the optimistic update
          //    above keeps the UI responsive; failure is logged and the
          //    next loadPlans() will reconcile if needed.
          leavePlansApi
            .saveTypeConfig(Number(activePlan.id), Number(setupTypeId), next as any, quotaLabel, eoyLabel)
            .catch(err => console.error('[HrLeavePlans] save type config failed', err));
        }}
      />

      <ViewLeaveTypeModal
        isOpen={!!viewingTypeId}
        leaveType={catalog.find(c => c.id === viewingTypeId) ?? null}
        onClose={() => setViewingTypeId(null)}
        onEdit={(id) => { setViewingTypeId(null); onEditLeaveType(id); }}
      />

      <GuidanceModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration tab — leave-type table with Setup buttons
// ─────────────────────────────────────────────────────────────────────────────
function ConfigurationTab({
  plan, onAssignTypes, onSetupType, onShowGuide,
}: {
  plan: LeavePlan;
  onAssignTypes: () => void;
  onSetupType: (typeId: string) => void;
  onShowGuide: () => void;
}) {
  return (
    <div className="lp-config">
      <div className="lp-config-actions">
        <button type="button" className="rec-btn-primary" onClick={onAssignTypes}>
          <i className="ri-add-line" />Add leave type
        </button>
        <span className="lp-help-chip">
          <i className="ri-information-line" />
          Need help configuring?{' '}
          <button
            type="button"
            onClick={onShowGuide}
            style={{ background: 'none', border: 'none', padding: 0, color: '#0c63b0', textDecoration: 'underline', fontWeight: 600, cursor: 'pointer' }}
          >
            Check the guide here.
          </button>
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

function LeaveTypesTab({
  catalog, onView, onEdit, onDelete, onShowGuide,
}: {
  catalog: CatalogType[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowGuide: () => void;
}) {
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
        Setting up new leave plans or types?{' '}
        <button
          type="button"
          onClick={onShowGuide}
          style={{ background: 'none', border: 'none', padding: 0, color: '#0c63b0', textDecoration: 'underline', fontWeight: 600, cursor: 'pointer' }}
        >
          Here's a quick guide to get you started!
        </button>
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
              <th style={{ width: 150, textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {regular.map(t => <CatalogRow key={t.id} t={t} onView={onView} onEdit={onEdit} onDelete={onDelete} />)}
            {incidental.length > 0 && (
              <tr className="lp-group-row">
                <td colSpan={5}>STATUTORY / INCIDENTAL</td>
              </tr>
            )}
            {incidental.map(t => <CatalogRow key={t.id} t={t} onView={onView} onEdit={onEdit} onDelete={onDelete} />)}
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

function CatalogRow({
  t, onView, onEdit, onDelete,
}: {
  t: CatalogType;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
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
          <button type="button" className="lp-row-action" aria-label="View" onClick={() => onView(t.id)} title="View details">
            <i className="ri-eye-line" />
          </button>
          <button type="button" className="lp-row-action" aria-label="Edit" onClick={() => onEdit(t.id)} title="Edit leave type">
            <i className="ri-pencil-line" />
          </button>
          <button
            type="button"
            className="lp-row-action"
            aria-label="Delete"
            onClick={() => onDelete(t.id)}
            title="Delete leave type"
            style={{ color: '#dc2626' }}
          >
            <i className="ri-delete-bin-line" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Balances tab — every employee × every leave-type, fetched live from
// /api/leave-balances. Columns are dynamic (driven by what's actually
// assigned across plans), so HR sees only the leave types that matter for
// their branch. `used` is currently always 0 because we don't have a
// leave_requests table yet; once requests exist the backend joins them in.
// ─────────────────────────────────────────────────────────────────────────────
function LeaveBalancesTab() {
  const [data, setData] = useState<ApiLeaveBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // `debouncedSearch` lags `search` by 350ms so each keystroke doesn't fire
  // a backend request. The dropdown filters fire immediately because they
  // change one value at a time.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [department, setDepartment] = useState('All');
  const [location, setLocation] = useState('All');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await leaveBalancesApi.fetch({
        location: location === 'All' ? undefined : location,
        search: debouncedSearch || undefined,
      });
      setData(resp);
    } catch (err) {
      console.warn('[LeaveBalancesTab] fetch failed', err);
      setData({ columns: [], employees: [], filters: { departments: [], locations: [] } });
    } finally {
      setLoading(false);
    }
  }, [location, debouncedSearch]);

  useEffect(() => { refetch(); }, [refetch]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (department === 'All') return data.employees;
    return data.employees.filter(e => e.department === department);
  }, [data, department]);

  const accentFor = (id: number) => {
    const palette = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
    return palette[id % palette.length];
  };
  const initialsOf = (name: string) =>
    name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

  const DEPT_OPTS = [{ value: 'All', label: 'Department' }, ...(data?.filters.departments ?? []).map(v => ({ value: v, label: v }))];
  const LOC_OPTS  = [{ value: 'All', label: 'Location'   }, ...(data?.filters.locations   ?? []).map(v => ({ value: v, label: v }))];

  const colCount = data?.columns.length ?? 0;

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
        <button type="button" className="lp-icon-btn" aria-label="Refresh" onClick={refetch} title="Refresh">
          <i className="ri-refresh-line" />
        </button>
      </div>

      <div className="lp-config-table-wrap lp-balances-wrap">
        <table className="lp-config-table lp-balances-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>EMPLOYEE NAME</th>
              <th style={{ minWidth: 100 }}>EMP NO.</th>
              <th style={{ minWidth: 110 }}>LOCATION</th>
              {(data?.columns ?? []).map(c => (
                <th key={c.leave_type_id} style={{ minWidth: 140 }}>{c.name.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3 + colCount} className="text-center py-5 text-muted">
                  <i className="ri-loader-4-line ri-spin d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                  Loading balances...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={3 + colCount} className="text-center py-5 text-muted">
                  <i className="ri-team-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                  {data && data.employees.length === 0
                    ? 'No employees are assigned to a leave plan yet.'
                    : 'No employees match your filters'}
                </td>
              </tr>
            ) : filteredRows.map((e) => {
              const accent = accentFor(e.id);
              return (
                <tr key={e.id}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span
                        className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                        style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
                      >
                        {initialsOf(e.name)}
                      </span>
                      <div>
                        <span className="lp-emp-name d-block fs-13 fw-semibold">{e.name}</span>
                        <span className="text-muted" style={{ fontSize: 11 }}>{e.designation || e.plan_name || ''}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="lp-emp-link fs-13">{e.emp_code}</span>
                  </td>
                  <td className="fs-13 text-muted">
                    {e.location ? <><i className="ri-map-pin-line me-1" />{e.location}</> : '—'}
                  </td>
                  {e.balances.map((b) => {
                    if (!b.applies) {
                      return <td key={b.leave_type_id} className="text-muted">—</td>;
                    }
                    if (b.unlimited) {
                      return (
                        <td key={b.leave_type_id}>
                          <span className="rec-pill" style={{ background: '#d1fae5', color: '#065f46', fontSize: 10.5 }}>
                            <i className="ri-infinity-line me-1" />Unlimited
                          </span>
                        </td>
                      );
                    }
                    if (b.quota === 0) {
                      return <td key={b.leave_type_id} className="text-muted">Not Setup</td>;
                    }
                    const pct = Math.min(100, Math.round((b.used / b.quota) * 100));
                    const tone = pct >= 100 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#7c5cfc';
                    return (
                      <td key={b.leave_type_id}>
                        <div className="lp-balance-cell">
                          <div className="d-flex align-items-center justify-content-between">
                            <span className="fw-semibold fs-13">{b.used}/{b.quota}</span>
                            <span className="text-muted" style={{ fontSize: 10.5 }}>{pct}%</span>
                          </div>
                          <span className="lp-balance-track">
                            <span className="lp-balance-fill" style={{ width: `${pct}%`, background: tone }} />
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ViewLeaveTypeModal — read-only details popup opened from the eye icon on
// the Leave Types catalog row. Surfaces every persisted attribute and a
// shortcut into Edit so HR doesn't need to close → reopen via the pencil.
// ─────────────────────────────────────────────────────────────────────────────
function ViewLeaveTypeModal({
  isOpen, leaveType, onClose, onEdit,
}: {
  isOpen: boolean;
  leaveType: CatalogType | null;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  if (!leaveType) return null;
  const t = leaveType;
  return (
    <Modal isOpen={isOpen} toggle={onClose} centered size="md" backdrop="static" modalClassName="rec-form-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-eye-line" style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  Leave Type Details
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Read-only view of "{t.name}"
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="rec-form-body" style={{ padding: '18px 22px' }}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="lp-code-pill" style={{ background: t.bg, color: t.fg, fontSize: 13, padding: '4px 10px' }}>{t.initials}</span>
            <h5 className="fw-bold mb-0" style={{ fontSize: 16 }}>{t.name}</h5>
          </div>

          <Row className="g-3">
            <Col md={6}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>CATEGORY</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{t.type}</div>
            </Col>
            <Col md={6}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>SHORT CODE</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{t.code}</div>
            </Col>
            <Col md={6}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>IS PAID</div>
              <span className="rec-pill" style={{ background: t.isPaid === 'Paid' ? '#d3f0ee' : '#eef2f6', color: t.isPaid === 'Paid' ? '#0a716a' : '#374151' }}>
                {t.isPaid}
              </span>
            </Col>
            <Col md={6}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>GROUP</div>
              <div className="fw-semibold text-capitalize" style={{ fontSize: 13 }}>{t.group}</div>
            </Col>
          </Row>
        </div>

        <div className="rec-form-footer">
          <span className="hint">Catalog entry — open Edit to change values</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
            <button type="button" className="rec-btn-primary" onClick={() => onEdit(t.id)}>
              <i className="ri-pencil-line" />Edit
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GuidanceModal — quick reference triggered by the "Here's a quick guide…" /
// "Check the guide here" links scattered through the page. Opening the same
// modal from every entry point keeps the help surface consistent.
// ─────────────────────────────────────────────────────────────────────────────
function GuidanceModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} toggle={onClose} centered size="md" backdrop="static" modalClassName="rec-form-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header" style={{ padding: '14px 22px 12px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-question-line" style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  Leave Setup — Quick Guide
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  How leave types and plans fit together
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        <div className="rec-form-body" style={{ padding: '18px 22px' }}>
          <ol style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li className="mb-3">
              <div className="fw-bold" style={{ fontSize: 13 }}>1. Define your Leave Types</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                Open the <strong>Leave Types</strong> tab and add every kind of leave your branch uses (Sick, Casual, Maternity, etc.). Each type carries a name, short code, paid/unpaid flag, and category (Regular, Incident based, Compensatory offs, Unpaid).
              </div>
            </li>
            <li className="mb-3">
              <div className="fw-bold" style={{ fontSize: 13 }}>2. Create one or more Leave Plans</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                A plan groups together the leave types that apply to a set of employees (e.g. "Plan for Executives"). Decide when its calendar year starts — a fixed month or each employee's joining date.
              </div>
            </li>
            <li className="mb-3">
              <div className="fw-bold" style={{ fontSize: 13 }}>3. Assign types and configure each one</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                Inside a plan, click <strong>+ Add leave type</strong> to attach types from your catalog. Then click <strong>Setup</strong> on each row to configure quota, accrual, application rules, approval chain, year-end behaviour, probation rules and notice-period handling.
              </div>
            </li>
            <li className="mb-3">
              <div className="fw-bold" style={{ fontSize: 13 }}>4. One plan can be the Default</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                The plan flagged DEFAULT is auto-applied to new joiners. Use the 3-dot menu on the plan header to mark a plan as default, clone it, or delete it.
              </div>
            </li>
            <li>
              <div className="fw-bold" style={{ fontSize: 13 }}>5. Track balances</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                The <strong>Leave Balances</strong> tab shows every employee with their per-type quota and consumption. Filter by department or location and search by name to drill in.
              </div>
            </li>
          </ol>
        </div>

        <div className="rec-form-footer">
          <span className="hint">Need more? Email your HR admin or check the docs.</span>
          <button type="button" className="rec-btn-primary" onClick={onClose}>Got it</button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Leave Plan modal — right-side drawer
// ─────────────────────────────────────────────────────────────────────────────
function AddLeavePlanModal({
  isOpen, editing, onClose, onSave,
}: {
  isOpen: boolean;
  editing: LeavePlan | null;
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

  // Hydrate from the row being edited every time the modal opens. When
  // `editing` is null we reset to a clean create-mode form. Mirrors the
  // pattern AddLeaveTypeModal already uses.
  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? '');
      setShowDescription(!!editing.description);
      setCalendarStart(editing.calendarStart);
      setStartDate(editing.startDate ?? '');
      setShowSystemPolicy(editing.showSystemPolicy);
      setUploadCustom(!!editing.customPolicyFile);
      setIsDefault(!!editing.isDefault);
    } else {
      reset();
    }
  }, [isOpen, editing]);

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
                <i className={editing ? 'ri-pencil-line' : 'ri-calendar-2-line'} style={{ color: '#fff', fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>
                  {editing ? 'Edit Leave Plan' : 'Add Leave Plan'}
                </h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  {editing ? `Update "${editing.name}"` : 'Create a new leave policy group'}
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
          <span className="hint" />
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={handleClose}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={!name.trim()}
            >
              <i className={editing ? 'ri-save-line' : 'ri-save-3-line'} />
              {editing ? 'Update Plan' : 'Save Plan'}
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
          <span className="hint" />
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

const CATEGORY_META: Record<AssignableType['category'], { label: string; color: string }> = {
  regular:  { label: 'REGULAR',  color: '#7c5cfc' },
  incident: { label: 'INCIDENT', color: '#0ea5e9' },
  unpaid:   { label: 'UNPAID',   color: '#dc2626' },
  compoff:  { label: 'COMPOFF',  color: '#16a34a' },
};

function AssignLeaveTypesModal({
  isOpen, planName, existingTypeIds, catalog, onClose, onSave,
}: {
  isOpen: boolean;
  planName: string;
  existingTypeIds: Set<string>;
  catalog: CatalogType[];
  onClose: () => void;
  onSave: (types: LeaveTypeRow[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleSelectedCount = selected.size;

  // Derive AssignableType[] from the live catalog (master_leave_types) so
  // newly-added types in the master catalog show up here without a code change.
  const assignableTypes: AssignableType[] = useMemo(() => catalog.map(c => {
    const category: AssignableType['category'] =
      c.type === 'Compensatory offs' ? 'compoff'
      : c.type === 'Incident based' ? 'incident'
      : c.type === 'Unpaid' ? 'unpaid'
      : 'regular';
    const color =
      category === 'compoff' ? '#16a34a'
      : category === 'incident' ? '#0ea5e9'
      : category === 'unpaid' ? '#dc2626'
      : '#7c5cfc';
    return { id: c.id, name: c.name, description: c.type, category, color };
  }), [catalog]);

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
    const rows: LeaveTypeRow[] = assignableTypes
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
    assignableTypes.filter(t => t.category === cat);

  // Progress: out of the *assignable* (not-yet-on-plan) types, how many
  // selected. Caps at 100% so the bar reads correctly when the plan already
  // owns most types.
  const assignablePool = assignableTypes.filter(t => !existingTypeIds.has(t.id)).length || assignableTypes.length || 1;
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

// Year End Processing / Probation / Notice Period removed at user request —
// their underlying types + section views remain in the file (and the
// config_json still tracks them via defaults) so they can be re-introduced
// without a schema change, but they no longer appear in the sidebar.
const SETUP_SECTIONS: { key: SetupSection; label: string; icon: string; tone: string }[] = [
  { key: 'accrual',      label: 'Accrual',           icon: 'ri-time-line',           tone: '#7c5cfc' },
  { key: 'leaveApp',     label: 'Leave Application', icon: 'ri-file-list-3-line',    tone: '#0ea5e9' },
  { key: 'approval',     label: 'Approval',          icon: 'ri-checkbox-circle-line',tone: '#16a34a' },
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
// Kind labels + accent colours for the chain editor pills.
const APPROVER_KIND_META: Record<ApprovalLevel['approver_kind'], { label: string; bg: string; fg: string; initials: string }> = {
  reporting_manager: { label: 'Reporting Manager', bg: '#d3f0ee', fg: '#0a716a', initials: 'RM' },
  role:              { label: 'Role',              bg: '#ece6ff', fg: '#5a3fd1', initials: 'RL' },
  user:              { label: 'Specific User',     bg: '#dceefe', fg: '#0c63b0', initials: 'U' },
  employee:          { label: 'Specific Employee', bg: '#fde8c4', fg: '#a4661c', initials: 'E' },
};

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'hr',                label: 'HR' },
  { value: 'branch_admin',      label: 'Branch Admin' },
  { value: 'reporting_manager', label: 'Reporting Manager (role)' },
];

function ApprovalSectionView({ cfg, update }: { cfg: ApprovalConfig; update: (p: Partial<ApprovalConfig>) => void }) {
  // Always operate on a real array — old plans that haven't been edited
  // since the chain field was introduced have an undefined `chain`, so
  // default to a single Reporting Manager level. Editing it triggers a
  // save via the parent's onChange.
  const chain: ApprovalLevel[] = Array.isArray(cfg.chain) && cfg.chain.length > 0
    ? cfg.chain
    : [{ approver_kind: 'reporting_manager' }];

  // Local cache of full PickedEmployee objects keyed by level index — the
  // chain entry only stores ID + label, so on first render we hydrate
  // photos/designations by calling /api/employees once with all stored
  // IDs in scope. The user gets nice chips immediately on reload instead
  // of bare "Employee #12" placeholders.
  const [chainPicked, setChainPicked] = useState<Record<number, PickedEmployee | null>>({});
  useEffect(() => {
    // Only hydrate the entries we haven't already resolved this session.
    const needIds = chain
      .map((l, idx) => ({ idx, l }))
      .filter(({ idx, l }) =>
        !chainPicked[idx]
        && (l.approver_kind === 'user' || l.approver_kind === 'employee')
        && (l.approver_user_id || l.approver_employee_id)
      );
    if (needIds.length === 0) return;
    // The employees endpoint supports a numeric search but not a bulk
    // id-in filter, so fall back to per-row fetches. Batched in a single
    // Promise.all so we only pay one render cycle. Keep this minimal —
    // most chains are 1-3 levels.
    Promise.all(needIds.map(({ idx, l }) => {
      // For `user` kind we have a user_id, not an employee_id. The
      // employees endpoint accepts ?user_id=N as part of the standard
      // filters. For `employee` kind we have the id directly.
      const params = l.approver_kind === 'employee'
        ? { id: l.approver_employee_id }
        : { user_id: l.approver_user_id };
      return api.get('/employees', { params: { ...params, per_page: 1 } })
        .then(r => {
          const raw = r.data?.data ?? r.data ?? [];
          const e = Array.isArray(raw) ? raw[0] : null;
          if (!e) return { idx, picked: null as PickedEmployee | null };
          const picked: PickedEmployee = {
            id: e.id,
            user_id: e.user_id ?? null,
            name: (e.display_name?.trim() || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || `Employee #${e.id}`,
            emp_code: e.emp_code || `EMP-${e.id}`,
            designation: e.designation?.name || e.designation_name || null,
            photo_url: e.profile_photo_url || e.photo_url || null,
          };
          return { idx, picked };
        })
        .catch(() => ({ idx, picked: null as PickedEmployee | null }));
    })).then(results => {
      setChainPicked(prev => {
        const next = { ...prev };
        results.forEach(({ idx, picked }) => { next[idx] = picked; });
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.chain]);

  const setChain = (next: ApprovalLevel[]) => update({ chain: next });
  const updateLevel = (idx: number, patch: Partial<ApprovalLevel>) => {
    const next = chain.map((c, i) => i === idx ? { ...c, ...patch } : c);
    setChain(next);
  };
  const addLevel = () => setChain([...chain, { approver_kind: 'role', approver_role: 'hr' }]);
  const removeLevel = (idx: number) => {
    if (chain.length <= 1) return; // keep at least one level
    setChain(chain.filter((_, i) => i !== idx));
  };
  const moveLevel = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= chain.length) return;
    const next = chain.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setChain(next);
  };

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
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="lts-section-label">APPROVAL CHAIN</div>
              <button
                type="button"
                className="rec-btn-ghost"
                onClick={addLevel}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                <i className="ri-add-line" /> Add Level
              </button>
            </div>

            {chain.map((level, idx) => {
              const meta = APPROVER_KIND_META[level.approver_kind] || APPROVER_KIND_META.reporting_manager;
              return (
                <div key={idx} className="lts-approval-card" style={{ marginBottom: 10 }}>
                  <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                    <span className="lts-level-pill">LEVEL {idx + 1}</span>
                    <span className="lts-level-pill" style={{ background: meta.bg, color: meta.fg }}>
                      {meta.label.toUpperCase()}
                    </span>
                    <div className="ms-auto d-flex align-items-center gap-1">
                      <button
                        type="button"
                        className="lp-icon-btn"
                        title="Move up"
                        onClick={() => moveLevel(idx, -1)}
                        disabled={idx === 0}
                        style={{ opacity: idx === 0 ? 0.3 : 1 }}
                      >
                        <i className="ri-arrow-up-s-line" />
                      </button>
                      <button
                        type="button"
                        className="lp-icon-btn"
                        title="Move down"
                        onClick={() => moveLevel(idx, 1)}
                        disabled={idx === chain.length - 1}
                        style={{ opacity: idx === chain.length - 1 ? 0.3 : 1 }}
                      >
                        <i className="ri-arrow-down-s-line" />
                      </button>
                      <button
                        type="button"
                        className="lp-icon-btn"
                        title="Remove level"
                        onClick={() => removeLevel(idx)}
                        disabled={chain.length <= 1}
                        style={{ color: chain.length <= 1 ? '#d1d5db' : '#dc2626' }}
                      >
                        <i className="ri-delete-bin-line" />
                      </button>
                    </div>
                  </div>

                  <div className="text-muted mb-2" style={{ fontSize: 12 }}>Approver</div>

                  <div className="d-flex align-items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}>
                    <select
                      className="lts-input"
                      style={{ minWidth: 200 }}
                      value={level.approver_kind}
                      onChange={e => updateLevel(idx, {
                        approver_kind: e.target.value as ApprovalLevel['approver_kind'],
                        // Clear secondary fields when changing kind so stale
                        // values don't get persisted into a mismatched shape.
                        approver_role: null, approver_user_id: null, approver_employee_id: null,
                      })}
                    >
                      <option value="reporting_manager">Reporting Manager</option>
                      <option value="role">Role</option>
                      <option value="user">Specific User</option>
                      <option value="employee">Specific Employee</option>
                    </select>

                    {level.approver_kind === 'role' && (
                      <select
                        className="lts-input"
                        style={{ minWidth: 200 }}
                        value={level.approver_role ?? ''}
                        onChange={e => updateLevel(idx, { approver_role: e.target.value || null })}
                      >
                        <option value="">Pick a role…</option>
                        {ROLE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    )}

                    {level.approver_kind === 'user' && (
                      <EmployeePicker
                        value={chainPicked[idx] ?? (level.approver_user_id
                          ? { id: 0, user_id: level.approver_user_id, name: level.label || `User #${level.approver_user_id}`, emp_code: '' }
                          : null)}
                        placeholder="Search user…"
                        onChange={(picked) => {
                          setChainPicked(prev => ({ ...prev, [idx]: picked }));
                          updateLevel(idx, {
                            approver_user_id: picked?.user_id ?? null,
                            label: picked?.name ?? null,
                          });
                        }}
                      />
                    )}

                    {level.approver_kind === 'employee' && (
                      <EmployeePicker
                        value={chainPicked[idx] ?? (level.approver_employee_id
                          ? { id: level.approver_employee_id, name: level.label || `Employee #${level.approver_employee_id}`, emp_code: '' }
                          : null)}
                        placeholder="Search employee…"
                        onChange={(picked) => {
                          setChainPicked(prev => ({ ...prev, [idx]: picked }));
                          updateLevel(idx, {
                            approver_employee_id: picked?.id ?? null,
                            label: picked?.name ?? null,
                          });
                        }}
                      />
                    )}

                    <input
                      type="text"
                      className="lts-input"
                      placeholder="Display label (optional)"
                      style={{ flex: 1, minWidth: 160 }}
                      value={level.label ?? ''}
                      onChange={e => updateLevel(idx, { label: e.target.value || null })}
                    />
                  </div>

                  <div className="lts-assignee-row" style={{ marginTop: 6 }}>
                    <span
                      className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                      style={{ width: 28, height: 28, fontSize: 10, background: meta.fg }}
                    >{meta.initials}</span>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {level.approver_kind === 'reporting_manager' && 'Resolves to each requestor\'s reporting manager at submission time.'}
                      {level.approver_kind === 'role' && (level.approver_role
                        ? `Any user holding the ${ROLE_OPTIONS.find(r => r.value === level.approver_role)?.label ?? level.approver_role} role can approve.`
                        : 'Pick a role to gate this level.')}
                      {level.approver_kind === 'user' && (level.approver_user_id
                        ? `Only ${level.label || `user #${level.approver_user_id}`} can approve this level.`
                        : 'Search and pick the user who should act on this level.')}
                      {level.approver_kind === 'employee' && (level.approver_employee_id
                        ? `Only ${level.label || `employee #${level.approver_employee_id}`} can approve this level.`
                        : 'Search and pick the employee whose user account should approve.')}
                    </span>
                  </div>

                  {/* Skip-rule editor — auto-skip this level when the
                      request's day count matches the rule. The backend
                      evaluates skip_if at snapshot time so this level
                      gets status='Skipped' and never blocks the chain. */}
                  <SkipRuleEditor
                    rule={level.skip_if ?? null}
                    onChange={(next) => updateLevel(idx, { skip_if: next })}
                  />
                </div>
              );
            })}

            {chain.length > 1 && (
              <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                <i className="ri-information-line me-1" />
                Levels approve in order. The next level only sees the request after the previous one approves. Any rejection terminates the entire chain.
              </div>
            )}
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
// SkipRuleEditor — per-level "Skip this level when…" condition. Wires
// into the chain entry's skip_if blob; backend evaluates at submission
// time and marks the level Skipped right away.
// ─────────────────────────────────────────────────────────────────────────────
type SkipOp = '' | 'days_lt' | 'days_lte' | 'days_gt' | 'days_gte';
const SKIP_OP_LABELS: Record<SkipOp, string> = {
  '':         'No auto-skip',
  'days_lt':  'less than',
  'days_lte': 'at most',
  'days_gt':  'more than',
  'days_gte': 'at least',
};

function SkipRuleEditor({
  rule, onChange,
}: {
  rule: ApprovalLevel['skip_if'] | null;
  onChange: (next: ApprovalLevel['skip_if'] | null) => void;
}) {
  // Surface only the first defined op for the simple editor — multi-op
  // composites can be hand-edited via tinker for advanced cases.
  const activeOp: SkipOp = (() => {
    if (!rule) return '';
    if (rule.days_lt  != null) return 'days_lt';
    if (rule.days_lte != null) return 'days_lte';
    if (rule.days_gt  != null) return 'days_gt';
    if (rule.days_gte != null) return 'days_gte';
    return '';
  })();
  const activeValue: number | '' = activeOp ? (rule?.[activeOp] ?? '') : '';

  const setOp = (op: SkipOp) => {
    if (op === '') { onChange(null); return; }
    // Preserve the current value when toggling operators so user doesn't
    // re-type the threshold.
    const v = typeof activeValue === 'number' ? activeValue : 1;
    onChange({ [op]: v });
  };
  const setValue = (v: number) => {
    if (!activeOp) return;
    onChange({ [activeOp]: v });
  };

  return (
    <div className="lts-skip-rule" style={{
      marginTop: 8, padding: '8px 10px', background: '#fafafa',
      border: '1px dashed #d1d5db', borderRadius: 8,
    }}>
      <div className="d-flex align-items-center gap-2 flex-wrap">
        <span className="text-muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>
          AUTO-SKIP RULE
        </span>
        <select
          className="lts-input"
          style={{ minWidth: 150, padding: '4px 8px', fontSize: 12 }}
          value={activeOp}
          onChange={e => setOp(e.target.value as SkipOp)}
        >
          {(Object.keys(SKIP_OP_LABELS) as SkipOp[]).map(op => (
            <option key={op} value={op}>
              {op === '' ? SKIP_OP_LABELS[op] : `Days are ${SKIP_OP_LABELS[op]}…`}
            </option>
          ))}
        </select>
        {activeOp !== '' && (
          <>
            <input
              type="number"
              className="lts-input"
              style={{ width: 80, padding: '4px 8px', fontSize: 12 }}
              min={0}
              step={0.5}
              value={activeValue === '' ? '' : activeValue}
              onChange={e => setValue(Number(e.target.value))}
            />
            <span className="text-muted" style={{ fontSize: 11 }}>days</span>
          </>
        )}
      </div>
      {activeOp !== '' && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
          <i className="ri-information-line me-1" />
          When a request matches this rule, this level is auto-Skipped
          and the chain advances to the next level.
        </div>
      )}
    </div>
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

