import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* Sales Matrix → Stage 6 — Victory Stage
 * Celebratory landing with deal summary and Create Shipment ID CTA. */

export default function Stage6VictoryStage({ header, onPrev }: StageProps) {
  const today = new Date().toLocaleDateString('en-GB');

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE6_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M6 9a6 6 0 0 0 12 0V3H6z"/>
              <path d="M9 21h6M12 17v4"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 6: Victory Stage</div>
            <div className="smd-stg-head-sub">● Deal successfully won</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body smd-st6-body">
        {/* Trophy + Congratulations */}
        <div className="smd-st6-celebrate">
          <div className="smd-st6-confetti">
            <span style={{ left: '8%',  top: '12%', background: '#fbbf24' }} />
            <span style={{ left: '20%', top: '40%', background: '#a78bfa' }} />
            <span style={{ left: '85%', top: '20%', background: '#34d399' }} />
            <span style={{ left: '92%', top: '55%', background: '#f87171' }} />
            <span style={{ left: '15%', top: '80%', background: '#60a5fa' }} />
            <span style={{ left: '78%', top: '78%', background: '#f59e0b' }} />
          </div>

          <div className="smd-st6-trophy">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M6 9a6 6 0 0 0 12 0V3H6z"/>
              <path d="M9 21h6M12 17v4"/>
              <path d="M2 5h4M18 5h4"/>
            </svg>
          </div>

          <div className="smd-st6-title">Congratulations!</div>
          <div className="smd-st6-quote">"Every win counts! Keep the momentum going"</div>

          <span className="smd-st6-won-badge">● DEAL MARKED AS WON</span>

          <button className="smd-st6-cta">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            Create Shipment ID
          </button>
        </div>

        {/* Deal Summary */}
        <div className="smd-st6-summary">
          <div className="smd-st6-summary-head">DEAL SUMMARY</div>
          <div className="smd-st6-summary-grid">
            <SummaryCell color="violet" icon="🪪"  label="OPPORTUNITY ID" value={header.oppId} />
            <SummaryCell color="blue"   icon="🏢"  label="CUSTOMER"        value={header.customer} />
            <SummaryCell color="amber"  icon="📅"  label="WON DATE"        value={today} />
            <SummaryCell color="rose"   icon="📄"  label="QUOTATION NO"    value="QT/2025-26/4" />
            <SummaryCell color="emerald" icon="🧾" label="PI NUMBER"       value="PI/2026-27/001" />
            <SummaryCell color="green"  icon="$"  label="DEAL VALUE"       value="$ 2,500,000.00" />
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Congratulations! Mark the deal as won to complete this opportunity.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
        </div>
      </div>
    </>
  );
}

function SummaryCell({ color, icon, label, value }: {
  color: 'violet'|'blue'|'amber'|'rose'|'emerald'|'green'; icon: string; label: string; value: string;
}) {
  return (
    <div className={`smd-st6-cell smd-st6-cell-${color}`}>
      <div className="smd-st6-cell-head">
        <span className="smd-st6-cell-icon">{icon}</span>
        <span className="smd-st6-cell-label">{label}</span>
      </div>
      <div className="smd-st6-cell-value">{value}</div>
    </div>
  );
}

const STAGE6_CSS = `
.smd-st6-body { display: flex; flex-direction: column; align-items: center; padding: 30px 24px 18px; }
.smd-st6-celebrate {
  position: relative; width: 100%; max-width: 520px;
  display: flex; flex-direction: column; align-items: center;
  padding: 20px 16px 28px;
}
.smd-st6-confetti { position: absolute; inset: 0; pointer-events: none; }
.smd-st6-confetti span {
  position: absolute; width: 6px; height: 6px; border-radius: 2px;
  opacity: .85;
}
.smd-st6-trophy {
  width: 84px; height: 84px; border-radius: 24px;
  background: linear-gradient(135deg,#fbbf24 0%,#f59e0b 60%,#d97706 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 32px rgba(245,158,11,.4), inset 0 -4px 0 rgba(0,0,0,.1);
}
.smd-st6-title {
  margin-top: 18px;
  font-size: 28px; font-weight: 800; letter-spacing: -.5px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.smd-st6-quote {
  margin-top: 4px;
  font-size: 13px; font-style: italic; color: #64748b;
}
.smd-st6-won-badge {
  margin-top: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 14px; border-radius: 20px;
  background: #d1fae5; color: #047857; font-size: 11px; font-weight: 800; letter-spacing: .04em;
  border: 1px solid #a7f3d0;
}
.smd-st6-cta {
  margin-top: 16px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 26px; border-radius: 12px;
  background: linear-gradient(135deg,#f59e0b 0%,#d97706 100%);
  color: #fff; font-size: 13.5px; font-weight: 800;
  border: none; cursor: pointer;
  box-shadow: 0 6px 18px rgba(245,158,11,.4);
}
.smd-st6-cta:hover { transform: translateY(-1px); }

.smd-st6-summary {
  width: 100%; max-width: 600px; margin-top: 12px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 14px;
  padding: 12px 14px;
}
.smd-st6-summary-head {
  font-size: 10.5px; font-weight: 800; letter-spacing: .12em; color: #92400e;
  margin-bottom: 10px;
}
.smd-st6-summary-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
}
.smd-st6-cell {
  padding: 8px 10px; border-radius: 10px; background: #fff;
  border: 1px solid;
}
.smd-st6-cell-violet  { border-color: #ddd6fe; }
.smd-st6-cell-blue    { border-color: #bfdbfe; }
.smd-st6-cell-amber   { border-color: #fde68a; }
.smd-st6-cell-rose    { border-color: #fecdd3; }
.smd-st6-cell-emerald { border-color: #a7f3d0; }
.smd-st6-cell-green   { border-color: #bbf7d0; }
.smd-st6-cell-head { display: flex; align-items: center; gap: 6px; }
.smd-st6-cell-icon { font-size: 11px; }
.smd-st6-cell-label { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #94a3b8; }
.smd-st6-cell-value { font-size: 12.5px; font-weight: 700; color: #1e293b; margin-top: 2px; }

@media (max-width: 720px) {
  .smd-st6-summary-grid { grid-template-columns: 1fr 1fr; }
}
`;
