import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Sales Analytics
 *
 * Faithful port of prototype `#analyticsPage` (line 75306). The prototype
 * itself shows a "Coming Soon" hero on this route while the heavy KPI grid
 * lives under separate Performance / Diagnosis / Resolution Center routes.
 * Mirror that exact UX here, with cross-links to the real sub-pages.
 * ──────────────────────────────────────────────────────────────────────── */

export default function SalesAnalytics() {
  const navigate = useNavigate();

  useEffect(() => {
    const id = 'sm-an-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  return (
    <div className="an-root">
      <style>{SCOPED_CSS}</style>

      <div className="an-header">
        <div className="an-header-left">
          <div className="an-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" /></svg>
          </div>
          <div>
            <div className="an-header-title">Sales Analytics</div>
            <div className="an-header-sub">Pipeline insights &amp; performance intelligence</div>
          </div>
        </div>
      </div>

      <div className="an-hero">
        <div className="an-hero-icon">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" /></svg>
        </div>
        <div className="an-hero-text">
          <div className="an-hero-eyebrow">Sales Analytics</div>
          <div className="an-hero-title">Coming Soon</div>
          <div className="an-hero-sub">
            The KPI Dashboard module is currently under active development.<br />
            In the meantime, explore the sub-modules already built.
          </div>
        </div>
        <div className="an-hero-status">
          <div className="an-pulse" />
          <span>In Development</span>
        </div>
      </div>

      <div className="an-shortcuts">
        <div className="an-shortcut" onClick={() => navigate('/sales/diagnosis')}>
          <div className="an-shortcut-icon" style={{ background: '#eef2ff', color: '#4F46E5' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          </div>
          <div>
            <div className="an-shortcut-title">Diagnosis View</div>
            <div className="an-shortcut-desc">Detect flow delays, stalled leads, and bottlenecks before handoff.</div>
          </div>
        </div>
        <div className="an-shortcut" onClick={() => navigate('/sales/resolution-center')}>
          <div className="an-shortcut-icon" style={{ background: '#f0fdf4', color: '#16A34A' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          </div>
          <div>
            <div className="an-shortcut-title">Resolution Center</div>
            <div className="an-shortcut-desc">Priority actions on blocked, idle, and overdue opportunities.</div>
          </div>
        </div>
        <div className="an-shortcut" onClick={() => navigate('/sales/performance')}>
          <div className="an-shortcut-icon" style={{ background: '#fef3c7', color: '#D97706' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
          </div>
          <div>
            <div className="an-shortcut-title">Performance</div>
            <div className="an-shortcut-desc">Team-wide overview, targets, leaderboard, and activity log.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.an-root {
  font-family: var(--font-sans);
  background: #f8fafc;
  padding: 14px 22px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 14px;
  color: #0f172a;
}
.an-root *, .an-root *::before, .an-root *::after { box-sizing: border-box; }

.an-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; background: #fff;
  border: 1px solid #e8eaf0; border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.an-header-left { display: flex; align-items: center; gap: 14px; }
.an-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(99,102,241,.35);
}
.an-header-title { font-size: 16px; font-weight: 800; color: #0f172a; letter-spacing: -.3px; }
.an-header-sub   { font-size: 11px; color: #64748b; margin-top: 2px; }

.an-hero {
  background: #fff; border: 1px solid #e8eaf0; border-radius: 16px;
  padding: 56px 32px;
  display: flex; flex-direction: column; align-items: center; gap: 22px;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.an-hero-icon {
  width: 90px; height: 90px; border-radius: 22px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 32px rgba(99,102,241,.35);
}
.an-hero-text { text-align: center; }
.an-hero-eyebrow { font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .18em; margin-bottom: 10px; }
.an-hero-title { font-size: 32px; font-weight: 900; color: #0f172a; letter-spacing: -.8px; margin-bottom: 8px; }
.an-hero-sub { font-size: 13px; color: #94a3b8; max-width: 420px; line-height: 1.75; }
.an-hero-status {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 22px; border-radius: 24px;
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  border: 1px solid #c7d2fe;
  font-size: 12.5px; font-weight: 700; color: #4f46e5;
}
.an-pulse {
  width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
  animation: anPulse 1.8s ease-in-out infinite;
}
@keyframes anPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.3); } }

.an-shortcuts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.an-shortcut {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; background: #fff;
  border: 1px solid #e8eaf0; border-radius: 12px;
  cursor: pointer; transition: all .18s;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.an-shortcut:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(99,102,241,.12); border-color: #c7d2fe; }
.an-shortcut-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.an-shortcut-title { font-size: 13px; font-weight: 800; color: #0f172a; }
.an-shortcut-desc { font-size: 11px; color: #64748b; margin-top: 2px; }
`;
