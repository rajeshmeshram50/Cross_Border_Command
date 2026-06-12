import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row, Button, Input, Dropdown, DropdownToggle, DropdownMenu, DropdownItem, Spinner } from 'reactstrap';
import * as XLSX from 'xlsx';
import { MasterFormStyles, MasterSelect } from '../master/masterFormKit';
import PayslipViewerModal, { type PayslipLine } from '../../components/PayslipViewerModal';
import PayrollRunModal, { type PayrollRunIssue } from '../../components/PayrollRunModal';
import SalaryStructureModal, { type SalaryEmployeeLite } from '../../components/SalaryStructureModal';
import PaymentDisbursementModal from '../../components/PaymentDisbursementModal';
import { useToast } from '../../contexts/ToastContext';
import { ShimmerTableRows, Shimmer } from '../../components/ui/Shimmer';
import api from '../../api';
// Reuses the purple hero-card, hero-pill, KPI surface and table styles that
// HrEmployeeOnboarding ships (.onb-hero-card / .onb-hero-pill / .onb-surface
// / .onb-kpi-card / .onb-pill / .onb-id-pill / .onb-role-pill) so the page
// reads the same as the rest of the HR module.
import '../employee-onboarding/HrEmployeeOnboarding.css';

// ── Types ────────────────────────────────────────────────────────────────────
type CycleStatus = 'Completed' | 'In Progress' | 'Not Started';
type RowStatus   = 'Ready' | 'Processed' | 'Pending Review' | 'On Hold' | 'Paid';
// Source of truth for the biometric tab. "Biometric" = device sync clean,
// "Review" = needs HR attention (missing punches / mismatches), "Manual" =
// no device data available, attendance entered manually.
type AttSource   = 'Biometric' | 'Review' | 'Manual';

interface CycleMonth {
  key: string;          // 'apr-2025'
  label: string;        // 'Apr 2025'
  range: string;        // '01 APR–30 APR'
  status: CycleStatus;
  month?: number;       // 1-12 (from /payroll/cycles)
  year?: number;        // 4-digit
}

interface PayrollRow {
  id: string;
  payslip_id?: number;  // server payslip id — used to fetch the full breakup
  employee_id?: number; // server employee id — used for slip history
  empId: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  ctc: number;          // monthly gross
  earnings: number;
  deductions: number;
  netPay: number;
  attendance: number;   // present days (0..30)
  status: RowStatus;
  attMismatch?: boolean;
  // Biometric tab fields — would come from /api/timelogs once wired.
  present: number;
  absent: number;
  lateMarks: number;
  missingPunch: number;
  unpaidLeave: number;  // counted toward "Unpaid Leave Cases" KPI
  attSource: AttSource;
  mismatch?: string;    // short note shown in the Mismatch column ("Punch gap", etc.)
  // Salary Report tab — itemised deductions & advances (would come from
  // /api/payroll/salary-report once wired).
  pfEmp: number;
  esi: number;
  pt: number;
  tds: number;
  lopDeducted: number;  // pay docked for unpaid leave / LOP days
  advanceRec: number;   // recovered from prior salary advance
  holdReason?: string | null;
  reasons?: string[];   // real server-computed exception reasons
  bankVerified?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const fmtINRShort = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
};

// ── Cycle history (12 months, Apr 2025 → Apr 2026 — matches the screenshot) ─
const CYCLE_MONTHS: CycleMonth[] = [
  { key: 'apr-2025', label: 'Apr 2025', range: '01 APR–30 APR', status: 'Completed' },
  { key: 'may-2025', label: 'May 2025', range: '01 MAY–31 MAY', status: 'Completed' },
  { key: 'jun-2025', label: 'Jun 2025', range: '01 JUN–30 JUN', status: 'Completed' },
  { key: 'jul-2025', label: 'Jul 2025', range: '01 JUL–31 JUL', status: 'Completed' },
  { key: 'aug-2025', label: 'Aug 2025', range: '01 AUG–31 AUG', status: 'Completed' },
  { key: 'sep-2025', label: 'Sep 2025', range: '01 SEP–30 SEP', status: 'Completed' },
  { key: 'oct-2025', label: 'Oct 2025', range: '01 OCT–31 OCT', status: 'Completed' },
  { key: 'nov-2025', label: 'Nov 2025', range: '01 NOV–30 NOV', status: 'Completed' },
  { key: 'dec-2025', label: 'Dec 2025', range: '01 DEC–31 DEC', status: 'Completed' },
  { key: 'jan-2026', label: 'Jan 2026', range: '01 JAN–31 JAN', status: 'Completed' },
  { key: 'feb-2026', label: 'Feb 2026', range: '01 FEB–28 FEB', status: 'Completed' },
  { key: 'mar-2026', label: 'Mar 2026', range: '01 MAR–31 MAR', status: 'In Progress' },
  { key: 'apr-2026', label: 'Apr 2026', range: '01 APR–30 APR', status: 'Not Started' },
];

