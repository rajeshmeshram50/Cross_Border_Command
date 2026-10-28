import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LFM_CSS } from '../../pages/sales/opportunity-pipeline/LeadFilterModal';
import SearchClear from './SearchClear';

/* ═══════════════════════════════════════════════════════════════════════════
 * The standard filter popup for an HRMS master.
 *
 * The Holiday list had this built into itself and every other master made do
 * with a bare <select> holding one word, or the compact ToolbarFilter popover.
 * This is that modal, shared and driven by a facet spec: a left rail of
 * categories, a searchable option list on the right, and one Apply.
 *
 * It borrows the `lfm-*` stylesheet the Sales Lead filter owns (LFM_CSS) so
 * the two are the same object rather than two drawings of it; the header is
 * nudged onto the Broadcast Centre's 40px tile here, which is the HRMS modal
 * header standard.
 *
 * DRAFT, not live: nothing leaves this modal until Apply. A master list is
 * usually a server fetch per change, and filtering as you click turns one
 * decision into four requests — and leaves no way to back out of a half-made
 * choice. Reset All applies immediately, because "clear it" has no half state.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface FilterFacetOption {
  value: string;
  label: string;
  /** Shown as a muted count on the right of the row. */
  count?: number;
}

export interface FilterFacet {
  key: string;
  label: string;
  /** Remix class (`ri-calendar-line`) or any node for the rail glyph. */
  icon: ReactNode;
  options: FilterFacetOption[];
  /** Accept several values at once. Single choice by default. */
  multi?: boolean;
  /** Placeholder for the search box; defaults to the label, lower-cased. */
  searchLabel?: string;
}

/** '' or [] for a facet means "everything" — never a sentinel option. */
export type FilterValues = Record<string, string | string[]>;

export interface MasterFilterModalProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Filter Custom Fields". */
  title: string;
  subtitle?: string;
  /** Header glyph; a filter icon by default. */
  icon?: ReactNode;
  facets: FilterFacet[];
  value: FilterValues;
  onApply: (next: FilterValues) => void;
}

const asList = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

/** How many values a facet currently holds — the rail's badge, and the header's. */
const countOf = (v: string | string[] | undefined): number => asList(v).length;

const emptyFor = (facets: FilterFacet[]): FilterValues =>
  Object.fromEntries(facets.map(f => [f.key, f.multi ? [] : '']));

const icon = (node: ReactNode) =>
  typeof node === 'string' ? <i className={node} /> : node;

