import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Col, Row } from 'reactstrap';

// ── Types ────────────────────────────────────────────────────────────────────
export interface PayrollRunActionChip {
  label: string;
  tone: 'blue' | 'green' | 'purple' | 'amber';
  /** What the chip does when clicked — drives parent navigation. */
  kind?: 'attendance' | 'employee' | 'proof';
}

export interface PayrollRunIssue {
  id: string;
  type: 'blocking' | 'warning';
  empCode: string;
  /** URL-safe encrypted employee id — preferred over empCode when opening the
   *  profile so the URL carries an opaque token, not the readable code. */
  encryptedId?: string | null;
  empName: string;
  empInitials: string;
  empAccent: string;
  department: string;
  /** Primary reason (rendered with a colored bullet); the rest collapse to
   *  "+N more reasons". */
  reasons: string[];
  /** Action chips shown under the reasons (e.g. "Go to Attendance"). */
  actions: PayrollRunActionChip[];
}

export interface PayrollRunModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires when the user confirms the final "Proceed to Pay" step on the
   *  success screen — parent decides what to do (toast + close, route, …). */
  onProceedToPay: () => void;
  /** True while the parent's async "Proceed to Pay" work (payroll approve →
   *  open disbursement) is in flight — drives the button's spinner + disabled
   *  state so it can't be double-clicked. */
  proceeding?: boolean;
  cycleLabel: string;
  totalEmployees: number;
  /** Net disbursable for the cycle (formatted by the parent — passed as a
   *  short string like "₹13.00L" so the modal doesn't have to reimplement
   *  Indian-locale shortening). */
  totalPayrollLabel: string;
  /** Pay locked behind blocking issues (display string). */
  blockedAmountLabel: string;
  /** Pay flagged but still payable (display string). */
  atRiskAmountLabel: string;
  issues: PayrollRunIssue[];
  /** Fired when an issue action chip (Go to Attendance / Open Employee /
   *  Upload Proof) is clicked — parent handles navigation. */
  onAction?: (action: PayrollRunActionChip, issue: PayrollRunIssue) => void;
  /** Fired when the success screen's "Export Payslips" button is clicked —
   *  parent downloads the cycle's payslips (ZIP). The modal stays open so the
   *  user can still proceed to pay afterwards. */
  onExportPayslips?: () => void;
  /** True while the parent's payslip export is in flight — drives the button's
   *  spinner + disabled state. */
  exporting?: boolean;
}

const ACTION_TONES: Record<PayrollRunActionChip['tone'], { bg: string; fg: string; border: string }> = {
  blue:   { bg: '#dceefe', fg: '#0c63b0', border: '#b8d6f7' },
  green:  { bg: '#d6f4e3', fg: '#108548', border: '#b6e4c8' },
  purple: { bg: '#ece6ff', fg: '#5a3fd1', border: '#d6c9ff' },
  amber:  { bg: '#fdf3d6', fg: '#a06f00', border: '#f0d990' },
};

/** Pre-flight payroll check + post-success disbursement modal.
 *
 *  Two phases live in the same component because they share a state machine:
 *  the user marks issues resolved, hits "Re-run Payroll", and only when no
 *  blocking issue is unresolved does the modal flip to the success screen.
 *  The success screen finally calls `onProceedToPay` which is where the
 *  parent fires the actual payment toast and closes the modal. */
