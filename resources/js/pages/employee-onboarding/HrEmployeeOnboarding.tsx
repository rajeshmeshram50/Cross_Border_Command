import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { MasterSelect, MasterMultiSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';
import ComingSoonShell from '../../components/ComingSoonShell';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import DocGenerateModal from '../hrms/doc-templates/DocGenerateModal';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import { Shimmer } from '../../components/ui/Shimmer';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { AncillaryRolesChip } from '../../components/AncillaryRolesChip';
import { resolveProbation } from '../../utils/probation';
import './HrEmployeeOnboarding.css';

import '../../../css/recruitment.css';

const OPT = (...vals: string[]) => vals.map(v => ({ value: v, label: v }));
const ONB_GENDER       = OPT('Male', 'Female', 'Other');
const ONB_NATIONALITY  = OPT('Indian', 'Other');
const ONB_EMP_STATUS   = OPT('Active', 'On Probation');
const ONB_LEGAL_ENTITY = OPT('Cross Border Command Pvt Ltd', 'CBC International LLP');
const ONB_LOCATION     = OPT('Pune HQ', 'Mumbai', 'Bengaluru');

const ONB_PROBATION    = OPT('Default Probation Policy', '3-Month Probation', '6-Month Probation', 'No Probation');
const ONB_NOTICE       = OPT('Default Notice Period', '15 Days', '30 Days', '60 Days', '90 Days');
const ONB_HOLIDAY      = OPT('Holiday Calendar', 'India Holidays 2026', 'Global Holidays 2026');
const ONB_SHIFT        = OPT('General Shift', 'Morning Shift', 'Evening Shift', 'Night Shift', 'Flexible');
const ONB_WEEKLY_OFF   = OPT('Week Off Policy', 'Saturday & Sunday', 'Sunday Only', 'Rotational');

const ONB_TIME_TRACK   = OPT('Manual', 'Biometric');
const ONB_PENALIZE     = OPT('Tracking Policy', 'Strict Policy', 'Lenient Policy', 'No Penalty');
const ONB_OVERTIME     = OPT('Not applicable', 'Hourly Pay', 'Compensation Off', 'Time and a Half');
const ONB_EXPENSE      = OPT('Standard Expense Policy', 'Manager Approval', 'No Expenses');
const ONB_YES_NO       = OPT('No', 'Yes');
const ONB_ACCESS_CARD  = OPT('Not Issued', 'Issued');

const ONB_PERIOD       = OPT('Per annum', 'Per month', 'Per hour', 'Per day');
const ONB_SAL_STRUCT   = OPT('Range Based', 'Fixed', 'Component Based');
const ONB_TAX_REGIME   = OPT('New Regime (115BAC)', 'Old Regime');
const ONB_ACCOUNT_TYPE = OPT('Salary', 'Savings', 'Current');
const ONB_PF_DEDUCT    = OPT('Employee + Employer', 'Employee only');
const ONB_PF_TYPE      = OPT('Statutory', 'Standard');
const ONB_BLOOD_GROUP  = OPT('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');


type VaultStatus = 'Verified' | 'Uploaded' | 'Pending' | 'Rejected' | 'Signed' | 'Sent' | 'Not Generated';

const VAULT_STATUS_COLOR: Record<VaultStatus, 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'secondary'> = {
  'Verified':      'success',
  'Uploaded':      'info',
  'Pending':       'warning',
  'Rejected':      'danger',
  'Signed':        'primary',
  'Sent':          'info',
  'Not Generated': 'secondary',
};

// ── Types ────────────────────────────────────────────────────────────────────
type OnboardStatus =
  | 'Document Pending'
  | 'In Progress'
  | 'IT Setup'
  | 'Not Started'
  | 'Orientation'
  | 'Completed';

interface OnboardRow {
  id: string;
  empId: string;
  name: string;
  initials: string;
  accent: string;
  photoUrl?: string | null;
  joinDate: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
  ancillaryRoles?: string[];
  managerName: string;
  managerInitials: string;
  managerAccent: string;
  profile: number;          // 0..100
  status: OnboardStatus;
  /** Real wizard progress (0-4) carried through from /api/employees so the
   *  Initiate Onboarding modal can mark Stage 1 (Employee Onboarding Setup)
   *  as Completed once all 4 wizard steps are saved. */
  wizardStep?: number;
  /** DB primary key — used by the Initiate Onboarding modal to PUT
   *  edits back to /api/employees/{id}. */
  dbId?: number;
  /** Raw ApiEmployee row — carries every field the Stage 1 form needs to
   *  pre-fill (work_country_id, gender, dob, addresses, payroll, etc.).
   *  Typed loosely because the modal reads many ad-hoc fields. */
  raw?: any;
}

// ── Helpers — bridge API rows to the OnboardRow shape this page expects ────
const ACCENT_PALETTE = ['#0ab39c','#7c5cfc','#f7b84b','#0ea5e9','#e83e8c','#299cdb','#f06548','#405189','#d63384','#108548'];
const _hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const _accent = (s: string) => ACCENT_PALETTE[_hash(s) % ACCENT_PALETTE.length];
const _initials = (s: string) =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '—';
const _formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** YYYY-MM-DD for today — used as max bound on date pickers that must
 *  refer to past events (previous-employment start/end, etc.). Recomputed
 *  per call rather than memoized so a long-lived modal still resolves to
 *  "right now" when the user opens the picker. */
const _todayIso = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* Today shifted by N years, as YYYY-MM-DD. Module-level so every component
 * (Initiate modal AND the public previous-employment section) can use it for
 * date-picker min/max bounds — a local copy lived only inside the Initiate
 * modal and threw "_shiftYears is not defined" when used elsewhere. */
const _shiftYears = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const EMAIL_INVALID = (v: string | null | undefined): boolean =>
  !!v && v.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const validateOfficialEmail = (raw: string | null | undefined): string => {
  const email = String(raw ?? '').trim();
  if (!email) return 'Official email is required.';
  if (/\s/.test(email)) return 'Email cannot contain spaces.';
  if (email.length > 254) return 'Email is too long (max 254 characters).';
  const at = email.indexOf('@');
  if (at < 0 || at !== email.lastIndexOf('@')) return 'Email must contain exactly one "@" symbol.';
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local)  return 'Add the part before "@" (e.g. firstname.lastname).';
  if (!domain) return 'Add the part after "@" (e.g. company.com).';
  if (local.length > 64) return 'The part before "@" is too long (max 64 characters).';
  if (local.startsWith('.') || local.endsWith('.')) return 'Email cannot start or end with a dot.';
  if (/\.\./.test(email)) return 'Email cannot contain two dots in a row.';
  if (!domain.includes('.')) return 'Domain must include a dot (e.g. company.com).';
  const tld = domain.split('.').pop() || '';
  if (tld.length < 2) return 'Domain ending must be at least 2 characters (e.g. .com, .in).';
  // Final shape check. Restricted to printable ASCII commonly accepted by
  // SMTP gateways; intentionally stricter than RFC 5322 so we don't admit
  // exotic local parts that downstream systems (notifications, SSO) reject.
  const SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!SHAPE.test(email)) return 'Enter a valid email like firstname.lastname@company.com.';
  return '';
};

/** Server-enforced cap for ANY uploaded document. Drives both the
 *  per-doc "max X MB" hint shown in the catalogue and the client-side
 *  guard in triggerUpload() — keeping them sourced from one constant
 *  means a future bump only needs to change this one line. Mirrors
 *  EmployeeDocumentController::MAX_MB on the backend. */
const DOC_MAX_MB = 8;

/** Single source of truth for accepted file types. Mirrors
 *  EmployeeDocumentController::MIME_ALLOWED on the backend.
 *  - DOC_ACCEPT_ATTR drives the native file picker's `accept`, so the
 *    OS dialog itself filters out non-allowed types (no more "Only PDF
 *    / JPG / PNG / WEBP files are allowed" coming back from the server
 *    after the round trip).
 *  - DOC_ACCEPTED_EXTS / DOC_ACCEPTED_MIMES drive the client-side
 *    validator that runs before the upload POST in case the user
 *    bypasses the picker via drag-drop or a renamed file. */
const DOC_ACCEPTED_MIMES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;
const DOC_ACCEPTED_EXTS  = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;
const DOC_ACCEPT_ATTR    = DOC_ACCEPTED_MIMES.join(',');

/**
 * Map the wizard's progress + employee status to one of the existing
 * OnboardStatus pill values. The page already styles all of these — we
 * just route to the right one based on real server state instead of
 * hard-coded mock entries.
 *
 *   wizard_step = 4 + status='Active'         → Completed
 *   wizard_step = 4 + status='Inactive' (etc) → Document Pending  (waiting for admin to activate)
 *   wizard_step = 1-3                          → In Progress
 *   wizard_step = 0                            → Not Started
 */
const _mapOnboardStatus = (raw: any): OnboardStatus => {
  const step  = Number(raw?.wizard_step_completed ?? 0);
  const macro = Number(raw?.onboarding_stage_completed ?? 0);
  const stat  = String(raw?.status ?? '').toLowerCase();
  if (macro >= 6 && stat === 'active') return 'Completed';
  if (macro >= 6) return 'Document Pending';
  if (macro > 0 || step > 0) return 'In Progress';
  return 'Not Started';
};

const apiToOnboardRow = (e: any): OnboardRow => {
  const name = (e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`).trim() || '—';
  const accent = _accent(name);
  /* Manager — prefer the Employee-side relation, fall back to the
   * User-side relation (a login User like a Branch admin assigned as
   * manager but not onboarded as an Employee). */
  const mgr = e.reporting_manager;
  const mgrName = mgr?.display_name
    || (mgr ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ').trim() : '')
    || e.reporting_manager_user?.name
    || '—';
  return {
    id: e.emp_code || `EMP-${e.id}`,
    empId: e.emp_code || `EMP-${e.id}`,
    name,
    initials: _initials(name),
    accent,
    photoUrl: (e as any).photo_url || null,
    joinDate: _formatDate(e.date_of_joining),
    department: e.department?.name || '—',
    designation: e.designation?.name || '—',
    primaryRole: e.primary_role?.name || '—',
    ancillaryRole: e.ancillary_role?.name || '',
    ancillaryRoles: (Array.isArray(e.ancillary_roles_resolved) && e.ancillary_roles_resolved.length > 0)
      ? e.ancillary_roles_resolved.map((r: any) => r.name)
      : (e.ancillary_role?.name ? [e.ancillary_role.name] : []),
    managerName: mgrName,
    managerInitials: _initials(mgrName),
    managerAccent: _accent(mgrName || 'manager'),
    // Profile % = field-based completeness from the server's
    // `profile_completion` accessor — so an employee with real profile data
    // shows a meaningful % even before the onboarding wizard advances (the
    // onboarding STAGE is tracked separately by the Status column). Falls
    // back to the legacy stage-based estimate only if the field is absent.
    profile: ((): number => {
      if (typeof e.profile_completion === 'number') {
        return Math.max(0, Math.min(100, Math.round(e.profile_completion)));
      }
      const step  = Math.max(0, Math.min(4, Number(e.wizard_step_completed ?? 0)));
      const macro = Math.max(0, Math.min(6, Number(e.onboarding_stage_completed ?? 0)));
      const stage1 = macro >= 1 ? 1 : step / 4;
      const others = (macro >= 2 ? 1 : 0) + (macro >= 3 ? 1 : 0)
                   + (macro >= 4 ? 1 : 0) + (macro >= 5 ? 1 : 0)
                   + (macro >= 6 ? 1 : 0);
      return Math.round(((stage1 + others) / 6) * 100);
    })(),
    status: _mapOnboardStatus(e),
    wizardStep: Math.max(0, Math.min(4, Number(e.wizard_step_completed ?? 0))),
    dbId: e.id,
    raw: e,
  };
};

const ONBOARD_STATUS_COLOR: Record<OnboardStatus, 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'secondary'> = {
  'Document Pending': 'warning',
  'In Progress':      'info',
  'IT Setup':         'info',
  'Not Started':      'secondary',
  'Orientation':      'primary',
  'Completed':        'success',
};

// Animated count-up number (mirrors AdminDashboard's AnimatedNumber)
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
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

// Five KPI cards on top — colored top strip + subtle icon tile
const KPI_CARDS = [
  { key: 'total',     label: 'Total Employees',           icon: 'ri-team-line',          tint: '#ece6ff', fg: '#7c5cfc', strip: '#7c5cfc', grad: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
  { key: 'progress',  label: 'Onboarding In Progress',    icon: 'ri-time-line',          tint: '#dceefe', fg: '#0c63b0', strip: '#3b82f6', grad: 'linear-gradient(135deg,#3b82f6,#60a5fa)' },
  { key: 'completed', label: 'Onboarding Completed',      icon: 'ri-checkbox-circle-line', tint: '#d6f4e3', fg: '#108548', strip: '#10b981', grad: 'linear-gradient(135deg,#10b981,#34d399)' },
  { key: 'notStart',  label: 'Onboarding Not Initiated',  icon: 'ri-pause-circle-line',  tint: '#fdf3d6', fg: '#a06f00', strip: '#f59e0b', grad: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
  { key: 'missing',   label: 'Missing Profile Details',   icon: 'ri-error-warning-line', tint: '#fdd9d6', fg: '#b1401d', strip: '#f06548', grad: 'linear-gradient(135deg,#f06548,#f8a08a)' },
] as const;

// ── Checklist data (matches the modal in the second image) ───────────────────
type CheckpointBadgeKind =
  | 'REQUIRED'
  | 'HOD REQUIRED'
  | 'HOD OPTIONAL'
  | 'TL REQUIRED'
  | 'TL OPTIONAL'
  | 'EXEC REQUIRED'
  | 'EXEC OPTIONAL'
  | 'EMP REQUIRED'
  | 'EMP OPTIONAL'
  | 'INTERN REQUIRED'
  | 'INTERN OPTIONAL'
  | 'IT REQUIRED'
  | 'IT OPTIONAL'
  | 'NON-IT REQUIRED'
  | 'NON-IT OPTIONAL'
  | 'OPTIONAL'
  | 'ALL';

const BADGE_TONES: Record<CheckpointBadgeKind, { bg: string; fg: string }> = {
  'REQUIRED':        { bg: '#dceefe', fg: '#0c63b0' },
  'HOD REQUIRED':    { bg: '#ece6ff', fg: '#5a3fd1' },
  'HOD OPTIONAL':    { bg: '#f3edff', fg: '#7c5cfc' },
  'TL REQUIRED':     { bg: '#dff5ee', fg: '#0a716a' },
  'TL OPTIONAL':     { bg: '#e8f6f1', fg: '#0a8a72' },
  'EXEC REQUIRED':   { bg: '#fdd9ea', fg: '#a02960' },
  'EXEC OPTIONAL':   { bg: '#fde6f0', fg: '#c0397a' },
  'EMP REQUIRED':    { bg: '#d6f4e3', fg: '#108548' },
  'EMP OPTIONAL':    { bg: '#e7f7ee', fg: '#1a9c5c' },
  'INTERN REQUIRED': { bg: '#fdf3d6', fg: '#a06f00' },
  'INTERN OPTIONAL': { bg: '#fff5dd', fg: '#bd8400' },
  'IT REQUIRED':     { bg: '#dceefe', fg: '#1d4ed8' },
  'IT OPTIONAL':     { bg: '#e8f0ff', fg: '#3b82f6' },
  'NON-IT REQUIRED': { bg: '#ffe4d4', fg: '#a4661c' },
  'NON-IT OPTIONAL': { bg: '#fff0e2', fg: '#c87837' },
  'OPTIONAL':        { bg: '#eef2f6', fg: '#5b6478' },
  'ALL':             { bg: '#eef2f6', fg: '#5b6478' },
};

interface Checkpoint {
  title: string;
  desc: string;
  badges: CheckpointBadgeKind[];
}
interface ChecklistStage {
  num: number;
  title: string;
  subtitle: string;
  checkpoints: Checkpoint[];
}

const CHECKLIST_STAGES: ChecklistStage[] = [
  {
    num: 1,
    title: 'Employee Onboarding Setup',
    subtitle: 'Basic details, job info, work details & compensation',
    checkpoints: [
      { title: 'Employee basic details verified',        desc: 'First name, last name, display name, employee ID, work country, gender',                 badges: ['REQUIRED', 'ALL'] },
      { title: 'Contact & identity filled',              desc: 'Work email, mobile number, DOB, blood group, number series',                              badges: ['REQUIRED', 'ALL'] },
      { title: 'Job details confirmed',                  desc: 'Joining date, department, designation, primary role, ancillary role, work type',          badges: ['REQUIRED', 'ALL'] },
      { title: 'Organisational details assigned',        desc: 'Legal entity, work location, reporting manager selected',                                 badges: ['REQUIRED', 'ALL'] },
      { title: 'Work & attendance policy set',           desc: 'Leave plan, holiday list, shift, weekly off, time tracking, penalization policy',         badges: ['REQUIRED', 'ALL'] },
      { title: 'Compensation details configured',        desc: 'Salary payment mode, pay group, CTC, tax regime, payroll enabled',                        badges: ['REQUIRED', 'ALL'] },
      { title: 'Asset allocation recorded',              desc: 'Laptop assigned, asset ID, mobile device, other assets',                                  badges: ['OPTIONAL', 'ALL'] },
      { title: 'Internship agreement & offer letter signed', desc: 'Duration, stipend, NDA, and project scope confirmed',                                 badges: ['INTERN REQUIRED'] },
      { title: 'Mentor / supervisor assigned',           desc: 'Dedicated mentor identified, first week schedule shared',                                 badges: ['INTERN REQUIRED'] },
      { title: 'Learning & project plan shared',         desc: 'Goals, milestones, and evaluation criteria documented',                                   badges: ['INTERN OPTIONAL'] },
    ],
  },
  {
    num: 2,
    title: 'Document Management',
    subtitle: 'Identity, education, address & employment documents',
    checkpoints: [
      { title: 'Aadhaar Card uploaded',                          desc: `Front & back, PDF or image, max 2 MB`,                                  badges: ['REQUIRED', 'ALL'] },
      { title: 'PAN Card uploaded',                              desc: `PDF or image, max 2 MB`,                                                badges: ['REQUIRED', 'ALL'] },
      { title: 'Passport-size Photograph uploaded',              desc: `JPG/PNG, max 2 MB, white background preferred`,                         badges: ['REQUIRED', 'ALL'] },
      { title: 'Current & permanent address proof submitted',    desc: 'Utility bill or rent agreement (max 6 months old)',                               badges: ['REQUIRED', 'ALL'] },
      { title: '10th & 12th marksheets uploaded',                desc: 'SSC/HSC board certificates with marksheets',                                      badges: ['REQUIRED', 'ALL'] },
      { title: 'Graduation / Degree certificate uploaded',       desc: 'Official degree or provisional certificate',                                      badges: ['REQUIRED', 'ALL'] },
      { title: 'College ID / enrollment letter uploaded',        desc: 'Current semester enrollment proof from college/university',                       badges: ['INTERN REQUIRED'] },
      { title: 'NOC from college / faculty submitted',           desc: 'If required by institution — No Objection Certificate for internship',            badges: ['INTERN OPTIONAL'] },
    ],
  },
  {
    num: 3,
    title: 'Provisioning & Asset Setup',
    subtitle: 'Email, system access, devices, physical setup',
    checkpoints: [
      { title: 'Official email address created',          desc: 'firstname.lastname@company.com format, verified and active',                             badges: ['REQUIRED', 'ALL'] },
      { title: 'Employee code confirmed',                 desc: 'Unique employee code auto-fetched from number series',                                   badges: ['REQUIRED', 'ALL'] },
      { title: 'Biometric registration completed',        desc: 'Fingerprint/face registration at biometric device on Day 1',                             badges: ['REQUIRED', 'ALL'] },
      { title: 'ID card issued',                          desc: 'Photo ID card printed and handed over to employee',                                      badges: ['REQUIRED', 'ALL'] },
      { title: 'ERP / CRM access configured',             desc: 'SAP/Salesforce/Zoho role-based access granted per department',                           badges: ['NON-IT REQUIRED'] },
      { title: 'Role-specific tools & stationery issued', desc: 'Uniform, visiting cards, SIM card, field/sales kit as applicable',                       badges: ['NON-IT REQUIRED'] },
    ],
  },
  {
    num: 4,
    title: 'Payroll & Finance Setup',
    subtitle: 'Bank details, PAN, PF/ESIC, salary structure',
    checkpoints: [
      { title: 'PAN number verified',                desc: '10-digit PAN confirmed, cross-checked with ID documents',                                     badges: ['REQUIRED', 'ALL'] },
      { title: 'Stipend payment details collected',  desc: 'Bank account / UPI details for stipend transfer. PF/ESIC not applicable',                     badges: ['INTERN REQUIRED'] },
    ],
  },
  {
    num: 5,
    title: 'Policies & Agreements',
    subtitle: 'Document generation, signing & digital acknowledgement',
    checkpoints: [
      { title: 'NDA generated & signed',                  desc: 'Employee → HR Manager → Legal · Must be completed before Day 1',                         badges: ['REQUIRED', 'ALL'] },
      { title: 'Internship agreement signed',             desc: 'Duration, deliverables, stipend, IP ownership, NDA — all parties signed',                badges: ['INTERN REQUIRED'] },
      { title: 'Code of Conduct Policy acknowledged',     desc: 'Employee → HR Manager · Digital acknowledgement',                                        badges: ['REQUIRED', 'ALL'] },
      { title: 'Leave & Attendance Policy acknowledged',  desc: 'Sign-off on leave types, attendance tracking & WFH policy',                              badges: ['REQUIRED', 'ALL'] },
      { title: 'Confidentiality Agreement signed',        desc: 'Employee → HR Manager · Binding throughout employment duration',                         badges: ['REQUIRED', 'ALL'] },
    ],
  },
  {
    num: 6,
    title: 'Final Verification & Activation',
    subtitle: 'HR review, stage validation & employee activation',
    checkpoints: [
      { title: 'All 5 stages verified by HR',  desc: 'Setup, Documents, Provisioning, Payroll, Policies — each confirmed Verified',                       badges: ['REQUIRED', 'ALL'] },
      { title: 'HR final sign-off obtained',   desc: 'Onboarding Coordinator / HR Manager final approval — no pending issues',                            badges: ['REQUIRED', 'ALL'] },
      { title: 'Employee activated in system', desc: 'Status set to Active · Reporting manager notified · Full system access granted',                    badges: ['REQUIRED', 'ALL'] },
    ],
  },
];

// ── Filter option lists ──────────────────────────────────────────────────────
const DEPT_OPTIONS = [
  { value: 'All',          label: 'All' },
  { value: 'Engineering',  label: 'Engineering' },
  { value: 'Finance',      label: 'Finance' },
  { value: 'HR',           label: 'HR' },
  { value: 'Sales',        label: 'Sales' },
  { value: 'Marketing',    label: 'Marketing' },
  { value: 'Design',       label: 'Design' },
  { value: 'Product',      label: 'Product' },
  { value: 'Operations',   label: 'Operations' },
  { value: 'Mobile',       label: 'Mobile' },
  { value: 'Data Science', label: 'Data Science' },
];
const STATUS_OPTIONS_PENDING = [
  { value: 'All',              label: 'All' },
  { value: 'Document Pending', label: 'Document Pending' },
  { value: 'In Progress',      label: 'In Progress' },
  { value: 'IT Setup',         label: 'IT Setup' },
  { value: 'Not Started',      label: 'Not Started' },
  { value: 'Orientation',      label: 'Orientation' },
];

const DESIGNATION_LEVELS = [
  { id: 'all',    label: 'All Levels',         icon: 'ri-global-line' },
  { id: 'hod',    label: 'Head of Dept (HOD)', icon: 'ri-shield-star-line' },
  { id: 'tl',     label: 'Team Leader',        icon: 'ri-team-line' },
  { id: 'exec',   label: 'Executive',          icon: 'ri-flashlight-line' },
  { id: 'emp',    label: 'Employee',           icon: 'ri-user-line' },
  { id: 'intern', label: 'Intern / Trainee',   icon: 'ri-graduation-cap-line' },
] as const;

const EMPLOYEE_TYPES = [
  { id: 'all',    label: 'All',              icon: '' },
  { id: 'it',     label: 'IT Employee',      icon: 'ri-mac-line' },
  { id: 'non_it', label: 'Non-IT Employee',  icon: 'ri-book-2-line' },
] as const;

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HrEmployeeOnboarding() {
  // Redirects to /hr/employees with a hint so the destination page can
  // open the full 4-step wizard for the chosen row.
  const navigate = useNavigate();

  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [checklistOpen, setChecklistOpen] = useState(false);

  // ── Live employee rows (replaces the old PENDING / COMPLETED mocks) ──
  // Fetched once on mount; split into pending vs completed below based on
  // wizard progress + status. Empty array on error so the page still
  // renders (shows zero counts + empty table) instead of crashing.
  const [apiRows, setApiRows] = useState<OnboardRow[]>([]);
  // True until the first /employees response settles — drives the
  // shimmer skeleton on the onboarding table.
  const [loadingRows, setLoadingRows] = useState(true);
  const reloadApiRows = () => {
    api.get('/employees')
      .then(r => {
        // Drop soft-deleted (disabled) employees. The /employees endpoint
        // returns trashed rows by default so the HR Employees "Disabled"
        // tab can render them — but the Onboarding page is strictly a
        // forward-motion surface, so showing a disabled employee here
        // led to the admin clicking "Initiate Onboarding" on an account
        // that can't even sign in. Filter at the boundary so every
        // downstream guard (button visibility, stats, vault counts) is
        // automatically correct.
        //
        // ALSO drop EXITED / INACTIVE employees. Completing an exit flips
        // employees.status to Resigned/Terminated (and disables the login)
        // WITHOUT soft-deleting the row, so a !deleted_at filter alone let
        // exited people reappear in the onboarding queue. An exited employee
        // belongs only in the Disabled tab, never in onboarding.
        const EXCLUDED_STATUSES = ['Resigned', 'Terminated', 'Inactive'];
        const list = (Array.isArray(r.data) ? r.data : [])
          .filter((e: any) => !e?.deleted_at)
          .filter((e: any) => !EXCLUDED_STATUSES.includes(String(e?.status ?? '')));
        setApiRows(list.map(apiToOnboardRow));
      })
      .catch(() => setApiRows([]))
      .finally(() => setLoadingRows(false));
  };
  useEffect(() => { reloadApiRows(); }, []);
  // Split by status pill so the Pending tab keeps showing only employees
  // who still need attention; Completed tab shows fully-onboarded rows.
  const liveSplit = useMemo(() => {
    const pending: OnboardRow[]   = [];
    const completed: OnboardRow[] = [];
    for (const row of apiRows) {
      if (row.status === 'Completed') completed.push(row);
      else pending.push(row);
    }
    return { pending, completed };
  }, [apiRows]);

  // Evidence Vault modal — opened from the Action column on the Completed tab
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultEmp,  setVaultEmp]  = useState<OnboardRow | null>(null);
  const [vaultTab,  setVaultTab]  = useState<'employee' | 'organizational'>('employee');
  const openVault = (row: OnboardRow) => {
    setVaultEmp(row);
    setVaultTab('employee');
    setVaultOpen(true);
  };
  const closeVault = () => { setVaultOpen(false); setVaultEmp(null); };

  // Initiate Onboarding form — multi-stage flow (6 stages, Stage 1 has 4 steps)
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [initiateRow,  setInitiateRow]  = useState<OnboardRow | null>(null);
  const openInitiate = (row: OnboardRow) => { setInitiateRow(row); setInitiateOpen(true); };
  const closeInitiate = () => {
    setInitiateOpen(false);
    setInitiateRow(null);
    // Reconcile the list once on close — stage-to-stage navigation now saves
    // silently (no per-step full reload), so refresh here to pick up the final
    // profile %, status and stage progress.
    reloadApiRows();
  };

  // Edit Employee modal — opened from the Action column pencil button
  const [editOpen, setEditOpen] = useState(false);
  const [editRow,  setEditRow]  = useState<OnboardRow | null>(null);
  // Edit redirects to the HR Employees list with a navigation-state hint
  // so the destination page can pop the full 4-step Add/Edit wizard for
  // the chosen row. `returnTo` carries the path we came from so save/close
  // sends the user straight back here instead of stranding them on the
  // employees list. Falls back to the legacy inline modal only if the
  // row's emp_code is missing (shouldn't happen for live API rows).
  const openEdit  = (row: OnboardRow) => {
    if (row?.empId) {
      navigate('/hr/employees', {
        state: {
          openEditEmpCode: row.empId,
          returnTo: '/hr/employee-onboarding',
        },
      });
      return;
    }
    setEditRow(row);
    setEditOpen(true);
  };
  const closeEdit = () => { setEditOpen(false); setEditRow(null); };

  // Pagination — mirrors the Employee page (rows-per-page dropdown, default 10).
  /* Paging lives in <DataTable> now. */

  // Reset the status filter + search when tabbing across (DataTable resets its
  // own page index whenever the tab or search changes).
  useEffect(() => { setStatusFilter('All'); setQ(''); }, [tab]);

  const counts = useMemo(() => {
    const pendingRows   = liveSplit.pending;
    const completedRows = liveSplit.completed;
    const all = [...pendingRows, ...completedRows];
    return {
      total:     all.length,
      progress:  pendingRows.filter(r => r.status === 'In Progress' || r.status === 'IT Setup' || r.status === 'Orientation' || r.status === 'Document Pending').length,
      completed: completedRows.length,
      notStart:  pendingRows.filter(r => r.status === 'Not Started').length,
      missing:   pendingRows.filter(r => r.profile < 60).length,
      pending:   pendingRows.length,
    };
  }, [liveSplit]);

  const rows = tab === 'pending' ? liveSplit.pending : liveSplit.completed;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(r => deptFilter === 'All' || r.department === deptFilter)
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle)         ||
          r.empId.toLowerCase().includes(needle)        ||
          r.department.toLowerCase().includes(needle)   ||
          r.designation.toLowerCase().includes(needle)  ||
          r.primaryRole.toLowerCase().includes(needle)  ||
          r.managerName.toLowerCase().includes(needle)
        );
      });
  }, [rows, q, deptFilter, statusFilter]);

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     4+18+8+9+10+8+7+11+9+8+8. */
  const columns = useMemo<DataTableColumn<OnboardRow>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      // wrap: the join date sits on a second line under the name.
      meta: { width: '15%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            {r.photoUrl ? (
              <img
                src={r.photoUrl}
                alt={r.name}
                className="rounded-circle flex-shrink-0"
                style={{ width: 34, height: 34, objectFit: 'cover', border: '1px solid rgba(128,128,128,0.2)' }}
              />
            ) : (
              <div
                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                style={{
                  width: 34, height: 34, fontSize: 12,
                  background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                  boxShadow: `0 2px 6px ${r.accent}40`,
                }}
              >
                {r.initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-truncate" style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{r.name}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>{r.joinDate}</div>
            </div>
          </div>
        );
      },
    },
    { header: 'Emp ID', accessorKey: 'empId', meta: { width: '8%' }, cell: info => <span className="onb-id-pill">{String(info.getValue() ?? '')}</span> },
    { header: 'Department',  accessorKey: 'department',  meta: { width: '9%' },  cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Designation', accessorKey: 'designation', meta: { width: '9%' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Primary Role',
      accessorKey: 'primaryRole',
      meta: { width: '8%' },
      cell: info => <span className="onb-role-pill">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Ancillary Role',
      id: 'ancillary',
      enableSorting: false,
      meta: { width: '7%' },
      cell: info => {
        const r = info.row.original;
        return (
          <AncillaryRolesChip
            names={(r.ancillaryRoles && r.ancillaryRoles.length > 0) ? r.ancillaryRoles : (r.ancillaryRole ? [r.ancillaryRole] : [])}
          />
        );
      },
    },
    {
      header: 'Rep. Manager',
      accessorKey: 'managerName',
      meta: { width: '10%' },
      cell: info => {
        const r = info.row.original;
        /* Plain dash when there is no manager — rendering an avatar with a dash
         * inside (the old path) made the row taller than its neighbours and
         * pulled the column out of alignment with the header. */
        if (r.managerName === '—') return <span style={{ fontSize: 13 }} className="text-muted">—</span>;
        return (
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{
                width: 28, height: 28, fontSize: 10.5,
                background: `linear-gradient(135deg, ${r.managerAccent}, ${r.managerAccent}cc)`,
                boxShadow: `0 2px 5px ${r.managerAccent}40`,
              }}
            >
              {r.managerInitials}
            </div>
            <span style={{ fontSize: 13 }} className="text-truncate">{r.managerName}</span>
          </div>
        );
      },
    },
    {
      /* Tier-based profile bar (mirrors HrEmployees): floating circular badge +
         downward triangle pointer over a striped gradient track. `wrap` so the
         floating badge is not clipped by the cell. */
      header: 'Profile %',
      accessorKey: 'profile',
      meta: { width: '9%', wrap: true },
      cell: info => {
        const p = info.row.original.profile;
        const T = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                :           { dark: '#f06548', light: '#fda192' };
        const badgeLeft = Math.max(11, Math.min(89, p));
        return (
          <div style={{ position: 'relative', width: 110, paddingTop: 30 }} title={`Profile ${p}% complete`}>
            <div style={{ position: 'absolute', top: 0, left: `${badgeLeft}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <div
                className="d-flex align-items-center justify-content-center fw-bold"
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${T.dark}, ${T.light})`,
                  color: '#fff', fontSize: 9.5,
                  boxShadow: `0 4px 10px ${T.dark}55`,
                }}
              >
                {p}%
              </div>
              <div
                style={{
                  width: 0, height: 0, margin: '0 auto',
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: `5px solid ${T.dark}`,
                }}
              />
            </div>
            <div style={{ width: '100%', height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${p}%`, height: '100%', borderRadius: 999,
                  background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${T.dark}, ${T.light})`,
                  transition: 'width .25s ease',
                }}
              />
            </div>
          </div>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '8%', align: 'center' },
      cell: info => {
        const statusColor = ONBOARD_STATUS_COLOR[info.row.original.status];
        return (
          <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
            {info.row.original.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: '13%', align: 'center', wrap: true },
      cell: info => {
        const r = info.row.original;
        if (tab === 'completed') {
          return (
            <Tooltip label="View uploaded evidence documents">
              <button type="button" className="onb-vault-btn" aria-label="Evidence Vault" onClick={() => openVault(r)}>
                <i className="ri-shield-check-line" style={{ fontSize: 14 }} />
                Evidence Vault
              </button>
            </Tooltip>
          );
        }
        /* Both buttons are flex-shrink:0 — without it the row's flex box
           squeezed the 30px Edit square into a sliver and pushed the Initiate
           pill past the column edge. The Initiate button runs in its compact
           size here (`is-compact`) so the pair fits the Action column instead
           of overflowing into the page margin. */
        return (
          <div className="d-flex align-items-center justify-content-center gap-2 flex-nowrap">
            <Tooltip label="Edit Employee">
              <button type="button" className="onb-edit-btn flex-shrink-0" aria-label="Edit Employee" onClick={() => openEdit(r)}>
                <i className="ri-pencil-line" style={{ fontSize: 14 }} />
              </button>
            </Tooltip>
            <Tooltip label="Start the onboarding wizard for this employee">
              <button type="button" className="onb-init-btn is-compact flex-shrink-0" aria-label="Initiate Onboarding" onClick={() => openInitiate(r)}>
                <i className="ri-add-line" style={{ fontSize: 13 }} />
                Initiate Onboarding
              </button>
            </Tooltip>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tab]);

  return (
    <>
      <MasterFormStyles />

      <div className="onb-page">

      {/* ── Header strip — same shape as the Clients / Branches headers. ── */}
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-user-add-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">Employee Onboarding Hub</div>
            <div className="frm-cstrip-sub">Track newly joined employees, onboarding progress, and completed onboarding records</div>
          </div>
        </div>
        <Button
          onClick={() => setChecklistOpen(true)}
          className="onb-checklist-cta rounded-pill flex-shrink-0"
        >
          <i className="ri-checkbox-multiple-line me-2" style={{ fontSize: 16 }} />
          Onboarding Checklist
        </Button>
      </div>

      {/* ── KPI cards (own row, each its own card) ── */}
      <Row className="g-3 mb-3 align-items-stretch">
        {KPI_CARDS.map(k => (
          <Col key={k.key} xl={true} md={4} sm={6} xs={12}>
            <div
              className="onb-surface onb-kpi-card"
              style={{
                borderRadius: 14,
                border: '1px solid var(--vz-border-color)',
                // No top border: the accent strip below is positioned at top:0
                // of the padding box, so a 1px top border renders as a white
                // gap above the coloured line.
                borderTopWidth: 0,
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
                    {loadingRows
                      ? <Shimmer height={26} width={64} />
                      : <AnimatedNumber value={(counts as any)[k.key] ?? 0} />}
                  </h3>
                </div>
                <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Shared list table (components/ui/DataTable) — the tabs, search,
          sortable headers, rows-per-page pager and the fill-the-viewport
          sizing all live in the component now. */}
      <DataTable<OnboardRow>
        data={filtered}
        columns={columns}
        serial
        accent="violet"
        minWidth={1500}
        fitToViewport
        autoFitRows
        loading={loadingRows}
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search name, ID, department…"
        tabs={[
          { key: 'pending',   label: 'Onboarding Pending (New Joiners)', icon: 'ri-time-line',            count: counts.pending },
          { key: 'completed', label: 'Onboarding Completed',             icon: 'ri-checkbox-circle-line', count: counts.completed },
        ]}
        activeTab={tab}
        onTabChange={k => setTab(k as typeof tab)}
        emptyMessage={
          <>
            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            No onboarding records match your filters
          </>
        }
      />

      </div>{/* /.onb-page */}

      {/* ── Onboarding Checklist Modal ── */}
      <ChecklistModal isOpen={checklistOpen} onClose={() => setChecklistOpen(false)} />

      {/* ── Evidence Vault Modal ── */}
      <VaultModal
        isOpen={vaultOpen}
        onClose={closeVault}
        emp={vaultEmp}
        tab={vaultTab}
        onTabChange={setVaultTab}
      />

      {/* ── Initiate Onboarding Form ── */}
      <InitiateOnboardingModal
        isOpen={initiateOpen}
        onClose={closeInitiate}
        emp={initiateRow}
        onSaved={() => {
          // Refresh ONLY the employee being edited (was reloading the entire
          // /employees list on every save — the heavy part of the stage-nav
          // lag, BUG-030). Fetch the single row and patch it into both the
          // background list and the open modal's snapshot.
          const dbId = initiateRow?.dbId;
          if (!dbId) return;
          api.get(`/employees/${dbId}`).then(r => {
            const row = apiToOnboardRow(r.data);
            setApiRows(prev => prev.map(x => x.empId === row.empId ? row : x));
            setInitiateRow(prev => (prev && prev.empId === row.empId ? row : prev));
          }).catch(() => { /* keep stale data on error */ });
        }}
      />

      {/* ── Edit Employee Modal ── */}
      <EditEmployeeModal
        isOpen={editOpen}
        onClose={closeEdit}
        emp={editRow}
      />
    </>
  );
}

// ── Edit Employee modal — opens from the pencil icon in the Action column ──
const EDIT_DEPT_OPTIONS = DEPT_OPTIONS.filter(o => o.value !== 'All');
const EDIT_STATUS_OPTIONS = OPT('Active', 'On Probation', 'Inactive');
const EDIT_WORK_TYPE_OPTIONS = OPT('Full Time', 'Part Time', 'Contract', 'Intern');

function EditEmployeeModal({ isOpen, onClose, emp }: { isOpen: boolean; onClose: () => void; emp: OnboardRow | null }) {
  // Local form state — derived from emp on open and reset on close.
  const [firstName, setFirstName]     = useState('');
  const [lastName,  setLastName]      = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workEmail, setWorkEmail]     = useState('');
  const [mobile,    setMobile]        = useState('');
  const [empId,     setEmpId]         = useState('');
  const [status,    setStatus]        = useState('Active');
  const [department, setDepartment]   = useState('');
  const [designation, setDesignation] = useState('');
  const [primaryRole, setPrimaryRole] = useState('');
  const [ancillaryRole, setAncillaryRole] = useState('');
  const [reportingMgr, setReportingMgr]   = useState('');
  const [workType,  setWorkType]      = useState('Full Time');
  const [joinDate,  setJoinDate]      = useState('');

  useEffect(() => {
    if (!emp) return;
    const parts = emp.name.split(' ');
    setFirstName(parts[0] || '');
    setLastName(parts.slice(1).join(' ') || '');
    setDisplayName(emp.name);
    setWorkEmail(`${emp.name.toLowerCase().replace(/\s+/g, '.')}@enterprise.com`);
    setMobile('');
    setEmpId(emp.empId);
    setStatus('Active');
    setDepartment(emp.department);
    setDesignation(emp.designation);
    setPrimaryRole(emp.primaryRole);
    setAncillaryRole(emp.ancillaryRole || '');
    setReportingMgr(emp.managerName);
    setWorkType('Full Time');
    setJoinDate('');
  }, [emp]);

  if (!emp) return null;

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="lg"
      contentClassName="border-0"
      modalClassName="onb-edit-emp-modal"
      scrollable
      backdrop="static"
      keyboard={false}
    >

      <ModalBody className="p-0">
        <div className="onb-ee-header">
          {/* No top-right X — footer has Cancel; one dismiss path. */}
          <div className="d-flex align-items-center gap-3">
            <span className="onb-ee-icon"><i className="ri-user-3-line" style={{ fontSize: 20 }} /></span>
            <div className="min-w-0">
              <h5 className="onb-ee-title">Edit Employee</h5>
              <p className="onb-ee-sub">Update details for {emp.name}</p>
            </div>
          </div>
        </div>

        <div className="onb-ee-body">
          {/* Personal Info */}
          <div className="onb-ee-section">
            <h6 className="onb-ee-section-title"><i className="ri-user-line" /> Personal Information</h6>
            <Row className="g-3">
              <Col md={4}>
                <label className="onb-ee-label">First Name <span className="req">*</span></label>
                <input className="onb-ee-input" value={firstName} onChange={e => setFirstName(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Last Name <span className="req">*</span></label>
                <input className="onb-ee-input" value={lastName} onChange={e => setLastName(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Display Name</label>
                <input className="onb-ee-input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Work Email <span className="req">*</span></label>
                <input className="onb-ee-input" value={workEmail} onChange={e => setWorkEmail(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Mobile Number</label>
                <input className="onb-ee-input" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+91 XXXXX XXXXX" />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Employee ID</label>
                <input className="onb-ee-input is-readonly" value={empId} readOnly />
              </Col>
            </Row>
          </div>

          {/* Job Details */}
          <div className="onb-ee-section">
            <h6 className="onb-ee-section-title"><i className="ri-briefcase-line" /> Job Details</h6>
            <Row className="g-3">
              <Col md={4}>
                <label className="onb-ee-label">Department <span className="req">*</span></label>
                <MasterSelect value={department} onChange={setDepartment} options={EDIT_DEPT_OPTIONS} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Designation <span className="req">*</span></label>
                <input className="onb-ee-input" value={designation} onChange={e => setDesignation(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Employee Status</label>
                <MasterSelect value={status} onChange={setStatus} options={EDIT_STATUS_OPTIONS} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Primary Role</label>
                <input className="onb-ee-input" value={primaryRole} onChange={e => setPrimaryRole(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Ancillary Role</label>
                <input className="onb-ee-input" value={ancillaryRole} onChange={e => setAncillaryRole(e.target.value)} placeholder="Optional" />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Reporting Manager</label>
                <input className="onb-ee-input" value={reportingMgr} onChange={e => setReportingMgr(e.target.value)} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Work Type</label>
                <MasterSelect value={workType} onChange={setWorkType} options={EDIT_WORK_TYPE_OPTIONS} />
              </Col>
              <Col md={4}>
                <label className="onb-ee-label">Joining Date</label>
                <MasterDatePicker value={joinDate} onChange={setJoinDate} placeholder={emp.joinDate || 'Select date'} />
              </Col>
            </Row>
          </div>
        </div>

        <div className="onb-ee-footer">
          <button type="button" className="onb-ee-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="onb-ee-save" onClick={onClose}>
            <i className="ri-save-line" style={{ fontSize: 15 }} /> Save Changes
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Evidence Vault modal ────────────────────────────────────────────────────
// Exported so the HR Employees directory can reuse the exact same vault
// (live employee uploads + matched HR Document Templates with the signing
// workflow) instead of maintaining a second mock copy. The `triggerKeyword`
// prop scopes which document templates the Organizational tab surfaces:
// the Onboarding page passes 'onboarding'; pass null to list every template
// matched to the employee regardless of trigger point.
export function VaultModal({
  isOpen, onClose, emp, tab, onTabChange, triggerKeyword = 'onboarding', signedOnly = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
  tab: 'employee' | 'organizational';
  onTabChange: (t: 'employee' | 'organizational') => void;
  triggerKeyword?: string | null;
  // When true (the standalone Employee Evidence Vault) the Organizational tab
  // becomes a read-only archive of FULLY-SIGNED documents only, exposing just
  // View + Download. When false (Onboarding / Exit workflow pages) it lists
  // every matched template with the full Generate / Send / track workflow.
  signedOnly?: boolean;
}) {
  const { theme: vaultTheme } = useTheme();
  const vaultDark = vaultTheme === 'dark';
  // ── Organizational documents (Document Templates) — pulled from the API.
  // The Document Template Master classifies templates by employee_category
  // (IT / Non-IT / Legal) × role_type (designation level). The Vault's
  // Organizational tab fetches just the templates that match THIS employee.
  type MatchedTemplate = {
    id: number; code: string; name: string; doc_type: string | null;
    status: 'Active' | 'Draft' | 'Deprecated';
    trigger_point?: { id: number; module_name: string } | null;
    /* JSON column on hr_document_templates — already serialized into
     * the /match endpoint response thanks to the `signers => array`
     * cast on the Eloquent model. Each entry holds at least
     * { role_name, designation_name, action, days } as authored in
     * the template builder. Defensive `any` because legacy rows
     * occasionally arrive as the raw JSON string before the cast
     * materialises. */
    signers?: any;
    signing_mode?: 'Sequential' | 'Parallel' | string | null;
  };
  /* Parse the signers column off a template. Mirrors HrExitManagement
   * — the cast normally returns an array, but a stale serializer can
   * leave it as a JSON string. Tolerate both, return [] otherwise. */
  const parseSigners = (raw: any): Array<{ role_name?: string | null; designation_name?: string | null; action?: string | null }> => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  };
  const [orgTemplates, setOrgTemplates] = useState<MatchedTemplate[]>([]);
  const [orgMeta, setOrgMeta] = useState<{ employee_category: string; role_type: string | null; department_name: string | null; designation_name: string | null } | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const toast = useToast();
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;

  useEffect(() => {
    // Only fetch when the modal opens for a specific employee. We refetch on
    // every open so tweaks to the template master are picked up immediately.
    if (!isOpen || !emp?.dbId) { setOrgTemplates([]); setOrgMeta(null); return; }
    let cancelled = false;
    (async () => {
      try {
        setOrgLoading(true);
        // Onboarding-stage page → only fetch templates whose trigger
        // point's name contains "onboarding". Substring keyword match
        // because branch users name their trigger rows freely
        // ("Onboarding point", "Pre-onboarding", etc.) — we can't lock
        // to a single literal title. The Employees directory passes
        // triggerKeyword=null to list every matched template instead.
        const { data } = await api.get('/hr-document-templates/match', {
          params: {
            employee_id: emp.dbId,
            ...(triggerKeyword ? { trigger_keyword: triggerKeyword } : {}),
          },
        });
        if (cancelled) return;
        setOrgTemplates(Array.isArray(data?.templates) ? data.templates : []);
        setOrgMeta({
          employee_category: data?.employee_category ?? 'Non-IT',
          role_type:         data?.role_type ?? null,
          department_name:   data?.department_name ?? null,
          designation_name:  data?.designation_name ?? null,
        });
      } catch {
        if (!cancelled) { setOrgTemplates([]); setOrgMeta(null); }
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId, triggerKeyword]);

  // ── In-modal preview state ────────────────────────────────────────────────
  // Click "View" → fetch resolved HTML + header/footer JSON, render inside
  // the same fixed-height page-style chrome the template editor uses.
  const [previewOpen, setPreviewOpen]   = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTpl, setPreviewTpl]     = useState<MatchedTemplate | null>(null);
  const [previewHtml, setPreviewHtml]   = useState<string>('');
  const [previewHeader, setPreviewHeader] = useState<HeaderConfig>(DEFAULT_HEADER);
  const [previewFooter, setPreviewFooter] = useState<FooterConfig>(DEFAULT_FOOTER);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);

  const handleView = async (tpl: MatchedTemplate) => {
    if (!emp?.dbId) return;
    setPreviewTpl(tpl);
    setPreviewOpen(true);

    // If a signing run already exists for this template, prefer its frozen
    // content_html. For a Completed / In Progress run the signers' actual
    // signatures have been merged into that HTML (each {{SignerNSign}} token
    // is replaced as the signer acts), so View shows the signed copy instead
    // of the raw template with un-substituted {{SignerNSign}} placeholders.
    const run = runByTemplateId.get(tpl.id) || null;
    if (run && run.content_html && (run.status === 'Completed' || run.status === 'In Progress')) {
      setPreviewHtml(run.content_html);
      setPreviewHeader({ ...DEFAULT_HEADER, ...(run.header_config || {}) } as HeaderConfig);
      setPreviewFooter({ ...DEFAULT_FOOTER, ...(run.footer_config || {}) } as FooterConfig);
      // Only flag genuinely unresolved tokens. While a run is In Progress the
      // remaining {{SignerNSign}}/{{SignerNDate}} slots are expected (later
      // signers fill them), so we don't surface those as "unfilled".
      const remaining = Array.from(new Set((run.content_html.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [])
        .map(t => t.replace(/^\{\{\s*|\s*\}\}$/g, ''))));
      const stillMissing = run.status === 'Completed'
        ? remaining
        : remaining.filter(t => !/^Signer\d+(Sign|Date)$/.test(t));
      setPreviewMissing(stillMissing);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    try {
      const { data } = await api.get(`/hr-document-templates/${tpl.id}/preview`, {
        params: { employee_id: emp.dbId },
      });
      setPreviewHtml((data?.content_html as string) || '<p style="color:#9ca3af;font-style:italic;">(empty template)</p>');
      setPreviewHeader({ ...DEFAULT_HEADER, ...(data?.header_config || {}) } as HeaderConfig);
      setPreviewFooter({ ...DEFAULT_FOOTER, ...(data?.footer_config || {}) } as FooterConfig);
      setPreviewMissing(Array.isArray(data?.tokens_missing) ? data.tokens_missing : []);
    } catch (err: any) {
      toast.error('Could not load preview', err?.response?.data?.message || 'Please try again.');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Signature runs (signing workflow runtime) ────────────────────────────
  type SignerState = {
    index: number; role_name: string; action: string; days: number;
    user_id: number | null; name: string;
    status: 'Pending' | 'Done' | 'Rejected' | 'Skipped';
    acted_at: string | null; signed_name: string | null; note: string | null;
  };
  type AuditEvent = { at: string; actor_id: number | null; actor_name: string; action: string; message: string };
  type SignatureRun = {
    id: number; code: string | null; status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
    template_id: number; template?: { id: number; code: string; name: string; doc_type: string | null } | null;
    employee_id: number;
    content_html: string | null;
    header_config: HeaderConfig | null;
    footer_config: FooterConfig | null;
    signers: SignerState[];
    current_index: number;
    audit_log: AuditEvent[];
    created_at: string;
  };

  // Existing runs for this employee — drives the 3-dot menu + audit trail link
  // on each template row. We list runs once on open and re-fetch after any
  // action so badges (e.g. "1 active run") stay in sync.
  const [runs, setRuns] = useState<SignatureRun[]>([]);
  const fetchRuns = async () => {
    if (!emp?.dbId) { setRuns([]); return; }
    try {
      const { data } = await api.get('/hr-document-signatures', { params: { employee_id: emp.dbId } });
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    }
  };
  useEffect(() => {
    if (!isOpen || !emp?.dbId) { setRuns([]); return; }
    fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, emp?.dbId]);

  /* Re-fetch the signing runs when the user returns to this tab/window while
     the vault is open — covers the case where a signer just signed the
     document from their Inbox (a separate view) and comes back here. Without
     this the vault kept showing the stale "Awaiting" state until it was
     closed and reopened. */
  useEffect(() => {
    if (!isOpen || !emp?.dbId) return;
    const refresh = () => { if (document.visibilityState === 'visible') fetchRuns(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, emp?.dbId]);

  // Latest run per template_id — handy to surface a status pill alongside the template.
  const runByTemplateId = useMemo(() => {
    const m = new Map<number, SignatureRun>();
    for (const r of runs) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [runs]);

  // ── Employee Documents — live from /employees/{id}/documents ─────────────
  // The Vault used to render a hardcoded VAULT_EMPLOYEE_DOCS catalogue. Now
  // we pull the actual uploads for THIS employee and group them back into
  // the same Identity / Address / Education / Bank sections by looking each
  // document_key up in STAGE2_CATEGORIES. `prev_<companyId>_<docId>` keys
  // become a Previous Employment section (company_name comes from
  // /previous-employments). Unknown keys fall into "Other Documents" with
  // the file's original_name so nothing the user uploaded ever disappears
  // from the archive.
  type EmpDocApi = {
    id: number;
    document_key: string;
    status: 'pending' | 'uploaded' | 'verified' | 'rejected';
    original_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_at: string | null;
    url: string | null;
  };
  type EmpDocLive = {
    key: string;
    name: string;
    desc: string;
    icon: string;
    tint: string;
    fg: string;
    category: string;
    status: VaultStatus;
    url: string | null;
    docId?: number;
  };
  const [empDocs, setEmpDocs] = useState<EmpDocApi[]>([]);
  const [prevCompanies, setPrevCompanies] = useState<{ id: number; company_name: string }[]>([]);

  useEffect(() => {
    if (!isOpen || !emp?.dbId) { setEmpDocs([]); setPrevCompanies([]); return; }
    let cancelled = false;
    Promise.all([
      api.get(`/employees/${emp.dbId}/documents`).catch(() => ({ data: [] })),
      api.get(`/employees/${emp.dbId}/previous-employments`).catch(() => ({ data: [] })),
    ]).then(([docRes, prevRes]) => {
      if (cancelled) return;
      setEmpDocs(Array.isArray(docRes.data) ? docRes.data : []);
      setPrevCompanies(Array.isArray(prevRes.data) ? prevRes.data : []);
    });
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId]);

  const serverStatusToVault = (s: string): VaultStatus => {
    switch (s) {
      case 'verified': return 'Verified';
      case 'uploaded': return 'Uploaded';
      case 'rejected': return 'Rejected';
      default:         return 'Pending';
    }
  };

  const employeeSections = useMemo(() => {
    if (empDocs.length === 0) return [] as { title: string; docs: EmpDocLive[] }[];
    const byKey = new Map(empDocs.map(d => [d.document_key, d]));
    const used  = new Set<string>();
    const out: { title: string; docs: EmpDocLive[] }[] = [];

    for (const cat of STAGE2_CATEGORIES) {
      const docs: EmpDocLive[] = [];
      for (const d of cat.docs) {
        const u = byKey.get(d.id);
        if (!u) continue;
        used.add(d.id);
        docs.push({
          key: d.id,
          name: d.name,
          desc: u.original_name || d.sub,
          icon: cat.icon,
          tint: cat.tint,
          fg:   cat.fg,
          category: cat.title.replace(/ Documents?$/, '').replace(/ Proof$/, ''),
          status: serverStatusToVault(u.status),
          url: u.url,
          docId: u.id,
        });
      }
      if (docs.length) out.push({ title: cat.title, docs });
    }

    const prevDocs: EmpDocLive[] = [];
    for (const u of empDocs) {
      const m = u.document_key.match(/^prev_(\d+)_(.+)$/);
      if (!m) continue;
      used.add(u.document_key);
      const companyId = Number(m[1]);
      const docId     = m[2];
      const company   = prevCompanies.find(c => c.id === companyId);
      const docDef    = STAGE2_COMPANY_DOCS.find(x => x.id === docId);
      prevDocs.push({
        key: u.document_key,
        name: docDef?.name || u.original_name || u.document_key,
        desc: company ? `${company.company_name}${u.original_name ? ` · ${u.original_name}` : ''}` : (u.original_name || ''),
        icon: 'ri-briefcase-line',
        tint: '#fde8c4',
        fg:   '#a4661c',
        category: 'Employment',
        status: serverStatusToVault(u.status),
        url: u.url,
        docId: u.id,
      });
    }
    if (prevDocs.length) out.push({ title: 'Previous Employment', docs: prevDocs });

    const other: EmpDocLive[] = [];
    for (const u of empDocs) {
      if (used.has(u.document_key)) continue;
      other.push({
        key: u.document_key,
        name: u.original_name || u.document_key,
        desc: u.document_key,
        icon: 'ri-file-line',
        tint: '#eef2f6',
        fg:   '#5b6478',
        category: 'Other',
        status: serverStatusToVault(u.status),
        url: u.url,
        docId: u.id,
      });
    }
    if (other.length) out.push({ title: 'Other Documents', docs: other });

    return out;
  }, [empDocs, prevCompanies]);

  // The Org tab adapts to the caller. In the standalone Employee Evidence Vault
  // (signedOnly) it's a read-only archive of FULLY-SIGNED documents only — a
  // template surfaces once its signing run is Completed, with just View +
  // Download per row. In the Onboarding / Exit workflow pages it lists every
  // matched template so HR can Generate / Send / track in-flight signings.
  const completedTemplates = useMemo(
    () => orgTemplates.filter(t => runByTemplateId.get(t.id)?.status === 'Completed'),
    [orgTemplates, runByTemplateId],
  );
  const completedCount = completedTemplates.length;
  const signedTemplates = signedOnly ? completedTemplates : orgTemplates;

  const allDocs = employeeSections.flatMap(s => s.docs);
  const counts = {
    total:    allDocs.length + signedTemplates.length,
    verified: allDocs.filter(d => d.status === 'Verified').length,
    // Uploaded-but-not-yet-verified docs. They count toward vault completion
    // (the file IS in the vault), even though HR hasn't ticked "Verified" yet.
    uploaded: allDocs.filter(d => d.status === 'Uploaded').length,
    // SIGNED KPI = how many of the matched templates the employee has
    // actually completed signing. Used to read signedTemplates.length,
    // which is now the WHOLE template list, so the tile was about to
    // misrepresent every matched-but-unsigned template as "signed".
    signed:   completedCount,
    // PENDING = only docs that are NOT yet in the vault (still 'Pending'),
    // plus matched org templates that haven't been signed. Uploaded docs are
    // counted under their own KPI now, so an upload moves the doc OUT of
    // Pending and INTO Uploaded instead of sitting in both.
    pending:  allDocs.filter(d => d.status === 'Pending').length
              + (signedTemplates.length - completedCount),
    notGen:   0,
  };
  const empCount = allDocs.length;
  const orgCount = signedTemplates.length;
  // Vault completion = everything that's actually in the vault — uploaded OR
  // verified docs, plus signed org templates — over the total expected. Was
  // (verified + signed) only, so a vault full of uploaded-but-unverified docs
  // wrongly read 0% until HR verified each one.
  const completion = counts.total ? Math.round(((counts.verified + counts.uploaded + counts.signed) / counts.total) * 100) : 0;
  const sections = tab === 'employee' ? employeeSections : [];  // org tab renders from signedTemplates below

  // 3-dot menu state (which row is open)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  // Audit trail modal state
  const [auditRun, setAuditRun] = useState<SignatureRun | null>(null);

  // Action modal state (current signer takes action: Sign / Approve / Acknowledge)
  const [actionRun, setActionRun] = useState<SignatureRun | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionName, setActionName] = useState('');
  const [actionNote, setActionNote] = useState('');

  // Generate modal — custom-field fill → preview → download / send for signature
  const [genTpl, setGenTpl] = useState<MatchedTemplate | null>(null);

  // Send-confirmation modal
  const [sendForTpl, setSendForTpl] = useState<MatchedTemplate | null>(null);
  const [sending, setSending] = useState(false);
  // Synchronous double-submit guard. `sending` state only disables the button
  // on the NEXT render, leaving a tiny window where a fast double-click fires
  // confirmSend twice → two signature runs. The ref flips instantly so the
  // second call bails before the API fires.
  const sendingRef = useRef(false);

  const openSend = (tpl: MatchedTemplate) => { setSendForTpl(tpl); };
  const confirmSend = async () => {
    if (!sendForTpl || !emp?.dbId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: sendForTpl.id,
        employee_id: emp.dbId,
      });
      toast.success('Sent for signing', `${data.code || data.template?.code || 'Document'} entered the workflow.`);
      setSendForTpl(null);
      fetchRuns();
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const openAudit = (run: SignatureRun) => { setAuditRun(run); setOpenMenuId(null); };
  /* Send an in-app reminder (Inbox notification) to the CURRENT pending
   * signer. The doc is already in their Inbox via the polling query —
   * this just pushes a fresh notification to their bell icon so they
   * notice it. No email is sent. Backend throttles to 1 reminder per
   * 6 hours per signer; if HR clicks again too soon the API returns
   * 429 and we surface that in the toast. */
  const sendReminder = async (run: SignatureRun) => {
    const current = run.signers?.[run.current_index];
    const signerName = current?.name || 'the current signer';
    const ok = await confirmDialog({
      title: 'Send Reminder?',
      message: (
        <>
          Nudge <strong>{signerName}</strong> in their Inbox to {current?.action?.toLowerCase() || 'sign'} this document?
          <br />
          <span style={{ opacity: 0.75 }}>Reminders are limited to once every 6 hours per signer.</span>
        </>
      ),
      confirmLabel: 'Send Reminder',
      cancelLabel:  'Cancel',
      tone:         'info',
      icon:         'notification-3-line',
    });
    if (!ok) return;
    try {
      const res = await api.post(`/hr-document-signatures/${run.id}/remind`);
      toast.success('Reminder sent', `${res?.data?.signer || signerName} will see it in their Inbox.`);
      fetchRuns();
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || 'Please try again.';
      if (status === 429) {
        toast.error('Slow down', msg);
      } else {
        toast.error('Could not send reminder', msg);
      }
    }
  };
  const cancelRun = async (run: SignatureRun) => {
    // Close the row's "•••" menu BEFORE the confirm dialog opens, otherwise
    // the menu sits there in the background while the modal is up.
    setOpenMenuId(null);
    const code = run.code || `run #${run.id}`;
    const ok = await confirmDialog({
      title: 'Cancel signing workflow?',
      message: (
        <>
          Cancel the signing workflow for <strong>{code}</strong>?
          <br />
          <span style={{ opacity: 0.75 }}>
            This will halt all pending signatures and cannot be undone.
          </span>
        </>
      ),
      confirmLabel: 'Yes, cancel workflow',
      cancelLabel:  'Keep workflow',
      tone:         'danger',
      icon:         'close-circle-line',
    });
    if (!ok) return;
    try {
      await api.post(`/hr-document-signatures/${run.id}/cancel`);
      toast.success('Cancelled', 'Workflow halted.');
      fetchRuns();
    } catch (err: any) {
      toast.error('Could not cancel', err?.response?.data?.message || 'Please try again.');
    }
  };

  // Take Action — opens the SignActionModal with prefilled signer name when
  // the action type is "Sign" so the signer can confirm or override.
  const openAction = (run: SignatureRun) => {
    const current = run.signers[run.current_index];
    setActionRun(run);
    setActionName(current?.name || '');
    setActionNote('');
  };
  const submitAction = async () => {
    if (!actionRun) return;
    const current = actionRun.signers[actionRun.current_index];
    if (!current) return;
    // Map the wizard's action label to the API enum: "Review & Acknowledge" → "Acknowledge"
    const apiAction = current.action === 'Sign' ? 'Sign'
                     : current.action === 'Approve' ? 'Approve'
                     : 'Acknowledge';
    if (apiAction === 'Sign' && !actionName.trim()) {
      toast.error('Signature required', 'Please type your name to sign.');
      return;
    }
    setActionSubmitting(true);
    try {
      const { data } = await api.post(`/hr-document-signatures/${actionRun.id}/action`, {
        action:      apiAction,
        signed_name: apiAction === 'Sign' ? actionName.trim() : null,
        note:        actionNote.trim() || null,
      });
      toast.success(
        apiAction === 'Sign' ? 'Signed' : apiAction === 'Approve' ? 'Approved' : 'Acknowledged',
        `${data.code || `Run #${data.id}`} updated.`,
      );
      setActionRun(null);
      fetchRuns();
    } catch (err: any) {
      toast.error('Could not record action', err?.response?.data?.message || 'Please try again.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const confirmDialog = useConfirm();
  // Same reject path as the MyTeam page — Note field doubles as the
  // required reason, the controller halts the workflow on the row, and
  // the sender sees the suggestion in the audit trail.
  const submitReject = async () => {
    if (!actionRun) return;
    const reason = actionNote.trim();
    if (!reason) {
      toast.error('Reason required', 'Add a suggestion in the Note field explaining what should change.');
      return;
    }
    // Snapshot the run so we can restore the action modal if the
    // user cancels the confirmation. We hide the action modal while
    // the confirm dialog is open so the user sees only one popup at a
    // time — without this the reject-confirm sits visually on top of
    // the still-open acknowledge modal, which read like "the modal
    // popped back up after I clicked reject."
    const targetRun = actionRun;
    const runId = targetRun.id;
    const code  = targetRun.code || 'this document';
    setActionRun(null);
    const ok = await confirmDialog({
      title: 'Reject Document?',
      message: (
        <>
          Reject <strong>{code}</strong>? The workflow will halt and the sender will see your reason.
        </>
      ),
      confirmLabel: 'Yes, Reject',
      cancelLabel:  'Cancel',
      tone:         'danger',
      icon:         'close-circle-line',
    });
    if (!ok) {
      // User backed out — bring the action modal back so they can
      // edit the reason or take a different action. actionNote /
      // actionName state was untouched and remains pre-filled.
      setActionRun(targetRun);
      return;
    }
    setActionSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${runId}/reject`, { reason });
      toast.success('Rejected', `${code} returned to the sender with your reason.`);
      fetchRuns();
    } catch (err: any) {
      toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
      // On API failure, restore the action modal so the user can retry
      // or adjust their reason — otherwise their input would be lost.
      setActionRun(targetRun);
    } finally {
      setActionSubmitting(false);
    }
  };

  // Click "Generate" → backend resolves {{Tokens}} with this employee's
  // data and streams the filled DOCX back.
  const handleGenerate = async (tpl: MatchedTemplate) => {
    if (!emp?.dbId) return;
    try {
      const resp = await api.get(`/hr-document-templates/${tpl.id}/generate`, {
        params: { employee_id: emp.dbId },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(emp.name || 'employee').replace(/\s+/g, '-')}-${tpl.code || tpl.id}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Document generated', `${tpl.code || tpl.name} downloaded.`);
    } catch (err: any) {
      toast.error('Could not generate', err?.response?.data?.message || 'Please try again.');
    }
  };

  /* Download the fully-signed PDF once a run is Completed (all signers done).
     Hits the same endpoint the Employee Profile "My Signed Documents" tab uses.
     Tracks the in-flight run id so the button can show a spinner + disable
     itself while the (potentially slow) PDF render streams back, and so a
     repeated click can't fire multiple downloads. */
  const [downloadingRunId, setDownloadingRunId] = useState<number | null>(null);
  const downloadSignedDoc = async (run: SignatureRun) => {
    if (downloadingRunId !== null) return; // a download is already in flight
    setDownloadingRunId(run.id);
    try {
      const resp = await api.get(`/hr-document-signatures/${run.id}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.code || `doc-${run.id}`}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Signed PDF saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDownloadingRunId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="lg"
      contentClassName="vault-modal-content border-0"
      modalClassName="vault-modal-wide"
      backdrop="static"
      keyboard={false}
    >

      <ModalBody
        className="p-0 d-flex flex-column"
        // Fixed height (not maxHeight) so the vault is the SAME size for every
        // employee — previously it shrank to a stub for 0 docs and stretched
        // toward full-screen for many, which read as the modal "jumping"
        // small/big between rows. The document list now scrolls inside this
        // consistent frame. Capped to 90vh so it still fits short screens.
        style={{ background: 'var(--vz-card-bg)', height: 'min(90vh, 720px)' }}
      >
        <style>{`
          /* 3-dot row menu (Audit Trail / Cancel Workflow). Inline bg uses the
             card-scoped --vz-card-bg which doesn't resolve inside this portal
             (fell back to #fff → white menu). Force a dark surface + readable
             items in dark mode. */
          [data-bs-theme="dark"] .vault-kebab-menu {
            background: var(--vz-secondary-bg) !important;
            border-color: var(--vz-border-color) !important;
            box-shadow: 0 10px 26px rgba(0,0,0,0.45) !important;
          }
          [data-bs-theme="dark"] .vault-kebab-menu button:hover {
            background: rgba(255,255,255,0.06) !important;
          }
          /* The 3-dot trigger button has the same portal issue — its inline
             --vz-card-bg fell back to white. Pin a dark surface + readable
             icon so it matches the rest of the dark vault. */
          [data-bs-theme="dark"] .vault-kebab-btn {
            background: var(--vz-secondary-bg) !important;
            border-color: var(--vz-border-color) !important;
            color: rgba(255,255,255,0.75) !important;
          }
          [data-bs-theme="dark"] .vault-kebab-btn:hover {
            background: rgba(255,255,255,0.08) !important;
          }
        `}</style>
        {/* Header — indigo gradient with status ring (fixed, non-scrolling) */}
        <div
          style={{
            padding: '22px 26px',
            background: 'linear-gradient(120deg,#5e4dd6 0%,#7c5cfc 60%,#9b7dff 100%)',
            color: '#fff',
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div style={{ position: 'absolute', top: -50, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
          <div className="d-flex align-items-start justify-content-between gap-3" style={{ position: 'relative' }}>
            <div className="d-flex align-items-start gap-3 min-w-0">
              <div
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.22)' }}
              >
                <i className="ri-folder-shield-2-line" style={{ fontSize: 22 }} />
              </div>
              <div className="min-w-0">
                <h5 className="fw-bold mb-1 text-white" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
                  Evidence Vault
                </h5>
                <div className="mb-2" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.88)' }}>
                  Centralized document repository for onboarding, signed organizational, and exit documents
                </div>
                {emp && (
                  <div className="d-flex flex-wrap gap-2">
                    <span className="vault-pill">{emp.empId}</span>
                    <span className="vault-pill">{emp.name}</span>
                    <span className="vault-pill">{emp.department}</span>
                    <span className="vault-pill">{emp.designation}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="d-flex align-items-start gap-3 flex-shrink-0">
              <div className="text-center">
                <div
                  style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: `conic-gradient(#10b981 ${completion * 3.6}deg, rgba(255,255,255,0.20) 0)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <div
                    className="d-flex align-items-center justify-content-center fw-bold"
                    style={{ width: 50, height: 50, borderRadius: '50%', background: '#5b3fd1', color: '#fff', fontSize: 14 }}
                  >
                    {completion}%
                  </div>
                </div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>
                  VAULT STATUS
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>
                  {completion}% Complete
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="btn p-0 d-inline-flex align-items-center justify-content-center vault-close-btn"
                style={{ width: 32, height: 32, borderRadius: 10, border: 'none', color: '#fff' }}
              >
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>
        </div>

        {/* Body — Organizational Documents tab is now backed by the
            HR Document Templates API (matched per department × designation
            level), so the vault is fully interactive. */}
        <div style={{ padding: '16px 24px 22px', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
            {/* KPI strip */}
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--vz-border-color)' }}>
              <Row className="g-3 align-items-stretch">
                {[
                  { key: 'total',    label: 'Total Docs',    value: counts.total,    icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
                  { key: 'uploaded', label: 'Uploaded',      value: counts.uploaded, icon: 'ri-upload-cloud-2-line',  gradient: 'linear-gradient(135deg,#3b82f6,#60a5fa)' },
                  { key: 'signed',   label: 'Signed',        value: counts.signed,   icon: 'ri-quill-pen-line',       gradient: 'linear-gradient(135deg,#5e4dd6,#9b7dff)' },
                  { key: 'pending',  label: 'Pending',       value: counts.pending,  icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
                  // 'Verified' and 'Not Generated' KPI cards removed per bug 38.
                ].map(k => (
                  <Col key={k.key} xl md={4} sm={6} xs={12}>
                    <div className="vault-kpi-card">
                      <div className="vault-kpi-strip" style={{ background: k.gradient }} />
                      <div className="d-flex align-items-start justify-content-between">
                        <div className="min-w-0">
                          <p className="vault-kpi-label">{k.label}</p>
                          <h3 className="vault-kpi-num">{k.value.toLocaleString()}</h3>
                        </div>
                        <div className="vault-kpi-icon" style={{ background: k.gradient }}>
                          <i className={k.icon} />
                        </div>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>

            {/* Tabs */}
            <div className="d-flex" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <button
                type="button"
                className={`vault-tab-btn${tab === 'employee' ? ' is-active' : ''}`}
                onClick={() => onTabChange('employee')}
              >
                <i className="ri-user-line" /> Employee Documents
                <span className="vault-tab-count">{empCount}</span>
              </button>
              <button
                type="button"
                className={`vault-tab-btn${tab === 'organizational' ? ' is-active' : ''}`}
                onClick={() => onTabChange('organizational')}
              >
                <i className="ri-building-line" /> Organizational Documents
                <span className="vault-tab-count">{orgCount}</span>
              </button>
            </div>

            {/* Section list */}
            <div>
              {/* Employee tab — empty state so the fixed-height vault doesn't
                  show a blank body when the employee has no uploads yet
                  (mirrors the Organizational tab's empty state). */}
              {tab === 'employee' && sections.length === 0 && (
                <div className="vault-org-empty" style={{ padding: 22, textAlign: 'center', borderRadius: 10, marginTop: 16 }}>
                  <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>
                    No employee documents uploaded yet. Documents added during
                    onboarding will appear here automatically.
                  </div>
                </div>
              )}
              {/* Employee tab — static doc catalogue (Identity / Address / Education / Employment) */}
              {tab === 'employee' && sections.map(section => (
                <div key={section.title} style={{ paddingTop: 16 }}>
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div>
                      <div className="fw-bold" style={{ fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                        {section.title}
                      </div>
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        {section.docs.length} document{section.docs.length === 1 ? '' : 's'} in this category
                      </div>
                    </div>
                    <span
                      className="vault-doc-count d-inline-flex align-items-center"
                      style={{ padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}
                    >
                      {section.docs.length} docs
                    </span>
                  </div>
                  <div>
                    {section.docs.map(doc => {
                      const statusColor = VAULT_STATUS_COLOR[doc.status];
                      const hasFile = !!doc.url;
                      return (
                        <div key={doc.key} className="vault-doc-row flex-wrap">
                          <div className="vault-doc-icon" style={{ background: doc.tint, color: doc.fg }}>
                            <i className={doc.icon} />
                          </div>
                          <div className="vault-doc-meta">
                            <div className="vault-doc-name">{doc.name}</div>
                            <div className="vault-doc-desc">{doc.desc}</div>
                          </div>
                          {doc.category && (
                            <span
                              className="d-inline-flex align-items-center vault-cat-badge"
                              style={{ padding: '4px 10px', borderRadius: 999, background: '#eef2f6', color: '#475569', fontSize: 11, fontWeight: 600 }}
                            >
                              {doc.category}
                            </span>
                          )}
                          <span className={`badge rounded-pill vault-status-badge bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
                            {doc.status}
                          </span>
                          <a
                            href={hasFile ? doc.url! : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="vault-action-view"
                            style={{ opacity: hasFile ? 1 : 0.5, pointerEvents: hasFile ? 'auto' : 'none', textDecoration: 'none' }}
                            title={hasFile ? 'Open in a new tab' : 'No file available'}
                          >
                            <i className="ri-eye-line" /> View
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Organizational tab — pulled from HR Document Templates,
                  filtered by (department → category) × (designation.level → role_type). */}
              {tab === 'organizational' && (
                <div style={{ paddingTop: 16 }}>
                  {/* Match context banner — surfaces WHY each template is here */}
                  {orgMeta && (
                    <div className="vault-match-strip d-flex align-items-center gap-2 flex-wrap mb-3">
                      <i className="ri-magic-line vault-match-icon" />
                      <strong className="vault-match-title" style={{ fontSize: 12.5 }}>Matched Templates</strong>
                      <span className="vault-match-text" style={{ fontSize: 12 }}>
                        Department <strong>{orgMeta.department_name || '—'}</strong> → Category{' '}
                        <span className="vault-match-chip">{orgMeta.employee_category}</span>
                        {orgMeta.role_type && (
                          <>{' '}· Level{' '}<span className="vault-match-chip">{orgMeta.role_type}</span></>
                        )}
                      </span>
                    </div>
                  )}

                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div>
                      {/* Title + sub-copy adapt to the caller: a signed-only
                          archive in the Employee Evidence Vault, or the full
                          matched-template list on the workflow pages. */}
                      <div className="fw-bold" style={{ fontSize: 14 }}>{signedOnly ? 'Signed Documents' : 'Company Documents'}</div>
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        {orgLoading ? (signedOnly ? 'Loading signed documents…' : 'Loading matching templates…')
                          : signedTemplates.length === 0 ? (signedOnly ? 'No signed documents yet.' : 'No templates matched this employee’s department / category.')
                          : signedOnly ? `${signedTemplates.length} signed document${signedTemplates.length === 1 ? '' : 's'}`
                          : `${signedTemplates.length} template${signedTemplates.length === 1 ? '' : 's'} · ${completedCount} signed`}
                      </div>
                    </div>
                    <span className="vault-doc-count d-inline-flex align-items-center"
                      style={{ padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
                      {signedTemplates.length} docs
                    </span>
                  </div>

                  {orgLoading && (
                    <div className="vault-org-loading" style={{ padding: 18, textAlign: 'center', fontSize: 12.5 }}>
                      <i className="ri-loader-4-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
                      Looking up matching templates…
                    </div>
                  )}

                  {!orgLoading && signedTemplates.length === 0 && (
                    <div className="vault-org-empty" style={{ padding: 22, textAlign: 'center', borderRadius: 10 }}>
                      <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                      <div style={{ fontSize: 13 }}>
                        {signedOnly ? (
                          <>No fully-signed documents yet. A document appears here once
                          its signing workflow is <strong>Completed</strong>. Send a
                          template for signing from <strong>HR &rsaquo; Document Templates</strong>
                          and it will surface here automatically.</>
                        ) : (
                          <>No HR Document Templates matched this employee’s
                          <strong> Department / Category </strong> rule. Configure
                          templates under <strong>HR &rsaquo; Document Templates</strong>
                          and they will surface here automatically.</>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    {signedTemplates.map(tpl => {
                      const tplStatusColor: 'primary' | 'warning' | 'secondary' =
                        tpl.status === 'Active' ? 'primary'
                        : tpl.status === 'Draft' ? 'warning'
                        : 'secondary';
                      const canGenerate = tpl.status === 'Active' && !!emp?.dbId;
                      const run = runByTemplateId.get(tpl.id) || null;
                      const currentSigner = run?.signers?.[run.current_index] || null;
                      const isMyTurn = !!(run && currentSigner
                        && (run.status === 'Pending' || run.status === 'In Progress')
                        && currentSigner.user_id === currentUserId);
                      const runStatusColor: 'success' | 'danger' | 'secondary' | 'warning' | 'info' | null =
                        run?.status === 'Completed' ? 'success'
                        : run?.status === 'Rejected' ? 'danger'
                        : run?.status === 'Cancelled' ? 'secondary'
                        : run?.status === 'In Progress' ? 'warning'
                        : run ? 'info'
                        : null;
                      // Configured signers for this template (from the
                      // template builder JSON). Used as the preview when
                      // no run exists yet so HR sees who *will* sign;
                      // when a run exists we render run.signers below
                      // so the live per-step status comes through.
                      const tplSigners = parseSigners(tpl.signers);
                      return (
                        <div key={tpl.id} className="vault-tpl-card">
                        <div className="vault-doc-row flex-wrap" style={{ position: 'relative' }}>
                          <div className="vault-doc-icon" style={{ background: '#eef2ff', color: '#4338ca' }}>
                            <i className="ri-file-text-line" />
                          </div>
                          <div className="vault-doc-meta">
                            <div className="vault-doc-name">
                              {tpl.name || '(unnamed template)'}{' '}
                              <span className="vault-doc-code">{tpl.code}</span>
                              {run && runStatusColor && (
                                <span className={`badge rounded-pill bg-${runStatusColor}-subtle text-${runStatusColor} fw-semibold ms-2`} style={{ fontSize: 11, padding: '3px 9px' }}>
                                  <i className="ri-flow-chart" style={{ fontSize: 11, marginRight: 3 }} />{run.status}
                                </span>
                              )}
                            </div>
                            <div className="vault-doc-desc">
                              {tpl.doc_type || 'Document'}{tpl.trigger_point?.module_name ? ` · Trigger: ${tpl.trigger_point.module_name}` : ''}
                              {run && currentSigner && (run.status === 'Pending' || run.status === 'In Progress') && (
                                <> · Waiting on <strong>{currentSigner.name}</strong> ({currentSigner.action})</>
                              )}
                            </div>
                          </div>
                          <span className={`badge rounded-pill bg-${tplStatusColor}-subtle text-${tplStatusColor} fw-semibold px-3 py-2 fs-13`}>
                            {tpl.status}
                          </span>
                          {/* View — workflow pages hide it once a run is Completed
                              (Download takes over); the signed-only Employee
                              Evidence Vault always shows it (opens the signed copy). */}
                          {(signedOnly || run?.status !== 'Completed') && (
                            <button type="button" className="vault-action-view" onClick={() => handleView(tpl)}
                              data-tooltip={signedOnly ? 'View the signed document' : "Preview with this employee's data"} data-tooltip-pos="bottom" aria-label="View document">
                              <i className="ri-eye-line" /> View
                            </button>
                          )}
                          {/* If the current user is the next signer, surface
                              their action button inline so they don't have to
                              hunt for it. */}
                          {isMyTurn && run && (
                            <button type="button"
                              onClick={() => openAction(run)}
                              data-tooltip={`Your turn — ${currentSigner!.action} this document`} data-tooltip-pos="bottom" aria-label={currentSigner!.action}
                              style={{ padding: '6px 12px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', color: '#fff', border: 0, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              <i className="ri-quill-pen-line me-1" />{currentSigner!.action}
                            </button>
                          )}
                          {/* Generate — fill the template's custom fields, preview
                              with this employee's data, then download the DOCX or
                              push it into the signing workflow. Same conditions as
                              Send (hidden while a run is in flight / completed). */}
                          {(!run || run.status === 'Rejected' || run.status === 'Cancelled') && (
                            <button type="button" onClick={() => { if (canGenerate) setGenTpl(tpl); }}
                              disabled={!canGenerate}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: canGenerate ? 'pointer' : 'not-allowed', opacity: canGenerate ? 1 : 0.5 }}
                              data-tooltip={canGenerate ? 'Fill custom fields, preview & generate / send for signing' : 'Only Active templates can be generated'} data-tooltip-pos="bottom" aria-label="Generate document">
                              <i className="ri-file-add-line me-1" /> Generate
                            </button>
                          )}
                          {/* Send for signing — only when there's no active run
                              (or a previous run was Rejected/Cancelled). While a
                              run is in flight it's hidden (can't re-send); once
                              Completed the row shows only Download instead. */}
                          {(!run || run.status === 'Rejected' || run.status === 'Cancelled') && (
                            <button type="button" onClick={() => { if (canGenerate) openSend(tpl); }}
                              disabled={!canGenerate}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: canGenerate ? 'pointer' : 'not-allowed', opacity: canGenerate ? 1 : 0.5 }}
                              data-tooltip={canGenerate ? 'Send through the signing workflow' : 'Only Active templates can be sent'} data-tooltip-pos="bottom" aria-label="Send for signing">
                              <i className="ri-send-plane-line me-1" /> Send
                            </button>
                          )}
                          {/* Reminder — visible only on in-flight runs.
                              Pings the CURRENT pending signer by email.
                              Backend throttles to 1 reminder / 6 hours
                              per signer so accidental double-clicks
                              don't spam. */}
                          {run && (run.status === 'Pending' || run.status === 'In Progress') && (
                            <button type="button" onClick={() => sendReminder(run)}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                              data-tooltip="Email a reminder to the current pending signer" data-tooltip-pos="bottom" aria-label="Send reminder">
                              <i className="ri-mail-send-line me-1" /> Reminder
                            </button>
                          )}
                          {/* Download signed PDF — icon-only (compact) so the
                              action row stays uncluttered. Shown only once the
                              run is fully signed. */}
                          {run && run.status === 'Completed' && (() => {
                            const isDownloading = downloadingRunId === run.id;
                            return (
                              <button type="button" onClick={() => downloadSignedDoc(run)}
                                disabled={isDownloading}
                                aria-label="Download signed document"
                                style={{ padding: '6px 14px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: isDownloading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: isDownloading ? 0.7 : 1 }}
                                data-tooltip={isDownloading ? 'Preparing the signed PDF…' : 'Download the fully-signed document'} data-tooltip-pos="bottom">
                                {isDownloading
                                  ? <><span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" /> Downloading…</>
                                  : <><i className="ri-download-2-line" /> Download</>}
                              </button>
                            );
                          })()}

                          {/* 3-dot menu (audit trail + cancel). Hidden in the
                              signed-only Employee Evidence Vault, which exposes
                              just View + Download. */}
                          {!signedOnly && (
                          <div style={{ position: 'relative' }}>
                            <button type="button" className="vault-kebab-btn" onClick={() => setOpenMenuId(openMenuId === tpl.id ? null : tpl.id)}
                              data-tooltip="More actions" data-tooltip-pos="left" aria-label="More actions"
                              style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-card-bg, #fff)', color: 'var(--vz-secondary-color, #6b7280)', cursor: 'pointer' }}>
                              <i className="ri-more-2-fill" />
                            </button>
                            {openMenuId === tpl.id && (
                              <div className="vault-kebab-menu" style={{ position: 'absolute', right: 0, top: '110%', minWidth: 180, background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.18)', padding: 4, zIndex: 20 }}>
                                {run ? (
                                  <button type="button" onClick={() => openAudit(run)}
                                    style={menuItemStyle}>
                                    <i className="ri-history-line me-2" />Audit Trail
                                  </button>
                                ) : (
                                  <div style={{ ...menuItemStyle, color: '#9ca3af', cursor: 'default' }}>
                                    <i className="ri-history-line me-2" />No signing run yet
                                  </div>
                                )}
                                {run && (run.status === 'Pending' || run.status === 'In Progress') && (
                                  <button type="button" onClick={() => cancelRun(run)}
                                    style={{ ...menuItemStyle, color: '#b91c1c' }}>
                                    <i className="ri-close-circle-line me-2" />Cancel Workflow
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          )}
                        </div>

                        {/* Signing Workflow stepper — renders the same
                            numbered "Reporting Manager → Employee → …"
                            pipeline that Exit Management shows under each
                            template. When a live run exists we pull each
                            step's name + per-step status from run.signers
                            (so a Pending / Awaiting / Completed / Rejected
                            badge appears against the right step). When no
                            run has been launched yet we preview the
                            template's configured signers so HR can see who
                            *will* sign before clicking Send. Same .ep-
                            signing/.ep-signer classes Exit Management uses
                            — recruitment.css is now imported at the top of
                            this file so they resolve. */}
                        {(tplSigners.length > 0 || run) && (
                          <div className="ep-signing">
                            <div className="ep-signing-head">
                              <i className="ri-shield-check-line" />Signing Workflow
                              {run ? (
                                <span className="ep-signing-pct">
                                  {run.signers.filter((s: any) => s.status === 'Done').length}/{run.signers.length} signed
                                </span>
                              ) : (
                                <span className="ep-signing-pct">Not yet sent</span>
                              )}
                            </div>
                            <div className="ep-signing-flow">
                              {(run
                                ? run.signers.map((s: any, i: number) => ({
                                    name:   s.name || s.role_name || `Signer ${i + 1}`,
                                    action: s.action,
                                    status: s.status === 'Done' ? 'Completed'
                                          : s.status === 'Rejected' ? 'Rejected'
                                          // Run fully signed → every remaining step reads Completed
                                          // (fixes the last signer staying on "Awaiting" after the
                                          // final signature flips the run to Completed).
                                          : run.status === 'Completed' ? 'Completed'
                                          // Parallel mode → EVERY unsigned signer can act now, so all
                                          // read "Awaiting" (not just current_index).
                                          : (String((run as any).template?.signing_mode || '').toLowerCase() === 'parallel' || i === run.current_index) ? 'Awaiting' : 'Pending',
                                    active: (String((run as any).template?.signing_mode || '').toLowerCase() === 'parallel'
                                              ? (s.status !== 'Done' && s.status !== 'Rejected')
                                              : i === run.current_index)
                                            && (run.status === 'Pending' || run.status === 'In Progress'),
                                  }))
                                : tplSigners.map((s, i) => ({
                                    name:   s.role_name || s.designation_name || `Signer ${i + 1}`,
                                    action: s.action,
                                    status: 'Pending' as string,
                                    active: i === 0,
                                  }))
                              ).map((sg, i) => (
                                <div key={i} className={`ep-signer${sg.active ? ' is-active' : ''}`}>
                                  <span className="ep-signer-dot">{i + 1}</span>
                                  <span className="ep-signer-name">
                                    {sg.name}
                                    {sg.action && (
                                      <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                                        ({sg.action})
                                      </span>
                                    )}
                                  </span>
                                  <span className="ep-signer-state">{sg.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
        </div>
      </ModalBody>

      {/* Generate Document — custom-field fill → preview → download / send for signature */}
      <DocGenerateModal
        isOpen={!!genTpl}
        onClose={() => setGenTpl(null)}
        templateId={genTpl?.id ?? null}
        templateName={genTpl?.name}
        templateCode={genTpl?.code}
        employeeId={emp?.dbId ?? null}
        employeeName={emp?.name}
        onSent={fetchRuns}
      />

      {/* Document preview — opens on top of the vault modal */}
      <Modal isOpen={previewOpen} toggle={() => setPreviewOpen(false)} size="lg" centered
        contentClassName="border-0" modalClassName="vault-preview-modal" backdrop="static">
        <style>{`
          /* Dark-mode chrome for the View preview modal. --vz-card-bg is
             card-scoped and doesn't resolve inside this portal (it fell back to
             #fff, leaving the footer white); root-level --vz-secondary-bg /
             --vz-border-color / --vz-body-color resolve everywhere, so we use
             those plus explicit amber for the "unfilled placeholders" band. */
          [data-bs-theme="dark"] .vault-preview-modal .modal-content {
            background: var(--vz-secondary-bg) !important;
            color: var(--vz-body-color);
          }
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-foot {
            background: var(--vz-secondary-bg) !important;
            border-top-color: var(--vz-border-color) !important;
            box-shadow: 0 -3px 10px rgba(0,0,0,0.25);
          }
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-btn--ghost {
            background: var(--vz-card-bg, #1f2937) !important;
            border-color: var(--vz-border-color) !important;
            color: var(--vz-body-color) !important;
          }
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn {
            background: rgba(245,158,11,0.15) !important;
            border-color: rgba(245,158,11,0.40) !important;
          }
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn,
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn strong,
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn i,
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn div {
            color: #fcd34d !important;
          }
          [data-bs-theme="dark"] .vault-preview-modal .tpl-prev-warn code {
            background: rgba(0,0,0,0.30) !important;
            color: #fde68a !important;
          }
        `}</style>
        <ModalBody className="p-0">
          {/* Preview header bar */}
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)', borderRadius: '6px 6px 0 0' }}>
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-2 min-w-0">
                <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ri-file-search-line" style={{ fontSize: 18, color: '#fff' }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>
                    {previewTpl?.name || 'Document Preview'}
                  </h5>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                    {emp?.name ? `Filled with ${emp.name}'s data` : 'Live preview'}
                    {previewTpl?.code ? ` · ${previewTpl.code}` : ''}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close"
                className="tpl-prev-x"
                style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div style={{ padding: 16, background: 'var(--vz-secondary-bg, #f9fafb)', maxHeight: '70vh', overflowY: 'auto' }}>
            {previewLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                <i className="ri-loader-4-line" style={{ fontSize: 26, display: 'block', marginBottom: 8 }} />
                Resolving placeholders…
              </div>
            ) : (
              <>
                {previewMissing.length > 0 && (
                  <div className="d-flex align-items-start gap-2 mb-3 tpl-prev-warn"
                    style={{ padding: '8px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12 }}>
                    <i className="ri-error-warning-line" style={{ color: '#b45309', fontSize: 16, marginTop: 1 }} />
                    <div style={{ color: '#92400e' }}>
                      <strong>Unfilled placeholders:</strong>{' '}
                      {previewMissing.map(t => (
                        <code key={t} style={{ background: '#fff', color: '#7c2d12', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{`{{${t}}}`}</code>
                      ))}
                    </div>
                  </div>
                )}
                <HeaderFooterPanel
                  header={previewHeader} setHeader={() => {}}
                  footer={previewFooter} setFooter={() => {}}
                  readOnly
                >
                  <div className="tpl-readonly-preview"
                    style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                    // The server resolveTokens htmlspecialchars-escapes every
                    // substituted value, so the only HTML reaching this sink
                    // is whatever the admin saved in the template editor.
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </HeaderFooterPanel>
              </>
            )}
          </div>

          <div className="tpl-prev-foot" style={{ padding: 12, borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-card-bg, #fff)', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 6px 6px' }}>
            <button type="button" onClick={() => setPreviewOpen(false)}
              className="tpl-prev-btn tpl-prev-btn--ghost"
              style={{ padding: '7px 14px', background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color, #d1d5db)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--vz-body-color, #374151)', cursor: 'pointer' }}>
              Close
            </button>
            {previewTpl && previewTpl.status === 'Active' && (
              <button type="button" onClick={() => { handleGenerate(previewTpl); }}
                className="tpl-prev-btn tpl-prev-btn--download"
                style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#16a34a,#22c55e)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                <i className="ri-download-2-line me-1" /> Download DOCX
              </button>
            )}
          </div>
        </ModalBody>
      </Modal>

      {/* Send-for-signing confirmation */}
      <Modal isOpen={!!sendForTpl} toggle={() => setSendForTpl(null)} size="md" centered contentClassName="border-0" modalClassName="send-sign-modal" backdrop="static">
        <style>{`
          .send-sign-modal .modal-dialog { max-width: 600px; }
          .send-sign-modal .modal-content { border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.30); }
          /* Body surface — the inline var(--vz-card-bg) falls back to white
             inside the portalled modal, so dark mode showed a white body.
             Pin explicit surfaces (a stylesheet !important beats the inline
             var). Text + footer border re-pinned for the dark surface too. */
          .send-sign-modal .modal-body { background: #ffffff !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body { background: #1c2531 !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(2) { color: #ced4da !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(2) strong { color: #f3f4f6 !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(3) { border-top-color: rgba(255,255,255,0.10) !important; }
          .send-sign-modal .ss-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
          [data-bs-theme="dark"] .send-sign-modal .ss-warn { background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.42); color: #fcd34d; }
          .send-sign-modal .ss-cancel { background: var(--vz-secondary-bg, #fff); color: var(--vz-body-color, #374151); border: 1px solid var(--vz-border-color, #d1d5db); transition: filter .15s ease; }
          .send-sign-modal .ss-cancel:hover { filter: brightness(0.97); }
          [data-bs-theme="dark"] .send-sign-modal .ss-cancel:hover { filter: brightness(1.25); }
          .send-sign-modal .ss-send { transition: filter .15s ease, transform .15s ease; }
          .send-sign-modal .ss-send:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
          .send-sign-modal .ssw-step { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; }
          .send-sign-modal .ssw-step-num { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: #4338ca; color: #fff; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 700; flex-shrink: 0; }
          .send-sign-modal .ssw-step-role { font-size: 12px; font-weight: 700; color: #4338ca; line-height: 1.15; }
          .send-sign-modal .ssw-step-action { font-size: 10px; font-weight: 500; color: #6366f1; }
          .send-sign-modal .ssw-arrow { color: #9ca3af; font-size: 16px; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.40); }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-num { background: #6366f1; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-role { color: #c4b5fd; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-action { color: #a5b4fc; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-arrow { color: #6b7280; }
        `}</style>
        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg, #fff)' }}>
          <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg,#5a3fd1 0%,#7c3aed 55%,#a855f7 100%)', color: '#fff' }}>
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                <i className="ri-send-plane-fill" />
              </span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>Send for Signing</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Confirm the signing workflow before sending</div>
              </div>
            </div>
          </div>
          <div style={{ padding: 18, fontSize: 13, color: 'var(--vz-body-color)' }}>
            <p style={{ marginBottom: 14 }}>
              Send <strong>{sendForTpl?.name}</strong> for <strong>{emp?.name}</strong>? The document will follow this signing workflow:
            </p>
            <SendWorkflowPreview templateId={sendForTpl?.id ?? null} />
            <div className="ss-warn d-flex align-items-start gap-2" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, fontSize: 11.5 }}>
              <i className="ri-information-line" style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Placeholders will be locked at send-time using this employee's data.</span>
            </div>
          </div>
          <div style={{ padding: '14px 18px', borderTop: '1px solid var(--vz-border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setSendForTpl(null)} disabled={sending}
              className="ss-cancel" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={confirmSend} disabled={sending}
              className="ss-send" style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.8 : 1, boxShadow: '0 4px 14px rgba(124,58,237,0.40)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i className={sending ? 'ri-loader-4-line ri-spin' : 'ri-send-plane-fill'} />{sending ? 'Sending…' : 'Send Document'}
            </button>
          </div>
        </ModalBody>
      </Modal>

      {/* Audit trail modal */}
      <Modal isOpen={!!auditRun} toggle={() => setAuditRun(null)} size="lg" centered contentClassName="border-0" modalClassName="audit-trail-modal" backdrop="static">
        <style>{`
          /* Dark-mode for the Audit Trail / Signature Timeline modal — the
             body + most text are hardcoded light. Darken the surfaces and lift
             every text node; the colored status pills (span) keep their own
             tints, which read fine on the dark body. */
          [data-bs-theme="dark"] .audit-trail-modal .modal-content,
          [data-bs-theme="dark"] .audit-trail-modal .audit-body {
            background: var(--vz-secondary-bg) !important;
          }
          [data-bs-theme="dark"] .audit-trail-modal .audit-body div {
            color: #e5e7eb !important;
          }
          [data-bs-theme="dark"] .audit-trail-modal .audit-body code {
            background: rgba(255,255,255,0.08) !important;
            color: #cbd5e1 !important;
          }
          [data-bs-theme="dark"] .audit-trail-modal .audit-note {
            background: rgba(239,68,68,0.12) !important;
            border-color: rgba(239,68,68,0.40) !important;
          }
        `}</style>
        <ModalBody className="p-0">
          {auditRun && (() => {
            const signers = auditRun.signers || [];
            const totalSteps = signers.length;
            const doneSteps  = signers.filter(s => s.status === 'Done').length;
            const progressPct = totalSteps > 0 ? (doneSteps / totalSteps) * 100 : 0;
            return (
              <>
                {/* ── Header — violet gradient with icon + workflow code +
                      title on the LEFT, circular percentage progress on the
                      RIGHT (matches the "VAULT STATUS" doughnut pattern used
                      on the Evidence Vault header). ── */}
                <div style={{
                  position: 'relative',
                  padding: '20px 22px',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)',
                  color: '#fff',
                  borderRadius: '8px 8px 0 0',
                }}>
                  {/* Close button — absolute top right so it's always reachable */}
                  <button
                    type="button"
                    onClick={() => setAuditRun(null)}
                    aria-label="Close"
                    style={{
                      position: 'absolute',
                      top: 12, right: 12,
                      background: 'rgba(255,255,255,0.18)',
                      border: 0, color: '#fff',
                      borderRadius: 10,
                      width: 32, height: 32,
                      cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 16 }} />
                  </button>

                  <div className="d-flex align-items-center" style={{ gap: 16, paddingRight: 48 }}>
                    {/* Glass icon */}
                    <div style={{
                      width: 48, height: 48,
                      background: 'rgba(255,255,255,0.18)',
                      borderRadius: 12,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      backdropFilter: 'blur(8px)',
                    }}>
                      <i className="ri-history-line" style={{ fontSize: 22 }} />
                    </div>

                    {/* Title block */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700,
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                        opacity: 0.78,
                        marginBottom: 2,
                      }}>
                        {auditRun.code || `Run #${auditRun.id}`} · Signature Workflow
                      </div>
                      <div style={{
                        fontSize: 18, fontWeight: 800,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.2,
                      }}>
                        {auditRun.template?.name || 'Document Timeline'}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3 }}>
                        Status · <strong>{auditRun.status}</strong> · {doneSteps} / {totalSteps} signed
                      </div>
                    </div>

                    {/* Circular percentage progress — SVG donut chart.
                        circumference = 2π × r (r=26) ≈ 163.36. dashoffset is
                        the *unfilled* length, so (1 - pct/100) * circumference
                        leaves the filled arc visible. */}
                    {(() => {
                      const r = 26;
                      const C = 2 * Math.PI * r;
                      const offset = C - (progressPct / 100) * C;
                      return (
                        <div style={{
                          position: 'relative',
                          width: 64, height: 64,
                          flexShrink: 0,
                        }}>
                          <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                            {/* Track */}
                            <circle
                              cx="32" cy="32" r={r}
                              fill="none"
                              stroke="rgba(255,255,255,0.20)"
                              strokeWidth="6"
                            />
                            {/* Progress arc */}
                            <circle
                              cx="32" cy="32" r={r}
                              fill="none"
                              stroke="#ffffff"
                              strokeWidth="6"
                              strokeLinecap="round"
                              strokeDasharray={C}
                              strokeDashoffset={offset}
                              style={{ transition: 'stroke-dashoffset .6s ease-out' }}
                            />
                          </svg>
                          {/* Centered percentage label */}
                          <div style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fff',
                            letterSpacing: '-0.02em',
                          }}>
                            {Math.round(progressPct)}%
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Vertical timeline ── */}
                <div className="audit-body" style={{ padding: '16px 22px 18px', maxHeight: '55vh', overflowY: 'auto', background: '#fff' }}>
                  <div style={{
                    fontSize: 11, fontWeight: 800,
                    color: '#6b7280', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 14,
                  }}>
                    Signature Timeline
                  </div>

                  {signers.length === 0 && (
                    <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                      No signers configured for this workflow.
                    </div>
                  )}

                  {signers.map((s, i) => {
                    const done = s.status === 'Done';
                    const rejected = s.status === 'Rejected';
                    const isCurrent = i === auditRun.current_index
                      && (auditRun.status === 'Pending' || auditRun.status === 'In Progress');
                    const isLast = i === signers.length - 1;

                    // Color tokens per state. The circular dot keeps its vivid
                    // fill in both themes; the status pill gets a translucent
                    // dark variant so it isn't a light pastel block in dark mode.
                    const tone = rejected
                      ? { bg: '#fee2e2', border: '#fca5a5', icon: '#dc2626', pill: vaultDark ? '#fca5a5' : '#dc2626', pillBg: vaultDark ? 'rgba(239,68,68,0.18)' : '#fee2e2', pillBorder: vaultDark ? 'rgba(239,68,68,0.40)' : '#fca5a5', label: 'Rejected', iconClass: 'ri-close-line' }
                      : done
                      ? { bg: '#10b981', border: '#10b981', icon: '#fff',    pill: vaultDark ? '#6ee7b7' : '#10b981', pillBg: vaultDark ? 'rgba(16,185,129,0.18)' : '#d1fae5', pillBorder: vaultDark ? 'rgba(16,185,129,0.40)' : '#a7f3d0', label: 'Done',     iconClass: 'ri-check-line' }
                      : isCurrent
                      ? { bg: '#7c3aed', border: '#7c3aed', icon: '#fff',    pill: vaultDark ? '#c4b5fd' : '#7c3aed', pillBg: vaultDark ? 'rgba(124,58,237,0.20)' : '#ede9fe', pillBorder: vaultDark ? 'rgba(124,58,237,0.45)' : '#c4b5fd', label: 'Pending you', iconClass: 'ri-time-line' }
                      : { bg: vaultDark ? 'rgba(255,255,255,0.07)' : '#f3f4f6', border: vaultDark ? 'rgba(255,255,255,0.20)' : '#d1d5db', icon: vaultDark ? 'rgba(255,255,255,0.55)' : '#9ca3af', pill: vaultDark ? '#9ca3af' : '#6b7280', pillBg: vaultDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', pillBorder: vaultDark ? 'rgba(255,255,255,0.16)' : '#e5e7eb', label: 'Waiting',  iconClass: 'ri-time-line' };

                    return (
                      <div key={i} style={{ position: 'relative', display: 'flex', gap: 16, paddingBottom: isLast ? 0 : 20 }}>
                        {/* Vertical connector line behind the dot */}
                        {!isLast && (
                          <span style={{
                            position: 'absolute',
                            left: 17,
                            top: 36,
                            bottom: 0,
                            width: 2,
                            background: done ? '#10b981' : (vaultDark ? 'rgba(255,255,255,0.14)' : '#e5e7eb'),
                            borderRadius: 1,
                          }} />
                        )}

                        {/* Circular state icon */}
                        <div style={{
                          width: 36, height: 36,
                          borderRadius: '50%',
                          background: tone.bg,
                          border: `2px solid ${tone.border}`,
                          color: tone.icon,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16,
                          flexShrink: 0,
                          position: 'relative',
                          zIndex: 1,
                          boxShadow: done || isCurrent ? `0 4px 12px ${tone.bg}40` : 'none',
                        }}>
                          <i className={tone.iconClass} />
                        </div>

                        {/* Row content */}
                        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                          <div className="d-flex justify-content-between align-items-start" style={{ gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>
                                {s.name}
                              </div>
                              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                {s.action} · Step {i + 1} of {signers.length}
                              </div>
                              {s.acted_at && (
                                <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 4 }}>
                                  <i className="ri-calendar-line" style={{ marginRight: 4 }} />
                                  {new Date(s.acted_at).toLocaleString()}
                                </div>
                              )}
                              {s.note && (
                                <div className="audit-note" style={{
                                  fontSize: 11.5, color: '#7f1d1d',
                                  background: '#fef2f2',
                                  border: '1px solid #fecaca',
                                  borderRadius: 6,
                                  padding: '6px 10px',
                                  marginTop: 6,
                                }}>
                                  <strong>Note:</strong> {s.note}
                                </div>
                              )}
                            </div>
                            {/* Status pill */}
                            <span style={{
                              display: 'inline-flex', alignItems: 'center',
                              gap: 4,
                              padding: '4px 10px',
                              fontSize: 11, fontWeight: 700,
                              color: tone.pill,
                              background: tone.pillBg,
                              border: `1px solid ${tone.pillBorder}`,
                              borderRadius: 999,
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }}>
                              {tone.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Event log (collapsible-feel section) ── */}
                  {(auditRun.audit_log && auditRun.audit_log.length > 0) && (
                    <>
                      <div style={{
                        marginTop: 24, paddingTop: 16,
                        borderTop: `1px solid ${vaultDark ? 'rgba(255,255,255,0.10)' : '#f3f4f6'}`,
                        fontSize: 11, fontWeight: 800,
                        color: '#6b7280', letterSpacing: '0.08em',
                        textTransform: 'uppercase', marginBottom: 12,
                      }}>
                        Activity Log
                      </div>
                      <div style={{ borderLeft: `2px solid ${vaultDark ? 'rgba(124,92,252,0.40)' : '#ede9fe'}`, paddingLeft: 14, marginLeft: 8 }}>
                        {auditRun.audit_log.slice().reverse().map((ev, i) => (
                          <div key={i} style={{ position: 'relative', marginBottom: 10 }}>
                            <span style={{
                              position: 'absolute',
                              // Centre the 10px dot (+2px ring) on the 2px guide
                              // line: line centre sits 15px left of the content
                              // edge, so the content-box left = -20.
                              left: -20, top: 4,
                              width: 10, height: 10,
                              borderRadius: '50%',
                              background: '#7c3aed',
                              // Ring matches the panel background so the dot reads
                              // as sitting on the line (white ring glared on dark).
                              border: `2px solid ${vaultDark ? 'var(--vz-secondary-bg, #1c2531)' : '#fff'}`,
                              boxShadow: `0 0 0 2px ${vaultDark ? 'rgba(124,92,252,0.35)' : '#ede9fe'}`,
                            }} />
                            <div style={{ fontSize: 12.5, color: '#1f2937', fontWeight: 600 }}>
                              {ev.message}
                            </div>
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                              {new Date(ev.at).toLocaleString()} · {ev.actor_name}
                              <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, marginLeft: 6 }}>
                                {ev.action}
                              </code>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </ModalBody>
      </Modal>

      {/* Sign / Approve / Acknowledge modal */}
      <Modal isOpen={!!actionRun} toggle={() => setActionRun(null)} size="lg" centered contentClassName="border-0" backdrop="static">
        <ModalBody className="p-0">
          {actionRun && (() => {
            const current = actionRun.signers[actionRun.current_index];
            const isSign = current?.action === 'Sign';
            return (
              <>
                <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', color: '#fff', borderRadius: '6px 6px 0 0' }}>
                  {/* No top-right X — footer has Cancel; one dismiss path. */}
                  <strong style={{ fontSize: 15 }}><i className="ri-quill-pen-line me-2" />{current?.action}</strong>
                  <div style={{ fontSize: 11.5, opacity: 0.85 }}>{actionRun.template?.name} · {actionRun.code}</div>
                </div>
                <div style={{ padding: 16, maxHeight: '65vh', overflowY: 'auto', background: 'var(--vz-secondary-bg, #f9fafb)' }}>
                  {/* Render the locked document for context */}
                  <HeaderFooterPanel
                    header={{ ...DEFAULT_HEADER, ...(actionRun.header_config || {}) } as HeaderConfig}
                    setHeader={() => {}}
                    footer={{ ...DEFAULT_FOOTER, ...(actionRun.footer_config || {}) } as FooterConfig}
                    setFooter={() => {}}
                    readOnly
                  >
                    <div className="tpl-readonly-preview"
                      style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 220 }}
                      dangerouslySetInnerHTML={{ __html: actionRun.content_html || '<p>(empty)</p>' }}
                    />
                  </HeaderFooterPanel>

                  {/* Action inputs */}
                  <div style={{ marginTop: 14, padding: 14, background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 10 }}>
                    {isSign && (
                      <>
                        <label style={{ fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                          Type your name to sign <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input type="text" value={actionName} onChange={e => setActionName(e.target.value)}
                          placeholder="Your full name"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }} />
                        {actionName && (
                          <div style={{ marginTop: 8, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 11.5, color: '#6b7280' }}>
                            Preview: <span style={{ fontFamily: '"Brush Script MT", cursive', fontSize: 22, color: '#1d4ed8', marginLeft: 6 }}>{actionName}</span>
                            <div style={{ fontSize: 10.5, marginTop: 4 }}>
                              This will replace every <code>{`{{Signer${(actionRun.current_index ?? 0) + 1}Sign}}`}</code> placeholder in the document.
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <label style={{ fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4, marginTop: isSign ? 12 : 0 }}>
                      Note / Reason for rejection
                    </label>
                    <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
                      placeholder="Optional for approval — REQUIRED if you reject. Describe what should change."
                      rows={3} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      Rejection halts the workflow and returns the document to the sender with your suggestion.
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12, borderTop: '1px solid var(--vz-border-color, #e5e7eb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'var(--vz-card-bg, #fff)', flexWrap: 'wrap' }}>
                  {/* Reject — sits on the left, separated from the positive
                      action. Enabled only once a reason has been entered. */}
                  <button type="button" onClick={submitReject}
                    disabled={actionSubmitting || !actionNote.trim()}
                    title={actionNote.trim() ? 'Reject with this reason' : 'Add a reason in the Note field first'}
                    style={{ padding: '7px 14px', background: actionNote.trim() ? 'linear-gradient(135deg,#dc2626,#ef4444)' : '#fee2e2', color: actionNote.trim() ? '#fff' : '#b91c1c', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: actionNote.trim() ? 'pointer' : 'not-allowed', opacity: actionNote.trim() ? 1 : 0.7 }}>
                    <i className="ri-close-circle-line me-1" />Reject &amp; Send Back
                  </button>
                  <div className="d-flex gap-2">
                    <button type="button" onClick={() => setActionRun(null)} disabled={actionSubmitting}
                      style={{ padding: '7px 14px', background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color, #d1d5db)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--vz-body-color, #374151)', cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button type="button" onClick={submitAction} disabled={actionSubmitting || (isSign && !actionName.trim())}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                      <i className={isSign ? 'ri-quill-pen-line' : current?.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
                      {actionSubmitting ? 'Submitting…' : `Confirm ${current?.action}`}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </ModalBody>
      </Modal>
    </Modal>
  );
}

// Small helper — renders a compact preview of the template's configured
// signing workflow inside the Send confirmation modal. Pulls signers from
// the template row so the user sees the exact chain before they hit Send.
function SendWorkflowPreview({ templateId }: { templateId: number | null }) {
  const [signers, setSigners] = useState<Array<{ role_name?: string | null; action?: string }>>([]);
  useEffect(() => {
    if (!templateId) { setSigners([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/hr-document-templates/${templateId}`);
        if (!cancelled) setSigners(Array.isArray(data?.signers) ? data.signers : []);
      } catch { if (!cancelled) setSigners([]); }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  if (signers.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--vz-secondary-color)', fontStyle: 'italic' }}>No signers configured on this template.</div>;
  }
  return (
    <div className="d-flex flex-wrap align-items-center" style={{ gap: 8 }}>
      {signers.map((s, i) => (
        <div key={i} className="d-flex align-items-center" style={{ gap: 8 }}>
          <div className="ssw-step">
            <span className="ssw-step-num">{i + 1}</span>
            <div>
              <div className="ssw-step-role">{s.role_name || 'Unassigned'}</div>
              <div className="ssw-step-action">{s.action || 'Sign'}</div>
            </div>
          </div>
          {i < signers.length - 1 && <i className="ri-arrow-right-line ssw-arrow" />}
        </div>
      ))}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 12px', border: 0, background: 'transparent', borderRadius: 6,
  // Theme-adaptive so the dropdown text reads on both the light and the dark
  // (var(--vz-card-bg)) popover surface.
  fontSize: 13, color: 'var(--vz-body-color, #374151)', cursor: 'pointer',
};

// ── Checklist modal ──────────────────────────────────────────────────────────
function ChecklistModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [level, setLevel] = useState<string>('all');
  const [empType, setEmpType] = useState<string>('all');

  // Compute filtered checklist by level + employee type. ALL-tagged checkpoints
  // always pass; otherwise both filters must match. Counts in the header reflect
  // the visible set so users see exactly what their filters returned.
  const visibleStages = useMemo(() => {
    const levelMap: Record<string, CheckpointBadgeKind[]> = {
      hod:    ['HOD REQUIRED', 'HOD OPTIONAL'],
      tl:     ['TL REQUIRED', 'TL OPTIONAL'],
      exec:   ['EXEC REQUIRED', 'EXEC OPTIONAL'],
      emp:    ['EMP REQUIRED', 'EMP OPTIONAL'],
      intern: ['INTERN REQUIRED', 'INTERN OPTIONAL'],
    };
    const empMap: Record<string, CheckpointBadgeKind[]> = {
      it:       ['IT REQUIRED', 'IT OPTIONAL'],
      'non-it': ['NON-IT REQUIRED', 'NON-IT OPTIONAL'],
    };
    return CHECKLIST_STAGES.map(s => {
      const checkpoints = s.checkpoints.filter(cp => {
        const isAll = cp.badges.includes('ALL');
        const levelOk = level === 'all'   || isAll || (levelMap[level]   || []).some(b => cp.badges.includes(b));
        const empOk   = empType === 'all' || isAll || (empMap[empType]   || []).some(b => cp.badges.includes(b));
        return levelOk && empOk;
      });
      return { ...s, checkpoints };
    }).filter(s => s.checkpoints.length > 0);
  }, [level, empType]);

  const totalCheckpoints = useMemo(
    () => visibleStages.reduce((acc, s) => acc + s.checkpoints.length, 0),
    [visibleStages],
  );

  const levelLabel = DESIGNATION_LEVELS.find(l => l.id === level)?.label ?? 'All Levels';
  const typeLabel  = EMPLOYEE_TYPES.find(t => t.id === empType)?.label ?? 'All';

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="xl"
      contentClassName="onb-checklist-content border-0"
      modalClassName="onb-checklist-modal"
      backdrop="static"
      keyboard={false}
    >
      {/* No `scrollable` on the Modal: it would turn .modal-body into a second
          scroll container on top of .onb-cl-body. The body is the only scroller. */}
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header */}
        <div className="onb-checklist-header">
          <div className="onb-cl-titlewrap">
            <span className="onb-cl-icon">
              <i className="ri-checkbox-line" style={{ fontSize: 22 }} />
            </span>
            <div className="min-w-0">
              <h5 className="onb-cl-title">Employee Onboarding Checklist</h5>
              <div className="onb-cl-sub">
                {CHECKLIST_STAGES.length} stages · {CHECKLIST_STAGES.reduce((a, s) => a + s.checkpoints.length, 0)} checkpoints · Filtered by Designation &amp; Employee Type
              </div>
            </div>
          </div>

          <div className="onb-cl-filters">
            <p className="onb-cl-filter-label">Designation Level</p>
            <div className="onb-cl-pillrow">
              {DESIGNATION_LEVELS.map(l => (
                <button
                  key={l.id}
                  type="button"
                  className={`onb-cl-pill ${level === l.id ? 'is-active' : ''}`}
                  onClick={() => setLevel(l.id)}
                >
                  <i className={l.icon} />
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="onb-cl-row">
            <span className="onb-cl-filter-label">Employee Type:</span>
            <div className="onb-cl-typebox">
              {EMPLOYEE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={`onb-cl-type ${empType === t.id ? 'is-active' : ''}`}
                  onClick={() => setEmpType(t.id)}
                >
                  {t.icon ? <i className={t.icon} /> : null}
                  {t.label}
                </button>
              ))}
            </div>
            <span className="onb-cl-summary">
              {levelLabel} · {typeLabel === 'All' ? 'All Types' : `${typeLabel}s`}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="onb-cl-body">
          {visibleStages.map(s => (
            <div key={s.num} className="onb-stage">
              <div className="onb-stage-head">
                <span className="onb-stage-icon">
                  <i className="ri-user-line" style={{ fontSize: 14 }} />
                </span>
                <div className="min-w-0">
                  <p className="onb-stage-title">Stage {s.num} — {s.title}</p>
                  <p className="onb-stage-sub">{s.subtitle}</p>
                </div>
                <span className="onb-stage-count">{s.checkpoints.length} checkpoints</span>
              </div>
              {s.checkpoints.map((cp, i) => (
                <div key={i} className="onb-cp">
                  <span className="onb-cp-check">
                    <i className="ri-checkbox-circle-line" style={{ fontSize: 16 }} />
                  </span>
                  <div className="min-w-0 flex-grow-1">
                    <div className="onb-cp-title">
                      <span className="t">{cp.title}</span>
                      {cp.badges.map((b, bi) => {
                        const tone = BADGE_TONES[b];
                        return (
                          <span
                            key={bi}
                            className="onb-cp-badge"
                            style={{ background: tone.bg, color: tone.fg, ['--pill-fg' as string]: tone.fg } as React.CSSProperties}
                          >
                            {b}
                          </span>
                        );
                      })}
                    </div>
                    <div className="onb-cp-desc">{cp.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="onb-cl-footer">
          <span className="hint">{levelLabel} · {typeLabel} · {totalCheckpoints} checkpoints visible</span>
          <button type="button" className="onb-cl-close" onClick={onClose}>Close</button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Initiate Onboarding form modal ──────────────────────────────────────────
// 6 stages — the 1st two are fully laid out (Setup with 4 sub-steps,
// Documents with file-upload sections); the rest are placeholders.
type StageStatus = 'Completed' | 'In Progress' | 'Pending';
const ONB_STAGES: { num: number; key: string; label: string; stage: string; sub: string; icon: string; status: StageStatus; progress: number }[] = [
  { num: 1, key: 'setup',     label: 'Setup',     stage: 'Employee Onboarding Setup',      sub: 'Profile verification & required details',  icon: 'ri-user-line',         status: 'Completed',  progress: 100 },
  { num: 2, key: 'docs',      label: 'Docs',      stage: 'Document Management',            sub: 'Identity, education & employment documents', icon: 'ri-file-list-3-line', status: 'In Progress', progress: 35  },
  { num: 3, key: 'provision', label: 'Provision', stage: 'Provisioning & Asset Setup',     sub: 'Hardware, IT access, and security provisioning', icon: 'ri-computer-line',  status: 'Pending',     progress: 0   },
  { num: 4, key: 'payroll',   label: 'Payroll',   stage: 'Payroll & Finance Setup',        sub: 'Bank, tax, and statutory enrolments',       icon: 'ri-bank-card-line',     status: 'Pending',     progress: 0   },
  { num: 5, key: 'policies',  label: 'Policies',  stage: 'Policies & Agreements',          sub: 'NDA, code of conduct, and policy acknowledgements', icon: 'ri-shield-check-line', status: 'Pending', progress: 0 },
  { num: 6, key: 'verify',    label: 'Verify',    stage: 'Final Verification & Activation',sub: 'Final review and activation of employee record', icon: 'ri-checkbox-circle-line', status: 'Pending', progress: 0 },
];

// ── Stage 2 — Document catalogue (matches the screenshots) ──────────────────
// Per-doc size standards (in MB) — capped at DOC_MAX_MB (the absolute
// ceiling the backend will accept). Lower numbers mirror what govt /
// HR portals typically allow, which is also what employees expect:
//   - Photos:           2 MB
//   - ID / address:     5 MB
//   - Certificates:     5 MB
//   - General PDFs:     DOC_MAX_MB (8 MB)
// The label rendered next to each row is derived from `maxMb`, so the
// hint and the validator can never drift.
type DocStatus = 'Pending' | 'Uploaded' | 'Verified' | 'Rejected' | 'Optional';
interface ChecklistDoc {
  id: string;
  name: string;
  sub: string;
  status: DocStatus;
  /** Per-doc size cap. Defaults to DOC_MAX_MB if omitted. */
  maxMb?: number;
}
interface DocCategory { id: string; title: string; icon: string; tint: string; fg: string; docs: ChecklistDoc[] }

const STAGE2_CATEGORIES: DocCategory[] = [
  {
    id: 'identity', title: 'Identity Documents', icon: 'ri-profile-line', tint: '#ece6ff', fg: '#5a3fd1',
    docs: [
      { id: 'aadhaar',    name: 'Aadhaar Card (Front & Back)', sub: 'PDF or Image · max 2 MB', maxMb: 2, status: 'Pending' },
      { id: 'pan',        name: 'PAN Card',                    sub: 'PDF or Image · max 2 MB', maxMb: 2, status: 'Pending' },
      { id: 'photo',      name: 'Passport-size Photograph',    sub: 'JPG / PNG · max 2 MB',    maxMb: 2, status: 'Pending' },
    ],
  },
  {
    id: 'address', title: 'Address Proof', icon: 'ri-map-pin-line', tint: '#dceefe', fg: '#0c63b0',
    docs: [
      { id: 'cur_addr',  name: 'Current Address Proof',   sub: 'Utility Bill / Rent Agreement — max 6 months old · 2 MB', maxMb: 2, status: 'Pending' },
      { id: 'perm_addr', name: 'Permanent Address Proof', sub: 'Govt-issued address proof · max 2 MB',                    maxMb: 2, status: 'Pending' },
    ],
  },
  {
    id: 'education', title: 'Education Documents', icon: 'ri-graduation-cap-line', tint: '#d3f0ee', fg: '#0a716a',
    docs: [
      { id: 'ssc',  name: '10th Marksheet (SSC / Matriculation)', sub: 'Board certificate + mark sheet · max 2 MB',         maxMb: 2, status: 'Pending'  },
      { id: 'hsc',  name: '12th Marksheet (HSC / Intermediate)',  sub: 'Board certificate + mark sheet · max 2 MB',         maxMb: 2, status: 'Pending'  },
      { id: 'grad', name: 'Graduation Certificate / Degree',      sub: 'Official degree or provisional certificate · 2 MB', maxMb: 2, status: 'Pending'  },
      { id: 'pg',   name: 'Post-graduation Certificate',          sub: 'If applicable · max 2 MB',                          maxMb: 2, status: 'Optional' },
    ],
  },
  {
    id: 'bank', title: 'Bank Details', icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548',
    docs: [
      { id: 'cheque', name: 'Cancelled Cheque', sub: 'Cancelled cheque leaf with account number & IFSC clearly visible · max 2 MB', maxMb: 2, status: 'Pending' },
    ],
  },
];

interface PrevCompany {
  id: string;
  name: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  hrEmail1: string;
  hrEmail2: string;
  contactNumber: string;
}

const makePrevCompany = (): PrevCompany => ({
  id: `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  jobTitle: '',
  startDate: '',
  endDate: '',
  hrEmail1: '',
  hrEmail2: '',
  contactNumber: '',
});

const STAGE2_COMPANY_DOCS: { id: string; name: string; status: DocStatus; maxMb?: number }[] = [
  { id: 'exp_letter',   name: 'Experience Letter',          status: 'Pending',  maxMb: 5 },
  { id: 'rel_letter',   name: 'Relieving Letter',           status: 'Pending',  maxMb: 5 },
  { id: 'salary_slips', name: 'Last 3 Months Salary Slips', status: 'Pending',  maxMb: 8 },
  { id: 'offer_letter', name: 'Previous Offer Letter',      status: 'Optional', maxMb: 5 },
];

// Document status colours now live as .onb-doc-status-pill--<status> CSS
// classes (theme-aware, no leading dot) in HrEmployeeOnboarding.css.

function InitiateOnboardingModal({
  isOpen, onClose, emp, onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [activeStage, setActiveStage] = useState(1);
  // Stage 5 (Policies & Agreements) live signing status: total matched
  // agreement templates vs how many have a COMPLETED signing run. Lets the
  // sidebar/header reflect real signatures instead of marking the stage
  // "Completed" the moment HR clicks Next (macro watermark only).
  const [stage5Total, setStage5Total]   = useState(0);
  const [stage5Signed, setStage5Signed] = useState(0);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) { setStage5Total(0); setStage5Signed(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, runRes] = await Promise.all([
          api.get('/hr-document-templates/match', { params: { employee_id: emp.dbId, trigger_keyword: 'onboarding' } }),
          api.get('/hr-document-signatures', { params: { employee_id: emp.dbId } }),
        ]);
        if (cancelled) return;
        const tpls: any[] = Array.isArray(tplRes.data?.templates) ? tplRes.data.templates : [];
        const runs: any[] = Array.isArray(runRes.data) ? runRes.data : [];
        // Latest run per template_id (highest id wins) — a 'Completed' run = signed.
        const latest = new Map<number, any>();
        runs.forEach(r => { const t = r.template_id; if (t == null) return; const p = latest.get(t); if (!p || r.id > p.id) latest.set(t, r); });
        setStage5Total(tpls.length);
        setStage5Signed(tpls.filter(t => latest.get(t.id)?.status === 'Completed').length);
      } catch { if (!cancelled) { setStage5Total(0); setStage5Signed(0); } }
    })();
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId]);

  // The employee's SAVED salary structure (the exact components HR entered in
  // the employee form). The salary breakup prefers these real figures and only
  // falls back to a 50/30/20 auto-split when nothing has been saved yet — so
  // editing the breakup in the employee form reflects here too.
  const [savedBreakup, setSavedBreakup] = useState<{ earnings: any[]; deductions: any[]; pf: boolean } | null>(null);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) { setSavedBreakup(null); return; }
    let cancelled = false;
    api.get('/salary-structures', { params: { employee_id: emp.dbId, active_only: 1 } })
      .then(res => {
        if (cancelled) return;
        const rows = res.data?.data ?? [];
        const active = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (active && Array.isArray(active.earnings) && active.earnings.length) {
          setSavedBreakup({
            earnings: active.earnings,
            deductions: Array.isArray(active.deductions) ? active.deductions : [],
            pf: !!active.pf_applicable,
          });
        } else {
          setSavedBreakup(null);
        }
      })
      .catch(() => { if (!cancelled) setSavedBreakup(null); });
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId]);
  // Imperative handle into Stage 2 so we can flush its typed-but-not-blurred
  // company rows before leaving the stage (Previous / sidebar / Next Stage).
  const stage2Ref = useRef<Stage2DocumentsHandle | null>(null);
  // Live previous-employment progress reported by Stage2Documents (so the
  // sidebar % reflects a "Yes" answer + unsaved/0-doc companies immediately).
  const [stage2Prev, setStage2Prev] = useState<{ required: number; uploaded: number } | null>(null);
  // Reset to stage 1 each time a new employee opens
  useEffect(() => { if (isOpen) setActiveStage(1); }, [isOpen, emp?.id]);

  // Validation errors state — tracks which fields have errors
  // const [s1Errors, setS1Errors] = useState<Record<string, string>>({});

  // ── Master data — fetched once when the modal first opens. Everything
  //    Stage 1 needs to populate its dropdowns: countries (work + nationality),
  //    departments, designations, roles, legal entities, eligible managers.
  //    All scoped server-side to the inviting tenant.
  const [mCountries, setMCountries]       = useState<{ id: number; name: string }[]>([]);
  const [mDepts, setMDepts]               = useState<{ id: number; name: string }[]>([]);
  const [mDesignations, setMDesignations] = useState<{ id: number; name: string }[]>([]);
  const [mRoles, setMRoles]               = useState<{ id: number; name: string }[]>([]);
  const [mLegalEntities, setMLegalEntities] = useState<{ id: number; entity_name: string; city?: string | null }[]>([]);
  const [managerOpts, setManagerOpts]       = useState<{ value: string; label: string; deptId?: string; isHod?: boolean }[]>([]);
  // Leave plans need to come from the API (admin-defined per branch) — the
  // Add Employee form stores the plan id as the saved value, so a hardcoded
  // ["Leave Policy"] list would leave the onboarding dropdown blank for
  // every employee assigned a real plan.
  const [leavePlanOpts, setLeavePlanOpts] = useState<{ value: string; label: string }[]>([]);
  // While the master fetch below is in flight the async dropdowns shimmer
  // instead of flashing the saved raw id (work country showed "101" until
  // /master/countries landed, then swapped to the name). Starts true so the
  // very first paint after opening — before the fetch effect commits —
  // already shimmers.
  const [mastersLoading, setMastersLoading] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMastersLoading(true);
    Promise.allSettled([
      api.get('/master/countries').then(r => {
        if (cancelled) return;
        setMCountries(Array.isArray(r.data) ? [...r.data].sort((a: any, b: any) => a.name.localeCompare(b.name)) : []);
      }),
      api.get('/master/departments').then(r => { if (!cancelled) setMDepts(Array.isArray(r.data) ? r.data : []); }),
      api.get('/master/designations').then(r => { if (!cancelled) setMDesignations(Array.isArray(r.data) ? r.data : []); }),
      api.get('/master/roles').then(r => { if (!cancelled) setMRoles(Array.isArray(r.data) ? r.data : []); }),
      api.get('/master/legal_entities').then(r => { if (!cancelled) setMLegalEntities(Array.isArray(r.data) ? r.data : []); }),
      api.get('/employees/managers').then(r => {
        if (cancelled) return;
        const merged = [
          ...((r?.data?.employees   ?? []) as any[]),
          ...((r?.data?.login_users ?? []) as any[]),
        ];
        // Strip the row currently being onboarded out of the manager
        // list — an employee can never report to themselves. Matches
        // by kind+id so we don't accidentally remove a login_user
        // that happens to share a numeric id with this employee.
        const selfId = emp?.dbId ?? null;
        const filtered = selfId
          ? merged.filter(m => !(m.kind === 'employee' && Number(m.id) === Number(selfId)))
          : merged;
        setManagerOpts(filtered.map(m => ({ value: `${m.kind}:${m.id}`, label: m.label, deptId: m.department_id != null ? String(m.department_id) : undefined, isHod: !!m.is_hod })));
      }).catch(() => { if (!cancelled) setManagerOpts([]); }),
      api.get('/leave-plans').then(r => {
        if (cancelled) return;
        const plans = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
        // Only surface plans whose quota setup is fully complete — draft /
        // unconfigured plans must not be assignable to an employee.
        setLeavePlanOpts(
          plans
            .filter((p: any) => p.setup_complete)
            .map((p: any) => ({ value: String(p.id), label: p.plan_name || p.name || `Plan ${p.id}` })),
        );
      }).catch(() => { if (!cancelled) setLeavePlanOpts([]); }),
    ]).then(() => { if (!cancelled) setMastersLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const countryOpts     = mCountries.map(c => ({ value: String(c.id), label: c.name }));
  const departmentOpts  = mDepts.map(d => ({ value: String(d.id), label: d.name }));
  // 'Director / CEO' is the Branch User's role (the branch director), not an
  // assignable employee designation — keep it out of the picker (mirrors the
  // Add Employee form).
  const designationOpts = mDesignations
    .filter(d => d?.name !== 'Director / CEO')
    .map(d => ({ value: String(d.id), label: d.name }));
  // Id of the "Head of Department (HOD)" designation — an HOD must report to a
  // Branch User (Director / CEO); this gates the manager picker + validation.
  const hodDesignationId = (() => {
    const h = mDesignations.find(d => d?.name === 'Head of Department (HOD)');
    return h ? String(h.id) : '';
  })();
  const roleOpts        = mRoles.map(r => ({ value: String(r.id), label: r.name }));
  const legalEntityOpts = mLegalEntities.map(le => ({ value: String(le.id), label: le.entity_name }));

  // ── Asset pickers (Step 3) ─────────────────────────────────────────
  // Three independent lists — Laptop / Mobile / Other. We fetch the
  // available pool from the server so devices already booked by other
  // employees stay out, but the asset currently on THIS employee's
  // row (exclude_employee_id=...) remains visible so the admin can
  // keep their selection on edit.
  type AssetOpt = { value: string; label: string };
  const [laptopAssets, setLaptopAssets] = useState<AssetOpt[]>([]);
  const [mobileAssets, setMobileAssets] = useState<AssetOpt[]>([]);
  const [otherAssets, setOtherAssets]   = useState<AssetOpt[]>([]);
  // Same shimmer treatment as mastersLoading — a saved asset FK must not
  // flash as a raw id while the available-assets fetch is in flight.
  const [assetsLoading, setAssetsLoading] = useState(true);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) return;
    let cancelled = false;
    setAssetsLoading(true);
    const url = (cat: string) => `/employees/available-assets?category=${cat}&exclude_employee_id=${emp.dbId}`;
    Promise.allSettled([
      api.get(url('laptop')).then(r => { if (!cancelled) setLaptopAssets((r.data ?? []).map((a: any) => ({ value: String(a.id), label: a.label || a.asset_name }))); }),
      api.get(url('mobile')).then(r => { if (!cancelled) setMobileAssets((r.data ?? []).map((a: any) => ({ value: String(a.id), label: a.label || a.asset_name }))); }),
      api.get(url('other')) .then(r => { if (!cancelled) setOtherAssets ((r.data ?? []).map((a: any) => ({ value: String(a.id), label: a.label || a.asset_name }))); }),
    ]).then(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId]);

  // ── Stage 1 form state — every field that maps to a column on
  //    /api/employees lives here. Hydrated from `emp.raw` whenever the
  //    modal opens for a new employee so the inputs always reflect what
  //    the server actually has. Save Draft pushes the diff back via PUT.
  const r = emp?.raw || {};
  const [s1Saving, setS1Saving] = useState(false);
  const [s1, setS1] = useState({
    first_name:  '',
    middle_name: '',
    last_name:   '',
    gender:      '',
    date_of_birth: '',
    blood_group:  '',
    nationality_country_id: '',
    work_country_id: '',
    email:       '',
    official_email: '',
    mobile:      '',

    department_id:    '',
    designation_id:   '',
    primary_role_id:  '',
    ancillary_role_id: '',
    legal_entity_id:  '',
    location:         '',
    // Composite "kind:id" — picker stores employee:{id} or {kind}:{id}.
    // Save handler unpacks and only commits the FK when kind === 'employee'.
    reporting_manager: '',
    date_of_joining:  '',
    probation_policy: '',
    notice_period:    '',

    leave_plan: '', holiday_list: '', shift: '', weekly_off: '',
    attendance_number: '', time_tracking: '', penalization_policy: '',
    overtime: '', expense_policy: '',
    // Legacy free-text asset fields kept for backwards-compat hydration
    // only — UI now drives the FK columns below.
    laptop_assigned: '', laptop_asset_id: '', mobile_device: '', other_assets: '',
    // Stage 1 Step 3 — asset FK assignments. `laptop_master_asset_id` /
    // `mobile_master_asset_id` are single ids (string for select binding),
    // `other_master_asset_ids` is an array of ids. `mobile_assigned`
    // mirrors `laptop_assigned` so we can show/hide the picker.
    laptop_master_asset_id: '',
    mobile_assigned: '',
    mobile_master_asset_id: '',
    other_master_asset_ids: [] as string[],
    // Stage 3 — Physical Setup & Identification. Status fields start blank so
    // HR must consciously pick a value (bugs #36/#37 — a pre-selected default
    // let wrong info save silently).
    biometric_status:    '',
    desk_workstation_no: '',
    id_card_status:      '',
    attendance_tracking: true,

    enable_payroll: true,
    pay_group: '', annual_salary: '', salary_frequency: 'Per annum',
    salary_effective_from: '', salary_structure: '', tax_regime: '',
    bonus_in_annual: false, pf_eligible: false, detailed_breakup: false,
    pf_type: 'Statutory',   // 'Statutory' (₹15k cap) | 'Standard' (full basic)
  });

  // Snapshot of the name as last persisted on the server. Drives the
  // read-only "Employee Actual Name" field so the legal name stays
  // pinned to the saved value while the HR is editing first/middle/last —
  // only the Display Name preview moves with live input.
  const [actualNameSnapshot, setActualNameSnapshot] = useState('');

  // Hydrate from raw whenever the modal opens or a different employee is loaded.
// Hydrate from raw whenever the modal opens or a different employee is loaded.
useEffect(() => {
  if (!isOpen || !emp?.raw) return;
  const x = emp.raw;
  setS1({
    first_name:  String(x.first_name  ?? ''),
    middle_name: String(x.middle_name ?? ''),
    last_name:   String(x.last_name   ?? ''),
    gender:      String(x.gender ?? ''),
    date_of_birth: x.date_of_birth ? String(x.date_of_birth).slice(0, 10) : '',
    // Blood group is captured on the wizard but not yet on the employees
    // table — UI-only for now. If/when a column is added the same key
    // will flow through the existing saveStage1 payload.
    blood_group: String(x.blood_group ?? ''),
    nationality_country_id: x.nationality_country_id ? String(x.nationality_country_id) : '',
    work_country_id:        x.work_country_id        ? String(x.work_country_id)        : '',
    // Work email — MUST hydrate from the server value. After Save Draft /
    // Next Stage the parent reloads /employees, which gives us a fresh
    // emp.raw reference and re-fires this effect. If we leave email blank
    // here the user's typed value disappears the moment they navigate
    // away and back. Official email mirrors the work email by default —
    // they're the same address — but stays editable on Stage 3 so HR can
    // override it if the company issues a separate alias.
    email:       String(x.email ?? ''),
    official_email: String(x.official_email ?? x.email ?? ''),
    mobile:      String(x.mobile ?? ''),

    department_id:    x.department_id    ? String(x.department_id)    : '',
    designation_id:   x.designation_id   ? String(x.designation_id)   : '',
    primary_role_id:  x.primary_role_id  ? String(x.primary_role_id)  : '',
    ancillary_role_id: x.ancillary_role_id ? String(x.ancillary_role_id) : '',
    legal_entity_id:  x.legal_entity_id  ? String(x.legal_entity_id)  : '',
    location:         String(x.location ?? ''),
    /* Reporting manager picker stores "kind:id" — rebuild from whichever
     * column the backend filled. reporting_manager_user is eager-loaded
     * by EmployeeController so we know its user_type and can produce
     * the right kind prefix. Without this fallback the field was empty
     * even when the employee actually had a Branch/Client user manager. */
    reporting_manager: x.reporting_manager_id
      ? `employee:${x.reporting_manager_id}`
      : (x.reporting_manager_user_id && x.reporting_manager_user?.user_type
          ? `${x.reporting_manager_user.user_type}:${x.reporting_manager_user_id}`
          : ''),
    date_of_joining:  x.date_of_joining ? String(x.date_of_joining).slice(0, 10) : '',
    probation_policy: String(x.probation_policy ?? ''),
    notice_period:    String(x.notice_period    ?? ''),

    leave_plan:          String(x.leave_plan          ?? ''),
    holiday_list:        String(x.holiday_list        ?? ''),
    shift:               String(x.shift               ?? ''),
    weekly_off:          String(x.weekly_off          ?? ''),
    attendance_number:   String(x.attendance_number   ?? ''),
    time_tracking:       String(x.time_tracking       ?? ''),
    penalization_policy: String(x.penalization_policy ?? ''),
    overtime:            String(x.overtime            ?? ''),
    expense_policy:      String(x.expense_policy      ?? ''),
    laptop_assigned:     String(x.laptop_assigned     ?? ''),
    laptop_asset_id:     String(x.laptop_asset_id     ?? ''),
    mobile_device:       String(x.mobile_device       ?? ''),
    other_assets:        String(x.other_assets        ?? ''),
    laptop_master_asset_id: x.laptop_master_asset_id ? String(x.laptop_master_asset_id) : '',
    // No legacy free-text "Mobile Assigned" column — derive Yes/No
    // from whether a mobile asset is currently selected.
    mobile_assigned:     x.mobile_master_asset_id ? 'Yes' : (x.mobile_device ? 'Yes' : ''),
    mobile_master_asset_id: x.mobile_master_asset_id ? String(x.mobile_master_asset_id) : '',
    other_master_asset_ids: Array.isArray(x.other_master_asset_ids)
      ? x.other_master_asset_ids.map((n: any) => String(n))
      : [],
    biometric_status:    String(x.biometric_status    ?? ''),
    desk_workstation_no: String(x.desk_workstation_no ?? ''),
    id_card_status:      String(x.id_card_status      ?? ''),
    attendance_tracking: x.attendance_tracking !== undefined ? !!x.attendance_tracking : true,

    enable_payroll: x.enable_payroll !== undefined ? !!x.enable_payroll : true,
    pay_group:             String(x.pay_group             ?? ''),
    annual_salary:         x.annual_salary != null ? String(x.annual_salary) : '',
    salary_frequency:      String(x.salary_frequency      ?? 'Per annum'),
    salary_effective_from: x.salary_effective_from ? String(x.salary_effective_from).slice(0, 10) : '',
    salary_structure:      String(x.salary_structure      ?? ''),
    tax_regime:            String(x.tax_regime            ?? ''),
    bonus_in_annual:       !!x.bonus_in_annual,
    pf_eligible:           !!x.pf_eligible,
    pf_type:               String(x.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory',
    detailed_breakup:      !!x.detailed_breakup,
  });
  // Pin the actual-name display to whatever the server currently has —
  // typing into first/middle/last after this point only moves the
  // Display Name preview, not the legal name.
  setActualNameSnapshot(
    [x.first_name, x.middle_name, x.last_name]
      .filter(Boolean).join(' ').trim() || emp.name || ''
  );
}, [isOpen, emp?.id, emp?.raw]);

  // ── Form validation state ──────────────────────────────────────────
const [s1Errors, setS1Errors] = useState<Record<string, string>>({});
const [nextLoading, setNextLoading] = useState(false);

  // Freeze the whole stage form while an EXPLICIT save (Save Draft / Next
  // Stage) is in flight — previously the fields stayed editable during the
  // PUT, so users could keep typing mid-save and the form looked saved while
  // holding unsaved edits. Silent background saves fired by stage navigation
  // (goToStage) deliberately do NOT lock, preserving the BUG-030
  // fire-and-forget navigation speed.
  const [formLocked, setFormLocked] = useState(false);

  // ── Reporting-manager rule (org hierarchy: employee → dept HOD → Branch User).
  // A non-HOD hire reports to their department's HOD when one exists; until then
  // to a Branch User (the backend re-parents them to the HOD once it's added).
  // An HOD reports to a Branch User (the branch Director / CEO).
  const isHodSelected = !!hodDesignationId && String(s1.designation_id) === hodDesignationId;
  const selectedDeptId = String(s1.department_id || '');
  const branchUserMgrOpts = managerOpts.filter(m => m.value.startsWith('branch_user:'));
  const deptHodOpt = managerOpts.find(m => m.isHod && m.deptId && m.deptId === selectedDeptId) || null;
  // Non-HOD hire: Branch User(s) are always eligible; employees are scoped to the
  // SELECTED department, so the list reacts to the chosen department instead of
  // listing the whole company. The department's HOD is one of those employees
  // and is auto-selected below. HOD hire → Branch User(s) only.
  let reportingMgrOpts = isHodSelected
    ? branchUserMgrOpts
    : selectedDeptId
      ? managerOpts.filter(m => m.value.startsWith('branch_user:') || (m.deptId && m.deptId === selectedDeptId))
      : managerOpts;
  // Preserve an already-saved manager that falls outside the rule (e.g. an
  // existing employee reporting to a Team Lead) so edit mode never blanks it.
  const savedMgrOpt = managerOpts.find(m => m.value === s1.reporting_manager);
  if (savedMgrOpt && !reportingMgrOpts.some(o => o.value === savedMgrOpt.value)) {
    reportingMgrOpts = [savedMgrOpt, ...reportingMgrOpts];
  }
  // Auto-point a non-HOD hire at the department HOD once one exists — but only
  // when nothing is set or the current pick is the "temporary" Branch User the
  // HOD now supersedes; never override a manager deliberately chosen.
  useEffect(() => {
    if (isHodSelected || !deptHodOpt) return;
    setS1(p => {
      if (!p.reporting_manager || String(p.reporting_manager).startsWith('branch_user:')) {
        return p.reporting_manager === deptHodOpt.value ? p : { ...p, reporting_manager: deptHodOpt.value };
      }
      return p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHodSelected, deptHodOpt?.value]);
// Two-step confirmation before flipping the employee to "complete". Once
// the macro watermark hits 6, profile% locks to 100% and several stages
// stop being editable, so we don't want this firing on an accidental click.
const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
const [completeNotes, setCompleteNotes] = useState('');

// Wipe any stale errors whenever the modal opens for a new employee so
// the user doesn't see red borders from a previous attempt.
useEffect(() => { if (isOpen) setS1Errors({}); }, [isOpen, emp?.id]);

// ── Date-field bounds ─────────────────────────────────────────────
// Computed once per render. Each MasterDatePicker hides days outside
// its [minDate, maxDate] window so the user can't even click on, say,
// 2012 for a salary-effective-from. validateStage1 also re-checks the
// bounds in case anything slips through (e.g. hydrated bad data from
// the server). Format is YYYY-MM-DD because that's what MasterDatePicker
// returns from its onChange.
const _toIso = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayIso = _toIso(new Date());
// DOB: employee must be at least 18 today, and not older than 100.
const dobMin = _shiftYears(-100);
const dobMax = _shiftYears(-18);
// Joining: up to 5 years back (retro-joins) and 1 year ahead (planned starts).
const joinMin = _shiftYears(-5);
const joinMax = _shiftYears(1);
// Salary effective from: anchored to joining date when set, otherwise
// allow up to 1 year before today. Hard cap at 1 year ahead so an
// admin can schedule a near-future increment but not type "2012" or
// "2050" by mistake.
const salaryMin = s1.date_of_joining || _shiftYears(-1);
const salaryMax = _shiftYears(1);

// Probation length + end date, derived live from the joining date + probation
// policy. Stored on save (probation_months / probation_end_date) so the daily
// probation-completion email job reads it directly. Read-only in the UI.
const onbProbation = resolveProbation(s1.probation_policy, s1.date_of_joining);

// Ordered list of required field keys — drives both validation and
// scroll-to-first-error so the user lands on the topmost missing field
// in form order rather than alphabetical map order.
const STAGE1_FIELD_ORDER = [
  'work_country_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'mobile',
  'date_of_joining',
  'department_id',
  'designation_id',
  'primary_role_id',
  'legal_entity_id',
  'reporting_manager',
  'annual_salary',
  'salary_effective_from',
] as const;

/** Bring the first errored field into view + focus it so the user sees
 *  exactly where attention is needed. Falls back gracefully if the node
 *  isn't mounted (e.g. user is on a different stage when validation
 *  fires from a Save Draft). */
const scrollToFirstError = (errors: Record<string, string>) => {
  const first = STAGE1_FIELD_ORDER.find(k => errors[k]);
  if (!first) return;
  // Defer so the error nodes are in the DOM before we measure.
  setTimeout(() => {
    const wrap = document.querySelector<HTMLElement>(`[data-field="${first}"]`);
    if (!wrap) return;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = wrap.querySelector<HTMLElement>('input, button, textarea, select');
    focusable?.focus({ preventScroll: true });
  }, 50);
};

/** Validate Stage 1 required fields before allowing navigation. */
const validateStage1 = (): boolean => {
  const errors: Record<string, string> = {};

  // Personal Information - Required
  if (!s1.first_name?.trim()) errors.first_name = 'First name is required';
  if (!s1.last_name?.trim()) errors.last_name = 'Last name is required';
  // Work Country is required — drives tax / compliance / leave defaults
  // downstream, so we can't let the wizard advance without it.
  if (!s1.work_country_id?.toString().trim()) errors.work_country_id = 'Work country is required';
  // Date of Birth — required + age 18 sanity check. The picker already
  // hides invalid days, but a user could paste an ISO string into the
  // bound state from hydration, so we re-check here.
  const dob = s1.date_of_birth?.trim() ?? '';
  if (!dob) {
    errors.date_of_birth = 'Date of birth is required';
  } else if (dob > dobMax) {
    errors.date_of_birth = 'Employee must be at least 18 years old';
  } else if (dob < dobMin) {
    errors.date_of_birth = 'Date of birth looks unrealistic';
  }

  // Contact Information - Required + format
  const email = s1.email?.trim() ?? '';
  if (!email) {
    errors.email = 'Work email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address';
  }

  const mobile = s1.mobile?.trim() ?? '';
  const mobileDigits = mobile.replace(/\D/g, '');
  if (!mobile) {
    errors.mobile = 'Mobile number is required';
  } else if (mobileDigits.length < 6 || mobileDigits.length > 15) {
    // Match the Add Employee form (HrEmployees.tsx): 6–15 digits covers
    // every reasonable international format (E.164 max is 15). Anything
    // saved by Add Employee must pass this validator too, otherwise
    // existing rows fail re-save in the onboarding wizard.
    errors.mobile = 'Mobile must be 6–15 digits';
  }

  // Joining date — required + bounded (no 1990 entries, no 2050 entries).
  const doj = s1.date_of_joining?.trim() ?? '';
  if (!doj) {
    errors.date_of_joining = 'Joining date is required';
  } else if (doj < joinMin) {
    errors.date_of_joining = 'Joining date is too far in the past';
  } else if (doj > joinMax) {
    errors.date_of_joining = 'Joining date cannot be more than a year in the future';
  }

  // Compensation - Required + range
  // Postgres numeric(14, 2) max is 999,999,999,999.99. Anything larger
  // overflows the column and surfaces as a 500 from the server. Guard
  // here so the user gets a friendly inline error instead.
  // Only enforce the salary fields when payroll is enabled — mirrors the
  // employee form, which skips all Compensation validation when the "Enable
  // payroll" toggle is off (salary details don't apply then).
  if (s1.enable_payroll !== false) {
    const annualNum = Number(s1.annual_salary);
    if (!s1.annual_salary || !Number.isFinite(annualNum) || annualNum <= 0) {
      errors.annual_salary = 'Salary amount is required and must be greater than 0';
    } else if (annualNum > 999_999_999_999.99) {
      errors.annual_salary = 'Salary amount is too large (max 999,999,999,999.99)';
    }
    const sef = s1.salary_effective_from?.trim() ?? '';
    if (!sef) {
      errors.salary_effective_from = 'Salary effective date is required';
    } else if (sef < salaryMin) {
      errors.salary_effective_from = doj
        ? 'Salary effective date cannot be before the joining date'
        : 'Salary effective date is too far in the past';
    } else if (sef > salaryMax) {
      errors.salary_effective_from = 'Salary effective date cannot be more than a year in the future';
    }
  }

  // Job Details — Department / Designation / Primary Role are required.
  if (!s1.department_id?.toString().trim())   errors.department_id   = 'Department is required';
  if (!s1.designation_id?.toString().trim())  errors.designation_id  = 'Designation is required';
  if (!s1.primary_role_id?.toString().trim()) errors.primary_role_id = 'Primary role is required';
  // A role can't be both Primary and Ancillary for the same employee.
  else if (s1.ancillary_role_id && String(s1.ancillary_role_id) === String(s1.primary_role_id)) errors.primary_role_id = 'The Primary role cannot also be the Ancillary role.';

  // Organisational Details — Legal Entity + Reporting Manager are required.
  if (!s1.legal_entity_id?.toString().trim()) errors.legal_entity_id = 'Legal entity is required';
  if (!s1.reporting_manager?.toString().trim()) errors.reporting_manager = 'Reporting manager is required';
  else if (hodDesignationId && String(s1.designation_id) === hodDesignationId
           && !String(s1.reporting_manager).startsWith('branch_user:'))
    errors.reporting_manager = 'An HOD must report to a Branch User (Director / CEO).';

  // Work Details — Expense Policy is required (marked * in the form).
  if (!s1.expense_policy?.toString().trim()) errors.expense_policy = 'Expense policy is required';

  setS1Errors(errors);

  if (Object.keys(errors).length > 0) {
    toast.error('Please fill all required fields', `${Object.keys(errors).length} field(s) need attention`);
    scrollToFirstError(errors);
    return false;
  }
  return true;
};

  /** Validate Stage 1 required fields before allowing navigation. */
  // const validateStage1 = (): boolean => {
  //   const errors: Record<string, string> = {};
  //   if (!s1.first_name?.trim()) errors.first_name = 'First name is required';
  //   if (!s1.last_name?.trim()) errors.last_name = 'Last name is required';
  //   if (!s1.email?.trim()) errors.email = 'Work email is required';
  //   if (!s1.mobile?.trim()) errors.mobile = 'Mobile number is required';
    
  //   setS1Errors(errors);
  //   if (Object.keys(errors).length > 0) {
  //     toast.error('Please fill all required fields', `${Object.keys(errors).length} field(s) need attention`);
  //     return false;
  //   }
  //   return true;
  // };

  /** Push the current Stage 1 form values to the backend as a PUT. The
   *  server already accepts partial PATCHes — fields the wizard hasn't
   *  saved yet stay null on the row. wizard_step_completed gets bumped
   *  by the controller's high-watermark logic only if we send a higher
   *  value, so passing 4 here marks the wizard fully done. */
const saveStage1 = async (markComplete: boolean, skipValidate = false, silent = false): Promise<boolean> => {
  if (!emp?.dbId || s1Saving) return false;
  // Skip Stage-1 specific validation when called from later stages
  // (e.g. Stage 3 re-uses saveStage1 to persist its asset/provisioning
  // fields). Without this escape, an employee with any missing Stage 1
  // field — even one the user already saved — would silently block
  // Stage 3 saves, and the user's just-typed Stage 3 data would
  // disappear on modal close.
  if (!skipValidate && !validateStage1()) return false;
  setS1Saving(true);
  if (!silent) setFormLocked(true);
  // ... rest of the function
    const intOrNull = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };
    // Reporting manager uses a composite "kind:id" so the picker can host
    // both employees and login users in one list. The backend has two
    // columns — reporting_manager_id (FK → employees) and
    // reporting_manager_user_id (FK → users) — and only one is populated
    // per record. Split the picker value and route to the correct
    // column; explicit-null the other side so reassignments wipe the
    // previous link.
    const rmIds = (() => {
      if (!s1.reporting_manager) return { emp: null as number | null, user: null as number | null };
      const [kind, idStr] = String(s1.reporting_manager).split(':');
      if (kind === 'employee') return { emp: intOrNull(idStr), user: null };
      return { emp: null, user: intOrNull(idStr) };
    })();

    const payload: Record<string, any> = {
      ...s1,
      nationality_country_id: intOrNull(s1.nationality_country_id),
      work_country_id:        intOrNull(s1.work_country_id),
      department_id:    intOrNull(s1.department_id),
      designation_id:   intOrNull(s1.designation_id),
      primary_role_id:  intOrNull(s1.primary_role_id),
      ancillary_role_id: intOrNull(s1.ancillary_role_id),
      legal_entity_id:  intOrNull(s1.legal_entity_id),
      reporting_manager_id:      rmIds.emp,
      reporting_manager_user_id: rmIds.user,
      annual_salary:    s1.annual_salary === '' ? null : Number(s1.annual_salary),
      // PF type → backend expects lowercase; only meaningful when PF applies.
      pf_type:     s1.pf_eligible ? String(s1.pf_type).toLowerCase() : null,
      // Empty strings to null for nullable string columns
      first_name:  s1.first_name.trim() || null,
      middle_name: s1.middle_name.trim() || null,
      last_name:   s1.last_name.trim()   || null,
      email:       s1.email.trim()       || null,
      official_email: s1.official_email ? s1.official_email.trim() : null,
      mobile:      s1.mobile.trim()      || null,
      // Asset FK assignments. Skip the laptop / mobile FK when the
      // Yes/No flag is "No" so an explicit unassign actually clears it.
      laptop_master_asset_id: s1.laptop_assigned === 'Yes' ? intOrNull(s1.laptop_master_asset_id) : null,
      mobile_master_asset_id: s1.mobile_assigned === 'Yes' ? intOrNull(s1.mobile_master_asset_id) : null,
      other_master_asset_ids: s1.other_master_asset_ids
        .map(v => parseInt(v, 10))
        .filter(n => Number.isFinite(n)),
      // Derived from probation policy + joining date; read-only in the UI.
      probation_months:   onbProbation.months,
      probation_end_date: onbProbation.endIso || null,
    };
    // Strip the composite picker key — backend doesn't know about it.
    delete payload.reporting_manager;
    // The Mobile Yes/No toggle is a UI helper; backend has no column.
    delete payload.mobile_assigned;
    if (markComplete) payload.wizard_step_completed = 4;
    try {
      await api.put(`/employees/${emp.dbId}`, payload);
      // `silent` (stage-to-stage navigation) skips the heavy parent reload
      // AND the toast: the PUT already persisted the data, and re-fetching the
      // whole /employees list on every Next-Stage click was the main cause of
      // the navigation lag. The full reload still runs on Save Draft / final
      // save / close so the background list stays in sync.
      if (!silent) {
        onSaved?.();
        // Success feedback — `markComplete` means the wizard finished Stage 1
        // entirely; otherwise it's a partial save (Stage 3 advance, etc).
        if (markComplete) {
          toast.success('Stage 1 saved', 'Setup details persisted.');
        } else if (skipValidate) {
          // Save Draft path — partial save without marking the stage complete.
          toast.success('Draft saved', 'Your changes have been saved. You can finish the rest later.');
        } else {
          toast.success('Saved', 'Your changes have been persisted.');
        }
      }
      return true;
    } catch (err: any) {
      // Surface the failure so the user knows their edit didn't persist.
      // Pull the first validation error if present, fall back to the
      // server's top-level message, then to a generic notice.
      const errors = err?.response?.data?.errors;
      const firstFieldMsg = errors && typeof errors === 'object'
        ? (Object.values(errors)[0] as any[] | undefined)?.[0]
        : null;
      const msg = firstFieldMsg
        || err?.response?.data?.message
        || err?.message
        || 'Could not save changes — please try again.';
      toast.error('Save failed', String(msg));
      console.error('saveStage1 failed', err?.response?.data || err);
      return false;
    } finally {
      setS1Saving(false);
      if (!silent) setFormLocked(false);
    }
  };

  // ── Stage 2 — document state lifted to the modal scope ──────────────
  // MUST run on every render (not after the `if (!emp) return null` early
  // exit below). Hooks have to be in the same order across renders or
  // React fires the "change in the order of Hooks" warning we hit when
  // emp went from null → populated.
  const [stage2Docs, setStage2Docs] = useState<{ document_key: string; status: string }[]>([]);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) return;
    let cancelled = false;
    api.get(`/employees/${emp.dbId}/documents`)
      .then(r => { if (!cancelled) setStage2Docs(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setStage2Docs([]); });
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId]);

  // ── Stage 4 — Payroll & Finance Setup state (lifted to modal so the
  //    sidebar progress + footer gating + Save Draft button can read it).
  const [s4Saving, setS4Saving] = useState(false);
  // Flipped true when the user tries to advance/save Stage 4 with missing or
  // invalid required fields — drives the red `is-invalid` highlight so they can
  // see exactly which fields the "complete required fields" toast refers to.
  const [s4ShowErrors, setS4ShowErrors] = useState(false);
  const [s4, setS4] = useState({
    salary_payment_mode: 'bank' as 'bank' | 'cheque' | 'cash',
    bank_name: '',
    bank_account_number: '',
    ifsc_code: '',
    account_holder_name: '',
    bank_branch: '',
    bank_account_type: 'Salary',
    uan_number: '',
    pan_number: '',
    tax_regime: '',
    pf_deduction: '',
    esi_applicable: 'No',
    gratuity_nominee_name: '',
    agreed_ctc_lpa: '',
  });
  // Hydrate s4 whenever a different employee opens. Like s1 we always
  // re-seed on (isOpen, emp.id) so navigating between employees never
  // shows stale finance details.
  useEffect(() => {
    if (!isOpen || !emp?.raw) return;
    const x = emp.raw;
    const mode = String(x.salary_payment_mode ?? 'bank').toLowerCase();
    setS4({
      salary_payment_mode: (mode === 'cheque' || mode === 'cash') ? mode as any : 'bank',
      bank_name:           String(x.bank_name           ?? ''),
      bank_account_number: String(x.bank_account_number ?? ''),
      ifsc_code:           String(x.ifsc_code           ?? ''),
      account_holder_name: String(x.account_holder_name ?? ''),
      bank_branch:         String(x.bank_branch         ?? ''),
      bank_account_type:   String(x.bank_account_type   ?? 'Salary'),
      uan_number:          String(x.uan_number          ?? ''),
      pan_number:          String(x.pan_number          ?? ''),
      tax_regime:          String(x.tax_regime          ?? ''),
      pf_deduction:        String(x.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory', // repurposed: holds PF Type
      esi_applicable:      String(x.esi_applicable      ?? 'No'),
      gratuity_nominee_name: String(x.gratuity_nominee_name ?? ''),
      // Agreed CTC mirrors the Stage 1 annual salary (read-only). Derive it
      // straight from the saved annual_salary here so it shows IMMEDIATELY on
      // open — seeding from the (often-null) saved agreed_ctc_lpa left it blank
      // until the salary was edited/re-saved, and this init re-running on an
      // emp.raw refresh clobbered the mirror effect's value (bug #42).
      agreed_ctc_lpa:      (() => {
        const annual = Number(x.annual_salary);
        if (annual > 0) return String(+(annual / 100000).toFixed(2));
        return x.agreed_ctc_lpa != null ? String(x.agreed_ctc_lpa) : '';
      })(),
    });
  }, [isOpen, emp?.id, emp?.raw]);

  // Stage 4 "Agreed CTC (LPA)" mirrors the Stage 1 annual salary (₹ → lakhs
  // per annum) — read-only here, so always keep it in sync.
  useEffect(() => {
    const annual = Number(s1.annual_salary);
    const lpa = annual > 0 ? String(+(annual / 100000).toFixed(2)) : '';
    setS4(p => (p.agreed_ctc_lpa === lpa ? p : { ...p, agreed_ctc_lpa: lpa }));
  }, [s1.annual_salary]);

  // Stage 4 "PF Type" (held in pf_deduction) mirrors the Stage 1 PF Type —
  // read-only here, so always keep it in sync.
  useEffect(() => {
    const t = s1.pf_type || 'Statutory';
    setS4(p => (p.pf_deduction === t ? p : { ...p, pf_deduction: t }));
  }, [s1.pf_type]);

  /** PUT s4 fields back to the employee row. `markComplete` stamps
   *  `stage4_completed_at` so the sidebar marks Stage 4 done and Next
   *  Stage gets unblocked. We never clear the timestamp from here — once
   *  Stage 4 is complete, edits keep the row marked complete (matches
   *  the wizard_step_completed high-watermark behaviour). */
//  const validateStage1 = (): boolean => {
//   const errors: Record<string, string> = {};
  
//   // Personal Information - Required
//   if (!s1.first_name?.trim()) errors.first_name = 'First name is required';
//   if (!s1.last_name?.trim()) errors.last_name = 'Last name is required';
//   if (!s1.date_of_birth?.trim()) errors.date_of_birth = 'Date of birth is required';
  
//   // Contact Information - Required
//   if (!s1.email?.trim()) errors.email = 'Work email is required';
//   if (!s1.mobile?.trim()) errors.mobile = 'Mobile number is required';
  
//   // Compensation - Required
//   if (!s1.annual_salary || Number(s1.annual_salary) <= 0) {
//     errors.annual_salary = 'Annual salary is required and must be greater than 0';
//   }
//   if (!s1.salary_effective_from?.trim()) {
//     errors.salary_effective_from = 'Salary effective date is required';
//   }
  
//   setS1Errors(errors);
//   return Object.keys(errors).length === 0;
// };
  const saveStage4 = async (markComplete: boolean, silent = false): Promise<boolean> => {
    if (!emp?.dbId || s4Saving) return false;

    /* Hard validation — when salary mode is "bank" the full bank
     * details block is required before the row can be persisted at
     * all (not just before marking the stage complete). Previously
     * Save Draft + Next happily wrote the row with blank bank fields
     * because the gate only ran at the "mark complete" level; users
     * walked away thinking Stage 4 was "saved" but the bank block was
     * still empty, breaking the payroll handoff downstream. Block the
     * save and toast the field-level reason so the user knows exactly
     * what to fix. */
    if (s4.salary_payment_mode === 'bank') {
      const acc  = s4.bank_account_number.trim();
      const ifsc = s4.ifsc_code.trim();
      const missing: string[] = [];
      if (!s4.bank_name.trim())            missing.push('Bank Name');
      if (!acc)                            missing.push('Account Number');
      else if (!/^\d{9,18}$/.test(acc))    missing.push('Account Number (9–18 digits)');
      if (!ifsc)                           missing.push('IFSC Code');
      else if (!IFSC_RE.test(ifsc))        missing.push('IFSC Code (e.g. HDFC0000350)');
      if (!s4.account_holder_name.trim())  missing.push('Account Holder Name');
      if (!s4.bank_branch.trim())          missing.push('Bank Branch');
      if (missing.length > 0) {
        setS4ShowErrors(true);   // highlight the offending bank fields
        toast.error(
          'Bank details required',
          `Fill in: ${missing.join(', ')}. Pick a non-bank payment mode if no bank account applies.`
        );
        return false;
      }
    }

    // PAN format hard-block — a malformed PAN (wrong length / pattern, e.g.
    // 'ABCD1234E' or '12345ABCDE') must be REJECTED before the save, not just
    // flagged with an inline hint. Mirrors the AAAAA9999A rule the backend
    // also enforces, so the user gets a clear message instead of a raw 422.
    const panVal = s4.pan_number.trim().toUpperCase();
    if (panVal && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panVal)) {
      setS4ShowErrors(true);   // highlight the PAN field
      toast.error('Invalid PAN', 'PAN must be in the format AAAAA9999A — 5 letters, 4 digits, then 1 letter.');
      return false;
    }

    setS4Saving(true);
    if (!silent) setFormLocked(true);
    // Client-side PAN uniqueness check (best-effort). If backend supports filtering
    // by PAN this avoids a slow round-trip on Save. If not supported we fall back
    // to server-side validation.
    if (s4.pan_number && s4.pan_number.trim()) {
      const panU = s4.pan_number.trim().toUpperCase();
      try {
        const r = await api.get(`/employees?pan=${encodeURIComponent(panU)}`);
        const list = Array.isArray(r.data) ? r.data : [];
        const dup = list.find((e: any) => String(e.pan_number || '').toUpperCase() === panU && String(e.id) !== String(emp.dbId));
        if (dup) {
          toast.error('PAN already in use', 'Another employee already has this PAN.');
          setS4Saving(false);
          if (!silent) setFormLocked(false);
          return false;
        }
      } catch (err) {
        // ignore - rely on server validation if filtering isn't available
      }
    }
    const trimOrNull = (v: string) => {
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    };
    const payload: Record<string, any> = {
      salary_payment_mode: s4.salary_payment_mode,
      bank_name:           trimOrNull(s4.bank_name),
      bank_account_number: trimOrNull(s4.bank_account_number),
      ifsc_code:           s4.ifsc_code.trim() ? s4.ifsc_code.trim().toUpperCase() : null,
      account_holder_name: trimOrNull(s4.account_holder_name),
      bank_branch:         trimOrNull(s4.bank_branch),
      bank_account_type:   trimOrNull(s4.bank_account_type),
      uan_number:          trimOrNull(s4.uan_number),
      pan_number:          s4.pan_number.trim() ? s4.pan_number.trim().toUpperCase() : null,
      tax_regime:          trimOrNull(s4.tax_regime),
      // The "PF Type" dropdown (Statutory / Standard) is held in pf_deduction
      // and saved to the pf_type column the payroll engine reads.
      pf_type:             s4.pf_deduction ? s4.pf_deduction.toLowerCase() : null,
      esi_applicable:      trimOrNull(s4.esi_applicable),
      gratuity_nominee_name: trimOrNull(s4.gratuity_nominee_name),
      agreed_ctc_lpa:      s4.agreed_ctc_lpa === '' ? null : Number(s4.agreed_ctc_lpa),
    };
    if (markComplete) {
      payload.stage4_completed_at = new Date().toISOString();
      // Bump the macro-stage watermark so profile% reflects Stage 4.
      payload.onboarding_stage_completed = 4;
    }
    try {
      await api.put(`/employees/${emp.dbId}`, payload);
      setS4ShowErrors(false);   // saved cleanly — drop any error highlight
      onSaved?.();
      return true;
    } catch (err: any) {
      const errors = err?.response?.data?.errors;
      const firstFieldMsg = errors && typeof errors === 'object'
        ? (Object.values(errors)[0] as any[] | undefined)?.[0]
        : null;
      const msg = firstFieldMsg
        || err?.response?.data?.message
        || err?.message
        || 'Could not save changes — please try again.';
      toast.error('Save failed', String(msg));
      console.error('saveStage4 failed', err?.response?.data || err);
      return false;
    } finally {
      setS4Saving(false);
      if (!silent) setFormLocked(false);
    }
  };

  /** Lightweight PUT used when the user clicks Next Stage on a macro
   *  stage we don't have dedicated form state for yet (Stage 2/3/5/6).
   *  Bumps the macro watermark so profile% climbs as the user advances. */
  const bumpMacroStage = async (n: number) => {
    if (!emp?.dbId) return;
    const current = Number(emp.raw?.onboarding_stage_completed ?? 0);
    if (n <= current) return;
    try {
      await api.put(`/employees/${emp.dbId}`, { onboarding_stage_completed: n });
      onSaved?.();
    } catch { /* keep modal open; user can retry */ }
  };

  /** True when the current active stage has passed its required-field
   *  validation. Drives BOTH the Next button and the sidebar
   *  `goToStage` so forward navigation is impossible until the
   *  mandatory fields on the active stage are filled. Backward jumps
   *  ignore this — already-visited stages can be revisited freely. */
  const canAdvanceFromActiveStage = (): { ok: boolean; reason?: string } => {
    if (activeStage === 1) {
      return validateStage1()
        ? { ok: true }
        : { ok: false, reason: 'Fill in every required field on Onboarding Setup before continuing.' };
    }
    if (activeStage === 2) {
      // Stage 2's ref-exposed validate() returns false when Yes/No on
      // previous employment hasn't been picked yet (and other doc-
      // mandatory checks fail).
      const stage2Ok = stage2Ref.current?.validate?.() ?? true;
      return stage2Ok
        ? { ok: true }
        : { ok: false, reason: 'Pick Yes / No on Previous Employment and complete the mandatory documents.' };
    }
    if (activeStage === 3) {
      const emailErr = validateOfficialEmail(s1.official_email);
      return !emailErr
        ? { ok: true }
        : { ok: false, reason: emailErr };
    }
    if (activeStage === 4) {
      // Mirrors the readiness checks rendered inside Stage4Payroll —
      // bank block valid for the chosen payment mode + PAN + UAN
      // format + agreed CTC + PF deduction.
      return (stage4Pass === stage4Total4 && stage4UanOk)
        ? { ok: true }
        : { ok: false, reason: 'Bank details, PAN, CTC and PF deduction must all be valid before moving on.' };
    }
    // if (activeStage === 5) {
    //   return stage5IsDone
    //     ? { ok: true }
    //     : { ok: false, reason: 'Acknowledge every policy before moving to verification.' };
    // }
    if (activeStage === 5) {
  return { ok: true };
}
    return { ok: true };
  };

  /** Navigate to a different stage without losing in-flight edits.
   *  Stages 1, 3, 4 have bound state — flush them to the backend first
   *  (skipValidate so a partially-filled stage doesn't block the save
   *  call), then switch. Used by both the Previous button and the
   *  sidebar stage cards so clicking around the wizard never silently
   *  drops user input.
   *
   *  Forward jumps (target > activeStage) are gated on
   *  canAdvanceFromActiveStage() — previously the sidebar let users
   *  click any stage card regardless of validation, so they hopped
   *  past required fields and only hit errors at final submission.
   *  Backward jumps stay free. */
  const goToStage = async (target: number) => {
    if (target === activeStage) return;
    if (target > activeStage) {
      const gate = canAdvanceFromActiveStage();
      if (!gate.ok) {
        toast.error('Complete this stage first', gate.reason || 'Mandatory fields are still empty.');
        return;
      }
    }
    // Switch the stage IMMEDIATELY so navigation feels instant, then persist
    // the stage we're leaving in the BACKGROUND (fire-and-forget). Awaiting
    // the PUT before switching was the remaining navigation-lag culprit:
    // BUG-030 removed the /employees reload, but the blocking save round-trip
    // still froze the UI on every stage click. Silent saves already skip the
    // parent reload + toast; the typed data stays in `s1`/refs so nothing is
    // lost while the request is in flight, and a failed save still surfaces
    // its own error toast from within saveStage1 / saveStage4.
    const from = activeStage;
    setActiveStage(Math.max(1, Math.min(6, target)));
    if (from === 1) {
      void saveStage1(false, true, true);
    } else if (from === 2) {
      // Persist any typed-but-unblurred Previous-Employment rows so
      // the user doesn't lose Company Name / Job Title / dates on
      // navigation. onBlur fires the same persistCompany under the
      // hood — flushing here just kicks any rows that haven't been.
      void stage2Ref.current?.flush();
    } else if (from === 3) {
      void saveStage1(false, true, true);
    } else if (from === 4) {
      void saveStage4(false, true);
    }
  };

  if (!emp) return null;

  // Pre-fill values from the row (legacy variables kept for the existing
  // header avatar render below).
  const firstName = emp.name.split(' ')[0] ?? '';
  const lastName  = emp.name.split(' ').slice(1).join(' ') ?? '';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _legacyRefs = { firstName, lastName, r };

  // Per-stage status. Stage 1 is special: it represents the 4-step wizard
  // we already persist on /api/employees, so its progress comes straight
  // from `emp.wizardStep` (0-4 → 0-100%) and stays Completed once the
  // wizard is fully saved — even if the user navigates back to Stage 1
  // to review. Stages 2-6 keep the old "based on user navigation" logic
  // because they don't have backend persistence yet.
  const wizardStep = Math.max(0, Math.min(4, Number(emp.wizardStep ?? 0)));
  // Live Stage 1 progress — derived from how many of the 7 required Stage 1
  // fields the user has filled in s1 right now. This makes the sidebar bar
  // move every time the user types/selects, instead of jumping in 25%
  // chunks only after Save Draft. Once the wizard is fully saved on the
  // server, lock at 100% (server is authoritative — covers cases where
  // the form is empty on reopen for a Completed employee).
  // Mirror the validateStage1 required set so the sidebar % / 100%-gate match
  // exactly what blocks "Next Stage" (Job + Organisational details included).
  const stage1RequiredFields = [
    s1.work_country_id,
    s1.first_name,
    s1.last_name,
    s1.date_of_birth,
    s1.email,
    s1.mobile,
    s1.date_of_joining,
    s1.department_id,
    s1.designation_id,
    s1.primary_role_id,
    s1.legal_entity_id,
    s1.reporting_manager,
    s1.annual_salary,
    s1.salary_effective_from,
  ];
  const stage1Filled = stage1RequiredFields.filter(v => String(v ?? '').trim()).length;
  const stage1LivePct = Math.round((stage1Filled / stage1RequiredFields.length) * 100);
  const stage1Done = wizardStep >= 4;
  const stage1Pct = stage1Done
    ? 100
    // Take the larger of the live form % and the server's high-watermark
    // so navigating back to Stage 1 on a partially-saved employee shows
    // at least the persisted progress.
    : Math.max(stage1LivePct, wizardStep * 25);

  // Stage 2 progress is anchored to the document upload count. Counts
  // BOTH catalogue docs (Aadhaar, PAN, …) AND per-company docs (one set
  // of 4 per persisted previous-employment row). Required-only — Optional
  // catalogue rows are excluded from `total` so an "Optional" never
  // permanently caps the percentage below 100%.
  const stage2RequiredCatalogueKeys = STAGE2_CATEGORIES.flatMap(cat =>
    cat.docs.filter(d => d.status !== 'Optional').map(d => d.id),
  );
  const isUp2 = (s?: string) => s === 'uploaded' || s === 'verified';
  const catalogueTotal    = stage2RequiredCatalogueKeys.length;
  const catalogueUploaded = stage2RequiredCatalogueKeys.filter(k =>
    isUp2(stage2Docs.find(d => d.document_key === k)?.status),
  ).length;

  // Previous-employment progress. Prefer the LIVE report from Stage2Documents
  // (the only place that knows the in-progress "Yes" answer + unsaved / 0-doc
  // companies); fall back to the saved previous_employment rows + uploaded doc
  // rows when the child hasn't reported yet (e.g. before Stage 2 is opened).
  let prevRequired: number;
  let prevUploaded: number;
  if (stage2Prev) {
    prevRequired = stage2Prev.required;
    prevUploaded = Math.min(stage2Prev.uploaded, stage2Prev.required);
  } else {
    const ids = Array.from(new Set([
      ...stage2Docs.map(d => d.document_key.match(/^prev_(\d+)_/)?.[1]).filter((x): x is string => !!x),
      ...(emp?.raw?.has_prior_experience && Array.isArray(emp?.raw?.previous_employments)
        ? emp.raw.previous_employments.map((pe: any) => String(pe.id)).filter(Boolean) : []),
    ]));
    const keys = ids.flatMap(id =>
      STAGE2_COMPANY_DOCS.filter(d => d.status !== 'Optional').map(d => `prev_${id}_${d.id}`));
    prevRequired = keys.length;
    prevUploaded = keys.filter(k => isUp2(stage2Docs.find(d => d.document_key === k)?.status)).length;
  }

  const stage2Total    = catalogueTotal + prevRequired;
  const stage2Uploaded = catalogueUploaded + prevUploaded;
  const stage2Pct = stage2Total ? Math.round((stage2Uploaded / stage2Total) * 100) : 0;
  const stage2Done = stage2Total > 0 && stage2Uploaded >= stage2Total;

  // Stage 3 progress — mirrored from the same `tasksDone / 4` calculation
  // inside Stage3Provisioning, but computed here so the sidebar reflects
  // it without the user having to navigate to Stage 3. Each "task" maps
  // to one of the four provisioning areas (laptop, mobile, other-assets,
  // physical security like biometric/desk/ID card).
  const stage3TasksTotal = 4;
  const stage3TasksDone =
    (s1.laptop_assigned === 'Yes' && s1.laptop_master_asset_id ? 1 : 0)
    + (s1.mobile_assigned === 'Yes' && s1.mobile_master_asset_id ? 1 : 0)
    + ((s1.other_master_asset_ids?.length ?? 0) > 0 ? 1 : 0)
    + (
      (s1.biometric_status && s1.biometric_status !== 'Not Registered') ||
      !!s1.desk_workstation_no?.trim() ||
      (s1.id_card_status && s1.id_card_status !== 'Not Printed')
        ? 1 : 0
    );
  const stage3Pct = Math.round((stage3TasksDone / stage3TasksTotal) * 100);
  // Stage 3 is "Done" once the server has stamped it (macro stage ≥ 3) OR
  // every task is filled in the current session.
  const stage3MacroDone = Number(emp?.raw?.onboarding_stage_completed ?? 0) >= 3;
  const stage3Done = stage3MacroDone || stage3TasksDone === stage3TasksTotal;

  // Stage 4 readiness — same shape as the four checks rendered inside
  // `Stage4Payroll`, derived from the live s4 form state. Bank check
  // auto-passes for cheque/cash since no account is needed.
  const PAN_RE  = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
  const UAN_RE  = /^\d{12}$/;
  const stage4BankOk =
    s4.salary_payment_mode !== 'bank' || (
      !!s4.bank_name.trim() &&
      // Account number must be 9–18 digits (matches the inline hint on
      // the input). Without this, a single-digit or 30-character entry
      // would still flip the readiness check green.
      /^\d{9,18}$/.test(s4.bank_account_number.trim()) &&
      IFSC_RE.test(s4.ifsc_code.trim()) &&
      !!s4.account_holder_name.trim() &&
      !!s4.bank_branch.trim()
    );
  const stage4PanOk = PAN_RE.test(s4.pan_number.trim());
  const stage4UanOk = !s4.uan_number.trim() || UAN_RE.test(s4.uan_number.trim());
  // Salary structure check passes once Stage 4's Agreed CTC is set. We
  // don't couple this to Stage 1's annual_salary — admins often record
  // a negotiated CTC at Stage 4 that's distinct from the wizard's
  // initial salary input, and gating on both made the pill stay
  // Pending after a clean fill.
  const stage4SalaryOk = Number(s4.agreed_ctc_lpa) > 0;
  const stage4PfOk = !!s4.pf_deduction.trim();
  const stage4Checks = [stage4BankOk, stage4PanOk, stage4SalaryOk, stage4PfOk];
  const stage4Pass   = stage4Checks.filter(Boolean).length;
  const stage4Total4 = stage4Checks.length;
  // Stage 4 is locked done once the row has been stamped. We *also* allow
  // an in-session completion when all four checks pass + UAN format is
  // valid, so the progress meter updates immediately after Save Draft.
  const stage4Stamped = !!emp?.raw?.stage4_completed_at;
  const stage4Done    = stage4Stamped || (stage4Pass === stage4Total4 && stage4UanOk);
  const stage4Pct     = stage4Stamped ? 100 : Math.round((stage4Pass / stage4Total4) * 100);

  // Server-side macro stage watermark — used as the floor for every
  // stage's % so finished stages don't visually regress when the user
  // navigates back. e.g. macro=4 → Stages 1-4 always show ≥ 100%.
  const macroCompleted = Number(emp?.raw?.onboarding_stage_completed ?? 0);
  // Per-stage completion flags, computed once and reused both for the
  // sidebar pills below AND for the Stage-6 gate. Each stage's "done"
  // mixes its live readiness signal with the server's macro watermark
  // (so finished stages don't visually regress before re-hydration). The
  // exception is Stage 2, which requires BOTH all docs uploaded AND the
  // macro watermark to have moved past 2 — see comment on the original
  // change for why the OR was a false positive.
  // Stage 1 is only "done" when EVERY required field is actually filled. The
  // macro watermark alone must not mark it 100% — e.g. if annual salary was
  // cleared on re-edit, the sidebar should drop below 100% and block Stage 6.
  const stage1AllRequiredFilled = stage1Filled === stage1RequiredFields.length;
  const stage1IsDone = (stage1Done || macroCompleted >= 1) && stage1AllRequiredFilled;
  const stage2IsDone = stage2Done && macroCompleted >= 2;
  const stage3IsDone = stage3Done || macroCompleted >= 3;
  const stage4IsDone = stage4Done || macroCompleted >= 4;
  // "Done" only when EVERY matched agreement has a completed signing run —
  // not just because HR advanced past the stage. If the employee has no
  // matched agreements, fall back to the macro watermark.
  const stage5SignedAll = stage5Total > 0 ? stage5Signed >= stage5Total : macroCompleted >= 5;
  const stage5IsDone = macroCompleted >= 5 && stage5SignedAll;
  // Stage 6 represents the HR final-approval / activation step. Used to
  // flip Completed the moment the activate API returned, even when
  // earlier stages were still Pending (the screenshot bug). Now we
  // additionally require every prior stage to be done — activation by
  // itself is no longer enough to mark the wizard as Completed.
  const allPriorStagesDone =
    stage1IsDone && stage2IsDone && stage3IsDone && stage4IsDone && stage5IsDone;
  const isActivated =
    macroCompleted >= 6 || String(emp?.raw?.status ?? '').toLowerCase() === 'active';
  const stage6Done = isActivated && allPriorStagesDone;

  const stagesView = ONB_STAGES.map(s => {
    let status: StageStatus, progress: number;
    if (s.num === 1) {
      // Use the live required-field % so a missing required field (e.g. annual
      // salary) shows < 100 instead of the macro watermark's 100.
      progress = stage1IsDone ? 100 : stage1LivePct;
      status   = stage1IsDone ? 'Completed' : (wizardStep > 0 || stage1Filled > 0 ? 'In Progress' : 'Pending');
    } else if (s.num === 2) {
      progress = stage2IsDone ? 100 : stage2Pct;
      status   = stage2IsDone ? 'Completed' : (stage2Uploaded > 0 ? 'In Progress' : 'Pending');
    } else if (s.num === 3) {
      progress = stage3IsDone ? 100 : stage3Pct;
      status   = stage3IsDone ? 'Completed' : (stage3TasksDone > 0 ? 'In Progress' : 'Pending');
    } else if (s.num === 4) {
      progress = stage4IsDone ? 100 : stage4Pct;
      status   = stage4IsDone ? 'Completed' : (stage4Pass > 0 ? 'In Progress' : 'Pending');
    } else if (s.num === 5) {
      // Reflect real signing progress (signed / total agreements). 100% only
      // when all are signed; "sent — awaiting sign" stays In Progress, so the
      // stage no longer shows Completed just because it was sent.
      progress = stage5IsDone ? 100
        : (stage5Total > 0 ? Math.round((stage5Signed / stage5Total) * 100)
        : (activeStage === 5 ? 35 : 0));
      status = stage5IsDone ? 'Completed'
        : ((stage5Signed > 0 || activeStage === 5 || macroCompleted >= 5) ? 'In Progress' : 'Pending');
    } else if (s.num === 6) {
      progress = stage6Done ? 100 : (activeStage === 6 ? 35 : 0);
      status   = stage6Done ? 'Completed' : (activeStage === 6 ? 'In Progress' : 'Pending');
    } else if (s.num < activeStage)      { status = 'Completed';   progress = 100; }
    else if (s.num === activeStage) { status = 'In Progress'; progress = s.progress || 35; }
    else                           { status = 'Pending';     progress = 0;   }
    return { ...s, status, progress };
  });
  const overallPct = Math.round(stagesView.reduce((a, s) => a + s.progress, 0) / stagesView.length);
  const currentStage = stagesView[activeStage - 1];

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="xl"
      contentClassName="onb-init-content border-0"
      modalClassName="onb-init-modal"
      backdrop="static"
      keyboard={false}
      scrollable
    >

      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header */}
        <div className="onb-init-header">
          {/* Close is disabled while an explicit save is in flight so the user
              can't dismiss the modal mid-save (CBC #34). */}
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label="Close"
            disabled={formLocked}
            style={formLocked ? { cursor: 'wait', opacity: 0.5, pointerEvents: 'none' } : undefined}
          >
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </button>

          <div className="onb-init-emp-row">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <div
                className="onb-init-avatar"
                style={{ background: `linear-gradient(135deg, ${emp.accent}, ${emp.accent}cc)` }}
              >
                {emp.initials}
              </div>
              <div className="min-w-0">
                <div className="d-flex align-items-center flex-wrap">
                  <h5 className="onb-init-name">{emp.name}</h5>
                  <span className="onb-init-pill">Onboarding In Progress</span>
                </div>
                <div className="onb-init-sub">
                  {emp.empId} · {emp.department} · {emp.designation}
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="onb-init-status-pill"><i className="ri-time-line" /> Status: {emp.status}</span>
              <span className="onb-init-status-pill"><i className="ri-user-line" /> Profile: {emp.profile}% complete</span>
            </div>
          </div>

          {/* Header stepper removed — the left sidebar already shows
              every stage with its status, so the duplicate pill strip
              here was redundant noise. */}
        </div>

        {/* Two-column body */}
        <div className="onb-init-body" aria-busy={formLocked} style={{ position: 'relative' }}>
          {/* While an explicit save is in flight, a transparent overlay blocks
              every mouse interaction (sidebar navigation included) and shows a
              wait cursor; the disabled <fieldset> below kills keyboard edits.
              Without this, users could keep editing mid-save and the form
              looked saved while still holding unsaved changes. */}
          {formLocked && (
            <div
              title="Saving…"
              style={{ position: 'absolute', inset: 0, zIndex: 30, cursor: 'wait', background: 'rgba(255,255,255,0.35)' }}
            />
          )}
          {/* Sidebar */}
          <div className="onb-init-side">
            <div className="onb-init-side-head">
              <p className="onb-init-side-title">Onboarding Stages</p>
              <span className="onb-init-side-pct">{overallPct}%</span>
            </div>
            <div className="onb-init-side-bar"><div className="onb-init-side-fill" style={{ width: `${overallPct}%` }} /></div>
            {stagesView.map(s => (
              <div
                key={s.key}
                className={`onb-init-stage-card ${activeStage === s.num ? 'is-active' : ''}`}
                onClick={() => { void goToStage(s.num); }}
              >
                <span className={`onb-init-stage-num ${s.status === 'Completed' ? 'is-done' : ''}`}>
                  {s.status === 'Completed' ? <i className="ri-check-line" /> : s.num}
                </span>
                <div className="min-w-0 flex-grow-1">
                  <p className="onb-init-stage-name">{s.stage}</p>
                  <div className="onb-init-stage-meta">
                    <span className={`onb-init-stage-status ${s.status === 'In Progress' ? 'in-progress' : s.status === 'Completed' ? 'completed' : 'pending'}`}>
                      <span className="dot" />
                      {s.status === 'Completed' ? 'COMPLETED' : s.status === 'In Progress' ? 'IN PROGRESS' : 'PENDING'}
                    </span>
                    <span className="onb-init-stage-pct">{s.progress}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Main */}
          <div className="onb-init-main">
            {/* Zero-styled fieldset: disabling it disables every native input /
                select / textarea / button inside — including the field that had
                focus when Save was clicked — for the duration of the save. */}
            <fieldset disabled={formLocked} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
            {/* Stage banner */}
            <div className="onb-init-stage-banner">
              <span className="onb-init-banner-icon">
                <i className={currentStage.icon} style={{ fontSize: 16 }} />
              </span>
              <div className="min-w-0">
                <p className="onb-init-banner-meta">Stage {activeStage} of 6</p>
                <h5 className="onb-init-banner-title">{currentStage.stage}</h5>
                <div className="onb-init-banner-sub">{currentStage.sub}</div>
              </div>
              <span className={`onb-init-banner-state ${currentStage.status === 'Pending' ? 'pending' : ''}`}>
                <span className="dot" /> {currentStage.status}
              </span>
            </div>

            {/* Per-stage progress banner removed — the sidebar already
                shows overall + per-stage progress, so this was redundant
                and visually noisy on top of every stage. */}
            {activeStage === 1 && Object.keys(s1Errors).length > 0 && (
  <div className="onb-validation-summary">
    <i className="ri-error-warning-line" />
    <span>Please fill in all required fields marked with <span className="req">*</span> before proceeding.</span>
  </div>
)}

            {activeStage === 2 && (
              <Stage2Documents
                ref={stage2Ref}
                emp={emp}
                onDocsChanged={(rows) => setStage2Docs(rows)}
                onProgress={setStage2Prev}
              />
            )}
            {activeStage === 3 && (
              <Stage3Provisioning
                emp={emp}
                s1={s1}
                setS1={setS1}
                s1Errors={s1Errors}
                setS1Errors={setS1Errors}
                laptopAssets={laptopAssets}
                mobileAssets={mobileAssets}
                otherAssets={otherAssets}
                assetsLoading={assetsLoading}
              />
            )}
            {activeStage === 4 && (
              <Stage4Payroll
                s4={s4}
                setS4={setS4}
                checks={{ bank: stage4BankOk, pan: stage4PanOk, salary: stage4SalaryOk, pf: stage4PfOk }}
                showErrors={s4ShowErrors}
                pass={stage4Pass}
                total={stage4Total4}
              />
            )}
            {activeStage === 5 && <Stage5Policies emp={emp} />}
            {activeStage === 6 && <Stage6Verify emp={emp} stagesView={stagesView} onActivated={onSaved} />}

            {activeStage === 1 && (
            <>
            {/* ── Step 1 — Basic Details ── */}
            <div className="onb-init-section">
              <div className="onb-init-section-head">
                <span className="onb-init-section-num basic">1</span>
                <div className="min-w-0">
                  <h5 className="onb-init-section-title">Basic Details</h5>
                  <div className="onb-init-section-sub">Personal information &amp; contact identity</div>
                </div>
                <span className="onb-init-section-step basic">STEP 1 OF 4</span>
              </div>
              <div className="onb-init-section-body">
                <p className="onb-init-subgroup">Employee Details</p>
                <Row className="g-3">
                  <Col md={4} data-field="work_country_id">
                    <label className="onb-init-label">Work Country <span className="req">*</span></label>
                    <MasterSelect
                      options={countryOpts}
                      loading={mastersLoading}
                      placeholder="Select country"
                      value={s1.work_country_id}
                      invalid={!!s1Errors.work_country_id}
                      onChange={(v) => {
                        setS1(p => ({ ...p, work_country_id: v }));
                        setS1Errors(p => ({ ...p, work_country_id: '' }));
                      }}
                    />
                    {s1Errors.work_country_id && <div className="onb-error-msg">{s1Errors.work_country_id}</div>}
                  </Col>
<Col md={4} data-field="first_name">
  <label className="onb-init-label">
    First Name <span className="req">*</span>
  </label>
  <input
    className={`onb-init-input ${s1Errors.first_name ? 'is-invalid' : ''}`}
    placeholder="First name"
    value={s1.first_name}
    onChange={e => {
      setS1(p => ({ ...p, first_name: e.target.value }));
      setS1Errors(p => ({ ...p, first_name: '' }));
    }}
  />
  {s1Errors.first_name && <div className="onb-error-msg">{s1Errors.first_name}</div>}
</Col>
                  <Col md={4}>
                    <label className="onb-init-label">Middle Name</label>
                    <input className="onb-init-input" placeholder="Middle name (optional)" value={s1.middle_name} onChange={e => setS1(p => ({ ...p, middle_name: e.target.value }))} />
                  </Col>
 <Col md={4} data-field="last_name">
  <label className="onb-init-label">
    Last Name <span className="req">*</span>
  </label>
  <input
    className={`onb-init-input ${s1Errors.last_name ? 'is-invalid' : ''}`}
    placeholder="Last name"
    value={s1.last_name}
    onChange={e => {
      setS1(p => ({ ...p, last_name: e.target.value }));
      setS1Errors(p => ({ ...p, last_name: '' }));
    }}
  />
  {s1Errors.last_name && <div className="onb-error-msg">{s1Errors.last_name}</div>}
</Col>
                  <Col md={4}>
                    <label className="onb-init-label">Display Name <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={[s1.first_name, s1.middle_name, s1.last_name].filter(Boolean).join(' ').trim() || emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Actual Name <span className="auto">LOCKED</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={actualNameSnapshot || emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Gender</label>
                    <MasterSelect options={ONB_GENDER} placeholder="Select gender" value={s1.gender} onChange={(v) => setS1(p => ({ ...p, gender: v }))} />
                  </Col>
{/* Date of Birth */}
<Col md={4} data-field="date_of_birth">
  <label className="onb-init-label">
    Date of Birth <span className="req">*</span>
  </label>
  <MasterDatePicker
    placeholder="Select date of birth"
    value={s1.date_of_birth}
    invalid={!!s1Errors.date_of_birth}
    minDate={dobMin}
    maxDate={dobMax}
    onChange={(v) => {
      setS1(p => ({ ...p, date_of_birth: v }));
      setS1Errors(p => ({ ...p, date_of_birth: '' }));
    }}
  />
  {s1Errors.date_of_birth && <div className="onb-error-msg">{s1Errors.date_of_birth}</div>}
</Col>
                  <Col md={4}>
                    <label className="onb-init-label">Nationality</label>
                    <MasterSelect options={countryOpts} loading={mastersLoading} placeholder="Select nationality" value={s1.nationality_country_id} onChange={(v) => setS1(p => ({ ...p, nationality_country_id: v }))} />
                  </Col>
                </Row>

                <p className="onb-init-subgroup">Contact &amp; Identity</p>
                <Row className="g-3">
                 
{/* Work Email */}
<Col md={4} data-field="email">
  <label className="onb-init-label">
    Work Email <span className="req">*</span>
  </label>
  <input
    type="email"
    className={`onb-init-input ${s1Errors.email ? 'is-invalid' : ''}`}
    placeholder="name@enterprise.com"
    value={s1.email}
    onChange={e => {
      const next = e.target.value;
      setS1(p => {
        // Auto-mirror Work Email → Official Email (Stage 3) for as long
        // as the HR hasn't manually overridden the official one. The
        // "still mirroring" heuristic: official is empty OR equal to the
        // previous work email. Once the HR types a different value into
        // the Stage-3 field, the two diverge and changing Work Email
        // here no longer touches Official Email.
        const stillMirrored =
          !p.official_email || p.official_email === p.email;
        return {
          ...p,
          email: next,
          official_email: stillMirrored ? next : p.official_email,
        };
      });
      setS1Errors(p => ({ ...p, email: '', official_email: '' }));
    }}
  />
  {s1Errors.email && <div className="onb-error-msg">{s1Errors.email}</div>}
</Col>
                 {/* Mobile Number */}
<Col md={4} data-field="mobile">
  <label className="onb-init-label">
    Mobile Number <span className="req">*</span>
  </label>
  <input
    type="tel"
    className={`onb-init-input ${s1Errors.mobile ? 'is-invalid' : ''}`}
    placeholder="+91 XXXXX XXXXX"
    value={s1.mobile}
    onChange={e => {
      // Allow digits, spaces, +, -, ( and ) so users can paste formatted numbers
      setS1(p => ({ ...p, mobile: e.target.value.replace(/[^0-9+\-\s()]/g, '') }));
      setS1Errors(p => ({ ...p, mobile: '' }));
    }}
  />
  {s1Errors.mobile && <div className="onb-error-msg">{s1Errors.mobile}</div>}
</Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee ID <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={`${emp.empId} (auto-assigned)`} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Status</label>
                    <input className="onb-init-input is-autofilled" readOnly value={r.status || 'Inactive'} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Blood Group</label>
                    {/* Static eight-option list (not a master-API call) —
                        blood groups are universal, no need for a server
                        round-trip. Pattern matches ONB_GENDER / ONB_NATIONALITY. */}
                    <MasterSelect
                      options={ONB_BLOOD_GROUP}
                      placeholder="Select blood group"
                      value={s1.blood_group}
                      onChange={(v) => setS1(p => ({ ...p, blood_group: v }))}
                    />
                  </Col>
                </Row>
              </div>
            </div>

            {/* ── Step 2 — Job Details ── */}
            <div className="onb-init-section">
              <div className="onb-init-section-head">
                <span className="onb-init-section-num job">2</span>
                <div className="min-w-0">
                  <h5 className="onb-init-section-title">Job Details</h5>
                  <div className="onb-init-section-sub">Employment, organisational &amp; contract details</div>
                </div>
                <span className="onb-init-section-step job">STEP 2 OF 4</span>
              </div>
              <div className="onb-init-section-body">
                <p className="onb-init-subgroup">Employment Details</p>
                <Row className="g-3">
                  <Col md={4} data-field="date_of_joining">
                    <label className="onb-init-label">Joining Date<span className="req">*</span></label>
                    <MasterDatePicker
                      placeholder="dd-mm-yyyy"
                      value={s1.date_of_joining}
                      invalid={!!s1Errors.date_of_joining}
                      minDate={joinMin}
                      maxDate={joinMax}
                      onChange={(v) => {
                        setS1(p => ({ ...p, date_of_joining: v }));
                        setS1Errors(p => ({ ...p, date_of_joining: '' }));
                      }}
                    />
                    {s1Errors.date_of_joining && <div className="onb-error-msg">{s1Errors.date_of_joining}</div>}
                  </Col>
                  <Col md={4} data-field="department_id"><label className="onb-init-label">Department<span className="req">*</span></label><MasterSelect options={departmentOpts} loading={mastersLoading} placeholder="Select department" value={s1.department_id} invalid={!!s1Errors.department_id} onChange={(v) => { setS1(p => { const mgr = managerOpts.find(m => m.value === p.reporting_manager); const keepMgr = !mgr || mgr.value.startsWith('branch_user:') || (mgr.deptId && mgr.deptId === String(v)); return { ...p, department_id: v, reporting_manager: keepMgr ? p.reporting_manager : '' }; }); setS1Errors(p => ({ ...p, department_id: '', reporting_manager: '' })); }} />{s1Errors.department_id && <div className="onb-error-msg">{s1Errors.department_id}</div>}</Col>
                  <Col md={4} data-field="designation_id"><label className="onb-init-label">Designation<span className="req">*</span></label><MasterSelect options={designationOpts} loading={mastersLoading} placeholder="Select designation" value={s1.designation_id} invalid={!!s1Errors.designation_id} onChange={(v) => { const nowHod = !!hodDesignationId && String(v) === hodDesignationId; setS1(p => { const rmIsBranchUser = String(p.reporting_manager || '').startsWith('branch_user:'); const clearMgr = nowHod && !!p.reporting_manager && !rmIsBranchUser; return { ...p, designation_id: v, reporting_manager: clearMgr ? '' : p.reporting_manager }; }); setS1Errors(p => ({ ...p, designation_id: '', reporting_manager: '' })); }} />{s1Errors.designation_id && <div className="onb-error-msg">{s1Errors.designation_id}</div>}</Col>
                  {/* Primary & Ancillary share the same list, but a role can't be
                      both — exclude the other side's pick from each dropdown. */}
                  <Col md={4} data-field="primary_role_id"><label className="onb-init-label">Primary Role<span className="req">*</span></label><MasterSelect options={roleOpts.filter(o => o.value !== String(s1.ancillary_role_id ?? ''))} loading={mastersLoading} placeholder="Select role" value={s1.primary_role_id} invalid={!!s1Errors.primary_role_id} onChange={(v) => { setS1(p => ({ ...p, primary_role_id: v, ancillary_role_id: String(p.ancillary_role_id ?? '') === v ? '' : p.ancillary_role_id })); setS1Errors(p => ({ ...p, primary_role_id: '' })); }} />{s1Errors.primary_role_id && <div className="onb-error-msg">{s1Errors.primary_role_id}</div>}</Col>
                  <Col md={4}><label className="onb-init-label">Ancillary Role</label><MasterSelect options={roleOpts.filter(o => o.value !== String(s1.primary_role_id ?? ''))} loading={mastersLoading} placeholder="Select role" value={s1.ancillary_role_id} onChange={(v) => setS1(p => ({ ...p, ancillary_role_id: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Work Type <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="Full Time" /></Col>
                </Row>

                <p className="onb-init-subgroup">Organisational Details</p>
                <Row className="g-3">
                  <Col md={4} data-field="legal_entity_id">
                    <label className="onb-init-label">Legal Entity<span className="req">*</span></label>
                    <MasterSelect
                      options={legalEntityOpts}
                      loading={mastersLoading}
                      placeholder="Select entity"
                      value={s1.legal_entity_id}
                      invalid={!!s1Errors.legal_entity_id}
                      onChange={(v) => {
                        // Always overwrite Location with the entity's city —
                        // Location is now a derived, read-only field. Users
                        // change the Legal Entity to change the office.
                        const ent = mLegalEntities.find(le => String(le.id) === String(v));
                        setS1(p => ({ ...p, legal_entity_id: v, location: ent?.city || '' }));
                        setS1Errors(p => ({ ...p, legal_entity_id: '' }));
                      }}
                    />
                    {s1Errors.legal_entity_id && <div className="onb-error-msg">{s1Errors.legal_entity_id}</div>}
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Location <span className="auto">AUTO</span></label>
                    {/* Auto-filled from the selected Legal Entity's city
                        and locked. Editing it created a free-text drift
                        between the entity record and the employee row,
                        which then failed PG validation on save. */}
                    <input
                      className="onb-init-input is-autofilled"
                      readOnly
                      value={s1.location}
                      placeholder={s1.legal_entity_id ? '—' : 'Select a Legal Entity first'}
                    />
                  </Col>
                  <Col md={4} data-field="reporting_manager"><label className="onb-init-label">Reporting Manager<span className="req">*</span></label><MasterSelect options={reportingMgrOpts} loading={mastersLoading} placeholder="Select manager" value={s1.reporting_manager} invalid={!!s1Errors.reporting_manager} onChange={(v) => { const mgr = managerOpts.find(m => m.value === v); setS1(p => ({ ...p, reporting_manager: v, department_id: (mgr && mgr.deptId) ? mgr.deptId : p.department_id })); setS1Errors(p => ({ ...p, reporting_manager: '', department_id: '' })); }} />{s1Errors.reporting_manager && <div className="onb-error-msg">{s1Errors.reporting_manager}</div>}</Col>
                </Row>

                <p className="onb-init-subgroup">Employment Terms</p>
                <Row className="g-3">
                  <Col md={3}><label className="onb-init-label">Probation Policy (Month)<span className="req">*</span></label><MasterSelect options={ONB_PROBATION} value={s1.probation_policy} placeholder="Select months (1–12)" onChange={(v) => setS1(p => ({ ...p, probation_policy: v }))} /></Col>
                  <Col md={3}><label className="onb-init-label">Probation End Date <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly tabIndex={-1} value={onbProbation.endDisplay} placeholder={!s1.date_of_joining ? 'Set joining date' : (onbProbation.months > 0 ? '' : 'No probation')} /></Col>
                  <Col md={3}><label className="onb-init-label">Notice Period<span className="req">*</span></label><MasterSelect options={ONB_NOTICE} value={s1.notice_period} placeholder="Select notice period" onChange={(v) => setS1(p => ({ ...p, notice_period: v }))} /></Col>
                  <Col md={3}><label className="onb-init-label">Work Mode <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="On-site" /></Col>
                </Row>
              </div>
            </div>

            {/* ── Step 3 — Work Details ── */}
            <div className="onb-init-section">
              <div className="onb-init-section-head">
                <span className="onb-init-section-num work">3</span>
                <div className="min-w-0">
                  <h5 className="onb-init-section-title">Work Details</h5>
                  <div className="onb-init-section-sub">Leave, attendance policy &amp; asset allocation</div>
                </div>
                <span className="onb-init-section-step work">STEP 3 OF 4</span>
              </div>
              <div className="onb-init-section-body">
                <p className="onb-init-subgroup">Leave &amp; Attendance</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Leave Plan<span className="req">*</span></label><MasterSelect options={leavePlanOpts} loading={mastersLoading} value={s1.leave_plan} placeholder={leavePlanOpts.length ? 'Select a leave plan' : 'No configured leave plan — finish its setup in HR > Leave'} onChange={(v) => setS1(p => ({ ...p, leave_plan: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Holiday List<span className="req">*</span></label><MasterSelect options={ONB_HOLIDAY} value={s1.holiday_list} placeholder="Select holiday list" onChange={(v) => setS1(p => ({ ...p, holiday_list: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Shift<span className="req">*</span></label><MasterSelect options={ONB_SHIFT} value={s1.shift} placeholder="Select shift" onChange={(v) => setS1(p => ({ ...p, shift: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Weekly Off<span className="req">*</span></label><MasterSelect options={ONB_WEEKLY_OFF} value={s1.weekly_off} placeholder="Select weekly off" onChange={(v) => setS1(p => ({ ...p, weekly_off: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Attendance Number</label><input className="onb-init-input" placeholder="Attendance number" value={s1.attendance_number} onChange={e => setS1(p => ({ ...p, attendance_number: e.target.value }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Overtime</label><MasterSelect options={ONB_OVERTIME} value={s1.overtime} placeholder="Select overtime policy" onChange={(v) => setS1(p => ({ ...p, overtime: v }))} /></Col>
                  <Col md={4} data-field="expense_policy"><label className="onb-init-label">Expense Policy<span className="req">*</span></label><MasterSelect options={ONB_EXPENSE} placeholder="Select policy" value={s1.expense_policy} invalid={!!s1Errors.expense_policy} onChange={(v) => { setS1(p => ({ ...p, expense_policy: v })); setS1Errors(p => ({ ...p, expense_policy: '' })); }} />{s1Errors.expense_policy && <div className="onb-error-msg">{s1Errors.expense_policy}</div>}</Col>
                </Row>

                <div
                  className="onb-init-toggle-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setS1(p => ({ ...p, attendance_tracking: !p.attendance_tracking }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setS1(p => ({ ...p, attendance_tracking: !p.attendance_tracking })); } }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`onb-init-toggle${s1.attendance_tracking ? '' : ' off'}`} aria-pressed={s1.attendance_tracking} />
                  <span className="onb-init-toggle-label">Attendance Tracking {s1.attendance_tracking ? 'Enabled' : 'Disabled'}</span>
                </div>

                <p className="onb-init-subgroup">Assets &amp; Security</p>
                <Row className="g-3">
                  {/* Laptop — Yes/No flag + (when Yes) device picker.
                      The picker label shows "Serial Number — Asset Name"
                      and only lists devices not already issued to another
                      employee. */}
                  <Col md={4}>
                    <label className="onb-init-label">Laptop Assigned</label>
                    <MasterSelect
                      options={ONB_YES_NO}
                      value={s1.laptop_assigned || 'No'}
                      onChange={(v) => setS1(p => ({
                        ...p,
                        laptop_assigned: v,
                        // Drop the FK when the admin flips back to No.
                        laptop_master_asset_id: v === 'Yes' ? p.laptop_master_asset_id : '',
                      }))}
                    />
                  </Col>
                  {s1.laptop_assigned === 'Yes' && (
                    <Col md={4}>
                      <label className="onb-init-label">Laptop Device</label>
                      <MasterSelect
                        options={laptopAssets}
                        loading={assetsLoading}
                        placeholder={laptopAssets.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                        value={s1.laptop_master_asset_id}
                        onChange={(v) => setS1(p => ({ ...p, laptop_master_asset_id: v }))}
                        disabled={!assetsLoading && laptopAssets.length === 0}
                      />
                    </Col>
                  )}

                  {/* Mobile — same Yes/No + picker pattern. */}
                  <Col md={4}>
                    <label className="onb-init-label">Mobile Assigned</label>
                    <MasterSelect
                      options={ONB_YES_NO}
                      value={s1.mobile_assigned || 'No'}
                      onChange={(v) => setS1(p => ({
                        ...p,
                        mobile_assigned: v,
                        mobile_master_asset_id: v === 'Yes' ? p.mobile_master_asset_id : '',
                      }))}
                    />
                  </Col>
                  {s1.mobile_assigned === 'Yes' && (
                    <Col md={4}>
                      <label className="onb-init-label">Mobile Device</label>
                      <MasterSelect
                        options={mobileAssets}
                        loading={assetsLoading}
                        placeholder={mobileAssets.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                        value={s1.mobile_master_asset_id}
                        onChange={(v) => setS1(p => ({ ...p, mobile_master_asset_id: v }))}
                        disabled={!assetsLoading && mobileAssets.length === 0}
                      />
                    </Col>
                  )}

                  {/* Other Assets — multi-select, optional. Lists every
                      master asset NOT in the Laptop / Mobile system
                      categories and not already booked by another
                      employee. */}
                  <Col md={8}>
                    <label className="onb-init-label">Other Assets</label>
                    <MasterMultiSelect
                      options={otherAssets}
                      placeholder={otherAssets.length === 0 ? 'No other assets available' : 'Pick one or more (optional)'}
                      value={s1.other_master_asset_ids}
                      onChange={(vs) => setS1(p => ({ ...p, other_master_asset_ids: vs }))}
                      disabled={otherAssets.length === 0}
                    />
                  </Col>

                  <Col md={4}><label className="onb-init-label">Access Card</label><MasterSelect options={ONB_ACCESS_CARD} defaultValue="Not Issued" /></Col>
                  <Col md={4}>
                    <label className="onb-init-label">Desk / Workstation</label>
                    <input
                      className="onb-init-input"
                      placeholder="e.g. A-12"
                      value={s1.desk_workstation_no}
                      onChange={e => setS1((p: any) => ({ ...p, desk_workstation_no: e.target.value }))}
                    />
                  </Col>
                </Row>
              </div>
            </div>

            {/* ── Step 4 — Compensation ── */}
            <div className="onb-init-section">
              <div className="onb-init-section-head">
                <span className="onb-init-section-num comp">4</span>
                <div className="min-w-0">
                  <h5 className="onb-init-section-title">Compensation</h5>
                  <div className="onb-init-section-sub">Payroll configuration, salary &amp; statutory settings</div>
                </div>
                <span className="onb-init-section-step comp">STEP 4 OF 4</span>
              </div>
              <div className="onb-init-section-body">
                <div
                  className="onb-init-toggle-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setS1(p => ({ ...p, enable_payroll: !p.enable_payroll }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setS1(p => ({ ...p, enable_payroll: !p.enable_payroll })); } }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`onb-init-toggle${s1.enable_payroll ? '' : ' off'}`} aria-pressed={s1.enable_payroll} />
                  <span className="onb-init-toggle-label">{s1.enable_payroll ? 'Payroll enabled for this employee' : 'Enable payroll for this employee'}</span>
                </div>

                <p className="onb-init-subgroup">Payroll Configuration</p>
                <Row className="g-3">
                  {/* Compensation - Annual Salary.
                      Backed by Postgres numeric(14, 2) — max value
                      999,999,999,999.99 (12 whole digits + 2 decimal).
                      We cap on input so the user can't type a 30-digit
                      number that JS would silently convert to scientific
                      notation, which then crashed PG with "numeric field
                      overflow". The validator gives the friendly error. */}
<Col md={4} data-field="annual_salary">
  <label className="onb-init-label">
    Annual CTC {s1.enable_payroll !== false && <span className="req">*</span>}
  </label>
  <input
    className={`onb-init-input ${s1Errors.annual_salary ? 'is-invalid' : ''}`}
    placeholder="Enter amount"
    inputMode="decimal"
    value={s1.annual_salary}
    onChange={e => {
      // Strip everything that isn't a digit or a dot. Collapse multiple
      // dots to the first one. Cap whole part at 12 digits, fractional
      // part at 2 digits. Result is always a valid representation of a
      // value ≤ 999,999,999,999.99 — no further client-side coercion
      // needed before sending.
      let raw = e.target.value.replace(/[^0-9.]/g, '');
      const firstDot = raw.indexOf('.');
      if (firstDot !== -1) {
        raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
      }
      const [whole, frac] = raw.split('.');
      let capped = (whole || '').slice(0, 12);
      if (frac !== undefined) capped += '.' + frac.slice(0, 2);
      setS1(p => ({ ...p, annual_salary: capped }));
      setS1Errors(p => ({ ...p, annual_salary: '' }));
    }}
  />
  {s1Errors.annual_salary && <div className="onb-error-msg">{s1Errors.annual_salary}</div>}
</Col>
                  <Col md={4} data-field="salary_effective_from">
  <label className="onb-init-label">
    Salary Effective From {s1.enable_payroll !== false && <span className="req">*</span>}
  </label>
  <MasterDatePicker
    placeholder="Select effective date"
    value={s1.salary_effective_from}
    invalid={!!s1Errors.salary_effective_from}
    minDate={salaryMin}
    maxDate={salaryMax}
    onChange={(v) => {
      setS1(p => ({ ...p, salary_effective_from: v }));
      setS1Errors(p => ({ ...p, salary_effective_from: '' }));
    }}
  />
  {s1Errors.salary_effective_from && <div className="onb-error-msg">{s1Errors.salary_effective_from}</div>}
</Col>
                  {/* PF setup — lives here with the salary so the amount can be
                      previewed in the breakup below. Applicable → on/off gate;
                      Type → Statutory (₹15k cap) vs Standard (full basic). */}
                  {s1.enable_payroll !== false && (
                    <Col md={4} data-field="pf_applicable">
                      <label className="onb-init-label">PF Applicable</label>
                      <MasterSelect
                        options={ONB_YES_NO}
                        value={s1.pf_eligible ? 'Yes' : 'No'}
                        onChange={(v) => setS1(p => ({ ...p, pf_eligible: v === 'Yes' }))}
                      />
                    </Col>
                  )}
                  {s1.enable_payroll !== false && s1.pf_eligible && (
                    <Col md={4} data-field="pf_type">
                      <label className="onb-init-label">PF Type</label>
                      <MasterSelect
                        options={ONB_PF_TYPE}
                        value={s1.pf_type || 'Statutory'}
                        onChange={(v) => setS1(p => ({ ...p, pf_type: v }))}
                      />
                    </Col>
                  )}
                </Row>

                <div className="onb-init-breakup">
                  <div className="onb-init-breakup-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <i className="ri-grid-line" style={{ color: '#7c3aed' }} />
                      Salary Breakup
                    </span>
                    {/* Detailed Breakup toggle — when on, the monthly component
                        split (Basic / HRA / Special + PF) replaces the simple
                        Regular + Bonus summary. Bound to s1.detailed_breakup,
                        which round-trips through the saveStage1 payload. */}
                    <span className="d-inline-flex align-items-center gap-2" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--vz-secondary-color)' }}>
                      <button
                        type="button"
                        aria-pressed={s1.detailed_breakup}
                        onClick={() => setS1(p => ({ ...p, detailed_breakup: !p.detailed_breakup }))}
                        className="btn p-0 border-0 d-inline-flex align-items-center"
                        style={{
                          width: 36, height: 20, borderRadius: 999,
                          background: s1.detailed_breakup ? '#0ab39c' : '#e5e7eb',
                          position: 'relative', transition: 'background .15s ease', cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            width: 14, height: 14, borderRadius: '50%', background: '#fff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                            position: 'absolute', top: 3,
                            left: s1.detailed_breakup ? 19 : 3, transition: 'left .15s ease',
                          }}
                        />
                      </button>
                      <span
                        onClick={() => setS1(p => ({ ...p, detailed_breakup: !p.detailed_breakup }))}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        Detailed breakup
                      </span>
                    </span>
                  </div>
                  <div className="onb-init-breakup-body">
                    <p className="onb-init-breakup-sub">Salary Effective From</p>
                    <div className="text-muted mb-2" style={{ fontSize: 12 }}>
                      {s1.salary_effective_from ? new Date(s1.salary_effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </div>
                    {/* Salary breakup is computed live from the entered
                        Annual Salary. Bonus stays 0 until the "+ Add Bonus"
                        flow captures real bonus components — when the
                        "Bonus included in annual salary" flag is on, we
                        treat the annual figure as the full CTC and split
                        ~10% as bonus for the visual; everything else stays
                        regular salary. Refine when real bonus inputs land. */}
                    {(() => {
                      // Respect the Period: 'Per month' means the entered figure
                      // is the MONTHLY amount → annual = ×12. Any other period is
                      // treated as the annual figure. Mirrors HrEmployees'
                      // monthlyGrossFromSalary so both screens show the same gross.
                      const entered = s1.annual_salary === '' ? 0 : Number(s1.annual_salary);
                      const annual = (s1.salary_frequency === 'Per month') ? entered * 12 : entered;
                      const bonus  = s1.bonus_in_annual ? Math.round(annual * 0.10) : 0;
                      const regular = annual - bonus;
                      const total = regular + bonus;
                      const fmt = (n: number) => `INR ${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN')}`;

                      // Simple view — Regular + Bonus = Total CTC (annual).
                      if (!s1.detailed_breakup) {
                        return (
                          <div className="onb-init-breakup-grid">
                            <div className="onb-init-breakup-cell"><div className="l">Regular Salary</div><div className="v">{fmt(regular)}</div></div>
                            <span className="onb-init-breakup-op">+</span>
                            <div className="onb-init-breakup-cell"><div className="l">Bonus</div><div className="v">{fmt(bonus)}</div></div>
                            <span className="onb-init-breakup-op">=</span>
                            <div className="onb-init-breakup-cell total"><div className="l">Total CTC</div><div className="v">{fmt(total)}</div></div>
                          </div>
                        );
                      }

                      // Detailed view — PREFER the employee's SAVED salary
                      // structure (the exact components HR entered/edited in the
                      // employee form). Only fall back to a 50/30/20 auto-split
                      // from the salary when nothing has been saved yet, so a
                      // breakup edited in the employee form reflects here too.
                      const useSaved = !!savedBreakup && savedBreakup.earnings.length > 0;
                      const earnLines: { label: string; value: number }[] = useSaved
                        ? savedBreakup!.earnings.map((c: any) => ({ label: c.label || c.code || 'Component', value: Number(c.amount) || 0 }))
                        : (() => {
                            const g = Math.round(regular / 12);
                            const b = Math.round(g * 0.5), h = Math.round(g * 0.3);
                            return [
                              { label: 'Basic Salary', value: b },
                              { label: 'House Rent Allowance', value: h },
                              { label: 'Special Allowance', value: Math.max(0, g - b - h) },
                            ];
                          })();
                      const monthlyGross = earnLines.reduce((s, l) => s + l.value, 0);
                      const basic = useSaved
                        ? Number(savedBreakup!.earnings.find((c: any) => c.code === 'basic')?.amount ?? earnLines[0]?.value ?? 0)
                        : (earnLines[0]?.value ?? 0);
                      // Statutory caps basic at the ₹15k EPF ceiling; Standard uses full basic.
                      const pf = s1.pf_eligible
                        ? Math.round((s1.pf_type === 'Standard' ? basic : Math.min(basic, 15000)) * 0.12)
                        : 0;
                      const fixedDed = useSaved ? savedBreakup!.deductions.reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0) : 0;
                      const net = Math.max(0, monthlyGross - pf - fixedDed);
                      const ctcAnnual = useSaved ? monthlyGross * 12 : total;
                      const Line = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px dashed var(--vz-border-color, #e5e7eb)' }}>
                          <span style={{ fontSize: 12.5, fontWeight: strong ? 700 : 500 }}>{label}</span>
                          <span style={{ fontSize: 13, fontWeight: strong ? 800 : 600 }}>{fmt(value)}</span>
                        </div>
                      );
                      return (
                        <div>
                          <p className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                            {useSaved
                              ? "Monthly component breakup — the employee's saved salary structure."
                              : 'Monthly component breakup (auto-split from the annual salary).'}
                          </p>
                          {/* How the split + PF are derived, so anyone reading
                              the breakup understands the figures. */}
                          <ul style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7, paddingLeft: 16, marginBottom: 10 }}>
                            <li><strong>Basic Salary</strong> — 50% of the monthly gross (statutory minimum, Code on Wages 2019).</li>
                            <li><strong>House Rent Allowance (HRA)</strong> — 30% of the monthly gross.</li>
                            <li><strong>Special Allowance</strong> — the remaining balance after Basic + HRA.</li>
                            <li><strong>PF Deduction</strong> — 12% of basic; capped at <strong>₹15,000</strong> for <strong>Statutory</strong>, or on the <strong>full basic</strong> for <strong>Standard</strong> (set by <em>PF Type</em> above).</li>
                          </ul>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#108548', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 2 }}>Earnings</div>
                              {earnLines.map((l, i) => <Line key={i} label={l.label} value={l.value} />)}
                              <Line label="Gross (Monthly)" value={monthlyGross} strong />
                            </div>
                            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: .4 }}>Deductions</span>
                                {/* PF on/off is now the "PF Applicable" field above. */}
                                {s1.pf_eligible && (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6d28d9' }}>
                                    PF: {s1.pf_type === 'Standard' ? 'Standard (full basic)' : 'Statutory (₹15k cap)'}
                                  </span>
                                )}
                              </div>
                              <Line label="Provident Fund (PF)" value={pf} />
                              {useSaved && savedBreakup!.deductions.map((c: any, i: number) => (
                                <Line key={`d${i}`} label={c.label || c.code || 'Deduction'} value={Number(c.amount) || 0} />
                              ))}
                              <Line label="Net Pay (Monthly)" value={net} strong />
                              <Line label="Total CTC (Annual)" value={ctcAnnual} strong />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Static placeholders that follow are no longer needed
                        — the live grid above replaces the hard-coded
                        "INR 0" cells. Kept as inert markup below to
                        preserve the existing closing tags + spacing. */}
                    <div style={{ display: 'none' }}>
                      <span className="onb-init-breakup-op">=</span>
                      <div className="onb-init-breakup-cell total"><div className="l">Total CTC</div><div className="v">INR 0</div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </>
            )}
            </fieldset>
          </div>
        </div>

        {/* Footer */}
        <div className="onb-init-footer">
          <span className="onb-init-footer-meta">
            <i className="ri-information-line" />
            Stage {activeStage} of 6 — {ONB_STAGES[activeStage - 1].stage}
            {activeStage === 2 && (
              <span style={{ marginLeft: 10, fontSize: 11.5, color: stage2Done ? '#0a8a78' : '#a4661c' }}>
                · {stage2Uploaded}/{stage2Total} required documents {stage2Done ? '✓' : ''}
              </span>
            )}
            {activeStage === 4 && (
              <span style={{ marginLeft: 10, fontSize: 11.5, color: stage4Done ? '#0a8a78' : '#a4661c' }}>
                · {stage4Pass}/{stage4Total4} readiness checks {stage4Done ? '✓' : ''}
              </span>
            )}
          </span>
<div className="d-flex align-items-center gap-2">
  <button
    type="button"
    className="onb-init-btn-ghost"
    disabled={
      (activeStage === 1 && s1Saving) ||
      (activeStage === 3 && s1Saving) ||
      (activeStage === 4 && s4Saving)
    }
    onClick={() => { void goToStage(activeStage - 1); }}
  >
    <i className="ri-arrow-left-s-line" /> Previous
  </button>
  
  {/* Save Draft — Stage 1 saves the wizard payload + bumps
      wizard_step_completed to 4. Stage 4 saves the finance
      payload + stamps stage4_completed_at when all readiness
      checks pass. Other stages have no bound state yet, so
      the button is disabled there. */}
  <button
    type="button"
    className="onb-init-btn-outline"
    // Tooltip makes the disabled state self-explanatory: stages 2 / 5 / 6
    // have no draftable form (docs upload instantly, policies & final
    // verification are action-driven), so there's nothing for Save Draft to
    // persist. Without this the greyed button gave no reason on hover.
    title={
      (activeStage !== 1 && activeStage !== 3 && activeStage !== 4)
        ? 'Nothing to save as a draft on this stage — use the actions above, then Next Stage / Complete Onboarding.'
        : 'Save your progress so far without marking the stage complete.'
    }
    disabled={
      (activeStage === 1 && s1Saving) ||
      (activeStage === 3 && s1Saving) ||
      (activeStage === 4 && s4Saving) ||
      (activeStage !== 1 && activeStage !== 3 && activeStage !== 4)
    }
    onClick={() => {
      /* Save Draft = "persist whatever the user has typed so far, even
       * if incomplete." Bypassing validation here is intentional:
       *   - skipValidate=true → required-field gates don't block the PUT
       *   - markComplete=false → wizard_step_completed is NOT bumped,
       *     so the row still shows In Progress and the user has to
       *     hit Next Stage (which runs full validation) to mark Stage 1
       *     officially done.
       * Previously Save Draft called saveStage1(true), which forced full
       * validation — if any required field was empty the PUT never fired
       * and the user's partial input disappeared on close. */
      if (activeStage === 1) return saveStage1(false, true);
      // Stage 3 saves the asset edits too (no wizard bump). skipValidate
      // already applied there.
      if (activeStage === 3) return saveStage1(false, true);
      if (activeStage === 4) return saveStage4(stage4Pass === stage4Total4);
    }}
  >
    {activeStage === 1 ? (s1Saving ? 'Saving…' : 'Save Draft')
      : activeStage === 3 ? (s1Saving ? 'Saving…' : 'Save Draft')
      : activeStage === 4 ? (s4Saving ? 'Saving…' : 'Save Draft')
      : 'Save Draft'}
  </button>
  
{activeStage < 6 ? (
  <button
    type="button"
    className="onb-init-btn-next"
    disabled={
      (activeStage === 1 && s1Saving) ||
      (activeStage === 3 && s1Saving) ||
      (activeStage === 4 && s4Saving)
    }
    onClick={async () => {
      // Stage 1: validate required fields and save before advancing
      if (activeStage === 1) {
        if (!validateStage1()) return;
        setNextLoading(true);
        const ok = await saveStage1(true);
        setNextLoading(false);
        if (!ok) return;
      }

      // Stage 4: validate and save before advancing. Previously this
      // saved regardless of validity and then unconditionally moved
      // to Stage 5, so users could skip past missing bank / PAN / PF
      // entries and only hit errors at final submission. Now block
      // the advance unless every readiness check is green.
      if (activeStage === 4) {
        if (stage4Pass !== stage4Total4 || !stage4UanOk) {
          setS4ShowErrors(true);   // light up the missing/invalid fields
          toast.error(
            'Compensation — complete required fields',
            'Bank details, PAN, CTC and PF deduction must all be filled before moving to policies.',
          );
          return;
        }
        setNextLoading(true);
        const ok = await saveStage4(true);
        setNextLoading(false);
        if (!ok) return;
      }

      // Stage 3 — the provisioning fields (official_email, laptop /
      // mobile / other-asset assignments, biometric_status, etc.) all
      // live on the same `s1` state that saveStage1 persists. Without
      // an explicit save here, anything the user typed on Stage 3
      // vanished when the modal closed — saveStage1 didn't get called
      // since the user wasn't on Stage 1. Re-using saveStage1 keeps
      // the PUT payload identical (so the existing validator on the
      // backend handles everything correctly).
      if (activeStage === 3) {
        // Official email is mandatory on Stage 3 — it's what the rest
        // of the platform (notifications, account provisioning, signing
        // flows) uses to reach the employee. Validate before saving so
        // the user gets immediate feedback instead of a backend error.
        const emailErr = validateOfficialEmail(s1.official_email);
        if (emailErr) {
          toast.error('Official email — fix this first', emailErr);
          setS1Errors(p => ({ ...p, official_email: emailErr }));
          const el = document.getElementById('field-official-email') as HTMLInputElement | null;
          el?.focus();
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        setNextLoading(true);
        // skipValidate=true — we don't want to re-run Stage 1's required-
        // field checks here; the user is on Stage 3 and might be editing
        // an employee record whose Stage 1 has gaps. The backend
        // validator still gates per-field correctness on the PUT.
        const ok = await saveStage1(false, true);
        if (!ok) { setNextLoading(false); return; }
        await bumpMacroStage(3);
        setNextLoading(false);
        toast.success('Stage 3 saved', 'Provisioning & asset details persisted.');
      }

      // For stages 2, 5 — bump the server-side macro watermark so
      // profile% climbs (formula reads onboarding_stage_completed) and
      // every stage ≤ N flips to "Completed" via the macroCompleted
      // floor in stagesView. Without this, the wizard advanced visually
      // but the backend stayed stuck at macro=1, so the user saw
      // "Profile: 17% complete" even after walking through every step.
      if (activeStage === 2 || activeStage === 5) {
        // Stage 2 — Yes/No on previous employment is mandatory. We
        // gate the advance here (not in flush) so the user gets a
        // clear "pick one" prompt + red highlight on the radio group
        // instead of silently progressing on a half-answered form.
        if (activeStage === 2 && !stage2Ref.current?.validate()) {
          toast.error(
            'Previous employment — incomplete',
            'Complete the highlighted fields & documents (or pick Yes / No) before moving to the next stage.',
          );
          return;
        }
        // Stage 5 — every policy must be acknowledged. Block the
        // advance to verification otherwise; the user would just hit
        // the same blocker at final submission.
        // if (activeStage === 5 && !stage5IsDone) {
        //   toast.error(
        //     'Policies — acknowledge to continue',
        //     'Tick every policy checkbox before moving to verification.',
        //   );
        //   return;
        // }
        setNextLoading(true);
        // Flush any typed-but-unblurred Previous-Employment rows before
        // we advance — same fix as the Previous / sidebar navigation.
        if (activeStage === 2) {
          await stage2Ref.current?.flush();
        }
        await bumpMacroStage(activeStage);
        setNextLoading(false);
      }

      // Move to next stage
      setActiveStage(activeStage + 1);
    }}
  >
    {nextLoading ? (
      <>
        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style={{ width: '0.8rem', height: '0.8rem' }} />
        Loading...
      </>
    ) : (
      <>
        Next Stage <i className="ri-arrow-right-s-line" />
      </>
    )}
  </button>
) : (
  (() => {
    // Gate on the same per-stage flags the sidebar uses to render
    // "Completed". If any of Stage 1–5 is still Pending / In Progress
    // (typically Stage 2 because required docs are missing), block the
    // completion modal and tell the HR which stage(s) to finish first.
    const pending: string[] = [];
    if (!stage1IsDone) pending.push('Onboarding Setup');
    if (!stage2IsDone) pending.push('Document Management');
    if (!stage3IsDone) pending.push('Provisioning & Asset Setup');
    if (!stage4IsDone) pending.push('Payroll & Finance');
    if (!stage5IsDone) pending.push('Policies & Agreements');
    const blocked = pending.length > 0;
    return (
      <button
        type="button"
        className="onb-init-btn-complete"
        disabled={nextLoading || blocked}
        style={
          nextLoading
            ? { opacity: 0.85, cursor: 'progress' }
            : (blocked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined)
        }
        title={
          blocked
            ? `Cannot complete — finish: ${pending.join(', ')}`
            : undefined
        }
        onClick={() => {
          if (nextLoading) return;
          if (blocked) {
            toast.error(
              'Cannot complete onboarding',
              `Finish the pending stage${pending.length > 1 ? 's' : ''} first: ${pending.join(', ')}.`
            );
            return;
          }
          setShowCompleteConfirm(true);
        }}
      >
        {nextLoading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style={{ width: '0.8rem', height: '0.8rem' }} />
            Completing...
          </>
        ) : (
          <>
            <i className={blocked ? 'ri-lock-line' : 'ri-checkbox-circle-line'} /> Complete Onboarding
          </>
        )}
      </button>
    );
  })()
)}
</div>
        </div>
      </ModalBody>

      {/* Confirmation popup — stamps macro stage at 6, which is hard to
          reverse without a manual DB edit. Two-step click guards against
          accidental completion, with an optional notes field captured
          alongside the completion event. */}
      <Modal
        isOpen={showCompleteConfirm}
        toggle={() => { if (!nextLoading) { setShowCompleteConfirm(false); setCompleteNotes(''); } }}
        centered
        size="md"
        backdrop="static"
        keyboard={!nextLoading}
        contentClassName="onb-complete-confirm"
      >
        {/* Header strip — green-to-emerald gradient with white checkmark */}
        <div className="occ-head">
          <div className="occ-icon"><i className="ri-checkbox-circle-line" /></div>
          <div className="occ-titles">
            <h5 className="occ-title">Complete onboarding</h5>
            <p className="occ-sub">All stages signed off — confirm to lock in completion</p>
          </div>
          {/* No top-right X — Cancel button below is the single
              dismissal path; two close affordances was redundant. */}
        </div>

        {/* Body */}
        <div className="occ-body">
          <p className="occ-summary">
            <strong>{emp?.name}</strong>
            <span className="occ-summary-sub"> · {emp?.empId}</span>
          </p>
          <p className="occ-warning">
            <i className="ri-information-line" /> Profile completion will lock at 100% and the wizard will close.
          </p>

          <label className="occ-label" htmlFor="occ-notes">
            Completion Notes <span className="occ-optional">Optional</span>
          </label>
          <textarea
            id="occ-notes"
            className="occ-textarea"
            placeholder="Add a note about this completion — handover details, special instructions, anything worth remembering."
            value={completeNotes}
            onChange={(e) => setCompleteNotes(e.target.value)}
            rows={3}
            maxLength={500}
            disabled={nextLoading}
          />
          <div className="occ-count">{completeNotes.length}/500</div>
        </div>

        {/* Footer */}
        <div className="occ-footer">
          <button
            type="button"
            className="occ-btn-cancel"
            disabled={nextLoading}
            onClick={() => { setShowCompleteConfirm(false); setCompleteNotes(''); }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="occ-btn-confirm"
            disabled={nextLoading}
            onClick={async () => {
              if (nextLoading) return;
              setNextLoading(true);
              try {
                // Notes are sent in the PUT payload alongside the macro
                // bump. The backend currently strips them at validation
                // (no column yet) — that's intentional; the field is here
                // so the UX is in place when we wire persistence later.
                if (emp?.dbId) {
                  try {
                    await api.put(`/employees/${emp.dbId}`, {
                      onboarding_stage_completed: 6,
                      onboarding_complete_notes: completeNotes.trim() || null,
                    });
                    onSaved?.();
                  } catch { /* fall through to retry via bumpMacroStage */ }
                }
                await Promise.all([
                  bumpMacroStage(6),
                  new Promise(r => setTimeout(r, 350)),
                ]);
                toast.success('Onboarding completed', 'All stages signed off. You can now activate the employee.');
                setShowCompleteConfirm(false);
                setCompleteNotes('');
                onClose();
              } finally {
                setNextLoading(false);
              }
            }}
          >
            {nextLoading ? (
              <>
                <span className="spinner-border spinner-border-sm" style={{ width: 13, height: 13 }} />
                Completing…
              </>
            ) : (
              <>
                <i className="ri-check-line" /> Confirm &amp; Complete
              </>
            )}
          </button>
        </div>

        <style>{`
          .onb-complete-confirm { border-radius: 14px !important; overflow: hidden; border: 0; box-shadow: 0 24px 60px rgba(15,23,42,0.20); }
          .occ-head {
            display: flex; align-items: flex-start; gap: 12px;
            padding: 18px 20px;
            background: linear-gradient(135deg, #059669 0%, #10b981 60%, #34d399 100%);
            color: #fff;
          }
          .occ-icon {
            width: 38px; height: 38px; border-radius: 10px;
            background: rgba(255,255,255,0.20);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 20px; flex-shrink: 0;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
          }
          .occ-titles { flex: 1; min-width: 0; }
          .occ-title { color: #fff; font-size: 16px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
          .occ-sub { color: rgba(255,255,255,0.85); font-size: 12px; margin: 2px 0 0; }
          .occ-close {
            width: 28px; height: 28px; border-radius: 8px;
            background: rgba(255,255,255,0.18); border: 0; color: #fff;
            display: inline-flex; align-items: center; justify-content: center;
            cursor: pointer; transition: background 140ms ease;
          }
          .occ-close:hover { background: rgba(255,255,255,0.30); }

          .occ-body { padding: 18px 20px 8px; background: var(--vz-card-bg); }
          .occ-summary { margin: 0 0 10px; font-size: 14px; color: var(--vz-body-color); }
          .occ-summary strong { color: var(--vz-heading-color, var(--vz-body-color)); font-weight: 700; }
          .occ-summary-sub { color: var(--vz-secondary-color); font-size: 12.5px; }
          .occ-warning {
            display: flex; align-items: center; gap: 6px;
            margin: 0 0 14px; padding: 8px 12px; border-radius: 8px;
            background: rgba(245,158,11,0.10); border: 1px solid rgba(245,158,11,0.30);
            color: #b45309; font-size: 12px; font-weight: 600;
          }
          [data-bs-theme="dark"] .occ-warning,
          [data-layout-mode="dark"] .occ-warning { color: #fcd34d; }
          .occ-warning i { font-size: 14px; }

          .occ-label {
            display: flex; align-items: center; gap: 6px;
            font-size: 11px; font-weight: 800; letter-spacing: 0.5px;
            text-transform: uppercase; color: var(--vz-secondary-color);
            margin: 0 0 6px;
          }
          .occ-optional {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.4px;
            padding: 1px 6px; border-radius: 4px;
            background: var(--vz-secondary-bg); color: var(--vz-secondary-color);
          }
          .occ-textarea {
            width: 100%; padding: 9px 12px; border-radius: 8px;
            border: 1px solid var(--vz-border-color);
            background: var(--vz-card-bg); color: var(--vz-body-color);
            font-size: 13px; line-height: 1.5; resize: vertical;
            min-height: 76px;
            transition: border-color 140ms ease, box-shadow 140ms ease;
          }
          .occ-textarea:focus {
            outline: none;
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16,185,129,0.18);
          }
          .occ-textarea::placeholder { color: var(--vz-secondary-color); opacity: 0.7; }
          .occ-count {
            text-align: right;
            font-size: 10.5px; color: var(--vz-secondary-color);
            margin-top: 4px;
          }

          .occ-footer {
            display: flex; justify-content: flex-end; gap: 8px;
            padding: 12px 20px 18px;
            background: var(--vz-card-bg);
            border-top: 1px solid var(--vz-border-color);
          }
          .occ-btn-cancel,
          .occ-btn-confirm {
            padding: 9px 18px; border-radius: 8px;
            font-size: 13px; font-weight: 600; cursor: pointer;
            transition: all 140ms ease;
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          }
          .occ-btn-cancel {
            background: var(--vz-card-bg);
            border: 1px solid var(--vz-border-color);
            color: var(--vz-body-color);
          }
          .occ-btn-cancel:hover:not(:disabled) {
            background: var(--vz-secondary-bg);
            border-color: var(--vz-border-color);
          }
          .occ-btn-confirm {
            background: linear-gradient(135deg, #059669, #10b981);
            border: 0; color: #fff; font-weight: 700;
            box-shadow: 0 2px 6px rgba(16,185,129,0.30);
          }
          .occ-btn-confirm:hover:not(:disabled) {
            box-shadow: 0 4px 10px rgba(16,185,129,0.40);
            transform: translateY(-1px);
          }
          .occ-btn-cancel:disabled,
          .occ-btn-confirm:disabled { opacity: 0.65; cursor: not-allowed; }
        `}</style>
      </Modal>
    </Modal>
  );
}

// ── Stage 2 — Document Management view (used inside InitiateOnboardingModal)
/** Server-side document row returned by /api/employees/{id}/documents. */
interface ApiDocument {
  id: number;
  document_key: string;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  rejection_reason: string | null;
  uploaded_at: string | null;
  verified_at: string | null;
  uploader: { id: number; name: string } | null;
  verifier: { id: number; name: string } | null;
  url: string | null;
}

/** Map server status → existing UI pill tone key (case difference + Optional fallback). */
const _serverStatusToUi = (s: string): DocStatus => {
  switch (s) {
    case 'verified': return 'Verified';
    case 'uploaded': return 'Uploaded';
    case 'rejected': return 'Rejected';
    default:         return 'Pending';
  }
};

/** Lookup set for the validator. Same data as DOC_ACCEPTED_MIMES,
 *  Set form for O(1) membership checks. */
const DOC_ACCEPTED_MIME = new Set<string>(DOC_ACCEPTED_MIMES);

/** Imperative API the parent calls before navigating away from Stage 2.
 *  flush() persists any company rows the user typed into but never blurred
 *  out of — without this, clicking Next or a sidebar stage chip with focus
 *  still inside Company Name silently dropped the row. */
export interface Stage2DocumentsHandle {
  flush: () => Promise<void>;
  /** Returns true if Stage 2 is ready to advance. Currently gates on
   *  the Yes/No previous-experience answer being explicitly chosen —
   *  null means the HR hasn't picked yet and shouldn't move forward. */
  validate: () => boolean;
}
const Stage2Documents = forwardRef<Stage2DocumentsHandle, {
  emp: OnboardRow;
  /** Fires whenever the document list changes (after upload / replace).
   *  The parent modal uses it to update Stage 2's side-rail progress
   *  without doing its own duplicate fetch. */
  onDocsChanged?: (rows: { document_key: string; status: string }[]) => void;
  /** Live previous-employment progress (required vs uploaded docs) for the
   *  parent's Stage 2 side-rail %, including the in-progress "Yes" answer and
   *  unsaved / 0-doc companies the parent can't otherwise see. */
  onProgress?: (p: { required: number; uploaded: number }) => void;
}>(({ emp, onDocsChanged, onProgress }, ref) => {
  const toast = useToast();

  // ── Previous Employment Companies — backed by /api/employees/{id}/previous-employments
  // Each row owns its own server id (or `null` while it's a draft the
  // user is still typing into; we persist via POST when company_name is
  // entered, then PATCH on subsequent edits). This keeps the UX feeling
  // immediate without needing an explicit "Save" button per row.
  interface PrevCompanyRow {
    id: number | null;            // null = unsaved draft
    company_name: string;
    job_title: string;
    start_date: string;
    end_date: string;
    hr_email_1: string;
    hr_email_2: string;
    contact_number: string;
    _busy?: boolean;              // disable inputs while a save/delete is in flight
    _localKey: string;            // stable React key independent of server id
  }
  const newDraft = (): PrevCompanyRow => ({
    id: null, company_name: '', job_title: '',
    start_date: '', end_date: '',
    hr_email_1: '', hr_email_2: '', contact_number: '',
    _localKey: `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  });
  // Default to an empty list so freshers don't see a phantom "Previous
  // Company 1" row they can't get rid of. The user clicks "Add Previous
  // Company" if they actually had prior employers.
  const [prevCompanies, setPrevCompanies] = useState<PrevCompanyRow[]>([]);
  // Has-experience flag drives the section UI: 'yes' shows the company
  // form, 'no' shows the fresher confirmation. null = user hasn't
  // chosen yet (initial state for an empty list). When the server hands
  // us saved companies we auto-set this to 'yes' so reopening the modal
  // doesn't ask the question again.
  // Default to "No" so the question starts answered (avoids the "Not set"
  // limbo). Load below flips it to "Yes" if the employee actually has prior
  // experience on record.
  const [hasExperience, setHasExperience] = useState<'yes' | 'no' | null>('no');
  // Flipped on by validate() when the parent tries to advance with no
  // Yes/No answer picked. Cleared the moment the HR makes a choice so
  // the red ring doesn't persist after they fix it.
  const [hasExperienceError, setHasExperienceError] = useState(false);
  // Per-company required-field errors, keyed `${_localKey}:${field}`. Set by
  // validate() when the HR tries to advance with the Yes path incomplete;
  // cleared field-by-field as they fix each one (see updateCompany).
  const [compErrors, setCompErrors] = useState<Record<string, string>>({});
  // Server-backed document state, keyed by document_key (O(1) lookup per card).
  // Declared here (before useImperativeHandle) so validate() can depend on it.
  const [docsByKey, setDocsByKey] = useState<Record<string, ApiDocument>>({});

  // Previous-employment progress reported up to the parent so the Stage 2
  // side-rail % reflects the "Yes" answer immediately (each company needs its
  // 4 required docs). "Yes" with zero/unsaved companies still requires one
  // company's worth, so the bar drops below 100% until they're uploaded.
  const prevEmpProgress = useMemo(() => {
    if (hasExperience !== 'yes') return { required: 0, uploaded: 0 };
    const reqDocs = STAGE2_COMPANY_DOCS.filter(d => d.status !== 'Optional');
    const isUp = (s?: string) => s === 'uploaded' || s === 'verified';
    const required = Math.max(prevCompanies.length, 1) * reqDocs.length;
    let uploaded = 0;
    for (const c of prevCompanies) {
      if (c.id == null) continue; // unsaved draft → no docs uploaded yet
      for (const d of reqDocs) {
        const up = d.id === 'salary_slips'
          ? Object.entries(docsByKey).some(([k, v]) =>
              (k === `prev_${c.id}_salary_slips` || k.startsWith(`prev_${c.id}_salary_slips_`)) && isUp(v?.status))
          : isUp(docsByKey[`prev_${c.id}_${d.id}`]?.status);
        if (up) uploaded++;
      }
    }
    return { required, uploaded };
  }, [hasExperience, prevCompanies, docsByKey]);
  useEffect(() => { onProgress?.(prevEmpProgress); }, [prevEmpProgress, onProgress]);

  // Initial-load shimmer. Stage 2 fetches documents + previous-employments on
  // mount; the UI used to render before they resolved, flashing empty/erroring
  // state. Hold a skeleton until BOTH first fetches settle.
  const [docsLoading, setDocsLoading] = useState(true);
  const [prevLoading, setPrevLoading] = useState(true);

  // Hydrate from server every time this stage mounts for this employee.
  // The wizard unmounts the stage when the user navigates forward and
  // re-mounts on revisit, so a per-mount fetch keeps the form in sync
  // with the server (previous bug: when the same emp.dbId remounted,
  // the useEffect didn't re-trigger and the local state was the
  // initial empty array — entered companies appeared "lost"). Adding
  // `prevCompanies.length` to the dep list isn't right either — we
  // explicitly want this to run once per mount.
  useEffect(() => {
    if (!emp?.dbId) { setPrevLoading(false); return; }
    let cancelled = false;
    const hydrate = async () => {
      try {
        // Fetch the company list AND a FRESH copy of the employee in parallel.
        // emp.raw is captured once when the modal opens and is never refreshed,
        // so reading has_prior_experience off it returned a stale value — a
        // "No — fresher" pick (which saves no company rows) reset to unanswered
        // on every revisit. Pull the flag from the live record instead.
        const [r, empFresh] = await Promise.all([
          api.get(`/employees/${emp.dbId}/previous-employments`),
          api.get(`/employees/${emp.dbId}`).catch(() => null),
        ]);
        if (cancelled) return;
        const list: any[] = Array.isArray(r.data) ? r.data : [];
        const freshRaw = (empFresh?.data?.data ?? empFresh?.data ?? (emp as any)?.raw ?? {});
        const flag = freshRaw.has_prior_experience;
        if (list.length === 0) {
          setPrevCompanies([]);
          // Default to "No" unless the server explicitly recorded prior
          // experience — never leave it unset.
          setHasExperience(flag === true ? 'yes' : 'no');
          return;
        }
        // The server returned previous-employment rows, so the answer is
        // unambiguously "Yes" — do NOT defer to the (possibly stale) prop flag.
        // Earlier this read `flag === false ? 'no' : 'yes'`, so when emp.raw
        // still carried an old has_prior_experience=false, the toggle flipped
        // back to "No" on revisit and the rows (gated on hasExperience==='yes')
        // were hidden — making saved companies + docs look lost.
        setHasExperience('yes');
        setPrevCompanies(list.map(p => ({
          id: p.id,
          company_name:   p.company_name   ?? '',
          job_title:      p.job_title      ?? '',
          start_date:     p.start_date     ?? '',
          end_date:       p.end_date       ?? '',
          hr_email_1:     p.hr_email_1     ?? '',
          hr_email_2:     p.hr_email_2     ?? '',
          contact_number: p.contact_number ?? '',
          _localKey:      `pc_${p.id}`,
        })));
      } catch { /* keep empty draft on error */ }
      finally { if (!cancelled) setPrevLoading(false); }
    };
    hydrate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp?.dbId]);

  // Keep an always-fresh snapshot of prevCompanies so the imperative
  // flush() below — AND the deferred persistCompany() calls fired from date
  // pickers — see the latest typed value. Updated SYNCHRONOUSLY here (not via
  // a post-render effect) so a setTimeout(0) persist that runs before React
  // re-renders still reads the just-changed end_date (BUG-093: the end date
  // wasn't being saved because persist read a stale snapshot).
  const prevCompaniesRef = useRef<PrevCompanyRow[]>([]);
  const updateCompany = (key: string, patch: Partial<PrevCompanyRow>) => {
    prevCompaniesRef.current = prevCompaniesRef.current.map(c => (c._localKey === key ? { ...c, ...patch } : c));
    setPrevCompanies(prev => prev.map(c => (c._localKey === key ? { ...c, ...patch } : c)));
    // Clear the validation error for any field the user just edited.
    setCompErrors(prev => {
      if (!Object.keys(prev).length) return prev;
      const next = { ...prev };
      Object.keys(patch).forEach(f => delete next[`${key}:${f}`]);
      return next;
    });
  };

  const addCompany = () => setPrevCompanies(prev => {
    const next = [...prev, newDraft()];
    prevCompaniesRef.current = next;
    return next;
  });
  useEffect(() => { prevCompaniesRef.current = prevCompanies; }, [prevCompanies]);

  /** PATCH/POST a single company row to the server. Called onBlur from
   *  every input so the user never has to click "Save" — typing alone
   *  persists once company_name is non-empty. Returns the canonical
   *  server id (existing or freshly assigned) so callers like the upload
   *  flow can chain on it without waiting for the next React render. */
  const persistCompany = async (key: string): Promise<number | null> => {
    if (!emp?.dbId) return null;
    // Read from the always-current ref (not the closure's possibly-stale
    // `prevCompanies` state) so a persist deferred via setTimeout(0) from a
    // date picker sees the value the user just selected. (BUG-093.)
    const row = prevCompaniesRef.current.find(c => c._localKey === key);
    if (!row || row._busy) return row?.id ?? null;
    if (!row.company_name.trim()) return null; // need a name before we can save
    // Quick email + date sanity checks before round-tripping.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (row.hr_email_1 && !emailRe.test(row.hr_email_1)) {
      toast.error('Invalid HR Email 1', `Please enter a valid email address.`);
      return row.id ?? null;
    }
    if (row.hr_email_2 && !emailRe.test(row.hr_email_2)) {
      toast.error('Invalid HR Email 2', `Please enter a valid email address.`);
      return row.id ?? null;
    }
    if (row.start_date && row.end_date && row.end_date < row.start_date) {
      toast.error('Invalid date range', 'End date cannot be before start date.');
      return row.id ?? null;
    }
    // Phone — accept blank (it's optional) but reject anything outside
    // the ITU-T E.164 7–15 digit window so we don't ship junk like
    // "asas11111111" to the BGV vendor.
    if (row.contact_number.trim()) {
      const phoneDigits = row.contact_number.replace(/\D/g, '');
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        toast.error('Invalid contact number', 'Phone number must be 7 to 15 digits.');
        return row.id ?? null;
      }
    }
    const payload = {
      company_name:   row.company_name.trim(),
      job_title:      row.job_title.trim() || null,
      start_date:     row.start_date || null,
      end_date:       row.end_date   || null,
      hr_email_1:     row.hr_email_1.trim() || null,
      hr_email_2:     row.hr_email_2.trim() || null,
      contact_number: row.contact_number.trim() || null,
    };
    updateCompany(key, { _busy: true });
    try {
      if (row.id) {
        await api.patch(`/previous-employments/${row.id}`, payload);
        return row.id;
      }
      const r = await api.post(`/employees/${emp.dbId}/previous-employments`, payload);
      const newId = r?.data?.previous_employment?.id ?? null;
      updateCompany(key, { id: newId });
      return newId;
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      const firstMsg = apiErrors ? Object.values(apiErrors).flat()[0] : null;
      toast.error('Could not save company', String(firstMsg || err?.response?.data?.message || err?.message || 'Save failed'));
      return row.id ?? null;
    } finally {
      updateCompany(key, { _busy: false });
    }
  };

  /** Flush every typed-but-unsaved company row to the backend. Called by
   *  the parent before navigating away from Stage 2 — onBlur alone isn't
   *  enough because (a) the user may click Next while a field still has
   *  focus, (b) date pickers blur synchronously but the persist is a
   *  microtask, and (c) any in-flight POST needs to finish so the next
   *  hydrate sees the new row. We persist rows that have a non-empty
   *  company_name; empty drafts are intentionally ignored. */
  useImperativeHandle(ref, () => ({
    flush: async () => {
      const rows = prevCompaniesRef.current;
      const work = rows
        .filter(c => c.company_name.trim())
        .map(c => persistCompany(c._localKey));
      await Promise.all(work);
      /* Persist the Yes/No answer onto the employee row so the radio
       * group rehydrates on revisit. Without this, a "No — first job"
       * pick had nowhere to live (no previous_employments rows would be
       * created) and the radio reset to unanswered every time the wizard
       * was reopened. */
      if (emp?.dbId && hasExperience !== null) {
        try {
          await api.put(`/employees/${emp.dbId}`, {
            has_prior_experience: hasExperience === 'yes',
          });
        } catch { /* non-fatal — keep the in-memory state */ }
      }
    },
    validate: () => {
      if (hasExperience === null) {
        setHasExperienceError(true);
        // Bring the radio group into view so the HR can see what's
        // blocking the next-stage advance instead of guessing why
        // nothing happened.
        setTimeout(() => {
          const el = document.getElementById('onb-has-experience');
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        return false;
      }

      // Yes path: at least one company, each fully filled, HR Email 1 set, and
      // the mandatory doc (Last 3 Months Salary Slips) uploaded. The Previous
      // Offer Letter is OPTIONAL (Bug #39) — it must not block saving. Freshers
      // ('no') skip all of this.
      if (hasExperience === 'yes') {
        const companies = prevCompaniesRef.current;
        if (companies.length === 0) {
          setTimeout(() => document.getElementById('onb-has-experience')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
          return false;
        }
        const errs: Record<string, string> = {};
        const isUp = (s?: string) => s === 'uploaded' || s === 'verified';
        const docUploaded = (c: PrevCompanyRow, key: string) => {
          if (!c.id) return false;
          // Salary slips are multi-file (prev_{id}_salary_slips[, _2, _3…]) —
          // satisfied if ANY slip is uploaded.
          if (key === 'salary_slips') {
            return Object.entries(docsByKey).some(([k, v]) =>
              (k === `prev_${c.id}_salary_slips` || k.startsWith(`prev_${c.id}_salary_slips_`)) && isUp(v.status));
          }
          return isUp(docsByKey[`prev_${c.id}_${key}`]?.status);
        };
        companies.forEach(c => {
          const k = c._localKey;
          if (!c.company_name.trim()) errs[`${k}:company_name`] = 'Company name is required';
          if (!c.job_title.trim())    errs[`${k}:job_title`]    = 'Job title is required';
          if (!c.start_date)          errs[`${k}:start_date`]   = 'Start date is required';
          if (!c.end_date)            errs[`${k}:end_date`]     = 'End date is required';
          if (!c.hr_email_1.trim())   errs[`${k}:hr_email_1`]   = 'HR Email ID 1 is required';
          else if (EMAIL_INVALID(c.hr_email_1)) errs[`${k}:hr_email_1`] = 'Enter a valid email address';
          // Previous Offer Letter is optional — only the salary slips are required.
          if (!docUploaded(c, 'salary_slips')) errs[`${k}:doc`] = 'Upload the Last 3 Months Salary Slips';
        });
        if (Object.keys(errs).length) {
          setCompErrors(errs);
          setTimeout(() => {
            const firstKey = Object.keys(errs)[0].split(':')[0];
            document.querySelector(`[data-comp="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
          return false;
        }
        setCompErrors({});
      }
      return true;
    },
  }), [emp?.dbId, hasExperience, docsByKey]);

  /** Upload a document for a previous-employment row. Auto-persists the
   *  company first if it's an unsaved draft — otherwise users who type a
   *  company name and immediately click Upload (without blurring out of
   *  the name field first) would never see an API call because c.id is
   *  still null and the upload key would be malformed. */
  const uploadForCompany = async (
    companyKey: string,
    docId: string,
    docName: string,
    maxMb?: number,
  ) => {
    const row = prevCompanies.find(c => c._localKey === companyKey);
    if (!row) return;
    let pid = row.id;
    if (!pid) {
      if (!row.company_name.trim()) {
        toast.error('Company name required', 'Enter the company name before uploading documents for it.');
        return;
      }
      pid = await persistCompany(companyKey);
      if (!pid) {
        // persistCompany already surfaced its own toast on failure.
        return;
      }
    }
    triggerUpload(`prev_${pid}_${docId}`, docName, DOC_ACCEPT_ATTR, maxMb);
  };

  // ── Delete-confirmation modal target ─────────────────────────────────
  // A single shared DeleteModal handles both flows (doc remove + company
  // remove). The `kind` discriminates so the confirm handler knows which
  // backend call to make.
  type DeleteTarget =
    | { kind: 'doc';     id: number; name: string }
    | { kind: 'company'; key: string; name: string };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const removeCompany = (key: string) => {
    const row = prevCompanies.find(c => c._localKey === key);
    if (!row) return;
    // Empty draft — drop straight away; nothing to confirm. Allow the
    // list to actually become empty so freshers can clear the section.
    if (!row.id && !row.company_name.trim()) {
      setPrevCompanies(prev => prev.filter(c => c._localKey !== key));
      return;
    }
    setDeleteTarget({ kind: 'company', key, name: row.company_name || 'this company' });
  };

  /** Runs the actual delete once the user clicks "Yes, Delete It!" in the
   *  shared velzon DeleteModal. Errors are surfaced via toast; the modal
   *  closes regardless so the user isn't stuck in a confirm loop. */
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'doc') {
        try {
          await api.delete(`/documents/${deleteTarget.id}`);
          await reloadDocs();
          toast.success(`${deleteTarget.name} removed`, 'You can upload a fresh copy whenever you’re ready.');
        } catch (err: any) {
          const msg = err?.response?.data?.message || err?.message || 'Delete failed';
          toast.error(`${deleteTarget.name} could not be removed`, String(msg));
        }
      } else {
        const row = prevCompanies.find(c => c._localKey === deleteTarget.key);
        if (row?.id) {
          try {
            await api.delete(`/previous-employments/${row.id}`);
          } catch (err: any) {
            toast.error('Could not remove', String(err?.response?.data?.message || err?.message || 'Delete failed'));
            return;
          }
        }
        // Same here — let the list become empty so the user can sit in a
        // valid "fresher / no previous employer" state after deleting.
        setPrevCompanies(prev => prev.filter(c => c._localKey !== deleteTarget.key));
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ── Server-backed document state ─────────────────────────────────────
  // (docsByKey moved above the useImperativeHandle so validate() can list it
  // as a dependency without hitting a temporal-dead-zone ReferenceError.)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const reloadDocs = async () => {
    if (!emp?.dbId) { setDocsLoading(false); return; }
    try {
      const r = await api.get(`/employees/${emp.dbId}/documents`);
      const list: ApiDocument[] = Array.isArray(r.data) ? r.data : [];
      const map: Record<string, ApiDocument> = {};
      for (const d of list) map[d.document_key] = d;
      setDocsByKey(map);
      // Bubble the list up so the modal's Stage 2 rail progress + count
      // header refresh together.
      onDocsChanged?.(list.map(d => ({ document_key: d.document_key, status: d.status })));
    } catch { /* keep stale on error */ }
    finally { setDocsLoading(false); }
  };
  useEffect(() => { reloadDocs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [emp?.dbId]);

  /** Open a hidden file picker, validate locally, then POST as multipart.
   *  Validates BEFORE upload so the user gets immediate feedback on
   *  oversized/unsupported files instead of a server round-trip.
   *  `maxMb` overrides DOC_MAX_MB for docs with stricter caps (photos,
   *  ID cards). The backend's ceiling still applies (currently 8 MB). */
  const triggerUpload = (docKey: string, docName: string, accept: string, maxMb?: number) => {
    if (!emp?.dbId) {
      toast.error('Cannot upload', 'Save the employee first — no record id yet.');
      return;
    }
    // Per-doc cap, clamped to the backend ceiling — never let a doc
    // demand more than the server can actually accept.
    const cap = Math.min(maxMb ?? DOC_MAX_MB, DOC_MAX_MB);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      try { document.body.removeChild(input); } catch { /* already removed */ }
      if (!file) return;

      // ── Client-side validation (mirrors backend) ──────────────────
      const maxBytes = cap * 1024 * 1024;
      if (file.size > maxBytes) {
        toast.error(
          `${docName} is too large`,
          `Max allowed is ${cap} MB. Selected file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        );
        return;
      }
      // The browser-supplied MIME isn't 100% reliable; fall back to
      // extension when blank. Both the picker `accept` and this
      // validator pull from the same DOC_ACCEPTED_* constants so they
      // can't drift apart. Either signal matching is enough — file
      // pickers on some platforms strip the MIME, so requiring both
      // would reject legit files.
      const mime = (file.type || '').toLowerCase();
      const ext  = (file.name.split('.').pop() || '').toLowerCase();
      const mimeOk = mime ? DOC_ACCEPTED_MIME.has(mime) : false;
      const extOk  = (DOC_ACCEPTED_EXTS as readonly string[]).includes(ext);
      if (!mimeOk && !extOk) {
        toast.error(
          'Unsupported file type',
          `Only PDF, JPG, PNG and WEBP files are allowed. You selected a "${ext || mime || 'unknown'}" file.`,
        );
        return;
      }

      setUploadingKey(docKey);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('document_key', docKey);
        // IMPORTANT: don't set Content-Type manually for FormData.
        // The api instance's default is 'application/json', so we override
        // with `undefined` to let axios sniff the FormData body and emit
        // the proper `multipart/form-data; boundary=...` header. Setting
        // a bare `multipart/form-data` string strips the boundary,
        // which made the prod backend respond 422 ("file is required")
        // because PHP couldn't parse the body and never saw the upload.
        await api.post(`/employees/${emp.dbId}/documents`, fd, {
          headers: { 'Content-Type': undefined as unknown as string },
        });
        await reloadDocs();
        toast.success(`${docName} uploaded`, 'Awaiting HR verification.');
      } catch (err: any) {
        const msg = err?.response?.data?.message
          || (err?.response?.data?.errors?.file?.[0])
          || err?.message
          || 'Upload failed';
        toast.error(`${docName} upload failed`, String(msg));
      } finally {
        setUploadingKey(null);
      }
    };
    document.body.appendChild(input);
    input.click();
  };

  /** Open the shared velzon DeleteModal. Actual removal happens in
   *  confirmDelete() once the user clicks "Yes, Delete It!". */
  const triggerDelete = (docId: number, docName: string) => {
    setDeleteTarget({ kind: 'doc', id: docId, name: docName });
  };

  /** All catalogue keys (across categories + prev-company docs) — drives totals. */
  // ── Total / uploaded counts ────────────────────────────────────────
  // Catalogue docs (always 10) + per-company docs (4 × companies that
  // are persisted on the server). Draft companies (no id yet) don't add
  // to the total because their docs can't be uploaded yet — they'd
  // permanently bring the % down through no fault of the user.
  const catalogueKeys: string[] = [
    ...STAGE2_CATEGORIES.flatMap(cat => cat.docs.map(d => d.id)),
  ];
  const savedCompanies = prevCompanies.filter(c => c.id !== null);
  const perCompanyKeys: string[] = savedCompanies.flatMap(c =>
    STAGE2_COMPANY_DOCS.map(d => `prev_${c.id}_${d.id}`)
  );
  const allKeys = [...catalogueKeys, ...perCompanyKeys];
  const totalDocs = allKeys.length;
  const uploadedDocs = allKeys
    .map(k => docsByKey[k]?.status)
    .filter(s => s === 'uploaded' || s === 'verified').length;
  const pct = totalDocs ? Math.round((uploadedDocs / totalDocs) * 100) : 0;

  // Initial-load skeleton — unique to Stage 2 (animated category cards) so the
  // documents/previous-employment UI doesn't render against un-fetched data.
  if (docsLoading || prevLoading) {
    return (
      <div className="onb-s2sk">
        {[0, 1, 2].map(i => (
          <div className="onb-s2sk-cat" key={i}>
            <div className="onb-s2sk-head">
              <span className="onb-s2sk-icn onb-s2sk-bar" />
              <span className="onb-s2sk-ttl onb-s2sk-bar" />
              <span className="onb-s2sk-pct onb-s2sk-bar" />
            </div>
            {[0, 1].map(j => (
              <div className="onb-s2sk-row" key={j}>
                <span className="onb-s2sk-dot onb-s2sk-bar" />
                <span className="onb-s2sk-meta onb-s2sk-bar" />
                <span className="onb-s2sk-pill onb-s2sk-bar" />
                <span className="onb-s2sk-act onb-s2sk-bar" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Per-stage progress banner removed — sidebar already shows this. */}

      {/* Status legend */}
      <div className="onb-doc-legend">
        {([
          { l: 'Pending',  c: '#f59e0b' },
          { l: 'Uploaded', c: '#3b82f6' },
          { l: 'Verified', c: '#10b981' },
          { l: 'Rejected', c: '#f06548' },
          { l: 'Optional', c: '#7c5cfc' },
        ]).map(item => (
          <span key={item.l} className="onb-doc-legend-item">
            <span className="dot" style={{ background: item.c }} />
            {item.l}
          </span>
        ))}
      </div>

      {/* Document categories */}
      {STAGE2_CATEGORIES.map(cat => {
        const upTotal = cat.docs.length;
        const upUploaded = cat.docs.filter(d => {
          const srv = docsByKey[d.id]?.status;
          return srv === 'uploaded' || srv === 'verified';
        }).length;
        const catPct = upTotal ? Math.round((upUploaded / upTotal) * 100) : 0;
        return (
          <div key={cat.id} className="onb-doc-cat">
            <div className="onb-doc-cat-head">
              <span className={`onb-doc-cat-icon onb-doc-cat-icon--${cat.id}`} style={{ background: cat.tint, color: cat.fg }}>
                <i className={cat.icon} />
              </span>
              <h6 className="onb-doc-cat-title">{cat.title}</h6>
              <span className="onb-doc-cat-count">{upUploaded} / {upTotal} uploaded</span>
              <span className="onb-doc-cat-pct">{catPct}%</span>
            </div>
            {cat.docs.map(d => {
              // Effective status — server row wins, falls back to the
              // catalogue's intrinsic state ("Optional" rows stay Optional
              // until uploaded; everything else defaults to Pending).
              const srv = docsByKey[d.id];
              const effective: DocStatus = srv
                ? _serverStatusToUi(srv.status)
                : (d.status === 'Optional' ? 'Optional' : 'Pending');
              // Per-doc picker filter. Passport photo: images only.
              // Cheque: images + PDF. Everything else: every accepted
              // type (PDF / JPG / PNG / WEBP). Previously this used
              // "image/*" which let the OS dialog show BMP / GIF /
              // HEIC / SVG — the user could pick one, and the backend
              // would reject with "Only PDF / JPG / PNG / WEBP files
              // are allowed" because no client guard had caught it yet.
              const accept = /^photo$/i.test(d.id)
                ? 'image/jpeg,image/png'
                : /cheque/i.test(d.id)
                  ? 'image/jpeg,image/png,application/pdf'
                  : DOC_ACCEPT_ATTR;
              const isBusy = uploadingKey === d.id;
              return (
                <div key={d.id} className="onb-doc-row">
                  <span className="onb-doc-row-icon"><i className="ri-file-text-line" /></span>
                  <div className="onb-doc-row-meta">
                    <h6 className="onb-doc-row-name">
                      {d.name}
                      {d.status === 'Optional' && <span className="onb-doc-tag">Optional</span>}
                    </h6>
                    <p className="onb-doc-row-sub">
                      {d.sub}
                      {srv?.original_name && <> · <strong>{srv.original_name}</strong></>}
                      {srv?.rejection_reason && <> · <span style={{ color: '#b1401d' }}>Reason: {srv.rejection_reason}</span></>}
                    </p>
                  </div>
                  <span className={`onb-doc-status-pill onb-doc-status-pill--${String(effective).toLowerCase()}`}>
                    {effective}
                  </span>
                  {srv?.url && (
                    <Tooltip label={`Preview ${d.name}`}>
                      <a
                        href={srv.url}
                        target="_blank"
                        rel="noreferrer"
                        className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-view"
                      >
                        <i className="ri-eye-line" /> View
                      </a>
                    </Tooltip>
                  )}
                  <Tooltip label={isBusy ? 'Uploading…' : (srv ? `Replace ${d.name}` : `Upload ${d.name}`)}>
                    <button
                      type="button"
                      className="onb-doc-upload-btn"
                      onClick={() => triggerUpload(d.id, d.name, accept, d.maxMb)}
                      disabled={isBusy}
                      style={isBusy ? { opacity: 0.6, cursor: 'progress' } : undefined}
                    >
                      <i className={`${isBusy ? 'ri-loader-4-line onb-spin' : 'ri-upload-cloud-2-line'}`} />
                      {isBusy ? 'Uploading…' : (srv ? 'Replace' : 'Upload')}
                    </button>
                  </Tooltip>
                  {srv && (
                    <Tooltip label="Remove this document">
                      <button
                        type="button"
                        className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-del"
                        onClick={() => triggerDelete(srv.id, d.name)}
                      >
                        <i className="ri-delete-bin-line" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Previous Employment Documents — optional. A fresher with no
          prior employer simply leaves this section empty. Red-outlined when
          the stage-advance validation flags it (mirrors the toast). */}
      <div
        className="onb-doc-prev"
        style={(hasExperienceError || Object.keys(compErrors).length > 0)
          ? { outline: '2px solid #ef4444', outlineOffset: 2, borderRadius: 10 }
          : undefined}
      >
        <div className="onb-doc-prev-head">
          <span className="onb-doc-prev-icon"><i className="ri-briefcase-line" style={{ fontSize: 14 }} /></span>
          <div className="min-w-0 flex-grow-1">
            <h6 className="onb-doc-prev-title">Previous Employment Documents</h6>
          </div>
          <span className="onb-doc-prev-pill">
            {hasExperience === 'no'
              ? 'Fresher'
              : prevCompanies.length === 0
                ? 'Not set'
                : `${prevCompanies.length} ${prevCompanies.length === 1 ? 'Company' : 'Companies'}`}
          </span>
        </div>

        {/* ── Yes / No selector ─────────────────────────────────────────
            Drives whether the experience form renders or the section
            collapses into a fresher confirmation. The two-button radio
            mirrors patterns already used elsewhere in the wizard. */}
        <div id="onb-has-experience" style={{ padding: '14px 14px 0' }}>
          <p className="onb-init-subgroup" style={{ marginBottom: 8 }}>
            Has the employee worked anywhere before? <span className="req">*</span>
          </p>
          <div className="d-flex gap-2 flex-wrap" role="radiogroup" aria-label="Has previous experience" aria-required="true" aria-invalid={hasExperienceError}>
            {([
              { v: 'yes' as const, label: 'Yes — they have prior experience', icon: 'ri-briefcase-line' },
              { v: 'no'  as const, label: 'No — this is their first job',     icon: 'ri-graduation-cap-line' },
            ]).map(opt => {
              const active = hasExperience === opt.v;
              const errored = hasExperienceError && !active;
              // Once a previous company is saved (i.e. the HR picked "Yes" and
              // advanced), they can't flip back to "No — first job" — that would
              // orphan recorded experience. Remove the companies to unlock.
              const locked = opt.v === 'no' && hasExperience === 'yes' && prevCompanies.some(c => c.id);
              return (
                <button
                  key={opt.v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-disabled={locked}
                  title={locked ? 'Remove the previous companies first to switch to “first job”.' : undefined}
                  onClick={() => {
                    if (locked) {
                      toast.warning('Locked', 'Previous experience is already recorded — remove the companies first to switch to “first job”.');
                      return;
                    }
                    setHasExperience(opt.v);
                    setHasExperienceError(false);
                    // Picking "Yes" with an empty list — pre-seed a draft
                    // row so the user has somewhere to type immediately.
                    if (opt.v === 'yes' && prevCompanies.length === 0) {
                      addCompany();
                    }
                  }}
                  style={{
                    flex: '1 1 240px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: `1.5px solid ${active ? '#7c3aed' : errored ? '#ef4444' : 'var(--vz-border-color)'}`,
                    background: active ? 'rgba(124,58,237,0.08)' : errored ? 'rgba(239,68,68,0.04)' : 'var(--vz-card-bg)',
                    color: active ? '#5a3fd1' : 'var(--vz-body-color)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: locked ? 'not-allowed' : 'pointer',
                    opacity: locked ? 0.5 : 1,
                    transition: 'all .15s ease',
                  }}
                >
                  <span style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: `2px solid ${active ? '#7c3aed' : '#cbd5e1'}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed' }} />}
                  </span>
                  <i className={opt.icon} style={{ fontSize: 16 }} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          {hasExperienceError && (
            <div
              role="alert"
              style={{
                marginTop: 8,
                fontSize: 12,
                fontWeight: 600,
                color: '#dc2626',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
              Please select Yes or No to continue.
            </div>
          )}
        </div>

        {/* ── Fresher confirmation banner — shown when user picked "No" */}
        {hasExperience === 'no' && (
          <div
            className="onb-doc-bgv-banner"
            style={{ margin: '12px 14px' }}
          >
            <i className="ri-checkbox-circle-line" style={{ fontSize: 15, flexShrink: 0 }} />
            <span>
              <strong>Marked as fresher.</strong> No previous employer documents
              are required. You can change this anytime by selecting <strong>Yes</strong> above.
            </span>
          </div>
        )}

        {/* Experience form (companies + docs) — rendered only when the
            user has explicitly answered Yes. */}
        {hasExperience === 'yes' && prevCompanies.map((c, idx) => {
          // Per-company doc upload key — namespaced so each row has its
          // own slots in the employee_documents table without colliding
          // with the catalogue keys.
          const docKeyFor = (k: string) => c.id ? `prev_${c.id}_${k}` : '';
          const compDocsTotal = STAGE2_COMPANY_DOCS.length;
          const compDocsUploaded = c.id
            ? STAGE2_COMPANY_DOCS.filter(d => {
                // Salary slips: multi-file — count the slot done if ANY slip exists.
                if (d.id === 'salary_slips') {
                  return Object.entries(docsByKey).some(([k, v]) =>
                    (k === `prev_${c.id}_salary_slips` || k.startsWith(`prev_${c.id}_salary_slips_`)) &&
                    (v.status === 'uploaded' || v.status === 'verified'));
                }
                const srv = docsByKey[docKeyFor(d.id)]?.status;
                return srv === 'uploaded' || srv === 'verified';
              }).length
            : 0;
          return (
          <div key={c._localKey} className="onb-doc-comp" data-comp={c._localKey}>
            <div className="onb-doc-comp-head">
              <span className="onb-doc-comp-num">{idx + 1}</span>
              <h6 className="onb-doc-comp-name">{c.company_name || `Previous Company ${idx + 1}`}</h6>
              <span className="onb-doc-comp-count">{compDocsUploaded}/{compDocsTotal} Docs</span>
              {/* Always-visible remove button — the user is allowed to
                  clear every previous-employer row (e.g. fresher who
                  added a company by mistake). The list is now allowed
                  to be empty. */}
              <Tooltip label={`Remove ${c.company_name || 'this company'}`}>
                <button
                  type="button"
                  className="onb-doc-comp-close"
                  aria-label="Remove company"
                  onClick={() => removeCompany(c._localKey)}
                >
                  <i className="ri-close-line" style={{ fontSize: 12 }} />
                </button>
              </Tooltip>
            </div>
            <div className="onb-doc-comp-body">
              <p className="onb-doc-comp-section"><i className="ri-building-line" /> Company Information</p>
              <Row className="g-3">
                <Col md={6}>
                  <label className="onb-init-label">Company Name <span className="req">*</span></label>
                  <input
                    className={`onb-init-input${compErrors[`${c._localKey}:company_name`] ? ' is-invalid' : ''}`}
                    placeholder="e.g. Wipro Digital (2020-2023)"
                    value={c.company_name}
                    onChange={e => updateCompany(c._localKey, { company_name: e.target.value })}
                    onBlur={() => persistCompany(c._localKey)}
                    disabled={c._busy}
                  />
                  {compErrors[`${c._localKey}:company_name`] && <div className="onb-error-msg">{compErrors[`${c._localKey}:company_name`]}</div>}
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Job Title / Designation <span className="req">*</span></label>
                  <input
                    className={`onb-init-input${compErrors[`${c._localKey}:job_title`] ? ' is-invalid' : ''}`}
                    placeholder="e.g. Software Engineer"
                    value={c.job_title}
                    onChange={e => updateCompany(c._localKey, { job_title: e.target.value })}
                    onBlur={() => persistCompany(c._localKey)}
                    disabled={c._busy}
                  />
                  {compErrors[`${c._localKey}:job_title`] && <div className="onb-error-msg">{compErrors[`${c._localKey}:job_title`]}</div>}
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment Start Date <span className="req">*</span></label>
                  <MasterDatePicker
                    placeholder="Select start date"
                    value={c.start_date}
                    invalid={!!compErrors[`${c._localKey}:start_date`]}
                    // Previous employment must have already started — cap at
                    // today; floor at 5 years ago so the captured experience
                    // can't exceed the allowed 5-year window (BUG-034).
                    minDate={_shiftYears(-5)}
                    maxDate={c.end_date || _todayIso()}
                    onChange={(v) => { updateCompany(c._localKey, { start_date: v }); setTimeout(() => persistCompany(c._localKey), 0); }}
                  />
                  {compErrors[`${c._localKey}:start_date`] && <div className="onb-error-msg">{compErrors[`${c._localKey}:start_date`]}</div>}
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment End Date <span className="req">*</span></label>
                  <MasterDatePicker
                    placeholder="Select end date"
                    value={c.end_date}
                    invalid={!!compErrors[`${c._localKey}:end_date`]}
                    // End must be on/after start, and not in the future
                    // (a previous employer relationship has, by definition,
                    // already happened).
                    minDate={c.start_date || undefined}
                    maxDate={_todayIso()}
                    onChange={(v) => { updateCompany(c._localKey, { end_date: v }); setTimeout(() => persistCompany(c._localKey), 0); }}
                  />
                  {compErrors[`${c._localKey}:end_date`] && <div className="onb-error-msg">{compErrors[`${c._localKey}:end_date`]}</div>}
                </Col>
              </Row>

              <p className="onb-doc-comp-section" style={{ marginTop: 14 }}><i className="ri-file-list-line" /> Document Upload <span className="req">*</span></p>
              {compErrors[`${c._localKey}:doc`] && <div className="onb-error-msg" style={{ marginTop: -4, marginBottom: 6 }}>{compErrors[`${c._localKey}:doc`]}</div>}
              {!c.id && (
                <div className="onb-doc-hint-banner">
                  Save the company name first to enable document uploads.
                </div>
              )}
              {STAGE2_COMPANY_DOCS.map(d => {
                // ── Salary slips: multi-file slot. Upload several (one per
                //    month); list them, and after 3 the list scrolls. ──────
                if (d.id === 'salary_slips') {
                  const slips = c.id
                    ? Object.entries(docsByKey)
                        .filter(([k]) => k === `prev_${c.id}_salary_slips` || k.startsWith(`prev_${c.id}_salary_slips_`))
                        .map(([k, v]) => ({ key: k, doc: v }))
                    : [];
                  const busyAny = !!uploadingKey && uploadingKey.startsWith(`prev_${c.id}_salary_slips`);
                  const nextDocId = () => {
                    if (!docsByKey[`prev_${c.id}_salary_slips`]) return 'salary_slips';
                    let n = 2; while (docsByKey[`prev_${c.id}_salary_slips_${n}`]) n++;
                    return `salary_slips_${n}`;
                  };
                  return (
                    <div key={d.id} className="onb-doc-comp-doc" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="onb-doc-comp-doc-icon"><i className="ri-file-text-line" /></span>
                        <h6 className="onb-doc-comp-doc-name" style={{ margin: 0 }}>
                          {d.name}
                          <span className="onb-doc-tag">{slips.length} file{slips.length !== 1 ? 's' : ''}</span>
                        </h6>
                        <button
                          type="button"
                          className="onb-doc-upload-btn"
                          style={{ marginLeft: 'auto', ...((busyAny || c._busy) ? { opacity: 0.6, cursor: 'progress' } : {}) }}
                          disabled={busyAny || c._busy || !c.id}
                          onClick={() => uploadForCompany(c._localKey, nextDocId(), d.name, d.maxMb)}
                        >
                          <i className={busyAny ? 'ri-loader-4-line onb-spin' : 'ri-add-line'} /> {busyAny ? 'Uploading…' : 'Add Slip'}
                        </button>
                      </div>
                      {slips.length === 0 ? (
                        <div className="onb-doc-row-sub" style={{ marginTop: 6 }}>No salary slips yet — add one per month (last 3 months).</div>
                      ) : (
                        <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
                          {slips.map((s, si) => {
                            const eff = _serverStatusToUi(s.doc.status);
                            return (
                              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--vz-border-color)', borderRadius: 8 }}>
                                <i className="ri-file-pdf-line" style={{ color: '#ef4444', flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.doc.original_name || `Salary Slip ${si + 1}`}
                                </span>
                                <span className={`onb-doc-status-pill onb-doc-status-pill--${String(eff).toLowerCase()}`}>{eff}</span>
                                {s.doc.url && (
                                  <a href={s.doc.url} target="_blank" rel="noreferrer" className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-view"><i className="ri-eye-line" /></a>
                                )}
                                <button type="button" className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-del" onClick={() => triggerDelete(s.doc.id, `${d.name} (${s.doc.original_name || si + 1})`)}>
                                  <i className="ri-delete-bin-line" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                const fullKey = docKeyFor(d.id);
                const srv = fullKey ? docsByKey[fullKey] : undefined;
                const effective: DocStatus = srv
                  ? _serverStatusToUi(srv.status)
                  : (d.status === 'Optional' ? 'Optional' : 'Pending');
                const isBusy = uploadingKey === fullKey;
                return (
                  <div key={d.id} className="onb-doc-comp-doc">
                    <span className="onb-doc-comp-doc-icon"><i className="ri-file-text-line" /></span>
                    <h6 className="onb-doc-comp-doc-name">
                      {d.name}
                      {d.status === 'Optional' && <span className="onb-doc-tag">Optional</span>}
                      {srv?.original_name && <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280' }}>· {srv.original_name}</span>}
                    </h6>
                    <span className={`onb-doc-status-pill onb-doc-status-pill--${String(effective).toLowerCase()}`}>
                      {effective}
                    </span>
                    {srv?.url && (
                      <Tooltip label={`Preview ${d.name}`}>
                        <a
                          href={srv.url}
                          target="_blank"
                          rel="noreferrer"
                          className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-view"
                        >
                          <i className="ri-eye-line" /> View
                        </a>
                      </Tooltip>
                    )}
                    <Tooltip
                      label={
                        isBusy
                          ? 'Uploading…'
                          : (srv ? `Replace ${d.name}` : `Upload ${d.name}`)
                      }
                    >
                      <button
                        type="button"
                        className="onb-doc-upload-btn"
                        disabled={isBusy || c._busy}
                        onClick={() => uploadForCompany(c._localKey, d.id, d.name, d.maxMb)}
                        style={(isBusy || c._busy) ? { opacity: 0.6, cursor: 'progress' } : undefined}
                      >
                        <i className={`${isBusy ? 'ri-loader-4-line onb-spin' : 'ri-upload-cloud-2-line'}`} />
                        {isBusy ? 'Uploading…' : (srv ? 'Replace' : 'Upload')}
                      </button>
                    </Tooltip>
                    {srv && (
                      <Tooltip label="Remove this document">
                        <button
                          type="button"
                          className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-del"
                          onClick={() => triggerDelete(srv.id, d.name)}
                        >
                          <i className="ri-delete-bin-line" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                );
              })}

              <p className="onb-doc-comp-section" style={{ marginTop: 14 }}><i className="ri-search-line" /> Background Verification Details</p>
              <div className="onb-doc-bgv-banner">
                <i className="ri-information-line" />
                These details will be used for background verification checks with the employer.
              </div>
              <Row className="g-3">
                <Col md={4}>
                  <label className="onb-init-label">HR Email ID 1 <span className="req">*</span></label>
                  <input
                    className={`onb-init-input${(EMAIL_INVALID(c.hr_email_1) || compErrors[`${c._localKey}:hr_email_1`]) ? ' is-invalid' : ''}`}
                    placeholder="hr@company.com"
                    value={c.hr_email_1}
                    onChange={e => updateCompany(c._localKey, { hr_email_1: e.target.value })}
                    onBlur={() => persistCompany(c._localKey)}
                    disabled={c._busy}
                  />
                  {(compErrors[`${c._localKey}:hr_email_1`] || EMAIL_INVALID(c.hr_email_1)) && <div className="onb-error-msg">{compErrors[`${c._localKey}:hr_email_1`] || 'Enter a valid email address.'}</div>}
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">HR Email ID 2</label>
                  <input
                    className={`onb-init-input${EMAIL_INVALID(c.hr_email_2) ? ' is-invalid' : ''}`}
                    placeholder="hr2@company.com"
                    value={c.hr_email_2}
                    onChange={e => updateCompany(c._localKey, { hr_email_2: e.target.value })}
                    onBlur={() => persistCompany(c._localKey)}
                    disabled={c._busy}
                  />
                  {EMAIL_INVALID(c.hr_email_2) && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3 }}>Enter a valid email address.</div>}
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">Company Contact Number</label>
                  <input
                    className="onb-init-input"
                    type="tel"
                    inputMode="tel"
                    placeholder="+91 XXXXX XXXXX"
                    // Hard-cap raw chars at 20 (room for "+91 12345 67890")
                    // before we strip down to the 15-digit ITU-T limit.
                    maxLength={20}
                    value={c.contact_number}
                    onChange={e => {
                      // Only allow digits + the usual phone-format symbols
                      // (+, space, dash, parentheses). Letters / anything
                      // else is silently dropped as the user types. Then
                      // cap the raw digit count at 15 (ITU-T E.164 max).
                      const cleaned = e.target.value.replace(/[^0-9+\-\s()]/g, '');
                      const digits  = cleaned.replace(/\D/g, '');
                      const capped  = digits.length > 15
                        ? cleaned.slice(0, cleaned.length - (digits.length - 15))
                        : cleaned;
                      updateCompany(c._localKey, { contact_number: capped });
                    }}
                    onBlur={() => persistCompany(c._localKey)}
                    disabled={c._busy}
                  />
                  {/* Inline length hint — only shown once the user has
                      typed something but the digit count is outside
                      the 7–15 ITU-T window. Stays silent while empty
                      so it isn't visual noise for fresh rows. */}
                  {(() => {
                    const d = c.contact_number.replace(/\D/g, '');
                    if (d.length === 0 || (d.length >= 7 && d.length <= 15)) return null;
                    return (
                      <small style={{ color: '#dc2626', fontSize: 11.5 }}>
                        Enter 7–15 digits
                      </small>
                    );
                  })()}
                </Col>
              </Row>
            </div>
          </div>
        );})}

        {/* Add button — only when the user is in Yes mode. Hidden for
            Fresher so the "No" answer feels final, not half-complete. */}
        {hasExperience === 'yes' && (
          <button type="button" className="onb-doc-add-comp" onClick={addCompany}>
            <i className="ri-add-line" /> Add Previous Company
          </button>
        )}
      </div>

      {/* Shared delete-confirmation modal (same component used on the
          Clients page). Handles both uploaded-document and previous-
          company removal flows; title + sub-message vary by kind so the
          warning matches the consequence the user is about to confirm. */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        loading={deleting}
        itemName={deleteTarget?.name}
        title={deleteTarget?.kind === 'doc' ? 'Remove Document' : 'Remove Company'}
        subMessage={
          deleteTarget?.kind === 'doc'
            ? 'You can re-upload this document anytime.'
            : 'This will also delete every document uploaded against this company. This action cannot be undone.'
        }
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />
    </>
  );
});
Stage2Documents.displayName = 'Stage2Documents';

// ── Stage 3 — Provisioning & Asset Setup ────────────────────────────────────
/** Stage 3 — Provisioning. Reads/writes the SAME `s1` state as the
 *  Stage 1 wizard so the asset selections stay in lock-step (the row's
 *  `laptop_master_asset_id` / `mobile_master_asset_id` / `other_master_asset_ids`
 *  are the only persisted FK columns). Saving Stage 3 reuses
 *  `saveStage1(false)` from the modal scope. */
function Stage3Provisioning({
  emp, s1, setS1, s1Errors, setS1Errors, laptopAssets, mobileAssets, otherAssets, assetsLoading,
}: {
  emp: OnboardRow;
  s1: any;
  setS1: React.Dispatch<React.SetStateAction<any>>;
  s1Errors: Record<string, string>;
  setS1Errors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  laptopAssets: { value: string; label: string }[];
  mobileAssets: { value: string; label: string }[];
  otherAssets:  { value: string; label: string }[];
  /* True while the available-assets fetch is in flight — the pickers shimmer
   * instead of flashing a saved FK as a raw id. */
  assetsLoading?: boolean;
}) {
  // Cosmetic progress meter — counts each provisioning area that has
  // at least one filled value. Keeps the banner moving as the admin
  // works through the section.
  const tasksTotal = 4;
  const tasksDone  =
    (s1.laptop_assigned === 'Yes' && s1.laptop_master_asset_id ? 1 : 0)
    + (s1.mobile_assigned === 'Yes' && s1.mobile_master_asset_id ? 1 : 0)
    + ((s1.other_master_asset_ids?.length ?? 0) > 0 ? 1 : 0)
    + (
      (s1.biometric_status && s1.biometric_status !== 'Not Registered') ||
      !!s1.desk_workstation_no?.trim() ||
      (s1.id_card_status && s1.id_card_status !== 'Not Printed')
        ? 1 : 0
    );
  const pct = Math.round((tasksDone / tasksTotal) * 100);

  const autoLabel = (
    <span className="auto" style={{ background: '#d6f4e3', color: '#108548' }}>EDITABLE</span>
  );
  // Employee Code is system-generated from the number series — it is NOT
  // editable, so it gets an "Auto Generated" badge instead of "EDITABLE".
  const autoGenLabel = (
    <span className="auto" style={{ background: '#ede9fe', color: '#5b3fd1' }}>AUTO GENERATED</span>
  );

  // Lazy fallback: if HR landed on Stage 3 with an empty official_email
  // but Stage 1's Work Email IS filled (legacy rows or freshly-loaded
  // employee where the API column was never populated), backfill it
  // once on mount so the user doesn't have to re-type the same address.
  // The Stage-1 onChange auto-mirrors going forward; this just covers
  // the case where Stage 1 was completed BEFORE the auto-mirror was
  // wired up.
  useEffect(() => {
    if (!s1.official_email && s1.email) {
      setS1((p: any) => ({ ...p, official_email: p.email }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Per-stage progress banner removed — sidebar already shows this. */}

      {/* System & Email Access */}
      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon system"><i className="ri-mac-line" /></span>
          <h6 className="onb-prov-section-title">System &amp; Email Access</h6>
        </div>
        <div className="onb-prov-section-body">
          <Row className="g-3">
<Col md={6}>
  <label className="onb-init-label">
    Official Email Address <span className="req">*</span>
  </label>
  <input
    id="field-official-email"
    type="email"
    autoComplete="email"
    inputMode="email"
    spellCheck={false}
    maxLength={254}
    className={`onb-init-input is-required${s1Errors.official_email ? ' is-invalid' : ''}`}
    placeholder="firstname.lastname@company.com"
    value={s1.official_email}
    onChange={e => {
      // Strip whitespace as the user types — pasted emails often
      // arrive with stray spaces and the SMTP gateway rejects them.
      const v = e.target.value.replace(/\s/g, '');
      setS1((p: any) => ({ ...p, official_email: v }));
      // Inline re-validate so the red border / message disappears
      // the moment the input becomes valid.
      setS1Errors(p => ({ ...p, official_email: v ? validateOfficialEmail(v) : '' }));
    }}
    onBlur={e => {
      setS1Errors(p => ({ ...p, official_email: validateOfficialEmail(e.target.value) }));
    }}
  />
  {s1Errors.official_email && (
    <div className="onb-error-msg">{s1Errors.official_email}</div>
  )}
</Col>
            <Col md={6}>
              <label className="onb-init-label">Employee Code {autoGenLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span>{emp.empId}</span>
              </div>
            </Col>
          </Row>
        </div>
      </div>

      {/* Device & Asset Allocation — fully editable. Bound to the same
          `s1` state used by the Stage 1 wizard, so changes here ride
          along on the next Save Draft / Next Stage. The pickers come
          from /employees/available-assets (booked devices on other
          employees are filtered out by the backend). */}
      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon device"><i className="ri-computer-line" /></span>
          <h6 className="onb-prov-section-title">Device &amp; Asset Allocation</h6>
        </div>
        <div className="onb-prov-section-body">
          <p className="onb-prov-subgroup"><i className="ri-computer-line" /> Assets &amp; Security</p>
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Laptop Assigned {autoLabel}</label>
              <MasterSelect
                options={ONB_YES_NO}
                value={s1.laptop_assigned || 'No'}
                onChange={(v) => setS1((p: any) => ({
                  ...p,
                  laptop_assigned: v,
                  laptop_master_asset_id: v === 'Yes' ? p.laptop_master_asset_id : '',
                }))}
              />
            </Col>
            {s1.laptop_assigned === 'Yes' && (
              <Col md={4}>
                <label className="onb-init-label">Laptop Device {autoLabel}</label>
                <MasterSelect
                  options={laptopAssets}
                  loading={assetsLoading}
                  placeholder={laptopAssets.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                  value={s1.laptop_master_asset_id}
                  onChange={(v) => setS1((p: any) => ({ ...p, laptop_master_asset_id: v }))}
                  disabled={!assetsLoading && laptopAssets.length === 0}
                />
              </Col>
            )}
            <Col md={4}>
              <label className="onb-init-label">Mobile Assigned {autoLabel}</label>
              <MasterSelect
                options={ONB_YES_NO}
                value={s1.mobile_assigned || 'No'}
                onChange={(v) => setS1((p: any) => ({
                  ...p,
                  mobile_assigned: v,
                  mobile_master_asset_id: v === 'Yes' ? p.mobile_master_asset_id : '',
                }))}
              />
            </Col>
            {s1.mobile_assigned === 'Yes' && (
              <Col md={4}>
                <label className="onb-init-label">Mobile Device {autoLabel}</label>
                <MasterSelect
                  options={mobileAssets}
                  loading={assetsLoading}
                  placeholder={mobileAssets.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                  value={s1.mobile_master_asset_id}
                  onChange={(v) => setS1((p: any) => ({ ...p, mobile_master_asset_id: v }))}
                  disabled={!assetsLoading && mobileAssets.length === 0}
                />
              </Col>
            )}
            <Col md={12}>
              <label className="onb-init-label">
                Other Assets {autoLabel}
                <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <MasterMultiSelect
                options={otherAssets}
                placeholder={otherAssets.length === 0 ? 'No other assets available' : 'Pick one or more'}
                value={s1.other_master_asset_ids}
                onChange={(vs) => setS1((p: any) => ({ ...p, other_master_asset_ids: vs }))}
                disabled={otherAssets.length === 0}
              />
            </Col>
          </Row>
        </div>
      </div>

      {/* Physical Setup & Identification — bound to s1 so saves ride
          along with the rest of the wizard / Stage 3 PUT. */}
      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon physical"><i className="ri-shield-check-line" /></span>
          <h6 className="onb-prov-section-title">Physical Setup &amp; Identification</h6>
        </div>
        <div className="onb-prov-section-body">
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Biometric Status {autoLabel}</label>
              <MasterSelect
                options={[
                  { value: 'Not Registered', label: 'Not Registered' },
                  { value: 'Pending',        label: 'Pending' },
                  { value: 'Registered',     label: 'Registered' },
                  { value: 'Failed',         label: 'Failed' },
                ]}
                placeholder="Select status"
                value={s1.biometric_status}
                onChange={(v) => setS1((p: any) => ({ ...p, biometric_status: v }))}
              />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Desk / Workstation No {autoLabel}</label>
              <input
                className="onb-init-input"
                placeholder="e.g. WS-204, Floor 3 / Bay B"
                value={s1.desk_workstation_no}
                onChange={e => setS1((p: any) => ({ ...p, desk_workstation_no: e.target.value }))}
              />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">ID Card Status {autoLabel}</label>
              <MasterSelect
                options={[
                  { value: 'Not Printed', label: 'Not Printed' },
                  { value: 'Printed',     label: 'Printed' },
                  { value: 'Issued',      label: 'Issued' },
                  { value: 'Lost',        label: 'Lost' },
                  { value: 'Reissued',    label: 'Reissued' },
                ]}
                placeholder="Select status"
                value={s1.id_card_status}
                onChange={(v) => setS1((p: any) => ({ ...p, id_card_status: v }))}
              />
            </Col>
          </Row>
        </div>
      </div>
    </>
  );
}

// ── Stage 4 — Payroll & Finance Setup ──────────────────────────────────────
/** Bound to the modal-level `s4` state so all Stage 4 progress, check-pills,
 *  Save Draft button, and Next-Stage gating share one source of truth. */
type S4State = {
  salary_payment_mode: 'bank' | 'cheque' | 'cash';
  bank_name: string;
  bank_account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  bank_branch: string;
  bank_account_type: string;
  uan_number: string;
  pan_number: string;
  tax_regime: string;
  pf_deduction: string;
  esi_applicable: string;
  gratuity_nominee_name: string;
  agreed_ctc_lpa: string;
};

function Stage4Payroll({
  s4, setS4, checks, showErrors, pass, total,
}: {
  s4: S4State;
  setS4: React.Dispatch<React.SetStateAction<S4State>>;
  checks: { bank: boolean; pan: boolean; salary: boolean; pf: boolean };
  showErrors: boolean;
  pass: number;
  total: number;
}) {
  const checkRows: { id: keyof typeof checks; name: string }[] = [
    { id: 'bank',   name: 'Bank details complete' },
    { id: 'pan',    name: 'PAN verified' },
    { id: 'salary', name: 'Salary structure confirmed' },
    { id: 'pf',     name: 'PF / ESIC setup complete' },
  ];
  const pct = total ? Math.round((pass / total) * 100) : 0;
  const allDone = pass === total;

  // Per-field invalidity — only surfaced after a failed advance/save
  // (showErrors). Bank fields apply only in `bank` mode; PAN/CTC/PF always.
  const bankMode = s4.salary_payment_mode === 'bank';
  const invalid = {
    bank_name:           showErrors && bankMode && !s4.bank_name.trim(),
    bank_account_number: showErrors && bankMode && !/^\d{9,18}$/.test(s4.bank_account_number.trim()),
    ifsc_code:           showErrors && bankMode && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(s4.ifsc_code.trim()),
    account_holder_name: showErrors && bankMode && !s4.account_holder_name.trim(),
    bank_branch:         showErrors && bankMode && !s4.bank_branch.trim(),
    pan_number:          showErrors && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(s4.pan_number.trim()),
    pf_deduction:        showErrors && !s4.pf_deduction.trim(),
    agreed_ctc_lpa:      showErrors && !(Number(s4.agreed_ctc_lpa) > 0),
  };

  return (
    <>
      {/* Per-stage progress banner removed — sidebar already shows this. */}

      {/* Salary Payment Mode */}
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon mode"><i className="ri-time-line" /></span>
          <h6 className="onb-pay-section-title">Salary Payment Mode</h6>
        </div>
        <div className="onb-pay-section-body">
          <p className="onb-pay-q">What is the salary payment mode?</p>
          {([
            { id: 'bank',   name: 'Bank Transfer to Employee Account', sub: 'Direct bank credit on salary date' },
            { id: 'cheque', name: 'Payment by Cheque',                 sub: 'Physical cheque issued on salary date' },
            { id: 'cash',   name: 'Payment by Cash',                   sub: 'Cash payment (only for applicable roles)' },
          ] as const).map(opt => (
            <div
              key={opt.id}
              className={`onb-pay-radio ${s4.salary_payment_mode === opt.id ? 'is-selected' : ''}`}
              onClick={() => setS4(p => ({ ...p, salary_payment_mode: opt.id }))}
            >
              <span className="onb-pay-radio-circle" />
              <div className="min-w-0">
                <p className="onb-pay-radio-name">{opt.name}</p>
                <p className="onb-pay-radio-sub">{opt.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bank Details — only collected for `bank` mode. Cheque and Cash skip
          straight to Tax & Statutory since no account is needed. This also
          matches the validation + readiness checks, which require bank details
          ONLY when the mode is `bank` (showing them for Cheque was misleading
          since they were never validated/required — QA bug). */}
      {s4.salary_payment_mode === 'bank' && (
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon bank"><i className="ri-money-dollar-circle-line" /></span>
          <h6 className="onb-pay-section-title">Bank Details</h6>
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Bank Name <span className="req">*</span></label>
              <input className={`onb-init-input is-required${invalid.bank_name ? ' is-invalid' : ''}`} placeholder="e.g. HDFC Bank" value={s4.bank_name} onChange={e => setS4(p => ({ ...p, bank_name: e.target.value.replace(/[^A-Za-z0-9 .,&/'()\-]/g, '') }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Account Number <span className="req">*</span></label>
              <input
                className={`onb-init-input is-required${invalid.bank_account_number ? ' is-invalid' : ''}`}
                placeholder="Account number"
                inputMode="numeric"
                maxLength={18}
                value={s4.bank_account_number}
                onChange={e =>
                  setS4(p => ({
                    // Digits only, capped at 18 chars (Indian banking standard
                    // is 9–18 digits; we accept anything in that band here and
                    // surface the inline hint when it's out of range).
                    ...p,
                    bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 18),
                  }))
                }
              />
              {s4.bank_account_number && (s4.bank_account_number.length < 9 || s4.bank_account_number.length > 18) && (
                <small style={{ color: '#dc2626', fontSize: 11.5 }}>
                  Account number must be 9–18 digits
                </small>
              )}
            </Col>
            <Col md={4}>
              <label className="onb-init-label">IFSC Code <span className="req">*</span></label>
              <input
                className={`onb-init-input is-required${invalid.ifsc_code ? ' is-invalid' : ''}`}
                placeholder="e.g. HDFC0001234"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={11}
                value={s4.ifsc_code}
                onChange={e =>
                  setS4(p => ({
                    // Strip anything that isn't A–Z / 0–9 on the way in so
                    // stray whitespace or symbols (common when typing fast
                    // or after autofill) never reach the regex. Cap at 11
                    // chars in case the browser bypasses maxLength on paste.
                    ...p,
                    ifsc_code: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 11),
                  }))
                }
              />
              {s4.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s4.ifsc_code) && (
                <small style={{ color: '#dc2626', fontSize: 11.5 }}>11 chars: 4 letters + 0 + 6 alphanum</small>
              )}
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Name on the Account <span className="req">*</span></label>
              <input className={`onb-init-input is-required${invalid.account_holder_name ? ' is-invalid' : ''}`} placeholder="Full legal name as per bank" value={s4.account_holder_name} onChange={e => setS4(p => ({ ...p, account_holder_name: e.target.value.replace(/[^A-Za-z .'-]/g, '') }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Branch <span className="req">*</span></label>
              <input className={`onb-init-input is-required${invalid.bank_branch ? ' is-invalid' : ''}`} placeholder="e.g. Baner, Pune" value={s4.bank_branch} onChange={e => setS4(p => ({ ...p, bank_branch: e.target.value.replace(/[^A-Za-z0-9 .,&/'()\-]/g, '') }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Account Type</label>
              <MasterSelect options={ONB_ACCOUNT_TYPE} value={s4.bank_account_type} onChange={(v) => setS4(p => ({ ...p, bank_account_type: v }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">UAN Number (PF)</label>
              <input
                className="onb-init-input"
                placeholder="12-digit UAN"
                maxLength={12}
                value={s4.uan_number}
                onChange={e => setS4(p => ({ ...p, uan_number: e.target.value.replace(/\D/g, '') }))}
              />
              {s4.uan_number && s4.uan_number.length !== 12 && (
                <small style={{ color: '#dc2626', fontSize: 11.5 }}>UAN must be exactly 12 digits</small>
              )}
            </Col>
          </Row>
        </div>
      </div>
      )}

      {/* Tax & Statutory Details */}
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon tax"><i className="ri-file-list-3-line" /></span>
          <h6 className="onb-pay-section-title">Tax &amp; Statutory Details</h6>
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">PAN Number <span className="req">*</span></label>
              <input
                className={`onb-init-input is-required${invalid.pan_number ? ' is-invalid' : ''}`}
                placeholder="AAAZZ9999A"
                maxLength={10}
                value={s4.pan_number}
                onChange={e => setS4(p => ({ ...p, pan_number: e.target.value.toUpperCase() }))}
              />
              {s4.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s4.pan_number) && (
                <small style={{ color: '#dc2626', fontSize: 11.5 }}>PAN format: 5 letters + 4 digits + 1 letter</small>
              )}
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Tax Regime</label>
              <MasterSelect options={ONB_TAX_REGIME} value={s4.tax_regime || 'New Regime (115BAC)'} onChange={(v) => setS4(p => ({ ...p, tax_regime: v }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">PF Type</label>
              <MasterSelect options={ONB_PF_TYPE} value={s4.pf_deduction || 'Statutory'} onChange={() => { /* read-only — set in Stage 1 */ }} disabled />
              <small style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: '#9ca3af' }}>Set in Stage 1 (Compensation) — read-only here.</small>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">ESI Applicable</label>
              <MasterSelect options={ONB_YES_NO} value={s4.esi_applicable || 'No'} onChange={(v) => setS4(p => ({ ...p, esi_applicable: v }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Gratuity Nominee Name</label>
              <input className="onb-init-input" placeholder="Full legal name" value={s4.gratuity_nominee_name} onChange={e => setS4(p => ({ ...p, gratuity_nominee_name: e.target.value }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Agreed CTC (LPA)</label>
              <input
                className="onb-init-input"
                placeholder="—"
                value={s4.agreed_ctc_lpa}
                readOnly
                style={{ background: 'var(--vz-light, #f3f3f9)', cursor: 'not-allowed' }}
              />
              <small style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: '#9ca3af' }}>From the Stage 1 salary — read-only here.</small>
            </Col>
          </Row>
        </div>
      </div>

      {/* Payroll Readiness Check */}
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon check"><i className="ri-checkbox-circle-line" /></span>
          <h6 className="onb-pay-section-title">Payroll Readiness Check</h6>
        </div>
        <div className="onb-pay-section-body">
          {checkRows.map(c => {
            // Bank details aren't applicable for Cheque / Cash payouts. The
            // readiness check auto-passes them in those modes — but rendering
            // that as a green "Verified" wrongly implied bank info was entered
            // (QA bug). Show a neutral "Not required" row instead; it still
            // counts toward stage completion since no account is needed.
            const bankNA = c.id === 'bank' && s4.salary_payment_mode !== 'bank';
            if (bankNA) {
              const modeLabel = s4.salary_payment_mode === 'cheque' ? 'Cheque' : 'Cash';
              return (
                <div key={c.id} className="onb-pay-check">
                  <span className="onb-pay-check-icon"><i className="ri-subtract-line" /></span>
                  <h6 className="onb-pay-check-name">Bank details not required ({modeLabel})</h6>
                  <span className="onb-doc-status-pill onb-doc-status-pill--optional">N/A</span>
                </div>
              );
            }
            const ok = checks[c.id];
            return (
              <div key={c.id} className="onb-pay-check">
                <span className="onb-pay-check-icon" style={ok ? { background: '#10b981', color: '#fff' } : undefined}>
                  <i className={ok ? 'ri-check-line' : 'ri-loader-line'} />
                </span>
                <h6 className="onb-pay-check-name">{c.name}</h6>
                <span className={`onb-doc-status-pill onb-doc-status-pill--${ok ? 'verified' : 'pending'}`}>
                  {ok ? 'Verified' : 'Pending'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Stage 5 — Policies & Agreements ────────────────────────────────────────
function Stage5Policies({ emp }: { emp: OnboardRow }) {
  type Tpl = {
    id: number;
    code: string;
    name: string;
    doc_type: string | null;
    status: 'Active' | 'Draft' | 'Deprecated';
    /* JSON column on hr_document_templates carrying the configured
     * signing pipeline (Reporting Manager → Employee → Client CEO …).
     * Each entry holds at least { role_name, designation_name, action,
     * days }. Already shipped by the /match endpoint thanks to the
     * model's `signers => array` cast. */
    signers?: any;
  };

  const toast = useToast();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(false);
  // Per-template readiness — the Generate button stays disabled until that
  // template's detail (content + custom-field tokens) has been fetched, so a
  // user can't open Generate before its custom fields are known. Clicking
  // while still loading shows a toast.
  const [readyTpls, setReadyTpls] = useState<Set<number>>(new Set());
  // Whether each template actually references any registered custom field
  // (scanned from its content_html). Drives the "no custom fields" toast.
  const [tplHasFields, setTplHasFields] = useState<Record<number, boolean>>({});
  // Generate modal — custom-field fill → preview → download / send for signature.
  const [genTpl, setGenTpl] = useState<Tpl | null>(null);
  /* Click-to-expand: the row a user has clicked, revealing the
   * signing-workflow stepper underneath. Single-row open at a time so
   * Stage 5 doesn't turn into a long unscrollable wall when every
   * matched template is expanded simultaneously. Null = all collapsed. */
  const [expandedId, setExpandedId] = useState<number | null>(null);

  /* Parse the signers column off a template. Mirrors the helper inside
   * the Evidence Vault component above — the cast usually returns an
   * array, but a stale serializer can leave it as a JSON string. */
  const parseSigners = (raw: any): Array<{ role_name?: string | null; designation_name?: string | null; action?: string | null }> => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  };

  /* Fetch matched onboarding templates — same endpoint the Evidence
   * Vault tab uses (/hr-document-templates/match with trigger_keyword
   * = onboarding), so a template configured once in HR > Document
   * Templates surfaces on both surfaces without double bookkeeping.
   * Leave / Attendance templates are filtered out client-side because
   * those belong to the HR > Leave & Attendance module — letting them
   * also appear here would double-prompt the employee to acknowledge
   * the same policy. */
  useEffect(() => {
    if (!emp?.dbId) { setTemplates([]); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get('/hr-document-templates/match', {
          params: { employee_id: emp.dbId, trigger_keyword: 'onboarding' },
        });
        if (cancelled) return;
        const raw: Tpl[] = Array.isArray(data?.templates) ? data.templates : [];
        const filtered = raw.filter(t => !/\b(leave|attendance)\b/i.test(t.name || ''));
        setTemplates(filtered);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [emp?.dbId]);

  // Pre-fetch each matched template's detail so we know its custom fields are
  // loaded before allowing Generate. Marks each template ready as its fetch
  // resolves (per-row), so Generate enables one row at a time.
  useEffect(() => {
    let cancelled = false;
    setReadyTpls(new Set());
    setTplHasFields({});
    if (!templates.length) return;
    (async () => {
      // Registered custom-field token names (once) so we can tell whether a
      // template's {{Tokens}} include any real custom field to fill.
      let customNames = new Set<string>();
      try {
        const tok = await api.get('/hr-custom-fields/known-tokens');
        customNames = new Set((tok.data?.custom_fields ?? []).map((c: any) => c.name));
      } catch { /* treat as "no custom fields" if the token list fails */ }
      templates.forEach(t => {
        api.get(`/hr-document-templates/${t.id}`)
          .then(res => {
            if (cancelled) return;
            const html = String(res.data?.content_html ?? '');
            const found = new Set<string>();
            const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(html)) !== null) found.add(m[1]);
            const has = [...found].some(n => customNames.has(n));
            setTplHasFields(prev => ({ ...prev, [t.id]: has }));
            setReadyTpls(prev => { const next = new Set(prev); next.add(t.id); return next; });
          })
          .catch(() => { /* leave disabled if its detail can't load */ });
      });
    })();
    return () => { cancelled = true; };
  }, [templates]);

  // ── Signing runs — the SAME workflow Exit Management uses. "Send" creates
  // a row in hr_document_signatures with the template's configured signers;
  // each signer then signs in-app sequentially. We list the runs for this
  // employee so the row reflects the LIVE signing status (Awaiting / Signed)
  // instead of the old hardcoded "Not Generated". No third-party — fully
  // internal (Zoho is only for CLM trade agreements, not HR docs).
  type RunSigner = { name?: string | null; role_name?: string | null; action?: string | null; status?: string; acted_at?: string | null };
  type SignatureRun = {
    id: number; code: string | null;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
    template_id: number; signers: RunSigner[]; current_index: number;
    created_at?: string | null;
  };
  const [runs, setRuns] = useState<SignatureRun[]>([]);
  const [sendingId, setSendingId] = useState<number | null>(null);
  // Which row's ⋮ (previous signed copies) menu is open.
  const [menuTplId, setMenuTplId] = useState<number | null>(null);
  // Rich "Send for Signing" modal (workflow preview) — replaces the plain
  // confirm so this matches the Evidence Vault send experience.
  const [sendForTpl, setSendForTpl] = useState<Tpl | null>(null);
  // Download the final signed PDF (all signatures embedded) for a completed run.
  const [downloadingRunId, setDownloadingRunId] = useState<number | null>(null);
  const downloadSignedRun = async (runId: number, code?: string | null) => {
    if (downloadingRunId !== null) return;
    setDownloadingRunId(runId);
    try {
      const resp = await api.get(`/hr-document-signatures/${runId}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${code || `doc-${runId}`}-signed.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Signed PDF saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally { setDownloadingRunId(null); }
  };
  const fmtSignedAt = (iso?: string | null) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const fetchRuns = useCallback(async () => {
    if (!emp?.dbId) { setRuns([]); return; }
    try {
      const { data } = await api.get('/hr-document-signatures', { params: { employee_id: emp.dbId } });
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    }
  }, [emp?.dbId]);
  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Latest run per template (highest id wins) → drives each row's status pill.
  const runByTemplateId = useMemo(() => {
    const m = new Map<number, SignatureRun>();
    for (const r of runs) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [runs]);

  // All COMPLETED runs per template, newest first → [0] is the current signed
  // copy; the rest are previous signed copies (from earlier re-sends) shown
  // behind the ⋮ menu.
  const completedRunsByTpl = useMemo(() => {
    const m = new Map<number, SignatureRun[]>();
    for (const r of runs) {
      if (r.status !== 'Completed') continue;
      const arr = m.get(r.template_id) || [];
      arr.push(r); m.set(r.template_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.id - a.id);
    return m;
  }, [runs]);

  const signedCount = templates.filter(t => runByTemplateId.get(t.id)?.status === 'Completed').length;

  // Open the rich send modal; the actual POST happens in confirmSend.
  const handleSend = (tpl: Tpl) => { setSendForTpl(tpl); };
  const confirmSend = async () => {
    const tpl = sendForTpl;
    if (!tpl || !emp?.dbId || sendingId) return;
    setSendingId(tpl.id);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: tpl.id,
        employee_id: emp.dbId,
      });
      toast.success('Sent for signing', `${data?.code || tpl.code || 'Document'} entered the signing workflow.`);
      setSendForTpl(null);
      await fetchRuns();
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <>
      {/* Status legend */}
      <div className="onb-pol-legend">
        <span style={{ fontWeight: 700, color: '#374151' }}>Signing Status:</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#10b981' }} /> Signed</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#f59e0b' }} /> Pending</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#7c5cfc' }} /> Awaiting</span>
      </div>

      {/* Organizational documents — pulled from HR > Document Templates */}
      <div className="onb-pol-section">
        <div className="onb-pol-section-head">
          <span className="onb-pol-section-icon"><i className="ri-shield-check-line" /></span>
          <h6 className="onb-pol-section-title">Organizational Documents &amp; Agreements</h6>
          <span className="onb-pol-section-pill">{signedCount} / {templates.length} signed</span>
        </div>

        {loading && (
          <div className="placeholder-glow" style={{ padding: 4 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                <span className="placeholder" style={{ width: 30, height: 30, borderRadius: 8 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="placeholder col-5" style={{ height: 12, display: 'block', borderRadius: 4 }} />
                  <span className="placeholder col-3" style={{ height: 9, display: 'block', borderRadius: 4, marginTop: 6 }} />
                </div>
                <span className="placeholder" style={{ width: 70, height: 22, borderRadius: 6 }} />
                <span className="placeholder" style={{ width: 80, height: 26, borderRadius: 6 }} />
                <span className="placeholder" style={{ width: 70, height: 26, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        )}

        {!loading && templates.length === 0 && (
          <div style={{ padding: 22, textAlign: 'center', borderRadius: 10, background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
            <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#9ca3af' }} />
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              No matching policy / agreement templates for this employee&rsquo;s department &amp; role.
            </div>
          </div>
        )}

        {!loading && templates.map(tpl => {
          const isExpanded = expandedId === tpl.id;
          const signers = parseSigners(tpl.signers);
          const toggle = () => setExpandedId(prev => prev === tpl.id ? null : tpl.id);
          // Live signing run for this template (if Sent). Drives the status
          // pill + whether Send is offered (can't send while a run is active).
          const run = runByTemplateId.get(tpl.id) || null;
          const isSending = sendingId === tpl.id;
          const runActive = !!run && (run.status === 'Pending' || run.status === 'In Progress');
          // Once signed (Completed) the document is final — Resend must be
          // disabled (a signed offer letter can't be re-sent). Rejected /
          // cancelled runs are NOT signed, so they stay re-sendable.
          // Latest signed copy (stays downloadable even while a re-send is in
          // progress); previous signed copies live behind the ⋮ menu.
          const signedRuns = completedRunsByTpl.get(tpl.id) || [];
          const latestSigned = signedRuns[0] || null;
          // Status pill text/colour derived from the run.
          const statusInfo = run?.status === 'Completed'  ? { label: 'Signed',      color: '#10b981' }
                           : run?.status === 'Rejected'   ? { label: 'Rejected',    color: '#ef4444' }
                           : run?.status === 'Cancelled'  ? { label: 'Cancelled',   color: '#878a99' }
                           : runActive                    ? { label: 'Awaiting Sign', color: '#7c5cfc' }
                           :                                 { label: 'Not Sent',    color: '#9ca3af' };
          return (
            /* Whole CARD is the toggle target — used to be just the
             * inner row, so clicking on the grey "Generate this document
             * first…" help-strip (still inside the card visually) did
             * nothing. Moving the onClick up here means the entire patti
             * the user sees is one click-zone. Clicks on the Generate
             * button still bubble-stop so they don't toggle the panel. */
            <div
              key={tpl.id}
              className={`onb-pol-doc${isExpanded ? ' is-expanded' : ''}`}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }}
            >
              <div className="onb-pol-doc-row">
                <span className="onb-pol-doc-icon"><i className="ri-file-text-line" /></span>
                <div className="onb-pol-doc-meta">
                  <h6 className="onb-pol-doc-name">
                    {tpl.name || '(unnamed template)'}{' '}
                    <span className="vault-doc-code">{tpl.code}</span>
                    {tpl.status === 'Draft' && <span className="onb-doc-tag" style={{ marginLeft: 6 }}>Draft</span>}
                    {signers.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                        · {signers.length} signer{signers.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </h6>
                  <p className="onb-pol-doc-sub">{tpl.doc_type || 'Document'}</p>
                </div>
                <span className="onb-pol-doc-status" style={{ color: statusInfo.color }}>
                  <span className="dot" style={{ background: statusInfo.color }} />
                  {statusInfo.label}
                </span>
                {/* ONE action: Send for Signature. If the template has custom
                    fields we open the fill form first (it sends from there);
                    otherwise we send directly via the confirm modal. A rejected /
                    cancelled run becomes "Resend"; a fully-signed (Completed) run
                    is final and shows no action at all (Bug #40). */}
                {(() => {
                  // Once every signer has signed (run Completed) the document is
                  // final — no Resend action at all (Bug #40). The "Signed" status
                  // pill + the ⋮ download menu remain. Rejected / cancelled runs
                  // are NOT signed, so those still stay re-sendable below.
                  if (run?.status === 'Completed') return null;
                  const fieldsReady = readyTpls.has(tpl.id);
                  const hasFields = !!tplHasFields[tpl.id];
                  const sendBlocked = tpl.status !== 'Active' || !emp.dbId || isSending || runActive || !fieldsReady;
                  const sendLabel = isSending ? 'Sending…'
                    : runActive ? 'Awaiting Sign'
                    : run       ? 'Resend'
                    :             'Send for Signature';
                  const sendIcon = (isSending || (!runActive && !fieldsReady)) ? 'ri-loader-4-line'
                    : runActive ? 'ri-time-line'
                    : 'ri-send-plane-line';
                  return (
                    <button
                      type="button"
                      className="onb-pol-gen-btn"
                      aria-disabled={sendBlocked}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tpl.status !== 'Active') { toast.warning('Not sendable', 'Only Active templates can be sent.'); return; }
                        if (!emp.dbId) { toast.warning('Save first', 'Save the employee before sending documents.'); return; }
                        if (isSending) return;
                        if (runActive) { toast.info('Already sent', 'This document is already out for signing.'); return; }
                        if (!fieldsReady) { toast.info('Loading template…', 'Please wait a moment while the template loads, then try again.'); return; }
                        // Always open the preview/fill modal so the document is
                        // reviewed before sending — even with no custom fields we
                        // don't want a blind "send unread". The modal previews
                        // the rendered PDF and sends from there.
                        setGenTpl(tpl);
                      }}
                      title={
                        tpl.status !== 'Active' ? 'Only Active templates can be sent'
                        : !emp.dbId        ? 'Save the employee first'
                        : runActive        ? 'Already sent — signing in progress'
                        : !fieldsReady     ? 'Loading template…'
                        : hasFields        ? 'Fill custom fields, then send for signing'
                        : 'Send through the configured signing workflow'
                      }
                      style={{
                        background: sendBlocked ? '#e5e7eb' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
                        color: sendBlocked ? '#9ca3af' : '#fff',
                        border: 0,
                        opacity: sendBlocked ? 0.7 : 1,
                        cursor: sendBlocked ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <i className={sendIcon} /> {sendLabel}
                    </button>
                  );
                })()}
                {/* Signed → download the current (latest) signed PDF. */}
                {latestSigned && (
                  <button
                    type="button"
                    className="onb-pol-gen-btn"
                    disabled={downloadingRunId === latestSigned.id}
                    onClick={(e) => { e.stopPropagation(); downloadSignedRun(latestSigned.id, tpl.code); }}
                    title="Download the latest signed PDF (all signatures)"
                    style={{ marginLeft: 8, background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 0, cursor: downloadingRunId === latestSigned.id ? 'wait' : 'pointer', opacity: downloadingRunId === latestSigned.id ? 0.7 : 1 }}
                  >
                    <i className={downloadingRunId === latestSigned.id ? 'ri-loader-4-line' : 'ri-file-pdf-2-line'} /> {downloadingRunId === latestSigned.id ? 'Downloading…' : 'Download'}
                  </button>
                )}
                {/* Previous signed copies (from earlier re-sends) → ⋮ menu. */}
                {(() => {
                  const older = signedRuns.slice(1);
                  if (older.length === 0) return null;
                  const open = menuTplId === tpl.id;
                  return (
                    <div style={{ position: 'relative', marginLeft: 6 }}>
                      <button
                        type="button"
                        className="onb-pol-gen-btn"
                        onClick={(e) => { e.stopPropagation(); setMenuTplId(open ? null : tpl.id); }}
                        title={`${older.length} previous signed cop${older.length === 1 ? 'y' : 'ies'}`}
                        style={{ background: 'transparent', border: '1px solid var(--vz-border-color)', color: 'var(--vz-secondary-color)', cursor: 'pointer', padding: '6px 9px' }}
                      >
                        <i className="ri-more-2-fill" />
                      </button>
                      {open && (
                        <>
                          <div onClick={(e) => { e.stopPropagation(); setMenuTplId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 4px)', zIndex: 21, minWidth: 230, maxHeight: 260, overflowY: 'auto', background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color)', borderRadius: 10, boxShadow: '0 -10px 30px rgba(0,0,0,.14)', padding: 6 }}
                          >
                            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', padding: '6px 8px 4px' }}>
                              Previous signed copies
                            </div>
                            {older.map(r => (
                              <button
                                key={r.id}
                                type="button"
                                disabled={downloadingRunId === r.id}
                                onClick={(e) => { e.stopPropagation(); setMenuTplId(null); downloadSignedRun(r.id, tpl.code); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 0, borderRadius: 7, padding: '7px 8px', fontSize: 12, color: 'var(--vz-body-color)', cursor: downloadingRunId === r.id ? 'wait' : 'pointer' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--vz-light, #f3f4f6)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                <i className="ri-file-pdf-2-line" style={{ color: '#0e7490' }} />
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  {r.code || `Run #${r.id}`}
                                  {r.created_at && <span style={{ display: 'block', fontSize: 10, color: 'var(--vz-secondary-color)' }}>{fmtSignedAt(r.created_at)}</span>}
                                </span>
                                <i className={downloadingRunId === r.id ? 'ri-loader-4-line' : 'ri-download-2-line'} />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                <span
                  className="onb-pol-doc-chev"
                  style={{
                    marginLeft: 6, color: 'var(--vz-secondary-color)', fontSize: 18,
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform .18s ease',
                  }}
                  aria-hidden
                >
                  <i className="ri-arrow-down-s-line" />
                </span>
              </div>

              {/* Signing-workflow stepper — same .ep-signing / .ep-signer
                  classes Exit Management and the Evidence Vault use.
                  recruitment.css is already imported at the top of this
                  file so they resolve here too. No live signing-run yet
                  in Stage 5, so we always render the PREVIEW pipeline
                  with each signer in 'Pending' and step 1 as the
                  active one — matches the "who will sign" affordance. */}
              {isExpanded && (
                (run || signers.length > 0) ? (
                  <div className="ep-signing" style={{ margin: '4px 16px 12px' }}>
                    <div className="ep-signing-head">
                      <i className="ri-shield-check-line" />Signing Workflow
                      <span className="ep-signing-pct">
                        {run
                          ? `${run.signers.filter(s => s.status === 'Done').length}/${run.signers.length} signed`
                          : 'Not yet sent'}
                      </span>
                      {run?.status === 'Completed' && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); downloadSignedRun(run.id, tpl.code); }}
                          disabled={downloadingRunId === run.id}
                          title="Download the signed PDF"
                          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#0e7490', background: '#cffafe', border: '1px solid #a5f3fc', borderRadius: 7, padding: '3px 9px', cursor: downloadingRunId === run.id ? 'wait' : 'pointer' }}
                        >
                          <i className={downloadingRunId === run.id ? 'ri-loader-4-line' : 'ri-file-pdf-2-line'} /> {downloadingRunId === run.id ? 'Downloading…' : 'Download signed PDF'}
                        </button>
                      )}
                    </div>
                    <div className="ep-signing-flow">
                      {/* When SENT → live per-signer status from the run; else
                          → preview the template's configured signers. Same as
                          Exit Management / Evidence Vault. */}
                      {(run
                        ? run.signers.map((s, i) => ({
                            name:   s.name || s.role_name || `Signer ${i + 1}`,
                            action: s.action,
                            state:  s.status === 'Done' ? 'Completed'
                                  : s.status === 'Rejected' ? 'Rejected'
                                  : (i === run.current_index ? 'Awaiting' : 'Pending'),
                            active: i === run.current_index && (run.status === 'Pending' || run.status === 'In Progress'),
                            at:     s.acted_at,
                          }))
                        : signers.map((s, i) => ({
                            name:   s.role_name || s.designation_name || `Signer ${i + 1}`,
                            action: s.action,
                            state:  'Pending' as string,
                            active: i === 0,
                            at:     null as string | null,
                          }))
                      ).map((sg, i) => (
                        <div key={i} className={`ep-signer${sg.active ? ' is-active' : ''}`}>
                          <span className="ep-signer-dot">{i + 1}</span>
                          <span className="ep-signer-name">
                            {sg.name}
                            {sg.action && (
                              <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                                ({sg.action})
                              </span>
                            )}
                            {/* Signing tracker — who signed & when. */}
                            {sg.state === 'Completed' && sg.at && (
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 500, marginTop: 1 }}>
                                Signed · {fmtSignedAt(sg.at)}
                              </span>
                            )}
                          </span>
                          <span className="ep-signer-state">{sg.state}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="onb-pol-doc-help" style={{ paddingLeft: 16 }}>
                    <i className="ri-information-line" />
                    No signers configured on this template — open it in
                    <strong> HR &rsaquo; Document Templates</strong> and add a Signing Workflow.
                  </p>
                )
              )}

              {!isExpanded && (
                <p className="onb-pol-doc-help">
                  <i className="ri-information-line" />
                  {runActive
                    ? 'Sent — waiting on the signers. Expand to see who\'s next.'
                    : run?.status === 'Completed'
                    ? 'All signers have signed. ✓'
                    : 'Click Send to start the signing workflow and notify the signers.'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Generate Document — custom-field fill → preview → download / send for signature */}
      <DocGenerateModal
        isOpen={!!genTpl}
        onClose={() => setGenTpl(null)}
        templateId={genTpl?.id ?? null}
        templateName={genTpl?.name}
        templateCode={genTpl?.code}
        employeeId={emp?.dbId ?? null}
        employeeName={emp?.name}
        onSent={fetchRuns}
      />

      {/* Send-for-signing — rich workflow modal (matches the Evidence Vault) */}
      <Modal isOpen={!!sendForTpl} toggle={() => setSendForTpl(null)} size="md" centered contentClassName="border-0" modalClassName="send-sign-modal" backdrop="static">
        <style>{`
          .send-sign-modal .modal-dialog { max-width: 600px; }
          .send-sign-modal .modal-content { border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.30); }
          /* Body surface — the inline var(--vz-card-bg) falls back to white
             inside the portalled modal, so dark mode showed a white body.
             Pin explicit surfaces (a stylesheet !important beats the inline
             var). Text + footer border re-pinned for the dark surface too. */
          .send-sign-modal .modal-body { background: #ffffff !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body { background: #1c2531 !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(2) { color: #ced4da !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(2) strong { color: #f3f4f6 !important; }
          [data-bs-theme="dark"] .send-sign-modal .modal-body > div:nth-of-type(3) { border-top-color: rgba(255,255,255,0.10) !important; }
          .send-sign-modal .ss-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
          [data-bs-theme="dark"] .send-sign-modal .ss-warn { background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.42); color: #fcd34d; }
          .send-sign-modal .ss-cancel { background: var(--vz-secondary-bg, #fff); color: var(--vz-body-color, #374151); border: 1px solid var(--vz-border-color, #d1d5db); transition: filter .15s ease; }
          .send-sign-modal .ss-cancel:hover { filter: brightness(0.97); }
          [data-bs-theme="dark"] .send-sign-modal .ss-cancel:hover { filter: brightness(1.25); }
          .send-sign-modal .ss-send { transition: filter .15s ease, transform .15s ease; }
          .send-sign-modal .ss-send:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
          .send-sign-modal .ssw-step { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; }
          .send-sign-modal .ssw-step-num { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: #4338ca; color: #fff; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 700; flex-shrink: 0; }
          .send-sign-modal .ssw-step-role { font-size: 12px; font-weight: 700; color: #4338ca; line-height: 1.15; }
          .send-sign-modal .ssw-step-action { font-size: 10px; font-weight: 500; color: #6366f1; }
          .send-sign-modal .ssw-arrow { color: #9ca3af; font-size: 16px; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.40); }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-num { background: #6366f1; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-role { color: #c4b5fd; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-step-action { color: #a5b4fc; }
          [data-bs-theme="dark"] .send-sign-modal .ssw-arrow { color: #6b7280; }
        `}</style>
        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg, #fff)' }}>
          <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg,#5a3fd1 0%,#7c3aed 55%,#a855f7 100%)', color: '#fff' }}>
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                <i className="ri-send-plane-fill" />
              </span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>Send for Signing</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Confirm the signing workflow before sending</div>
              </div>
            </div>
          </div>
          <div style={{ padding: 18, fontSize: 13, color: 'var(--vz-body-color)' }}>
            <p style={{ marginBottom: 14 }}>
              Send <strong>{sendForTpl?.name}</strong> for <strong>{emp?.name}</strong>? The document will follow this signing workflow:
            </p>
            <SendWorkflowPreview templateId={sendForTpl?.id ?? null} />
            <div className="ss-warn d-flex align-items-start gap-2" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, fontSize: 11.5 }}>
              <i className="ri-information-line" style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Placeholders will be locked at send-time using this employee's data.</span>
            </div>
          </div>
          <div style={{ padding: '14px 18px', borderTop: '1px solid var(--vz-border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setSendForTpl(null)} disabled={!!sendingId}
              className="ss-cancel" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={confirmSend} disabled={!!sendingId}
              className="ss-send" style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: sendingId ? 'wait' : 'pointer', opacity: sendingId ? 0.8 : 1, boxShadow: '0 4px 14px rgba(124,58,237,0.40)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i className={sendingId ? 'ri-loader-4-line ri-spin' : 'ri-send-plane-fill'} />{sendingId ? 'Sending…' : 'Send Document'}
            </button>
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}

// ── Stage 6 — Final Verification & Activation ─────────────────────────────
// ── Flag Issue modal — opens from Stage 6 "Flag Issue" button ───────────────
const FLAG_STAGE_OPTIONS = [
  { value: 'stage1', label: 'Stage 1 — Employee Onboarding Setup' },
  { value: 'stage2', label: 'Stage 2 — Document Management' },
  { value: 'stage3', label: 'Stage 3 — Provisioning & Asset Setup' },
  { value: 'stage4', label: 'Stage 4 — Payroll & Finance Setup' },
  { value: 'stage5', label: 'Stage 5 — Policies & Agreements' },
  { value: 'stage6', label: 'Stage 6 — HR Final Approval' },
];
const FLAG_ISSUE_TYPES = ['Missing Documents', 'Verification Failed', 'Approval Pending', 'Other'] as const;
type FlagIssueType = typeof FLAG_ISSUE_TYPES[number];

function FlagIssueModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<string>('stage1');
  const [issueType, setIssueType] = useState<FlagIssueType | ''>('');
  const [description, setDescription] = useState<string>('');

  const handleSubmit = () => {
    if (!description.trim()) return;
    // In real wiring, dispatch to API. For now just close.
    onClose();
    setIssueType('');
    setDescription('');
    setStage('stage1');
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      contentClassName="onb-flag-content"
      modalClassName="onb-flag-modal"
      backdrop="static"
      keyboard
    >
      <ModalBody className="p-0">
        <div className="onb-flag-header">
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </button>
          <span className="onb-flag-icon">
            <i className="ri-error-warning-line" style={{ fontSize: 22 }} />
          </span>
          <h5 className="onb-flag-title">Flag Issue</h5>
          <p className="onb-flag-sub">Raise a concern to block employee activation until resolved</p>
        </div>

        <div className="onb-flag-body">
          <div className="onb-flag-section">
            <p className="onb-flag-label">Issue Stage</p>
            <MasterSelect value={stage} onChange={setStage} options={FLAG_STAGE_OPTIONS} />
          </div>

          <div className="onb-flag-section">
            <p className="onb-flag-label">Issue Type</p>
            <div className="onb-flag-types">
              {FLAG_ISSUE_TYPES.map(t => (
                <label key={t} className={`onb-flag-type${issueType === t ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="flag-issue-type"
                    checked={issueType === t}
                    onChange={() => setIssueType(t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div className="onb-flag-section">
            <p className="onb-flag-label">Issue Description <span className="onb-flag-req">*</span></p>
            <textarea
              className="onb-flag-textarea"
              placeholder="Describe the issue clearly — e.g. PAN number mismatch, documents not uploaded, bank details incomplete..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="onb-flag-footer">
          <button type="button" className="onb-flag-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="onb-flag-submit" onClick={handleSubmit} disabled={!description.trim()}>
            <i className="ri-error-warning-line" style={{ fontSize: 16 }} /> Submit Flag
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function ActivateEmployeeModal({
  isOpen, onClose, emp, onActivated,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow;
  /** Fires after a successful activate so the parent can refresh the
   *  onboarding list (status pill rolls over to Completed). */
  onActivated?: () => void;
}) {
  const toast = useToast();
  const [activating, setActivating] = useState(false);

  // Reset busy state whenever the modal closes / reopens for a new emp.
  useEffect(() => { if (!isOpen) setActivating(false); }, [isOpen]);

  const handleConfirm = async () => {
    if (activating || !emp?.dbId) return;
    setActivating(true);
    try {
      await api.put(`/employees/${emp.dbId}`, {
        // Backend whitelist (EmployeeController validation) is Title-Cased:
        // 'Active' / 'Inactive' / 'On Leave' / 'Probation' / 'Notice Period'
        // / 'Resigned' / 'Terminated'. Lowercase 'active' is for the related
        // users table, not the employees row — sending it here returns
        // "The selected status is invalid."
        status: 'Active',
        // Stamp macro stage 6 too so a row activated directly from
        // Stage 6 reaches 100% even if the user skipped clicking
        // "Complete Onboarding" first.
        onboarding_stage_completed: 6,
      });
      toast.success(
        'Employee activated',
        `${emp.name} now has full system access. Reporting manager has been notified.`,
      );
      onActivated?.();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Activation failed';
      toast.error('Could not activate employee', String(msg));
    } finally {
      setActivating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={() => { if (!activating) onClose(); }}
      centered
      contentClassName="onb-act-content"
      modalClassName="onb-act-modal"
      backdrop="static"
      keyboard={!activating}
    >
      <ModalBody className="p-0">
        <div className="onb-act-header">
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            disabled={activating}
            aria-label="Close"
          >
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </button>
          <span className="onb-act-icon">
            <i className="ri-user-follow-line" style={{ fontSize: 22 }} />
          </span>
          <h5 className="onb-act-title">Activate Employee</h5>
          <p className="onb-act-sub">This action is final — please confirm all stages are complete</p>
        </div>

        <div className="onb-act-body">
          <div className="onb-act-empcard">
            <span className="onb-act-empcheck"><i className="ri-check-line" style={{ fontSize: 20 }} /></span>
            <div className="min-w-0">
              <h6 className="onb-act-empname">{emp.name}</h6>
              <p className="onb-act-empmeta">
                {emp.department} · {emp.designation}<br />
                Joined: {emp.joinDate}
              </p>
            </div>
          </div>

          <ul className="onb-act-list">
            <li><i className="ri-checkbox-circle-fill" /> Employee status will be set to <b style={{ marginLeft: 4 }}>Active / Completed</b></li>
            <li><i className="ri-checkbox-circle-fill" /> Reporting Manager will be notified via email</li>
            <li><i className="ri-checkbox-circle-fill" /> Full system access will be granted</li>
            <li><i className="ri-checkbox-circle-fill" /> Evidence Vault will be marked as Ready</li>
          </ul>
        </div>

        <div className="onb-act-footer">
          <button
            type="button"
            className="onb-act-cancel"
            onClick={onClose}
            disabled={activating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="onb-act-confirm"
            onClick={handleConfirm}
            disabled={activating}
            style={activating ? { opacity: 0.8, cursor: 'progress' } : undefined}
          >
            {activating ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                  style={{ width: '0.85rem', height: '0.85rem' }}
                />
                Activating…
              </>
            ) : (
              <>
                <i className="ri-check-line" style={{ fontSize: 16 }} /> Confirm Activate
              </>
            )}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function Stage6Verify({
  emp, stagesView, onActivated,
}: {
  emp: OnboardRow;
  /** Live per-stage status computed in the parent. Stage 6 reads
   *  `status === 'Completed'` for each row to decide Verified vs Pending,
   *  so the summary updates the moment the user advances/finishes any
   *  earlier stage — no hardcoded `verified: true` anymore. */
  stagesView: { num: number; status: 'Completed' | 'In Progress' | 'Pending' }[];
  onActivated?: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  // Local flag flipped the instant the activate API succeeds — gives us
  // an immediate "Activated" UI without waiting for the parent's
  // /employees refresh round-trip (~100–500ms). Without this, the user
  // saw the success toast + the still-active Activate button for a
  // moment because emp.raw was stale.
  const [justActivated, setJustActivated] = useState(false);
  // Already-activated guard. Stage 6's Activate button is the entry
  // point to a one-way transition (status → Active, macro stage → 6).
  // Once that's true, re-clicking the button would just open the modal
  // again and re-fire the same PUT — annoying at best, error-prone at
  // worst. We swap the action area for a "completed" card so the user
  // can see the result and move on.
  // `isActivated` still drives the action banner / button toggle below
  // (activation is irreversible — once it happened, we acknowledge it
  // even if earlier stages slipped through). But the HR Final Approval
  // row's "Verified" pill is now gated by a stricter check: the employee
  // must have been activated AND every prior stage must be Completed in
  // `stagesView`. Without that, a user could activate while stages 2–5
  // were still Pending and the wizard would mis-report Onboarding as
  // 6/6 Verified — see screenshot bug.
  const isActivated =
    justActivated
    || String(emp?.raw?.status ?? '').toLowerCase() === 'active'
    || Number(emp?.raw?.onboarding_stage_completed ?? 0) >= 6;
  const isStageDone = (num: number): boolean =>
    !!stagesView.find(s => s.num === num && s.status === 'Completed');
  const allPriorStagesDone =
    isStageDone(1) && isStageDone(2) && isStageDone(3) && isStageDone(4) && isStageDone(5);
  const hrFinalVerified = isActivated && allPriorStagesDone;
  const stageRows: { num: number; name: string; sub: string; icon: string; cls: string; verified: boolean }[] = [
    { num: 1, name: 'Employee Onboarding Setup',     sub: 'Basic details, job info & compensation · Stage 1', icon: 'ri-user-line',                cls: 's1', verified: isStageDone(1) },
    { num: 2, name: 'Document Management',           sub: 'Identity, education & employment docs · Stage 2',  icon: 'ri-file-list-3-line',         cls: 's2', verified: isStageDone(2) },
    { num: 3, name: 'Provisioning & Asset Setup',    sub: 'Email, systems, devices & access · Stage 3',       icon: 'ri-computer-line',            cls: 's3', verified: isStageDone(3) },
    { num: 4, name: 'Payroll & Finance Setup',       sub: 'Bank, PAN, PF/ESIC & salary structure · Stage 4',  icon: 'ri-money-dollar-circle-line', cls: 's4', verified: isStageDone(4) },
    { num: 5, name: 'Policies & Agreements',         sub: 'NDA, employment agreement & signing · Stage 5',    icon: 'ri-shield-check-line',        cls: 's5', verified: isStageDone(5) },
    { num: 6, name: 'HR Final Approval',             sub: 'HR sign-off & verification',                       icon: 'ri-user-star-line',           cls: 's6', verified: hrFinalVerified },
  ];
  const verifiedCount = stageRows.filter(s => s.verified).length;
  const readyPct = Math.round((verifiedCount / stageRows.length) * 100);

  return (
    <>
      {/* Per-stage progress banner removed — sidebar already shows this. */}

      {/* Top info row — employee, role, profile completion */}
      <div className="onb-ver-info-row">
        <div className="onb-ver-info-card">
          <div className="onb-ver-info-avatar" style={{ background: `linear-gradient(135deg, ${emp.accent}, ${emp.accent}cc)` }}>
            {emp.initials}
          </div>
          <div className="min-w-0">
            <h6 className="onb-ver-info-name">{emp.name}</h6>
            <div className="onb-ver-info-sub">{emp.empId}</div>
          </div>
        </div>
        <div className="onb-ver-info-card">
          <div className="min-w-0 flex-grow-1">
            <p className="onb-ver-info-label">Department · Role</p>
            <h6 className="onb-ver-info-name">{emp.department}</h6>
            <div className="onb-ver-info-sub">{emp.designation}</div>
          </div>
        </div>
        <div className="onb-ver-info-card">
          <div className="min-w-0 flex-grow-1">
            <p className="onb-ver-info-label">Profile Completion</p>
            <div className="d-flex align-items-center gap-2 mt-1">
              <div className="onb-ver-info-track">
                <div className="onb-ver-info-fill" style={{ width: `${emp.profile}%` }} />
              </div>
              <span className="onb-ver-info-pct">{emp.profile}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stage Completion Summary */}
      <div className="onb-ver-section">
        <div className="onb-ver-section-head">
          <span className="onb-ver-section-icon summary"><i className="ri-checkbox-circle-line" /></span>
          <h6 className="onb-ver-section-title">Stage Completion Summary</h6>
          <span className="onb-ver-section-pill">{verifiedCount} / {stageRows.length} Verified</span>
        </div>
        {stageRows.map(s => (
          <div key={s.num} className="onb-ver-stage-row">
            <span className={`onb-ver-stage-icon ${s.cls}`}><i className={s.icon} /></span>
            <div className="min-w-0 flex-grow-1">
              <h6 className="onb-ver-stage-name">{s.name}</h6>
              <div className="onb-ver-stage-sub">{s.sub}</div>
            </div>
            <span className={`onb-ver-status-pill ${s.verified ? 'verified' : 'pending'}`}>
              {s.verified ? 'Verified' : 'Pending'}
            </span>
          </div>
        ))}
      </div>

      {/* HR Final Action */}
      <div className="onb-ver-section">
        <div className="onb-ver-section-head">
          <span className="onb-ver-section-icon action"><i className="ri-user-star-line" /></span>
          <h6 className="onb-ver-section-title">HR Final Action</h6>
        </div>
        <div style={{ padding: '14px 16px' }}>
          {isActivated ? null : (
            <div className="onb-ver-action-buttons">
              <button type="button" className="onb-ver-flag-btn" onClick={() => setFlagOpen(true)}>
                <i className="ri-error-warning-line" style={{ fontSize: 16 }} /> Flag Issue
              </button>
              <button type="button" className="onb-ver-activate-btn" onClick={() => setActivateOpen(true)}>
                <i className="ri-checkbox-circle-line" style={{ fontSize: 16 }} /> Activate Employee
              </button>
            </div>
          )}
        </div>
      </div>

      <FlagIssueModal isOpen={flagOpen} onClose={() => setFlagOpen(false)} />
      {/* Confirmation popup intact — clicking Activate Employee still
          opens this modal first ("Activate Employee · This action is
          final — please confirm all stages are complete" with Cancel
          and Confirm Activate buttons). Only after the user clicks
          Confirm Activate does the PUT actually fire. */}
      <ActivateEmployeeModal
        isOpen={activateOpen}
        onClose={() => setActivateOpen(false)}
        emp={emp}
        onActivated={() => {
          // Flip the local guard immediately so the action area
          // switches to the success card without waiting for the
          // parent's /employees refetch, then forward to the parent
          // so the listing page picks up the new status too.
          setJustActivated(true);
          onActivated?.();
        }}
      />
    </>
  );
}
  