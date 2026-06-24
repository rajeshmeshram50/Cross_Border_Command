import { cloneElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Reusable Tooltip component — portal-based so it never gets clipped by
 * parent overflow / z-index, dark pill matching the project's design
 * language.
 *
 * Usage:
 *
 *   import Tooltip from '@/components/ui/Tooltip';
 *
 *   <Tooltip label="Delete">
 *     <button onClick={…}><i className="ri-delete-bin-line" /></button>
 *   </Tooltip>
 *
 *   // Custom position (default: 'top'):
 *   <Tooltip label="Open" position="bottom">…</Tooltip>
 *
 *   // Disable when needed:
 *   <Tooltip label="Save" disabled={!hasChanges}>…</Tooltip>
 *
 * Why this over the CSS-only [data-tooltip] approach we still ship in
 * app.css: a portal renders the tooltip at document.body, so it always
 * floats above modals, sticky headers, table overflow regions etc.
 * The CSS-only path is still fine for simple cases inside non-overflow
 * containers — both can coexist.
 */
type Position = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactElement;
  position?: Position;
  /** Render delay in ms before the tooltip appears. Default 80. */
  delay?: number;
  /** Skip rendering the tooltip entirely (e.g. when the label is empty). */
  disabled?: boolean;
  /** Optional offset from the trigger in px (gap + arrow). Default 8. */
  offset?: number;
  /** Optional max width in px. Default no cap. */
  maxWidth?: number;
  /**
   * Follow the active app theme instead of the always-dark pill: a
   * white/light pill with dark text in light mode, dark pill with light
   * text in dark mode. Opt-in so existing (always-dark) usages are
   * unaffected; the dark mode appearance is identical to the default.
   */
  themed?: boolean;
  /** Stacking layer. Default 260000 — above every overlay in this
   *  project. The CLM modules raised their stack sharply: the CLM
   *  modal backdrop is 200000 and their portalled dropdowns sit at
   *  250000 (see clmShared.ts). A tooltip must float above all of
   *  them, hence the high default. Bump higher if you ever introduce
   *  a deeper layer. */
  zIndex?: number;
}

