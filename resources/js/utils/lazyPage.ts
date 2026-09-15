import { lazy, type ComponentType } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * lazyPage — `React.lazy` that survives a deploy.
 *
 * THE FAILURE THIS EXISTS FOR
 * Vite fingerprints every chunk (ClmTradeDocumentsPage-CRfGckeq.js) and a
 * fresh build DELETES the previous ones. A tab that was opened before the
 * deploy still holds the OLD index.html, so the first navigation to a route
 * it has not loaded yet requests a filename that no longer exists on disk.
 *
 * Apache only serves files that exist; a miss falls through to Laravel, whose
 * SPA catch-all answers *every* unmatched path with the `welcome` view. So the
 * browser asks for a .js module and gets 200 + text/html back, refuses it
 * ("Expected a JavaScript-or-Wasm module script"), and the import() rejects.
 *
 * React.lazy has no error handling of its own: an unhandled rejection there
 * unmounts the tree and the user is left staring at a white screen. With 100+
 * lazy routes in App.tsx, that is one stale tab away at any time.
 *
 * THE FIX
 * A reload solves it completely and permanently — the new index.html names the
 * chunks that actually exist. So do that rather than surfacing a dead page.
 *
 * The guard matters: if the reload does NOT fix it (asset genuinely missing,
 * bad deploy, offline, CDN 500), reloading again would spin forever. We stamp
 * sessionStorage and refuse to reload twice inside 10 seconds — the second
 * failure rethrows so it reaches the console and any future error boundary
 * instead of looping. sessionStorage, not localStorage: the flag should die
 * with the tab, and a later legitimate deploy must be allowed to reload again.
 *
 * routes/web.php also 404s missing /build/* paths so they stop being answered
 * with HTML. That is the correct status either way, but this retry is what the
 * user actually feels.
 * ───────────────────────────────────────────────────────────────────────── */

const RELOAD_KEY = 'cbc_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 10_000;

/* Is the page already on its way out?
 *
 * A browser CANCELS in-flight module fetches when it navigates, so any
 * import() still running at that moment rejects — through no fault of the
 * chunk. This app triggers such navigations on its own: api.ts's 401
 * interceptor calls window.location.reload() when a token has expired, and
 * IdleTimeout logs the user out. Both are routine after a tab sits idle.
 *
 * Treating those rejections as missing chunks was actively harmful, not just
 * noisy: the cooldown below would get stamped, and the NEXT genuine chunk
 * failure within 10s would then refuse to reload and white-screen instead —
 * exactly the failure this file exists to prevent, reintroduced by its own
 * guard. So detect the unload and stay out of the way.
 *
 * pagehide AND beforeunload: pagehide is the reliable one (it fires for
 * bfcache and on iOS Safari, where beforeunload does not), but beforeunload
 * fires marginally earlier on desktop, which widens the window in which we
 * correctly recognise the navigation. */
let unloading = false;
if (typeof window !== 'undefined') {
  const markUnloading = () => { unloading = true; };
  window.addEventListener('pagehide', markUnloading);
  window.addEventListener('beforeunload', markUnloading);
}

// `ComponentType<any>` mirrors React.lazy's own declaration. Narrowing it
// (to `never`, say) breaks assignability: props are contravariant, so a
// component typed on stricter props is not assignable to the looser type
// React.lazy expects back. An editor "fix" that rewrites this to `never`
// will fail the build — keep the disable comment with it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      // Navigating away cancels module fetches — see the note on `unloading`.
      // Return without reloading AND without stamping the cooldown, so a real
      // chunk failure moments later is still allowed its one retry.
      if (unloading) return new Promise<{ default: T }>(() => { });

      let last = 0;
      // Private-browsing and blocked-storage modes throw on access, and a
      // failed read must not turn a recoverable chunk error into a hard crash.
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0; } catch { /* no storage */ }

      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* no storage */ }
        window.location.reload();
        // Deliberately never settles: the navigation is already underway and
        // resolving/rejecting here would render a flash of the wrong UI first.
        return new Promise<{ default: T }>(() => { });
      }

      // Already retried — this is not a stale build. Let it surface.
      throw err;
    }),
  );
}
