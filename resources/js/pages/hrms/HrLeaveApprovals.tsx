import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody } from 'reactstrap';
import { leaveRequestsApi, ApiLeaveRequest, ApiLeaveApprover } from './leavePlansApi';
import { useTheme } from '../../contexts/ThemeContext';
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
// Dark-mode equivalents — the .lva-tone-card color-mix dark rule doesn't take
// on every browser, so feed theme-aware tones straight in (translucent tint +
// lightened text) and the always-applied light CSS rule renders them dark.
const STATUS_TONE_DARK: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: 'rgba(245,158,11,0.18)', fg: '#fcd34d' },
  Approved:  { bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  Rejected:  { bg: 'rgba(239,68,68,0.18)',  fg: '#fca5a5' },
  Cancelled: { bg: 'rgba(255,255,255,0.08)', fg: '#cbd5e1' },
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
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const statusTone = (s: string) => (dark ? STATUS_TONE_DARK : STATUS_TONE)[s] || (dark ? STATUS_TONE_DARK.Pending : STATUS_TONE.Pending);
  const [rows, setRows] = useState<ApiLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('Pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ApiLeaveRequest | null>(null);
  const [chain, setChain] = useState<ApiLeaveApprover[]>([]);
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
    setChain([]);
    try {
      // Fire both in parallel — the chain endpoint is cheap and the
      // approver list is small, so we save a roundtrip vs. sequential.
      const [d, c] = await Promise.all([
        leaveRequestsApi.show(id),
        leaveRequestsApi.approvers(id),
      ]);
      setDetail(d);
      setChain(c);
    } catch (err) {
      console.warn('[HrLeaveApprovals] show failed', err);
      setDetail(null);
      setChain([]);
    }
  };

  const closeDetail = () => {
    setOpenId(null);
    setDetail(null);
    setChain([]);
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
          <div className="d-flex align-items-center gap-2 flex-wrap p-3" style={{ background: 'var(--vz-card-bg)', borderBottom: '1px solid var(--vz-border-color)' }}>
            {/* Status filters as a segmented control — were plain text links
                before, now distinct tab buttons matching the other HRMS
                modules' filter bars (HRMS-BUG-100). */}
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
              {(['Pending', 'Approved', 'Rejected', 'All'] as StatusFilter[]).map(s => {
                const on = status === s;
                const count = s === 'All' ? undefined : counts[s as keyof typeof counts];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                    style={{
                      borderRadius: 8,
                      padding: '7px 14px',
                      fontSize: 13,
                      background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                      color: on ? '#fff' : 'var(--vz-secondary-color)',
                      border: 'none',
                      boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
                    }}
                  >
                    {s}
                    {count !== undefined && count > 0 && (
                      <span
                        className="badge rounded-pill"
                        style={{
                          fontSize: 11,
                          background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
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
                  const tone = statusTone(r.status);
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

                {/* Approval chain progress */}
                {chain.length > 0 && (
                  <div className="mb-3">
                    <div className="text-muted mb-2" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>APPROVAL CHAIN</div>
                    <div className="d-flex align-items-stretch gap-2">
                      {chain.map((c, i) => {
                        const tone = c.status === 'Approved' ? { bg: dark ? 'rgba(16,185,129,0.18)' : '#d1fae5', fg: dark ? '#6ee7b7' : '#065f46', ring: '#10b981' }
                          : c.status === 'Rejected' ? { bg: dark ? 'rgba(239,68,68,0.18)' : '#fee2e2', fg: dark ? '#fca5a5' : '#b91c1c', ring: '#ef4444' }
                          : c.is_current ? { bg: dark ? 'rgba(124,92,252,0.20)' : '#ede9fe', fg: dark ? '#c4b5fd' : '#5a3fd1', ring: '#7c5cfc' }
                          : { bg: dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', fg: dark ? '#9ca3af' : '#6b7280', ring: dark ? '#4b5563' : '#d1d5db' };
                        return (
                          <div key={i} className="lva-tone-card flex-grow-1 d-flex align-items-center gap-2" style={{
                            ['--lva-bg' as string]: tone.bg, ['--lva-fg' as string]: tone.fg, ['--lva-ring' as string]: tone.ring,
                            padding: '10px 12px', borderRadius: 10,
                            border: c.is_current ? `2px solid ${tone.ring}` : '1px solid transparent',
                            minWidth: 0,
                          } as CSSProperties}>
                            <span className="rounded-circle d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0" style={{
                              width: 24, height: 24, fontSize: 11, background: tone.ring, color: '#fff',
                            }}>
                              {c.status === 'Approved' ? <i className="ri-check-line" />
                               : c.status === 'Rejected' ? <i className="ri-close-line" />
                               : c.level}
                            </span>
                            <div className="min-w-0">
                              <div className="fw-semibold text-truncate" style={{ fontSize: 12 }}>{c.role}</div>
                              <div className="text-truncate" style={{ fontSize: 11, opacity: 0.8 }}>{c.name}</div>
                              {c.acted_at && c.status !== 'Pending' && (
                                <div style={{ fontSize: 10, opacity: 0.7 }}>
                                  {c.status} · {fmtDate(c.acted_at)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {chain.find(c => c.is_current) && (
                      <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                        Currently waiting on <strong>level {chain.find(c => c.is_current)?.level}</strong>
                        {' '}({chain.find(c => c.is_current)?.role}).
                      </div>
                    )}
                  </div>
                )}

                {/* Reason */}
                {detail.reason && (
                  <div className="mb-3">
                    <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>LEAVE NOTE</div>
                    <div style={{ fontSize: 13 }}>{detail.reason}</div>
                  </div>
                )}

                {/* Handover */}
                {detail.handover_required && (
                  <div className="mb-3" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, padding: 12 }}>
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
                  <div className="lva-tone-card mb-3" style={{
                    ['--lva-bg' as string]: statusTone(detail.status).bg,
                    ['--lva-fg' as string]: statusTone(detail.status).fg,
                    ['--lva-ring' as string]: detail.status === 'Approved' ? '#10b981'
                      : detail.status === 'Rejected' ? '#ef4444' : '#9ca3af',
                    borderRadius: 10, padding: 12, fontSize: 13,
                  } as CSSProperties}>
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
