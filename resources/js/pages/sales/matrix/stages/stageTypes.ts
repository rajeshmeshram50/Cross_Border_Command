import type { OppHeaderData, StageNum } from '../SalesMatrixDetail';

export type StageProps = {
  header: OppHeaderData;
  stage:  StageNum;
  onPrev: () => void;
  onNext: () => void;
  /* Tells the parent to re-fetch the lead. Stage 2 calls this after
   * saving acknowledgements so the Activity Report reflects the
   * append-only history (and the lead's qualified flag flips). */
  reloadLead?: () => void;
};

/* Shared stage shell styles — each stage imports SHARED_STAGE_CSS once. */
export const SHARED_STAGE_CSS = `
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
.smd-stg-head-title { font-size: 13.5px; font-weight: 900; line-height: 1.2; color: #3b0764; letter-spacing: -.3px; }
.smd-stg-head-sub   { font-size: 10px; color: #6d28d9; margin-top: 2px; font-weight: 600; letter-spacing: .04em; }
.smd-stg-head-badge {
  position: relative; z-index: 1;
  font-size: 9.5px; font-weight: 800; letter-spacing: .08em;
  padding: 4px 12px; border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  border: none;
  box-shadow: 0 2px 8px rgba(124,58,237,.30);
  display: inline-flex; align-items: center; gap: 5px;
}

.smd-stg-body { padding: 14px 16px; flex: 1; }
.smd-stg-note {
  margin: 8px 16px 12px; padding: 9px 14px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
  font-size: 11.5px; color: #92400e;
  display: flex; align-items: center; gap: 8px;
}
.smd-stg-note::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%;
  background: #f59e0b; flex-shrink: 0;
}
.smd-stg-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid #f1f5f9;
}
.smd-stg-foot-note {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: #92400e;
  padding: 6px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
}
.smd-stg-btn {
  padding: 8px 16px; border-radius: 10px; border: 1px solid #c4b5fd;
  background: #fff; color: #6d28d9; font-weight: 700; font-size: 12px;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
}
.smd-stg-btn:hover { background: #f5f3ff; }
.smd-stg-btn-primary {
  background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff;
  border: none; box-shadow: 0 4px 14px rgba(124,58,237,.3);
}
.smd-stg-btn-primary:hover { transform: translateY(-1px); background: linear-gradient(135deg,#6d28d9,#5b21b6); }
.smd-stg-btn-row { display: flex; gap: 8px; }

/* Generic stage section cards — table-like layout: outer rounded card
 * with a plain-title header strip, and a grid of cells where each row
 * shares an alternating lavender tint so the data reads as a striped
 * table. Cell borders are subtle dotted-purple to mimic a data grid. */
.smd-sect {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  padding: 0; margin-bottom: 14px; overflow: hidden;
}
.smd-sect-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: #fff;
}
.smd-sect-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  display: flex; align-items: center; justify-content: center;
}
.smd-sect-title { font-size: 13px; font-weight: 800; color: #1e1b4b; }
.smd-sect-grid  {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0;
  border-top: 1px solid #ede9fe;
}
.smd-sect-field {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px;
  background: #f5f3ff;
  border-right: 1px solid #ede9fe;
  border-bottom: 1px solid #ede9fe;
}
.smd-sect-field:nth-child(2n) { border-right: none; }
/* Alternate the row-tint every other 2-cell pair so the striping reads
 * as table rows rather than columns. */
.smd-sect-field:nth-child(4n+3),
.smd-sect-field:nth-child(4n+4) { background: #faf5ff; }
.smd-sect-label { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #7c3aed; text-transform: uppercase; }
.smd-sect-value { font-size: 13px; font-weight: 700; color: #1e1b4b; }
.smd-sect-value-muted { font-size: 13px; color: #a78bfa; font-weight: 600; }

/* ═══════════════════════════════════════════════════════════════════
   Dark mode — every stage component (Stage1..Stage6) renders these
   .smd-stg-* / .smd-sect-* classes inside the middle "stage-card"
   surface of SalesMatrixDetail. Tints flip against the deep-slate
   page surface so the content isn't a bright white box on dark.
   ═══════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .smd-stg-head,
[data-layout-mode="dark"] .smd-stg-head {
  background: linear-gradient(135deg, rgba(124,58,237,.22) 0%, rgba(91,33,182,.32) 100%);
  color: #ede9fe;
  border-bottom: 1px solid rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .smd-stg-head-title,
[data-layout-mode="dark"] .smd-stg-head-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-stg-head-sub,
[data-layout-mode="dark"] .smd-stg-head-sub   { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-stg-head-icon,
[data-layout-mode="dark"] .smd-stg-head-icon { background: linear-gradient(135deg,#7c3aed,#6d28d9); }
[data-bs-theme="dark"] .smd-stg-head-badge,
[data-layout-mode="dark"] .smd-stg-head-badge {
  background: #4c1d95;
  color: #fff;
  border: 1px solid rgba(167,139,250,.35);
}

[data-bs-theme="dark"] .smd-stg-body,
[data-layout-mode="dark"] .smd-stg-body {
  background: #14102a;
  color: #cbd5e1;
}
[data-bs-theme="dark"] .smd-stg-note,
[data-layout-mode="dark"] .smd-stg-note {
  background: rgba(245, 158, 11, .12);
  border-color: rgba(245, 158, 11, .35);
  color: #fbbf24;
}
[data-bs-theme="dark"] .smd-stg-foot,
[data-layout-mode="dark"] .smd-stg-foot {
  background: #1a1538;
  border-top: 1px solid rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .smd-stg-foot-note,
[data-layout-mode="dark"] .smd-stg-foot-note {
  background: rgba(245, 158, 11, .12);
  border: 1px solid rgba(245, 158, 11, .35);
  color: #fbbf24;
}
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
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  border-color: transparent;
}
[data-bs-theme="dark"] .smd-stg-btn-primary:hover,
[data-layout-mode="dark"] .smd-stg-btn-primary:hover {
  background: linear-gradient(135deg, #6d28d9, #5b21b6);
}

/* Section cards (Opportunity Details, Purchase Decision Maker, ...) */
[data-bs-theme="dark"] .smd-sect,
[data-layout-mode="dark"] .smd-sect {
  background: #1a1538;
  border-color: rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .smd-sect-head,
[data-layout-mode="dark"] .smd-sect-head { background: #1a1538; }
[data-bs-theme="dark"] .smd-sect-grid,
[data-layout-mode="dark"] .smd-sect-grid { border-top-color: rgba(167, 139, 250, .18); }
[data-bs-theme="dark"] .smd-sect-field,
[data-layout-mode="dark"] .smd-sect-field {
  background: rgba(124, 58, 237, .08);
  border-right-color: rgba(167, 139, 250, .18);
  border-bottom-color: rgba(167, 139, 250, .18);
}
[data-bs-theme="dark"] .smd-sect-field:nth-child(4n+3),
[data-bs-theme="dark"] .smd-sect-field:nth-child(4n+4),
[data-layout-mode="dark"] .smd-sect-field:nth-child(4n+3),
[data-layout-mode="dark"] .smd-sect-field:nth-child(4n+4) {
  background: rgba(124, 58, 237, .14);
}
[data-bs-theme="dark"] .smd-sect-icon,
[data-layout-mode="dark"] .smd-sect-icon {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
}
[data-bs-theme="dark"] .smd-sect-title,
[data-layout-mode="dark"] .smd-sect-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-sect-label,
[data-layout-mode="dark"] .smd-sect-label { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-sect-value,
[data-layout-mode="dark"] .smd-sect-value { color: #ede9fe; }
[data-bs-theme="dark"] .smd-sect-value-muted,
[data-layout-mode="dark"] .smd-sect-value-muted { color: #94a3b8; }
`;
