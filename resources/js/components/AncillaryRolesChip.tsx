import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useIsClipped } from './ui/DataTable';
import Tooltip from './ui/Tooltip';

// Role → tone palette. Same shape and defaults as HrEmployees.tsx so the
// chip looks identical wherever it's mounted (Employees, Onboarding,
// Exit Management). Unknown roles fall back to a neutral slate tone.
const ROLE_TONES: Record<string, { bg: string; fg: string }> = {
  'HR':                   { bg: '#f5e8ff', fg: '#7c2bb5' },
  'Admin':                { bg: '#fde7f0', fg: '#a02960' },
  'Manager':              { bg: '#d6f4e3', fg: '#108548' },
  'Approver':             { bg: '#dceefe', fg: '#0c63b0' },
  'Developer':            { bg: '#fdf3d6', fg: '#a06f00' },
  'Designer':             { bg: '#f0e2fa', fg: '#7c2bb5' },
  'QA':                   { bg: '#d3f0ee', fg: '#0a716a' },
  'Tester':               { bg: '#d3f0ee', fg: '#0a716a' },
  'Lead':                 { bg: '#fdf3d6', fg: '#a06f00' },
  'Mentor':               { bg: '#ece6ff', fg: '#5b3fd1' },
  'Coordinator':          { bg: '#fdf3d6', fg: '#a06f00' },
  'Engineer':             { bg: '#fdf3d6', fg: '#a06f00' },
  'Architect':            { bg: '#dceefe', fg: '#0c63b0' },
  'Analyst':              { bg: '#d3f0ee', fg: '#0a716a' },
};
// Dark-mode tones — same hue per role, but a translucent tint background +
// a lighter ink so the badge stays legible on the dark surface (the light
// pastel backgrounds above clashed badly with dark cards).
const ROLE_TONES_DARK: Record<string, { bg: string; fg: string }> = {
  'HR':                   { bg: 'rgba(124,43,181,0.22)',  fg: '#d8b4fe' },
  'Admin':                { bg: 'rgba(236,72,153,0.20)',  fg: '#f9a8d4' },
  'Manager':              { bg: 'rgba(16,133,72,0.24)',   fg: '#6ee7b7' },
  'Approver':             { bg: 'rgba(12,99,176,0.28)',   fg: '#7cc4ff' },
  'Developer':            { bg: 'rgba(160,111,0,0.28)',   fg: '#fcd34d' },
  'Designer':             { bg: 'rgba(124,43,181,0.22)',  fg: '#d8b4fe' },
  'QA':                   { bg: 'rgba(10,113,106,0.28)',  fg: '#5eead4' },
  'Tester':               { bg: 'rgba(10,113,106,0.28)',  fg: '#5eead4' },
  'Lead':                 { bg: 'rgba(160,111,0,0.28)',   fg: '#fcd34d' },
  'Mentor':               { bg: 'rgba(91,63,209,0.28)',   fg: '#b9a7ff' },
  'Coordinator':          { bg: 'rgba(160,111,0,0.28)',   fg: '#fcd34d' },
  'Engineer':             { bg: 'rgba(160,111,0,0.28)',   fg: '#fcd34d' },
  'Architect':            { bg: 'rgba(12,99,176,0.28)',   fg: '#7cc4ff' },
  'Analyst':              { bg: 'rgba(10,113,106,0.28)',  fg: '#5eead4' },
};
const roleTone = (role: string, dark: boolean) =>
  (dark ? ROLE_TONES_DARK[role] : ROLE_TONES[role])
  || (dark ? { bg: 'rgba(148,163,184,0.20)', fg: '#cbd5e1' } : { bg: '#eef2f6', fg: '#475569' });

/**
 * Renders the first ancillary role as a pill, plus a `+N` button that opens
 * a portal popover listing the remaining roles. Returns an em-dash when the
 * role list is empty.
 *
 * Identical UX to the local copy in HrEmployees.tsx — extracted so the
 * Onboarding and Exit Management tables can show the same widget without
 * duplicating 100+ lines of popover code.
 */
