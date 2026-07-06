import axios from 'axios';

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

  return config;
});

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
        localStorage.removeItem('cbc_token');
        localStorage.removeItem('cbc_user');
        window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

export default api;
