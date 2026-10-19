/**
 * Stage 04 — "What We Are Doing Here".
 *
 * The brief that sits under the previous-stages summary: what this stage is
 * for, which warehouse it is happening in, and the four moves it takes. The
 * same `bref-box` shape the app uses for this elsewhere (Shipment 360, the CLM
 * masters), in its teal variant.
 *
 * Deliberately NOT a progress tracker. The four items describe the work; the
 * strip inside the right panel is the one that says where you have got to.
 * Two things both claiming to be "the steps" is what made the old four-circle
 * lifecycle confusing next to this.
 */
import { useState } from 'react';

const IcoGridSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const IcoChevD = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
);

const I = {
  box: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  grid: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  qr: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="5" rx="1" /><rect x="8" y="3" width="5" height="5" rx="1" />
      <rect x="13" y="3" width="5" height="5" rx="1" /><rect x="3" y="8" width="5" height="5" rx="1" />
      <rect x="13" y="8" width="5" height="5" rx="1" /><rect x="3" y="13" width="5" height="5" rx="1" />
      <rect x="8" y="13" width="5" height="5" rx="1" /><rect x="13" y="13" width="5" height="5" rx="1" />
    </svg>
  ),
  done: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
};

const ITEMS = [
  { no: 'Step 01', ico: I.box,  title: 'Pick Box',                 desc: 'Select the box for rack allocation.' },
  { no: 'Step 02', ico: I.grid, title: 'Get Rack Suggestion',      desc: 'System suggests the best storage location.' },
  { no: 'Step 03', ico: I.qr,   title: 'Scan & Confirm Placement', desc: 'Scan box and rack QR to lock placement.' },
  { no: 'Step 04', ico: I.done, title: 'Complete Allocation',      desc: 'Repeat for remaining boxes and finish allocation.' },
];

export default function PutawayStageBrief({ warehouse }: { warehouse?: string | null }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`s4bref bref-box bref-box--teal${open ? '' : ' is-collapsed'}`}>
      {/* A button, not a clickable div: this collapses a region, so it has to
          be reachable from the keyboard. */}
      <button
        type="button"
        className="bref-box__header"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <div className="bref-box__header-ico"><IcoGridSm /></div>
        <div className="bref-box__header-mid">
          <div className="bref-box__header-row">
            <div className="bref-box__header-label">Stage 04 · Temporary Putaway Allocation</div>
            <div className="bref-box__header-sep" />
            <div className="bref-box__header-title">What We Are Doing Here</div>
          </div>
          <div className="bref-box__header-sub">
            Assigning each labelled box to a temporary staging location and confirming physical placement in the warehouse.
          </div>
        </div>
        <div className="bref-box__header-right">
          {/* Which warehouse this is happening in — the one fact on this strip
              that changes between invoices. */}
          {warehouse && <span className="s4bref-wh">{warehouse}</span>}
          <div className="bref-box__toggle"><IcoChevD /></div>
        </div>
      </button>
      <div className="bref-box__body">
        {ITEMS.map(it => (
          <div className="bref-item" key={it.no}>
            <div className="bref-item__top">
              <div className="bref-item__ico">{it.ico}</div>
              <span className="bref-item__num">{it.no}</span>
            </div>
            <div className="bref-item__title">{it.title}</div>
            <div className="bref-item__desc">{it.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