export function AncillaryRolesChip({ names }: { names: string[] }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);
  /* top OR bottom, never both: the popover flips above the chip when there is
     no room below it. maxH is the space actually available on that side. */
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // The visible pill is the first role only, and role names ("Sales Employee",
  // "Software Developer") routinely outrun a 9%-wide column. Measure the pill
  // and hang a tooltip on it once the name is actually cut, so a truncated
  // role is never a dead end.
  const firstRef = useRef<HTMLSpanElement>(null);
  const firstClipped = useIsClipped(firstRef, names?.[0]);

  // Recompute the popover anchor whenever it opens. Clamp to the viewport
  // so it never falls off the edge on the right.
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const POP_W = 200;
    const margin = 8;
    const GAP = 6;
    let left = b.left;
    if (left + POP_W + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - POP_W - margin);
    }

    /* Shift into the viewport rather than flip.
       Flipping only helps when ONE side is cramped. On a row near the bottom of
       a short window both sides are cramped — below was ~170px and above less
       still — so whichever side it picked, the list came out a sliver pinned to
       an edge and half its roles were unreachable.
       So it is placed below the chip and then pushed up only as far as it must
       be to fit. It may cover the rows above; those are not what the user is
       reading at that moment, and a fully visible list is worth more. */
    /* Height of five role pills, so the sixth is visibly cut and the list
       reads as scrollable. Built from the box's own metrics rather than a round
       number, so it stays exactly five if the pill styling changes:
         ROW  11px text x 1.5 line + 8px pill padding + 4px flex gap
         HEAD the "ALL ANCILLARY ROLES" caption + its 4px margin
         PAD  10px top + 10px bottom on the popover */
    const ROW = 29, HEAD = 24, PAD = 20, MAX_ROWS = 5;
    const MAX_H = Math.min(ROW * MAX_ROWS + HEAD + PAD, window.innerHeight - margin * 2);
    let top = b.bottom + GAP;
    if (top + MAX_H > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - MAX_H);
    }
    setPos({ left, top, maxH: MAX_H });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    /* Closing on scroll is right for the PAGE scrolling — the popover is
       position:fixed and would otherwise float away from its chip. But the
       listener is on capture, so it also caught the popover scrolling ITSELF:
       the list shut the moment you tried to read past the fifth role.
       Scrolls that start inside it are its own business. */
    const onScrollOrResize = (e?: Event) => {
      if (e && popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (!names || names.length === 0) {
    return <span className="text-muted">—</span>;
  }

  const first = names[0];
  const rest = names.slice(1);
  const firstTone = roleTone(first, isDark);

  return (
    <>
      <span className="d-inline-flex align-items-center gap-1" style={{ maxWidth: '100%', minWidth: 0 }}>
        <Tooltip label={first} disabled={!firstClipped}>
          <span
            ref={firstRef}
            className="fw-semibold"
            style={{
              /* inline-block + ellipsis: the pill shrinks to the column and
                 cuts its own label cleanly instead of overflowing the cell. */
              display: 'inline-block',
              maxWidth: '100%',
              /* Flex items default to min-width:auto, which refuses to shrink
                 below the text's own width — without this the pill just
                 overflows the cell and the ellipsis never appears. */
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'middle',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              background: firstTone.bg,
              color: firstTone.fg,
            }}
          >
            {first}
          </span>
        </Tooltip>
        {rest.length > 0 && (
          <button
            ref={btnRef}
            type="button"
            onClick={(ev) => { ev.stopPropagation(); setOpen(o => !o); }}
            className="d-inline-flex align-items-center fw-bold"
            aria-label={`Show ${rest.length} more ancillary role${rest.length > 1 ? 's' : ''}`}
            style={{
              fontSize: 10.5,
              padding: '4px 8px',
              borderRadius: 999,
              background: open ? '#7c5cfc' : 'rgba(124,92,252,0.16)',
              color: open ? '#fff' : (isDark ? '#c4b5fd' : '#5a3fd1'),
              border: '1px solid rgba(124,92,252,0.30)',
              cursor: 'pointer',
              transition: 'background .15s ease, color .15s ease',
              lineHeight: 1.1,
              /* The pill next to it shrinks; the +N counter never does —
                 otherwise "+2" itself gets squeezed into "+…". */
              flexShrink: 0,
            }}
          >
            +{rest.length}
          </button>
        )}
      </span>
      {open && rest.length > 0 && pos && createPortal(
        <div
          ref={popRef}
          onClick={(ev) => ev.stopPropagation()}
          className="d-flex flex-column gap-1"
          style={{
            position: 'fixed',
            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            left: pos.left,
            zIndex: 1080,
            width: 200,
            maxWidth: 'calc(100vw - 16px)',
            /* The list is as long as the employee has roles, and nothing capped
               it — a dozen roles ran past the edge of the window with nothing
               to scroll. Bounded by the room on whichever side it opened. */
            maxHeight: pos.maxH,
            overflowY: 'auto',
            /* Stops the page from scrolling once this list hits its end. */
            overscrollBehavior: 'contain',
            scrollbarWidth: 'thin',
            scrollbarColor: isDark ? 'rgba(255,255,255,.22) transparent' : 'rgba(15,23,42,.18) transparent',
            padding: 10,
            borderRadius: 12,
            // Explicit theme-aware colours — this popover is portalled to
            // document.body, where the card-scoped --vz-card-bg / --vz-border-color
            // variables don't resolve and fell back to white (a light box in
            // dark mode). isDark from useTheme drives the surface instead.
            background: isDark ? '#1f2937' : '#fff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'var(--vz-border-color, #e5e7eb)'}`,
            boxShadow: isDark
              ? '0 18px 38px -8px rgba(0,0,0,0.55), 0 6px 14px rgba(0,0,0,0.38)'
              : '0 18px 38px -8px rgba(15,23,42,0.22), 0 6px 14px rgba(15,23,42,0.08)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: isDark ? 'rgba(255,255,255,0.55)' : '#6b7280',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            All Ancillary Roles
          </div>
          {names.map(n => {
            const t = roleTone(n, isDark);
            return (
              <span
                key={n}
                className="fw-semibold"
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: t.bg,
                  color: t.fg,
                  alignSelf: 'flex-start',
                }}
              >
                {n}
              </span>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
