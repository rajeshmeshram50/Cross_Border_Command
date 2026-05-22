import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 1: Inquiry Received  (read-only display)
 *
 * Pure presentation. Renders the captured opportunity details + the
 * Purchase-Decision-Maker block sourced from `header.taskManager`. The
 * editable form lives in the right-side TaskManagerPanel; that panel
 * calls back to SalesMatrixDetail which refreshes the lead row, which
 * cascades fresh values down here as props.
 *
 * Read-only by design — there are no save/next buttons in this stage
 * itself. Advancing to Stage 2 is driven by the page-level stepper.
 * ───────────────────────────────────────────────────────────────────────── */

export default function Stage1InquiryReceived({ header, onNext }: StageProps) {
  const tm = header.taskManager ?? null;

  const orderValue = tm?.order_value != null
    ? formatINR(Number(tm.order_value))
    : '—';
  const buyingPlanDate = tm?.buying_plan
    ? new Date(tm.buying_plan).toLocaleDateString('en-GB')
    : '—';

  const dmName   = tm?.name      ?? '—';
  const dmMobile = tm?.mobile_no ?? '—';
  const dmEmail  = tm?.email     ?? '—';

  const status: 'qualified' | 'disqualified' | 'pending' =
    header.disqualified ? 'disqualified' : (header.qualified ? 'qualified' : 'pending');

  return (
    <>
      <style>{SHARED_STAGE_CSS}</style>
      <style>{STAGE1_CSS}</style>

      {/* Stage header */}
      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 1: Inquiry Received</div>
            <div className="smd-stg-head-sub">● Lead inquiry captured and logged</div>
          </div>
        </div>
        <span className={`smd-stg-head-badge s1-badge s1-badge-${status}`}>
          <span className="s1-badge-dot" />
          {status === 'qualified'    && 'QUALIFIED'}
          {status === 'disqualified' && 'DISQUALIFIED'}
          {status === 'pending'      && 'PENDING'}
        </span>
      </div>

      <div className="smd-stg-body">
        {/* Opportunity Details — driven by lead + task_manager.order_value/buying_plan */}
        <div className="smd-sect">
          <div className="smd-sect-head">
            <div className="smd-sect-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div className="smd-sect-title">Opportunity Details</div>
          </div>
          <div className="smd-sect-grid">
            <Cell label="OPPORTUNITY ID"   value={header.oppId} />
            <Cell label="OPPORTUNITY DATE" value={header.oppDate} />
            <Cell label="CUSTOMER NAME"    value={header.customer} />
            <Cell label="BUYING PLAN"      value={buyingPlanDate} muted={buyingPlanDate === '—'} />
          </div>
          <div className="s1-grid-1">
            <Cell label="ORDER VALUE" value={orderValue} muted={orderValue === '—'} />
          </div>
        </div>

        {/* Purchase Decision Maker — driven by task_manager.name/mobile_no/email */}
        <div className="smd-sect">
          <div className="smd-sect-head">
            <div className="smd-sect-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="smd-sect-title">Purchase Decision Maker</div>
          </div>
          <div className="smd-sect-grid">
            <Cell label="NAME"          value={dmName}   muted={dmName   === '—'} />
            <Cell label="MOBILE NUMBER" value={dmMobile} muted={dmMobile === '—'} />
          </div>
          <div className="s1-grid-1">
            <Cell label="EMAIL" value={dmEmail} muted={dmEmail === '—'} />
          </div>
        </div>

        {/* Hint: data flows from the right-side Task Manager panel */}
        {!tm && (
          <div className="s1-empty-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            <span>
              No Purchase Decision Maker captured yet —
              fill the <strong>Task Manager</strong> panel on the right to populate this section.
            </span>
          </div>
        )}
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Fill in the Purchase Decision Maker details to proceed to the next stage.
        </div>
        <button
          type="button"
          className="smd-stg-btn smd-stg-btn-primary"
          onClick={onNext}
          disabled={!tm?.name || !tm?.mobile_no || !tm?.email}
        >
          Save &amp; Next →
        </button>
      </div>
    </>
  );
}

function Cell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="smd-sect-field">
      <div className="smd-sect-label">{label}</div>
      <div className={muted ? 'smd-sect-value-muted' : 'smd-sect-value'}>{value}</div>
    </div>
  );
}

/* INR with the Indian numbering convention (lakhs/crores) — matches the
 * mockup "₹7,00,000" rather than "₹700,000". */
function formatINR(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const STAGE1_CSS = `
/* Single full-width row that visually continues the .smd-sect-grid above
 * it — same cell tinting, same horizontal divider, no side gutter. The
 * wrapper gets its own border so the row reads as a self-contained
 * rounded card (matches the bordered .smd-sect-grid above it). */
.s1-grid-1 {
  display: grid; grid-template-columns: 1fr; gap: 0;
  border: 1.5px solid #ddd6fe;
  border-radius: 10px;
  overflow: hidden;
  margin-top: -1px;
}
.s1-grid-1 .smd-sect-field {
  border-right: none;
  border-bottom: none;
  background: #f5f3ff;
}
[data-bs-theme="dark"] .s1-grid-1 {
  border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .s1-grid-1 .smd-sect-field {
  background: rgba(124, 58, 237, .08);
}

/* Badge sits on the shared dark-purple pill (.smd-stg-head-badge) and
 * paints just the leading dot in the status colour. */
.s1-badge-dot {
  width: 7px; height: 7px; border-radius: 50%;
  display: inline-block; flex-shrink: 0;
}
.s1-badge-qualified    .s1-badge-dot { background: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,.22); }
.s1-badge-disqualified .s1-badge-dot { background: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,.22); }
.s1-badge-pending      .s1-badge-dot { background: #fbbf24; box-shadow: 0 0 0 2px rgba(252,211,77,.22); }

.s1-empty-hint {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px; margin: 6px 0 2px;
  font-size: 11.5px; color: #5b21b6;
  background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px;
}
.s1-empty-hint svg { color: #7c3aed; flex-shrink: 0; margin-top: 1px; }

[data-bs-theme="dark"] .s1-empty-hint {
  background: rgba(124,58,237,.16);
  border-color: rgba(167,139,250,.35);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .s1-empty-hint svg { color: #c4b5fd; }
`;
