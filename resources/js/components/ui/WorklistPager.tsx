/**
 * WorklistPager — the "My Workplace / Client table" style pagination footer:
 * a rounded "Showing X–Y of Z" pill, an optional Rows-per-page pill, a filled
 * "page / pages" gradient pill and circular ‹ › arrow buttons, on a soft
 * violet band. Shares the global `.tc-wl-*` pill/button classes (app.css);
 * uses the non-bleed `.wl-pager` band so it drops cleanly into any card.
 */
import RowsPerPageSelect from './RowsPerPageSelect';

interface Props {
  /** Total row count across all pages. */
  total: number;
  /** Current page (1-based). */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Called with the new 1-based page. */
  onPage: (p: number) => void;
  /** When provided, renders the Rows-per-page selector. */
  onPageSize?: (n: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export default function WorklistPager({
  total, page, pageSize, onPage, onPageSize, pageSizeOptions = [10, 25, 50], className,
}: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  return (
    <div className={`wl-pager${className ? ` ${className}` : ''}`}>
      <span className="tc-wl-info">
        {total === 0
          ? 'No records'
          : <>Showing <span className="tc-wl-hl">{start + 1}–{Math.min(start + pageSize, total)}</span> of <span className="tc-wl-hl">{total}</span></>}
      </span>
      <div className="tc-wl-right">
        {onPageSize && (
          <span className="tc-wl-rows">
            Rows per page:
            <RowsPerPageSelect value={pageSize} options={pageSizeOptions} onChange={onPageSize} />
          </span>
        )}
        <span className="tc-wl-range">{safePage} / {pages}</span>
        <div className="tc-wl-nav">
          <button type="button" className="tc-wl-btn" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)} aria-label="Previous page">
            <i className="ri-arrow-left-s-line"></i>
          </button>
          <button type="button" className="tc-wl-btn" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)} aria-label="Next page">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
      </div>
    </div>
  );
}
