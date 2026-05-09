/**
 * Shimmer placeholders. The base `.shimmer` class lives in app.css and
 * provides the animated gradient. Width / height / spacing come from
 * inline styles here because the project doesn't ship Tailwind — using
 * Tailwind class names (h-4, w-100, gap-4, etc.) silently rendered as
 * 0×0 invisible divs and made every shimmer disappear.
 */
import React from 'react';

const card: React.CSSProperties = {
  background: 'var(--vz-card-bg, #fff)',
  border: '1px solid var(--vz-border-color, #e5e7eb)',
  borderRadius: 16,
  overflow: 'hidden',
};

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const stack = (gap = 8): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap });

/* ── Base Shimmer ────────────────────────────────────────────────────── */
export function Shimmer({
  className = '',
  style,
  width,
  height,
  radius = 8,
}: {
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  radius?: number | string;
}) {
  return (
    <div
      className={`shimmer ${className}`}
      style={{ width: width ?? '100%', height: height ?? 12, borderRadius: radius, ...style }}
    />
  );
}

/* ── Stat Cards ─────────────────────────────────────────────────────── */
export function ShimmerStatCards({ count = 6 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ ...card, padding: 16 }}>
          <div style={stack(12)}>
            <Shimmer width={40} height={40} radius={12} />
            <Shimmer height={28} width="50%" />
            <Shimmer height={10} width="60%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Card Grid ──────────────────────────────────────────────────────── */
export function ShimmerCards({ count = 6 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={card}>
          <Shimmer height={6} radius={0} />
          <div style={{ padding: 16, ...stack(12) }}>
            <div style={row}>
              <Shimmer width={44} height={44} radius={12} />
              <div style={{ flex: 1, ...stack(8) }}>
                <Shimmer height={16} width="75%" />
                <Shimmer height={12} width="50%" />
              </div>
            </div>
            <div style={stack(8)}>
              <Shimmer height={12} />
              <Shimmer height={12} width="85%" />
              <Shimmer height={12} width="65%" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Shimmer width={64} height={24} radius={999} />
              <Shimmer width={80} height={24} radius={999} />
            </div>
            <Shimmer height={56} radius={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Table Rows (for use INSIDE an existing <tbody>) ─────────────────
 * Drop-in replacement for the inline `Array.from(...).map(...)<tr><td><Shimmer/></td>...</tr>`
 * pattern that every page was repeating. Keeps the same look across the
 * whole project — change the height / padding here and all tables follow.
 *
 * Usage:
 *   <tbody>
 *     {loading ? <ShimmerTableRows rows={5} cols={10} /> : visible.map(...)}
 *   </tbody>
 *
 * The `keyPrefix` lets two tables on the same page (e.g. payroll tabs)
 * coexist without React key collisions.
 */
export function ShimmerTableRows({
  rows = 5,
  cols = 6,
  height = 14,
  cellClassName = 'py-3',
  keyPrefix = 'shim',
}: {
  rows?: number;
  cols?: number;
  height?: number | string;
  cellClassName?: string;
  keyPrefix?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`${keyPrefix}-${r}`}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className={cellClassName}>
              <Shimmer height={height} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ── Table ──────────────────────────────────────────────────────────── */
export function ShimmerTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={card}>
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--vz-secondary-bg, #f3f4f6)',
          borderBottom: '1px solid var(--vz-border-color, #e5e7eb)',
          display: 'flex', gap: 16,
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Shimmer key={i} height={12} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--vz-border-color, #e5e7eb)',
            display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Shimmer key={c} height={14} width={c === 0 ? 32 : '100%'} style={c === 0 ? { flex: 'none' } : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── List Items ─────────────────────────────────────────────────────── */
export function ShimmerList({ count = 5 }: { count?: number }) {
  return (
    <div style={card}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--vz-border-color, #e5e7eb)', ...row }}>
        <Shimmer width={32} height={32} radius={8} />
        <Shimmer width={140} height={14} />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--vz-border-color, #e5e7eb)',
            ...row, gap: 14,
          }}
        >
          <Shimmer width={40} height={40} radius={12} />
          <div style={{ flex: 1, ...stack(8) }}>
            <Shimmer height={14} width="65%" />
            <Shimmer height={12} width="45%" />
          </div>
          <Shimmer width={64} height={22} radius={999} />
        </div>
      ))}
    </div>
  );
}

