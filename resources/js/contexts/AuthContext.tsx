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
  // Toggle for tenant theme override. When false, the sidebar/topbar render
  // in default Velzon colors regardless of what the tenant has configured.
  // Persisted in localStorage so the choice survives reloads.
  tenantThemeEnabled: boolean;
  toggleTenantTheme: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: false,
  login: async () => ({ success: false }),
  googleLogin: async () => ({ success: false }),
  logout: async () => {},
  refresh: async () => {},
  tenantThemeEnabled: true,
  toggleTenantTheme: () => {},
});

// Bump this when the shape of `cbc_user` changes in a way that stale caches break.
// When the stored version differs, we invalidate the cache and force a /me refresh.
// v3 — added `is_main_branch` flag (used for Permissions menu gating).
// v4 — added `client_logo` / `branch_logo` URLs (sidebar dynamic branding).
// v5 — added `primary_color` / `secondary_color` (tenant theme override).
// v6 — added `employee_id` (linked Employee row, used for expense-claim ownership).
// v7 — added `employee_code` (EMP-### string form, used for own-profile match).
const USER_SCHEMA_VERSION = 7;

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
  // Tenant theme toggle, persisted across reloads. Defaults to ON so first-
  // time logins see their brand; user can opt-out from the topbar button.
  const [tenantThemeEnabled, setTenantThemeEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('cbc_tenant_theme') !== 'off'; } catch { return true; }
  });
  const toggleTenantTheme = () => {
    setTenantThemeEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('cbc_tenant_theme', next ? 'on' : 'off'); } catch {}
      return next;
    });
  };

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

  // Tenant theme — paint `:root` with the user's effective colors.
  //   PRIMARY   → sidebar background + topbar background (the big surfaces)
  //               + Bootstrap --vz-primary so buttons/links keep brand hue
  //   SECONDARY → active menu items (sidebar + sub-items + topnav)
  // Text colors on the primary surfaces are auto-flipped (light vs dark) based
  // on perceived luminance, otherwise dark-on-dark or light-on-light makes
  // labels unreadable. Logout / user change cleans up via the cleanup return.
  useEffect(() => {
    const root = document.documentElement;
    const TENANT_VARS = [
      // Primary surfaces
      '--vz-vertical-menu-bg',
      '--vz-header-bg',
      // Active accent
      '--vz-vertical-menu-item-active-color',
      '--vz-vertical-menu-item-active-bg',
      '--vz-vertical-menu-sub-item-active-color',
      '--vz-topnav-item-active-color',
      // Auto-contrast text on primary surfaces
      '--vz-vertical-menu-item-color',
      '--vz-vertical-menu-item-hover-color',
      '--vz-vertical-menu-sub-item-color',
      '--vz-vertical-menu-sub-item-hover-color',
      '--vz-vertical-menu-title-color',
      '--vz-header-item-color',
      // Bootstrap brand vars (buttons, links, focus rings)
      '--vz-primary',
      '--vz-primary-rgb',
      '--vz-link-color',
      '--vz-link-color-rgb',
      '--vz-link-hover-color',
      '--vz-secondary',
      '--vz-secondary-rgb',
    ];
    const clearTenantVars = () => TENANT_VARS.forEach(v => root.style.removeProperty(v));

    if (!tenantThemeEnabled || (!user?.primary_color && !user?.secondary_color)) {
      clearTenantVars();
      return;
    }

    const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
      const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const rgbStr = (c: { r: number; g: number; b: number }) => `${c.r}, ${c.g}, ${c.b}`;
    // Perceived luminance — if the surface is light, use dark text; if dark, use light text.
    const isLight = (c: { r: number; g: number; b: number }) =>
      (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.6;

    if (user.primary_color) {
      const c = hexToRgb(user.primary_color);
      if (c) {
        // Surfaces
        root.style.setProperty('--vz-vertical-menu-bg', user.primary_color);
        root.style.setProperty('--vz-header-bg', user.primary_color);
        // Bootstrap brand
        root.style.setProperty('--vz-primary', user.primary_color);
        root.style.setProperty('--vz-primary-rgb', rgbStr(c));
        root.style.setProperty('--vz-link-color', user.primary_color);
        root.style.setProperty('--vz-link-color-rgb', rgbStr(c));
        root.style.setProperty('--vz-link-hover-color', user.primary_color);
        // Auto-contrast text on the primary surfaces
        const text = isLight(c) ? '#1a1d21' : '#ffffff';
        const textMuted = isLight(c) ? '#4b5563' : 'rgba(255,255,255,0.78)';
        const textTitle = isLight(c) ? '#6b7280' : 'rgba(255,255,255,0.62)';
        root.style.setProperty('--vz-vertical-menu-item-color', textMuted);
        root.style.setProperty('--vz-vertical-menu-item-hover-color', text);
        root.style.setProperty('--vz-vertical-menu-sub-item-color', textMuted);
        root.style.setProperty('--vz-vertical-menu-sub-item-hover-color', text);
        root.style.setProperty('--vz-vertical-menu-title-color', textTitle);
        root.style.setProperty('--vz-header-item-color', text);
      }
    }

    if (user.secondary_color) {
      const c = hexToRgb(user.secondary_color);
      if (c) {
        // Active-menu accent
        root.style.setProperty('--vz-vertical-menu-item-active-color', user.secondary_color);
        root.style.setProperty('--vz-vertical-menu-sub-item-active-color', user.secondary_color);
        root.style.setProperty('--vz-vertical-menu-item-active-bg', `rgba(${rgbStr(c)}, 0.12)`);
        root.style.setProperty('--vz-topnav-item-active-color', user.secondary_color);
        // Bootstrap secondary
        root.style.setProperty('--vz-secondary', user.secondary_color);
        root.style.setProperty('--vz-secondary-rgb', rgbStr(c));
      }
    }

    return clearTenantVars;
  }, [user?.primary_color, user?.secondary_color, tenantThemeEnabled]);

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
    // Clear any per-user state (branch selection etc.) for the user that just logged out
    if (user?.id) {
      try { localStorage.removeItem(`cbc_selected_branch_id_${user.id}`); } catch {}
    }
    writeCachedUser(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, googleLogin, logout, refresh, tenantThemeEnabled, toggleTenantTheme }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
