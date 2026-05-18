import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Sales Diagnosis Engine
 *
 * Faithful port of prototype `#diagnosisPage` (line 63847). Indigo-palette
 * dashboard with KPI tiles, module tabs (Sales Matrix / CLM), and a
 * filterable summary strip.
 * ──────────────────────────────────────────────────────────────────────── */

type KPI = {
  key: string;
  label: string;
  value: number;
  badge: string;
  color: string;
  sub: string;
  pct: number;
};

const KPIS: KPI[] = [
  { key:'active_leads',     label:'Total Active Leads',  value:76, badge:'Active',   color:'#4F46E5', sub:'↑ 4 new today',                pct:76 },
  { key:'blocked',          label:'Blocked Opportunities',value:12, badge:'Critical', color:'#DC2626', sub:'Need immediate action',         pct:16 },
  { key:'idle',             label:'Idle Opportunities',  value:8,  badge:'Stale',    color:'#EA580C', sub:'No activity 7+ days',           pct:11 },
  { key:'overdue_followup', label:'Overdue Follow-ups',  value:9,  badge:'Overdue',  color:'#D97706', sub:'SLA missed',                    pct:12 },
  { key:'unassigned',       label:'Unassigned Leads',    value:14, badge:'Action',   color:'#0891B2', sub:'Auto-assign available',         pct:18 },
  { key:'high_value',       label:'High-Value At Risk',  value:5,  badge:'Priority', color:'#7C3AED', sub:'Combined ARR ≥ $250K',          pct:6  },
];

