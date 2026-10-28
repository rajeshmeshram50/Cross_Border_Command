import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* The compact Filter control for a DataTable toolbar.
 *
 * Document Templates built one of these by hand and every other list made do
 * with a wide <select> that held a single word. This is that control, shared:
 * the trigger is DataTable's own .dt-filter-btn, so it picks up the 40px
 * square the HRMS stylesheet gives it, and the panel is one portal with the
 * anchoring, the outside-click and the viewport clamping done once. */

export interface ToolbarFilterOption {
  value: string;
  label: string;
  count?: number;
  icon?: string;
  /* Accent for the selected tile; the group's default is used when absent. */
  tone?: string;
}

export interface ToolbarFilterGroup {
  key: string;
  label: string;
  options: ToolbarFilterOption[];
  /* Tiles per row. Two by default; three for long lists. */
  cols?: 2 | 3;
}

export interface ToolbarFilterProps {
  title: string;
  groups: ToolbarFilterGroup[];
  /* Selected value per group key. An empty string means "no choice here". */
  value: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  /* The result meter in the footer. Omitted together, it is not drawn. */
  shown?: number;
  total?: number;
}

const PANEL_W = 340;

export default function ToolbarFilter({
  title, groups, value, onChange, onClear, shown, total,
}: ToolbarFilterProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => groups.reduce((n, g) => n + (value[g.key] ? 1 : 0), 0),
    [groups, value],
  );

  /* Close on an outside click and on Escape. The panel is portalled, so an
     outside click has to miss BOTH the button and the panel — they are no
     longer in the same subtree. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* WHY A PORTAL AND NOT A BIGGER z-index: .dt-toolbar carries
     `position: relative; z-index: 1`, which makes it a stacking context — a
     child asking for z-index: 80 is still flattened to the toolbar's own 1,
     under the sticky table header at 3. .dt-root also has `overflow: hidden`,
     so whatever reached past the card's bottom edge was clipped. Rendering
     into document.body escapes both. */
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; height: number; vh: number; vw: number } | null>(null);
  useEffect(() => {
    if (!open) { setAnchor(null); return; }
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.top, left: r.left, width: r.width, height: r.height, vh: window.innerHeight, vw: window.innerWidth });
    };
    measure();
    // `true` captures scrolls on inner containers too — the table scrolls, and
    // a panel left at an old position reads as a rendering bug.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  /* Where the panel actually goes.

     BOTH coordinates are computed here. The panel is position:fixed, so a
     percentage `top` in the stylesheet resolves against the viewport —
     `top: calc(100% + 10px)` put it 10px below the bottom of the screen,
     and the fixed anchor box it sits in cannot correct that, because a
     fixed ancestor is not a containing block for a fixed child.

     Horizontally it is clamped because the button sits at the right end of
     the toolbar and the panel runs rightwards from it. */
  const FLIP_MIN = 260;
  const popPos = (() => {
    if (!anchor) return {};
    const w = Math.min(PANEL_W, anchor.vw - 24);
    const left = Math.max(12, Math.min(anchor.left, anchor.vw - 12 - w));
    const below = anchor.vh - (anchor.top + anchor.height) - 10;

    // Open upwards when the button is near the bottom and there is more
    // room above it than below.
    return below < FLIP_MIN && anchor.top > below
      ? { bottom: anchor.vh - anchor.top + 10, left, width: w }
      : { top: anchor.top + anchor.height + 10, left, width: w };
  })();
  const flipped = !!anchor && typeof (popPos as { bottom?: number }).bottom === 'number';

  /* How tall the tiles may be before the footer falls off the bottom. The head
     and the foot never scroll; the body between them gives way. */
  const bodyMax = anchor
    ? Math.max(150, (flipped ? anchor.top - 10 : anchor.vh - (anchor.top + anchor.height) - 10) - 44 - 54 - 14)
    : undefined;

  const hasMeter = typeof shown === 'number' && typeof total === 'number';
  const pct = hasMeter && total! > 0 ? Math.round((Math.min(shown!, total!) / total!) * 100) : 100;

  return (
    <div className="dt-fwrap" ref={wrapRef}>
      <button
        type="button"
        className={`dt-filter-btn${active ? ' on' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={active > 0 ? `Filter — ${active} applied` : 'Filter'}
        title={active > 0 ? `Filter — ${active} applied` : 'Filter'}
      >
        <i className="ri-equalizer-line" />
        <span className="dt-filter-lbl">Filter</span>
        {active > 0 && <span className="dt-filter-badge">{active}</span>}
      </button>

      {open && anchor && createPortal(
        /* Zero-size box over the button; the panel positions against it. */
        <div
          className="dt-fpop-anchor"
          style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }}
        >
          <div className="dt-fpop" role="dialog" aria-label={title} ref={popRef} style={popPos}>
            <div className="dt-fpop-head">
              <span className="dt-fpop-head-ico"><i className="ri-equalizer-line" /></span>
              <span className="dt-fpop-title">{title}</span>
              {active > 0 && <span className="dt-fpop-badge">{active}</span>}
              <span className="dt-fpop-sp" />
              {active > 0 && (
                <button type="button" className="dt-fpop-reset" onClick={onClear}>
                  <i className="ri-refresh-line" />Reset
                </button>
              )}
              <button type="button" className="dt-fpop-x" onClick={() => setOpen(false)} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="dt-fpop-body" style={bodyMax ? { maxHeight: bodyMax } : undefined}>
              {groups.map(g => (
                <div className="dt-fpop-group" key={g.key}>
                  <div className="dt-fpop-k"><span>{g.label}</span></div>
                  <div className={`dt-fpop-grid dt-fpop-grid--${g.cols ?? 2}`}>
                    {g.options.map(o => {
                      const on = value[g.key] === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          /* Clicking the chosen tile again clears it. There is
                             no "All" tile, so the choice has to be its own
                             undo or Reset becomes the only way back. */
                          className={`dt-fpop-tile${on ? ' is-on' : ''}${o.count === 0 ? ' is-empty' : ''}`}
                          style={on && o.tone ? { ['--fpop-tone' as any]: o.tone } : undefined}
                          onClick={() => onChange(g.key, on ? '' : o.value)}
                          aria-pressed={on}
                          title={o.label}
                        >
                          <span className="dt-fpop-tick"><i className="ri-check-line" /></span>
                          {o.icon && <span className="dt-fpop-tile-ico"><i className={o.icon} /></span>}
                          <span className="dt-fpop-tile-lbl">{o.label}</span>
                          {typeof o.count === 'number' && <span className="dt-fpop-tile-n">{o.count}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="dt-fpop-foot">
              {hasMeter && (
                <>
                  <div className="dt-fpop-res"><b>{shown}</b><i>/{total}</i></div>
                  <div className="dt-fpop-meter"><span style={{ width: `${pct}%` }} /></div>
                </>
              )}
              {!hasMeter && <span className="dt-fpop-sp" />}
              <button type="button" className="dt-fpop-done" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
