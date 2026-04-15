import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AuthUser } from '../types';
import api from '../api';

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: false, login: async () => ({ success: false }), logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem('cbc_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);

  // Auto-refresh user data (permissions) on app load if already logged in
  useEffect(() => {
    const token = localStorage.getItem('cbc_token');
    if (!token || !user) return;

    api.get('/me').then(res => {
      const freshUser = res.data;
      localStorage.setItem('cbc_user', JSON.stringify(freshUser));
      setUser(freshUser);
    }).catch(() => {
      // Token invalid — force logout
      localStorage.removeItem('cbc_token');
      localStorage.removeItem('cbc_user');
      setUser(null);
    });
  }, []); // only on mount

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { email, password });
      const { token, user: userData } = res.data;
      localStorage.setItem('cbc_token', token);
      localStorage.setItem('cbc_user', JSON.stringify(userData));
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

  const logout = async () => {
    try {
      await api.post('/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('cbc_token');
    localStorage.removeItem('cbc_user');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
