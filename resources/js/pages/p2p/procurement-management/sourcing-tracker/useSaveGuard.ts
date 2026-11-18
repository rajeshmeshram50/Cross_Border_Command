import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One save at a time (CS-2211..2222, common check V-C01: "Button disabled while saving; one click
 * creates one record"). `run` ignores every call while a save is in flight; `saving` drives the
 * button spinner and locks the form (the popups put `inert` on their body and disable × / Cancel).
 *
 * `save` is the request itself (it awaits the API). If the popup unmounts while it runs, no state
 * is set on the unmounted popup.
 */

export function useSaveGuard() {
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async (save: () => void | Promise<void>) => {
    if (busy.current) return;                    // a second click while saving does nothing
    busy.current = true;
    setSaving(true);
    try {
      if (alive.current) await save();
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }, []);

  return { saving, busy, run };
}
