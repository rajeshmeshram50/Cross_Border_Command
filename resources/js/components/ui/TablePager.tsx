import { useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * The app's pager, for a table that is not a DataTable.
 *
 * Several HRMS lists are hand-built <table>s rather than DataTables — the
 * Holiday list and its groups, Leave Plans and its leave types, the batch
 * payment picker — and each of them simply rendered every row it had, with no
 * footer at all (QA #124, #125, #127–#130).
 *
 * This renders the same `.tc-wl-*` markup DataTable's own footer does, off the
 * same stylesheet (resources/css/app.css), so a paged hand-built table is
 * pixel-identical to the DataTable beside it. It owns only the page state and
 * hands back the slice; it does not touch the table.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface TablePagerProps {
  /** Rows in the filtered set — not the slice. */
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  pageSizeOptions?: number[];
}

/** Slice a list for the page a `usePager` is on. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice(page * pageSize, page * pageSize + pageSize);
}

/**
 * Page state for a hand-built table. Ten rows a page, as the backend serves.
 *
 * The page is clamped whenever the row count drops — deleting the last row of
 * page 3, or typing into a search, otherwise leaves the table on a page that
 * no longer exists and showing nothing at all.
 */
export function usePager(total: number, initialSize = 10) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  return {
    page, pageSize, pageCount,
    setPage,
    setPageSize: (n: number) => { setPageSize(n); setPage(0); },
  };
}

export default function TablePager({
  total, page, pageSize, onPage, onPageSize,
  pageSizeOptions = [10, 25, 50, 100],
}: TablePagerProps) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeRef = useRef<HTMLSpanElement>(null);

  // Outside click shuts the rows-per-page menu, as it does on a DataTable.
  useEffect(() => {
    if (!sizeOpen) return;

    const away = (e: MouseEvent) => {
      if (!sizeRef.current?.contains(e.target as Node)) setSizeOpen(false);
    };

    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [sizeOpen]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(page * pageSize + pageSize, total);

  return (
    <div className="tc-wl-pag">
      <span className="tc-wl-info">
        {total === 0
          ? 'No records'
          : <>Showing <span className="tc-wl-hl">{from}–{to}</span> of <span className="tc-wl-hl">{total}</span></>}
      </span>
      <div className="tc-wl-right">
        <span className="tc-wl-rows">
          Rows per page:
          <span className="tc-wl-rows-sel" ref={sizeRef}>
            <button
              type="button"
              className="tc-wl-rows-btn"
              aria-haspopup="listbox"
              aria-expanded={sizeOpen}
              aria-label={`Rows per page: ${pageSize}`}
              onClick={() => setSizeOpen(o => !o)}
            >
              {pageSize}
              <i className={sizeOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} />
            </button>
            {sizeOpen && (
              <span className="tc-wl-rows-menu" role="listbox" aria-label="Rows per page">
                {[...new Set([pageSize, ...pageSizeOptions])].sort((a, b) => a - b).map(n => (
                  <button
                    key={n}
                    type="button"
                    role="option"
                    aria-selected={n === pageSize}
                    className={n === pageSize ? 'is-on' : undefined}
                    onClick={() => { onPageSize(n); setSizeOpen(false); }}
                  >
                    {n}
                  </button>
                ))}
              </span>
            )}
          </span>
        </span>
        <span className="tc-wl-range">{page + 1} / {pageCount}</span>
        <div className="tc-wl-nav">
          <button
            type="button" className="tc-wl-btn" aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPage(Math.max(0, page - 1))}
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button" className="tc-wl-btn" aria-label="Next page"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
          >
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
    </div>
  );
}
