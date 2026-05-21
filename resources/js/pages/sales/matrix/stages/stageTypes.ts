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
`;
