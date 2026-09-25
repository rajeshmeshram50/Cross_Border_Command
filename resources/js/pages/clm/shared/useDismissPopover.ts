import { useEffect } from 'react';

/**
 * Dismiss rules shared by every CLM "+N" popover (issuing authorities,
 * segments, applicable party).
 *
 * Each page used to carry its own scroll/resize effect, and none of them
 * listened for the window going away — so a popover left open stayed open
 * behind a browser tab switch and was still hanging over the table when the
 * user came back, long after they had stopped looking at it.
 *
 * Closes on: a scroll outside the popover (a scroll INSIDE it must not close
 * it, or a long list cannot be scrolled), a resize, Escape, the tab being
 * hidden, and the window losing focus.
 */
export default function useDismissPopover(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;

    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('.clm-pop')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onVisibility = () => { if (document.hidden) close(); };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `close` is a plain setter in every caller; re-running on `open` alone
    // keeps the listener set stable while the popover is up.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
