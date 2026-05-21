import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Distribution modal.
 *
 * Round-robin distribute *unassigned* leads (optionally filtered by account
 * / date range / lead stage) across one or more selected salespeople.
 * Fires POST /sales/leads/distribute and refreshes the worksheet.
 *
 * Legacy IDIMS didn't ship this — we modelled it after the assign-multiple
 * flow but added multi-select salespeople and an unassigned-only safety
 * gate on the backend so we never reshuffle already-owned leads.
 * ───────────────────────────────────────────────────────────────────────── */

type Salesperson = {
  id: number;
  name: string;
  code: string;
  role: string;
  subtitle: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onDistributed: () => void;
  platforms?: string[];
  queryTypes?: string[];
  countries?: Array<{ value: string; label: string }>;
};

const STAGES = [
  { value: '',  label: 'Any stage' },
  { value: '1', label: 'Inquiry Required' },
  { value: '2', label: 'Lead Acknowledgement' },
  { value: '3', label: 'Product Sourcing' },
  { value: '4', label: 'Price Shared' },
  { value: '5', label: 'Pre-PI CLM' },
  { value: '6', label: 'Quotation vs PI' },
  { value: '7', label: 'Post-PI CLM' },
  { value: '8', label: 'Victory' },
];

export default function LeadDistributionModal({
  open, onClose, onDistributed, platforms = [], queryTypes = [], countries = [],
}: Props) {
  const toast = useToast();

  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [loadingSp, setLoadingSp]     = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const [selectedSps, setSelectedSps] = useState<Set<number>>(new Set());
  const [platform, setPlatform]       = useState('');
  const [queryType, setQueryType]     = useState('');
  const [stage, setStage]             = useState('');
  const [country, setCountry]         = useState('');
  const [startDate, setStartDate]     = useState('');
  const [endDate, setEndDate]         = useState('');
  const [search, setSearch]           = useState('');

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) {
      setSelectedSps(new Set());
      setPlatform(''); setQueryType(''); setStage(''); setCountry('');
      setStartDate(''); setEndDate(''); setSearch('');
      return;
    }
    setLoadingSp(true);
    api.get<{ status: boolean; data: Salesperson[] }>('/sales/leads/salespeople')
      .then(({ data }) => setSalespeople(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load salespeople'))
      .finally(() => setLoadingSp(false));
  }, [open, toast]);

  const filteredSps = useMemo(() => {
    if (!search.trim()) return salespeople;
    const s = search.toLowerCase();
    return salespeople.filter(sp =>
      sp.name.toLowerCase().includes(s) ||
      sp.code.toLowerCase().includes(s) ||
      (sp.subtitle ?? '').toLowerCase().includes(s),
    );
  }, [salespeople, search]);

  const toggleSp = (id: number) => {
    setSelectedSps(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedSps.size === filteredSps.length) setSelectedSps(new Set());
    else setSelectedSps(new Set(filteredSps.map(sp => sp.id)));
  };

  const onSubmit = async () => {
    if (selectedSps.size === 0) {
      toast.warning('Pick salespeople', 'Select at least one salesperson to distribute to');
      return;
    }
    if ((startDate && !endDate) || (!startDate && endDate)) {
      toast.warning('Date range incomplete', 'Set both Start and End date, or leave both blank');
      return;
    }
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      toast.warning('Bad date range', 'End date cannot be before start date');
      return;
    }

    setSubmitting(true);
    try {
      const filters: Record<string, unknown> = {};
      if (platform)  filters.platform           = platform;
      if (queryType) filters.query_type         = queryType;
      if (stage)     filters.lead_stage_id      = Number(stage);
      if (country)   filters.sender_country_iso = country;
      if (startDate) filters.start_date         = startDate;
      if (endDate)   filters.end_date           = endDate;

      const { data } = await api.post<{
        status: boolean; message: string; total: number;
        per_user: Record<string, number>;
      }>('/sales/leads/distribute', {
        salesperson_ids: Array.from(selectedSps),
        filters,
      });

      if (data.total === 0) {
        toast.info('Nothing to distribute', 'No unassigned leads matched your filters');
      } else {
        toast.success(
          'Distribution complete',
          `${data.total} leads distributed across ${Object.keys(data.per_user).length} salespeople`,
        );
      }
      onDistributed();
      onClose();
    } catch (e: any) {
      toast.error('Distribution failed', e?.response?.data?.message ?? 'Could not distribute leads');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal((
    <div className="ldm-backdrop" onClick={onClose}>
      <style>{LDM_CSS}</style>
      <div className="ldm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ldm-head">
          <div className="ldm-head-left">
            <div className="ldm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="ldm-head-title">Lead Distribution</div>
              <div className="ldm-head-sub">Round-robin assign unassigned leads to the chosen salespeople</div>
            </div>
          </div>
          <button className="ldm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ldm-body">
          {/* Filters */}
          <div className="ldm-section-label">1. Narrow down which leads (optional — leave blank to distribute every unassigned lead)</div>
          <div className="ldm-grid-3">
            <div className="ldm-field">
              <label className="ldm-label">Account</label>
              <select className="ldm-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                <option value="">Any account</option>
                {platforms.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="ldm-field">
              <label className="ldm-label">Lead Type</label>
              <select className="ldm-input" value={queryType} onChange={e => setQueryType(e.target.value)}>
                <option value="">Any type</option>
                {queryTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="ldm-field">
              <label className="ldm-label">Stage</label>
              <select className="ldm-input" value={stage} onChange={e => setStage(e.target.value)}>
                {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="ldm-field">
              <label className="ldm-label">Country</label>
              <select className="ldm-input" value={country} onChange={e => setCountry(e.target.value)}>
                <option value="">Any country</option>
                {countries.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="ldm-field">
              <label className="ldm-label">Start Date</label>
              <input
                type="date"
                max={todayStr}
                className="ldm-input"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="ldm-field">
              <label className="ldm-label">End Date</label>
              <input
                type="date"
                min={startDate || undefined}
                max={todayStr}
                className="ldm-input"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Salespeople */}
          <div className="ldm-section-label" style={{ marginTop: 8 }}>
            2. Distribute among salespeople
            <span className="ldm-count">{selectedSps.size} selected</span>
          </div>
          <input
            className="ldm-input ldm-search"
            placeholder="Search salesperson…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="ldm-sp-list">
            {loadingSp && <div className="ldm-empty">Loading salespeople…</div>}
            {!loadingSp && filteredSps.length === 0 && <div className="ldm-empty">No salespeople match</div>}
            {!loadingSp && filteredSps.length > 0 && (
              <label className="ldm-sp-row ldm-sp-all">
                <input
                  type="checkbox"
                  checked={selectedSps.size === filteredSps.length && filteredSps.length > 0}
                  ref={el => { if (el) el.indeterminate = selectedSps.size > 0 && selectedSps.size < filteredSps.length; }}
                  onChange={toggleAll}
                />
                <span><strong>Select all visible</strong></span>
              </label>
            )}
            {filteredSps.map(sp => (
              <label key={sp.id} className="ldm-sp-row">
                <input
                  type="checkbox"
                  checked={selectedSps.has(sp.id)}
                  onChange={() => toggleSp(sp.id)}
                />
                <span className="ldm-sp-code">{sp.code}</span>
                <span className="ldm-sp-name">{sp.name}</span>
                {sp.subtitle && <span className="ldm-sp-sub">{sp.subtitle}</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="ldm-foot">
          <button className="ldm-btn ldm-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="ldm-btn ldm-btn-primary" onClick={onSubmit} disabled={submitting || loadingSp}>
            {submitting ? 'Distributing…' : 'Distribute Leads'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const LDM_CSS = `
.ldm-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: ldm-fade .15s ease-out;
}
@keyframes ldm-fade { from { opacity: 0; } to { opacity: 1; } }
.ldm-modal {
  width: 720px; max-width: 95vw; max-height: 90vh;
  background: #fff; border-radius: 14px; box-shadow: 0 18px 48px rgba(15,23,42,.25);
  overflow: hidden; display: flex; flex-direction: column;
  animation: ldm-pop .18s ease-out;
}
@keyframes ldm-pop { from { transform: scale(.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ldm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff;
}
.ldm-head-left { display: flex; align-items: center; gap: 12px; }
.ldm-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.ldm-head-title { font-size: 16px; font-weight: 600; line-height: 1.2; }
.ldm-head-sub { font-size: 11px; opacity: .85; line-height: 1.3; margin-top: 2px; }
.ldm-close {
  width: 28px; height: 28px; border: none; background: rgba(255,255,255,.15);
  color: #fff; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.ldm-close:hover { background: rgba(255,255,255,.28); }
.ldm-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.ldm-section-label {
  font-size: 11.5px; font-weight: 700; color: #155e75; text-transform: uppercase; letter-spacing: .04em;
  display: flex; align-items: center; gap: 8px;
}
.ldm-count {
  background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc;
  border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-weight: 600; letter-spacing: 0;
}
.ldm-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.ldm-field { display: flex; flex-direction: column; gap: 4px; }
.ldm-label { font-size: 11.5px; font-weight: 600; color: #334155; }
.ldm-input {
  height: 34px; padding: 0 10px; font-size: 12.5px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.ldm-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.ldm-search { margin-top: 4px; }
.ldm-sp-list {
  max-height: 220px; overflow-y: auto;
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px;
}
.ldm-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 18px 12px; font-size: 12px; }
.ldm-sp-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  font-size: 12.5px; color: #1e293b;
  transition: background .12s;
}
.ldm-sp-row:hover { background: #f1f5f9; }
.ldm-sp-row input { accent-color: #0891b2; cursor: pointer; }
.ldm-sp-all { border-bottom: 1px solid #e2e8f0; border-radius: 6px 6px 0 0; }
.ldm-sp-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #0891b2; min-width: 64px; font-weight: 600; }
.ldm-sp-name { font-weight: 500; }
.ldm-sp-sub { color: #94a3b8; font-size: 11px; margin-left: auto; }
.ldm-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
}
.ldm-btn {
  padding: 8px 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1.5px solid transparent; transition: all .15s;
}
.ldm-btn:disabled { opacity: .55; cursor: not-allowed; }
.ldm-btn-ghost { background: #fff; border-color: #cbd5e1; color: #475569; }
.ldm-btn-ghost:hover:not(:disabled) { background: #f1f5f9; }
.ldm-btn-primary { background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; }
.ldm-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }

[data-bs-theme="dark"] .ldm-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .ldm-input { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ldm-label { color: #cbd5e1; }
[data-bs-theme="dark"] .ldm-foot { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .ldm-btn-ghost { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .ldm-sp-list { border-color: #334155; }
[data-bs-theme="dark"] .ldm-sp-row { color: #e2e8f0; }
[data-bs-theme="dark"] .ldm-sp-row:hover { background: #1e293b; }
[data-bs-theme="dark"] .ldm-section-label { color: #67e8f9; }
[data-bs-theme="dark"] .ldm-count { background: rgba(8,145,178,.18); border-color: rgba(34,211,238,.3); color: #67e8f9; }
`;
