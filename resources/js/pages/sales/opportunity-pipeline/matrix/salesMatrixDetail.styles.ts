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
  font-family: var(--font-sans);
  background: linear-gradient(160deg,#faf5ff 0%,#f5f3ff 35%,#fafafa 100%);
  padding: 10px 14px 18px;
  margin: -1rem -0.75rem;
  /* At least the viewport height — the columns fill it (see the card
     min-height below) and the whole page scrolls when content overflows
     (matches the figma; internal column scroll was over-constraining the
     layout at 100% zoom). */
  min-height: calc(100vh - 70px);
  color: #1e293b;
  font-size: 12px;
}
.smd-root *,.smd-root *::before,.smd-root *::after { box-sizing: border-box; }

/* ── Customer banner — premium lavender strip with glow, sheen, glass pills ── */
.smd-cust-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 0 20px; min-height: 62px;
  margin-bottom: 10px;
  border: 1px solid #c4b5fd; border-radius: 16px;
  background: linear-gradient(110deg, #faf5ff 0%, #f3e8ff 25%, #ede9fe 55%, #ddd6fe 85%, #c4b5fd 100%);
  box-shadow:
    inset 0 2px 0 rgba(255,255,255,.85),
    0 8px 28px rgba(139,92,246,.20),
    0 2px 8px rgba(0,0,0,.06);
}
/* Left accent bar */
.smd-cust-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
  border-radius: 16px 0 0 16px;
}
/* Soft radial glows behind content */
.smd-cust-glow {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse at 10% 50%, rgba(196,181,253,.45) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(167,139,250,.25) 0%, transparent 55%);
}
/* Top sheen */
.smd-cust-sheen {
  position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.50), transparent);
  border-radius: 16px 16px 0 0;
}

/* Left: avatar + name + glass badge */
.smd-cust-left {
  display: flex; align-items: center; gap: 13px;
  flex-shrink: 0; z-index: 1;
  padding-left: 10px;
}
.smd-cust-avatar-wrap { position: relative; flex-shrink: 0; }
.smd-cust-avatar {
  width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%);
  box-shadow:
    0 0 0 3px rgba(139,92,246,.25),
    0 4px 14px rgba(124,58,237,.45);
}
.smd-cust-avatar-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #f3e8ff;
  box-shadow: 0 2px 4px rgba(34,197,94,.40);
}
.smd-cust-name { font-size: 14.5px; font-weight: 800; color: #3b0764; letter-spacing: -.4px; line-height: 1.2; }
.smd-cust-tag {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px;
  padding: 1px 9px; border-radius: 20px;
  background: rgba(255,255,255,.60);
  border: 1px solid rgba(139,92,246,.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.smd-cust-tag-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: #7c3aed; display: inline-block;
}
.smd-cust-tag-text {
  font-size: 8.5px; font-weight: 700; color: #5b21b6;
  text-transform: uppercase; letter-spacing: .1em;
}

/* Right: meta pills + 3-dot separators + line + back button */
.smd-cust-meta {
  display: flex; align-items: center; gap: 7px;
  flex: 0 1 auto; justify-content: flex-end; flex-wrap: nowrap;
  z-index: 1;
}

/* WhatsApp Status — green pill that lives at the head of the meta row
   (relocated from the action toolbar). Solid green gradient with a
   translucent-white icon badge on the left, matching the prototype's
   header design. When the lead is marked connected the pill gets a
   slightly deeper green + small status dot. */
.smd-hdr-wa {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px;
  border: none; cursor: pointer;
  border-radius: 999px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 55%, #15803d 100%);
  color: #fff;
  box-shadow: 0 3px 10px rgba(34, 197, 94, .35), inset 0 1px 0 rgba(255, 255, 255, .25);
  font-family: inherit;
  transition: transform .12s, box-shadow .15s, filter .15s;
}
.smd-hdr-wa:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(34, 197, 94, .45), inset 0 1px 0 rgba(255, 255, 255, .25);
  filter: brightness(1.05);
}
.smd-hdr-wa-icon {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, .22);
  color: #fff;
  flex-shrink: 0;
}
.smd-hdr-wa-icon svg { width: 14px; height: 14px; }
.smd-hdr-wa-text {
  font-size: 12.5px; font-weight: 700; letter-spacing: .01em;
  white-space: nowrap;
}
/* Connected variant — slightly deeper gradient + tiny status dot
   appended after the label so the user can see at a glance that
   WhatsApp communication is already on record. */
.smd-hdr-wa-on {
  background: linear-gradient(135deg, #16a34a 0%, #15803d 55%, #166534 100%);
}
.smd-hdr-wa-on .smd-hdr-wa-text::after {
  content: ''; display: inline-block; vertical-align: middle;
  width: 6px; height: 6px; margin-left: 7px;
  border-radius: 50%; background: #bbf7d0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, .25);
}

/* 3-dot vertical separator between pills */
.smd-cust-sep {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 0 1px;
}
.smd-cust-sep i {
  width: 2.5px; height: 2.5px; border-radius: 50%;
  background: rgba(124,58,237,.30);
}

/* Glass pill — translucent with blur */
.smd-meta {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 14px;
  background: rgba(255,255,255,.65);
  border: 1.5px solid rgba(139,92,246,.30);
  border-radius: 12px;
  box-shadow:
    0 2px 8px rgba(124,58,237,.12),
    inset 0 1px 0 rgba(255,255,255,.95);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  flex-shrink: 0;
}
.smd-meta-icon {
  width: 26px; height: 26px; border-radius: 8px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 8px rgba(124,58,237,.45);
  flex-shrink: 0;
}
.smd-meta-icon svg { width: 11px; height: 11px; }
.smd-meta-label {
  font-size: 7px; font-weight: 800; color: #a78bfa;
  line-height: 1; margin-bottom: 2px;
  text-transform: uppercase; letter-spacing: .14em;
}
.smd-meta-value {
  font-size: 12.5px; font-weight: 800; color: #3b0764;
  line-height: 1; letter-spacing: .05em;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
}

/* Vertical hairline before the back button */
.smd-cust-line {
  width: 1px; height: 30px;
  margin: 0 3px;
  background: linear-gradient(to bottom,
    transparent,
    rgba(124,58,237,.30) 40%,
    rgba(124,58,237,.30) 60%,
    transparent);
}

/* Back button — tri-stop violet with top sheen ::before */
.smd-back-btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #5b21b6 100%);
  border: none; border-radius: 12px;
  color: #fff;
  font-family: inherit;
  font-size: 11.5px; font-weight: 700;
  cursor: pointer;
  transition: all .2s;
  flex-shrink: 0;
  white-space: nowrap; letter-spacing: .02em;
  box-shadow:
    0 4px 16px rgba(124,58,237,.50),
    0 1px 3px rgba(91,33,182,.30),
    inset 0 1px 0 rgba(255,255,255,.20);
  text-shadow: 0 1px 2px rgba(0,0,0,.20);
  z-index: 1;
}
.smd-back-btn::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  pointer-events: none;
  border-radius: 12px 12px 0 0;
}
.smd-back-btn > * { position: relative; z-index: 1; }
.smd-back-btn:hover {
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 50%, #4c1d95 100%);
  transform: translateY(-1.5px);
  box-shadow:
    0 8px 24px rgba(124,58,237,.60),
    0 2px 6px rgba(91,33,182,.35),
    inset 0 1px 0 rgba(255,255,255,.20);
}
.smd-back-btn:active { transform: translateY(0); }

