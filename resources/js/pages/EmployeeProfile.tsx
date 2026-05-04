import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardBody, Col, Row, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';
import ComingSoonShell from '../components/ComingSoonShell';
import api from '../api';

// Custom portal-based modal — renders directly to document.body so it always
// escapes the .ep-fullscreen-overlay stacking context. Reactstrap's Modal had
// timing issues with our z-index overrides on first open; this is bulletproof.
function EpModal({ open, onClose, size = 'md', children, dismissOnBackdrop = false, panelClassName }: {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  dismissOnBackdrop?: boolean;
  panelClassName?: string;
}) {
  if (!open) return null;
  const widths = { sm: 420, md: 600, lg: 900, xl: 1180 };
  return createPortal(
    <div
      className="ep-modal-overlay"
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        className={`ep-modal-card ${panelClassName || ''}`}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%',
          maxWidth: widths[size],
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}


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

type TabKey = 'profile' | 'job' | 'attendance' | 'vault' | 'payroll' | 'expense' | 'apply_leave';
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

// Count-up number animation — mirrors the AnimatedNumber recipe used on the
// admin/client/branch dashboards so KPI tiles feel consistent across the app.
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

// Generic KPI tile — same recipe as the admin/client/branch dashboard
// `KpiCard` so every tile across the app reads consistently. The `tint` prop
// is accepted for backwards compatibility but ignored; the card always uses
// var(--vz-card-bg) and the gradient lives on the top strip + icon tile.
function KpiTile({ label, value, sub, icon, gradient }: { label: string; value: React.ReactNode; sub?: string; icon: string; gradient: string; tint?: string }) {
  return (
    <div
      className="ep-kpi-tile dashboard-surface"
      style={{
        borderRadius: 12,
        padding: '12px 14px 10px',
        boxShadow: '0 2px 14px rgba(0,0,0,0.05)',
        border: '1px solid var(--vz-border-color)',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        background: '#ffffff',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        cursor: 'default',
      }}
    >
      {/* Gradient top strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            {label}
          </p>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
            {value}
          </h3>
          {sub && <small className="text-muted d-block" style={{ fontSize: 10.5, marginTop: 4 }}>{sub}</small>}
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          boxShadow: '0 3px 8px rgba(0,0,0,0.10)',
        }}>
          <i className={icon} style={{ fontSize: 16, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

// Mock attendance history rows used inside the Attendance tab.
const ATTENDANCE_HISTORY = [
  { date: '21-Apr', day: 'Mon', shift: 'EARLY',   firstIn: '07:01', lastOut: '16:02', punches: 2, worked: '9h 01m', deviation: '+0h 01m', status: 'Present' },
  { date: '20-Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '19-Apr', day: 'Sat', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '18-Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:15', lastOut: '18:20', punches: 4, worked: '9h 05m', deviation: '+0h 05m', status: 'Present' },
  { date: '17-Apr', day: 'Thu', shift: 'GENERAL', firstIn: '10:02', lastOut: '19:15', punches: 4, worked: '9h 13m', deviation: '+0h 13m', status: 'Late' },
  { date: '16-Apr', day: 'Wed', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '15-Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:10', lastOut: '18:10', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '14-Apr', day: 'Mon', shift: 'GENERAL', firstIn: '09:05', lastOut: '18:07', punches: 4, worked: '9h 02m', deviation: '+0h 02m', status: 'Present' },
  { date: '13-Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '11-Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '10-Apr', day: 'Thu', shift: 'GENERAL', firstIn: '09:22', lastOut: '18:30', punches: 4, worked: '9h 08m', deviation: '+0h 08m', status: 'Present' },
  { date: '09-Apr', day: 'Wed', shift: 'GENERAL', firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Absent' },
  { date: '08-Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
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
      { name: 'Aadhaar Card',              idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI',           issueDate: '01-Jan-2020', attachment: 'Aadhaar.pdf', status: 'Verified' },
      { name: 'PAN Card',                  idNumber: 'ABCDE1234F',     authority: 'Income Tax Dept', issueDate: '01-Jan-2018', attachment: 'PAN.pdf',     status: 'Verified' },
      { name: 'Passport-size Photograph',                                                            issueDate: '01-Jan-2024', attachment: 'Photo.jpg',   status: 'Uploaded' },
    ],
  },
  {
    title: 'Address Proof', subtitle: 'Residential address verification documents',
    icon: 'ri-map-pin-line', iconTint: '#d6f4e3', iconFg: '#108548',
    docs: [
      { name: 'Aadhaar Card (Reused)', idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI', issueDate: '01-Jan-2020', expiryDate: '01-Jan-2030', attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { name: 'Current Address Proof',                                                  issueDate: '01-Jan-2022', expiryDate: '01-Jan-2027', attachment: 'CurrentAddr.pdf', status: 'Verified' },
      { name: 'Permanent Address Proof',                                                                                                                                  status: 'Pending'  },
    ],
  },
  {
    title: 'Education Documents', subtitle: 'Academic qualifications and credentials',
    icon: 'ri-graduation-cap-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: '10th Marksheet',         authority: 'State Board', issueDate: '01-May-2001', attachment: '10th.pdf',     status: 'Verified' },
      { name: '12th Marksheet',         authority: 'State Board', issueDate: '01-May-2003', attachment: '12th.pdf',     status: 'Verified' },
      { name: 'Graduation Marksheet',   authority: 'University',  issueDate: '01-Jun-2007', attachment: 'GradMark.pdf', status: 'Verified' },
      { name: 'Graduation Certificate', authority: 'University',  issueDate: '01-Oct-2007', attachment: 'GradCert.pdf', status: 'Pending'  },
    ],
  },
  {
    title: 'Previous Employment Documents', subtitle: 'Employment history, documents & background verification',
    icon: 'ri-briefcase-line', iconTint: '#fde8c4', iconFg: '#a4661c',
    docs: [
      { name: 'Experience Letter',      authority: 'Infotech Solutions Ltd', issueDate: '01-Nov-2023', attachment: 'ExpLetter.pdf',  status: 'Verified' },
      { name: 'Relieving Letter',       authority: 'Infotech Solutions Ltd', issueDate: '01-Nov-2023', attachment: 'Relieving.pdf',  status: 'Verified' },
      { name: 'Last 3 Pay Slips',       authority: 'Infotech Solutions Ltd', issueDate: '01-Oct-2023', attachment: 'PaySlips.pdf',   status: 'Verified' },
      { name: 'Form 16 (FY 2022-23)',   authority: 'Infotech Solutions Ltd', issueDate: '01-Jun-2023', attachment: 'Form16.pdf',     status: 'Verified' },
      { name: 'Bank Statement (3 mo.)', authority: 'Kotak Mahindra Bank',    issueDate: '01-Nov-2023', attachment: 'BankStmt.pdf',   status: 'Uploaded' },
      { name: 'Background Verification',authority: 'BGV Vendor',             issueDate: '15-Nov-2023', attachment: 'BGV.pdf',        status: 'Verified' },
      { name: 'Reference Check',        authority: 'BGV Vendor',             issueDate: '15-Nov-2023',                                status: 'Pending'  },
    ],
  },
];

const VAULT_ORG: OrgDocSection[] = [
  {
    title: 'Legal Agreements', subtitle: 'Binding legal documents signed between employee and organization',
    icon: 'ri-file-shield-2-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: 'Non-Disclosure Agreement (NDA)',           type: 'AGREEMENT', effectiveDate: '01-Nov-2023', validUntil: '01-Nov-2028', attachment: 'NDA.pdf',             status: 'Signed' },
      { name: 'Employment Agreement / Appointment Letter', type: 'AGREEMENT', effectiveDate: '03-Nov-2023',                           attachment: 'Appointment.pdf',     status: 'Signed' },
      { name: 'Confidentiality Agreement',                 type: 'AGREEMENT', effectiveDate: '03-Nov-2023',                           attachment: 'Confidentiality.pdf', status: 'Signed' },
    ],
  },
  {
    title: 'Company Policies', subtitle: 'Internal policies acknowledged and accepted by the employee',
    icon: 'ri-file-list-3-line', iconTint: '#d3f0ee', iconFg: '#0a716a',
    docs: [
      { name: 'Code of Conduct Policy',         type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'CodeOfConduct.pdf', status: 'Signed' },
      { name: 'IT Security & Acceptable Use Policy', type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'ITPolicy.pdf',   status: 'Signed' },
      { name: 'Leave & Attendance Policy',      type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'LeavePolicy.pdf',   status: 'Signed' },
      { name: 'Gratuity & Benefit Policy',      type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'GratuityPolicy.pdf', status: 'Pending' },
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
  { id: 'EXP-2201', category: 'Travel',          description: 'Client visit to Mumbai — cab + train',         date: '10-Apr-2026', amount: 2800, receipt: 'Receipt_EXP2201', status: 'Approved' },
  { id: 'EXP-2198', category: 'Meals',           description: 'Team lunch — project kickoff meeting',         date: '05-Apr-2026', amount: 850,  receipt: 'Receipt_EXP2198', status: 'Pending'  },
  { id: 'EXP-2181', category: 'Internet',        description: 'Monthly internet reimbursement — Apr',         date: '22-Mar-2026', amount: 999,  receipt: 'Receipt_EXP2181', status: 'Approved' },
  { id: 'EXP-2174', category: 'Travel',          description: 'Pune–Mumbai flight for quarterly review',      date: '15-Mar-2026', amount: 4500, receipt: 'Receipt_EXP2174', status: 'Rejected' },
  { id: 'EXP-2165', category: 'Office Supplies', description: 'Stationery and printer cartridges',            date: '08-Mar-2026', amount: 1200, receipt: 'Receipt_EXP2165', status: 'Approved' },
  { id: 'EXP-2150', category: 'Training',        description: 'Online certification course — AWS',            date: '01-Mar-2026', amount: 3500, receipt: 'Receipt_EXP2150', status: 'Pending'  },
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
  // Ancillary roles support multiple values per employee — accept either an
  // array or a single string from `employee.ancillaryRole`. Falls back to a
  // mock multi-role list so the directory→profile flow still showcases the
  // multi-pill scenario when no employee state is passed.
  const ancillaryList = Array.isArray(employee?.ancillaryRole)
    ? (employee?.ancillaryRole as string[]).filter(Boolean)
    : (employee?.ancillaryRole
        ? [employee.ancillaryRole as string]
        : ['Training Coordinator', 'Onboarding Buddy', 'Interviewer']);

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

  // Apply Leave wizard — rendered inline as the "Apply Leave" tab content.
  // All form state lives here so navigating between tabs preserves a draft.
  const [leaveStage, setLeaveStage] = useState(1);
  const [leaveType, setLeaveType] = useState<string>('');
  const [leaveDayType, setLeaveDayType] = useState<'full' | 'half'>('full');
  const [leaveFromDate, setLeaveFromDate] = useState<string>('');
  const [leaveToDate, setLeaveToDate] = useState<string>('');
  const [leaveReason, setLeaveReason] = useState<string>('');
  const [leaveDocName, setLeaveDocName] = useState<string>('');
  const [leaveNotify, setLeaveNotify] = useState<{ manager: boolean; deptHead: boolean; hr: boolean; team: boolean }>({
    manager: true, deptHead: false, hr: false, team: false,
  });
  const [leaveSpecificEmps, setLeaveSpecificEmps] = useState<string>('');
  const [leaveHandoverReq, setLeaveHandoverReq] = useState<boolean>(true);
  const [leaveCoverPerson, setLeaveCoverPerson] = useState<string>('');
  const [leaveHandoverNotes, setLeaveHandoverNotes] = useState<string>('');
  const [leaveCriticalTasks, setLeaveCriticalTasks] = useState<string>('');
  const [leaveAvailOnCall, setLeaveAvailOnCall] = useState<boolean>(true);
  const [leaveEmergencyNumber, setLeaveEmergencyNumber] = useState<string>('');
  const [leaveAvailNote, setLeaveAvailNote] = useState<string>('');

  // Reset wizard back to stage 1 (used when the user closes via the × button).
  const resetLeaveWizard = () => {
    setLeaveStage(1);
    setLeaveType('');
    setLeaveDayType('full');
    setLeaveFromDate('');
    setLeaveToDate('');
    setLeaveReason('');
    setLeaveDocName('');
    setLeaveNotify({ manager: true, deptHead: false, hr: false, team: false });
    setLeaveSpecificEmps('');
    setLeaveHandoverReq(true);
    setLeaveCoverPerson('');
    setLeaveHandoverNotes('');
    setLeaveCriticalTasks('');
    setLeaveAvailOnCall(true);
    setLeaveEmergencyNumber('');
    setLeaveAvailNote('');
  };

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

  // Today's date in "DD MMM YYYY" so the regularization modal shows the
  // correct selected day on every open instead of a stale hardcoded value.
  const regSelectedDate = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ /g, '-');

  // Toast hook (used by the Export Timelogs button) and last-7-month picker
  // for the timelog history filter.
  const toast = useToast();
  const [monthOpen, setMonthOpen] = useState(false);
  const ATT_MONTHS = (() => {
    const out: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        key: `${d.getFullYear()}-${d.getMonth() + 1}`,
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      });
    }
    return out;
  })();
  const [attMonth, setAttMonth] = useState<string>(ATT_MONTHS[0]?.label || 'April 2026');
  // Attendance Timelog History pagination — 6 rows per page to match the
  // compact card height used by the Attendance tab. Reset to page 0 whenever
  // the month filter changes so the user doesn't land on an empty page.
  const ATT_PAGE_SIZE = 6;
  const [attPage, setAttPage] = useState(0);
  useEffect(() => { setAttPage(0); }, [attMonth]);

  // Payslip viewer modal — opens from the "View Payslip" button in the
  // Payroll Summary hero. Filters by year/month and shows the rendered
  // payslip on the right with download/print/email actions in the header.
  const [paySlipOpen, setPaySlipOpen] = useState(false);
  const [paySlipYear, setPaySlipYear] = useState('2026');
  const [paySlipMonth, setPaySlipMonth] = useState('March');
  const PAYSLIP_RECENT = [
    { label: 'Mar 2026', now: true },
    { label: 'Feb 2026' },
    { label: 'Jan 2026' },
    { label: 'Dec 2025' },
    { label: 'Nov 2025' },
    { label: 'Oct 2025' },
  ];
  const PAYSLIP_EARNINGS = [
    { label: 'Basic Salary',          amount: 121000 },
    { label: 'House Rent Allowance (HRA)', amount: 60500 },
    { label: 'Special Allowance',     amount: 120900 },
  ];
  const PAYSLIP_DEDUCTIONS = [
    { label: 'Professional Tax',  amount: 200 },
    { label: 'Provident Fund (12%)', amount: 14520 },
    { label: 'Income Tax (TDS)',  amount: 8400 },
  ];
  const paySlipTotalEarnings   = PAYSLIP_EARNINGS.reduce((s, r) => s + r.amount, 0);
  const paySlipTotalDeductions = PAYSLIP_DEDUCTIONS.reduce((s, r) => s + r.amount, 0);
  const paySlipNetPay          = paySlipTotalEarnings - paySlipTotalDeductions;

  // Salary timeline + Revise Salary / View Breakdown modals (Payment Details
  // sub-tab). Timeline is defined here so both the inline list and the
  // breakdown modal stay in sync.
  const SALARY_TIMELINE = [
    { id: 'sal-1', dateShort: '01-Nov-2025', annual: 302400, current: true  },
    { id: 'sal-2', dateShort: '23-May-2025', annual: 222000, current: false },
    { id: 'sal-3', dateShort: '27-Jan-2025', annual: 72000,  current: false },
  ];
  function makeBreakdown(annual: number) {
    const monthly = annual / 12;
    // 40% / 20% / remainder split — same rule the HRMS reference uses.
    const basic   = Math.round(monthly * 0.40);
    const hra     = Math.round(monthly * 0.20);
    const special = Math.round(monthly - basic - hra);
    const totalMonthly = basic + hra + special;
    // Net pay ≈ gross − PF (12% of basic) − TDS (rough). Mirrors the screenshot
    // ratio (₹22,176 / ₹25,200 ≈ 0.88 of monthly gross).
    const netPay  = Math.round(totalMonthly * 0.88);
    return {
      rows: [
        { label: 'Basic Salary',                  monthly: basic,   annual: basic * 12   },
        { label: 'House Rent Allowance (HRA)',    monthly: hra,     annual: hra * 12     },
        { label: 'Special Allowance',             monthly: special, annual: special * 12 },
      ],
      totalMonthly,
      totalAnnual: totalMonthly * 12,
      netPay,
    };
  }
  const [reviseOpen, setReviseOpen]       = useState(false);
  const [reviseAmount, setReviseAmount]   = useState('3,50,000');
  const [revisePct, setRevisePct]         = useState('');
  const [reviseStructure, setReviseStructure] = useState('Class A');
  const [reviseDate, setReviseDate]       = useState('2026-05-01');
  const [reviseBonusInSal, setReviseBonusInSal] = useState(false);
  const [reviseBonusOpen, setReviseBonusOpen]   = useState(false);
  const [reviseBonusAmount, setReviseBonusAmount] = useState('');
  const [reviseNote, setReviseNote]       = useState('');
  const [showBreakdownToggle, setShowBreakdownToggle] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownRowId, setBreakdownRowId] = useState<string>('sal-1');
  const breakdownRow   = SALARY_TIMELINE.find(s => s.id === breakdownRowId) || SALARY_TIMELINE[0];
  const breakdownData  = makeBreakdown(breakdownRow.annual);

  // Live preview math for the Revise Salary modal.
  const reviseAnnualNum = Number(String(reviseAmount).replace(/[^\d.]/g, '')) || 0;
  const reviseMonthlyNum = reviseAnnualNum > 0 ? Math.round(reviseAnnualNum / 12) : 0;
  const currentAnnual = SALARY_TIMELINE[0].annual;
  const reviseDifference = reviseAnnualNum - currentAnnual;
  const revisePctChange  = currentAnnual > 0 ? ((reviseDifference / currentAnnual) * 100) : 0;

  // Submit New Expense Claim modal — opens from "+ Raise New Claim" in the
  // Expense Details tab. Two modes: Expense Claim (orange) and Advance
  // Request (purple/indigo).
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimMode, setClaimMode] = useState<'expense' | 'advance'>('expense');

  // Categories pulled from the expense_category master so the dropdown stays
  // in sync with what admins configure (and so we save the master id, not a
  // free-text label).
  const [claimCategories, setClaimCategories] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!claimOpen) return;
    api.get('/master/expense_category')
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setClaimCategories(
          rows
            .filter((r: any) => (r.status ?? 'Active') === 'Active')
            .map((r: any) => ({ id: Number(r.id), name: String(r.name ?? '') })),
        );
      })
      .catch(() => setClaimCategories([]));
  }, [claimOpen]);
  const categoryLabelById = (id: string | number | undefined): string => {
    if (id === undefined || id === '' || id === null) return '';
    const num = Number(id);
    const hit = claimCategories.find(c => c.id === num);
    return hit ? hit.name : String(id);
  };

  // Multi-draft tab support — every form-render reads/writes the active draft
  // in `claimDrafts`. "Save & Add Another" appends a fresh draft and switches
  // to it; clicking a tab swaps drafts in/out. This lets users line up several
  // claims in one sitting without losing in-progress work.
  type ClaimDraft = {
    employee: string;
    category: string;     // expense_category id (stringified)
    currency: string;
    project: string;
    payment: string;
    title: string;
    amount: string;
    date: string;
    vendor: string;
    purpose: string;
    saved: boolean;       // marked true once "Save & Add Another" / "Submit" runs on this draft
  };
  const blankDraft = (): ClaimDraft => ({
    employee: employeeId,
    category: '',
    currency: 'INR',
    project: '',
    payment: 'UPI',
    title: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    vendor: '',
    purpose: '',
    saved: false,
  });
  const [claimDrafts, setClaimDrafts] = useState<ClaimDraft[]>([blankDraft()]);
  const [activeClaimIdx, setActiveClaimIdx] = useState(0);
  // Each time the modal re-opens, start with one fresh draft.
  useEffect(() => {
    if (claimOpen) {
      setClaimDrafts([blankDraft()]);
      setActiveClaimIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen]);
  const draft = claimDrafts[activeClaimIdx] ?? blankDraft();
  const updateDraft = (patch: Partial<ClaimDraft>) =>
    setClaimDrafts(d => d.map((x, i) => (i === activeClaimIdx ? { ...x, ...patch } : x)));
  const saveAndAddAnother = () => {
    setClaimDrafts(d => {
      const next = d.map((x, i) => (i === activeClaimIdx ? { ...x, saved: true } : x));
      next.push(blankDraft());
      return next;
    });
    setActiveClaimIdx(i => i + 1);
  };

  // Aliases so the existing JSX bindings (claimEmployee, setClaimEmployee, …)
  // keep working without touching every value/onChange site below.
  const claimEmployee = draft.employee;
  const setClaimEmployee = (v: string) => updateDraft({ employee: v });
  const claimCategory = draft.category;
  const setClaimCategory = (v: string) => updateDraft({ category: v });
  const claimCurrency = draft.currency;
  const setClaimCurrency = (v: string) => updateDraft({ currency: v });
  const claimProject = draft.project;
  const setClaimProject = (v: string) => updateDraft({ project: v });
  const claimPayment = draft.payment;
  const setClaimPayment = (v: string) => updateDraft({ payment: v });
  const claimTitle = draft.title;
  const setClaimTitle = (v: string) => updateDraft({ title: v });
  const claimAmount = draft.amount;
  const setClaimAmount = (v: string) => updateDraft({ amount: v });
  const claimDate = draft.date;
  const setClaimDate = (v: string) => updateDraft({ date: v });
  const claimVendor = draft.vendor;
  const setClaimVendor = (v: string) => updateDraft({ vendor: v });
  const claimPurpose = draft.purpose;
  const setClaimPurpose = (v: string) => updateDraft({ purpose: v });
  // Advance request fields
  const [advType, setAdvType] = useState('');
  const [advTypeOther, setAdvTypeOther] = useState(''); // shown only when advType === 'Other'
  const [advAmount, setAdvAmount] = useState('');
  const [advRequestedDate, setAdvRequestedDate] = useState(new Date().toISOString().slice(0, 10));
  const [advRecoveryStart, setAdvRecoveryStart] = useState('');
  const [advRecoveryMode, setAdvRecoveryMode] = useState('');
  const [advMonths, setAdvMonths] = useState('');
  const [advReason, setAdvReason] = useState('');
  // Editable EMI — auto-derived from amount/months unless the user has typed
  // a value into the field. `advEmiTouched` flips on any keystroke and stops
  // the auto-fill from overwriting their manual override.
  const [advMonthlyEmi, setAdvMonthlyEmi] = useState('');
  const [advEmiTouched, setAdvEmiTouched] = useState(false);
  useEffect(() => {
    if (advEmiTouched) return;
    const a = Number(String(advAmount).replace(/[^\d.]/g, ''));
    const m = Number(advMonths);
    if (a > 0 && m > 0) {
      setAdvMonthlyEmi(String(Math.round(a / m)));
    } else {
      setAdvMonthlyEmi('');
    }
  }, [advAmount, advMonths, advEmiTouched]);
  // Reset the manual-override flag every time the modal re-opens so the
  // auto-fill kicks back in for a fresh request.
  useEffect(() => {
    if (claimOpen) setAdvEmiTouched(false);
  }, [claimOpen]);
  // Multi-file attachments — separate buckets for expense receipts vs advance
  // supporting docs so the two flows don't bleed into each other.
  const [claimFiles, setClaimFiles] = useState<File[]>([]);
  const [advFiles, setAdvFiles] = useState<File[]>([]);
  // Reset attachments + custom advance-type field every time the modal opens.
  useEffect(() => {
    if (claimOpen) {
      setClaimFiles([]);
      setAdvFiles([]);
      setAdvTypeOther('');
    }
  }, [claimOpen]);

  // Locally-submitted expense claims — appended to the top of the table when
  // the user clicks "Submit Claim" (or commits drafts via "Save & Add Another"
  // followed by Submit). Lives in component state since there's no claims API
  // wired yet; categories are resolved to their human-readable label here so
  // the table render path doesn't need to know about master ids.
  type SubmittedClaim = {
    id: string;
    category: string;
    description: string;
    date: string;
    amount: number;
    receipt: string;
    status: 'Pending' | 'Approved' | 'Rejected';
  };
  const [submittedClaims, setSubmittedClaims] = useState<SubmittedClaim[]>([]);
  const submitAllDrafts = () => {
    const ts = Date.now();
    const valid = claimDrafts.filter(d => d.title.trim() && d.amount.trim());
    if (valid.length === 0) {
      setClaimOpen(false);
      return;
    }
    const newClaims: SubmittedClaim[] = valid.map((d, i) => ({
      id: `EXP-${String(ts).slice(-4)}${String(i + 1).padStart(2, '0')}`,
      category: categoryLabelById(d.category) || '—',
      description: d.title.trim(),
      date: d.date,
      amount: Number(String(d.amount).replace(/[^\d.]/g, '')) || 0,
      receipt: `Receipt_${d.title.trim().slice(0, 12) || 'pending'}`,
      status: 'Pending',
    }));
    setSubmittedClaims(prev => [...newClaims, ...prev]);
    setClaimOpen(false);
  };

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
    { key: 'apply_leave',label: 'Apply Leave',     icon: 'ri-calendar-2-line',          color: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' },
  ];

  // Onboarding progress as a numeric percent for the hero ring chart.
  const onboardingPct =
      employee?.onboarding === 'Completed'   ? 100
    : employee?.onboarding === 'In Progress' ? 65
    : employee?.onboarding === 'Pending'     ? 25
    :                                          83;

  // Pre-compute counts and the filtered list once per render so the filter
  // tabs stay in sync with the table. Locally-submitted claims (from the
  // Raise New Claim modal) are merged on top of the static mock dataset so
  // newly created entries appear immediately without a backend round-trip.
  const allExpenseClaims = [...submittedClaims, ...EXPENSE_CLAIMS];
  const expenseCounts = {
    all:      allExpenseClaims.length,
    approved: allExpenseClaims.filter(c => c.status === 'Approved').length,
    rejected: allExpenseClaims.filter(c => c.status === 'Rejected').length,
    pending:  allExpenseClaims.filter(c => c.status === 'Pending').length,
  };
  const totalClaimed = allExpenseClaims.reduce((sum, c) => sum + c.amount, 0);
  const filteredExpenses = expenseFilter === 'all'
    ? allExpenseClaims
    : allExpenseClaims.filter(c => c.status.toLowerCase() === expenseFilter);

  return (
    <>
    {/* Inject the shared master form theme so MasterSelect / MasterDatePicker
        used inside the modals pick up the same look as the master forms. */}
    <MasterFormStyles />
    <div className="ep-fullscreen-overlay">
      <style>{`
        /* Full-screen overlay so the employee profile reads as a dedicated
           workspace with no app chrome (sidebar + topbar) competing for
           attention. Matches the HRMS reference design. */
        .ep-fullscreen-overlay {
          position: fixed; inset: 0; z-index: 1080;
          display: flex; flex-direction: column;
          background: var(--vz-body-bg, #f3f4f9);
        }
        .ep-content-pane {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          padding-bottom: 32px;
        }
        /* Keep the regularization modal above the fullscreen overlay
           (Bootstrap defaults to 1055/1050 which falls below the 1080
           overlay, so the popup would be invisible). Defined globally so
           the rule applies on the very first open. */
        .modal.ep-reg-modal { z-index: 2100 !important; }
        .modal-backdrop.ep-reg-backdrop { z-index: 2095 !important; }
        /* MasterSelect / MasterDatePicker popups default to z-index 2000,
           which sits BELOW our EpModal overlay (5000). Lift them so the
           calendar / dropdown menu paint on top of the modal. */
        .master-select-menu,
        .master-datepicker-popup,
        .master-yearmonth-popup { z-index: 6000 !important; }
        .modal.ep-pay-modal { z-index: 2100 !important; }
        .modal-backdrop.ep-pay-backdrop { z-index: 2095 !important; }
        .modal.ep-rev-modal { z-index: 2100 !important; }
        .modal-backdrop.ep-rev-backdrop { z-index: 2095 !important; }
        .modal.ep-bd-modal { z-index: 2100 !important; }
        .modal-backdrop.ep-bd-backdrop { z-index: 2095 !important; }

        /* ── Revise Salary modal ── */
        .ep-rev-modal .modal-content { border: none; border-radius: 14px; overflow: hidden; }
        .ep-rev-modal .modal-dialog { max-width: 1180px; }
        .ep-rev-hero {
          background: linear-gradient(135deg,#064e3b,#065f46,#059669);
          color: #fff; padding: 12px 18px;
        }
        .ep-rev-cancel-hero {
          padding: 4px 12px; background: rgba(255,255,255,0.10);
          color: #fff; border: 1px solid rgba(255,255,255,0.30);
          border-radius: 7px; font-size: 11.5px; font-weight: 600; cursor: pointer;
        }
        .ep-rev-cancel-hero:hover { background: rgba(255,255,255,0.20); }
        .ep-rev-submit-hero {
          padding: 4px 14px; background: #ffffff; color: #047857;
          border: none; border-radius: 7px;
          font-size: 11.5px; font-weight: 700; cursor: pointer;
          box-shadow: 0 3px 10px rgba(0,0,0,0.18);
        }
        .ep-rev-submit-hero:hover { background: #f0fdf4; }
        .ep-rev-strip {
          display: grid; grid-template-columns: 1.4fr repeat(5, 1fr);
          margin-top: 10px;
          padding: 8px 10px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 9px;
        }
        .ep-rev-strip-cell { display: flex; align-items: center; gap: 8px; padding: 0 10px; }
        .ep-rev-strip-cell + .ep-rev-strip-cell { border-left: 1px solid rgba(255,255,255,0.14); }
        .ep-rev-avatar {
          width: 32px; height: 32px; border-radius: 8px;
          background: #4f46e5;
          color: #fff; font-weight: 700; font-size: 11.5px;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid rgba(255,255,255,0.20);
          flex-shrink: 0;
          box-shadow: 0 3px 8px rgba(79,70,229,0.28);
        }
        .ep-rev-strip-label {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: rgba(255,255,255,0.65);
        }
        .ep-rev-strip-value { font-size: 11.5px; font-weight: 700; color: #fff; line-height: 1.25; }
        .ep-rev-strip-sub  { font-size: 10px; color: rgba(255,255,255,0.70); line-height: 1.2; }

        .ep-rev-body {
          display: grid; grid-template-columns: 1fr 300px;
          gap: 0;
          background: var(--vz-body-bg, #f3f4f9);
        }
        .ep-rev-form { padding: 12px; }
        .ep-rev-card {
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .ep-rev-icon {
          width: 28px; height: 28px; border-radius: 8px;
          color: #fff; font-size: 14px;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ep-rev-label {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 4px;
        }
        .ep-rev-input {
          width: 100%; padding: 6px 10px;
          border: 1px solid var(--vz-border-color);
          border-radius: 7px; background: var(--vz-card-bg);
          color: var(--vz-body-color); font-size: 11.5px;
        }
        .ep-rev-input:focus { outline: none; border-color: #0ab39c; box-shadow: 0 0 0 3px rgba(10,179,156,0.18); }
        .ep-rev-add-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; background: rgba(10,179,156,0.08);
          color: #0a8a78; border: 1px dashed rgba(10,179,156,0.45);
          border-radius: 999px; font-size: 10.5px; font-weight: 600;
          cursor: pointer; transition: all .15s ease;
        }
        .ep-rev-add-btn:hover {
          background: rgba(10,179,156,0.16);
          border-color: rgba(10,179,156,0.65);
        }
        .ep-rev-add-btn i { font-size: 12px; line-height: 1; }

        .ep-rev-preview {
          padding: 12px;
          border-left: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
        }
        .ep-rev-net {
          background: linear-gradient(135deg, #064e3b, #065f46, #059669);
          color: #fff;
          padding: 10px 14px;
          border-radius: 10px;
          margin-bottom: 10px;
          box-shadow: 0 4px 14px rgba(4,120,87,0.25);
          position: relative;
          overflow: hidden;
        }
        .ep-rev-net::before {
          content: '';
          position: absolute;
          top: -30px; right: -20px;
          width: 110px; height: 110px;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
          pointer-events: none;
        }
        .ep-rev-net > * { position: relative; }
        .ep-rev-summary {
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .ep-rev-summary-head {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.10em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 6px;
        }
        .ep-rev-summary-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 0; font-size: 11.5px;
          border-bottom: 1px dashed var(--vz-border-color);
        }
        .ep-rev-summary-row:last-child { border-bottom: none; }

        /* ── Salary Breakdown modal ── */
        .ep-bd-modal .modal-content { border: none; border-radius: 16px; overflow: hidden; }
        .ep-bd-modal .modal-dialog { max-width: 1100px; }
        .ep-bd-hero {
          background: linear-gradient(135deg,#064e3b,#065f46,#059669);
          color: #fff; padding: 22px 26px;
        }
        .ep-bd-close {
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.30);
          color: #fff; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ep-bd-close:hover { background: rgba(255,255,255,0.25); }
        .ep-bd-body {
          display: grid; grid-template-columns: 1fr 280px;
          gap: 0; background: var(--vz-body-bg, #f3f4f9);
          max-height: 78vh; overflow-y: auto;
        }
        .ep-bd-main { padding: 22px; }
        .ep-bd-card {
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 12px; overflow: hidden;
        }
        .ep-bd-table { width: 100%; font-size: 12.5px; margin: 0; }
        .ep-bd-table th {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          padding: 9px 16px;
          background: var(--vz-secondary-bg);
          border-bottom: 1px solid var(--vz-border-color);
        }
        .ep-bd-table td {
          padding: 12px 16px; border-bottom: 1px solid var(--vz-border-color);
        }
        .ep-bd-table tbody tr:last-child td { border-bottom: none; }
        .ep-bd-net {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; padding: 18px 22px;
          background: linear-gradient(135deg, #047857 0%, #0a8a5a 100%);
          color: #fff;
        }
        .ep-bd-note {
          display: flex; align-items: flex-start; gap: 10px;
          margin-top: 14px; padding: 12px 16px;
          background: rgba(245,158,11,0.10);
          border: 1px solid rgba(245,158,11,0.30);
          border-radius: 10px;
          color: #a16207; font-size: 12.5px;
        }
        .ep-bd-history {
          padding: 22px;
          border-left: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
        }
        .ep-bd-version {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 10px 12px; margin-bottom: 12px;
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          width: 100%; cursor: pointer;
          transition: all .15s ease;
          position: relative;
        }
        .ep-bd-version:hover { border-color: #0ab39c; }
        .ep-bd-version.is-current {
          background: rgba(10,179,156,0.06);
          border-color: rgba(10,179,156,0.40);
          box-shadow: inset 0 0 0 1px rgba(10,179,156,0.30);
        }
        .ep-bd-dot {
          width: 16px; height: 16px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 2px;
          margin-left: -22px;
          z-index: 1;
        }
        .ep-bd-now {
          background: linear-gradient(135deg,#0ab39c,#30d5b5); color: #fff;
          font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
          padding: 2px 8px; border-radius: 999px;
        }

        @media (max-width: 991.98px) {
          .ep-rev-body, .ep-bd-body { grid-template-columns: 1fr; }
          .ep-rev-preview, .ep-bd-history { border-left: none; border-top: 1px solid var(--vz-border-color); }
          .ep-rev-strip { grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .ep-rev-strip-cell + .ep-rev-strip-cell { border-left: none; }
        }

        /* ── Submit New Expense Claim modal ── */
        .ep-claim-modal { --accent: #f97316; --accent-2: #fb923c; --accent-soft: rgba(249,115,22,0.10); --accent-border: rgba(249,115,22,0.30); }
        .ep-claim-modal.is-advance { --accent: #6366f1; --accent-2: #8b5cf6; --accent-soft: rgba(99,102,241,0.10); --accent-border: rgba(99,102,241,0.30); }
        .ep-claim-hero {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
          color: #fff; padding: 12px 16px;
        }
        .ep-claim-icon {
          width: 34px; height: 34px; border-radius: 10px;
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.30);
          color: #fff; font-size: 15px;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ep-claim-mode-pill {
          background: rgba(255,255,255,0.18);
          border: 1px solid rgba(255,255,255,0.30);
          color: #fff;
          font-size: 9px; font-weight: 700; letter-spacing: 0.10em;
          padding: 3px 10px; border-radius: 999px;
        }
        .ep-claim-x {
          width: 26px; height: 26px; border-radius: 50%;
          background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.30);
          color: #fff; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ep-claim-x:hover { background: rgba(255,255,255,0.28); }
        .ep-claim-tabs {
          display: inline-flex; gap: 0;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 8px; padding: 3px;
        }
        .ep-claim-tab {
          background: transparent; border: none;
          padding: 4px 11px; border-radius: 6px;
          font-size: 11px; font-weight: 600;
          color: rgba(255,255,255,0.75);
          cursor: pointer; transition: all .15s ease;
          display: inline-flex; align-items: center; gap: 5px;
        }
        .ep-claim-tab:hover { color: #fff; background: rgba(255,255,255,0.10); }
        .ep-claim-tab.is-active { background: #fff; color: var(--accent); box-shadow: 0 3px 8px rgba(0,0,0,0.15); }

        .ep-claim-body {
          padding: 14px;
          overflow-y: auto;
          flex: 1 1 auto;
          background: var(--vz-card-bg);
        }
        .ep-claim-section-head {
          display: flex; align-items: center; gap: 6px;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.10em;
          text-transform: uppercase; color: var(--accent);
          margin-bottom: 8px;
        }
        .ep-claim-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
        .ep-claim-dot.is-faded { opacity: 0.4; }

        /* ── Draft tabs strip — sits above section A so users can hop between
           the multiple in-progress claims spawned by "Save & Add Another". */
        .ep-claim-tabs-strip {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 6px 0 10px; margin-bottom: 8px;
          border-bottom: 1px dashed var(--vz-border-color);
        }
        .ep-claim-draft-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 10px 5px 12px; border-radius: 999px;
          background: var(--vz-secondary-bg);
          border: 1px solid var(--vz-border-color);
          color: var(--vz-secondary-color);
          font-size: 11px; font-weight: 600;
          cursor: pointer; transition: all .15s ease;
        }
        .ep-claim-draft-tab:hover {
          background: var(--accent-soft); color: var(--accent);
          border-color: var(--accent-border);
        }
        .ep-claim-draft-tab.is-active {
          background: var(--accent); color: #fff; border-color: var(--accent);
          box-shadow: 0 2px 6px var(--accent-soft);
        }
        .ep-claim-draft-tab.is-saved:not(.is-active) {
          background: rgba(16,133,72,0.10);
          color: #108548; border-color: rgba(16,133,72,0.25);
        }
        .ep-claim-draft-tab-x {
          display: inline-flex; align-items: center; justify-content: center;
          width: 14px; height: 14px; border-radius: 50%;
          background: rgba(0,0,0,0.10); color: inherit;
          font-size: 10px; line-height: 1;
        }
        .ep-claim-draft-tab.is-active .ep-claim-draft-tab-x {
          background: rgba(255,255,255,0.25);
        }
        .ep-claim-draft-tab-x:hover { background: rgba(0,0,0,0.20); }

        /* ── File-list rows — rendered below an upload area when one or more
           files have been picked. Same look in both the expense (orange) and
           advance (indigo) modes; tone is inherited from --accent. */
        .ep-claim-file-list {
          display: flex; flex-direction: column; gap: 6px;
        }
        .ep-claim-file-row {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 10px; border-radius: 8px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
        }
        .ep-claim-file-icon {
          color: var(--accent); font-size: 14px; flex-shrink: 0;
        }
        .ep-claim-file-meta { flex-grow: 1; min-width: 0; }
        .ep-claim-file-name {
          font-size: 11.5px; font-weight: 600;
          color: var(--vz-heading-color, var(--vz-body-color));
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ep-claim-file-size {
          font-size: 10px; color: var(--vz-secondary-color); margin-top: 1px;
        }
        .ep-claim-file-x {
          display: inline-flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; border-radius: 50%;
          background: rgba(0,0,0,0.06); color: var(--vz-secondary-color);
          border: none; font-size: 12px; cursor: pointer; flex-shrink: 0;
          transition: background .15s ease, color .15s ease;
        }
        .ep-claim-file-x:hover { background: #ef4444; color: #fff; }

        /* ── Approval Flow card — replaces the old "System Intelligence"
           placeholder. Renders the You → Reporting Manager → HR/Finance chain. */
        .ep-claim-flow {
          display: flex; align-items: center; gap: 8px;
          padding: 12px; border-radius: 10px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
          flex-wrap: wrap;
        }
        .ep-claim-flow-step {
          display: flex; align-items: center; gap: 8px;
          flex: 1 1 auto; min-width: 0;
        }
        .ep-claim-flow-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 9px;
          color: #fff; font-size: 14px; flex-shrink: 0;
        }
        .ep-claim-flow-title {
          font-size: 11.5px; font-weight: 700;
          color: var(--vz-heading-color, var(--vz-body-color));
          line-height: 1.2;
        }
        .ep-claim-flow-sub {
          font-size: 10px; color: var(--vz-secondary-color);
          line-height: 1.2; margin-top: 2px;
        }
        .ep-claim-flow-arrow {
          color: var(--accent); font-size: 16px; flex-shrink: 0;
        }
        .ep-claim-label {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 4px;
        }
        .ep-claim-req { color: #ef4444; }
        .ep-claim-input {
          width: 100%; padding: 6px 10px;
          border: 1px solid var(--vz-border-color);
          border-radius: 7px; background: var(--vz-card-bg);
          color: var(--vz-body-color); font-size: 11.5px;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .ep-claim-input:focus {
          outline: none; border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .ep-claim-upload {
          padding: 14px; text-align: center;
          background: var(--accent-soft);
          border: 2px dashed var(--accent-border);
          border-radius: 10px;
          cursor: pointer;
          transition: background .15s ease;
        }
        .ep-claim-upload:hover { background: rgba(249,115,22,0.16); }
        .is-advance .ep-claim-upload:hover { background: rgba(99,102,241,0.14); }
        .ep-claim-upload-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 9px;
          background: rgba(249,115,22,0.15); color: var(--accent);
          margin-bottom: 6px; font-size: 14px;
        }
        .ep-claim-intel {
          padding: 10px 12px;
          background: var(--vz-secondary-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 8px;
          min-height: 44px;
          display: flex; align-items: center; justify-content: center;
        }
        .ep-claim-route {
          padding: 10px 12px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
          border-radius: 10px;
        }
        .ep-claim-stepper {
          display: flex; align-items: center; justify-content: space-between;
          gap: 4px; position: relative;
        }
        .ep-claim-step {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          flex: 1; min-width: 0; position: relative;
        }
        .ep-claim-step-icon {
          width: 28px; height: 28px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          color: var(--vz-secondary-color);
          font-size: 13px; z-index: 1;
        }
        .ep-claim-step-icon.is-active {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff; border-color: var(--accent);
          box-shadow: 0 3px 8px var(--accent-border);
        }
        .ep-claim-step-label { font-size: 9.5px; font-weight: 600; color: var(--vz-secondary-color); }
        .ep-claim-step-line {
          position: absolute; top: 14px; left: 50%; right: -50%;
          height: 2px; background: var(--vz-border-color); z-index: 0;
        }
        .ep-claim-step-line.is-active { background: var(--accent); }
        .ep-claim-audit {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff;
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          padding: 3px 8px; border-radius: 999px;
        }
        .ep-claim-route-hint {
          font-size: 10px; color: var(--accent);
          padding: 5px 10px; background: rgba(255,255,255,0.55);
          border-radius: 7px;
        }

        .ep-claim-banner {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; margin-bottom: 12px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
          border-radius: 10px;
        }
        .ep-claim-banner-icon {
          width: 30px; height: 30px; border-radius: 8px;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff; font-size: 14px;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ep-claim-flow-pill {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff;
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          padding: 3px 8px; border-radius: 999px;
        }
        .ep-claim-warn {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 8px 12px;
          background: rgba(245,158,11,0.10);
          border: 1px solid rgba(245,158,11,0.30);
          border-radius: 8px;
          color: #a16207; font-size: 10.5px;
        }
        .ep-claim-warn i { font-size: 13px; flex-shrink: 0; margin-top: 2px; }

        .ep-claim-footer {
          display: flex; align-items: center; gap: 6px;
          padding: 10px 16px;
          border-top: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
        }
        .ep-claim-cancel {
          padding: 4px 14px;
          background: var(--vz-card-bg); color: var(--vz-body-color);
          border: 1px solid var(--vz-border-color);
          border-radius: 7px; font-size: 11.5px; font-weight: 600;
          cursor: pointer;
        }
        .ep-claim-secondary {
          padding: 4px 12px;
          background: var(--vz-card-bg); color: var(--vz-body-color);
          border: 1px solid var(--vz-border-color);
          border-radius: 7px; font-size: 11px; font-weight: 600;
          cursor: pointer;
        }
        .ep-claim-secondary:hover { border-color: var(--accent); color: var(--accent); }
        .ep-claim-submit {
          padding: 4px 16px;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff; border: none; border-radius: 7px;
          font-size: 11.5px; font-weight: 700; cursor: pointer;
          box-shadow: 0 3px 10px var(--accent-border);
        }
        .ep-claim-submit:hover { transform: translateY(-1px); }
        .ep-pay-modal .modal-content { border: none; border-radius: 16px; overflow: hidden; }
        .ep-pay-modal .modal-dialog { max-width: 1300px; }

        .ep-pay-shell { background: var(--vz-card-bg); }
        .ep-pay-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; padding: 10px 16px;
          border-bottom: 1px solid var(--vz-border-color);
        }
        .ep-pay-logo {
          width: 32px; height: 32px; border-radius: 8px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff; display: inline-flex; align-items: center; justify-content: center;
          font-size: 14px; box-shadow: 0 3px 10px rgba(99,102,241,0.28);
        }
        .ep-pay-x {
          width: 28px; height: 28px; border-radius: 7px;
          background: var(--vz-light); border: 1px solid var(--vz-border-color);
          color: var(--vz-secondary-color); cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ep-pay-x:hover { background: var(--vz-secondary-bg); }

        .ep-pay-body {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: 0;
          max-height: 80vh; overflow-y: auto;
        }
        .ep-pay-sidebar {
          padding: 14px 12px;
          border-right: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
        }
        .ep-pay-side-label {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.10em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 8px;
        }
        .ep-pay-mini-label {
          font-size: 9.5px; font-weight: 700;
          color: var(--vz-secondary-color); margin-bottom: 3px;
        }
        .ep-pay-input {
          width: 100%; padding: 5px 9px;
          border: 1px solid var(--vz-border-color);
          border-radius: 7px; background: var(--vz-card-bg);
          color: var(--vz-body-color); font-size: 11.5px;
        }
        .ep-pay-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.18); }
        .ep-pay-side-btn {
          width: 100%; padding: 5px 12px;
          background: linear-gradient(135deg, #4338ca, #6366f1);
          color: #fff; border: none; border-radius: 8px;
          font-size: 11.5px; font-weight: 600;
          cursor: pointer;
          box-shadow: 0 3px 10px rgba(99,102,241,0.28);
          transition: transform .15s ease;
        }
        .ep-pay-side-btn:hover { transform: translateY(-1px); }
        .ep-pay-recent {
          display: flex; align-items: center; justify-content: space-between;
          padding: 5px 10px;
          border: 1px solid var(--vz-border-color);
          border-radius: 8px;
          background: var(--vz-card-bg);
          color: var(--vz-body-color);
          font-size: 11.5px; font-weight: 600;
          cursor: pointer; transition: all .15s ease;
        }
        .ep-pay-recent:hover { border-color: #6366f1; color: #6366f1; }
        .ep-pay-recent.is-current {
          background: rgba(99,102,241,0.08);
          border-color: rgba(99,102,241,0.40);
          color: #4338ca;
        }
        .ep-pay-now {
          background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
          font-size: 8px; font-weight: 700; letter-spacing: 0.08em;
          padding: 1px 6px; border-radius: 999px;
        }

        .ep-pay-preview { padding: 14px; background: var(--vz-body-bg, #f3f4f9); }
        .ep-pay-company {
          position: relative; overflow: hidden;
          color: #fff; padding: 14px 18px;
          border-radius: 12px;
          /* Match the Payroll Summary hero gradient exactly so the payslip
             reads as the same family. */
          background: linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%);
          margin-bottom: 10px;
        }
        .ep-pay-company-logo {
          width: 40px; height: 40px; border-radius: 10px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.30);
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 700; font-size: 14px;
        }
        .ep-pay-identity {
          display: grid; grid-template-columns: repeat(5, 1fr);
          margin-top: 12px; padding: 8px 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 9px;
          position: relative; z-index: 1;
        }
        .ep-pay-identity-cell + .ep-pay-identity-cell {
          padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.10);
        }
        .ep-pay-identity-cell { padding-right: 12px; }
        .ep-pay-identity-label {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: rgba(255,255,255,0.62);
          margin-bottom: 2px;
        }
        .ep-pay-identity-value { font-size: 11.5px; font-weight: 700; color: #fff; }

        .ep-pay-kpis {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 6px; margin-bottom: 10px;
        }
        .ep-pay-kpi {
          padding: 8px 12px; border-radius: 8px; text-align: center;
        }
        .ep-pay-kpi-label {
          font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 2px;
        }
        .ep-pay-kpi-value { font-size: 17px; font-weight: 800; line-height: 1; }

        .ep-pay-table-card {
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 10px; overflow: hidden;
        }
        .ep-pay-table-head {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 12px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.10em;
          border-bottom: 1px solid var(--vz-border-color);
        }
        .ep-pay-dot { width: 6px; height: 6px; border-radius: 50%; }
        .ep-pay-table { width: 100%; font-size: 11.5px; margin: 0; }
        .ep-pay-table th {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          padding: 7px 12px; border-bottom: 1px solid var(--vz-border-color);
          background: var(--vz-secondary-bg);
        }
        .ep-pay-table td {
          padding: 7px 12px; border-bottom: 1px solid var(--vz-border-color);
        }
        .ep-pay-table tbody tr:last-child td { border-bottom: none; }

        .ep-pay-net {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 14px 20px;
          border-radius: 12px;
          /* Match the Payment Details "Current Compensation" green gradient
             so both green panels in the payroll flow share the same identity. */
          background: linear-gradient(135deg, #064e3b, #065f46, #059669);
          color: #fff;
          box-shadow: 0 8px 22px rgba(4,120,87,0.26);
          position: relative; overflow: hidden;
        }
        .ep-pay-net::before {
          content: '';
          position: absolute;
          top: -30px; right: -20px;
          width: 130px; height: 130px;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
          pointer-events: none;
        }
        .ep-pay-net > * { position: relative; }
        .ep-pay-footer {
          text-align: center; margin-top: 10px; padding: 7px;
          font-size: 10px; color: var(--vz-secondary-color);
          background: var(--vz-secondary-bg); border-radius: 8px;
        }
        .ep-pay-footer a { color: #6366f1; text-decoration: none; font-weight: 600; }

        @media (max-width: 991.98px) {
          .ep-pay-body { grid-template-columns: 1fr; }
          .ep-pay-sidebar { border-right: none; border-bottom: 1px solid var(--vz-border-color); }
          .ep-pay-identity { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .ep-pay-identity-cell + .ep-pay-identity-cell { padding-left: 0; border-left: none; }
          .ep-pay-kpis { grid-template-columns: repeat(2, 1fr); }
        }
        /* Dashboard surface — KPI tile background that flips in dark mode,
           matching the admin/client/branch dashboard's .dashboard-surface. */
        .dashboard-surface { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-surface { background: #1c2531; }
        /* KPI tile hover — lift + sharper shadow + indigo border tint, mirrors
           the section-card hover treatment so the Attendance KPI strip reacts
           to the cursor like the rest of the page. */
        [data-bs-theme="dark"] .ep-kpi-tile { background: #1c2531 !important; }
        .ep-kpi-tile:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 32px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04) !important;
          border-color: rgba(99,102,241,0.30) !important;
        }
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
          padding: 20px 28px 14px;
          background:
            
            linear-gradient(120deg,#08112b 0%,#0c1740 40%,#0f1e55 70%,#0d1848 100%);
        }
        .ep-hero::after {
          content: ''; position: absolute; inset: 0;
          background-image:
            radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 16px 16px;
          opacity: 0.35; pointer-events: none;
        }
        /* Bottom tab strip baked into the hero card — sits above a thin
           divider line and pulls in the same horizontal padding as the
           hero content so the tabs align with the avatar/identity row. */
        .ep-hero-tabs {
          position: relative; z-index: 2;
          margin-top: 10px;
          padding-top: 12px;
          border-top: 1px solid rgba(255,255,255,0.10);
        }
        .ep-close-btn {
          position: absolute; top: 14px; right: 18px;
          width: 30px; height: 30px; border-radius: 8px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.20);
          color: #fff; display: inline-flex;
          align-items: center; justify-content: center;
          cursor: pointer; transition: background .15s ease;
          z-index: 3; font-size: 16px;
        }
        .ep-close-btn:hover { background: rgba(255,255,255,0.20); }
        .ep-avatar-square {
          width: 110px; height: 110px;
          border-radius: 26px;
          display: flex; align-items: center; justify-content: center;
          font-size: 36px; font-weight: 800; color: #fff; letter-spacing: -0.02em;
          position: relative; z-index: 1; flex-shrink: 0;
          background: linear-gradient(135deg, #4f46e5 0%, #7c5cfc 100%);
          box-shadow:
            0 14px 40px rgba(0,0,0,0.55),
            0 0 0 2px rgba(255,255,255,0.16),
            0 0 0 5px rgba(255,255,255,0.05);
        }
        /* Top-left highlight for a soft 3D bevel */
        .ep-avatar-square::before {
          content: ''; position: absolute; inset: -1px;
          border-radius: 27px;
          background: linear-gradient(145deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.04) 60%, transparent 100%);
          pointer-events: none;
        }
        /* Online status dot in the bottom-right corner */
        .ep-avatar-square::after {
          content: ''; position: absolute; bottom: 0; right: 0;
          width: 20px; height: 20px; border-radius: 50%;
          background: #22c55e;
          border: 3px solid #0c1740;
          box-shadow: 0 0 12px rgba(34,197,94,0.90);
          z-index: 2;
        }
        .ep-hero-pill {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 600;
          padding: 3px 10px; border-radius: 999px;
        }
        .ep-hero-pill-blue   { background: rgba(99,102,241,0.20); color: #c7d2fe; border: 1px solid rgba(99,102,241,0.40); }
        .ep-hero-pill-teal   { background: rgba(20,184,166,0.20); color: #99f6e4; border: 1px solid rgba(20,184,166,0.40); }
        .ep-hero-pill-active { background: rgba(34,197,94,0.18);  color: #86efac; border: 1px solid rgba(34,197,94,0.40); }

        .ep-hero-meta { display: flex; align-items: center; gap: 8px; }
        .ep-hero-meta i { color: rgba(255,255,255,0.60); font-size: 14px; }
        .ep-hero-meta-label {
          color: rgba(255,255,255,0.55); font-size: 9.5px;
          font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        }
        .ep-hero-meta-value { color: #fff; font-size: 12.5px; font-weight: 600; }

        /* Ring chart — pure CSS conic-gradient with a dark hole. */
        .ep-ring {
          width: 86px; height: 86px;
          border-radius: 50%;
          position: relative;
          background:
            conic-gradient(var(--ring-color) calc(var(--ring-pct) * 1%),
                           rgba(255,255,255,0.10) 0);
          display: flex; align-items: center; justify-content: center;
        }
        .ep-ring::before {
          content: ''; position: absolute; inset: 7px;
          border-radius: 50%;
          background: var(--ring-bg, #131c46);
        }
        .ep-ring-inner { position: relative; z-index: 1; text-align: center; color: #fff; line-height: 1; }
        .ep-ring-num { font-size: 22px; font-weight: 800; }
        .ep-ring-pct { font-size: 10px; color: rgba(255,255,255,0.65); margin-top: 1px; }
        .ep-ring-label {
          color: rgba(255,255,255,0.65);
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.10em;
          text-transform: uppercase; text-align: center; margin-top: 6px;
        }

        /* ── Tab bar (nested inside hero) ──
           Renders as a flat horizontal row of tab buttons, no surrounding
           pill container. Active tab gets a white background that "rises"
           into the navy hero. */
        .ep-tabbar {
          background: transparent;
          border: none;
          padding: 0;
          display: flex; flex-wrap: wrap; gap: 6px;
          border-radius: 0;
        }
        .ep-tabbar-btn {
          background: transparent; border: none;
          padding: 5px 10px;
          font-size: 11.5px; font-weight: 600;
          color: rgba(255,255,255,0.65);
          display: inline-flex; align-items: center; gap: 5px;
          border-radius: 7px;
          cursor: pointer;
          transition: all .15s ease;
          white-space: nowrap;
        }
        .ep-tabbar-btn:hover { color: #fff; background: rgba(255,255,255,0.06); }
        .ep-tabbar-btn.is-active {
          background: #ffffff;
          color: #0f172a;
        }
        .ep-tabbar-icon {
          width: 18px; height: 18px; border-radius: 5px;
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-size: 10.5px;
          flex-shrink: 0;
        }

        /* ── Section card icon pill (light tinted, replaces the colored
              SectionHeader gradient circle) ── */
        .ep-section-icon {
          width: 32px; height: 32px; border-radius: 8px;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 15px; flex-shrink: 0;
        }
        .ep-section-card-flat {
          border-radius: 16px;
          border: 1px solid var(--vz-border-color);
          background: #ffffff;
          box-shadow: 0 2px 14px rgba(15,23,42,0.05);
          overflow: hidden;
        }
        [data-bs-theme="dark"] .ep-section-card-flat { background: #1c2531; }
        .ep-field-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--vz-secondary-color);
          margin-bottom: 4px;
        }
        .ep-field-value {
          font-size: 11px; font-weight: 600;
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
        /* Evidence Vault tables — dark navy header strip + tight row padding
           to match the Figma reference. */
        .ep-vault-table { font-size: 12.5px; margin: 0; }
        .ep-vault-table th {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(79, 79, 79, 0.85);
          padding: 8px 12px !important;
          border-bottom: none !important;
          white-space: nowrap;
        }
        .ep-vault-table td {
          padding: 8px 12px !important;
          border-bottom: 1px solid var(--vz-border-color) !important;
          vertical-align: middle;
        }
        .ep-vault-table tbody tr:last-child td { border-bottom: none !important; }

        /* Intraday Punch Timeline — horizontal scrollable rail with dot
           markers along a connecting line. Lets a WFO employee with 10–15
           in/out punches per day fit comfortably in the card width. */
        .ep-punch-rail {
          position: relative;
          overflow-x: auto;
          padding: 8px 4px 12px;
          scrollbar-width: thin;
          scrollbar-color: rgba(99,102,241,0.40) transparent;
        }
        .ep-punch-rail::-webkit-scrollbar { height: 6px; }
        .ep-punch-rail::-webkit-scrollbar-thumb {
          background: rgba(99,102,241,0.30); border-radius: 999px;
        }
        .ep-punch-rail::-webkit-scrollbar-track { background: transparent; }
        /* Inner track sizes to its full flex content so the absolutely-positioned
           connector line spans every stop instead of clipping to the rail's
           viewport. Without this, the line stops where the scroll container
           clips, leaving punches past the fold disconnected. */
        .ep-punch-track {
          position: relative;
          display: inline-flex;
          gap: 28px;
          min-width: 100%;
        }
        .ep-punch-line {
          position: absolute;
          top: 10px; left: 12px; right: 12px;
          height: 2px;
          background: var(--vz-border-color);
          z-index: 0;
        }
        .ep-punch-stop {
          flex: 0 0 auto;
          width: 92px;
          text-align: center;
          position: relative;
          z-index: 1;
        }
        .ep-punch-dot {
          width: 22px; height: 22px;
          margin: 0 auto;
        }

        /* Attendance Timelog History — visual parity with master/client TableContainer:
           bordered+rounded scroll wrap, sticky table-light header, Velzon scrollbar. */
        .ep-att-scroll-wrap {
          max-height: 445px;
          overflow-y: auto;
        }
        .ep-att-scroll-wrap thead {
          position: sticky;
          top: 0;
          z-index: 2;
        }
        .ep-att-scroll-wrap::-webkit-scrollbar { width: 8px; }
        .ep-att-scroll-wrap::-webkit-scrollbar-track { background: transparent; }
        .ep-att-scroll-wrap::-webkit-scrollbar-thumb { background: var(--vz-border-color); border-radius: 8px; }
        .ep-att-scroll-wrap::-webkit-scrollbar-thumb:hover { background: var(--vz-secondary-color); }
        .ep-att-table { font-size: 13px; margin-bottom: 0; }
        .ep-att-table th { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vz-secondary-color); font-weight: 700; padding: 10px 12px; border-bottom: 1px solid var(--vz-border-color); white-space: nowrap; }
        .ep-att-table td { padding: 10px 12px; border-bottom: 1px solid var(--vz-border-color); vertical-align: middle; white-space: nowrap; }
        .ep-att-table tbody tr:last-child td { border-bottom: none; }
        .ep-att-table tbody tr { transition: background-color .15s ease; }
        .ep-att-table tbody tr:hover { background: var(--vz-light); }
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
              <h2 className="text-white mb-0 fw-bold" style={{ fontSize: 22, lineHeight: 1.15 }}>{employee?.name || employeeId}</h2>
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center justify-content-center"
                style={{ width: 26, height: 26, padding: 0, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 7, color: '#fff', fontSize: 13 }}
                aria-label="More actions"
              >
                <i className="ri-more-2-fill" />
              </button>
            </div>
            <p className="mb-1" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em' }}>{employeeId}</p>
            <p className="mb-2" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12.5 }}>
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
            <div className="d-flex column-gap-4 row-gap-2 flex-wrap">
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
              <div className="ep-hero-meta">
                <i className="ri-phone-line" />
                <div>
                  <span className="ep-hero-meta-label">Mobile</span>{' '}
                  <span className="ep-hero-meta-value">9635203533</span>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-calendar-line" />
                <div>
                  <span className="ep-hero-meta-label">Joined</span>{' '}
                  <span className="ep-hero-meta-value">03-Nov-2023</span>
                </div>
              </div>
            </div>
          </Col>

          {/* Ring charts — pulled in toward the centre with auto-margin */}
          <Col xs="auto" className="ms-auto" style={{ marginRight: 80 }}>
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
      <div className="ep-content-pane px-4 pt-3">

      {/* ── Tab: Profile Details ── */}
      {tab === 'profile' && (
        <>
          {/* Personal Information — full-width row of 7 identity fields */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #6366f1' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(99,102,241,0.18)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 60%, rgba(99,102,241,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                <i className="ri-user-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Personal Information</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col><div className="ep-field-label">First Name</div><div className="ep-field-value">{(employee?.name || 'Aarav Kale').split(' ')[0] || 'Aarav'}</div></Col>
                <Col><div className="ep-field-label">Middle Name</div><div className="ep-field-value">Rajendra</div></Col>
                <Col><div className="ep-field-label">Last Name</div><div className="ep-field-value">{(employee?.name || 'Aarav Kale').split(' ').slice(1).join(' ') || 'Kale'}</div></Col>
                <Col><div className="ep-field-label">Display Name</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                <Col><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">02-Nov-1985</div></Col>
                <Col><div className="ep-field-label">Gender</div><div className="ep-field-value">Male</div></Col>
                <Col><div className="ep-field-label">Nationality</div><div className="ep-field-value">Indian</div></Col>
              </Row>
            </div>
          </div>

          {/* Contact Information — 4 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #299cdb' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(41,156,219,0.18)',
                background: 'linear-gradient(135deg, rgba(41,156,219,0.12) 0%, rgba(41,156,219,0.03) 60%, rgba(41,156,219,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                <i className="ri-phone-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Contact Information</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Work Email</div><div className="ep-field-value">{employee?.email || 'aarav.kale@enterprise.com'}</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile</div><div className="ep-field-value font-monospace">+91 9635203533</div></Col>
                <Col md={3}><div className="ep-field-label">Work Country</div><div className="ep-field-value">India</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{employee?.manager || 'Deepa Kulkarni'}</div></Col>
              </Row>
            </div>
          </div>

          {/* Address Details — Current + Permanent side-by-side. Gradient
              tint is restricted to the header strip; the body sits on plain
              white so the field rows stay readable. */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #0ab39c' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(10,179,156,0.18)',
                background: 'linear-gradient(135deg, rgba(10,179,156,0.12) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                <i className="ri-map-pin-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Address Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={6}>
                  <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                    <span className="dot" style={{ background: '#0ab39c' }} /> Current Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">Office No. 821, Solitaire Hub, Balewadi</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">Pune</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">Maharashtra</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">India</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">411045</div></Col>
                  </Row>
                </Col>
                <Col md={6}>
                  <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                    <span className="dot" style={{ background: '#0ab39c' }} /> Permanent Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">Plot No. 14, Sector 3, Vimaan Nagar Rd</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">Pune</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">Maharashtra</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">India</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">411014</div></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          </div>

          {/* Bottom row: Work Experience | Profile Completion | KYC Documents */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #f59e0b' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(245,158,11,0.18)',
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                    <i className="ri-briefcase-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Work Experience</h6>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  <Row className="g-3">
                    <Col xs={6}>
                      <div className="ep-field-label">Status</div>
                      <div className="ep-field-value">Experienced</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Total Experience</div>
                      <div className="ep-field-value">5 yrs 3 mos</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Last Company</div>
                      <div className="ep-field-value">Infotech Solutions Ltd</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Last Designation</div>
                      <div className="ep-field-value">Software Engineer</div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(99,102,241,0.06) 60%, rgba(168,85,247,0.04) 100%)', border: '1px solid rgba(168,85,247,0.18)', borderTop: '3px solid #a855f7' }}>
                <div className="px-3 pt-3 pb-2 d-flex align-items-center gap-3">
                  <div
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: `conic-gradient(#a855f7 ${profilePct}%, rgba(168,85,247,0.18) 0)`,
                      flexShrink: 0,
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute', inset: 4, borderRadius: '50%',
                        background: '#ffffff',
                        display: 'flex', alignItems: 'baseline', justifyContent: 'center',
                        fontWeight: 800, color: '#7c3aed',
                        fontSize: 12, gap: 1, paddingTop: 4,
                      }}
                    >
                      {profilePct}<span style={{ fontSize: 7.5, fontWeight: 700 }}>%</span>
                    </span>
                  </div>
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fw-bold" style={{ color: '#7c3aed', fontSize: 12 }}>Profile Completion</h6>
                    <small className="text-muted" style={{ fontSize: 12 }}>
                      In Progress · {profilePct}% done
                    </small>
                  </div>
                </div>
                {/* Full-width striped progress bar with floating circular
                    badge above the fill end. Locked to the card's violet
                    theme so it reads as a continuation of the gradient
                    background instead of a separate tier-colored band. */}
                <div className="px-3 pb-2">
                  {(() => {
                    const p = profilePct;
                    const VIOLET = { dark: '#7c3aed', light: '#a855f7' };
                    const badgeLeft = Math.max(8, Math.min(92, p));
                    return (
                      <div style={{ position: 'relative', width: '100%', paddingTop: 0 }} title={`Profile ${p}% complete`}>
                        {/* Floating badge + downward pointer */}
                        <div
                          style={{
                            position: 'absolute',
                            top: -33,
                            left: `${badgeLeft}%`,
                            transform: 'translateX(-50%)',
                            textAlign: 'center',
                          }}
                        >
                          <div
                            className="d-flex align-items-center justify-content-center fw-bold"
                            style={{
                              width: 30, height: 30, borderRadius: '50%',
                              background: `linear-gradient(135deg, ${VIOLET.dark}, ${VIOLET.light})`,
                              color: '#fff', fontSize: 10.5,
                              boxShadow: `0 6px 14px ${VIOLET.dark}55, inset 0 1px 0 rgba(255,255,255,0.20)`,
                              border: '2px solid #fff',
                            }}
                          >
                            {p}%
                          </div>
                          <div
                            style={{
                              width: 0, height: 0, margin: '0 auto',
                              borderLeft: '5px solid transparent',
                              borderRight: '5px solid transparent',
                              borderTop: `6px solid ${VIOLET.dark}`,
                            }}
                          />
                        </div>

                        {/* Track + striped fill */}
                        <div
                          style={{
                            width: '100%', height: 10,
                            borderRadius: 999,
                            background: 'rgba(168,85,247,0.18)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${p}%`, height: '100%',
                              borderRadius: 999,
                              background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.32) 0 6px, transparent 6px 12px), linear-gradient(90deg, ${VIOLET.dark}, ${VIOLET.light})`,
                              transition: 'width .35s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* 4 mini-tiles */}
                <div className="px-3 pb-3 flex-grow-1">
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
                        <div className="ep-field-value font-monospace" style={{ color: '#a16207', fontSize: 13 }}>03-Nov-2023</div>
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
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #6366f1' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(99,102,241,0.18)',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>KYC Documents</h6>
                  </div>
                  <span className="badge rounded-pill fw-semibold px-2 py-1" style={{ background: 'rgba(99,102,241,0.16)', color: '#4338ca', fontSize: 10.5 }}>3 / 4</span>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {[
                    { label: 'Aadhaar Card',   status: 'Uploaded' },
                    { label: 'PAN Card',       status: 'Uploaded' },
                    { label: 'Passport Photo', status: 'Uploaded' },
                    { label: 'Address Proof',  status: 'Pending'  },
                  ].map(d => {
                    const uploaded = d.status === 'Uploaded';
                    return (
                      <div key={d.label} className="d-flex align-items-center gap-2 px-2 py-1">
                        <span
                          className="d-inline-flex align-items-center justify-content-center"
                          style={{
                            width: 18, height: 18, borderRadius: 5,
                            background: uploaded ? '#3b82f6' : '#f59e0b',
                            color: '#fff', fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          <i className={uploaded ? 'ri-check-line' : 'ri-time-line'} />
                        </span>
                        <div className="flex-grow-1" style={{ fontSize: 12.5, fontWeight: 600 }}>{d.label}</div>
                        <span
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            fontSize: 10, padding: '2px 9px', borderRadius: 999,
                            background: uploaded ? 'rgba(59,130,246,0.10)' : 'rgba(245,158,11,0.12)',
                            color:      uploaded ? '#1d4ed8' : '#a16207',
                            border:     `1px solid ${uploaded ? 'rgba(59,130,246,0.25)' : 'rgba(245,158,11,0.25)'}`,
                          }}
                        >
                          {d.status}
                        </span>
                      </div>
                    );
                  })}
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
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #6366f1' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(99,102,241,0.18)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                <i className="ri-briefcase-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Employment Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col>
                  <div className="ep-field-label">Employee Number</div>
                  <span className=" fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 10 }}>{employeeId}</span>
                </Col>
                <Col><div className="ep-field-label">Joining Date</div><div className="ep-field-value " style={{ fontSize: 11 }}>29-Apr-2026</div></Col>
                <Col><div className="ep-field-label">Job Title (Primary)</div><div className="ep-field-value">{employee?.designation || '—'}</div></Col>
                <Col>
                  <div className="ep-field-label">Job Title (Secondary)</div>
                  {ancillaryList.length > 0 ? (
                    <div className="d-flex flex-wrap gap-1">
                      {ancillaryList.map(r => (
                        <span
                          key={r}
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            fontSize: 11, padding: '2px 9px', borderRadius: 999,
                            background: 'rgba(20,184,166,0.10)', color: '#0a716a',
                            border: '1px solid rgba(20,184,166,0.25)',
                          }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-field-value text-muted fw-normal">—</div>
                  )}
                </Col>
                <Col><div className="ep-field-label">Employment Status</div><div className="ep-field-value">{employee?.enabled === false ? 'Disabled' : 'active'}</div></Col>
                <Col><div className="ep-field-label">Worker Type</div><div className="ep-field-value">Full-time</div></Col>
                <Col><div className="ep-field-label">Time Type</div><div className="ep-field-value">Full Time</div></Col>
              </Row>
            </div>
          </div>

          {/* Organisational Structure — 4 fields full width */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #299cdb' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(41,156,219,0.20)',
                background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                <i className="ri-building-2-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Organisational Structure</h6>
            </div>
            <div className="px-3 py-3">
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
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #0ab39c' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                    <i className="ri-edit-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Role &amp; Positioning</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-4">
                    <Col xs={4}><div className="ep-field-label">Primary Role</div><div className="ep-field-value">{employee?.primaryRole || 'Executive'}</div></Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Ancillary Role</div>
                      {ancillaryList.length > 0 ? (
                        <div className="d-flex flex-wrap gap-1">
                          {ancillaryList.map(r => (
                            <span
                              key={r}
                              className="d-inline-flex align-items-center fw-semibold"
                              style={{
                                fontSize: 9, padding: '2px 8px', borderRadius: 999,
                                background: 'rgba(20,184,166,0.10)', color: '#0a716a',
                                border: '1px solid rgba(20,184,166,0.25)',
                              }}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="ep-field-value text-muted fw-normal">—</div>
                      )}
                    </Col>
                    <Col xs={4}><div className="ep-field-label">Employee Level</div><div className="ep-field-value">L3 — Mid</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #f59e0b' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(245,158,11,0.20)',
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                    <i className="ri-file-list-3-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Employment Terms</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-3">
                    <Col xs={6}><div className="ep-field-label">Probation Policy</div><div className="ep-field-value">Default Probation Policy</div></Col>
                    <Col xs={6}><div className="ep-field-label">Probation Duration</div><div className="ep-field-value">3 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Notice Period</div><div className="ep-field-value">2 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Contract Status</div><div className="ep-field-value">Permanent</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #299cdb' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(41,156,219,0.20)',
                    background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                    <i className="ri-time-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance &amp; Time</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-3">
                    <Col xs={4}><div className="ep-field-label">Shift</div><div className="ep-field-value">Morning Shift</div></Col>
                    <Col xs={4}><div className="ep-field-label">Weekly Off</div><div className="ep-field-value">Sat &amp; Sun</div></Col>
                    <Col xs={4}><div className="ep-field-label">Leave Plan</div><div className="ep-field-value">Default Leave Plan</div></Col>
                    <Col xs={4}><div className="ep-field-label">Holiday Calendar</div><div className="ep-field-value">Maharashtra 2026</div></Col>
                    <Col xs={4}><div className="ep-field-label">Time Tracking</div><div className="ep-field-value">Enabled</div></Col>
                    <Col xs={4}><div className="ep-field-label">Attendance No.</div><div className="ep-field-value font-monospace">{employeeId}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Penalization</div><div className="ep-field-value">Default</div></Col>
                    <Col xs={4}><div className="ep-field-label">Overtime Policy</div><div className="ep-field-value">Standard OT</div></Col>
                    <Col xs={4}><div className="ep-field-label">Shift Allowance</div><div className="ep-field-value">None</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

          {/* Asset Details */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #f59e0b' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(245,158,11,0.20)',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                <i className="ri-computer-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Asset Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-3">
                <Col md={3}><div className="ep-field-label">Laptop Assigned</div><div className="ep-field-value">Yes</div></Col>
                <Col md={3}>
                  <div className="ep-field-label">Laptop Asset ID</div>
                  <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 9 }}>LAP-0042</span>
                </Col>
                <Col md={3}><div className="ep-field-label">Laptop Type</div><div className="ep-field-value">Dell Latitude 5510</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile Device</div><div className="ep-field-value text-muted fw-normal">—</div></Col>

                <Col md={3}><div className="ep-field-label">Monitor</div><div className="ep-field-value">24" Dell Monitor</div></Col>
                <Col md={3}><div className="ep-field-label">Keyboard</div><div className="ep-field-value">Logitech K380</div></Col>
                <Col md={3}><div className="ep-field-label">Mouse</div><div className="ep-field-value">Logitech MX</div></Col>
                <Col md={3}><div className="ep-field-label">Headset</div><div className="ep-field-value text-muted fw-normal">—</div></Col>

                <Col md={3}><div className="ep-field-label">Other Assets</div><div className="ep-field-value">Access Card, Desk</div></Col>
                <Col md={3}><div className="ep-field-label">Asset Issued Date</div><div className="ep-field-value font-monospace">17-May-2022</div></Col>
                <Col md={3}><div className="ep-field-label">Acknowledgment</div><div className="ep-field-value">Signed</div></Col>
                <Col md={3}><div className="ep-field-label">Return Required</div><div className="ep-field-value">No</div></Col>
              </Row>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Attendance — Coming Soon ── */}
      {tab === 'attendance' && (
        <ComingSoonShell title="Attendance" subtitle="Punch-in, biometric sync, compliance score">
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl><KpiTile label="Present Days"    value={<AnimatedNumber value={14} />}            sub="This month"      icon="ri-checkbox-circle-line" gradient={GRAD_SUCCESS} tint="#ecfaf3" /></Col>
            <Col xl><KpiTile label="Late Marks"      value={<AnimatedNumber value={1} />}             sub="This month"      icon="ri-time-line"            gradient={GRAD_WARNING} tint="#fff7e6" /></Col>
            <Col xl><KpiTile label="Missing Biometric" value={<AnimatedNumber value={1} />}           sub="Entries this month" icon="ri-error-warning-line" gradient={GRAD_DANGER}  tint="#fff1ed" /></Col>
            <Col xl><KpiTile label="Compliance Score" value={<AnimatedNumber value={93} suffix="%" />} sub="Attendance rate" icon="ri-shield-check-line"   gradient={GRAD_INFO}    tint="#eaf6fd" /></Col>
            <Col xl><KpiTile label="Total Leaves"    value={<AnimatedNumber value={0} />}             sub="This month"      icon="ri-calendar-todo-line"   gradient={GRAD_PURPLE}  tint="#f3eeff" /></Col>
          </Row>

          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={6}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #0ab39c' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                      <i className="ri-calendar-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Today's Updated Record</h6>
                  </div>
                  <small className="text-muted" style={{ fontSize: 11 }}>Mon, 21-Apr-2026</small>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  <span className="d-inline-flex align-items-center gap-1 fw-semibold mb-2" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#d6f4e3', color: '#108548' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Present
                  </span>
                  <Row className="g-2 mb-2">
                    <Col xs={6}>
                      <div className="px-2 py-2" style={{ borderRadius: 8, background: '#ecfaf3', border: '1px solid #bce8d2' }}>
                        <p className="mb-1 fw-semibold" style={{ fontSize: 10, color: '#0a8a78', letterSpacing: '0.06em', textTransform: 'uppercase' }}>» First In</p>
                        <h5 className="mb-0 fw-bold" style={{ color: '#108548', fontSize: 18 }}>07:01 <small style={{ fontSize: 10 }}>AM</small></h5>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-2 py-2" style={{ borderRadius: 8, background: '#eaf6fd', border: '1px solid #b8dcef' }}>
                        <p className="mb-1 fw-semibold" style={{ fontSize: 10, color: '#0c63b0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>» Last Out</p>
                        <h5 className="mb-0 fw-bold" style={{ color: '#0c63b0', fontSize: 18 }}>04:02 <small style={{ fontSize: 10 }}>PM</small></h5>
                      </div>
                    </Col>
                  </Row>
                  <div className="d-flex justify-content-around text-center pt-2 border-top">
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 14 }}>2</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Punches</small></div>
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#108548', fontSize: 14 }}>9h 01m</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Worked</small></div>
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 14 }}>9h 00m</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Expected</small></div>
                  </div>
                </div>
              </div>
            </Col>
            <Col xl={6}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #299cdb' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(41,156,219,0.18)',
                    background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                      <i className="ri-pulse-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Intraday Punch Timeline</h6>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {(() => {
                      const PUNCHES = [
                        { time: '08:02 AM', kind: 'in',  label: 'Check In',  src: 'BIOMETRIC' },
                        { time: '10:15 AM', kind: 'out', label: 'Step Out',  src: 'WEB' },
                        { time: '10:42 AM', kind: 'in',  label: 'Step In',   src: 'WEB' },
                        { time: '12:30 PM', kind: 'out', label: 'Lunch Out', src: 'BIOMETRIC' },
                        { time: '01:14 PM', kind: 'in',  label: 'Lunch In',  src: 'BIOMETRIC' },
                        { time: '02:48 PM', kind: 'out', label: 'Meeting',   src: 'MOBILE' },
                        { time: '04:05 PM', kind: 'in',  label: 'Back',      src: 'MOBILE' },
                        { time: '05:20 PM', kind: 'out', label: 'Tea Break', src: 'WEB' },
                        { time: '05:38 PM', kind: 'in',  label: 'Resumed',   src: 'WEB' },
                        { time: '07:02 PM', kind: 'out', label: 'Step Out',  src: 'BIOMETRIC' },
                        { time: '07:25 PM', kind: 'in',  label: 'Step In',   src: 'BIOMETRIC' },
                        { time: '08:55 PM', kind: 'out', label: 'Check Out', src: 'BIOMETRIC' },
                      ];
                      return (
                        <span className="badge rounded-pill" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: 10.5, padding: '3px 9px' }}>{PUNCHES.length} punches today</span>
                      );
                    })()}
                    <Button
                      color="secondary"
                      className="btn-label waves-effect waves-light rounded-pill btn-sm"
                      onClick={() => setRegOpen(true)}
                    >
                      <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2" />
                      Regularization
                    </Button>
                  </div>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {(() => {
                    const PUNCHES = [
                      { time: '08:02 AM', kind: 'in',  label: 'Check In',  src: 'BIOMETRIC' },
                      { time: '10:15 AM', kind: 'out', label: 'Step Out',  src: 'WEB' },
                      { time: '10:42 AM', kind: 'in',  label: 'Step In',   src: 'WEB' },
                      { time: '12:30 PM', kind: 'out', label: 'Lunch Out', src: 'BIOMETRIC' },
                      { time: '01:14 PM', kind: 'in',  label: 'Lunch In',  src: 'BIOMETRIC' },
                      { time: '02:48 PM', kind: 'out', label: 'Meeting',   src: 'MOBILE' },
                      { time: '04:05 PM', kind: 'in',  label: 'Back',      src: 'MOBILE' },
                      { time: '05:20 PM', kind: 'out', label: 'Tea Break', src: 'WEB' },
                      { time: '05:38 PM', kind: 'in',  label: 'Resumed',   src: 'WEB' },
                      { time: '07:02 PM', kind: 'out', label: 'Step Out',  src: 'BIOMETRIC' },
                      { time: '07:25 PM', kind: 'in',  label: 'Step In',   src: 'BIOMETRIC' },
                      { time: '08:55 PM', kind: 'out', label: 'Check Out', src: 'BIOMETRIC' },
                    ];
                    return (
                      <div className="ep-punch-rail">
                        <div className="ep-punch-track">
                          <div className="ep-punch-line" />
                          {PUNCHES.map((p, i) => {
                            const isIn = p.kind === 'in';
                            const dotBg = isIn ? '#10b981' : '#3b82f6';
                            const dotShadow = isIn ? 'rgba(16,185,129,0.40)' : 'rgba(59,130,246,0.40)';
                            const fg = isIn ? '#108548' : '#0c63b0';
                            return (
                              <div className="ep-punch-stop" key={i}>
                                <span
                                  className="ep-punch-dot d-inline-flex align-items-center justify-content-center rounded-circle"
                                  style={{ background: dotBg, color: '#fff', boxShadow: `0 3px 8px ${dotShadow}` }}
                                >
                                  <i className={isIn ? 'ri-checkbox-circle-fill' : 'ri-logout-circle-r-line'} style={{ fontSize: 11 }} />
                                </span>
                                <h6 className="mb-0 fw-bold mt-2" style={{ color: fg, fontSize: 12 }}>{p.time}</h6>
                                <p className="mb-1 fw-semibold" style={{ fontSize: 10.5 }}>{p.label}</p>
                                <span className="badge rounded-pill" style={{ background: '#dceefe', color: '#0c63b0', fontSize: 8.5, padding: '2px 6px', letterSpacing: '0.04em' }}>{p.src}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col xs={12}>
              <div className="ep-section-card-flat ep-section-card" style={{ borderTop: '3px solid #a855f7' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(168,85,247,0.18)',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                      <i className="ri-history-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance Timelog History</h6>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Dropdown isOpen={monthOpen} toggle={() => setMonthOpen(o => !o)}>
                      <DropdownToggle
                        tag="button"
                        type="button"
                        className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                        style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11.5, padding: '4px 12px' }}
                      >
                        <i className="ri-calendar-line" /> {attMonth}
                        <i className="ri-arrow-down-s-line" />
                      </DropdownToggle>
                      <DropdownMenu end>
                        {ATT_MONTHS.map(m => (
                          <DropdownItem
                            key={m.key}
                            active={attMonth === m.label}
                            onClick={() => setAttMonth(m.label)}
                          >
                            {m.label}
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    </Dropdown>
                    <Button
                      color="secondary"
                      className="btn-label waves-effect waves-light rounded-pill btn-sm"
                      onClick={() => toast.info('Exporting timelogs', `Preparing ${attMonth} export…`)}
                    >
                      <i className="ri-download-2-line label-icon align-middle rounded-pill fs-16 me-2" />
                      Export Timelogs
                    </Button>
                  </div>
                </div>
                <div className="px-3 pb-3 pt-2">
                  <div className="table-responsive border rounded ep-att-scroll-wrap">
                    <table className="table align-middle table-nowrap ep-att-table mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Date</th><th>Day</th><th>Shift</th><th>First In</th><th>Last Out</th><th>Punches</th><th>Worked</th><th>Deviation</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ATTENDANCE_HISTORY.slice(attPage * ATT_PAGE_SIZE, attPage * ATT_PAGE_SIZE + ATT_PAGE_SIZE).map(r => {
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
                  {(() => {
                    const total = ATTENDANCE_HISTORY.length;
                    const pageCount = Math.max(1, Math.ceil(total / ATT_PAGE_SIZE));
                    const startIdx = attPage * ATT_PAGE_SIZE;
                    const shownEnd = Math.min(startIdx + ATT_PAGE_SIZE, total);
                    const canPrev = attPage > 0;
                    const canNext = attPage < pageCount - 1;
                    // Windowed paginator — same recipe as the master TableContainer:
                    // first, last, current ± 1, ellipses for any gap. With ≤7 pages
                    // we render every number.
                    const siblings = 1;
                    const items: Array<number | 'ellipsis-l' | 'ellipsis-r'> = [];
                    if (pageCount <= 7) {
                      for (let i = 0; i < pageCount; i++) items.push(i);
                    } else {
                      const left = Math.max(attPage - siblings, 1);
                      const right = Math.min(attPage + siblings, pageCount - 2);
                      items.push(0);
                      if (left > 1) items.push('ellipsis-l');
                      for (let i = left; i <= right; i++) items.push(i);
                      if (right < pageCount - 2) items.push('ellipsis-r');
                      items.push(pageCount - 1);
                    }
                    return (
                      <Row className="align-items-center mt-3 g-3 text-center text-sm-start">
                        <div className="col-sm">
                          <div className="text-muted">
                            Showing<span className="fw-semibold ms-1">{shownEnd - startIdx}</span> of <span className="fw-semibold">{total}</span> Results
                          </div>
                        </div>
                        <div className="col-sm-auto">
                          <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
                            <li className={!canPrev ? 'page-item disabled' : 'page-item'}>
                              <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (canPrev) setAttPage(p => p - 1); }}>
                                <i className="ri-arrow-left-s-line" />
                              </a>
                            </li>
                            {items.map((item, key) => {
                              if (item === 'ellipsis-l' || item === 'ellipsis-r') {
                                return (
                                  <li key={`${item}-${key}`} className="page-item disabled">
                                    <span className="page-link" style={{ cursor: 'default' }}>…</span>
                                  </li>
                                );
                              }
                              const isActive = attPage === item;
                              return (
                                <li key={item} className="page-item">
                                  <a
                                    href="#"
                                    className={isActive ? 'page-link active' : 'page-link'}
                                    style={isActive ? { backgroundColor: 'var(--vz-secondary)', borderColor: 'var(--vz-secondary)', color: '#fff' } : undefined}
                                    onClick={e => { e.preventDefault(); setAttPage(item); }}
                                  >
                                    {item + 1}
                                  </a>
                                </li>
                              );
                            })}
                            <li className={!canNext ? 'page-item disabled' : 'page-item'}>
                              <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (canNext) setAttPage(p => p + 1); }}>
                                <i className="ri-arrow-right-s-line" />
                              </a>
                            </li>
                          </ul>
                        </div>
                      </Row>
                    );
                  })()}
                </div>
              </div>
            </Col>
          </Row>
        </ComingSoonShell>
      )}

      {/* ── Tab: Evidence Vault ── */}
      {tab === 'vault' && (
        <ComingSoonShell title="Evidence Vault" subtitle="Document repository, signed agreements, ID uploads">
          {/* Hero strip — "Evidence Vault — {Name} Document Repository" + KPIs */}
          <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                color: '#fff',
                padding: '12px 18px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
              <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                    <i className="ri-lock-2-line" style={{ fontSize: 17, color: '#fff' }} />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Evidence Vault</p>
                  <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    {employee?.name || employeeId} <span style={{ color: 'rgba(255,255,255,0.55)' }}>—</span> Document Repository
                  </div>
                  <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>All documents are securely stored and version-controlled</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total Docs', value: vaultCounts.total,    color: '#fff' },
                      { label: 'Verified',   value: vaultCounts.verified, color: '#86efac' },
                      { label: 'Pending',    value: vaultCounts.pending,  color: '#fcd34d' },
                      { label: 'Signed',     value: vaultCounts.signed,   color: '#c4b5fd' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center"
                        style={{
                          background: 'rgba(255,255,255,0.10)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          borderRadius: 9,
                          padding: '4px 10px',
                          minWidth: 72,
                        }}
                      >
                        <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                        <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
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
                  borderRadius: 9,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { key: 'employee'       as VaultTab, label: 'Employee Documents',      count: employeeDocCount,      icon: 'ri-user-line',     activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'organizational' as VaultTab, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line', activeBg: 'linear-gradient(135deg,#064e3b,#047857)', shadow: 'rgba(4,120,87,0.22)' },
                ].map(t => {
                  const on = vaultTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setVaultTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 7,
                        padding: '5px 12px',
                        fontSize: 11.5,
                        background: on ? t.activeBg : 'transparent',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: 'none',
                        boxShadow: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={t.icon} style={{ fontSize: 12 }} />
                      {t.label}
                      <span
                        className="badge rounded-pill"
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
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
            <div
              className="ep-section-card-flat ep-section-card mb-3"
              style={{ borderTop: `3px solid ${section.iconFg}` }}
              key={section.title}
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                style={{
                  borderBottom: `1px solid color-mix(in srgb, ${section.iconFg} 18%, transparent)`,
                  background: `linear-gradient(135deg, color-mix(in srgb, ${section.iconFg} 14%, transparent) 0%, color-mix(in srgb, ${section.iconFg} 4%, transparent) 60%, color-mix(in srgb, ${section.iconFg} 1%, transparent) 100%)`,
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon" style={{ background: `color-mix(in srgb, ${section.iconFg} 18%, transparent)`, color: section.iconFg }}>
                    <i className={section.icon} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>{section.title}</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>{section.subtitle}</small>
                  </div>
                </div>
                <div className="text-end">
                  <h4 className="mb-0 fw-bold" style={{ color: section.iconFg, fontSize: 22, lineHeight: 1 }}>{section.docs.length}</h4>
                  <small className="text-muted text-uppercase" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="table-responsive border rounded ep-att-scroll-wrap">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead className="table-light">
                      <tr>
                        {['SR', 'Document Name', 'ID / Number', 'Issuing Authority', 'Issue Date', 'Expiry Date', 'Attachment', 'Status'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.docs.map((doc, idx) => {
                        const st = VAULT_STATUS_TONE[doc.status];
                        return (
                          <tr key={`${section.title}-${doc.name}`}>
                            <td className="text-muted">{idx + 1}</td>
                            <td className="fw-semibold">{doc.name}</td>
                            <td>
                              {doc.idNumber
                                ? <span className="font-monospace" style={{ background: '#ece6ff', color: '#5a3fd1', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{doc.idNumber}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>{doc.authority || <span className="text-muted">—</span>}</td>
                            <td className="font-monospace">{doc.issueDate || <span className="text-muted">—</span>}</td>
                            <td className="font-monospace">{doc.expiryDate || <span className="text-muted">—</span>}</td>
                            <td>
                              {doc.attachment
                                ? <a href="#" onClick={e => { e.preventDefault(); toast.info('Downloading attachment', `${doc.attachment} is being prepared…`); }} className="d-inline-flex align-items-center gap-1 text-decoration-none" style={{ background: 'rgba(16,185,129,0.10)', color: '#0a8a78', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid rgba(16,185,129,0.25)' }}>
                                    <i className="ri-file-text-line" /> {doc.attachment}
                                  </a>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase" style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} /> {doc.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}

          {/* Organizational Documents sub-tab */}
          {vaultTab === 'organizational' && VAULT_ORG.map(section => (
            <div
              className="ep-section-card-flat ep-section-card mb-3"
              style={{ borderTop: `3px solid ${section.iconFg}` }}
              key={section.title}
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                style={{
                  borderBottom: `1px solid color-mix(in srgb, ${section.iconFg} 18%, transparent)`,
                  background: `linear-gradient(135deg, color-mix(in srgb, ${section.iconFg} 14%, transparent) 0%, color-mix(in srgb, ${section.iconFg} 4%, transparent) 60%, color-mix(in srgb, ${section.iconFg} 1%, transparent) 100%)`,
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon" style={{ background: `color-mix(in srgb, ${section.iconFg} 18%, transparent)`, color: section.iconFg }}>
                    <i className={section.icon} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>{section.title}</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>{section.subtitle}</small>
                  </div>
                </div>
                <div className="text-end">
                  <h4 className="mb-0 fw-bold" style={{ color: section.iconFg, fontSize: 22, lineHeight: 1 }}>{section.docs.length}</h4>
                  <small className="text-muted text-uppercase" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="table-responsive border rounded ep-att-scroll-wrap">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead className="table-light">
                      <tr>
                        {['SR', 'Document Name', 'Type', 'Effective Date', 'Valid Until', 'Attachment', 'Status'].map(h => (
                          <th key={h}>{h}</th>
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
                            <td className="text-muted">{idx + 1}</td>
                            <td className="fw-semibold">{doc.name}</td>
                            <td>
                              <span className="d-inline-flex align-items-center fw-semibold text-uppercase" style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, background: typeTone.bg, color: typeTone.fg, letterSpacing: '0.04em' }}>
                                {doc.type}
                              </span>
                            </td>
                            <td className="font-monospace">{doc.effectiveDate || <span className="text-muted">—</span>}</td>
                            <td className="font-monospace">{doc.validUntil || <span className="text-muted">—</span>}</td>
                            <td>
                              {doc.attachment
                                ? <a href="#" onClick={e => { e.preventDefault(); toast.info('Downloading attachment', `${doc.attachment} is being prepared…`); }} className="d-inline-flex align-items-center gap-1 text-decoration-none" style={{ background: 'rgba(16,185,129,0.10)', color: '#0a8a78', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid rgba(16,185,129,0.25)' }}>
                                    <i className="ri-file-text-line" /> {doc.attachment}
                                  </a>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase" style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} /> {doc.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </ComingSoonShell>
      )}

      {/* ── Tab: Payroll Details ── */}
      {tab === 'payroll' && (
        <ComingSoonShell title="Payroll" subtitle="Salary breakdown, payment history, tax sheets">
          {/* Sub-tab pill — Payroll Summary (indigo) | Payment Details (green).
              Same compact strap shape as the Evidence Vault subtabs. */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex"
                style={{
                  background: 'var(--vz-secondary-bg)',
                  border: '1px solid var(--vz-border-color)',
                  borderRadius: 9,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { key: 'summary' as PayrollTab, label: 'Payroll Summary',  icon: 'ri-calendar-line',            activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'details' as PayrollTab, label: 'Payment Details',  icon: 'ri-money-dollar-circle-line', activeBg: 'linear-gradient(135deg,#064e3b,#047857)', shadow: 'rgba(4,120,87,0.22)' },
                ].map(t => {
                  const on = payrollTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setPayrollTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 7,
                        padding: '5px 12px',
                        fontSize: 11.5,
                        background: on ? t.activeBg : 'transparent',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: 'none',
                        boxShadow: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={t.icon} style={{ fontSize: 12 }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {payrollTab === 'summary' && (
            <>
              {/* Hero strip — only on the Payroll Summary tab. */}
              <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
                <div
                  style={{
                    background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                    color: '#fff',
                    padding: '12px 18px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                  <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                    <Col xs="auto">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                        <i className="ri-money-dollar-circle-line" style={{ fontSize: 17, color: '#fff' }} />
                      </span>
                    </Col>
                    <Col className="min-w-0">
                      <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Payroll Summary</p>
                      <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                        Last Processed: <span style={{ color: '#bce8ff' }}>Mar 2026</span> (01 Mar – 31 Mar)
                      </div>
                      <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>Next cycle: Apr 2026 · Monthly payroll</small>
                    </Col>
                    <Col xs="12" lg="auto">
                      <div className="d-flex gap-1 flex-wrap justify-content-lg-end align-items-center">
                        {[
                          { label: 'Working Days', value: '31',     color: '#fff' },
                          { label: 'Loss of Pay',  value: '0',      color: '#fcd34d' },
                          { label: 'Status',       value: 'Active', color: '#86efac' },
                        ].map(c => (
                          <div
                            key={c.label}
                            className="text-center"
                            style={{
                              background: 'rgba(255,255,255,0.10)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 9,
                              padding: '4px 10px',
                              minWidth: 72,
                            }}
                          >
                            <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                            <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPaySlipOpen(true)}
                          className="d-inline-flex align-items-center gap-1 fw-semibold lh-1"
                          style={{
                            background: 'rgba(255,255,255,0.10)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 9,
                            padding: '4px 10px',
                            minWidth: 72,
                            height: 36,
                            color: '#fff',
                            fontSize: 11,
                            cursor: 'pointer',
                            transition: 'background .15s ease',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; }}
                        >
                          <i className="ri-download-2-line" style={{ fontSize: 13 }} /> View Payslip
                        </button>
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #299cdb' }}>
                    <div
                      className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(41,156,219,0.18)',
                        background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                      }}
                    >
                      <div className="d-flex align-items-center gap-2">
                        <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                          <i className="ri-bank-card-line" />
                        </span>
                        <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Payment Information</h6>
                      </div>
                      <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#a16207', border: '1px solid rgba(245,158,11,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} /> Not Initiated
                      </span>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <p className="mb-3" style={{ fontSize: 12.5 }}>
                        Salary Payment Mode: <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>Bank Transfer</strong>
                      </p>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">Bank Name</div><div className="ep-field-value">Kotak Mahindra Bank</div></Col>
                        <Col md={6}>
                          <div className="ep-field-label">Account Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXXXXXX36</span>
                        </Col>
                        <Col md={6}>
                          <div className="ep-field-label">IFSC Code</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>KKBK0000823</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Name on Account</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                        <Col md={6}><div className="ep-field-label">Branch</div><div className="ep-field-value">Silvaasa</div></Col>
                        <Col md={6}><div className="ep-field-label">Account Type</div><div className="ep-field-value">Salary</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #a855f7' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(168,85,247,0.18)',
                        background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                        <i className="ri-user-2-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Identity Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      {/* PAN Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#7c3aed', fontSize: 12.5 }}>PAN Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3 mb-3">
                        <Col md={3}>
                          <div className="ep-field-label">PAN Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXXXX89K</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Name</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                        <Col md={3}><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">02-Nov-1985</div></Col>
                        <Col md={3}><div className="ep-field-label">Parent Name</div><div className="ep-field-value">Kiran Kale</div></Col>
                      </Row>

                      {/* Aadhaar Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2" style={{ background: 'rgba(10,179,156,0.08)', border: '1px solid rgba(10,179,156,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#0a8a78', fontSize: 12.5 }}>Aadhaar Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={3}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXX-XXXX-2821</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Enrollment No</div><div className="ep-field-value">147</div></Col>
                        <Col md={3}><div className="ep-field-label">Address</div><div className="ep-field-value">21 Jay Mahalar…</div></Col>
                        <Col md={3}><div className="ep-field-label">Gender</div><div className="ep-field-value">Male</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #0ab39c' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(10,179,156,0.18)',
                        background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                        <i className="ri-map-pin-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Address Proof</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-3" style={{ background: 'rgba(10,179,156,0.08)', border: '1px solid rgba(10,179,156,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#0a8a78', fontSize: 12.5 }}>Aadhaar Card (Address Proof)</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={6}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXX-XXXX-2821</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Enrollment No</div><div className="ep-field-value">147</div></Col>
                        <Col md={6}><div className="ep-field-label">Address</div><div className="ep-field-value">21 Jay Mahalar, Pune</div></Col>
                        <Col md={6}><div className="ep-field-label">Verification</div><div className="ep-field-value font-monospace">01-Jan-2024</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #f59e0b' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(245,158,11,0.20)',
                        background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                        <i className="ri-shield-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Statutory Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <span className="d-inline-flex align-items-center fw-semibold mb-3" style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#a16207', border: '1px solid rgba(245,158,11,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        PT Details
                      </span>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">State</div><div className="ep-field-value">Maharashtra</div></Col>
                        <Col md={6}><div className="ep-field-label">Registered Location</div><div className="ep-field-value">Maharashtra</div></Col>
                        <Col md={6}><div className="ep-field-label">PT Applicable</div><div className="ep-field-value">Yes</div></Col>
                        <Col md={6}><div className="ep-field-label">Professional Tax</div><div className="ep-field-value">₹200/month</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>
            </>
          )}

          {payrollTab === 'details' && (
            <>
              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={5}>
                  <div
                    className="ep-section-card-flat ep-section-card h-100 d-flex flex-column"
                    style={{
                      background: 'linear-gradient(135deg, #064e3b, #065f46, #059669)',
                      color: '#fff', padding: '14px 18px',
                      position: 'relative', overflow: 'hidden',
                      border: 'none',
                    }}
                  >
                    <div style={{ position: 'absolute', top: -30, right: -20, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
                    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <p className="mb-1" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>Current Compensation</p>
                        <h2 className="mb-0 fw-bold text-white" style={{ fontSize: 28, lineHeight: 1.1 }}>₹3,02,400</h2>
                        <p className="mb-0 mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.80)' }}>Per Annum</p>
                      </div>
                      <div className="d-flex gap-3 mt-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.18)' }}>
                        <div>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Monthly</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>₹25,200</h6>
                        </div>
                        <div className="ps-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.18)' }}>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Annual</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>₹3,02,400</h6>
                        </div>
                      </div>
                    </div>
                  </div>
                </Col>
                <Col xl={7}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #6366f1' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(99,102,241,0.18)',
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                        <i className="ri-briefcase-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Payroll Info</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <Row className="g-3">
                        <Col md={4}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">INORBVICT Healthcare India Pvt. Ltd.</div></Col>
                        <Col md={4}><div className="ep-field-label">Remuneration Type</div><div className="ep-field-value">Annual</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Cycle</div><div className="ep-field-value">Monthly</div></Col>
                        <Col md={4}><div className="ep-field-label">Payroll Status</div><div className="ep-field-value">Active</div></Col>
                        <Col md={4}><div className="ep-field-label">Tax Regime</div><div className="ep-field-value">New Regime (115BAC)</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Group</div><div className="ep-field-value">Default</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <div
                className="d-flex align-items-center gap-2 mb-3"
                style={{ padding: '12px 16px', borderRadius: 12, background: '#fff7e6', border: '1px solid #fbcf8a', color: '#a4661c', fontSize: 13 }}
              >
                <i className="ri-information-line" style={{ fontSize: 16 }} />
                <span>Income and tax liability is being computed as per <strong>New Tax Regime</strong>. To switch to Old Tax Regime, contact your HR admin.</span>
              </div>

              <div
                className="ep-section-card-flat ep-section-card mb-3"
                style={{ borderTop: '3px solid #0ab39c' }}
              >
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                      <i className="ri-line-chart-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Salary Timeline</h6>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReviseOpen(true)}
                    className="d-inline-flex align-items-center gap-1 fw-semibold"
                    style={{
                      background: 'linear-gradient(135deg,#0a8a78,#0ab39c)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 999,
                      padding: '6px 16px',
                      fontSize: 12,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(10,138,120,0.32)',
                    }}
                  >
                    <i className="ri-edit-line" style={{ fontSize: 13 }} /> Revise Salary
                  </button>
                </div>
                <div className="px-3 py-2 position-relative">
                  {/* Vertical guide line connecting the timeline dots */}
                  <span style={{
                    position: 'absolute',
                    left: 25, top: 22, bottom: 22,
                    width: 2,
                    background: 'var(--vz-border-color)',
                    pointerEvents: 'none',
                  }} />
                  {SALARY_TIMELINE.map((row, idx) => (
                    <div
                      key={row.id}
                      className="d-flex align-items-center gap-3 py-2 flex-wrap position-relative"
                    >
                      {/* Timeline dot */}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                        style={{
                          width: 18, height: 18,
                          background: row.current ? '#0ab39c' : 'var(--vz-card-bg)',
                          border: row.current ? '3px solid #fff' : '2px solid var(--vz-border-color)',
                          boxShadow: row.current ? '0 0 0 3px #0ab39c, 0 0 0 6px rgba(10,179,156,0.18)' : 'none',
                          position: 'relative', zIndex: 1,
                        }}
                      >
                        {!row.current && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--vz-border-color)' }} />}
                      </span>

                      {/* Row body — current row gets the soft green → white gradient */}
                      <div
                        className="d-flex align-items-center gap-3 flex-grow-1 flex-wrap"
                        style={{
                          background: row.current
                            ? 'linear-gradient(90deg, rgba(10,179,156,0.10) 0%, rgba(10,179,156,0.02) 60%, transparent 100%)'
                            : 'transparent',
                          border: row.current ? '1px solid rgba(10,179,156,0.30)' : '1px solid transparent',
                          borderRadius: 10,
                          padding: '8px 12px',
                        }}
                      >
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 10.5 }}>SALARY REVISION</p>
                            {row.current && (
                              <span
                                className="d-inline-flex align-items-center fw-bold text-uppercase"
                                style={{
                                  background: 'linear-gradient(135deg,#0a8a78,#0ab39c)',
                                  color: '#fff',
                                  fontSize: 9,
                                  letterSpacing: '0.08em',
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  boxShadow: '0 2px 6px rgba(10,138,120,0.32)',
                                }}
                              >
                                CURRENT
                              </span>
                            )}
                          </div>
                          <small style={{ color: 'var(--vz-secondary-color)', fontSize: 11.5 }}>
                            Effective <span className="fw-semibold" style={{ color: 'var(--vz-body-color)' }}>{row.dateShort}</span>
                          </small>
                        </div>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 9.5 }}>Regular Salary</p>
                          <div className="fw-bold" style={{ fontSize: 13, color: 'var(--vz-body-color)' }}>₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <span style={{ color: 'var(--vz-secondary-color)', fontSize: 14 }}>=</span>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 9.5 }}>Total</p>
                          <div className="fw-bold" style={{ fontSize: 13, color: '#0a8a78' }}>₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <button
                          type="button"
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            background: '#fff',
                            color: '#374151',
                            border: '1px solid var(--vz-border-color)',
                            borderRadius: 999,
                            padding: '5px 14px',
                            fontSize: 11.5,
                            cursor: 'pointer',
                          }}
                          onClick={() => { setBreakdownRowId(row.id); setBreakdownOpen(true); }}
                        >
                          View Breakdown
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </ComingSoonShell>
      )}

      {/* ── Tab: Expense Details ── */}
      {tab === 'expense' && (
        <>
          {/* Expense Overview hero — same shape as Evidence Vault / Payroll Summary. */}
          <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                color: '#fff',
                padding: '12px 18px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
              <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                    <i className="ri-wallet-3-line" style={{ fontSize: 17, color: '#fff' }} />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Expense Overview</p>
                  <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    Total Claimed: <span style={{ color: '#bce8ff' }}>₹{totalClaimed.toLocaleString('en-IN')}</span>
                  </div>
                  <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>{expenseCounts.all} claims · {expenseCounts.approved} approved · {expenseCounts.pending} pending</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total',    value: expenseCounts.all,      color: '#fff' },
                      { label: 'Approved', value: expenseCounts.approved, color: '#86efac' },
                      { label: 'Pending',  value: expenseCounts.pending,  color: '#fcd34d' },
                      { label: 'Rejected', value: expenseCounts.rejected, color: '#fca5a5' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center"
                        style={{
                          background: 'rgba(255,255,255,0.10)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          borderRadius: 9,
                          padding: '4px 10px',
                          minWidth: 72,
                        }}
                      >
                        <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                        <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Expense Claims */}
          <div
            className="ep-section-card-flat ep-section-card mb-3"
            style={{ borderTop: '3px solid #a855f7' }}
          >
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap"
              style={{
                borderBottom: '1px solid rgba(168,85,247,0.18)',
                background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                  <i className="ri-file-list-3-line" />
                </span>
                <div>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Expense Claims</h6>
                  <small className="text-muted" style={{ fontSize: 11 }}>
                    {expenseCounts.all} total · {expenseCounts.approved} approved · {expenseCounts.pending} pending
                  </small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="search-box" style={{ minWidth: 200 }}>
                  <input type="text" className="form-control form-control-sm" placeholder="Search…" style={{ fontSize: 12, height: 30 }} />
                  <i className="ri-search-line search-icon" style={{ fontSize: 12 }} />
                </div>
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'var(--vz-card-bg)',
                    color: '#374151',
                    border: '1px solid var(--vz-border-color)',
                    fontSize: 11.5, padding: '4px 12px',
                  }}
                >
                  <i className="ri-download-2-line" /> Export
                </button>
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'linear-gradient(135deg,#f97316,#fb923c)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 4px 10px rgba(249,115,22,0.28)',
                    fontSize: 11.5, padding: '4px 12px',
                  }}
                  onClick={() => { setClaimMode('expense'); setClaimOpen(true); }}
                >
                  <i className="ri-add-line" /> Raise New Claim
                </button>
              </div>
            </div>
            <div className="px-3 pb-3 pt-2">
              {/* Filter pills — active = solid filled with colored shadow for
                  strong visibility; inactive = subtle white with border. */}
              <div className="d-flex gap-2 flex-wrap mb-3">
                {[
                  { key: 'all'      as ExpenseFilter, label: 'All',      count: expenseCounts.all,      active: '#6366f1', shadow: 'rgba(99,102,241,0.32)' },
                  { key: 'approved' as ExpenseFilter, label: 'Approved', count: expenseCounts.approved, active: '#10b981', shadow: 'rgba(16,185,129,0.32)' },
                  { key: 'rejected' as ExpenseFilter, label: 'Rejected', count: expenseCounts.rejected, active: '#ef4444', shadow: 'rgba(239,68,68,0.32)'  },
                  { key: 'pending'  as ExpenseFilter, label: 'Pending',  count: expenseCounts.pending,  active: '#f59e0b', shadow: 'rgba(245,158,11,0.32)' },
                ].map(f => {
                  const on = expenseFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setExpenseFilter(f.key)}
                      className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold"
                      style={{
                        fontSize: 11.5,
                        padding: '4px 12px',
                        background: on ? f.active : 'var(--vz-card-bg)',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: `1px solid ${on ? f.active : 'var(--vz-border-color)'}`,
                        boxShadow: on ? `0 4px 10px ${f.shadow}` : 'none',
                        transition: 'all .15s ease',
                      }}
                    >
                      {f.label}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-pill"
                        style={{
                          minWidth: 20, height: 16,
                          padding: '0 6px',
                          background: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          fontSize: 10, fontWeight: 700,
                        }}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Claims table */}
              <div className="table-responsive border rounded ep-att-scroll-wrap">
                <table className="table align-middle table-nowrap ep-att-table mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Exp ID</th>
                      <th>Employee</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Expense Date</th>
                      <th>Amount</th>
                      <th>Proof of Payment</th>
                      <th>Payment Action</th>
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
                      // Fall back to a neutral tone for categories that aren't
                      // in the hard-coded EXPENSE_CATEGORY_TONE palette (e.g.
                      // categories created via the expense_category master).
                      const cat = EXPENSE_CATEGORY_TONE[c.category] ?? {
                        bg: '#eef2f6', fg: '#5b6478', icon: 'ri-price-tag-3-line',
                      };
                      const st = EXPENSE_STATUS_TONE[c.status];
                      return (
                        <tr key={c.id}>
                          <td>
                            <span
                              className="font-monospace fw-semibold"
                              style={{
                                fontSize: 11, padding: '2px 9px', borderRadius: 999,
                                background: '#ece6ff', color: '#5a3fd1', letterSpacing: '0.02em',
                              }}
                            >
                              {c.id}
                            </span>
                          </td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{
                                  width: 24, height: 24, fontSize: 10,
                                  background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                                  boxShadow: `0 2px 6px ${accent}40`,
                                }}
                              >
                                {initials}
                              </div>
                              <span className="fw-semibold">{employee?.name || employeeId}</span>
                            </div>
                          </td>
                          <td>
                            <span
                              className="d-inline-flex align-items-center gap-1 fw-semibold"
                              style={{
                                fontSize: 11, padding: '3px 9px', borderRadius: 999,
                                background: cat.bg, color: cat.fg,
                              }}
                            >
                              <i className={cat.icon} />
                              {c.category}
                            </span>
                          </td>
                          <td>
                            {c.description}
                          </td>
                          <td className="text-muted">{c.date}</td>
                          <td className="fw-bold">₹{c.amount.toLocaleString('en-IN')}</td>
                          <td>
                            <a
                              href="#"
                              onClick={(e) => { e.preventDefault(); toast.info('Downloading receipt', `${c.receipt} is being prepared…`); }}
                              className="d-inline-flex align-items-center gap-1 text-decoration-none"
                              style={{
                                fontSize: 11,
                                padding: '3px 9px',
                                borderRadius: 8,
                                background: 'rgba(239,68,68,0.10)',
                                color: '#dc2626',
                                fontWeight: 600,
                                border: '1px solid rgba(239,68,68,0.25)',
                              }}
                            >
                              <i className="ri-file-text-line" />
                              {c.receipt}…
                            </a>
                          </td>
                          <td>
                            {c.status === 'Pending' ? (
                              <div className="d-flex gap-1">
                                <button
                                  type="button"
                                  className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 10px',
                                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                                    color: '#fff', border: 'none',
                                    boxShadow: '0 2px 6px rgba(10,179,156,0.25)',
                                  }}
                                >
                                  <i className="ri-check-line" /> Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 10px',
                                    background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                                    color: '#fff', border: 'none',
                                    boxShadow: '0 2px 6px rgba(240,101,72,0.25)',
                                  }}
                                >
                                  <i className="ri-close-line" /> Reject
                                </button>
                              </div>
                            ) : (
                              <span
                                className="d-inline-flex align-items-center gap-1 fw-semibold"
                                style={{
                                  fontSize: 11,
                                  padding: '3px 10px',
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
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Apply Leave (inline wizard) ── */}
      {tab === 'apply_leave' && (
        <ApplyLeavePanel
          employee={employee}
          employeeId={employeeId}
          stage={leaveStage}
          setStage={setLeaveStage}
          leaveType={leaveType} setLeaveType={setLeaveType}
          dayType={leaveDayType} setDayType={setLeaveDayType}
          fromDate={leaveFromDate} setFromDate={setLeaveFromDate}
          toDate={leaveToDate} setToDate={setLeaveToDate}
          reason={leaveReason} setReason={setLeaveReason}
          docName={leaveDocName} setDocName={setLeaveDocName}
          notify={leaveNotify} setNotify={setLeaveNotify}
          specificEmps={leaveSpecificEmps} setSpecificEmps={setLeaveSpecificEmps}
          handoverReq={leaveHandoverReq} setHandoverReq={setLeaveHandoverReq}
          coverPerson={leaveCoverPerson} setCoverPerson={setLeaveCoverPerson}
          handoverNotes={leaveHandoverNotes} setHandoverNotes={setLeaveHandoverNotes}
          criticalTasks={leaveCriticalTasks} setCriticalTasks={setLeaveCriticalTasks}
          availOnCall={leaveAvailOnCall} setAvailOnCall={setLeaveAvailOnCall}
          emergencyNumber={leaveEmergencyNumber} setEmergencyNumber={setLeaveEmergencyNumber}
          availNote={leaveAvailNote} setAvailNote={setLeaveAvailNote}
          onClose={() => { resetLeaveWizard(); setTab('profile'); }}
        />
      )}

      </div>
    </div>

    {/* ── Attendance Regularization Modal ── */}
    <EpModal open={regOpen} onClose={() => setRegOpen(false)} size="md" panelClassName="ep-reg-modal">
        <style>{`
          /* Lift the modal above the .ep-fullscreen-overlay (z-index 1080)
             so it isn't hidden behind the navy hero. Bootstrap defaults to
             1055/1050 which falls below the overlay. */
          .modal.ep-reg-modal { z-index: 2100 !important; }
          .modal-backdrop.ep-reg-backdrop { z-index: 2095 !important; }
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

        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: '1 1 auto' }}>
          {/* Selected Date */}
          <div className="mb-3">
            <div className="ep-reg-label">Selected Date</div>
            <input className="ep-reg-input" value={regSelectedDate} readOnly />
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
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance Adjustment</h6>
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
              <div className="mb-1">
                <MasterSelect
                  value={regLocationDraft}
                  placeholder="— Select location —"
                  options={REG_LOCATION_OPTIONS.filter(o => !regLocations.includes(o)).map(o => ({ value: o, label: o }))}
                  onChange={(v) => {
                    if (v && !regLocations.includes(v)) {
                      setRegLocations(prev => [...prev, v]);
                    }
                    setRegLocationDraft('');
                  }}
                />
              </div>
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
        </div>

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
      </EpModal>

      {/* ── Payslip Viewer Modal ── */}
      <EpModal open={paySlipOpen} onClose={() => setPaySlipOpen(false)} size="xl" panelClassName="ep-pay-modal">
        <div className="ep-pay-shell">
          {/* Header bar */}
          <div className="ep-pay-header">
            <div className="d-flex align-items-center gap-3">
              <span className="ep-pay-logo">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <h5 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Payslip Viewer</h5>
                <small className="text-muted" style={{ fontSize: 10.5 }}>Select month and year to view or download payslip</small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', border: 'none', fontSize: 11, padding: '5px 12px', borderRadius: 7, boxShadow: '0 3px 10px rgba(10,179,156,0.28)' }}>
                <i className="ri-download-2-line" /> Download PDF
              </button>
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-printer-line" /> Print
              </button>
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-mail-line" /> Email
              </button>
              <button type="button" className="ep-pay-x" onClick={() => setPaySlipOpen(false)} aria-label="Close">
                <i className="ri-close-line" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>

          {/* Body — sidebar + payslip preview */}
          <div className="ep-pay-body">
            {/* Sidebar */}
            <aside className="ep-pay-sidebar">
              <div className="ep-pay-side-label">Filter</div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Year</div>
                <MasterSelect
                  value={paySlipYear}
                  options={['2026','2025','2024'].map(y => ({ value: y, label: y }))}
                  onChange={setPaySlipYear}
                />
              </div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Month</div>
                <MasterSelect
                  value={paySlipMonth}
                  options={['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => ({ value: m, label: m }))}
                  onChange={setPaySlipMonth}
                />
              </div>
              <button type="button" className="ep-pay-side-btn">
                <i className="ri-eye-line me-1" /> View Payslip
              </button>

              <div className="ep-pay-side-label mt-4">Recent Payslips</div>
              <div className="d-flex flex-column gap-2">
                {PAYSLIP_RECENT.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`ep-pay-recent${p.now ? ' is-current' : ''}`}
                    onClick={() => {
                      const [m, y] = p.label.split(' ');
                      const monthMap: Record<string,string> = { Jan:'January', Feb:'February', Mar:'March', Apr:'April', May:'May', Jun:'June', Jul:'July', Aug:'August', Sep:'September', Oct:'October', Nov:'November', Dec:'December' };
                      setPaySlipMonth(monthMap[m] || m);
                      setPaySlipYear(y);
                    }}
                  >
                    <span>{p.label}</span>
                    {p.now ? <span className="ep-pay-now">NOW</span> : <i className="ri-arrow-right-s-line" />}
                  </button>
                ))}
              </div>
            </aside>

            {/* Payslip preview */}
            <div className="ep-pay-preview">
              {/* Company hero */}
              <div className="ep-pay-company">
                <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                <div className="d-flex align-items-start justify-content-between gap-3" style={{ position: 'relative', zIndex: 1 }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-pay-company-logo">IN</span>
                    <div>
                      <h5 className="mb-0 text-white fw-bold" style={{ fontSize: 14 }}>INORBVICT Healthcare India Pvt. Ltd.</h5>
                      <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10.5 }}>
                        Pune, Maharashtra, India · GSTIN: 27XXXXXXXXXXX · CIN: U85190MH2020PTC339XXX
                      </small>
                    </div>
                  </div>
                  <div className="text-end">
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYSLIP</div>
                    <h4 className="text-white mb-0 fw-bold" style={{ fontSize: 17 }}>{paySlipMonth} {paySlipYear}</h4>
                    <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10 }}>Pay Period: 01–31 {paySlipMonth.slice(0,3)} {paySlipYear}</small>
                  </div>
                </div>

                {/* Inner identity strip */}
                <div className="ep-pay-identity">
                  {[
                    { label: 'Employee Name', value: employee?.name || 'Aarav Patel' },
                    { label: 'Employee ID',   value: employeeId },
                    { label: 'Designation',   value: employee?.designation || 'VP Engineering' },
                    { label: 'Department',    value: employee?.department || 'Software Development' },
                    { label: 'Pay Period',    value: `${paySlipMonth.slice(0,3)} ${paySlipYear}` },
                  ].map(c => (
                    <div className="ep-pay-identity-cell" key={c.label}>
                      <div className="ep-pay-identity-label">{c.label}</div>
                      <div className="ep-pay-identity-value">{c.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4 KPI strip */}
              <div className="ep-pay-kpis">
                {[
                  { label: 'Working Days', value: 31, tint: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
                  { label: 'Days Present', value: 31, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                  { label: 'Loss of Pay',  value: 0,  tint: 'rgba(245,158,11,0.10)',  fg: '#a16207' },
                  { label: 'Paid Days',    value: 31, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                ].map(k => (
                  <div className="ep-pay-kpi" key={k.label} style={{ background: k.tint }}>
                    <div className="ep-pay-kpi-label">{k.label}</div>
                    <div className="ep-pay-kpi-value" style={{ color: k.fg }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Earnings + Deductions */}
              <Row className="g-2 mb-2">
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#10b981' }} />
                      <span style={{ color: '#108548' }}>EARNINGS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {PAYSLIP_EARNINGS.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(16,185,129,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#108548' }}>Total Earnings</td>
                          <td className="text-end fw-bold" style={{ color: '#108548' }}>₹{paySlipTotalEarnings.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#ef4444' }} />
                      <span style={{ color: '#b91c1c' }}>DEDUCTIONS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {PAYSLIP_DEDUCTIONS.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(239,68,68,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#b91c1c' }}>Total Deductions</td>
                          <td className="text-end fw-bold" style={{ color: '#b91c1c' }}>₹{paySlipTotalDeductions.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
              </Row>

              {/* Net Pay banner */}
              <div className="ep-pay-net">
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>
                    NET PAY — {paySlipMonth.toUpperCase()} {paySlipYear}
                  </div>
                  <h5 className="text-white fw-semibold mb-2" style={{ fontSize: 12 }}>Gross Earnings − Total Deductions</h5>
                  <div className="d-flex gap-3">
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>GROSS</div>
                      <div className="text-white fw-bold" style={{ fontSize: 12 }}>₹{paySlipTotalEarnings.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>DEDUCTIONS</div>
                      <div className="fw-bold" style={{ color: '#fecaca', fontSize: 12 }}>−₹{paySlipTotalDeductions.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0" style={{ fontSize: 26 }}>
                    ₹{paySlipNetPay.toLocaleString('en-IN')}
                  </h2>
                  <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10 }}>Per Month (In Hand)</small>
                </div>
              </div>

              <div className="ep-pay-footer">
                This is a computer-generated payslip. No signature required. Queries:{' '}
                <a href="mailto:hr@inorbvict.com">hr@inorbvict.com</a>
              </div>
            </div>
          </div>
        </div>
      </EpModal>

      {/* ── Revise Salary Modal ── */}
      <EpModal open={reviseOpen} onClose={() => setReviseOpen(false)} size="xl" panelClassName="ep-rev-modal">
        {/* Hero header */}
        <div className="ep-rev-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYROLL ACTION</div>
              <h4 className="text-white fw-bold mb-0" style={{ fontSize: 16 }}>Revise Salary</h4>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="ep-rev-cancel-hero" onClick={() => setReviseOpen(false)}>Cancel</button>
              <button type="button" className="ep-rev-submit-hero" onClick={() => setReviseOpen(false)}>
                <i className="ri-check-line me-1" /> Revise Salary
              </button>
            </div>
          </div>

          {/* Employee strip */}
          <div className="ep-rev-strip">
            <div className="ep-rev-strip-cell">
              <span className="ep-rev-avatar">{initials}</span>
              <div>
                <div className="ep-rev-strip-label">Employee</div>
                <div className="ep-rev-strip-value">{employee?.name || 'Aarav Patel'}</div>
                <div className="ep-rev-strip-sub">{employee?.designation || 'VP Engineering'}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Joined</div>
                <div className="ep-rev-strip-value">17-May-2022</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Department</div>
                <div className="ep-rev-strip-value">{employee?.department || 'Software Development'}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Current Salary</div>
                <div className="ep-rev-strip-value">₹{currentAnnual.toLocaleString('en-IN')}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Remuneration</div>
                <div className="ep-rev-strip-value">Annual</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Bonus</div>
                <div className="ep-rev-strip-value" style={{ color: '#fcd34d' }}>₹0</div>
              </div>
            </div>
          </div>
        </div>

        {/* Body — form on left, live preview on right */}
        <div className="ep-rev-body">
          <div className="ep-rev-form">
            {/* New Salary Details */}
            <div className="ep-rev-card mb-2">
              <div className="d-flex align-items-center gap-2 mb-2">
                <span className="ep-rev-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)' }}>
                  <i className="ri-money-dollar-circle-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>New Salary Details</h6>
              </div>
              <Row className="g-2">
                <Col md={6}>
                  <div className="ep-rev-label">New Salary (₹ Annual)</div>
                  <div className="position-relative">
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>₹</span>
                    <input
                      className="ep-rev-input"
                      style={{ paddingLeft: 24 }}
                      value={reviseAmount}
                      onChange={e => setReviseAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </Col>
                <Col md={6}>
                  <div className="ep-rev-label">Percentage Change (%)</div>
                  <div className="position-relative">
                    <input
                      className="ep-rev-input"
                      style={{ paddingRight: 24 }}
                      value={revisePct}
                      onChange={e => setRevisePct(e.target.value)}
                      placeholder="e.g. 15"
                    />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>%</span>
                  </div>
                </Col>
              </Row>
            </div>

            <Row className="g-2 mb-2">
              <Col md={6}>
                <div className="ep-rev-card h-100">
                  <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>Salary Structure</h6>
                  <div className="ep-rev-label mt-2">Structure Type</div>
                  <MasterSelect
                    value={reviseStructure}
                    options={['Class A', 'Class B', 'Class C'].map(s => ({ value: s, label: s }))}
                    onChange={setReviseStructure}
                  />
                </div>
              </Col>
              <Col md={6}>
                <div className="ep-rev-card h-100">
                  <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>Effective Date</h6>
                  <div className="ep-rev-label mt-2">From Date</div>
                  <MasterDatePicker
                    value={reviseDate}
                    onChange={setReviseDate}
                  />
                </div>
              </Col>
            </Row>

            <div className="ep-rev-card mb-2">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <h6 className="mb-0 fw-bold" style={{ fontSize: 11 }}>Bonus</h6>
                <label className="d-inline-flex align-items-center gap-1" style={{ fontSize: 11, cursor: 'pointer' }}>
                  <input type="checkbox" checked={reviseBonusInSal} onChange={e => setReviseBonusInSal(e.target.checked)} />
                  Include bonus in salary
                </label>
              </div>
              {reviseBonusOpen && (
                <div className="mb-1">
                  <div className="ep-rev-label">Bonus Amount (₹)</div>
                  <div className="position-relative">
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>₹</span>
                    <input
                      className="ep-rev-input"
                      style={{ paddingLeft: 24 }}
                      placeholder="0"
                      value={reviseBonusAmount}
                      onChange={e => setReviseBonusAmount(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                className="ep-rev-add-btn"
                onClick={() => {
                  if (reviseBonusOpen) {
                    setReviseBonusOpen(false);
                    setReviseBonusAmount('');
                  } else {
                    setReviseBonusOpen(true);
                  }
                }}
              >
                <i className={reviseBonusOpen ? 'ri-subtract-line' : 'ri-add-line'} />{' '}
                {reviseBonusOpen ? 'Remove Bonus' : 'Add Bonus'}
              </button>
            </div>

            <div className="ep-rev-card">
              <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>
                Add Note <span className="text-muted fw-normal" style={{ fontSize: 10.5 }}>(optional)</span>
              </h6>
              <textarea
                className="ep-rev-input mt-1"
                rows={2}
                placeholder="Reason for revision, performance notes, appraisal cycle..."
                value={reviseNote}
                onChange={e => setReviseNote(e.target.value)}
              />
            </div>
          </div>

          {/* Live preview sidebar */}
          <aside className="ep-rev-preview">
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="ri-eye-line" style={{ color: '#0ab39c', fontSize: 13 }} />
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Live Preview</h6>
            </div>

            <div className="ep-rev-net">
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>NEW COMPENSATION</div>
              <h2 className="text-white fw-bold mb-0" style={{ fontSize: 22, lineHeight: 1.1 }}>
                ₹{reviseAnnualNum.toLocaleString('en-IN')}
              </h2>
              <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10 }}>Per Annum</small>
              <div className="d-flex justify-content-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.20)' }}>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>MONTHLY</div>
                  <div className="text-white fw-bold" style={{ fontSize: 11.5 }}>₹{reviseMonthlyNum.toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>BONUS</div>
                  <div className="fw-bold" style={{ color: '#fcd34d', fontSize: 11.5 }}>₹0</div>
                </div>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>TOTAL</div>
                  <div className="text-white fw-bold" style={{ fontSize: 11.5 }}>₹{reviseAnnualNum.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            <div className="ep-rev-summary">
              <div className="ep-rev-summary-head">CHANGE SUMMARY</div>
              <div className="ep-rev-summary-row">
                <span>Current Salary</span>
                <span className="fw-semibold">₹{currentAnnual.toLocaleString('en-IN')}</span>
              </div>
              <div className="ep-rev-summary-row">
                <span>New Salary</span>
                <span className="fw-semibold" style={{ color: '#0a8a78' }}>
                  {reviseAnnualNum > 0 ? `₹${reviseAnnualNum.toLocaleString('en-IN')}` : '₹—'}
                </span>
              </div>
              <div className="ep-rev-summary-row">
                <span>Difference</span>
                <span className="fw-semibold" style={{ color: reviseDifference >= 0 ? '#0a8a78' : '#b91c1c' }}>
                  {reviseAnnualNum > 0 ? `${reviseDifference >= 0 ? '+' : ''}₹${reviseDifference.toLocaleString('en-IN')}` : '₹—'}
                </span>
              </div>
              <div className="ep-rev-summary-row">
                <span>% Change</span>
                <span className="fw-semibold" style={{ color: revisePctChange >= 0 ? '#0a8a78' : '#b91c1c' }}>
                  {reviseAnnualNum > 0 ? `${revisePctChange >= 0 ? '+' : ''}${revisePctChange.toFixed(1)}%` : '—%'}
                </span>
              </div>
            </div>

            <div className="ep-rev-summary mt-2">
              <div className="d-flex align-items-center justify-content-between">
                <div className="ep-rev-summary-head mb-0">COMPONENT BREAKDOWN</div>
                <label className="d-inline-flex align-items-center gap-1" style={{ fontSize: 10.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showBreakdownToggle} onChange={e => setShowBreakdownToggle(e.target.checked)} />
                  Show
                </label>
              </div>
              {!showBreakdownToggle && (
                <small className="text-muted d-block text-center mt-1" style={{ fontSize: 10.5 }}>Toggle to see component split</small>
              )}
              {showBreakdownToggle && reviseAnnualNum > 0 && (() => {
                const bd = makeBreakdown(reviseAnnualNum);
                return (
                  <div className="mt-1">
                    {bd.rows.map(r => (
                      <div className="ep-rev-summary-row" key={r.label} style={{ fontSize: 10.5 }}>
                        <span>{r.label}</span>
                        <span className="fw-semibold">₹{r.monthly.toLocaleString('en-IN')}/mo</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </aside>
        </div>
      </EpModal>

      {/* ── Salary Breakdown Modal ── */}
      <EpModal open={breakdownOpen} onClose={() => setBreakdownOpen(false)} size="lg" panelClassName="ep-bd-modal">
        <div className="ep-bd-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>SALARY DETAILS</div>
              <h4 className="text-white fw-bold mb-1" style={{ fontSize: 20 }}>
                Salary Breakdown for{' '}
                <span style={{ color: '#86efac' }}>₹{breakdownRow.annual.toLocaleString('en-IN')} / Annum</span>
              </h4>
              <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
                Pay Group: <strong>Default</strong> · Structure: <strong>Class A</strong> · Effective: <strong>{breakdownRow.dateShort}</strong>
              </small>
            </div>
            <button type="button" className="ep-bd-close" onClick={() => setBreakdownOpen(false)} aria-label="Close">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div className="ep-bd-body">
          <div className="ep-bd-main">
            <div className="ep-bd-card">
              <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                <span className="ep-rev-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', width: 32, height: 32, fontSize: 16 }}>
                  <i className="ri-line-chart-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Earnings Breakdown</h6>
              </div>
              <table className="ep-bd-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="text-end">Monthly</th>
                    <th className="text-end">Annually</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownData.rows.map(r => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.monthly.toLocaleString('en-IN')}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.annual.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'rgba(16,185,129,0.06)' }}>
                    <td className="fw-bold" style={{ color: '#108548' }}>Total Earnings</td>
                    <td className="text-end fw-bold font-monospace" style={{ color: '#108548' }}>₹{breakdownData.totalMonthly.toLocaleString('en-IN')}</td>
                    <td className="text-end fw-bold font-monospace" style={{ color: '#108548' }}>₹{breakdownData.totalAnnual.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              </table>

              <div className="ep-bd-net">
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>AFTER TAX & DEDUCTIONS</div>
                  <h5 className="text-white fw-bold mb-0" style={{ fontSize: 16 }}>NET PAY</h5>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0" style={{ fontSize: 32 }}>₹{breakdownData.netPay.toLocaleString('en-IN')}</h2>
                  <small style={{ color: 'rgba(255,255,255,0.78)' }}>per month (estimated)</small>
                </div>
              </div>
            </div>

            <div className="ep-bd-note">
              <i className="ri-information-line" style={{ fontSize: 16, color: '#a16207', flexShrink: 0 }} />
              <div>
                <strong>Note:</strong> Net Pay excludes applicable taxes (TDS) and statutory deductions (PF, PT). Actual disbursement may vary based on declarations and investments.
              </div>
            </div>
          </div>

          {/* Version history */}
          <aside className="ep-bd-history">
            <div className="d-flex align-items-center gap-2 mb-3">
              <i className="ri-history-line" style={{ color: '#0ab39c' }} />
              <h6 className="mb-0 fw-bold">Version History</h6>
            </div>
            <div className="position-relative" style={{ paddingLeft: 22 }}>
              <div style={{ position: 'absolute', top: 12, bottom: 12, left: 8, width: 2, background: 'var(--vz-border-color)' }} />
              {SALARY_TIMELINE.map(s => {
                const active = s.id === breakdownRow.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ep-bd-version${active ? ' is-current' : ''}`}
                    onClick={() => setBreakdownRowId(s.id)}
                  >
                    <span className="ep-bd-dot" style={{ background: active ? '#0ab39c' : 'transparent', border: active ? 'none' : '2px solid var(--vz-border-color)' }}>
                      {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                    </span>
                    <div className="flex-grow-1 min-w-0 text-start">
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <small className="fw-semibold">{s.dateShort}</small>
                        {s.current && <span className="ep-bd-now">CURRENT</span>}
                      </div>
                      <div className="fw-bold" style={{ color: active ? '#0a8a78' : 'var(--vz-body-color)' }}>
                        ₹{s.annual.toLocaleString('en-IN')}
                      </div>
                      <small className="text-muted">Per Annum</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </EpModal>

      {/* ── Submit New Expense Claim / Advance Request Modal ── */}
      <EpModal open={claimOpen} onClose={() => setClaimOpen(false)} size="xl" panelClassName={`ep-claim-modal ${claimMode === 'expense' ? 'is-expense' : 'is-advance'}`}>
        {/* Hero header */}
        <div className="ep-claim-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3">
              <span className="ep-claim-icon">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <h5 className="text-white fw-bold mb-0" style={{ fontSize: 14 }}>
                  {claimMode === 'expense' ? 'Submit New Expense Claim' : 'Advance Request — Recoverable Payout'}
                </h5>
                <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10.5 }}>
                  All required fields must be completed · Receipt required above ₹500 · Changes take effect after approval flow completes
                </small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="ep-claim-mode-pill">
                {claimMode === 'expense' ? 'EXPENSE MODE' : 'ADVANCE MODE'}
              </span>
              <button type="button" className="ep-claim-x" onClick={() => setClaimOpen(false)} aria-label="Close">
                <i className="ri-close-line" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>

          {/* Mode tabs + flow hint */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2">
            <div className="ep-claim-tabs">
              <button
                type="button"
                className={`ep-claim-tab${claimMode === 'expense' ? ' is-active' : ''}`}
                onClick={() => setClaimMode('expense')}
              >
                <i className="ri-file-text-line" /> Expense Claim
              </button>
              <button
                type="button"
                className={`ep-claim-tab${claimMode === 'advance' ? ' is-active' : ''}`}
                onClick={() => setClaimMode('advance')}
              >
                <i className="ri-money-dollar-circle-line" /> Advance Request
              </button>
            </div>
            <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>
              {claimMode === 'expense'
                ? <>Expense → <strong>Reimbursement</strong> &nbsp;|&nbsp; Advance → Payroll Recovery</>
                : <>Advance → <strong>Payroll Recovery</strong> &nbsp;|&nbsp; Expense → Reimbursement</>}
            </small>
          </div>
        </div>

        {/* Body */}
        <div className="ep-claim-body">
          {claimMode === 'expense' ? (
            <Row className="g-2">
              {/* Left column */}
              <Col lg={6}>
                {/* Draft tabs — one per "Save & Add Another" click. Sits above
                    section A so users can hop between in-progress claims. */}
                <div className="ep-claim-tabs-strip">
                  {claimDrafts.map((d, i) => {
                    const isActive = i === activeClaimIdx;
                    const label = d.title?.trim()
                      ? d.title.trim().slice(0, 22)
                      : `Claim ${i + 1}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`ep-claim-draft-tab${isActive ? ' is-active' : ''}${d.saved ? ' is-saved' : ''}`}
                        onClick={() => setActiveClaimIdx(i)}
                        title={d.saved ? 'Saved draft — click to view' : 'Click to switch to this draft'}
                      >
                        {d.saved && <i className="ri-check-line me-1" />}
                        {label}
                        {claimDrafts.length > 1 && (
                          <span
                            className="ep-claim-draft-tab-x"
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = claimDrafts.filter((_, j) => j !== i);
                              setClaimDrafts(next.length ? next : [blankDraft()]);
                              setActiveClaimIdx(prev => {
                                if (next.length === 0) return 0;
                                if (i < prev) return prev - 1;
                                if (i === prev) return Math.max(0, prev - 1);
                                return prev;
                              });
                            }}
                            title="Close draft"
                          >
                            <i className="ri-close-line" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot" /> A — Claim Context
                </div>
                <div className="mb-3">
                  <div className="ep-claim-label">Employee <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={claimEmployee || employeeId}
                    placeholder="Select employee"
                    disabled
                    options={[{ value: employeeId, label: `${employee?.name || 'Aarav Patel'} (${employeeId})` }]}
                    onChange={setClaimEmployee}
                  />
                </div>
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <div className="ep-claim-label">Category <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={claimCategory}
                      placeholder={claimCategories.length ? 'Select category' : 'Loading…'}
                      options={claimCategories.map(c => ({ value: String(c.id), label: c.name }))}
                      onChange={setClaimCategory}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Currency</div>
                    <MasterSelect
                      value={claimCurrency}
                      options={[{ value: 'INR', label: '₹ INR' }, { value: 'USD', label: '$ USD' }, { value: 'EUR', label: '€ EUR' }]}
                      onChange={setClaimCurrency}
                    />
                  </Col>
                </Row>
                <Row className="g-3 mb-4">
                  <Col md={6}>
                    <div className="ep-claim-label">Project / Cost Center</div>
                    <MasterSelect
                      value={claimProject}
                      placeholder="Not assigned"
                      options={['HR','Sales','Operations','IT'].map(o => ({ value: o, label: o }))}
                      onChange={setClaimProject}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Payment Method</div>
                    <MasterSelect
                      value={claimPayment}
                      options={['UPI','PhonePe','Cash','Cheque','Bank Transfer'].map(o => ({ value: o, label: o }))}
                      onChange={setClaimPayment}
                    />
                  </Col>
                </Row>

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> B — Expense Details
                </div>
                <div className="mb-3">
                  <div className="ep-claim-label">Expense Title <span className="ep-claim-req">*</span></div>
                  <input className="ep-claim-input" placeholder="Brief description of expense..." value={claimTitle} onChange={e => setClaimTitle(e.target.value)} />
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input className="ep-claim-input" style={{ paddingLeft: 28 }} placeholder="0.00" value={claimAmount} onChange={e => setClaimAmount(e.target.value)} />
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Expense Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={claimDate} onChange={setClaimDate} />
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Vendor / Merchant</div>
                  <input className="ep-claim-input" placeholder="Vendor name (optional)" value={claimVendor} onChange={e => setClaimVendor(e.target.value)} />
                </div>
                <div className="mb-0">
                  <div className="ep-claim-label">Business Purpose <span className="ep-claim-req">*</span></div>
                  <textarea className="ep-claim-input" rows={3} placeholder="Explain the business purpose..." value={claimPurpose} onChange={e => setClaimPurpose(e.target.value)} />
                </div>
              </Col>

              {/* Right column */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> C — Proof &amp; Receipt
                </div>
                <label className="ep-claim-upload mb-2 d-block" style={{ cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length) setClaimFiles(prev => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon">
                    <i className="ri-upload-2-line" />
                  </span>
                  <div className="fw-semibold" style={{ fontSize: 13 }}>Click to upload or drag &amp; drop</div>
                  <small className="text-muted" style={{ fontSize: 11.5 }}>PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
                </label>
                {claimFiles.length > 0 && (
                  <div className="ep-claim-file-list mb-4">
                    {claimFiles.map((f, i) => (
                      <div key={i} className="ep-claim-file-row">
                        <i className="ri-attachment-2 ep-claim-file-icon" />
                        <div className="ep-claim-file-meta">
                          <div className="ep-claim-file-name">{f.name}</div>
                          <div className="ep-claim-file-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          onClick={() => setClaimFiles(prev => prev.filter((_, j) => j !== i))}
                          title="Remove"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {claimFiles.length === 0 && <div className="mb-4" />}

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> D — Approval Flow
                </div>
                <div className="ep-claim-flow mb-4">
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}>
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">HR / Finance Manager</div>
                      <div className="ep-claim-flow-sub">Final approval</div>
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          ) : (
            /* ── Advance Request mode ── */
            <Row className="g-4">
              <Col lg={6}>
                <div className="ep-claim-banner">
                  <span className="ep-claim-banner-icon">
                    <i className="ri-money-dollar-circle-line" />
                  </span>
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fw-bold" style={{ color: '#4338ca', fontSize: 14 }}>Advance Request — Recoverable Payout</h6>
                    <small style={{ color: '#6366f1', fontSize: 11.5 }}>Amount will be recovered through payroll deduction · Approval flow required</small>
                  </div>
                  <span className="ep-claim-flow-pill">APPROVAL FLOW</span>
                </div>

                <div className="mb-3">
                  <div className="ep-claim-label">Employee <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={claimEmployee || employeeId}
                    placeholder="Select employee"
                    disabled
                    options={[{ value: employeeId, label: `${employee?.name || 'Aarav Patel'} (${employeeId})` }]}
                    onChange={setClaimEmployee}
                  />
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Advance Type <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={advType}
                      placeholder="Select type..."
                      options={['Travel Advance','Salary Advance','Medical Advance','Other'].map(o => ({ value: o, label: o }))}
                      onChange={setAdvType}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input className="ep-claim-input" style={{ paddingLeft: 28 }} placeholder="0" value={advAmount} onChange={e => setAdvAmount(e.target.value)} />
                    </div>
                  </Col>
                </Row>
                {/* "Other" advance type — free-text input appears only when the
                    user picks Other so the dropdown stays uncluttered for the
                    common cases. */}
                {advType === 'Other' && (
                  <div className="mb-3">
                    <div className="ep-claim-label">Specify Advance Type <span className="ep-claim-req">*</span></div>
                    <input
                      className="ep-claim-input"
                      placeholder="e.g. Conference Registration, Education Loan…"
                      value={advTypeOther}
                      onChange={e => setAdvTypeOther(e.target.value)}
                    />
                  </div>
                )}
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Requested Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={advRequestedDate} onChange={setAdvRequestedDate} />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Recovery Start <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={advRecoveryStart} onChange={setAdvRecoveryStart} />
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Recovery Mode <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={advRecoveryMode}
                    placeholder="Select mode..."
                    options={[
                      { value: 'emi', label: 'EMI' },
                      { value: 'lumpsum', label: 'Single Lump Sum' },
                      { value: 'bimonthly', label: 'Bi-Monthly' },
                    ]}
                    onChange={setAdvRecoveryMode}
                  />
                </div>
                {/* Months + computed EMI only make sense for EMI mode — hide
                    them for lump sum / bi-monthly so the form stays tight. */}
                {advRecoveryMode === 'emi' && (
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <div className="ep-claim-label">No. of Months</div>
                      <input className="ep-claim-input" placeholder="e.g. 6" value={advMonths} onChange={e => setAdvMonths(e.target.value)} />
                    </Col>
                    <Col md={6}>
                      <div className="ep-claim-label">Monthly EMI</div>
                      <div className="position-relative">
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                        <input
                          className="ep-claim-input"
                          style={{ paddingLeft: 28 }}
                          placeholder="Auto from amount ÷ months"
                          value={advMonthlyEmi}
                          onChange={(e) => {
                            setAdvMonthlyEmi(e.target.value.replace(/[^\d.]/g, ''));
                            setAdvEmiTouched(true);
                          }}
                        />
                      </div>
                    </Col>
                  </Row>
                )}
                <div className="mb-0">
                  <div className="ep-claim-label">Reason / Purpose <span className="ep-claim-req">*</span></div>
                  <textarea className="ep-claim-input" rows={3} placeholder="Describe why this advance is needed..." value={advReason} onChange={e => setAdvReason(e.target.value)} />
                </div>
              </Col>

              {/* Right column — Supporting Documents (multi-file) + Approval Flow.
                  Replaces the old Payroll Recovery Preview / Advance Intelligence
                  placeholders, which weren't wired to anything actionable. */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> Supporting Documents
                </div>
                <label className="ep-claim-upload mb-2 d-block" style={{ background: 'rgba(99,102,241,0.04)', borderColor: 'rgba(99,102,241,0.25)', cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length) setAdvFiles(prev => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon" style={{ background: 'rgba(99,102,241,0.10)', color: '#6366f1' }}>
                    <i className="ri-attachment-line" />
                  </span>
                  <div className="fw-semibold" style={{ fontSize: 13, color: '#4338ca' }}>Attach documents (bank letter, itinerary…)</div>
                  <small className="text-muted" style={{ fontSize: 11.5 }}>PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
                </label>
                {advFiles.length > 0 && (
                  <div className="ep-claim-file-list mb-4">
                    {advFiles.map((f, i) => (
                      <div key={i} className="ep-claim-file-row">
                        <i className="ri-attachment-2 ep-claim-file-icon" />
                        <div className="ep-claim-file-meta">
                          <div className="ep-claim-file-name">{f.name}</div>
                          <div className="ep-claim-file-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          onClick={() => setAdvFiles(prev => prev.filter((_, j) => j !== i))}
                          title="Remove"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {advFiles.length === 0 && <div className="mb-4" />}

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> Approval Flow
                </div>
                <div className="ep-claim-flow mb-3">
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}>
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">HR / Finance Manager</div>
                      <div className="ep-claim-flow-sub">Final approval</div>
                    </div>
                  </div>
                </div>

                <div className="ep-claim-warn">
                  <i className="ri-error-warning-line" />
                  <div>
                    This creates a recoverable liability entry. The advance will be deducted from your salary per the selected schedule. Original record is immutable after approval.
                  </div>
                </div>
              </Col>
            </Row>
          )}
        </div>

        {/* Footer */}
        <div className="ep-claim-footer">
          <button type="button" className="ep-claim-cancel" onClick={() => setClaimOpen(false)}>Cancel</button>
          <div className="d-flex gap-2 ms-auto">
            <button type="button" className="ep-claim-secondary">
              <i className="ri-save-line me-1" /> Save Draft
            </button>
            {claimMode === 'expense' && (
              <button type="button" className="ep-claim-secondary" onClick={saveAndAddAnother}>
                <i className="ri-add-line me-1" /> Save &amp; Add Another
              </button>
            )}
            <button
              type="button"
              className="ep-claim-submit"
              onClick={claimMode === 'expense' ? submitAllDrafts : () => setClaimOpen(false)}
            >
              <i className={claimMode === 'expense' ? 'ri-send-plane-line me-1' : 'ri-send-plane-fill me-1'} />
              {claimMode === 'expense'
                ? (claimDrafts.length > 1 ? `Submit ${claimDrafts.length} Claims` : 'Submit Claim')
                : 'Submit Advance Request'}
            </button>
          </div>
        </div>
      </EpModal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveApplyModal — 7-stage wizard for raising a leave request. Opens from
// the "Apply Leave" tab on the employee profile. Self-contained so it can be
// extracted to its own file later when the leave-management feature grows.
// ─────────────────────────────────────────────────────────────────────────────
const LEAVE_STAGES: { num: number; title: string; subtitle: string; icon: string; iconBg: string }[] = [
  { num: 1, title: 'Leave Type',         subtitle: 'Select leave category & check available balance', icon: 'ri-clipboard-line',     iconBg: '#fef3c7' },
  { num: 2, title: 'Leave Duration',     subtitle: 'Pick from / to dates and the day-fraction',       icon: 'ri-calendar-line',      iconBg: '#dbeafe' },
  { num: 3, title: 'Reason & Document',  subtitle: 'Provide a reason and any supporting proof',       icon: 'ri-file-text-line',     iconBg: '#ede9fe' },
  { num: 4, title: 'Notify & Handover',  subtitle: 'Inform your manager and assign work cover',       icon: 'ri-team-line',          iconBg: '#dcfce7' },
  { num: 5, title: 'Availability',       subtitle: 'Reachability while on leave',                     icon: 'ri-phone-line',         iconBg: '#fee2e2' },
  { num: 6, title: 'Impact Preview',     subtitle: 'Review balance impact before submission',         icon: 'ri-bar-chart-2-line',   iconBg: '#fde8c4' },
  { num: 7, title: 'Approval Flow',      subtitle: 'Approver chain that will review this request',    icon: 'ri-user-follow-line',   iconBg: '#d3f0ee' },
];

// Leave-type catalogue. Balance fields (days / used / total) are intentionally
// `null` until the backend exposes the per-employee balance API; the UI falls
// back to em-dashes for unknown values so we don't ship fake numbers.
const LEAVE_TYPES: {
  id: string; name: string; desc: string;
  icon: string; iconBg: string; iconFg: string;
  days: number | null; used: number | null; total: number | null;
  daysColor: string; noLimit?: boolean;
}[] = [
  { id: 'casual',    name: 'Casual',    desc: 'Max 3 consecutive days. No carry-forward.',          icon: 'ri-focus-3-line',         iconBg: '#fed7aa', iconFg: '#c2410c', days: null, used: null, total: null, daysColor: '#a4661c' },
  { id: 'sick',      name: 'Sick',      desc: 'Medical certificate required for >2 days.',          icon: 'ri-emotion-sad-line',     iconBg: '#fee2e2', iconFg: '#dc2626', days: null, used: null, total: null, daysColor: '#b91c1c' },
  { id: 'paid',      name: 'Paid',      desc: 'Carry-forward allowed up to 30 days.',               icon: 'ri-secure-payment-line',  iconBg: '#dcfce7', iconFg: '#15803d', days: null, used: null, total: null, daysColor: '#15803d' },
  { id: 'unpaid',    name: 'Unpaid',    desc: 'Salary deducted for each unpaid leave day.',         icon: 'ri-file-list-3-line',     iconBg: '#e5e7eb', iconFg: '#6b7280', days: null, used: null, total: null, daysColor: '#6b7280', noLimit: true },
  { id: 'emergency', name: 'Emergency', desc: 'Requires manager approval within 24 hours.',         icon: 'ri-alarm-warning-line',   iconBg: '#fee2e2', iconFg: '#dc2626', days: null, used: null, total: null, daysColor: '#b91c1c' },
];

// Notification rows for stage 4 — checklist of who gets pinged on this leave.
const NOTIFY_ROWS: { key: keyof { manager: boolean; deptHead: boolean; hr: boolean; team: boolean }; title: string; desc: string; required?: boolean }[] = [
  { key: 'manager',  title: 'Reporting Manager', desc: 'Primary approver — always notified', required: true },
  { key: 'deptHead', title: 'Department Head',   desc: 'Inform the department lead' },
  { key: 'hr',       title: 'HR Department',     desc: "HR team will be CC'd on the request" },
  { key: 'team',     title: 'Team Members',      desc: 'All direct team members will be notified' },
];

// Days between two ISO dates (inclusive). Returns 0 if either is empty/invalid.
const diffDaysInclusive = (from: string, to: string): number => {
  if (!from || !to) return 0;
  const a = new Date(from); const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
};

// ─────────────────────────────────────────────────────────────────────────────
// ApplyLeavePanel — inline 7-stage wizard rendered as the "Apply Leave" tab
// content. Self-contained; all parent state is passed in via props so closing
// or switching tabs preserves the draft.
// ─────────────────────────────────────────────────────────────────────────────
function ApplyLeavePanel(props: {
  employee?: EmployeeProfileTarget;
  employeeId: string;
  stage: number;
  setStage: (n: number) => void;
  leaveType: string; setLeaveType: (v: string) => void;
  dayType: 'full' | 'half'; setDayType: (v: 'full' | 'half') => void;
  fromDate: string; setFromDate: (v: string) => void;
  toDate: string;   setToDate: (v: string) => void;
  reason: string;   setReason: (v: string) => void;
  docName: string;  setDocName: (v: string) => void;
  notify: { manager: boolean; deptHead: boolean; hr: boolean; team: boolean };
  setNotify: (v: { manager: boolean; deptHead: boolean; hr: boolean; team: boolean }) => void;
  specificEmps: string; setSpecificEmps: (v: string) => void;
  handoverReq: boolean; setHandoverReq: (v: boolean) => void;
  coverPerson: string;  setCoverPerson: (v: string) => void;
  handoverNotes: string; setHandoverNotes: (v: string) => void;
  criticalTasks: string; setCriticalTasks: (v: string) => void;
  availOnCall: boolean; setAvailOnCall: (v: boolean) => void;
  emergencyNumber: string; setEmergencyNumber: (v: string) => void;
  availNote: string;    setAvailNote: (v: string) => void;
  onClose: () => void;
}) {
  const {
    employee, employeeId, stage, setStage,
    leaveType, setLeaveType,
    dayType, setDayType,
    fromDate, setFromDate, toDate, setToDate,
    reason, setReason, docName, setDocName,
    notify, setNotify, specificEmps, setSpecificEmps,
    handoverReq, setHandoverReq,
    coverPerson, setCoverPerson, handoverNotes, setHandoverNotes, criticalTasks, setCriticalTasks,
    availOnCall, setAvailOnCall, emergencyNumber, setEmergencyNumber, availNote, setAvailNote,
    onClose,
  } = props;

  const totalStages = LEAVE_STAGES.length;
  const currentStage = LEAVE_STAGES[stage - 1];

  // Profile completion ramps up as the user fills in later stages — matches
  // the 17 / 25 / 33 progression shown in the design mocks.
  const profilePct = stage <= 5 ? 17 : stage === 6 ? 25 : 33;

  const initials = employee?.initials || 'RM';
  const accent = employee?.accent || '#7c5cfc';
  const name = employee?.name || 'Rohan Mehta';
  const department = employee?.department || 'Engineering';
  const designation = employee?.designation || 'Software Engineer';

  const selectedLeaveType = LEAVE_TYPES.find(lt => lt.id === leaveType);
  const totalDays = dayType === 'half' ? (diffDaysInclusive(fromDate, toDate) ? 0.5 : 0) : diffDaysInclusive(fromDate, toDate);

  const fileInputRef = (typeof window !== 'undefined') ? { current: null as HTMLInputElement | null } : { current: null };

  return (
    <div className="lvm-card-inline">
      <style>{`
        /* ── Inline wizard surface — same visual identity as the modal mock,
              but renders as a regular tab content panel. ── */
        .lvm-card-inline {
          background: #fff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(15,23,42,0.06);
          border: 1px solid var(--vz-border-color);
          display: flex; flex-direction: column;
        }
        [data-bs-theme="dark"] .lvm-card-inline { background: #1c2531; }

        /* Header — gradient purple, employee identity + close */
        .lvm-header {
          background: linear-gradient(135deg,#5a3fd1 0%,#7c5cfc 55%,#a78bfa 100%);
          color: #fff;
          padding: 16px 22px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap;
        }
        .lvm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
        .lvm-avatar {
          width: 48px; height: 48px; border-radius: 12px;
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 800; font-size: 16px; flex-shrink: 0;
          box-shadow: 0 4px 10px rgba(0,0,0,0.20);
        }
        .lvm-emp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .lvm-emp-name { font-size: 18px; font-weight: 800; margin: 0; letter-spacing: -0.01em; color: #fff; }
        .lvm-emp-sub { font-size: 11.5px; color: rgba(255,255,255,0.82); margin-top: 2px; }
        .lvm-badge {
          display: inline-flex; align-items: center;
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.20);
          color: #fff;
          font-size: 10.5px; font-weight: 700;
          border: 1px solid rgba(255,255,255,0.28);
        }
        .lvm-badge-pct { background: rgba(255,255,255,0.28); }
        .lvm-header-right { display: inline-flex; align-items: center; gap: 12px; }
        .lvm-flow-label { font-size: 13px; font-weight: 700; color: #fff; }
        .lvm-close {
          width: 30px; height: 30px;
          border-radius: 8px;
          background: rgba(255,255,255,0.18);
          border: none; color: #fff;
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background .15s ease;
        }
        .lvm-close:hover { background: rgba(255,255,255,0.30); }

        /* Body — sidebar + main. Renders at natural height so the page-level
           scroll handles overflow (no nested scrollbars). */
        .lvm-body {
          display: flex;
          flex: 1 1 auto;
          background: #f7f5fc;
          align-items: stretch;
        }
        [data-bs-theme="dark"] .lvm-body { background: #1f2630; }

        /* Sidebar — sticky inside the body so the stage list stays in view
           while the right panel scrolls past it. */
        .lvm-side {
          width: 260px; flex-shrink: 0;
          padding: 18px 16px 18px 22px;
          border-right: 1px solid #ece9f6;
          align-self: flex-start;
          position: sticky;
          top: 12px;
        }
        [data-bs-theme="dark"] .lvm-side { border-color: var(--vz-border-color); }
        .lvm-side-title {
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--vz-secondary-color);
          margin: 0 0 12px 0;
        }
        .lvm-stage {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          margin-bottom: 6px;
          cursor: pointer;
          width: 100%; text-align: left;
          transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
        }
        .lvm-stage:hover { background: #fff; border-color: #ece9f6; }
        .lvm-stage.is-active { background: #ffffff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,92,252,0.15); }
        .lvm-stage.is-done { background: #ffffff; }
        .lvm-stage-num {
          width: 28px; height: 28px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 800;
          background: #ece9f6; color: var(--vz-secondary-color);
          flex-shrink: 0;
        }
        .lvm-stage.is-active .lvm-stage-num { background: linear-gradient(135deg,#7c5cfc,#5a3fd1); color: #fff; }
        .lvm-stage.is-done .lvm-stage-num { background: linear-gradient(135deg,#0ab39c,#108548); color: #fff; }
        .lvm-stage.is-done .lvm-stage-num i { font-size: 14px; }
        .lvm-stage-meta { line-height: 1.3; min-width: 0; }
        .lvm-stage-name { font-size: 13.5px; font-weight: 700; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .lvm-stage-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .lvm-stage-status {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11.5px; font-weight: 600;
          color: var(--vz-secondary-color);
          margin-top: 2px;
        }
        .lvm-stage-status .dot { width: 5px; height: 5px; border-radius: 50%; }
        .lvm-stage.is-active .lvm-stage-status { color: #7c3aed; font-weight: 700; }
        .lvm-stage.is-active .lvm-stage-status .dot { background: #7c3aed; }
        .lvm-stage:not(.is-active):not(.is-done) .lvm-stage-status .dot { background: #cbd2dc; }
        .lvm-stage.is-done .lvm-stage-status { color: #108548; font-weight: 700; }

        /* Main — natural height; the page-level scroll handles overflow. */
        .lvm-main { flex: 1 1 auto; min-width: 0; padding: 14px 20px 10px; }

        /* Profile completion bar */
        .lvm-profile-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .lvm-profile-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); }
        .lvm-profile-pct { font-size: 16px; font-weight: 800; color: #f06548; }
        .lvm-profile-track { height: 5px; background: #e9d5ff; border-radius: 999px; overflow: hidden; margin-bottom: 4px; }
        .lvm-profile-fill { height: 100%; background: linear-gradient(90deg,#f06548 0%,#f59e0b 50%,#0ab39c 100%); border-radius: 999px; transition: width .25s ease; }
        .lvm-profile-help { font-size: 11px; color: var(--vz-secondary-color); margin-bottom: 10px; }

        /* Stage banner */
        .lvm-banner {
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 10px;
          padding: 10px 14px;
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 10px;
        }
        [data-bs-theme="dark"] .lvm-banner { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-banner-icon { width: 36px; height: 36px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lvm-banner-icon i { font-size: 18px; }
        .lvm-banner-meta { min-width: 0; flex: 1; }
        .lvm-banner-title { font-size: 14.5px; font-weight: 800; color: #1f2937; margin: 0; letter-spacing: -0.01em; line-height: 1.2; }
        [data-bs-theme="dark"] .lvm-banner-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .lvm-banner-sub { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 1px; }
        .lvm-banner-step { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; flex-shrink: 0; }

        /* Section heading */
        .lvm-section-heading { font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 8px 0; }

        /* Leave type cards */
        .lvm-type-card {
          display: flex; align-items: center; gap: 14px;
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 10px;
          cursor: pointer;
          width: 100%; text-align: left;
          transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
        }
        [data-bs-theme="dark"] .lvm-type-card { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-type-card:hover { border-color: #c4b5fd; box-shadow: 0 4px 14px rgba(124,92,252,0.12); transform: translateY(-1px); }
        .lvm-type-card.is-selected { border-color: #7c5cfc; box-shadow: 0 4px 16px rgba(124,92,252,0.20); background: #faf6ff; }
        [data-bs-theme="dark"] .lvm-type-card.is-selected { background: rgba(124,92,252,0.10); }
        .lvm-type-icon { width: 44px; height: 44px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lvm-type-icon i { font-size: 22px; }
        .lvm-type-meta { flex: 1; min-width: 0; }
        .lvm-type-name { font-size: 15px; font-weight: 800; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .lvm-type-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .lvm-type-desc { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 2px; }
        .lvm-type-balance { text-align: right; min-width: 90px; }
        .lvm-type-days { font-size: 22px; font-weight: 800; line-height: 1; }
        .lvm-type-days-label { font-size: 12px; font-weight: 700; color: var(--vz-secondary-color); margin-left: 3px; }
        .lvm-type-used { font-size: 11px; color: var(--vz-secondary-color); margin-top: 4px; font-weight: 600; }
        .lvm-type-no-limit { font-size: 22px; font-weight: 800; color: #9ca3af; line-height: 1; }

        /* Selected-leave-type info bar (stage 2) */
        .lvm-info-bar {
          background: #f3eeff;
          border: 1px solid #d8c8ff;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12.5px;
          color: var(--vz-body-color);
          margin-bottom: 14px;
        }
        [data-bs-theme="dark"] .lvm-info-bar { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.30); }
        .lvm-info-bar strong { color: #5a3fd1; font-weight: 700; }

        /* Day-type pill toggle (stage 2) */
        .lvm-daytype-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .lvm-daytype-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 16px;
          border-radius: 10px;
          background: #fff;
          border: 1.5px solid #ece9f6;
          font-size: 14px; font-weight: 700;
          color: var(--vz-body-color);
          cursor: pointer;
          transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
        }
        [data-bs-theme="dark"] .lvm-daytype-btn { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-daytype-btn:hover:not(.is-active) { border-color: #c4b5fd; }
        .lvm-daytype-btn.is-active {
          background: linear-gradient(135deg,#5a3fd1,#7c5cfc);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 4px 12px rgba(91,63,209,0.30);
        }
        .lvm-daytype-btn i { font-size: 18px; }

        /* Form controls (date inputs, textarea, etc.) */
        .lvm-field-label { font-size: 11px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 6px; display: block; }
        .lvm-field-label .opt { color: var(--vz-secondary-color); font-weight: 600; letter-spacing: 0.04em; text-transform: none; margin-left: 4px; }
        .lvm-field-input {
          width: 100%;
          padding: 10px 14px;
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 10px;
          font-size: 13px;
          color: var(--vz-body-color);
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .lvm-field-input::placeholder { color: #9ca3af; }
        .lvm-field-input:focus { outline: none; border-color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
        [data-bs-theme="dark"] .lvm-field-input { background: var(--vz-card-bg); border-color: var(--vz-border-color); color: var(--vz-body-color); }
        .lvm-field-textarea { min-height: 86px; resize: vertical; }

        .lvm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .lvm-grid-2 > div { min-width: 0; }

        /* Total leave days card (stage 2) */
        .lvm-total-card {
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 10px;
          padding: 14px 16px;
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 14px;
        }
        [data-bs-theme="dark"] .lvm-total-card { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-total-meta { line-height: 1.3; }
        .lvm-total-title { font-size: 13px; font-weight: 700; color: var(--vz-body-color); }
        .lvm-total-sub { font-size: 11px; color: var(--vz-secondary-color); margin-top: 2px; }
        .lvm-total-num { font-size: 26px; font-weight: 800; color: #c4b5fd; }
        .lvm-total-num.has-value { color: #5a3fd1; }

        /* Reason tip + upload zone (stage 3) */
        .lvm-tip { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 6px; margin-bottom: 18px; }
        .lvm-upload {
          border: 2px dashed #c4b5fd;
          border-radius: 12px;
          background: #faf6ff;
          padding: 30px 20px;
          text-align: center;
          cursor: pointer;
          transition: background .15s ease, border-color .15s ease;
        }
        [data-bs-theme="dark"] .lvm-upload { background: rgba(124,92,252,0.08); border-color: rgba(124,92,252,0.40); }
        .lvm-upload:hover { background: #f3edff; border-color: #7c5cfc; }
        .lvm-upload-icon { width: 56px; height: 56px; border-radius: 12px; background: #fff; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(124,92,252,0.18); margin-bottom: 10px; }
        .lvm-upload-icon i { font-size: 26px; color: #7c5cfc; }
        .lvm-upload-title { font-size: 14px; font-weight: 700; color: #5a3fd1; margin-bottom: 4px; }
        .lvm-upload-sub { font-size: 11.5px; color: var(--vz-secondary-color); }
        .lvm-upload-file { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 10px; background: #fff; border: 1px solid #c4b5fd; border-radius: 6px; font-size: 12px; color: #5a3fd1; font-weight: 700; }

        /* Notify checklist (stage 4) — sits inside .lvm-notify-grid for 2x2 */
        .lvm-notify-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 14px;
        }
        @media (max-width: 991px) {
          .lvm-notify-grid { grid-template-columns: 1fr; }
        }
        .lvm-check-row {
          display: flex; align-items: center; gap: 12px;
          background: #fff;
          border: 1.5px solid #ece9f6;
          border-radius: 10px;
          padding: 12px 14px;
          cursor: pointer;
          transition: border-color .15s ease, background .15s ease;
        }
        [data-bs-theme="dark"] .lvm-check-row { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-check-row:hover { border-color: #c4b5fd; }
        .lvm-check-row.is-checked { background: #f3edff; border-color: #c4b5fd; }
        [data-bs-theme="dark"] .lvm-check-row.is-checked { background: rgba(124,92,252,0.12); }
        .lvm-check-row.is-required { background: #f3edff; border-color: #c4b5fd; }
        .lvm-check-box {
          width: 22px; height: 22px;
          border-radius: 6px;
          border: 1.5px solid #d1d5db;
          background: #fff;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .lvm-check-row.is-checked .lvm-check-box { background: #5a3fd1; border-color: #5a3fd1; color: #fff; }
        .lvm-check-row.is-checked .lvm-check-box i { font-size: 14px; }
        .lvm-check-meta { flex: 1; line-height: 1.3; }
        .lvm-check-title { font-size: 13.5px; font-weight: 700; color: var(--vz-body-color); }
        .lvm-check-desc { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 2px; }
        .lvm-check-required { font-size: 10.5px; font-weight: 800; color: #5a3fd1; letter-spacing: 0.04em; }

        /* Yes/No segmented toggle */
        .lvm-yn { display: inline-flex; gap: 4px; padding: 3px; background: #f3eeff; border-radius: 8px; border: 1px solid #d8c8ff; }
        [data-bs-theme="dark"] .lvm-yn { background: rgba(124,92,252,0.12); border-color: rgba(124,92,252,0.32); }
        .lvm-yn-btn { padding: 6px 18px; border-radius: 6px; font-size: 12px; font-weight: 700; background: transparent; border: none; color: var(--vz-secondary-color); cursor: pointer; transition: background .15s ease, color .15s ease; }
        .lvm-yn-btn.is-active { background: #fff; color: #5a3fd1; box-shadow: 0 2px 4px rgba(91,63,209,0.18); }
        [data-bs-theme="dark"] .lvm-yn-btn.is-active { background: var(--vz-card-bg); color: #c4b5fd; }

        /* Handover sub-card */
        .lvm-subcard {
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 12px;
          padding: 14px 16px;
          margin-top: 14px;
        }
        [data-bs-theme="dark"] .lvm-subcard { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-subcard-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
        .lvm-subcard-title { font-size: 13.5px; font-weight: 700; color: var(--vz-body-color); margin: 0; }
        .lvm-subcard-sub { font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 2px; }

        /* Impact summary card (stage 5 footer) */
        .lvm-impact-card {
          background: #f3eeff;
          border: 1px solid #d8c8ff;
          border-radius: 12px;
          padding: 14px 16px;
          margin-top: 18px;
        }
        [data-bs-theme="dark"] .lvm-impact-card { background: rgba(124,92,252,0.10); border-color: rgba(124,92,252,0.30); }
        .lvm-impact-title { font-size: 11px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: #5a3fd1; margin: 0 0 12px; }
        .lvm-impact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .lvm-impact-cell { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
        [data-bs-theme="dark"] .lvm-impact-cell { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-impact-label { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); }
        .lvm-impact-value { font-size: 14px; font-weight: 700; color: var(--vz-body-color); margin-top: 4px; }
        .lvm-impact-value.empty { color: #9ca3af; }
        .lvm-impact-value.ok { color: #15803d; }

        /* Impact preview (stage 6) — KPI tiles match the project's onb-kpi-card
           pattern: white card + coloured gradient strip + tinted icon tile +
           subtle hover lift. */
        .lvm-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
        .lvm-kpi {
          position: relative;
          background: #fff;
          border: 1px solid var(--vz-border-color);
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.04);
          padding: 12px 14px;
          overflow: hidden;
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 8px;
          transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease;
          cursor: default;
        }
        [data-bs-theme="dark"] .lvm-kpi { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-kpi:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(18,38,63,0.10); border-color: rgba(124,92,252,0.28); }
        .lvm-kpi-strip { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
        .lvm-kpi-text { display: flex; flex-direction: column; min-width: 0; }
        .lvm-kpi-label { font-size: 10px; font-weight: 700; color: var(--vz-secondary-color); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lvm-kpi-num { font-size: 18px; font-weight: 800; color: var(--vz-heading-color, var(--vz-body-color)); margin: 0; line-height: 1; letter-spacing: -0.01em; }
        .lvm-kpi-num.muted { color: #9ca3af; }
        .lvm-kpi-num.green { color: #15803d; }
        .lvm-kpi-icon {
          width: 34px; height: 34px;
          border-radius: 9px;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: transform .25s ease;
        }
        .lvm-kpi:hover .lvm-kpi-icon { transform: scale(1.08); }
        .lvm-kpi-icon i { font-size: 16px; }

        .lvm-breakdown { background: #fff; border: 1px solid #ece9f6; border-radius: 10px; overflow: hidden; }
        [data-bs-theme="dark"] .lvm-breakdown { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-breakdown-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #f1f2f4; font-size: 12.5px; }
        [data-bs-theme="dark"] .lvm-breakdown-row { border-color: var(--vz-border-color); }
        .lvm-breakdown-row:last-child { border-bottom: none; }
        .lvm-breakdown-label { color: var(--vz-secondary-color); font-weight: 600; }
        .lvm-breakdown-value { color: var(--vz-body-color); font-weight: 700; }
        .lvm-breakdown-value.green { color: #15803d; }
        .lvm-breakdown-value.empty { color: #9ca3af; }

        .lvm-note {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1e40af;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 11px;
          margin-top: 10px;
        }

        /* Approval flow (stage 7) */
        .lvm-approver {
          display: flex; align-items: center; gap: 14px;
          background: #fff;
          border: 1px solid #ece9f6;
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 8px;
        }
        [data-bs-theme="dark"] .lvm-approver { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-approver.is-active { border-color: #5eead4; background: #f0fdfa; }
        [data-bs-theme="dark"] .lvm-approver.is-active { background: rgba(20,184,166,0.10); border-color: rgba(20,184,166,0.40); }
        .lvm-approver-num {
          width: 32px; height: 32px; border-radius: 50%;
          background: #f3f4f6; color: #9ca3af;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          font-size: 13px; font-weight: 800;
        }
        .lvm-approver.is-active .lvm-approver-num {
          background: linear-gradient(135deg,#0ab39c,#108548);
          color: #fff;
        }
        .lvm-approver.is-active .lvm-approver-num i { font-size: 18px; }
        .lvm-approver-meta { flex: 1; line-height: 1.3; min-width: 0; }
        .lvm-approver-role { font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); }
        .lvm-approver-name { font-size: 13.5px; font-weight: 700; color: var(--vz-body-color); margin-top: 2px; }
        [data-bs-theme="dark"] .lvm-approver-name { color: var(--vz-heading-color, var(--vz-body-color)); }
        .lvm-approver-eta { font-size: 12px; color: var(--vz-secondary-color); font-weight: 600; }
        .lvm-approver.is-active .lvm-approver-eta { color: #0a716a; font-weight: 700; }
        .lvm-approver-empty {
          background: #fff;
          border: 1px dashed #c4b5fd;
          border-radius: 12px;
          padding: 24px 18px;
          text-align: center;
          margin-bottom: 8px;
        }
        [data-bs-theme="dark"] .lvm-approver-empty { background: var(--vz-card-bg); border-color: rgba(124,92,252,0.40); }
        .lvm-approver-empty i { font-size: 28px; color: #c4b5fd; display: block; margin-bottom: 8px; }
        .lvm-approver-empty-title { font-size: 13px; font-weight: 700; color: var(--vz-body-color); margin-bottom: 4px; }
        .lvm-approver-empty-sub { font-size: 11.5px; color: var(--vz-secondary-color); max-width: 460px; margin: 0 auto; }
        .lvm-submit-banner {
          background: #fef9c3;
          border: 1px solid #fde68a;
          color: #92400e;
          border-radius: 10px;
          padding: 12px 16px;
          font-size: 12.5px; font-weight: 700;
          margin-top: 14px;
        }
        .lvm-submit-banner strong { color: #78350f; }

        /* Footer */
        .lvm-footer {
          background: #fff;
          border-top: 1px solid #ece9f6;
          padding: 10px 18px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; flex-wrap: wrap;
        }
        [data-bs-theme="dark"] .lvm-footer { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .lvm-footer-meta { font-size: 11.5px; color: var(--vz-secondary-color); font-weight: 600; }
        .lvm-btn-prev, .lvm-btn-draft, .lvm-btn-next {
          padding: 7px 14px;
          border-radius: 8px;
          font-size: 12.5px; font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          display: inline-flex; align-items: center; gap: 5px;
          transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .lvm-btn-prev { background: #fff; color: var(--vz-secondary-color); border-color: #e5e7eb; }
        .lvm-btn-prev:hover:not(:disabled) { background: #f3f4f6; color: var(--vz-body-color); }
        .lvm-btn-prev:disabled { opacity: 0.5; cursor: not-allowed; }
        .lvm-btn-draft { background: #fff; color: var(--vz-body-color); border-color: var(--vz-border-color); }
        .lvm-btn-draft:hover { background: var(--vz-light); }
        .lvm-btn-next {
          background: linear-gradient(135deg,#5a3fd1,#7c5cfc);
          color: #fff; border: none;
          box-shadow: 0 6px 14px rgba(91,63,209,0.28);
        }
        .lvm-btn-next:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(91,63,209,0.36); }
        [data-bs-theme="dark"] .lvm-btn-prev { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.78); border-color: rgba(255,255,255,0.10); }
        [data-bs-theme="dark"] .lvm-btn-draft { background: var(--vz-card-bg); color: var(--vz-body-color); border-color: var(--vz-border-color); }

        @media (max-width: 991px) {
          .lvm-body { flex-direction: column; min-height: 0; }
          .lvm-side { width: 100%; border-right: 0; border-bottom: 1px solid #ece9f6; }
          .lvm-grid-2, .lvm-impact-grid { grid-template-columns: 1fr; }
          .lvm-kpi-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {/* Header */}
      <div className="lvm-header">
        <div className="lvm-header-left">
          <span className="lvm-avatar" style={{ background: accent }}>{initials}</span>
          <div className="min-w-0">
            <div className="lvm-emp-row">
              <h5 className="lvm-emp-name">{name}</h5>
              <span className="lvm-badge">Draft</span>
              <span className="lvm-badge lvm-badge-pct">Profile: {profilePct}% complete</span>
            </div>
            <div className="lvm-emp-sub">{employeeId} · {department} · {designation}</div>
          </div>
        </div>
        <div className="lvm-header-right">
          <span className="lvm-flow-label">Leave Application Flow</span>
          <button type="button" className="lvm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="lvm-body">

        {/* Sidebar */}
        <div className="lvm-side">
          <p className="lvm-side-title">Leave Stages</p>
          {LEAVE_STAGES.map(s => {
            const isActive = s.num === stage;
            const isDone = s.num < stage;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStage(s.num)}
                className={`lvm-stage${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
              >
                <span className="lvm-stage-num">{isDone ? <i className="ri-check-line" /> : s.num}</span>
                <div className="lvm-stage-meta">
                  <p className="lvm-stage-name">{s.title}</p>
                  <span className="lvm-stage-status">
                    <span className="dot" />
                    {isActive ? 'In Progress' : isDone ? 'Complete' : 'Pending'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main */}
        <div className="lvm-main">

          {/* Profile completion bar */}
          <div className="lvm-profile-row">
            <span className="lvm-profile-label">Profile Completion</span>
            <span className="lvm-profile-pct">{profilePct}%</span>
          </div>
          <div className="lvm-profile-track">
            <div className="lvm-profile-fill" style={{ width: `${profilePct}%` }} />
          </div>
          <div className="lvm-profile-help">
            {profilePct}% complete · Required fields (marked red) must be filled before proceeding
          </div>

          {/* Stage banner */}
          <div className="lvm-banner">
            <span className="lvm-banner-icon" style={{ background: currentStage.iconBg }}>
              <i className={currentStage.icon} style={{ color: '#a4661c' }} />
            </span>
            <div className="lvm-banner-meta">
              <h6 className="lvm-banner-title">{currentStage.title}</h6>
              <div className="lvm-banner-sub">{stageSubtitleFor(stage)}</div>
            </div>
            <span className="lvm-banner-step">STEP {stage} OF {totalStages}</span>
          </div>

          {/* ── Stage 1: Leave Type ── */}
          {stage === 1 && (
            <>
              <p className="lvm-section-heading">Select Leave Type</p>
              {LEAVE_TYPES.map(lt => {
                const selected = leaveType === lt.id;
                return (
                  <button
                    key={lt.id}
                    type="button"
                    onClick={() => setLeaveType(lt.id)}
                    className={`lvm-type-card${selected ? ' is-selected' : ''}`}
                  >
                    <span className="lvm-type-icon" style={{ background: lt.iconBg }}>
                      <i className={lt.icon} style={{ color: lt.iconFg }} />
                    </span>
                    <div className="lvm-type-meta">
                      <h6 className="lvm-type-name">{lt.name}</h6>
                      <div className="lvm-type-desc">{lt.desc}</div>
                    </div>
                    <div className="lvm-type-balance">
                      {lt.noLimit ? (
                        <>
                          <div className="lvm-type-no-limit">—</div>
                          <div className="lvm-type-used">No limit</div>
                        </>
                      ) : (
                        <>
                          <div>
                            <span className="lvm-type-days" style={{ color: lt.days == null ? '#9ca3af' : lt.daysColor }}>
                              {lt.days ?? '—'}
                            </span>
                            <span className="lvm-type-days-label">days</span>
                          </div>
                          <div className="lvm-type-used">
                            {lt.used == null || lt.total == null ? 'Balance unavailable' : `${lt.used} used / ${lt.total} total`}
                          </div>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* ── Stage 2: Leave Duration ── */}
          {stage === 2 && (
            <>
              <div className="lvm-info-bar">
                Selected leave type: <strong>{selectedLeaveType ? selectedLeaveType.name : '(none selected)'}</strong>
              </div>

              <label className="lvm-field-label">Day Type</label>
              <div className="lvm-daytype-row">
                <button
                  type="button"
                  onClick={() => setDayType('full')}
                  className={`lvm-daytype-btn${dayType === 'full' ? ' is-active' : ''}`}
                >
                  <i className="ri-sun-line" /> Full Day
                </button>
                <button
                  type="button"
                  onClick={() => setDayType('half')}
                  className={`lvm-daytype-btn${dayType === 'half' ? ' is-active' : ''}`}
                >
                  <i className="ri-contrast-2-line" /> Half Day
                </button>
              </div>

              <div className="lvm-grid-2">
                <div>
                  <label className="lvm-field-label">From Date</label>
                  <input
                    type="date"
                    className="lvm-field-input"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    placeholder="mm/dd/yyyy"
                  />
                </div>
                <div>
                  <label className="lvm-field-label">To Date</label>
                  <input
                    type="date"
                    className="lvm-field-input"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    placeholder="mm/dd/yyyy"
                    min={fromDate || undefined}
                  />
                </div>
              </div>

              <div className="lvm-total-card">
                <div className="lvm-total-meta">
                  <div className="lvm-total-title">Total Leave Days</div>
                  <div className="lvm-total-sub">Includes weekends if selected</div>
                </div>
                <div className={`lvm-total-num${totalDays > 0 ? ' has-value' : ''}`}>{totalDays || 0}</div>
              </div>
            </>
          )}

          {/* ── Stage 3: Reason & Document — split 2-column so the reason
                textarea and the upload zone read as a balanced pair. ── */}
          {stage === 3 && (
            <div className="lvm-grid-2">
              <div>
                <label className="lvm-field-label">Reason for Leave</label>
                <textarea
                  className="lvm-field-input lvm-field-textarea"
                  placeholder="e.g. Family function, medical appointment, vacation…"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  style={{ minHeight: 160 }}
                />
                <div className="lvm-tip" style={{ marginBottom: 0 }}>Tip: Detailed reasons help managers approve faster.</div>
              </div>
              <div>
                <label className="lvm-field-label">
                  Supporting Document <span className="opt">(Optional)</span>
                </label>
                <label
                  className="lvm-upload"
                  style={{ minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setDocName(f.name);
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    ref={el => { fileInputRef.current = el; }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) setDocName(f.name);
                    }}
                  />
                  <div className="lvm-upload-icon"><i className="ri-upload-2-line" /></div>
                  <div className="lvm-upload-title">Click to upload medical certificate / supporting doc</div>
                  <div className="lvm-upload-sub">PDF, JPG, PNG · Max 5 MB</div>
                  {docName && (
                    <div className="lvm-upload-file">
                      <i className="ri-file-line" /> {docName}
                    </div>
                  )}
                </label>
              </div>
            </div>
          )}

          {/* ── Stage 4: Notify & Handover — notify rows in a 2-column grid
                so the four options sit as a 2×2 instead of a tall stack. ── */}
          {stage === 4 && (
            <>
              <p className="lvm-section-heading">Who needs to be informed</p>
              <div className="lvm-notify-grid">
                {NOTIFY_ROWS.map(row => {
                  const checked = notify[row.key];
                  const reqClass = row.required ? ' is-required' : '';
                  return (
                    <div
                      key={row.key}
                      className={`lvm-check-row${checked ? ' is-checked' : ''}${reqClass}`}
                      onClick={() => {
                        if (row.required) return;
                        setNotify({ ...notify, [row.key]: !checked });
                      }}
                    >
                      <span className="lvm-check-box">
                        {checked && <i className="ri-check-line" />}
                      </span>
                      <div className="lvm-check-meta">
                        <div className="lvm-check-title">{row.title}</div>
                        <div className="lvm-check-desc">{row.desc}</div>
                      </div>
                      {row.required && <span className="lvm-check-required">Required</span>}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 14 }}>
                <label className="lvm-field-label">Inform Specific Employees</label>
                <input
                  type="text"
                  className="lvm-field-input"
                  placeholder="Type name & press Enter…"
                  value={specificEmps}
                  onChange={e => setSpecificEmps(e.target.value)}
                />
                <div className="lvm-tip" style={{ marginBottom: 0 }}>These people will be notified that the employee is on leave</div>
              </div>

              <div className="lvm-subcard">
                <div className="lvm-subcard-head">
                  <div>
                    <h6 className="lvm-subcard-title">Task Handover Required?</h6>
                    <div className="lvm-subcard-sub">Is someone covering your work during leave?</div>
                  </div>
                  <div className="lvm-yn">
                    <button type="button" className={`lvm-yn-btn${handoverReq ? ' is-active' : ''}`} onClick={() => setHandoverReq(true)}>Yes</button>
                    <button type="button" className={`lvm-yn-btn${!handoverReq ? ' is-active' : ''}`} onClick={() => setHandoverReq(false)}>No</button>
                  </div>
                </div>
                {handoverReq && (
                  <>
                    <div className="lvm-grid-2">
                      <div>
                        <label className="lvm-field-label">Coverage Person</label>
                        <input
                          type="text"
                          className="lvm-field-input"
                          placeholder="Who will handle your work?"
                          value={coverPerson}
                          onChange={e => setCoverPerson(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="lvm-field-label">Handover Notes</label>
                        <input
                          type="text"
                          className="lvm-field-input"
                          placeholder="Key notes for handover…"
                          value={handoverNotes}
                          onChange={e => setHandoverNotes(e.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <label className="lvm-field-label">Critical Tasks / Open Items</label>
                      <textarea
                        className="lvm-field-input lvm-field-textarea"
                        placeholder="List any pending critical tasks…"
                        value={criticalTasks}
                        onChange={e => setCriticalTasks(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Stage 5: Availability ── */}
          {stage === 5 && (
            <>
              <p className="lvm-section-heading">Contact Availability During Leave</p>

              <div className="lvm-subcard" style={{ marginTop: 0 }}>
                <div className="lvm-subcard-head" style={{ marginBottom: 0 }}>
                  <div>
                    <h6 className="lvm-subcard-title">Available on Call?</h6>
                    <div className="lvm-subcard-sub">Can you be reached in an emergency?</div>
                  </div>
                  <div className="lvm-yn">
                    <button type="button" className={`lvm-yn-btn${availOnCall ? ' is-active' : ''}`} onClick={() => setAvailOnCall(true)}>Yes</button>
                    <button type="button" className={`lvm-yn-btn${!availOnCall ? ' is-active' : ''}`} onClick={() => setAvailOnCall(false)}>No</button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label className="lvm-field-label">Emergency Contact Number</label>
                <input
                  type="tel"
                  className="lvm-field-input"
                  placeholder="Mobile number reachable during leave…"
                  value={emergencyNumber}
                  onChange={e => setEmergencyNumber(e.target.value)}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <label className="lvm-field-label">Availability Note</label>
                <input
                  type="text"
                  className="lvm-field-input"
                  placeholder="e.g. Reachable on WhatsApp after 6PM…"
                  value={availNote}
                  onChange={e => setAvailNote(e.target.value)}
                />
              </div>

              <div className="lvm-impact-card">
                <p className="lvm-impact-title">Leave Impact Summary</p>
                <div className="lvm-impact-grid">
                  <div className="lvm-impact-cell">
                    <div className="lvm-impact-label">Requested Days</div>
                    <div className={`lvm-impact-value${totalDays === 0 ? ' empty' : ''}`}>{totalDays || '—'}</div>
                  </div>
                  <div className="lvm-impact-cell">
                    <div className="lvm-impact-label">Balance Available</div>
                    <div className={`lvm-impact-value${selectedLeaveType?.days == null ? ' empty' : ''}`}>{selectedLeaveType?.days ?? '—'}</div>
                  </div>
                  <div className="lvm-impact-cell">
                    <div className="lvm-impact-label">Proof Required</div>
                    <div className="lvm-impact-value empty">—</div>
                  </div>
                  <div className="lvm-impact-cell">
                    <div className="lvm-impact-label">Approval Flow</div>
                    <div className="lvm-impact-value empty">—</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Stage 6: Impact Preview ── */}
          {stage === 6 && (
            <>
              <div className="lvm-kpi-grid">
                {[
                  { label: 'Total Days',    value: `${totalDays || 0} days`, muted: totalDays === 0,           icon: 'ri-calendar-2-line',         strip: 'linear-gradient(90deg,#3b82f6,#60a5fa)', tint: '#dbeafe', fg: '#1d4ed8' },
                  { label: 'Paid Leave',    value: `${totalDays || 0} days`, muted: totalDays === 0,           icon: 'ri-secure-payment-line',     strip: 'linear-gradient(90deg,#0ab39c,#34d399)', tint: '#dcfce7', fg: '#15803d' },
                  { label: 'Unpaid Leave',  value: '0 days',                  muted: true,                      icon: 'ri-file-list-3-line',        strip: 'linear-gradient(90deg,#9ca3af,#d1d5db)', tint: '#f3f4f6', fg: '#6b7280' },
                  { label: 'Est. Deduction',value: 'Nil',                     muted: false, green: true,        icon: 'ri-money-rupee-circle-line', strip: 'linear-gradient(90deg,#f59e0b,#fbcc77)', tint: '#fde8c4', fg: '#a4661c' },
                ].map(k => (
                  <div key={k.label} className="lvm-kpi">
                    <div className="lvm-kpi-strip" style={{ background: k.strip }} />
                    <div className="lvm-kpi-text">
                      <span className="lvm-kpi-label">{k.label}</span>
                      <span className={`lvm-kpi-num${k.muted ? ' muted' : ''}${k.green ? ' green' : ''}`}>{k.value}</span>
                    </div>
                    <span className="lvm-kpi-icon" style={{ background: k.tint }}>
                      <i className={k.icon} style={{ color: k.fg }} />
                    </span>
                  </div>
                ))}
              </div>

              <p className="lvm-section-heading">Leave Breakdown</p>
              <div className="lvm-breakdown">
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Leave Type</span>
                  <span className={`lvm-breakdown-value${!selectedLeaveType ? ' empty' : ''}`}>{selectedLeaveType?.name || '—'}</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Duration</span>
                  <span className={`lvm-breakdown-value${!fromDate || !toDate ? ' empty' : ''}`}>{fromDate && toDate ? `${fromDate} – ${toDate}` : '— – —'}</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Working Days</span>
                  <span className="lvm-breakdown-value">{totalDays || 0} days</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Paid Days</span>
                  <span className="lvm-breakdown-value">{totalDays || 0} days</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Unpaid Days</span>
                  <span className="lvm-breakdown-value">0 days</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Salary Deduction</span>
                  <span className="lvm-breakdown-value green">Nil</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Attendance Flag</span>
                  <span className={`lvm-breakdown-value${!selectedLeaveType ? ' empty' : ''}`}>{selectedLeaveType?.name || '—'}</span>
                </div>
                <div className="lvm-breakdown-row">
                  <span className="lvm-breakdown-label">Payroll Layer</span>
                  <span className="lvm-breakdown-value green">No impact</span>
                </div>
              </div>

              <div className="lvm-note">
                Attendance will be marked as leave on the From / To range, and any biometric punches inside it will be ignored.
              </div>
            </>
          )}

          {/* ── Stage 7: Approval Flow — approver chain comes from the
                backend; we only know the maker (current employee) for now. ── */}
          {stage === 7 && (
            <>
              <p className="lvm-section-heading">Approval Chain</p>

              <div className="lvm-approver is-active">
                <span className="lvm-approver-num"><i className="ri-check-line" /></span>
                <div className="lvm-approver-meta">
                  <div className="lvm-approver-role">Maker (You)</div>
                  <div className="lvm-approver-name">{name}</div>
                </div>
                <div className="lvm-approver-eta">Today</div>
              </div>

              <div className="lvm-approver-empty">
                <i className="ri-team-line" />
                <div className="lvm-approver-empty-title">Approval chain not configured yet</div>
                <div className="lvm-approver-empty-sub">
                  Approvers (Checker / Approver / HR Notification) will load here once the leave-policy backend is wired up.
                </div>
              </div>

              <div className="lvm-submit-banner">
                <strong>Ready to submit?</strong> Click "Submit Application" below to send for approval.
              </div>
            </>
          )}

        </div>
      </div>

      {/* Footer */}
      <div className="lvm-footer">
        <span className="lvm-footer-meta">Stage {stage} of {totalStages}</span>
        <div className="d-flex gap-2 ms-auto">
          <button
            type="button"
            className="lvm-btn-prev"
            onClick={() => setStage(Math.max(1, stage - 1))}
            disabled={stage === 1}
          >
            <i className="ri-arrow-left-s-line" /> Previous
          </button>
          <button type="button" className="lvm-btn-draft">
            <i className="ri-save-line" /> Save Draft
          </button>
          {stage < totalStages ? (
            <button type="button" className="lvm-btn-next" onClick={() => setStage(stage + 1)}>
              Next Stage <i className="ri-arrow-right-s-line" />
            </button>
          ) : (
            <button type="button" className="lvm-btn-next" onClick={onClose}>
              Submit Application <i className="ri-check-line" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Stage subtitle copy — refined per stage to match the design mock more closely
// than the original sidebar copy.
function stageSubtitleFor(stage: number): string {
  switch (stage) {
    case 1: return 'Select leave category & check available balance';
    case 2: return 'Choose start and end dates';
    case 3: return 'Explain reason; upload supporting docs if needed';
    case 4: return 'Set handover person & notify stakeholders';
    case 5: return 'Check team availability for your dates';
    case 6: return 'Review leave-balance & payroll impact';
    case 7: return 'Confirm approver chain & submit';
    default: return '';
  }
}

