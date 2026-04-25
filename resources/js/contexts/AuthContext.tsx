import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AuthUser } from '../types';
import api from '../api';

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  googleLogin: (idToken: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: false,
  login: async () => ({ success: false }),
  googleLogin: async () => ({ success: false }),
  logout: async () => {},
  refresh: async () => {},
});

// Bump this when the shape of `cbc_user` changes in a way that stale caches break.
// When the stored version differs, we invalidate the cache and force a /me refresh.
const USER_SCHEMA_VERSION = 2;

function readCachedUser(): AuthUser | null {
  try {
    const saved = localStorage.getItem('cbc_user');
    const ver = parseInt(localStorage.getItem('cbc_user_v') || '0', 10);
    if (!saved) return null;
    if (ver !== USER_SCHEMA_VERSION) {
      // Old/unknown schema — drop the cache, let /me repopulate
      localStorage.removeItem('cbc_user');
      return null;
    }
    const parsed = JSON.parse(saved);
    // Sanity check — ensure required fields exist
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.user_type) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem('cbc_user', JSON.stringify(user));
    localStorage.setItem('cbc_user_v', String(USER_SCHEMA_VERSION));
  } else {
    localStorage.removeItem('cbc_user');
    localStorage.removeItem('cbc_user_v');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser());
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const token = localStorage.getItem('cbc_token');
    if (!token) return;
    try {
      const res = await api.get('/me');
      const freshUser = res.data;
      writeCachedUser(freshUser);
      setUser(freshUser);
    } catch {
      // Token invalid — force logout
      localStorage.removeItem('cbc_token');
      writeCachedUser(null);
      setUser(null);
    }
  };

  // Auto-refresh user data (permissions) on app mount if token is present.
  // This ensures clients see the latest permission grants even if their
  // localStorage has stale data from before new modules were added.
  useEffect(() => {
    const token = localStorage.getItem('cbc_token');
    if (!token) return;
    refresh();
  }, []);

  // Also refresh when the tab regains focus (catches perms granted while away)
  useEffect(() => {
    const onFocus = () => {
      const token = localStorage.getItem('cbc_token');
      if (token && user) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user]);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { email, password });
      const { token, user: userData } = res.data;
      localStorage.setItem('cbc_token', token);
      writeCachedUser(userData);
      setUser(userData);
      return { success: true };
    } catch (err: any) {
      const msg = err.response?.data?.errors?.email?.[0]
        || err.response?.data?.message
        || 'Login failed';
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async (idToken: string) => {
    setLoading(true);
    try {
      const res = await api.post('/google-login', { id_token: idToken });
      const { token, user: userData } = res.data;
      localStorage.setItem('cbc_token', token);
      writeCachedUser(userData);
      setUser(userData);
      return { success: true };
    } catch (err: any) {
      const msg = err.response?.data?.message
        || err.response?.data?.errors?.id_token?.[0]
        || 'Google sign-in failed';
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('cbc_token');
    writeCachedUser(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, googleLogin, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
