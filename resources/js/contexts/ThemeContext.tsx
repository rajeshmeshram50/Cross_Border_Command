import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; toggle: () => void }

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

const readInitialTheme = (): Theme => {
  const html = document.documentElement;
  const fromHtml = html.getAttribute('data-bs-theme') || html.getAttribute('data-theme');
  if (fromHtml === 'dark' || fromHtml === 'light') return fromHtml;
  const stored = localStorage.getItem('cbc_theme');
  return stored === 'dark' ? 'dark' : 'light';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Push our theme to BOTH attributes whenever state changes.
  useEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') !== theme) html.setAttribute('data-theme', theme);
    if (html.getAttribute('data-bs-theme') !== theme) html.setAttribute('data-bs-theme', theme);
    localStorage.setItem('cbc_theme', theme);
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
