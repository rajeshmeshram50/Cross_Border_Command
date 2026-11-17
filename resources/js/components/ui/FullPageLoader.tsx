/**
 * FullPageLoader — a screen-wide veil while a blocking action runs.
 *
 * Deliberately PRESENTATIONAL and opt-in: a component a screen renders while
 * its own `saving` flag is true. An earlier version of this hooked into the
 * Axios interceptors and covered every write in the app, which is far more
 * reach than any one screen asked for; this version does nothing until a
 * caller renders it.
 *
 * Portals to <body> and sits above the modal layer, because the action it
 * covers normally starts inside a popup — veiling only the popup leaves the
 * page behind it live and clickable.
 *
 *   {saving && <FullPageLoader label="Saving employee…" />}
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './FullPageLoader.css';

export default function FullPageLoader({
  label = 'Please wait…',
  /** Hold off this long before appearing, so a fast save doesn't flash. */
  delayMs = 180,
}: {
  label?: string;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  /* Nothing behind it should scroll while it is up. Restored on unmount even
     if the action threw — the cleanup runs either way. */
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div className="fpl-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="fpl-card">
        {/* The brand ring from the splash screen, so the first thing the app
            shows and the thing it shows while working are the same mark. */}
        <svg className="fpl-ring" width="54" height="54" viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="32" fill="none" className="fpl-ring-track" strokeWidth="5" />
          <circle
            cx="40" cy="40" r="32" fill="none" stroke="url(#fpl-grad)"
            strokeWidth="5" strokeLinecap="round" strokeDasharray="60 141"
          />
          <defs>
            <linearGradient id="fpl-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c5cfc" />
              <stop offset="100%" stopColor="#5a3fd1" />
            </linearGradient>
          </defs>
        </svg>
        <div className="fpl-label">{label}</div>
        <div className="fpl-sub">This will only take a moment.</div>
      </div>
    </div>,
    document.body,
  );
}
