import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShimmerTableRows } from './ui/Shimmer';
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
};

const STATUS_TONE: Record<ExpenseClaimRow['status'], { bg: string; fg: string; dot: string; label: string }> = {
  pending:  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b', label: 'Pending'  },
  approved: { bg: '#d6f4e3', fg: '#108548', dot: '#10b981', label: 'Approved' },
  rejected: { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444', label: 'Rejected' },
};

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

export default function ExpenseClaimsTable({
  rows, loading,
  fallbackName, fallbackInitials, accent = '#7c5cfc',
  mode = 'mine', currentEmployeeId = null, canHrApprove = false,
  onAct,
}: Props) {
  return (
    <>
      <style>{BADGE_DARK_CSS}</style>
      <div className="table-responsive border rounded ep-att-scroll-wrap">
        <table className="table align-middle table-nowrap ep-att-table exp-claims-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Exp ID</th>
              <th>Employee</th>
              <th>Category</th>
              <th>Description</th>
              <th>Expense Date</th>
              <th className="exp-col-amount">Amount</th>
              <th>Proof of Payment</th>
              <th className="exp-col-status">Status</th>
              <th className="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ShimmerTableRows rows={5} cols={9} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-5 text-muted">
                  <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No claims to show.
                </td>
              </tr>
            ) : rows.map(c => (
              <ExpenseClaimRowView
                key={c.id}
                claim={c}
                accent={accent}
                fallbackName={fallbackName}
                fallbackInitials={fallbackInitials}
                mode={mode}
                currentEmployeeId={currentEmployeeId}
                canHrApprove={canHrApprove}
                onAct={onAct}
              />
            ))}
          </tbody>
        </table>
      </div>
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
        {(c.attachments?.length ?? 0) > 0 ? (
          /* Previously the cell rendered just the FIRST attachment as a
             link and showed "+N" for the rest — so any claim with
             multiple receipts hid every attachment past the first one,
             and the user had no way to open them from the list view.
             Render every attachment as its own clickable chip; the
             flex-wrap keeps the column readable when there are several. */
          <div className="d-flex flex-wrap align-items-center" style={{ gap: 4, maxWidth: 220 }}>
            {(c.attachments ?? []).map((att, idx) => (
              att?.url ? (
                <a
                  key={`${att.url}-${idx}`}
                  href={withAuthToken(att.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="d-inline-flex align-items-center gap-1 text-decoration-none"
                  title={att.name || `Attachment ${idx + 1}`}
                  style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.10)', color: '#dc2626',
                    fontWeight: 600, border: '1px solid rgba(239,68,68,0.25)',
                    maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  <i className="ri-file-text-line" />
                  {(att.name || `Receipt ${idx + 1}`).slice(0, 14)}
                </a>
              ) : null
            ))}
          </div>
        ) : (
          <span className="text-muted" style={{ fontSize: 11 }}>—</span>
        )}
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
              <button
                type="button"
                data-tooltip="Approve"
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
              <button
                type="button"
                data-tooltip="Reject"
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
            </>
          )}
          {canHrAct && (
            <>
              <button
                type="button"
                data-tooltip="Approve"
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
              <button
                type="button"
                data-tooltip="Reject"
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
            </>
          )}
          <AuditLogTrigger
            open={menuOpen}
            setOpen={setMenuOpen}
            claim={c}
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
  open, setOpen, claim,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  claim: ExpenseClaimRow;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Recompute the popover position whenever it opens (and on scroll/resize
  // while open) so it stays anchored to the trigger button.
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
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open]);

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
      <button
        ref={btnRef}
        type="button"
        data-tooltip="View audit log"
        data-tooltip-pos="left"
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
          }}
        >
          <AuditLogPopover claim={claim} />
        </div>,
        document.body,
      )}
    </>
  );
}

/** Three-row timeline: Created → Manager → HR/Finance. */
function AuditLogPopover({ claim }: { claim: ExpenseClaimRow }) {
  const c = claim;
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
        || (c.manager_id ? `Manager #${c.manager_id}` : (c.manager_comment || 'No manager assigned · skipped')),
      pendingHint: c.manager_name ? `Awaiting ${c.manager_name}` : 'Awaiting manager review',
      at: c.manager_acted_at,
      comment: c.manager_comment,
    },
    {
      label: 'HR / Finance Manager',
      icon: 'ri-shield-check-line',
      state: c.hr_status,
      actor: c.hr_user_name,
      pendingHint: 'Awaiting HR / Finance review',
      at: c.hr_acted_at,
      comment: c.hr_comment,
    },
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
                {s.comment && (
                  <div
                    className="mt-1"
                    style={{
                      fontSize: 11, padding: '4px 8px', borderRadius: 6,
                      background: 'var(--vz-secondary-bg, #f3f4f6)', color: 'var(--vz-body-color, #1f2937)',
                      border: '1px solid var(--vz-border-color)',
                    }}
                  >
                    {s.comment}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
              {isApprove ? 'Approval Note' : 'Reason for Rejection'} <span className="opt">(OPTIONAL)</span>
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
