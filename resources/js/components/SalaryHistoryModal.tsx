import { useEffect, useMemo, useState } from 'react';
import { Modal, Spinner } from 'reactstrap';
import api from '../api';
import { SalaryModalStyles, type SalaryEmployeeLite } from './SalaryStructureModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Salary revision history — every version an employee has had, with the
 * breakup that was in force under each.
 *
 * WHY THIS EXISTS
 * Payroll resolves a month against the version whose effective_from had
 * arrived (PayrollService::activeStructure), so "what was this person paid in
 * July, and why" is a question about a PAST version. Before this, the only
 * thing on screen was the CURRENT structure — a payslip that disagreed with it
 * looked like a payroll bug rather than a revision that happened in between.
 *
 * Read-only by design. Revising is the Revise button's job; this is the audit
 * trail beside it, and a history panel that could edit history would not be one.
 *
 * Data comes from GET /salary-structures?employee_id= — which already returns
 * every version with its earnings, deductions, statutory flags and note, so
 * this needed no new endpoint.
 * ───────────────────────────────────────────────────────────────────────── */

type Line = { label?: string; name?: string; code?: string; amount?: number | string };

type Version = {
  id: number;
  version: number;
  effective_from: string | null;
  status: string;
  earnings: Line[];
  deductions: Line[];
  monthly_gross: number;
  monthly_ctc: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
  pt_applicable: boolean;
  revision_note: string | null;
  created_at: string | null;
};

/* Reuses the roster's own employee shape rather than declaring a parallel one.
   The roster keys employees by `employee_id`, not `id` — a local type would
   have compiled against the wrong field and fetched nothing. */
type Props = {
  open: boolean;
  onClose: () => void;
  employee: SalaryEmployeeLite | null;
};

