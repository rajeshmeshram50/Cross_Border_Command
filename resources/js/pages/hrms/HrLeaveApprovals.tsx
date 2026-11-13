import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Modal, ModalBody } from 'reactstrap';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import { leaveRequestsApi, ApiLeaveRequest, ApiLeaveApprover, ApiSandwichMeta } from './leavePlansApi';
import { useTheme } from '../../contexts/ThemeContext';
import '../../../css/recruitment.css';
import '../../../css/leave.css';

type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'All';

/* Rows per page: 10 by default, remembered per screen — the contract
   HrEmployees set and Employee Onboarding follows, so every list in the app
   opens the same size. Versioned key: a remembered size always beats a new
   default, so bump the suffix if the default ever moves. */
const PER_PAGE_KEY = 'cbc.hr.leaveApprovals.perPage.v1';
const PER_PAGE_DEFAULT = 10;

/** The remembered MANUAL choice, or null if the user has never made one.
 *  Null is meaningful: it is what licences the auto-fit. Only a deliberate pick
 *  is stored — persisting a fitted number would bake one machine's viewport in
 *  as a permanent choice and disable the fit for good on the next visit. */
const readPerPage = (): number | null => {
  try {
    const saved = Number(localStorage.getItem(PER_PAGE_KEY));
    return Number.isFinite(saved) && saved > 0 && saved <= 200 ? saved : null;
  } catch {
    return null;
  }
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: '#fef3c7', fg: '#a16207' },
  Approved:  { bg: '#d1fae5', fg: '#065f46' },
  Rejected:  { bg: '#fee2e2', fg: '#b91c1c' },
  Cancelled: { bg: '#eef2f6', fg: '#374151' },
  Skipped:   { bg: '#eef2f6', fg: '#64748b' },
};
const STATUS_TONE_DARK: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: 'rgba(245,158,11,0.18)', fg: '#fcd34d' },
  Approved:  { bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  Rejected:  { bg: 'rgba(239,68,68,0.18)',  fg: '#fca5a5' },
  Cancelled: { bg: 'rgba(255,255,255,0.08)', fg: '#cbd5e1' },
  Skipped:   { bg: 'rgba(255,255,255,0.06)', fg: '#94a3b8' },
};

/* The leave-type chip was the one pill still carrying its light pastel inline,
   so it stayed a bright sticker on the dark table while every status beside it
   had already been toned down. Same treatment as the maps above: a translucent
   fill of the page's violet with a light label. */
const TYPE_TONE      = { bg: '#ece6ff',               fg: '#5a3fd1' };
const TYPE_TONE_DARK = { bg: 'rgba(124,92,252,0.20)', fg: '#c4b5fd' };

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

/**
 * The detail body, in outline, while it loads.
 *
 * The modal used to open on a small spinner block and then snap to full height
 * the moment the request landed — opening it was a jump, and a slow network
 * made the buttons move under the cursor. This stands in at the same size and
 * in the same shape, so the dialog opens once and only fills in.
 */
function LeaveDetailSkeleton() {
  const bar = (w: number | string, h = 12, mt = 0) => (
    <span className="lva-sk" style={{ width: w, height: h, marginTop: mt }} />
  );
  return (
    <div aria-busy="true" aria-label="Loading the leave request">
      {/* avatar + name */}
      <div className="d-flex align-items-center gap-3 mb-3">
        <span className="lva-sk rounded-circle flex-shrink-0" style={{ width: 48, height: 48 }} />
        <div className="d-flex flex-column gap-2">{bar(160, 14)}{bar(110, 11)}</div>
      </div>
      {/* the four tone cards */}
      <div className="mb-3 d-flex gap-2 flex-wrap">
        {[0, 1, 2, 3].map((i) => <span key={i} className="lva-sk flex-grow-1" style={{ height: 52, borderRadius: 10, minWidth: 120 }} />)}
      </div>
      {/* dates / reason block */}
      <div className="mb-3 d-flex flex-column gap-2">{bar('45%', 11)}{bar('100%', 38)}</div>
      {/* approval chain */}
      <div className="mb-3" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, padding: 12 }}>
        <div className="d-flex flex-column gap-2">{bar('30%', 11)}{bar('100%', 34)}</div>
      </div>
      {/* comment box */}
      <div className="mb-3 d-flex flex-column gap-2">{bar('25%', 11)}{bar('100%', 64)}</div>
    </div>
  );
}