export default function Tooltip({
  label,
  children,
  position = 'top',
  delay = 80,
  disabled = false,
  offset = 8,
  maxWidth,
  themed = false,
  zIndex = 260000,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);

  // Compute the tooltip's screen position from the trigger's rect + the
  // tooltip's own measured size (so it's centred precisely along the
  // chosen edge). Re-runs on open and on scroll/resize while open.
  const place = () => {
    const trig = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!trig || !tip) return;
    let top = 0;
    let left = 0;
    if (position === 'top') {
      top = trig.top - tip.height - offset;
      left = trig.left + trig.width / 2 - tip.width / 2;
    } else if (position === 'bottom') {
      top = trig.bottom + offset;
      left = trig.left + trig.width / 2 - tip.width / 2;
    } else if (position === 'left') {
      top = trig.top + trig.height / 2 - tip.height / 2;
      left = trig.left - tip.width - offset;
    } else {
      top = trig.top + trig.height / 2 - tip.height / 2;
      left = trig.right + offset;
    }
    // Clamp to viewport so the tooltip never falls off the edge.
    const margin = 6;
    left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin));
    setCoords({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onScrollOrResize = () => setOpen(false);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cancel any pending show timer when the component unmounts so we
  // don't try to setState on an unmounted component.
  useEffect(() => () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
  }, []);

  if (disabled || label === null || label === undefined || label === '') {
    return children;
  }

  const onEnter = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setOpen(true), delay) as unknown as number;
  };
  const onLeave = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    setOpen(false);
  };

  // Compose hover/focus handlers + ref onto the child via React's
  // cloneElement (the spread-into-object approach below this used to
  // be silently broken — the resulting plain object isn't a real React
  // element, so React rendered it without the handlers and the
  // tooltip never showed up). cloneElement does the right thing.
  const originalChildRef = (children as any).ref;
  const childProps = (children as any).props ?? {};
  const childWithProps = cloneElement(children, {
    ref: (node: HTMLElement) => {
      triggerRef.current = node;
      if (typeof originalChildRef === 'function') originalChildRef(node);
      else if (originalChildRef && typeof originalChildRef === 'object') {
        (originalChildRef as any).current = node;
      }
    },
    onMouseEnter: (e: any) => {
      childProps.onMouseEnter?.(e);
      onEnter();
    },
    onMouseLeave: (e: any) => {
      childProps.onMouseLeave?.(e);
      onLeave();
    },
    onFocus: (e: any) => {
      childProps.onFocus?.(e);
      onEnter();
    },
    onBlur: (e: any) => {
      childProps.onBlur?.(e);
      onLeave();
    },
    /* Hide the tooltip immediately on click — without this, clicking
       a tooltipped button that opens a modal leaves the tooltip
       floating on screen because the modal covers the trigger so
       `mouseleave` never fires (the cursor doesn't physically leave;
       the element just disappears under the overlay). */
    onClick: (e: any) => {
      childProps.onClick?.(e);
      onLeave();
    },
    'aria-label': childProps['aria-label'] ?? (typeof label === 'string' ? label : undefined),
  } as any);

  // Theme-aware palette. Default (themed=false) stays the always-dark pill.
  // When themed, follow the live app theme — read from the <html> attribute
  // the ThemeContext maintains (data-bs-theme / data-theme), so the tooltip
  // matches whatever is active even though it's portalled to <body>.
  const isDark = !themed
    ? true
    : (typeof document !== 'undefined'
        && (document.documentElement.getAttribute('data-bs-theme') === 'dark'
          || document.documentElement.getAttribute('data-theme') === 'dark'));
  const palette = isDark
    ? {
        background: 'linear-gradient(180deg, #2a3444 0%, #1f2937 100%)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 12px 26px -6px rgba(15,23,42,0.45), 0 4px 10px rgba(15,23,42,0.22), 0 0 0 1px rgba(0,0,0,0.10)',
        arrow: '#1f2937',
        sheen: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0))',
      }
    : {
        background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
        color: '#1f2937',
        border: '1px solid #e5e7eb',
        boxShadow: '0 12px 26px -6px rgba(15,23,42,0.18), 0 4px 10px rgba(15,23,42,0.10), 0 0 0 1px rgba(15,23,42,0.04)',
        arrow: '#f3f4f6',
        sheen: 'linear-gradient(180deg, rgba(255,255,255,0.65), rgba(255,255,255,0))',
      };

  // Arrow positioning per side — sits flush against the tooltip body.
  const arrowStyle: React.CSSProperties = (() => {
    const C = palette.arrow;
    if (position === 'top') {
      return { top: '100%', left: '50%', marginLeft: -5, borderWidth: '5px 5px 0 5px', borderColor: `${C} transparent transparent transparent` };
    }
    if (position === 'bottom') {
      return { bottom: '100%', left: '50%', marginLeft: -5, borderWidth: '0 5px 5px 5px', borderColor: `transparent transparent ${C} transparent` };
    }
    if (position === 'left') {
      return { left: '100%', top: '50%', marginTop: -5, borderWidth: '5px 0 5px 5px', borderColor: `transparent transparent transparent ${C}` };
    }
    return { right: '100%', top: '50%', marginTop: -5, borderWidth: '5px 5px 5px 0', borderColor: `transparent ${C} transparent transparent` };
  })();

  return (
    <>
      {childWithProps}
      {open && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          // Haptic-style entrance: combine soft scale-in (0.86 → 1) with
          // a directional slide so the tooltip *pops* toward its target
          // edge — feels like a gentle tap response rather than a flat
          // fade. Spring easing (cubic-bezier 0.34, 1.56, 0.64, 1)
          // adds the slight overshoot that reads as a physical bounce.
          // The transform-origin is set per-side so the scale grows out
          // of the edge nearest the trigger element.
          data-tooltip-pos={position}
          style={{
            position: 'fixed',
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            background: palette.background,
            color: palette.color,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.015em',
            lineHeight: 1.35,
            padding: '7px 14px',
            borderRadius: 9,
            border: palette.border,
            boxShadow: palette.boxShadow,
            // Inner highlight — a subtle white sheen at the top so the
            // pill reads as a glossy surface, not a flat rectangle.
            backgroundClip: 'padding-box',
            /* Wrap long content by default — without this, a 200-char
             * tooltip label (e.g. a customer's pasted-junk Contact
             * Person field) blows past the right edge of the screen
             * and the viewport clamp can't help because the tooltip
             * itself is wider than the viewport. A generous default
             * cap (360px) keeps short labels on one line while long
             * ones wrap cleanly. wordBreak + overflowWrap handle the
             * pathological "Gggggggggg…" no-space case. The caller
             * can still pass an explicit `maxWidth` to override. */
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            maxWidth: maxWidth ?? `min(360px, calc(100vw - 16px))`,
            zIndex,
            pointerEvents: 'none',
            animation: 'cbcTooltipSpring 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transformOrigin:
              position === 'top'    ? 'center bottom' :
              position === 'bottom' ? 'center top' :
              position === 'left'   ? 'right center' :
                                      'left center',
          }}
        >
          {/* Glossy inner highlight — tiny gradient strip on the top
              edge gives the pill a subtle "lit from above" look. */}
          <span
            aria-hidden
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
              borderRadius: '9px 9px 0 0',
              background: palette.sheen,
              pointerEvents: 'none',
            }}
          />
          <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              width: 0,
              height: 0,
              borderStyle: 'solid',
              filter: 'drop-shadow(0 1px 1px rgba(15,23,42,0.20))',
              ...arrowStyle,
            }}
          />
          {/* Inline keyframes — keeps the component fully self-contained
              so a fresh project drop-in doesn't need extra CSS. The
              from-state offsets are per-side so the pop direction
              feels physically anchored to the trigger. */}
          <style>{`
            @keyframes cbcTooltipSpring {
              0%   { opacity: 0; transform: scale(0.86) translateY(var(--cbc-tt-from-y, 0)) translateX(var(--cbc-tt-from-x, 0)); }
              60%  { opacity: 1; transform: scale(1.04) translateY(0) translateX(0); }
              100% { opacity: 1; transform: scale(1) translateY(0) translateX(0); }
            }
            [role="tooltip"][data-tooltip-pos="top"]    { --cbc-tt-from-y: 6px; }
            [role="tooltip"][data-tooltip-pos="bottom"] { --cbc-tt-from-y: -6px; }
            [role="tooltip"][data-tooltip-pos="left"]   { --cbc-tt-from-x: 6px; }
            [role="tooltip"][data-tooltip-pos="right"]  { --cbc-tt-from-x: -6px; }
          `}</style>
        </div>,
        document.body,
      )}
    </>
  );
}
