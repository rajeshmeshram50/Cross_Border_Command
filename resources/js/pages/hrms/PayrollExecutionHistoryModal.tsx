import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../../api';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import { useToast } from '../../contexts/ToastContext';
import '../../../css/recruitment.css';

/**
 * Payroll Execution History — who ran payroll, when, and how it ended.
 *
 * The Branch Admin login is shared between several people, so a run's own
 * created_by says "the branch admin" and never says which person. The
 * disbursement popup asks the operator to name themselves in "Payroll Run By";
 * this is where those answers are read back.
 *
 * READ-ONLY. There is no update or delete endpoint, so "users should not be
 * able to modify the saved execution date, execution time or operator details"
 * holds by construction rather than by permission.
 *
 * Organised MONTH-WISE: the cycle strip across the top answers "who ran
 * September, and how many times" at a glance, and the table beneath groups its
 * rows under the same cycle headings rather than listing them flat.
 */

type HistoryRow = {
  id: number;
  run_by: string;
  employee_id: string;
  executed_at: string | null;
  period_label: string;
  month: number | null;
  year: number | null;
  status: string;
  failure_reason: string | null;
  batch_ref: string | null;
  employees_paid: number | null;
  employees_held: number | null;
  total_amount: number | null;
  executed_by: string | null;
};

type SummaryRow = {
  year: number; month: number; label: string;
  run_by: string; employee_id: string; runs: number; last_run: string | null;
};

const PER_PAGE = 10;

/* The spec asks for a date column and a time column. They come off ONE stored
   instant — held apart they can disagree, and "the last run before X" stops
   being answerable. Split for display only. */
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

const STATUS_TONE: Record<string, string> = {
  Completed: 'peh-pill peh-pill--ok',
  'In Progress': 'peh-pill peh-pill--warn',
  Failed: 'peh-pill peh-pill--bad',
};

