import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Resolution Center
 *
 * Faithful port of prototype `#rcPage` (line 65464). Indigo-palette dashboard
 * with KPI cards, Priority Actions grid, and an Opportunity Control List.
 * ──────────────────────────────────────────────────────────────────────── */

type Priority = {
  id: string;
  oppId: string;
  customer: string;
  reason: string;
  urgency: 'Critical' | 'High' | 'Medium';
  sla: string;
};

const PRIORITIES: Priority[] = [
  { id:'P1',  oppId:'OPP-015', customer:'Karl Hofmann',      reason:'Stalled — no contact in 12 days',  urgency:'Critical', sla:'Overdue 3d' },
  { id:'P2',  oppId:'OPP-019', customer:'Amara Nwosu',       reason:'Quote sent, no response',           urgency:'Critical', sla:'Overdue 5d' },
  { id:'P3',  oppId:'OPP-026', customer:'Sofia Andersen',    reason:'Pending phytosanitary cert',         urgency:'High',     sla:'Due today' },
  { id:'P4',  oppId:'OPP-001', customer:'GreenHarvest',      reason:'Awaiting catalogue review',          urgency:'High',     sla:'Due tomorrow' },
  { id:'P5',  oppId:'OPP-017', customer:'Mohamed Aziz',      reason:'Sample dispatch delayed',            urgency:'Medium',   sla:'Due in 3d' },
  { id:'P6',  oppId:'OPP-013', customer:'Ahmed Al-Farsi',    reason:'Re-quote requested',                 urgency:'High',     sla:'Due today' },
  { id:'P7',  oppId:'OPP-030', customer:'Raj Commodities',   reason:'Contract review pending',            urgency:'Medium',   sla:'Due in 2d' },
  { id:'P8',  oppId:'OPP-022', customer:'Olga Kowalski',     reason:'Payment terms unclear',              urgency:'Medium',   sla:'Due in 4d' },
  { id:'P9',  oppId:'OPP-018', customer:'Ivan Petrov',       reason:'COA not received',                   urgency:'High',     sla:'Due today' },
];

const URGENCY_COLORS = {
  Critical: { bg:'linear-gradient(135deg, #FECACA, #FCA5A5)', fg:'#991B1B', dot:'#EF4444' },
  High:     { bg:'linear-gradient(135deg, #FED7AA, #FDBA74)', fg:'#9A3412', dot:'#F97316' },
  Medium:   { bg:'linear-gradient(135deg, #FDE68A, #FCD34D)', fg:'#92400E', dot:'#F59E0B' },
} as const;

