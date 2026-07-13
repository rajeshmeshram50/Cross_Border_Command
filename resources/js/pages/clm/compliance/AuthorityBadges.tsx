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
export default function AuthorityBadges({ value }: { value?: string | string[] | null }) {
  const list = Array.isArray(value)
    ? value.map(s => String(s).trim()).filter(Boolean)
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);

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
      <Tooltip label={list[0]}><span className="clm-badge clm-badge-teal" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>{list[0]}</span></Tooltip>
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
              background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)',
              color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'pointer',
              flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)', border: 'none',
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
            }}
          >
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Issuing Authorities ({list.length})</div>
            {list.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-code-pill" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}
