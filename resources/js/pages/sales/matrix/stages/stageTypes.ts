import type { OppHeaderData, StageNum } from '../SalesMatrixDetail';

export type StageProps = {
  header: OppHeaderData;
  stage:  StageNum;
  onPrev: () => void;
  onNext: () => void;
};

/* Shared stage shell styles — each stage imports SHARED_STAGE_CSS once. */
export const SHARED_STAGE_CSS = `
.smd-stg-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
}
.smd-stg-head-left { display: flex; align-items: center; gap: 11px; }
.smd-stg-head-icon {
  width: 30px; height: 30px; border-radius: 10px;
  background: rgba(255,255,255,.2);
  display: flex; align-items: center; justify-content: center;
}
.smd-stg-head-title { font-size: 14.5px; font-weight: 800; line-height: 1.2; }
.smd-stg-head-sub   { font-size: 10.5px; opacity: .85; margin-top: 1px; }
.smd-stg-head-badge {
  font-size: 9.5px; font-weight: 800; letter-spacing: .08em;
  padding: 4px 10px; border-radius: 20px;
  background: rgba(255,255,255,.22); color: #fff;
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

/* Generic stage section cards */
.smd-sect {
  background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 12px;
}
.smd-sect-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.smd-sect-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  display: flex; align-items: center; justify-content: center;
}
.smd-sect-title { font-size: 13px; font-weight: 700; color: #4c1d95; }
.smd-sect-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.smd-sect-field { display: flex; flex-direction: column; gap: 3px; }
.smd-sect-label { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #94a3b8; text-transform: uppercase; }
.smd-sect-value { font-size: 13px; font-weight: 700; color: #1e293b; }
.smd-sect-value-muted { font-size: 13px; color: #cbd5e1; }

/* ═══════════════════════════════════════════════════════════════════
   Dark mode — every stage component (Stage1..Stage6) renders these
   .smd-stg-* / .smd-sect-* classes inside the middle "stage-card"
   surface of SalesMatrixDetail. Tints flip against the deep-slate
   page surface so the content isn't a bright white box on dark.
   ═══════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .smd-stg-head,
[data-layout-mode="dark"] .smd-stg-head {
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
  color: #fff;
}
[data-bs-theme="dark"] .smd-stg-head-icon,
[data-layout-mode="dark"] .smd-stg-head-icon { background: rgba(255,255,255,.18); }
[data-bs-theme="dark"] .smd-stg-head-badge,
[data-layout-mode="dark"] .smd-stg-head-badge {
  background: rgba(74, 222, 128, .22);
  color: #bbf7d0;
  border: 1px solid rgba(74, 222, 128, .35);
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
