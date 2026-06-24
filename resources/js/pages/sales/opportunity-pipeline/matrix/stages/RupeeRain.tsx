import { useEffect, useRef } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * RupeeRain — a self-contained canvas "money rain" celebration overlay.
 *
 * Drop it inside a positioned (position: relative) container — e.g. the Stage 6
 * Victory card body — and it fills that container with falling ₹ / $ / 🪙
 * particles. The canvas is pointer-events:none, so buttons underneath stay
 * clickable.
 *
 *   <div style={{ position: 'relative' }}>
 *     {won && <RupeeRain />}
 *     ...card content...
 *   </div>
 *
 * Mounting the component starts the animation; unmounting (e.g. gating it on a
 * `won` flag) cancels the rAF loop and tears the canvas down. So to trigger it
 * "when the deal becomes WON", simply render it only while that's true.
 * ───────────────────────────────────────────────────────────────────────── */

const GLYPHS = ['₹', '$', '🪙'];
const COLORS = ['#EF9F27', '#BA7517', '#639922', '#1D9E75'];
// Festive confetti colours for the corner celebration bursts.
const CONFETTI_COLORS = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#a78bfa', '#f472b6', '#38bdf8', '#7c3aed'];
const PARTICLE_COUNT = 60;
const BURST_PER_SIDE = 30;   // particles launched from each bottom corner
const GRAVITY = 0.16;        // downward pull (px/frame²) on the corner fountains
const SPRITE = 64;           // px size each glyph is pre-rendered at (then scaled)

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

type Particle = {
  x: number;        // px, in CSS pixels relative to the canvas
  y: number;
  speed: number;    // px per frame
  size: number;     // font size in px
  rot: number;      // current rotation (radians)
  rotSpeed: number; // rotation delta per frame
  glyph: string;
  color: string;
};

/** Build a fresh falling particle. `seedY` spreads particles across the height
 *  on the first fill so the rain is full immediately; on reset it starts just
 *  above the top edge. */
function makeParticle(w: number, h: number, seedY: boolean): Particle {
  const size = rand(14, 28);
  return {
    x: Math.random() * w,
    y: seedY ? Math.random() * h : -size - Math.random() * 40,
    speed: rand(3.0, 7.0),
    size,
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-0.08, 0.08),
    glyph: pick(GLYPHS),
    color: pick(COLORS),
  };
}

type Burst = {
  x: number; y: number;
  vx: number; vy: number;  // velocity (px/frame); gravity is added to vy
  size: number;
  rot: number; rotSpeed: number;
  shape: 'rect' | 'circle';
  color: string;
  side: 'left' | 'right';
  delay: number;           // frames to wait before (re)launching — staggers the fountain
};

/** Build a corner-burst confetti chip (square or dot) that shoots up-inward
 *  from a bottom corner and arcs back down under gravity. `spread` staggers the
 *  initial launch so the fountain is continuous, not a single synced pulse. */
function makeBurst(side: 'left' | 'right', w: number, h: number, spread: number): Burst {
  const spd   = rand(8, 15);
  const angle = rand(Math.PI / 5, Math.PI / 2.15);   // ~36°…84° above horizontal
  const dir   = side === 'left' ? 1 : -1;            // left fires right, right fires left
  return {
    x: side === 'left' ? 14 : w - 14,
    y: h - 6,
    vx: Math.cos(angle) * spd * dir,
    vy: -Math.sin(angle) * spd,
    size: rand(7, 13),
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-0.3, 0.3),
    shape: Math.random() < 0.5 ? 'rect' : 'circle',
    color: pick(CONFETTI_COLORS),
    side,
    delay: Math.floor(rand(0, spread)),
  };
}

export default function RupeeRain() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The canvas sizes to its parent (the card). Track CSS-pixel dimensions
    // separately from the device-pixel backing store for crisp rendering.
    let w = 0;
    let h = 0;
    let particles: Particle[] = [];
    let bursts: Burst[] = [];
    let rafId = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      const rect = parent
        ? parent.getBoundingClientRect()
        : canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    };

    resize();
    particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(w, h, true));
    bursts = [
      ...Array.from({ length: BURST_PER_SIDE }, () => makeBurst('left', w, h, 90)),
      ...Array.from({ length: BURST_PER_SIDE }, () => makeBurst('right', w, h, 90)),
    ];

    // Re-fit on container/window size changes.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Pre-render each glyph (incl. the expensive colour-emoji 🪙) to a small
    // offscreen canvas once. Per-frame we then drawImage() these sprites, which
    // is far cheaper than fillText() per particle — this is what keeps it smooth.
    const dpr = window.devicePixelRatio || 1;
    const spriteCache = new Map<string, HTMLCanvasElement>();
    const getSprite = (glyph: string, color: string): HTMLCanvasElement => {
      const key = `${glyph}|${color}`;
      const cached = spriteCache.get(key);
      if (cached) return cached;
      const s = document.createElement('canvas');
      s.width = SPRITE * dpr;
      s.height = SPRITE * dpr;
      const sctx = s.getContext('2d')!;
      sctx.scale(dpr, dpr);
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.font = `700 ${SPRITE * 0.78}px "Segoe UI", system-ui, sans-serif`;
      sctx.fillStyle = color; // ignored by browsers for the colour-emoji 🪙
      sctx.fillText(glyph, SPRITE / 2, SPRITE / 2);
      spriteCache.set(key, s);
      return s;
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.y += p.speed;
        p.rot += p.rotSpeed;

        // Recycle to the top once fully past the bottom edge.
        if (p.y - p.size > h) {
          Object.assign(p, makeParticle(w, h, false));
        }

        // Draw the cached glyph sprite, scaled to the particle size.
        const sprite = getSprite(p.glyph, p.color);
        const d = p.size / 0.78;   // box size so the glyph renders ~p.size tall
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(sprite, -d / 2, -d / 2, d, d);
        ctx.restore();
      }

      // Corner fountains — left + right bottom corners spray paisa/coins
      // up-inward, arcing back down under gravity, then relaunch.
      for (const b of bursts) {
        if (b.delay > 0) { b.delay--; continue; }   // staggered launch
        b.vy += GRAVITY;
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.rotSpeed;

        // Relaunch once it has fallen back below the bottom (or drifted far off
        // the sides).
        if (b.y - b.size > h || b.x < -40 || b.x > w + 40) {
          Object.assign(b, makeBurst(b.side, w, h, 60));
          continue;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        // Small colourful confetti chip — rectangle or dot.
        if (b.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, b.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
        }
        ctx.restore();
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
