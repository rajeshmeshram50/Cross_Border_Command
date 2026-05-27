/**
 * Product master bundle — client-side cache (sessionStorage, 5-min TTL).
 *
 * Scope: PRODUCT MODULE ONLY. Nothing else in the app reads or writes this
 * cache, so changes here cannot break vendors, customers, or any other
 * module. The cache key is intentionally prefixed `product:` to make the
 * scope obvious to anyone grepping for it.
 *
 * Why sessionStorage and not localStorage:
 *   • Cleared automatically when the user closes the tab — bounded lifetime,
 *     no risk of an indefinitely stale dropdown after a long-lived session.
 *   • Per-tab isolation — if two tabs are open and one tab adds a new HSN
 *     code, the other tab will pick it up on its own next bust/TTL window
 *     rather than reading a stale shared store.
 *
 * Why a 5-minute TTL:
 *   • Masters change rarely (HSN/UOM/conditions are mostly set up once).
 *   • 5 min is short enough that another user's addition becomes visible
 *     to this user within a coffee break, even without explicit invalidation.
 *   • Combined with the inline-add cache bust (see `bustProductMasterBundle`),
 *     same-user changes show INSTANTLY.
 *
 * If sessionStorage is unavailable (private browsing on some browsers, or
 * SSR), all helpers degrade gracefully: read returns null, write is a no-op.
 */

const KEY = 'product:master-bundle:v1';
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
export function readProductMasterBundle<T = unknown>(): T | null {
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
export function writeProductMasterBundle<T = unknown>(data: T): void {
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
 * Clear the cached bundle. Call this whenever the user takes an action that
 * makes the cached data stale — e.g. successfully creating a new HSN code /
 * segment / UOM / vendor from inside the Add Product modal. The next modal
 * open will then refetch the fresh bundle.
 */
export function bustProductMasterBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
