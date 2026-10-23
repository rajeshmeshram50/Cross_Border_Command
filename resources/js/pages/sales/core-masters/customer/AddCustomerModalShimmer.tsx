import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Shimmer } from '../../../../components/ui/Shimmer';

// Kept out of the AddCustomerModal chunk so the list page can show the form skeleton while that chunk downloads.
export const ACM_SHELL_CSS = `
.acm-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(40, 44, 52, .42);
  -webkit-backdrop-filter: blur(7px) saturate(118%);
          backdrop-filter: blur(7px) saturate(118%);
  font-family: var(--font-sans);
  animation: acmFadeIn .25s ease;
}
@keyframes acmFadeIn { from { opacity: 0; } to { opacity: 1; } }
.acm-root *, .acm-root *::before, .acm-root *::after { box-sizing: border-box; }
.acm-card {
  width: 100%; max-width: 1224px;
  height: min(92vh, calc(100vh - 24px));
  background:
    radial-gradient(ellipse at 12% 0%, rgba(196,181,253,.25), transparent 45%),
    radial-gradient(ellipse at 100% 8%, rgba(167,139,250,.22), transparent 50%),
    linear-gradient(180deg, #fbf9ff 0%, #f5f1fe 55%, #efe9fd 100%);
  border: 1.5px solid rgba(255, 255, 255, .65);
  border-radius: 22px;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
  overflow: hidden; display: flex; flex-direction: column;
  position: relative;
  animation: acmSlideUp .35s cubic-bezier(.34,1.56,.64,1);
}
.acm-header {
  position: relative;
  background: linear-gradient(115deg, #4c1d95 0%, #5b21b6 28%, #6d28d9 55%, #7c3aed 80%, #8b5cf6 100%);
  padding: 14px 22px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, .22);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .35);
  overflow: hidden;
  flex-shrink: 0;
}
.acm-header::before {
  content: ''; position: absolute; inset: 0; opacity: .5; pointer-events: none;
  background-image:
    radial-gradient(circle at 18% 120%, rgba(255,255,255,.18), transparent 42%),
    radial-gradient(circle at 88% -30%, rgba(216,180,254,.4), transparent 45%);
}
.acm-header::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.16), transparent);
}
.acm-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; position: relative; z-index: 1; }
.acm-header-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.25);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -0.4px; line-height: 1.1; text-shadow: 0 1px 3px rgba(0,0,0,.18); }
.acm-subtitle { font-size: 11.5px; font-weight: 500; color: rgba(255,255,255,.85); margin-top: 3px; }
.acm-top-progress {
  position: relative; height: 3px;
  background: rgba(124,58,237,.10);
  overflow: hidden; flex-shrink: 0;
}
.acm-top-progress > span {
  position: absolute; top: 0; bottom: 0; left: 0; width: 30%;
  background: linear-gradient(90deg, transparent, #7c3aed 30%, #a855f7 70%, transparent);
  border-radius: 2px;
  animation: acmTopSlide 1.1s cubic-bezier(.4,0,.2,1) infinite;
}
@keyframes acmTopSlide {
  0%   { left: -35%; }
  100% { left: 100%; }
}
.acm-stepper { padding: 14px 18px 2px; display: flex; align-items: stretch; gap: 0; flex-shrink: 0; background: transparent; }
.acm-step-connector { flex: 0 0 26px; align-self: center; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-step {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 13px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(255,255,255,.7), rgba(245,241,254,.55));
  border: 1.5px solid rgba(196,181,253,.5); border-radius: 15px;
  box-shadow: 0 1px 3px rgba(124,58,237,.05);
  position: relative; cursor: pointer;
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.acm-step-badge-wrap { position: relative; flex-shrink: 0; width: 38px; height: 38px; }
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-pending { cursor: not-allowed; }
.acm-tabs { margin: 12px 22px 0; padding: 0; display: flex; gap: 6px; flex-shrink: 0; background: transparent; border-bottom: 1.5px solid #e2d4fa; }
.acm-body { flex: 1; overflow-y: auto; scrollbar-gutter: stable; padding: 12px 22px 14px; background: transparent; scrollbar-width: thin; scrollbar-color: #ddd6fe transparent; display: flex; flex-direction: column; }
.acm-section { position: relative; background: #fff; border: 1px solid #ece4fb; border-radius: 14px; margin-bottom: 8px; overflow: hidden; }
.acm-section::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; z-index: 1;
  width: 4px; opacity: .85; pointer-events: none;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
}
.acm-section:last-child { margin-bottom: 0; }
.acm-section-head { padding: 7px 14px; background: #fff; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #f1ecfb; }
.acm-section-body { padding: 8px 14px 10px; }
.acm-row { display: grid; gap: 14px; margin-bottom: 14px; }
.acm-row:last-child { margin-bottom: 0; }
.acm-row-2 { grid-template-columns: 1fr 2fr; }
.acm-row-3 { grid-template-columns: repeat(3, 1fr); }
.acm-row-4 { grid-template-columns: repeat(4, 1fr); }
.acm-row-1 { grid-template-columns: 1fr; }
.acm-field { display: flex; flex-direction: column; min-width: 0; }

/* ── Dark mode ──
   These shell rules are the ONLY styling the skeleton has: it renders
   before the AddCustomerModal chunk arrives, so that chunk's own dark
   rules (in SCOPED_CSS) are not on the page yet. Without the block
   below the skeleton painted a white card, white body and white
   section panels in dark mode, and the .shimmer bars themselves ARE
   dark-aware (app.css switches them to #3a4256) — so the placeholders
   went dark-on-white and the modal flashed white until the form loaded.

   Values are copied from the modal's own dark rules so the skeleton and
   the real form are the same colour and the swap is invisible. The real
   modal injects SCOPED_CSS after this sheet, so there it simply
   re-states them and nothing here can override it. */
[data-bs-theme="dark"] .acm-card {
  background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%);
  border-color: rgba(167,139,250,0.20);
  box-shadow: 0 32px 80px -20px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.45);
}
[data-bs-theme="dark"] .acm-body {
  background: #0c1322;
  scrollbar-color: #4c1d95 #11182a;
}
[data-bs-theme="dark"] .acm-stepper,
[data-bs-theme="dark"] .acm-tabs {
  background: #0c1322;
  border-bottom-color: rgba(167,139,250,0.18);
}
[data-bs-theme="dark"] .acm-step-pending {
  background: rgba(40,52,70,0.75);
  border-color: rgba(167,139,250,0.18);
  opacity: 0.92;
}
[data-bs-theme="dark"] .acm-section {
  background: #1f2942;
  border-color: rgba(167,139,250,0.35);
  box-shadow: 0 6px 22px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.06);
}
[data-bs-theme="dark"] .acm-section-head {
  background: linear-gradient(110deg, rgba(124,58,237,0.22) 0%, rgba(167,139,250,0.10) 100%);
  border-bottom-color: rgba(167,139,250,0.28);
}
[data-bs-theme="dark"] .acm-top-progress { background: rgba(167,139,250,.14); }
`;

