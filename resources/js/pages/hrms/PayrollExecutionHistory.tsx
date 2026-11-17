import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Col, Row } from 'reactstrap';
import api from '../../api';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import BusyOverlay from '../../components/ui/BusyOverlay';
import { useToast } from '../../contexts/ToastContext';
import '../../../css/recruitment.css';

/**
 * Payroll Execution History — who ran payroll, when, and how it ended.
 *
 * The Branch Admin login is shared between several people, so a run's own
 * `created_by` says "the branch admin" and never says which person. The
 * disbursement popup asks the operator to name themselves in "Payroll Run By";
 * this is where those answers are read back.
 *
 * READ-ONLY by design. There is no edit or delete endpoint, so "users should
 * not be able to manually modify the saved execution date, execution time or
 * operator details" holds by construction rather than by permission.
 *
 * A page rather than a popup, and built on the same shell as Regularization
 * Requests — page strip, Back button, one DataTable with tabs and search — so
 * it reads as part of HRMS instead of as a dialog bolted onto Payroll.
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

const STATUS_FILTERS = [
  { key: 'All',         label: 'All' },
  { key: 'Completed',   label: 'Completed' },
  { key: 'In Progress', label: 'In Progress' },
  { key: 'Failed',      label: 'Failed' },
] as const;

type StatusKey = typeof STATUS_FILTERS[number]['key'];

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

export default function PayrollExecutionHistory() {
  const toast = useToast();
  const navigate = useNavigate();
  /* Payroll links here with the cycle it was showing, so the page opens on the
     question that was on screen. "All cycles" is one click away. */
  const [params] = useSearchParams();
  const qMonth = Number(params.get('month')) || null;
  const qYear  = Number(params.get('year')) || null;
  const qLabel = params.get('label');

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusKey>('All');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scope, setScope] = useState<'cycle' | 'all'>(qMonth && qYear ? 'cycle' : 'all');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Any change that REPLACES the result set sends you back to page 1 — staying
  // on page 6 asks the server for a page that no longer exists.
  useEffect(() => { setPage(1); }, [scope, debounced, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/payroll/execution-history', {
        params: {
          page, per_page: PER_PAGE,
          ...(status !== 'All' ? { status } : {}),
          ...(scope === 'cycle' && qMonth && qYear ? { month: qMonth, year: qYear } : {}),
          ...(debounced ? { search: debounced } : {}),
        },
      });
      setRows(Array.isArray(data?.data) ? data.data : []);
      setSummary(Array.isArray(data?.summary) ? data.summary : []);
      setCounts(data?.counts ?? {});
      setTotal(Number(data?.total ?? 0));
    } catch (err: any) {
      toast.error('Could not load execution history', err?.response?.data?.message || 'Please try again.');
      setRows([]); setSummary([]); setTotal(0);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scope, status, qMonth, qYear, debounced]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<DataTableColumn<HistoryRow>[]>(() => [
    {
      header: 'Payroll Run By', id: 'run_by', accessorFn: (r) => r.run_by,
      meta: { width: '20%' },
      cell: info => {
        const r = info.row.original;
        const initials = String(r.run_by).split(/\s+/).filter(Boolean)
          .map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
        return (
          <div className="d-flex align-items-center gap-2">
            <span className="peh-avatar">{initials}</span>
            <div className="min-w-0">
              <div className="fw-semibold text-truncate">{r.run_by}</div>
              {/* The shared login that was actually used. The gap between this
                  and the name above is the whole reason the record exists. */}
              {r.executed_by && <div className="peh-sub text-truncate">via {r.executed_by}</div>}
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
      header: 'Cycle', id: 'cycle',
      accessorFn: (r) => `${r.year}-${String(r.month ?? 0).padStart(2, '0')}`,
      meta: { width: '10%', align: 'center' },
      cell: info => <span className="fw-semibold">{info.row.original.period_label}</span>,
    },
    {
      header: 'Execution Date', id: 'date', accessorFn: (r) => r.executed_at ?? '',
      meta: { width: '13%', align: 'center' },
      cell: info => <span className="text-nowrap">{fmtDate(info.row.original.executed_at)}</span>,
    },
    {
      header: 'Execution Time', id: 'time', accessorFn: (r) => r.executed_at ?? '',
      meta: { width: '12%', align: 'center' },
      cell: info => <span className="text-nowrap peh-sub">{fmtTime(info.row.original.executed_at)}</span>,
    },
    {
      header: 'Status', id: 'status', accessorFn: (r) => r.status,
      meta: { width: '11%', align: 'center' },
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
      meta: { width: '17%' },
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
  ], []);

  return (
    <div className="rec-page peh-page">
      <PayrollExecutionHistoryStyles />
      <Row>
        <Col xs={12}>
          <div className="frm-cstrip hr-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-history-line" /></div>
              <div className="min-w-0">
                <div className="frm-cstrip-title">Payroll Execution History</div>
                <div className="frm-cstrip-sub">
                  Who ran payroll, when it was executed, and how it ended — records cannot be edited
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
              {qMonth && qYear && (
                <div className="peh-scope">
                  <button type="button"
                    className={`peh-scope-btn${scope === 'cycle' ? ' is-active' : ''}`}
                    onClick={() => setScope('cycle')}>
                    {qLabel || 'This cycle'}
                  </button>
                  <button type="button"
                    className={`peh-scope-btn${scope === 'all' ? ' is-active' : ''}`}
                    onClick={() => setScope('all')}>
                    All cycles
                  </button>
                </div>
              )}
              <button
                type="button"
                className="frm-cstrip-back flex-shrink-0"
                onClick={() => navigate('/hr/payroll')}
              >
                <i className="ri-arrow-left-line" />
                Back to Payroll
              </button>
            </div>
          </div>

          {/* Runs per cycle — the question this page is actually asked is
              "who ran September, and how many times". */}
          {summary.length > 0 && (
            <div className="peh-summary mb-3">
              <div className="peh-summary-head">
                <i className="ri-bar-chart-grouped-line" />
                <span>Runs per cycle</span>
              </div>
              <div className="peh-summary-grid">
                {summary.slice(0, 10).map((s, i) => (
                  <div key={`${s.year}-${s.month}-${s.employee_id}-${i}`} className="peh-summary-card">
                    <div className="peh-summary-label">{s.label}</div>
                    <div className="peh-summary-name" title={s.run_by}>{s.run_by}</div>
                    <div className="peh-summary-meta">
                      <code className="peh-code">{s.employee_id}</code>
                      <span className="peh-runs">{s.runs} {s.runs === 1 ? 'run' : 'runs'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* First load shows the DataTable's own skeleton; every refresh after
              that blurs the table already on screen rather than blanking it. */}
          <BusyOverlay busy={loading && hasLoaded} label="Refreshing history…">
            <DataTable<HistoryRow>
              data={rows}
              columns={columns}
              serial={{ header: 'SR NO', width: '6%' }}
              accent="violet"
              className="hr-dt"
              loading={loading && !hasLoaded}
              tabs={STATUS_FILTERS.map(f => ({
                key: f.key, label: f.label, count: counts[f.key],
              }))}
              activeTab={status}
              onTabChange={k => setStatus(k as StatusKey)}
              searchable
              searchValue={search}
              onSearchChange={setSearch}
              /* 0, not the default: this component already debounces at 350ms
                 before it fetches, and two debounces in series would stack. */
              searchDebounce={0}
              searchPlaceholder="Search by name, employee ID or batch…"
              fitToViewport
              minWidth={1000}
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
          </BusyOverlay>
        </Col>
      </Row>
    </div>
  );
}

/* Scoped to this page. Tokens rather than literals, so dark mode follows the
   rest of the app without a second set of rules. */
function PayrollExecutionHistoryStyles() {
  return (
    <style>{`
      .peh-scope { display: inline-flex; gap: 6px; }
      .peh-scope-btn {
        height: 32px; padding: 0 13px; border-radius: 999px; cursor: pointer;
        font-size: 12px; font-weight: 700;
        border: 1px solid var(--vz-border-color); background: var(--vz-card-bg);
        color: var(--vz-secondary-color);
      }
      .peh-scope-btn.is-active { background: #ede9fe; border-color: #c4b5fd; color: #5a3fd1; }
      [data-bs-theme="dark"] .peh-scope-btn.is-active { background: rgba(124,92,252,.20); color: #c4b5fd; }

      .peh-summary {
        border: 1px solid var(--vz-border-color); border-radius: 12px;
        overflow: hidden; background: var(--vz-card-bg);
      }
      .peh-summary-head {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 14px; background: var(--vz-light);
        font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em;
        color: var(--vz-secondary-color); border-bottom: 1px solid var(--vz-border-color);
      }
      .peh-summary-grid {
        display: grid; gap: 10px; padding: 12px 14px;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      }
      .peh-summary-card { border: 1px solid var(--vz-border-color); border-radius: 10px; padding: 9px 11px; }
      .peh-summary-label {
        font-size: 10.5px; font-weight: 800; text-transform: uppercase;
        letter-spacing: .05em; color: #5a3fd1;
      }
      [data-bs-theme="dark"] .peh-summary-label { color: #c4b5fd; }
      .peh-summary-name {
        font-size: 13px; font-weight: 700; margin-top: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .peh-summary-meta {
        display: flex; align-items: center; justify-content: space-between;
        gap: 6px; margin-top: 5px;
      }
      .peh-runs { font-size: 11px; font-weight: 700; color: var(--vz-secondary-color); }

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
