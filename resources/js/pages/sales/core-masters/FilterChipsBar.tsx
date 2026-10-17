import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDismissPopover from '../../../hooks/useDismissPopover';

/* ═══════════════════════════════════════════════════════════════════════════
 * The applied-filter bar for the party pages (Customers, Consignee).
 *
 * Applying every segment produced twenty-nine chips. Wrapped, they filled
 * seven rows and pushed the table off the screen; capped and scrolling, they
 * were a wall of text nobody reads. Both are the same mistake: a row of chips
 * is a SUMMARY, and a summary that needs scrolling has stopped summarising.
 *
 * So the bar keeps the first few and puts the rest behind "+N more", which
 * opens the same popover the Segment column already uses for its own overflow
 * — one pattern for "there are more of these than fit".
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface FilterChip {
  label: string;
  onRemove: () => void;
}

/** How many stay on the bar. Two reads as "a couple applied" at a glance;
 *  more than that and the eye starts reading rather than scanning. */
const INLINE = 2;

export default function FilterChipsBar({ chips, onClearAll, prefix }: {
  chips: FilterChip[];
  onClearAll: () => void;
  /** Class prefix, so each page keeps its own palette: 'smc' | 'smcg'. */
  prefix: string;
}) {
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useDismissPopover(!!pop, () => setPop(null), { inside: `.${prefix}-seg-pop` });

  if (chips.length === 0) return null;

  const shown = chips.slice(0, INLINE);
  const hidden = chips.length - shown.length;

  const chip = (c: FilterChip, i: number) => (
    <span key={i} className={`${prefix}-filterchip`} title={c.label}>
      <span>{c.label}</span>
      <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label}`}>×</button>
    </span>
  );

  return (
    <div className={`${prefix}-filterbar`}>
      <span className={`${prefix}-filterbar-lbl`}>Filters:</span>
      {shown.map(chip)}

      {hidden > 0 && (
        <button
          type="button"
          ref={btnRef}
          className={`${prefix}-filterchip-more`}
          aria-haspopup="dialog"
          aria-expanded={!!pop}
          onClick={() => {
            if (pop) { setPop(null); return; }
            const b = btnRef.current?.getBoundingClientRect();
            if (b) setPop({ x: b.left, y: b.bottom + 4 });
          }}
        >
          +{hidden} more
        </button>
      )}

      <button type="button" className={`${prefix}-filterbar-clear`} onClick={onClearAll}>Clear all</button>

      {pop && createPortal(
        (() => {
          /* The title stays pinned and only the rows scroll, so the count is
             readable however many there are. */
          const ROWS_MAX_H = 240;
          const estH = Math.min(40 + ROWS_MAX_H, 46 + chips.length * 34);
          const left = Math.max(8, Math.min(pop.x, window.innerWidth - 300));
          const top = Math.max(8, Math.min(pop.y, window.innerHeight - estH - 8));
          return (
            <>
              <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
              <div
                className={`${prefix}-seg-pop ${prefix}-filterpop`}
                role="dialog"
                aria-label="Applied filters"
                style={{ position: 'fixed', left, top, zIndex: 1091, width: 284, borderRadius: 12, padding: 8 }}
              >
                <div className={`${prefix}-seg-pop-title`}>Applied filters ({chips.length})</div>
                <div style={{ maxHeight: ROWS_MAX_H, overflowY: 'auto' }}>
                  {chips.map((c, i) => (
                    <div key={i} className={`${prefix}-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                      <span className={`${prefix}-filterpop-lbl`} title={c.label}>{c.label}</span>
                      <button
                        type="button"
                        className={`${prefix}-filterpop-x`}
                        aria-label={`Remove ${c.label}`}
                        onClick={() => {
                          c.onRemove();
                          /* Closing on the last one keeps the popover from
                             hanging over a bar that no longer has a button. */
                          if (chips.length <= 1) setPop(null);
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
                {/* No "clear all" in here. The bar behind it already carries
                    one, and two buttons for the same action a few pixels
                    apart only make the user stop and read both. */}
              </div>
            </>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
