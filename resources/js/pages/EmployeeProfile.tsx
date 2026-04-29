import { useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody } from 'reactstrap';

// Standalone employee profile — opens when an employee row is clicked in the
// HR directory. Mirrors ClientView/BranchView styling (indigo gradient hero +
// 20px-radius info cards + soft shadows) and exposes 5 tabs:
// Profile Details · Job Details · Attendance · Evidence Vault · Payroll Details.

export interface EmployeeProfileTarget {
  id: string;
  name: string;
  email: string;
  initials?: string;
  accent?: string;
  department?: string;
  designation?: string;
  primaryRole?: string;
  ancillaryRole?: string | string[] | null;
  manager?: string;
  profile?: number;
  onboarding?: 'Completed' | 'In Progress' | 'Pending';
  status?: 'active' | 'on_leave' | 'high_attention' | 'probation' | 'inactive';
  enabled?: boolean;
}

interface Props {
  employeeId: string;
  employee?: EmployeeProfileTarget;
  onBack: () => void;
}

type TabKey = 'profile' | 'job' | 'attendance' | 'vault' | 'payroll' | 'expense';
type PayrollTab = 'summary' | 'details';
type VaultTab = 'employee' | 'organizational';
type ExpenseFilter = 'all' | 'approved' | 'rejected' | 'pending';

const GRAD_PRIMARY = 'linear-gradient(135deg, #405189 0%, #6691e7 100%)';
const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
const GRAD_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
const GRAD_INFO    = 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)';
const GRAD_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';
const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--vz-border-color)',
  boxShadow: '0 4px 24px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  background: 'var(--vz-card-bg)',
  overflow: 'hidden',
  position: 'relative',
  transition: 'transform .25s ease, box-shadow .25s ease',
};

// Section card wrapper — adds a top gradient strip and a hover lift to any
// content card. The gradient is the same colour family as the section header
// icon, so each section has a distinct visual identity (Personal=indigo,
// Contact=blue, Address=green, etc.).
function SectionCard({ gradient, children, className }: { gradient: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`ep-section-card mb-0 ${className || ''}`} style={cardStyle}>
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: gradient, zIndex: 1,
        }}
      />
      {children}
    </Card>
  );
}

function SectionHeader({ title, gradient, icon, action, subtitle }: { title: string; gradient: string; icon: string; action?: React.ReactNode; subtitle?: string }) {
  return (
    <div className="d-flex align-items-center gap-3 mb-3 pb-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
        style={{ width: 40, height: 40, background: gradient, boxShadow: '0 6px 14px rgba(64,81,137,0.22)' }}
      >
        <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
      </span>
      <div className="flex-grow-1 min-w-0">
        <h5 className="card-title mb-0">{title}</h5>
        {subtitle && <small className="text-muted">{subtitle}</small>}
      </div>
      {action}
    </div>
  );
}

