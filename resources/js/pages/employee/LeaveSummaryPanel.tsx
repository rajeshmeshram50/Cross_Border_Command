import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
// The withdraw flow used raw sweetalert2 dialogs, which carry their own look
// and sat outside the app's dialog system. It now uses the shared confirm
// modal + toaster, same as every other destructive action in the product.
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import WorklistPager from '../../components/ui/WorklistPager';
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
import { Shimmer } from '../../components/ui/Shimmer';

interface Props {
  employeeId: string;
  canRequest?: boolean;
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

/** Format a day count for display. Accrual produces fractions (e.g. 1/12 of a
 *  monthly quota) and float subtraction leaves precision noise like
 *  4.9799999999999995 — round to 2 dp and drop trailing zeros (4.98, 1.5, 2). */
const fmtDays = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return String(parseFloat(v.toFixed(2)));
};
/** Rounded numeric value — used for singular/plural checks so 1.0000002 → 1. */
const roundDays = (n: number | null | undefined): number => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? parseFloat(v.toFixed(2)) : 0;
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

export default function LeaveSummaryPanel({ employeeId, canRequest = false }: Props) {
  const confirm = useConfirm();
  const toast   = useToast();
  const [requests, setRequests] = useState<ApiLeaveRequest[]>([]);
  const [balances, setBalances] = useState<ApiEmployeeBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [approversFor, setApproversFor] = useState<number | null>(null);
  const [approversList, setApproversList] = useState<ApiLeaveApprover[]>([]);
  const [detailsType, setDetailsType] = useState<ApiEmployeeBalanceType | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [detailsRequestId, setDetailsRequestId] = useState<number | null>(null);
  /** Id of the request currently being withdrawn — drives the row's spinner. */
  const [cancellingId, setCancellingId] = useState<number | null>(null);

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
  const history = useMemo(() => requests.filter(r => r.status !== 'Pending'), [requests]);
  // Client-side pagination for the Leave History table so it carries the same
  // WorklistPager footer as the Employee Onboarding list.
  const [histPage, setHistPage] = useState(1);
  const [histPageSize, setHistPageSize] = useState(5);
  const histTotalPages = Math.max(1, Math.ceil(history.length / histPageSize));
  const histSafePage = Math.min(histPage, histTotalPages);
  const visibleHistory = useMemo(
    () => history.slice((histSafePage - 1) * histPageSize, (histSafePage - 1) * histPageSize + histPageSize),
    [history, histSafePage, histPageSize],
  );

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
    const ok = await confirm({
      title: 'Cancel leave request?',
      message: 'This will withdraw the request. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Yes, cancel it',
      cancelLabel: 'Keep request',
    });
    if (!ok) return;
    // The cancel POST plus the refetch that follows it take long enough that
    // the row would otherwise sit there unchanged, still showing "Pending",
    // as if the click had done nothing (QA #95). Mark the row busy for the
    // whole round trip: its X turns into a spinner and stops accepting
    // repeat clicks until the refreshed list has rendered.
    setCancellingId(requestId);
    try {
      await leaveRequestsApi.cancel(requestId);
      await refetch();
      toast.success('Leave request cancelled', 'Your leave request has been withdrawn.');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Cancel failed';
      toast.error('Could not cancel', msg);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="leave-summary-panel mb-4" style={{ background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 14, padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.05)' }}>
      {/* Status pill tints. Light mode keeps the original pastel chips; the
          dark-mode overrides (which out-rank the inline-free class colours via
          !important) swap to deep tints so the badges don't wash out to bright
          chips on the dark table — same treatment as the expense-claims table. */}
      <style>{`
        .leave-status-badge--approved { background: #d1fae5; color: #065f46; }
        .leave-status-badge--rejected { background: #fee2e2; color: #b91c1c; }
        .leave-status-badge--pending  { background: #fef3c7; color: #a16207; }
        .leave-status-badge--waiting  { background: #ede9fe; color: #5a3fd1; }
        .leave-status-badge--neutral  { background: #f3f4f6; color: #6b7280; }
        [data-bs-theme="dark"] .leave-status-badge--approved { background: #0c2e1d !important; color: #4ade80 !important; }
        [data-bs-theme="dark"] .leave-status-badge--rejected { background: #3a0e1e !important; color: #f9a8d4 !important; }
        [data-bs-theme="dark"] .leave-status-badge--pending  { background: #3a2a08 !important; color: #fbbf24 !important; }
        [data-bs-theme="dark"] .leave-status-badge--waiting  { background: #2a1d5c !important; color: #c4b5fd !important; }
        [data-bs-theme="dark"] .leave-status-badge--neutral  { background: rgba(255,255,255,0.08) !important; color: #cbd5e1 !important; }
      `}</style>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="fw-bold mb-0" style={{ fontSize: 16 }}>Leave</h5>
        {canRequest && (
          <button
            type="button"
            className="rec-btn-primary"
            onClick={() => setShowRequest(true)}
          >
            <i className="ri-add-line" />Request Leave
          </button>
        )}
      </div>

      <div className="mb-3">
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Pending leave requests</h6>
        {loading ? (
          <div className="d-flex flex-column gap-2">
            {[0, 1].map(i => (
              <div
                key={i}
                className="d-flex align-items-center gap-3 p-3"
                style={{ background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 12 }}
              >
                <Shimmer width={44} height={44} radius={999} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, flex: 1, minWidth: 0 }}>
                  {[0, 1, 2, 3].map(j => (
                    <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Shimmer height={9} width="55%" />
                      <Shimmer height={13} width="80%" />
                    </div>
                  ))}
                </div>
                <Shimmer width={20} height={20} radius={999} />
              </div>
            ))}
          </div>
        ) : pending.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 12, fontSize: 13 }}>
            <i className="ri-flight-takeoff-line me-1" /> No pending requests
          </div>
        ) : pending.map(r => (
          <div
            key={r.id}
            className="lsp-request-card d-flex align-items-center gap-3 p-3 mb-2"
            style={{ background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 12, cursor: 'pointer' }}
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
              disabled={cancellingId === r.id}
              title={cancellingId === r.id ? 'Cancelling…' : 'Cancel request'}
            >
              <i
                className={cancellingId === r.id ? 'ri-loader-4-line ri-spin' : 'ri-close-circle-line'}
                style={{ fontSize: 20 }}
              />
            </button>
          </div>
        ))}
        {pending.filter(r => r.reason).slice(0, 1).map(r => (
          <div key={`note-${r.id}`} className="text-muted ps-3" style={{ fontSize: 12 }}>
            <strong>Leave Note:</strong> {r.reason}
          </div>
        ))}
      </div>

      <div className="mb-3">
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Leave Balances</h6>
        {loading ? (
          <div className="d-flex gap-3 flex-wrap">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex-grow-1" style={{ minWidth: 240, background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 14, padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.08)' }}>
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <Shimmer height={14} width={90} />
                  <Shimmer height={10} width={60} />
                </div>
                <div className="d-flex justify-content-center my-2">
                  <Shimmer width={140} height={140} radius={999} />
                </div>
                <div className="d-flex justify-content-between mt-3 pt-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
                  {[0, 1, 2].map(j => (
                    <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                      <Shimmer height={9} width={60} />
                      <Shimmer height={13} width={50} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : !balances || balances.types.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 12, fontSize: 13 }}>
            {balances?.employee?.plan_id == null
              ? 'No leave plan assigned. Ask HR to add you to a plan.'
              : 'No leave types configured on your plan yet.'}
          </div>
        ) : (
          <div className="d-flex gap-3 flex-wrap">
            {balances.types.map(t => {
              const tone = toneFor(t);
              const total = t.unlimited ? null : roundDays(t.quota);
              const available = t.unlimited ? null : roundDays(t.available ?? 0);
              // Total allowance = yearly quota + any extra/overdraft days. Shown
              // inside the donut so the circle reads "available of total".
              const totalAllowance = t.unlimited ? null : roundDays(t.quota + (t.extra ?? 0));
              const pct = !t.unlimited && t.quota > 0 ? Math.min(100, ((t.used / t.quota) * 100)) : 0;
              return (
                <div key={t.leave_type_id} className="lsp-balance-card flex-grow-1" style={{ minWidth: 240, background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 14, padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.08)' }}>
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
                          <div className="text-muted" style={{ fontSize: 9.5, marginTop: 2, fontWeight: 600, letterSpacing: 0.2 }}>
                            of {fmtDays(totalAllowance)} {roundDays(totalAllowance) === 1 ? 'day' : 'days'}
                          </div>
                        </>
                      )}
                    </Donut>
                  </div>
                  <div className="d-flex justify-content-between mt-3 pt-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>AVAILABLE</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>
                        {t.unlimited
                          ? <span style={{ fontSize: 22, lineHeight: 1, verticalAlign: 'middle' }}>∞</span>
                          : <>{available} {available === 1 ? 'day' : 'days'}</>}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>CONSUMED</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>{fmtDays(t.used)} {roundDays(t.used) === 1 ? 'day' : 'days'}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }}>ANNUAL QUOTA</div>
                      <div className="fw-semibold" style={{ fontSize: 13 }}>
                        {t.unlimited
                          ? <span style={{ fontSize: 22, lineHeight: 1, verticalAlign: 'middle' }}>∞</span>
                          : <>{total} {total === 1 ? 'day' : 'days'}</>}
                      </div>
                    </div>
                  </div>
                  {/* Extra-leave breakdown — only when the plan grants an
                      overdraft. The extra is an allowance beyond the accrued
                      quota (yearly + extra = total), shown for visibility; it
                      does not change Available / Consumed above. */}
                  {!t.unlimited && t.extra > 0 && (
                    <div
                      className="mt-3 pt-2 d-flex align-items-center justify-content-between flex-wrap gap-1"
                      style={{ borderTop: '1px dashed var(--vz-border-color)' }}
                    >
                      <span className="text-muted" style={{ fontSize: 11.5 }}>
                        {fmtDays(t.quota)} yearly <span className="fw-semibold" style={{ color: tone.ring }}>+ {fmtDays(t.extra)} extra</span>
                      </span>
                      <span className="fw-semibold" style={{ fontSize: 12 }}>
                        Total allowance: {fmtDays(t.quota + t.extra)} {roundDays(t.quota + t.extra) === 1 ? 'day' : 'days'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Leave History</h6>
        {loading ? (
          <div style={{ background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.08)' }}>
            <div style={{ background: 'var(--vz-secondary-bg)', padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              {[0, 1, 2, 3, 4].map(i => <Shimmer key={i} height={10} width="60%" />)}
            </div>
            {[0, 1, 2, 3].map(r => (
              <div key={r} style={{ padding: '14px', borderTop: '1px solid var(--vz-border-color)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
                {[0, 1, 2, 3, 4].map(c => <Shimmer key={c} height={13} width={c === 3 ? '50%' : '80%'} />)}
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 12, fontSize: 13 }}>
            No Leave history to show.
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid var(--vz-border-color)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.08)' }}>
            <table className="table mb-0" style={{ fontSize: 13 }}>
              <thead style={{ background: '#f3f4f6', borderBottom: '2px solid var(--vz-border-color)' }}>
                <tr>
                  {['DATES', 'LEAVE TYPE', 'DAYS', 'STATUS', 'APPROVED BY'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--vz-secondary-color)', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map(r => (
                  <tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDetailsRequestId(r.id)}
                  >
                    <td style={{ padding: '10px 14px' }}>{shortDate(r.from_date)} – {shortDate(r.to_date)}</td>
                    <td style={{ padding: '10px 14px' }}>{r.leave_type?.name ?? '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{Number(r.days)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        className={`rec-pill leave-status-badge leave-status-badge--${
                          r.status === 'Approved' ? 'approved'
                          : r.status === 'Rejected' ? 'rejected'
                          : 'pending'
                        }`}
                        style={{ fontSize: 11 }}
                      >{r.status}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }} className="text-muted">{r.approver?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <WorklistPager
              total={history.length}
              page={histSafePage}
              pageSize={histPageSize}
              onPage={setHistPage}
              onPageSize={(n) => { setHistPageSize(n); setHistPage(1); }}
              pageSizeOptions={[5, 10, 25, 50]}
            />
          </div>
        )}
      </div>

      {/* Standard app modal chrome — same gradient header, rounded corners and
          white close button used by the master Audit / Employee-Tree modals, so
          these popups match the rest of the app (QA #90, #97). Lives at the
          panel root rather than inside one modal: both the Approver chain and
          the Leave details popups use it, and a <style> nested inside a
          reactstrap Modal only exists while THAT modal is open. */}
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

      <Modal
        isOpen={approversFor !== null}
        toggle={() => setApproversFor(null)}
        centered
        zIndex={2100}
        modalClassName="ep-leave-modal"
        backdropClassName="ep-leave-backdrop"
        contentClassName="lrd-modal"
      >
        <div className="lrd-modal-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span className="lrd-modal-icon"><i className="ri-user-follow-line" /></span>
              <div className="min-w-0">
                <h5 className="mb-0 fw-bold lrd-modal-title">Approver chain</h5>
                <small className="lrd-modal-sub">Who signs off on this leave request, in order</small>
              </div>
            </div>
            <button type="button" className="lrd-modal-close" onClick={() => setApproversFor(null)} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <ModalBody className="lrd-modal-body px-4 py-3">
          {approversList.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 12 }}>No approvers configured for this request.</div>
          ) : (
            <ol className="ps-3 mb-0">
              {approversList.map((a, i) => {
                const variant = a.status === 'Approved' ? 'approved'
                  : a.status === 'Rejected' ? 'rejected'
                  : a.is_current ? 'waiting' : 'neutral';
                return (
                  <li key={i} style={{ fontSize: 12.5, marginBottom: 8 }}>
                    <div className="d-flex align-items-center gap-2">
                      <strong>{a.role.toUpperCase()}</strong>
                      <span
                        className={`rec-pill leave-status-badge leave-status-badge--${variant}`}
                        style={{ fontSize: 10 }}
                      >
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

      <RequestLeaveModal
        isOpen={showRequest}
        employeeId={employeeId}
        onClose={() => setShowRequest(false)}
        onSubmitted={refetch}
      />

      <LeaveRequestDetailsModal
        isOpen={detailsRequestId !== null}
        requestId={detailsRequestId}
        onClose={() => setDetailsRequestId(null)}
      />

      <Modal
        isOpen={detailsType !== null}
        toggle={() => setDetailsType(null)}
        centered
        size="lg"
        zIndex={2100}
        modalClassName="ep-leave-modal"
        backdropClassName="ep-leave-backdrop"
        contentClassName="lrd-modal"
      >
        <div className="lrd-modal-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span className="lrd-modal-icon"><i className="ri-calendar-line" /></span>
              <div className="min-w-0">
                <h5 className="mb-0 fw-bold lrd-modal-title">Leave details</h5>
                <small className="lrd-modal-sub">
                  {detailsType ? `Transaction ledger for ${detailsType.name}` : 'Transaction ledger'}
                </small>
              </div>
            </div>
            <button type="button" className="lrd-modal-close" onClick={() => setDetailsType(null)} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <ModalBody className="p-4 lrd-modal-body">
          {detailsType && (
            <>
              <div style={{ border: '1px solid var(--vz-border-color)', borderRadius: 10, overflow: 'hidden' }}>
                <table className="table mb-0" style={{ fontSize: 13 }}>
                  <thead style={{ background: 'var(--vz-secondary-bg)' }}>
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
                        <td style={{ padding: '10px 14px' }}>{fmtDays(tx.balance)}</td>
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
