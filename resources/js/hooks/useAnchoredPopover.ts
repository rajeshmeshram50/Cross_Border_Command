import { useLayoutEffect, useEffect, useState, type RefObject } from 'react';
import { useScrollLock } from './useScrollLock';

/* ─────────────────────────────────────────────────────────────────────────
 * useAnchoredPopover — a panel pinned to fixed coordinates taken from the
 * button that opened it, with the page frozen behind it.
 *
 * Written out of the two identical copies that lived in ExpenseClaimsTable and
 * AdvanceRequestsTable, both carrying the same two faults (#226):
 *
 * 1. THE FIRST CLICK DID NOTHING.
 *    Opening locks the page, and useScrollLock sets overflow:hidden on
 *    whatever pane is actually scrolling. A pane that was scrolled mid-way
 *    clamps its scrollTop when it is hidden, and the browser fires a `scroll`
 *    event for that — which the popover's own listener read as "the user
 *    scrolled, strand the popover" and closed it in the same breath it opened.
 *    The second click usually worked because by then the pane sat where
 *    hiding it changed nothing.
 *    The listener no longer trusts the event. It asks whether the ANCHOR has
 *    actually moved, which is the thing it cares about: a phantom scroll that
 *    shifts nothing shifts no anchor either.
 *
 * 2. IT JUMPED ON THE WAY IN.
 *    Placement needed the panel's height, the panel was only rendered once
 *    placed, so the first pass guessed 280px, painted there, and a second pass
 *    corrected it — visibly, every time, on a flipped-above popover.
 *    The panel is now rendered as soon as it opens but kept invisible, measured
 *    in a layout effect, and revealed at its real coordinates before the
 *    browser paints. One position, no correction.
 *
 * The caller renders the panel whenever `open`, and spreads `style` on it:
 *
 *   const { style, popRef } = useAnchoredPopover({ open, setOpen, btnRef });
 *   {open && createPortal(<div ref={popRef} style={style}>…</div>, document.body)}
 * ───────────────────────────────────────────────────────────────────────── */
export function useAnchoredPopover({
  open,
  setOpen,
  btnRef,
  popRef,
  width = 340,
  gap = 6,
  margin = 12,
  /** Scrolling inside the panel itself must not close it. */
  selfSelector = '.ep-audit-popover',
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  btnRef: RefObject<HTMLElement | null>;
  popRef: RefObject<HTMLElement | null>;
  width?: number;
  gap?: number;
  margin?: number;
  selfSelector?: string;
}): { style: React.CSSProperties; placed: boolean } {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /* Layout effect, not effect: this runs after the panel is in the DOM but
     BEFORE the browser paints, so the only position ever drawn is the right
     one — measured against the panel's real height, never a guess. */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }

    const place = () => {
      const btn = btnRef.current;
      const pop = popRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const h = pop?.offsetHeight || 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      // Below the button when it fits; flipped above when it does not.
      const top = spaceBelow > h ? rect.bottom + gap : Math.max(8, rect.top - h - gap);
      const left = Math.min(
        window.innerWidth - width - margin,
        Math.max(margin, rect.right - width),
      );
      setPos(prev =>
        prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1
          ? prev            // same spot — don't re-render for nothing
          : { top, left });
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, btnRef, popRef, width, gap, margin]);

  /* Close when the row this is pinned to actually moves. See fault 1 above:
     the question is never "did a scroll event fire", it is "has the anchor
     gone somewhere else", and only the second one strands the panel. */
  useEffect(() => {
    if (!open) return;
    const anchorTop = () => btnRef.current?.getBoundingClientRect().top ?? null;
    const startedAt = anchorTop();

    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest(selfSelector)) return;
      const now = anchorTop();
      if (startedAt === null || now === null) return;
      if (Math.abs(now - startedAt) > 1) setOpen(false);
    };

    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open, setOpen, btnRef, selfSelector]);

  // Click outside dismisses — the trigger itself is left alone so its own
  // click can toggle the panel shut rather than closing and reopening it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen, btnRef, popRef]);

  // The page is frozen behind it; the panel's own body still scrolls.
  useScrollLock(open);

  return {
    style: {
      position: 'fixed',
      top: pos?.top ?? 0,
      left: pos?.left ?? 0,
      width,
      /* Rendered but unseen until it has been measured and placed. Without
         this the panel would paint once at 0,0 on its way to the right
         place. */
      visibility: pos ? 'visible' : 'hidden',
    },
    placed: pos !== null,
  };
}
