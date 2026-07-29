import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import './DataTable.css';
import { ShimmerTableRows } from './Shimmer';
import Tooltip from './Tooltip';
export type DataTableAlign = 'left' | 'start' | 'center' | 'right' | 'end';

export interface DataTableColumnMeta {
  /** Header + cell alignment. Default 'left'. */
  align?: DataTableAlign;
  width?: string | number;
  wrap?: boolean;
}

/** A column def with our `meta` shape pre-typed. */
export type DataTableColumn<T> = ColumnDef<T, any> & { meta?: DataTableColumnMeta };

export interface DataTableTab {
  key: string;
  label: string;
  icon?: string;
  count?: number;
}

export interface DataTableChip {
  label: string;
  onRemove: () => void;
}

export type DataTableAccent = 'violet' | 'teal' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];

  /* ── Tabs (pill rail, left of the toolbar) ── */
  tabs?: DataTableTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;

  /* ── Search ── */
  /** Set false to hide the search field entirely. Default true. */
  searchable?: boolean;
  /** Controlled value ⇒ the PARENT filters (usually server-side). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Debounce for the controlled onSearchChange. Default 300ms; 0 disables. */
  searchDebounce?: number;

  /* ── Filter button + chips ── */
  onFilterClick?: () => void;
  activeFilterCount?: number;
  filterLabel?: string;
  filterChips?: DataTableChip[];
  onClearFilters?: () => void;

  /** Extra controls rendered at the right end of the toolbar. */
  toolbarActions?: ReactNode;

  /* ── Sorting ── */
  initialSort?: SortingState;
  /** Turn every header into a static label. Default false (sorting on). */
  disableSorting?: boolean;

  /** Prepend an auto-numbered "Sr No" column. Counts the row's VISIBLE
   *  position (page offset + place in the current sort), so it stays 1..n
   *  down the screen instead of exposing the underlying data index. */
  serial?: boolean | { header?: string; width?: string | number };

  /* ── Pagination ── */
  /** Rows per page. Default 10 (or the auto-fit result). */
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Size the page to however many rows fit the viewport. Default false. */
  autoFitRows?: boolean;
  /** Set false for a single un-paged scroll list. Default true. */
  paginate?: boolean;

  /* ── Presentation ── */
  accent?: DataTableAccent;
  /** Below this the wrapper scrolls horizontally instead of crushing columns. */
  minWidth?: number;
  /** Make the card fill the viewport below its top edge (scrolling body). */
  fitToViewport?: boolean;
  loading?: boolean;
  /** Shown in place of rows when `data` is empty. */
  emptyMessage?: ReactNode;
  rowClassName?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  /** Rendered between the toolbar and the table (banners, KPI strips…). */
  children?: ReactNode;
}

const DEFAULT_PAGE_SIZE = 10;
/* Same set as My Workplace (SalesLeadWorksheet's ROWS_PER_PAGE_OPTIONS) and the
 * shared WorklistPager default, so every list in the app offers the same
 * rows-per-page choices. The auto-fit size is merged into the list at render
 * time, so a computed 8 or 14 still appears as a selectable option. */
const DEFAULT_SIZE_OPTIONS = [10, 25, 50];

const alignToCss = (a?: DataTableAlign): 'left' | 'center' | 'right' =>
  a === 'center' ? 'center' : a === 'right' || a === 'end' ? 'right' : 'left';
