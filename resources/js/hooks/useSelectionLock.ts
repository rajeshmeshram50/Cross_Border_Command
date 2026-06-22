import { useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * useSelectionLock — block text selection of the BACKGROUND page while a
 * modal/overlay is mounted, so Ctrl+A / drag-select can't grab (and copy)
 * the content sitting behind the modal. Call it inside a modal component
 * that mounts when open and unmounts when closed; it locks on mount and
 * restores the previous value on unmount.
 *
 * `user-select` inherits, so setting it to `none` on <body> cascades to the
 * whole page. The modal must re-enable selection on its own root for its
 * content to stay selectable — these modals do that via
 *   .qpi-modal-backdrop { user-select: text }
 * so only the background is locked, never the modal itself.
 *
 * Pass `active = false` to opt out without breaking the rules-of-hooks.
 * ───────────────────────────────────────────────────────────────────────── */
export function useSelectionLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const prev = body.style.userSelect;
    const prevWebkit = body.style.webkitUserSelect;
    body.style.userSelect = 'none';
    body.style.webkitUserSelect = 'none';
    return () => {
      body.style.userSelect = prev;
      body.style.webkitUserSelect = prevWebkit;
    };
  }, [active]);
}
