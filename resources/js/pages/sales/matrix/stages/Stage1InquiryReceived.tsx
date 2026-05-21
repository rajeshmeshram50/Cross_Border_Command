import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* Sales Matrix → Stage 1 — Inquiry Received
 * Shows the captured opportunity details + the purchase-decision-maker block. */
export default function Stage1InquiryReceived({ header, onNext }: StageProps) {
  return (
    <>
      <style>{SHARED_STAGE_CSS}</style>

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
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Opportunity Details */}
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
            <Cell label="OPPORTUNITY ID" value={header.oppId} />
            <Cell label="OPPORTUNITY DATE" value={header.oppDate} />
            <Cell label="CUSTOMER NAME" value={header.customer} />
            <Cell label="DATE" value="—" muted />
            <Cell label="ORDER VALUE" value="₹7,00,000" />
          </div>
        </div>

        {/* Purchase Decision Maker */}
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
            <Cell label="NAME" value="Rakesh Vardhan" />
            <Cell label="MOBILE NUMBER" value="+91 91234 56789" />
          </div>
          <div style={{ marginTop: 10 }}>
            <Cell label="EMAIL" value="r.vardhan@gmail.com" />
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Fill in the Purchase Manager details to proceed to the next stage.
        </div>
        <button className="smd-stg-btn smd-stg-btn-primary" onClick={onNext}>
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
