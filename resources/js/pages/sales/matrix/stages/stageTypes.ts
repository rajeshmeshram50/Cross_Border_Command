import type { OppHeaderData, StageNum } from '../SalesMatrixDetail';

export type StageProps = {
  header: OppHeaderData;
  stage:  StageNum;
  onPrev: () => void;
  onNext: () => void;
  /* Tells the parent to re-fetch the lead. Stage 2 calls this after
   * saving acknowledgements so the Activity Report reflects the
   * append-only history (and the lead's qualified flag flips).
   * Returns the in-flight promise so callers can await it before
   * reading dependent state (e.g., Stage 2's submitPicker awaits this
   * so a click on Save & Next immediately afterwards sees fresh data). */
  reloadLead?: () => Promise<unknown> | void;
  /* Stage 5 calls this whenever a Proforma Invoice is created or
   * edited. Parent (SalesMatrixDetail) wires it to bump
   * `agreementRefreshTick`, which refetches /clm/leads/{id}/agreement-
   * applicable — that endpoint's `pi` field is what unlocks the
   * Segment Details card on the left rail. Without this hook the
   * card stayed locked until the user manually clicked Save & Next
   * (the only other path that re-rendered the parent with new
   * server state). */
  onPiChange?: () => void;
  /* When the stage is rendered inside a toolbar popup (not the pipeline),
   * the "Save & Next / Previous" footer is suppressed — the popup is a
   * quick-action view, not a pipeline step. All in-table actions still
   * persist immediately, so nothing is lost by hiding the footer. */
  embedded?: boolean;
  /* Stage 5: whether either party still has incomplete Standard Documents
   * (core KYC/DD/Licence uploads). Derived by the parent from the SAME vault
   * tallies it already fetches for the left "Customer/Consignee Details"
   * cards, then passed down — so Stage 5 no longer re-fetches the vault
   * itself (the call was a duplicate of the parent's). Gates Create PI. */
  mandatoryIncomplete?: boolean;
  /* Deal lock — true once the Proforma Invoice has been e-signed. Stages
   * become read-only (Stage 5 disables Create Quotation / Create PI / convert).
   * Stage 6 ignores it so "Create Shipment" stays usable. */
  locked?: boolean;
};