const containsFilter: FilterFn<any> = (row, _columnId, value) => {
  const needle = String(value ?? '').trim().toLowerCase();
  if (!needle) return true;
  return row.getAllCells().some(cell => {
    const v = cell.getValue();
    if (v === null || v === undefined) return false;
    return String(v).toLowerCase().includes(needle);
  });
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (!ms) { setV(value); return; }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DataTable<T extends object>({
  data,
  columns,
  tabs,
  activeTab,
  onTabChange,
  searchable = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  searchDebounce = 300,
  onFilterClick,
  activeFilterCount = 0,
  filterLabel = 'Filter',
  filterChips,
  onClearFilters,
  toolbarActions,
  initialSort,
  disableSorting = false,
  serial = false,
  pageSize: pageSizeProp,
  pageSizeOptions = DEFAULT_SIZE_OPTIONS,
  autoFitRows = false,
  paginate = true,
  accent = 'violet',
  minWidth,
  fitToViewport = false,
  loading = false,
  emptyMessage = 'No records found',
  rowClassName,
  onRowClick,
  className = '',
  children,
}: DataTableProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);

  const isSearchControlled = onSearchChange !== undefined;
  const [ownQuery, setOwnQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState(searchValue ?? '');
  useEffect(() => {
    // Keep the input in step when the parent resets/overwrites the value.
    if (isSearchControlled && searchValue !== undefined) setDraftQuery(searchValue);
  }, [isSearchControlled, searchValue]);
  const debouncedDraft = useDebounced(draftQuery, isSearchControlled ? searchDebounce : 0);
  useEffect(() => {
    if (!isSearchControlled) return;
    if (debouncedDraft === (searchValue ?? '')) return;
    onSearchChange?.(debouncedDraft);
    // `searchValue` is intentionally read, not depended on: including it would
    // re-fire the callback with a stale draft right after the parent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraft, isSearchControlled]);
  const inputValue = isSearchControlled ? draftQuery : ownQuery;
  const onInput = (v: string) => (isSearchControlled ? setDraftQuery(v) : setOwnQuery(v));

  /* ── Page size: prop → auto-fit → default. A manual pick beats auto-fit. ── */
  const [autoSize, setAutoSize] = useState<number | null>(null);
  const [manualSize, setManualSize] = useState<number | null>(null);
  const pageSize = manualSize ?? pageSizeProp ?? autoSize ?? DEFAULT_PAGE_SIZE;

  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const [globalFilter, setGlobalFilter] = useState('');
  useEffect(() => { if (!isSearchControlled) setGlobalFilter(ownQuery); }, [ownQuery, isSearchControlled]);

  /* The Sr No column, when asked for. It numbers the row's VISIBLE position:
   * TanStack's `row.index` is the position in the ORIGINAL data array, so using
   * it would jumble the serials the moment a column is sorted (rows 1, 7, 3…).
   * The findIndex is over the current page only (≤ pageSize rows), so the cost
   * is negligible. */
  const allColumns = useMemo<DataTableColumn<T>[]>(() => {
    if (!serial) return columns;
    const cfg = typeof serial === 'object' ? serial : {};
    const srCol: DataTableColumn<T> = {
      id: '__dt_serial',
      header: cfg.header ?? 'Sr No',
      enableSorting: false,
      meta: { align: 'center', width: cfg.width ?? 56 },
      cell: info => {
        const pos = info.table.getRowModel().rows.findIndex(r => r.id === info.row.id);
        const offset = paginate
          ? (info.table.getState().pagination?.pageIndex ?? 0) * (info.table.getState().pagination?.pageSize ?? 0)
          : 0;
        return <span className="dt-serial">{offset + pos + 1}</span>;
      },
    };
    return [srCol, ...columns];
  }, [columns, serial, paginate]);

  const anyWidth = useMemo(
    () => allColumns.some(c => (c.meta as DataTableColumnMeta | undefined)?.width !== undefined),
    [allColumns],
  );

  /* Pagination is fully controlled here rather than left to the table, because
   * the page index has to survive a page-size change (auto-fit re-measures on
   * every resize) and be clamped when a filter shrinks the row count — sitting
   * on page 5 of a set that just became 3 rows would show an empty table with
   * no hint that there IS data, just on another page. */
  const [pageIndex, setPageIndex] = useState(0);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting,
      globalFilter,
      ...(paginate ? { pagination: { pageIndex, pageSize } } : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: updater => {
      const next = typeof updater === 'function'
        ? updater({ pageIndex, pageSize })
        : updater;
      setPageIndex(next.pageIndex);
    },
    globalFilterFn: containsFilter,
    enableSorting: !disableSorting,
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: paginate ? getPaginationRowModel() : undefined,
    autoResetPageIndex: false,
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = paginate ? Math.max(1, Math.ceil(filteredCount / pageSize)) : 1;
  useEffect(() => { if (pageIndex > pageCount - 1) setPageIndex(pageCount - 1); }, [pageIndex, pageCount]);
  // Back to page 1 whenever the visible set is redefined (tab, search, filters).
  useEffect(() => { setPageIndex(0); }, [activeTab, inputValue, filterChips?.length]);

  const rows = table.getRowModel().rows;
  const colCount = table.getVisibleFlatColumns().length;
  const fitRows = useCallback(() => {
    const el = rootRef.current;
    if (!el || !autoFitRows || manualSize !== null) return;
    const top = el.getBoundingClientRect().top;
    const h = Math.max(240, window.innerHeight - top - 15);
    const px = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetHeight || 0;
    const rowH = px('.dt-table tbody tr') || 44;
    const avail = h - px('.dt-toolbar') - px('.dt-chipbar') - px('.dt-table thead') - px('.tc-wl-pag') - 8;
    setAutoSize(Math.max(5, Math.floor(avail / rowH)));
  }, [autoFitRows, manualSize]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !fitToViewport) return;
    const size = () => {
      const top = el.getBoundingClientRect().top;
      const h = `${Math.max(240, window.innerHeight - top - 15)}px`;
      // No-op writes matter here: setting the height resizes the parent, which
      // re-fires the observer below. Bailing out when the value is unchanged is
      // what makes that settle instead of looping.
      if (el.style.height === h) return;
      el.style.flex = 'none';
      el.style.height = h;
      el.style.maxHeight = h;
    };
    size();
    const t = window.setTimeout(size, 120);
    window.addEventListener('resize', size);
    /* Whatever sits above the table can change height after first paint (KPI
     * cards resolving their counts, a collapsible banner opening) — that moves
     * our top edge, so re-measure instead of keeping a stale height that either
     * overflows the fold or leaves a gap. */
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => size());
      if (el.parentElement) ro.observe(el.parentElement);
    }
    return () => {
      window.removeEventListener('resize', size);
      window.clearTimeout(t);
      ro?.disconnect();
    };
  }, [fitToViewport, loading]);

  useEffect(() => {
    if (!autoFitRows) return;
    fitRows();
    const t = window.setTimeout(fitRows, 120);
    window.addEventListener('resize', fitRows);
    // Anything above the table can grow (a collapsible "what we do here"
    // banner, a KPI strip) — re-fit when the page's own height changes.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fitRows());
      if (rootRef.current?.parentElement) ro.observe(rootRef.current.parentElement);
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', fitRows);
      ro?.disconnect();
    };
  }, [autoFitRows, fitRows, loading, children]);

  const showToolbar = !!(tabs?.length || searchable || onFilterClick || toolbarActions);
  const start = pageIndex * pageSize;
  const shownFrom = filteredCount === 0 ? 0 : start + 1;
  const shownTo = paginate ? Math.min(start + pageSize, filteredCount) : filteredCount;

  return (
    <div
      ref={rootRef}
      data-accent={accent}
      className={`dt-root ${fitToViewport ? 'dt-fit' : ''} ${className}`}
    >
      {showToolbar && (
        <div className="dt-toolbar">
          {!!tabs?.length && (
            <div className="dt-tabs" role="tablist">
              {tabs.map(t => {
                const on = t.key === activeTab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={`dt-tab ${on ? 'on' : 'off'}`}
                    onClick={() => onTabChange?.(t.key)}
                  >
                    {t.icon && <i className={t.icon} />}
                    {t.label}
                    {t.count !== undefined && <span className="dt-tab-count">{t.count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {onFilterClick && (
            <button
              type="button"
              className={`dt-filter-btn ${activeFilterCount > 0 ? 'on' : ''}`}
              onClick={onFilterClick}
            >
              <i className="ri-equalizer-line" />
              {filterLabel}
              {activeFilterCount > 0 && <span className="dt-filter-badge">{activeFilterCount}</span>}
            </button>
          )}

          {searchable && (
            <div className="dt-search">
              <i className="ri-search-line dt-search-icon" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={inputValue}
                onChange={e => onInput(e.target.value)}
              />
              {inputValue && (
                <button type="button" className="dt-search-clear" aria-label="Clear search" onClick={() => onInput('')}>
                  <i className="ri-close-line" />
                </button>
              )}
            </div>
          )}

          {toolbarActions && <div className="dt-toolbar-actions">{toolbarActions}</div>}
        </div>
      )}

      {/* Applied filters, each removable — a filtered table that looks empty is
          otherwise read as "there is no data". */}
      {!!filterChips?.length && (
        <div className="dt-chipbar">
          <span className="dt-chipbar-lbl">Filters:</span>
          {filterChips.map((chip, i) => (
            <span key={`${chip.label}-${i}`} className="dt-chip">
              {chip.label}
              <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label}`}>×</button>
            </span>
          ))}
          {onClearFilters && (
            <button type="button" className="dt-chipbar-clear" onClick={onClearFilters}>Clear all</button>
          )}
        </div>
      )}

      {children}

      <div className="dt-table-wrap">
        <div className="dt-scroll">
          <table
            className="dt-table"
            style={{ minWidth, tableLayout: anyWidth ? 'fixed' : 'auto' }}
          >
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => {
                    const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined;
                    const textAlign = alignToCss(meta?.align);
                    const canSort = header.column.getCanSort();
                    const dir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        style={{ textAlign, width: meta?.width }}
                        className={canSort ? 'dt-sortable' : undefined}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                        title={canSort ? 'Click to sort' : undefined}
                      >
                        <span
                          className="dt-th-inner"
                          style={{ justifyContent: textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start' }}
                        >
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <i
                              className={`dt-sort ${
                                dir === 'asc' ? 'ri-arrow-up-s-fill on'
                                  : dir === 'desc' ? 'ri-arrow-down-s-fill on'
                                    : 'ri-arrow-up-down-line'
                              }`}
                            />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading ? (
                <ShimmerTableRows rows={Math.min(pageSize, 12)} cols={colCount} cellClassName="dt-shim-cell" keyPrefix="dt-shim" />
              ) : rows.length === 0 ? (
                <tr className="dt-empty-row">
                  <td colSpan={colCount}>
                    <div className="dt-empty">{emptyMessage}</div>
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`${rowClassName?.(row.original, i) ?? ''} ${onRowClick ? 'dt-clickable' : ''}`}
                    onClick={onRowClick ? () => onRowClick(row.original, i) : undefined}
                  >
                    {row.getVisibleCells().map(cell => {
                      const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined;
                      return (
                        <td
                          key={cell.id}
                          style={{ textAlign: alignToCss(meta?.align) }}
                          className={meta?.wrap ? 'dt-wrap' : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer reuses the app-wide `.tc-wl-*` pager (resources/css/app.css)
            so this table's pagination is pixel-identical to the Customer /
            Consignee / Worklist ones and re-themes from the same vars. */}
        {paginate && (
          <div className="tc-wl-pag">
            <span className="tc-wl-info">
              {filteredCount === 0
                ? 'No records'
                : <>Showing <span className="tc-wl-hl">{shownFrom}–{shownTo}</span> of <span className="tc-wl-hl">{filteredCount}</span></>}
            </span>
            <div className="tc-wl-right">
              <span className="tc-wl-rows">
                Rows per page:
                <select
                  value={pageSize}
                  onChange={e => { setManualSize(parseInt(e.target.value, 10)); setPageIndex(0); }}
                >
                  {[...new Set([pageSize, ...pageSizeOptions])].sort((a, b) => a - b).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </span>
              <span className="tc-wl-range">{pageIndex + 1} / {pageCount}</span>
              <div className="tc-wl-nav">
                <button
                  type="button" className="tc-wl-btn" aria-label="Previous page"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                >
                  <i className="ri-arrow-left-s-line" />
                </button>
                <button
                  type="button" className="tc-wl-btn" aria-label="Next page"
                  disabled={pageIndex >= pageCount - 1}
                  onClick={() => setPageIndex(p => Math.min(pageCount - 1, p + 1))}
                >
                  <i className="ri-arrow-right-s-line" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cell helpers — the same four cell renderers every list page was
   re-implementing (TruncatedCell / id chip / type pill / icon action).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Upper-cases the first letter only, and leaves ALL-CAPS values (GST, IEC,
 *  country codes) alone so they aren't mangled into "Gst". */
export const titleCase = (s: string): string => {
  if (!s) return s;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s;
  const idx = s.search(/[a-zA-Z]/);
  return idx === -1 ? s : s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
};

/** One-line cell that ellipsises and shows the full value on hover.
 *  The tooltip fires when the text is cut by EITHER the `max` char cap or the
 *  column width — the visual clip is measured from the DOM, because a 29-char
 *  email in a narrow column is cut without ever hitting the char cap. */
export function TruncCell({
  value,
  className,
  max = 60,
  caseSensitive = false,
  dash = '—',
}: {
  value?: string | number | null;
  className?: string;
  max?: number;
  /** Keep the value exactly as stored (emails, codes). */
  caseSensitive?: boolean;
  dash?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const raw = value === null || value === undefined ? '' : String(value).trim();
  const v = raw ? (caseSensitive ? raw : titleCase(raw)) : '';
  useEffect(() => {
    const measure = () => { const el = ref.current; if (el) setClipped(el.scrollWidth > el.clientWidth + 1); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [v]);
  if (!raw) return <span className="dt-dash">{dash}</span>;
  const capped = v.length > max;
  const shown = capped ? `${v.slice(0, max)}…` : v;
  const inner = <span ref={ref} className={`dt-trunc ${className ?? ''}`}>{shown}</span>;
  return capped || clipped ? <Tooltip label={v}>{inner}</Tooltip> : inner;
}

/** Monospace code chip — customer/consignee/lead IDs, PO numbers. */
export function IdCell({ value }: { value?: string | number | null }) {
  const v = value === null || value === undefined || value === '' ? '' : String(value);
  return v ? <span className="dt-id-chip">{v}</span> : <span className="dt-dash">—</span>;
}

/** Coloured status/type pill. Pass `tone` for one of the built-in colours or
 *  `colors` for an arbitrary palette (e.g. a per-customer-type map). */
export function PillCell({
  value,
  tone = 'neutral',
  colors,
}: {
  value?: string | null;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  colors?: { bg: string; color: string; border?: string };
}) {
  const v = (value ?? '').trim();
  if (!v) return <span className="dt-dash">—</span>;
  return (
    <span
      className={`dt-pill dt-pill-${tone}`}
      style={colors ? { background: colors.bg, color: colors.color, borderColor: colors.border ?? colors.bg } : undefined}
    >
      {v}
    </span>
  );
}

/** Icon action button for the Actions column — tooltip label is mandatory so
 *  an icon-only control is never unlabelled for screen readers. */
export function ActionCell({
  title,
  icon,
  tone = 'accent',
  onClick,
  disabled = false,
}: {
  title: string;
  icon: string;
  tone?: 'accent' | 'success' | 'info' | 'warning' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}) {
  const btn = (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      className={`dt-act dt-act-${tone}`}
      onClick={e => { e.stopPropagation(); onClick(); }}
    >
      <i className={icon} />
    </button>
  );
  return disabled ? btn : <Tooltip label={title}>{btn}</Tooltip>;
}
