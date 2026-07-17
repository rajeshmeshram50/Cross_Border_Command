import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Filter modal.
 *
 * Two-pane layout mirroring the legacy IDIMS modal: a left menu picks the
 * facet (Stage / Platform / Lead Type / Country / Customer / Date), the
 * right pane shows the searchable options for that facet (radio list)
 * plus a single-shot "Apply Filter" button that hands the resulting
 * LeadFilters back to the parent.
 *
 * All option data is supplied by the parent (which fetches it once via
 * GET /sales/leads/filter-options and caches it for the session). This
 * modal stays presentational and lifecycle-light so opening/closing
 * doesn't fire any network calls.
 * ───────────────────────────────────────────────────────────────────────── */

/* Facet fields are multi-select (checkbox) — each holds an array of the
 * picked values; the backend turns these into `whereIn`. `salesperson_id`
 * stays single (set by "View Leads" in the Assigned Leads modal) and the
 * date facet is a single range. */
export type LeadFilters = {
  lead_stage_id?: string[];
  platform?: string[];
  query_type?: string[];
  sender_country_iso?: string[];
  customer_id?: string[];
  salesperson_id?: string;   // applied by "View Leads" in the Assigned Leads modal
  start_date?: string;
  end_date?: string;
};

/* Multi-select facet fields — the ones the checkbox UI toggles. */
type MultiField = 'lead_stage_id' | 'platform' | 'query_type' | 'sender_country_iso' | 'customer_id';

/* Total number of individually-selected values across all facets — drives
 * the header "N selected" badge. */
export const countFilterValues = (f: LeadFilters): number => {
  let n = 0;
  n += f.lead_stage_id?.length ?? 0;
  n += f.platform?.length ?? 0;
  n += f.query_type?.length ?? 0;
  n += f.sender_country_iso?.length ?? 0;
  n += f.customer_id?.length ?? 0;
  if (f.salesperson_id) n += 1;
  if (f.start_date && f.end_date) n += 1;
  return n;
};

const EMPTY_FILTERS: LeadFilters = {};

type Opt = { value: string; label: string; code?: string | null };
type FacetKey = 'stage' | 'platform' | 'leadType' | 'country' | 'customer' | 'date';

/* Inline icon glyphs — one per facet. Render as currentColor so the
 * sidebar's active/inactive states drive the tint without per-item CSS. */
const ICONS: Record<FacetKey, JSX.Element> = {
  stage: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  ),
  platform: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  leadType: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M10 7h4" /><path d="M9 17h6" />
    </svg>
  ),
  country: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z" />
    </svg>
  ),
  customer: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    </svg>
  ),
  date: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

const MENU: Array<{ key: FacetKey; label: string }> = [
  { key: 'stage',     label: 'Stage Wise Lead' },
  { key: 'platform',  label: 'Platform' },
  { key: 'leadType',  label: 'Lead Type' },
  { key: 'country',   label: 'Country' },
  { key: 'customer',  label: 'Customer' },
  { key: 'date',      label: 'Date' },
];

/* Date quick-presets shown in the Date facet pane. Picking one fills
 * filters.start_date + filters.end_date with the corresponding range;
 * the custom From / To calendar pickers below stay available so the user
 * can override with an arbitrary range. */
type DatePresetKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth';
const DATE_PRESETS: Array<{ key: DatePresetKey; label: string }> = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7',     label: 'Last 7 Days' },
  { key: 'last30',    label: 'Last 30 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
];

const toISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const datePresetRange = (k: DatePresetKey): { start: string; end: string } => {
  const today = new Date(); today.setHours(0,0,0,0);
  switch (k) {
    case 'today':     return { start: toISO(today), end: toISO(today) };
    case 'yesterday': { const y = new Date(today); y.setDate(y.getDate() - 1); return { start: toISO(y), end: toISO(y) }; }
    case 'last7':     { const s = new Date(today); s.setDate(s.getDate() - 6);  return { start: toISO(s), end: toISO(today) }; }
    case 'last30':    { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: toISO(s), end: toISO(today) }; }
    case 'thisMonth': { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { start: toISO(s), end: toISO(today) }; }
    case 'lastMonth': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: toISO(s), end: toISO(e) };
    }
  }
};
const matchedDatePreset = (start?: string, end?: string): DatePresetKey | null => {
  if (!start || !end) return null;
  for (const p of DATE_PRESETS) {
    const r = datePresetRange(p.key);
    if (r.start === start && r.end === end) return p.key;
  }
  return null;
};

const facetToField: Record<FacetKey, keyof LeadFilters | null> = {
  stage:    'lead_stage_id',
  platform: 'platform',
  leadType: 'query_type',
  country:  'sender_country_iso',
  customer: 'customer_id',
  date:     null, // handled specially
};

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (filters: LeadFilters) => void;
  initial?: LeadFilters;
  options: {
    stages:      Opt[];
    platforms:   Opt[];
    queryTypes:  Opt[];
    countries:   Opt[];
    customers:   Opt[];
  };
};

