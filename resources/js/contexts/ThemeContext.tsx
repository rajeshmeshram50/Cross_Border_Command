import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; toggle: () => void }

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

const readInitialTheme = (): Theme => {
  const html = document.documentElement;
  const fromHtml = html.getAttribute('data-bs-theme') || html.getAttribute('data-theme');
  if (fromHtml === 'dark' || fromHtml === 'light') return fromHtml;
  // `cbc-layout-mode` is the CANONICAL key: app.tsx seeds <html> from it before
  // React mounts, and Velzon's Redux boots from it. `cbc_theme` is our legacy
  // key, kept as a fallback. Read the canonical one first so a refresh restores
  // exactly what the user last chose.
  const stored = localStorage.getItem('cbc-layout-mode') || localStorage.getItem('cbc_theme');
  return stored === 'dark' ? 'dark' : 'light';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Push our theme to BOTH attributes whenever state changes.
  useEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') !== theme) html.setAttribute('data-theme', theme);
    if (html.getAttribute('data-bs-theme') !== theme) html.setAttribute('data-bs-theme', theme);
    // Persist to BOTH keys so the choice survives a hard refresh: `cbc-layout-mode`
    // is what app.tsx seeds <html> from (pre-React) and what Velzon's Redux reads
    // on boot — without this they'd reset to their stale value and flip the theme.
    localStorage.setItem('cbc_theme', theme);
    localStorage.setItem('cbc-layout-mode', theme);
  }, [theme]);

  // Keep our state in sync when anything else flips `data-bs-theme` or `data-theme`
  // on <html> (e.g. Velzon's RightSidebar topbar toggle dispatches Redux which only
  // sets `data-bs-theme`).  Without this, CSS-var-based pages (--color-surface, etc.)
  // would stay in light mode.
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const bs = html.getAttribute('data-bs-theme');
      const dt = html.getAttribute('data-theme');
      const next = (bs === 'dark' || bs === 'light') ? bs
                : (dt === 'dark' || dt === 'light') ? dt
                : null;
      if (next && next !== theme) setTheme(next);
    });
    observer.observe(html, { attributes: true, attributeFilter: ['data-bs-theme', 'data-theme'] });
    return () => observer.disconnect();
  }, [theme]);

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
