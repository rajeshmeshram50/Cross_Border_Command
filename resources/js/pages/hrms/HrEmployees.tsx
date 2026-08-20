import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import Tooltip from '../../components/ui/Tooltip';
import { AncillaryRolesChip } from '../../components/AncillaryRolesChip';
import DataTable, { ChipCell, IdCell, TruncCell, useIsClipped, type DataTableColumn } from '../../components/ui/DataTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { useLocation, useNavigate } from 'react-router-dom';
import { MasterSelect, MasterMultiSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
/* Static on purpose, for now. xlsx is 875 KB and only the Export button needs
   it, but twelve other screens still import it this way — and a module stays in
   the main chunk if ANY importer is static, so switching this one file alone
   moved nothing. Worth doing as its own pass across all thirteen. */
import * as XLSX from 'xlsx';
import FaceRegistrationModal from '../../components/FaceRegistrationModal';
import EvidenceVaultModal from '../../components/EvidenceVaultModal';
import '../employee-onboarding/HrEmployeeOnboarding.css';
import { Shimmer } from '../../components/ui/Shimmer';
import { leavePlansApi } from './leavePlansApi';
/* Breakup rules live in one place now — onboarding Stage 1 edits the same CTC
   and the Revise Salary modal writes the same table, so a copy per screen is
   how the figures drift apart. */
import {
  type SalBreakComp, SPLIT_CODES, MAX_COMP_AMOUNT, MAX_COMP_LABEL, CTC_ROUNDING_SLACK,
  seedBreakup, absorbIntoSpecial, statutoryPt, pfDeduction, breakupSignature, validateBreakup,
} from '../../utils/salaryBreakup';
import { resolveProbation } from '../../utils/probation';
import { useModulePermission } from '../../hooks/useModulePermission';
import '../../../css/recruitment.css';


const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];
const WORK_TYPE_OPTIONS = ['Full Time', 'Part Time', 'Contract', 'Intern', 'Consultant'].map(w => ({ value: w, label: w }));
const CUSTOM_PROBATION_VALUE = '__custom_probation__';
const CUSTOM_NOTICE_VALUE = '__custom_notice__';
const PROBATION_POLICY_OPTIONS = [
  ...['Default Probation Policy', '3-Month Probation', '6-Month Probation', 'No Probation']
    .map(p => ({ value: p, label: p })),
  { value: CUSTOM_PROBATION_VALUE, label: 'Set Custom Probation…' },
];
/* "No Notice Period" is a real answer, not a missing one — interns and some
   contract roles genuinely serve none. Without it the only way to record that
   was to leave a required field blank or invent a custom "0", which the custom
   field now rejects. It mirrors "No Probation" in the list above. */
const NOTICE_PERIOD_OPTIONS = [
  ...['No Notice Period', '15 Days', '30 Days', '60 Days', '90 Days']
    .map(n => ({ value: n, label: n })),
  { value: CUSTOM_NOTICE_VALUE, label: 'Set Custom Notice Period…' },
];

/* Weekly-off patterns — must match App\Support\WeekOff's canonical labels and
   HrEmployeeOnboarding's ONB_WEEKLY_OFF exactly; the backend resolves the rule
   from this string. "Week Off Policy" / bare "Rotational" were dropped: they
   name no day, so the parser fell back to Sunday for everyone who picked them. */
const WEEKLY_OFF_OPTIONS = [
  'Sunday Only',
  'Saturday & Sunday',
  'Rotational — 1st & 3rd Saturday',
  'Rotational — 2nd & 4th Saturday',
].map(v => ({ value: v, label: v }));
const TIME_TRACKING_OPTIONS = ['Manual', 'Biometric'].map(v => ({ value: v, label: v }));
const PENALIZATION_OPTIONS = ['Tracking Policy', 'Strict Policy', 'Lenient Policy', 'No Penalty'].map(v => ({ value: v, label: v }));
// Overtime rate options now come from the Overtime (OT) Master (fetched at
// runtime into overtimeRateOptions), gated behind an Applicable Yes/No toggle.
const YES_NO_OPTIONS = ['No', 'Yes'].map(v => ({ value: v, label: v }));
// No blank "Select" row — the empty state is carried by the placeholder,
// so the dropdown lists only the two real choices.
const EXPENSE_POLICY_OPTIONS = [{ value: 'Applicable', label: 'Applicable' }, { value: 'Not Applicable', label: 'Not Applicable' }];

const SALARY_FREQUENCY_OPTIONS = ['Per annum', 'Per month', 'Per hour', 'Per day'].map(v => ({ value: v, label: v }));
const SALARY_STRUCTURE_OPTIONS = ['Range Based', 'Fixed', 'Component Based'].map(v => ({ value: v, label: v }));
const TAX_REGIME_OPTIONS = ['New Regime (115BAC)', 'Old Regime'].map(v => ({ value: v, label: v }));


interface EmployeeRow {
  id: string;
  encryptedId?: string | null;
  name: string;
  email: string;
  initials: string;
  accent: string;
  photoUrl: string | null;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string | null;
  ancillaryRoles: string[];
  manager: string;
  profile: number;
  onboarding: 'Completed' | 'In Progress' | 'Pending';
  status: 'active' | 'on_leave' | 'high_attention' | 'probation' | 'inactive';
  enabled: boolean;
}

interface ApiEmployee {
  id: number;
  emp_code: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  date_of_birth: string | null;
  status: string | null;
  wizard_step_completed: number | null;
  onboarding_stage_completed: number | null;
  deleted_at: string | null;
  date_of_joining: string | null;
  department_id: number | null;
  designation_id: number | null;
  primary_role_id: number | null;
  ancillary_role_id: number | null;
  ancillary_role_ids?: number[] | null;
  ancillary_roles_resolved?: { id: number; name: string }[];
  reporting_manager_id: number | null;
  reporting_manager_user_id?: number | null;
  legal_entity_id: number | null;
  location: string | null;
  user_id: number | null;
  department?: { id: number; name: string; code?: string } | null;
  designation?: { id: number; name: string } | null;
  primary_role?: { id: number; name: string } | null;
  ancillary_role?: { id: number; name: string } | null;
  reporting_manager?: { id: number; display_name?: string | null; emp_code?: string | null; first_name?: string | null; last_name?: string | null; designation?: { id: number; name?: string | null } | null } | null;
  reporting_manager_user?: { id: number; name?: string | null; email?: string | null; user_type?: string | null; designation?: string | null } | null;
  // Legal entity = the employing branch (name + city/country for Location).
  legal_entity?: { id: number; name?: string; code?: string | null; city?: string | null; state?: string | null; country?: string | null } | null;
  work_country?: { id: number; name: string } | null;
  nationality_country?: { id: number; name: string } | null;
  country?: { id: number; name: string } | null;
  state?: { id: number; name: string; country_id?: number | null } | null;
  user?: { id: number; email: string; status?: string; last_login_at?: string | null } | null;
  [k: string]: any;
}

