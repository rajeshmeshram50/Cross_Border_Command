import { type ReactNode } from 'react';

/**
 * Reusable "Coming Soon" wrapper for any module/tab whose UI is built
 * but whose backend isn't wired yet.
 *
 * Layout:
 *   - Light lavender wash background so the eye is drawn to the message,
 *     not the placeholder data underneath.
 *   - Diagonal ribbon (corner-to-corner) repeating the Coming Soon text
 *     so it's visible no matter where the user scrolls.
 *   - Centered glassy badge with a custom title/subtitle as the focal
 *     point.
 *   - The wrapped design is faded + de-saturated + click-blocked so
 *     reviewers can preview the layout but can't interact with mock
 *     buttons.
 *
 * Usage:
 *   <ComingSoonShell title="Payroll" subtitle="Salary slips, tax sheet…">
 *     {... existing dummy design ...}
 *   </ComingSoonShell>
 *
 * Once the real backend ships for that module, replace the
 * `<ComingSoonShell>` wrapper with `<>...</>` and the design becomes
 * fully interactive again with no other code change.
 */
export interface ComingSoonShellProps {
  /** Badge title — e.g. "Payroll", "Attendance". Defaults to "Coming Soon". */
  title?: string;
  /** Sub-text under the title — e.g. "Salary slips, tax sheet, payment history". */
  subtitle?: string;
  /** Ribbon text. Repeats horizontally so the corner-to-corner strip
   *  reads cleanly. Defaults to "Coming Soon · Coming Soon · Coming Soon". */
  ribbon?: string;
  /** Visually faded design. */
  children: ReactNode;
}

export default function ComingSoonShell({
  title = 'Coming Soon',
  subtitle,
  ribbon = '★ Coming Soon · Coming Soon · Coming Soon ★',
  children,
}: ComingSoonShellProps) {
  return (
    <>
      <style>{`
        .cs-shell {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          padding: 20px;
          background:
            radial-gradient(60% 50% at 50% 0%, rgba(124,92,252,0.10) 0%, rgba(124,92,252,0) 70%),
            linear-gradient(180deg, #faf8ff 0%, #f4f0ff 100%);
          border: 1px solid #ece5ff;
          min-height: 480px;
        }
        [data-bs-theme="dark"] .cs-shell {
          background: linear-gradient(180deg, #1c2030 0%, #15192a 100%);
          border-color: rgba(124,92,252,0.25);
        }
        .cs-ribbon {
          position: absolute;
          top: 56px;
          left: -120px;
          right: -120px;
          padding: 14px 0;
          transform: rotate(-8deg);
          text-align: center;
          background: linear-gradient(90deg, #f06548 0%, #ff8a5b 50%, #f06548 100%);
          color: #fff;
          font-weight: 900;
          letter-spacing: 0.42em;
          font-size: 14.5px;
          text-transform: uppercase;
          box-shadow: 0 12px 36px rgba(240,101,72,0.32), 0 2px 0 rgba(0,0,0,0.06) inset;
          text-shadow: 0 1px 2px rgba(0,0,0,0.18);
          z-index: 5;
          pointer-events: none;
          user-select: none;
          white-space: nowrap;
        }
        .cs-watermark {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          z-index: 6;
          pointer-events: none;
          user-select: none;
          text-align: center;
          padding: 22px 36px;
          border-radius: 20px;
          background: rgba(255,255,255,0.78);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(124,92,252,0.18);
          box-shadow: 0 24px 48px rgba(124,92,252,0.18);
          max-width: 92%;
        }
        [data-bs-theme="dark"] .cs-watermark {
          background: rgba(28,32,46,0.82);
          border-color: rgba(124,92,252,0.30);
        }
        .cs-watermark .label {
          font-size: 11px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
          color: #5a3fd1; margin-bottom: 4px;
        }
        .cs-watermark .title {
          font-size: 30px; font-weight: 900; letter-spacing: -0.02em;
          background: linear-gradient(135deg, #5a3fd1, #7c5cfc 60%, #f06548);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1.1;
        }
        .cs-watermark .sub {
          font-size: 12.5px; color: #6b7280; margin-top: 6px;
        }
        [data-bs-theme="dark"] .cs-watermark .sub { color: var(--vz-secondary-color); }
        .cs-design {
          position: relative;
          z-index: 1;
          opacity: 0.55;
          filter: saturate(0.6) blur(0.5px);
          pointer-events: none;
          user-select: none;
          transition: opacity .25s ease;
        }
      `}</style>
      <div className="cs-shell">
        <div className="cs-ribbon">{ribbon}</div>
        <div className="cs-watermark">
          <div className="label">Module Status</div>
          <div className="title">{title}</div>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <div className="cs-design" aria-hidden="true">
          {children}
        </div>
      </div>
    </>
  );
}
