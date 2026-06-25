import { useEffect, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import { leaveRequestsApi, ApiLeaveRequest, ApiLeaveApprover } from '../hrms/leavePlansApi';

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
  const [detail, setDetail] = useState<ApiLeaveRequest | null>(null);
  const [chain, setChain] = useState<ApiLeaveApprover[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !requestId) return;
    setLoading(true);
    setDetail(null);
    setChain([]);
    Promise.all([
      leaveRequestsApi.show(requestId),
      leaveRequestsApi.approvers(requestId),
    ])
      .then(([d, c]) => { setDetail(d); setChain(c); })
      .catch(err => console.warn('[LeaveRequestDetailsModal] load failed', err))
      .finally(() => setLoading(false));
  }, [isOpen, requestId]);

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
    >
      <ModalBody className="p-0">
        <div className="d-flex align-items-center justify-content-between" style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <h5 className="fw-bold mb-0" style={{ fontSize: 18 }}>Leave Request Details</h5>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
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

            <div className="d-flex align-items-center gap-3 mb-4 pb-3" style={{ borderBottom: '1px solid #f1f3f5' }}>
              <DateCard mon={from.mon} day={from.day} dow={from.dow} />
              <span className="fw-bold" style={{ fontSize: 22, color: '#9ca3af' }}>–</span>
              <DateCard mon={to.mon} day={to.day} dow={to.dow} />
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
                background:
                  detail.status === 'Approved' ? '#d1fae5' :
                  detail.status === 'Rejected' ? '#fee2e2' : '#eef2f6',
                color:
                  detail.status === 'Approved' ? '#065f46' :
                  detail.status === 'Rejected' ? '#b91c1c' : '#374151',
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
                      background: c.status === 'Approved' ? '#d1fae5' : c.status === 'Rejected' ? '#fee2e2' : '#f3f4f6',
                      color: c.status === 'Approved' ? '#065f46' : c.status === 'Rejected' ? '#b91c1c' : '#6b7280',
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

            <div className="d-flex align-items-center gap-2 mt-3" style={{
              border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px',
            }}>
              <input
                type="text"
                className="border-0 flex-grow-1"
                placeholder="Add comment"
                disabled
                style={{ outline: 'none', fontSize: 13, background: 'transparent' }}
              />
              <span className="text-muted" title="Comments coming soon">
                <i className="ri-chat-1-line" />
              </span>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

function DateCard({ mon, day, dow }: { mon: string; day: string; dow: string }) {
  return (
    <div className="text-center" style={{ background: '#ede9fe', borderRadius: 12, padding: '8px 16px', minWidth: 72 }}>
      <div className="text-muted fw-semibold" style={{ fontSize: 10, letterSpacing: 0.5 }}>{mon}</div>
      <div className="fw-bold" style={{ fontSize: 24, lineHeight: 1, color: '#1f2937' }}>{day}</div>
      <div className="text-muted fw-semibold" style={{ fontSize: 10, letterSpacing: 0.5 }}>{dow}</div>
    </div>
  );
}
