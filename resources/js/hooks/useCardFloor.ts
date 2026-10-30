import { useEffect, type RefObject } from 'react';

/**
 * A list card that always reaches the bottom of the window, even with no rows.
 *
 * The list pages' CSS (order.css: `.page-content` height:100% down to
 * `.ord-list` flex:1) only stretches the card when the app shell has a fixed
 * height — true in the sidebar layout, not in the horizontal-menu one, where
 * the shell grows with its content. There an empty list left a blank band
 * under the pager (CS-939 #17). This sets the card's own floor instead, as the
 * Suppliers list does: from its top to the bottom of the window, less the
 * footer. Phones scroll the page, so no floor there.
 *
 * `deps` are whatever moves the card's top (an expandable brief above it);
 * the card is measured again once that has settled.
 */
export function useCardFloor(cardRef: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const fit = () => {
      const el = cardRef.current;
      if (!el) return;
      if (window.innerWidth <= 820) { el.style.minHeight = ''; return; }
      const footerH = (document.querySelector('footer.footer') as HTMLElement | null)?.offsetHeight ?? 0;
      const reserve = footerH > 0 ? footerH + 8 : 15;
      const h = `${Math.max(320, Math.floor(window.innerHeight - el.getBoundingClientRect().top - reserve))}px`;
      if (el.style.minHeight !== h) el.style.minHeight = h;
    };
    fit();
    const raf = requestAnimationFrame(fit);
    // the brief above animates open/shut — measure again once it has settled
    const settle = setTimeout(fit, 360);
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => { clearTimeout(t); t = setTimeout(fit, 140); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t); clearTimeout(settle); cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
