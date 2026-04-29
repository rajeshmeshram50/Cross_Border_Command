import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';
import { useToast } from '../contexts/ToastContext';

// ── Evidence Vault — mock document catalogue (per-employee view) ────────────
type VaultStatus = 'Verified' | 'Uploaded' | 'Pending' | 'Signed' | 'Sent' | 'Not Generated';
interface VaultDoc {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tint: string;        // background tint for the icon tile
  fg: string;          // glyph colour
  category?: string;   // small category pill (only shown on employee tab)
  status: VaultStatus;
}
interface VaultSection { title: string; docs: VaultDoc[] }

const VAULT_EMPLOYEE_DOCS: VaultSection[] = [
  {
    title: 'Identity Documents',
    docs: [
      { id: 'aadhaar', name: 'Aadhaar Card',  desc: 'Government issued 12-digit unique identity', icon: 'ri-id-card-line',     tint: '#dceefe', fg: '#0c63b0', category: 'Identity', status: 'Verified' },
      { id: 'pan',     name: 'PAN Card',      desc: 'Permanent Account Number for taxation',      icon: 'ri-bank-card-line',   tint: '#fdf3d6', fg: '#a06f00', category: 'Identity', status: 'Verified' },
      { id: 'p_photo', name: 'Passport Photo',desc: 'Recent passport-size photograph',            icon: 'ri-image-line',       tint: '#fdd9ea', fg: '#a02960', category: 'Identity', status: 'Uploaded' },
      { id: 'p_copy',  name: 'Passport Copy', desc: 'Govt issued travel document (if applicable)',icon: 'ri-passport-line',    tint: '#dceefe', fg: '#0c63b0', category: 'Identity', status: 'Pending'  },
    ],
  },
  {
    title: 'Address Proof',
    docs: [
      { id: 'cur_addr',  name: 'Current Address Proof',   desc: 'Utility bill or bank statement (last 3 months)', icon: 'ri-home-4-line',  tint: '#fde8c4', fg: '#a4661c', category: 'Address', status: 'Uploaded' },
      { id: 'perm_addr', name: 'Permanent Address Proof', desc: 'Aadhaar / Voter ID — permanent address proof',   icon: 'ri-map-pin-line', tint: '#d6f4e3', fg: '#108548', category: 'Address', status: 'Verified' },
    ],
  },
  {
    title: 'Education Documents',
    docs: [
      { id: 'edu_10',  name: '10th Marksheet',     desc: 'Secondary school certification',         icon: 'ri-graduation-cap-line', tint: '#d6f4e3', fg: '#108548', category: 'Education', status: 'Verified' },
      { id: 'edu_12',  name: '12th Marksheet',     desc: 'Higher secondary certification',         icon: 'ri-graduation-cap-line', tint: '#d6f4e3', fg: '#108548', category: 'Education', status: 'Verified' },
      { id: 'edu_deg', name: 'Graduation Degree',  desc: 'Bachelor’s degree certificate',     icon: 'ri-medal-2-line',        tint: '#fdf3d6', fg: '#a06f00', category: 'Education', status: 'Uploaded' },
      { id: 'edu_pg',  name: 'Post Graduation',    desc: 'Master’s or postgraduate diploma',  icon: 'ri-award-line',          tint: '#dceefe', fg: '#0c63b0', category: 'Education', status: 'Pending'  },
    ],
  },
  {
    title: 'Employment History',
    docs: [
      { id: 'rel_letter', name: 'Relieving Letter',  desc: 'Final relieving from previous employer', icon: 'ri-mail-send-line',    tint: '#fde8c4', fg: '#a4661c', category: 'Employment', status: 'Verified' },
      { id: 'exp_cert',   name: 'Experience Letter', desc: 'Past employment experience certificate', icon: 'ri-briefcase-line',    tint: '#d3f0ee', fg: '#0a716a', category: 'Employment', status: 'Verified' },
      { id: 'pay_slip',   name: 'Last 3 Pay Slips',  desc: 'Most recent salary slips for reference', icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548', category: 'Employment', status: 'Uploaded' },
    ],
  },
];

const VAULT_ORG_DOCS: VaultSection[] = [
  {
    title: 'Signed Company Documents',
    docs: [
      { id: 'nda',        name: 'NDA',                       desc: 'Non-Disclosure Agreement — active during and post tenure', icon: 'ri-lock-line',          tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'emp_agree',  name: 'Employment Agreement',      desc: 'Appointment letter & employment terms and conditions',     icon: 'ri-file-list-3-line',   tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'coc',        name: 'Code of Conduct Policy',    desc: 'Acknowledgement of company ethical standards and behavior',icon: 'ri-book-2-line',        tint: '#fde8c4', fg: '#a4661c', status: 'Signed' },
      { id: 'it_sec',     name: 'IT Security & Acceptable Use', desc: 'IT asset usage, data access, and acceptable use policy',icon: 'ri-computer-line',      tint: '#dceefe', fg: '#0c63b0', status: 'Signed' },
      { id: 'leave_pol',  name: 'Leave & Attendance Policy', desc: 'Leave entitlements, attendance rules, and WFH policy',     icon: 'ri-calendar-2-line',    tint: '#dceefe', fg: '#0c63b0', status: 'Sent' },
      { id: 'conf',       name: 'Confidentiality Agreement', desc: 'Confidential business information protection agreement',   icon: 'ri-shield-check-line',  tint: '#dceefe', fg: '#0c63b0', status: 'Signed' },
      { id: 'gratuity',   name: 'Gratuity & Benefit Policy', desc: 'Gratuity eligibility, PF, and other employee benefit terms',icon: 'ri-gift-line',          tint: '#fde8c4', fg: '#a4661c', status: 'Not Generated' },
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

// Shared option lists for the master-style dropdowns used in the onboarding /
// employee modals. Kept module-scoped so they're created once.
const COUNTRY_OPTIONS = [
  { value: 'India',          label: 'India' },
  { value: 'United States',  label: 'United States' },
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'Singapore',      label: 'Singapore' },
  { value: 'UAE',            label: 'UAE' },
];
const NATIONALITY_OPTIONS = [
  { value: 'Indian',      label: 'Indian' },
  { value: 'American',    label: 'American' },
  { value: 'British',     label: 'British' },
  { value: 'Singaporean', label: 'Singaporean' },
  { value: 'Emirati',     label: 'Emirati' },
  { value: 'Other',       label: 'Other' },
];
const GENDER_OPTIONS = [
  { value: 'Male',              label: 'Male' },
  { value: 'Female',            label: 'Female' },
  { value: 'Other',             label: 'Other' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];
const STATE_OPTIONS = [
  { value: 'Maharashtra', label: 'Maharashtra' },
  { value: 'Karnataka',   label: 'Karnataka' },
  { value: 'Delhi',       label: 'Delhi' },
  { value: 'Tamil Nadu',  label: 'Tamil Nadu' },
  { value: 'Gujarat',     label: 'Gujarat' },
];

const EMP_STATUS_OPTIONS = [
  { value: 'Active',    label: 'Active' },
  { value: 'On Leave',  label: 'On Leave' },
  { value: 'Probation', label: 'Probation' },
  { value: 'Inactive',  label: 'Inactive' },
];

// Step 2 — Job Details option lists
const DEPARTMENT_OPTIONS = [
  'Accounts','Mobile Application Development','Software Testing','Recruiter','International Sales',
  'UI/UX Designing','CNS','Software Development','Logistics','Logistic','Legal','Journalism',
  'Management','Product Design',
].map(d => ({ value: d, label: d }));
const DESIGNATION_OPTIONS = [
  'Associate Engineer','Sr. Business Analyst','Data Analyst','Platform Engineer','QA Testing Lead II',
  'Lead Business Analyst','Quality Engineer','Team Lead II','VP Engineering','Jr. Software Engineer',
  'Account Manager','Product Designer','Sr. QA Engineer','Accounts Head I','Accounts Manager II',
  'Cloud Engineer','Scrum Master I','Data Analyst I','UI/UX Designer II','Coordinator I',
  'Engineer II','C-Suite Executive','Sr. CEO','Lead I','Sr. Software Engineer','Developer I','Design Head I',
].map(d => ({ value: d, label: d }));
const PRIMARY_ROLE_OPTIONS = Array.from(new Set([
  'Associate','Business Analyst','Analyst','DevOps Engineer','QA Testing Lead','QA Engineer',
  'Team Lead','Executive','Software Engineer','Sales Manager','Designer','Accounts Head',
  'Accounts Manager','Scrum Master','Data Analyst','UI/UX Designer','Coordinator','Engineer',
  'CEO','Lead','Sr. Software Engineer','Developer','Design Head',
])).map(r => ({ value: r, label: r }));
// Ancillary role list — multi-select supports any combination of these.
const ANCILLARY_ROLE_OPTIONS = [
  'Training Coordinator','Project Coordinator','Security Analyst','Mentor','Brand Consultant',
  'Test Automation Lead','Board Member',
].map(r => ({ value: r, label: r }));
const WORK_TYPE_OPTIONS = ['Full Time','Part Time','Contract','Intern','Consultant'].map(w => ({ value: w, label: w }));
// Legal entity options + each entity's registered office. Picking a legal
// entity in Step 2 auto-populates the read-only Location input from this map.
const LEGAL_ENTITY_TO_LOCATION: Record<string, string> = {
  'Enterprise India Pvt. Ltd.': 'Pune HQ',
  'Enterprise Global Holdings': 'Singapore Office',
  'Enterprise Solutions LLP':   'Mumbai Office',
};
const LEGAL_ENTITY_OPTIONS = Object.keys(LEGAL_ENTITY_TO_LOCATION).map(e => ({ value: e, label: e }));
// Sentinel values used by the dropdowns to flag "open the custom field below".
const CUSTOM_PROBATION_VALUE = '__custom_probation__';
const CUSTOM_NOTICE_VALUE    = '__custom_notice__';
const PROBATION_POLICY_OPTIONS = [
  ...['Default Probation Policy','3-Month Probation','6-Month Probation','No Probation']
    .map(p => ({ value: p, label: p })),
  { value: CUSTOM_PROBATION_VALUE, label: 'Set Custom Probation…' },
];
const NOTICE_PERIOD_OPTIONS = [
  ...['Default Notice Period','15 Days','30 Days','60 Days','90 Days']
    .map(n => ({ value: n, label: n })),
  { value: CUSTOM_NOTICE_VALUE, label: 'Set Custom Notice Period…' },
];

// Step 3 — Work Details option lists
const LEAVE_PLAN_OPTIONS    = ['Leave Policy','Standard Leave','Senior Leave Policy'].map(v => ({ value: v, label: v }));
const HOLIDAY_LIST_OPTIONS  = ['Holiday Calendar','India Holidays 2026','Global Holidays 2026'].map(v => ({ value: v, label: v }));
const SHIFT_OPTIONS         = ['General Shift','Morning Shift','Evening Shift','Night Shift','Flexible'].map(v => ({ value: v, label: v }));
const WEEKLY_OFF_OPTIONS    = ['Week Off Policy','Saturday & Sunday','Sunday Only','Rotational'].map(v => ({ value: v, label: v }));
const TIME_TRACKING_OPTIONS = ['Manual','Biometric'].map(v => ({ value: v, label: v }));
const PENALIZATION_OPTIONS  = ['Tracking Policy','Strict Policy','Lenient Policy','No Penalty'].map(v => ({ value: v, label: v }));
const OVERTIME_OPTIONS      = ['Not applicable','Hourly Pay','Compensation Off','Time and a Half'].map(v => ({ value: v, label: v }));
const EXPENSE_POLICY_OPTIONS= ['Select policy','Standard Expense Policy','Manager Approval','No Expenses'].map((v, i) => ({ value: i === 0 ? '' : v, label: v }));
const LAPTOP_OPTIONS        = ['Yes','No','Pending'].map(v => ({ value: v, label: v }));

// Step 4 — Compensation option lists
const PAY_GROUP_OPTIONS         = ['Default pay group','Senior Pay Group','Intern Pay Group','Contractor Pay Group'].map(v => ({ value: v, label: v }));
const SALARY_FREQUENCY_OPTIONS  = ['Per annum','Per month','Per hour','Per day'].map(v => ({ value: v, label: v }));
const SALARY_STRUCTURE_OPTIONS  = ['Range Based','Fixed','Component Based'].map(v => ({ value: v, label: v }));
const TAX_REGIME_OPTIONS        = ['New Regime (115BAC)','Old Regime'].map(v => ({ value: v, label: v }));

// HR → Employee directory page. KPI tiles, tabs, filter row and table follow
// the same surface/card pattern used on Clients.tsx so the look stays
// consistent across modules.

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string | null;
  manager: string;
  profile: number;
  onboarding: 'Completed' | 'In Progress' | 'Pending';
  status: 'active' | 'on_leave' | 'high_attention' | 'probation' | 'inactive';
  enabled: boolean;
}

const EMPLOYEES: EmployeeRow[] = [
  { id: 'EMP-1063', name: 'Aarav Kale',       email: 'aarav.kale@enterprise.com',       initials: 'AK', accent: '#0ab39c', department: 'Accounts',              designation: 'Associate Engineer',    primaryRole: 'Associate',         ancillaryRole: 'Training Coordinator', manager: 'Deepa Kulkarni',  profile: 83, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1068', name: 'Aditi Singh',      email: 'aditi.singh@enterprise.com',      initials: 'AS', accent: '#7c5cfc', department: 'Mobile Application D…', designation: 'Sr. Business Analyst',  primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Priya Kapoor',    profile: 95, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1064', name: 'Ananya Deshmukh',  email: 'ananya.deshmukh@enterprise.com',  initials: 'AD', accent: '#f7b84b', department: 'Accounts',              designation: 'Data Analyst',          primaryRole: 'Analyst',           ancillaryRole: null,                    manager: 'Deepa Kulkarni',  profile: 96, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1070', name: 'Anjali Joshi',     email: 'anjali.joshi@enterprise.com',     initials: 'AJ', accent: '#0ea5e9', department: 'Software Testing',      designation: 'Platform Engineer',     primaryRole: 'DevOps Engineer',   ancillaryRole: 'Security Analyst',     manager: 'Atharv Patekar',  profile: 89, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1029', name: 'Atharv Patekar',   email: 'atharv.patekar@enterprise.com',   initials: 'AP', accent: '#e83e8c', department: 'Software Testing',      designation: 'QA Testing Lead II',    primaryRole: 'QA Testing Lead',   ancillaryRole: null,                    manager: 'Rahul Verma',     profile: 86, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1035', name: 'Bhavna Mehta',     email: 'bhavna.mehta@enterprise.com',     initials: 'BM', accent: '#299cdb', department: 'Recruiter',             designation: 'Lead Business Analyst', primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Priya Kapoor',    profile: 86, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1036', name: 'Chirag Reddy',     email: 'chirag.reddy@enterprise.com',     initials: 'CR', accent: '#f06548', department: 'International Sales',   designation: 'Quality Engineer',      primaryRole: 'QA Engineer',       ancillaryRole: null,                    manager: 'Gaurav Jagtap',   profile: 97, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1083', name: 'Dhruv Verma',      email: 'dhruv.verma@enterprise.com',      initials: 'DV', accent: '#405189', department: 'UI/UX Designing',       designation: 'Team Lead II',          primaryRole: 'Team Lead',         ancillaryRole: null,                    manager: 'Parth Lakare',    profile: 91, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1046', name: 'Divya Desai',      email: 'divya.desai@enterprise.com',      initials: 'DD', accent: '#d63384', department: 'CNS',                   designation: 'Lead Business Analyst', primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Atharv Patekar',  profile: 95, onboarding: 'Completed', status: 'active',  enabled: true },

  // ── Disabled employees (visible under the "Disabled Employees" tab) ──
  // Same row schema, just `enabled: false`. Onboarding mostly "In Progress"
  // since these are profiles that haven't completed setup yet.
  { id: 'EMP-1073', name: 'Aarav Patel',      email: 'aarav.patel@enterprise.com',      initials: 'AP', accent: '#7c5cfc', department: 'Software Development',  designation: 'VP Engineering',         primaryRole: 'Executive',         ancillaryRole: null,                    manager: 'Gaurav Jagtap',  profile: 74, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1031', name: 'Aditi Singh',      email: 'aditi.singh@enterprise.com',      initials: 'AS', accent: '#0ab39c', department: 'CNS',                   designation: 'Jr. Software Engineer',  primaryRole: 'Software Engineer', ancillaryRole: 'Mentor',                manager: 'Atharv Patekar', profile: 79, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1026', name: 'Amit Deshpande',   email: 'amit.deshpande@enterprise.com',   initials: 'AD', accent: '#f7b84b', department: 'International Sales',   designation: 'Account Manager',        primaryRole: 'Sales Manager',     ancillaryRole: null,                    manager: 'Rahul Verma',    profile: 78, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1072', name: 'Ananya Sharma',    email: 'ananya.sharma@enterprise.com',    initials: 'AS', accent: '#0ea5e9', department: 'Software Development',  designation: 'Product Designer',       primaryRole: 'Designer',          ancillaryRole: 'Brand Consultant',     manager: 'Gaurav Jagtap',  profile: 73, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1069', name: 'Anil Gupta',       email: 'anil.gupta@enterprise.com',       initials: 'AG', accent: '#e83e8c', department: 'Software Development',  designation: 'Sr. QA Engineer',        primaryRole: 'QA Engineer',       ancillaryRole: 'Test Automation Lead', manager: 'Gaurav Jagtap',  profile: 74, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1030', name: 'Deepa Kulkarni',   email: 'deepa.kulkarni@enterprise.com',   initials: 'DK', accent: '#299cdb', department: 'Accounts',              designation: 'Accounts Head I',        primaryRole: 'Accounts Head',     ancillaryRole: null,                    manager: 'Rahul Verma',    profile: 79, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1023', name: 'Deepa Patil',      email: 'deepa.patil@enterprise.com',      initials: 'DP', accent: '#f06548', department: 'Accounts',              designation: 'Accounts Manager II',    primaryRole: 'Accounts Manager',  ancillaryRole: null,                    manager: 'Rahul Verma',    profile: 77, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1037', name: 'Deepa Shah',       email: 'deepa.shah@enterprise.com',       initials: 'DS', accent: '#405189', department: 'Journalism',            designation: 'Cloud Engineer',         primaryRole: 'DevOps Engineer',   ancillaryRole: null,                    manager: 'Atharv Patekar', profile: 76, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1082', name: 'Deepa Shah',       email: 'deepa.shah2@enterprise.com',      initials: 'DS', accent: '#d63384', department: 'Software Testing',      designation: 'Scrum Master I',         primaryRole: 'Scrum Master',      ancillaryRole: null,                    manager: 'Atharv Patekar', profile: 75, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1038', name: 'Dhruv Verma',      email: 'dhruv.verma2@enterprise.com',     initials: 'DV', accent: '#0ab39c', department: 'Legal',                 designation: 'Data Analyst I',         primaryRole: 'Data Analyst',      ancillaryRole: null,                    manager: 'Parth Lakare',   profile: 75, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1039', name: 'Esha Agrawal',     email: 'esha.agrawal@enterprise.com',     initials: 'EA', accent: '#0ea5e9', department: 'Logistic',              designation: 'UI/UX Designer II',      primaryRole: 'UI/UX Designer',    ancillaryRole: null,                    manager: 'Sneha Sharma',   profile: 75, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1047', name: 'Ishaan More',      email: 'ishaan.more@enterprise.com',      initials: 'IM', accent: '#0ab39c', department: 'Accounts',              designation: 'Coordinator I',          primaryRole: 'Coordinator',       ancillaryRole: null,                    manager: 'Deepa Kulkarni', profile: 74, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1066', name: 'Kavita Singh',     email: 'kavita.singh@enterprise.com',     initials: 'KS', accent: '#7c5cfc', department: 'Software Development',  designation: 'Engineer II',            primaryRole: 'Engineer',          ancillaryRole: null,                    manager: 'Gaurav Jagtap',  profile: 72, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1050', name: 'Nikhil Gawade',    email: 'nikhil.gawade@enterprise.com',    initials: 'NG', accent: '#299cdb', department: 'Logistics',             designation: 'C-Suite Executive',      primaryRole: 'Executive',         ancillaryRole: 'Board Member',          manager: 'Manoj Gawade',   profile: 77, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1085', name: 'Rahul Verma',      email: 'rahul.verma@enterprise.com',      initials: 'RV', accent: '#f7b84b', department: 'Management',            designation: 'Sr. CEO',                primaryRole: 'CEO',               ancillaryRole: null,                    manager: '—',              profile: 79, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1052', name: 'Rohan Deshmukh',   email: 'rohan.deshmukh@enterprise.com',   initials: 'RD', accent: '#f06548', department: 'Software Development',  designation: 'Lead I',                 primaryRole: 'Lead',              ancillaryRole: null,                    manager: 'Gaurav Jagtap',  profile: 76, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1054', name: 'Simran Sharma',    email: 'simran.sharma@enterprise.com',    initials: 'SS', accent: '#0ab39c', department: 'Software Development',  designation: 'Product Designer',       primaryRole: 'Designer',          ancillaryRole: null,                    manager: 'Gaurav Jagtap',  profile: 79, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1015', name: 'Sneha Kulkarni',   email: 'sneha.kulkarni@enterprise.com',   initials: 'SK', accent: '#0ea5e9', department: 'Software Development',  designation: 'Sr. Software Engineer',  primaryRole: 'Sr. Software Engineer', ancillaryRole: null,                manager: 'Gaurav Jagtap',  profile: 75, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1056', name: 'Sneha More',       email: 'sneha.more@enterprise.com',       initials: 'SM', accent: '#0ab39c', department: 'Software Testing',      designation: 'Developer I',            primaryRole: 'Developer',         ancillaryRole: null,                    manager: 'Atharv Patekar', profile: 77, onboarding: 'In Progress', status: 'inactive', enabled: false },
  { id: 'EMP-1044', name: 'Sneha Patil',      email: 'sneha.patil@enterprise.com',      initials: 'SP', accent: '#f7b84b', department: 'Product Design',        designation: 'Design Head I',          primaryRole: 'Design Head',       ancillaryRole: null,                    manager: 'Rahul Verma',    profile: 72, onboarding: 'In Progress', status: 'inactive', enabled: false },
];

// Soft tonal palette for the role pills.
const ROLE_TONES: Record<string, { bg: string; fg: string }> = {
  'Associate':            { bg: '#fdf3d6', fg: '#a06f00' },
  'Training Coordinator': { bg: '#dceefe', fg: '#0c63b0' },
  'Business Analyst':     { bg: '#fde8c4', fg: '#a4661c' },
  'Project Coordinator':  { bg: '#d6f4e3', fg: '#108548' },
  'Analyst':              { bg: '#fde8c4', fg: '#a4661c' },
  'DevOps Engineer':      { bg: '#d3f0ee', fg: '#0a716a' },
  'Security Analyst':     { bg: '#fdd9ea', fg: '#a02960' },
  'QA Testing Lead':      { bg: '#fde8c4', fg: '#a4661c' },
  'QA Engineer':          { bg: '#fde8c4', fg: '#a4661c' },
  'Team Lead':            { bg: '#fdf3d6', fg: '#a06f00' },
  // Disabled-list roles
  'Executive':            { bg: '#fdf3d6', fg: '#a06f00' },
  'Software Engineer':    { bg: '#dceefe', fg: '#0c63b0' },
  'Mentor':               { bg: '#dceefe', fg: '#0c63b0' },
  'Sales Manager':        { bg: '#fde8c4', fg: '#a4661c' },
  'Designer':             { bg: '#fdf3d6', fg: '#a06f00' },
  'Brand Consultant':     { bg: '#dceefe', fg: '#0c63b0' },
  'Test Automation Lead': { bg: '#dceefe', fg: '#0c63b0' },
  'Accounts Head':        { bg: '#fde8c4', fg: '#a4661c' },
  'Accounts Manager':     { bg: '#fde8c4', fg: '#a4661c' },
  'Scrum Master':         { bg: '#fdf3d6', fg: '#a06f00' },
  'Data Analyst':         { bg: '#fde8c4', fg: '#a4661c' },
  'UI/UX Designer':       { bg: '#fdf3d6', fg: '#a06f00' },
  'Coordinator':          { bg: '#fdf3d6', fg: '#a06f00' },
  'Engineer':             { bg: '#fdf3d6', fg: '#a06f00' },
  'Board Member':         { bg: '#dceefe', fg: '#0c63b0' },
  'CEO':                  { bg: '#fdf3d6', fg: '#a06f00' },
  'Lead':                 { bg: '#fdf3d6', fg: '#a06f00' },
  'Sr. Software Engineer':{ bg: '#fdf3d6', fg: '#a06f00' },
  'Developer':            { bg: '#fdf3d6', fg: '#a06f00' },
  'Design Head':          { bg: '#fdf3d6', fg: '#a06f00' },
};
const tone = (role: string) => ROLE_TONES[role] || { bg: '#eef2f6', fg: '#475569' };

// Onboarding-status pill recipe — soft tinted background + bold dot accent.
// Each tone carries a light background, a darker foreground for the label,
// and a dot colour that pops a notch above the foreground for emphasis.
const ONBOARDING_TONES: Record<EmployeeRow['onboarding'], { bg: string; fg: string; dot: string }> = {
  'Completed':   { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'In Progress': { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Pending':     { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

// Reporting-manager options — derived from the active employee directory so
// the dropdown reads "{Name} ({Designation})" and stays in sync with mock data.
const REPORTING_MANAGER_OPTIONS = EMPLOYEES
  .filter(e => e.enabled)
  .map(e => ({ value: e.name, label: `${e.name} (${e.designation})` }));

// Reuse the Clients KPI card recipe — gradient strip on top + 44×44 icon box,
// 11px uppercase label, 26px value. Keep gradients distinct per status so the
// 6 tiles read at a glance.
const KPI_CARDS = [
  { key: 'total',          label: 'Total Employees', icon: 'ri-team-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { key: 'active',         label: 'Active',          icon: 'ri-checkbox-circle-fill',gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { key: 'on_leave',       label: 'On Leave',        icon: 'ri-time-line',           gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
  { key: 'high_attention', label: 'High Attention',  icon: 'ri-error-warning-fill',  gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { key: 'probation',      label: 'Probation',       icon: 'ri-shield-check-fill',   gradient: 'linear-gradient(135deg,#0c63b0,#299cdb)' },
  { key: 'inactive',       label: 'Inactive',        icon: 'ri-close-circle-fill',   gradient: 'linear-gradient(135deg,#878a99,#b9bbc6)' },
] as const;

type ExpiryDays = 3 | 7 | 15;

export default function HrEmployees() {
  const [tab, setTab] = useState<'active' | 'disabled'>('active');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'All'>('Active');
  const [deptFilter, setDeptFilter] = useState<string>('All Depts');

  // Onboarding link modal state
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onbName, setOnbName] = useState('');
  const [onbEmail, setOnbEmail] = useState('');
  const [onbDept, setOnbDept] = useState('');
  const [onbDate, setOnbDate] = useState('');
  const [onbExpiry, setOnbExpiry] = useState<ExpiryDays>(15);

  // Onboarding form — inline validation. Mirrors the pattern used by the
  // master/client forms: per-field error map cleared as the user fixes the
  // field, with a summary toast on submit if anything is still invalid.
  const toast = useToast();
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
    if (!onbName.trim())  errs.name  = 'Employee name is required';
    if (!onbEmail.trim()) errs.email = 'Email address is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(onbEmail.trim())) errs.email = 'Please enter a valid email address';
    if (!onbDept)         errs.dept  = 'Please select a department';
    if (!onbDate)         errs.date  = 'Please pick the expected joining date';
    return errs;
  };
  const handleGenerateOnboarding = () => {
    const errs = validateOnboarding();
    if (Object.keys(errs).length > 0) {
      setOnbErrors(errs);
      toast.error('Please fix the highlighted fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need${Object.keys(errs).length === 1 ? 's' : ''} attention.`);
      return;
    }
    // TODO: wire to backend — generate signed onboarding link for {onbName, onbEmail, onbDept, onbDate, onbExpiry}
    toast.success('Onboarding link generated', `A ${onbExpiry}-day link will be sent to ${onbEmail}.`);
    closeOnboard();
  };

  const closeOnboard = () => {
    setOnboardOpen(false);
    setOnbName('');
    setOnbEmail('');
    setOnbDept('');
    setOnbDate('');
    setOnbExpiry(15);
    setOnbErrors({});
  };

  // Triggered from the disabled-tab person icon — pre-fills the onboarding link
  // modal with the row's data so the recruiter can issue a fresh signed link
  // without retyping the basics.
  const openOnboardingForEmployee = (row: EmployeeRow) => {
    setOnbName(row.name);
    setOnbEmail(row.email);
    setOnbDept(row.department);
    setOnbDate('');
    setOnbExpiry(15);
    setOnboardOpen(true);
  };

  // Add / Edit employee modal state
  const [empOpen, setEmpOpen] = useState(false);
  const [empMode, setEmpMode] = useState<'add' | 'edit'>('add');
  const [empEditingName, setEmpEditingName] = useState<string>('');
  const [empStep, setEmpStep] = useState<1 | 2 | 3 | 4>(1);
  // Step 1 — Employee Details
  const [eWorkCountry, setEWorkCountry]   = useState('India');
  const [eFirstName, setEFirstName]       = useState('');
  const [eMiddleName, setEMiddleName]     = useState('');
  const [eLastName, setELastName]         = useState('');
  const [eDisplayName, setEDisplayName]   = useState('');
  // Tracks whether the user has manually edited Display Name. Until they do,
  // typing in First/Last Name auto-fills it as "First Last".
  const [eDisplayNameTouched, setEDisplayNameTouched] = useState(false);
  const [eActualName, setEActualName]     = useState('');
  const [eGender, setEGender]             = useState('');
  const [eDob, setEDob]                   = useState('');
  const [eNationality, setENationality]   = useState('Indian');
  // Step 1 — Contact & Identity
  const [eWorkEmail, setEWorkEmail]       = useState('');
  const [eMobile, setEMobile]             = useState('');
  const [eEmpId, setEEmpId]               = useState('');
  const [eStatus, setEStatus]             = useState('Active');
  // Step 1 — Address (current + permanent).
  const [eCurAddr1, setECurAddr1]   = useState('');
  const [eCurAddr2, setECurAddr2]   = useState('');
  const [eCurCity, setECurCity]     = useState('');
  const [eCurState, setECurState]   = useState('');
  const [eCurCountry, setECurCountry] = useState('India');
  const [eCurPin, setECurPin]       = useState('');
  const [eSameAsCurrent, setESameAsCurrent] = useState(false);
  const [ePermAddr1, setEPermAddr1] = useState('');
  const [ePermAddr2, setEPermAddr2] = useState('');
  const [ePermCity, setEPermCity]   = useState('');
  const [ePermState, setEPermState] = useState('');
  const [ePermCountry, setEPermCountry] = useState('India');
  const [ePermPin, setEPermPin]     = useState('');
  // Step 2 — Job Details
  const [eJoinDate, setEJoinDate]                = useState('');
  const [eDept, setEDept]                        = useState('');
  const [eDesignation, setEDesignation]          = useState('');
  const [ePrimaryRole, setEPrimaryRole]          = useState('');
  const [eAncillaryRole, setEAncillaryRole]      = useState<string[]>([]);
  const [eWorkType, setEWorkType]                = useState('Full Time');
  const [eLegalEntity, setELegalEntity]          = useState('');
  const [eLocation, setELocation]                = useState('');
  const [eReportingMgr, setEReportingMgr]        = useState('');
  const [eProbationPolicy, setEProbationPolicy]  = useState('Default Probation Policy');
  const [eNoticePeriod, setENoticePeriod]        = useState('Default Notice Period');
  // Custom values that appear below their dropdowns when "Set Custom…" is picked.
  const [eCustomProbation, setECustomProbation]  = useState('');
  const [eCustomNotice, setECustomNotice]        = useState('');
  // Step 3 — Work Details
  const [eLeavePlan, setELeavePlan]              = useState('Leave Policy');
  const [eHolidayList, setEHolidayList]          = useState('Holiday Calendar');
  const [eAttendanceTracking, setEAttendanceTracking] = useState(true);
  const [eShift, setEShift]                      = useState('General Shift');
  const [eWeeklyOff, setEWeeklyOff]              = useState('Week Off Policy');
  const [eAttendanceNumber, setEAttendanceNumber]= useState('');
  const [eTimeTracking, setETimeTracking]        = useState('Manual');
  const [ePenalizationPolicy, setEPenalizationPolicy] = useState('Tracking Policy');
  const [eOvertime, setEOvertime]                = useState('Not applicable');
  const [eExpensePolicy, setEExpensePolicy]      = useState('');
  const [eLaptopAssigned, setELaptopAssigned]    = useState('No');
  const [eLaptopAssetId, setELaptopAssetId]      = useState('');
  const [eMobileDevice, setEMobileDevice]        = useState('');
  const [eOtherAssets, setEOtherAssets]          = useState('');
  const [eAadharFile, setEAadharFile]            = useState<File | null>(null);
  const [ePanFile, setEPanFile]                  = useState<File | null>(null);
  const [ePhotoFile, setEPhotoFile]              = useState<File | null>(null);

  // Assign Assets modal (opened by the per-row Workstation icon)
  const [assignOpen, setAssignOpen]   = useState(false);
  const [assignEmp, setAssignEmp]     = useState<EmployeeRow | null>(null);
  const [assignTab, setAssignTab]     = useState<'it' | 'security' | 'hr'>('it');
  // IT Assets fields
  const [aLaptopAssigned, setALaptopAssigned] = useState('No');
  const [aLaptopAssetId, setALaptopAssetId]   = useState('');
  const [aMobileDevice, setAMobileDevice]     = useState('');
  const [aOtherAssets, setAOtherAssets]       = useState('');
  // Security fields
  const [aAccessCard, setAAccessCard]     = useState('');
  const [aSecurityLevel, setASecurityLevel] = useState('Level 1 — Basic');
  const [aVpnAccess, setAVpnAccess]       = useState('Not Required');
  // HR Record fields
  const [aIssueDate, setAIssueDate] = useState('');
  const [aIssuedBy, setAIssuedBy]   = useState('');
  const [aNotes, setANotes]         = useState('');

  const openAssignAssets = (row: EmployeeRow) => {
    setAssignEmp(row);
    setAssignTab('it');
    setALaptopAssigned('No'); setALaptopAssetId(''); setAMobileDevice(''); setAOtherAssets('');
    setAAccessCard(''); setASecurityLevel('Level 1 — Basic'); setAVpnAccess('Not Required');
    setAIssueDate(''); setAIssuedBy(''); setANotes('');
    setAssignErrors({});
    setAssignOpen(true);
  };
  // Assign Assets — validation state. Pattern matches the master/onboarding
  // forms: per-field error map, cleared as the user fixes each field, with a
  // toast on submit if anything is still invalid.
  type AssignErrors = {
    laptopAssetId?: string;
    mobileDevice?: string;
    accessCard?: string;
    issueDate?: string;
    issuedBy?: string;
  };
  const [assignErrors, setAssignErrors] = useState<AssignErrors>({});
  const clearAssignError = (key: keyof AssignErrors) => {
    setAssignErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const validateAssign = (): { errors: AssignErrors; firstTab?: 'it' | 'security' | 'hr' } => {
    const errs: AssignErrors = {};
    // IT Assets — Asset ID is required when a laptop is assigned.
    if (aLaptopAssigned === 'Yes' && !aLaptopAssetId.trim()) {
      errs.laptopAssetId = 'Laptop Asset ID is required when a laptop is assigned';
    }
    if (aMobileDevice.trim() && aMobileDevice.trim().length < 2) {
      errs.mobileDevice = 'Please enter a valid device name';
    }
    // Security — access card format check (only if filled).
    if (aAccessCard.trim() && !/^[A-Za-z0-9-]{4,}$/.test(aAccessCard.trim())) {
      errs.accessCard = 'Access card must be at least 4 alphanumeric characters';
    }
    // HR Record — issue date and issuer are mandatory for any assignment.
    if (!aIssueDate)         errs.issueDate = 'Issue date is required';
    if (!aIssuedBy.trim())   errs.issuedBy  = 'Issued by is required';

    let firstTab: 'it' | 'security' | 'hr' | undefined;
    if (errs.laptopAssetId || errs.mobileDevice) firstTab = 'it';
    else if (errs.accessCard)                    firstTab = 'security';
    else if (errs.issueDate || errs.issuedBy)    firstTab = 'hr';
    return { errors: errs, firstTab };
  };
  const handleSaveAssign = () => {
    const { errors, firstTab } = validateAssign();
    if (Object.keys(errors).length > 0) {
      setAssignErrors(errors);
      if (firstTab && firstTab !== assignTab) setAssignTab(firstTab);
      toast.error(
        'Please fix the highlighted fields',
        `${Object.keys(errors).length} field${Object.keys(errors).length === 1 ? '' : 's'} need${Object.keys(errors).length === 1 ? 's' : ''} attention.`
      );
      return;
    }
    // TODO: wire to backend — POST asset assignment for assignEmp
    toast.success('Assets saved', `Asset assignment recorded for ${assignEmp?.name || 'this employee'}.`);
    closeAssign();
  };

  const closeAssign = () => {
    setAssignOpen(false);
    setAssignEmp(null);
    setAssignErrors({});
  };

  // Manage Permissions — opens a dedicated page (not a modal) so the matrix
  // gets full screen real estate. The route reads the row from navigation
  // state; falling back to just the id if landed on directly.
  const navigate = useNavigate();
  const openPermissions = (row: EmployeeRow) => {
    navigate(`/hr/employees/${encodeURIComponent(row.id)}/permissions`, { state: { employee: row } });
  };

  // Evidence Vault modal (opened by the per-row Documents/PDF icon)
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultEmp, setVaultEmp]   = useState<EmployeeRow | null>(null);
  const [vaultTab, setVaultTab]   = useState<'employee' | 'organizational'>('employee');
  const openVault = (row: EmployeeRow) => {
    setVaultEmp(row);
    setVaultTab('employee');
    setVaultOpen(true);
  };
  const closeVault = () => { setVaultOpen(false); setVaultEmp(null); };

  // Toggle confirmation — clicking the per-row enable/disable switch first
  // pops a confirm modal; on Confirm the row's local toggle commits.
  const [togglePending, setTogglePending] = useState<{
    employee: EmployeeRow;
    next: boolean;          // the state the user is asking to switch to
    commit: () => void;     // callback into the ToggleSwitch's local setter
  } | null>(null);

  const requestToggle = (employee: EmployeeRow, next: boolean, commit: () => void) => {
    setTogglePending({ employee, next, commit });
  };
  const cancelToggle  = () => setTogglePending(null);
  const confirmToggle = () => {
    togglePending?.commit();
    setTogglePending(null);
  };
  // Step 4 — Compensation
  const [eEnablePayroll, setEEnablePayroll]      = useState(true);
  const [ePayGroup, setEPayGroup]                = useState('Default pay group');
  const [eAnnualSalary, setEAnnualSalary]        = useState('');
  const [eSalaryFreq, setESalaryFreq]            = useState('Per annum');
  const [eSalaryFrom, setESalaryFrom]            = useState('');
  const [eSalaryStructure, setESalaryStructure]  = useState('Range Based');
  const [eTaxRegime, setETaxRegime]              = useState('New Regime (115BAC)');
  const [eBonusInAnnual, setEBonusInAnnual]      = useState(false);
  const [ePfEligible, setEPfEligible]            = useState(false);
  const [eDetailedBreakup, setEDetailedBreakup]  = useState(false);

  const resetEmpForm = () => {
    setEmpStep(1);
    setEWorkCountry('India');
    setEFirstName(''); setEMiddleName(''); setELastName('');
    setEDisplayName(''); setEDisplayNameTouched(false); setEActualName('');
    setEGender(''); setEDob(''); setENationality('Indian');
    setEWorkEmail(''); setEMobile('');
    setEEmpId(''); setEStatus('Active');
    setECurAddr1(''); setECurAddr2(''); setECurCity(''); setECurState(''); setECurCountry('India'); setECurPin('');
    setESameAsCurrent(false);
    setEPermAddr1(''); setEPermAddr2(''); setEPermCity(''); setEPermState(''); setEPermCountry('India'); setEPermPin('');
    // Step 2
    setEJoinDate(''); setEDept(''); setEDesignation('');
    setEPrimaryRole(''); setEAncillaryRole([]); setEWorkType('Full Time');
    setELegalEntity(''); setELocation(''); setEReportingMgr('');
    setEProbationPolicy('Default Probation Policy'); setENoticePeriod('Default Notice Period');
    setECustomProbation(''); setECustomNotice('');
    // Step 3
    setELeavePlan('Leave Policy'); setEHolidayList('Holiday Calendar');
    setEAttendanceTracking(true); setEShift('General Shift');
    setEWeeklyOff('Week Off Policy'); setEAttendanceNumber('');
    setETimeTracking('Manual'); setEPenalizationPolicy('Tracking Policy');
    setEOvertime('Not applicable'); setEExpensePolicy('');
    setELaptopAssigned('No'); setELaptopAssetId(''); setEMobileDevice(''); setEOtherAssets('');
    setEAadharFile(null); setEPanFile(null); setEPhotoFile(null);
    // Step 4
    setEEnablePayroll(true); setEPayGroup('Default pay group');
    setEAnnualSalary(''); setESalaryFreq('Per annum'); setESalaryFrom('');
    setESalaryStructure('Range Based'); setETaxRegime('New Regime (115BAC)');
    setEBonusInAnnual(false); setEPfEligible(false); setEDetailedBreakup(false);
  };

  const closeEmp = () => { setEmpOpen(false); resetEmpForm(); };

  const openAddEmployee = () => {
    resetEmpForm();
    setEmpMode('add');
    setEmpEditingName('');
    setEmpOpen(true);
  };

  const openEditEmployee = (row: EmployeeRow) => {
    resetEmpForm();
    setEmpMode('edit');
    setEmpEditingName(row.name);
    const parts = row.name.split(' ');
    setEFirstName(parts[0] || '');
    setELastName(parts.slice(1).join(' ') || '');
    setEDisplayName(row.name);
    // In edit mode the display name is already populated from the row, so
    // treat it as user-touched to avoid the auto-fill clobbering it on first
    // First-name/Last-name edit.
    setEDisplayNameTouched(true);
    setEActualName(row.name);
    setEWorkEmail(row.email);
    setEEmpId(row.id);
    setEStatus(row.enabled ? 'Active' : 'Inactive');
    // Step 2 — pre-fill from row
    setEDept(row.department);
    setEDesignation(row.designation);
    setEPrimaryRole(row.primaryRole);
    setEAncillaryRole(row.ancillaryRole ? [row.ancillaryRole] : []);
    setEReportingMgr(row.manager);
    setEmpOpen(true);
  };

  // When "Same as Current Address" is checked, mirror the current address.
  const onToggleSameAsCurrent = (checked: boolean) => {
    setESameAsCurrent(checked);
    if (checked) {
      setEPermAddr1(eCurAddr1);
      setEPermAddr2(eCurAddr2);
      setEPermCity(eCurCity);
      setEPermState(eCurState);
      setEPermCountry(eCurCountry);
      setEPermPin(eCurPin);
    }
  };

  const departments = useMemo(
    () => ['All Depts', ...Array.from(new Set(EMPLOYEES.map(e => e.department)))],
    []
  );

  const counts = useMemo(() => ({
    total: EMPLOYEES.length + 72,
    active: EMPLOYEES.filter(e => e.enabled).length + 38,
    on_leave: 2,
    high_attention: 2,
    probation: 3,
    inactive: 6,
    activeTab: 47,
    disabledTab: 34,
  }), []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return EMPLOYEES.filter(e => {
      if (tab === 'active' && !e.enabled) return false;
      if (tab === 'disabled' && e.enabled) return false;
      if (deptFilter !== 'All Depts' && e.department !== deptFilter) return false;
      if (!s) return true;
      return [e.name, e.id, e.department, e.designation, e.primaryRole, e.email]
        .some(v => v.toLowerCase().includes(s));
    });
  }, [q, tab, deptFilter]);

  return (
    <>
      <style>{`
        .hr-employees-surface { background: #ffffff; }
        [data-bs-theme="dark"] .hr-employees-surface { background: #1c2531; }
      `}</style>
      <MasterFormStyles />

      

      <Row>
        <Col xs={12}>
          <div
            className="hr-employees-surface"
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
                {/* Icon tile — gradient square with white glyph and a soft
                    primary shadow, matching the master "What you are doing
                    here" card on the Department Master. */}
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
                    boxShadow: '0 4px 10px rgba(64,81,137,0.25)',
                  }}
                >
                  <i className="ri-team-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Employee </h5>
                    
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Employee directory, profiles, and employment records
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button
                  onClick={() => setOnboardOpen(true)}
                  className="rounded-pill px-3"
                  style={{
                    background: '#fff',
                    color: 'var(--vz-secondary)',
                    border: '1px solid var(--vz-secondary)',
                    fontWeight: 600,
                  }}
                >
                  <i className="ri-user-add-line align-bottom me-1"></i>Onboarding Link
                </Button>
                <Button
                  onClick={openAddEmployee}
                  color="secondary"
                  className="btn-label waves-effect waves-light rounded-pill"
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Employee
                </Button>
              </div>
            </div>

            {/* ── KPI cards (Clients-style: gradient strip + icon box) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
                  <div
                    className="hr-employees-surface"
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
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div className="min-w-0">
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          <AnimatedNumber value={(counts as any)[k.key]} />
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Tabs (Active / Disabled) ── */}
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
                    { key: 'active'   as const, label: 'Active Employees',   count: counts.activeTab,   icon: 'ri-user-follow-line' },
                    { key: 'disabled' as const, label: 'Disabled Employees', count: counts.disabledTab, icon: 'ri-user-unfollow-line' },
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

            {/* ── Search + Filters (Clients-style row) ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search name, ID, department, role…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
              <Col md={6} sm={12} className="d-flex justify-content-md-end gap-3 flex-wrap align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Status</span>
                  <div style={{ minWidth: 130 }}>
                    <MasterSelect
                      value={statusFilter}
                      onChange={(v) => setStatusFilter((v as 'Active' | 'All') || 'Active')}
                      options={[
                        { value: 'Active', label: 'Active' },
                        { value: 'All',    label: 'All' },
                      ]}
                      placeholder="Status"
                    />
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Department</span>
                  <div style={{ minWidth: 170 }}>
                    <MasterSelect
                      value={deptFilter}
                      onChange={setDeptFilter}
                      options={departments.map(d => ({ value: d, label: d }))}
                      placeholder="All Depts"
                    />
                  </div>
                </div>
              </Col>
            </Row>

            {/* ── Table (Clients-style: table-card border rounded + table-light thead) ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <div className="table-responsive table-card border rounded">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col" className="ps-3 text-center" style={{ width: 56 }}>#</th>
                        <th scope="col">Employee</th>
                        <th scope="col">Employee ID</th>
                        <th scope="col">Department</th>
                        <th scope="col">Designation</th>
                        <th scope="col">Primary Role</th>
                        <th scope="col">Ancillary Role</th>
                        <th scope="col">Manager</th>
                        <th scope="col">Profile %</th>
                        <th scope="col">Onboarding</th>
                        <th scope="col" className="text-center pe-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No employees match your filters
                          </td>
                        </tr>
                      ) : filtered.map((e, idx) => {
                        const primary = tone(e.primaryRole);
                        const ancillary = e.ancillaryRole ? tone(e.ancillaryRole) : null;
                        return (
                          <tr key={e.id}>
                            <td className="ps-3 text-center text-muted fs-13">{idx + 1}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{
                                    width: 34, height: 34, fontSize: 12,
                                    background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)`,
                                    boxShadow: `0 2px 6px ${e.accent}40`,
                                  }}
                                >
                                  {e.initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="fw-semibold fs-13">{e.name}</div>
                                  <a
                                    href={`mailto:${e.email}`}
                                    className="text-muted text-decoration-none d-inline-flex align-items-center gap-1"
                                    style={{ fontSize: 11.5 }}
                                  >
                                    <i className="ri-mail-line" style={{ fontSize: 12 }} />
                                    <span>{e.email}</span>
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span
                                className="d-inline-flex align-items-center fw-bold font-monospace"
                                style={{
                                  fontSize: 12,
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                  background: '#ece6ff',
                                  color: '#5a3fd1',
                                  letterSpacing: '0.02em',
                                }}
                              >
                                {e.id}
                              </span>
                            </td>
                            <td className="fs-13">{e.department}</td>
                            <td className="fs-13">{e.designation}</td>
                            <td>
                              <span
                                className="d-inline-flex align-items-center fw-semibold"
                                style={{
                                  fontSize: 11,
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                  background: primary.bg,
                                  color: primary.fg,
                                }}
                              >
                                {e.primaryRole}
                              </span>
                            </td>
                            <td>
                              {ancillary ? (
                                <span
                                  className="d-inline-flex align-items-center fw-semibold"
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 10px',
                                    borderRadius: 999,
                                    background: ancillary.bg,
                                    color: ancillary.fg,
                                  }}
                                >
                                  {e.ancillaryRole}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="fs-13">{e.manager}</td>
                            <td>
                              {(() => {
                                // Tier-based colour pair (dark → light). Bar uses a horizontal
                                // gradient between the two with a diagonal stripe overlay, and a
                                // circular badge with the percent floats above the fill end.
                                const p = e.profile;
                                const TIER = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                                          : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                                          : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                                          :           { dark: '#f06548', light: '#fda192' };
                                // Clamp badge position so it never spills past the track ends.
                                const badgeLeft = Math.max(11, Math.min(89, p));
                                return (
                                  <div
                                    style={{ position: 'relative', width: 120, paddingTop: 30 }}
                                    title={`Profile ${p}% complete`}
                                  >
                                    {/* Floating badge + downward pointer */}
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

                                    {/* Track + striped fill */}
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
                                          background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${TIER.dark}, ${TIER.light})`,
                                          transition: 'width .25s ease',
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td>
                              {(() => {
                                const ob = ONBOARDING_TONES[e.onboarding];
                                return (
                                  <span
                                    className="rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                                    style={{
                                      background: ob.bg,
                                      color: ob.fg,
                                      fontSize: 11.5,
                                      padding: '4px 10px',
                                      border: 'none',
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: ob.dot, flexShrink: 0,
                                      }}
                                    />
                                    {e.onboarding}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="pe-3">
                              <div className="d-flex gap-1 justify-content-center align-items-center">
                                <ActionBtn title="Edit"        icon="ri-pencil-line"      color="info"      onClick={() => openEditEmployee(e)} />
                                {tab === 'disabled' ? (
                                  // Disabled employees swap the Documents action for an Onboarding
                                  // shortcut — clicking it opens the onboarding-link modal pre-filled
                                  // with this employee's name, email, and department.
                                  <ActionBtn title="Send Onboarding" icon="ri-user-add-line" color="info" onClick={() => openOnboardingForEmployee(e)} />
                                ) : null}
                                <ActionBtn title="Workstation" icon="ri-computer-line"    color="primary"   onClick={() => openAssignAssets(e)} />
                                <ActionBtn title="Permissions" icon="ri-lock-2-line"      color="warning"   onClick={() => openPermissions(e)} />
                                {tab === 'active' && (
                                  <ActionBtn title="Documents"   icon="ri-file-text-line"   color="success"   onClick={() => openVault(e)} />
                                )}
                                <ToggleSwitch
                                  initial={e.enabled}
                                  onRequestToggle={(next, commit) => requestToggle(e, next, commit)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer count — matches the rhythm of the Clients table */}
                <div className="d-flex align-items-center justify-content-between mt-3 pt-2 border-top">
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Showing <span className="fw-bold text-body">{filtered.length}</span> of <span className="fw-bold text-body">{EMPLOYEES.filter(e => tab === 'active' ? e.enabled : !e.enabled).length}</span> {tab === 'active' ? 'Active' : 'Disabled'} Employees
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {/* ── Generate Onboarding Link modal ── */}
      <Modal
        isOpen={onboardOpen}
        toggle={closeOnboard}
        centered
        size="md"
        contentClassName="onb-modal-content border-0"
        backdrop="static"
        keyboard={false}
      >
        <style>{`
          .onb-modal-content { border-radius: 24px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.18); }
          .onb-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; font-size: 14px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; width: 100%; height: 50px; }
          .onb-input::placeholder { color: #9ca3af; font-weight: 400; }
          .onb-input:focus { outline: none; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
          .onb-input.is-invalid { border-color: #f06548 !important; box-shadow: 0 0 0 3px rgba(240,101,72,0.15) !important; }
          .onb-error { display: flex; align-items: center; gap: 4px; color: #f06548; font-size: 12px; margin-top: 6px; }
          .onb-error i { font-size: 13px; }
          [data-bs-theme="dark"] .onb-input { background: #1c2531; border-color: var(--vz-border-color); color: var(--vz-body-color); }
          [data-bs-theme="dark"] .onb-input::placeholder { color: var(--vz-secondary-color); }
          .onb-label { font-size: 12px; font-weight: 700; color: #374151; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; display: block; }
          [data-bs-theme="dark"] .onb-label { color: var(--vz-body-color); }
          .onb-label .onb-req { color: #f06548; margin-left: 2px; font-weight: 700; }
          .onb-expiry-pill { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 999px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s ease; background: #fff; border: 1px solid #e5e7eb; color: #6b7280; }
          .onb-expiry-pill:hover { border-color: #c4b5fd; color: #7c5cfc; }
          .onb-expiry-pill.is-active { background: #f5f0ff; border-color: #a78bfa; color: #7c5cfc; }
          [data-bs-theme="dark"] .onb-expiry-pill { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); color: var(--vz-secondary-color); }
          [data-bs-theme="dark"] .onb-expiry-pill.is-active { background: rgba(124,92,252,0.18); border-color: #a78bfa; color: #c4b5fd; }
          .onb-submit-btn { padding: 16px 22px; border-radius: 16px; font-size: 15px; color: #fff; border: none; background: linear-gradient(90deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%); box-shadow: 0 10px 22px rgba(124,58,237,0.32); transition: transform .15s ease, box-shadow .15s ease; }
          .onb-submit-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 28px rgba(124,58,237,0.38); }
          .onb-close-btn { width: 32px; height: 32px; border-radius: 10px; background: transparent; border: none; color: #6b7280; transition: background .15s ease, color .15s ease; }
          .onb-close-btn:hover { background: #f3f4f6; color: #1f2937; }
        `}</style>

        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
          {/* Header */}
          <div className="d-flex align-items-start justify-content-between" style={{ padding: '24px 28px 18px' }}>
            <div className="d-flex align-items-center gap-3">
              <div
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: '#f3edff',
                }}
              >
                <i className="ri-link" style={{ fontSize: 22, color: '#7c3aed' }} />
              </div>
              <div>
                <h5 className="fw-bold mb-1" style={{ fontSize: 19, letterSpacing: '-0.01em', color: '#1f2937' }}>
                  Generate Onboarding Link
                </h5>
                <div style={{ fontSize: 13.5, color: '#6b7280' }}>
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

          {/* Divider */}
          <div style={{ height: 1, background: '#eef0f4', margin: '0 28px' }} />

          {/* Form body */}
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
                  onChange={e => { setOnbEmail(e.target.value); clearOnbError('email'); }}
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
                  options={departments
                    .filter(d => d !== 'All Depts')
                    .map(d => ({ value: d, label: d }))}
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
                  invalid={!!onbErrors.date}
                />
                {onbErrors.date && (
                  <div className="onb-error"><i className="ri-error-warning-line" />{onbErrors.date}</div>
                )}
              </Col>
            </Row>

            {/* Link expiry */}
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

          {/* Footer / submit */}
          <div style={{ padding: '20px 28px 26px' }}>
            <button
              type="button"
              className="onb-submit-btn w-100 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
              onClick={handleGenerateOnboarding}
            >
              <i className="ri-link" style={{ fontSize: 18 }} />
              Generate Onboarding Link
            </button>
          </div>
        </ModalBody>
      </Modal>

      {/* ── Confirm Status Change (per-row toggle) ── */}
      <Modal
        isOpen={!!togglePending}
        toggle={cancelToggle}
        centered
        size="md"
        contentClassName="toggle-confirm-content border-0"
        backdrop="static"
        keyboard={false}
      >
        <style>{`
          .toggle-confirm-content { border-radius: 20px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.22); }
        `}</style>
        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
          {(() => {
            if (!togglePending) return null;
            const enabling = togglePending.next;
            const emp = togglePending.employee;
            const tone = enabling
              ? {
                  // Tones for the "enable" path — teal/green family.
                  headerGrad: 'linear-gradient(135deg,#d6f4e3 0%, #c1eed8 100%)',
                  iconBg:     '#0ab39c',
                  iconShadow: '0 8px 22px rgba(10,179,156,0.35)',
                  iconGlyph:  'ri-shield-check-line',
                  title:      'Enable Employee',
                  subtitle:   'Restore platform access for this employee',
                  bannerBg:   '#ecfaf3',
                  bannerBd:   '#bce8d2',
                  bannerFg:   '#0a8a78',
                  bannerIcon: 'ri-information-line',
                  bannerText: "They'll regain access immediately and reappear under the Active tab.",
                  ctaLabel:   'Yes, Enable',
                  ctaIcon:    'ri-check-line',
                  ctaBg:      'linear-gradient(135deg,#0ab39c,#02c8a7)',
                  ctaShadow:  '0 8px 18px rgba(10,179,156,0.30)',
                }
              : {
                  // Tones for the "disable" path — amber/warning family.
                  headerGrad: 'linear-gradient(135deg,#fff4dd 0%, #ffe8c2 100%)',
                  iconBg:     '#f59e0b',
                  iconShadow: '0 8px 22px rgba(245,158,11,0.35)',
                  iconGlyph:  'ri-error-warning-line',
                  title:      'Disable Employee',
                  subtitle:   'Suspend platform access for this employee',
                  bannerBg:   '#fff7e6',
                  bannerBd:   '#fbcf8a',
                  bannerFg:   '#a4661c',
                  bannerIcon: 'ri-alert-line',
                  bannerText: "They'll lose platform access immediately and move to the Disabled tab. You can re-enable them anytime.",
                  ctaLabel:   'Yes, Disable',
                  ctaIcon:    'ri-forbid-2-line',
                  ctaBg:      'linear-gradient(135deg,#f59e0b,#fbbf24)',
                  ctaShadow:  '0 8px 18px rgba(245,158,11,0.30)',
                };
            return (
              <>
                {/* Tinted header band with the action icon and close button */}
                <div
                  style={{
                    background: tone.headerGrad,
                    padding: '24px 24px 36px',
                    position: 'relative',
                  }}
                >
                  <button
                    type="button"
                    onClick={cancelToggle}
                    aria-label="Close"
                    className="btn p-0 d-inline-flex align-items-center justify-content-center"
                    style={{
                      position: 'absolute', top: 14, right: 14,
                      width: 30, height: 30, borderRadius: 10,
                      background: 'rgba(255,255,255,0.65)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      color: '#374151',
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
                    <h5 className="fw-bold mb-1 mt-3" style={{ fontSize: 18, letterSpacing: '-0.01em', color: '#1f2937' }}>
                      {tone.title}
                    </h5>
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      {tone.subtitle}
                    </div>
                  </div>
                </div>

                {/* Employee identity card — needs an explicit stacking context
                    (position + z-index) so it paints over the header band, whose
                    position:relative (set for the X button) creates its own context. */}
                <div style={{ padding: '0 24px', marginTop: -22, position: 'relative', zIndex: 2 }}>
                  <div
                    className="d-flex align-items-center gap-3"
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
                      <div className="fw-bold text-truncate" style={{ fontSize: 14 }}>{emp.name}</div>
                      <div className="text-muted text-truncate" style={{ fontSize: 12 }}>
                        {emp.designation} · {emp.department}
                      </div>
                    </div>
                    <span
                      className="d-inline-flex align-items-center fw-semibold font-monospace flex-shrink-0"
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

                {/* State transition strip (Active → Disabled visual) */}
                <div className="d-flex align-items-center justify-content-center gap-2" style={{ padding: '18px 24px 4px' }}>
                  <span
                    className="d-inline-flex align-items-center fw-semibold"
                    style={{
                      fontSize: 11.5,
                      padding: '5px 12px',
                      borderRadius: 999,
                      background: enabling ? '#eef2f6' : '#d6f4e3',
                      color:      enabling ? '#5b6478' : '#108548',
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
                    className="d-inline-flex align-items-center fw-semibold"
                    style={{
                      fontSize: 11.5,
                      padding: '5px 12px',
                      borderRadius: 999,
                      background: enabling ? '#d6f4e3' : '#fde8c4',
                      color:      enabling ? '#108548' : '#a4661c',
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

                {/* Info banner explaining the consequence */}
                <div style={{ padding: '14px 24px 0' }}>
                  <div
                    className="d-flex align-items-start gap-2"
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

                {/* Footer with full-width action buttons */}
                <div
                  className="d-flex align-items-center gap-2"
                  style={{ padding: '18px 24px 22px' }}
                >
                  <button
                    type="button"
                    onClick={cancelToggle}
                    className="btn fw-semibold rounded-pill flex-grow-1"
                    style={{
                      fontSize: 13.5,
                      background: '#fff',
                      color: '#374151',
                      border: '1px solid #e5e7eb',
                      padding: '10px 18px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmToggle}
                    autoFocus
                    className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold rounded-pill flex-grow-1"
                    style={{
                      fontSize: 13.5,
                      color: '#fff',
                      border: 'none',
                      background: tone.ctaBg,
                      boxShadow: tone.ctaShadow,
                      padding: '10px 18px',
                    }}
                  >
                    <i className={tone.ctaIcon} style={{ fontSize: 16 }} />
                    {tone.ctaLabel}
                  </button>
                </div>
              </>
            );
          })()}
        </ModalBody>
      </Modal>

      {/* ── Add / Edit Employee modal (4-step wizard) ── */}
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
        <style>{`
          .emp-modal-wide .modal-dialog { max-width: min(1280px, 95vw); }
          .emp-modal-wide .modal-content { border-radius: 22px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.18); }
          .emp-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; width: 100%; }
          .emp-input::placeholder { color: #9ca3af; }
          .emp-input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
          .emp-input.is-readonly { background: #f5f1ff; border-color: #d6c9ff; color: #5a3fd1; font-weight: 600; }
          [data-bs-theme="dark"] .emp-input { background: #1c2531; border-color: var(--vz-border-color); color: var(--vz-body-color); }
          [data-bs-theme="dark"] .emp-input::placeholder { color: var(--vz-secondary-color); }
          .emp-label { font-size: 10.5px; font-weight: 700; color: #5a3fd1; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 5px; display: block; }
          [data-bs-theme="dark"] .emp-label { color: #c4b5fd; }
          .emp-label .req { color: #f06548; margin-left: 2px; }
          .emp-label .hint { color: #9ca3af; font-weight: 600; text-transform: none; letter-spacing: 0; margin-left: 4px; font-size: 10px; }
          .emp-section {
            background: #fff;
            border: 1px solid #eef0f4;
            border-radius: 12px;
            padding: 16px 18px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.03);
          }
          [data-bs-theme="dark"] .emp-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
          .emp-section + .emp-section { margin-top: 14px; }
          .emp-section-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; color: var(--vz-heading-color, var(--vz-body-color)); margin-bottom: 14px; }
          .emp-section-title i { color: #7c5cfc; font-size: 16px; }
          .emp-subsection-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #0ab39c; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
          .emp-subsection-title i { font-size: 13px; }
          .emp-stepper-circle {
            width: 32px; height: 32px; border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 13px;
            background: #f1f3f7; color: #9ca3af; border: 2px solid #e5e7eb;
            transition: all .2s ease;
          }
          .emp-stepper-circle.is-active { background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,92,252,0.30); }
          .emp-stepper-circle.is-done { background: #0ab39c; color: #fff; border-color: transparent; }
          .emp-stepper-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #9ca3af; margin-top: 6px; text-align: center; }
          .emp-stepper-label.is-active { color: #5a3fd1; }
          .emp-stepper-label.is-done { color: #0ab39c; }
          .emp-stepper-line { flex: 1; height: 2px; background: #e5e7eb; margin: 0 6px; align-self: flex-start; margin-top: 16px; transition: background .2s ease; }
          .emp-stepper-line.is-done { background: #0ab39c; }
        `}</style>

        <ModalBody className="p-0" style={{ background: 'var(--vz-secondary-bg, #f7f8fc)', borderRadius: 'var(--bs-modal-border-radius, 12px)', overflow: 'hidden' }}>
          {/* Gradient header */}
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
                  <h5 className="fw-bold mb-1 text-white" style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
                    {empMode === 'edit' ? 'Edit Employee' : 'Add Employee'}
                  </h5>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                    {empMode === 'edit'
                      ? `Update details for ${empEditingName || 'this employee'}`
                      : 'Create a new employee record'}
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <span
                  className="badge rounded-pill"
                  style={{
                    background: 'rgba(255,255,255,0.22)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 11,
                    padding: '6px 12px',
                  }}
                >
                  Step {empStep} of 4
                </span>
                <button
                  type="button"
                  onClick={closeEmp}
                  aria-label="Close"
                  className="btn p-0 d-inline-flex align-items-center justify-content-center"
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: 'rgba(255,255,255,0.18)',
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  <i className="ri-close-line" style={{ fontSize: 18 }} />
                </button>
              </div>
            </div>
          </div>

          {/* Stepper */}
          <div style={{ background: '#fff', padding: '16px 28px', borderBottom: '1px solid var(--vz-border-color)' }}>
            <div className="d-flex align-items-start">
              {[
                { n: 1, label: 'Basic Details' },
                { n: 2, label: 'Job Details' },
                { n: 3, label: 'Work Details' },
                { n: 4, label: 'Compensation' },
              ].map((s, idx, arr) => {
                const active = empStep === s.n;
                const done = empStep > s.n;
                return (
                  <div key={s.n} className="d-flex align-items-start" style={{ flex: idx === arr.length - 1 ? '0 0 auto' : '1 1 0' }}>
                    <div className="d-flex flex-column align-items-center" style={{ minWidth: 92 }}>
                      <div className={`emp-stepper-circle${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {done ? <i className="ri-check-line" style={{ fontSize: 16 }} /> : s.n}
                      </div>
                      <div className={`emp-stepper-label${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {s.label}
                      </div>
                    </div>
                    {idx < arr.length - 1 && <div className={`emp-stepper-line${done ? ' is-done' : ''}`} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body — scrollable */}
          <div style={{ padding: '18px 22px', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            {empStep === 1 && (
              <>
                {/* Employee Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-user-line" /> Employee Details
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Work Country</label>
                      <MasterSelect value={eWorkCountry} onChange={setEWorkCountry} options={COUNTRY_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">First Name<span className="req">*</span></label>
                      <input
                        className="emp-input"
                        type="text"
                        placeholder="e.g. Aarav"
                        value={eFirstName}
                        onChange={e => {
                          const v = e.target.value;
                          setEFirstName(v);
                          if (!eDisplayNameTouched) setEDisplayName(`${v} ${eLastName}`.trim());
                        }}
                      />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Middle Name</label>
                      <input className="emp-input" type="text" placeholder="Middle name (optional)" value={eMiddleName} onChange={e => setEMiddleName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Last Name<span className="req">*</span></label>
                      <input
                        className="emp-input"
                        type="text"
                        placeholder="e.g. Kale"
                        value={eLastName}
                        onChange={e => {
                          const v = e.target.value;
                          setELastName(v);
                          if (!eDisplayNameTouched) setEDisplayName(`${eFirstName} ${v}`.trim());
                        }}
                      />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Display Name<span className="req">*</span></label>
                      <input
                        className="emp-input"
                        type="text"
                        placeholder="e.g. Aarav Kale (auto-filled)"
                        value={eDisplayName}
                        onChange={e => { setEDisplayName(e.target.value); setEDisplayNameTouched(true); }}
                      />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Employee Actual Name<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="Full legal name as per records" value={eActualName} onChange={e => setEActualName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Gender<span className="req">*</span></label>
                      <MasterSelect value={eGender} onChange={setEGender} placeholder="Select gender" options={GENDER_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Date of Birth<span className="req">*</span></label>
                      <MasterDatePicker value={eDob} onChange={setEDob} placeholder="dd-mm-yyyy" />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Nationality<span className="req">*</span></label>
                      <MasterSelect value={eNationality} onChange={setENationality} options={NATIONALITY_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Contact & Identity */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-mail-line" /> Contact &amp; Identity
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Personal Email<span className="req">*</span></label>
                      <input className="emp-input" type="email" placeholder="name@enterprise.com" value={eWorkEmail} onChange={e => setEWorkEmail(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Mobile Number<span className="req">*</span></label>
                      <input className="emp-input" type="tel" placeholder="10-digit mobile number" value={eMobile} onChange={e => setEMobile(e.target.value)} />
                    </Col>
                    
                    <Col md={4}>
                      <label className="emp-label">
                        Employee ID<span className="hint">(auto-assigned)</span>
                      </label>
                      <input className="emp-input is-readonly" type="text" value={eEmpId} readOnly placeholder="Auto-assigned on save" />
                    </Col>
                  </Row>
                </div>

                {/* Address Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-map-pin-line" /> Address Details
                  </div>

                  {/* Current address */}
                  <div className="emp-subsection-title">
                    <i className="ri-checkbox-circle-fill" /> Current Address
                  </div>
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <label className="emp-label">Address Line 1<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="House / Flat No., Building, Street" value={eCurAddr1} onChange={e => setECurAddr1(e.target.value)} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Address Line 2</label>
                      <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={eCurAddr2} onChange={e => setECurAddr2(e.target.value)} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">City<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="e.g. Pune" value={eCurCity} onChange={e => setECurCity(e.target.value)} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">State<span className="req">*</span></label>
                      <MasterSelect value={eCurState} onChange={setECurState} placeholder="Select state" options={STATE_OPTIONS} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">Country<span className="req">*</span></label>
                      <MasterSelect value={eCurCountry} onChange={setECurCountry} options={COUNTRY_OPTIONS} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">Pincode<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="6-digit pincode" value={eCurPin} onChange={e => setECurPin(e.target.value)} />
                    </Col>
                  </Row>

                  {/* Permanent address */}
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
                      <label className="emp-label">Address Line 1<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="House / Flat No., Building, Street" value={ePermAddr1} onChange={e => setEPermAddr1(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Address Line 2</label>
                      <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={ePermAddr2} onChange={e => setEPermAddr2(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">City<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="e.g. Pune" value={ePermCity} onChange={e => setEPermCity(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">State<span className="req">*</span></label>
                      <MasterSelect value={ePermState} onChange={setEPermState} placeholder="Select state" options={STATE_OPTIONS} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">Country<span className="req">*</span></label>
                      <MasterSelect value={ePermCountry} onChange={setEPermCountry} options={COUNTRY_OPTIONS} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={3}>
                      <label className="emp-label">Pincode<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="6-digit pincode" value={ePermPin} onChange={e => setEPermPin(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                  </Row>
                </div>
              </>
            )}

            {empStep === 2 && (
              <>
                {/* Employment Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-briefcase-line" /> Employment Details
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Joining Date<span className="req">*</span></label>
                      <MasterDatePicker value={eJoinDate} onChange={setEJoinDate} placeholder="dd-mm-yyyy" />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Department<span className="req">*</span></label>
                      <MasterSelect value={eDept} onChange={setEDept} placeholder="Select department" options={DEPARTMENT_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Designation<span className="req">*</span></label>
                      <MasterSelect value={eDesignation} onChange={setEDesignation} placeholder="Select designation" options={DESIGNATION_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Primary Role<span className="req">*</span></label>
                      <MasterSelect value={ePrimaryRole} onChange={setEPrimaryRole} placeholder="Select role" options={PRIMARY_ROLE_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Ancillary Role <span className="hint">(select multiple)</span></label>
                      <MultiSelectChips
                        value={eAncillaryRole}
                        onChange={setEAncillaryRole}
                        options={ANCILLARY_ROLE_OPTIONS}
                        placeholder="Select one or more roles"
                      />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Work Type<span className="req">*</span></label>
                      <MasterSelect value={eWorkType} onChange={setEWorkType} options={WORK_TYPE_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Organisational Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-building-2-line" /> Organisational Details
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Legal Entity<span className="req">*</span></label>
                      <MasterSelect
                        value={eLegalEntity}
                        onChange={(v) => {
                          setELegalEntity(v);
                          setELocation(LEGAL_ENTITY_TO_LOCATION[v] || '');
                        }}
                        placeholder="Select entity"
                        options={LEGAL_ENTITY_OPTIONS}
                      />
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
                        placeholder="Select a legal entity first"
                      />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Reporting Manager</label>
                      <MasterSelect
                        value={eReportingMgr}
                        onChange={setEReportingMgr}
                        placeholder="Select manager"
                        options={REPORTING_MANAGER_OPTIONS}
                      />
                    </Col>
                  </Row>
                </div>

                {/* Employment Terms */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-file-list-3-line" /> Employment Terms
                  </div>
                  <Row className="g-3">
                    <Col md={6}>
                      <label className="emp-label">Probation Policy<span className="req">*</span></label>
                      <MasterSelect value={eProbationPolicy} onChange={setEProbationPolicy} options={PROBATION_POLICY_OPTIONS} />
                      {eProbationPolicy === CUSTOM_PROBATION_VALUE && (
                        <input
                          className="emp-input mt-2"
                          type="text"
                          placeholder="e.g. 4-month probation, monthly review"
                          value={eCustomProbation}
                          onChange={e => setECustomProbation(e.target.value)}
                          autoFocus
                        />
                      )}
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Notice Period<span className="req">*</span></label>
                      <MasterSelect value={eNoticePeriod} onChange={setENoticePeriod} options={NOTICE_PERIOD_OPTIONS} />
                      {eNoticePeriod === CUSTOM_NOTICE_VALUE && (
                        <input
                          className="emp-input mt-2"
                          type="text"
                          placeholder="e.g. 45 Days, 2 months, etc."
                          value={eCustomNotice}
                          onChange={e => setECustomNotice(e.target.value)}
                          autoFocus
                        />
                      )}
                    </Col>
                  </Row>
                </div>
              </>
            )}

            {empStep === 3 && (
              <>
                {/* Leave & Attendance */}
                <div className="emp-section">
                  <div className="emp-section-title" style={{ color: '#0a8a78' }}>
                    <i className="ri-calendar-2-line" style={{ color: '#0ab39c' }} /> Leave &amp; Attendance
                  </div>
                  <Row className="g-3">
                    <Col md={6}>
                      <label className="emp-label">Leave Plan<span className="req">*</span></label>
                      <MasterSelect value={eLeavePlan} onChange={setELeavePlan} options={LEAVE_PLAN_OPTIONS} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Holiday List<span className="req">*</span></label>
                      <MasterSelect value={eHolidayList} onChange={setEHolidayList} options={HOLIDAY_LIST_OPTIONS} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Attendance Tracking</label>
                      <div
                        className="d-flex align-items-center justify-content-between emp-input"
                        style={{ height: 38, cursor: 'pointer' }}
                        onClick={() => setEAttendanceTracking(v => !v)}
                      >
                        <span style={{ fontSize: 13, color: '#374151' }}>
                          {eAttendanceTracking ? 'Enabled' : 'Disabled'}
                        </span>
                        <button
                          type="button"
                          aria-pressed={eAttendanceTracking}
                          onClick={(e) => { e.stopPropagation(); setEAttendanceTracking(v => !v); }}
                          className="btn p-0 border-0 d-inline-flex align-items-center"
                          style={{
                            width: 36, height: 20, borderRadius: 999,
                            background: eAttendanceTracking ? '#0ab39c' : '#e5e7eb',
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
                              left: eAttendanceTracking ? 19 : 3, transition: 'left .15s ease',
                            }}
                          />
                        </button>
                      </div>
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Shift<span className="req">*</span></label>
                      <MasterSelect value={eShift} onChange={setEShift} options={SHIFT_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Weekly Off<span className="req">*</span></label>
                      <MasterSelect value={eWeeklyOff} onChange={setEWeeklyOff} options={WEEKLY_OFF_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Attendance Number</label>
                      <input className="emp-input" type="text" placeholder="Attendance number" value={eAttendanceNumber} onChange={e => setEAttendanceNumber(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Time Tracking Policy<span className="req">*</span></label>
                      <MasterSelect value={eTimeTracking} onChange={setETimeTracking} options={TIME_TRACKING_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Penalization Policy<span className="req">*</span></label>
                      <MasterSelect value={ePenalizationPolicy} onChange={setEPenalizationPolicy} options={PENALIZATION_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Overtime</label>
                      <MasterSelect value={eOvertime} onChange={setEOvertime} options={OVERTIME_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Expense Policy<span className="req">*</span></label>
                      <MasterSelect value={eExpensePolicy} onChange={setEExpensePolicy} placeholder="Select policy" options={EXPENSE_POLICY_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Assets & Security */}
                <div className="emp-section">
                  <div className="emp-section-title" style={{ color: '#0c63b0' }}>
                    <i className="ri-computer-line" style={{ color: '#299cdb' }} /> Assets &amp; Security
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Laptop Assigned</label>
                      <MasterSelect value={eLaptopAssigned} onChange={setELaptopAssigned} options={LAPTOP_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Laptop Asset ID</label>
                      <input className="emp-input" type="text" placeholder="e.g. LAP-0042" value={eLaptopAssetId} onChange={e => setELaptopAssetId(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Mobile Device</label>
                      <input className="emp-input" type="text" placeholder="e.g. iPhone 15" value={eMobileDevice} onChange={e => setEMobileDevice(e.target.value)} />
                    </Col>
                    <Col md={12}>
                      <label className="emp-label">Other Assets</label>
                      <input className="emp-input" type="text" placeholder="e.g. Monitor, Keyboard, Headset" value={eOtherAssets} onChange={e => setEOtherAssets(e.target.value)} />
                    </Col>
                  </Row>
                </div>

                {/* Documents */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-file-text-line" /> Documents
                  </div>
                  <Row className="g-3">
                    {[
                      { label: 'Aadhar Card',         required: true,  file: eAadharFile, set: setEAadharFile, accept: '.pdf,.jpg,.jpeg,.png',                hint: '' as string },
                      { label: 'Pan Card',            required: true,  file: ePanFile,    set: setEPanFile,    accept: '.pdf,.jpg,.jpeg,.png',                hint: '' as string },
                      { label: 'Passport Size Photo', required: false, file: ePhotoFile,  set: setEPhotoFile,  accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', hint: '(format .jpg, .png)' },
                    ].map(d => (
                      <Col md={4} key={d.label}>
                        <label className="emp-label">
                          {d.label}{d.required && <span className="req">*</span>}
                          {d.hint && <span className="hint">{d.hint}</span>}
                        </label>
                        <label
                          className="d-flex align-items-center justify-content-center gap-2"
                          style={{
                            height: 38,
                            border: '1.5px dashed #a78bfa',
                            borderRadius: 8,
                            background: '#f5f0ff',
                            cursor: 'pointer',
                            color: '#7c5cfc',
                            fontSize: 12.5,
                            fontWeight: 600,
                          }}
                        >
                          <i className="ri-upload-2-line" />
                          {d.file ? d.file.name : 'Choose file'}
                          <input
                            type="file"
                            accept={d.accept}
                            style={{ display: 'none' }}
                            onChange={e => d.set(e.target.files?.[0] || null)}
                          />
                        </label>
                      </Col>
                    ))}
                  </Row>
                </div>
              </>
            )}

            {empStep === 4 && (
              <>
                {/* Payroll Configuration */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-money-dollar-circle-line" /> Payroll Configuration
                  </div>
                  <div
                    className="d-flex align-items-center gap-2 mb-3"
                    style={{
                      padding: '10px 14px',
                      border: '1px solid #b6e9d9',
                      background: 'linear-gradient(135deg, #ddf5ec, #c7efde)',
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
                        background: eEnablePayroll ? '#0ab39c' : '#e5e7eb',
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0a8a78' }}>
                      Enable payroll for this employee
                    </span>
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Pay Group</label>
                      <MasterSelect value={ePayGroup} onChange={setEPayGroup} options={PAY_GROUP_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Annual Salary</label>
                      <div className="d-flex gap-2">
                        <input className="emp-input" type="number" placeholder="Enter amount" value={eAnnualSalary} onChange={e => setEAnnualSalary(e.target.value)} style={{ flex: 1 }} />
                        <div style={{ width: 130, flexShrink: 0 }}>
                          <MasterSelect value={eSalaryFreq} onChange={setESalaryFreq} options={SALARY_FREQUENCY_OPTIONS} />
                        </div>
                      </div>
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Salary Effective From</label>
                      <MasterDatePicker value={eSalaryFrom} onChange={setESalaryFrom} placeholder="dd-mm-yyyy" />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Salary Structure Type</label>
                      <MasterSelect value={eSalaryStructure} onChange={setESalaryStructure} options={SALARY_STRUCTURE_OPTIONS} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Tax Regime</label>
                      <MasterSelect value={eTaxRegime} onChange={setETaxRegime} options={TAX_REGIME_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Bonus, Perks & Payroll Settings */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-gift-line" style={{ color: '#7c5cfc' }} /> Bonus, Perks &amp; Payroll Settings
                  </div>
                  <div
                    className="d-flex align-items-center gap-2 mb-3"
                    style={{ padding: '8px 12px', border: '1px solid var(--vz-border-color)', borderRadius: 8 }}
                  >
                    <input
                      type="checkbox"
                      id="bonus-in-annual"
                      className="form-check-input m-0"
                      checked={eBonusInAnnual}
                      onChange={e => setEBonusInAnnual(e.target.checked)}
                    />
                    <label htmlFor="bonus-in-annual" className="mb-0" style={{ fontSize: 13, cursor: 'pointer' }}>
                      Bonus included in annual salary
                    </label>
                  </div>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <button
                      type="button"
                      className="btn d-inline-flex align-items-center gap-1 fw-semibold"
                      style={{
                        fontSize: 12.5,
                        padding: '6px 14px',
                        borderRadius: 8,
                        background: '#fff',
                        color: '#7c5cfc',
                        border: '1px dashed #a78bfa',
                      }}
                    >
                      <i className="ri-add-line" /> Add Bonus
                    </button>
                    <button
                      type="button"
                      className="btn d-inline-flex align-items-center gap-1 fw-semibold"
                      style={{
                        fontSize: 12.5,
                        padding: '6px 14px',
                        borderRadius: 8,
                        background: '#fff',
                        color: '#0ab39c',
                        border: '1px dashed #2dd4bf',
                      }}
                    >
                      <i className="ri-add-line" /> Add Perks
                    </button>
                  </div>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      id="pf-eligible"
                      className="form-check-input m-0"
                      checked={ePfEligible}
                      onChange={e => setEPfEligible(e.target.checked)}
                    />
                    <label htmlFor="pf-eligible" className="mb-0" style={{ fontSize: 13, cursor: 'pointer' }}>
                      Provident Fund (PF) Eligible
                    </label>
                  </div>
                  <div
                    className="d-flex align-items-center gap-2"
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: '#f5f0ff',
                      border: '1px solid #d6c9ff',
                      color: '#5a3fd1',
                      fontSize: 12.5,
                    }}
                  >
                    <i className="ri-information-line" />
                    ESi is not applicable for the selected Pay Group
                  </div>
                </div>

                {/* Salary Breakup */}
                <div className="emp-section">
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                    <div className="emp-section-title mb-0">
                      <i className="ri-calculator-line" style={{ color: '#0c63b0' }} /> Salary Breakup
                    </div>
                    <label className="d-inline-flex align-items-center gap-2 mb-0" style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)', cursor: 'pointer' }}>
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
                      Detailed breakup
                    </label>
                  </div>
                  <div className="emp-label mb-1">Salary Effective From</div>
                  <div className="text-muted mb-3" style={{ fontSize: 13 }}>
                    {eSalaryFrom ? eSalaryFrom : '—'}
                  </div>
                  <div
                    className="d-flex align-items-center justify-content-between flex-wrap"
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #eef0f4',
                      borderRadius: 10,
                      padding: '14px 16px',
                      gap: 12,
                    }}
                  >
                    <div className="text-center" style={{ flex: 1 }}>
                      <div className="emp-label mb-1">Regular Salary</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937' }}>
                        INR {Number(eAnnualSalary || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, color: '#9ca3af' }}>+</div>
                    <div className="text-center" style={{ flex: 1 }}>
                      <div className="emp-label mb-1">Bonus</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937' }}>INR 0</div>
                    </div>
                    <div style={{ fontSize: 18, color: '#9ca3af' }}>=</div>
                    <div className="text-center" style={{ flex: 1, background: '#f5f0ff', borderRadius: 8, padding: '6px 8px' }}>
                      <div className="emp-label mb-1" style={{ color: '#5a3fd1' }}>Total CTC</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#5a3fd1' }}>
                        INR {Number(eAnnualSalary || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div
            className="d-flex align-items-center justify-content-between gap-2 flex-wrap"
            style={{
              padding: '14px 22px',
              background: '#fff',
              borderTop: '1px solid var(--vz-border-color)',
            }}
          >
            {/* Left side — Back button (steps 2+) */}
            {empStep > 1 ? (
              <button
                type="button"
                onClick={() => setEmpStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
                className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                style={{
                  fontSize: 13,
                  background: '#fff',
                  color: 'var(--vz-secondary-color)',
                  border: '1px solid var(--vz-border-color)',
                }}
              >
                <i className="ri-arrow-left-s-line" /> Back
              </button>
            ) : (
              <span />
            )}

            {/* Right side — Next (steps 1-3) or Skip + Save (step 4) */}
            <div className="d-flex align-items-center gap-2">
              {empStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setEmpStep((s) => ((s + 1) as 1 | 2 | 3 | 4))}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                  style={{
                    fontSize: 13,
                    color: '#fff',
                    border: 'none',
                    background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                    boxShadow: '0 6px 16px rgba(124,92,252,0.30)',
                  }}
                >
                  Next <i className="ri-arrow-right-s-line" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      // TODO: wire to backend — save without compensation
                      closeEmp();
                    }}
                    className="btn fw-semibold rounded-pill px-3"
                    style={{
                      fontSize: 13,
                      background: '#fff',
                      color: 'var(--vz-secondary-color)',
                      border: '1px solid var(--vz-border-color)',
                    }}
                  >
                    Skip this Step
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // TODO: wire to backend — create / update employee
                      closeEmp();
                    }}
                    className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                    style={{
                      fontSize: 13,
                      color: '#fff',
                      border: 'none',
                      background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                      boxShadow: '0 6px 16px rgba(10,179,156,0.30)',
                    }}
                  >
                    <i className="ri-check-line" /> Save Employee
                  </button>
                </>
              )}
            </div>
          </div>
        </ModalBody>
      </Modal>

      {/* ── Assign Assets modal (per-row Workstation icon) — master-form style ── */}
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
        <style>{`
          .assign-tabs { display: flex; gap: 24px; padding: 0 24px; border-bottom: 1px solid var(--vz-border-color); }
          .assign-tab-btn {
            background: transparent; border: none; padding: 12px 0; cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 13px; font-weight: 600; color: var(--vz-secondary-color);
            border-bottom: 2px solid transparent;
            transition: color .15s ease, border-color .15s ease;
          }
          .assign-tab-btn:hover { color: #6366f1; }
          .assign-tab-btn.is-active { color: #6366f1; border-bottom-color: #6366f1; }
          .assign-section-title {
            display: inline-flex; align-items: center; gap: 10px;
            font-size: 13.5px; font-weight: 700;
            color: var(--vz-heading-color, var(--vz-body-color));
            letter-spacing: 0.02em;
          }
          .assign-section-title i { color: #6366f1; font-size: 16px; }
          .assign-error {
            display: flex; align-items: center; gap: 4px;
            color: #f06548; font-size: 12px; margin-top: 6px;
          }
          .assign-error i { font-size: 13px; }
          .assign-save-btn {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 10px 22px; border-radius: 999px;
            font-size: 13.5px; font-weight: 600; color: #fff;
            border: none;
            background: linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #7c5cfc 100%);
            box-shadow: 0 8px 18px rgba(99,102,241,0.30);
            transition: transform .15s ease, box-shadow .15s ease;
          }
          .assign-save-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 22px rgba(99,102,241,0.38); }
        `}</style>

        <ModalBody className="p-0">
          {/* Header — indigo/violet gradient with white icon & text. Mirrors the
              "Add Department" recipe shared by the user. */}
          <div
            style={{
              padding: '22px 26px',
              background: 'linear-gradient(120deg, #5b3fd1 0%, #6366f1 55%, #7c5cfc 100%)',
              color: '#fff',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Decorative bubble (top-right) */}
            <div style={{
              position: 'absolute', top: -50, right: -40, width: 220, height: 220,
              borderRadius: '50%', background: 'rgba(255,255,255,0.10)',
            }} />
            <div className="d-flex align-items-center justify-content-between gap-3" style={{ position: 'relative' }}>
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'rgba(255,255,255,0.22)',
                    border: '1px solid rgba(255,255,255,0.30)',
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
              <button
                type="button"
                onClick={closeAssign}
                aria-label="Close"
                className="btn p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.22)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#fff',
                }}
              >
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="assign-tabs">
            {[
              { key: 'it'       as const, label: 'IT Assets', icon: 'ri-computer-line' },
              { key: 'security' as const, label: 'Security',  icon: 'ri-lock-2-line' },
              { key: 'hr'       as const, label: 'HR Record', icon: 'ri-file-text-line' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setAssignTab(t.key)}
                className={`assign-tab-btn${assignTab === t.key ? ' is-active' : ''}`}
              >
                <i className={t.icon} style={{ fontSize: 15 }} /> {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px 8px' }}>
            {assignTab === 'it' && (
              <>
                <div className="assign-section-title mb-3">
                  <i className="ri-computer-line" /> Assets &amp; Security
                </div>
                <Row className="g-3">
                  <Col md={4}>
                    <label htmlFor="a-laptop">Laptop Assigned</label>
                    <MasterSelect
                      value={aLaptopAssigned}
                      onChange={setALaptopAssigned}
                      options={[
                        { value: 'Yes', label: 'Yes' },
                        { value: 'No', label: 'No' },
                        { value: 'Pending', label: 'Pending' },
                      ]}
                    />
                  </Col>
                  <Col md={4}>
                    <label htmlFor="a-laptop-id">
                      Laptop Asset ID
                      {aLaptopAssigned === 'Yes' && <span className="req-star">*</span>}
                    </label>
                    <div className="master-field">
                      <i className="ri-hashtag master-field-icon" />
                      <Input
                        id="a-laptop-id"
                        type="text"
                        placeholder="e.g. LAP-0042"
                        value={aLaptopAssetId}
                        onChange={e => { setALaptopAssetId(e.target.value); clearAssignError('laptopAssetId'); }}
                        invalid={!!assignErrors.laptopAssetId}
                      />
                    </div>
                    {assignErrors.laptopAssetId && (
                      <div className="assign-error"><i className="ri-error-warning-line" />{assignErrors.laptopAssetId}</div>
                    )}
                  </Col>
                  <Col md={4}>
                    <label htmlFor="a-mobile">Mobile Device</label>
                    <div className="master-field">
                      <i className="ri-smartphone-line master-field-icon" />
                      <Input
                        id="a-mobile"
                        type="text"
                        placeholder="e.g. iPhone 15"
                        value={aMobileDevice}
                        onChange={e => { setAMobileDevice(e.target.value); clearAssignError('mobileDevice'); }}
                        invalid={!!assignErrors.mobileDevice}
                      />
                    </div>
                    {assignErrors.mobileDevice && (
                      <div className="assign-error"><i className="ri-error-warning-line" />{assignErrors.mobileDevice}</div>
                    )}
                  </Col>
                  <Col md={12}>
                    <label htmlFor="a-other">Other Assets</label>
                    <div className="master-field">
                      <i className="ri-archive-line master-field-icon" />
                      <Input
                        id="a-other"
                        type="text"
                        placeholder="e.g. Monitor, Keyboard, Headset"
                        value={aOtherAssets}
                        onChange={e => setAOtherAssets(e.target.value)}
                      />
                    </div>
                  </Col>
                </Row>
              </>
            )}

            {assignTab === 'security' && (
              <>
                <div className="assign-section-title mb-3">
                  <i className="ri-lock-2-line" /> Security &amp; Access
                </div>
                <Row className="g-3">
                  <Col md={6}>
                    <label htmlFor="a-card">Access Card</label>
                    <div className="master-field">
                      <i className="ri-bank-card-line master-field-icon" />
                      <Input
                        id="a-card"
                        type="text"
                        placeholder="e.g. AC-8821"
                        value={aAccessCard}
                        onChange={e => { setAAccessCard(e.target.value); clearAssignError('accessCard'); }}
                        invalid={!!assignErrors.accessCard}
                      />
                    </div>
                    {assignErrors.accessCard && (
                      <div className="assign-error"><i className="ri-error-warning-line" />{assignErrors.accessCard}</div>
                    )}
                  </Col>
                  <Col md={6}>
                    <label>Security Level</label>
                    <MasterSelect
                      value={aSecurityLevel}
                      onChange={setASecurityLevel}
                      options={[
                        { value: 'Level 1 — Basic', label: 'Level 1 — Basic' },
                        { value: 'Level 2 — Standard', label: 'Level 2 — Standard' },
                        { value: 'Level 3 — Privileged', label: 'Level 3 — Privileged' },
                        { value: 'Level 4 — Admin', label: 'Level 4 — Admin' },
                      ]}
                    />
                  </Col>
                  <Col md={12}>
                    <label>VPN / Remote Access</label>
                    <MasterSelect
                      value={aVpnAccess}
                      onChange={setAVpnAccess}
                      options={[
                        { value: 'Not Required', label: 'Not Required' },
                        { value: 'Standard VPN', label: 'Standard VPN' },
                        { value: 'Privileged VPN', label: 'Privileged VPN' },
                        { value: 'Always-On VPN', label: 'Always-On VPN' },
                      ]}
                    />
                  </Col>
                </Row>
              </>
            )}

            {assignTab === 'hr' && (
              <>
                <div className="assign-section-title mb-3">
                  <i className="ri-file-text-line" /> HR Record Notes
                </div>
                <Row className="g-3">
                  <Col md={6}>
                    <label>Issue Date<span className="req-star">*</span></label>
                    <MasterDatePicker
                      value={aIssueDate}
                      onChange={(v) => { setAIssueDate(v); clearAssignError('issueDate'); }}
                      placeholder="dd-mm-yyyy"
                      invalid={!!assignErrors.issueDate}
                    />
                    {assignErrors.issueDate && (
                      <div className="assign-error"><i className="ri-error-warning-line" />{assignErrors.issueDate}</div>
                    )}
                  </Col>
                  <Col md={6}>
                    <label htmlFor="a-issued-by">Issued By<span className="req-star">*</span></label>
                    <div className="master-field">
                      <i className="ri-user-line master-field-icon" />
                      <Input
                        id="a-issued-by"
                        type="text"
                        placeholder="Manager name"
                        value={aIssuedBy}
                        onChange={e => { setAIssuedBy(e.target.value); clearAssignError('issuedBy'); }}
                        invalid={!!assignErrors.issuedBy}
                      />
                    </div>
                    {assignErrors.issuedBy && (
                      <div className="assign-error"><i className="ri-error-warning-line" />{assignErrors.issuedBy}</div>
                    )}
                  </Col>
                  <Col md={12}>
                    <label htmlFor="a-notes">Notes</label>
                    <div className="master-field ta">
                      <i className="ri-chat-3-line master-field-icon" />
                      <Input
                        id="a-notes"
                        type="textarea"
                        rows={3}
                        placeholder="Additional notes about asset assignment…"
                        value={aNotes}
                        onChange={e => setANotes(e.target.value)}
                      />
                    </div>
                  </Col>
                </Row>
              </>
            )}
          </div>

          {/* Footer — required-fields hint on the left, action buttons on the right */}
          <div
            className="d-flex align-items-center justify-content-between gap-2 flex-wrap"
            style={{ padding: '14px 24px 18px', borderTop: '1px solid var(--vz-border-color)' }}
          >
            <span className="d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: 12.5 }}>
              <i className="ri-information-line" style={{ fontSize: 14 }} />
              Fields marked <span style={{ color: '#f06548', fontWeight: 700, margin: '0 2px' }}>*</span> are required
            </span>
            <div className="d-flex align-items-center gap-2">
              <Button onClick={closeAssign} className="master-modal-cancel d-inline-flex align-items-center gap-1">
                <i className="ri-close-line" style={{ fontSize: 15 }} /> Cancel
              </Button>
              <button type="button" onClick={handleSaveAssign} className="assign-save-btn">
                <i className="ri-save-line" style={{ fontSize: 16 }} />
                Save Assets
              </button>
            </div>
          </div>
        </ModalBody>
      </Modal>

      {/* ── Evidence Vault modal (per-row Documents / PDF icon) ── */}
      {(() => {
        // Pre-compute KPIs across the catalogue so the strip stays in sync if
        // the mock data ever changes (no manual counting required).
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
        // Mock vault completion percent = (verified + signed) / total.
        const completion = counts.total ? Math.round(((counts.verified + counts.signed) / counts.total) * 100) : 0;
        const sections = vaultTab === 'employee' ? VAULT_EMPLOYEE_DOCS : VAULT_ORG_DOCS;

        return (
          <Modal
            isOpen={vaultOpen}
            toggle={closeVault}
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
              .vault-pill {
                display: inline-flex; align-items: center; padding: 4px 12px;
                border-radius: 999px; font-size: 11.5px; font-weight: 600;
                background: rgba(255,255,255,0.18); color: #fff;
              }
              .vault-kpi-card {
                background: #ffffff;
                border-radius: 16px;
                padding: 20px 20px 16px;
                box-shadow: 0 2px 20px rgba(0,0,0,0.06);
                border: 1px solid var(--vz-border-color);
                position: relative;
                overflow: hidden;
                height: 100%;
              }
              [data-bs-theme="dark"] .vault-kpi-card { background: #1c2531; }
              .vault-kpi-card .vault-kpi-strip { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
              .vault-kpi-card .vault-kpi-icon {
                width: 46px; height: 46px; border-radius: 12px;
                display: flex; align-items: center; justify-content: center; flex-shrink: 0;
              }
              .vault-kpi-card .vault-kpi-icon i { color: #fff; font-size: 20px; }
              .vault-kpi-card .vault-kpi-label {
                font-size: 11px; font-weight: 700;
                color: var(--vz-secondary-color);
                letter-spacing: 0.06em; text-transform: uppercase;
                margin: 0 0 10px;
              }
              .vault-kpi-card .vault-kpi-num {
                font-size: 28px; font-weight: 800; line-height: 1; margin: 0;
                color: var(--vz-heading-color, var(--vz-body-color));
              }
              .vault-tab-btn {
                background: transparent; border: none; padding: 12px 18px;
                font-size: 13.5px; font-weight: 600; color: var(--vz-secondary-color);
                display: inline-flex; align-items: center; gap: 6px;
                border-bottom: 2px solid transparent;
                transition: color .15s ease, border-color .15s ease;
              }
              .vault-tab-btn:hover { color: #5a3fd1; }
              .vault-tab-btn.is-active { color: #5a3fd1; border-bottom-color: #7c5cfc; }
              .vault-tab-count {
                display: inline-flex; align-items: center; justify-content: center;
                min-width: 22px; height: 18px; padding: 0 6px;
                border-radius: 999px; background: var(--vz-light); color: var(--vz-secondary-color);
                font-size: 10.5px; font-weight: 700;
              }
              .vault-tab-btn.is-active .vault-tab-count { background: #ece6ff; color: #5a3fd1; }
              .vault-doc-row {
                display: flex; align-items: center; gap: 14px; padding: 14px 4px;
                border-bottom: 1px solid var(--vz-border-color);
              }
              .vault-doc-row:last-child { border-bottom: none; }
              .vault-doc-icon {
                width: 40px; height: 40px; border-radius: 10px;
                display: inline-flex; align-items: center; justify-content: center;
                font-size: 20px; flex-shrink: 0;
              }
              .vault-doc-meta { min-width: 0; flex: 1; }
              .vault-doc-name { font-size: 14px; font-weight: 700; color: var(--vz-heading-color, var(--vz-body-color)); }
              .vault-doc-desc { font-size: 12px; color: var(--vz-secondary-color); margin-top: 2px; }
              .vault-status-pill {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 4px 10px; border-radius: 999px;
                font-size: 11px; font-weight: 600;
              }
              .vault-status-dot { width: 6px; height: 6px; border-radius: 50%; }
              .vault-action-view {
                display: inline-flex; align-items: center; gap: 5px;
                padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
                background: #fff; color: #374151; border: 1px solid #e5e7eb;
                transition: border-color .15s ease, color .15s ease;
              }
              .vault-action-view:hover { color: #5a3fd1; border-color: #c4b5fd; }
              .vault-action-download {
                display: inline-flex; align-items: center; gap: 5px;
                padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
                background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border: none;
                box-shadow: 0 4px 10px rgba(124,92,252,0.25);
              }
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
                <div style={{
                  position: 'absolute', top: -50, right: -40, width: 220, height: 220,
                  borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
                }} />
                <div className="d-flex align-items-start justify-content-between gap-3" style={{ position: 'relative' }}>
                  <div className="d-flex align-items-start gap-3 min-w-0">
                    <div
                      className="d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: 'rgba(255,255,255,0.22)',
                      }}
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
                      {vaultEmp && (
                        <div className="d-flex flex-wrap gap-2">
                          <span className="vault-pill">{vaultEmp.id}</span>
                          <span className="vault-pill">{vaultEmp.name}</span>
                          <span className="vault-pill">{vaultEmp.department}</span>
                          <span className="vault-pill">{vaultEmp.designation}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="d-flex align-items-start gap-3 flex-shrink-0">
                    {/* Status ring */}
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
                          style={{
                            width: 50, height: 50, borderRadius: '50%',
                            background: '#5b3fd1', color: '#fff', fontSize: 14,
                          }}
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
                      onClick={closeVault}
                      aria-label="Close"
                      className="btn p-0 d-inline-flex align-items-center justify-content-center"
                      style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: 'rgba(255,255,255,0.20)', border: 'none', color: '#fff',
                      }}
                    >
                      <i className="ri-close-line" style={{ fontSize: 18 }} />
                    </button>
                  </div>
                </div>
              </div>

              {/* KPI strip — dashboard-style cards (gradient top + gradient icon tile) */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--vz-border-color)' }}>
                <Row className="g-3 align-items-stretch">
                  {[
                    { key: 'total',    label: 'Total Docs',     value: counts.total,    icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
                    { key: 'verified', label: 'Verified',       value: counts.verified, icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
                    { key: 'signed',   label: 'Signed',         value: counts.signed,   icon: 'ri-quill-pen-line',       gradient: 'linear-gradient(135deg,#5e4dd6,#9b7dff)' },
                    { key: 'pending',  label: 'Pending',        value: counts.pending,  icon: 'ri-time-line',             gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
                    { key: 'notgen',   label: 'Not Generated',  value: counts.notGen,   icon: 'ri-close-circle-line',     gradient: 'linear-gradient(135deg,#878a99,#b9bbc6)' },
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
                  className={`vault-tab-btn${vaultTab === 'employee' ? ' is-active' : ''}`}
                  onClick={() => setVaultTab('employee')}
                >
                  <i className="ri-user-line" /> Employee Documents
                  <span className="vault-tab-count">{empCount}</span>
                </button>
                <button
                  type="button"
                  className={`vault-tab-btn${vaultTab === 'organizational' ? ' is-active' : ''}`}
                  onClick={() => setVaultTab('organizational')}
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
                        style={{
                          padding: '4px 12px', borderRadius: 999,
                          background: '#f5f0ff', color: '#5a3fd1',
                          fontSize: 11.5, fontWeight: 600,
                        }}
                      >
                        {section.docs.length} docs
                      </span>
                    </div>
                    <div>
                      {section.docs.map(doc => {
                        const tone = VAULT_STATUS_TONE[doc.status];
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
                                style={{
                                  padding: '4px 10px', borderRadius: 999,
                                  background: '#eef2f6', color: '#475569',
                                  fontSize: 11, fontWeight: 600,
                                }}
                              >
                                {doc.category}
                              </span>
                            )}
                            <span className="vault-status-pill" style={{ background: tone.bg, color: tone.fg }}>
                              <span className="vault-status-dot" style={{ background: tone.dot }} />
                              {doc.status}
                            </span>
                            <button type="button" className="vault-action-view" onClick={() => { /* TODO: view doc */ }}>
                              <i className="ri-eye-line" /> View
                            </button>
                            <button type="button" className="vault-action-download" onClick={() => { /* TODO: download doc */ }}>
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
      })()}
    </>
  );
}

// Outline icon-pill action button — same recipe as Clients.tsx ActionBtn so
// the table actions read identically across both pages.
function ActionBtn({
  title, icon, color, onClick, disabled,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        transition: 'all .15s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );
}

// Animated KPI counter — same recipe as the admin / client / branch dashboards
// so the HR Employee KPIs count up on first paint instead of snapping to value.
// Multi-select chips — toggle-style dropdown that shows the selected values
// as removable pills inside the toggle, and a checkbox list when opened.
// Used by the Ancillary Role field in Step 2 of the Add/Edit Employee form.
function MultiSelectChips({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / ESC.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleVal = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };
  const remove = (v: string) => onChange(value.filter(x => x !== v));

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <style>{`
        .mschips-toggle {
          width: 100%; min-height: 38px;
          padding: 5px 36px 5px 10px;
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          background: var(--vz-card-bg);
          font-size: 13px;
          color: var(--vz-heading-color, var(--vz-body-color));
          cursor: pointer;
          display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
          position: relative;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .mschips-toggle:hover:not(.is-disabled) { border-color: rgba(99,102,241,0.55); }
        .mschips-toggle.is-open { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        .mschips-toggle.is-disabled { background: var(--vz-secondary-bg); cursor: not-allowed; opacity: 0.85; }
        .mschips-placeholder { color: var(--vz-secondary-color); opacity: 0.65; font-weight: 400; padding: 3px 0; }
        .mschips-chev { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--vz-secondary-color); font-size: 16px; pointer-events: none; transition: transform .2s ease; }
        .mschips-toggle.is-open .mschips-chev { transform: translateY(-50%) rotate(180deg); color: #6366f1; }
        .mschips-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 999px;
          background: rgba(99,102,241,0.10);
          color: #6366f1;
          font-size: 12px; font-weight: 600;
        }
        .mschips-chip-x {
          border: none; background: transparent; padding: 0;
          color: #6366f1; cursor: pointer; line-height: 1;
          display: inline-flex; align-items: center;
        }
        .mschips-chip-x:hover { color: #f06548; }
        .mschips-menu {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1500;
          background-color: #ffffff !important;
          background-image: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          opacity: 1 !important;
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          box-shadow: 0 14px 30px rgba(18,38,63,0.18), 0 2px 8px rgba(18,38,63,0.06);
          padding: 6px;
          max-height: 220px; overflow-y: auto;
        }
        [data-bs-theme="dark"] .mschips-menu,
        [data-layout-mode="dark"] .mschips-menu {
          background-color: #2a2f34 !important;
          border-color: rgba(255,255,255,0.08);
        }
        .mschips-item {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: 6px;
          font-size: 13px; cursor: pointer;
          transition: background .15s ease;
        }
        .mschips-item:hover { background: var(--vz-secondary-bg); }
        .mschips-item.is-on { background: rgba(99,102,241,0.10); color: #6366f1; font-weight: 600; }
        .mschips-check { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--vz-border-color); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .mschips-item.is-on .mschips-check { background: #6366f1; border-color: #6366f1; color: #fff; }
      `}</style>

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={`mschips-toggle${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
      >
        {value.length === 0 && <span className="mschips-placeholder">{placeholder}</span>}
        {value.map(v => {
          const opt = options.find(o => o.value === v);
          return (
            <span key={v} className="mschips-chip">
              {opt?.label || v}
              {!disabled && (
                <button
                  type="button"
                  className="mschips-chip-x"
                  onClick={(e) => { e.stopPropagation(); remove(v); }}
                  aria-label={`Remove ${opt?.label || v}`}
                >
                  <i className="ri-close-line" style={{ fontSize: 14 }} />
                </button>
              )}
            </span>
          );
        })}
        <i className="ri-arrow-down-s-line mschips-chev" />
      </div>

      {open && !disabled && (
        <div className="mschips-menu">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-muted" style={{ fontSize: 12 }}>No options</div>
          ) : options.map(opt => {
            const on = value.includes(opt.value);
            return (
              <div
                key={opt.value}
                className={`mschips-item${on ? ' is-on' : ''}`}
                onClick={() => toggleVal(opt.value)}
              >
                <span className="mschips-check">
                  {on && <i className="ri-check-line" style={{ fontSize: 12 }} />}
                </span>
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

// Local toggle — simple, controlled per row. Bound only to mock state for now.
// `onRequestToggle` lets the parent gate the change behind a confirmation: it
// receives the desired next state and a `commit` callback that flips the local
// state when (and only when) the parent says so.
function ToggleSwitch({
  initial,
  onRequestToggle,
}: {
  initial: boolean;
  onRequestToggle?: (next: boolean, commit: () => void) => void;
}) {
  const [on, setOn] = useState(initial);
  const commit = () => setOn(v => !v);
  const handleClick = () => {
    if (onRequestToggle) onRequestToggle(!on, commit);
    else commit();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={on}
      className="btn p-0 border-0 d-inline-flex align-items-center"
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? '#0ab39c' : '#e5e7eb',
        border: 'none',
        position: 'relative',
        marginLeft: 4,
        transition: 'background .15s ease',
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
