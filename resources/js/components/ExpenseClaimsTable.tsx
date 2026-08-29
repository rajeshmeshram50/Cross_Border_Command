import { useRef, useState, useEffect, useMemo } from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import { createPortal } from 'react-dom';
import DataTable, { TruncCell, type DataTableColumn } from './ui/DataTable';
import ProofOfPaymentCell from './ProofOfPaymentCell';
import { useToast } from '../contexts/ToastContext';
import Tooltip from './ui/Tooltip';
// Reuses the polished confirmation-modal CSS classes already shipping with
// the recruitment / candidate flows (cand-confirm-modal, cand-confirm-head,
// cand-confirm-body, cand-confirm-footer, etc.).
import '../../css/recruitment.css';

/**
 * Expense Claims table — single source of truth for the row layout used by
 * both the EmployeeProfile expense tab and the HR Expense Management page.
 * Reads API rows in the shape returned by ExpenseClaimController::serialize().
 *
 * Rendering rules:
 *   - The "Status" column shows ONLY the rolled-up status pill (Pending,
 *     Approved, Rejected). Per-stage details live in the audit log.
 *   - The "Action" column is a 3-dot dropdown that opens an audit-log
 *     popover with three rows: Created → Manager → HR/Finance.
 *   - When `mode === 'team'` AND the current user is the assigned manager
 *     for a row whose manager stage is still pending, inline Approve/Reject
 *     buttons appear next to the dropdown.
 *   - When `mode === 'hr'` AND the current user has HR permission AND the
 *     row's manager stage is approved but HR stage is still pending, inline
 *     HR Approve/Reject buttons appear.
 */

export type ExpenseClaimRow = {
  id: number;
  claim_no: string | null;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  department_id?: number | null;
  department_name?: string | null;
  manager_id: number | null;
  reporting_manager_user_id?: number | null;
  manager_name: string | null;
  category_id: number | null;
  category_name: string | null;
  /** Set when this claim is a reimbursement raised against a company advance. */
  reimbursement_for?: { id: number; advance_no: string | null } | null;
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
  // Settlement (post-approval payment)
  sanctioned_amount?: number | null;
  deduction_amount?: number;
  deduction_reason?: string | null;
  total_paid?: number;
  settlement_status?: 'unpaid' | 'partial' | 'paid';
  remaining_amount?: number | null;
  // Zoho Books push state across this claim's payments.
  zoho_sync?: 'na' | 'pending' | 'partial' | 'completed';
  // Recorded payouts — surfaced as Payment entries in the audit log.
  payments?: { amount: number; method?: string | null; paid_by_name: string | null; paid_at: string | null }[];
  zoho_all_synced?: boolean;
  reimbursement_emailed_at?: string | null;
};

type ActionKind = 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject';

type Props = {
  rows: ExpenseClaimRow[];
  loading?: boolean;
  /** Used as a fallback initials avatar tile when `employee_name` is null. */
  fallbackName?: string;
  fallbackInitials?: string;
  accent?: string;
  /** 'mine' = no inline approve UI; 'team' = manager approve/reject; 'hr' = HR approve/reject */
  mode?: 'mine' | 'team' | 'hr';
  /** Auth user employee.id — used to gate inline manager actions to the assigned manager. */
  currentEmployeeId?: number | null;
  /** Whether the current user has HR/Finance approval permission. */
  canHrApprove?: boolean;
  onAct?: (claimId: number, action: ActionKind, comment?: string) => Promise<void> | void;
  /** HR/Finance: open the Record-Payment (settlement) form for an approved claim. */
  onRecordPayment?: (claim: ExpenseClaimRow) => void;
  /** Anyone (e.g. the claim owner): open the settlement in read-only view to see
   *  the payment history. */
  onViewPayments?: (claim: ExpenseClaimRow) => void;
  /** HR: open the "Review & Approve" popup (header + KPIs + editable adjustments,
   *  then Approve/Reject) instead of the inline approve/reject icon buttons. */
  onReview?: (claim: ExpenseClaimRow) => void;
  /** HR: email the employee the reimbursement confirmation. Enabled only once the
   *  claim is fully paid AND every payment is synced to Zoho. */
  onEmailReimbursement?: (claim: ExpenseClaimRow) => void;
};