export default function PayrollRunModal({
  open,
  onClose,
  onProceedToPay,
  proceeding = false,
  cycleLabel,
  totalEmployees,
  totalPayrollLabel,
  blockedAmountLabel,
  atRiskAmountLabel,
  issues,
  onAction,
  onExportPayslips,
  exporting = false,
}: PayrollRunModalProps) {
  const [phase, setPhase] = useState<'preflight' | 'success'>('preflight');
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [reRunError, setReRunError] = useState<string>('');

  // Reset every time the modal opens — a closed-then-reopen is a fresh run,
  // we don't want stale "resolved" state carrying over.
  useEffect(() => {
    if (open) {
      setPhase('preflight');
      setResolvedIds(new Set());
      setReRunError('');
    }
  }, [open]);

  const blocking = useMemo(() => issues.filter(i => i.type === 'blocking'), [issues]);
  const warnings = useMemo(() => issues.filter(i => i.type === 'warning'),  [issues]);

  const totalIssues       = issues.length;
  const resolvedCount     = issues.filter(i => resolvedIds.has(i.id)).length;
  const remainingCount    = totalIssues - resolvedCount;
  const blockingRemaining = blocking.filter(i => !resolvedIds.has(i.id)).length;
  const allClear          = remainingCount === 0;
  const resolvedPct       = totalIssues ? Math.round((resolvedCount / totalIssues) * 100) : 100;

  const markResolved = (id: string) => {
    setResolvedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setReRunError('');
  };

  const handleReRun = () => {
    if (blockingRemaining > 0) {
      setReRunError(`${blockingRemaining} blocking issue${blockingRemaining > 1 ? 's' : ''} must be resolved first.`);
      return;
    }
    setPhase('success');
  };

  if (!open) return null;

  // ── Common shell — backdrop + portal target ───────────────────────────────
  const shell = (children: React.ReactNode, maxWidth: number) => (
    <div
      className="ep-modal-overlay"
      /* No backdrop-click close — an accidental outside click must NOT dismiss
         the payroll run / blocked popup; only the explicit X / buttons do. */
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        className="ep-modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)',
          borderRadius: 18,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          color: 'var(--vz-body-color)',
        }}
      >
        {children}
      </div>
    </div>
  );

  // ── PHASE 1 — Pre-flight blocking + warnings ──────────────────────────────
  if (phase === 'preflight') {
    return createPortal(
      shell(
        <>
          <PayrollRunStyles />

          {/* Header */}
          <div className="prm-header">
            <div className="d-flex align-items-start gap-3 flex-grow-1">
              <span className="prm-warn-icon">
                <i className="ri-alert-fill" />
              </span>
              <div className="flex-grow-1 min-w-0">
                <h5 className="mb-1 fw-bold" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
                  Payroll Execution Blocked
                </h5>
                <div style={{ fontSize: 12 }}>
                  <span className="fw-semibold" style={{ color: '#b1401d' }}>{blocking.length} blocking issue{blocking.length === 1 ? '' : 's'} must be resolved</span>
                  <span className="text-muted"> · </span>
                  <span className="fw-semibold" style={{ color: '#a06f00' }}>{warnings.length} warning{warnings.length === 1 ? '' : 's'} detected</span>
                </div>
              </div>
              <button type="button" className="prm-close" onClick={onClose} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
          </div>

          {/* Body — scrollable */}
          <div className="prm-body">
            {/* KPI strip — 3 tiles, mirror the page's mini-tile language */}
            <Row className="g-2 mb-3">
              <Col md={4} sm={12}>
                <div className="prm-kpi prm-kpi--neutral">
                  <div className="prm-kpi-num" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{totalPayrollLabel}</div>
                  <div className="prm-kpi-label">Total Payroll</div>
                </div>
              </Col>
              <Col md={4} sm={12}>
                <div className="prm-kpi prm-kpi--red">
                  <div className="prm-kpi-num" style={{ color: '#b1401d' }}>{blockedAmountLabel}</div>
                  <div className="prm-kpi-label">Blocked Amount</div>
                </div>
              </Col>
              <Col md={4} sm={12}>
                <div className="prm-kpi prm-kpi--amber">
                  <div className="prm-kpi-num" style={{ color: '#a06f00' }}>{atRiskAmountLabel}</div>
                  <div className="prm-kpi-label">At Risk Amount</div>
                </div>
              </Col>
            </Row>

            {/* Counter pills + secondary link */}
            <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
              <span className="prm-pill prm-pill--red">
                <span className="d" style={{ background: '#f06548' }} />
                {blocking.length} Blocking
              </span>
              <span className="prm-pill prm-pill--amber">
                <span className="d" style={{ background: '#f59e0b' }} />
                {warnings.length} Warning{warnings.length === 1 ? '' : 's'}
              </span>
              <span className="text-muted" style={{ fontSize: 12 }}>{totalEmployees} employees total</span>
            </div>

            {/* Progress steps */}
            <div className="prm-progress">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="prm-step prm-step--found">
                  <span className="d" style={{ background: '#7c5cfc' }} />
                  {totalIssues} Issues Found
                </span>
                <i className="ri-arrow-right-s-line text-muted" />
                <span className={`prm-step ${remainingCount > 0 ? 'prm-step--remaining' : ''}`}>
                  <span className="d" style={{ background: remainingCount > 0 ? '#878a99' : '#cbd5e1' }} />
                  {remainingCount} Remaining
                </span>
                <i className="ri-arrow-right-s-line text-muted" />
                <span className={`prm-step ${allClear ? 'prm-step--clear' : ''}`}>
                  {allClear ? (
                    <>
                      <i className="ri-check-line me-1" />All Clear
                    </>
                  ) : (
                    <>
                      <span className="d" style={{ background: '#cbd5e1' }} />
                      {resolvedCount} Resolved
                    </>
                  )}
                </span>
                <span className="ms-auto fw-semibold" style={{ fontSize: 11.5, color: allClear ? '#108548' : 'var(--vz-secondary-color)' }}>
                  {resolvedPct}% resolved
                </span>
              </div>
              <div className="prm-progress-track mt-2">
                <div
                  className="prm-progress-fill"
                  style={{
                    width: `${resolvedPct}%`,
                    background: allClear
                      ? 'linear-gradient(90deg,#10b981,#34d399)'
                      : 'linear-gradient(90deg,#7c5cfc,#a78bfa)',
                  }}
                />
              </div>
            </div>

            {/* Blocking section */}
            {blocking.length > 0 && (
              <>
                <div className="prm-section-head mt-3">
                  <span className="d-inline-flex align-items-center gap-2">
                    <span className="d" style={{ background: '#f06548' }} />
                    <span className="fw-bold" style={{ color: '#b1401d', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Blocking Issues</span>
                    <span className="text-muted" style={{ fontSize: 11.5 }}>— payroll cannot run until resolved</span>
                  </span>
                  <span className="prm-count-chip prm-count-chip--red">{blocking.length}</span>
                </div>
                {blocking.map(i => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    resolved={resolvedIds.has(i.id)}
                    onMarkResolved={() => markResolved(i.id)}
                    onAction={onAction}
                  />
                ))}
              </>
            )}

            {/* Warnings section */}
            {warnings.length > 0 && (
              <>
                <div className="prm-section-head mt-3">
                  <span className="d-inline-flex align-items-center gap-2">
                    <span className="d" style={{ background: '#f59e0b' }} />
                    <span className="fw-bold" style={{ color: '#a06f00', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Warnings</span>
                    <span className="text-muted" style={{ fontSize: 11.5 }}>— payroll can run but review recommended</span>
                  </span>
                  <span className="prm-count-chip prm-count-chip--amber">{warnings.length}</span>
                </div>
                {warnings.map(i => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    resolved={resolvedIds.has(i.id)}
                    onMarkResolved={() => markResolved(i.id)}
                    onAction={onAction}
                  />
                ))}
              </>
            )}

            {reRunError && (
              <div className="prm-err mt-3">
                <i className="ri-error-warning-line me-1" />
                {reRunError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="prm-footer">
            <button
              type="button"
              className="prm-btn prm-btn--ghost-red"
              onClick={() => {
                // Quick "fix all" — auto-resolve every blocking issue for the
                // demo. Real implementation would route to each fix flow.
                setResolvedIds(new Set(issues.map(i => i.id)));
                setReRunError('');
              }}
            >
              <i className="ri-search-line me-1" /> Fix Issues
            </button>
            <div className="d-flex gap-2 ms-auto flex-wrap">
              <button type="button" className="prm-btn prm-btn--ghost-violet" onClick={onClose}>
                <i className="ri-layout-grid-line me-1" /> Open Execution View
              </button>
              <button
                type="button"
                className="prm-btn prm-btn--dark"
                onClick={handleReRun}
                disabled={blockingRemaining > 0}
                style={blockingRemaining > 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                <i className="ri-play-circle-line me-1" /> Re-run Payroll
              </button>
            </div>
          </div>
        </>,
        720,
      ),
      document.body,
    );
  }

  // ── PHASE 2 — Success / proceed-to-pay ────────────────────────────────────
  return createPortal(
    shell(
      <>
        <PayrollRunStyles />

        {/* Green hero */}
        <div className="prm-success-hero">
          <span className="prm-success-check">
            <i className="ri-check-line" />
          </span>
          <h4 className="text-white fw-bold mb-1 mt-2" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
            Payroll Processed Successfully
          </h4>
          <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
            All issues resolved · {cycleLabel} payroll is ready for payment
          </small>
          <button type="button" className="prm-success-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="prm-success-body">
          {/* Issue resolution recap */}
          <div className="prm-success-recap">
            <div className="prm-success-recap-label">Issue Resolution</div>
            <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
              <span className="prm-step">
                <span className="d" style={{ background: '#cbd5e1' }} />
                {totalIssues} Issues Found
              </span>
              <i className="ri-arrow-right-s-line text-muted" />
              <span className="prm-step">
                <span className="d" style={{ background: '#cbd5e1' }} />
                0 Remaining
              </span>
              <i className="ri-arrow-right-s-line text-muted" />
              <span className="prm-step prm-step--clear">
                <i className="ri-check-line me-1" />All Clear
              </span>
            </div>
            <div className="prm-progress-track mt-2">
              <div
                className="prm-progress-fill"
                style={{ width: '100%', background: 'linear-gradient(90deg,#10b981,#34d399)' }}
              />
            </div>
          </div>

          {/* 3 stats */}
          <Row className="g-2 mt-3 text-center">
            <Col xs={4}>
              <div className="prm-success-stat">
                <h3 className="mb-0 fw-bold" style={{ fontSize: 26, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{totalEmployees}</h3>
                <div className="prm-success-stat-label">TOTAL</div>
                <div className="prm-success-stat-sub">employees</div>
              </div>
            </Col>
            <Col xs={4}>
              <div className="prm-success-stat">
                <h3 className="mb-0 fw-bold" style={{ fontSize: 26, color: '#108548' }}>{totalEmployees}</h3>
                <div className="prm-success-stat-label" style={{ color: '#108548' }}>PROCESSED</div>
                <div className="prm-success-stat-sub">eligible for pay</div>
              </div>
            </Col>
            <Col xs={4}>
              <div className="prm-success-stat">
                <h3 className="mb-0 fw-bold" style={{ fontSize: 26, color: 'var(--vz-secondary-color)' }}>0</h3>
                <div className="prm-success-stat-label">ON HOLD</div>
                <div className="prm-success-stat-sub">excluded</div>
              </div>
            </Col>
          </Row>

          {/* Net payable */}
          <div className="d-flex align-items-center justify-content-between mt-3 mb-3">
            <span className="text-muted" style={{ fontSize: 13 }}>Total Net Payable (eligible employees)</span>
            <span className="fw-bold" style={{ fontSize: 22, color: '#108548' }}>{totalPayrollLabel}</span>
          </div>

          {/* Primary CTA */}
          <button type="button" className="prm-pay-cta" onClick={onProceedToPay} disabled={proceeding} style={proceeding ? { opacity: 0.75, cursor: 'wait' } : undefined}>
            {proceeding ? (
              <><i className="ri-loader-4-line me-2" style={{ animation: 'spin 1s linear infinite' }} />Processing…</>
            ) : (
              <><i className="ri-bank-card-line me-2" />Proceed to Pay <i className="ri-arrow-right-s-line ms-1" /></>
            )}
          </button>

          {/* Secondary actions */}
          <div className="d-flex gap-2 mt-2">
            <button
              type="button"
              className="prm-btn prm-btn--ghost flex-grow-1"
              onClick={() => onExportPayslips?.()}
              disabled={exporting || !onExportPayslips}
              style={exporting ? { opacity: 0.75, cursor: 'wait' } : undefined}
            >
              {exporting ? (
                <><i className="ri-loader-4-line me-1" style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
              ) : (
                <><i className="ri-download-2-line me-1" /> Export Payslips</>
              )}
            </button>
            <button type="button" className="prm-btn prm-btn--ghost flex-grow-1" onClick={onClose}>
              <i className="ri-file-list-3-line me-1" /> View Payroll Details
            </button>
          </div>
        </div>
      </>,
      460,
    ),
    document.body,
  );
}

// ── Issue card — used for both blocking + warning ──────────────────────────
function IssueCard({
  issue,
  resolved,
  onMarkResolved,
  onAction,
}: {
  issue: PayrollRunIssue;
  resolved: boolean;
  onMarkResolved: () => void;
  onAction?: (action: PayrollRunActionChip, issue: PayrollRunIssue) => void;
}) {
  const isBlocking = issue.type === 'blocking';
  const tone = isBlocking
    ? { bg: '#fde7e3', fg: '#b1401d', dot: '#f06548' }
    : { bg: '#fdf3d6', fg: '#a06f00', dot: '#f59e0b' };
  // Expand the full list of remaining reasons when the "+N more" text is
  // clicked (and a native title shows them on hover too).
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const extraReasons = issue.reasons.slice(1);

  return (
    <div className={`prm-issue${resolved ? ' is-resolved' : ''}`}>
      <div className="d-flex align-items-start gap-2">
        <div
          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
          style={{
            width: 32, height: 32, fontSize: 11,
            background: `linear-gradient(135deg, ${issue.empAccent}, ${issue.empAccent}cc)`,
            boxShadow: `0 2px 6px ${issue.empAccent}40`,
          }}
        >
          {issue.empInitials}
        </div>
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="fw-bold" style={{ fontSize: 13 }}>{issue.empName}</span>
            <span className="prm-emp-pill">{issue.empCode}</span>
            <span className="text-muted" style={{ fontSize: 12 }}>{issue.department}</span>
          </div>
          <div className="d-flex align-items-center gap-2 mt-1">
            <span className="d" style={{ width: 5, height: 5, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} />
            <span style={{ fontSize: 12 }}>{issue.reasons[0]}</span>
            {extraReasons.length > 0 && (
              <button
                type="button"
                onClick={() => setReasonsOpen(o => !o)}
                title={extraReasons.join('\n')}
                aria-expanded={reasonsOpen}
                className="text-muted"
                style={{ fontSize: 11.5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline dotted' }}
              >
                +{extraReasons.length} more reason{extraReasons.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
          {reasonsOpen && extraReasons.length > 0 && (
            <ul className="mt-1 mb-0" style={{ fontSize: 11.5, color: tone.fg, paddingLeft: 18 }}>
              {extraReasons.map((reason, i) => (
                <li key={i} style={{ marginTop: 2 }}>{reason}</li>
              ))}
            </ul>
          )}
          {issue.actions.length > 0 && (
            <div className="d-flex gap-2 mt-2 flex-wrap">
              {issue.actions.map(a => {
                const t = ACTION_TONES[a.tone];
                return (
                  <button
                    key={a.label}
                    type="button"
                    className="prm-action-chip"
                    data-tone={a.tone}
                    onClick={() => onAction?.(a, issue)}
                    style={{ background: t.bg, color: t.fg, borderColor: t.border, cursor: 'pointer' }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="d-flex flex-column align-items-end gap-2 flex-shrink-0">
          {resolved ? (
            <span className="prm-pill prm-pill--green">
              <i className="ri-check-line me-1" />Resolved
            </span>
          ) : (
            <span
              className="prm-pill"
              style={{ background: tone.bg, color: tone.fg, fontSize: 10.5 }}
            >
              <i className={isBlocking ? 'ri-forbid-2-line me-1' : 'ri-alert-line me-1'} />
              {isBlocking ? 'Blocking' : 'Warning'}
            </span>
          )}
          <button
            type="button"
            className="prm-resolve-btn"
            onClick={onMarkResolved}
            disabled={resolved}
            style={resolved ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Mark Resolved
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles — scoped to the modal, dark-mode aware ──────────────────────────
function PayrollRunStyles() {
  return (
    <style>{`
      .prm-header {
        padding: 16px 18px;
        border-bottom: 1px solid var(--vz-border-color);
        background: var(--vz-card-bg);
      }
      .prm-warn-icon {
        width: 36px; height: 36px; border-radius: 9px;
        background: #fde7e3; color: #b1401d;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0;
      }
      [data-bs-theme="dark"] .prm-warn-icon { background: rgba(177,64,29,0.20); color: #fda192; }
      .prm-close {
        width: 28px; height: 28px; border-radius: 7px;
        background: transparent; border: none;
        color: var(--vz-secondary-color); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      .prm-close:hover { background: var(--vz-light); color: var(--vz-body-color); }

      .prm-body {
        padding: 16px 18px;
        overflow-y: auto;
        background: var(--vz-secondary-bg);
      }
      [data-bs-theme="dark"] .prm-body { background: var(--vz-secondary-bg); }

      /* KPI tiles inside the modal */
      .prm-kpi {
        border-radius: 10px;
        padding: 12px 14px;
        border: 1px solid var(--vz-border-color);
        background: var(--vz-card-bg);
        height: 100%;
      }
      .prm-kpi--red    { background: #fde7e3; border-color: #f5c0b5; }
      .prm-kpi--amber  { background: #fdf3d6; border-color: #f0d990; }
      [data-bs-theme="dark"] .prm-kpi--red   { background: rgba(177,64,29,0.18); border-color: rgba(240,101,72,0.38); }
      [data-bs-theme="dark"] .prm-kpi--amber { background: rgba(160,111,0,0.18); border-color: rgba(245,158,11,0.38); }
      .prm-kpi-num    { font-size: 18px; font-weight: 800; line-height: 1; }
      .prm-kpi-label  {
        margin-top: 4px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; color: var(--vz-secondary-color);
      }

      /* Generic pill */
      .prm-pill {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 10px; border-radius: 999px;
        font-size: 11px; font-weight: 700;
      }
      .prm-pill .d { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
      .prm-pill--red    { background: #fde7e3; color: #b1401d; }
      .prm-pill--amber  { background: #fdf3d6; color: #a06f00; }
      .prm-pill--green  { background: #d6f4e3; color: #108548; }
      .prm-pill--violet { background: #ece6ff; color: #5a3fd1; }
      [data-bs-theme="dark"] .prm-pill--red    { background: rgba(177,64,29,0.22); color: #fda192; }
      [data-bs-theme="dark"] .prm-pill--amber  { background: rgba(160,111,0,0.22); color: #fcd34d; }
      [data-bs-theme="dark"] .prm-pill--green  { background: rgba(16,133,72,0.22); color: #6ee7b7; }
      [data-bs-theme="dark"] .prm-pill--violet { background: rgba(90,63,209,0.22); color: #c4b5fd; }

      /* Action chips (Go to Attendance / Open Employee) — the inline tone
         colours are light pastels; repaint them as translucent accent chips
         in dark mode so they don't render as bright chips on the dark surface. */
      [data-bs-theme="dark"] .prm-action-chip[data-tone="blue"]   { background: rgba(59,130,246,0.18) !important; color: #93c5fd !important; border-color: rgba(59,130,246,0.38) !important; }
      [data-bs-theme="dark"] .prm-action-chip[data-tone="green"]  { background: rgba(16,185,129,0.18) !important; color: #6ee7b7 !important; border-color: rgba(16,185,129,0.38) !important; }
      [data-bs-theme="dark"] .prm-action-chip[data-tone="purple"] { background: rgba(124,92,252,0.18) !important; color: #c4b5fd !important; border-color: rgba(124,92,252,0.38) !important; }
      [data-bs-theme="dark"] .prm-action-chip[data-tone="amber"]  { background: rgba(245,158,11,0.18) !important; color: #fcd34d !important; border-color: rgba(245,158,11,0.38) !important; }

      /* Progress steps */
      .prm-progress {
        background: var(--vz-card-bg);
        border: 1px solid var(--vz-border-color);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .prm-step {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 3px 10px; border-radius: 999px;
        background: var(--vz-light); color: var(--vz-secondary-color);
        font-size: 11px; font-weight: 600;
      }
      .prm-step .d { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
      .prm-step--found     { background: #ece6ff; color: #5a3fd1; }
      .prm-step--remaining { background: var(--vz-light); color: var(--vz-body-color); }
      .prm-step--clear     { background: #d6f4e3; color: #108548; }
      [data-bs-theme="dark"] .prm-step--found { background: rgba(124,92,252,0.22); color: #c4b5fd; }
      [data-bs-theme="dark"] .prm-step--clear { background: rgba(16,133,72,0.22); color: #6ee7b7; }

      .prm-progress-track {
        width: 100%; height: 5px; border-radius: 999px;
        background: var(--vz-light); overflow: hidden;
      }
      [data-bs-theme="dark"] .prm-progress-track { background: rgba(255,255,255,0.06); }
      .prm-progress-fill { height: 100%; border-radius: 999px; transition: width .25s ease; }

      /* Section header */
      .prm-section-head {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 8px; gap: 8px; flex-wrap: wrap;
      }
      .prm-section-head .d { width: 6px; height: 6px; border-radius: 50%; }
      .prm-count-chip {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 22px; height: 22px; padding: 0 7px;
        border-radius: 999px;
        font-size: 11px; font-weight: 800;
      }
      .prm-count-chip--red   { background: #fde7e3; color: #b1401d; }
      .prm-count-chip--amber { background: #fdf3d6; color: #a06f00; }
      [data-bs-theme="dark"] .prm-count-chip--red   { background: rgba(177,64,29,0.22); color: #fda192; }
      [data-bs-theme="dark"] .prm-count-chip--amber { background: rgba(160,111,0,0.22); color: #fcd34d; }

      /* Issue card */
      .prm-issue {
        background: var(--vz-card-bg);
        border: 1px solid var(--vz-border-color);
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 8px;
        transition: opacity .2s ease;
      }
      .prm-issue.is-resolved {
        opacity: 0.65;
        border-color: rgba(16,179,108,0.40);
        background: rgba(16,179,108,0.04);
      }
      [data-bs-theme="dark"] .prm-issue.is-resolved {
        background: rgba(16,179,108,0.10);
        border-color: rgba(16,179,108,0.32);
      }
      .prm-emp-pill {
        display: inline-flex; align-items: center;
        padding: 2px 8px; border-radius: 999px;
        background: var(--vz-light);
        color: var(--vz-secondary-color);
        font-family: var(--vz-font-monospace, monospace);
        font-weight: 700; font-size: 10.5px; letter-spacing: 0.02em;
      }
      [data-bs-theme="dark"] .prm-emp-pill { background: rgba(255,255,255,0.06); }

      .prm-action-chip {
        display: inline-flex; align-items: center;
        padding: 4px 10px; border-radius: 999px;
        border: 1px solid;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
      }

      .prm-resolve-btn {
        background: var(--vz-card-bg);
        color: var(--vz-body-color);
        border: 1px solid var(--vz-border-color);
        border-radius: 7px;
        padding: 4px 10px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        transition: all .15s ease;
        white-space: nowrap;
      }
      .prm-resolve-btn:hover:not(:disabled) {
        border-color: #10b981; color: #108548; background: rgba(16,179,108,0.06);
      }

      /* Error banner under issue lists */
      .prm-err {
        padding: 8px 12px; border-radius: 8px;
        background: #fde7e3; color: #b1401d;
        border: 1px solid #f5c0b5;
        font-size: 12px; font-weight: 600;
      }
      [data-bs-theme="dark"] .prm-err {
        background: rgba(177,64,29,0.18);
        color: #fda192;
        border-color: rgba(240,101,72,0.38);
      }

      /* Footer */
      .prm-footer {
        padding: 12px 18px;
        border-top: 1px solid var(--vz-border-color);
        background: var(--vz-card-bg);
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      }

      .prm-btn {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 8px 14px; border-radius: 8px;
        font-size: 12.5px; font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
        background: transparent;
        color: var(--vz-body-color);
        transition: all .15s ease;
      }
      .prm-btn--ghost-red {
        border-color: #f5c0b5; color: #b1401d; background: var(--vz-card-bg);
      }
      .prm-btn--ghost-red:hover { background: rgba(240,101,72,0.08); }
      .prm-btn--ghost-violet {
        border-color: #d6c9ff; color: #5a3fd1; background: var(--vz-card-bg);
      }
      .prm-btn--ghost-violet:hover { background: rgba(124,92,252,0.08); }
      .prm-btn--ghost {
        border-color: var(--vz-border-color); color: var(--vz-body-color); background: var(--vz-card-bg);
      }
      .prm-btn--ghost:hover { background: var(--vz-light); }
      .prm-btn--dark {
        background: linear-gradient(135deg,#1f2937,#0f172a);
        color: #fff; border-color: transparent;
        box-shadow: 0 6px 14px rgba(15,23,42,0.30);
      }
      .prm-btn--dark:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 10px 18px rgba(15,23,42,0.36);
      }
      [data-bs-theme="dark"] .prm-btn--ghost-red    { background: var(--vz-card-bg); border-color: rgba(240,101,72,0.38); color: #fda192; }
      [data-bs-theme="dark"] .prm-btn--ghost-violet { background: var(--vz-card-bg); border-color: rgba(124,92,252,0.38); color: #c4b5fd; }

      /* Success hero */
      .prm-success-hero {
        position: relative;
        padding: 28px 24px 22px;
        text-align: center;
        background: linear-gradient(135deg,#064e3b 0%,#047857 50%,#10b981 100%);
        color: #fff;
      }
      .prm-success-check {
        display: inline-flex; align-items: center; justify-content: center;
        width: 52px; height: 52px; border-radius: 50%;
        background: rgba(255,255,255,0.18);
        border: 2px solid rgba(255,255,255,0.40);
        color: #fff; font-size: 28px;
      }
      .prm-success-close {
        position: absolute; top: 12px; right: 12px;
        width: 28px; height: 28px; border-radius: 7px;
        background: rgba(255,255,255,0.16); border: none; color: #fff;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        font-size: 14px;
      }
      .prm-success-close:hover { background: rgba(255,255,255,0.28); }

      .prm-success-body { padding: 16px 20px 18px; background: var(--vz-card-bg); }
      .prm-success-recap {
        background: var(--vz-secondary-bg);
        border: 1px solid var(--vz-border-color);
        border-radius: 10px;
        padding: 12px 14px;
      }
      .prm-success-recap-label {
        font-size: 10px; font-weight: 700; letter-spacing: 0.10em;
        text-transform: uppercase; color: var(--vz-secondary-color);
      }

      .prm-success-stat-label {
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; color: var(--vz-secondary-color);
        margin-top: 2px;
      }
      .prm-success-stat-sub { font-size: 10.5px; color: var(--vz-secondary-color); }

      .prm-pay-cta {
        width: 100%;
        padding: 12px 16px;
        border: none; border-radius: 10px;
        background: linear-gradient(135deg,#064e3b 0%,#047857 50%,#10b981 100%);
        color: #fff; font-size: 14px; font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(4,120,87,0.32);
        display: inline-flex; align-items: center; justify-content: center;
        transition: all .15s ease;
      }
      .prm-pay-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(4,120,87,0.40); }
    `}</style>
  );
}
