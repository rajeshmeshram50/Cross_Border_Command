// Inbox section: PO senior-approval requests sent to the signed-in user.
// "New" lists the pending ones; history lists those already decided. Rows are
// paged on the server, 10 at a time; the review itself is a full page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody } from 'reactstrap';
import { Shimmer } from '../../../../../components/ui/Shimmer';
import { useToast } from '../../../../../contexts/ToastContext';
import { PoApiError, poApprovalApi, type GstApprovalInboxMeta, type GstApprovalInboxRow } from '../api/po-api';
import { fmtDate, fmtMoney, initialsOf } from './approval-format';
import './gst-approval.css';

export default function PoApprovalInboxSection({ history = false, onCount }: {
  history?: boolean;
  /** Total rows (all pages) — the Inbox adds it to its tab counts. */
  onCount?: (n: number) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<GstApprovalInboxRow[]>([]);
  const [meta, setMeta] = useState<GstApprovalInboxMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const countRef = useRef(onCount);
  countRef.current = onCount;

  const load = useCallback(async (p: number) => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await poApprovalApi.inbox({ history, page: p });
      if (ticket !== latest.current) return;   // a newer page was asked for
      setRows(res.rows);
      setMeta(res.meta);
      countRef.current?.(res.meta.total);
    } catch (e) {
      if (ticket === latest.current) toast.error('Could not load PO approvals', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [history, toast]);

  useEffect(() => { load(page); }, [load, page]);

  const open = (r: GstApprovalInboxRow) => navigate(`/inbox/po-approval/${r.id}`);
  const total = meta?.total ?? 0;

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

        {loading && !rows.length ? (
          <div className="ib-shim-wrap">{Array.from({ length: 2 }).map((_, i) => <Shimmer key={i} height={52} radius={8} />)}</div>
        ) : rows.length === 0 ? (
          history ? <div className="ib-hist-empty">No decided PO approvals yet.</div> : (
            <div className="ib-empty">
              <i className="ri-file-shield-2-line ib-empty-icon" />
              <div className="ib-empty-title">No pending PO approvals</div>
              <div className="ib-empty-sub">Requests from your team will appear here.</div>
            </div>
          )
        ) : (
          <div className={loading ? 'pga-refreshing' : undefined}>
            {rows.map((r) => (
              <div key={r.id} className={history ? 'ib-row-hist' : 'ib-row'}>
                <div className="d-flex align-items-start gap-3 flex-wrap">
                  <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0 ib-avatar pga-avatar">
                    {initialsOf(r.requested_by_name)}
                  </span>
                  <div className="ib-body-col">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <strong className="ib-name">{r.requested_by_name ?? '—'}</strong>
                      <span className="ib-sub-meta">
                        {[r.requested_by_department, r.requested_by_designation].filter(Boolean).map((t) => `${t} · `).join('')}requested {fmtDate(r.requested_at)}
                      </span>
                    </div>
                    <div className="mt-1 d-flex align-items-center flex-wrap gap-2 ib-line">
                      <span className="pga-pill pga-pill--po">Purchase Order</span>
                      <code className="ib-code-grey">{r.po_code}</code>
                      <span className="pga-supplier" title={r.supplier_name ?? ''}>{r.supplier_name ?? '—'}</span>
                      <span className="fw-bold ib-amt">· {fmtMoney(r.grand_total, r.currency_code)}</span>
                      {!history && <span className="pga-pill pga-pill--warn">GST return overdue</span>}
                      {history && <span className={`pga-pill pga-pill--${r.status === 'approved' ? 'ok' : 'bad'}`}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span>}
                    </div>
                    {!history && r.request_note && (
                      <div className="mt-1 text-muted ib-quote"><i className="ri-double-quotes-l me-1" />{r.request_note}</div>
                    )}
                    {history && r.reason && (
                      <div className="mt-1 text-muted ib-quote">
                        <i className="ri-double-quotes-l me-1" />{r.reason}
                        <span className="pga-when"> · {fmtDate(r.decided_at)}</span>
                      </div>
                    )}
                  </div>
                  <div className="d-flex flex-column gap-2 ib-actions-col">
                    {history ? (
                      <button type="button" className="ib-pager-btn" onClick={() => open(r)}>
                        <i className="ri-eye-line me-1" />View
                      </button>
                    ) : (
                      <button type="button" className="ib-btn-approve" onClick={() => open(r)}>
                        <i className="ri-checkbox-circle-line me-1" />Review &amp; Approve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

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
