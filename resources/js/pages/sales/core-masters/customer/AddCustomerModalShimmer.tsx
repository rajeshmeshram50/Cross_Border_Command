import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Shimmer } from '../../../../components/ui/Shimmer';

// Kept out of the AddCustomerModal chunk so the list page can show the form skeleton while that chunk downloads.
export const ACM_SHELL_CSS = `
.acm-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.55);
  -webkit-backdrop-filter: blur(4px);
          backdrop-filter: blur(4px);
  font-family: var(--font-sans);
  animation: acmFadeIn .25s ease;
}
@keyframes acmFadeIn { from { opacity: 0; } to { opacity: 1; } }
.acm-root *, .acm-root *::before, .acm-root *::after { box-sizing: border-box; }
.acm-card {
  /* Stable card size: width caps at 1224 (≈85% of the prior 1440 cap,
     matches what the form looked like at 85% browser zoom), height pins
     at 92vh so the modal doesn't reflow each time the user switches
     between Stage 1 sub-tabs. Clean white body (was a heavy lavender
     wash that made everything look blurred together) with a defined
     violet border. */
  width: 100%; max-width: 1224px;
  height: min(92vh, calc(100vh - 24px));
  background: #ffffff;
  border: 1px solid #d6c5ff;
  border-radius: 20px;
  box-shadow: 0 32px 80px -20px rgba(76,29,149,.40), 0 12px 30px rgba(15,5,40,.18);
  overflow: hidden; display: flex; flex-direction: column;
  position: relative;   /* positioning context for the saving lock overlay */
  animation: acmSlideUp .35s cubic-bezier(.34,1.56,.64,1);
}
.acm-header {
  position: relative;
  background: linear-gradient(
135deg, #2e1065 0%, #4c1d95 30%, #6d28d9 65%, #7c3aed 100%);
  padding: 18px 24px;
  display: flex; align-items: center; justify-content: space-between;
  overflow: hidden;
  flex-shrink: 0;
}
.acm-header::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* Three stacked layers:
         1. white dot-grid texture (the polka-dot effect)
         2 + 3. soft brand glows left/right for depth. */
    background-image:
      radial-gradient(rgba(255, 255, 255, .20) 1.1px, transparent 1.6px),
      radial-gradient(circle at 15% 50%, rgba(167, 139, 250, .32) 0%, transparent 55%),
      radial-gradient(ellipse at 85% 50%, rgba(139, 92, 246, .22) 0%, transparent 55%);
    background-size: 18px 18px, auto, auto;
    background-position: 0 0, 0 0, 0 0;
}
.acm-header-left { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; }
.acm-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,0.18);
  border: 1.5px solid rgba(255,255,255,0.30);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
}
.acm-title { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.acm-subtitle { font-size: 12px; color: rgba(255,255,255,0.80); margin-top: 3px; }
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
.acm-stepper { padding: 16px 22px 14px; display: flex; align-items: center; gap: 0; flex-shrink: 0; background: linear-gradient(110deg,#faf5ff 0%,#f0ebff 100%); }
.acm-step-connector { flex: 0 0 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; z-index: 0; }
.acm-step { flex: 1; padding: 11px 14px; border-radius: 14px; display: flex; align-items: center; gap: 12px; position: relative; overflow: hidden; transition: all .25s; cursor: pointer; min-width: 0; }
.acm-step-badge-wrap { position: relative; flex-shrink: 0; width: 40px; height: 40px; }
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-pending { background: #f8fafc; border: 1.5px solid #e2e8f0; cursor: not-allowed; opacity: .75; }
.acm-tabs { padding: 14px 22px 14px; display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; background: linear-gradient(110deg,#faf5ff 0%,#f0ebff 100%); border-bottom: 1px solid #ede9fe; }
.acm-body { flex: 1; overflow-y: auto; padding: 16px 22px 20px; background: #fff; scrollbar-width: thin; scrollbar-color: #a78bfa #ede9fe; display: flex; flex-direction: column; }
.acm-section { background: #fff; border: 1.5px solid #e0d9f7; border-radius: 14px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.06); }
.acm-section:last-child { margin-bottom: 0; }
.acm-section-purple { border-top: 3px solid #7c3aed; }
.acm-section-head { padding: 11px 16px; background: linear-gradient(110deg,#faf5ff 0%,#f0ebff 100%); display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #ede9fe; }
.acm-section-body { padding: 16px; }
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
[data-bs-theme="dark"] .acm-section-purple { border-top-color: #a78bfa; }
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
      {[0, 1, 2].map((i) => (
        <Fragment key={i}>
          <div className="acm-step acm-step-pending" style={{ pointerEvents: 'none' }}>
            <div className="acm-step-badge-wrap">
              <Shimmer width={40} height={40} radius={10} />
            </div>
            <div className="acm-step-text" style={{ flex: 1 }}>
              <Shimmer height={11} width="70%" radius={4} style={{ marginBottom: 6 }} />
              <Shimmer height={9}  width="55%" radius={4} />
            </div>
          </div>
          {i < 2 && (
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
  const FieldShim = () => (
    <div className="acm-field">
      <Shimmer height={10} width="40%" radius={4} style={{ marginBottom: 7 }} />
      <Shimmer height={36} radius={9} />
    </div>
  );
  const Section = ({ rows }: { rows: { cols: number }[] }) => (
    <div className="acm-section acm-section-purple" style={{ marginBottom: 16 }}>
      <div className="acm-section-head">
        <Shimmer width={28} height={28} radius={8} />
        <div style={{ flex: 1, marginLeft: 10 }}>
          <Shimmer height={11} width="35%" radius={4} />
        </div>
      </div>
      <div className="acm-section-body">
        {rows.map((r, i) => (
          <div key={i} className={`acm-row acm-row-${r.cols}`} style={{ marginBottom: i < rows.length - 1 ? 14 : 0 }}>
            {Array.from({ length: r.cols }).map((_, j) => <FieldShim key={j} />)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <Section rows={[{ cols: 3 }, { cols: 4 }]} />
      <Section rows={[{ cols: 2 }, { cols: 4 }, { cols: 4 }, { cols: 1 }]} />
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
          <Shimmer height={36} width={180} radius={999} />
          <Shimmer height={36} width={200} radius={999} />
        </div>
        <div className="acm-body"><Stage1FormShimmer /></div>
      </div>
    </div>
  ), document.body);
}
