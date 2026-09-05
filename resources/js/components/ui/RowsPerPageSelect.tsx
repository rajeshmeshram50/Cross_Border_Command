import { useEffect, useRef, useState } from 'react';

/**
 * Rows-per-page picker.
 *
 * Replaces the native <select> the pagers used. A native select renders its
 * option list with the OS widget, which ignores the app's styling entirely and
 * opens wherever the platform decides — in a table footer near the bottom of
 * the viewport it drops upward over the last rows, in the app's own typeface
 * and colours, looking like it belongs to a different product.
 *
 * Deliberately small: this is a five-option numeric picker, not a data
 * selector. No search, no async, no portal — it renders a short list next to
 * its button, closes on outside click and on Escape, and that is all it needs
 * to do. Anything more would be MasterSelect, which is the wrong tool here.
 */
export default function RowsPerPageSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: number;
  options: number[];
  onChange: (n: number) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Close on any click that is not inside this control, and on Escape. The
     pager sits in a footer that scrolls, so a menu left open would otherwise
     drift away from its button. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Always offer the current value, even if it is not one of the presets — an
  // auto-fitted page size is a real value and must not vanish from the list.
  const opts = [...new Set([value, ...options])].sort((a, b) => a - b);

  return (
    <div ref={wrapRef} className={`rpp-wrap${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`rpp-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        /* Opens UPWARD: the pager is the last thing in a table card, so a menu
           below it would fall outside the card and be clipped. */
        <ul className="rpp-menu" role="listbox">
          {opts.map(n => (
            <li key={n} role="option" aria-selected={n === value}>
              <button
                type="button"
                className={`rpp-opt${n === value ? ' is-active' : ''}`}
                onClick={() => { onChange(n); setOpen(false); }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        /* Theme-NEUTRAL on purpose.
           This first hardcoded the CLM purple, which was wrong the moment it
           appeared in a teal pager — a control that carries its own palette
           announces itself as foreign wherever it is reused. Everything
           accented is currentColor instead, so the button, the selected row
           and the focus ring all take the colour of the pager they sit in.
           Only the neutrals (white surface, grey hairline) are stated. */
        .rpp-wrap { position: relative; display: inline-flex; }
        .rpp-btn {
          display: inline-flex; align-items: center; gap: 4px;
          min-width: 46px; justify-content: space-between;
          padding: 3px 7px; border-radius: 7px;
          border: 1.5px solid rgba(15,23,42,.16); background: #fff;
          font: inherit; font-size: 12px; font-weight: 700;
          color: inherit; cursor: pointer;
          transition: border-color .15s, box-shadow .15s;
        }
        .rpp-btn:hover      { border-color: currentColor; }
        .rpp-btn.is-open    { border-color: currentColor; box-shadow: 0 0 0 3px rgba(15,23,42,.07); }
        .rpp-btn svg        { opacity: .55; flex-shrink: 0; }
        /* Upward: the pager is the last thing in a table card, so a menu below
           it falls outside the card and is clipped. */
        .rpp-menu {
          position: absolute; bottom: calc(100% + 5px); left: 0; z-index: 60;
          margin: 0; padding: 3px; list-style: none;
          min-width: 100%; background: #fff;
          border: 1px solid rgba(15,23,42,.12); border-radius: 9px;
          box-shadow: 0 8px 22px rgba(15,23,42,.14);
        }
        .rpp-opt {
          display: block; width: 100%; text-align: center;
          padding: 4px 12px; border: none; border-radius: 6px;
          background: transparent; font: inherit; font-size: 12px; font-weight: 600;
          color: #475569; cursor: pointer; line-height: 1.5;
        }
        .rpp-opt:hover { background: rgba(15,23,42,.06); }
        /* The fill goes on the <li>, the white label on the <button> inside it.
           Both on one element cannot work: setting color:#fff would make
           currentColor white too, so the row would be white on white. The li
           still inherits the pager's colour, so the fill stays on-theme. */
        .rpp-menu li[aria-selected="true"] { background: currentColor; border-radius: 6px; }
        .rpp-menu li[aria-selected="true"] .rpp-opt { color: #fff; background: transparent; }
        .rpp-menu li[aria-selected="true"]:hover { filter: brightness(1.08); }
        [data-bs-theme="dark"] .rpp-btn,
        [data-bs-theme="dark"] .rpp-menu { background: #1f2937; border-color: rgba(255,255,255,.14); }
        [data-bs-theme="dark"] .rpp-opt  { color: #cbd5e1; }
        [data-bs-theme="dark"] .rpp-opt:hover { background: rgba(255,255,255,.08); }
      `}</style>
    </div>
  );
}
