import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';
import { LFM_CSS } from '../opportunity-pipeline/LeadFilterModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Party filter modal — shared by Customers and Consignees.
 *
 * Same two-pane shell as the Lead Worksheet's "Filter Leads" (left menu picks
 * a facet, right pane lists its options), reusing that modal's exported
 * stylesheet and lfm-* class names rather than cloning them — only the accent
 * ramp differs, via the `theme` prop.
 *
 * One component for both pages because the two lists filter on the same row
 * fields; Consignee just adds the "Same as Customer" facet. Two near-identical
 * copies would drift the first time either was touched.
 *
 * Purely presentational + client-side: both pages already hold every row for
 * the active tab, and each row carries country / segment / whatsapp, so
 * filtering needs no endpoint. Options are derived from the ROWS THEMSELVES
 * (not the masters) — that way every option shown can actually return a
 * result, instead of offering segments no party has.
 * ───────────────────────────────────────────────────────────────────────── */

export type PartyFilters = {
  /* Domestic == country is India. Single-select: a party is one or the other,
   * never both — hence radio, not checkbox. Mirrors the domestic rule used by
   * the forms, the backend's Gst helper and the consignee mapping guard. */
  region?: 'domestic' | 'international';
  segments?: string[];
  countries?: string[];
  whatsapp?: 'Yes' | 'No';
  /** Consignee only — ignored when the 'sameAs' facet isn't enabled. */
  sameAsCustomer?: 'Yes' | 'No';
};

const EMPTY_FILTERS: PartyFilters = {};

/* Total selected values across all facets — drives the header "N selected"
 * pill, the toolbar badge, and the "did the user pick anything?" Apply check. */
export const countPartyFilterValues = (f: PartyFilters): number => {
  let n = 0;
  if (f.region) n += 1;
  n += f.segments?.length ?? 0;
  n += f.countries?.length ?? 0;
  if (f.whatsapp) n += 1;
  if (f.sameAsCustomer) n += 1;
  return n;
};

export type FacetKey = 'type' | 'segment' | 'country' | 'whatsapp' | 'sameAs';
type Opt = { value: string; label: string };

/** Facets for the Customer list. */
export const CUSTOMER_FACETS: FacetKey[] = ['type', 'segment', 'country', 'whatsapp'];
/** Facets for the Consignee list — the Customer set plus Same as Customer. */
export const CONSIGNEE_FACETS: FacetKey[] = ['type', 'segment', 'country', 'whatsapp', 'sameAs'];

const ICONS: Record<FacetKey, JSX.Element> = {
  type: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  ),
  segment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  country: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z" />
    </svg>
  ),
  whatsapp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  sameAs: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  ),
};

/* The 'type' facet is labelled by the HOST (Customer Type / Consignee Type) so
 * it reads the same as that page's column; the rest are identical everywhere. */
const LABELS: Record<Exclude<FacetKey, 'type'>, string> = {
  segment:  'Segment',
  country:  'Country',
  whatsapp: 'Whatsapp',
  sameAs:   'Same as Customer',
};

/* Single-select facets render radios and clear on re-click; the rest are
 * multi-select checkboxes. Listed here so the render path doesn't special-case
 * facet names inline. */
const SINGLE_SELECT: FacetKey[] = ['type', 'whatsapp', 'sameAs'];

const TYPE_OPTS: Opt[] = [
  { value: 'domestic',      label: 'Domestic' },
  { value: 'international', label: 'International' },
];
const YES_NO_OPTS: Opt[] = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No',  label: 'No' },
];

/** One row, narrowed to just what this modal filters on. */
export type FilterableParty = {
  country?: string | null;
  segment?: string | null;
  whatsapp?: string | null;
  same_as_customer?: boolean;
};

/** India == domestic — the same rule the forms and the backend's Gst use. */
export const isDomesticParty = (c: FilterableParty): boolean =>
  (c.country ?? '').trim() === 'India';

/**
 * Apply the filters to a list of rows. Exported so each page and this modal can
 * never disagree about what a filter MEANS — the pages call this, the modal
 * only collects the selections.
 *
 * Facets AND together (Domestic + Segment X = domestic parties in segment X);
 * values within one facet OR together (Country: India, UK = either).
 */
