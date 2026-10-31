import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TooltipPill, placeTip, visibleTextRect, type Position } from './ui/Tooltip';

/**
 * Every native `title` in the app, drawn as the app's own tooltip.
 *
 * There are ~950 `title` attributes on plain DOM elements across the app.
 * Each one draws the BROWSER's tooltip: a plain box in the OS font, on the
 * OS delay, in the wrong place — so the same hover looked one way on a
 * component wrapped in <Tooltip> and another way three pixels to its left.
 * Converting 950 call sites by hand is neither reviewable nor finishable, so
 * this bridges them in one place instead: it watches for a hover over any
 * element carrying a title, takes the attribute off (which is what stops the
 * browser drawing its own), and shows the SAME <TooltipPill> the component
 * uses.
 *
 * It is a bridge, not a replacement. New code should still wrap its trigger
 * in <Tooltip> — that gives keyboard behaviour, positioning control and a
 * label that can be rich text. This exists so the thousand places that
 * already shipped stop looking foreign.
 *
 * What it does NOT touch:
 *  - `title` on <svg>, <iframe>, <track> and friends, where the attribute is
 *    the accessible NAME rather than a tooltip, and removing it would cost a
 *    screen-reader user the label.
 *  - anything inside an open tooltip, so the pill can never tooltip itself.
 * And wherever it does take a `title`, it first copies it to `aria-label` if
 * the element has no accessible name of its own, so nothing is lost.
 */

/* Elements whose `title` is a label, not a hover hint. */
const NAME_NOT_TOOLTIP = new Set(['svg', 'iframe', 'track', 'link', 'style', 'title', 'head', 'meta']);
/* Where the parked text lives once the attribute is gone, so a second hover
   over the same element still has something to show. */
const PARKED = 'data-cbc-title';

export default function NativeTitleTooltips() {
  const [tip, setTip] = useState<{ label: string; position: Position } | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!tip) { setCoords(null); return; }
    /* visibleTextRect for the same reason Tooltip uses it: a truncating cell's
       box fills its column, so centring the pill on the box points it at the
       middle of the column rather than at a short value sitting on the left.
       Shared with Tooltip rather than copied — the two place the same pill and
       would otherwise drift apart. */
    const el = triggerRef.current;
    const trig = el ? (visibleTextRect(el) ?? el.getBoundingClientRect()) : undefined;
    const pill = pillRef.current?.getBoundingClientRect();
    if (trig && pill) setCoords(placeTip(trig, pill, tip.position, 8));
  }, [tip]);

  useEffect(() => {
    const clearTimer = () => {
      if (showTimer.current) { window.clearTimeout(showTimer.current); showTimer.current = null; }
    };
    const clearHideTimer = () => {
      if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    };
    const hideNow = () => { clearTimer(); clearHideTimer(); triggerRef.current = null; setTip(null); };
    /* A short delay before hiding, cancelled if the pointer lands back on the
       trigger. A hover transform or an overlay that briefly steals the pointer
       fired mouseout → mouseover in a tight loop, and the pill flickered; the
       pending hide absorbs that bounce. */
    const scheduleHide = () => {
      clearHideTimer();
      hideTimer.current = window.setTimeout(hideNow, 90) as unknown as number;
    };

    /* The nearest ancestor that carries a title we should show. Walking up
       matters because the pointer usually lands on an icon or a span inside
       the element the title is on. */
    const carrier = (start: Element | null): HTMLElement | null => {
      let el: Element | null = start;
      while (el && el !== document.body) {
        if (el.closest('[role="tooltip"]')) return null;
        const tag = el.tagName.toLowerCase();
        if (!NAME_NOT_TOOLTIP.has(tag) && (el.hasAttribute('title') || el.hasAttribute(PARKED))) {
          return el as HTMLElement;
        }
        el = el.parentElement;
      }
      return null;
    };

    const onOver = (e: MouseEvent) => {
      const el = carrier(e.target as Element | null);
      if (!el) { if (triggerRef.current) scheduleHide(); return; }
      // Pointer is on a real trigger — cancel any pending hide so it stays put.
      clearHideTimer();
      if (el === triggerRef.current) return;

      const live = el.getAttribute('title');
      if (live !== null) {
        /* Keep the accessible name before the attribute goes. Only when the
           element has none of its own — an explicit aria-label always wins. */
        if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
          el.setAttribute('aria-label', live);
        }
        el.setAttribute(PARKED, live);
        el.removeAttribute('title');
      }
      const label = el.getAttribute(PARKED) ?? '';
      if (!label.trim()) return;

      clearTimer();
      triggerRef.current = el;
      showTimer.current = window.setTimeout(() => {
        /* Below the trigger when it sits near the top of the window, above it
           otherwise — the same choice the browser's own tooltip makes. */
        const r = el.getBoundingClientRect();
        setTip({ label, position: r.top < 120 ? 'bottom' : 'top' });
      }, 40) as unknown as number;
    };

    const onOut = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && triggerRef.current?.contains(to)) return;
      scheduleHide();
    };

    /* A click usually opens or navigates something, and a scroll moves the
       page out from under a fixed pill — both leave it pointing at nothing. */
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('click', hideNow, true);
    window.addEventListener('scroll', hideNow, true);
    window.addEventListener('resize', hideNow);
    return () => {
      clearTimer();
      clearHideTimer();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('click', hideNow, true);
      window.removeEventListener('scroll', hideNow, true);
      window.removeEventListener('resize', hideNow);
    };
  }, []);

  if (!tip) return null;
  return (
    <TooltipPill
      label={tip.label}
      position={tip.position}
      coords={coords}
      scrollable={false}
      zIndex={260000}
      themed
      innerRef={pillRef}
    />
  );
}
