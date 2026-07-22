import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../components/ui/Tooltip';

/**
 * Renders a comma-joined (or array) authority list as "First +N": the first
 * authority as a teal badge plus a clickable +N pill. Clicking +N opens a
 * portalled popover listing every issuing authority — the same interaction the
 * DCP table's AUTHORITIES column and the Agreement master's Applicable Party
 * column use, so KYC / DD / Trade Licence masters read (and behave) consistently.
 */
export default function AuthorityBadges({ value, variant = 'teal' }: { value?: string | string[] | null; variant?: 'teal' | 'violet' }) {
  const list = Array.isArray(value)
    ? value.map(s => String(s).trim()).filter(Boolean)
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);

  // Palette — default teal (CLM masters / Supplier form); `violet` matches the
  // purple Customer form so the badge blends with that modal.
  const v = variant === 'violet';
  const badgeClass = v ? 'clm-badge clm-badge-violet' : 'clm-badge clm-badge-teal';
  const chipBg = v ? 'linear-gradient(135deg, #8b5cf6, #7c3aed, #6d28d9)' : 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)';
  const chipShadow = v ? '0 2px 8px rgba(124,58,237,.4)' : '0 2px 8px rgba(8,145,178,.4)';
  const codePillStyle: React.CSSProperties = v
    ? { display: 'inline-block', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: '#6d28d9', background: 'linear-gradient(135deg, rgba(124,58,237,.10), rgba(124,58,237,.06))', padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(124,58,237,.25)', whiteSpace: 'normal', wordBreak: 'break-word' }
    : { whiteSpace: 'normal', wordBreak: 'break-word' };

  const [pop, setPop] = useState<{ x: number; y: number; flipUp: boolean } | null>(null);

  // Close the popover on scroll / resize / Escape so it never strands away
  // from its badge as the table scrolls.
  useEffect(() => {
    if (!pop) return;
    // Close when the PAGE/table scrolls, but NOT when the user scrolls inside the
    // popover itself (that scroll used to close it, so its list was unscrollable).
    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('.clm-pop')) return;
      setPop(null);
    };
    const close = () => setPop(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);

  if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;

  const extra = list.length - 1;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Tooltip label={list[0]}><span className={badgeClass} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>{list[0]}</span></Tooltip>
      {extra > 0 && (
        <Tooltip label="View all issuing authorities">
          <button
            type="button"
            aria-label={`+${extra} more issuing ${extra > 1 ? 'authorities' : 'authority'}`}
            onClick={e => {
              if (pop) { setPop(null); return; }
              const b = e.currentTarget.getBoundingClientRect();
              // Estimate the popover height (title + a row per authority, capped
              // at 280px) and flip it above the badge when there's not enough
              // room below — otherwise the bottom rows clip off-screen.
              const estH = Math.min(280, 30 + list.length * 32);
              const spaceBelow = window.innerHeight - b.bottom;
              const flipUp = spaceBelow < estH + 12 && b.top > spaceBelow;
              setPop({ x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp });
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20,
              background: chipBg,
              color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'pointer',
              flexShrink: 0, boxShadow: chipShadow, border: 'none',
              fontFamily: 'inherit',
            }}
          >
            +{extra}
          </button>
        </Tooltip>
      )}

      {pop && createPortal(
        <>
          <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 100000 }} />
          <div
            className="clm-pop"
            style={{
              position: 'fixed', left: Math.min(pop.x, window.innerWidth - 340),
              top: pop.flipUp ? undefined : pop.y,
              bottom: pop.flipUp ? (window.innerHeight - pop.y) : undefined,
              zIndex: 100001, width: 320, maxHeight: 280, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', borderRadius: 12, padding: 8,
              ...(v ? { border: '1.5px solid #ddd6fe' } : {}),
            }}
          >
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px', ...(v ? { color: '#7c3aed' } : {}) }}>Issuing Authorities ({list.length})</div>
            {list.map((name, i) => (
              <div key={i} className={!v && i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8, ...(v && i % 2 ? { background: '#f5f3ff' } : {}) }}>
                <span className={v ? undefined : 'clm-code-pill'} style={codePillStyle}>{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}
