/* ─────────────────────────────────────────────────────────────────────────
 * CLM Master Management — shared visual tokens + base CSS.
 *
 * Each master page (Segment, Authority, KYC, DD, TL, QC, Trade Documents,
 * T&C, Agreements, Clause Library, Document Control Panel) renders under
 * a `clm-root` wrapper and pulls in CLM_CSS so the cyan/teal design from
 * the CLM-Master.html prototype stays consistent across the module.
 *
 * Page-specific tweaks (extra table columns, badge colours for new value
 * types, etc.) go into a tiny per-page CSS string and are concatenated
 * after CLM_CSS via `<style>{CLM_CSS + PAGE_CSS}</style>`.
 * ───────────────────────────────────────────────────────────────────────── */

export const CLM_CSS = `
.clm-root {
  padding: 18px; max-width: 1280px; margin: 0 auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  color: #0F172A;
}

/* ── Header card ── */
.clm-head-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  padding: 16px 20px; margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.clm-head-left { display: flex; align-items: center; gap: 14px; }
.clm-head-ico {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(8,145,178,.30);
  flex-shrink: 0;
}
.clm-crumb { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #0891b2; text-transform: uppercase; }
.clm-head-title { font-size: 18px; font-weight: 800; color: #0c4a6e; margin-top: 2px; }
.clm-head-sub   { font-size: 12px; color: #64748b; margin-top: 3px; max-width: 580px; }
.clm-add-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border: none; cursor: pointer;
  border-radius: 10px; font-size: 12.5px; font-weight: 700;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  box-shadow: 0 4px 14px rgba(8,145,178,.32);
  transition: filter .15s, transform .12s;
  white-space: nowrap;
}
.clm-add-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* ── Body card ── */
.clm-body-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 3px rgba(15,23,42,.04);
}

/* ── Tabs / toolbar row ── */
.clm-tabs {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 18px; border-bottom: 1px solid #e0f2fe;
  background: linear-gradient(110deg, #f0fdff, #fff);
  flex-wrap: wrap;
}
.clm-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 10px;
  border: 1.5px solid rgba(6,182,212,.20);
  background: #fff; color: #0891b2;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}
.clm-tab:hover { background: rgba(6,182,212,.06); }
.clm-tab.active {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  border-color: transparent; color: #fff;
  box-shadow: 0 3px 10px rgba(8,145,178,.30);
}
.clm-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 7px;
  border-radius: 999px;
  background: rgba(6,182,212,.10); color: #0891b2;
  font-size: 10.5px; font-weight: 800;
}
.clm-tab.active .clm-tab-count { background: rgba(255,255,255,.22); color: #fff; }

.clm-search {
  margin-left: auto; display: flex; align-items: center; gap: 7px;
  padding: 0 12px; height: 34px;
  border: 1.5px solid rgba(6,182,212,.20); border-radius: 10px;
  background: #fff; min-width: 240px;
  transition: border-color .15s, box-shadow .15s;
}
.clm-search:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.16); }
.clm-search input { flex: 1; border: none; outline: none; font-size: 12px; background: transparent; color: #0f172a; font-family: inherit; }

.clm-total-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 10px;
  background: linear-gradient(135deg, rgba(8,145,178,.10), rgba(6,182,212,.06));
  border: 1.5px solid rgba(6,182,212,.22);
  color: #0891b2; font-size: 11px; font-weight: 700;
  white-space: nowrap;
}
.clm-total-pill b { font-weight: 800; color: #0c4a6e; }

/* ── Table ── */
.clm-table-wrap { overflow-x: auto; }
.clm-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.clm-table thead th {
  padding: 11px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-bottom: 1.5px solid rgba(6,182,212,.18);
  font-size: 9px; font-weight: 800; letter-spacing: .12em;
  color: #0891b2; text-transform: uppercase; opacity: .85;
  white-space: nowrap; text-align: left;
}
.clm-table tbody tr {
  border-bottom: 1px solid rgba(6,182,212,.06);
  transition: background .12s, box-shadow .12s;
}
.clm-table tbody tr:nth-child(even) { background: rgba(240,253,255,.55); }
.clm-table tbody tr:hover { background: rgba(6,182,212,.07); box-shadow: inset 3px 0 0 #0891b2; }
.clm-table tbody td { padding: 11px 16px; font-size: 12.5px; color: #0c4a6e; vertical-align: middle; }
.clm-td-num  { text-align: center; color: #b0c4d4; font-weight: 600; }
.clm-td-name { font-weight: 700; color: #0c4a6e; letter-spacing: -.15px; }
.clm-td-desc { font-size: 11.5px; color: #475569; }

/* ── Code chip ── */
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

/* ── Badges ── */
.clm-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 20px;
  font-size: 10.5px; font-weight: 700; border: 1px solid;
  white-space: nowrap;
}
.clm-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.clm-badge-teal     { background: rgba(8,145,178,.08); color: #0891b2; border-color: rgba(6,182,212,.22); }
.clm-badge-emerald  { background: rgba(13,148,136,.07); color: #0d9488; border-color: rgba(13,148,136,.22); }
.clm-badge-red      { background: rgba(220,38,38,.07); color: #dc2626; border-color: rgba(220,38,38,.22); }
.clm-badge-amber    { background: rgba(245,158,11,.08); color: #d97706; border-color: rgba(245,158,11,.22); }
.clm-badge-green    { background: rgba(22,163,74,.08); color: #16a34a; border-color: rgba(22,163,74,.22); }
.clm-badge-violet   { background: rgba(124,58,237,.07); color: #7c3aed; border-color: rgba(124,58,237,.22); }
.clm-badge-indigo   { background: rgba(79,70,229,.07); color: #4338ca; border-color: rgba(79,70,229,.22); }
.clm-badge-pink     { background: rgba(190,24,93,.06); color: #be185d; border-color: rgba(190,24,93,.22); }
.clm-badge-slate    { background: rgba(100,116,139,.07); color: #475569; border-color: rgba(100,116,139,.22); }

/* ── Actions cell ── */
.clm-actions { display: inline-flex; align-items: center; gap: 6px; }
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

/* ── Empty / loading states ── */
.clm-status { text-align: center; padding: 28px 12px; color: #94a3b8; font-style: italic; font-size: 12.5px; }
.clm-empty { text-align: center; padding: 32px 16px; }
.clm-empty-ico {
  width: 46px; height: 46px; border-radius: 12px;
  background: rgba(6,182,212,.08); margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
}
.clm-empty-title { font-size: 13.5px; font-weight: 700; color: #0c4a6e; }
.clm-empty-sub   { font-size: 11.5px; color: #64748b; margin-top: 3px; }

/* ── Pagination ── */
.clm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-top: 1.5px solid rgba(6,182,212,.12);
  flex-wrap: wrap; gap: 8px;
}
.clm-pag-info { font-size: 11.5px; color: #0891b2; opacity: .8; }
.clm-pag-info b { color: #0c4a6e; font-weight: 700; opacity: 1; }
.clm-pag-btns { display: flex; gap: 4px; }
.clm-pag-btn {
  min-width: 30px; height: 30px; padding: 0 8px;
  border-radius: 7px; border: 1.5px solid rgba(6,182,212,.20);
  background: rgba(240,253,255,.7); color: #0891b2;
  font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: all .15s;
}
.clm-pag-btn:hover:not(:disabled) { background: rgba(6,182,212,.10); }
.clm-pag-btn.on {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  border-color: transparent; color: #fff; font-weight: 800;
  box-shadow: 0 3px 10px rgba(8,145,178,.32);
  cursor: not-allowed;
}

/* ── Modal (shared shell) ── */
.clm-modal-bd {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px; animation: clm-fade .15s ease-out;
}
@keyframes clm-fade { from { opacity: 0 } to { opacity: 1 } }
.clm-modal {
  width: min(560px, 100%); max-height: 92vh;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(8,145,178,.20), 0 8px 24px rgba(0,0,0,.10);
  animation: clm-pop .18s cubic-bezier(.22,1,.36,1);
}
.clm-modal-wide { width: min(720px, 100%); }
@keyframes clm-pop { from { transform: scale(.96); opacity: 0 } to { transform: scale(1); opacity: 1 } }

.clm-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
}
.clm-modal-head-left { display: flex; align-items: center; gap: 12px; }
.clm-modal-head-ico {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.clm-modal-head-title { font-size: 16px; font-weight: 700; }
.clm-modal-head-sub   { font-size: 11.5px; opacity: .85; margin-top: 2px; }
.clm-modal-close {
  width: 28px; height: 28px; border-radius: 8px; cursor: pointer; border: none;
  background: rgba(255,255,255,.18); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.clm-modal-close:hover { background: rgba(255,255,255,.30); }

.clm-modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }

/* Auto-code strip */
.clm-autocode {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 11px;
  background: linear-gradient(110deg, rgba(8,145,178,.06), rgba(6,182,212,.03));
  border: 1.5px solid rgba(6,182,212,.16);
}
.clm-autocode-ico {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.clm-autocode-text { flex: 1; min-width: 0; }
.clm-autocode-label { font-size: 9px; font-weight: 800; letter-spacing: .08em; color: #0891b2; text-transform: uppercase; opacity: .75; }
.clm-autocode-val {
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px; font-weight: 800; color: #0c4a6e; margin-top: 2px; letter-spacing: .04em;
}
.clm-autocode-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  background: rgba(6,182,212,.10); border: 1px solid rgba(6,182,212,.20);
  font-size: 9.5px; font-weight: 800; color: #0891b2;
  text-transform: uppercase; letter-spacing: .04em;
}
.clm-autocode-badge.edit { background: rgba(245,158,11,.10); border-color: rgba(245,158,11,.22); color: #d97706; }
.clm-autocode-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #0891b2;
  box-shadow: 0 0 0 3px rgba(6,182,212,.18);
}
.clm-autocode-badge.edit .clm-autocode-dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }

/* Form field */
.clm-field { display: flex; flex-direction: column; gap: 4px; }
.clm-field-label { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; color: #0891b2; text-transform: uppercase; }
.clm-req { color: #ef4444; }
.clm-input, .clm-textarea, .clm-select {
  padding: 9px 12px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  font-size: 13px; color: #0c4a6e; font-family: inherit;
  background: #fff; outline: none;
  transition: border-color .15s, box-shadow .15s;
  width: 100%; box-sizing: border-box;
}
.clm-input { height: 38px; padding: 0 12px; }
.clm-select { height: 38px; padding: 0 12px; appearance: auto; }
.clm-textarea { resize: vertical; line-height: 1.5; min-height: 70px; }
.clm-input:focus, .clm-textarea:focus, .clm-select:focus {
  border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.16);
}
.clm-input-err { border-color: #ef4444 !important; }
.clm-err { font-size: 10.5px; color: #ef4444; }
.clm-field-hint { font-size: 10.5px; color: #0891b2; opacity: .7; }

/* Inline add button (e.g. next to authority dropdown) */
.clm-inline-add {
  width: 36px; height: 38px; border-radius: 9px; border: none;
  background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(8,145,178,.32);
  transition: filter .15s, transform .12s;
}
.clm-inline-add:hover { filter: brightness(1.1); transform: translateY(-1px); }

.clm-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
}
.clm-btn-cancel {
  padding: 9px 18px; border-radius: 9px;
  border: 1.5px solid #cbd5e1; background: #fff; color: #475569;
  font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .15s;
}
.clm-btn-cancel:hover:not(:disabled) { background: #f1f5f9; }
.clm-btn-save {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 22px; border-radius: 9px;
  border: none; cursor: pointer; font-family: inherit;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  font-size: 12.5px; font-weight: 700;
  box-shadow: 0 4px 14px rgba(8,145,178,.32);
  transition: filter .15s, transform .12s;
}
.clm-btn-save:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.clm-btn-cancel:disabled, .clm-btn-save:disabled { opacity: .55; cursor: not-allowed; }

/* ── Delete confirm ── */
.clm-conf-bd {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.clm-conf {
  width: min(380px, 100%); background: #fff; border-radius: 14px;
  padding: 22px 22px 18px; text-align: center;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  animation: clm-pop .18s cubic-bezier(.22,1,.36,1);
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
  background: #ef4444; color: #fff;
  font-size: 12.5px; font-weight: 700; font-family: inherit;
  box-shadow: 0 3px 10px rgba(239,68,68,.30);
  transition: filter .15s, transform .12s;
}
.clm-btn-del:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* ── Dark mode (matches Segment page) ── */
[data-bs-theme="dark"] .clm-root { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-head-card,
[data-bs-theme="dark"] .clm-body-card { background: #0f172a; border-color: #1e293b; }
[data-bs-theme="dark"] .clm-head-title { color: #67e8f9; }
[data-bs-theme="dark"] .clm-head-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .clm-tabs { background: linear-gradient(110deg, rgba(8,145,178,.10), #0f172a); border-bottom-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-tab { background: #1e293b; color: #67e8f9; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-search { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-table thead th { background: rgba(8,145,178,.14); color: #67e8f9; border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clm-table tbody tr { border-bottom-color: rgba(6,182,212,.10); }
[data-bs-theme="dark"] .clm-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .clm-table tbody tr:hover { background: rgba(8,145,178,.16); }
[data-bs-theme="dark"] .clm-table tbody td  { color: #e2e8f0; }
[data-bs-theme="dark"] .clm-td-name { color: #f1f5f9; }
[data-bs-theme="dark"] .clm-pag { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clm-pag-info b { color: #67e8f9; }
[data-bs-theme="dark"] .clm-pag-btn { background: #1e293b; color: #67e8f9; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .clm-modal { background: #0f172a; }
[data-bs-theme="dark"] .clm-modal-body { background: #0f172a; }
[data-bs-theme="dark"] .clm-modal-foot { background: #1e293b; border-top-color: #334155; }
[data-bs-theme="dark"] .clm-input,
[data-bs-theme="dark"] .clm-textarea,
[data-bs-theme="dark"] .clm-select { background: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .clm-btn-cancel { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .clm-autocode { background: rgba(8,145,178,.10); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clm-autocode-val { color: #67e8f9; }
[data-bs-theme="dark"] .clm-conf { background: #0f172a; }
[data-bs-theme="dark"] .clm-conf-title { color: #67e8f9; }

@media (max-width: 720px) {
  .clm-head-card { flex-direction: column; align-items: stretch; gap: 12px; }
  .clm-tabs { flex-direction: column; align-items: stretch; }
  .clm-search { width: 100%; margin-left: 0; }
  .clm-tab { justify-content: space-between; }
}
`;

/* ── Common helpers used by every master page ── */

export const PER_PAGE = 10;

export type ToastShape = {
  success: (title: string, message?: string) => void;
  error:   (title: string, message?: string) => void;
};

export function paginate<T>(rows: T[], page: number): { slice: T[]; start: number; pageCount: number; safePage: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const start     = (safePage - 1) * PER_PAGE;
  return { slice: rows.slice(start, start + PER_PAGE), start, pageCount, safePage };
}
