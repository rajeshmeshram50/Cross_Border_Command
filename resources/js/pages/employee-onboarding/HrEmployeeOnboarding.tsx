import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import api from '../../api';
import './HrEmployeeOnboarding.css';

// ── Onboarding form option lists (used by MasterSelect dropdowns) ─────────────
const OPT = (...vals: string[]) => vals.map(v => ({ value: v, label: v }));
const ONB_GENDER       = OPT('Male', 'Female', 'Other');
const ONB_NATIONALITY  = OPT('Indian', 'Other');
const ONB_NUMBER_SERIES = OPT('Default Number Series');
const ONB_EMP_STATUS   = OPT('Active', 'On Probation');
const ONB_LEGAL_ENTITY = OPT('Cross Border Command Pvt Ltd', 'CBC International LLP');
const ONB_LOCATION     = OPT('Pune HQ', 'Mumbai', 'Bengaluru');
const ONB_PROBATION    = OPT('Default Probation Policy', '3 Months', '6 Months');
const ONB_NOTICE       = OPT('Default Notice Period', '30 Days', '60 Days', '90 Days');
const ONB_LEAVE_PLAN   = OPT('Leave Policy');
const ONB_HOLIDAY      = OPT('Holiday Calendar');
const ONB_SHIFT        = OPT('General Shift', 'Morning Shift', 'Night Shift');
const ONB_WEEKLY_OFF   = OPT('Week Off Policy');
const ONB_TIME_TRACK   = OPT('Attendance Capture');
const ONB_PENALIZE     = OPT('Tracking Policy');
const ONB_OVERTIME     = OPT('Not applicable', 'Applicable');
const ONB_EXPENSE      = OPT('Default Expense Policy');
const ONB_YES_NO       = OPT('No', 'Yes');
const ONB_ACCESS_CARD  = OPT('Not Issued', 'Issued');
const ONB_PAY_GROUP    = OPT('Default pay group');
const ONB_PERIOD       = OPT('Per annum', 'Per month');
const ONB_SAL_STRUCT   = OPT('Range Based', 'Fixed');
const ONB_TAX_REGIME   = OPT('New Regime (115BAC)', 'Old Regime');
const ONB_ACCOUNT_TYPE = OPT('Salary', 'Savings', 'Current');
const ONB_PF_DEDUCT    = OPT('Employee + Employer', 'Employee only');

// ── Evidence Vault — mock document catalogue (mirrors HrEmployees) ──────────
type VaultStatus = 'Verified' | 'Uploaded' | 'Pending' | 'Signed' | 'Sent' | 'Not Generated';
interface VaultDoc {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tint: string;
  fg: string;
  category?: string;
  status: VaultStatus;
}
interface VaultSection { title: string; docs: VaultDoc[] }

