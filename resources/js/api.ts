import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
});

// Attach token from localStorage + auto-inject the active branch filter on
// read requests so every list / dashboard / master refetches when the
// BranchSwitcher changes. The selected branch is persisted per-user by
// BranchSwitcherContext under `cbc_selected_branch_id_<userId>`.
//
// Why ALL list endpoints need this: previously only the two dashboards
// piped `branch_id` into their fetch params, so switching the dropdown
// changed only the dashboard while HR / Master / Payments / Permissions
// kept showing the whole-client dataset. The interceptor centralises the
// filter so every page honours the dropdown without per-page wiring.
//
// We restrict injection to GET (and method-less) requests — POST / PUT /
// DELETE bodies should not be silently mutated.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cbc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const method = (config.method || 'get').toLowerCase();
  // Skip URLs that load the BranchSwitcher itself or fetch the user/auth state
  // — auto-injecting a branch_id there breaks the dropdown (it'd return only
  // the selected branch, and the user could never switch back to "All").
  // Pages that need to opt out per-call can pass `branch_id: ''` explicitly.
  const url = config.url || '';
  const skipUrls = ['/branches', '/me', '/login', '/logout', '/forgot-password', '/google-login'];
  const shouldSkip = skipUrls.some(p => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'));

  if (method === 'get' && !shouldSkip) {
    try {
      const userRaw = localStorage.getItem('cbc_user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (user?.id) {
        const stored = localStorage.getItem(`cbc_selected_branch_id_${user.id}`);
        // 'null' / '' / missing all mean "All Branches" — don't inject.
        // Numeric value means a specific branch is selected.
        if (stored && stored !== 'null') {
          const branchId = Number(stored);
          if (Number.isFinite(branchId) && branchId > 0) {
            // Don't override an explicit per-call branch_id (lets pages opt out
            // by passing `branch_id: ''` or a different specific id).
            const params = config.params || {};
            if (params.branch_id === undefined) {
              config.params = { ...params, branch_id: branchId };
            }
          }
        }
      }
    } catch { /* localStorage unavailable — silent fallback to no filter */ }
  }

  return config;
});

// Handle 401 → force logout. Safeguards:
//
//   1. Only reload when we ACTUALLY had a token (i.e. it was invalidated
//      mid-session). A 401 with no prior token means the request was made
//      before login — reloading would loop forever.
//
//   2. Skip /me — AuthContext's refresh() has its own try/catch that quietly
//      clears state without a jarring reload. The on-focus refresh fires
//      every time the user alt-tabs back, and if /me happens to 401 due to
//      a transient backend issue we DON'T want to bounce them to /login.
//      That was the "auto-logout after a few seconds of idle" symptom on
//      live: alt-tab away → click back → focus fires → /me 401s → reload.
//
//   3. Capture last 401 source to localStorage so devs can inspect after
//      reload — `localStorage.getItem('cbc_last_auth_error')`.
const TOLERATED_401_URLS = ['/me'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
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
        console.warn('[api] 401 from', url, '— clearing session');
        localStorage.removeItem('cbc_token');
        localStorage.removeItem('cbc_user');
        window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

export default api;
