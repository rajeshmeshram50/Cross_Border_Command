import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';

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
}

// ── Mock data ────────────────────────────────────────────────────────────────
// 13 pending new joiners + 6 completed (matches the screenshot counts).
const PENDING: OnboardRow[] = [
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

const COMPLETED: OnboardRow[] = [
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
      { title: 'Employee basic details verified', desc: 'First name, last name, display name, employee ID, work country, gender', badges: ['REQUIRED', 'ALL'] },
      { title: 'Contact & identity filled',       desc: 'Work email, mobile number, DOB, blood group, number series',           badges: ['REQUIRED', 'ALL'] },
      { title: 'Job details confirmed',           desc: 'Joining date, department, designation, primary role, ancillary role, work type', badges: ['REQUIRED', 'ALL'] },
      { title: 'Organisational details assigned', desc: 'Legal entity, work location, reporting manager selected',              badges: ['REQUIRED', 'ALL'] },
      { title: 'Work & attendance policy set',    desc: 'Leave plan, holiday list, shift, weekly off, time tracking, penalization policy', badges: ['REQUIRED', 'ALL'] },
      { title: 'Compensation details configured', desc: 'Salary payment mode, pay group, CTC, tax regime, payroll enabled',     badges: ['REQUIRED', 'ALL'] },
      { title: 'Department authority letter issued', desc: 'Authority matrix signed, KRA targets set, department scope defined', badges: ['HOD REQUIRED'] },
      { title: 'Budget access & approval limits configured', desc: 'Departmental budget view, purchase approval threshold set in system', badges: ['HOD REQUIRED'] },
      { title: 'Org chart updated with HOD mapped', desc: 'All direct reportees linked, org chart reviewed and approved by HR', badges: ['HOD REQUIRED'] },
      { title: 'Executive introduction & cross-functional briefing', desc: 'Intro call with Director/CEO, peer HODs, and cross-functional heads', badges: ['HOD OPTIONAL'] },
      { title: 'Team members mapped under Team Leader', desc: 'All direct reportees linked to Team Leader in org structure',   badges: ['TL REQUIRED'] },
      { title: 'Sprint / project board access granted', desc: 'Project management access configured, current sprint briefed',  badges: ['TL REQUIRED'] },
      { title: 'Reporting structure intro & team meet done', desc: 'TL introduced to HOD, peers, and team members',            badges: ['TL OPTIONAL'] },
      { title: 'Role clarity session with reporting manager', desc: 'KPIs, deliverables, probation targets, and review schedule set', badges: ['EXEC REQUIRED'] },
      { title: 'Cross-department introduction completed', desc: 'Introduced to key stakeholders and peer executives',           badges: ['EXEC OPTIONAL'] },
      { title: 'Buddy / buddy-employee assigned',  desc: 'Experienced peer assigned to guide new employee through first 30 days', badges: ['EMP REQUIRED'] },
      { title: 'First week schedule & induction plan shared', desc: 'Day-by-day plan, training schedule, key contacts list provided', badges: ['EMP REQUIRED'] },
      { title: 'Asset allocation recorded',        desc: 'Laptop assigned, asset ID, mobile device, other assets',              badges: ['OPTIONAL', 'ALL'] },
      { title: 'Internship agreement & offer letter signed', desc: 'Duration, stipend, NDA, and project scope confirmed',       badges: ['INTERN REQUIRED'] },
      { title: 'Mentor / supervisor assigned',     desc: 'Dedicated mentor identified, first week schedule shared',             badges: ['INTERN REQUIRED'] },
    ],
  },
  {
    num: 2,
    title: 'Documentation & Compliance',
    subtitle: 'Identity verification, agreements, and policy acknowledgements',
    checkpoints: [
      { title: 'Government ID proofs uploaded', desc: 'Aadhaar, PAN, passport (if applicable) — uploaded and verified',         badges: ['REQUIRED', 'ALL'] },
      { title: 'Address proofs verified',       desc: 'Current and permanent address proofs (utility bill, voter ID, etc.)',   badges: ['REQUIRED', 'ALL'] },
      { title: 'Education certificates collected', desc: '10th, 12th, graduation, post-graduation certificates uploaded',      badges: ['REQUIRED', 'ALL'] },
      { title: 'Previous employment proofs',    desc: 'Relieving letter, experience letter, last 3 pay slips',                  badges: ['OPTIONAL', 'ALL'] },
      { title: 'NDA & employment agreement signed', desc: 'Non-disclosure agreement and offer/appointment letter executed',     badges: ['REQUIRED', 'ALL'] },
      { title: 'Code of conduct acknowledgement', desc: 'Company ethics, behaviour, and conduct policy acknowledged',           badges: ['REQUIRED', 'ALL'] },
      { title: 'Background verification initiated', desc: 'BGV vendor briefed; checks scheduled (employment, education, address)', badges: ['REQUIRED', 'ALL'] },
    ],
  },
  {
    num: 3,
    title: 'IT & Workstation Setup',
    subtitle: 'Hardware, software access, and security provisioning',
    checkpoints: [
      { title: 'Laptop / workstation assigned',  desc: 'Hardware allocated, asset tag recorded, handover form signed',           badges: ['REQUIRED', 'ALL'] },
      { title: 'Email & SSO accounts created',   desc: 'Corporate email, SSO/Okta account provisioned with default groups',      badges: ['REQUIRED', 'ALL'] },
      { title: 'Project / repo access granted',  desc: 'Source-control, ticketing, and project board access mapped to role',     badges: ['REQUIRED', 'ALL'] },
      { title: 'VPN & security tools installed', desc: 'VPN client, MDM, EDR, and password manager installed and tested',        badges: ['REQUIRED', 'ALL'] },
      { title: 'Access card / biometric enrolled', desc: 'Office access card issued, biometric/fingerprint enrolled at security desk', badges: ['OPTIONAL', 'ALL'] },
    ],
  },
  {
    num: 4,
    title: 'Orientation & Induction',
    subtitle: 'Company introduction, team meet, and first-week walkthrough',
    checkpoints: [
      { title: 'Company orientation session attended', desc: 'Vision, mission, values, and org structure walkthrough by HR',     badges: ['REQUIRED', 'ALL'] },
      { title: 'HR policies briefing completed',       desc: 'Leave, attendance, expense, and grievance redressal policies covered', badges: ['REQUIRED', 'ALL'] },
      { title: 'Team introduction & meet completed',   desc: 'Reporting manager and peer team formally introduced',               badges: ['REQUIRED', 'ALL'] },
      { title: 'Office tour & facilities briefing',    desc: 'Workstation, cafeteria, meeting rooms, and emergency exits walkthrough', badges: ['OPTIONAL', 'ALL'] },
    ],
  },
  {
    num: 5,
    title: 'Payroll & Benefits Enrollment',
    subtitle: 'Bank, tax, statutory, and benefit registrations',
    checkpoints: [
      { title: 'Bank account & salary mode captured', desc: 'Bank account, IFSC, and salary credit mode confirmed in payroll',   badges: ['REQUIRED', 'ALL'] },
      { title: 'Tax regime selection submitted',      desc: 'Old vs new tax regime selected; investment declarations captured',  badges: ['REQUIRED', 'ALL'] },
      { title: 'PF / ESI / gratuity enrolment done',  desc: 'Statutory enrolments raised; UAN / ESIC numbers recorded',          badges: ['REQUIRED', 'ALL'] },
      { title: 'Insurance & wellness benefits opted', desc: 'Health insurance dependents added; wellness programs enrolled',     badges: ['OPTIONAL', 'ALL'] },
    ],
  },
  {
    num: 6,
    title: 'Probation & First-Month Review',
    subtitle: 'Goal setting, check-ins, and probation roadmap',
    checkpoints: [
      { title: 'Probation period & terms acknowledged', desc: 'Probation duration, criteria, and confirmation policy shared',    badges: ['REQUIRED', 'ALL'] },
      { title: 'KRAs & first-quarter goals locked',     desc: 'Reporting manager records KRAs and Q1 deliverables in HRMS',      badges: ['REQUIRED', 'ALL'] },
      { title: '15-day buddy check-in completed',       desc: 'Buddy meets new joiner and logs feedback to HR',                  badges: ['EMP REQUIRED'] },
      { title: '30-day reporting-manager review',       desc: 'First formal 1:1 review captured; action plan shared with HR',    badges: ['REQUIRED', 'ALL'] },
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
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [checklistOpen, setChecklistOpen] = useState(false);

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

  // Pagination — match the master tables (7 per page).
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 7;

  // Reset filters and page when tabbing across; also reset page when filters
  // change so the user always lands on page 1 of the new filtered set.
  useEffect(() => { setStatusFilter('All'); setQ(''); setPage(1); }, [tab]);
  useEffect(() => { setPage(1); }, [q, deptFilter, statusFilter]);

  const counts = useMemo(() => {
    const all = [...PENDING, ...COMPLETED];
    return {
      total:     all.length,
      progress:  PENDING.filter(r => r.status === 'In Progress' || r.status === 'IT Setup' || r.status === 'Orientation' || r.status === 'Document Pending').length,
      completed: COMPLETED.length,
      notStart:  PENDING.filter(r => r.status === 'Not Started').length,
      missing:   PENDING.filter(r => r.profile < 60).length,
      pending:   PENDING.length,
    };
  }, []);

  const rows = tab === 'pending' ? PENDING : COMPLETED;

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
      <style>{`
        .onb-surface { background: #ffffff; }
        [data-bs-theme="dark"] .onb-surface { background: #1c2531; }

        /* KPI cards — hover lift + icon scale, matches admin dashboard feel */
        .onb-kpi-card { cursor: pointer; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
        .onb-kpi-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(18,38,63,0.12) !important; border-color: rgba(124,92,252,0.30) !important; }
        .onb-kpi-card .onb-kpi-icon { transition: transform .25s ease; }
        .onb-kpi-card:hover .onb-kpi-icon { transform: scale(1.08); }
        [data-bs-theme="dark"] .onb-kpi-card:hover { box-shadow: 0 12px 32px rgba(0,0,0,0.45) !important; }

        /* Hero card (purple-tinted, separate container — matches screenshot) */
        .onb-hero-card {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap;
          padding: 18px 22px;
          border-radius: 16px;
          background: linear-gradient(135deg, #f3edff 0%, #ede4ff 100%);
          border: 1px solid #e3d6ff;
          box-shadow: 0 2px 12px rgba(124,92,252,0.06);
        }
        [data-bs-theme="dark"] .onb-hero-card {
          background: linear-gradient(135deg, rgba(124,92,252,0.18) 0%, rgba(167,139,250,0.10) 100%);
          border-color: rgba(124,92,252,0.32);
        }
        .onb-checklist-cta {
          padding: 10px 18px;
          font-size: 13px; font-weight: 700;
          color: #fff !important;
          background: linear-gradient(135deg,#7c5cfc 0%,#5a3fd1 100%) !important;
          border: none !important;
          box-shadow: 0 8px 18px rgba(91,63,209,0.30) !important;
          display: inline-flex; align-items: center;
        }
        .onb-checklist-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 22px rgba(91,63,209,0.38) !important; }

        /* Hero pill (Active) */
        .onb-hero-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(124,92,252,0.18); color: #5a3fd1; }
        .onb-hero-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.20); }

        /* Status & badge pills — match HrEmployees */
        .onb-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
        .onb-pill .d { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .onb-id-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-family: var(--vz-font-monospace, monospace); font-weight: 700; font-size: 12px; letter-spacing: 0.02em; }
        .onb-role-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: #eef2f6; color: #374151; font-size: 11px; font-weight: 600; }
        [data-bs-theme="dark"] .onb-role-pill { background: var(--vz-secondary-bg); color: var(--vz-body-color); }

        /* Action buttons in row */
        .onb-edit-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--vz-border-color); background: #fff; color: #6b7280; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s ease; }
        .onb-edit-btn:hover { border-color: #a78bfa; color: #7c5cfc; background: #faf6ff; }
        [data-bs-theme="dark"] .onb-edit-btn { background: var(--vz-secondary-bg); }
        .onb-init-btn { padding: 7px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #fff; border: none; background: linear-gradient(135deg,#7c5cfc,#5a3fd1); box-shadow: 0 3px 8px rgba(91,63,209,0.24); cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .onb-init-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(91,63,209,0.32); }
        .onb-vault-btn { padding: 6px 13px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #0a716a; border: 1px solid #b6e4dd; background: #e6f7f4; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .onb-vault-btn:hover { background: #d3f0ee; border-color: #8ad3c7; }
        [data-bs-theme="dark"] .onb-vault-btn { background: rgba(10,113,106,0.18); border-color: rgba(10,179,156,0.40); color: #4dd4be; }


        /* ── Checklist modal ─────────────────────────────────────────────── */
        .onb-checklist-modal .modal-dialog { max-width: min(1080px, 96vw); }
        .onb-checklist-content { border-radius: 18px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.22); }
        .onb-checklist-header { background: linear-gradient(135deg,#3b0764,#4c1d95 35%,#6d28d9 70%,#7c3aed); color: #fff; padding: 14px 20px 12px; position: relative; }
        .onb-checklist-header .close-btn { position: absolute; top: 14px; right: 14px; width: 26px; height: 26px; border-radius: 7px; background: rgba(255,255,255,0.18); border: none; color: #fff; transition: background .15s ease; display: inline-flex; align-items: center; justify-content: center; }
        .onb-checklist-header .close-btn:hover { background: rgba(255,255,255,0.30); }

        .onb-cl-titlewrap { display: flex; align-items: center; gap: 11px; padding-right: 38px; }
        .onb-cl-icon { width: 36px; height: 36px; border-radius: 9px; background: rgba(255,255,255,0.18); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; backdrop-filter: blur(6px); }
        .onb-cl-title { font-size: 14.5px; font-weight: 700; margin: 0; letter-spacing: -0.01em; color: #fff; }
        .onb-cl-sub { font-size: 11px; color: rgba(255,255,255,0.78); margin-top: 2px; }

        .onb-cl-filters { padding: 10px 20px 0; }
        .onb-cl-filter-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.72); margin: 0 0 6px; }
        .onb-cl-pillrow { display: flex; flex-wrap: wrap; gap: 6px; }
        .onb-cl-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 600; cursor: pointer; transition: all .15s ease; background: transparent; color: rgba(255,255,255,0.92); border: 1px solid rgba(255,255,255,0.30); }
        .onb-cl-pill i { font-size: 11.5px; opacity: 0.95; }
        .onb-cl-pill:hover { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.50); }
        .onb-cl-pill.is-active { background: #ffffff; color: #4c1d95; border-color: #ffffff; box-shadow: 0 3px 8px rgba(0,0,0,0.12); font-weight: 700; }
        .onb-cl-pill.is-active i { color: #6d28d9; opacity: 1; }

        /* Employee Type row uses a translucent segmented control */
        .onb-cl-row { display: flex; align-items: center; gap: 10px; padding: 8px 20px 12px; flex-wrap: wrap; }
        .onb-cl-row .onb-cl-filter-label { margin: 0; }
        .onb-cl-typebox { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.20); }
        .onb-cl-type { display: inline-flex; align-items: center; gap: 5px; padding: 5px 13px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all .15s ease; background: transparent; color: rgba(255,255,255,0.90); border: none; }
        .onb-cl-type i { font-size: 12px; }
        .onb-cl-type:hover { background: rgba(255,255,255,0.10); }
        .onb-cl-type.is-active { background: #ffffff; color: #1f2937; box-shadow: 0 2px 6px rgba(0,0,0,0.14); font-weight: 700; }
        .onb-cl-type.is-active i { color: #6d28d9; }

        .onb-cl-summary { margin-left: auto; padding: 4px 11px; border-radius: 999px; font-size: 10px; font-weight: 700; background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.20); }

        .onb-cl-body { background: #f7f5fc; padding: 14px 18px 10px; max-height: 50vh; overflow-y: auto; }
        [data-bs-theme="dark"] .onb-cl-body { background: #1f2630; }

        .onb-stage { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-stage { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-stage-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: linear-gradient(90deg, rgba(124,92,252,0.05), rgba(124,92,252,0)); border-bottom: 1px solid #ece9f6; }
        [data-bs-theme="dark"] .onb-stage-head { border-color: var(--vz-border-color); }
        .onb-stage-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg,#7c5cfc,#5a3fd1); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; flex-shrink: 0; }
        .onb-stage-title { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-stage-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-stage-sub { font-size: 11px; color: #6b7280; margin: 1px 0 0; }
        [data-bs-theme="dark"] .onb-stage-sub { color: var(--vz-secondary-color); }
        .onb-stage-count { margin-left: auto; padding: 3px 9px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-size: 10px; font-weight: 700; }

        .onb-cp { display: flex; align-items: flex-start; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-cp { border-color: var(--vz-border-color); }
        .onb-cp:last-child { border-bottom: none; }
        .onb-cp-check { width: 18px; height: 18px; border-radius: 5px; background: #f3f0ff; color: #7c5cfc; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
        .onb-cp-title { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
        .onb-cp-title .t { font-size: 12px; font-weight: 700; color: #1f2937; }
        [data-bs-theme="dark"] .onb-cp-title .t { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-cp-desc { font-size: 10.5px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
        [data-bs-theme="dark"] .onb-cp-desc { color: var(--vz-secondary-color); }
        .onb-cp-badge { font-size: 8.5px; font-weight: 800; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 4px; }

        .onb-cl-footer { background: #fff; border-top: 1px solid #eef0f4; padding: 10px 22px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .onb-cl-footer { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-cl-footer .hint { font-size: 11px; color: #6b7280; }
        [data-bs-theme="dark"] .onb-cl-footer .hint { color: var(--vz-secondary-color); }
        .onb-cl-close { padding: 7px 18px; border-radius: 9px; font-size: 12px; font-weight: 700; color: #fff; border: none; background: linear-gradient(90deg,#7c3aed,#4c1d95); box-shadow: 0 6px 14px rgba(76,29,149,0.28); cursor: pointer; }
        .onb-cl-close:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(76,29,149,0.36); }
      `}</style>
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
                        <th scope="col" className="ps-3">Employee</th>
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
                          <td colSpan={10} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No onboarding records match your filters
                          </td>
                        </tr>
                      ) : visible.map(r => {
                        const tone = STATUS_TONES[r.status];
                        return (
                          <tr key={r.id}>
                            <td className="ps-3">
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
                                  <button type="button" className="onb-edit-btn" title="Edit">
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
      />
    </>
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
      scrollable
      backdrop="static"
      keyboard={false}
    >
      <style>{`
        .vault-modal-wide .modal-dialog { max-width: min(1080px, 94vw); }
        .vault-modal-content { border-radius: 22px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.18); }
        .vault-pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: rgba(255,255,255,0.18); color: #fff; }
        .vault-kpi-card { background: #ffffff; border-radius: 16px; padding: 20px 20px 16px; box-shadow: 0 2px 20px rgba(0,0,0,0.06); border: 1px solid var(--vz-border-color); position: relative; overflow: hidden; height: 100%; cursor: pointer; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
        .vault-kpi-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(18,38,63,0.12); border-color: rgba(99,102,241,0.30); }
        .vault-kpi-card:hover .vault-kpi-icon { transform: scale(1.08); }
        .vault-kpi-card .vault-kpi-icon { transition: transform .25s ease; }
        [data-bs-theme="dark"] .vault-kpi-card { background: #1c2531; }
        [data-bs-theme="dark"] .vault-kpi-card:hover { box-shadow: 0 12px 32px rgba(0,0,0,0.45); }
        .vault-kpi-card .vault-kpi-strip { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
        .vault-kpi-card .vault-kpi-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .vault-kpi-card .vault-kpi-icon i { color: #fff; font-size: 20px; }
        .vault-kpi-card .vault-kpi-label { font-size: 11px; font-weight: 700; color: var(--vz-secondary-color); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 10px; }
        .vault-kpi-card .vault-kpi-num { font-size: 28px; font-weight: 800; line-height: 1; margin: 0; color: var(--vz-heading-color, var(--vz-body-color)); }
        .vault-tab-btn { background: transparent; border: none; padding: 12px 18px; font-size: 13.5px; font-weight: 600; color: var(--vz-secondary-color); display: inline-flex; align-items: center; gap: 6px; border-bottom: 2px solid transparent; transition: color .15s ease, border-color .15s ease; }
        .vault-tab-btn:hover { color: #5a3fd1; }
        .vault-tab-btn.is-active { color: #5a3fd1; border-bottom-color: #7c5cfc; }
        .vault-tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--vz-light); color: var(--vz-secondary-color); font-size: 10.5px; font-weight: 700; }
        .vault-tab-btn.is-active .vault-tab-count { background: #ece6ff; color: #5a3fd1; }
        .vault-doc-row { display: flex; align-items: center; gap: 14px; padding: 14px 4px; border-bottom: 1px solid var(--vz-border-color); }
        .vault-doc-row:last-child { border-bottom: none; }
        .vault-doc-icon { width: 40px; height: 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
        .vault-doc-meta { min-width: 0; flex: 1; }
        .vault-doc-name { font-size: 14px; font-weight: 700; color: var(--vz-heading-color, var(--vz-body-color)); }
        .vault-doc-desc { font-size: 12px; color: var(--vz-secondary-color); margin-top: 2px; }
        .vault-status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .vault-status-dot { width: 6px; height: 6px; border-radius: 50%; }
        .vault-action-view { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: #fff; color: #374151; border: 1px solid #e5e7eb; transition: border-color .15s ease, color .15s ease; }
        .vault-action-view:hover { color: #5a3fd1; border-color: #c4b5fd; }
        .vault-action-download { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border: none; box-shadow: 0 4px 10px rgba(124,92,252,0.25); }
        .vault-action-download:hover { box-shadow: 0 6px 14px rgba(124,92,252,0.35); }
      `}</style>

      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header — indigo gradient with status ring */}
        <div
          style={{
            padding: '22px 26px',
            background: 'linear-gradient(120deg,#5e4dd6 0%,#7c5cfc 60%,#9b7dff 100%)',
            color: '#fff',
            position: 'relative',
            overflow: 'hidden',
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

        {/* KPI strip */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--vz-border-color)' }}>
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

        {/* Tabs */}
        <div className="d-flex" style={{ padding: '0 24px', borderBottom: '1px solid var(--vz-border-color)' }}>
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
        <div style={{ padding: '8px 24px 22px' }}>
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

  // Compute filtered checklist by level + employee type. The filter is purely
  // visual — every checkpoint always renders, but matching badges decide which
  // ones get highlighted vs. greyed. Counts in the header reflect the visible set.
  const visibleStages = useMemo(() => {
    return CHECKLIST_STAGES.map(s => {
      const checkpoints = s.checkpoints.filter(cp => {
        // If the checkpoint is tagged ALL, include for all designation levels.
        const isAll = cp.badges.includes('ALL');
        if (level === 'all' || isAll) return true;
        const map: Record<string, CheckpointBadgeKind[]> = {
          hod:    ['HOD REQUIRED', 'HOD OPTIONAL'],
          tl:     ['TL REQUIRED', 'TL OPTIONAL'],
          exec:   ['EXEC REQUIRED', 'EXEC OPTIONAL'],
          emp:    ['EMP REQUIRED', 'EMP OPTIONAL'],
          intern: ['INTERN REQUIRED', 'INTERN OPTIONAL'],
        };
        const want = map[level] || [];
        return cp.badges.some(b => want.includes(b));
      });
      return { ...s, checkpoints };
    }).filter(s => s.checkpoints.length > 0);
  }, [level]);

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
              <i className="ri-checkbox-multiple-line" style={{ fontSize: 16 }} />
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

const STAGE2_PREV_COMPANIES = [
  { id: 'c1', name: 'Infosys (2017–2020)' },
  { id: 'c2', name: 'Wipro Digital (2020–2023)' },
  { id: 'c3', name: 'TCS iON (2023–2025)' },
];

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
  isOpen, onClose, emp,
}: {
  isOpen: boolean;
  onClose: () => void;
  emp: OnboardRow | null;
}) {
  const [activeStage, setActiveStage] = useState(1);
  // Reset to stage 1 each time a new employee opens
  useEffect(() => { if (isOpen) setActiveStage(1); }, [isOpen, emp?.id]);

  if (!emp) return null;

  // Pre-fill values from the row
  const firstName = emp.name.split(' ')[0] ?? '';
  const lastName  = emp.name.split(' ').slice(1).join(' ') ?? '';

  // Derive a per-stage status that respects the user's progression.
  // Stages before the active one are "Completed", the active one is "In
  // Progress", and the ones after are "Pending".
  const stagesView = ONB_STAGES.map(s => {
    let status: StageStatus, progress: number;
    if (s.num < activeStage)      { status = 'Completed';   progress = 100; }
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
      <style>{`
        .onb-init-modal .modal-dialog { max-width: min(1280px, 96vw); }
        .onb-init-content { border-radius: 18px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.22); }

        /* Header */
        .onb-init-header { background: linear-gradient(135deg,#3b0764,#4c1d95 35%,#6d28d9 70%,#7c3aed); color: #fff; padding: 14px 22px 0; position: relative; }
        .onb-init-header .close-btn { position: absolute; top: 14px; right: 14px; width: 26px; height: 26px; border-radius: 7px; background: rgba(255,255,255,0.18); border: none; color: #fff; display: inline-flex; align-items: center; justify-content: center; }
        .onb-init-header .close-btn:hover { background: rgba(255,255,255,0.30); }
        .onb-init-emp-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-right: 38px; }
        .onb-init-avatar { width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 14px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.20); }
        .onb-init-name { font-size: 17px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }
        .onb-init-sub { font-size: 11px; color: rgba(255,255,255,0.78); margin-top: 2px; }
        .onb-init-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: rgba(255,255,255,0.18); color: #fff; margin-left: 8px; }
        .onb-init-status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #ffffff; color: #4c1d95; }
        .onb-init-prod { font-size: 9.5px; letter-spacing: 0.10em; text-transform: uppercase; color: rgba(255,255,255,0.72); margin: 0; text-align: right; }
        .onb-init-prod-name { font-size: 12.5px; font-weight: 700; color: #fff; }

        /* Stepper */
        .onb-init-stepper { display: flex; align-items: center; gap: 4px; padding: 10px 0 12px; flex-wrap: wrap; }
        .onb-init-step { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.78); border: 1px solid rgba(255,255,255,0.20); cursor: pointer; transition: all .15s ease; }
        .onb-init-step:hover { background: rgba(255,255,255,0.18); color: #fff; }
        .onb-init-step.is-active { background: #ffffff; color: #4c1d95; border-color: #ffffff; font-weight: 700; }
        .onb-init-step .num { width: 18px; height: 18px; border-radius: 50%; background: rgba(255,255,255,0.20); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
        .onb-init-step.is-active .num { background: #4c1d95; color: #fff; }
        .onb-init-step-sep { color: rgba(255,255,255,0.40); font-size: 11px; }

        /* Body layout */
        .onb-init-body { display: flex; gap: 0; background: #f7f5fc; max-height: 64vh; overflow: hidden; }
        [data-bs-theme="dark"] .onb-init-body { background: #1f2630; }

        /* Sidebar */
        .onb-init-side { width: 270px; flex-shrink: 0; padding: 14px 14px 14px 18px; overflow-y: auto; border-right: 1px solid #ece9f6; }
        [data-bs-theme="dark"] .onb-init-side { border-color: var(--vz-border-color); }
        .onb-init-side-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
        .onb-init-side-title { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0; }
        .onb-init-side-pct { font-size: 11px; font-weight: 800; color: #4c1d95; }
        .onb-init-side-bar { height: 4px; background: #ece9f6; border-radius: 999px; overflow: hidden; margin-bottom: 12px; }
        .onb-init-side-fill { height: 100%; background: linear-gradient(90deg,#7c3aed,#4c1d95); border-radius: 999px; }
        .onb-init-stage-card { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; margin-bottom: 6px; background: transparent; transition: all .15s ease; }
        .onb-init-stage-card:hover { background: #fff; border-color: #ece9f6; }
        .onb-init-stage-card.is-active { background: #ffffff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,92,252,0.15); }
        .onb-init-stage-num { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: #ece9f6; color: var(--vz-secondary-color); }
        .onb-init-stage-card.is-active .onb-init-stage-num { background: linear-gradient(135deg,#7c3aed,#4c1d95); color: #fff; }
        .onb-init-stage-name { font-size: 12px; font-weight: 700; color: #1f2937; margin: 0; line-height: 1.3; }
        [data-bs-theme="dark"] .onb-init-stage-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-init-stage-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font-size: 10px; }
        .onb-init-stage-status { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; }
        .onb-init-stage-status.in-progress { color: #7c3aed; }
        .onb-init-stage-status.pending { color: var(--vz-secondary-color); }
        .onb-init-stage-status.completed { color: #108548; }
        .onb-init-stage-status .dot { width: 5px; height: 5px; border-radius: 50%; }
        .onb-init-stage-status.in-progress .dot { background: #7c3aed; }
        .onb-init-stage-status.pending .dot { background: #cbd2dc; }
        .onb-init-stage-status.completed .dot { background: #10b981; }
        .onb-init-stage-num.is-done { background: linear-gradient(135deg,#0ab39c,#108548); color: #fff; }
        .onb-init-stage-pct { font-weight: 700; color: var(--vz-secondary-color); }
        .onb-init-stage-card.is-active .onb-init-stage-pct { color: #7c3aed; }

        /* Main content */
        .onb-init-main { flex: 1; min-width: 0; padding: 16px 22px; overflow-y: auto; }
        .onb-init-stage-banner { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        [data-bs-theme="dark"] .onb-init-stage-banner { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-init-banner-icon { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg,#7c3aed,#4c1d95); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-init-banner-meta { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0; }
        .onb-init-banner-title { font-size: 14.5px; font-weight: 800; color: #1f2937; margin: 1px 0 0; letter-spacing: -0.01em; }
        [data-bs-theme="dark"] .onb-init-banner-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-init-banner-sub { font-size: 11px; color: var(--vz-secondary-color); margin-top: 1px; }
        .onb-init-banner-state { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #7c3aed; }
        .onb-init-banner-state .dot { width: 6px; height: 6px; border-radius: 50%; background: #7c3aed; }

        /* Profile completion banner */
        .onb-init-profile-bar { background: #f3edff; border: 1px solid #e3d6ff; border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; }
        [data-bs-theme="dark"] .onb-init-profile-bar { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.28); }
        .onb-init-profile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        .onb-init-profile-label { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #4c1d95; margin: 0; }
        .onb-init-profile-pct { font-size: 18px; font-weight: 800; color: #f06548; }
        .onb-init-profile-track { height: 6px; background: #ffffff; border-radius: 999px; overflow: hidden; }
        .onb-init-profile-fill { height: 100%; background: linear-gradient(90deg,#f06548,#f7b84b); border-radius: 999px; }
        .onb-init-profile-help { font-size: 10.5px; color: #5b3fd1; margin-top: 6px; }

        /* Sub-step section */
        .onb-init-section { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 14px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-init-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-init-section-head { display: flex; align-items: center; gap: 11px; padding: 12px 16px; border-bottom: 1px solid #ece9f6; }
        [data-bs-theme="dark"] .onb-init-section-head { border-color: var(--vz-border-color); }
        .onb-init-section-num { width: 26px; height: 26px; border-radius: 7px; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; }
        .onb-init-section-num.basic { background: linear-gradient(135deg,#7c3aed,#5b21b6); }
        .onb-init-section-num.job { background: linear-gradient(135deg,#3b82f6,#1d4ed8); }
        .onb-init-section-num.work { background: linear-gradient(135deg,#0ab39c,#0a8a72); }
        .onb-init-section-num.comp { background: linear-gradient(135deg,#f59e0b,#b45309); }
        .onb-init-section-title { font-size: 13.5px; font-weight: 800; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-init-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-init-section-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 1px 0 0; }
        .onb-init-section-step { margin-left: auto; padding: 3px 9px; border-radius: 999px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; }
        .onb-init-section-step.basic { background: #ece6ff; color: #5a3fd1; }
        .onb-init-section-step.job { background: #dceefe; color: #0c63b0; }
        .onb-init-section-step.work { background: #d3f0ee; color: #0a716a; }
        .onb-init-section-step.comp { background: #fde8c4; color: #a4661c; }
        .onb-init-section-body { padding: 14px 16px; }

        .onb-init-subgroup { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 10px; }
        .onb-init-subgroup + .onb-init-subgroup { margin-top: 16px; }

        .onb-init-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #374151; margin: 0 0 5px; display: flex; align-items: center; gap: 5px; }
        [data-bs-theme="dark"] .onb-init-label { color: var(--vz-body-color); }
        .onb-init-label .req { color: #f06548; font-weight: 700; }
        .onb-init-label .auto { font-size: 8.5px; padding: 1px 6px; border-radius: 4px; background: #d6f4e3; color: #108548; letter-spacing: 0.04em; }
        .onb-init-input, .onb-init-select { width: 100%; height: 36px; padding: 6px 10px; font-size: 12px; color: #1f2937; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; transition: all .15s ease; }
        .onb-init-input::placeholder { color: #9ca3af; }
        .onb-init-input:focus, .onb-init-select:focus { outline: none; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
        .onb-init-input.is-required { border-color: #f4a8a0; background: #fff6f5; }
        .onb-init-input.is-autofilled { border-color: #b6e4be; background: #f5fcf6; }
        [data-bs-theme="dark"] .onb-init-input, [data-bs-theme="dark"] .onb-init-select { background: var(--vz-card-bg); border-color: var(--vz-border-color); color: var(--vz-body-color); }

        .onb-init-toggle-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; background: #ecfdf3; border: 1px solid #bbf7d0; margin: 10px 0; }
        [data-bs-theme="dark"] .onb-init-toggle-row { background: rgba(16,133,72,0.16); border-color: rgba(16,133,72,0.40); }
        .onb-init-toggle { width: 36px; height: 20px; border-radius: 999px; background: #10b981; position: relative; cursor: pointer; flex-shrink: 0; }
        .onb-init-toggle::after { content: ''; position: absolute; top: 2px; left: 18px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.20); }
        .onb-init-toggle.off { background: #d1d5db; }
        .onb-init-toggle.off::after { left: 2px; }
        .onb-init-toggle-label { font-size: 12.5px; font-weight: 700; color: #108548; }
        [data-bs-theme="dark"] .onb-init-toggle-label { color: #4ade80; }

        .onb-init-info-banner { background: #d3f0ee; border: 1px solid #a8e0d6; border-radius: 9px; padding: 9px 14px; font-size: 11px; color: #0a716a; margin: 10px 0; display: flex; align-items: center; gap: 8px; }
        [data-bs-theme="dark"] .onb-init-info-banner { background: rgba(10,113,106,0.16); border-color: rgba(10,179,156,0.36); color: #4dd4be; }

        .onb-init-check-row { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0 10px; }
        .onb-init-check { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #1f2937; cursor: pointer; }
        [data-bs-theme="dark"] .onb-init-check { color: var(--vz-body-color); }
        .onb-init-check input { width: 14px; height: 14px; }

        .onb-init-add-btn { padding: 6px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: #a4661c; background: #fffbe7; border: 1px dashed #f7c069; margin-right: 6px; cursor: pointer; transition: all .15s ease; }
        .onb-init-add-btn:hover { background: #fff5d1; border-color: #f0a13c; }

        .onb-init-breakup { background: #fff; border: 1px solid #ece9f6; border-radius: 10px; margin-top: 10px; }
        .onb-init-breakup-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #ece9f6; font-size: 12.5px; font-weight: 800; color: #1f2937; }
        [data-bs-theme="dark"] .onb-init-breakup-head { color: var(--vz-heading-color, var(--vz-body-color)); border-color: var(--vz-border-color); }
        .onb-init-breakup-toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--vz-secondary-color); }
        .onb-init-breakup-body { padding: 12px 14px; }
        .onb-init-breakup-sub { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 8px; }
        .onb-init-breakup-grid { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; }
        .onb-init-breakup-cell { background: #f7f5fc; border-radius: 9px; padding: 12px 14px; text-align: center; }
        [data-bs-theme="dark"] .onb-init-breakup-cell { background: rgba(124,92,252,0.10); }
        .onb-init-breakup-cell.total { background: #ece6ff; }
        [data-bs-theme="dark"] .onb-init-breakup-cell.total { background: rgba(124,92,252,0.22); }
        .onb-init-breakup-cell .l { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); }
        .onb-init-breakup-cell .v { font-size: 16px; font-weight: 800; color: #1f2937; margin-top: 4px; }
        [data-bs-theme="dark"] .onb-init-breakup-cell .v { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-init-breakup-cell.total .v { color: #4c1d95; }
        .onb-init-breakup-op { font-size: 16px; font-weight: 800; color: var(--vz-secondary-color); }

        /* ── Stage 6 — Final Verification & Activation ── */
        .onb-ver-progress { background: #ecfdf3; border: 1px solid #bbf7d0; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 12px; }
        [data-bs-theme="dark"] .onb-ver-progress { background: rgba(16,133,72,0.16); border-color: rgba(16,133,72,0.40); }
        .onb-ver-progress-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg,#0ab39c,#108548); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-ver-progress-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .onb-ver-progress-title { font-size: 13px; font-weight: 700; color: #108548; margin: 0; }
        [data-bs-theme="dark"] .onb-ver-progress-title { color: #4ade80; }
        .onb-ver-progress-count { font-size: 12.5px; font-weight: 800; color: #108548; }
        .onb-ver-progress-bar { height: 4px; background: #ffffff; border-radius: 999px; overflow: hidden; margin: 6px 0; }
        .onb-ver-progress-fill { height: 100%; background: linear-gradient(90deg,#0ab39c,#108548); border-radius: 999px; }
        .onb-ver-progress-help { font-size: 10.5px; color: #108548; margin: 0; }
        [data-bs-theme="dark"] .onb-ver-progress-help { color: #4ade80; }

        .onb-ver-info-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        @media (max-width: 720px) { .onb-ver-info-row { grid-template-columns: 1fr; } }
        .onb-ver-info-card { background: #fff; border: 1px solid #ece9f6; border-radius: 11px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; }
        [data-bs-theme="dark"] .onb-ver-info-card { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-ver-info-avatar { width: 36px; height: 36px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 12px; flex-shrink: 0; }
        .onb-ver-info-name { font-size: 12.5px; font-weight: 800; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-ver-info-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-ver-info-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 1px 0 0; }
        .onb-ver-info-label { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 3px; }
        .onb-ver-info-track { flex-grow: 1; height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
        .onb-ver-info-fill { height: 100%; background: linear-gradient(90deg,#f59e0b,#fcd34d); border-radius: 999px; }
        .onb-ver-info-pct { font-size: 13px; font-weight: 800; color: #f59e0b; }

        .onb-ver-section { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-ver-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-ver-section-head { display: flex; align-items: center; gap: 11px; padding: 12px 16px; border-bottom: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-ver-section-head { border-color: var(--vz-border-color); }
        .onb-ver-section-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-ver-section-icon.summary { background: #d6f4e3; color: #108548; }
        .onb-ver-section-icon.action { background: #ece6ff; color: #5a3fd1; }
        .onb-ver-section-title { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; }
        [data-bs-theme="dark"] .onb-ver-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-ver-section-pill { padding: 3px 10px; border-radius: 999px; background: #d6f4e3; color: #108548; font-size: 10.5px; font-weight: 800; }

        .onb-ver-stage-row { display: flex; align-items: center; gap: 11px; padding: 11px 16px; border-bottom: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-ver-stage-row { border-color: var(--vz-border-color); }
        .onb-ver-stage-row:last-child { border-bottom: none; }
        .onb-ver-stage-icon { width: 34px; height: 34px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
        .onb-ver-stage-icon.s1 { background: #ece6ff; color: #5a3fd1; }
        .onb-ver-stage-icon.s2 { background: #dceefe; color: #0c63b0; }
        .onb-ver-stage-icon.s3 { background: #d3f0ee; color: #0a716a; }
        .onb-ver-stage-icon.s4 { background: #fef3c7; color: #b45309; }
        .onb-ver-stage-icon.s5 { background: #ece6ff; color: #5a3fd1; }
        .onb-ver-stage-icon.s6 { background: #fdd9ea; color: #a02960; }
        .onb-ver-stage-name { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-ver-stage-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-ver-stage-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 1px 0 0; }
        .onb-ver-status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; flex-shrink: 0; }
        .onb-ver-status-pill .dot { width: 6px; height: 6px; border-radius: 50%; }
        .onb-ver-status-pill.verified { background: #d6f4e3; color: #108548; }
        .onb-ver-status-pill.verified .dot { background: #10b981; }
        .onb-ver-status-pill.pending { background: #fde8c4; color: #a4661c; }
        .onb-ver-status-pill.pending .dot { background: #f59e0b; }

        .onb-ver-action-banner { background: #f3edff; border: 1px solid #e3d6ff; border-radius: 9px; padding: 10px 14px; font-size: 11.5px; color: #4c1d95; display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
        [data-bs-theme="dark"] .onb-ver-action-banner { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.32); color: #c4b5fd; }
        .onb-ver-action-banner b, .onb-ver-action-banner strong { font-weight: 800; }

        .onb-ver-action-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
        @media (max-width: 720px) { .onb-ver-action-buttons { grid-template-columns: 1fr; } }
        .onb-ver-flag-btn { padding: 14px 20px; border-radius: 11px; font-size: 13px; font-weight: 700; color: #b1401d; background: #fff; border: 1px solid #f4a8a0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: all .15s ease; }
        .onb-ver-flag-btn:hover { background: #fff6f5; border-color: #f06548; }
        .onb-ver-activate-btn { padding: 14px 20px; border-radius: 11px; font-size: 13px; font-weight: 700; color: #fff; background: linear-gradient(135deg,#10b981,#059669); border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 8px 18px rgba(5,150,105,0.30); transition: all .15s ease; }
        .onb-ver-activate-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 22px rgba(5,150,105,0.38); }

        /* ── Stage 4 — Payroll ── */
        .onb-pay-progress { background: #fef3c7; border: 1px solid #fde68a; border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 12px; }
        [data-bs-theme="dark"] .onb-pay-progress { background: rgba(245,158,11,0.18); border-color: rgba(245,158,11,0.40); }
        .onb-pay-progress-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg,#f59e0b,#b45309); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-pay-progress-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .onb-pay-progress-title { font-size: 13px; font-weight: 700; color: #92400e; margin: 0; }
        [data-bs-theme="dark"] .onb-pay-progress-title { color: #fcd34d; }
        .onb-pay-progress-count { font-size: 12.5px; font-weight: 800; color: #92400e; }
        .onb-pay-progress-bar { height: 4px; background: #ffffff; border-radius: 999px; overflow: hidden; margin: 6px 0; }
        .onb-pay-progress-fill { height: 100%; background: linear-gradient(90deg,#f59e0b,#b45309); border-radius: 999px; }
        .onb-pay-progress-help { font-size: 10.5px; color: #92400e; margin: 0; }
        [data-bs-theme="dark"] .onb-pay-progress-help { color: #fcd34d; }

        .onb-pay-section { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-pay-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-pay-section-head { display: flex; align-items: center; gap: 11px; padding: 11px 16px; }
        .onb-pay-section-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
        .onb-pay-section-icon.mode { background: #ece6ff; color: #5a3fd1; }
        .onb-pay-section-icon.bank { background: #dceefe; color: #0c63b0; }
        .onb-pay-section-icon.tax  { background: #fef3c7; color: #b45309; }
        .onb-pay-section-icon.check { background: #d6f4e3; color: #108548; }
        .onb-pay-section-title { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-pay-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-pay-section-body { padding: 0 16px 14px; }
        .onb-pay-q { font-size: 12px; color: var(--vz-secondary-color); margin: 0 0 10px; }

        .onb-pay-radio { display: flex; align-items: flex-start; gap: 11px; padding: 11px 14px; border: 1px solid var(--vz-border-color); border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: all .15s ease; }
        .onb-pay-radio:hover { border-color: #c4b5fd; background: #faf6ff; }
        .onb-pay-radio.is-selected { border-color: #7c3aed; background: #f3edff; box-shadow: 0 4px 10px rgba(124,58,237,0.12); }
        [data-bs-theme="dark"] .onb-pay-radio.is-selected { background: rgba(124,58,237,0.18); }
        .onb-pay-radio-circle { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d1d5db; flex-shrink: 0; margin-top: 2px; position: relative; }
        .onb-pay-radio.is-selected .onb-pay-radio-circle { border-color: #7c3aed; }
        .onb-pay-radio.is-selected .onb-pay-radio-circle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 8px; height: 8px; border-radius: 50%; background: #7c3aed; }
        .onb-pay-radio-name { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-pay-radio-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-pay-radio-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 2px 0 0; }

        .onb-pay-check { display: flex; align-items: center; gap: 11px; padding: 10px 14px; border: 1px solid var(--vz-border-color); border-radius: 9px; margin-bottom: 6px; }
        [data-bs-theme="dark"] .onb-pay-check { border-color: var(--vz-border-color); }
        .onb-pay-check-icon { width: 26px; height: 26px; border-radius: 50%; border: 2px solid #f59e0b; background: #fffbe7; color: #f59e0b; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-pay-check-name { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; }
        [data-bs-theme="dark"] .onb-pay-check-name { color: var(--vz-heading-color, var(--vz-body-color)); }

        /* ── Stage 5 — Policies ── */
        .onb-pol-progress { background: #f3edff; border: 1px solid #e3d6ff; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 12px; }
        [data-bs-theme="dark"] .onb-pol-progress { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.28); }
        .onb-pol-progress-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg,#7c3aed,#4c1d95); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-pol-progress-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .onb-pol-progress-title { font-size: 13px; font-weight: 700; color: #4c1d95; margin: 0; }
        [data-bs-theme="dark"] .onb-pol-progress-title { color: #c4b5fd; }
        .onb-pol-progress-count { font-size: 12.5px; font-weight: 800; color: #4c1d95; }
        .onb-pol-progress-bar { height: 4px; background: #ffffff; border-radius: 999px; overflow: hidden; margin: 6px 0; }
        .onb-pol-progress-fill { height: 100%; background: linear-gradient(90deg,#7c3aed,#4c1d95); border-radius: 999px; }
        .onb-pol-progress-help { font-size: 10.5px; color: #5b3fd1; margin: 0; }

        .onb-pol-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 6px 0 14px; font-size: 11px; color: var(--vz-secondary-color); }
        .onb-pol-legend-item { display: inline-flex; align-items: center; gap: 5px; }
        .onb-pol-legend-item .dot { width: 7px; height: 7px; border-radius: 50%; }
        .onb-pol-legend-link { margin-left: auto; color: #7c3aed; font-weight: 600; }

        .onb-pol-section { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-pol-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-pol-section-head { display: flex; align-items: center; gap: 11px; padding: 11px 16px; border-bottom: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-pol-section-head { border-color: var(--vz-border-color); }
        .onb-pol-section-icon { width: 32px; height: 32px; border-radius: 8px; background: #ece6ff; color: #5a3fd1; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-pol-section-title { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; }
        [data-bs-theme="dark"] .onb-pol-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-pol-section-pill { padding: 3px 10px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-size: 10.5px; font-weight: 800; }

        .onb-pol-doc { padding: 12px 16px; border-bottom: 1px solid #f1eff7; background: #fff; }
        [data-bs-theme="dark"] .onb-pol-doc { border-color: var(--vz-border-color); }
        .onb-pol-doc:last-child { border-bottom: none; }
        .onb-pol-doc-row { display: flex; align-items: center; gap: 11px; }
        .onb-pol-doc-icon { width: 32px; height: 32px; border-radius: 8px; background: #f3edff; color: #7c3aed; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-pol-doc-meta { min-width: 0; flex-grow: 1; }
        .onb-pol-doc-name { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .onb-pol-doc-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-pol-doc-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 1px 0 0; }
        .onb-pol-doc-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: #eef2f6; color: #5b6478; }
        .onb-pol-doc-status .dot { width: 6px; height: 6px; border-radius: 50%; background: #878a99; }
        .onb-pol-gen-btn { padding: 6px 13px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: #fff; border: none; background: linear-gradient(135deg,#0ab39c,#0a8a72); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 3px 8px rgba(10,138,114,0.24); }
        .onb-pol-gen-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(10,138,114,0.32); }
        .onb-pol-doc-help { font-size: 10.5px; color: var(--vz-secondary-color); margin: 8px 0 0; padding-left: 43px; display: flex; align-items: center; gap: 5px; }

        /* ── Stage 3 — Provisioning ── */
        .onb-prov-progress { background: #dceefe; border: 1px solid #b6d6fb; border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 12px; }
        [data-bs-theme="dark"] .onb-prov-progress { background: rgba(12,99,176,0.18); border-color: rgba(12,99,176,0.40); }
        .onb-prov-progress-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg,#3b82f6,#1d4ed8); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-prov-progress-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .onb-prov-progress-title { font-size: 13px; font-weight: 700; color: #0c63b0; margin: 0; }
        [data-bs-theme="dark"] .onb-prov-progress-title { color: #93c5fd; }
        .onb-prov-progress-count { font-size: 12.5px; font-weight: 800; color: #0c63b0; }
        .onb-prov-progress-bar { height: 4px; background: #ffffff; border-radius: 999px; overflow: hidden; margin: 6px 0; }
        .onb-prov-progress-fill { height: 100%; background: linear-gradient(90deg,#3b82f6,#1d4ed8); border-radius: 999px; }
        .onb-prov-progress-help { font-size: 10.5px; color: #0c63b0; margin: 0; }
        [data-bs-theme="dark"] .onb-prov-progress-help { color: #93c5fd; }

        .onb-prov-section { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-prov-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-prov-section-head { display: flex; align-items: center; gap: 11px; padding: 11px 16px; }
        .onb-prov-section-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
        .onb-prov-section-icon.system { background: #ece6ff; color: #5a3fd1; }
        .onb-prov-section-icon.device { background: #dceefe; color: #0c63b0; }
        .onb-prov-section-icon.physical { background: #d3f0ee; color: #0a716a; }
        .onb-prov-section-title { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-prov-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-prov-section-body { padding: 0 16px 14px; }
        .onb-prov-subgroup { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: #5a3fd1; margin: 0 0 10px; display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 6px; background: #f3edff; }
        [data-bs-theme="dark"] .onb-prov-subgroup { background: rgba(124,92,252,0.18); color: #c4b5fd; }
        .onb-prov-input { width: 100%; height: 36px; padding: 6px 10px; font-size: 12px; color: #1f2937; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
        .onb-prov-input.is-required { border-color: #f4a8a0; background: #fff6f5; }
        .onb-prov-input.is-autofetched { border-color: #b6e4be; background: #f5fcf6; display: flex; align-items: center; gap: 6px; }
        .onb-prov-input.is-autofetched i { color: #108548; }
        [data-bs-theme="dark"] .onb-prov-input { background: var(--vz-card-bg); border-color: var(--vz-border-color); color: var(--vz-body-color); }

        /* ── Stage 2 — Documents ── */
        .onb-init-banner-state.pending { color: #a4661c; }
        .onb-init-banner-state.pending .dot { background: #f59e0b; }

        .onb-doc-progress { background: #f3edff; border: 1px solid #e3d6ff; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 12px; }
        [data-bs-theme="dark"] .onb-doc-progress { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.28); }
        .onb-doc-progress-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg,#7c3aed,#4c1d95); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-doc-progress-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .onb-doc-progress-title { font-size: 13px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-doc-progress-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-progress-count { font-size: 12.5px; font-weight: 800; color: #4c1d95; }
        .onb-doc-progress-bar { height: 4px; background: #ffffff; border-radius: 999px; overflow: hidden; margin: 6px 0; }
        .onb-doc-progress-fill { height: 100%; background: linear-gradient(90deg,#7c3aed,#4c1d95); border-radius: 999px; }
        .onb-doc-progress-help { font-size: 10.5px; color: #5b3fd1; margin: 0; }

        .onb-doc-legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0 14px; }
        .onb-doc-legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--vz-secondary-color); }
        .onb-doc-legend-item .dot { width: 7px; height: 7px; border-radius: 50%; }

        .onb-doc-cat { background: #fff; border: 1px solid #ece9f6; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-doc-cat { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-doc-cat-head { display: flex; align-items: center; gap: 11px; padding: 10px 14px; }
        .onb-doc-cat-icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
        .onb-doc-cat-title { font-size: 13px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; }
        [data-bs-theme="dark"] .onb-doc-cat-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-cat-count { font-size: 11px; color: var(--vz-secondary-color); }
        .onb-doc-cat-pct { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: #eef2f6; color: var(--vz-secondary-color); }

        .onb-doc-row { display: flex; align-items: center; gap: 11px; padding: 10px 14px; border-top: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-doc-row { border-color: var(--vz-border-color); }
        .onb-doc-row-icon { width: 32px; height: 32px; border-radius: 8px; background: #f3f0ff; color: #7c3aed; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-doc-row-meta { min-width: 0; flex-grow: 1; }
        .onb-doc-row-name { font-size: 12.5px; font-weight: 700; color: #1f2937; margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .onb-doc-row-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-row-sub { font-size: 11px; color: var(--vz-secondary-color); margin: 1px 0 0; }
        .onb-doc-status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; }
        .onb-doc-status-pill .dot { width: 6px; height: 6px; border-radius: 50%; }
        .onb-doc-tag { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 4px; font-size: 9px; font-weight: 800; letter-spacing: 0.06em; background: #ece6ff; color: #5a3fd1; text-transform: uppercase; }
        .onb-doc-upload-btn { padding: 6px 13px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: #fff; border: none; background: linear-gradient(135deg,#7c3aed,#5b21b6); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 3px 8px rgba(91,33,182,0.24); }
        .onb-doc-upload-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(91,33,182,0.32); }

        /* Previous Employment companies */
        .onb-doc-prev { background: #fff; border: 1px solid #fde8c4; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        .onb-doc-prev-head { display: flex; align-items: center; gap: 11px; padding: 12px 14px; background: linear-gradient(90deg,#fef3c7,#fffbe7); border-bottom: 1px solid #fde8c4; }
        [data-bs-theme="dark"] .onb-doc-prev { background: var(--vz-card-bg); border-color: rgba(245,158,11,0.40); }
        [data-bs-theme="dark"] .onb-doc-prev-head { background: rgba(245,158,11,0.16); border-color: rgba(245,158,11,0.40); }
        .onb-doc-prev-icon { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg,#f59e0b,#b45309); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-doc-prev-title { font-size: 13px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-doc-prev-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-prev-sub { font-size: 11px; color: #92400e; margin: 1px 0 0; }
        [data-bs-theme="dark"] .onb-doc-prev-sub { color: #fcd34d; }
        .onb-doc-prev-pill { margin-left: auto; padding: 3px 10px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 10.5px; font-weight: 700; border: 1px solid #fde8c4; }

        .onb-doc-comp { background: #fffbe7; border: 1px solid #fde8c4; border-radius: 10px; margin: 10px 14px; overflow: hidden; }
        .onb-doc-comp-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #fde8c4; }
        .onb-doc-comp-num { width: 26px; height: 26px; border-radius: 7px; background: linear-gradient(135deg,#f59e0b,#b45309); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; }
        .onb-doc-comp-name { font-size: 13px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; }
        [data-bs-theme="dark"] .onb-doc-comp-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-comp-count { font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: #fef3c7; color: #92400e; }
        .onb-doc-comp-close { width: 24px; height: 24px; border-radius: 7px; border: 1px solid #fde8c4; background: #fff; color: #b45309; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .onb-doc-comp-body { padding: 12px 14px; background: #fff; }
        [data-bs-theme="dark"] .onb-doc-comp { background: rgba(245,158,11,0.10); }
        [data-bs-theme="dark"] .onb-doc-comp-body { background: var(--vz-card-bg); }
        .onb-doc-comp-section { font-size: 9.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: #b45309; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 8px; }
        .onb-doc-comp-section + .onb-doc-comp-section { margin-top: 14px; }
        .onb-doc-comp-doc { display: flex; align-items: center; gap: 11px; padding: 8px 12px; border: 1px solid #fde8c4; border-radius: 9px; margin-bottom: 6px; background: #fffdf5; }
        [data-bs-theme="dark"] .onb-doc-comp-doc { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.30); }
        .onb-doc-comp-doc-icon { width: 26px; height: 26px; border-radius: 7px; background: #fef3c7; color: #b45309; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-doc-comp-doc-name { font-size: 12px; font-weight: 700; color: #1f2937; margin: 0; flex-grow: 1; display: flex; align-items: center; gap: 6px; }
        [data-bs-theme="dark"] .onb-doc-comp-doc-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-doc-bgv-banner { background: #dceefe; border: 1px solid #b6d6fb; border-radius: 9px; padding: 8px 12px; font-size: 11px; color: #0c63b0; display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
        [data-bs-theme="dark"] .onb-doc-bgv-banner { background: rgba(12,99,176,0.18); border-color: rgba(12,99,176,0.40); color: #93c5fd; }

        /* Footer */
        .onb-init-footer { background: #fff; border-top: 1px solid #ece9f6; padding: 12px 22px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .onb-init-footer { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-init-footer-meta { font-size: 11px; color: var(--vz-secondary-color); display: inline-flex; align-items: center; gap: 6px; }
        .onb-init-btn-ghost { padding: 7px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: transparent; color: var(--vz-secondary-color); border: 1px solid var(--vz-border-color); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
        .onb-init-btn-ghost:hover { color: #1f2937; border-color: #9ca3af; }
        .onb-init-btn-outline { padding: 7px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: #fff; color: #374151; border: 1px solid #d1d5db; cursor: pointer; }
        .onb-init-btn-outline:hover { border-color: #7c3aed; color: #4c1d95; }
        .onb-init-btn-next { padding: 7px 16px; border-radius: 9px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg,#7c3aed,#4c1d95); color: #fff; border: none; cursor: pointer; box-shadow: 0 6px 14px rgba(76,29,149,0.30); display: inline-flex; align-items: center; gap: 5px; }
        .onb-init-btn-next:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(76,29,149,0.38); }
      `}</style>

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
                    <label className="onb-init-label">Work Country <span className="auto">AUTO-FILLED</span></label>
                    <input className="onb-init-input is-autofilled" defaultValue="India" />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">First Name <span className="auto">AUTO-FILLED</span></label>
                    <input className="onb-init-input is-autofilled" defaultValue={firstName} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Middle Name</label>
                    <input className="onb-init-input" placeholder="Middle name (optional)" />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Last Name <span className="req">*</span></label>
                    <input className="onb-init-input" defaultValue={lastName} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Display Name <span className="auto">AUTO-FILLED</span></label>
                    <input className="onb-init-input is-autofilled" defaultValue={emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Actual Name <span className="auto">AUTO-FILLED</span></label>
                    <input className="onb-init-input is-autofilled" defaultValue={emp.name} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Gender</label>
                    <select className="onb-init-select"><option>Select gender</option><option>Male</option><option>Female</option><option>Other</option></select>
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Date of Birth <span className="req">*</span></label>
                    <input className="onb-init-input is-required" placeholder="mm/dd/yyyy" />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Nationality</label>
                    <select className="onb-init-select"><option>Indian</option><option>Other</option></select>
                  </Col>
                </Row>

                <p className="onb-init-subgroup">Contact &amp; Identity</p>
                <Row className="g-3">
                  <Col md={4}>
                    <label className="onb-init-label">Work Email <span className="req">*</span></label>
                    <input className="onb-init-input is-required" placeholder="name@enterprise.com" />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Mobile Number <span className="req">*</span></label>
                    <input className="onb-init-input is-required" placeholder="+91 XXXXX XXXXX" />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Number Series</label>
                    <select className="onb-init-select"><option>Default Number Series</option></select>
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee ID <span className="auto">AUTO-FILLED</span></label>
                    <input className="onb-init-input is-autofilled" defaultValue={`${emp.empId} (auto-assigned)`} />
                  </Col>
                  <Col md={4}>
                    <label className="onb-init-label">Employee Status</label>
                    <select className="onb-init-select"><option>Active</option><option>On Probation</option></select>
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
                  <Col md={4}><label className="onb-init-label">Joining Date <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.joinDate} /></Col>
                  <Col md={4}><label className="onb-init-label">Department <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.department} /></Col>
                  <Col md={4}><label className="onb-init-label">Designation <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.designation} /></Col>
                  <Col md={4}><label className="onb-init-label">Primary Role <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.primaryRole} /></Col>
                  <Col md={4}><label className="onb-init-label">Ancillary Role <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.ancillaryRole || ''} /></Col>
                  <Col md={4}><label className="onb-init-label">Work Type <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue="Full Time" /></Col>
                </Row>

                <p className="onb-init-subgroup">Organisational Details</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Legal Entity</label><select className="onb-init-select"><option>Select entity</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Location</label><select className="onb-init-select"><option>Pune HQ</option><option>Mumbai</option><option>Bengaluru</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Reporting Manager <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue={emp.managerName} /></Col>
                </Row>

                <p className="onb-init-subgroup">Employment Terms</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Probation Policy</label><select className="onb-init-select"><option>Default Probation Policy</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Notice Period</label><select className="onb-init-select"><option>Default Notice Period</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Work Mode <span className="auto">AUTO-FILLED</span></label><input className="onb-init-input is-autofilled" defaultValue="On-site" /></Col>
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
                  <Col md={4}><label className="onb-init-label">Leave Plan</label><select className="onb-init-select"><option>Leave Policy</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Holiday List</label><select className="onb-init-select"><option>Holiday Calendar</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Shift</label><select className="onb-init-select"><option>General Shift</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Weekly Off</label><select className="onb-init-select"><option>Week Off Policy</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Attendance Number</label><input className="onb-init-input" placeholder="Attendance number" /></Col>
                  <Col md={4}><label className="onb-init-label">Time Tracking Policy</label><select className="onb-init-select"><option>Attendance Capture</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Penalization Policy</label><select className="onb-init-select"><option>Tracking Policy</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Overtime</label><select className="onb-init-select"><option>Not applicable</option><option>Applicable</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Expense Policy</label><select className="onb-init-select"><option>Select policy</option></select></Col>
                </Row>

                <div className="onb-init-toggle-row">
                  <span className="onb-init-toggle" />
                  <span className="onb-init-toggle-label">Attendance Tracking Enabled</span>
                </div>

                <p className="onb-init-subgroup">Assets &amp; Security</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Laptop Assigned</label><select className="onb-init-select"><option>No</option><option>Yes</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Laptop Asset ID</label><input className="onb-init-input" placeholder="e.g. LAP-0042" /></Col>
                  <Col md={4}><label className="onb-init-label">Mobile Device</label><input className="onb-init-input" placeholder="e.g. iPhone 15" /></Col>
                  <Col md={4}><label className="onb-init-label">Other Assets</label><input className="onb-init-input" placeholder="Monitor, Keyboard..." /></Col>
                  <Col md={4}><label className="onb-init-label">Access Card</label><select className="onb-init-select"><option>Not Issued</option><option>Issued</option></select></Col>
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
                <div className="onb-init-toggle-row">
                  <span className="onb-init-toggle" />
                  <span className="onb-init-toggle-label">Enable payroll for this employee</span>
                </div>

                <p className="onb-init-subgroup">Payroll Configuration</p>
                <Row className="g-3">
                  <Col md={4}><label className="onb-init-label">Pay Group</label><select className="onb-init-select"><option>Default pay group</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Annual Salary <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="Enter amount" /></Col>
                  <Col md={4}><label className="onb-init-label">Period</label><select className="onb-init-select"><option>Per annum</option><option>Per month</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Salary Effective From <span className="req">*</span></label><input className="onb-init-input is-required" placeholder="mm/dd/yyyy" /></Col>
                  <Col md={4}><label className="onb-init-label">Salary Structure Type</label><select className="onb-init-select"><option>Range Based</option><option>Fixed</option></select></Col>
                  <Col md={4}><label className="onb-init-label">Tax Regime</label><select className="onb-init-select"><option>New Regime (115BAC)</option><option>Old Regime</option></select></Col>
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
                    <span className="onb-init-breakup-toggle">
                      Detailed breakup
                      <span className="onb-init-toggle off" />
                    </span>
                  </div>
                  <div className="onb-init-breakup-body">
                    <p className="onb-init-breakup-sub">Salary Effective From</p>
                    <div className="text-muted mb-2" style={{ fontSize: 12 }}>—</div>
                    <div className="onb-init-breakup-grid">
                      <div className="onb-init-breakup-cell"><div className="l">Regular Salary</div><div className="v">INR 0</div></div>
                      <span className="onb-init-breakup-op">+</span>
                      <div className="onb-init-breakup-cell"><div className="l">Bonus</div><div className="v">INR 0</div></div>
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
            <button type="button" className="onb-init-btn-outline">Save Draft</button>
            <button type="button" className="onb-init-btn-next" onClick={() => setActiveStage(Math.min(6, activeStage + 1))}>
              Next Stage <i className="ri-arrow-right-s-line" />
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Stage 2 — Document Management view (used inside InitiateOnboardingModal)
function Stage2Documents() {
  const totalDocs = STAGE2_CATEGORIES.reduce((a, c) => a + c.docs.length, 0)
                  + STAGE2_PREV_COMPANIES.length * STAGE2_COMPANY_DOCS.length;
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
          <span className="onb-doc-prev-pill">{STAGE2_PREV_COMPANIES.length} Companies</span>
        </div>

        {STAGE2_PREV_COMPANIES.map((c, idx) => (
          <div key={c.id} className="onb-doc-comp">
            <div className="onb-doc-comp-head">
              <span className="onb-doc-comp-num">{idx + 1}</span>
              <h6 className="onb-doc-comp-name">{c.name}</h6>
              <span className="onb-doc-comp-count">0/4 Docs</span>
              <button type="button" className="onb-doc-comp-close" aria-label="Remove company">
                <i className="ri-close-line" style={{ fontSize: 12 }} />
              </button>
            </div>
            <div className="onb-doc-comp-body">
              <p className="onb-doc-comp-section"><i className="ri-building-line" /> Company Information</p>
              <Row className="g-3">
                <Col md={6}>
                  <label className="onb-init-label">Company Name <span className="req">*</span></label>
                  <input className="onb-init-input" defaultValue={c.name} />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Job Title / Designation <span className="req">*</span></label>
                  <input className="onb-init-input" placeholder="e.g. Software Engineer" />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment Start Date <span className="req">*</span></label>
                  <input className="onb-init-input is-required" placeholder="MM/YYYY" />
                </Col>
                <Col md={6}>
                  <label className="onb-init-label">Employment End Date <span className="req">*</span></label>
                  <input className="onb-init-input is-required" placeholder="MM/YYYY" />
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
                  <input className="onb-init-input is-required" placeholder="hr@company.com" />
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">HR Email ID 2 <span className="req">*</span></label>
                  <input className="onb-init-input is-required" placeholder="hr2@company.com" />
                </Col>
                <Col md={4}>
                  <label className="onb-init-label">Company Contact Number <span className="req">*</span></label>
                  <input className="onb-init-input is-required" placeholder="+91 XXXXX XXXXX" />
                </Col>
              </Row>
            </div>
          </div>
        ))}
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
            <Col md={4}><label className="onb-init-label">Account Type</label><select className="onb-init-select"><option>Salary</option><option>Savings</option><option>Current</option></select></Col>
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
            <Col md={4}><label className="onb-init-label">Tax Regime</label><select className="onb-init-select"><option>New Regime (115BAC)</option><option>Old Regime</option></select></Col>
            <Col md={4}><label className="onb-init-label">PF Deduction</label><select className="onb-init-select"><option>Employee + Employer</option><option>Employee only</option></select></Col>
            <Col md={4}><label className="onb-init-label">ESI Applicable</label><select className="onb-init-select"><option>No</option><option>Yes</option></select></Col>
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
function Stage6Verify({ emp }: { emp: OnboardRow }) {
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
            <button type="button" className="onb-ver-flag-btn">
              <i className="ri-error-warning-line" style={{ fontSize: 16 }} /> Flag Issue
            </button>
            <button type="button" className="onb-ver-activate-btn">
              <i className="ri-checkbox-circle-line" style={{ fontSize: 16 }} /> Activate Employee
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
