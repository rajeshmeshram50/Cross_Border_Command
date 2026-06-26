import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

/*
 * Laravel Echo client for Reverb (WebSockets).
 *
 * Private channels authorise via POST /broadcasting/auth. The SPA uses Sanctum
 * BEARER tokens (not cookies), so we send the same `cbc_token` header that
 * api.ts uses — read fresh on every auth request so a re-login is picked up.
 *
 * If the Reverb env vars aren't set yet (server not configured), Echo simply
 * fails to connect in the background and the rest of the app keeps working —
 * the approver lists still have their focus/manual refresh fallback.
 */
(window as unknown as { Pusher: typeof Pusher }).Pusher = Pusher;

const key = import.meta.env.VITE_REVERB_APP_KEY as string | undefined;

// Lazily-constructed singleton. We do NOT build Echo at module-eval time:
// doing so opened the WebSocket on EVERY page load (and retried in a loop when
// Reverb wasn't reachable, spamming the console). Only the few realtime
// features — the CLM agreement approval pages and the typing indicator — need
// it, so they call getEcho() from their effects and the socket opens only then.
let _echo: Echo<'reverb'> | null = null;
let _constructed = false;

/**
 * Get the shared Echo client, constructing (and connecting) it on first call.
 * Returns null when broadcasting isn't configured (no VITE_REVERB_APP_KEY) so
 * callers can degrade gracefully to their manual/focus-refresh fallback.
 */
export function getEcho(): Echo<'reverb'> | null {
  if (!key) return null;
  if (!_constructed) {
    _constructed = true;
    _echo = new Echo({
      broadcaster: 'reverb',
      key,
      wsHost: import.meta.env.VITE_REVERB_HOST,
      wsPort: Number(import.meta.env.VITE_REVERB_PORT ?? 8080),
      wssPort: Number(import.meta.env.VITE_REVERB_PORT ?? 8080),
      forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'http') === 'https',
      enabledTransports: ['ws', 'wss'],
      authEndpoint: '/broadcasting/auth',
      auth: {
        headers: {
          get Authorization() {
            return `Bearer ${localStorage.getItem('cbc_token') ?? ''}`;
          },
        },
      },
    });
  }
  return _echo;
}
