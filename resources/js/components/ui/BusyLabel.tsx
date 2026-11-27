/**
 * BusyLabel — the contents of a submit button while it is working.
 *
 * Exists so the 14 popups QA filed against (#241-254, #256) cannot each
 * invent their own again. They had four different answers between them: a
 * reactstrap <Spinner>, a Bootstrap .spinner-border, a swapped remix icon,
 * and — on Holiday — nothing at all beyond the inputs greying out. The
 * spinner is the house `.ri-spin` utility from app.css, the same one the rest
 * of the app turns its remix icons with.
 *
 * Pairs with <BusyOverlay> over the popup body: the overlay says the form is
 * inert, this says which action is running.
 *
 *   <button disabled={saving}>
 *     <BusyLabel busy={saving} icon="ri-save-line">Save Holiday</BusyLabel>
 *   </button>
 */
import type { ReactNode } from 'react';

export default function BusyLabel({
  busy,
  icon,
  children,
  busyText = 'Saving…',
}: {
  busy: boolean;
  /** Remix icon class for the idle state, e.g. "ri-save-line". */
  icon: string;
  /** Idle caption. */
  children: ReactNode;
  /** Caption while busy — "Sending…", "Running…" where Saving is wrong. */
  busyText?: string;
}) {
  return (
    <>
      <i className={busy ? 'ri-loader-4-line ri-spin' : icon} aria-hidden="true" />
      {busy ? busyText : children}
    </>
  );
}
