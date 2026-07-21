import { useEffect, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { LFM_CSS } from '../../sales/opportunity-pipeline/LeadFilterModal';


export type DcpFilters = {
  document_type?: string[];     // 'domestic' | 'international'
  regulatory_status?: string[]; // 'highly' | 'less'
  buyer_consignee?: string[];   // 'allowed' | 'not'
  authorities?: string[];       // authority names
  segment_code?: string[];      // segment codes
};

type FacetKey = 'documentType' | 'regulatory' | 'buyerConsignee' | 'authorities' | 'segment';
type Opt = { value: string; label: string };

const EMPTY_FILTERS: DcpFilters = {};

/** Total individually-selected values across every facet — drives the button
 *  badge and the modal header "N selected" pill. */
export const countDcpFilters = (f: DcpFilters): number =>
  (f.document_type?.length ?? 0) + (f.regulatory_status?.length ?? 0)
  + (f.buyer_consignee?.length ?? 0) + (f.authorities?.length ?? 0)
  + (f.segment_code?.length ?? 0);

const FACET_FIELD: Record<FacetKey, keyof DcpFilters> = {
  documentType:   'document_type',
  regulatory:     'regulatory_status',
  buyerConsignee: 'buyer_consignee',
  authorities:    'authorities',
  segment:        'segment_code',
};

const MENU: Array<{ key: FacetKey; label: string }> = [
  { key: 'documentType',   label: 'Document Type' },
  { key: 'regulatory',     label: 'Regulatory Status' },
  { key: 'buyerConsignee', label: 'Customer ≠ Consignee' },
  { key: 'authorities',    label: 'Authorities' },
  { key: 'segment',        label: 'Segment Name' },
];

const STATIC_OPTS: Partial<Record<FacetKey, Opt[]>> = {
  documentType:   [{ value: 'international', label: 'International' }, { value: 'domestic', label: 'Domestic' }],
  regulatory:     [{ value: 'highly', label: 'High' }, { value: 'less', label: 'Less' }],
  buyerConsignee: [{ value: 'allowed', label: 'Allowed' }, { value: 'not', label: 'Not Allowed' }],
};

const ICONS: Record<FacetKey, JSX.Element> = {
  documentType: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  regulatory: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  buyerConsignee: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="16" r="3.5" /><path d="M2 20a5 5 0 0 1 9-3" />
    </svg>
  ),
  authorities: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" />
    </svg>
  ),
  segment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (filters: DcpFilters) => void;
  initial?: DcpFilters;
  options: { authorities: Opt[]; segments: Opt[] };
};

export default function ClmDcpFilterModal({ open, onClose, onApply, initial, options }: Props) {
  const toast = useToast();
  const [active, setActive] = useState<FacetKey>('documentType');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<DcpFilters>(initial ?? EMPTY_FILTERS);

  useEffect(() => {
    if (open) { setFilters(initial ?? EMPTY_FILTERS); setActive('documentType'); setSearch(''); }
  }, [open, initial]);

  // Scroll lock — reserves the scrollbar width so the page doesn't shake on open.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  const optionsFor = (k: FacetKey): Opt[] => {
    if (k === 'authorities') return options.authorities;
    if (k === 'segment')     return options.segments;
    return STATIC_OPTS[k] ?? [];
  };

  /* Toggle a value in a facet's array — multi-select. Drops the field entirely
   * once its last value is unchecked so empty arrays never linger. */
  const toggle = (k: FacetKey, value: string) => {
    const field = FACET_FIELD[k];
    setFilters(prev => {
      const current = (prev[field] as string[] | undefined) ?? [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...prev, [field]: next.length ? next : undefined };
    });
  };

  const onApplyClick = () => {
    if (countDcpFilters(filters) === 0) {
      toast.warning('No filter selected', 'Pick at least one option before applying');
      return;
    }
    onApply(filters);
    onClose();
  };

  const onClear = () => { setFilters(EMPTY_FILTERS); onApply(EMPTY_FILTERS); };

  if (!open) return null;

  const currentList = optionsFor(active);
  const searched = search.trim() ? currentList.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : currentList;
  const activeValues = (filters[FACET_FIELD[active]] as string[] | undefined) ?? [];
  const activeMenu = MENU.find(m => m.key === active);
  const selectedCount = countDcpFilters(filters);
  const facetCount = (k: FacetKey): number => (filters[FACET_FIELD[k]] as string[] | undefined)?.length ?? 0;

  return createPortal((
    <div className="lfm-backdrop">
      <style>{LFM_CSS}</style>
      <div className="lfm-modal">
        <div className="lfm-head">
          <div className="lfm-head-left">
            <div className="lfm-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="9" y1="18" x2="15" y2="18" />
              </svg>
            </div>
            <div>
              <div className="lfm-head-title">Filter Segment Rules</div>
              <div className="lfm-head-sub">Select filters to narrow down results</div>
            </div>
          </div>
          {selectedCount > 0 && <span className="lfm-head-count">{selectedCount} selected</span>}
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
                return (
                  <button type="button" key={m.key} className={`lfm-menu-item ${active === m.key ? 'on' : ''}`}
                    onClick={() => { setActive(m.key); setSearch(''); }}>
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
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input className="lfm-search" placeholder={`Search ${(activeMenu?.label ?? '').toLowerCase()}…`}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="lfm-options">
              {searched.length === 0 ? (
                <div className="lfm-empty">No options available</div>
              ) : searched.map(opt => {
                const checked = activeValues.includes(opt.value);
                return (
                  <label key={opt.value} className={`lfm-card ${checked ? 'on' : ''}`}>
                    <input type="checkbox" checked={checked} readOnly onClick={() => toggle(active, opt.value)} />
                    <span className="lfm-check" aria-hidden="true">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="lfm-card-label"><span className="lfm-card-name">{opt.label}</span></span>
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