const accentFromName = (name: string): string => {
  const palette = ['#0ab39c', '#7c5cfc', '#f7b84b', '#0ea5e9', '#e83e8c', '#299cdb', '#f06548', '#405189', '#d63384'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
};
const initialsFromName = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';

const isoYearsAgo = (n: number): string => {
  const t = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${t.getFullYear() - n}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

const apiToRow = (e: ApiEmployee): EmployeeRow => {
  const name = (e.display_name || `${e.first_name} ${e.last_name || ''}`).trim();
  const isTrashed = !!e.deleted_at;
  const enabled = !isTrashed
    && (e.status || 'Active').toLowerCase() !== 'inactive'
    && (e.status || 'Active').toLowerCase() !== 'terminated'
    && (e.status || 'Active').toLowerCase() !== 'resigned';
  const statusMap: Record<string, EmployeeRow['status']> = {
    'Active': 'active', 'Inactive': 'inactive',
    'On Leave': 'on_leave', 'Probation': 'probation',
    'Notice Period': 'high_attention', 'Resigned': 'inactive', 'Terminated': 'inactive',
  };
  return {
    id: e.emp_code || `EMP-${e.id}`,
    encryptedId: (e as any).encrypted_id || null,
    name,
    email: e.email || '',
    initials: initialsFromName(name),
    accent: accentFromName(name),
    photoUrl: (e as any).photo_url || null,
    department: e.department?.name || '—',
    designation: e.designation?.name || '—',
    primaryRole: e.primary_role?.name || '—',
    ancillaryRole: e.ancillary_role?.name || null,
    ancillaryRoles: (e.ancillary_roles_resolved && e.ancillary_roles_resolved.length > 0)
      ? e.ancillary_roles_resolved.map(r => r.name)
      : (e.ancillary_role?.name ? [e.ancillary_role.name] : []),
    manager: e.reporting_manager?.display_name
      || (e.reporting_manager
        ? [e.reporting_manager.first_name, e.reporting_manager.last_name].filter(Boolean).join(' ').trim()
        : '')
      || e.reporting_manager_user?.name
      || '—',
    profile: ((): number => {
      const backend = Number(e.profile_completion);
      if (Number.isFinite(backend)) return Math.max(0, Math.min(100, Math.round(backend)));
      const STAGE1_WEIGHT = 0.40;
      const OTHER_WEIGHT = 0.60 / 5;
      const step = Math.max(0, Math.min(4, Number(e.wizard_step_completed ?? 0)));
      const macro = Math.max(0, Math.min(6, Number(e.onboarding_stage_completed ?? 0)));
      const stage1Pct = macro >= 1 ? STAGE1_WEIGHT : STAGE1_WEIGHT * (step / 4);
      const othersDone = (macro >= 2 ? 1 : 0) + (macro >= 3 ? 1 : 0)
        + (macro >= 4 ? 1 : 0) + (macro >= 5 ? 1 : 0)
        + (macro >= 6 ? 1 : 0);
      return Math.round((stage1Pct + othersDone * OTHER_WEIGHT) * 100);
    })(),
    onboarding: ((): 'Completed' | 'In Progress' | 'Pending' => {
      const macro = Number(e.onboarding_stage_completed ?? 0);
      const step = Number(e.wizard_step_completed ?? 0);
      if (macro >= 6) return 'Completed';
      if (macro > 0 || step > 0) return 'In Progress';
      return 'Pending';
    })(),
    status: statusMap[e.status || 'Active'] || 'active',
    enabled,
    faceRegistered: !!e.face_registered,
    _dbId: e.id,
    _raw: e,
  } as any;
};


const ROLE_TONES: Record<string, { bg: string; fg: string }> = {
  'Associate': { bg: '#fdf3d6', fg: '#a06f00' },
  'Training Coordinator': { bg: '#dceefe', fg: '#0c63b0' },
  'Business Analyst': { bg: '#fde8c4', fg: '#a4661c' },
  'Project Coordinator': { bg: '#d6f4e3', fg: '#108548' },
  'Analyst': { bg: '#fde8c4', fg: '#a4661c' },
  'DevOps Engineer': { bg: '#d3f0ee', fg: '#0a716a' },
  'Security Analyst': { bg: '#fdd9ea', fg: '#a02960' },
  'QA Testing Lead': { bg: '#fde8c4', fg: '#a4661c' },
  'QA Engineer': { bg: '#fde8c4', fg: '#a4661c' },
  'Team Lead': { bg: '#fdf3d6', fg: '#a06f00' },
  'Executive': { bg: '#fdf3d6', fg: '#a06f00' },
  'Software Engineer': { bg: '#dceefe', fg: '#0c63b0' },
  'Mentor': { bg: '#dceefe', fg: '#0c63b0' },
  'Sales Manager': { bg: '#fde8c4', fg: '#a4661c' },
  'Designer': { bg: '#fdf3d6', fg: '#a06f00' },
  'Brand Consultant': { bg: '#dceefe', fg: '#0c63b0' },
  'Test Automation Lead': { bg: '#dceefe', fg: '#0c63b0' },
  'Accounts Head': { bg: '#fde8c4', fg: '#a4661c' },
  'Accounts Manager': { bg: '#fde8c4', fg: '#a4661c' },
  'Scrum Master': { bg: '#fdf3d6', fg: '#a06f00' },
  'Data Analyst': { bg: '#fde8c4', fg: '#a4661c' },
  'UI/UX Designer': { bg: '#fdf3d6', fg: '#a06f00' },
  'Coordinator': { bg: '#fdf3d6', fg: '#a06f00' },
  'Engineer': { bg: '#fdf3d6', fg: '#a06f00' },
  'Board Member': { bg: '#dceefe', fg: '#0c63b0' },
  'CEO': { bg: '#fdf3d6', fg: '#a06f00' },
  'Lead': { bg: '#fdf3d6', fg: '#a06f00' },
  'Sr. Software Engineer': { bg: '#fdf3d6', fg: '#a06f00' },
  'Developer': { bg: '#fdf3d6', fg: '#a06f00' },
  'Design Head': { bg: '#fdf3d6', fg: '#a06f00' },
};
const DARK_BY_FG: Record<string, { bg: string; fg: string }> = {
  '#a06f00': { bg: 'rgba(160,111,0,0.28)', fg: '#fcd34d' },
  '#0c63b0': { bg: 'rgba(12,99,176,0.28)', fg: '#7cc4ff' },
  '#a4661c': { bg: 'rgba(164,102,28,0.30)', fg: '#fdba74' },
  '#108548': { bg: 'rgba(16,133,72,0.26)', fg: '#6ee7b7' },
  '#0a716a': { bg: 'rgba(10,113,106,0.28)', fg: '#5eead4' },
  '#a02960': { bg: 'rgba(160,41,96,0.26)', fg: '#f9a8d4' },
};
const tone = (role: string, dark = false) => {
  const light = ROLE_TONES[role] || { bg: '#eef2f6', fg: '#475569' };
  if (!dark) return light;
  return DARK_BY_FG[light.fg] || { bg: 'rgba(148,163,184,0.20)', fg: '#cbd5e1' };
};

const ONBOARDING_TONES: Record<EmployeeRow['onboarding'], { bg: string; fg: string; dot: string }> = {
  'Completed': { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'In Progress': { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Pending': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};


const KPI_CARDS = [
  { key: 'total', label: 'Total Employees', icon: 'ri-team-line', gradient: 'linear-gradient(135deg,#405189,#6691e7)', accent: '#6691e7' },
  { key: 'active', label: 'Active Employees', icon: 'ri-user-follow-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)', accent: '#0ab39c' },
  { key: 'disabled', label: 'Disabled Employees', icon: 'ri-user-unfollow-fill', gradient: 'linear-gradient(135deg,#878a99,#b9bbc6)', accent: '#878a99' },
  { key: 'onboarding_completed', label: 'Onboarding Completed', icon: 'ri-medal-fill', gradient: 'linear-gradient(135deg,#0c63b0,#299cdb)', accent: '#299cdb' },
  { key: 'new_joiners', label: 'New Joiners', icon: 'ri-user-add-fill', gradient: 'linear-gradient(135deg,#7c5cfc,#a78bfa)', accent: '#7c5cfc' },
] as const;

type ExpiryDays = 3 | 7 | 15;

/* Per-screen so other tables can adopt the same pattern without colliding. */
const PER_PAGE_KEY = 'cbc.hr.employees.perPage';

/* How long the step skeleton stands in while a panel is swapped.
   Long enough to read as a transition, short enough not to read as a stall —
   past roughly 800ms a skeleton stops meaning "changing" and starts meaning
   "stuck". */
const STEP_SHIMMER_MS = 500;

/* Normally the /hr/employees page. It is ALSO mountable as just its Add/Edit
   wizard, which is what `embedEditCode` does — the Onboarding hub renders it
   that way so its pencil opens the employee editor over the onboarding list
   instead of navigating to this page and opening it there (CBC #98).

   The wizard is ~1,400 lines of JSX over a hundred pieces of state that all
   live in this component. Lifting it into a shared component so two pages
   could mount it would be a far larger and riskier change than letting the
   second page mount THIS component in a mode where the list is not drawn — and
   it keeps exactly one implementation of the form, which is the property that
   actually matters: the two screens cannot drift apart.

   In embed mode nothing but the dialogs renders, and the list/stats requests
   that feed the table are skipped — the caller's own page is on screen behind
   the modal, and re-fetching a table nobody can see is pure cost. */
export default function HrEmployees({ embedEditCode, onEmbedClose }: {
  /** emp_code to open the edit wizard for, instead of rendering the list. */
  embedEditCode?: string;
  /** Fired when the wizard closes so the host page can unmount this. */
  onEmbedClose?: () => void;
} = {}) {
  const embedded = !!embedEditCode;
  // Active branch — the auto-fetched Legal Entity resolves against it.
  const { selectedBranchId } = useBranchSwitcher();
  const { user: authUser } = useAuth();
  const [tab, setTab] = useState<'active' | 'disabled'>('active');
  const [tabSwitching, setTabSwitching] = useState(false);
  useEffect(() => {
    setTabSwitching(true);
    const t = setTimeout(() => setTabSwitching(false), 450);
    return () => clearTimeout(t);
  }, [tab]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Disabled' | 'All'>('Active');

  useEffect(() => {
    if (statusFilter === 'Active' && tab !== 'active') setTab('active');
    if (statusFilter === 'Disabled' && tab !== 'disabled') setTab('disabled');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);
  const [deptFilter, setDeptFilter] = useState<string>('All Depts');

  const [apiEmployees, setApiEmployees] = useState<ApiEmployee[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  /* ── Server-side paging ────────────────────────────────────────────────
     The list used to fetch every employee and do the paging, searching and
     filtering in the browser. That cost 297 queries and 533 KB on a 111-row
     tenant and would not have survived a real one. The server now returns one
     page; everything below is what the browser needs to ask for it. */
  const [page, setPage] = useState(0);              // 0-based, as DataTable counts
  /* Opening guess, before autoFit has measured anything. Deliberately small: it
     is what a short viewport shows anyway, so the fit usually agrees and no
     second request is needed. A tall window fits far more, and that difference
     is large enough to clear the one-row threshold in DataTable's fit, so it
     still corrects in a single step. */
  /* Page size that fitted on the last visit. Reading it here means the opening
     request is usually already the right size, so autoFit measures, agrees, and
     never emits — one request instead of two.

     Falls back to 5, which is close to what a short viewport shows anyway. A
     stored value that no longer fits (different monitor, resized window) is
     corrected by the fit exactly once and the new value stored, so it
     self-heals rather than being wrong forever.

     Lazy initialiser: localStorage is read once on mount, not on every render.
     Guarded because a private-mode browser can throw on access. */
  const [perPage, setPerPage] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(PER_PAGE_KEY));
      return Number.isFinite(saved) && saved > 0 && saved <= 200 ? saved : 5;
    } catch {
      return 5;
    }
  });

  /* Persist whatever the table settles on — the fit's answer, or a size the
     user picked explicitly from Rows per page. Both are worth remembering: the
     explicit choice especially, since re-deriving it every visit would keep
     overriding a deliberate decision. */
  useEffect(() => {
    try { localStorage.setItem(PER_PAGE_KEY, String(perPage)); } catch { /* private mode */ }
  }, [perPage]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  /* Typing is not a request. Without this every letter fires a page-1 fetch and
     the results arrive out of order — the answer to "bha" landing after the
     answer to "bhavika". */
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  /* Any change to what is being asked for puts us back on the first page.
     Staying on page 4 while narrowing a search to three results shows an empty
     table with a pager insisting there are four pages. */
  useEffect(() => { setPage(0); }, [debouncedQ, tab, deptFilter]);

  const [mDepts, setMDepts] = useState<any[]>([]);
  const [mDesignations, setMDesignations] = useState<any[]>([]);
  const [mRoles, setMRoles] = useState<any[]>([]);
  const [mLegalEntities, setMLegalEntities] = useState<any[]>([]);
  const [mCountries, setMCountries] = useState<any[]>([]);
  const [mHolidayGroups, setMHolidayGroups] = useState<any[]>([]);
  // Overtime rates sourced from the Overtime (OT) Master — active rates only.
  const [mOvertimeRates, setMOvertimeRates] = useState<any[]>([]);
  const overtimeRateOptions = useMemo(
    () => mOvertimeRates
      .filter(o => String(o.status ?? 'Active').toLowerCase() === 'active')
      /* `name` first, `rate_name` second.
         The list arrives from /master/bulk?fields=id,name, which projects the
         master's label column AS `name` — master_overtime_rates spells it
         `rate_name`, so reading only that key produced a dropdown of
         "undefined" for every option. Both keys are accepted so a full master
         row (which carries rate_name) still renders if this is ever fed from
         the unslimmed endpoint. The VALUE stays the rate name either way:
         `employees.overtime` stores the label, not the id. */
      .map((o: any) => { const n = String(o.name ?? o.rate_name ?? '').trim(); return { value: n, label: n }; })
      .filter((o: { value: string }) => o.value !== ''),
    [mOvertimeRates],
  );

  /* Only groups that actually HOLD holidays.
     An empty group is a calendar with no days in it — assigning an employee to
     one buys them nothing and reads, on their profile, as a holiday list that
     silently grants no holidays. `holidays_count` comes off the group model
     already (HolidayGroup::$appends), so this needs no extra request. */
  const holidayGroupOptions = useMemo(
    () => mHolidayGroups
      .filter(g => String(g.status ?? 'Active').toLowerCase() !== 'inactive')
      .filter(g => Number(g.holidays_count ?? 0) > 0)
      .map(g => ({ value: String(g.id), label: g.name })),
    [mHolidayGroups],
  );
  const departmentOptions = useMemo(
    () => mDepts.map(d => ({ value: String(d.id), label: d.name })),
    [mDepts],
  );
  // 'Director / CEO' is embodied by the Branch User (branch director) — it is
  // no longer an assignable employee designation, so drop it (and any Inactive
  // designation) from the picker.
  const designationOptions = useMemo(
    () => mDesignations
      .filter(d => d?.name !== 'Director / CEO' && d?.status !== 'Inactive')
      .map(d => ({ value: String(d.id), label: d.name })),
    [mDesignations],
  );
  // Id of the "Head of Department (HOD)" designation — drives the
  // HOD ⇄ Reporting-Manager rule (an HOD must report to a Branch User).
  const hodDesignationId = useMemo(
    () => {
      const h = mDesignations.find(d => d?.name === 'Head of Department (HOD)');
      return h ? String(h.id) : '';
    },
    [mDesignations],
  );
  // Reporting-manager position hierarchy (mirrors app/Support/PositionHierarchy):
  // Branch User (top) > HOD > Team Leader > Executive > Employee > Intern/Trainee.
  // Lower number = higher position; a manager must rank strictly higher.
  const rankForDesignationName = (name?: string | null): number | null => {
    const MAP: Record<string, number> = {
      'Head of Department (HOD)': 2, 'Team Leader': 3, 'Executive': 4,
      'Employee': 5, 'Intern / Trainee': 6,
    };
    const n = (name ?? '').trim();
    return n in MAP ? MAP[n] : null;
  };
  const primaryRoleOptions = useMemo(
    // Carry department_id so the form can filter roles to the chosen department
    // (CR-013). A role with no department = "All Departments" → shown everywhere.
    () => mRoles.map(r => ({ value: String(r.id), label: r.name, deptId: r.department_id ?? null })),
    [mRoles],
  );
  const ancillaryRoleOptions = primaryRoleOptions;
  /* Legal Entity is NOT a picker — an employee is always hired into the branch
     the form is being filled under, so the field is auto-fetched and read-only,
     exactly like Location beside it.
     Resolution: the single branch the API returned (a branch_user, or a
     client_admin with one branch selected in the BranchSwitcher), else the row
     matching the active branch. With "All Branches" selected there is no single
     answer — nothing is filled and validation asks for a branch. */
  const autoLegalEntity = useMemo(() => {
    if (mLegalEntities.length === 1) return mLegalEntities[0];
    if (selectedBranchId) {
      return mLegalEntities.find(le => String(le.id) === String(selectedBranchId)) ?? null;
    }
    return null;
  }, [mLegalEntities, selectedBranchId]);
  const countryOptions = useMemo(
    () => mCountries.map(c => ({ value: String(c.id), label: c.name })),
    [mCountries],
  );
  /* States are fetched for the country that was picked, not all of them.
     /master/states is the whole world's subdivisions — 773 KB and about a
     second — and this form only ever shows the ~30 belonging to one country at
     a time. The endpoint has taken ?country_id since ClientForm and BranchForm
     moved to it; this screen was the last one still pulling the lot and
     filtering in the browser.

     Cached per country id so switching back and forth between the current and
     permanent address doesn't re-fetch, and so editing an employee whose two
     addresses share a country costs one call rather than two. */
  const [statesByCountry, setStatesByCountry] = useState<Record<string, { value: string; label: string }[]>>({});
  const statesInFlightRef = useRef<Set<string>>(new Set());

  const ensureStates = useCallback((countryId: string) => {
    const id = String(countryId || '').trim();
    if (!id || statesInFlightRef.current.has(id)) return;
    statesInFlightRef.current.add(id);
    api.get('/master/states', { params: { country_id: id, fields: 'id,name' } })
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        setStatesByCountry(prev => ({
          ...prev,
          [id]: [...list]
            .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
            .map((s: any) => ({ value: String(s.id), label: s.name })),
        }));
      })
      // Dropped from the in-flight set so a transient failure can be retried
      // the next time the country is touched, instead of leaving the picker
      // permanently empty.
      .catch(() => { statesInFlightRef.current.delete(id); });
  }, []);
  /* The department filter is held as a NAME (it feeds a dropdown built from
     department names), but the API filters by id. Resolved here rather than
     changing the filter's shape, which the toolbar and the export both read. */
  const deptFilterId = useMemo(() => {
    const name = deptFilter.trim().toLowerCase();
    if (!name || name === 'all depts') return null;
    return mDepts.find((d: any) => String(d.name).trim().toLowerCase() === name)?.id ?? null;
  }, [deptFilter, mDepts]);

  /* Guards against an older response overwriting a newer one. Typing narrows
     the result set, so the slow early query is exactly the one most likely to
     land last — and it would put back the rows the user has already typed past. */
  const employeesReqRef = useRef(0);

  const reloadEmployees = useCallback(async () => {
    // No table on screen in embed mode — see the note on the component.
    if (embedded) return;
    const token = ++employeesReqRef.current;
    /* Every fetch, not just the first. Paging and searching were instant while
       they happened in the browser, so the table never needed to say it was
       working; now they are requests, and without this the old rows sit there
       looking like the click did nothing until new ones replace them. */
    setLoadingEmployees(true);
    try {
      const r = await api.get('/employees', {
        params: {
          // Trims the row to the eleven columns this table renders — see
          // EmployeeController::LIST_COLUMNS. The wizard fetches its own full
          // record, so nothing here needs the rest.
          view: 'list',
          page: page + 1,                 // the API counts from 1, DataTable from 0
          per_page: perPage,
          enabled: tab === 'active' ? 1 : 0,
          ...(debouncedQ ? { search: debouncedQ } : {}),
          ...(deptFilterId ? { department_id: deptFilterId } : {}),
        },
      });
      if (token !== employeesReqRef.current) return;
      // `?? r.data` keeps this working if the envelope ever goes away again —
      // the endpoint only paginates for callers that ask.
      const body = r.data ?? {};
      setApiEmployees(Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []));
      setTotalEmployees(Number(body.total ?? (Array.isArray(body) ? body.length : 0)) || 0);
    } catch {
      if (token !== employeesReqRef.current) return;
      setApiEmployees([]);
      setTotalEmployees(0);
    } finally {
      if (token === employeesReqRef.current) setLoadingEmployees(false);
    }
  }, [embedded, page, perPage, tab, debouncedQ, deptFilterId]);

  /* KPI cards + tab badges. Separate from the list because they describe the
     whole roster, not the page — counting the 25 rows on screen would report
     "Total Employees 25" for every tenant. */
  const [counts, setCounts] = useState({
    total: 0, active: 0, disabled: 0, onboarding_completed: 0, new_joiners: 0,
  });
  const reloadCounts = useCallback(async () => {
    if (embedded) return;   // the KPI cards these feed are not rendered
    try {
      /* Pass the search so the badges describe the rows on screen. Without it
         the tabs read "Active 13 / Disabled 3" above a table showing three
         matches — the page contradicting itself (QA #173). Empty search sends
         nothing, so the unfiltered totals are unchanged. */
      const r = await api.get('/employees/stats', {
        params: debouncedQ ? { search: debouncedQ } : undefined,
      });
      setCounts({
        total: Number(r.data?.total) || 0,
        active: Number(r.data?.active) || 0,
        disabled: Number(r.data?.disabled) || 0,
        onboarding_completed: Number(r.data?.onboarding_completed) || 0,
        new_joiners: Number(r.data?.new_joiners) || 0,
      });
    } catch {
      /* Non-fatal — the cards keep their last values rather than flashing zeros
         over numbers that were correct a moment ago. */
    }
  }, [debouncedQ, embedded]);

  const reloadMasters = useCallback(() => {
    Promise.allSettled([
      /* One request for the five MasterController lists, instead of five.
         Each was a full round trip serialised behind the browser's connection
         limit — 2.3s to 5.1s on the wire for ~13 KB that changes monthly. The
         payload was never the problem; the request count was.

         ?fields=id,name because these fill dropdowns: without it /master/countries
         alone ships 104 KB of ownership metadata for 249 rows.

         Per-key rather than all-or-nothing: bulk() omits a master the user may
         not view rather than failing the call, so one missing grant cannot blank
         the other four. Each key keeps the shape its own endpoint returned. */
      api.get('/master/bulk', {
        params: {
          keys: 'departments,designations,roles,overtime_rates,countries',
          fields: 'id,name',
        },
      }).then(r => {
        const d = r.data?.data ?? {};
        const rows = (k: string): any[] => {
          const v = d[k];
          return Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
        };
        setMDepts(rows('departments'));
        setMDesignations(rows('designations'));
        setMRoles(rows('roles'));
        setMOvertimeRates(rows('overtime_rates'));
        setMCountries(
          [...rows('countries')].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))),
        );
      }).catch(() => {
        setMDepts([]); setMDesignations([]); setMRoles([]);
        setMOvertimeRates([]); setMCountries([]);
      }),
      /* Legal entities = the client's BRANCHES (the branch carries the
         GST/PAN/CIN and bank accounts). /branch-legal-entities is a permission-
         free form lookup — HR staff who can add an employee often can't manage
         branches, so /branches would 403 for them. */
      api.get('/branch-legal-entities')
        .then(r => setMLegalEntities(Array.isArray(r.data?.legal_entities) ? r.data.legal_entities : []))
        .catch(() => setMLegalEntities([])),
      api.get('/holiday-groups').then(r => setMHolidayGroups(Array.isArray(r.data) ? r.data : [])).catch(() => setMHolidayGroups([])),
      /* /master/states is deliberately absent — it returns every subdivision on
         earth (773 KB, ~1 s) and this form shows one country's at a time. See
         ensureStates() above, which fetches them per country. */
    ]);
  }, []);
  /* ── Master lists: still loaded, just not in front of the table ─────────
     Nothing on this screen reads them. Every column renders off the employee
     row itself; they exist for the Add/Edit wizard and the Onboarding Link
     dialog. Fetched with the page they put 880 KB of country and state lists
     (states alone is 773 KB / ~1 s) ahead of the first paint of a screen that
     shows neither.

     So the fetch is unchanged — only its timing. This flag turns on when the
     browser goes idle after the table has painted, or the moment a dialog that
     needs them opens, whichever comes first. Nothing is removed and no dialog
     can open to empty dropdowns; the lists simply stop blocking the list. */
  /* Embed mode starts wanted: the wizard IS the screen, so the dropdowns it
     needs are on the critical path rather than behind it. */
  const [mastersWanted, setMastersWanted] = useState<boolean>(() => !!embedEditCode);
  useEffect(() => {
    const want = () => setMastersWanted(true);
    /* requestIdleCallback runs this after the browser has finished painting.
       Safari still doesn't have it, so a short timer stands in — the point is
       only to get off the critical path, not to be precise. The 2s timeout
       keeps a permanently busy tab from starving the fetch entirely. */
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    if (ric) {
      const id = ric(want, { timeout: 2000 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const t = setTimeout(want, 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { reloadEmployees(); }, [reloadEmployees]);
  useEffect(() => { reloadCounts(); }, [reloadCounts]);
  useEffect(() => { if (mastersWanted) reloadMasters(); }, [mastersWanted, reloadMasters]);

  /* After anything that changes WHO is on the roster — a save, a delete, an
     enable/disable. The KPI cards are their own endpoint now, so a mutation
     that only reloaded the rows would leave "Active Employees" showing the
     figure from before the toggle. Counts are best-effort: a failed refresh
     leaves the last good numbers rather than blanking the cards. */
  const reloadAfterMutation = useCallback(async () => {
    await reloadEmployees();
    reloadCounts().catch(() => { /* cards keep their previous values */ });
  }, [reloadEmployees, reloadCounts]);

  /* Refresh the table when the tab comes back, so a row someone else changed
     is not shown stale.

     Two guards, both learned the hard way:

     THROTTLED — 'focus' fires on every return to the window, including clicking
     from DevTools back into the page. Unthrottled it re-fetched the list AND the
     stat cards on each of those, which is most of what a developer sees in the
     network panel while debugging anything else. AuthContext throttles its own
     /me for the same reason; this matches its 60s.

     SUPPRESSED WHILE THE WIZARD IS OPEN — the table it refreshes is behind the
     modal. Nobody can see the result, and closeEmp() refreshes on the way out
     anyway, so the fetch is pure waste at exactly the moment the user is doing
     something expensive. */
  const empOpenRef = useRef(false);

  useEffect(() => {
    const THROTTLE_MS = 60 * 1000;
    let lastAt = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (empOpenRef.current) return;
      const now = Date.now();
      if (now - lastAt < THROTTLE_MS) return;
      lastAt = now;
      reloadAfterMutation().catch(() => { /* table just stays stale */ });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reloadAfterMutation]);

  const apiRows = useMemo(() => apiEmployees.map(apiToRow), [apiEmployees]);

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onbName, setOnbName] = useState('');
  const [onbEmail, setOnbEmail] = useState('');
  const [onbDept, setOnbDept] = useState('');
  const [onbDate, setOnbDate] = useState('');
  const [onbExpiry, setOnbExpiry] = useState<ExpiryDays>(15);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState<number>(0);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  const toast = useToast();
  const confirmDialog = useConfirm();
  /* Per-action grants for this page. Slug matches what the API checks —
     EmployeeController::authorize() resolves 'hr.employee' — so a button the
     UI allows is a call the server will accept, and vice versa. */
  const perm = useModulePermission('hr.employee', 'employees');
  /* Leave Plan on the employee form is Leave-module data (QA #13). Editing an
     employee doesn't imply access to the leave configuration, so the field is
     gated on hr.leave rather than on hr.employee. */
  const leavePerm = useModulePermission('hr.leave', 'leave plans');
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  type OnbErrors = { name?: string; email?: string; dept?: string; date?: string };
  const [onbErrors, setOnbErrors] = useState<OnbErrors>({});
  const clearOnbError = (key: keyof OnbErrors) => {
    setOnbErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const validateOnboarding = (): OnbErrors => {
    const errs: OnbErrors = {};
    if (!onbName.trim()) errs.name = 'Employee name is required';
    else if (!/^[A-Za-z][A-Za-z\s'\-.]*$/.test(onbName.trim())) errs.name = 'Name can only contain letters (no numbers or special characters)';
    if (!onbEmail.trim()) errs.email = 'Email address is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(onbEmail.trim())) errs.email = 'Please enter a valid email address';
    if (!onbDept) errs.dept = 'Please select a department';
    if (!onbDate) errs.date = 'Please pick the expected joining date';
    return errs;
  };
  const handleGenerateOnboarding = async () => {
    if (generatingInvite) return;

    const errs = validateOnboarding();
    if (Object.keys(errs).length > 0) {
      setOnbErrors(errs);
      toast.error('Please fix the highlighted fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need${Object.keys(errs).length === 1 ? 's' : ''} attention.`);
      return;
    }
    const deptId = onbDept ? Number(onbDept) : null;
    setGeneratingInvite(true);
    try {
      const r = await api.post('/employees/onboarding-invite', {
        invitee_name: onbName.trim(),
        invitee_email: onbEmail.trim(),
        department_id: deptId ?? null,
        expected_join_date: onbDate || null,
        expiry_days: onbExpiry,
        app_origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      const inviteUrl = r?.data?.invite?.url;
      toast.success(
        'Onboarding link sent',
        `${onbExpiry}-day link emailed to ${onbEmail}.`,
      );
      if (inviteUrl) setGeneratedInviteUrl(inviteUrl);
      else closeOnboard();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors) {
        const next: OnbErrors = {};
        if (apiErrors.invitee_email) next.email = apiErrors.invitee_email[0];
        if (apiErrors.invitee_name) next.name = apiErrors.invitee_name[0];
        if (apiErrors.department_id) next.dept = apiErrors.department_id[0];
        if (apiErrors.expected_join_date) next.date = apiErrors.expected_join_date[0];
        setOnbErrors(next);
      }
      const msg = err?.response?.data?.message || err?.message || 'Failed to send invite';
      toast.error('Could not send onboarding link', String(msg));
    } finally {
      setGeneratingInvite(false);
    }
  };

  const closeOnboard = () => {
    setOnboardOpen(false);
    setOnbName('');
    setOnbEmail('');
    setOnbDept('');
    setOnbDate('');
    setOnbExpiry(15);
    setOnbErrors({});
    setGeneratedInviteUrl(null);
    setCopiedAt(0);
  };

  const copyGeneratedUrl = async () => {
    if (!generatedInviteUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(generatedInviteUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = generatedInviteUrl;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedAt(Date.now());
      toast.success('Link copied', 'Paste it anywhere to share with the candidate.');
    } catch {
      toast.error('Copy failed', 'Select the link and copy manually.');
    }
  };

  const openOnboardingForEmployee = (row: EmployeeRow) => {
    setOnbName(row.name);
    setOnbEmail(row.email);
    const matchedDeptId = mDepts.find(d => d.name === row.department)?.id;
    setOnbDept(matchedDeptId ? String(matchedDeptId) : '');
    setOnbDate('');
    setOnbExpiry(15);
    setOnboardOpen(true);
  };

  const [confirmDelete, setConfirmDelete] = useState<EmployeeRow | null>(null);
  const [faceRegEmployeeId, setFaceRegEmployeeId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleForceDelete = async () => {
    const row = confirmDelete;
    if (!row || deleting) return;
    const dbId = (row as any)._dbId as number | undefined;
    if (!dbId) {
      toast.error('Could not delete', 'Missing employee id.');
      return;
    }
    setDeleting(true);
    try {
      const r = await api.delete(`/employees/${dbId}/force`);
      toast.success('Employee deleted', r?.data?.message || `${row.name} has been permanently removed.`);
      await reloadAfterMutation();
      setConfirmDelete(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Could not delete this employee.';
      toast.error('Delete failed', String(msg));
    } finally {
      setDeleting(false);
    }
  };

  const [empOpen, setEmpOpen] = useState(false);
  /* Mirrors the two dialog flags into the ref the focus listener above reads.
     It lives here rather than beside that listener because empOpen is declared
     on the line above — reading it any earlier is a temporal dead zone error. */
  useEffect(() => { empOpenRef.current = empOpen || onboardOpen; }, [empOpen, onboardOpen]);
  /* True between the dialog appearing and its record arriving. Edit opens on
     the click now, so there is a window where the wizard is on screen with
     nothing in it — this drives the skeleton that fills it. */
  const [empLoading, setEmpLoading] = useState(false);
  /* The safety net for the idle preload above: if either dialog is opened
     before the browser ever went idle, the lists are pulled in right then. So
     the dropdowns are never empty because of the deferral — at worst they fill
     a moment after the dialog appears, exactly as they would have if the fetch
     had started on page load and not yet returned. */
  useEffect(() => {
    if (empOpen || onboardOpen) setMastersWanted(true);
  }, [empOpen, onboardOpen]);
  const [empMode, setEmpMode] = useState<'add' | 'edit'>('add');
  const [empEditingName, setEmpEditingName] = useState<string>('');
  const [empStep, setEmpStep] = useState<1 | 2 | 3 | 4>(1);
  /* The step rail scrolls sideways on a phone (four labelled circles cannot
     wrap without their connecting lines coming apart). Scrolling alone is not
     enough: reach step 4 and the rail is still parked at step 1, so the screen
     shows three steps, none of them the one you are on. Bring the active step
     into view whenever it changes. */
  const empStepRailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = empStepRailRef.current;
    if (!rail) return;
    const active = rail.querySelector('[aria-current="step"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [empStep]);
  const [empMaxStep, setEmpMaxStep] = useState<1 | 2 | 3 | 4>(1);
  const [eWorkCountry, setEWorkCountry] = useState('');
  const [eFirstName, setEFirstName] = useState('');
  const [eMiddleName, setEMiddleName] = useState('');
  const [eLastName, setELastName] = useState('');
  const [eDisplayName, setEDisplayName] = useState('');
  const [eDisplayNameTouched, setEDisplayNameTouched] = useState(false);
  const [eActualName, setEActualName] = useState('');
  const [eActualNameTouched, setEActualNameTouched] = useState(false);
  const [eActualNameLocked, setEActualNameLocked] = useState(false);
  const [eGender, setEGender] = useState('');
  const [eDob, setEDob] = useState('');
  const [eNationality, setENationality] = useState('');
  const [eWorkEmail, setEWorkEmail] = useState('');
  const [eMobile, setEMobile] = useState('');
  const [eEmpId, setEEmpId] = useState('');
  const [eStatus, setEStatus] = useState('Active');
  const [eCurAddr1, setECurAddr1] = useState('');
  const [eCurAddr2, setECurAddr2] = useState('');
  const [eCurCity, setECurCity] = useState('');
  const [eCurState, setECurState] = useState('');
  const [eCurCountry, setECurCountry] = useState('');
  const [eCurPin, setECurPin] = useState('');
  const [eSameAsCurrent, setESameAsCurrent] = useState(false);
  const [ePermAddr1, setEPermAddr1] = useState('');
  const [ePermAddr2, setEPermAddr2] = useState('');
  const [ePermCity, setEPermCity] = useState('');
  const [ePermState, setEPermState] = useState('');
  const [ePermCountry, setEPermCountry] = useState('');
  /* Fetch on the country, not on open: this also covers editing, where the
     country arrives from the saved record rather than from a click — without
     it the State picker would sit empty next to a country that is already
     filled in. */
  useEffect(() => { ensureStates(eCurCountry); }, [eCurCountry, ensureStates]);
  useEffect(() => { ensureStates(ePermCountry); }, [ePermCountry, ensureStates]);
  const currentAddressStates = statesByCountry[eCurCountry] ?? [];
  const permanentAddressStates = statesByCountry[ePermCountry] ?? [];
  const [ePermPin, setEPermPin] = useState('');
  const [eJoinDate, setEJoinDate] = useState('');
  const [eDept, setEDept] = useState('');
  const [eDesignation, setEDesignation] = useState('');
  const [ePrimaryRole, setEPrimaryRole] = useState('');
  const [eAncillaryRole, setEAncillaryRole] = useState<string[]>([]);
  const [eWorkType, setEWorkType] = useState('');
  // Primary & Ancillary share the SAME role list, but a role can't be BOTH for
  // one employee: exclude the other side's current pick from each dropdown so
  // the clash is physically unselectable (a save-time guard backs it up too).
  // CR-013: Primary/Ancillary roles are filtered STRICTLY to the selected
  // Department — pick the department first, and the role list follows it. A role
  // with no department ("All Departments") is available under every department;
  // a role tied to another department is hidden.
  const inSelectedDept = (o: { deptId: number | null }) =>
    o.deptId == null || String(o.deptId) === eDept;
  const primaryRoleOptionsX = useMemo(
    () => primaryRoleOptions.filter(o => inSelectedDept(o) && !eAncillaryRole.includes(o.value)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryRoleOptions, eAncillaryRole, eDept],
  );
  const ancillaryRoleOptionsX = useMemo(
    () => primaryRoleOptions.filter(o => inSelectedDept(o) && o.value !== ePrimaryRole),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryRoleOptions, ePrimaryRole, eDept],
  );
  // CR-013: when the Department changes, drop any Primary/Ancillary role that
  // doesn't belong to the new department so the selection always matches it.
  useEffect(() => {
    if (!eDept || mRoles.length === 0) return;
    const validIds = new Set(
      mRoles
        .filter((r: any) => r.department_id == null || String(r.department_id) === eDept)
        .map((r: any) => String(r.id)),
    );
    setEPrimaryRole(prev => (prev && !validIds.has(prev) ? '' : prev));
    setEAncillaryRole(prev => prev.filter(id => validIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eDept, mRoles]);
  const [eLegalEntity, setELegalEntity] = useState('');
  /* Display name for the read-only Legal Entity field. Held separately from the
     id because when editing an employee of another branch the saved entity may
     not be in the branch-scoped options list — the row's own
     `legal_entity.name` is then the only source for the label. */
  const [eLegalEntityLabel, setELegalEntityLabel] = useState('');
  const [eLocation, setELocation] = useState('');
  /* Fill both fields once the branch resolves. Only when EMPTY, so opening an
     existing employee keeps their saved entity instead of being rewritten to the
     active branch (which would silently re-home them on the next save). */
  useEffect(() => {
    if (!autoLegalEntity || eLegalEntity) return;
    setELegalEntity(String(autoLegalEntity.id));
    setELegalEntityLabel(autoLegalEntity.name || '');
    setELocation(autoLegalEntity.location || autoLegalEntity.city || '');
  }, [autoLegalEntity, eLegalEntity]);
  const [eReportingMgr, setEReportingMgr] = useState('');
  const [savedMgrOption, setSavedMgrOption] = useState<{ value: string; label: string } | null>(null);
  const [eProbationPolicy, setEProbationPolicy] = useState('');
  const [eNoticePeriod, setENoticePeriod] = useState('');
  const [eCustomProbation, setECustomProbation] = useState('');
  const [eCustomNotice, setECustomNotice] = useState('');
  const [eLeavePlan, setELeavePlan] = useState('');
  const [leavePlanOptions, setLeavePlanOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    /* Leave plans belong to the Leave module, not this one. Without a grant
       there the list isn't fetched at all — so the dropdown offers nothing
       instead of exposing (and letting someone assign) plans they have no
       access to. The "required" rule below only bites when options exist, so
       the form stays completable. */
    if (!leavePerm.canView) { setLeavePlanOptions([]); return; }
    // Wizard-only, like the master lists — see the mastersWanted note above.
    if (!mastersWanted) return;

    leavePlansApi.list()
      .then(plans => {
        // Only configured plans (quota setup complete) may be assigned to an
        // employee — hide draft / unconfigured plans from the dropdown.
        setLeavePlanOptions(
          plans
            .filter(p => p.setup_complete)
            .map(p => ({ value: String(p.id), label: p.plan_name })),
        );
      })
      .catch(err => console.warn('[HrEmployees] failed to load leave plans', err));
  }, [leavePerm.canView, mastersWanted]);
  const [eHolidayList, setEHolidayList] = useState('');
  const [eAttendanceTracking, setEAttendanceTracking] = useState(true);
  /* An employee ALREADY on a group the filters would hide keeps their value —
     dropping it would silently reassign, or blank, a field the user never
     touched. The label says which rule hid it, so the reason is on screen
     rather than a mystery entry. */
  const holidayGroupSelectOptions = useMemo(() => {
    const opts = [...holidayGroupOptions];
    if (eHolidayList && !opts.some(o => o.value === String(eHolidayList))) {
      const g = mHolidayGroups.find(x => String(x.id) === String(eHolidayList));
      if (g) {
        const why = String(g.status ?? 'Active').toLowerCase() === 'inactive'
          ? 'Inactive'
          : 'No holidays';
        opts.push({ value: String(g.id), label: `${g.name} (${why})` });
      }
    }
    return opts;
  }, [holidayGroupOptions, mHolidayGroups, eHolidayList]);
  const [eShift, setEShift] = useState('');
  // Shift options come from the branch's configured Shift Details (set in the
  // Branch form). BranchSwitcher injects ?branch_id on this GET, so a branch
  // user sees their branch's shifts and a client_admin sees the selected
  // branch (or the union across branches when "All Branches" is active).
  const [branchShiftOptions, setBranchShiftOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    // Wizard Step 3 only — deferred with the rest, see mastersWanted above.
    if (!mastersWanted) return;
    api.get('/branch-shifts')
      .then(r => {
        const list = Array.isArray(r.data?.shifts) ? r.data.shifts : [];
        setBranchShiftOptions(list
          .filter((s: any) => s?.name)
          .map((s: any) => ({
            value: s.name,
            // Show the timing next to the name so the picker is self-explanatory.
            label: s.start && s.end ? `${s.name} (${s.start}–${s.end})` : s.name,
          })));
      })
      .catch(() => setBranchShiftOptions([]));
  }, [mastersWanted]);
  // Effective dropdown: prefer branch-configured shifts; fall back to the
  // built-in defaults only when the branch has none. Always include the
  // employee's currently-saved shift so editing never blanks an old value.
  const shiftSelectOptions = useMemo(() => {
    // Branch-configured shifts are the ONLY source — no hardcoded fallback, so
    // an unconfigured branch shows an empty list (with a hint) rather than
    // misleading legacy defaults.
    const base = [...branchShiftOptions];
    if (eShift && !base.some(o => o.value === eShift)) {
      // Keep the employee's already-saved shift so editing never blanks it,
      // but flag it as the current/legacy value — it's not a branch shift.
      return [{ value: eShift, label: `${eShift} (current)` }, ...base];
    }
    return base;
  }, [branchShiftOptions, eShift]);
  // Placeholder doubles as a hint when the branch has no shifts configured yet.
  const shiftPlaceholder = branchShiftOptions.length === 0
    ? 'No shifts configured for this branch'
    : 'Select shift';
  const [eWeeklyOff, setEWeeklyOff] = useState('');
  const [eAttendanceNumber, setEAttendanceNumber] = useState('');
  const [eOvertime, setEOvertime] = useState('');
  // Yes/No toggle gating the Overtime Rate picker; derived from eOvertime on hydrate.
  const [eOvertimeApplicable, setEOvertimeApplicable] = useState('No');
  const overtimeRateSelectOptions = useMemo(() => {
    const active = overtimeRateOptions;
    const saved = eOvertime.trim();
    if (!saved || active.some(o => o.value === saved)) return active;
    return [...active, {
      value: saved,
      label: `${saved} (inactive)`,
      disabled: true,
      disabledReason: 'This rate is no longer Active in Master › Overtime (OT). Pick a current rate.',
    }];
  }, [overtimeRateOptions, eOvertime]);
  const [eExpensePolicy, setEExpensePolicy] = useState('');
  const [eLaptopAssigned, setELaptopAssigned] = useState('No');
  const [eLaptopAssetId, setELaptopAssetId] = useState('');
  const [eMobileDevice, setEMobileDevice] = useState('');
  const [eOtherAssets, setEOtherAssets] = useState('');
  const [eLaptopMasterAssetId, setELaptopMasterAssetId] = useState('');
  const [eMobileAssigned, setEMobileAssigned] = useState('No');
  const [eMobileMasterAssetId, setEMobileMasterAssetId] = useState('');
  const [eOtherMasterAssetIds, setEOtherMasterAssetIds] = useState<string[]>([]);
  // `badge` flags a device whose Asset-master category no longer matches the
  // slot it is linked to (see `stale_category` on /employees/available-assets).
  type AssetOpt = { value: string; label: string; badge?: { text: string; tone?: 'green' | 'red' | 'gray' | 'violet' } };
  const [laptopAssetOpts, setLaptopAssetOpts] = useState<AssetOpt[]>([]);
  const [mobileAssetOpts, setMobileAssetOpts] = useState<AssetOpt[]>([]);
  const [otherAssetOpts, setOtherAssetOpts] = useState<AssetOpt[]>([]);
  const [eAadharFile, setEAadharFile] = useState<File | null>(null);
  const [ePanFile, setEPanFile] = useState<File | null>(null);
  const [ePhotoFile, setEPhotoFile] = useState<File | null>(null);
  type ServerDoc = { id: number; document_key: string; original_name: string | null; status: string; url: string | null };
  const [eExistingDocs, setEExistingDocs] = useState<Record<string, ServerDoc>>({});
  const eExistingDocsRef = useRef<Record<string, ServerDoc>>({});
  useEffect(() => { eExistingDocsRef.current = eExistingDocs; }, [eExistingDocs]);
  const [eDocBusy, setEDocBusy] = useState<Record<string, boolean>>({});

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignEmp, setAssignEmp] = useState<EmployeeRow | null>(null);
  const [aLaptopAssigned, setALaptopAssigned] = useState('No');
  const [aLaptopMasterAssetId, setALaptopMasterAssetId] = useState('');
  const [aMobileAssigned, setAMobileAssigned] = useState('No');
  const [aMobileMasterAssetId, setAMobileMasterAssetId] = useState('');
  const [aOtherMasterAssetIds, setAOtherMasterAssetIds] = useState<string[]>([]);
  // Per-field errors for the Assign Assets modal, keyed 'laptop' | 'mobile'.
  // Set when Save is pressed with Assigned = Yes but no device chosen.
  const [aErrors, setAErrors] = useState<Record<string, string>>({});
  const [aSaving, setASaving] = useState(false);
  const [aLaptopOpts, setALaptopOpts] = useState<AssetOpt[]>([]);
  const [aMobileOpts, setAMobileOpts] = useState<AssetOpt[]>([]);
  const [aOtherOpts, setAOtherOpts] = useState<AssetOpt[]>([]);

  /* The two device pickers only exist on "Yes", so the Assets row holds 2, 3 or
     4 fields — and the fixed md={4} it used to carry suited exactly one of
     those. At 2 it left the right third of the dialog empty; at 4 it put three
     on the first row and stranded Mobile Device alone on the second.
     Deriving the span keeps every row full — 2 → 6+6, 3 → 4+4+4, 4 → 6+6 twice
     — and at 4 it also lands each toggle beside its own device picker. */
  const assetFieldCount =
    2 + (aLaptopAssigned === 'Yes' ? 1 : 0) + (aMobileAssigned === 'Yes' ? 1 : 0);
  const assetColSpan = assetFieldCount === 3 ? 4 : 6;

  const openAssignAssets = (row: EmployeeRow) => {
    setAssignEmp(row);
    const raw = (row as any)._raw || {};
    setALaptopAssigned(raw.laptop_master_asset_id ? 'Yes' : 'No');
    setALaptopMasterAssetId(raw.laptop_master_asset_id ? String(raw.laptop_master_asset_id) : '');
    setAMobileAssigned(raw.mobile_master_asset_id ? 'Yes' : 'No');
    setAMobileMasterAssetId(raw.mobile_master_asset_id ? String(raw.mobile_master_asset_id) : '');
    setAOtherMasterAssetIds(Array.isArray(raw.other_master_asset_ids)
      ? raw.other_master_asset_ids.map((n: any) => String(n))
      : []);
    setAErrors({});
    setAssignOpen(true);
  };

  /* Re-runnable so the pickers can refresh on open: the free-asset list goes
     stale as soon as another user claims a device, and fetching it once when
     the modal opened meant a taken asset kept showing. The server rejects a
     double-booking on save, but offering it and failing afterwards is a poor
     way to find out. */
  const reloadAssignAssets = useCallback((isStale: () => boolean = () => false) => {
    const dbId = (assignEmp as any)?._dbId as number | undefined;
    if (!dbId) return Promise.resolve();
    const exclude = `&exclude_employee_id=${dbId}`;
    const fetchCat = (cat: string, setter: (opts: AssetOpt[]) => void) =>
      api.get(`/employees/available-assets?category=${cat}${exclude}`)
        .then(r => { if (!isStale()) setter((r.data ?? []).map((a: any) => ({ value: String(a.id), label: a.label || a.asset_name }))); })
        .catch(() => { if (!isStale()) setter([]); });
    return Promise.allSettled([
      fetchCat('laptop', setALaptopOpts),
      fetchCat('mobile', setAMobileOpts),
      fetchCat('other', setAOtherOpts),
    ]);
  }, [assignEmp]);

  useEffect(() => {
    if (!assignOpen) return;
    let cancelled = false;
    reloadAssignAssets(() => cancelled);
    return () => { cancelled = true; };
  }, [assignOpen, reloadAssignAssets]);

  const handleSaveAssign = async () => {
    if (!assignEmp) return;
    const dbId = (assignEmp as any)._dbId as number | undefined;
    if (!dbId) {
      toast.error('Cannot save', 'Employee record not found.');
      return;
    }

    /* "Assigned = Yes" with no device picked used to save silently: the empty
       string parsed to NaN → null, so the record ended up with the toggle on
       and nothing attached. Require the device. */
    const missing: Record<string, string> = {};
    if (aLaptopAssigned === 'Yes' && !aLaptopMasterAssetId) {
      missing.laptop = aLaptopOpts.length === 0
        ? 'No laptops are available in this branch — add one in Master › Assets, or set Assigned to No.'
        : 'Please select a device.';
    }
    if (aMobileAssigned === 'Yes' && !aMobileMasterAssetId) {
      missing.mobile = aMobileOpts.length === 0
        ? 'No mobiles are available in this branch — add one in Master › Assets, or set Assigned to No.'
        : 'Please select a device.';
    }
    if (Object.keys(missing).length) {
      setAErrors(missing);
      const which = Object.keys(missing).map(k => (k === 'laptop' ? 'Laptop' : 'Mobile'));
      toast.error(
        `${which.join(' and ')} device required`,
        Object.values(missing)[0],
      );
      return;
    }
    setAErrors({});

    setASaving(true);
    const intOrNull = (s: string) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    };
    try {
      await api.put(`/employees/${dbId}`, {
        laptop_master_asset_id: aLaptopAssigned === 'Yes' ? intOrNull(aLaptopMasterAssetId) : null,
        mobile_master_asset_id: aMobileAssigned === 'Yes' ? intOrNull(aMobileMasterAssetId) : null,
        other_master_asset_ids: aOtherMasterAssetIds.map(v => parseInt(v, 10)).filter(n => Number.isFinite(n)),
      });
      toast.success('Assets saved', `Updated assignments for ${assignEmp.name}.`);
      closeAssign();
      try { await reloadEmployees(); } catch { /* best-effort */ }
    } catch (err: any) {
      const errors = err?.response?.data?.errors;
      const firstMsg = errors ? Object.values(errors).flat()[0] : null;
      toast.error('Could not save', String(firstMsg || err?.response?.data?.message || err?.message || 'Try again'));
    } finally {
      setASaving(false);
    }
  };

  const closeAssign = () => {
    setAssignOpen(false);
    setAssignEmp(null);
    setAErrors({});   // don't carry a stale "select a device" into the next employee
  };

  const navigate = useNavigate();
  const location = useLocation();

  /* Straight to the record.
   *
   * This used to wait for `loadingEmployees` to clear and then look the code up
   * in the page it had just fetched. Two costs, both visible: the wizard could
   * not appear until the whole list had loaded AND painted — which is the
   * employee tab opening first, then the editor over it (CBC #98) — and an
   * employee on page 4 was a miss, which then paid for a SECOND request.
   *
   * The list was never needed. One employee is being opened, so one employee is
   * asked for, immediately, in parallel with whatever else the page is doing;
   * show() resolves an emp_code as readily as an id. The record is handed
   * straight to the wizard, which would otherwise re-fetch the same row. */
  useEffect(() => {
    /* Two ways in, one path out. `embedEditCode` is the Onboarding hub
       rendering this component's wizard INSIDE its own page; the router-state
       form is the older cross-page navigation, kept so any deep link still
       works. Either way it is one emp_code and one dialog. */
    const incoming = embedEditCode
      ?? ((location.state as any)?.openEditEmpCode as string | undefined);
    if (!incoming) return;

    const back = (location.state as any)?.returnTo as string | undefined;
    if (back) setReturnToOnClose(back);

    /* Open the shell on the CLICK, fill it when the record lands — the same
       rule openEditEmployee() follows for a row that is already on screen.
       Here the id has to be looked up first, so without this the dialog would
       not appear until that round trip came back and the pencil would read as
       a dead button for its duration. */
    if (embedEditCode) {
      setEmpMode('edit');
      setEmpOpen(true);
      setEmpLoading(true);
    }

    api.get(`/employees/${encodeURIComponent(incoming)}`)
      .then(r => {
        const raw = r.data?.employee ?? r.data;
        if (!raw?.id) throw new Error('not found');
        openEditEmployee(apiToRow(raw), raw);
      })
      .catch(() => {
        toast.error('Could not open employee', `${incoming} was not found.`);
        onEmbedClose?.();
      });

    // Cleared immediately — a back/forward that replays this state should not
    // re-open the wizard over whatever the user is doing by then.
    if (!embedEditCode) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedEditCode, location.state]);
  const openPermissions = (row: EmployeeRow) => {
    navigate(`/hr/employees/${encodeURIComponent(row.encryptedId || row.id)}/permissions`, { state: { employee: row } });
  };

  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultEmp, setVaultEmp] = useState<EmployeeRow | null>(null);
  const [vaultTab, setVaultTab] = useState<'employee' | 'organizational'>('employee');
  const openVault = (row: EmployeeRow) => {
    setVaultEmp(row);
    setVaultTab('employee');
    setVaultOpen(true);
  };
  const closeVault = () => { setVaultOpen(false); setVaultEmp(null); };

  const [togglePending, setTogglePending] = useState<{
    employee: EmployeeRow;
    next: boolean;
    commit: () => void;
  } | null>(null);
  const [toggling, setToggling] = useState(false);

  const requestToggle = (employee: EmployeeRow, next: boolean, commit: () => void) => {
    // Backstop for the switch's own permission lock — this is the only path
    // that reaches the enable/disable API, so the check belongs here too.
    if (!perm.canEdit) { perm.deny('edit'); return; }
    setTogglePending({ employee, next, commit });
  };
  const cancelToggle = () => { if (!toggling) setTogglePending(null); };
  const confirmToggle = async () => {
    const pending = togglePending;
    if (!pending || toggling) return;
    const dbId = (pending.employee as any)._dbId as number | undefined;
    setToggling(true);
    try {
      if (pending.next === false) {
        if (dbId) await handleDeleteEmployee(dbId, pending.employee.name);
      } else {
        if (dbId) {
          try {
            await api.patch(`/employees/${dbId}/restore`);
            toast.success('Employee enabled', `${pending.employee.name} can sign in again.`);
            await reloadAfterMutation();
            // Re-enabled employee becomes an eligible manager again — refresh
            // the pool so the dropdown reflects it without a page reload.
            reloadManagers().catch(() => { /* swallow */ });
          } catch (err: any) {
            toast.error('Could not enable employee', err?.response?.data?.message || err?.message || 'Try again');
            setTogglePending(null);
            return;
          }
        }
      }
      pending.commit();
      setTogglePending(null);
    } finally {
      setToggling(false);
    }
  };
  const [eEnablePayroll, setEEnablePayroll] = useState(true);
  const [ePayGroup, setEPayGroup] = useState('');
  const [eAnnualSalary, setEAnnualSalary] = useState('');
  const [eSalaryFreq, setESalaryFreq] = useState('Per annum'); // salary is always entered per annum (frequency picker removed)
  const [eSalaryFrom, setESalaryFrom] = useState('');
  const [eBonusInAnnual, setEBonusInAnnual] = useState(false);
  const [ePfEligible, setEPfEligible] = useState(false);
  const [ePfType, setEPfType] = useState('Statutory'); // 'Statutory' (₹15k cap) | 'Standard' (full basic)
  /* Detailed breakup is ON by default. The collapsed "Regular + Bonus = CTC"
     summary restates the CTC field directly above it and nothing else, so the
     section opened with no information in it and every user's first act was to
     flip the toggle. An employee SAVED with it off still opens off — see the
     explicit null check where detailed_breakup is read back. */
  const [eDetailedBreakup, setEDetailedBreakup] = useState(true);
  const [eEarnings, setEEarnings] = useState<SalBreakComp[]>([]);
  const [eDeductions, setEDeductions] = useState<SalBreakComp[]>([]);
  const [eEsiApplicable, setEEsiApplicable] = useState(false);
  /* Both start UNCHECKED. PT defaulted to true, so every new employee arrived
     with a Professional Tax deduction row nobody had asked for — and it is not
     universal (it is state-levied, and several states do not charge it). */
  const [ePtApplicable, setEPtApplicable] = useState(false);
  const [eBreakupLoading, setEBreakupLoading] = useState(false);
  const breakupLoadedForRef = useRef<number | 'new' | null>(null);
  const breakupBaselineRef = useRef<string | null>(null);
  // false while the breakup is still the auto-split (Basic/HRA/Special) — lets
  // it re-seed when the Salary Amount changes. Flips true the moment HR edits /
  // adds / removes a component or a saved structure loads, so manual work is
  // never wiped by a later salary change.
  /* The Annual CTC the current Basic/HRA/Special were built from. Set whenever
     the breakup is loaded or seeded, and compared before re-seeding, so the
     split follows a CTC the USER changed and never a value that merely arrived
     from the server. */
  const seededForSalaryRef = useRef<string | null>(null);

  const resetEmpForm = () => {
    setEmpStep(1);
    setEmpMaxStep(1);
    setEWorkCountry('');
    setEFirstName(''); setEMiddleName(''); setELastName('');
    setEDisplayName(''); setEDisplayNameTouched(false); setEActualName(''); setEActualNameLocked(false); setEActualNameTouched(false);
    setEGender(''); setEDob(''); setENationality('');
    setEWorkEmail(''); setEMobile('');
    setEEmpId(''); setEStatus('Active');
    setECurAddr1(''); setECurAddr2(''); setECurCity(''); setECurState(''); setECurCountry(''); setECurPin('');
    setESameAsCurrent(false);
    setEPermAddr1(''); setEPermAddr2(''); setEPermCity(''); setEPermState(''); setEPermCountry(''); setEPermPin('');
    setEJoinDate(''); setEDept(''); setEDesignation('');
    setEPrimaryRole(''); setEAncillaryRole([]); setEWorkType('');
    setELegalEntity(''); setELegalEntityLabel(''); setELocation(''); setEReportingMgr(''); setSavedMgrOption(null);
    setEProbationPolicy(''); setENoticePeriod('');
    setECustomProbation(''); setECustomNotice('');
    setELeavePlan(''); setEHolidayList('');
    setEAttendanceTracking(true); setEShift('');
    setEWeeklyOff(''); setEAttendanceNumber('');
    setEOvertime(''); setEOvertimeApplicable('No'); setEExpensePolicy('');
    setELaptopAssigned('No'); setELaptopAssetId(''); setEMobileDevice(''); setEOtherAssets('');
    setELaptopMasterAssetId(''); setEMobileAssigned('No'); setEMobileMasterAssetId(''); setEOtherMasterAssetIds([]);
    setEAadharFile(null); setEPanFile(null); setEPhotoFile(null);
    setEExistingDocs({}); setEDocBusy({});
    setEEnablePayroll(true); setEPayGroup('');
    setEAnnualSalary(''); setESalaryFreq('Per annum'); setESalaryFrom('');
    // Reset restores the DEFAULT, which is open — not `false`. Leaving this at
    // false meant the first employee of a session got the open section and
    // every one after it got the collapsed summary again.
    setEBonusInAnnual(false); setEPfEligible(false); setEDetailedBreakup(true);
    setEEarnings([]); setEDeductions([]); setEEsiApplicable(false); setEPtApplicable(false);
    setEBreakupLoading(false);
    breakupLoadedForRef.current = null;
    breakupBaselineRef.current = null;
    seededForSalaryRef.current = null;
    setEErrors({});
  };

  const [returnToOnClose, setReturnToOnClose] = useState<string | null>(null);
  /* Skeleton while a step's panel is swapped.

     Only steps 2-4: step 1 is not swapped into place, it is FILLED IN once the
     record lands, and empLoading already shows the skeleton for that. Flashing
     a second skeleton at it would read as a glitch rather than a transition. */
  const [stepShimmer, setStepShimmer] = useState(false);
  useEffect(() => {
    if (!empOpen || empLoading || empStep === 1) { setStepShimmer(false); return; }
    setStepShimmer(true);
    const t = setTimeout(() => setStepShimmer(false), STEP_SHIMMER_MS);
    return () => clearTimeout(t);
  }, [empStep, empOpen, empLoading]);
  const closeEmp = () => {
    baselineArmedRef.current = false;
    setEmpOpen(false);
    setEmpLoading(false);
    resetEmpForm();
    /* Step saves no longer refresh the table (nothing behind the modal is
       visible), so the refresh happens here instead — covering the abandoned
       case too, where steps were saved but the wizard was never completed. */
    reloadAfterMutation().catch(() => { /* table just stays stale */ });
    if (returnToOnClose) {
      const target = returnToOnClose;
      setReturnToOnClose(null);
      navigate(target);
    }
    onEmbedClose?.();
  };

  const [editingDbId, setEditingDbId] = useState<number | null>(null);
  const editingDbIdRef = useRef<number | null>(null);
  useEffect(() => { editingDbIdRef.current = editingDbId; }, [editingDbId]);

  const monthlyGrossFromSalary = useCallback((): number => {
    const amt = Number(eAnnualSalary) || 0;
    return eSalaryFreq === 'Per month' ? amt : amt / 12;
  }, [eAnnualSalary, eSalaryFreq]);

  useEffect(() => {
    if (!empOpen || empStep !== 4 || !eDetailedBreakup) return;
    const target: number | 'new' = editingDbId ?? 'new';
    if (breakupLoadedForRef.current === target) return;
    breakupLoadedForRef.current = target;

    /* Whatever the breakup ends up being below — freshly split or read back
       from the server — it belongs to THIS CTC. Recording that here is what
       stops the debounced re-seed from firing 500ms after the modal opens and
       overwriting a saved structure nobody touched. */
    seededForSalaryRef.current = eAnnualSalary;

    const monthlyGross = monthlyGrossFromSalary();
    const seedFresh = () => {
      setEEarnings(seedBreakup(monthlyGross));
      setEDeductions([]);
      /* Neither is auto-ticked. ESI eligibility is a wage-ceiling RULE, not a
         decision the form should make silently, and PT is state-levied — some
         states do not charge it at all. Both were arriving pre-enabled, which
         put deduction rows on the payslip that nobody chose. */
      setEEsiApplicable(false);
      setEPtApplicable(false);
      breakupBaselineRef.current = null;
    };

    if (typeof target === 'number') {
      setEBreakupLoading(true);
      api.get('/salary-structures', { params: { employee_id: target, active_only: 1 } })
        .then(res => {
          const rows = res.data?.data ?? [];
          const active = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (active && Array.isArray(active.earnings) && active.earnings.length) {
            const earn: SalBreakComp[] = active.earnings.map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 }));
            const ded: SalBreakComp[] = (active.deductions ?? []).map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 }));
            /* All three read the same way: absent / null means "not applicable".
               pt_applicable used to be `!== false`, so a legacy row that never
               stored the flag opened with Professional Tax already ticked and a
               zero-amount PT row failing validation on a form the user had not
               yet touched. */
            const pf = !!active.pf_applicable, esi = !!active.esi_applicable, pt = !!active.pt_applicable;
            setEEarnings(earn);
            setEDeductions(ded);
            setEPfEligible(pf);
            setEEsiApplicable(esi);
            setEPtApplicable(pt);
            breakupBaselineRef.current = breakupSignature(earn, ded, pf, esi, pt);
          } else {
            seedFresh();
          }
        })
        .catch(() => seedFresh())
        .finally(() => setEBreakupLoading(false));
    } else {
      seedFresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empOpen, empStep, eDetailedBreakup, editingDbId]);

  /* Annual CTC, settled — 500ms after the last keystroke.
     The re-seed below rebuilds Basic / HRA / Special from this figure, and it
     used to read the raw input: typing "120000" is six separate values, so the
     table was rebuilt six times and the reader watched Basic climb through
     ₹0.50, ₹5, ₹50, ₹500 … before landing. It went unnoticed while Detailed
     Breakup defaulted to OFF, because the toggle was flipped only after the CTC
     had been typed — so the seed ran once, on a finished number. Opening the
     section by default removed that accidental gate and put every intermediate
     value on screen.
     Only the seed waits; the CTC field itself, its validation and the
     annualised comparison stay live, so typing never feels laggy. */
  /* True from the moment the CTC is edited until the debounce lands. In that
     window every figure below belongs to the PREVIOUS CTC, so the section is
     covered rather than left showing stale money as though it were the answer —
     on a slow machine that gap is long enough to read. */
  const [breakupRecalcing, setBreakupRecalcing] = useState(false);

  const [settledSalary, setSettledSalary] = useState(eAnnualSalary);
  useEffect(() => {
    const t = setTimeout(() => {
      setSettledSalary(eAnnualSalary);
      /* Cleared HERE, on the timer, not in the re-seed effect below. Typing a
         digit and deleting it inside the 500ms leaves the settled value
         UNCHANGED — React bails out of the identical setState, the effect never
         re-runs, and the overlay it was going to clear stays over the section
         for good. This fires whether or not anything actually changed. */
      setBreakupRecalcing(false);
    }, 500);
    return () => clearTimeout(t);   // each keystroke cancels the pending seed
  }, [eAnnualSalary]);

  /* Re-seed Basic / HRA / Special whenever the CTC changes.
     The split IS the CTC expressed monthly, so leaving it behind when the CTC
     moves produced a breakup that had stopped describing the salary above it —
     an employee on ₹11,00,000 still showing ₹13,102/month, with the summary
     line reporting the gap and nothing acting on it.
     This used to bail out on `breakupDirtyRef`, which froze the split forever
     after the first manual edit, with no way back. That guard is gone; what
     survives an edit instead is anything HR ADDED, which is the part a formula
     cannot reproduce. A hand-typed Basic is overwritten — it is a value the
     CTC owns.

     `seededForSalaryRef` is what keeps this from firing on load. The effect
     watches a debounced value, so opening an employee would settle 500ms later
     and rewrite their SAVED structure without anyone touching the form. The
     ref records the CTC the current breakup belongs to; only a different one
     re-seeds. */
  useEffect(() => {
    /* Cleared before any guard below: once the debounce has landed the breakup
       is no longer waiting on a newer CTC, whether or not it re-seeds. Leaving
       this to the success path alone stranded the overlay on screen whenever a
       guard returned early (CTC retyped back to its old value, step switched
       mid-edit). */
    setBreakupRecalcing(false);
    if (!empOpen || empStep !== 4 || !eDetailedBreakup) return;
    if (breakupLoadedForRef.current === null) return; // initial seed not done yet
    if (seededForSalaryRef.current === settledSalary) return; // CTC unchanged
    seededForSalaryRef.current = settledSalary;
    const amt = Number(settledSalary) || 0;
    const monthlyGross = eSalaryFreq === 'Per month' ? amt : amt / 12;
    setEEarnings(prev => {
      // HR's own components are kept; the three derived ones are rebuilt.
      // Special then absorbs the kept ones so the re-seed lands ON the new CTC
      // rather than at CTC + whatever HR had added.
      const custom = prev.filter(c => !SPLIT_CODES.includes(c.code));
      return absorbIntoSpecial([...seedBreakup(monthlyGross), ...custom], monthlyGross);
    });
    /* Professional Tax is a function of the gross exactly like Basic / HRA, so a
       new CTC re-derives it too instead of leaving the old slab figure sitting
       against a salary it no longer belongs to. Same ownership rule as the
       split: between CTC changes the amount is HR's to edit. */
    setEDeductions(prev => prev.map(d => (
      d.code === 'pt' ? { ...d, amount: statutoryPt(monthlyGross, eGender) } : d
    )));
    /* The ESI toggle is deliberately NOT touched here. It used to be re-derived
       from the ₹21,000 wage ceiling on every salary keystroke, which fought the
       seed above (seedFresh leaves both statutory toggles off on purpose) and,
       worse, overwrote the user: untick ESI, adjust the CTC, and the box came
       back on with a zero-amount row and a validation error nobody asked for.
       ESI eligibility is a rule someone applies, not one the form decides. */
    /* settledSalary, NOT eAnnualSalary — depending on the raw value is what
       made this run per keystroke. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledSalary, eSalaryFreq]);

  const breakupGross = useMemo(() => eEarnings.reduce((s, c) => s + (Number(c.amount) || 0), 0), [eEarnings]);
  const breakupDed = useMemo(() => eDeductions.reduce((s, c) => s + (Number(c.amount) || 0), 0), [eDeductions]);
  /* Fixed deductions EXCLUDING the PF row, for the summary line that already
     reports PF on its own. PF is now a row in the list, so adding it to the
     "Fixed Deductions" figure would show the same rupee twice on screen. */
  const breakupDedExPf = useMemo(
    () => eDeductions.filter(c => c.code !== 'pf').reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [eDeductions],
  );
  // Live monthly PF estimate off the basic component — Statutory caps the
  // basic at the ₹15k EPF ceiling, Standard uses the full basic. Updates
  // whenever the PF Type / Applicable / basic figure changes.
  const breakupBasic = useMemo(
    () => Number(eEarnings.find(c => c.code === 'basic')?.amount) || 0,
    [eEarnings],
  );
  /* PF only applies while the employee is ON payroll. The PF Applicable field
     is hidden when the payroll toggle is off, but its value stays `true`
     underneath — so the PF row went on sitting in the deductions, and the ₹1,800
     went on coming off the net, for an employee who had just been taken off
     payroll and had no field on screen to turn it back off with. */
  const pfActive = eEnablePayroll && ePfEligible;
  /* PF = 12% of BASIC on the statutory basis — Statutory (or unset) caps the
     basic at the ₹15,000 EPF ceiling, so ₹1,800/mo; Standard uses the full
     basic. Mirrors PayrollService::computeForEmployee(); the figure shown here
     has to be the one payroll actually deducts. Shares pfDeduction() with the
     onboarding wizard and SalaryStructureModal so the three screens cannot
     quote different numbers for one employee — which is what the short-lived
     gross-based rule caused. */
  const breakupPf = useMemo(
    () => pfDeduction(breakupBasic, ePfType, pfActive),
    [breakupBasic, ePfType, pfActive],
  );
  // Net = Gross − PF estimate − fixed deductions. ESI / PT are NOT
  // auto-computed — they're added as editable rows in Fixed Deductions
  // (so they're part of breakupDed when present), filled by HR / accounts.
  /* PF is inside breakupDed now — subtracting it again here took it twice. */
  const breakupNet = useMemo(
    () => Math.max(0, breakupGross - breakupDed),
    [breakupGross, breakupDed],
  );

  // Compare the breakup's annualised gross (Monthly Gross × 12) against the
  // entered Salary Amount. Over the salary = red (components exceed the CTC);
  // at/under = green. `breakupDiff` is +over / −under (₹/year).
  const salaryAnnual = useMemo(() => Math.round(monthlyGrossFromSalary() * 12), [monthlyGrossFromSalary]);
  const breakupAnnual = useMemo(() => Math.round(breakupGross * 12), [breakupGross]);
  const breakupDiff = salaryAnnual > 0 ? breakupAnnual - salaryAnnual : 0; // + over, − under
  /* A gap inside the rounding slack is not a difference worth reporting — see
     CTC_ROUNDING_SLACK. Every comparison below reads this, so the red line, the
     colour and the save-time warning all agree. */
  const breakupMatches = Math.abs(breakupDiff) <= CTC_ROUNDING_SLACK;
  const breakupOverSalary = breakupDiff > CTC_ROUNDING_SLACK;

  // ESI / Professional Tax are entered manually: ticking the box drops a
  // labelled, free-input row into Fixed Deductions for HR/accounts to fill;
  // unticking removes it. No amount is auto-computed.
  useEffect(() => {
    setEDeductions(prev => {
      let next = prev;
      /* PT opens on its slab figure instead of ₹0. Seeded ONCE, at tick — it is
         deliberately not kept in step with the gross afterwards, because a
         figure that rewrites itself on every CTC keystroke is the same trap the
         ESI checkbox was pulled out of (see the CTC re-seed above).
         ESI seeds at ₹0 and is HR's to fill: its ceiling carries over across a
         contribution period, so the form does not have enough to derive it. */
      const sync = (on: boolean, code: string, label: string, seed: number) => {
        const has = next.some(d => d.code === code);
        if (on && !has) next = [...next, { code, label, amount: seed }];
        else if (!on && has) next = next.filter(d => d.code !== code);
      };
      sync(eEsiApplicable, 'esi', 'ESI', 0);
      sync(ePtApplicable, 'pt', 'Professional Tax', statutoryPt(breakupGross, eGender));

      /* PF joins the same list — it was only ever a note under the totals.
         ESI and PT already appeared as deduction rows, so a reader saw two of
         the three statutory deductions in the section and the third somewhere
         else, and the section did not add up to what was actually deducted.
         Unlike those two it is COMPUTED (12% of basic, capped for Statutory),
         so the row is kept in step with that figure rather than left for
         someone to type. */
      const pfIdx = next.findIndex(d => d.code === 'pf');
      if (pfActive) {
        const row = { code: 'pf', label: 'Provident Fund (PF)', amount: breakupPf };
        if (pfIdx < 0) next = [...next, row];
        else if (Number(next[pfIdx].amount) !== breakupPf) {
          next = next.map((d, i) => (i === pfIdx ? { ...d, ...row } : d));
        }
      } else if (pfIdx >= 0) {
        next = next.filter(d => d.code !== 'pf');
      }
      return next === prev ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eEsiApplicable, ePtApplicable, pfActive, breakupPf]);

  const breakupErrors = useMemo(
    () => validateBreakup(eEarnings, eDeductions, eDetailedBreakup),
    [eDetailedBreakup, eEarnings, eDeductions],
  );

  const updateBreakRow = (which: 'earn' | 'ded', i: number, field: 'label' | 'amount', value: string) => {
    const list = which === 'earn' ? eEarnings : eDeductions;
    const setList = which === 'earn' ? setEEarnings : setEDeductions;
    const next = [...list];
    if (field === 'amount') {
      if (value === '') {
        next[i] = { ...next[i], amount: 0 };
      } else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return;
        next[i] = { ...next[i], amount: n };
      }
    } else {
      next[i] = { ...next[i], label: value };
    }
    /* Editing one of HR's own earning rows re-funds it out of Special so the
       gross stays pinned to the CTC. Basic / HRA / Special themselves are left
       alone — rebalancing while someone types INTO Special would fight them. */
    if (which === 'earn' && !SPLIT_CODES.includes(next[i].code)) {
      setEEarnings(absorbIntoSpecial(next, monthlyGrossFromSalary()));
    } else {
      setList(next);
    }
    clearEErr('salary_breakup');
  };
  const addBreakRow = (which: 'earn' | 'ded') => {
    if (which === 'earn') setEEarnings([...eEarnings, { code: `comp_${eEarnings.length + 1}`, label: '', amount: 0 }]);
    else setEDeductions([...eDeductions, { code: `ded_${eDeductions.length + 1}`, label: '', amount: 0 }]);
  };
  const removeBreakRow = async (which: 'earn' | 'ded', i: number) => {
    const list = which === 'earn' ? eEarnings : eDeductions;
    const removed = list[i];
    const name = removed?.label?.trim() || 'this component';
    const ok = await confirmDialog({
      title: 'Remove component?',
      message: <>Remove <strong>{name}</strong> from the salary breakup? It’s applied when you save the employee.</>,
      tone: 'danger',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (which === 'earn') {
      const rest = eEarnings.filter((_, idx) => idx !== i);
      // Removing one of HR's own rows hands its money back to Special.
      setEEarnings(SPLIT_CODES.includes(removed?.code)
        ? rest
        : absorbIntoSpecial(rest, monthlyGrossFromSalary()));
    } else {
      setEDeductions(eDeductions.filter((_, idx) => idx !== i));
      // Removing the ESI / Professional Tax row also unticks its checkbox so
      // the two stay consistent.
      if (removed?.code === 'esi') setEEsiApplicable(false);
      if (removed?.code === 'pt') setEPtApplicable(false);
    }
    clearEErr('salary_breakup');
  };

  /* Ticking ESI / Professional Tax drops a Fixed Deduction row into the breakup
     and unticking takes it away — so a toggle changes what the breakup
     validation has to say about the form, exactly as editing, adding or
     removing a row does. Those three all clear the last "fix the highlighted
     components" message; the two checkboxes did not. Result: tick ESI → Next →
     error → untick ESI, and the offending row is gone but its error sentence
     stays on screen pointing at a row that no longer exists. */
  const setStatutoryToggle = (which: 'esi' | 'pt', on: boolean) => {
    (which === 'esi' ? setEEsiApplicable : setEPtApplicable)(on);
    clearEErr('salary_breakup');
  };

  /* A PT row already saved against this employee predates the seeding above (or
     was hand-typed to clear the old ₹0 validation error), so the amount on
     screen can differ from what the slab says. Surfaced with a one-click
     correction rather than silently rewritten — it is still HR's figure to set.
     ESI is left out: eligibility carries across a contribution period, so the
     form cannot tell a stale figure from a deliberate one. */
  /* The "Professional Tax is ₹X; the slab works out to ₹Y — Use slab figure"
     banner lived here. Removed: PT is a free-input field, so nagging that a
     deliberately typed figure differs from the slab was noise, and the button
     beside it could overwrite that figure in one click. What replaces it is a
     rule rather than a suggestion — PT is no longer in ZERO_OK_CODES, so the
     form refuses to save it at 0 (see utils/salaryBreakup). */

  const renderBreakTable = (which: 'earn' | 'ded', accent: string, heading: string) => {
    const list = which === 'earn' ? eEarnings : eDeductions;
    const errs = which === 'earn' ? breakupErrors.earnings : breakupErrors.deductions;
    return (
      <div>
        {/* Clean Earnings/Deductions column styled like the onboarding breakup
            (uppercase accent header, dashed-separator rows, ₹ right-aligned
            amounts) — but the name + amount stay editable inputs. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${accent}26`, paddingBottom: 5, marginBottom: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: accent }}>{heading}</span>
          <button type="button"
            style={{ fontSize: 11, fontWeight: 700, color: accent, background: `${accent}12`, border: `1px solid ${accent}33`, borderRadius: 8, padding: '3px 11px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            onClick={() => addBreakRow(which)}>
            <i className="ri-add-line" /> Add
          </button>
        </div>
        {list.length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: '9px 0' }}>No components.</div>}
        {list.map((c, i) => {
          const rowErr = errs[i];
          const underline = rowErr ? '#dc2626' : 'transparent';
          /* Statutory rows are owned by the control above them, not by this
             list: ESI / PT by their checkbox, PF by the PF Applicable picker.
             Their names are fixed and the delete button is replaced by a lock.
             PF was missing from this set and so carried a bin icon that did
             nothing — removeBreakRow dropped the row and the sync effect put it
             straight back, because PF Applicable was still Yes. */
          const locked = which === 'ded' && (c.code === 'esi' || c.code === 'pt' || c.code === 'pf');
          /* ESI and PT amounts are typed by HR / accounts. PF's is DERIVED
             (12% of basic, capped for Statutory) and re-synced whenever basic
             changes — so a typed value survived only until the next edit to the
             salary. Read-only says that up front instead. */
          const computedAmount = which === 'ded' && c.code === 'pf';
          const lockHint = c.code === 'pf'
            ? 'Set PF Applicable to No to remove this row'
            : 'Untick the box above to remove';
          return (
            <div key={i} style={{ padding: '5px 0', borderBottom: '1px dashed var(--vz-border-color, #e5e7eb)' }}>
              <div className="emp-break-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ flex: 2, minWidth: 0, border: 'none', borderBottom: `1px solid ${underline}`, background: 'transparent', fontSize: 12.5, fontWeight: 500, padding: '3px 2px', outline: 'none', color: 'var(--vz-body-color)' }}
                  placeholder="Component name"
                  maxLength={MAX_COMP_LABEL}
                  value={c.label}
                  readOnly={locked}
                  onChange={e => updateBreakRow(which, i, 'label', e.target.value)}
                  onFocus={e => { if (!rowErr) e.currentTarget.style.borderBottomColor = `${accent}66`; }}
                  onBlur={e => { e.currentTarget.style.borderBottomColor = rowErr ? '#dc2626' : 'transparent'; }}
                />
                <div style={{ display: 'flex', alignItems: 'center', position: 'relative', flex: 1, minWidth: 96 }}>
                  <span style={{ position: 'absolute', left: 2, fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>₹</span>
                  <input
                    type="number"
                    className="no-spin"
                    min={0}
                    max={MAX_COMP_AMOUNT}
                    step="0.01"
                    inputMode="decimal"
                    style={{ width: '100%', border: 'none', borderBottom: `1px solid ${underline}`, background: 'transparent', textAlign: 'right', fontSize: 13, fontWeight: 700, padding: '3px 2px 3px 15px', outline: 'none', color: computedAmount ? 'var(--vz-secondary-color)' : 'var(--vz-body-color)', cursor: computedAmount ? 'not-allowed' : undefined }}
                    value={c.amount}
                    readOnly={computedAmount} 
                    title={computedAmount ? 'Calculated from Basic Salary and PF Type — not editable' : undefined}
                    onChange={e => { if (!computedAmount) updateBreakRow(which, i, 'amount', e.target.value); }}
                    onFocus={e => { if (!rowErr) e.currentTarget.style.borderBottomColor = `${accent}66`; }}
                    onBlur={e => { e.currentTarget.style.borderBottomColor = rowErr ? '#dc2626' : 'transparent'; }}
                  />
                </div>
                {locked ? (
                  <span title={lockHint} style={{ color: '#9ca3af', padding: '2px 4px', flexShrink: 0, lineHeight: 1, fontSize: 13 }}>
                    <i className="ri-lock-line" />
                  </span>
                ) : (
                  <button type="button"
                    style={{ color: '#dc2626', background: 'transparent', border: 'none', padding: '2px 4px', cursor: 'pointer', flexShrink: 0, opacity: 0.65, lineHeight: 1 }}
                    onClick={() => removeBreakRow(which, i)} title="Remove">
                    <i className="ri-delete-bin-line" />
                  </button>
                )}
              </div>
              {rowErr && <small className="emp-err d-block" style={{ marginTop: 2 }}>{rowErr}</small>}
            </div>
          );
        })}
      </div>
    );
  };

  const persistBreakup = async (empId: number): Promise<void> => {
    if (!eDetailedBreakup) return;
    const earn = eEarnings
      .filter(c => c.label.trim() && Number(c.amount) >= 0)
      .map((c, i) => ({ code: (c.code || `comp_${i + 1}`).trim(), label: c.label.trim(), amount: Number(c.amount) || 0 }));
    if (!earn.length) return;
    const ded = eDeductions
      .filter(c => c.label.trim())
      .map((c, i) => ({ code: (c.code || `ded_${i + 1}`).trim(), label: c.label.trim(), amount: Number(c.amount) || 0 }));
    const sig = breakupSignature(earn, ded, ePfEligible, eEsiApplicable, ePtApplicable);
    if (breakupBaselineRef.current === sig) return;

    await api.post('/salary-structures', {
      employee_id: empId,
      effective_from: eSalaryFrom || new Date().toISOString().slice(0, 10),
      earnings: earn,
      deductions: ded,
      pf_applicable: ePfEligible,
      esi_applicable: eEsiApplicable,
      pt_applicable: ePtApplicable,
    });
    breakupBaselineRef.current = sig;
  };

  const mobileCheckTokenRef = useRef(0);

  const checkMobileUnique = useCallback(async (value: string): Promise<boolean> => {
    const v = (value || '').trim();
    const digits = v.replace(/\D/g, '');
    if (!v || digits.length < 6 || digits.length > 15) return true;

    const token = ++mobileCheckTokenRef.current;
    try {
      const params = new URLSearchParams({ mobile: v });
      const excludeId = editingDbIdRef.current;
      if (excludeId) params.set('exclude_employee_id', String(excludeId));
      const r = await api.get(`/employees/check-mobile?${params.toString()}`);
      if (token !== mobileCheckTokenRef.current) return true;
      if (r?.data?.available === false) {
        const msg = r.data.message || 'This mobile number is already in use.';
        setEErrors(prev => ({ ...prev, mobile: msg }));
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    if (!empOpen) return;
    let cancelled = false;
    const exclude = editingDbId ? `&exclude_employee_id=${editingDbId}` : '';
    const fetchCat = (cat: string, setter: (opts: AssetOpt[]) => void) =>
      api.get(`/employees/available-assets?category=${cat}${exclude}`)
        .then(r => {
          if (!cancelled) setter((r.data ?? []).map((a: any) => ({
            value: String(a.id),
            label: a.label || a.asset_name,
            /* Device still linked to this slot but re-categorised in the Asset
               master since (Laptop -> Mobile). Without this row the select had no
               option matching the saved id and fell back to printing the raw id. */
            ...(a.stale_category ? { badge: { text: 'Category changed', tone: 'red' as const } } : {}),
          })));
        })
        .catch(() => { if (!cancelled) setter([]); });
    Promise.allSettled([
      fetchCat('laptop', setLaptopAssetOpts),
      fetchCat('mobile', setMobileAssetOpts),
      fetchCat('other', setOtherAssetOpts),
    ]);
    return () => { cancelled = true; };
  }, [empOpen, editingDbId]);

  useEffect(() => {
    if (!empOpen) return;
    if (!editingDbId) { setEExistingDocs({}); return; }
    let cancelled = false;
    api.get(`/employees/${editingDbId}/documents`)
      .then(r => {
        if (cancelled) return;
        const map: Record<string, ServerDoc> = {};
        for (const d of (r.data ?? [])) map[d.document_key] = d;
        setEExistingDocs(map);
      })
      .catch(() => { if (!cancelled) setEExistingDocs({}); });
    return () => { cancelled = true; };
  }, [empOpen, editingDbId]);

  const isAcceptedFile = (file: File, accept: string): boolean => {
    if (!accept || !accept.trim()) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(spec => {
      if (spec.startsWith('.')) return name.endsWith(spec);
      if (spec.endsWith('/*')) return type.startsWith(spec.slice(0, -1));
      return type === spec;
    });
  };

  const uploadEmpDoc = async (docKey: string, docName: string, file: File) => {
    if (!editingDbId) {
      toast.error('Save the employee first', `Add the basic details, then come back to upload ${docName}.`);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large', `${docName} must be ≤ 2 MB`);
      return;
    }
    setEDocBusy(p => ({ ...p, [docKey]: true }));
    try {
      const fd = new FormData();
      fd.append('document_key', docKey);
      fd.append('document_name', docName);
      fd.append('file', file);
      const r = await api.post(`/employees/${editingDbId}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const saved = r.data?.document ?? r.data;
      if (saved?.document_key) {
        setEExistingDocs(p => ({ ...p, [saved.document_key]: saved }));
      }
      toast.success(`${docName} uploaded`, file.name);
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || err?.message || 'Try again');
    } finally {
      setEDocBusy(p => ({ ...p, [docKey]: false }));
    }
  };

  const [eErrors, setEErrors] = useState<Record<string, string>>({});
  const clearEErr = (key: string) => {
    setEErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const empScrollRef = useRef<HTMLDivElement>(null);

  const scrollToFirstError = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = empScrollRef.current;
      if (!root) return;
      const el = root.querySelector('.is-invalid, .has-error, .master-select-wrap.invalid, .emp-err');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = (el.closest('[class*="col"]') || el.parentElement)
        ?.querySelector('input:not([type="file"]), textarea') as HTMLElement | null;
      focusable?.focus?.({ preventScroll: true });
    }));
  };

  /* Reset the wizard body to the top on every step change.
   *
   * Each step used to inherit the OUTGOING step's scroll offset: fill in the
   * permanent-address block at the bottom of Step 1, hit Next, and Step 2
   * opened already scrolled — its first fields sitting above the viewport, so
   * the step looked like it started midway through.
   *
   * The page-level ScrollToTop in App.tsx can't help here: this modal body is
   * its own scroll container (maxHeight + overflowY on the div empScrollRef
   * points at), and the window itself never moves while the modal is open.
   *
   * No conflict with scrollToFirstError() — a failed validation leaves empStep
   * unchanged, so this only fires on a step that actually switched. */
  useEffect(() => {
    const el = empScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [empStep]);


  const proceedFresh = async () => {
    try {
      const r = await api.get('/employees/next-code');
      if (r?.data?.code) setEEmpId(r.data.code);
    } catch { /* server will still allocate at create time */ }
  };

  const openAddEmployee = async () => {
    resetEmpForm();
    setEmpMode('add');
    setEmpEditingName('');
    setEditingDbId(null);
    editingDbIdRef.current = null;
    savedPayloadRef.current = null;   // new record — nothing saved yet
    savedStepRef.current = 0;
    assignedPlanRef.current = null;
    setEmpOpen(true);
    await proceedFresh();
  };

  /* The wizard reads about sixty fields off the record — addresses, payroll,
     assets, policies — while the list only ever shows eleven columns. It used
     to take them from the row it was handed, which meant the list endpoint had
     to carry the whole employee for every row on screen just in case one of
     them was edited (including bank and PAN details that nothing renders).
     Fetching the one record being opened costs a single fast call and lets the
     list payload be a list payload. The row's own copy is kept as a fallback so
     a failed fetch still opens a usable form rather than a blank one. */
  /* `preloaded` — the full record when the caller already has it (the deep-link
     from Onboarding fetches it to find the id in the first place). Without it
     that path asked for the same row twice, and the second request was in front
     of the fields the user was waiting on. */
  const openEditEmployee = async (row: EmployeeRow, preloaded?: ApiEmployee) => {
    const dbId = (row as any)._dbId as number | undefined;
    let raw = preloaded ?? ((row as any)._raw as ApiEmployee | undefined);

    /* Open on the click, fill when the record lands.
       The fetch used to sit in front of setEmpOpen, so Edit did nothing at all
       until the response came back — imperceptible against a local API and a
       dead button against a real one, where people click it again. The dialog
       now appears immediately with a skeleton in place of the fields. */
    resetEmpForm();
    setEmpMode('edit');
    setEmpEditingName(row.name);
    setEditingDbId(dbId ?? null);
    editingDbIdRef.current = dbId ?? null;
    /* Opening an existing record. No fingerprint YET — the form is populated
       asynchronously, so one taken here would capture empty fields and then
       differ from every later state, which is worse than having none.

       Instead the baseline is armed and taken once the form settles (see the
       effect below). Without it the first Save & Next always wrote, even on a
       record nobody had touched: the skip needs something to compare against,
       and the very first comparison had nothing. */
    savedPayloadRef.current = null;
    savedStepRef.current = 0;
    baselineArmedRef.current = true;
    assignedPlanRef.current = null;
    setEmpOpen(true);

    if (dbId && !preloaded) {
      setEmpLoading(true);
      try {
        const r = await api.get(`/employees/${dbId}`);
        raw = (r.data?.employee ?? r.data ?? raw) as ApiEmployee | undefined;
      } catch {
        toast.warning('Opened with partial details', 'Could not load the full record — check the fields before saving.');
      } finally {
        setEmpLoading(false);
      }
    } else if (preloaded) {
      /* The caller already paid for the record, so there is nothing to wait
         for — but the shell it opened may have turned the skeleton on, and
         only the fetch branch above ever turns it off. */
      setEmpLoading(false);
    }

    if (raw) {
      setEFirstName(raw.first_name || '');
      setEMiddleName(raw.middle_name || '');
      setELastName(raw.last_name || '');
      setEDisplayName(raw.display_name || row.name);
      setEDisplayNameTouched(false);
      const savedActual = [raw.first_name, raw.middle_name, raw.last_name]
        .filter(Boolean).join(' ').trim() || raw.display_name || row.name;
      setEActualName(savedActual);
      // Editable when editing an existing employee too (not locked). Marked as
      // "touched" so typing in First/Middle/Last name won't silently overwrite
      // the saved value — the HR user edits the actual name directly.
      setEActualNameLocked(false);
      setEActualNameTouched(true);
      setEWorkEmail(raw.email || '');
      setEMobile(raw.mobile || '');
      setEEmpId(raw.emp_code || '');
      setEStatus(raw.status || 'Active');
      setEGender(raw.gender || '');
      setEDob(raw.date_of_birth ? String(raw.date_of_birth).slice(0, 10) : '');
      setEWorkCountry(raw.work_country_id ? String(raw.work_country_id) : '');
      setENationality(raw.nationality_country_id ? String(raw.nationality_country_id) : '');
      setECurAddr1(raw.address_line1 || '');
      setECurAddr2(raw.address_line2 || '');
      setECurCity(raw.city || '');
      setECurCountry(raw.country_id ? String(raw.country_id) : '');
      setECurState(raw.state_id ? String(raw.state_id) : '');
      setECurPin(raw.pincode || '');
      setEJoinDate(raw.date_of_joining ? String(raw.date_of_joining).slice(0, 10) : '');
      setEJoinDateOrig(raw.date_of_joining ? String(raw.date_of_joining).slice(0, 10) : '');
      setEDept(raw.department_id ? String(raw.department_id) : '');
      setEDesignation(raw.designation_id ? String(raw.designation_id) : '');
      setEPrimaryRole(raw.primary_role_id ? String(raw.primary_role_id) : '');
      setEAncillaryRole(
        Array.isArray(raw.ancillary_role_ids) && raw.ancillary_role_ids.length > 0
          ? raw.ancillary_role_ids.map(String)
          : (raw.ancillary_role_id ? [String(raw.ancillary_role_id)] : [])
      );
      setEWorkType(raw.work_type || '');
      setELegalEntity(raw.legal_entity_id ? String(raw.legal_entity_id) : '');
      // Label straight off the row — the saved entity may sit outside the
      // branch-scoped options list this user can see.
      setELegalEntityLabel(raw.legal_entity?.name || '');
      setELocation(raw.location || '');
      const mgrUserId = raw.reporting_manager_user_id;
      const mgrUserType = raw.reporting_manager_user?.user_type;
      if (raw.reporting_manager_id && raw.reporting_manager) {
        setEReportingMgr(`employee:${raw.reporting_manager_id}`);
        const m = raw.reporting_manager;
        const nm = m.display_name
          || [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
          || `Employee #${raw.reporting_manager_id}`;
        const desig = m.designation?.name?.trim() || 'Employee';
        setSavedMgrOption({ value: `employee:${raw.reporting_manager_id}`, label: `${nm} (${desig})` });
      } else if (mgrUserId && mgrUserType && raw.reporting_manager_user) {
        setEReportingMgr(`${mgrUserType}:${mgrUserId}`);
        const u = raw.reporting_manager_user;
        const nm = u?.name || u?.email || `User #${mgrUserId}`;
        const desig = u?.designation?.trim()
          || mgrUserType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        setSavedMgrOption({ value: `${mgrUserType}:${mgrUserId}`, label: `${nm} (${desig})` });
      } else {
        setEReportingMgr('');
        setSavedMgrOption(null);
      }
      setEProbationPolicy(raw.probation_policy || '');
      setENoticePeriod(raw.notice_period || '');

      setEPermAddr1(raw.perm_address_line1 || '');
      setEPermAddr2(raw.perm_address_line2 || '');
      setEPermCity(raw.perm_city || '');
      setEPermCountry(raw.perm_country_id ? String(raw.perm_country_id) : '');
      setEPermState(raw.perm_state_id ? String(raw.perm_state_id) : '');
      setEPermPin(raw.perm_pincode || '');
      setESameAsCurrent(
        !!raw.perm_address_line1 && raw.perm_address_line1 === raw.address_line1
        && raw.perm_pincode === raw.pincode
        && String(raw.perm_country_id ?? '') === String(raw.country_id ?? '')
      );

      if (raw.leave_plan !== undefined && raw.leave_plan !== null) setELeavePlan(raw.leave_plan);
      if (raw.holiday_group_id) setEHolidayList(String(raw.holiday_group_id));
      else setEHolidayList('');
      if (raw.attendance_tracking !== undefined && raw.attendance_tracking !== null) setEAttendanceTracking(!!raw.attendance_tracking);
      if (raw.shift !== undefined && raw.shift !== null) setEShift(raw.shift);
      if (raw.weekly_off !== undefined && raw.weekly_off !== null) setEWeeklyOff(raw.weekly_off);
      if (raw.attendance_number !== undefined && raw.attendance_number !== null) setEAttendanceNumber(raw.attendance_number);
      if (raw.overtime !== undefined && raw.overtime !== null) setEOvertime(raw.overtime);
      { const otv = String(raw.overtime ?? '').trim(); setEOvertimeApplicable(otv && otv.toLowerCase() !== 'not applicable' ? 'Yes' : 'No'); }
      if (raw.expense_policy !== undefined && raw.expense_policy !== null) setEExpensePolicy(raw.expense_policy);
      if (raw.laptop_assigned !== undefined && raw.laptop_assigned !== null) setELaptopAssigned(raw.laptop_assigned);
      if (raw.laptop_asset_id !== undefined && raw.laptop_asset_id !== null) setELaptopAssetId(raw.laptop_asset_id);
      if (raw.mobile_device !== undefined && raw.mobile_device !== null) setEMobileDevice(raw.mobile_device);
      if (raw.other_assets !== undefined && raw.other_assets !== null) setEOtherAssets(raw.other_assets);
      setELaptopMasterAssetId(raw.laptop_master_asset_id ? String(raw.laptop_master_asset_id) : '');
      /* Stored flag first. This used to be derived purely from whether a device
         had been picked, so a "Yes" set in the Onboarding wizard — where a
         device is optional — always read back as "No" here. */
      setEMobileAssigned(String((raw as any).mobile_assigned ?? '')
        || (raw.mobile_master_asset_id || raw.mobile_device ? 'Yes' : 'No'));
      setEMobileMasterAssetId(raw.mobile_master_asset_id ? String(raw.mobile_master_asset_id) : '');
      setEOtherMasterAssetIds(Array.isArray(raw.other_master_asset_ids)
        ? raw.other_master_asset_ids.map((n: any) => String(n))
        : []);

      if (raw.enable_payroll !== undefined && raw.enable_payroll !== null) setEEnablePayroll(!!raw.enable_payroll);
      if (raw.pay_group !== undefined && raw.pay_group !== null) setEPayGroup(raw.pay_group);
      /* The column carries two decimals, so a whole-rupee CTC comes back as
         "300000888.00". The field is whole-rupee now, so those trailing zeros
         are dropped rather than shown as a value the form would then reject on
         open. A saved figure that really does carry paise is left as it is for
         validation to flag — silently rounding someone's stored CTC is worse
         than telling them about it. */
      if (raw.annual_salary !== undefined && raw.annual_salary !== null) {
        const n = Number(raw.annual_salary);
        setEAnnualSalary(Number.isInteger(n) ? String(n) : String(raw.annual_salary));
      }
      /* Always 'Per annum' — the stored value is deliberately ignored.
         The frequency picker was removed and the field is now labelled
         "Annual CTC", so whatever HR types there is a yearly figure. This line
         used to read the column back (`raw.salary_frequency || 'Per annum'`),
         which left legacy rows still carrying 'Per month' driving the maths:
         EMP-013 shows ₹1,20,000 in a box that says ANNUAL CTC while the
         summary compares against ₹14,40,000, because monthlyGrossFromSalary()
         took the 1,20,000 as a MONTHLY figure and multiplied by 12.
         The comment in validateStep4 already claimed this was "defaulted to
         'Per annum' on load/reset" — it just was not. */
      setESalaryFreq('Per annum');
      if (raw.salary_effective_from) setESalaryFrom(String(raw.salary_effective_from).slice(0, 10));
      if (raw.bonus_in_annual !== undefined && raw.bonus_in_annual !== null) setEBonusInAnnual(!!raw.bonus_in_annual);
      if (raw.pf_eligible !== undefined && raw.pf_eligible !== null) setEPfEligible(!!raw.pf_eligible);
      setEPfType(String(raw.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory');
      if (raw.detailed_breakup !== undefined && raw.detailed_breakup !== null) setEDetailedBreakup(!!raw.detailed_breakup);
    } else {
      const parts = row.name.split(' ');
      setEFirstName(parts[0] || '');
      setELastName(parts.slice(1).join(' ') || '');
      setEDisplayName(row.name);
      setEDisplayNameTouched(true);
      setEActualName(row.name);
      setEWorkEmail(row.email);
      setEEmpId(row.id);
      setEStatus(row.enabled ? 'Active' : 'Inactive');
    }

    const lastStep = Math.max(0, Math.min(4, Number((raw as any)?.wizard_step_completed ?? 0)));
    /* What the SERVER already has. Left at 0 the skip could never fire on the
       first step, because progress would always look like it still had to be
       written — even for a record that finished the wizard weeks ago. */
    savedStepRef.current = lastStep;
    const resumeAt: 1 | 2 | 3 | 4 =
      lastStep === 0 || lastStep === 4 ? 1 : (((lastStep + 1) as 1 | 2 | 3 | 4));
    setEmpStep(resumeAt);
    const maxStep: 1 | 2 | 3 | 4 =
      lastStep === 4 ? 4 : lastStep === 0 ? 1 : (((lastStep + 1) as 1 | 2 | 3 | 4));
    setEmpMaxStep(maxStep);
    // The dialog is already open — see the top of this function.
  };

  const validateStep1 = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};

    const emailRe = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
    if (!eWorkCountry) e.work_country_id = 'Work country is required';

    const NAME_RE = /^[A-Za-z ]+$/;
    const nameError = (val: string, label: string): string | null => {
      const v = val.trim();
      if (!NAME_RE.test(v)) return `${label} may contain letters and spaces only`;
      if (v.length < 2) return `${label} must be at least 2 characters`;
      if (v.length > 50) return `${label} must be at most 50 characters`;
      return null;
    };
    if (!eFirstName.trim()) e.first_name = 'First name is required';
    else { const m = nameError(eFirstName, 'First name'); if (m) e.first_name = m; }
    if (!eLastName.trim()) e.last_name = 'Last name is required';
    else { const m = nameError(eLastName, 'Last name'); if (m) e.last_name = m; }
    if (eMiddleName.trim()) { const m = nameError(eMiddleName, 'Middle name'); if (m) e.middle_name = m; }
    if (!eDisplayName.trim()) e.display_name = 'Display name is required';
    if (!eActualName.trim()) e.actual_name = 'Employee actual name is required';
    if (!eGender) e.gender = 'Gender is required';
    if (!eDob) {
      e.date_of_birth = 'Date of birth is required';
    } else {
      const dob = new Date(eDob);
      if (isNaN(dob.getTime())) {
        e.date_of_birth = 'Enter a valid date of birth';
      } else {
        const today = new Date();
        if (dob > today) {
          e.date_of_birth = 'Date of birth cannot be in the future';
        } else {
          let age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
          }
          if (age < 18) {
            e.date_of_birth = 'Employee must be at least 18 years old';
          } else if (age > 100) {
            e.date_of_birth = 'Enter a valid date of birth';
          }
        }
      }
    }
    if (!eNationality) e.nationality_country_id = 'Nationality is required';
    if (!eWorkEmail.trim()) {
      e.email = 'Email is required';
    } else {
      const em = eWorkEmail.trim();
      if (/\s/.test(em)) e.email = 'Email cannot contain spaces';
      else if (em !== em.toLowerCase()) e.email = 'Email must be in lowercase';
      else if (!emailRe.test(em)) e.email = 'Enter a valid email address';
    }
    if (!eMobile.trim()) {
      e.mobile = 'Mobile is required';
    } else {
      const digits = eMobile.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 15) {
        e.mobile = 'Mobile must be 6–15 digits';
      }
    }
    if (!eCurAddr1.trim()) e.address_line1 = 'Address Line 1 is required';
    if (!eCurCity.trim()) e.city = 'City is required';
    if (!eCurCountry) e.country_id = 'Country is required';
    if (!eCurState) e.state_id = 'State is required';
    if (!eCurPin.trim()) e.pincode = 'Pincode is required';
    else if (!/^\d{6}$/.test(eCurPin.trim())) e.pincode = 'Pincode must be exactly 6 digits';

    // Permanent address is mandatory too — but only when it's NOT mirrored
    // from the current address (the "Same as Current Address" toggle copies
    // the already-validated current values).
    if (!eSameAsCurrent) {
      if (!ePermAddr1.trim()) e.perm_address_line1 = 'Address Line 1 is required';
      if (!ePermCity.trim()) e.perm_city = 'City is required';
      if (!ePermCountry) e.perm_country_id = 'Country is required';
      if (!ePermState) e.perm_state_id = 'State is required';
      if (!ePermPin.trim()) e.perm_pincode = 'Pincode is required';
      else if (!/^\d{6}$/.test(ePermPin.trim())) e.perm_pincode = 'Pincode must be exactly 6 digits';
    }
    return e;
  }, [eWorkCountry, eFirstName, eLastName, eDisplayName, eActualName, eGender, eDob, eNationality,
    eWorkEmail, eMobile, eCurAddr1, eCurCity, eCurCountry, eCurState, eCurPin, eMiddleName,
    eSameAsCurrent, ePermAddr1, ePermCity, ePermCountry, ePermState, ePermPin]);

  /* The date the record already carried, and today. Kept together because the
     no-back-dating rule needs both: one to decide whether the user changed it,
     the other to decide whether the new value is in the past. */
  const [eJoinDateOrig, setEJoinDateOrig] = useState('');
  const todayIso = new Date().toISOString().slice(0, 10);

  const validateStep2 = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!eJoinDate) e.date_of_joining = 'Joining date is required';
    /* No back-dating — but only for a date the user is actually setting.
       Every existing employee joined in the past, so a blanket rule would make
       their record un-editable: step 2 would refuse to advance until a correct
       historical date was falsified. Compared against what the record already
       held, so an untouched past date passes and a newly chosen one does not. */
    else if (eJoinDate < todayIso && eJoinDate !== eJoinDateOrig) {
      e.date_of_joining = 'Joining date can’t be in the past';
    }
    if (!eDept) e.department_id = 'Department is required';
    if (!eDesignation) e.designation_id = 'Designation is required';
    if (!ePrimaryRole) e.primary_role_id = 'Primary role is required';
    // A role can't be both Primary and Ancillary for the same employee.
    else if (eAncillaryRole.includes(ePrimaryRole)) e.primary_role_id = 'The Primary role cannot also be an Ancillary role.';
    if (!eWorkType) e.work_type = 'Work type is required';
    // Auto-fetched, so it can only be empty when no single branch resolved
    // (client_admin on "All Branches") — say what to do rather than "required".
    if (!eLegalEntity) e.legal_entity_id = 'Pick a branch in the branch switcher — the legal entity is taken from it';
    // Reporting manager is required; the POSITION-hierarchy eligibility is
    // enforced by the filtered dropdown (only strictly-higher positions are
    // selectable) and by the server on save, so no extra check is needed here.
    if (!eReportingMgr) e.reporting_manager_id = 'Reporting manager is required';
    if (!eProbationPolicy) e.probation_policy = 'Probation policy is required';
    if (eProbationPolicy === CUSTOM_PROBATION_VALUE) {
      const n = parseInt(eCustomProbation, 10);
      if (!eCustomProbation.trim()) e.probation_policy = 'Please enter the probation months (1–12)';
      else if (!Number.isInteger(n) || n < 1 || n > 12) e.probation_policy = 'Probation months must be between 1 and 12';
    }
    if (!eNoticePeriod) e.notice_period = 'Notice period is required';
    if (eNoticePeriod === CUSTOM_NOTICE_VALUE) {
      /* Free text ("45 Days", "2 months"), so the number is read out of it
         rather than typed into a number field. It only had a non-empty check,
         which let "0" through — and a zero-day notice period is not a notice
         period, it is an immediate exit dressed up as one. */
      const txt = eCustomNotice.trim();
      /* `-?` is not decoration. Without it the pattern matches only DIGITS, so
         "-1" yielded the substring "1" -> num 1 -> the `num < 1` guard below
         saw a valid one-day notice and let a NEGATIVE notice period through.
         Reading the sign is what makes that guard mean anything. A range like
         "1-2 months" is unaffected: the scan still finds "1" first. */
      const num = Number((txt.match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
      if (!txt) e.notice_period = 'Please describe the custom notice period';
      else if (!Number.isFinite(num)) e.notice_period = 'Include a number, e.g. 45 Days';
      else if (num < 1) e.notice_period = 'Notice period must be at least 1';
    }
    return e;
  }, [eJoinDate, eDept, eDesignation, ePrimaryRole, eWorkType, eLegalEntity, eReportingMgr,
    eProbationPolicy, eCustomProbation, eNoticePeriod, eCustomNotice]);

  const validateStep3 = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};
    const existing = eExistingDocsRef.current;

    if (leavePlanOptions.length > 0 && !eLeavePlan) {
      e.leave_plan = 'Leave plan is required';
    }
    if (holidayGroupOptions.length > 0 && !eHolidayList) {
      e.holiday_list = 'Holiday group is required';
    }
    if (!eShift) e.shift = 'Shift is required';
    if (!eWeeklyOff) e.weekly_off = 'Weekly off is required';
    if (!eExpensePolicy) e.expense_policy = 'Expense policy is required';
    /* Answering "Overtime Applicable = Yes" and leaving the rate blank saved an
       employee marked for overtime with nothing to pay it at — payroll then
       computes OT hours it cannot price. The field already appears only when
       the answer is Yes; it just was not required. */
    if (eOvertimeApplicable === 'Yes' && !eOvertime) {
      e.overtime = 'Overtime rate is required when overtime is applicable';
    }

    if (!eAadharFile && !existing['aadhaar']) {
      e.doc_aadhaar = 'Aadhar Card upload is required';
    }
    if (!ePanFile && !existing['pan']) {
      e.doc_pan = 'PAN Card upload is required';
    }
    if (eLaptopAssigned === 'Yes' && !eLaptopMasterAssetId) {
      e.laptop_master_asset_id = 'Laptop Device is required';
    }
    if (eMobileAssigned === 'Yes' && !eMobileMasterAssetId) {
      e.mobile_master_asset_id = 'Mobile Device is required';
    }
    return e;
  }, [eAadharFile, ePanFile, eLaptopAssigned, eLaptopMasterAssetId, eMobileAssigned, eMobileMasterAssetId,
    leavePlanOptions, holidayGroupOptions, eLeavePlan, eHolidayList, eShift, eWeeklyOff, eExpensePolicy,
    eOvertimeApplicable, eOvertime]);

  /* Keep the salary effective date locked to the joining date.
     The field on screen is read-only, but the VALUE still has to be written —
     it is what the payload turns into salary_structures.effective_from, and
     editing the joining date has to carry through rather than leaving the old
     date behind on the structure. */
  useEffect(() => {
    setESalaryFrom(prev => (prev === (eJoinDate || '') ? prev : (eJoinDate || '')));
    clearEErr('salary_effective_from');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eJoinDate]);

  /* `salaryEffectiveCap` (joining + 6 months) is gone with the free date
     picker it bounded — the effective date is now the joining date itself, so
     there is no range left to cap. */

  // Probation length + end date, derived live from the joining date and the
  // selected probation policy. Stored on save so the daily probation-completion
  // email job just reads probation_end_date (no backend recalculation).
  const probationInfo = useMemo(() => {
    const policyText = eProbationPolicy === CUSTOM_PROBATION_VALUE ? eCustomProbation : eProbationPolicy;
    return resolveProbation(policyText, eJoinDate);
  }, [eJoinDate, eProbationPolicy, eCustomProbation]);

  const validateStep4 = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!eEnablePayroll) return e;
    // Distinct messages per failure — "required" was previously also shown for
    // a typed 0, which reads as wrong ("I did enter something"). Blank, zero /
    // negative, and over-cap are three different mistakes and each gets told
    // what to do about it.
    const amt = Number(eAnnualSalary);
    if (eAnnualSalary.trim() === '') {
      e.annual_salary = 'Annual CTC is required';
    } else if (!Number.isFinite(amt)) {
      e.annual_salary = 'Annual CTC must be a valid number';
    } else if (amt <= 0) {
      e.annual_salary = 'Annual CTC must be greater than 0';
    } else if (!Number.isInteger(amt)) {
      e.annual_salary = 'Annual CTC must be a whole number (no paise)';
    } else if (amt > 999999999999) {
      e.annual_salary = 'Annual CTC must be ≤ 999,999,999,999';
    }
    // Frequency picker was removed — salary is always entered "Per annum",
    // so it's never user-editable and must not block the form. (Defaulted to
    // 'Per annum' on load/reset.)
    /* Same rule as the onboarding wizard: the first salary runs from the day
       the employee joined, so this date IS the joining date. The field mirrors
       it and is read-only; this still checks, because a record saved before
       the rule existed — or a direct API write — can arrive with the two out
       of step. */
    if (!eJoinDate) {
      e.salary_effective_from = 'Set the joining date — the salary effective date follows it';
    } else if (!eSalaryFrom) {
      e.salary_effective_from = 'Effective-from date is required';
    } else if (eSalaryFrom !== eJoinDate) {
      e.salary_effective_from = 'Salary effective date must be the same as the joining date';
    }
    if (eDetailedBreakup) {
      const hasRowErrors = Object.keys(breakupErrors.earnings).length > 0
        || Object.keys(breakupErrors.deductions).length > 0;
      if (hasRowErrors) {
        e.salary_breakup = 'Fix the highlighted salary components';
      } else if (breakupErrors.form) {
        e.salary_breakup = breakupErrors.form;
      }
    }
    return e;
  }, [eEnablePayroll, eAnnualSalary, eSalaryFreq, eSalaryFrom, eJoinDate, eDetailedBreakup, breakupErrors]);

  const firstStepWithErrors = (errs: Record<string, string>): 1 | 2 | 3 | 4 | null => {
    if (Object.keys(errs).length === 0) return null;
    const k = Object.keys(errs);
    const STEP_KEYS: Array<{ step: 1 | 2 | 3 | 4; keys: Set<string> }> = [
      { step: 1, keys: new Set(['work_country_id', 'first_name', 'middle_name', 'last_name', 'display_name', 'actual_name', 'gender', 'date_of_birth', 'nationality_country_id', 'email', 'mobile', 'address_line1', 'city', 'country_id', 'state_id', 'pincode']) },
      { step: 2, keys: new Set(['date_of_joining', 'department_id', 'designation_id', 'primary_role_id', 'legal_entity_id', 'probation_policy', 'notice_period']) },
      { step: 3, keys: new Set(['leave_plan', 'holiday_list', 'shift', 'weekly_off', 'expense_policy', 'overtime', 'doc_aadhaar', 'doc_pan', 'laptop_master_asset_id', 'mobile_master_asset_id']) },
      { step: 4, keys: new Set(['annual_salary', 'salary_frequency', 'salary_effective_from', 'salary_breakup']) },
    ];
    for (const s of STEP_KEYS) {
      if (k.some(x => s.keys.has(x))) return s.step;
    }
    return 1;
  };

  const buildEmployeePayload = (stepCompleted: number): Record<string, any> => {
    const intOrNull = (s: string | null | undefined) => {
      const n = parseInt(String(s ?? ''), 10);
      return Number.isFinite(n) ? n : null;
    };
    return {
      first_name: eFirstName.trim(),
      middle_name: eMiddleName.trim() || null,
      last_name: eLastName.trim() || null,
      gender: eGender || null,
      date_of_birth: eDob || null,
      nationality_country_id: intOrNull(eNationality),
      work_country_id: intOrNull(eWorkCountry),
      email: eWorkEmail.trim(),
      mobile: eMobile.trim() || null,

      address_line1: eCurAddr1.trim() || null,
      address_line2: eCurAddr2.trim() || null,
      city: eCurCity.trim() || null,
      state_id: intOrNull(eCurState),
      country_id: intOrNull(eCurCountry),
      pincode: eCurPin.trim() || null,

      perm_address_line1: (eSameAsCurrent ? eCurAddr1 : ePermAddr1).trim() || null,
      perm_address_line2: (eSameAsCurrent ? eCurAddr2 : ePermAddr2).trim() || null,
      perm_city: (eSameAsCurrent ? eCurCity : ePermCity).trim() || null,
      perm_state_id: intOrNull(eSameAsCurrent ? eCurState : ePermState),
      perm_country_id: intOrNull(eSameAsCurrent ? eCurCountry : ePermCountry),
      perm_pincode: (eSameAsCurrent ? eCurPin : ePermPin).trim() || null,

      department_id: intOrNull(eDept),
      designation_id: intOrNull(eDesignation),
      primary_role_id: intOrNull(ePrimaryRole),
      ancillary_role_ids: eAncillaryRole.map(v => Number(v)).filter(n => Number.isFinite(n)),
      work_type: eWorkType || null,
      legal_entity_id: intOrNull(eLegalEntity),
      location: eLocation || null,
      reporting_manager_id: (() => {
        if (!eReportingMgr) return null;
        const [kind, idStr] = String(eReportingMgr).split(':');
        if (kind !== 'employee') return null;
        return intOrNull(idStr);
      })(),
      reporting_manager_user_id: (() => {
        if (!eReportingMgr) return null;
        const [kind, idStr] = String(eReportingMgr).split(':');
        if (kind === 'employee') return null;
        return intOrNull(idStr);
      })(),
      date_of_joining: eJoinDate || null,
      probation_policy: eProbationPolicy === CUSTOM_PROBATION_VALUE ? (eCustomProbation || 'Custom') : eProbationPolicy,
      probation_months: probationInfo.months,
      probation_end_date: probationInfo.endIso || null,
      notice_period: eNoticePeriod === CUSTOM_NOTICE_VALUE ? (eCustomNotice || 'Custom') : eNoticePeriod,
      designation_name: mDesignations.find(d => String(d.id) === String(eDesignation))?.name,

      leave_plan: eLeavePlan || null,
      holiday_group_id: eHolidayList ? Number(eHolidayList) : null,
      holiday_list: mHolidayGroups.find(g => String(g.id) === String(eHolidayList))?.name || null,
      attendance_tracking: !!eAttendanceTracking,
      shift: eShift || null,
      weekly_off: eWeeklyOff || null,
      attendance_number: eAttendanceNumber.trim() || null,
      overtime: eOvertime || null,
      expense_policy: eExpensePolicy || null,
      laptop_assigned: eLaptopAssigned || null,
      mobile_assigned: eMobileAssigned || null,
      laptop_asset_id: eLaptopAssetId.trim() || null,
      mobile_device: eMobileDevice.trim() || null,
      other_assets: eOtherAssets.trim() || null,
      laptop_master_asset_id: eLaptopAssigned === 'Yes' ? intOrNull(eLaptopMasterAssetId) : null,
      mobile_master_asset_id: eMobileAssigned === 'Yes' ? intOrNull(eMobileMasterAssetId) : null,
      other_master_asset_ids: eOtherMasterAssetIds.map(v => parseInt(v, 10)).filter(n => Number.isFinite(n)),

      enable_payroll: !!eEnablePayroll,
      pay_group: ePayGroup || null,
      annual_salary: eAnnualSalary === '' ? null : Number(eAnnualSalary),
      salary_frequency: eSalaryFreq || null,
      salary_effective_from: eSalaryFrom || null,
      bonus_in_annual: !!eBonusInAnnual,
      pf_eligible: !!ePfEligible,
      pf_type: ePfEligible ? ePfType.toLowerCase() : null,
      detailed_breakup: !!eDetailedBreakup,

      status: eStatus || 'Inactive',

      wizard_step_completed: stepCompleted,
    };
  };

  /* Serialised payload as it stood after the last successful save — the baseline
     a "Save & Next" is compared against.

     The wizard posted on every Next whether or not anything had been edited. The
     server then validated all 104 fields, ran its permission and uniqueness
     checks — 29 queries — and Eloquent wrote nothing, because nothing was dirty.
     Clicking through an edit to reach step 3 paid that round trip twice for two
     steps the user never touched.

     Compared as the PAYLOAD rather than the form state on purpose:
     buildEmployeePayload trims strings and turns '' into null, so two states that
     differ on screen can be identical once normalised. Comparing raw inputs would
     report a change that does not exist and save anyway. */
  const savedPayloadRef = useRef<Record<string, any> | null>(null);
  /** Highest wizard_step_completed the SERVER has stored for this record. */
  const savedStepRef = useRef<number>(0);
  /** Leave plan already posted for this record, so it is not re-sent each step. */
  const assignedPlanRef = useRef<number | null>(null);
  /** An existing record is loading and still owes us its opening fingerprint. */
  const baselineArmedRef = useRef(false);

  /* Keys whose value differs from the last successful save.

     wizard_step_completed is excluded on purpose — it increments on every Next,
     so counting it would make every step look "changed" and defeat both the skip
     and the diff. Whether progress needs persisting is tracked by savedStepRef.

     Compared with JSON.stringify per key because several values are arrays
     (other_master_asset_ids) or nulls; === would report every array as changed. */
  const changedKeys = (
    base: Record<string, any>,
    next: Record<string, any>,
  ): string[] =>
    Object.keys(next).filter(k =>
      k !== 'wizard_step_completed'
      && JSON.stringify(next[k]) !== JSON.stringify(base[k]));

  /* Fingerprint an opened record once its form stops moving.

     Timing is the whole difficulty. The fields are filled from the API in one
     commit, but several values are DERIVED from them a commit later — display
     name from the name parts, salary date from the joining date, the legal
     entity from the branch. A fingerprint taken on the first commit would
     predate those, so an untouched form would still read as changed and save
     anyway, which is the bug this is here to fix.

     So the snapshot is deferred by a tick and that tick is cancelled by any
     re-render: it only lands once a render produces no further render, which is
     exactly the definition of "the form has settled". No dependency array for
     the same reason — the settling renders are driven by a hundred separate
     pieces of state and listing them would be a list nobody can keep correct.

     Worst case, if something re-renders forever, the fingerprint is never taken
     and we fall back to today's behaviour of always saving. Never wrong, just
     not saved work. */
  useEffect(() => {
    if (!baselineArmedRef.current || !empOpen || empLoading) return;
    const t = setTimeout(() => {
      savedPayloadRef.current = buildEmployeePayload(savedStepRef.current);
      baselineArmedRef.current = false;
    }, 0);
    return () => clearTimeout(t);
  });

  const persistCurrentStepInner = async (stepCompleted: number): Promise<boolean> => {
    try {
      const payload = buildEmployeePayload(stepCompleted);
      const currentId = editingDbIdRef.current ?? editingDbId;
      const base = savedPayloadRef.current;
      const changed = base ? changedKeys(base, payload) : null;

      /* Nothing changed since the last save — and the row already records at
         least this step — so there is nothing to persist. Skip the request and
         let the caller advance.

         The step check matters: the payload carries wizard_step_completed, so
         moving forward always differs from the baseline. It is only a no-op when
         the server has already stored progress at or beyond this step. */
      if (
        currentId
        && changed !== null
        && changed.length === 0
        // Progress still has to reach the server. Skipping when the stored step
        // is behind would let someone close the wizard and reopen it at an
        // earlier step than they actually completed.
        && savedStepRef.current >= stepCompleted
      ) {
        return true;
      }

      if (currentId) {
        /* Only what moved. The wizard used to post all 104 fields on every step:
           the server then validated all of them, re-derived every dependent
           column and re-wrote relations — 353 queries and 18 writes to change one
           field, versus 88 and 3 for the field alone.

           A partial body is safe because update() validates with nullable
           rather than required, and Laravel's validated() returns only the keys
           that were actually sent, so absent fields are never filled and never
           overwritten. The first save of a record still sends everything: until
           one succeeds there is no trustworthy baseline to diff against. */
        const body = changed
          ? { ...Object.fromEntries(changed.map(k => [k, payload[k]])),
              wizard_step_completed: payload.wizard_step_completed }
          : payload;
        await api.put(`/employees/${currentId}`, body);
      } else {
        const r = await api.post('/employees', payload);
        const newId: number | undefined = r?.data?.employee?.id;
        if (newId) {
          editingDbIdRef.current = newId;
          setEditingDbId(newId);
        }
      }
      /* Re-assigning the same employee to the same plan on every step is a write
         that changes nothing. Only post when the selection differs from what was
         last sent. */
      const empId = editingDbIdRef.current;
      if (empId && eLeavePlan) {
        const planId = Number(eLeavePlan);
        if (Number.isFinite(planId) && assignedPlanRef.current !== planId) {
          assignedPlanRef.current = planId;
          leavePlansApi.assignEmployees(planId, [empId])
            .catch(err => {
              // Let a later step retry rather than silently leaving it unassigned.
              assignedPlanRef.current = null;
              console.warn('[HrEmployees] leave plan assign failed', err);
            });
        }
      }
      // New baseline: everything up to here is now what the server holds.
      savedPayloadRef.current = buildEmployeePayload(stepCompleted);
      savedStepRef.current = Math.max(savedStepRef.current, stepCompleted);
      /* Deliberately NOT refreshing the list here. This runs on every step of an
         open wizard, and the table it would refresh is behind the modal — the
         user cannot see the result, and the final submit refreshes anyway. It
         cost a list fetch plus a stats fetch per step. */
      return true;
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const flat: Record<string, string> = {};
        for (const k of Object.keys(fieldErrors)) {
          flat[k] = Array.isArray(fieldErrors[k]) ? fieldErrors[k][0] : String(fieldErrors[k]);
        }
        setEErrors(flat);
        scrollToFirstError();
      }
      const msg = err?.response?.data?.message || err?.message || 'Save failed';
      toast.error('Could not save', String(msg));
      return false;
    }
  };

  const persistCurrentStep = async (stepCompleted: number): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      return await persistCurrentStepInner(stepCompleted);
    } finally {
      setSaving(false);
    }
  };

  const handleNextStep = async () => {
    if (saving) return;
    const errs = empStep === 1 ? validateStep1()
      : empStep === 2 ? validateStep2()
        : empStep === 3 ? validateStep3()
          : validateStep4();
    if (Object.keys(errs).length > 0) {
      setEErrors(errs);
      scrollToFirstError();
      const count = Object.keys(errs).length;
      toast.error(
        'Please fix the highlighted fields',
        `${count} field${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention before continuing.`,
      );
      return;
    }
    setSaving(true);
    try {
      if (empStep === 1) {
        const mobileOk = await checkMobileUnique(eMobile);
        if (!mobileOk) {
          toast.error('Duplicate mobile number', 'This mobile is already in use by another employee.');
          return;
        }
      }
      const ok = await persistCurrentStepInner(empStep);
      if (!ok) return;
      setEErrors({});
      toast.success(`Step ${empStep} saved`, `Progress saved — you can resume later.`);
      // Advance from the step we actually saved (captured in this closure) and
      // clamp to 4 — never derive the next step from live state, or a stepper
      // click landing mid-save could push us to a non-existent "Step 5 of 4".
      const next = Math.min(empStep + 1, 4) as 1 | 2 | 3 | 4;
      setEmpStep(next);
      setEmpMaxStep((m) => (next > m ? next : m));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmployee = async () => {
    if (saving) return;
    const errs: Record<string, string> = {
      ...validateStep1(),
      ...validateStep2(),
      ...validateStep3(),
      ...validateStep4(),
    };

    if (Object.keys(errs).length > 0) {
      setEErrors(errs);
      const jumpTo = firstStepWithErrors(errs);
      if (jumpTo) setEmpStep(jumpTo);
      scrollToFirstError();
      const count = Object.keys(errs).length;
      toast.error(
        'Please fix the highlighted fields',
        `${count} field${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention.`,
      );
      return;
    }

    // Heads-up (non-blocking): the detailed breakup's annual total is above the
    // entered Salary Amount — the components add up to more than the CTC.
    if (eDetailedBreakup && breakupOverSalary) {
      toast.warning(
        'Breakup exceeds salary',
        `The salary components total ₹${breakupDiff.toLocaleString('en-IN')} more per year than the Salary Amount (₹${salaryAnnual.toLocaleString('en-IN')}). Saving anyway.`,
      );
    }

    const payload = buildEmployeePayload(4);

    setSaving(true);
    try {
      const currentId = editingDbIdRef.current ?? editingDbId;
      if (currentId) {
        await api.put(`/employees/${currentId}`, payload);
        toast.success('Employee saved', `${eFirstName} ${eLastName}`.trim() + ' · marked complete.');
      } else {
        const r = await api.post('/employees', payload);
        const emp = r?.data?.employee;
        if (emp?.id) {
          editingDbIdRef.current = emp.id;
          setEditingDbId(emp.id);
        }
        toast.success(
          'Employee saved',
          `${emp?.display_name || eFirstName} · welcome email queued to ${payload.email}.`,
        );
      }
      const finalEmpId = editingDbIdRef.current;
      if (finalEmpId && eLeavePlan) {
        const planId = Number(eLeavePlan);
        if (Number.isFinite(planId)) {
          leavePlansApi.assignEmployees(planId, [finalEmpId])
            .catch(err => console.warn('[HrEmployees] leave plan assign failed', err));
        }
      }
      if (finalEmpId) {
        await persistBreakup(finalEmpId);
      }
      // closeEmp() refreshes the list, so no reloadAfterMutation() here — it
      // would fetch the same two endpoints twice on finish.
      reloadManagers().catch(() => { /* swallow */ });
      closeEmp();
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const flat: Record<string, string> = {};
        for (const k of Object.keys(fieldErrors)) {
          flat[k] = (Array.isArray(fieldErrors[k]) ? fieldErrors[k][0] : fieldErrors[k]) || 'Invalid';
        }
        setEErrors(flat);
        scrollToFirstError();
        toast.error('Could not save employee', err?.response?.data?.message || 'Please correct the highlighted fields.');
      } else {
        const apiMsg = err?.response?.data?.message || err?.message || 'Save failed';
        toast.error('Could not save employee', String(apiMsg));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEmployee = async (dbId: number, name: string) => {
    try {
      await api.delete(`/employees/${dbId}`);
      toast.success('Employee removed', `${name} disabled.`);
      await reloadAfterMutation();
      // A disabled employee is no longer a valid manager — refresh the pool so
      // the Reporting Manager dropdown drops them without a page reload.
      reloadManagers().catch(() => { /* swallow */ });
    } catch (err: any) {
      const apiMsg = err?.response?.data?.message || err?.message || 'Delete failed';
      toast.error('Could not delete employee', String(apiMsg));
    }
  };

  const onToggleSameAsCurrent = (checked: boolean) => {
    setESameAsCurrent(checked);
    if (checked) {
      setEPermAddr1(eCurAddr1);
      setEPermAddr2(eCurAddr2);
      setEPermCity(eCurCity);
      setEPermState(eCurState);
      setEPermCountry(eCurCountry);
      setEPermPin(eCurPin);
      // Mirrored from current → drop any pending permanent-address errors.
      setEErrors(prev => {
        const next = { ...prev };
        delete next.perm_address_line1; delete next.perm_city; delete next.perm_country_id;
        delete next.perm_state_id; delete next.perm_pincode;
        return next;
      });
    } else {
      setEPermAddr1('');
      setEPermAddr2('');
      setEPermCity('');
      setEPermState('');
      setEPermCountry('');
      setEPermPin('');
    }
  };

  useEffect(() => {
    if (!eSameAsCurrent) return;
    setEPermAddr1(eCurAddr1);
    setEPermAddr2(eCurAddr2);
    setEPermCity(eCurCity);
    setEPermState(eCurState);
    setEPermCountry(eCurCountry);
    setEPermPin(eCurPin);
  }, [eSameAsCurrent, eCurAddr1, eCurAddr2, eCurCity, eCurState, eCurCountry, eCurPin]);

  /* Master list only. This used to union the department master with the names
     found on the loaded rows; with one page loaded that second source would
     narrow the list to whichever departments happen to appear on the page the
     user is standing on. */
  const departments = useMemo(
    () => ['All Depts', ...Array.from(new Set(mDepts.map((d: any) => d.name).filter(Boolean)))],
    [mDepts],
  );

  /* The KPI figures now come from GET /employees/stats (see reloadCounts
     above). They used to be derived here by filtering the full employee array,
     which only worked while this screen fetched every row — with one page in
     hand the same code would report the page as the company.
     Five of the values it computed (on_leave, probation_in_progress,
     probation_completed, exit_in_progress, total_exited) were never rendered
     anywhere, so they are not part of the endpoint. */

  const [managerCandidates, setManagerCandidates] = useState<{ id: number; kind: string; label: string; department_id?: number | null; is_hod?: boolean; rank?: number | null }[]>([]);
  const reloadManagers = useCallback(async () => {
    try {
      const r = await api.get('/employees/managers');
      const merged = [
        ...((r?.data?.employees ?? []) as { id: number; kind: string; label: string; department_id?: number | null; is_hod?: boolean; rank?: number | null }[]),
        ...((r?.data?.login_users ?? []) as { id: number; kind: string; label: string; rank?: number | null }[]),
      ];
      setManagerCandidates(merged);
    } catch {
      setManagerCandidates([]);
    }
  }, []);
  /* Reporting-manager pool — read only by the wizard's manager picker and the
     department-HOD default, so it defers with the master lists. reloadManagers()
     is still called directly after a save / enable / disable, which is when the
     pool actually changes. */
  useEffect(() => { if (mastersWanted) reloadManagers(); }, [mastersWanted, reloadManagers]);
  const reportingManagerOptions = useMemo(
    () => {
      // Reporting-manager eligibility is driven by POSITION ONLY (see
      // PositionHierarchy) — a manager from ANY department is allowed, as long as
      // they rank STRICTLY higher than the hire (Branch User > HOD > Team Leader >
      // Executive > Employee > Intern/Trainee). Department scoping was removed per
      // request. This still subsumes the old "HOD → Branch User only" rule.
      const hireRank = rankForDesignationName(
        mDesignations.find(x => String(x.id) === String(eDesignation))?.name,
      );
      /* A manager must sit strictly higher. `r == null` stays lenient for a
         tenant's own custom job title the rank map does not know — but NOT for
         someone with no designation at all: the server now ranks those at the
         bottom (PositionHierarchy::UNRANKED), so they lose this comparison
         instead of slipping through it. That gap is how an HOD ended up
         reporting to an Employee. */
      const rankOk = (r?: number | null) =>
        hireRank == null || r == null || r < hireRank;
      let base = managerCandidates
        .filter(m => !(editingDbId && m.kind === 'employee' && m.id === editingDbId))
        .filter(m => rankOk(m.rank)) // strictly higher position, any department
        .map(m => ({ value: `${m.kind}:${m.id}`, label: m.label }));
      if (savedMgrOption && !base.some(o => o.value === savedMgrOption.value)) {
        // Keep the previously-saved manager visible only if it's still eligible
        // (a Branch User is always eligible; otherwise check its rank if known).
        const savedCand = managerCandidates.find(m => `${m.kind}:${m.id}` === savedMgrOption.value);
        if (String(savedMgrOption.value).startsWith('branch_user:') || rankOk(savedCand?.rank)) {
          base = [savedMgrOption, ...base];
        }
      }
      return base;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [managerCandidates, editingDbId, savedMgrOption, mDesignations, eDesignation]
  );

  // Auto-point a non-HOD hire at their department's HOD when one exists — only
  // when the manager is empty or the "temporary" Branch User the HOD supersedes;
  // never overrides a manager deliberately chosen (keeps edit mode intact).
  const deptHodValue = useMemo(() => {
    const deptId = String(eDept || '');
    const isHod = !!hodDesignationId && String(eDesignation) === hodDesignationId;
    if (isHod || !deptId) return '';
    const hod = managerCandidates.find(m => m.is_hod && m.department_id != null && String(m.department_id) === deptId);
    return hod ? `${hod.kind}:${hod.id}` : '';
  }, [managerCandidates, eDept, eDesignation, hodDesignationId]);
  useEffect(() => {
    if (!deptHodValue) return;
    /* Fills an EMPTY field only. It used to overwrite a Branch User manager as
       well, treating one as a placeholder the HOD supersedes — but a Branch
       User is a deliberate choice, and together with the designation handler
       clearing the field, that is what made the manager change by itself when
       a designation was edited. A default may fill a blank; it may not
       overrule an answer somebody gave. */
    setEReportingMgr(prev => (prev ? prev : deptHodValue));
  }, [deptHodValue]);

  /* A manager the new designation no longer allows leaves the field BLANK.
   *
   * The picker's options are filtered by rank, so promoting someone to their
   * manager's grade drops that manager out of the list while the field still
   * holds them. MasterSelect, unable to find a label for the value, falls back
   * to printing it raw — which is the "employee:564" the form was showing.
   * Blank is the honest state: the old answer is not valid any more and a new
   * one has to be chosen. It is cleared rather than swapped, so nothing is
   * ever silently chosen on the operator's behalf.
   *
   * Guarded on the candidate list being loaded — before it arrives every value
   * looks unmatched, and clearing then would wipe the saved manager of every
   * record the moment its form opened. */
  useEffect(() => {
    if (!eReportingMgr || managerCandidates.length === 0) return;
    if (reportingManagerOptions.some(o => o.value === eReportingMgr)) return;
    setEReportingMgr('');
  }, [eReportingMgr, reportingManagerOptions, managerCandidates.length]);

  /* The tab, the search box and the department filter are all applied by the
     API now (see reloadEmployees), so the rows that arrive ARE the rows to
     show. Filtering them again in the browser would only be able to hide rows
     from the current page, which reads as results going missing. */

  /* Paging, rows-per-page and the fit-to-viewport measuring all moved into
     <DataTable> (components/ui/DataTable) — this page no longer tracks them. */

  const [exporting, setExporting] = useState(false);
  /* Export covers the whole filtered set, not the page on screen.
     It used to hand XLSX whatever the browser was holding, which was every
     employee — now that is 25 of them, and an export that silently ships one
     page while the button still says "Export" is worse than one that fails.
     So it re-asks for the same filters WITHOUT paging and exports that. */
  const handleExportEmployees = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await api.get('/employees', {
        params: {
          view: 'list',                   // the sheet uses the same eleven columns
          enabled: tab === 'active' ? 1 : 0,
          ...(debouncedQ ? { search: debouncedQ } : {}),
          ...(deptFilterId ? { department_id: deptFilterId } : {}),
        },
      });
      const body = r.data ?? {};
      const raw: ApiEmployee[] = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : []);
      const exportRows = raw.map(apiToRow);

      if (exportRows.length === 0) {
        toast.info('Nothing to export', 'No employees match the current filters.');
        return;
      }

      const sheetRows = exportRows.map((e, i) => ({
        'Sr No': i + 1,
        'Employee': e.name,
        'Email': e.email || '',
        'Employee ID': e.id,
        'Department': e.department || '',
        'Designation': e.designation || '',
        'Primary Role': e.primaryRole || '',
        'Ancillary Role': (e.ancillaryRoles && e.ancillaryRoles.length
          ? e.ancillaryRoles.join(', ')
          : (e.ancillaryRole || '')),
        'Manager': e.manager || '',
        'Profile %': e.profile ?? 0,
        'Onboarding': e.onboarding || '',
        'Status': e.enabled ? 'Active' : 'Disabled',
      }));
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      XLSX.writeFile(wb, `Employees_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${sheetRows.length} employee${sheetRows.length === 1 ? '' : 's'} exported to Excel.`);
    } catch {
      toast.error('Export failed', 'Could not generate the Excel file. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  /* Employee list columns for the shared <DataTable>. Every text/number column
   * sorts (the header arrows); Ancillary Role and Actions don't, because one
   * holds a variable-length chip set and the other only buttons.
   *
   * `meta.width` percentages MUST keep summing to 100 — the table runs in
   * table-layout:fixed, so a short sum re-appears as slack in the last column.
   * 4+16+8+8+9+8+7+8+7+8+17 = 100. Actions gets the biggest share because the
   * Disabled tab shows six icon buttons plus the enable/disable switch. */
  const employeeColumns = useMemo<DataTableColumn<EmployeeRow>[]>(() => [
    {
      header: 'Employee',
      id: 'name',
      accessorFn: (r: EmployeeRow) => r.name,
      meta: { width: '15%' },
      cell: info => {
        const e = info.row.original;
        /* Avatar removed — the photo/initials circle carried no information the
           name and email below it don't already give, and it cost the column
           42px of width that the (often long) names had to wrap into. */
        return (
          <div className="d-flex align-items-center gap-2">
            <div className="min-w-0" style={{ flex: 1, minWidth: 0 }}>
              <Tooltip label={e.name}>
                <div className="fw-semibold fs-13 text-truncate">{e.name}</div>
              </Tooltip>
              <Tooltip label={e.email}>
                <a
                  href={`mailto:${e.email}`}
                  onClick={ev => ev.stopPropagation()}
                  className="text-muted text-decoration-none d-inline-flex align-items-center gap-1 fs-13 w-100"
                  style={{ minWidth: 0 }}
                >
                  <i className="ri-mail-line fs-13 flex-shrink-0" />
                  <span className="text-truncate" style={{ minWidth: 0 }}>{e.email}</span>
                </a>
              </Tooltip>
            </div>
          </div>
        );
      },
    },
    {
      /* Same code chip as the Customer list (DataTable's IdCell / .dt-id-chip)
         instead of the old solid-violet pill, so employee codes read like every
         other ID column in the app. */
      header: 'Employee ID',
      accessorKey: 'id',
      /* Pills and chips are centred across every HR list: a badge is a fixed
         shape, so left-aligning it leaves a ragged gap on the right of each
         cell that reads as mis-alignment rather than as text. Plain-text
         columns stay left — they're read, not scanned. */
      meta: { width: '7%', align: 'center' },
      cell: info => <IdCell value={info.getValue() as string} />,
    },
    {
      header: 'Department',
      accessorKey: 'department',
      meta: { width: '8%', align: 'center' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'Designation',
      accessorKey: 'designation',
      meta: { width: '9%', align: 'center' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'Primary Role',
      accessorKey: 'primaryRole',
      meta: { width: '8%', align: 'center' },
      /* Role names run long ("Software Development", "Training Coordinator")
         and the column is narrow — ChipCell ellipsises inside the pill and
         reveals the full name on hover, same contract as Designation. */
      cell: info => {
        const t = tone(info.row.original.primaryRole, isDark);
        return (
          <ChipCell
            value={info.row.original.primaryRole}
            className="fw-semibold hr-emp-row-pill"
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: t.bg, color: t.fg }}
          />
        );
      },
    },
    {
      header: 'Ancillary Role',
      id: 'ancillaryRoles',
      enableSorting: false,
      /* LEFT, unlike the single-badge columns. This cell holds a variable
         number of chips plus a "+N" overflow counter, so its width changes row
         to row — centring made every row start at a different x and the column
         read as jittery. A common left edge is what makes a stack of chips
         scannable. */
      meta: { width: '8%' },
      cell: info => <AncillaryRolesChip names={info.row.original.ancillaryRoles} />,
    },
    {
      header: 'Manager',
      accessorKey: 'manager',
      meta: { width: '7%' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'Profile %',
      accessorKey: 'profile',
      // wrap: the badge floats ABOVE the bar, so the cell must not clip it
      // vertically. 9% (was 7%) gives the meter enough room that it no longer
      // has to overflow sideways into the Onboarding column.
      meta: { width: '9%', wrap: true, align: 'center' },
      cell: info => {
        const p = info.row.original.profile;
        const TIER = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
          : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
            : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
              : { dark: '#f06548', light: '#fda192' };
        /* Keep the floating badge clear of BOTH edges. The circle is 26px and
           centred on this percentage, so at 100% it used to sit half-outside
           the meter and, with the block being a fixed 110px inside a narrower
           column, bled into the Onboarding cell. */
        const badgeLeft = Math.max(14, Math.min(86, p));
        return (
          /* Fluid, not a fixed 110px: the column is a percentage, so a fixed
             block wider than the cell overflowed into the next column — and by
             a different amount per row, since the overflow depended on the
             badge position. maxWidth caps it on wide screens so the meter
             doesn't stretch oddly. */
          <div style={{ position: 'relative', width: '100%', maxWidth: 120, minWidth: 72, paddingTop: 30 }} title={`Profile ${p}% complete`}>
            <div style={{ position: 'absolute', top: 0, left: `${badgeLeft}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <div
                className="d-flex align-items-center justify-content-center fw-bold"
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${TIER.dark}, ${TIER.light})`,
                  color: '#fff', fontSize: 9.5,
                  boxShadow: `0 4px 10px ${TIER.dark}55`,
                }}
              >
                {p}%
              </div>
              <div
                style={{
                  width: 0, height: 0, margin: '0 auto',
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: `5px solid ${TIER.dark}`,
                }}
              />
            </div>
            <div style={{ width: '100%', height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${p}%`, height: '100%', borderRadius: 999,
                  background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${TIER.dark}, ${TIER.light})`,
                  transition: 'width .25s ease',
                }}
              />
            </div>
          </div>
        );
      },
    },
    {
      header: 'Onboarding',
      accessorKey: 'onboarding',
      meta: { width: '7%', align: 'center' },
      cell: info => {
        const status = info.row.original.onboarding;
        const ob = ONBOARDING_TONES[status];
        return (
          <span
            className="rounded-pill fw-semibold d-inline-flex align-items-center gap-1 hr-emp-row-pill hr-emp-onboarding-pill"
            data-status={status}
            style={{ background: ob.bg, color: ob.fg, fontSize: 11.5, padding: '4px 10px', border: 'none' }}
          >
            {status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      /* 20%, not 17%. This cell holds SIX 30px action buttons plus the
         enable/disable switch — about 250px of controls — and 17% of the
         table's 1500px minimum is 255px before the cell's own 18px padding.
         The content did not fit, and because the cell opts out of clipping
         (`wrap`) it spilled PAST the table's right edge instead: on a laptop
         the switch sat outside the purple header band, half cut off by the
         scroll container. The 3% comes off three columns that ellipsise
         cleanly. */
      meta: { align: 'center', width: '20%', wrap: true },
      cell: info => {
        const e = info.row.original;
        const rowDisabled = !e.enabled;
        // An employee must not edit their OWN record from this list — freeze
        // Edit and Permissions on the logged-in user's own row (QA #150). Match
        // by linked user id, falling back to the linked employee id.
        const isSelf = !!authUser && (
          // `user_id` rides on the row payload but isn't in EmployeeRow's type
          // — same cast the _dbId lookup below already uses.
          ((e as any).user_id != null && Number((e as any).user_id) === Number(authUser.id)) ||
          ((authUser as any).employee_id != null && Number((e as any)._dbId) === Number((authUser as any).employee_id))
        );
        // EXITED employees (exit case completed → status Resigned/Terminated)
        // are PERMANENTLY disabled and cannot be re-enabled here; a plain
        // soft-disable (Inactive) stays reversible.
        const exited = ['resigned', 'terminated'].includes(String((e as any)._raw?.status || '').toLowerCase());
        /* flex-wrap so this can never spill outside the column again. If a
           seventh control is ever added, or the window is narrower than the
           table's minimum, the buttons drop to a second line inside the cell
           instead of sliding past the table's right edge. */
        return (
          <div className="d-flex gap-1 justify-content-center align-items-center flex-wrap" onClick={ev => ev.stopPropagation()}>
            {/* Two independent rules sit on this button, and they behave
                differently on purpose:
                  disabled → a fact about the ROW (deactivated, or your own
                             record — you can't edit yourself, QA #150). Inert;
                             the tooltip is the whole explanation.
                  locked   → a fact about the USER (no can_edit). Greyed but
                             still clickable, so the click names the missing
                             permission instead of doing nothing. */}
            {/* Disabled until grants have loaded. A hard refresh renders this
                column before /me returns, and until then every can*() reads
                false — so the first click was denied and only the second, once
                the response landed, opened the dialog. Showing it as pending is
                honest; refusing a permission we have not checked is not. */}
            <ActionBtn
              title={!perm.ready
                ? 'Checking your permissions…'
                : isSelf
                  ? "You can't edit your own record"
                  : (perm.lockedTitle('edit') ?? 'Edit')}
              icon="ri-pencil-line" color="info"
              onClick={() => perm.guard('edit', () => openEditEmployee(e))}
              disabled={rowDisabled || isSelf || !perm.ready}
              locked={perm.ready && !perm.canEdit}
            />
            {/* Asset assignment saves through PUT /employees/{id}, which the
                API gates on can_edit — so a view-only user would otherwise
                fill the whole panel only to meet a raw 403 on save. */}
            <ActionBtn
              title={perm.lockedTitle('edit') ?? 'Asset'}
              icon="ri-computer-line" color="primary"
              onClick={() => perm.guard('edit', () => openAssignAssets(e))}
              disabled={rowDisabled}
              locked={!perm.canEdit}
            />
            {/* Enrolling someone's face writes a biometric to their record —
                a change to the employee, so it follows can_edit. (A user
                enrolling their OWN face from the Clock-In screen is a separate
                path and is not affected by this.) */}
            <ActionBtn
              title={perm.lockedTitle('edit')
                ?? ((e as any).faceRegistered ? 'Re-register Face (already enrolled)' : 'Register Face')}
              icon="ri-user-smile-line"
              color={(e as any).faceRegistered ? 'success' : 'secondary'}
              badge={(e as any).faceRegistered ? 'dot' : undefined}
              onClick={() => perm.guard('edit', () => setFaceRegEmployeeId((e as any)._dbId))}
              disabled={rowDisabled}
              locked={!perm.canEdit}
            />
            {/* Changing what someone else can access is the furthest-reaching
                edit on this page — view-only must not reach it. */}
            <ActionBtn
              title={isSelf
                ? "You can't change your own permissions"
                : (perm.lockedTitle('edit') ?? 'Permissions')}
              icon="ri-lock-2-line" color="warning"
              onClick={() => perm.guard('edit', () => openPermissions(e))}
              disabled={rowDisabled || isSelf}
              locked={!perm.canEdit}
            />
            <ActionBtn title="Documents" icon="ri-file-text-line" color="success" onClick={() => openVault(e)} disabled={rowDisabled} />
            {/* Permanent-delete button — hidden for now. A disabled employee is
                kept as a record (attendance, payroll history and documents all
                hang off it), so the toggle below is the intended way to take
                someone out of circulation. Re-enable this block if a hard
                delete is ever wanted again; handleForceDelete + the
                DeleteConfirmModal are still wired up below. */}
            {/* {tab === 'disabled' && (
              <ActionBtn
                title={perm.lockedTitle('delete') ?? 'Delete permanently'}
                icon="ri-delete-bin-line" color="danger"
                onClick={() => perm.guard('delete', () => setConfirmDelete(e))}
                locked={!perm.canDelete}
              />
            )} */}
            {/* Enabling / disabling an employee IS an edit of their record —
                and disabling routes through the delete endpoint — so the
                switch needs both flags before it will move. */}
            <ToggleSwitch
              initial={e.enabled}
              locked={exited || !perm.canEdit}
              lockedTitle={exited
                ? 'This employee has exited (exit process completed) and cannot be re-enabled.'
                : (perm.lockedTitle('edit') ?? '')}
              // Only the permission lock explains itself on click; an exited
              // employee is a hard stop with nothing to grant.
              onLockedClick={exited ? undefined : () => perm.deny('edit')}
              onRequestToggle={(next, commit) => requestToggle(e, next, commit)}
            />
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isDark, tab, openEditEmployee, openAssignAssets, openPermissions, openVault, requestToggle,
      // Grants can change mid-session (a manager saves new permissions and the
      // auth refresh lands) — the action column has to re-render when they do.
      perm.canEdit, perm.canDelete]);

  return (
    <>
      <MasterFormStyles />

      {!embedded && (
      <Row>
        <Col xs={12}>
          <div className="hr-employees-surface" style={{ background: 'transparent' }}>
            <div className="frm-cstrip mb-2">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-team-line" /></div>
                <div className="min-w-0">
                  <div className="frm-cstrip-title">Employee</div>
                  <div className="frm-cstrip-sub">Employee directory, profiles, and employment records</div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
                {/* Each toolbar action is greyed when its flag is missing, but
                    still clickable so the toast can say WHICH permission is
                    missing. `disabled` would swallow the click and leave the
                    user staring at a dead button. `lockedStyle` carries the
                    greying; see the helper at the bottom of this file. */}
                <Button
                  onClick={() => perm.guard('export', handleExportEmployees)}
                  disabled={exporting}
                  aria-disabled={!perm.canExport || undefined}
                  style={lockedStyle(!perm.canExport)}
                  className="rounded-pill px-3 hr-emp-onboard-btn"
                  title={perm.lockedTitle('export') ?? 'Export the current employee list to Excel'}
                >
                  <i className={`align-bottom me-1 ${exporting ? 'ri-loader-4-line' : 'ri-file-excel-2-line'}`}></i>
                  {exporting ? 'Exporting…' : 'Export'}
                </Button>
                {/* An onboarding invite is how an employee joins the roster —
                    the same outcome as Add, so it rides on the same flag. */}
                <Button
                  onClick={() => perm.guard('add', () => setOnboardOpen(true))}
                  aria-disabled={!perm.canAdd || undefined}
                  style={lockedStyle(!perm.canAdd)}
                  className="rounded-pill px-3 hr-emp-onboard-btn"
                  title={perm.lockedTitle('add') ?? 'Send an onboarding link to a new joiner'}
                >
                  <i className="ri-user-add-line align-bottom me-1"></i>Onboarding Link
                </Button>
                <Button
                  onClick={() => perm.guard('add', openAddEmployee)}
                  color="secondary"
                  aria-disabled={!perm.canAdd || undefined}
                  style={lockedStyle(!perm.canAdd)}
                  className="btn-label waves-effect waves-light rounded-pill"
                  title={perm.lockedTitle('add')}
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Employee
                </Button>
              </div>
            </div>

            {/* g-1 — see the note on the Onboarding hub's KPI row: the gap
                between tiles is set here rather than via app.css. */}
            <Row className="g-1 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl md={4} sm={6} xs={12}>
                  <div
                    className="hr-employees-surface hr-emp-kpi-card h-100"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      borderTopWidth: 0,
                      padding: '11px 15px',
                      position: 'relative',
                      overflow: 'hidden',
                      ['--card-accent' as any]: k.accent,
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, height: '100%' }}>
                      <div className="min-w-0" style={{ flex: 1, minWidth: 0 }}>
                        <p className="hr-emp-kpi-label" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 className="hr-emp-kpi-value" style={{ fontSize: 24, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          {loadingEmployees
                            ? <Shimmer height={24} width={56} />
                            : <AnimatedNumber value={(counts as any)[k.key]} />}
                        </h3>
                      </div>
                      <div className="hr-emp-kpi-icon" style={{ width: 38, height: 38, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>


            <DataTable<EmployeeRow>
              data={apiRows}
              columns={employeeColumns}
              serial
              accent="violet"
              minWidth={1500}
              fitToViewport
              autoFitRows
              loading={loadingEmployees || tabSwitching}
              /* The rows are one page fetched by reloadEmployees; the table
                 stops slicing and reports page moves back here instead.
                 onPageSizeChange covers autoFitRows re-measuring on resize as
                 well as the rows-per-page picker. */
              serverPagination={{
                total: totalEmployees,
                pageIndex: page,
                onPageChange: setPage,
                onPageSizeChange: setPerPage,
              }}
              tabs={[
                { key: 'active', label: 'Active Employees', icon: 'ri-user-follow-line', count: counts.active },
                { key: 'disabled', label: 'Disabled Employees', icon: 'ri-user-unfollow-line', count: counts.disabled },
              ]}
              activeTab={tab}
              onTabChange={k => {
                setTab(k as 'active' | 'disabled');
                setStatusFilter(k === 'active' ? 'Active' : 'Disabled');
              }}
              className="hre-list"
              searchValue={q}
              onSearchChange={setQ}
              searchPlaceholder="Search name, ID, department, role…"
              emptyMessage={
                <>
                  <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No employees match your filters
                </>
              }
              /* Disabled employees have no profile page to open — their row
                 stays non-clickable (the Actions column still works). */
              onRowClick={tab === 'disabled' ? undefined : (e) => navigate(
                `/hr/employees/${encodeURIComponent(e.encryptedId || e.id)}/profile`,
                { state: { employee: e } },
              )}
            />
          </div>
        </Col>
      </Row>
      )}

      <DeleteConfirmModal
        open={!!confirmDelete}
        title="Delete Employee"
        itemName={confirmDelete?.name}
        subMessage="Their employee record will be erased. The paired login account is kept (deactivated) so historical audit logs & permissions stay intact, but they will no longer appear anywhere else."
        loading={deleting}
        onClose={() => !deleting && setConfirmDelete(null)}
        onConfirm={handleForceDelete}
      />

      <Modal
        isOpen={onboardOpen}
        toggle={closeOnboard}
        centered
        size="lg"
        contentClassName="onb-modal-content border-0"
        modalClassName="onb-modal-wide"
        backdrop="static"
        keyboard={false}
      >

        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
          <div className="d-flex align-items-start justify-content-between" style={{ padding: '24px 28px 18px' }}>
            <div className="d-flex align-items-center gap-3">
              <div className="onb-header-icon d-flex align-items-center justify-content-center flex-shrink-0">
                <i className="ri-link" style={{ fontSize: 22, color: '#7c3aed' }} />
              </div>
              <div>
                <h5 className="onb-header-title fw-bold mb-1">
                  Generate Onboarding Link
                </h5>
                <div className="onb-header-sub">
                  Create a secure link for new employee onboarding
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeOnboard}
              aria-label="Close"
              className="onb-close-btn d-inline-flex align-items-center justify-content-center"
            >
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>

          <div className="onb-header-divider" />

          {generatedInviteUrl ? (
            <>
              <div style={{ padding: '24px 28px 6px' }}>
                <div className="onb-success-banner" style={{
                  borderRadius: 12,
                  padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  }}>
                    <i className="ri-check-line" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="onb-success-title" style={{ fontSize: 14, fontWeight: 800 }}>Invite link generated</div>
                    <div className="onb-success-sub" style={{ fontSize: 12.5 }}>
                      Sent to <strong>{onbEmail}</strong>. Expires in {onbExpiry} days.
                    </div>
                  </div>
                </div>

                <label className="onb-label" style={{ marginTop: 18 }}>Onboarding URL</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="onb-input onb-url-input"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={copyGeneratedUrl}
                    className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                    style={{
                      fontSize: 13, color: '#fff', border: 'none',
                      background: copiedAt ? 'linear-gradient(135deg,#0ab39c,#02c8a7)' : 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                      boxShadow: '0 4px 12px rgba(124,92,252,0.30)',
                      whiteSpace: 'nowrap', minWidth: 120,
                    }}
                  >
                    <i className={copiedAt ? 'ri-check-line' : 'ri-file-copy-line'} />
                    {copiedAt ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <p className="onb-helper-text" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
                  Share this link if the email doesn't arrive. The link is single-use — it stops working as soon as the candidate submits the form.
                </p>
              </div>

              <div style={{ padding: '20px 28px 26px', display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setGeneratedInviteUrl(null);
                    setCopiedAt(0);
                    setOnbName(''); setOnbEmail(''); setOnbDept(''); setOnbDate(''); setOnbExpiry(15); setOnbErrors({});
                  }}
                  className="btn onb-secondary-btn fw-semibold rounded-pill flex-grow-1"
                  style={{ fontSize: 13, padding: '10px 16px' }}
                >
                  Send another invite
                </button>
                <button
                  type="button"
                  onClick={closeOnboard}
                  className="btn fw-semibold rounded-pill flex-grow-1"
                  style={{
                    fontSize: 13, color: '#fff', border: 'none',
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    boxShadow: '0 4px 12px rgba(10,179,156,0.30)',
                    padding: '10px 16px',
                  }}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '22px 28px 10px' }}>
                <Row className="g-3">
                  <Col md={6}>
                    <label className="onb-label" htmlFor="onb-name">Employee Name<span className="onb-req">*</span></label>
                    <input
                      id="onb-name"
                      type="text"
                      className={`onb-input${onbErrors.name ? ' is-invalid' : ''}`}
                      placeholder="Full name"
                      value={onbName}
                      onChange={e => { setOnbName(e.target.value); clearOnbError('name'); }}
                    />
                    {onbErrors.name && (
                      <div className="onb-error"><i className="ri-error-warning-line" />{onbErrors.name}</div>
                    )}
                  </Col>
                  <Col md={6}>
                    <label className="onb-label" htmlFor="onb-email">Email Address<span className="onb-req">*</span></label>
                    <input
                      id="onb-email"
                      type="email"
                      className={`onb-input${onbErrors.email ? ' is-invalid' : ''}`}
                      placeholder="name@company.com"
                      value={onbEmail}
                      /* Lower-cased as it is typed. Email local parts are
                         case-insensitive in practice and every mailbox here is
                         addressed in lower case, so "DFSD@FDGDFG.COM" was going
                         out on the invite exactly as shouted — and the same
                         person typed twice with different casing looked like two
                         different invitees. */
                      onChange={e => { setOnbEmail(e.target.value.toLowerCase()); clearOnbError('email'); }}
                    />
                    {onbErrors.email && (
                      <div className="onb-error"><i className="ri-error-warning-line" />{onbErrors.email}</div>
                    )}
                  </Col>
                  <Col md={6}>
                    <label className="onb-label">Department<span className="onb-req">*</span></label>
                    <MasterSelect
                      value={onbDept}
                      onChange={(v) => { setOnbDept(v); clearOnbError('dept'); }}
                      placeholder="Select department"
                      options={departmentOptions}
                      onOpen={() => reloadMasters()}
                      invalid={!!onbErrors.dept}
                    />
                    {onbErrors.dept && (
                      <div className="onb-error"><i className="ri-error-warning-line" />{onbErrors.dept}</div>
                    )}
                  </Col>
                  <Col md={6}>
                    <label className="onb-label">Expected Joining Date<span className="onb-req">*</span></label>
                    <MasterDatePicker
                      value={onbDate}
                      onChange={(v) => { setOnbDate(v); clearOnbError('date'); }}
                      placeholder="dd-mm-yyyy"
                      minDate={isoYearsAgo(0)}
                      invalid={!!onbErrors.date}
                    />
                    {onbErrors.date && (
                      <div className="onb-error"><i className="ri-error-warning-line" />{onbErrors.date}</div>
                    )}
                  </Col>
                </Row>

                <div className="mt-4">
                  <label className="onb-label">Link Expiry</label>
                  <div className="d-flex flex-wrap gap-2">
                    {([3, 7, 15] as ExpiryDays[]).map(days => {
                      const active = onbExpiry === days;
                      return (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setOnbExpiry(days)}
                          className={`onb-expiry-pill${active ? ' is-active' : ''}`}
                        >
                          <i className="ri-time-line" style={{ fontSize: 16 }} />
                          {days} Days
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ padding: '20px 28px 26px' }}>
                <button
                  type="button"
                  className="onb-submit-btn w-100 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                  onClick={handleGenerateOnboarding}
                  disabled={generatingInvite}
                  aria-busy={generatingInvite}
                  style={{
                    opacity: generatingInvite ? 0.7 : 1,
                    cursor: generatingInvite ? 'progress' : 'pointer',
                  }}
                >
                  <i
                    className={generatingInvite ? 'ri-loader-4-line' : 'ri-link'}
                    style={{
                      fontSize: 18,
                      animation: generatingInvite ? 'onb-spin 0.8s linear infinite' : undefined,
                    }}
                  />
                  {generatingInvite ? 'Generating link…' : 'Generate Onboarding Link'}
                </button>
              </div>
            </>
          )}
        </ModalBody>
      </Modal>

      <Modal
        isOpen={!!togglePending}
        toggle={cancelToggle}
        centered
        size="md"
        contentClassName="toggle-confirm-content border-0"
        backdrop="static"
        keyboard={false}
      >
        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
          {(() => {
            if (!togglePending) return null;
            const enabling = togglePending.next;
            const emp = togglePending.employee;
            const tone = enabling
              ? {
                headerGrad: 'linear-gradient(135deg,#d6f4e3 0%, #c1eed8 100%)',
                iconBg: '#0ab39c',
                iconShadow: '0 8px 22px rgba(10,179,156,0.35)',
                iconGlyph: 'ri-shield-check-line',
                title: 'Enable Employee',
                subtitle: 'Restore platform access for this employee',
                bannerBg: '#ecfaf3',
                bannerBd: '#bce8d2',
                bannerFg: '#0a8a78',
                bannerIcon: 'ri-information-line',
                bannerText: "They'll regain access immediately and reappear under the Active tab.",
                ctaLabel: 'Yes, Enable',
                ctaIcon: 'ri-check-line',
                ctaBg: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                ctaShadow: '0 8px 18px rgba(10,179,156,0.30)',
              }
              : {
                headerGrad: 'linear-gradient(135deg,#fff4dd 0%, #ffe8c2 100%)',
                iconBg: '#f59e0b',
                iconShadow: '0 8px 22px rgba(245,158,11,0.35)',
                iconGlyph: 'ri-error-warning-line',
                title: 'Disable Employee',
                subtitle: 'Suspend platform access for this employee',
                bannerBg: '#fff7e6',
                bannerBd: '#fbcf8a',
                bannerFg: '#a4661c',
                bannerIcon: 'ri-alert-line',
                bannerText: "They'll lose platform access immediately and move to the Disabled tab. You can re-enable them anytime.",
                ctaLabel: 'Yes, Disable',
                ctaIcon: 'ri-forbid-2-line',
                ctaBg: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
                ctaShadow: '0 8px 18px rgba(245,158,11,0.30)',
              };
            return (
              <>
                <div
                  className={`toggle-confirm-header${enabling ? ' is-enable' : ''}`}
                  style={{
                    background: tone.headerGrad,
                    padding: '24px 24px 36px',
                    position: 'relative',
                  }}
                >
                  <button
                    type="button"
                    onClick={cancelToggle}
                    disabled={toggling}
                    aria-label="Close"
                    className="btn p-0 d-inline-flex align-items-center justify-content-center toggle-confirm-x"
                    style={{
                      position: 'absolute', top: 14, right: 14,
                      width: 30, height: 30, borderRadius: 10,
                      background: 'rgba(255,255,255,0.65)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      color: '#374151',
                      opacity: toggling ? 0.5 : 1,
                      cursor: toggling ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 17 }} />
                  </button>
                  <div className="text-center">
                    <div
                      className="d-inline-flex align-items-center justify-content-center mx-auto"
                      style={{
                        width: 64, height: 64, borderRadius: 18,
                        background: tone.iconBg,
                        boxShadow: tone.iconShadow,
                      }}
                    >
                      <i className={tone.iconGlyph} style={{ color: '#fff', fontSize: 30 }} />
                    </div>
                    <h5 className="fw-bold mb-1 mt-3 toggle-confirm-title" style={{ fontSize: 18, letterSpacing: '-0.01em', color: '#1f2937' }}>
                      {tone.title}
                    </h5>
                    <div className="text-muted toggle-confirm-subtitle" style={{ fontSize: 13 }}>
                      {tone.subtitle}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '0 24px', marginTop: -22, position: 'relative', zIndex: 2 }}>
                  <div
                    className="d-flex align-items-center gap-3 toggle-confirm-emp-card"
                    style={{
                      background: '#fff',
                      border: '1px solid #eef0f4',
                      borderRadius: 14,
                      padding: '14px 16px',
                      boxShadow: '0 6px 14px rgba(18,38,63,0.06)',
                    }}
                  >
                    <div
                      className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                      style={{
                        width: 42, height: 42, fontSize: 14,
                        background: `linear-gradient(135deg, ${emp.accent}, ${emp.accent}cc)`,
                        boxShadow: `0 2px 6px ${emp.accent}40`,
                      }}
                    >
                      {emp.initials}
                    </div>
                    <div className="min-w-0 flex-grow-1">
                      <div className="fw-bold text-truncate toggle-confirm-emp-name" style={{ fontSize: 14 }}>{emp.name}</div>
                      <div className="text-muted text-truncate toggle-confirm-emp-sub" style={{ fontSize: 12 }}>
                        {emp.designation} · {emp.department}
                      </div>
                    </div>
                    <span
                      className="d-inline-flex align-items-center fw-semibold font-monospace flex-shrink-0 toggle-confirm-id-pill"
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: '#ece6ff',
                        color: '#5a3fd1',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {emp.id}
                    </span>
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-center gap-2" style={{ padding: '18px 24px 4px' }}>
                  <span
                    className={`d-inline-flex align-items-center fw-semibold ${enabling ? 'toggle-confirm-pill-inactive' : 'toggle-confirm-pill-active-green'}`}
                    style={{
                      fontSize: 11.5,
                      padding: '5px 12px',
                      borderRadius: 999,
                      background: enabling ? '#eef2f6' : '#d6f4e3',
                      color: enabling ? '#5b6478' : '#108548',
                    }}
                  >
                    <span
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: enabling ? '#878a99' : '#10b981',
                        marginRight: 6,
                      }}
                    />
                    {enabling ? 'Disabled' : 'Active'}
                  </span>
                  <i className="ri-arrow-right-line" style={{ color: '#9ca3af', fontSize: 18 }} />
                  <span
                    className={`d-inline-flex align-items-center fw-semibold ${enabling ? 'toggle-confirm-pill-active-green' : 'toggle-confirm-pill-active-amber'}`}
                    style={{
                      fontSize: 11.5,
                      padding: '5px 12px',
                      borderRadius: 999,
                      background: enabling ? '#d6f4e3' : '#fde8c4',
                      color: enabling ? '#108548' : '#a4661c',
                    }}
                  >
                    <span
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: enabling ? '#10b981' : '#f59e0b',
                        marginRight: 6,
                      }}
                    />
                    {enabling ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div style={{ padding: '14px 24px 0' }}>
                  <div
                    className={`d-flex align-items-start gap-2 toggle-confirm-banner${enabling ? ' is-enable' : ''}`}
                    style={{
                      background: tone.bannerBg,
                      border: `1px solid ${tone.bannerBd}`,
                      borderRadius: 12,
                      padding: '10px 12px',
                      color: tone.bannerFg,
                      fontSize: 12.5,
                      lineHeight: 1.45,
                    }}
                  >
                    <i className={tone.bannerIcon} style={{ fontSize: 16, lineHeight: 1, marginTop: 2 }} />
                    <span>{tone.bannerText}</span>
                  </div>
                </div>

                <div
                  className="d-flex align-items-center gap-2"
                  style={{ padding: '18px 24px 22px' }}
                >
                  <button
                    type="button"
                    onClick={cancelToggle}
                    disabled={toggling}
                    className="btn fw-semibold rounded-pill flex-grow-1 toggle-confirm-cancel-btn"
                    style={{
                      fontSize: 13.5,
                      background: '#fff',
                      color: '#374151',
                      border: '1px solid #e5e7eb',
                      padding: '10px 18px',
                      opacity: toggling ? 0.6 : 1,
                      cursor: toggling ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmToggle}
                    autoFocus
                    disabled={toggling}
                    className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold rounded-pill flex-grow-1"
                    style={{
                      fontSize: 13.5,
                      color: '#fff',
                      border: 'none',
                      background: tone.ctaBg,
                      boxShadow: tone.ctaShadow,
                      padding: '10px 18px',
                      opacity: toggling ? 0.85 : 1,
                      cursor: toggling ? 'wait' : 'pointer',
                    }}
                  >
                    {toggling ? (
                      <>
                        <i className="ri-loader-4-line emp-spin" style={{ fontSize: 16 }} />
                        {enabling ? 'Enabling…' : 'Disabling…'}
                      </>
                    ) : (
                      <>
                        <i className={tone.ctaIcon} style={{ fontSize: 16 }} />
                        {tone.ctaLabel}
                      </>
                    )}
                  </button>
                </div>
              </>
            );
          })()}
        </ModalBody>
      </Modal>

      <Modal
        isOpen={empOpen}
        toggle={closeEmp}
        centered
        size="lg"
        contentClassName="border-0"
        modalClassName="emp-modal-wide"
        scrollable
        backdrop="static"
        keyboard={false}
      >

        <ModalBody className="p-0" style={{ background: 'var(--vz-secondary-bg, #f7f8fc)', borderRadius: 'var(--bs-modal-border-radius, 12px)', overflow: 'hidden', ...(saving ? { cursor: 'wait' as const } : {}) }}>
          <div
            style={{
              padding: '18px 22px',
              background: 'linear-gradient(120deg,#5a3fd1 0%,#7c5cfc 55%,#a78bfa 100%)',
              color: '#fff',
              position: 'relative',
            }}
          >
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
                <div
                  className="d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'rgba(255,255,255,0.18)',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <i className="ri-user-3-line" style={{ fontSize: 20 }} />
                </div>
                <div>
                  <h5 className="fw-bold mb-0 text-white" style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
                    {empMode === 'edit' ? 'Edit Employee' : 'Add Employee'}
                  </h5>
                  {/* Names the stage the wizard is actually on, so the header
                      says what this screen is for rather than just which modal
                      is open. The "Step n of 4" pill counts; this one tells. */}
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', marginTop: 2 }}>
                    {empStep === 1 && 'Personal details, contact and identity'}
                    {empStep === 2 && 'Department, role, reporting line and employment terms'}
                    {empStep === 3 && 'Work schedule, policies, assets and documents'}
                    {empStep === 4 && 'CTC, payroll configuration and salary breakup'}
                  </div>
                </div>
              </div>
              {/* The "Step n of 4" pill is gone: the stepper immediately below
                  already marks the current step and the ones done, and the
                  subtitle names the stage — three ways of saying the same
                  thing in one header. */}
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeEmp}
                  aria-label="Close"
                  className="btn p-0 d-inline-flex align-items-center justify-content-center emp-close-btn"
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  <i className="ri-close-line" style={{ fontSize: 18 }} />
                </button>
              </div>
            </div>
          </div>

          <div ref={empStepRailRef} className="emp-stepper-bar" style={{ padding: '16px 28px', borderBottom: '1px solid var(--vz-border-color)' }}>
            <div className="d-flex align-items-start">
              {[
                { n: 1, label: 'Basic Details' },
                { n: 2, label: 'Job Details' },
                { n: 3, label: 'Work Details' },
                { n: 4, label: 'Compensation' },
              ].map((s, idx, arr) => {
                const active = empStep === s.n;
                const done = empStep > s.n;
                const locked = s.n > empMaxStep;
                return (
                  <div key={s.n} className="d-flex align-items-start" style={{ flex: idx === arr.length - 1 ? '0 0 auto' : '1 1 0' }}>
                    <button
                      type="button"
                      className={`emp-stepper-btn${locked ? ' is-locked' : ''}`}
                      onClick={() => { if (!locked && !saving && !empLoading) setEmpStep(s.n as 1 | 2 | 3 | 4); }}
                      disabled={locked || saving || empLoading}
                      aria-label={`Go to step ${s.n}: ${s.label}`}
                      aria-current={active ? 'step' : undefined}
                      title={locked ? 'Complete the current step first' : saving ? 'Saving…' : undefined}
                    >
                      <div className={`emp-stepper-circle${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {done ? <i className="ri-check-line" style={{ fontSize: 16 }} /> : s.n}
                      </div>
                      <div className={`emp-stepper-label${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {s.label}
                      </div>
                    </button>
                    {idx < arr.length - 1 && <div className={`emp-stepper-line${done ? ' is-done' : ''}`} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* While the step save is in flight the whole form freezes:
              pointer-events:none kills every mouse interaction (and dims the
              body as feedback), and the disabled <fieldset> below kills
              keyboard edits — otherwise users could keep typing during the
              PUT and the form looked saved while holding unsaved changes. */}
          <div
            ref={empScrollRef}
            aria-busy={saving}
            style={{
              padding: '18px 22px', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto',
              ...(saving ? { pointerEvents: 'none' as const, opacity: 0.65 } : {}),
            }}
          >
            <fieldset disabled={saving || empLoading} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
              {/* Edit opens on the click and fetches the record after, so the
                  body stands in for itself until that lands. */}
              {/* One skeleton, two reasons: the record is still loading, or the
                  step's panel is being swapped. Both are "these fields are not
                  the ones you are about to see". */}
              {(empLoading || stepShimmer) && <EmpFormSkeleton />}
              {!empLoading && !stepShimmer && (<>
              {empStep === 1 && (
                <>
                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-user-line" /> Employee Details
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Work Country<span className="req">*</span></label>
                        <MasterSelect value={eWorkCountry} onChange={(v) => { setEWorkCountry(v); clearEErr('work_country_id'); }} placeholder="Select work country" options={countryOptions} invalid={!!eErrors.work_country_id} />
                        {eErrors.work_country_id && <small className="emp-err">{eErrors.work_country_id}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">First Name<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.first_name ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="e.g. Aarav"
                          value={eFirstName}
                          onChange={e => {
                            const v = e.target.value;
                            setEFirstName(v);
                            const composed = `${v} ${eMiddleName} ${eLastName}`.replace(/\s+/g, ' ').trim();
                            if (!eDisplayNameTouched) setEDisplayName(composed);
                            if (!eActualNameTouched) setEActualName(composed);
                            clearEErr('first_name');
                            clearEErr('display_name');
                            clearEErr('actual_name');
                          }}
                        />
                        {eErrors.first_name && <small className="emp-err">{eErrors.first_name}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Middle Name</label>
                        <input className={`emp-input${eErrors.middle_name ? ' is-invalid' : ''}`} type="text" placeholder="Middle name (optional)" value={eMiddleName} onChange={e => {
                          const v = e.target.value;
                          setEMiddleName(v);
                          const composed = `${eFirstName} ${v} ${eLastName}`.replace(/\s+/g, ' ').trim();
                          if (!eDisplayNameTouched) setEDisplayName(composed);
                          if (!eActualNameTouched) setEActualName(composed);
                          clearEErr('middle_name');
                          clearEErr('actual_name');
                        }} />
                        {eErrors.middle_name && <small className="emp-err">{eErrors.middle_name}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Last Name<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.last_name ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="e.g. Kale"
                          value={eLastName}
                          onChange={e => {
                            const v = e.target.value;
                            setELastName(v);
                            const composed = `${eFirstName} ${eMiddleName} ${v}`.replace(/\s+/g, ' ').trim();
                            if (!eDisplayNameTouched) setEDisplayName(composed);
                            if (!eActualNameTouched) setEActualName(composed);
                            clearEErr('last_name');
                            clearEErr('display_name');
                            clearEErr('actual_name');
                          }}
                        />
                        {eErrors.last_name && <small className="emp-err">{eErrors.last_name}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">
                          Display Name<span className="req">*</span>
                          <span className="hint">(auto-generated)</span>
                        </label>
                        <input
                          className={`emp-input is-readonly${eErrors.display_name ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="Auto-filled from First / Middle / Last name"
                          value={eDisplayName}
                          readOnly
                          tabIndex={-1}
                        />
                        {eErrors.display_name && <small className="emp-err">{eErrors.display_name}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">
                          Employee Actual Name<span className="req">*</span>
                          <span className="hint">{eActualNameLocked ? '(auto-generated)' : '(auto-filled · editable)'}</span>
                        </label>
                        <input
                          className={`emp-input${eActualNameLocked ? ' is-readonly' : ''}${eErrors.actual_name ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="Auto-filled from name — edit to override"
                          value={eActualName}
                          readOnly={eActualNameLocked}
                          tabIndex={eActualNameLocked ? -1 : undefined}
                          onChange={e => { setEActualName(e.target.value); setEActualNameTouched(true); clearEErr('actual_name'); }}
                        />
                        {eErrors.actual_name && <small className="emp-err">{eErrors.actual_name}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Gender<span className="req">*</span></label>
                        <MasterSelect value={eGender} onChange={(v) => { setEGender(v); clearEErr('gender'); }} placeholder="Select gender" options={GENDER_OPTIONS} invalid={!!eErrors.gender} />
                        {eErrors.gender && <small className="emp-err">{eErrors.gender}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Date of Birth<span className="req">*</span></label>
                        <MasterDatePicker
                          value={eDob}
                          onChange={(v) => { setEDob(v); clearEErr('date_of_birth'); }}
                          placeholder="dd-mm-yyyy"
                          invalid={!!eErrors.date_of_birth}
                          maxDate={isoYearsAgo(18)}
                        />
                        {eErrors.date_of_birth && <small className="emp-err">{eErrors.date_of_birth}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Nationality<span className="req">*</span></label>
                        <MasterSelect value={eNationality} onChange={(v) => { setENationality(v); clearEErr('nationality_country_id'); }} placeholder="Select nationality" options={countryOptions} invalid={!!eErrors.nationality_country_id} />
                        {eErrors.nationality_country_id && <small className="emp-err">{eErrors.nationality_country_id}</small>}
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-mail-line" /> Contact &amp; Identity
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Personal Email<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.email ? ' is-invalid' : ''}`}
                          type="email"
                          autoComplete="email"
                          spellCheck={false}
                          placeholder="name@enterprise.com"
                          value={eWorkEmail}
                          onChange={e => {
                            const v = e.target.value.replace(/\s+/g, '').toLowerCase();
                            setEWorkEmail(v);
                            clearEErr('email');
                          }}
                        />
                        {eErrors.email && <small className="emp-err">{eErrors.email}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Mobile Number<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.mobile ? ' is-invalid' : ''}`}
                          type="tel"
                          inputMode="numeric"
                          placeholder="10-digit mobile number"
                          maxLength={15}
                          value={eMobile}
                          onChange={e => {
                            const cleaned = e.target.value.replace(/[^\d+]/g, '').slice(0, 15);
                            setEMobile(cleaned);
                            clearEErr('mobile');
                          }}
                          onBlur={() => { void checkMobileUnique(eMobile); }}
                        />
                        {eErrors.mobile && <small className="emp-err">{eErrors.mobile}</small>}
                      </Col>

                      <Col md={4}>
                        <label className="emp-label">
                          Employee ID<span className="hint">(auto-assigned)</span>
                        </label>
                        <input className="emp-input is-readonly" type="text" value={eEmpId} readOnly placeholder="Auto-assigned on save" />
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-map-pin-line" /> Address Details
                    </div>

                    <div className="emp-subsection-title">
                      <i className="ri-checkbox-circle-fill" /> Current Address
                    </div>
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <label className="emp-label">Address Line 1<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.address_line1 ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="House / Flat No., Building, Street"
                          value={eCurAddr1}
                          onChange={e => { setECurAddr1(e.target.value); clearEErr('address_line1'); }}
                        />
                        {eErrors.address_line1 && <small className="emp-err">{eErrors.address_line1}</small>}
                      </Col>
                      <Col md={6}>
                        <label className="emp-label">Address Line 2</label>
                        <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={eCurAddr2} onChange={e => setECurAddr2(e.target.value)} />
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">City<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.city ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="e.g. Pune"
                          value={eCurCity}
                          onChange={e => { setECurCity(e.target.value); clearEErr('city'); }}
                        />
                        {eErrors.city && <small className="emp-err">{eErrors.city}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">Country<span className="req">*</span></label>
                        <MasterSelect
                          value={eCurCountry}
                          onChange={(v) => {
                            setECurCountry(v);
                            if (eCurState) setECurState('');
                            clearEErr('country_id');
                            clearEErr('state_id');
                          }}
                          placeholder="Select country"
                          options={countryOptions}
                          invalid={!!eErrors.country_id}
                        />
                        {eErrors.country_id && <small className="emp-err">{eErrors.country_id}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">State<span className="req">*</span></label>
                        <MasterSelect
                          value={eCurState}
                          onChange={(v) => { setECurState(v); clearEErr('state_id'); }}
                          placeholder={eCurCountry ? 'Select state' : 'Pick country first'}
                          options={currentAddressStates}
                          disabled={!eCurCountry}
                          invalid={!!eErrors.state_id}
                        />
                        {eErrors.state_id && <small className="emp-err">{eErrors.state_id}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">Pincode<span className="req">*</span></label>
                        <input
                          className={`emp-input${eErrors.pincode ? ' is-invalid' : ''}`}
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6-digit pincode"
                          value={eCurPin}
                          onChange={e => { setECurPin(e.target.value.replace(/\D/g, '').slice(0, 6)); clearEErr('pincode'); }}
                        />
                        {eErrors.pincode && <small className="emp-err">{eErrors.pincode}</small>}
                      </Col>
                    </Row>

                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2 mt-2 pt-3" style={{ borderTop: '1px dashed var(--vz-border-color)' }}>
                      <div className="emp-subsection-title mb-0">
                        <i className="ri-checkbox-circle-fill" /> Permanent Address
                      </div>
                      <label className="d-inline-flex align-items-center gap-2 mb-0" style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          className="form-check-input m-0"
                          checked={eSameAsCurrent}
                          onChange={e => onToggleSameAsCurrent(e.target.checked)}
                        />
                        Same as Current Address
                      </label>
                    </div>
                    <Row className="g-3">
                      <Col md={6}>
                        <label className="emp-label">Address Line 1{!eSameAsCurrent && <span className="req">*</span>}</label>
                        <input
                          className={`emp-input${eErrors.perm_address_line1 ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="House / Flat No., Building, Street"
                          value={ePermAddr1}
                          onChange={e => { setEPermAddr1(e.target.value); clearEErr('perm_address_line1'); }}
                          disabled={eSameAsCurrent}
                        />
                        {eErrors.perm_address_line1 && <small className="emp-err">{eErrors.perm_address_line1}</small>}
                      </Col>
                      <Col md={6}>
                        <label className="emp-label">Address Line 2</label>
                        <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={ePermAddr2} onChange={e => setEPermAddr2(e.target.value)} disabled={eSameAsCurrent} />
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">City{!eSameAsCurrent && <span className="req">*</span>}</label>
                        <input
                          className={`emp-input${eErrors.perm_city ? ' is-invalid' : ''}`}
                          type="text"
                          placeholder="e.g. Pune"
                          value={ePermCity}
                          onChange={e => { setEPermCity(e.target.value); clearEErr('perm_city'); }}
                          disabled={eSameAsCurrent}
                        />
                        {eErrors.perm_city && <small className="emp-err">{eErrors.perm_city}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">Country{!eSameAsCurrent && <span className="req">*</span>}</label>
                        <MasterSelect
                          value={ePermCountry}
                          onChange={(v) => { setEPermCountry(v); if (ePermState) setEPermState(''); clearEErr('perm_country_id'); clearEErr('perm_state_id'); }}
                          placeholder="Select country"
                          options={countryOptions}
                          disabled={eSameAsCurrent}
                          invalid={!!eErrors.perm_country_id}
                        />
                        {eErrors.perm_country_id && <small className="emp-err">{eErrors.perm_country_id}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">State{!eSameAsCurrent && <span className="req">*</span>}</label>
                        <MasterSelect
                          value={ePermState}
                          onChange={(v) => { setEPermState(v); clearEErr('perm_state_id'); }}
                          placeholder={ePermCountry ? 'Select state' : 'Pick country first'}
                          options={permanentAddressStates}
                          disabled={eSameAsCurrent || !ePermCountry}
                          invalid={!!eErrors.perm_state_id}
                        />
                        {eErrors.perm_state_id && <small className="emp-err">{eErrors.perm_state_id}</small>}
                      </Col>
                      <Col md={3}>
                        <label className="emp-label">Pincode{!eSameAsCurrent && <span className="req">*</span>}</label>
                        <input
                          className={`emp-input${eErrors.perm_pincode ? ' is-invalid' : ''}`}
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6-digit pincode"
                          value={ePermPin}
                          onChange={e => { setEPermPin(e.target.value.replace(/\D/g, '').slice(0, 6)); clearEErr('perm_pincode'); }}
                          disabled={eSameAsCurrent}
                        />
                        {eErrors.perm_pincode && <small className="emp-err">{eErrors.perm_pincode}</small>}
                      </Col>
                    </Row>
                  </div>
                </>
              )}

              {empStep === 2 && (
                <>
                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-briefcase-line" /> Employment Details
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Joining Date<span className="req">*</span></label>
                        <MasterDatePicker value={eJoinDate} onChange={(v) => { setEJoinDate(v); clearEErr('date_of_joining'); }} placeholder="dd-mm-yyyy" minDate={todayIso} invalid={!!eErrors.date_of_joining} />
                        {eErrors.date_of_joining && <small className="emp-err">{eErrors.date_of_joining}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Department<span className="req">*</span></label>
                        {/* The other half of the same pair: this used to CLEAR a
                            chosen manager whenever the new department did not
                            match theirs. Department and manager are independent,
                            so it now only sets the department. An empty manager
                            is still auto-pointed at the department's HOD by
                            `deptHodValue`, which fills a blank but never
                            overwrites a deliberate pick. */}
                        <MasterSelect value={eDept} onChange={(v) => { setEDept(v); clearEErr('department_id'); }} placeholder="Select department" options={departmentOptions} invalid={!!eErrors.department_id} />
                        {eErrors.department_id && <small className="emp-err">{eErrors.department_id}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Designation<span className="req">*</span></label>
                        {/* Does not touch the Reporting Manager itself. The
                            eligibility effect above clears it only when the new
                            designation genuinely rules that manager out, and
                            leaves it alone otherwise — so a valid manager
                            survives a designation edit, and an invalid one goes
                            blank instead of being replaced by somebody else. */}
                        <MasterSelect value={eDesignation} onChange={(v) => {
                          setEDesignation(v);
                          clearEErr('designation_id');
                        }} placeholder="Select designation" options={designationOptions} invalid={!!eErrors.designation_id} />
                        {eErrors.designation_id && <small className="emp-err">{eErrors.designation_id}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Primary Role<span className="req">*</span></label>
                        <MasterSelect value={ePrimaryRole} onChange={(v) => { setEPrimaryRole(v); clearEErr('primary_role_id'); setEAncillaryRole(prev => prev.filter(id => id !== v)); }} placeholder="Select role" options={primaryRoleOptionsX} invalid={!!eErrors.primary_role_id} />
                        {eErrors.primary_role_id && <small className="emp-err">{eErrors.primary_role_id}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Ancillary Role <span className="hint">(select multiple)</span></label>
                        {/* MasterMultiSelect, not MultiSelectChips: the latter
                          rendered EVERY selected chip, so 10+ roles stacked
                          into four rows and blew the field out of the form
                          grid. This collapses to 3 chips + a "+N more" pill
                          (click to expand/collapse) — the same treatment the
                          segment pickers use. Same props, and it keeps the
                          search box. */}
                        <MasterMultiSelect
                          value={eAncillaryRole}
                          onChange={setEAncillaryRole}
                          options={ancillaryRoleOptionsX}
                          placeholder="Select one or more roles"
                        />
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Work Type<span className="req">*</span></label>
                        <MasterSelect value={eWorkType} onChange={(v) => { setEWorkType(v); clearEErr('work_type'); }} options={WORK_TYPE_OPTIONS} placeholder="Select work type" invalid={!!eErrors.work_type} />
                        {eErrors.work_type && <small className="emp-err">{eErrors.work_type}</small>}
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-building-2-line" /> Organisational Details
                    </div>
                    <Row className="g-3">
                      {/* Legal Entity + Location are both auto-fetched from the
                        branch this employee is being added under — no picker. */}
                      <Col md={4}>
                        <label className="emp-label">
                          Legal Entity<span className="req">*</span>
                          <span className="hint">(auto-fetched)</span>
                        </label>
                        <input
                          className="emp-input is-readonly"
                          type="text"
                          value={eLegalEntityLabel}
                          readOnly
                          placeholder="Select a branch to auto-fetch"
                          title="The branch this employee is hired into — switch branch to change it"
                        />
                        {eErrors.legal_entity_id && <small className="emp-err">{eErrors.legal_entity_id}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">
                          Location<span className="req">*</span>
                          <span className="hint">(auto-fetched)</span>
                        </label>
                        <input
                          className="emp-input is-readonly"
                          type="text"
                          value={eLocation}
                          readOnly
                          placeholder="Auto-fetched with the legal entity"
                          title="The legal entity's city and country"
                        />
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Reporting Manager<span className="req">*</span></label>
                        <MasterSelect
                          value={eReportingMgr}
                          // Deliberately does NOT touch Department. Picking a
                          // manager used to overwrite it with the manager's own
                          // department, silently undoing the choice made two
                          // fields earlier. Cross-department reporting is normal
                          // (a QC hire reporting to a Sales lead), so the manager
                          // list is unfiltered and the two fields stay independent.
                          onChange={(v) => { setEReportingMgr(v); clearEErr('reporting_manager_id'); }}
                          placeholder="Select manager"
                          options={reportingManagerOptions}
                          invalid={!!eErrors.reporting_manager_id}
                        />
                        {eErrors.reporting_manager_id && <small className="emp-err">{eErrors.reporting_manager_id}</small>}
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-file-list-3-line" /> Employment Terms
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Probation Policy (Month)<span className="req">*</span></label>
                        <MasterSelect value={eProbationPolicy} onChange={(v) => { setEProbationPolicy(v); clearEErr('probation_policy'); }} options={PROBATION_POLICY_OPTIONS} placeholder="Select probation policy" invalid={!!eErrors.probation_policy} />
                        {eProbationPolicy === CUSTOM_PROBATION_VALUE && (
                          <input
                            className={`emp-input mt-2${eErrors.probation_policy ? ' is-invalid' : ''}`}
                            type="number"
                            min={1}
                            max={12}
                            step={1}
                            inputMode="numeric"
                            placeholder="Enter months (1–12)"
                            value={eCustomProbation}
                            onChange={e => {
                              // Integer 1–12 only.
                              const digits = e.target.value.replace(/\D/g, '');
                              const v = digits === '' ? '' : String(Math.max(1, Math.min(12, parseInt(digits, 10))));
                              setECustomProbation(v);
                              clearEErr('probation_policy');
                            }}
                            autoFocus
                          />
                        )}
                        {eErrors.probation_policy && <small className="emp-err">{eErrors.probation_policy}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">
                          Probation End Date
                          <span className="hint">(auto-calculated)</span>
                        </label>
                        <input
                          className="emp-input is-readonly"
                          type="text"
                          value={probationInfo.endDisplay}
                          readOnly
                          tabIndex={-1}
                          placeholder={!eJoinDate ? 'Set the joining date' : (probationInfo.months > 0 ? '' : 'No probation')}
                        />
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Notice Period<span className="req">*</span></label>
                        <MasterSelect value={eNoticePeriod} onChange={(v) => { setENoticePeriod(v); clearEErr('notice_period'); }} options={NOTICE_PERIOD_OPTIONS} placeholder="Select notice period" invalid={!!eErrors.notice_period} />
                        {eNoticePeriod === CUSTOM_NOTICE_VALUE && (
                          <input
                            className={`emp-input mt-2${eErrors.notice_period ? ' is-invalid' : ''}`}
                            type="text"
                            placeholder="e.g. 45 Days, 2 months, etc."
                            value={eCustomNotice}
                            onChange={e => { setECustomNotice(e.target.value); clearEErr('notice_period'); }}
                            autoFocus
                          />
                        )}
                        {eErrors.notice_period && <small className="emp-err">{eErrors.notice_period}</small>}
                      </Col>
                    </Row>
                  </div>
                </>
              )}

              {empStep === 3 && (
                <>
                  <div className="emp-section">
                    <div className="emp-section-title" style={{ color: '#0a8a78' }}>
                      <i className="ri-calendar-2-line" style={{ color: '#0ab39c' }} /> Leave, Expense &amp; Attendance
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Leave Plan<span className="req">*</span></label>
                        <MasterSelect
                          value={eLeavePlan}
                          onChange={(v) => { setELeavePlan(v); clearEErr('leave_plan'); }}
                          options={leavePlanOptions}
                          // Greyed shut without the Leave grant — the list is
                          // never fetched in that case, so there is nothing to
                          // open and nothing to assign.
                          disabled={!leavePerm.canView}
                          placeholder={!leavePerm.canView
                            ? 'Requires Leave module access'
                            : (leavePlanOptions.length ? 'Select a leave plan' : 'No plans found — create one in HR > Leave')}
                          invalid={!!eErrors.leave_plan}
                        />
                        {eErrors.leave_plan && <small className="emp-err">{eErrors.leave_plan}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Holiday List (Group)<span className="req">*</span></label>
                        <MasterSelect value={eHolidayList} onChange={(v) => { setEHolidayList(v); clearEErr('holiday_list'); }} options={holidayGroupSelectOptions} placeholder={holidayGroupOptions.length ? 'Select holiday group' : 'No groups — create in HR › Holiday › Groups'} invalid={!!eErrors.holiday_list} />
                        {eErrors.holiday_list && <small className="emp-err">{eErrors.holiday_list}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Shift<span className="req">*</span></label>
                        <MasterSelect value={eShift} onChange={(v) => { setEShift(v); clearEErr('shift'); }} options={shiftSelectOptions} placeholder={shiftPlaceholder} invalid={!!eErrors.shift} />
                        {eErrors.shift && <small className="emp-err">{eErrors.shift}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Weekly Off<span className="req">*</span></label>
                        <MasterSelect value={eWeeklyOff} onChange={(v) => { setEWeeklyOff(v); clearEErr('weekly_off'); }} options={WEEKLY_OFF_OPTIONS} placeholder="Select weekly off" invalid={!!eErrors.weekly_off} />
                        {eErrors.weekly_off && <small className="emp-err">{eErrors.weekly_off}</small>}
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Attendance Number</label>
                        <input
                          className="emp-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="Attendance number"
                          value={eAttendanceNumber}
                          onChange={e => setEAttendanceNumber(e.target.value.replace(/\D/g, ''))}
                          maxLength={20}
                        />
                      </Col>
                      <Col md={4}>
                        <label className="emp-label">Overtime Applicable</label>
                        <MasterSelect value={eOvertimeApplicable} onChange={(v) => { setEOvertimeApplicable(v); if (v !== 'Yes') setEOvertime(''); }} options={YES_NO_OPTIONS} placeholder="Select" />
                      </Col>
                      {eOvertimeApplicable === 'Yes' && (
                        <Col md={4}>
                          <label className="emp-label">Overtime Rate<span className="req">*</span></label>
                          <MasterSelect value={eOvertime} onChange={(v) => { setEOvertime(v); clearEErr('overtime'); }} options={overtimeRateSelectOptions} onOpen={() => reloadMasters()} invalid={!!eErrors.overtime} placeholder={overtimeRateOptions.length ? 'Select overtime rate' : 'No rates — add in Master › Overtime (OT)'} />
                          {eErrors.overtime && <small className="emp-err">{eErrors.overtime}</small>}
                        </Col>
                      )}
                      <Col md={4}>
                        <label className="emp-label">Expense Policy<span className="req">*</span></label>
                        <MasterSelect value={eExpensePolicy} onChange={(v) => { setEExpensePolicy(v); clearEErr('expense_policy'); }} options={EXPENSE_POLICY_OPTIONS} placeholder="Select expense policy" invalid={!!eErrors.expense_policy} />
                        {eErrors.expense_policy && <small className="emp-err">{eErrors.expense_policy}</small>}
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title" style={{ color: '#0c63b0' }}>
                      <i className="ri-computer-line" style={{ color: '#299cdb' }} /> Assets &amp; Security
                    </div>
                    <Row className="g-3">
                      <Col md={4}>
                        <label className="emp-label">Laptop Assigned</label>
                        <MasterSelect
                          value={eLaptopAssigned}
                          onChange={(v) => {
                            setELaptopAssigned(v);
                            if (v !== 'Yes') {
                              setELaptopMasterAssetId('');
                              clearEErr('laptop_master_asset_id');
                            }
                          }}
                          options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                        />
                      </Col>
                      {eLaptopAssigned === 'Yes' && (
                        <Col md={4}>
                          <label className="emp-label">Laptop Device<span className="req">*</span></label>
                          <MasterSelect
                            value={eLaptopMasterAssetId}
                            onChange={(v) => { setELaptopMasterAssetId(v); clearEErr('laptop_master_asset_id'); }}
                            options={laptopAssetOpts}
                            placeholder={laptopAssetOpts.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                            disabled={laptopAssetOpts.length === 0}
                            invalid={!!eErrors.laptop_master_asset_id}
                          />
                          {eErrors.laptop_master_asset_id && <small className="emp-err">{eErrors.laptop_master_asset_id}</small>}
                        </Col>
                      )}

                      <Col md={4}>
                        <label className="emp-label">Mobile Assigned</label>
                        <MasterSelect
                          value={eMobileAssigned}
                          onChange={(v) => {
                            setEMobileAssigned(v);
                            if (v !== 'Yes') {
                              setEMobileMasterAssetId('');
                              clearEErr('mobile_master_asset_id');
                            }
                          }}
                          options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                        />
                      </Col>
                      {eMobileAssigned === 'Yes' && (
                        <Col md={4}>
                          <label className="emp-label">Mobile Device<span className="req">*</span></label>
                          <MasterSelect
                            value={eMobileMasterAssetId}
                            onChange={(v) => { setEMobileMasterAssetId(v); clearEErr('mobile_master_asset_id'); }}
                            options={mobileAssetOpts}
                            placeholder={mobileAssetOpts.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                            disabled={mobileAssetOpts.length === 0}
                            invalid={!!eErrors.mobile_master_asset_id}
                          />
                          {eErrors.mobile_master_asset_id && <small className="emp-err">{eErrors.mobile_master_asset_id}</small>}
                        </Col>
                      )}

                      <Col md={12}>
                        <label className="emp-label">Other Assets <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(optional)</span></label>
                        <MasterMultiSelect
                          value={eOtherMasterAssetIds}
                          onChange={setEOtherMasterAssetIds}
                          options={otherAssetOpts}
                          placeholder={otherAssetOpts.length === 0 ? 'No other assets available' : 'Pick one or more'}
                          disabled={otherAssetOpts.length === 0}
                        />
                      </Col>
                    </Row>
                  </div>

                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-file-text-line" /> Documents
                    </div>
                    <Row className="g-3">
                      {[
                        { key: 'aadhaar', label: 'Aadhar Card', required: true, file: eAadharFile, set: setEAadharFile, accept: '.pdf,.jpg,.jpeg,.png', hint: '(format .pdf, .jpg, .png)' as string },
                        { key: 'pan', label: 'Pan Card', required: true, file: ePanFile, set: setEPanFile, accept: '.pdf,.jpg,.jpeg,.png', hint: '(format .pdf, .jpg, .png)' as string },
                        { key: 'photo', label: 'Passport Size Photo', required: false, file: ePhotoFile, set: setEPhotoFile, accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', hint: '(format .jpg, .png)' },
                      ].map(d => {
                        const srv = eExistingDocs[d.key];
                        const busy = !!eDocBusy[d.key];
                        const hasUpload = !!srv;
                        const errKey = d.key === 'aadhaar' ? 'doc_aadhaar'
                          : d.key === 'pan' ? 'doc_pan'
                            : null;
                        const tileError = errKey ? eErrors[errKey] : undefined;
                        return (
                          <Col md={4} key={d.key}>
                            <label className="emp-label">
                              {d.label}{d.required && <span className="req">*</span>}
                              {d.hint && <span className="hint">{d.hint}</span>}
                            </label>

                            {hasUpload ? (
                              <div
                                className="emp-doc-tile-uploaded"
                                style={{
                                  borderRadius: 8,
                                  padding: '8px 12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 12.5,
                                  minHeight: 38,
                                }}
                              >
                                <i className="ri-checkbox-circle-line emp-doc-check" />
                                <span className="emp-doc-fname" style={{ flexGrow: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {srv.original_name || `${d.label} uploaded`}
                                </span>
                                {srv.url && (
                                  <a
                                    href={srv.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="View document"
                                    style={{ color: '#0c63b0', fontSize: 16, lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
                                  >
                                    <i className="ri-eye-line" />
                                  </a>
                                )}
                                <label
                                  title="Replace"
                                  className="mb-0"
                                  style={{ color: '#7c5cfc', cursor: busy ? 'wait' : 'pointer', fontSize: 16, lineHeight: 1, opacity: busy ? 0.5 : 1, margin: 0, display: 'inline-flex', alignItems: 'center' }}
                                >
                                  <i className={busy ? 'ri-loader-line' : 'ri-refresh-line'} />
                                  <input
                                    type="file"
                                    accept={d.accept}
                                    disabled={busy}
                                    style={{ display: 'none' }}
                                    onChange={e => {
                                      const f = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!f) return;
                                      if (!isAcceptedFile(f, d.accept)) {
                                        toast.error('Unsupported file type', `${d.label} accepts ${d.accept}`);
                                        return;
                                      }
                                      if (f.size > 2 * 1024 * 1024) {
                                        toast.error('File too large', `${d.label} must be ≤ 2 MB (this file is ${(f.size / 1048576).toFixed(1)} MB)`);
                                        return;
                                      }
                                      d.set(f);
                                      uploadEmpDoc(d.key, d.label, f);
                                    }}
                                  />
                                </label>
                              </div>
                            ) : (
                              <label
                                className={`emp-doc-tile-empty d-flex align-items-center justify-content-center gap-2${tileError ? ' has-error' : ''}`}
                                style={{
                                  height: 38,
                                  borderRadius: 8,
                                  cursor: busy ? 'wait' : 'pointer',
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  opacity: busy ? 0.6 : 1,
                                }}
                              >
                                <i className={busy ? 'ri-loader-line' : 'ri-upload-2-line'} />
                                {busy ? 'Uploading…' : (d.file ? d.file.name : 'Choose file')}
                                <input
                                  type="file"
                                  accept={d.accept}
                                  disabled={busy}
                                  style={{ display: 'none' }}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!f) return;
                                    if (!isAcceptedFile(f, d.accept)) {
                                      toast.error('Unsupported file type', `${d.label} accepts ${d.accept}`);
                                      return;
                                    }
                                    if (f.size > 2 * 1024 * 1024) {
                                      toast.error('File too large', `${d.label} must be ≤ 2 MB (this file is ${(f.size / 1048576).toFixed(1)} MB)`);
                                      return;
                                    }
                                    d.set(f);
                                    if (errKey) clearEErr(errKey);
                                    uploadEmpDoc(d.key, d.label, f);
                                  }}
                                />
                              </label>
                            )}
                            {tileError && <small className="emp-err">{tileError}</small>}
                          </Col>
                        );
                      })}
                    </Row>
                  </div>
                </>
              )}

              {empStep === 4 && (
                <>
                  <div className="emp-section">
                    <div className="emp-section-title">
                      <i className="ri-money-dollar-circle-line" /> Payroll Configuration
                    </div>
                    <div
                      className="emp-payroll-banner d-flex align-items-center gap-2 mb-3"
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                      }}
                    >
                      <button
                        type="button"
                        aria-pressed={eEnablePayroll}
                        onClick={() => setEEnablePayroll(v => !v)}
                        className="btn p-0 border-0 d-inline-flex align-items-center"
                        style={{
                          width: 36, height: 20, borderRadius: 999,
                          background: eEnablePayroll ? '#7c5cfc' : '#e5e7eb',
                          position: 'relative',
                          transition: 'background .15s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 14, height: 14, borderRadius: '50%',
                            background: '#fff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                            position: 'absolute', top: 3,
                            left: eEnablePayroll ? 19 : 3, transition: 'left .15s ease',
                          }}
                        />
                      </button>
                      <span className="emp-payroll-banner-text" style={{ fontSize: 13, fontWeight: 600 }}>
                        {/* Labelled "PF Applicable" on request. The flag behind
                          it is `enable_payroll` and it gates the WHOLE
                          Compensation step — CTC, effective date and the salary
                          breakup as well as PF — so the note below carries that
                          scope, because the label no longer does. There is also
                          a separate "PF Applicable" dropdown inside this block;
                          the two now read alike on one screen. */}
                        PF Applicable for this Employee
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#6b7280', margin: '-6px 0 12px 2px', lineHeight: 1.45 }}>
                      Turning this off also removes <strong>CTC, salary effective date and the salary breakup</strong> for this employee, not just PF.
                    </div>
                    <Row className="g-3">
                      <Col md={6}>
                        <label className="emp-label">Annual CTC{eEnablePayroll && <span className="req">*</span>}</label>
                        {/* ₹ prefix — the amount is always INR here (the payroll
                          breakup rows below already show it), so the symbol sits
                          inside the field rather than in the label. Absolutely
                          positioned + extra left padding on the input so it
                          can't overlap the typed value. */}
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <span
                            style={{
                              position: 'absolute', left: 11, fontSize: 13,
                              color: 'var(--vz-secondary-color)', pointerEvents: 'none', lineHeight: 1,
                            }}
                          >
                            ₹
                          </span>
                          <input
                            className={`emp-input${eErrors.annual_salary ? ' is-invalid' : ''}`}
                            type="number"
                            placeholder="Enter annual amount"
                            value={eAnnualSalary}
                            max={999999999999}
                            step="1"
                            inputMode="numeric"
                            /* Locked while the saved structure is still in flight.
                               The response overwrites the whole breakup when it
                               lands, so a CTC typed during the fetch was silently
                               thrown away a moment later — the one point in this
                               form where the server can actually outrun the user. */
                            disabled={eBreakupLoading}
                            onChange={e => {
                              const raw = e.target.value;
                              if (raw === '') { setEAnnualSalary(''); setBreakupRecalcing(false); clearEErr('annual_salary'); return; }
                              // Whole rupees only — a CTC is never quoted in paise,
                              // and the decimals only ever reached the breakup as
                              // rounding noise across the 50 / 30 / 20 split.
                              if (!/^\d{0,12}$/.test(raw)) return;
                              setEAnnualSalary(raw);
                              if (eDetailedBreakup) setBreakupRecalcing(true);
                              clearEErr('annual_salary');
                            }}
                            style={{ width: '100%', paddingLeft: 25, cursor: eBreakupLoading ? 'not-allowed' : undefined }}
                          />
                        </div>
                        {eBreakupLoading && (
                          <small className="text-muted d-block mt-1" style={{ fontSize: 11 }}>
                            <i className="ri-loader-4-line emp-spin" /> Loading the saved breakup — CTC unlocks in a moment.
                          </small>
                        )}
                        {eErrors.annual_salary && <small className="emp-err">{eErrors.annual_salary}</small>}
                      </Col>
                      {/* The first salary runs from the day the employee joined,
                          so this is the joining date and nothing else. It was a
                          free picker bounded only by "not before joining, within
                          six months", which let the two drift apart and dated
                          the salary structure wrongly. Mirrored and read-only —
                          there is one right answer, so asking for it and then
                          rejecting the wrong ones is just a slower way of
                          filling it in. */}
                      <Col md={6}>
                        <label className="emp-label">
                          Salary Effective From
                          <span className="hint">(same as joining date)</span>
                        </label>
                        <input
                          className="emp-input is-readonly"
                          readOnly
                          tabIndex={-1}
                          value={eJoinDate ? new Date(eJoinDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                          placeholder="Set the joining date first"
                          title="Always the joining date — the first salary structure starts the day the employee joins."
                        />
                        {eErrors.salary_effective_from && <small className="emp-err">{eErrors.salary_effective_from}</small>}
                      </Col>
                    </Row>
                    {/* PF setup — Applicable on/off, then the calculation method.
                      Statutory caps basic at ₹15k (EPF ceiling); Standard uses
                      the full basic. Read by the payroll engine. */}
                    {eEnablePayroll && (
                      <Row className="g-3 mt-0">
                        <Col md={6}>
                          <label className="emp-label">PF Applicable<span className="req">*</span></label>
                          <MasterSelect
                            value={ePfEligible ? 'Yes' : 'No'}
                            onChange={(v) => setEPfEligible(v === 'Yes')}
                            options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                          />
                        </Col>
                        {ePfEligible && (
                          <Col md={6}>
                            <label className="emp-label">PF Type</label>
                            <MasterSelect
                              value={ePfType || 'Statutory'}
                              onChange={(v) => setEPfType(v)}
                              options={[{ value: 'Statutory', label: 'Statutory (₹15k cap)' }, { value: 'Standard', label: 'Standard (full basic)' }]}
                            />
                          </Col>
                        )}
                      </Row>
                    )}
                  </div>

                  <div className="emp-section">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                      <div className="emp-section-title mb-0">
                        <i className="ri-calculator-line" style={{ color: '#0c63b0' }} /> Salary Breakup
                      </div>
                      <span className="d-inline-flex align-items-center gap-2 mb-0" style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>
                        <button
                          type="button"
                          aria-pressed={eDetailedBreakup}
                          onClick={() => setEDetailedBreakup(v => !v)}
                          className="btn p-0 border-0 d-inline-flex align-items-center"
                          style={{
                            width: 36, height: 20, borderRadius: 999,
                            background: eDetailedBreakup ? '#0ab39c' : '#e5e7eb',
                            position: 'relative',
                            transition: 'background .15s ease',
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            style={{
                              width: 14, height: 14, borderRadius: '50%',
                              background: '#fff',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                              position: 'absolute', top: 3,
                              left: eDetailedBreakup ? 19 : 3, transition: 'left .15s ease',
                            }}
                          />
                        </button>
                        <span
                          onClick={() => setEDetailedBreakup(v => !v)}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                        >
                          Detailed breakup
                        </span>
                      </span>
                    </div>
                    <div className="emp-label mb-1">Salary Effective From</div>
                    <div className="text-muted mb-3" style={{ fontSize: 13 }}>
                      {(() => {
                        if (!eSalaryFrom) return '—';
                        const [y, m, d] = eSalaryFrom.slice(0, 10).split('-');
                        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
                        return mon ? `${d}-${mon}-${y}` : eSalaryFrom;
                      })()}
                    </div>

                    {!eDetailedBreakup ? (
                      <div
                        className="emp-ctc-card d-flex align-items-center justify-content-between flex-wrap"
                        style={{
                          borderRadius: 10,
                          padding: '14px 16px',
                          gap: 12,
                        }}
                      >
                        <div className="text-center" style={{ flex: 1 }}>
                          <div className="emp-label mb-1">Regular Salary</div>
                          <div className="emp-ctc-num" style={{ fontSize: 18, fontWeight: 800 }}>
                            INR {Number(eAnnualSalary || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="emp-ctc-plus" style={{ fontSize: 18 }}>+</div>
                        <div className="text-center" style={{ flex: 1 }}>
                          <div className="emp-label mb-1">Bonus</div>
                          <div className="emp-ctc-num" style={{ fontSize: 18, fontWeight: 800 }}>INR 0</div>
                        </div>
                        <div className="emp-ctc-plus" style={{ fontSize: 18 }}>=</div>
                        <div className="text-center emp-ctc-total" style={{ flex: 1, borderRadius: 8, padding: '6px 8px' }}>
                          <div className="emp-label mb-1">Total CTC</div>
                          <div className="emp-ctc-num" style={{ fontSize: 18, fontWeight: 800 }}>
                            INR {Number(eAnnualSalary || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                      </div>
                    ) : eBreakupLoading ? (
                      <div className="text-center py-4 text-muted" style={{ fontSize: 13 }}>
                        <i className="ri-loader-4-line emp-spin" /> Loading breakup…
                      </div>
                    ) : (
                      <div style={{ position: 'relative' }}>
                        {/* Scrim + label, not a replacement: the figures stay in
                          place underneath so the section doesn't collapse and
                          jump the page every time the CTC is edited. */}
                        {breakupRecalcing && (
                          <>
                            <div style={{
                              position: 'absolute', inset: -6, zIndex: 3, borderRadius: 10,
                              background: 'var(--vz-card-bg, #fff)', opacity: 0.72,
                            }} />
                            <div style={{
                              position: 'absolute', inset: -6, zIndex: 4,
                              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40,
                            }}>
                              <span className="d-inline-flex align-items-center gap-2 px-3 py-2"
                                style={{
                                  fontSize: 12.5, fontWeight: 600, color: 'var(--vz-secondary-color)',
                                  background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)',
                                  borderRadius: 999, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                }}>
                                <i className="ri-loader-4-line emp-spin" /> Recalculating breakup…
                              </span>
                            </div>
                          </>
                        )}
                        <div className="text-muted mb-2" style={{ fontSize: 12 }}>
                          Monthly component breakup. Saved as the employee's active salary
                          structure — payroll runs read these figures.
                        </div>
                        {/* How the auto-split + statutory deductions are derived,
                          so anyone reading the breakup understands the figures. */}
                        <ul className="mb-3 ps-3" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', lineHeight: 1.7 }}>
                          <li><strong>Basic Salary</strong> — 50% of the monthly gross (statutory minimum under Code on Wages, 2019; you can adjust the components below).</li>
                          <li><strong>House Rent Allowance (HRA)</strong> — 30% of the monthly gross.</li>
                          <li><strong>Special Allowance</strong> — the remaining balance after Basic + HRA and any component you add, so the gross stays on the CTC.</li>
                          <li><strong>PF Deduction</strong> — <strong>12% of Basic Salary</strong>; <em>Statutory</em> caps the basic at the ₹15,000 EPF ceiling (max ₹1,800/mo), <em>Standard</em> uses the full basic. Toggle PF on/off via <em>PF Applicable</em> above.</li>
                          <li><strong>ESI / Professional Tax</strong> — whatever you enter here is deducted <strong>in full</strong> each cycle; they are not scaled down for a part-month or for loss of pay.</li>
                        </ul>
                        <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
                          <label className="d-flex align-items-center gap-1 mb-0" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                            <input type="checkbox" checked={eEsiApplicable} onChange={e => setStatutoryToggle('esi', e.target.checked)} /> ESI
                          </label>
                          <label className="d-flex align-items-center gap-1 mb-0" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                            <input type="checkbox" checked={ePtApplicable} onChange={e => setStatutoryToggle('pt', e.target.checked)} /> Professional Tax
                          </label>
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            Ticking one adds it to Fixed Deductions — editable, and payroll uses what's saved here.
                          </span>
                        </div>
                        <Row className="g-4">
                          <Col md={6}>{renderBreakTable('earn', '#108548', 'Earnings')}</Col>
                          <Col md={6}>{renderBreakTable('ded', '#b91c1c', 'Fixed Deductions (optional)')}</Col>
                        </Row>

                        <div className="d-flex align-items-center justify-content-between mt-3 p-2 px-3"
                          style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
                          {/* Gross — sum of all earning components (NOT CTC; CTC also
                            includes employer PF/ESI/gratuity, which aren't here). */}
                          <span className="fw-semibold" style={{ fontSize: 13 }}>Monthly Gross</span>
                          <div className="text-end">
                            <div className="fw-bold" style={{ fontSize: 18, color: '#5a3fd1' }}>
                              ₹{breakupGross.toLocaleString('en-IN')}
                            </div>
                            {/* Annualised gross vs the entered Salary Amount —
                              red when components exceed the CTC, green when at/under. */}
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: salaryAnnual <= 0 ? 'var(--vz-secondary-color)' : (breakupOverSalary ? '#dc2626' : '#0a8754') }}>
                              ≈ ₹{breakupAnnual.toLocaleString('en-IN')} / year
                            </div>
                            {salaryAnnual > 0 && !breakupMatches && (
                              <div style={{ fontSize: 10.5, fontWeight: 600, color: breakupOverSalary ? '#dc2626' : '#0a8754' }}>
                                {breakupOverSalary
                                  ? `₹${breakupDiff.toLocaleString('en-IN')} over the salary (₹${salaryAnnual.toLocaleString('en-IN')})`
                                  : `₹${Math.abs(breakupDiff).toLocaleString('en-IN')} under the salary (₹${salaryAnnual.toLocaleString('en-IN')})`}
                              </div>
                            )}
                            {salaryAnnual > 0 && breakupMatches && (
                              <div style={{ fontSize: 10.5, fontWeight: 600, color: '#0a8754' }}>Matches the salary amount</div>
                            )}
                          </div>
                        </div>
                        {/* Live deduction estimate + net — Net = Gross − PF − ESI −
                          PT − fixed deductions. Updates with PF / ESI / PT
                          selections and any Fixed Deductions added. */}
                        {(pfActive || breakupDed > 0) && (
                          <>
                            {pfActive && (
                              <div className="d-flex align-items-center justify-content-between mt-2 px-3" style={{ fontSize: 12.5 }}>
                                <span className="text-muted">
                                  Provident Fund (PF) — 12% of Basic Salary
                                  (₹{breakupGross.toLocaleString('en-IN')})
                                </span>
                                <span className="fw-semibold" style={{ color: '#b91c1c' }}>− ₹{breakupPf.toLocaleString('en-IN')}/mo</span>
                              </div>
                            )}
                            {breakupDedExPf > 0 && (
                              <div className="d-flex align-items-center justify-content-between mt-2 px-3" style={{ fontSize: 12.5 }}>
                                <span className="text-muted">Fixed Deductions</span>
                                <span className="fw-semibold" style={{ color: '#b91c1c' }}>− ₹{breakupDedExPf.toLocaleString('en-IN')}/mo</span>
                              </div>
                            )}
                            <div className="d-flex align-items-center justify-content-between mt-2 p-2 px-3"
                              style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
                              <span className="fw-semibold" style={{ fontSize: 13 }}>Net (Monthly)</span>
                              <div className="text-end">
                                <div className="fw-bold" style={{ fontSize: 18, color: '#0a8754' }}>
                                  ₹{breakupNet.toLocaleString('en-IN')}
                                </div>
                                <div className="text-muted" style={{ fontSize: 11.5 }}>
                                  Gross ₹{breakupGross.toLocaleString('en-IN')}{pfActive ? ` − PF ₹${breakupPf.toLocaleString('en-IN')}` : ''}{breakupDedExPf > 0 ? ` − Deductions ₹${breakupDedExPf.toLocaleString('en-IN')}` : ''}
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                        {(eErrors.salary_breakup || breakupErrors.form) && (
                          <small className="emp-err d-block mt-2">{eErrors.salary_breakup || breakupErrors.form}</small>
                        )}
                        <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                          Net shown is an estimate (PF / ESI / PT + fixed deductions); LOP and any final adjustments apply at payroll run-time.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              </>)}
            </fieldset>
          </div>

          <div
            className="emp-footer-bar d-flex align-items-center justify-content-between gap-2 flex-wrap"
            style={{ padding: '14px 22px' }}
          >
            {/* Left slot is empty now — Previous sits beside the forward button
                on the right, so the pair reads as one control and the pointer
                doesn't cross the dialog to step back and forth. */}
            <span />

            <div className="d-flex align-items-center gap-2">
              {empStep > 1 && (
                <button
                  type="button"
                  onClick={() => setEmpStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
                  // Previous must freeze too — stepping away mid-save would swap
                  // the form under the in-flight PUT, and mid-load there is
                  // nothing to step back to yet.
                  disabled={saving || empLoading}
                  className="rec-btn-ghost"
                >
                  <i className="ri-arrow-left-s-line" /> Previous
                </button>
              )}
              {empStep < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={saving || empLoading}
                  className="rec-btn-primary"
                  style={{
                    minWidth: 140,
                    justifyContent: 'center',
                    cursor: saving ? 'wait' : 'pointer',
                    opacity: saving ? 0.9 : 1,
                  }}
                >
                  {saving ? (
                    <>
                      <i className="ri-loader-4-line emp-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      {/* "Save & Next" — the step IS persisted on the way
                          through (handleNextStep PUTs before advancing), and a
                          plain "Next" read like the work was being carried
                          along unsaved until the final button. */}
                      Save &amp; Next <i className="ri-arrow-right-s-line" />
                    </>
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={saving || empLoading}
                    onClick={handleSaveEmployee}
                    className="rec-btn-primary"
                    style={{ minWidth: 170, justifyContent: 'center', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.9 : 1 }}
                  >
                    {saving ? (
                      <>
                        <i className="ri-loader-4-line emp-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <i className="ri-check-line" />
                        {empMode === 'edit' ? 'Update Employee' : 'Save Employee'}
                        <i className="ri-arrow-right-line" />
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </ModalBody>
      </Modal>

      <Modal
        isOpen={assignOpen}
        toggle={closeAssign}
        centered
        size="lg"
        contentClassName="border-0"
        modalClassName="master-modal"
        backdrop="static"
        keyboard={false}
      >

        <ModalBody className="p-0">
          <div
            style={{
              padding: '22px 26px',
              background: 'linear-gradient(120deg, #5b3fd1 0%, #6366f1 55%, #7c5cfc 100%)',
              color: '#fff',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{
              position: 'absolute', top: -50, right: -40, width: 220, height: 220,
              borderRadius: '50%', background: 'rgba(255,255,255,0.10)',
            }} />
            <button
              type="button"
              onClick={closeAssign}
              aria-label="Close"
              className="assign-close-x btn p-0 d-inline-flex align-items-center justify-content-center"
              style={{
                position: 'absolute', top: 16, right: 18, zIndex: 2,
                width: 30, height: 30, borderRadius: 10,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.30)',
                color: '#fff',
              }}
            >
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
            <div className="d-flex align-items-center gap-3" style={{ position: 'relative', paddingRight: 44 }}>
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'rgba(255,255,255,0.22)',
                    /* Heavier ring — at 1px the outline all but vanished against
                       the violet gradient behind it, leaving the tile reading as
                       a soft patch rather than a framed icon. */
                    border: '2.5px solid rgba(255,255,255,0.55)',
                  }}
                >
                  <i className="ri-computer-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-1 text-white" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>
                    Assign Assets
                  </h5>
                  <div className="text-truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)' }}>
                    {assignEmp ? (
                      <>
                        {assignEmp.name} · <span className="font-monospace">{assignEmp.id}</span> · {assignEmp.department}
                      </>
                    ) : 'Fill in the details to assign assets to this employee'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: '20px 24px 8px' }}>
            <div className="assign-section-title mb-3">
              <i className="ri-computer-line" /> Assets &amp; Security
            </div>
            <Row className="g-3">
              <Col md={assetColSpan}>
                <label>Laptop Assigned</label>
                <MasterSelect
                  value={aLaptopAssigned}
                  onChange={(v) => {
                    setALaptopAssigned(v);
                    if (v !== 'Yes') setALaptopMasterAssetId('');
                    setAErrors(p => ({ ...p, laptop: '' }));
                  }}
                  options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                />
              </Col>
              {aLaptopAssigned === 'Yes' && (
                <Col md={assetColSpan}>
                  <label>Laptop Device<span style={{ color: '#ef4444', marginLeft: 2 }}>*</span></label>
                  <MasterSelect
                    value={aLaptopMasterAssetId}
                    onChange={(v) => { setALaptopMasterAssetId(v); setAErrors(p => ({ ...p, laptop: '' })); }}
                    options={aLaptopOpts}
                    onOpen={() => reloadAssignAssets()}
                    placeholder={aLaptopOpts.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                    disabled={aLaptopOpts.length === 0}
                    invalid={!!aErrors.laptop}
                  />
                  {aErrors.laptop && <small style={{ color: '#dc2626', fontSize: 11.5 }}>{aErrors.laptop}</small>}
                </Col>
              )}

              <Col md={assetColSpan}>
                <label>Mobile Assigned</label>
                <MasterSelect
                  value={aMobileAssigned}
                  onChange={(v) => {
                    setAMobileAssigned(v);
                    if (v !== 'Yes') setAMobileMasterAssetId('');
                    setAErrors(p => ({ ...p, mobile: '' }));
                  }}
                  options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                />
              </Col>
              {aMobileAssigned === 'Yes' && (
                <Col md={assetColSpan}>
                  <label>Mobile Device<span style={{ color: '#ef4444', marginLeft: 2 }}>*</span></label>
                  <MasterSelect
                    value={aMobileMasterAssetId}
                    onChange={(v) => { setAMobileMasterAssetId(v); setAErrors(p => ({ ...p, mobile: '' })); }}
                    options={aMobileOpts}
                    onOpen={() => reloadAssignAssets()}
                    placeholder={aMobileOpts.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                    disabled={aMobileOpts.length === 0}
                    invalid={!!aErrors.mobile}
                  />
                  {aErrors.mobile && <small style={{ color: '#dc2626', fontSize: 11.5 }}>{aErrors.mobile}</small>}
                </Col>
              )}

              <Col md={12}>
                <label>Other Assets <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(optional)</span></label>
                <MasterMultiSelect
                  value={aOtherMasterAssetIds}
                  onChange={setAOtherMasterAssetIds}
                  options={aOtherOpts}
                  onOpen={() => reloadAssignAssets()}
                  placeholder={aOtherOpts.length === 0 ? 'No other assets available' : 'Pick one or more'}
                  disabled={aOtherOpts.length === 0}
                />
              </Col>
            </Row>
          </div>

          <div
            className="d-flex align-items-center justify-content-between gap-2 flex-wrap"
            /* Tightened from 14/18 — the bottom pad was 4px deeper than the top,
               so the bar sat visually low and added height the two buttons
               never needed. Even 10px now. */
            style={{ padding: '10px 24px', borderTop: '1px solid var(--vz-border-color)' }}
          >
            <span />
            {/* Cancel dropped — the header X already dismisses this dialog, and
                two ways out sitting on the same screen made the footer read as
                a choice between them. */}
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAssign}
                disabled={aSaving}
                className="assign-save-btn"
                style={aSaving ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              >
                {aSaving ? (
                  <>
                    <i className="ri-loader-4-line" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }} />
                    Saving…
                  </>
                ) : (
                  <>
                    <i className="ri-save-line" style={{ fontSize: 16 }} />
                    Save Assets
                  </>
                )}
              </button>
            </div>
          </div>
        </ModalBody>
      </Modal>

      {/* The shared vault (components/EvidenceVaultModal) — the same modal
          Onboarding and Exit Management open. */}
      <EvidenceVaultModal
        employee={vaultOpen && vaultEmp ? {
          id: Number((vaultEmp as any)._dbId),
          empId: vaultEmp.id,
          name: vaultEmp.name,
          department: vaultEmp.department,
          designation: vaultEmp.designation,
        } : null}
        onClose={closeVault}
        initialTab={vaultTab}
      />

      <FaceRegistrationModal
        open={faceRegEmployeeId !== null}
        onClose={() => setFaceRegEmployeeId(null)}
        employeeId={faceRegEmployeeId ?? undefined}
        onRegistered={() => reloadEmployees()}
      />
    </>
  );
}

/* AncillaryRolesChip lived here as a second, near-identical copy of
   components/ui/../AncillaryRolesChip — its own comment even said "same
   treatment as the shared AncillaryRolesChip". Every positioning fix went
   into the shared one and this page kept rendering the local copy, so the
   popover here never changed. Deleted; the shared component is imported. */

/**
 * Stand-in for the wizard body while the employee's record is in flight.
 *
 * Shaped like the step it replaces — two titled sections of three-across
 * fields — so the dialog does not visibly reflow when the real fields arrive.
 * A spinner in the middle of an empty dialog would say "wait" without saying
 * what is coming.
 */
function EmpFormSkeleton() {
  const Field = () => (
    <Col md={4}>
      <Shimmer height={10} width="42%" />
      <div style={{ marginTop: 7 }}><Shimmer height={34} /></div>
    </Col>
  );
  return (
    <div aria-hidden>
      {[0, 1].map(section => (
        <div className="emp-section" key={section}>
          <div style={{ marginBottom: 14 }}><Shimmer height={12} width={168} /></div>
          <Row className="g-3">
            {Array.from({ length: 6 }, (_, i) => <Field key={i} />)}
          </Row>
        </div>
      ))}
    </div>
  );
}

/**
 * Greying for a control the user lacks the permission for. Returns undefined
 * when allowed so the element keeps its own styling untouched.
 *
 * Note it does NOT set `pointer-events: none` — the control must still receive
 * the click that triggers the explanatory toast.
 */
function lockedStyle(locked: boolean): React.CSSProperties | undefined {
  return locked
    ? { opacity: 0.5, cursor: 'not-allowed', filter: 'grayscale(0.7)' }
    : undefined;
}

/**
 * `disabled` and `locked` look identical but behave differently on purpose.
 *
 *   disabled — the action is impossible for this ROW (employee is deactivated).
 *              Truly inert; there is nothing to explain.
 *   locked   — the action is possible but this USER lacks the permission flag.
 *              Stays clickable so the handler can raise the "you don't have
 *              permission" toast. A greyed button that swallows the click
 *              leaves the user guessing whether the app is broken.
 */
function ActionBtn({
  title, icon, color, onClick, disabled, locked, badge,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean; locked?: boolean; badge?: 'dot' }) {
  const dim = disabled || locked;
  return (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        aria-disabled={locked || undefined}
        className="btn p-0 d-inline-flex align-items-center justify-content-center position-relative"
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--vz-secondary-bg)',
          border: '1px solid var(--vz-border-color)',
          color: 'var(--vz-secondary-color)',
          transition: 'all .15s ease',
          opacity: dim ? 0.4 : 1,
          cursor: dim ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={e => {
          if (dim) return;
          const el = e.currentTarget as HTMLButtonElement;
          el.style.borderColor = `var(--vz-${color})`;
          el.style.color = `var(--vz-${color})`;
        }}
        onMouseLeave={e => {
          if (dim) return;
          const el = e.currentTarget as HTMLButtonElement;
          el.style.borderColor = 'var(--vz-border-color)';
          el.style.color = 'var(--vz-secondary-color)';
        }}
        onClick={() => { if (!disabled) onClick(); }}
      >
        <i className={`${icon} fs-14`} />
        {badge === 'dot' && (
          <span
            aria-hidden
            style={{
              position: 'absolute', top: -2, right: -2,
              width: 9, height: 9, borderRadius: '50%',
              background: '#10b981',
              /* Ring reads as a cut-out of the surface behind the avatar, so it
                 has to BE that surface. --vz-card-bg is card-scoped and empty
                 here, leaving a white ring on a dark page. */
              border: '2px solid var(--vz-secondary-bg, #fff)',
              boxShadow: '0 0 0 1px rgba(16,185,129,0.35)',
            }}
          />
        )}
      </button>
    </Tooltip>
  );
}

/* MultiSelectChips lived here and was replaced by MasterMultiSelect (see the
   note beside the Ancillary Role picker: this one rendered every selected chip,
   so ten roles stacked into four rows and pushed the field out of the form
   grid). The replacement landed but the original was left behind — 122 lines
   that nothing in the codebase referenced. Deleted. */

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (!end) { setDisplay(0); return; }
    const duration = 1200;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step || 1);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

function ToggleSwitch({
  initial,
  onRequestToggle,
  locked = false,
  lockedTitle,
  onLockedClick,
}: {
  initial: boolean;
  onRequestToggle?: (next: boolean, commit: () => void) => void;
  // When locked the switch is frozen (e.g. an EXITED employee can't be
  // re-enabled). It renders disabled with an explanatory tooltip.
  locked?: boolean;
  lockedTitle?: string;
  /* Supplied when the lock is a missing PERMISSION rather than a fact about
     the employee. The switch then stays clickable (aria-disabled, not
     disabled) so the click can raise a toast naming the missing flag — an
     inert switch would read as a bug. */
  onLockedClick?: () => void;
}) {
  const [on, setOn] = useState(initial);
  const commit = () => setOn(v => !v);
  const handleClick = () => {
    if (locked) { onLockedClick?.(); return; }
    if (onRequestToggle) onRequestToggle(!on, commit);
    else commit();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={on}
      disabled={locked && !onLockedClick}
      aria-disabled={locked || undefined}
      title={locked ? (lockedTitle || 'This employee has exited and cannot be re-enabled.') : undefined}
      className={`btn p-0 border-0 d-inline-flex align-items-center emp-toggle${on ? ' is-on' : ''}`}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        border: 'none',
        position: 'relative',
        marginLeft: 4,
        transition: 'background .15s ease',
        opacity: locked ? 0.5 : 1,
        cursor: locked ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        style={{
          width: 14, height: 14,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          position: 'absolute',
          top: 3,
          left: on ? 19 : 3,
          transition: 'left .15s ease',
        }}
      />
    </button>
  );
}
