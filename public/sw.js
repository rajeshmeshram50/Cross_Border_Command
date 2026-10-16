/**
 * Service worker — present so Chrome will offer Install, and nothing more.
 *
 * DELIBERATELY NOT A CACHE. A warehouse scanner must never be served a stale
 * answer: a cached task list would show work that is already done, and a
 * cached scan response would tell an operator a box was accepted when the
 * server never saw it. Everything goes to the network, every time.
 *
 * Chrome requires a fetch handler to exist before it treats a site as
 * installable, so this is the smallest honest one: pass the request straight
 * through.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
