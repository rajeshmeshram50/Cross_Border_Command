import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import Tooltip from './Tooltip';
import './MasterSelect.css';

/* A small pill shown beside an option label. `tone` picks the palette —
   green/red/gray for status, violet for a category/segment tag.
   `title` overrides the hover tooltip (defaults to `text`).
   `items` turns the pill into a click target — e.g. a "+2 more" overflow
   pill opens a mini popup listing the hidden tags. */
type OptBadgeSpec = { text: string; tone?: 'green' | 'red' | 'gray' | 'violet'; title?: string; items?: string[] };

// Follow the active app theme: light pastel pills in light mode, translucent
// tints + lighter text in dark mode (QA #123 — the option badges were fixed
// light colours and read wrong on the dark surface). Read from the <html>
// attribute the ThemeContext maintains; a theme toggle re-renders the tree so
// this recomputes.
const isDarkTheme = (): boolean =>
  typeof document !== 'undefined' &&
  (document.documentElement.getAttribute('data-bs-theme') === 'dark' ||
    document.documentElement.getAttribute('data-theme') === 'dark');

const badgeToneStyle = (tone?: OptBadgeSpec['tone']): CSSProperties => {
  const dark = isDarkTheme();
  if (tone === 'red')    return dark ? { background: 'rgba(239,68,68,.18)',  color: '#fca5a5' } : { background: '#fee2e2', color: '#dc2626' };
  if (tone === 'gray')   return dark ? { background: 'rgba(148,163,184,.20)', color: '#cbd5e1' } : { background: '#f1f5f9', color: '#475569' };
  if (tone === 'violet') return dark ? { background: 'rgba(124,58,237,.24)',  color: '#c4b5fd' } : { background: '#ede9fe', color: '#6d28d9' };
  return dark ? { background: 'rgba(34,197,94,.18)', color: '#86efac' } : { background: '#dcfce7', color: '#16a34a' };
};

/* A pill rendered beside an option label. When the spec carries `items`
   (and it isn't forced static), the pill becomes clickable and pops a mini
   list of those items — used by a "+N more" overflow pill to reveal the
   hidden tags. The popup is portalled to <body> with fixed positioning so
   it isn't clipped by the option list's `overflow: auto`. `staticPill`
   forces the plain, non-interactive span (used inside the toggle, which is
   itself a <button> — a nested interactive control there would be invalid). */
