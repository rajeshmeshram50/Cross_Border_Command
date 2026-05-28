/**
 * Client form master bundle — client-side cache (sessionStorage, 5-min TTL).
 *
 * Scope: CLIENT MODULE ONLY. ClientForm.tsx reads/writes this cache; nothing
 * else in the app touches it, so changes here cannot break vendors, products,
 * customers, or any other module. The cache key is prefixed `client:` to make
 * the scope obvious when grepping.
 *
 * Why sessionStorage and not localStorage:
 *   • Cleared when the user closes the tab — bounded lifetime, no stale-forever
 *     risk on shared devices.
 *   • Per-tab isolation — if two tabs are open and one tab adds a new plan
 *     or organization-type, the other tab will pick it up via the TTL window
 *     or an explicit bust.
 *
 * Why a 5-minute TTL:
 *   • Organization-types, plans, countries, and states change rarely.
 *   • 5 min keeps another user's changes visible within a coffee break.
 *   • Combined with `bustClientFormBundle()` on inline master add, same-user
 *     changes appear instantly.
 *
 * Matches the shape of productBundleCache, vendorBundleCache, customerBundleCache
 * — same envelope, same TTL, same read/write/bust API. If sessionStorage is
 * unavailable (private browsing on some browsers, or SSR), helpers degrade
 * gracefully: read returns null, write is a no-op.
 */

// v3 bump — bundle shape changed: states master removed (was 87% of
// payload, now lazy-loaded by country). Old v2 entries had a `states`
// array that the new hydrator ignores anyway, but bumping the key
// guarantees no browser keeps reading stale shape during the window.
// v2 was added in SAAS-OPT-016 for MasterVisibility::applyReadScope.
const KEY = 'client:form-bundle:v3';
const TTL_MS = 5 * 60 * 1000; // 5 minutes

type Envelope<T> = { v: 1; ts: number; data: T };

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Read the cached bundle if it's still within TTL, otherwise return null. */
export function readClientFormBundle<T = unknown>(): T | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== 1 || typeof env.ts !== 'number') return null;
    if (Date.now() - env.ts > TTL_MS) {
      storage.removeItem(KEY);
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

/** Write the bundle to cache. Silently no-op if storage is unavailable. */
export function writeClientFormBundle<T = unknown>(data: T): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const env: Envelope<T> = { v: 1, ts: Date.now(), data };
    storage.setItem(KEY, JSON.stringify(env));
  } catch {
    /* quota exceeded or other write failure — fine, next fetch will re-populate */
  }
}

/**
 * Clear the cached bundle. Call this after the user successfully creates
 * a new organization-type, plan, country, or state from inside the
 * ClientForm (or from the OrganizationTypes / Plans master page if those
 * mutations need to invalidate this cache). The next ClientForm open will
 * then refetch the fresh list.
 */
export function bustClientFormBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
