import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody } from 'reactstrap';
import { leaveRequestsApi, ApiLeaveRequest } from './leavePlansApi';
import '../../../css/recruitment.css';
import '../../../css/leave.css';

// ─────────────────────────────────────────────────────────────────────────────
// HrLeaveApprovals — manager / HR approval queue. Lists pending leave
// requests scoped by the backend (direct reports for managers; whole tenant
// for HR / admin). Click any row to open a details modal with Approve /
// Reject actions and an optional comment. Server enforces who can act on
// what — UI just surfaces the buttons.
// ─────────────────────────────────────────────────────────────────────────────
type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'All';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: '#fef3c7', fg: '#a16207' },
  Approved:  { bg: '#d1fae5', fg: '#065f46' },
  Rejected:  { bg: '#fee2e2', fg: '#b91c1c' },
  Cancelled: { bg: '#eef2f6', fg: '#374151' },
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

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accentFor = (id: number) => ACCENTS[id % ACCENTS.length];
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

export default function HrLeaveApprovals() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ApiLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('Pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ApiLeaveRequest | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const list = await leaveRequestsApi.approvals({
        status: status === 'All' ? undefined : status,
        search: debouncedSearch || undefined,
      });
      setRows(list);
    } catch (err) {
      console.warn('[HrLeaveApprovals] load failed', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch]);

  useEffect(() => { refetch(); }, [refetch]);

  const openDetail = async (id: number) => {
    setOpenId(id);
    setComment('');
    try {
      const d = await leaveRequestsApi.show(id);
      setDetail(d);
    } catch (err) {
      console.warn('[HrLeaveApprovals] show failed', err);
      setDetail(null);
    }
  };

  const closeDetail = () => {
    setOpenId(null);
    setDetail(null);
    setComment('');
  };

  const act = async (action: 'approve' | 'reject') => {
    if (!detail) return;
    setActing(action);
    try {
      if (action === 'approve') {
        await leaveRequestsApi.approve(detail.id, comment || undefined);
      } else {
        await leaveRequestsApi.reject(detail.id, comment || undefined);
      }
      closeDetail();
      await refetch();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Action failed';
      alert(msg);
    } finally {
      setActing(null);
    }
  };

  const counts = useMemo(() => {
    const c = { Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 };
    rows.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  return (
    <Row>
      <Col xs={12}>
        <div className="lp-shell">
          {/* Header — purple gradient strip matching HrLeavePlans */}
          <div className="lp-header">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{
                  width: 44, height: 44,
                  background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
                  boxShadow: '0 8px 18px rgba(124,92,252,0.32)',
                }}
              >
                <i className="ri-check-double-line" style={{ color: '#fff', fontSize: 20 }} />
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0">Leave Approvals</h5>
                <div className="text-muted fs-13 mt-1">Review and act on pending leave requests from your team</div>
              </div>
            </div>
            <button
              type="button"
              className="lp-close-btn"
              onClick={() => navigate('/hr/leave')}
              aria-label="Back to leave"
              title="Back to leave"
            >
              <i className="ri-close-line" />
            </button>
          </div>

          {/* Filter row */}
          <div className="d-flex align-items-center gap-2 flex-wrap p-3" style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
            {(['Pending', 'Approved', 'Rejected', 'All'] as StatusFilter[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`lp-top-tab ${status === s ? 'is-active' : ''}`}
                style={{ fontSize: 13 }}
              >
                {s}
                {s !== 'All' && counts[s as keyof typeof counts] > 0 && (
                  <span className="ms-1 fw-bold" style={{ color: STATUS_TONE[s].fg }}>
                    ({counts[s as keyof typeof counts]})
                  </span>
                )}
              </button>
            ))}
            <div className="lp-search-box flex-grow-1 ms-auto" style={{ minWidth: 240, maxWidth: 360 }}>
              <i className="ri-search-line" />
              <input
                type="text"
                placeholder="Search by employee name or code..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="lp-icon-btn" aria-label="Refresh" onClick={refetch} title="Refresh">
              <i className="ri-refresh-line" />
            </button>
          </div>

          {/* Approvals table */}
          <div className="lp-config-table-wrap" style={{ padding: 16 }}>
            <table className="lp-config-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>LEAVE TYPE</th>
                  <th>DATES</th>
                  <th style={{ width: 90 }}>DAYS</th>
                  <th>REQUESTED ON</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-5 text-muted">
                      <i className="ri-loader-4-line ri-spin d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                      Loading approvals...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-5 text-muted">
                      <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.35 }} />
                      <div className="fw-semibold">Nothing to review</div>
                      <div className="fs-13 mt-1">
                        {status === 'Pending' ? 'No pending leave requests from your team.' : `No ${status.toLowerCase()} requests.`}
                      </div>
                    </td>
                  </tr>
                ) : rows.map(r => {
                  const empName = r.employee
                    ? (r.employee.display_name?.trim() || `${r.employee.first_name} ${r.employee.last_name ?? ''}`.trim())
                    : '—';
                  const tone = STATUS_TONE[r.status] || STATUS_TONE.Pending;
                  const acc = r.employee ? accentFor(r.employee.id) : '#7c5cfc';
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(r.id)}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span
                            className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${acc}, ${acc}cc)` }}
                          >
                            {initialsOf(empName)}
                          </span>
                          <div>
                            <div className="fw-semibold" style={{ fontSize: 13 }}>{empName}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{r.employee?.emp_code ?? ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="rec-pill" style={{ background: '#ece6ff', color: '#5a3fd1', fontSize: 11 }}>
                          {r.leave_type?.name ?? '—'}
                        </span>
                      </td>
                      <td className="fs-13">{shortDate(r.from_date)} – {shortDate(r.to_date)}</td>
                      <td className="fs-13">{Number(r.days)}</td>
                      <td className="fs-13 text-muted">{fmtDate(r.created_at)}</td>
                      <td>
                        <span className="rec-pill" style={{ background: tone.bg, color: tone.fg, fontSize: 11 }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          className="rec-btn-ghost"
                          onClick={() => openDetail(r.id)}
                          style={{ fontSize: 12 }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Col>

      {/* ── Detail / Approve / Reject modal ── */}
      <Modal isOpen={openId !== null} toggle={closeDetail} centered size="lg" backdrop="static">
        <ModalBody className="p-0">
          <div style={{ padding: '14px 22px 12px', background: 'linear-gradient(135deg, #5a3fd1, #7c5cfc)' }}>
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15 }}>Leave Request Details</h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
                  Review the application and approve or reject
                </div>
              </div>
              <button type="button" onClick={closeDetail} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
                <i className="ri-close-line" style={{ fontSize: 17 }} />
              </button>
            </div>
          </div>

          <div style={{ padding: '20px 24px' }}>
            {!detail ? (
              <div className="text-center text-muted py-4">
                <i className="ri-loader-4-line ri-spin d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                Loading...
              </div>
            ) : (
              <>
                {/* Requester header */}
                <div className="d-flex align-items-center gap-3 mb-3">
                  <span
                    className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                    style={{ width: 48, height: 48, fontSize: 16, background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' }}
                  >
                    {initialsOf(detail.employee
                      ? (detail.employee.display_name?.trim() || `${detail.employee.first_name} ${detail.employee.last_name ?? ''}`.trim())
                      : '?')}
                  </span>
                  <div>
                    <h5 className="fw-bold mb-0" style={{ fontSize: 15 }}>
                      {detail.employee
                        ? (detail.employee.display_name?.trim() || `${detail.employee.first_name} ${detail.employee.last_name ?? ''}`.trim())
                        : '—'}
                    </h5>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Requested on {fmtDate(detail.created_at)}
                    </div>
                  </div>
                </div>

                {/* Leave block */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <Row className="g-3">
                    <Col md={3}>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>FROM</div>
                      <div className="fw-bold" style={{ fontSize: 15 }}>{shortDate(detail.from_date)}</div>
                    </Col>
                    <Col md={3}>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>TO</div>
                      <div className="fw-bold" style={{ fontSize: 15 }}>{shortDate(detail.to_date)}</div>
                    </Col>
                    <Col md={3}>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>DAYS</div>
                      <div className="fw-bold" style={{ fontSize: 15 }}>{Number(detail.days)}</div>
                    </Col>
                    <Col md={3}>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>TYPE</div>
                      <div className="fw-bold" style={{ fontSize: 13 }}>{detail.leave_type?.name ?? '—'}</div>
                    </Col>
                  </Row>
                </div>

                {/* Reason */}
                {detail.reason && (
                  <div className="mb-3">
                    <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>LEAVE NOTE</div>
                    <div style={{ fontSize: 13 }}>{detail.reason}</div>
                  </div>
                )}

                {/* Handover */}
                {detail.handover_required && (
                  <div className="mb-3" style={{ background: '#f8f9fa', borderRadius: 10, padding: 12 }}>
                    <div className="fw-bold mb-1" style={{ fontSize: 12 }}>Handover</div>
                    {detail.cover_person && (
                      <div style={{ fontSize: 12 }}>
                        <strong>Cover person:</strong>{' '}
                        {detail.cover_person.display_name?.trim() ||
                          `${detail.cover_person.first_name} ${detail.cover_person.last_name ?? ''}`.trim()}
                      </div>
                    )}
                  </div>
                )}

                {/* Already-decided state */}
                {detail.status !== 'Pending' && (
                  <div className="mb-3" style={{
                    background: STATUS_TONE[detail.status]?.bg || '#eef2f6',
                    color: STATUS_TONE[detail.status]?.fg || '#374151',
                    borderRadius: 10, padding: 12, fontSize: 13,
                  }}>
                    <strong>{detail.status}</strong>
                    {detail.approver?.name && <> by {detail.approver.name}</>}
                    {detail.approved_at && <> on {fmtDate(detail.approved_at)}</>}
                    {detail.approver_comment && (
                      <div className="mt-2 text-muted" style={{ fontSize: 12 }}>
                        <strong>Comment:</strong> {detail.approver_comment}
                      </div>
                    )}
                  </div>
                )}

                {/* Approver comment + action buttons (only when Pending) */}
                {detail.status === 'Pending' && (
                  <>
                    <label className="fw-semibold" style={{ fontSize: 12 }}>
                      Comment <span className="text-muted">(optional — shown to the employee)</span>
                    </label>
                    <textarea
                      className="form-control mb-3"
                      rows={3}
                      placeholder="Add a note for the employee..."
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      style={{ fontSize: 13 }}
                    />

                    <div className="d-flex justify-content-end gap-2">
                      <button
                        type="button"
                        className="rec-btn-ghost"
                        onClick={closeDetail}
                        disabled={acting !== null}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rec-btn-ghost"
                        onClick={() => act('reject')}
                        disabled={acting !== null}
                        style={{ color: '#dc2626', borderColor: '#fecaca' }}
                      >
                        {acting === 'reject' ? <>Rejecting… <i className="ri-loader-4-line ri-spin" /></> : <><i className="ri-close-line" /> Reject</>}
                      </button>
                      <button
                        type="button"
                        className="rec-btn-primary"
                        onClick={() => act('approve')}
                        disabled={acting !== null}
                      >
                        {acting === 'approve' ? <>Approving… <i className="ri-loader-4-line ri-spin" /></> : <><i className="ri-check-line" /> Approve</>}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </ModalBody>
      </Modal>
    </Row>
  );
}
