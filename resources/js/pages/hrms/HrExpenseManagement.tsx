import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Col, Row } from 'reactstrap';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { expenseClaimColumns, type ExpenseClaimRow } from '../../components/ExpenseClaimsTable';
import ExpenseSettlementModal from '../../components/ExpenseSettlementModal';
import BatchPaymentModal from '../../components/BatchPaymentModal';
import { advanceRequestColumns, DeclineReasonModal, type AdvanceRequestRow } from '../../components/AdvanceRequestsTable';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import DataTable from '../../components/ui/DataTable';
import { useChartTheme } from '../../hooks/useChartTheme';
import '../../../css/expense.css';


type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'year';

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all:   'All Dates',
  today: 'Today',
  week:  'This Week',
  month: 'This Month',
  year:  'This Year',
};

/**
 * Compact ₹ formatter for chart axis ticks and bar labels. Uses the Indian
 * Cr / L / K scale so large spends (or one outlier category dwarfing the rest)
 * stay readable instead of overflowing as a 12-digit number or a malformed
 * "₹34567890.0L" tick.
 */
function fmtINRShort(v: number): string {
  const n = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (n >= 1_00_00_000) return `${sign}₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000)    return `${sign}₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `${sign}₹${(n / 1_000).toFixed(0)}K`;
  return `${sign}₹${Math.round(n)}`;
}

function withinDateFilter(iso: string | null | undefined, filter: DateFilter): boolean {
  if (filter === 'all' || !iso) return filter === 'all';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  if (filter === 'today') {
    return d.toDateString() === now.toDateString();
  }
  if (filter === 'week') {
    const dayIdx = (now.getDay() + 6) % 7;
    const start = new Date(now); start.setDate(now.getDate() - dayIdx); start.setHours(0,0,0,0);
    const end   = new Date(start); end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  }
  if (filter === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (filter === 'year') {
    return d.getFullYear() === now.getFullYear();
  }
  return true;
}

function KpiTile({
  label, sub, value, iconClass, strip, tint, fg, titleText,
}: {
  label: string;
  sub?: string;
  value: React.ReactNode;
  iconClass: string;
  strip: string;
  tint: string;
  fg: string;
  /** Native hover tooltip — used to surface the exact rupee value behind a
   *  compact figure (e.g. "₹500.00Cr" → "₹5,00,00,32,001"). */
  titleText?: string;
}) {
  return (
    <div
      className="hrexp-surface hrexp-kpi-card"
      title={titleText}
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
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: strip }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
        <div className="min-w-0">
          <p style={{
            fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)',
            letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px',
          }}>
            {label}
          </p>
          <h3 style={{
            fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          }}>
            {value}
          </h3>
          {sub && (
            <p style={{ fontSize: 10.5, color: 'var(--vz-secondary-color, #6b7280)', margin: '6px 0 0' }}>
              {sub}
            </p>
          )}
        </div>
        <div
          className="hrexp-kpi-ic"
          style={{
            width: 44, height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            ['--kpi-tint' as string]: tint,
            ['--kpi-fg' as string]: fg,
            ['--kpi-tint-dark' as string]: `${strip}33`,
            ['--kpi-fg-dark' as string]: strip,
          } as React.CSSProperties}
        >
          <i className={iconClass} style={{ fontSize: 20 }} />
        </div>
      </div>
    </div>
  );
}

