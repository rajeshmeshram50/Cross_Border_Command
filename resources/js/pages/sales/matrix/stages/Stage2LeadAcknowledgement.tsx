import { useState } from 'react';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* Sales Matrix → Stage 2 — Lead Acknowledgement
 * Three status pills (Qualified / Clarity Pending / Disqualified) plus an
 * activity log with the historical qualification touchpoints. */

type AckStatus = 'qualified' | 'clarity' | 'disqualified';

type ActivityRow = {
  date:   string;
  status: AckStatus;
  reason: string;
};

const ACTIVITY: ActivityRow[] = [
  { date: '15/04/2026', status: 'qualified',     reason: 'Budget approved' },
  { date: '15/04/2026', status: 'qualified',     reason: 'Decision maker contacted' },
  { date: '15/04/2026', status: 'qualified',     reason: 'Follow-up scheduled' },
  { date: '14/04/2026', status: 'clarity',       reason: 'Awaiting budget confirmation' },
  { date: '14/04/2026', status: 'qualified',     reason: 'Requirements clarified' },
  { date: '13/04/2026', status: 'qualified',     reason: 'Initial response received' },
  { date: '13/04/2026', status: 'clarity',       reason: 'Need more product details' },
  { date: '12/04/2026', status: 'disqualified',  reason: 'Out of region' },
  { date: '12/04/2026', status: 'qualified',     reason: 'Re-engaged after follow-up' },
  { date: '11/04/2026', status: 'qualified',     reason: 'Sample request received' },
  { date: '11/04/2026', status: 'clarity',       reason: 'Awaiting buyer confirmation' },
  { date: '10/04/2026', status: 'qualified',     reason: 'Initial inquiry logged' },
  { date: '10/04/2026', status: 'qualified',     reason: 'Customer details captured' },
  { date: '10/04/2026', status: 'qualified',     reason: 'Lead routed to sales owner' },
  { date: '10/04/2026', status: 'qualified',     reason: 'Lead acknowledged in CRM' },
];

const STATUS_META: Record<AckStatus, { label: string; pillClass: string }> = {
  qualified:    { label: 'Qualified',       pillClass: 'smd-st2-pill-q' },
  clarity:      { label: 'Clarity Pending', pillClass: 'smd-st2-pill-c' },
  disqualified: { label: 'Disqualified',    pillClass: 'smd-st2-pill-d' },
};

export default function Stage2LeadAcknowledgement({ onPrev, onNext }: StageProps) {
  const [status, setStatus] = useState<AckStatus>('qualified');

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE2_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 2: Lead Acknowledgement</div>
            <div className="smd-stg-head-sub">● Qualification confirmed and logged</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Status selector */}
        <div className="smd-st2-status-block">
          <div className="smd-st2-status-head">
            <span className="smd-st2-check">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <span className="smd-st2-status-title">LEAD ACKNOWLEDGEMENT STATUS</span>
            <span className={`smd-st2-status-current ${STATUS_META[status].pillClass}`}>
              ● {STATUS_META[status].label}
            </span>
          </div>

          <div className="smd-st2-pills">
            <button className={`smd-st2-pill smd-st2-pill-q ${status === 'qualified'    ? 'active' : ''}`} onClick={() => setStatus('qualified')}>● Qualified Lead</button>
            <button className={`smd-st2-pill smd-st2-pill-c ${status === 'clarity'      ? 'active' : ''}`} onClick={() => setStatus('clarity')}>Clarity Pending</button>
            <button className={`smd-st2-pill smd-st2-pill-d ${status === 'disqualified' ? 'active' : ''}`} onClick={() => setStatus('disqualified')}>Disqualified</button>
          </div>
        </div>

        {/* Activity Report */}
        <div className="smd-st2-activity">
          <div className="smd-st2-activity-head">
            <div className="smd-st2-activity-head-left">
              <div className="smd-st2-activity-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <path d="M3 3h18v4H3zM3 11h18v4H3zM3 19h18v2H3z"/>
                </svg>
              </div>
              <div className="smd-st2-activity-title">Activity Report</div>
              <span className="smd-st2-activity-count">{ACTIVITY.length}</span>
            </div>
          </div>

          <div className="smd-st2-table-wrap">
            <table className="smd-st2-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ width: 110 }}>DATE</th>
                  <th style={{ width: 150 }}>STATUS</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {ACTIVITY.map((row, idx) => (
                  <tr key={idx}>
                    <td><span className="smd-st2-row-num">{idx + 1}</span></td>
                    <td>{row.date}</td>
                    <td>
                      <span className={`smd-st2-row-pill ${STATUS_META[row.status].pillClass}`}>
                        ● {STATUS_META[row.status].label}
                      </span>
                    </td>
                    <td className="smd-st2-row-reason">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Confirm lead qualification and update ownership before moving forward.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
          <button className="smd-stg-btn smd-stg-btn-primary" onClick={onNext}>Save &amp; Next →</button>
        </div>
      </div>
    </>
  );
}

const STAGE2_CSS = `
.smd-st2-status-block {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 12px;
}
.smd-st2-status-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.smd-st2-check { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#10b981,#047857); display: flex; align-items: center; justify-content: center; }
.smd-st2-status-title { font-size: 11.5px; font-weight: 800; letter-spacing: .04em; color: #1e293b; flex: 1; }
.smd-st2-status-current {
  font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px;
  background: #d1fae5; color: #047857; border: 1px solid #a7f3d0;
}
.smd-st2-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.smd-st2-pill {
  padding: 7px 14px; border-radius: 20px; border: 1px solid;
  background: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.smd-st2-pill-q { color: #047857; border-color: #a7f3d0; }
.smd-st2-pill-q.active { background: #d1fae5; }
.smd-st2-pill-c { color: #d97706; border-color: #fde68a; }
.smd-st2-pill-c.active { background: #fffbeb; }
.smd-st2-pill-d { color: #dc2626; border-color: #fecaca; }
.smd-st2-pill-d.active { background: #fee2e2; }

.smd-st2-activity {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: hidden;
}
.smd-st2-activity-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; background: #faf5ff; border-bottom: 1px solid #e9d5ff; }
.smd-st2-activity-head-left { display: flex; align-items: center; gap: 9px; }
.smd-st2-activity-icon { width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg,#7c3aed,#6d28d9); display: flex; align-items: center; justify-content: center; }
.smd-st2-activity-title { font-size: 13px; font-weight: 700; color: #4c1d95; }
.smd-st2-activity-count {
  background: #fef3c7; color: #92400e; font-size: 10.5px; font-weight: 800;
  padding: 1px 8px; border-radius: 20px;
}

.smd-st2-table-wrap { max-height: 230px; overflow-y: auto; }
.smd-st2-table { width: 100%; border-collapse: collapse; }
.smd-st2-table thead th {
  position: sticky; top: 0; background: #faf5ff;
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280;
  border-bottom: 1px solid #e9d5ff;
}
.smd-st2-table tbody td {
  padding: 9px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.smd-st2-row-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st2-row-pill { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
.smd-st2-row-reason { color: #475569; }
`;
