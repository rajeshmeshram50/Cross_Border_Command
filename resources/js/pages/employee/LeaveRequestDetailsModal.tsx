import { useEffect, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import { leaveRequestsApi, ApiLeaveRequest, ApiLeaveApprover, ApiSandwichMeta } from '../hrms/leavePlansApi';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

/* Status pill / banner colours, theme-aware so the modal reads correctly in
 * both light and dark mode (the dark variants use translucent fills + bright
 * text instead of the light-mode pastel-on-dark-text pairs). */
function statusColors(status: string | null | undefined, dark: boolean): { bg: string; fg: string } {
  if (status === 'Approved') return dark ? { bg: 'rgba(16,185,129,.16)', fg: '#34d399' } : { bg: '#d1fae5', fg: '#065f46' };
  if (status === 'Rejected') return dark ? { bg: 'rgba(239,68,68,.16)', fg: '#f87171' } : { bg: '#fee2e2', fg: '#b91c1c' };
  return dark ? { bg: 'rgba(148,163,184,.16)', fg: '#cbd5e1' } : { bg: '#eef2f6', fg: '#374151' };
}

interface Props {
  isOpen: boolean;
  requestId: number | null;
  onClose: () => void;
}

function parts(date: string | null | undefined): { mon: string; day: string; dow: string } {
  if (!date) return { mon: '', day: '', dow: '' };
  const d = new Date(date);
  if (isNaN(d.getTime())) return { mon: '', day: '', dow: '' };
  return {
    mon: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()).padStart(2, '0'),
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
  };
}

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysAgoLabel(endIso: string | null | undefined): string {
  if (!endIso) return '';
  const end = new Date(endIso);
  if (isNaN(end.getTime())) return '';
  const now = Date.now();
  const diffMs = now - end.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return 'Leave is upcoming';
  if (days === 1) return 'Leave ended 1 day ago';
  return `Leave ended ${days} days ago`;
}

