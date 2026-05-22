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
.clm-root {
  padding: 12px 14px;
  width: 100%;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  color: #0F172A;
  display: flex; flex-direction: column; gap: 8px;
  background: #F4F6FB;
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
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #06b6d4, #0891b2, #0e7490);
  color: #fff;
  box-shadow: 0 0 0 3px rgba(6,182,212,.22), 0 4px 12px rgba(8,145,178,.4);
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
  font-size: 16px; font-weight: 800; color: #0c4a6e;
  letter-spacing: -.4px; line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.clm-head-strip-sub {
  font-size: 11px; font-weight: 500; color: #0e7490;
  opacity: .9; margin-top: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.clm-add-btn {
  position: relative; overflow: hidden; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border: none; cursor: pointer;
  border-radius: 10px; font-family: inherit;
  font-size: 12px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #06b6d4, #0891b2, #0e7490);
  box-shadow: 0 4px 14px rgba(8,145,178,.44), inset 0 1px 0 rgba(255,255,255,.18);
  transition: all .18s;
}
.clm-add-btn::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.18); }

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
.clm-bref-label { font-size: 9.5px; font-weight: 800; letter-spacing: -.2px; color: #0891b2; line-height: 1; white-space: nowrap; flex-shrink: 0; }
.clm-bref-sep { width: 1px; height: 13px; background: #A5E8F5; flex-shrink: 0; }
.clm-bref-title { font-size: 11px; font-weight: 800; color: #0c4a6e; letter-spacing: -.2px; line-height: 1; white-space: nowrap; }
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
.clm-bref-item-num { font-size: 8.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #94A3B8; line-height: 1; }
.clm-bref-item-title { font-size: 11px; font-weight: 800; color: #0F172A; letter-spacing: -.2px; line-height: 1.25; margin-bottom: 3px; margin-top: 5px; }
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
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px;
  font-size: 12.5px; font-weight: 600; color: #475569;
  cursor: pointer; border: none; background: transparent;
  font-family: inherit; transition: all .15s;
  white-space: nowrap; position: relative; z-index: 1;
}
.clm-tab:hover { background: rgba(6,182,212,.08); color: #0891b2; }
.clm-tab.active {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 45%, #0e7490 100%);
  color: #fff; font-weight: 700;
  box-shadow: 0 4px 14px rgba(6,182,212,.45), 0 1px 3px rgba(8,145,178,.25), inset 0 1px 0 rgba(255,255,255,.22);
}
.clm-tab.active:hover { opacity: .95; }
.clm-tab-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.clm-tab.active .clm-tab-dot { background: rgba(255,255,255,.65) !important; box-shadow: none !important; }
.clm-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; border-radius: 20px; padding: 0 6px;
  font-size: 10px; font-weight: 800;
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
  background: #fff; min-width: 240px;
  transition: all .15s;
  box-shadow: 0 1px 4px rgba(6,182,212,.07);
}
.clm-search:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.12); }
.clm-search input { flex: 1; border: none; outline: none; font-size: 12px; background: transparent; color: #0c4a6e; font-family: inherit; }
.clm-search-grow:focus-within { width: 480px; }

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
  font-size: 13px; font-weight: 800; color: #0891b2;
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
.clm-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.clm-table thead th {
  padding: 10px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-bottom: 1.5px solid rgba(6,182,212,.15);
  font-size: 8px; font-weight: 800; letter-spacing: .14em;
  color: #0891b2; text-transform: uppercase; opacity: .7;
  white-space: nowrap; text-align: left;
}
.clm-table tbody tr {
  border-bottom: 1px solid rgba(6,182,212,.07);
  transition: background .12s, box-shadow .12s;
}
.clm-table tbody tr:nth-child(even) { background: rgba(240,253,255,.5); }
.clm-table tbody tr:hover { background: rgba(6,182,212,.06); box-shadow: inset 3px 0 0 #0891b2; }
.clm-table tbody td { padding: 11px 16px; font-size: 12.5px; color: #0c4a6e; vertical-align: middle; }
.clm-td-num  { text-align: center; color: #b0c4d4; font-weight: 600; width: 48px; }
.clm-td-name { font-weight: 700; color: #0c4a6e; letter-spacing: -.15px; text-align: left; font-size: 13.5px; }
.clm-td-desc { font-size: 12px; color: #475569; }

/* Code chip */
.clm-code-pill {
  display: inline-block;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 800; letter-spacing: .05em;
  color: #0891b2;
  background: linear-gradient(135deg, rgba(8,145,178,.10), rgba(6,182,212,.06));
  padding: 4px 9px; border-radius: 7px;
  border: 1px solid rgba(6,182,212,.25);
  white-space: nowrap;
}

/* Badges */
.clm-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 20px;
  font-size: 10.5px; font-weight: 700;
  border: 1px solid; white-space: nowrap;
  letter-spacing: .01em;
}
.clm-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
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
  border: 1.5px solid; background: transparent;
  display: flex; align-items: center; justify-content: center;
  opacity: .72; transition: all .15s;
}
.clm-act:hover { opacity: 1; transform: translateY(-1px); }
.clm-act-edit { color: #0891b2; border-color: rgba(6,182,212,.25); background: rgba(240,253,255,.8); }
.clm-act-edit:hover { background: #e0f9fd; border-color: #0891b2; box-shadow: 0 2px 8px rgba(8,145,178,.22); }
.clm-act-del  { color: #ef4444; border-color: rgba(239,68,68,.22); background: rgba(255,245,245,.8); }
.clm-act-del:hover  { background: #fff0f0; border-color: #ef4444; box-shadow: 0 2px 8px rgba(239,68,68,.20); }
.clm-act-view { color: #6366f1; border-color: rgba(99,102,241,.22); background: rgba(238,242,255,.8); }
.clm-act-view:hover { background: #eef2ff; border-color: #6366f1; box-shadow: 0 2px 8px rgba(99,102,241,.22); }

/* Empty / loading */
.clm-status { text-align: center; padding: 24px 12px; color: #94a3b8; font-style: italic; font-size: 12.5px; }
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

/* Pagination */
.clm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-top: 1.5px solid rgba(6,182,212,.12);
  flex-wrap: wrap; gap: 8px;
}
.clm-pag-info { font-size: 11.5px; color: #0891b2; opacity: .7; }
.clm-pag-info b { color: #0c4a6e; font-weight: 700; opacity: 1; }
.clm-pag-btns { display: flex; gap: 4px; }
.clm-pag-btn {
  min-width: 30px; height: 30px; padding: 0 7px;
  border-radius: 7px; border: 1.5px solid rgba(6,182,212,.20);
  background: rgba(240,253,255,.7); color: #0891b2;
  font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.clm-pag-btn:hover:not(:disabled) { background: rgba(6,182,212,.10); }
.clm-pag-btn.on {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  border-color: transparent; color: #fff; font-weight: 800;
  box-shadow: 0 4px 12px rgba(8,145,178,.35);
  cursor: not-allowed;
}

/* ──────────────────────────────────────────────────────────
 * MODAL — gradient teal head, body with cyan gradient bg.
 * ────────────────────────────────────────────────────────── */
.clm-modal-bd {
  position: fixed; inset: 0; z-index: 200000;
  background: rgba(7,30,50,.6); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; animation: clmFadeIn .18s ease both;
}
@keyframes clmFadeIn { from { opacity: 0 } to { opacity: 1 } }
.clm-modal {
  width: 100%; max-width: 460px; max-height: 92vh;
  border-radius: 18px; overflow: hidden;
  display: flex; flex-direction: column;
  background: #fff;
  box-shadow: 0 40px 90px rgba(6,182,212,.18), 0 12px 32px rgba(15,23,42,.28);
  border: 1.5px solid rgba(6,182,212,.25);
  animation: clmSlideUp .24s cubic-bezier(.22,1,.36,1) both;
}
.clm-modal-wide { max-width: 720px; }
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
.clm-modal-head-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.clm-modal-head-sub   { font-size: 10.5px; color: rgba(255,255,255,.7); margin-top: 4px; font-weight: 500; line-height: 1.4; }
.clm-modal-close {
  position: relative; z-index: 1; flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 9px;
  background: rgba(255,255,255,.12);
  border: 1.5px solid rgba(255,255,255,.25); color: rgba(255,255,255,.9);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 15px; font-weight: 300;
  transition: all .15s;
}
.clm-modal-close:hover { background: rgba(255,255,255,.24); border-color: rgba(255,255,255,.45); }

.clm-modal-body {
  background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%);
  padding: 14px 18px 12px;
  display: flex; flex-direction: column; gap: 10px;
  overflow-y: auto;
}

/* Auto code strip */
.clm-autocode {
  display: flex; align-items: center; gap: 8px;
  background: linear-gradient(110deg, #e0f9fd, #caf5fa);
  border: 1.5px solid rgba(6,182,212,.25);
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 6px;
}
.clm-autocode-ico {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(8,145,178,.28);
}
.clm-autocode-text { flex: 1; min-width: 0; }
.clm-autocode-label { font-size: 8px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #0891b2; opacity: .7; margin-bottom: 2px; }
.clm-autocode-val {
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px; font-weight: 800; color: #0c4a6e;
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

/* Form field */
.clm-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 6px; }
.clm-field:last-child { margin-bottom: 0; }
.clm-field-label {
  font-size: 8.5px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase;
  color: #0e7490; display: flex; align-items: center; gap: 5px;
}
.clm-req { color: #EF4444; font-size: 13px; line-height: 1; font-weight: 700; }
.clm-input, .clm-textarea, .clm-select {
  width: 100%; padding: 8px 12px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  background: #fff; font-family: inherit;
  font-size: 12.5px; color: #0c4a6e;
  transition: border-color .15s, box-shadow .15s; outline: none;
  box-shadow: 0 1px 4px rgba(6,182,212,.08), inset 0 1px 0 rgba(255,255,255,.9);
  box-sizing: border-box;
}
.clm-textarea { resize: vertical; line-height: 1.5; min-height: 70px; }
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
  padding: 10px 22px; border-radius: 10px;
  border: 1.5px solid #D1D9F0;
  background: #fff; font-family: inherit;
  font-size: 13px; font-weight: 600; color: #475569;
  cursor: pointer; transition: all .15s;
}
.clm-btn-cancel:hover:not(:disabled) { border-color: #0891b2; color: #0891b2; background: #f0fdff; }
.clm-btn-save {
  position: relative; overflow: hidden;
  padding: 10px 26px; border-radius: 10px;
  border: none; cursor: pointer; font-family: inherit;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  font-size: 13px; font-weight: 700; color: #fff;
  box-shadow: 0 4px 14px rgba(8,145,178,.4), inset 0 1px 0 rgba(255,255,255,.18);
  display: inline-flex; align-items: center; gap: 6px;
  transition: all .15s;
}
.clm-btn-save::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.14), transparent);
  border-radius: 10px 10px 0 0; pointer-events: none;
}
.clm-btn-save:hover:not(:disabled) {
  background: linear-gradient(135deg, #0891b2, #0e7490, #155e75);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(8,145,178,.48);
}
.clm-btn-cancel:disabled, .clm-btn-save:disabled { opacity: .55; cursor: not-allowed; transform: none; }

/* Delete confirm */
.clm-conf-bd {
  position: fixed; inset: 0; z-index: 210000;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: clmFadeIn .15s ease-out;
}
.clm-conf {
  width: min(380px, 100%); background: #fff; border-radius: 14px;
  padding: 22px 22px 18px; text-align: center;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  animation: clmSlideUp .18s cubic-bezier(.22,1,.36,1);
}
.clm-conf-ico {
  width: 52px; height: 52px; margin: 0 auto 12px;
  background: rgba(239,68,68,.10); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.clm-conf-title { font-size: 15px; font-weight: 800; color: #0c4a6e; margin-bottom: 6px; }
.clm-conf-sub   { font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 16px; }
.clm-conf-btns { display: flex; justify-content: center; gap: 8px; }
.clm-btn-del {
  padding: 8px 18px; border: none; cursor: pointer; border-radius: 9px;
  background: #ef4444; color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(239,68,68,.30);
  transition: all .15s;
}
.clm-btn-del:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* ── Dark mode ── */
[data-bs-theme="dark"] .clm-root { color: #e2e8f0; background: #0a0f1c; }
[data-bs-theme="dark"] .clm-page-card { background: #0f172a; border-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-head-strip { background: linear-gradient(110deg, rgba(8,145,178,.18), rgba(6,182,212,.10)); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clm-head-strip-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-head-strip-sub   { color: #7dd3fc; }
[data-bs-theme="dark"] .clm-bref-head { background: linear-gradient(110deg, rgba(8,145,178,.20), rgba(6,182,212,.10)); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clm-bref-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-bref-sub   { color: #7dd3fc; }
[data-bs-theme="dark"] .clm-bref-body { background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); }
[data-bs-theme="dark"] .clm-bref-item { background: #1e293b; border-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-bref-item-title { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-tabs-wrap { background: #0f172a; }
[data-bs-theme="dark"] .clm-tabs-bar { background: #0f172a; border-bottom-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-tab { color: #94a3b8; }
[data-bs-theme="dark"] .clm-tab:hover { color: #67e8f9; }
[data-bs-theme="dark"] .clm-tab:not(.active) .clm-tab-count { background: #1e293b; color: #94a3b8; border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .clm-search { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-total-num { background: #1e293b; color: #67e8f9; }
[data-bs-theme="dark"] .clm-table-wrap { background: #0f172a; }
[data-bs-theme="dark"] .clm-table thead th { background: rgba(8,145,178,.14); color: #67e8f9; border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clm-table tbody tr { border-bottom-color: rgba(6,182,212,.10); }
[data-bs-theme="dark"] .clm-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .clm-table tbody tr:hover { background: rgba(8,145,178,.16); }
[data-bs-theme="dark"] .clm-table tbody td { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-td-name { color: #f1f5f9; }
[data-bs-theme="dark"] .clm-pag { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-pag-info b { color: #67e8f9; }
[data-bs-theme="dark"] .clm-pag-btn { background: #1e293b; color: #67e8f9; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-modal { background: #0f172a; }
[data-bs-theme="dark"] .clm-modal-body { background: linear-gradient(160deg, rgba(8,145,178,.10), rgba(8,145,178,.05) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .clm-modal-foot { background: #1e293b; border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-input,
[data-bs-theme="dark"] .clm-textarea,
[data-bs-theme="dark"] .clm-select { background: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .clm-btn-cancel { background: #1e293b; border-color: #334155; color: #cbd5e1; }
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
[data-bs-theme="dark"] .clm-bref-label  { color: #67e8f9; }
[data-bs-theme="dark"] .clm-bref-item-desc { color: #94a3b8; }
[data-bs-theme="dark"] .clm-bref-toggle { background: rgba(15,23,42,.65); border-color: rgba(8,145,178,.32); color: #67e8f9; }
[data-bs-theme="dark"] .clm-status { color: #64748b; }
[data-bs-theme="dark"] .clm-field-label { color: #67e8f9; }
[data-bs-theme="dark"] .clm-field-hint  { color: #7dd3fc; }
[data-bs-theme="dark"] .clm-autocode-label { color: #67e8f9; }
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
  .clm-search { flex: 1 1 auto; min-width: 160px; }
  .clm-search-grow:focus-within { width: auto; }
}

/* Phone ≤ 640px — single column layout, head-strip stacks fully */
@media (max-width: 640px) {
  .clm-root { padding: 10px; }
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

export function paginate<T>(rows: T[], page: number): { slice: T[]; start: number; pageCount: number; safePage: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const start     = (safePage - 1) * PER_PAGE;
  return { slice: rows.slice(start, start + PER_PAGE), start, pageCount, safePage };
}
