import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Col, Row, Button, Modal, ModalBody } from 'reactstrap';
import HrEmployees from '../hrms/HrEmployees';
import { MasterSelect, MasterMultiSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useModulePermission } from '../../hooks/useModulePermission';
import api from '../../api';
import { rankForDesignationName, rankOutranks } from '../../utils/positionHierarchy';
import {
  type SalBreakComp, SPLIT_CODES,
  seedBreakup, absorbIntoSpecial, reseedSplit, planEarningRemoval, statutoryPt, pfDeduction, breakupSignature, validateBreakup,
  CTC_ROUNDING_SLACK,
} from '../../utils/salaryBreakup';
import { PF_WAGE_CEILING, PF_WAGE_CEILING_LABEL } from '../../constants';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import DocGenerateModal from '../hrms/doc-templates/DocGenerateModal';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { ActionIcon, ChipCell, TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import { Shimmer } from '../../components/ui/Shimmer';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { AncillaryRolesChip } from '../../components/AncillaryRolesChip';
import { resolveProbation } from '../../utils/probation';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import EvidenceVaultModal from '../../components/EvidenceVaultModal';
import './HrEmployeeOnboarding.css';
import { SalaryVersionBadge } from '../../components/SalaryVersionBadge';

import '../../../css/recruitment.css';

const forbiddenToast = (err: any): { title: string; message: string } => {
  const serverMsg = String(err?.response?.data?.message ?? '').trim();
  const looksInternal = /^missing\s|\bcan_(view|add|edit|delete|export|import)\b/i.test(serverMsg);
  return {
    title: 'View-only access',
    message: (serverMsg && !looksInternal)
      ? serverMsg
      : 'You have view-only access to this form — you cannot edit it. Ask your administrator if you need edit rights.',
  };
};

const isForbidden = (err: any): boolean => err?.response?.status === 403;

const OPT = (...vals: string[]) => vals.map(v => ({ value: v, label: v }));
const ONB_GENDER       = OPT('Male', 'Female', 'Other');

const ONB_CUSTOM_PROBATION = '__custom_probation__';
const ONB_PROBATION    = [
  ...OPT('Default Probation Policy', '3-Month Probation', '6-Month Probation', 'No Probation'),
  { value: ONB_CUSTOM_PROBATION, label: 'Set Custom Probation…' },
];
const ONB_CUSTOM_NOTICE = '__custom_notice__';
const ONB_NOTICE = [
  ...OPT('Default Notice Period', 'No Notice Period', '15 Days', '30 Days', '60 Days', '90 Days'),
  { value: ONB_CUSTOM_NOTICE, label: 'Set Custom Notice Period…' },
];

const presetValues = (opts: { value: string }[], custom: string) =>
  new Set(opts.map(o => o.value).filter(v => v !== custom));
const ONB_NOTICE_PRESETS    = presetValues(ONB_NOTICE, ONB_CUSTOM_NOTICE);
const ONB_PROBATION_PRESETS = presetValues(ONB_PROBATION, ONB_CUSTOM_PROBATION);

const ONB_WEEKLY_OFF   = OPT(
  'Sunday Only',
  'Saturday & Sunday',
  'Rotational — 1st & 3rd Saturday',
  'Rotational — 2nd & 4th Saturday',
);

const ONB_EXPENSE      = OPT('Applicable', 'Not Applicable');
const ONB_YES_NO       = OPT('No', 'Yes');
const ONB_ACCESS_CARD  = OPT('Not Issued', 'Issued');

const ONB_TAX_REGIME   = OPT('New Regime (115BAC)', 'Old Regime');
const ONB_ACCOUNT_TYPE = OPT('Salary', 'Savings', 'Current');
const ONB_PF_TYPE      = OPT('Statutory', 'Standard');
const ONB_BLOOD_GROUP  = OPT('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');



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
  joinDateIso: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
  ancillaryRoles?: string[];
  managerName: string;
  managerInitials: string;
  managerAccent: string;
  profile: number;
  status: OnboardStatus;
  wizardStep?: number;
  dbId?: number;
  raw?: any;
}

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

const _todayIso = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const _shiftIsoDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const assetSlotAnswered = (flag?: string, assetId?: string): boolean =>
  flag === 'No' || (flag === 'Yes' && !!String(assetId ?? '').trim());

const _shiftYears = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const EMAIL_INVALID = (v: string | null | undefined): boolean =>
  !!v && v.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const normaliseEmail = (raw: string): string => raw.replace(/\s/g, '').toLowerCase();

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
  const SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!SHAPE.test(email)) return 'Enter a valid email like firstname.lastname@company.com.';
  return '';
};

const DOC_MAX_MB = 8;

const DOC_ACCEPTED_MIMES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;
const DOC_ACCEPTED_EXTS  = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;
const DOC_ACCEPT_ATTR    = DOC_ACCEPTED_MIMES.join(',');

const MAX_DOC_NAME_CHARS = 90;
const truncateDocName = (name: string): string =>
  name.length > MAX_DOC_NAME_CHARS ? `${name.slice(0, MAX_DOC_NAME_CHARS)}…` : name;

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
    joinDateIso: e.date_of_joining ? String(e.date_of_joining).slice(0, 10) : '',
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

