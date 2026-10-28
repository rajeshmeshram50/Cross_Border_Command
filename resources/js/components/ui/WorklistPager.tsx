/**
 * WorklistPager — the "My Workplace / Client table" style pagination footer:
 * a rounded "Showing X–Y of Z" pill, an optional Rows-per-page pill, a filled
 * "page / pages" gradient pill and circular ‹ › arrow buttons, on a soft
 * violet band. Shares the global `.tc-wl-*` pill/button classes (app.css);
 * uses the non-bleed `.wl-pager` band so it drops cleanly into any card.
 */
import type { ReactNode } from 'react';
import RowsPerPageSelect from './RowsPerPageSelect';
import { Shimmer } from './Shimmer';

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
  /** Appended to the "Showing…" line after a middot — a fact about the whole
   *  set that belongs beside the count rather than on a second line. */
  note?: ReactNode;
  /** Drop the page controls when everything already fits on one page, so the
   *  footer doesn't carry a "1 / 1" and two dead arrows. */
  hideNavWhenSinglePage?: boolean;
  /** The rows above are still loading. `total` is 0 until they land, so
   *  without this the footer reads "No records" over a table full of
   *  shimmer — it states a result the page does not have yet. While it is
   *  set the count shimmers instead, and the page controls are inert so a
   *  click cannot ask for page 2 of a set whose size is still unknown.
   *  Opt-in: every caller that omits it behaves exactly as before. */
  loading?: boolean;
}

export default function WorklistPager({
  total, page, pageSize, onPage, onPageSize, pageSizeOptions = [10, 25, 50], className,
  note, hideNavWhenSinglePage, loading,
}: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  const showNav = !hideNavWhenSinglePage || pages > 1;
  return (
    <div className={`wl-pager${className ? ` ${className}` : ''}`}>
      <span className="tc-wl-info">
        {loading
          ? <Shimmer width={96} height={9} radius={5} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
          : total === 0
            ? 'No records'
            : <>Showing <span className="tc-wl-hl">{start + 1}–{Math.min(start + pageSize, total)}</span> of <span className="tc-wl-hl">{total}</span></>}
        {!loading && note != null && <> · {note}</>}
      </span>
      {showNav && <div className="tc-wl-right">
        {onPageSize && (
          <span className="tc-wl-rows">
            Rows per page:
            <RowsPerPageSelect value={pageSize} options={pageSizeOptions} onChange={onPageSize} />
          </span>
        )}
        {/* "1 / 1" is what an unknown total computes to, which is a page
            count the footer has no way to know yet. */}
        <span className="tc-wl-range">
          {loading
            ? <Shimmer width={26} height={9} radius={5} style={{ display: 'inline-block', verticalAlign: 'middle', backgroundColor: 'rgba(255,255,255,.45)' }} />
            : <>{safePage} / {pages}</>}
        </span>
        <div className="tc-wl-nav">
          <button type="button" className="tc-wl-btn" disabled={loading || safePage <= 1} onClick={() => onPage(safePage - 1)} aria-label="Previous page">
            <i className="ri-arrow-left-s-line"></i>
          </button>
          <button type="button" className="tc-wl-btn" disabled={loading || safePage >= pages} onClick={() => onPage(safePage + 1)} aria-label="Next page">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
      </div>}
    </div>
  );
}
