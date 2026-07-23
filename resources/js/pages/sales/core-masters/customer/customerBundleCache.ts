const KEY = 'customer:master-bundle:v5';
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


export function bustCustomerMasterBundle(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
