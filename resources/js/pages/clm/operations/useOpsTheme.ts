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

/* ─────────────────────────────────────────────────────────────────────────
 * THE SEARCH BOX — one definition for the three inline-styled Operations
 * pages.
 *
 * Each of them used to write its own box, and no two agreed: Agreements We
 * Sent was 44px tall at radius 11 with a 12px input, Agreements To Approve was
 * 42px at radius 30 (a full pill) with a 12px input, Case to Case was 42px at
 * radius 11 in violet with a 13px input — and none of the three had a focus
 * ring at all, while the eleven other CLM pages do.
 *
 * The canonical box is `.clm-search` in clmShared.ts, which those eleven pages
 * share: 42px tall, radius 8, a 1.5px accent hairline, a 13px/500 input and a
 * 3px focus glow, sized to 500px. These are the same numbers. The only thing
 * parameterised is the accent, as a modifier class, so a violet page stays
 * violet without needing a second copy of the rule.
 *
 * Append it to the page's own <style> block: <style>{AWS_CSS + OPS_SEARCH_CSS}</style>
 * ───────────────────────────────────────────────────────────────────────── */
export const OPS_SEARCH_CSS = `
.ops-search {
  display: flex; align-items: center; gap: 8px;
  box-sizing: border-box;
  /* 48px, the height of the tab rail it sits beside — and now the one number
     every toolbar control in CLM states. A rail is a 40px tab inside 3px of
     padding and a 1px border on each side, so 48 is the only height a visible
     capsule can have while the tab stays 40. This rule covers Case to Case,
     Agreements We Sent, Agreements To Approve and Supplier Profile;
     .clm-search carries the same 48 for the master pages. It was briefly
     43.5, which left every rail standing 4.5px proud of its own search. */
  height: 48px; padding: 0 14px;
  border: 1.5px solid var(--ops-edge);
  border-radius: 11px;
  background: var(--ops-fill);
  /* FIXED, not shrinkable (QA #107). Typing filters the list, which changes
     the counts in the tabs beside it; the rail then measures narrower and a
     shrinkable search grew back toward its basis as you typed. flex-basis is
     a starting width, not a promise - only a 0 shrink factor keeps the box
     still. The spacer beside it absorbs the difference. */
  flex: 0 0 500px; max-width: 500px; min-width: 0;
  /* Gloss, not lift — the same treatment .clm-search carries, so the two
     halves of the module match. Almost all of it is inset: a bright hairline
     along the top edge where a lit surface catches the light, a faint accent
     line along the bottom where it falls away, and an outer shadow small
     enough (1px contact, 3px blur pulled back by -4) to seat the field on the
     toolbar rather than raise it off. Flat before this. */
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.95),
    inset 0 -1px 0 rgba(var(--ops-a), .07),
    0 1px 2px rgba(var(--ops-a), .06),
    0 3px 8px -4px rgba(var(--ops-a), .14);
  /* Only the focus chrome eases — never the width. As a flex item this bar
     resizes when the page gains a scrollbar on data load, and animating that
     made the bar settle visibly on every load. Same reasoning as .clm-search. */
  transition: border-color .15s ease, box-shadow .15s ease;
}
/* The focus ring replaces the whole box-shadow, so the top highlight has to be
   restated or the field goes flat at the moment it is being used. */
.ops-search:focus-within {
  border-color: var(--ops-ico);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.95), 0 0 0 3px rgba(var(--ops-a), .14);
}
.ops-search > svg { width: 16px; height: 16px; flex-shrink: 0; stroke: var(--ops-ico); }
.ops-search input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 13px; font-weight: 500;
  color: var(--ops-search-text);
}
.ops-search input::placeholder { color: var(--ops-ph); font-weight: 500; }
/* The violet set is HRMS's own palette — --dt-a-50 #faf5ff, -200 #ddd6fe,
   -400 #a78bfa — put through the same mixes .dt-search uses, so Case to Case's
   field is pixel-for-pixel the employee list's. The cyan set is those mixes on
   CLM's teal ramp (#f0fdff / #a5f3fc / #22d3ee). */
/* Both fills start at pure white and travel to the accent-50, matching
   .clm-search in clmShared.ts — which is the field on Segment Master, the one
   these are being measured against. They each ran two near-identical tints
   before (#f6feff to #f0fdff is six values apart; #fcf9ff to #faf5ff is
   three), which is flat enough that the inset highlight on the rule above had
   almost nothing to sit against and the field still read as painted on. */
.ops-search--cyan {
  --ops-a: 6,182,212;  --ops-search-text: #0c4a6e;
  --ops-fill: linear-gradient(180deg, #ffffff 0%, #f4fdff 48%, #e8fbff 100%);
  --ops-edge: #cef8fd; --ops-ico: #22d3ee; --ops-ph: #50c0d8;
  --ops-fill-flat: #f6feff;
}
.ops-search--violet {
  --ops-a: 124,58,237; --ops-search-text: #1e1050;
  --ops-fill: linear-gradient(180deg, #ffffff 0%, #fbf8ff 48%, #f4efff 100%);
  --ops-edge: #ece8fe; --ops-ico: #a78bfa; --ops-ph: #9f95e0;
  --ops-fill-flat: #fcf9ff;
}
/* Dark: a translucent wash of the accent, as HRMS does it, rather than a flat
   panel colour — these pages sit on a violet-black card (#161226) instead of
   the slate the rest of CLM uses, and a tint reads correctly on either. */
[data-bs-theme="dark"] .ops-search,
/* Dark keeps the lit top edge but at a fraction of the strength — a .95 white
   hairline over a dark panel is a glare line, not a highlight — and drops the
   outer shadow, which does nothing against a dark surface anyway. */
[data-layout-mode="dark"] .ops-search {
  background: rgba(var(--ops-a), .10);
  border-color: rgba(var(--ops-a), .26);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
}
[data-bs-theme="dark"] .ops-search input,
[data-layout-mode="dark"] .ops-search input { color: #e2e8f0; }
/* Chrome paints an autofilled / previously-searched input with its own pale
   fill, which shows through as a tinted band across the bar. The 1000px inset
   shadow is the only way to repaint that internal surface. */
.ops-search input:-webkit-autofill,
.ops-search input:-webkit-autofill:hover,
.ops-search input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--ops-search-text);
  caret-color: var(--ops-search-text);
  -webkit-box-shadow: 0 0 0 1000px var(--ops-fill-flat) inset !important;
  box-shadow: 0 0 0 1000px var(--ops-fill-flat) inset !important;
  transition: background-color 9999s ease-in-out 0s;
}
[data-bs-theme="dark"] .ops-search input:-webkit-autofill,
[data-bs-theme="dark"] .ops-search input:-webkit-autofill:hover,
[data-bs-theme="dark"] .ops-search input:-webkit-autofill:focus {
  -webkit-text-fill-color: #e2e8f0;
  caret-color: #e2e8f0;
  -webkit-box-shadow: 0 0 0 1000px #1e293b inset !important;
  box-shadow: 0 0 0 1000px #1e293b inset !important;
}
@media (max-width: 760px) {
  .ops-search { flex: 1 1 100%; max-width: none; min-width: 0; }
}
`;

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