const inr = (n: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Annual CTC carries no paise. (CBC #35)
 *
 * It is not a figure anyone is paid — it is the agreed package, and it was
 * being PRINTED as monthly_ctc x 12 to two decimals. A monthly amount is the
 * CTC divided by twelve and stored to the paisa, so twelfths that do not
 * divide cleanly came back a few paise short of the package they came from:
 * a configured ₹4,00,000 is ₹33,333.33 a month, and ₹33,333.33 x 12 prints
 * ₹3,99,999.96. Nothing was mis-stored; the reader was simply shown the
 * round trip instead of the agreed number, and it disagreed with the
 * Compensation card (which has always rounded to the rupee) by four paise.
 *
 * Whole rupees here, matching EmployeeProfile's Current Compensation. The
 * paise stay where they are earned — monthly gross, and every payroll
 * column, which must reconcile by eye. */
const inrWhole = (n: number) =>
  '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const longDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** The day before `d` — a version runs UP TO the day its successor starts, not
 *  up to the successor's own date, or the two windows would overlap by a day. */
const dayBefore = (d?: string | null) => {
  if (!d) return null;
  const x = new Date(d);
  x.setDate(x.getDate() - 1);
  return x.toISOString().slice(0, 10);
};

const lineLabel = (l: Line, i: number) => l.label || l.name || l.code || `Component ${i + 1}`;
const lineAmount = (l: Line) => Number(l.amount ?? 0);

export default function SalaryHistoryModal({ open, onClose, employee }: Props) {
  const [rows, setRows] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Which version bodies are expanded. The current one opens by default. */
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || !employee?.employee_id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/salary-structures', { params: { employee_id: employee.employee_id } })
      .then(res => {
        if (cancelled) return;
        const list: Version[] = Array.isArray(res.data?.data) ? res.data.data : [];
        /* Newest first, by effective date then version. NOT by id: a
           back-dated revision gets a higher id than the version it precedes, so
           id order would put it in the wrong place in the timeline. */
        list.sort((a, b) => {
          const ad = a.effective_from || '', bd = b.effective_from || '';
          if (ad !== bd) return ad < bd ? 1 : -1;
          return (b.version || 0) - (a.version || 0);
        });
        setRows(list);
        /* Open the version payroll is CURRENTLY using — the answer to most
           visits. Falls back to the newest row when no version carries the
           'active' flag, which is what an employee on a single v1 looks like:
           that one is the applicable version and opens by default. */
        const current = list.find(v => v.status === 'active') ?? list[0];
        setOpenIds(new Set(current ? [current.id] : []));
      })
      .catch(() => { if (!cancelled) setError('Could not load the revision history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, employee?.employee_id]);

  /* Each version is applicable until the NEXT one starts. Computed from the
     sorted list rather than stored, so it stays correct if a version is added
     or its date moves. The newest has no successor — it runs to "present". */
  const windows = useMemo(() => {
    const m = new Map<number, string | null>();
    rows.forEach((v, i) => {
      const next = rows[i - 1];                  // rows are newest-first
      m.set(v.id, next ? dayBefore(next.effective_from) : null);
    });
    return m;
  }, [rows]);

  const toggle = (id: number) =>
    setOpenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /* Same initials treatment the Revise modal uses, so the two headers read as
     one family rather than two designs. */
  const initials = (employee?.name || '?')
    .split(' ').filter(Boolean).slice(0, 2)
    .map(w => w.charAt(0).toUpperCase()).join('') || '?';

  return (
    <Modal isOpen={open} toggle={onClose} centered className="shm-modal" contentClassName="ssm-card">
      <SalaryModalStyles />
      <HistoryStyles />

      <div className="ssm-shell">
        <div className="ssm-hero">
          <div className="ssm-hero-glow" />
          <div className="ssm-hero-main">
            <span className="ssm-avatar">{initials}</span>
            <div className="ssm-hero-text">
              <h5 className="ssm-title">
                Salary Revision History
                <span className="ssm-title-sep">—</span>
                <span className="ssm-title-emp">{employee?.name}</span>
              </h5>
              <div className="ssm-chips">
                {employee?.emp_code && <span className="ssm-chip">{employee.emp_code}</span>}
                {employee?.department && <span className="ssm-chip">{employee.department}</span>}
                {rows.length > 0 && (
                  <span className="ssm-chip ssm-chip--solid">
                    {rows.length} version{rows.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button type="button" className="ssm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* The ONLY scroll region, and deliberately short: tall enough for the
            open current version plus the next card, so the list reads as "there
            is more below" instead of running off the bottom of the screen. */}
        <div className="ssm-body shm-body">
        {loading && (
          <div className="text-center py-5">
            <Spinner size="sm" /> <span className="ms-2 text-muted" style={{ fontSize: 12.5 }}>Loading history…</span>
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-5 text-danger" style={{ fontSize: 12.5 }}>{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-5 text-muted" style={{ fontSize: 12.5 }}>
            No salary structure has been set for this employee yet.
          </div>
        )}

        {!loading && !error && rows.map((v, i) => {
          const isOpen    = openIds.has(v.id);
          const isCurrent = v.status === 'active';
          /* rows are newest-first, so the LAST entry is the OLDEST version —
             the rail must not draw a connector below it. */
          const isLast    = i === rows.length - 1;
          const until     = windows.get(v.id) ?? null;
          const statutory = [
            v.pf_applicable  ? 'PF'               : null,
            v.esi_applicable ? 'ESI'              : null,
            v.pt_applicable  ? 'Professional Tax' : null,
          ].filter(Boolean) as string[];
          const totalDeductions = (v.deductions || []).reduce((s, l) => s + lineAmount(l), 0);

          return (
            <div key={v.id} className="d-flex" style={{ gap: 14 }}>
              {/* ── Timeline rail ──
                  A vertical line with a node per version, so the sequence reads
                  as one story rather than a stack of unrelated cards. The line
                  is drawn on the rail, not between cards, so it stays continuous
                  whatever height an expanded body takes. */}
              <div className="d-flex flex-column align-items-center flex-shrink-0" style={{ width: 22 }}>
                <span
                  style={{
                    width: 11, height: 11, borderRadius: '50%', marginTop: 17,
                    background: isCurrent ? 'var(--vz-success)' : 'var(--vz-border-color)',
                    boxShadow: isCurrent ? '0 0 0 3px rgba(var(--vz-success-rgb), .18)' : 'none',
                    flexShrink: 0,
                  }}
                />
                {!isLast && <span style={{ flex: 1, width: 2, background: 'var(--vz-border-color)', marginTop: 4 }} />}
              </div>

              <div
                className="mb-3 flex-grow-1"
                style={{
                  border: `1px solid ${isCurrent ? 'var(--vz-success)' : 'var(--vz-border-color)'}`,
                  borderRadius: 12,
                  background: 'var(--vz-card-bg)',
                  overflow: 'hidden',
                  minWidth: 0,
                }}
              >
                {/* ── Header: the applicability window, which is the whole point ── */}
                <button
                  type="button"
                  onClick={() => toggle(v.id)}
                  className="w-100 d-flex align-items-center gap-2 text-start flex-wrap"
                  style={{
                    padding: '11px 14px',
                    background: isCurrent ? 'rgba(var(--vz-success-rgb), .06)' : 'transparent',
                    border: 0, cursor: 'pointer',
                  }}
                >
                  <i className={`ri-arrow-${isOpen ? 'down' : 'right'}-s-line`} style={{ fontSize: 16, opacity: .7 }} />
                  <span className="fw-bold" style={{ fontSize: 13 }}>Version {v.version}</span>

                  {isCurrent
                    ? <span className="badge bg-success-subtle text-success" style={{ fontSize: 9.5, letterSpacing: '.04em' }}>CURRENT</span>
                    : <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: 9.5, letterSpacing: '.04em' }}>SUPERSEDED</span>}

                  {/* "Applicable from X to Y" — a payslip that disagrees with the
                      current breakup is explained by reading this one line. */}
                  <span className="text-muted" style={{ fontSize: 11.5 }}>
                    Applicable from <strong>{longDate(v.effective_from)}</strong>
                    {until ? <> to <strong>{longDate(until)}</strong></> : <> onwards</>}
                  </span>

                  <span className="ms-auto fw-bold" style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>{inr(v.monthly_gross)}</span>
                  <span className="text-muted" style={{ fontSize: 10.5 }}>/mo</span>
                </button>

              {isOpen && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--vz-border-color)' }}>
                  {/* ── Summary strip ── */}
                  <div className="d-flex flex-wrap gap-4 py-3">
                    <div>
                      <div className="text-muted" style={{ fontSize: 10, letterSpacing: '.05em' }}>ANNUAL CTC</div>
                      {/* The CURRENT version shows the package actually
                          configured on the employee, not a figure re-derived
                          from the monthly amount — same number the Revise
                          Salary form opens with, so the two cannot disagree.
                          Superseded versions have no stored annual of their
                          own (the column lives on the employee, and it moves
                          with each revision), so those stay derived. */}
                      <div className="fw-bold" style={{ fontSize: 14 }}>
                        {inrWhole(
                          isCurrent && Number(employee?.annual_salary) > 0
                            ? Number(employee?.annual_salary)
                            : v.monthly_ctc * 12,
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10, letterSpacing: '.05em' }}>MONTHLY GROSS</div>
                      <div className="fw-bold" style={{ fontSize: 14 }}>{inr(v.monthly_gross)}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10, letterSpacing: '.05em' }}>EFFECTIVE FROM</div>
                      <div className="fw-bold" style={{ fontSize: 14 }}>{longDate(v.effective_from)}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 10, letterSpacing: '.05em' }}>STATUTORY</div>
                      <div className="fw-bold" style={{ fontSize: 13 }}>
                        {statutory.length ? statutory.join(' · ') : <span className="text-muted">None</span>}
                      </div>
                    </div>
                  </div>

                  {/* ── Breakup ── */}
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="fw-bold text-success mb-2" style={{ fontSize: 11, letterSpacing: '.05em' }}>EARNINGS</div>
                      {(v.earnings || []).length === 0
                        ? <div className="text-muted" style={{ fontSize: 12 }}>No components</div>
                        : (v.earnings || []).map((l, i) => (
                          <div key={i} className="d-flex justify-content-between py-1" style={{ fontSize: 12.5, borderBottom: '1px dashed var(--vz-border-color)' }}>
                            <span>{lineLabel(l, i)}</span>
                            <span className="fw-semibold">{inr(lineAmount(l))}</span>
                          </div>
                        ))}
                    </div>

                    <div className="col-md-6">
                      <div className="fw-bold text-danger mb-2" style={{ fontSize: 11, letterSpacing: '.05em' }}>FIXED DEDUCTIONS</div>
                      {(v.deductions || []).length === 0
                        ? <div className="text-muted" style={{ fontSize: 12 }}>None configured</div>
                        : (v.deductions || []).map((l, i) => (
                          <div key={i} className="d-flex justify-content-between py-1" style={{ fontSize: 12.5, borderBottom: '1px dashed var(--vz-border-color)' }}>
                            <span>{lineLabel(l, i)}</span>
                            <span className="fw-semibold">{inr(lineAmount(l))}</span>
                          </div>
                        ))}
                      {totalDeductions > 0 && (
                        <div className="d-flex justify-content-between pt-2 fw-bold" style={{ fontSize: 12.5 }}>
                          <span>Total</span><span>{inr(totalDeductions)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {(v.revision_note || v.created_at) && (
                    <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--vz-border-color)', fontSize: 11.5 }}>
                      {v.revision_note && <div className="mb-1"><span className="text-muted">Note: </span>{v.revision_note}</div>}
                      {v.created_at && (
                        <div className="text-muted">
                          Recorded {new Date(v.created_at).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </Modal>
  );
}

/* Only what the Revise modal's stylesheet does not already give us: the
   narrower dialog, and the short scroll window that is the whole point of the
   list — about two version cards deep, so the rest is visibly scrollable rather
   than a wall of identical panels. */
function HistoryStyles() {
  return (
    <style>{`
      .shm-modal { max-width: 720px; }
      .shm-body {
        /* Two cards' worth. vh keeps it honest on short laptop screens, where a
           fixed 460px would have pushed the dialog past the viewport. */
        max-height: min(58vh, 460px);
        padding-bottom: 6px;
      }
      .shm-body::-webkit-scrollbar { width: 8px; }
      .shm-body::-webkit-scrollbar-thumb {
        background: var(--vz-border-color); border-radius: 8px;
      }
      .shm-body::-webkit-scrollbar-thumb:hover { background: var(--vz-secondary-color); }
    `}</style>
  );
}
