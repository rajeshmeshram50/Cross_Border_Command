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

// Handle 401 → force logout. Only triggers a reload when we ACTUALLY had a
// token (i.e. it was invalidated mid-session). A 401 with no prior token
// means the request was made before login (e.g. SettingsContext probing
// /settings while user is still on /login) — reloading there would loop
// forever because every reload re-issues the same unauthenticated request.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const hadToken = !!localStorage.getItem('cbc_token');
      if (hadToken) {
        localStorage.removeItem('cbc_token');
        localStorage.removeItem('cbc_user');
        window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

export default api;
