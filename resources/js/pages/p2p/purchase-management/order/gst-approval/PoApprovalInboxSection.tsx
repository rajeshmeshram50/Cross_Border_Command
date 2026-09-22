// Inbox section: PO senior-approval requests sent to the signed-in user, as a
// table — one row per request, one column per question the approver has
// (which PO, which supplier, why it is here, who asked, when). The amount is
// on the review page, where the decision is made.
// "New" lists the pending ones; history lists those already decided.
// Rows come from GET /p2p/orders/gst-approvals?history=0|1, 10 a page.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody } from 'reactstrap';
import { ShimmerTableRows } from '../../../../../components/ui/Shimmer';
import { FitTip } from '../create-po/form-fields';
import { PoApiError, poApprovalApi, type GstApprovalInboxMeta, type GstApprovalInboxRow } from '../api/po-api';
import { fmtDate, fmtDateTime, initialsOf, monthsAgoText } from './approval-format';
import './gst-approval.css';

const PER_PAGE = 10;

export default function PoApprovalInboxSection({ history = false, onCount }: {
  history?: boolean;
  /** Total rows (all pages) — the Inbox adds it to its tab counts. */
  onCount?: (n: number) => void;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<GstApprovalInboxRow[]>([]);
  const [meta, setMeta] = useState<GstApprovalInboxMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Bumped by "Try again" to run the load once more.
  const [attempt, setAttempt] = useState(0);

  // Load the page whenever the tab, the page number or a retry changes.
  useEffect(() => {
    // A reply that lands after the user switched tab / page (or left) is dropped.
    let alive = true;
    setLoading(true);
    poApprovalApi.inbox({ history, page, per_page: PER_PAGE })
      .then((res) => {
        if (!alive) return;
        // A decision can empty the last page — step back instead of showing nothing.
        if (!res.rows.length && page > 1) { setPage(page - 1); return; }
        setRows(res.rows);
        setMeta(res.meta);
        setError('');
        onCount?.(res.meta?.total ?? res.rows.length);
      })
      .catch((e) => { if (alive) setError(e instanceof PoApiError ? e.firstError : 'Could not load PO approvals.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [history, page, attempt, onCount]);

  const open = (r: GstApprovalInboxRow) => navigate(`/inbox/po-approval/${r.id}`);
  const total = meta?.total ?? 0;
  const cols = 7;

  return (
    <Card className="mb-3 ep-section-card-flat">
      <CardBody className="ib-cardbody-0">
        <div className="d-flex align-items-center justify-content-between ib-section-head">
          <div className="d-flex align-items-center gap-2">
            <span className="pga-chip"><i className="ri-file-shield-2-line" /></span>
            <div>
              <h6 className="mb-0 fw-bold ib-head-title">Purchase Order Approvals</h6>
              <div className="text-muted ib-head-sub">
                {history
                  ? 'Purchase orders you have approved or rejected.'
                  : 'POs whose supplier GST return is overdue — your approval decides whether they can be submitted.'}
              </div>
            </div>
          </div>
          <span className="pga-count">{loading && !meta ? '…' : total}</span>
        </div>

        <div className="table-responsive">
          <table className={`pga-itbl${loading && rows.length ? ' is-loading' : ''}`}>
            <thead>
              <tr>
                <th className="pga-itbl__sr">Sr No</th>
                <th>Purchase Order</th>
                <th>Supplier</th>
                {history ? <th>Decision</th> : <th>Why Approval</th>}
                <th>Requested By</th>
                <th>{history ? 'Decided On' : 'Received'}</th>
                <th className="pga-itbl__act">Take Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <ShimmerTableRows rows={3} cols={cols} />
              ) : error ? (
                <tr>
                  <td colSpan={cols} className="pga-itbl__empty">
                    <i className="ri-error-warning-line pga-itbl__err-ico" />
                    <div className="pga-itbl__empty-t">{error}</div>
                    <button type="button" className="pga-act pga-act--view pga-itbl__retry" onClick={() => setAttempt((a) => a + 1)}>
                      <i className="ri-refresh-line" />Try again
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="pga-itbl__empty">
                    <i className="ri-file-shield-2-line" />
                    <div className="pga-itbl__empty-t">{history ? 'No decided PO approvals yet' : 'No pending PO approvals'}</div>
                    <div className="pga-itbl__empty-s">
                      {history ? 'Purchase orders you approve or reject will be listed here.' : 'Requests from your team will appear here.'}
                    </div>
                  </td>
                </tr>
              ) : rows.map((r, i) => {
                const approved = r.status === 'approved';
                return (
                  <tr key={r.id}>
                    <td className="pga-itbl__sr">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td>
                      <span className="pga-code">{r.po_code}</span>
                      <div className="pga-sub">{fmtDate(r.po_date)}</div>
                    </td>
                    <td className="pga-itbl__sup">
                      <FitTip label={r.supplier_name ?? '—'}><div className="pga-strong-txt pga-ellipsis">{r.supplier_name ?? '—'}</div></FitTip>
                      <div className="pga-sub">{r.supplier_code ?? '—'}</div>
                    </td>
                    {history ? (
                      <td className="pga-itbl__why">
                        <span className={`pga-pill pga-pill--${approved ? 'ok' : 'bad'}`}>
                          <i className={approved ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'} />{approved ? 'Approved' : 'Rejected'}
                        </span>
                        {r.reason && (
                          <FitTip label={r.reason}><div className="pga-sub pga-ellipsis">“{r.reason}”</div></FitTip>
                        )}
                      </td>
                    ) : (
                      <td className="pga-itbl__why">
                        <span className="pga-pill pga-pill--warn"><i className="ri-error-warning-line" />GST return overdue</span>
                        <div className="pga-sub">Last filed {fmtDate(r.gst_last_filing_date)} · {monthsAgoText(r.gst_last_filing_date)}</div>
                      </td>
                    )}
                    <td className="pga-itbl__who">
                      <div className="pga-who">
                        <span className="pga-who__av">{initialsOf(r.requested_by_name)}</span>
                        <div className="pga-who__txt">
                          <div className="pga-strong-txt">{r.requested_by_name ?? '—'}</div>
                          <div className="pga-sub">{[r.requested_by_department, r.requested_by_designation].filter(Boolean).join(' · ') || '—'}</div>
                          {!history && r.request_note && (
                            <FitTip label={r.request_note}><div className="pga-note-line pga-ellipsis"><i className="ri-chat-quote-line" />{r.request_note}</div></FitTip>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="pga-sub pga-itbl__when">{fmtDateTime(history ? r.decided_at : r.requested_at)}</td>
                    <td className="pga-itbl__act">
                      {history ? (
                        <button type="button" className="pga-act pga-act--view" onClick={() => open(r)}>
                          <i className="ri-eye-line" />View
                        </button>
                      ) : (
                        <button type="button" className="pga-act pga-act--go" onClick={() => open(r)}>
                          <i className="ri-checkbox-circle-line" />Review &amp; Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="d-flex align-items-center justify-content-between gap-2 ib-pager">
            <small className="ib-pager-info">Page {meta.current_page} of {meta.last_page} · {meta.total} total</small>
            <div className="d-flex gap-1">
              <button type="button" className="ib-pager-btn" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                <i className="ri-arrow-left-s-line" /> Prev
              </button>
              <button type="button" className="ib-pager-btn" disabled={page >= meta.last_page || loading} onClick={() => setPage(page + 1)}>
                Next <i className="ri-arrow-right-s-line" />
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