export function OptBadge({ b, staticPill }: { b: OptBadgeSpec; staticPill?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const interactive = !staticPill && !!b.items?.length;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (ref.current?.contains(t)) return;
      if (t?.closest?.('.master-select-badge-pop')) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    // Capture so we run before reactstrap's own document handlers.
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const style: CSSProperties = {
    marginLeft: 8, padding: '1px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
    maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
    ...badgeToneStyle(b.tone),
  };

  if (!interactive) {
    return <span title={b.title ?? b.text} style={style}>{b.text}</span>;
  }

  const toggle = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      title={b.title ?? b.text}
      // Stop the pill's clicks from selecting the option / closing the menu.
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } }}
      style={{ ...style, cursor: 'pointer' }}
    >
      {b.text}
      {open && pos && createPortal(
        <div
          className="master-select-badge-pop"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 12000 }}
        >
          {b.items!.map((it, i) => (
            <span key={i} className="master-select-badge-pop-item" title={it}>{it}</span>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}


export function MasterSelect({
  name,
  value,
  defaultValue,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  loading,
  allowDeselect,
  onChange,
  onOpen,
  onScrollEnd,
  onSearchChange,
  loadingMore,
  currentValueLabel,
  emptyText,
  searchable = true,
  onDisabledClick,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  /* Each option may carry a primary `badge` (e.g. status) plus any number
     of extra `badges` (e.g. a segment/category tag). All render to the right
     of the label, badges first, then the primary badge.
     `disabled` greys the row and blocks selection (e.g. a product whose
     segment doesn't match the customer's); `disabledReason` is its tooltip. */
  /* `fullLabel` — when the visible `label` is deliberately shortened (e.g. a
     30-char-capped agreement type), the full text shows in the hover tooltip.
     `selectedLabel` — an alternate, shorter text shown in the CLOSED trigger
     when this option is picked (e.g. options list "CLT-004 - Risk", but the
     trigger shows just "Risk"); falls back to `label`. */
  options: { value: string; label: string; fullLabel?: string; selectedLabel?: string; badge?: OptBadgeSpec; badges?: OptBadgeSpec[]; disabled?: boolean; disabledReason?: string }[];
  placeholder?: string;
  /* Label to show for the current value when it is NOT among `options`
   * (e.g. the option was deliberately excluded from the pickable list, or an
   * async list hasn't loaded it). Prevents the toggle from falling back to
   * printing the raw value/id. */
  currentValueLabel?: string;
  /* Replaces the bare "No options" when the list arrives empty. A picker whose
     contents depend on configuration (a department, a branch, a permission)
     leaves the user staring at two words that do not say WHICH setting is
     missing or who can change it. Only shown for a genuinely empty list — a
     search that matches nothing still says "No results". */
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  /* When true, the toggle renders a shimmer block instead of the
   * placeholder text. Use this on dropdowns whose options come from an
   * async master fetch — gives users a polished "fetching the master"
   * cue instead of the grey "Loading…" placeholder. */
  loading?: boolean;
  /* Opt-in toggle behaviour: clicking the already-selected option clears
   * the field back to empty (single-select acts like a toggle). Off by
   * default so every other dropdown keeps the standard "pick replaces"
   * behaviour — only fields that explicitly want a clearable selection
   * (e.g. Classification & Flags) pass this. */
  allowDeselect?: boolean;
  onChange?: (value: string) => void;
  onOpen?: () => void;
  /* Infinite-scroll: called when the option list is scrolled near the bottom.
   * The parent appends the next page (and guards with its own hasMore/loading
   * flags). When provided, the option list pages in instead of loading all. */
  onScrollEnd?: () => void;
  /* Server-side search: called (debounced) as the user types. When provided,
   * MasterSelect stops client-side filtering — the parent supplies the
   * already-filtered `options` for the current query. */
  onSearchChange?: (query: string) => void;
  /* Shows a "Loading…" row at the bottom of the list while the parent fetches
   * the next page. */
  loadingMore?: boolean;
  /* Set false to hide the in-menu search input entirely. Use on short, fixed
   * option lists (e.g. a 3-value filter) so opening the dropdown on mobile
   * doesn't auto-focus the search field and pop up the on-screen keyboard. */
  searchable?: boolean;
  /* Called when a DISABLED option is clicked. Without it a disabled option is
     simply inert; with it the click is intercepted (still no selection) so the
     caller can explain why — e.g. a toast "segment must match". The menu stays
     open so the message lands in context. */
  onDisabledClick?: (opt: { value: string; label: string; disabledReason?: string }) => void;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Reset the search filter each time the menu closes so the next open is fresh.
  // Also surface the open→true transition so consumers can refresh their
  // option source (e.g. reload the Departments master) before the user picks.
  useEffect(() => {
    if (!open) { setSearch(''); onSearchChange?.(''); }
    else onOpen?.();
  }, [open]);
  // Debounce timer for server-side search so we don't fire a request per keystroke.
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-flip — when the menu would extend below the viewport (or sit close to
  // the bottom edge of a parent modal), open upward instead so it doesn't hide
  // action buttons below the field.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropDir, setDropDir] = useState<'up' | 'down'>('down');
  // Width that the (portalled) menu should adopt — read straight off the
  // trigger so the dropdown opens at the trigger's width rather than
  // stretching to the full body width when container="body" is set.
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setMenuWidth(rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // Estimated menu height: search row (~40) + 4 visible items (~32 each) + chrome.
      const ESTIMATED_HEIGHT = 220;
      setDropDir(spaceBelow < ESTIMATED_HEIGHT && spaceAbove > spaceBelow ? 'up' : 'down');
    };
    update();
    /* Resize / browser-zoom reflows the layout and can strand the portalled
     * menu away from its trigger, so it closes instead of showing
     * mispositioned. But only on a WIDTH change.
     *
     * A phone fires `resize` constantly at a fixed width: the address bar
     * collapsing on the first scroll, the on-screen keyboard opening, the URL
     * bar coming back. Each one closed the menu the instant it opened, which is
     * why dropdowns looked dead on mobile while working on a desktop.
     * A height-only resize does not move the trigger horizontally and does not
     * strand the menu — Popper repositions it. Width is the one that reflows. */
    const openWidth = window.innerWidth;
    const closeMenu = () => { if (window.innerWidth !== openWidth) setOpen(false); };
    window.addEventListener('resize', closeMenu);
    // The menu is portalled to <body> with fixed positioning, so a page/ancestor
    // scroll moves the trigger but leaves the menu behind — it drifts out of
    // alignment (bug #70). Close it on scroll (capture:true catches scrolls in
    // any ancestor: page, modal bodies, side panels). EXCEPTION: a scroll that
    // originates INSIDE the menu's own option list (infinite-scroll paging)
    // must not close it.
    /* Ignore the scrolls that a TAP itself produces.
     *
     * On a touch screen a tap almost always emits a scroll event — momentum
     * settling, rubber-band, the mobile browser's address bar collapsing. This
     * handler fired on that and closed the menu in the same gesture that opened
     * it, so on a phone the dropdown looked like it never opened at all.
     *
     * Two guards, both narrow:
     *  - a short grace window, so the opening tap's own scroll is ignored;
     *  - a movement check, so only a scroll that actually MOVED the trigger
     *    closes the menu. That is the case this handler exists for (bug #70:
     *    a fixed-positioned menu drifting away from a scrolled trigger), and
     *    it is unaffected by a stray 0px scroll event. */
    const openedAt = Date.now();
    const anchorTop = wrapRef.current?.getBoundingClientRect().top ?? 0;
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('.master-select-menu')) return;
      if (Date.now() - openedAt < 250) return;
      const now = wrapRef.current?.getBoundingClientRect().top ?? anchorTop;
      if (Math.abs(now - anchorTop) < 4) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  const selected = options.find(o => o.value === currentValue);
  /* Show the search input by default — keeps every MasterSelect across the
   * project visually consistent (Risk Level / Active-Inactive / Customer
   * Segment all look the same). Callers with a short, fixed option list can
   * pass `searchable={false}` to hide it (avoids the mobile keyboard popping
   * up on a 3-option filter). */
  const showSearch = searchable;
  // Server-search mode (onSearchChange provided): the parent owns filtering +
  // paging, so render `options` as-is. Otherwise keep the client-side filter.
  const serverMode = typeof onSearchChange === 'function';
  const filtered = serverMode
    ? options
    : (search.trim()
        ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
        : options);
  // Collect an option's badges in render order: extra tags first, then the
  // primary status badge at the far right.
  const badgesOf = (o: { badge?: OptBadgeSpec; badges?: OptBadgeSpec[] }): OptBadgeSpec[] =>
    [...(o.badges ?? []), ...(o.badge ? [o.badge] : [])];
  const handlePick = (val: string) => {
    // With allowDeselect, re-clicking the current selection clears it.
    const next = allowDeselect && val === currentValue ? '' : val;
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  return (
    <div ref={wrapRef}>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => { if (!disabled) setOpen(v => !v); }}
        direction={dropDir}
        className={`master-select-wrap${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle
          tag="button"
          type="button"
          disabled={disabled}
          className="master-select-toggle"
        >
          {selected ? (
            /* Long labels truncate with an ellipsis (see .master-select-value-text);
               the full text shows on hover in the project's styled dark pill
               (Tooltip) instead of the plain native title. Any badge sits after
               the truncating label and stays visible. */
            <Tooltip label={selected.fullLabel ?? selected.label} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{selected.selectedLabel ?? selected.label}</span>
                {badgesOf(selected).map((b, i) => <OptBadge key={i} b={b} staticPill />)}
              </span>
            </Tooltip>
          ) : currentValue && currentValueLabel ? (
            /* Value set but not in the currently-loaded options (e.g. a
               paginated/async list before its page loads, or an owner
               excluded from the pickable list). A caller-supplied label
               shows a NAME instead of the raw value/id. */
            <Tooltip label={currentValueLabel} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{currentValueLabel}</span>
              </span>
            </Tooltip>
          ) : loading ? (
            /* Options still fetching — shimmer instead of the placeholder
               AND instead of an unresolvable value: a saved id whose label
               hasn't loaded yet must never flash as a raw number. */
            <span className="master-select-shimmer" aria-label="Loading" />
          ) : currentValue ? (
            /* Value not in options and nothing is loading — last-resort raw
               value fallback (kept so a stale/orphaned id stays visible). */
            <Tooltip label={currentValue} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{currentValue}</span>
              </span>
            </Tooltip>
          ) : (
            <span className="master-select-placeholder">{placeholder}</span>
          )}
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        {/* container="body" + strategy="fixed" portals the menu to <body>
            with Popper using fixed positioning. This is what stops the
            dropdown from being clipped by ancestor overflow:hidden /
            scroll containers (e.g. the onboarding modal's scrollable
            main area). Without these props the menu sits inside the
            wrap and dies at the first clipping ancestor.
            The inline width binds the portalled menu to the trigger's
            measured width — without this the menu inherits the body's
            width and renders as a full-screen strip. */}
        <DropdownMenu
          className="master-select-menu"
          container="body"
          strategy="fixed"
          /* Pin the portalled menu to the viewport so it can never drift
             off-screen or strand away from its trigger on smaller screens /
             browser zoom: preventOverflow clamps it inside the viewport (both
             axes), and flip swaps top/bottom when space runs out. */
          modifiers={[
            { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8, altAxis: true } },
            { name: 'flip', options: { boundary: 'viewport', fallbackPlacements: ['top', 'bottom'] } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any}
          style={menuWidth ? { width: menuWidth, minWidth: menuWidth } : undefined}
        >
          {showSearch && (
            <div
              className="master-select-search"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <i className="ri-search-line master-select-search-icon" />
              <input
                type="text"
                className="master-select-search-input"
                placeholder="Search…"
                value={search}
                onChange={e => {
                  const q = e.target.value;
                  setSearch(q);
                  if (onSearchChange) {
                    if (searchDebounce.current) clearTimeout(searchDebounce.current);
                    searchDebounce.current = setTimeout(() => onSearchChange(q), 300);
                  }
                }}
                onKeyDown={e => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          <div
            className="master-select-list"
            onScroll={onScrollEnd ? (e) => {
              const el = e.currentTarget;
              // Near the bottom → ask the parent for the next page.
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) onScrollEnd();
            } : undefined}
          >
            {filtered.length === 0 && !loadingMore ? (
              <div className="master-select-empty">
                {options.length === 0 ? (emptyText ?? 'No options') : 'No results'}
              </div>
            ) : (
              <>
                {filtered.map(opt => (
                  <DropdownItem
                    key={opt.value}
                    active={opt.value === currentValue}
                    /* Disabled options (e.g. a product outside the customer's
                       segment) render greyed and can't be selected. When an
                       onDisabledClick handler is given we keep the row CLICKABLE
                       (reactstrap `disabled` would swallow the event) and route
                       the click there instead of selecting — so the caller can
                       toast a reason. Without the handler it stays truly disabled.
                       toggle=false either way keeps the menu open on a blocked
                       pick. */
                    disabled={opt.disabled && !onDisabledClick}
                    toggle={!opt.disabled}
                    aria-disabled={opt.disabled || undefined}
                    onClick={
                      opt.disabled
                        ? (onDisabledClick ? () => onDisabledClick({ value: opt.value, label: opt.label, disabledReason: opt.disabledReason }) : undefined)
                        : () => handlePick(opt.value)
                    }
                    className="master-select-item"
                    style={opt.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  >
                    {/* Full label (or the disabled reason) shows on hover in the
                        project's styled dark pill (Tooltip) so a truncated (long)
                        option name stays readable — replaces the plain native title. */}
                    <Tooltip label={opt.disabled ? (opt.disabledReason ?? opt.fullLabel ?? opt.label) : (opt.fullLabel ?? opt.label)} position="top">
                      {(opt.badge || opt.badges?.length) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                          {/* Label GROWS to take all free space (flex 1 1 auto)
                              and only truncates when it would actually collide with
                              the badge — a short badge like "food" now leaves the
                              product code+name almost the whole row instead of being
                              hard-capped at 55%. The badge wrapper never shrinks, so
                              it always stays fully readable on the right. */}
                          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                          <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                            {badgesOf(opt).map((b, i) => <OptBadge key={i} b={b} />)}
                          </span>
                        </span>
                      ) : (
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                      )}
                    </Tooltip>
                  </DropdownItem>
                ))}
                {loadingMore && (
                  <div className="master-select-empty">Loading…</div>
                )}
              </>
            )}
          </div>
        </DropdownMenu>
      </Dropdown>
      {name !== undefined && <input type="hidden" name={name} value={currentValue} />}
    </div>
  );
}
