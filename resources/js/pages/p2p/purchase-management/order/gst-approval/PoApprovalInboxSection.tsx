// Inbox section: PO senior-approval requests sent to the signed-in user, as a
// table — one row per request, one column per question the approver has
// (which PO, which supplier, how much, why it is here, who asked, when).
// "New" lists the pending ones; history lists those already decided.
// Rows come from GET /p2p/orders/gst-approvals?history=0|1, 10 a page.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody } from 'reactstrap';
import DataTable, { type DataTableColumn } from '../../../../../components/ui/DataTable';
import { FitTip } from '../create-po/form-fields';
import { PoApiError, poApprovalApi, type GstApprovalInboxMeta, type GstApprovalInboxRow } from '../api/po-api';
import { fmtDate, fmtDateTime, fmtMoney, initialsOf, monthsAgoText } from './approval-format';
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

  /* The shared DataTable, as the Inbox's Leave and Documents worklists use it
     — serial pills, sortable headers, one pager band. This was a hand-rolled
     <table> with its own header colour, its own pager, and a fixed layout that
     clipped the action button with no scrollbar to reach it (QA #257). */
  const columns = useMemo<DataTableColumn<GstApprovalInboxRow>[]>(() => [
    {
      header: 'Purchase Order', id: 'po', accessorFn: (r) => r.po_code ?? '',
      meta: { width: '13%' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="min-w-0">
            <span className="pga-code">{r.po_code}</span>
            <div className="pga-sub">{fmtDate(r.po_date)}</div>
          </div>
        );
      },
    },
    {
      header: 'Supplier', id: 'supplier', accessorFn: (r) => r.supplier_name ?? '',
      meta: { width: '15%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="min-w-0">
            <FitTip label={r.supplier_name ?? '—'}><div className="pga-strong-txt pga-ellipsis">{r.supplier_name ?? '—'}</div></FitTip>
            <div className="pga-sub">{r.supplier_code ?? '—'}</div>
          </div>
        );
      },
    },
    {
      header: 'PO Amount', id: 'amount', accessorFn: (r) => Number(r.grand_total ?? 0),
      meta: { width: '10%' },
      cell: info => {
        const r = info.row.original;
        return <span className="pga-amt-cell">{fmtMoney(r.grand_total, r.currency_code)}</span>;
      },
    },
    {
      header: history ? 'Decision' : 'Why Approval', id: 'why', enableSorting: false,
      meta: { width: '16%', wrap: true },
      cell: info => {
        const r = info.row.original;
        const approved = r.status === 'approved';
        if (history) {
          return (
            <div className="min-w-0">
              <span className={`pga-pill pga-pill--${approved ? 'ok' : 'bad'}`}>
                <i className={approved ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'} />{approved ? 'Approved' : 'Rejected'}
              </span>
              {r.reason && <FitTip label={r.reason}><div className="pga-sub pga-ellipsis">“{r.reason}”</div></FitTip>}
            </div>
          );
        }
        return (
          <div className="min-w-0">
            <span className="pga-pill pga-pill--warn"><i className="ri-error-warning-line" />GST return overdue</span>
            <div className="pga-sub">Last filed {fmtDate(r.gst_last_filing_date)} · {monthsAgoText(r.gst_last_filing_date)}</div>
          </div>
        );
      },
    },
    {
      header: 'Requested By', id: 'who', accessorFn: (r) => r.requested_by_name ?? '',
      meta: { width: '14%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
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
        );
      },
    },
    {
      header: history ? 'Decided On' : 'Received', id: 'when',
      accessorFn: (r) => (history ? r.decided_at : r.requested_at) ?? '',
      meta: { width: '10%' },
      cell: info => {
        const r = info.row.original;
        return <span className="pga-sub text-nowrap">{fmtDateTime(history ? r.decided_at : r.requested_at)}</span>;
      },
    },
    {
      header: 'Action', id: 'act', enableSorting: false,
      meta: { width: '16%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <div onClick={e => e.stopPropagation()}>
            {history ? (
              <button type="button" className="pga-act pga-act--view" onClick={() => open(r)}>
                <i className="ri-eye-line" />View
              </button>
            ) : (
              <button type="button" className="pga-act pga-act--go" onClick={() => open(r)}>
                <i className="ri-checkbox-circle-line" />Review &amp; Approve
              </button>
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [history]);


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

        <DataTable<GstApprovalInboxRow>
          data={rows}
          columns={columns}
          serial={{ header: 'SR NO', width: '6%' }}
          searchable={false}
          accent="teal"
          className="ib-leave-dt"
          loading={loading}
          minWidth={1180}
          onRowClick={(r) => open(r)}
          serverPagination={{
            total: meta?.total ?? rows.length,
            pageIndex: page - 1,                       // state is 1-based
            onPageChange: (idx) => setPage(idx + 1),
          }}
          emptyMessage={
            error ? (
              <>
                <i className="ri-error-warning-line d-block mb-2" style={{ fontSize: 30, opacity: 0.45 }} />
                <div className="fw-semibold">{error}</div>
                <button type="button" className="pga-act pga-act--view mt-2" onClick={() => setAttempt((a) => a + 1)}>
                  <i className="ri-refresh-line" />Try again
                </button>
              </>
            ) : (
              <>
                <i className="ri-file-shield-2-line d-block mb-2" style={{ fontSize: 30, opacity: 0.4 }} />
                <div className="fw-semibold">{history ? 'No decided PO approvals yet' : 'No pending PO approvals'}</div>
                <div className="fs-13 mt-1">
                  {history ? 'Purchase orders you approve or reject will be listed here.' : 'Requests from your team will appear here.'}
                </div>
              </>
            )
          }
        />
      </CardBody>
    </Card>
  );
}