export default function PayrollExecutionHistoryModal({
  isOpen, onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // A fresh open is a fresh question — don't reopen on page 6 of a filter the
  // user set last time.
  useEffect(() => {
    if (isOpen) { setPage(1); setSearch(''); setDebounced(''); }
  }, [isOpen]);

  // Any change that REPLACES the result set goes back to page 1.
  useEffect(() => { setPage(1); }, [debounced]);

  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const { data } = await api.get('/payroll/execution-history', {
        /* Every cycle, always. The Cycle grouping below says which month a row
           belongs to; the tabs and the search box are what narrow it. */
        params: {
          page, per_page: PER_PAGE,
          ...(debounced ? { search: debounced } : {}),
        },
      });
      setRows(Array.isArray(data?.data) ? data.data : []);
      setSummary(Array.isArray(data?.summary) ? data.summary : []);
      setTotal(Number(data?.total ?? 0));
    } catch (err: any) {
      toast.error('Could not load execution history', err?.response?.data?.message || 'Please try again.');
      setRows([]); setSummary([]); setTotal(0);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, page, debounced]);

  useEffect(() => { load(); }, [load]);

  /* A heading row before the first execution of each cycle. The server already
     returns the page ordered newest-first, so a cycle change is simply the row
     whose cycle differs from the one above it — no regrouping, and the paging
     stays the server's. */
  const firstOfCycle = useMemo(() => {
    const seen = new Set<string>();
    const out = new Set<number>();
    for (const r of rows) {
      const key = `${r.year}-${r.month}`;
      if (!seen.has(key)) { seen.add(key); out.add(r.id); }
    }
    return out;
  }, [rows]);

  const runsInCycle = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of summary) {
      const key = `${s.year}-${s.month}`;
      m.set(key, (m.get(key) ?? 0) + s.runs);
    }
    return m;
  }, [summary]);

  const columns = useMemo<DataTableColumn<HistoryRow>[]>(() => [
    {
      header: 'Payroll Run By', id: 'run_by', accessorFn: (r) => r.run_by,
      meta: { width: '22%' },
      cell: info => {
        const r = info.row.original;
        const initials = String(r.run_by).split(/\s+/).filter(Boolean)
          .map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
        return (
          <div className="d-flex align-items-center gap-2">
            <span className="peh-avatar">{initials}</span>
            {/* The shared login that was actually used is still stored on the
                record (executed_by_user_name) — it is just not printed here:
                it is the same string on every row, so it crowded the one name
                that does vary. */}
            <div className="fw-semibold text-truncate" title={r.executed_by ? `Signed in as ${r.executed_by}` : undefined}>
              {r.run_by}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Employee ID', id: 'employee_id', accessorFn: (r) => r.employee_id,
      meta: { width: '11%', align: 'center' },
      cell: info => <code className="peh-code">{info.row.original.employee_id}</code>,
    },
    {
      /* Which month this execution belongs to. The runs-per-cycle count rides
         along on the first row of each month so the answer to "how many times
         was September run" is on the row itself, not only in the cards above. */
      header: 'Cycle', id: 'cycle',
      accessorFn: (r) => `${r.year}-${String(r.month ?? 0).padStart(2, '0')}`,
      meta: { width: '13%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        const n = runsInCycle.get(`${r.year}-${r.month}`) ?? 0;
        return (
          <div className="min-w-0">
            <div className="peh-cycle-name">{r.period_label}</div>
            {firstOfCycle.has(r.id) && n > 0 && (
              <div className="peh-sub">{n} {n === 1 ? 'run' : 'runs'}</div>
            )}
          </div>
        );
      },
    },
    {
      header: 'Execution Date', id: 'date', accessorFn: (r) => r.executed_at ?? '',
      meta: { width: '14%', align: 'center' },
      cell: info => <span className="text-nowrap">{fmtDate(info.row.original.executed_at)}</span>,
    },
    {
      header: 'Execution Time', id: 'time', accessorFn: (r) => r.executed_at ?? '',
      meta: { width: '13%', align: 'center' },
      cell: info => <span className="text-nowrap peh-sub">{fmtTime(info.row.original.executed_at)}</span>,
    },
    {
      header: 'Status', id: 'status', accessorFn: (r) => r.status,
      meta: { width: '13%', align: 'center' },
      cell: info => {
        const r = info.row.original;
        return (
          <span className={STATUS_TONE[r.status] ?? 'peh-pill'} title={r.failure_reason || undefined}>
            {r.status}
          </span>
        );
      },
    },
    {
      header: 'Result', id: 'result', enableSorting: false,
      meta: { width: '16%' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="min-w-0">
            <div className="peh-sub">
              {r.employees_paid != null ? `${r.employees_paid} paid` : '—'}
              {r.employees_held ? ` · ${r.employees_held} held` : ''}
            </div>
            {r.batch_ref && <code className="peh-code peh-code--muted">{r.batch_ref}</code>}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [firstOfCycle, runsInCycle]);

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered backdrop="static" scrollable
      modalClassName="rec-form-modal master-modal hrms-modal"
      contentClassName="rec-form-content border-0"
      /* Wide: seven columns, two of which are a name and a batch reference.
         96vw keeps the side gutters on a laptop while using the room a
         large screen has. */
      style={{ maxWidth: 1360, width: '96vw' }}>
      <ModalBody className="p-0">
        <PayrollExecutionHistoryStyles />

        <div className="rec-form-header peh-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2 min-w-0">
              <span className="peh-header-icon"><i className="ri-history-line" /></span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0 peh-title">Payroll Execution History</h5>
                <div className="peh-subtitle">
                  Who ran payroll each month, when, and how it ended — records cannot be edited
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="rec-close-btn d-inline-flex align-items-center justify-content-center flex-shrink-0">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        <div className="peh-body">
          <DataTable<HistoryRow>
            data={rows}
            columns={columns}
            serial={{ header: 'SR NO', width: '6%' }}
            accent="violet"
            className="hr-dt"
            loading={loading}
            minWidth={940}
            title="Execution records"
            subtitle="Every payroll run, newest first"
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            /* 0, not the default: this component already debounces at 350ms
               before it fetches, and two debounces in series would stack. */
            searchDebounce={0}
            searchPlaceholder="Search by name, employee ID or batch…"
            /* A rule above the first row of each month, so the cycles read as
               blocks rather than one flat list. */
            rowClassName={(r) => (firstOfCycle.has(r.id) ? 'peh-cycle-start' : undefined)}
            serverPagination={{
              total,
              pageIndex: page - 1,                   // state is 1-based
              onPageChange: (idx) => setPage(idx + 1),
            }}
            emptyMessage={
              <>
                <i className="ri-history-line d-block mb-2" style={{ fontSize: 30, opacity: 0.4 }} />
                <div className="fw-semibold">No payroll executions recorded yet</div>
                <div className="fs-13 mt-1">
                  A record is written each time payroll is successfully disbursed.
                </div>
              </>
            }
          />
        </div>
      </ModalBody>
    </Modal>
  );
}

/* Scoped to this popup. Tokens rather than literals, so dark mode follows the
   rest of the app without a second set of rules. */
function PayrollExecutionHistoryStyles() {
  return (
    <style>{`
      .peh-header { padding: 14px 22px 12px; }
      .peh-header-icon {
        width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
        background: rgba(255,255,255,0.18); color: #fff;
        display: inline-flex; align-items: center; justify-content: center; font-size: 17px;
      }
      .peh-title { color: #fff; font-size: 17px; line-height: 1.2; }
      .peh-subtitle { font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 1px; }
      .peh-body { padding: 16px 20px 18px; }

      /* Each month starts a block. A rule rather than a heading row, because a
         full-width heading cannot be inserted between table rows without the
         table component knowing about it. */
      .peh-cycle-start > td { border-top: 2px solid #c4b5fd !important; }
      [data-bs-theme="dark"] .peh-cycle-start > td { border-top-color: rgba(124,92,252,.45) !important; }
      .peh-cycle-start:first-child > td { border-top: 0 !important; }
      .peh-cycle-name { font-weight: 800; color: #5a3fd1; letter-spacing: .02em; font-size: 12.5px; }
      [data-bs-theme="dark"] .peh-cycle-name { color: #c4b5fd; }

      .peh-avatar {
        width: 28px; height: 28px; border-radius: 999px; flex-shrink: 0;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700; color: #fff;
        background: linear-gradient(135deg, #7c5cfc, #5a3fd1);
      }
      .peh-sub { font-size: 11.5px; color: var(--vz-secondary-color); }
      .peh-code {
        font-size: 11px; padding: 1px 7px; border-radius: 5px;
        background: #ede9fe; color: #5a3fd1; font-weight: 700;
      }
      .peh-code--muted { background: var(--vz-light); color: var(--vz-secondary-color); }
      [data-bs-theme="dark"] .peh-code { background: rgba(124,92,252,.20); color: #c4b5fd; }

      .peh-pill {
        display: inline-block; padding: 2px 10px; border-radius: 999px;
        font-size: 11px; font-weight: 800;
        background: var(--vz-light); color: var(--vz-secondary-color);
      }
      .peh-pill--ok   { background: #dcfce7; color: #15803d; }
      .peh-pill--warn { background: #fef3c7; color: #a16207; }
      .peh-pill--bad  { background: #fee2e2; color: #b91c1c; }
      [data-bs-theme="dark"] .peh-pill--ok   { background: rgba(34,197,94,.18);  color: #6ee7b7; }
      [data-bs-theme="dark"] .peh-pill--warn { background: rgba(245,158,11,.18); color: #fcd34d; }
      [data-bs-theme="dark"] .peh-pill--bad  { background: rgba(239,68,68,.18);  color: #fca5a5; }
    `}</style>
  );
}
