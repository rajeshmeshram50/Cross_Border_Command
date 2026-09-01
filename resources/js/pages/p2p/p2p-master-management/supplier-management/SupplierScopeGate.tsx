import { useEffect, useState } from 'react';

/**
 * SupplierScopeGate — the Domestic / International question that stands in
 * front of "Add Supplier".
 *
 * Ported from the P2P prototype's `openSupplierTypeChoice` gate. It exists
 * because the answer changes the FORM, not just a label — a domestic supplier
 * is an India/GST entity and an international one is explicitly not, so Country
 * cannot offer the same list to both. Asking once up front is what lets the
 * form stop guessing.
 *
 * SELECT, then CONTINUE. An earlier version committed the moment a card was
 * clicked, which made a mis-click an irreversible jump into the wrong form.
 * The prototype separates the two — clicking a card only marks it (border,
 * glow and a tick in the corner), and Continue stays disabled until something
 * is picked — so the choice can be changed before it costs anything.
 *
 * Deliberately NOT shown when editing: an existing supplier's scope is already
 * settled by the country on record, and re-asking would invite someone to flip
 * it by accident.
 */

export type SupplierScope = 'domestic' | 'international';

type Props = {
  onChoose: (scope: SupplierScope) => void;
  onClose: () => void;
};

const SCOPED_CSS = `
.supch-ov {
  position: fixed; inset: 0; z-index: 1090;
  display: flex; align-items: center; justify-content: center;
  padding: 20px; box-sizing: border-box;
  background: rgba(20,10,40,.68);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  animation: supchFade .18s ease;
}
@keyframes supchFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes supchIn {
  from { opacity: 0; transform: translateY(16px) scale(.96) }
  to   { opacity: 1; transform: none }
}

.supch-box {
  background: #fff; border-radius: 22px;
  width: min(680px, calc(100vw - 28px)); max-height: calc(100vh - 44px);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 40px 100px -16px rgba(76,29,149,.45), 0 0 0 1px rgba(167,139,250,.25);
  animation: supchIn .28s cubic-bezier(.34,1.4,.64,1);
}

/* ── Header ── */
.supch-header {
  position: relative; overflow: hidden; padding: 22px 24px;
  background: linear-gradient(135deg,#2e1065 0%,#4c1d95 35%,#6d28d9 70%,#7c3aed 100%);
}
.supch-header-pattern {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(circle at 88% 15%, rgba(255,255,255,.14) 0%, transparent 45%),
    radial-gradient(circle at 10% 95%, rgba(255,255,255,.08) 0%, transparent 40%);
}
.supch-hrow { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.supch-title-wrap { display: flex; align-items: center; gap: 14px; min-width: 0; }
.supch-hicon {
  width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(255,255,255,.3), rgba(255,255,255,.08));
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
}
.supch-title { font-family: inherit; font-size: 19px; font-weight: 800; color: #fff; letter-spacing: -.3px; margin: 0; line-height: 1.2; }
.supch-sub { font-family: inherit; font-size: 12px; color: rgba(255,255,255,.8); font-weight: 500; margin: 3px 0 0; }
.supch-close {
  width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2);
  color: #fff; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.supch-close:hover { background: rgba(255,255,255,.26); }

/* ── The two choices ── */
.supch-body { padding: 22px 24px 6px; background: #fbfaff; overflow-y: auto; }
.supch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .supch-grid { grid-template-columns: 1fr; } }

.supch-card {
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; align-items: stretch; text-align: left; gap: 10px;
  border-radius: 16px; padding: 18px;
  border: 2px solid #ece7fc; background: #fff; cursor: pointer;
  font-family: inherit; width: 100%;
  transition: all .22s cubic-bezier(.34,1.4,.64,1);
}
.supch-card:hover { border-color: #c4b5fd; box-shadow: 0 10px 28px -8px rgba(124,58,237,.22); transform: translateY(-3px); }
.supch-card:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
.supch-card.is-selected {
  border-color: #7c3aed;
  background: linear-gradient(180deg,#faf8ff,#f5f3ff);
  box-shadow: 0 12px 30px -10px rgba(124,58,237,.32), 0 0 0 4px rgba(124,58,237,.08);
  transform: translateY(-2px);
}
/* Soft radial bloom off the top-right corner — the thing that makes a hovered
   card read as "live" rather than merely outlined. */
.supch-glow {
  position: absolute; top: -35px; right: -35px; width: 130px; height: 130px;
  border-radius: 50%; pointer-events: none; opacity: 0; transition: opacity .3s;
  background: radial-gradient(circle, rgba(124,58,237,.16) 0%, transparent 70%);
}
.supch-card:hover .supch-glow, .supch-card.is-selected .supch-glow { opacity: 1; }
/* Corner tick — hidden until the card is the chosen one, so at a glance the
   dialog says which way you are about to go. */
.supch-check {
  position: absolute; top: 12px; right: 12px; width: 22px; height: 22px;
  border-radius: 50%; background: #fff; border: 2px solid #ddd6fe;
  display: flex; align-items: center; justify-content: center;
  color: transparent; opacity: 0; transform: scale(.6);
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
}
.supch-card.is-selected .supch-check {
  background: linear-gradient(135deg,#a78bfa,#7c3aed); border-color: transparent;
  color: #fff; opacity: 1; transform: scale(1);
  box-shadow: 0 3px 8px rgba(124,58,237,.4);
}
.supch-iconbox {
  width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#ede9fe,#c4b5fd); color: #7c3aed;
  box-shadow: 0 4px 14px rgba(124,58,237,.22);
  transition: transform .22s cubic-bezier(.34,1.56,.64,1);
}
.supch-card:hover .supch-iconbox, .supch-card.is-selected .supch-iconbox { transform: scale(1.08) rotate(-3deg); }
.supch-card-title { font-family: inherit; font-size: 14.5px; font-weight: 800; color: #1e1b3a; letter-spacing: -.2px; }
.supch-card-desc { font-family: inherit; font-size: 11px; color: #6b6485; font-weight: 500; line-height: 1.4; margin-top: -4px; }
.supch-divider { height: 1px; margin: 2px 0; background: linear-gradient(90deg, transparent, #e9e4fb, transparent); }
.supch-pills { display: flex; gap: 5px; flex-wrap: wrap; }
.supch-pill {
  display: inline-flex; align-items: center; gap: 3px;
  font-family: inherit; font-size: 9.5px; font-weight: 700;
  padding: 4px 9px; border-radius: 999px;
  background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe;
}

/* ── Footer ── */
.supch-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 22px; background: #fbfaff; }
.supch-btn-cancel {
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #6b6485;
  background: #fff; border: 1.5px solid #e5e0f5; border-radius: 10px;
  padding: 10px 20px; cursor: pointer; transition: all .15s;
}
.supch-btn-cancel:hover { background: #f5f3ff; border-color: #ddd6fe; }
.supch-btn-continue {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: inherit; font-size: 12.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg,#a78bfa,#7c3aed 60%,#6d28d9);
  border: none; border-radius: 10px; padding: 10px 22px; cursor: pointer;
  transition: all .18s; box-shadow: 0 6px 18px -4px rgba(124,58,237,.5);
}
.supch-btn-continue:hover { box-shadow: 0 8px 22px -4px rgba(124,58,237,.6); transform: translateY(-1px); }
.supch-btn-continue:disabled { background: #e5e0f5; color: #a9a0c9; cursor: not-allowed; box-shadow: none; transform: none; }

/* ── Dark ──
   Only the white surfaces are restated. The header keeps its violet ramp (it
   is already dark) and the cards keep their violet accents, so the selected /
   hovered states stay exactly as recognisable as in light mode. */
[data-bs-theme="dark"] .supch-box,
[data-layout-mode="dark"] .supch-box { background: var(--vz-card-bg); }
[data-bs-theme="dark"] .supch-body, [data-bs-theme="dark"] .supch-footer,
[data-layout-mode="dark"] .supch-body, [data-layout-mode="dark"] .supch-footer { background: var(--vz-card-bg); }
[data-bs-theme="dark"] .supch-card,
[data-layout-mode="dark"] .supch-card { background: rgba(255,255,255,.03); border-color: var(--vz-border-color); }
[data-bs-theme="dark"] .supch-card.is-selected,
[data-layout-mode="dark"] .supch-card.is-selected { background: rgba(124,58,237,.16); border-color: #8b5cf6; }
[data-bs-theme="dark"] .supch-card-title,
[data-layout-mode="dark"] .supch-card-title { color: var(--vz-heading-color, #fff); }
[data-bs-theme="dark"] .supch-card-desc,
[data-layout-mode="dark"] .supch-card-desc { color: var(--vz-body-color); }
[data-bs-theme="dark"] .supch-pill,
[data-layout-mode="dark"] .supch-pill { background: rgba(124,58,237,.2); color: #c4b5fd; border-color: rgba(167,139,250,.32); }
[data-bs-theme="dark"] .supch-check,
[data-layout-mode="dark"] .supch-check { background: var(--vz-card-bg); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .supch-divider,
[data-layout-mode="dark"] .supch-divider { background: linear-gradient(90deg, transparent, rgba(167,139,250,.28), transparent); }
[data-bs-theme="dark"] .supch-btn-cancel,
[data-layout-mode="dark"] .supch-btn-cancel { background: transparent; color: var(--vz-body-color); border-color: var(--vz-border-color); }
[data-bs-theme="dark"] .supch-btn-continue:disabled,
[data-layout-mode="dark"] .supch-btn-continue:disabled { background: rgba(255,255,255,.08); color: rgba(255,255,255,.35); }
`;

