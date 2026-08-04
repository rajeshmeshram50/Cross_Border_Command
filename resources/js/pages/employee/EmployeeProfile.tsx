import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Col, Row } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import SalaryStructureModal, { type SalaryEmployeeLite } from '../../components/SalaryStructureModal';
import PayslipViewerModal from '../../components/PayslipViewerModal';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { draftFilesKey, saveDraftFiles, loadDraftFiles, deleteDraftFiles } from '../../utils/draftFileStore';
import { type AdvanceRequestRow } from '../../components/AdvanceRequestsTable';
import FaceRegistrationModal from '../../components/FaceRegistrationModal';
import {
  RaiseHiringRequestModal,
  HiringRequestsListModal,
  ViewHiringRequestModal,
  apiToHiringRequestRow,
  type HiringRequestRow,
} from '../recruitment/HrRecruitment';
import './EmployeeProfile.css';
import ImageCropperModal from '../../components/ui/ImageCropperModal';
import { Shimmer } from '../../components/ui/Shimmer';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { leaveTypesApi, leaveRequestsApi, ApiLeaveRequest } from '../hrms/leavePlansApi';
import LeaveSummaryPanel from './LeaveSummaryPanel';
import HolidayCalendarPanel from './HolidayCalendarPanel';
import { EpModal } from './EmployeeProfileShared';
import { EmployeeProfileProvider, type EmployeeProfileCtx } from './EmployeeProfileContext';
import AttendanceTab from './tabs/AttendanceTab';
import ProfileTab from './tabs/ProfileTab';
import JobTab from './tabs/JobTab';
import VaultTab from './tabs/VaultTab';
import PayrollTab from './tabs/PayrollTab';
import ExpenseTab from './tabs/ExpenseTab';
import HiringTab from './tabs/HiringTab';

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const UPLOAD_ALLOWED_EXT = /\.(pdf|jpe?g|png)$/i;
function filterValidUploads(picked: File[]): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const f of picked) {
    // Some browsers leave File.type empty (e.g. drag-drop on Windows), so
    // fall back to the extension when the MIME type isn't conclusive.
    const typeOk = UPLOAD_ALLOWED_MIME.includes(f.type) || UPLOAD_ALLOWED_EXT.test(f.name);
    if (!typeOk) { errors.push(`${f.name}: unsupported format (only PDF, JPG, PNG)`); continue; }
    if (f.size > UPLOAD_MAX_BYTES) { errors.push(`${f.name}: larger than 5 MB`); continue; }
    accepted.push(f);
  }
  return { accepted, errors };
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
  /** Multi-role array — populated by HrEmployees' apiToUiRow from the
   *  server-side `ancillary_roles_resolved` accessor. Preferred over the
   *  legacy single `ancillaryRole`. */
  ancillaryRoles?: string[];
  manager?: string;
  /** Passport-size photo URL — populated by ProfileRouter and HrEmployees
   *  apiToUiRow. The hero avatar (and a couple of fallback render sites)
   *  read it. */
  photoUrl?: string | null;
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
type TabKey = 'profile' | 'job' | 'attendance' | 'vault' | 'payroll' | 'expense' | 'apply_leave' | 'holidays' | 'hiring';

/** Coerce a value that may be a plain string OR a relation object
 *  (e.g. department `{id, name, code}`) down to a renderable string.
 *  Guards against "Objects are not valid as a React child" when a caller
 *  passes the raw API row instead of a flattened name. */
