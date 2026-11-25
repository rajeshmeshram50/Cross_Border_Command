import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import Tooltip from './Tooltip';
import SegmentBadge from './SegmentBadge';
import './MasterSelect.css';

type OptBadgeItem = string | { text: string; reg?: string | null };
type OptBadgeSpec = { text: string; tone?: 'green' | 'red' | 'gray' | 'violet'; title?: string; items?: OptBadgeItem[]; reg?: string | null; lock?: boolean;
  listOnly?: boolean };

const LOCK_ICON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

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

function drawsWhole(opt: { label: string; code?: string; fullLabel?: string }) {
  if (!opt.code) return false;
  if (!opt.fullLabel) return true;
  return opt.fullLabel.startsWith(opt.code) && opt.fullLabel.endsWith(opt.label);
}

export function OptBadge({ b, staticPill, shrink, noTitle }: { b: OptBadgeSpec; staticPill?: boolean; shrink?: boolean; noTitle?: boolean }) {
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
    fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    maxWidth: 160, minWidth: shrink ? 44 : 0, flexShrink: (shrink || b.reg !== undefined) ? 1 : 0, overflow: 'hidden', textOverflow: 'ellipsis',
    ...badgeToneStyle(b.tone),
  };

  if (b.reg !== undefined) {
    if (!b.text) return <SegmentBadge status={b.reg} style={{ marginLeft: 6, flexShrink: 0 }} />;
    return (
      <span title={noTitle ? undefined : (b.title ?? b.text)} style={{ ...style, display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden', maxWidth: '100%' }}>
        <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 34 }}>{b.text}</span>
        <SegmentBadge status={b.reg} style={{ flexShrink: 0 }} />
      </span>
    );
  }

  const hint = noTitle ? undefined : b.title && b.title !== b.text ? b.title : (shrink ? b.text : undefined);

  if (!interactive) {
    if (b.lock) return <span title={hint} style={{ ...style, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{LOCK_ICON}{b.text}</span>;
    return <span title={hint} style={style}>{b.text}</span>;
  }

  const place = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
  };
  const toggle = () => { place(); setOpen(o => !o); };

  return (
    <Tooltip label={`View ${b.items!.length} more`}>
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={b.title ?? b.text}
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
          {b.items!.map((it, i) => {
            const label = typeof it === 'string' ? it : it.text;
            return (
              <span key={i} className="master-select-badge-pop-item" title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {label}
                {typeof it !== 'string' && <SegmentBadge status={it.reg} style={{ flexShrink: 0 }} />}
              </span>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
    </Tooltip>
  );
}


const OPTION_PAGE = 10;

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
  listBadgesOnly,
  searchable = true,
  searchPlaceholder,
  onDisabledClick,
  menuClassName,
  fitWidth,
  optionTipPosition = 'top',
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string; fullLabel?: string; selectedLabel?: string; code?: string; badge?: OptBadgeSpec; badges?: OptBadgeSpec[]; disabled?: boolean; disabledReason?: string }[];
  placeholder?: string;
  currentValueLabel?: string;
  emptyText?: string;
  listBadgesOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
  allowDeselect?: boolean;
  onChange?: (value: string) => void;
  onOpen?: () => void;
  onScrollEnd?: () => void;
  onSearchChange?: (query: string) => void;
  loadingMore?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  onDisabledClick?: (opt: { value: string; label: string; disabledReason?: string }) => void;
  menuClassName?: string;
  fitWidth?: boolean;
  /* Where a long option's full-name tooltip opens; 'top' (centred) unless a screen asks otherwise. */
  optionTipPosition?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!open) { setSearch(''); onSearchChange?.(''); }
    else onOpen?.();
  }, [open]);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropDir, setDropDir] = useState<'up' | 'down'>('down');
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setMenuWidth(rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const ESTIMATED_HEIGHT = 220;
      setDropDir(spaceBelow < ESTIMATED_HEIGHT && spaceAbove > spaceBelow ? 'up' : 'down');
    };
    update();
    const openWidth = window.innerWidth;
    const closeMenu = () => { if (window.innerWidth !== openWidth) setOpen(false); };
    window.addEventListener('resize', closeMenu);
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
  const showSearch = searchable;
  const serverMode = typeof onSearchChange === 'function';
  const filtered = serverMode
    ? options
    : (search.trim()
        ? options.filter(o => `${o.label} ${o.code ?? ''} ${o.fullLabel ?? ''}`.toLowerCase()
          .includes(search.trim().toLowerCase()))
        : options);
  const clientPaged = !serverMode && !onScrollEnd;
  const [shown, setShown] = useState(OPTION_PAGE);
  const [paging, setPaging] = useState(false);
  useEffect(() => { setShown(OPTION_PAGE); setPaging(false); }, [search, open]);
  const visible = clientPaged ? filtered.slice(0, shown) : filtered;
  const moreToShow = clientPaged && shown < filtered.length;
  const loadMore = () => {
    if (paging || !moreToShow) return;
    setPaging(true);
    window.setTimeout(() => { setShown((n) => n + OPTION_PAGE); setPaging(false); }, 180);
  };
  const badgesOf = (o: { badge?: OptBadgeSpec; badges?: OptBadgeSpec[] }): OptBadgeSpec[] =>
    [...(o.badges ?? []), ...(o.badge ? [o.badge] : [])];
  const handlePick = (val: string) => {
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
            <Tooltip label={selected.fullLabel ?? selected.label} position="bottom">
              <span className="master-select-value">
                {selected.code && <span className="master-select-code">{selected.code}</span>}
                <span className="master-select-value-text">{selected.code ? selected.label : (selected.selectedLabel ?? selected.label)}</span>
                {!listBadgesOnly && badgesOf(selected).filter((b) => !b.listOnly).map((b, i) => <OptBadge key={i} b={b} staticPill />)}
              </span>
            </Tooltip>
          ) : currentValue && currentValueLabel ? (
            <Tooltip label={currentValueLabel} position="bottom">
              <span className="master-select-value">
                <span className="master-select-value-text">{currentValueLabel}</span>
              </span>
            </Tooltip>
          ) : loading ? (
            <span className="master-select-shimmer" aria-label="Loading" />
          ) : currentValue ? (
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
        <DropdownMenu
          className={`master-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
          container="body"
          strategy="fixed"
          modifiers={[
            { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8, altAxis: true } },
            { name: 'flip', options: { boundary: 'viewport', fallbackPlacements: ['top', 'bottom'] } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any}
          style={menuWidth ? (
            fitWidth || (filtered.length === 0 && !loadingMore)
              ? { width: menuWidth, maxWidth: 'calc(100vw - 24px)' }
              : { minWidth: menuWidth, width: 'max-content', maxWidth: `min(${Math.round(menuWidth) + 260}px, calc(100vw - 24px))` }
          ) : undefined}
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
                placeholder={searchPlaceholder ?? 'Search…'}
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
            onScroll={(onScrollEnd || moreToShow) ? (e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight >= 48) return;
              if (onScrollEnd) onScrollEnd();
              else loadMore();
            } : undefined}
          >
            {filtered.length === 0 && !loadingMore ? (
              <div className="master-select-empty">
                {options.length === 0 ? (emptyText ?? 'No options') : 'No results'}
              </div>
            ) : (
              <>
                {visible.map(opt => (
                  <DropdownItem
                    key={opt.value}
                    data-value={opt.value}
                    active={opt.value === currentValue}
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
                    <Tooltip
                      label={opt.disabled ? (opt.disabledReason ?? opt.fullLabel ?? opt.label) : (opt.fullLabel ?? opt.label)}
                      disabled={!opt.disabled && drawsWhole(opt)}
                      position={optionTipPosition}
                    >
                      {(opt.badge || opt.badges?.length) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                          {opt.code && <span className="master-select-code">{opt.code}</span>}
                          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                          <span style={fitWidth
                            ? { marginLeft: 8, display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }
                            : { marginLeft: 8, display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', minWidth: 0, maxWidth: '55%', overflow: 'hidden' }}>
                            {badgesOf(opt).map((b, i, all) => <OptBadge key={i} b={b} shrink={!fitWidth && all.length > 1} noTitle={opt.disabled || !drawsWhole(opt)} />)}
                          </span>
                        </span>
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                          {opt.code && <span className="master-select-code">{opt.code}</span>}
                          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                        </span>
                      )}
                    </Tooltip>
                  </DropdownItem>
                ))}
                {moreToShow && (
                  <button type="button" className="master-select-more" onClick={loadMore} aria-live="polite">
                    {paging ? (
                      <><span className="master-select-more__ring" aria-hidden />Loading more…</>
                    ) : (
                      <>Showing {visible.length} of {filtered.length} · scroll for more</>
                    )}
                  </button>
                )}
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