const CYCLE_TONES: Record<CycleStatus, { bg: string; fg: string; dot: string }> = {
  'Completed':   { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'In Progress': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'Not Started': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

// Keyed loosely (not by RowStatus) so the server's post-disbursement 'Paid'
// status — which isn't in the RowStatus union — still resolves to a tone.
const ROW_TONES: Record<string, { bg: string; fg: string; dot: string }> = {
  'Ready':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Processed':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Pending Review': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'On Hold':        { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
  'Paid':           { bg: '#d6f4e3', fg: '#0a7d5a', dot: '#0ab39c' },
};

// Safe tone lookup — falls back to the neutral "Processed" tone for any
// unexpected status so a row never crashes on an undefined tone.
const toneFor = (status: string) => ROW_TONES[status] ?? ROW_TONES['Processed'];

// ── Mock employee payroll rows for the Apr 2026 cycle ───────────────────────
// 26 working days in Apr 2026 — drives the biometric tab's "26 working days"
// banner and the present/absent breakdown. Salary deductions are split into
// individual heads (PF / ESI / PT / TDS / LOP / advance recovery) so the
// Salary Report tab can render them as columns; legacy `deductions` and
// `netPay` are recomputed from those heads to stay consistent.

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
];

const STATUS_OPTIONS: { value: 'All' | RowStatus; label: string }[] = [
  { value: 'All',            label: 'All' },
  { value: 'Ready',          label: 'Ready' },
  { value: 'Processed',      label: 'Processed' },
  { value: 'Pending Review', label: 'Pending Review' },
  { value: 'On Hold',        label: 'On Hold' },
  { value: 'Paid',           label: 'Paid' },
];

// KPI cards (top strip + tile icon, matches the onboarding layout)
const KPI_CARDS = [
  { key: 'totalPayroll',   label: 'Total Payroll',     icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548', strip: '#10b981', mode: 'currency' as const },
  { key: 'readyProcessed', label: 'Ready / Processed', icon: 'ri-checkbox-circle-line',    tint: '#dceefe', fg: '#0c63b0', strip: '#3b82f6', mode: 'fraction' as const },
  { key: 'pendingReview',  label: 'Pending Review',    icon: 'ri-time-line',               tint: '#fdf3d6', fg: '#a06f00', strip: '#f59e0b', mode: 'count' as const },
  { key: 'onHold',         label: 'On Hold',           icon: 'ri-error-warning-line',      tint: '#fdd9d6', fg: '#b1401d', strip: '#f06548', mode: 'count' as const },
] as const;

// ── Animated number — same easing as the onboarding KPIs ────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1000;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step || 1);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString('en-IN')}{suffix}</>;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HrPayroll() {
  const toast = useToast();
  const navigate = useNavigate();

  // Issue-card actions (Go to Attendance / Open Employee) — real navigation.
  const handleIssueAction = (action: { kind?: string }, issue: { empCode?: string }) => {
    setRunOpen(false);
    if (action.kind === 'attendance') {
      navigate('/hr/attendance');
    } else if (action.kind === 'employee' && issue.empCode) {
      navigate(`/hr/employees/${encodeURIComponent(issue.empCode)}/profile`);
    }
  };

  // Cycle strip — seeded with the static months for the first paint, then
  // replaced by /api/payroll/cycles (which carries real month/year + status).
  const [cycleMonths, setCycleMonths] = useState<CycleMonth[]>(CYCLE_MONTHS);

  // Live payroll rows for the selected cycle (from /api/payroll). Seeded once
  // behind the mount shimmer so nothing flashes empty.
  // Starts empty — the mount shimmer covers the first /api/payroll fetch, then
  // real rows load. No mock/seed data ever renders.
  const [rows, setRows] = useState<PayrollRow[]>([]);
  // Period + run meta for the selected cycle (drives finalize/run/approve/pay
  // gating). run_id is needed for approve/pay.
  const [periodMeta, setPeriodMeta] = useState<{ attendance_finalized: boolean; status: string; run_status: string | null; working_days?: number } | null>(null);
  const [runMeta, setRunMeta] = useState<{ id: number; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Tracks which export/download is in flight ('csv' | 'excel' | 'zip' |
  // 'history' | 'email') so each menu item can spin + the menu disables until
  // the download completes.
  const [downloading, setDownloading] = useState<string | null>(null);
  // Per-row payslip PDF download in progress (row id).
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  // Selected cycle drives every downstream stat. Defaults to the live "In
  // Progress" cycle (Mar 2026); falls back to the last entry if all cycles
  // are completed.
  const initialCycleKey = useMemo(() => {
    const live = CYCLE_MONTHS.find(c => c.status === 'In Progress' || c.status === 'Not Started');
    return (live ?? CYCLE_MONTHS[CYCLE_MONTHS.length - 1]).key;
  }, []);
  const [cycleKey, setCycleKey] = useState<string>(initialCycleKey);
  const [cycleCollapsed, setCycleCollapsed] = useState(false);

  const [tab, setTab] = useState<'processing' | 'biometric' | 'report' | 'salary'>('processing');

  // Salary Setup tab — roster of employees + their structure status.
  const [roster, setRoster] = useState<SalaryEmployeeLite[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [salaryEmp, setSalaryEmp] = useState<SalaryEmployeeLite | null>(null);

  const loadRoster = () => {
    setRosterLoading(true);
    api.get('/salary-structures/employees')
      .then(res => setRoster(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setRoster([]))
      .finally(() => setRosterLoading(false));
  };
  // Load the roster the first time the Salary tab is opened (and after saves).
  useEffect(() => { if (tab === 'salary' && roster.length === 0) loadRoster(); /* eslint-disable-next-line */ }, [tab]);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | RowStatus>('All');

  // Payslip viewer modal — opened from the Payslip column in the Salary
  // Report tab. Holds the row currently being viewed so the modal can render
  // that employee's earnings/deductions breakdown.
  const [paySlipRow, setPaySlipRow] = useState<PayrollRow | null>(null);
  // Real component-level breakup fetched from /payroll/payslip/{id}; falls
  // back to a synthesized split when unavailable.
  const [payslipBreakup, setPayslipBreakup] = useState<{ earnings: PayslipLine[]; deductions: PayslipLine[] } | null>(null);
  // Rule 16 — provisional vs final (official) slip; gates download/email.
  const [payslipFinal, setPayslipFinal] = useState<boolean | undefined>(undefined);
  // Salary-slip history for the employee being viewed (powers the modal's
  // Recent Payslips list + click-to-load).
  const [payslipRecent, setPayslipRecent] = useState<{ label: string; now?: boolean; payslipId?: number; status?: string }[]>([]);
  // Real (branch-resolved) company letterhead for the viewer — no dummy data.
  const [payslipCompany, setPayslipCompany] = useState<{ name: string; meta: string; initials: string; hrEmail: string } | null>(null);

  // Load one payslip's full breakup + company letterhead into the viewer.
  const loadPayslipDetail = (payslipId?: number) => {
    if (!payslipId) return;
    api.get(`/payroll/payslip/${payslipId}`)
      .then(res => {
        const d = res.data?.data ?? {};
        const e = (d.earningsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 }));
        const ded = (d.deductionsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 }));
        setPayslipBreakup(e.length || ded.length ? { earnings: e, deductions: ded } : null);
        setPayslipFinal(typeof d.is_final === 'boolean' ? d.is_final : undefined);
        if (d.company) {
          setPayslipCompany({
            name: d.company.name || '',
            meta: d.company.address || '',
            initials: d.company.initials || '',
            hrEmail: d.company.hr_email || '',
          });
        }
      })
      .catch(() => { /* fall back to the synthesized split */ });
  };

  const openPayslip = (row: PayrollRow) => {
    setPaySlipRow(row);
    setPayslipBreakup(null);
    setPayslipFinal(undefined);
    setPayslipCompany(null);
    // Seed the recent list with the current cycle so the dummy default never
    // shows; the history fetch then replaces it with the full list.
    setPayslipRecent(row.payslip_id ? [{ label: cycle.label, now: true, payslipId: row.payslip_id, status: row.status }] : []);
    loadPayslipDetail(row.payslip_id);
    // Fetch this employee's slip history for the "Recent Payslips" sidebar.
    if (row.employee_id) {
      api.get(`/payroll/employee/${row.employee_id}/payslips`)
        .then(res => {
          const list = (res.data?.data ?? []) as any[];
          if (list.length) {
            setPayslipRecent(list.map((s, i) => ({
              label: s.label,
              now: i === 0,
              payslipId: s.payslip_id,
              status: s.status,
            })));
          }
        })
        .catch(() => { /* keep the seeded current-cycle entry */ });
    }
  };
  const selectRecent = (entry: { payslipId?: number }) => loadPayslipDetail(entry.payslipId);
  const closePayslip = () => { setPaySlipRow(null); setPayslipBreakup(null); setPayslipFinal(undefined); setPayslipRecent([]); setPayslipCompany(null); };

  // Payroll run pre-flight modal — opened from the Run Payroll button in the
  // hero. Bridges the click into the two-phase blocking-issues / success
  // flow defined in PayrollRunModal.
  const [runOpen, setRunOpen] = useState(false);

  // Issues are derived from the live `rows` (each payslip carries its own
  // server-computed exceptions, surfaced via status/mismatch fields):
  //   - status 'On Hold'        → blocking
  //   - attMismatch || mismatch → warning
  // This keeps the modal in sync with the table; the same buckets are what
  // /api/payroll/preflight returns.
  const runIssues = useMemo<PayrollRunIssue[]>(() => {
    const list: PayrollRunIssue[] = [];
    for (const r of rows) {
      // Prefer the REAL server-computed reasons; only fall back to heuristics
      // when the row carries none (e.g. older payslip without exceptions).
      const realReasons = (r.reasons && r.reasons.length) ? r.reasons : null;
      if (r.status === 'On Hold') {
        let reasons: string[] = realReasons ?? [];
        if (!reasons.length) {
          if (r.holdReason) reasons.push(r.holdReason);
          if (r.bankVerified === false) reasons.push('Bank details not verified');
          if (r.missingPunch > 0) reasons.push(`${r.missingPunch} missing biometric punch${r.missingPunch === 1 ? '' : 'es'}`);
          if (!reasons.length) reasons.push('Blocking issue — resolve before running');
        }
        list.push({
          id: r.id,
          type: 'blocking',
          empCode: r.empId,
          empName: r.name,
          empInitials: r.initials,
          empAccent: r.accent,
          department: r.department,
          reasons,
          actions: [
            { label: 'Go to Attendance', tone: 'blue',   kind: 'attendance' },
            { label: 'Open Employee',    tone: 'purple', kind: 'employee' },
          ],
        });
      } else if (r.status === 'Pending Review' || r.attMismatch || r.mismatch) {
        let reasons: string[] = realReasons ?? [];
        if (!reasons.length) {
          if (r.mismatch)        reasons.push(r.mismatch);
          if (r.lateMarks > 0)   reasons.push(`${r.lateMarks} late mark${r.lateMarks === 1 ? '' : 's'} flagged`);
          if (!reasons.length)   reasons.push('Attendance review pending');
        }
        list.push({
          id: r.id,
          type: 'warning',
          empCode: r.empId,
          empName: r.name,
          empInitials: r.initials,
          empAccent: r.accent,
          department: r.department,
          reasons,
          actions: [
            { label: 'Go to Attendance', tone: 'blue',   kind: 'attendance' },
            { label: 'Open Employee',    tone: 'purple', kind: 'employee' },
          ],
        });
      }
    }
    return list;
  }, [rows]);

  // Sum of net pay for the blocking & at-risk buckets — drives the 3 KPI
  // tiles at the top of the pre-flight modal.
  const blockedAmount = useMemo(
    () => rows.filter(r => r.status === 'On Hold').reduce((s, r) => s + r.netPay, 0),
    [rows],
  );
  const atRiskAmount  = useMemo(
    () => rows.filter(r => (r.attMismatch || r.mismatch) && r.status !== 'On Hold').reduce((s, r) => s + r.netPay, 0),
    [rows],
  );

  // Pagination — match the master tables (7 per page).
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 7;

  // Reset page when filters change.
  useEffect(() => { setPage(1); }, [q, deptFilter, statusFilter, cycleKey, tab]);

  const [loading, setLoading] = useState(true);

  const cycle = useMemo(
    () => cycleMonths.find(c => c.key === cycleKey) ?? cycleMonths[0],
    [cycleKey, cycleMonths],
  );

  // Load the real cycle strip once on mount, then snap the selection to the
  // live (In Progress / Not Started) cycle.
  useEffect(() => {
    api.get('/payroll/cycles')
      .then(res => {
        const list = (res.data?.data ?? []) as CycleMonth[];
        if (Array.isArray(list) && list.length) {
          setCycleMonths(list);
          const live = list.find(c => c.status === 'In Progress' || c.status === 'Not Started');
          setCycleKey((live ?? list[list.length - 1]).key);
        }
      })
      .catch(() => { /* keep the seeded strip on failure */ });
  }, []);

  // Fetch payslip rows for the selected cycle. Maps the server payload (which
  // already uses the PayrollRow field names) straight into table state.
  const reloadCycle = useMemo(() => () => {
    const c = cycleMonths.find(m => m.key === cycleKey);
    const month = c?.month;
    const year  = c?.year;
    setLoading(true);
    return api.get('/payroll', { params: month && year ? { month, year } : {} })
      .then(res => {
        const d = res.data?.data ?? {};
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setPeriodMeta(d.period ?? null);
        setRunMeta(d.run ?? null);
      })
      .catch(err => {
        setRows([]);
        const msg = err?.response?.data?.message || 'Could not load payroll for this cycle.';
        toast.error('Load failed', msg);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey, cycleMonths]);

  useEffect(() => { reloadCycle(); }, [reloadCycle]);

  // ── Actions ────────────────────────────────────────────────────────────
  // Run Payroll: Rule 1 finalizes attendance first (if not already), then
  // generates the run and opens the pre-flight modal against the fresh rows.
  const runPayroll = async () => {
    if (busy) return;
    const month = cycle?.month, year = cycle?.year;
    if (!month || !year) { toast.error('Run failed', 'Select a valid cycle first.'); return; }
    setBusy(true);
    try {
      if (!periodMeta?.attendance_finalized) {
        await api.post('/payroll/finalize-attendance', { month, year });
      }
      await api.post('/payroll/run', { month, year });
      await reloadCycle();
      setRunOpen(true);
    } catch (err: any) {
      toast.error('Payroll run failed', err?.response?.data?.message || 'Could not generate payroll.');
    } finally {
      setBusy(false);
    }
  };

  // Proceed to Pay — approve the run (so it's ready to disburse), then open the
  // disbursement flow (mode → advice/NEFT → 3-level sign-off → initiate).
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentRunId, setPaymentRunId] = useState<number | null>(null);
  const proceedToPay = async () => {
    if (!runMeta?.id) { setRunOpen(false); return; }
    setBusy(true);
    try {
      if (runMeta.status !== 'approved' && runMeta.status !== 'paid') {
        await api.post('/payroll/approve', { run_id: runMeta.id });
      }
      setRunOpen(false);
      setPaymentRunId(runMeta.id);
      setPaymentOpen(true);
    } catch (err: any) {
      toast.error('Could not start payment', err?.response?.data?.message || 'Approve the payroll first.');
    } finally {
      setBusy(false);
    }
  };

  // Rule 15 — reopen a non-paid run for corrections (re-edit attendance/leave
  // then re-run). Paid cycles are immutable and the server rejects them.
  const reopenPayroll = async () => {
    if (busy) return;
    const month = cycle?.month, year = cycle?.year;
    if (!month || !year) return;
    setBusy(true);
    try {
      await api.post('/payroll/reopen', { month, year });
      await reloadCycle();
      toast.success('Payroll reopened', `${cycle.label} is open for corrections — re-run when ready.`);
    } catch (err: any) {
      toast.error('Reopen failed', err?.response?.data?.message || 'Could not reopen payroll.');
    } finally {
      setBusy(false);
    }
  };

  // A generated/approved (but not paid) run can be corrected.
  const canReopen = !!runMeta && runMeta.status !== 'paid';

  // Download a single payslip PDF (from the table row buttons).
  const downloadPayslipPdf = async (row: PayrollRow) => {
    if (!row.payslip_id) {
      toast.error('Not available', 'Generate payroll before downloading payslips.');
      return;
    }
    if (pdfBusyId) return;
    setPdfBusyId(row.id);
    try {
      const res = await api.get(`/payroll/payslip/${row.payslip_id}/pdf`, {
        params: { download: 1 },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${row.name.replace(/\s+/g, '_')}_${cycle.label.replace(' ', '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed', 'Could not generate the payslip PDF.');
    } finally {
      setPdfBusyId(null);
    }
  };

  // Bulk — every payslip in the cycle zipped (permission-gated server-side).
  const downloadAllPayslips = async () => {
    if (downloading) return;
    const month = cycle?.month, year = cycle?.year;
    setDownloading('zip');
    try {
      const res = await api.get('/payroll/payslips/bulk', {
        params: {
          month, year,
          department: deptFilter !== 'All' ? deptFilter : undefined,
          status: statusFilter !== 'All' ? statusFilter : undefined,
        },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslips_${cycle.label.replace(' ', '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Payslips ready', `${cycle.label} payslips downloaded as a ZIP.`);
    } catch (err: any) {
      // Blob error responses need parsing back to text for the message.
      let msg = 'Could not generate payslips.';
      if (err?.response?.status === 403) msg = 'You are not allowed to download payslips.';
      else if (err?.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text())?.message || msg; } catch { /* keep default */ }
      }
      toast.error('Bulk download failed', msg);
    } finally {
      setDownloading(null);
    }
  };

  // Email every (final) payslip in the cycle to each employee. Server skips
  // employees with no email and reports the breakdown.
  const emailAllPayslips = async () => {
    if (downloading) return;
    const month = cycle?.month, year = cycle?.year;
    setDownloading('email');
    try {
      const res = await api.post('/payroll/payslips/email', {
        month, year,
        department: deptFilter !== 'All' ? deptFilter : undefined,
        status: statusFilter !== 'All' ? statusFilter : undefined,
      });
      toast.success('Payslips emailed', res.data?.message || `Payslips sent for ${cycle.label}.`);
    } catch (err: any) {
      toast.error('Email failed', err?.response?.data?.message || 'Could not email payslips.');
    } finally {
      setDownloading(null);
    }
  };

  // Rule 17 — filtered, permission-gated CSV export streamed from the server.
  const exportCsv = async () => {
    if (downloading) return;
    const month = cycle?.month, year = cycle?.year;
    setDownloading('csv');
    try {
      const res = await api.get('/payroll/export', {
        params: {
          month, year,
          department: deptFilter !== 'All' ? deptFilter : undefined,
          status: statusFilter !== 'All' ? statusFilter : undefined,
        },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll_${cycle.label.replace(' ', '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export ready', `${cycle.label} payroll downloaded as CSV.`);
    } catch (err: any) {
      const msg = err?.response?.status === 403
        ? 'You are not allowed to export payroll.'
        : (err?.response?.data?.message || 'Export failed.');
      toast.error('Export failed', msg);
    } finally {
      setDownloading(null);
    }
  };

  // Excel (.xlsx) of the CURRENT cycle — every column, built client-side from
  // the loaded rows (matches the project's xlsx export pattern).
  const exportExcelCurrent = () => {
    if (downloading) return;
    if (!rows.length) { toast.error('Nothing to export', 'Generate payroll for this cycle first.'); return; }
    setDownloading('excel');
    try {
    const sheet = rows.map(r => {
      const lopDays = Math.max(0, (periodMeta?.working_days || 26) - r.attendance);
      return {
        'Emp Code': r.empId,
        'Employee': r.name,
        'Department': r.department,
        'Designation': r.designation,
        'Working Days': periodMeta?.working_days || 26,
        'Present': r.present,
        'Paid Days': r.attendance,
        'LOP Days': lopDays,
        'Unpaid Leave': r.unpaidLeave,
        'Late Marks': r.lateMarks,
        'Gross Earnings': r.earnings,
        'PF (Emp)': r.pfEmp,
        'ESI': r.esi,
        'PT': r.pt,
        'TDS': r.tds,
        'LOP Amount': r.lopDeducted,
        'Advance Rec.': r.advanceRec,
        'Total Deductions': r.deductions,
        'Net Pay': r.netPay,
        'Status': r.status,
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
    XLSX.writeFile(wb, `Payroll_${cycle.label.replace(' ', '_')}.xlsx`);
    toast.success('Excel ready', `${cycle.label} payroll exported as Excel.`);
    } catch {
      toast.error('Excel export failed', 'Could not build the Excel file.');
    } finally {
      setDownloading(null);
    }
  };

  // Payroll HISTORY (Excel) — overall data across all cycles. Two sheets:
  // a per-cycle Summary and a per-employee Detail (every column).
  const exportHistoryExcel = async () => {
    if (downloading) return;
    setDownloading('history');
    try {
      const res = await api.get('/payroll/history');
      const d = res.data?.data ?? {};
      const cycles = (d.cycles ?? []) as any[];
      const histRows = (d.rows ?? []) as any[];
      if (!cycles.length && !histRows.length) {
        toast.error('No history', 'No payroll cycles found yet.');
        return;
      }
      const summary = cycles.map(c => ({
        'Cycle': c.label,
        'Run Status': c.run_status ?? '—',
        'Attendance Finalized': c.attendance_final ? 'Yes' : 'No',
        'Employees': c.employees,
        'On Hold': c.on_hold,
        'Total Gross': c.gross,
        'Total Deductions': c.deductions,
        'Net Disbursed': c.net,
        'Paid On': c.paid_at ?? '—',
      }));
      const detail = histRows.map(r => ({
        'Cycle': r.cycle,
        'Emp Code': r.employee_code,
        'Employee': r.employee_name,
        'Department': r.department,
        'Designation': r.designation,
        'Working Days': r.working_days,
        'Present': r.present_days,
        'Paid Days': r.paid_days,
        'LOP Days': r.lop_days,
        'Paid Leave': r.paid_leave_days,
        'Unpaid Leave': r.unpaid_leave_days,
        'Late Marks': r.late_marks,
        'Gross': r.gross_earnings,
        'Basic': r.basic,
        'PF': r.pf_employee,
        'ESI': r.esi,
        'PT': r.pt,
        'TDS': r.tds,
        'LOP Amount': r.lop_amount,
        'Advance Rec.': r.advance_recovery,
        'Total Deductions': r.total_deductions,
        'Net Pay': r.net_pay,
        'Status': r.status,
        'Bank A/C': r.bank_account,
        'IFSC': r.ifsc,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Detail');
      XLSX.writeFile(wb, `Payroll_History_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('History exported', `${cycles.length} cycles, ${histRows.length} payslips.`);
    } catch (err: any) {
      toast.error('History export failed', err?.response?.data?.message || 'Could not load payroll history.');
    } finally {
      setDownloading(null);
    }
  };

  // Counts — derived from the live cycle-scoped `rows`.
  const counts = useMemo(() => {
    const totalEmployees = rows.length;
    const ready          = rows.filter(r => r.status === 'Ready').length;
    const processed      = rows.filter(r => r.status === 'Processed' || r.status === ('Paid' as RowStatus)).length;
    const pendingReview  = rows.filter(r => r.status === 'Pending Review').length;
    const onHold         = rows.filter(r => r.status === 'On Hold').length;
    const totalPayroll   = rows.reduce((s, r) => s + r.netPay, 0);
    const avgCtc         = totalEmployees ? Math.round(rows.reduce((s, r) => s + r.ctc, 0) / totalEmployees) : 0;
    const attMismatch    = rows.filter(r => r.attMismatch || r.attSource === 'Review').length;
    // Biometric tab aggregates
    const syncedEmployees    = rows.filter(r => r.attSource === 'Biometric').length;
    const missingPunchCases  = rows.filter(r => r.missingPunch > 0).length;
    const mismatchCases      = rows.filter(r => r.attSource === 'Review').length;
    const unpaidLeaveCases   = rows.filter(r => r.unpaidLeave > 0).length;
    // Salary Report aggregates
    const totalGross    = rows.reduce((s, r) => s + r.earnings, 0);
    const totalNetPay   = rows.reduce((s, r) => s + r.netPay, 0);
    const totalPf       = rows.reduce((s, r) => s + r.pfEmp, 0);
    const totalTds      = rows.reduce((s, r) => s + r.tds, 0);
    const totalLop      = rows.reduce((s, r) => s + r.lopDeducted, 0);
    return {
      totalEmployees,
      ready,
      processed,
      readyProcessed: ready + processed,
      pendingReview,
      onHold,
      totalPayroll,
      avgCtc,
      attMismatch,
      syncedEmployees,
      missingPunchCases,
      mismatchCases,
      unpaidLeaveCases,
      totalGross,
      totalNetPay,
      totalPf,
      totalTds,
      totalLop,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(r => deptFilter === 'All' || r.department === deptFilter)
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle)        ||
          r.empId.toLowerCase().includes(needle)       ||
          r.department.toLowerCase().includes(needle)  ||
          r.designation.toLowerCase().includes(needle)
        );
      });
  }, [rows, q, deptFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * PAGE_SIZE;
  const visible   = filtered.slice(sliceFrom, sliceFrom + PAGE_SIZE);
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  // Cycle strip — horizontal scroller controlled by the prev/next chevrons.
  const cycleStripRef = useRef<HTMLDivElement | null>(null);
  const scrollCycle = (dir: 'prev' | 'next') => {
    const el = cycleStripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'next' ? 240 : -240, behavior: 'smooth' });
  };

  const monthOptions = cycleMonths.map(m => ({ value: m.key, label: m.label }));

  return (
    <>
      <MasterFormStyles />

      {/* ── Payroll-only dark-mode shims. Most of the page uses theme-aware
          tokens (var(--vz-*)) and the .onb-* classes from HrEmployeeOnboarding,
          but a handful of pastel surfaces (banner / mini-tiles / selected
          cycle chip / cycle calendar icon) are hardcoded — these get a
          translucent dark variant here so the page reads on both themes. ── */}
      <style>{`
        /* Hero action row — dark-violet 2px ring around the cycle dropdown
           and the Run Payroll / Export buttons so they stand out against the
           light purple hero card. */
        .pay-hero-select .master-select-toggle {
          border: 1px solid #5a3fd1 !important;
          background: #fff !important;
          box-shadow: 0 4px 12px rgba(90,63,209,0.18) !important;
        }
        [data-bs-theme="dark"] .pay-hero-select .master-select-toggle {
          background: var(--vz-card-bg) !important;
          border-color: #a78bfa !important;
        }
        .pay-hero-run:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 22px rgba(90,63,209,0.42) !important;
        }
        .pay-hero-export:hover {
          background: #f5f1ff !important;
          box-shadow: 0 6px 14px rgba(90,63,209,0.20) !important;
        }
        [data-bs-theme="dark"] .pay-hero-export {
          color: #c4b5fd !important;
          border-color: #a78bfa !important;
        }
        [data-bs-theme="dark"] .pay-hero-export:hover {
          background: rgba(124,92,252,0.16) !important;
        }

        .pay-cycle-icon { background: #ece6ff; color: #5a3fd1; }
        [data-bs-theme="dark"] .pay-cycle-icon { background: rgba(124,92,252,0.20); color: #c4b5fd; }

        .pay-cycle-chip { background: var(--vz-card-bg); border: 1px solid var(--vz-border-color); }
        .pay-cycle-chip.is-selected {
          background: linear-gradient(135deg,#f5f1ff,#ece6ff);
          border-color: #7c5cfc;
          box-shadow: 0 4px 12px rgba(124,92,252,0.18);
        }
        .pay-cycle-chip-label { color: var(--vz-heading-color, var(--vz-body-color)); }
        .pay-cycle-chip.is-selected .pay-cycle-chip-label { color: #5a3fd1; }
        [data-bs-theme="dark"] .pay-cycle-chip.is-selected {
          background: linear-gradient(135deg, rgba(124,92,252,0.22), rgba(124,92,252,0.10));
          border-color: #a78bfa;
          box-shadow: 0 4px 14px rgba(124,92,252,0.30);
        }
        [data-bs-theme="dark"] .pay-cycle-chip.is-selected .pay-cycle-chip-label { color: #c4b5fd; }

        .pay-banner { background: #e6f7f0; border: 1px solid #b6e4c8; color: #0a716a; }
        [data-bs-theme="dark"] .pay-banner {
          background: rgba(10,113,106,0.18);
          border-color: rgba(10,179,156,0.34);
          color: #4dd4be;
        }

        .pay-mini-tile { border-radius: 12px; padding: 14px 16px; border: 1px solid; }
        .pay-mini-tile--green  { background: #e6f7ed; border-color: #b6e4c8; }
        .pay-mini-tile--red    { background: #fde7e3; border-color: #f5c0b5; }
        .pay-mini-tile--amber  { background: #fdf3d6; border-color: #f0d990; }
        .pay-mini-tile--blue   { background: #dceefe; border-color: #b8d6f7; }
        .pay-mini-tile--purple { background: #ece6ff; border-color: #d6c9ff; }
        .pay-mini-tile-num--green  { color: #108548; }
        .pay-mini-tile-num--red    { color: #b1401d; }
        .pay-mini-tile-num--amber  { color: #a06f00; }
        .pay-mini-tile-num--blue   { color: #0c63b0; }
        .pay-mini-tile-num--purple { color: #5a3fd1; }
        [data-bs-theme="dark"] .pay-mini-tile--green  { background: rgba(16,133,72,0.18);  border-color: rgba(16,179,108,0.36); }
        [data-bs-theme="dark"] .pay-mini-tile--red    { background: rgba(177,64,29,0.18);  border-color: rgba(240,101,72,0.38); }
        [data-bs-theme="dark"] .pay-mini-tile--amber  { background: rgba(160,111,0,0.18);  border-color: rgba(245,158,11,0.38); }
        [data-bs-theme="dark"] .pay-mini-tile--blue   { background: rgba(12,99,176,0.18);  border-color: rgba(59,130,246,0.38); }
        [data-bs-theme="dark"] .pay-mini-tile--purple { background: rgba(90,63,209,0.18);  border-color: rgba(124,92,252,0.38); }
        [data-bs-theme="dark"] .pay-mini-tile-num--green  { color: #6ee7b7; }
        [data-bs-theme="dark"] .pay-mini-tile-num--red    { color: #fda192; }
        [data-bs-theme="dark"] .pay-mini-tile-num--amber  { color: #fcd34d; }
        [data-bs-theme="dark"] .pay-mini-tile-num--blue   { color: #93c5fd; }
        [data-bs-theme="dark"] .pay-mini-tile-num--purple { color: #c4b5fd; }

        /* Cycle history status pill — pastel bg keeps working on dark, but
           bump opacity so the tone reads against the dark card. */
        [data-bs-theme="dark"] .pay-cycle-status-pill { filter: brightness(1.05); }

        /* Status pills inside table rows — when used on a dark card the pastel
           bg still pops; just nudge contrast with a subtle ring. */
        [data-bs-theme="dark"] .onb-pill { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }

        /* Tab segmented bar — count chip looks washed out against the dark
           secondary bg; switch to translucent white for inactive tabs. */
        [data-bs-theme="dark"] .pay-tab-count-inactive {
          background: rgba(255,255,255,0.08) !important;
          color: var(--vz-secondary-color) !important;
        }
      `}</style>

      {/* ── Hero card (purple-tinted, mirrors HrEmployeeOnboarding) ── */}
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-coins-line" /></div>
          <div className="min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="frm-cstrip-title">Payroll</span>
              <span className="onb-hero-pill">
                <span className="dot" />{cycle.label}
              </span>
            </div>
            <div className="frm-cstrip-sub">
              Monthly payroll engine — biometric → run payroll → payslips & bank advice
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap pay-hero-actions">
          <div className="pay-hero-select" style={{ minWidth: 170 }}>
            <MasterSelect
              value={cycleKey}
              onChange={(v) => setCycleKey(String(v))}
              options={monthOptions}
              placeholder="Select cycle"
            />
          </div>
          <Button
            className="rounded-pill fw-bold d-inline-flex align-items-center pay-hero-run"
            onClick={runPayroll}
            disabled={busy}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              color: '#fff',
              background: 'linear-gradient(135deg,#0ab39c 0%,#078b78 100%)',
              boxShadow: '0 8px 18px rgba(90,63,209,0.32)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <i className={`me-2 ${busy ? 'ri-loader-4-line' : 'ri-play-circle-line'}`} style={{ fontSize: 16 }} />
            {busy ? 'Processing…' : 'Run Payroll'}
          </Button>
          <Dropdown isOpen={exportOpen} toggle={() => { if (!downloading) setExportOpen(v => !v); }}>
            <DropdownToggle
              caret
              disabled={!!downloading}
              className="rounded-pill fw-semibold d-inline-flex align-items-center pay-hero-export"
              style={{
                padding: '10px 15px',
                fontSize: 12,
                border: '1px solid #705ad0',
                background: 'var(--vz-card-bg)',
                color: '#5a3fd1',
                opacity: downloading ? 0.7 : 1,
              }}
            >
              {downloading
                ? <><Spinner size="sm" className="me-2" /> Exporting…</>
                : <><i className="ri-download-2-line me-2" style={{ fontSize: 14 }} /> Export</>}
            </DropdownToggle>
            {/* toggle={false} on items keeps the menu open so the per-item
                spinner stays visible until the download finishes. */}
            <DropdownMenu end style={{ fontSize: 13 }}>
              <DropdownItem header>This cycle ({cycle.label})</DropdownItem>
              <DropdownItem toggle={false} disabled={!!downloading} onClick={exportExcelCurrent}>
                {downloading === 'excel' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-excel-2-line me-2 text-success" />} Excel (full data)
              </DropdownItem>
              <DropdownItem toggle={false} disabled={!!downloading} onClick={exportCsv}>
                {downloading === 'csv' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-text-line me-2" />} CSV
              </DropdownItem>
              <DropdownItem toggle={false} disabled={!!downloading} onClick={downloadAllPayslips}>
                {downloading === 'zip' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-zip-line me-2" />} All payslips (ZIP of PDFs)
              </DropdownItem>
              <DropdownItem toggle={false} disabled={!!downloading} onClick={emailAllPayslips}>
                {downloading === 'email' ? <Spinner size="sm" className="me-2" /> : <i className="ri-mail-send-line me-2" />} Email payslips to all
              </DropdownItem>
              <DropdownItem divider />
              <DropdownItem header>Overall</DropdownItem>
              <DropdownItem toggle={false} disabled={!!downloading} onClick={exportHistoryExcel}>
                {downloading === 'history' ? <Spinner size="sm" className="me-2" /> : <i className="ri-history-line me-2 text-primary" />} Payroll history (Excel)
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
          {canReopen && (
            <Button
              color="light"
              className="rounded-pill fw-semibold d-inline-flex align-items-center pay-hero-export"
              onClick={reopenPayroll}
              disabled={busy}
              title="Reopen this cycle to correct attendance/leave, then re-run"
              style={{
                padding: '10px 15px',
                fontSize: 12,
                border: '1px solid #e0a800',
                background: 'var(--vz-card-bg)',
                color: '#a06f00',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <i className="ri-arrow-go-back-line me-2" style={{ fontSize: 14 }} />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* ── Cycle History strip (own card) ───────────────────────────── */}
      <Card className="mb-3">
        <CardBody style={{ padding: '14px 16px' }}>
          <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded pay-cycle-icon"
                style={{ width: 24, height: 24 }}
              >
                <i className="ri-calendar-2-line" style={{ fontSize: 14 }} />
              </span>
              <span className="fw-bold" style={{ fontSize: 13 }}>Cycle History</span>
              {(['Completed', 'In Progress', 'Not Started'] as CycleStatus[]).map(s => {
                const t = CYCLE_TONES[s];
                const n = cycleMonths.filter(c => c.status === s).length;
                if (!n) return null;
                return (
                  <span
                    key={s}
                    className="onb-pill"
                    style={{ background: t.bg, color: t.fg, fontSize: 10.5 }}
                    title={`${n} ${s.toLowerCase()}`}
                  >
                    <span className="d" style={{ background: t.dot }} />
                    {s} · {n}
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setCycleCollapsed(v => !v)}
              className="btn btn-sm fw-semibold"
              style={{
                background: 'transparent',
                color: '#5a3fd1',
                border: 'none',
                fontSize: 12,
              }}
            >
              {cycleCollapsed ? 'Expand ↓' : 'Collapse ↑'}
            </button>
          </div>

          {!cycleCollapsed && (
            <div className="d-flex align-items-stretch gap-2">
              <button
                type="button"
                onClick={() => scrollCycle('prev')}
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 32,
                  borderRadius: 10,
                  border: '1px solid var(--vz-border-color)',
                  background: 'var(--vz-card-bg)',
                  color: 'var(--vz-body-color)',
                  cursor: 'pointer',
                }}
              >
                <i className="ri-arrow-left-s-line" />
              </button>
              <div
                ref={cycleStripRef}
                className="d-flex gap-2 flex-grow-1"
                style={{
                  overflowX: 'auto',
                  scrollBehavior: 'smooth',
                  paddingBottom: 4,
                }}
              >
                {cycleMonths.map(m => {
                  const on = m.key === cycleKey;
                  const t  = CYCLE_TONES[m.status];
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setCycleKey(m.key)}
                      className={`text-start flex-shrink-0 pay-cycle-chip${on ? ' is-selected' : ''}`}
                      style={{
                        minWidth: 138,
                        padding: '10px 12px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        transition: 'all .15s ease',
                      }}
                    >
                      <div className="fw-bold pay-cycle-chip-label" style={{ fontSize: 12.5 }}>
                        {m.label}
                      </div>
                      <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.04em' }}>{m.range}</div>
                      <span
                        className="onb-pill mt-2"
                        style={{
                          background: t.bg,
                          color: t.fg,
                          fontSize: 9.5,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        <span className="d" style={{ background: t.dot }} />
                        {m.status}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => scrollCycle('next')}
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 32,
                  borderRadius: 10,
                  border: '1px solid var(--vz-border-color)',
                  background: 'var(--vz-card-bg)',
                  color: 'var(--vz-body-color)',
                  cursor: 'pointer',
                }}
              >
                <i className="ri-arrow-right-s-line" />
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── KPI cards (own row, each its own card) ── */}
      <Row className="g-3 mb-3 align-items-stretch">
        {KPI_CARDS.map(k => {
          let displayValue: React.ReactNode;
          if (k.mode === 'currency') {
            displayValue = fmtINRShort(counts.totalPayroll);
          } else if (k.mode === 'fraction') {
            displayValue = (
              <>
                <AnimatedNumber value={counts.readyProcessed} />
                <span className="text-muted fw-semibold" style={{ fontSize: 18 }}> / {counts.totalEmployees}</span>
              </>
            );
          } else {
            const n = (counts as any)[k.key] ?? 0;
            displayValue = <AnimatedNumber value={n} />;
          }

          const subtitle =
            k.key === 'totalPayroll'   ? `Net disbursable · ${cycle.label}` :
            k.key === 'readyProcessed' ? 'Employees processed' :
            k.key === 'pendingReview'  ? 'Awaiting action' :
                                         'Blocked — resolve first';

          return (
            <Col key={k.key} xl={3} md={6} sm={6} xs={12}>
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
                    <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: '0 0 6px', lineHeight: 1 }}>
                      {loading ? <Shimmer height={24} width={90} radius={6} /> : displayValue}
                    </h3>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px' }}>
                      {k.label}
                    </p>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{subtitle}</div>
                  </div>
                  <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                  </div>
                </div>
              </div>
            </Col>
          );
        })}
      </Row>

      {/* ── Tabs — segmented pill inside a rounded gray bar (mirrors
          HrExpenseManagement). Active tab gets the violet gradient with white
          text + count chip; inactive tabs sit transparent inside the same
          container. ── */}
      <Row className="g-2 align-items-center mb-3">
        <Col xs={12}>
          <div
            className="d-flex flex-wrap"
            style={{
              background: 'var(--vz-secondary-bg)',
              border: '1px solid var(--vz-border-color)',
              borderRadius: 10,
              padding: 4,
              gap: 4,
            }}
          >
            {[
              { key: 'processing' as const, label: 'Payroll Processing', icon: 'ri-money-rupee-circle-line', count: counts.totalEmployees },
              { key: 'biometric'  as const, label: 'Biometric Input',    icon: 'ri-fingerprint-line',         count: counts.attMismatch },
              { key: 'report'     as const, label: 'Salary Report',      icon: 'ri-file-chart-line',          count: counts.processed },
              { key: 'salary'     as const, label: 'Salary Setup',       icon: 'ri-money-rupee-circle-line',  count: roster.filter(r => !r.has_structure).length },
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
                    className={`badge rounded-pill${on ? '' : ' pay-tab-count-inactive'}`}
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

      {/* ── Filters + Table — own card, like Employee list ── */}
      <Card>
        <CardBody>
          {tab !== 'salary' && (
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
                    onChange={(v) => setStatusFilter(v as 'All' | RowStatus)}
                    options={STATUS_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {filtered.length} results
              </div>
            </Col>
          </Row>
          )}

          {tab === 'processing' && (
            <div className="table-responsive table-card rounded p-2">
              <table className="table align-middle table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col" className="ps-3" style={{ width: 60 }}>Sr. No.</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Emp ID</th>
                    <th scope="col">Department</th>
                    <th scope="col">Designation</th>
                    <th scope="col" className="text-end">Earnings</th>
                    <th scope="col" className="text-end">Deductions</th>
                    <th scope="col" className="text-end">Net Pay</th>
                    <th scope="col" className="text-center">Att.</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="pe-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <ShimmerTableRows rows={6} cols={11} keyPrefix="shim-proc" />
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-5 text-muted">
                        <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                        No payroll records match your filters
                      </td>
                    </tr>
                  ) : visible.map((r, idx) => {
                    const tone = toneFor(r.status);
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
                              <div className="text-muted" style={{ fontSize: 11.5 }}>CTC ₹{fmtINR(r.ctc)}/mo</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="onb-id-pill">{r.empId}</span>
                        </td>
                        <td className="fs-13">{r.department}</td>
                        <td className="fs-13">{r.designation}</td>
                        <td className="text-end fs-13 fw-semibold" style={{ color: '#108548' }}>₹{fmtINR(r.earnings)}</td>
                        <td className="text-end fs-13 fw-semibold" style={{ color: '#b1401d' }}>−₹{fmtINR(r.deductions)}</td>
                        <td className="text-end fs-13 fw-bold">₹{fmtINR(r.netPay)}</td>
                        <td className="text-center">
                          <span
                            className="onb-role-pill"
                            style={r.attendance < 30 ? { background: '#fde8c4', color: '#a4661c' } : undefined}
                          >
                            {r.attendance}/30
                          </span>
                        </td>
                        <td>
                          <span className="onb-pill" style={{ background: tone.bg, color: tone.fg }}>
                            <span className="d" style={{ background: tone.dot }} />
                            {r.status}
                          </span>
                        </td>
                        <td className="pe-3 text-center">
                          <div className="d-flex align-items-center justify-content-center gap-2">
                            <button
                              type="button"
                              className="onb-edit-btn"
                              title="View Payslip"
                              onClick={() => openPayslip(r)}
                            >
                              <i className="ri-eye-line" style={{ fontSize: 14 }} />
                            </button>
                            <button
                              type="button"
                              className="onb-edit-btn"
                              title="Download payslip PDF"
                              disabled={pdfBusyId === r.id}
                              onClick={() => downloadPayslipPdf(r)}
                            >
                              {pdfBusyId === r.id
                                ? <Spinner size="sm" style={{ width: 14, height: 14 }} />
                                : <i className="ri-download-2-line" style={{ fontSize: 14 }} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'biometric' && (
            <>
              {/* Read-only banner — biometric data is sourced from Timelogs and
                  edited there, not here. */}
              <div
                className="pay-banner d-flex align-items-center gap-2 mb-3"
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                <i className="ri-information-line" style={{ fontSize: 15 }} />
                Read-only · Source data from Attendance · {cycle.label} · {periodMeta?.working_days || 26} working days
              </div>

              {/* 4-tile mini strip — Synced / Missing Punch / Mismatch / Unpaid Leave */}
              <Row className="g-3 mb-3 align-items-stretch">
                {[
                  { key: 'syncedEmployees',   label: 'Synced Employees',    n: counts.syncedEmployees,   tone: 'green' as const },
                  { key: 'missingPunchCases', label: 'Missing Punch Cases', n: counts.missingPunchCases, tone: 'red'   as const },
                  { key: 'mismatchCases',     label: 'Mismatch Cases',      n: counts.mismatchCases,     tone: 'red'   as const },
                  { key: 'unpaidLeaveCases',  label: 'Unpaid Leave Cases',  n: counts.unpaidLeaveCases,  tone: 'amber' as const },
                ].map(t => (
                  <Col key={t.key} xl={3} md={6} sm={6} xs={12}>
                    <div className={`pay-mini-tile pay-mini-tile--${t.tone}`}>
                      <div className={`fw-bold pay-mini-tile-num--${t.tone}`} style={{ fontSize: 22, lineHeight: 1 }}>
                        {loading ? <Shimmer height={20} width={40} radius={6} /> : t.n}
                      </div>
                      <div className="text-muted mt-1" style={{ fontSize: 12 }}>{t.label}</div>
                    </div>
                  </Col>
                ))}
              </Row>

              <div className="table-responsive table-card rounded p-2">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col" className="ps-3">Employee</th>
                      <th scope="col" className="text-center">Present</th>
                      <th scope="col" className="text-center">Absent</th>
                      <th scope="col" className="text-center">Late Marks</th>
                      <th scope="col" className="text-center">Missing Punch</th>
                      <th scope="col" className="text-center">Att. Status</th>
                      <th scope="col" className="pe-3 text-center">Mismatch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={6} cols={7} keyPrefix="shim-bio" />
                    ) : visible.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-5 text-muted">
                          <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                          No biometric records match your filters
                        </td>
                      </tr>
                    ) : visible.map(r => {
                      const sourceTone =
                        r.attSource === 'Biometric' ? { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' } :
                        r.attSource === 'Review'    ? { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' } :
                                                      { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' };
                      return (
                        <tr key={r.id}>
                          <td className="ps-3">
                            <div className="d-flex align-items-center gap-2">
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{
                                  width: 30, height: 30, fontSize: 11,
                                  background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                                }}
                              >
                                {r.initials}
                              </div>
                              <div className="min-w-0">
                                <div className="fw-semibold fs-13">{r.name}</div>
                                <div className="text-muted" style={{ fontSize: 11 }}>{r.empId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-center fs-13 fw-bold">{r.present}</td>
                          <td className="text-center fs-13 fw-bold" style={{ color: r.absent ? '#b1401d' : 'var(--vz-secondary-color)' }}>
                            {r.absent}
                          </td>
                          <td className="text-center fs-13 fw-semibold" style={{ color: r.lateMarks ? '#a06f00' : 'var(--vz-secondary-color)' }}>
                            {r.lateMarks}
                          </td>
                          <td className="text-center">
                            <span
                              className="onb-pill"
                              style={
                                r.missingPunch
                                  ? { background: '#fde7e3', color: '#b1401d', fontSize: 11 }
                                  : { background: '#eef2f6', color: '#5b6478', fontSize: 11 }
                              }
                            >
                              {r.missingPunch}
                            </span>
                          </td>
                          <td className="text-center">
                            <span
                              className="onb-pill"
                              style={{ background: sourceTone.bg, color: sourceTone.fg, fontSize: 11 }}
                            >
                              <span className="d" style={{ background: sourceTone.dot }} />
                              {r.attSource}
                            </span>
                          </td>
                          <td className="pe-3 text-center fs-13">
                            {r.mismatch ? (
                              <span style={{ color: '#b1401d', fontWeight: 600 }}>{r.mismatch}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'report' && (
            <>
              {/* Totals strip — Gross / Net Pay / PF / TDS / LOP Ded. */}
              <Row className="g-3 mb-3 align-items-stretch">
                {[
                  { key: 'totalGross',  label: 'Total Gross',    n: counts.totalGross,  tone: 'green'  as const },
                  { key: 'totalNetPay', label: 'Total Net Pay',  n: counts.totalNetPay, tone: 'blue'   as const },
                  { key: 'totalPf',     label: 'Total PF',       n: counts.totalPf,     tone: 'purple' as const },
                  { key: 'totalTds',    label: 'Total TDS',      n: counts.totalTds,    tone: 'amber'  as const },
                  { key: 'totalLop',    label: 'Total LOP Ded.', n: counts.totalLop,    tone: 'red'    as const },
                ].map(t => (
                  <Col key={t.key} xl={true} md={4} sm={6} xs={12}>
                    <div className={`pay-mini-tile pay-mini-tile--${t.tone}`}>
                      <div className={`fw-bold pay-mini-tile-num--${t.tone}`} style={{ fontSize: 20, lineHeight: 1 }}>
                        {loading ? <Shimmer height={18} width={70} radius={6} /> : `₹${fmtINR(t.n)}`}
                      </div>
                      <div
                        className="mt-1 text-uppercase fw-semibold"
                        style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}
                      >
                        {t.label}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>

              <div className="table-responsive table-card rounded p-2">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col" className="ps-3">Emp ID</th>
                      <th scope="col">Employee</th>
                      <th scope="col" className="text-end">Gross Earnings</th>
                      <th scope="col" className="text-end">PF (Emp)</th>
                      <th scope="col" className="text-end">ESI</th>
                      <th scope="col" className="text-end">PT</th>
                      <th scope="col" className="text-end">TDS</th>
                      <th scope="col" className="text-end">LOP Deducted</th>
                      <th scope="col" className="text-end">Advance Rec.</th>
                      <th scope="col" className="text-end">Total Deductions</th>
                      <th scope="col" className="text-end">Net Payable</th>
                      <th scope="col" className="text-center">Status</th>
                      <th scope="col" className="pe-3 text-center">Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={6} cols={13} keyPrefix="shim-rep" />
                    ) : visible.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="text-center py-5 text-muted">
                          <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                          No salary records match your filters
                        </td>
                      </tr>
                    ) : visible.map(r => {
                      const totalDeductions = r.pfEmp + r.esi + r.pt + r.tds + r.lopDeducted + r.advanceRec;
                      const netPayable      = r.earnings - totalDeductions;
                      const tone            = toneFor(r.status);
                      const dim = (n: number) => n === 0
                        ? <span className="text-muted">—</span>
                        : <span style={{ color: '#b1401d' }}>−₹{fmtINR(n)}</span>;
                      return (
                        <tr key={r.id}>
                          <td className="ps-3">
                            <span style={{ color: '#5a3fd1', fontWeight: 600, fontSize: 12.5 }}>{r.empId}</span>
                          </td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{
                                  width: 30, height: 30, fontSize: 11,
                                  background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                                }}
                              >
                                {r.initials}
                              </div>
                              <div className="fw-semibold fs-13">{r.name}</div>
                            </div>
                          </td>
                          <td className="text-end fs-13 fw-semibold">₹{fmtINR(r.earnings)}</td>
                          <td className="text-end fs-13" style={{ color: '#5a3fd1' }}>₹{fmtINR(r.pfEmp)}</td>
                          <td className="text-end fs-13">{r.esi === 0 ? <span className="text-muted">₹0</span> : `₹${fmtINR(r.esi)}`}</td>
                          <td className="text-end fs-13">₹{fmtINR(r.pt)}</td>
                          <td className="text-end fs-13" style={{ color: r.tds ? '#a06f00' : 'var(--vz-secondary-color)' }}>
                            {r.tds === 0 ? '₹0' : `₹${fmtINR(r.tds)}`}
                          </td>
                          <td className="text-end fs-13">{dim(r.lopDeducted)}</td>
                          <td className="text-end fs-13">{dim(r.advanceRec)}</td>
                          <td className="text-end fs-13" style={{ color: '#b1401d', fontWeight: 600 }}>
                            −₹{fmtINR(totalDeductions)}
                          </td>
                          <td className="text-end fs-13 fw-bold" style={{ color: '#108548' }}>
                            ₹{fmtINR(netPayable)}
                          </td>
                          <td className="text-center">
                            <span className="onb-pill" style={{ background: tone.bg, color: tone.fg, fontSize: 11 }}>
                              <span className="d" style={{ background: tone.dot }} />
                              {r.status}
                            </span>
                          </td>
                          <td className="pe-3 text-center">
                            <button
                              type="button"
                              className="onb-vault-btn"
                              title="Download payslip"
                              onClick={() => openPayslip(r)}
                            >
                              <i className="ri-file-download-line" style={{ fontSize: 14 }} />
                              Payslip
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Salary Setup tab — configure employee salary structures ── */}
          {tab === 'salary' && (
            <>
              <div className="pay-banner d-flex align-items-center gap-2 mb-3" style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>
                <i className="ri-information-line" style={{ fontSize: 15 }} />
                Set each employee's salary here. Employees without a structure (or annual salary) show ₹0 and are held during payroll.
              </div>
              <div className="table-responsive table-card rounded p-2">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Employee</th>
                      <th>Emp ID</th>
                      <th>Department</th>
                      <th className="text-end">Monthly Gross</th>
                      <th className="text-center">Source</th>
                      <th className="text-center">PF</th>
                      <th className="pe-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterLoading ? (
                      <ShimmerTableRows rows={6} cols={7} keyPrefix="shim-sal" />
                    ) : roster.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-5 text-muted">
                        <i className="ri-team-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                        No employees found for this branch
                      </td></tr>
                    ) : roster.map(emp => {
                      const accent = '#7c5cfc';
                      const initials = (emp.name || 'NA').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
                      const sourceTone = emp.source === 'structure'
                        ? { bg: '#d6f4e3', fg: '#108548', label: 'Structure' }
                        : emp.source === 'annual_salary'
                          ? { bg: '#fdf3d6', fg: '#a06f00', label: 'Annual (fallback)' }
                          : { bg: '#fde7e3', fg: '#b1401d', label: 'Not set' };
                      return (
                        <tr key={emp.employee_id}>
                          <td className="ps-3">
                            <div className="d-flex align-items-center gap-2">
                              <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
                                {initials}
                              </div>
                              <div className="fw-semibold fs-13">{emp.name}</div>
                            </div>
                          </td>
                          <td><span className="onb-id-pill">{emp.emp_code || `EMP-${emp.employee_id}`}</span></td>
                          <td className="fs-13">{emp.department || '—'}</td>
                          <td className="text-end fs-13 fw-bold">
                            {emp.monthly_gross ? `₹${fmtINR(emp.monthly_gross)}` : <span className="text-muted">₹0</span>}
                            {emp.version ? <span className="text-muted ms-1" style={{ fontSize: 10.5 }}>v{emp.version}</span> : null}
                          </td>
                          <td className="text-center">
                            <span className="onb-pill" style={{ background: sourceTone.bg, color: sourceTone.fg, fontSize: 11 }}>{sourceTone.label}</span>
                          </td>
                          <td className="text-center fs-13">{emp.pf_eligible ? <i className="ri-check-line text-success" /> : <span className="text-muted">—</span>}</td>
                          <td className="pe-3 text-center">
                            <button type="button" className="onb-vault-btn" onClick={() => setSalaryEmp(emp)}>
                              <i className={`me-1 ${emp.has_structure ? 'ri-edit-line' : 'ri-add-line'}`} style={{ fontSize: 13 }} />
                              {emp.has_structure ? 'Revise' : 'Set Salary'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Pagination — only for the payslip-row tabs (not Salary Setup). */}
          {tab !== 'salary' && (
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
          )}
        </CardBody>
      </Card>

      {/* ── Proceed-to-Pay disbursement flow (mode → advice → 3-level sign-off → initiate) ── */}
      <PaymentDisbursementModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        runId={paymentRunId}
        cycleLabel={cycle.label}
        onPaid={() => { reloadCycle(); }}
      />

      {/* ── Salary Structure editor — set/revise an employee's salary ── */}
      <SalaryStructureModal
        open={!!salaryEmp}
        employee={salaryEmp}
        onClose={() => setSalaryEmp(null)}
        onSaved={loadRoster}
      />

      {/* ── Payroll Run Modal — pre-flight checks → success → proceed-to-pay ── */}
      <PayrollRunModal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        onProceedToPay={proceedToPay}
        cycleLabel={cycle.label}
        totalEmployees={counts.totalEmployees}
        totalPayrollLabel={fmtINRShort(counts.totalPayroll)}
        blockedAmountLabel={fmtINRShort(blockedAmount)}
        atRiskAmountLabel={fmtINRShort(atRiskAmount)}
        issues={runIssues}
        onAction={handleIssueAction}
      />

      {/* ── Payslip Viewer Modal ──
          Earnings split is synthesized 50/25/25 (Basic / HRA / Special) since
          the row only carries a single gross figure; deductions are taken
          straight from the row's individual heads. Wire to /api/payslips for
          the real component-level breakdown when available. */}
      {paySlipRow && (() => {
        const r = paySlipRow;
        const basic   = Math.round(r.earnings * 0.50);
        const hra     = Math.round(r.earnings * 0.25);
        const special = r.earnings - basic - hra;
        // Prefer the real structure breakup; synthesize 50/25/25 only as a
        // fallback when the detail fetch hasn't landed.
        const earnings: PayslipLine[] = payslipBreakup?.earnings?.length
          ? payslipBreakup.earnings
          : [
              { label: 'Basic Salary',          amount: basic },
              { label: 'House Rent Allowance (HRA)', amount: hra },
              { label: 'Special Allowance',     amount: special },
            ];
        const deductions: PayslipLine[] = payslipBreakup?.deductions?.length
          ? payslipBreakup.deductions
          : [
              { label: 'Professional Tax',     amount: r.pt },
              { label: 'Provident Fund (12%)', amount: r.pfEmp },
              ...(r.esi         > 0 ? [{ label: 'ESI',                amount: r.esi }]         : []),
              { label: 'Income Tax (TDS)',     amount: r.tds },
              ...(r.lopDeducted > 0 ? [{ label: 'Loss of Pay',        amount: r.lopDeducted }] : []),
              ...(r.advanceRec  > 0 ? [{ label: 'Advance Recovery',   amount: r.advanceRec }]  : []),
            ];
        // Pretty-print the cycle key ('mar-2026' → 'March' / '2026') so the
        // modal opens directly on the row's payroll period.
        const [mAbbr, yStr] = cycle.label.split(' ');
        const monthFull = ({
          Jan:'January', Feb:'February', Mar:'March', Apr:'April', May:'May', Jun:'June',
          Jul:'July', Aug:'August', Sep:'September', Oct:'October', Nov:'November', Dec:'December',
        } as Record<string,string>)[mAbbr] || mAbbr;
        return (
          <PayslipViewerModal
            open={true}
            onClose={closePayslip}
            employee={{
              name: r.name,
              empId: r.empId,
              designation: r.designation,
              department: r.department,
            }}
            defaultMonth={monthFull}
            defaultYear={yStr}
            earnings={earnings}
            deductions={deductions}
            workingDays={periodMeta?.working_days || 26}
            daysPresent={r.present}
            lossOfPay={Math.max(0, (periodMeta?.working_days || 26) - r.attendance)}
            paidDays={r.attendance}
            isFinal={payslipFinal}
            onSelectRecent={selectRecent}
            recentMonths={payslipRecent}
            payslipId={r.payslip_id}
            companyName={payslipCompany?.name || undefined}
            companyMeta={payslipCompany?.meta || undefined}
            companyInitials={payslipCompany?.initials || undefined}
            hrEmail={payslipCompany?.hrEmail || undefined}
          />
        );
      })()}
    </>
  );
}
