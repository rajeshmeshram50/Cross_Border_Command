import { useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import DataTable, { TruncCell, type DataTableColumn } from './ui/DataTable';
import ProofOfPaymentCell from './ProofOfPaymentCell';
import '../../css/recruitment.css';


export type AdvanceRequestRow = {
  id: number;
  advance_no: string | null;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  department_id?: number | null;
  department_name?: string | null;
  manager_id: number | null;
  reporting_manager_user_id?: number | null;
  manager_name: string | null;
  advance_type: string;
  advance_type_other: string | null;
  amount: number;
  used_for?: 'self' | 'company' | string;
  expected_use_date?: string | null;
  requested_date: string;
  recovery_start: string;
  recovery_mode: 'emi' | 'lumpsum' | 'bimonthly' | string;
  recovery_months: number | null;
  monthly_emi: number | null;
  recovery_recovered?: number;   // payroll-recovered so far (self stream)
  recovery_complete?: boolean;   // fully recovered → Settle shows "Recovered"
  settle_return_recovered?: number;
  reason: string;
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
  // Settlement (post-approval payout) — mirrors ExpenseClaimRow.
  sanctioned_amount?: number | null;
  deduction_amount?: number;
  total_paid?: number;
  settlement_status?: 'unpaid' | 'partial' | 'paid';
  remaining_amount?: number | null;
  // Zoho Books push state across this company advance's payouts (list column).
  zoho_sync?: 'na' | 'pending' | 'partial' | 'completed';
  // Recorded payouts — surfaced as Payment entries in the audit log.
  payments?: { amount: number; method?: string | null; paid_by_name: string | null; paid_at: string | null }[];
  // Employee "Settle" — set on a fully-paid Company advance by the employee.
  employee_settled_at?: string | null;
  // Follow-through status (drives the action button when settlement is done).
  settle_type?: 'equal' | 'return' | 'reimburse' | null;
  settle_balance?: number;
  settle_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  settle_returned_at?: string | null;
  settle_return_scheduled_at?: string | null;
  settle_reimbursed?: boolean;
  settle_return_remaining?: number;
  settle_return_pending?: number;   // recorded return payments awaiting HR/branch approval
};

type ActionKind = 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject';

type Props = {
  rows: AdvanceRequestRow[];
  loading?: boolean;
  fallbackName?: string;
  fallbackInitials?: string;
  accent?: string;
  /** 'mine' = no inline approve UI; 'team' = manager approve/reject; 'hr' = HR approve/reject */
  mode?: 'mine' | 'team' | 'hr';
  currentEmployeeId?: number | null;
  canHrApprove?: boolean;
  /** Which Used-For view is active. 'company' hides the recovery columns
   *  (Recovery Start / Recovery / Monthly EMI) since a company advance has none. */
  usedFor?: 'self' | 'company';
  onAct?: (id: number, action: ActionKind, comment?: string) => Promise<void> | void;
  /** HR/Finance: open the Record-Payment (settlement) form for an approved advance. */
  onRecordPayment?: (row: AdvanceRequestRow) => void;
  /** Anyone (e.g. the owner): open the settlement read-only to see the payout history. */
  onViewPayments?: (row: AdvanceRequestRow) => void;
  /** Manager / HR: open the "Review & Approve" popup instead of inline icon buttons. */
  onReview?: (row: AdvanceRequestRow) => void;
  /** Employee: mark a fully-paid Company advance as settled. */
  onSettle?: (row: AdvanceRequestRow) => void;
  /** Open the reimbursement claim form directly for an over-spent settled advance. */
  onRaiseReimbursement?: (row: AdvanceRequestRow) => void;
  /** Internal: open the "Decline reason" popup for a rejected row. */
  onShowRemark?: (row: AdvanceRequestRow) => void;
};

/* Payout status pill — only meaningful once an advance is approved. */
const PAY_TONE: Record<'paid' | 'partial' | 'pending', { bg: string; fg: string; icon: string; label: string }> = {
  paid:    { bg: '#d6f4e3', fg: '#108548', icon: 'ri-checkbox-circle-line', label: 'Completed' },
  partial: { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-progress-4-line',      label: 'Partial'  },
  pending: { bg: '#fdd9d6', fg: '#b1401d', icon: 'ri-time-line',            label: 'Pending'  },
};

function paymentStatusOf(r: AdvanceRequestRow): 'paid' | 'partial' | 'pending' | null {
  if (r.status !== 'approved') return null;
  const s = r.settlement_status ?? 'unpaid';
  if (s === 'paid') return 'paid';
  if (s === 'partial') return 'partial';
  return 'pending';
}

const STATUS_TONE: Record<AdvanceRequestRow['status'], { bg: string; fg: string; dot: string; label: string }> = {
  pending:  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b', label: 'Pending'  },
  approved: { bg: '#d6f4e3', fg: '#108548', dot: '#10b981', label: 'Approved' },
  rejected: { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444', label: 'Rejected' },
};

const RECOVERY_LABEL: Record<string, string> = {
  emi:        'EMI',
  lumpsum:    'Lump Sum',
  bimonthly:  'Bi-Monthly',
};

const BADGE_DARK_CSS = `
[data-bs-theme="dark"] .adv-id-badge       { background: #11324d !important; color: #7cc4f8 !important; }
[data-bs-theme="dark"] .adv-type-badge     { background: #2a1d5c !important; color: #c4b5fd !important; }
[data-bs-theme="dark"] .adv-recovery-badge { background: #0c2e2b !important; color: #5eead4 !important; }
[data-bs-theme="dark"] .adv-status-badge--pending  { background: #3a2a08 !important; color: #fbbf24 !important; }
[data-bs-theme="dark"] .adv-status-badge--approved { background: #0c2e1d !important; color: #4ade80 !important; }
[data-bs-theme="dark"] .adv-status-badge--rejected { background: #3a0e1e !important; color: #f9a8d4 !important; }

/* Confirm Approve / Reject button — hover lift + brightness so the action
   has visible feedback, plus a disabled state used while the request is
   being processed (prevents repeated clicks → duplicate submissions). */
.adv-confirm-action-btn { transition: filter .15s ease, transform .15s ease, box-shadow .15s ease; }
.adv-confirm-action-btn:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.20); }
.adv-confirm-action-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.adv-confirm-action-btn:disabled { opacity: 0.7; cursor: not-allowed; }
`;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${fmtDate(iso)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function initialsFromName(name: string | null | undefined, fallback?: string): string {
  if (!name) return fallback || 'EM';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || (fallback || 'EM');
}

/** Sanctum bearer in the download URL so plain <a> clicks work on the
 *  query-token-auth attachment route. */
function withAuthToken(url: string): string {
  if (!url) return url;
  let token = '';
  try { token = localStorage.getItem('cbc_token') || ''; } catch {}
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/* Column set for the shared <DataTable>. Exported so the HR Expense
 * Management page can wrap its own tabs / search / pager around exactly these
 * columns, while the employee-profile advance tab uses the component below.
 * Widths sum to 100 (fixed layout): 4+8+13+11+14+8+8+9+8+8+5+7+9 → see below. */
export function advanceRequestColumns({
  accent = '#6366f1', fallbackName, fallbackInitials,
  mode = 'mine', currentEmployeeId = null, canHrApprove = false, usedFor = 'self', onAct,
  onRecordPayment, onViewPayments, onReview, onSettle, onRaiseReimbursement, onShowRemark,
}: Omit<Props, 'rows' | 'loading'>): DataTableColumn<AdvanceRequestRow>[] {
  return [
    {
      header: 'Adv ID',
      id: 'advance_no',
      accessorFn: (r: AdvanceRequestRow) => r.advance_no || `#${r.id}`,
      meta: { width: '8%' },
      cell: info => (
        <span
          className="font-monospace fw-semibold adv-id-badge"
          style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#dceefe', color: '#0c63b0', letterSpacing: '0.02em' }}
        >
          {info.row.original.advance_no || `#${info.row.original.id}`}
        </span>
      ),
    },
    {
      header: 'Employee',
      id: 'employee',
      accessorFn: (r: AdvanceRequestRow) => r.employee_name || fallbackName || `#${r.employee_id}`,
      meta: { width: '13%' },
      cell: info => {
        const r = info.row.original;
        const empName = r.employee_name || fallbackName || ('#' + r.employee_id);
        return (
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{
                width: 24, height: 24, fontSize: 10,
                background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                boxShadow: `0 2px 6px ${accent}40`,
              }}
            >
              {initialsFromName(r.employee_name, fallbackInitials)}
            </div>
            <div className="d-flex flex-column" style={{ lineHeight: 1.15, minWidth: 0 }}>
              <span className="fw-semibold text-truncate">{empName}</span>
              {r.employee_code && <small className="text-muted" style={{ fontSize: 10 }}>{r.employee_code}</small>}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Advance Type',
      id: 'advance_type',
      // "Other" carries the free-text detail, so sort/search see the full label.
      accessorFn: (r: AdvanceRequestRow) => (r.advance_type === 'Other' && r.advance_type_other ? `Other · ${r.advance_type_other}` : r.advance_type),
      meta: { width: '11%' },
      cell: info => (
        <span
          className="d-inline-flex align-items-center gap-1 fw-semibold adv-type-badge"
          style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#ece6ff', color: '#5a3fd1', maxWidth: '100%' }}
        >
          <i className="ri-bank-card-line" />
          <span className="text-truncate">{String(info.getValue() ?? '')}</span>
        </span>
      ),
    },
    // Reason is a SELF-advance concern (why the employee needs the money). A
    // company advance's purpose lives in its distribution rows, so the column is
    // dropped on the Company Used view to make room.
    ...(usedFor === 'company' ? [] : [
    {
      header: 'Reason',
      accessorKey: 'reason',
      meta: { width: '14%' },
      cell: (info: any) => <TruncCell value={info.getValue() as string} caseSensitive max={70} />,
    },
    ] as DataTableColumn<AdvanceRequestRow>[]),
    {
      header: 'Amount',
      accessorKey: 'amount',
      meta: { width: '9%', align: 'right' },
      cell: info => <span className="fw-bold">₹{Number(info.row.original.amount || 0).toLocaleString('en-IN')}</span>,
    },
    {
      header: 'Requested',
      id: 'requested_date',
      accessorFn: (r: AdvanceRequestRow) => (r.requested_date ? new Date(r.requested_date).getTime() : 0),
      meta: { width: '9%' },
      cell: info => <span className="text-muted">{fmtDate(info.row.original.requested_date)}</span>,
    },
    // Recovery Start / Recovery / Monthly EMI apply to a SELF advance only — a
    // company advance isn't recovered from salary, so these columns are dropped
    // entirely on the Company Used view (matches the form).
    ...(usedFor === 'company' ? [] : [
    {
      header: 'Recovery Start',
      id: 'recovery_start',
      accessorFn: (r: AdvanceRequestRow) => (r.recovery_start ? new Date(r.recovery_start).getTime() : 0),
      meta: { width: '9%' },
      // A rejected advance is never recovered — read "N/A" instead of a value /
      // bare "—" so it looks intentional (QA #134).
      cell: info => info.row.original.status === 'rejected'
        ? <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>
        : <span className="text-muted">{fmtDate(info.row.original.recovery_start)}</span>,
    },
    {
      header: 'Recovery',
      id: 'recovery_mode',
      accessorFn: (r: AdvanceRequestRow) => RECOVERY_LABEL[r.recovery_mode] || r.recovery_mode,
      meta: { width: '8%' },
      cell: info => {
        if (info.row.original.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        return (
          <span
            className="d-inline-flex align-items-center fw-semibold adv-recovery-badge"
            style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#d3f0ee', color: '#0a716a' }}
          >
            {String(info.getValue() ?? '')}
          </span>
        );
      },
    },
    {
      /* Only EMI recoveries have a monthly figure; lump-sum/bi-monthly show —.
         Sorts on the numeric EMI so the biggest deduction leads. */
      header: 'Monthly EMI',
      id: 'monthly_emi',
      accessorFn: (r: AdvanceRequestRow) => (r.recovery_mode === 'emi' ? Number(r.monthly_emi || 0) : 0),
      meta: { width: '9%' },
      cell: info => {
        const r = info.row.original;
        if (r.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        return (
          <span className="text-muted">
            {r.recovery_mode === 'emi'
              ? `₹${Number(r.monthly_emi || 0).toLocaleString('en-IN')}${r.recovery_months ? ` × ${r.recovery_months} mo` : ''}`
              : '—'}
          </span>
        );
      },
    },
    ] as DataTableColumn<AdvanceRequestRow>[]),
    {
      header: () => <div className="text-center">Attachments</div>,
      id: '__attachments',
      enableSorting: false,
      meta: { align: 'center', width: '11%' },
      /* First receipt inline; extras collapse into a "+N more" popover so
         multiple uploads never expand the row height. */
      cell: info => (
        <ProofOfPaymentCell
          attachments={info.row.original.attachments}
          withAuthToken={withAuthToken}
          accent={{ bg: 'rgba(99,102,241,0.10)', fg: '#4338ca', border: 'rgba(99,102,241,0.25)' }}
        />
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '8%', align: 'center' },
      cell: info => {
        const s = info.row.original.status;
        const tone = STATUS_TONE[s];
        return (
          <span
            className={`d-inline-flex align-items-center gap-1 fw-semibold adv-status-badge adv-status-badge--${s}`}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: tone.bg, color: tone.fg }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.dot }} />
            {tone.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Advance Paid</div>,
      id: 'payment_status',
      enableSorting: false,
      accessorFn: (r: AdvanceRequestRow) => paymentStatusOf(r) ?? '',
      meta: { width: '10%', align: 'center' },
      cell: info => {
        // A rejected request is never paid — read "N/A" rather than a bare "—"
        // so it looks intentional, not like a missing value (QA #122).
        if (info.row.original.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        const ps = paymentStatusOf(info.row.original);
        if (!ps) return <span className="text-muted">—</span>;
        const t = PAY_TONE[ps];
        return (
          <span
            className="d-inline-flex align-items-center gap-1 fw-semibold"
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg }}
          >
            <i className={t.icon} />
            {t.label}
          </span>
        );
      },
    },
    // Confirmation — the employee's utilisation confirmation on a fully-paid
    // COMPANY advance. It's a company-only concept, so the column is dropped
    // entirely on the Self Used view (a self advance is recovered from salary;
    // its progress lives in the Recovery columns).
    ...(usedFor === 'company' ? [{
      header: () => <div className="text-center">Confirmation</div>,
      id: 'settle',
      enableSorting: false,
      meta: { width: '10%', align: 'center' },
      cell: (info: any) => {
        const r = info.row.original;
        // A rejected request is never settled — "N/A" instead of a bare "—" (QA #122).
        if (r.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        const isCompany = (r.used_for || 'self') === 'company';
        const pillEl = (icon: string, label: string, bg: string, fg: string) => (
          <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: bg, color: fg }}>
            <i className={icon} /> {label}
          </span>
        );
        if (isCompany) {
          const paid = r.status === 'approved' && (r.settlement_status ?? 'unpaid') === 'paid';
          if (!paid) return <span className="text-muted">—</span>;
          // Company: employee settles the usage → branch/HR approve → done.
          if (r.settle_approval_status === 'rejected') {
            return pillEl('ri-close-circle-line', 'Reopened', '#fee2e2', '#b91c1c');
          }
          if (r.settle_approval_status === 'approved' || r.employee_settled_at) {
            // For an under-spent (return) advance the settlement being approved
            // is NOT the end — the employee still has to pay the balance back,
            // and each return payment needs HR/branch confirmation. Reflect that
            // follow-through here instead of a blanket "Completed". (legacy path)
            if (r.settle_type === 'return') {
              if ((r.settle_return_pending ?? 0) > 0) {
                return pillEl('ri-time-line', 'Return in review', '#fef3c7', '#a4661c');
              }
              if (r.settle_returned_at) {
                return pillEl('ri-checkbox-circle-line', 'Returned', '#d6f4e3', '#108548');
              }
              if (r.settle_return_scheduled_at) {
                return pillEl('ri-calendar-todo-line', 'Return via payroll', '#eef2ff', '#3730a3');
              }
              return pillEl('ri-arrow-go-back-line', 'Return due', '#fde8c4', '#a4661c');
            }
            // Maximum used → the employee owes nothing but must raise an expense
            // claim for the extra they spent. It's only "Completed" once that
            // claim is actually raised; until then it's a "Partial" confirmation.
            if (r.settle_type === 'reimburse') {
              return r.settle_reimbursed
                ? pillEl('ri-checkbox-circle-line', 'Completed', '#d6f4e3', '#108548')
                : pillEl('ri-time-line', 'Partial', '#fde8c4', '#a4661c');
            }
            // Equal used — nothing more to do.
            return pillEl('ri-checkbox-circle-line', 'Completed', '#d6f4e3', '#108548');
          }
          // Fully paid but the employee hasn't confirmed utilization yet.
          return pillEl('ri-time-line', 'Pending', '#fde8c4', '#a4661c');
        }
        // Self: recovered from salary per the EMI schedule. Recovery can't start
        // until the advance has actually been PAID to the employee, so while the
        // advance-paid status is still pending, show "—" rather than "Recovering".
        if (r.status === 'approved' && r.recovery_mode) {
          if ((r.settlement_status ?? 'unpaid') !== 'paid') {
            return <span className="text-muted">—</span>;
          }
          return r.recovery_complete
            ? pillEl('ri-checkbox-circle-line', 'Recovered', '#d6f4e3', '#108548')
            : pillEl('ri-calendar-todo-line', 'Recovering', '#eef2ff', '#3730a3');
        }
        return <span className="text-muted">—</span>;
      },
    }] as DataTableColumn<AdvanceRequestRow>[] : [{
      // Self Used gets a Recovery Status column in the same slot — is the
      // salary recovery (EMI / bi-monthly / lump sum) still ongoing or fully
      // recovered? Recovery only starts once the advance has actually been PAID.
      header: () => <div className="text-center">Recovery Status</div>,
      id: 'recovery_status',
      enableSorting: false,
      meta: { width: '11%', align: 'center' },
      cell: (info: any) => {
        const r = info.row.original;
        const pill = (icon: string, label: string, bg: string, fg: string) => (
          <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: bg, color: fg }}>
            <i className={icon} /> {label}
          </span>
        );
        // A rejected advance is never recovered — "N/A" (matches QA #134).
        if (r.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        if (r.status === 'approved' && r.recovery_mode) {
          // Not paid out yet → recovery hasn't started.
          if ((r.settlement_status ?? 'unpaid') !== 'paid') {
            return <span className="text-muted">—</span>;
          }
          return r.recovery_complete
            ? pill('ri-checkbox-circle-line', 'Completed', '#d6f4e3', '#108548')
            : pill('ri-loader-4-line', 'Ongoing', '#e0e7ff', '#3730a3');
        }
        return <span className="text-muted">—</span>;
      },
    }] as DataTableColumn<AdvanceRequestRow>[]),
    // Zoho Books sync state — for BOTH self and company advances (the payout to
    // the employee is booked in Zoho either way). Mirrors the Expense Claims column.
    {
      header: () => <div className="text-center">Zoho Sync</div>,
      id: 'zoho_sync',
      enableSorting: false,
      meta: { width: '9%', align: 'center' },
      cell: (info: any) => {
        const z = (info.row.original.zoho_sync ?? 'na') as 'na' | 'pending' | 'partial' | 'completed';
        if (z === 'na') return <span className="text-muted">—</span>;
        const tone: Record<'pending' | 'partial' | 'completed', { bg: string; fg: string; icon: string; label: string }> = {
          completed: { bg: '#d6f4e3', fg: '#108548', icon: 'ri-checkbox-circle-line', label: 'Completed' },
          partial:   { bg: '#e0e7ff', fg: '#3730a3', icon: 'ri-loader-4-line',        label: 'Partial'   },
          pending:   { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-time-line',            label: 'Pending'   },
        };
        const t = tone[z];
        return (
          <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg }}>
            <i className={t.icon} /> {t.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      meta: { align: 'center', width: '16%', wrap: true },
      cell: info => (
        <AdvanceActionCell
          row={info.row.original}
          mode={mode}
          currentEmployeeId={currentEmployeeId}
          canHrApprove={canHrApprove}
          onAct={onAct}
          onRecordPayment={onRecordPayment}
          onViewPayments={onViewPayments}
          onReview={onReview}
          onSettle={onSettle}
          onRaiseReimbursement={onRaiseReimbursement}
          onShowRemark={onShowRemark}
        />
      ),
    },
  ];
}

export default function AdvanceRequestsTable({
  rows, loading,
  fallbackName, fallbackInitials, accent = '#6366f1',
  mode = 'mine', currentEmployeeId = null, canHrApprove = false, usedFor = 'self',
  onAct, onRecordPayment, onViewPayments, onReview, onSettle, onRaiseReimbursement,
}: Props) {
  const [remarkRow, setRemarkRow] = useState<AdvanceRequestRow | null>(null);
  const columns = useMemo(
    () => advanceRequestColumns({ accent, fallbackName, fallbackInitials, mode, currentEmployeeId, canHrApprove, usedFor, onAct, onRecordPayment, onViewPayments, onReview, onSettle, onRaiseReimbursement, onShowRemark: setRemarkRow }),
    [accent, fallbackName, fallbackInitials, mode, currentEmployeeId, canHrApprove, usedFor, onAct, onRecordPayment, onViewPayments, onReview, onSettle, onRaiseReimbursement],
  );
  return (
    <>
      <style>{BADGE_DARK_CSS}</style>
      <DeclineReasonModal row={remarkRow} onClose={() => setRemarkRow(null)} />
      {/* Search/paging off: callers own their sub-tabs, filters and pager and
          pass the page slice in. */}
      <DataTable<AdvanceRequestRow>
        data={rows}
        columns={columns}
        accent="violet"
        minWidth={1500}
        loading={!!loading}
        searchable={false}
        paginate={false}
        emptyMessage={
          <>
            <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            No advance requests to show.
          </>
        }
      />
    </>
  );
}

/** "Decline reason" popup — the full rejection remark for a rejected request.
 *  The reason lives on whichever stage rejected it (manager or HR/Finance).
 *  Exported so pages that build columns directly (e.g. HrExpenseManagement)
 *  can render it alongside their own DataTable. */
export function DeclineReasonModal({ row, onClose }: { row: AdvanceRequestRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);
  if (!row) return null;
  const reason =
    (row.manager_status === 'rejected' ? row.manager_comment : row.hr_comment)
    || row.hr_comment || row.manager_comment || '';
  return createPortal(
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 7000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '80vh', overflow: 'hidden',
          background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div
          className="d-flex align-items-center justify-content-between"
          style={{ background: '#dc2626', color: '#fff', padding: '12px 18px' }}
        >
          <span className="fw-bold" style={{ fontSize: 14 }}>Decline reason</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="d-inline-flex align-items-center justify-content-center"
            style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.22)', color: '#fff', cursor: 'pointer', fontSize: 14 }}
          >
            <i className="ri-close-line" />
          </button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          <div className="mb-2" style={{ fontSize: 11, color: '#6b7280' }}>
            {row.advance_no || `#${row.id}`}
            {row.employee_name ? ` · ${row.employee_name}` : ''}
          </div>
          {reason
            ? <div style={{ fontSize: 13, color: '#1f2937', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{reason}</div>
            : <div className="text-muted fst-italic" style={{ fontSize: 13 }}>No reason was provided.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Action cell — inline manager/HR approve-reject when the viewer may act on
 *  this row, plus the 3-dot audit-log popover. Owns the confirm-modal state,
 *  so it has to be a component: one instance per row. */
function AdvanceActionCell({
  row: r, mode, currentEmployeeId, canHrApprove, onAct,
  onRecordPayment, onViewPayments, onReview, onSettle, onRaiseReimbursement, onShowRemark,
}: {
  row: AdvanceRequestRow;
  mode: 'mine' | 'team' | 'hr';
  currentEmployeeId: number | null;
  canHrApprove: boolean;
  onAct?: Props['onAct'];
  onRecordPayment?: Props['onRecordPayment'];
  onViewPayments?: Props['onViewPayments'];
  onReview?: Props['onReview'];
  onSettle?: Props['onSettle'];
  onRaiseReimbursement?: Props['onRaiseReimbursement'];
  onShowRemark?: Props['onShowRemark'];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  type Confirm = { stage: 'manager' | 'hr'; verdict: 'approve' | 'reject' };
  const [confirmAction, setConfirmAction] = useState<Confirm | null>(null);
  const [comment, setComment] = useState('');

  const canManagerAct =
    mode === 'team'
    && r.manager_status === 'pending'
    && currentEmployeeId !== null
    && r.manager_id === currentEmployeeId
    && !!onAct;

  const canHrAct =
    mode === 'hr'
    && canHrApprove
    && r.manager_status === 'approved'
    && r.hr_status === 'pending'
    && !!onAct;

  // HR page: show Review & Approve on ANY pending advance (incl. manager-stage
  // rows, where clicking it nudges to the Inbox — manager approval is Inbox-only).
  const canHrReview =
    mode === 'hr' && canHrApprove && r.status === 'pending' && !!onReview;

  // HR "Record Payment" / "View history" — available on any approved advance.
  const canSettle = mode === 'hr' && canHrApprove && r.status === 'approved' && !!onRecordPayment;
  const settleDone = (r.settlement_status ?? 'unpaid') === 'paid';

  // Employee "Settle Payment" — a fully-paid COMPANY advance the owner hasn't
  // settled yet. Replaces the plain View action for that row.
  const isCompany = (r.used_for || 'self') === 'company';
  const fullyPaid = r.status === 'approved' && (r.settlement_status ?? 'unpaid') === 'paid';
  const isOwner = mode === 'mine' || (currentEmployeeId != null && r.employee_id === currentEmployeeId);
  const needsSettle = isCompany && fullyPaid && !r.employee_settled_at && isOwner && !!onSettle;
  // Follow-through pending after the employee has settled: return not yet paid /
  // scheduled, or reimbursement not yet raised. Shows a labelled button (not the eye).
  const settledDone = isCompany && !!r.employee_settled_at;
  const returnPending = settledDone && r.settle_type === 'return' && !r.settle_returned_at && !r.settle_return_scheduled_at;
  const reimbursePending = settledDone && r.settle_type === 'reimburse' && !r.settle_reimbursed;

  const verdictBtn = (stage: 'manager' | 'hr', verdict: 'approve' | 'reject') => (
    <button
      type="button"
      title={verdict === 'approve' ? 'Approve' : 'Reject'}
      onClick={() => { setConfirmAction({ stage, verdict }); setComment(''); }}
      className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
      style={{
        width: 28, height: 28, padding: 0,
        background: verdict === 'approve'
          ? 'linear-gradient(135deg,#0ab39c,#02c8a7)'
          : 'linear-gradient(135deg,#f06548,#ff7a5c)',
        color: '#fff', border: 'none',
      }}
    >
      <i className={verdict === 'approve' ? 'ri-check-line' : 'ri-close-line'} />
    </button>
  );

  return (
    <>
      <div className="d-inline-flex align-items-center gap-1 justify-content-center flex-nowrap">
        {/* Manager / HR act via the same Review & Approve popup as expense claims. */}
        {(canManagerAct || canHrReview) && onReview ? (
          (() => {
            // The viewer's OWN advance isn't self-approvable — greyed but still
            // clickable so onReview can toast the reason.
            const isOwn = mode === 'hr' && currentEmployeeId != null && Number(r.employee_id) === Number(currentEmployeeId);
            return (
              <button
                type="button"
                onClick={() => onReview(r)}
                title={isOwn ? 'Your own request — your reporting manager approves it' : undefined}
                className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill"
                style={{ height: 28, padding: '0 12px', fontSize: 11.5, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', whiteSpace: 'nowrap', ...(isOwn ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
              >
                <i className="ri-eye-line" /> Review &amp; Approve
              </button>
            );
          })()
        ) : (
          <>
            {canManagerAct && <>{verdictBtn('manager', 'approve')}{verdictBtn('manager', 'reject')}</>}
            {canHrAct && <>{verdictBtn('hr', 'approve')}{verdictBtn('hr', 'reject')}</>}
          </>
        )}
        {/* HR: record a payout / view the payout history on an approved advance. */}
        {canSettle && (
          <button
            type="button"
            onClick={() => onRecordPayment?.(r)}
            className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill"
            style={{ height: 28, padding: '0 12px', fontSize: 11.5, color: '#fff', border: 'none', background: settleDone ? 'linear-gradient(135deg,#0e7490,#0891b2)' : 'linear-gradient(135deg,#f59e0b,#fbbf24)', whiteSpace: 'nowrap' }}
          >
            <i className={settleDone ? 'ri-history-line' : 'ri-wallet-3-line'} /> {settleDone ? 'View History' : 'Record Payment'}
          </button>
        )}
        {/* Employee: settle a fully-paid company advance (replaces the View eye). */}
        {needsSettle && (
          <button
            type="button"
            onClick={() => onSettle?.(r)}
            className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill"
            title="Settle this advance against actual spend"
            style={{ height: 28, padding: '0 12px', fontSize: 11.5, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', whiteSpace: 'nowrap' }}
          >
            <i className="ri-check-double-line" /> Settle Payment
          </button>
        )}
        {/* Owner / non-HR: pending follow-through gets a labelled button; else the eye. */}
        {!canSettle && !needsSettle && onViewPayments && r.status === 'approved' && (r.settlement_status ?? 'unpaid') !== 'unpaid' && (
          returnPending ? (
            <button
              type="button"
              onClick={() => onViewPayments(r)}
              className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill"
              title="Employee return pending — record it"
              style={{ height: 28, padding: '0 12px', fontSize: 11.5, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#d97706,#f59e0b)', whiteSpace: 'nowrap' }}
            >
              <i className="ri-arrow-go-back-line" /> Return Pending
            </button>
          ) : reimbursePending ? (
            <>
              <button
                type="button"
                onClick={() => (onRaiseReimbursement ? onRaiseReimbursement(r) : onViewPayments(r))}
                className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill"
                title="Reimbursement pending — raise the expense"
                style={{ height: 28, padding: '0 12px', fontSize: 11.5, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#0e7490,#0891b2)', whiteSpace: 'nowrap' }}
              >
                <i className="ri-file-add-line" /> Raise Expense
              </button>
              <button
                type="button"
                onClick={() => onViewPayments(r)}
                className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                title="View details"
                style={{ width: 28, height: 28, padding: 0, color: '#0e7490', border: '1px solid #a5e9f3', background: '#ecfeff' }}
              >
                <i className="ri-eye-line" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onViewPayments(r)}
              className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
              title="View payout history"
              style={{ width: 28, height: 28, padding: 0, color: '#0e7490', border: '1px solid #a5e9f3', background: '#ecfeff' }}
            >
              <i className="ri-eye-line" />
            </button>
          )
        )}
        <AuditLogTrigger open={menuOpen} setOpen={setMenuOpen} row={r} viewerMode={mode} onShowRemark={onShowRemark} />
      </div>

      <AdvanceConfirmModal
        target={confirmAction && onAct ? { row: r, action: confirmAction } : null}
        comment={comment}
        setComment={setComment}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction || !onAct) return;
          const isApprove = confirmAction.verdict === 'approve';
          const action: ActionKind =
              confirmAction.stage === 'manager'
                ? (isApprove ? 'manager-approve' : 'manager-reject')
                : (isApprove ? 'hr-approve'      : 'hr-reject');
          await onAct(r.id, action, comment.trim() || undefined);
          setConfirmAction(null);
        }}
      />
    </>
  );
}

/* ── Audit log popover ──────────────────────────────────────────────── */
function AuditLogTrigger({
  open, setOpen, row, viewerMode, onShowRemark,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  row: AdvanceRequestRow;
  /** The table's mode — an HR/Finance viewer ('hr') doesn't see the reporting
   *  manager's private remark (QA #103). */
  viewerMode?: 'mine' | 'team' | 'hr';
  onShowRemark?: Props['onShowRemark'];
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const recompute = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const POP_WIDTH = 340;
      const POP_HEIGHT = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow > POP_HEIGHT
        ? rect.bottom + 6
        : Math.max(8, rect.top - POP_HEIGHT - 6);
      const left = Math.min(
        window.innerWidth - POP_WIDTH - 12,
        Math.max(12, rect.right - POP_WIDTH),
      );
      setPos({ top, left });
    };
    recompute();
    // Pinned to fixed coords: a scroll behind it strands the popover, so close
    // instead — unless the scroll is inside the popover's own body (CBC #53).
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('.ep-audit-popover')) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, setOpen]);

  // Lock the page behind the popover; the log itself still scrolls (CBC #73).
  useEffect(() => {
    if (!open) return;
    const body = document.body.style.overflow;
    const html = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = body;
      document.documentElement.style.overflow = html;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current && popRef.current.contains(t)) return;
      if (btnRef.current && btnRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="View audit log"
        onClick={() => setOpen(!open)}
        className="btn btn-sm d-inline-flex align-items-center justify-content-center"
        style={{
          width: 28, height: 28, padding: 0,
          background: open ? 'var(--vz-card-bg, #ffffff)' : 'var(--vz-secondary-bg, #f3f4f6)',
          color: 'var(--vz-secondary-color, #6b7280)',
          border: '1px solid var(--vz-border-color)',
          borderRadius: 8,
        }}
      >
        <i className="ri-more-2-fill" />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="ep-audit-popover"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 340,
            background: 'var(--vz-card-bg, #ffffff)',
            color: 'var(--vz-body-color, #1f2937)',
            border: '1px solid var(--vz-border-color, #e5e7eb)',
            borderRadius: 10,
            boxShadow: '0 18px 44px rgba(15,23,42,0.45)',
            padding: 14,
            zIndex: 6500,
            maxHeight: 'min(70vh, 420px)',
            overflowY: 'auto',
          }}
        >
          <AuditLogPopover row={row} viewerMode={viewerMode} onShowRemark={onShowRemark} />
        </div>,
        document.body,
      )}
    </>
  );
}

function AuditLogPopover({ row, viewerMode, onShowRemark }: { row: AdvanceRequestRow; viewerMode?: 'mine' | 'team' | 'hr'; onShowRemark?: Props['onShowRemark'] }) {
  const r = row;
  const stages: Array<{
    label: string; icon: string;
    state: 'pending' | 'approved' | 'rejected';
    actor: string | null;
    pendingHint?: string;
    at: string | null;
    comment: string | null;
    isCreated?: boolean;
  }> = [
    {
      label: 'Created',
      icon: 'ri-quill-pen-line',
      state: 'approved',
      actor: r.creator_name || (r.employee_name ? `By ${r.employee_name}` : null),
      at: r.created_at,
      comment: null,
      isCreated: true,
    },
    {
      label: 'Reporting Manager',
      icon: 'ri-user-star-line',
      state: r.manager_status,
      actor: r.manager_name
        || (r.manager_id ? `Manager #${r.manager_id}` : 'No manager assigned · skipped'),
      pendingHint: r.manager_name ? `Awaiting ${r.manager_name}` : 'Awaiting manager review',
      at: r.manager_acted_at,
      // A manager's APPROVAL remark is private — an HR/Finance viewer doesn't
      // see it (QA #103). But a REJECTION reason is the terminal decision and
      // must be visible to everyone who can see the row, including the branch
      // user acting as HR/Finance (so it isn't visible only to the manager).
      comment: (viewerMode === 'hr' && r.manager_status !== 'rejected') ? null : r.manager_comment,
    },
    // Rejected at the manager stage → the workflow stops there; HR never
    // reviews it, so the HR/Finance step is omitted entirely rather than
    // shown as a dangling "pending" (QA #106 refinement).
    ...(r.manager_status === 'rejected' ? [] : [{
      label: 'HR / Finance Manager',
      icon: 'ri-shield-check-line',
      state: r.hr_status,
      actor: r.hr_user_name,
      pendingHint: 'Awaiting HR / Finance review',
      at: r.hr_acted_at,
      comment: r.hr_comment,
    }]),
  ];

  return (
    <div style={{ color: 'var(--vz-body-color, #1f2937)' }}>
      <div className="fw-bold mb-3" style={{ fontSize: 13, color: 'var(--vz-body-color, #1f2937)' }}>
        Approval Audit Log
        <small className="d-block fw-normal" style={{ fontSize: 11, color: 'var(--vz-secondary-color, #6b7280)' }}>
          {r.advance_no || `#${r.id}`} · ₹{Number(r.amount || 0).toLocaleString('en-IN')}
        </small>
      </div>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 13, top: 8, bottom: 8,
          width: 2, background: 'var(--vz-border-color, #e5e7eb)', pointerEvents: 'none',
        }} />
        {stages.map((s, i) => {
          const isPending = s.state === 'pending';
          const isRejected = s.state === 'rejected';
          const dot = isPending ? '#94a3b8' : isRejected ? '#ef4444' : '#10b981';
          return (
            <div key={i} className="d-flex gap-2 mb-3 position-relative" style={{ minHeight: 28 }}>
              <span
                className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: isPending ? 'var(--vz-secondary-bg, #f3f4f6)' : dot,
                  color: isPending ? 'var(--vz-secondary-color, #6b7280)' : '#fff',
                  border: `2px solid ${isPending ? 'var(--vz-border-color, #e5e7eb)' : dot}`,
                  fontSize: 12, position: 'relative', zIndex: 1,
                }}
              >
                <i className={s.icon} />
              </span>
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="fw-semibold" style={{ fontSize: 12 }}>{s.label}</span>
                  <span
                    className={`d-inline-flex align-items-center fw-semibold ep-audit-stage-badge ep-audit-stage-badge--${isPending ? 'pending' : isRejected ? 'rejected' : 'approved'}`}
                    style={{
                      fontSize: 9.5, padding: '1px 7px', borderRadius: 999,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      background: isPending ? '#eef2f6' : isRejected ? '#fdd9ea' : '#d6f4e3',
                      color: isPending ? '#5b6478' : isRejected ? '#a02960' : '#108548',
                    }}
                  >
                    {s.isCreated ? 'Created' : s.state}
                  </span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--vz-secondary-color, #6b7280)' }}>
                  {s.at
                    ? <>{fmtDateTime(s.at)}{s.actor && <> · <span className="fw-semibold" style={{ color: 'var(--vz-body-color, #1f2937)' }}>{s.actor}</span></>}</>
                    : isPending && s.pendingHint
                      ? <span style={{ color: 'var(--vz-body-color, #1f2937)' }}>{s.pendingHint}</span>
                      : (s.actor || '—')}
                </div>
                {s.comment && (() => {
                  // Long remarks (a rejection reason) are clamped to two lines
                  // here so one entry can't flood the log; "View all" opens the
                  // full text in the Decline-reason popup.
                  const isLong = s.comment.length > 90 || s.comment.includes('\n');
                  return (
                    <>
                      <div
                        className="mt-1"
                        style={{
                          fontSize: 11, padding: '4px 8px', borderRadius: 6,
                          background: 'var(--vz-secondary-bg, #f3f4f6)', color: 'var(--vz-body-color, #1f2937)',
                          border: '1px solid var(--vz-border-color)',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden', wordBreak: 'break-word',
                        }}
                      >
                        {s.comment}
                      </div>
                      {isLong && onShowRemark && (
                        <button
                          type="button"
                          onClick={() => onShowRemark(r)}
                          className="p-0 border-0 bg-transparent fw-semibold mt-1"
                          style={{ fontSize: 10.5, color: '#b91c1c', cursor: 'pointer' }}
                        >
                          View all
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Approve / Reject confirmation modal ────────────────────────────── */
function AdvanceConfirmModal({
  target, comment, setComment, onClose, onConfirm,
}: {
  target: { row: AdvanceRequestRow; action: { stage: 'manager' | 'hr'; verdict: 'approve' | 'reject' } } | null;
  comment: string;
  setComment: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  if (!target) return null;
  const { row, action } = target;
  const isApprove = action.verdict === 'approve';
  const stageLabel = action.stage === 'manager' ? 'Manager' : 'HR / Finance';
  const tone = STATUS_TONE[row.status];

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try { await onConfirm(); }
    finally { setSubmitting(false); }
  };

  return createPortal(
    <div
      className={`expense-confirm-overlay cand-confirm-modal cand-confirm-modal--${isApprove ? 'select' : 'reject'}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 6800,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="border-0"
        style={{
          background: '#ffffff', color: '#1f2937',
          borderRadius: 16, overflow: 'hidden',
          width: '100%', maxWidth: 560,
          boxShadow: '0 24px 60px rgba(15,23,42,0.30)',
        }}
      >
        {/* Header */}
        <div className="cand-confirm-head">
          <span className="cand-confirm-head-icon">
            <i className={isApprove ? 'ri-check-line' : 'ri-close-line'} />
          </span>
          <div className="cand-confirm-head-text">
            <h5 className="mb-0">
              {isApprove ? `Approve Advance — ${stageLabel}` : `Reject Advance — ${stageLabel}`}
            </h5>
            <div className="cand-confirm-head-sub">
              {isApprove
                ? (action.stage === 'manager'
                    ? 'Forwards to HR / Finance for final approval'
                    : 'Final approval — advance will be marked Approved')
                : 'Closes the request — employee will see the rejection in their audit log'}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-confirm-close" disabled={submitting}>
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-confirm-body">
          {/* Advance summary card */}
          <div className="cand-confirm-summary">
            <div
              className="cand-confirm-avatar"
              style={{ background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' }}
            >
              <i className="ri-bank-card-line" style={{ fontSize: 18 }} />
            </div>
            <div className="cand-confirm-summary-text">
              <div className="cand-confirm-name">
                {row.advance_type || row.advance_no || `Advance #${row.id}`}
              </div>
              <div className="cand-confirm-meta">
                <span className="rec-id-pill">{row.advance_no || `#${row.id}`}</span>
                <span className="dot">·</span>
                <span>{row.employee_name || `Employee #${row.employee_id}`}</span>
                <span className="dot">·</span>
                <span className="fw-semibold" style={{ color: '#1f2937' }}>
                  ₹{Number(row.amount || 0).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <div className="cand-confirm-stage">
              <div className="cand-confirm-stage-label">Status</div>
              <span className="rec-pill" style={{ background: tone.bg, color: tone.fg }}>
                {tone.label}
              </span>
            </div>
          </div>

          <div className="cand-confirm-field">
            <label className="cand-confirm-label">
              {isApprove ? 'Approval Note' : 'Reason for Rejection'} <span className="opt">(OPTIONAL)</span>
            </label>
            <textarea
              className="cand-confirm-textarea"
              rows={3}
              placeholder={isApprove
                ? 'Add context for the audit trail (e.g. "Approved within policy limit")'
                : 'Explain why this advance is being rejected'}
              value={comment}
              onChange={e => setComment(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="cand-confirm-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="cand-confirm-submit" onClick={handleConfirm} disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Processing…
              </>
            ) : (
              <>
                <i className={isApprove ? 'ri-check-line' : 'ri-close-line'} />
                {isApprove ? 'Confirm Approval' : 'Confirm Rejection'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
