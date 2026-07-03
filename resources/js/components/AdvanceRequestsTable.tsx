import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShimmerTableRows } from './ui/Shimmer';
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
  manager_name: string | null;
  advance_type: string;
  advance_type_other: string | null;
  amount: number;
  requested_date: string;
  recovery_start: string;
  recovery_mode: 'emi' | 'lumpsum' | 'bimonthly' | string;
  recovery_months: number | null;
  monthly_emi: number | null;
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
  onAct?: (id: number, action: ActionKind, comment?: string) => Promise<void> | void;
};

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

export default function AdvanceRequestsTable({
  rows, loading,
  fallbackName, fallbackInitials, accent = '#6366f1',
  mode = 'mine', currentEmployeeId = null, canHrApprove = false,
  onAct,
}: Props) {
  return (
    <>
      <style>{BADGE_DARK_CSS}</style>
      <div className="table-responsive border rounded ep-att-scroll-wrap">
        <table className="table align-middle table-nowrap ep-att-table mb-0">
        <thead className="table-light">
          <tr>
            <th>Adv ID</th>
            <th>Employee</th>
            <th>Advance Type</th>
            <th>Reason</th>
            <th>Amount</th>
            <th>Requested</th>
            <th>Recovery Start</th>
            <th>Recovery</th>
            <th>Monthly EMI</th>
            <th>Attachments</th>
            <th>Status</th>
            <th className="text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <ShimmerTableRows rows={5} cols={12} keyPrefix="adv-shim" />
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="text-center py-5 text-muted">
                <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                No advance requests to show.
              </td>
            </tr>
          ) : rows.map(r => (
            <AdvanceRequestRowView
              key={r.id}
              row={r}
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

function AdvanceRequestRowView({
  row, accent, fallbackName, fallbackInitials,
  mode, currentEmployeeId, canHrApprove, onAct,
}: {
  row: AdvanceRequestRow;
  accent: string;
  fallbackName?: string;
  fallbackInitials?: string;
  mode: 'mine' | 'team' | 'hr';
  currentEmployeeId: number | null;
  canHrApprove: boolean;
  onAct?: Props['onAct'];
}) {
  const r = row;
  const tone = STATUS_TONE[r.status];
  const empName = r.employee_name || fallbackName || ('#' + r.employee_id);
  const empInitials = initialsFromName(r.employee_name, fallbackInitials);
  const proof = r.attachments?.[0];
  const typeLabel = r.advance_type === 'Other' && r.advance_type_other
    ? `Other · ${r.advance_type_other}`
    : r.advance_type;
  const recoveryLabel = RECOVERY_LABEL[r.recovery_mode] || r.recovery_mode;
  const emiSummary = r.recovery_mode === 'emi'
    ? `₹${Number(r.monthly_emi || 0).toLocaleString('en-IN')}${r.recovery_months ? ` × ${r.recovery_months} mo` : ''}`
    : '—';

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

  return (
    <tr>
      <td>
        <span
          className="font-monospace fw-semibold adv-id-badge"
          style={{
            fontSize: 11, padding: '2px 9px', borderRadius: 999,
            background: '#dceefe', color: '#0c63b0', letterSpacing: '0.02em',
          }}
        >
          {r.advance_no || `#${r.id}`}
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
            {r.employee_code && (
              <small className="text-muted" style={{ fontSize: 10 }}>{r.employee_code}</small>
            )}
          </div>
        </div>
      </td>
      <td>
        <span
          className="d-inline-flex align-items-center gap-1 fw-semibold adv-type-badge"
          style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 999,
            background: '#ece6ff', color: '#5a3fd1',
          }}
        >
          <i className="ri-bank-card-line" />
          {typeLabel}
        </span>
      </td>
      <td style={{ maxWidth: 240 }}><div style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason}>{r.reason}</div></td>
      <td className="fw-bold">₹{Number(r.amount || 0).toLocaleString('en-IN')}</td>
      <td className="text-muted">{fmtDate(r.requested_date)}</td>
      <td className="text-muted">{fmtDate(r.recovery_start)}</td>
      <td>
        <span
          className="d-inline-flex align-items-center fw-semibold adv-recovery-badge"
          style={{
            fontSize: 11, padding: '2px 9px', borderRadius: 999,
            background: '#d3f0ee', color: '#0a716a',
          }}
        >
          {recoveryLabel}
        </span>
      </td>
      <td className="text-muted">{emiSummary}</td>
      <td>
        {proof?.url ? (
          <a
            href={withAuthToken(proof.url)}
            target="_blank"
            rel="noreferrer"
            className="d-inline-flex align-items-center gap-1 text-decoration-none"
            style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 8,
              background: 'rgba(99,102,241,0.10)', color: '#4338ca',
              fontWeight: 600, border: '1px solid rgba(99,102,241,0.25)',
            }}
          >
            <i className="ri-file-text-line" />
            {(proof.name || 'attachment').slice(0, 14)}
            {(r.attachments?.length ?? 0) > 1 && <small className="ms-1 text-muted">+{(r.attachments?.length ?? 0) - 1}</small>}
          </a>
        ) : (
          <span className="text-muted" style={{ fontSize: 11 }}>—</span>
        )}
      </td>
      <td>
        <span
          className={`d-inline-flex align-items-center gap-1 fw-semibold adv-status-badge adv-status-badge--${r.status}`}
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
                title="Reject"
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
                title="Approve"
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
                title="Reject"
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
          <AuditLogTrigger open={menuOpen} setOpen={setMenuOpen} row={r} />
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
      </td>
    </tr>
  );
}

/* ── Audit log popover ──────────────────────────────────────────────── */
function AuditLogTrigger({
  open, setOpen, row,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  row: AdvanceRequestRow;
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
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
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
          }}
        >
          <AuditLogPopover row={row} />
        </div>,
        document.body,
      )}
    </>
  );
}

function AuditLogPopover({ row }: { row: AdvanceRequestRow }) {
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
        || (r.manager_id ? `Manager #${r.manager_id}` : (r.manager_comment || 'No manager assigned · skipped')),
      pendingHint: r.manager_name ? `Awaiting ${r.manager_name}` : 'Awaiting manager review',
      at: r.manager_acted_at,
      comment: r.manager_comment,
    },
    {
      label: 'HR / Finance Manager',
      icon: 'ri-shield-check-line',
      state: r.hr_status,
      actor: r.hr_user_name,
      pendingHint: 'Awaiting HR / Finance review',
      at: r.hr_acted_at,
      comment: r.hr_comment,
    },
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
