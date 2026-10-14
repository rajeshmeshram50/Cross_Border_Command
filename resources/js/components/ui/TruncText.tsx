import type { CSSProperties } from 'react';
import Tooltip from './Tooltip';

/**
 * Free text cut to a character budget, with the whole of it on hover.
 *
 * Names typed by users — a leave plan, a holiday group, a segment — have no
 * length limit, and left alone they run out of their cell and shove whatever
 * shares the row. This cuts at `max` characters and moves the full text into a
 * tooltip; a value already short enough renders plainly, with no tooltip and
 * no extra wrapper behaviour.
 *
 * By CHARACTER rather than by CSS width, deliberately. The same name usually
 * renders in several places of different widths — a sidebar, a header, a badge
 * — and a width-based ellipsis cuts it at a different point in each, so the
 * same record reads differently depending on where you look at it.
 *
 * `clip` adds the CSS backstop (ellipsis + min-width: 0) for callers whose
 * container can still be narrower than the budget: thirty wide characters
 * measure far more than thirty narrow ones, so the count alone never
 * guarantees a fit.
 */
export default function TruncText({
  text, max = 30, className, style, clip = false, tooltip = true,
}: {
  text: string;
  max?: number;
  className?: string;
  style?: CSSProperties;
  clip?: boolean;
  /** Off for a caller that already wraps this in a tooltip of its own. */
  tooltip?: boolean;
}) {
  const clipStyle: CSSProperties = clip
    ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    : {};
  const merged = { ...clipStyle, ...style };

  if (text.length <= max) {
    return <span className={className} style={merged}>{text}</span>;
  }
  const short = `${text.slice(0, max).trimEnd()}…`;
  const el = <span className={className} style={merged}>{short}</span>;
  return tooltip ? <Tooltip label={text}>{el}</Tooltip> : el;
}