export default function LeadFilterModal({ open, onClose, onApply, initial, options }: Props) {
  const toast = useToast();

  const [active, setActive] = useState<FacetKey>('stage');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<LeadFilters>(initial ?? EMPTY_FILTERS);

  useEffect(() => {
    if (open) {
      setFilters(initial ?? EMPTY_FILTERS);
      setActive('stage');
      setSearch('');
    }
  }, [open, initial]);

  // Scroll lock — lock BOTH <html> and <body> so the page behind can't
  // scroll regardless of which element owns the viewport scroll.
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

  const optionsFor = (k: FacetKey): Opt[] => {
    switch (k) {
      case 'stage':    return options.stages;
      case 'platform': return options.platforms;
      case 'leadType': return options.queryTypes;
      case 'country':  return options.countries;
      // Order customers by their code SERIES (C-013, C-012 … C-001), newest
      // first — not by company name (QA CBC-92). Falls back to 0 for codes
      // without a trailing number so they sort last.
      case 'customer': {
        const seq = (o: Opt) => { const m = /(\d+)\s*$/.exec(o.code ?? ''); return m ? parseInt(m[1], 10) : 0; };
        return [...options.customers].sort((a, b) => seq(b) - seq(a));
      }
      default:         return [];
    }
  };

  /* Toggle a value in a facet's array — multi-select. Adds when absent,
   * removes when present; drops the field entirely once its last value
   * is unchecked so empty arrays never linger in the filter object. */
  const toggleCheckbox = (key: FacetKey, value: string) => {
    const field = facetToField[key];
    if (!field || field === 'salesperson_id') return;
    const mf = field as MultiField;
    setFilters(prev => {
      const current = (prev[mf] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [mf]: next.length ? next : undefined };
    });
  };

  const onApplyClick = () => {
    const hasAny = countFilterValues(filters) > 0;
    if (!hasAny) {
      toast.warning('No filter selected', 'Pick at least one option before applying');
      return;
    }
    if ((filters.start_date && !filters.end_date) || (!filters.start_date && filters.end_date)) {
      toast.warning('Date range incomplete', 'Set both Start and End date, or clear both');
      return;
    }
    onApply(filters);
    onClose();
  };

  const onClear = () => {
    // Reset removes the applied filters but keeps the modal OPEN so the user
    // can immediately pick new ones (QA: "don't close the popup on reset").
    setFilters(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  };

  if (!open) return null;

  const currentList = optionsFor(active);
  const searched = search.trim()
    ? currentList.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : currentList;

  const activeField = facetToField[active];
  const activeValues: string[] = activeField && activeField !== 'salesperson_id'
    ? ((filters[activeField as MultiField] as string[] | undefined) ?? [])
    : [];

  const activeMenu = MENU.find(m => m.key === active);
  const activePreset = matchedDatePreset(filters.start_date, filters.end_date);
  const selectedCount = countFilterValues(filters);

  /* Count of selected values within one facet — drives the per-item
   * badge in the left menu (the "3" / "2" pills in the design). */
  const facetCount = (k: FacetKey): number => {
    const field = facetToField[k];
    if (!field) return filters.start_date && filters.end_date ? 1 : 0;
    if (field === 'salesperson_id') return filters.salesperson_id ? 1 : 0;
    return (filters[field as MultiField] as string[] | undefined)?.length ?? 0;
  };

  return createPortal((
    /* Backdrop click intentionally not wired — the filter form holds
     * the user's in-flight filter selections; an accidental click
     * outside should not wipe them. ✕ and Apply / Reset buttons drive
     * dismissal. */
    <div className="lfm-backdrop">
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
              <div className="lfm-head-title">Filter Leads</div>
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
              {MENU.map(m => {
                const count = facetCount(m.key);
                const isOn = active === m.key;
                return (
                  <button
                    type="button"
                    key={m.key}
                    className={`lfm-menu-item ${isOn ? 'on' : ''}`}
                    onClick={() => { setActive(m.key); setSearch(''); }}
                  >
                    <span className="lfm-menu-ico">{ICONS[m.key]}</span>
                    <span className="lfm-menu-label">{m.label}</span>
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
                placeholder={`Search ${(activeMenu?.label ?? '').toLowerCase()}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="lfm-options">
              {active === 'date' ? (
                <>
                  {/* Custom range first — the calendar pickers let the user
                   * pick an arbitrary window. Presets below act as quick
                   * shortcuts for common ranges. */}
                  <div className="lfm-custom-range lfm-custom-range-top">
                    <div className="lfm-custom-range-title">Pick a custom range</div>
                    <div className="lfm-date-grid">
                      <div className="lfm-field">
                        <label className="lfm-label">From</label>
                        <MasterDatePicker
                          value={filters.start_date ?? ''}
                          onChange={(v) => setFilters(prev => ({ ...prev, start_date: v || undefined }))}
                          placeholder="Select start date"
                          maxDate={filters.end_date || undefined}
                        />
                      </div>
                      <div className="lfm-field">
                        <label className="lfm-label">To</label>
                        <MasterDatePicker
                          value={filters.end_date ?? ''}
                          onChange={(v) => setFilters(prev => ({ ...prev, end_date: v || undefined }))}
                          placeholder="Select end date"
                          minDate={filters.start_date || undefined}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="lfm-preset-divider">Or pick a quick range</div>

                  {/* Quick presets — radio cards that fill filters.start_date /
                   * end_date with a computed range. Picking the same preset
                   * twice clears the range so the field can be deselected. */}
                  {DATE_PRESETS
                    .filter(p => !search.trim() || p.label.toLowerCase().includes(search.toLowerCase()))
                    .map(p => {
                      const checked = activePreset === p.key;
                      return (
                        <label key={p.key} className={`lfm-card ${checked ? 'on' : ''}`}>
                          <input
                            type="radio"
                            name="facet-date"
                            checked={checked}
                            readOnly
                            onClick={() => {
                              if (checked) {
                                setFilters(prev => ({ ...prev, start_date: undefined, end_date: undefined }));
                              } else {
                                const r = datePresetRange(p.key);
                                setFilters(prev => ({ ...prev, start_date: r.start, end_date: r.end }));
                              }
                            }}
                          />
                          <span className="lfm-check lfm-check-round" aria-hidden="true">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                          <span className="lfm-card-label">{p.label}</span>
                        </label>
                      );
                    })}
                </>
              ) : searched.length === 0 ? (
                <div className="lfm-empty">No options available</div>
              ) : (
                searched.map(opt => {
                  const checked = activeValues.includes(opt.value);
                  return (
                    <label key={opt.value} className={`lfm-card ${checked ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        onClick={() => toggleCheckbox(active, opt.value)}
                      />
                      <span className="lfm-check" aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="lfm-card-label">
                        {opt.code && (
                          <>
                            <span className="lfm-card-code">{opt.code}</span>
                            <span className="lfm-card-sep">:</span>
                          </>
                        )}
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

/* Exported so CustomerFilterModal can render the SAME stylesheet under the same
 * lfm-* class names. The Customer filter is meant to be visually identical to
 * this one, and a ~300-line copy would drift the first time either is touched. */
export const LFM_CSS = `
.lfm-backdrop {
  /* Accent ramp. Every accent in this sheet reads from these, so a host can
     re-theme the whole modal by overriding them on the backdrop — see
     .lfm-purple below, used by the Customer filter to match that page's
     violet. Defaults are the cyan this (Lead) modal has always used, so the
     variables changed nothing for it.
     The -rgb pairs exist because rgba() needs raw channels, not a hex. */
  --lfm-c-050: #ecfeff;
  --lfm-c-200: #67e8f9;
  --lfm-c-500: #06b6d4;
  --lfm-c-600: #0891b2;
  --lfm-c-700: #0e7490;
  --lfm-c-rgb: 8,145,178;
  --lfm-c-200-rgb: 103,232,249;

  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: lfm-fade .15s ease-out;
}
@keyframes lfm-fade { from { opacity: 0; } to { opacity: 1; } }

/* Violet theme — used by the Customer filter, whose page (SalesCustomers) is
   violet throughout; the default cyan read as a foreign modal dropped onto it.
   Values are lifted from that page's own palette (.smc-pill.on gradient and the
   rgba(139,92,246,…) hairlines) so the modal and the page behind it agree. */
.lfm-backdrop.lfm-purple {
  --lfm-c-050: #f5f1fe;
  --lfm-c-200: #ddd6fe;
  --lfm-c-500: #a78bfa;
  --lfm-c-600: #8b5cf6;
  --lfm-c-700: #6d28d9;
  --lfm-c-rgb: 139,92,246;
  --lfm-c-200-rgb: 221,214,254;
}

/* Emerald theme — used by the Consignee filter, whose page (SalesConsignee) is
   green throughout. Values lifted from that page's own palette. */
.lfm-backdrop.lfm-emerald {
  --lfm-c-050: #ecfdf5;
  --lfm-c-200: #6ee7b7;
  --lfm-c-500: #34d399;
  --lfm-c-600: #10b981;
  --lfm-c-700: #047857;
  --lfm-c-rgb: 16,185,129;
  --lfm-c-200-rgb: 110,231,183;
}

.lfm-modal {
  width: min(94vw, 720px); height: 480px; max-height: 84vh;
  background: #fff; border-radius: 22px; box-shadow: 0 24px 60px rgba(var(--lfm-c-rgb),.18), 0 8px 24px rgba(15,23,42,.20);
  overflow: hidden; display: flex; flex-direction: column;
  animation: lfm-pop .18s ease-out;
}
@keyframes lfm-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* ── Header strip ── */
.lfm-head {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 20px;
  background: linear-gradient(135deg, var(--lfm-c-700) 0%, var(--lfm-c-600) 60%, var(--lfm-c-500) 100%);
  color: #fff;
  overflow: hidden;
}
/* Decorative bubble orbs (figma) — soft white circles clipped by the header. */
.lfm-head::before {
  content: ''; position: absolute; right: -35px; top: -35px;
  width: 130px; height: 130px; border-radius: 50%;
  background: rgba(255,255,255,.06); pointer-events: none;
}
.lfm-head::after {
  content: ''; position: absolute; right: 70px; bottom: -45px;
  width: 90px; height: 90px; border-radius: 50%;
  background: rgba(255,255,255,.04); pointer-events: none;
}
.lfm-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; position: relative; z-index: 1; }
.lfm-head-ico {
  width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.lfm-head-title { font-size: 17px; font-weight: 700; letter-spacing: -.2px; line-height: 1.2; }
.lfm-head-sub   { font-size: 12px; color: rgba(255,255,255,.85); margin-top: 2px; }
/* "N selected" pill — sits between the title and the close button. */
.lfm-head-count {
  position: relative; z-index: 1; flex-shrink: 0; margin-left: auto;
  display: inline-flex; align-items: center;
  padding: 5px 13px; border-radius: 999px;
  background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.35);
  color: #fff; font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
.lfm-close {
  width: 32px; height: 32px; border: none; border-radius: 9px;
  background: rgba(255,255,255,.16); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0; position: relative; z-index: 1;
}
.lfm-close:hover { background: rgba(255,255,255,.28); }

.lfm-body { flex: 1; display: flex; min-height: 0; background: #f8fafc; }

/* ── Sidebar ── */
.lfm-left {
  width: 178px; flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e2e8f0;
  display: flex; flex-direction: column;
  padding: 12px 12px 6px;
}
.lfm-left-label {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  letter-spacing: .15em; text-transform: uppercase;
  padding: 0 10px 8px;
}
.lfm-menu { display: flex; flex-direction: column; gap: 4px; }
.lfm-menu-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 11px; border-radius: 8px;
  border: 1.5px solid transparent;
  background: transparent;
  font: inherit; font-size: 11.5px; font-weight: 600; color: #475569;
  cursor: pointer; text-align: left;
  transition: background .15s, border-color .15s, color .15s;
}
.lfm-menu-item:hover { background: #f1f5f9; color: #0f172a; }
.lfm-menu-ico {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: 1.5px solid #e2e8f0; color: #64748b;
  transition: all .15s;
}
.lfm-menu-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lfm-menu-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--lfm-c-600); flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(var(--lfm-c-rgb),.18);
}
/* Per-facet selected-count pill in the left menu (replaces the dot). */
.lfm-menu-count {
  flex-shrink: 0; min-width: 20px; height: 20px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; background: var(--lfm-c-600); color: #fff;
  font-size: 11px; font-weight: 700; line-height: 1;
}
.lfm-menu-item.on .lfm-menu-count { background: var(--lfm-c-700); }
.lfm-menu-item.on {
  background: var(--lfm-c-050);
  border-color: var(--lfm-c-200);
  color: var(--lfm-c-700); font-weight: 700;
}
.lfm-menu-item.on .lfm-menu-ico {
  background: linear-gradient(135deg, var(--lfm-c-500), var(--lfm-c-600));
  border-color: var(--lfm-c-600); color: #fff;
  box-shadow: 0 4px 12px rgba(var(--lfm-c-rgb),.30);
}

.lfm-left-foot {
  margin-top: auto; padding-top: 12px;
  display: flex; flex-direction: column; gap: 10px;
}
.lfm-btn {
  padding: 9px 14px; border-radius: 10px;
  font: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: none; transition: all .15s;
}
.lfm-btn-primary {
  background: linear-gradient(135deg, var(--lfm-c-500) 0%, var(--lfm-c-600) 55%, var(--lfm-c-700) 100%);
  color: #fff;
  box-shadow: 0 4px 14px rgba(var(--lfm-c-rgb),.35), 0 1px 0 rgba(255,255,255,.18) inset;
}
.lfm-btn-primary:hover { transform: translateY(-1px); filter: brightness(1.05); }
.lfm-btn-reset {
  background: transparent; border: none; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; color: #94a3b8;
  padding: 4px 0; transition: color .15s;
}
.lfm-btn-reset:hover { color: var(--lfm-c-600); }

/* ── Right pane ── */
.lfm-right { flex: 1; display: flex; flex-direction: column; padding: 12px 20px; min-width: 0; gap: 10px; background: #fff; }
.lfm-search-wrap { position: relative; }
.lfm-search-ico {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #94a3b8; pointer-events: none;
}
.lfm-search {
  width: 100%; height: 36px; padding: 0 12px 0 34px;
  font: inherit; font-size: 12px;
  border: 1px solid #e2e8f0; border-radius: 9px;
  background: #f8fafc; color: #0f172a; outline: none;
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.lfm-search::placeholder { color: #94a3b8; }
.lfm-search:hover { border-color: #cbd5e1; }
.lfm-search:focus { background: #fff; border-color: var(--lfm-c-600); box-shadow: 0 0 0 3px rgba(var(--lfm-c-rgb),.15); }

/* Fills the fixed-height modal and scrolls internally — the popup size never
   changes, however many entries a facet has (e.g. Customer). */
.lfm-options { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
.lfm-options::-webkit-scrollbar { width: 8px; }
.lfm-options::-webkit-scrollbar-track { background: transparent; }
.lfm-options::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.lfm-options::-webkit-scrollbar-thumb:hover { background: #9ca3af; background-clip: content-box; }
.lfm-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 30px 12px; font-size: 12.5px; }

/* Each radio option is a bordered card. Clicking anywhere on the card
   toggles its radio. The radio uses accent-color so it picks up the
   modal's cyan. */
.lfm-card {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px; border-radius: 9px;
  background: #fff; border: 1px solid #e2e8f0;
  font: inherit; font-size: 12px; color: #475569; font-weight: 400;
  cursor: pointer;
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.lfm-card:hover { border-color: var(--lfm-c-200); background: var(--lfm-c-050); }
.lfm-card.on {
  border-color: var(--lfm-c-600); background: var(--lfm-c-050);
  box-shadow: 0 0 0 1px var(--lfm-c-600) inset;
}
/* Native input is hidden — the circular .lfm-check indicator stands in
   for it so the checkbox matches the Figma's round blue checkmark. */
.lfm-card input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.lfm-check {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid #cbd5e1; background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; transition: background .15s, border-color .15s;
}
.lfm-check svg { opacity: 0; transition: opacity .12s; }
.lfm-card.on .lfm-check {
  background: var(--lfm-c-600); border-color: var(--lfm-c-600);
}
.lfm-card.on .lfm-check svg { opacity: 1; }
.lfm-card-label {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  white-space: nowrap;
}
.lfm-card-code {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; font-weight: 700; color: var(--lfm-c-600);
  flex-shrink: 0; letter-spacing: .02em;
}
.lfm-card-sep { color: #94a3b8; font-weight: 600; flex-shrink: 0; }
.lfm-card-name {
  min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lfm-card.on .lfm-card-code { color: var(--lfm-c-700); }

/* Divider label between the custom range picker and the preset list in
   the Date facet — small uppercase caption with hairlines on both sides. */
.lfm-preset-divider {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 700; color: #94a3b8;
  letter-spacing: .14em; text-transform: uppercase;
  margin: 4px 0 4px;
}
.lfm-preset-divider::before,
.lfm-preset-divider::after {
  content: ''; flex: 1; height: 1px; background: #e2e8f0;
}
.lfm-custom-range-top { margin-bottom: 4px; padding-top: 0; border-top: none; }

/* Date facet — custom range pickers sit under the preset cards */
.lfm-custom-range {
  margin-top: 6px; padding-top: 14px;
  border-top: 1px dashed #cbd5e1;
}
.lfm-custom-range-title {
  font-size: 11px; font-weight: 700; color: #64748b;
  letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px;
}
.lfm-date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lfm-field { display: flex; flex-direction: column; gap: 4px; }
.lfm-label { font-size: 11.5px; font-weight: 600; color: #334155; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .lfm-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-body  { background: #0b1220; }
[data-bs-theme="dark"] .lfm-left  { background: #0f172a; border-right-color: #1e293b; }
[data-bs-theme="dark"] .lfm-right { background: #0f172a; }
[data-bs-theme="dark"] .lfm-left-label { color: #94a3b8; }
[data-bs-theme="dark"] .lfm-menu-item { color: #cbd5e1; }
[data-bs-theme="dark"] .lfm-menu-item:hover { background: rgba(var(--lfm-c-rgb),.10); color: var(--lfm-c-050); }
[data-bs-theme="dark"] .lfm-menu-ico { background: #1e293b; border-color: #334155; color: #94a3b8; }
[data-bs-theme="dark"] .lfm-menu-item.on { background: rgba(var(--lfm-c-rgb),.18); border-color: rgba(var(--lfm-c-200-rgb),.45); color: var(--lfm-c-200); }
[data-bs-theme="dark"] .lfm-menu-item.on .lfm-menu-ico { background: linear-gradient(135deg,var(--lfm-c-500),var(--lfm-c-600)); border-color: rgba(var(--lfm-c-200-rgb),.6); color: #fff; }
[data-bs-theme="dark"] .lfm-btn-reset { color: #94a3b8; }
[data-bs-theme="dark"] .lfm-btn-reset:hover { color: var(--lfm-c-200); }
[data-bs-theme="dark"] .lfm-search { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-search:focus { background: #0f172a; }
[data-bs-theme="dark"] .lfm-card { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-card:hover { background: rgba(var(--lfm-c-rgb),.12); border-color: rgba(var(--lfm-c-200-rgb),.4); }
[data-bs-theme="dark"] .lfm-card.on { background: rgba(var(--lfm-c-rgb),.20); border-color: var(--lfm-c-200); box-shadow: 0 0 0 1px var(--lfm-c-200) inset; }
[data-bs-theme="dark"] .lfm-check { background: #0f172a; border-color: #475569; }
[data-bs-theme="dark"] .lfm-card.on .lfm-check { background: var(--lfm-c-500); border-color: var(--lfm-c-500); }
[data-bs-theme="dark"] .lfm-custom-range { border-top-color: #334155; }
[data-bs-theme="dark"] .lfm-custom-range-title { color: #94a3b8; }
[data-bs-theme="dark"] .lfm-label { color: #cbd5e1; }
[data-bs-theme="dark"] .lfm-card-code { color: var(--lfm-c-200); }
[data-bs-theme="dark"] .lfm-card-sep  { color: #64748b; }
[data-bs-theme="dark"] .lfm-card.on .lfm-card-code { color: #a5f3fc; }
[data-bs-theme="dark"] .lfm-preset-divider { color: #64748b; }
[data-bs-theme="dark"] .lfm-preset-divider::before,
[data-bs-theme="dark"] .lfm-preset-divider::after { background: #1e293b; }

/* ── Tablet — sidebar collapses to top row, options stack ── */
@media (max-width: 720px) {
  .lfm-modal { height: auto; max-height: 92vh; width: 95vw; }
  .lfm-body  { flex-direction: column; }
  .lfm-left  {
    width: 100%; flex-direction: column; padding: 12px;
    border-right: none; border-bottom: 1px solid #e2e8f0;
  }
  [data-bs-theme="dark"] .lfm-left { border-bottom-color: #1e293b; }
  .lfm-menu { flex-direction: row; flex-wrap: wrap; }
  .lfm-menu-item { flex: 1 0 auto; min-width: 130px; }
  .lfm-left-foot { padding-top: 10px; }
  .lfm-right { padding: 14px 16px; max-height: 60vh; }
}

/* ── Phone — single-column date picker, edge-to-edge modal ── */
@media (max-width: 480px) {
  .lfm-backdrop { padding: 0; }
  .lfm-modal { width: 100%; height: 100vh; max-height: 100vh; border-radius: 0; }
  .lfm-date-grid { grid-template-columns: 1fr; }
  .lfm-head { padding: 14px 16px; }
  .lfm-head-title { font-size: 15px; }
}
`;
