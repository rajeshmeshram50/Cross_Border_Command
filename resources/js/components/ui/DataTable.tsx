import { useCallback, useEffect, useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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
  align?: DataTableAlign;
  width?: string | number;
  wrap?: boolean;
}

export type DataTableColumn<T> = ColumnDef<T, any> & { meta?: DataTableColumnMeta };

export interface DataTableTab {
  key: string;
  label: string;
  icon?: string;
  count?: number;
}
const isIconClass = (icon: string) => /^(ri|bx|mdi|fa|las|la|uil)[-\s]/.test(icon);

export interface DataTableChip {
  label: string;
  onRemove: () => void;
}

export type DataTableAccent = 'violet' | 'teal' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  tabs?: DataTableTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchDebounce?: number;
  searchHost?: HTMLElement | null;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  filterLabel?: string;
  filterChips?: DataTableChip[];
  onClearFilters?: () => void;
  toolbarActions?: ReactNode;
  /** Rendered at the START of the toolbar, BEFORE the tabs (e.g. a date-range
   *  filter that should sit to the left of the status tabs). */
  leadingToolbar?: ReactNode;
  initialSort?: SortingState;
  disableSorting?: boolean;
  leading?: DataTableColumn<T>[];
  serial?: boolean | { header?: string; width?: string | number };
  pageSize?: number;
  pageSizeOptions?: number[];
  autoFitRows?: boolean;
  /** Floor for the auto-fit row count. Defaults to 2 (a short window genuinely
   *  fits only a couple). Pages with a tall header above the table (KPI strips,
   *  analytics) can raise this so the table never collapses to 2 rows on a big
   *  screen — the extra rows spill below the fold and the page scrolls. */
  minAutoRows?: number;
  paginate?: boolean;
  /**
   * Hand paging to the server. Omit it and the table behaves exactly as it
   * always has — every screen that doesn't pass this is untouched.
   *
   * When present, `data` is understood to be ONE page that the caller has
   * already fetched: the browser stops slicing, the pager's arrows and its
   * "showing x–y of z" read `total` instead of `data.length`, and moving to
   * another page is reported through `onPageChange` for the caller to refetch.
   *
   * `pageIndex` is controlled — the table renders the page it is given and
   * never advances on its own, so a page that fails to load doesn't leave the
   * pager claiming a page the rows don't belong to.
   *
   * `onPageSizeChange` fires for BOTH sources of a size change: the rows-per-page
   * picker and `autoFitRows` re-measuring after a resize.
   *
   * Search must be server-side too when this is set (pass `searchValue` /
   * `onSearchChange`), otherwise the box filters the current page only.
   */
  serverPagination?: {
    total: number;
    pageIndex: number;
    onPageChange: (pageIndex: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
  };
  accent?: DataTableAccent;
  minWidth?: number;
  fitToViewport?: boolean;
  loading?: boolean;
  emptyMessage?: ReactNode;
  rowClassName?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  children?: ReactNode;
  belowRows?: ReactNode;
}

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SIZE_OPTIONS = [10, 25, 50];

/** Space to keep clear at the bottom of the viewport so a fit-to-viewport card
 *  (and its pager) ends ABOVE the in-flow app footer (Velzon `<footer.footer>`)
 *  instead of running behind it. Measured live so it's right at any footer
 *  height / zoom, plus an 8px breathing gap. Falls back to 15px when there is no
 *  app footer (e.g. the table is rendered inside a modal). */
