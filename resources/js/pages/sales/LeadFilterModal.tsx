import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';

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

export type LeadFilters = {
  lead_stage_id?: string;
  platform?: string;
  query_type?: string;
  sender_country_iso?: string;
  customer_id?: string;
  salesperson_id?: string;   // applied by "View Leads" in the Assigned Leads modal
  start_date?: string;
  end_date?: string;
};

const EMPTY_FILTERS: LeadFilters = {};

type Opt = { value: string; label: string };
type FacetKey = 'stage' | 'platform' | 'leadType' | 'country' | 'customer' | 'date';

const MENU: Array<{ key: FacetKey; label: string }> = [
  { key: 'stage',     label: 'Stage Wise Lead' },
  { key: 'platform',  label: 'Platform' },
  { key: 'leadType',  label: 'Lead Type' },
  { key: 'country',   label: 'Country' },
  { key: 'customer',  label: 'Customer' },
  { key: 'date',      label: 'Date' },
];

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
      case 'customer': return options.customers;
      default:         return [];
    }
  };

  const pickRadio = (key: FacetKey, value: string) => {
    const field = facetToField[key];
    if (!field) return;
    setFilters(prev => {
      const current = prev[field];
      return { ...prev, [field]: current === value ? undefined : value };
    });
  };

  const onApplyClick = () => {
    const hasAny = Object.values(filters).some(v => v && String(v).trim() !== '');
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
    setFilters(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
    onClose();
  };

  if (!open) return null;

  const currentList = optionsFor(active);
  const searched = search.trim()
    ? currentList.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : currentList;

  const radioField = facetToField[active];
  const radioValue = radioField ? filters[radioField] : undefined;

  return createPortal((
    /* Backdrop click intentionally not wired — the filter form holds
     * the user's in-flight filter selections; an accidental click
     * outside should not wipe them. ✕ and Apply / Reset buttons drive
     * dismissal. */
    <div className="lfm-backdrop">
      <style>{LFM_CSS}</style>
      <div className="lfm-modal">
        <div className="lfm-head">
          <div className="lfm-head-title">Filters</div>
          <button className="lfm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="lfm-body">
          <div className="lfm-left">
            {MENU.map(m => {
              const field = facetToField[m.key];
              const hasValue = field
                ? !!filters[field]
                : (!!filters.start_date || !!filters.end_date);
              return (
                <div
                  key={m.key}
                  className={`lfm-menu-item ${active === m.key ? 'on' : ''}`}
                  onClick={() => { setActive(m.key); setSearch(''); }}
                >
                  <span>{m.label}</span>
                  {hasValue && <span className="lfm-dot" />}
                </div>
              );
            })}
            <div className="lfm-left-foot">
              <button className="lfm-btn lfm-btn-ghost" onClick={onClear}>Clear all</button>
              <button className="lfm-btn lfm-btn-primary" onClick={onApplyClick}>Apply Filter</button>
            </div>
          </div>

          <div className="lfm-right">
            {active !== 'date' && (
              <input
                className="lfm-search"
                placeholder={`Search ${MENU.find(m => m.key === active)?.label.toLowerCase()}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            )}
            <div className="lfm-options">
              {active === 'date' ? (
                /* Date filters use the shared MasterDatePicker
                 * (same picker the master forms, recruitment and
                 * onboarding flows all use) so the calendar visual
                 * language is consistent across the app. Previously
                 * this was a raw <input type="date"> which rendered
                 * with the browser-default chrome and looked nothing
                 * like the themed pickers everywhere else. */
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
              ) : searched.length === 0 ? (
                <div className="lfm-empty">No options available</div>
              ) : (
                searched.map(opt => {
                  // Radios don't natively toggle off — `onClick` handles both
                  // the "select" and "deselect" cases so pickRadio (which
                  // already toggles when value matches) only fires once per
                  // interaction. Stopping React's synthesized onChange via
                  // readOnly is the cleanest way to suppress double-fire.
                  const checked = radioValue === opt.value;
                  return (
                    <label key={opt.value} className="lfm-radio">
                      <input
                        type="radio"
                        name={`facet-${active}`}
                        checked={checked}
                        readOnly
                        onClick={() => pickRadio(active, opt.value)}
                      />
                      <span>{opt.label}</span>
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

const LFM_CSS = `
.lfm-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: lfm-fade .15s ease-out;
}
@keyframes lfm-fade { from { opacity: 0; } to { opacity: 1; } }
.lfm-modal {
  width: 680px; max-width: 95vw; height: 480px; max-height: 88vh;
  background: #fff; border-radius: 14px; box-shadow: 0 18px 48px rgba(15,23,42,.25);
  overflow: hidden; display: flex; flex-direction: column;
  animation: lfm-pop .18s ease-out;
}
@keyframes lfm-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.lfm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff;
}
.lfm-head-title { font-size: 15px; font-weight: 600; }
.lfm-close {
  width: 28px; height: 28px; border: none; background: rgba(255,255,255,.15);
  color: #fff; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.lfm-close:hover { background: rgba(255,255,255,.28); }
.lfm-body { flex: 1; display: flex; min-height: 0; }
.lfm-left {
  width: 200px; border-right: 1px solid #e2e8f0; background: #f8fafc;
  display: flex; flex-direction: column;
}
.lfm-menu-item {
  padding: 11px 16px; font-size: 12.5px; color: #475569; cursor: pointer;
  border-left: 3px solid transparent; transition: background .12s, color .12s;
  display: flex; align-items: center; justify-content: space-between;
}
.lfm-menu-item:hover { background: #f1f5f9; }
.lfm-menu-item.on {
  background: #ecfeff; color: #0e7490; font-weight: 600;
  border-left-color: #0891b2;
}
.lfm-dot { width: 7px; height: 7px; border-radius: 50%; background: #0891b2; }
.lfm-left-foot {
  margin-top: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
  border-top: 1px solid #e2e8f0;
}
.lfm-right { flex: 1; display: flex; flex-direction: column; padding: 14px 18px; min-width: 0; }
.lfm-search {
  height: 34px; padding: 0 12px; font-size: 12.5px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a; outline: none; margin-bottom: 10px;
}
.lfm-search:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.lfm-options { flex: 1; overflow-y: auto; padding-right: 4px; }
.lfm-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 30px 12px; font-size: 12px; }
.lfm-radio {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  font-size: 12.5px; color: #1e293b; transition: background .12s;
}
.lfm-radio:hover { background: #f1f5f9; }
.lfm-radio input { accent-color: #0891b2; cursor: pointer; }
.lfm-date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lfm-field { display: flex; flex-direction: column; gap: 4px; }
.lfm-label { font-size: 11.5px; font-weight: 600; color: #334155; }
.lfm-input {
  height: 36px; padding: 0 10px; font-size: 12.5px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a; outline: none;
}
.lfm-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.lfm-btn {
  padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1.5px solid transparent; transition: all .15s;
}
.lfm-btn-ghost { background: #fff; border-color: #cbd5e1; color: #475569; }
.lfm-btn-ghost:hover { background: #f1f5f9; }
.lfm-btn-primary { background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; }
.lfm-btn-primary:hover { filter: brightness(1.08); }

[data-bs-theme="dark"] .lfm-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-left { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .lfm-menu-item { color: #94a3b8; }
[data-bs-theme="dark"] .lfm-menu-item:hover { background: #0f172a; }
[data-bs-theme="dark"] .lfm-menu-item.on { background: rgba(8,145,178,.20); color: #67e8f9; border-left-color: #22d3ee; }
[data-bs-theme="dark"] .lfm-left-foot { border-color: #334155; }
[data-bs-theme="dark"] .lfm-search,
[data-bs-theme="dark"] .lfm-input { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-label { color: #cbd5e1; }
[data-bs-theme="dark"] .lfm-radio { color: #e2e8f0; }
[data-bs-theme="dark"] .lfm-radio:hover { background: #1e293b; }
[data-bs-theme="dark"] .lfm-btn-ghost { background: #0f172a; border-color: #334155; color: #cbd5e1; }

/* Tablet — narrower left menu, tighter padding */
@media (max-width: 720px) {
  .lfm-modal { height: auto; max-height: 92vh; }
  .lfm-body  { flex-direction: column; }
  .lfm-left {
    width: 100%;
    flex-direction: row; flex-wrap: wrap;
    border-right: none; border-bottom: 1px solid #e2e8f0;
    padding: 6px;
  }
  [data-bs-theme="dark"] .lfm-left { border-bottom-color: #334155; }
  .lfm-menu-item {
    flex: 1 0 auto; border-left: none;
    border-radius: 8px; padding: 8px 12px;
    text-align: center; font-size: 11.5px;
  }
  .lfm-menu-item.on {
    background: linear-gradient(135deg, #ecfeff, #cffafe);
    border-left: none;
  }
  .lfm-left-foot {
    flex: 1 0 100%; flex-direction: row; gap: 8px; padding: 8px 6px 4px;
    border-top: 1px solid #e2e8f0; margin-top: 6px;
  }
  [data-bs-theme="dark"] .lfm-left-foot { border-top-color: #334155; }
  .lfm-left-foot .lfm-btn { flex: 1; }
  .lfm-right { padding: 12px 14px; }
  .lfm-options { max-height: 280px; }
}

/* Phone — single-column date picker, slightly smaller modal padding */
@media (max-width: 480px) {
  .lfm-backdrop { padding: 0; }
  .lfm-modal { width: 100%; height: 100vh; max-height: 100vh; border-radius: 0; }
  .lfm-date-grid { grid-template-columns: 1fr; }
  .lfm-head { padding: 12px 16px; }
  .lfm-head-title { font-size: 14px; }
}
`;
