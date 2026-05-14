import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import {
  employeeBalancesApi,
  leaveRequestsApi,
  ApiEmployeeBalanceResponse,
  ApiEmployeeBalanceType,
  ApiLeaveRequest,
  ApiLeaveApprover,
} from '../hrms/leavePlansApi';
import RequestLeaveModal from './RequestLeaveModal';
import LeaveRequestDetailsModal from './LeaveRequestDetailsModal';

// ─────────────────────────────────────────────────────────────────────────────
// LeaveSummaryPanel — renders the "Me → Leave" overview shown above the
// Apply Leave wizard on EmployeeProfile. Three sections:
//   1. Pending leave requests — list with View Approvers popover
//   2. Leave Balances — per-type donut cards (View details → Balance modal)
//   3. Leave History — past Approved / Rejected / Cancelled requests
// All data is live from /api/leave-requests + /employees/:id/leave-balances.
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  employeeId: string;
}

const TYPE_PALETTE: Record<string, { ring: string; track: string; bg: string; fg: string }> = {
  sick: { ring: '#ef4444', track: '#fee2e2', bg: '#fee2e2', fg: '#b91c1c' },
  paid: { ring: '#7c5cfc', track: '#ece6ff', bg: '#ece6ff', fg: '#5a3fd1' },
  casual: { ring: '#0ea5e9', track: '#dceefe', bg: '#dceefe', fg: '#0c63b0' },
  maternity: { ring: '#e83e8c', track: '#fdd9ea', bg: '#fdd9ea', fg: '#a02960' },
  paternity: { ring: '#0c63b0', track: '#dceefe', bg: '#dceefe', fg: '#0c63b0' },
  compoff: { ring: '#16a34a', track: '#dcfce7', bg: '#dcfce7', fg: '#15803d' },
  unpaid: { ring: '#6b7280', track: '#eef2f6', bg: '#eef2f6', fg: '#374151' },
  default: { ring: '#7c5cfc', track: '#ece6ff', bg: '#ece6ff', fg: '#5a3fd1' },
};
const toneFor = (t: ApiEmployeeBalanceType) => {
  const k = (t.name || '').toLowerCase();
  if (k.includes('sick')) return TYPE_PALETTE.sick;
  if (k.includes('paid')) return TYPE_PALETTE.paid;
  if (k.includes('casual')) return TYPE_PALETTE.casual;
  if (k.includes('maternity')) return TYPE_PALETTE.maternity;
  if (k.includes('paternity')) return TYPE_PALETTE.paternity;
  if (k.includes('comp')) return TYPE_PALETTE.compoff;
  if (k.includes('unpaid') || k.includes('loss')) return TYPE_PALETTE.unpaid;
  return TYPE_PALETTE.default;
};

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shortDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function LeaveSummaryPanel({ employeeId }: Props) {
  const [requests, setRequests] = useState<ApiLeaveRequest[]>([]);
  const [balances, setBalances] = useState<ApiEmployeeBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [approversFor, setApproversFor] = useState<number | null>(null);
  const [approversList, setApproversList] = useState<ApiLeaveApprover[]>([]);
  const [detailsType, setDetailsType] = useState<ApiEmployeeBalanceType | null>(null);
  // New Request Leave / Details modals replacing the old 7-stage wizard.
  const [showRequest, setShowRequest] = useState(false);
  const [detailsRequestId, setDetailsRequestId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const empId = Number(employeeId);
      const [reqs, bal] = await Promise.all([
        leaveRequestsApi.list(Number.isFinite(empId) && empId > 0 ? { employee_id: empId } : {}),
        Number.isFinite(empId) && empId > 0
          ? employeeBalancesApi.fetch(empId)
          : Promise.resolve(null),
      ]);
      setRequests(reqs);
      setBalances(bal);
    } catch (err) {
      console.warn('[LeaveSummaryPanel] load failed', err);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { refetch(); }, [refetch]);

  const pending = useMemo(() => requests.filter(r => r.status === 'Pending'), [requests]);
  const history = useMemo(() => requests.filter(r => r.status !== 'Pending').slice(0, 10), [requests]);

  const openApprovers = async (requestId: number) => {
    setApproversFor(requestId);
    try {
      const list = await leaveRequestsApi.approvers(requestId);
      setApproversList(list);
    } catch (err) {
      console.warn('[LeaveSummaryPanel] approvers fetch failed', err);
      setApproversList([]);
    }
  };

  const cancel = async (requestId: number) => {
    if (!window.confirm('Cancel this leave request?')) return;
    try {
      await leaveRequestsApi.cancel(requestId);
      await refetch();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Cancel failed';
      alert(msg);
    }
  };

  return (
    <div className="leave-summary-panel mb-4">
      {/* ── Top action bar: Request Leave ── */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="fw-bold mb-0" style={{ fontSize: 16 }}>Leave</h5>
        <button
          type="button"
          className="rec-btn-primary"
          onClick={() => setShowRequest(true)}
        >
          <i className="ri-add-line" />Request Leave
        </button>
      </div>

      {/* ── Pending Leave Requests ── */}
      <div className="mb-3">
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Pending leave requests</h6>
        {loading ? (
          <div className="text-muted text-center py-4" style={{ background: '#f8f9fa', borderRadius: 12 }}>
            <i className="ri-loader-4-line ri-spin me-1" /> Loading…
          </div>
        ) : pending.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: '#f8f9fa', borderRadius: 12, fontSize: 13 }}>
            <i className="ri-flight-takeoff-line me-1" /> No pending requests
          </div>
        ) : pending.map(r => (
          <div
            key={r.id}
            className="lsp-request-card d-flex align-items-center gap-3 p-3 mb-2"
            style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, cursor: 'pointer' }}
            onClick={() => setDetailsRequestId(r.id)}
          >
            <span className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0" style={{ width: 44, height: 44, background: '#ece6ff' }}>
              <i className="ri-flight-takeoff-line" style={{ color: '#5a3fd1', fontSize: 20 }} />
            </span>
            <div className="d-grid gap-1" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', flex: 1, minWidth: 0 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>PAST LEAVE</div>
                <div style={{ fontSize: 13 }}>
                  {shortDate(r.from_date)} – {shortDate(r.to_date)}
                  <span className="text-muted ms-1">({Number(r.days)} {Number(r.days) === 1 ? 'day' : 'days'})</span>
                </div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>LEAVE TYPE</div>
                <div style={{ fontSize: 13 }}>{r.leave_type?.name ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>REQUESTED ON</div>
                <div style={{ fontSize: 13 }}>{fmtDate(r.created_at)}</div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>STATUS</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Pending</div>
                <button
                  type="button"
                  className="btn btn-link p-0"
                  style={{ fontSize: 12, color: '#5a3fd1', textDecoration: 'underline' }}
                  onClick={(e) => { e.stopPropagation(); openApprovers(r.id); }}
                >
                  View Approvers
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-link p-0"
              style={{ fontSize: 12, color: '#dc2626' }}
              onClick={(e) => { e.stopPropagation(); cancel(r.id); }}
              title="Cancel request"
            >
              <i className="ri-close-circle-line" style={{ fontSize: 20 }} />
            </button>
          </div>
        ))}
        {pending.filter(r => r.reason).slice(0, 1).map(r => (
          <div key={`note-${r.id}`} className="text-muted ps-3" style={{ fontSize: 12 }}>
            <strong>Leave Note:</strong> {r.reason}
          </div>
        ))}
      </div>

      {/* ── Leave Balances ── */}
      <div className="mb-3">
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Leave Balances</h6>
        {!balances || balances.types.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: '#f8f9fa', borderRadius: 12, fontSize: 13 }}>
            {balances?.employee?.plan_id == null
              ? 'No leave plan assigned. Ask HR to add you to a plan.'
              : 'No leave types configured on your plan yet.'}
          </div>
        ) : (
          <div className="d-flex gap-3 flex-wrap">
            {balances.types.map(t => {
              const tone = toneFor(t);
              const total = t.unlimited ? null : t.quota;
              const available = t.unlimited ? null : (t.available ?? 0);
              const pct = !t.unlimited && t.quota > 0 ? Math.min(100, ((t.used / t.quota) * 100)) : 0;
              return (
                <div key={t.leave_type_id} className="lsp-balance-card flex-grow-1" style={{ minWidth: 240, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 18 }}>
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <h6 className="fw-bold mb-0" style={{ fontSize: 14 }}>{t.name}</h6>
                    <button
                      type="button"
                      className="btn btn-link p-0"
                      style={{ fontSize: 12, color: '#5a3fd1', textDecoration: 'underline' }}
                      onClick={() => setDetailsType(t)}
                    >
                      View details
                    </button>
                  </div>
                  <div className="d-flex justify-content-center my-2">
                    <Donut size={140} stroke={14} percent={pct} ring={tone.ring} track={tone.track}>
                      {t.unlimited ? (
                        <>
                          <div className="fw-bold" style={{ fontSize: 14 }}>Unlimited</div>
                        </>
                      ) : (
                        <>
                          <div className="fw-bold" style={{ fontSize: 18 }}>{available} {available === 1 ? 'Day' : 'Days'}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>Available</div>
                        </>
                      )}
                    </Donut>
                  </div>
                  <div className="d-flex justify-content-between mt-3 pt-2" style={{ borderTop: '1px solid #f1f3f5' }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>AVAILABLE</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>{t.unlimited ? '∞' : available} {available === 1 ? 'day' : 'days'}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>CONSUMED</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>{t.used} {t.used === 1 ? 'day' : 'days'}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>ANNUAL QUOTA</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>{t.unlimited ? '∞' : total} {total === 1 ? 'day' : 'days'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Leave History ── */}
      <div>
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Leave History</h6>
        {history.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: '#eaf6ff', borderRadius: 12, fontSize: 13 }}>
            No Leave history to show.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            <table className="table mb-0" style={{ fontSize: 13 }}>
              <thead style={{ background: '#f8f9fa' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>DATES</th>
                  <th style={{ padding: '10px 14px' }}>LEAVE TYPE</th>
                  <th style={{ padding: '10px 14px' }}>DAYS</th>
                  <th style={{ padding: '10px 14px' }}>STATUS</th>
                  <th style={{ padding: '10px 14px' }}>APPROVED BY</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDetailsRequestId(r.id)}
                  >
                    <td style={{ padding: '10px 14px' }}>{shortDate(r.from_date)} – {shortDate(r.to_date)}</td>
                    <td style={{ padding: '10px 14px' }}>{r.leave_type?.name ?? '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{Number(r.days)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className="rec-pill" style={{
                        background:
                          r.status === 'Approved' ? '#d1fae5' :
                          r.status === 'Rejected' ? '#fee2e2' :
                          '#fef3c7',
                        color:
                          r.status === 'Approved' ? '#065f46' :
                          r.status === 'Rejected' ? '#b91c1c' :
                          '#a16207',
                        fontSize: 11,
                      }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }} className="text-muted">{r.approver?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Approvers popover (small modal) ── */}
      <Modal
        isOpen={approversFor !== null}
        toggle={() => setApproversFor(null)}
        centered
        size="sm"
        modalClassName="ep-leave-modal"
        backdropClassName="ep-leave-backdrop"
      >
        <ModalBody>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="fw-bold mb-0" style={{ fontSize: 13 }}>Approver chain</h6>
            <button type="button" className="btn-close" onClick={() => setApproversFor(null)} aria-label="Close" />
          </div>
          {approversList.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 12 }}>No approvers configured for this request.</div>
          ) : (
            <ol className="ps-3 mb-0">
              {approversList.map((a, i) => {
                const statusColor = a.status === 'Approved' ? '#065f46'
                  : a.status === 'Rejected' ? '#b91c1c'
                  : a.is_current ? '#5a3fd1' : '#6b7280';
                return (
                  <li key={i} style={{ fontSize: 12.5, marginBottom: 8 }}>
                    <div className="d-flex align-items-center gap-2">
                      <strong>{a.role.toUpperCase()}</strong>
                      <span className="rec-pill" style={{
                        background: a.status === 'Approved' ? '#d1fae5'
                          : a.status === 'Rejected' ? '#fee2e2'
                          : a.is_current ? '#ede9fe' : '#f3f4f6',
                        color: statusColor,
                        fontSize: 10,
                      }}>
                        {a.is_current && a.status === 'Pending' ? 'WAITING' : a.status.toUpperCase()}
                      </span>
                    </div>
                    <div>{a.name}</div>
                    {a.email && <div className="text-muted" style={{ fontSize: 11 }}>{a.email}</div>}
                    {a.comment && <div className="text-muted" style={{ fontSize: 11, fontStyle: 'italic' }}>"{a.comment}"</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </ModalBody>
      </Modal>

      {/* ── New Request Leave modal (replaces the 7-stage wizard) ── */}
      <RequestLeaveModal
        isOpen={showRequest}
        employeeId={employeeId}
        onClose={() => setShowRequest(false)}
        onSubmitted={refetch}
      />

      {/* ── Leave Request Details modal (opens from clicking a row) ── */}
      <LeaveRequestDetailsModal
        isOpen={detailsRequestId !== null}
        requestId={detailsRequestId}
        onClose={() => setDetailsRequestId(null)}
      />

      {/* ── Balance History modal ── */}
      <Modal
        isOpen={detailsType !== null}
        toggle={() => setDetailsType(null)}
        centered
        size="lg"
        modalClassName="ep-leave-modal"
        backdropClassName="ep-leave-backdrop"
      >
        <ModalBody className="p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="fw-bold mb-0">Leave details</h5>
            <button type="button" className="btn-close" onClick={() => setDetailsType(null)} aria-label="Close" />
          </div>
          {detailsType && (
            <>
              <h6 className="mb-3" style={{ fontSize: 14 }}>{detailsType.name}</h6>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <table className="table mb-0" style={{ fontSize: 13 }}>
                  <thead style={{ background: '#f8f9fa' }}>
                    <tr>
                      <th style={{ padding: '10px 14px' }}>Transaction date</th>
                      <th style={{ padding: '10px 14px' }}>Change</th>
                      <th style={{ padding: '10px 14px' }}>Balance</th>
                      <th style={{ padding: '10px 14px' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsType.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-muted text-center" style={{ padding: '24px' }}>
                          No transactions yet for this leave type.
                        </td>
                      </tr>
                    ) : detailsType.transactions.map((tx, i) => (
                      <tr key={i}>
                        <td style={{ padding: '10px 14px' }}>{tx.date}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className="rec-pill" style={{
                            background: tx.change.startsWith('+') ? '#d1fae5' : '#fee2e2',
                            color: tx.change.startsWith('+') ? '#065f46' : '#b91c1c',
                            fontSize: 11,
                          }}>{tx.change}</span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>{tx.balance}</td>
                        <td style={{ padding: '10px 14px' }} className="text-muted">{tx.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}

// Tiny inline SVG donut so we don't pull in a chart lib for this card.
function Donut({ size, stroke, percent, ring, track, children }: {
  size: number;
  stroke: number;
  percent: number;
  ring: string;
  track: string;
  children: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;
  return (
    <div className="position-relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={ring} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
        />
      </svg>
      <div className="position-absolute top-50 start-50 translate-middle text-center">
        {children}
      </div>
    </div>
  );
}
