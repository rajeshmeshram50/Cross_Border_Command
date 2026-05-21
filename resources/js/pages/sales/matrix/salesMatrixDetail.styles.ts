/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Opportunity Detail — scoped CSS module.
 *
 * Extracted from SalesMatrixDetail.tsx so the component file stays
 * readable and the styles can be co-located across stage renderers
 * if needed. Exported as a plain string and injected via
 *
 *     <style>{SALES_MATRIX_DETAIL_CSS}</style>
 *
 * inside the page root. Class names are prefixed `.smd-*` and scoped
 * under `.smd-root` so they don't leak into other surfaces that
 * happen to use the same generic words (`step`, `card`, `meta`, etc.).
 * ──────────────────────────────────────────────────────────────────────── */

export const SALES_MATRIX_DETAIL_CSS = `
.smd-root {
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  background: linear-gradient(160deg,#faf5ff 0%,#f5f3ff 35%,#fafafa 100%);
  padding: 10px 14px 18px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  font-size: 12px;
}
.smd-root *,.smd-root *::before,.smd-root *::after { box-sizing: border-box; }

/* ── Customer banner ── */
.smd-cust-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px 10px 22px; margin-bottom: 10px;
  border: 1px solid #e9d5ff; border-radius: 14px;
  background: linear-gradient(110deg,#f5f3ff 0%,#ede9fe 60%,#e9d5ff 100%);
  box-shadow: 0 2px 10px rgba(124,58,237,.06);
}
.smd-cust-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg,#7c3aed 0%,#6d28d9 50%,#5b21b6 100%);
  border-radius: 14px 0 0 14px;
}
.smd-cust-left { display: flex; align-items: center; gap: 10px; flex-shrink: 0; z-index: 1; }
.smd-cust-avatar {
  position: relative; width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  box-shadow: 0 3px 12px rgba(124,58,237,.35);
}
.smd-cust-avatar svg { width: 18px; height: 18px; }
.smd-cust-avatar-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 9px; height: 9px; border-radius: 50%;
  background: linear-gradient(135deg,#4ade80,#22c55e);
  border: 2px solid #ede9fe;
}
.smd-cust-name { font-size: 14px; font-weight: 800; color: #4c1d95; letter-spacing: -.3px; line-height: 1.1; }
.smd-cust-tag {
  display: inline-block; margin-top: 3px;
  font-size: 8px; font-weight: 800; letter-spacing: .12em; color: #7c3aed;
  padding: 1px 8px; background: #fff; border: 1px solid #ddd6fe; border-radius: 20px;
}
.smd-cust-meta { display: flex; align-items: center; gap: 0; flex: 1; justify-content: flex-end; flex-wrap: wrap; z-index: 1; }
/* Vertical ':' dot divider between chips */
.smd-cust-sep {
  width: 14px; height: 22px; margin: 0 4px;
  background-image: radial-gradient(circle, #a78bfa 1.4px, transparent 1.8px);
  background-size: 4px 6px;
  background-repeat: no-repeat;
  background-position: center top 5px, center bottom 5px;
  background-image:
    radial-gradient(circle at center 6px, #a78bfa 1.6px, transparent 2px),
    radial-gradient(circle at center 16px, #a78bfa 1.6px, transparent 2px);
}
.smd-meta {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px 4px 4px;
  background: #fff; border: 1px solid #ddd6fe; border-radius: 12px;
}
.smd-meta-icon {
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(124,58,237,.3);
}
.smd-meta-icon svg { width: 13px; height: 13px; }
.smd-meta-label { font-size: 8px; font-weight: 800; letter-spacing: .12em; color: #94a3b8; line-height: 1.2; text-transform: uppercase; }
.smd-meta-value { font-size: 12px; font-weight: 800; color: #4c1d95; line-height: 1.2; letter-spacing: .02em; }
.smd-back-btn {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 8px 16px; border-radius: 11px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  border: none; color: #fff;
  font-weight: 700; font-size: 12px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(124,58,237,.4);
  transition: all .15s;
  z-index: 1;
}
.smd-back-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(124,58,237,.5); }

/* ── Stepper card (its own container) ── */
.smd-stepper-card {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(124,58,237,.05);
}

/* ── Stepper — chevron-arrow process flow ── */
.smd-stepper {
  display: grid; grid-template-columns: repeat(6,1fr); gap: 0;
}
.smd-step {
  position: relative; isolation: isolate; overflow: hidden;
  padding: 10px 26px 10px 32px;
  background: #f5f3ff;
  cursor: pointer; transition: filter .2s, transform .2s;
  min-height: 92px;
  /* Right edge: arrow point. Left edge: matching V-notch so the
     previous card's arrow nestles inside. */
  clip-path: polygon(
    0 0,
    calc(100% - 18px) 0,
    100% 50%,
    calc(100% - 18px) 100%,
    0 100%,
    18px 50%
  );
  margin-right: -16px;
}
.smd-step:first-child {
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%);
  padding-left: 16px;
  border-top-left-radius: 12px; border-bottom-left-radius: 12px;
}
.smd-step:last-child {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%);
  padding-right: 16px;
  margin-right: 0;
  border-top-right-radius: 12px; border-bottom-right-radius: 12px;
}
.smd-step:hover { filter: brightness(0.98); }
/* Active step — vivid violet gradient. The light-mode purple was a
   touch too dark to pop against the page (especially on dark mode),
   so we lift the start stop to a brighter #a855f7 and add a
   highlight inset at the top edge that mirrors the screenshot. */
.smd-step-active {
  background: linear-gradient(135deg,#a855f7 0%,#8b5cf6 45%,#7c3aed 100%);
  color: #fff;
  box-shadow:
    0 6px 22px rgba(168,85,247,.45),
    inset 0 1px 0 rgba(255,255,255,.20);
  z-index: 3;
}
.smd-step-done { background: #ffffff; z-index: 2; }
.smd-step-idle { background: #f5f3ff; z-index: 1; }

.smd-step-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.smd-step-num  { font-size: 8.5px; font-weight: 800; letter-spacing: .15em; color: #94a3b8; }
.smd-step-active .smd-step-num { color: rgba(255,255,255,.85); }
.smd-step-badge {
  font-size: 8.5px; font-weight: 800; letter-spacing: .06em;
  padding: 2px 7px; border-radius: 20px; white-space: nowrap;
}
.smd-step-badge-active { background: rgba(255,255,255,.22); color: #fff; }
.smd-step-badge-done   { background: #d1fae5; color: #047857; }
.smd-step-big {
  font-size: 30px; font-weight: 800; line-height: 1; letter-spacing: -1px;
  margin-top: 4px; color: #1e293b;
}
.smd-step-idle .smd-step-big { color: #cbd5e1; }
.smd-step-active .smd-step-big { color: #fff; }
.smd-step-title { font-size: 12px; font-weight: 700; margin-top: 4px; color: #1e293b; line-height: 1.15; }
.smd-step-idle .smd-step-title { color: #475569; }
.smd-step-active .smd-step-title { color: #fff; }
.smd-step-sub   { font-size: 9.5px; color: #94a3b8; line-height: 1.3; margin-top: 1px; }
.smd-step-active .smd-step-sub { color: rgba(255,255,255,.78); }
.smd-step-ghost {
  position: absolute; right: 22px; bottom: -14px;
  font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -2px;
  color: rgba(15,23,42,.05); pointer-events: none;
}
.smd-step-active .smd-step-ghost { color: rgba(255,255,255,.18); }

/* ── Action toolbar (own white card) ── */
.smd-toolbar {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fff; border: 1px solid #e9d5ff; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(124,58,237,.05);
}
.smd-act {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 11px; border-radius: 9px;
  background: #fff; border: 1px solid #e9d5ff; color: #6d28d9;
  font-weight: 600; font-size: 11.5px; cursor: pointer;
  transition: all .15s;
}
.smd-act:hover { border-color: #c4b5fd; background: #faf5ff; }
.smd-act-icon { display: inline-flex; align-items: center; color: #7c3aed; }
.smd-act-icon svg { width: 12px; height: 12px; }
.smd-act-label { line-height: 1; }
.smd-act-trail {
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 1px; color: #a78bfa;
}
.smd-act-trail svg { width: 10px; height: 10px; }
.smd-act-wa { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
.smd-act-wa .smd-act-icon { color: #10b981; }
.smd-act-wa:hover { background: #d1fae5; border-color: #6ee7b7; }

/* Key Opportunity — applied after the user confirms in the
   KeyOpportunityModal so the toolbar visibly reflects the
   high-priority flag. Amber wash with a slightly stronger glow than
   the other neutral action pills. */
.smd-act-key {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border-color: #d97706;
  color: #fff;
  box-shadow: 0 3px 10px rgba(245, 158, 11, .35);
}
.smd-act-key .smd-act-icon { color: #fff; }
.smd-act-key:hover {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  border-color: #b45309;
  color: #fff;
  box-shadow: 0 5px 14px rgba(245, 158, 11, .50);
}

/* ── Body grid ── */
.smd-body {
  display: grid; grid-template-columns: 240px minmax(0,1fr) 300px; gap: 10px;
  align-items: stretch;
}
.smd-clm-card, .smd-deal-card, .smd-stage-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
  overflow: hidden; display: flex; flex-direction: column;
  min-width: 0;
}

/* ── CLM panel ── */
.smd-clm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
}
.smd-clm-header-left { display: flex; align-items: center; gap: 8px; }
.smd-clm-header-icon { width: 24px; height: 24px; border-radius: 7px; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; }
.smd-clm-title { font-size: 12px; font-weight: 800; }
.smd-clm-sub   { font-size: 9px; opacity: .85; }
.smd-clm-collapse {
  width: 22px; height: 22px; border-radius: 6px;
  background: rgba(255,255,255,.18); border: none; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.smd-clm-group { padding: 8px 10px; border-top: 1px solid #f1f5f9; }
.smd-clm-group:first-of-type { border-top: none; }
.smd-clm-group-head { display: flex; align-items: center; gap: 8px; padding: 3px 0 8px; }
.smd-clm-group-icon { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.smd-clm-group-icon-violet  { background: linear-gradient(135deg,#7c3aed,#6d28d9); }
.smd-clm-group-icon-emerald { background: linear-gradient(135deg,#10b981,#047857); }
.smd-clm-group-title { font-size: 11.5px; font-weight: 700; color: #1e293b; line-height: 1.2; }
.smd-clm-group-sub   { font-size: 9px; color: #94a3b8; }

.smd-clm-row {
  position: relative;
  padding: 7px 9px; border-radius: 10px;
  background: #fafbff; border: 1px solid #eef2ff;
  margin-bottom: 6px;
}
.smd-clm-row-head { display: flex; align-items: center; gap: 8px; }
.smd-clm-row-icon { width: 22px; height: 22px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.smd-clm-row-icon-amber   { background: linear-gradient(135deg,#f59e0b,#d97706); }
.smd-clm-row-icon-emerald { background: linear-gradient(135deg,#10b981,#047857); }
.smd-clm-row-icon-rose    { background: linear-gradient(135deg,#f43f5e,#e11d48); }
.smd-clm-row-icon-orange  { background: linear-gradient(135deg,#fb923c,#ea580c); }
.smd-clm-row-text { flex: 1; min-width: 0; }
.smd-clm-row-title { font-size: 10.5px; font-weight: 700; color: #1e293b; line-height: 1.2; }
.smd-clm-row-sub   { font-size: 9px; color: #94a3b8; }
.smd-clm-row-go {
  width: 20px; height: 20px; border-radius: 6px;
  background: #fff; border: 1px solid #e5e7eb; color: #6d28d9;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.smd-clm-progress {
  margin-top: 6px; height: 5px; background: #f1f5f9; border-radius: 4px; overflow: hidden;
}
.smd-clm-progress-fill { height: 100%; border-radius: 4px; }
.smd-clm-progress-fill-amber   { background: linear-gradient(90deg,#f59e0b,#fbbf24); }
.smd-clm-progress-fill-emerald { background: linear-gradient(90deg,#10b981,#34d399); }
.smd-clm-progress-fill-rose    { background: linear-gradient(90deg,#f43f5e,#fb7185); }
.smd-clm-progress-fill-orange  { background: linear-gradient(90deg,#fb923c,#fdba74); }
.smd-clm-progress-label { font-size: 9px; font-weight: 700; color: #64748b; text-align: right; margin-top: 2px; }

/* ── Deal panel ── */
.smd-deal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
}
.smd-deal-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.smd-deal-header-icon { width: 24px; height: 24px; border-radius: 7px; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.smd-deal-title { font-size: 11.5px; font-weight: 800; line-height: 1.2; }
.smd-deal-sub   { font-size: 9px; opacity: .85; margin-top: 1px; }
.smd-deal-tabs { display: flex; gap: 3px; padding: 8px 10px 0; border-bottom: 1px solid #f1f5f9; }
.smd-deal-tab {
  position: relative; flex: 1;
  padding: 6px 4px; border-radius: 8px 8px 0 0;
  background: transparent; border: none;
  font-size: 9.5px; font-weight: 700; color: #64748b;
  cursor: pointer;
}
.smd-deal-tab-active { background: #7c3aed; color: #fff; }
.smd-deal-tab:disabled { opacity: .55; cursor: not-allowed; }
.smd-deal-tab-soon {
  position: absolute; top: -4px; right: 2px;
  font-size: 6.5px; font-weight: 800; letter-spacing: .08em;
  padding: 1px 3px; background: #f59e0b; color: #fff; border-radius: 5px;
}

.smd-deal-form { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 9px; }
.smd-deal-row  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.smd-field     { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.smd-field-label { font-size: 8.5px; font-weight: 800; letter-spacing: .08em; color: #64748b; text-transform: uppercase; }
.smd-input     {
  width: 100%; padding: 6px 9px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; font-size: 11px; color: #1e293b; font-family: inherit;
  transition: border-color .15s; min-width: 0;
}
.smd-input:focus { outline: none; border-color: #7c3aed; }
.smd-input-file { text-align: left; cursor: pointer; color: #64748b; }
.smd-req       { color: #ef4444; }
.smd-deal-section-label {
  font-size: 8.5px; font-weight: 800; letter-spacing: .12em; color: #94a3b8;
  text-align: center; padding-top: 4px; margin-top: 2px;
  text-transform: uppercase; border-top: 1px dashed #e5e7eb;
}
.smd-deal-save-wrap { display: flex; justify-content: center; margin-top: 2px; }
.smd-deal-save-btn {
  padding: 7px 28px; border-radius: 9px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  color: #fff; font-weight: 700; font-size: 11.5px; border: none; cursor: pointer;
  box-shadow: 0 3px 10px rgba(124,58,237,.3);
}
.smd-deal-save-btn:hover { transform: translateY(-1px); }

/* ── Stage card (middle column shell) ── */
.smd-stage-card { min-height: 420px; }

@media (max-width: 1500px) {
  .smd-body { grid-template-columns: 220px minmax(0,1fr) 280px; }
}
@media (max-width: 1280px) {
  .smd-body { grid-template-columns: 200px minmax(0,1fr) 260px; }
  .smd-stepper-card { padding: 8px 10px; }
  .smd-toolbar { padding: 8px 10px; }
}
@media (max-width: 1100px) {
  .smd-body { grid-template-columns: 1fr; }
  .smd-stepper { grid-template-columns: repeat(3,1fr); gap: 4px; }
  .smd-step { margin-right: 0; }
  .smd-step, .smd-step:first-child, .smd-step:last-child {
    clip-path: none; border-radius: 10px; border: 1px solid #e5e7eb; padding: 8px 12px;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Dark mode — every surface flips against the slate base so the page
   reads as part of the dark theme instead of glowing white panels.
   Selectors are scoped to .smd-root so they don't leak into other
   pages that share generic class names.
   ═══════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .smd-root,
[data-layout-mode="dark"] .smd-root {
  background: linear-gradient(160deg, #0b0a1a 0%, #14102a 45%, #0b0a1a 100%);
  color: #cbd5e1;
}

/* ─── Customer banner ─── */
[data-bs-theme="dark"] .smd-root .smd-cust-banner {
  background: linear-gradient(110deg, #1a1538 0%, #20184a 60%, #2a1e5c 100%);
  border-color: rgba(167, 139, 250, .25);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .smd-root .smd-cust-name { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-cust-tag {
  background: #14102a; border-color: rgba(167, 139, 250, .35); color: #c4b5fd;
}
[data-bs-theme="dark"] .smd-root .smd-cust-avatar-dot { border-color: #1a1538; }
[data-bs-theme="dark"] .smd-root .smd-meta {
  background: #14102a; border-color: rgba(167, 139, 250, .25); color: #cbd5e1;
}
[data-bs-theme="dark"] .smd-root .smd-meta-icon { background: #2a1e5c; }
[data-bs-theme="dark"] .smd-root .smd-meta-label { color: #94a3b8; }
[data-bs-theme="dark"] .smd-root .smd-meta-value { color: #ede9fe; }

/* ─── Stepper card + STEP cards ─── */
[data-bs-theme="dark"] .smd-root .smd-stepper-card {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
/* STEP cards — actual states are active / done / idle (not "upcoming").
   The light variants use bright #f5f3ff / #ffffff surfaces with
   near-black text — both unreadable on dark mode. */
[data-bs-theme="dark"] .smd-root .smd-step {
  /* Override the base .smd-step gradient that bleeds through .idle. */
  background: linear-gradient(150deg, rgba(124,58,237,.10), rgba(124,58,237,.04));
}
/* Idle step — translucent violet wash; numbers/titles dim but legible. */
[data-bs-theme="dark"] .smd-root .smd-step-idle {
  background: linear-gradient(150deg, rgba(124,58,237,.10), rgba(124,58,237,.04));
}
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-num   { color: rgba(196,181,253,.65); }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-big   { color: rgba(167,139,250,.55); }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-title { color: #e2e8f0; }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-sub   { color: rgba(148,163,184,.85); }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-ghost { color: rgba(255,255,255,.05); }

/* Done step — deep emerald wash so completed work reads as positive
   on dark, instead of the previous off-white that disappeared. */
[data-bs-theme="dark"] .smd-root .smd-step-done {
  background: linear-gradient(135deg, rgba(16,185,129,.28) 0%, rgba(16,185,129,.14) 100%);
}
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-num   { color: #a7f3d0; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-big   { color: #d1fae5; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-sub   { color: #a7f3d0; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-ghost { color: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .smd-root .smd-step-badge-done {
  background: rgba(16,185,129,.25); color: #d1fae5;
}

/* Active step — re-tint the vivid violet gradient on dark with a
   slightly deeper start stop so it still reads as energetic without
   blowing out against the slate page surface. */
[data-bs-theme="dark"] .smd-root .smd-step-active {
  background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 45%, #7c3aed 100%);
  box-shadow:
    0 8px 28px rgba(168, 85, 247, .55),
    inset 0 1px 0 rgba(255, 255, 255, .22);
}
[data-bs-theme="dark"] .smd-root .smd-step-active .smd-step-ghost { color: rgba(255,255,255,.22); }

/* ─── Action toolbar (Customer / Consignee / Add Product / etc.) ─── */
[data-bs-theme="dark"] .smd-root .smd-toolbar {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .smd-root .smd-act {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .smd-root .smd-act-icon { color: #a78bfa; }
[data-bs-theme="dark"] .smd-root .smd-act:hover {
  background: #2a2150;
  border-color: #a78bfa;
  color: #ede9fe;
  box-shadow: 0 3px 10px rgba(124, 58, 237, .30);
}
[data-bs-theme="dark"] .smd-root .smd-act-wa {
  background: linear-gradient(135deg, rgba(16,185,129,.18), rgba(16,185,129,.10));
  border-color: rgba(110, 231, 183, .45);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smd-root .smd-act-wa .smd-act-icon { color: #34d399; }
[data-bs-theme="dark"] .smd-root .smd-act-trail { color: rgba(255,255,255,.55); }
[data-bs-theme="dark"] .smd-root .smd-act-key {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border-color: rgba(252, 211, 77, .60);
  color: #fff;
  box-shadow: 0 4px 14px rgba(245, 158, 11, .45);
}
[data-bs-theme="dark"] .smd-root .smd-act-key:hover {
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  border-color: #fbbf24;
}

/* ─── Left column: CLM Details panel ─── */
[data-bs-theme="dark"] .smd-root .smd-clm-card {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
[data-bs-theme="dark"] .smd-root .smd-clm-header {
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
}
[data-bs-theme="dark"] .smd-root .smd-clm-group {
  background: linear-gradient(135deg, #1a1538, #20184a);
  border-color: rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .smd-root .smd-clm-group-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-clm-group-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .smd-root .smd-clm-row {
  background: #1f1845; border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .smd-root .smd-clm-row:hover { background: #2a2150; border-color: #a78bfa; }
[data-bs-theme="dark"] .smd-root .smd-clm-row-title  { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-clm-row-meta   { color: #94a3b8; }
[data-bs-theme="dark"] .smd-root .smd-clm-progress-track { background: rgba(255,255,255,.10); }

/* ─── Middle column: Stage content card ─── */
[data-bs-theme="dark"] .smd-root .smd-stage-card {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
[data-bs-theme="dark"] .smd-root .smd-stage-header,
[data-bs-theme="dark"] .smd-root .smd-stage-banner {
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
  color: #fff;
}
[data-bs-theme="dark"] .smd-root .smd-opp-card,
[data-bs-theme="dark"] .smd-root .smd-pdm-card {
  background: #1a1538;
  border-color: rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .smd-root .smd-opp-title,
[data-bs-theme="dark"] .smd-root .smd-pdm-title {
  color: #ede9fe;
}
[data-bs-theme="dark"] .smd-root .smd-kv-label { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-kv-value { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-kv {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .22);
}

/* ─── Right column: Deal Execution & Decision Engine panel ─── */
[data-bs-theme="dark"] .smd-root .smd-deal-card {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
[data-bs-theme="dark"] .smd-root .smd-deal-header {
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
  color: #fff;
}
[data-bs-theme="dark"] .smd-root .smd-deal-tabs { border-bottom-color: rgba(167, 139, 250, .22); }
[data-bs-theme="dark"] .smd-root .smd-deal-tab { color: #94a3b8; }
[data-bs-theme="dark"] .smd-root .smd-deal-tab.on {
  color: #ede9fe; border-bottom-color: #a78bfa;
}
[data-bs-theme="dark"] .smd-root .smd-deal-tab-soon {
  background: rgba(245, 158, 11, .18); color: #fbbf24;
}
[data-bs-theme="dark"] .smd-root .smd-deal-section-title { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-deal-label { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-deal-input,
[data-bs-theme="dark"] .smd-root .smd-deal-card input,
[data-bs-theme="dark"] .smd-root .smd-deal-card select,
[data-bs-theme="dark"] .smd-root .smd-deal-card textarea {
  background: #2a2150 !important;
  border-color: rgba(167, 139, 250, .30) !important;
  color: #ede9fe !important;
}
[data-bs-theme="dark"] .smd-root .smd-deal-input::placeholder,
[data-bs-theme="dark"] .smd-root .smd-deal-card input::placeholder,
[data-bs-theme="dark"] .smd-root .smd-deal-card textarea::placeholder {
  color: #6b7280 !important;
}
[data-bs-theme="dark"] .smd-root .smd-deal-input:focus,
[data-bs-theme="dark"] .smd-root .smd-deal-card input:focus,
[data-bs-theme="dark"] .smd-root .smd-deal-card select:focus,
[data-bs-theme="dark"] .smd-root .smd-deal-card textarea:focus {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, .20) !important;
}
[data-bs-theme="dark"] .smd-root .smd-deal-attach {
  background: #2a2150; border-color: rgba(167, 139, 250, .30); color: #c4b5fd;
}
[data-bs-theme="dark"] .smd-root .smd-deal-divider {
  background: rgba(167, 139, 250, .20);
  color: #c4b5fd;
}

/* ─── Generic helpers used inside the panels ─── */
[data-bs-theme="dark"] .smd-root .smd-section-title,
[data-bs-theme="dark"] .smd-root .smd-card-title {
  color: #ede9fe;
}
[data-bs-theme="dark"] .smd-root .smd-divider {
  background: rgba(167, 139, 250, .20);
}

/* Fallback — any card-style surface that uses #fff inline still gets
   visually muted by a translucent overlay so it's not blinding. */
[data-bs-theme="dark"] .smd-root .smd-card,
[data-bs-theme="dark"] .smd-root .smd-card-light {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  color: #ede9fe;
}
`;
