/**
 * The × that empties a search box.
 *
 * Supplier Management had one and nothing else did, so on every other list the
 * only way to get back to the full set was to select the text and delete it —
 * and on a filtered table that reads as "no results" long enough to look like a
 * bug. One button, one stylesheet rule, dropped into each search wrapper.
 *
 * Always in the layout, invisible while the box is empty. It used to return
 * null until you typed, which added a child to the search row mid-keystroke
 * and widened the whole box (QA #107) — on every search bar in the app, since
 * they all share this. Hidden rather than removed keeps the row one width,
 * and `visibility` still means it cannot be clicked, focused or read out.
 *
 * Every search bar in the app is a flex row (icon, input, and now this), so it
 * needs no positioning of its own — it lands after the input as the last child.
 * Colour comes from `--ui-search-clear`, which a page can set on its wrapper to
 * pick up its own accent; unset, it falls back to the neutral slate defined in
 * app.css and reads correctly on white and on tinted search bars alike.
 */
export default function SearchClear({
  show,
  onClear,
  label = 'Clear search',
}: {
  /** Usually just the query string — the button hides when it is empty. */
  show: boolean | string | null | undefined;
  onClear: () => void;
  label?: string;
}) {
  const on = !!show;
  return (
    <button
      type="button"
      className="ui-search-clear"
      title={on ? label : undefined}
      aria-label={label}
      aria-hidden={!on}
      tabIndex={on ? undefined : -1}
      disabled={!on}
      style={on ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
      /* Keeps focus in the input: the user clears and carries on typing rather
         than having to click back into the box. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
