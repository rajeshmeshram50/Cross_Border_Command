/**
 * Branch form master bundle — client-side cache (sessionStorage, 5-min TTL).
 *
 * Scope: BRANCH MODULE ONLY. BranchForm.tsx reads/writes this cache; nothing
 * else in the app touches it, so changes here cannot break clients, products,
 * vendors, or any other module. The cache key is prefixed `branch:` to make
 * the scope obvious when grepping.
 *
 * Why sessionStorage and not localStorage:
 *   • Cleared when the user closes the tab — bounded lifetime, no stale-forever
 *     risk on shared devices.
 *   • Per-tab isolation — if two tabs are open and one tab adds a new country
 *     or state, the other tab will pick it up via the TTL window or an
 *     explicit bust.
 *
 * What we cache vs. what we DON'T:
 *   • Cached: countries + states (static, change rarely)
 *   • NOT cached: next_code (must be fresh per modal open because branch codes
 *     increment as new branches are created). The cache helpers here only
 *     persist the masters portion — BranchForm calls /branches/form-bundle
 *     directly when it needs a fresh next_code, and writes only the masters
 *     to cache.
 *
 * Matches the shape of clientFormBundleCache and the productBundleCache /
 * vendorBundleCache / customerBundleCache helpers — same envelope, same TTL,
 * same read/write/bust API. Helpers degrade gracefully if sessionStorage is
 * unavailable (private browsing, SSR): read returns null, write is a no-op.
 */

// v2 bump (SAAS-OPT-016) — discards any pre-tenant-scope cache entries
// written before MasterVisibility::applyReadScope was added to the
// server bundle. Without bumping, browsers would keep serving the
// older potentially-leaky payload until the 5-min TTL expired.
// v3 bump — the payload now carries `state_codes` (statutory GST state codes)
// so the form can check a GSTIN against the state picked in the address. A v2
// entry has no such list; bumping avoids serving one for up to 5 minutes and
// silently skipping that check.
const KEY = 'branch:form-bundle:v3';
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
export function readBranchFormBundle<T = unknown>(): T | null {
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
export function writeBranchFormBundle<T = unknown>(data: T): void {
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
 * a new country or state from inside the BranchForm (or from a master CRUD
 * page that triggers inline edits). The next BranchForm open will then
 * refetch the fresh list.
 */
export function bustBranchFormBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
