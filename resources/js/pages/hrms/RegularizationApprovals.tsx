import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import Swal from 'sweetalert2';
import { useToast } from '../../contexts/ToastContext';
import BusyOverlay from '../../components/ui/BusyOverlay';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import { regularizationApi, type ApiRegularization, type ApiRegularizationApprover, type RegularizationStatus } from './regularizationApi';
import { to12h, punchPair12h } from '../../utils/timeFormat';

/* 12-hour clock, to match the attendance tables this screen sits under — those
   render through fmtClock/renderTime with hour24 hardcoded false, so a 24-hour
   "13:00" here was the only place in the attendance area still showing one, and
   the same punch read differently on two tables of the same page.
   The employee Attendance tab imports to12h straight from utils/timeFormat:
   reaching it through this component made two route chunks share a subtree,
   and Rollup hoisted it into a separate 11.5 kB request. */

/* The theme is toggled at runtime on <html>, and nothing in this tree
   re-renders when it flips — so observe the attribute instead of reading it
   once. Without this the badges kept their light pastels until the next data
   refresh. */
const useIsDark = () => {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(isDarkTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ['data-bs-theme', 'data-layout-mode'] });
    return () => obs.disconnect();
  }, []);
  return dark;
};

const STATUS_FILTERS: { key: RegularizationStatus | 'All'; label: string }[] = [
  { key: 'Pending',  label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
  { key: 'All',      label: 'All' },
];

/* Light pastels read as bright chips on the dark page, so each status also
   carries a dark variant. `useDarkTone` picks per render off the theme
   attribute rather than a media query — the app has an explicit toggle. */
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: '#fef3c7', fg: '#92400e' },
  Approved:  { bg: '#dcfce7', fg: '#15803d' },
  Rejected:  { bg: '#fee2e2', fg: '#b91c1c' },
  Cancelled: { bg: '#f1f5f9', fg: '#475569' },
};

const STATUS_TONE_DARK: Record<string, { bg: string; fg: string }> = {
  Pending:   { bg: 'rgba(247,184,75,0.18)',  fg: '#f7b84b' },
  Approved:  { bg: 'rgba(10,179,156,0.18)',  fg: '#4ade9f' },
  Rejected:  { bg: 'rgba(240,101,72,0.18)',  fg: '#fca5a5' },
  Cancelled: { bg: 'rgba(148,163,184,0.20)', fg: '#cbd5e1' },
};

const isDarkTheme = () => {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  return el.getAttribute('data-bs-theme') === 'dark'
      || el.getAttribute('data-layout-mode') === 'dark';
};