/* Shared stage shell styles — each stage imports SHARED_STAGE_CSS once. */
export const SHARED_STAGE_CSS = `
/* ─── Shimmer skeleton system (re-used by every stage table) ─────── */
@keyframes smd-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
.smd-skel {
  display: inline-block;
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 800px 100%;
  animation: smd-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
  height: 14px;
  width: 100%;
  vertical-align: middle;
}
.smd-skel-pill   { height: 22px; border-radius: 999px; max-width: 70px; }
.smd-skel-chip   { height: 22px; border-radius: 7px;   max-width: 80px; }
.smd-skel-input  { height: 30px; border-radius: 8px;   max-width: 130px; }
.smd-skel-btn    { height: 30px; border-radius: 8px;   max-width: 84px; }
.smd-skel-circle { height: 26px; width: 26px; border-radius: 8px; }
.smd-skel-num    { height: 14px; max-width: 32px; }
.smd-skel-name   { height: 14px; max-width: 70%; }
.smd-skel-cell   { padding: 12px 14px; }

[data-bs-theme="dark"] .smd-skel,
[data-layout-mode="dark"] .smd-skel {
  background: linear-gradient(90deg, rgba(167,139,250,.12) 0%, rgba(167,139,250,.22) 50%, rgba(167,139,250,.12) 100%);
  background-size: 800px 100%;
}

/* ─── Smooth fade-in for tab content + cards ──────────────────────── */
@keyframes smd-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.smd-fade-in {
  animation: smd-fade-in .22s ease-out both;
}
/* Respect users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  .smd-fade-in { animation: none; }
  .smd-skel    { animation: none; background: #e2e8f0; }
  /* Keep the static fallback dark-mode aware so the loader doesn't flash
     a bright light bar over the dark table. */
  [data-bs-theme="dark"] .smd-skel,
  [data-layout-mode="dark"] .smd-skel { background: rgba(167,139,250,.18); }
}


.smd-stg-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 16px 10px;
  /* Lavender gradient header — sits between two deep-violet side panels.
   * Title is dark purple ink; the deep colour lives in the icon + ACTIVE pill. */
  background: linear-gradient(110deg, #ede9fe 0%, #ddd6fe 40%, #c4b5fd 100%);
  color: #3b0764;
  border-bottom: 1px solid #c4b5fd;
}
.smd-stg-head::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.55), transparent);
  pointer-events: none;
}
/* Radial glow accent in the upper-left of the header. */
.smd-stg-head::after {
  content: ''; position: absolute;
  top: -20px; left: 30px;
  width: 120px; height: 70px;
  background: radial-gradient(ellipse, rgba(139,92,246,.18), transparent 70%);
  pointer-events: none;
}
.smd-stg-head-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; }
.smd-stg-head-icon {
  width: 32px; height: 32px; border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 3px 10px rgba(124,58,237,.35),
    inset 0 1px 0 rgba(255,255,255,.20);
  flex-shrink: 0;
}
.smd-stg-head-title { font-size: 12px; font-weight: 900; line-height: 1.2; color: #3b0764; letter-spacing: -.3px; }
.smd-stg-head-sub   {
  font-size: 7.5px; color: #6d28d9; margin-top: 2px;
  font-weight: 600; letter-spacing: .06em;
  display: flex; align-items: center; gap: 4px;
}
/* ACTIVE pill with green pulsing dot via ::before. */
.smd-stg-head-badge {
  position: relative; z-index: 1;
  font-size: 8px; font-weight: 800; letter-spacing: .08em;
  padding: 3px 11px; border-radius: 20px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  border: none;
  box-shadow: 0 2px 8px rgba(124,58,237,.30);
  display: inline-flex; align-items: center; gap: 4px;
  text-transform: uppercase;
}
.smd-stg-head-badge::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 5px rgba(74,222,128,.8);
  animation: smd-stg-pulse 1.4s ease-in-out infinite;
  display: inline-block;
}
@keyframes smd-stg-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .5; transform: scale(.7); }
}

.smd-stg-body { padding: 12px 14px; flex: 1; overflow-y: auto; }
.smd-stg-body::-webkit-scrollbar { width: 4px; }
.smd-stg-body::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 999px; }

/* Footer — lavender-tinted strip with amber note + violet save button. */
.smd-stg-foot {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  border-top: 1.5px solid #ddd6fe;
}
.smd-stg-foot-note,
.smd-stg-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; line-height: 1.4; color: #92400e;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 4px 10px;
}
.smd-stg-foot-note strong,
.smd-stg-note strong { font-weight: 800; color: #78350f; }
.smd-stg-note { margin: 8px 16px 12px; }
.smd-stg-note::before {
  content: ''; width: 12px; height: 12px; border-radius: 50%;
  background: #f59e0b; flex-shrink: 0;
}

/* Previous (ghost) button. */
.smd-stg-btn {
  padding: 6px 13px; border-radius: 8px;
  border: 1.5px solid #c4b5fd;
  background: #fff;
  color: #7c3aed;
  font-family: inherit;
  font-weight: 700; font-size: 10px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all .18s;
  white-space: nowrap;
}
.smd-stg-btn:hover { background: #ede9fe; transform: translateY(-1px); }

/* Primary (Save & Next) button. */
.smd-stg-btn-primary {
  padding: 6px 14px; border-radius: 8px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  border: none;
  font-size: 10px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(124,58,237,.35);
}
.smd-stg-btn-primary:hover {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(124,58,237,.48);
}
.smd-stg-btn-row { display: flex; gap: 6px; flex-shrink: 0; }

/* Section block — small inline header label, then a bordered data
 * table with alternating row backgrounds. Matches the HTML reference's
 * .sec-hdr + .data-table pattern. */
.smd-sect {
  background: transparent;
  border: none;
  padding: 0;
  margin-bottom: 12px;
  overflow: visible;
}
.smd-sect-head {
  display: flex; align-items: center; gap: 6px;
  padding: 0;
  margin-bottom: 8px;
  background: transparent;
}
.smd-sect-icon {
  width: 18px; height: 18px; border-radius: 6px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.smd-sect-title { font-size: 9.5px; font-weight: 800; color: #3b0764; }
.smd-sect-grid  {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0;
  border: 1.5px solid #ddd6fe;
  border-radius: 10px;
  overflow: hidden;
}
.smd-sect-field {
  display: flex; flex-direction: column; gap: 1px;
  padding: 4px 11px;
  background: #f5f3ff;
  border-right: 1.5px solid #ddd6fe;
  border-bottom: 1.5px solid #ddd6fe;
}
/* Two-column striping: cells 3,4 of each 4-cell block are white. */
.smd-sect-field:nth-child(4n+3),
.smd-sect-field:nth-child(4n+4) { background: #fff; }
/* Remove the right border on the last cell of each row. */
.smd-sect-field:nth-child(2n)   { border-right: none; }
/* Remove the bottom border on the last visible row. */
.smd-sect-field:nth-last-child(-n+2):nth-child(2n+1),
.smd-sect-field:nth-last-child(1) { border-bottom: none; }
.smd-sect-field:nth-last-child(1):nth-child(2n+1) { border-right: none; }

.smd-sect-label {
  font-size: 7px; font-weight: 800; color: #a78bfa;
  text-transform: uppercase; letter-spacing: .10em;
  margin-bottom: 2px;
}
.smd-sect-value { font-size: 10.5px; font-weight: 700; color: #3b0764; }
.smd-sect-value-muted { font-size: 10.5px; color: #c4b5fd; font-weight: 600; }

/* ═══════════════════════════════════════════════════════════════════
   Dark mode — every stage component (Stage1..Stage6) renders these
   .smd-stg-* / .smd-sect-* classes inside the middle "stage-card"
   surface of SalesMatrixDetail. Tints flip against the deep-slate
   page surface so the content isn't a bright white box on dark.
   ═══════════════════════════════════════════════════════════════════ */
/* ─── Stage header — darker lavender gradient that mirrors light-mode ─── */
[data-bs-theme="dark"] .smd-stg-head,
[data-layout-mode="dark"] .smd-stg-head {
  background: linear-gradient(110deg, #1f1845 0%, #2a2150 40%, #3b2f6e 100%);
  color: #ede9fe;
  border-bottom: 1px solid rgba(167, 139, 250, .30);
}
[data-bs-theme="dark"] .smd-stg-head::before,
[data-layout-mode="dark"] .smd-stg-head::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, .06), transparent);
}
[data-bs-theme="dark"] .smd-stg-head::after,
[data-layout-mode="dark"] .smd-stg-head::after {
  background: radial-gradient(ellipse, rgba(167, 139, 250, .22), transparent 70%);
}
[data-bs-theme="dark"] .smd-stg-head-title,
[data-layout-mode="dark"] .smd-stg-head-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-stg-head-sub,
[data-layout-mode="dark"] .smd-stg-head-sub   { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-stg-head-icon,
[data-layout-mode="dark"] .smd-stg-head-icon  { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
[data-bs-theme="dark"] .smd-stg-head-badge,
[data-layout-mode="dark"] .smd-stg-head-badge {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  border: none;
  box-shadow: 0 2px 10px rgba(124, 58, 237, .50);
}

/* ─── Body ─── */
[data-bs-theme="dark"] .smd-stg-body,
[data-layout-mode="dark"] .smd-stg-body {
  background: #14102a;
  color: #cbd5e1;
}
[data-bs-theme="dark"] .smd-stg-body::-webkit-scrollbar-thumb,
[data-layout-mode="dark"] .smd-stg-body::-webkit-scrollbar-thumb {
  background: rgba(167, 139, 250, .35);
}

/* ─── Section block — section card stays transparent, data-table gets dark borders ─── */
[data-bs-theme="dark"] .smd-sect,
[data-layout-mode="dark"] .smd-sect {
  background: transparent;
  border: none;
}
[data-bs-theme="dark"] .smd-sect-head,
[data-layout-mode="dark"] .smd-sect-head { background: transparent; }
[data-bs-theme="dark"] .smd-sect-icon,
[data-layout-mode="dark"] .smd-sect-icon {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  box-shadow: 0 2px 6px rgba(124, 58, 237, .45);
}
[data-bs-theme="dark"] .smd-sect-title,
[data-layout-mode="dark"] .smd-sect-title { color: #ede9fe; }

[data-bs-theme="dark"] .smd-sect-grid,
[data-layout-mode="dark"] .smd-sect-grid {
  border: 1.5px solid rgba(167, 139, 250, .25);
  border-top: 1.5px solid rgba(167, 139, 250, .25);
  background: transparent;
}
[data-bs-theme="dark"] .smd-sect-field,
[data-layout-mode="dark"] .smd-sect-field {
  background: rgba(124, 58, 237, .08);
  border-right-color: rgba(167, 139, 250, .20);
  border-bottom-color: rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .smd-sect-field:nth-child(4n+3),
[data-bs-theme="dark"] .smd-sect-field:nth-child(4n+4),
[data-layout-mode="dark"] .smd-sect-field:nth-child(4n+3),
[data-layout-mode="dark"] .smd-sect-field:nth-child(4n+4) {
  background: rgba(124, 58, 237, .14);
}
[data-bs-theme="dark"] .smd-sect-label,
[data-layout-mode="dark"] .smd-sect-label { color: #a78bfa; }
[data-bs-theme="dark"] .smd-sect-value,
[data-layout-mode="dark"] .smd-sect-value { color: #ede9fe; }
[data-bs-theme="dark"] .smd-sect-value-muted,
[data-layout-mode="dark"] .smd-sect-value-muted { color: rgba(196, 181, 253, .55); }

/* ─── Footer — dark lavender wash, amber note pill, violet buttons ─── */
[data-bs-theme="dark"] .smd-stg-foot,
[data-layout-mode="dark"] .smd-stg-foot {
  background: linear-gradient(135deg, #1f1845, #2a2150);
  border-top: 1.5px solid rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .smd-stg-note,
[data-bs-theme="dark"] .smd-stg-foot-note,
[data-layout-mode="dark"] .smd-stg-note,
[data-layout-mode="dark"] .smd-stg-foot-note {
  background: linear-gradient(135deg, rgba(245, 158, 11, .12), rgba(245, 158, 11, .18));
  border: 1px solid rgba(245, 158, 11, .35);
  color: #fbbf24;
}
[data-bs-theme="dark"] .smd-stg-note strong,
[data-bs-theme="dark"] .smd-stg-foot-note strong,
[data-layout-mode="dark"] .smd-stg-note strong,
[data-layout-mode="dark"] .smd-stg-foot-note strong { color: #fde68a; }
[data-bs-theme="dark"] .smd-stg-btn,
[data-layout-mode="dark"] .smd-stg-btn {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .35);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .smd-stg-btn:hover,
[data-layout-mode="dark"] .smd-stg-btn:hover {
  background: #2a2150;
  border-color: #a78bfa;
}
[data-bs-theme="dark"] .smd-stg-btn-primary,
[data-layout-mode="dark"] .smd-stg-btn-primary {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 3px 10px rgba(124, 58, 237, .50);
}
[data-bs-theme="dark"] .smd-stg-btn-primary:hover,
[data-layout-mode="dark"] .smd-stg-btn-primary:hover {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  box-shadow: 0 5px 14px rgba(124, 58, 237, .60);
}
`;
