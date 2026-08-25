import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardBody, Modal, ModalBody } from 'reactstrap';
import Swal from 'sweetalert2';
import { useToast } from '../../contexts/ToastContext';
import { Shimmer } from '../../components/ui/Shimmer';
import BusyOverlay from '../../components/ui/BusyOverlay';
import WorklistPager from '../../components/ui/WorklistPager';
import { regularizationApi, type ApiRegularization, type ApiRegularizationApprover, type RegularizationStatus } from './regularizationApi';
import { to12h, punchPair12h } from '../../utils/timeFormat';

/* 12-hour clock, to match the attendance tables this screen sits under — those
   render through fmtClock/renderTime with hour24 hardcoded false, so a 24-hour
   "13:00" here was the only place in the attendance area still showing one, and
   the same punch read differently on two tables of the same page.
   Re-exported because the employee Attendance tab imports it from here. */
export { to12h };

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

/** How many punch chips show before the rest collapse behind "+N more". */
const PUNCH_PREVIEW = 3;

/** One chip per punch pair.
 *  A correction that splits the day into nine slots used to print as a single
 *  nowrap comma-list, which stretched the column until Reason / Status /
 *  Action were pushed off the right edge of the table (CBC #77). Chips wrap
 *  inside a bounded column, and the tail collapses behind a "+N more" toggle —
 *  the full list is also on the cell's title for a hover read. */
