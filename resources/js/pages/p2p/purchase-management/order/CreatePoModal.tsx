// Create Purchase Order — step 1: choose how the PO links to the procurement workflow.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';

type PoMode = 'with' | 'without';

const CLOSE_MS = 220; // matches the fade-out transition

const ICON_DOC = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 12l1.6 1.6L14 10" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);
const ICON_LINK = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const ICON_ALERT = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const ICON_CHECK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const ICON_CLOCK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const ICON_ARROW = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const ICON_X = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ICON_LINK_SM = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const ICON_CHEV = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ICON_TRI = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

type Shipment = { id: string; customer: string };

// Static sample data until the shipments API is connected.
const SHIPMENTS: Shipment[] = [
  { id: 'SHP-001', customer: 'Reliance Retail Ltd' },
  { id: 'SHP-002', customer: 'Adani Wilmar Ltd' },
  { id: 'SHP-003', customer: 'ITC Foods Division' },
  { id: 'SHP-004', customer: 'BigBasket Retail' },
  { id: 'SHP-005', customer: 'Patanjali Foods Ltd' },
];

const PANEL_MAX = 248;
const PANEL_GAP = 7;

// Custom dropdown. The list uses position:fixed so it can overflow the modal's
// clipped edges; it opens below the trigger, or above when there is more room there.
function ShipmentSelect({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = SHIPMENTS.find((s) => s.id === value) ?? null;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const r = trigger.getBoundingClientRect();
      const contentH = Math.min(panel.scrollHeight, PANEL_MAX);
      const below = window.innerHeight - r.bottom - PANEL_GAP;
      const above = r.top - PANEL_GAP;
      if (below >= contentH || below >= above) {
        setPanelStyle({ left: r.left, width: r.width, top: r.bottom + PANEL_GAP, maxHeight: Math.min(PANEL_MAX, below) });
      } else {
        const h = Math.min(PANEL_MAX, above);
        setPanelStyle({ left: r.left, width: r.width, top: r.top - PANEL_GAP - Math.min(panel.scrollHeight, h), maxHeight: h });
      }
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true); // capture: catches scrolling inside the modal too
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className={`mpv-dd${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="mpv-dd-trigger"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className="mpv-dd-val">
            <span className="mpv-dd-code">{selected.id}</span>
            <span className="mpv-dd-nm">{selected.customer}</span>
          </span>
        ) : (
          <span className="mpv-dd-val ph">Select Shipment ID…</span>
        )}
        <span className="mpv-dd-arr">{ICON_CHEV}</span>
      </button>

      {open && (
        <div className="mpv-dd-panel" ref={panelRef} role="listbox" style={panelStyle}>
          {SHIPMENTS.map((s) => {
            const sel = s.id === value;
            return (
              <div
                key={s.id}
                role="option"
                aria-selected={sel}
                className={`mpv-dd-opt${sel ? ' sel' : ''}`}
                onClick={() => { onChange(s.id); setOpen(false); }}
              >
                <span className="mpv-dd-opt__code">{s.id}</span>
                <div className="mpv-dd-opt__main">
                  <div className="mpv-dd-opt__name">{s.customer}</div>
                </div>
                <span className="mpv-dd-opt__tick">{ICON_CHECK}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OPTIONS: { mode: PoMode; title: string; badge: string; badgeTone: 'ok' | 'warn'; icon: ReactNode; desc: string }[] = [
  {
    mode: 'with', title: 'With Shipment ID', badge: 'Recommended', badgeTone: 'ok',
    icon: ICON_LINK, desc: '3-way match & complete audit trail.',
  },
  {
    mode: 'without', title: 'All Other PO’s (Without Shipment ID)', badge: 'Standalone', badgeTone: 'warn',
    icon: ICON_ALERT, desc: 'Create a PO not linked to any shipment.',
  },
];

// Parent renders this only while open; closing animates out, then calls onClose.
export default function CreatePoModal({ onClose }: { onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<PoMode | null>(null);
  const [shipment, setShipment] = useState<string | null>(null);
  const [shipError, setShipError] = useState(false);

  const chooseShipment = (id: string) => {
    setShipment(id);
    setShipError(false);
  };

  // "With Shipment ID" needs a shipment before continuing.
  const confirm = () => {
    if (mode === 'with' && !shipment) {
      setShipError(true);
      return;
    }
    // Next step: open the PO form.
  };

  useScrollLock(true, '.cpo-ov');

  // Add "is-open" one frame after mounting so the fade/scale-in transition runs.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const closing = useRef(false);
  const close = () => {
    if (closing.current) return; // ignore a second Esc/click while fading out
    closing.current = true;
    setShown(false);
    window.setTimeout(onClose, CLOSE_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Portal to <body>: the fixed overlay covers the whole app, header included.
  return createPortal(
    // No close on backdrop click: a stray click must not lose the user's choices.
    <div className={`cpo-ov${shown ? ' is-open' : ''}`}>
      <style>{CREATE_PO_CSS}</style>
      <div className="cpo-modal" role="dialog" aria-modal="true" aria-labelledby="cpo-title">
        <div className="cpo-hd">
          <div className="cpo-hd__ico">{ICON_DOC}</div>
          <div className="cpo-hd__mid">
            <div className="cpo-hd__t" id="cpo-title">Create Purchase Order</div>
            <div className="cpo-hd__s">Choose how to link this PO to your procurement workflow.</div>
          </div>
          <button type="button" className="cpo-hd__x" onClick={close} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="cpo-bd">
          <div className="cpo-sec">Link to procurement workflow</div>

          <div role="radiogroup" aria-label="PO link type">
            {OPTIONS.map((opt) => {
              const on = mode === opt.mode;
              return (
                <div className="cpo-optwrap" key={opt.mode}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`cpo-opt cpo-opt--${opt.mode}${on ? ' is-on' : ''}`}
                    onClick={() => setMode(opt.mode)}
                  >
                    <span className="cpo-opt__ico">{opt.icon}</span>
                    <span className="cpo-opt__body">
                      <span className="cpo-opt__top">
                        <span className="cpo-opt__title">{opt.title}</span>
                        <span className={`cpo-opt__badge cpo-opt__badge--${opt.badgeTone}`}>{opt.badge}</span>
                      </span>
                      <span className="cpo-opt__desc">{opt.desc}</span>
                    </span>
                    <span className="cpo-opt__rad">{ICON_CHECK}</span>
                  </button>

                  {on && opt.mode === 'with' && (
                    <div className="cpo-reveal">
                      <label className="cpo-lbl">
                        {ICON_LINK_SM} Select Shipment ID <span className="cpo-req">*</span>
                      </label>
                      <ShipmentSelect value={shipment} onChange={chooseShipment} />
                      {shipError && (
                        <div className="cpo-err" role="alert">{ICON_ALERT} Please select a Shipment ID to continue.</div>
                      )}
                    </div>
                  )}

                  {on && opt.mode === 'without' && (
                    <div className="cpo-reveal">
                      <div className="cpo-note">
                        {ICON_TRI}
                        <span>
                          <b>Standalone purchase order</b> — won't be linked to any shipment. Proceed directly to the PO form.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cpo-ft">
            <span className="cpo-ft__note">{ICON_CLOCK} All POs are audit-tracked</span>
            <div className="cpo-ft__b">
              <button type="button" className="cpo-btn cpo-btn--g" onClick={close}>Cancel</button>
              <button type="button" className="cpo-btn cpo-btn--p" disabled={!mode} onClick={confirm}>
                Confirm &amp; Continue {ICON_ARROW}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CREATE_PO_CSS = `
.cpo-ov {
  position: fixed;
  inset: 0;
  z-index: 10000010;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(8, 47, 73, .5);
  backdrop-filter: blur(8px) saturate(1.05);
  -webkit-backdrop-filter: blur(8px) saturate(1.05);
  font-family: 'DM Sans', system-ui, sans-serif;
  letter-spacing: 0;
  opacity: 0;
  transition: opacity .24s;
}
.cpo-ov.is-open { opacity: 1; }

.cpo-modal {
  position: relative;
  width: min(540px, 100%);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid #a5f3fc;
  border-radius: 20px;
  box-shadow: 0 30px 80px rgba(8, 47, 73, .5), 0 0 0 1px rgba(165, 243, 252, .6);
  opacity: .6;
  transform: translateY(16px) scale(.97);
  transition: transform .3s cubic-bezier(.16, 1, .3, 1), opacity .3s;
}
.cpo-ov.is-open .cpo-modal {
  opacity: 1;
  transform: none;
}

/* Header */
.cpo-hd {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  color: #fff;
  background: linear-gradient(110deg, #0e7490, #0891b2 50%, #06b6d4 80%, #22d3ee);
}
.cpo-hd::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 0% 120%, rgba(8, 47, 73, .35), transparent 55%);
}
.cpo-hd::after {
  content: '';
  position: absolute;
  top: -60%;
  right: -5%;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle, rgba(255, 255, 255, .28), transparent 65%);
}
.cpo-hd > * {
  position: relative;
  z-index: 1;
}
.cpo-hd__ico {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  color: #0891b2;
  background: rgba(255, 255, 255, .96);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .7), 0 4px 12px rgba(8, 47, 73, .25);
}
.cpo-hd__mid {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}
.cpo-hd__t {
  font-size: 16.5px;
  font-weight: 800;
  letter-spacing: -.4px;
  color: #fff;
}
.cpo-hd__s {
  margin-top: 3px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  color: rgba(255, 255, 255, .9);
}
.cpo-hd__x {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 10px;
  color: #fff;
  background: rgba(255, 255, 255, .2);
  cursor: pointer;
  transition: background .15s, color .15s;
}
.cpo-hd__x:hover {
  background: rgba(255, 255, 255, .36);
  transform: rotate(90deg);
}