const STATUS_TONE: Record<ExpenseClaimRow['status'], { bg: string; fg: string; dot: string; label: string }> = {
  pending:  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b', label: 'Pending'  },
  approved: { bg: '#d6f4e3', fg: '#108548', dot: '#10b981', label: 'Approved' },
  rejected: { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444', label: 'Rejected' },
};

/* Payment (settlement) status pill — only meaningful once a claim is approved.
   'paid' → Complete, 'partial' → Partial, otherwise Pending. Non-approved
   claims show a muted dash since there's nothing to reimburse yet. */
const PAY_TONE: Record<'paid' | 'partial' | 'pending', { bg: string; fg: string; icon: string; label: string }> = {
  paid:    { bg: '#d6f4e3', fg: '#108548', icon: 'ri-checkbox-circle-line', label: 'Complete' },
  partial: { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-progress-4-line',      label: 'Partial'  },
  pending: { bg: '#fdd9d6', fg: '#b1401d', icon: 'ri-time-line',            label: 'Pending'  },
};

function paymentStatusOf(c: ExpenseClaimRow): 'paid' | 'partial' | 'pending' | null {
  if (c.status !== 'approved') return null;
  const s = c.settlement_status ?? 'unpaid';
  if (s === 'paid') return 'paid';
  if (s === 'partial') return 'partial';
  return 'pending';
}

/* Dark-mode badge tints. The EXP ID / Category / Status pills set light pastel
   backgrounds via inline styles (fine in light mode), which washed out to
   bright chips on the dark table. These rules override only in dark mode
   (!important beats the inline light colours); light mode is untouched. */
const BADGE_DARK_CSS = `
/* Column alignment — header + data line up per column. Text columns stay
   left; Amount is right-aligned (currency convention); Status & Action are
   centred. The th.<class> selectors out-rank the blanket "thead th left"
   rule so the header follows its column's data. */
.exp-claims-table thead th { text-align: left; }
.exp-claims-table thead th.exp-col-amount, .exp-claims-table td.exp-col-amount { text-align: right; }
.exp-claims-table thead th.exp-col-status, .exp-claims-table td.exp-col-status { text-align: center; }
[data-bs-theme="dark"] .exp-id-badge  { background: #2a1d5c !important; color: #c4b5fd !important; }
[data-bs-theme="dark"] .exp-cat-badge { background: rgba(255,255,255,0.08) !important; color: #cbd5e1 !important; }
[data-bs-theme="dark"] .exp-status-badge--pending  { background: #3a2a08 !important; color: #fbbf24 !important; }
[data-bs-theme="dark"] .exp-status-badge--approved { background: #0c2e1d !important; color: #4ade80 !important; }
[data-bs-theme="dark"] .exp-status-badge--rejected { background: #3a0e1e !important; color: #f9a8d4 !important; }
[data-bs-theme="dark"] .exp-pay-badge--paid    { background: #0c2e1d !important; color: #4ade80 !important; }
[data-bs-theme="dark"] .exp-pay-badge--partial { background: #3a2a08 !important; color: #fbbf24 !important; }
[data-bs-theme="dark"] .exp-pay-badge--pending { background: #3a1608 !important; color: #fdba74 !important; }
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

/** Append the sanctum bearer to a download URL so plain anchor clicks work
 *  without sending an Authorization header (Laravel resolves the user via
 *  ?token=… on the expense-claims/{id}/attachments/{idx} route). */
function withAuthToken(url: string): string {
  if (!url) return url;
  let token = '';
  try { token = localStorage.getItem('cbc_token') || ''; } catch {}
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/* Column set for the shared <DataTable>. Exported so the HR Expense
 * Management page can compose its own tabs / search / pager around exactly
 * these columns while the employee-profile tab keeps using the wrapper
 * component below — one definition of an expense row, two layouts.
 * Widths sum to 100 (fixed layout): 8+14+11+16+10+9+13+9+10. The Proof of
 * Payment column was added after the original split without the others giving
 * anything back, which pushed the total to 104% — in a fixed layout that
 * over-constraint silently shrinks every column. Rebalanced, with the extra
 * going to Proof so a real file name + extension fits. */
export function expenseClaimColumns({
  accent = '#7c5cfc', fallbackName, fallbackInitials,
  mode = 'mine', currentEmployeeId = null, canHrApprove = false, onAct, onRecordPayment, onViewPayments, onReview, onEmailReimbursement,
}: Omit<Props, 'rows' | 'loading'>): DataTableColumn<ExpenseClaimRow>[] {
  return [
    {
      header: () => <div className="text-center">Exp ID</div>,
      id: 'claim_no',
      accessorFn: (c: ExpenseClaimRow) => c.claim_no || `#${c.id}`,
      // Sort strictly by the ID's numeric sequence (EXP-0002 < EXP-0028), not a
      // raw string / any other column (QA #116). Falls back to a locale compare
      // when the numeric parts tie.
      sortingFn: (a, b) => {
        const numOf = (s: string) => { const m = /(\d+)/.exec(s || ''); return m ? parseInt(m[1], 10) : 0; };
        const av = a.original.claim_no || `#${a.original.id}`;
        const bv = b.original.claim_no || `#${b.original.id}`;
        const an = numOf(av), bn = numOf(bv);
        return an !== bn ? an - bn : String(av).localeCompare(String(bv));
      },
      // Fixed width sized to the "EXP-0000" pill + `wrap` so the cell opts
      // out of the table's default ellipsis clipping — the ID used to render
      // as "EXP-0002…" in an 8% column even though it fits. `title` still
      // gives the full ID on hover as a safety net.
      meta: { width: 104, wrap: true, align: 'center' },
      cell: info => {
        const id = info.row.original.claim_no || `#${info.row.original.id}`;
        return (
          <span
            className="font-monospace fw-semibold exp-id-badge"
            title={id}
            style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#ece6ff', color: '#5a3fd1', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}
          >
            {id}
          </span>
        );
      },
    },
    {
      header: 'Employee',
      id: 'employee',
      accessorFn: (c: ExpenseClaimRow) => c.employee_name || fallbackName || `#${c.employee_id}`,
      meta: { width: '14%', align: 'left' },
      cell: info => {
        const c = info.row.original;
        const empName = c.employee_name || fallbackName || ('#' + c.employee_id);
        return (
          <div className="d-flex flex-column" style={{ lineHeight: 1.15, minWidth: 0 }}>
            <span className="fw-semibold text-truncate">{empName}</span>
            {c.employee_code && <small className="text-muted" style={{ fontSize: 10 }}>{c.employee_code}</small>}
          </div>
        );
      },
    },
    {
      header: () => <div className="text-center">Category</div>,
      id: 'category',
      accessorFn: (c: ExpenseClaimRow) => c.category_name ?? '',
      meta: { width: '11%', align: 'center' },
      cell: info => (
        <span
          className="d-inline-flex align-items-center gap-1 fw-semibold exp-cat-badge"
          style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#eef2f6', color: '#5b6478', maxWidth: '100%' }}
        >
          <i className="ri-price-tag-3-line" />
          <span className="text-truncate">{info.row.original.category_name || '—'}</span>
        </span>
      ),
    },
    {
      header: 'Description',
      accessorKey: 'title',
      /* 13%, down from 15% — the 2% went to Zoho Sync. (#170) This cell is a
         TruncCell that already ellipsises at 70 chars and shows the full text
         on hover, so it degrades gracefully; a fixed status pill does not. */
      meta: { width: '13%' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive max={70} />,
    },
    {
      /* Company-advance link — only reimbursement claims carry it. */
      header: () => <div className="text-center">Linked Advance</div>,
      id: '__linked_advance',
      accessorFn: (c: ExpenseClaimRow) => c.reimbursement_for?.advance_no ?? '',
      meta: { width: '9%', align: 'center' },
      cell: info => {
        const adv = info.row.original.reimbursement_for;
        return adv?.advance_no
          ? <span className="badge rounded-pill" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700, padding: '4px 10px' }}><i className="ri-links-line me-1" />{adv.advance_no}</span>
          : <span className="text-muted">—</span>;
      },
    },
    {
      /* Sorts on the real date, not the dd-Mon-yyyy label — the formatted
         string would order 01-Dec before 02-Jan. */
      header: () => <div className="text-center">Expense Date</div>,
      id: 'expense_date',
      accessorFn: (c: ExpenseClaimRow) => (c.expense_date ? new Date(c.expense_date).getTime() : 0),
      meta: { width: '10%', align: 'center' },
      cell: info => <span className="text-muted">{fmtDate(info.row.original.expense_date)}</span>,
    },
    {
      header: () => <div className="text-center">Amount</div>,
      accessorKey: 'amount',
      meta: { width: '9%', align: 'center' },
      cell: info => <span className="fw-bold">₹{Number(info.row.original.amount || 0).toLocaleString('en-IN')}</span>,
    },
    {
      header: 'Proof of Payment',
      id: '__proof',
      enableSorting: false,
      meta: { align: 'left', width: '13%' },
      /* Only the first receipt shows in the cell; extras collapse into a
         "+N more" popover so multiple uploads can't expand the row height. */
      cell: info => (
        <ProofOfPaymentCell
          attachments={info.row.original.attachments}
          withAuthToken={withAuthToken}
          accent={{ bg: 'rgba(37,99,235,0.10)', fg: '#2563eb', border: 'rgba(37,99,235,0.25)' }}
        />
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '9%', align: 'center' },
      cell: info => {
        const s = info.row.original.status;
        const tone = STATUS_TONE[s];
        return (
          <span
            className={`d-inline-flex align-items-center gap-1 fw-semibold exp-status-badge exp-status-badge--${s}`}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: tone.bg, color: tone.fg }}
          >
            {tone.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Payment Status</div>,
      id: 'payment_status',
      enableSorting: false,
      accessorFn: (c: ExpenseClaimRow) => paymentStatusOf(c) ?? '',
      meta: { width: '11%', align: 'center' },
      cell: info => {
        /* A rejected claim is never paid — "N/A" rather than a bare "—", which
           reads as a value that failed to load (QA #122, same as advances). */
        if (info.row.original.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        const ps = paymentStatusOf(info.row.original);
        if (!ps) return <span className="text-muted">—</span>;
        const t = PAY_TONE[ps];
        return (
          <span
            className={`d-inline-flex align-items-center gap-1 fw-semibold exp-pay-badge exp-pay-badge--${ps}`}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg }}
          >
            <i className={t.icon} />
            {t.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Zoho Sync</div>,
      id: 'zoho_sync',
      enableSorting: false,
      accessorFn: (c: ExpenseClaimRow) => c.zoho_sync ?? 'na',
      /* 11%, up from 9%. (#170) The cell is a pill — icon + gap + label +
         20px of horizontal padding — and "Completed" is the longest label, so
         9% of this table's width left it clipped. The extra 2% is taken from
         Description below rather than added on top: the percentage columns
         already over-allocate at 110%, and widening one without narrowing
         another just squeezes every neighbour a little harder. Description is
         free text that reflows, so it is the column that can spare it. */
      meta: { width: '11%', align: 'center' },
      cell: info => {
        // Nothing is booked in Zoho for a rejected claim (QA #122).
        if (info.row.original.status === 'rejected') {
          return <span className="text-muted fst-italic" style={{ fontSize: 11 }}>N/A</span>;
        }
        const z = info.row.original.zoho_sync ?? 'na';
        if (z === 'na') return <span className="text-muted">—</span>;
        const tone: Record<'pending' | 'partial' | 'completed', { bg: string; fg: string; icon: string; label: string }> = {
          completed: { bg: '#d6f4e3', fg: '#108548', icon: 'ri-checkbox-circle-line', label: 'Completed' },
          partial:   { bg: '#e0e7ff', fg: '#3730a3', icon: 'ri-loader-4-line',        label: 'Partial'   },
          pending:   { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-time-line',            label: 'Pending'   },
        };
        const t = tone[z];
        return (
          /* nowrap so the label can never break between the icon and the word,
             or mid-word, whatever width the column ends up at. (#170) */
          <span
            className="d-inline-flex align-items-center gap-1 fw-semibold"
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}
            title={t.label}
          >
            <i className={t.icon} /> {t.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      // HR and the reporting-manager (team) view both show the wide "Review &
      // Approve" CTA, so the column reserves room for it — otherwise the fixed
      // table layout squeezed the button and the action group wrapped on some
      // rows but not others, leaving the column misaligned row-to-row (QA).
      meta: { align: 'center', width: (mode === 'hr' || mode === 'team') ? 240 : '10%', wrap: true },
      cell: info => (
        <ExpenseActionCell
          claim={info.row.original}
          mode={mode}
          currentEmployeeId={currentEmployeeId}
          canHrApprove={canHrApprove}
          onAct={onAct}
          onRecordPayment={onRecordPayment}
          onViewPayments={onViewPayments}
          onReview={onReview}
          onEmailReimbursement={onEmailReimbursement}
        />
      ),
    },
  ];
}

export default function ExpenseClaimsTable({
  rows, loading,
  fallbackName, fallbackInitials, accent = '#7c5cfc',
  mode = 'mine', currentEmployeeId = null, canHrApprove = false,
  onAct, onRecordPayment, onViewPayments, onReview, onEmailReimbursement,
}: Props) {
  const columns = useMemo(
    () => expenseClaimColumns({ accent, fallbackName, fallbackInitials, mode, currentEmployeeId, canHrApprove, onAct, onRecordPayment, onViewPayments, onReview, onEmailReimbursement }),
    [accent, fallbackName, fallbackInitials, mode, currentEmployeeId, canHrApprove, onAct, onRecordPayment, onViewPayments, onReview, onEmailReimbursement],
  );
  return (
    <>
      <style>{BADGE_DARK_CSS}</style>
      {/* Search and paging stay OFF here: the callers (employee profile expense
          tab) already own the sub-tabs, filter chips and their own
          WorklistPager, and hand this component the page slice. */}
      <DataTable<ExpenseClaimRow>
        data={rows}
        columns={columns}
        accent="violet"
        minWidth={1150}
        loading={!!loading}
        searchable={false}
        paginate={false}
        emptyMessage={
          <>
            <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            No claims to show.
          </>
        }
      />
    </>
  );
}

/** The Action cell — inline manager/HR approve-reject (when the viewer is
 *  allowed to act on this row) plus the 3-dot audit-log popover. It owns the
 *  confirm-modal state, which is why it's a component rather than inline JSX:
 *  each row needs its own. */
function ExpenseActionCell({
  claim: c, mode, currentEmployeeId, canHrApprove, onAct, onRecordPayment, onViewPayments, onReview, onEmailReimbursement,
}: {
  claim: ExpenseClaimRow;
  mode: 'mine' | 'team' | 'hr';
  currentEmployeeId: number | null;
  canHrApprove: boolean;
  onAct?: Props['onAct'];
  onRecordPayment?: Props['onRecordPayment'];
  onViewPayments?: Props['onViewPayments'];
  onReview?: Props['onReview'];
  onEmailReimbursement?: Props['onEmailReimbursement'];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  // Confirmation modal for both approve & reject. The action shape carries
  // both the verdict and the stage so we can render a contextual title +
  // submit colour, and so the same dispatcher hits the right backend route.
  type Confirm = { stage: 'manager' | 'hr'; verdict: 'approve' | 'reject' };
  const [confirmAction, setConfirmAction] = useState<Confirm | null>(null);
  const [comment, setComment] = useState('');

  const canManagerAct =
    mode === 'team'
    && c.manager_status === 'pending'
    && currentEmployeeId !== null
    && c.manager_id === currentEmployeeId
    && !!onAct;

  const canHrAct =
    mode === 'hr'
    && canHrApprove
    && c.manager_status === 'approved'
    && c.hr_status === 'pending'
    && !!onAct;

  // On the HR page a branch admin gets the Review & Approve button on ANY
  // pending claim — including a manager-stage row, where clicking it nudges
  // them to the Inbox (manager approval is Inbox-only). Without this the button
  // only showed at HR stage, so a manager-stage row had no click target.
  const canHrReview =
    mode === 'hr' && canHrApprove && c.status === 'pending' && !!onReview;

  // Record Payment / View history (settlement) — available on any approved claim.
  // When it's already fully paid the button flips to a "view history" affordance
  // (still opens the same modal) so the payment record stays reachable.
  const canSettle =
    mode === 'hr'
    && canHrApprove
    && c.status === 'approved'
    && !!onRecordPayment;
  const settleDone = (c.settlement_status ?? 'unpaid') === 'paid';

  // Email the employee — shown on every claim except Rejected; enabled only once
  // the claim is approved, fully paid AND every payment is synced to Zoho.
  const showEmail =
    mode === 'hr'
    && canHrApprove
    && c.status !== 'rejected'
    && !!onEmailReimbursement;
  const canEmail = showEmail && c.status === 'approved' && settleDone && !!c.zoho_all_synced;
  const emailedAlready = !!c.reimbursement_emailed_at;

  const verdictBtn = (stage: 'manager' | 'hr', verdict: 'approve' | 'reject') => (
    <Tooltip label={verdict === 'approve' ? 'Approve' : 'Reject'}>
      <button
        type="button"
        aria-label={verdict === 'approve' ? 'Approve' : 'Reject'}
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
    </Tooltip>
  );

  return (
    <>
      {/* Fixed-width, end-justified action group. Rows carry different button
          sets (wide "Review & Approve" on pending, icon-only elsewhere), so a
          free-width centered group left every row's buttons at a different x
          and the column read as ragged. Reserving the widest case and pushing
          the buttons to its right edge keeps the trailing kebab — and every
          icon before it — in a straight line down the table. */}
      <div
        className="d-inline-flex align-items-center justify-content-end gap-1"
        /* paddingRight keeps the trailing kebab off the column's edge. Flush
           against it the icons read as clipped — and where a vertical scrollbar
           sits over that edge, they genuinely were. */
        style={{ minWidth: (mode === 'hr' || mode === 'team') ? 216 : undefined, paddingRight: 6 }}
      >
        {(canManagerAct || canHrReview) && onReview ? (
          (() => {
            // The viewer's OWN claim isn't self-approvable — show the button
            // greyed (still clickable so onReview can toast the reason).
            const isOwn = mode === 'hr' && currentEmployeeId != null && Number(c.employee_id) === Number(currentEmployeeId);

            /* Stage, not permission (CBC #158). Green while the reporting
               manager still has to act; faint blue once they have and it is
               HR's turn. A viewer holding BOTH roles otherwise saw an unchanged
               green button after approving at manager level, so nothing said
               the first step was done. */
            const atHrStage = c.manager_status === 'approved' && c.hr_status === 'pending';
            const reviewBtnStyle = atHrStage
              ? { background: '#b6d9f7', color: '#08406f', border: '1px solid #8dc3ef' }
              : { background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', border: 'none' };
            return (
              <button
                type="button"
                onClick={() => onReview(c)}
                title={isOwn ? 'Your own request — your reporting manager approves it' : undefined}
                className="btn btn-sm d-inline-flex align-items-center justify-content-center gap-1 rounded-pill fw-semibold"
                style={{ height: 28, padding: '0 12px', fontSize: 11.5, ...reviewBtnStyle, whiteSpace: 'nowrap', ...(isOwn ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
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
        {canSettle && (
          <Tooltip label={settleDone ? 'View payment history' : (c.settlement_status ?? 'unpaid') === 'partial' ? 'Record another payment' : 'Record payment'}>
            <button
              type="button"
              aria-label={settleDone ? 'View payment history' : 'Record payment'}
              onClick={() => onRecordPayment?.(c)}
              className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
              style={{
                width: 28, height: 28, padding: 0, color: '#fff', border: 'none',
                background: settleDone ? 'linear-gradient(135deg,#0ab39c,#02c8a7)' : 'linear-gradient(135deg,#f7b84b,#f59e0b)',
              }}
            >
              <i className={settleDone ? 'ri-history-line' : 'ri-bank-card-line'} />
            </button>
          </Tooltip>
        )}
        {showEmail && (
          <Tooltip label={!canEmail ? (settleDone ? 'Sync all payments to Zoho first' : 'Available once fully paid & synced to Zoho') : emailedAlready ? 'Re-send reimbursement email' : 'Email reimbursement to employee'}>
            <button
              type="button"
              aria-label="Email reimbursement"
              onClick={() => {
                if (canEmail) { onEmailReimbursement?.(c); return; }
                if (settleDone && !c.zoho_all_synced) {
                  toast.warning('Sync to Zoho first', 'This claim’s payment isn’t in Zoho Books yet — sync all payments to Zoho before emailing the reimbursement.');
                } else {
                  toast.info('Not ready yet', 'The claim must be fully paid and every payment synced to Zoho before it can be emailed.');
                }
              }}
              className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
              style={{
                width: 28, height: 28, padding: 0, color: '#fff', border: 'none',
                cursor: canEmail ? 'pointer' : 'not-allowed',
                // Disabled state is conveyed by the muted grey gradient, NOT
                // element opacity — CSS opacity also dims the ::after tooltip pill,
                // which made the tooltip render faint on the disabled button.
                background: !canEmail ? 'linear-gradient(135deg,#cbd5e1,#94a3b8)'
                  : emailedAlready ? 'linear-gradient(135deg,#94a3b8,#64748b)'
                  : 'linear-gradient(135deg,#6366f1,#4f46e5)',
              }}
            >
              <i className={emailedAlready && canEmail ? 'ri-mail-check-line' : 'ri-mail-send-line'} />
            </button>
          </Tooltip>
        )}
        {/* View payments (read-only) — for the claim owner on their profile. */}
        {!!onViewPayments && c.status === 'approved' && (
          <Tooltip label="View payments">
            <button
              type="button"
              aria-label="View payments"
              onClick={() => onViewPayments?.(c)}
              className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
              style={{ width: 28, height: 28, padding: 0, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#0ab39c,#02c8a7)' }}
            >
              <i className="ri-history-line" />
            </button>
          </Tooltip>
        )}
        <AuditLogTrigger open={menuOpen} setOpen={setMenuOpen} claim={c} viewerMode={mode} />
      </div>

      <ExpenseConfirmModal
        target={confirmAction && onAct ? { claim: c, action: confirmAction } : null}
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
          await onAct(c.id, action, comment.trim() || undefined);
          setConfirmAction(null);
        }}
      />
    </>
  );
}

function ExpenseClaimRowView({
  claim, accent, fallbackName, fallbackInitials,
  mode, currentEmployeeId, canHrApprove, onAct,
}: {
  claim: ExpenseClaimRow;
  accent: string;
  fallbackName?: string;
  fallbackInitials?: string;
  mode: 'mine' | 'team' | 'hr';
  currentEmployeeId: number | null;
  canHrApprove: boolean;
  onAct?: Props['onAct'];
}) {
  const c = claim;
  const tone = STATUS_TONE[c.status];
  const empName = c.employee_name || fallbackName || ('#' + c.employee_id);
  const empInitials = initialsFromName(c.employee_name, fallbackInitials);

  const [menuOpen, setMenuOpen] = useState(false);
  // Confirmation modal for both approve & reject. The action shape carries
  // both the verdict and the stage so we can render a contextual title +
  // submit colour, and so the same dispatcher hits the right backend route.
  type Confirm = { stage: 'manager' | 'hr'; verdict: 'approve' | 'reject' };
  const [confirmAction, setConfirmAction] = useState<Confirm | null>(null);
  const [comment, setComment] = useState('');

  const canManagerAct =
    mode === 'team'
    && c.manager_status === 'pending'
    && currentEmployeeId !== null
    && c.manager_id === currentEmployeeId
    && !!onAct;

  const canHrAct =
    mode === 'hr'
    && canHrApprove
    && c.manager_status === 'approved'
    && c.hr_status === 'pending'
    && !!onAct;

  return (
    <tr>
      <td>
        <span
          className="font-monospace fw-semibold exp-id-badge"
          style={{
            fontSize: 11, padding: '2px 9px', borderRadius: 999,
            background: '#ece6ff', color: '#5a3fd1', letterSpacing: '0.02em',
          }}
        >
          {c.claim_no || `#${c.id}`}
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
            {empInitials}
          </div>
          <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
            <span className="fw-semibold">{empName}</span>
            {c.employee_code && (
              <small className="text-muted" style={{ fontSize: 10 }}>{c.employee_code}</small>
            )}
          </div>
        </div>
      </td>
      <td>
        <span
          className="d-inline-flex align-items-center gap-1 fw-semibold exp-cat-badge"
          style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 999,
            background: '#eef2f6', color: '#5b6478',
          }}
        >
          <i className="ri-price-tag-3-line" />
          {c.category_name || '—'}
        </span>
      </td>
      <td>{c.title}</td>
      <td className="text-muted">{fmtDate(c.expense_date)}</td>
      <td className="fw-bold exp-col-amount">₹{Number(c.amount || 0).toLocaleString('en-IN')}</td>
      <td>
        {/* Only the first receipt shows in the cell; extras collapse into a
            "+N more" popover so multiple uploads can't expand the row height. */}
        <ProofOfPaymentCell
          attachments={c.attachments}
          withAuthToken={withAuthToken}
          accent={{ bg: 'rgba(37,99,235,0.10)', fg: '#2563eb', border: 'rgba(37,99,235,0.25)' }}
        />
      </td>
      <td className="exp-col-status">
        <span
          className={`d-inline-flex align-items-center gap-1 fw-semibold exp-status-badge exp-status-badge--${c.status}`}
          style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 999,
            background: tone.bg, color: tone.fg,
          }}
        >
          {tone.label}
        </span>
      </td>
      <td className="text-center">
        <div className="d-inline-flex align-items-center gap-1">
          {canManagerAct && (
            <>
              <Tooltip label="Approve">
                <button
                  type="button"
                  aria-label="Approve"
                  onClick={() => { setConfirmAction({ stage: 'manager', verdict: 'approve' }); setComment(''); }}
                  className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                  style={{
                    width: 28, height: 28, padding: 0,
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    color: '#fff', border: 'none',
                  }}
                >
                  <i className="ri-check-line" />
                </button>
              </Tooltip>
              <Tooltip label="Reject">
                <button
                  type="button"
                  aria-label="Reject"
                  onClick={() => { setConfirmAction({ stage: 'manager', verdict: 'reject' }); setComment(''); }}
                  className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                  style={{
                    width: 28, height: 28, padding: 0,
                    background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                    color: '#fff', border: 'none',
                  }}
                >
                  <i className="ri-close-line" />
                </button>
              </Tooltip>
            </>
          )}
          {canHrAct && (
            <>
              <Tooltip label="Approve">
                <button
                  type="button"
                  aria-label="Approve"
                  onClick={() => { setConfirmAction({ stage: 'hr', verdict: 'approve' }); setComment(''); }}
                  className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                  style={{
                    width: 28, height: 28, padding: 0,
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    color: '#fff', border: 'none',
                  }}
                >
                  <i className="ri-check-line" />
                </button>
              </Tooltip>
              <Tooltip label="Reject">
                <button
                  type="button"
                  aria-label="Reject"
                  onClick={() => { setConfirmAction({ stage: 'hr', verdict: 'reject' }); setComment(''); }}
                  className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                  style={{
                    width: 28, height: 28, padding: 0,
                    background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                    color: '#fff', border: 'none',
                  }}
                >
                  <i className="ri-close-line" />
                </button>
              </Tooltip>
            </>
          )}
          <AuditLogTrigger
            open={menuOpen}
            setOpen={setMenuOpen}
            claim={c}
            viewerMode={mode}
          />
        </div>

        <ExpenseConfirmModal
          target={confirmAction && onAct ? { claim: c, action: confirmAction } : null}
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
            await onAct(c.id, action, comment.trim() || undefined);
            setConfirmAction(null);
          }}
        />
      </td>
    </tr>
  );
}

/**
 * 3-dot button + portal-based audit log popover. Renders outside the table
 * so it doesn't fight the `overflow:hidden` table-responsive container, and
 * positions itself to the left of the button so the body of the popover
 * doesn't fall off the right edge of the page.
 */
function AuditLogTrigger({
  open, setOpen, claim, viewerMode,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  claim: ExpenseClaimRow;
  /** HR/Finance viewer ('hr') doesn't see the reporting manager's remark (QA #103). */
  viewerMode?: 'mine' | 'team' | 'hr';
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the popover when it opens. It is pinned to fixed coords taken
  // from the trigger, so a scroll strands it away from its row — close it
  // instead (same rule as the customers segment popover), except when the
  // scroll happens INSIDE the popover's own body. A resize just re-anchors.
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const recompute = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const POP_WIDTH = 340;
      const POP_HEIGHT = 280; // estimate — popover never grows much beyond this
      // Prefer below-and-left so the popover body doesn't fall off the right
      // edge of the page; flip above when there isn't enough room below.
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

  // Lock the page behind the popover. It is pinned to fixed coords, so letting
  // the page scroll underneath drags it away from its row; the popover's own
  // body still scrolls (CBC #73).
  /* Shared hook instead of a local html+body lock: that pair misses the
     element this app actually scrolls (.main-content), so the page carried on
     moving behind the popup. */
  useScrollLock(open);

  // Click-outside to dismiss.
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
      <Tooltip label="View audit log">
        <button
          ref={btnRef}
          type="button"
          aria-label="View audit log"
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
      </Tooltip>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="ep-audit-popover"
          // Pulls theme variables (data-bs-theme cascades from <html>) so
          // the popover follows light/dark mode. Used to hardcode white +
          // slate text which made the audit log unreadable on a dark page.
          // The `.ep-audit-popover` class also carries a dark-mode override
          // (recruitment.css) that forces #222831 for parity with the rest
          // of the popups when --vz-card-bg doesn't resolve to a dark hex.
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
            // The page behind is locked while this is open, so a long log
            // scrolls HERE rather than taking the page with it.
            maxHeight: 'min(70vh, 420px)',
            overflowY: 'auto',
          }}
        >
          <AuditLogPopover claim={claim} viewerMode={viewerMode} />
        </div>,
        document.body,
      )}
    </>
  );
}

/** Three-row timeline: Created → Manager → HR/Finance. */
function AuditLogPopover({ claim, viewerMode }: { claim: ExpenseClaimRow; viewerMode?: 'mine' | 'team' | 'hr' }) {
  const c = claim;
  const [showFull, setShowFull] = useState(false);
  const stages: {
    label: string;
    icon: string;
    state: 'pending' | 'approved' | 'rejected';
    actor: string | null;
    at: string | null;
    comment: string | null;
    isCreated?: boolean;
    /** Sub-line shown when the stage is still pending (e.g. "Awaiting Jane Doe"). */
    pendingHint?: string;
  }[] = [
    {
      label: 'Request Created',
      icon: 'ri-file-add-line',
      state: 'approved', // creation is always "done"
      actor: c.creator_name,
      at: c.created_at,
      comment: null,
      isCreated: true,
    },
    {
      // Show the assigned reporting manager's name regardless of state — when
      // pending it tells the employee who they're waiting on; when actioned
      // it's the same person (manager_name = the manager who approved).
      // When the employee has no reporting manager, the backend auto-clears
      // this stage at create time and routes the claim straight to HR — the
      // sub-line uses the controller's "Auto-approved · …" comment which
      // makes the bypass explicit in the audit trail.
      label: 'Reporting Manager',
      icon: 'ri-user-star-line',
      state: c.manager_status,
      actor: c.manager_name
        || (c.manager_id ? `Manager #${c.manager_id}` : 'No manager assigned · skipped'),
      pendingHint: c.manager_name ? `Awaiting ${c.manager_name}` : 'Awaiting manager review',
      at: c.manager_acted_at,
      // A manager's APPROVAL remark is private — an HR/Finance viewer doesn't
      // see it (QA #103). But a REJECTION reason is the terminal decision and
      // must be visible to everyone who can see the claim, including the branch
      // user acting as HR/Finance.
      comment: (viewerMode === 'hr' && c.manager_status !== 'rejected') ? null : c.manager_comment,
    },
    // Rejected at the manager stage → the workflow stops there; HR never
    // reviews it, so the HR/Finance step is omitted entirely rather than
    // shown as a dangling "pending" (QA #106 refinement).
    ...(c.manager_status === 'rejected' ? [] : [{
      label: 'HR / Finance Manager',
      icon: 'ri-shield-check-line',
      state: c.hr_status,
      actor: c.hr_user_name,
      pendingHint: 'Awaiting HR / Finance review',
      at: c.hr_acted_at,
      comment: c.hr_comment,
    }]),
  ];

  return (
    <div style={{ color: 'var(--vz-body-color, #1f2937)' }}>
      <div className="fw-bold mb-3" style={{ fontSize: 13, color: 'var(--vz-body-color, #1f2937)' }}>
        Approval Audit Log
        <small className="d-block fw-normal" style={{ fontSize: 11, color: 'var(--vz-secondary-color, #6b7280)' }}>
          {c.claim_no} · ₹{Number(c.amount || 0).toLocaleString('en-IN')}
        </small>
      </div>
      <div style={{ position: 'relative' }}>
        {/* Vertical guide */}
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
                  // so one entry can't flood the log; "View all" opens the full
                  // text in the Decline-reason popup.
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
                      {isLong && (
                        <button
                          type="button"
                          onClick={() => setShowFull(true)}
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
      <DeclineReasonModal claim={showFull ? claim : null} onClose={() => setShowFull(false)} />
    </div>
  );
}

/** "Decline reason" popup — the full rejection remark for a rejected claim.
 *  The reason lives on whichever stage rejected it (manager or HR/Finance). */
function DeclineReasonModal({ claim, onClose }: { claim: ExpenseClaimRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!claim) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [claim, onClose]);
  if (!claim) return null;
  const reason = (
    (claim.manager_status === 'rejected' ? claim.manager_comment : claim.hr_comment)
    || claim.hr_comment || claim.manager_comment || ''
  ).trim();
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
            {claim.claim_no || `#${claim.id}`}
            {claim.employee_name ? ` · ${claim.employee_name}` : ''}
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

/**
 * Approve / Reject confirmation dialog. Mirrors the look of
 * `CandidateConfirmModal` (Reactstrap Modal + cand-confirm-* class set so
 * we get the polished header tile, summary card, and footer styling for
 * free), but specialised for the expense-claim verdict pair.
 */
function ExpenseConfirmModal({
  target, comment, setComment, onClose, onConfirm,
}: {
  target: { claim: ExpenseClaimRow; action: { stage: 'manager' | 'hr'; verdict: 'approve' | 'reject' } } | null;
  comment: string;
  setComment: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  // Loading state for the approve/reject round-trip. While the backend call
  // is in flight we disable both footer buttons, the close (×) button, and
  // the click-outside dismiss so the action can't be double-submitted, and
  // swap the submit label for a spinner.
  const [submitting, setSubmitting] = useState(false);
  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };
  if (!target) return null;
  const { claim, action } = target;
  const isApprove = action.verdict === 'approve';
  // A rejection reason is mandatory (parity with the Notifications reject flow) —
  // it gates the confirm button so a claim can't be rejected without a reason.
  const rejectReasonMissing = !isApprove && !comment.trim();
  const stageLabel = action.stage === 'manager' ? 'Manager' : 'HR / Finance';
  const tone = STATUS_TONE[claim.status];

  /* Bypass Reactstrap and render the dialog through a manual portal.
     Reactstrap's Modal applies its z-index after mount which fights with
     EmployeeProfile's fullscreen overlay (z-index 1080) and the page's
     other modal classes (2100/5000). A direct portal at z-index 6500
     guarantees the dialog floats above every page chrome layer. */
  return createPortal(
    <div
      className={`expense-confirm-overlay cand-confirm-modal cand-confirm-modal--${isApprove ? 'select' : 'reject'}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 6500,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
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
              {isApprove ? `Approve Claim — ${stageLabel}` : `Reject Claim — ${stageLabel}`}
            </h5>
            <div className="cand-confirm-head-sub">
              {isApprove
                ? (action.stage === 'manager'
                    ? 'Forwards to HR / Finance for final approval'
                    : 'Final approval — claim will be marked Approved')
                : 'Closes the claim — employee will see the rejection in their audit log'}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-confirm-close" disabled={submitting}>
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-confirm-body">
          {/* Claim summary card */}
          <div className="cand-confirm-summary">
            <div
              className="cand-confirm-avatar"
              style={{ background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' }}
            >
              <i className="ri-file-text-line" style={{ fontSize: 18 }} />
            </div>
            <div className="cand-confirm-summary-text">
              <div className="cand-confirm-name">
                {claim.title || claim.claim_no || `Claim #${claim.id}`}
              </div>
              <div className="cand-confirm-meta">
                <span className="rec-id-pill">{claim.claim_no || `#${claim.id}`}</span>
                <span className="dot">·</span>
                <span>{claim.employee_name || `Employee #${claim.employee_id}`}</span>
                <span className="dot">·</span>
                <span className="fw-semibold" style={{ color: '#1f2937' }}>
                  ₹{Number(claim.amount || 0).toLocaleString('en-IN')}
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
              {isApprove
                ? <>Approval Note <span className="opt">(OPTIONAL)</span></>
                : <>Reason for Rejection <span style={{ color: '#dc2626', fontWeight: 700 }}>*</span></>}
            </label>
            <textarea
              className="cand-confirm-textarea"
              rows={3}
              placeholder={isApprove
                ? 'Add context for the audit trail (e.g. "Approved within policy limit")'
                : 'Explain why this claim is being rejected'}
              value={comment}
              onChange={e => setComment(e.target.value)}
              autoFocus
            />
            {rejectReasonMissing && (
              <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="ri-error-warning-line" /> A reason is required to reject this claim.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="cand-confirm-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="cand-confirm-submit" onClick={handleConfirm} disabled={submitting || rejectReasonMissing}>
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
