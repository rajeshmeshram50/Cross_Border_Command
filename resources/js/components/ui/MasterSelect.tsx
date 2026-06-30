import { useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import './MasterSelect.css';


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
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string; badge?: { text: string; tone?: 'green' | 'red' | 'gray' } }[];
  placeholder?: string;
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
    window.addEventListener('resize', update);
    // capture:true so scrolls inside ANY ancestor (modals, panels) also
    // recompute the open direction — keeps the menu attached to its trigger
    // on scroll/resize instead of stranding it at a stale position.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);
  const selected = options.find(o => o.value === currentValue);
  /* Always show the search input — keeps every MasterSelect across
   * the project visually consistent (Risk Level / Active-Inactive /
   * Customer Segment all look the same). Was previously gated at
   * `options.length > 4` which made short dropdowns look like a
   * different component. The search is functionally harmless on
   * short lists; it just becomes a no-op. */
  const showSearch = true;
  // Server-search mode (onSearchChange provided): the parent owns filtering +
  // paging, so render `options` as-is. Otherwise keep the client-side filter.
  const serverMode = typeof onSearchChange === 'function';
  const filtered = serverMode
    ? options
    : (search.trim()
        ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
        : options);
  // Small status pill rendered beside an option label (e.g. Active / Inactive).
  const OptBadge = ({ b }: { b: { text: string; tone?: 'green' | 'red' | 'gray' } }) => (
    <span
      style={{
        marginLeft: 8, padding: '1px 8px', borderRadius: 999,
        fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        ...(b.tone === 'red'
          ? { background: '#fee2e2', color: '#dc2626' }
          : b.tone === 'gray'
            ? { background: '#f1f5f9', color: '#475569' }
            : { background: '#dcfce7', color: '#16a34a' }),
      }}
    >
      {b.text}
    </span>
  );
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
            <span className="master-select-value">{selected.label}{selected.badge && <OptBadge b={selected.badge} />}</span>
          ) : currentValue ? (
            /* Value set but not in the currently-loaded options (e.g. a
               paginated/async list before its page loads) — show the raw
               value so the field isn't blank on edit. */
            <span className="master-select-value">{currentValue}</span>
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
                    onClick={() => handlePick(opt.value)}
                    className="master-select-item"
                  >
                    {opt.badge ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
                        <OptBadge b={opt.badge} />
                      </span>
                    ) : opt.label}
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
