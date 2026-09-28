import { useEffect } from 'react';

type Options = {
  /**
   * Selector for the popover itself. A scroll that starts inside it is the user
   * reading a long list, so it must not close — anything else does.
   */
  inside?: string;
  /**
   * Anything that means "the view underneath has changed" — the active tab, the
   * page number, the search text. When it changes the popover goes, because it
   * is pinned to a badge that is no longer there.
   */
  watch?: unknown;
};

/**
 * Dismiss rules shared by every "+N" overflow popover (CLM authorities and
 * segments, Customer segments, Consignee segments and customer IDs).
 *
 * Each page used to carry its own scroll/resize effect and nothing else, so a
 * popover left open survived a tab switch and hung over the next tab's table —
 * pinned to coordinates that no longer meant anything (CS-31 / CS-35).
 *
 * Closes on: a scroll outside the popover, a resize, Escape, the browser tab
 * being hidden, the window losing focus, and any change to `watch`.
 */
export default function useDismissPopover(open: boolean, close: () => void, opts: Options = {}): void {
  const { inside = '.clm-pop', watch } = opts;

  useEffect(() => {
    if (!open) return;

    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest(inside)) return;
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
  }, [open, inside]); // eslint-disable-line react-hooks/exhaustive-deps

  // The view moved out from under it — close, do not redraw it somewhere wrong.
  useEffect(() => {
    if (open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);
}
