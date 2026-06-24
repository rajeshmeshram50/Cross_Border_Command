import { useTheme } from '../../../contexts/ThemeContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Dark-mode token set for the CLM Operations · Without Shipment ID pages.
 *
 * These pages are inline-styled, so CSS `[data-bs-theme="dark"]` overrides
 * can't reach them (inline wins). Instead we read the theme via useTheme()
 * and swap the *structural* surface colours — card/table/tab/search/pager
 * backgrounds, borders, body text and row striping — while leaving the
 * vibrant gradient headers, icons, badges and buttons untouched (they read
 * fine on either background).
 * ───────────────────────────────────────────────────────────────────────── */

export type OpsTokens = {
  dark: boolean;
  surface: string;       // card / panel background
  tableBg: string;       // table body base background
  rowAlt: string;        // zebra-stripe background for even rows
  rowHover: string;      // hover-row background
  cellBorder: string;    // table cell bottom border
  border: string;        // generic card / divider border
  text: string;          // primary body text
  textStrong: string;    // emphasised text (titles in tables)
  textSub: string;       // secondary text (dates, names)
  textMuted: string;     // muted captions
  tabCapsule: string;    // pill-tab capsule background
  tabInactive: string;   // inactive tab label colour
  searchBg: string;      // search box background
  searchBorder: string;  // search box border
  searchText: string;    // search input text
  pagerBg: string;       // pagination footer background
  pagerBtn: string;      // inactive pager button background
};

export function useOpsTheme(accent: 'cyan' | 'violet'): OpsTokens {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  if (!dark) {
    return {
      dark, surface: '#fff', tableBg: '#fff',
      rowAlt: accent === 'cyan' ? 'rgba(240,253,255,.5)' : 'rgba(245,243,255,.35)',
      rowHover: accent === 'cyan' ? 'rgba(6,182,212,.05)' : 'rgba(109,40,217,.05)',
      cellBorder: accent === 'cyan' ? 'rgba(6,182,212,.06)' : 'rgba(109,40,217,.06)',
      border: accent === 'cyan' ? '#A5F3FC' : 'rgba(109,40,217,.15)',
      text: '#0F172A', textStrong: '#1E1050', textSub: '#374151', textMuted: '#94A3B8',
      tabCapsule: 'linear-gradient(110deg,#F0FDFF,#E0F9FC,#CFFAFE)',
      tabInactive: accent === 'cyan' ? '#0e7490' : '#5B21B6',
      searchBg: accent === 'cyan' ? '#F0FDFF' : '#F8F6FF',
      searchBorder: accent === 'cyan' ? '#A5F3FC' : '#EDE9FE',
      searchText: accent === 'cyan' ? '#0F172A' : '#1E1050',
      pagerBg: accent === 'cyan' ? 'linear-gradient(110deg,#F0FDFF,#CFFAFE)' : 'linear-gradient(110deg,#F5F3FF,#EDE9FE)',
      pagerBtn: accent === 'cyan' ? 'rgba(240,253,255,.7)' : 'rgba(245,243,255,.7)',
    };
  }
  // dark
  return {
    dark, surface: '#161226', tableBg: '#161226',
    rowAlt: 'rgba(255,255,255,.025)',
    rowHover: accent === 'cyan' ? 'rgba(6,182,212,.10)' : 'rgba(124,58,237,.14)',
    cellBorder: 'rgba(148,163,184,.12)',
    border: 'rgba(148,163,184,.18)',
    text: '#e2e8f0', textStrong: '#f1f5f9', textSub: '#cbd5e1', textMuted: '#94a3b8',
    tabCapsule: 'rgba(255,255,255,.05)',
    tabInactive: accent === 'cyan' ? '#67e8f9' : '#c4b5fd',
    searchBg: 'rgba(255,255,255,.05)',
    searchBorder: 'rgba(148,163,184,.22)',
    searchText: '#e2e8f0',
    pagerBg: 'rgba(255,255,255,.03)',
    pagerBtn: 'rgba(255,255,255,.05)',
  };
}