export default function SalesDiagnosis() {
  const navigate = useNavigate();
  const toast = useToast();
  const [moduleTab, setModuleTab] = useState<0 | 1>(0);

  useEffect(() => {
    const id = 'sm-dv-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  return (
    <div className="dv-root">
      <style>{SCOPED_CSS}</style>

      <div className="dv-topbar">
        <div className="dv-topbar-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          <h1 className="dv-title">Sales Diagnosis Engine</h1>
          <span className="dv-badge">LIVE</span>
        </div>
        <div className="dv-topbar-right">
          <span className="dv-updated">Last updated: <strong>Just now</strong></span>
          <button className="dv-close-btn" onClick={() => navigate('/sales/analytics')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Back to Analytics
          </button>
        </div>
      </div>

      <div className="dv-module-tabs">
        <button className={`dv-mtab ${moduleTab === 0 ? 'active' : ''}`} onClick={() => setModuleTab(0)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          Sales Matrix Diagnosis
        </button>
        <button className={`dv-mtab ${moduleTab === 1 ? 'active' : ''}`} onClick={() => setModuleTab(1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          CLM Diagnosis
        </button>
      </div>

      {moduleTab === 0 ? (
        <>
          <div className="dv-sm-header">
            <div>
              <h2 className="dv-section-title">Sales Matrix Diagnosis</h2>
              <p className="dv-section-sub">Detect sales flow delays, activity gaps, bottlenecks, priority failures, and conversion risks before handoff.</p>
            </div>
            <div className="dv-controls">
              <select className="dv-filter"><option>All Dates</option><option>Today</option><option>Last 7 Days</option><option>Last 30 Days</option></select>
              <select className="dv-filter"><option>All Owners</option><option>Rahul S.</option><option>Priya M.</option><option>Amit K.</option></select>
              <select className="dv-filter"><option>All Teams</option><option>Team Alpha</option><option>Team Beta</option></select>
              <select className="dv-filter"><option>All Priority</option><option>Critical</option><option>High</option><option>Medium</option></select>
              <button className="dv-action-btn" onClick={() => toast.info('Exporting', 'Diagnosis report generation queued')}>Export</button>
              <button className="dv-action-btn dv-action-primary" onClick={() => toast.info('Refreshing', 'Live signals refresh queued')}>Refresh</button>
            </div>
          </div>

          <div className="dv-kpi-grid">
            {KPIS.map(k => (
              <div key={k.key} className="dv-kpi" style={{ borderTopColor: k.color }} onClick={() => toast.info('Drill into', k.label)}>
                <div className="dv-kpi-top">
                  <div className="dv-kpi-icon" style={{ background: `${k.color}20`, color: k.color }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                  </div>
                  <span className="dv-kpi-badge" style={{ background: `${k.color}18`, color: k.color, borderColor: `${k.color}40` }}>{k.badge}</span>
                </div>
                <div className="dv-kpi-num" style={{ color: k.color }}>{k.value}</div>
                <div className="dv-kpi-lbl">{k.label}</div>
                <div className="dv-kpi-sub">{k.sub}</div>
                <div className="dv-kpi-bar">
                  <div className="dv-kpi-bar-fill" style={{ width: `${k.pct}%`, background: `linear-gradient(90deg, ${k.color}80, ${k.color})` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="dv-coming">
            <p>Detailed signal breakdowns, opportunity timelines, and one-click resolutions ship in the next phase.</p>
          </div>
        </>
      ) : (
        <div className="dv-coming">
          <h3>CLM Diagnosis</h3>
          <p>Contract Lifecycle Management diagnostics — under construction.</p>
        </div>
      )}
    </div>
  );
}

const SCOPED_CSS = `
.dv-root {
  font-family: 'DM Sans', 'Inter', sans-serif;
  background: #f8fafc;
  padding: 16px 22px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  display: flex; flex-direction: column; gap: 14px;
}
.dv-root *, .dv-root *::before, .dv-root *::after { box-sizing: border-box; }

.dv-topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #fff; border: 1px solid #eef2ff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.04); flex-wrap: wrap; gap: 12px; }
.dv-topbar-left { display: flex; align-items: center; gap: 12px; }
.dv-title { font-size: 17px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -.3px; }
.dv-badge { background: linear-gradient(135deg, #DC2626, #EF4444); color: #fff; padding: 2px 9px; border-radius: 6px; font-size: 9.5px; font-weight: 800; letter-spacing: .1em; }
.dv-topbar-right { display: flex; align-items: center; gap: 12px; }
.dv-updated { font-size: 12px; color: #64748b; }
.dv-updated strong { color: #1e293b; }
.dv-close-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.dv-close-btn:hover { border-color: #6366f1; color: #6366f1; }

.dv-module-tabs { display: flex; gap: 4px; background: #eef2ff; padding: 4px; border-radius: 10px; align-self: flex-start; }
.dv-mtab { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 7px; background: transparent; color: #4338ca; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; }
.dv-mtab:hover { background: rgba(99,102,241,.1); }
.dv-mtab.active { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; box-shadow: 0 2px 8px rgba(99,102,241,.4); }

.dv-sm-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 18px; background: #fff; border: 1px solid #eef2ff; border-radius: 12px; flex-wrap: wrap; }
.dv-section-title { font-size: 16px; font-weight: 800; color: #1e1b4b; margin: 0; }
.dv-section-sub { font-size: 12px; color: #64748b; margin: 4px 0 0; max-width: 600px; }
.dv-controls { display: flex; flex-wrap: wrap; gap: 6px; }
.dv-filter { padding: 6px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px; font-family: inherit; font-size: 11.5px; color: #475569; background: #fff; cursor: pointer; outline: none; }
.dv-action-btn { padding: 6px 14px; border: 1.5px solid #e2e8f0; border-radius: 7px; background: #fff; color: #475569; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .15s; }
.dv-action-btn:hover { border-color: #6366f1; color: #6366f1; }
.dv-action-primary { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; border: none; box-shadow: 0 2px 8px rgba(99,102,241,.35); }
.dv-action-primary:hover { color: #fff; transform: translateY(-1px); }

.dv-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.dv-kpi { background: #fff; border: 1.5px solid #ede9fe; border-top: 3px solid; border-radius: 12px; padding: 14px; cursor: pointer; transition: all .18s; box-shadow: 0 1px 4px rgba(99,102,241,.05); }
.dv-kpi:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(99,102,241,.18); }
.dv-kpi-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dv-kpi-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.dv-kpi-badge { padding: 2px 9px; border-radius: 6px; border: 1px solid; font-size: 9.5px; font-weight: 800; letter-spacing: .05em; }
.dv-kpi-num { font-size: 28px; font-weight: 900; letter-spacing: -.8px; line-height: 1; }
.dv-kpi-lbl { font-size: 12px; font-weight: 700; color: #1e293b; margin-top: 5px; }
.dv-kpi-sub { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
.dv-kpi-bar { height: 5px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-top: 10px; }
.dv-kpi-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }

.dv-coming { padding: 32px; background: #fff; border: 1.5px dashed #e2e8f0; border-radius: 12px; text-align: center; color: #64748b; }
.dv-coming h3 { color: #1e293b; margin: 0 0 6px; font-weight: 800; }
.dv-coming p { font-size: 12px; margin: 0; max-width: 600px; margin: 0 auto; line-height: 1.6; }
`;
