/* A FULL ring, not the 270° gauge this used to draw. The old arc left a gap at
   the bottom, so a vault at 100% still read as "not quite closed" — the one
   state the dial most needs to show unambiguously. A circle also needs no arc
   maths: one stroke-dashoffset over the circumference does it.
   The "COMPLETE" caption under the number is gone too; the % sign already says
   what the figure is, and at this size the caption was 7.5px of noise. */
export default function ProgressDial({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const RADIUS = 42;
  const CIRC = 2 * Math.PI * RADIUS;
  const offset = CIRC * (1 - pct / 100);
  // Progress runs clockwise from 12 o'clock, so the track is rotated back a
  // quarter turn — SVG circles otherwise start at 3 o'clock.
  const startRad = (-90 + (360 * pct) / 100) * (Math.PI / 180);
  const dotX = 50 + Math.cos(startRad) * RADIUS;
  const dotY = 50 + Math.sin(startRad) * RADIUS;

  return (
    <div className="ep-dial" aria-label={`${pct}% complete`}>
      <svg width="58" height="58" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="ep-dial-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#6ee7b7" />
            <stop offset="55%"  stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="ep-dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle
          cx="50" cy="50" r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="8"
        />
        <circle
          cx="50" cy="50" r={RADIUS}
          fill="none"
          stroke="url(#ep-dial-arc)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          filter="url(#ep-dial-glow)"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }}
        />
        {/* Head of the arc. Hidden at 100%, where it would sit on top of the
            join at 12 o'clock and show as a lump on a closed ring. */}
        {pct > 0 && pct < 100 && (
          <>
            <circle cx={dotX} cy={dotY} r="5.5" fill="rgba(110,231,183,0.55)" />
            <circle cx={dotX} cy={dotY} r="3"   fill="#ffffff" />
          </>
        )}
      </svg>
      <div className="ep-dial-text">
        <div className="ep-dial-num">{pct}%</div>
      </div>
    </div>
  );
}