function PunchChips({ pairs, muted = false }: { pairs: string[]; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!pairs.length) return <span className="text-muted">—</span>;
  const shown = open ? pairs : pairs.slice(0, PUNCH_PREVIEW);
  const hidden = pairs.length - shown.length;
  return (
    <div className="reg-punch-wrap" title={pairs.join(', ')}>
      {shown.map((p, i) => (
        <span key={i} className={`reg-punch-chip${muted ? ' is-muted' : ''}`}>{p}</span>
      ))}
      {hidden > 0 && (
        <button type="button" className="reg-punch-more" onClick={() => setOpen(true)}>
          +{hidden} more
        </button>
      )}
      {open && pairs.length > PUNCH_PREVIEW && (
        <button type="button" className="reg-punch-more" onClick={() => setOpen(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

/** Reason text, clamped to two lines with a "Read more" toggle.
 *
 *  A reason is free text with no length limit, so a single long one used to set
 *  the height of the whole row and push the Status / Action columns around —
 *  and there was no way to read past what fitted. The full text is always on the
 *  cell's title (hover), and the toggle expands it in place for a click, which
 *  is the same bargain PunchChips above already makes with "+N more". (QA #80) */
function ReasonCell({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);

  /* Measured, not guessed from a character count: whether two lines are enough
     depends on the column's rendered width, so a 90-character reason can fit on
     one screen and overflow on another. scrollHeight > clientHeight is the only
     honest answer, and it is re-taken on resize. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight - el.clientHeight > 1);
    measure();
    window.addEventListener('resize', measure);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [text]);

  if (!text) return <span className="text-muted">—</span>;

  return (
    <div className="reg-reason" title={text}>
      <div ref={ref} className={`reg-reason-text${open ? '' : ' is-clamped'}`}>{text}</div>
      {(clipped || open) && (
        <button type="button" className="reg-reason-more" onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

interface Props {
  /** Bumped by the parent when a NEW request is raised elsewhere on the page,
   *  so this list picks it up instead of waiting for a manual page refresh. */
  refreshKey?: number;
  /** Fired after a successful approve/reject so the parent can refetch the
   *  attendance timeline — approving rewrites that day's punches. */
  onActed?: () => void;
}

/** RM / HR approval queue for attendance regularizations. Embedded in the HR
 *  Attendance review screen. Approve / Reject are only enabled on rows the
 *  signed-in user can act on right now (server-computed `can_act_now`). */
export default function RegularizationApprovals({ refreshKey = 0, onActed }: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<ApiRegularization[]>([]);
  const [loading, setLoading] = useState(true);
  /* Separates "never loaded" from "loading again": the first wait draws a
     skeleton, every one after it blurs the table already on screen. */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<RegularizationStatus | 'All'>('Pending');
  const [busy, setBusy]       = useState<{ id: number; action: 'approve' | 'reject' } | null>(null);
  /** Row whose details are open in the read-only popup (QA #78). */
  const [detail, setDetail]   = useState<ApiRegularization | null>(null);
  const [open, setOpen]       = useState(true);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Always fetch the FULL set (every status) once, then filter client-side.
  // Fetching only the active tab meant we couldn't show accurate per-tab
  // counts — the Rejected tab could hold rows the header never counted (#44).
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    regularizationApi.approvals({ status: 'All' })
      .then(setRows)
      .catch((err: any) => setError(err?.response?.data?.message || 'Failed to load regularization requests.'))
      .finally(() => { setLoading(false); setHasLoaded(true); });
  }, []);

  // `load` is a stable useCallback([]), so refreshKey is what actually re-runs
  // this — the parent bumps it when a request is raised from the day panel.
  useEffect(() => { load(); }, [load, refreshKey]);
  // Reset to the first page whenever the status filter changes.
  useEffect(() => { setPage(1); }, [status]);

  // Per-tab counts derived from the full set, so every tab shows how many
  // requests it holds (the badge lives on the tabs, not the section title).
  const counts: Record<string, number> = {
    Pending:  rows.filter(r => r.status === 'Pending').length,
    Approved: rows.filter(r => r.status === 'Approved').length,
    Rejected: rows.filter(r => r.status === 'Rejected').length,
    All:      rows.length,
  };
  const filtered = status === 'All' ? rows : rows.filter(r => r.status === status);

  // Client-side pagination so the table gets the standard footer (record count
  // + pager) like the rest of the app (CBC #37).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const paged     = filtered.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);

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
    setBusy({ id: row.id, action: decision });
    try {
      if (decision === 'approve') await regularizationApi.approve(row.id, comment);
      else                        await regularizationApi.reject(row.id, comment);
      toast.success('Done', `Request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      load();
      // Approving replaced the day's punches — tell the parent so the timeline
      // above reloads too. Only this list used to refresh, which is why the
      // times up top stayed stale until a manual page reload.
      onActed?.();
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.message || err?.message || 'Could not update request');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="att-logs-card mt-2 mb-0">
      <CardBody>
      {/* Same shell as the Logs & Requests card above: header strip straight in
          the CardBody, then the bordered table box butted onto the pager. The
          old inner `border rounded overflow-hidden` wrapper plus its px-3 py-3
          padding put this table in a second, inset frame — which is what made
          the two cards read as different components. */}
      <div className="att-logs-headbar">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <span className="att-logs-headbar-icon"><i className="ri-checkbox-multiple-line" /></span>
          <div>
            <div className="att-logs-headbar-title">Regularization Requests</div>
            <div className="att-logs-headbar-sub">Approve or reject attendance correction requests</div>
          </div>
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
                {/* Count lives on each tab so it always matches what that tab
                    actually shows (e.g. Rejected reflects rejected rows). */}
                {!loading && (
                  <span
                    className="ms-1 d-inline-flex align-items-center justify-content-center fw-semibold"
                    style={{
                      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                      fontSize: 10.5, lineHeight: 1,
                      background: status === f.key ? 'rgba(255,255,255,0.28)' : 'var(--vz-light, #eef2f6)',
                      color: status === f.key ? '#fff' : 'var(--vz-secondary-color, #6b7280)',
                    }}
                  >
                    {counts[f.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(o => !o)} aria-label="Toggle">
            <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
          </button>
        </div>
      </div>

      {open && (
        <div>
          {/* First load has nothing to stand over, so it keeps the skeleton.
              Every REFRESH after that — approving a row, a request filed from
              the panel above — blurs the table it already has instead of
              replacing it with a grey block. */}
          {loading && !hasLoaded ? (
            <Shimmer height={120} radius={10} />
          ) : error ? (
            <div className="text-center text-muted ep-fs-13 py-3"><i className="ri-error-warning-line me-1" />{error}</div>
          ) : (
            <BusyOverlay busy={loading} label="Refreshing requests…">
            <div className="table-responsive att-tablebox">
              {/* No .table-sm — its compressed cell padding is what made this
                  table read tighter than every other HRMS list. No .table-light
                  either: Bootstrap paints that band with an inset box-shadow
                  that would cover the header gradient. Both the header and the
                  body rhythm now come from .reg-req-table in recruitment.css,
                  copied from the Recruitment list table. */}
              <table className="table align-middle mb-0 reg-req-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Type</th>
                    {/* The approver used to see only the times being ASKED for,
                        with nothing to compare them against — approving blind.
                        "Original" is the day as it stands (live for a pending
                        request, the frozen pre-approval snapshot once acted on),
                        so the correction reads as before → after. */}
                    <th>Original Punches</th>
                    <th>Requested Punches</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-muted ep-fs-13 py-4">
                        No {status === 'All' ? '' : status.toLowerCase()} regularization requests.
                      </td>
                    </tr>
                  ) : paged.map(r => {
                    const tone = STATUS_TONE[r.status] || STATUS_TONE.Cancelled;
                    const rowBusy    = busy?.id === r.id;
                    const approving  = rowBusy && busy?.action === 'approve';
                    const rejecting  = rowBusy && busy?.action === 'reject';
                    const punches = (r.punches ?? []).map(p => punchPair12h(p.in, p.out));
                    /* `original_display` is a single "first in – last out" span
                       for a live day, but a frozen pre-approval snapshot can
                       carry every pair, comma-separated. Split it so both read
                       as the same chips. Prose like "No punches (absent)" has
                       no comma and simply becomes one muted chip. */
                    const originals = to12h(r.original_display)
                      .split(',')
                      .map(t => t.trim())
                      .filter(Boolean);
                    return (
                      <tr key={r.id}>
                        <td className="fw-semibold">{empName(r)}</td>
                        <td>{fmtDate(r.regularization_date)}</td>
                        <td>
                          <span className="text-muted ep-fs-12">{r.mode === 'exempt' ? 'Exempt day' : 'Adjust log'}</span>
                          {r.type && <div className="ep-fs-11 text-muted">{r.type}</div>}
                        </td>
                        {/* Both punch columns are width-capped so a long
                            correction wraps instead of stretching the table. */}
                        <td style={{ maxWidth: 210, whiteSpace: 'normal' }}>
                          {r.mode === 'exempt' ? <span className="text-muted">—</span> : <PunchChips pairs={originals} muted />}
                        </td>
                        <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>
                          {r.mode === 'exempt' ? <span className="text-muted">—</span> : <PunchChips pairs={punches} />}
                        </td>
                        <td className="ep-fs-12" style={{ maxWidth: 220, whiteSpace: 'normal' }}>
                          <ReasonCell text={r.reason} />
                        </td>
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
                                data-tooltip={approving ? 'Approving…' : 'Approve'}
                                data-tooltip-pos="left"
                                aria-label="Approve"
                                aria-busy={approving}
                                disabled={rowBusy}
                                onClick={() => act(r, 'approve')}
                                className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                                style={{
                                  width: 28, height: 28, padding: 0,
                                  background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                                  color: '#fff', border: 'none',
                                  // Inline opacity beats Bootstrap's .btn:disabled dimming, so the
                                  // button actually running stays bright and the other one greys out.
                                  opacity: rejecting ? 0.45 : 1,
                                  cursor: rowBusy ? 'wait' : 'pointer',
                                }}
                              >
                                {approving
                                  ? <span className="spinner-border" role="status" aria-hidden="true"
                                          style={{ width: 13, height: 13, borderWidth: 2 }} />
                                  : <i className="ri-check-line" />}
                              </button>
                              <button
                                type="button"
                                data-tooltip={rejecting ? 'Rejecting…' : 'Reject'}
                                data-tooltip-pos="left"
                                aria-label="Reject"
                                aria-busy={rejecting}
                                disabled={rowBusy}
                                onClick={() => act(r, 'reject')}
                                className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-pill"
                                style={{
                                  width: 28, height: 28, padding: 0,
                                  background: 'linear-gradient(135deg,#f06548,#ff7a5c)',
                                  color: '#fff', border: 'none',
                                  opacity: approving ? 0.45 : 1,
                                  cursor: rowBusy ? 'wait' : 'pointer',
                                }}
                              >
                                {rejecting
                                  ? <span className="spinner-border" role="status" aria-hidden="true"
                                          style={{ width: 13, height: 13, borderWidth: 2 }} />
                                  : <i className="ri-close-line" />}
                              </button>
                            </div>
                          ) : (
                            /* A DECIDED row (Approved / Rejected / Cancelled) used to read
                               "View only" as bare text — it looked like a greyed-out control
                               and offered no way to see what had actually been requested.
                               That text is now the button. (QA #78)

                               A row still awaiting someone else's decision keeps its plain
                               "Awaiting manager" label: it is a status, not an action, and
                               there is nothing settled to review yet. */
                            r.status === 'Pending'
                              ? <span className="text-muted ep-fs-11">Awaiting manager</span>
                              : <ViewButton row={r} onOpen={setDetail} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <WorklistPager
              total={filtered.length}
              page={safePage}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
            </BusyOverlay>
          )}
        </div>
      )}
      </CardBody>
      <RegularizationDetailModal row={detail} onClose={() => setDetail(null)} />
    </Card>
  );
}


/* ── Action-column "View" button ──────────────────────────────────────────────
   Shown on DECIDED rows only — Approved / Rejected / Cancelled — in place of the
   old "View only" text. A row that is still pending shows either its Approve /
   Reject pills (if this user is the one to act) or an "Awaiting manager" label,
   so the column always carries exactly one meaning: the action available now.
   Styled as a pill to match the Approve / Reject pills it replaces. */
function ViewButton({ row, onOpen }: { row: ApiRegularization; onOpen: (r: ApiRegularization) => void }) {
  return (
    <button
      type="button"
      data-tooltip="View details"
      data-tooltip-pos="left"
      aria-label="View regularization details"
      onClick={() => onOpen(row)}
      className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold ep-fs-11"
      style={{
        height: 28, padding: '0 11px',
        background: '#eef2ff', color: '#4338ca',
        border: '1px solid #c7d2fe', cursor: 'pointer',
      }}
    >
      <i className="ri-eye-line" />View
    </button>
  );
}

/* ── Read-only detail popup ───────────────────────────────────────────────────
   Built to the same shape as the other confirm/detail dialogs in the app: a
   gradient header carrying an icon chip, title and subtitle, then a summary
   panel, then only the fields that actually say something.

   Deliberately NOT shown: a "Status" row (the header pill already carries it)
   and a standalone "Approved by" line (the approval chain below states who
   acted, and duplicating it printed an em dash whenever the approver relation
   came back unresolved). Empty values are dropped rather than rendered as "—". */
function RegularizationDetailModal({ row, onClose }: { row: ApiRegularization | null; onClose: () => void }) {
  const [chain, setChain] = useState<ApiRegularizationApprover[] | null>(null);
  const [chainError, setChainError] = useState(false);

  useEffect(() => {
    if (!row) { setChain(null); setChainError(false); return; }
    let stale = false;
    setChain(null);
    setChainError(false);
    regularizationApi.approvers(row.id)
      .then(rows => { if (!stale) setChain(rows); })
      // Everything else is already on screen from the list row, so a failed
      // chain fetch degrades to a note rather than an empty dialog.
      .catch(() => { if (!stale) setChainError(true); });
    return () => { stale = true; };
  }, [row]);

  if (!row) return null;

  const tone      = STATUS_TONE[row.status] || STATUS_TONE.Cancelled;
  const requested = (row.punches ?? []).map(p => punchPair12h(p.in, p.out));
  const originals = to12h(row.original_display).split(',').map(t => t.trim()).filter(Boolean);

  /* Who actually decided it. `row.approver` comes back null on rows approved
     through the chain, which rendered as a bare "—" next to a real date — the
     screenshot bug. The chain records the name, so read it from there before
     giving up on the line entirely. */
  const acted = chain ? [...chain].reverse().find(a => a.status === 'Approved' || a.status === 'Rejected') : null;
  const decidedBy = row.approver?.name || acted?.name || null;

  const LABEL: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--vz-secondary-color)',
  };
  const PANEL: React.CSSProperties = {
    background: 'var(--vz-secondary-bg)',
    border: '1px solid var(--vz-border-color)',
    borderRadius: 12, padding: '12px 14px',
  };

  return (
    <Modal isOpen centered toggle={onClose} className="reg-detail-modal" style={{ maxWidth: 620 }}>
      <ModalBody className="p-0">
        {/* Header — purple kept, swept the same way as the app's other dialog
            headers (dark on the left, light on the right). */}
        <div
          className="d-flex align-items-center gap-3 px-3 py-3"
          style={{ background: 'linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a78bfa 100%)', color: '#fff' }}
        >
          <span
            className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
            style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.20)', border: '1px solid rgba(255,255,255,0.28)' }}
          >
            <i className="ri-calendar-check-line" style={{ fontSize: 19 }} />
          </span>
          <div className="min-w-0 flex-grow-1">
            <div className="fw-bold" style={{ fontSize: 15, lineHeight: 1.25 }}>{empName(row)}</div>
            <div style={{ fontSize: 11.5, opacity: 0.86 }}>
              {row.mode === 'exempt' ? 'Exempt day' : 'Adjust log'}{row.type ? ' · ' + row.type : ''}
            </div>
          </div>
          <span
            className="fw-semibold flex-shrink-0"
            style={{ background: tone.bg, color: tone.fg, fontSize: 11, padding: '4px 10px', borderRadius: 999 }}
          >
            {row.status}
          </span>
          <button
            type="button" aria-label="Close" onClick={onClose}
            className="btn btn-sm d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
            style={{ width: 30, height: 30, padding: 0, background: 'rgba(255,255,255,0.20)', color: '#fff', border: 'none' }}
          >
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="d-flex flex-column gap-3 p-3">
          {/* Summary panel — the day being corrected, and when it was asked for. */}
          <div style={PANEL}>
            <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
              <div className="fw-bold" style={{ fontSize: 14 }}>{fmtDate(row.regularization_date)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                Raised {fmtDate(row.created_at)}
              </div>
            </div>
            {!!row.work_locations?.length && (
              <div className="mt-1" style={{ fontSize: 12 }}>
                <i className="ri-map-pin-line me-1" style={{ color: 'var(--vz-secondary-color)' }} />
                {row.work_locations.join(', ')}
              </div>
            )}
          </div>

          {/* The correction itself — before above, after below, so the two rows
              of chips line up and read as one change rather than two lists. */}
          {row.mode !== 'exempt' && (
            <div className="d-flex flex-column gap-2">
              <div style={LABEL}>The correction</div>
              <div className="d-flex align-items-baseline gap-2">
                <span className="flex-shrink-0" style={{ ...LABEL, width: 64, letterSpacing: 0 }}>Before</span>
                {originals.length ? <PunchChips pairs={originals} muted /> : <span className="text-muted ep-fs-12">No punches</span>}
              </div>
              <div className="d-flex align-items-baseline gap-2">
                <span className="flex-shrink-0" style={{ ...LABEL, width: 64, letterSpacing: 0, color: '#6d28d9' }}>After</span>
                {requested.length ? <PunchChips pairs={requested} /> : <span className="text-muted ep-fs-12">No punches</span>}
              </div>
            </div>
          )}

          {/* Reason — a callout, because it is the one free-text field and the
              only thing on here written by a person. */}
          <div style={{ ...PANEL, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}>
            <div className="d-flex gap-2">
              <i className="ri-chat-quote-line flex-shrink-0" style={{ color: '#6d28d9', marginTop: 1 }} />
              <div className="min-w-0">
                <div style={{ ...LABEL, color: '#6d28d9' }}>Reason</div>
                <div className="mt-1" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{row.reason || 'No reason given'}</div>
              </div>
            </div>
          </div>

          {/* Decision + chain, as one block — they are the same story. */}
          <div className="d-flex flex-column gap-2">
            <div style={LABEL}>Approval</div>
            {decidedBy && (
              <div style={{ fontSize: 12.5 }}>
                <span className="fw-semibold">{row.status === 'Rejected' ? 'Rejected' : 'Approved'} by {decidedBy}</span>
                {row.approved_at && <span style={{ color: 'var(--vz-secondary-color)' }}> · {fmtDate(row.approved_at)}</span>}
              </div>
            )}
            {row.approver_comment && (
              <div style={{ fontSize: 12, color: 'var(--vz-secondary-color)', fontStyle: 'italic' }}>“{row.approver_comment}”</div>
            )}
            {chainError ? <div className="text-muted ep-fs-12">Could not load the approval chain.</div>
              : chain === null ? <div className="text-muted ep-fs-12">Loading…</div>
              : chain.length === 0 ? <div className="text-muted ep-fs-12">No approver assigned — auto-approved.</div>
              : (
                <div className="d-flex flex-column gap-1">
                  {chain.map(a => {
                    const t = STATUS_TONE[a.status] || STATUS_TONE.Cancelled;
                    return (
                      <div key={a.level} className="d-flex align-items-center gap-2 flex-wrap" style={{ fontSize: 12 }}>
                        <span className="fw-semibold">{a.name || 'Unassigned'}</span>
                        <span style={{ color: 'var(--vz-secondary-color)', fontSize: 11.5 }}>{a.role}</span>
                        <span className="fw-semibold" style={{ background: t.bg, color: t.fg, fontSize: 10.5, padding: '2px 8px', borderRadius: 999 }}>
                          {a.status}{a.is_current ? ' · current' : ''}
                        </span>
                        {a.comment && <span style={{ color: 'var(--vz-secondary-color)', fontSize: 11.5 }}>— {a.comment}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