const statusTone = (status: string, dark: boolean) => {
  const map = dark ? STATUS_TONE_DARK : STATUS_TONE;
  return map[status] || map.Cancelled;
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

/* The search runs in SQL now — see the `search` block in
   AttendanceRegularizationController::approvals(), which matches the rendered
   date ("29 August 2026") and the Type labels ("Adjust log") as well as the raw
   columns, because a search box that misses what is on screen is worse than
   none. It cannot reach the 12-hour punch strings or `original_display`: both
   are built per row after the query. */

/** Every tab at zero — the starting badges, and what an error or an
 *  out-of-scope viewer leaves behind. Written out rather than `{}` so the
 *  badges render "0" instead of blanking out. */
const EMPTY_COUNTS: Record<string, number> = {
  Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0, All: 0,
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
  /* Full reason in a real modal. (#8)
   *
   * The full text used to live on the cell's `title`, i.e. the browser's native
   * tooltip. A native tooltip is unstyled, un-wrapped and un-scrollable, so a
   * long reason rendered as a single band stretching the width of the screen —
   * legible to nobody. It is also hover-only, so it could not be read on touch
   * at all. A click-opened modal is the readable, scrollable, dismissible form
   * of the same thing, and it is what the row's own View action already does
   * for the rest of the request. */
  const [full, setFull] = useState(false);
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
    <>
      {/* No `title` — see the note on `full` above. The clamped text itself is
          clickable when it is actually clipped, so the reason opens the same way
          whether the pointer lands on the words or on the link. */}
      <div className="reg-reason">
        <div
          ref={ref}
          className={`reg-reason-text${open ? '' : ' is-clamped'}`}
          onClick={clipped && !open ? () => setFull(true) : undefined}
          style={clipped && !open ? { cursor: 'pointer' } : undefined}
        >
          {text}
        </div>
        {(clipped || open) && (
          <span className="d-inline-flex gap-2">
            <button type="button" className="reg-reason-more" onClick={() => setOpen(o => !o)}>
              {open ? 'Show less' : 'Read more'}
            </button>
            <button type="button" className="reg-reason-more" onClick={() => setFull(true)}>
              View full
            </button>
          </span>
        )}
      </div>

      <Modal isOpen={full} toggle={() => setFull(false)} centered size="lg" zIndex={2000}>
        <ModalBody className="p-0">
          <div className="d-flex align-items-center justify-content-between px-3 py-2"
               style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
            <div className="fw-bold" style={{ fontSize: 13.5 }}>
              <i className="ri-chat-quote-line me-1" style={{ color: '#0d9488' }} />
              Regularization reason
            </div>
            <button type="button" className="btn-close" onClick={() => setFull(false)} aria-label="Close" />
          </div>
          {/* The reason scrolls INSIDE the dialog — the dialog itself never
              grows past the viewport, so there is no outer scrollbar. Same rule
              as the Reason panel in the View modal. (#7) */}
          <div className="px-3 py-3"
               style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto', lineHeight: 1.55 }}>
            {text}
          </div>
        </ModalBody>
      </Modal>
    </>
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
  const dark = useIsDark();
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
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch]   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  /** Rows matching the open tab, and the per-status totals for the tab strip —
   *  both straight from SQL, so neither is capped by the page on screen. */
  const [total, setTotal]     = useState(0);
  const [counts, setCounts]   = useState<Record<string, number>>(EMPTY_COUNTS);

  // Typing shouldn't fire a request per keystroke now that the search runs on
  // the server. Same 350ms the leave approvals queue uses.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  /* ONE page, from the server, plus the counts for every tab.
     This queue used to pull every row of every status and slice it in the
     browser, because per-tab counts could only be derived from the full set
     (#44). The counts now come from a copy of the same query taken before the
     status clause, so the full fetch has nothing left to pay for — and with a
     few hundred requests it was the fetch, not the slicing, that cost the time
     (QA #16, #33). */
  const reqRef = useRef(0);
  const load = useCallback(() => {
    const token = ++reqRef.current;
    setLoading(true);
    setError(null);
    regularizationApi.approvalsPage({
      status,
      search: debouncedSearch || undefined,
      page,
      per_page: pageSize,
      with_counts: true,
    })
      .then(res => {
        // A slower earlier request must not overwrite a newer page's rows.
        if (token !== reqRef.current) return;
        setRows(res.data);
        setTotal(res.total);
        setCounts(res.counts ?? EMPTY_COUNTS);
      })
      .catch((err: any) => {
        if (token !== reqRef.current) return;
        setError(err?.response?.data?.message || 'Failed to load regularization requests.');
      })
      .finally(() => {
        if (token !== reqRef.current) return;
        setLoading(false);
        setHasLoaded(true);
      });
  }, [status, debouncedSearch, page, pageSize]);

  // refreshKey is bumped by the parent when a request is raised from the day
  // panel; the rest of the deps ride in on `load` itself.
  useEffect(() => { load(); }, [load, refreshKey]);

  /* Back to page 1 whenever the result set is REPLACED rather than moved
     through. Staying on page 3 while narrowing to three matches asks the server
     for a page that does not exist and draws an empty table that reads as "no
     results" instead of "wrong page". */
  useEffect(() => { setPage(1); }, [status, debouncedSearch, pageSize]);

  /* Approving the last row on the last page empties it. The server answers
     honestly (0 rows, the new total), so step back rather than sit on a page
     past the end — client-side slicing used to clamp this for free. */
  useEffect(() => {
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last);
  }, [total, pageSize, page]);

  /* The server counts the tabs across the SEARCHED set, not the raw one — a
     header reading "Approved 28" above a table showing two matches contradicts
     its own body, which is the trap the employee list hit (QA #173). The counts
     query is a clone taken before the status clause, so an empty search leaves
     every count exactly as it was.
     Still the debounced needle, not `search`: the message below has to describe
     the rows actually on screen, which are the ones the last request fetched. */
  const needle = debouncedSearch.toLowerCase();

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

  /* The same cells the hand-built table drew; only the wrapper changed. */
  const columns: DataTableColumn<ApiRegularization>[] = [
    {
      id: 'employee', header: 'Employee',
      accessorFn: r => empName(r),
      cell: ({ row }) => <span className="fw-semibold">{empName(row.original)}</span>,
    },
    {
      id: 'date', header: 'Date',
      accessorFn: r => r.regularization_date,
      cell: ({ row }) => fmtDate(row.original.regularization_date),
    },
    {
      id: 'type', header: 'Type',
      accessorFn: r => r.type ?? '',
      cell: ({ row }) => (
        <>
          <span className="text-muted ep-fs-12">{row.original.mode === 'exempt' ? 'Exempt day' : 'Adjust log'}</span>
          {row.original.type && <div className="ep-fs-11 text-muted">{row.original.type}</div>}
        </>
      ),
    },
    /* The approver used to see only the times being ASKED for, with nothing to
       compare them against — approving blind. "Original" is the day as it
       stands, so the correction reads as before → after. Both punch columns are
       width-capped so a long correction wraps instead of stretching the table. */
    {
      id: 'original', header: 'Original Punches', enableSorting: false,
      meta: { width: 210, wrap: true },
      cell: ({ row }) => {
        const r = row.original;
        if (r.mode === 'exempt') return <span className="text-muted">—</span>;
        /* `original_display` is a single "first in – last out" span for a live
           day, but a frozen pre-approval snapshot can carry every pair,
           comma-separated. Split so both read as the same chips. Prose like
           "No punches (absent)" has no comma and becomes one muted chip. */
        const originals = to12h(r.original_display).split(',').map(t => t.trim()).filter(Boolean);
        return <PunchChips pairs={originals} muted />;
      },
    },
    {
      id: 'requested', header: 'Requested Punches', enableSorting: false,
      meta: { width: 260, wrap: true },
      cell: ({ row }) => {
        const r = row.original;
        if (r.mode === 'exempt') return <span className="text-muted">—</span>;
        return <PunchChips pairs={(r.punches ?? []).map(p => punchPair12h(p.in, p.out))} />;
      },
    },
    {
      id: 'reason', header: 'Reason', enableSorting: false,
      meta: { width: 220, wrap: true },
      cell: ({ row }) => <span className="ep-fs-12"><ReasonCell text={row.original.reason} /></span>,
    },
    {
      id: 'status', header: 'Status',
      accessorFn: r => r.status,
      cell: ({ row }) => {
        const tone = statusTone(row.original.status, dark);
        return (
          <span
            className="d-inline-flex align-items-center fw-semibold ep-fs-11 px-2 py-1 rounded"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {row.original.status}
          </span>
        );
      },
    },
    {
      id: 'action', header: 'Action', enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original;
        const rowBusy   = busy?.id === r.id;
        const approving = rowBusy && busy?.action === 'approve';
        const rejecting = rowBusy && busy?.action === 'reject';
        /* `can_act_now` alone was the gate, but the backend can still report it
           true on a row already decided (multi-level chains) — that row then
           drew Approve / Reject while every other decided row drew View. A
           decided row is never actionable, so require Pending too. */
        if (r.can_act_now && r.status === 'Pending') {
          return (
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
                  ? <span className="spinner-border" role="status" aria-hidden="true" style={{ width: 13, height: 13, borderWidth: 2 }} />
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
                  ? <span className="spinner-border" role="status" aria-hidden="true" style={{ width: 13, height: 13, borderWidth: 2 }} />
                  : <i className="ri-close-line" />}
              </button>
            </div>
          );
        }
        /* A row still awaiting someone else's decision keeps its plain label:
           that is a status, not an action, and there is nothing settled to
           review yet. Decided rows get the View button (QA #78). */
        return r.status === 'Pending'
          ? <span className="text-muted ep-fs-11">Awaiting manager</span>
          : <ViewButton row={r} onOpen={setDetail} />;
      },
    },
  ];

  return (
    <>
      {/* First load shows the DataTable's OWN skeleton (QA 197) — the module's
          table skeleton, not a bare grey block. Every REFRESH after that —
          approving a row, a request filed above — blurs the table already on
          screen via the overlay rather than greying the whole card, so
          `loading` reaches the table only on the first load. */}
      {error ? (
        <div className="text-center text-muted ep-fs-13 py-3"><i className="ri-error-warning-line me-1" />{error}</div>
      ) : (
        <BusyOverlay busy={loading && hasLoaded} label="Refreshing requests…">
          <DataTable
            loading={loading && !hasLoaded}
            data={rows}
            columns={columns}
            accent="teal"
            tabs={STATUS_FILTERS.map(f => ({ key: f.key, label: f.label, count: counts[f.key] }))}
            activeTab={status}
            onTabChange={k => setStatus(k as RegularizationStatus | 'All')}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            /* 0, not the default 300: the component already debounces at 350ms
               before it fetches, and two debounces in series would stack. */
            searchDebounce={0}
            searchPlaceholder="Search employee, date, type, reason…"
            serial
            /* Fill the viewport down to the footer, like every other HRMS list
               (HrEmployees, Leave, Payroll...). Without it the card hugged its
               rows and left a large blank below on a short result (QA 193). */
            fitToViewport
            /* The server owns paging, search and the tab counts. pageIndex is
               0-based here and 1-based in the request. */
            serverPagination={{
              total,
              pageIndex: page - 1,
              onPageChange: i => setPage(i + 1),
              onPageSizeChange: n => { setPageSize(n); setPage(1); },
            }}
            pageSize={pageSize}
            emptyMessage={needle
              ? <>No requests match “{debouncedSearch}”.</>
              : <>No {status === 'All' ? '' : status.toLowerCase()} regularization requests.</>}
          />
        </BusyOverlay>
      )}
      <RegularizationDetailModal row={detail} onClose={() => setDetail(null)} />
    </>
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
      /* Colours live in CSS, not here. Inline styles cannot be overridden by a
         stylesheet without !important, so this pill stayed on its light
         indigo in dark mode while every other cell on the row darkened with
         the table. (QA #36) */
      className="btn btn-sm d-inline-flex align-items-center gap-1 rounded-pill fw-semibold ep-fs-11 att-reg-view"
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

  /* Hooks must run on every render of this component, including the one where
     `row` is null and the dialog renders nothing. `useIsDark` is a hook, so
     reading it below the early return changed the hook count between the closed
     and open states and React tore the tree down — the "Something went wrong"
     screen the approver saw the moment they pressed View. */
  const dark = useIsDark();

  if (!row) return null;

  const tone      = statusTone(row.status, dark);
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
          style={{ background: 'linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#5eead4 100%)', color: '#fff' }}
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

        {/* The BODY scrolls, not the page behind it, and the header above stays
            pinned — so however long the request is, the employee's name and the
            status chip are always visible. Combined with the capped Reason
            panel below, a long reason no longer moves anything. (#7) */}
        <div
          className="d-flex flex-column gap-3 p-3"
          style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', overscrollBehavior: 'contain' }}
        >
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
                <span className="flex-shrink-0" style={{ ...LABEL, width: 64, letterSpacing: 0, color: '#0d9488' }}>After</span>
                {requested.length ? <PunchChips pairs={requested} /> : <span className="text-muted ep-fs-12">No punches</span>}
              </div>
            </div>
          )}

          {/* Reason — a callout, because it is the one free-text field and the
              only thing on here written by a person. */}
          <div style={{ ...PANEL, background: 'rgba(13,148,136,0.06)', border: '1px solid rgba(13,148,136,0.18)' }}>
            <div className="d-flex gap-2">
              <i className="ri-chat-quote-line flex-shrink-0" style={{ color: '#0d9488', marginTop: 1 }} />
              <div className="min-w-0">
                <div style={{ ...LABEL, color: '#0d9488' }}>Reason</div>
                {/* Scrolls WITHIN the callout. (#7)
                    Uncapped, a long reason grew this panel until the whole
                    dialog scrolled, pushing the correction, the decision and the
                    approval chain off-screen — the approver lost the details
                    they are there to weigh in order to read the reason. Capped
                    at 30vh, so the reason has its own scrollbar and everything
                    else stays put. `overscroll-behavior: contain` stops the
                    scroll handing off to the dialog once this reaches its end,
                    which is what made the outer bar appear to take over. */}
                <div
                  className="mt-1"
                  style={{
                    fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.55,
                    maxHeight: '30vh', overflowY: 'auto', overscrollBehavior: 'contain',
                    paddingRight: 4,
                  }}
                >
                  {row.reason || 'No reason given'}
                </div>
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
