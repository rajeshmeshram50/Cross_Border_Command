/**
 * Dashboard stats — client-side cache (sessionStorage, 1-min TTL).
 *
 * Scope: DASHBOARD MODULE ONLY. AdminDashboard, ClientDashboard, and
 * BranchDashboard read/write this cache. Each dashboard variant uses its
 * own cache key so a super-admin's `admin-stats` payload never leaks
 * into a client-admin's `client-stats` view.
 *
 * Why a 1-minute TTL (much shorter than the master-bundle 5-min):
 *   • Dashboards display volatile data (counts, revenue today, pending
 *     approvals). A 5-min stale read could mislead the user into thinking
 *     a pending request hasn't arrived when it actually has.
 *   • 1 min is long enough to absorb rapid tab switches and "back to
 *     dashboard" navigations without hitting the network repeatedly,
 *     short enough that the next minute's deltas appear naturally.
 *
 * Why sessionStorage (vs localStorage):
 *   • Tab-bounded lifetime — closing the tab discards possibly-stale
 *     numbers rather than carrying them into a fresh session.
 *   • Per-tab isolation — two open tabs each maintain their own fresh
 *     copy without cross-tab cache invalidation overhead.
 *
 * The cache key includes a per-call variant suffix (e.g. branch_id) so
 * the same dashboard rendered with different branch filters caches
 * separately and never returns the wrong slice.
 *
 * Helpers degrade gracefully if sessionStorage is unavailable (private
 * browsing, SSR): read returns null, write is a no-op.
 */

const KEY_PREFIX = 'dashboard:stats:v1:';
const TTL_MS = 60 * 1000; // 1 minute — short by design for volatile stats

type Envelope<T> = { v: 1; ts: number; data: T };

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function fullKey(variant: string): string {
  return `${KEY_PREFIX}${variant}`;
}

/**
 * Read the cached stats payload if it's still within TTL.
 *
 * @param variant Distinguishes different dashboard slices that share the
 *                same endpoint family. Examples: 'admin', 'client',
 *                'client:branch:42'. Caller is responsible for choosing
 *                a stable variant key — same input must produce the same
 *                variant or the cache won't hit.
 */
export function readDashboardStats<T = unknown>(variant: string): T | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(fullKey(variant));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== 1 || typeof env.ts !== 'number') return null;
    if (Date.now() - env.ts > TTL_MS) {
      storage.removeItem(fullKey(variant));
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

/** Write the stats payload to cache under the given variant key. */
export function writeDashboardStats<T = unknown>(variant: string, data: T): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const env: Envelope<T> = { v: 1, ts: Date.now(), data };
    storage.setItem(fullKey(variant), JSON.stringify(env));
  } catch {
    /* quota exceeded — fine, next fetch will re-populate */
  }
}

/**
 * Clear a single variant's cache (or all dashboard stats with no arg).
 * Call after actions known to mutate dashboard counts (e.g., approving
 * a payment, completing a customer onboarding) so the next view reads
 * fresh data instead of waiting for the 1-min TTL.
 */
export function bustDashboardStats(variant?: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (variant) {
      storage.removeItem(fullKey(variant));
      return;
    }
    // No variant — sweep every dashboard cache key.
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) storage.removeItem(k);
    }
  } catch { /* ignore */ }
}
