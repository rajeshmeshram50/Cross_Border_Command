/**
 * Vendor master bundle — client-side cache (sessionStorage, 5-min TTL).
 *
 * Scope: VENDOR MODULE ONLY. Mirrors the structure of productBundleCache.ts
 * so each module owns its own cache key and invalidation rules — no shared
 * state across modules.
 *
 * Why a separate file (vs. one generic helper):
 *   • Vendor and Product masters have different invalidation triggers
 *     (e.g. a new license_name only matters to vendors).
 *   • Keeping the cache key + TTL co-located with the module makes the
 *     blast radius of any change obvious.
 *   • If a future audit deletes the Vendor module, this file goes with it.
 *
 * Storage and TTL choices match productBundleCache for consistency — see
 * the docblock there for the reasoning (sessionStorage tab-boundedness,
 * 5-min TTL as the compromise between freshness and roundtrip savings).
 */

// v2 bump — discards any pre-tenant-scope cache entries written before
// MasterVisibility::applyReadScope was added to the server bundle.
// Without bumping, browsers would keep serving the older potentially-
// leaky payload until the 5-min TTL expired.
const KEY = 'vendor:master-bundle:v2';
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
export function readVendorMasterBundle<T = unknown>(): T | null {
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
export function writeVendorMasterBundle<T = unknown>(data: T): void {
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
 * a new master from inside the Add Vendor modal (e.g. adding a new license
 * name, vendor type, or risk level via the quick-add popups) so the next
 * modal open refetches the fresh list.
 */
export function bustVendorMasterBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
