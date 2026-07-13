import { useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import Tooltip from './Tooltip';
import './MasterSelect.css';

/* A small pill shown beside an option label. `tone` picks the palette —
   green/red/gray for status, violet for a category/segment tag. */
type OptBadgeSpec = { text: string; tone?: 'green' | 'red' | 'gray' | 'violet' };


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
  searchable = true,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  /* Each option may carry a primary `badge` (e.g. status) plus any number
     of extra `badges` (e.g. a segment/category tag). All render to the right
     of the label, badges first, then the primary badge.
     `disabled` greys the row and blocks selection (e.g. a product whose
     segment doesn't match the customer's); `disabledReason` is its tooltip. */
  options: { value: string; label: string; badge?: OptBadgeSpec; badges?: OptBadgeSpec[]; disabled?: boolean; disabledReason?: string }[];
  placeholder?: string;
  /* Label to show for the current value when it is NOT among `options`
   * (e.g. the option was deliberately excluded from the pickable list, or an
   * async list hasn't loaded it). Prevents the toggle from falling back to
   * printing the raw value/id. */
  currentValueLabel?: string;
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
    // Resize / browser-zoom reflows the whole layout and can strand or clip
    // the portalled menu away from its trigger — close it instead so it never
    // shows mispositioned; the user reopens it cleanly at the new size.
    const closeMenu = () => setOpen(false);
    window.addEventListener('resize', closeMenu);
    // The menu is portalled to <body> with fixed positioning, so a page/ancestor
    // scroll moves the trigger but leaves the menu behind — it drifts out of
    // alignment (bug #70). Close it on scroll (capture:true catches scrolls in
    // any ancestor: page, modal bodies, side panels). EXCEPTION: a scroll that
    // originates INSIDE the menu's own option list (infinite-scroll paging)
    // must not close it.
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('.master-select-menu')) return;
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
  // Small pill rendered beside an option label (e.g. Active / Inactive, or a
  // segment tag). `maxWidth` + ellipsis keeps a long tag (e.g. a multi-word
  // segment name) from squeezing the label off the row.
  const OptBadge = ({ b }: { b: OptBadgeSpec }) => (
    <span
      title={b.text}
      style={{
        marginLeft: 8, padding: '1px 8px', borderRadius: 999,
        fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
        ...(b.tone === 'red'
          ? { background: '#fee2e2', color: '#dc2626' }
          : b.tone === 'gray'
            ? { background: '#f1f5f9', color: '#475569' }
            : b.tone === 'violet'
              ? { background: '#ede9fe', color: '#6d28d9' }
              : { background: '#dcfce7', color: '#16a34a' }),
      }}
    >
      {b.text}
    </span>
  );
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
            <Tooltip label={selected.label} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{selected.label}</span>
                {badgesOf(selected).map((b, i) => <OptBadge key={i} b={b} />)}
              </span>
            </Tooltip>
          ) : currentValue ? (
            /* Value set but not in the currently-loaded options (e.g. a
               paginated/async list before its page loads, or an owner
               excluded from the pickable list). Prefer a caller-supplied
               label so the field shows a NAME, not the raw value/id. */
            <Tooltip label={currentValueLabel || currentValue} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{currentValueLabel || currentValue}</span>
              </span>
            </Tooltip>
          ) : loading ? (
            <span className="master-select-shimmer" aria-label="Loading" />
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
                {options.length === 0 ? 'No options' : 'No results'}
              </div>
            ) : (
              <>
                {filtered.map(opt => (
                  <DropdownItem
                    key={opt.value}
                    active={opt.value === currentValue}
                    /* Disabled options (e.g. a product outside the customer's
                       segment) render greyed and can't be picked; reactstrap
                       blocks the click, and we no-op handlePick as a belt. */
                    disabled={opt.disabled}
                    toggle={!opt.disabled}
                    onClick={opt.disabled ? undefined : () => handlePick(opt.value)}
                    className="master-select-item"
                    style={opt.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  >
                    {/* Full label (or the disabled reason) shows on hover in the
                        project's styled dark pill (Tooltip) so a truncated (long)
                        option name stays readable — replaces the plain native title. */}
                    <Tooltip label={opt.disabled ? (opt.disabledReason ?? opt.label) : opt.label} position="top">
                      {(opt.badge || opt.badges?.length) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                          {/* Cap the label at ~55% of the row so a long name
                              truncates early (…). It does NOT grow (flex 0 1 auto),
                              so the free space collapses into the badge wrapper's
                              margin-left:auto, pinning the badges to the right edge. */}
                          <span style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
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
