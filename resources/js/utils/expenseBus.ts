/* ─────────────────────────────────────────────────────────────────────────
 * expenseBus — "an expense or advance changed somewhere".
 *
 * Expense screens are read in several places at once: HR › Expense Management,
 * an employee's own Expense tab, and the Inbox, which is where a manager
 * actually approves. There is no push channel, so a screen can only find out
 * by asking the server again — and the two obvious ways of deciding WHEN to
 * ask are both wrong:
 *
 *   • Ask on every focus. Alt-Tab away for two seconds and back, and four
 *     list queries run for nothing. That is the lag this replaced: `focus`
 *     and `visibilitychange` both fire on one trip back, each triggering
 *     claims + advances for self + team — eight requests, overlapping, with
 *     the team queries the most expensive of the set.
 *
 *   • Ask at most every N seconds. Cheap, but it decides by the clock rather
 *     than by events: approve in the Inbox, switch back inside the window,
 *     and the screen still shows the old status (QA #185).
 *
 * So record the EVENT instead. A mutation calls markExpenseChanged(); a reader
 * compares that stamp against its own last fetch and re-reads only when the
 * change is newer. Nothing happened → no request, however often you Alt-Tab.
 *
 * localStorage rather than an in-memory value, so it also crosses TABS: the
 * `storage` event fires in every OTHER tab of the same origin, which is the
 * real case — approving in one tab while the list sits open in another.
 * Every access is wrapped: localStorage throws in private mode and in
 * sandboxed frames, and a dead bus must degrade to "never re-reads early",
 * never to a crash.
 * ───────────────────────────────────────────────────────────────────────── */

const KEY = 'cbc:expense-changed-at';

/** Call after anything that alters a claim or advance — approve, reject,
 *  settle, confirm utilisation, raise, delete. */
export function markExpenseChanged(): void {
  try {
    const now = String(Date.now());
    localStorage.setItem(KEY, now);
    /* Same-tab listeners do NOT get a `storage` event — the spec only fires it
     * in other documents — so raise our own for them. */
    window.dispatchEvent(new CustomEvent('cbc:expense-changed', { detail: now }));
  } catch {
    /* no bus — readers fall back to refetching on their own schedule */
  }
}

/** When the last change was recorded, or 0 if nothing is known. */
export function expenseChangedAt(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Subscribe to changes from this tab AND from others. Returns an unsubscribe.
 *
 * The handler is what a screen uses to refresh immediately while it is open —
 * approving in another tab updates this one without waiting for a focus.
 */
export function onExpenseChanged(handler: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) handler(); };
  const onLocal = () => handler();
  window.addEventListener('storage', onStorage);
  window.addEventListener('cbc:expense-changed', onLocal as EventListener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('cbc:expense-changed', onLocal as EventListener);
  };
}
