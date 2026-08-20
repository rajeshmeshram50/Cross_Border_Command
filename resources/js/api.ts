import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

/* ─────────────────────────────────────────────────────────────────────────
 * In-flight registry.
 *
 * A page can have a dozen requests outstanding at once — masters, counts, the
 * list, a profile — and on a slow connection they queue behind each other for
 * seconds. Stopping them needs a handle on each, so every request that does not
 * bring its own AbortSignal gets one here, and it is dropped from the set the
 * moment the request settles.
 *
 * A caller that DOES pass its own signal is left alone: it has its own
 * cancellation story (a component unmounting, a superseded search) and taking
 * it over from here would silently break that.
 * ───────────────────────────────────────────────────────────────────────── */

type Entry = {
  controller: AbortController;
  url: string;
  method: string;
  startedAt: number;
  /* Set by stopAll() just before the abort, so the response interceptor can
     tell OUR cancellation apart from a genuine network failure. */
  stopped?: boolean;
};

/* A request the user stopped, holding its caller's promise open.
   The point of parking rather than rejecting: the page that asked for this
   data is still mounted and still showing its loading state. If we rejected,
   its .then() would be gone and no amount of re-fetching later could put the
   data on screen — Resume would have to become a full page reload. Held this
   way, resume() re-issues the request and settles the ORIGINAL promise, so
   the page finishes loading exactly as if it had merely been slow. */
type Parked = {
  config: InternalAxiosRequestConfig;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  url: string;
  method: string;
};

/* Session bootstrap. Cancelling these does not just delay a screen — /me
   failing drops the user to the login page and /settings failing blanks every
   module flag, so a Stop click during app start would look like a logout.
   (/branches already passes its own signal, so it never reaches the set.) */
const NEVER_ABORT = ['/me', '/settings', '/login', '/logout'];

const inFlight = new Set<Entry>();
const parked: Parked[] = [];
const listeners = new Set<(s: NetworkState) => void>();

export type NetworkState = { pending: number; paused: number };

const snapshot = (): NetworkState => ({ pending: inFlight.size, paused: parked.length });

/* Coalesced to one notification per tick.
   The only listener is the header, and the header is on every screen — firing
   it once per request add and once per release would re-render the whole top
   nav twenty times while a page like Employees opens. A screen's requests all
   leave in the same microtask drain, so batching there collapses that burst
   into a single render, and the count the listener sees is still the exact
   current one rather than a stale intermediate. */
let queued = false;
const announce = () => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const s = snapshot();
    listeners.forEach(fn => fn(s));
  });
};

/** Subscribe to the in-flight / paused counts. Returns an unsubscribe. */
export function onNetworkChange(fn: (s: NetworkState) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => { listeners.delete(fn); };
}

/** How many abortable (GET/HEAD) requests are outstanding right now. */
export function pendingCount(): number {
  return inFlight.size;
}

/** What is outstanding — for a tooltip or a debug panel. Reads only. */
export function pendingRequests(): { url: string; method: string; ms: number }[] {
  const now = Date.now();
  return [...inFlight].map(e => ({ url: e.url, method: e.method, ms: now - e.startedAt }));
}

/**
 * Stop every read still on the wire.
 *
 * Whatever already arrived is untouched — the responses that landed have
 * already run their callers' .then(), so a half-loaded screen stays exactly
 * as loaded as it got. The stopped ones are parked, not failed: their callers
 * keep waiting until resume() re-issues them (or the tab is reloaded).
 *
 * @returns how many were stopped
 */
export function stopAll(): number {
  const n = inFlight.size;
  inFlight.forEach(e => {
    e.stopped = true;
    try { e.controller.abort(); } catch { /* already settled */ }
  });
  inFlight.clear();
  announce();
  return n;
}

/** What is parked, waiting on a resume. */
export function pausedRequests(): { url: string; method: string }[] {
  return parked.map(p => ({ url: p.url, method: p.method }));
}

/** True when the error came from abortAllPending (or any AbortController). */
export function isCanceled(err: unknown): boolean {
  return axios.isCancel(err)
    || (err as { code?: string })?.code === 'ERR_CANCELED';
}

