import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input } from 'reactstrap';
import { MasterFormStyles, MasterSelect } from '../master/masterFormKit';
import PayslipViewerModal, { type PayslipLine } from '../../components/PayslipViewerModal';
import { useToast } from '../../contexts/ToastContext';
// Reuses the purple hero-card, hero-pill, KPI surface and table styles that
// HrEmployeeOnboarding ships (.onb-hero-card / .onb-hero-pill / .onb-surface
// / .onb-kpi-card / .onb-pill / .onb-id-pill / .onb-role-pill) so the page
// reads the same as the rest of the HR module.
import '../employee-onboarding/HrEmployeeOnboarding.css';

// ── Types ────────────────────────────────────────────────────────────────────
type CycleStatus = 'Completed' | 'In Progress' | 'Not Started';
type RowStatus   = 'Ready' | 'Processed' | 'Pending Review' | 'On Hold';
// Source of truth for the biometric tab. "Biometric" = device sync clean,
// "Review" = needs HR attention (missing punches / mismatches), "Manual" =
// no device data available, attendance entered manually.
type AttSource   = 'Biometric' | 'Review' | 'Manual';

interface CycleMonth {
  key: string;          // 'apr-2025'
  label: string;        // 'Apr 2025'
  range: string;        // '01 APR–30 APR'
  status: CycleStatus;
}