/* ── Stepper card — unified white container that also holds the action toolbar ── */
.smd-stepper-card {
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 16px;
  padding: 14px 16px;
  margin-bottom: 10px;
  box-shadow:
    0 2px 12px rgba(124,58,237,.07),
    inset 0 1px 0 rgba(255,255,255,.90);
}

/* ── Stepper — separated cards with right-pointing chevron arrows between ── */
.smd-stepper { display: flex; align-items: stretch; gap: 16px; }
.smd-step {
  flex: 1; min-width: 0;
  position: relative;
  border-radius: 10px;
  padding: 5px 8px 5px 10px;
  display: flex; flex-direction: column;
  cursor: pointer; user-select: none;
  /* overflow visible so the ::after chevron arrow can draw outside the
     card into the 16px gap. The ::before sheen sits inside the card so
     it's unaffected. */
  overflow: visible;
  transition: transform .17s ease, box-shadow .17s ease;
}
/* Locked step — a future stage that hasn't been reached yet. Not clickable
   (the onClick no-ops); show a not-allowed cursor and a faint dimming so the
   user sees it's gated until the current stage is completed. */
.smd-step-locked {
  cursor: not-allowed;
  opacity: .82;
}
.smd-step-locked:hover { transform: none; box-shadow: none; }
/* Top sheen — shown only on active + done via opacity overrides below. */
.smd-step::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 44%;
  pointer-events: none;
  border-radius: 9px 9px 0 0;
  opacity: 0;
}
/* Right-pointing chevron arrow in the gap, coloured per source-card state. */
.smd-step::after {
  content: '';
  position: absolute;
  right: -12px; top: 0; bottom: 0;
  width: 12px;
  background: #d1d8e2; opacity: .35;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  z-index: 10;
  pointer-events: none;
}
.smd-step:last-child::after { display: none; }

