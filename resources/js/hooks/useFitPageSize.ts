import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Rows per page the way the Segment Master sizes its table: as many rows as fit the
 * table area, never fewer than `min` (10) — until the user picks a size themselves.
 * The list asks the server for exactly that page; it never loads everything at once.
 *
 * `scrollRef` is the table's scroll box (it already fills the card to the footer);
 * the row height is measured from a real row, so it holds at any zoom or row design.
 */
export function useFitPageSize(
  scrollRef: RefObject<HTMLElement | null>,
  { min = 10, rowSelector = 'tbody tr', enabled = true, deps = [] as unknown[] } = {},
): [number, (n: number) => void, () => void] {
  const [size, setSize] = useState(min);
  const auto = useRef(true);
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    const fit = () => {
      const el = scrollRef.current;
      if (!auto.current || !el) return;
      const row = el.querySelector<HTMLElement>(rowSelector)?.offsetHeight;
      if (!row) return;   // no real row yet — measured again once data arrives
      const head = el.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0;
      const n = Math.min(50, Math.max(min, Math.floor((el.clientHeight - head) / row)));   // server caps at 50
      setSize((prev) => (prev === n ? prev : n));
    };
    fitRef.current = fit;
    fit();
    const raf = requestAnimationFrame(fit);
    // Settled resizes only: a size change is a new server request.
    let t: number | undefined;
    const onResize = () => { window.clearTimeout(t); t = window.setTimeout(fit, 180); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(t); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, min, rowSelector, ...deps]);

  // The user's own pick sticks; the screen no longer resizes the page for them.
  const choose = useCallback((n: number) => { auto.current = false; setSize(n); }, []);
  // Measure again after the rows change (the list is fetched after the size is known).
  const refit = useCallback(() => { requestAnimationFrame(() => fitRef.current()); }, []);
  return [size, choose, refit];
}
