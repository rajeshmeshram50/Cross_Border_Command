import { useLocation, useNavigate } from 'react-router-dom';
import '../../../css/master.css';


const CSS = `
.mc-back-btn {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 40px; padding: 0 18px; margin-left: auto; flex-shrink: 0;
  border: 1px solid rgba(8, 145, 178, .4); border-radius: 12px;
  background: rgba(255, 255, 255, .82); color: #0e7490; text-shadow: none;
  font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: .02em; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(8, 145, 178, .12);
  cursor: pointer; transition: background .15s, transform .14s, box-shadow .14s;
}
.mc-back-btn:hover { background: #fff; transform: translateY(-1px); box-shadow: 0 5px 16px rgba(8, 145, 178, .22); }
.mc-back-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.spi-head > .mc-back-btn { margin-right: 8px; }
[data-bs-theme="dark"] .mc-back-btn { background: linear-gradient(135deg, #0e7490, #0891b2); border-color: transparent; color: #ecfeff; box-shadow: none; }
[data-bs-theme="dark"] .mc-back-btn:hover { background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff; filter: brightness(1.08); box-shadow: 0 6px 16px -6px rgba(8, 145, 178, .6); }
@media (max-width: 640px) { .mc-back-btn { margin-left: 0; } }
`;

export default function MasterBackButton() {
  const loc = useLocation();
  const navigate = useNavigate();
  /* The route decides: every master the Master Control Center opens lives
     under /master/... (Inventory masters at /master/inventory/...), while the
     same pages reached from their own module menu do not. */
  const fromMaster = loc.pathname.startsWith('/master/');
  if (!fromMaster) return null;
  return (
    <>
      <style>{CSS}</style>
      <button type="button" className="mc-back-btn" onClick={() => navigate('/master')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
        Back to Master List
      </button>
    </>
  );
}
