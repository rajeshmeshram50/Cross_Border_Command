import { useCallback, useEffect, useState } from 'react';
import { Card, CardBody } from 'reactstrap';
import Swal from 'sweetalert2';
import { useToast } from '../../contexts/ToastContext';
import { Shimmer } from '../../components/ui/Shimmer';
import WorklistPager from '../../components/ui/WorklistPager';
import { regularizationApi, type ApiRegularization, type RegularizationStatus } from './regularizationApi';

const STATUS_FILTERS: { key: RegularizationStatus | 'All'; label: string }[] = [
  { key: 'Pending',  label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
  { key: 'All',      label: 'All' },
];

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: '#fef3c7', fg: '#92400e' },
  Approved:  { bg: '#dcfce7', fg: '#15803d' },
  Rejected:  { bg: '#fee2e2', fg: '#b91c1c' },
  Cancelled: { bg: '#f1f5f9', fg: '#475569' },
};

const empName = (r: ApiRegularization) => {
  const e = r.employee;
  if (!e) return `Employee #${r.employee_id}`;
  return (e.display_name || `${e.first_name} ${e.last_name ?? ''}`).trim() || `Employee #${r.employee_id}`;
};

const fmtDate = (iso: string) => {
  // regularization_date can arrive either date-only ("2026-07-10") or as a
  // full ISO timestamp ("2026-07-10T00:00:00.000000Z"). Pull the Y-M-D off the
  // front so we never build an invalid Date (which used to fall through to the
  // raw ISO string — bug #25).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Locale pinned to en-IN (the app standard) with the full month name —
  // "14 July 2026" — so the format no longer varies with the browser locale.
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** RM / HR approval queue for attendance regularizations. Embedded in the HR
 *  Attendance review screen. Approve / Reject are only enabled on rows the
 *  signed-in user can act on right now (server-computed `can_act_now`). */
export default function RegularizationApprovals() {
  const toast = useToast();
  const [rows, setRows]       = useState<ApiRegularization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<RegularizationStatus | 'All'>('Pending');
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [open, setOpen]       = useState(true);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    regularizationApi.approvals({ status })
      .then(setRows)
      .catch((err: any) => setError(err?.response?.data?.message || 'Failed to load regularization requests.'))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);
  // Reset to the first page whenever the status filter changes.
  useEffect(() => { setPage(1); }, [status]);

  // Client-side pagination so the table gets the standard footer (record count
  // + pager) like the rest of the app (CBC #37).
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const paged     = rows.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);

  const act = async (row: ApiRegularization, decision: 'approve' | 'reject') => {
    let comment: string | undefined;
    if (decision === 'reject') {
      const res = await Swal.fire({
        title: 'Reject regularization?',
        input: 'textarea',
        inputPlaceholder: 'Reason for rejection (optional)…',
        showCancelButton: true,
        confirmButtonText: 'Reject',
        confirmButtonColor: '#f06548',
      });
      if (!res.isConfirmed) return;
      comment = (res.value || '').trim() || undefined;
    }
    setBusyId(row.id);
    try {
      if (decision === 'approve') await regularizationApi.approve(row.id, comment);
      else                        await regularizationApi.reject(row.id, comment);
      toast.success('Done', `Request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      load();
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.message || err?.message || 'Could not update request');
    } finally {
      setBusyId(null);
    }
  };

  return (
    // Mirror LogsRequestsCard's shell (transparent .att-logs-card → padded
    // CardBody → inset bordered box) so this table's box lines up edge-to-edge
    // with the Logs & Requests table above it instead of sitting wider (bug #26).
    <Card className="att-logs-card mt-2 mb-0">
      <CardBody>
      <div className="border rounded overflow-hidden">
      <div className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap border-bottom">
        <div className="d-flex align-items-center gap-2">
          <i className="ri-checkbox-multiple-line fs-5 text-primary" />
          <h6 className="mb-0 fw-bold">Regularization Requests</h6>
          {!loading && <span className="badge bg-light text-dark">{(rows ?? []).length}</span>}
        </div>
        <div className="d-flex align-items-center gap-2">
          <div className="att-logs-ranges att-seg-toggle" role="group">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`att-logs-range ${status === f.key ? 'is-active' : ''}`}
                onClick={() => setStatus(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(o => !o)} aria-label="Toggle">
            <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 py-3">
          {loading ? (
            <Shimmer height={120} radius={10} />
          ) : error ? (
            <div className="text-center text-muted ep-fs-13 py-3"><i className="ri-error-warning-line me-1" />{error}</div>
          ) : (
            <>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 reg-req-table">
                <thead className="table-light">
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Requested Punches</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted ep-fs-13 py-4">
                        No {status === 'All' ? '' : status.toLowerCase()} regularization requests.
                      </td>
                    </tr>
                  ) : paged.map(r => {
                    const tone = STATUS_TONE[r.status] || STATUS_TONE.Cancelled;
                    const punches = (r.punches ?? []).map(p => `${p.in ?? '—'}–${p.out ?? '—'}`).join(', ');
                    return (
                      <tr key={r.id}>
                        <td className="fw-semibold">{empName(r)}</td>
                        <td>{fmtDate(r.regularization_date)}</td>
                        <td>
                          <span className="text-muted ep-fs-12">{r.mode === 'exempt' ? 'Exempt day' : 'Adjust log'}</span>
                          {r.type && <div className="ep-fs-11 text-muted">{r.type}</div>}
                        </td>
                        <td className="font-monospace ep-fs-12">{r.mode === 'exempt' ? '—' : (punches || '—')}</td>
                        <td className="ep-fs-12" style={{ maxWidth: 220 }}>{r.reason || '—'}</td>
                        <td>
                          <span
                            className="d-inline-flex align-items-center fw-semibold ep-fs-11 px-2 py-1 rounded"
                            style={{ background: tone.bg, color: tone.fg }}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="text-end">
                          {r.can_act_now ? (
                            /* Round gradient icon-pills — same standard Approve /
                               Reject action buttons the Expense Claims table uses
                               (CBC #41). */
                            <div className="d-inline-flex align-items-center gap-1">
                              <button
                                type="button"
                                data-tooltip="Approve"
                                data-tooltip-pos="left"
                                aria-label="Approve"
                                disabled={busyId === r.id}
                                onClick={() => act(r, 'approve')}
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
                                data-tooltip-pos="left"
                                aria-label="Reject"
                                disabled={busyId === r.id}
                                onClick={() => act(r, 'reject')}
                                className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                                style={{
                                  width: 28, height: 28, padding: 0,
                                  background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                                  color: '#fff', border: 'none',
                                }}
                              >
                                <i className="ri-close-line" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted ep-fs-11">{r.status === 'Pending' ? 'Awaiting manager' : 'View only'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <WorklistPager
              total={rows.length}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
            </>
          )}
        </div>
      )}
      </div>
      </CardBody>
    </Card>
  );
}