/* ───── Stepper shimmer ─────
 * Skeleton variant rendered while the edit-mode hydration GET is in
 * flight. Mirrors the 3-stage layout (icon + 2 text rows + connector)
 * so the swap to the real Stepper once data lands is structurally
 * identical — no layout shift. */
export function StepperShimmer() {
  return (
    <div className="acm-stepper acm-stepper-shimmer">
      {[0, 1].map((i) => (
        <Fragment key={i}>
          <div className="acm-step acm-step-pending" style={{ pointerEvents: 'none' }}>
            <div className="acm-step-badge-wrap">
              <Shimmer width={38} height={38} radius={12} />
            </div>
            <div className="acm-step-text" style={{ flex: 1 }}>
              <Shimmer height={11} width="70%" radius={4} style={{ marginBottom: 6 }} />
              <Shimmer height={9}  width="55%" radius={4} />
            </div>
          </div>
          {i < 1 && (
            <div className="acm-step-connector">
              <Shimmer height={2} width="100%" radius={2} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ───── Stage 1 form skeleton ─────
 * Rendered while the edit-mode hydration fetch is in flight so the
 * user sees the section + field shape immediately instead of empty
 * inputs flickering into populated state. Layout mirrors the actual
 * Stage 1 form (Basic Company Details + Primary Address & Contact). */
export function Stage1FormShimmer() {
  const FieldShim = ({ short }: { short?: boolean }) => (
    <div className="acm-field">
      <Shimmer height={10} width={short ? 110 : '40%'} radius={4} style={{ marginBottom: 5 }} />
      {short ? <Shimmer height={14} width={110} radius={4} style={{ margin: '11px 0' }} /> : <Shimmer height={36} radius={9} />}
    </div>
  );
  // `n` = fields actually in the row (Basic Company Details' 2nd row has 3 in a 4-col grid); `short` = the WhatsApp radio row.
  const Section = ({ rows }: { rows: { cols: number; n?: number; short?: boolean }[] }) => (
    <div className="acm-section acm-section-purple">
      <div className="acm-section-head">
        <Shimmer width={25} height={25} radius={8} />
        <div style={{ flex: 1, marginLeft: 10 }}>
          <Shimmer height={11} width="35%" radius={4} />
        </div>
      </div>
      <div className="acm-section-body">
        {rows.map((r, i) => (
          <div key={i} className={`acm-row acm-row-${r.cols}`}>
            {Array.from({ length: r.n ?? r.cols }).map((_, j) => <FieldShim key={j} short={r.short} />)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <Section rows={[{ cols: 4 }, { cols: 4, n: 3 }]} />
      <Section rows={[{ cols: 2 }, { cols: 3 }, { cols: 3 }, { cols: 4 }, { cols: 1, short: true }]} />
    </div>
  );
}
/** Suspense fallback: the customer form's own loading state, shown until the form chunk arrives. */
export default function AddCustomerModalShimmer({ title }: { title: string }) {
  return createPortal((
    <div className="acm-root">
      <style>{ACM_SHELL_CSS}</style>
      <div className="acm-card">
        <div className="acm-header">
          <div className="acm-header-left">
            <div className="acm-header-icon" />
            <div><div className="acm-title">{title}</div><div className="acm-subtitle">Loading…</div></div>
          </div>
        </div>
        <div className="acm-top-progress" role="progressbar" aria-label="Loading"><span /></div>
        <StepperShimmer />
        <div className="acm-tabs">
          <Shimmer height={14} width={170} radius={4} style={{ margin: '0 14px 10px' }} />
          <Shimmer height={14} width={190} radius={4} style={{ margin: '0 14px 10px' }} />
        </div>
        <div className="acm-body"><Stage1FormShimmer /></div>
      </div>
    </div>
  ), document.body);
}
