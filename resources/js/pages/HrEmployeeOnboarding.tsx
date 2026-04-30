import { useEffect, useMemo, useState } from 'react';
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
  { id: 'all',    label: 'All Levels',         icon: 'ri-checkbox-circle-line' },
  { id: 'hod',    label: 'Head of Dept (HOD)', icon: 'ri-vip-crown-line' },
  { id: 'tl',     label: 'Team Leader',        icon: 'ri-user-star-line' },
  { id: 'exec',   label: 'Executive',          icon: 'ri-briefcase-line' },
  { id: 'emp',    label: 'Employee',           icon: 'ri-user-line' },
  { id: 'intern', label: 'Intern / Trainee',   icon: 'ri-graduation-cap-line' },
] as const;

const EMPLOYEE_TYPES = [
  { id: 'all',    label: 'All' },
  { id: 'it',     label: 'IT Employee' },
  { id: 'non_it', label: 'Non-IT Employee' },
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

  // Reset filters when tabbing across
  useEffect(() => { setStatusFilter('All'); setQ(''); }, [tab]);

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

  return (
    <>
      <style>{`
        .onb-surface { background: #ffffff; }
        [data-bs-theme="dark"] .onb-surface { background: #1c2531; }

        /* Hero pill (Active) */
        .onb-hero-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(124,92,252,0.12); color: #5a3fd1; }
        .onb-hero-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.18); }

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
        .onb-checklist-content { border-radius: 22px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.22); }
        .onb-checklist-header { background: linear-gradient(135deg,#5b3fd1 0%, #7c5cfc 50%, #a78bfa 100%); color: #fff; padding: 22px 28px 14px; position: relative; }
        .onb-checklist-header .close-btn { position: absolute; top: 16px; right: 16px; width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,0.18); border: none; color: #fff; transition: background .15s ease; display: inline-flex; align-items: center; justify-content: center; }
        .onb-checklist-header .close-btn:hover { background: rgba(255,255,255,0.30); }
        .onb-cl-title { font-size: 17px; font-weight: 800; margin: 0; letter-spacing: -0.01em; display: flex; align-items: center; gap: 12px; }
        .onb-cl-icon { width: 38px; height: 38px; border-radius: 11px; background: rgba(255,255,255,0.18); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .onb-cl-sub { font-size: 12px; color: rgba(255,255,255,0.82); margin-top: 4px; padding-left: 50px; }

        .onb-cl-filters { padding: 14px 28px 0; }
        .onb-cl-filter-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: #ffffff; opacity: 0.92; margin: 0 0 8px; }
        .onb-cl-pillrow { display: flex; flex-wrap: wrap; gap: 8px; }
        .onb-cl-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 999px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all .15s ease; background: rgba(255,255,255,0.18); color: #ffffff; border: 1px solid rgba(255,255,255,0.28); }
        .onb-cl-pill:hover { background: rgba(255,255,255,0.26); border-color: rgba(255,255,255,0.45); }
        .onb-cl-pill.is-active { background: #ffffff; color: #5a3fd1; border-color: #ffffff; box-shadow: 0 3px 8px rgba(0,0,0,0.10); font-weight: 700; }
        .onb-cl-row { display: flex; align-items: center; gap: 12px; padding: 8px 28px 14px; flex-wrap: wrap; }
        .onb-cl-summary { margin-left: auto; padding: 4px 11px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,0.20); color: #fff; }

        .onb-cl-body { background: #f7f5fc; padding: 18px 22px 12px; max-height: 70vh; overflow-y: auto; }
        [data-bs-theme="dark"] .onb-cl-body { background: #1f2630; }

        .onb-stage { background: #fff; border: 1px solid #ece9f6; border-radius: 14px; margin-bottom: 14px; overflow: hidden; }
        [data-bs-theme="dark"] .onb-stage { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-stage-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: linear-gradient(90deg, rgba(124,92,252,0.06), rgba(124,92,252,0)); border-bottom: 1px solid #ece9f6; }
        [data-bs-theme="dark"] .onb-stage-head { border-color: var(--vz-border-color); }
        .onb-stage-icon { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg,#7c5cfc,#5a3fd1); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
        .onb-stage-title { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .onb-stage-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-stage-sub { font-size: 12px; color: #6b7280; margin: 1px 0 0; }
        [data-bs-theme="dark"] .onb-stage-sub { color: var(--vz-secondary-color); }
        .onb-stage-count { margin-left: auto; padding: 4px 10px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-size: 11px; font-weight: 700; }

        .onb-cp { display: flex; align-items: flex-start; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #f1eff7; }
        [data-bs-theme="dark"] .onb-cp { border-color: var(--vz-border-color); }
        .onb-cp:last-child { border-bottom: none; }
        .onb-cp-check { width: 22px; height: 22px; border-radius: 6px; background: #f3f0ff; color: #7c5cfc; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
        .onb-cp-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .onb-cp-title .t { font-size: 13px; font-weight: 700; color: #1f2937; }
        [data-bs-theme="dark"] .onb-cp-title .t { color: var(--vz-heading-color, var(--vz-body-color)); }
        .onb-cp-desc { font-size: 11.5px; color: #6b7280; margin-top: 3px; line-height: 1.45; }
        [data-bs-theme="dark"] .onb-cp-desc { color: var(--vz-secondary-color); }
        .onb-cp-badge { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 5px; }

        .onb-cl-footer { background: #fff; border-top: 1px solid #eef0f4; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .onb-cl-footer { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .onb-cl-footer .hint { font-size: 12px; color: #6b7280; }
        [data-bs-theme="dark"] .onb-cl-footer .hint { color: var(--vz-secondary-color); }
        .onb-cl-close { padding: 9px 20px; border-radius: 11px; font-size: 13px; font-weight: 700; color: #fff; border: none; background: linear-gradient(90deg,#7c5cfc,#5a3fd1); box-shadow: 0 6px 14px rgba(91,63,209,0.28); cursor: pointer; }
        .onb-cl-close:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(91,63,209,0.36); }
      `}</style>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div
            className="onb-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── Header row ── */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
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
                color="secondary"
                className="btn-label waves-effect waves-light rounded-pill"
              >
                <i className="ri-checkbox-multiple-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Onboarding Checklist
              </Button>
            </div>

            {/* ── KPI cards (gradient strip + value + icon on right) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={true} md={4} sm={6} xs={12}>
                  <div
                    className="onb-surface"
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
                          {(counts as any)[k.key]}
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Tabs (segmented toggle — matches HrEmployees Active/Disabled) ── */}
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <div
                  className="d-flex"
                  style={{
                    background: 'var(--vz-secondary-bg)',
                    border: '1px solid var(--vz-border-color)',
                    borderRadius: 10,
                    padding: 4,
                    gap: 4,
                  }}
                >
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
                        className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                        style={{
                          borderRadius: 8,
                          padding: '8px 14px',
                          fontSize: 13,
                          background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          border: 'none',
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
              </Col>
            </Row>

            {/* ── Search + filters ── */}
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

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-0">
                <div className="table-responsive table-card border rounded">
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
                      ) : filtered.map(r => {
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
                                  <button type="button" className="onb-init-btn" title="Initiate Onboarding">
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
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

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
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header */}
        <div className="onb-checklist-header">
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </button>
          <h5 className="onb-cl-title">
            <span className="onb-cl-icon">
              <i className="ri-checkbox-multiple-line" style={{ fontSize: 18 }} />
            </span>
            Employee Onboarding Checklist
          </h5>
          <div className="onb-cl-sub">
            {CHECKLIST_STAGES.length} stages · {CHECKLIST_STAGES.reduce((a, s) => a + s.checkpoints.length, 0)} checkpoints · Filtered by Designation &amp; Employee Type
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
                  <i className={l.icon} style={{ fontSize: 13 }} />
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="onb-cl-row">
            <p className="onb-cl-filter-label" style={{ margin: 0 }}>Employee Type</p>
            {EMPLOYEE_TYPES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`onb-cl-pill ${empType === t.id ? 'is-active' : ''}`}
                onClick={() => setEmpType(t.id)}
              >
                {t.label}
              </button>
            ))}
            <span className="onb-cl-summary">{levelLabel} · {typeLabel}</span>
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
