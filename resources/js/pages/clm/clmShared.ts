/* ─────────────────────────────────────────────────────────────────────────
 * CLM Master Management — shared visual tokens + base CSS.
 *
 * Faithful port of the design tokens from the CLM-Master.html prototype:
 *
 *   - `.clm-head-strip`  Cyan-tinted gradient header card with left rainbow
 *                        stripe, gradient-circle icon with green status dot,
 *                        breadcrumb + title + sub, and gradient teal Add btn.
 *   - `.clm-bref-box`    "What We Are Doing Here" collapsible info card with
 *                        Step 01–05 tiles in a responsive grid.
 *   - `.clm-page-card`   White card wrapper with cyan-tinted border.
 *
 * Each master page (Segment, Authority, KYC, DD, TL, QC, Trade Documents,
 * T&C, Agreements, Clause Library, Document Control Panel) renders under
 * a `clm-root` wrapper and pulls in CLM_CSS so the cyan/teal design stays
 * consistent across the module.
 *
 * Page-specific tweaks (extra table columns, badge colours for new value
 * types, etc.) go into a tiny per-page CSS string and are concatenated
 * after CLM_CSS via `<style>{CLM_CSS + PAGE_CSS}</style>`.
 * ───────────────────────────────────────────────────────────────────────── */

