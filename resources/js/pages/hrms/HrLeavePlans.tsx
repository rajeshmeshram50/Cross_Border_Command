import { useEffect, useMemo, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { MasterFormStyles, MasterSelect } from '../master/masterFormKit';
import '../../../css/recruitment.css';
import '../../../css/leave.css';
import '../employee-onboarding/HrEmployeeOnboarding.css';
import { leavePlansApi, leaveTypesApi, leaveBalancesApi, ApiLeavePlan, ApiLeaveType, ApiPlanEmployee, ApiLeaveBalancesResponse, ApiLeaveBalanceRow } from './leavePlansApi';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import Tooltip from '../../components/ui/Tooltip';
import { Shimmer } from '../../components/ui/Shimmer';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api from '../../api';

type CalendarStart = 'fixed_month' | 'joining_date';

interface LeaveTypeRow {
  id: string;
  name: string;
  color: string;
  quotaLabel: string;
  endOfYearLabel: string;
  configured: boolean;
}

interface LeavePlan {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  calendarStart: CalendarStart;
  startDate?: string;
  showSystemPolicy: boolean;
  customPolicyFile?: string;
  employees: PlanEmployee[];
  leaveTypes: LeaveTypeRow[];
  unlocked?: boolean;
}

interface AccrualConfig {
  unit: 'days';
  unlimited: boolean;
  yearlyQuota: number;
  mode: 'periodic' | 'attendance' | 'immediate';
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  dayOfMonth: number;
  variesEachMonth: boolean;
  // Attendance-based accrual: "For every <daysWorked> days worked, accrue
  // <daysAccrued> days of leave".
  attendanceDaysWorked: number;
  attendanceDaysAccrued: number;
  leaveExpires: { enabled: boolean; unit: 'day' | 'month' | 'year'; days: number };
  restrictByAttendance: boolean;
  noAccrualIfOnLeaveFor: { enabled: boolean; days: number };
  noAccrualIfBalanceExceeds: { enabled: boolean; days: number };
  noAccrualIfJoiningAfter: { enabled: boolean; day: number };
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
  managerCannotOverride: boolean;
  maxPerMonth: { enabled: boolean; days: number };
}

interface ApprovalLevel {
  approver_kind: 'reporting_manager' | 'role' | 'user' | 'employee';
  approver_role?: string | null;
  approver_user_id?: number | null;
  approver_employee_id?: number | null;
  label?: string | null;
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
    // 'immediate' is the only allocation mode the UI can express (see
    // AccrualSectionView) — the whole yearly quota is available from day one.
    mode: 'immediate', frequency: 'monthly', dayOfMonth: 1,
    variesEachMonth: false,
    attendanceDaysWorked: 0, attendanceDaysAccrued: 0,
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
    managerCannotOverride: false,
    maxPerMonth: { enabled: false, days: 0 },
  },
  approval: {
    required: true, approverRole: 'reporting_manager',
    autoApproveIfMissing: false, doNotEmailEveryRequest: false,
    // Approval is the reporting manager only — they approve or reject. HR is
    // view-only (can see every request but cannot act), so it is NOT part of
    // the acting chain.
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

function mergeWithDefaultConfig(raw: Partial<LeaveTypeConfig> | undefined | null): LeaveTypeConfig {
  const def = defaultLeaveTypeConfig();
  if (!raw || typeof raw !== 'object') return def;
  const accrual = { ...def.accrual, ...(raw.accrual ?? {}) };
  /* "Leave accrued periodically" and "Leave accrues based on attendance" were
     both removed from the setup UI (#102 / earlier). A plan saved under either
     mode is normalised to 'immediate' on load, so the section never renders
     with no option selected and re-saving clears the dead mode from the stored
     config. The whole yearly quota is available from day one either way. */
  if (accrual.mode !== 'immediate') accrual.mode = 'immediate';
  return {
    accrual,
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
    accent: tone.color,
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
    unlocked: !!api.unlocked,
  };
}

function frontendPlanToApi(p: Partial<LeavePlan>): Partial<ApiLeavePlan> {
  let from_month: string | null = null;
  let calendar_year: string | null = null;
  if (p.calendarStart === 'fixed_month' && p.startDate) {
    const d = new Date(p.startDate);
    if (!Number.isNaN(d.getTime())) {
      from_month = MONTH_NAMES[d.getMonth()] ?? null;
      calendar_year = String(d.getFullYear());
    } else {
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

type TopTab = 'plans' | 'types' | 'balances';

export default function HrLeavePlans() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const leavePerm = user?.permissions?.['hr.leave'];
  const canAdd    = isSuperAdmin || !!leavePerm?.can_add;
  const canEdit   = isSuperAdmin || !!leavePerm?.can_edit;
  const canDelete = isSuperAdmin || !!leavePerm?.can_delete;
  const [plans, setPlans] = useState<LeavePlan[]>([]);
  const [topTab, setTopTab] = useState<TopTab>('plans');
  const [activePlanId, setActivePlanId] = useState<string>('');
  const [planSearch, setPlanSearch] = useState('');
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [showAssignTypes, setShowAssignTypes] = useState(false);
  const [setupTypeId, setSetupTypeId] = useState<string | null>(null);
  const [typeConfigs, setTypeConfigs] = useState<Record<string, LeaveTypeConfig>>({});
  // Key (`planId::typeId`) of the Setup modal currently open. A background
  // loadPlans() re-seeds typeConfigs from the server; without preserving this
  // entry it would wipe the config the user is mid-way through editing, causing
  // an intermittent "glitch" where the setup form reset itself (bug #71).
  const activeSetupKeyRef = useRef<string | null>(null);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [viewingTypeId, setViewingTypeId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [catalog, setCatalog] = useState<CatalogType[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlans = useCallback(async () => {
    // Drive the body shimmer for the FULL reload lifecycle (list + per-plan
    // detail fetches) so every dataset refresh — including the one right after
    // creating a new plan — shows the skeleton until the data is ready, rather
    // than snapping in instantly.
    setLoading(true);
    try {
      const list = await leavePlansApi.list();
      const settled = await Promise.allSettled(list.map(p => leavePlansApi.show(p.id)));
      const detailed = settled.flatMap(s => s.status === 'fulfilled' ? [s.value] : []);
      const mapped = detailed.map(apiPlanToFrontend);
      setPlans(mapped);
      const seeded: Record<string, LeaveTypeConfig> = {};
      detailed.forEach(p => {
        (p.leave_types ?? []).forEach(t => {
          if (t.pivot?.config_json) {
            seeded[`${p.id}::${t.id}`] = mergeWithDefaultConfig(t.pivot.config_json as Partial<LeaveTypeConfig>);
          }
        });
      });
      // Preserve the config the user is actively editing in an open Setup modal
      // so this (often background) reload doesn't reset the form mid-edit (#71).
      setTypeConfigs(prev => {
        const key = activeSetupKeyRef.current;
        return key && prev[key] ? { ...seeded, [key]: prev[key] } : seeded;
      });
      setActivePlanId(curr => curr || mapped[0]?.id || '');
    } catch (err) {
      console.warn('[HrLeavePlans] failed to load plans', err);
    } finally {
      setLoading(false);
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

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.allSettled([loadPlans(), loadCatalog()]);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [loadPlans, loadCatalog]);

  const editingType = catalog.find(t => t.id === editingTypeId) ?? null;

  const onSaveLeaveType = async (t: Omit<CatalogType, 'id' | 'initials' | 'bg' | 'fg' | 'accent'>) => {
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
    const isEdit = !!editingTypeId;
    try {
      if (editingTypeId) {
        await leaveTypesApi.update(Number(editingTypeId), payload);
      } else {
        await leaveTypesApi.create(payload);
      }
      // Close instantly + toast; refresh the catalog in the BACKGROUND so the
      // modal doesn't sit blank for 2-3s while the (slow) re-fetch runs.
      setShowAddType(false);
      setEditingTypeId(null);
      toast.success(
        isEdit ? 'Leave type updated' : 'Leave type added',
        `"${t.name}" has been saved.`,
      );
      void loadCatalog();
      return null;
    } catch (err: any) {
      // 422 → return field errors so the form shows "already exists" inline
      // instead of silently closing.
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.response.data.errors as Record<string, string | string[]>)) {
          out[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        return out;
      }
      const msg = err?.response?.data?.message || err?.message || 'Please try again.';
      toast.error(isEdit ? 'Could not update leave type' : 'Could not add leave type', msg);
      return {};
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
    const ok = await confirmDialog({
      title: 'Delete leave type?',
      // No longer promises to strip the type out of its plans — a type that is
      // assigned to a plan, or referenced by leave requests, is refused
      // server-side (#108) and the reason comes back as a toast.
      message: <>Delete <strong>{row ? row.name : 'this leave type'}</strong>? This cannot be undone. A type that is assigned to a leave plan, or already used by leave requests, cannot be deleted.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    try {
      await leaveTypesApi.remove(Number(id));
      toast.success('Leave type deleted', `"${row ? row.name : 'Leave type'}" deleted successfully!`);
      await loadCatalog();
      await loadPlans();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Delete failed';
      toast.error('Delete failed', msg);
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
    setPlanMenuOpen(false);
    const plan = plans.find(p => p.id === activePlanId);
    const ok = await confirmDialog({
      title: 'Delete leave plan?',
      message: <>Delete <strong>{plan?.name || 'this plan'}</strong>? This cannot be undone.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    try {
      await leavePlansApi.remove(Number(activePlanId));
      const remaining = plans.filter(p => p.id !== activePlanId);
      setActivePlanId(remaining[0]?.id ?? '');
      toast.success('Leave plan deleted', 'Leave plan deleted successfully!');
      await loadPlans();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Delete failed';
      toast.error('Delete failed', msg);
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

  // Keep the "currently editing" key in sync with the open Setup modal so a
  // background reload can preserve that entry (bug #71). Uses the same key the
  // modal reads its config from.
  useEffect(() => {
    activeSetupKeyRef.current = setupTypeId && activePlan ? `${activePlan.id}::${setupTypeId}` : null;
  }, [setupTypeId, activePlan]);

  const isPlanLocked = (p?: LeavePlan | null): boolean =>
    !!p && !p.unlocked && p.leaveTypes.length > 0 && p.leaveTypes.every(t => t.configured);
  const activePlanLocked = isPlanLocked(activePlan);

  const onSavePlan = async (
    plan: Omit<LeavePlan, 'id' | 'employees' | 'leaveTypes'>,
  ): Promise<Record<string, string> | null> => {
    const isEdit = !!editingPlanId;
    try {
      if (editingPlanId) {
        await leavePlansApi.update(Number(editingPlanId), frontendPlanToApi(plan));
      } else {
        const created = await leavePlansApi.create(frontendPlanToApi(plan));
        setActivePlanId(String(created.id));
      }
      // Close instantly + toast; refresh the plan list in the BACKGROUND so the
      // modal doesn't sit blank for 2-3s while the (slow N+1) re-fetch runs.
      setShowAddPlan(false);
      setEditingPlanId(null);
      toast.success(
        isEdit ? 'Leave plan updated' : 'Leave plan created',
        `"${plan.name}" has been saved.`,
      );
      void loadPlans();
      return null;
    } catch (err: any) {
      // 422 → hand the field errors back so the form shows them inline
      // (e.g. a duplicate plan name highlights the Name field).
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.response.data.errors as Record<string, string | string[]>)) {
          const key = k === 'plan_name' ? 'name' : k;
          out[key] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        return out;
      }
      toast.error('Save failed', err?.response?.data?.message || err?.message || 'Save failed');
      return {};
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
          {/* Match the Leave Management layout: the shared header strip sits
              flat on the page (like every other HR page), and only the tabs +
              body content live inside the bordered .lp-shell card below it.
              Nesting the header inside .lp-shell produced a card-in-card look
              with inconsistent header/content spacing (bug #84). */}
          <div className="rec-page lplan-page">
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-calendar-2-line" /></div>
                <div className="min-w-0">
                  <div className="frm-cstrip-title">Leave Plans</div>
                  <div className="frm-cstrip-sub">Configure leave policies for employee groups</div>
                </div>
              </div>
              <button type="button" className="frm-cstrip-back" onClick={() => navigate('/hr/leave')}>
                <i className="ri-arrow-left-line" />
                Back
              </button>
            </div>

            <div className="lp-shell">
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
              {topTab === 'plans' && canAdd && (
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => setShowAddPlan(true)}
                >
                  <i className="ri-add-line" />Add Leave Plan
                </button>
              )}
              {topTab === 'types' && canAdd && (
                <button
                  type="button"
                  className="rec-btn-primary"
                  onClick={() => setShowAddType(true)}
                >
                  <i className="ri-add-line" />Add Leave Type
                </button>
              )}
            </div>

            {loading ? (
              <LeavePlansBodyShimmer />
            ) : topTab === 'plans' ? (
              <div className="lp-body">
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
                  {canAdd && (
                    <button
                      type="button"
                      className="lp-new-plan-btn"
                      onClick={() => setShowAddPlan(true)}
                    >
                      {/* Same label as the header button it duplicates, and the
                          same "Add <thing>" form as Add Leave Type — one action
                          should not have two names. */}
                      <i className="ri-add-line" />Add Leave Plan
                    </button>
                  )}
                </aside>

                <main className="lp-main">
                  {!activePlan ? (
                    <div className="text-muted text-center py-5">No plans yet. Click "+ Add Leave Plan" to create one.</div>
                  ) : (
                    <>
                      <div className="lp-main-head">
                        <div className="min-w-0">
                          <h5 className="fw-bold mb-1 d-flex align-items-center gap-2">
                            {activePlan.name}
                            {activePlanLocked && (
                              <span
                                className="badge d-inline-flex align-items-center gap-1"
                                style={{ background: '#eef2f6', color: '#475569', fontWeight: 600 }}
                                title="This plan is fully set up and locked. Clone it to make changes."
                              >
                                <i className="ri-lock-2-line" /> Locked
                              </span>
                            )}
                          </h5>
                          <div className="text-muted fs-13 d-flex align-items-center gap-1">
                            <i className="ri-calendar-line" />
                            Apr – Mar
                          </div>
                        </div>
                        {(canEdit || canDelete || canAdd) && (
                        <Dropdown isOpen={planMenuOpen} toggle={() => setPlanMenuOpen(o => !o)}>
                          <DropdownToggle tag="button" type="button" className="lp-icon-btn" aria-label="More options">
                            <i className="ri-more-2-fill" />
                          </DropdownToggle>
                          <DropdownMenu end className="lp-plan-menu">
                            {canEdit && !activePlanLocked && (
                            <DropdownItem onClick={onEditPlan}>
                              <i className="ri-pencil-line me-2" />Edit
                            </DropdownItem>
                            )}
                            {canDelete && (
                            <DropdownItem onClick={onDeletePlan} disabled={activePlan.isDefault}>
                              <i className="ri-delete-bin-line me-2" />Delete Plan
                            </DropdownItem>
                            )}
                            {canEdit && (
                            <DropdownItem onClick={onMakeDefault} disabled={activePlan.isDefault}>
                              <i className="ri-star-line me-2" />Make as Default
                            </DropdownItem>
                            )}
                            {canAdd && (
                            <DropdownItem onClick={onClonePlan}>
                              <i className="ri-file-copy-line me-2" />Clone Leave Plan
                            </DropdownItem>
                            )}
                          </DropdownMenu>
                        </Dropdown>
                        )}
                      </div>

                      <div className="lp-sub-tabs">
                        <span className="lp-sub-tab is-active">Configuration</span>
                      </div>

                      <ConfigurationTab
                        plan={activePlan}
                        locked={activePlanLocked}
                        onAssignTypes={() => setShowAssignTypes(true)}
                        onSetupType={(typeId) => setSetupTypeId(typeId)}
                        onShowGuide={() => setShowGuide(true)}
                        canEdit={canEdit}
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
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ) : (
              <LeaveBalancesTab />
            )}
            </div>
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
        readOnly={activePlanLocked}
        leaveType={activePlan?.leaveTypes.find(t => t.id === setupTypeId) ?? null}
        config={
          setupTypeId && activePlan
            ? typeConfigs[`${activePlan.id}::${setupTypeId}`] ?? defaultLeaveTypeConfig()
            : defaultLeaveTypeConfig()
        }
        onClose={() => setSetupTypeId(null)}
        onChange={(next) => {
          // Update the working draft only. Persistence happens on Save & Next /
          // Save & Close (see onSave) so the footer button can show a spinner
          // and prevent duplicate submissions.
          if (!setupTypeId || !activePlan) return;
          setTypeConfigs(prev => ({
            ...prev,
            [`${activePlan.id}::${setupTypeId}`]: next,
          }));
        }}
        onSave={async (finalize) => {
          if (!setupTypeId || !activePlan) return;
          const next = typeConfigs[`${activePlan.id}::${setupTypeId}`] ?? defaultLeaveTypeConfig();
          // Reject out-of-range quota / carry-forward before hitting the server
          // (bug #64) — days within a year, so 0..365. Throwing keeps the modal
          // open with the spinner off (goNext catches it).
          if (!next.accrual.unlimited) {
            const q = Number(next.accrual.yearlyQuota);
            if (!Number.isFinite(q) || q < 0 || q > 365) {
              toast.error('Invalid leave quota', 'Yearly quota must be between 0 and 365 days.');
              throw new Error('invalid-quota');
            }
            // Attendance-based accrual threshold — "for every X days worked in
            // a month" must be 1..31 (bug #65). Only checked when that mode is
            // selected, since the field is hidden/irrelevant otherwise.
            if (next.accrual.mode === 'attendance') {
              const d = Number(next.accrual.attendanceDaysWorked);
              if (!Number.isFinite(d) || d < 1 || d > 31) {
                toast.error('Invalid attendance threshold', 'Days worked in a month must be between 1 and 31.');
                throw new Error('invalid-attendance-days');
              }
            }
            // Extra leave (overdraft) — days beyond balance an employee may take,
            // 1..365 (bug #72). Only enforced when the option is enabled.
            if (next.accrual.employeeOverdraft?.enabled) {
              const od = Number(next.accrual.employeeOverdraft.days);
              if (!Number.isFinite(od) || od < 1 || od > 365) {
                toast.error('Invalid extra leave', 'Extra leave must be between 1 and 365 days.');
                throw new Error('invalid-overdraft');
              }
            }
          }
          const cap = Number(next.yearEnd.carryForwardCap);
          if (Number.isFinite(cap) && (cap < 0 || cap > 365)) {
            toast.error('Invalid carry-forward cap', 'Carry-forward cap must be between 0 and 365 days.');
            throw new Error('invalid-carryforward');
          }
          const quotaLabel = next.accrual.unlimited ? 'Unlimited' : `${next.accrual.yearlyQuota} ${next.accrual.unit}/year`;
          const eoyLabel =
            next.yearEnd.carryForward === 'reset'   ? 'Reset to zero'
            : next.yearEnd.carryForward === 'carry_all' ? 'Carry all forward'
            : `Carry up to ${next.yearEnd.carryForwardCap || 0}`;
          try {
            await leavePlansApi.saveTypeConfig(Number(activePlan.id), Number(setupTypeId), next as any, quotaLabel, eoyLabel, finalize);
          } catch (err: any) {
            toast.error('Could not save configuration', err?.response?.data?.message || err?.message || 'Please try again.');
            throw err; // keep the modal open + spinner off
          }
          // Reflect the saved setup in the Configuration table. The type only
          // counts as "configured" once the wizard is finalized (Save & Close) —
          // matching the backend is_setup flag — so intermediate section saves
          // just refresh the labels without flipping the status / locking (#63).
          setPlans(prev => prev.map(p => {
            if (p.id !== activePlan.id) return p;
            const leaveTypes = p.leaveTypes.map(t =>
              t.id === setupTypeId
                ? { ...t, configured: finalize ? true : t.configured, quotaLabel, endOfYearLabel: eoyLabel }
                : t
            );
            // Mirror the backend: when this save leaves every assigned type
            // configured, a cloned plan's editable-draft override is cleared so
            // the plan locks (Setup buttons → "Locked"). Bug #61.
            const allConfigured = leaveTypes.length > 0 && leaveTypes.every(t => t.configured);
            return { ...p, leaveTypes, unlocked: allConfigured ? false : p.unlocked };
          }));
        }}
      />

      <ViewLeaveTypeModal
        isOpen={!!viewingTypeId}
        leaveType={catalog.find(c => c.id === viewingTypeId) ?? null}
        onClose={() => setViewingTypeId(null)}
        onEdit={(id) => { setViewingTypeId(null); onEditLeaveType(id); }}
        canEdit={canEdit}
      />

      <GuidanceModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
      />
    </>
  );
}

function ConfigurationTab({
  plan, locked, onAssignTypes, onSetupType, onShowGuide, canEdit,
}: {
  plan: LeavePlan;
  locked: boolean;
  onAssignTypes: () => void;
  onSetupType: (typeId: string) => void;
  onShowGuide: () => void;
  canEdit: boolean;
}) {
  return (
    <div className="lp-config">
      <div className="lp-config-actions">
        {canEdit && !locked && (
        <button type="button" className="rec-btn-primary" onClick={onAssignTypes}>
          <i className="ri-add-line" />Assign Leave Type
        </button>
        )}
        {locked && (
        <span
          className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded"
          style={{ background: '#eef2f6', color: '#475569', fontSize: 12.5, fontWeight: 600 }}
        >
          <i className="ri-lock-2-line" /> This plan is fully set up — view only. Clone it to make changes.
        </span>
        )}
        <span className="lp-help-chip">
          <i className="ri-information-line" />
          Need help configuring?{' '}
          <button
            type="button"
            onClick={onShowGuide}
            className="lp-banner-link"
            style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', fontWeight: 600, cursor: 'pointer' }}
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
                  <div className="text-muted fs-13 mt-1">Click <strong>+ Assign Leave Type</strong> to configure leave categories for this plan.</div>
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
                    {!t.configured && <i className="ri-error-warning-line" />}
                    {t.quotaLabel}
                  </span>
                </td>
                <td>
                  <span className={t.configured ? 'lp-status-ok' : 'lp-status-todo'}>
                    {!t.configured && <i className="ri-error-warning-line" />}
                    {t.endOfYearLabel}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {locked
                    ? (
                      <span className="d-inline-flex align-items-center gap-2">
                        <span className="text-muted fs-13 d-inline-flex align-items-center gap-1"><i className="ri-lock-2-line" /> Locked</span>
                        {/* Locked plans are view-only, but users must still be
                            able to review the saved configuration (bug #67). */}
                        <button type="button" className="lp-setup-btn" onClick={() => onSetupType(t.id)}>
                          <i className="ri-eye-line" /> View
                        </button>
                      </span>
                    )
                    : canEdit
                      ? <button type="button" className="lp-setup-btn" onClick={() => onSetupType(t.id)}>Setup</button>
                      : <span className="text-muted fs-13">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type CatalogType = {
  id: string;
  name: string;
  type: string;
  isPaid: 'Paid' | 'Unpaid';
  code: string;
  initials: string;
  bg: string;
  fg: string;
  accent: string;
  group: 'regular' | 'incidental';
};

function LeaveTypesTab({
  catalog, onView, onEdit, onDelete, onShowGuide, canEdit, canDelete,
}: {
  catalog: CatalogType[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowGuide: () => void;
  canEdit: boolean;
  canDelete: boolean;
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
          className="lp-banner-link"
          style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', fontWeight: 600, cursor: 'pointer' }}
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
            {regular.map(t => <CatalogRow key={t.id} t={t} onView={onView} onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} canDelete={canDelete} />)}
            {incidental.length > 0 && (
              <tr className="lp-group-row">
                <td colSpan={5}>STATUTORY / INCIDENTAL</td>
              </tr>
            )}
            {incidental.map(t => <CatalogRow key={t.id} t={t} onView={onView} onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} canDelete={canDelete} />)}
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
  t, onView, onEdit, onDelete, canEdit, canDelete,
}: {
  t: CatalogType;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <tr>
      <td>
        <div className="d-flex align-items-center gap-2">
          <span className="lp-code-pill" style={{ ['--pill-bg' as string]: t.bg, ['--pill-fg' as string]: t.fg, ['--pill-accent' as string]: t.accent } as CSSProperties}>{t.initials}</span>
          <span className="fw-semibold fs-13">{t.name}</span>
        </div>
      </td>
      <td className="fs-13 text-muted">{t.type}</td>
      <td>
        <span className={`rec-pill lp-pay-pill ${t.isPaid === 'Paid' ? 'is-paid' : 'is-unpaid'}`}>
          {t.isPaid}
        </span>
      </td>
      <td>
        <span className="lp-code-pill" style={{ ['--pill-bg' as string]: t.bg, ['--pill-fg' as string]: t.fg, ['--pill-accent' as string]: t.accent } as CSSProperties}>{t.code}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className="d-flex justify-content-end gap-1">
          <Tooltip label="View details">
            <button type="button" className="lp-row-action" aria-label="View" onClick={() => onView(t.id)}>
              <i className="ri-eye-line" />
            </button>
          </Tooltip>
          {canEdit && (
          <Tooltip label="Edit leave type">
            <button type="button" className="lp-row-action" aria-label="Edit" onClick={() => onEdit(t.id)}>
              <i className="ri-pencil-line" />
            </button>
          </Tooltip>
          )}
          {canDelete && (
          <Tooltip label="Delete leave type">
            <button
              type="button"
              className="lp-row-action"
              aria-label="Delete"
              onClick={() => onDelete(t.id)}
              style={{ color: '#dc2626' }}
            >
              <i className="ri-delete-bin-line" />
            </button>
          </Tooltip>
          )}
        </div>
      </td>
    </tr>
  );
}

function LeaveBalancesTab() {
  const [data, setData] = useState<ApiLeaveBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // DataTable owns the search input and debounces it before calling back, so
  // this value is already settled — no second debounce of our own.
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('All');
  const [location, setLocation] = useState('All');

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await leaveBalancesApi.fetch({
        location: location === 'All' ? undefined : location,
        search: search.trim() || undefined,
      });
      setData(resp);
    } catch (err) {
      console.warn('[LeaveBalancesTab] fetch failed', err);
      setData({ columns: [], employees: [], filters: { departments: [], locations: [] } });
    } finally {
      setLoading(false);
    }
  }, [location, search]);

  useEffect(() => { refetch(); }, [refetch]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = department === 'All'
      ? data.employees
      : data.employees.filter(e => e.department === department);
    // Always display in a stable sequence by Employee ID (bug #10).
    return [...rows].sort((a, b) => a.id - b.id);
  }, [data, department]);

  const accentFor = (id: number) => {
    const palette = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
    return palette[id % palette.length];
  };
  const initialsOf = (name: string) =>
    name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

  const DEPT_OPTS = [{ value: 'All', label: 'Department' }, ...(data?.filters.departments ?? []).map(v => ({ value: v, label: v }))];
  const LOC_OPTS  = [{ value: 'All', label: 'Location'   }, ...(data?.filters.locations   ?? []).map(v => ({ value: v, label: v }))];

  /* Fixed identity columns + one per leave type. The type columns are
     data-driven, so the list is rebuilt whenever the server's column set
     changes. Each balance cell is looked up BY leave_type_id rather than by
     position — `balances` is parallel to `columns` today, but keying on the id
     means a row that is short an entry renders a dash instead of shifting every
     later column one place left. */
  const balanceColumns = useMemo<DataTableColumn<ApiLeaveBalanceRow>[]>(() => {
    const cols: DataTableColumn<ApiLeaveBalanceRow>[] = [
      {
        id: 'name',
        header: 'Employee Name',
        accessorFn: r => r.name,
        meta: { width: 240, wrap: true },
        cell: info => {
          const e = info.row.original;
          const accent = accentFor(e.id);
          return (
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
          );
        },
      },
      {
        id: 'emp_code',
        header: 'Emp No.',
        accessorFn: r => r.emp_code,
        meta: { width: 110 },
        cell: info => <span className="lp-emp-link fs-13">{info.getValue()}</span>,
      },
      {
        id: 'location',
        header: 'Location',
        accessorFn: r => r.location ?? '',
        meta: { width: 140 },
        cell: info => {
          const v = String(info.getValue() ?? '');
          return v
            ? <span className="fs-13 text-muted"><i className="ri-map-pin-line me-1" />{v}</span>
            : <span className="text-muted">—</span>;
        },
      },
    ];

    for (const c of data?.columns ?? []) {
      cols.push({
        id: `lt_${c.leave_type_id}`,
        header: c.name,
        /* Sort on consumption ratio, so "who has burned the most of this leave
           type" is one header click. Rows the type doesn't apply to sort last
           (-1); unlimited never has a ratio, so it sorts last too. */
        accessorFn: r => {
          const b = r.balances.find(x => x.leave_type_id === c.leave_type_id);
          if (!b || !b.applies || b.unlimited || !b.quota) return -1;
          return b.used / b.quota;
        },
        meta: { width: 170 },
        cell: info => {
          const b = info.row.original.balances.find(x => x.leave_type_id === c.leave_type_id);
          if (!b || !b.applies) return <span className="text-muted">—</span>;
          if (b.unlimited) {
            return (
              <span className="rec-pill" style={{ background: '#d1fae5', color: '#065f46', fontSize: 10.5 }}>
                <i className="ri-infinity-line me-1" />Unlimited
              </span>
            );
          }
          if (b.quota === 0) return <span className="text-muted">Not Setup</span>;
          const pct = Math.min(100, Math.round((b.used / b.quota) * 100));
          const tone = pct >= 100 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#7c5cfc';
          return (
            <div className="lp-balance-cell">
              <div className="d-flex align-items-center justify-content-between">
                <span className="fw-semibold fs-13">{b.used}/{b.quota}</span>
                <span className="text-muted" style={{ fontSize: 10.5 }}>{pct}%</span>
              </div>
              <span className="lp-balance-track">
                <span className="lp-balance-fill" style={{ width: `${pct}%`, background: tone }} />
              </span>
            </div>
          );
        },
      });
    }
    return cols;
  }, [data?.columns]);

  const balancesToolbarActions = (
    <>
      <div style={{ minWidth: 150 }}>
        <MasterSelect value={department} onChange={setDepartment} options={DEPT_OPTS} placeholder="Department" />
      </div>
      <div style={{ minWidth: 140 }}>
        <MasterSelect value={location} onChange={setLocation} options={LOC_OPTS} placeholder="Location" />
      </div>
      <button type="button" className="lp-icon-btn" aria-label="Refresh" onClick={refetch} title="Refresh">
        <i className="ri-refresh-line" />
      </button>
    </>
  );

  return (
    <div className="lp-balances-pane">
      <div className="lp-types-head">
        <h6 className="mb-1 fw-bold">Leave Balances</h6>
        <div className="text-muted fs-13">View and configure leave balances of all employees</div>
      </div>

      {/* Shared list table — search box, sortable headers, rows-per-page pager
          and card chrome all come from the component, so this list looks and
          behaves like every other list in the app. Search stays SERVER-side:
          passing onSearchChange puts DataTable in controlled mode, which
          disables its own client-side global filter (see DataTable), so the
          rows are filtered once, by the API. */}
      <DataTable<ApiLeaveBalanceRow>
        data={filteredRows}
        columns={balanceColumns}
        serial={{ header: 'Sr. No.' }}
        accent="violet"
        /* Stretches the card to the viewport so a short list doesn't
           collapse into a strip above an empty page — paired with
           autoFitRows, which then fills that height with rows. */
        fitToViewport
        autoFitRows
        /* 3 identity columns + a variable number of leave-type columns; below
           this the wrapper scrolls sideways rather than crushing the bars. */
        /* Base drops with the fixed columns the CSS hides below (see
           .lplan-page in recruitment.css), so the table stops reserving width
           for columns that are no longer on screen. The per-leave-type part
           stays: those balances ARE the table, and scrolling to reach one beats
           hiding it. */
        minWidth={(window.innerWidth <= 900 ? 400 : window.innerWidth <= 1200 ? 560 : 720)
          + (data?.columns.length ?? 0) * 170}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employees…"
        toolbarActions={balancesToolbarActions}
        emptyMessage={
          <>
            <i className="ri-team-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            {data && data.employees.length === 0
              ? 'No employees are assigned to a leave plan yet.'
              : 'No employees match your filters'}
          </>
        }
      />
    </div>
  );
}

function LeavePlansBodyShimmer() {
  const card: CSSProperties = { border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '10px 12px' };
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <aside style={{ width: 280, flexShrink: 0 }}>
        <Shimmer height={36} radius={10} style={{ marginBottom: 14 }} />
        <Shimmer height={10} width={90} style={{ marginBottom: 12 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ ...card, marginBottom: 8 }}>
            <Shimmer height={13} width="70%" style={{ marginBottom: 8 }} />
            <Shimmer height={10} width="40%" />
          </div>
        ))}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Shimmer width={44} height={44} radius={12} />
          <div style={{ flex: 1 }}>
            <Shimmer height={16} width={180} style={{ marginBottom: 8 }} />
            <Shimmer height={11} width={120} />
          </div>
          <Shimmer width={130} height={36} radius={10} />
        </div>
        <Shimmer height={40} radius={8} style={{ marginBottom: 14 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>
            <Shimmer width={32} height={32} radius={8} />
            <div style={{ flex: 1 }}><Shimmer height={13} width="50%" /></div>
            <Shimmer width={80} height={20} radius={999} />
            <Shimmer width={60} height={20} radius={999} />
          </div>
        ))}
      </section>
    </div>
  );
}

function ViewLeaveTypeModal({
  isOpen, leaveType, onClose, onEdit, canEdit,
}: {
  isOpen: boolean;
  leaveType: CatalogType | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  canEdit: boolean;
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
            <span className="lp-code-pill" style={{ ['--pill-bg' as string]: t.bg, ['--pill-fg' as string]: t.fg, ['--pill-accent' as string]: t.accent, fontSize: 13, padding: '4px 10px' } as CSSProperties}>{t.initials}</span>
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
              <span className={`rec-pill lp-pay-pill ${t.isPaid === 'Paid' ? 'is-paid' : 'is-unpaid'}`}>
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
            {canEdit && (
            <button type="button" className="rec-btn-primary" onClick={() => onEdit(t.id)}>
              <i className="ri-pencil-line" />Edit
            </button>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

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
                Inside a plan, click <strong>+ Assign Leave Type</strong> to attach types from your catalog. Then click <strong>Setup</strong> on each row to configure quota, accrual, application rules, approval chain, year-end behaviour, probation rules and notice-period handling.
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

function AddLeavePlanModal({
  isOpen, editing, onClose, onSave,
}: {
  isOpen: boolean;
  editing: LeavePlan | null;
  onClose: () => void;
  onSave: (plan: Omit<LeavePlan, 'id' | 'employees' | 'leaveTypes'>) => Promise<Record<string, string> | null | void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [calendarStart, setCalendarStart] = useState<CalendarStart>('joining_date');
  const [showSystemPolicy, setShowSystemPolicy] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const clearErr = (k: string) => setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const reset = () => {
    setName(''); setDescription(''); setShowDescription(false);
    setCalendarStart('joining_date');
    setShowSystemPolicy(true); setIsDefault(false);
    setErrors({}); setSaving(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    setErrors({}); setSaving(false);
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? '');
      setShowDescription(!!editing.description);
      setCalendarStart(editing.calendarStart);
      setShowSystemPolicy(editing.showSystemPolicy);
      setIsDefault(!!editing.isDefault);
    } else {
      reset();
    }
  }, [isOpen, editing]);

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Leave plan name is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    const serverErrs = await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      calendarStart,
      startDate: undefined,
      showSystemPolicy,
      isDefault,
    });
    setSaving(false);
    if (serverErrs && Object.keys(serverErrs).length) { setErrors(serverErrs); return; }
    reset();
  };

  /* While the save is in flight the whole popup is frozen (#107): the fields
     below sit in a disabled <fieldset>, and closing is refused here so neither
     the X, Cancel, ESC nor the backdrop can abandon a request that is already
     on its way to the server — reopening would then show a stale form while
     the plan quietly got created. Mirrors the read-only fieldset used by the
     leave-type Setup wizard. */
  const handleClose = () => { if (saving) return; reset(); onClose(); };

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      size="lg"
      backdrop="static"
      keyboard={!saving}
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
              disabled={saving}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
              style={saving ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* A disabled <fieldset> neutralises every native control inside it in
            one go; pointer-events covers anything non-native, and the dimming
            makes the frozen state visible rather than merely unresponsive. */}
        <fieldset
          disabled={saving}
          style={{
            border: 0, padding: 0, margin: 0, minInlineSize: 'auto',
            ...(saving ? { pointerEvents: 'none', opacity: 0.6 } : {}),
          }}
        >
        <div className="rec-form-body">
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
                  className={`rec-input${errors.name ? ' is-invalid' : ''}`}
                  placeholder="e.g. Leave plan for Executives"
                  value={name}
                  onChange={e => { setName(e.target.value); clearErr('name'); }}
                />
                {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
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

        </div>
        </fieldset>

        <div className="rec-form-footer">
          <span className="hint" />
          <div className="d-flex gap-2">
            {/* Cancel sits OUTSIDE the fieldset (so it can stay reachable when
                nothing is in flight) and is disabled explicitly during a save. */}
            <button type="button" className="rec-btn-ghost" onClick={handleClose} disabled={saving}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              <i className={saving ? 'ri-loader-4-line' : (editing ? 'ri-save-line' : 'ri-save-3-line')} style={saving ? { animation: 'spin 1s linear infinite' } : undefined} />
              {saving ? (editing ? 'Updating…' : 'Saving…') : (editing ? 'Update Plan' : 'Save Plan')}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

function AddLeaveTypeModal({
  isOpen, editing, onClose, onSave,
}: {
  isOpen: boolean;
  editing: CatalogType | null;
  onClose: () => void;
  onSave: (t: Omit<CatalogType, 'id' | 'initials' | 'bg' | 'fg' | 'accent'>) => Promise<Record<string, string> | null | void>;
}) {
  const [name, setName]   = useState('');
  const [type, setType]   = useState<string>('Regular');
  const [isPaid, setIsPaid] = useState<'Paid' | 'Unpaid'>('Paid');
  const [code, setCode]   = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const clearErr = (k: string) => setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  useEffect(() => {
    if (!isOpen) return;
    setErrors({}); setSaving(false);
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setIsPaid(editing.isPaid);
      setCode(editing.code);
    } else {
      setName(''); setType('Regular'); setIsPaid('Paid'); setCode('');
    }
  }, [isOpen, editing]);

  const reset = () => { setName(''); setType('Regular'); setIsPaid('Paid'); setCode(''); setErrors({}); setSaving(false); };
  /* Frozen while the save/update is in flight (#106) — same rule as the Add
     Leave Plan popup: closing is refused so neither the X, Cancel, ESC nor the
     backdrop can abandon a request already on its way to the server. */
  const handleClose = () => { if (saving) return; reset(); onClose(); };

  // 'Unpaid' is intentionally NOT a category — Paid/Unpaid is set by the
  // Compensation section below, so it would be a redundant/contradictory choice.
  const TYPE_OPTIONS = ['Regular', 'Compensatory offs', 'Incident based'];
  const group: CatalogType['group'] = type === 'Incident based' ? 'incidental' : 'regular';

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Leave type name is required';
    // Reject names made of / containing special characters — must hold at least
    // one letter and stay within a conservative name charset. Mirrors the
    // backend `leave_type.name` pattern so the two layers agree.
    else if (!/^(?=.*[A-Za-z])[A-Za-z0-9 .,\-&()'/]+$/.test(name.trim()))
      errs.name = "Leave Type Name cannot contain special characters (only letters, numbers, spaces and . , - & ( ) / ' are allowed)";
    if (!code.trim()) errs.short_code = 'Code is required';
    else if (!/^[A-Z0-9]+$/.test(code.trim().toUpperCase())) errs.short_code = 'Only letters and numbers are allowed (no spaces or special characters)';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    const serverErrs = await onSave({
      name: name.trim(),
      type,
      isPaid: type === 'Unpaid' ? 'Unpaid' : isPaid,
      code: code.trim().toUpperCase(),
      group,
    });
    setSaving(false);
    if (serverErrs && Object.keys(serverErrs).length) { setErrors(serverErrs); return; }
    reset();
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      size="lg"
      backdrop="static"
      keyboard={!saving}
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
              disabled={saving}
              aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center"
              style={saving ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </div>
        </div>

        {/* A disabled <fieldset> neutralises every native control inside it in
            one go; pointer-events covers anything non-native, and the dimming
            makes the frozen state visible rather than merely unresponsive. */}
        <fieldset
          disabled={saving}
          style={{
            border: 0, padding: 0, margin: 0, minInlineSize: 'auto',
            ...(saving ? { pointerEvents: 'none', opacity: 0.6 } : {}),
          }}
        >
        <div className="rec-form-body">
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
                  className={`rec-input${errors.name ? ' is-invalid' : ''}`}
                  placeholder="e.g. Bereavement Leave"
                  value={name}
                  onChange={e => { setName(e.target.value); clearErr('name'); }}
                />
                {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
              </Col>
              <Col md={5}>
                <label className="rec-form-label">Code<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.short_code ? ' is-invalid' : ''}`}
                  placeholder="e.g. BL"
                  maxLength={4}
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); clearErr('short_code'); }}
                  style={{ textTransform: 'uppercase' }}
                />
                {errors.short_code && <div className="rec-error"><i className="ri-error-warning-line" />{errors.short_code}</div>}
              </Col>
              <Col md={12}>
                <label className="rec-form-label">Type Category</label>
                <MasterSelect
                  value={type}
                  onChange={setType}
                  options={TYPE_OPTIONS.map(o => ({ value: o, label: o }))}
                  placeholder="Select category"
                />
              </Col>
            </Row>
          </div>

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
        </fieldset>

        <div className="rec-form-footer">
          <span className="hint" />
          <div className="d-flex gap-2">
            {/* Cancel sits OUTSIDE the fieldset (so it stays reachable when
                nothing is in flight) and is disabled explicitly during a save. */}
            <button type="button" className="rec-btn-ghost" onClick={handleClose} disabled={saving}>Cancel</button>
            <button
              type="button"
              className="rec-btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              <i className={saving ? 'ri-loader-4-line' : (editing ? 'ri-save-line' : 'ri-add-line')} style={saving ? { animation: 'spin 1s linear infinite' } : undefined} />
              {saving ? (editing ? 'Updating…' : 'Saving…') : (editing ? 'Update Leave Type' : 'Save Leave Type')}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

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
  onSave: (types: LeaveTypeRow[]) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const visibleSelectedCount = selected.size;
  useEffect(() => { if (isOpen) setSaving(false); }, [isOpen]);

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
    if (existingTypeIds.has(id)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (saving || selected.size === 0) return;
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
    setSaving(true);
    try {
      await onSave(rows);
      setSelected(new Set());
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { setSelected(new Set()); setSaving(false); onClose(); };

  const grouped = (cat: AssignableType['category']) =>
    assignableTypes.filter(t => t.category === cat);

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
                        style={{ ['--alt-accent' as string]: meta.color } as CSSProperties}
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
                        <Tooltip label={t.description || `${meta.label} · ${t.name}`} position="left" maxWidth={240}>
                          <i
                            className="ri-information-line alt-info-icon"
                            aria-label={t.description || t.name}
                          />
                        </Tooltip>
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
              disabled={visibleSelectedCount === 0 || saving}
            >
              <i className={saving ? 'ri-loader-4-line' : 'ri-save-3-line'} style={saving ? { animation: 'spin 1s linear infinite' } : undefined} />
              {saving ? 'Saving…' : `Save (${visibleSelectedCount})`}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

type SetupSection = 'accrual' | 'leaveApp' | 'approval' | 'yearEnd' | 'probation' | 'noticePeriod';

const SETUP_SECTIONS: { key: SetupSection; label: string; icon: string; tone: string }[] = [
  { key: 'accrual',      label: 'Accrual',           icon: 'ri-time-line',           tone: '#7c5cfc' },
  { key: 'leaveApp',     label: 'Leave Application', icon: 'ri-file-list-3-line',    tone: '#0ea5e9' },
  { key: 'approval',     label: 'Approval',          icon: 'ri-checkbox-circle-line',tone: '#16a34a' },
];

function LeaveTypeSetupModal({
  isOpen, leaveType, config, onClose, onChange, onSave, readOnly,
}: {
  isOpen: boolean;
  leaveType: LeaveTypeRow | null;
  config: LeaveTypeConfig;
  onClose: () => void;
  onChange: (next: LeaveTypeConfig) => void;
  /** Persist the current config. `finalize` is true only for the wizard's last
   *  section (Save & Close) so is_setup is flipped once, not on every section.
   *  Resolves on success; rejects on failure so the modal keeps the spinner off
   *  and stays open. */
  onSave?: (finalize: boolean) => Promise<void>;
  /** View-only mode for locked plans — every input is disabled and the Save
   *  actions are replaced by a Close button, so users can review a locked
   *  plan's configuration without editing it (bug #67). Section navigation
   *  still works. */
  readOnly?: boolean;
}) {
  const [active, setActive] = useState<SetupSection>('accrual');
  const [saving, setSaving] = useState(false);
  /* Always open on the FIRST section (#103 / #105).
     useState's initial value only applies on MOUNT, and this component is never
     unmounted between opens — the `if (!leaveType) return null` below is an
     early return, not an unmount, so `active` survived from last time. After a
     full Save & Close the wizard ends on Approval, so the next Setup (a
     different leave type, or a read-only View) opened straight onto Approval
     and skipped the first two steps.

     Keyed on the leave type as well as `isOpen`, so switching types without
     closing the modal also rewinds to the start. */
  useEffect(() => {
    if (isOpen) setActive(SETUP_SECTIONS[0].key);
  }, [isOpen, leaveType?.id]);
  const sectionIndex = SETUP_SECTIONS.findIndex(s => s.key === active);
  const sectionMeta = SETUP_SECTIONS[sectionIndex] ?? SETUP_SECTIONS[0];

  const updateAccrual      = (patch: Partial<AccrualConfig>)      => onChange({ ...config, accrual:      { ...config.accrual,      ...patch } });
  const updateLeaveApp     = (patch: Partial<LeaveAppConfig>)     => onChange({ ...config, leaveApp:     { ...config.leaveApp,     ...patch } });
  const updateApproval     = (patch: Partial<ApprovalConfig>)     => onChange({ ...config, approval:     { ...config.approval,     ...patch } });
  const updateYearEnd      = (patch: Partial<YearEndConfig>)      => onChange({ ...config, yearEnd:      { ...config.yearEnd,      ...patch } });
  const updateProbation    = (patch: Partial<ProbationConfig>)    => onChange({ ...config, probation:    { ...config.probation,    ...patch } });
  const updateNoticePeriod = (patch: Partial<NoticePeriodConfig>) => onChange({ ...config, noticePeriod: { ...config.noticePeriod, ...patch } });

  if (!leaveType) return null;

  const goNext = async () => {
    if (saving) return;
    // Persist the current config before advancing / closing. The button shows
    // a spinner and is disabled meanwhile so a double-click can't fire two
    // submissions. If the save fails the modal stays open (no navigation).
    const isLastSection = sectionIndex >= SETUP_SECTIONS.length - 1;
    if (onSave) {
      setSaving(true);
      try {
        await onSave(isLastSection);
      } catch {
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    if (!isLastSection) {
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
          <div className="lts-header">
            <div className="d-flex align-items-center gap-2 min-w-0">
              <span className="lts-type-icon" style={{ background: `${leaveType.color}20` }}>
                <i className="ri-file-list-3-line" style={{ color: leaveType.color }} />
              </span>
              <div className="min-w-0">
                <div className="fw-bold" style={{ fontSize: 14 }}>{leaveType.name}</div>
                <div className="text-muted d-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                  {readOnly && <i className="ri-lock-2-line" />}
                  Leave Type Configuration{readOnly ? ' · Read-only' : ''}
                </div>
              </div>
            </div>
            <div className="ms-auto d-flex align-items-center gap-2">
              <button type="button" className="lts-icon-btn" onClick={onClose} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
          </div>

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
                    style={active === s.key ? { background: `${s.tone}20`, color: s.tone } : undefined}
                  >
                    <i className={s.icon} />
                  </span>
                  {s.label}
                </button>
              ))}
            </aside>

            <main className="lts-main">
              {/* In read-only mode a disabled <fieldset> neutralises every
                  native control inside, and pointer-events:none covers any
                  custom (non-native) widgets — so a locked plan can be reviewed
                  but not edited (bug #67). Section navigation lives in the
                  sidebar, outside this fieldset, so browsing still works. */}
              <fieldset
                disabled={readOnly}
                style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto', ...(readOnly ? { pointerEvents: 'none' } : {}) }}
              >
              {active === 'accrual'      && <AccrualSectionView      cfg={config.accrual}      update={updateAccrual} />}
              {active === 'leaveApp'     && <LeaveAppSectionView     cfg={config.leaveApp}     update={updateLeaveApp} />}
              {active === 'approval'     && <ApprovalSectionView     cfg={config.approval}     update={updateApproval} />}
              {active === 'yearEnd'      && <YearEndSectionView      cfg={config.yearEnd}      update={updateYearEnd} />}
              {active === 'probation'    && <ProbationSectionView    cfg={config.probation}    update={updateProbation} />}
              {active === 'noticePeriod' && <NoticePeriodSectionView cfg={config.noticePeriod} update={updateNoticePeriod} />}
              </fieldset>
            </main>
          </div>

          <div className="lts-footer">
            <span className="text-muted" style={{ fontSize: 12 }}>
              Section <strong className="text-body">{sectionIndex + 1}</strong> of {SETUP_SECTIONS.length}
              <span className="mx-2">·</span>
              {sectionMeta.label}
            </span>
            <div className="d-flex gap-2">
              {readOnly ? (
                <button type="button" className="rec-btn-primary" onClick={onClose}>Close</button>
              ) : (
                <>
                  <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                  <button type="button" className="rec-btn-primary" onClick={goNext} disabled={saving}>
                    {saving ? (
                      <><i className="ri-loader-4-line" style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                    ) : (
                      sectionIndex === SETUP_SECTIONS.length - 1 ? 'Save & Close' : 'Save & Next'
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

function SectionCard({
  icon, iconBg, title, children,
}: {
  icon: string; iconBg: string; title: string; children: React.ReactNode;
}) {
  return (
    <div className="lts-card">
      <div className="lts-card-head">
        <span className="lts-card-icon" style={{ ['--lts-ic' as string]: iconBg, background: iconBg } as CSSProperties}>
          <i className={icon} />
        </span>
        <h6 className="fw-bold mb-0" style={{ fontSize: 13.5 }}>{title}</h6>
      </div>
      <div className="lts-card-body">{children}</div>
    </div>
  );
}

function CheckRow({
  checked, onChange, label, sub, children, locked, disabled,
}: {
  checked: boolean; onChange: (v: boolean) => void;
  label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode;
  /** When true the checkbox is forced checked and disabled (mandatory). */
  locked?: boolean;
  /** When true the row is greyed out and non-interactive (not applicable in the
   *  current configuration). Unlike `locked`, it does NOT force the box on. */
  disabled?: boolean;
}) {
  const inert = locked || disabled;
  return (
    <div className="lts-check-row" style={disabled ? { opacity: 0.55 } : undefined}>
      <label className="d-flex align-items-start gap-2 mb-0" style={{ cursor: inert ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          className="form-check-input mt-1"
          checked={locked ? true : checked}
          disabled={inert}
          onChange={e => { if (!inert) onChange(e.target.checked); }}
          style={{ accentColor: '#7c5cfc' }}
        />
        <div className="flex-grow-1 min-w-0">
          <div className="fw-semibold d-flex align-items-center gap-1" style={{ fontSize: 13 }}>
            {label}
            {locked && <i className="ri-lock-2-line text-muted" style={{ fontSize: 12 }} title="Mandatory — cannot be turned off" />}
          </div>
          {sub && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
        </div>
      </label>
      {(locked || checked) && children && <div className="lts-check-nested">{children}</div>}
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

function AccrualSectionView({ cfg, update }: { cfg: AccrualConfig; update: (p: Partial<AccrualConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Accrual</h5>

      <SectionCard icon="ri-information-line" iconBg="#ece6ff" title="Yearly Quota">
        {/* Leave is always calculated in days — the Days/Hours toggle and all
            hours-based logic were removed. */}
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
              min={0}
              max={365}
              value={cfg.yearlyQuota}
              onChange={e => update({ yearlyQuota: Number(e.target.value) || 0, unlimited: false })}
              disabled={cfg.unlimited}
            />
            <span className="text-muted" style={{ fontSize: 12.5 }}>days</span>
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
        {!cfg.unlimited && (cfg.yearlyQuota < 0 || cfg.yearlyQuota > 365) && (
          <div className="text-danger mt-2 d-flex align-items-center gap-1" style={{ fontSize: 12 }}>
            <i className="ri-error-warning-line" /> Yearly quota must be between 0 and 365 days.
          </div>
        )}
      </SectionCard>

      {/* Unlimited quota makes accrual rate, restrictions and extra-leave rules
          irrelevant — hide the rest of the Accrual step so only the quota
          choice remains. */}
      {!cfg.unlimited && (
        <>
      <SectionCard icon="ri-pulse-line" iconBg="#dbeafe" title="Allocation & Accrual Rate">
        {/* "Leave accrued periodically" (#102) and "Leave accrues based on
            attendance" were both removed on request, leaving immediate
            allocation as the only mode. The values still exist in the config
            type so a plan saved under either one still loads — it is normalised
            to 'immediate' in mergeWithDefaultConfig(). Kept as a radio rather
            than plain text so the section reads the same as every other one. */}
        <RadioRow
          selected
          onSelect={() => update({ mode: 'immediate', attendanceDaysWorked: 0 })}
          label="Leave quota available immediately"
        />
        <div className="text-muted" style={{ fontSize: 12, marginTop: 6, marginLeft: 28 }}>
          The full yearly quota is available from the first day — it is not vested month by month.
          To limit how much can be taken in one month, use <strong>Leave Application → maximum days per month</strong>.
        </div>
      </SectionCard>

      <SectionCard icon="ri-add-circle-line" iconBg="#d3f0ee" title="Extra Leave">
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
                min={1}
                max={365}
                value={cfg.employeeOverdraft.days}
                onChange={e => update({ employeeOverdraft: { ...cfg.employeeOverdraft, days: Number(e.target.value) || 0 } })}
                onClick={e => e.preventDefault()}
                disabled={!cfg.employeeOverdraft.enabled}
              />
              leave more than their balance
            </span>
          }
        />
        {cfg.employeeOverdraft.enabled && (cfg.employeeOverdraft.days < 1 || cfg.employeeOverdraft.days > 365) && (
          <div className="text-danger mt-2 d-flex align-items-center gap-1" style={{ fontSize: 12 }}>
            <i className="ri-error-warning-line" /> Extra leave must be between 1 and 365 days.
          </div>
        )}
      </SectionCard>
        </>
      )}
    </>
  );
}

/* The per-month cap used to be locked out under periodic accrual, which owned
   the monthly allocation itself (bug #66). Periodic accrual no longer exists
   (#102), so the cap is now the ONLY way to limit monthly usage and is always
   editable — the lock and its `accrualMode` prop went with the mode. */
function LeaveAppSectionView({ cfg, update }: { cfg: LeaveAppConfig; update: (p: Partial<LeaveAppConfig>) => void }) {
  return (
    <>
      <h5 className="fw-bold mb-3">Leave Application</h5>

      <SectionCard icon="ri-file-list-3-line" iconBg="#dbeafe" title="Leave Application Rules">
        <CheckRow checked={cfg.allowHalfDay}      onChange={v => update({ allowHalfDay: v })}      label="Allow half day leave" />
        <CheckRow
          checked={cfg.maxPerMonth.enabled}
          onChange={v => update({ maxPerMonth: { ...cfg.maxPerMonth, enabled: v } })}
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Allow at most
              <input
                type="number"
                min={0}
                className="lts-input"
                style={{ width: 70 }}
                value={cfg.maxPerMonth.days}
                onChange={e => update({ maxPerMonth: { ...cfg.maxPerMonth, days: Number(e.target.value) || 0 } })}
                disabled={!cfg.maxPerMonth.enabled}
              />
              day(s) of this leave type per calendar month
            </span>
          }
        />
      </SectionCard>
    </>
  );
}

/* Leave approval is the Reporting Manager only — they approve or reject and
 * that decision is final. HR is view-only: HR can see every request (via the
 * approvals queue / inbox) but is NOT an acting level on the chain. */
const FIXED_APPROVAL_LEVELS: Array<{
  kind: ApprovalLevel['approver_kind'];
  role: string | null;
  title: string; bg: string; fg: string; initials: string; desc: string;
}> = [
  { kind: 'reporting_manager', role: null, title: 'Reporting Manager', bg: '#d3f0ee', fg: '#0a716a', initials: 'RM',
    desc: 'Resolves to each requestor\'s reporting manager at submission time. Approves or rejects — their decision is final.' },
];

function ApprovalSectionView({ cfg, update }: { cfg: ApprovalConfig; update: (p: Partial<ApprovalConfig>) => void }) {
  // The acting chain is the Reporting Manager only. HR is view-only and is not
  // part of the saved chain.
  const chain: ApprovalLevel[] = FIXED_APPROVAL_LEVELS.map(lv => ({
    approver_kind: lv.kind,
    approver_role: lv.role,
  }));

  // Normalize any legacy / two-step chain down to Reporting Manager only so
  // saving the plan persists the view-only-HR rule. Approval is MANDATORY —
  // force `required` true so a legacy plan saved with it off is corrected and
  // the (locked) checkbox stays consistent with what's persisted.
  useEffect(() => {
    const c = cfg.chain;
    const chainOk = Array.isArray(c) && c.length === 1
      && c[0]?.approver_kind === 'reporting_manager';
    if (!chainOk || !cfg.required) update({ chain, required: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h5 className="fw-bold mb-3">Approval</h5>

      <SectionCard icon="ri-checkbox-circle-line" iconBg="#d3f0ee" title="Leave Approval Chain">
        <CheckRow
          checked={cfg.required}
          onChange={v => update({ required: v })}
          locked
          label="Leave request requires an approval"
        >
          <div className="lts-approval-chain">
            <div className="lts-section-label mb-2">APPROVAL CHAIN</div>

            {FIXED_APPROVAL_LEVELS.map((lv, idx) => (
              <div key={idx} className="lts-approval-card" style={{ marginBottom: 10 }}>
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <span className="lts-level-pill">LEVEL {idx + 1}</span>
                  <span
                    className="lts-kind-pill"
                    style={{ ['--kp-bg' as string]: lv.bg, ['--kp-fg' as string]: lv.fg } as CSSProperties}
                  >
                    {lv.title.toUpperCase()}
                  </span>
                </div>

                <div className="lts-assignee-row" style={{ marginTop: 2 }}>
                  <span
                    className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                    style={{ width: 28, height: 28, fontSize: 10, background: lv.fg }}
                  >{lv.initials}</span>
                  <span className="text-muted" style={{ fontSize: 12 }}>{lv.desc}</span>
                </div>
              </div>
            ))}

            {/* HR — view only. Not an approval level: HR can see every request
                but cannot approve or reject. */}
            <div className="lts-approval-card" style={{ marginBottom: 10, opacity: 0.9 }}>
              <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                <span
                  className="lts-kind-pill"
                  style={{ ['--kp-bg' as string]: '#ece6ff', ['--kp-fg' as string]: '#5a3fd1' } as CSSProperties}
                >
                  HR
                </span>
                <span
                  className="lts-kind-pill"
                  style={{ ['--kp-bg' as string]: '#eef2f6', ['--kp-fg' as string]: '#5b6478' } as CSSProperties}
                >
                  VIEW ONLY
                </span>
              </div>
              <div className="lts-assignee-row" style={{ marginTop: 2 }}>
                <span
                  className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                  style={{ width: 28, height: 28, fontSize: 10, background: '#5a3fd1' }}
                >HR</span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  HR can view every leave request but cannot approve or reject.
                </span>
              </div>
            </div>

            <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              <i className="ri-information-line me-1" />
              The reporting manager approves or rejects each request — their decision is final. HR has view-only access.
            </div>
          </div>
        </CheckRow>
      </SectionCard>
    </>
  );
}

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
        <div style={{ width: '100%', maxWidth: 360 }}>
          <MasterSelect
            value={cfg.carryForward}
            onChange={v => update({ carryForward: v as YearEndConfig['carryForward'] })}
            options={[
              { value: 'reset',        label: 'Reset to zero' },
              { value: 'carry_capped', label: 'Carry forward (capped)' },
              { value: 'carry_all',    label: 'Carry forward all' },
            ]}
          />
        </div>

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

