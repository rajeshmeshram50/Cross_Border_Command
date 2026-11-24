import { useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../components/ui/Tooltip';
import useDismissPopover from '../shared/useDismissPopover';

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
  // Popover colours come from clmShared.ts classes (not inline) so both
  // variants follow dark mode.
  const popClass = v ? 'clm-pop clm-pop-violet' : 'clm-pop';
  const pillClass = v ? 'clm-pop-pill-violet' : 'clm-code-pill';

  /* CLM (teal) cuts every name at 15 characters, full name in a tooltip - the
     same rule as the T&C Segment Wise segments, so a long authority no longer
     wraps over three lines in the popover. The violet Customer-form variant
     keeps its old look. */
  const CUT = 15;
  const cut = (s: string) => (!v && s.length > CUT ? `${s.slice(0, CUT)}…` : s);

  const [pop, setPop] = useState<{ x: number; y: number; flipUp: boolean; maxH: number } | null>(null);

  // Scroll / resize / Escape / tab switch — see useDismissPopover.
  useDismissPopover(!!pop, () => setPop(null));

  if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;

  const extra = list.length - 1;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Tooltip label={list[0]}><span className={badgeClass} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>{cut(list[0])}</span></Tooltip>
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
              // 48px a row (a 6px-padded row around a ~34px pill, measured) and
              // 46 for the title and card padding. It was 32 a row, which made a
              // three-authority list look short enough to open downwards on the
              // last table row, and it ran off the bottom of the page (QA #54).
              const estH = Math.min(280, 46 + list.length * 48);
              const spaceBelow = window.innerHeight - b.bottom - 12;
              const spaceAbove = b.top - 12;
              const flipUp = spaceBelow < estH && spaceAbove > spaceBelow;
              // And never taller than the side it opened on: if neither side
              // holds it all, it scrolls inside rather than off-screen.
              const maxH = Math.max(120, Math.min(280, flipUp ? spaceAbove : spaceBelow));
              setPop({ x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp, maxH });
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
          {/* Above .clm-modal-bd, which sits at 200000. The badge is used
              inside the DCP rule wizard as well as in the page tables behind
              it, and at 100001 the popover opened underneath the modal —
              invisible, with its own click-catcher behind the modal too, so
              the "+N" read as a dead control. */}
          <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 200100 }} />
          <div
            className={popClass}
            style={{
              position: 'fixed', left: Math.min(pop.x, window.innerWidth - 340),
              top: pop.flipUp ? undefined : pop.y,
              bottom: pop.flipUp ? (window.innerHeight - pop.y) : undefined,
              zIndex: 200101, width: 320, maxHeight: pop.maxH, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', borderRadius: 12, padding: 8,
            }}
          >
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px', }}>Issuing Authorities ({list.length})</div>
            {list.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8, minWidth: 0 }}>
                {v ? (
                  <span className={pillClass} style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{name}</span>
                ) : (
                  <Tooltip label={name} position="top" zIndex={200200} disabled={name.length <= CUT}>
                    <span className={pillClass} style={{ whiteSpace: 'nowrap' }}>{cut(name)}</span>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}
