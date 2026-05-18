import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Performance
 *
 * Combined port of prototype `#perfOverviewPage` (line 75837),
 * `#perfTargetsPage` (75869), `#perfLeaderboardPage` (75899), and
 * `#perfActivityPage` (75919). The prototype has these as separate top-level
 * IDs (and duplicates them 8× — a defect documented in the QA notes), so we
 * surface them here as four tabs in a single React route.
 * ──────────────────────────────────────────────────────────────────────── */

type PerfTab = 'overview' | 'targets' | 'leaderboard' | 'activity';

export default function SalesPerformance() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PerfTab>('overview');

  useEffect(() => {
    const id = 'sm-perf-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const headerConfig: Record<PerfTab, { title: string; sub: string; color: string; icon: ReactNode }> = {
    overview: {
      title: 'Performance Overview',
      sub:   'Team-wide performance at a glance',
      color: 'linear-gradient(135deg, #16A34A, #22c55e)',
      icon:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>,
    },
    targets: {
      title: 'Targets & Achievements',
      sub:   'Track individual and team goals vs actuals',
      color: 'linear-gradient(135deg, #2563EB, #6366f1)',
      icon:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
    },
    leaderboard: {
      title: 'Leaderboard',
      sub:   'Top performers ranking — Q2 2026',
      color: 'linear-gradient(135deg, #D97706, #f59e0b)',
      icon:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>,
    },
    activity: {
      title: 'Activity Log',
      sub:   'Calls, visits & follow-ups',
      color: 'linear-gradient(135deg, #DB2777, #f472b6)',
      icon:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
    },
  };

  const cfg = headerConfig[tab];

  return (
    <div className="perf-root">
      <style>{SCOPED_CSS}</style>

      <div className="perf-header">
        <div className="perf-header-left">
          <div className="perf-header-icon" style={{ background: cfg.color }}>{cfg.icon}</div>
          <div>
            <h1 className="perf-header-title">{cfg.title}</h1>
            <p className="perf-header-sub">{cfg.sub}</p>
          </div>
        </div>
        <button className="perf-back-btn" onClick={() => navigate('/sales/lead-worksheet')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
      </div>

      <div className="perf-tabs">
        {(Object.keys(headerConfig) as PerfTab[]).map(t => (
          <button key={t} className={`perf-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' && 'Overview'}
            {t === 'targets' && 'Targets'}
            {t === 'leaderboard' && 'Leaderboard'}
            {t === 'activity' && 'Activity'}
          </button>
        ))}
      </div>

      {tab === 'overview'    && <OverviewPanel />}
      {tab === 'targets'     && <TargetsPanel />}
      {tab === 'leaderboard' && <LeaderboardPanel />}
      {tab === 'activity'    && <ActivityPanel />}
    </div>
  );
}

function OverviewPanel() {
  const reps = [
    { name:'Rahul Sharma', leads:124, deals:42, revenue:'₹11.2L', quota:112, status:'Exceeding', color:'#16a34a', bg:'#f0fdf4' },
    { name:'Priya Mehta',  leads:108, deals:38, revenue:'₹9.8L',  quota:98,  status:'On Track',  color:'#2563eb', bg:'#eff6ff' },
    { name:'Amit Verma',   leads:96,  deals:31, revenue:'₹8.1L',  quota:81,  status:'At Risk',   color:'#d97706', bg:'#fffbeb' },
    { name:'Sneha Patil',  leads:87,  deals:27, revenue:'₹6.7L',  quota:89,  status:'On Track',  color:'#2563eb', bg:'#eff6ff' },
    { name:'Vikram Nair',  leads:72,  deals:22, revenue:'₹5.3L',  quota:61,  status:'Below Target', color:'#dc2626', bg:'#fef2f2' },
  ];
  return (
    <>
      <div className="perf-stat-grid">
        <StatCard label="Active Reps" value="18" delta="▲ 3 joined this quarter" color="#0f172a" />
        <StatCard label="Avg. Quota Attainment" value="78%" delta="▲ 6% vs last quarter" color="#6366f1" />
        <StatCard label="Total Calls Made" value="4,812" delta="▲ 11% this month" color="#0f172a" />
        <StatCard label="Revenue Generated" value="₹96.4L" delta="▲ 14% vs last quarter" color="#0f172a" />
      </div>
      <div className="perf-card">
        <div className="perf-card-title">Team Performance Summary</div>
        <table className="perf-table">
          <thead>
            <tr>
              <th>Rep</th>
              <th style={{ textAlign: 'right' }}>Leads</th>
              <th style={{ textAlign: 'right' }}>Deals Won</th>
              <th style={{ textAlign: 'right' }}>Revenue</th>
              <th style={{ textAlign: 'right' }}>Quota %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {reps.map(r => (
              <tr key={r.name}>
                <td><strong>{r.name}</strong></td>
                <td style={{ textAlign: 'right' }}>{r.leads}</td>
                <td style={{ textAlign: 'right' }}>{r.deals}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.revenue}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: r.color }}>{r.quota}%</td>
                <td><span className="perf-status-pill" style={{ background: r.bg, color: r.color }}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TargetsPanel() {
  const targets = [
    { rep:'Rahul Sharma', target:'₹10L', achieved:'₹11.2L', gap:'+₹1.2L', pct:100, color:'#22c55e', gapColor:'#16a34a' },
    { rep:'Priya Mehta',  target:'₹10L', achieved:'₹9.8L',  gap:'-₹0.2L', pct:98,  color:'#6366f1', gapColor:'#ef4444' },
    { rep:'Amit Verma',   target:'₹10L', achieved:'₹8.1L',  gap:'-₹1.9L', pct:81,  color:'#f59e0b', gapColor:'#ef4444' },
    { rep:'Vikram Nair',  target:'₹8L',  achieved:'₹5.3L',  gap:'-₹2.7L', pct:66,  color:'#ef4444', gapColor:'#ef4444' },
  ];
  return (
    <>
      <div className="perf-stat-grid">
        <TargetCard label="Q2 Revenue Target" value="₹1.2Cr" pct={80} sub="Achieved: ₹96.4L" gradient="linear-gradient(90deg, #6366f1, #8b5cf6)" />
        <TargetCard label="New Customers Target" value="150" pct={81} sub="Achieved: 122" gradient="#22c55e" />
        <TargetCard label="Deal Closure Target" value="200" pct={80} sub="Achieved: 160" gradient="#f59e0b" />
      </div>
      <div className="perf-card">
        <div className="perf-card-title">Individual Target Tracker — Q2 2026</div>
        <table className="perf-table">
          <thead>
            <tr>
              <th>Rep</th>
              <th style={{ textAlign: 'right' }}>Target</th>
              <th style={{ textAlign: 'right' }}>Achieved</th>
              <th style={{ textAlign: 'right' }}>Gap</th>
              <th style={{ width: 180 }}>Progress</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.rep}>
                <td><strong>{t.rep}</strong></td>
                <td style={{ textAlign: 'right' }}>{t.target}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.achieved}</td>
                <td style={{ textAlign: 'right', color: t.gapColor, fontWeight: 600 }}>{t.gap}</td>
                <td><div className="perf-progress"><div className="perf-progress-fill" style={{ width: `${t.pct}%`, background: t.color }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LeaderboardPanel() {
  const top = [
    { rank:1, name:'Rahul Sharma', deals:42, rev:'₹11.2L', emoji:'🏆', medal:'Gold',   tone:'gold' },
    { rank:2, name:'Priya Mehta',  deals:38, rev:'₹9.8L',  emoji:'🥈', medal:'Silver', tone:'silver' },
    { rank:3, name:'Amit Verma',   deals:31, rev:'₹8.1L',  emoji:'🥉', medal:'Bronze', tone:'bronze' },
  ];
  const rest = [
    { rank:4, name:'Sneha Patil',  deals:27, rev:'₹6.7L', initial:'S', color:'#06b6d4' },
    { rank:5, name:'Vikram Nair',  deals:22, rev:'₹5.3L', initial:'V', color:'#8b5cf6' },
    { rank:6, name:'Karthik R',    deals:18, rev:'₹4.6L', initial:'K', color:'#10b981' },
  ];
  return (
    <div className="perf-leader-list">
      {top.map(t => (
        <div key={t.rank} className={`perf-podium perf-podium-${t.tone}`}>
          <div className="perf-podium-emoji">{t.emoji}</div>
          <div className="perf-podium-avatar">{t.name[0]}</div>
          <div className="perf-podium-text">
            <div className="perf-podium-name">{t.name}</div>
            <div className="perf-podium-sub">{t.deals} deals · {t.rev}</div>
          </div>
          <div className="perf-podium-rank">
            <div className="perf-podium-num">#{t.rank}</div>
            <div className="perf-podium-medal">{t.medal}</div>
          </div>
        </div>
      ))}
      {rest.map(r => (
        <div key={r.rank} className="perf-leader-row">
          <div className="perf-leader-rank">#{r.rank}</div>
          <div className="perf-leader-avatar" style={{ background: r.color }}>{r.initial}</div>
          <div className="perf-leader-text">
            <div className="perf-leader-name">{r.name}</div>
            <div className="perf-leader-sub">{r.deals} deals · {r.rev}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityPanel() {
  const acts = [
    { kind:'Call',    title:'Call with Tata Chemicals — Rahul Sharma',     desc:'Discussed Q3 requirement. Follow-up scheduled for Friday.', time:'10:32 AM', color:'#16a34a', bg:'#f0fdf4' },
    { kind:'Visit',   title:'Site Visit — Hindustan Unilever — Priya Mehta', desc:'Factory audit completed. Sample order approved.',         time:'9:15 AM',  color:'#2563eb', bg:'#eff6ff' },
    { kind:'Email',   title:'Email — Quote Sent to Marico Ltd — Amit Verma', desc:'Revised pricing proposal sent. Awaiting approval.',       time:'Yesterday', color:'#d97706', bg:'#fff7ed' },
    { kind:'Followup',title:'Follow-up Scheduled — ITC Ltd — Sneha Patil',  desc:'Demo call booked for May 25 at 11:00 AM.',                 time:'Yesterday', color:'#db2777', bg:'#fdf2f8' },
  ];
  return (
    <>
      <div className="perf-stat-grid">
        <StatCard label="Calls Today" value="84" delta="▲ 12 vs yesterday" color="#0f172a" />
        <StatCard label="Site Visits" value="23" delta="▲ 4 this week" color="#6366f1" />
        <StatCard label="Follow-ups Pending" value="47" delta="▼ 6 overdue" color="#f59e0b" deltaColor="#ef4444" />
        <StatCard label="Emails Sent" value="162" delta="▲ 18% open rate" color="#0f172a" />
      </div>
      <div className="perf-card">
        <div className="perf-card-title">Recent Activity</div>
        <div className="perf-activity-list">
          {acts.map((a, i) => (
            <div key={i} className="perf-activity-row">
              <div className="perf-activity-icon" style={{ background: a.bg, color: a.color }}>
                {a.kind === 'Call' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.48 2 2 0 0 1 3.59 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.02z" /></svg>}
                {a.kind === 'Visit' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>}
                {a.kind === 'Email' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22 6 12 13 2 6" /></svg>}
                {a.kind === 'Followup' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              </div>
              <div className="perf-activity-text">
                <div className="perf-activity-title">{a.title}</div>
                <div className="perf-activity-desc">{a.desc}</div>
              </div>
              <div className="perf-activity-time">{a.time}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Sub-components ── */
function StatCard({ label, value, delta, color, deltaColor = '#22c55e' }: { label: string; value: string; delta: string; color: string; deltaColor?: string }) {
  return (
    <div className="perf-stat">
      <div className="perf-stat-label">{label}</div>
      <div className="perf-stat-value" style={{ color }}>{value}</div>
      <div className="perf-stat-delta" style={{ color: deltaColor }}>{delta}</div>
    </div>
  );
}

function TargetCard({ label, value, pct, sub, gradient }: { label: string; value: string; pct: number; sub: string; gradient: string }) {
  return (
    <div className="perf-stat">
      <div className="perf-stat-label">{label}</div>
      <div className="perf-stat-value">{value}</div>
      <div className="perf-stat-foot">
        <div className="perf-stat-foot-row"><span>{sub}</span><span>{pct}%</span></div>
        <div className="perf-progress"><div className="perf-progress-fill" style={{ width: `${pct}%`, background: gradient }} /></div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.perf-root {
  font-family: 'DM Sans', 'Inter', sans-serif;
  background: #f8fafc;
  padding: 24px 28px 32px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  display: flex; flex-direction: column; gap: 18px;
}
.perf-root *, .perf-root *::before, .perf-root *::after { box-sizing: border-box; }

.perf-header { display: flex; align-items: center; justify-content: space-between; }
.perf-header-left { display: flex; align-items: center; gap: 10px; }
.perf-header-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.perf-header-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -.3px; }
.perf-header-sub { font-size: 12px; color: #64748b; margin: 2px 0 0; }
.perf-back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-family: inherit; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; }
.perf-back-btn:hover { border-color: #6366f1; color: #6366f1; }

.perf-tabs { display: flex; gap: 4px; padding: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; align-self: flex-start; }
.perf-tab { padding: 8px 18px; border: none; border-radius: 7px; background: transparent; color: #475569; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all .15s; }
.perf-tab:hover { background: #f8fafc; }
.perf-tab.active { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; box-shadow: 0 2px 8px rgba(99,102,241,.35); }

.perf-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.perf-stat { background: #fff; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.07); border: 1px solid #f1f5f9; }
.perf-stat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin-bottom: 8px; }
.perf-stat-value { font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -.5px; }
.perf-stat-delta { font-size: 12px; margin-top: 4px; }
.perf-stat-foot { margin-top: 10px; }
.perf-stat-foot-row { display: flex; justify-content: space-between; font-size: 11.5px; font-weight: 600; color: #64748b; margin-bottom: 5px; }

.perf-progress { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
.perf-progress-fill { height: 100%; border-radius: 99px; transition: width .3s; }

.perf-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.07); border: 1px solid #f1f5f9; }
.perf-card-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
.perf-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.perf-table thead tr { background: #f8fafc; }
.perf-table thead th { padding: 9px 12px; text-align: left; font-size: 10.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #f1f5f9; }
.perf-table tbody tr { border-bottom: 1px solid #f8fafc; }
.perf-table tbody td { padding: 9px 12px; color: #1e293b; }
.perf-status-pill { padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 700; }

.perf-leader-list { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.perf-podium { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border: 2px solid; border-radius: 14px; }
.perf-podium-gold   { background: linear-gradient(135deg, #fffbeb, #fef9c3); border-color: #fcd34d; }
.perf-podium-silver { background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-color: #cbd5e1; }
.perf-podium-bronze { background: linear-gradient(135deg, #fff7ed, #ffedd5); border-color: #fed7aa; }
.perf-podium-emoji { font-size: 24px; }
.perf-podium-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-size: 16px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.perf-podium-gold .perf-podium-avatar { background: linear-gradient(135deg, #f59e0b, #d97706); }
.perf-podium-bronze .perf-podium-avatar { background: linear-gradient(135deg, #f59e0b, #ef4444); }
.perf-podium-text { flex: 1; }
.perf-podium-name { font-size: 14px; font-weight: 800; color: #1e293b; }
.perf-podium-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
.perf-podium-rank { text-align: right; }
.perf-podium-num { font-size: 20px; font-weight: 800; color: #d97706; }
.perf-podium-silver .perf-podium-num { color: #64748b; }
.perf-podium-bronze .perf-podium-num { color: #c2410c; }
.perf-podium-medal { font-size: 11px; font-weight: 600; color: #92400e; margin-top: 2px; }

.perf-leader-row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; background: #fff; border: 1px solid #f1f5f9; border-radius: 12px; }
.perf-leader-rank { width: 28px; text-align: center; font-size: 14px; font-weight: 700; color: #94a3b8; }
.perf-leader-avatar { width: 34px; height: 34px; border-radius: 50%; color: #fff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.perf-leader-name { font-size: 13px; font-weight: 700; color: #1e293b; }
.perf-leader-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; }

.perf-activity-list { display: flex; flex-direction: column; }
.perf-activity-row { display: flex; align-items: flex-start; gap: 14px; padding: 12px 0; border-bottom: 1px solid #f8fafc; }
.perf-activity-row:last-child { border-bottom: none; }
.perf-activity-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.perf-activity-text { flex: 1; }
.perf-activity-title { font-size: 13px; font-weight: 600; color: #1e293b; }
.perf-activity-desc { font-size: 12px; color: #64748b; margin-top: 2px; }
.perf-activity-time { font-size: 11.5px; color: #94a3b8; flex-shrink: 0; }
`;