export default function HrLeaveApprovals() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const statusTone = (s: string) => (dark ? STATUS_TONE_DARK : STATUS_TONE)[s] || (dark ? STATUS_TONE_DARK.Pending : STATUS_TONE.Pending);
  const typeTone = dark ? TYPE_TONE_DARK : TYPE_TONE;
  const [rows, setRows] = useState<ApiLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  /* Server-side paging. The queue used to render every matching request in one
     table — 275 pending rows on a two-year-old branch, 363 KB of JSON, and it
     only ever grows: nothing leaves a pending queue except a decision. */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const savedPerPage = useMemo(() => {
    return readPerPage();
  }, []);
  // DataTable owns the row-fit and paging controls now; the external perPage is
  // only the page size sent to the server, driven by DataTable's callbacks.
  const [perPage, setPerPage] = useState<number>(savedPerPage ?? PER_PAGE_DEFAULT);
  const [status, setStatus] = useState<StatusFilter>('Pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ApiLeaveRequest | null>(null);
  const [chain, setChain] = useState<ApiLeaveApprover[]>([]);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  // Sandwich context for the open leave — how many of its `days` the branch
  // policy contributed, and whether the policy runs for this employee at all.
  const [sandwich, setSandwich] = useState<ApiSandwichMeta | null>(null);
  const [waiverReason, setWaiverReason] = useState('');
  const [waiving, setWaiving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, total: n, counts } = await leaveRequestsApi.approvalsPage({
        status: status === 'All' ? undefined : status,
        search: debouncedSearch || undefined,
        page,
        per_page: perPage,
        // Per-status totals across every tab, so a tab's badge doesn't read 0
        // just because another tab is the one currently loaded. (#60)
        with_counts: true,
      });
      setRows(data);
      setTotal(n);
      if (counts) setStatusCounts(counts);
    } catch (err) {
      console.warn('[HrLeaveApprovals] load failed', err);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch, page, perPage]);

  useEffect(() => { refetch(); }, [refetch]);

  /* Back to page 1 whenever the result set is replaced rather than moved
     through. Staying on page 6 while switching to a filter with two pages asks
     the server for a page that does not exist and renders an empty table that
     looks like "no results" instead of "wrong page". */
  useEffect(() => { setPage(1); }, [status, debouncedSearch, perPage]);

  const openDetail = async (id: number) => {
    setOpenId(id);
    setComment('');
    setChain([]);
    setSandwich(null);
    setWaiverReason('');
    try {
      const [d, c] = await Promise.all([
        leaveRequestsApi.showWithMeta(id),
        leaveRequestsApi.approvers(id),
      ]);
      setDetail(d.data);
      setSandwich(d.meta);
      setWaiverReason(d.data.sandwich_waiver_reason || '');
      setChain(c);
    } catch (err) {
      console.warn('[HrLeaveApprovals] show failed', err);
      setDetail(null);
      setChain([]);
    }
  };

  /* Toggle the sandwich waiver. The server re-sizes `days` and returns the
     updated row, so the response replaces `detail` wholesale — recomputing the
     new day count on the client would be a second implementation of the rule,
     and the two would drift. The list behind the modal is refetched because the
     day count it shows has just changed. */
  const toggleWaiver = async (next: boolean) => {
    if (!detail) return;
    setWaiving(true);
    try {
      const res = await leaveRequestsApi.sandwichWaiver(detail.id, next, waiverReason.trim() || undefined);
      setDetail(res.data);
      // Re-derive the "+N days" figure; waiving changes it to 0 and back.
      const meta = await leaveRequestsApi.showWithMeta(detail.id);
      setSandwich(meta.meta);
      await refetch();
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || 'Could not update the waiver');
    } finally {
      setWaiving(false);
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

  // Tab counts come from the server, across every status under the current
  // search — independent of which tab is open, which the page's rows are not.
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  /* Columns for the shared <DataTable> — same component the Employee list uses,
     so this screen reads like the rest of the app. Widths are percentages and
     sum to 100 alongside the 4% serial column (4+22+14+16+8+14+12+10). */
  const columns = useMemo<DataTableColumn<ApiLeaveRequest>[]>(() => [
    {
      header: 'Employee',
      id: 'employee',
      accessorFn: (r) => r.employee?.display_name || `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`.trim(),
      meta: { width: '22%' },
      cell: info => {
        const r = info.row.original;
        const name = (r.employee?.display_name?.trim() || `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`.trim()) || '—';
        const acc = r.employee ? accentFor(r.employee.id) : '#7c5cfc';
        return (
          <div className="d-flex align-items-center gap-2">
            <span
              className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${acc}, ${acc}cc)` }}
            >
              {initialsOf(name)}
            </span>
            <div className="min-w-0">
              <div className="fw-semibold text-truncate" style={{ fontSize: 13 }}>{name}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{r.employee?.emp_code ?? ''}</div>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Leave Type',
      id: 'leave_type',
      accessorFn: (r) => r.leave_type?.name ?? '',
      meta: { width: '14%', align: 'center' },
      cell: info => (
        <span className="rec-pill" style={{ background: typeTone.bg, color: typeTone.fg, fontSize: 11 }}>
          {info.row.original.leave_type?.name ?? '—'}
        </span>
      ),
    },
    {
      header: 'Dates',
      id: 'dates',
      accessorFn: (r) => r.from_date ?? '',
      meta: { width: '16%' },
      cell: info => {
        const r = info.row.original;
        return <span className="fs-13">{shortDate(r.from_date)} – {shortDate(r.to_date)}</span>;
      },
    },
    {
      header: 'Days',
      accessorKey: 'days',
      meta: { width: '8%', align: 'center' },
      cell: info => <span className="fs-13">{Number(info.getValue())}</span>,
    },
    {
      header: 'Requested On',
      id: 'requested_on',
      accessorFn: (r) => r.created_at ?? '',
      meta: { width: '14%', align: 'center' },
      cell: info => <span className="fs-13 text-muted">{fmtDate(info.row.original.created_at)}</span>,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '12%', align: 'center' },
      cell: info => {
        const tone = statusTone(info.row.original.status);
        return <span className="rec-pill" style={{ background: tone.bg, color: tone.fg, fontSize: 11 }}>{info.row.original.status}</span>;
      },
    },
    {
      header: 'Action',
      id: 'action',
      enableSorting: false,
      meta: { width: '10%', align: 'right' },
      cell: info => (
        <button
          type="button"
          className="rec-btn-ghost"
          style={{ fontSize: 12 }}
          onClick={e => { e.stopPropagation(); openDetail(info.row.original.id); }}
        >
          Review
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [dark]);

  return (
    <Row>
      <Col xs={12}>
        <div className="lp-shell lp-shell--flush">
          <div className="frm-cstrip hr-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-check-double-line" /></div>
              <div className="min-w-0">
                <div className="frm-cstrip-title">Leave Approvals</div>
                <div className="frm-cstrip-sub">Review and act on pending leave requests from your team</div>
              </div>
            </div>
            <button type="button" className="frm-cstrip-back" onClick={() => navigate('/hr/leave')}>
              <i className="ri-arrow-left-line" />
              Back
            </button>
          </div>

          <DataTable<ApiLeaveRequest>
            data={rows}
            columns={columns}
            serial={{ header: 'Sr No', width: '4%' }}
            accent="violet"
            className="hr-dt"
            loading={loading}
            onRowClick={(r) => openDetail(r.id)}
            fitToViewport
            autoFitRows
            minAutoRows={10}
            serverPagination={{
              total,
              pageIndex: page - 1,                 // state is 1-based; DataTable counts from 0
              onPageChange: (idx) => setPage(idx + 1),
              onPageSizeChange: setPerPage,
            }}
            tabs={(['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'] as StatusFilter[]).map(s => ({
              key: s, label: s, count: statusCounts[s],
            }))}
            activeTab={status}
            onTabChange={(k) => setStatus(k as StatusFilter)}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by employee name or code..."
            emptyMessage={
              <>
                <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.35 }} />
                <div className="fw-semibold">Nothing to review</div>
                <div className="fs-13 mt-1">
                  {status === 'Pending' ? 'No pending leave requests from your team.' : `No ${status.toLowerCase()} requests.`}
                </div>
              </>
            }
          />
        </div>
      </Col>

      <Modal isOpen={openId !== null} toggle={closeDetail} centered size="lg" backdrop="static" contentClassName="lrd-modal">
        <ModalBody className="p-0">
          <div style={{ padding: '14px 22px 12px', background: 'linear-gradient(135deg, #5a3fd1, #7c5cfc)' }}>
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 17 }}>Leave Request Details</h5>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
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
              <LeaveDetailSkeleton />
            ) : (
              <>
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

                {detail.reason && (
                  <div className="mb-3">
                    <div className="text-muted" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5 }}>LEAVE NOTE</div>
                    <div style={{ fontSize: 13 }}>{detail.reason}</div>
                  </div>
                )}

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

                {/* Sandwich Leave Policy panel.
                    Shown for ANY status, not just Pending: the emergency case
                    usually surfaces at payroll time, long after approval, and
                    that is precisely when someone needs to reverse the charge.
                    Hidden entirely when the branch does not run the policy, or
                    when this leave's dates never triggered it — a waiver
                    control on a leave the rule never touched is noise. */}
                {sandwich?.sandwich_applicable
                  && (sandwich.sandwich_days > 0 || detail.sandwich_waived) && (
                  <div
                    className="mb-3"
                    style={{
                      border: `1px solid ${detail.sandwich_waived ? 'rgba(10,179,156,0.35)' : 'var(--vz-border-color)'}`,
                      background: detail.sandwich_waived ? 'rgba(10,179,156,0.06)' : 'var(--vz-secondary-bg)',
                      borderRadius: 10, padding: '12px 14px',
                    }}
                  >
                    <div className="d-flex align-items-start gap-2 mb-2">
                      <i
                        className="ri-calendar-check-line"
                        style={{ fontSize: 16, color: detail.sandwich_waived ? '#0ab39c' : '#7c5cfc', marginTop: 1 }}
                      />
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-semibold" style={{ fontSize: 12.5 }}>Sandwich Leave Policy</div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 1 }}>
                          {detail.sandwich_waived
                            ? `Waived — ${sandwich.sandwich_days} off-day(s) between the leave dates are NOT being charged.`
                            : `${sandwich.sandwich_days} week-off / holiday day(s) between the leave dates are included in the ${Number(detail.days)}-day total.`}
                        </div>
                      </div>
                      <span
                        className="fw-semibold flex-shrink-0"
                        style={{
                          fontSize: 11, padding: '3px 9px', borderRadius: 20,
                          background: detail.sandwich_waived ? 'rgba(10,179,156,0.16)' : 'rgba(124,92,252,0.14)',
                          color: detail.sandwich_waived ? '#0ab39c' : '#7c5cfc',
                        }}
                      >
                        {detail.sandwich_waived ? 'Waived' : `+${sandwich.sandwich_days} day(s)`}
                      </span>
                    </div>

                    {!detail.sandwich_waived && (
                      <input
                        className="form-control mb-2"
                        style={{ fontSize: 12 }}
                        placeholder="Reason (optional) — e.g. hospital admission, bereavement"
                        value={waiverReason}
                        maxLength={255}
                        onChange={e => setWaiverReason(e.target.value)}
                        disabled={waiving}
                      />
                    )}

                    {detail.sandwich_waived && (
                      <div className="text-muted mb-2" style={{ fontSize: 11 }}>
                        Waived
                        {detail.sandwich_waiver?.name && <> by <strong>{detail.sandwich_waiver.name}</strong></>}
                        {detail.sandwich_waived_at && <> on {fmtDate(detail.sandwich_waived_at)}</>}
                        {detail.sandwich_waiver_reason && <> — “{detail.sandwich_waiver_reason}”</>}
                      </div>
                    )}

                    <button
                      type="button"
                      className="rec-btn-ghost"
                      style={{ fontSize: 12, padding: '5px 12px' }}
                      disabled={waiving}
                      onClick={() => toggleWaiver(!detail.sandwich_waived)}
                    >
                      {waiving
                        ? <>Saving… <i className="ri-loader-4-line ri-spin" /></>
                        : detail.sandwich_waived
                          ? <><i className="ri-arrow-go-back-line" /> Re-apply policy</>
                          : <><i className="ri-shield-cross-line" /> Waive for this leave</>}
                    </button>
                  </div>
                )}

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
