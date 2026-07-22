import { useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * useScrollLock — freeze background (page) scroll while a modal/overlay is
 * mounted. Call it inside a modal component that is conditionally rendered
 * (mounts when open, unmounts when closed); it locks on mount and restores
 * on unmount.
 *
 * IMPORTANT: both <body> AND <html> (document.documentElement) must be
 * locked. Locking the body alone does NOT stop the page scrolling in most
 * layouts — the scroll happens on the <html> element.
 *
 * Pass `active = false` to opt out without breaking the rules-of-hooks (the
 * hook is always called, but only locks when active).
 * ───────────────────────────────────────────────────────────────────────── */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevPad  = body.style.paddingRight;
    const scrollbarW = window.innerWidth - html.clientWidth;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbarW > 0) {
      const currentPad = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPad + scrollbarW}px`;
    }
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      body.style.paddingRight = prevPad;
    };
  }, [active]);
}