export const CLM_CSS = `
/* App footer — CLM cyan gradient. Gated on body.clm-active (set only while a
   CLM master page is mounted, see ClmPageHeader) so it can NEVER leak onto
   HR / Sales / etc. The footer lives outside .clm-root, so the body class is
   the reliable scope. !important beats Velzon's own footer styles. */
body.clm-active footer.footer { background: linear-gradient(110deg, #e0f9fd 0%, #cef8ff 18%, #d0f4f9 45%, #baeef7 75%, #a0e8f2 100%) !important; border-top: 1px solid #a5e8f5 !important; }
body.clm-active footer.footer, body.clm-active footer.footer * { color: #0c4a6e !important; font-weight: 600; }
/* Dark mode — deep slate footer with cyan accents so it matches the dark UI
   instead of staying a glaring light-cyan band. */
body.clm-active[data-bs-theme="dark"] footer.footer,
[data-bs-theme="dark"] body.clm-active footer.footer { background: linear-gradient(110deg, #0b1220 0%, #0e1726 45%, #0b1a24 100%) !important; border-top: 1px solid rgba(6,182,212,.30) !important; }
body.clm-active[data-bs-theme="dark"] footer.footer, body.clm-active[data-bs-theme="dark"] footer.footer *,
[data-bs-theme="dark"] body.clm-active footer.footer, [data-bs-theme="dark"] body.clm-active footer.footer * { color: #67e8f9 !important; }
/* WorklistPager is violet app-wide; recolour to CLM cyan, scoped to .clm-root
   (the pager renders inside it) so other modules keep the violet pager. */
.clm-root .wl-pager, .clm-root .tc-wl-pag { border-top-color: #a5e8f5; background: linear-gradient(90deg, #f0fdff 0%, #e6fafe 40%, #f0fdff 100%); }
.clm-root .tc-wl-info, .clm-root .tc-wl-rows { color: #0e7490; border-color: #a5e8f5; }
.clm-root .tc-wl-info .tc-wl-hl, .clm-root .tc-wl-rows select { color: #0891b2; }
.clm-root .tc-wl-range { background: linear-gradient(135deg, #22d3ee 0%, #0891b2 55%, #0e7490 100%); box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset; }
/* Dark mode — the light-cyan overrides above out-specify the base dark pager
   styles, so re-state them for dark with a higher-specificity .clm-root prefix.
   The cyan page-count pill (.tc-wl-range) stays as-is; it reads fine on dark. */
[data-bs-theme="dark"] .clm-root .wl-pager, [data-bs-theme="dark"] .clm-root .tc-wl-pag { border-top-color: rgba(6,182,212,.30); background: linear-gradient(90deg, #0b1220 0%, #0e1726 45%, #0b1220 100%); }
[data-bs-theme="dark"] .clm-root .tc-wl-info, [data-bs-theme="dark"] .clm-root .tc-wl-rows, [data-bs-theme="dark"] .clm-root .tc-wl-btn { color: #67e8f9; border-color: rgba(6,182,212,.30); background: rgba(255,255,255,.05); }
[data-bs-theme="dark"] .clm-root .tc-wl-info .tc-wl-hl, [data-bs-theme="dark"] .clm-root .tc-wl-rows select { color: #a5f3fc; }
[data-bs-theme="dark"] .clm-root .tc-wl-btn:hover:not(:disabled) { background: rgba(255,255,255,.10); border-color: #22d3ee; }
.clm-root .tc-wl-btn { border-color: #a5e8f5; color: #0891b2; }
.clm-root .tc-wl-btn:hover:not(:disabled) { border-color: #0891b2; box-shadow: 0 4px 12px rgba(8,145,178,.25); }
.clm-root {
  padding: 0;
  margin-top: -8px;
  width: 100%;
  font-family: 'Rubik', system-ui, sans-serif;
  font-size: 14px;
  letter-spacing: normal;
  color: #0F172A;
  display: flex; flex-direction: column; gap: 10px;
  background: transparent;
  box-sizing: border-box;
}
.clm-root * { box-sizing: border-box; }

/* ── Generic page card ── */
.clm-page-card {
  background: #fff;
  border: 1px solid rgba(6,182,212,.2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(6,182,212,.08), 0 1px 3px rgba(15,23,42,.04);
}

/* ──────────────────────────────────────────────────────────
 * HEADER STRIP — cyan-tinted gradient card with left rainbow
 * stripe + icon (with green status dot) + title + Add button.
 * Mirrors the prototype's "Card 1" block on every page.
 * ────────────────────────────────────────────────────────── */
.clm-head-strip {
  background: linear-gradient(110deg, #e0f9fd 0%, #cef8ff 18%, #d0f4f9 45%, #baeef7 75%, #a0e8f2 100%);
  border: 1px solid rgba(6,182,212,.2);
  border-radius: 14px;
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; min-height: 64px; gap: 14px;
  box-shadow: 0 2px 10px rgba(6,182,212,.10);
}
.clm-head-strip::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px;
  background: linear-gradient(180deg, #22d3ee, #0891b2, #0e7490);
}
.clm-head-strip::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
  pointer-events: none;
}
.clm-head-strip > * { position: relative; z-index: 1; }
.clm-head-strip-left { display: flex; align-items: center; gap: 14px; padding-left: 10px; min-width: 0; }
.clm-head-strip-ico-wrap { position: relative; flex-shrink: 0; }
.clm-head-strip-ico {
  width: 46px; height: 46px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #06b6d4, #0891b2, #0e7490);
  color: #fff;
  box-shadow: 0 0 0 3px rgba(6,182,212,.22), 0 4px 12px rgba(8,145,178,.40);
}
.clm-head-strip-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #cef8ff;
  box-shadow: 0 0 5px rgba(34,197,94,.45);
}
.clm-head-strip-text { min-width: 0; }
.clm-head-strip-title {
  font-size: 16px; font-weight: 500; color: #0c4a6e;
  letter-spacing: -.4px; line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.clm-head-strip-sub {
  font-size: 11px; font-weight: 500; color: #0e7490;
  opacity: .9; margin-top: 3px; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.clm-add-btn {
  position: relative; overflow: hidden; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 20px; border: none; cursor: pointer;
  border-radius: 10px; font-family: inherit;
  font-size: 13px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #06b6d4, #0891b2, #0e7490);
  box-shadow: 0 4px 14px rgba(8,145,178,.44), inset 0 1px 0 rgba(255,255,255,.18);
  transition: transform .18s ease, box-shadow .22s ease;
}
.clm-add-btn::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.18); }

/* Inline "+" quick-add button — sits to the right of a MasterSelect to
 * spawn a SimpleNameModal/SimpleDescModal without leaving the form. */
.clm-quick-add-btn {
  width: 34px; height: 34px; flex-shrink: 0;
  border: none; border-radius: 9px; cursor: pointer;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(8,145,178,.35);
  transition: transform 180ms cubic-bezier(0.34,1.56,0.64,1), box-shadow .22s ease, filter 180ms ease;
}
.clm-quick-add-btn:hover { transform: translateY(-1px) scale(1.06); filter: brightness(1.08); box-shadow: 0 8px 20px rgba(8,145,178,.50); }
.clm-quick-add-btn:active { transform: translateY(0) scale(0.97); box-shadow: 0 4px 12px rgba(8,145,178,.4); }
[data-bs-theme="dark"] .clm-quick-add-btn { box-shadow: 0 3px 10px rgba(8,145,178,.55); }

/* ──────────────────────────────────────────────────────────
 * BREF-BOX — "What We Are Doing Here" expandable info panel.
 * Mirrors the prototype's "Card 2" block on every page.
 * ────────────────────────────────────────────────────────── */
.clm-bref { background: #fff; border: none; border-radius: 0; overflow: hidden; position: relative; }
.clm-bref::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #67e8f9, #0891b2, #0e7490);
  z-index: 10;
}
.clm-bref-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px;
  padding: 7px 12px;
  background: linear-gradient(110deg, #f0fdff 0%, #e8fbfd 30%, #d8f8fc 60%, #caf5fa 80%, #baf2f9 100%);
  border-bottom: 1px solid #A5F3FC;
  cursor: pointer; user-select: none;
  transition: background .18s;
  min-height: 48px;
}
.clm-bref-head:hover { background: linear-gradient(110deg, #e8fbfd 0%, #cff9fc 30%, #c4f3f9 60%, #b3eef7 80%, #a2eaf6 100%); }
.clm-bref-head::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.6), transparent);
  pointer-events: none;
}
.clm-bref.collapsed .clm-bref-head { border-bottom-color: transparent; }
.clm-bref-ico {
  width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  display: flex; align-items: center; justify-content: center; color: #fff;
  position: relative; z-index: 1;
  box-shadow: 0 0 0 3px rgba(6,182,212,.20), 0 4px 12px rgba(8,145,178,.36);
}
.clm-bref-mid { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; position: relative; z-index: 1; }
.clm-bref-row { display: flex; align-items: center; gap: 9px; }
.clm-bref-label { font-size: 9.5px; font-weight: 500; letter-spacing: -.2px; color: #0891b2; line-height: 1; white-space: nowrap; flex-shrink: 0; }
.clm-bref-sep { width: 1px; height: 13px; background: #A5E8F5; flex-shrink: 0; }
.clm-bref-title { font-size: 11px; font-weight: 500; color: #0c4a6e; letter-spacing: -.2px; line-height: 1; white-space: nowrap; }
.clm-bref-sub { font-size: 9.5px; font-weight: 500; color: #0e7490; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clm-bref-toggle {
  width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.75); border: 1.5px solid rgba(8,145,178,.22); color: #0891b2;
  transition: transform .24s cubic-bezier(.22,1,.36,1), background .15s, box-shadow .15s;
  box-shadow: 0 1px 4px rgba(8,145,178,.10), inset 0 1px 0 rgba(255,255,255,.9);
  position: relative; z-index: 1;
}
.clm-bref-head:hover .clm-bref-toggle { background: rgba(255,255,255,.95); border-color: rgba(8,145,178,.40); box-shadow: 0 2px 8px rgba(6,182,212,.18), inset 0 1px 0 rgba(255,255,255,.9); }
.clm-bref.collapsed .clm-bref-toggle { transform: rotate(-90deg); }
.clm-bref-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  background: linear-gradient(180deg, #F0F9FF 0%, #F8FAFC 100%);
  gap: 0; overflow: hidden;
  max-height: 320px; opacity: 1;
  transition: max-height .3s cubic-bezier(.22,1,.36,1), opacity .22s;
}
.clm-bref.collapsed .clm-bref-body { max-height: 0; opacity: 0; }
.clm-bref-item {
  position: relative; padding: 10px 11px 11px;
  background: #fff; margin: 7px 5px;
  border-radius: 11px; border: 1.5px solid #E4EFF5;
  transition: box-shadow .18s, border-color .18s, transform .18s;
  display: flex; flex-direction: column; gap: 0; overflow: hidden;
  box-shadow: 0 1px 4px rgba(15,23,42,.04);
}
.clm-bref-item:first-child { margin-left: 7px; }
.clm-bref-item:last-child  { margin-right: 7px; }
.clm-bref-item:hover { border-color: #67E8F9; box-shadow: 0 6px 18px rgba(6,182,212,.14), 0 1px 4px rgba(15,23,42,.04); transform: translateY(-2px); }
.clm-bref-item::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  border-radius: 11px 11px 0 0;
  background: linear-gradient(90deg, #06b6d4, #0891b2);
}
.clm-bref-item-top { display: flex; align-items: center; gap: 6px; margin-bottom: 0; }
.clm-bref-item-ico { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #0891b2; }
.clm-bref-item-num { font-size: 8.5px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase; color: #94A3B8; line-height: 1; }
.clm-bref-item-title { font-size: 11px; font-weight: 500; color: #0F172A; letter-spacing: -.2px; line-height: 1.25; margin-bottom: 3px; margin-top: 5px; }
.clm-bref-item-desc { font-size: 9.5px; font-weight: 500; color: #94A3B8; line-height: 1.4; }
@media (max-width: 1100px) { .clm-bref-body { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 700px)  { .clm-bref-body { grid-template-columns: repeat(2, 1fr); } }

/* ──────────────────────────────────────────────────────────
 * TABS WRAP + TABS BAR — table card top section.
 * ────────────────────────────────────────────────────────── */
.clm-tabs-wrap { background: #fff; overflow: visible; }
.clm-tabs-bar {
  display: flex; align-items: center;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid rgba(6,182,212,.12);
  gap: 6px; position: relative;
  flex-wrap: wrap;
}
.clm-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: #475569;
  cursor: pointer; border: none; background: transparent;
  font-family: inherit; transition: background .15s ease, color .15s ease, box-shadow .22s ease;
  white-space: nowrap; position: relative; z-index: 1;
}
.clm-tab:hover { background: rgba(6,182,212,.08); color: #0891b2; }
.clm-tab.active {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 45%, #0e7490 100%);
  color: #fff; font-weight: 600;
  box-shadow: 0 3px 10px rgba(8,145,178,.32), inset 0 1px 0 rgba(255,255,255,.18);
}
.clm-tab.active:hover { opacity: .95; }
.clm-tab-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.clm-tab.active .clm-tab-dot { background: rgba(255,255,255,.65) !important; box-shadow: none !important; }
.clm-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; border-radius: 20px; padding: 0 6px;
  font-size: 10px; font-weight: 500;
}
.clm-tab.active .clm-tab-count {
  background: rgba(255,255,255,.18); color: #fff;
  border: 1px solid rgba(255,255,255,.25);
}
.clm-tab:not(.active) .clm-tab-count {
  background: #F1F5F9; color: #64748B;
  border: 1px solid #E2E8F0;
}

/* Premium pill switcher for 2-tab header strips (TD/TNC/AGR/CL) */
.clm-pill-group {
  display: flex; align-items: center; gap: 0; flex-shrink: 0;
  background: rgba(255,255,255,.55);
  backdrop-filter: blur(8px);
  border-radius: 14px; padding: 4px;
  border: 1.5px solid rgba(255,255,255,.8);
  box-shadow: 0 4px 20px rgba(8,145,178,.18), inset 0 1px 0 rgba(255,255,255,.9);
}
.clm-pill {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 20px; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: none; background: transparent;
  color: #0891b2; box-shadow: none;
  transition: all .2s; letter-spacing: .01em;
}
.clm-pill.active {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-weight: 700;
  box-shadow: 0 4px 14px rgba(8,145,178,.45), inset 0 1px 0 rgba(255,255,255,.2);
}
.clm-pill.active::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-pill-ico {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: rgba(8,145,178,.1);
  border: 1px solid rgba(8,145,178,.2);
  flex-shrink: 0;
  color: #0891b2;
}
.clm-pill.active .clm-pill-ico {
  background: rgba(255,255,255,.18);
  border-color: rgba(255,255,255,.25);
  color: #fff;
}

/* Search input */
.clm-search {
  display: flex; align-items: center; gap: 7px;
  padding: 0 12px; height: 34px;
  border: 1.5px solid rgba(6,182,212,.22); border-radius: 8px;
  background: #fff;
  flex: 1 1 240px; min-width: 200px;
  /* Only the focus chrome (border + glow) transitions. Width is deliberately
     NOT animated — as a flex item this bar's width changes when the page gains
     a scrollbar on data load, and animating that reflow made the search bar
     (and the controls beside it) flicker/settle on every load. */
  transition: border-color .15s ease, box-shadow .15s ease;
  box-shadow: 0 1px 4px rgba(6,182,212,.07);
}
.clm-search:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.12); }
.clm-search input { flex: 1; border: none; outline: none; font-size: 12px; background: transparent; color: #0c4a6e; font-family: inherit; }
/* Neutralise the browser autofill highlight on the search field. Chrome
   paints autofilled / previously-searched inputs with a pale fill (yellow/
   cyan in light mode, near-white in dark) that overrides our transparent
   input bg and shows up as a tinted "shimmer" across the bar. The 1000px
   inset box-shadow trick is the only way to repaint that internal surface —
   here it's the light search bg; the dark-mode override below swaps it. */
.clm-search input:-webkit-autofill,
.clm-search input:-webkit-autofill:hover,
.clm-search input:-webkit-autofill:focus,
.clm-search input:-webkit-autofill:active {
  -webkit-text-fill-color: #0c4a6e;
  caret-color: #0c4a6e;
  -webkit-box-shadow: 0 0 0 1000px #fff inset !important;
  box-shadow: 0 0 0 1000px #fff inset !important;
  transition: background-color 9999s ease-in-out 0s;
}
.clm-search-grow:focus-within { width: 480px; }

/* Figma-match: fixed-width search box (not flex-grow). Pairs with the toolbar's
   space-between so a Total badge sits at the far right. Expands on focus. */
.clm-tabs-bar .clm-search-fixed {
  flex: 0 0 auto; width: 500px; max-width: 100%;
  transition: width .18s ease, border-color .15s ease, box-shadow .15s ease;
}
.clm-tabs-bar .clm-search-fixed:focus-within { width: 580px; }
@media (max-width: 1280px) { .clm-tabs-bar .clm-search-fixed { width: 360px; } }
@media (max-width: 760px)  { .clm-tabs-bar .clm-search-fixed { width: 100%; } }

/* Compound Total badge — icon block + label + count number */
.clm-total {
  display: inline-flex; align-items: center; gap: 0;
  border-radius: 12px; overflow: hidden;
  border: 1.5px solid rgba(8,145,178,.6);
  box-shadow: 0 4px 14px rgba(8,145,178,.32), inset 0 1px 0 rgba(255,255,255,.15);
  flex-shrink: 0;
}
.clm-total-ico {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  background: linear-gradient(135deg, #0e7490, #0891b2);
  color: #fff; flex-shrink: 0;
  border-right: 1px solid rgba(255,255,255,.15);
}
.clm-total-lbl {
  padding: 0 12px; height: 36px;
  display: flex; align-items: center;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  font-size: 12px; font-weight: 600; color: rgba(255,255,255,.92);
  white-space: nowrap; letter-spacing: .01em;
}
.clm-total-num {
  padding: 0 14px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: #fff;
  border-left: 1.5px solid rgba(8,145,178,.25);
  font-size: 13px; font-weight: 500; color: #0891b2;
  letter-spacing: -.3px; min-width: 16px; text-align: center;
}

/* ──────────────────────────────────────────────────────────
 * TABLE
 * ────────────────────────────────────────────────────────── */
.clm-tab-body {
  background: #fff;
  display: flex; align-items: center; justify-content: center;
  min-height: 90px; overflow: hidden;
}
.clm-tab-body.has-data { display: block; }

.clm-table-wrap { overflow-x: auto; background: #fff; }
/* Fill mode: the wrap stretches to a computed min-height (set inline) so the
 * card covers the page even with few rows, and the pagination is pushed to the
 * bottom. Opt-in via the .clm-table-fill class so other pages are unaffected. */
.clm-table-fill { display: flex; flex-direction: column; }
.clm-table-fill > .clm-pag, .clm-table-fill > .wl-pager { margin-top: auto; }
/* The pager lives inside the horizontally-scrolling table wrap. Without this it
 * stretches to the table's full scroll width (e.g. 1100px), so on zoom / narrow
 * viewports the "Showing…" pill and the page arrows are pushed outside the
 * visible area and only reappear when you scroll the table sideways. Pin it to
 * the wrap's *visible* width (% resolves against client width, not scroll width)
 * and make it sticky so it stays in view while the table scrolls horizontally. */
.clm-table-wrap > .wl-pager { position: sticky; left: 0; width: 100%; box-sizing: border-box; }
.clm-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.clm-table thead th {
  padding: 8px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-bottom: 1.5px solid rgba(6,182,212,.20);
  font-size: 11px; font-weight: 500; letter-spacing: .08em;
  color: #0e7490; text-transform: uppercase;
  white-space: nowrap; text-align: left;
}
.clm-table tbody tr {
  border-bottom: 1px solid rgba(6,182,212,.07);
  transition: background .12s, box-shadow .12s;
}
.clm-table tbody tr:nth-child(even) { background: rgba(240,253,255,.5); }
.clm-table tbody tr:hover { background: rgba(6,182,212,.06); box-shadow: inset 3px 0 0 #0891b2; }
.clm-table tbody td { padding: 7px 16px; font-size: 13px; color: #0c4a6e; vertical-align: middle; }
.clm-td-num  { text-align: center; color: #94a3b8; font-weight: 700; width: 48px; }
/* Wrap long, space-less names/descriptions instead of letting the cell grow
   and stretch the whole table past its container. */
.clm-td-name { font-weight: 700; color: #0c4a6e; letter-spacing: -.15px; text-align: left; font-size: 13.5px; text-transform: capitalize; overflow-wrap: anywhere; word-break: break-word; }
.clm-td-desc { font-size: 12px; color: #475569; text-transform: capitalize; overflow-wrap: anywhere; word-break: break-word; }
.clm-td-desc::first-letter { text-transform: uppercase; }

/* Code chip */
.clm-code-pill {
  display: inline-block;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 500; letter-spacing: .05em;
  color: #0891b2;
  background: linear-gradient(135deg, rgba(8,145,178,.10), rgba(6,182,212,.06));
  padding: 4px 9px; border-radius: 7px;
  border: 1px solid rgba(6,182,212,.25);
  white-space: nowrap;
}

/* Overflow popover (opened from a +N count badge in a table cell). Positioned
   inline (fixed left/top), but colours come from here so it follows dark mode. */
.clm-pop { background: #fff; border: 1.5px solid #99f6e4; box-shadow: 0 16px 40px rgba(0,0,0,.18); }
.clm-pop-title { color: #0d9488; }
.clm-pop-row-alt { background: #f0fdfa; }
[data-bs-theme="dark"] .clm-pop { background: #0f172a; border-color: rgba(6,182,212,.35); box-shadow: 0 16px 40px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .clm-pop-title { color: #5eead4; }
[data-bs-theme="dark"] .clm-pop-row-alt { background: rgba(255,255,255,.04); }

/* Badges */
.clm-badge {
  display: inline-block;
  padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 600;
  border: 1px solid; white-space: nowrap;
  letter-spacing: .01em; line-height: 1.35;
}
/* Legacy dot kept in JSX but hidden — visual cleanup without
   touching markup. Light + dark mode both pick this up. */
.clm-badge-dot { display: none; }
.clm-badge-teal    { background: rgba(8,145,178,.08); color: #0891b2; border-color: rgba(6,182,212,.22); }
.clm-badge-emerald { background: rgba(13,148,136,.07); color: #0d9488; border-color: rgba(13,148,136,.22); }
.clm-badge-red     { background: rgba(220,38,38,.07); color: #dc2626; border-color: rgba(220,38,38,.22); }
.clm-badge-amber   { background: rgba(245,158,11,.08); color: #d97706; border-color: rgba(245,158,11,.22); }
.clm-badge-green   { background: rgba(22,163,74,.08); color: #16a34a; border-color: rgba(22,163,74,.22); }
.clm-badge-orange  { background: rgba(234,88,12,.08); color: #ea580c; border-color: rgba(234,88,12,.22); }
.clm-badge-violet  { background: rgba(124,58,237,.07); color: #7c3aed; border-color: rgba(124,58,237,.22); }
.clm-badge-indigo  { background: rgba(79,70,229,.07); color: #4338ca; border-color: rgba(79,70,229,.22); }
.clm-badge-pink    { background: rgba(190,24,93,.06); color: #be185d; border-color: rgba(190,24,93,.22); }
.clm-badge-slate   { background: rgba(100,116,139,.07); color: #475569; border-color: rgba(100,116,139,.22); }

/* Actions */
.clm-actions { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.clm-act {
  width: 30px; height: 30px; border-radius: 7px; cursor: pointer;
  border: 1px solid; background: transparent; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease, box-shadow .22s ease;
}
.clm-act:hover { transform: translateY(-1px); }
.clm-act-edit { color: #0891b2; border-color: rgba(6,182,212,.25); background: rgba(240,253,255,.8); }
.clm-act-edit:hover { background: #cffafe; border-color: #0891b2; box-shadow: 0 4px 12px rgba(8,145,178,.25); }
.clm-act-del  { color: #ef4444; border-color: rgba(239,68,68,.22); background: rgba(255,245,245,.8); }
.clm-act-del:hover  { background: #fee2e2; border-color: #ef4444; box-shadow: 0 4px 12px rgba(239,68,68,.22); }
.clm-act-view { color: #6366f1; border-color: rgba(99,102,241,.22); background: rgba(238,242,255,.8); }
.clm-act-view:hover { background: #e0e7ff; border-color: #6366f1; box-shadow: 0 4px 12px rgba(99,102,241,.22); }
.clm-act-dl   { color: #16a34a; border-color: rgba(34,197,94,.25); background: rgba(240,253,244,.8); }
.clm-act-dl:hover   { background: #dcfce7; border-color: #16a34a; box-shadow: 0 4px 12px rgba(22,163,74,.22); }
[data-bs-theme="dark"] .clm-act-dl { background: rgba(34,197,94,.12); border-color: rgba(34,197,94,.32); }
[data-bs-theme="dark"] .clm-act-dl:hover { background: rgba(34,197,94,.24); }

/* Empty / loading */
.clm-status { text-align: center; padding: 24px 12px; color: #94a3b8; font-style: italic; font-size: 12.5px; }

/* Shimmer skeleton — shown while the table (re)loads, e.g. right after a
   T&C is saved and the list is being refetched. A grey bar with a moving
   light sweep reads as "loading" far better than the old static "Loading…"
   text. Each cell can drop a <span class="clm-skel"> sized to its column. */
.clm-skel {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef2f6 0%, #f6f9fb 40%, #eef2f6 80%);
  background-size: 200% 100%;
  animation: clmShimmer 1.2s ease-in-out infinite;
}
.clm-skel-pill { height: 20px; border-radius: 999px; }
.clm-skel-cell { padding: 13px 14px !important; }
/* Full-page master shimmer — while <ShimmerClmMaster> is mounted (only during
   load), hide every other direct child of .clm-root so the skeleton replaces
   the whole page instead of stacking on top of the real content. */
.clm-root:has(> .clm-fullpage-shimmer) > *:not(.clm-fullpage-shimmer):not(style) { display: none !important; }
@keyframes clmShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
[data-bs-theme="dark"] .clm-skel {
  background: linear-gradient(90deg, #1e293b 0%, #28384d 40%, #1e293b 80%);
  background-size: 200% 100%;
}
.clm-empty {
  text-align: center; padding: 28px 16px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; width: 100%;
}
.clm-empty-ico {
  width: 42px; height: 42px; border-radius: 12px;
  background: linear-gradient(135deg, #e0f9ff, #b3f0fb);
  display: flex; align-items: center; justify-content: center;
  color: #0891b2;
}
.clm-empty-title { font-size: 13px; font-weight: 700; color: #0c4a6e; }
.clm-empty-sub   { font-size: 11px; color: #94A3B8; }

/* Pagination — clean flat row. Plain "Showing X of Y" on left,
   numbered chips on right with teal gradient on the active chip. */
/* Footer pagination — mirrors the Customers/Sales-page footer shape:
 * tinted pastel strip, "Showing N of M Results" on the left, circular
 * page buttons on the right with a filled accent for the active page. */
.clm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 16px;
  border-top: 1.5px solid #cffafe;
  background: linear-gradient(180deg, #f0fdff, #ecfeff);
  flex-shrink: 0; flex-wrap: wrap; gap: 10px;
}
.clm-pag-info {
  font-size: 11.5px; font-weight: 600; color: #0891b2;
  background: #fff; border: 1.5px solid #a5f3fc;
  padding: 3px 12px; border-radius: 20px;
}
.clm-pag-info b { color: #0c4a6e; font-weight: 700; }
.clm-pag-btns { display: inline-flex; align-items: center; gap: 6px; }
.clm-pag-btn {
  width: 28px; height: 28px; padding: 0;
  border-radius: 50%;
  border: 1.5px solid #a5f3fc;
  background: #fff;
  color: #0891b2;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .22s ease;
  display: inline-flex; align-items: center; justify-content: center;
}
.clm-pag-btn:hover:not(:disabled):not(.on) {
  background: #cffafe;
  border-color: #67e8f9;
  color: #0c4a6e;
}
.clm-pag-btn:disabled { opacity: 0.40; cursor: not-allowed; }
.clm-pag-btn.on {
  background: linear-gradient(135deg, #06b6d4, #0891b2 60%, #0e7490);
  border-color: transparent; color: #fff;
  box-shadow: 0 3px 10px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18);
  cursor: default;
}

/* ──────────────────────────────────────────────────────────
 * MODAL — gradient teal head, body with cyan gradient bg.
 * ────────────────────────────────────────────────────────── */
.clm-modal-bd {
  position: fixed; inset: 0; z-index: 200000;
  background: rgba(7,30,50,.6); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; animation: clmFadeIn .18s ease both;
  /* While the modal is open, useSelectionLock sets user-select:none on <body>
     to stop Ctrl+A / drag-select from grabbing the background. Re-enable it
     here so the modal's own content stays selectable/copyable. */
  -webkit-user-select: text; user-select: text;
}
/* Full-page drafting mode portals the editor shell OUT to <body> (a sibling of
   .clm-modal-bd), so it doesn't inherit the re-enable above — restore selection
   on the editor shells explicitly so the TipTap content stays selectable. */
.agw-editor-shell, .tdw-editor-shell, .tnw-editor-shell {
  -webkit-user-select: text; user-select: text;
}
/* MasterSelect portals its dropdown menu to <body> at z-index 11000.
   CLM modal backdrop is at 200000 — without this override, the
   portalled menu sits behind the modal and the user sees an empty
   dropdown. Bumping all portalled dropdowns above the CLM modal so
   they remain visible inside the Add/Edit forms. */
body > .dropdown-menu.master-select-menu,
.master-select-menu.dropdown-menu { z-index: 250000 !important; }
@keyframes clmFadeIn { from { opacity: 0 } to { opacity: 1 } }
.clm-modal {
  width: 100%; max-width: 620px; max-height: calc(100vh - 40px);
  border-radius: 18px; overflow: hidden;
  display: flex; flex-direction: column;
  background: #fff;
  margin: auto;
  box-shadow:
    0 28px 70px rgba(15,23,42,.45),
    0 12px 32px rgba(6,182,212,.22),
    0 0 0 1px rgba(255,255,255,.06);
  border: 1px solid rgba(6,182,212,.25);
  animation: clmSlideUp .24s cubic-bezier(.22,1,.36,1) both;
}
.clm-modal-wide { max-width: 820px; }
@keyframes clmSlideUp { from { opacity: 0; transform: translateY(24px) scale(.96) } to { opacity: 1; transform: none } }

.clm-modal-head {
  position: relative; overflow: hidden;
  background: linear-gradient(110deg, #0891b2 0%, #0e7490 45%, #0c6680 100%);
  padding: 14px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  flex-shrink: 0;
}
.clm-modal-head::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 55%;
  background: linear-gradient(180deg, rgba(255,255,255,.16), transparent);
  pointer-events: none;
}
.clm-modal-head::after {
  content: ''; position: absolute; bottom: -30px; right: -30px;
  width: 120px; height: 120px; border-radius: 50%;
  background: rgba(255,255,255,.05); pointer-events: none;
}
.clm-modal-head-left { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; min-width: 0; }
.clm-modal-head-ico {
  width: 46px; height: 46px; border-radius: 13px; flex-shrink: 0;
  background: rgba(255,255,255,.15);
  border: 1.5px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.15), inset 0 1px 0 rgba(255,255,255,.2);
}
.clm-modal-head-title { font-size: 16px; font-weight: 500; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.clm-modal-head-sub   { font-size: 10.5px; color: rgba(255,255,255,.7); margin-top: 4px; font-weight: 500; line-height: 1.4; }
.clm-modal-close {
  position: relative; z-index: 1; flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 9px;
  background: rgba(255,255,255,.12);
  border: 1.5px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.9);
  cursor: pointer;
  font-size: 16px; font-weight: 300;
  font-family: inherit; line-height: 1;
  transition: background .15s, border-color .15s, color .15s, transform .15s;
}
/* Hover — turn red with a subtle lift so the close affordance reads as
 * the destructive action it is. Cursor is already pointer above; we
 * re-assert it here for forms where a wrapper element resets it. */
.clm-modal-close:hover,
.clm-modal-close:focus-visible {
  background: rgba(239,68,68,.92);
  border-color: #ef4444;
  color: #fff;
  cursor: pointer;
  transform: translateY(-1px);
}
.clm-modal-close:active { transform: translateY(0); background: #dc2626; }

.clm-modal-body {
  background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%);
  padding: 10px 16px 8px;
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto;
}

/* MasterSelect / native select trigger inside a CLM modal must read
 * solid white — the modal body has a light cyan gradient which would
 * otherwise tint Velzon's --vz-card-bg variable on certain themes. */
.clm-modal-body .master-select-toggle,
.clm-modal-body .clm-select,
.clm-modal-body .clm-input,
.clm-modal-body .clm-textarea { background-color: #fff; }
.clm-modal-body .master-select-toggle {
  height: 34px;
  border-radius: 9px;
  border-color: rgba(6,182,212,.25);
  font-size: 12.5px;
}
.clm-modal-body .master-select-wrap.show .master-select-toggle {
  border-color: #0891b2 !important;
  box-shadow: 0 0 0 3px rgba(8,145,178,.14) !important;
}
.clm-modal-body .master-select-wrap.show .master-select-chev { color: #0891b2; }
[data-bs-theme="dark"] .clm-modal-body .master-select-toggle,
[data-bs-theme="dark"] .clm-modal-body .clm-select,
[data-bs-theme="dark"] .clm-modal-body .clm-input,
[data-bs-theme="dark"] .clm-modal-body .clm-textarea { background-color: #1e293b; }

/* Auto code strip — same logic: parent body gap handles spacing below */
.clm-autocode {
  display: flex; align-items: center; gap: 8px;
  background: linear-gradient(110deg, #e0f9fd, #caf5fa);
  border: 1.5px solid rgba(6,182,212,.25);
  border-radius: 10px;
  padding: 6px 12px;
  margin-bottom: 0;
}
.clm-autocode-ico {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(8,145,178,.28);
}
.clm-autocode-text { flex: 1; min-width: 0; }
.clm-autocode-label { font-size: 8px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: #0891b2; opacity: .7; margin-bottom: 2px; }
.clm-autocode-val {
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px; font-weight: 500; color: #0c4a6e;
  letter-spacing: .06em; line-height: 1;
}
.clm-autocode-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 20px;
  background: rgba(6,182,212,.12);
  border: 1px solid rgba(6,182,212,.22);
  font-size: 9px; font-weight: 700; color: #0891b2;
  letter-spacing: .06em; text-transform: uppercase;
}
.clm-autocode-badge.edit { background: rgba(245,158,11,.10); border-color: rgba(245,158,11,.22); color: #d97706; }
.clm-autocode-dot { width: 5px; height: 5px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 4px rgba(34,197,94,.5); }
.clm-autocode-badge.edit .clm-autocode-dot { background: #f59e0b; box-shadow: 0 0 4px rgba(245,158,11,.5); }
/* Hairline divider under the auto-code strip (matches Figma seg-modal-divider).
 * Inter-field spacing comes from .clm-modal-body's flex gap, so no margin here. */
.clm-modal-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(6,182,212,.2), transparent); }

/* Form field — relies on .clm-modal-body's flex gap for inter-field
 * spacing (no margin-bottom) so we don't stack double space between rows. */
.clm-field { display: flex; flex-direction: column; gap: 1px; margin-bottom: 0; }
.clm-field-label {
  font-size: 8.5px; font-weight: 500; letter-spacing: .13em; text-transform: uppercase;
  color: #0e7490; display: flex; align-items: center; gap: 5px;
}
.clm-req { color: #EF4444; font-size: 13px; line-height: 1; font-weight: 700; }
.clm-input, .clm-textarea, .clm-select {
  width: 100%; padding: 7px 12px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  background: #fff; font-family: inherit;
  font-size: 12.5px; color: #0c4a6e;
  transition: border-color .15s, box-shadow .15s; outline: none;
  box-shadow: 0 1px 4px rgba(6,182,212,.08), inset 0 1px 0 rgba(255,255,255,.9);
  box-sizing: border-box;
}
.clm-textarea { resize: vertical; line-height: 1.45; min-height: 50px; }
.clm-input:focus, .clm-textarea:focus, .clm-select:focus {
  border-color: #0891b2; box-shadow: 0 0 0 3.5px rgba(8,145,178,.14), inset 0 1px 0 rgba(255,255,255,.9);
}
.clm-input::placeholder, .clm-textarea::placeholder { color: #94A3B8; }
.clm-select {
  appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230891b2' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 13px center;
  padding-right: 36px;
}
.clm-input-err { border-color: #ef4444 !important; }
.clm-err { font-size: 10.5px; color: #ef4444; }
.clm-field-hint { font-size: 10px; color: #0891b2; opacity: .7; margin-top: 3px; }

/* Inline + button (next to selects) */
.clm-inline-add {
  width: 36px; height: 36px; border-radius: 9px; flex-shrink: 0;
  border: none;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-size: 20px; font-weight: 300;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(8,145,178,.35);
  transition: transform .15s;
}
.clm-inline-add:hover { transform: scale(1.08); }

/* Modal footer */
.clm-modal-foot {
  background: #fff;
  border-top: 1px solid rgba(6,182,212,.15);
  padding: 10px 18px;
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  flex-shrink: 0;
}
.clm-btn-cancel {
  padding: 7px 18px; border-radius: 9px;
  /* Border lifted from #d1d5db to a stronger slate + a subtle shadow — the
     old border was too faint to identify against the white modal surface in
     light mode (QA report). Matches the .apm-btn-ghost / .avm-btn-ghost
     cancel-button treatment in the product & vendor modals. */
  border: 1.5px solid #94a3b8;
  background: #fff; font-family: inherit;
  font-size: 12px; font-weight: 700; color: #334155;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15,23,42,.06);
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease, box-shadow .22s ease;
}
.clm-btn-cancel:hover:not(:disabled) {
  border-color: #0891b2;
  color: #0891b2;
  background: #f0fdff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8,145,178,.18);
}
.clm-btn-save {
  position: relative; overflow: hidden;
  padding: 7px 20px; border-radius: 9px;
  border: none; cursor: pointer; font-family: inherit;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  font-size: 12px; font-weight: 700; color: #fff;
  box-shadow: 0 4px 14px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18);
  display: inline-flex; align-items: center; gap: 7px;
  transition: transform .18s ease, box-shadow .22s ease;
}
.clm-btn-save::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.14), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-btn-save:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.22);
}
.clm-btn-cancel:disabled { opacity: .55; cursor: not-allowed; transform: none; box-shadow: none; }
/* Save button is only ever disabled while a submit is in flight, so keep it
   near-full opacity (not dimmed like Cancel) so the spinner + "Saving…" read
   as an active operation, with a progress cursor. */
.clm-btn-save:disabled { opacity: .9; cursor: progress; transform: none; box-shadow: none; }
/* Inline loader on the Save / Update button while a submit is in flight.
   Every CLM Add/Edit modal disables its save button only while saving
   (disabled={saving}) and swaps the label to "Saving…", so keying the spinner
   off :disabled lights it up in exactly that window — no per-modal JSX change
   needed. Hide the static save-disk glyph and drop a spinning ring in its
   place (order:-1 puts it before the label in the inline-flex row). */
.clm-btn-save:disabled > svg { display: none; }
.clm-btn-save:disabled::after {
  content: ''; order: -1; flex-shrink: 0;
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: clmSpin .6s linear infinite;
}

/* ──────────────────────────────────────────────────────────
 * 2-STAGE STEPPER MODAL — used by T&C Library "Add T&C".
 * Header carries an eyebrow + ID badge; body has a stepper bar
 * with active/done/idle cards and a 2-bar progress indicator.
 * ────────────────────────────────────────────────────────── */
.clm-modal-xwide { max-width: 960px; }
.clm-modal-head-eyebrow { font-size: 8.5px; font-weight: 700; color: rgba(255,255,255,.6); letter-spacing: .12em; text-transform: uppercase; margin-bottom: 3px; }
.clm-modal-head-right { display: flex; align-items: center; gap: 8px; position: relative; z-index: 1; flex-shrink: 0; }
.clm-modal-id-badge { background: rgba(255,255,255,.13); border: 1.5px solid rgba(255,255,255,.22); border-radius: 10px; padding: 6px 14px; text-align: center; min-width: 110px; }
.clm-modal-id-label { font-size: 8.5px; font-weight: 700; color: rgba(255,255,255,.55); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 2px; }
.clm-modal-id-val { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: .04em; font-family: 'Geist Mono', monospace; line-height: 1.2; }

/* Stepper bar — sits between modal head and body */
.clm-stepper { background: #fff; padding: 14px 24px; border-bottom: 1.5px solid rgba(6,182,212,.1); flex-shrink: 0; display: flex; align-items: center; gap: 0; flex-wrap: wrap; }
.clm-step-card { display: flex; align-items: center; gap: 11px; padding: 10px 18px; border-radius: 12px; cursor: pointer; transition: all .2s; flex-shrink: 0; border: 1.5px solid transparent; position: relative; overflow: hidden; }
.clm-step-card.active { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 16px rgba(8,145,178,.32), inset 0 1px 0 rgba(255,255,255,.18); }
.clm-step-card.active::before { content: ''; position: absolute; inset: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.14), transparent); pointer-events: none; border-radius: 12px 12px 0 0; }
.clm-step-card.done { background: rgba(236,253,245,.9); border-color: rgba(34,197,94,.28); box-shadow: 0 2px 10px rgba(34,197,94,.12); }
.clm-step-card.idle { background: rgba(241,245,249,.7); border-color: rgba(203,213,225,.5); }
.clm-step-num { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500; flex-shrink: 0; position: relative; z-index: 1; }
.clm-step-card.active .clm-step-num { background: rgba(255,255,255,.2); border: 1.5px solid rgba(255,255,255,.35); color: #fff; }
.clm-step-card.done .clm-step-num { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border: 1.5px solid rgba(34,197,94,.5); box-shadow: 0 2px 6px rgba(34,197,94,.28); }
.clm-step-card.idle .clm-step-num { background: #e2e8f0; border: 1.5px solid #cbd5e1; color: #94a3b8; }
.clm-step-text { position: relative; z-index: 1; }
.clm-step-title { font-size: 12px; line-height: 1.2; }
.clm-step-sub { font-size: 9.5px; font-weight: 500; margin-top: 2px; }
.clm-step-card.active .clm-step-title { color: #fff; font-weight: 500; }
.clm-step-card.active .clm-step-sub { color: rgba(255,255,255,.72); }
.clm-step-card.done .clm-step-title { color: #15803d; font-weight: 700; }
.clm-step-card.done .clm-step-sub { color: rgba(21,128,61,.65); }
.clm-step-card.idle .clm-step-title { color: #94a3b8; font-weight: 700; }
.clm-step-card.idle .clm-step-sub { color: #b0bec5; }
.clm-step-conn { display: flex; align-items: center; gap: 3px; padding: 0 10px; flex-shrink: 0; }
.clm-step-conn-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(8,145,178,.18); }
.clm-step-conn-dot.filled { background: rgba(8,145,178,.4); }
.clm-step-conn-line { width: 28px; height: 2px; border-radius: 2px; background: rgba(6,182,212,.12); }
.clm-step-conn-line.filled { background: linear-gradient(90deg, rgba(8,145,178,.5), rgba(6,182,212,.2)); }
.clm-step-conn-dot-sm { width: 4px; height: 4px; border-radius: 50%; background: rgba(8,145,178,.1); }
.clm-step-progress { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.clm-step-progress-bars { display: flex; gap: 5px; }
.clm-step-progress-bar { width: 32px; height: 4px; border-radius: 4px; background: #e2e8f0; transition: all .3s; }
.clm-step-progress-bar.filled { background: linear-gradient(90deg, #0891b2, #22d3ee); box-shadow: 0 2px 6px rgba(8,145,178,.35); }
.clm-step-progress-label { font-size: 10px; font-weight: 700; color: #0891b2; background: rgba(8,145,178,.08); border: 1px solid rgba(8,145,178,.18); border-radius: 20px; padding: 3px 10px; }

/* Applies To section — checkbox chips grouped by row */
.clm-applies-card { padding: 12px 14px; background: rgba(255,255,255,.7); border: 1.5px solid rgba(6,182,212,.15); border-radius: 12px; }
.clm-applies-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
.clm-applies-head-label { font-size: 10.5px; font-weight: 500; color: #0891b2; letter-spacing: .06em; text-transform: uppercase; }
.clm-applies-all { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #0891b2; cursor: pointer; user-select: none; }
.clm-applies-all input { accent-color: #0891b2; width: 13px; height: 13px; }
.clm-applies-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.clm-applies-row:last-child { margin-bottom: 0; }
.clm-applies-row-label { font-size: 9px; font-weight: 500; color: #94a3b8; letter-spacing: .09em; text-transform: uppercase; min-width: 130px; }
.clm-party-chip { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 9px; border: 1.5px solid rgba(6,182,212,.2); background: #fff; font-size: 11.5px; font-weight: 600; color: #0c4a6e; cursor: pointer; transition: all .14s; box-shadow: 0 1px 3px rgba(6,182,212,.06); user-select: none; }
.clm-party-chip:hover { border-color: #0891b2; background: rgba(240,253,255,.9); }
.clm-party-chip.on { border-color: #0891b2; background: rgba(8,145,178,.08); box-shadow: 0 2px 8px rgba(8,145,178,.12); }
.clm-party-chip input { accent-color: #0891b2; width: 13px; height: 13px; flex-shrink: 0; }
.clm-party-chip-emoji { font-size: 14px; line-height: 1; }
.clm-applies-hint { font-size: 9.5px; color: #64748b; margin-top: 7px; opacity: .8; }

/* Segment Regulatory Status strip — radio cards picked BEFORE
 * the Segment dropdown. High requires a specific segment; Less
 * implicitly defaults to General and the segment dropdown is hidden. */
.clm-reg-card {
  padding: 12px 14px;
  background: rgba(255,255,255,.7);
  border: 1.5px solid rgba(6,182,212,.15);
  border-radius: 12px;
}
.clm-reg-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
.clm-reg-head-label { font-size: 10.5px; font-weight: 500; color: #0891b2; letter-spacing: .06em; text-transform: uppercase; }
.clm-reg-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.clm-reg-option {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 14px; border-radius: 10px;
  border: 1.5px solid rgba(203,213,225,.5);
  background: #fff;
  cursor: pointer;
  transition: all .15s;
  user-select: none;
}
.clm-reg-option:hover { background: rgba(248,250,252,.95); }
.clm-reg-option input[type="radio"] { accent-color: #0891b2; flex-shrink: 0; margin-top: 2px; width: 14px; height: 14px; }
.clm-reg-option-body { flex: 1; }
.clm-reg-option-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; color: #0c4a6e; line-height: 1.2; }
.clm-reg-option-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
.clm-reg-option-desc { font-size: 10.5px; color: #64748b; margin-top: 4px; line-height: 1.4; }
/* High = red tint */
.clm-reg-option.high { border-color: rgba(239,68,68,.25); background: rgba(254,242,242,.4); }
.clm-reg-option.high.on { border-color: rgba(239,68,68,.55); background: rgba(254,242,242,.85); box-shadow: 0 2px 10px rgba(239,68,68,.12); }
.clm-reg-option.high .clm-reg-option-dot { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,.4); }
.clm-reg-option.high.on .clm-reg-option-title { color: #991b1b; }
/* Less = green tint */
.clm-reg-option.less { border-color: rgba(34,197,94,.25); background: rgba(240,253,244,.4); }
.clm-reg-option.less.on { border-color: rgba(34,197,94,.55); background: rgba(240,253,244,.85); box-shadow: 0 2px 10px rgba(34,197,94,.12); }
.clm-reg-option.less .clm-reg-option-dot { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,.4); }
.clm-reg-option.less.on .clm-reg-option-title { color: #166534; }

/* Rich text editor card (stage 2) */
.clm-editor-card { border: 1.5px solid rgba(6,182,212,.18); border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 2px 16px rgba(8,145,178,.07); }
.clm-editor-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; background: linear-gradient(110deg, #0891b2, #0e7490); position: relative; overflow: hidden; }
.clm-editor-head::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.12), transparent); pointer-events: none; }
.clm-editor-head-left { display: flex; align-items: center; gap: 8px; position: relative; z-index: 1; }
.clm-editor-head-ico { width: 24px; height: 24px; border-radius: 6px; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.clm-editor-head-label { font-size: 10.5px; font-weight: 500; color: #fff; letter-spacing: .06em; text-transform: uppercase; }
.clm-editor-head-actions { display: flex; gap: 6px; position: relative; z-index: 1; }
.clm-editor-head-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; border: 1.5px solid rgba(255,255,255,.25); background: rgba(255,255,255,.1); font-family: inherit; font-size: 10.5px; font-weight: 600; color: #fff; cursor: pointer; transition: all .15s; }
.clm-editor-head-btn:hover { background: rgba(255,255,255,.22); border-color: rgba(255,255,255,.45); }
.clm-editor-toolbar { display: flex; align-items: center; gap: 2px; padding: 5px 10px; background: linear-gradient(110deg, #f8fcff, #f0fbfd); border-bottom: 1px solid rgba(6,182,212,.1); flex-wrap: wrap; }
.clm-editor-tb-sel { height: 25px; padding: 0 5px; border: 1px solid rgba(6,182,212,.2); border-radius: 6px; font-family: inherit; font-size: 11px; color: #334155; background: #fff; outline: none; cursor: pointer; margin-right: 3px; }
.clm-editor-tb-btn { width: 26px; height: 26px; border-radius: 5px; border: none; background: transparent; color: #334155; cursor: pointer; transition: all .12s; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-family: inherit; }
.clm-editor-tb-btn:hover { background: rgba(8,145,178,.12); color: #0891b2; }
.clm-editor-tb-btn.b { font-weight: 500; font-size: 13px; }
.clm-editor-tb-btn.i { font-style: italic; font-size: 13px; }
.clm-editor-tb-btn.u { text-decoration: underline; font-size: 13px; }
.clm-editor-tb-btn.s { text-decoration: line-through; font-size: 13px; }
.clm-editor-tb-divider { width: 1px; height: 18px; background: rgba(6,182,212,.2); margin: 0 4px; flex-shrink: 0; }
.clm-editor-body {
  min-height: 220px; max-height: 360px;
  overflow-y: auto;
  padding: 14px 18px;
  background: #fff;
  font-family: inherit; font-size: 13px; color: #0c4a6e; line-height: 1.8;
  outline: none; cursor: text;
}
/* Subtle teal-tinted scrollbar so the editor's scroll affordance
 * matches the rest of the CLM module instead of the browser default. */
.clm-editor-body::-webkit-scrollbar { width: 8px; }
.clm-editor-body::-webkit-scrollbar-track { background: transparent; }
.clm-editor-body::-webkit-scrollbar-thumb { background: rgba(8,145,178,.22); border-radius: 8px; }
.clm-editor-body::-webkit-scrollbar-thumb:hover { background: rgba(8,145,178,.40); }
.clm-editor-body:empty:before { content: attr(data-placeholder); color: #94a3b8; font-style: italic; }
.clm-editor-foot { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: linear-gradient(110deg, #f8fcff, #f0fbfd); border-top: 1px solid rgba(6,182,212,.08); }
.clm-editor-foot-hint { display: flex; align-items: center; gap: 5px; font-size: 9.5px; color: #94a3b8; font-style: italic; }
.clm-editor-foot-ph { font-size: 9.5px; color: rgba(8,145,178,.45); font-weight: 700; font-family: 'Geist Mono', monospace; }

/* Back button — left-side in stage 2 footer */
.clm-btn-back { display: inline-flex; align-items: center; gap: 5px; padding: 9px 18px; border: 1.5px solid rgba(6,182,212,.25); border-radius: 10px; font-family: inherit; font-size: 12.5px; font-weight: 600; color: #0891b2; cursor: pointer; background: #fff; transition: all .15s; }
.clm-btn-back:hover { background: rgba(240,253,255,.9); border-color: #0891b2; }
.clm-modal-foot.split { justify-content: space-between; }

/* Inline field hint variant for stepper modal (smaller, blue-tinted) */
.clm-field-hint-sm { font-size: 9.5px; color: #0891b2; margin-top: 3px; opacity: .75; }

/* ──────────────────────────────────────────────────────────
 * DELETE CONFIRM — redesigned to match the CLM master palette.
 *   - cyan-tinted card border + soft cyan shadow (like other CLM modals)
 *   - 4px gradient accent stripe at top (red, signals destructive intent)
 *   - 64px icon ring with soft red gradient + inset highlight
 *   - mono-styled code pill inside the subtitle for the item code
 *   - existing red Delete button + cyan-tinted Cancel button
 * ────────────────────────────────────────────────────────── */
.clm-conf-bd {
  position: fixed; inset: 0; z-index: 210000;
  background: rgba(7,30,50,.55); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: clmFadeIn .15s ease-out;
}
.clm-conf {
  width: min(420px, 100%);
  background: #fff;
  border: 1.5px solid rgba(6,182,212,.22);
  border-radius: 16px;
  padding: 26px 24px 18px;
  text-align: center;
  box-shadow:
    0 28px 70px rgba(15,23,42,.32),
    0 12px 32px rgba(6,182,212,.16),
    0 0 0 1px rgba(255,255,255,.04);
  animation: clmSlideUp .22s cubic-bezier(.22,1,.36,1);
  position: relative; overflow: hidden;
}
/* Red gradient stripe at the very top — destructive intent signal. */
.clm-conf::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: linear-gradient(90deg, #dc2626 0%, #f87171 50%, #dc2626 100%);
}
.clm-conf-ico {
  width: 64px; height: 64px; margin: 4px auto 14px;
  background:
    radial-gradient(circle at 30% 30%, rgba(254,242,242,1) 0%, rgba(254,226,226,.85) 50%, rgba(239,68,68,.12) 100%);
  border: 1.5px solid rgba(239,68,68,.22);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 4px 14px rgba(239,68,68,.18),
    inset 0 1px 0 rgba(255,255,255,.9);
}
.clm-conf-ico svg { width: 26px; height: 26px; }
.clm-conf-title {
  font-size: 16px; font-weight: 600; color: #0c4a6e;
  margin-bottom: 8px; letter-spacing: -.2px; line-height: 1.25;
}
.clm-conf-sub {
  font-size: 12.5px; color: #475569; line-height: 1.5;
  margin-bottom: 4px;
}
/* Inline code pill inside the subtitle — auto-wrapped by JSX
 * around any parenthesised CODE pattern. Uses the same monospace
 * Geist Mono + cyan tint as the other CLM code pills for visual
 * consistency. */
.clm-conf-code {
  display: inline-flex; align-items: center;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 600; color: #0891b2;
  background: linear-gradient(135deg, rgba(8,145,178,.10), rgba(6,182,212,.06));
  border: 1px solid rgba(6,182,212,.25);
  padding: 1px 7px; border-radius: 6px;
  letter-spacing: .04em;
  margin: 0 2px;
}
.clm-conf-hint  { font-size: 10.5px; color: #94a3b8; margin-bottom: 20px; font-style: italic; }
.clm-conf-btns { display: flex; justify-content: center; gap: 10px; }
.clm-btn-del {
  padding: 9px 22px; border: none; cursor: pointer; border-radius: 10px;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
  box-shadow: 0 4px 14px rgba(239,68,68,.36), inset 0 1px 0 rgba(255,255,255,.18);
  transition: transform .18s ease, box-shadow .22s ease, filter .18s ease;
  display: inline-flex; align-items: center; gap: 6px;
  position: relative; overflow: hidden;
}
.clm-btn-del::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.14), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-btn-del:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(239,68,68,.46), inset 0 1px 0 rgba(255,255,255,.18);
}
.clm-btn-del:disabled { opacity: .65; cursor: not-allowed; transform: none; box-shadow: 0 2px 6px rgba(239,68,68,.18); }
.clm-spin { animation: clmSpin .8s linear infinite; }
@keyframes clmSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ── Dark mode ── */
[data-bs-theme="dark"] .clm-root { color: #e2e8f0; background: transparent; }
[data-bs-theme="dark"] .clm-page-card { background: #0f172a; border-color: rgba(6,182,212,.18); }
/* Dark mode: solid dark teal-tinted bg (was light gradient that
   carried a glossy feel through). The ::after overlay (50% white
   sheen for the glossy "lit from top" look) is dimmed too — the
   bright sheen was making the surface look light/bleached. */
[data-bs-theme="dark"] .clm-head-strip {
  background: #102234;
  border-color: rgba(6,182,212,.25);
}
[data-bs-theme="dark"] .clm-head-strip::after {
  background: linear-gradient(180deg, rgba(255,255,255,.04), transparent);
}
[data-bs-theme="dark"] .clm-head-strip-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-head-strip-sub   { color: #7dd3fc; }
/* Dark mode: solid dark bg instead of cyan gradient. The previous
   gradient made the panel look light/glossy against the dark page.
   Hover state also needs an override or the light-mode hover rule
   takes over (light gradient bleeds in when cursor enters). */
/* Container surface — was #fff with no dark counterpart, so it flashed white
   behind the panel when the box expanded. */
[data-bs-theme="dark"] .clm-bref { background: #0f172a; }
[data-bs-theme="dark"] .clm-bref-head {
  background: #102234;
  border-bottom-color: rgba(6,182,212,.22);
}
[data-bs-theme="dark"] .clm-bref-head:hover {
  background: #14293f;
}
/* Kill the 60% white sheen overlay too — it bled through and made
   the surface look bright white. Tiny dark gloss for material feel. */
[data-bs-theme="dark"] .clm-bref-head::after {
  background: linear-gradient(180deg, rgba(255,255,255,.04), transparent);
}
[data-bs-theme="dark"] .clm-bref-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-bref-sub   { color: #7dd3fc; }
[data-bs-theme="dark"] .clm-bref-body { background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); }
[data-bs-theme="dark"] .clm-bref-item { background: #1e293b; border-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-bref-item-title { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-tabs-wrap { background: #0f172a; }
[data-bs-theme="dark"] .clm-tabs-bar { background: #0f172a; border-bottom-color: rgba(6,182,212,.18); }
/* Restrict the dim slate color to INACTIVE tabs only — without :not(.active)
 * this rule was clobbering .clm-tab.active's white text (same specificity,
 * later in the cascade wins), leaving the active tab readable as a muddy
 * grey-blue against the teal gradient. */
[data-bs-theme="dark"] .clm-tab:not(.active) { color: #94a3b8; }
[data-bs-theme="dark"] .clm-tab.active { color: #fff; }
[data-bs-theme="dark"] .clm-tab:not(.active):hover { color: #67e8f9; }
[data-bs-theme="dark"] .clm-tab:not(.active) .clm-tab-count { background: #1e293b; color: #94a3b8; border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .clm-search { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-search input { color: #e2e8f0; }
/* Chrome/WebKit paints autofilled (and "previously-searched") inputs with a
   forced near-white background that overrides our transparent input bg — in
   dark mode that makes the whole search bar flash white (the autofill fade-in
   reads as a shimmer). The 1000px inset box-shadow trick is the only way to
   repaint that internal surface; -webkit-text-fill-color keeps the typed text
   light. Covers hover/focus/active so it doesn't revert white on interaction. */
[data-bs-theme="dark"] .clm-search input:-webkit-autofill,
[data-bs-theme="dark"] .clm-search input:-webkit-autofill:hover,
[data-bs-theme="dark"] .clm-search input:-webkit-autofill:focus,
[data-bs-theme="dark"] .clm-search input:-webkit-autofill:active {
  -webkit-text-fill-color: #e2e8f0;
  caret-color: #e2e8f0;
  -webkit-box-shadow: 0 0 0 1000px #1e293b inset !important;
  box-shadow: 0 0 0 1000px #1e293b inset !important;
  transition: background-color 9999s ease-in-out 0s;
}
[data-bs-theme="dark"] .clm-total-num { background: #1e293b; color: #67e8f9; }
[data-bs-theme="dark"] .clm-table-wrap { background: #0f172a; }
[data-bs-theme="dark"] .clm-table thead th {
  background: rgba(8,145,178,.18);
  color: #cffafe;
  border-bottom-color: rgba(6,182,212,.30);
}
[data-bs-theme="dark"] .clm-table tbody tr { border-bottom-color: rgba(6,182,212,.10); }
[data-bs-theme="dark"] .clm-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .clm-table tbody tr:hover { background: rgba(8,145,178,.16); }
[data-bs-theme="dark"] .clm-table tbody td { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-td-name { color: #f1f5f9; }

/* DCP — Segment Rule modal document tables (KYC / Due Diligence /
 * Trade Licenses / Trade Documents / Quality & Compliance). The doc
 * card and per-row containers were inline-styled with a hard-coded
 * white background, so dark mode left them as bright white islands
 * on a near-black surface — document names + authority lines became
 * unreadable. Light mode keeps the original white; dark mode swaps
 * to a slate panel with light text. */
.dcp-doc-card { background: #fff; }
.dcp-doc-row  { background: #fff; }
[data-bs-theme="dark"] .dcp-doc-card { background: #0f172a; }
[data-bs-theme="dark"] .dcp-doc-row {
  background: #0f172a;
  border-bottom-color: rgba(6,182,212,.18) !important;
}
[data-bs-theme="dark"] .dcp-doc-row:hover { background: rgba(8,145,178,.16); }
/* Inline-styled text colors (dark navy document name, slate-grey
 * authority) get overridden to dark-mode-friendly tones — :where()
 * keeps specificity low so any explicit style on the same element
 * still wins. */
[data-bs-theme="dark"] .dcp-doc-row :where(div, span) { color: #e2e8f0; }
[data-bs-theme="dark"] .dcp-doc-row > div > div:first-child { color: #f1f5f9; }
[data-bs-theme="dark"] .dcp-doc-row > div > div:last-child  { color: #94a3b8; }
[data-bs-theme="dark"] .clm-pag {
  background: linear-gradient(180deg, rgba(8,145,178,.10), rgba(8,145,178,.06));
  border-top-color: rgba(6,182,212,.25);
}
[data-bs-theme="dark"] .clm-pag-info {
  background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(6,182,212,.35);
}
[data-bs-theme="dark"] .clm-pag-info b { color: #cffafe; }
[data-bs-theme="dark"] .clm-pag-btn {
  background: rgba(8,145,178,.10);
  color: #67e8f9;
  border-color: rgba(6,182,212,.30);
}
[data-bs-theme="dark"] .clm-pag-btn:hover:not(:disabled):not(.on) {
  background: rgba(8,145,178,.14);
  color: #67e8f9;
  border-color: rgba(103,232,249,.40);
}
[data-bs-theme="dark"] .clm-pag-btn.on {
  background: linear-gradient(135deg, #06b6d4, #0891b2 60%, #0e7490);
  color: #fff; border-color: transparent;
}
[data-bs-theme="dark"] .clm-modal { background: #0f172a; }
[data-bs-theme="dark"] .clm-modal-body { background: linear-gradient(160deg, rgba(8,145,178,.10), rgba(8,145,178,.05) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .clm-modal-foot { background: #1e293b; border-top-color: rgba(6,182,212,.18); }
/* Use background-color (not shorthand) so we don't reset the
   chevron background-image + no-repeat set in the base rule.
   Bug: shorthand "background: #1e293b" was clearing background-repeat
   to default (repeat), causing the chevron icon to tile across the
   whole width and produce a "v v v v v" pattern in dark mode. */
[data-bs-theme="dark"] .clm-input,
[data-bs-theme="dark"] .clm-textarea,
[data-bs-theme="dark"] .clm-select { background-color: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .clm-btn-cancel { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .clm-btn-cancel:hover:not(:disabled) { background: rgba(8,145,178,.16); border-color: #0891b2; color: #67e8f9; box-shadow: 0 4px 12px rgba(8,145,178,.28); }

/* Rich-text clause editor — dark mode. The card/toolbar/body default to
 * white surfaces; swap to dark slate so the editor matches the modal. */
[data-bs-theme="dark"] .clm-editor-card { background: #0f172a; border-color: rgba(6,182,212,.28); box-shadow: 0 2px 16px rgba(0,0,0,.3); }
[data-bs-theme="dark"] .clm-editor-toolbar { background: #111c2e; border-bottom-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-editor-tb-sel { background: #1e293b; border-color: rgba(6,182,212,.3); color: #e2e8f0; }
[data-bs-theme="dark"] .clm-editor-tb-btn { color: #cbd5e1; }
[data-bs-theme="dark"] .clm-editor-tb-btn:hover { background: rgba(8,145,178,.22); color: #67e8f9; }
[data-bs-theme="dark"] .clm-editor-tb-divider { background: rgba(6,182,212,.28); }
[data-bs-theme="dark"] .clm-editor-body { background: #0b1220; color: #e2e8f0; }
[data-bs-theme="dark"] .clm-editor-body:empty:before { color: #64748b; }
[data-bs-theme="dark"] .clm-editor-foot { background: #111c2e; border-top-color: rgba(6,182,212,.14); }
[data-bs-theme="dark"] .clm-editor-foot-hint { color: #64748b; }
[data-bs-theme="dark"] .clm-editor-foot-ph { color: rgba(103,232,249,.5); }
[data-bs-theme="dark"] .clm-autocode { background: linear-gradient(110deg, rgba(8,145,178,.18), rgba(6,182,212,.08)); border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-autocode-val { color: #67e8f9; }
[data-bs-theme="dark"] .clm-conf { background: #0f172a; }
[data-bs-theme="dark"] .clm-conf-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-conf-sub { color: #94a3b8; }
[data-bs-theme="dark"] .clm-pill-group { background: rgba(15,23,42,.55); border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .clm-pill { color: #67e8f9; }
[data-bs-theme="dark"] .clm-pill-ico { background: rgba(8,145,178,.18); border-color: rgba(8,145,178,.32); color: #67e8f9; }
[data-bs-theme="dark"] .clm-pill.active .clm-pill-ico { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.25); color: #fff; }
[data-bs-theme="dark"] .clm-code-pill { color: #67e8f9; background: linear-gradient(135deg, rgba(8,145,178,.20), rgba(6,182,212,.10)); border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .clm-empty-ico { background: linear-gradient(135deg, rgba(8,145,178,.20), rgba(8,145,178,.10)); color: #67e8f9; }
[data-bs-theme="dark"] .clm-empty-title { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-empty-sub   { color: #64748b; }
[data-bs-theme="dark"] .clm-bref-label    { color: #67e8f9; }
/* Step description + "STEP 01" label brightened in dark mode —
   previous #94a3b8 was the same as light mode and read as
   barely-visible gray against the dark navy background. */
[data-bs-theme="dark"] .clm-bref-item-desc { color: #cbd5e1; }
[data-bs-theme="dark"] .clm-bref-item-num  { color: #67e8f9; }
[data-bs-theme="dark"] .clm-bref-item-title { color: #f1f5f9; }
[data-bs-theme="dark"] .clm-bref-item-ico  { color: #67e8f9; }
[data-bs-theme="dark"] .clm-bref-sub      { color: #cffafe; }
[data-bs-theme="dark"] .clm-bref-toggle { background: rgba(15,23,42,.65); border-color: rgba(8,145,178,.32); color: #67e8f9; box-shadow: 0 1px 4px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.06); }
[data-bs-theme="dark"] .clm-bref-head:hover .clm-bref-toggle { background: rgba(8,145,178,.22); border-color: rgba(8,145,178,.55); box-shadow: 0 2px 8px rgba(6,182,212,.25), inset 0 1px 0 rgba(255,255,255,.08); }
[data-bs-theme="dark"] .clm-status { color: #64748b; }
[data-bs-theme="dark"] .clm-field-label { color: #67e8f9; }
[data-bs-theme="dark"] .clm-field-hint  { color: #7dd3fc; }
[data-bs-theme="dark"] .clm-autocode-label { color: #67e8f9; }
[data-bs-theme="dark"] .clm-modal-divider { background: linear-gradient(90deg, transparent, rgba(6,182,212,.32), transparent); }
[data-bs-theme="dark"] .clm-autocode-badge { background: rgba(8,145,178,.20); border-color: rgba(8,145,178,.32); color: #67e8f9; }
[data-bs-theme="dark"] .clm-tab-body  { background: #0f172a; }
[data-bs-theme="dark"] .clm-modal-bd  { background: rgba(2,8,23,.78); }
[data-bs-theme="dark"] .clm-conf-bd   { background: rgba(2,8,23,.78); }
[data-bs-theme="dark"] .clm-badge-slate { background: rgba(100,116,139,.16); color: #cbd5e1; border-color: rgba(148,163,184,.32); }
[data-bs-theme="dark"] .clm-badge-teal,
[data-bs-theme="dark"] .clm-badge-emerald,
[data-bs-theme="dark"] .clm-badge-red,
[data-bs-theme="dark"] .clm-badge-amber,
[data-bs-theme="dark"] .clm-badge-green,
[data-bs-theme="dark"] .clm-badge-orange,
[data-bs-theme="dark"] .clm-badge-violet,
[data-bs-theme="dark"] .clm-badge-indigo,
[data-bs-theme="dark"] .clm-badge-pink { filter: brightness(1.15); }
[data-bs-theme="dark"] .clm-act-edit { background: rgba(8,145,178,.14); border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .clm-act-edit:hover { background: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .clm-act-del { background: rgba(239,68,68,.10); border-color: rgba(239,68,68,.32); }
[data-bs-theme="dark"] .clm-act-del:hover  { background: rgba(239,68,68,.22); }
[data-bs-theme="dark"] .clm-select { background-image: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2367e8f9' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); }

/* DCP — Add/Edit Segment Rule modal (Stage 1 stepper + cards, Stage 2 cat tabs).
 * These sections use hard-coded white / light-cyan backgrounds inline, so dark
 * mode left them as bright white islands inside the dark modal body. We use
 * !important so the stylesheet rules win over the inline styles. */
[data-bs-theme="dark"] .dcp-stage-strip {
  background: #0f172a !important;
  border-bottom-color: rgba(6,182,212,.22) !important;
}
[data-bs-theme="dark"] .dcp-step-badge {
  background: rgba(8,145,178,.18) !important;
  border-color: rgba(8,145,178,.35) !important;
  color: #67e8f9 !important;
}
[data-bs-theme="dark"] .dcp-stage-tile-pending  { background: rgba(30,41,59,.6) !important; }
[data-bs-theme="dark"] .dcp-stage-tile-done {
  background: rgba(34,197,94,.10) !important;
  border-color: rgba(34,197,94,.32) !important;
}
[data-bs-theme="dark"] .dcp-stage-tile-num-pending { background: #334155 !important; color: #94a3b8 !important; }
[data-bs-theme="dark"] .dcp-stage-tile-pending .dcp-stage-tile-title { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .dcp-stage-tile-pending .dcp-stage-tile-sub   { color: #94a3b8 !important; }
[data-bs-theme="dark"] .dcp-stage-tile-done    .dcp-stage-tile-title { color: #4ade80 !important; }
[data-bs-theme="dark"] .dcp-stage-tile-done    .dcp-stage-tile-sub   { color: #22c55e !important; }

[data-bs-theme="dark"] .dcp-modal-card {
  background: #0f172a !important;
  border-color: rgba(6,182,212,.25) !important;
}
[data-bs-theme="dark"] .dcp-modal-card-head {
  background: linear-gradient(110deg, rgba(8,145,178,.18), rgba(8,145,178,.10)) !important;
  border-bottom-color: rgba(6,182,212,.22) !important;
}

/* Stage 1 — radio options (High Regulatory / Less Regulatory) */
[data-bs-theme="dark"] .dcp-radio-label {
  background: rgba(30,41,59,.6) !important;
  border-color: rgba(148,163,184,.22) !important;
}
[data-bs-theme="dark"] .dcp-radio-label-on-highly {
  background: rgba(239,68,68,.10) !important;
  border-color: rgba(239,68,68,.40) !important;
}
[data-bs-theme="dark"] .dcp-radio-label-on-less {
  background: rgba(34,197,94,.10) !important;
  border-color: rgba(34,197,94,.40) !important;
}
[data-bs-theme="dark"] .dcp-radio-label                   .dcp-radio-title { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .dcp-radio-label                   .dcp-radio-sub   { color: #94a3b8 !important; }
[data-bs-theme="dark"] .dcp-radio-label-on-highly         .dcp-radio-title { color: #fca5a5 !important; }
[data-bs-theme="dark"] .dcp-radio-label-on-highly         .dcp-radio-sub   { color: #f87171 !important; }
[data-bs-theme="dark"] .dcp-radio-label-on-less           .dcp-radio-title { color: #86efac !important; }
[data-bs-theme="dark"] .dcp-radio-label-on-less           .dcp-radio-sub   { color: #4ade80 !important; }

/* Stage 1 — Select-Segment sub-panel (red-tinted for highly, green for less) */
[data-bs-theme="dark"] .dcp-select-seg-highly {
  background: linear-gradient(110deg, rgba(239,68,68,.08), rgba(239,68,68,.03)) !important;
  border-color: rgba(239,68,68,.25) !important;
}
[data-bs-theme="dark"] .dcp-select-seg-less {
  background: linear-gradient(110deg, rgba(22,163,74,.08), rgba(22,163,74,.03)) !important;
  border-color: rgba(22,163,74,.25) !important;
}
[data-bs-theme="dark"] .dcp-multi-seg-list {
  background: rgba(15,23,42,.55) !important;
  border-color: rgba(22,163,74,.25) !important;
}
/* Segment code + name are hard-coded dark inline (navy / slate) — unreadable
   on the dark list surface. Lighten them in dark mode. */
[data-bs-theme="dark"] .dcp-multi-seg-list .dcp-seg-code { color: #67e8f9 !important; }
[data-bs-theme="dark"] .dcp-multi-seg-list .dcp-seg-name { color: #e2e8f0 !important; }

/* Stage 1 — "rule already exists" amber warning strip. The pale amber gradient
   + dark-amber text is unreadable on the dark modal surface; give it a darker
   translucent amber fill and light amber text. */
[data-bs-theme="dark"] .dcp-rule-warn {
  background: rgba(217,119,6,.16) !important;
  border-color: rgba(251,191,36,.45) !important;
}
[data-bs-theme="dark"] .dcp-rule-warn div { color: #fde68a !important; }
[data-bs-theme="dark"] .dcp-rule-warn strong { color: #fef3c7 !important; }

/* Stage 1 — Segment Details grid */
[data-bs-theme="dark"] .dcp-segdtl-cell { border-right-color: rgba(6,182,212,.18) !important; }
[data-bs-theme="dark"] .dcp-segdtl-label { color: #67e8f9 !important; }
[data-bs-theme="dark"] .dcp-segdtl-val   { color: #cffafe !important; }

/* Stage 2 — category tabs strip + document table head row */
[data-bs-theme="dark"] .dcp-cat-tabs {
  background: rgba(8,145,178,.10) !important;
  border-color: rgba(6,182,212,.25) !important;
}
/* The light-cyan gradient is set on the <tr> itself, so the background
 * override has to target the tr — overriding only the > th leaves the
 * row visibly white. We also paint each th explicitly so the cells
 * pick up the dark band even when the row's own background is hidden
 * behind any default browser th rule. */
[data-bs-theme="dark"] .dcp-thead-row,
[data-bs-theme="dark"] .dcp-thead-row > th {
  background: rgba(8,145,178,.22) !important;
  border-bottom-color: rgba(6,182,212,.30) !important;
}
[data-bs-theme="dark"] .dcp-thead-row > th > span { color: #cffafe !important; }

/* Stage 2 — Mandatory / Optional segmented buttons. Unselected state uses
 * an inline rgba(248,250,252,.8) bg + #94a3b8 text — both light-mode
 * colors that wash out against the dark row. Selected ("on") states are
 * teal / amber gradients that already work in either mode, so we only
 * need to fix the off state. */
[data-bs-theme="dark"] .dcp-req-btn-off {
  background: rgba(30,41,59,.7) !important;
  color: #cbd5e1 !important;
}
[data-bs-theme="dark"] .dcp-req-btn-off:hover { background: rgba(51,65,85,.85) !important; }
[data-bs-theme="dark"] .dcp-req-group { border-color: rgba(148,163,184,.30) !important; }
[data-bs-theme="dark"] .dcp-req-group.dcp-req-group-mand { border-color: rgba(6,182,212,.45) !important; }
[data-bs-theme="dark"] .dcp-req-group.dcp-req-group-opt  { border-color: rgba(245,158,11,.45) !important; }

/* Brighten the inactive segment-rule tab text in dark mode — previously
 * #94a3b8 was too dim to read against the near-black panel. */
[data-bs-theme="dark"] .clm-tab:not(.active) { color: #cbd5e1; }

/* ── Responsive breakpoints ── */

/* Tablet ≤ 1024px — bref-box grid drops to 3 columns; pill text smaller */
@media (max-width: 1024px) {
  .clm-bref-body { grid-template-columns: repeat(3, 1fr); }
  .clm-pill { padding: 8px 14px; font-size: 11.5px; }
  .clm-pill-ico { width: 20px; height: 20px; }
}

/* Mid tablet ≤ 900px — head-strip wraps; search inputs go full-width */
@media (max-width: 900px) {
  .clm-head-strip { flex-wrap: wrap; padding: 10px 12px 10px 16px; gap: 10px; min-height: 0; }
  .clm-head-strip-left { flex: 1 1 100%; }
  .clm-pill-group { flex: 1 1 auto; }
  .clm-pill { flex: 1; justify-content: center; }
  .clm-add-btn { flex: 1 1 auto; justify-content: center; }
  .clm-tabs-bar { gap: 8px; }
  .clm-search-grow:focus-within { width: auto; }
}

/* Phone ≤ 640px — single column layout, head-strip stacks fully */
@media (max-width: 640px) {
  .clm-root { gap: 10px; }
  .clm-head-strip { flex-direction: column; align-items: stretch; padding: 12px 12px 12px 18px; }
  .clm-head-strip-left { flex: none; }
  .clm-head-strip-title { font-size: 15px; white-space: normal; }
  .clm-head-strip-sub   { white-space: normal; line-height: 1.35; }
  .clm-add-btn { width: 100%; }
  .clm-pill-group { width: 100%; }
  .clm-bref-head { padding: 7px 10px; gap: 8px; }
  .clm-bref-ico { width: 32px; height: 32px; }
  .clm-bref-body { grid-template-columns: repeat(2, 1fr); }
  .clm-tabs-bar { flex-direction: column; align-items: stretch; padding: 10px 12px; }
  .clm-tab { justify-content: center; }
  .clm-search { width: 100%; }
  .clm-total { align-self: stretch; }
  .clm-total-lbl { flex: 1; }
  .clm-modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
  .clm-modal-wide { max-width: 100%; }
  .clm-pag { flex-direction: column; align-items: stretch; gap: 8px; }
  .clm-pag-btns { flex-wrap: wrap; justify-content: center; }
}

/* Tiny phone ≤ 420px — bref-box drops to 1 column for readability */
@media (max-width: 420px) {
  .clm-bref-body { grid-template-columns: 1fr; }
  .clm-head-strip-title { font-size: 14px; }
  .clm-modal-head { padding: 12px 14px; }
  .clm-modal-head-ico { width: 38px; height: 38px; }
  .clm-modal-body { padding: 12px 14px; }
  .clm-modal-foot { padding: 10px 14px; }
}
`;

/* ── Common helpers ── */

export const PER_PAGE = 10;

export function paginate<T>(rows: T[], page: number, perPage: number = PER_PAGE): { slice: T[]; start: number; pageCount: number; safePage: number; perPage: number } {
  const pp = Math.max(1, perPage);
  const pageCount = Math.max(1, Math.ceil(rows.length / pp));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pp;
  return { slice: rows.slice(start, start + pp), start, pageCount, safePage, perPage: pp };
}