const api = axios.create({
  baseURL: '/api',
  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
});
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cbc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const method = (config.method || 'get').toLowerCase();
  const url = config.url || '';
  const skipUrls = ['/branches', '/me', '/login', '/logout', '/forgot-password', '/google-login'];
  const shouldSkip = skipUrls.some(p => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'));

  if (method === 'get' && !shouldSkip) {
    try {
      const userRaw = localStorage.getItem('cbc_user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (user?.id) {
        const stored = localStorage.getItem(`cbc_selected_branch_id_${user.id}`);
        if (stored && stored !== 'null') {
          const branchId = Number(stored);
          if (Number.isFinite(branchId) && branchId > 0) {
            const params = config.params || {};
            if (params.branch_id === undefined) {
              config.params = { ...params, branch_id: branchId };
            }
          }
        }
      }
    } catch { /* localStorage unavailable — silent fallback to no filter */ }
  }

  /* Give it a signal we can pull, unless the caller brought their own.
   *
   * Reads only. Aborting a POST/PUT does NOT stop the server from committing
   * it — it only stops the browser hearing the answer, so the user would be
   * left with a save that silently succeeded behind a "cancelled" UI. Writes
   * are also not what makes a screen slow; a dozen queued GETs are. */
  /* Matched on the path, tolerant of how the caller wrote it — '/me', 'me',
     or a fully-qualified URL all have to hit. Getting this wrong fails silently
     and only shows up as a mysterious logout when someone clicks Stop during
     app start, so it is deliberately loose: a false match merely makes one
     request unstoppable, which is harmless. */
  const path = url.split('?')[0];
  const abortable = !NEVER_ABORT.some(
    p => path === p || path === p.slice(1) || path.endsWith('/api' + p),
  );

  if (!config.signal && abortable && (method === 'get' || method === 'head')) {
    const controller = new AbortController();
    config.signal = controller.signal;
    const entry: Entry = {
      controller,
      url: config.url || '',
      method: (config.method || 'get').toUpperCase(),
      startedAt: Date.now(),
    };
    (config as InternalAxiosRequestConfig & { __entry?: Entry }).__entry = entry;
    inFlight.add(entry);
    announce();
  }

  return config;
});

/** Drop a settled request from the registry, however it settled. */
const release = (config?: unknown) => {
  const entry = (config as { __entry?: Entry } | undefined)?.__entry;
  if (entry && inFlight.delete(entry)) announce();
};

const TOLERATED_401_URLS = ['/me'];

api.interceptors.response.use(
  (res) => { release(res.config); return res; },
  (err) => {
    release(err.config);
    const status = err.response?.status;
    const url = (err.config?.url as string | undefined) || '';
    if (status === 401) {
      const hadToken = !!localStorage.getItem('cbc_token');
      const tolerated = TOLERATED_401_URLS.some(p => url === p || url.startsWith(p + '?'));
      if (hadToken && !tolerated) {
        try {
          localStorage.setItem('cbc_last_auth_error', JSON.stringify({
            url, status, at: new Date().toISOString(),
            message: err.response?.data?.message || '(no message)',
          }));
        } catch {}
        localStorage.removeItem('cbc_token');
        localStorage.removeItem('cbc_user');
        window.location.reload();
      }
    }
    /* Ours, not the network's — hold the caller's promise open instead of
       failing it, so Resume can hand back the real data. A cancellation the
       CALLER asked for (its own signal) has no __entry and falls straight
       through to the rejection below, as it should. */
    const entry = (err.config as { __entry?: Entry } | undefined)?.__entry;
    if (entry?.stopped && isCanceled(err)) {
      return new Promise((resolve, reject) => {
        parked.push({
          config: err.config as InternalAxiosRequestConfig,
          resolve, reject,
          url: entry.url,
          method: entry.method,
        });
        announce();
      });
    }

    return Promise.reject(err);
  }
);

/**
 * Re-issue everything that was stopped, settling the original promises.
 *
 * The stored config is replayed with its dead signal and registry entry
 * stripped — reusing them would abort the new request the instant it left,
 * which is the obvious way to get this wrong. It goes back through the
 * interceptors, so it picks up a fresh token and a fresh abort handle and is
 * stoppable again.
 *
 * @returns how many were resumed
 */
export function resumeAll(): number {
  const batch = parked.splice(0, parked.length);
  announce();
  batch.forEach(({ config, resolve, reject }) => {
    const next = { ...config } as InternalAxiosRequestConfig & { __entry?: Entry };
    delete next.signal;
    delete next.__entry;
    api.request(next).then(resolve, reject);
  });
  return batch.length;
}

export default api;
