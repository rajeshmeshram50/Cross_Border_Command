import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface SearchableSelectOption<T = any> {
  value: string;
  raw: T;
}

interface Props<T = any> {
  value: string | null;
  options: SearchableSelectOption<T>[];
  onChange: (value: string | null) => void;

  placeholder?: string;
  searchPlaceholder?: string;
  /** Returned text is matched (lower-cased) against the query typed by the user. */
  getSearchText: (raw: T) => string;
  /** Compact renderer for the chosen value inside the trigger button. */
  renderTrigger: (raw: T) => ReactNode;
  /** Full row renderer shown inside the opened menu. */
  renderOption: (raw: T, isActive: boolean) => ReactNode;

  disabled?: boolean;
  clearable?: boolean;
  emptyLabel?: string;
  /** Menu width in px. Defaults to the trigger's width. */
  menuMaxHeight?: number;
  className?: string;
}

/**
 * Select2-style combobox:
 *  - Compact trigger button (shows placeholder or selected value).
 *  - When opened, a popover with a sticky search box at the top and a filtered option list below.
 *  - Keyboard: ↑/↓ navigate, Enter selects, Esc closes. Click outside closes.
 *  - Theme-aware — uses Velzon CSS variables so it inverts cleanly in dark mode.
 */
export default function SearchableSelect<T = any>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  getSearchText,
  renderTrigger,
  renderOption,
  disabled = false,
  clearable = true,
  emptyLabel = 'No match',
  menuMaxHeight = 340,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
const menuRef = useRef<HTMLDivElement>(null);

const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const rootRef   = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find(o => o.value === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => getSearchText(o.raw).toLowerCase().includes(q));
  }, [options, query, getSearchText]);

  useEffect(() => { setActiveIndex(0); }, [query, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Autofocus the search field when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  // Keep the active option scrolled into view during keyboard nav
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
  if (!open) return;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gap = 6;
    const viewportPadding = 8;
    const availableBelow =
      window.innerHeight - rect.bottom - gap - viewportPadding;
    const availableAbove =
      rect.top - gap - viewportPadding;

    const estimatedMenuHeight = Math.min(
      menuMaxHeight + 58,
      400,
    );

    const placeAbove =
      availableBelow < Math.min(estimatedMenuHeight, 180) &&
      availableAbove > availableBelow;

    const availableHeight = Math.max(
      100,
      placeAbove ? availableAbove : availableBelow,
    );

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      zIndex: 12000,
      ...(placeAbove
        ? {
            bottom: window.innerHeight - rect.top + gap,
            top: 'auto',
          }
        : {
            top: rect.bottom + gap,
            bottom: 'auto',
          }),
      maxHeight: availableHeight,
    });
  };

  updatePosition();

  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);

  return () => {
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
  };
}, [open, menuMaxHeight]);

  const commit = (val: string | null) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`position-relative ${className ?? ''}`}>
      {/* Trigger */}
      <button
         ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className="w-100 d-flex align-items-center gap-2 text-start"
        style={{
          minHeight: 40,
          padding: '6px 10px 6px 14px',
          borderRadius: 10,
          border: `1px solid ${open ? 'var(--vz-primary)' : 'var(--vz-border-color)'}`,
          background: 'var(--vz-card-bg)',
          color: selected ? 'var(--vz-body-color)' : 'var(--vz-secondary-color)',
          boxShadow: open ? '0 0 0 0.15rem rgba(64,81,137,0.15)' : 'none',
          transition: 'border-color .15s ease, box-shadow .15s ease',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
        }}
      >
        <div className="flex-grow-1 text-truncate">
          {selected ? renderTrigger(selected.raw) : placeholder}
        </div>
        {clearable && selected && !disabled && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); commit(null); }}
            className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
            style={{ width: 20, height: 20, color: 'var(--vz-secondary-color)', background: 'transparent' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--vz-secondary-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--vz-danger, #f06548)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--vz-secondary-color)'; }}
          >
            <i className="ri-close-line" style={{ fontSize: 14 }} />
          </span>
        )}
        <i
          className="ri-arrow-down-s-line flex-shrink-0"
          style={{
            color: 'var(--vz-primary)',
            transition: 'transform .2s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            fontSize: 18,
          }}
        />
      </button>

      {/* Popover menu */}
{open &&
  createPortal(
    <div
      ref={menuRef}
      className="searchable-select-menu"
      style={{
        ...menuStyle,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--vz-card-bg, #212529)',
        border: '1px solid var(--vz-border-color, #444)',
        boxShadow: '0 16px 40px rgba(15,23,42,0.3)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Search input header */}
      <div
        className="d-flex align-items-center gap-2"
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--vz-border-color)',
          background: 'var(--vz-secondary-bg)',
          flexShrink: 0,
        }}
      >
        <i
          className="ri-search-line"
          style={{
            color: 'var(--vz-secondary-color)',
            fontSize: 15,
          }}
        />

        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder}
          className="flex-grow-1"
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--vz-body-color)',
            fontSize: 13,
            minWidth: 0,
          }}
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              searchRef.current?.focus();
            }}
            style={{
              width: 22,
              height: 22,
              color: 'var(--vz-secondary-color)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            title="Clear search"
          >
            <i className="ri-close-circle-fill" />
          </button>
        )}
      </div>

      {/* Option list */}
      <div
        ref={listRef}
        style={{
          maxHeight: Math.max(
            60,
            Number(menuStyle.maxHeight ?? 300) - 58,
          ),
          overflowY: 'auto',
          padding: 6,
        }}
      >
        {filtered.length === 0 ? (
          <div
            className="text-center py-4"
            style={{
              color: 'var(--vz-secondary-color)',
              fontSize: 13,
            }}
          >
            <i className="ri-search-eye-line d-block mb-1" />
            {emptyLabel}
          </div>
        ) : (
          filtered.map((opt, idx) => {
            const isActive = idx === activeIndex;
            const isSelected = opt.value === value;

            return (
              <div
                key={opt.value}
                data-idx={idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commit(opt.value)}
                role="option"
                aria-selected={isSelected}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  marginBottom: 4,
                  cursor: 'pointer',
                  transition: 'background .1s ease',
                  background: isSelected
                    ? 'linear-gradient(135deg,#405189,#6691e7)'
                    : isActive
                      ? 'var(--vz-primary-bg-subtle, rgba(64,81,137,0.08))'
                      : 'transparent',
                  color: isSelected
                    ? '#fff'
                    : 'var(--vz-body-color)',
                }}
              >
                {renderOption(opt.raw, isSelected)}
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  )}
    </div>
  );
}