// Single label / value field — rendered as a clean key/value row with a small
// colored accent dot. The accent dot's color comes from the parent section so
// every field nests visually under its section header.
function Field({ label, value, span = 6, accent = '#6366f1' }: { label: string; value?: React.ReactNode; span?: number; accent?: string }) {
  return (
    <Col md={span as any} className="mb-3">
      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 0 3px ${accent}22`, flexShrink: 0 }} />
        <p className="mb-0 fs-11 text-uppercase fw-bold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.08em' }}>
          {label}
        </p>
      </div>
      <div className="fs-14 fw-bold ps-3" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.4 }}>
        {value || <span className="text-muted fw-normal">—</span>}
      </div>
    </Col>
  );
}

function MiniInfo({ icon, label, value, gradient }: { icon: string; label: string; value: React.ReactNode; gradient: string }) {
  return (
    <div
      className="d-flex align-items-center p-3 h-100"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))',
        border: '1px solid var(--vz-border-color)',
      }}
    >
      <div className="flex-shrink-0 me-3">
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle"
          style={{ width: 40, height: 40, background: gradient, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}
        >
          <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
        </span>
      </div>
      <div className="flex-grow-1 overflow-hidden">
        <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>
          {label}
        </p>
        <h6 className="text-truncate mb-0">{value || '—'}</h6>
      </div>
    </div>
  );
}

// Generic KPI tile — same recipe as the admin/client/branch dashboard
// `KpiCard` so every tile across the app reads consistently. The `tint` prop
// is accepted for backwards compatibility but ignored; the card always uses
// var(--vz-card-bg) and the gradient lives on the top strip + icon tile.
function KpiTile({ label, value, sub, icon, gradient }: { label: string; value: React.ReactNode; sub?: string; icon: string; gradient: string; tint?: string }) {
  return (
    <div
      className="dashboard-surface"
      style={{
        borderRadius: 16,
        padding: '20px 20px 16px',
        boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
        border: '1px solid var(--vz-border-color)',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        background: 'var(--vz-card-bg)',
      }}
    >
      {/* Gradient top strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            {label}
          </p>
          <h3 style={{ fontSize: 28, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
            {value}
          </h3>
          {sub && <small className="text-muted d-block mt-2">{sub}</small>}
        </div>
        <div style={{
          width: 46, height: 46, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
        }}>
          <i className={icon} style={{ fontSize: 20, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

// Mock attendance history rows used inside the Attendance tab.
const ATTENDANCE_HISTORY = [
  { date: '21 Apr', day: 'Mon', shift: 'EARLY',   firstIn: '07:01', lastOut: '16:02', punches: 2, worked: '9h 01m', deviation: '+0h 01m', status: 'Present' },
  { date: '20 Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '19 Apr', day: 'Sat', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '18 Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:15', lastOut: '18:20', punches: 4, worked: '9h 05m', deviation: '+0h 05m', status: 'Present' },
  { date: '17 Apr', day: 'Thu', shift: 'GENERAL', firstIn: '10:02', lastOut: '19:15', punches: 4, worked: '9h 13m', deviation: '+0h 13m', status: 'Late' },
  { date: '16 Apr', day: 'Wed', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '15 Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:10', lastOut: '18:10', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '14 Apr', day: 'Mon', shift: 'GENERAL', firstIn: '09:05', lastOut: '18:07', punches: 4, worked: '9h 02m', deviation: '+0h 02m', status: 'Present' },
  { date: '13 Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '11 Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '10 Apr', day: 'Thu', shift: 'GENERAL', firstIn: '09:22', lastOut: '18:30', punches: 4, worked: '9h 08m', deviation: '+0h 08m', status: 'Present' },
  { date: '09 Apr', day: 'Wed', shift: 'GENERAL', firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Absent' },
  { date: '08 Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
];

const STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Present':    { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Late':       { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Absent':     { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444' },
  'Weekly Off': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

// Evidence Vault — table-style document repository.
// Two sub-tabs: Employee Documents (KYC + address + education + employment)
// and Organizational Documents (legal agreements + company policies).
type VaultStatus = 'Verified' | 'Uploaded' | 'Pending' | 'Signed' | 'Sent' | 'Not Generated';
interface EmpDocRow {
  name: string; idNumber?: string; authority?: string; issueDate?: string; expiryDate?: string; attachment?: string; status: VaultStatus;
}
interface OrgDocRow {
  name: string; type: string; effectiveDate?: string; validUntil?: string; attachment?: string; status: VaultStatus;
}
interface EmpDocSection { title: string; subtitle: string; icon: string; iconTint: string; iconFg: string; docs: EmpDocRow[] }
interface OrgDocSection { title: string; subtitle: string; icon: string; iconTint: string; iconFg: string; docs: OrgDocRow[] }

const VAULT_EMPLOYEE: EmpDocSection[] = [
  {
    title: 'Identity (KYC)', subtitle: 'Core identity documents for employee verification',
    icon: 'ri-shield-user-line', iconTint: '#dceefe', iconFg: '#0c63b0',
    docs: [
      { name: 'Aadhaar Card',              idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI',           issueDate: '01/01/2020', attachment: 'Aadhaar.pdf', status: 'Verified' },
      { name: 'PAN Card',                  idNumber: 'ABCDE1234F',     authority: 'Income Tax Dept', issueDate: '01/01/2018', attachment: 'PAN.pdf',     status: 'Verified' },
      { name: 'Passport-size Photograph',                                                            issueDate: '01/01/2024', attachment: 'Photo.jpg',   status: 'Uploaded' },
    ],
  },
  {
    title: 'Address Proof', subtitle: 'Residential address verification documents',
    icon: 'ri-map-pin-line', iconTint: '#d6f4e3', iconFg: '#108548',
    docs: [
      { name: 'Aadhaar Card (Reused)', idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI', issueDate: '01/01/2020', expiryDate: '01/01/2030', attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { name: 'Current Address Proof',                                                  issueDate: '01/01/2022', expiryDate: '01/01/2027', attachment: 'CurrentAddr.pdf', status: 'Verified' },
      { name: 'Permanent Address Proof',                                                                                                                                  status: 'Pending'  },
    ],
  },
  {
    title: 'Education Documents', subtitle: 'Academic qualifications and credentials',
    icon: 'ri-graduation-cap-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: '10th Marksheet',         authority: 'State Board', issueDate: '01/05/2001', attachment: '10th.pdf',     status: 'Verified' },
      { name: '12th Marksheet',         authority: 'State Board', issueDate: '01/05/2003', attachment: '12th.pdf',     status: 'Verified' },
      { name: 'Graduation Marksheet',   authority: 'University',  issueDate: '01/06/2007', attachment: 'GradMark.pdf', status: 'Verified' },
      { name: 'Graduation Certificate', authority: 'University',  issueDate: '01/10/2007', attachment: 'GradCert.pdf', status: 'Pending'  },
    ],
  },
  {
    title: 'Previous Employment Documents', subtitle: 'Employment history, documents & background verification',
    icon: 'ri-briefcase-line', iconTint: '#fde8c4', iconFg: '#a4661c',
    docs: [
      { name: 'Experience Letter',      authority: 'Infotech Solutions Ltd', issueDate: '01/11/2023', attachment: 'ExpLetter.pdf',  status: 'Verified' },
      { name: 'Relieving Letter',       authority: 'Infotech Solutions Ltd', issueDate: '01/11/2023', attachment: 'Relieving.pdf',  status: 'Verified' },
      { name: 'Last 3 Pay Slips',       authority: 'Infotech Solutions Ltd', issueDate: '01/10/2023', attachment: 'PaySlips.pdf',   status: 'Verified' },
      { name: 'Form 16 (FY 2022-23)',   authority: 'Infotech Solutions Ltd', issueDate: '01/06/2023', attachment: 'Form16.pdf',     status: 'Verified' },
      { name: 'Bank Statement (3 mo.)', authority: 'Kotak Mahindra Bank',    issueDate: '01/11/2023', attachment: 'BankStmt.pdf',   status: 'Uploaded' },
      { name: 'Background Verification',authority: 'BGV Vendor',             issueDate: '15/11/2023', attachment: 'BGV.pdf',        status: 'Verified' },
      { name: 'Reference Check',        authority: 'BGV Vendor',             issueDate: '15/11/2023',                                status: 'Pending'  },
    ],
  },
];

const VAULT_ORG: OrgDocSection[] = [
  {
    title: 'Legal Agreements', subtitle: 'Binding legal documents signed between employee and organization',
    icon: 'ri-file-shield-2-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: 'Non-Disclosure Agreement (NDA)',           type: 'AGREEMENT', effectiveDate: '01/11/2023', validUntil: '01/11/2028', attachment: 'NDA.pdf',             status: 'Signed' },
      { name: 'Employment Agreement / Appointment Letter', type: 'AGREEMENT', effectiveDate: '03/11/2023',                           attachment: 'Appointment.pdf',     status: 'Signed' },
      { name: 'Confidentiality Agreement',                 type: 'AGREEMENT', effectiveDate: '03/11/2023',                           attachment: 'Confidentiality.pdf', status: 'Signed' },
    ],
  },
  {
    title: 'Company Policies', subtitle: 'Internal policies acknowledged and accepted by the employee',
    icon: 'ri-file-list-3-line', iconTint: '#d3f0ee', iconFg: '#0a716a',
    docs: [
      { name: 'Code of Conduct Policy',         type: 'POLICY', effectiveDate: '03/11/2023', attachment: 'CodeOfConduct.pdf', status: 'Signed' },
      { name: 'IT Security & Acceptable Use Policy', type: 'POLICY', effectiveDate: '03/11/2023', attachment: 'ITPolicy.pdf',   status: 'Signed' },
      { name: 'Leave & Attendance Policy',      type: 'POLICY', effectiveDate: '03/11/2023', attachment: 'LeavePolicy.pdf',   status: 'Signed' },
      { name: 'Gratuity & Benefit Policy',      type: 'POLICY', effectiveDate: '03/11/2023', attachment: 'GratuityPolicy.pdf', status: 'Pending' },
    ],
  },
];
// Expense Details — mock claims and the per-category visual tones used on
// the claim-row "category" pill.
const EXPENSE_CATEGORY_TONE: Record<string, { bg: string; fg: string; icon: string }> = {
  'Travel':         { bg: '#dceefe', fg: '#0c63b0', icon: 'ri-flight-takeoff-line' },
  'Meals':          { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-restaurant-line' },
  'Internet':       { bg: '#d3f0ee', fg: '#0a716a', icon: 'ri-wifi-line' },
  'Office Supplies':{ bg: '#ece6ff', fg: '#5a3fd1', icon: 'ri-folder-line' },
  'Training':       { bg: '#d6f4e3', fg: '#108548', icon: 'ri-graduation-cap-line' },
};
const EXPENSE_STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Approved': { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Pending':  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Rejected': { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444' },
};
const EXPENSE_CLAIMS: { id: string; category: keyof typeof EXPENSE_CATEGORY_TONE; description: string; date: string; amount: number; receipt: string; status: 'Approved' | 'Pending' | 'Rejected' }[] = [
  { id: 'EXP-2201', category: 'Travel',          description: 'Client visit to Mumbai — cab + train',         date: '10 Apr 2026', amount: 2800, receipt: 'Receipt_EXP2201', status: 'Approved' },
  { id: 'EXP-2198', category: 'Meals',           description: 'Team lunch — project kickoff meeting',         date: '05 Apr 2026', amount: 850,  receipt: 'Receipt_EXP2198', status: 'Pending'  },
  { id: 'EXP-2181', category: 'Internet',        description: 'Monthly internet reimbursement — Apr',         date: '22 Mar 2026', amount: 999,  receipt: 'Receipt_EXP2181', status: 'Approved' },
  { id: 'EXP-2174', category: 'Travel',          description: 'Pune–Mumbai flight for quarterly review',      date: '15 Mar 2026', amount: 4500, receipt: 'Receipt_EXP2174', status: 'Rejected' },
  { id: 'EXP-2165', category: 'Office Supplies', description: 'Stationery and printer cartridges',            date: '08 Mar 2026', amount: 1200, receipt: 'Receipt_EXP2165', status: 'Approved' },
  { id: 'EXP-2150', category: 'Training',        description: 'Online certification course — AWS',            date: '01 Mar 2026', amount: 3500, receipt: 'Receipt_EXP2150', status: 'Pending'  },
];

const VAULT_STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Verified':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Uploaded':      { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Pending':       { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Signed':        { bg: '#ece6ff', fg: '#5b3fd1', dot: '#7c5cfc' },
  'Sent':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Not Generated': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

export default function EmployeeProfile({ employeeId, employee, onBack }: Props) {
  const initials = employee?.initials
    || (employee?.name ? employee.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : 'EM');
  const accent = employee?.accent || '#7c5cfc';
  const profilePct = typeof employee?.profile === 'number' ? employee.profile : 83;
  const ancillaryList = Array.isArray(employee?.ancillaryRole)
    ? (employee?.ancillaryRole as string[]).filter(Boolean)
    : (employee?.ancillaryRole ? [employee.ancillaryRole as string] : []);

  const statusTone =
      employee?.status === 'active'         ? { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: 'Active' }
    : employee?.status === 'on_leave'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#f59e0b', label: 'On Leave' }
    : employee?.status === 'high_attention' ? { bg: 'rgba(255,255,255,0.18)', dot: '#ef4444', label: 'High Attention' }
    : employee?.status === 'probation'      ? { bg: 'rgba(255,255,255,0.18)', dot: '#3b82f6', label: 'Probation' }
    : employee?.status === 'inactive'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#94a3b8', label: 'Inactive' }
    :                                          { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: employee?.enabled === false ? 'Disabled' : 'Active' };

  const [tab, setTab] = useState<TabKey>('profile');
  const [payrollTab, setPayrollTab] = useState<PayrollTab>('summary');
  const [vaultTab, setVaultTab] = useState<VaultTab>('employee');
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilter>('all');

  // Attendance regularization modal — opens from the "+ Regularization" button
  // in the Intraday Punch Timeline card. Lets the user submit a request to
  // either adjust time entries or exempt the day from penalization.
  const [regOpen, setRegOpen] = useState(false);
  const [regOption, setRegOption] = useState<'adjust' | 'exempt'>('adjust');
  const [regLocations, setRegLocations] = useState<string[]>(['Baner Office']);
  const [regLocationDraft, setRegLocationDraft] = useState('');
  const [regLogs, setRegLogs] = useState<{ id: string; from: string; to: string }[]>([
    { id: 'log-1', from: '09:32', to: '13:14' },
    { id: 'log-2', from: '14:06', to: '14:06' },
    { id: 'log-3', from: '09:32', to: '09:32' },
  ]);
  const [regNote, setRegNote] = useState('');
  const REG_LOCATION_OPTIONS = ['Baner Office', 'Hinjewadi Office', 'Kharadi Office', 'Remote', 'Client Site'];

  // Live counts for the Evidence Vault hero KPIs.
  const allVaultDocs = [
    ...VAULT_EMPLOYEE.flatMap(s => s.docs.map(d => ({ status: d.status }))),
    ...VAULT_ORG.flatMap(s => s.docs.map(d => ({ status: d.status }))),
  ];
  const vaultCounts = {
    total:    allVaultDocs.length,
    verified: allVaultDocs.filter(d => d.status === 'Verified').length,
    pending:  allVaultDocs.filter(d => d.status === 'Pending').length,
    signed:   allVaultDocs.filter(d => d.status === 'Signed' || d.status === 'Sent').length,
  };
  const employeeDocCount      = VAULT_EMPLOYEE.reduce((n, s) => n + s.docs.length, 0);
  const organizationalDocCount = VAULT_ORG.reduce((n, s) => n + s.docs.length, 0);

  const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
    { key: 'profile',    label: 'Profile Details', icon: 'ri-user-line',                color: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
    { key: 'job',        label: 'Job Details',     icon: 'ri-briefcase-line',           color: 'linear-gradient(135deg,#0ab39c,#30d5b5)' },
    { key: 'attendance', label: 'Attendance',      icon: 'ri-calendar-check-line',      color: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
    { key: 'vault',      label: 'Evidence Vault',  icon: 'ri-folder-shield-2-line',     color: 'linear-gradient(135deg,#a855f7,#c084fc)' },
    { key: 'payroll',    label: 'Payroll Details', icon: 'ri-money-dollar-circle-line', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
    { key: 'expense',    label: 'Expense Details', icon: 'ri-wallet-3-line',            color: 'linear-gradient(135deg,#f06548,#ff7a5c)' },
  ];

  // Onboarding progress as a numeric percent for the hero ring chart.
  const onboardingPct =
      employee?.onboarding === 'Completed'   ? 100
    : employee?.onboarding === 'In Progress' ? 65
    : employee?.onboarding === 'Pending'     ? 25
    :                                          83;

  // Pre-compute counts and the filtered list once per render so the filter
  // tabs stay in sync with the table.
  const expenseCounts = {
    all:      EXPENSE_CLAIMS.length,
    approved: EXPENSE_CLAIMS.filter(c => c.status === 'Approved').length,
    rejected: EXPENSE_CLAIMS.filter(c => c.status === 'Rejected').length,
    pending:  EXPENSE_CLAIMS.filter(c => c.status === 'Pending').length,
  };
  const totalClaimed = EXPENSE_CLAIMS.reduce((sum, c) => sum + c.amount, 0);
  const filteredExpenses = expenseFilter === 'all'
    ? EXPENSE_CLAIMS
    : EXPENSE_CLAIMS.filter(c => c.status.toLowerCase() === expenseFilter);

  return (
    <div className="ep-fullscreen-overlay">
      <style>{`
        /* Full-screen overlay so the employee profile reads as a dedicated
           workspace with no app chrome (sidebar + topbar) competing for
           attention. Matches the HRMS reference design. */
        .ep-fullscreen-overlay {
          position: fixed; inset: 0; z-index: 1080;
          background: var(--vz-body-bg, #f3f4f9);
          overflow-y: auto;
          padding-bottom: 32px;
        }
        /* Dashboard surface — KPI tile background that flips in dark mode,
           matching the admin/client/branch dashboard's .dashboard-surface. */
        .dashboard-surface { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-surface { background: #1c2531; }
        .ep-section-card { position: relative; transition: transform .25s ease, box-shadow .25s ease; }
        .ep-section-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 32px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04) !important;
        }
        .ep-section-card .card-body { position: relative; z-index: 2; }

        /* ── Hero ── */
        .ep-hero {
          position: relative;
          color: #fff;
          padding: 28px 32px 0;
          background:
            radial-gradient(circle at 12% 22%, rgba(99,102,241,0.28), transparent 45%),
            radial-gradient(circle at 88% 78%, rgba(34,197,94,0.18), transparent 50%),
            linear-gradient(135deg, #0c1437 0%, #131c46 45%, #1d2c6b 100%);
        }
        .ep-hero::after {
          content: ''; position: absolute; inset: 0;
          background-image:
            radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 16px 16px;
          opacity: 0.35; pointer-events: none;
        }
        /* Bottom tab strip baked into the hero card — uses a translucent dark
           panel so the navy gradient still bleeds through behind it. */
        .ep-hero-tabs {
          position: relative; z-index: 2;
          margin-top: 24px;
          padding: 14px 0 18px;
        }
        .ep-close-btn {
          position: absolute; top: 18px; right: 22px;
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.20);
          color: #fff; display: inline-flex;
          align-items: center; justify-content: center;
          cursor: pointer; transition: background .15s ease;
          z-index: 3;
        }
        .ep-close-btn:hover { background: rgba(255,255,255,0.20); }
        .ep-avatar-square {
          width: 100px; height: 100px;
          border-radius: 24px;
          background: linear-gradient(135deg, #4f46e5 0%, #7c5cfc 100%);
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 700; font-size: 36px;
          position: relative;
          box-shadow: 0 14px 32px rgba(79,70,229,0.45), inset 0 1px 0 rgba(255,255,255,0.20);
          letter-spacing: 0.02em;
        }
        .ep-avatar-square::after {
          content: ''; position: absolute; bottom: 6px; right: 6px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #22c55e; border: 3px solid #ffffff;
          box-shadow: 0 0 8px rgba(34,197,94,0.6);
        }
        .ep-hero-pill {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11.5px; font-weight: 600;
          padding: 4px 12px; border-radius: 999px;
        }
        .ep-hero-pill-blue   { background: rgba(99,102,241,0.20); color: #c7d2fe; border: 1px solid rgba(99,102,241,0.40); }
        .ep-hero-pill-teal   { background: rgba(20,184,166,0.20); color: #99f6e4; border: 1px solid rgba(20,184,166,0.40); }
        .ep-hero-pill-active { background: rgba(34,197,94,0.18);  color: #86efac; border: 1px solid rgba(34,197,94,0.40); }

        .ep-hero-meta { display: flex; align-items: center; gap: 10px; }
        .ep-hero-meta i { color: rgba(255,255,255,0.60); font-size: 16px; }
        .ep-hero-meta-label {
          color: rgba(255,255,255,0.55); font-size: 10.5px;
          font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        }
        .ep-hero-meta-value { color: #fff; font-size: 13.5px; font-weight: 600; }

        /* Ring chart — pure CSS conic-gradient with a dark hole. */
        .ep-ring {
          width: 110px; height: 110px;
          border-radius: 50%;
          position: relative;
          background:
            conic-gradient(var(--ring-color) calc(var(--ring-pct) * 1%),
                           rgba(255,255,255,0.10) 0);
          display: flex; align-items: center; justify-content: center;
        }
        .ep-ring::before {
          content: ''; position: absolute; inset: 9px;
          border-radius: 50%;
          background: var(--ring-bg, #131c46);
        }
        .ep-ring-inner { position: relative; z-index: 1; text-align: center; color: #fff; line-height: 1; }
        .ep-ring-num { font-size: 30px; font-weight: 800; }
        .ep-ring-pct { font-size: 11px; color: rgba(255,255,255,0.65); margin-top: 2px; }
        .ep-ring-label {
          color: rgba(255,255,255,0.65);
          font-size: 11px; font-weight: 700; letter-spacing: 0.10em;
          text-transform: uppercase; text-align: center; margin-top: 10px;
        }

        /* ── Tab bar (nested inside hero) ── */
        .ep-tabbar {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          padding: 6px;
          display: inline-flex; flex-wrap: wrap; gap: 4px;
          border-radius: 14px;
          backdrop-filter: blur(6px);
        }
        .ep-tabbar-btn {
          background: transparent; border: none;
          padding: 8px 14px;
          font-size: 13px; font-weight: 600;
          color: rgba(255,255,255,0.65);
          display: inline-flex; align-items: center; gap: 8px;
          border-radius: 10px;
          cursor: pointer;
          transition: all .15s ease;
          white-space: nowrap;
        }
        .ep-tabbar-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
        .ep-tabbar-btn.is-active {
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 4px 14px rgba(15,23,42,0.25);
        }
        .ep-tabbar-icon {
          width: 26px; height: 26px; border-radius: 7px;
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-size: 13px;
          box-shadow: 0 2px 6px rgba(15,23,42,0.30);
        }

        /* ── Section card icon pill (light tinted, replaces the colored
              SectionHeader gradient circle) ── */
        .ep-section-icon {
          width: 38px; height: 38px; border-radius: 10px;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 18px; flex-shrink: 0;
        }
        .ep-section-card-flat {
          border-radius: 16px;
          border: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
          box-shadow: 0 2px 14px rgba(15,23,42,0.05);
          overflow: hidden;
        }
        .ep-field-label {
          font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 6px;
        }
        .ep-field-value {
          font-size: 14px; font-weight: 600;
          color: var(--vz-heading-color, var(--vz-body-color));
        }
        .ep-addr-marker {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 8px;
        }
        .ep-addr-marker .dot {
          width: 8px; height: 8px; border-radius: 50%;
        }

        .ep-subtab {
          background: var(--vz-secondary-bg); border: 1px solid var(--vz-border-color);
          border-radius: 999px; padding: 4px;
          display: inline-flex; gap: 4px;
        }
        .ep-subtab-btn {
          background: transparent; border: none;
          padding: 7px 18px; border-radius: 999px;
          font-size: 13px; font-weight: 600;
          color: var(--vz-secondary-color);
          display: inline-flex; align-items: center; gap: 6px;
          cursor: pointer; transition: all .15s ease;
        }
        .ep-subtab-btn.is-active {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff;
          box-shadow: 0 4px 10px rgba(99,102,241,0.30);
        }
        .ep-att-table { font-size: 13px; }
        .ep-att-table th { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vz-secondary-color); font-weight: 700; padding: 10px 12px; border-bottom: 1px solid var(--vz-border-color); }
        .ep-att-table td { padding: 10px 12px; border-bottom: 1px solid var(--vz-border-color); }
        .ep-att-table tr:last-child td { border-bottom: none; }
        .ep-shift-pill { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; }
      `}</style>

      {/* ── Hero banner ── */}
      <div className="ep-hero">
        <button type="button" className="ep-close-btn" onClick={onBack} aria-label="Close">
          <i className="ri-close-line" style={{ fontSize: 20 }} />
        </button>

        <Row className="g-4 align-items-center" style={{ position: 'relative', zIndex: 2 }}>
          {/* Avatar */}
          <Col xs="auto">
            <div className="ep-avatar-square">{initials}</div>
          </Col>

          {/* Identity */}
          <Col xs={12} md className="min-w-0">
            <div className="d-flex align-items-center gap-2 mb-1">
              <h2 className="text-white mb-0 fw-bold" style={{ fontSize: 28 }}>{employee?.name || employeeId}</h2>
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center justify-content-center"
                style={{ width: 30, height: 30, padding: 0, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, color: '#fff' }}
                aria-label="More actions"
              >
                <i className="ri-more-2-fill" />
              </button>
            </div>
            <p className="mb-1" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em' }}>{employeeId}</p>
            <p className="mb-2" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 13.5 }}>
              {employee?.department || 'Accounts'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              {employee?.designation || 'Associate Engineer'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              Full-time
            </p>
            <div className="d-flex gap-2 flex-wrap mb-3">
              {employee?.primaryRole && (
                <span className="ep-hero-pill ep-hero-pill-blue">
                  <i className="ri-suitcase-line" /> {employee.primaryRole}
                </span>
              )}
              {ancillaryList.map(r => (
                <span key={r} className="ep-hero-pill ep-hero-pill-teal">{r}</span>
              ))}
              <span className="ep-hero-pill ep-hero-pill-active">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                {statusTone.label}
              </span>
            </div>
            <div className="d-flex gap-4 flex-wrap">
              <div className="ep-hero-meta">
                <i className="ri-mail-line" />
                <div>
                  <span className="ep-hero-meta-label">Email</span>{' '}
                  <span className="ep-hero-meta-value">{employee?.email || 'aarav.kale@enterprise.com'}</span>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-user-line" />
                <div>
                  <span className="ep-hero-meta-label">Manager</span>{' '}
                  <span className="ep-hero-meta-value">{employee?.manager || '—'}</span>
                </div>
              </div>
            </div>
          </Col>

          {/* Mobile / Joined column */}
          <Col xs="auto" className="d-none d-lg-block">
            <div className="d-flex flex-column gap-3">
              <div className="ep-hero-meta">
                <i className="ri-phone-line" />
                <div>
                  <div className="ep-hero-meta-label">Mobile</div>
                  <div className="ep-hero-meta-value">9635203533</div>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-calendar-line" />
                <div>
                  <div className="ep-hero-meta-label">Joined</div>
                  <div className="ep-hero-meta-value">2023-11-03</div>
                </div>
              </div>
            </div>
          </Col>

          {/* Ring charts */}
          <Col xs="auto">
            <div className="d-flex gap-3">
              <div>
                <div
                  className="ep-ring"
                  style={{ ['--ring-color' as any]: '#a855f7', ['--ring-pct' as any]: profilePct, ['--ring-bg' as any]: '#131c46' }}
                >
                  <div className="ep-ring-inner">
                    <div className="ep-ring-num">{profilePct}</div>
                    <div className="ep-ring-pct">%</div>
                  </div>
                </div>
                <div className="ep-ring-label">Profile</div>
              </div>
              <div>
                <div
                  className="ep-ring"
                  style={{ ['--ring-color' as any]: '#22c55e', ['--ring-pct' as any]: onboardingPct, ['--ring-bg' as any]: '#131c46' }}
                >
                  <div className="ep-ring-inner">
                    <div className="ep-ring-num">{onboardingPct}</div>
                    <div className="ep-ring-pct">%</div>
                  </div>
                </div>
                <div className="ep-ring-label">Onboarding</div>
              </div>
            </div>
          </Col>
        </Row>

        {/* Tab nav nested inside the hero card so the strip reads as part of
            the same identity surface, not a separate floating bar. */}
        <div className="ep-hero-tabs">
          <div className="ep-tabbar">
            {TABS.map(t => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`ep-tabbar-btn${on ? ' is-active' : ''}`}
                >
                  <span className="ep-tabbar-icon" style={{ background: t.color }}>
                    <i className={t.icon} />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab content wrapper ── */}
      <div className="px-4 pt-3">

      {/* ── Tab: Profile Details ── */}
      {tab === 'profile' && (
        <>
          {/* Personal Information — full-width row of 7 identity fields */}
          <div className="ep-section-card-flat ep-section-card mb-3">
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                <i className="ri-user-line" />
              </span>
              <h6 className="mb-0 fw-bold">Personal Information</h6>
            </div>
            <div className="px-4 py-4">
              <Row className="g-4">
                <Col><div className="ep-field-label">First Name</div><div className="ep-field-value">{(employee?.name || 'Aarav Kale').split(' ')[0] || 'Aarav'}</div></Col>
                <Col><div className="ep-field-label">Middle Name</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Last Name</div><div className="ep-field-value">{(employee?.name || 'Aarav Kale').split(' ').slice(1).join(' ') || 'Kale'}</div></Col>
                <Col><div className="ep-field-label">Display Name</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                <Col><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">1985-11-02</div></Col>
                <Col><div className="ep-field-label">Gender</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Nationality</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
              </Row>
            </div>
          </div>

          {/* Contact Information — 4 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3">
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.12)', color: '#299cdb' }}>
                <i className="ri-phone-line" />
              </span>
              <h6 className="mb-0 fw-bold">Contact Information</h6>
            </div>
            <div className="px-4 py-4">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Work Email</div><div className="ep-field-value">{employee?.email || 'aarav.kale@enterprise.com'}</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile</div><div className="ep-field-value font-monospace">9635203533</div></Col>
                <Col md={3}><div className="ep-field-label">Work Country</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{employee?.manager || '—'}</div></Col>
              </Row>
            </div>
          </div>

          {/* Address Details — Current + Permanent stacked, with green accent */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #0ab39c' }}>
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.12)', color: '#0ab39c' }}>
                <i className="ri-map-pin-line" />
              </span>
              <h6 className="mb-0 fw-bold">Address Details</h6>
            </div>
            <div className="px-4 py-4">
              {/* Current */}
              <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                <span className="dot" style={{ background: '#0ab39c' }} /> Current Address
              </div>
              <Row className="g-4 mb-4">
                <Col><div className="ep-field-label">Address</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">City</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">State</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Country</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
              </Row>

              {/* Permanent */}
              <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                <span className="dot" style={{ background: '#0ab39c' }} /> Permanent Address
              </div>
              <Row className="g-4">
                <Col><div className="ep-field-label">Address</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">City</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">State</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Country</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
                <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
              </Row>
            </div>
          </div>

          {/* Bottom row: Work Experience | Profile Completion | KYC Documents */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column">
                <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                    <i className="ri-briefcase-line" />
                  </span>
                  <h6 className="mb-0 fw-bold">Work Experience</h6>
                </div>
                <div className="px-4 py-4 flex-grow-1">
                  <Row className="g-4">
                    <Col xs={6}>
                      <div className="ep-field-label">Status</div>
                      <div className="ep-field-value">Fresher</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Details</div>
                      <div className="ep-field-value">No previous experience recorded</div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.06), rgba(99,102,241,0.04))' }}>
                <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <div
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{
                      width: 56, height: 56, borderRadius: '50%',
                      background: `conic-gradient(#a855f7 ${profilePct}%, rgba(168,85,247,0.15) 0)`,
                      flexShrink: 0,
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute', inset: 5, borderRadius: '50%',
                        background: 'var(--vz-card-bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: '#a855f7',
                      }}
                    >
                      {profilePct}%
                    </span>
                  </div>
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fw-bold" style={{ color: '#7c3aed' }}>Profile Completion</h6>
                    <small className="text-muted">
                      <i className="ri-check-line" style={{ color: '#10b981' }} /> Complete &amp; Verified
                    </small>
                  </div>
                </div>
                <div className="px-4 py-4 flex-grow-1">
                  {/* Striped progress bar */}
                  <div style={{ width: '100%', height: 10, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden', marginBottom: 18 }}>
                    <div
                      style={{
                        width: `${profilePct}%`, height: '100%', borderRadius: 999,
                        background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.32) 0 6px, transparent 6px 12px), linear-gradient(90deg, #a855f7, #c084fc)`,
                        transition: 'width .35s ease',
                      }}
                    />
                  </div>
                  {/* 4 mini-tiles */}
                  <Row className="g-2">
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#108548' }}>Status</div>
                        <div className="ep-field-value d-inline-flex align-items-center gap-1" style={{ color: '#108548', fontSize: 13 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                          {employee?.enabled === false ? 'Disabled' : 'Active'}
                        </div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)' }}>
                        <div className="ep-field-label" style={{ color: '#4338ca' }}>Emp Type</div>
                        <div className="ep-field-value" style={{ color: '#4338ca', fontSize: 13 }}>Full-time</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#a16207' }}>Joined</div>
                        <div className="ep-field-value font-monospace" style={{ color: '#a16207', fontSize: 13 }}>2023-11-03</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(20,184,166,0.10)', border: '1px solid rgba(20,184,166,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#0a716a' }}>Department</div>
                        <div className="ep-field-value" style={{ color: '#0a716a', fontSize: 13 }}>{employee?.department || '—'}</div>
                      </div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column">
                <div className="d-flex align-items-center justify-content-between gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <div className="d-flex align-items-center gap-3">
                    <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold">KYC Documents</h6>
                  </div>
                  <span className="badge rounded-pill fw-semibold fs-11 px-2 py-1" style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}>3 / 4</span>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {[
                    { label: 'Aadhaar Card',   status: 'Uploaded',  icon: 'ri-checkbox-circle-fill', iconColor: '#10b981' },
                    { label: 'PAN Card',       status: 'Uploaded',  icon: 'ri-checkbox-circle-fill', iconColor: '#10b981' },
                    { label: 'Passport Photo', status: 'Uploaded',  icon: 'ri-checkbox-circle-fill', iconColor: '#10b981' },
                    { label: 'Address Proof',  status: 'Pending',   icon: 'ri-time-fill',            iconColor: '#f59e0b' },
                  ].map(d => (
                    <div key={d.label} className="d-flex align-items-center gap-2 px-2 py-2">
                      <i className={d.icon} style={{ color: d.iconColor, fontSize: 18 }} />
                      <div className="fs-13 fw-semibold flex-grow-1">{d.label}</div>
                      <span
                        className="d-inline-flex align-items-center fw-semibold"
                        style={{
                          fontSize: 11, padding: '2px 10px', borderRadius: 999,
                          background: d.status === 'Pending' ? '#fef3c7' : '#dbeafe',
                          color:      d.status === 'Pending' ? '#a16207' : '#1d4ed8',
                        }}
                      >
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Col>
          </Row>
        </>
      )}

      {/* ── Tab: Job Details ── */}
      {tab === 'job' && (
        <>
          {/* Employment Details — single row of 7 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3">
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                <i className="ri-briefcase-line" />
              </span>
              <h6 className="mb-0 fw-bold">Employment Details</h6>
            </div>
            <div className="px-4 py-4">
              <Row className="g-4">
                <Col>
                  <div className="ep-field-label">Employee Number</div>
                  <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 13 }}>{employeeId}</span>
                </Col>
                <Col><div className="ep-field-label">Joining Date</div><div className="ep-field-value font-monospace">2023-11-03</div></Col>
                <Col><div className="ep-field-label">Job Title (Primary)</div><div className="ep-field-value">{employee?.designation || '—'}</div></Col>
                <Col><div className="ep-field-label">Job Title (Secondary)</div><div className="ep-field-value">{ancillaryList[0] || '—'}</div></Col>
                <Col><div className="ep-field-label">Employment Status</div><div className="ep-field-value">{employee?.enabled === false ? 'Disabled' : 'active'}</div></Col>
                <Col><div className="ep-field-label">Worker Type</div><div className="ep-field-value">Full-time</div></Col>
                <Col><div className="ep-field-label">Time Type</div><div className="ep-field-value">Full Time</div></Col>
              </Row>
            </div>
          </div>

          {/* Organisational Structure — 4 fields full width */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #299cdb' }}>
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.12)', color: '#299cdb' }}>
                <i className="ri-building-2-line" />
              </span>
              <h6 className="mb-0 fw-bold">Organisational Structure</h6>
            </div>
            <div className="px-4 py-4">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">Inorbvict Healthcare India Pvt. Ltd.</div></Col>
                <Col md={3}><div className="ep-field-label">Department</div><div className="ep-field-value">{employee?.department || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Location</div><div className="ep-field-value">Pune, Maharashtra</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{employee?.manager || '—'}</div></Col>
              </Row>
            </div>
          </div>

          {/* Row of 3 cards: Role & Positioning | Employment Terms | Attendance & Time */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100">
                <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.12)', color: '#0ab39c' }}>
                    <i className="ri-edit-line" />
                  </span>
                  <h6 className="mb-0 fw-bold">Role &amp; Positioning</h6>
                </div>
                <div className="px-4 py-4">
                  <Row className="g-4">
                    <Col xs={4}><div className="ep-field-label">Primary Role</div><div className="ep-field-value">{employee?.primaryRole || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Ancillary Role</div><div className="ep-field-value">{ancillaryList[0] || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Employee Level</div><div className="ep-field-value">L3 — Mid</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100">
                <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                    <i className="ri-file-list-3-line" />
                  </span>
                  <h6 className="mb-0 fw-bold">Employment Terms</h6>
                </div>
                <div className="px-4 py-4">
                  <Row className="g-3">
                    <Col xs={6}><div className="ep-field-label">Probation Policy</div><div className="ep-field-value">Default Probation Policy</div></Col>
                    <Col xs={6}><div className="ep-field-label">Probation Duration</div><div className="ep-field-value">3 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Notice Period</div><div className="ep-field-value">2 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Contract Status</div><div className="ep-field-value">Permanent</div></Col>
                    <Col xs={6}><div className="ep-field-label">Penalization</div><div className="ep-field-value">Default</div></Col>
                    <Col xs={6}><div className="ep-field-label">Overtime Policy</div><div className="ep-field-value">Standard OT</div></Col>
                    <Col xs={6}><div className="ep-field-label">Shift Allowance</div><div className="ep-field-value">None</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100">
                <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.12)', color: '#299cdb' }}>
                    <i className="ri-time-line" />
                  </span>
                  <h6 className="mb-0 fw-bold">Attendance &amp; Time</h6>
                </div>
                <div className="px-4 py-4">
                  <Row className="g-3">
                    <Col xs={6}><div className="ep-field-label">Shift</div><div className="ep-field-value">Morning Shift</div></Col>
                    <Col xs={6}><div className="ep-field-label">Weekly Off</div><div className="ep-field-value">Sat &amp; Sun</div></Col>
                    <Col xs={6}><div className="ep-field-label">Leave Plan</div><div className="ep-field-value">Default Leave Plan</div></Col>
                    <Col xs={6}><div className="ep-field-label">Holiday Calendar</div><div className="ep-field-value">Maharashtra 2026</div></Col>
                    <Col xs={6}><div className="ep-field-label">Time Tracking</div><div className="ep-field-value">Enabled</div></Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Attendance No.</div>
                      <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 10px', borderRadius: 8, fontSize: 12.5 }}>{employeeId}</span>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

          {/* Asset Details */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #f59e0b' }}>
            <div className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
              <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <i className="ri-computer-line" />
              </span>
              <h6 className="mb-0 fw-bold">Asset Details</h6>
            </div>
            <div className="px-4 py-4">
              <Row className="g-4 mb-3">
                <Col md={3}><div className="ep-field-label">Laptop Assigned</div><div className="ep-field-value">Yes</div></Col>
                <Col md={3}>
                  <div className="ep-field-label">Laptop Asset ID</div>
                  <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 13 }}>LAP-0042</span>
                </Col>
                <Col md={3}><div className="ep-field-label">Laptop Type</div><div className="ep-field-value">Dell Latitude 5510</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile Device</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
              </Row>
              <Row className="g-4 mb-3">
                <Col md={3}><div className="ep-field-label">Monitor</div><div className="ep-field-value">24" Dell Monitor</div></Col>
                <Col md={3}><div className="ep-field-label">Keyboard</div><div className="ep-field-value">Logitech K380</div></Col>
                <Col md={3}><div className="ep-field-label">Mouse</div><div className="ep-field-value">Logitech MX</div></Col>
                <Col md={3}><div className="ep-field-label">Headset</div><div className="ep-field-value text-muted fw-normal">—</div></Col>
              </Row>
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Other Assets</div><div className="ep-field-value">Access Card, Desk</div></Col>
                <Col md={3}><div className="ep-field-label">Asset Issued Date</div><div className="ep-field-value font-monospace">2023-11-03</div></Col>
                <Col md={3}><div className="ep-field-label">Acknowledgment</div><div className="ep-field-value">Signed</div></Col>
                <Col md={3}><div className="ep-field-label">Return Required</div><div className="ep-field-value">No</div></Col>
              </Row>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Attendance ── */}
      {tab === 'attendance' && (
        <>
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl><KpiTile label="Present Days"    value="14"  sub="This month"      icon="ri-checkbox-circle-line" gradient={GRAD_SUCCESS} tint="#ecfaf3" /></Col>
            <Col xl><KpiTile label="Late Marks"      value="1"   sub="This month"      icon="ri-time-line"            gradient={GRAD_WARNING} tint="#fff7e6" /></Col>
            <Col xl><KpiTile label="Missing Biometric" value="1" sub="Entries this month" icon="ri-error-warning-line" gradient={GRAD_DANGER}  tint="#fff1ed" /></Col>
            <Col xl><KpiTile label="Compliance Score" value="93%" sub="Attendance rate" icon="ri-shield-check-line"   gradient={GRAD_INFO}    tint="#eaf6fd" /></Col>
            <Col xl><KpiTile label="Total Leaves"    value="0"   sub="This month"      icon="ri-calendar-todo-line"   gradient={GRAD_PURPLE}  tint="#f3eeff" /></Col>
          </Row>

          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={6}>
              <Card className="h-100 mb-0" style={cardStyle}>
                <CardBody>
                  <SectionHeader
                    title="Today's Updated Record"
                    gradient={GRAD_SUCCESS}
                    icon="ri-calendar-check-line"
                    action={<small className="text-muted">Mon, 21 Apr 2026</small>}
                  />
                  <span className="d-inline-flex align-items-center gap-1 fw-semibold mb-3" style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 999, background: '#d6f4e3', color: '#108548' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Present
                  </span>
                  <Row className="g-2 mb-3">
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: '#ecfaf3', border: '1px solid #bce8d2' }}>
                        <p className="mb-1 fs-11 text-uppercase fw-semibold" style={{ color: '#0a8a78', letterSpacing: '0.06em' }}>» First In</p>
                        <h4 className="mb-0 fw-bold" style={{ color: '#108548' }}>07:01 <small className="fs-12">AM</small></h4>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: '#eaf6fd', border: '1px solid #b8dcef' }}>
                        <p className="mb-1 fs-11 text-uppercase fw-semibold" style={{ color: '#0c63b0', letterSpacing: '0.06em' }}>» Last Out</p>
                        <h4 className="mb-0 fw-bold" style={{ color: '#0c63b0' }}>04:02 <small className="fs-12">PM</small></h4>
                      </div>
                    </Col>
                  </Row>
                  <div className="d-flex justify-content-around text-center pt-2 border-top">
                    <div><h5 className="mb-0 fw-bold" style={{ color: '#5a3fd1' }}>2</h5><small className="text-muted text-uppercase fs-10 fw-semibold">Punches</small></div>
                    <div><h5 className="mb-0 fw-bold" style={{ color: '#108548' }}>9h 01m</h5><small className="text-muted text-uppercase fs-10 fw-semibold">Worked</small></div>
                    <div><h5 className="mb-0 fw-bold" style={{ color: '#5a3fd1' }}>9h 00m</h5><small className="text-muted text-uppercase fs-10 fw-semibold">Expected</small></div>
                  </div>
                </CardBody>
              </Card>
            </Col>
            <Col xl={6}>
              <Card className="h-100 mb-0" style={cardStyle}>
                <CardBody>
                  <SectionHeader
                    title="Intraday Punch Timeline"
                    gradient={GRAD_INFO}
                    icon="ri-pulse-line"
                    action={(
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge rounded-pill" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: 11, padding: '4px 10px' }}>2 punches today</span>
                        <button
                          type="button"
                          className="btn btn-sm rounded-pill fw-semibold"
                          style={{ background: GRAD_INFO, color: '#fff', border: 'none', fontSize: 12, padding: '4px 12px' }}
                          onClick={() => setRegOpen(true)}
                        >
                          <i className="ri-add-line me-1" /> Regularization
                        </button>
                      </div>
                    )}
                  />
                  <div className="position-relative" style={{ paddingLeft: 30 }}>
                    <div style={{ position: 'absolute', top: 8, bottom: 8, left: 13, width: 2, background: 'var(--vz-border-color)' }} />
                    <div className="mb-3 position-relative">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ position: 'absolute', left: -30, width: 28, height: 28, background: '#10b981', color: '#fff', boxShadow: '0 4px 10px rgba(16,185,129,0.40)' }}>
                        <i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />
                      </span>
                      <h5 className="mb-0 fw-bold" style={{ color: '#108548' }}>07:01 AM</h5>
                      <p className="mb-1 fs-13 fw-semibold">Check In</p>
                      <span className="badge rounded-pill" style={{ background: '#dceefe', color: '#0c63b0', fontSize: 10, padding: '3px 8px' }}>BIOMETRIC</span>
                    </div>
                    <div className="position-relative">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ position: 'absolute', left: -30, width: 28, height: 28, background: '#3b82f6', color: '#fff', boxShadow: '0 4px 10px rgba(59,130,246,0.40)' }}>
                        <i className="ri-logout-circle-r-line" style={{ fontSize: 14 }} />
                      </span>
                      <h5 className="mb-0 fw-bold" style={{ color: '#0c63b0' }}>04:02 PM</h5>
                      <p className="mb-1 fs-13 fw-semibold">Check Out</p>
                      <span className="badge rounded-pill" style={{ background: '#dceefe', color: '#0c63b0', fontSize: 10, padding: '3px 8px' }}>BIOMETRIC</span>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col xs={12}>
              <Card className="mb-0" style={cardStyle}>
                <CardBody>
                  <SectionHeader
                    title="Attendance Timelog History"
                    gradient={GRAD_PURPLE}
                    icon="ri-history-line"
                    action={(
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge rounded-pill" style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-body-color)', fontSize: 11, padding: '4px 10px', border: '1px solid var(--vz-border-color)' }}>
                          <i className="ri-calendar-line me-1" /> April 2026
                        </span>
                        <button type="button" className="btn btn-sm rounded-pill fw-semibold" style={{ background: GRAD_PURPLE, color: '#fff', border: 'none', fontSize: 12, padding: '4px 12px' }}>
                          <i className="ri-download-2-line me-1" /> Export Timelogs
                        </button>
                      </div>
                    )}
                  />
                  <div className="table-responsive">
                    <table className="table ep-att-table mb-0">
                      <thead>
                        <tr>
                          <th>Date</th><th>Day</th><th>Shift</th><th>First In</th><th>Last Out</th><th>Punches</th><th>Worked</th><th>Deviation</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ATTENDANCE_HISTORY.map(r => {
                          const t = STATUS_TONE[r.status];
                          const shiftTone = r.shift === 'EARLY' ? { bg: '#d6f4e3', fg: '#108548' } : r.shift === 'GENERAL' ? { bg: '#dceefe', fg: '#0c63b0' } : null;
                          return (
                            <tr key={r.date}>
                              <td className="fw-semibold">{r.date}</td>
                              <td className="text-muted">{r.day}</td>
                              <td>{shiftTone ? <span className="ep-shift-pill" style={{ background: shiftTone.bg, color: shiftTone.fg }}>{r.shift}</span> : <span className="text-muted">—</span>}</td>
                              <td className="font-monospace">{r.firstIn}</td>
                              <td className="font-monospace">{r.lastOut}</td>
                              <td className="fw-bold" style={{ color: '#5a3fd1' }}>{r.punches > 0 ? r.punches : <span className="text-muted">—</span>}</td>
                              <td className="fw-bold" style={{ color: '#108548' }}>{r.worked}</td>
                              <td className="fw-bold" style={{ color: '#108548' }}>{r.deviation}</td>
                              <td>
                                <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg }}>
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.dot }} /> {r.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ── Tab: Evidence Vault ── */}
      {tab === 'vault' && (
        <>
          {/* Hero strip — "Evidence Vault — {Name} Document Repository" + KPIs */}
          <Card className="mb-3 border-0" style={{ borderRadius: 18, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg, #5a3fd1 0%, #6366f1 50%, #7c5cfc 100%)',
                color: '#fff',
                padding: '20px 24px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -50, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
              <Row className="align-items-center g-3" style={{ position: 'relative' }}>
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                    <i className="ri-lock-2-line" style={{ fontSize: 22, color: '#fff' }} />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-1 fs-11 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>Evidence Vault</p>
                  <h5 className="mb-1 fw-bold text-white">
                    {employee?.name || employeeId} <span style={{ color: 'rgba(255,255,255,0.55)' }}>—</span> Document Repository
                  </h5>
                  <small style={{ color: 'rgba(255,255,255,0.78)' }}>All documents are securely stored and version-controlled</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-2 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total Docs', value: vaultCounts.total,    color: '#fff' },
                      { label: 'Verified',   value: vaultCounts.verified, color: '#86efac' },
                      { label: 'Pending',    value: vaultCounts.pending,  color: '#fcd34d' },
                      { label: 'Signed',     value: vaultCounts.signed,   color: '#c4b5fd' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center px-3 py-2"
                        style={{
                          background: 'rgba(255,255,255,0.12)',
                          border: '1px solid rgba(255,255,255,0.20)',
                          borderRadius: 14,
                          backdropFilter: 'blur(6px)',
                          minWidth: 90,
                        }}
                      >
                        <p className="mb-1 fs-10 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>{c.label}</p>
                        <h5 className="mb-0 fw-bold lh-1" style={{ color: c.color }}>{c.value}</h5>
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Sub-tab pill — Employee Documents | Organizational Documents */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex"
                style={{
                  background: 'var(--vz-secondary-bg)',
                  border: '1px solid var(--vz-border-color)',
                  borderRadius: 12,
                  padding: 4,
                  gap: 4,
                }}
              >
                {[
                  { key: 'employee'       as VaultTab, label: 'Employee Documents',      count: employeeDocCount,      icon: 'ri-user-line' },
                  { key: 'organizational' as VaultTab, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line' },
                ].map(t => {
                  const on = vaultTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setVaultTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 10,
                        padding: '10px 14px',
                        fontSize: 13,
                        background: on ? 'linear-gradient(135deg,#5a3fd1,#7c5cfc)' : 'transparent',
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

          {/* Employee Documents sub-tab */}
          {vaultTab === 'employee' && VAULT_EMPLOYEE.map(section => (
            <Card className="mb-3" style={cardStyle} key={section.title}>
              <CardBody className="p-0">
                <div className="d-flex align-items-start justify-content-between gap-3 px-3 py-3" style={{ background: 'linear-gradient(135deg, rgba(64,81,137,0.04), rgba(102,145,231,0.02))', borderBottom: '1px solid var(--vz-border-color)' }}>
                  <div className="d-flex align-items-start gap-2">
                    <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 40, height: 40, background: section.iconTint, color: section.iconFg, fontSize: 20 }}>
                      <i className={section.icon} />
                    </span>
                    <div>
                      <h6 className="mb-0 fw-bold">{section.title}</h6>
                      <small className="text-muted">{section.subtitle}</small>
                    </div>
                  </div>
                  <div className="text-end">
                    <h3 className="mb-0 fw-bold" style={{ color: section.iconFg, fontSize: 28, lineHeight: 1 }}>{section.docs.length}</h3>
                    <small className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
                    <thead style={{ background: 'var(--vz-secondary-bg)' }}>
                      <tr>
                        {['SR', 'Document Name', 'ID / Number', 'Issuing Authority', 'Issue Date', 'Expiry Date', 'Attachment', 'Status'].map(h => (
                          <th key={h} style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.docs.map((doc, idx) => {
                        const st = VAULT_STATUS_TONE[doc.status];
                        return (
                          <tr key={`${section.title}-${doc.name}`}>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="text-muted">{idx + 1}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="fw-semibold">{doc.name}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              {doc.idNumber
                                ? <span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>{doc.idNumber}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>{doc.authority || <span className="text-muted">—</span>}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="font-monospace">{doc.issueDate || <span className="text-muted">—</span>}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="font-monospace">{doc.expiryDate || <span className="text-muted">—</span>}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              {doc.attachment
                                ? <a href="#" onClick={e => e.preventDefault()} className="d-inline-flex align-items-center gap-1 text-decoration-none" style={{ background: '#d6f4e3', color: '#108548', padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
                                    <i className="ri-file-text-line" /> {doc.attachment}
                                  </a>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase" style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} /> {doc.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}

          {/* Organizational Documents sub-tab */}
          {vaultTab === 'organizational' && VAULT_ORG.map(section => (
            <Card className="mb-3" style={cardStyle} key={section.title}>
              <CardBody className="p-0">
                <div className="d-flex align-items-start justify-content-between gap-3 px-3 py-3" style={{ background: 'linear-gradient(135deg, rgba(64,81,137,0.04), rgba(102,145,231,0.02))', borderBottom: '1px solid var(--vz-border-color)' }}>
                  <div className="d-flex align-items-start gap-2">
                    <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 40, height: 40, background: section.iconTint, color: section.iconFg, fontSize: 20 }}>
                      <i className={section.icon} />
                    </span>
                    <div>
                      <h6 className="mb-0 fw-bold">{section.title}</h6>
                      <small className="text-muted">{section.subtitle}</small>
                    </div>
                  </div>
                  <div className="text-end">
                    <h3 className="mb-0 fw-bold" style={{ color: section.iconFg, fontSize: 28, lineHeight: 1 }}>{section.docs.length}</h3>
                    <small className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
                    <thead style={{ background: 'var(--vz-secondary-bg)' }}>
                      <tr>
                        {['SR', 'Document Name', 'Type', 'Effective Date', 'Valid Until', 'Attachment', 'Status'].map(h => (
                          <th key={h} style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.docs.map((doc, idx) => {
                        const st = VAULT_STATUS_TONE[doc.status];
                        const typeTone = doc.type === 'AGREEMENT'
                          ? { bg: '#d6f4e3', fg: '#108548' }
                          : { bg: '#dceefe', fg: '#0c63b0' };
                        return (
                          <tr key={`${section.title}-${doc.name}`}>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="text-muted">{idx + 1}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="fw-semibold">{doc.name}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              <span className="d-inline-flex align-items-center fw-semibold text-uppercase" style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 999, background: typeTone.bg, color: typeTone.fg, letterSpacing: '0.04em' }}>
                                {doc.type}
                              </span>
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="font-monospace">{doc.effectiveDate || <span className="text-muted">—</span>}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="font-monospace">{doc.validUntil || <span className="text-muted">—</span>}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              {doc.attachment
                                ? <a href="#" onClick={e => e.preventDefault()} className="d-inline-flex align-items-center gap-1 text-decoration-none" style={{ background: '#d6f4e3', color: '#108548', padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 }}>
                                    <i className="ri-file-text-line" /> {doc.attachment}
                                  </a>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                              <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase" style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} /> {doc.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}
        </>
      )}

      {/* ── Tab: Payroll Details ── */}
      {tab === 'payroll' && (
        <>
          <div className="d-flex justify-content-center mb-3">
            <div className="ep-subtab">
              <button type="button" onClick={() => setPayrollTab('summary')} className={`ep-subtab-btn${payrollTab === 'summary' ? ' is-active' : ''}`}>
                <i className="ri-calendar-line" /> Payroll Summary
              </button>
              <button type="button" onClick={() => setPayrollTab('details')} className={`ep-subtab-btn${payrollTab === 'details' ? ' is-active' : ''}`}>
                <i className="ri-money-dollar-circle-line" /> Payment Details
              </button>
            </div>
          </div>

          {payrollTab === 'summary' && (
            <>
              <Card className="mb-3 border-0" style={{ borderRadius: 18, overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(135deg, #5a3fd1 0%, #6366f1 50%, #7c5cfc 100%)', color: '#fff', padding: '20px 24px' }}>
                  <Row className="align-items-center g-3">
                    <Col xs="auto">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.22)' }}>
                        <i className="ri-money-dollar-circle-line" style={{ fontSize: 22 }} />
                      </span>
                    </Col>
                    <Col className="min-w-0">
                      <p className="mb-1 fs-11 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>Payroll Summary</p>
                      <h5 className="mb-1 text-white fw-bold">Last Processed: <span style={{ color: '#bce8ff' }}>Mar 2026</span> (01 Mar – 31 Mar)</h5>
                      <small style={{ color: 'rgba(255,255,255,0.78)' }}>Next cycle: Apr 2026 · Monthly payroll</small>
                    </Col>
                    <Col xs="auto">
                      <div className="d-flex gap-2 flex-wrap">
                        <div className="text-center px-3 py-2" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 12, minWidth: 100 }}>
                          <p className="fs-10 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)' }}>Working Days</p>
                          <h6 className="mb-0 text-white fw-bold lh-1">31</h6>
                        </div>
                        <div className="text-center px-3 py-2" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 12, minWidth: 100 }}>
                          <p className="fs-10 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)' }}>Loss of Pay</p>
                          <h6 className="mb-0 text-white fw-bold lh-1">0</h6>
                        </div>
                        <div className="text-center px-3 py-2" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 12, minWidth: 100 }}>
                          <p className="fs-10 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)' }}>Status</p>
                          <h6 className="mb-0 text-white fw-bold lh-1">Active</h6>
                        </div>
                        <button type="button" className="btn btn-light rounded-pill fw-semibold" style={{ fontSize: 12, padding: '8px 14px' }}>
                          <i className="ri-download-2-line me-1" /> View Payslip
                        </button>
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <Card className="h-100 mb-0" style={cardStyle}>
                    <CardBody>
                      <SectionHeader
                        title="Payment Information"
                        gradient={GRAD_INFO}
                        icon="ri-bank-card-line"
                        action={<span className="badge rounded-pill fw-semibold fs-11 px-2 py-1" style={{ background: '#fff7e6', color: '#a4661c' }}>● Not Initiated</span>}
                      />
                      <div className="mb-3">
                        Salary Payment Mode: <strong>Bank Transfer</strong>
                      </div>
                      <Row>
                        <Field label="Bank Name"      value="Kotak Mahindra Bank" />
                        <Field label="Account Number" value={<span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 8px', borderRadius: 6 }}>XXXXXXXX36</span>} />
                        <Field label="IFSC Code"      value={<span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 8px', borderRadius: 6 }}>KKBK0000823</span>} />
                        <Field label="Name on Account" value={employee?.name} />
                        <Field label="Branch"         value="Silvaasa" />
                        <Field label="Account Type"   value="Salary" />
                      </Row>
                    </CardBody>
                  </Card>
                </Col>
                <Col xl={6}>
                  <Card className="h-100 mb-0" style={cardStyle}>
                    <CardBody>
                      <SectionHeader title="Identity Information" gradient={GRAD_PURPLE} icon="ri-user-2-line" />
                      <div className="mb-2 fw-semibold" style={{ color: '#5a3fd1' }}>
                        PAN Card <span className="badge rounded-pill ms-1" style={{ background: '#d6f4e3', color: '#108548', fontSize: 10 }}>● Verified</span>
                      </div>
                      <Row>
                        <Field label="PAN Number"  value={<span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 8px', borderRadius: 6 }}>XXXXXX89K</span>} />
                        <Field label="Name"        value={employee?.name} />
                        <Field label="Date of Birth" value="1985-11-02" />
                        <Field label="Parent Name" value="Kiran Kale" />
                      </Row>
                      <div className="mb-2 mt-2 fw-semibold" style={{ color: '#0a8a78' }}>
                        Aadhaar Card <span className="badge rounded-pill ms-1" style={{ background: '#d6f4e3', color: '#108548', fontSize: 10 }}>● Verified</span>
                      </div>
                      <Row>
                        <Field label="Aadhaar Number" value={<span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 8px', borderRadius: 6 }}>XXXX-XXXX-2821</span>} />
                        <Field label="Enrollment No"  value="147" />
                        <Field label="Address"        value="21 Jay Mahalar..." />
                        <Field label="Gender"         value="Male" />
                      </Row>
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <Card className="h-100 mb-0" style={cardStyle}>
                    <CardBody>
                      <SectionHeader title="Address Proof" gradient={GRAD_SUCCESS} icon="ri-map-pin-line" />
                      <div className="mb-2 fw-semibold" style={{ color: '#0a8a78' }}>
                        Aadhaar Card (Address Proof) <span className="badge rounded-pill ms-1" style={{ background: '#d6f4e3', color: '#108548', fontSize: 10 }}>● Verified</span>
                      </div>
                      <Row>
                        <Field label="Aadhaar Number" value={<span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 8px', borderRadius: 6 }}>XXXX-XXXX-2821</span>} />
                        <Field label="Enrollment No"  value="147" />
                        <Field label="Address"        value="21 Jay Mahalar, Pune" />
                        <Field label="Verification"   value="01/01/2024" />
                      </Row>
                    </CardBody>
                  </Card>
                </Col>
                <Col xl={6}>
                  <Card className="h-100 mb-0" style={cardStyle}>
                    <CardBody>
                      <SectionHeader title="Statutory Information" gradient={GRAD_WARNING} icon="ri-shield-line" />
                      <div className="mb-2">
                        <span className="badge rounded-pill" style={{ background: '#fde8c4', color: '#a4661c', fontSize: 11, padding: '4px 10px' }}>PT Details</span>
                      </div>
                      <Row>
                        <Field label="State"               value="Maharashtra" />
                        <Field label="Registered Location" value="Maharashtra" />
                        <Field label="PT Applicable"       value="Yes" />
                        <Field label="Professional Tax"    value="₹200/month" />
                      </Row>
                    </CardBody>
                  </Card>
                </Col>
              </Row>
            </>
          )}

          {payrollTab === 'details' && (
            <>
              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={5}>
                  <Card className="h-100 mb-0 border-0" style={{ borderRadius: 18, overflow: 'hidden' }}>
                    <div style={{ background: 'linear-gradient(135deg, #0ab39c 0%, #02c8a7 100%)', color: '#fff', padding: '20px 24px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: -30, right: -20, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.10)' }} />
                      <p className="mb-1 fs-11 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>Current Compensation</p>
                      <h2 className="mb-0 fw-bold text-white" style={{ fontSize: 36 }}>₹3,02,400</h2>
                      <p className="mb-3 fs-12" style={{ color: 'rgba(255,255,255,0.85)' }}>Per Annum</p>
                      <div className="d-flex gap-3 pt-3 border-top" style={{ borderColor: 'rgba(255,255,255,0.20) !important' }}>
                        <div>
                          <p className="mb-1 fs-10 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>Monthly</p>
                          <h6 className="mb-0 text-white fw-bold">₹25,200</h6>
                        </div>
                        <div className="ps-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.20)' }}>
                          <p className="mb-1 fs-10 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>Annual</p>
                          <h6 className="mb-0 text-white fw-bold">₹3,02,400</h6>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
                <Col xl={7}>
                  <Card className="h-100 mb-0" style={cardStyle}>
                    <CardBody>
                      <SectionHeader title="Payroll Info" gradient={GRAD_PURPLE} icon="ri-briefcase-line" />
                      <Row>
                        <Field label="Legal Entity"      value="INORBVICT Healthcare India Pvt. Ltd." />
                        <Field label="Remuneration Type" value="Annual" />
                        <Field label="Pay Cycle"         value="Monthly" />
                        <Field label="Payroll Status"    value="Active" />
                        <Field label="Tax Regime"        value="New Regime (115BAC)" />
                        <Field label="Pay Group"         value="Default" />
                      </Row>
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              <div
                className="d-flex align-items-center gap-2 mb-3"
                style={{ padding: '12px 16px', borderRadius: 12, background: '#fff7e6', border: '1px solid #fbcf8a', color: '#a4661c', fontSize: 13 }}
              >
                <i className="ri-information-line" style={{ fontSize: 16 }} />
                <span>Income and tax liability is being computed as per <strong>New Tax Regime</strong>. To switch to Old Tax Regime, contact your HR admin.</span>
              </div>

              <Card className="mb-3" style={cardStyle}>
                <CardBody>
                  <SectionHeader
                    title="Salary Timeline"
                    gradient={GRAD_SUCCESS}
                    icon="ri-line-chart-line"
                    action={
                      <button type="button" className="btn btn-sm rounded-pill fw-semibold" style={{ background: GRAD_SUCCESS, color: '#fff', border: 'none', boxShadow: '0 4px 10px rgba(10,179,156,0.25)', fontSize: 12, padding: '4px 14px' }}>
                        <i className="ri-edit-line me-1" /> Revise Salary
                      </button>
                    }
                  />
                  {[
                    { label: 'SALARY REVISION', tag: 'CURRENT', date: 'Effective 01 Nov 2025', regular: '₹3,02,400', total: '₹3,02,400', current: true },
                    { label: 'SALARY REVISION', tag: '',        date: 'Effective 23 May 2025', regular: '₹2,22,000', total: '₹2,22,000', current: false },
                    { label: 'SALARY REVISION', tag: '',        date: 'Effective 27 Jan 2025', regular: '₹72,000',   total: '₹72,000',   current: false },
                  ].map((row, idx) => (
                    <div key={idx} className="d-flex align-items-center gap-3 py-3 flex-wrap" style={{ borderBottom: idx < 2 ? '1px solid var(--vz-border-color)' : 'none' }}>
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0" style={{ width: 18, height: 18, background: row.current ? '#0ab39c' : 'transparent', border: row.current ? 'none' : '2px solid var(--vz-border-color)', boxShadow: row.current ? '0 0 0 4px rgba(10,179,156,0.18)' : 'none' }}>
                        {row.current && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                      </span>
                      <div className="flex-grow-1 min-w-0">
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <p className="mb-0 fs-11 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em' }}>{row.label}</p>
                          {row.tag && <span className="badge rounded-pill" style={{ background: '#d6f4e3', color: '#108548', fontSize: 10 }}>{row.tag}</span>}
                        </div>
                        <small className="text-muted">{row.date}</small>
                      </div>
                      <div className="text-end">
                        <p className="mb-0 fs-11 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)' }}>Regular Salary</p>
                        <h6 className="mb-0 fw-bold">{row.regular}</h6>
                      </div>
                      <span style={{ color: 'var(--vz-secondary-color)' }}>=</span>
                      <div className="text-end">
                        <p className="mb-0 fs-11 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)' }}>Total</p>
                        <h6 className="mb-0 fw-bold" style={{ color: '#5a3fd1' }}>{row.total}</h6>
                      </div>
                      <button type="button" className="btn btn-sm rounded-pill fw-semibold" style={{ background: '#fff', color: '#374151', border: '1px solid var(--vz-border-color)', fontSize: 12 }}>
                        View Breakdown
                      </button>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}

      {/* ── Tab: Expense Details ── */}
      {tab === 'expense' && (
        <>
          {/* Expense Overview hero — total claimed + 4 status counters */}
          <Card className="mb-3 border-0" style={{ borderRadius: 18, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg, #5a3fd1 0%, #6366f1 50%, #7c5cfc 100%)',
                color: '#fff',
                padding: '20px 24px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -40, right: -30, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
              <Row className="align-items-center g-3" style={{ position: 'relative' }}>
                <Col xs={12} lg className="min-w-0">
                  <p className="mb-1 fs-11 text-uppercase fw-semibold d-inline-flex align-items-center gap-1" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>
                    <i className="ri-wallet-3-line" /> Expense Overview
                  </p>
                  <h2 className="mb-0 fw-bold text-white" style={{ fontSize: 36 }}>
                    ₹{totalClaimed.toLocaleString('en-IN')}
                    <small className="ms-2 fs-13 fw-normal" style={{ color: 'rgba(255,255,255,0.85)' }}>Total Claimed</small>
                  </h2>
                </Col>
                <Col xs={12} lg="auto">
                  <div className="d-flex gap-2 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total',    value: expenseCounts.all,      color: '#fff' },
                      { label: 'Approved', value: expenseCounts.approved, color: '#86efac' },
                      { label: 'Pending',  value: expenseCounts.pending,  color: '#fcd34d' },
                      { label: 'Rejected', value: expenseCounts.rejected, color: '#fca5a5' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center px-3 py-2"
                        style={{
                          background: 'rgba(255,255,255,0.12)',
                          border: '1px solid rgba(255,255,255,0.20)',
                          borderRadius: 14,
                          backdropFilter: 'blur(6px)',
                          minWidth: 96,
                        }}
                      >
                        <h4 className="mb-0 fw-bold lh-1" style={{ color: c.color }}>{c.value}</h4>
                        <p className="mb-0 fs-10 text-uppercase fw-semibold mt-1" style={{ color: 'rgba(255,255,255,0.78)', letterSpacing: '0.06em' }}>
                          {c.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Expense Claims */}
          <Card className="mb-3" style={cardStyle}>
            <CardBody>
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-3">
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-3"
                    style={{ width: 36, height: 36, background: GRAD_PURPLE, boxShadow: '0 4px 10px rgba(64,81,137,0.20)' }}
                  >
                    <i className="ri-file-list-3-line" style={{ color: '#fff', fontSize: 16 }} />
                  </span>
                  <div>
                    <h5 className="card-title mb-0">Expense Claims</h5>
                    <small className="text-muted">
                      {expenseCounts.all} total · {expenseCounts.approved} approved · {expenseCounts.pending} pending
                    </small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <div className="search-box" style={{ minWidth: 220 }}>
                    <input type="text" className="form-control form-control-sm" placeholder="Search…" />
                    <i className="ri-search-line search-icon" />
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm rounded-pill fw-semibold"
                    style={{
                      background: 'var(--vz-card-bg)',
                      color: '#374151',
                      border: '1px solid var(--vz-border-color)',
                      fontSize: 12, padding: '6px 14px',
                    }}
                  >
                    <i className="ri-download-2-line me-1" /> Export
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm rounded-pill fw-semibold"
                    style={{
                      background: 'linear-gradient(135deg, #f97316, #fb923c)',
                      color: '#fff',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(249,115,22,0.30)',
                      fontSize: 12, padding: '6px 14px',
                    }}
                  >
                    <i className="ri-add-line me-1" /> Raise New Claim
                  </button>
                </div>
              </div>

              {/* Filter pills */}
              <div className="d-flex gap-2 flex-wrap mb-3">
                {[
                  { key: 'all'      as ExpenseFilter, label: 'All',      count: expenseCounts.all,      active: '#6366f1', tint: 'rgba(99,102,241,0.10)' },
                  { key: 'approved' as ExpenseFilter, label: 'Approved', count: expenseCounts.approved, active: '#10b981', tint: 'rgba(16,185,129,0.10)' },
                  { key: 'rejected' as ExpenseFilter, label: 'Rejected', count: expenseCounts.rejected, active: '#ef4444', tint: 'rgba(239,68,68,0.10)' },
                  { key: 'pending'  as ExpenseFilter, label: 'Pending',  count: expenseCounts.pending,  active: '#f59e0b', tint: 'rgba(245,158,11,0.10)' },
                ].map(f => {
                  const on = expenseFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setExpenseFilter(f.key)}
                      className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold"
                      style={{
                        fontSize: 12.5,
                        padding: '5px 14px',
                        background: on ? f.tint : 'var(--vz-card-bg)',
                        color: on ? f.active : 'var(--vz-secondary-color)',
                        border: `1px solid ${on ? f.active : 'var(--vz-border-color)'}`,
                        transition: 'all .15s ease',
                      }}
                    >
                      {f.label}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-pill"
                        style={{
                          minWidth: 22, height: 18,
                          padding: '0 7px',
                          background: on ? f.active : 'var(--vz-secondary-bg)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          fontSize: 10.5, fontWeight: 700,
                        }}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Claims table */}
              <div className="table-responsive">
                <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Exp ID</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Employee</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Category</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Description</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Expense Date</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Amount</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Proof of Payment</th>
                      <th style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--vz-secondary-color)', fontWeight: 700, padding: '10px 12px', borderBottom: '1px solid var(--vz-border-color)' }}>Payment Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-5 text-muted">
                          <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                          No claims match this filter.
                        </td>
                      </tr>
                    ) : filteredExpenses.map(c => {
                      const cat = EXPENSE_CATEGORY_TONE[c.category];
                      const st = EXPENSE_STATUS_TONE[c.status];
                      return (
                        <tr key={c.id}>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            <span
                              className="font-monospace fw-semibold"
                              style={{
                                fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
                                background: '#ece6ff', color: '#5a3fd1', letterSpacing: '0.02em',
                              }}
                            >
                              {c.id}
                            </span>
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            <div className="d-flex align-items-center gap-2">
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{
                                  width: 28, height: 28, fontSize: 11,
                                  background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                                  boxShadow: `0 2px 6px ${accent}40`,
                                }}
                              >
                                {initials}
                              </div>
                              <span className="fw-semibold">{employee?.name || employeeId}</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            <span
                              className="d-inline-flex align-items-center gap-1 fw-semibold"
                              style={{
                                fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
                                background: cat.bg, color: cat.fg,
                              }}
                            >
                              <i className={cat.icon} />
                              {c.category}
                            </span>
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            {c.description}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="text-muted">
                            {c.date}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }} className="fw-bold">
                            ₹{c.amount.toLocaleString('en-IN')}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            <a
                              href="#"
                              onClick={(e) => e.preventDefault()}
                              className="d-inline-flex align-items-center gap-1 text-decoration-none"
                              style={{
                                fontSize: 11.5,
                                padding: '4px 10px',
                                borderRadius: 8,
                                background: 'rgba(239,68,68,0.10)',
                                color: '#dc2626',
                                fontWeight: 600,
                              }}
                            >
                              <i className="ri-file-text-line" />
                              {c.receipt}…
                            </a>
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--vz-border-color)' }}>
                            {c.status === 'Pending' ? (
                              <div className="d-flex gap-2">
                                <button
                                  type="button"
                                  className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                                  style={{
                                    fontSize: 12,
                                    padding: '4px 12px',
                                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                                    color: '#fff', border: 'none',
                                    boxShadow: '0 3px 8px rgba(10,179,156,0.25)',
                                  }}
                                >
                                  <i className="ri-check-line" /> Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                                  style={{
                                    fontSize: 12,
                                    padding: '4px 12px',
                                    background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                                    color: '#fff', border: 'none',
                                    boxShadow: '0 3px 8px rgba(240,101,72,0.25)',
                                  }}
                                >
                                  <i className="ri-close-line" /> Reject
                                </button>
                              </div>
                            ) : (
                              <span
                                className="d-inline-flex align-items-center gap-1 fw-semibold"
                                style={{
                                  fontSize: 11.5,
                                  padding: '4px 12px',
                                  borderRadius: 999,
                                  background: st.bg,
                                  color: st.fg,
                                }}
                              >
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
                                {c.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
                <small className="text-muted">
                  Showing <strong className="text-body">{filteredExpenses.length}</strong> claim{filteredExpenses.length === 1 ? '' : 's'}
                </small>
                <small className="text-muted d-inline-flex align-items-center gap-1">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  Last updated: Apr 2026
                </small>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      </div>

      {/* ── Attendance Regularization Modal ── */}
      <Modal
        isOpen={regOpen}
        toggle={() => setRegOpen(false)}
        centered
        size="md"
        backdrop="static"
        className="ep-reg-modal"
        backdropClassName="ep-reg-backdrop"
      >
        <style>{`
          /* Lift the modal above the .ep-fullscreen-overlay (z-index 1080)
             so it isn't hidden behind the navy hero. Bootstrap defaults to
             1055/1050 which falls below the overlay. */
          .modal.ep-reg-modal { z-index: 1090; }
          .modal-backdrop.ep-reg-backdrop { z-index: 1085; }
          .ep-reg-modal .modal-content { border: none; border-radius: 14px; overflow: hidden; }
          .ep-reg-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 18px 22px; border-bottom: 1px solid var(--vz-border-color);
          }
          .ep-reg-header h5 { font-size: 16px; font-weight: 700; margin: 0; }
          .ep-reg-x {
            width: 30px; height: 30px; border-radius: 8px;
            background: var(--vz-light); border: 1px solid var(--vz-border-color);
            color: var(--vz-secondary-color); cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
          }
          .ep-reg-x:hover { background: var(--vz-secondary-bg); color: var(--vz-body-color); }
          .ep-reg-label {
            font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
            text-transform: uppercase; color: var(--vz-secondary-color);
            margin-bottom: 6px;
          }
          .ep-reg-input, .ep-reg-textarea {
            width: 100%; padding: 9px 12px;
            border: 1px solid var(--vz-border-color);
            border-radius: 8px;
            background: var(--vz-card-bg);
            color: var(--vz-body-color);
            font-size: 13px;
            transition: border-color .15s ease, box-shadow .15s ease;
          }
          .ep-reg-input:focus, .ep-reg-textarea:focus {
            outline: none; border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
          }
          .ep-reg-radio {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 10px 14px;
            border: 1px solid var(--vz-border-color);
            border-radius: 10px;
            cursor: pointer;
            transition: all .15s ease;
            background: var(--vz-card-bg);
            font-size: 13px;
          }
          .ep-reg-radio.is-on {
            border-color: #6366f1;
            background: rgba(99,102,241,0.06);
            box-shadow: inset 0 0 0 1px rgba(99,102,241,0.30);
          }
          .ep-reg-radio-dot {
            width: 16px; height: 16px; border-radius: 50%;
            border: 2px solid var(--vz-border-color);
            display: inline-flex; align-items: center; justify-content: center;
            flex-shrink: 0; margin-top: 1px;
            background: var(--vz-card-bg);
          }
          .ep-reg-radio.is-on .ep-reg-radio-dot { border-color: #6366f1; }
          .ep-reg-radio.is-on .ep-reg-radio-dot::after {
            content: ''; width: 7px; height: 7px; border-radius: 50%;
            background: #6366f1;
          }
          .ep-reg-chip {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 999px;
            font-size: 12px; font-weight: 600;
            background: rgba(99,102,241,0.10);
            color: #4338ca;
            border: 1px solid rgba(99,102,241,0.30);
          }
          .ep-reg-chip-x { cursor: pointer; opacity: 0.6; }
          .ep-reg-chip-x:hover { opacity: 1; }
          .ep-reg-add-btn {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 12px; border-radius: 8px;
            background: var(--vz-card-bg); color: var(--vz-body-color);
            border: 1px solid var(--vz-border-color);
            font-size: 12.5px; font-weight: 600;
            cursor: pointer; transition: all .15s ease;
          }
          .ep-reg-add-btn:hover {
            border-color: #6366f1; color: #6366f1;
            background: rgba(99,102,241,0.06);
          }
          .ep-reg-log-row {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 10px;
            border: 1px solid var(--vz-border-color);
            border-radius: 10px;
            background: var(--vz-card-bg);
          }
          .ep-reg-time-input {
            width: 64px; border: none; outline: none;
            padding: 4px 6px; font-size: 13px; font-weight: 600;
            background: transparent; color: var(--vz-body-color);
            text-align: center; font-variant-numeric: tabular-nums;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          }
          .ep-reg-time-input:focus {
            outline: 1px solid rgba(99,102,241,0.30);
            border-radius: 4px;
          }
          .ep-reg-log-icon { color: var(--vz-secondary-color); font-size: 14px; }
          .ep-reg-log-arrow { color: #ef4444; font-size: 14px; }
          .ep-reg-log-remove {
            margin-left: auto;
            width: 28px; height: 28px;
            display: inline-flex; align-items: center; justify-content: center;
            border-radius: 8px;
            background: rgba(239,68,68,0.10);
            color: #ef4444; cursor: pointer;
            border: 1px solid rgba(239,68,68,0.20);
            transition: all .15s ease;
          }
          .ep-reg-log-remove:hover {
            background: rgba(239,68,68,0.18);
            border-color: rgba(239,68,68,0.40);
          }
          .ep-reg-footer {
            display: flex; justify-content: flex-end; align-items: center; gap: 8px;
            padding: 16px 22px;
            border-top: 1px solid var(--vz-border-color);
          }
          .ep-reg-cancel {
            padding: 8px 18px;
            background: var(--vz-card-bg);
            color: var(--vz-body-color);
            border: 1px solid var(--vz-border-color);
            border-radius: 8px;
            font-size: 13px; font-weight: 600;
            cursor: pointer;
          }
          .ep-reg-submit {
            padding: 8px 22px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff; border: none;
            border-radius: 8px;
            font-size: 13px; font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(99,102,241,0.30);
          }
        `}</style>

        <div className="ep-reg-header">
          <h5>Request Attendance Regularization</h5>
          <button type="button" className="ep-reg-x" onClick={() => setRegOpen(false)} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 16 }} />
          </button>
        </div>

        <ModalBody style={{ padding: '20px 22px', maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Selected Date */}
          <div className="mb-3">
            <div className="ep-reg-label">Selected Date</div>
            <input className="ep-reg-input" value="29 Apr 2026" readOnly />
          </div>

          {/* Radio options */}
          <div className="d-flex flex-column gap-2 mb-2">
            <label className={`ep-reg-radio${regOption === 'adjust' ? ' is-on' : ''}`}>
              <span className="ep-reg-radio-dot" />
              <input
                type="radio"
                checked={regOption === 'adjust'}
                onChange={() => setRegOption('adjust')}
                style={{ display: 'none' }}
              />
              <span>Add/update time entries to adjust attendance logs.</span>
            </label>
            <label className={`ep-reg-radio${regOption === 'exempt' ? ' is-on' : ''}`}>
              <span className="ep-reg-radio-dot" />
              <input
                type="radio"
                checked={regOption === 'exempt'}
                onChange={() => setRegOption('exempt')}
                style={{ display: 'none' }}
              />
              <span>Raise regularization request to exempt this day from penalization policy.</span>
            </label>
          </div>
          <small className="text-muted d-block mb-3" style={{ fontSize: 12 }}>
            Click and select time stamp box that you would like to adjust and make changes to the time
          </small>

          {regOption === 'adjust' && (
            <>
              {/* Attendance Adjustment header + Add Log */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Attendance Adjustment</h6>
                <button
                  type="button"
                  className="ep-reg-add-btn"
                  onClick={() => setRegLogs(prev => [...prev, { id: `log-${Date.now()}`, from: '', to: '' }])}
                >
                  <i className="ri-add-line" /> Add Log
                </button>
              </div>

              {/* Work Location */}
              <div className="d-flex align-items-center justify-content-between mb-1">
                <div className="ep-reg-label" style={{ marginBottom: 0 }}>
                  Work Location <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>Select all that apply</small>
              </div>
              {regLocations.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {regLocations.map(loc => (
                    <span key={loc} className="ep-reg-chip">
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6366f1' }} />
                      {loc}
                      <i
                        className="ri-close-line ep-reg-chip-x"
                        onClick={() => setRegLocations(prev => prev.filter(l => l !== loc))}
                      />
                    </span>
                  ))}
                </div>
              )}
              <select
                className="ep-reg-input mb-1"
                value={regLocationDraft}
                onChange={e => {
                  const v = e.target.value;
                  if (v && !regLocations.includes(v)) {
                    setRegLocations(prev => [...prev, v]);
                  }
                  setRegLocationDraft('');
                }}
              >
                <option value="">— Select location —</option>
                {REG_LOCATION_OPTIONS.filter(o => !regLocations.includes(o)).map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <small className="text-muted d-block mb-3" style={{ fontSize: 11 }}>
                Select your work location(s) for this correction request
              </small>

              {/* Time-entry rows */}
              <div className="d-flex flex-column gap-2 mb-3">
                {regLogs.map(log => (
                  <div className="ep-reg-log-row" key={log.id}>
                    <i className="ri-checkbox-circle-fill" style={{ color: '#10b981', fontSize: 18 }} />
                    <input
                      type="text"
                      className="ep-reg-time-input"
                      value={log.from}
                      onChange={e => setRegLogs(prev => prev.map(l => l.id === log.id ? { ...l, from: e.target.value } : l))}
                      placeholder="00:00"
                    />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-arrow-right-up-line ep-reg-log-arrow" />
                    <input
                      type="text"
                      className="ep-reg-time-input"
                      value={log.to}
                      onChange={e => setRegLogs(prev => prev.map(l => l.id === log.id ? { ...l, to: e.target.value } : l))}
                      placeholder="00:00"
                    />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <button
                      type="button"
                      className="ep-reg-log-remove"
                      onClick={() => setRegLogs(prev => prev.filter(l => l.id !== log.id))}
                      aria-label="Remove log"
                    >
                      <i className="ri-subtract-line" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Note */}
          <div>
            <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Note</h6>
            <textarea
              className="ep-reg-textarea"
              placeholder="Enter note"
              rows={3}
              value={regNote}
              onChange={e => setRegNote(e.target.value)}
            />
          </div>
        </ModalBody>

        <div className="ep-reg-footer">
          <button type="button" className="ep-reg-cancel" onClick={() => setRegOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-reg-submit"
            onClick={() => { setRegOpen(false); }}
          >
            Request
          </button>
        </div>
      </Modal>
    </div>
  );
}