/* Body */
.cpo-bd {
  overflow-y: auto;
  padding: 16px 18px 18px;
  background: linear-gradient(180deg, #f6fdfe 0%, #fff 18%);
}
.cpo-sec {
  margin: 6px 0 12px;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: #9bb0bf;
}

/* Options */
.cpo-optwrap + .cpo-optwrap { margin-top: 11px; }
.cpo-opt {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 15px 16px;
  border: 1.5px solid #e6eef3;
  border-radius: 16px;
  background: linear-gradient(170deg, #fff, #f7fcfe);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), inset 0 1px 0 rgba(255, 255, 255, .6);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .16s, box-shadow .16s, background .16s, transform .12s;
}
.cpo-opt::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: transparent;
  transition: background .18s;
}
.cpo-opt:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px -10px rgba(8, 145, 178, .22);
}
.cpo-opt:focus-visible {
  outline: 2px solid #0891b2;
  outline-offset: 2px;
}
.cpo-opt__ico {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  transition: all .16s;
}
.cpo-opt--with .cpo-opt__ico {
  color: #0891b2;
  background: #e0f7fb;
  box-shadow: 0 4px 12px -2px rgba(8, 145, 178, .22), inset 0 1px 0 rgba(255, 255, 255, .5);
}
.cpo-opt--without .cpo-opt__ico {
  color: #d97706;
  background: #fef3c7;
  box-shadow: 0 4px 12px -2px rgba(217, 119, 6, .22), inset 0 1px 0 rgba(255, 255, 255, .5);
}
.cpo-opt__body {
  flex: 1;
  min-width: 0;
}
.cpo-opt__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.cpo-opt__title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -.2px;
  color: #0c2c3a;
}
.cpo-opt__badge {
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .07em;
  line-height: 1.5;
  text-transform: uppercase;
}
.cpo-opt__badge--ok   { color: #0e7490; background: #e0f7fb; }
.cpo-opt__badge--warn { color: #b45309; background: #fef3c7; }
.cpo-opt__desc {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  color: #6a869c;
}
.cpo-opt__rad {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid #d3dde6;
  border-radius: 50%;
  color: transparent;
  background: #fff;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .06);
  transition: all .15s;
}

/* Selected option */
.cpo-opt--with.is-on {
  border-color: #0891b2;
  background: linear-gradient(120deg, #f2feff, #e3f8fc);
  box-shadow: 0 10px 26px -10px rgba(8, 145, 178, .4);
}
.cpo-opt--with.is-on::before { background: linear-gradient(180deg, #22d3ee, #0891b2); }
.cpo-opt--with.is-on .cpo-opt__ico {
  color: #fff;
  background: linear-gradient(140deg, #22d3ee, #0891b2);
  box-shadow: 0 8px 18px -3px rgba(8, 145, 178, .55), inset 0 1px 0 rgba(255, 255, 255, .4);
}
.cpo-opt--with.is-on .cpo-opt__rad {
  color: #fff;
  background: #0891b2;
  border-color: #0891b2;
}
.cpo-opt--without.is-on {
  border-color: #f59e0b;
  background: linear-gradient(120deg, #fffdf3, #fef3c7);
  box-shadow: 0 10px 26px -10px rgba(217, 119, 6, .38);
}
.cpo-opt--without.is-on::before { background: linear-gradient(180deg, #fbbf24, #d97706); }
.cpo-opt--without.is-on .cpo-opt__ico {
  color: #fff;
  background: linear-gradient(140deg, #fbbf24, #d97706);
  box-shadow: 0 8px 18px -3px rgba(217, 119, 6, .55), inset 0 1px 0 rgba(255, 255, 255, .4);
}
.cpo-opt--without.is-on .cpo-opt__rad {
  color: #fff;
  background: #f59e0b;
  border-color: #f59e0b;
}

/* Section revealed under the chosen option */
.cpo-reveal {
  margin-top: 13px;
  animation: cpoRev .28s cubic-bezier(.16, 1, .3, 1);
}
@keyframes cpoRev {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: none; }
}
.cpo-lbl {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #0891b2;
}
.cpo-lbl svg {
  flex-shrink: 0;
  color: #0891b2;
}
.cpo-req { color: #ef4444; }
.cpo-err {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 9px;
  padding: 9px 12px;
  border: 1px solid #fecaca;
  border-radius: 11px;
  background: #fef2f2;
  font-size: 10.5px;
  font-weight: 600;
  color: #ef4444;
}
.cpo-err svg { flex-shrink: 0; }
.cpo-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 14px;
  border: 1px solid #fde68a;
  border-radius: 13px;
  background: linear-gradient(110deg, #fffbeb, #fff7e6);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.45;
  color: #92400e;
}
.cpo-note svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: #d97706;
}
.cpo-note b { color: #b45309; }

/* Shipment dropdown */
.mpv-dd { position: relative; }
.mpv-dd-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  height: 42px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  outline: none;
  background: #f8fafc;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.mpv-dd-trigger:hover {
  border-color: #bfe6ef;
  background: #fff;
}
.mpv-dd.open .mpv-dd-trigger,
.mpv-dd-trigger:focus-visible {
  border-color: #22d3ee;
  background: #fff;
  box-shadow: 0 0 0 4px rgba(34, 211, 238, .15);
}
.mpv-dd-val {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.mpv-dd-val.ph {
  font-weight: 500;
  color: #9aacb8;
}
.mpv-dd-nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mpv-dd-code,
.mpv-dd-opt__code {
  flex-shrink: 0;
  border: 1px solid #cffafe;
  border-radius: 5px;
  font-family: 'Geist Mono', ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  color: #0c4a6e;
}
.mpv-dd-code {
  padding: 1px 7px;
  background: #ecfeff;
}
.mpv-dd-arr {
  flex-shrink: 0;
  display: flex;
  color: #0891b2;
  transition: transform .2s cubic-bezier(.22, 1, .36, 1);
}
.mpv-dd.open .mpv-dd-arr { transform: rotate(180deg); }

.mpv-dd-panel {
  position: fixed;
  z-index: 10000020;
  box-sizing: border-box;
  max-height: 248px;
  overflow-y: auto;
  padding: 5px;
  border: 1.5px solid #e0eef3;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 44px -12px rgba(8, 40, 60, .34), 0 0 0 1px rgba(8, 40, 60, .04);
  animation: mpvFieldIn .2s ease;
}
@keyframes mpvFieldIn {
  from { opacity: 0; transform: translateY(7px); }
  to   { opacity: 1; transform: none; }
}
.mpv-dd-panel::-webkit-scrollbar { width: 9px; }
.mpv-dd-panel::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 8px;
  background: #bfe3ec;
  background-clip: padding-box;
}
.mpv-dd-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  transition: background .12s;
}
.mpv-dd-opt:hover { background: #f0fbfe; }
.mpv-dd-opt.sel { background: linear-gradient(135deg, #ecfeff, #e0fafe); }
.mpv-dd-opt__code {
  padding: 2px 7px;
  background: #fff;
}
.mpv-dd-opt__main {
  flex: 1;
  min-width: 0;
}
.mpv-dd-opt__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
}
.mpv-dd-opt__tick {
  flex-shrink: 0;
  display: flex;
  margin-left: auto;
  color: #0891b2;
  opacity: 0;
  transition: opacity .12s;
}
.mpv-dd-opt.sel .mpv-dd-opt__tick { opacity: 1; }

/* Footer */
.cpo-ft {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #eef4f7;
}
.cpo-ft__note {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid #e8eff3;
  border-radius: 20px;
  background: #f5f9fb;
  font-size: 10px;
  font-weight: 600;
  color: #8aa0af;
}
.cpo-ft__note svg { flex-shrink: 0; }
.cpo-ft__b {
  display: flex;
  gap: 10px;
}
.cpo-btn {
  padding: 12px 22px;
  border: none;
  border-radius: 13px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .15s, box-shadow .15s, opacity .15s, background .15s;
}
.cpo-btn--g {
  color: #475569;
  background: #fff;
  border: 1.5px solid #e2e8f0;
}
.cpo-btn--g:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}
.cpo-btn--p {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #fff;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .2), rgba(255, 255, 255, 0) 50%),
    linear-gradient(135deg, #0e7490, #0891b2 55%, #06b6d4);
  box-shadow: 0 8px 20px -4px rgba(8, 145, 178, .5);
}
.cpo-btn--p:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -4px rgba(8, 145, 178, .6);
}
.cpo-btn--p:disabled {
  opacity: .45;
  cursor: default;
  box-shadow: none;
}
.cpo-btn:focus-visible {
  outline: 2px solid #0891b2;
  outline-offset: 2px;
}

/* Dark mode */
[data-bs-theme="dark"] .cpo-modal {
  background: #0f172a;
  border-color: rgba(6, 182, 212, .35);
  box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
}
[data-bs-theme="dark"] .cpo-bd { background: linear-gradient(180deg, #102234 0%, #0f172a 18%); }
[data-bs-theme="dark"] .cpo-sec { color: #64748b; }
[data-bs-theme="dark"] .cpo-opt {
  background: #1e293b;
  border-color: rgba(6, 182, 212, .18);
  box-shadow: none;
}
[data-bs-theme="dark"] .cpo-opt__title { color: #e2e8f0; }
[data-bs-theme="dark"] .cpo-opt__desc { color: #94a3b8; }
[data-bs-theme="dark"] .cpo-opt--with .cpo-opt__ico { color: #67e8f9; background: rgba(8, 145, 178, .18); box-shadow: none; }
[data-bs-theme="dark"] .cpo-opt--without .cpo-opt__ico { color: #fbbf24; background: rgba(245, 158, 11, .16); box-shadow: none; }
[data-bs-theme="dark"] .cpo-opt__badge--ok { color: #67e8f9; background: rgba(8, 145, 178, .18); }
[data-bs-theme="dark"] .cpo-opt__badge--warn { color: #fcd34d; background: rgba(245, 158, 11, .16); }
[data-bs-theme="dark"] .cpo-opt__rad { background: #0f172a; border-color: #475569; box-shadow: none; }
[data-bs-theme="dark"] .cpo-opt--with.is-on {
  background: rgba(8, 145, 178, .14);
  border-color: #0891b2;
}
[data-bs-theme="dark"] .cpo-opt--without.is-on {
  background: rgba(245, 158, 11, .12);
  border-color: #f59e0b;
}
[data-bs-theme="dark"] .cpo-opt--with.is-on .cpo-opt__rad { background: #0891b2; border-color: #0891b2; }
[data-bs-theme="dark"] .cpo-opt--without.is-on .cpo-opt__rad { background: #f59e0b; border-color: #f59e0b; }
[data-bs-theme="dark"] .cpo-ft { border-top-color: rgba(6, 182, 212, .15); }
[data-bs-theme="dark"] .cpo-ft__note { color: #94a3b8; background: rgba(255, 255, 255, .04); border-color: rgba(148, 163, 184, .18); }
[data-bs-theme="dark"] .cpo-btn--g { color: #cbd5e1; background: #1e293b; border-color: rgba(148, 163, 184, .25); }
[data-bs-theme="dark"] .cpo-btn--g:hover { background: #273449; border-color: rgba(148, 163, 184, .4); }

[data-bs-theme="dark"] .cpo-lbl,
[data-bs-theme="dark"] .cpo-lbl svg { color: #67e8f9; }
[data-bs-theme="dark"] .cpo-err { color: #fca5a5; background: rgba(239, 68, 68, .12); border-color: rgba(239, 68, 68, .35); }
[data-bs-theme="dark"] .cpo-note { color: #fcd34d; background: rgba(245, 158, 11, .12); border-color: rgba(245, 158, 11, .35); }
[data-bs-theme="dark"] .cpo-note b { color: #fde68a; }
[data-bs-theme="dark"] .mpv-dd-trigger { color: #e2e8f0; background: #1e293b; border-color: rgba(148, 163, 184, .25); }
[data-bs-theme="dark"] .mpv-dd.open .mpv-dd-trigger,
[data-bs-theme="dark"] .mpv-dd-trigger:hover { background: #1e293b; border-color: #22d3ee; }
[data-bs-theme="dark"] .mpv-dd-val.ph { color: #64748b; }
[data-bs-theme="dark"] .mpv-dd-code,
[data-bs-theme="dark"] .mpv-dd-opt__code { color: #67e8f9; background: rgba(8, 145, 178, .16); border-color: rgba(6, 182, 212, .35); }
[data-bs-theme="dark"] .mpv-dd-panel { background: #0f172a; border-color: rgba(6, 182, 212, .30); box-shadow: 0 18px 44px -12px rgba(0, 0, 0, .7); }
[data-bs-theme="dark"] .mpv-dd-opt__name { color: #e2e8f0; }
[data-bs-theme="dark"] .mpv-dd-opt:hover { background: rgba(8, 145, 178, .14); }
[data-bs-theme="dark"] .mpv-dd-opt.sel { background: rgba(8, 145, 178, .22); }

/* Responsive */
@media (max-width: 600px) {
  .cpo-ov {
    align-items: flex-start;
    overflow-y: auto;
    padding: 12px;
  }
  .cpo-modal {
    max-height: none;
    margin: 6px 0;
  }
  .cpo-hd { padding: 14px; gap: 11px; }
  .cpo-hd__ico { width: 40px; height: 40px; }
  .cpo-hd__t { font-size: 15.5px; }
  .cpo-hd__s { font-size: 11px; }
  .cpo-bd { padding: 14px; }
  .cpo-sec { margin: 4px 0 10px; }
  .cpo-opt { padding: 13px 12px; gap: 12px; }
  .cpo-opt__ico { width: 42px; height: 42px; }
  .cpo-opt__title { font-size: 14px; }
  .cpo-opt__desc { font-size: 10.5px; }
  .cpo-ft__b .cpo-btn {
    flex: 1;
    justify-content: center;
    text-align: center;
  }
}
@media (max-width: 560px) {
  .cpo-ft {
    flex-direction: column;
    align-items: stretch;
  }
  .cpo-ft__b { justify-content: flex-end; }
}
@media (max-width: 380px) {
  .cpo-opt { gap: 10px; padding: 12px 11px; }
  .cpo-opt__ico { width: 38px; height: 38px; }
  .cpo-opt__rad { width: 22px; height: 22px; }
}
`;
