import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One save at a time (CS-2211..2222, common check V-C01: "Button disabled while saving; one click
 * creates one record"). `run` ignores every call while a save is in flight; `saving` drives the
 * button spinner and locks the form (the popups put `inert` on their body and disable × / Cancel).
 *
 * If the popup unmounts while a save is waiting (route change, parent closing it), the save is
 * dropped: `save()` never runs and no state is set on the unmounted popup.
 *
 * Design build: the data is dummy, so a save would finish in the same frame and the loading state
 * could never be seen or tested. SAVE_PREVIEW_MS stands in for the API round trip — replace the
 * wait with the real request when the API lands (and abort it in the same unmount cleanup).
 */
const SAVE_PREVIEW_MS = 700;

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
      await new Promise(res => setTimeout(res, SAVE_PREVIEW_MS));   // API call goes here
      if (alive.current) await save();
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }, []);

  return { saving, busy, run };
}
