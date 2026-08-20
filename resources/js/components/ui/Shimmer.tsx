/**
 * Shimmer placeholders. The base `.shimmer` class lives in app.css and
 * provides the animated gradient. Width / height / spacing come from
 * inline styles here because the project doesn't ship Tailwind — using
 * Tailwind class names (h-4, w-100, gap-4, etc.) silently rendered as
 * 0×0 invisible divs and made every shimmer disappear.
 */
import React from 'react';

const card: React.CSSProperties = {
  background: 'var(--shim-card-bg, #fff)',
  border: '1px solid var(--shim-border, #e5e7eb)',
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

/* ── Form (card-per-section) ─────────────────────────────────────────
 * Card-wise form skeleton: an optional header card (icon + title + action)
 * plus N section cards, each with a header row and a field grid (label +
 * input). Matches the Client / Branch / Supplier edit forms so every form's
 * loading state looks the same. Pass `header={false}` when the surrounding
 * shell (e.g. a modal) already renders its own header. */
export function ShimmerForm({
  sections = 4,
  cols = 3,
  fieldsPerSection = 6,
  header = true,
}: {
  sections?: number;
  cols?: number;
  fieldsPerSection?: number;
  header?: boolean;
}) {
  return (
    <div style={{ width: '100%' }}>
      {header && (
        <div style={{ ...card, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
          <Shimmer width={64} height={64} radius={14} />
          <div style={{ flex: 1, ...stack(10) }}>
            <Shimmer width={220} height={18} />
            <Shimmer width={320} height={12} />
          </div>
          <Shimmer width={120} height={36} radius={10} />
        </div>
      )}
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} style={{ ...card, padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Shimmer width={32} height={32} radius={8} />
            <Shimmer width={180} height={14} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14 }}>
            {Array.from({ length: fieldsPerSection }).map((__, f) => (
              <div key={f} style={stack(8)}>
                <Shimmer width={`${50 + (f % 4) * 10}%`} height={10} />
                <Shimmer width="100%" height={38} radius={8} />
              </div>
            ))}
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
  colIds,
  height = 14,
  cellClassName = 'py-3',
  keyPrefix = 'shim',
}: {
  rows?: number;
  cols?: number;
  /** Column ids, in order, stamped onto each placeholder cell as `data-col`.
   *  Responsive stylesheets hide columns by `[data-col="…"]`, which reaches the
   *  real header and body cells but could not reach these — so a narrow screen
   *  dropped the header cells and kept every placeholder, and the loading table
   *  rendered wider than its own header. Supply this wherever such rules apply;
   *  `cols` remains the fallback for tables with no per-column rules. */
  colIds?: string[];
  height?: number | string;
  cellClassName?: string;
  keyPrefix?: string;
}) {
  const count = colIds?.length ?? cols;
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`${keyPrefix}-${r}`}>
          {Array.from({ length: count }).map((_, c) => (
            <td key={c} className={cellClassName} data-col={colIds?.[c]}>
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
          background: 'var(--shim-secondary-bg, #f3f4f6)',
          borderBottom: '1px solid var(--shim-border, #e5e7eb)',
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
            borderBottom: '1px solid var(--shim-border, #e5e7eb)',
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

/* ── CLM Master (full page) ─────────────────────────────────────────────
 * Full-page skeleton for the CLM master pages — mirrors the real layout:
 *   1. Header banner (icon tile + title/subtitle + Add button)
 *   2. "What We Are Doing Here" brief box
 *   3. Toolbar (search + total badge, or two tab pills) + table
 * Shown while the master loads so the whole page resolves into shape, instead
 * of just a few skeleton rows. `cols` sizes the table; `twoTab` swaps the
 * search box for two tab pills (Trade Docs / Agreements / T&C / Clause Lib).
 * ───────────────────────────────────────────────────────────────────────── */
export function ShimmerClmMaster({ cols = 5, rows = 7, twoTab = false }: { cols?: number; rows?: number; twoTab?: boolean }) {
  return (
    <div className="clm-fullpage-shimmer" style={stack(14)}>
      {/* Header banner */}
      <div style={{ ...card, background: 'var(--shim-secondary-bg, #f3f4f6)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ ...row, gap: 16, minWidth: 240, flex: '1 1 320px' }}>
          <Shimmer width={52} height={52} radius={14} />
          <div style={{ flex: 1, ...stack(9) }}>
            <Shimmer width="55%" height={20} />
            <Shimmer width="80%" height={12} />
          </div>
        </div>
        <Shimmer width={170} height={42} radius={10} />
      </div>

      {/* Brief box */}
      <div style={{ ...card, padding: '16px 20px', ...row, gap: 14 }}>
        <Shimmer width={42} height={42} radius={12} />
        <div style={{ flex: 1, ...stack(8) }}>
          <Shimmer width={180} height={14} />
          <Shimmer width="45%" height={11} />
        </div>
        <Shimmer width={30} height={30} radius={8} />
      </div>

      {/* Table card */}
      <div style={card}>
        {/* Toolbar — search (or two tab pills) + total/add */}
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--shim-border, #e5e7eb)', flexWrap: 'wrap' }}>
          {twoTab ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <Shimmer width={150} height={36} radius={10} />
              <Shimmer width={150} height={36} radius={10} />
            </div>
          ) : (
            <Shimmer width={320} height={40} radius={10} style={{ maxWidth: '60%' }} />
          )}
          <Shimmer width={160} height={42} radius={12} />
        </div>
        {/* Table header strip */}
        <div style={{ padding: '12px 18px', display: 'flex', gap: 16, background: 'var(--shim-secondary-bg, #f3f4f6)', borderBottom: '1px solid var(--shim-border, #e5e7eb)' }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Shimmer key={i} height={12} width={i === 0 ? 36 : '100%'} style={i === 0 ? { flex: 'none' } : undefined} />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--shim-border, #e5e7eb)' }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Shimmer key={c} height={14} width={c === 0 ? 30 : '100%'} style={c === 0 ? { flex: 'none' } : undefined} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── List Items ─────────────────────────────────────────────────────── */
export function ShimmerList({ count = 5 }: { count?: number }) {
  return (
    <div style={card}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--shim-border, #e5e7eb)', ...row }}>
        <Shimmer width={32} height={32} radius={8} />
        <Shimmer width={140} height={14} />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--shim-border, #e5e7eb)',
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
          borderBottom: '1px solid var(--shim-border, #e5e7eb)',
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
        background: 'var(--shim-secondary-bg, #f3f4f6)',
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

/* ── Profile ──────────────────────────────────────────────────────────
 * Matches the live Profile page layout:
 *   1. Page title row (heading + breadcrumb)
 *   2. Hero banner — avatar + name/role/email on the left, 3 chip cards
 *      (ROLE / STATUS / PLAN) on the right
 *   3. Row 1 — 4/8 split: left card (subscription / account info)
 *               + right card (personal information)
 *   4. Row 2 — 4/8 split: left card + change password card
 *   5. Full-width branding card
 */
export function ShimmerProfile() {
  /* ── Reusable hero — wider banner with chip cards on the right ── */
  const hero = (
    <div
      style={{
        ...card,
        background: 'linear-gradient(135deg, var(--shim-secondary-bg, #f3f4f6), var(--shim-card-bg, #fff))',
        padding: '28px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ ...row, gap: 22, flex: '1 1 320px', minWidth: 280 }}>
        <Shimmer width={84} height={84} radius={999} />
        <div style={{ flex: 1, ...stack(10) }}>
          <Shimmer height={22} width={180} />
          <Shimmer height={14} width={220} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Shimmer width={150} height={14} />
            <Shimmer width={120} height={14} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ ...stack(8), alignItems: 'center', padding: '14px 22px', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, minWidth: 120 }}>
            <Shimmer width={50} height={10} />
            <Shimmer width={84} height={14} />
          </div>
        ))}
      </div>
    </div>
  );

  /* ── Reusable narrow side card (subscription / account info shape) ── */
  const sideCard = (
    <div style={{ ...card, padding: 24, ...stack(16), height: '100%' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={row}>
          <Shimmer width={40} height={40} radius={12} />
          <Shimmer width={120} height={16} />
        </div>
        <Shimmer width={64} height={22} radius={999} />
      </div>
      <div style={{ ...stack(12), alignItems: 'center', padding: 16, borderRadius: 12, background: 'var(--shim-secondary-bg, #f3f4f6)' }}>
        <Shimmer width={56} height={56} radius={999} />
        <Shimmer width={100} height={10} />
        <Shimmer width={80} height={18} />
        <Shimmer width={140} height={12} />
      </div>
    </div>
  );

  /* ── Reusable wide card (personal info / password shape) ── */
  const wideCard = (
    <div style={{ ...card, padding: 24, ...stack(16), height: '100%' }}>
      <div style={row}>
        <Shimmer width={40} height={40} radius={12} />
        <div style={stack(8)}>
          <Shimmer width={160} height={16} />
          <Shimmer width={220} height={12} />
        </div>
      </div>
      {/* Photo + browse row */}
      <div style={{ ...row, gap: 16 }}>
        <Shimmer width={72} height={72} radius={999} />
        <div style={{ flex: 1, ...stack(8) }}>
          <Shimmer height={12} width={100} />
          <Shimmer height={38} radius={10} />
          <Shimmer height={10} width={140} />
        </div>
      </div>
      {/* 2x2 form grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={stack(8)}>
            <Shimmer height={10} width={90} />
            <Shimmer height={38} radius={10} />
          </div>
        ))}
      </div>
      {/* Action button row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Shimmer width={140} height={38} radius={10} />
      </div>
    </div>
  );

  return (
    <div style={stack(18)}>
      {/* Page title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Shimmer width={120} height={20} />
        <Shimmer width={140} height={14} />
      </div>
      {hero}
      {/* Row 1 — 4/8 split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        {sideCard}
        {wideCard}
      </div>
      {/* Row 2 — 4/8 split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        {sideCard}
        {wideCard}
      </div>
      {/* Branding card — full width */}
      <div style={{ ...card, padding: 24, ...stack(16) }}>
        <div style={row}>
          <Shimmer width={40} height={40} radius={12} />
          <div style={stack(8)}>
            <Shimmer width={200} height={16} />
            <Shimmer width={260} height={12} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
          <Shimmer height={120} radius={12} />
          <Shimmer height={120} radius={12} />
          <Shimmer height={120} radius={12} />
        </div>
      </div>
    </div>
  );
}

/* ── Employee Profile (full-screen overlay) ──────────────────────────
 * Mirrors the HR employee profile at resources/js/pages/employee/
 * EmployeeProfile.tsx, which opens as a fixed full-screen overlay:
 *   1. Dark hero band — square avatar, name, code + role pills, the
 *      department·designation subline, a row of meta cells (email, phone,
 *      joining date, reporting manager) and the two progress rings.
 *   2. The tab strip nested inside that hero.
 *   3. The light content pane below it — two section cards of field grids.
 *
 * Opening the profile from anywhere that does NOT pre-pass the employee row
 * (Payroll → Run Payroll → Open Employee is the one QA hit) means the record
 * has to be fetched before the page can render at all, and that wait used to
 * show a bare centred spinner on an empty page. Reproducing the real shape in
 * the real hero colour makes the page resolve into itself instead.
 * ─────────────────────────────────────────────────────────────────────── */
export function ShimmerEmployeeProfile() {
  // The hero is dark, so its placeholders need the translucent-white
  // treatment the page already uses for its own hero shimmers
  // (.ep-hero-shimmer) rather than the default light-grey gradient.
  const onDark: React.CSSProperties = { background: 'rgba(255,255,255,0.18)' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1080,
        display: 'flex', flexDirection: 'column',
        background: 'var(--vz-body-bg, #f3f4f9)',
      }}
      aria-busy="true"
      aria-label="Loading employee profile"
    >
      {/* ── Hero band ── */}
      <div style={{ padding: '20px 28px 14px', background: 'linear-gradient(120deg,#08112b 0%,#0c1740 40%,#0f1e55 70%,#0d1848 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          <Shimmer width={110} height={110} radius={26} style={onDark} />

          <div style={{ flex: '1 1 320px', minWidth: 260, ...stack(10) }}>
            <Shimmer width={220} height={22} style={onDark} />
            {/* Employee code + role / status pills share one line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Shimmer width={70} height={11} style={onDark} />
              <Shimmer width={96} height={20} radius={999} style={onDark} />
              <Shimmer width={78} height={20} radius={999} style={onDark} />
            </div>
            <Shimmer width={280} height={12} style={onDark} />
            {/* Meta cells — email / phone / joined / reports to */}
            <div style={{ display: 'flex', columnGap: 26, rowGap: 10, flexWrap: 'wrap', marginTop: 2 }}>
              {[150, 120, 100, 90].map((w, i) => (
                <div key={i} style={{ ...row, gap: 8 }}>
                  <Shimmer width={16} height={16} radius={5} style={onDark} />
                  <div style={stack(6)}>
                    <Shimmer width={38} height={8} style={onDark} />
                    <Shimmer width={w} height={11} style={onDark} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completion rings (Profile / Onboarding) */}
          <div style={{ display: 'flex', gap: 22 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ ...stack(8), alignItems: 'center' }}>
                <Shimmer width={64} height={64} radius={999} style={onDark} />
                <Shimmer width={60} height={9} style={onDark} />
              </div>
            ))}
          </div>
        </div>

        {/* ── Tab strip, nested in the hero ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
          {[92, 84, 96, 104, 88, 92, 80, 86].map((w, i) => (
            <Shimmer key={i} width={w} height={32} radius={9} style={onDark} />
          ))}
        </div>
      </div>

      {/* ── Content pane ── */}
      <div style={{ flex: '1 1 auto', overflow: 'hidden', padding: 16, ...stack(14) }}>
        {[0, 1].map(s => (
          <div key={s} style={{ ...card, padding: 20, ...stack(16) }}>
            <div style={{ ...row, gap: 12 }}>
              <Shimmer width={36} height={36} radius={10} />
              <div style={stack(7)}>
                <Shimmer width={170} height={15} />
                <Shimmer width={240} height={11} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
              {Array.from({ length: 6 }).map((_, f) => (
                <div key={f} style={stack(8)}>
                  <Shimmer width={`${45 + (f % 3) * 12}%`} height={10} />
                  <Shimmer height={34} radius={9} />
                </div>
              ))}
            </div>
          </div>
        ))}
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
          <div style={{ ...row, paddingBottom: 16, borderBottom: '1px solid var(--shim-border, #e5e7eb)' }}>
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
/**
 * Mirrors the live Admin / Branch / Client dashboards:
 *   1. Page title row (heading + breadcrumb)
 *   2. 6 KPI cards in a row — each with the 3px colored top strip, a
 *      label, a value, and a 42x42 icon tile (matches .admin-kpi-card)
 *   3. Hero chart (2/3) + side donut (1/3)
 *   4. Card header strip on every chart card so the page resolves into
 *      the real layout instead of suddenly rearranging.
 *   5. 3-column secondary row (matches "Client Growth / Org Types /
 *      Payment Health" trio)
 *   6. Two-up list row (matches recent-payments / top-clients pair)
 *
 * Same fidelity approach as ShimmerSettings — the placeholder reads
 * as the real page "filling in", not a generic spinner soup.
 */
function DashboardKpiCard() {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <Shimmer height={3} radius={0} />
      <div style={{ padding: '18px 18px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, ...stack(10) }}>
          <Shimmer height={10} width="70%" />
          <Shimmer height={24} width="55%" />
          <Shimmer height={14} width="80%" radius={6} />
        </div>
        <Shimmer width={42} height={42} radius={12} />
      </div>
    </div>
  );
}

function DashboardChartCard({ height = 280 }: { height?: number }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {/* Card header — title + sub + optional action button */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--shim-border, #e5e7eb)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={stack(8)}>
          <Shimmer height={15} width={140} />
          <Shimmer height={11} width={180} />
        </div>
        <Shimmer width={70} height={28} radius={8} />
      </div>
      {/* Chart canvas — full block at the requested height */}
      <div style={{ padding: 16 }}>
        <Shimmer height={height - 70} radius={10} />
      </div>
    </div>
  );
}

function DashboardDonutCard() {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', height: '100%' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--shim-border, #e5e7eb)', ...stack(8) }}>
        <Shimmer height={15} width={140} />
        <Shimmer height={11} width={120} />
      </div>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {/* Donut placeholder — ring shape via outer + inner shimmer */}
        <div style={{ position: 'relative', width: 160, height: 160 }}>
          <Shimmer width={160} height={160} radius={999} />
          <div style={{
            position: 'absolute', top: 40, left: 40, width: 80, height: 80,
            borderRadius: 999,
            background: 'var(--shim-card-bg, #fff)',
          }} />
        </div>
        {/* Legend chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[0, 1, 2, 3].map(i => <Shimmer key={i} width={60} height={14} radius={6} />)}
        </div>
        {/* Bottom total */}
        <div style={{ ...stack(6), alignItems: 'center', marginTop: 4 }}>
          <Shimmer width={50} height={22} />
          <Shimmer width={80} height={10} />
        </div>
      </div>
    </div>
  );
}

export function ShimmerDashboard() {
  return (
    <div style={stack(16)}>
      {/* Page title row — heading on the left, breadcrumb on the right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={stack(8)}>
          <Shimmer height={22} width={140} />
          <Shimmer height={13} width={260} />
        </div>
        <Shimmer width={110} height={14} />
      </div>

      {/* KPI strip — 6 cards across, wrap to 3-2 / 1 at narrower widths */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 14,
      }}>
        {Array.from({ length: 6 }).map((_, i) => <DashboardKpiCard key={i} />)}
      </div>

      {/* Hero row — wide chart card + donut card on the right */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <DashboardChartCard height={320} />
        <DashboardDonutCard />
      </div>

      {/* Secondary row — three smaller chart cards (Client Growth /
          Org Types / Payment Health on Admin; Joining Trend / Status /
          Gender on Branch). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <DashboardChartCard height={240} />
        <DashboardChartCard height={240} />
        <DashboardChartCard height={240} />
      </div>

      {/* Tail row — two list cards (Recent Payments / Top Clients) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ShimmerList count={5} />
        <ShimmerList count={5} />
      </div>
    </div>
  );
}
