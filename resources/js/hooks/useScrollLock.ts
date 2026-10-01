import { useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * useScrollLock — freeze background (page) scroll while a modal/overlay is
 * mounted. Call it inside a modal component that is conditionally rendered
 * (mounts when open, unmounts when closed); it locks on mount and restores
 * on unmount.
 *
 * <html> and <body> are NOT enough. In this app the page scrolls on
 * `.main-content` (Velzon's shell gives it overflowY:auto), and a modal opened
 * on top of another modal has that modal's body scrolling behind it. Every
 * screen has a different one, so the hook does not name them — it asks the DOM
 * which elements are actually scrolling right now and freezes those too.
 *
 * `exceptSelector` marks the overlay's own subtree, whose content is SUPPOSED
 * to scroll; pass the backdrop/dialog selector so it is left alone.
 *
 * Pass `active = false` to opt out without breaking the rules-of-hooks (the
 * hook is always called, but only locks when active).
 * ───────────────────────────────────────────────────────────────────────── */
export function useScrollLock(active = true, exceptSelector?: string): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevPad  = body.style.paddingRight;
    const scrollbarW = window.innerWidth - html.clientWidth;

    /* Whatever is scrolling behind the overlay, whatever it is called. */
    const panes = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el => {
      if (el === html || el === body) return false;
      if (exceptSelector && el.closest(exceptSelector)) return false;
      const oy = getComputedStyle(el).overflowY;
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    });
    const prevPanes = panes.map(el => el.style.overflow);
    const prevPanePad = panes.map(el => el.style.paddingRight);
    /* Each pane's OWN scrollbar width, measured before it is hidden. Hiding a
       pane reclaims that strip, and its content widens into it — which is the
       whole page shifting sideways the moment a popover opens. body gets this
       treatment already; the panes never did, and in this app the page scrolls
       on .main-content, not body, so the compensation was going to an element
       that had no scrollbar to lose. (#228) */
    const paneBars = panes.map(el => el.offsetWidth - el.clientWidth);

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    panes.forEach((el, i) => {
      el.style.overflow = 'hidden';
      if (paneBars[i] > 0) {
        const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
        el.style.paddingRight = `${pad + paneBars[i]}px`;
      }
    });
    if (scrollbarW > 0) {
      const currentPad = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPad + scrollbarW}px`;
    }
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      body.style.paddingRight = prevPad;
      panes.forEach((el, i) => {
        el.style.overflow = prevPanes[i];
        el.style.paddingRight = prevPanePad[i];
      });
    };
  }, [active, exceptSelector]);
}