export function applyPartyFilters<T extends FilterableParty>(rows: T[], f: PartyFilters): T[] {
  return rows.filter(c => {
    if (f.region) {
      const domestic = isDomesticParty(c);
      if (f.region === 'domestic' ? !domestic : domestic) return false;
    }
    if (f.countries?.length && !f.countries.includes((c.country ?? '').trim())) return false;
    if (f.whatsapp && (c.whatsapp ?? '') !== f.whatsapp) return false;
    if (f.sameAsCustomer && (c.same_as_customer ? 'Yes' : 'No') !== f.sameAsCustomer) return false;
    if (f.segments?.length) {
      // segment is a comma-joined string ("Rice, Tobacco") — a row matches when
      // it carries ANY of the picked segments.
      const own = String(c.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (!f.segments.some(s => own.includes(s))) return false;
    }
    return true;
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (filters: PartyFilters) => void;
  initial?: PartyFilters;
  /** The rows currently loaded — Segment/Country options derive from these. */
  rows: FilterableParty[];
  /** Which facets to show. CUSTOMER_FACETS / CONSIGNEE_FACETS. */
  facets: FacetKey[];
  title: string;
  /** Label for the Domestic/International facet — must match the host page's
   *  column header ("Customer Type" / "Consignee Type"). */
  typeLabel: string;
  /** Accent ramp — must match the host page, or the modal reads as foreign. */
  theme: 'purple' | 'emerald';
};

export default function PartyFilterModal({ open, onClose, onApply, initial, rows, facets, title, typeLabel, theme }: Props) {
  const toast = useToast();
  const labelFor = (k: FacetKey): string => (k === 'type' ? typeLabel : LABELS[k]);

  const [active, setActive] = useState<FacetKey>(facets[0]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PartyFilters>(initial ?? EMPTY_FILTERS);

  useEffect(() => {
    if (open) {
      setFilters(initial ?? EMPTY_FILTERS);
      setActive(facets[0]);
      setSearch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // Scroll lock — BOTH <html> and <body>; locking body alone leaves the page
  // behind scrollable when <html> owns the viewport scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  /* Segment + Country options come from the loaded rows, de-duped and sorted.
   * Deriving them from the data (rather than the masters) means the list can
   * never offer a value that returns zero rows. */
  const segmentOpts = useMemo<Opt[]>(() => {
    const seen = new Set<string>();
    rows.forEach(c => String(c.segment ?? '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => seen.add(s)));
    return [...seen].sort((a, b) => a.localeCompare(b)).map(s => ({ value: s, label: s }));
  }, [rows]);

  const countryOpts = useMemo<Opt[]>(() => {
    const seen = new Set<string>();
    rows.forEach(c => { const v = (c.country ?? '').trim(); if (v) seen.add(v); });
    return [...seen].sort((a, b) => a.localeCompare(b)).map(s => ({ value: s, label: s }));
  }, [rows]);

  const optionsFor = (k: FacetKey): Opt[] => {
    switch (k) {
      case 'type':     return TYPE_OPTS;
      case 'segment':  return segmentOpts;
      case 'country':  return countryOpts;
      case 'whatsapp': return YES_NO_OPTS;
      case 'sameAs':   return YES_NO_OPTS;
      default:         return [];
    }
  };

  /* Multi-select toggle. Drops the key entirely once the last value is
   * unchecked, so an empty array never lingers and countPartyFilterValues can
   * stay a simple length sum. */
  const toggleMulti = (k: 'segments' | 'countries', value: string) => {
    setFilters(prev => {
      const current = prev[k] ?? [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...prev, [k]: next.length ? next : undefined };
    });
  };

  /* Single-select. Re-clicking the chosen option clears it — without this a
   * radio group can never be emptied once touched, and the only way back to
   * "no filter on this facet" would be Reset All (which also wipes the rest). */
  const pickSingle = (k: FacetKey, value: string) => {
    setFilters(prev => {
      if (k === 'type') {
        const v = value as 'domestic' | 'international';
        return { ...prev, region: prev.region === v ? undefined : v };
      }
      const v = value as 'Yes' | 'No';
      if (k === 'sameAs') return { ...prev, sameAsCustomer: prev.sameAsCustomer === v ? undefined : v };
      return { ...prev, whatsapp: prev.whatsapp === v ? undefined : v };
    });
  };

  const onApplyClick = () => {
    if (countPartyFilterValues(filters) === 0) {
      toast.warning('No filter selected', 'Pick at least one option before applying');
      return;
    }
    onApply(filters);
    onClose();
  };

  const onClear = () => {
    // Stays OPEN so the user can immediately pick new filters — same behaviour
    // as the Lead filter (QA asked for "don't close the popup on reset").
    setFilters(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  };

  if (!open) return null;

  const currentList = optionsFor(active);
  const searched = search.trim()
    ? currentList.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : currentList;

  const selectedCount = countPartyFilterValues(filters);
  const isSingle = SINGLE_SELECT.includes(active);

  const isChecked = (value: string): boolean => {
    switch (active) {
      case 'type':     return filters.region === value;
      case 'whatsapp': return filters.whatsapp === value;
      case 'sameAs':   return filters.sameAsCustomer === value;
      case 'segment':  return (filters.segments ?? []).includes(value);
      case 'country':  return (filters.countries ?? []).includes(value);
      default:         return false;
    }
  };

  const facetCount = (k: FacetKey): number => {
    switch (k) {
      case 'type':     return filters.region ? 1 : 0;
      case 'segment':  return filters.segments?.length ?? 0;
      case 'country':  return filters.countries?.length ?? 0;
      case 'whatsapp': return filters.whatsapp ? 1 : 0;
      case 'sameAs':   return filters.sameAsCustomer ? 1 : 0;
      default:         return 0;
    }
  };

  return createPortal((
    /* Backdrop click intentionally not wired — it holds the user's in-flight
     * selections; a stray click outside must not wipe them. ✕ / Apply / Reset
     * drive dismissal. Same call as the Lead filter.
     * lfm-purple / lfm-emerald re-theme the shared sheet's accent ramp to the
     * host page; the Lead filter keeps the default cyan. */
    <div className={`lfm-backdrop lfm-${theme}`}>
      <style>{LFM_CSS}</style>
      <div className="lfm-modal">
        <div className="lfm-head">
          <div className="lfm-head-left">
            <div className="lfm-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="6" y1="12" x2="18" y2="12" />
                <line x1="9" y1="18" x2="15" y2="18" />
              </svg>
            </div>
            <div>
              <div className="lfm-head-title">{title}</div>
              <div className="lfm-head-sub">Select filters to narrow down results</div>
            </div>
          </div>
          {selectedCount > 0 && (
            <span className="lfm-head-count">{selectedCount} selected</span>
          )}
          <button className="lfm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="lfm-body">
          <div className="lfm-left">
            <div className="lfm-left-label">FILTER BY</div>
            <div className="lfm-menu">
              {facets.map(k => {
                const count = facetCount(k);
                const isOn = active === k;
                return (
                  <button
                    type="button"
                    key={k}
                    className={`lfm-menu-item ${isOn ? 'on' : ''}`}
                    onClick={() => { setActive(k); setSearch(''); }}
                  >
                    <span className="lfm-menu-ico">{ICONS[k]}</span>
                    <span className="lfm-menu-label">{labelFor(k)}</span>
                    {count > 0 && <span className="lfm-menu-count" aria-hidden="true">{count}</span>}
                  </button>
                );
              })}
            </div>
            <div className="lfm-left-foot">
              <button className="lfm-btn lfm-btn-primary" onClick={onApplyClick}>Apply Filter</button>
              <button className="lfm-btn-reset" onClick={onClear}>Reset All</button>
            </div>
          </div>

          <div className="lfm-right">
            <div className="lfm-search-wrap">
              <svg className="lfm-search-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="lfm-search"
                placeholder={`Search ${labelFor(active).toLowerCase()}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="lfm-options">
              {searched.length === 0 ? (
                <div className="lfm-empty">No options available</div>
              ) : (
                searched.map(opt => {
                  const checked = isChecked(opt.value);
                  return (
                    <label key={opt.value} className={`lfm-card ${checked ? 'on' : ''}`}>
                      <input
                        type={isSingle ? 'radio' : 'checkbox'}
                        name={isSingle ? `facet-${active}` : undefined}
                        checked={checked}
                        readOnly
                        onClick={() => (isSingle
                          ? pickSingle(active, opt.value)
                          : toggleMulti(active === 'segment' ? 'segments' : 'countries', opt.value))}
                      />
                      <span className={`lfm-check ${isSingle ? 'lfm-check-round' : ''}`} aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="lfm-card-label">
                        <span className="lfm-card-name">{opt.label}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