export default function HrExpenseManagement() {
  const { user } = useAuth();
  const toast = useToast();
  const chartTheme = useChartTheme();
  // Claim whose Record-Payment (settlement) modal is open.
  const [settleClaimId, setSettleClaimId] = useState<number | null>(null);
  // Claim whose "Review & Approve" modal is open.
  const [reviewClaimId, setReviewClaimId] = useState<number | null>(null);
  // Advance whose Record-Payment / Review modal is open (same flow as claims).
  const [settleAdvId, setSettleAdvId] = useState<number | null>(null);
  const [reviewAdvId, setReviewAdvId] = useState<number | null>(null);
  // Advance whose "Decline reason" popup is open (rejected rows' Remark).
  const [remarkAdv, setRemarkAdv] = useState<AdvanceRequestRow | null>(null);
  // Advance Used-For view — Company used shows first, then Self used.
  const [advUsedFor, setAdvUsedFor] = useState<'self' | 'company'>('company');

  const [rows, setRows] = useState<ExpenseClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [advanceRows, setAdvanceRows] = useState<AdvanceRequestRow[]>([]);
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [module, setModule] = useState<'expense' | 'advance'>('expense');
  // Brief shimmer when switching tabs (module or used-for) — the data is already
  // in memory so the swap is instant and users couldn't tell the tab changed;
  // a 500ms skeleton makes the transition legible.
  const [switching, setSwitching] = useState(false);
  const switchTimer = useRef<number | null>(null);
  const flashSwitch = () => {
    setSwitching(true);
    if (switchTimer.current) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => setSwitching(false), 500);
  };
  const [batchOpen, setBatchOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    api.get('/master/expense_category').then((res: any) => {
      const arr = Array.isArray(res?.data) ? res.data : [];
      setCategories(arr.map((c: any) => ({
        id: Number(c.id),
        name: String(c.name ?? ''),
      })));
    }).catch(() => setCategories([]));
  }, []);

  const canHrApprove = useMemo(() => {
    if (!user) return false;
    if (user.user_type === 'super_admin') return true;
    const perm = user.permissions?.['hr.expense'];
    if (perm?.can_approve) return true;
    return user.user_type === 'client_admin';
  }, [user]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get('/expense-claims', { params: { scope: 'all' } });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Could not load claims.';
      toast.error('Load failed', msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshAdvances = async () => {
    setAdvanceLoading(true);
    try {
      const res = await api.get('/advance-requests', { params: { scope: 'all' } });
      setAdvanceRows(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Could not load advance requests.';
      toast.error('Load failed', msg);
      setAdvanceRows([]);
    } finally {
      setAdvanceLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    refreshAdvances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAct = async (
    claimId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      const res = await api.post(`/expense-claims/${claimId}/${action}`, comment ? { comment } : {});
      // Patch the row in place so the Approval Audit Log reflects the new
      // Reporting Manager / HR status immediately, without a page refresh.
      // The endpoint returns the fully-serialized, updated claim.
      if (res?.data?.id) setRows(prev => prev.map(r => r.id === res.data.id ? res.data : r));
      toast.success('Updated', 'Claim status updated');
      await refresh();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // Email the employee their reimbursement confirmation (fully paid + all synced).
  const emailReimbursement = async (claimId: number) => {
    try {
      const res = await api.post(`/expense-claims/${claimId}/email-reimbursement`);
      toast.success('Emailed', res?.data?.message || 'Reimbursement emailed to the employee.');
      await refresh();
    } catch (err: any) {
      toast.error('Email failed', err?.response?.data?.message || 'Could not send the email.');
    }
  };

  const onActAdvance = async (
    advanceId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/advance-requests/${advanceId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Advance status updated');
      await refreshAdvances();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  const dateFilteredRows = useMemo(
    () => rows.filter(r => withinDateFilter(r.expense_date, dateFilter)),
    [rows, dateFilter],
  );
  const dateFilteredAdvances = useMemo(
    () => advanceRows.filter(a => withinDateFilter(a.requested_date, dateFilter)),
    [advanceRows, dateFilter],
  );

  const counts = {
    all:      dateFilteredRows.length,
    pending:  dateFilteredRows.filter(r => r.status === 'pending').length,
    approved: dateFilteredRows.filter(r => r.status === 'approved').length,
    rejected: dateFilteredRows.filter(r => r.status === 'rejected').length,
  };
  // Used-For tab counts (from the date-filtered set, before the status filter).
  const advUsedForCounts = {
    self:    dateFilteredAdvances.filter(a => (a.used_for || 'self') === 'self').length,
    company: dateFilteredAdvances.filter(a => (a.used_for || 'self') === 'company').length,
  };
  // Narrow by Used For first — the status tabs + table then run on this subset.
  const usedForAdvances = dateFilteredAdvances.filter(a => (a.used_for || 'self') === advUsedFor);
  const advanceCounts = {
    all:      usedForAdvances.length,
    pending:  usedForAdvances.filter(a => a.status === 'pending').length,
    approved: usedForAdvances.filter(a => a.status === 'approved').length,
    rejected: usedForAdvances.filter(a => a.status === 'rejected').length,
  };
  // "Total Amount" is a SPEND total, so rejected claims are excluded — they
  // were previously summed in here while being excluded from the Approved
  // card and the Spend-by-Category chart, which made the figures look like
  // they mixed statuses (QA #87). Total = pending + approved (money in play).
  const totalAmount = dateFilteredRows
    .filter(r => r.status !== 'rejected')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const approvedAmount = dateFilteredRows
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const advanceTotalAmount = dateFilteredAdvances
    .filter(a => a.status !== 'rejected')
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const advanceApprovedAmount = dateFilteredAdvances
    .filter(a => a.status === 'approved')
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);

  // The KPI cards + analytics follow the header toggle: Expense Claims vs Advance
  // Requests. Pick the matching counts / amounts up front.
  const isAdvanceModule = module === 'advance';
  const kpiCounts        = isAdvanceModule ? advanceCounts : counts;
  const kpiTotalAmount   = isAdvanceModule ? advanceTotalAmount : totalAmount;
  const kpiApprovedAmount = isAdvanceModule ? advanceApprovedAmount : approvedAmount;

  /* KPI tiles are one line of 26px type in a narrow card, so a long figure
     wraps or clips. Compact it — but never at the cost of being wrong.
     QA #88 was exactly that: ₹6,550 rendered as "₹7K", a total that read as
     ₹450 too high. The answer is not "no K", it is ENOUGH PRECISION — two
     decimals keep ₹6,550 as ₹6.55K, and a round ₹2,000 still shows as ₹2K
     because trailing zeros are trimmed.
     Where two decimals still round (₹6,555 → ₹6.56K), the tile's tooltip
     carries the exact rupee figure — every caller passes titleText. */
  /* Truncated, not rounded. toFixed() rounds UP, which turned ₹99,999 into
     "₹100K" — a figure that reads as a lakh. On money, a display that rounds up
     overstates the total; truncating is at most a few rupees short and never
     claims more than there is. The exact figure is on the tile's tooltip. */
  const compactAt = (n: number, unit: number) =>
    String(Math.floor((n / unit) * 100) / 100);
  const fmtCompact = (n: number): string => {
    if (n >= 1_00_00_000) return `₹${compactAt(n, 1_00_00_000)}Cr`;
    if (n >= 1_00_000)    return `₹${compactAt(n, 1_00_000)}L`;
    if (n >= 1_000)       return `₹${compactAt(n, 1_000)}K`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  };

  const CAT_PALETTE = [
    '#3b82f6', '#0ab39c', '#7c5cfc', '#22c55e', '#f97316',
    '#94a3b8', '#0c63b0', '#a06f00', '#ef4444', '#0d9488',
  ];
  const colorForCat = (key: string): string => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return CAT_PALETTE[Math.abs(h) % CAT_PALETTE.length];
  };

  const categoryRollup = useMemo(() => {
    const byKey = new Map<string, { id: number | null; name: string; spent: number }>();
    for (const r of dateFilteredRows) {
      // Spend reflects money actually owed — only APPROVED claims count.
      // Pending / rejected claims must not inflate the category totals.
      if (r.status !== 'approved') continue;
      const id = r.category_id ?? null;
      const name = r.category_name || '—';
      const key = id != null ? `id:${id}` : `nm:${name.toLowerCase()}`;
      const cur = byKey.get(key) || { id, name, spent: 0 };
      cur.spent += Number(r.amount || 0);
      byKey.set(key, cur);
    }
    for (const c of categories) {
      const key = `id:${c.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, { id: c.id, name: c.name, spent: 0 });
      }
    }
    return Array.from(byKey.values()).map(row => ({
      ...row,
      color: colorForCat(`${row.id ?? ''}:${row.name}`),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilteredRows, categories]);

  // Advance Requests analytics — grouped by Advance Type (only APPROVED advances
  // count toward the disbursed total), mirroring the expense category rollup.
  const advanceTypeRollup = useMemo(() => {
    const byKey = new Map<string, { id: number | null; name: string; spent: number }>();
    for (const a of dateFilteredAdvances) {
      if (a.status !== 'approved') continue;
      const name = (a.advance_type === 'Other' ? (a.advance_type_other || 'Other') : a.advance_type) || '—';
      const key = `nm:${name.toLowerCase()}`;
      const cur = byKey.get(key) || { id: null, name, spent: 0 };
      cur.spent += Number(a.amount || 0);
      byKey.set(key, cur);
    }
    return Array.from(byKey.values()).map(row => ({ ...row, color: colorForCat(`:${row.name}`) }));
  }, [dateFilteredAdvances]);

  // Follows the header toggle: category breakdown for claims, advance-type
  // breakdown for advances.
  const spendByCategory = useMemo(
    () => [...(isAdvanceModule ? advanceTypeRollup : categoryRollup)].sort((a, b) => {
      if ((b.spent > 0) !== (a.spent > 0)) return b.spent > 0 ? 1 : -1;
      if (b.spent !== a.spent) return b.spent - a.spent;
      return a.name.localeCompare(b.name);
    }),
    [categoryRollup, advanceTypeRollup, isAdvanceModule],
  );
  const dateSubLabel = useMemo(() => {
    const d = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (dateFilter === 'today') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    if (dateFilter === 'week')  return 'Current week';
    if (dateFilter === 'month') return `${months[d.getMonth()]} ${d.getFullYear()}`;
    if (dateFilter === 'year')  return `${d.getFullYear()}`;
    return 'All time';
  }, [dateFilter]);

  const filteredAdvances = usedForAdvances.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [
        a.advance_no, a.employee_name, a.employee_code,
        a.advance_type, a.advance_type_other, a.reason,
      ].some(v => (v || '').toString().toLowerCase().includes(q));
    }
    return true;
  });

  const filtered = dateFilteredRows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [
        r.claim_no, r.employee_name, r.employee_code,
        r.category_name, r.department_name, r.title, r.vendor, r.purpose,
      ].some(v => (v || '').toString().toLowerCase().includes(q));
    }
    return true;
  });

  /* Still needed by the Export handlers — they export what the filters select,
     not just the visible page. Paging itself is <DataTable>'s job now. */
  const activeRows = module === 'advance' ? filteredAdvances : filtered;

  const [exportOpen, setExportOpen] = useState(false);
  // Self-contained export dropdown — portalled to <body> so it isn't clipped by
  // the hero strip's `overflow:hidden`, and not dependent on reactstrap's
  // Popper dropdown (which can fail to open here, leaving the button inert).
  const exportBtnRef = useRef<HTMLButtonElement | null>(null);
  const [exportPos, setExportPos] = useState<{ top: number; right: number } | null>(null);
  const toggleExport = () => {
    setExportOpen(prev => {
      const next = !prev;
      if (next && exportBtnRef.current) {
        const r = exportBtnRef.current.getBoundingClientRect();
        setExportPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
      }
      return next;
    });
  };
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (exportBtnRef.current?.contains(t)) return;
      if (document.getElementById('hrexp-export-menu')?.contains(t)) return;
      setExportOpen(false);
    };
    const close = () => setExportOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [exportOpen]);

  const EXPORT_HEADER = [
    'Claim No', 'Employee', 'Emp Code', 'Category',
    'Description', 'Expense Date', 'Amount', 'Currency',
    'Supplier', 'Project', 'Payment Method',
    'Status', 'Manager Status', 'Manager Acted', 'Manager Comment',
    'HR Status', 'HR User', 'HR Acted', 'HR Comment',
    'Payment Status', 'Zoho Sync',
    'Created By', 'Created At',
  ];
  const ZOHO_LABEL: Record<string, string> = { completed: 'Completed', partial: 'Partial', pending: 'Pending', na: 'N/A' };
  const PAY_LABEL: Record<string, string> = { paid: 'Completed', partial: 'Partial', unpaid: 'Pending' };

  /* Export date formatting (CBC #94/#95/#96).
   *
   * The raw API values went straight into the file: `expense_date` as the
   * plain "2026-07-26" and the action stamps as UTC ISO8601. Read back in IST
   * those timestamps land on the previous evening, so every export looked a
   * day behind the Expense Date shown in the table. Both now render exactly
   * what the UI renders.
   *
   * `expense_date` is a calendar date, NOT an instant — it is split textually
   * rather than fed to `new Date()`, which would treat it as UTC midnight and
   * shift it a day for anyone west of Greenwich. */
  const EXPORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const fmtExportDate = (v: string | null | undefined): string => {
    if (!v) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (m) return `${m[3]}-${EXPORT_MONTHS[Number(m[2]) - 1]}-${m[1]}`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v)
      : `${pad2(d.getDate())}-${EXPORT_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  };
  // Instants — converted to the viewer's local time, same as every on-screen stamp.
  const fmtExportDateTime = (v: string | null | undefined): string => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return `${pad2(d.getDate())}-${EXPORT_MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const exportRow = (r: ExpenseClaimRow): (string | number | null)[] => [
    r.claim_no, r.employee_name, r.employee_code, r.category_name,
    r.title, fmtExportDate(r.expense_date), r.amount, r.currency,
    r.vendor, r.project, r.payment_method,
    r.status, r.manager_status, fmtExportDateTime(r.manager_acted_at), r.manager_comment,
    r.hr_status, r.hr_user_name, fmtExportDateTime(r.hr_acted_at), r.hr_comment,
    PAY_LABEL[r.settlement_status ?? 'unpaid'] ?? (r.settlement_status ?? ''),
    ZOHO_LABEL[r.zoho_sync ?? 'na'] ?? '',
    r.creator_name, fmtExportDateTime(r.created_at),
  ];

  // Advance Requests have a different shape from expense claims, so their
  // export needs its own header + row mapper — otherwise the Advance tab
  // exported expense-claim columns/data (QA #131).
  const ADVANCE_EXPORT_HEADER = [
    'Advance No', 'Employee', 'Emp Code', 'Department', 'Advance Type', 'Used For',
    'Reason', 'Amount', 'Requested Date', 'Expected Use Date',
    'Recovery Mode', 'Recovery Start', 'Months', 'Monthly EMI', 'Recovery Recovered',
    'Status', 'Manager Status', 'Manager Acted', 'Manager Comment',
    'HR Status', 'HR User', 'HR Acted', 'HR Comment',
    'Sanctioned', 'Deductions', 'Total Paid', 'Remaining', 'Advance Paid', 'Settle Type',
    'Created By', 'Created At',
  ];
  const RECOVERY_EXPORT_LABEL: Record<string, string> = { emi: 'EMI', lumpsum: 'Lump Sum', bimonthly: 'Bi-Monthly' };
  const advanceExportRow = (r: AdvanceRequestRow): (string | number | null)[] => {
    const isCompany = (r.used_for || 'self') === 'company';
    return [
      r.advance_no ?? `#${r.id}`, r.employee_name, r.employee_code, r.department_name ?? '',
      r.advance_type === 'Other' ? (r.advance_type_other || 'Other') : r.advance_type,
      isCompany ? 'Company' : 'Self',
      r.reason, r.amount, fmtExportDate(r.requested_date), fmtExportDate(r.expected_use_date),
      isCompany ? '—' : (RECOVERY_EXPORT_LABEL[r.recovery_mode] ?? r.recovery_mode ?? '—'),
      isCompany ? '' : fmtExportDate(r.recovery_start),
      isCompany ? '' : (r.recovery_months ?? ''),
      isCompany ? '' : (r.monthly_emi ?? ''),
      isCompany ? '' : (r.recovery_recovered ?? ''),
      r.status, r.manager_status, fmtExportDateTime(r.manager_acted_at), r.manager_comment,
      r.hr_status, r.hr_user_name, fmtExportDateTime(r.hr_acted_at), r.hr_comment,
      r.sanctioned_amount ?? '', r.deduction_amount ?? '', r.total_paid ?? '', r.remaining_amount ?? '',
      r.status === 'rejected' ? 'N/A' : (PAY_LABEL[r.settlement_status ?? 'unpaid'] ?? ''),
      r.settle_type ?? '',
      r.creator_name, fmtExportDateTime(r.created_at),
    ];
  };

  // Active export config follows the visible tab (advance vs expense).
  const activeExportHeader = isAdvanceModule ? ADVANCE_EXPORT_HEADER : EXPORT_HEADER;
  const activeExportRows: (ExpenseClaimRow | AdvanceRequestRow)[] = isAdvanceModule ? filteredAdvances : filtered;
  const activeExportRow = (r: ExpenseClaimRow | AdvanceRequestRow): (string | number | null)[] =>
    isAdvanceModule ? advanceExportRow(r as AdvanceRequestRow) : exportRow(r as ExpenseClaimRow);
  const exportNoun = isAdvanceModule ? 'advance request' : 'claim';

  // Local, not toISOString(): after ~05:30 IST the UTC date is still yesterday,
  // which stamped exports (and their filenames) with the wrong day.
  const exportStamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const exportBaseName = () => `${isAdvanceModule ? 'advance-requests' : 'expense-claims'}-${dateFilter}-${exportStamp()}`;

  const hasExportRows = (): boolean => {
    if (activeExportRows.length === 0) {
      toast.error('Nothing to export', `No ${exportNoun}s match the current filters.`);
      return false;
    }
    return true;
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportDoneToast = (fmt: string) =>
    toast.success('Export ready', `${activeExportRows.length} ${exportNoun}${activeExportRows.length === 1 ? '' : 's'} exported to ${fmt}.`);

  const exportCsv = () => {
    if (!hasExportRows()) return;
    const escape = (v: any): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [activeExportHeader.map(escape).join(',')];
    for (const r of activeExportRows) lines.push(activeExportRow(r).map(escape).join(','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `${exportBaseName()}.csv`);
    exportDoneToast('CSV');
  };

  const exportXlsx = () => {
    if (!hasExportRows()) return;
    try {
      const aoa = [activeExportHeader, ...activeExportRows.map(r => activeExportRow(r).map(v => v ?? ''))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isAdvanceModule ? 'Advance Requests' : 'Expense Claims');
      XLSX.writeFile(wb, `${exportBaseName()}.xlsx`);
      exportDoneToast('Excel');
    } catch {
      toast.error('Export failed', 'Could not generate the Excel file. Please try again.');
    }
  };

  const exportPdf = () => {
    if (!hasExportRows()) return;
    const esc = (v: any) =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const thead = `<tr>${activeExportHeader.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
    const tbody = activeExportRows
      .map(r => `<tr>${activeExportRow(r).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('');
    const title = `${isAdvanceModule ? 'Advance Requests' : 'Expense Claims'} — ${DATE_FILTER_LABELS[dateFilter]}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(exportBaseName())}</title>
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
        <h1>${esc(title)}</h1>
        <p class="meta">${activeExportRows.length} ${exportNoun}(s) · generated ${esc(exportStamp())}</p>
        <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
        <script>window.onload = function () { window.focus(); window.print(); };<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Pop-up blocked', 'Allow pop-ups for this site to export as PDF.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast.success('Print view opened', `Choose "Save as PDF" in the print dialog · ${activeExportRows.length} ${exportNoun}${activeExportRows.length === 1 ? '' : 's'}.`);
  };

  const runExport = (fmt: 'xlsx' | 'pdf' | 'csv') => {
    setExportOpen(false);
    if (fmt === 'xlsx') exportXlsx();
    else if (fmt === 'pdf') exportPdf();
    else exportCsv();
  };

  /* ── Shared <DataTable> config ──────────────────────────────────────────
     Status tabs, the All-Dates picker and Export are identical for Claims and
     Advances, so they're built once here and handed to whichever table the
     module toggle is showing. */
  const statusTabs = useMemo(() => {
    const c = module === 'advance' ? advanceCounts : counts;
    return [
      { key: 'all',      label: module === 'advance' ? 'All Advances' : 'All Claims', icon: 'ri-stack-line',           count: c.all },
      { key: 'pending',  label: 'Pending Review',                                     icon: 'ri-time-line',            count: c.pending },
      { key: 'approved', label: 'Approved',                                           icon: 'ri-checkbox-circle-line', count: c.approved },
      { key: 'rejected', label: 'Rejected',                                           icon: 'ri-close-circle-line',    count: c.rejected },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, counts.all, counts.pending, counts.approved, counts.rejected,
      advanceCounts.all, advanceCounts.pending, advanceCounts.approved, advanceCounts.rejected]);

  const expenseToolbarActions = (
    <>
      <div className="hrexp-hero-select" style={{ minWidth: 150 }}>
        <MasterSelect
          value={dateFilter}
          onChange={(v) => setDateFilter((v as DateFilter) || 'all')}
          options={(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(k => ({ value: k, label: DATE_FILTER_LABELS[k] }))}
          placeholder="All Dates"
        />
      </div>
      {module === 'expense' && canHrApprove && (
        <button
          type="button"
          className="hrexp-cta rounded-pill"
          onClick={() => setBatchOpen(true)}
          title="Pay several small approved claims of one employee at once"
        >
          <i className="ri-stack-line me-2" style={{ fontSize: 16 }} />
          Batch Payment
        </button>
      )}
      <button
        ref={exportBtnRef}
        type="button"
        className="hrexp-cta rounded-pill"
        onClick={toggleExport}
        aria-haspopup="true"
        aria-expanded={exportOpen}
      >
        <i className="ri-download-2-line me-2" style={{ fontSize: 16 }} />
        Export
        <i className="ri-arrow-down-s-line ms-1" style={{ fontSize: 16 }} />
      </button>
    </>
  );

  /* Columns come from the shared row components, so an expense row looks the
     same here and on the employee profile's Expense tab. */
  // Review & Approve on the HR page only handles the HR / Finance stage. A row
  // still at the reporting-manager stage isn't actionable here — the manager
  // approval is Inbox-only — so nudge the branch admin there with a toast
  // instead of opening the modal. (QA: "you are the reporting manager, approve
  // in the inbox first, then make deduction and payment".)
  const myEmpId = user?.employee_id ?? null;
  // A row belonging to the LOGGED-IN user is their own request — an HR/HOD
  // approver must NOT review, approve, deduct or pay their own advance/claim
  // (self-approval). Their reporting manager (the branch user) does all of it.
  const isOwnRow = (row: { employee_id?: number | null }): boolean =>
    myEmpId != null && row.employee_id != null && Number(row.employee_id) === Number(myEmpId);
  const ownToast = () => toast.info('Handled by your reporting manager',
    'This is your own request — you can’t review, approve, set deductions or pay it. Your reporting manager (the branch user) will do the approval and payment.');

    const reviewGate = (row: { id?: number; employee_id?: number | null; manager_status?: string | null; manager_id?: number | null; manager_name?: string | null; reporting_manager_user_id?: number | null }, moduleKind: 'expense' | 'advance' = 'expense'): boolean => {
    if (isOwnRow(row)) { ownToast(); return false; }
    if ((row.manager_status ?? 'pending') !== 'approved') {
      // The Inbox redirect is ONLY for the person who actually owns the
      // MANAGER-review step of this row — not for HR approval or payment (those
      // stay here on the Expense page). Two ways to be that person:
      //   • the assigned employee-manager (manager_id = my employee id), OR
      //   • a branch USER acting as the DE-FACTO reporting manager — but only
      //     when NO employee-manager is assigned (manager_id is null). This
      //     mirrors MyTeamController::pendingAdvanceRequests, which surfaces a
      //     manager-stage row to a branch admin only when manager_id is null.
      // When an employee-manager IS assigned, a branch user is acting as HR,
      // not the manager, so we must NOT bounce them to an Inbox that doesn't
      // even list this row — they wait on the manager (manager stage) or
      // approve inline (once the manager has approved).
      const iAmEmployeeManager = myEmpId != null && row.manager_id != null && Number(row.manager_id) === Number(myEmpId);
      const iAmBranchUserManager = user?.id != null && row.manager_id == null
        && row.reporting_manager_user_id != null
        && Number(row.reporting_manager_user_id) === Number(user.id);
      if (iAmEmployeeManager || iAmBranchUserManager) {
        toast.info('Approve as reporting manager in your Inbox',
          'You are the reporting manager for this — opening it in your Inbox to review & approve. Once approved, come back here to set deductions and record the payment.');
        window.location.href = `/inbox?review=${moduleKind}:${row.id}`;
      } else {
        toast.info('Reporting Manager approval is pending',
          `HR approval can’t be processed until ${row.manager_name ? row.manager_name : 'the reporting manager'} approves this request in their Inbox. Once approved, it returns here for HR / Finance to set deductions and record the payment.`);
      }
      return false;
    }
    return true;
  };
  const payGate = (row: { employee_id?: number | null }): boolean => {
    if (isOwnRow(row)) { ownToast(); return false; }
    return true;
  };
  const claimColumns = useMemo(
    () => expenseClaimColumns({ mode: 'hr', canHrApprove, currentEmployeeId: user?.employee_id ?? null, onAct, onRecordPayment: (row) => { if (payGate(row)) setSettleClaimId(row.id); }, onReview: (row) => { if (reviewGate(row, 'expense')) setReviewClaimId(row.id); }, onEmailReimbursement: (row) => emailReimbursement(row.id) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canHrApprove, user?.employee_id],
  );
  const advanceColumns = useMemo(
    () => advanceRequestColumns({ mode: 'hr', canHrApprove, currentEmployeeId: user?.employee_id ?? null, usedFor: advUsedFor, onAct: onActAdvance, onRecordPayment: (row) => { if (payGate(row)) setSettleAdvId(row.id); }, onReview: (row) => { if (reviewGate(row, 'advance')) setReviewAdvId(row.id); }, onShowRemark: setRemarkAdv }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canHrApprove, user?.employee_id, advUsedFor],
  );

  return (
    <>
      <MasterFormStyles />
      <div className="hrexp-page">

        <div className="frm-cstrip mb-3">
          <span className="frm-cstrip-accent" />
          <div className="frm-cstrip-left">
            <div className="frm-cstrip-icon"><i className="ri-bank-card-2-line" /></div>
            <div className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="frm-cstrip-title">Expense Management</span>
                <span className="hrexp-hero-pill">
                  <span className="dot" />Live
                </span>
              </div>
              <div className="frm-cstrip-sub">
                Employee expense claims, approvals, and reimbursements
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {/* Module toggle (Expense Claims / Advance Requests) in the header's
                top-right corner — mirrors the Customer Profile CLM toggle. */}
            <div
              className="d-inline-flex"
              style={{
                background: 'var(--vz-secondary-bg)',
                border: '1px solid var(--vz-border-color)',
                borderRadius: 10,
                padding: 4,
                gap: 4,
              }}
            >
              {[
                { key: 'expense' as const, label: 'Expense Claims',   total: counts.all,         icon: 'ri-file-list-3-line',        accent: '#7c5cfc', shadow: 'rgba(124,92,252,0.25)' },
                { key: 'advance' as const, label: 'Advance Requests', total: advanceCounts.all,  icon: 'ri-money-dollar-circle-line', accent: '#4338ca', shadow: 'rgba(67,56,202,0.25)'  },
              ].map(m => {
                const on = module === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      if (module !== m.key) flashSwitch();
                      setModule(m.key);
                      setFilter('all');
                    }}
                    className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                    style={{
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: 13,
                      background: on ? `linear-gradient(135deg,${m.accent},#a78bfa)` : 'transparent',
                      color: on ? '#fff' : 'var(--vz-secondary-color)',
                      border: 'none',
                      boxShadow: on ? `0 4px 12px ${m.shadow}` : 'none',
                    }}
                  >
                    <i className={m.icon} style={{ fontSize: 14 }} />
                    {m.label}
                    <span
                      className="badge rounded-pill"
                      style={{
                        fontSize: 11,
                        background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                      }}
                    >
                      {m.total}
                    </span>
                  </button>
                );
              })}
            </div>
            {exportOpen && exportPos && createPortal(
              <div
                id="hrexp-export-menu"
                className="hrexp-export-menu"
                role="menu"
                style={{ position: 'fixed', top: exportPos.top, right: exportPos.right, zIndex: 10600 }}
              >
                <div className="hrexp-export-head">Download as</div>
                <button type="button" className="hrexp-export-item" role="menuitem" onClick={() => runExport('xlsx')}>
                  <i className="ri-file-excel-2-line me-2 text-success" />Excel (.xlsx)
                </button>
                <button type="button" className="hrexp-export-item" role="menuitem" onClick={() => runExport('pdf')}>
                  <i className="ri-file-pdf-2-line me-2 text-danger" />PDF (.pdf)
                </button>
                <button type="button" className="hrexp-export-item" role="menuitem" onClick={() => runExport('csv')}>
                  <i className="ri-file-text-line me-2 text-primary" />CSV (.csv)
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>

        <Row className="g-3 mb-3 align-items-stretch">
          <Col xl={true} md={4} sm={6} xs={6}>
            <KpiTile
              label={isAdvanceModule ? 'Total Advances' : 'Total Claims'}
              sub={dateSubLabel}
              value={kpiCounts.all}
              iconClass="ri-file-list-3-line"
              strip="#7c5cfc"
              tint="#ece6ff"
              fg="#7c5cfc"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={6}>
            <KpiTile
              label="Total Amount"
              sub={dateSubLabel}
              value={fmtCompact(kpiTotalAmount)}
              titleText={`₹${kpiTotalAmount.toLocaleString('en-IN')} · excludes rejected`}
              iconClass="ri-cash-line"
              strip="#f97316"
              tint="#fdf3d6"
              fg="#a06f00"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={6}>
            <KpiTile
              label="Approved"
              sub="Disbursable"
              value={fmtCompact(kpiApprovedAmount)}
              titleText={`₹${kpiApprovedAmount.toLocaleString('en-IN')} · approved only`}
              iconClass="ri-checkbox-circle-line"
              strip="#10b981"
              tint="#d6f4e3"
              fg="#108548"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={6}>
            <KpiTile
              label="Pending Review"
              sub="Awaiting approval"
              value={kpiCounts.pending}
              iconClass="ri-time-line"
              strip="#3b82f6"
              tint="#dceefe"
              fg="#0c63b0"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={6}>
            <KpiTile
              label="Rejected"
              sub="This cycle"
              value={kpiCounts.rejected}
              iconClass="ri-close-circle-line"
              strip="#f06548"
              tint="#fdd9d6"
              fg="#b1401d"
            />
          </Col>
        </Row>

        <div
          className="hrexp-surface mb-3"
          style={{
            borderRadius: 14,
            border: '1px solid var(--vz-border-color)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setAnalyticsOpen(o => !o)}
            className="btn w-100 d-flex align-items-center justify-content-between"
            style={{ padding: '13px 18px', border: 'none', background: 'transparent' }}
            aria-expanded={analyticsOpen}
          >
            <span className="d-inline-flex align-items-center gap-2 fw-bold" style={{ fontSize: 14 }}>
              <span
                className="d-inline-flex align-items-center justify-content-center"
                style={{ width: 28, height: 28, borderRadius: 8, background: '#ece6ff', color: '#7c5cfc', fontSize: 14 }}
              >
                <i className="ri-pie-chart-2-line" />
              </span>
              Spend Analytics
            </span>
            <i
              className="ri-arrow-down-s-line"
              style={{ fontSize: 22, color: 'var(--vz-secondary-color)', transition: 'transform .2s ease', transform: analyticsOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {analyticsOpen && (
          <div style={{ padding: '0 14px 14px' }}>
        <Row className="g-3 align-items-stretch">
          <Col xs={12}>
            <div
              className="hrexp-surface"
              style={{
                borderRadius: 14,
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                padding: '16px 20px',
                height: '100%',
              }}
            >
              <div className="d-flex align-items-center justify-content-between mb-3">
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="d-inline-flex align-items-center justify-content-center hrexp-card-ic--chart"
                    style={{ width: 28, height: 28, borderRadius: 8, background: '#ece6ff', color: '#7c5cfc', fontSize: 14 }}
                  >
                    <i className="ri-bar-chart-2-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>{isAdvanceModule ? 'Advances by Type' : 'Spend by Category'}</h6>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>{dateSubLabel}</small>
              </div>
              {spendByCategory.length === 0 ? (
                <div className="text-center text-muted py-4" style={{ fontSize: 12 }}>
                  <i className="ri-bar-chart-line d-block mb-2" style={{ fontSize: 24, opacity: 0.45 }} />
                  No expense categories configured yet.
                </div>
              ) : (
                <>
                  <div style={{ width: '100%', height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={spendByCategory.map(c => ({
                          name:  c.name,
                          spent: Math.round(c.spent),
                          color: c.color,
                        }))}
                        margin={{ top: 24, right: 12, left: 0, bottom: 48 }}
                        barCategoryGap="22%"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                        <XAxis
                          dataKey="name"
                          interval={0}
                          axisLine={false}
                          tickLine={false}
                          height={64}
                          // Rotate + truncate so all category names stay legible
                          // instead of overlapping in one flat row. Full name
                          // shows on hover via <title>.
                          tick={(props: any) => {
                            const { x, y, payload } = props;
                            const label = String(payload?.value ?? '');
                            const short = label.length > 14 ? label.slice(0, 13) + '…' : label;
                            return (
                              <g transform={`translate(${x},${y})`}>
                                <text
                                  dy={10}
                                  textAnchor="end"
                                  transform="rotate(-35)"
                                  fontSize={10.5}
                                  fontWeight={600}
                                  fill={chartTheme.axisTick}
                                >
                                  <title>{label}</title>
                                  {short}
                                </text>
                              </g>
                            );
                          }}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: chartTheme.axisTickMuted }}
                          axisLine={false}
                          tickLine={false}
                          width={64}
                          tickFormatter={fmtINRShort}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(124,92,252,0.06)' }}
                          contentStyle={{
                            background: chartTheme.tooltipBg,
                            border: `1px solid ${chartTheme.tooltipBorder}`,
                            borderRadius: 8, fontSize: 12, padding: '6px 10px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                          }}
                          itemStyle={{ color: chartTheme.axisTick }}
                          labelStyle={{ color: chartTheme.axisTick }}
                          formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Spent']}
                        />
                        <Bar dataKey="spent" radius={[6, 6, 0, 0]}>
                          {spendByCategory.map((c, i) => (
                            <Cell key={`cell-${i}`} fill={c.color} />
                          ))}
                          <LabelList
                            dataKey="spent"
                            position="top"
                            formatter={(v: any) => Number(v) > 0 ? fmtINRShort(Number(v)) : ''}
                            style={{ fontSize: 10.5, fontWeight: 700, fill: chartTheme.axisTick }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="d-flex flex-wrap" style={{ gap: '6px 16px', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--vz-border-color)' }}>
                    {spendByCategory.map(c => (
                      <div key={`leg:${c.id}:${c.name}`} className="d-inline-flex align-items-center gap-2" style={{ fontSize: 11 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                        <span className="fw-semibold" style={{ color: 'var(--vz-body-color, #1f2937)' }}>{c.name}</span>
                        <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {c.spent > 0 ? `₹${Number(c.spent).toLocaleString('en-IN')}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Col>
        </Row>
          </div>
          )}
        </div>

        {/* Shared list table (components/ui/DataTable) — status tabs, search
            and the rows-per-page pager are the component's now, so the toolbar
            still reads as controls for the table below (Bug #30) and the header
            columns gained sorting. The All-Dates picker and Export button ride
            in its toolbar. Advances and Claims are two different row shapes, so
            each gets its own instance with its own column set. */}
        {module === 'advance' ? (
          <DataTable<AdvanceRequestRow>
            data={filteredAdvances}
            columns={advanceColumns}
            accent="violet"
            /* Same sizing as My Workplace: autoFitRows picks the rows-per-page
               from the space available, fitToViewport pins the card to the fold
               so the footer sits at the bottom instead of floating up under a
               short result set. */
            autoFitRows
            fitToViewport
            minWidth={1500}
            loading={advanceLoading || switching}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search employee, advance no, type, reason…"
            tabs={statusTabs}
            activeTab={filter}
            onTabChange={k => { if (filter !== k) flashSwitch(); setFilter(k as StatusFilter); }}
            toolbarActions={expenseToolbarActions}
            emptyMessage={
              <>
                <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                No advance requests to show.
              </>
            }
          >
          {/* Used-For tabs — Self used / Company used. Narrows by used_for before
              the status tabs; Company drops the recovery columns (matches form).
              Rendered as the table's own children (between its toolbar and the
              rows) rather than as a free-floating row above the card, where it
              read as a stray control with no visible tie to the list or to the
              Spend Analytics panel above it. */}
          <div className="d-flex gap-2 flex-wrap px-3 pb-2">
            {[
              { key: 'company' as const, label: 'Company Used', count: advUsedForCounts.company, active: '#8b5cf6' },
              { key: 'self'    as const, label: 'Self Used',    count: advUsedForCounts.self,    active: '#0ea5e9' },
            ].map(t => {
              const on = advUsedFor === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { if (advUsedFor !== t.key) flashSwitch(); setAdvUsedFor(t.key); setFilter('all'); }}
                  className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold"
                  style={{
                    fontSize: 13, padding: '6px 14px',
                    border: `1px solid ${on ? t.active : 'var(--vz-border-color)'}`,
                    background: on ? t.active : 'var(--vz-card-bg)',
                    color: on ? '#fff' : 'var(--vz-secondary-color)',
                    boxShadow: on ? `0 4px 10px ${t.active}55` : 'none',
                  }}
                >
                  {t.label}
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-pill"
                    style={{
                      minWidth: 22, height: 20, fontSize: 11, padding: '0 6px',
                      background: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                      color: on ? '#fff' : 'var(--vz-secondary-color)',
                    }}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
          </DataTable>
        ) : (
          <DataTable<ExpenseClaimRow>
            data={filtered}
            columns={claimColumns}
            accent="violet"
            autoFitRows
            fitToViewport
            minWidth={1150}
            loading={loading || switching}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search employee, claim no, category, vendor…"
            tabs={statusTabs}
            activeTab={filter}
            onTabChange={k => { if (filter !== k) flashSwitch(); setFilter(k as StatusFilter); }}
            toolbarActions={expenseToolbarActions}
            emptyMessage={
              <>
                <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                No claims to show.
              </>
            }
          />
        )}
      </div>

      {/* Consolidated (batch) payment — settle several small approved claims at once. */}
      <BatchPaymentModal open={batchOpen} onClose={() => setBatchOpen(false)} onDone={refresh} />

      {/* Record Payment (settlement) for an approved claim — partial payments supported. */}
      <ExpenseSettlementModal
        claimId={settleClaimId}
        onClose={() => setSettleClaimId(null)}
        onDone={refresh}
      />

      {/* Review & Approve — HR sets adjustments and approves/rejects a pending claim. */}
      <ExpenseSettlementModal
        claimId={reviewClaimId}
        review
        onClose={() => setReviewClaimId(null)}
        onDone={refresh}
        onGoToInbox={() => { window.location.href = '/inbox'; }}
      />

      {/* Advance settlement + review — SAME modal, driven off the advance endpoints.
          These refresh the ADVANCE list (not claims), and also on close so the
          row reflects a just-recorded payout instantly without a reload. */}
      <ExpenseSettlementModal
        claimId={settleAdvId}
        basePath="/advance-requests"
        kind="advance"
        canApproveSettle={canHrApprove}
        onClose={() => { setSettleAdvId(null); refreshAdvances(); }}
        onDone={refreshAdvances}
      />
      <ExpenseSettlementModal
        claimId={reviewAdvId}
        basePath="/advance-requests"
        kind="advance"
        review
        canApproveSettle={canHrApprove}
        onClose={() => { setReviewAdvId(null); refreshAdvances(); }}
        onDone={refreshAdvances}
        onGoToInbox={() => { window.location.href = '/inbox'; }}
      />
      {/* Full decline reason for a rejected advance (Remark column / audit "View all"). */}
      <DeclineReasonModal row={remarkAdv} onClose={() => setRemarkAdv(null)} />
    </>
  );
}