interface PayrollRow {
  id: string;
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

const ROW_TONES: Record<RowStatus, { bg: string; fg: string; dot: string }> = {
  'Ready':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Processed':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Pending Review': { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' },
  'On Hold':        { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
};

// ── Mock employee payroll rows for the Apr 2026 cycle ───────────────────────
// 26 working days in Apr 2026 — drives the biometric tab's "26 working days"
// banner and the present/absent breakdown. Salary deductions are split into
// individual heads (PF / ESI / PT / TDS / LOP / advance recovery) so the
// Salary Report tab can render them as columns; legacy `deductions` and
// `netPay` are recomputed from those heads to stay consistent.
const PAYROLL_ROWS: PayrollRow[] = [
  { id: 'PR-001', empId: 'EMP-2401', name: 'Aarav Sharma',     initials: 'AS', accent: '#7c5cfc', department: 'Engineering', designation: 'Senior Engineer',   ctc: 145000, earnings: 143250, deductions: 17563, netPay: 125687, attendance: 24, status: 'Ready',          present: 24, absent: 2, lateMarks: 2, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 10200, esi: 0, pt: 200, tds: 7163, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-002', empId: 'EMP-2402', name: 'Priya Mehta',      initials: 'PM', accent: '#0ab39c', department: 'HR',          designation: 'HR Manager',        ctc: 132000, earnings: 82197,  deductions: 21264, netPay: 60933,  attendance: 22, status: 'Pending Review', present: 22, absent: 1, lateMarks: 3, missingPunch: 1, unpaidLeave: 1, attSource: 'Review',     mismatch: 'Punch gap',      pfEmp: 6295,  esi: 0, pt: 200, tds: 0,    lopDeducted: 4769, advanceRec: 10000 },
  { id: 'PR-003', empId: 'EMP-2403', name: 'Rohan Iyer',       initials: 'RI', accent: '#3b82f6', department: 'Finance',     designation: 'Finance Lead',      ctc: 158000, earnings: 158000, deductions: 21400, netPay: 136600, attendance: 26, status: 'Ready',          present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 11400, esi: 0, pt: 200, tds: 9800, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-004', empId: 'EMP-2404', name: 'Sneha Kulkarni',   initials: 'SK', accent: '#f59e0b', department: 'Marketing',   designation: 'Marketing Lead',    ctc: 121000, earnings: 110800, deductions: 14600, netPay: 96200,  attendance: 24, status: 'Pending Review', present: 24, absent: 0, lateMarks: 1, missingPunch: 0, unpaidLeave: 2, attSource: 'Biometric',                              pfEmp: 8400,  esi: 0, pt: 200, tds: 5800, lopDeducted: 200,  advanceRec: 0     },
  { id: 'PR-005', empId: 'EMP-2405', name: 'Pooja Desai',      initials: 'PD', accent: '#0ab39c', department: 'HR',          designation: 'HR Executive',      ctc: 78000,  earnings: 78000,  deductions: 9100,  netPay: 68900,  attendance: 26, status: 'Ready',          present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 5400,  esi: 1500, pt: 200, tds: 2000, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-006', empId: 'EMP-2406', name: 'Karthik Raj',      initials: 'KR', accent: '#7c5cfc', department: 'Engineering', designation: 'Frontend Engineer', ctc: 96000,  earnings: 96000,  deductions: 11200, netPay: 84800,  attendance: 26, status: 'Processed',      present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 6700,  esi: 0, pt: 200, tds: 4300, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-007', empId: 'EMP-2407', name: 'Meera Nair',       initials: 'MN', accent: '#e83e8c', department: 'Design',      designation: 'Product Designer',  ctc: 104000, earnings: 104000, deductions: 12300, netPay: 91700,  attendance: 26, status: 'Ready',          present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 7300,  esi: 0, pt: 200, tds: 4800, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-008', empId: 'EMP-2408', name: 'Aditya Verma',     initials: 'AV', accent: '#0c63b0', department: 'Sales',       designation: 'Sales Executive',   ctc: 72000,  earnings: 63600,  deductions: 8400,  netPay: 55200,  attendance: 22, status: 'On Hold',        present: 22, absent: 1, lateMarks: 1, missingPunch: 2, unpaidLeave: 1, attSource: 'Review',     mismatch: 'Missing punches', pfEmp: 4400,  esi: 1300, pt: 200, tds: 2500, lopDeducted: 2400, advanceRec: 0     },
  { id: 'PR-009', empId: 'EMP-2409', name: 'Tanvi Joshi',      initials: 'TJ', accent: '#108548', department: 'Operations',  designation: 'Ops Lead',          ctc: 118000, earnings: 118000, deductions: 14100, netPay: 103900, attendance: 26, status: 'Processed',      present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 8200,  esi: 0, pt: 200, tds: 5700, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-010', empId: 'EMP-2410', name: 'Vikram Singh',     initials: 'VS', accent: '#a06f00', department: 'Engineering', designation: 'Backend Engineer',  ctc: 102000, earnings: 102000, deductions: 12000, netPay: 90000,  attendance: 26, status: 'Ready',          present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Manual',                                 pfEmp: 7100,  esi: 0, pt: 200, tds: 4700, lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-011', empId: 'EMP-2411', name: 'Ishaan Khanna',    initials: 'IK', accent: '#3b82f6', department: 'Product',     designation: 'Product Manager',   ctc: 165000, earnings: 158600, deductions: 22500, netPay: 136100, attendance: 25, status: 'Pending Review', present: 25, absent: 0, lateMarks: 2, missingPunch: 1, unpaidLeave: 1, attSource: 'Review',     mismatch: 'Late mark dispute', pfEmp: 12000, esi: 0, pt: 200, tds: 10300,lopDeducted: 0,    advanceRec: 0     },
  { id: 'PR-012', empId: 'EMP-2412', name: 'Riya Bansal',      initials: 'RB', accent: '#7c5cfc', department: 'Engineering', designation: 'QA Engineer',       ctc: 84000,  earnings: 84000,  deductions: 9700,  netPay: 74300,  attendance: 26, status: 'Ready',          present: 26, absent: 0, lateMarks: 0, missingPunch: 0, unpaidLeave: 0, attSource: 'Biometric',                              pfEmp: 5900,  esi: 0, pt: 200, tds: 3600, lopDeducted: 0,    advanceRec: 0     },
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
];

const STATUS_OPTIONS: { value: 'All' | RowStatus; label: string }[] = [
  { value: 'All',            label: 'All' },
  { value: 'Ready',          label: 'Ready' },
  { value: 'Processed',      label: 'Processed' },
  { value: 'Pending Review', label: 'Pending Review' },
  { value: 'On Hold',        label: 'On Hold' },
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

  // Selected cycle drives every downstream stat. Defaults to the live "In
  // Progress" cycle (Mar 2026); falls back to the last entry if all cycles
  // are completed.
  const initialCycleKey = useMemo(() => {
    const live = CYCLE_MONTHS.find(c => c.status === 'In Progress' || c.status === 'Not Started');
    return (live ?? CYCLE_MONTHS[CYCLE_MONTHS.length - 1]).key;
  }, []);
  const [cycleKey, setCycleKey] = useState<string>(initialCycleKey);
  const [cycleCollapsed, setCycleCollapsed] = useState(false);

  const [tab, setTab] = useState<'processing' | 'biometric' | 'report'>('processing');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | RowStatus>('All');

  // Payslip viewer modal — opened from the Payslip column in the Salary
  // Report tab. Holds the row currently being viewed so the modal can render
  // that employee's earnings/deductions breakdown.
  const [paySlipRow, setPaySlipRow] = useState<PayrollRow | null>(null);
  const openPayslip  = (row: PayrollRow) => setPaySlipRow(row);
  const closePayslip = () => setPaySlipRow(null);

  // Pagination — match the master tables (7 per page).
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 7;

  // Reset page when filters change.
  useEffect(() => { setPage(1); }, [q, deptFilter, statusFilter, cycleKey, tab]);

  const cycle = useMemo(
    () => CYCLE_MONTHS.find(c => c.key === cycleKey) ?? CYCLE_MONTHS[0],
    [cycleKey],
  );

  // Counts — derived from PAYROLL_ROWS (mock). When wired to /api/payroll,
  // these will be recomputed from the cycle-scoped server payload.
  const counts = useMemo(() => {
    const totalEmployees = PAYROLL_ROWS.length;
    const ready          = PAYROLL_ROWS.filter(r => r.status === 'Ready').length;
    const processed      = PAYROLL_ROWS.filter(r => r.status === 'Processed').length;
    const pendingReview  = PAYROLL_ROWS.filter(r => r.status === 'Pending Review').length;
    const onHold         = PAYROLL_ROWS.filter(r => r.status === 'On Hold').length;
    const totalPayroll   = PAYROLL_ROWS.reduce((s, r) => s + r.netPay, 0);
    const avgCtc         = totalEmployees ? Math.round(PAYROLL_ROWS.reduce((s, r) => s + r.ctc, 0) / totalEmployees) : 0;
    const attMismatch    = PAYROLL_ROWS.filter(r => r.attMismatch || r.attSource === 'Review').length;
    // Biometric tab aggregates
    const syncedEmployees    = PAYROLL_ROWS.filter(r => r.attSource === 'Biometric').length;
    const missingPunchCases  = PAYROLL_ROWS.filter(r => r.missingPunch > 0).length;
    const mismatchCases      = PAYROLL_ROWS.filter(r => r.attSource === 'Review').length;
    const unpaidLeaveCases   = PAYROLL_ROWS.filter(r => r.unpaidLeave > 0).length;
    // Salary Report aggregates
    const totalGross    = PAYROLL_ROWS.reduce((s, r) => s + r.earnings, 0);
    const totalNetPay   = PAYROLL_ROWS.reduce((s, r) => s + r.netPay, 0);
    const totalPf       = PAYROLL_ROWS.reduce((s, r) => s + r.pfEmp, 0);
    const totalTds      = PAYROLL_ROWS.reduce((s, r) => s + r.tds, 0);
    const totalLop      = PAYROLL_ROWS.reduce((s, r) => s + r.lopDeducted, 0);
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
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PAYROLL_ROWS
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
  }, [q, deptFilter, statusFilter]);

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

  const monthOptions = CYCLE_MONTHS.map(m => ({ value: m.key, label: m.label }));

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
            <i className="ri-coins-line" style={{ color: '#fff', fontSize: 21 }} />
          </span>
          <div className="min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Payroll</h5>
              <span className="onb-hero-pill">
                <span className="dot" />{cycle.label}
              </span>
            </div>
            <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
              Monthly payroll engine — biometric → calculation master → run payroll → payslips & bank advice
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
            onClick={() => toast.success(
              'Payroll cycle started',
              `${cycle.label} — processing for ${counts.totalEmployees} employees.`,
            )}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              color: '#fff',
              background: 'linear-gradient(135deg,#0ab39c 0%,#078b78 100%)',
              border: '2px solid #5a3fd1',
              boxShadow: '0 8px 18px rgba(90,63,209,0.32)',
            }}
          >
            <i className="ri-play-circle-line me-2" style={{ fontSize: 16 }} />
            Run Payroll
          </Button>
          <Button
            color="light"
            className="rounded-pill fw-semibold d-inline-flex align-items-center pay-hero-export"
            onClick={() => toast.success(
              'Export queued',
              `${cycle.label} payroll will download shortly as CSV.`,
            )}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              border: '2px solid #5a3fd1',
              background: 'var(--vz-card-bg)',
              color: '#5a3fd1',
            }}
          >
            <i className="ri-download-2-line me-2" style={{ fontSize: 16 }} />
            Export
          </Button>
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
                const n = CYCLE_MONTHS.filter(c => c.status === s).length;
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
                {CYCLE_MONTHS.map(m => {
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
                      {displayValue}
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
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-5 text-muted">
                        <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                        No payroll records match your filters
                      </td>
                    </tr>
                  ) : visible.map((r, idx) => {
                    const tone = ROW_TONES[r.status];
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
                              title="Download"
                              onClick={() => toast.success(
                                'Payslip downloaded',
                                `${r.name.replace(/\s+/g, '_')}_${cycle.label.replace(' ', '_')}.pdf`,
                              )}
                            >
                              <i className="ri-download-2-line" style={{ fontSize: 14 }} />
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
                Read-only · Source data from Timelogs · {cycle.label} · 26 working days
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
                      <div className={`fw-bold pay-mini-tile-num--${t.tone}`} style={{ fontSize: 22, lineHeight: 1 }}>{t.n}</div>
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
                    {visible.length === 0 ? (
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
                        ₹{fmtINR(t.n)}
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
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="text-center py-5 text-muted">
                          <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                          No salary records match your filters
                        </td>
                      </tr>
                    ) : visible.map(r => {
                      const totalDeductions = r.pfEmp + r.esi + r.pt + r.tds + r.lopDeducted + r.advanceRec;
                      const netPayable      = r.earnings - totalDeductions;
                      const tone            = ROW_TONES[r.status];
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
        const earnings: PayslipLine[] = [
          { label: 'Basic Salary',          amount: basic },
          { label: 'House Rent Allowance (HRA)', amount: hra },
          { label: 'Special Allowance',     amount: special },
        ];
        const deductions: PayslipLine[] = [
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
            workingDays={26}
            daysPresent={r.present}
            lossOfPay={r.unpaidLeave}
            paidDays={r.present}
          />
        );
      })()}
    </>
  );
}
