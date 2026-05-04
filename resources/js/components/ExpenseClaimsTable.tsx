import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
              <th>Status</th>
              <th className="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-5 text-muted">
                  <i className="ri-loader-2-line ri-spin d-block mb-2" style={{ fontSize: 24, opacity: 0.5 }} />
                  Loading claims…
                </td>
              </tr>
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
  const proof = c.attachments?.[0];

  const [menuOpen, setMenuOpen] = useState(false);
  const [showRejectBox, setShowRejectBox] = useState<null | 'manager' | 'hr'>(null);
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
          className="font-monospace fw-semibold"
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
          className="d-inline-flex align-items-center gap-1 fw-semibold"
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
      <td className="fw-bold">₹{Number(c.amount || 0).toLocaleString('en-IN')}</td>
      <td>
        {proof?.url ? (
          <a
            href={withAuthToken(proof.url)}
            target="_blank"
            rel="noreferrer"
            className="d-inline-flex align-items-center gap-1 text-decoration-none"
            style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 8,
              background: 'rgba(239,68,68,0.10)', color: '#dc2626',
              fontWeight: 600, border: '1px solid rgba(239,68,68,0.25)',
            }}
          >
            <i className="ri-file-text-line" />
            {(proof.name || 'receipt').slice(0, 14)}
            {(c.attachments?.length ?? 0) > 1 && <small className="ms-1 text-muted">+{(c.attachments?.length ?? 0) - 1}</small>}
          </a>
        ) : (
          <span className="text-muted" style={{ fontSize: 11 }}>—</span>
        )}
      </td>
      <td>
        <span
          className="d-inline-flex align-items-center gap-1 fw-semibold"
          style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 999,
            background: tone.bg, color: tone.fg,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.dot }} />
          {tone.label}
        </span>
      </td>
      <td className="text-center">
        <div className="d-inline-flex align-items-center gap-1">
          {canManagerAct && (
            <>
              <button
                type="button"
                title="Approve"
                onClick={() => onAct && onAct(c.id, 'manager-approve')}
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
                title="Reject"
                onClick={() => { setShowRejectBox('manager'); setComment(''); }}
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
                title="Approve"
                onClick={() => onAct && onAct(c.id, 'hr-approve')}
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
                title="Reject"
                onClick={() => { setShowRejectBox('hr'); setComment(''); }}
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

        {showRejectBox && onAct && (
          <div
            className="position-fixed"
            style={{
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(15,23,42,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 6000,
            }}
            onClick={() => setShowRejectBox(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--vz-card-bg, #ffffff)', borderRadius: 12,
                width: '100%', maxWidth: 420, padding: 20,
                boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
              }}
            >
              <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>
                {showRejectBox === 'manager' ? 'Reject claim (Manager)' : 'Reject claim (HR / Finance)'}
              </h6>
              <p className="text-muted mb-2" style={{ fontSize: 12 }}>
                Optional comment — shown to the employee in their audit log.
              </p>
              <textarea
                className="form-control"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Reason for rejection (optional)…"
                style={{ fontSize: 13 }}
              />
              <div className="d-flex justify-content-end gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={() => setShowRejectBox(null)}
                >Cancel</button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    const action: ActionKind = showRejectBox === 'manager' ? 'manager-reject' : 'hr-reject';
                    await onAct(c.id, action, comment.trim() || undefined);
                    setShowRejectBox(null);
                  }}
                >Reject</button>
              </div>
            </div>
          </div>
        )}
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
          // Theme CSS vars are scoped to the Velzon shell; portaled content
          // lives on document.body where those vars may resolve to nothing.
          // Use concrete fallbacks so the popover stays opaque & readable
          // regardless of the page background it overlays.
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 340,
            background: '#ffffff',
            color: '#1f2937',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            boxShadow: '0 18px 44px rgba(15,23,42,0.28)',
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
      label: 'Reporting Manager',
      icon: 'ri-user-star-line',
      state: c.manager_status,
      actor: c.manager_name || (c.manager_id ? `Manager #${c.manager_id}` : 'No manager assigned'),
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
    <div style={{ color: '#1f2937' }}>
      <div className="fw-bold mb-3" style={{ fontSize: 13, color: '#1f2937' }}>
        Approval Audit Log
        <small className="d-block fw-normal" style={{ fontSize: 11, color: '#6b7280' }}>
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
                    className="d-inline-flex align-items-center fw-semibold"
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
                <div style={{ fontSize: 11, lineHeight: 1.4, color: '#6b7280' }}>
                  {s.at
                    ? <>{fmtDateTime(s.at)}{s.actor && <> · <span className="fw-semibold" style={{ color: '#1f2937' }}>{s.actor}</span></>}</>
                    : isPending && s.pendingHint
                      ? <span style={{ color: '#1f2937' }}>{s.pendingHint}</span>
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
