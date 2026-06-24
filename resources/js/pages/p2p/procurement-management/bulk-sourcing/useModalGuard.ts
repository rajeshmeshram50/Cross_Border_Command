import { useCallback, useRef, useState } from 'react';

/*
 * useModalGuard — keep a Bulk Sourcing modal open when the user clicks the
 * backdrop, and give a quick "heartbeat" pulse on the modal box so the click is
 * visibly acknowledged (instead of silently closing).
 *
 * Usage:
 *   const { pulse, guardOverlay } = useModalGuard();
 *   <div className="overlay" onMouseDown={guardOverlay}>
 *     <div className={`box${pulse ? ' bsm-pulse' : ''}`}>…</div>
 *   </div>
 *
 * Only a press that starts AND ends on the backdrop itself triggers the pulse,
 * so a text-selection drag that ends outside the box won't fire it.
 */
export function useModalGuard() {
  const [pulse, setPulse] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const guardOverlay = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return; // ignore clicks inside the modal box
    // Toggle the class off then back on next frame so the animation replays even
    // on rapid repeated backdrop clicks.
    setPulse(false);
    window.clearTimeout(timer.current);
    requestAnimationFrame(() => {
      setPulse(true);
      timer.current = window.setTimeout(() => setPulse(false), 600);
    });
  }, []);

  return { pulse, guardOverlay };
}
