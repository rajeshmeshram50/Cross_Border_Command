import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ExpenseClaimsTable, { type ExpenseClaimRow } from '../components/ExpenseClaimsTable';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';


type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'year';

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all:   'All Dates',
  today: 'Today',
  week:  'This Week',
  month: 'This Month',
  year:  'This Year',
};

/** Returns true when the row's expense_date falls within the selected window. */
function withinDateFilter(iso: string | null | undefined, filter: DateFilter): boolean {
  if (filter === 'all' || !iso) return filter === 'all';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  if (filter === 'today') {
    return d.toDateString() === now.toDateString();
  }
  if (filter === 'week') {
    // Monday-start week.
    const dayIdx = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
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

/* ─────────────────────────────────────────────────────────────────
 *  KPI tile — same visual language as HrEmployeeOnboarding's cards.
 *  White surface, thin colored top stripe, label on top-left in caps,
 *  big bold number underneath, soft tinted icon tile on top-right.
 *  Matches `.onb-surface .onb-kpi-card` in the onboarding page.
 * ───────────────────────────────────────────────────────────────── */
function KpiTile({
  label, sub, value, iconClass, strip, tint, fg,
}: {
  label: string;
  sub?: string;
  value: React.ReactNode;
  iconClass: string;
  /** Color of the top accent stripe. */
  strip: string;
  /** Soft background of the icon tile. */
  tint: string;
  /** Foreground color of the icon glyph. */
  fg: string;
}) {
  return (
    <div
      className="hrexp-surface"
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
          style={{
            width: 44, height: 44, borderRadius: 10,
            background: tint,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <i className={iconClass} style={{ fontSize: 20, color: fg }} />
        </div>
      </div>
    </div>
  );
}

export default function HrExpenseManagement() {
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<ExpenseClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // Category + department dropdowns sit inside the filter strip below the
  // status tabs. 'all' = no narrowing. Both reset whenever the user flips
  // the date dropdown so they don't end up filtering against an empty set.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // Expense categories master — needed for the policy-limit panel below.
  // Each row carries `monthly_limit` and `yearly_limit` from the master.
  const [categories, setCategories] = useState<{ id: number; name: string; monthly_limit: number | null; yearly_limit: number | null }[]>([]);
  useEffect(() => {
    api.get('/master/expense_category').then((res: any) => {
      const arr = Array.isArray(res?.data) ? res.data : [];
      setCategories(arr.map((c: any) => ({
        id: Number(c.id),
        name: String(c.name ?? ''),
        monthly_limit: c.monthly_limit != null ? Number(c.monthly_limit) : null,
        yearly_limit:  c.yearly_limit  != null ? Number(c.yearly_limit)  : null,
      })));
    }).catch(() => setCategories([]));
  }, []);

  // HR users can approve when their permission row on the `hr.expense`
  // module includes can_approve. Super admins and main-branch admins
  // bypass the explicit flag — the backend mirrors this.
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

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAct = async (
    claimId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/expense-claims/${claimId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Claim status updated');
      await refresh();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // Apply the date filter first — KPI counts and the table rows both read
  // off this windowed source so the summary stays in sync with what's shown.
  const dateFilteredRows = useMemo(
    () => rows.filter(r => withinDateFilter(r.expense_date, dateFilter)),
    [rows, dateFilter],
  );

  const counts = {
    all:      dateFilteredRows.length,
    pending:  dateFilteredRows.filter(r => r.status === 'pending').length,
    approved: dateFilteredRows.filter(r => r.status === 'approved').length,
    rejected: dateFilteredRows.filter(r => r.status === 'rejected').length,
  };
  const totalAmount = dateFilteredRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const approvedAmount = dateFilteredRows
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  /** Compact rupee formatter — turns 65800 → "₹66K", 1234567 → "₹12L". */
  const fmtCompact = (n: number): string => {
    if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1).replace(/\.0$/, '')}Cr`;
    if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1).replace(/\.0$/, '')}L`;
    if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
    return `₹${Math.round(n)}`;
  };

  /* ── Spend by Category + Policy Limits ─────────────────────────────────
   * Both panels read off `dateFilteredRows` so they react to the All Dates
   * dropdown automatically. Spend is summed from the windowed claims; the
   * policy limit scales the master's `monthly_limit` to the selected
   * window so the comparison stays apples-to-apples (e.g. "today" → 1/30,
   * "year" → ×12). */

  /** Stable palette — hash the category name + id into one of these slots
   *  so the same category keeps the same colour across re-renders. */
  const CAT_PALETTE = [
    '#3b82f6', // blue
    '#0ab39c', // teal
    '#7c5cfc', // purple
    '#22c55e', // green
    '#f97316', // orange
    '#94a3b8', // slate
    '#0c63b0', // deep blue
    '#a06f00', // amber
    '#ef4444', // red
    '#0d9488', // dark teal
  ];
  const colorForCat = (key: string): string => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return CAT_PALETTE[Math.abs(h) % CAT_PALETTE.length];
  };

  /** Scale the monthly policy limit to the selected date window so the
   *  Over check makes sense regardless of the filter. */
  const periodLimit = (monthly: number | null): number => {
    if (monthly == null || monthly <= 0) return 0;
    switch (dateFilter) {
      case 'today': return monthly / 30;
      case 'week':  return monthly / 4.345; // 30 / 7
      case 'month': return monthly;
      case 'year':  return monthly * 12;
      case 'all':   return monthly; // best-effort baseline; no over check
    }
  };

  /** Per-category spend rollup over the windowed rows. Combines by id when
   *  available, falls back to category_name for legacy rows. */
  const categoryRollup = useMemo(() => {
    const byKey = new Map<string, { id: number | null; name: string; spent: number }>();
    for (const r of dateFilteredRows) {
      const id = r.category_id ?? null;
      const name = r.category_name || '—';
      const key = id != null ? `id:${id}` : `nm:${name.toLowerCase()}`;
      const cur = byKey.get(key) || { id, name, spent: 0 };
      cur.spent += Number(r.amount || 0);
      byKey.set(key, cur);
    }
    // Add categories from master that have a limit set but no spend yet —
    // they should still appear in the Policy Limits panel so HR can see
    // unused budgets.
    for (const c of categories) {
      const key = `id:${c.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, { id: c.id, name: c.name, spent: 0 });
      }
    }
    return Array.from(byKey.values()).map(row => {
      const master = row.id != null ? categories.find(c => c.id === row.id) : null;
      const limit  = periodLimit(master?.monthly_limit ?? null);
      return {
        ...row,
        color: colorForCat(`${row.id ?? ''}:${row.name}`),
        monthlyLimit: master?.monthly_limit ?? null,
        limit,
        over: limit > 0 && row.spent > limit,
        usedPct: limit > 0 ? Math.min(100, (row.spent / limit) * 100) : 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilteredRows, categories, dateFilter]);

  /** Sorted views for the two panels — Spend by Category is desc-by-spent
   *  AND drops zero-spent rows; Policy Limits keeps everyone with a limit
   *  set (or any spend) so the section doesn't go empty when no one has
   *  filed yet. */
  const spendByCategory = useMemo(
    () => categoryRollup
      .filter(c => c.spent > 0)
      .sort((a, b) => b.spent - a.spent),
    [categoryRollup],
  );
  const policyLimitRows = useMemo(
    () => categoryRollup
      .filter(c => (c.monthlyLimit ?? 0) > 0 || c.spent > 0)
      // Overspent first, then biggest spend, so HR's eye lands on hot rows.
      .sort((a, b) => {
        if (a.over !== b.over) return a.over ? -1 : 1;
        return b.spent - a.spent;
      }),
    [categoryRollup],
  );
  const maxCatSpend = spendByCategory.reduce((m, c) => Math.max(m, c.spent), 0);

  const dateSubLabel = useMemo(() => {
    const d = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (dateFilter === 'today') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    if (dateFilter === 'week')  return 'Current week';
    if (dateFilter === 'month') return `${months[d.getMonth()]} ${d.getFullYear()}`;
    if (dateFilter === 'year')  return `${d.getFullYear()}`;
    return 'All time';
  }, [dateFilter]);

  // Distinct option lists for the Category + Department dropdowns. Built
  // off the date-windowed rows so the dropdowns shrink/grow with the date
  // filter (e.g. "Today" hides categories nobody filed today).
  const categoryOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of dateFilteredRows) {
      const name = r.category_name?.trim();
      if (name) set.set(name.toLowerCase(), name);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [dateFilteredRows]);
  const departmentOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of dateFilteredRows) {
      const name = r.department_name?.trim();
      if (name) set.set(name.toLowerCase(), name);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [dateFilteredRows]);

  // Apply status tab + category + department + free-text search on top of
  // the date window. Each filter is independent — clearing any one back to
  // 'all' / '' restores those rows.
  const filtered = dateFilteredRows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (categoryFilter !== 'all'
        && (r.category_name || '').toLowerCase() !== categoryFilter.toLowerCase()) return false;
    if (departmentFilter !== 'all'
        && (r.department_name || '').toLowerCase() !== departmentFilter.toLowerCase()) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [
        r.claim_no, r.employee_name, r.employee_code,
        r.category_name, r.department_name, r.title, r.vendor, r.purpose,
      ].some(v => (v || '').toString().toLowerCase().includes(q));
    }
    return true;
  });

  /**
   * Export the currently filtered rows as a CSV file (Excel opens this
   * directly). UTF-8 BOM up front so non-ASCII names + the ₹ symbol render
   * correctly when the user opens the file in Excel.
   */
  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nothing to export', 'No claims match the current filters.');
      return;
    }
    const header = [
      'Claim No', 'Employee', 'Emp Code', 'Category',
      'Description', 'Expense Date', 'Amount', 'Currency',
      'Vendor', 'Project', 'Payment Method',
      'Status', 'Manager Status', 'Manager Acted', 'Manager Comment',
      'HR Status', 'HR User', 'HR Acted', 'HR Comment',
      'Created By', 'Created At',
    ];
    const escape = (v: any): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      // Wrap in double quotes when the cell contains a comma, quote, or newline.
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.map(escape).join(',')];
    for (const r of filtered) {
      lines.push([
        r.claim_no, r.employee_name, r.employee_code, r.category_name,
        r.title, r.expense_date, r.amount, r.currency,
        r.vendor, r.project, r.payment_method,
        r.status, r.manager_status, r.manager_acted_at, r.manager_comment,
        r.hr_status, r.hr_user_name, r.hr_acted_at, r.hr_comment,
        r.creator_name, r.created_at,
      ].map(escape).join(','));
    }
    // BOM (﻿) makes Excel honor UTF-8 — without it, ₹ + accented names
    // render as garbled mojibake on Windows.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `expense-claims-${dateFilter}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Export ready', `${filtered.length} claim${filtered.length === 1 ? '' : 's'} downloaded.`);
  };

  return (
    <>
      {/* Inject the master-form CSS so MasterSelect dropdowns on this page
          render with the proper border/background/chevron styling instead
          of browser defaults — without this they look like raw text. */}
      <MasterFormStyles />
      <style>{`
        .hrexp-surface { background: #ffffff; }
        [data-bs-theme="dark"] .hrexp-surface { background: #1c2531; }

        /* Hero card — purple-tinted, mirrors .onb-hero-card from the
           Employee Onboarding Hub so the two HR landings feel like
           siblings. */
        .hrexp-hero-card {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap;
          padding: 18px 22px;
          border-radius: 16px;
          background: linear-gradient(135deg, #f3edff 0%, #ede4ff 100%);
          border: 1px solid #e3d6ff;
          box-shadow: 0 2px 12px rgba(124,92,252,0.06);
        }
        [data-bs-theme="dark"] .hrexp-hero-card {
          background: linear-gradient(135deg, rgba(124,92,252,0.18) 0%, rgba(167,139,250,0.10) 100%);
          border-color: rgba(124,92,252,0.32);
        }
        .hrexp-hero-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 10px; border-radius: 999px;
          font-size: 11px; font-weight: 700;
          background: rgba(124,92,252,0.18); color: #5a3fd1;
        }
        .hrexp-hero-pill .dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.20);
        }
        /* Solid violet primary button — Export. Same as .onb-checklist-cta. */
        .hrexp-cta {
          padding: 10px 18px;
          font-size: 13px; font-weight: 700;
          color: #fff !important;
          background: linear-gradient(135deg,#7c5cfc 0%,#5a3fd1 100%) !important;
          border: none !important;
          border-radius: 999px;
          box-shadow: 0 8px 18px rgba(91,63,209,0.30) !important;
          display: inline-flex; align-items: center;
          cursor: pointer;
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .hrexp-cta:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 22px rgba(91,63,209,0.38) !important;
        }
        /* Ghost button — All Dates. White surface with violet border on hover. */
        .hrexp-ghost-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 9px 16px;
          font-size: 13px; font-weight: 600;
          background: #ffffff;
          color: #5a3fd1;
          border: 1px solid rgba(124,92,252,0.30);
          border-radius: 999px;
          cursor: pointer;
          transition: all .15s ease;
        }
        .hrexp-ghost-btn:hover {
          background: #faf6ff;
          border-color: #a78bfa;
          color: #5a3fd1;
        }
        [data-bs-theme="dark"] .hrexp-ghost-btn {
          background: rgba(124,92,252,0.10);
          color: #c4b5fd;
        }
      `}</style>

        {/* ── Hero header — purple-tinted card mirroring the Employee
             Onboarding Hub. Violet icon tile on the left, title + small
             "Live" pill + subtitle, and the All Dates filter + violet
             gradient Export CTA on the right. */}
        <div className="hrexp-hero-card mb-3">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
              style={{
                width: 46, height: 46,
                background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
                boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
              }}
            >
              <i className="ri-bank-card-2-line" style={{ color: '#fff', fontSize: 21 }} />
            </span>
            <div className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Expense Management</h5>
                <span className="hrexp-hero-pill">
                  <span className="dot" />Live
                </span>
              </div>
              <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                Employee expense claims, approvals, and reimbursements
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <div style={{ minWidth: 160 }}>
              <MasterSelect
                value={dateFilter}
                onChange={(v) => setDateFilter((v as DateFilter) || 'all')}
                options={(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(k => ({
                  value: k,
                  label: DATE_FILTER_LABELS[k],
                }))}
                placeholder="All Dates"
              />
            </div>
            <button type="button" onClick={exportCsv} className="hrexp-cta rounded-pill">
              <i className="ri-download-2-line me-2" style={{ fontSize: 16 }} />
              Export
            </button>
          </div>
        </div>

        {/* ── KPI tiles — five cards mirroring the onboarding list view ── */}
        <Row className="g-3 mb-3 align-items-stretch">
          <Col xl={true} md={4} sm={6} xs={12}>
            <KpiTile
              label="Total Claims"
              sub={dateSubLabel}
              value={counts.all}
              iconClass="ri-file-list-3-line"
              strip="#7c5cfc"
              tint="#ece6ff"
              fg="#7c5cfc"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={12}>
            <KpiTile
              label="Total Amount"
              sub={dateSubLabel}
              value={fmtCompact(totalAmount)}
              iconClass="ri-money-rupee-circle-line"
              strip="#f97316"
              tint="#fdf3d6"
              fg="#a06f00"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={12}>
            <KpiTile
              label="Approved"
              sub="Disbursable"
              value={fmtCompact(approvedAmount)}
              iconClass="ri-checkbox-circle-line"
              strip="#10b981"
              tint="#d6f4e3"
              fg="#108548"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={12}>
            <KpiTile
              label="Pending Review"
              sub="Awaiting approval"
              value={counts.pending}
              iconClass="ri-time-line"
              strip="#3b82f6"
              tint="#dceefe"
              fg="#0c63b0"
            />
          </Col>
          <Col xl={true} md={4} sm={6} xs={12}>
            <KpiTile
              label="Rejected"
              sub="This cycle"
              value={counts.rejected}
              iconClass="ri-close-circle-line"
              strip="#f06548"
              tint="#fdd9d6"
              fg="#b1401d"
            />
          </Col>
        </Row>

        {/* ── Spend by Category + Policy Limits ── */}
        <Row className="g-3 mb-3 align-items-stretch">
          <Col xl={8} lg={7}>
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
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{ width: 28, height: 28, borderRadius: 8, background: '#ece6ff', color: '#7c5cfc', fontSize: 14 }}
                  >
                    <i className="ri-bar-chart-2-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Spend by Category</h6>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>{dateSubLabel}</small>
              </div>
              {spendByCategory.length === 0 ? (
                <div className="text-center text-muted py-4" style={{ fontSize: 12 }}>
                  <i className="ri-bar-chart-line d-block mb-2" style={{ fontSize: 24, opacity: 0.45 }} />
                  No spend recorded for {DATE_FILTER_LABELS[dateFilter].toLowerCase()}.
                </div>
              ) : (
                <div className="d-flex flex-column" style={{ gap: 10 }}>
                  {spendByCategory.map(c => {
                    const pct = maxCatSpend > 0 ? (c.spent / maxCatSpend) * 100 : 0;
                    return (
                      <div key={`${c.id}:${c.name}`} className="d-flex flex-column" style={{ gap: 4 }}>
                        <div className="d-flex align-items-center justify-content-between" style={{ fontSize: 12 }}>
                          <div className="d-flex align-items-center gap-2 fw-semibold" style={{ color: 'var(--vz-body-color, #1f2937)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                            {c.name}
                          </div>
                          <span className="fw-bold" style={{ color: c.color, fontVariantNumeric: 'tabular-nums' }}>
                            ₹{Number(c.spent).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 999, background: 'var(--vz-secondary-bg, #f3f4f6)', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: c.color,
                              borderRadius: 999,
                              transition: 'width .3s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Col>

          <Col xl={4} lg={5}>
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
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{ width: 28, height: 28, borderRadius: 8, background: '#fdd9d6', color: '#b1401d', fontSize: 14 }}
                  >
                    <i className="ri-shield-check-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Policy Limits</h6>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>
                  {dateFilter === 'month' ? 'Monthly cap' : `Pro-rated · ${DATE_FILTER_LABELS[dateFilter].toLowerCase()}`}
                </small>
              </div>
              {policyLimitRows.length === 0 ? (
                <div className="text-center text-muted py-4" style={{ fontSize: 12 }}>
                  <i className="ri-shield-line d-block mb-2" style={{ fontSize: 24, opacity: 0.45 }} />
                  No policy limits configured.<br />
                  <span style={{ fontSize: 11 }}>Set monthly limits in the Expense Categories master.</span>
                </div>
              ) : (
                <div className="d-flex flex-column" style={{ gap: 12 }}>
                  {policyLimitRows.map(c => {
                    const limitTxt = c.limit > 0 ? `₹${Math.round(c.limit).toLocaleString('en-IN')}` : '—';
                    const spentTxt = `₹${Number(c.spent).toLocaleString('en-IN')}`;
                    const barColor = c.over ? '#ef4444' : c.usedPct >= 75 ? '#f59e0b' : '#22c55e';
                    return (
                      <div key={`pol:${c.id}:${c.name}`} className="d-flex flex-column" style={{ gap: 4 }}>
                        <div className="d-flex align-items-center justify-content-between" style={{ fontSize: 12 }}>
                          <span className="fw-semibold" style={{ color: 'var(--vz-body-color, #1f2937)' }}>{c.name}</span>
                          <div className="d-flex align-items-center gap-2">
                            <span
                              className="text-muted"
                              style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}
                            >
                              {spentTxt} / {limitTxt}
                            </span>
                            {c.over && (
                              <span
                                className="d-inline-flex align-items-center fw-bold"
                                style={{
                                  fontSize: 9.5, padding: '1px 7px', borderRadius: 999,
                                  background: '#fdd9d6', color: '#b1401d',
                                  letterSpacing: '0.06em', textTransform: 'uppercase',
                                }}
                              >
                                Over
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ height: 5, borderRadius: 999, background: 'var(--vz-secondary-bg, #f3f4f6)', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${c.limit > 0 ? c.usedPct : 0}%`,
                              height: '100%',
                              background: barColor,
                              borderRadius: 999,
                              transition: 'width .3s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Col>
        </Row>

        {/* ── Main card with status tabs + filter row + table ── */}
        <Card className="border-0" style={{ borderRadius: 14 }}>
          <CardBody>
            {/* Status tabs — pill-style, mirrors the Active/Disabled tabs on
                the HrEmployees page. Active tab gets the violet gradient with
                white text + count chip; inactive tabs sit transparent with
                muted text inside the same rounded gray bar. */}
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
                    { key: 'all'      as StatusFilter, label: 'All Claims',     count: counts.all,      icon: 'ri-stack-line'             },
                    { key: 'pending'  as StatusFilter, label: 'Pending Review', count: counts.pending,  icon: 'ri-time-line'              },
                    { key: 'approved' as StatusFilter, label: 'Approved',       count: counts.approved, icon: 'ri-checkbox-circle-line'   },
                    { key: 'rejected' as StatusFilter, label: 'Rejected',       count: counts.rejected, icon: 'ri-close-circle-line'      },
                  ].map(t => {
                    const on = filter === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setFilter(t.key)}
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

            {/* Filter row — search on the left, Category + Department
                dropdowns on the right. Mirrors the HrEmployees Status /
                Department row exactly so both pages read as siblings. */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search employee, claim no, category, vendor…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <i className="ri-search-line search-icon" />
                </div>
              </Col>
              <Col md={6} sm={12} className="d-flex justify-content-md-end gap-3 flex-wrap align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Category</span>
                  <div style={{ minWidth: 170 }}>
                    <MasterSelect
                      value={categoryFilter}
                      onChange={(v) => setCategoryFilter(v || 'all')}
                      options={[
                        { value: 'all', label: 'All Categories' },
                        ...categoryOptions.map(c => ({ value: c, label: c })),
                      ]}
                      placeholder="All Categories"
                    />
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Department</span>
                  <div style={{ minWidth: 170 }}>
                    <MasterSelect
                      value={departmentFilter}
                      onChange={(v) => setDepartmentFilter(v || 'all')}
                      options={[
                        { value: 'all', label: 'All Depts' },
                        ...departmentOptions.map(d => ({ value: d, label: d })),
                      ]}
                      placeholder="All Depts"
                    />
                  </div>
                </div>
              </Col>
            </Row>

            <div>
            <ExpenseClaimsTable
              rows={filtered}
              loading={loading}
              mode="hr"
              canHrApprove={canHrApprove}
              currentEmployeeId={user?.employee_id ?? null}
              onAct={onAct}
            />

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
              <small className="text-muted">
                Showing <strong className="text-body">{filtered.length}</strong> of <strong className="text-body">{dateFilteredRows.length}</strong> claims
                {dateFilter !== 'all' && <> · <strong className="text-body">{DATE_FILTER_LABELS[dateFilter]}</strong></>}
              </small>
              <small className="text-muted d-inline-flex align-items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                Live data
              </small>
            </div>
            </div>
          </CardBody>
        </Card>
    </>
  );
}