const VAULT_EMPLOYEE_DOCS: VaultSection[] = [
  {
    title: 'Identity Documents',
    docs: [
      { id: 'aadhaar', name: 'Aadhaar Card',  desc: 'Government issued 12-digit unique identity', icon: 'ri-id-card-line',     tint: '#dceefe', fg: '#0c63b0', category: 'Identity', status: 'Verified' },
      { id: 'pan',     name: 'PAN Card',      desc: 'Permanent Account Number for taxation',      icon: 'ri-bank-card-line',   tint: '#fdf3d6', fg: '#a06f00', category: 'Identity', status: 'Verified' },
      { id: 'p_photo', name: 'Passport Photo',desc: 'Recent passport-size photograph',            icon: 'ri-image-line',       tint: '#fdd9ea', fg: '#a02960', category: 'Identity', status: 'Verified' },
      { id: 'p_copy',  name: 'Passport Copy', desc: 'Govt issued travel document (if applicable)',icon: 'ri-passport-line',    tint: '#dceefe', fg: '#0c63b0', category: 'Identity', status: 'Verified' },
    ],
  },
  {
    title: 'Address Proof',
    docs: [
      { id: 'cur_addr',  name: 'Current Address Proof',   desc: 'Utility bill or bank statement (last 3 months)', icon: 'ri-home-4-line',  tint: '#fde8c4', fg: '#a4661c', category: 'Address', status: 'Verified' },
      { id: 'perm_addr', name: 'Permanent Address Proof', desc: 'Aadhaar / Voter ID — permanent address proof',   icon: 'ri-map-pin-line', tint: '#d6f4e3', fg: '#108548', category: 'Address', status: 'Verified' },
    ],
  },
  {
    title: 'Education Documents',
    docs: [
      { id: 'edu_10',  name: '10th Marksheet',     desc: 'Secondary school certification',         icon: 'ri-graduation-cap-line', tint: '#d6f4e3', fg: '#108548', category: 'Education', status: 'Verified' },
      { id: 'edu_12',  name: '12th Marksheet',     desc: 'Higher secondary certification',         icon: 'ri-graduation-cap-line', tint: '#d6f4e3', fg: '#108548', category: 'Education', status: 'Verified' },
      { id: 'edu_deg', name: 'Graduation Degree',  desc: "Bachelor's degree certificate",          icon: 'ri-medal-2-line',        tint: '#fdf3d6', fg: '#a06f00', category: 'Education', status: 'Verified' },
      { id: 'edu_pg',  name: 'Post Graduation',    desc: "Master's or postgraduate diploma",       icon: 'ri-award-line',          tint: '#dceefe', fg: '#0c63b0', category: 'Education', status: 'Verified' },
    ],
  },
  {
    title: 'Employment History',
    docs: [
      { id: 'rel_letter', name: 'Relieving Letter',  desc: 'Final relieving from previous employer', icon: 'ri-mail-send-line',           tint: '#fde8c4', fg: '#a4661c', category: 'Employment', status: 'Verified' },
      { id: 'exp_cert',   name: 'Experience Letter', desc: 'Past employment experience certificate', icon: 'ri-briefcase-line',           tint: '#d3f0ee', fg: '#0a716a', category: 'Employment', status: 'Verified' },
      { id: 'pay_slip',   name: 'Last 3 Pay Slips',  desc: 'Most recent salary slips for reference', icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548', category: 'Employment', status: 'Verified' },
    ],
  },
];

const VAULT_ORG_DOCS: VaultSection[] = [
  {
    title: 'Signed Company Documents',
    docs: [
      { id: 'nda',       name: 'NDA',                          desc: 'Non-Disclosure Agreement — active during and post tenure',  icon: 'ri-lock-line',         tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'emp_agree', name: 'Employment Agreement',         desc: 'Appointment letter & employment terms and conditions',      icon: 'ri-file-list-3-line',  tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'coc',       name: 'Code of Conduct Policy',       desc: 'Acknowledgement of company ethical standards and behavior', icon: 'ri-book-2-line',       tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'it_sec',    name: 'IT Security & Acceptable Use', desc: 'IT asset usage, data access, and acceptable use policy',    icon: 'ri-computer-line',     tint: '#dceefe', fg: '#0c63b0', status: 'Signed' },
      { id: 'leave_pol', name: 'Leave & Attendance Policy',    desc: 'Leave entitlements, attendance rules, and WFH policy',      icon: 'ri-calendar-2-line',   tint: '#dceefe', fg: '#0c63b0', status: 'Signed' },
      { id: 'conf',      name: 'Confidentiality Agreement',    desc: 'Confidential business information protection agreement',    icon: 'ri-shield-check-line', tint: '#dceefe', fg: '#0c63b0', status: 'Signed' },
      { id: 'gratuity',  name: 'Gratuity & Benefit Policy',    desc: 'Gratuity eligibility, PF, and other employee benefit terms',icon: 'ri-gift-line',         tint: '#fde8c4', fg: '#a4661c', status: 'Sent' },
    ],
  },
];

const VAULT_STATUS_TONE: Record<VaultStatus, { bg: string; fg: string; dot: string }> = {
  'Verified':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Uploaded':      { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Pending':       { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Signed':        { bg: '#ece6ff', fg: '#5b3fd1', dot: '#7c5cfc' },
  'Sent':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Not Generated': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
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
  joinDate: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
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
  const step = Number(raw?.wizard_step_completed ?? 0);
  const stat = String(raw?.status ?? '').toLowerCase();
  if (step >= 4 && stat === 'active') return 'Completed';
  if (step >= 4) return 'Document Pending';
  if (step > 0) return 'In Progress';
  return 'Not Started';
};

const apiToOnboardRow = (e: any): OnboardRow => {
  const name = (e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`).trim() || '—';
  const accent = _accent(name);
  const mgr = e.reporting_manager;
  const mgrName = mgr?.display_name
    || (mgr ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ').trim() : '')
    || '—';
  return {
    id: e.emp_code || `EMP-${e.id}`,
    empId: e.emp_code || `EMP-${e.id}`,
    name,
    initials: _initials(name),
    accent,
    joinDate: _formatDate(e.date_of_joining),
    department: e.department?.name || '—',
    designation: e.designation?.name || '—',
    primaryRole: e.primary_role?.name || '—',
    ancillaryRole: e.ancillary_role?.name || '',
    managerName: mgrName,
    managerInitials: _initials(mgrName),
    managerAccent: _accent(mgrName || 'manager'),
    // Profile % matches the HR list: 4 wizard steps capped at 50% (rest
    // of profile completion lives outside the wizard).
    profile: Math.min(50, Math.max(0, Number(e.wizard_step_completed ?? 0) * 12.5)),
    status: _mapOnboardStatus(e),
    wizardStep: Math.max(0, Math.min(4, Number(e.wizard_step_completed ?? 0))),
    dbId: e.id,
    raw: e,
  };
};

// ── Legacy seed (no longer used at runtime) ─────────────────────────────────
// The page now hydrates its rows from /api/employees on mount. The arrays
// below are kept as a typing reference / future demo seed only.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _PENDING_LEGACY: OnboardRow[] = [
  { id: 'OB-001', empId: 'EMP-2399', name: 'Vikram Nair',       initials: 'VN', accent: '#7c5cfc', joinDate: 'Apr 22, 2026', department: 'Engineering', designation: 'Principal Engineer',     primaryRole: 'Backend Architect',   ancillaryRole: 'Tech Strategy',     managerName: 'Atharv Patekar', managerInitials: 'AP', managerAccent: '#0ea5e9', profile: 45, status: 'Document Pending' },
  { id: 'OB-002', empId: 'EMP-2400', name: 'Priyanka Deshmukh', initials: 'PD', accent: '#0ab39c', joinDate: 'Apr 21, 2026', department: 'Finance',     designation: 'Senior Finance Manager', primaryRole: 'FP&A Lead',           ancillaryRole: 'Risk & Compliance', managerName: 'Nikhil Mehra',   managerInitials: 'NM', managerAccent: '#f7b84b', profile: 38, status: 'In Progress' },
  { id: 'OB-003', empId: 'EMP-2401', name: 'Riya Sharma',       initials: 'RS', accent: '#f06548', joinDate: 'Apr 14, 2026', department: 'Engineering', designation: 'Senior Developer',       primaryRole: 'Full Stack Engineer', ancillaryRole: 'Tech Lead Backup',  managerName: 'Atharv Patekar', managerInitials: 'AP', managerAccent: '#0ea5e9', profile: 82, status: 'IT Setup' },
  { id: 'OB-004', empId: 'EMP-2402', name: 'Rohit Kulkarni',    initials: 'RK', accent: '#0c63b0', joinDate: 'Apr 14, 2026', department: 'Engineering', designation: 'ML Engineer',            primaryRole: 'ML Engineer',         ancillaryRole: 'Data Analyst',      managerName: 'Atharv Patekar', managerInitials: 'AP', managerAccent: '#0ea5e9', profile: 55, status: 'Document Pending' },
  { id: 'OB-005', empId: 'EMP-2403', name: 'Arjun Mehta',       initials: 'AM', accent: '#a06f00', joinDate: 'Apr 21, 2026', department: 'Data Science',designation: 'Data Analyst',           primaryRole: 'Data Analyst',        ancillaryRole: 'MIS Support',       managerName: 'Shatakshi Singh',managerInitials: 'SS', managerAccent: '#5a3fd1', profile: 38, status: 'In Progress' },
  { id: 'OB-006', empId: 'EMP-2404', name: 'Kavya Nair',        initials: 'KN', accent: '#108548', joinDate: 'Apr 28, 2026', department: 'Product',     designation: 'Business Analyst',       primaryRole: 'Business Analyst',    ancillaryRole: 'QA Support',        managerName: 'Rajesh Meshram', managerInitials: 'RM', managerAccent: '#e83e8c', profile: 45, status: 'Not Started' },
  { id: 'OB-007', empId: 'EMP-2405', name: 'Pooja Desai',       initials: 'PD', accent: '#0ab39c', joinDate: 'Apr 9, 2026',  department: 'HR',          designation: 'HR Executive',           primaryRole: 'HR Business Partner', ancillaryRole: 'Payroll Coordinator', managerName: 'Priya Mehta',  managerInitials: 'PM', managerAccent: '#7c5cfc', profile: 60, status: 'Orientation' },
  { id: 'OB-008', empId: 'EMP-2406', name: 'Nikhil Sharma',     initials: 'NS', accent: '#5a3fd1', joinDate: 'Apr 22, 2026', department: 'Sales',       designation: 'Sales Executive',        primaryRole: 'Inside Sales Rep',    ancillaryRole: '',                  managerName: 'Priya Iyer',     managerInitials: 'PI', managerAccent: '#0ab39c', profile: 25, status: 'Not Started' },
  { id: 'OB-009', empId: 'EMP-2407', name: 'Tanvi Ghosh',       initials: 'TG', accent: '#a02960', joinDate: 'Apr 10, 2026', department: 'Design',      designation: 'UI/UX Designer',         primaryRole: 'Product Designer',    ancillaryRole: 'Brand Design Support', managerName: 'Neha Kulkarni',managerInitials: 'NK', managerAccent: '#f06548', profile: 70, status: 'IT Setup' },
  { id: 'OB-010', empId: 'EMP-2408', name: 'Karan Verma',       initials: 'KV', accent: '#0c63b0', joinDate: 'Apr 16, 2026', department: 'Operations',  designation: 'Operations Analyst',     primaryRole: 'Supply Chain Analyst',ancillaryRole: 'Vendor Ops',        managerName: 'Vivek Iyer',     managerInitials: 'VI', managerAccent: '#0c63b0', profile: 50, status: 'Document Pending' },
  { id: 'OB-011', empId: 'EMP-2409', name: 'Sneha Kulkarni',    initials: 'SK', accent: '#7c5cfc', joinDate: 'Apr 18, 2026', department: 'Finance',     designation: 'Finance Analyst',        primaryRole: 'AR/AP Analyst',       ancillaryRole: 'MIS Reporting',     managerName: 'Nikhil Mehra',   managerInitials: 'NM', managerAccent: '#f7b84b', profile: 33, status: 'In Progress' },
  { id: 'OB-012', empId: 'EMP-2410', name: 'Aditya Joshi',      initials: 'AJ', accent: '#0ea5e9', joinDate: 'Apr 11, 2026', department: 'Marketing',   designation: 'Performance Marketer',   primaryRole: 'Digital Marketing Lead', ancillaryRole: 'Content Support', managerName: 'Ritu Khanna',  managerInitials: 'RK', managerAccent: '#0ea5e9', profile: 48, status: 'Orientation' },
  { id: 'OB-013', empId: 'EMP-2411', name: 'Manasi Patil',      initials: 'MP', accent: '#f06548', joinDate: 'Apr 25, 2026', department: 'Mobile',      designation: 'Flutter Developer',      primaryRole: 'Mobile App Developer',ancillaryRole: 'QA Tester',         managerName: 'Mayur Thorat',   managerInitials: 'MT', managerAccent: '#0ab39c', profile: 20, status: 'Not Started' },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _COMPLETED_LEGACY: OnboardRow[] = [
  { id: 'OB-091', empId: 'EMP-2390', name: 'Divya Iyer',      initials: 'DI', accent: '#7c5cfc', joinDate: 'Mar 1, 2026',  department: 'Engineering', designation: 'DevOps Engineer',      primaryRole: 'DevOps Engineer',       ancillaryRole: 'SRE Support',          managerName: 'Arun Gupta',     managerInitials: 'AG', managerAccent: '#108548', profile: 100, status: 'Completed' },
  { id: 'OB-092', empId: 'EMP-2391', name: 'Siddharth Jain',  initials: 'SJ', accent: '#0ab39c', joinDate: 'Mar 8, 2026',  department: 'Finance',     designation: 'Senior Finance Analyst', primaryRole: 'FP&A Analyst',          ancillaryRole: 'Budget Coordinator',   managerName: 'Nikhil Mehra',   managerInitials: 'NM', managerAccent: '#f7b84b', profile: 100, status: 'Completed' },
  { id: 'OB-093', empId: 'EMP-2392', name: 'Ishita Verma',    initials: 'IV', accent: '#0c63b0', joinDate: 'Feb 22, 2026', department: 'HR',          designation: 'HR Specialist',          primaryRole: 'Recruitment Specialist',ancillaryRole: 'Learning & Dev',       managerName: 'Priya Mehta',    managerInitials: 'PM', managerAccent: '#7c5cfc', profile: 100, status: 'Completed' },
  { id: 'OB-094', empId: 'EMP-2393', name: 'Aryan Kapoor',    initials: 'AK', accent: '#a06f00', joinDate: 'Mar 15, 2026', department: 'Engineering', designation: 'Backend Engineer',       primaryRole: 'Backend Developer',     ancillaryRole: 'API Integration',      managerName: 'Atharv Patekar', managerInitials: 'AP', managerAccent: '#0ea5e9', profile: 100, status: 'Completed' },
  { id: 'OB-095', empId: 'EMP-2394', name: 'Priya Nair',      initials: 'PN', accent: '#a02960', joinDate: 'Feb 28, 2026', department: 'Sales',       designation: 'Sales Executive',        primaryRole: 'Enterprise Sales Rep',  ancillaryRole: 'CRM Champion',         managerName: 'Priya Iyer',     managerInitials: 'PI', managerAccent: '#0ab39c', profile: 100, status: 'Completed' },
  { id: 'OB-096', empId: 'EMP-2395', name: 'Omkar Thakur',    initials: 'OT', accent: '#f06548', joinDate: 'Mar 20, 2026', department: 'Operations',  designation: 'Warehouse Supervisor',   primaryRole: 'Warehouse In-charge',   ancillaryRole: 'GRN Coordinator',      managerName: 'Vivek Iyer',     managerInitials: 'VI', managerAccent: '#0c63b0', profile: 100, status: 'Completed' },
];

// Stat tones & header gradients
const STATUS_TONES: Record<OnboardStatus, { bg: string; fg: string; dot: string }> = {
  'Document Pending': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'In Progress':      { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'IT Setup':         { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Not Started':      { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
  'Orientation':      { bg: '#d3f0ee', fg: '#0a716a', dot: '#0ab39c' },
  'Completed':        { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
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
  { key: 'total',     label: 'Total Employees',           icon: 'ri-team-line',          tint: '#ece6ff', fg: '#7c5cfc', strip: '#7c5cfc' },
  { key: 'progress',  label: 'Onboarding In Progress',    icon: 'ri-time-line',          tint: '#dceefe', fg: '#0c63b0', strip: '#3b82f6' },
  { key: 'completed', label: 'Onboarding Completed',      icon: 'ri-checkbox-circle-line', tint: '#d6f4e3', fg: '#108548', strip: '#10b981' },
  { key: 'notStart',  label: 'Onboarding Not Initiated',  icon: 'ri-pause-circle-line',  tint: '#fdf3d6', fg: '#a06f00', strip: '#f59e0b' },
  { key: 'missing',   label: 'Missing Profile Details',   icon: 'ri-error-warning-line', tint: '#fdd9d6', fg: '#b1401d', strip: '#f06548' },
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
      { title: 'Aadhaar Card uploaded',                          desc: 'Front & back, PDF or image, max 5 MB',                                            badges: ['REQUIRED', 'ALL'] },
      { title: 'PAN Card uploaded',                              desc: 'PDF or image, max 5 MB',                                                          badges: ['REQUIRED', 'ALL'] },
      { title: 'Passport-size Photograph uploaded',              desc: 'JPG/PNG, max 2 MB, white background preferred',                                   badges: ['REQUIRED', 'ALL'] },
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
  const reloadApiRows = () => {
    api.get('/employees')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        setApiRows(list.map(apiToOnboardRow));
      })
      .catch(() => setApiRows([]));
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
  const closeInitiate = () => { setInitiateOpen(false); setInitiateRow(null); };

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

  // Pagination — match the master tables (7 per page).
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 7;

  // Reset filters and page when tabbing across; also reset page when filters
  // change so the user always lands on page 1 of the new filtered set.
  useEffect(() => { setStatusFilter('All'); setQ(''); setPage(1); }, [tab]);
  useEffect(() => { setPage(1); }, [q, deptFilter, statusFilter]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * PAGE_SIZE;
  const visible   = filtered.slice(sliceFrom, sliceFrom + PAGE_SIZE);
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  return (
    <>
      <MasterFormStyles />

      {/* ── Hero card (purple-tinted, separate container) ── */}
      <div className="onb-hero-card mb-3">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
            style={{
              width: 46, height: 46,
              background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
              boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
            }}
          >
            <i className="ri-user-add-line" style={{ color: '#fff', fontSize: 21 }} />
          </span>
          <div className="min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Employee Onboarding Hub</h5>
              <span className="onb-hero-pill">
                <span className="dot" />Active
              </span>
            </div>
            <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
              Track newly joined employees, onboarding progress, and completed onboarding records
            </div>
          </div>
        </div>
        <Button
          onClick={() => setChecklistOpen(true)}
          className="onb-checklist-cta rounded-pill"
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
                    <AnimatedNumber value={(counts as any)[k.key] ?? 0} />
                  </h3>
                </div>
                <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Tabs (free, no surrounding container — like the screenshot) ── */}
      <div className="d-flex mb-3" style={{ gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'pending'   as const, label: 'Onboarding Pending (New Joiners)', count: counts.pending,   icon: 'ri-time-line' },
          { key: 'completed' as const, label: 'Onboarding Completed',             count: counts.completed, icon: 'ri-checkbox-circle-line' },
        ].map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="btn d-inline-flex align-items-center gap-2 fw-semibold"
              style={{
                borderRadius: 999,
                padding: '8px 16px',
                fontSize: 13,
                background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'var(--vz-card-bg)',
                color: on ? '#fff' : 'var(--vz-secondary-color)',
                border: on ? 'none' : '1px solid var(--vz-border-color)',
                boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
              }}
            >
              <i className={t.icon} style={{ fontSize: 14 }} />
              {t.label}
              <span
                className="badge rounded-pill"
                style={{
                  fontSize: 11,
                  background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                  color: on ? '#fff' : 'var(--vz-secondary-color)',
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters + Table — own card, like Employee list ── */}
      <Card>
        <CardBody>
          <Row className="g-2 align-items-center mb-3">
            <Col md={5} sm={12}>
              <div className="search-box">
                <Input
                  type="text"
                  className="form-control"
                  placeholder="Search name, ID, department…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
                <i className="ri-search-line search-icon"></i>
              </div>
            </Col>
            <Col md={7} sm={12} className="d-flex justify-content-md-end gap-3 flex-wrap align-items-center">
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Department</span>
                <div style={{ minWidth: 170 }}>
                  <MasterSelect
                    value={deptFilter}
                    onChange={setDeptFilter}
                    options={DEPT_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Status</span>
                <div style={{ minWidth: 170 }}>
                  <MasterSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={tab === 'pending' ? STATUS_OPTIONS_PENDING : [{ value: 'All', label: 'All' }, { value: 'Completed', label: 'Completed' }]}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {filtered.length} results
              </div>
            </Col>
          </Row>

          <div className="table-responsive table-card  rounded p-2">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col" className="ps-3" style={{ width: 60 }}>Sr. No.</th>
                        <th scope="col">Employee</th>
                        <th scope="col">Emp ID</th>
                        <th scope="col">Department</th>
                        <th scope="col">Designation</th>
                        <th scope="col">Primary Role</th>
                        <th scope="col">Ancillary Role</th>
                        <th scope="col">Rep. Manager</th>
                        <th scope="col">Profile %</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="pe-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No onboarding records match your filters
                          </td>
                        </tr>
                      ) : visible.map((r, idx) => {
                        const tone = STATUS_TONES[r.status];
                        return (
                          <tr key={r.id}>
                            <td className="ps-3 fw-semibold text-muted">{sliceFrom + idx + 1}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
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
                                <div className="min-w-0">
                                  <div className="fw-semibold fs-13">{r.name}</div>
                                  <div className="text-muted" style={{ fontSize: 11.5 }}>{r.joinDate}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="onb-id-pill">{r.empId}</span>
                            </td>
                            <td className="fs-13">{r.department}</td>
                            <td className="fs-13">{r.designation}</td>
                            <td>
                              <span className="onb-role-pill">{r.primaryRole}</span>
                            </td>
                            <td>
                              {r.ancillaryRole ? (
                                <span className="onb-role-pill">{r.ancillaryRole}</span>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td>
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
                                <span className="fs-13 fw-semibold">{r.managerName}</span>
                              </div>
                            </td>
                            <td>
                              {(() => {
                                // Tier-based profile bar (mirrors HrEmployees): floating
                                // circular badge + downward triangle pointer over a
                                // 120-px striped gradient track.
                                const p = r.profile;
                                const T = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                                        : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                                        : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                                        :           { dark: '#f06548', light: '#fda192' };
                                const badgeLeft = Math.max(11, Math.min(89, p));
                                return (
                                  <div style={{ position: 'relative', width: 120, paddingTop: 30 }} title={`Profile ${p}% complete`}>
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: `${badgeLeft}%`,
                                        transform: 'translateX(-50%)',
                                        textAlign: 'center',
                                      }}
                                    >
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
                                    <div
                                      style={{
                                        width: '100%', height: 8,
                                        borderRadius: 999,
                                        background: '#e5e7eb',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${p}%`, height: '100%',
                                          borderRadius: 999,
                                          background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${T.dark}, ${T.light})`,
                                          transition: 'width .25s ease',
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td>
                              <span className="onb-pill" style={{ background: tone.bg, color: tone.fg }}>
                                <span className="d" style={{ background: tone.dot }} />
                                {r.status}
                              </span>
                            </td>
                            <td className="pe-3">
                              {tab === 'completed' ? (
                                <button type="button" className="onb-vault-btn" title="Evidence Vault" onClick={() => openVault(r)}>
                                  <i className="ri-shield-check-line" style={{ fontSize: 14 }} />
                                  Evidence Vault
                                </button>
                              ) : (
                                <div className="d-flex align-items-center gap-2">
                                  <button
                                    type="button"
                                    className="onb-edit-btn"
                                    title="Edit Employee"
                                    onClick={() => openEdit(r)}
                                  >
                                    <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                                  </button>
                                  <button type="button" className="onb-init-btn" title="Initiate Onboarding" onClick={() => openInitiate(r)}>
                                    <i className="ri-add-line" style={{ fontSize: 14 }} />
                                    Initiate Onboarding
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

          {/* Pagination — same layout as master TableContainer */}
          <Row className="align-items-center mt-2 g-3 text-center text-sm-start">
            <div className="col-sm">
              <div className="text-muted">
                Showing
                <span className="fw-semibold ms-1">{visible.length}</span>
                {' '}of <span className="fw-semibold">{filtered.length}</span> Results
              </div>
            </div>
            <div className="col-sm-auto">
              <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
                <li className={safePage <= 1 ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage - 1); }}>Previous</a>
                </li>
                {Array.from({ length: pageCount }).map((_, i) => (
                  <li key={i} className="page-item">
                    <a
                      href="#"
                      className={safePage === i + 1 ? 'page-link active' : 'page-link'}
                      onClick={(e) => { e.preventDefault(); goto(i + 1); }}
                    >
                      {i + 1}
                    </a>
                  </li>
                ))}
                <li className={safePage >= pageCount ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage + 1); }}>Next</a>
                </li>
              </ul>
            </div>
          </Row>
        </CardBody>
      </Card>

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
          // Pull fresh data so Stage 1's hydrate effect sees the new
          // wizard_step / saved fields next render. Also update the row
          // currently held by `initiateRow` so the modal stays open with
          // the latest saved snapshot.
          api.get('/employees').then(r => {
            const list = Array.isArray(r.data) ? r.data : [];
            const next = list.map(apiToOnboardRow);
            setApiRows(next);
            if (initiateRow?.empId) {
              const refreshed = next.find(x => x.empId === initiateRow.empId);
              if (refreshed) setInitiateRow(refreshed);
            }
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
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </button>
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
function VaultModal({
  isOpen, onClose, emp, tab, onTabChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
  tab: 'employee' | 'organizational';
  onTabChange: (t: 'employee' | 'organizational') => void;
}) {
  const allDocs = [...VAULT_EMPLOYEE_DOCS, ...VAULT_ORG_DOCS].flatMap(s => s.docs);
  const counts = {
    total:    allDocs.length,
    verified: allDocs.filter(d => d.status === 'Verified').length,
    signed:   allDocs.filter(d => d.status === 'Signed' || d.status === 'Sent').length,
    pending:  allDocs.filter(d => d.status === 'Pending' || d.status === 'Uploaded').length,
    notGen:   allDocs.filter(d => d.status === 'Not Generated').length,
  };
  const empCount = VAULT_EMPLOYEE_DOCS.flatMap(s => s.docs).length;
  const orgCount = VAULT_ORG_DOCS.flatMap(s => s.docs).length;
  const completion = counts.total ? Math.round(((counts.verified + counts.signed) / counts.total) * 100) : 0;
  const sections = tab === 'employee' ? VAULT_EMPLOYEE_DOCS : VAULT_ORG_DOCS;

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
        style={{ background: 'var(--vz-card-bg)', maxHeight: '90vh' }}
      >
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
                className="btn p-0 d-inline-flex align-items-center justify-content-center"
                style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.20)', border: 'none', color: '#fff' }}
              >
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>
        </div>

        {/* KPI strip (fixed, non-scrolling) */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--vz-border-color)', flexShrink: 0 }}>
          <Row className="g-3 align-items-stretch">
            {[
              { key: 'total',    label: 'Total Docs',    value: counts.total,    icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
              { key: 'verified', label: 'Verified',      value: counts.verified, icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
              { key: 'signed',   label: 'Signed',        value: counts.signed,   icon: 'ri-quill-pen-line',       gradient: 'linear-gradient(135deg,#5e4dd6,#9b7dff)' },
              { key: 'pending',  label: 'Pending',       value: counts.pending,  icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
              { key: 'notgen',   label: 'Not Generated', value: counts.notGen,   icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#878a99,#b9bbc6)' },
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

        {/* Tabs (fixed, non-scrolling) */}
        <div className="d-flex" style={{ padding: '0 24px', borderBottom: '1px solid var(--vz-border-color)', flexShrink: 0 }}>
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

        {/* Section list — only this region scrolls */}
        <div style={{ padding: '8px 24px 22px', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
          {sections.map(section => (
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
                  className="d-inline-flex align-items-center"
                  style={{ padding: '4px 12px', borderRadius: 999, background: '#f5f0ff', color: '#5a3fd1', fontSize: 11.5, fontWeight: 600 }}
                >
                  {section.docs.length} docs
                </span>
              </div>
              <div>
                {section.docs.map(doc => {
                  const dt = VAULT_STATUS_TONE[doc.status];
                  return (
                    <div key={doc.id} className="vault-doc-row flex-wrap">
                      <div className="vault-doc-icon" style={{ background: doc.tint, color: doc.fg }}>
                        <i className={doc.icon} />
                      </div>
                      <div className="vault-doc-meta">
                        <div className="vault-doc-name">{doc.name}</div>
                        <div className="vault-doc-desc">{doc.desc}</div>
                      </div>
                      {doc.category && (
                        <span
                          className="d-inline-flex align-items-center"
                          style={{ padding: '4px 10px', borderRadius: 999, background: '#eef2f6', color: '#475569', fontSize: 11, fontWeight: 600 }}
                        >
                          {doc.category}
                        </span>
                      )}
                      <span className="vault-status-pill" style={{ background: dt.bg, color: dt.fg }}>
                        <span className="vault-status-dot" style={{ background: dt.dot }} />
                        {doc.status}
                      </span>
                      <button type="button" className="vault-action-view">
                        <i className="ri-eye-line" /> View
                      </button>
                      <button type="button" className="vault-action-download">
                        <i className="ri-download-2-line" /> Download
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}

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
      scrollable
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header */}
        <div className="onb-checklist-header">
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </button>

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
                            style={{ background: tone.bg, color: tone.fg }}
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
type DocStatus = 'Pending' | 'Uploaded' | 'Verified' | 'Rejected' | 'Optional';
interface ChecklistDoc { id: string; name: string; sub: string; status: DocStatus }
interface DocCategory { id: string; title: string; icon: string; tint: string; fg: string; docs: ChecklistDoc[] }

const STAGE2_CATEGORIES: DocCategory[] = [
  {
    id: 'identity', title: 'Identity Documents', icon: 'ri-id-card-line', tint: '#ece6ff', fg: '#5a3fd1',
    docs: [
      { id: 'aadhaar',    name: 'Aadhaar Card (Front & Back)', sub: 'PDF or Image, max 5 MB', status: 'Pending' },
      { id: 'pan',        name: 'PAN Card',                    sub: 'PDF or Image, max 5 MB', status: 'Pending' },
      { id: 'photo',      name: 'Passport-size Photograph',    sub: 'JPG/PNG, max 2 MB',      status: 'Pending' },
    ],
  },
  {
    id: 'address', title: 'Address Proof', icon: 'ri-map-pin-line', tint: '#dceefe', fg: '#0c63b0',
    docs: [
      { id: 'cur_addr',  name: 'Current Address Proof',   sub: 'Utility Bill / Rent Agreement — max 6 months old', status: 'Pending' },
      { id: 'perm_addr', name: 'Permanent Address Proof', sub: 'Govt-issued address proof',                        status: 'Pending' },
    ],
  },
  {
    id: 'education', title: 'Education Documents', icon: 'ri-graduation-cap-line', tint: '#d3f0ee', fg: '#0a716a',
    docs: [
      { id: 'ssc',  name: '10th Marksheet (SSC / Matriculation)', sub: 'Board certificate + mark sheet',           status: 'Pending'  },
      { id: 'hsc',  name: '12th Marksheet (HSC / Intermediate)',  sub: 'Board certificate + mark sheet',           status: 'Pending'  },
      { id: 'grad', name: 'Graduation Certificate / Degree',      sub: 'Official degree or provisional certificate', status: 'Pending'  },
      { id: 'pg',   name: 'Post-graduation Certificate',          sub: 'If applicable',                              status: 'Optional' },
    ],
  },
  {
    id: 'bank', title: 'Bank Details', icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548',
    docs: [
      { id: 'cheque', name: 'Cancelled Cheque', sub: 'Cancelled cheque leaf with account number & IFSC clearly visible, PDF or Image, max 5 MB', status: 'Pending' },
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

const STAGE2_COMPANY_DOCS: { id: string; name: string; status: DocStatus }[] = [
  { id: 'exp_letter',   name: 'Experience Letter',     status: 'Pending'  },
  { id: 'rel_letter',   name: 'Relieving Letter',      status: 'Pending'  },
  { id: 'salary_slips', name: 'Last 3 Months Salary Slips', status: 'Pending'  },
  { id: 'offer_letter', name: 'Previous Offer Letter', status: 'Optional' },
];

const DOC_STATUS_TONE: Record<DocStatus, { bg: string; fg: string; dot: string }> = {
  Pending:  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  Uploaded: { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  Verified: { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  Rejected: { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
  Optional: { bg: '#ece6ff', fg: '#5a3fd1', dot: '#7c5cfc' },
};

function InitiateOnboardingModal({
  isOpen, onClose, emp, onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
  onSaved?: () => void;
}) {
  const [activeStage, setActiveStage] = useState(1);
  // Reset to stage 1 each time a new employee opens
  useEffect(() => { if (isOpen) setActiveStage(1); }, [isOpen, emp?.id]);

  // ── Master data — fetched once when the modal first opens. Everything
  //    Stage 1 needs to populate its dropdowns: countries (work + nationality),
  //    departments, designations, roles, legal entities, eligible managers.
  //    All scoped server-side to the inviting tenant.
  const [mCountries, setMCountries]       = useState<{ id: number; name: string }[]>([]);
  const [mDepts, setMDepts]               = useState<{ id: number; name: string }[]>([]);
  const [mDesignations, setMDesignations] = useState<{ id: number; name: string }[]>([]);
  const [mRoles, setMRoles]               = useState<{ id: number; name: string }[]>([]);
  const [mLegalEntities, setMLegalEntities] = useState<{ id: number; entity_name: string; city?: string | null }[]>([]);
  const [managerOpts, setManagerOpts]       = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.allSettled([
      api.get('/master/countries').then(r => { if (!cancelled) setMCountries(Array.isArray(r.data) ? r.data : []); }),
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
        setManagerOpts(merged.map(m => ({ value: `${m.kind}:${m.id}`, label: m.label })));
      }).catch(() => { if (!cancelled) setManagerOpts([]); }),
    ]);
    return () => { cancelled = true; };
  }, [isOpen]);

  const countryOpts     = mCountries.map(c => ({ value: String(c.id), label: c.name }));
  const departmentOpts  = mDepts.map(d => ({ value: String(d.id), label: d.name }));
  const designationOpts = mDesignations.map(d => ({ value: String(d.id), label: d.name }));
  const roleOpts        = mRoles.map(r => ({ value: String(r.id), label: r.name }));
  const legalEntityOpts = mLegalEntities.map(le => ({ value: String(le.id), label: le.entity_name }));

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
    nationality_country_id: '',
    work_country_id: '',
    email:       '',
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
    laptop_assigned: '', laptop_asset_id: '', mobile_device: '', other_assets: '',
    attendance_tracking: true,

    enable_payroll: true,
    pay_group: '', annual_salary: '', salary_frequency: 'Per annum',
    salary_effective_from: '', salary_structure: '', tax_regime: '',
    bonus_in_annual: false, pf_eligible: false, detailed_breakup: false,
  });

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
      nationality_country_id: x.nationality_country_id ? String(x.nationality_country_id) : '',
      work_country_id:        x.work_country_id        ? String(x.work_country_id)        : '',
      email:       String(x.email  ?? ''),
      mobile:      String(x.mobile ?? ''),

      department_id:    x.department_id    ? String(x.department_id)    : '',
      designation_id:   x.designation_id   ? String(x.designation_id)   : '',
      primary_role_id:  x.primary_role_id  ? String(x.primary_role_id)  : '',
      ancillary_role_id: x.ancillary_role_id ? String(x.ancillary_role_id) : '',
      legal_entity_id:  x.legal_entity_id  ? String(x.legal_entity_id)  : '',
      location:         String(x.location ?? ''),
      reporting_manager: x.reporting_manager_id ? `employee:${x.reporting_manager_id}` : '',
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
      detailed_breakup:      !!x.detailed_breakup,
    });
  }, [isOpen, emp?.id, emp?.raw]);

  /** Push the current Stage 1 form values to the backend as a PUT. The
   *  server already accepts partial PATCHes — fields the wizard hasn't
   *  saved yet stay null on the row. wizard_step_completed gets bumped
   *  by the controller's high-watermark logic only if we send a higher
   *  value, so passing 4 here marks the wizard fully done. */
  const saveStage1 = async (markComplete: boolean) => {
    if (!emp?.dbId || s1Saving) return;
    setS1Saving(true);
    const intOrNull = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };
    // Reporting manager uses a composite "kind:id" so the picker can host
    // both employees and login users in one list. Only persist the FK when
    // the candidate is an actual employee (the column expects employees.id).
    const rmId = (() => {
      if (!s1.reporting_manager) return null;
      const [kind, idStr] = String(s1.reporting_manager).split(':');
      if (kind !== 'employee') return null;
      return intOrNull(idStr);
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
      reporting_manager_id: rmId,
      annual_salary:    s1.annual_salary === '' ? null : Number(s1.annual_salary),
      // Empty strings to null for nullable string columns
      first_name:  s1.first_name.trim() || null,
      middle_name: s1.middle_name.trim() || null,
      last_name:   s1.last_name.trim()   || null,
      email:       s1.email.trim()       || null,
      mobile:      s1.mobile.trim()      || null,
    };
    // Strip the composite picker key — backend doesn't know about it.
    delete payload.reporting_manager;
    if (markComplete) payload.wizard_step_completed = 4;
    try {
      await api.put(`/employees/${emp.dbId}`, payload);
      onSaved?.();
    } catch {
      // Network / validation issue — keep the modal open so the user
      // doesn't lose what they typed.
    } finally {
      setS1Saving(false);
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
  const stage1Pct = wizardStep * 25;
  const stage1Done = wizardStep >= 4;

  const stagesView = ONB_STAGES.map(s => {
    let status: StageStatus, progress: number;
    if (s.num === 1) {
      // Anchored to real wizard state — completion can't roll back.
      progress = stage1Pct;
      status   = stage1Done ? 'Completed' : (wizardStep > 0 ? 'In Progress' : 'Pending');
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
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
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
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <div className="d-flex align-items-center gap-2">
                <span className="onb-init-status-pill"><i className="ri-time-line" /> Status: {emp.status}</span>
                <span className="onb-init-status-pill"><i className="ri-user-line" /> Profile: {emp.profile}% complete</span>
              </div>
              <div>
                <p className="onb-init-prod">PRAANA OS · HRMS</p>
                <div className="onb-init-prod-name">Employee Onboarding Flow</div>
              </div>
            </div>
          </div>

          {/* Stepper */}
          <div className="onb-init-stepper">
            {stagesView.map((s, i) => (
              <Fragment key={s.key}>
                <button
                  type="button"
                  className={`onb-init-step ${activeStage === s.num ? 'is-active' : ''}`}
                  onClick={() => setActiveStage(s.num)}
                >
                  <span className="num">
                    {s.status === 'Completed' ? <i className="ri-check-line" /> : s.num}
                  </span>
                  {s.label}
                </button>
                {i < stagesView.length - 1 && <span className="onb-init-step-sep">·</span>}
              </Fragment>
            ))}
          </div>
        </div>

        {/* Two-column body */}
        <div className="onb-init-body">
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
                onClick={() => setActiveStage(s.num)}
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

            {activeStage === 1 && (
              <>
                {/* Profile completion banner */}
                <div className="onb-init-profile-bar">
                  <div className="onb-init-profile-head">
                    <p className="onb-init-profile-label"><i className="ri-time-line" /> Profile Completion</p>
                    <span className="onb-init-profile-pct">{emp.profile}%</span>
                  </div>
                  <div className="onb-init-profile-track"><div className="onb-init-profile-fill" style={{ width: `${emp.profile}%` }} /></div>
                  <div className="onb-init-profile-help">{emp.profile}% complete · Required fields (marked red) must be filled before proceeding to Stage 2</div>
                </div>
              </>
            )}

            {activeStage === 2 && <Stage2Documents />}
            {activeStage === 3 && <Stage3Provisioning emp={emp} />}
            {activeStage === 4 && <Stage4Payroll />}
            {activeStage === 5 && <Stage5Policies />}
            {activeStage === 6 && <Stage6Verify emp={emp} />}

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
                  <Col md={4}>
                    <label className="onb-init-label">Work Country</label>
                    <MasterSelect options={countryOpts} placeholder="Select country" value={s1.work_country_id} onChange={(v) => setS1(p => ({ ...p, work_country_id: v }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">First Name <span className="req">*</span></label>
                    <input className="onb-init-input" value={s1.first_name} onChange={e => setS1(p => ({ ...p, first_name: e.target.value }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Middle Name</label>
                    <input className="onb-init-input" placeholder="Middle name (optional)" value={s1.middle_name} onChange={e => setS1(p => ({ ...p, middle_name: e.target.value }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Last Name <span className="req">*</span></label>
                    <input className="onb-init-input" value={s1.last_name} onChange={e => setS1(p => ({ ...p, last_name: e.target.value }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Display Name <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={[s1.first_name, s1.middle_name, s1.last_name].filter(Boolean).join(' ').trim() || emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Actual Name <span className="auto">AUTO</span></label>
                    <input className="onb-init-input is-autofilled" readOnly value={[s1.first_name, s1.middle_name, s1.last_name].filter(Boolean).join(' ').trim() || emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Gender</label>
                    <MasterSelect options={ONB_GENDER} placeholder="Select gender" value={s1.gender} onChange={(v) => setS1(p => ({ ...p, gender: v }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Date of Birth <span className="req">*</span></label>
                    <MasterDatePicker placeholder="Select date of birth" value={s1.date_of_birth} onChange={(v) => setS1(p => ({ ...p, date_of_birth: v }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Nationality</label>
                    <MasterSelect options={countryOpts} placeholder="Select nationality" value={s1.nationality_country_id} onChange={(v) => setS1(p => ({ ...p, nationality_country_id: v }))} />
                  </Col>
                </Row>

                <p className="onb-init-subgroup">Contact &amp; Identity</p>
                <Row className="g-3">
                  <Col md={4}>
                    <label className="onb-init-label">Work Email <span className="req">*</span></label>
                    <input className="onb-init-input is-required" placeholder="name@enterprise.com" value={s1.email} onChange={e => setS1(p => ({ ...p, email: e.target.value }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Mobile Number <span className="req">*</span></label>
                    <input className="onb-init-input is-required" placeholder="+91 XXXXX XXXXX" value={s1.mobile} onChange={e => setS1(p => ({ ...p, mobile: e.target.value }))} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Number Series</label>
                    <MasterSelect options={ONB_NUMBER_SERIES} defaultValue="Default Number Series" />
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
                    <input className="onb-init-input" placeholder="e.g. O+" />
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
                  <Col md={4}><label className="onb-init-label">Joining Date</label><MasterDatePicker placeholder="dd-mm-yyyy" value={s1.date_of_joining} onChange={(v) => setS1(p => ({ ...p, date_of_joining: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Department</label><MasterSelect options={departmentOpts} placeholder="Select department" value={s1.department_id} onChange={(v) => setS1(p => ({ ...p, department_id: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Designation</label><MasterSelect options={designationOpts} placeholder="Select designation" value={s1.designation_id} onChange={(v) => setS1(p => ({ ...p, designation_id: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Primary Role</label><MasterSelect options={roleOpts} placeholder="Select role" value={s1.primary_role_id} onChange={(v) => setS1(p => ({ ...p, primary_role_id: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Ancillary Role</label><MasterSelect options={roleOpts} placeholder="Select role" value={s1.ancillary_role_id} onChange={(v) => setS1(p => ({ ...p, ancillary_role_id: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Work Type <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="Full Time" /></Col>
                </Row>

                <p className="onb-init-subgroup">Organisational Details</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Legal Entity</label><MasterSelect options={legalEntityOpts} placeholder="Select entity" value={s1.legal_entity_id} onChange={(v) => {
                    const ent = mLegalEntities.find(le => String(le.id) === String(v));
                    setS1(p => ({ ...p, legal_entity_id: v, location: p.location || (ent?.city || '') }));
                  }} /></Col>
                  <Col md={4}><label className="onb-init-label">Location</label><input className="onb-init-input" value={s1.location} onChange={e => setS1(p => ({ ...p, location: e.target.value }))} placeholder="Office / city" /></Col>
                  <Col md={4}><label className="onb-init-label">Reporting Manager</label><MasterSelect options={managerOpts} placeholder="Select manager" value={s1.reporting_manager} onChange={(v) => setS1(p => ({ ...p, reporting_manager: v }))} /></Col>
                </Row>

                <p className="onb-init-subgroup">Employment Terms</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Probation Policy</label><MasterSelect options={ONB_PROBATION} value={s1.probation_policy || 'Default Probation Policy'} onChange={(v) => setS1(p => ({ ...p, probation_policy: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Notice Period</label><MasterSelect options={ONB_NOTICE} value={s1.notice_period || 'Default Notice Period'} onChange={(v) => setS1(p => ({ ...p, notice_period: v }))} /></Col>
                  <Col md={4}><label className="onb-init-label">Work Mode <span className="auto">AUTO</span></label><input className="onb-init-input is-autofilled" readOnly value="On-site" /></Col>
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
                  <Col md={4}><label className="onb-init-label">Leave Plan</label><MasterSelect options={ONB_LEAVE_PLAN} defaultValue="Leave Policy" /></Col>
                  <Col md={4}><label className="onb-init-label">Holiday List</label><MasterSelect options={ONB_HOLIDAY} defaultValue="Holiday Calendar" /></Col>
                  <Col md={4}><label className="onb-init-label">Shift</label><MasterSelect options={ONB_SHIFT} defaultValue="General Shift" /></Col>
                  <Col md={4}><label className="onb-init-label">Weekly Off</label><MasterSelect options={ONB_WEEKLY_OFF} defaultValue="Week Off Policy" /></Col>
                  <Col md={4}><label className="onb-init-label">Attendance Number</label><input className="onb-init-input" placeholder="Attendance number" /></Col>
                  <Col md={4}><label className="onb-init-label">Time Tracking Policy</label><MasterSelect options={ONB_TIME_TRACK} defaultValue="Attendance Capture" /></Col>
                  <Col md={4}><label className="onb-init-label">Penalization Policy</label><MasterSelect options={ONB_PENALIZE} defaultValue="Tracking Policy" /></Col>
                  <Col md={4}><label className="onb-init-label">Overtime</label><MasterSelect options={ONB_OVERTIME} defaultValue="Not applicable" /></Col>
                  <Col md={4}><label className="onb-init-label">Expense Policy</label><MasterSelect options={ONB_EXPENSE} placeholder="Select policy" /></Col>
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
                  <Col md={4}><label className="onb-init-label">Laptop Assigned</label><MasterSelect options={ONB_YES_NO} defaultValue="No" /></Col>
                  <Col md={4}><label className="onb-init-label">Laptop Asset ID</label><input className="onb-init-input" placeholder="e.g. LAP-0042" /></Col>
                  <Col md={4}><label className="onb-init-label">Mobile Device</label><input className="onb-init-input" placeholder="e.g. iPhone 15" /></Col>
                  <Col md={4}><label className="onb-init-label">Other Assets</label><input className="onb-init-input" placeholder="Monitor, Keyboard..." /></Col>
                  <Col md={4}><label className="onb-init-label">Access Card</label><MasterSelect options={ONB_ACCESS_CARD} defaultValue="Not Issued" /></Col>
                  <Col md={4}><label className="onb-init-label">Desk / Workstation</label><input className="onb-init-input" placeholder="e.g. A-12" /></Col>
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
                  <Col md={4}><label className="onb-init-label">Pay Group</label><MasterSelect options={ONB_PAY_GROUP} defaultValue="Default pay group" /></Col>
                  <Col md={4}><label className="onb-init-label">Annual Salary <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="Enter amount" /></Col>
                  <Col md={4}><label className="onb-init-label">Period</label><MasterSelect options={ONB_PERIOD} defaultValue="Per annum" /></Col>
                  <Col md={4}><label className="onb-init-label">Salary Effective From <span className="req">*</span></label><MasterDatePicker placeholder="Select effective date" /></Col>
                  <Col md={4}><label className="onb-init-label">Salary Structure Type</label><MasterSelect options={ONB_SAL_STRUCT} defaultValue="Range Based" /></Col>
                  <Col md={4}><label className="onb-init-label">Tax Regime</label><MasterSelect options={ONB_TAX_REGIME} defaultValue="New Regime (115BAC)" /></Col>
                </Row>

                <p className="onb-init-subgroup">Bonus, Perks &amp; Statutory</p>
                <div className="onb-init-check-row">
                  <label className="onb-init-check"><input type="checkbox" /> Bonus included in annual salary</label>
                  <label className="onb-init-check"><input type="checkbox" /> Provident Fund (PF) Eligible</label>
                </div>
                <div>
                  <button type="button" className="onb-init-add-btn">+ Add Bonus</button>
                  <button type="button" className="onb-init-add-btn">+ Add Perks</button>
                </div>

                <div className="onb-init-info-banner">
                  <i className="ri-information-line" />
                  ESI is not applicable for the selected Pay Group
                </div>

                <div className="onb-init-breakup">
                  <div className="onb-init-breakup-head">
                    <i className="ri-grid-line" style={{ color: '#7c3aed' }} />
                    Salary Breakup
                    {/* Toggle is now interactive — was previously a bare
                        decorative span with no click handler, so flipping
                        it had no effect. Bound to s1.detailed_breakup so
                        the state survives Save Draft + survives reload. */}
                    <span
                      className="onb-init-breakup-toggle"
                      role="button"
                      tabIndex={0}
                      onClick={() => setS1(p => ({ ...p, detailed_breakup: !p.detailed_breakup }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setS1(p => ({ ...p, detailed_breakup: !p.detailed_breakup })); } }}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      Detailed breakup
                      <span
                        className={`onb-init-toggle${s1.detailed_breakup ? '' : ' off'}`}
                        aria-pressed={s1.detailed_breakup}
                      />
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
                      const annual = s1.annual_salary === '' ? 0 : Number(s1.annual_salary);
                      const bonus  = s1.bonus_in_annual ? Math.round(annual * 0.10) : 0;
                      const regular = annual - bonus;
                      const total = regular + bonus;
                      const fmt = (n: number) => `INR ${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN')}`;
                      return (
                        <div className="onb-init-breakup-grid">
                          <div className="onb-init-breakup-cell"><div className="l">Regular Salary</div><div className="v">{fmt(regular)}</div></div>
                          <span className="onb-init-breakup-op">+</span>
                          <div className="onb-init-breakup-cell"><div className="l">Bonus</div><div className="v">{fmt(bonus)}</div></div>
                          <span className="onb-init-breakup-op">=</span>
                          <div className="onb-init-breakup-cell total"><div className="l">Total CTC</div><div className="v">{fmt(total)}</div></div>
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
          </div>
        </div>

        {/* Footer */}
        <div className="onb-init-footer">
          <span className="onb-init-footer-meta">
            <i className="ri-information-line" />
            Stage {activeStage} of 6 — {ONB_STAGES[activeStage - 1].stage}
          </span>
          <div className="d-flex align-items-center gap-2">
            <button type="button" className="onb-init-btn-ghost" onClick={() => setActiveStage(Math.max(1, activeStage - 1))}>
              <i className="ri-arrow-left-s-line" /> Previous
            </button>
            {/* Save Draft — only Stage 1 has bound state today, so the
                button only writes when the user is on that stage. Marks
                the wizard fully complete (step 4) so the row's profile %
                + status pill catch up. */}
            <button
              type="button"
              className="onb-init-btn-outline"
              disabled={s1Saving || activeStage !== 1}
              onClick={() => saveStage1(true)}
            >
              {s1Saving ? 'Saving…' : 'Save Draft'}
            </button>
            {activeStage < 6 ? (
              <button
                type="button"
                className="onb-init-btn-next"
                onClick={async () => {
                  // On Stage 1, persist edits before advancing so what the
                  // user sees on Stage 2+ stays in sync with the server.
                  if (activeStage === 1) await saveStage1(true);
                  setActiveStage(activeStage + 1);
                }}
              >
                Next Stage <i className="ri-arrow-right-s-line" />
              </button>
            ) : (
              <button type="button" className="onb-init-btn-complete" onClick={onClose}>
                <i className="ri-checkbox-circle-line" /> Complete Onboarding
              </button>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Stage 2 — Document Management view (used inside InitiateOnboardingModal)
function Stage2Documents() {
  const [prevCompanies, setPrevCompanies] = useState<PrevCompany[]>(() => [makePrevCompany()]);

  const addCompany = () => setPrevCompanies(prev => [...prev, makePrevCompany()]);
  const removeCompany = (id: string) =>
    setPrevCompanies(prev => (prev.length > 1 ? prev.filter(c => c.id !== id) : prev));
  const updateCompany = (id: string, patch: Partial<PrevCompany>) =>
    setPrevCompanies(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const totalDocs = STAGE2_CATEGORIES.reduce((a, c) => a + c.docs.length, 0)
                  + prevCompanies.length * STAGE2_COMPANY_DOCS.length;
  const uploadedDocs = 0;
  const pct = totalDocs ? Math.round((uploadedDocs / totalDocs) * 100) : 0;

  return (
    <>
      {/* Upload progress banner */}
      <div className="onb-doc-progress">
        <span className="onb-doc-progress-icon"><i className="ri-file-list-3-line" style={{ fontSize: 16 }} /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="onb-doc-progress-row">
            <h6 className="onb-doc-progress-title">Document Upload Progress</h6>
            <span className="onb-doc-progress-count">{uploadedDocs} / {totalDocs} Documents</span>
          </div>
          <div className="onb-doc-progress-bar"><div className="onb-doc-progress-fill" style={{ width: `${pct}%` }} /></div>
          <p className="onb-doc-progress-help">Upload all required documents before proceeding to Stage 3. Optional documents can be submitted later.</p>
        </div>
      </div>

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
        return (
          <div key={cat.id} className="onb-doc-cat">
            <div className="onb-doc-cat-head">
              <span className="onb-doc-cat-icon" style={{ background: cat.tint, color: cat.fg }}>
                <i className={cat.icon} />
              </span>
              <h6 className="onb-doc-cat-title">{cat.title}</h6>
              <span className="onb-doc-cat-count">0 / {upTotal} uploaded</span>
              <span className="onb-doc-cat-pct">0%</span>
            </div>
            {cat.docs.map(d => {
              const tone = DOC_STATUS_TONE[d.status];
              return (
                <div key={d.id} className="onb-doc-row">
                  <span className="onb-doc-row-icon"><i className="ri-file-text-line" /></span>
                  <div className="onb-doc-row-meta">
                    <h6 className="onb-doc-row-name">
                      {d.name}
                      {d.status === 'Optional' && <span className="onb-doc-tag">Optional</span>}
                    </h6>
                    <p className="onb-doc-row-sub">{d.sub}</p>
                  </div>
                  <span className="onb-doc-status-pill" style={{ background: tone.bg, color: tone.fg }}>
                    <span className="dot" style={{ background: tone.dot }} />
                    {d.status}
                  </span>
                  <button type="button" className="onb-doc-upload-btn">
                    <i className="ri-upload-cloud-2-line" /> Upload
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Previous Employment Documents */}
      <div className="onb-doc-prev">
        <div className="onb-doc-prev-head">
          <span className="onb-doc-prev-icon"><i className="ri-briefcase-line" style={{ fontSize: 14 }} /></span>
          <div className="min-w-0 flex-grow-1">
            <h6 className="onb-doc-prev-title">Previous Employment Documents</h6>
            <div className="onb-doc-prev-sub">7 Years Experience · Required for each previous company</div>
          </div>
          <span className="onb-doc-prev-pill">{prevCompanies.length} {prevCompanies.length === 1 ? 'Company' : 'Companies'}</span>
        </div>

        {prevCompanies.map((c, idx) => (
          <div key={c.id} className="onb-doc-comp">
            <div className="onb-doc-comp-head">
              <span className="onb-doc-comp-num">{idx + 1}</span>
              <h6 className="onb-doc-comp-name">{c.name || `Previous Company ${idx + 1}`}</h6>
              <span className="onb-doc-comp-count">0/4 Docs</span>
              {prevCompanies.length > 1 && (
                <button
                  type="button"
                  className="onb-doc-comp-close"
                  aria-label="Remove company"
                  onClick={() => removeCompany(c.id)}
                >
                  <i className="ri-close-line" style={{ fontSize: 12 }} />
                </button>
              )}
            </div>
            <div className="onb-doc-comp-body">
              <p className="onb-doc-comp-section"><i className="ri-building-line" /> Company Information</p>
              <Row className="g-3">
                <Col md={6}>
                  <label className="onb-init-label">Company Name <span className="req">*</span></label>
                  <input
                    className="onb-init-input"
                    placeholder="e.g. Wipro Digital (2020-2023)"
                    value={c.name}
                    onChange={e => updateCompany(c.id, { name: e.target.value })}
                  />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Job Title / Designation <span className="req">*</span></label>
                  <input
                    className="onb-init-input"
                    placeholder="e.g. Software Engineer"
                    value={c.jobTitle}
                    onChange={e => updateCompany(c.id, { jobTitle: e.target.value })}
                  />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment Start Date <span className="req">*</span></label>
                  <MasterDatePicker placeholder="Select start date" />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment End Date <span className="req">*</span></label>
                  <MasterDatePicker placeholder="Select end date" />
                </Col>
              </Row>

              <p className="onb-doc-comp-section" style={{ marginTop: 14 }}><i className="ri-file-list-line" /> Document Upload</p>
              {STAGE2_COMPANY_DOCS.map(d => {
                const tone = DOC_STATUS_TONE[d.status];
                return (
                  <div key={d.id} className="onb-doc-comp-doc">
                    <span className="onb-doc-comp-doc-icon"><i className="ri-file-text-line" /></span>
                    <h6 className="onb-doc-comp-doc-name">
                      {d.name}
                      {d.status === 'Optional' && <span className="onb-doc-tag">Optional</span>}
                    </h6>
                    <span className="onb-doc-status-pill" style={{ background: tone.bg, color: tone.fg }}>
                      <span className="dot" style={{ background: tone.dot }} />
                      {d.status}
                    </span>
                    <button type="button" className="onb-doc-upload-btn">
                      <i className="ri-upload-cloud-2-line" /> Upload
                    </button>
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
                    className="onb-init-input is-required"
                    placeholder="hr@company.com"
                    value={c.hrEmail1}
                    onChange={e => updateCompany(c.id, { hrEmail1: e.target.value })}
                  />
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">HR Email ID 2 <span className="req">*</span></label>
                  <input
                    className="onb-init-input is-required"
                    placeholder="hr2@company.com"
                    value={c.hrEmail2}
                    onChange={e => updateCompany(c.id, { hrEmail2: e.target.value })}
                  />
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">Company Contact Number <span className="req">*</span></label>
                  <input
                    className="onb-init-input is-required"
                    placeholder="+91 XXXXX XXXXX"
                    value={c.contactNumber}
                    onChange={e => updateCompany(c.id, { contactNumber: e.target.value })}
                  />
                </Col>
              </Row>
            </div>
          </div>
        ))}

        <button type="button" className="onb-doc-add-comp" onClick={addCompany}>
          <i className="ri-add-line" /> Add Previous Company
        </button>
      </div>
    </>
  );
}

// ── Stage 3 — Provisioning & Asset Setup ────────────────────────────────────
function Stage3Provisioning({ emp }: { emp: OnboardRow }) {
  const tasksTotal = 4;
  const tasksDone  = 0;
  const pct = Math.round((tasksDone / tasksTotal) * 100);

  const autoLabel = (
    <span className="auto" style={{ background: '#d6f4e3', color: '#108548' }}>AUTO-FETCHED</span>
  );

  return (
    <>
      {/* Provisioning progress banner */}
      <div className="onb-prov-progress">
        <span className="onb-prov-progress-icon"><i className="ri-computer-line" style={{ fontSize: 16 }} /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="onb-prov-progress-row">
            <h6 className="onb-prov-progress-title">Provisioning Progress</h6>
            <span className="onb-prov-progress-count">{tasksDone} / {tasksTotal} Tasks</span>
          </div>
          <div className="onb-prov-progress-bar"><div className="onb-prov-progress-fill" style={{ width: `${pct}%` }} /></div>
          <p className="onb-prov-progress-help">Complete all provisioning tasks before activating system access for this employee.</p>
        </div>
      </div>

      {/* System & Email Access */}
      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon system"><i className="ri-mac-line" /></span>
          <h6 className="onb-prov-section-title">System &amp; Email Access</h6>
        </div>
        <div className="onb-prov-section-body">
          <Row className="g-3">
            <Col md={6}>
              <label className="onb-init-label">Official Email Address <span className="req">*</span></label>
              <input className="onb-init-input is-required" placeholder="firstname.lastname@company.com" />
            </Col>
            <Col md={6}>
              <label className="onb-init-label">Employee Code {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span>{emp.empId}</span>
              </div>
            </Col>
          </Row>
        </div>
      </div>

      {/* Device & Asset Allocation */}
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
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span>No</span>
              </div>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Laptop Asset ID {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>
              </div>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Mobile Device {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>
              </div>
            </Col>
            <Col md={12}>
              <label className="onb-init-label">Other Assets {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>
              </div>
            </Col>
          </Row>
        </div>
      </div>

      {/* Physical Setup & Identification */}
      <div className="onb-prov-section">
        <div className="onb-prov-section-head">
          <span className="onb-prov-section-icon physical"><i className="ri-shield-check-line" /></span>
          <h6 className="onb-prov-section-title">Physical Setup &amp; Identification</h6>
        </div>
        <div className="onb-prov-section-body">
          <Row className="g-3">
            <Col md={4}>
              <label className="onb-init-label">Biometric Status {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span>Not Registered</span>
              </div>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">Desk / Workstation No {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span style={{ color: 'var(--vz-secondary-color)' }}>—</span>
              </div>
            </Col>
            <Col md={4}>
              <label className="onb-init-label">ID Card Status {autoLabel}</label>
              <div className="onb-prov-input is-autofetched">
                <i className="ri-checkbox-circle-line" />
                <span>Not Printed</span>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    </>
  );
}

// ── Stage 4 — Payroll & Finance Setup ──────────────────────────────────────
function Stage4Payroll() {
  const [mode, setMode] = useState<'bank' | 'cheque' | 'cash'>('bank');
  const checks: { id: string; name: string }[] = [
    { id: 'bank', name: 'Bank details complete' },
    { id: 'pan',  name: 'PAN verified' },
    { id: 'sal',  name: 'Salary structure confirmed' },
    { id: 'pf',   name: 'PF / ESIC setup complete' },
  ];

  return (
    <>
      {/* Progress banner (amber) */}
      <div className="onb-pay-progress">
        <span className="onb-pay-progress-icon"><i className="ri-money-dollar-circle-line" style={{ fontSize: 16 }} /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="onb-pay-progress-row">
            <h6 className="onb-pay-progress-title">Payroll &amp; Finance Setup</h6>
            <span className="onb-pay-progress-count">0 / 4 Checks</span>
          </div>
          <div className="onb-pay-progress-bar"><div className="onb-pay-progress-fill" style={{ width: '0%' }} /></div>
          <p className="onb-pay-progress-help">Fill all required fields and complete readiness checks before proceeding to Stage 5.</p>
        </div>
      </div>

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
              className={`onb-pay-radio ${mode === opt.id ? 'is-selected' : ''}`}
              onClick={() => setMode(opt.id)}
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

      {/* Bank Details */}
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon bank"><i className="ri-money-dollar-circle-line" /></span>
          <h6 className="onb-pay-section-title">Bank Details</h6>
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col md={4}><label className="onb-init-label">Bank Name <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="e.g. HDFC Bank" /></Col>
            <Col md={4}><label className="onb-init-label">Account Number <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="16-digit account number" /></Col>
            <Col md={4}><label className="onb-init-label">IFSC Code <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="e.g. HDFC0001234" /></Col>
            <Col md={4}><label className="onb-init-label">Name on the Account <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="Full legal name as per bank" /></Col>
            <Col md={4}><label className="onb-init-label">Branch <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="e.g. Baner, Pune" /></Col>
            <Col md={4}><label className="onb-init-label">Account Type</label><MasterSelect options={ONB_ACCOUNT_TYPE} defaultValue="Salary" /></Col>
            <Col md={4}><label className="onb-init-label">UAN Number (PF)</label><input className="onb-init-input" placeholder="12-digit UAN" /></Col>
          </Row>
        </div>
      </div>

      {/* Tax & Statutory Details */}
      <div className="onb-pay-section">
        <div className="onb-pay-section-head">
          <span className="onb-pay-section-icon tax"><i className="ri-file-list-3-line" /></span>
          <h6 className="onb-pay-section-title">Tax &amp; Statutory Details</h6>
        </div>
        <div className="onb-pay-section-body">
          <Row className="g-3">
            <Col md={4}><label className="onb-init-label">PAN Number <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="AAAZZ9999A" /></Col>
            <Col md={4}><label className="onb-init-label">Tax Regime</label><MasterSelect options={ONB_TAX_REGIME} defaultValue="New Regime (115BAC)" /></Col>
            <Col md={4}><label className="onb-init-label">PF Deduction</label><MasterSelect options={ONB_PF_DEDUCT} defaultValue="Employee + Employer" /></Col>
            <Col md={4}><label className="onb-init-label">ESI Applicable</label><MasterSelect options={ONB_YES_NO} defaultValue="No" /></Col>
            <Col md={4}><label className="onb-init-label">Gratuity Nominee Name</label><input className="onb-init-input" placeholder="Full legal name" /></Col>
            <Col md={4}><label className="onb-init-label">Agreed CTC (LPA) <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="e.g. 12" /></Col>
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
          {checks.map(c => (
            <div key={c.id} className="onb-pay-check">
              <span className="onb-pay-check-icon"><i className="ri-loader-line" /></span>
              <h6 className="onb-pay-check-name">{c.name}</h6>
              <span className="onb-doc-status-pill" style={{ background: '#fde8c4', color: '#a4661c' }}>
                <span className="dot" style={{ background: '#f59e0b' }} />
                Pending
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Stage 5 — Policies & Agreements ────────────────────────────────────────
function Stage5Policies() {
  const docs: { id: string; name: string; sub: string; optional?: boolean }[] = [
    { id: 'nda',     name: 'NDA — Non-Disclosure Agreement',         sub: 'Must be signed before Day 1' },
    { id: 'emp',     name: 'Employment Agreement / Appointment Letter', sub: 'Original signed copy required' },
    { id: 'coc',     name: 'Code of Conduct Policy',                  sub: 'Acknowledgement required' },
    { id: 'it_sec',  name: 'IT Security & Acceptable Use Policy',     sub: 'Digital sign required' },
    { id: 'leave',   name: 'Leave & Attendance Policy',               sub: 'Read & acknowledge' },
    { id: 'conf',    name: 'Confidentiality Agreement',               sub: 'Binding for duration of employment' },
    { id: 'gratuity',name: 'Gratuity & Benefit Policy',               sub: 'Statutory acknowledgement', optional: true },
  ];

  return (
    <>
      {/* Signing progress */}
      <div className="onb-pol-progress">
        <span className="onb-pol-progress-icon"><i className="ri-shield-check-line" style={{ fontSize: 16 }} /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="onb-pol-progress-row">
            <h6 className="onb-pol-progress-title">Policies &amp; Agreements Signing Progress</h6>
            <span className="onb-pol-progress-count">0 / {docs.length} Signed</span>
          </div>
          <div className="onb-pol-progress-bar"><div className="onb-pol-progress-fill" style={{ width: '0%' }} /></div>
          <p className="onb-pol-progress-help">All mandatory documents must be digitally signed before proceeding to Final Verification.</p>
        </div>
      </div>

      {/* Status legend */}
      <div className="onb-pol-legend">
        <span style={{ fontWeight: 700, color: '#374151' }}>Signing Status:</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#10b981' }} /> Signed</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#f59e0b' }} /> Pending</span>
        <span className="onb-pol-legend-item"><span className="dot" style={{ background: '#7c5cfc' }} /> Awaiting</span>
        <span className="onb-pol-legend-link">Click "Sign Now" to simulate digital signing →</span>
      </div>

      {/* Organizational documents */}
      <div className="onb-pol-section">
        <div className="onb-pol-section-head">
          <span className="onb-pol-section-icon"><i className="ri-shield-check-line" /></span>
          <h6 className="onb-pol-section-title">Organizational Documents &amp; Agreements</h6>
          <span className="onb-pol-section-pill">0 / {docs.length} signed</span>
        </div>
        {docs.map(d => (
          <div key={d.id} className="onb-pol-doc">
            <div className="onb-pol-doc-row">
              <span className="onb-pol-doc-icon"><i className="ri-file-text-line" /></span>
              <div className="onb-pol-doc-meta">
                <h6 className="onb-pol-doc-name">
                  {d.name}
                  {d.optional && <span className="onb-doc-tag">Optional</span>}
                </h6>
                <p className="onb-pol-doc-sub">{d.sub}</p>
              </div>
              <span className="onb-pol-doc-status">
                <span className="dot" />
                Not Generated
              </span>
              <button type="button" className="onb-pol-gen-btn">
                <i className="ri-file-add-line" /> Generate
              </button>
            </div>
            <p className="onb-pol-doc-help">
              <i className="ri-information-line" />
              Generate this document first to activate the signing tracker and notify signers.
            </p>
          </div>
        ))}
      </div>
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

function ActivateEmployeeModal({ isOpen, onClose, emp }: { isOpen: boolean; onClose: () => void; emp: OnboardRow }) {
  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      contentClassName="onb-act-content"
      modalClassName="onb-act-modal"
      backdrop="static"
      keyboard
    >
      <ModalBody className="p-0">
        <div className="onb-act-header">
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
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
          <button type="button" className="onb-act-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="onb-act-confirm" onClick={onClose}>
            <i className="ri-check-line" style={{ fontSize: 16 }} /> Confirm Activate
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function Stage6Verify({ emp }: { emp: OnboardRow }) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const stageRows: { num: number; name: string; sub: string; icon: string; cls: string; verified: boolean }[] = [
    { num: 1, name: 'Employee Onboarding Setup',     sub: 'Basic details, job info & compensation · Stage 1', icon: 'ri-user-line',          cls: 's1', verified: true  },
    { num: 2, name: 'Document Management',           sub: 'Identity, education & employment docs · Stage 2',  icon: 'ri-file-list-3-line',  cls: 's2', verified: true  },
    { num: 3, name: 'Provisioning & Asset Setup',    sub: 'Email, systems, devices & access · Stage 3',       icon: 'ri-computer-line',     cls: 's3', verified: true  },
    { num: 4, name: 'Payroll & Finance Setup',       sub: 'Bank, PAN, PF/ESIC & salary structure · Stage 4',  icon: 'ri-money-dollar-circle-line', cls: 's4', verified: true },
    { num: 5, name: 'Policies & Agreements',         sub: 'NDA, employment agreement & signing · Stage 5',    icon: 'ri-shield-check-line', cls: 's5', verified: true  },
    { num: 6, name: 'HR Final Approval',             sub: 'HR sign-off & verification',                       icon: 'ri-user-star-line',    cls: 's6', verified: false },
  ];
  const verifiedCount = stageRows.filter(s => s.verified).length;
  const readyPct = Math.round((verifiedCount === stageRows.length ? 100 : 0));

  return (
    <>
      {/* Onboarding Completion Progress (green) */}
      <div className="onb-ver-progress">
        <span className="onb-ver-progress-icon"><i className="ri-checkbox-circle-line" style={{ fontSize: 16 }} /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="onb-ver-progress-row">
            <h6 className="onb-ver-progress-title">Onboarding Completion Progress</h6>
            <span className="onb-ver-progress-count">{readyPct}% Ready</span>
          </div>
          <div className="onb-ver-progress-bar"><div className="onb-ver-progress-fill" style={{ width: `${readyPct}%` }} /></div>
          <p className="onb-ver-progress-help">All 5 stages must be verified before employee can be activated.</p>
        </div>
      </div>

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
              <span className="dot" />
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
          <div className="onb-ver-action-banner">
            <i className="ri-information-line" style={{ marginTop: 1 }} />
            <span>
              Clicking <b style={{ color: '#108548' }}>Activate Employee</b> will mark onboarding as <b>Completed</b>, notify the Reporting Manager, and grant full system access. Use <b style={{ color: '#b1401d' }}>Flag Issue</b> to raise a concern and block activation.
            </span>
          </div>
          <div className="onb-ver-action-buttons">
            <button type="button" className="onb-ver-flag-btn" onClick={() => setFlagOpen(true)}>
              <i className="ri-error-warning-line" style={{ fontSize: 16 }} /> Flag Issue
            </button>
            <button type="button" className="onb-ver-activate-btn" onClick={() => setActivateOpen(true)}>
              <i className="ri-checkbox-circle-line" style={{ fontSize: 16 }} /> Activate Employee
            </button>
          </div>
        </div>
      </div>

      <FlagIssueModal isOpen={flagOpen} onClose={() => setFlagOpen(false)} />
      <ActivateEmployeeModal isOpen={activateOpen} onClose={() => setActivateOpen(false)} emp={emp} />
    </>
  );
}