const asName = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as any).name ?? (v as any).title ?? '') : (v == null ? '' : String(v));
type PayrollTab = 'summary' | 'details';
type VaultTab = 'employee' | 'organizational';
type ExpenseFilter = 'all' | 'approved' | 'rejected' | 'pending' | 'draft';
export default function EmployeeProfile({ employeeId, employee, onBack }: Props) {
  const initials = employee?.initials
    || (employee?.name ? employee.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : 'EM');
  const accent = employee?.accent || '#7c5cfc';

  // A disabled employee must read "Inactive" here regardless of the raw
  // `status` field — fixing the mismatch where the list showed "Disabled" but
  // the profile, going by status alone, still showed "Active". This must work
  // for BOTH entry paths:
  //   • navigated from the list → carries the computed `enabled` flag
  //   • deep-link / refresh → carries the raw backend record (no `enabled`,
  //     and status may be 'terminated'/'resigned' or it may be soft-deleted).
  // So we treat any of those signals as disabled (mirrors HrEmployees
  // apiToUiRow's `enabled` derivation).
  const rawStatus = String((employee as any)?.status ?? '').toLowerCase();
  const isDisabled =
    employee?.enabled === false
    || (employee as any)?.deleted_at != null
    || ['inactive', 'terminated', 'resigned'].includes(rawStatus);

  const statusTone =
      isDisabled                            ? { bg: 'rgba(255,255,255,0.18)', dot: '#94a3b8', label: 'Inactive' }
    : employee?.status === 'active'         ? { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: 'Active' }
    : employee?.status === 'on_leave'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#f59e0b', label: 'On Leave' }
    : employee?.status === 'high_attention' ? { bg: 'rgba(255,255,255,0.18)', dot: '#ef4444', label: 'High Attention' }
    : employee?.status === 'probation'      ? { bg: 'rgba(255,255,255,0.18)', dot: '#3b82f6', label: 'Probation' }
    : employee?.status === 'inactive'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#94a3b8', label: 'Inactive' }
    :                                          { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: 'Active' };

  const [tab, setTab] = useState<TabKey>('profile');
  const [payrollTab, setPayrollTab] = useState<PayrollTab>('summary');
  const [vaultTab, setVaultTab] = useState<VaultTab>('employee');
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilter>('all');
  // Free-text search over the Expense / Advance tables. Applied on top of the
  // status filter so the table, the "Showing N" counter and Export all narrow
  // to matching rows. Empty = no narrowing.
  const [expenseSearch, setExpenseSearch] = useState('');

  // ── Manager detection — the "Hiring Requests" tab is gated to people
  //   who actually manage someone (i.e. someone else's reporting_manager
  //   points at them). Fetched once via /my-team/employees so the gate
  //   is independent of whether the team has filed any expense claims /
  //   advances yet.
  const [isManager, setIsManager] = useState<boolean>(false);
  const [teamSize, setTeamSize] = useState<number>(0);
  // Hiring Requests state — filled only when the manager opens the tab
  // (lazy fetch). The list+raise modals reuse the existing HrRecruitment
  // components so we don't duplicate the form / KPI rendering logic.
  const [hiringRequests, setHiringRequests] = useState<HiringRequestRow[]>([]);
  const [hiringLoading, setHiringLoading] = useState<boolean>(false);
  const [raiseHiringOpen, setRaiseHiringOpen] = useState<boolean>(false);
  // When set, the Raise modal opens in EDIT mode to resume a saved Draft.
  const [hiringEditing, setHiringEditing] = useState<any | null>(null);
  // When set, opens the read-only View modal for a single hiring request.
  const [hiringViewing, setHiringViewing] = useState<any | null>(null);
  const [listHiringOpen, setListHiringOpen] = useState<boolean>(false);
  const [hiringRefreshKey, setHiringRefreshKey] = useState<number>(0);

  // Full employee record from /employees/{id} — drives the Personal /
  // Contact / Address sections so every field reflects what the admin
  // actually saved (was previously hardcoded with sample data).
  const [empDetail, setEmpDetail] = useState<any>(null);
  // Drives the shimmer placeholders shown across the Profile / Job tabs
  // while the /employees/{id} fetch is in flight. Without this every
  // field rendered "—" for the first 200-500ms which looked broken.
  const [empDetailLoading, setEmpDetailLoading] = useState(true);

  // Ancillary roles for the header + Job tab. Prefer the freshly-fetched
  // empDetail.ancillary_roles_resolved (the full multi-role list from the
  // ancillary_role_ids JSON column) — the navigation-state `employee` row
  // often only carries the single legacy ancillaryRole, which is why the
  // profile showed just one role while the edit form showed all of them.
  const ancillaryList: string[] = Array.isArray(empDetail?.ancillary_roles_resolved) && empDetail.ancillary_roles_resolved.length > 0
    ? empDetail.ancillary_roles_resolved.map((r: any) => r?.name ?? '').filter(Boolean)
    : Array.isArray(employee?.ancillaryRoles) && employee.ancillaryRoles.length > 0
      ? employee.ancillaryRoles.filter(Boolean)
      : Array.isArray(employee?.ancillaryRole)
        ? (employee?.ancillaryRole as string[]).filter(Boolean)
        : (employee?.ancillaryRole ? [employee.ancillaryRole as string] : []);

  // The "Employee ID" shown under the name must be the emp_code (EMP-017),
  // never the raw numeric DB id. The route slug (`employeeId`) and the list's
  // `employee.id` can be either, so prefer the resolved emp_code and fall back
  // to any value that isn't purely numeric — otherwise show a dash.
  const displayEmpCode = (() => {
    const isCode = (v: unknown) => !!v && !/^\d+$/.test(String(v));
    return empDetail?.emp_code
      || (isCode(employee?.id) ? String(employee?.id) : '')
      || (isCode(employeeId)   ? String(employeeId)   : '')
      || '—';
  })();
  useEffect(() => {
    let cancelled = false;
    const ident = String(employeeId || '').trim();
    if (!ident) { setEmpDetailLoading(false); return; }
    // Fetch the full record DIRECTLY by the URL identifier. The backend's
    // resolveIdParam accepts an encrypted id, a numeric id, or an EMP-###
    // code, and show() lets an employee read their OWN record without the
    // master.employees grant. The old two-step (GET /employees?search=… then
    // /employees/{id}) routed through the permission-gated index, so an
    // ordinary employee (no module grant) got a 403 there — empDetail never
    // loaded, the Payment card showed dashes and the bank-details Edit modal
    // had nothing to prefill and no id to save (#35 reopen).
    setEmpDetailLoading(true);
    (async () => {
      try {
        const r = await api.get(`/employees/${encodeURIComponent(ident)}`);
        if (!cancelled) setEmpDetail(r.data?.employee || r.data || null);
      } catch {
        // Non-fatal — the page still renders the props-passed lightweight row.
      } finally {
        if (!cancelled) setEmpDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);

  // Real salary structure (Payroll tab) — the employee's active structure, so
  // the compensation card / Revise Salary reflect actual payroll data, not the
  // sample numbers this tab used to hardcode.
  const [salaryStruct, setSalaryStruct] = useState<any>(null);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const reloadSalaryStruct = () => {
    const empId = empDetail?.id;
    if (!empId) return;
    api.get('/salary-structures', { params: { employee_id: empId, active_only: 1 } })
      .then(res => setSalaryStruct((Array.isArray(res.data?.data) ? res.data.data : [])[0] ?? null))
      .catch(() => setSalaryStruct(null));
  };
  useEffect(() => { if (empDetail?.id) reloadSalaryStruct(); /* eslint-disable-next-line */ }, [empDetail?.id]);

  // Real compensation derived from the structure (falls back to the employee's
  // annual_salary, then to 0). Drives the Current Compensation card.
  const realMonthlyGross = salaryStruct ? Number(salaryStruct.monthly_gross) || 0
    : (empDetail?.annual_salary ? Math.round(Number(empDetail.annual_salary) / 12) : 0);
  const realAnnualCtc = salaryStruct ? Math.round((Number(salaryStruct.monthly_gross) || 0) * 12)
    : (empDetail?.annual_salary ? Math.round(Number(empDetail.annual_salary)) : 0);
  const fmtRupee = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

  // Lightweight employee shape for the shared SalaryStructureModal.
  const salaryEmpLite: SalaryEmployeeLite | null = empDetail?.id ? {
    employee_id: empDetail.id,
    name: empDetail.display_name || `${empDetail.first_name ?? ''} ${empDetail.last_name ?? ''}`.trim() || (employee?.name || ''),
    emp_code: empDetail.emp_code,
    pf_eligible: !!empDetail.pf_eligible,
    annual_salary: empDetail.annual_salary != null ? Number(empDetail.annual_salary) : null,
    has_structure: !!salaryStruct,
    structure_id: salaryStruct?.id ?? null,
    monthly_gross: realMonthlyGross,
  } : null;

  // ── Real payslip history + salary versions (Payroll tab) ──────────────
  const MONTH_ABBR_FULL: Record<string, string> = {
    Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
    Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
  };
  const [payslipHistory, setPayslipHistory] = useState<any[]>([]);
  const [salaryVersions, setSalaryVersions] = useState<any[]>([]);
  const [viewSlip, setViewSlip] = useState<any>(null);
  useEffect(() => {
    const empId = empDetail?.id;
    if (!empId) return;
    api.get(`/payroll/employee/${empId}/payslips`)
      .then(res => setPayslipHistory(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setPayslipHistory([]));
    api.get('/salary-structures', { params: { employee_id: empId } })
      .then(res => setSalaryVersions(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setSalaryVersions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empDetail?.id]);

  // Load a payslip's full breakup into the shared viewer.
  const loadSlip = (payslipId?: number, label?: string) => {
    if (!payslipId) return;
    api.get(`/payroll/payslip/${payslipId}`)
      .then(res => {
        const d = res.data?.data ?? {};
        const [mAbbr, y] = String(label || '').split(' ');
        setViewSlip({
          id: payslipId,
          earnings: (d.earningsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 })),
          deductions: (d.deductionsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 })),
          isFinal: d.is_final,
          company: d.company,
          month: MONTH_ABBR_FULL[mAbbr] || mAbbr || 'March',
          year: y || String(new Date().getFullYear()),
          working: d.totalMonthDays ?? d.workingDays, present: d.present, paid: d.paidDays, lop: d.lopDays,
        });
      })
      .catch(() => { /* keep prior */ });
  };
  const openLatestPayslip = () => {
    if (!payslipHistory.length) { toast.error('No payslip yet', 'No payroll has been processed for this employee.'); return; }
    const latest = payslipHistory[0];
    loadSlip(latest.payslip_id, latest.label);
    setPaySlipOpen(true);
  };

  // Real salary revision timeline from the structure versions (latest first).
  const realTimeline = salaryVersions.map((v: any) => {
    const d = v.effective_from ? new Date(v.effective_from) : null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateShort = d && !isNaN(d.getTime())
      ? `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`
      : '—';
    return {
      id: String(v.id),
      current: v.status === 'active',
      dateShort,
      annual: Math.round((Number(v.monthly_gross) || 0) * 12),
      version: v.version,
      note: v.revision_note,
    };
  });

  // Helper — formats a date string like "1985-11-02" → "02-Nov-1985".
  const fmtDate = (raw: any): string => {
    if (!raw) return '—';
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  };

  // ── Signed Documents — final, fully-signed copies for this employee.
  // Fetched once when the Vault tab is opened. The route accepts either
  // the numeric employee id or the EMP-### code (the slug the profile
  // already has), so no extra resolve hop is required.
  type SignedDoc = {
    id: number;
    code: string | null;
    status: string;
    template?: { id: number; code: string; name: string; doc_type: string | null } | null;
    content_html: string | null;
    header_config: any;
    footer_config: any;
    signers: Array<{ name: string; role_name: string; action: string; status: string; acted_at: string | null }>;
    updated_at: string;
  };
  const [signedDocs, setSignedDocs] = useState<SignedDoc[]>([]);
  const [signedLoading, setSignedLoading] = useState(false);
  const [signedPreview, setSignedPreview] = useState<SignedDoc | null>(null);
  // Tracks which signed doc is currently being fetched so the Download PDF
  // button (both in the vault table and the preview modal) can show a loader.
  const [downloadingDocId, setDownloadingDocId] = useState<number | null>(null);

  // ── Uploaded employee documents — the rows the employee actually
  // uploaded through onboarding (Aadhaar/PAN/photo/etc.) plus anything HR
  // staff attached later. Drives the Employee Documents subtab below.
  type UploadedDoc = {
    id: number;
    document_key: string;
    status: 'uploaded' | 'verified' | 'rejected';
    original_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_at: string | null;
    verified_at: string | null;
    rejection_reason: string | null;
    uploader: { id: number; name: string } | null;
    verifier: { id: number; name: string } | null;
    url: string | null;
  };
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [uploadedLoading, setUploadedLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'vault' || !employeeId) return;
    let cancelled = false;
    (async () => {
      try {
        setSignedLoading(true);
        const { data } = await api.get(`/employees/${encodeURIComponent(employeeId)}/signed-documents`);
        if (!cancelled) setSignedDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSignedDocs([]);
      } finally {
        if (!cancelled) setSignedLoading(false);
      }

      // Uploaded employee documents — backend route binds {employee} to
      // a numeric id, so we resolve the slug first via the same helper
      // used for profile-photo uploads.
      try {
        setUploadedLoading(true);
        const empId = await resolveEmployeeUploadId();
        if (cancelled) return;
        const { data } = await api.get(`/employees/${encodeURIComponent(String(empId))}/documents`);
        if (!cancelled) setUploadedDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setUploadedDocs([]);
      } finally {
        if (!cancelled) setUploadedLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, employeeId]);

  // Pretty-print a document_key like `aadhaar` → "Aadhaar", `prev_3_relieving` → "Prev 3 Relieving"
  const prettyDocKey = (key: string): string =>
    key.split(/[_\-\s]+/).filter(Boolean)
       .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
       .join(' ');

  const formatBytes = (b: number | null): string => {
    if (!b || b <= 0) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const downloadSignedPdf = async (docId: number, code: string | null) => {
    setDownloadingDocId(docId);
    try {
      const resp = await api.get(`/hr-document-signatures/${docId}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code || `doc-${docId}`}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Your signed PDF has been saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDownloadingDocId(null);
    }
  };

  // ── Change-password modal state ─────────────────────────────────────
  // The signed-in employee uses this to rotate their own login password.
  // Backend lives at POST /api/change-password (AuthController::changePassword),
  // which enforces min:8 + confirmed, blocks last-3-password reuse, and
  // dispatches PasswordChangedMail with the new credential. We keep field
  // errors here as a map so the inline <small className="text-danger"> hints
  // light up the right input.
  const [pwOpen, setPwOpen]         = useState(false);
  // Face-biometric enrolment modal. Self-service path so the employee can
  // (re-)register their face for attendance from this same Security card.
  const [faceRegOpen, setFaceRegOpen] = useState(false);
  const [pwCurrent, setPwCurrent]   = useState('');
  const [pwNew, setPwNew]           = useState('');
  const [pwConfirm, setPwConfirm]   = useState('');
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwShow, setPwShow]         = useState<{ cur: boolean; nw: boolean; cf: boolean }>({ cur: false, nw: false, cf: false });
  const [pwErrors, setPwErrors]     = useState<Record<string, string>>({});

  // Password strength rules — matched against the New Password value to
  // drive both the inline checklist and the colored strength bar. Same
  // ruleset used by Profile.tsx / ClientForm.tsx so the experience is
  // consistent across every password input in the app.
  const PW_RULES = [
    'At least 8 characters',
    'One uppercase letter',
    'One lowercase letter',
    'One number',
  ] as const;
  const validatePwRules = (pw: string): string[] => {
    const failed: string[] = [];
    if (pw.length < 8)        failed.push('At least 8 characters');
    if (!/[A-Z]/.test(pw))    failed.push('One uppercase letter');
    if (!/[a-z]/.test(pw))    failed.push('One lowercase letter');
    if (!/[0-9]/.test(pw))    failed.push('One number');
    return failed;
  };
  // Bonus rule for visual strength only — not required, but bumps the
  // bar to 5/5 and labels it "Strong" so users have a target to aim at.
  const pwHasSymbol = (pw: string) => /[^A-Za-z0-9]/.test(pw);
  const pwStrength = (() => {
    if (!pwNew) return { level: 0, text: '', barColor: '', barTextClass: '' };
    const passed = 4 - validatePwRules(pwNew).length + (pwHasSymbol(pwNew) ? 1 : 0);
    const labels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#ef4444', '#ef4444', '#f97316', '#eab308', '#10b981'];
    const text   = ['', 'text-danger', 'text-danger', 'text-warning', 'text-warning', 'text-success'];
    return { level: passed, text: labels[passed] || 'Strong', barColor: colors[passed] || '#10b981', barTextClass: text[passed] || 'text-success' };
  })();

  const resetPwForm = () => {
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwShow({ cur: false, nw: false, cf: false });
    setPwErrors({});
  };

  const handleChangePassword = async () => {
    const adminReset = !isOwnProfile;

    // Client-side guards first so the user sees mistakes without a round-trip.
    const errs: Record<string, string> = {};
    if (!adminReset && !pwCurrent) errs.current_password = 'Current password is required';
    if (!pwNew) {
      errs.password = 'New password is required';
    } else {
      const failed = validatePwRules(pwNew);
      if (failed.length) errs.password = failed.join(', ');
      else if (!adminReset && pwNew === pwCurrent) errs.password = 'New password must differ from the current one';
    }
    if (!pwConfirm) errs.password_confirmation = 'Please re-enter the new password';
    else if (pwNew !== pwConfirm) errs.password_confirmation = 'Passwords do not match';
    if (Object.keys(errs).length > 0) { setPwErrors(errs); return; }

    setPwSaving(true);
    setPwErrors({});
    try {
      if (adminReset) {
        await api.post(`/employees/${employeeId}/set-password`, {
          password: pwNew,
          password_confirmation: pwConfirm,
        });
        toast.success('Password updated', `${employee?.name || 'The employee'}'s login password has been reset. A confirmation email has been sent to them.`);
      } else {
        await api.post('/change-password', {
          current_password: pwCurrent,
          password: pwNew,
          password_confirmation: pwConfirm,
        });
        toast.success('Password updated', 'A confirmation email has been sent.');
      }
      setPwOpen(false);
      resetPwForm();
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const flat: Record<string, string> = {};
        for (const k of Object.keys(fieldErrors)) {
          flat[k] = Array.isArray(fieldErrors[k]) ? fieldErrors[k][0] : String(fieldErrors[k]);
        }
        setPwErrors(flat);
      } else {
        const msg = err?.response?.data?.message || err?.message || 'Could not change password';
        // 422 from the controller for wrong-current / re-use lands here.
        if (/current password/i.test(String(msg))) {
          setPwErrors({ current_password: String(msg) });
        } else if (/reuse|previous/i.test(String(msg))) {
          setPwErrors({ password: String(msg) });
        } else {
          toast.error('Password change failed', String(msg));
        }
      }
    } finally {
      setPwSaving(false);
    }
  };

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

  const regSelectedDate = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ /g, '-');

  // Toast hook — used by the Export Timelogs button and various save actions.
  const toast = useToast();

  // Payslip viewer modal — opens from the "View Payslip" button in the
  // Payroll Summary hero (PayslipViewerModal renders the real breakup).
  const [paySlipOpen, setPaySlipOpen] = useState(false);

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
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownRowId, setBreakdownRowId] = useState<string>('sal-1');
  // Breakdown modal — prefer the REAL salary version's components; fall back
  // to the mock makeBreakdown only when no real structure exists.
  const breakdownVersion = salaryVersions.find((v: any) => String(v.id) === breakdownRowId) || salaryVersions[0];
  const breakdownRow   = realTimeline.find(r => r.id === breakdownRowId) || realTimeline[0] || SALARY_TIMELINE[0];
  const breakdownData  = breakdownVersion ? {
    rows: (breakdownVersion.earnings || []).map((c: any) => ({
      label: c.label, monthly: Number(c.amount) || 0, annual: (Number(c.amount) || 0) * 12,
    })),
    totalMonthly: Number(breakdownVersion.monthly_gross) || 0,
    totalAnnual: Math.round((Number(breakdownVersion.monthly_gross) || 0) * 12),
    netPay: Math.round((Number(breakdownVersion.monthly_gross) || 0) * 0.88),
  } : makeBreakdown(breakdownRow.annual);

  // Submit New Expense Claim modal — opens from "+ Raise New Claim" in the
  // Expense Details tab. Two modes: Expense Claim (orange) and Advance
  // Request (purple/indigo).
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimMode, setClaimMode] = useState<'expense' | 'advance'>('expense');

  // Categories pulled from the expense_category master so the dropdown stays
  // in sync with what admins configure (and so we save the master id, not a
  // free-text label). Categories no longer carry spending limits — claims can
  // be any amount — so only id + name are needed.
  type ClaimCategory = {
    id: number; name: string;
  };
  const [claimCategories, setClaimCategories] = useState<ClaimCategory[]>([]);
  useEffect(() => {
    if (!claimOpen) return;
    // Use the expense-claims categories endpoint (branch-scoped) rather than
    // the generic /master endpoint — the latter peer-isolates employees and
    // hides the branch-level categories HR configured, so the dropdown only
    // showed a few. This returns every Active category visible to the
    // employee's branch. Pass the profile's employee so the response carries
    // that person's already-spent / remaining budget per category.
    const params: Record<string, string> = {};
    if (/^\d+$/.test(String(employeeId))) params.employee_id = String(employeeId);
    else if (employeeId) params.employee_code = String(employeeId);
    api.get('/expense-claims/categories', { params })
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setClaimCategories(
          rows
            .filter((r: any) => (r.status ?? 'Active') === 'Active')
            .map((r: any) => ({
              id: Number(r.id),
              name: String(r.name ?? ''),
            })),
        );
      })
      .catch(() => setClaimCategories([]));
  }, [claimOpen, employeeId]);
  const categoryById = (id: string | number | undefined): ClaimCategory | null => {
    if (id === undefined || id === '' || id === null) return null;
    const num = Number(id);
    return claimCategories.find(c => c.id === num) || null;
  };

  // Currencies pulled from the `currencies` master so the dropdown lists every
  // Active currency the admin configured (Master > Currencies) — the form
  // previously hardcoded just INR / USD / EUR, hiding the rest. Value is the
  // currency code (what the claim stores); label shows the symbol + code.
  type ClaimCurrency = { code: string; name: string; symbol: string };
  const [claimCurrencies, setClaimCurrencies] = useState<ClaimCurrency[]>([]);
  useEffect(() => {
    if (!claimOpen) return;
    api.get('/master/currencies')
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setClaimCurrencies(
          rows
            .filter((r: any) => (r.status ?? 'Active') === 'Active')
            .map((r: any) => ({
              code:   String(r.code ?? '').trim(),
              name:   String(r.name ?? '').trim(),
              symbol: String(r.symbol ?? '').trim(),
            }))
            .filter((c: ClaimCurrency) => c.code !== ''),
        );
      })
      .catch(() => setClaimCurrencies([]));
  }, [claimOpen]);

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
    // Each draft owns its own attachment list. Used to live in a single
    // top-level `claimFiles` state, which meant "Save & Add Another"
    // carried Claim 1's receipts into Claim 2 — the user saw the same
    // attachments on every draft and had no way to upload distinct ones.
    files: File[];
  };
  const blankDraft = (): ClaimDraft => ({
    employee: employeeId,
    category: '',
    // Currency, payment, and date all start empty so every field reads
    // as "untouched" with its placeholder visible. Previously currency/
    // payment defaulted to INR/UPI and date defaulted to today —
    // people submitted with wrong defaults assuming they'd been filled
    // in deliberately. Force an explicit choice on each.
    currency: '',
    project: '',
    payment: '',
    title: '',
    amount: '',
    date: '',
    vendor: '',
    purpose: '',
    saved: false,
    files: [],
  });
  const [claimDrafts, setClaimDrafts] = useState<ClaimDraft[]>([blankDraft()]);
  const [activeClaimIdx, setActiveClaimIdx] = useState(0);
  // True only when the modal was opened via the Drafts tab's Resume button.
  // "Raise New Claim" / "New Advance Request" leaves this false so the
  // form opens empty regardless of what's parked in localStorage. The
  // open-side effects reset the flag back to false after consuming it.
  const [resumeFromDraft, setResumeFromDraft] = useState(false);
  // Local-storage key for the Save Draft feature. Scoped per employee so
  // viewing two different profiles doesn't cross-contaminate drafts.
  const claimDraftKey = `cbc.expense.draft.${employeeId || 'me'}`;
  // List of saved expense / advance drafts. Each entry is independently
  // resumable, editable, and discardable so the user can keep multiple
  // works-in-progress side by side. Stored as a JSON array under the
  // per-employee localStorage key.
  type ExpenseDraftEntry = { id: string; savedAt: string; drafts: ClaimDraft[] };
  type AdvanceDraftEntry = { id: string; savedAt: string; data: any };
  const [expenseDrafts, setExpenseDrafts] = useState<ExpenseDraftEntry[]>([]);
  const [advanceDrafts, setAdvanceDrafts] = useState<AdvanceDraftEntry[]>([]);
  // Id of the draft currently loaded in the modal (when the user opened
  // via Resume). When set, Save Draft updates that entry in place rather
  // than appending a new one. Null when the modal was opened via Raise
  // New Claim, so Save Draft always creates a fresh entry.
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  // Reimbursement context — set when the claim modal is opened from a settled
  // company advance ("Raise Expense"). The amount is capped at the balance and
  // the created claim is linked back to the advance on submit.
  const [reimburseCtx, setReimburseCtx] = useState<{ advanceId: number; balance: number; advanceNo: string } | null>(null);
  const openReimbursement = (info: { advanceId: number; balance: number; advanceNo: string }) => {
    setReimburseCtx(info);
    setClaimMode('expense');
    setEditingDraftId(null);
    setResumeFromDraft(false);
    setClaimDrafts([{
      ...blankDraft(),
      title: `Advance reimbursement — ${info.advanceNo}`,
      amount: String(info.balance),
      date: new Date().toISOString().slice(0, 10),
      currency: 'INR',
      purpose: `Reimbursement for the amount spent over company advance ${info.advanceNo}.`,
    }]);
    setActiveClaimIdx(0);
    setClaimOpen(true);
  };
  // Reader that pulls both saved-draft buckets out of localStorage. Each
  // bucket is a JSON-encoded array of entries. Back-compat: also accepts
  // the previous single-slot shapes — raw array or `{savedAt,data}` — and
  // promotes them to a one-entry array under a freshly-minted id so users
  // upgrading from the older flow don't lose their saved draft.
  const readSavedDrafts = () => {
    const mkId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const raw = localStorage.getItem(claimDraftKey);
      if (!raw) { setExpenseDrafts([]); }
      else {
        const parsed = JSON.parse(raw);
        let entries: ExpenseDraftEntry[] = [];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'drafts' in parsed[0]) {
          // New format: array of entries.
          entries = (parsed as ExpenseDraftEntry[])
            .filter(e => e && Array.isArray(e.drafts) && e.drafts.length > 0)
            .map(e => ({ id: e.id || mkId('exp'), savedAt: e.savedAt || '', drafts: e.drafts }));
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          // Old raw-array shape: ClaimDraft[]. Promote to single entry.
          entries = [{ id: mkId('exp'), savedAt: '', drafts: parsed as ClaimDraft[] }];
        } else if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          // Old wrapped shape: { savedAt, data: ClaimDraft[] }. Promote.
          entries = [{ id: mkId('exp'), savedAt: parsed.savedAt || '', drafts: parsed.data as ClaimDraft[] }];
        }
        setExpenseDrafts(entries);
      }
    } catch { setExpenseDrafts([]); }
    try {
      const raw = localStorage.getItem(advanceDraftKey);
      if (!raw) { setAdvanceDrafts([]); }
      else {
        const parsed = JSON.parse(raw);
        let entries: AdvanceDraftEntry[] = [];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'data' in parsed[0] && 'id' in parsed[0]) {
          // New format: array of entries.
          entries = (parsed as AdvanceDraftEntry[])
            .filter(e => e && e.data && typeof e.data === 'object')
            .map(e => ({ id: e.id || mkId('adv'), savedAt: e.savedAt || '', data: e.data }));
        } else if (parsed && typeof parsed === 'object' && 'savedAt' in parsed && 'data' in parsed) {
          // Old wrapped shape. Promote to single entry.
          entries = [{ id: mkId('adv'), savedAt: parsed.savedAt || '', data: parsed.data }];
        } else if (parsed && typeof parsed === 'object') {
          // Old raw shape (advance payload at top level). Promote.
          entries = [{ id: mkId('adv'), savedAt: '', data: parsed }];
        }
        setAdvanceDrafts(entries);
      }
    } catch { setAdvanceDrafts([]); }
  };
  // Each time the modal re-opens, restore from localStorage if a draft is
  // saved there; otherwise start with one fresh draft. Also refresh the
  // draft-meta cache when the modal closes (the user may have just hit
  // Save Draft, or submitted, which clears storage).
  useEffect(() => {
    if (claimOpen && reimburseCtx) {
      // Opened for a reimbursement — openReimbursement() already seeded the
      // single pre-filled, amount-capped draft. Don't clobber it.
    } else if (claimOpen) {
      // Only restore from localStorage when the user explicitly hit
      // Resume on a specific draft card. Look up the entry by id from
      // the in-memory `expenseDrafts` array; if no editing id is set
      // (or the id no longer exists), fall back to a blank draft so
      // Raise New Claim always starts fresh.
      let restored: ClaimDraft[] | null = null;
      if (resumeFromDraft && editingDraftId) {
        const entry = expenseDrafts.find(e => e.id === editingDraftId);
        if (entry && entry.drafts.length > 0) {
          // Start with empty file lists (the JSON had `files: []`); the real
          // attachments are loaded from IndexedDB just below and patched in.
          restored = entry.drafts.map(p => ({ ...p, files: [] }));
        }
      }
      setClaimDrafts(restored || [blankDraft()]);
      setActiveClaimIdx(0);
      // Rehydrate attachments persisted in IndexedDB for this draft. Async, so
      // we patch them onto the just-set drafts once they load.
      if (resumeFromDraft && editingDraftId && restored) {
        const key = draftFilesKey(claimDraftKey, editingDraftId);
        loadDraftFiles<File[][]>(key).then(fileArrs => {
          if (!Array.isArray(fileArrs)) return;
          setClaimDrafts(prev => prev.map((d, i) => ({
            ...d,
            files: Array.isArray(fileArrs[i]) ? fileArrs[i] : (d.files || []),
          })));
        });
      }
    } else {
      // Modal just closed (or first mount) — refresh the cached meta so
      // the Drafts pill on the table reflects what's actually in storage.
      // Also clear the resume / editing flags so the next "Raise New
      // Claim" starts fresh even if Resume was used earlier this session.
      readSavedDrafts();
      setResumeFromDraft(false);
      setEditingDraftId(null);
      setReimburseCtx(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen, employeeId]);

  // Save Draft handler — persists either the expense `claimDrafts` array
  // or the advance form fields, depending on which mode the modal is in.
  // Doesn't hit the backend (rows are created only on actual Submit).
  // File objects are stripped before serialising since browsers can't
  // round-trip File through JSON — attachments must be re-staged on resume.
  const handleSaveDraft = () => {
    try {
      const savedAt = new Date().toISOString();
      const newId = `${claimMode === 'advance' ? 'adv' : 'exp'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (claimMode === 'advance') {
        const payload = {
          advType, advTypeOther, advAmount, advUsedFor,
          advRequestedDate, advRecoveryStart,
          advRecoveryMode, advMonths, advMonthlyEmi, advReason,
        };
        // If we opened via Resume, update that entry in place; otherwise
        // append a fresh one so multiple in-progress drafts coexist.
        const entryId = editingDraftId || newId;
        const next: AdvanceDraftEntry[] = editingDraftId
          ? advanceDrafts.map(e => e.id === editingDraftId ? { ...e, savedAt, data: payload } : e)
          : [...advanceDrafts, { id: newId, savedAt, data: payload }];
        localStorage.setItem(advanceDraftKey, JSON.stringify(next));
        // Attachments → IndexedDB (File can't round-trip JSON) so they survive
        // Save Draft and rehydrate on resume.
        void saveDraftFiles(draftFilesKey(advanceDraftKey, entryId), advFiles);
        toast.success(
          editingDraftId ? 'Draft updated' : 'Draft saved',
          advFiles.length > 0
            ? `Saved with ${advFiles.length} attachment${advFiles.length === 1 ? '' : 's'} — they'll be restored when you resume.`
            : 'Your draft is now available in the Drafts tab.',
        );
        setExpenseModuleTab('advance');
      } else {
        // Field data → localStorage (File can't round-trip JSON). The actual
        // attachments are persisted separately in IndexedDB keyed per draft,
        // so they survive Save Draft and rehydrate on resume.
        const entryId = editingDraftId || newId;
        const serialisable = claimDrafts.map(d => ({ ...d, files: [] }));
        const next: ExpenseDraftEntry[] = editingDraftId
          ? expenseDrafts.map(e => e.id === editingDraftId ? { ...e, savedAt, drafts: serialisable } : e)
          : [...expenseDrafts, { id: newId, savedAt, drafts: serialisable }];
        localStorage.setItem(claimDraftKey, JSON.stringify(next));
        // One File[] per sub-draft, index-aligned with `serialisable`.
        void saveDraftFiles(draftFilesKey(claimDraftKey, entryId), claimDrafts.map(d => d.files || []));
        const stagedFiles = claimDrafts.reduce((n, d) => n + (d.files?.length || 0), 0);
        toast.success(
          editingDraftId ? 'Draft updated' : 'Draft saved',
          stagedFiles > 0
            ? `Saved with ${stagedFiles} attachment${stagedFiles === 1 ? '' : 's'} — they'll be restored when you resume.`
            : 'Your draft is now available in the Drafts tab.',
        );
        setExpenseModuleTab('expense');
      }
      readSavedDrafts();
      setEditingDraftId(null);
      // Close the modal and jump straight to the Drafts pill so the user
      // sees the saved entry as the new active view.
      setClaimOpen(false);
      setExpenseFilter('draft');
    } catch {
      toast.error('Could not save draft', 'Browser storage is full or blocked.');
    }
  };
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

  // Symbol that prefixes the Amount field — follows the selected currency
  // (master symbol first, then a fallback for common codes), so picking USD
  // shows "$" instead of always "₹".
  const claimCurrencySymbol =
    claimCurrencies.find(c => c.code === claimCurrency)?.symbol
    || ({ INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', AED: 'AED', SGD: 'S$' } as Record<string, string>)[claimCurrency]
    || (claimCurrency || '₹');
  const claimAmountNum = Number(String(claimAmount).replace(/[^0-9.]/g, ''));

  // Per-field error map for the active expense draft — wired to red
  // borders + inline error messages on every input, same pattern the
  // candidate form uses. Reset on draft switch or modal re-open so we
  // don't carry over errors from a previously-active draft.
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  useEffect(() => { setClaimErrors({}); }, [activeClaimIdx, claimOpen]);
  const clearClaimErr = (key: string) =>
    setClaimErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));
  // Advance request — per-field error map. Cleared whenever the modal
  // re-opens or the mode toggles so old errors don't haunt a fresh form.
  const [advErrors, setAdvErrors] = useState<Record<string, string>>({});
  useEffect(() => { setAdvErrors({}); }, [claimOpen, claimMode]);
  const clearAdvErr = (key: string) =>
    setAdvErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));

  // Validator for the Advance Request form. Same toast-summary +
  // per-field map pattern the expense draft validator uses, so both
  // forms surface mistakes identically (red border + inline message).
  const submitAdvanceRequest = async () => {
    // Re-entrancy guard — shares the same flag the expense flow uses so
    // a fast double-click on Submit Advance Request can't fire two POSTs
    // and create duplicate rows.
    if (claimSubmitting) return;
    const errs: Record<string, string> = {};
    const summary: string[] = [];
    const rawAmount = advAmount.trim();
    const amt = Number(rawAmount);
    if (!advType)              { errs.type = 'Advance type is required'; summary.push('Advance type is required'); }
    if (advType === 'Other' && !advTypeOther.trim()) {
      errs.type_other = 'Please specify the advance type';
      summary.push('Specify the advance type');
    }
    // Reject letters / special characters outright — don't silently strip them
    // to the numeric part (e.g. "1122@sss" must NOT pass as 1122).
    if (!rawAmount) {
      errs.amount = 'Amount is required'; summary.push('Amount is required');
    } else if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
      errs.amount = 'Amount must be a number (digits only, up to 2 decimals)';
      summary.push('Amount must be a valid number');
    } else if (!(amt > 0)) {
      errs.amount = 'Amount must be greater than 0'; summary.push('Amount must be greater than 0');
    }
    // Company advance = spent for the company, not recovered from salary — it has
    // NO recovery mode and NO recovery/expected-use date at all.
    const advIsCompany = advUsedFor === 'company';
    if (!advRequestedDate)     { errs.requested = 'Requested date is required';   summary.push('Requested date is required'); }
    if (!advIsCompany && !advRecoveryStart) { errs.recovery_start = 'Recovery start date is required'; summary.push('Recovery start date is required'); }
    // Today (local, YYYY-MM-DD) — lexicographic compare works because the
    // MasterDatePicker emits ISO date strings, so today/past detection is
    // a plain string compare. Both dates must be today or later; recovery
    // additionally must be on/after the requested date.
    const todayIso = new Date().toISOString().slice(0, 10);
    // Requested date IS the request creation date — it must be today. No future
    // (the request is created now) and no past.
    if (advRequestedDate && advRequestedDate !== todayIso) {
      errs.requested = 'Requested date must be today (the request creation date)';
      summary.push('Requested date must be today (the request creation date)');
    }
    if (!advIsCompany && advRecoveryStart && advRecoveryStart < todayIso) {
      errs.recovery_start = 'Recovery start cannot be in the past';
      summary.push('Recovery start cannot be in the past');
    }
    // Server enforces after_or_equal:requested_date too, but catch it
    // client-side so the user gets immediate feedback instead of a 422.
    if (!advIsCompany && advRequestedDate && advRecoveryStart && advRecoveryStart < advRequestedDate) {
      errs.recovery_start = 'Recovery start must be on or after requested date';
      summary.push('Recovery start must be on or after requested date');
    }
    // Recovery mode / EMI only apply to a self (salary-recovered) advance.
    if (!advIsCompany) {
      if (!advRecoveryMode)      { errs.recovery_mode = 'Recovery mode is required'; summary.push('Recovery mode is required'); }
      if (advRecoveryMode === 'emi') {
        const months = Number(advMonths);
        if (!advMonths || !Number.isFinite(months) || months <= 0) {
          errs.months = 'Months must be greater than 0';
          summary.push('Months must be greater than 0');
        }
      }
    }
    if (!advReason.trim())     { errs.reason = 'Reason / purpose is required';    summary.push('Reason / purpose is required'); }
    if (Object.keys(errs).length > 0) {
      setAdvErrors(errs);
      toast.error('Fix the highlighted issues', summary.slice(0, 3).join('. '));
      return;
    }
    setClaimSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('advance_type', advType);
      if (advType === 'Other') fd.append('advance_type_other', advTypeOther.trim());
      fd.append('amount', String(amt));
      fd.append('used_for', advUsedFor);
      fd.append('requested_date', advRequestedDate);
      // Company advance has NO recovery and NO date — only Self carries the
      // recovery start + mode (and EMI schedule).
      if (!advIsCompany) {
        fd.append('recovery_start', advRecoveryStart);
        fd.append('recovery_mode', advRecoveryMode);
        if (advRecoveryMode === 'emi') {
          fd.append('recovery_months', String(Number(advMonths)));
          if (advMonthlyEmi) {
            const emi = Number(String(advMonthlyEmi).replace(/[^\d.]/g, ''));
            if (Number.isFinite(emi) && emi > 0) fd.append('monthly_emi', String(emi));
          }
        }
      }
      fd.append('reason', advReason.trim());
      // Profile owner — same routing logic as expense-claim store(). The
      // backend resolves either numeric id or EMP- code, and gates the
      // "you can only file under yourself" rule for non-super-admins.
      if (profileEmpIdNum !== null) {
        fd.append('employee_id', String(profileEmpIdNum));
      } else if (profileEmpCode) {
        fd.append('employee_code', profileEmpCode);
      }
      for (const f of advFiles) fd.append('files[]', f);

      await api.post('/advance-requests', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Advance request submitted', 'Sent for manager + finance approval.');
      // If this submission resumed a parked draft, drop only that one
      // entry from storage so the rest of the user's drafts survive.
      // Fresh "Raise New Claim" submissions leave storage untouched.
      if (editingDraftId) {
        try {
          const next = advanceDrafts.filter(e => e.id !== editingDraftId);
          if (next.length) localStorage.setItem(advanceDraftKey, JSON.stringify(next));
          else             localStorage.removeItem(advanceDraftKey);
          void deleteDraftFiles(draftFilesKey(advanceDraftKey, editingDraftId));
        } catch { /* swallow */ }
      }
      setEditingDraftId(null);
      setClaimOpen(false);
      // Refresh the list table so the new row appears immediately. Wrapped
      // in try/catch so a stale-fetch failure doesn't surface a second
      // error toast right after the success one.
      try { await refreshAdvances(); } catch { /* swallow */ }
    } catch (err: any) {
      // Same surface-the-best-message pattern submitAllDrafts uses —
      // 422 field errors first, then top-level message, then a status
      // hint as fallback.
      const fieldErrors = err?.response?.data?.errors;
      let msg = '';
      if (fieldErrors && typeof fieldErrors === 'object') {
        const first = Object.values(fieldErrors)[0];
        msg = Array.isArray(first) ? String(first[0]) : String(first);
      }
      if (!msg) msg = err?.response?.data?.message || '';
      const status = err?.response?.status;
      if (!msg) {
        msg = status === 500
          ? 'The server rejected the request. Check the amount fits 12 digits and try again.'
          : status === 413
            ? 'One or more attachments are too large to upload.'
            : 'Could not submit the advance request. Please try again.';
      }
      toast.error('Submit failed', msg);
    } finally {
      setClaimSubmitting(false);
    }
  };

  // Advance request fields
  const [advType, setAdvType] = useState('');
  const [advTypeOther, setAdvTypeOther] = useState(''); // shown only when advType === 'Other'
  const [advAmount, setAdvAmount] = useState('');
  // Who the advance is for: 'self' (recovered from salary — the default/current
  // flow) or 'company' (spent for the company, NOT recovered). For 'company' the
  // date field becomes an Expected Use Date and Recovery Mode is disabled.
  const [advUsedFor, setAdvUsedFor] = useState('self');
  const [advRequestedDate, setAdvRequestedDate] = useState(new Date().toISOString().slice(0, 10));
  // Shared date field — Recovery Start for self, Expected Use Date for company.
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
  // Expense receipts now live per-draft (`draft.files`) so each claim
  // owns its own attachments. The `claimFiles` / `setClaimFiles`
  // aliases below preserve the existing JSX bindings while reading and
  // writing the active draft's bucket. Advance docs stay top-level
  // since the advance form is a single record, not a list.
  const claimFiles = draft.files;
  const setClaimFiles = (next: File[] | ((prev: File[]) => File[])) => {
    setClaimDrafts(d => d.map((x, i) => {
      if (i !== activeClaimIdx) return x;
      const nextFiles = typeof next === 'function' ? (next as (prev: File[]) => File[])(x.files) : next;
      return { ...x, files: nextFiles };
    }));
  };
  const [advFiles, setAdvFiles] = useState<File[]>([]);
  // localStorage key for the advance-mode Save Draft. Kept separate from
  // the expense draft key so flipping modules doesn't clobber the other
  // form's saved fields. Scoped per employee like the expense draft.
  const advanceDraftKey = `cbc.advance.draft.${employeeId || 'me'}`;
  // Reset attachments + custom advance-type field every time the modal
  // opens — then, if a saved advance draft exists in localStorage, hydrate
  // every advance field from it. File objects don't round-trip JSON so
  // attachments must be re-staged on resume (same trade-off as the
  // expense Save Draft flow).
  useEffect(() => {
    if (claimOpen) {
      // Always wipe attachments + transient fields on open so the form is
      // visually consistent. Only re-hydrate other fields from localStorage
      // when the user explicitly opened via the Drafts Resume button;
      // "New Advance Request" should start blank even when a draft exists.
      setAdvFiles([]);
      setAdvTypeOther('');
      if (!resumeFromDraft || !editingDraftId) {
        setAdvType('');
        setAdvAmount('');
        setAdvRequestedDate(new Date().toISOString().slice(0, 10));
        setAdvUsedFor('self');
        setAdvRecoveryStart('');
        setAdvRecoveryMode('');
        setAdvMonths('');
        setAdvMonthlyEmi('');
        setAdvReason('');
        return;
      }
      try {
        // Hydrate the specific advance entry that was clicked in the
        // Drafts tab. Look it up by id in the in-memory list rather
        // than re-reading localStorage — same source of truth used by
        // the cards themselves.
        const entry = advanceDrafts.find(e => e.id === editingDraftId);
        if (entry) {
          const d = entry.data as Partial<{
            advType: string; advTypeOther: string; advAmount: string; advUsedFor: string;
            advRequestedDate: string; advRecoveryStart: string;
            advRecoveryMode: string; advMonths: string; advMonthlyEmi: string;
            advReason: string;
          }>;
          if (d && typeof d === 'object') {
            if (typeof d.advType            === 'string') setAdvType(d.advType);
            if (typeof d.advTypeOther       === 'string') setAdvTypeOther(d.advTypeOther);
            if (typeof d.advAmount          === 'string') setAdvAmount(d.advAmount);
            if (typeof d.advUsedFor         === 'string') setAdvUsedFor(d.advUsedFor);
            if (typeof d.advRequestedDate   === 'string') setAdvRequestedDate(d.advRequestedDate);
            if (typeof d.advRecoveryStart   === 'string') setAdvRecoveryStart(d.advRecoveryStart);
            if (typeof d.advRecoveryMode    === 'string') setAdvRecoveryMode(d.advRecoveryMode);
            if (typeof d.advMonths          === 'string') setAdvMonths(d.advMonths);
            if (typeof d.advMonthlyEmi      === 'string') setAdvMonthlyEmi(d.advMonthlyEmi);
            if (typeof d.advReason          === 'string') setAdvReason(d.advReason);
          }
        }
        // Rehydrate attachments persisted in IndexedDB for this advance draft.
        loadDraftFiles<File[]>(draftFilesKey(advanceDraftKey, editingDraftId)).then(files => {
          if (Array.isArray(files) && files.length) setAdvFiles(files);
        });
      } catch { /* ignore — leave defaults in place */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen]);

  // ── Expense Claims — API-backed list ──────────────────────────────────
  // Shape mirrors what ExpenseClaimController::serialize() returns. The
  // table renders directly from `apiClaims` (own) and `teamClaims` (when the
  // current user is the reporting manager for someone). Both are refetched
  // after a successful submit / approve / reject.
  type ApiClaim = {
    id: number;
    claim_no: string | null;
    employee_id: number;
    employee_name: string | null;
    employee_code: string | null;
    department_id?: number | null;
    department_name?: string | null;
    manager_id: number | null;
    manager_name: string | null;
    category_id: number | null;
    category_name: string | null;
    currency: string | null;
    project: string | null;
    payment_method: string | null;
    title: string;
    amount: number;
    expense_date: string;
    vendor: string | null;
    purpose: string | null;
    attachments: { name: string; size?: number; url?: string }[];
    status: 'pending' | 'approved' | 'rejected';
    manager_status: 'pending' | 'approved' | 'rejected';
    manager_acted_at: string | null;
    manager_comment: string | null;
    hr_status: 'pending' | 'approved' | 'rejected';
    hr_user_name: string | null;
    hr_acted_at: string | null;
    hr_comment: string | null;
    creator_name: string | null;
    created_at: string | null;
  };
  const { user: authUser, refresh: refreshAuth } = useAuth();
  // The route `/hr/employees/:id/profile` carries the EMP- code (e.g.
  // "EMP-001") in the URL, NOT the numeric Employee.id. Pass both to the
  // backend — it will resolve whichever it gets.
  const profileEmpCode = String(employeeId || '');
  const profileEmpIdNum = /^\d+$/.test(profileEmpCode) ? Number(profileEmpCode) : null;
  // Profile photo upload & cropping mirrors Profile.tsx: validate the picked
  // image, open the square cropper, then stage a cropped JPEG preview.
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Prefer the freshly-fetched empDetail.photo_url over the lightweight
    // employee prop passed via navigation state — the prop can be stale if
    // the user uploaded a new photo elsewhere (HR Employees / Onboarding)
    // since opening this profile.
    const photo = empDetail?.photo_url || employee?.photoUrl || null;
    const resolved = photo ? resolveFileUrl(photo) : null;
    setProfilePhotoPreview(prev => (profilePhotoFile ? prev : resolved));
  }, [empDetail?.photo_url, employee?.photoUrl, profilePhotoFile]);

  const restoreSavedProfilePhoto = () => {
    const saved = empDetail?.photo_url || employee?.photoUrl || null;
    setProfilePhotoPreview(saved ? resolveFileUrl(saved) : null);
  };

  const validateProfilePhoto = (file: File): string | null => {
    const MAX_BYTES = 4 * 1024 * 1024;
    const OK_TYPES  = ['image/jpeg', 'image/png', 'image/webp'];
    if (!OK_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP file.';
    if (file.size > MAX_BYTES)         return `Photo is larger than 4 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    return null;
  };

  const handleProfilePhotoChange = (file: File | null) => {
    if (!file) {
      setProfilePhotoFile(null);
      restoreSavedProfilePhoto();
      return;
    }
    const err = validateProfilePhoto(file);
    if (err) {
      toast.error('Invalid Photo', err);
      if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
      return;
    }
    const r = new FileReader();
    r.onload = ev => {
      setCropSrc(ev.target?.result as string);
      setCropOpen(true);
    };
    r.readAsDataURL(file);
    if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
  };

  const handleCropConfirm = (blob: Blob) => {
    const file = new File([blob], `profile-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setProfilePhotoFile(file);
    const r = new FileReader();
    r.onload = ev => setProfilePhotoPreview(ev.target?.result as string);
    r.readAsDataURL(blob);
    setCropOpen(false);
    setCropSrc(null);
  };

  const resolveEmployeeUploadId = async (): Promise<number | string> => {
    if (profileEmpIdNum !== null) return profileEmpIdNum;
    if (authUser?.employee_id && authUser?.employee_code === profileEmpCode) return authUser.employee_id;

    const res = await api.get('/employees', { params: { search: profileEmpCode } });
    const rows = Array.isArray(res.data) ? res.data : [];
    const match = rows.find((row: any) => String(row.emp_code || row.id) === profileEmpCode) || rows[0];
    if (!match?.id) throw new Error('Could not resolve employee record for photo upload.');
    return match.id;
  };

  const handleSaveProfilePhoto = async () => {
    if (!profilePhotoFile) return;
    setSavingPhoto(true);
    try {
      const uploadEmployeeId = await resolveEmployeeUploadId();
      const fd = new FormData();
      fd.append('document_key', 'photo');
      fd.append('file', profilePhotoFile);
      const res = await api.post(`/employees/${encodeURIComponent(String(uploadEmployeeId))}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const nextUrl = res?.data?.document?.url;
      setProfilePhotoPreview(nextUrl ? resolveFileUrl(nextUrl) : profilePhotoPreview);
      // Mirror the new URL into empDetail so the avatar source stays in
      // sync without waiting for the next /employees/{id} refetch.
      if (nextUrl) {
        setEmpDetail((prev: any) => prev ? { ...prev, photo_url: nextUrl } : prev);
      }
      setProfilePhotoFile(null);
      // If the user is editing their OWN profile, re-fetch /me so the
      // header avatar (ProfileDropdown reads user.employee_profile_photo)
      // and any other auth-derived avatars pick up the new photo without
      // a hard refresh. Scoped check — HR admins editing someone else's
      // photo shouldn't trigger their own /me re-fetch.
      const editingSelf = !!authUser?.employee_id && (
        (profileEmpIdNum !== null && Number(authUser.employee_id) === profileEmpIdNum)
        || (!!authUser?.employee_code && authUser.employee_code === profileEmpCode)
      );
      if (editingSelf) {
        // Fire-and-forget — the toast doesn't depend on refresh succeeding,
        // and a failed /me shouldn't block the user's upload confirmation.
        refreshAuth().catch(() => {});
      }
      toast.success('Photo updated', 'Profile picture has been changed.');
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || err?.message || 'Could not update photo');
    } finally {
      setSavingPhoto(false);
    }
  };

  const profilePhotoSrc =
    profilePhotoPreview
    || (empDetail?.photo_url ? resolveFileUrl(empDetail.photo_url) : null)
    || (employee?.photoUrl   ? resolveFileUrl(employee.photoUrl)   : null);
  // "Is this the current user's own profile?" — first try numeric id match,
  // fall back to the linked Employee.id. We don't have the current user's
  // emp_code in /me, so when the URL is a code we trust the backend's later
  // claims API to scope correctly and just compare against the API rows'
  // employee_id once they load.
  const [apiClaims, setApiClaims] = useState<ApiClaim[]>([]);
  const [teamClaims, setTeamClaims] = useState<ApiClaim[]>([]);
  // Three signals that the profile being viewed belongs to the logged-in user.
  // Any one is enough: numeric id match, EMP-code match, or one of the loaded
  // "mine"-scope claims belongs to the auth user (catches edge cases where
  // /me's employee_code wasn't set yet but the API resolved correctly).
  const isOwnProfile = !!authUser?.employee_id
    && (
      (profileEmpIdNum !== null && Number(authUser.employee_id) === profileEmpIdNum)
      || (!!authUser?.employee_code && authUser.employee_code === profileEmpCode)
      || apiClaims.some(c => c.employee_id === authUser.employee_id)
    );

  // Onboarding gate (CBC #84/#85). A mid-onboarding employee is locked to the
  // Inbox everywhere else (App.tsx), but /profile stays open so they can view
  // their record — and this page carries the Leave / Expense Claim / Advance
  // Request forms, which is how those submissions were reachable. Hide the
  // entry points; App\Support\OnboardingGuard rejects them server-side too.
  const onboardingPending = authUser?.user_type === 'employee' && !!(authUser as any)?.onboarding_pending;
  const canRaiseHrRequest = isOwnProfile && !onboardingPending;

  // Detect whether the *profile owner* manages anyone — drives visibility
  // of the Hiring Requests tab. Hits /my-team/employees which, for an
  // employee user_type, returns rows where reporting_manager_id matches
  // their Employee.id. We only run the probe on the user's own profile
  // since the endpoint is auth-context-scoped (it always reflects the
  // logged-in user, not the profile being viewed).
  useEffect(() => {
    if (!isOwnProfile) {
      setIsManager(false);
      setTeamSize(0);
      return;
    }
    let cancelled = false;
    api.get('/my-team/employees')
      .then((res: any) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data?.employees) ? res.data.employees : [];
        setTeamSize(list.length);
        setIsManager(list.length > 0);
      })
      .catch(() => {
        if (!cancelled) { setIsManager(false); setTeamSize(0); }
      });
    return () => { cancelled = true; };
  }, [isOwnProfile]);

  // Hiring Requests list — fetched lazily when the manager opens the tab
  // (or when a new request is submitted, signalled by hiringRefreshKey).
  // We filter client-side to entries this employee filed so the inline
  // KPI/list view shows just their own pipeline, even though the API
  // returns every request visible in their tenant scope.
  useEffect(() => {
    if (tab !== 'hiring') return;
    // Fetch when the user has access to the tab — either as a manager
    // (own raised requests) or as an admin-tier viewer (all org rows).
    const seesAll = ['branch_user', 'client_admin', 'super_admin']
      .includes(String(authUser?.user_type || ''));
    if (!isManager && !seesAll) return;
    let cancelled = false;
    setHiringLoading(true);
    // Pull hiring requests AND the recruitment list in parallel so the
    // table can show "Recruitment Created" once HR converts a request
    // into a recruitment row (hiring_request_id back-pointer). Mirrors
    // the cross-reference HiringRequestsListModal builds for its tabs.
    Promise.all([
      api.get('/hiring-requests'),
      api.get('/recruitments').catch(() => ({ data: [] })),
    ])
      .then(([reqRes, recRes]: any[]) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(reqRes.data) ? reqRes.data : [];
        // Visibility rules:
        //   - Reporting-manager *employee*       → only requests THEY raised.
        //   - branch_user / client_admin / super → full tenant list (they
        //                                            already have HR-wide
        //                                            visibility elsewhere).
        // The backend stores the creator id on `created_by` (not
        // `requested_by` — which is a free-text display field). Using the
        // wrong column was why freshly-raised requests didn't appear in
        // the manager's own list.
        const myUserId = authUser?.id;
        const visible = seesAll
          ? rows
          : (myUserId ? rows.filter(r => Number(r.created_by) === Number(myUserId)) : rows);
        // Annotate each row with `_hasRecruitment` so the table can render
        // a "Recruitment Created" pill that supersedes the raw status.
        const recs: any[] = Array.isArray(recRes.data) ? recRes.data : [];
        const linkedHrIds = new Set<number>();
        for (const r of recs) {
          const id = Number(r?.hiring_request_id);
          if (id) linkedHrIds.add(id);
        }
        setHiringRequests(visible.map((r: any) => ({
          ...r,
          _hasRecruitment: linkedHrIds.has(Number(r.id)),
        })));
      })
      .catch(() => { if (!cancelled) setHiringRequests([]); })
      .finally(() => { if (!cancelled) setHiringLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isManager, hiringRefreshKey, authUser?.id, authUser?.user_type]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [expenseSubTab, setExpenseSubTab] = useState<'mine' | 'team'>('mine');
  // Fetch (or re-fetch) both lists. `mine` is filtered by employee_id so HR /
  // super-admin viewing someone else's profile sees that employee's claims.
  // `team` is only meaningful for the current user — backend scopes it to
  // claims where manager_id = the current user's Employee.id.
  const refreshClaims = async () => {
    if (tab !== 'expense' || !profileEmpCode) return;
    setLoadingClaims(true);
    try {
      // Pass both forms — the backend accepts whichever resolves first.
      const mineRes = await api.get('/expense-claims', {
        params: {
          scope: 'mine',
          ...(profileEmpIdNum !== null
            ? { employee_id: profileEmpIdNum }
            : { employee_code: profileEmpCode }),
        },
      });
      setApiClaims(Array.isArray(mineRes.data) ? mineRes.data : []);
      // Always fetch team claims for the current user — the strip only renders
      // when the result is non-empty AND this is their own profile.
      const teamRes = await api.get('/expense-claims', { params: { scope: 'team' } });
      setTeamClaims(Array.isArray(teamRes.data) ? teamRes.data : []);
    } catch {
      setApiClaims([]);
      setTeamClaims([]);
    } finally {
      setLoadingClaims(false);
    }
  };
  // Re-fetch whenever the tab switches to expense, the profile changes, or
  // ownership changes (e.g. /me re-resolves and we now know the employee_id).
  useEffect(() => {
    refreshClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileEmpIdNum, isOwnProfile]);

  // ── Advance Requests — same shape as the expense-claim lists above.
  // `apiAdvances` = the profile owner's advances (mine scope, optionally
  // filtered to a specific employee). `teamAdvances` = pending requests
  // routed to the current user as the assigned reporting manager.
  const [apiAdvances, setApiAdvances]   = useState<AdvanceRequestRow[]>([]);
  const [teamAdvances, setTeamAdvances] = useState<AdvanceRequestRow[]>([]);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  // Top-level switcher: 'expense' (default) or 'advance'. The two surfaces
  // share the Expense Details tab so HR / employee can flip between
  // expense-claim and advance-request rows without leaving the page.
  const [expenseModuleTab, setExpenseModuleTab] = useState<'expense' | 'advance'>('expense');
  // Mine / Team sub-pill — same semantics as the expense version. When the
  // user is viewing their own profile and is also a reporting manager,
  // they can switch between their own advances and pending team requests.
  const [advanceSubTab, setAdvanceSubTab] = useState<'mine' | 'team'>('mine');
  // Advance Used-For filter — Self used / Company used (no "All"). Sits above the
  // status pills (All/Approved/Rejected/Pending), narrowing by used_for first.
  const [advUsedForTab, setAdvUsedForTab] = useState<'self' | 'company'>('self');

  const refreshAdvances = async () => {
    if (tab !== 'expense' || !profileEmpCode) return;
    setLoadingAdvances(true);
    try {
      const mineRes = await api.get('/advance-requests', {
        params: {
          scope: 'mine',
          ...(profileEmpIdNum !== null
            ? { employee_id: profileEmpIdNum }
            : { employee_code: profileEmpCode }),
        },
      });
      setApiAdvances(Array.isArray(mineRes.data) ? mineRes.data : []);
      const teamRes = await api.get('/advance-requests', { params: { scope: 'team' } });
      setTeamAdvances(Array.isArray(teamRes.data) ? teamRes.data : []);
    } catch {
      setApiAdvances([]);
      setTeamAdvances([]);
    } finally {
      setLoadingAdvances(false);
    }
  };
  useEffect(() => {
    refreshAdvances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileEmpIdNum, isOwnProfile]);

  // Keep an already-open Expense Overview in sync with approve/reject
  // decisions made elsewhere (a manager / HR acting in another tab or
  // session). There's no realtime push, so without this the status pill
  // keeps showing the stale value until a full page reload. Refetch both
  // claims and advances whenever the tab regains focus / becomes visible.
  // The guards inside refreshClaims / refreshAdvances no-op unless the
  // Expense Details tab is active, so this stays cheap.
  useEffect(() => {
    if (tab !== 'expense') return;
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      refreshClaims();
      refreshAdvances();
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileEmpIdNum, isOwnProfile]);

  /** Dispatcher for inline Approve / Reject buttons on advance-request
   *  rows. Same shape as `actOnClaim`, just a different REST collection. */
  const actOnAdvance = async (
    advanceId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/advance-requests/${advanceId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Advance request status updated');
      await refreshAdvances();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // POST every draft as multipart/form-data so the optional attachments[]
  // upload alongside. On success, clear drafts, close modal, refresh list.
  //
  // `claimSubmitting` is a re-entrancy guard — a fast double-click on the
  // Submit button used to fire the loop twice in parallel, creating two
  // copies of every draft. The flag flips immediately, the button is
  // disabled while it's true, and try/finally guarantees we always clear
  // it (success, failure, or the user closing the modal mid-flight).
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const submitAllDrafts = async () => {
    if (claimSubmitting) return;
    // Per-draft validation — block submit when ANY draft is missing a
    // required field OR exceeds its category's monthly budget. Used to
    // silently close the modal on an empty form, which the user reported
    // as "form brings us back to profile view".
    //
    // We populate two things in parallel:
    //   - `errors` (toast summary, capped at 3 messages)
    //   - `firstFieldErrors` for the ACTIVE draft, mapped to the input
    //     keys (title / amount / date / category / purpose) so the form
    //     paints red borders + inline messages exactly like the candidate
    //     form does. Other drafts' errors aren't shown inline (they're
    //     not currently visible), but the toast still names them.
    const errors: string[] = [];
    const firstFieldErrors: Record<string, string> = {};
    claimDrafts.forEach((d, idx) => {
      const label = `Claim ${idx + 1}`;
      const title = d.title.trim();
      const amt   = Number(String(d.amount).replace(/[^\d.]/g, ''));
      const draftErrs: Record<string, string> = {};
      if (!title) {
        draftErrs.title = 'Expense title is required';
        errors.push(`${label}: Expense title is required`);
      }
      if (!d.amount.trim() || !Number.isFinite(amt) || amt <= 0) {
        draftErrs.amount = 'Amount must be greater than 0';
        errors.push(`${label}: Amount must be greater than 0`);
      }
      if (!d.date) {
        draftErrs.date = 'Expense date is required';
        errors.push(`${label}: Expense date is required`);
      } else {
        // No future dates; only the last 30 days are claimable.
        const todayIso = new Date().toISOString().slice(0, 10);
        const minIso = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
        if (d.date > todayIso) {
          draftErrs.date = 'Expense date cannot be in the future';
          errors.push(`${label}: Expense date cannot be in the future`);
        } else if (d.date < minIso) {
          draftErrs.date = 'Expense date must be within the last 30 days';
          errors.push(`${label}: Expense date must be within the last 30 days`);
        }
      }
      if (!d.category) {
        draftErrs.category = 'Category is required';
        errors.push(`${label}: Category is required`);
      }
      if (!d.purpose.trim()) {
        draftErrs.purpose = 'Business purpose is required';
        errors.push(`${label}: Business purpose is required`);
      }
      // Proof & receipt is mandatory — every claim must carry at least one
      // supporting document before it can be submitted for approval. Drafts
      // parked via "Save Draft" lose their File objects on resume (File can't
      // survive JSON), so the user is forced to re-attach here — the same
      // trade-off already called out where drafts are restored.
      if (!(d.files && d.files.length > 0)) {
        draftErrs.files = 'At least one proof / receipt is required';
        errors.push(`${label}: At least one proof / receipt is required`);
      }
      if (idx === activeClaimIdx) Object.assign(firstFieldErrors, draftErrs);
    });
    if (errors.length > 0) {
      setClaimErrors(firstFieldErrors);
      toast.error('Fix the highlighted issues', errors.slice(0, 3).join('. '));
      return;
    }
    const valid = claimDrafts.filter(d => d.title.trim() && d.amount.trim());
    if (valid.length === 0) {
      toast.warning('Nothing to submit', 'Add at least one expense before submitting.');
      return;
    }
    if (reimburseCtx) {
      const over = valid.some(d => (Number(String(d.amount).replace(/[^\d.]/g, '')) || 0) > reimburseCtx.balance + 0.005);
      if (over) {
        toast.warning('Over the reimbursement', `The amount can't exceed the balance ₹${reimburseCtx.balance.toLocaleString('en-IN')}.`);
        return;
      }
    }
    setClaimSubmitting(true);
    try {
      const created: ApiClaim[] = [];
      for (const d of valid) {
        const fd = new FormData();
        fd.append('title', d.title.trim());
        fd.append('amount', String(Number(String(d.amount).replace(/[^\d.]/g, '')) || 0));
        fd.append('expense_date', d.date);
        if (d.category)       fd.append('category_id', d.category);
        if (d.currency)       fd.append('currency', d.currency);
        if (d.project)        fd.append('project', d.project);
        if (d.payment)        fd.append('payment_method', d.payment);
        if (d.vendor)         fd.append('vendor', d.vendor);
        if (d.purpose)        fd.append('purpose', d.purpose);
        if (reimburseCtx)     fd.append('reimbursement_for_advance_id', String(reimburseCtx.advanceId));
        // Always file under the profile we're viewing. The backend resolves
        // either employee_id (numeric) or employee_code (EMP- string), and
        // falls back to the current user's linked Employee row if neither is
        // present. Backend also enforces "non-super-admin can only file under
        // their own employee record".
        if (profileEmpIdNum !== null) {
          fd.append('employee_id', String(profileEmpIdNum));
        } else if (profileEmpCode) {
          fd.append('employee_code', profileEmpCode);
        }
        // Use THIS draft's own attachments — earlier the loop reused the
        // active-draft's files for every claim, so every backend row got
        // an identical copy of whichever attachment list was showing.
        for (const f of (d.files || [])) fd.append('files[]', f);
        const res = await api.post('/expense-claims', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (res?.data?.id) created.push(res.data as ApiClaim);
      }
      toast.success('Claim submitted', `${valid.length} claim${valid.length > 1 ? 's' : ''} sent for approval`);
      // If this submission resumed a parked draft entry, drop only that
      // one from storage. Other parked drafts are preserved. Fresh
      // submissions leave storage untouched.
      if (editingDraftId) {
        try {
          const next = expenseDrafts.filter(e => e.id !== editingDraftId);
          if (next.length) localStorage.setItem(claimDraftKey, JSON.stringify(next));
          else             localStorage.removeItem(claimDraftKey);
          void deleteDraftFiles(draftFilesKey(claimDraftKey, editingDraftId));
        } catch { /* ignore */ }
      }
      setEditingDraftId(null);
      setClaimOpen(false);
      // A reimbursement submission linked back to an advance — refresh advances
      // so the settled section flips to "Reimbursement raised", then clear ctx.
      if (reimburseCtx) { setReimburseCtx(null); void refreshAdvances(); }
      // Show the new claim(s) in the All Claims list immediately — the POST
      // returns the fully-serialized row, so prepend it (newest first) without
      // waiting on the refetch. Fixes "claim not displayed until page refresh".
      // refreshClaims() then reconciles (claim_no / approval routing); the
      // server replace de-dupes since the row is already committed.
      if (created.length) {
        setApiClaims(prev => {
          const seen = new Set(prev.map(c => c.id));
          return [...created.slice().reverse().filter(c => c.id && !seen.has(c.id)), ...prev];
        });
      }
      await refreshClaims();
    } catch (err: any) {
      // Pick the most useful message out of the response:
      //   1. 422 field errors (Laravel validator) — pull the first one
      //   2. Top-level `message` (controller's abort/exception)
      //   3. Raw status — special-case 500 with a hint, because the most
      //      common cause is an amount that overflowed the decimal(18,2)
      //      column and we already cap the input now but legacy payloads
      //      can still hit it.
      const fieldErrors = err?.response?.data?.errors;
      let msg = '';
      if (fieldErrors && typeof fieldErrors === 'object') {
        const first = Object.values(fieldErrors)[0];
        msg = Array.isArray(first) ? String(first[0]) : String(first);
      }
      if (!msg) msg = err?.response?.data?.message || '';
      const status = err?.response?.status;
      if (!msg) {
        msg = status === 500
          ? 'The server rejected the claim. Check that the amount fits within 12 digits and try again.'
          : status === 413
            ? 'One or more receipts are too large to upload. Trim attachments and retry.'
            : 'Could not submit the claim. Please try again.';
      }
      toast.error('Submit failed', msg);
    } finally {
      setClaimSubmitting(false);
    }
  };
  

  // Inline manager / HR actions used by the team-tab and HR pages.
  const actOnClaim = async (
    claimId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      const res = await api.post(`/expense-claims/${claimId}/${action}`, comment ? { comment } : {});
      // Patch the row in both lists so the Approval Audit Log reflects the
      // new Reporting Manager / HR status immediately (no page refresh). The
      // manager acts from the Team sub-tab, so teamClaims must update too.
      if (res?.data?.id) {
        const updated = res.data as ApiClaim;
        setApiClaims(prev => prev.map(c => c.id === updated.id ? updated : c));
        setTeamClaims(prev => prev.map(c => c.id === updated.id ? updated : c));
      }
      toast.success('Updated', 'Claim status updated');
      await refreshClaims();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // Live counts for the Evidence Vault hero KPIs and tab badges. Read
  // directly from the same `uploadedDocs` + `signedDocs` arrays the
  // tables render, so the header always agrees with the body.
  const verifiedUploadedCount = uploadedDocs.filter(d => d.status === 'verified').length;
  const pendingUploadedCount  = uploadedDocs.filter(d => d.status !== 'verified').length;
  const signedCompletedCount  = signedDocs.filter(d => String(d.status).toLowerCase() === 'completed').length;
  const employeeDocCount       = uploadedDocs.length;
  const organizationalDocCount = signedDocs.length;
  const vaultCounts = {
    total:    employeeDocCount + organizationalDocCount,
    verified: verifiedUploadedCount,
    pending:  pendingUploadedCount,
    signed:   signedCompletedCount,
  };

  const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
    { key: 'profile',    label: 'Profile Details', icon: 'ri-user-line',                color: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
    { key: 'job',        label: 'Job Details',     icon: 'ri-briefcase-line',           color: 'linear-gradient(135deg,#0ab39c,#30d5b5)' },
    { key: 'attendance', label: 'Attendance',      icon: 'ri-calendar-check-line',      color: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
    { key: 'vault',      label: 'Evidence Vault',  icon: 'ri-folder-shield-2-line',     color: 'linear-gradient(135deg,#a855f7,#c084fc)' },
    { key: 'payroll',    label: 'Payroll Details', icon: 'ri-money-dollar-circle-line', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
    // Expense Details — only surfaced when the employee's Expense Policy is
    // "Applicable" (set at onboarding / on the employee Work Details form).
    // "Not Applicable" or unset hides the whole tab.
    ...(String(empDetail?.expense_policy || '') === 'Applicable' ? [{
      key: 'expense' as TabKey, label: 'Expense Details', icon: 'ri-wallet-3-line',
      color: 'linear-gradient(135deg,#f06548,#ff7a5c)',
    }] : []),
    { key: 'apply_leave',label: 'Leave',           icon: 'ri-calendar-2-line',          color: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' },
    { key: 'holidays',   label: 'Holidays',        icon: 'ri-calendar-event-line',      color: 'linear-gradient(135deg,#ec4899,#f472b6)' },
    // Hiring Requests — visible when the profile owner is also the
    // viewer AND they either (a) manage at least one direct report
    // (employee-as-manager) or (b) have org-wide HR visibility
    // (branch_user / client_admin / super_admin). The list view inside
    // applies the matching visibility filter — own-raised for managers,
    // tenant-wide for the admin tiers — so each role lands on data
    // they're meant to see.
    ...(isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) ? [{
      key: 'hiring' as TabKey, label: 'Hiring Requests', icon: 'ri-user-add-line',
      color: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
    }] : []),
  ];

  // Onboarding progress as a numeric percent for the hero ring chart.
  // Profile completion % — prefer the backend's blended `profile_completion`
  // on the fetched record (the SAME source the HR list uses via apiToUiRow),
  // so the employee's own /profile view matches the HR panel. The caller only
  // passes `employee.profile` on the HR path, so without this the self-view
  // fell back to 0. Fall back: passed prop → 0.
  const profilePct = (() => {
    const backend = Number(empDetail?.profile_completion);
    if (Number.isFinite(backend)) return Math.max(0, Math.min(100, Math.round(backend)));
    return typeof employee?.profile === 'number' ? employee.profile : 0;
  })();

  // Onboarding ring — derive the stage from the fetched record the same way
  // the HR onboarding pill does, so it's consistent across both entry points.
  // Fall back to the caller-passed label, then a neutral default.
  const onboardingPct = (() => {
    const macroRaw = empDetail?.onboarding_stage_completed;
    const stepRaw  = empDetail?.wizard_step_completed;
    if (macroRaw != null || stepRaw != null) {
      const macro = Number(macroRaw) || 0;
      const step  = Number(stepRaw) || 0;
      if (macro >= 6) return 100;
      if (macro > 0 || step > 0) return 65;
      return 25;
    }
    return employee?.onboarding === 'Completed'   ? 100
         : employee?.onboarding === 'In Progress' ? 65
         : employee?.onboarding === 'Pending'     ? 25
         :                                          83;
  })();

  // Pre-compute counts and the filtered list from API rows. The list source
  // depends on the active sub-tab: "mine" → claims this employee raised,
  // "team" → claims where the current user is the assigned reporting manager.
  const activeClaimsSource: ApiClaim[] =
    expenseSubTab === 'team' ? teamClaims : apiClaims;
  const expenseCounts = {
    all:      activeClaimsSource.length,
    approved: activeClaimsSource.filter(c => c.status === 'approved').length,
    rejected: activeClaimsSource.filter(c => c.status === 'rejected').length,
    pending:  activeClaimsSource.filter(c => c.status === 'pending').length,
  };
  // Total Claimed reflects only approved claims — pending/rejected rows are
  // excluded so the hero figure represents money actually owed/reimbursed.
  const totalClaimed = activeClaimsSource
    .filter(c => c.status === 'approved')
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  // Status filter first, then the free-text search. The search matches across
  // the columns the table renders (claim no, description, category, supplier,
  // project, employee, status, amount) so a search for any visible token finds
  // the row.
  const expenseQuery = expenseSearch.trim().toLowerCase();
  const filteredExpenses: ApiClaim[] = (expenseFilter === 'all'
    ? activeClaimsSource
    : activeClaimsSource.filter(c => c.status === expenseFilter)
  ).filter(c => {
    if (!expenseQuery) return true;
    return [
      c.claim_no, c.title, c.category_name, c.vendor, c.project,
      c.employee_name, c.employee_code, c.status, c.amount,
    ].some(v => v != null && String(v).toLowerCase().includes(expenseQuery));
  });

  // Mirror counts/filtering for the Advance Requests tab so the same set
  // of filter pills (All/Approved/Rejected/Pending) drives the advance
  // table. `activeAdvancesSource` follows the My/Team sub-tab selection
  // the same way `activeClaimsSource` does for expenses.
  const baseAdvancesSource: AdvanceRequestRow[] =
    advanceSubTab === 'team' ? teamAdvances : apiAdvances;
  // Used-For tab counts (from the My/Team source, before the status filter).
  const advUsedForCounts = {
    self:    baseAdvancesSource.filter(a => (a.used_for || 'self') === 'self').length,
    company: baseAdvancesSource.filter(a => (a.used_for || 'self') === 'company').length,
  };
  // Narrow by Used For first, then the status pills / search run on this.
  const activeAdvancesSource: AdvanceRequestRow[] =
    baseAdvancesSource.filter(a => (a.used_for || 'self') === advUsedForTab);
  const advanceCounts = {
    all:      activeAdvancesSource.length,
    approved: activeAdvancesSource.filter(a => a.status === 'approved').length,
    rejected: activeAdvancesSource.filter(a => a.status === 'rejected').length,
    pending:  activeAdvancesSource.filter(a => a.status === 'pending').length,
  };
  const filteredAdvances: AdvanceRequestRow[] = (expenseFilter === 'all'
    ? activeAdvancesSource
    : activeAdvancesSource.filter(a => a.status === expenseFilter)
  ).filter(a => {
    if (!expenseQuery) return true;
    return [
      a.advance_no, a.employee_name, a.employee_code, a.advance_type,
      a.advance_type_other, a.reason, a.status, a.amount,
    ].some(v => v != null && String(v).toLowerCase().includes(expenseQuery));
  });

  // ── Export (Excel / PDF / CSV) for the active module's filtered rows ──
  // The Export button used to be a no-op (no onClick) — clicking it did
  // nothing. It's now a format picker that exports whichever list is in
  // view (expense claims or advance requests), honouring the active
  // status filter + My/Team sub-tab.
  const [exportOpen, setExportOpen] = useState(false);
  const runProfileExport = (fmt: 'xlsx' | 'pdf' | 'csv') => {
    setExportOpen(false);
    const isAdvance = expenseModuleTab === 'advance';
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${isAdvance ? 'advance-requests' : 'expense-claims'}-${profileEmpCode || 'employee'}-${stamp}`;
    const label = isAdvance ? 'Advance Requests' : 'Expense Claims';

    let header: string[];
    let rows: (string | number | null)[][];
    if (isAdvance) {
      header = ['Advance No', 'Employee', 'Emp Code', 'Type', 'Amount', 'Requested Date', 'Recovery Start', 'Recovery Mode', 'Months', 'Monthly EMI', 'Reason', 'Status', 'Manager Status', 'HR Status', 'Created At'];
      rows = filteredAdvances.map(a => [
        a.advance_no, a.employee_name, a.employee_code,
        a.advance_type === 'Other' && a.advance_type_other ? `Other · ${a.advance_type_other}` : a.advance_type,
        a.amount, a.requested_date, a.recovery_start, a.recovery_mode, a.recovery_months, a.monthly_emi,
        a.reason, a.status, a.manager_status, a.hr_status, a.created_at,
      ]);
    } else {
      header = ['Claim No', 'Employee', 'Emp Code', 'Category', 'Description', 'Expense Date', 'Amount', 'Currency', 'Supplier', 'Project', 'Payment Method', 'Status', 'Manager Status', 'HR Status', 'Created At'];
      rows = filteredExpenses.map(c => [
        c.claim_no, c.employee_name, c.employee_code, c.category_name, c.title, c.expense_date,
        c.amount, c.currency, c.vendor, c.project, c.payment_method, c.status, c.manager_status, c.hr_status, c.created_at,
      ]);
    }
    if (rows.length === 0) {
      toast.error('Nothing to export', `No ${isAdvance ? 'advance requests' : 'expense claims'} match the current filter.`);
      return;
    }
    const noun = isAdvance ? 'advance request' : 'claim';
    const done = (f: string) => toast.success('Export ready', `${rows.length} ${noun}${rows.length === 1 ? '' : 's'} exported to ${f}.`);

    if (fmt === 'csv') {
      const esc = (v: any) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
      // BOM keeps ₹ + accented names intact when opened in Excel.
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${baseName}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      done('CSV');
      return;
    }
    if (fmt === 'xlsx') {
      try {
        const ws = XLSX.utils.aoa_to_sheet([header, ...rows.map(r => r.map(v => v ?? ''))]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, label);
        XLSX.writeFile(wb, `${baseName}.xlsx`);
        done('Excel');
      } catch {
        toast.error('Export failed', 'Could not generate the Excel file. Please try again.');
      }
      return;
    }
    // pdf — open a printable HTML report; user picks "Save as PDF". Same
    // dependency-free approach used elsewhere (payslip print, HR export).
    const escHtml = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const thead = `<tr>${header.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr>`;
    const tbody = rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('');
    const title = `${label} — ${escHtml(employee?.name || profileEmpCode || '')}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(baseName)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 24px; }
        h1 { font-size: 16px; margin: 0 0 4px; }
        .meta { font-size: 11px; color: #6b7280; margin: 0 0 16px; }
        table { border-collapse: collapse; width: 100%; font-size: 9px; }
        th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
        thead th { background: #f3f4f6; font-weight: 700; }
        tbody tr:nth-child(even) { background: #fafafa; }
        @media print { @page { size: landscape; margin: 12mm; } }
      </style></head>
      <body>
        <h1>${title}</h1>
        <p class="meta">${rows.length} ${noun}(s) · generated ${escHtml(stamp)}</p>
        <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
        <script>window.onload = function () { window.focus(); window.print(); };<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Pop-up blocked', 'Allow pop-ups for this site to export as PDF.');
      return;
    }
    w.document.open(); w.document.write(html); w.document.close();
    toast.success('Print view opened', `Choose "Save as PDF" in the print dialog · ${rows.length} ${noun}${rows.length === 1 ? '' : 's'}.`);
  };

  // Snap back to the All view when the user is sitting on the Drafts pill
  // but their saved draft for the active module just got submitted /
  // discarded — otherwise they'd be stuck on a "No saved drafts" empty
  // state with no obvious way out.
  useEffect(() => {
    if (expenseFilter !== 'draft') return;
    const hasDraft = expenseModuleTab === 'advance'
      ? advanceDrafts.length > 0
      : expenseDrafts.length > 0;
    if (!hasDraft) setExpenseFilter('all');
  }, [expenseFilter, expenseModuleTab, expenseDrafts, advanceDrafts]);


  // Everything the extracted tab panels (tabs/*.tsx) read is published here and
  // consumed via useEmployeeProfile(). The hero, tab bar and modals below keep
  // using the locals directly. Grow this object (and EmployeeProfileCtx) when a
  // tab needs a new field — tsc enforces both sides stay in sync.
  const ctx: EmployeeProfileCtx = {
    employeeId, employee, displayEmpCode, initials, accent, ancillaryList,
    empDetail, empDetailLoading, setEmpDetail,
    fmtDate, fmtRupee,
    // Profile tab
    profilePct, profilePhotoSrc, profilePhotoFile, setProfilePhotoFile, savingPhoto,
    handleProfilePhotoChange, handleSaveProfilePhoto, restoreSavedProfilePhoto,
    profilePhotoInputRef, setFaceRegOpen, setPwOpen,
    // Vault tab
    vaultTab, setVaultTab, signedDocs, uploadedDocs, signedLoading, uploadedLoading,
    vaultCounts, prettyDocKey, formatBytes, setSignedPreview, downloadSignedPdf, downloadingDocId,
    // Payroll tab
    payrollTab, setPayrollTab, salaryStruct, realMonthlyGross, realAnnualCtc, realTimeline,
    openLatestPayslip, setSalaryModalOpen, setBreakdownOpen, setBreakdownRowId,
    // Expense tab
    authUser, isOwnProfile, canRaiseHrRequest,
    expenseModuleTab, setExpenseModuleTab, expenseSubTab, setExpenseSubTab,
    advanceSubTab, setAdvanceSubTab,
    advUsedForTab, setAdvUsedForTab, advUsedForCounts,
    expenseFilter, setExpenseFilter,
    expenseSearch, setExpenseSearch,
    expenseCounts, advanceCounts, totalClaimed,
    activeClaimsSource, filteredExpenses, activeAdvancesSource,
    apiClaims, teamClaims, apiAdvances, teamAdvances,
    loadingClaims, loadingAdvances, refreshClaims, refreshAdvances,
    actOnClaim, actOnAdvance, claimCategories, expenseDrafts, advanceDrafts,
    claimDraftKey, advanceDraftKey,
    setClaimOpen, setClaimMode, setEditingDraftId, setResumeFromDraft,
    openReimbursement,
    exportOpen, setExportOpen,
    // Hiring tab
    hiringRequests, hiringLoading, setRaiseHiringOpen, setHiringEditing, setHiringViewing, teamSize,
    // Other shared (Profile/Vault/Expense)
    resetPwForm, employeeDocCount, organizationalDocCount,
    runProfileExport, readSavedDrafts, filteredAdvances,
  };

  return (
    <EmployeeProfileProvider value={ctx}>
    {/* Inject the shared master form theme so MasterSelect / MasterDatePicker
        used inside the modals pick up the same look as the master forms. */}
    <MasterFormStyles />
    <div className="ep-fullscreen-overlay">

      {/* ── Hero banner ── */}
      <div className="ep-hero">
        <button type="button" className="ep-close-btn" onClick={onBack} aria-label="Close">
          <i className="ri-close-line ep-fs-20" />
        </button>

        <Row className="g-4 align-items-center ep-rel-z2 ep-hero-row">
          {/* Avatar */}
          <Col xs="auto">
            {profilePhotoSrc ? (
              <img
                src={profilePhotoSrc}
                alt={employee?.name || 'employee'}
                className="ep-avatar-square ep-avatar-img-fill"
              />
            ) : (
              <div className="ep-avatar-square">{initials}</div>
            )}
          </Col>

          {/* Identity — `col` (no xs=12) so it sits BESIDE the avatar at every
              breakpoint, including mobile (was xs=12 → wrapped under the photo). */}
          <Col className="min-w-0">
            <div className="d-flex align-items-center gap-2 mb-1">
              <h2 className="text-white mb-0 fw-bold ep-fs-22 ep-line-115">{employee?.name || employeeId}</h2>
            </div>
            {/* Employee code + role / status badges share one line so the
                identity reads compactly (was: code, then badges on a row of
                their own below the subline). */}
            <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
              <p className="mb-0 ep-hero-empcode">{displayEmpCode}</p>
              {(empDetail?.primary_role?.name || employee?.primaryRole) && (
                <span className="ep-hero-pill ep-hero-pill-blue">
                  <i className="ri-suitcase-line" /> {empDetail?.primary_role?.name || employee?.primaryRole}
                </span>
              )}
              {ancillaryList.map(r => (
                <span key={r} className="ep-hero-pill ep-hero-pill-teal">{r}</span>
              ))}
              <span className="ep-hero-pill ep-hero-pill-active">
                <span className="ep-hero-status-dot" />
                {statusTone.label}
              </span>
            </div>
            <p className="mb-2 ep-hero-subline">
              {/* Hero meta line — prefer the freshly-fetched empDetail
                  relations so newly-edited Department / Designation / work
                  type are reflected immediately, instead of the stale
                  navigation-state row that previously fell back to
                  hardcoded "Accounts" / "Associate Engineer" / "Full-time". */}
              {empDetail?.department?.name || asName(employee?.department) || '—'}
              <span className="mx-2 ep-opacity-50">·</span>
              {empDetail?.designation?.name || asName(employee?.designation) || '—'}
              <span className="mx-2 ep-opacity-50">·</span>
              {empDetail?.worker_type || empDetail?.work_type || empDetail?.time_type || '—'}
            </p>
            <div className="d-flex column-gap-4 row-gap-2 flex-wrap">
              {/* Each meta cell renders a thin shimmer placeholder until
                  empDetail resolves — keeps the row from flashing "—" /
                  partial data on first render. */}
              <div className="ep-hero-meta">
                <i className="ri-mail-line" />
                <div>
                  <span className="ep-hero-meta-label">Email</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={150} className="ep-hero-shimmer" />
                    : <span className="ep-hero-meta-value">{empDetail?.email || employee?.email || '—'}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-user-line" />
                <div>
                  <span className="ep-hero-meta-label">Manager</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={120} className="ep-hero-shimmer" />
                    : <span className="ep-hero-meta-value">{(() => {
                        const m = empDetail?.reporting_manager;
                        if (!m) return employee?.manager || '—';
                        return m.display_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ') || '—';
                      })()}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-phone-line" />
                <div>
                  <span className="ep-hero-meta-label">Mobile</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={100} className="ep-hero-shimmer" />
                    : <span className="ep-hero-meta-value">{empDetail?.mobile || '—'}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-calendar-line" />
                <div>
                  <span className="ep-hero-meta-label">Joined</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={90} className="ep-hero-shimmer" />
                    : <span className="ep-hero-meta-value">{empDetail?.date_of_joining ? fmtDate(empDetail.date_of_joining) : '—'}</span>}
                </div>
              </div>
            </div>
          </Col>

          {/* Ring charts — pulled in toward the centre with auto-margin.
              xs=12 so on mobile they drop to their own full-width row below the
              avatar+identity (centred via .ep-rings-col) instead of crowding
              the name beside the photo. */}
          <Col xs={12} md="auto" className="ms-md-auto ep-mr-80 ep-rings-col">
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
                  <span className="ep-tabbar-icon" style={{ ['--ep-tab-color' as any]: t.color }}>
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
      {tab === 'profile' && <ProfileTab />}

      {/* ── Tab: Job Details ── */}
      {tab === 'job' && <JobTab />}

      {/* ── Tab: Attendance — LIVE (face-driven, multi-punch). The
           ComingSoonShell wrapper was removed; the panel below renders
           real /api/attendance/employee/{id}/summary data. ── */}
      {tab === 'attendance' && (
        <AttendanceTab employeeId={employeeId} />
      )}


      {/* ── Tab: Evidence Vault ── */}
      {tab === 'vault' && <VaultTab />}

      {/* ── Tab: Payroll Details (live — backend wired) ── */}
      {tab === 'payroll' && <PayrollTab />}

      {/* ── Tab: Expense Details ── */}
      {tab === 'expense' && <ExpenseTab />}

      {/* ── Tab: Leave (clean Keka-style flow) ──
           LeaveSummaryPanel owns the whole experience now: the "Request
           Leave" button at the top opens a compact modal, the Pending /
           History rows are clickable to open the read-only details modal,
           and the donut cards show per-type balances inline. The old
           7-stage ApplyLeavePanel wizard is no longer rendered — kept in
           the file for now in case we want to re-introduce a "detailed
           application" entry point later. */}
      {tab === 'apply_leave' && (
        <div className="ep-tab-fill">
          <LeaveSummaryPanel
            employeeId={empDetail?.id != null ? String(empDetail.id) : (profileEmpIdNum != null ? String(profileEmpIdNum) : '')}
            canRequest={canRaiseHrRequest}
            probationEndDate={(empDetail as any)?.probation_end_date ?? null}
          />
        </div>
      )}

      {/* ── Holidays tab — read-only view of the employee's assigned Holiday
           Calendar (Holiday Group). Live-fetched per year from
           /employees/{id}/holidays, so changes to the assigned calendar reflect
           automatically. List + Calendar views inside the panel. */}
      {tab === 'holidays' && (
        <div className="ep-tab-fill">
          <div className="ep-section-card-flat ep-section-card mb-3 h-100 d-flex flex-column">
            <div className="px-3 py-3 flex-grow-1">
              <HolidayCalendarPanel employeeId={employeeId} />
            </div>
          </div>
        </div>
      )}

      {/* ── Hiring Requests tab — manager-only. Mirrors HrRecruitment's
           hiring-request surface (KPI strip + list table + Raise CTA),
           scoped to the requests THIS manager raised. Reuses the
           existing RaiseHiringRequestModal + HiringRequestsListModal
           components so the create form, validation and list filters
           stay in one place. */}
      {tab === 'hiring' && isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) && <HiringTab />}

      </div>
    </div>

    {/* ── Attendance Regularization Modal ── */}
    <EpModal open={regOpen} onClose={() => setRegOpen(false)} size="md" panelClassName="ep-reg-modal">

        <div className="ep-reg-header">
          <h5>Request Attendance Regularization</h5>
          {/* No top-right X — footer has Cancel; one dismiss path. */}
        </div>

        <div className="ep-reg-body">
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
                className="d-none"
              />
              <span>Add/update time entries to adjust attendance logs.</span>
            </label>
            <label className={`ep-reg-radio${regOption === 'exempt' ? ' is-on' : ''}`}>
              <span className="ep-reg-radio-dot" />
              <input
                type="radio"
                checked={regOption === 'exempt'}
                onChange={() => setRegOption('exempt')}
                className="d-none"
              />
              <span>Raise regularization request to exempt this day from penalization policy.</span>
            </label>
          </div>
          <small className="text-muted d-block mb-3 ep-fs-12">
            Click and select time stamp box that you would like to adjust and make changes to the time
          </small>

          {regOption === 'adjust' && (
            <>
              {/* Attendance Adjustment header + Add Log */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="mb-0 fw-bold ep-fs-12">Attendance Adjustment</h6>
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
                <div className="ep-reg-label ep-mb-0i">
                  Work Location <span className="ep-reg-req">*</span>
                </div>
                <small className="text-muted ep-fs-11">Select all that apply</small>
              </div>
              {regLocations.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {regLocations.map(loc => (
                    <span key={loc} className="ep-reg-chip">
                      <span className="ep-reg-chip-dot" />
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
              <small className="text-muted d-block mb-3 ep-fs-11">
                Select your work location(s) for this correction request
              </small>

              {/* Time-entry rows */}
              <div className="d-flex flex-column gap-2 mb-3">
                {regLogs.map(log => (
                  <div className="ep-reg-log-row" key={log.id}>
                    <i className="ri-checkbox-circle-fill ep-reg-log-check" />
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
            <h6 className="fw-bold mb-2 ep-fs-14">Note</h6>
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
      {/* Payslip viewer — real data via the shared PayslipViewerModal
          (replaces the old inline mock). Driven by the employee's real
          payslip history + the rendered PDF. */}
      <PayslipViewerModal
        open={paySlipOpen}
        onClose={() => { setPaySlipOpen(false); setViewSlip(null); }}
        employee={{
          name: empDetail?.display_name || employee?.name || String(employeeId),
          empId: empDetail?.emp_code || String(employeeId),
          designation: empDetail?.designation_name || asName(empDetail?.designation) || '—',
          department: empDetail?.department_name || asName(empDetail?.department) || '—',
        }}
        defaultMonth={viewSlip?.month || 'March'}
        defaultYear={viewSlip?.year || String(new Date().getFullYear())}
        earnings={viewSlip?.earnings || []}
        deductions={viewSlip?.deductions || []}
        workingDays={viewSlip?.working}
        daysPresent={viewSlip?.present}
        paidDays={viewSlip?.paid}
        lossOfPay={viewSlip?.lop}
        isFinal={viewSlip?.isFinal}
        payslipId={viewSlip?.id}
        recentMonths={payslipHistory.map((s: any, i: number) => ({ label: s.label, now: i === 0, payslipId: s.payslip_id, status: s.status }))}
        onSelectRecent={(e: any) => loadSlip(e.payslipId, e.label)}
        companyName={viewSlip?.company?.name || undefined}
        companyMeta={viewSlip?.company?.address || undefined}
        companyInitials={viewSlip?.company?.initials || undefined}
        hrEmail={viewSlip?.company?.hr_email || undefined}
      />

      {/* Revise Salary uses the real SalaryStructureModal (rendered above); old mock modal removed. */}

      {/* ── Salary Breakdown Modal ── */}
      <EpModal open={breakdownOpen} onClose={() => setBreakdownOpen(false)} size="lg" panelClassName="ep-bd-modal">
        <div className="ep-bd-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div className="ep-bd-eyebrow">SALARY DETAILS</div>
              <h4 className="text-white fw-bold mb-1 ep-fs-20">
                Salary Breakdown for{' '}
                <span className="ep-bd-annum">₹{breakdownRow.annual.toLocaleString('en-IN')} / Annum</span>
              </h4>
              <small className="ep-bd-subhead">
                Pay Group: <strong>Default</strong> · Structure: <strong>Class A</strong> · Effective: <strong>{breakdownRow.dateShort}</strong>
              </small>
            </div>
            <button type="button" className="ep-bd-close" onClick={() => setBreakdownOpen(false)} aria-label="Close">
              <i className="ri-close-line ep-fs-18" />
            </button>
          </div>
        </div>

        <div className="ep-bd-body">
          <div className="ep-bd-main">
            <div className="ep-bd-card">
              <div className="d-flex align-items-center gap-2 px-3 py-2 ep-bd-card-head">
                <span className="ep-rev-icon ep-bd-icon-emerald">
                  <i className="ri-line-chart-line" />
                </span>
                <h6 className="mb-0 fw-bold ep-fs-13">Earnings Breakdown</h6>
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
                  {breakdownData.rows.map((r: any) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.monthly.toLocaleString('en-IN')}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.annual.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="ep-bd-total-row">
                    <td className="fw-bold ep-bd-total-cell">Total Earnings</td>
                    <td className="text-end fw-bold font-monospace ep-bd-total-cell">₹{breakdownData.totalMonthly.toLocaleString('en-IN')}</td>
                    <td className="text-end fw-bold font-monospace ep-bd-total-cell">₹{breakdownData.totalAnnual.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              </table>

              <div className="ep-bd-net">
                <div>
                  <div className="ep-bd-eyebrow-net">AFTER TAX & DEDUCTIONS</div>
                  <h5 className="text-white fw-bold mb-0 ep-fs-16">NET PAY</h5>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0 ep-fs-32">₹{breakdownData.netPay.toLocaleString('en-IN')}</h2>
                  <small className="ep-bd-white78">per month (estimated)</small>
                </div>
              </div>
            </div>

            <div className="ep-bd-note">
              <i className="ri-information-line ep-bd-note-icon" />
              <div>
                <strong>Note:</strong> Net Pay excludes applicable taxes (TDS) and statutory deductions (PF, PT). Actual disbursement may vary based on declarations and investments.
              </div>
            </div>
          </div>

          {/* Version history */}
          <aside className="ep-bd-history">
            <div className="d-flex align-items-center gap-2 mb-3">
              <i className="ri-history-line ep-bd-history-icon" />
              <h6 className="mb-0 fw-bold">Version History</h6>
            </div>
            <div className="position-relative ep-pl-22">
              <div className="ep-bd-history-line" />
              {(realTimeline.length ? realTimeline : SALARY_TIMELINE).map(s => {
                const active = s.id === breakdownRow.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ep-bd-version${active ? ' is-current' : ''}`}
                    onClick={() => setBreakdownRowId(s.id)}
                  >
                    <span className={`ep-bd-dot ${active ? 'ep-bd-dot-active' : 'ep-bd-dot-inactive'}`}>
                      {active && <span className="ep-bd-dot-pip" />}
                    </span>
                    <div className="flex-grow-1 min-w-0 text-start">
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <small className="fw-semibold">{s.dateShort}</small>
                        {s.current && <span className="ep-bd-now">CURRENT</span>}
                      </div>
                      <div className={`fw-bold ${active ? 'ep-bd-amount-active' : 'ep-bd-amount-inactive'}`}>
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
                <h5 className="text-white fw-bold mb-0 ep-fs-14">
                  {claimMode === 'expense' ? 'Submit New Expense Claim' : 'Advance Request — Recoverable Payout'}
                </h5>
                <small className="ep-claim-hero-sub">
                  {/* "Receipt required above ₹500" removed from both Expense and
                      Advance headers per QA — it isn't a valid rule here. */}
                  All required fields must be completed · Changes take effect after approval flow completes
                </small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="ep-claim-mode-pill">
                {claimMode === 'expense' ? 'EXPENSE MODE' : 'ADVANCE MODE'}
              </span>
              <button type="button" className="ep-claim-x" onClick={() => setClaimOpen(false)} aria-label="Close">
                <i className="ri-close-line ep-fs-14" />
              </button>
            </div>
          </div>

          {/* Flow hint — mode is already chosen by the outer Expense /
              Advance module pill (which decides which form opens), so the
              in-modal tab row was redundant and has been removed. */}
          <div className="d-flex align-items-center justify-content-end flex-wrap gap-2 mt-2">
            <small className="ep-claim-hero-hint">
              {claimMode === 'expense'
                ? <>Expense → <strong>Reimbursement</strong></>
                : advUsedFor === 'company'
                  ? <>Advance → <strong>Company Expense</strong></>
                  : <>Advance → <strong>Payroll Recovery</strong></>}
            </small>
          </div>
        </div>

        {/* Body — frozen while the claim is being saved: `inert` blocks mouse,
            keyboard and focus across the whole form subtree (React 19) so no
            field can be edited mid-submit, and the dimmed/wait cursor signals
            it. Footer buttons handle their own disabled state below. */}
        <div
          className="ep-claim-body"
          inert={claimSubmitting}
          style={claimSubmitting ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
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
                      onChange={(v) => { setClaimCategory(v); clearClaimErr('category'); }}
                      invalid={!!claimErrors.category}
                    />
                    {claimErrors.category && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.category}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Currency</div>
                    <MasterSelect
                      value={claimCurrency}
                      placeholder="Select currency"
                      options={[{ value: 'INR', label: '₹ INR' }]}
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
                      placeholder="Select payment method"
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
                  <input
                    className={`ep-claim-input${claimErrors.title ? ' is-invalid' : ''}`}
                    placeholder="Brief description of expense..."
                    value={claimTitle}
                    onChange={e => { setClaimTitle(e.target.value); clearClaimErr('title'); }}
                  />
                  {claimErrors.title && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.title}</div>}
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Amount ({claimCurrencySymbol}) <span className="ep-claim-req">*</span>{reimburseCtx && <span style={{ fontWeight: 500, color: '#0e7490' }}> · max ₹{reimburseCtx.balance.toLocaleString('en-IN')} (reimbursement)</span>}</div>
                    <div className="position-relative">
                      <span className="ep-claim-amount-prefix">{claimCurrencySymbol}</span>
                      <input
                        className={`ep-claim-input ep-pl-28${claimErrors.amount ? ' is-invalid' : ''}`}
                        placeholder="0.00"
                        value={claimAmount}
                        inputMode="decimal"
                        onChange={e => {
                          // Sanitise the input as the user types — only digits +
                          // one dot, cap the whole part at 12 digits and fraction
                          // at 2. The DB column is decimal(18,2) so 12+2 fits
                          // comfortably; without this cap a paste of a long
                          // number used to slip through and crash the backend
                          // with a "numeric field overflow" SQL error.
                          let raw = e.target.value.replace(/[^0-9.]/g, '');
                          const firstDot = raw.indexOf('.');
                          if (firstDot !== -1) {
                            raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
                          }
                          const [whole, frac] = raw.split('.');
                          let capped = (whole || '').slice(0, 12);
                          if (frac !== undefined) capped += '.' + frac.slice(0, 2);
                          // Reimbursement: never let the amount exceed the balance.
                          if (reimburseCtx && (Number(capped) || 0) > reimburseCtx.balance) {
                            capped = String(reimburseCtx.balance);
                          }
                          setClaimAmount(capped);
                          clearClaimErr('amount');
                        }}
                      />
                    </div>
                    {claimErrors.amount && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.amount}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Expense Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={claimDate}
                      onChange={(v) => { setClaimDate(v); clearClaimErr('date'); }}
                      invalid={!!claimErrors.date}
                      // No future dates; only the last 30 days are claimable.
                      minDate={new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)}
                      maxDate={new Date().toISOString().slice(0, 10)}
                    />
                    {claimErrors.date && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.date}</div>}
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Supplier / Merchant</div>
                  <input className="ep-claim-input" placeholder="Supplier name (optional)" value={claimVendor} onChange={e => setClaimVendor(e.target.value)} />
                </div>
                <div className="mb-0">
                  <div className="ep-claim-label">Business Purpose <span className="ep-claim-req">*</span></div>
                  <textarea
                    className={`ep-claim-input${claimErrors.purpose ? ' is-invalid' : ''}`}
                    rows={3}
                    placeholder="Explain the business purpose..."
                    value={claimPurpose}
                    onChange={e => { setClaimPurpose(e.target.value); clearClaimErr('purpose'); }}
                  />
                  {claimErrors.purpose && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.purpose}</div>}
                </div>
              </Col>

              {/* Right column */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> C — Proof &amp; Receipt
                  <span className="text-danger ms-1">*</span>
                </div>
                <label
                  className={`ep-claim-upload mb-2 d-block ep-claim-upload-cursor${claimErrors.files ? ' is-invalid' : ''}`}
                >
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="d-none"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      const { accepted, errors } = filterValidUploads(picked);
                      if (errors.length) toast.error('Some files were not added', errors.slice(0, 3).join(' · '));
                      if (accepted.length) { setClaimFiles(prev => [...prev, ...accepted]); clearClaimErr('files'); }
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon">
                    <i className="ri-upload-2-line" />
                  </span>
                  <div className="fw-semibold ep-fs-13">Click to upload or drag &amp; drop</div>
                  <small className="text-muted ep-fs-115">PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
                </label>
                {claimErrors.files && (
                  <div className="ep-claim-err mb-2"><i className="ri-error-warning-line" />{claimErrors.files}</div>
                )}
                {claimFiles.length > 0 && (
                  <div className="ep-claim-file-list mb-4">
                    {claimFiles.map((f, i) => (
                      <div key={i} className="ep-claim-file-row">
                        <i className="ri-attachment-2 ep-claim-file-icon" />
                        <div className="ep-claim-file-meta">
                          <div className="ep-claim-file-name">{f.name}</div>
                          <div className="ep-claim-file-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        {/* View — opens the just-picked file in a new tab
                            using an object URL so the user can sanity-check
                            their receipt before submitting. The URL is
                            revoked after a short delay so the new tab has
                            time to load it without leaking memory. */}
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          title="View"
                          onClick={() => {
                            try {
                              const url = URL.createObjectURL(f);
                              window.open(url, '_blank', 'noopener,noreferrer');
                              setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            } catch {
                              toast.error('Could not open file', 'Your browser blocked the preview.');
                            }
                          }}
                        >
                          <i className="ri-eye-line" />
                        </button>
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
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-indigo">
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-emerald">
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-amber">
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
                    <h6 className="mb-1 fw-bold ep-claim-banner-title">Advance Request — Recoverable Payout</h6>
                    <small className="ep-claim-banner-sub">{advUsedFor === 'company' ? 'Company-paid advance · not recovered from salary · Approval flow required' : 'Amount will be recovered through payroll deduction · Approval flow required'}</small>
                  </div>
                  <span className="ep-claim-flow-pill">APPROVAL FLOW</span>
                </div>

                {/* Employee + Used For share one 50-50 row. Used For: Self is the
                    recoverable-from-salary flow; Company is spent for the company
                    and is NOT recovered (recovery mode hidden; the date becomes an
                    Expected Use Date). */}
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Employee <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={claimEmployee || employeeId}
                      placeholder="Select employee"
                      disabled
                      options={[{ value: employeeId, label: `${employee?.name || 'Aarav Patel'} (${employeeId})` }]}
                      onChange={setClaimEmployee}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Used For <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={advUsedFor}
                      placeholder="Select..."
                      options={[
                        { value: 'self',    label: 'Self used' },
                        { value: 'company', label: 'Company used' },
                      ]}
                      onChange={(v) => {
                        setAdvUsedFor(v);
                        // Switching to Company drops any recovery-mode selection so a
                        // stale EMI schedule can't tag along.
                        if (v === 'company') { setAdvRecoveryMode(''); setAdvMonths(''); setAdvMonthlyEmi(''); }
                        clearAdvErr('recovery_mode'); clearAdvErr('recovery_start');
                      }}
                    />
                  </Col>
                </Row>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Advance Type <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={advType}
                      placeholder="Select type..."
                      options={['Travel Advance','Salary Advance','Medical Advance','Other'].map(o => ({ value: o, label: o }))}
                      onChange={(v) => { setAdvType(v); clearAdvErr('type'); }}
                      invalid={!!advErrors.type}
                    />
                    {advErrors.type && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.type}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span className="ep-claim-amount-prefix">₹</span>
                      <input
                        className={`ep-claim-input ep-pl-28${advErrors.amount ? ' is-invalid' : ''}`}
                        placeholder="0"
                        inputMode="decimal"
                        value={advAmount}
                        // Numbers only — strip letters/symbols on the way in and
                        // keep at most one decimal point so the field can never
                        // hold "1122@sss". The submit validation re-checks too.
                        onChange={e => {
                          let v = e.target.value.replace(/[^\d.]/g, '');
                          const i = v.indexOf('.');
                          if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
                          setAdvAmount(v);
                          clearAdvErr('amount');
                        }}
                      />
                    </div>
                    {advErrors.amount && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.amount}</div>}
                  </Col>
                </Row>
                {/* "Other" advance type — free-text input appears only when the
                    user picks Other so the dropdown stays uncluttered for the
                    common cases. */}
                {advType === 'Other' && (
                  <div className="mb-3">
                    <div className="ep-claim-label">Specify Advance Type <span className="ep-claim-req">*</span></div>
                    <input
                      className={`ep-claim-input${advErrors.type_other ? ' is-invalid' : ''}`}
                      placeholder="e.g. Conference Registration, Education Loan…"
                      value={advTypeOther}
                      onChange={e => { setAdvTypeOther(e.target.value); clearAdvErr('type_other'); }}
                    />
                    {advErrors.type_other && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.type_other}</div>}
                  </div>
                )}
                <Row className="g-3 mb-3">
                  <Col md={advUsedFor === 'company' ? 12 : 6}>
                    <div className="ep-claim-label">Requested Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={advRequestedDate}
                      onChange={(v) => { setAdvRequestedDate(v); clearAdvErr('requested'); }}
                      invalid={!!advErrors.requested}
                      // Requested date IS the request's creation date — locked to
                      // today. No future (or past): only today is selectable.
                      minDate={new Date().toISOString().slice(0, 10)}
                      maxDate={new Date().toISOString().slice(0, 10)}
                    />
                    {advErrors.requested && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.requested}</div>}
                  </Col>
                  {/* Recovery Start applies to a self advance only — a company
                      advance has no recovery and no expected-use date. */}
                  {advUsedFor !== 'company' && (
                  <Col md={6}>
                    <div className="ep-claim-label">Recovery Start <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={advRecoveryStart}
                      onChange={(v) => { setAdvRecoveryStart(v); clearAdvErr('recovery_start'); }}
                      invalid={!!advErrors.recovery_start}
                      minDate={advRequestedDate || new Date().toISOString().slice(0, 10)}
                    />
                    {advErrors.recovery_start && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.recovery_start}</div>}
                  </Col>
                  )}
                </Row>
                {/* Recovery Mode only applies to a self advance — a company
                    advance isn't recovered from salary, so it's hidden entirely. */}
                {advUsedFor !== 'company' && (
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
                    onChange={(v) => { setAdvRecoveryMode(v); clearAdvErr('recovery_mode'); }}
                    invalid={!!advErrors.recovery_mode}
                  />
                  {advErrors.recovery_mode && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.recovery_mode}</div>}
                </div>
                )}
                {/* Months + computed EMI only make sense for EMI mode — hide
                    them for lump sum / bi-monthly so the form stays tight. */}
                {advRecoveryMode === 'emi' && (
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <div className="ep-claim-label">No. of Months <span className="ep-claim-req">*</span></div>
                      <input
                        className={`ep-claim-input${advErrors.months ? ' is-invalid' : ''}`}
                        placeholder="e.g. 6"
                        value={advMonths}
                        onChange={e => { setAdvMonths(e.target.value); clearAdvErr('months'); }}
                      />
                      {advErrors.months && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.months}</div>}
                    </Col>
                    <Col md={6}>
                      <div className="ep-claim-label">Monthly EMI</div>
                      <div className="position-relative">
                        <span className="ep-claim-amount-prefix">₹</span>
                        <input
                          className="ep-claim-input ep-pl-28"
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
                  <textarea
                    className={`ep-claim-input${advErrors.reason ? ' is-invalid' : ''}`}
                    rows={3}
                    maxLength={500}
                    placeholder="Describe why this advance is needed..."
                    value={advReason}
                    onChange={e => { setAdvReason(e.target.value.slice(0, 500)); clearAdvErr('reason'); }}
                  />
                  <div style={{ textAlign: 'right', fontSize: 11, color: advReason.length >= 500 ? '#ef4444' : 'var(--vz-secondary-color, #6b7280)', marginTop: 2 }}>{advReason.length}/500</div>
                  {advErrors.reason && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.reason}</div>}
                </div>
              </Col>

              {/* Right column — Supporting Documents (multi-file) + Approval Flow.
                  Replaces the old Payroll Recovery Preview / Advance Intelligence
                  placeholders, which weren't wired to anything actionable. */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> Supporting Documents
                </div>
                <label className="ep-claim-upload mb-2 d-block ep-claim-upload-indigo">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="d-none"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      const { accepted, errors } = filterValidUploads(picked);
                      if (errors.length) toast.error('Some files were not added', errors.slice(0, 3).join(' · '));
                      if (accepted.length) setAdvFiles(prev => [...prev, ...accepted]);
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon ep-claim-upload-icon-indigo">
                    <i className="ri-attachment-line" />
                  </span>
                  <div className="fw-semibold ep-claim-upload-title-indigo">Attach documents (bank letter, itinerary…)</div>
                  <small className="text-muted ep-fs-115">PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
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
                          title="View"
                          onClick={() => {
                            try {
                              const url = URL.createObjectURL(f);
                              window.open(url, '_blank', 'noopener,noreferrer');
                              setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            } catch {
                              toast.error('Could not open file', 'Your browser blocked the preview.');
                            }
                          }}
                        >
                          <i className="ri-eye-line" />
                        </button>
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
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-indigo">
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-emerald">
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon ep-claim-flow-icon-amber">
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
                    {advUsedFor === 'company'
                      ? 'This advance is spent on the company’s behalf and is not recovered from your salary. Original record is immutable after approval.'
                      : 'This creates a recoverable liability entry. The advance will be deducted from your salary per the selected schedule. Original record is immutable after approval.'}
                  </div>
                </div>
              </Col>
            </Row>
          )}
        </div>

        {/* Footer — every action is locked while a submit is in flight
            so the user can't close the modal, stage another draft, or
            (most importantly) re-fire the submit before the first one
            returns. */}
        <div className="ep-claim-footer">
          <button type="button" className="ep-claim-cancel" onClick={() => setClaimOpen(false)} disabled={claimSubmitting}>Cancel</button>
          <div className="d-flex gap-2 ms-auto">
            {!reimburseCtx && (
              <button type="button" className="ep-claim-secondary" onClick={handleSaveDraft} disabled={claimSubmitting}>
                <i className="ri-save-line me-1" /> Save Draft
              </button>
            )}
            {claimMode === 'expense' && !reimburseCtx && (
              <button type="button" className="ep-claim-secondary" onClick={saveAndAddAnother} disabled={claimSubmitting}>
                <i className="ri-add-line me-1" /> Save &amp; Add Another
              </button>
            )}
            <button
              type="button"
              className={`ep-claim-submit${claimSubmitting ? ' ep-claim-submit-busy' : ''}`}
              onClick={claimMode === 'expense' ? submitAllDrafts : submitAdvanceRequest}
              disabled={claimSubmitting}
            >
              {claimSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-1 ep-claim-spinner-sm" role="status" aria-hidden="true" />
                  Submitting…
                </>
              ) : (
                <>
                  <i className={claimMode === 'expense' ? 'ri-send-plane-line me-1' : 'ri-send-plane-fill me-1'} />
                  {claimMode === 'expense'
                    ? (claimDrafts.length > 1 ? `Submit ${claimDrafts.length} Claims` : 'Submit Claim')
                    : 'Submit Advance Request'}
                </>
              )}
            </button>
          </div>
        </div>
      </EpModal>
      <EpModal open={pwOpen} onClose={() => { if (!pwSaving) { setPwOpen(false); resetPwForm(); } }} size="sm">
        {/* Header — gradient banner so the dialog reads as a distinct
            "Security" surface, not just a plain card. */}
        <div
          className="d-flex align-items-center justify-content-between px-3 py-3 ep-pw-header"
        >
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 ep-pw-badge"
            >
              <i className="ri-lock-password-line ep-fs-18" />
            </span>
            <div>
              <h6 className="mb-0 fw-bold ep-fs-14">{isOwnProfile ? 'Change Password' : 'Reset Employee Password'}</h6>
              <small className="text-muted ep-fs-11">
                {isOwnProfile
                  ? 'Pick a strong, unique password'
                  : `Set a new login password for ${employee?.name || 'this employee'}`}
              </small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-light btn-sm rounded-circle d-inline-flex align-items-center justify-content-center ep-pw-close"
            onClick={() => { if (!pwSaving) { setPwOpen(false); resetPwForm(); } }}
            disabled={pwSaving}
            aria-label="Close"
          >
            <i className="ri-close-line" />
          </button>
        </div>
        <div className="px-3 py-3">
          {/* Current Password — only for self-service. An admin resetting
              another employee's password doesn't know (and shouldn't need)
              their current one. */}
          {isOwnProfile && (
          <div className="mb-3">
            <label className="emp-label fw-semibold ep-fs-12">Current Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.cur ? 'text' : 'password'}
                className={`form-control ep-pw-input${pwErrors.current_password ? ' is-invalid' : ''}`}
                value={pwCurrent}
                onChange={e => { setPwCurrent(e.target.value); if (pwErrors.current_password) setPwErrors(p => ({ ...p, current_password: '' })); }}
                placeholder="Enter your current password"
                autoComplete="current-password"
                disabled={pwSaving}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute ep-pw-eye"
                onClick={() => setPwShow(s => ({ ...s, cur: !s.cur }))}
                tabIndex={-1}
                aria-label={pwShow.cur ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.cur ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.current_password && <small className="text-danger d-block mt-1 ep-fs-11">{pwErrors.current_password}</small>}
          </div>
          )}

          {/* New Password */}
          <div className="mb-3">
            <label className="emp-label fw-semibold ep-fs-12">New Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.nw ? 'text' : 'password'}
                className={`form-control ep-pw-input${pwErrors.password ? ' is-invalid' : ''}`}
                value={pwNew}
                onChange={e => { setPwNew(e.target.value); if (pwErrors.password) setPwErrors(p => ({ ...p, password: '' })); }}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                disabled={pwSaving}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute ep-pw-eye"
                onClick={() => setPwShow(s => ({ ...s, nw: !s.nw }))}
                tabIndex={-1}
                aria-label={pwShow.nw ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.nw ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.password && <small className="text-danger d-block mt-1 ep-fs-11">{pwErrors.password}</small>}
            {/* Strength meter + rule checklist. The bar + label only show
                once the user starts typing (no point grading an empty
                field), but the checklist below stays visible upfront so
                users see exactly what a "strong" password needs — same
                pattern as the Reset Password / Forgot Password flows. */}
            <div className="mt-2">
              {pwNew && (
                <div className="d-flex align-items-center gap-2 mb-1">
                  <div className="ep-pw-strength-track">
                    <div
                      className="ep-pw-strength-fill"
                      style={{
                        ['--ep-pw-fill' as any]: `${(pwStrength.level / 5) * 100}%`,
                        ['--ep-pw-bar' as any]: pwStrength.barColor,
                      }}
                    />
                  </div>
                  <span className={`fw-bold ep-pw-strength-label ${pwStrength.barTextClass}`}>
                    {pwStrength.text}
                  </span>
                </div>
              )}
              <ul className="list-unstyled mb-0 mt-1 ep-fs-11">
                {PW_RULES.map(rule => {
                  const passed = !!pwNew && !validatePwRules(pwNew).includes(rule);
                  return (
                    <li key={rule} className={`d-inline-flex align-items-center gap-1 me-3 ${passed ? 'text-success fw-semibold' : 'text-muted'}`}>
                      <i className={`${passed ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} ep-fs-12`} />
                      {rule}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Confirm New Password */}
          <div className="mb-2">
            <label className="emp-label fw-semibold ep-fs-12">Confirm New Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.cf ? 'text' : 'password'}
                className={`form-control ep-pw-input${pwErrors.password_confirmation ? ' is-invalid' : ''}`}
                value={pwConfirm}
                onChange={e => { setPwConfirm(e.target.value); if (pwErrors.password_confirmation) setPwErrors(p => ({ ...p, password_confirmation: '' })); }}
                placeholder="Re-enter the new password"
                autoComplete="new-password"
                disabled={pwSaving}
                onKeyDown={e => { if (e.key === 'Enter' && !pwSaving) handleChangePassword(); }}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute ep-pw-eye"
                onClick={() => setPwShow(s => ({ ...s, cf: !s.cf }))}
                tabIndex={-1}
                aria-label={pwShow.cf ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.cf ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.password_confirmation && <small className="text-danger d-block mt-1 ep-fs-11">{pwErrors.password_confirmation}</small>}
            {/* Live match indicator — keeps users from racing each other to
                Submit before realising they typo'd the confirmation. */}
            {pwConfirm && (
              <div className="mt-2 d-inline-flex align-items-center gap-1 ep-fs-11">
                {pwNew === pwConfirm ? (
                  <span className="text-success d-inline-flex align-items-center gap-1 fw-semibold">
                    <i className="ri-checkbox-circle-fill ep-fs-12" /> Passwords match
                  </span>
                ) : (
                  <span className="text-danger d-inline-flex align-items-center gap-1 fw-semibold">
                    <i className="ri-close-circle-fill ep-fs-12" /> Passwords do not match
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div
          className="d-flex justify-content-end gap-2 px-3 py-3 ep-pw-footer"
        >
          <button
            type="button"
            className="btn fw-semibold rounded-pill ep-pw-cancel"
            onClick={() => { setPwOpen(false); resetPwForm(); }}
            disabled={pwSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold rounded-pill ep-pw-submit"
            onClick={handleChangePassword}
            disabled={pwSaving}
          >
            {pwSaving ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Updating…
              </>
            ) : (
              <>
                <i className="ri-shield-check-line ep-fs-14" />
                Update Password
              </>
            )}
          </button>
        </div>
      </EpModal>

      {/* WhatsApp/Instagram-style square crop dialog for the profile photo. */}
      <ImageCropperModal
        open={cropOpen}
        src={cropSrc}
        aspect={1}
        cropShape="round"
        outputSize={512}
        title="Adjust profile photo"
        onCancel={() => { setCropOpen(false); setCropSrc(null); }}
        onConfirm={handleCropConfirm}
      />

      {/* Face-biometric enrolment — opens from the Security card and posts
          the 128-d descriptor (with consent) to /api/face/register. */}
      {/* Always target the profile being VIEWED (empDetail.id is the numeric
          Employee id the backend resolves). Without this the modal sent no
          employee_id, so the server fell back to the logged-in user's own row
          and an admin enrolling another employee got a misleading "face
          already registered for <that employee>" conflict. For the user's own
          profile this id equals their own row, so the self-enrol path is
          unaffected. */}
      <FaceRegistrationModal open={faceRegOpen} employeeId={empDetail?.id ?? undefined} onClose={() => setFaceRegOpen(false)} />

      {/* Real salary structure editor — replaces the old mock "Revise Salary"
          flow. Saving creates a new version and propagates to payroll. */}
      <SalaryStructureModal
        open={salaryModalOpen}
        employee={salaryEmpLite}
        onClose={() => setSalaryModalOpen(false)}
        onSaved={reloadSalaryStruct}
      />
      {isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) && (
        <>
          <RaiseHiringRequestModal
            isOpen={raiseHiringOpen}
            editing={hiringEditing}
            onClose={() => { setRaiseHiringOpen(false); setHiringEditing(null); }}
            onSubmit={(savedRow, asDraft) => {
              // Bump the refresh key so the inline KPI strip + table
              // re-pull /hiring-requests on the next render.
              setHiringRefreshKey(k => k + 1);
              setRaiseHiringOpen(false);
              setHiringEditing(null);
              // Explicit confirmation so a Draft save reads as a draft (and
              // not as a submission to HR).
              if (asDraft) {
                toast.success('Saved as draft', `${savedRow?.code || 'Hiring request'} saved — edit and submit it to HR when ready.`);
              } else {
                toast.success('Submitted to HR', `${savedRow?.code || 'Hiring request'} sent to HR for review.`);
              }
            }}
          />
          <HiringRequestsListModal
            isOpen={listHiringOpen}
            onClose={() => setListHiringOpen(false)}
            onRaiseNew={() => { setListHiringOpen(false); setRaiseHiringOpen(true); }}
            onCreateRecruitment={() => { /* recruitment creation is HR-side; managers don't trigger this from the profile */ }}
            refreshKey={hiringRefreshKey}
          />
          {/* Read-only view of a single hiring request (eye action in the tab). */}
          <ViewHiringRequestModal
            request={hiringViewing ? apiToHiringRequestRow(hiringViewing) : null}
            onClose={() => setHiringViewing(null)}
            recruitmentCreated={!!hiringViewing?._hasRecruitment}
          />
        </>
      )}
      {signedPreview && (
        <div className="ep-signed-overlay"
          onClick={() => setSignedPreview(null)}>
          <div className="ep-signed-dialog"
            onClick={(e) => e.stopPropagation()}>
            <div className="ep-signed-head">
              <div className="d-flex align-items-center justify-content-between">
                <div className="min-w-0">
                  <strong className="ep-fs-15"><i className="ri-file-shield-2-line me-2" />{signedPreview.template?.name || 'Signed Document'}</strong>
                  <div className="ep-signed-head-sub">
                    {signedPreview.code ? `${signedPreview.code} · ` : ''}Status: <strong>{signedPreview.status}</strong>
                  </div>
                </div>
                <button type="button" onClick={() => setSignedPreview(null)} aria-label="Close"
                  className="ep-signed-head-x">
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>
            <div className="ep-signed-body">
              <HeaderFooterPanel
                header={{ ...DEFAULT_HEADER, ...(signedPreview.header_config || {}) } as HeaderConfig}
                setHeader={() => {}}
                footer={{ ...DEFAULT_FOOTER, ...(signedPreview.footer_config || {}) } as FooterConfig}
                setFooter={() => {}}
                readOnly
              >
                <div className="tpl-readonly-preview ep-signed-preview-content"
                  dangerouslySetInnerHTML={{ __html: signedPreview.content_html || '<p>(empty)</p>' }}
                />
              </HeaderFooterPanel>
            </div>
            <div className="ep-signed-footer">
              <button type="button" onClick={() => setSignedPreview(null)}
                className="ep-signed-close-btn">
                Close
              </button>
              <button type="button" onClick={() => downloadSignedPdf(signedPreview.id, signedPreview.code)}
                className="ep-signed-download-btn" disabled={downloadingDocId === signedPreview.id}>
                {downloadingDocId === signedPreview.id
                  ? (<><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>)
                  : (<><i className="ri-file-pdf-2-line me-1" />Download PDF</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </EmployeeProfileProvider>
  );
}