export default function MasterFilterModal({
  open, onClose, title, subtitle = 'Select filters to narrow down results',
  icon: headIcon, facets, value, onApply,
}: MasterFilterModalProps) {
  const [active, setActive] = useState<string>(facets[0]?.key ?? '');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<FilterValues>(value);

  /* Reopening starts from what is actually applied, not from the draft the
     user walked away from last time. */
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setActive(facets[0]?.key ?? '');
    setSearch('');
    // `value` is intentionally read only on open — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);

    // Lock both, since either can own the viewport scroll.
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = b;
      document.documentElement.style.overflow = h;
    };
  }, [open, onClose]);

  const facet = useMemo(
    () => facets.find(f => f.key === active) ?? facets[0],
    [facets, active],
  );

  const selectedCount = useMemo(
    () => facets.reduce((n, f) => n + countOf(draft[f.key]), 0),
    [facets, draft],
  );

  const shown = useMemo(() => {
    const list = facet?.options ?? [];
    const q = search.trim().toLowerCase();
    return q ? list.filter(o => o.label.toLowerCase().includes(q)) : list;
  }, [facet, search]);

  if (!open || !facet) return null;

  const chosen = asList(draft[facet.key]);

  /* Re-clicking the chosen value clears it: with no "All" row in the list,
     that is the only way back to everything on a single-choice facet. */
  const pick = (v: string) => setDraft(prev => {
    if (facet.multi) {
      const now = asList(prev[facet.key]);
      return { ...prev, [facet.key]: now.includes(v) ? now.filter(x => x !== v) : [...now, v] };
    }
    return { ...prev, [facet.key]: prev[facet.key] === v ? '' : v };
  });

  const apply = () => { onApply(draft); onClose(); };
  const reset = () => {
    const cleared = emptyFor(facets);
    setDraft(cleared);
    onApply(cleared);
  };

  return createPortal((
    <div className="lfm-backdrop lfm-purple" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{LFM_CSS}</style>
      <style>{HEAD_CSS}</style>

      <div className="lfm-modal" role="dialog" aria-label={title}>
        <div className="lfm-head">
          <div className="lfm-head-left">
            <div className="lfm-head-ico">
              {headIcon ? icon(headIcon) : <i className="ri-equalizer-line" />}
            </div>
            <div className="min-w-0">
              <div className="lfm-head-title">{title}</div>
              <div className="lfm-head-sub">{subtitle}</div>
            </div>
          </div>
          {selectedCount > 0 && <span className="lfm-head-count">{selectedCount} selected</span>}
          <button type="button" className="lfm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="lfm-body">
          <div className="lfm-left">
            <div className="lfm-left-label">FILTER BY</div>
            <div className="lfm-menu">
              {facets.map(f => {
                const n = countOf(draft[f.key]);
                return (
                  <button
                    type="button"
                    key={f.key}
                    className={`lfm-menu-item ${active === f.key ? 'on' : ''}`}
                    onClick={() => { setActive(f.key); setSearch(''); }}
                  >
                    <span className="lfm-menu-ico">{icon(f.icon)}</span>
                    <span className="lfm-menu-label">{f.label}</span>
                    {n > 0 && <span className="lfm-menu-count" aria-hidden="true">{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className="lfm-left-foot">
              <button type="button" className="lfm-btn lfm-btn-primary" onClick={apply}>Apply Filter</button>
              <button type="button" className="lfm-btn-reset" onClick={reset}>Reset All</button>
            </div>
          </div>

          <div className="lfm-right">
            <div className="lfm-search-wrap ui-search-abs">
              <i className="ri-search-line lfm-search-ico" />
              <input
                className="lfm-search"
                autoComplete="off"
                placeholder={`Search ${facet.searchLabel ?? facet.label.toLowerCase()}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <SearchClear show={search} onClear={() => setSearch('')} />
            </div>

            <div className="lfm-options">
              {shown.length === 0 ? (
                <div className="lfm-empty">
                  {search.trim() ? `No ${facet.label.toLowerCase()} matches “${search.trim()}”` : 'No options available'}
                </div>
              ) : shown.map(opt => {
                const on = chosen.includes(opt.value);
                return (
                  <label key={opt.value} className={`lfm-card ${on ? 'on' : ''}`}>
                    <input
                      type={facet.multi ? 'checkbox' : 'radio'}
                      name={`mfm-${facet.key}`}
                      checked={on}
                      readOnly
                      onClick={() => pick(opt.value)}
                    />
                    <span className={`lfm-check${facet.multi ? '' : ' lfm-check-round'}`} aria-hidden="true">
                      <i className="ri-check-line" />
                    </span>
                    <span className="lfm-card-label">
                      <span className="lfm-card-name">{opt.label}</span>
                    </span>
                    {typeof opt.count === 'number' && <span className="mfm-count">{opt.count}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

/* The header, on the Broadcast Centre's measurements — a 40px tile at radius
   11 with a 2px ring. The band, title and subtitle in LFM_CSS already match
   it (14/20, 17px/1.2, 12px at .85), so only the tile and the close move. */
const HEAD_CSS = `
.lfm-head-ico {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.22);
  border: 2px solid rgba(255,255,255,.55);
  font-size: 18px; color: #fff;
}
.lfm-close { width: 32px; height: 32px; border-radius: 8px; font-size: 18px; }
.lfm-search-ico { font-size: 14px; }
/* The per-option tally, where a facet supplies one. */
.mfm-count {
  margin-left: auto; flex-shrink: 0;
  font-size: 11px; font-weight: 700;
  color: var(--vz-secondary-color);
}
.lfm-card.on .mfm-count { color: inherit; opacity: .85; }
`;

/* ═══════════════════════════════════════════════════════════════════════════
 * The toolbar trigger + the modal, as one node.
 *
 * Drop this into DataTable's `toolbarFilters` and the page keeps a single
 * slot: the button is DataTable's own .dt-filter-btn, so it inherits the 40px
 * square the HRMS stylesheet gives it and carries a count of what is applied.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function MasterFilterButton({
  title, subtitle, icon: headIcon, facets, value, onApply,
}: Omit<MasterFilterModalProps, 'open' | 'onClose'>) {
  const [open, setOpen] = useState(false);

  const applied = facets.reduce((n, f) => n + countOf(value[f.key]), 0);

  return (
    <div className="dt-fwrap">
      <button
        type="button"
        className={`dt-filter-btn${applied ? ' on' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={applied > 0 ? `Filter — ${applied} applied` : 'Filter'}
        title={applied > 0 ? `Filter — ${applied} applied` : 'Filter'}
      >
        <i className="ri-equalizer-line" />
        <span className="dt-filter-lbl">Filter</span>
        {applied > 0 && <span className="dt-filter-badge">{applied}</span>}
      </button>

      <MasterFilterModal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        icon={headIcon}
        facets={facets}
        value={value}
        onApply={onApply}
      />
    </div>
  );
}
