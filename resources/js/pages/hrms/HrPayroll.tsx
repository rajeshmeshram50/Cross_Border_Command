import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardBody, Col, Row, Button, Input, Dropdown, DropdownToggle, DropdownMenu, DropdownItem, Spinner } from 'reactstrap';
import * as XLSX from 'xlsx';
import { MasterFormStyles, MasterSelect } from '../master/masterFormKit';
import PayslipViewerModal, { type PayslipLine } from '../../components/PayslipViewerModal';
import PayrollRunModal, { type PayrollRunIssue, type PayrollSandwichItem, type PayrollExcludedItem } from '../../components/PayrollRunModal';
import SalaryStructureModal, { type SalaryEmployeeLite } from '../../components/SalaryStructureModal';
import PaymentDisbursementModal from '../../components/PaymentDisbursementModal';
import { useToast } from '../../contexts/ToastContext';
import { Shimmer } from '../../components/ui/Shimmer';
import DataTable, { TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import api from '../../api';
import '../../../css/recruitment.css';
import '../employee-onboarding/HrEmployeeOnboarding.css';

type CycleStatus = 'Completed' | 'In Progress' | 'Not Started';
type RowStatus   = 'Ready' | 'Processed' | 'Pending Review' | 'On Hold' | 'Paid';
type AttSource   = 'Biometric' | 'Review' | 'Manual';

interface CycleMonth {
  key: string;
  label: string;
  range: string;
  status: CycleStatus;
  month?: number;
  year?: number;
  /** Month hasn't started — frozen, nothing to process. */
  is_future?: boolean;
  /** Label of the earlier cycle that must be completed first (null when clear). */
  blocked_by?: string | null;
  /** Server's verdict: may this cycle be finalized/run right now? */
  processable?: boolean;
  /** Latest run's status for the cycle (draft/generated/approved/paid). */
  run_status?: string | null;
  /** Run is approved/paid — frozen against regeneration (Rule 14). */
  run_locked?: boolean;
}

interface SeqInfo {
  blocked_by?: string | null;
  processable?: boolean;
  run_status?: string | null;
  run_locked?: boolean;
}

interface PayrollRow {
  id: string;
  payslip_id?: number;
  employee_id?: number;
  empId: string;
  /** URL-safe encrypted employee id — used to open the profile via an opaque
   *  token instead of the readable EMP-### code (matches the employee list). */
  encryptedId?: string | null;
  name: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  ctc: number;
  earnings: number;
  deductions: number;
  netPay: number;
  attendance: number;
  status: RowStatus;
  attMismatch?: boolean;
  present: number;
  absent: number;
  lateMarks: number;
  missingPunch: number;
  unpaidLeave: number;
  paidLeave: number;
  attSource: AttSource;
  mismatch?: string;
  pfEmp: number;
  esi: number;
  pt: number;
  tds: number;
  lopDeducted: number;
  lop_days?: number;
  workingDays?: number;
  advanceRec: number;
  holdReason?: string | null;
  reasons?: string[];
  bankVerified?: boolean;
}

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const fmtINRShort = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const monthKey = (year: number, monthIdx: number) => `${MONTHS_SHORT[monthIdx].toLowerCase()}-${year}`;

// Indian financial year (Apr–Mar) of a cycle, e.g. Jan 2027 → "2026-27".
// Mirrors PayrollPeriod::financialYearFor() on the backend so a synthesised
// (not-yet-created) month shows the same FY the period will get. (PAY-49)
const financialYearOf = (month?: number, year?: number): string => {
  if (!month || !year) return '';
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

// Build the full 12-month cycle list for a year, merging real per-month status
// from the backend /payroll/cycles payload (keyed `${year}-${month}`); months
// the backend hasn't surfaced yet default to 'Not Started'.
//
// Only the FUTURE is clamped here: a month that hasn't started can't have a
// status. Past months keep the server's verdict verbatim.
//
// They used to be flattened to "Completed | Not Started" on the theory that a
// lingering unpaid period was noise. That was wrong twice over: a past cycle
// whose run is generated/approved really is in progress, and since cycles must
// now run in order it is also what blocks every later month. Painting it
// "Not Started" sent HR to click Run, which then failed with "already
// approved/paid and cannot be regenerated".
const buildYearMonths = (
  year: number,
  statusByKey: Record<string, CycleStatus>,
  today: Date,
  seqByKey: Record<string, SeqInfo> = {},
): CycleMonth[] => {
  const curYear = today.getFullYear();
  const curMonth = today.getMonth() + 1;
  return MONTHS_SHORT.map((mon, idx) => {
    const m = idx + 1;
    const upper = mon.toUpperCase();
    const lastDay = new Date(year, m, 0).getDate();
    const raw = statusByKey[`${year}-${m}`] ?? 'Not Started';
    const isFuture = year > curYear || (year === curYear && m > curMonth);
    const status: CycleStatus = isFuture ? 'Not Started' : raw;
    // Sequencing comes from the server (it owns the rule). Months outside the
    // trailing 13-month window carry no verdict: a future one is frozen here,
    // and for anything else we stay permissive and let the 422 speak.
    const seq = seqByKey[`${year}-${m}`];
    return {
      key: monthKey(year, idx),
      label: `${mon} ${year}`,
      range: `01 ${upper}–${lastDay} ${upper}`,
      month: m,
      year,
      status,
      is_future: isFuture,
      blocked_by: isFuture ? null : (seq?.blocked_by ?? null),
      processable: isFuture ? false : (seq?.processable ?? true),
      run_status: seq?.run_status ?? null,
      run_locked: !isFuture && !!seq?.run_locked,
    };
  });
};

const CYCLE_TONES: Record<CycleStatus, { bg: string; fg: string; dot: string }> = {
  'Completed':   { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'In Progress': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'Not Started': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

const ROW_TONES: Record<string, { bg: string; fg: string; dot: string }> = {
  'Ready':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Processed':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Pending Review': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'On Hold':        { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
  'Paid':           { bg: '#d6f4e3', fg: '#0a7d5a', dot: '#0ab39c' },
};

const toneFor = (status: string) => ROW_TONES[status] ?? ROW_TONES['Processed'];


const STATUS_OPTIONS: { value: 'All' | RowStatus; label: string }[] = [
  { value: 'All',            label: 'All' },
  { value: 'Ready',          label: 'Ready' },
  { value: 'Processed',      label: 'Processed' },
  { value: 'Pending Review', label: 'Pending Review' },
  { value: 'On Hold',        label: 'On Hold' },
  { value: 'Paid',           label: 'Paid' },
];

const KPI_CARDS = [
  { key: 'totalPayroll',   label: 'Total Payroll',     icon: 'ri-money-dollar-circle-line', tint: '#d6f4e3', fg: '#108548', strip: '#10b981', mode: 'currency' as const },
  { key: 'readyProcessed', label: 'Ready / Processed', icon: 'ri-checkbox-circle-line',    tint: '#dceefe', fg: '#0c63b0', strip: '#3b82f6', mode: 'fraction' as const },
  { key: 'pendingReview',  label: 'Pending Review',    icon: 'ri-time-line',               tint: '#fdf3d6', fg: '#a06f00', strip: '#f59e0b', mode: 'count' as const },
  { key: 'onHold',         label: 'On Hold',           icon: 'ri-error-warning-line',      tint: '#fdd9d6', fg: '#b1401d', strip: '#f06548', mode: 'count' as const },
] as const;

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

export default function HrPayroll() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // When we jump out of the "Payroll Execution Blocked" popup to fix an issue
  // (Open Employee / Go to Attendance), tag the navigation with a return
  // context. The destination's Back/Close reads `returnPage` and comes back
  // here instead of the generic Active-Employees list (#38). `reopenRun` then
  // re-surfaces the popup so the payroll-execution context is preserved.
  const returnCtx = { returnPage: 'hr-payroll', returnData: { reopenRun: true } };

  const handleIssueAction = (action: { kind?: string }, issue: { empCode?: string; encryptedId?: string | null }) => {
    setRunOpen(false);
    if (action.kind === 'attendance') {
      navigate('/hr/attendance', { state: returnCtx });
    } else if (action.kind === 'employee' && (issue.encryptedId || issue.empCode)) {
      // Prefer the opaque encrypted token so the URL never exposes EMP-###.
      navigate(`/hr/employees/${encodeURIComponent(issue.encryptedId || issue.empCode!)}/profile`, { state: returnCtx });
    }
  };

  const today = useMemo(() => new Date(), []);

  // Raw backend cycle statuses (trailing window from /payroll/cycles), keyed
  // by `${year}-${month}`. The visible strip is generated one full year at a
  // time from this map — no hardcoded month seed on the frontend.
  const [rawCycles, setRawCycles] = useState<CycleMonth[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());

  const statusByKey = useMemo(() => {
    const map: Record<string, CycleStatus> = {};
    for (const c of rawCycles) {
      if (c.year && c.month) map[`${c.year}-${c.month}`] = c.status;
    }
    return map;
  }, [rawCycles]);

  // Sequencing verdict per month, straight from the server (which owns the
  // "cycles run in order" rule) — keyed the same way as statusByKey.
  const seqByKey = useMemo(() => {
    const map: Record<string, SeqInfo> = {};
    for (const c of rawCycles) {
      if (c.year && c.month) {
        map[`${c.year}-${c.month}`] = {
          blocked_by: c.blocked_by, processable: c.processable,
          run_status: c.run_status, run_locked: c.run_locked,
        };
      }
    }
    return map;
  }, [rawCycles]);

  // The 12 months of the selected year — drives the strip + the hero dropdown.
  const cycleMonths = useMemo(
    () => buildYearMonths(selectedYear, statusByKey, today, seqByKey),
    [selectedYear, statusByKey, today, seqByKey],
  );

  // Years offered in the picker — whichever the backend returned, plus the
  // selected and current years.
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    rawCycles.forEach(c => { if (c.year) years.add(c.year); });
    years.add(selectedYear);
    years.add(today.getFullYear());
    return Array.from(years).sort((a, b) => a - b).map(y => ({ value: String(y), label: String(y) }));
  }, [rawCycles, selectedYear, today]);

  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [periodMeta, setPeriodMeta] = useState<{ attendance_finalized: boolean; status: string; run_status: string | null; working_days?: number; total_month_days?: number } | null>(null);
  const [runMeta, setRunMeta] = useState<{ id: number; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const [cycleKey, setCycleKey] = useState<string>(monthKey(today.getFullYear(), today.getMonth()));
  const [cycleCollapsed, setCycleCollapsed] = useState(false);

  const [tab, setTab] = useState<'processing' | 'biometric' | 'report' | 'salary'>('processing');

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
  useEffect(() => { if (tab === 'salary' && roster.length === 0) loadRoster(); /* eslint-disable-next-line */ }, [tab]);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | RowStatus>('All');
  const [departments, setDepartments]   = useState<string[]>([]);

  useEffect(() => {
    api.get('/master/departments')
      .then((res: any) => {
        const arr = Array.isArray(res?.data) ? res.data : [];
        setDepartments(arr
          .filter((d: any) => (d.status ?? 'Active') === 'Active')
          .map((d: any) => String(d.name ?? '').trim())
          .filter(Boolean));
      })
      .catch(() => setDepartments([]));
  }, []);

  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    departments.forEach(n => { if (n) set.add(n); });
    rows.forEach(r => { const n = (r.department || '').trim(); if (n) set.add(n); });
    return [
      { value: 'All', label: 'All' },
      ...Array.from(set).sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n })),
    ];
  }, [departments, rows]);

  const [paySlipRow, setPaySlipRow] = useState<PayrollRow | null>(null);
  const [payslipBreakup, setPayslipBreakup] = useState<{ earnings: PayslipLine[]; deductions: PayslipLine[] } | null>(null);
  const [payslipFinal, setPayslipFinal] = useState<boolean | undefined>(undefined);
  const [payslipRecent, setPayslipRecent] = useState<{ label: string; now?: boolean; payslipId?: number; status?: string }[]>([]);
  const [payslipCompany, setPayslipCompany] = useState<{ name: string; meta: string; initials: string; hrEmail: string } | null>(null);
  // The payslip currently shown in the viewer. Starts as the opened row's slip
  // but switches when the user picks a different Month/Year (or Recent Payslip),
  // so View PDF / the day chips always reflect the SELECTED period — not the
  // period the modal was first opened on.
  const [activePayslipId, setActivePayslipId] = useState<number | undefined>(undefined);
  const [payslipDays, setPayslipDays] = useState<{ present?: number; lopDays?: number; totalMonthDays?: number; paidDays?: number; workingDays?: number; weekOffDays?: number } | null>(null);
  /* Overtime for the open payslip. Only populated for employees the employee
     master marks overtime-applicable — drives the OT Hours KPI and the
     Overtime Allowance earnings line. */
  const [payslipOt, setPayslipOt] = useState<{
    applicable: boolean; hours: number; detectedHours: number; pricedHours?: number; amount: number;
    multiplier?: number; hourly?: number; rate?: number; rateName?: string | null;
  } | null>(null);

  const loadPayslipDetail = (payslipId?: number) => {
    if (!payslipId) return;
    setActivePayslipId(payslipId);
    api.get(`/payroll/payslip/${payslipId}`)
      .then(res => {
        const d = res.data?.data ?? {};
        const e = (d.earningsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 }));
        const ded = (d.deductionsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 }));
        setPayslipBreakup(e.length || ded.length ? { earnings: e, deductions: ded } : null);
        setPayslipDays({
          present: typeof d.present === 'number' ? d.present : undefined,
          lopDays: typeof d.lopDays === 'number' ? d.lopDays : undefined,
          totalMonthDays: typeof d.totalMonthDays === 'number' ? d.totalMonthDays : undefined,
          // Authoritative server-computed day counts — paid_days + lop_days =
          // working_days. Use these instead of re-deriving Paid Days on the
          // client (which mixed calendar-month total with working-day LOP). (#33)
          paidDays: typeof d.paidDays === 'number' ? d.paidDays : undefined,
          workingDays: typeof d.workingDays === 'number' ? d.workingDays : undefined,
        });
        setPayslipOt(d.overtimeApplicable ? {
          applicable: true,
          hours:      Number(d.overtimeHours) || 0,
          detectedHours: Number(d.overtimeDetectedHours) || 0,
          // Hours the stored amount was priced on — the workings quote these,
          // NOT the live detected hours.
          pricedHours: typeof d.overtimePricedHours === 'number' ? d.overtimePricedHours : undefined,
          amount:     Number(d.overtimeAmount) || 0,
          multiplier: typeof d.overtimeMultiplier === 'number' ? d.overtimeMultiplier : undefined,
          hourly:     typeof d.overtimeHourly === 'number' ? d.overtimeHourly : undefined,
          rate:       typeof d.overtimeRate === 'number' ? d.overtimeRate : undefined,
          rateName:   d.overtimeRateName ?? null,
        } : null);
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
      .catch(() => {});
  };

  const openPayslip = (row: PayrollRow) => {
    setPaySlipRow(row);
    setPayslipBreakup(null);
    setPayslipFinal(undefined);
    setPayslipCompany(null);
    setActivePayslipId(row.payslip_id);
    setPayslipDays(null);
    setPayslipOt(null);
    setPayslipRecent(row.payslip_id ? [{ label: cycle.label, now: true, payslipId: row.payslip_id, status: row.status }] : []);
    loadPayslipDetail(row.payslip_id);
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
        .catch(() => {});
    }
  };
  const selectRecent = (entry: { payslipId?: number }) => loadPayslipDetail(entry.payslipId);
  const closePayslip = () => { setPaySlipRow(null); setPayslipBreakup(null); setPayslipFinal(undefined); setPayslipRecent([]); setPayslipCompany(null); setActivePayslipId(undefined); setPayslipDays(null); };

  const [runOpen, setRunOpen] = useState(false);
  const [proceeding, setProceeding] = useState(false);

  const runIssues = useMemo<PayrollRunIssue[]>(() => {
    const list: PayrollRunIssue[] = [];
    for (const r of rows) {
      const realReasons = (r.reasons && r.reasons.length) ? r.reasons : null;
      if (r.status === 'On Hold') {
        const reasons: string[] = realReasons ?? [];
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
          encryptedId: r.encryptedId,
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
        const reasons: string[] = realReasons ?? [];
        if (!reasons.length) {
          if (r.mismatch)        reasons.push(r.mismatch);
          if (r.lateMarks > 0)   reasons.push(`${r.lateMarks} late mark${r.lateMarks === 1 ? '' : 's'} flagged`);
          if (!reasons.length)   reasons.push('Attendance review pending');
        }
        list.push({
          id: r.id,
          type: 'warning',
          empCode: r.empId,
          encryptedId: r.encryptedId,
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

  const blockedAmount = useMemo(
    () => rows.filter(r => r.status === 'On Hold').reduce((s, r) => s + r.netPay, 0),
    [rows],
  );
  const atRiskAmount  = useMemo(
    () => rows.filter(r => (r.attMismatch || r.mismatch) && r.status !== 'On Hold').reduce((s, r) => s + r.netPay, 0),
    [rows],
  );

  /* Paging lives in <DataTable> now. */


  const [loading, setLoading] = useState(true);

  const cycle = useMemo(
    () => cycleMonths.find(c => c.key === cycleKey) ?? cycleMonths[0],
    [cycleKey, cycleMonths],
  );

  /* Sandwich Leave Policy review for the open cycle — the list HR acts on
     inside the run modal. Loaded only while that modal is open: it is a
     per-employee, per-leave computation and there is no reason to pay for it
     on every page render. */
  const [sandwichItems, setSandwichItems] = useState<PayrollSandwichItem[]>([]);
  /* Keyed by leave_id, not by employee code.
     An employee's card lists every sandwiched leave they have, and the code
     matched all of them — so waiving ONE row put "Saving…" on every button in
     the card and made it look like they were all being changed. */
  const [sandwichBusyIds, setSandwichBusyIds] = useState<number[]>([]);

  const loadSandwichReview = useCallback(async () => {
    if (!cycle) return;
    try {
      const res = await api.get('/payroll/sandwich-review', {
        params: { month: cycle.month, year: cycle.year },
      });
      setSandwichItems(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      // Non-fatal: the review list is an aid, not a gate. A failure here must
      // not stop HR from running payroll.
      setSandwichItems([]);
    }
  }, [cycle]);

  useEffect(() => { if (runOpen) loadSandwichReview(); }, [runOpen, loadSandwichReview]);

  /* Employees the backend deliberately held OUT of this run — exited in the
     cycle (settled through F&F), resigned within 15 days of joining, or still
     half-onboarded. The API has always returned these on /payroll/preflight,
     but nothing read them, so an employee missing from the run looked like a
     bug with no explanation anywhere on the screen. Fetched with the modal,
     same as the sandwich review. */
  const [excluded, setExcluded] = useState<PayrollExcludedItem[]>([]);

  const loadExclusions = useCallback(async () => {
    if (!cycle) return;
    try {
      const res = await api.get('/payroll/preflight', {
        params: { month: cycle.month, year: cycle.year },
      });
      setExcluded(Array.isArray(res.data?.data?.excluded) ? res.data.data.excluded : []);
    } catch {
      // Non-fatal, like the sandwich review — an explanation panel must never
      // block the run itself.
      setExcluded([]);
    }
  }, [cycle]);

  useEffect(() => { if (runOpen) loadExclusions(); }, [runOpen, loadExclusions]);

  /* Excuse every still-charged sandwich leave for ONE employee.
     Sequential, not Promise.all: each call re-sizes leave_requests.days, and
     the sandwich for one leave can depend on a neighbouring one — firing them
     together would let two requests size themselves against the same stale
     picture. One refresh at the end rather than per leave. */
  const waiveSandwich = useCallback(async (items: PayrollSandwichItem[]) => {
    if (!items.length) return;
    setSandwichBusyIds(items.map(i => i.leave_id));
    try {
      for (const it of items) {
        await api.post(`/leave-requests/${it.leave_id}/sandwich-waiver`, { waived: true });
      }
      await loadSandwichReview();
      toast.success(
        'Off-days excused',
        `${items[0].emp_name} — re-run payroll to pick up the new day count.`,
      );
    } catch (err: any) {
      toast.error('Could not update', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      setSandwichBusyIds([]);
    }
  }, [loadSandwichReview, toast]);

  // Bug #22 — a cycle whose month hasn't started yet (e.g. July while it's June)
  // has no attendance to process; payroll for it must not be generated. Backend
  // enforces this too, but we disable the button so HR gets a clear signal
  // instead of a 422 after clicking.
  const isFutureCycle = useMemo(() => {
    if (!cycle) return false;
    if (cycle.is_future !== undefined) return cycle.is_future;
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    return (cycle.year ?? 0) > curYear || (cycle.year === curYear && (cycle.month ?? 0) > curMonth);
  }, [cycle, today]);

  /* Cycles run in order: a month can't be processed while an earlier one is
     still open (PayrollController::guardPreviousCycleComplete). The server
     refuses it either way — this just turns a 422-after-clicking into a
     disabled button that says which cycle is in the way. */
  const blockedByCycle = useMemo(
    () => (cycle && !cycle.is_future ? (cycle.blocked_by ?? null) : null),
    [cycle],
  );
  /* An approved/paid run is frozen against regeneration (Rule 14). Clicking Run
     on one used to fire the request and come back with "already approved/paid
     and cannot be regenerated" — disable it and say so up front instead. */
  const runLockedCycle = !!cycle?.run_locked;
  const cycleLocked = isFutureCycle || !!blockedByCycle || runLockedCycle;
  const cycleLockReason = isFutureCycle
    ? `${cycle?.label} hasn't started yet — a future cycle has no attendance to process.`
    : blockedByCycle
      ? `Complete the ${blockedByCycle} payroll first — cycles must be processed in order.`
      : runLockedCycle
        ? `${cycle?.label} is already ${cycle?.run_status} — reopen the cycle to re-run it.`
        : undefined;

  // Switch the displayed year — keep the same month if possible, else snap to
  // the live (In Progress) cycle of that year, else its first month.
  const selectYear = (y: number) => {
    const months = buildYearMonths(y, statusByKey, today, seqByKey);
    // Never land on a frozen (future) month — it can't be processed and the
    // chip isn't even selectable, so snapping to it would strand the page.
    const open = months.filter(m => !m.is_future);
    const sameMonth = cycle ? open.find(m => m.month === cycle.month) : undefined;
    const live = open.find(m => m.status === 'In Progress');
    setSelectedYear(y);
    setCycleKey((sameMonth ?? live ?? open[open.length - 1] ?? months[0]).key);
  };

  useEffect(() => {
    api.get('/payroll/cycles')
      .then(res => {
        const list = (res.data?.data ?? []) as CycleMonth[];
        if (Array.isArray(list) && list.length) {
          setRawCycles(list);
          // Always default the year dropdown to the CURRENT year (#37). The
          // strip is a trailing 13-month window (oldest→newest) where every
          // empty month reads "Not Started", so the old `find(In Progress ||
          // Not Started)` matched the oldest month and snapped the year to the
          // prior year. We now pin the year to `today` unconditionally so the
          // dropdown never lands on a past year — even when the only active
          // cycle belongs to a prior year (e.g. 2026 not yet started). Within
          // the current year, snap the cycle to: this year's active cycle →
          // the current month → this year's first month.
          const curY = today.getFullYear();
          const curM = today.getMonth() + 1;
          setSelectedYear(curY);
          const cur =
            list.find(c => c.status === 'In Progress' && c.year === curY)
            ?? list.find(c => c.year === curY && c.month === curM);
          setCycleKey(monthKey(curY, (cur?.month ?? curM) - 1));
        }
      })
      .catch(() => {});
  }, []);

  // Returning from Open Employee / Go to Attendance (#38): re-surface the
  // "Payroll Execution Blocked" popup once the cycle's rows have loaded, so the
  // user lands back where they left off instead of on Active Employees. Fires
  // once, then strips the flag from history so a refresh/back won't reopen it.
  const reopenHandled = useRef(false);
  useEffect(() => {
    if (reopenHandled.current) return;
    if ((location.state as { reopenRun?: boolean } | null)?.reopenRun && rows.length) {
      reopenHandled.current = true;
      setRunOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, rows, navigate]);

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

  const runPayroll = async () => {
    if (busy) return;
    const month = cycle?.month, year = cycle?.year;
    if (!month || !year) { toast.error('Run failed', 'Select a valid cycle first.'); return; }
    if (isFutureCycle) {
      toast.error('Cycle not started', `${cycle.label} hasn't begun yet — payroll can be run once the period starts.`);
      return;
    }
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

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentRunId, setPaymentRunId] = useState<number | null>(null);
  const proceedToPay = async () => {
    if (!runMeta?.id) { setRunOpen(false); return; }
    if (proceeding) return;
    setProceeding(true);
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
      setProceeding(false);
    }
  };

  /* Jump straight to this cycle's payroll sheet.
   *
   * This replaced the header's Reopen action. Reopening wipes a generated run
   * so it can be re-run, which is a destructive correction step and a poor
   * neighbour to Run Payroll / Export — the common intent from here is simply
   * to look at what was generated. Correction still exists via the run modal's
   * re-run path; it is just no longer one stray click from the header. */
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const viewPayrollSheet = () => {
    setTab('processing');
    // After the tab switch has painted, so we scroll to the sheet's real spot.
    requestAnimationFrame(() => {
      sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /** A generated run exists for this cycle — there is a sheet worth viewing. */
  const hasRun = !!runMeta;

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
      let msg = 'Could not generate payslips.';
      if (err?.response?.status === 403) msg = 'You are not allowed to download payslips.';
      else if (err?.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text())?.message || msg; } catch {}
      }
      toast.error('Bulk download failed', msg);
    } finally {
      setDownloading(null);
    }
  };

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
        'Missing Punch': r.missingPunch,
        'Mismatch': r.mismatch ?? '',
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
        'Missing Punch': r.missing_punches,
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

  const counts = useMemo(() => {
    const totalEmployees = rows.length;
    const ready          = rows.filter(r => r.status === 'Ready').length;
    const processed      = rows.filter(r => r.status === 'Processed' || r.status === ('Paid' as RowStatus)).length;
    const pendingReview  = rows.filter(r => r.status === 'Pending Review').length;
    const onHold         = rows.filter(r => r.status === 'On Hold').length;
    const totalPayroll   = rows.reduce((s, r) => s + r.netPay, 0);
    const avgCtc         = totalEmployees ? Math.round(rows.reduce((s, r) => s + r.ctc, 0) / totalEmployees) : 0;
    const attMismatch    = rows.filter(r => r.attMismatch || r.attSource === 'Review').length;
    const syncedEmployees    = rows.filter(r => r.attSource === 'Biometric').length;
    const missingPunchCases  = rows.filter(r => r.missingPunch > 0).length;
    const mismatchCases      = rows.filter(r => r.attSource === 'Review').length;
    const unpaidLeaveCases   = rows.filter(r => r.unpaidLeave > 0).length;
    const paidLeaveCases     = rows.filter(r => r.paidLeave > 0).length;
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
      paidLeaveCases,
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

  /* ── Column sets for the shared <DataTable> ──────────────────────────────
     One per tab, since each tab shows a different projection of the same
     payroll rows (and Salary Setup shows the roster instead). Widths in each
     set sum to 100 — the tables run in table-layout:fixed. */
  const processingColumns = useMemo<DataTableColumn<PayrollRow>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      // wrap: monthly CTC sits on a second line under the name.
      meta: { width: '20%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
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
              <div className="fw-semibold fs-13 text-truncate">{r.name}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>CTC ₹{fmtINR(r.ctc)}/mo</div>
            </div>
          </div>
        );
      },
    },
    { header: 'Emp ID', accessorKey: 'empId', meta: { width: '9%' }, cell: info => <span className="onb-id-pill">{String(info.getValue() ?? '')}</span> },
    { header: 'Department',  accessorKey: 'department',  meta: { width: '11%' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Designation', accessorKey: 'designation', meta: { width: '12%' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Earnings',   accessorKey: 'earnings',   meta: { width: '9%', align: 'right' }, cell: info => <span className="fs-13 fw-semibold" style={{ color: '#108548' }}>₹{fmtINR(info.row.original.earnings)}</span> },
    { header: 'Deductions', accessorKey: 'deductions', meta: { width: '9%', align: 'right' }, cell: info => <span className="fs-13 fw-semibold" style={{ color: '#b1401d' }}>−₹{fmtINR(info.row.original.deductions)}</span> },
    { header: 'Net Pay',    accessorKey: 'netPay',     meta: { width: '9%', align: 'right' }, cell: info => <span className="fs-13 fw-bold">₹{fmtINR(info.row.original.netPay)}</span> },
    {
      /* Att. = days actually PRESENT per the attendance record (not paid_days,
         which also counts paid leave/holidays). Denominator is the cycle's
         working days, so full attendance reads green. (#36) */
      header: () => <div className="text-center">Att.</div>,
      accessorKey: 'present',
      meta: { width: '6%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        const wd = periodMeta?.working_days || 26;
        const low = r.present < wd;
        return (
          <span className="onb-role-pill pay-att-badge" data-att={low ? 'low' : 'ok'} style={low ? { background: '#fde8c4', color: '#a4661c' } : undefined}>
            {r.present}/{wd}
          </span>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '9%', align: 'center' },
      cell: info => {
        const tone = toneFor(info.row.original.status);
        return (
          <span className="onb-pill" style={{ background: tone.bg, color: tone.fg }}>
            <span className="d" style={{ background: tone.dot }} />
            {info.row.original.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: '6%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <button type="button" className="onb-edit-btn" title="View Payslip" onClick={() => openPayslip(r)}>
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
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [periodMeta?.working_days, pdfBusyId]);

  const biometricColumns = useMemo<DataTableColumn<PayrollRow>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      meta: { width: '28%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}
            >
              {r.initials}
            </div>
            <div className="min-w-0">
              <div className="fw-semibold fs-13 text-truncate">{r.name}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{r.empId}</div>
            </div>
          </div>
        );
      },
    },
    { header: () => <div className="text-center">Present</div>, accessorKey: 'present', meta: { width: '11%', align: 'center' }, cell: info => <span className="fs-13 fw-bold">{info.row.original.present}</span> },
    {
      header: () => <div className="text-center">Absent</div>,
      accessorKey: 'absent',
      meta: { width: '11%', align: 'center' },
      cell: info => <span className="fs-13 fw-bold" style={{ color: info.row.original.absent ? '#b1401d' : 'var(--vz-secondary-color)' }}>{info.row.original.absent}</span>,
    },
    {
      header: () => <div className="text-center">Late Marks</div>,
      accessorKey: 'lateMarks',
      meta: { width: '12%', align: 'center' },
      cell: info => <span className="fs-13 fw-semibold" style={{ color: info.row.original.lateMarks ? '#a06f00' : 'var(--vz-secondary-color)' }}>{info.row.original.lateMarks}</span>,
    },
    {
      header: () => <div className="text-center">Missing Punch</div>,
      accessorKey: 'missingPunch',
      meta: { width: '13%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <span
            className="onb-pill"
            style={r.missingPunch
              ? { background: '#fde7e3', color: '#b1401d', fontSize: 11 }
              : { background: '#eef2f6', color: '#5b6478', fontSize: 11 }}
          >
            {r.missingPunch}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Att. Status</div>,
      accessorKey: 'attSource',
      meta: { width: '13%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        const sourceTone =
          r.attSource === 'Biometric' ? { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' } :
          r.attSource === 'Review'    ? { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' } :
                                        { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' };
        return (
          <span className="onb-pill" style={{ background: sourceTone.bg, color: sourceTone.fg, fontSize: 11 }}>
            <span className="d" style={{ background: sourceTone.dot }} />
            {r.attSource}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Mismatch</div>,
      accessorKey: 'mismatch',
      meta: { width: '12%', align: 'center' },
      cell: info => {
        const m = info.row.original.mismatch;
        return m ? <span style={{ color: '#b1401d', fontWeight: 600 }} className="fs-13">{m}</span> : <span className="text-muted">—</span>;
      },
    },
  ], []);

  const reportColumns = useMemo<DataTableColumn<PayrollRow>[]>(() => {
    const dim = (n: number) => n === 0
      ? <span className="text-muted">—</span>
      : <span style={{ color: '#b1401d' }}>−₹{fmtINR(n)}</span>;
    // Derived per row and reused by both the deductions total and Net Payable.
    const totalDeductionsOf = (r: PayrollRow) => r.pfEmp + r.esi + r.pt + r.tds + r.lopDeducted + r.advanceRec;
    return [
      { header: 'Emp ID', accessorKey: 'empId', meta: { width: '8%' }, cell: info => <span style={{ color: '#5a3fd1', fontWeight: 600, fontSize: 12.5 }}>{String(info.getValue() ?? '')}</span> },
      {
        header: 'Employee',
        accessorKey: 'name',
        meta: { width: '14%' },
        cell: info => {
          const r = info.row.original;
          return (
            <div className="d-flex align-items-center gap-2">
              <div
                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}
              >
                {r.initials}
              </div>
              <div className="fw-semibold fs-13 text-truncate">{r.name}</div>
            </div>
          );
        },
      },
      { header: 'Gross Earnings',   accessorKey: 'earnings',    meta: { width: '9%', align: 'right' }, cell: info => <span className="fs-13 fw-semibold">₹{fmtINR(info.row.original.earnings)}</span> },
      { header: 'PF (Emp)',         accessorKey: 'pfEmp',       meta: { width: '7%', align: 'right' }, cell: info => <span className="fs-13" style={{ color: '#5a3fd1' }}>₹{fmtINR(info.row.original.pfEmp)}</span> },
      { header: 'ESI',              accessorKey: 'esi',         meta: { width: '6%', align: 'right' }, cell: info => <span className="fs-13">{info.row.original.esi === 0 ? <span className="text-muted">₹0</span> : `₹${fmtINR(info.row.original.esi)}`}</span> },
      { header: 'PT',               accessorKey: 'pt',          meta: { width: '6%', align: 'right' }, cell: info => <span className="fs-13">₹{fmtINR(info.row.original.pt)}</span> },
      {
        header: 'TDS',
        accessorKey: 'tds',
        meta: { width: '6%', align: 'right' },
        cell: info => <span className="fs-13" style={{ color: info.row.original.tds ? '#a06f00' : 'var(--vz-secondary-color)' }}>{info.row.original.tds === 0 ? '₹0' : `₹${fmtINR(info.row.original.tds)}`}</span>,
      },
      { header: 'LOP Deducted', accessorKey: 'lopDeducted', meta: { width: '8%', align: 'right' }, cell: info => <span className="fs-13">{dim(info.row.original.lopDeducted)}</span> },
      { header: 'Advance Rec.', accessorKey: 'advanceRec',  meta: { width: '8%', align: 'right' }, cell: info => <span className="fs-13">{dim(info.row.original.advanceRec)}</span> },
      {
        header: 'Total Deductions',
        id: 'totalDeductions',
        accessorFn: (r: PayrollRow) => totalDeductionsOf(r),
        meta: { width: '9%', align: 'right' },
        cell: info => <span className="fs-13" style={{ color: '#b1401d', fontWeight: 600 }}>−₹{fmtINR(totalDeductionsOf(info.row.original))}</span>,
      },
      {
        header: 'Net Payable',
        id: 'netPayable',
        accessorFn: (r: PayrollRow) => r.earnings - totalDeductionsOf(r),
        meta: { width: '9%', align: 'right' },
        cell: info => <span className="fs-13 fw-bold" style={{ color: '#108548' }}>₹{fmtINR(info.row.original.earnings - totalDeductionsOf(info.row.original))}</span>,
      },
      {
        header: () => <div className="text-center">Status</div>,
        accessorKey: 'status',
        meta: { width: '5%', align: 'center' },
        cell: info => {
          const tone = toneFor(info.row.original.status);
          return (
            <span className="onb-pill" style={{ background: tone.bg, color: tone.fg, fontSize: 11 }}>
              <span className="d" style={{ background: tone.dot }} />
              {info.row.original.status}
            </span>
          );
        },
      },
      {
        header: () => <div className="text-center">Payslip</div>,
        id: '__payslip',
        enableSorting: false,
        meta: { width: '5%', align: 'center' },
        cell: info => {
          const r = info.row.original;
          // A payslip cannot be generated until the payroll status is resolved —
          // On Hold / Pending Review slips are blocked.
          const payslipBlocked = r.status === 'On Hold' || r.status === 'Pending Review';
          return (
            <button
              type="button"
              className="onb-vault-btn"
              title={payslipBlocked ? `Payslip unavailable while status is ${r.status}` : 'Download payslip'}
              disabled={payslipBlocked}
              style={payslipBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => { if (!payslipBlocked) openPayslip(r); }}
            >
              <i className={`${payslipBlocked ? 'ri-lock-line' : 'ri-file-download-line'}`} style={{ fontSize: 14 }} />
              Payslip
            </button>
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rosterColumns = useMemo<DataTableColumn<SalaryEmployeeLite>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      meta: { width: '26%' },
      cell: info => {
        const emp = info.row.original;
        const accent = '#7c5cfc';
        const initials = (emp.name || 'NA').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
        return (
          <div className="d-flex align-items-center gap-2">
            <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
              {initials}
            </div>
            <div className="fw-semibold fs-13 text-truncate">{emp.name}</div>
          </div>
        );
      },
    },
    {
      header: 'Emp ID',
      id: 'emp_code',
      accessorFn: (e: SalaryEmployeeLite) => e.emp_code || `EMP-${e.employee_id}`,
      meta: { width: '12%' },
      cell: info => <span className="onb-id-pill">{String(info.getValue() ?? '')}</span>,
    },
    { header: 'Department', accessorKey: 'department', meta: { width: '16%' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Monthly Gross',
      accessorKey: 'monthly_gross',
      meta: { width: '15%', align: 'right' },
      cell: info => {
        const emp = info.row.original;
        return (
          <span className="fs-13 fw-bold">
            {emp.monthly_gross ? `₹${fmtINR(emp.monthly_gross)}` : <span className="text-muted">₹0</span>}
            {emp.version ? <span className="text-muted ms-1" style={{ fontSize: 10.5 }}>v{emp.version}</span> : null}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Source</div>,
      accessorKey: 'source',
      meta: { width: '13%', align: 'center' },
      cell: info => {
        const emp = info.row.original;
        const sourceTone = emp.source === 'structure'
          ? { bg: '#d6f4e3', fg: '#108548', label: 'Structure' }
          : emp.source === 'annual_salary'
            ? { bg: '#fdf3d6', fg: '#a06f00', label: 'Annual (fallback)' }
            : { bg: '#fde7e3', fg: '#b1401d', label: 'Not set' };
        return <span className="onb-pill" style={{ background: sourceTone.bg, color: sourceTone.fg, fontSize: 11 }}>{sourceTone.label}</span>;
      },
    },
    {
      header: () => <div className="text-center">PF</div>,
      accessorKey: 'pf_eligible',
      meta: { width: '6%', align: 'center' },
      cell: info => info.row.original.pf_eligible ? <i className="ri-check-line text-success" /> : <span className="text-muted">—</span>,
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      /* 12%, not 8%: the "Set Salary" pill measures ~115px and the cell clips
         (no `wrap`, so the td's overflow:hidden cuts it) the moment the column
         is narrower than its content — at the table's 1200px floor 8% was only
         ~96px, which is exactly how the label lost its tail at the table edge. */
      meta: { width: '12%', align: 'center' },
      cell: info => {
        const emp = info.row.original;
        return (
          <button type="button" className="onb-vault-btn" onClick={() => setSalaryEmp(emp)}>
            <i className={`me-1 ${emp.has_structure ? 'ri-edit-line' : 'ri-add-line'}`} style={{ fontSize: 13 }} />
            {emp.has_structure ? 'Revise' : 'Set Salary'}
          </button>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  /* Department / Status pickers + result count — shared by the three tabs that
     list payroll rows (Salary Setup renders the roster and has no filters). */
  const payrollToolbarActions = (
    <>
      <div className="d-flex align-items-center gap-2">
        <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Department</span>
        <div style={{ minWidth: 160 }}>
          <MasterSelect value={deptFilter} onChange={setDeptFilter} options={deptOptions} placeholder="All" />
        </div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Status</span>
        <div style={{ minWidth: 160 }}>
          <MasterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as 'All' | RowStatus)} options={STATUS_OPTIONS} placeholder="All" />
        </div>
      </div>
      <div className="text-muted" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {filtered.length} results
      </div>
    </>
  );

  const cycleStripRef = useRef<HTMLDivElement | null>(null);
  const scrollCycle = (dir: 'prev' | 'next') => {
    const el = cycleStripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'next' ? 240 : -240, behavior: 'smooth' });
  };

  /* Future cycles are frozen, so they're kept out of the picker too — offering
     a month the Run button will refuse is just a dead end. The currently
     selected key is always kept so the control never shows an empty value. */
  const monthOptions = cycleMonths
    .filter(m => !m.is_future || m.key === cycleKey)
    .map(m => ({ value: m.key, label: m.blocked_by ? `${m.label} — after ${m.blocked_by}` : m.label }));

  return (
    <>
      <MasterFormStyles />
      <div className="pay-page">

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
              {financialYearOf(cycle.month, cycle.year) && (
                <span className="onb-hero-pill" title="Financial year (Apr–Mar)">
                  <span className="dot" />FY {financialYearOf(cycle.month, cycle.year)}
                </span>
              )}
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
            disabled={busy || cycleLocked}
            title={cycleLockReason}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              color: '#fff',
              background: 'linear-gradient(135deg,#0ab39c 0%,#078b78 100%)',
              boxShadow: '0 8px 18px rgba(90,63,209,0.32)',
              opacity: (busy || cycleLocked) ? 0.6 : 1,
            }}
          >
            {/* Animated spinner while processing (the static loader icon read as
                "no loader"). Matches the Export button's Spinner pattern. */}
            {busy
              ? <><Spinner size="sm" className="me-2" /> Processing…</>
              : <><i className="ri-play-circle-line me-2" style={{ fontSize: 16 }} /> Run Payroll</>}
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
            {/* Wears the SAME panel as every other dropdown on this page: the
                month picker and the tab filters are MasterSelects, which render
                `.master-select-menu` / `.master-select-item` (10px radius, 6px
                padding, soft shadow, rounded hover rows). This one was left on
                reactstrap's default menu — square corners, flat shadow, flush
                rows — so it read as a control from a different app. Reusing the
                classes rather than re-declaring the tokens keeps the two in
                step; the stylesheet ships via masterFormKit, already imported
                here. */}
            <DropdownMenu end container="body" strategy="fixed" className="master-select-menu" style={{ fontSize: 13, minWidth: 230 }}>
              <DropdownItem header>This cycle ({cycle.label})</DropdownItem>
              <DropdownItem className="master-select-item" toggle={false} disabled={!!downloading} onClick={exportExcelCurrent}>
                {downloading === 'excel' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-excel-2-line me-2 text-success" />} Excel (full data)
              </DropdownItem>
              <DropdownItem className="master-select-item" toggle={false} disabled={!!downloading} onClick={exportCsv}>
                {downloading === 'csv' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-text-line me-2" />} CSV
              </DropdownItem>
              <DropdownItem className="master-select-item" toggle={false} disabled={!!downloading} onClick={downloadAllPayslips}>
                {downloading === 'zip' ? <Spinner size="sm" className="me-2" /> : <i className="ri-file-zip-line me-2" />} All payslips (ZIP of PDFs)
              </DropdownItem>
              <DropdownItem className="master-select-item" toggle={false} disabled={!!downloading} onClick={emailAllPayslips}>
                {downloading === 'email' ? <Spinner size="sm" className="me-2" /> : <i className="ri-mail-send-line me-2" />} Email payslips to all
              </DropdownItem>
              <DropdownItem divider />
              <DropdownItem header>Overall</DropdownItem>
              <DropdownItem className="master-select-item" toggle={false} disabled={!!downloading} onClick={exportHistoryExcel}>
                {downloading === 'history' ? <Spinner size="sm" className="me-2" /> : <i className="ri-history-line me-2 text-primary" />} Payroll history (Excel)
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
          {hasRun && (
            <Button
              color="light"
              className="rounded-pill fw-semibold d-inline-flex align-items-center pay-hero-export"
              onClick={viewPayrollSheet}
              title="Jump to this cycle's payroll sheet"
              style={{
                padding: '10px 15px',
                fontSize: 12,
                border: '1px solid #705ad0',
                background: 'var(--vz-card-bg)',
                color: '#5a3fd1',
              }}
            >
              <i className="ri-table-line me-2" style={{ fontSize: 14 }} />
              View
            </Button>
          )}
        </div>
      </div>

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
            <div className="d-flex align-items-center gap-2">
              <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>Year</span>
              <div style={{ minWidth: 104 }}>
                <MasterSelect
                  value={String(selectedYear)}
                  onChange={(v) => selectYear(Number(v))}
                  options={yearOptions}
                  placeholder="Year"
                />
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
                  // A future month is frozen outright — not selectable, greyed,
                  // and labelled LOCKED. A month held up by an earlier open
                  // cycle stays selectable (HR must be able to look at it) but
                  // says what is blocking it; the Run button is disabled.
                  const frozen = !!m.is_future;
                  const t = frozen
                    ? { bg: '#eef2f6', fg: '#878a99', dot: '#b6bcc8' }
                    : CYCLE_TONES[m.status];
                  const title = frozen
                    ? `${m.label} hasn't started yet — future cycles are locked.`
                    : m.blocked_by
                      ? `Complete the ${m.blocked_by} payroll first — cycles run in order.`
                      : undefined;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { if (!frozen) setCycleKey(m.key); }}
                      disabled={frozen}
                      title={title}
                      aria-disabled={frozen}
                      className={`text-start flex-shrink-0 pay-cycle-chip${on ? ' is-selected' : ''}`}
                      style={{
                        minWidth: 138,
                        padding: '10px 12px',
                        borderRadius: 12,
                        cursor: frozen ? 'not-allowed' : 'pointer',
                        opacity: frozen ? 0.55 : 1,
                        transition: 'all .15s ease',
                      }}
                    >
                      <div className="fw-bold pay-cycle-chip-label d-flex align-items-center gap-1" style={{ fontSize: 12.5 }}>
                        {m.label}
                        {(frozen || m.blocked_by) && (
                          <i className="ri-lock-2-line" style={{ fontSize: 12, color: '#878a99' }} />
                        )}
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
                        {frozen ? 'Locked' : m.status}
                      </span>
                      {!frozen && m.blocked_by && (
                        <div className="text-muted mt-1" style={{ fontSize: 9, letterSpacing: '0.02em' }}>
                          after {m.blocked_by}
                        </div>
                      )}
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

      {/* g-1, not g-3 — the KPI tiles sit ~4px apart, matching the Recruitment
          page's .rec-page-kpis row. The gap is set on the row itself rather
          than in CSS, same as the Employees and Onboarding hubs. */}
      <Row className="g-1 mb-3 align-items-stretch">
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
            <Col key={k.key} xl={3} md={6} sm={6} xs={6}>
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
                  <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ['--kpi-accent' as any]: k.strip, ['--kpi-tint-dark' as any]: `${k.strip}2e` }}>
                    <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                  </div>
                </div>
              </div>
            </Col>
          );
        })}
      </Row>

      <Row className="g-2 align-items-center mb-3">
        <Col xs={12}>
          <div
            ref={sheetRef}
            className="d-flex flex-wrap pay-tabs"
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
              { key: 'biometric'  as const, label: 'Biometric Input',    icon: 'ri-fingerprint-line',         count: counts.totalEmployees },
              { key: 'report'     as const, label: 'Salary Report',      icon: 'ri-file-chart-line',          count: counts.totalEmployees },
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

      {/* Shared list tables (components/ui/DataTable) — search, the
          Department / Status pickers, sortable headers and the rows-per-page
          pager all come from the component; one instance per tab. The old
          wrapping Card is gone: DataTable brings its own card chrome. */}
      {tab === 'processing' && (
            <DataTable<PayrollRow>
              data={filtered}
              columns={processingColumns}
              className="pay-tbl-run"
              serial={{ header: 'Sr. No.' }}
              accent="violet"
              /* Fills the viewport instead of collapsing to row count — each of
                 these tables is the only one on its tab, so it owns the space
                 left under whatever the tab renders above it. */
              fitToViewport
              autoFitRows
              minWidth={1500}
              loading={loading}
              searchValue={q}
              onSearchChange={setQ}
              searchPlaceholder="Search name, ID, department…"
              toolbarActions={payrollToolbarActions}
              emptyMessage={
                <>
                  <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No payroll records match your filters
                </>
              }
            />
          )}

          {tab === 'biometric' && (
            <>
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

              <Row className="g-1 mb-3 align-items-stretch">
                {[
                  { key: 'syncedEmployees',   label: 'Synced Employees',    n: counts.syncedEmployees,   tone: 'green'  as const },
                  { key: 'missingPunchCases', label: 'Missing Punch Cases', n: counts.missingPunchCases, tone: 'red'    as const },
                  { key: 'mismatchCases',     label: 'Mismatch Cases',      n: counts.mismatchCases,     tone: 'red'    as const },
                  { key: 'paidLeaveCases',    label: 'Paid Leave Cases',    n: counts.paidLeaveCases,    tone: 'blue'   as const },
                  { key: 'unpaidLeaveCases',  label: 'Unpaid Leave Cases',  n: counts.unpaidLeaveCases,  tone: 'amber'  as const },
                ].map(t => (
                  <Col key={t.key} xl={true} md={4} sm={6} xs={6}>
                    <div className={`pay-mini-tile pay-mini-tile--${t.tone}`}>
                      {/* Same type scale as the hero KPI cards above: 26px
                          number, then a small uppercase tracked label. */}
                      <div className={`fw-bold pay-mini-tile-num--${t.tone}`} style={{ fontSize: 26, lineHeight: 1 }}>
                        {loading ? <Shimmer height={24} width={60} radius={6} /> : t.n}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '6px 0 0' }}>{t.label}</div>
                    </div>
                  </Col>
                ))}
              </Row>

              <DataTable<PayrollRow>
                data={filtered}
                columns={biometricColumns}
                accent="violet"
                className="pay-tbl-att"
                fitToViewport
                autoFitRows
                minWidth={1100}
                loading={loading}
                searchValue={q}
                onSearchChange={setQ}
                searchPlaceholder="Search name, ID, department…"
                toolbarActions={payrollToolbarActions}
                emptyMessage={
                  <>
                    <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                    No biometric records match your filters
                  </>
                }
              />
            </>
          )}

          {tab === 'report' && (
            <>
              <Row className="g-1 mb-3 align-items-stretch">
                {[
                  { key: 'totalGross',  label: 'Total Gross',    n: counts.totalGross,  tone: 'green'  as const },
                  { key: 'totalNetPay', label: 'Total Net Pay',  n: counts.totalNetPay, tone: 'blue'   as const },
                  { key: 'totalPf',     label: 'Total PF',       n: counts.totalPf,     tone: 'purple' as const },
                  { key: 'totalTds',    label: 'Total TDS',      n: counts.totalTds,    tone: 'amber'  as const },
                  { key: 'totalLop',    label: 'Total LOP Ded.', n: counts.totalLop,    tone: 'red'    as const },
                ].map(t => (
                  <Col key={t.key} xl={true} md={4} sm={6} xs={6}>
                    <div className={`pay-mini-tile pay-mini-tile--${t.tone}`}>
                      {/* 22px, not the 26px the count tiles use — a full
                          ₹ figure is far wider and would wrap at 26. */}
                      <div className={`fw-bold pay-mini-tile-num--${t.tone}`} style={{ fontSize: 22, lineHeight: 1 }}>
                        {loading ? <Shimmer height={20} width={80} radius={6} /> : `₹${fmtINR(t.n)}`}
                      </div>
                      <div
                        className="text-uppercase"
                        style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)', margin: '6px 0 0' }}
                      >
                        {t.label}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>

              <DataTable<PayrollRow>
                data={filtered}
                columns={reportColumns}
                accent="violet"
                className="pay-tbl-report"
                fitToViewport
                autoFitRows
                minWidth={1900}
                loading={loading}
                searchValue={q}
                onSearchChange={setQ}
                searchPlaceholder="Search name, ID, department…"
                toolbarActions={payrollToolbarActions}
                emptyMessage={
                  <>
                    <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                    No salary records match your filters
                  </>
                }
              />
            </>
          )}

          {tab === 'salary' && (
            <>
              <div className="pay-banner d-flex align-items-center gap-2 mb-3" style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>
                <i className="ri-information-line" style={{ fontSize: 15 }} />
                Set each employee's salary here. Employees without a structure (or annual salary) show ₹0 and are held during payroll.
              </div>
              {/* Roster, not `filtered` — Salary Setup lists every employee in
                  the branch regardless of the payroll filters, so this table
                  gets its own client-side search from the component. */}
              <DataTable<SalaryEmployeeLite>
                data={roster}
                columns={rosterColumns}
                className="pay-tbl-roster"
                accent="violet"
                fitToViewport
                autoFitRows
                /* Floor raised 1100 → 1200 so the Action column's 12% still
                   clears the Set Salary pill on a narrow window; below that the
                   wrapper scrolls horizontally instead of crushing the button. */
                minWidth={1200}
                loading={rosterLoading}
                searchPlaceholder="Search employee, ID, department…"
                emptyMessage={
                  <>
                    <i className="ri-team-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                    No employees found for this branch
                  </>
                }
              />
            </>
          )}

      </div>

      <PaymentDisbursementModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        runId={paymentRunId}
        cycleLabel={cycle.label}
        onPaid={() => { reloadCycle(); }}
      />

      <SalaryStructureModal
        open={!!salaryEmp}
        employee={salaryEmp}
        onClose={() => setSalaryEmp(null)}
        onSaved={loadRoster}
      />

      <PayrollRunModal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        onProceedToPay={proceedToPay}
        proceeding={proceeding}
        cycleLabel={cycle.label}
        totalEmployees={counts.totalEmployees}
        totalPayrollLabel={fmtINRShort(counts.totalPayroll)}
        blockedAmountLabel={fmtINRShort(blockedAmount)}
        atRiskAmountLabel={fmtINRShort(atRiskAmount)}
        issues={runIssues}
        sandwichItems={sandwichItems}
        onWaiveSandwich={waiveSandwich}
        sandwichBusyIds={sandwichBusyIds}
        excludedItems={excluded}
        onAction={handleIssueAction}
        onExportPayslips={downloadAllPayslips}
        exporting={downloading === 'zip'}
      />

      {paySlipRow && (() => {
        const r = paySlipRow;
        const basic   = Math.round(r.earnings * 0.50);
        const hra     = Math.round(r.earnings * 0.25);
        const special = r.earnings - basic - hra;
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
            workingDays={payslipDays?.workingDays ?? r.workingDays ?? periodMeta?.working_days ?? 26}
            daysPresent={payslipDays?.present ?? r.present}
            lossOfPay={payslipDays?.lopDays ?? r.lop_days ?? 0}
            paidDays={payslipDays?.paidDays ?? r.attendance ?? 0}
            weekOffDays={payslipDays?.weekOffDays ?? 0}
            overtimeApplicable={!!payslipOt?.applicable}
            overtimeHours={payslipOt?.hours ?? 0}
            overtimeDetectedHours={payslipOt?.detectedHours ?? 0}
            overtimePricedHours={payslipOt?.pricedHours}
            overtimeAmount={payslipOt?.amount ?? 0}
            overtimeMultiplier={payslipOt?.multiplier}
            overtimeHourly={payslipOt?.hourly}
            overtimeRate={payslipOt?.rate}
            overtimeRateName={payslipOt?.rateName}
            isFinal={payslipFinal}
            onSelectRecent={selectRecent}
            recentMonths={payslipRecent}
            payslipId={activePayslipId ?? r.payslip_id}
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
