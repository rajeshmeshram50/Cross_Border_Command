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

// Only construct Echo when a key is configured, so unconfigured environments
// don't spew connection errors.
export const echo: Echo<'reverb'> | null = key
  ? new Echo({
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
    })
  : null;
