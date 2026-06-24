import { useEffect } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Procure to Pay (P2P) Summary
 *
 * Placeholder "Coming Soon" page — the P2P module is on the roadmap but its
 * dashboard isn't built yet. Keeps the sidebar leaf live with a useful screen
 * instead of a 404, and previews the cards that will land in the next phase.
 * ──────────────────────────────────────────────────────────────────────── */

export default function SalesP2PSummary() {
  useEffect(() => {
    const id = 'sm-p2p-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  return (
    <div className="p2p-root">
      <style>{SCOPED_CSS}</style>

      {/* Hero strip */}
      <div className="p2p-header">
        <span className="p2p-accent" />
        <span className="p2p-glow" />
        <div className="p2p-header-left">
          <div className="p2p-avatar-wrap">
            <div className="p2p-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
            <span className="p2p-online-dot" />
          </div>
          <div>
            <div className="p2p-header-title">Procure to Pay (P2P) Summary</div>
            <div className="p2p-header-sub">End-to-end procurement visibility — from requisition to vendor payout</div>
          </div>
        </div>
        <div className="p2p-header-badge">
          <span className="p2p-badge-dot" />
          Module Coming Soon
        </div>
      </div>

      {/* Coming Soon hero panel */}
      <div className="p2p-soon">
        <div className="p2p-soon-bg" />
        <div className="p2p-soon-bg-2" />

        <div className="p2p-soon-illustration">
          <div className="p2p-soon-illustration-ring p2p-ring-1" />
          <div className="p2p-soon-illustration-ring p2p-ring-2" />
          <div className="p2p-soon-illustration-ring p2p-ring-3" />
          <div className="p2p-soon-illustration-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </div>
        </div>

        <div className="p2p-soon-eyebrow">
          <span className="p2p-soon-eyebrow-dot" />
          UNDER CONSTRUCTION
        </div>
        <h1 className="p2p-soon-title">Procure to Pay Summary is on its way</h1>
        <p className="p2p-soon-desc">
          This dashboard will give you a single-pane view of every procurement leg — from purchase requisitions and PO approvals to GRN, vendor bills, and final payouts.
          Track spend, monitor vendor performance, and close the loop on payables — all in one place.
        </p>

        <div className="p2p-soon-progress">
          <div className="p2p-soon-progress-track">
            <div className="p2p-soon-progress-fill" />
          </div>
          <div className="p2p-soon-progress-text">In active development · ETA next release</div>
        </div>

        <div className="p2p-soon-cta-row">
          <button className="p2p-soon-cta" onClick={() => window.history.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to previous page
          </button>
          <a className="p2p-soon-cta p2p-soon-cta-ghost" href="/dashboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Go to Dashboard
          </a>
        </div>
      </div>

      {/* Preview of upcoming sections */}
      <div className="p2p-preview-heading">
        <span className="p2p-preview-bar" />
        What's coming in this module
      </div>

      <div className="p2p-preview-grid">
        {PREVIEW_CARDS.map((c, i) => (
          <div key={i} className="p2p-preview-card">
            <div className="p2p-preview-icon" style={{ background: c.gradient }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {c.path}
              </svg>
            </div>
            <div className="p2p-preview-title">{c.title}</div>
            <p className="p2p-preview-desc">{c.desc}</p>
            <span className="p2p-preview-tag">{c.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PREVIEW_CARDS: { title: string; desc: string; tag: string; gradient: string; path: React.ReactNode }[] = [
  {
    title: 'Requisitions & Approvals',
    desc: 'Track purchase requisitions, multi-level approvals, and budget validation in a single queue.',
    tag: 'STAGE 1',
    gradient: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    path: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" /></>,
  },
  {
    title: 'Supplier & PO Management',
    desc: 'Map suppliers to products, raise POs from approved requisitions, and track delivery commitments.',
    tag: 'STAGE 2',
    gradient: 'linear-gradient(135deg,#06b6d4,#0e7490)',
    path: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  },
  {
    title: 'GRN & Quality Check',
    desc: 'Capture goods receipts with lot/batch detail, QC sampling, and short-shipment claims.',
    tag: 'STAGE 3',
    gradient: 'linear-gradient(135deg,#22c55e,#15803d)',
    path: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  },
  {
    title: 'Supplier Invoicing & 3-way Match',
    desc: 'Match supplier bills against PO and GRN — auto-flag mismatches before payment release.',
    tag: 'STAGE 4',
    gradient: 'linear-gradient(135deg,#f59e0b,#b45309)',
    path: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></>,
  },
  {
    title: 'Payments & Cash Flow',
    desc: 'Run payment cycles, schedule disbursements, and track ageing — all currencies, all banks.',
    tag: 'STAGE 5',
    gradient: 'linear-gradient(135deg,#ec4899,#be185d)',
    path: <><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>,
  },
  {
    title: 'Spend Analytics',
    desc: 'Drill into category-wise spend, vendor concentration, and savings vs. benchmark in real time.',
    tag: 'STAGE 6',
    gradient: 'linear-gradient(135deg,#ef4444,#b91c1c)',
    path: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  },
];

const SCOPED_CSS = `
.p2p-root {
  font-family: var(--font-sans);
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 40%, #ede9fe 100%);
  padding: 14px 18px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 16px;
}
.p2p-root *, .p2p-root *::before, .p2p-root *::after { box-sizing: border-box; }

/* Hero header */
.p2p-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 18px; min-height: 64px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 40%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 16px;
  box-shadow: 0 2px 0 rgba(255,255,255,.85) inset, 0 8px 28px rgba(139,92,246,.2);
}
.p2p-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 16px 0 0 16px; }
.p2p-glow { position: absolute; right: -20px; top: -20px; width: 140px; height: 140px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.p2p-header-left { display: flex; align-items: center; gap: 13px; z-index: 1; padding-left: 6px; }
.p2p-avatar-wrap { position: relative; flex-shrink: 0; }
.p2p-header-icon {
  width: 44px; height: 44px; border-radius: 13px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 14px rgba(124,58,237,.4), 0 0 0 3px rgba(139,92,246,.18);
}
.p2p-online-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 11px; height: 11px; border-radius: 50%;
  background: linear-gradient(135deg,#fbbf24,#f59e0b);
  border: 2px solid #f3e8ff;
}
.p2p-header-title { font-size: 16px; font-weight: 800; color: #3b0764; letter-spacing: -.3px; }
.p2p-header-sub { font-size: 11.5px; color: #7c3aed; margin-top: 2px; font-weight: 500; }

.p2p-header-badge {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 24px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 1.5px solid #fbbf24;
  color: #92400e; font-size: 12px; font-weight: 800;
  letter-spacing: .02em;
  box-shadow: 0 2px 8px rgba(245,158,11,.22);
  z-index: 1;
}
.p2p-badge-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245,158,11,.25);
  animation: p2p-pulse 2s infinite;
}

@keyframes p2p-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: .7; }
}

/* Coming Soon panel */
.p2p-soon {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #ffffff 0%, #faf5ff 60%, #f3e8ff 100%);
  border: 1.5px solid #ddd6fe;
  border-radius: 20px;
  padding: 42px 28px 36px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(124,58,237,.12);
}
.p2p-soon-bg {
  position: absolute; top: -120px; right: -120px;
  width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle, rgba(139,92,246,.25), transparent 70%);
  pointer-events: none;
}
.p2p-soon-bg-2 {
  position: absolute; bottom: -150px; left: -120px;
  width: 340px; height: 340px; border-radius: 50%;
  background: radial-gradient(circle, rgba(236,72,153,.18), transparent 70%);
  pointer-events: none;
}

.p2p-soon-illustration {
  position: relative;
  width: 130px; height: 130px;
  margin: 0 auto 22px;
}
.p2p-soon-illustration-ring {
  position: absolute; inset: 0;
  border-radius: 50%;
  border: 2px dashed;
}
.p2p-ring-1 { border-color: rgba(139,92,246,.3); animation: p2p-spin 18s linear infinite; }
.p2p-ring-2 { inset: 12px; border-color: rgba(124,58,237,.4); animation: p2p-spin 12s linear infinite reverse; }
.p2p-ring-3 { inset: 24px; border-color: rgba(91,33,182,.5); animation: p2p-spin 8s linear infinite; }

@keyframes p2p-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.p2p-soon-illustration-icon {
  position: absolute; inset: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 30px rgba(124,58,237,.5), inset 0 2px 0 rgba(255,255,255,.2);
}

.p2p-soon-eyebrow {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px; border-radius: 24px;
  background: rgba(124,58,237,.1);
  border: 1.5px solid rgba(124,58,237,.25);
  color: #6d28d9; font-size: 11px; font-weight: 800;
  letter-spacing: .1em;
  position: relative; z-index: 1;
}
.p2p-soon-eyebrow-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.25);
}

.p2p-soon-title {
  font-size: 30px; font-weight: 800;
  color: #3b0764;
  letter-spacing: -.6px;
  margin: 14px 0 10px;
  position: relative; z-index: 1;
  background: linear-gradient(135deg, #5b21b6 0%, #7c3aed 60%, #a78bfa 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.p2p-soon-desc {
  max-width: 640px;
  margin: 0 auto;
  font-size: 13.5px; line-height: 1.6;
  color: #5b21b6;
  font-weight: 500;
  position: relative; z-index: 1;
}

.p2p-soon-progress { margin: 24px auto 6px; max-width: 360px; position: relative; z-index: 1; }
.p2p-soon-progress-track {
  width: 100%; height: 8px;
  border-radius: 99px;
  background: rgba(167,139,250,.2);
  overflow: hidden;
  border: 1px solid rgba(124,58,237,.15);
}
.p2p-soon-progress-fill {
  width: 65%; height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #a78bfa, #7c3aed, #5b21b6);
  box-shadow: 0 0 12px rgba(124,58,237,.5);
  animation: p2p-progress 3s ease-in-out infinite alternate;
}
@keyframes p2p-progress {
  from { width: 55%; }
  to { width: 75%; }
}
.p2p-soon-progress-text { margin-top: 8px; font-size: 11px; color: #7c3aed; font-weight: 700; letter-spacing: .03em; }

.p2p-soon-cta-row {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-top: 22px;
  flex-wrap: wrap;
  position: relative; z-index: 1;
}
.p2p-soon-cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 800;
  cursor: pointer;
  text-decoration: none;
  box-shadow: 0 4px 14px rgba(124,58,237,.45);
  transition: transform .15s, box-shadow .15s;
}
.p2p-soon-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(124,58,237,.55); }
.p2p-soon-cta-ghost {
  background: #fff;
  color: #6d28d9;
  border: 1.5px solid #ddd6fe;
  box-shadow: 0 2px 8px rgba(124,58,237,.08);
}
.p2p-soon-cta-ghost:hover { background: #faf5ff; box-shadow: 0 4px 12px rgba(124,58,237,.18); }

/* Preview heading */
.p2p-preview-heading {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; font-weight: 800; color: #3b0764;
  letter-spacing: -.2px;
  padding: 4px 4px;
}
.p2p-preview-bar {
  width: 4px; height: 22px; border-radius: 3px;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
}

/* Preview grid */
.p2p-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.p2p-preview-card {
  position: relative;
  background: #fff;
  border: 1.5px solid #e8e4f9;
  border-radius: 14px;
  padding: 16px 16px 14px;
  display: flex; flex-direction: column; gap: 8px;
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.p2p-preview-card:hover {
  transform: translateY(-3px);
  border-color: #c4b5fd;
  box-shadow: 0 8px 22px rgba(124,58,237,.15);
}
.p2p-preview-icon {
  width: 38px; height: 38px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.p2p-preview-title { font-size: 13.5px; font-weight: 800; color: #3b0764; }
.p2p-preview-desc { font-size: 11.5px; line-height: 1.55; color: #6b7280; margin: 0; flex: 1; }
.p2p-preview-tag {
  display: inline-flex; align-self: flex-start; align-items: center;
  padding: 4px 10px; border-radius: 99px;
  background: rgba(124,58,237,.08);
  border: 1px solid rgba(124,58,237,.18);
  color: #6d28d9; font-size: 9.5px; font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

/* Responsive */
@media (max-width: 980px) { .p2p-preview-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) {
  .p2p-preview-grid { grid-template-columns: 1fr; }
  .p2p-soon-title { font-size: 24px; }
  .p2p-header { flex-direction: column; align-items: flex-start; gap: 12px; }
}

/* ── Dark mode ─────────────────────────────────────────────────────────── */
[data-bs-theme="dark"] .p2p-root {
  background: linear-gradient(160deg, #14102a 0%, #1b1437 45%, #120f26 100%);
  color: #e5e7eb;
}
[data-bs-theme="dark"] .p2p-header {
  background: linear-gradient(110deg, #211a40 0%, #2a2150 45%, #1c1638 100%);
  border-color: rgba(167,139,250,.28);
  box-shadow: 0 8px 28px rgba(0,0,0,.4);
}
[data-bs-theme="dark"] .p2p-header-title { color: #ede9fe; }
[data-bs-theme="dark"] .p2p-header-sub { color: #c4b5fd; }
[data-bs-theme="dark"] .p2p-online-dot { border-color: #211a40; }
[data-bs-theme="dark"] .p2p-soon {
  background: linear-gradient(135deg, #1b1437 0%, #211a40 60%, #1a1535 100%);
  border-color: rgba(167,139,250,.22);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .p2p-soon-eyebrow {
  background: rgba(124,58,237,.20); border-color: rgba(167,139,250,.35); color: #d8b4fe;
}
[data-bs-theme="dark"] .p2p-soon-desc { color: #c4b5fd; }
[data-bs-theme="dark"] .p2p-soon-progress-track { background: rgba(167,139,250,.16); border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .p2p-soon-progress-text { color: #c4b5fd; }
[data-bs-theme="dark"] .p2p-soon-cta-ghost {
  background: rgba(255,255,255,.05); color: #d8b4fe; border-color: rgba(167,139,250,.3);
}
[data-bs-theme="dark"] .p2p-soon-cta-ghost:hover { background: rgba(124,58,237,.18); box-shadow: 0 4px 12px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .p2p-preview-heading { color: #ede9fe; }
[data-bs-theme="dark"] .p2p-preview-card { background: #211a40; border-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .p2p-preview-card:hover { border-color: rgba(167,139,250,.45); box-shadow: 0 8px 22px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .p2p-preview-title { color: #ede9fe; }
[data-bs-theme="dark"] .p2p-preview-desc { color: #94a3b8; }
[data-bs-theme="dark"] .p2p-preview-tag { background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.3); color: #d8b4fe; }
`;
