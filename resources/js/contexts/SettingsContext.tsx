import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

/* ──────────────────────────────────────────────────────────────────
 * Platform-wide Settings context.
 *
 * Loaded once at app boot from GET /api/settings, cached in localStorage
 * for instant subsequent loads, refreshed by the Settings page after
 * a save. Every consumer reads via `useSettings()`.
 *
 * Beyond just exposing the values, this context also APPLIES them as
 * live "dependencies":
 *   - document.title <- general.platform_name
 *   - <link rel=icon> <- appearance.favicon_path
 *   - CSS root vars (--vz-primary / --vz-secondary) <- appearance colors
 *     [tenant theme in AuthContext takes precedence and overrides these]
 * ────────────────────────────────────────────────────────────────── */

export interface PlatformSettings {
  general: {
    platform_name: string; tagline: string; description: string;
    support_email: string; admin_email: string; contact_phone: string; website_url: string;
  };
  security: {
    tfa: boolean; pwReset: boolean; loginNotif: boolean;
    ipWhite: boolean; sessTimeout: boolean; bruteForce: boolean;
  };
  notifications: {
    emailNotif: boolean; pushNotif: boolean; planExp: boolean;
    newUser: boolean; payAlerts: boolean; weeklyReports: boolean;
  };
  appearance: {
    primary_color: string; secondary_color: string; dark_default: boolean;
    logo_path: string | null; favicon_path: string | null;
  };
  privacy: {
    encrypt: boolean; actLog: boolean; retention: boolean;
    cookie: boolean; privacy_policy_url: string;
  };
  help: { faqs: { q: string; a: string }[] };
  contact: {
    support_email: string; support_phone: string;
    website: string; status_page: string; emergency_phone: string;
  };
}

const FALLBACK: PlatformSettings = {
  general:       { platform_name: 'Cross Border Command', tagline: 'Multi-Tenant SaaS Platform', description: '', support_email: '', admin_email: '', contact_phone: '', website_url: '' },
  security:      { tfa: false, pwReset: false, loginNotif: false, ipWhite: false, sessTimeout: false, bruteForce: false },
  notifications: { emailNotif: true, pushNotif: true, planExp: true, newUser: true, payAlerts: true, weeklyReports: false },
  appearance:    { primary_color: '#4F46E5', secondary_color: '#10B981', dark_default: false, logo_path: null, favicon_path: null },
  privacy:       { encrypt: true, actLog: true, retention: false, cookie: true, privacy_policy_url: '' },
  help:          { faqs: [] },
  contact:       { support_email: '', support_phone: '', website: '', status_page: '', emergency_phone: '' },
};

interface Ctx {
  settings: PlatformSettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SettingsCtx = createContext<Ctx>({ settings: FALLBACK, loading: false, refresh: async () => {} });

const CACHE_KEY = 'cbc_platform_settings_v1';

function readCache(): PlatformSettings | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...FALLBACK, ...parsed, general: { ...FALLBACK.general, ...(parsed.general || {}) },
      security: { ...FALLBACK.security, ...(parsed.security || {}) },
      notifications: { ...FALLBACK.notifications, ...(parsed.notifications || {}) },
      appearance: { ...FALLBACK.appearance, ...(parsed.appearance || {}) },
      privacy: { ...FALLBACK.privacy, ...(parsed.privacy || {}) },
      help: { ...FALLBACK.help, ...(parsed.help || {}) },
      contact: { ...FALLBACK.contact, ...(parsed.contact || {}) },
    };
  } catch { return null; }
}

function writeCache(s: PlatformSettings) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
}

/* ────────────────────────────────────────────────────────────────── */

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<PlatformSettings>(() => readCache() ?? FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const merged: PlatformSettings = { ...FALLBACK };
      for (const k of Object.keys(FALLBACK) as (keyof PlatformSettings)[]) {
        if (res.data[k] && typeof res.data[k] === 'object') {
          (merged as any)[k] = { ...(FALLBACK as any)[k], ...res.data[k] };
        }
      }
      setSettings(merged);
      writeCache(merged);
    } catch {
      // Silent — fall back to cached/default values; the rest of the app
      // shouldn't break just because settings can't be fetched (e.g. network
      // issue or pre-login).
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount AND every time the active user changes. The user-id
  // dependency catches the fresh-login case: a clean browser starts with
  // user=null, the boot fetch returns 401 (silently), then AFTER login
  // the user becomes truthy and this effect re-fires to load real values.
  // Without this, settings would stay on FALLBACK until the next reload.
  useEffect(() => { refresh(); }, [refresh, user?.id]);

  /* ── DEPENDENCY 1 — document.title ── */
  useEffect(() => {
    if (settings.general.platform_name) {
      document.title = settings.general.platform_name;
    }
  }, [settings.general.platform_name]);

  /* ── DEPENDENCY 2 — favicon ── */
  useEffect(() => {
    const path = settings.appearance.favicon_path;
    if (!path) return;
    const url = `/storage/${path}`;
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  }, [settings.appearance.favicon_path]);

  /* ── DEPENDENCY 3 — platform default theme colors ──
   *  Apply as CSS root vars. The AuthContext theme effect runs AFTER
   *  this and will OVERRIDE these vars when the user's tenant has its
   *  own primary/secondary colors set. So:
   *    no tenant override         → platform colors apply
   *    tenant has overrides       → tenant colors take precedence
   */
  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex: string): string | null => {
      const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };
    const p = settings.appearance.primary_color;
    const s = settings.appearance.secondary_color;
    if (p && hexToRgb(p)) {
      root.style.setProperty('--cbc-platform-primary', p);
      root.style.setProperty('--cbc-platform-primary-rgb', hexToRgb(p)!);
    }
    if (s && hexToRgb(s)) {
      root.style.setProperty('--cbc-platform-secondary', s);
      root.style.setProperty('--cbc-platform-secondary-rgb', hexToRgb(s)!);
    }
  }, [settings.appearance.primary_color, settings.appearance.secondary_color]);

  return (
    <SettingsCtx.Provider value={{ settings, loading, refresh }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export const useSettings = () => useContext(SettingsCtx);