export default function LeaveRequestDetailsModal({ isOpen, requestId, onClose }: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  // Theme-aware structural colours (borders / dividers / date card) — the
  // modal-content surface itself already flips via Velzon's dark theme, so
  // only these hardcoded accents needed switching.
  const borderCol = dark ? 'rgba(255,255,255,.09)' : '#e5e7eb';
  const dividerCol = dark ? 'rgba(255,255,255,.07)' : '#f1f3f5';
  const [detail, setDetail] = useState<ApiLeaveRequest | null>(null);
  const [chain, setChain] = useState<ApiLeaveApprover[]>([]);
  const [loading, setLoading] = useState(true);
  // Sandwich context — how many of `days` the branch policy contributed.
  const [sandwich, setSandwich] = useState<ApiSandwichMeta | null>(null);
  const [waiverReason, setWaiverReason] = useState('');
  const [waiving, setWaiving] = useState(false);

  /* The waiver reverses a company policy, so only the HR / admin tiers get the
     control — the same list the server enforces in sandwichWaiver(). An
     employee opening their own leave still SEES that the policy added days;
     they just cannot undo it. */
  const { user } = useAuth();
  const canWaive = ['super_admin', 'client_admin', 'branch_user'].includes(String((user as any)?.user_type));

  useEffect(() => {
    if (!isOpen || !requestId) return;
    setLoading(true);
    setDetail(null);
    setChain([]);
    setSandwich(null);
    setWaiverReason('');
    Promise.all([
      leaveRequestsApi.showWithMeta(requestId),
      leaveRequestsApi.approvers(requestId),
    ])
      .then(([d, c]) => {
        setDetail(d.data);
        setSandwich(d.meta);
        setWaiverReason(d.data.sandwich_waiver_reason || '');
        setChain(c);
      })
      .catch(err => console.warn('[LeaveRequestDetailsModal] load failed', err))
      .finally(() => setLoading(false));
  }, [isOpen, requestId]);

  /* Server re-sizes `days` and hands back the updated row — it is used as-is
     rather than patched locally, so this modal can never disagree with the
     approvals screen about what the leave now costs. */
  const toggleWaiver = async (next: boolean) => {
    if (!detail) return;
    setWaiving(true);
    try {
      const res = await leaveRequestsApi.sandwichWaiver(detail.id, next, waiverReason.trim() || undefined);
      setDetail(res.data);
      const fresh = await leaveRequestsApi.showWithMeta(detail.id);
      setSandwich(fresh.meta);
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || 'Could not update the waiver');
    } finally {
      setWaiving(false);
    }
  };

  const requester = detail?.employee
    ? (detail.employee.display_name?.trim() || `${detail.employee.first_name} ${detail.employee.last_name ?? ''}`.trim())
    : '—';
  const requesterInitials = requester.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  const from = parts(detail?.from_date);
  const to = parts(detail?.to_date);

  const notifyIds: number[] = Array.isArray((detail?.notify as any)?.employee_ids)
    ? ((detail?.notify as any).employee_ids as number[])
    : [];

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="lg"
      backdrop="static"
      zIndex={2100}
      modalClassName="ep-leave-modal"
      backdropClassName="ep-leave-backdrop"
      contentClassName="lrd-modal"
    >
      {/* Standard app modal chrome — same gradient header (indigo → violet →
          purple), rounded corners and white close button used by the master
          Audit / Employee-Tree modals, so this popup matches the rest of the
          app instead of the plain bordered header it had before (QA #89). */}
      <style>{`
        .lrd-modal {
          border-radius: 16px !important;
          overflow: hidden;
          border: 0;
          box-shadow: 0 25px 60px rgba(15,23,42,0.25);
        }
        .lrd-modal-header {
          padding: 18px 22px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%);
          border-bottom: 0;
        }
        .lrd-modal-title { color: #fff !important; letter-spacing: 0.01em; font-size: 16px; }
        .lrd-modal-sub   { color: rgba(255,255,255,0.85) !important; font-size: 12px; }
        .lrd-modal-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
          background: rgba(255,255,255,0.20); color: #fff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
        }
        .lrd-modal-icon i { font-size: 18px; line-height: 1; }
        .lrd-modal-close {
          width: 30px; height: 30px; border-radius: 8px; border: 0;
          background: rgba(255,255,255,0.18); color: #fff; cursor: pointer;
          flex-shrink: 0; display: inline-flex; align-items: center;
          justify-content: center; transition: background 0.15s ease;
        }
        .lrd-modal-close:hover { background: rgba(255,255,255,0.30); }
        .lrd-modal-close i { font-size: 16px; line-height: 1; }
        .lrd-modal-body { background: var(--vz-card-bg); }
      `}</style>
      <ModalBody className="p-0 lrd-modal-body">
        <div className="lrd-modal-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span className="lrd-modal-icon"><i className="ri-calendar-check-line" /></span>
              <div className="min-w-0">
                <h5 className="mb-0 fw-bold lrd-modal-title">Leave Request Details</h5>
                <small className="lrd-modal-sub">
                  {detail?.leave_type?.name
                    ? `${Number(detail.days)} ${Number(detail.days) === 1 ? 'day' : 'days'} of ${detail.leave_type.name}`
                    : 'Review the details of this leave request'}
                </small>
              </div>
            </div>
            <button type="button" className="lrd-modal-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        {loading || !detail ? (
          <div className="text-center text-muted py-5">
            <i className="ri-loader-4-line ri-spin d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
            Loading...
          </div>
        ) : (
          <div style={{ padding: '20px 24px' }}>
            <div className="d-flex align-items-center gap-2 mb-4">
              <span
                className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                style={{ width: 44, height: 44, fontSize: 14, background: 'linear-gradient(135deg,#5a3fd1,#7c5cfc)' }}
              >
                {requesterInitials}
              </span>
              <div>
                <div className="fw-bold" style={{ fontSize: 15 }}>{requester}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Requested by {requester} on {fmtDateTime(detail.created_at)}
                </div>
              </div>
            </div>

            <div className="d-flex align-items-center gap-3 mb-4 pb-3" style={{ borderBottom: `1px solid ${dividerCol}` }}>
              <DateCard mon={from.mon} day={from.day} dow={from.dow} dark={dark} />
              <span className="fw-bold" style={{ fontSize: 22, color: dark ? '#6b7280' : '#9ca3af' }}>–</span>
              <DateCard mon={to.mon} day={to.day} dow={to.dow} dark={dark} />
              <div className="ms-2">
                <div className="fw-semibold" style={{ fontSize: 15 }}>
                  {Number(detail.days)} {Number(detail.days) === 1 ? 'day' : 'days'} of {detail.leave_type?.name ?? '—'}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {daysAgoLabel(detail.to_date)}
                </div>
              </div>
            </div>

            {detail.status !== 'Pending' && (
              <div className="mb-3" style={{
                background: statusColors(detail.status, dark).bg,
                color: statusColors(detail.status, dark).fg,
                borderRadius: 10, padding: 12, fontSize: 13,
              }}>
                <strong>{detail.status}</strong>
                {detail.approver?.name && <> by {detail.approver.name}</>}
                {detail.approved_at && <> on {fmtDateTime(detail.approved_at)}</>}
                {detail.approver_comment && (
                  <div className="mt-1 fst-italic" style={{ fontSize: 12 }}>"{detail.approver_comment}"</div>
                )}
              </div>
            )}

            {/* Sandwich Leave Policy.
                Repeated here, not only on the approvals screen, because this is
                the modal people actually reach — from the employee profile's
                Leave tab and from the leave lists. Hunting for a second screen
                to understand why a 2-day leave cost 4 is exactly the friction
                this panel exists to remove.

                Hidden when the branch does not run the policy or when this
                leave's dates never triggered it. */}
            {sandwich?.sandwich_applicable
              && (sandwich.sandwich_days > 0 || detail.sandwich_waived) && (
              <div
                className="mb-3"
                style={{
                  border: `1px solid ${detail.sandwich_waived ? 'rgba(10,179,156,.35)' : borderCol}`,
                  background: detail.sandwich_waived
                    ? 'rgba(10,179,156,.07)'
                    : (dark ? 'rgba(255,255,255,.03)' : '#f8f9fb'),
                  borderRadius: 10, padding: '12px 14px',
                }}
              >
                <div className="d-flex align-items-start gap-2">
                  <i
                    className="ri-calendar-check-line"
                    style={{ fontSize: 16, marginTop: 1, color: detail.sandwich_waived ? '#0ab39c' : '#7c5cfc' }}
                  />
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-bold" style={{ fontSize: 13 }}>Sandwich Leave Policy</div>
                    <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {detail.sandwich_waived
                        ? `Waived — ${sandwich.sandwich_days} off-day(s) between the leave dates are not being charged.`
                        : `${sandwich.sandwich_days} week-off / holiday day(s) between the leave dates are included in the ${Number(detail.days)}-day total.`}
                    </div>
                  </div>
                  <span
                    className="fw-semibold flex-shrink-0"
                    style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 20,
                      background: detail.sandwich_waived ? 'rgba(10,179,156,.16)' : 'rgba(124,92,252,.14)',
                      color: detail.sandwich_waived ? '#0ab39c' : '#7c5cfc',
                    }}
                  >
                    {detail.sandwich_waived ? 'Waived' : `+${sandwich.sandwich_days} day(s)`}
                  </span>
                </div>

                {detail.sandwich_waived && (
                  <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                    Waived
                    {detail.sandwich_waiver?.name && <> by <strong>{detail.sandwich_waiver.name}</strong></>}
                    {detail.sandwich_waived_at && <> on {fmtDateTime(detail.sandwich_waived_at)}</>}
                    {detail.sandwich_waiver_reason && <> — "{detail.sandwich_waiver_reason}"</>}
                  </div>
                )}

                {canWaive && (
                  <div className="mt-2">
                    {!detail.sandwich_waived && (
                      <input
                        className="form-control mb-2"
                        style={{ fontSize: 12 }}
                        placeholder="Reason (optional) — e.g. hospital admission, bereavement"
                        value={waiverReason}
                        maxLength={255}
                        disabled={waiving}
                        onChange={e => setWaiverReason(e.target.value)}
                      />
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      style={{ fontSize: 12 }}
                      disabled={waiving}
                      onClick={() => toggleWaiver(!detail.sandwich_waived)}
                    >
                      {waiving
                        ? <>Saving… <i className="ri-loader-4-line ri-spin" /></>
                        : detail.sandwich_waived
                          ? <><i className="ri-arrow-go-back-line me-1" />Re-apply policy</>
                          : <><i className="ri-shield-cross-line me-1" />Waive for this leave</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mb-4 text-muted" style={{ fontSize: 13 }}>
              No teammates are on leave on this day
            </div>

            <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Notified To:</h6>
            {chain.length === 0 && notifyIds.length === 0 ? (
              <div className="text-muted mb-3" style={{ fontSize: 12 }}>Nobody else was notified.</div>
            ) : (
              <div className="mb-3" style={{ fontSize: 13 }}>
                {chain.map((c, i) => (
                  <span key={`a-${i}`}>
                    {i > 0 && ', '}
                    {c.name}
                    <span className="text-muted ms-1" style={{ fontSize: 11 }}>· {c.role}</span>
                  </span>
                ))}
                {notifyIds.length > 0 && (
                  <span className="text-muted ms-2" style={{ fontSize: 12 }}>
                    {chain.length > 0 && '+ '}{notifyIds.length} CC'd
                  </span>
                )}
              </div>
            )}

            {detail.reason && (
              <div className="d-flex gap-2 mb-3 pt-3" style={{ borderTop: '1px solid #f1f3f5' }}>
                <span
                  className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                  style={{ width: 32, height: 32, fontSize: 11, background: 'linear-gradient(135deg,#5a3fd1,#7c5cfc)' }}
                >
                  {requesterInitials}
                </span>
                <div className="min-w-0 flex-grow-1">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <strong style={{ fontSize: 13 }}>{requester}</strong>
                    <span className="text-muted" style={{ fontSize: 11 }}>{fmtDateTime(detail.created_at)}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 13 }}>{detail.reason}</div>
                </div>
              </div>
            )}
            {chain.filter(c => c.comment).map((c, i) => (
              <div key={`cc-${i}`} className="d-flex gap-2 mb-2">
                <span
                  className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                  style={{ width: 32, height: 32, fontSize: 11, background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}
                >
                  {(c.name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-grow-1">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <strong style={{ fontSize: 13 }}>{c.name}</strong>
                    <span className="rec-pill" style={{
                      background: statusColors(c.status, dark).bg,
                      color: statusColors(c.status, dark).fg,
                      fontSize: 10,
                    }}>{c.status}</span>
                    {c.acted_at && (
                      <span className="text-muted" style={{ fontSize: 11 }}>{fmtDateTime(c.acted_at)}</span>
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: 13 }}>{c.comment}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

function DateCard({ mon, day, dow, dark }: { mon: string; day: string; dow: string; dark: boolean }) {
  return (
    <div className="text-center" style={{ background: dark ? 'rgba(124,92,252,.18)' : '#ede9fe', borderRadius: 12, padding: '8px 16px', minWidth: 72 }}>
      <div className="text-muted fw-semibold" style={{ fontSize: 10, letterSpacing: 0.5 }}>{mon}</div>
      <div className="fw-bold" style={{ fontSize: 24, lineHeight: 1, color: dark ? '#ede9fe' : '#1f2937' }}>{day}</div>
      <div className="text-muted fw-semibold" style={{ fontSize: 10, letterSpacing: 0.5 }}>{dow}</div>
    </div>
  );
}