/* ── Payment Rows ───────────────────────────────────────────────────── */
export function ShimmerPaymentList({ count = 5 }: { count?: number }) {
  return (
    <div style={stack(12)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ ...card, padding: 16, ...row }}>
          <Shimmer width={44} height={44} radius={12} />
          <div style={{ flex: 1, ...stack(8) }}>
            <Shimmer height={14} width="33%" />
            <Shimmer height={12} width="50%" />
          </div>
          <div style={{ ...stack(8), alignItems: 'flex-end' }}>
            <Shimmer height={18} width={80} />
            <Shimmer height={12} width={56} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Shimmer width={32} height={32} radius={8} />
            <Shimmer width={32} height={32} radius={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Chart ──────────────────────────────────────────────────────────── */
export function ShimmerChart() {
  return (
    <div style={card}>
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--vz-border-color, #e5e7eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={row}>
          <Shimmer width={40} height={40} radius={12} />
          <div style={stack(8)}>
            <Shimmer width={120} height={14} />
            <Shimmer width={80} height={12} />
          </div>
        </div>
        <Shimmer width={96} height={24} />
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 220 }}>
          {[40, 65, 45, 80, 55, 90, 70, 60, 85, 50, 75, 95].map((h, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <Shimmer height={`${h}%`} radius={6} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Hero Header ────────────────────────────────────────────────────── */
export function ShimmerHero() {
  return (
    <div
      style={{
        ...card,
        background: 'var(--vz-secondary-bg, #f3f4f6)',
        padding: 28,
        ...row, gap: 22,
      }}
    >
      <Shimmer width={56} height={56} radius={16} />
      <div style={{ flex: 1, ...stack(10) }}>
        <Shimmer height={22} width={260} />
        <div style={{ display: 'flex', gap: 12 }}>
          <Shimmer width={130} height={22} radius={8} />
          <Shimmer width={84} height={22} radius={999} />
        </div>
        <Shimmer height={12} width={200} />
      </div>
    </div>
  );
}

/* ── Plan Cards ─────────────────────────────────────────────────────── */
export function ShimmerPlanCards({ count = 5 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
        gap: 20,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={card}>
          <Shimmer height={6} radius={0} />
          <div style={{ padding: 20, ...stack(16) }}>
            <Shimmer width={44} height={44} radius={12} />
            <Shimmer height={18} width={100} />
            <Shimmer height={28} width={120} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Shimmer height={56} radius={12} />
              <Shimmer height={56} radius={12} />
              <Shimmer height={56} radius={12} />
              <Shimmer height={56} radius={12} />
            </div>
            <div style={stack(8)}>
              <Shimmer height={12} />
              <Shimmer height={12} width="85%" />
              <Shimmer height={12} width="70%" />
            </div>
            <Shimmer height={42} radius={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Profile ────────────────────────────────────────────────────────── */
export function ShimmerProfile() {
  return (
    <div style={stack(20)}>
      <ShimmerHero />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <ShimmerList count={4} />
        <div style={stack(16)}>
          <div style={{ ...card, padding: 24, ...stack(14) }}>
            <div style={row}>
              <Shimmer width={36} height={36} radius={12} />
              <div style={stack(8)}>
                <Shimmer width={144} height={14} />
                <Shimmer width={112} height={12} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Shimmer height={64} radius={10} />
              <Shimmer height={64} radius={10} />
              <Shimmer height={64} radius={10} />
              <Shimmer height={64} radius={10} />
            </div>
          </div>
          <div style={{ ...card, padding: 24, ...stack(14) }}>
            <div style={row}>
              <Shimmer width={36} height={36} radius={12} />
              <div style={stack(8)}>
                <Shimmer width={128} height={14} />
                <Shimmer width={160} height={12} />
              </div>
            </div>
            <Shimmer height={48} radius={10} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Shimmer height={48} radius={10} />
              <Shimmer height={48} radius={10} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────────────────── */
export function ShimmerSettings() {
  return (
    <div style={stack(20)}>
      <ShimmerHero />
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ ...card, padding: 12, ...stack(4) }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', borderRadius: 12 }}>
              <Shimmer width={36} height={36} radius={12} />
              <div style={{ flex: 1, ...stack(8) }}>
                <Shimmer height={12} width={80} />
                <Shimmer height={10} width={112} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: 24, ...stack(18) }}>
          <div style={{ ...row, paddingBottom: 16, borderBottom: '1px solid var(--vz-border-color, #e5e7eb)' }}>
            <Shimmer width={40} height={40} radius={12} />
            <div style={stack(8)}>
              <Shimmer width={112} height={14} />
              <Shimmer width={144} height={12} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Shimmer height={64} radius={10} />
            <Shimmer height={64} radius={10} />
            <Shimmer height={64} radius={10} />
            <Shimmer height={64} radius={10} />
          </div>
          <Shimmer height={80} radius={10} />
        </div>
      </div>
    </div>
  );
}

/* ── Permissions ────────────────────────────────────────────────────── */
export function ShimmerPermissions() {
  return (
    <div style={stack(18)}>
      <ShimmerHero />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Shimmer width={320} height={40} radius={12} />
        <Shimmer width={96} height={40} radius={10} />
      </div>
      <ShimmerTable rows={6} cols={8} />
    </div>
  );
}

/* ── Dashboard ──────────────────────────────────────────────────────── */
export function ShimmerDashboard() {
  return (
    <div style={stack(20)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={stack(8)}>
          <Shimmer height={26} width={192} />
          <Shimmer height={14} width={256} />
        </div>
        <Shimmer width={64} height={32} radius={12} />
      </div>
      <ShimmerStatCards count={6} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <ShimmerChart />
        <div style={stack(14)}>
          {[1, 2].map(i => (
            <div key={i} style={{ ...card, padding: 20, ...row, gap: 16 }}>
              <Shimmer width={72} height={72} radius={999} />
              <div style={stack(8)}>
                <Shimmer width={112} height={14} />
                <Shimmer width={80} height={12} />
              </div>
            </div>
          ))}
          <Shimmer height={96} radius={16} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
        <ShimmerChart />
        <ShimmerChart />
        <ShimmerList count={3} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <ShimmerList count={5} />
        <ShimmerList count={5} />
      </div>
    </div>
  );
}