export default function SalesResolutionCenter() {
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');

  useEffect(() => {
    const id = 'sm-rc-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = search
    ? PRIORITIES.filter(p => Object.values(p).some(v => String(v).toLowerCase().includes(search.toLowerCase())))
    : PRIORITIES;

  return (
    <div className="rc-root">
      <style>{SCOPED_CSS}</style>

      <div className="rc-topbar">
        <div className="rc-topbar-left">
          <div className="rc-logo">
            <div className="rc-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            </div>
            <span className="rc-logo-text">Resolution Center</span>
          </div>
          <span className="rc-live-badge">LIVE</span>
        </div>
        <button className="rc-back-btn" onClick={() => navigate('/sales/lead-worksheet')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
      </div>

      <div className="rc-tabs">
        <button className="rc-tab disabled" disabled>
          CLM Workflow
          <span className="rc-tab-soon">Soon</span>
        </button>
        <button className="rc-tab active">
          <div className="rc-tab-dot" />
          Sales Workflow
        </button>
      </div>

      <div className="rc-kpi-row">
        <div className="rc-kpi rc-kpi-indigo">
          <div className="rc-kpi-icon" style={{ background:'#EEF2FF' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          </div>
          <div>
            <div className="rc-kpi-num">18</div>
            <div className="rc-kpi-label">Total Opportunities</div>
          </div>
        </div>
        <div className="rc-kpi rc-kpi-amber">
          <div className="rc-kpi-icon" style={{ background:'#FFFBEB' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          </div>
          <div>
            <div className="rc-kpi-num" style={{ color:'#92400E' }}>11</div>
            <div className="rc-kpi-label">Active Opportunities</div>
          </div>
        </div>
        <div className="rc-kpi rc-kpi-red">
          <div className="rc-kpi-icon" style={{ background:'#FEF2F2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
          </div>
          <div>
            <div className="rc-kpi-num" style={{ color:'#991B1B' }}>5</div>
            <div className="rc-kpi-label">Blocked</div>
          </div>
        </div>
        <div className="rc-kpi rc-kpi-blue">
          <div className="rc-kpi-icon" style={{ background:'#EFF6FF' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          </div>
          <div>
            <div className="rc-kpi-num" style={{ color:'#1D4ED8' }}>4</div>
            <div className="rc-kpi-label">Delayed</div>
          </div>
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-section-header">
          <div className="rc-section-title-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6C3AE3" strokeWidth="2.3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            <div>
              <div className="rc-section-title">Priority Actions</div>
              <div className="rc-section-sub">Sorted by urgency · Click to diagnose</div>
            </div>
          </div>
          <span className="rc-section-count">{PRIORITIES.length} Actions</span>
        </div>
        <div className="rc-priority-grid">
          {PRIORITIES.slice(0, 6).map(p => {
            const c = URGENCY_COLORS[p.urgency];
            return (
              <div key={p.id} className="rc-priority-card" onClick={() => toast.info('Diagnose', `${p.oppId} — ${p.reason}`)}>
                <div className="rc-priority-head">
                  <span className="rc-mono">{p.oppId}</span>
                  <span className="rc-urgency" style={{ background: c.bg, color: c.fg }}>
                    <span className="rc-urgency-dot" style={{ background: c.dot }} />
                    {p.urgency}
                  </span>
                </div>
                <div className="rc-priority-cust"><strong>{p.customer}</strong></div>
                <div className="rc-priority-reason">{p.reason}</div>
                <div className="rc-priority-sla">SLA: <strong>{p.sla}</strong></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-section-header">
          <div className="rc-section-title-wrap">
            <div>
              <div className="rc-section-title">Opportunity Control List</div>
              <div className="rc-section-sub">{PRIORITIES.length} scenarios · Click any row to diagnose</div>
            </div>
          </div>
          <input
            className="rc-search"
            type="text"
            placeholder="Search opportunities…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="rc-table-wrap">
          <table className="rc-table">
            <thead>
              <tr>
                <th>Opportunity ID</th>
                <th>Customer</th>
                <th>Reason</th>
                <th>Urgency</th>
                <th>SLA</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const c = URGENCY_COLORS[p.urgency];
                return (
                  <tr key={p.id} onClick={() => toast.info('Diagnose', p.oppId)}>
                    <td><span className="rc-mono">{p.oppId}</span></td>
                    <td><strong>{p.customer}</strong></td>
                    <td>{p.reason}</td>
                    <td><span className="rc-urgency" style={{ background: c.bg, color: c.fg }}><span className="rc-urgency-dot" style={{ background: c.dot }} />{p.urgency}</span></td>
                    <td>{p.sla}</td>
                    <td><button className="rc-row-btn" onClick={e => { e.stopPropagation(); toast.info('Diagnose', p.oppId); }}>Diagnose</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.rc-root {
  font-family: var(--font-sans);
  background: #f8fafc;
  padding: 16px 22px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  display: flex; flex-direction: column; gap: 14px;
}
.rc-root *, .rc-root *::before, .rc-root *::after { box-sizing: border-box; }

.rc-topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #fff; border: 1px solid #eef2ff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.rc-topbar-left { display: flex; align-items: center; gap: 12px; }
.rc-logo { display: flex; align-items: center; gap: 10px; }
.rc-logo-icon { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #4f46e5); display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(99,102,241,.35); }
.rc-logo-text { font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: -.2px; }
.rc-live-badge { background: linear-gradient(135deg, #DC2626, #EF4444); color: #fff; padding: 2px 9px; border-radius: 6px; font-size: 9.5px; font-weight: 800; letter-spacing: .1em; }
.rc-back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.rc-back-btn:hover { border-color: #6366f1; color: #6366f1; }

.rc-tabs { display: flex; gap: 4px; background: #eef2ff; padding: 4px; border-radius: 10px; align-self: flex-start; }
.rc-tab { padding: 8px 16px; border: none; border-radius: 7px; background: transparent; color: #4338ca; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.rc-tab.disabled { color: #94a3b8; cursor: not-allowed; }
.rc-tab.active { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; box-shadow: 0 2px 8px rgba(99,102,241,.35); }
.rc-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; }
.rc-tab-soon { font-size: 9px; padding: 1px 5px; border-radius: 4px; background: #F1F5F9; color: #94A3B8; font-weight: 700; }

.rc-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.rc-kpi { display: flex; align-items: center; gap: 12px; background: #fff; border: 1.5px solid; border-left-width: 4px; border-radius: 14px; padding: 16px; box-shadow: 0 2px 8px rgba(99,102,241,.06); cursor: pointer; transition: all .18s; }
.rc-kpi:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(99,102,241,.14); }
.rc-kpi-indigo { border-color: #EDE9FE; border-left-color: #4F46E5; }
.rc-kpi-amber  { border-color: #FDE68A; border-left-color: #F59E0B; }
.rc-kpi-red    { border-color: #FECACA; border-left-color: #EF4444; }
.rc-kpi-blue   { border-color: #BFDBFE; border-left-color: #3B82F6; }
.rc-kpi-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rc-kpi-num { font-size: 26px; font-weight: 900; color: #1E1B4B; letter-spacing: -.5px; line-height: 1; }
.rc-kpi-label { font-size: 11px; font-weight: 600; color: #64748B; margin-top: 3px; }

.rc-section { background: #fff; border: 1px solid #eef2ff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 4px rgba(99,102,241,.05); }
.rc-section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 14px; gap: 12px; flex-wrap: wrap; }
.rc-section-title-wrap { display: flex; align-items: center; gap: 10px; }
.rc-section-title { font-size: 14px; font-weight: 800; color: #1E1B4B; letter-spacing: -.2px; }
.rc-section-sub { font-size: 11px; color: #94A3B8; margin-top: 2px; }
.rc-section-count { background: linear-gradient(135deg, #EF4444, #DC2626); color: #fff; border-radius: 999px; padding: 5px 14px; font-size: 11px; font-weight: 800; box-shadow: 0 2px 8px rgba(220,38,38,.3); }
.rc-search { width: 240px; max-width: 100%; height: 34px; padding: 0 12px; border: 1.5px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-family: inherit; font-size: 12px; outline: none; }
.rc-search:focus { border-color: #6366f1; background: #fff; }

.rc-priority-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.rc-priority-card { background: #fafbff; border: 1px solid #eef2ff; border-radius: 10px; padding: 12px; cursor: pointer; transition: all .15s; }
.rc-priority-card:hover { border-color: #6366f1; box-shadow: 0 4px 12px rgba(99,102,241,.15); }
.rc-priority-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.rc-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #6366f1; font-weight: 700; font-size: 11px; }
.rc-urgency { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 700; }
.rc-urgency-dot { width: 6px; height: 6px; border-radius: 50%; }
.rc-priority-cust { font-size: 13px; color: #0f172a; margin-bottom: 4px; }
.rc-priority-reason { font-size: 11.5px; color: #475569; line-height: 1.5; margin-bottom: 6px; }
.rc-priority-sla { font-size: 10.5px; color: #94a3b8; }

.rc-table-wrap { overflow-x: auto; border: 1px solid #f1f5f9; border-radius: 8px; }
.rc-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 800px; }
.rc-table thead tr { background: #f8fafc; }
.rc-table thead th { padding: 9px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #f1f5f9; }
.rc-table tbody tr { border-bottom: 1px solid #f8fafc; cursor: pointer; }
.rc-table tbody tr:hover { background: #fafbff; }
.rc-table tbody td { padding: 9px 12px; color: #475569; }
.rc-row-btn { padding: 5px 12px; border: 1.5px solid #6366f1; border-radius: 6px; background: #fff; color: #6366f1; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; }
.rc-row-btn:hover { background: #6366f1; color: #fff; }
`;