/** The check glyph shared by the corner tick and every feature pill. */
function Tick({ size, width }: { size: number; width: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const OPTIONS: Array<{
  key: SupplierScope;
  title: string;
  desc: string;
  pills: string[];
  icon: React.ReactNode;
}> = [
  {
    key: 'domestic',
    title: 'Domestic Supplier',
    desc: 'Supplier registered and operating within India',
    pills: ['GST', 'PAN', 'Instant'],
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: 'international',
    title: 'International Supplier',
    desc: 'Supplier registered and operating outside India',
    pills: ['Export Docs', 'Customs', 'Forex'],
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <line x1="2.5" y1="12" x2="21.5" y2="12" />
        <path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
      </svg>
    ),
  },
];

export default function SupplierScopeGate({ onChoose, onClose }: Props) {
  const [selected, setSelected] = useState<SupplierScope | null>(null);

  // Esc closes, and the page behind must not scroll while this is up. The
  // lock has to cover <html> as well as <body> — body alone leaves the
  // document element scrolling behind the backdrop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [onClose]);

  return (
    <>
      <style>{SCOPED_CSS}</style>
      {/* Backdrop dismisses, as the prototype does. Safe here in a way it would
          not be over the form this leads to: nothing has been typed yet, and
          re-opening costs one click. */}
      <div className="supch-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="supch-box" role="dialog" aria-modal="true" aria-label="Choose supplier origin">
          <div className="supch-header">
            <div className="supch-header-pattern" />
            <div className="supch-hrow">
              <div className="supch-title-wrap">
                <div className="supch-hicon">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                </div>
                <div>
                  <h3 className="supch-title">Add Supplier</h3>
                  <p className="supch-sub">Choose the supplier&rsquo;s origin to continue</p>
                </div>
              </div>
              <button type="button" className="supch-close" onClick={onClose} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="supch-body">
            <div className="supch-grid">
              {OPTIONS.map(opt => (
                /* A real <button> rather than the prototype's <div>: this is a
                   choice in a two-option group, so it has to be reachable and
                   operable from the keyboard. aria-pressed carries the selected
                   state that the border and tick show visually. */
                <button
                  key={opt.key}
                  type="button"
                  className={`supch-card${selected === opt.key ? ' is-selected' : ''}`}
                  aria-pressed={selected === opt.key}
                  onClick={() => setSelected(opt.key)}
                  /* Double-click commits — the same shortcut the old
                     click-to-go gate gave, without making a single stray
                     click irreversible. */
                  onDoubleClick={() => onChoose(opt.key)}
                >
                  <span className="supch-glow" />
                  <span className="supch-check"><Tick size={12} width={3.2} /></span>
                  <span className="supch-iconbox">{opt.icon}</span>
                  <span className="supch-card-title">{opt.title}</span>
                  <span className="supch-card-desc">{opt.desc}</span>
                  <span className="supch-divider" />
                  <span className="supch-pills">
                    {opt.pills.map(p => (
                      <span className="supch-pill" key={p}><Tick size={8} width={3} />{p}</span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="supch-footer">
            <button type="button" className="supch-btn-cancel" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="supch-btn-continue"
              disabled={!selected}
              onClick={() => selected && onChoose(selected)}
            >
              Continue
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
