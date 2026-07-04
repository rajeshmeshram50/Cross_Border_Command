/**
 * Customer master bundle — client-side cache (sessionStorage, 5-min TTL).
 *
 * Scope: CUSTOMER + CONSIGNEE flows in the sales module. The two modals
 * (AddCustomerModal, AddConsigneeModal) share one cache key because their
 * dropdown needs overlap by 8 of 9 masters — warming the cache from
 * either flow benefits the other.
 *
 * Why one shared key (not two separate caches):
 *   • Consignees are sub-records of customers; users almost always touch
 *     both modals in the same session (open customer, then map consignee).
 *   • Forcing a second fetch when the user moves Customer → Consignee
 *     wastes the work we already did on the customer modal open.
 *   • The CustomerTypes master is unused by consignees but only 10 rows
 *     — negligible payload cost for huge cache-reuse gains.
 *
 * Storage/TTL choices match productBundleCache + vendorBundleCache for
 * consistency — sessionStorage (tab-bounded lifetime, per-tab isolation)
 * with a 5-minute TTL as the compromise between freshness and round-trip
 * savings.
 */

// v2 bump — discards any pre-tenant-scope cache entries written before
// MasterVisibility::applyReadScope was added to the server bundle.
// Without bumping, browsers would keep serving the older potentially-
// leaky payload until the 5-min TTL expired.
// v3 bump — segments now include `code` (shown as "S-001: Name" in the
// segment dropdown); older cached bundles lack it, so discard them.
// v4 bump — the bundle now returns ONLY segments that have at least one
// document configured in their DCP rule; older cached bundles still list
// every segment, so discard them.
const KEY = 'customer:master-bundle:v4';
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
export function readCustomerMasterBundle<T = unknown>(): T | null {
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
export function writeCustomerMasterBundle<T = unknown>(data: T): void {
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
 * a new master inline from either the Customer or Consignee modal (e.g.
 * adding a new address type, designation, or document type via the
 * quick-add popups) so the next modal open refetches the fresh list.
 */
export function bustCustomerMasterBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