const bottomReserve = (): number => {
  if (typeof document === 'undefined') return 15;
  const f = document.querySelector('footer.footer') as HTMLElement | null;
  const fh = f?.offsetHeight ?? 0;
  return fh > 0 ? fh + 8 : 15;
};

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
  searchHost,
  onFilterClick,
  activeFilterCount = 0,
  filterLabel = 'Filter',
  filterChips,
  onClearFilters,
  toolbarActions,
  leadingToolbar,
  initialSort,
  disableSorting = false,
  leading,
  serial = false,
  pageSize: pageSizeProp,
  pageSizeOptions = DEFAULT_SIZE_OPTIONS,
  autoFitRows = false,
  minAutoRows = 2,
  paginate = true,
  serverPagination,
  accent = 'violet',
  minWidth,
  fitToViewport = false,
  loading = false,
  emptyMessage = 'No records found',
  rowClassName,
  onRowClick,
  className = '',
  children,
  belowRows,
}: DataTableProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);

  const isSearchControlled = onSearchChange !== undefined;
  const [ownQuery, setOwnQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState(searchValue ?? '');
  useEffect(() => {
    if (isSearchControlled && searchValue !== undefined) setDraftQuery(searchValue);
  }, [isSearchControlled, searchValue]);
  const debouncedDraft = useDebounced(draftQuery, isSearchControlled ? searchDebounce : 0);
  useEffect(() => {
    if (!isSearchControlled) return;
    if (debouncedDraft === (searchValue ?? '')) return;
    onSearchChange?.(debouncedDraft);
  
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
  const allColumns = useMemo<DataTableColumn<T>[]>(() => {
    const lead = leading ?? [];
    if (!serial) return [...lead, ...columns];
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
    return [...lead, srCol, ...columns];
  }, [columns, serial, paginate, leading]);

  const anyWidth = useMemo(
    () => allColumns.some(c => (c.meta as DataTableColumnMeta | undefined)?.width !== undefined),
    [allColumns],
  );
  /* Which page is showing. Server mode reads it from the caller so the table
     can never move to a page whose rows haven't arrived; otherwise it's local
     state and nothing outside needs to know. */
  const serverMode = !!serverPagination;
  const [ownPageIndex, setOwnPageIndex] = useState(0);
  const pageIndex = serverMode ? serverPagination!.pageIndex : ownPageIndex;

  const onPageChange = serverPagination?.onPageChange;
  const setPageIndex = useCallback((next: number | ((prev: number) => number)) => {
    const resolved = typeof next === 'function' ? next(pageIndex) : next;
    // The reset-on-search/tab effect below fires per keystroke; without this
    // guard server mode would refetch page 1 on every letter typed.
    if (resolved === pageIndex) return;
    if (onPageChange) onPageChange(resolved);
    else setOwnPageIndex(resolved);
  }, [pageIndex, onPageChange]);

  /* Report the page size the table settled on. Covers both ways it can change —
     the rows-per-page picker and autoFitRows re-measuring after a resize — so
     the caller doesn't have to watch for each separately. Held in a ref so a
     caller passing an inline arrow doesn't re-fire this on every render. */
  const onPageSizeChangeRef = useRef(serverPagination?.onPageSizeChange);
  onPageSizeChangeRef.current = serverPagination?.onPageSizeChange;
  const sizeIsDecided = manualSize !== null || pageSizeProp !== undefined || autoSize !== null;
  useEffect(() => {
    // Skip the fallback default: reporting it makes the caller fetch a page size
    // that came from neither the user nor the measurement.
    if (!sizeIsDecided) return;
    onPageSizeChangeRef.current?.(pageSize);
  }, [pageSize, sizeIsDecided]);

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
    // Server mode receives one page already sliced — running the slicer over it
    // again would cut a 25-row page down to the first 25 of itself and, worse,
    // show nothing at all on page 2 onwards. The `pagination` state above is
    // still passed so the Sr No column keeps numbering from the page offset.
    getPaginationRowModel: paginate && !serverMode ? getPaginationRowModel() : undefined,
    autoResetPageIndex: false,
  });

  /* Rows behind the pager. Client mode counts what survived the in-browser
     filter; server mode has to be told, because the rows it holds are one page
     and `data.length` would report "1–25 of 25" on every page of 500. */
  const filteredCount = serverMode
    ? serverPagination!.total
    : table.getFilteredRowModel().rows.length;
  const pageCount = paginate ? Math.max(1, Math.ceil(filteredCount / pageSize)) : 1;
  useEffect(() => { if (pageIndex > pageCount - 1) setPageIndex(pageCount - 1); }, [pageIndex, pageCount]);
  useEffect(() => { setPageIndex(0); }, [activeTab, inputValue, filterChips?.length]);

  const rows = table.getRowModel().rows;
  const colIds = table.getVisibleFlatColumns().map(c => c.id);
  const colCount = colIds.length;
  const isEmpty = !loading && rows.length === 0;
  /** Size last handed to the caller, so an identical re-fit is a no-op. */
  const lastEmittedRef = useRef<number | null>(null);
  /** Emits since the last genuine resize — capped, see fitRows. */
  const fitEmitsRef = useRef(0);
  /** Set once the fitted size is within a row of what is displayed. */
  const settledRef = useRef(false);
  const fitRows = useCallback(() => {
    const el = rootRef.current;
    if (!el || !autoFitRows || manualSize !== null) return;
    const top = el.getBoundingClientRect().top;
    const h = Math.max(240, window.innerHeight - top - bottomReserve());
    const px = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetHeight || 0;
    const rowH = px('.dt-table tbody tr:not(.dt-empty-row)') || 44;
    /* The HORIZONTAL scrollbar takes height too and was never subtracted —
     * ~12-15px on a wide table, which is exactly enough for the last row to
     * miss the cut. The box then grew a VERTICAL scrollbar, and a vertical
     * scrollbar spans the whole box including the sticky header. So the thumb
     * cutting through the header band was really a row-counting bug. */
    const scrollBox = el.querySelector('.dt-scroll') as HTMLElement | null;
    const hBar = scrollBox ? Math.max(0, scrollBox.offsetHeight - scrollBox.clientHeight) : 0;
    const avail = h - px('.dt-toolbar') - px('.dt-chipbar') - px('.dt-table thead') - px('.tc-wl-pag') - px('.dt-below-rows') - hBar - 8;
    /* Floor of 2, not 5. On a short window five rows do not fit, and forcing
     * them back in is what puts the scrollbar there in the first place — the
     * page control below already exists to reach the rest. Never 0: a page must
     * show something. */
    const next = Math.max(minAutoRows, Math.floor(avail / rowH));

    // Settled for this viewport — see the ±1 branch below.
    if (settledRef.current) return;

    // Already showing it — re-emitting would only restart the cycle.
    if (lastEmittedRef.current === next) return;

    /* Ignore an off-by-one correction. Server-paginated tables pay a request per
       size change, and one extra row is not worth one — while ±1 is precisely
       what the appearing/disappearing scrollbar oscillates by. A real difference
       (a tall window, a collapsed banner) moves it by far more and still applies.

       Measured against the size ACTUALLY IN PLAY, not just the last size this
       component emitted. On mount nothing has been emitted yet, so keying only
       on lastEmittedRef skipped this guard entirely — and a page that opened at
       a remembered 4 while the fit said 3 spent a whole second request to lose
       one row. That was the leftover second call on every refresh. */
    /* What the caller is currently showing, or null when nothing has been
       decided yet. Null means this is the first real measurement, and it should
       be reported as-is: comparing it to DEFAULT_PAGE_SIZE judged it against a
       number nobody chose, and comparing it to itself would settle without ever
       telling the caller. */
    const baseline = lastEmittedRef.current ?? (sizeIsDecided ? pageSize : null);
    if (serverPagination && baseline !== null && Math.abs(next - baseline) <= 1) {
      /* Close enough — and therefore final. Recording the baseline alone was
         not sufficient: the fit oscillates by a row, so the NEXT measurement
         could sit two rows from that baseline and buy a request anyway. Once a
         size is within a row of what is displayed it is the right size, and
         continuing to measure can only cost requests. Released by a real
         resize, which is the one event that changes the answer. */
      settledRef.current = true;
      return;
    }

    /* One correction per viewport, then stop.

       Two was meant to cover the rowH fallback (44 before any row renders, the
       true height after). But the page above this table is still loading while
       we measure — ten master requests land over four seconds, each shifting
       everything above the table — so the fit chased a moving target and spent
       both emits on it: per_page went 2 → 10 → 2, three fetches for one screen.

       The debounce below means the single measurement we do take is of a
       settled layout, so one correction is enough. */
    fitEmitsRef.current += 1;
    lastEmittedRef.current = next;
    settledRef.current = true;
    setAutoSize(next);
  }, [autoFitRows, manualSize, minAutoRows, serverPagination, pageSize, sizeIsDecided]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !fitToViewport) return;

    /* A rows-per-page the user picked themselves owns the height from then on.
     *
     * fitToViewport pins the card to whatever space is left below it, and the
     * rows area scrolls inside that. On a page carrying a lot above the table
     * that space is only a couple of rows tall — so choosing "10" set the page
     * size to 10 correctly, but eight of those rows sat behind an inner
     * scrollbar and the table still looked like it was showing 2. The setting
     * appeared to do nothing.
     *
     * Releasing the pin lets the card grow to the rows that were asked for and
     * the PAGE scroll instead, which is what picking a row count means. The
     * automatic fit still owns the height until someone overrides it. */
    if (manualSize !== null) {
      el.style.flex = '';
      el.style.height = '';
      el.style.maxHeight = '';
      return;
    }

    const size = () => {
      const top = el.getBoundingClientRect().top;
      const h = `${Math.max(240, window.innerHeight - top - bottomReserve())}px`;
      if (el.style.height === h) return;
      el.style.flex = 'none';
      el.style.height = h;
      el.style.maxHeight = h;
    };
    size();
    const t = window.setTimeout(size, 120);
    window.addEventListener('resize', size);
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
  }, [fitToViewport, loading, manualSize]);

  useEffect(() => {
    if (!autoFitRows) return;
    /* Not while rows are in flight. The skeleton is not the content it stands
       in for, so measuring it yields a different row count — and with
       serverPagination that count is reported back as a new page size, which
       triggers another fetch, which shows the skeleton again. The table
       oscillated between skeleton and rows and never settled. Measuring only
       once the real rows are in place breaks that; the effect still re-runs
       when `loading` drops, so the fit is taken as soon as there is something
       honest to measure. */
    if (loading) return;

    /* Measure only once the page has stopped moving. Content above this table
       (KPI cards, master-driven controls) arrives over several seconds, and each
       arrival fires the observer — measuring on every one meant measuring a
       layout mid-flight and acting on the answer. */
    let debounce: number | undefined;
    const fitSoon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(fitRows, 250);
    };

    const t = window.setTimeout(fitRows, 120);
    /* A real resize legitimately changes the answer, so clear the oscillation
       freeze before re-fitting — otherwise a window the user actually resized
       would stay stuck at whatever size we settled on. */
    const onResize = () => { fitEmitsRef.current = 0; settledRef.current = false; fitSoon(); };
    window.addEventListener('resize', onResize);
    // Anything above the table can grow (a collapsible "what we do here"
    // banner, a KPI strip) — re-fit when the page's own height changes.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fitSoon);
      if (rootRef.current?.parentElement) ro.observe(rootRef.current.parentElement);
      // The horizontal scrollbar appears and disappears as columns/width change
      // and it is part of the budget above. Nothing over the table moves when
      // that happens, so the parent observer alone would never notice.
      const box = rootRef.current?.querySelector('.dt-scroll');
      if (box) ro.observe(box);
    }
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(debounce);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [autoFitRows, fitRows, loading, children]);

  /* The search box, built once and either left in the toolbar or portaled into
     the caller's `searchHost`. Same node either way, so query state, the clear
     button and the debounce behave identically in both placements. */
  const searchBox = searchable ? (
    // When portaled out of .dt-root the box can no longer inherit the accent
    // custom properties, so the modifier class re-declares them from
    // `data-accent` (see the palette blocks in DataTable.css).
    <div className={`dt-search${searchHost ? ' dt-search--detached' : ''}`} data-accent={accent}>
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
  ) : null;
  const searchInToolbar = searchable && !searchHost;
  const showToolbar = !!(tabs?.length || searchInToolbar || onFilterClick || toolbarActions || leadingToolbar);
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
          {leadingToolbar && <div className="dt-lead">{leadingToolbar}</div>}
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
                    {t.icon && (isIconClass(t.icon) ? <i className={t.icon} /> : <span className="dt-tab-emoji">{t.icon}</span>)}
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

          {searchInToolbar && searchBox}

          {toolbarActions && <div className="dt-toolbar-actions">{toolbarActions}</div>}
        </div>
      )}

      {searchHost && searchBox && createPortal(searchBox, searchHost)}

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
            className={`dt-table ${isEmpty ? 'dt-table-empty' : ''}`}
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
                        /* The column's own id, so CSS can target a column by NAME
                           instead of by position. nth-child breaks the moment a
                           column is added, reordered, or rendered conditionally —
                           and then it hides a different column in silence. */
                        data-col={header.column.id}
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
              {/* The shimmer takes colIds, not a bare count: its placeholder
                  cells must carry the same data-col as the header, or the
                  responsive hide-a-column rules reach the header and miss the
                  placeholders — leaving the loading table wider than its own
                  header strip. */}
              {loading ? (
                <ShimmerTableRows rows={Math.min(pageSize, 12)} colIds={colIds} cellClassName="dt-shim-cell" keyPrefix="dt-shim" />
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
                          data-col={cell.column.id}
                          /* Plain-text header, used as the field label when the
                             row collapses into a card on a phone. Only string
                             headers can be read here; a JSX header has no text
                             to borrow, so those cells simply show no label. */
                          data-label={typeof cell.column.columnDef.header === 'string'
                            ? cell.column.columnDef.header
                            : undefined}
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
              {/* A short page is left short on purpose. Blank rows used to pad
                  it out to the fitted height so the ruled lines and zebra ran
                  down to the pager — but they carry the same borders and
                  striping as real rows, so a 6-record result under a 10-row
                  page read as 6 records followed by 4 empty ones. Trailing
                  whitespace under the last row is plainly nothing; a row-shaped
                  blank looks like data that failed to load. */}
            </tbody>
          </table>
        </div>

        {belowRows}

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

/** True while the referenced element's text is visually cut by its own box.
 *  Measured from the DOM (scrollWidth vs clientWidth) rather than guessed from
 *  a character count, so it stays right at any column width or zoom level.
 *  A ResizeObserver keeps it honest when the *column* resizes without the
 *  window doing so (tab switch, data load, sidebar collapse). */
export function useIsClipped(ref: RefObject<HTMLElement | null>, value: unknown) {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const measure = () => { const n = ref.current; if (n) setClipped(n.scrollWidth > n.clientWidth + 1); };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return clipped;
}

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
  const raw = value === null || value === undefined ? '' : String(value).trim();
  const v = raw ? (caseSensitive ? raw : titleCase(raw)) : '';
  const clipped = useIsClipped(ref, v);
  if (!raw) return <span className="dt-dash">{dash}</span>;
  const capped = v.length > max;
  const shown = capped ? `${v.slice(0, max)}…` : v;
  const inner = <span ref={ref} className={`dt-trunc ${className ?? ''}`}>{shown}</span>;
  return capped || clipped ? <Tooltip label={v}>{inner}</Tooltip> : inner;
}

/** Pill variant of TruncCell — for columns whose value is rendered as a chip
 *  (role, tag, category). The chip keeps whatever colours the page gives it
 *  via `className`; this only guarantees the label ellipsises INSIDE the pill
 *  at the column edge instead of spilling under the next column, and that the
 *  full value is reachable on hover once it's actually cut. */
export function ChipCell({
  value,
  className,
  style,
  dash = '—',
}: {
  value?: string | number | null;
  /** The page's own chip class(es), e.g. `exit-role-chip exit-role-chip--primary`. */
  className?: string;
  /** Inline chip colours, for pages that tint per value (role → palette). */
  style?: CSSProperties;
  dash?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const v = value === null || value === undefined ? '' : String(value).trim();
  const clipped = useIsClipped(ref, v);
  if (!v) return <span className="dt-dash">{dash}</span>;
  const chip = <span ref={ref} className={`dt-chip-trunc ${className ?? ''}`} style={style}>{v}</span>;
  return clipped ? <Tooltip label={v}>{chip}</Tooltip> : chip;
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
