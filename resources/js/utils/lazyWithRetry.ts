import { lazy, type ComponentType } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * React.lazy that survives a deploy.
 *
 * Route and modal chunks are content-hashed by Vite —
 * `build/assets/AssignedLeadsModal-DujgnIZF.js`. A deploy writes new hashes
 * and deletes the old files, so a tab that has been sitting open across one
 * is holding an index.html whose chunk URLs no longer exist. Laravel's SPA
 * catch-all answers those requests with index.html — HTML, not JavaScript —
 * and the browser refuses it:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script
 *   but the server responded with a MIME type of "text/html"
 *   Uncaught TypeError: Failed to fetch dynamically imported module: …
 *
 * React surfaces that as a rejection during render. With nothing catching it
 * the whole tree unmounts and the user is left on a blank white page with
 * only a console trace — which is exactly how it gets reported ("after the
 * tab sat idle the screen went white").
 *
 * The only thing that can genuinely fix a missing chunk is fetching the new
 * index.html, i.e. a reload. The retry above it is for the other, rarer case:
 * a request that failed in transit. Browsers differ on whether a second
 * import() of the same specifier re-hits the network or replays the
 * remembered failure, so treat the retry as cheap insurance, not the cure.
 *
 * Pairs with AppErrorBoundary, which catches anything that still gets
 * through (including a reload we deliberately refuse to perform).
 * ───────────────────────────────────────────────────────────────────────── */

const RELOAD_KEY = 'cbc_chunk_reload_at';
/* Long enough that a reload which lands on an equally broken build gives up
   instead of looping, short enough that a user hitting a second stale chunk
   ten minutes later still gets rescued automatically. */
const RELOAD_COOLDOWN_MS = 20_000;

/** Reload to pick up the current index.html. False when we refuse to. */
function reloadForNewBuild(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    /* Already reloaded moments ago and the chunk is STILL missing — reloading
       again would just spin. Hand the error on so the boundary can say so. */
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* Private window, or site data blocked. Without somewhere to record that
       we already tried, an auto-reload cannot be bounded — so don't start one.
       The boundary's manual Reload button still works, and a person clicking
       it is its own loop guard. */
    return false;
  }
  window.location.reload();
  return true;
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Drop-in replacement for `React.lazy` for anything loaded from a hashed
 * chunk — routes and lazily-imported modals alike.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch {
      await wait(250);
      try {
        return await factory();
      } catch (err) {
        if (reloadForNewBuild()) {
          /* The reload is already scheduled. Returning a promise that never
             settles keeps the Suspense fallback on screen for the moment the
             page has left, instead of flashing the error boundary on the way
             out. */
          return await new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}

export default lazyWithRetry;