const KPI_CARDS = [
  { key: 'total',     label: 'Total Employees',           icon: 'ri-team-line',          tint: '#ece6ff', fg: '#7c5cfc', strip: '#7c5cfc', grad: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
  { key: 'progress',  label: 'Onboarding In Progress',    icon: 'ri-time-line',          tint: '#dceefe', fg: '#0c63b0', strip: '#3b82f6', grad: 'linear-gradient(135deg,#3b82f6,#60a5fa)' },
  { key: 'completed', label: 'Onboarding Completed',      icon: 'ri-checkbox-circle-line', tint: '#d6f4e3', fg: '#108548', strip: '#10b981', grad: 'linear-gradient(135deg,#10b981,#34d399)' },
  { key: 'notStart',  label: 'Onboarding Not Initiated',  icon: 'ri-pause-circle-line',  tint: '#fdf3d6', fg: '#a06f00', strip: '#f59e0b', grad: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
  { key: 'missing',   label: 'Missing Profile Details',   icon: 'ri-error-warning-line', tint: '#fdd9d6', fg: '#b1401d', strip: '#f06548', grad: 'linear-gradient(135deg,#f06548,#f8a08a)' },
] as const;

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
      { title: '10th & 12th / Diploma marksheets uploaded',      desc: 'SSC board certificate, plus HSC or diploma certificate with marksheets',           badges: ['REQUIRED', 'ALL'] },
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

const PER_PAGE_KEY = 'cbc.hr.onboarding.perPage';


function OnboardFormSkeleton() {
  const Field = () => (
    <Col md={4}>
      <Shimmer height={10} width="42%" />
      <div style={{ marginTop: 8 }}><Shimmer height={38} /></div>
    </Col>
  );
  return (
    <div aria-hidden>
      {[0, 1].map(section => (
        <div className="onb-init-section" key={section}>
          <div className="onb-init-section-head">
            <Shimmer width={28} height={28} radius={8} />
            <div className="min-w-0 flex-grow-1">
              <Shimmer height={13} width={160} />
              <div style={{ marginTop: 6 }}><Shimmer height={10} width={240} /></div>
            </div>
            <Shimmer width={92} height={20} radius={999} />
          </div>
          <div className="onb-init-section-body">
            <Row className="g-3">
              {Array.from({ length: 6 }, (_, i) => <Field key={i} />)}
            </Row>
          </div>
        </div>
      ))}
    </div>
  );
}

const toAssetOpts = (rows: any[]): AssetOpt[] =>
  (rows ?? []).map((a: any) => ({
    value: String(a.id),
    label: a.label || a.asset_name,
    ...(a.stale_category
      ? { badge: { text: 'Category changed', tone: 'red' as const } }
      : {}),
  }));

const toOvertimeRateOpts = (rows: any[]): { value: string; label: string }[] =>
  rows
    .filter((o: any) => String(o.status ?? 'Active').toLowerCase() === 'active')
    .map((o: any) => { const n = String(o.name ?? o.rate_name ?? '').trim(); return { value: n, label: n }; })
    .filter((o: { value: string }) => o.value !== '');

export default function HrEmployeeOnboarding() {

  const perm = useModulePermission('hr.onboarding', 'onboarding records');

  const empPerm = useModulePermission('hr.employee', 'employee records');

  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [q, setQ] = useState('');
  const [deptFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [checklistOpen, setChecklistOpen] = useState(false);

  const [apiRows, setApiRows] = useState<OnboardRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [page, setPage]       = useState(0);
  const [perPage, setPerPage] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(PER_PAGE_KEY));
      return Number.isFinite(saved) && saved >= 1 && saved <= 200 ? saved : 10;
    } catch {
      return 10;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(PER_PAGE_KEY, String(perPage)); } catch {}
  }, [perPage]);
  const [total, setTotal]     = useState(0);

  const [dataVersion, setDataVersion] = useState(0);

  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(0); }, [debouncedQ, tab]);
  const reloadApiRows = useCallback(() => setDataVersion(v => v + 1), []);

  const listReqRef = useRef(0);
  useEffect(() => {
    const token = ++listReqRef.current;
    setLoadingRows(true);
    api.get('/employees', {
      params: {
        view: 'onboarding',
        onboarding_status: tab,
        page: page + 1,
        per_page: perPage,
        ...(debouncedQ ? { search: debouncedQ } : {}),
      },
    })
      .then(({ data }) => {
        if (token !== listReqRef.current) return;
        const body: any = data ?? {};
        const list = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
        setApiRows(list.map(apiToOnboardRow));
        setTotal(Number(body.total ?? list.length) || 0);
      })
      .catch(() => { if (token === listReqRef.current) { setApiRows([]); setTotal(0); } })
      .finally(() => { if (token === listReqRef.current) setLoadingRows(false); });
  }, [tab, page, perPage, debouncedQ, dataVersion]);

  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultEmp,  setVaultEmp]  = useState<OnboardRow | null>(null);
  const [vaultTab,  setVaultTab]  = useState<'employee' | 'organizational'>('employee');
  const openVault = (row: OnboardRow) => {
    setVaultEmp(row);
    setVaultTab('employee');
    setVaultOpen(true);
  };
  const closeVault = () => { setVaultOpen(false); setVaultEmp(null); };

  const [initiateOpen, setInitiateOpen] = useState(false);
  const [initiateRow,  setInitiateRow]  = useState<OnboardRow | null>(null);
  const openInitiate = (row: OnboardRow) => {
    setInitiateRow(row);
    setInitiateOpen(true);
    if (!row.dbId) return;
    api.get(`/employees/${row.dbId}`).then(r => {
      const full = apiToOnboardRow(r.data);
      setInitiateRow(prev => (prev && prev.empId === full.empId ? full : prev));
      setApiRows(prev => prev.map(x => (x.empId === full.empId ? full : x)));
    }).catch(() => {});
  };
  const closeInitiate = () => {
    setInitiateOpen(false);
    setInitiateRow(null);
    reloadApiRows();
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editRow,  setEditRow]  = useState<OnboardRow | null>(null);
  const [wizardEmpCode, setWizardEmpCode] = useState<string | null>(null);
  const openEdit  = (row: OnboardRow) => {
    if (row?.empId) {
      setWizardEmpCode(row.empId);
      return;
    }
    setEditRow(row);
    setEditOpen(true);
  };
  const closeEdit = () => { setEditOpen(false); setEditRow(null); };
  const closeWizard = () => { setWizardEmpCode(null); reloadApiRows(); };


  useEffect(() => { setStatusFilter('All'); setQ(''); }, [tab]);


  const [counts, setCounts] = useState({ total: 0, progress: 0, completed: 0, notStart: 0, missing: 0, pending: 0 });
  const countsReqRef = useRef(0);
  useEffect(() => {
    const token = ++countsReqRef.current;
    api.get('/employees/onboarding-stats', { params: debouncedQ ? { search: debouncedQ } : undefined })
      .then(({ data }) => {
        if (token !== countsReqRef.current) return;
        setCounts({
          total:     Number(data?.total ?? 0),
          progress:  Number(data?.inProgress ?? 0),
          completed: Number(data?.completed ?? 0),
          notStart:  Number(data?.notStarted ?? 0),
          missing:   Number(data?.missing ?? 0),
          pending:   Number(data?.pending ?? 0),
        });
      })
      .catch(() => {});
  }, [debouncedQ, dataVersion]);

  const rows = apiRows;

  const filtered = useMemo(() => rows
    .filter(r => deptFilter === 'All' || r.department === deptFilter)
    .filter(r => statusFilter === 'All' || r.status === statusFilter),
  [rows, deptFilter, statusFilter]);

  const columns = useMemo<DataTableColumn<OnboardRow>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      meta: { width: '13%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <div className="min-w-0">
              <Tooltip label={r.name} maxWidth={360}>
                <div className="text-truncate" style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{r.name}</div>
              </Tooltip>
              <div className="text-muted" style={{ fontSize: 11.5 }}>{r.joinDate}</div>
            </div>
          </div>
        );
      },
    },
    { header: 'Emp ID', accessorKey: 'empId', meta: { width: '7%', align: 'center' }, cell: info => <span className="onb-id-pill">{String(info.getValue() ?? '')}</span> },
    { header: 'Department',  accessorKey: 'department',  meta: { width: '8%', align: 'center' },  cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Designation', accessorKey: 'designation', meta: { width: '9%', align: 'center' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Primary Role',
      accessorKey: 'primaryRole',
      meta: { width: '9%', align: 'center' },
      cell: info => <ChipCell value={info.getValue() as string} className="onb-role-pill" />,
    },
    {
      header: 'Ancillary Role',
      id: 'ancillary',
      enableSorting: false,
      meta: { width: '9%' },
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
      meta: { width: '9%' },
      cell: info => {
        const r = info.row.original;
        if (r.managerName === '—') return <span style={{ fontSize: 13 }} className="text-muted">—</span>;
        return (
          <Tooltip label={r.managerName} maxWidth={360}>
            <span style={{ fontSize: 13 }} className="text-truncate d-block">{r.managerName}</span>
          </Tooltip>
        );
      },
    },
    {
      header: 'Profile %',
      accessorKey: 'profile',
      meta: { width: '8%', wrap: true, align: 'center' },
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
      meta: { width: '16%', align: 'center', wrap: true },
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
        const notJoinedYet = !!r.joinDateIso && r.joinDateIso > new Date().toISOString().slice(0, 10);
        return (
          <div className="d-flex align-items-center justify-content-center gap-2 flex-nowrap">
            <Tooltip label={empPerm.lockedTitle('edit') ?? 'Edit Employee'}>
              <button
                type="button"
                className="onb-edit-btn flex-shrink-0"
                aria-label="Edit Employee"
                aria-disabled={!empPerm.canEdit || undefined}
                style={empPerm.canEdit ? undefined : { opacity: .5, cursor: 'not-allowed', filter: 'grayscale(0.7)' }}
                onClick={() => empPerm.guard('edit', () => openEdit(r))}
              >
                <ActionIcon icon="edit-svg" />
              </button>
            </Tooltip>
            <Tooltip label={notJoinedYet
              ? `Joins on ${r.joinDate} — onboarding opens that day`
              : (perm.lockedTitle('add') ?? 'Start the onboarding wizard for this employee')}>
              <span className="d-inline-flex">
                <button
                  type="button"
                  className="onb-init-btn is-compact flex-shrink-0"
                  aria-label="Initiate Onboarding"
                  disabled={notJoinedYet}
                  aria-disabled={!perm.canAdd || undefined}
                  style={notJoinedYet || !perm.canAdd
                    ? { opacity: .5, cursor: 'not-allowed', filter: perm.canAdd ? undefined : 'grayscale(0.7)' }
                    : undefined}
                  onClick={() => perm.guard('add', () => openInitiate(r))}
                >
                  <i className="ri-add-line" style={{ fontSize: 13 }} />
                  Initiate Onboarding
                </button>
              </span>
            </Tooltip>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tab, perm.canAdd, perm.canEdit, empPerm.canEdit]);

  return (
    <>
      <MasterFormStyles />

      <div className="onb-page">

      <div className="frm-cstrip hr-cstrip mb-3">
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

      <Row className="g-1 mb-3 align-items-stretch">
        {KPI_CARDS.map(k => (
          <Col key={k.key} xl={true} md={4} sm={6} xs={12}>
            <div
              className="onb-surface onb-kpi-card"
              style={{
                borderRadius: 14,
                border: '1px solid var(--vz-border-color)',
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
                  <h3 style={{ fontSize: 26, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
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

      <DataTable<OnboardRow>
        data={filtered}
        columns={columns}
        serial={{ header: 'Sr No', width: '4%' }}
        accent="violet"
        minWidth={1500}
        fitToViewport
        autoFitRows
        loading={loadingRows}
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search name, ID, department…"
        minAutoRows={10}
        serverPagination={{
          total,
          pageIndex: page,
          onPageChange: setPage,
          onPageSizeChange: setPerPage,
        }}
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

      </div>

      <ChecklistModal isOpen={checklistOpen} onClose={() => setChecklistOpen(false)} />

      <EvidenceVaultModal
        employee={vaultOpen && vaultEmp?.dbId ? {
          id: vaultEmp.dbId,
          empId: vaultEmp.empId,
          name: vaultEmp.name,
          department: vaultEmp.department,
          designation: vaultEmp.designation,
        } : null}
        onClose={closeVault}
        initialTab={vaultTab}
      />

      <InitiateOnboardingModal
        isOpen={initiateOpen}
        onClose={closeInitiate}
        emp={initiateRow}
        onSaved={() => {
          const dbId = initiateRow?.dbId;
          if (!dbId) return;
          api.get(`/employees/${dbId}`).then(r => {
            const row = apiToOnboardRow(r.data);
            setApiRows(prev => prev.map(x => x.empId === row.empId ? row : x));
            setInitiateRow(prev => (prev && prev.empId === row.empId ? row : prev));
          }).catch(() => {});
        }}
      />

      {wizardEmpCode && (
        <HrEmployees embedEditCode={wizardEmpCode} onEmbedClose={closeWizard} />
      )}

      <EditEmployeeModal
        isOpen={editOpen}
        onClose={closeEdit}
        emp={editRow}
      />
    </>
  );
}

const EDIT_DEPT_OPTIONS = DEPT_OPTIONS.filter(o => o.value !== 'All');
const EDIT_STATUS_OPTIONS = OPT('Active', 'On Probation', 'Inactive');
const EDIT_WORK_TYPE_OPTIONS = OPT('Full Time', 'Part Time', 'Contract', 'Intern');

function EditEmployeeModal({ isOpen, onClose, emp }: { isOpen: boolean; onClose: () => void; emp: OnboardRow | null }) {
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
          <div className="d-flex align-items-center gap-3">
            <span className="onb-ee-icon"><i className="ri-user-3-line" style={{ fontSize: 20 }} /></span>
            <div className="min-w-0">
              <h5 className="onb-ee-title">Edit Employee</h5>
              <p className="onb-ee-sub">Update details for {emp.name}</p>
            </div>
          </div>
        </div>

        <div className="onb-ee-body">
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
                <label className="onb-ee-label">Employee ID <span className="auto">AUTO</span></label>
                <input className="onb-ee-input is-readonly" value={empId} readOnly />
              </Col>
            </Row>
          </div>

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

export type SignedDocRun = {
  id: number;
  code: string | null;
  status: string;
  template_id: number;
  template?: { id: number; code: string; name: string; doc_type: string | null } | null;
  trigger_point_name?: string | null;
  signers?: Array<{
    name?: string | null; role_name?: string | null; action?: string | null;
    status?: string; acted_at?: string | null; signed_name?: string | null;
    signature_url?: string | null;
  }> | null;
  content_html?: string | null;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const signedRunAt = (r: SignedDocRun): string | null => {
  const acted = (r.signers || []).map(s => s.acted_at).filter(Boolean) as string[];
  if (acted.length) return acted.slice().sort()[acted.length - 1];
  return r.updated_at || r.created_at || null;
};

const fmtSignedStamp = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  const time  = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day} ${month} ${d.getFullYear()}, ${time}`;
};

export function SignedDocumentsSection({ runs, emptyHint }: {
  runs: SignedDocRun[];
  emptyHint?: string;
}) {
  const toast = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const [viewRun, setViewRun] = useState<SignedDocRun | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const groups = useMemo(() => {
    const byTpl = new Map<number, SignedDocRun[]>();
    for (const r of runs) {
      if (r.status !== 'Completed') continue;
      const arr = byTpl.get(r.template_id) || [];
      arr.push(r);
      byTpl.set(r.template_id, arr);
    }
    const out: { latest: SignedDocRun; older: SignedDocRun[] }[] = [];
    for (const arr of byTpl.values()) {
      arr.sort((a, b) => b.id - a.id);
      out.push({ latest: arr[0], older: arr.slice(1) });
    }
    return out.sort((a, b) => {
      const da = signedRunAt(a.latest) || '', db = signedRunAt(b.latest) || '';
      if (da !== db) return da < db ? 1 : -1;
      return b.latest.id - a.latest.id;
    });
  }, [runs]);

  const download = async (run: SignedDocRun) => {
    if (downloadingId !== null) return;
    setDownloadingId(run.id);
    try {
      const resp = await api.get(`/hr-document-signatures/${run.id}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${run.code || `doc-${run.id}`}-signed.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Signed PDF saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally { setDownloadingId(null); }
  };

  return (
    <>
      <div className="onb-pol-section">
        <div className="onb-pol-section-head">
          <span className="onb-pol-section-icon" style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
            <i className="ri-quill-pen-line" />
          </span>
          <h6 className="onb-pol-section-title">Signed Documents</h6>
          <span className="onb-pol-section-pill">{groups.length} signed</span>
        </div>

        {groups.length === 0 && (
          <div style={{ padding: 22, textAlign: 'center', borderRadius: 10, background: 'var(--vz-light, #f9fafb)', border: '1px dashed var(--vz-border-color, #e5e7eb)' }}>
            <i className="ri-quill-pen-line" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#9ca3af' }} />
            <div style={{ fontSize: 13, color: 'var(--vz-secondary-color, #6b7280)' }}>
              {emptyHint || <>No signed documents yet. A document lands here once <strong>every</strong> signer in its workflow has signed.</>}
            </div>
          </div>
        )}

        {groups.map(({ latest: run, older }) => {
          const isOpen = openId === run.id;
          const toggle = () => setOpenId(prev => prev === run.id ? null : run.id);
          const title = run.template?.name || run.code || `Document #${run.id}`;
          const docType = run.template?.doc_type || 'Document';
          const when = signedRunAt(run);
          const signerCount = (run.signers || []).length;
          const busy = downloadingId === run.id;
          return (
            <div
              key={run.id}
              className={`onb-pol-doc${isOpen ? ' is-expanded' : ''}`}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={toggle}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
            >
              <div className="onb-pol-doc-row">
                <span className="onb-pol-doc-icon" style={{ background: '#d1fae5', color: '#047857' }}>
                  <i className="ri-file-shield-2-line" />
                </span>
                <div className="onb-pol-doc-meta">
                  <h6 className="onb-pol-doc-name">
                    {title}{' '}
                    {run.code && <span className="vault-doc-code">{run.code}</span>}
                    {run.trigger_point_name && (
                      <span className="onb-doc-tag" style={{ marginLeft: 6, background: '#eef2ff', color: '#4338ca', borderColor: '#c7d2fe' }}>
                        {run.trigger_point_name}
                      </span>
                    )}
                    {older.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                        · {older.length} earlier cop{older.length === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                  </h6>
                  <p className="onb-pol-doc-sub">
                    {docType}
                    {' · '}{signerCount} signer{signerCount === 1 ? '' : 's'}
                    {when ? ` · Signed ${fmtSignedStamp(when)}` : ''}
                  </p>
                </div>
                <span className="onb-pol-doc-status" style={{ color: '#10b981' }}>
                  <span className="dot" style={{ background: '#10b981' }} />
                  Signed
                </span>
                <button
                  type="button"
                  className="onb-pol-gen-btn"
                  onClick={(e) => { e.stopPropagation(); setViewRun(run); }}
                  title="View the signed document"
                  style={{ background: 'transparent', border: '1px solid var(--vz-border-color)', color: 'var(--vz-body-color)', cursor: 'pointer' }}
                >
                  <i className="ri-eye-line" /> View
                </button>
                <button
                  type="button"
                  className="onb-pol-gen-btn"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); download(run); }}
                  title="Download the signed PDF (all signatures embedded)"
                  style={{ marginLeft: 8, background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 0, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                >
                  <i className={busy ? 'ri-loader-4-line onb-spin' : 'ri-file-pdf-2-line'} /> {busy ? 'Downloading…' : 'Download'}
                </button>
                <span
                  className="onb-pol-doc-chev"
                  style={{
                    marginLeft: 6, color: 'var(--vz-secondary-color)', fontSize: 18,
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform .18s ease',
                  }}
                  aria-hidden
                >
                  <i className="ri-arrow-down-s-line" />
                </span>
              </div>

              {isOpen && (
                <div className="ep-signing" style={{ margin: '4px 16px 12px' }}>
                  <div className="ep-signing-head">
                    <i className="ri-quill-pen-line" />Signature Trail
                    <span className="ep-signing-pct">{signerCount}/{signerCount} signed</span>
                  </div>
                  <div className="ep-signing-flow">
                    {(run.signers || []).map((s, i) => (
                      <div key={i} className="ep-signer">
                        <span className="ep-signer-dot">{i + 1}</span>
                        <span className="ep-signer-name">
                          {s.signed_name || s.name || s.role_name || `Signer ${i + 1}`}
                          {s.role_name && (
                            <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                              ({s.role_name})
                            </span>
                          )}
                          {s.acted_at && (
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 500, marginTop: 1 }}>
                              Signed · {fmtSignedStamp(s.acted_at)}
                            </span>
                          )}
                        </span>
                        {s.signature_url && (
                          <img
                            src={resolveFileUrl(s.signature_url)}
                            alt={`Signature of ${s.signed_name || s.name || 'signer'}`}
                            style={{ maxHeight: 30, maxWidth: 110, objectFit: 'contain', marginRight: 10 }}
                          />
                        )}
                        <span className="ep-signer-state">Signed</span>
                      </div>
                    ))}
                  </div>

                  {older.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--vz-border-color)' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', marginBottom: 6 }}>
                        Earlier signed copies
                      </div>
                      {older.map(o => (
                        <div key={o.id} className="d-flex align-items-center gap-2" style={{ padding: '4px 0', fontSize: 12 }}>
                          <i className="ri-file-pdf-2-line" style={{ color: '#0e7490' }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {o.code || `Run #${o.id}`}
                            <span style={{ color: 'var(--vz-secondary-color)' }}> · {fmtSignedStamp(signedRunAt(o))}</span>
                          </span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setViewRun(o); }}
                            style={{ background: 'transparent', border: 0, color: 'var(--vz-secondary-color)', cursor: 'pointer', fontSize: 12 }}>
                            <i className="ri-eye-line" /> View
                          </button>
                          <button type="button" disabled={downloadingId === o.id}
                            onClick={(e) => { e.stopPropagation(); download(o); }}
                            style={{ background: 'transparent', border: 0, color: '#0e7490', cursor: downloadingId === o.id ? 'wait' : 'pointer', fontSize: 12 }}>
                            <i className={downloadingId === o.id ? 'ri-loader-4-line onb-spin' : 'ri-download-2-line'} /> Download
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal isOpen={!!viewRun} toggle={() => setViewRun(null)} size="lg" centered
        contentClassName="border-0" modalClassName="vault-preview-modal" backdrop="static">
        <ModalBody className="p-0">
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg,#047857 0%,#059669 60%,#10b981 100%)', borderRadius: '18px 18px 0 0' }}>
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-2 min-w-0">
                <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ri-file-shield-2-line" style={{ fontSize: 18, color: '#fff' }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>
                    {viewRun?.template?.name || viewRun?.code || 'Signed Document'}
                  </h5>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                    Signed copy{viewRun?.code ? ` · ${viewRun.code}` : ''}
                    {viewRun && signedRunAt(viewRun) ? ` · ${fmtSignedStamp(signedRunAt(viewRun))}` : ''}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setViewRun(null)} aria-label="Close" className="tpl-prev-x"
                style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div style={{ padding: 16, background: 'var(--vz-secondary-bg, #f9fafb)', maxHeight: '70vh', overflowY: 'auto' }}>
            <HeaderFooterPanel
              header={{ ...DEFAULT_HEADER, ...(viewRun?.header_config || {}) } as HeaderConfig} setHeader={() => {}}
              footer={{ ...DEFAULT_FOOTER, ...(viewRun?.footer_config || {}) } as FooterConfig} setFooter={() => {}}
              readOnly
            >
              <div className="tpl-readonly-preview"
                style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                dangerouslySetInnerHTML={{ __html: viewRun?.content_html || '<p style="color:#9ca3af;font-style:italic;">(no stored content for this run)</p>' }}
              />
            </HeaderFooterPanel>
          </div>

          <div className="tpl-prev-foot" style={{ padding: 12, borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-card-bg, #fff)', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 6px 6px' }}>
            <button type="button" onClick={() => setViewRun(null)}
              className="tpl-prev-btn tpl-prev-btn--ghost"
              style={{ padding: '7px 14px', background: 'var(--vz-card-bg, #fff)', border: '1px solid var(--vz-border-color, #d1d5db)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--vz-body-color, #374151)', cursor: 'pointer' }}>
              Close
            </button>
            {viewRun && (
              <button type="button" disabled={downloadingId === viewRun.id}
                onClick={() => download(viewRun)}
                className="tpl-prev-btn"
                style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#0891b2,#0e7490)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: downloadingId === viewRun.id ? 'wait' : 'pointer' }}>
                <i className={downloadingId === viewRun.id ? 'ri-loader-4-line onb-spin me-1' : 'ri-file-pdf-2-line me-1'} />
                {downloadingId === viewRun.id ? 'Downloading…' : 'Download PDF'}
              </button>
            )}
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}


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

function ChecklistModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [level, setLevel] = useState<string>('all');
  const [empType, setEmpType] = useState<string>('all');

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
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
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

        <div className="onb-cl-footer">
          <span className="hint">{levelLabel} · {typeLabel} · {totalCheckpoints} checkpoints visible</span>
          <button type="button" className="onb-cl-close" onClick={onClose}>Close</button>
        </div>
      </ModalBody>
    </Modal>
  );
}

type StageStatus = 'Completed' | 'In Progress' | 'Pending';
const ONB_STAGES: { num: number; key: string; label: string; stage: string; sub: string; icon: string; status: StageStatus; progress: number }[] = [
  { num: 1, key: 'setup',     label: 'Setup',     stage: 'Employee Onboarding Setup',      sub: 'Profile verification & required details',  icon: 'ri-user-line',         status: 'Completed',  progress: 100 },
  { num: 2, key: 'docs',      label: 'Docs',      stage: 'Document Management',            sub: 'Identity, education & employment documents', icon: 'ri-file-list-3-line', status: 'In Progress', progress: 35  },
  { num: 3, key: 'provision', label: 'Provision', stage: 'Provisioning & Asset Setup',     sub: 'Hardware, IT access, and security provisioning', icon: 'ri-computer-line',  status: 'Pending',     progress: 0   },
  { num: 4, key: 'payroll',   label: 'Payroll',   stage: 'Payroll & Finance Setup',        sub: 'Bank, tax, and statutory enrolments',       icon: 'ri-bank-card-line',     status: 'Pending',     progress: 0   },
  { num: 5, key: 'policies',  label: 'Policies',  stage: 'Policies & Agreements',          sub: 'NDA, code of conduct, and policy acknowledgements', icon: 'ri-shield-check-line', status: 'Pending', progress: 0 },
  { num: 6, key: 'verify',    label: 'Verify',    stage: 'Final Verification & Activation',sub: 'Final review and activation of employee record', icon: 'ri-checkbox-circle-line', status: 'Pending', progress: 0 },
];

type DocStatus = 'Pending' | 'Uploaded' | 'Verified' | 'Rejected' | 'Optional';
interface ChecklistDoc {
  id: string;
  name: string;
  sub: string;
  status: DocStatus;
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
      { id: 'cur_addr',  name: 'Current Address Proof',   sub: 'Utility Bill / Rent Agreement — max 6 months old · 2 MB', maxMb: 2, status: 'Optional' },
      { id: 'perm_addr', name: 'Permanent Address Proof', sub: 'Govt-issued address proof · max 2 MB',                    maxMb: 2, status: 'Pending' },
    ],
  },
  {
    id: 'education', title: 'Education Documents', icon: 'ri-graduation-cap-line', tint: '#d3f0ee', fg: '#0a716a',
    docs: [
      { id: 'ssc',  name: '10th Marksheet (SSC / Matriculation)', sub: 'Board certificate + mark sheet · max 2 MB',         maxMb: 2, status: 'Pending'  },
      { id: 'hsc',  name: '12th Marksheet / Diploma',              sub: 'HSC / Intermediate board certificate, or diploma certificate + mark sheet · max 2 MB', maxMb: 2, status: 'Pending'  },
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

const STAGE2_COMPANY_DOCS: { id: string; name: string; status: DocStatus; maxMb?: number }[] = [
  { id: 'exp_letter',   name: 'Experience Letter',          status: 'Pending',  maxMb: 5 },
  { id: 'rel_letter',   name: 'Relieving Letter',           status: 'Pending',  maxMb: 5 },
  { id: 'salary_slips', name: 'Last 3 Months Salary Slips', status: 'Pending',  maxMb: 8 },
  { id: 'offer_letter', name: 'Previous Offer Letter',      status: 'Optional', maxMb: 5 },
];


function InitiateOnboardingModal({
  isOpen, onClose, emp, onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const leavePerm = useModulePermission('hr.leave', 'leave plans');
  const empPerm = useModulePermission('hr.employee', 'employee records');
  const readOnly = !empPerm.canEdit;
  const [activeStage, setActiveStage] = useState(1);
  const [stage5Total, setStage5Total]   = useState(0);
  const [stage5Signed, setStage5Signed] = useState(0);
  const [stage5Sent, setStage5Sent]     = useState(0);
  const [coreReady, setCoreReady] = useState(false);
  const [stage5Loaded, setStage5Loaded] = useState(false);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) { setStage5Total(0); setStage5Signed(0); setStage5Sent(0); setStage5Loaded(false); return; }
    if (!coreReady) return;
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, runRes] = await Promise.all([
          api.get('/hr-document-templates/match', { params: { employee_id: emp.dbId, trigger_keyword: 'onboarding' } }),
          api.get('/hr-document-signatures', { params: { employee_id: emp.dbId } }),
        ]);
        if (cancelled) return;
        const tpls: any[] = (Array.isArray(tplRes.data?.templates) ? tplRes.data.templates : [])
          .filter((t: any) => !/\b(leave|attendance)\b/i.test(t.name || ''));
        const runs: any[] = Array.isArray(runRes.data) ? runRes.data : [];
        const latest = new Map<number, any>();
        runs.forEach(r => { const t = r.template_id; if (t == null) return; const p = latest.get(t); if (!p || r.id > p.id) latest.set(t, r); });
        const dispatched = new Set(
          runs.filter(r => r.status !== 'Cancelled')
              .map(r => r.template_id)
              .filter((id: any) => id != null),
        );
        setStage5Total(tpls.length);

        const accountable = new Set<number>([
          ...dispatched,
          ...tpls.filter(t => dispatched.has(t.id)).map(t => t.id),
        ]);
        setStage5Sent(accountable.size);
        setStage5Signed(
          [...accountable].filter(id => latest.get(id)?.status === 'Completed').length,
        );
        setStage5Loaded(true);
      } catch { if (!cancelled) { setStage5Total(0); setStage5Signed(0); setStage5Sent(0); setStage5Loaded(false); } }
    })();
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId, coreReady]);

  const handleStage5Progress = useCallback((p: { signed: number; sent: number; total: number }) => {
    setStage5Signed(p.signed);
    setStage5Sent(p.sent);
    setStage5Total(p.total);
    setStage5Loaded(true);
  }, []);

  const stage2Ref = useRef<Stage2DocumentsHandle | null>(null);
  const [stage2Prev, setStage2Prev] = useState<{ required: number; uploaded: number } | null>(null);
  useEffect(() => { if (isOpen) setActiveStage(1); }, [isOpen, emp?.id]);


  const [mCountries, setMCountries]       = useState<{ id: number; name: string }[]>([]);
  const [mDepts, setMDepts]               = useState<{ id: number; name: string }[]>([]);
  const [mDesignations, setMDesignations] = useState<{ id: number; name: string }[]>([]);
  const [mRoles, setMRoles]               = useState<{ id: number; name: string }[]>([]);
  const [mLegalEntities, setMLegalEntities] = useState<{ id: number; name: string; city?: string | null; country?: string | null; location?: string }[]>([]);
  const [managerOpts, setManagerOpts]       = useState<{ value: string; label: string; deptId?: string; isHod?: boolean; rank?: number | null }[]>([]);
  const [leavePlanOpts, setLeavePlanOpts] = useState<{ value: string; label: string }[]>([]);
  const [leavePlanAll, setLeavePlanAll] = useState<{ value: string; label: string }[]>([]);
  const [overtimeRateOpts, setOvertimeRateOpts] = useState<{ value: string; label: string }[]>([]);
  const reloadOvertimeRates = useCallback((isStale: () => boolean = () => false) =>
    api.get('/master/overtime_rates').then(r => {
      if (isStale()) return;
      const rows = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
      setOvertimeRateOpts(toOvertimeRateOpts(rows));
    }).catch(() => { if (!isStale()) setOvertimeRateOpts([]); }), []);
  const [overtimeApplicable, setOvertimeApplicable] = useState('No');
  const [mHolidayGroups, setMHolidayGroups] = useState<any[]>([]);
  const [branchShiftOpts, setBranchShiftOpts] = useState<{ value: string; label: string }[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMastersLoading(true);
    setCoreReady(false);
    const masters =
      api.get('/master/bulk', {
        params: {
          keys: 'departments,designations,roles,overtime_rates,countries',
          fields: 'id,name,status',
        },
      }).then(r => {
        if (cancelled) return;
        const d = r.data?.data ?? {};
        const rows = (k: string): any[] => {
          const v = d[k];
          return Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
        };
        setMDepts(rows('departments'));
        setMDesignations(rows('designations'));
        setMRoles(rows('roles'));
        setMCountries(
          [...rows('countries')].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))),
        );
        setOvertimeRateOpts(toOvertimeRateOpts(rows('overtime_rates')));
      }).catch(() => {
        if (cancelled) return;
        setMDepts([]); setMDesignations([]); setMRoles([]);
        setMCountries([]); setOvertimeRateOpts([]);
      });

    const loadRest = () => api.get('/employees/onboarding-form-bootstrap', {
      params: emp?.dbId ? { employee_id: emp.dbId } : {},
    }).then(r => {
      if (cancelled) return;
      const d = r.data?.data ?? {};

      setMLegalEntities(Array.isArray(d.legal_entities?.legal_entities) ? d.legal_entities.legal_entities : []);

      const merged = [
        ...((d.managers?.employees   ?? []) as any[]),
        ...((d.managers?.login_users ?? []) as any[]),
      ];
      const selfId = emp?.dbId ?? null;
      const filteredMgrs = selfId
        ? merged.filter(m => !(m.kind === 'employee' && Number(m.id) === Number(selfId)))
        : merged;
      setManagerOpts(filteredMgrs.map(m => ({
        value: `${m.kind}:${m.id}`,
        label: m.label,
        deptId: m.department_id != null ? String(m.department_id) : undefined,
        isHod: !!m.is_hod,
        rank: m.rank ?? null,
      })));

      const plans = Array.isArray(d.leave_plans) ? d.leave_plans
        : (Array.isArray(d.leave_plans?.data) ? d.leave_plans.data : []);
      const planOpt = (p: any) => ({ value: String(p.id), label: p.plan_name || p.name || `Plan ${p.id}` });
      setLeavePlanOpts(plans.filter((p: any) => p.setup_complete).map(planOpt));
      setLeavePlanAll(plans.map(planOpt));

      setMHolidayGroups(Array.isArray(d.holiday_groups) ? d.holiday_groups : []);

      const shifts = Array.isArray(d.branch_shifts?.shifts) ? d.branch_shifts.shifts : [];
      setBranchShiftOpts(shifts
        .filter((s: any) => s?.name)
        .map((s: any) => ({
          value: s.name,
          label: s.start && s.end ? `${s.name} (${s.start}–${s.end})` : s.name,
        })));

      if (emp?.dbId) {
        setLaptopAssets(toAssetOpts(d.assets_laptop));
        setMobileAssets(toAssetOpts(d.assets_mobile));
        setOtherAssets(toAssetOpts(d.assets_other));
        setAssetsLoading(false);
      }
    }).catch(() => {
      if (cancelled) return;
      setMLegalEntities([]); setManagerOpts([]); setLeavePlanOpts([]);
      setMHolidayGroups([]); setBranchShiftOpts([]);
      setLaptopAssets([]); setMobileAssets([]); setOtherAssets([]);
      setAssetsLoading(false);
    });
    masters
      .then(() => (cancelled ? undefined : loadRest()))
      .then(() => {
        if (cancelled) return;
        setMastersLoading(false);
        setCoreReady(true);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const countryOpts     = mCountries.map(c => ({ value: String(c.id), label: c.name }));
  const departmentOpts  = mDepts.map(d => ({ value: String(d.id), label: d.name }));
  const designationOpts = mDesignations
    .filter(d => d?.name !== 'Director / CEO')
    .map(d => ({ value: String(d.id), label: d.name }));
  const hodDesignationId = (() => {
    const h = mDesignations.find(d => d?.name === 'Head of Department (HOD)');
    return h ? String(h.id) : '';
  })();
  const roleOpts        = mRoles.map(r => ({ value: String(r.id), label: r.name }));
  const holidayGroupOpts = mHolidayGroups
    .filter(g => String(g.status ?? 'Active').toLowerCase() !== 'inactive')
    .filter(g => Number(g.holidays_count ?? 0) > 0)
    .map(g => ({ value: String(g.id), label: g.name }));
  const autoLegalEntity = mLegalEntities.length === 1 ? mLegalEntities[0] : null;

  type AssetOpt = { value: string; label: string; badge?: { text: string; tone?: 'green' | 'red' | 'gray' | 'violet' } };
  const [laptopAssets, setLaptopAssets] = useState<AssetOpt[]>([]);
  const [mobileAssets, setMobileAssets] = useState<AssetOpt[]>([]);
  const [otherAssets, setOtherAssets]   = useState<AssetOpt[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const reloadAssets = useCallback((isStale: () => boolean = () => false) => {
    if (!emp?.dbId) return Promise.resolve();
    setAssetsLoading(true);
    const url = (cat: string) => `/employees/available-assets?category=${cat}&exclude_employee_id=${emp.dbId}`;
    const put = (setter: (o: AssetOpt[]) => void) => (r: any) => {
      if (!isStale()) setter(toAssetOpts(r.data));
    };
    return Promise.allSettled([
      api.get(url('laptop')).then(put(setLaptopAssets)),
      api.get(url('mobile')).then(put(setMobileAssets)),
      api.get(url('other')).then(put(setOtherAssets)),
    ]).then(() => { if (!isStale()) setAssetsLoading(false); });
  }, [emp?.dbId]);

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
    ancillary_role_ids: [] as string[],
    legal_entity_id:  '',
    location:         '',
    reporting_manager: '',
    date_of_joining:  '',
    probation_policy: '',
    notice_period:    '',

    leave_plan: '', holiday_list: '', shift: '', weekly_off: '',
    attendance_number: '', time_tracking: '', penalization_policy: '',
    overtime: '', expense_policy: '',
    laptop_assigned: '', laptop_asset_id: '', mobile_device: '', other_assets: '',
    laptop_master_asset_id: '',
    mobile_assigned: '',
    mobile_master_asset_id: '',
    other_master_asset_ids: [] as string[],
    biometric_status:    '',
    desk_workstation_no: '',
    id_card_status:      '',
    attendance_tracking: true,

    enable_payroll: true,
    pay_group: '', annual_salary: '', salary_frequency: 'Per annum',
    salary_effective_from: '', salary_structure: '', tax_regime: '',
    bonus_in_annual: false, pf_eligible: null as boolean | null, detailed_breakup: false,
    pf_type: 'Statutory',
  });

  const [obEarnings, setObEarnings]     = useState<SalBreakComp[]>([]);
  const [obDeductions, setObDeductions] = useState<SalBreakComp[]>([]);
  const [obEsi, setObEsi]               = useState(false);
  const [obPt, setObPt]                 = useState(false);
  const [obBreakupLoading, setObBreakupLoading] = useState(false);
  const [obSalaryVersion, setObSalaryVersion] = useState<{ version: number; from: string | null } | null>(null);
  const obLoadedForRef  = useRef<number | null>(null);
  const obSeededForRef  = useRef<string | null>(null);
  const obBaselineRef   = useRef<string | null>(null);

  const obMonthlyOf = useCallback((salary: string) => {
    const entered = salary === '' ? 0 : Number(salary);
    if (!Number.isFinite(entered)) return 0;
    return s1.salary_frequency === 'Per month' ? entered : entered / 12;
  }, [s1.salary_frequency]);

  const obSalaryRef = useRef(s1.annual_salary);
  useEffect(() => { obSalaryRef.current = s1.annual_salary; }, [s1.annual_salary]);

  useEffect(() => {
    if (!isOpen || !emp?.dbId) { obLoadedForRef.current = null; return; }
    if (!coreReady) return;
    if (obLoadedForRef.current === emp.dbId) return;
    obLoadedForRef.current = emp.dbId;
    let cancelled = false;

    const seedFresh = () => {
      if (cancelled) return;
      setObEarnings(seedBreakup(obMonthlyOf(obSalaryRef.current)));
      setObDeductions([]);
      setObEsi(false);
      setObPt(false);
      obBaselineRef.current = null;
    };

    setObBreakupLoading(true);
    setObSalaryVersion(null);
    api.get('/salary-structures', { params: { employee_id: emp.dbId, active_only: 1 } })
      .then(res => {
        if (cancelled) return;
        const rows = res.data?.data ?? [];
        const active = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (active && Array.isArray(active.earnings) && active.earnings.length) {
          const earn = active.earnings.map((c: any) => ({
            code: String(c.code ?? ''), label: String(c.label ?? c.code ?? ''), amount: Number(c.amount) || 0,
          }));
          const ded = (Array.isArray(active.deductions) ? active.deductions : []).map((c: any) => ({
            code: String(c.code ?? ''), label: String(c.label ?? c.code ?? ''), amount: Number(c.amount) || 0,
          }));
          setObEarnings(earn);
          setObDeductions(ded);
          setObSalaryVersion(active.version ? { version: Number(active.version), from: active.effective_from ?? null } : null);
          setObEsi(!!active.esi_applicable || ded.some((d: SalBreakComp) => d.code === 'esi'));
          setObPt(!!active.pt_applicable  || ded.some((d: SalBreakComp) => d.code === 'pt'));
          obBaselineRef.current = `${breakupSignature(earn, ded, !!active.pf_applicable, !!active.esi_applicable, !!active.pt_applicable, s1.pf_type)}|${Math.round((Number(active.monthly_gross) || 0) * 12)}`;
        } else {
          seedFresh();
        }
      })
      .catch(seedFresh)
      .finally(() => {
        if (cancelled) return;
        setObBreakupLoading(false);
        obSeededForRef.current = obSalaryRef.current;
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, emp?.dbId, coreReady]);

  const [obRecalcing, setObRecalcing] = useState(false);

  const [obSettledSalary, setObSettledSalary] = useState(s1.annual_salary);
  useEffect(() => {
    const t = setTimeout(() => {
      setObSettledSalary(s1.annual_salary);
      setObRecalcing(false);
    }, 500);
    return () => clearTimeout(t);
  }, [s1.annual_salary]);

  useEffect(() => {
    setObRecalcing(false);
    if (!isOpen || !s1.detailed_breakup) return;
    if (obLoadedForRef.current === null) return;
    if (obSeededForRef.current === obSettledSalary) return;
    obSeededForRef.current = obSettledSalary;
    const monthly = obMonthlyOf(obSettledSalary);
    setObEarnings(prev => reseedSplit(prev, monthly));
    setObDeductions(prev => prev.map(d => (
      d.code === 'pt' ? { ...d, amount: statutoryPt(monthly, s1.gender) } : d
    )));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obSettledSalary, s1.salary_frequency, s1.detailed_breakup]);

  const obGross = useMemo(() => obEarnings.reduce((s, c) => s + (Number(c.amount) || 0), 0), [obEarnings]);
  const obDed   = useMemo(() => obDeductions.reduce((s, c) => s + (Number(c.amount) || 0), 0), [obDeductions]);
  const obBasic = useMemo(() => Number(obEarnings.find(c => c.code === 'basic')?.amount) || 0, [obEarnings]);
  const obPfActive = s1.enable_payroll !== false && !!s1.pf_eligible;
  const obPfAmt = useMemo(
    () => pfDeduction(obBasic, s1.pf_type, obPfActive),
    [obBasic, s1.pf_type, obPfActive],
  );
  const obDedExPf = useMemo(
    () => obDeductions.filter(c => c.code !== 'pf').reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [obDeductions],
  );
  const obNet = useMemo(() => Math.max(0, obGross - obDed), [obGross, obDed]);
  const obBreakupErrors = useMemo(
    () => validateBreakup(obEarnings, obDeductions, s1.detailed_breakup),
    [obEarnings, obDeductions, s1.detailed_breakup],
  );
  const obSalaryAnnual  = useMemo(() => Math.round(obMonthlyOf(s1.annual_salary) * 12), [obMonthlyOf, s1.annual_salary]);
  const obBreakupAnnual = useMemo(() => Math.round(obGross * 12), [obGross]);
  const obDiff = obSalaryAnnual > 0 ? obBreakupAnnual - obSalaryAnnual : 0;
  const obMatches = Math.abs(obDiff) <= CTC_ROUNDING_SLACK;
  const obOverSalary = obDiff > CTC_ROUNDING_SLACK;

  const obBalanceToBasic = () => {
    const deltaMonthly = Math.round((obSalaryAnnual - obBreakupAnnual) / 12);
    if (!deltaMonthly) return;
    setObEarnings(prev => {
      if (!prev.length) return [{ code: 'basic', label: 'Basic Salary', amount: Math.max(0, deltaMonthly) }];
      const idx = prev.findIndex(c => c.code === 'basic');
      const target = idx !== -1 ? idx : 0;
      return prev.map((c, i) => (i === target ? { ...c, amount: Math.max(0, (Number(c.amount) || 0) + deltaMonthly) } : c));
    });
  };

  useEffect(() => {
    setObDeductions(prev => {
      let next = prev;
      const sync = (on: boolean, code: string, label: string, seed: number) => {
        const has = next.some(d => d.code === code);
        if (on && !has) next = [...next, { code, label, amount: seed }];
        else if (!on && has) next = next.filter(d => d.code !== code);
      };
      sync(obEsi, 'esi', 'ESI', 0);
      sync(obPt,  'pt',  'Professional Tax', statutoryPt(obGross, s1.gender));

      const pfIdx = next.findIndex(d => d.code === 'pf');
      if (obPfActive) {
        const row = { code: 'pf', label: 'Provident Fund (PF)', amount: obPfAmt };
        if (pfIdx < 0) next = [...next, row];
        else if (Number(next[pfIdx].amount) !== obPfAmt) {
          next = next.map((d, i) => (i === pfIdx ? { ...d, ...row } : d));
        }
      } else if (pfIdx >= 0) {
        next = next.filter(d => d.code !== 'pf');
      }
      return next === prev ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obEsi, obPt, obPfActive, obPfAmt]);

  const updateObRow = (which: 'earn' | 'ded', i: number, field: 'label' | 'amount', value: string) => {
    const list = which === 'earn' ? obEarnings : obDeductions;
    const next = [...list];
    if (field === 'amount') {
      if (value === '') next[i] = { ...next[i], amount: 0 };
      else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return;
        next[i] = { ...next[i], amount: n };
      }
    } else {
      next[i] = { ...next[i], label: value };
    }
    if (which === 'earn' && !SPLIT_CODES.includes(next[i].code)) {
      setObEarnings(absorbIntoSpecial(next, obMonthlyOf(s1.annual_salary)));
    } else if (which === 'earn') {
      setObEarnings(next);
    } else {
      setObDeductions(next);
    }
  };

  const addObRow = (which: 'earn' | 'ded') => {
    if (which === 'earn') setObEarnings([...obEarnings, { code: `comp_${obEarnings.length + 1}`, label: '', amount: 0 }]);
    else setObDeductions([...obDeductions, { code: `ded_${obDeductions.length + 1}`, label: '', amount: 0 }]);
  };

  const removeObRow = (which: 'earn' | 'ded', i: number) => {
    if (which === 'earn') {
      const removed = obEarnings[i];
      const plan = planEarningRemoval(obEarnings, i);
      setObEarnings(SPLIT_CODES.includes(removed?.code)
        ? plan.next
        : absorbIntoSpecial(plan.next, obMonthlyOf(s1.annual_salary)));
    } else {
      const removed = obDeductions[i];
      setObDeductions(obDeductions.filter((_, idx) => idx !== i));
      if (removed?.code === 'esi') setObEsi(false);
      if (removed?.code === 'pt')  setObPt(false);
    }
  };

  const persistObBreakup = async (empId: number): Promise<void> => {
    const monthly = obMonthlyOf(s1.annual_salary);
    const typed = obEarnings
      .filter(c => c.label.trim() && Number(c.amount) >= 0)
      .map((c, i) => ({ code: (c.code || `comp_${i + 1}`).trim(), label: c.label.trim(), amount: Number(c.amount) || 0 }));
    const storedAgreesWithCtc = typed.length > 0 && obSalaryAnnual > 0 && obMatches;
    const earn = (s1.detailed_breakup || storedAgreesWithCtc)
      ? typed
      : (monthly > 0 ? seedBreakup(monthly) : typed);
    if (!earn.some(c => c.amount > 0)) return;
    const ded = obDeductions
      .filter(c => c.label.trim())
      .map((c, i) => ({ code: (c.code || `ded_${i + 1}`).trim(), label: c.label.trim(), amount: Number(c.amount) || 0 }));
    const sig = `${breakupSignature(earn, ded, !!s1.pf_eligible, obEsi, obPt, s1.pf_type)}|${obSalaryAnnual}`;
    if (obBaselineRef.current === sig) return;

    await api.post('/salary-structures', {
      employee_id: empId,
      effective_from: s1.salary_effective_from || s1.date_of_joining || new Date().toISOString().slice(0, 10),
      earnings: earn,
      deductions: ded,
      pf_applicable: !!s1.pf_eligible,
      annual_ctc: obSalaryAnnual > 0 ? obSalaryAnnual : undefined,
      pf_type: String(s1.pf_type || '').toLowerCase() || null,
      esi_applicable: obEsi,
      pt_applicable: obPt,
    });
    obBaselineRef.current = sig;
  };

  const [noticeCustomOpen, setNoticeCustomOpen] = useState(false);
  const noticeIsCustom = noticeCustomOpen
    || (!!s1.notice_period && !ONB_NOTICE_PRESETS.has(s1.notice_period));

  const [probationCustomOpen, setProbationCustomOpen] = useState(false);
  const probationIsCustom = probationCustomOpen
    || (!!s1.probation_policy && !ONB_PROBATION_PRESETS.has(s1.probation_policy));

  const holidayGroupSelectOpts = (() => {
    const opts = [...holidayGroupOpts];
    if (s1.holiday_list && !opts.some(o => o.value === String(s1.holiday_list))) {
      const g = mHolidayGroups.find(x => String(x.id) === String(s1.holiday_list));
      if (g) {
        const why = String(g.status ?? 'Active').toLowerCase() === 'inactive'
          ? 'Inactive'
          : 'No holidays';
        opts.push({ value: String(g.id), label: `${g.name} (${why})` });
      }
    }
    return opts;
  })();

  const shiftSelectOpts = (() => {
    const base = [...branchShiftOpts];
    if (s1.shift && !base.some(o => o.value === s1.shift)) {
      return [{ value: s1.shift, label: `${s1.shift} (current)` }, ...base];
    }
    return base;
  })();
  const shiftPlaceholder = branchShiftOpts.length === 0
    ? 'No shifts configured for this branch'
    : 'Select shift';

  const leavePlanSelectOpts = (() => {
    const saved = String(s1.leave_plan ?? '').trim();
    if (!saved || leavePlanOpts.some(o => o.value === saved)) return leavePlanOpts;
    const known = leavePlanAll.find(o => o.value === saved);
    return [
      { value: saved, label: `${known?.label ?? `Plan ${saved}`} (current — setup incomplete)` },
      ...leavePlanOpts,
    ];
  })();

  const overtimeRateSelectOpts = (() => {
    const saved = String(s1.overtime ?? '').trim();
    if (!saved || overtimeRateOpts.some(o => o.value === saved)) return overtimeRateOpts;
    return [...overtimeRateOpts, {
      value: saved,
      label: `${saved} (inactive)`,
      disabled: true,
      disabledReason: 'This rate is no longer Active in Master › Overtime (OT). Pick a current rate.',
    }];
  })();

  const [actualNameSnapshot, setActualNameSnapshot] = useState('');

useEffect(() => {
  if (!isOpen || !emp?.raw) return;
  const x = emp.raw;
  setS1({
    first_name:  String(x.first_name  ?? ''),
    middle_name: String(x.middle_name ?? ''),
    last_name:   String(x.last_name   ?? ''),
    gender:      String(x.gender ?? ''),
    date_of_birth: x.date_of_birth ? String(x.date_of_birth).slice(0, 10) : '',
    blood_group: String(x.blood_group ?? ''),
    nationality_country_id: x.nationality_country_id ? String(x.nationality_country_id) : '',
    work_country_id:        x.work_country_id        ? String(x.work_country_id)        : '',
    email:       String(x.email ?? ''),
    official_email: String(x.official_email ?? x.email ?? ''),
    mobile:      String(x.mobile ?? ''),

    department_id:    x.department_id    ? String(x.department_id)    : '',
    designation_id:   x.designation_id   ? String(x.designation_id)   : '',
    primary_role_id:  x.primary_role_id  ? String(x.primary_role_id)  : '',
    ancillary_role_ids: (Array.isArray(x.ancillary_role_ids) && x.ancillary_role_ids.length > 0)
      ? x.ancillary_role_ids.map(String)
      : (x.ancillary_role_id ? [String(x.ancillary_role_id)] : []),
    legal_entity_id:  x.legal_entity_id  ? String(x.legal_entity_id)  : '',
    location:         String(x.location ?? ''),
    reporting_manager: x.reporting_manager_id
      ? `employee:${x.reporting_manager_id}`
      : (x.reporting_manager_user_id && x.reporting_manager_user?.user_type
          ? `${x.reporting_manager_user.user_type}:${x.reporting_manager_user_id}`
          : ''),
    date_of_joining:  x.date_of_joining ? String(x.date_of_joining).slice(0, 10) : '',
    probation_policy: String(x.probation_policy ?? ''),
    notice_period:    String(x.notice_period    ?? ''),

    leave_plan:          String(x.leave_plan          ?? ''),
    holiday_list:        x.holiday_group_id ? String(x.holiday_group_id) : '',
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
    mobile_assigned:     String(x.mobile_assigned ?? '') || (x.mobile_master_asset_id || x.mobile_device ? 'Yes' : ''),
    mobile_master_asset_id: x.mobile_master_asset_id ? String(x.mobile_master_asset_id) : '',
    other_master_asset_ids: Array.isArray(x.other_master_asset_ids)
      ? x.other_master_asset_ids.map((n: any) => String(n))
      : [],
    biometric_status:    String(x.biometric_status    ?? ''),
    desk_workstation_no: String(x.desk_workstation_no ?? ''),
    id_card_status:      String(x.id_card_status      ?? ''),
    attendance_tracking: x.attendance_tracking !== undefined ? !!x.attendance_tracking : true,

    enable_payroll: true,
    pay_group:             String(x.pay_group             ?? ''),
    annual_salary:         x.annual_salary != null
      ? (Number.isInteger(Number(x.annual_salary)) ? String(Number(x.annual_salary)) : String(x.annual_salary))
      : '',
    salary_frequency:      String(x.salary_frequency      ?? 'Per annum'),
    salary_effective_from: x.salary_effective_from ? String(x.salary_effective_from).slice(0, 10) : '',
    salary_structure:      String(x.salary_structure      ?? ''),
    tax_regime:            String(x.tax_regime            ?? ''),
    bonus_in_annual:       !!x.bonus_in_annual,
    pf_eligible:           x.pf_eligible == null ? null : !!x.pf_eligible,
    pf_type:               String(x.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory',
    detailed_breakup:      !!x.detailed_breakup,
  });
  setActualNameSnapshot(
    [x.first_name, x.middle_name, x.last_name]
      .filter(Boolean).join(' ').trim() || emp.name || ''
  );
  const ot = String(x.overtime ?? '').trim();
  setOvertimeApplicable(ot && ot.toLowerCase() !== 'not applicable' ? 'Yes' : 'No');
}, [isOpen, emp?.id, emp?.raw]);

  useEffect(() => {
    if (!autoLegalEntity || s1.legal_entity_id) return;
    setS1(p => ({
      ...p,
      legal_entity_id: String(autoLegalEntity.id),
      location: autoLegalEntity.location || autoLegalEntity.city || '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLegalEntity, s1.legal_entity_id]);
  const legalEntityLabel =
    mLegalEntities.find(le => String(le.id) === String(s1.legal_entity_id))?.name
    || (emp?.raw as any)?.legal_entity?.name
    || '';

const [s1Errors, setS1Errors] = useState<Record<string, string>>({});
const [nextLoading, setNextLoading] = useState(false);

  const [formLocked, setFormLocked] = useState(false);
  const isHodSelected = !!hodDesignationId && String(s1.designation_id) === hodDesignationId;
  const selectedDeptId = String(s1.department_id || '');
  const deptHodOpt = managerOpts.find(m => m.isHod && m.deptId && m.deptId === selectedDeptId) || null;
  const hireRank = rankForDesignationName(
    mDesignations.find(d => String(d.id) === String(s1.designation_id))?.name,
  );
  let reportingMgrOpts = managerOpts.filter(m => rankOutranks(m.rank, hireRank));
  const savedMgrOpt = managerOpts.find(m => m.value === s1.reporting_manager);
  if (savedMgrOpt && !reportingMgrOpts.some(o => o.value === savedMgrOpt.value)) {
    reportingMgrOpts = [savedMgrOpt, ...reportingMgrOpts];
  }
  useEffect(() => {
    if (isHodSelected || !deptHodOpt) return;
    setS1(p => (p.reporting_manager ? p : { ...p, reporting_manager: deptHodOpt.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHodSelected, deptHodOpt?.value]);
const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
const [completeNotes, setCompleteNotes] = useState('');

useEffect(() => { if (isOpen) setS1Errors({}); }, [isOpen, emp?.id]);

const dobMin = _shiftYears(-100);
const dobMax = _shiftYears(-18);
const joinMax = _shiftYears(1);
const joinTodayIso = _shiftYears(0);
const joinDateOrig = emp?.raw?.date_of_joining
  ? String(emp.raw.date_of_joining).slice(0, 10)
  : '';
const isRehired = !!emp?.raw?.exit?.rehired_at;
const joinMin = (!isRehired && joinDateOrig && joinDateOrig < joinTodayIso) ? joinDateOrig : joinTodayIso;

useEffect(() => {
  const doj = s1.date_of_joining || '';
  setS1(p => (p.salary_effective_from === doj ? p : { ...p, salary_effective_from: doj }));
  setS1Errors(p => (p.salary_effective_from ? { ...p, salary_effective_from: '' } : p));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [s1.date_of_joining, s1.salary_effective_from]);

const onbProbation = resolveProbation(s1.probation_policy, s1.date_of_joining);

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
  'pf_applicable',
  'salary_breakup',
  'laptop_assigned',
  'laptop_master_asset_id',
  'mobile_assigned',
  'mobile_master_asset_id',
] as const;

const scrollToField = (field: string) => {
  if (!field) return;
  setTimeout(() => {
    const wrap = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!wrap) return;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = wrap.querySelector<HTMLElement>('input, button, textarea, select');
    focusable?.focus({ preventScroll: true });
  }, 50);
};

const scrollToFirstError = (errors: Record<string, string>) => {
  const first = STAGE1_FIELD_ORDER.find(k => errors[k]);
  if (first) scrollToField(first);
};

const serverErrorAnchor = (key: string): string | null => {
  if (!key) return null;
  const base = key.split('.')[0];
  for (const candidate of [key, base, base.replace(/_id$/, '')]) {
    if (candidate && document.querySelector(`[data-field="${candidate}"]`)) return candidate;
  }
  return null;
};

const scrollToServerError = (errors: unknown): string | null => {
  if (!errors || typeof errors !== 'object') return null;
  for (const key of Object.keys(errors as Record<string, unknown>)) {
    const anchor = serverErrorAnchor(key);
    if (anchor) { scrollToField(anchor); return anchor; }
  }
  return null;
};

const BANK_NAME_RE = /^[A-Za-z0-9\s'&.\-(),/]+$/;
const bankNameHasLetters = (v: string) => /[A-Za-z]/.test(v);
const isValidBankName = (v: string) => {
  const s = v.trim();
  return !!s && bankNameHasLetters(s) && BANK_NAME_RE.test(s);
};

const STAGE1_WORK_REQUIRED: Array<[string, string]> = [
  ['leave_plan',     'Leave plan is required'],
  ['holiday_list',   'Holiday list is required'],
  ['shift',          'Shift is required'],
  ['weekly_off',     'Weekly off is required'],
  ['expense_policy', 'Expense policy is required'],
];

const validateStage1 = (): boolean => {
  const errors: Record<string, string> = {};

  if (!s1.first_name?.trim()) errors.first_name = 'First name is required';
  if (!s1.last_name?.trim()) errors.last_name = 'Last name is required';
  if (!s1.work_country_id?.toString().trim()) errors.work_country_id = 'Work country is required';
  const dob = s1.date_of_birth?.trim() ?? '';
  if (!dob) {
    errors.date_of_birth = 'Date of birth is required';
  } else if (dob > dobMax) {
    errors.date_of_birth = 'Employee must be at least 18 years old';
  } else if (dob < dobMin) {
    errors.date_of_birth = 'Date of birth looks unrealistic';
  }

  const email = s1.email?.trim() ?? '';
  if (!email) {
    errors.email = 'Work email is required';
  } else {
    const msg = validateOfficialEmail(email);
    if (msg) errors.email = msg.replace('Official email', 'Work email');
  }

  if (!s1.laptop_assigned) {
    errors.laptop_assigned = 'Answer whether a laptop is assigned';
  } else if (s1.laptop_assigned === 'Yes' && !String(s1.laptop_master_asset_id || '').trim()) {
    errors.laptop_master_asset_id = 'Laptop Device is required';
  }
  if (!s1.mobile_assigned) {
    errors.mobile_assigned = 'Answer whether a mobile is assigned';
  } else if (s1.mobile_assigned === 'Yes' && !String(s1.mobile_master_asset_id || '').trim()) {
    errors.mobile_master_asset_id = 'Mobile Device is required';
  }

  const mobile = s1.mobile?.trim() ?? '';
  const mobileDigits = mobile.replace(/\D/g, '');
  if (!mobile) {
    errors.mobile = 'Mobile number is required';
  } else if (mobileDigits.length < 6 || mobileDigits.length > 15) {
    errors.mobile = 'Mobile must be 6–15 digits';
  }

  const doj = s1.date_of_joining?.trim() ?? '';
  if (!doj) {
    errors.date_of_joining = 'Joining date is required';
  } else if (doj < joinTodayIso && (isRehired || doj !== joinDateOrig)) {
    errors.date_of_joining = isRehired
      ? 'Joining date can’t be in the past — set the date this employee rejoined'
      : 'Joining date can’t be in the past';
  } else if (doj > joinMax) {
    errors.date_of_joining = 'Joining date cannot be more than a year in the future';
  }

  if (s1.enable_payroll !== false) {
    const annualNum = Number(s1.annual_salary);
    if (!s1.annual_salary || !Number.isFinite(annualNum) || annualNum <= 0) {
      errors.annual_salary = 'Salary amount is required and must be greater than 0';
    } else if (!Number.isInteger(annualNum)) {
      errors.annual_salary = 'Salary amount must be a whole number (no paise)';
    } else if (annualNum > 999_999_999_999) {
      errors.annual_salary = 'Salary amount is too large (max 999,999,999,999)';
    }
    const sef = (s1.salary_effective_from?.trim() || doj);
    if (!doj) {
      errors.salary_effective_from = 'Set the joining date — the salary effective date follows it';
    } else if (sef !== doj) {
      errors.salary_effective_from = 'Salary effective date must be the same as the joining date';
    }
    if (s1.pf_eligible !== true && s1.pf_eligible !== false) {
      errors.pf_applicable = 'Select whether PF applies to this employee';
    }
  }

  if (!s1.department_id?.toString().trim())   errors.department_id   = 'Department is required';
  if (!s1.designation_id?.toString().trim())  errors.designation_id  = 'Designation is required';
  if (!s1.primary_role_id?.toString().trim()) errors.primary_role_id = 'Primary role is required';
  if (probationIsCustom) {
    const n = parseInt(String(s1.probation_policy ?? ''), 10);
    if (!String(s1.probation_policy ?? '').trim()) errors.probation_policy = 'Please enter the probation months (1–12)';
    else if (!Number.isInteger(n) || n < 1 || n > 12) errors.probation_policy = 'Probation months must be between 1 and 12';
  }
  if (noticeIsCustom) {
    const txt = String(s1.notice_period ?? '').trim();
    const num = Number((txt.match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
    if (!txt) errors.notice_period = 'Please describe the custom notice period';
    else if (!Number.isFinite(num)) errors.notice_period = 'Include a number, e.g. 45 Days';
    else if (num < 1) errors.notice_period = 'Notice period must be at least 1';
  }
  else if ((s1.ancillary_role_ids ?? []).some((id: string) => String(id) === String(s1.primary_role_id))) errors.primary_role_id = 'The Primary role cannot also be an Ancillary role.';

  if (!s1.legal_entity_id?.toString().trim()) errors.legal_entity_id = 'Pick a branch in the branch switcher — the legal entity is taken from it';
  if (!s1.reporting_manager?.toString().trim()) errors.reporting_manager = 'Reporting manager is required';
  else if (hodDesignationId && String(s1.designation_id) === hodDesignationId
           && !String(s1.reporting_manager).startsWith('branch_user:'))
    errors.reporting_manager = 'An HOD must report to a Branch User (Director / CEO).';

  for (const [key, message] of STAGE1_WORK_REQUIRED) {
    if (!String((s1 as any)[key] ?? '').trim()) errors[key] = message;
  }

  if (s1.enable_payroll !== false && s1.detailed_breakup) {
    const be = validateBreakup(obEarnings, obDeductions, true);
    const rowErr = Object.values(be.earnings)[0] || Object.values(be.deductions)[0];
    if (be.form || rowErr) errors.salary_breakup = be.form || String(rowErr);
  }

  setS1Errors(errors);

  if (Object.keys(errors).length > 0) {
    toast.error('Please fill all required fields', `${Object.keys(errors).length} field(s) need attention`);
    scrollToFirstError(errors);
    return false;
  }
  return true;
};

    

const saveStage1 = async (markComplete: boolean, skipValidate = false, silent = false): Promise<boolean> => {
  if (!emp?.dbId || s1Saving) return false;
  if (!skipValidate && !validateStage1()) return false;
  setS1Saving(true);
  if (!silent) setFormLocked(true);
    const intOrNull = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };
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
      ancillary_role_ids: (s1.ancillary_role_ids ?? [])
        .map((v: string) => Number(v))
        .filter((n: number) => Number.isFinite(n)),
      legal_entity_id:  intOrNull(s1.legal_entity_id),
      reporting_manager_id:      rmIds.emp,
      reporting_manager_user_id: rmIds.user,
      annual_salary:    s1.annual_salary === '' ? null : Number(s1.annual_salary),
      holiday_group_id: intOrNull(s1.holiday_list),
      holiday_list:     mHolidayGroups.find(g => String(g.id) === String(s1.holiday_list))?.name || null,
      pf_type:     String(s1.pf_type).toLowerCase(),
      first_name:  s1.first_name.trim() || null,
      middle_name: s1.middle_name.trim() || null,
      last_name:   s1.last_name.trim()   || null,
      email:       s1.email.trim()       || null,
      official_email: s1.official_email ? s1.official_email.trim() : null,
      mobile:      s1.mobile.trim()      || null,
      laptop_master_asset_id: s1.laptop_assigned === 'Yes' ? intOrNull(s1.laptop_master_asset_id) : null,
      mobile_master_asset_id: s1.mobile_assigned === 'Yes' ? intOrNull(s1.mobile_master_asset_id) : null,
      other_master_asset_ids: s1.other_master_asset_ids
        .map(v => parseInt(v, 10))
        .filter(n => Number.isFinite(n)),
      probation_months:   onbProbation.months,
      probation_end_date: onbProbation.endIso || null,
    };
    delete payload.reporting_manager;
    if (markComplete) payload.wizard_step_completed = 4;
    try {
      await persistObBreakup(emp.dbId);
      await api.put(`/employees/${emp.dbId}`, payload);
      if (!silent) {
        onSaved?.();
        if (markComplete) {
          toast.success('Stage 1 saved', 'Setup details persisted.');
        } else if (skipValidate) {
          toast.success('Draft saved', 'Your changes have been saved. You can finish the rest later.');
        } else {
          toast.success('Saved', 'Your changes have been persisted.');
        }
      }
      return true;
    } catch (err: any) {
      if (isForbidden(err)) {
        const t = forbiddenToast(err);
        toast.error(t.title, t.message);
        return false;
      }
      const errors = err?.response?.data?.errors;
      const firstFieldMsg = errors && typeof errors === 'object'
        ? (Object.values(errors)[0] as any[] | undefined)?.[0]
        : null;
      const msg = firstFieldMsg
        || err?.response?.data?.message
        || err?.message
        || 'Could not save changes — please try again.';
      toast.error('Save failed', String(msg));
      const hit = scrollToServerError(errors);
      if (hit) {
        setS1Errors(prev => ({ ...prev, [hit]: String(firstFieldMsg || msg) }));
      }
      console.error('saveStage1 failed', err?.response?.data || err);
      return false;
    } finally {
      setS1Saving(false);
      if (!silent) setFormLocked(false);
    }
  };

  const [stage2Docs, setStage2Docs] = useState<{ document_key: string; status: string }[]>([]);
  useEffect(() => {
    if (!isOpen || !emp?.dbId) return;
    if (!coreReady) return;
    let cancelled = false;
    api.get(`/employees/${emp.dbId}/documents`)
      .then(r => { if (!cancelled) setStage2Docs(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setStage2Docs([]); });
    return () => { cancelled = true; };
  }, [isOpen, emp?.dbId, coreReady]);

  const [s4Saving, setS4Saving] = useState(false);
  const [s4ShowErrors, setS4ShowErrors] = useState(false);
  const [s4, setS4] = useState({
    salary_payment_mode: 'bank' as 'bank' | 'cheque',
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
  useEffect(() => {
    if (!isOpen || !emp?.raw) return;
    const x = emp.raw;
    const mode = String(x.salary_payment_mode ?? 'bank').toLowerCase();
    setS4({
      salary_payment_mode: mode === 'cheque' ? 'cheque' : 'bank',
      bank_name:           String(x.bank_name           ?? ''),
      bank_account_number: String(x.bank_account_number ?? ''),
      ifsc_code:           String(x.ifsc_code           ?? ''),
      account_holder_name: String(x.account_holder_name ?? ''),
      bank_branch:         String(x.bank_branch         ?? ''),
      bank_account_type:   String(x.bank_account_type   ?? 'Salary'),
      uan_number:          String(x.uan_number          ?? ''),
      pan_number:          String(x.pan_number          ?? ''),
      tax_regime:          String(x.tax_regime          ?? ''),
      pf_deduction:        String(x.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory',
      esi_applicable:      String(x.esi_applicable      ?? 'No'),
      gratuity_nominee_name: String(x.gratuity_nominee_name ?? ''),
      agreed_ctc_lpa:      (() => {
        const annual = Number(x.annual_salary);
        if (annual > 0) return String(+(annual / 100000).toFixed(2));
        return x.agreed_ctc_lpa != null ? String(x.agreed_ctc_lpa) : '';
      })(),
    });
  }, [isOpen, emp?.id, emp?.raw]);

  useEffect(() => {
    const annual = Number(s1.annual_salary);
    const lpa = annual > 0 ? String(+(annual / 100000).toFixed(2)) : '';
    setS4(p => (p.agreed_ctc_lpa === lpa ? p : { ...p, agreed_ctc_lpa: lpa }));
  }, [s1.annual_salary]);

  useEffect(() => {
    const t = s1.pf_type || 'Statutory';
    setS4(p => (p.pf_deduction === t ? p : { ...p, pf_deduction: t }));
  }, [s1.pf_type]);

  useEffect(() => {
    const v = obEsi ? 'Yes' : 'No';
    setS4(p => (p.esi_applicable === v ? p : { ...p, esi_applicable: v }));
  }, [obEsi]);

  
  
  
  
  const saveStage4 = async (markComplete: boolean, silent = false, skipValidate = false): Promise<boolean> => {
    if (!emp?.dbId || s4Saving) return false;

    if (s4.salary_payment_mode === 'bank') {
      const acc  = s4.bank_account_number.trim();
      const ifsc = s4.ifsc_code.trim();
      const missing: string[] = [];
      if (!s4.bank_name.trim())            missing.push('Bank Name');
      else if (!isValidBankName(s4.bank_name)) missing.push('Bank Name (letters, not just digits)');
      if (!acc)                            missing.push('Account Number');
      else if (!/^\d{9,18}$/.test(acc))    missing.push('Account Number (9–18 digits)');
      if (!ifsc)                           missing.push('IFSC Code');
      else if (!IFSC_RE.test(ifsc))        missing.push('IFSC Code (e.g. HDFC0000350)');
      if (!s4.account_holder_name.trim())  missing.push('Account Holder Name');
      if (!s4.bank_branch.trim())          missing.push('Bank Branch');
      if (missing.length > 0) {
        if (skipValidate) return false;
        setS4ShowErrors(true);
        toast.error(
          'Bank details required',
          `Fill in: ${missing.join(', ')}. Pick a non-bank payment mode if no bank account applies.`
        );
        return false;
      }
    }

    if (s4.salary_payment_mode !== 'bank') {
      const acc  = s4.bank_account_number.trim();
      const ifsc = s4.ifsc_code.trim();
      const bad: string[] = [];
      if (s4.bank_name.trim() && !isValidBankName(s4.bank_name)) bad.push('Bank Name (letters, not just digits)');
      if (acc  && !/^\d{9,18}$/.test(acc))  bad.push('Account Number (9–18 digits)');
      if (ifsc && !IFSC_RE.test(ifsc))      bad.push('IFSC Code (e.g. HDFC0000350)');
      if (bad.length > 0) {
        if (skipValidate) return false;
        setS4ShowErrors(true);
        toast.error('Check the bank details', `Fix or clear: ${bad.join(', ')}.`);
        return false;
      }
    }

    const panVal = s4.pan_number.trim().toUpperCase();
    if (panVal && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panVal)) {
      if (skipValidate) return false;
      setS4ShowErrors(true);
      toast.error('Invalid PAN', 'PAN must be in the format AAAAA9999A — 5 letters, 4 digits, then 1 letter.');
      return false;
    }

    setS4Saving(true);
    if (!silent) setFormLocked(true);
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
      esi_applicable:      trimOrNull(s4.esi_applicable),
      gratuity_nominee_name: trimOrNull(s4.gratuity_nominee_name),
      agreed_ctc_lpa:      s4.agreed_ctc_lpa === '' ? null : Number(s4.agreed_ctc_lpa),
    };
    if (markComplete) {
      payload.stage4_completed_at = new Date().toISOString();
      payload.onboarding_stage_completed = 4;
    }
    try {
      await api.put(`/employees/${emp.dbId}`, payload);
      setS4ShowErrors(false);
      onSaved?.();
      return true;
    } catch (err: any) {
      if (isForbidden(err)) {
        const t = forbiddenToast(err);
        toast.error(t.title, t.message);
        return false;
      }
      const errors = err?.response?.data?.errors;
      const firstFieldMsg = errors && typeof errors === 'object'
        ? (Object.values(errors)[0] as any[] | undefined)?.[0]
        : null;
      const msg = firstFieldMsg
        || err?.response?.data?.message
        || err?.message
        || 'Could not save changes — please try again.';
      toast.error('Save failed', String(msg));
      const hit = scrollToServerError(errors);
      if (hit) setS4ShowErrors(true);
      console.error('saveStage4 failed', err?.response?.data || err);
      return false;
    } finally {
      setS4Saving(false);
      if (!silent) setFormLocked(false);
    }
  };

  const bumpMacroStage = async (n: number) => {
    if (!emp?.dbId) return;
    const current = Number(emp.raw?.onboarding_stage_completed ?? 0);
    if (n <= current) return;
    try {
      await api.put(`/employees/${emp.dbId}`, { onboarding_stage_completed: n });
      onSaved?.();
    } catch {}
  };

  const canAdvanceFromActiveStage = (): { ok: boolean; reason?: string } => {
    if (activeStage === 1) {
      return validateStage1()
        ? { ok: true }
        : { ok: false, reason: 'Fill in every required field on Onboarding Setup before continuing.' };
    }
    if (activeStage === 2) {
      const v = stage2Ref.current?.validate?.() ?? { ok: true };
      return v.ok
        ? { ok: true }
        : { ok: false, reason: v.message || 'Complete the previous employment section before continuing.' };
    }
    if (activeStage === 3) {
      const emailErr = validateOfficialEmail(s1.official_email);
      return !emailErr
        ? { ok: true }
        : { ok: false, reason: emailErr };
    }
    if (activeStage === 4) {
      if (stage4Pass === stage4Total4 && stage4UanOk) return { ok: true };
      return {
        ok: false,
        reason: stage4Problems.length
          ? `${stage4Problems.map(x => x.label).join(', ')} — ${stage4Problems[0].message}`
          : 'Bank details, PAN, CTC and PF deduction must all be valid before moving on.',
      };
    }
    if (activeStage === 5) {
  return { ok: true };
}
    return { ok: true };
  };

  const goToStage = async (target: number) => {
    if (target === activeStage) return;
    if (target > activeStage) {
      const gate = canAdvanceFromActiveStage();
      if (!gate.ok) {
        toast.error('Complete this stage first', gate.reason || 'Mandatory fields are still empty.');
        return;
      }
    }
    const from = activeStage;
    setActiveStage(Math.max(1, Math.min(6, target)));
    if (from === 1) {
      void saveStage1(false, true, true);
    } else if (from === 2) {
      void stage2Ref.current?.flush();
    } else if (from === 3) {
      void saveStage1(false, true, true);
    } else if (from === 4) {
      void saveStage4(false, true, true);
    }
  };

  if (!emp) return null;

  const wizardStep = Math.max(0, Math.min(4, Number(emp.wizardStep ?? 0)));
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
    ...(s1.enable_payroll !== false
      ? [s1.annual_salary, s1.salary_effective_from, s1.pf_eligible]
      : []),

    ...STAGE1_WORK_REQUIRED.map(([key]) => (s1 as any)[key]),

    s1.laptop_assigned,
    ...(String(s1.laptop_assigned ?? '') === 'Yes' ? [s1.laptop_master_asset_id] : []),
    s1.mobile_assigned,
    ...(String(s1.mobile_assigned ?? '') === 'Yes' ? [s1.mobile_master_asset_id] : []),

    ...(probationIsCustom ? [s1.probation_policy] : []),
    ...(noticeIsCustom    ? [s1.notice_period]    : []),
  ];
  const stage1Filled = stage1RequiredFields.filter(v => String(v ?? '').trim()).length;
  const stage1LivePct = Math.round((stage1Filled / stage1RequiredFields.length) * 100);
  const stage1Done = wizardStep >= 4;

  const stage2RequiredCatalogueKeys = STAGE2_CATEGORIES.flatMap(cat =>
    cat.docs.filter(d => d.status !== 'Optional').map(d => d.id),
  );
  const isUp2 = (s?: string) => s === 'uploaded' || s === 'verified';
  const catalogueTotal    = stage2RequiredCatalogueKeys.length;
  const catalogueUploaded = stage2RequiredCatalogueKeys.filter(k =>
    isUp2(stage2Docs.find(d => d.document_key === k)?.status),
  ).length;

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

  const stage3TasksTotal = 2;
  const stage3TasksDone =
    (assetSlotAnswered(s1.laptop_assigned, s1.laptop_master_asset_id) ? 1 : 0)
    + (assetSlotAnswered(s1.mobile_assigned, s1.mobile_master_asset_id) ? 1 : 0);
  const stage3Pct = Math.round((stage3TasksDone / stage3TasksTotal) * 100);
  const stage3MacroDone = Number(emp?.raw?.onboarding_stage_completed ?? 0) >= 3;
  const stage3Done = stage3MacroDone || stage3TasksDone === stage3TasksTotal;

  const PAN_RE  = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
  const UAN_RE  = /^\d{12}$/;
  const stage4BankOk =
    s4.salary_payment_mode !== 'bank' || (
      isValidBankName(s4.bank_name) &&
      /^\d{9,18}$/.test(s4.bank_account_number.trim()) &&
      IFSC_RE.test(s4.ifsc_code.trim()) &&
      !!s4.account_holder_name.trim() &&
      !!s4.bank_branch.trim()
    );
  const stage4PanOk = PAN_RE.test(s4.pan_number.trim());
  const stage4PfApplicable = s1.enable_payroll !== false && !!s1.pf_eligible;
  const stage4UanOk = !stage4PfApplicable || UAN_RE.test(s4.uan_number.trim());
  const stage4SalaryOk = Number(s4.agreed_ctc_lpa) > 0;
  const stage4PfOk = !stage4PfApplicable || !!s4.pf_deduction.trim();
  const stage4Checks = [stage4BankOk, stage4PanOk, stage4SalaryOk, stage4PfOk];
  const stage4Pass   = stage4Checks.filter(Boolean).length;
  const stage4Total4 = stage4Checks.length;

  const stage4Problems = (() => {
    const p: { field: string; label: string; message: string; onStage1?: boolean }[] = [];

    if (s4.salary_payment_mode === 'bank') {
      const acct = s4.bank_account_number.trim();
      const ifsc = s4.ifsc_code.trim();
      const bank = s4.bank_name.trim();
      if (!bank) {
        p.push({ field: 'bank_name', label: 'Bank Name', message: 'Enter the bank name.' });
      } else if (!bankNameHasLetters(bank)) {
        p.push({ field: 'bank_name', label: 'Bank Name',
          message: 'Bank name must contain letters — this looks like a number.' });
      } else if (!BANK_NAME_RE.test(bank)) {
        p.push({ field: 'bank_name', label: 'Bank Name',
          message: 'Bank name can use letters, numbers and ’ - & . , ( ) / only.' });
      }
      if (!/^\d{9,18}$/.test(acct)) {
        p.push({ field: 'bank_account_number', label: 'Account Number',
          message: acct ? 'Account number must be 9–18 digits.' : 'Enter the account number.' });
      }
      if (!IFSC_RE.test(ifsc)) {
        p.push({ field: 'ifsc_code', label: 'IFSC Code',
          message: ifsc ? 'IFSC format is 4 letters + 0 + 6 characters (e.g. HDFC0001234).' : 'Enter the IFSC code.' });
      }
      if (!s4.account_holder_name.trim()) {
        p.push({ field: 'account_holder_name', label: 'Name on the Account', message: 'Enter the account holder name.' });
      }
      if (!s4.bank_branch.trim()) {
        p.push({ field: 'bank_branch', label: 'Branch', message: 'Enter the bank branch.' });
      }
    }

    if (!stage4PanOk) {
      p.push({ field: 'pan_number', label: 'PAN Number',
        message: s4.pan_number.trim()
          ? 'PAN format is 5 letters + 4 digits + 1 letter (e.g. AAAZZ9999A).'
          : 'Enter the PAN number.' });
    }
    if (!stage4UanOk) {
      p.push({
        field: 'uan_number',
        label: 'UAN Number',
        message: s4.uan_number.trim()
          ? 'UAN must be exactly 12 digits.'
          : 'UAN is required because PF applies to this employee.',
      });
    }
    if (!stage4SalaryOk) {
      const annual = Number(s1.annual_salary);
      p.push({
        field: 'agreed_ctc_lpa', label: 'Agreed CTC', onStage1: true,
        message: annual > 0
          ? `Stage 1 annual salary is ₹${annual.toLocaleString('en-IN')}, which works out to ${(annual / 100000).toFixed(2)} LPA. Annual Salary is entered in RUPEES per year — e.g. 1200000 for ₹12 LPA. Fix it on Stage 1 → Compensation.`
          : 'Agreed CTC is read-only here — it mirrors the Stage 1 annual salary. Set Annual Salary on Stage 1 → Compensation.',
      });
    }
    if (!stage4PfOk) {
      p.push({ field: 'pf_deduction', label: 'PF Type', onStage1: true,
        message: 'PF Type is read-only here — set it on Stage 1 → Compensation.' });
    }
    return p;
  })();
  const stage4Stamped = !!emp?.raw?.stage4_completed_at;
  const stage4Done    = stage4Stamped || (stage4Pass === stage4Total4 && stage4UanOk);
  const stage4Pct     = stage4Stamped ? 100 : Math.round((stage4Pass / stage4Total4) * 100);

  const macroCompleted = Number(emp?.raw?.onboarding_stage_completed ?? 0);
  const stage1AllRequiredFilled = stage1Filled === stage1RequiredFields.length;
  const stage1IsDone = (stage1Done || macroCompleted >= 1) && stage1AllRequiredFilled;
  const stage2IsDone = stage2Done && macroCompleted >= 2;
  const stage3IsDone = stage3Done || macroCompleted >= 3;
  const stage4IsDone = stage4Done || macroCompleted >= 4;
  const stage5AllSigned = stage5Loaded && stage5Signed >= stage5Sent;
  const stage5IsDone = macroCompleted >= 5 && stage5AllSigned;
  const allPriorStagesDone =
    stage1IsDone && stage2IsDone && stage3IsDone && stage4IsDone && stage5IsDone;
  const isActivated = macroCompleted >= 6;
  const stage6Done = isActivated && allPriorStagesDone;

  const stagesView = ONB_STAGES.map(s => {
    let status: StageStatus, progress: number;
    if (s.num === 1) {
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
      progress = stage5IsDone ? 100
        : (stage5Sent > 0
            ? Math.round(((stage5Sent + stage5Signed) / (stage5Sent * 2)) * 100)
            : 0);
      status = stage5IsDone ? 'Completed'
        : (stage5Total === 0 ? 'Pending'
        : ((stage5Sent > 0 || stage5Signed > 0 || activeStage === 5 || macroCompleted >= 5) ? 'In Progress' : 'Pending'));
    } else if (s.num === 6) {
      progress = stage6Done ? 100 : (activeStage === 6 ? 35 : 0);
      status   = stage6Done ? 'Completed' : (activeStage === 6 ? 'In Progress' : 'Pending');
    } else if (s.num < activeStage)      { status = 'Completed';   progress = 100; }
    else if (s.num === activeStage) { status = 'In Progress'; progress = s.progress || 35; }
    else                           { status = 'Pending';     progress = 0;   }
    if (status !== 'Completed') progress = Math.min(progress, 99);
    return { ...s, status, progress };
  });
  const overallPct = Math.round(stagesView.reduce((a, s) => a + s.progress, 0) / stagesView.length);
  const currentStage = stagesView[activeStage - 1];

  const PROFILE_FIELDS = [
    'first_name', 'last_name', 'gender', 'date_of_birth',
    'work_country_id', 'nationality_country_id',
    'email', 'mobile',
    'address_line1', 'city', 'state_id', 'country_id', 'pincode',
    'department_id', 'designation_id', 'primary_role_id', 'date_of_joining',
  ];
  const profilePct = (() => {
    const r: any = (emp as any)?.raw ?? {};
    const filled = PROFILE_FIELDS.filter(f => {
      const v = r[f];
      return v !== null && v !== undefined && v !== '' && v !== 0 && v !== '0';
    }).length;
    const dataPart = (filled / PROFILE_FIELDS.length) * 50;
    const content = stagesView.filter(s => s.num <= 5);
    const stagePart = content.length
      ? (content.reduce((a, s) => a + s.progress, 0) / (content.length * 100)) * 50
      : 0;
    return Math.max(0, Math.min(100, Math.round(dataPart + stagePart)));
  })();

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
        <div className="onb-init-header">
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
              <span className="onb-init-status-pill"><i className="ri-user-line" /> Profile: {profilePct}% complete</span>
            </div>
          </div>

        </div>

        <div className="onb-init-body" aria-busy={formLocked} style={{ position: 'relative' }}>
          {formLocked && (
            <div className="onb-busy-veil" aria-live="polite" aria-busy="true">
              <div className="onb-busy-box">
                <span className="onb-busy-spin" role="status" aria-hidden="true" />
                <span>{nextLoading ? 'Loading the next stage…' : 'Saving…'}</span>
              </div>
            </div>
          )}
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

          <div className="onb-init-main">
            <fieldset disabled={formLocked} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
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

            {readOnly && (
              <div className="onb-readonly-banner">
                <i className="ri-lock-2-line" />
                <span>
                  <strong>View-only access.</strong> You can read this onboarding, but nothing on
                  these stages can be saved — that needs edit access to employee records. Ask an
                  administrator to grant it.
                </span>
              </div>
            )}

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
                onAssetsOpen={() => reloadAssets()}
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
                ctcProblem={stage4Problems.find(x => x.field === 'agreed_ctc_lpa')?.message}
                pfApplicable={stage4PfApplicable}
              />
            )}
            {activeStage === 5 && (
              <Stage5Policies
                emp={emp}
                onProgress={handleStage5Progress}
              />
            )}
            {activeStage === 6 && <Stage6Verify emp={emp} stagesView={stagesView} profilePct={profilePct} onActivated={onSaved} />}

            {activeStage === 1 && mastersLoading && <OnboardFormSkeleton />}
            {activeStage === 1 && !mastersLoading && (
            <>
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
      const next = normaliseEmail(e.target.value);
      setS1(p => {
        const stillMirrored =
          !p.official_email || p.official_email === p.email;
        return {
          ...p,
          email: next,
          official_email: stillMirrored ? next : p.official_email,
        };
      });
      setS1Errors(p => ({
        ...p,
        email: next ? validateOfficialEmail(next) : '',
        official_email: '',
      }));
    }}
    onBlur={e => setS1Errors(p => ({ ...p, email: validateOfficialEmail(e.target.value) }))}
    autoComplete="email"
    inputMode="email"
    spellCheck={false}
    maxLength={254}
  />
  {s1Errors.email && <div className="onb-error-msg">{s1Errors.email}</div>}
</Col>
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
      setS1(p => ({ ...p, mobile: e.target.value.replace(/[^0-9+\-\s()]/g, '') }));
      setS1Errors(p => ({ ...p, mobile: '' }));
    }}
  />
  {s1Errors.mobile && <div className="onb-error-msg">{s1Errors.mobile}</div>}
</Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee ID <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={emp.empId} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Status <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={r.status || 'Inactive'} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Blood Group</label>
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
                  <Col md={4} data-field="department_id"><label className="onb-init-label">Department<span className="req">*</span></label><MasterSelect options={departmentOpts} loading={mastersLoading} placeholder="Select department" value={s1.department_id} invalid={!!s1Errors.department_id} onChange={(v) => { setS1(p => ({ ...p, department_id: v })); setS1Errors(p => ({ ...p, department_id: '' })); }} />{s1Errors.department_id && <div className="onb-error-msg">{s1Errors.department_id}</div>}</Col>
                  <Col md={4} data-field="designation_id"><label className="onb-init-label">Designation<span className="req">*</span></label><MasterSelect options={designationOpts} loading={mastersLoading} placeholder="Select designation" value={s1.designation_id} invalid={!!s1Errors.designation_id} onChange={(v) => { setS1(p => ({ ...p, designation_id: v })); setS1Errors(p => ({ ...p, designation_id: '', reporting_manager: '' })); }} />{s1Errors.designation_id && <div className="onb-error-msg">{s1Errors.designation_id}</div>}</Col>
                  <Col md={4} data-field="primary_role_id"><label className="onb-init-label">Primary Role<span className="req">*</span></label><MasterSelect options={roleOpts.filter(o => !(s1.ancillary_role_ids ?? []).includes(o.value))} loading={mastersLoading} placeholder="Select role" value={s1.primary_role_id} invalid={!!s1Errors.primary_role_id} onChange={(v) => { setS1(p => ({ ...p, primary_role_id: v, ancillary_role_ids: (p.ancillary_role_ids ?? []).filter((id: string) => id !== v) })); setS1Errors(p => ({ ...p, primary_role_id: '' })); }} />{s1Errors.primary_role_id && <div className="onb-error-msg">{s1Errors.primary_role_id}</div>}</Col>
                  <Col md={4}><label className="onb-init-label">Ancillary Role <span className="auto" style={{ textTransform: 'none', letterSpacing: 0 }}>select multiple</span></label><MasterMultiSelect options={roleOpts.filter(o => o.value !== String(s1.primary_role_id ?? ''))} value={s1.ancillary_role_ids ?? []} placeholder="Select one or more roles" onChange={(v) => setS1(p => ({ ...p, ancillary_role_ids: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Work Type <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="Full Time" /></Col>
                </Row>

                <p className="onb-init-subgroup">Organisational Details</p>
                <Row className="g-3">
                  <Col md={4} data-field="legal_entity_id">
                    <label className="onb-init-label">Legal Entity <span className="auto">AUTO</span></label>
                    <input
                      className="onb-init-input is-autofilled"
                      readOnly
                      value={legalEntityLabel}
                      placeholder={mastersLoading ? 'Loading…' : 'Select a branch to auto-fetch'}
                      title="The branch this employee is hired into — switch branch to change it"
                    />
                    {s1Errors.legal_entity_id && <div className="onb-error-msg">{s1Errors.legal_entity_id}</div>}
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Location <span className="auto">AUTO</span></label>
                    <input
                      className="onb-init-input is-autofilled"
                      readOnly
                      value={s1.location}
                      placeholder={s1.legal_entity_id ? '—' : 'Auto-fetched with the legal entity'}
                      title="The legal entity's city and country"
                    />
                  </Col>
                  <Col md={4} data-field="reporting_manager"><label className="onb-init-label">Reporting Manager<span className="req">*</span></label><MasterSelect options={reportingMgrOpts} loading={mastersLoading} placeholder="Select manager" value={s1.reporting_manager} invalid={!!s1Errors.reporting_manager} onChange={(v) => { setS1(p => ({ ...p, reporting_manager: v })); setS1Errors(p => ({ ...p, reporting_manager: '' })); }} />{s1Errors.reporting_manager && <div className="onb-error-msg">{s1Errors.reporting_manager}</div>}</Col>
                </Row>

                <p className="onb-init-subgroup">Employment Terms</p>
                <Row className="g-3">
                  <Col md={3} data-field="probation_policy">
                    <label className="onb-init-label">Probation Policy (Month)<span className="req">*</span></label>
                    <MasterSelect
                      options={ONB_PROBATION}
                      value={probationIsCustom ? ONB_CUSTOM_PROBATION : s1.probation_policy}
                      placeholder="Select months (1–12)"
                      invalid={!!s1Errors.probation_policy}
                      onChange={(v) => {
                        setProbationCustomOpen(v === ONB_CUSTOM_PROBATION);
                        setS1(p => ({ ...p, probation_policy: v === ONB_CUSTOM_PROBATION ? '' : v }));
                        setS1Errors(p => ({ ...p, probation_policy: '' }));
                      }}
                    />
                    {probationIsCustom && (
                      <input
                        className="onb-init-input"
                        style={{ marginTop: 8 }}
                        type="number" min={1} max={12}
                        placeholder="Months (1–12)"
                        value={s1.probation_policy}
                        onChange={(e) => { setS1(p => ({ ...p, probation_policy: e.target.value })); setS1Errors(p => ({ ...p, probation_policy: '' })); }}
                      />
                    )}
                    {s1Errors.probation_policy && <div className="onb-error-msg">{s1Errors.probation_policy}</div>}
                  </Col>
                  <Col md={3}><label className="onb-init-label">Probation End Date <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly tabIndex={-1} value={onbProbation.endDisplay} placeholder={!s1.date_of_joining ? 'Set joining date' : (onbProbation.months > 0 ? '' : 'No probation')} /></Col>
                  <Col md={3} data-field="notice_period">
                    <label className="onb-init-label">Notice Period<span className="req">*</span></label>
                    <MasterSelect
                      options={ONB_NOTICE}
                      value={noticeIsCustom ? ONB_CUSTOM_NOTICE : s1.notice_period}
                      placeholder="Select notice period"
                      onChange={(v) => {
                        setNoticeCustomOpen(v === ONB_CUSTOM_NOTICE);
                        setS1(p => ({
                          ...p,
                          notice_period: v === ONB_CUSTOM_NOTICE ? '' : v,
                        }));
                      }}
                    />
                    {noticeIsCustom && (
                      <input
                        className="onb-init-input"
                        style={{ marginTop: 8 }}
                        type="text"
                        placeholder="e.g. 45 Days, 2 months, etc."
                        value={s1.notice_period}
                        onChange={(e) => { setS1(p => ({ ...p, notice_period: e.target.value })); setS1Errors(p => ({ ...p, notice_period: '' })); }}
                      />
                    )}
                    {s1Errors.notice_period && <div className="onb-error-msg">{s1Errors.notice_period}</div>}
                  </Col>
                  <Col md={3}><label className="onb-init-label">Work Mode <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="On-site" /></Col>
                </Row>
              </div>
            </div>

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
                  <Col md={4} data-field="leave_plan"><label className="onb-init-label">Leave Plan<span className="req">*</span></label><MasterSelect options={leavePlanSelectOpts} loading={mastersLoading} value={s1.leave_plan} invalid={!!s1Errors.leave_plan} disabled={!leavePerm.canView} placeholder={!leavePerm.canView ? 'Requires Leave module access' : (leavePlanOpts.length ? 'Select a leave plan' : 'No configured leave plan — finish its setup in HR > Leave')} onChange={(v) => { setS1(p => ({ ...p, leave_plan: v })); setS1Errors(p => ({ ...p, leave_plan: '' })); }} />{s1Errors.leave_plan && <div className="onb-error-msg">{s1Errors.leave_plan}</div>}</Col>
                  <Col md={4} data-field="holiday_list"><label className="onb-init-label">Holiday List<span className="req">*</span></label><MasterSelect options={holidayGroupSelectOpts} loading={mastersLoading} value={s1.holiday_list} invalid={!!s1Errors.holiday_list} placeholder={holidayGroupOpts.length ? 'Select holiday group' : 'No groups — create in HR › Holiday › Groups'} onChange={(v) => { setS1(p => ({ ...p, holiday_list: v })); setS1Errors(p => ({ ...p, holiday_list: '' })); }} />{s1Errors.holiday_list && <div className="onb-error-msg">{s1Errors.holiday_list}</div>}</Col>
                  <Col md={4} data-field="shift"><label className="onb-init-label">Shift<span className="req">*</span></label><MasterSelect options={shiftSelectOpts} loading={mastersLoading} value={s1.shift} invalid={!!s1Errors.shift} placeholder={shiftPlaceholder} onChange={(v) => { setS1(p => ({ ...p, shift: v })); setS1Errors(p => ({ ...p, shift: '' })); }} />{s1Errors.shift && <div className="onb-error-msg">{s1Errors.shift}</div>}</Col>
                  <Col md={4} data-field="weekly_off"><label className="onb-init-label">Weekly Off<span className="req">*</span></label><MasterSelect options={ONB_WEEKLY_OFF} value={s1.weekly_off} invalid={!!s1Errors.weekly_off} placeholder="Select weekly off" onChange={(v) => { setS1(p => ({ ...p, weekly_off: v })); setS1Errors(p => ({ ...p, weekly_off: '' })); }} />{s1Errors.weekly_off && <div className="onb-error-msg">{s1Errors.weekly_off}</div>}</Col>
                  <Col md={4}><label className="onb-init-label">Attendance Number</label><input className="onb-init-input" placeholder="Attendance number" value={s1.attendance_number} onChange={e => setS1(p => ({ ...p, attendance_number: e.target.value }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Overtime Applicable</label><MasterSelect options={ONB_YES_NO} value={overtimeApplicable} placeholder="Select" onChange={(v) => { setOvertimeApplicable(v); if (v !== 'Yes') setS1(p => ({ ...p, overtime: '' })); }} /></Col>
                  {overtimeApplicable === 'Yes' && (
                    <Col md={4}><label className="onb-init-label">Overtime Rate</label><MasterSelect options={overtimeRateSelectOpts} loading={mastersLoading} value={s1.overtime} onOpen={() => reloadOvertimeRates()} placeholder={overtimeRateOpts.length ? 'Select overtime rate' : 'No rates — add in Master › Overtime (OT)'} onChange={(v) => setS1(p => ({ ...p, overtime: v }))} /></Col>
                  )}
                  <Col md={4} data-field="expense_policy"><label className="onb-init-label">Expense Policy<span className="req">*</span></label><MasterSelect options={ONB_EXPENSE} placeholder="Select expense policy" value={s1.expense_policy} invalid={!!s1Errors.expense_policy} onChange={(v) => { setS1(p => ({ ...p, expense_policy: v })); setS1Errors(p => ({ ...p, expense_policy: '' })); }} />{s1Errors.expense_policy && <div className="onb-error-msg">{s1Errors.expense_policy}</div>}</Col>
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
                  <Col md={4} data-field="laptop_assigned">
                    <label className="onb-init-label">Laptop Assigned<span className="req">*</span></label>
                    <MasterSelect
                      options={ONB_YES_NO}
                      placeholder="Select Yes or No"
                      value={s1.laptop_assigned}
                      invalid={!!s1Errors.laptop_assigned}
                      onChange={(v) => {
                        setS1(p => ({
                          ...p,
                          laptop_assigned: v,
                          laptop_master_asset_id: v === 'Yes' ? p.laptop_master_asset_id : '',
                        }));
                        setS1Errors(p => ({ ...p, laptop_assigned: '' }));
                      }}
                    />
                    {s1Errors.laptop_assigned && (
                      <div className="onb-error-msg">{s1Errors.laptop_assigned}</div>
                    )}
                  </Col>
                  {s1.laptop_assigned === 'Yes' && (
                    <Col md={4} data-field="laptop_master_asset_id">
                      <label className="onb-init-label">Laptop Device<span className="req">*</span></label>
                      <MasterSelect
                        options={laptopAssets}
                        onOpen={() => reloadAssets()}
                        loading={assetsLoading}
                        placeholder={laptopAssets.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                        value={s1.laptop_master_asset_id}
                        invalid={!!s1Errors.laptop_master_asset_id}
                        onChange={(v) => {
                          setS1(p => ({ ...p, laptop_master_asset_id: v }));
                          setS1Errors(p => ({ ...p, laptop_master_asset_id: '' }));
                        }}
                        disabled={!assetsLoading && laptopAssets.length === 0}
                      />
                      {s1Errors.laptop_master_asset_id && (
                        <div className="onb-error-msg">{s1Errors.laptop_master_asset_id}</div>
                      )}
                    </Col>
                  )}

                  <Col md={4} data-field="mobile_assigned">
                    <label className="onb-init-label">Mobile Assigned<span className="req">*</span></label>
                    <MasterSelect
                      options={ONB_YES_NO}
                      placeholder="Select Yes or No"
                      value={s1.mobile_assigned}
                      invalid={!!s1Errors.mobile_assigned}
                      onChange={(v) => {
                        setS1(p => ({
                          ...p,
                          mobile_assigned: v,
                          mobile_master_asset_id: v === 'Yes' ? p.mobile_master_asset_id : '',
                        }));
                        setS1Errors(p => ({ ...p, mobile_assigned: '' }));
                      }}
                    />
                    {s1Errors.mobile_assigned && (
                      <div className="onb-error-msg">{s1Errors.mobile_assigned}</div>
                    )}
                  </Col>
                  {s1.mobile_assigned === 'Yes' && (
                    <Col md={4} data-field="mobile_master_asset_id">
                      <label className="onb-init-label">Mobile Device<span className="req">*</span></label>
                      <MasterSelect
                        options={mobileAssets}
                        onOpen={() => reloadAssets()}
                        loading={assetsLoading}
                        placeholder={mobileAssets.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                        value={s1.mobile_master_asset_id}
                        invalid={!!s1Errors.mobile_master_asset_id}
                        onChange={(v) => {
                          setS1(p => ({ ...p, mobile_master_asset_id: v }));
                          setS1Errors(p => ({ ...p, mobile_master_asset_id: '' }));
                        }}
                        disabled={!assetsLoading && mobileAssets.length === 0}
                      />
                      {s1Errors.mobile_master_asset_id && (
                        <div className="onb-error-msg">{s1Errors.mobile_master_asset_id}</div>
                      )}
                    </Col>
                  )}

                  <Col md={8}>
                    <label className="onb-init-label">Other Assets</label>
                    <MasterMultiSelect
                      options={otherAssets}
                      onOpen={() => reloadAssets()}
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

                <p className="onb-init-subgroup">Payroll Configuration</p>
                <Row className="g-3">
<Col md={4} data-field="annual_salary">
  <label className="onb-init-label">
    Annual CTC {s1.enable_payroll !== false && <span className="req">*</span>}
  </label>
  <input
    className={`onb-init-input ${s1Errors.annual_salary ? 'is-invalid' : ''}`}
    placeholder="Enter amount"
    inputMode="numeric"
    value={s1.annual_salary}
    disabled={obBreakupLoading}
    onChange={e => {
      const capped = e.target.value.replace(/[^0-9]/g, '').slice(0, 12);
      setS1(p => ({ ...p, annual_salary: capped }));
      setS1Errors(p => ({ ...p, annual_salary: '' }));
      if (s1.detailed_breakup) setObRecalcing(capped !== '');
    }}
  />
  {obBreakupLoading && (
    <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
      <i className="ri-loader-4-line" /> Loading the saved breakup — CTC unlocks in a moment.
    </div>
  )}
  {s1Errors.annual_salary && <div className="onb-error-msg">{s1Errors.annual_salary}</div>}
</Col>
                  <Col md={4} data-field="salary_effective_from">
  <label className="onb-init-label">
    Salary Effective From <span className="auto">AUTO</span>
  </label>
  <input
    className="onb-init-input is-autofilled"
    readOnly
    tabIndex={-1}
    value={s1.date_of_joining ? new Date(s1.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
    placeholder="Set the joining date first"
    title="Always the joining date — the first salary structure starts the day the employee joins."
  />
  {s1Errors.salary_effective_from && <div className="onb-error-msg">{s1Errors.salary_effective_from}</div>}
</Col>
                  {s1.enable_payroll !== false && (
                    <Col md={4} data-field="pf_applicable">
                      <label className="onb-init-label">
                        PF Applicable <span className="req">*</span>
                      </label>
                      <MasterSelect
                        options={ONB_YES_NO}
                        placeholder="Select Yes or No"
                        invalid={!!s1Errors.pf_applicable}
                        value={s1.pf_eligible == null ? '' : (s1.pf_eligible ? 'Yes' : 'No')}
                        onChange={(v) => {
                          setS1(p => ({ ...p, pf_eligible: v === 'Yes' }));
                          setS1Errors(p => ({ ...p, pf_applicable: '' }));
                        }}
                      />
                      {s1Errors.pf_applicable && <div className="onb-error-msg">{s1Errors.pf_applicable}</div>}
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
                      {obSalaryVersion && <SalaryVersionBadge version={obSalaryVersion.version} from={obSalaryVersion.from} />}
                    </span>
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
                    {(() => {
                      const entered = s1.annual_salary === '' ? 0 : Number(s1.annual_salary);
                      const annual = (s1.salary_frequency === 'Per month') ? entered * 12 : entered;
                      const bonus  = s1.bonus_in_annual ? Math.round(annual * 0.10) : 0;
                      const regular = annual - bonus;
                      const total = regular + bonus;
                      const fmt = (n: number) => `INR ${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN')}`;

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

                      if (obBreakupLoading) {
                        return (
                          <div className="text-center py-4 text-muted" style={{ fontSize: 13 }}>
                            <i className="ri-loader-4-line" /> Loading breakup…
                          </div>
                        );
                      }

                      const renderCol = (which: 'earn' | 'ded', accent: string, heading: string) => {
                        const list = which === 'earn' ? obEarnings : obDeductions;
                        const errs = which === 'earn' ? obBreakupErrors.earnings : obBreakupErrors.deductions;
                        return (
                          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${accent}26`, paddingBottom: 5, marginBottom: 4 }}>
                              <span className={`onb-breakup-head onb-breakup-head--${which}`} style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: accent }}>{heading}</span>
                              <button type="button" onClick={() => addObRow(which)}
                                className={`onb-breakup-add onb-breakup-add--${which}`}
                                style={{ fontSize: 11, fontWeight: 700, color: accent, background: `${accent}12`, border: `1px solid ${accent}33`, borderRadius: 8, padding: '3px 11px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                <i className="ri-add-line" /> Add
                              </button>
                            </div>
                            {list.length === 0 && (
                              <div className="text-muted" style={{ fontSize: 12, padding: '10px 0' }}>No components yet.</div>
                            )}
                            {list.map((c, i) => {
                              const locked = ['pf', 'esi', 'pt'].includes(c.code);
                              return (
                                <div key={`${which}-${i}`}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px dashed var(--vz-border-color, #e5e7eb)' }}>
                                    <input
                                      className="onb-init-input"
                                      value={c.label}
                                      readOnly={locked}
                                      placeholder="Component name"
                                      onChange={e => updateObRow(which, i, 'label', e.target.value)}
                                      style={{ flex: 1, minWidth: 0, height: 30, fontSize: 12.5, border: 'none', background: 'transparent', padding: 0, fontWeight: 500 }}
                                    />
                                    <span style={{ fontSize: 12, color: 'var(--vz-secondary-color)' }}>₹</span>
                                    <input
                                      className="onb-init-input"
                                      type="number"
                                      value={c.amount === 0 ? '' : c.amount}
                                      placeholder="0"
                                      onChange={e => updateObRow(which, i, 'amount', e.target.value)}
                                      style={{ width: 110, height: 30, fontSize: 12.5, textAlign: 'right', fontWeight: 700, border: 'none', background: 'transparent', padding: 0 }}
                                    />
                                    {locked ? (
                                      <i className="ri-lock-line" style={{ fontSize: 13, color: 'var(--vz-secondary-color)', width: 18, textAlign: 'center' }} />
                                    ) : (
                                      <button type="button" onClick={() => removeObRow(which, i)} title="Remove component"
                                        style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', width: 18, padding: 0 }}>
                                        <i className="ri-delete-bin-line" style={{ fontSize: 13 }} />
                                      </button>
                                    )}
                                  </div>
                                  {errs[i] && <div className="onb-error-msg" style={{ marginTop: 2 }}>{errs[i]}</div>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      };

                      return (
                        <div style={{ position: 'relative' }} data-field="salary_breakup">
                          {obRecalcing && (
                            <>
                              <div style={{ position: 'absolute', inset: -6, zIndex: 3, borderRadius: 10, background: 'var(--vz-card-bg, #fff)', opacity: .72 }} />
                              <div style={{ position: 'absolute', inset: -6, zIndex: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40 }}>
                                <span className="d-inline-flex align-items-center gap-2 px-3 py-2"
                                  style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 999, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                                  <i className="ri-loader-4-line" /> Recalculating breakup…
                                </span>
                              </div>
                            </>
                          )}
                          <p className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                            Monthly component breakup. Saved as the employee's active salary
                            structure — payroll runs read these figures.
                          </p>
                          <ul style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7, paddingLeft: 16, marginBottom: 10 }}>
                            <li><strong>Basic Salary</strong> — the whole monthly gross by default; any allowance you add is taken out of it (must stay at least 50%, Code on Wages 2019).</li>
                            <li><strong>Allowances (HRA, Special…)</strong> — added by you. Special Allowance, when present, carries the balance so the gross stays on the CTC.</li>
                            <li><strong>PF Deduction</strong> — 12% of basic; capped at <strong>{PF_WAGE_CEILING_LABEL}</strong> for <strong>Statutory</strong>, or on the <strong>full basic</strong> for <strong>Standard</strong> (set by <em>PF Type</em> above).</li>
                          </ul>
                          <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
                            <label className="d-flex align-items-center gap-1 mb-0" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                              <input type="checkbox" checked={obEsi} onChange={e => setObEsi(e.target.checked)} /> ESI
                            </label>
                            <label className="d-flex align-items-center gap-1 mb-0" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                              <input type="checkbox" checked={obPt} onChange={e => setObPt(e.target.checked)} /> Professional Tax
                            </label>
                            <span className="text-muted" style={{ fontSize: 11 }}>
                              Ticking one adds it to Deductions — editable, and payroll uses what's saved here.
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                            {renderCol('earn', '#108548', 'Earnings')}
                            {renderCol('ded',  '#b91c1c', 'Deductions (optional)')}
                          </div>

                          <div className="d-flex align-items-center justify-content-between mt-3 p-2 px-3"
                            style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
                            <span className="fw-semibold" style={{ fontSize: 13 }}>Monthly Gross</span>
                            <div className="text-end">
                              <div className="fw-bold" style={{ fontSize: 18, color: '#5a3fd1' }}>{fmt(obGross)}</div>
                              <div style={{ fontSize: 11.5, fontWeight: 600, color: obSalaryAnnual <= 0 ? 'var(--vz-secondary-color)' : (obOverSalary ? '#dc2626' : '#0a8754') }}>
                                ≈ {fmt(obBreakupAnnual)} / year
                              </div>
                            </div>
                          </div>

                          {obSalaryAnnual > 0 && !obMatches && (
                            <div className="ctc-verdict ctc-verdict--err d-flex align-items-center gap-2 mt-2 p-2 px-3">
                              <i className="ri-error-warning-line" style={{ fontSize: 15 }} />
                              <span>
                                <b>{fmt(Math.abs(obDiff))} {obOverSalary ? 'over' : 'short of'}</b> the Annual CTC
                                {' '}({fmt(obSalaryAnnual)}) — balance the breakup before saving.
                              </span>
                              <button type="button" className="btn btn-sm ms-auto ctc-verdict-fix" onClick={obBalanceToBasic}>
                                <i className="ri-scales-3-line me-1" />Balance to Basic
                              </button>
                            </div>
                          )}
                          {obSalaryAnnual > 0 && obMatches && (
                            <div className="ctc-verdict ctc-verdict--ok d-flex align-items-center gap-2 mt-2 p-2 px-3">
                              <i className="ri-checkbox-circle-line" style={{ fontSize: 15 }} />
                              <span>Breakup matches the Annual CTC.</span>
                            </div>
                          )}

                          {(obPfActive || obDed > 0) && (
                            <>
                              {obPfActive && (
                                <div className="d-flex align-items-center justify-content-between mt-2 px-3" style={{ fontSize: 12.5 }}>
                                  <span className="text-muted">
                                    Provident Fund (PF) — {s1.pf_type === 'Standard'
                                      ? '12% of full basic'
                                      : `12% of ₹${Math.min(obBasic, PF_WAGE_CEILING).toLocaleString('en-IN')} (capped at ${PF_WAGE_CEILING_LABEL})`}
                                  </span>
                                  <span className="fw-semibold" style={{ color: '#b91c1c' }}>− {fmt(obPfAmt)}/mo</span>
                                </div>
                              )}
                              {obDedExPf > 0 && (
                                <div className="d-flex align-items-center justify-content-between mt-2 px-3" style={{ fontSize: 12.5 }}>
                                  <span className="text-muted">Fixed Deductions</span>
                                  <span className="fw-semibold" style={{ color: '#b91c1c' }}>− {fmt(obDedExPf)}/mo</span>
                                </div>
                              )}
                              <div className="d-flex align-items-center justify-content-between mt-2 p-2 px-3"
                                style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
                                <span className="fw-semibold" style={{ fontSize: 13 }}>Net (Monthly)</span>
                                <div className="text-end">
                                  <div className="fw-bold" style={{ fontSize: 18, color: '#0a8754' }}>{fmt(obNet)}</div>
                                  <div className="text-muted" style={{ fontSize: 11.5 }}>
                                    Gross {fmt(obGross)} − Deductions {fmt(obDed)}
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                          {obBreakupErrors.form && (
                            <div className="onb-error-msg" style={{ marginTop: 8 }}>{obBreakupErrors.form}</div>
                          )}
                          <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                            Net shown is an estimate (PF / ESI / PT + fixed deductions); LOP and any final adjustments apply at payroll run-time.
                          </div>
                        </div>
                      );
                    })()}
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
  
  <button
    type="button"
    className="onb-init-btn-outline"
    title={
      readOnly
        ? empPerm.lockedTitle('edit') ?? 'You have view-only access to employee records.'
        : (activeStage !== 1 && activeStage !== 3 && activeStage !== 4)
          ? 'Nothing to save as a draft on this stage — use the actions above, then Next Stage / Complete Onboarding.'
          : 'Save your progress so far without marking the stage complete.'
    }
    disabled={
      readOnly ||
      (activeStage === 1 && s1Saving) ||
      (activeStage === 3 && s1Saving) ||
      (activeStage === 4 && s4Saving) ||
      (activeStage !== 1 && activeStage !== 3 && activeStage !== 4)
    }
    onClick={() => {
      if (activeStage === 1) return saveStage1(false, true);
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
    title={readOnly ? (empPerm.lockedTitle('edit') ?? undefined) : undefined}
    disabled={
      readOnly ||
      nextLoading ||
      (activeStage === 1 && s1Saving) ||
      (activeStage === 3 && s1Saving) ||
      (activeStage === 4 && s4Saving)
    }
    onClick={async () => {
      if (activeStage === 1) {
        if (!validateStage1()) return;
        setNextLoading(true);
        const ok = await saveStage1(true);
        setNextLoading(false);
        if (!ok) return;
      }

      if (activeStage === 4) {
        if (stage4Pass !== stage4Total4 || !stage4UanOk) {
          setS4ShowErrors(true);
          const probs = stage4Problems;
          if (probs.length === 1) {
            toast.error(probs[0].label, probs[0].message);
          } else if (probs.length > 1) {
            toast.error(
              `${probs.length} fields need attention`,
              `${probs.map(x => x.label).join(', ')}. ${probs[0].message}`,
            );
          } else {
            toast.error('Payroll & Finance Setup incomplete', 'Check the Payroll Readiness panel at the bottom of this stage.');
          }
          if (probs.length) scrollToField(probs[0].field);
          return;
        }
        setNextLoading(true);
        const ok = await saveStage4(true);
        setNextLoading(false);
        if (!ok) return;
      }

      if (activeStage === 3) {
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
        const ok = await saveStage1(false, true);
        if (!ok) { setNextLoading(false); return; }
        await bumpMacroStage(3);
        setNextLoading(false);
        toast.success('Stage 3 saved', 'Provisioning & asset details persisted.');
      }

      if (activeStage === 2 || activeStage === 5) {
        if (activeStage === 2) {
          const v = stage2Ref.current?.validate() ?? { ok: true };
          if (!v.ok) {
            toast.error(
              v.title   || 'Previous employment — incomplete',
              v.message || 'Complete the previous employment section before moving to the next stage.',
            );
            return;
          }
        }
        setNextLoading(true);
        setFormLocked(true);
        try {
          if (activeStage === 2) {
            await stage2Ref.current?.flush();
          }
          await bumpMacroStage(activeStage);
        } finally {
          setFormLocked(false);
          setNextLoading(false);
        }
      }

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
    const pending: string[] = [];
    if (!stage1IsDone) pending.push('Onboarding Setup');
    if (!stage2IsDone) pending.push('Document Management');
    if (!stage3IsDone) pending.push('Provisioning & Asset Setup');
    if (!stage4IsDone) pending.push('Payroll & Finance');
    if (!stage5IsDone) {
      pending.push(
        !stage5Loaded               ? 'Policies & Agreements (still loading)'
        : stage5Signed < stage5Sent ? `Policies & Agreements (${stage5Sent - stage5Signed} of ${stage5Sent} sent awaiting signature)`
                                    : 'Policies & Agreements',
      );
    }
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

      <Modal
        isOpen={showCompleteConfirm}
        toggle={() => { if (!nextLoading) { setShowCompleteConfirm(false); setCompleteNotes(''); } }}
        centered
        size="md"
        backdrop="static"
        keyboard={!nextLoading}
        contentClassName="onb-complete-confirm"
      >
        <div className="occ-head">
          <div className="occ-icon"><i className="ri-checkbox-circle-line" /></div>
          <div className="occ-titles">
            <h5 className="occ-title">Complete onboarding</h5>
            <p className="occ-sub">All stages signed off — confirm to lock in completion</p>
          </div>
        </div>

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
                if (!emp?.dbId) return;
                await api.put(`/employees/${emp.dbId}`, {
                  onboarding_stage_completed: 6,
                  onboarding_complete_notes: completeNotes.trim() || null,
                });
                onSaved?.();
                await new Promise(r => setTimeout(r, 350));
                toast.success('Onboarding completed', 'All stages signed off. You can now activate the employee.');
                setShowCompleteConfirm(false);
                setCompleteNotes('');
                onClose();
              } catch (err: any) {
                toast.error(
                  'Could not complete onboarding',
                  err?.response?.data?.message
                    || 'The server rejected the request. Please try again.',
                );
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

const _serverStatusToUi = (s: string): DocStatus => {
  switch (s) {
    case 'verified': return 'Verified';
    case 'uploaded': return 'Uploaded';
    case 'rejected': return 'Rejected';
    default:         return 'Pending';
  }
};

const DOC_ACCEPTED_MIME = new Set<string>(DOC_ACCEPTED_MIMES);

export interface Stage2DocumentsHandle {
  flush: () => Promise<void>;
  validate: () => { ok: boolean; title?: string; message?: string };
}
const Stage2Documents = forwardRef<Stage2DocumentsHandle, {
  emp: OnboardRow;
  onDocsChanged?: (rows: { document_key: string; status: string }[]) => void;
  onProgress?: (p: { required: number; uploaded: number }) => void;
}>(({ emp, onDocsChanged, onProgress }, ref) => {
  const toast = useToast();
  const empPerm = useModulePermission('hr.employee', 'employee records');
  const readOnly = !empPerm.canEdit;

  const joiningIso = String((emp as any)?.raw?.date_of_joining || '').slice(0, 10);
  const prevEmpMaxIso = /^\d{4}-\d{2}-\d{2}$/.test(joiningIso)
    ? _shiftIsoDays(joiningIso, -1)
    : _todayIso();

  interface PrevCompanyRow {
    id: number | null;
    company_name: string;
    job_title: string;
    start_date: string;
    end_date: string;
    hr_email_1: string;
    hr_email_2: string;
    contact_number: string;
    _busy?: boolean;
    _localKey: string;
  }
  const newDraft = (): PrevCompanyRow => ({
    id: null, company_name: '', job_title: '',
    start_date: '', end_date: '',
    hr_email_1: '', hr_email_2: '', contact_number: '',
    _localKey: `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  });
  const [prevCompanies, setPrevCompanies] = useState<PrevCompanyRow[]>([]);
  const [hasExperience, setHasExperience] = useState<'yes' | 'no' | null>('no');
  const [hasExperienceError, setHasExperienceError] = useState(false);
  const [compErrors, setCompErrors] = useState<Record<string, string>>({});
  const [docsByKey, setDocsByKey] = useState<Record<string, ApiDocument>>({});

  const prevEmpProgress = useMemo(() => {
    if (hasExperience !== 'yes') return { required: 0, uploaded: 0 };
    const reqDocs = STAGE2_COMPANY_DOCS.filter(d => d.status !== 'Optional');
    const isUp = (s?: string) => s === 'uploaded' || s === 'verified';
    const required = Math.max(prevCompanies.length, 1) * reqDocs.length;
    let uploaded = 0;
    for (const c of prevCompanies) {
      if (c.id == null) continue;
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

  const [docsLoading, setDocsLoading] = useState(true);
  const [prevLoading, setPrevLoading] = useState(true);

  useEffect(() => {
    if (!emp?.dbId) { setPrevLoading(false); return; }
    let cancelled = false;
    const hydrate = async () => {
      try {
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
          setHasExperience(flag === true ? 'yes' : 'no');
          return;
        }
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
      } catch {}
      finally { if (!cancelled) setPrevLoading(false); }
    };
    hydrate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp?.dbId]);

  const prevCompaniesRef = useRef<PrevCompanyRow[]>([]);
  const updateCompany = (key: string, patch: Partial<PrevCompanyRow>) => {
    prevCompaniesRef.current = prevCompaniesRef.current.map(c => (c._localKey === key ? { ...c, ...patch } : c));
    setPrevCompanies(prev => prev.map(c => (c._localKey === key ? { ...c, ...patch } : c)));
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

  const persistCompany = async (key: string): Promise<number | null> => {
    if (!emp?.dbId) return null;
    const row = prevCompaniesRef.current.find(c => c._localKey === key);
    if (!row || row._busy) return row?.id ?? null;
    if (!row.company_name.trim()) return null;
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

  useImperativeHandle(ref, () => ({
    flush: async () => {
      const rows = prevCompaniesRef.current;
      const work = rows
        .filter(c => c.company_name.trim())
        .map(c => persistCompany(c._localKey));
      await Promise.all(work);
      if (emp?.dbId && hasExperience !== null) {
        try {
          await api.put(`/employees/${emp.dbId}`, {
            has_prior_experience: hasExperience === 'yes',
          });
        } catch {}
      }
    },
    validate: () => {
      if (hasExperience === null) {
        setHasExperienceError(true);
        setTimeout(() => {
          const el = document.getElementById('onb-has-experience');
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        return {
          ok: false,
          title: 'Previous employment — answer required',
          message: 'Select whether this employee has previous employment (Yes or No) before moving to the next stage.',
        };
      }

      if (hasExperience === 'yes') {
        const companies = prevCompaniesRef.current;
        if (companies.length === 0) {
          setTimeout(() => document.getElementById('onb-has-experience')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
          return {
            ok: false,
            title: 'Previous employment record required',
            message: 'Please add at least one previous employment record, or select "No" if this is their first job.',
          };
        }
        const errs: Record<string, string> = {};
        const isUp = (s?: string) => s === 'uploaded' || s === 'verified';
        const docUploaded = (c: PrevCompanyRow, key: string) => {
          if (!c.id) return false;
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
          if (c.end_date && c.end_date > prevEmpMaxIso) {
            errs[`${k}:end_date`] = joiningIso
              ? `Must end before this employee joined (${_formatDate(joiningIso)})`
              : 'End date cannot be in the future';
          }
          if (c.start_date && c.end_date && c.start_date > c.end_date) {
            errs[`${k}:start_date`] = 'Start date must be on or before the end date';
          }
          if (!c.hr_email_1.trim())   errs[`${k}:hr_email_1`]   = 'HR Email ID 1 is required';
          else if (EMAIL_INVALID(c.hr_email_1)) errs[`${k}:hr_email_1`] = 'Enter a valid email address';
          if (!docUploaded(c, 'salary_slips')) errs[`${k}:doc`] = 'Upload the Last 3 Months Salary Slips';
        });
        if (Object.keys(errs).length) {
          setCompErrors(errs);
          setTimeout(() => {
            const firstKey = Object.keys(errs)[0].split(':')[0];
            document.querySelector(`[data-comp="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
          const keys      = Object.keys(errs);
          const docKeys   = keys.filter(k => k.endsWith(':doc'));
          const fieldKeys = keys.filter(k => !k.endsWith(':doc'));
          const n = (c: number, noun: string) => `${c} ${noun}${c === 1 ? '' : 's'}`;

          if (fieldKeys.length && !docKeys.length) {
            return {
              ok: false,
              title: 'Previous employment — incomplete details',
              message: `Fill in the ${n(fieldKeys.length, 'highlighted field')} on the previous employment record${companies.length === 1 ? '' : 's'}.`,
            };
          }
          if (docKeys.length && !fieldKeys.length) {
            return {
              ok: false,
              title: 'Salary slips required',
              message: `Upload the Last 3 Months Salary Slips for ${n(docKeys.length, 'previous employer')}.`,
            };
          }
          return {
            ok: false,
            title: 'Previous employment — incomplete',
            message: `Fill in the ${n(fieldKeys.length, 'highlighted field')} and upload the salary slips for ${n(docKeys.length, 'employer')}.`,
          };
        }
        setCompErrors({});
      }
      return { ok: true };
    },
  }), [emp?.dbId, hasExperience, docsByKey]);

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
        return;
      }
    }
    triggerUpload(`prev_${pid}_${docId}`, docName, DOC_ACCEPT_ATTR, maxMb);
  };

  type DeleteTarget =
    | { kind: 'doc';     id: number; name: string }
    | { kind: 'company'; key: string; name: string };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const removeCompany = (key: string) => {
    const row = prevCompanies.find(c => c._localKey === key);
    if (!row) return;
    if (!row.id && !row.company_name.trim()) {
      setPrevCompanies(prev => prev.filter(c => c._localKey !== key));
      return;
    }
    setDeleteTarget({ kind: 'company', key, name: row.company_name || 'this company' });
  };

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
        setPrevCompanies(prev => prev.filter(c => c._localKey !== deleteTarget.key));
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const reloadDocs = async (): Promise<Record<string, ApiDocument> | null> => {
    if (!emp?.dbId) { setDocsLoading(false); return null; }
    try {
      const r = await api.get(`/employees/${emp.dbId}/documents`);
      const list: ApiDocument[] = Array.isArray(r.data) ? r.data : [];
      const map: Record<string, ApiDocument> = {};
      for (const d of list) map[d.document_key] = d;
      setDocsByKey(map);
      onDocsChanged?.(list.map(d => ({ document_key: d.document_key, status: d.status })));
      return map;
    } catch { return null; }
    finally { setDocsLoading(false); }
  };
  useEffect(() => { reloadDocs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [emp?.dbId]);

  const triggerUpload = (docKey: string, docName: string, accept: string, maxMb?: number) => {
    if (!emp?.dbId) {
      toast.error('Cannot upload', 'Save the employee first — no record id yet.');
      return;
    }
    if (readOnly) {
      empPerm.guard('edit', () => {});
      return;
    }
    if (uploadingKey) {
      toast.info('One at a time', 'Wait for the current upload to finish before starting another.');
      return;
    }
    const cap = Math.min(maxMb ?? DOC_MAX_MB, DOC_MAX_MB);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      try { document.body.removeChild(input); } catch {}
      if (!file) return;

      const maxBytes = cap * 1024 * 1024;
      if (file.size > maxBytes) {
        toast.error(
          `${docName} is too large`,
          `Max allowed is ${cap} MB. Selected file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        );
        return;
      }
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
        await api.post(`/employees/${emp.dbId}/documents`, fd, {
          headers: { 'Content-Type': undefined as unknown as string },
        });
        const fresh = await reloadDocs();
        if (fresh && fresh[docKey]) {
          toast.success(`${docName} uploaded`, 'Awaiting HR verification.');
        } else {
          toast.warning(
            `${docName} sent, but not confirmed`,
            'The upload went through — reload the stage to see it. If it is still missing, upload again.',
          );
        }
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

  const triggerDelete = (docId: number, docName: string) => {
    setDeleteTarget({ kind: 'doc', id: docId, name: docName });
  };

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
              const srv = docsByKey[d.id];
              const effective: DocStatus = srv
                ? _serverStatusToUi(srv.status)
                : (d.status === 'Optional' ? 'Optional' : 'Pending');
              const accept = /^photo$/i.test(d.id)
                ? 'image/jpeg,image/png'
                : /cheque/i.test(d.id)
                  ? 'image/jpeg,image/png,application/pdf'
                  : DOC_ACCEPT_ATTR;
              const isBusy = uploadingKey === d.id;
              const isLocked = !!uploadingKey && !isBusy;
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
                      {srv?.original_name && (
                        <> · <strong title={srv.original_name}>{truncateDocName(srv.original_name)}</strong></>
                      )}
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
                  <Tooltip label={
                    isBusy   ? 'Uploading…'
                    : isLocked ? 'Another document is uploading — wait for it to finish'
                    : (srv ? `Replace ${d.name}` : `Upload ${d.name}`)
                  }>
                    <button
                      type="button"
                      className="onb-doc-upload-btn"
                      onClick={() => triggerUpload(d.id, d.name, accept, d.maxMb)}
                      disabled={isBusy || isLocked}
                      style={isBusy ? { opacity: 0.6, cursor: 'progress' } : (isLocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined)}
                    >
                      <i className={`${isBusy ? 'ri-loader-4-line onb-spin' : 'ri-upload-cloud-2-line'}`} />
                      {isBusy ? 'Uploading…' : (srv ? 'Replace' : 'Upload')}
                    </button>
                  </Tooltip>
                  {srv && (
                    <Tooltip label={isLocked ? 'Another document is uploading — wait for it to finish' : 'Remove this document'}>
                      <button
                        type="button"
                        className="onb-doc-upload-btn onb-doc-ghost-btn onb-doc-ghost-del"
                        onClick={() => triggerDelete(srv.id, d.name)}
                        disabled={isLocked || isBusy}
                        style={(isLocked || isBusy) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
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

        {hasExperience === 'yes' && prevCompanies.map((c, idx) => {
          const docKeyFor = (k: string) => c.id ? `prev_${c.id}_${k}` : '';
          const compDocsTotal = STAGE2_COMPANY_DOCS.length;
          const compDocsUploaded = c.id
            ? STAGE2_COMPANY_DOCS.filter(d => {
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
                    minDate={_shiftYears(-5)}
                    maxDate={c.end_date || prevEmpMaxIso}
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
                    minDate={c.start_date || undefined}
                    maxDate={prevEmpMaxIso}
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
                    maxLength={20}
                    value={c.contact_number}
                    onChange={e => {
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

        {hasExperience === 'yes' && (
          <button type="button" className="onb-doc-add-comp" onClick={addCompany}>
            <i className="ri-add-line" /> Add Previous Company
          </button>
        )}
      </div>

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

function Stage3Provisioning({
  emp, s1, setS1, s1Errors, setS1Errors, laptopAssets, mobileAssets, otherAssets, assetsLoading, onAssetsOpen,
}: {
  emp: OnboardRow;
  s1: any;
  setS1: React.Dispatch<React.SetStateAction<any>>;
  s1Errors: Record<string, string>;
  setS1Errors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  laptopAssets: { value: string; label: string }[];
  mobileAssets: { value: string; label: string }[];
  otherAssets:  { value: string; label: string }[];
  assetsLoading?: boolean;
  onAssetsOpen?: () => void;
}) {
  const autoGenLabel = (
    <span className="auto" style={{ background: '#ede9fe', color: '#5b3fd1' }}>AUTO GENERATED</span>
  );

  useEffect(() => {
    if (!s1.official_email && s1.email) {
      setS1((p: any) => ({ ...p, official_email: p.email }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>

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
      const v = normaliseEmail(e.target.value);
      setS1((p: any) => ({ ...p, official_email: v }));
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

      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon device"><i className="ri-computer-line" /></span>
          <h6 className="onb-prov-section-title">Device &amp; Asset Allocation</h6>
        </div>
        <div className="onb-prov-section-body">
          <p className="onb-prov-subgroup"><i className="ri-computer-line" /> Assets &amp; Security</p>
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Laptop Assigned<span className="req">*</span></label>
              <MasterSelect
                options={ONB_YES_NO}
                placeholder="Select Yes or No"
                value={s1.laptop_assigned}
                invalid={!!s1Errors?.laptop_assigned}
                onChange={(v) => {
                  setS1((p: any) => ({
                    ...p,
                    laptop_assigned: v,
                    laptop_master_asset_id: v === 'Yes' ? p.laptop_master_asset_id : '',
                  }));
                  setS1Errors?.((p: any) => ({ ...p, laptop_assigned: '' }));
                }}
              />
              {s1Errors?.laptop_assigned && (
                <div className="onb-error-msg">{s1Errors.laptop_assigned}</div>
              )}
            </Col>
            {s1.laptop_assigned === 'Yes' && (
              <Col md={4}>
                <label className="onb-init-label">Laptop Device<span className="req">*</span></label>
                <MasterSelect
                  options={laptopAssets}
                  onOpen={onAssetsOpen}
                  loading={assetsLoading}
                  placeholder={laptopAssets.length === 0 ? 'No laptops available' : 'Select laptop (Serial — Name)'}
                  value={s1.laptop_master_asset_id}
                  invalid={!!s1Errors?.laptop_master_asset_id}
                  onChange={(v) => {
                    setS1((p: any) => ({ ...p, laptop_master_asset_id: v }));
                    setS1Errors?.((p: any) => ({ ...p, laptop_master_asset_id: '' }));
                  }}
                  disabled={!assetsLoading && laptopAssets.length === 0}
                />
                {s1Errors?.laptop_master_asset_id && (
                  <div className="onb-error-msg">{s1Errors.laptop_master_asset_id}</div>
                )}
              </Col>
            )}
            <Col md={4}>
              <label className="onb-init-label">Mobile Assigned<span className="req">*</span></label>
              <MasterSelect
                options={ONB_YES_NO}
                placeholder="Select Yes or No"
                value={s1.mobile_assigned}
                invalid={!!s1Errors?.mobile_assigned}
                onChange={(v) => {
                  setS1((p: any) => ({
                    ...p,
                    mobile_assigned: v,
                    mobile_master_asset_id: v === 'Yes' ? p.mobile_master_asset_id : '',
                  }));
                  setS1Errors?.((p: any) => ({ ...p, mobile_assigned: '' }));
                }}
              />
              {s1Errors?.mobile_assigned && (
                <div className="onb-error-msg">{s1Errors.mobile_assigned}</div>
              )}
            </Col>
            {s1.mobile_assigned === 'Yes' && (
              <Col md={4}>
                <label className="onb-init-label">Mobile Device<span className="req">*</span></label>
                <MasterSelect
                  options={mobileAssets}
                  onOpen={onAssetsOpen}
                  loading={assetsLoading}
                  placeholder={mobileAssets.length === 0 ? 'No mobiles available' : 'Select mobile (Serial — Name)'}
                  value={s1.mobile_master_asset_id}
                  invalid={!!s1Errors?.mobile_master_asset_id}
                  onChange={(v) => {
                    setS1((p: any) => ({ ...p, mobile_master_asset_id: v }));
                    setS1Errors?.((p: any) => ({ ...p, mobile_master_asset_id: '' }));
                  }}
                  disabled={!assetsLoading && mobileAssets.length === 0}
                />
                {s1Errors?.mobile_master_asset_id && (
                  <div className="onb-error-msg">{s1Errors.mobile_master_asset_id}</div>
                )}
              </Col>
            )}
            <Col md={12}>
              <label className="onb-init-label">
                Other Assets
                <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
              </label>
              <MasterMultiSelect
                options={otherAssets}
                onOpen={onAssetsOpen}
                placeholder={otherAssets.length === 0 ? 'No other assets available' : 'Pick one or more'}
                value={s1.other_master_asset_ids}
                onChange={(vs) => setS1((p: any) => ({ ...p, other_master_asset_ids: vs }))}
                disabled={otherAssets.length === 0}
              />
            </Col>
          </Row>
        </div>
      </div>

      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon physical"><i className="ri-shield-check-line" /></span>
          <h6 className="onb-prov-section-title">Physical Setup &amp; Identification</h6>
        </div>
        <div className="onb-prov-section-body">
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Biometric Status</label>
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
              <label className="onb-init-label">Desk / Workstation No</label>
              <input
                className="onb-init-input"
                placeholder="e.g. WS-204, Floor 3 / Bay B"
                value={s1.desk_workstation_no}
                onChange={e => setS1((p: any) => ({ ...p, desk_workstation_no: e.target.value }))}
              />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">ID Card Status</label>
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

type S4State = {
  salary_payment_mode: 'bank' | 'cheque';
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
  s4, setS4, checks, showErrors, ctcProblem, pfApplicable = true,
}: {
  s4: S4State;
  setS4: React.Dispatch<React.SetStateAction<S4State>>;
  checks: { bank: boolean; pan: boolean; salary: boolean; pf: boolean };
  showErrors: boolean;
  pass: number;
  total: number;
  ctcProblem?: string;
  pfApplicable?: boolean;
}) {
  const checkRows: { id: keyof typeof checks; name: string }[] = [
    { id: 'bank',   name: 'Bank details complete' },
    { id: 'pan',    name: 'PAN verified' },
    { id: 'salary', name: 'Salary structure confirmed' },
    { id: 'pf',     name: 'PF / ESIC setup complete' },
  ];

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
    uan_number:          showErrors && !!pfApplicable && !/^\d{12}$/.test(s4.uan_number.trim()),
  };

  return (
    <>

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

      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon bank"><i className="ri-money-dollar-circle-line" /></span>
          <h6 className="onb-pay-section-title">Bank Details</h6>
          {!bankMode && (
            <span className="onb-pay-section-note">
              Optional for cheque — recorded for reimbursements and for switching to bank transfer later.
            </span>
          )}
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col data-field="bank_name" md={4}>
              <label className="onb-init-label">Bank Name {bankMode && <span className="req">*</span>}</label>
              <input className={`onb-init-input ${bankMode ? 'is-required' : ''}${invalid.bank_name ? ' is-invalid' : ''}`} placeholder="e.g. HDFC Bank" value={s4.bank_name} onChange={e => setS4(p => ({ ...p, bank_name: e.target.value.replace(/[^A-Za-z0-9 .,&/'()\-]/g, '') }))} />
            </Col>
            <Col data-field="bank_account_number" md={4}>
              <label className="onb-init-label">Account Number {bankMode && <span className="req">*</span>}</label>
              <input
                className={`onb-init-input ${bankMode ? 'is-required' : ''}${invalid.bank_account_number ? ' is-invalid' : ''}`}
                placeholder="Account number"
                inputMode="numeric"
                maxLength={18}
                value={s4.bank_account_number}
                onChange={e =>
                  setS4(p => ({
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
            <Col data-field="ifsc_code" md={4}>
              <label className="onb-init-label">IFSC Code {bankMode && <span className="req">*</span>}</label>
              <input
                className={`onb-init-input ${bankMode ? 'is-required' : ''}${invalid.ifsc_code ? ' is-invalid' : ''}`}
                placeholder="e.g. HDFC0001234"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={11}
                value={s4.ifsc_code}
                onChange={e =>
                  setS4(p => ({
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
            <Col data-field="account_holder_name" md={4}>
              <label className="onb-init-label">Name on the Account {bankMode && <span className="req">*</span>}</label>
              <input className={`onb-init-input ${bankMode ? 'is-required' : ''}${invalid.account_holder_name ? ' is-invalid' : ''}`} placeholder="Full legal name as per bank" value={s4.account_holder_name} onChange={e => setS4(p => ({ ...p, account_holder_name: e.target.value.replace(/[^A-Za-z .'-]/g, '') }))} />
            </Col>
            <Col data-field="bank_branch" md={4}>
              <label className="onb-init-label">Branch {bankMode && <span className="req">*</span>}</label>
              <input className={`onb-init-input ${bankMode ? 'is-required' : ''}${invalid.bank_branch ? ' is-invalid' : ''}`} placeholder="e.g. Baner, Pune" value={s4.bank_branch} onChange={e => setS4(p => ({ ...p, bank_branch: e.target.value.replace(/[^A-Za-z0-9 .,&/'()\-]/g, '') }))} />
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Account Type</label>
              <MasterSelect options={ONB_ACCOUNT_TYPE} value={s4.bank_account_type} onChange={(v) => setS4(p => ({ ...p, bank_account_type: v }))} />
            </Col>
          </Row>
        </div>
      </div>

      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon tax"><i className="ri-file-list-3-line" /></span>
          <h6 className="onb-pay-section-title">Tax &amp; Statutory Details</h6>
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col data-field="pan_number" md={4}>
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
            {pfApplicable && (
              <Col data-field="pf_deduction" md={4}>
                <label className="onb-init-label">PF Type</label>
                <MasterSelect options={ONB_PF_TYPE} value={s4.pf_deduction || 'Statutory'} onChange={() => {}} disabled />
                <small style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: invalid.pf_deduction ? '#dc2626' : '#9ca3af' }}>
                  {invalid.pf_deduction
                    ? 'Not set — choose PF Type on Stage 1 (Compensation).'
                    : 'Set in Stage 1 (Compensation) — read-only here.'}
                </small>
              </Col>
            )}
            {pfApplicable && (
              <Col data-field="uan_number" md={4}>
                <label className="onb-init-label">UAN Number (PF) <span className="req">*</span></label>
                <input
                  className={`onb-init-input is-required${invalid.uan_number ? ' is-invalid' : ''}`}
                  placeholder="12-digit UAN"
                  maxLength={12}
                  value={s4.uan_number}
                  onChange={e => setS4(p => ({ ...p, uan_number: e.target.value.replace(/\D/g, '') }))}
                />
                {s4.uan_number && s4.uan_number.length !== 12 && (
                  <small style={{ color: '#dc2626', fontSize: 11.5 }}>UAN must be exactly 12 digits</small>
                )}
                {invalid.uan_number && !s4.uan_number.trim() && (
                  <small style={{ color: '#dc2626', fontSize: 11.5 }}>UAN is required because PF applies</small>
                )}
              </Col>
            )}
            <Col md={4}>
              <label className="onb-init-label">ESI Applicable</label>
              <input
                className="onb-init-input"
                value={s4.esi_applicable || 'No'}
                readOnly
                style={{ background: 'var(--vz-light, #f3f3f9)', cursor: 'not-allowed' }}
              />
              <small style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: '#9ca3af' }}>
                From the Stage 1 salary breakup — read-only here.
              </small>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Gratuity Nominee Name</label>
              <input className="onb-init-input" placeholder="Full legal name" value={s4.gratuity_nominee_name} onChange={e => setS4(p => ({ ...p, gratuity_nominee_name: e.target.value }))} />
            </Col>
            <Col data-field="agreed_ctc_lpa" md={4}>
              <label className="onb-init-label">Agreed CTC (LPA) <span className="req">*</span></label>
              <input
                className={`onb-init-input${invalid.agreed_ctc_lpa ? ' is-invalid' : ''}`}
                placeholder="—"
                value={s4.agreed_ctc_lpa}
                readOnly
                style={{ background: 'var(--vz-light, #f3f3f9)', cursor: 'not-allowed' }}
              />
              <small style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: invalid.agreed_ctc_lpa ? '#dc2626' : '#9ca3af' }}>
                {invalid.agreed_ctc_lpa
                  ? (ctcProblem || 'Not set — enter Annual Salary on Stage 1 (Compensation) and it will fill in here.')
                  : 'From the Stage 1 salary — read-only here.'}
              </small>
            </Col>
          </Row>
        </div>
      </div>

      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon check"><i className="ri-checkbox-circle-line" /></span>
          <h6 className="onb-pay-section-title">Payroll Readiness Check</h6>
        </div>
        <div className="onb-pay-section-body">
          {checkRows.map(c => {
            const bankNA = c.id === 'bank' && s4.salary_payment_mode !== 'bank';
            if (bankNA) {
              const modeLabel = 'Cheque';
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

function Stage5Policies({ emp, onProgress }: {
  emp: OnboardRow;
  onProgress?: (p: { signed: number; sent: number; total: number }) => void;
}) {
  type Tpl = {
    id: number;
    code: string;
    name: string;
    doc_type: string | null;
    status: 'Active' | 'Draft' | 'Deprecated';
    signers?: any;
  };

  const toast = useToast();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(false);
  const [readyTpls, setReadyTpls] = useState<Set<number>>(new Set());
  const [tplHasFields, setTplHasFields] = useState<Record<number, boolean>>({});
  const [genTpl, setGenTpl] = useState<Tpl | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const parseSigners = (raw: any): Array<{ role_name?: string | null; designation_name?: string | null; action?: string | null }> => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  };

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

  useEffect(() => {
    let cancelled = false;
    setReadyTpls(new Set());
    setTplHasFields({});
    if (!templates.length) return;
    (async () => {
      let customNames = new Set<string>();
      try {
        const tok = await api.get('/hr-custom-fields/known-tokens');
        customNames = new Set((tok.data?.custom_fields ?? []).map((c: any) => c.name));
      } catch {}
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
          .catch(() => {});
      });
    })();
    return () => { cancelled = true; };
  }, [templates]);

  type RunSigner = {
    name?: string | null; role_name?: string | null; action?: string | null;
    status?: string; acted_at?: string | null; signed_name?: string | null;
    signature_url?: string | null;
    note?: string | null;
  };
  type SignatureRun = {
    id: number; code: string | null;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
    template_id: number; signers: RunSigner[]; current_index: number;
    created_at?: string | null;
    updated_at?: string | null;
    content_html?: string | null;
    header_config?: HeaderConfig | null;
    footer_config?: FooterConfig | null;
    template?: { id: number; code: string; name: string; doc_type: string | null } | null;
    trigger_point_name?: string | null;
    trigger_keyword?: string | null;
  };
  const [runs, setRuns] = useState<SignatureRun[]>([]);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [menuTplId, setMenuTplId] = useState<number | null>(null);
  const [sendForTpl, setSendForTpl] = useState<Tpl | null>(null);
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

  const runByTemplateId = useMemo(() => {
    const m = new Map<number, SignatureRun>();
    for (const r of runs) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [runs]);

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

  const accountableIds = useMemo(() => {
    const ids = new Set<number>();
    runs.forEach(r => { if (r.status !== 'Cancelled' && r.template_id != null) ids.add(r.template_id); });
    templates.forEach(t => { if (ids.has(t.id)) ids.add(t.id); });
    return ids;
  }, [runs, templates]);

  const sentCount = accountableIds.size;
  const signedCount = useMemo(
    () => [...accountableIds].filter(id => runByTemplateId.get(id)?.status === 'Completed').length,
    [accountableIds, runByTemplateId],
  );

  useEffect(() => {
    if (loading) return;
    onProgress?.({ signed: signedCount, sent: sentCount, total: templates.length });
  }, [loading, signedCount, sentCount, templates.length, onProgress]);

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
      <div className="onb-pol-legend">
        <span style={{ fontWeight: 700, color: '#374151' }}>Signing Status:</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#10b981' }} /> Signed</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#f59e0b' }} /> Pending</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#7c5cfc' }} /> Awaiting</span>
      </div>

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
          <div style={{ padding: 22, textAlign: 'center', borderRadius: 10, background: 'var(--vz-light, #f9fafb)', border: '1px dashed var(--vz-border-color, #e5e7eb)' }}>
            <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#9ca3af' }} />
            <div style={{ fontSize: 13, color: 'var(--vz-secondary-color, #6b7280)' }}>
              No matching policy / agreement templates for this employee&rsquo;s department &amp; role.
            </div>
          </div>
        )}

        {!loading && templates.map(tpl => {
          const isExpanded = expandedId === tpl.id;
          const signers = parseSigners(tpl.signers);
          const toggle = () => setExpandedId(prev => prev === tpl.id ? null : tpl.id);
          const run = runByTemplateId.get(tpl.id) || null;
          const isSending = sendingId === tpl.id;
          const runActive = !!run && (run.status === 'Pending' || run.status === 'In Progress');
          const signedRuns = completedRunsByTpl.get(tpl.id) || [];
          const latestSigned = signedRuns[0] || null;
          const statusInfo = run?.status === 'Completed'  ? { label: 'Signed',      color: '#10b981' }
                           : run?.status === 'Rejected'   ? { label: 'Rejected',    color: '#ef4444' }
                           : run?.status === 'Cancelled'  ? { label: 'Cancelled',   color: '#878a99' }
                           : runActive                    ? { label: 'Awaiting Sign', color: '#7c5cfc' }
                           :                                 { label: 'Not Sent',    color: '#9ca3af' };
          return (
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
                {(() => {
                  if (run?.status === 'Completed') return null;
                  const fieldsReady = readyTpls.has(tpl.id);
                  const hasFields = !!tplHasFields[tpl.id];
                  const sendBlocked = tpl.status !== 'Active' || !emp.dbId || isSending || runActive || !fieldsReady;
                  const sendLabel = isSending ? 'Sending…'
                    : runActive ? 'Awaiting Sign'
                    : run       ? 'Resend'
                    :             'Send for Signature';
                  const sendIcon = (isSending || (!runActive && !fieldsReady)) ? 'ri-loader-4-line onb-spin'
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
                    </div>
                    <div className="ep-signing-flow">
                      {(run
                        ? run.signers.map((s, i) => ({
                            name:   s.name || s.role_name || `Signer ${i + 1}`,
                            action: s.action,
                            state:  s.status === 'Done' ? 'Completed'
                                  : s.status === 'Rejected' ? 'Rejected'
                                  : (i === run.current_index ? 'Awaiting' : 'Pending'),
                            active: i === run.current_index && (run.status === 'Pending' || run.status === 'In Progress'),
                            at:     s.acted_at,
                            note:   s.note ?? null,
                          }))
                        : signers.map((s, i) => ({
                            name:   s.role_name || s.designation_name || `Signer ${i + 1}`,
                            action: s.action,
                            state:  'Pending' as string,
                            active: i === 0,
                            at:     null as string | null,
                            note:   null as string | null,
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
                            {sg.state === 'Completed' && sg.at && (
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 500, marginTop: 1 }}>
                                Signed · {fmtSignedAt(sg.at)}
                              </span>
                            )}
                            {sg.state === 'Rejected' && (
                              <>
                                <span className="ep-signer-rejected-at">
                                  Rejected{sg.at ? ` · ${fmtSignedAt(sg.at)}` : ''}
                                </span>
                                {sg.note && (
                                  <span
                                    className="ep-signer-note"
                                    title={sg.note}
                                  >
                                    <i className="ri-chat-quote-line" />
                                    {sg.note}
                                  </span>
                                )}
                              </>
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

              {!isExpanded && (() => {
                const rejected = run?.status === 'Rejected'
                  ? run.signers.find(sg => sg.status === 'Rejected') ?? null
                  : null;
                return (
                  <p className={`onb-pol-doc-help${rejected ? ' is-rejected' : ''}`}>
                    <i className={rejected ? 'ri-close-circle-line' : 'ri-information-line'} />
                    {rejected
                      ? <>Rejected by <strong>{rejected.name || rejected.role_name || 'a signer'}</strong>{rejected.note ? <> — {rejected.note}</> : <> (no reason given).</>}</>
                      : runActive
                      ? "Sent — waiting on the signers. Expand to see who's next."
                      : run?.status === 'Completed'
                      ? 'All signers have signed. ✓'
                      : 'Click Send to start the signing workflow and notify the signers.'}
                  </p>
                );
              })()}
            </div>
          );
        })}
      </div>

      <SignedDocumentsSection runs={runs} />

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

      <Modal isOpen={!!sendForTpl} toggle={() => setSendForTpl(null)} size="md" centered contentClassName="border-0" modalClassName="send-sign-modal" backdrop="static">
        <style>{`
          .send-sign-modal .modal-dialog { max-width: 600px; }
          .send-sign-modal .modal-content { border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.30); }
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


function Stage6Verify({
  emp, stagesView, profilePct,
}: {
  emp: OnboardRow;
  profilePct: number;
  stagesView: { num: number; status: 'Completed' | 'In Progress' | 'Pending' }[];
  onActivated?: () => void;
}) {
  const isStageDone = (num: number): boolean =>
    !!stagesView.find(s => s.num === num && s.status === 'Completed');
  const stageRows: { num: number; name: string; sub: string; icon: string; cls: string; verified: boolean }[] = [
    { num: 1, name: 'Employee Onboarding Setup',     sub: 'Basic details, job info & compensation · Stage 1', icon: 'ri-user-line',                cls: 's1', verified: isStageDone(1) },
    { num: 2, name: 'Document Management',           sub: 'Identity, education & employment docs · Stage 2',  icon: 'ri-file-list-3-line',         cls: 's2', verified: isStageDone(2) },
    { num: 3, name: 'Provisioning & Asset Setup',    sub: 'Email, systems, devices & access · Stage 3',       icon: 'ri-computer-line',            cls: 's3', verified: isStageDone(3) },
    { num: 4, name: 'Payroll & Finance Setup',       sub: 'Bank, PAN, PF/ESIC & salary structure · Stage 4',  icon: 'ri-money-dollar-circle-line', cls: 's4', verified: isStageDone(4) },
    { num: 5, name: 'Policies & Agreements',         sub: 'NDA, employment agreement & signing · Stage 5',    icon: 'ri-shield-check-line',        cls: 's5', verified: isStageDone(5) },
  ];
  const verifiedCount = stageRows.filter(s => s.verified).length;

  return (
    <>

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
                <div className="onb-ver-info-fill" style={{ width: `${profilePct}%` }} />
              </div>
              <span className="onb-ver-info-pct">{profilePct}%</span>
            </div>
          </div>
        </div>
      </div>

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

    </>
  );
}
  
