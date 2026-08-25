/**
 * BusyOverlay — blur + spinner over content that is being REFRESHED.
 *
 * The counterpart to <Shimmer>, and the distinction is worth keeping: a
 * shimmer stands in for content that has never been drawn (first load), while
 * this stands over content that is already on screen and is being replaced
 * (switching employee, re-filtering, refetching after an action). Swapping a
 * laid-out panel for grey bars on every switch makes the page look like it is
 * rebuilding itself; blurring what is there holds the layout still.
 *
 * Base classes live in resources/css/app.css alongside `.shimmer`.
 */
import type { ReactNode } from 'react';

export default function BusyOverlay({
  busy,
  children,
  label,
  className = '',
}: {
  busy: boolean;
  children: ReactNode;
  /** Optional caption under the spinner, e.g. "Loading Aadhya's records…". */
  label?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`busy-wrap ${className}`.trim()}>
      {/* aria-busy + aria-hidden together: the stale content is announced as
          updating and kept out of the accessibility tree meanwhile, so a
          screen reader doesn't read the previous record as if it were current. */}
      <div className={`busy-content ${busy ? 'is-busy' : ''}`.trim()} aria-hidden={busy || undefined}>
        {children}
      </div>
      {busy && (
        <div className="busy-veil" role="status" aria-live="polite">
          <span className="busy-veil-spinner" />
          {label && <span className="busy-veil-label">{label}</span>}
        </div>
      )}
    </div>
  );
}