/* ─── ACTIVE ─── */
.smd-step-active {
  background: linear-gradient(150deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  border: 1.5px solid #6d28d9;
  box-shadow:
    0 6px 20px rgba(124,58,237,.40),
    inset 0 1px 0 rgba(255,255,255,.13);
}
.smd-step-active:hover {
  transform: translateY(-2px);
  box-shadow:
    0 10px 26px rgba(124,58,237,.45),
    inset 0 1px 0 rgba(255,255,255,.13);
}
.smd-step-active::before {
  opacity: 1;
  background: linear-gradient(180deg, rgba(255,255,255,.10), transparent);
}
.smd-step-active::after { background: #9b72f5; opacity: .65; }

/* ─── DONE ─── */
.smd-step-done {
  background: linear-gradient(150deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%);
  border: 1.5px solid #c4b5fd;
  box-shadow:
    0 2px 10px rgba(124,58,237,.11),
    inset 0 1px 0 rgba(255,255,255,.90);
}
.smd-step-done:hover {
  transform: translateY(-2px);
  box-shadow:
    0 7px 18px rgba(124,58,237,.15),
    inset 0 1px 0 rgba(255,255,255,.90);
}
.smd-step-done::before {
  opacity: 1;
  background: linear-gradient(180deg, rgba(255,255,255,.46), transparent);
}
.smd-step-done::after { background: #9b72f5; opacity: .65; }

/* ─── UPCOMING (idle) ─── */
.smd-step-idle {
  background: linear-gradient(150deg, #f8fafc, #f1f5f9);
  border: 1.5px solid #e2e8f0;
  box-shadow:
    0 1px 4px rgba(0,0,0,.04),
    inset 0 1px 0 rgba(255,255,255,.95);
  cursor: default;
}
.smd-step-idle::after { background: #d1d8e2; opacity: .35; }

/* Content above the sheen. */
.smd-step > * { position: relative; z-index: 1; }

.smd-step-head { margin-bottom: 2px; }
.smd-step-num {
  font-size: 7px; font-weight: 800;
  letter-spacing: .20em; text-transform: uppercase;
  line-height: 1; display: block;
}
.smd-step-active .smd-step-num { color: rgba(255,255,255,.50); }
.smd-step-done   .smd-step-num { color: #b8a0f8; }
.smd-step-idle   .smd-step-num { color: #d1d8e2; }

/* Chip — absolute top-right corner. */
.smd-step-badge {
  position: absolute; top: 5px; right: 6px; z-index: 11;
  display: inline-flex; align-items: center; gap: 3px;
  border-radius: 20px;
  padding: 1.5px 6px;
}
.smd-step-badge-active {
  background: rgba(255,255,255,.13);
  border: 1px solid rgba(255,255,255,.28);
}
.smd-step-badge-done {
  background: rgba(124,58,237,.09);
  border: 1px solid rgba(124,58,237,.20);
}
.smd-step-badge-text {
  font-size: 7px; font-weight: 800; letter-spacing: .07em;
  text-transform: uppercase;
}
.smd-step-badge-active .smd-step-badge-text { color: #fff; }
.smd-step-badge-done   .smd-step-badge-text { color: #7c3aed; }
.smd-step-badge-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: #fff; display: inline-block;
  animation: smd-step-pulse 1.2s ease-in-out infinite;
}
.smd-step-badge-done svg { color: #7c3aed; }
@keyframes smd-step-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .5; transform: scale(.7); }
}

.smd-step-big {
  font-size: 26px; font-weight: 900; line-height: 1;
  letter-spacing: -.04em; margin-bottom: 2px;
}
.smd-step-active .smd-step-big { color: #fff; }
.smd-step-done   .smd-step-big {
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
.smd-step-idle .smd-step-big { color: #c8d3e0; }

.smd-step-title { font-size: 10px; font-weight: 800; line-height: 1.25; }
.smd-step-active .smd-step-title { color: #fff; }
.smd-step-done   .smd-step-title { color: #5b21b6; }
.smd-step-idle   .smd-step-title { color: #94a3b8; }

.smd-step-sub { font-size: 8px; line-height: 1.35; margin-top: 1px; font-weight: 400; }
.smd-step-active .smd-step-sub { color: rgba(255,255,255,.68); }
.smd-step-done   .smd-step-sub { color: #8b5cf6; }
.smd-step-idle   .smd-step-sub { color: #b8c5d3; }

.smd-step-ghost {
  position: absolute; right: -1px; bottom: -4px;
  font-size: 44px; font-weight: 900; line-height: 1;
  pointer-events: none; user-select: none;
  z-index: 0;
}
.smd-step-active .smd-step-ghost { color: rgba(255,255,255,.06); }
.smd-step-done   .smd-step-ghost { color: rgba(124,58,237,.06); }
.smd-step-idle   .smd-step-ghost { color: rgba(148,163,184,.09); }

/* Divider between stepper and action toolbar (inside .smd-stepper-card). */
.smd-stepper-divider {
  height: 1px;
  margin: 12px 0;
  background: linear-gradient(90deg, transparent, #ddd6fe 20%, #ddd6fe 80%, transparent);
}

/* ── Action toolbar — lives inside .smd-stepper-card below the divider ── */
.smd-toolbar {
  display: flex; align-items: center; gap: 7px;
  width: 100%;
  flex-wrap: nowrap;
  overflow-x: auto; overflow-y: visible;
  white-space: nowrap;
  padding-bottom: 2px;
  margin-top: 0;
  background: transparent;
  border-top: none;
}
.smd-toolbar::-webkit-scrollbar { height: 3px; }
.smd-toolbar::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 999px; }
/* Buttons grow to share the full toolbar width edge-to-edge so the row
   spans the container instead of clustering on the left with empty space
   on the right. Separators stay fixed-size hairlines. */
.smd-toolbar > .smd-act { flex: 1 1 auto; justify-content: center; }
.smd-act-sep {
  display: inline-block;
  width: 1px; height: 22px;
  flex: 0 0 auto;
  background: linear-gradient(to bottom, transparent, #ddd6fe, transparent);
}
.smd-act {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px; border-radius: 9px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  border: 1.5px solid #c4b5fd;
  color: #5b21b6;
  font-family: inherit;
  font-weight: 700; font-size: 11px;
  cursor: pointer;
  transition: all .17s;
  box-shadow:
    0 2px 7px rgba(124,58,237,.08),
    inset 0 1px 0 rgba(255,255,255,.90);
  white-space: nowrap;
}
.smd-act:not(.smd-act-locked):hover {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  border-color: #6d28d9;
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(124,58,237,.32);
}
.smd-act:not(.smd-act-locked):hover .smd-act-icon,
.smd-act:not(.smd-act-locked):hover .smd-act-trail { color: #fff; }
.smd-act:active { transform: translateY(0); }
.smd-act-disabled {
  opacity: .45; cursor: not-allowed; pointer-events: none;
  background: #f8fafc; color: #94a3b8; border-color: #e2e8f0;
}
.smd-act-disabled .smd-act-icon,
.smd-act-disabled .smd-act-trail { color: #cbd5e1; }
[data-bs-theme="dark"] .smd-act-disabled {
  background: rgba(148,163,184,.08); color: #64748b; border-color: rgba(148,163,184,.20);
}
[data-bs-theme="dark"] .smd-act-disabled .smd-act-icon,
[data-bs-theme="dark"] .smd-act-disabled .smd-act-trail { color: #64748b; }
/* Deal-locked toolbar button (PI signed) — KEEP the button's original colour;
   just lay a subtle translucent veil over it (no grey-out, no recolour). The
   button is still clickable so a click can raise the "deal locked" toast. */
.smd-act-locked { position: relative; cursor: not-allowed; }
.smd-act-locked::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  /* Neutral slate-grey veil — reads clearly as "disabled" (not the old rose). */
  background: rgba(100,116,139,.34); pointer-events: none;
}
[data-bs-theme="dark"] .smd-act-locked::after { background: rgba(148,163,184,.30); }
.smd-act-icon { display: inline-flex; align-items: center; color: #7c3aed; }
.smd-act-icon svg { width: 12px; height: 12px; }
.smd-act-label { line-height: 1; }
.smd-act-trail {
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 1px; color: #a78bfa;
}
.smd-act-trail svg { width: 10px; height: 10px; }
.smd-act-wa {
  background: linear-gradient(135deg, #f0fdf4, #dcfce7);
  border-color: #86efac;
  color: #15803d;
  box-shadow:
    0 2px 7px rgba(34,197,94,.10),
    inset 0 1px 0 rgba(255,255,255,.90);
}
.smd-act-wa .smd-act-icon { color: currentColor; }
.smd-act-wa:hover {
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #fff;
  border-color: #15803d;
  box-shadow: 0 5px 14px rgba(22,163,74,.32);
}
.smd-act-wa:hover .smd-act-icon { color: #fff; }

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

/* ── Body — flex row: CLM 20% · Stage (fills the rest) · Deal 30%.
   When a side card is collapsed the JSX swaps it for a thin .smd-rail,
   whose fixed flex-basis (see .smd-rail below) shrinks that side so the
   middle stage card absorbs the freed width. ── */
.smd-body {
  /* Grid (not flex) so the centre column can OPT OUT of setting the row
     height: with min-height:0 on .smd-stage-card the row's height is
     driven by the side panels' natural content, and the centre stretches
     to match them, scrolling its own overflow internally. This keeps all
     three columns the same height whether the LEFT is tall (segments) or
     the CENTRE is tall (Stage 6 shipment summary). */
  display: grid;
  grid-template-columns: 20% 1fr 30%;
  gap: 10px;
  align-items: stretch;
  transition: grid-template-columns .3s ease;
}
/* Collapsed side rails shrink their column to the 44px rail width. */
.smd-body-clm-collapsed  { grid-template-columns: 44px 1fr 30%; }
.smd-body-deal-collapsed { grid-template-columns: 20% 1fr 44px; }
.smd-body-clm-collapsed.smd-body-deal-collapsed { grid-template-columns: 44px 1fr 44px; }

/* ── Collapsed side rail ── */
.smd-rail {
  flex: 0 0 44px;
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 14px;
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 0;
  cursor: pointer;
  color: #5b21b6;
  user-select: none;
  transition: box-shadow .15s, flex .3s ease;
  min-height: 320px;
  box-shadow: 0 2px 12px rgba(124,58,237,.07);
}
.smd-rail:hover { box-shadow: 0 4px 14px rgba(124,58,237,.15); }
/* Arrow stays the violet gradient (matches the card-header collapse btn). */
.smd-rail-btn {
  width: 24px; height: 24px; border-radius: 6px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); border: none; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(124,58,237,.30);
}
.smd-rail-btn:hover { filter: brightness(1.08); }
.smd-rail-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  margin-top: 14px;
  font-size: 11px; font-weight: 800; letter-spacing: .12em;
  color: #5b21b6;
}
[data-bs-theme="dark"] .smd-root .smd-rail {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  color: #c4b5fd;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
[data-bs-theme="dark"] .smd-root .smd-rail-label { color: #c4b5fd; }
.smd-clm-card, .smd-deal-card, .smd-stage-card {
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 14px;
  overflow: hidden; display: flex; flex-direction: column;
  min-width: 0;
  /* Fill at least the viewport (minus nav + banner + stepper + toolbar
     ~300px) so a short stage isn't stranded at the top. The SIDE panels
     keep this min-height and grow with their content, driving the grid
     row height; the centre opts out (min-height:0 below) and stretches to
     match them, scrolling its own overflow internally. */
  min-height: calc(100vh - 300px);
  box-shadow: 0 2px 16px rgba(124,58,237,.10);
}
/* Per-card flex sizing (CLM 20% · Stage fills · Deal 30%). transition
   on the side cards lets the width ease when the panels collapse/expand. */
.smd-clm-card {
  flex: 0 0 20%;
  border: 1px solid #ede9fe;
  box-shadow: 0 2px 12px rgba(124,58,237,.07);
  transition: flex .3s ease;
}
.smd-stage-card {
  flex: 1 1 0%;
  box-shadow: 0 2px 16px rgba(124,58,237,.09);
}
/* ── Signed-PI lock veil (centre stage column) ──
   A translucent disabled layer over the whole stage card that intercepts every
   click and shows the "PI is signed" toaster — applied across all stages 1-6. */
.smd-stage-card-locked { position: relative; }
.smd-stage-veil {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 14px;
  /* Light disabled tint — just enough to read as inactive without darkening
     the content. */
  background: rgba(148, 163, 184, 0.10);
  cursor: not-allowed;
  border-radius: inherit;
}
.smd-stage-veil-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px; border-radius: 999px;
  background: #64748b; color: #fff;
  font-size: 11px; font-weight: 700; letter-spacing: .01em;
  box-shadow: 0 4px 12px rgba(15,23,42,.18);
}
/* Keep the stage footer (← Previous / Save & Next →) ABOVE the veil so the user
   can still navigate even though the rest of the stage is read-only. */
.smd-stage-card-locked .smd-stg-foot { position: relative; z-index: 25; }
[data-bs-theme="dark"] .smd-stage-veil { background: rgba(15, 23, 42, 0.22); }
[data-bs-theme="dark"] .smd-stage-veil-badge { background: #334155; }
.smd-deal-card {
  flex: 0 0 30%;
  border: 1px solid #ede9fe;
  box-shadow: 0 2px 12px rgba(124,58,237,.07);
  transition: flex .3s ease;
}

/* ── CLM panel ── */
.smd-clm-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 12px 10px;
  background: linear-gradient(125deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 65%, #8b5cf6 100%);
  color: #fff;
}
.smd-clm-header::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 55%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  pointer-events: none;
}
.smd-clm-header::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 30%;
  background: linear-gradient(0deg, rgba(0,0,0,.10), transparent);
  pointer-events: none;
}
.smd-clm-header-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
.smd-clm-header-icon {
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.10));
  border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(0,0,0,.18);
}
.smd-clm-title { font-size: 10.5px; font-weight: 900; letter-spacing: -.3px; line-height: 1.2; }
.smd-clm-sub   { font-size: 7px; color: rgba(255,255,255,.65); font-weight: 600; letter-spacing: .07em; margin-top: 2px; }
.smd-clm-collapse {
  position: relative; z-index: 1;
  width: 22px; height: 22px; border-radius: 7px;
  background: rgba(255,255,255,.15);
  border: 1px solid rgba(255,255,255,.26);
  color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.smd-clm-collapse:hover { background: rgba(255,255,255,.28); }

/* Group cards — lavender gradient with hover lift */
.smd-clm-group {
  margin: 8px 10px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  border: 1.5px solid #ddd6fe;
  border-radius: 11px;
  box-shadow: 0 2px 8px rgba(124,58,237,.08);
  transition: border-color .17s, box-shadow .17s;
}
.smd-clm-group:hover { border-color: #7c3aed; box-shadow: 0 4px 14px rgba(124,58,237,.18); }
.smd-clm-group:first-of-type { margin-top: 10px; }
.smd-clm-group:last-of-type  { margin-bottom: 12px; }
.smd-clm-group-head {
  display: flex; align-items: center; gap: 9px;
  padding-bottom: 7px; margin-bottom: 7px;
  border-bottom: 1px solid #ddd6fe;
}
.smd-clm-group-icon {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(124,58,237,.30);
}
.smd-clm-group-icon-violet  { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
.smd-clm-group-icon-emerald { background: linear-gradient(135deg, #6d28d9, #4c1d95); }
.smd-clm-group-title { font-size: 10px; font-weight: 800; color: #3b0764; letter-spacing: -.1px; line-height: 1.25; }
.smd-clm-group-sub   { font-size: 7px; color: #a78bfa; font-weight: 600; margin-top: 1px; }

/* Row buttons — white with colored icon + progress bar */
.smd-clm-row {
  position: relative;
  padding: 8px 10px; border-radius: 8px;
  background: #fff; border: 1.5px solid #e9e3fe;
  margin-bottom: 6px;
  transition: all .15s;
  box-shadow: 0 1px 3px rgba(124,58,237,.05);
}
.smd-clm-row:last-child { margin-bottom: 0; }
.smd-clm-row:hover { border-color: #7c3aed; background: #faf8ff; box-shadow: 0 3px 8px rgba(124,58,237,.15); }
.smd-clm-row-head { display: flex; align-items: center; gap: 8px; }
.smd-clm-row-icon {
  width: 22px; height: 22px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.smd-clm-row-icon-amber   { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 2px 5px rgba(245,158,11,.30); }
.smd-clm-row-icon-emerald { background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 2px 5px rgba(16,185,129,.30); }
.smd-clm-row-icon-rose    { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 2px 5px rgba(239,68,68,.30);   }
.smd-clm-row-icon-orange  { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 2px 5px rgba(245,158,11,.30); }
.smd-clm-row-text { flex: 1; min-width: 0; }
.smd-clm-row-title { font-size: 10.5px; font-weight: 700; color: #3b0764; letter-spacing: -.1px; line-height: 1.2; }
.smd-clm-row-sub   { font-size: 8.5px; color: #7c6f9a; font-weight: 600; margin-top: 1px; }
.smd-clm-row-go {
  width: 20px; height: 20px; border-radius: 6px;
  background: transparent; border: none; color: #a78bfa;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}

.smd-clm-progress {
  margin-top: 6px; height: 4px;
  background: #f5f3ff; border-radius: 999px; overflow: hidden;
}
.smd-clm-progress-fill { height: 100%; border-radius: 999px; transition: width .3s; }
.smd-clm-progress-fill-amber   { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.smd-clm-progress-fill-emerald { background: linear-gradient(90deg, #10b981, #34d399); }
.smd-clm-progress-fill-rose    { background: linear-gradient(90deg, #ef4444, #f87171); }
.smd-clm-progress-fill-orange  { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.smd-clm-progress-label { font-size: 8.5px; font-weight: 700; color: #7c6f9a; text-align: right; margin-top: 3px; }

/* Clickable rows (Customer / Consignee deep-link to Evidence Vault) — pointer + lift */
.smd-clm-row-clickable { cursor: pointer; outline: none; }
.smd-clm-row-clickable:focus-visible { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.20); }
.smd-clm-row-clickable:active { transform: translateY(1px); }

/* Disabled — while any modal is open, prevent both rows from opening
 * a second modal underneath. Reduces opacity, removes pointer cursor,
 * and pulls focusability via aria-disabled (set on the row itself). */
.smd-clm-row-disabled { opacity: .55; cursor: not-allowed; pointer-events: none; }
.smd-clm-row-disabled .smd-clm-row-go { cursor: not-allowed; }

/* Loading — subtle shimmer on the sub-text only so the row layout
 * doesn't shift during the vault fetch. The 0% progress bar already
 * communicates "nothing yet." */
.smd-clm-row-loading .smd-clm-row-sub {
  color: transparent;
  background: linear-gradient(90deg, #e9e3fe 0%, #d8ceff 50%, #e9e3fe 100%);
  background-size: 200% 100%;
  animation: smd-clm-shimmer 1.4s linear infinite;
  border-radius: 4px;
  min-height: 9px;
}
@keyframes smd-clm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .smd-clm-row-loading .smd-clm-row-sub { animation: none; }
}

/* Error — soft red border + slightly tinted background, retry icon
 * already swapped in the JSX. The whole row stays clickable so the
 * onRetry handler triggers from anywhere on it. */
.smd-clm-row-error {
  border-color: #fca5a5;
  background: #fef2f2;
  box-shadow: 0 1px 3px rgba(220,38,38,.10);
}
.smd-clm-row-error .smd-clm-row-sub { color: #b91c1c; }
.smd-clm-row-error .smd-clm-row-go  { color: #b91c1c; }
.smd-clm-row-error:hover {
  border-color: #ef4444;
  background: #fee2e2;
  box-shadow: 0 3px 8px rgba(220,38,38,.18);
}

/* Empty state — only when neither customer nor consignee is mapped yet */
.smd-clm-empty {
  padding: 14px 12px; border-radius: 8px;
  background: #fbfaff; border: 1.5px dashed #ddd6fe;
  font-size: 10px; font-weight: 600; color: #7c6f9a; line-height: 1.45;
  text-align: center;
}

/* ── Deal panel ── */
.smd-deal-card { border: 1px solid #ede9fe; }
.smd-deal-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 12px 10px;
  background: linear-gradient(125deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 65%, #8b5cf6 100%);
  color: #fff;
}
.smd-deal-header::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 55%;
  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent);
  pointer-events: none;
}
.smd-deal-header::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 30%;
  background: linear-gradient(0deg, rgba(0,0,0,.10), transparent);
  pointer-events: none;
}
.smd-deal-header-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 11px; min-width: 0; }
.smd-deal-header-icon {
  width: 34px; height: 34px; border-radius: 11px;
  background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.10));
  border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.20);
  flex-shrink: 0;
}
.smd-deal-title { font-size: 11px; font-weight: 900; letter-spacing: -.3px; line-height: 1.2; }
.smd-deal-sub   { font-size: 7px; color: rgba(255,255,255,.65); font-weight: 600; letter-spacing: .07em; margin-top: 2px; }
/* Green status dot in the card header sub-lines (Deal + CLM), replacing the literal ●. */
.smd-deal-dot, .smd-clm-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34,197,94,.25);
  margin-right: 6px; vertical-align: middle;
}

/* Tab strip — lavender pill container */
.smd-deal-tabs {
  display: flex; gap: 3px;
  margin: 8px 8px 0;
  padding: 3px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  border-radius: 10px;
  border-bottom: none;
  box-shadow: inset 0 1px 4px rgba(124,58,237,.07);
}
.smd-deal-tab {
  position: relative; flex: 1;
  padding: 5px 3px; border-radius: 7px;
  background: transparent; border: none;
  font-family: inherit;
  font-size: 9px; font-weight: 700; color: #c4b5fd;
  cursor: pointer; transition: all .18s;
  white-space: nowrap;
}
.smd-deal-tab-active {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 2px 6px rgba(124,58,237,.38);
}
.smd-deal-tab:disabled { opacity: .65; cursor: not-allowed; }
.smd-deal-tab-soon {
  position: absolute; top: -5px; right: 1px;
  font-size: 5px; font-weight: 800; letter-spacing: .05em;
  padding: 1px 3px;
  background: #ede9fe; color: #a78bfa;
  border: 1px solid #c4b5fd; border-radius: 20px;
  text-transform: uppercase;
}

/* flex:1 lets the form fill the right card's height so the Save button
   (margin-top:auto below) drops to the bottom edge, lining up with the
   middle card's Save & Next footer button. */
.smd-deal-form { padding: 10px 10px 12px; display: flex; flex-direction: column; gap: 8px; flex: 1 1 auto; }
.smd-deal-row  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.smd-field     { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.smd-field-label { font-size: 8px; font-weight: 800; letter-spacing: .1em; color: #8b7fc8; text-transform: uppercase; }
.smd-input {
  width: 100%; padding: 7px 10px;
  border: 1.5px solid #e0d9ff; border-radius: 8px;
  background: #faf8ff; font-size: 11px; font-weight: 600; color: #3b0764;
  font-family: inherit;
  transition: border-color .15s, background .15s;
  min-width: 0; outline: none;
}
.smd-input::placeholder { color: #c4b5fd; font-weight: 400; }
.smd-input:focus { border-color: #7c3aed; background: #fff; }
.smd-input-file {
  text-align: left; cursor: pointer; color: #7c3aed;
  background: #faf8ff; border: 1.5px solid #e0d9ff;
  display: flex; align-items: center; gap: 5px;
}
.smd-input-file:hover { border-color: #7c3aed; background: #f0eeff; }
.smd-req       { color: #ef4444; }
.smd-deal-section-label {
  display: flex; align-items: center; gap: 10px;
  font-size: 8px; font-weight: 800; letter-spacing: .1em; color: #a78bfa;
  text-align: center; padding: 2px 0; margin: 6px 0 2px;
  text-transform: uppercase;
  /* Centered divider label with hairlines on each side (Figma) — not a
     filled bar. Same row height as before so the column doesn't shift. */
  background: none; border-radius: 0; white-space: nowrap;
}
.smd-deal-section-label::before,
.smd-deal-section-label::after {
  content: ''; flex: 1; height: 1px; background: #ddd6fe;
}
.smd-deal-save-wrap { display: flex; justify-content: center; margin-top: auto; padding-top: 8px; }
.smd-deal-save-btn {
  min-width: 150px;
  padding: 8px 32px; border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff; font-weight: 800; font-size: 12px;
  border: none; cursor: pointer;
  font-family: inherit;
  box-shadow: 0 3px 10px rgba(124,58,237,.35);
  transition: all .17s;
}
.smd-deal-save-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(124,58,237,.45); }
/* Right-card (Task Manager) inputs — match the prototype's lavender fill
   (#f5f3ff / #c4b5fd border / #5b21b6 text, focus → #ede9fe). Scoped to
   the deal form so the middle stage-card inputs keep their own styling. */
.smd-deal-form .smd-input {
  background: #f5f3ff;
  border-color: #c4b5fd;
  color: #5b21b6;
}
.smd-deal-form .smd-input::placeholder { color: #a78bfa; }
.smd-deal-form .smd-input:focus {
  border-color: #7c3aed;
  background: #ede9fe;
}
/* Buying Plan date picker — give its trigger the same fill/border/height
   as the text inputs above. Scoped to the deal form so the shared
   MasterDatePicker keeps its own styling everywhere else. */
.smd-deal-form .master-datepicker-toggle {
  background: #f5f3ff;
  border: 1.5px solid #c4b5fd;
  border-radius: 8px;
  color: #5b21b6;
  padding: 5px 10px;
}
.smd-deal-form .master-datepicker-toggle.open {
  border-color: #7c3aed;
  background: #ede9fe;
}
.smd-deal-form .master-datepicker-placeholder { color: #a78bfa; }

/* ── Stage card (middle column shell) — 4px rainbow accent on top ── */
.smd-stage-card {
  position: relative;
  /* No content-driven min-height here: the stage content lives in the
     absolutely-positioned .smd-stg-scroll (out of flow), so the card takes
     the shared viewport min-height as a floor and otherwise stretches to
     the side panels' row height. */
  border: 1.5px solid #c4b5fd;
}
.smd-stage-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: linear-gradient(90deg, #7c3aed, #a78bfa, #c4b5fd, #7c3aed);
  border-radius: 14px 14px 0 0;
  z-index: 2;
}
/* Internal scroll container for the stage content. Positioned ABSOLUTE so
   it's out of flow: the stage card therefore contributes zero intrinsic
   height to the grid row, which is then driven solely by the side panels.
   align-items:stretch stretches the (empty-flow) card to that row height,
   and this container fills it (inset:0) and scrolls its own overflow. Net
   effect: the centre always equals the side panels' height — whether the
   LEFT is tall (segments) or the CENTRE content is tall (Stage 6) — with
   tall centre content scrolling internally instead of growing the row.
   Stays a flex column so short stages fill the card the same as before. */
.smd-stg-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

/* Side widths are percentage-based now, so they scale down on their own —
   no per-breakpoint column overrides needed until the layout stacks. */
@media (max-width: 1280px) {
  .smd-stepper-card { padding: 8px 10px; }
  .smd-toolbar { padding: 8px 10px; }
}
@media (max-width: 1100px) {
  /* Stack the three panels into a single grid column; each takes its
     content height (the viewport min-height only applies to the
     side-by-side desktop view, and the centre no longer needs an
     internal scroll once stacked). */
  .smd-body,
  .smd-body-clm-collapsed,
  .smd-body-deal-collapsed,
  .smd-body-clm-collapsed.smd-body-deal-collapsed { grid-template-columns: 1fr; }
  .smd-clm-card, .smd-stage-card, .smd-deal-card { min-height: auto; }
  /* Back to in-flow on mobile so the stacked stage card grows with its
     content instead of collapsing to the absolute container's zero box. */
  .smd-stg-scroll { position: static; inset: auto; overflow: visible; }
  .smd-stepper { grid-template-columns: repeat(3,1fr); gap: 4px; }
  .smd-step { margin-right: 0; }
  .smd-step, .smd-step:first-child, .smd-step:last-child {
    clip-path: none; border-radius: 10px; border: 1px solid #e5e7eb; padding: 8px 12px;
  }
}

/* Phones (QA #69): the opportunity header + 6-stage stepper overflowed /
   overlapped because the header meta row was flex-nowrap (forcing horizontal
   scroll) and the stepper stayed at 3 cramped columns. Stack the header and
   let its meta wrap; drop the stepper to 2 columns. */
@media (max-width: 640px) {
  .smd-cust-banner {
    flex-direction: column; align-items: stretch;
    min-height: auto; padding: 12px 14px 12px 18px; gap: 10px;
  }
  .smd-cust-left { padding-left: 0; }
  .smd-cust-name { white-space: normal; overflow-wrap: anywhere; }
  /* Meta wraps onto multiple lines instead of scrolling off-screen; the
     decorative single-line dividers are hidden once items wrap. */
  .smd-cust-meta { flex-wrap: wrap; justify-content: flex-start; gap: 8px 12px; width: 100%; }
  .smd-cust-sep, .smd-cust-line { display: none; }
  .smd-back-btn { margin-left: auto; }

  /* 2 columns × 3 rows fits a phone cleanly; 3 columns squeezed the labels. */
  .smd-stepper { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .smd-stepper-card { padding: 8px; }
  .smd-step, .smd-step:first-child, .smd-step:last-child { padding: 7px 9px; }
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
  background: linear-gradient(110deg, #1a1538 0%, #20184a 25%, #2a1e5c 55%, #3b2f6e 85%, #4c1d95 100%);
  border-color: rgba(167, 139, 250, .25);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, .04),
    0 8px 28px rgba(0, 0, 0, .45),
    0 2px 8px rgba(0, 0, 0, .25);
}
/* Tone down the bright sheen/glow overlays for dark mode. */
[data-bs-theme="dark"] .smd-root .smd-cust-sheen {
  background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent);
}
[data-bs-theme="dark"] .smd-root .smd-cust-glow {
  background:
    radial-gradient(ellipse at 10% 50%, rgba(124, 58, 237, .25) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(91, 33, 182, .18) 0%, transparent 55%);
}
[data-bs-theme="dark"] .smd-root .smd-cust-name { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-cust-tag {
  background: rgba(20, 16, 42, .55);
  border-color: rgba(167, 139, 250, .35);
}
[data-bs-theme="dark"] .smd-root .smd-cust-tag-dot  { background: #a78bfa; }
[data-bs-theme="dark"] .smd-root .smd-cust-tag-text { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-cust-avatar-dot { border-color: #1a1538; }
[data-bs-theme="dark"] .smd-root .smd-cust-sep i { background: rgba(196, 181, 253, .35); }
[data-bs-theme="dark"] .smd-root .smd-cust-line {
  background: linear-gradient(to bottom, transparent, rgba(196, 181, 253, .35) 40%, rgba(196, 181, 253, .35) 60%, transparent);
}
/* Glass pills — dark translucent surface with violet inset. */
[data-bs-theme="dark"] .smd-root .smd-meta {
  background: rgba(20, 16, 42, .55);
  border-color: rgba(167, 139, 250, .30);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, .30),
    inset 0 1px 0 rgba(255, 255, 255, .05);
}
[data-bs-theme="dark"] .smd-root .smd-meta-icon {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
}
[data-bs-theme="dark"] .smd-root .smd-meta-label { color: #a78bfa; }
[data-bs-theme="dark"] .smd-root .smd-meta-value { color: #ede9fe; }

/* ─── Stepper card + STEP cards ─── */
[data-bs-theme="dark"] .smd-root .smd-stepper-card {
  background: #14102a;
  border-color: rgba(167, 139, 250, .22);
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}

/* ─── UPCOMING (idle) — dark slate violet card with readable content ─── */
[data-bs-theme="dark"] .smd-root .smd-step-idle {
  background: linear-gradient(150deg, #1f1845 0%, #2a2150 100%);
  border: 1.5px solid rgba(167, 139, 250, .30);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, .30),
    inset 0 1px 0 rgba(255, 255, 255, .05);
}
[data-bs-theme="dark"] .smd-root .smd-step-idle:hover {
  border-color: rgba(167, 139, 250, .45);
  background: linear-gradient(150deg, #251b50 0%, #30255c 100%);
}
[data-bs-theme="dark"] .smd-root .smd-step-idle::after {
  background: rgba(167, 139, 250, .45);
  opacity: 1;
}
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-num   { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-big   { color: rgba(196, 181, 253, .75); }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-sub   { color: rgba(196, 181, 253, .70); }
[data-bs-theme="dark"] .smd-root .smd-step-idle .smd-step-ghost { color: rgba(167, 139, 250, .12); }

/* ─── DONE — deep emerald wash with dark border ─── */
[data-bs-theme="dark"] .smd-root .smd-step-done {
  background: linear-gradient(135deg, rgba(16,185,129,.28) 0%, rgba(16,185,129,.14) 100%);
  border: 1.5px solid rgba(110, 231, 183, .30);
  box-shadow:
    0 2px 10px rgba(16, 185, 129, .20),
    inset 0 1px 0 rgba(255, 255, 255, .05);
}
[data-bs-theme="dark"] .smd-root .smd-step-done::after {
  background: rgba(16, 185, 129, .55);
  opacity: 1;
}
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-num   { color: #a7f3d0; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-big   { color: #d1fae5; background: none; -webkit-text-fill-color: #d1fae5; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-sub   { color: #a7f3d0; }
[data-bs-theme="dark"] .smd-root .smd-step-done .smd-step-ghost { color: rgba(16,185,129,.12); }
[data-bs-theme="dark"] .smd-root .smd-step-badge-done {
  background: rgba(16, 185, 129, .22);
  border-color: rgba(16, 185, 129, .35);
}
[data-bs-theme="dark"] .smd-root .smd-step-badge-done .smd-step-badge-text,
[data-bs-theme="dark"] .smd-root .smd-step-badge-done svg { color: #d1fae5; }

/* ─── ACTIVE — vivid violet gradient (matches the 3-stop light-mode design) ─── */
[data-bs-theme="dark"] .smd-root .smd-step-active {
  background: linear-gradient(150deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  border: 1.5px solid #6d28d9;
  box-shadow:
    0 8px 28px rgba(124, 58, 237, .55),
    inset 0 1px 0 rgba(255, 255, 255, .15);
}
[data-bs-theme="dark"] .smd-root .smd-step-active::after { background: #9b72f5; opacity: .65; }
[data-bs-theme="dark"] .smd-root .smd-step-active .smd-step-ghost { color: rgba(255, 255, 255, .12); }
[data-bs-theme="dark"] .smd-root .smd-step-badge-active {
  background: rgba(255, 255, 255, .15);
  border-color: rgba(255, 255, 255, .30);
}

/* Divider between stepper and toolbar — keep visible against dark surface. */
[data-bs-theme="dark"] .smd-root .smd-stepper-divider {
  background: linear-gradient(90deg, transparent, rgba(167, 139, 250, .30) 20%, rgba(167, 139, 250, .30) 80%, transparent);
}

/* ─── Action toolbar — transparent (sits inside the stepper card) ─── */
[data-bs-theme="dark"] .smd-root .smd-toolbar {
  background: transparent;
  border-top: none;
  box-shadow: none;
}
[data-bs-theme="dark"] .smd-root .smd-toolbar::-webkit-scrollbar-thumb {
  background: rgba(167, 139, 250, .35);
}
[data-bs-theme="dark"] .smd-root .smd-act-sep {
  background: linear-gradient(to bottom, transparent, rgba(167, 139, 250, .30), transparent);
}
[data-bs-theme="dark"] .smd-root .smd-act {
  background: linear-gradient(135deg, #1f1845, #2a2150);
  border-color: rgba(167, 139, 250, .30);
  color: #d8b4fe;
  box-shadow:
    0 2px 7px rgba(0, 0, 0, .30),
    inset 0 1px 0 rgba(255, 255, 255, .05);
}
[data-bs-theme="dark"] .smd-root .smd-act-icon { color: #a78bfa; }
[data-bs-theme="dark"] .smd-root .smd-act:not(.smd-act-locked):hover {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: #6d28d9;
  color: #fff;
  box-shadow: 0 5px 14px rgba(124, 58, 237, .40);
}
[data-bs-theme="dark"] .smd-root .smd-act:not(.smd-act-locked):hover .smd-act-icon,
[data-bs-theme="dark"] .smd-root .smd-act:not(.smd-act-locked):hover .smd-act-trail { color: #fff; }
/* Header WhatsApp pill — keep the green wash in dark mode but soften
   the glow so it doesn't blow out against the darker banner. */
[data-bs-theme="dark"] .smd-root .smd-hdr-wa {
  background: linear-gradient(135deg, #16a34a 0%, #15803d 55%, #14532d 100%);
  box-shadow: 0 3px 12px rgba(22, 163, 74, .45), inset 0 1px 0 rgba(255, 255, 255, .12);
}
[data-bs-theme="dark"] .smd-root .smd-hdr-wa-on {
  background: linear-gradient(135deg, #15803d 0%, #166534 55%, #14532d 100%);
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
/* Inner divider between the group head and its rows + the empty-state
 * card. Without these the dashed empty-state stayed near-white with
 * pale violet text — a bright island inside the dark CLM panel. */
[data-bs-theme="dark"] .smd-root .smd-clm-group-head {
  border-bottom-color: rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .smd-root .smd-clm-empty {
  background: rgba(15, 12, 38, .55);
  border-color: rgba(167, 139, 250, .30);
  color: #c4b5fd;
}

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
/* Tab strip — was light lavender pill in light mode; needs dark wash here. */
[data-bs-theme="dark"] .smd-root .smd-deal-tabs {
  background: linear-gradient(135deg, #1f1845, #2a2150);
  border-bottom-color: rgba(167, 139, 250, .22);
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .smd-root .smd-deal-tab { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .smd-root .smd-deal-tab-active {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 2px 8px rgba(124, 58, 237, .50);
}
[data-bs-theme="dark"] .smd-root .smd-deal-tab.on {
  color: #ede9fe; border-bottom-color: #a78bfa;
}
[data-bs-theme="dark"] .smd-root .smd-deal-tab-soon {
  background: rgba(167, 139, 250, .14);
  border-color: rgba(167, 139, 250, .35);
  color: #a78bfa;
}

/* PURCHASE DECISION MAKER divider — was lavender pill bleeding light. */
[data-bs-theme="dark"] .smd-root .smd-deal-section-label {
  background: none;
  color: #a78bfa;
}
[data-bs-theme="dark"] .smd-root .smd-deal-section-label::before,
[data-bs-theme="dark"] .smd-root .smd-deal-section-label::after {
  background: rgba(167,139,250,.30);
}

/* Attach File button — uses .smd-input + .smd-input-file but it's a
 * <button>, so the input-targeted dark overrides above don't catch it. */
[data-bs-theme="dark"] .smd-root .smd-input-file {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .smd-root .smd-input-file:hover {
  background: #2a2150;
  border-color: #a78bfa;
  color: #ede9fe;
}
[data-bs-theme="dark"] .smd-root .smd-input-file svg { color: currentColor; }
[data-bs-theme="dark"] .smd-root .smd-deal-section-title { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-deal-label { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-root .smd-deal-input,
[data-bs-theme="dark"] .smd-root .smd-deal-card input,
[data-bs-theme="dark"] .smd-root .smd-deal-card select,
[data-bs-theme="dark"] .smd-root .smd-deal-card textarea,
/* The Buying Plan date picker's toggle is a <div>, not an <input>, so it
   was missed by the rule above and rendered white. Match it to the other
   deal-panel inputs. */
[data-bs-theme="dark"] .smd-root .smd-deal-card .master-datepicker-toggle {
  background: #2a2150 !important;
  border-color: rgba(167, 139, 250, .30) !important;
  color: #ede9fe !important;
}
[data-bs-theme="dark"] .smd-root .smd-deal-card .master-datepicker-value { color: #ede9fe !important; }
[data-bs-theme="dark"] .smd-root .smd-deal-card .master-datepicker-placeholder { color: rgba(196,181,253,.55) !important; }
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
