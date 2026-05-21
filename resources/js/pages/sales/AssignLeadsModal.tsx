import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Assign Leads modal.
 *
 * Three call modes (controlled by the `mode` prop):
 *   1. 'single'     — assign one lead to a salesperson (row-action). The
 *                     `leadId` prop is required.
 *   2. 'selection'  — bulk-assign the currently selected leads (the parent
 *                     passes their numeric ids via `leadIds`).
 *   3. 'filters'    — bulk-assign every lead matching account / date range
 *                     filters that the user fills in here. The account
 *                     options are the .env-configured IndiaMart labels
 *                     (passed in via `accountLabels`) — when none are
 *                     configured for the branch the account field stays
 *                     hidden and the bulk picker reduces to date + salesperson.
 *
 * Source of truth for the salesperson dropdown is GET /sales/leads/salespeople.
 * On submit we POST /sales/leads/assign with { lead_ids, salesperson_id }.
 * In 'filters' mode we first resolve lead_ids by re-querying GET /sales/leads
 * with the chosen filters (per_page=1000 cap matches the legacy behaviour;
 * the assign endpoint itself can handle far more).
 * ───────────────────────────────────────────────────────────────────────── */

type Mode = 'single' | 'selection' | 'filters';

type Salesperson = {
  id: number;
  name: string;
  code: string;
  role: string;
  subtitle: string;
};

type AssignProps = {
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
  mode: Mode;
  leadId?: number | null;        // single mode
  leadIds?: number[];            // selection mode
  /* Pre-select the salesperson dropdown to this user when the modal
   * opens. Used by the row-action assign button to show "this lead is
   * already with X" and by the bulk flow when every selected lead shares
   * the same owner. Null = leave the dropdown empty. */
  initialSalespersonId?: number | null;
  /* Account options — the .env-configured IndiaMart key labels for the
   * caller's branch. Empty array hides the Account field entirely. */
  accountLabels?: string[];
};

export default function AssignLeadsModal({
  open, onClose, onAssigned, mode, leadId, leadIds, accountLabels = [], initialSalespersonId = null,
}: AssignProps) {
  const toast = useToast();

  const [salespeople, setSalespeople]   = useState<Salesperson[]>([]);
  const [loadingSp, setLoadingSp]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);

  const [spId, setSpId]                 = useState<string>('');
  const [account, setAccount]           = useState<string>('');
  const [startDate, setStartDate]       = useState<string>('');
  const [endDate, setEndDate]           = useState<string>('');
  const [errors, setErrors]             = useState<Record<string, string>>({});

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) {
      setSpId(''); setAccount(''); setStartDate(''); setEndDate('');
      setErrors({});
      return;
    }
    // Pre-select the current owner so the dropdown shows "Already with X"
    // instead of an empty box when the user re-opens an assigned lead.
    setSpId(initialSalespersonId ? String(initialSalespersonId) : '');
    setLoadingSp(true);
    api.get<{ status: boolean; data: Salesperson[] }>('/sales/leads/salespeople')
      .then(({ data }) => setSalespeople(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load salespeople'))
      .finally(() => setLoadingSp(false));
  }, [open, toast, initialSalespersonId]);

  const accountOptions = useMemo(
    () => accountLabels.map(l => ({ value: l, label: l })),
    [accountLabels],
  );
  const accountAvailable = accountOptions.length > 0;

  const spOptions = useMemo(
    () => salespeople.map(sp => ({
      value: String(sp.id),
      label: `${sp.code} · ${sp.name}`,
      sub:   sp.subtitle,
    })),
    [salespeople],
  );

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!spId) next.spId = 'Select a salesperson';
    if (mode === 'filters') {
      if (accountAvailable && !account) next.account = 'Select an account';
      if (!startDate)             next.startDate  = 'Start date is required';
      if (!endDate)               next.endDate    = 'End date is required';
      if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        next.endDate = 'End date cannot be before start date';
      }
    }
    if (mode === 'selection' && !(leadIds && leadIds.length > 0)) {
      next.spId = 'No leads selected — select rows first';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const resolveLeadIds = async (): Promise<number[]> => {
    if (mode === 'single' && leadId)   return [leadId];
    if (mode === 'selection')          return leadIds ?? [];
    // filters mode — re-query with status=all so we don't accidentally
    // skip disqualified rows the user wanted to reassign.
    const params: Record<string, unknown> = {
      status: 'all',
      start_date: startDate,
      end_date: endDate,
      per_page: 1000,
      page: 1,
      with_counts: 0,
    };
    if (accountAvailable && account) params.platform = account;
    const { data } = await api.get<{ data: Array<{ id: number }> }>('/sales/leads', { params });
    return (data.data ?? []).map(l => l.id);
  };

  const onSubmit = async () => {
    if (!validate()) {
      toast.warning('Missing details', 'Please complete the highlighted fields');
      return;
    }
    setSubmitting(true);
    try {
      const ids = await resolveLeadIds();
      if (ids.length === 0) {
        toast.warning('No leads matched', 'Your filters returned zero leads to assign');
        setSubmitting(false);
        return;
      }
      const { data } = await api.post<{
        status: boolean; message: string;
        new_assigned: number; reassigned: number; skipped_no_scope: number;
      }>('/sales/leads/assign', {
        lead_ids: ids,
        salesperson_id: Number(spId),
      });
      toast.success(
        'Leads assigned',
        `${data.new_assigned} newly assigned, ${data.reassigned} reassigned` +
        (data.skipped_no_scope > 0 ? `, ${data.skipped_no_scope} skipped (out of scope)` : ''),
      );
      onAssigned();
      onClose();
    } catch (e: any) {
      toast.error('Assign failed', e?.response?.data?.message ?? 'Could not assign leads');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const headerCount = mode === 'single' ? 1 : mode === 'selection' ? (leadIds?.length ?? 0) : null;

  return createPortal((
    <div className="alm-backdrop" onClick={onClose}>
      <style>{ALM_CSS}</style>
      <div className="alm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="alm-head">
          <div className="alm-head-left">
            <div className="alm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <div className="alm-head-title">Assign Leads</div>
              <div className="alm-head-sub">
                {mode === 'single'    && `Assign lead #${leadId} to a salesperson`}
                {mode === 'selection' && `${headerCount} lead${(headerCount ?? 0) === 1 ? '' : 's'} selected from the table`}
                {mode === 'filters'   && (accountAvailable
                  ? 'Pick an account + date range; every matching lead will be assigned'
                  : 'Pick a date range; every matching lead will be assigned')}
              </div>
            </div>
          </div>
          <button className="alm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="alm-body">
          {mode === 'filters' && accountAvailable && (
            <div className="alm-field">
              <label className="alm-label">Select Account <span className="alm-req">*</span></label>
              <SearchableSelect
                value={account}
                onChange={setAccount}
                options={accountOptions}
                placeholder="Select account"
                error={!!errors.account}
              />
              {errors.account && <div className="alm-err">{errors.account}</div>}
            </div>
          )}

          {mode === 'filters' && (
            <div className="alm-grid-2">
              <div className="alm-field">
                <label className="alm-label">Start Date <span className="alm-req">*</span></label>
                <DateInput
                  value={startDate}
                  max={todayStr}
                  onChange={setStartDate}
                  error={!!errors.startDate}
                />
                {errors.startDate && <div className="alm-err">{errors.startDate}</div>}
              </div>
              <div className="alm-field">
                <label className="alm-label">End Date <span className="alm-req">*</span></label>
                <DateInput
                  value={endDate}
                  min={startDate || undefined}
                  max={todayStr}
                  onChange={setEndDate}
                  error={!!errors.endDate}
                />
                {errors.endDate && <div className="alm-err">{errors.endDate}</div>}
              </div>
            </div>
          )}

          <div className="alm-field">
            <label className="alm-label">Select Salesperson <span className="alm-req">*</span></label>
            <SearchableSelect
              value={spId}
              onChange={setSpId}
              options={spOptions}
              placeholder={loadingSp ? 'Loading…' : 'Search by name or EMP code…'}
              disabled={loadingSp}
              error={!!errors.spId}
            />
            {errors.spId && <div className="alm-err">{errors.spId}</div>}
          </div>

          {mode === 'selection' && (
            <div className="alm-note">
              <strong>{headerCount}</strong> lead{(headerCount ?? 0) === 1 ? '' : 's'} from the current selection will be assigned.
            </div>
          )}
        </div>

        <div className="alm-foot">
          <button className="alm-btn alm-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="alm-btn alm-btn-primary" onClick={onSubmit} disabled={submitting || loadingSp}>
            {submitting ? 'Assigning…' : (mode === 'single' ? 'Assign Lead' : 'Assign Leads')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  SearchableSelect — minimal combobox dropdown with type-to-filter.
 *  Used by the Account + Salesperson fields. Keeps the AssignLeadsModal
 *  self-contained (no extra deps) and styled to match the rest of the UI.
 * ───────────────────────────────────────────────────────────────────────── */

type SSOption = { value: string; label: string; sub?: string };

function SearchableSelect(props: {
  value: string;
  onChange: (v: string) => void;
  options: SSOption[];
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
}) {
  const { value, onChange, options, placeholder, disabled, error } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find(o => o.value === value);

  // Outside click closes
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus the search input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const s = query.toLowerCase();
    return options.filter(o =>
      o.label.toLowerCase().includes(s) ||
      (o.sub ?? '').toLowerCase().includes(s),
    );
  }, [options, query]);

  return (
    <div className={`alm-ss ${error ? 'alm-ss-err' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="alm-ss-trigger"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected ? 'alm-ss-val' : 'alm-ss-placeholder'}>
          {selected ? selected.label : (placeholder ?? 'Select…')}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="alm-ss-pop">
          <div className="alm-ss-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="alm-ss-list">
            {filtered.length === 0 && <div className="alm-ss-empty">No matches</div>}
            {filtered.map(o => (
              <div
                key={o.value}
                className={`alm-ss-item ${o.value === value ? 'on' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
              >
                <div className="alm-ss-item-label">{o.label}</div>
                {o.sub && <div className="alm-ss-item-sub">{o.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  DateInput — `type="date"` wrapper with a leading calendar icon and a
 *  visual style matching the rest of the modal. The native picker still
 *  drives the calendar so we keep keyboard/touch support intact.
 * ───────────────────────────────────────────────────────────────────────── */
function DateInput(props: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  error?: boolean;
}) {
  const { value, onChange, min, max, error } = props;
  return (
    <div className={`alm-date ${error ? 'alm-date-err' : ''}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

const ALM_CSS = `
.alm-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: alm-fade .15s ease-out;
}
@keyframes alm-fade { from { opacity: 0; } to { opacity: 1; } }
.alm-modal {
  width: 560px; max-width: 95vw; background: #fff;
  border-radius: 14px; box-shadow: 0 18px 48px rgba(15,23,42,.25);
  overflow: visible; display: flex; flex-direction: column;
  animation: alm-pop .18s ease-out;
}
@keyframes alm-pop { from { transform: scale(.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.alm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: linear-gradient(135deg, #0e7490, #0891b2);
  color: #fff; border-radius: 14px 14px 0 0;
}
.alm-head-left { display: flex; align-items: center; gap: 12px; }
.alm-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.alm-head-title { font-size: 16px; font-weight: 600; line-height: 1.2; }
.alm-head-sub { font-size: 11px; opacity: .85; line-height: 1.3; margin-top: 2px; }
.alm-close {
  width: 28px; height: 28px; border: none; background: rgba(255,255,255,.15);
  color: #fff; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.alm-close:hover { background: rgba(255,255,255,.28); }
.alm-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.alm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.alm-field { display: flex; flex-direction: column; gap: 4px; position: relative; }
.alm-label { font-size: 11.5px; font-weight: 600; color: #334155; }
.alm-req { color: #ef4444; }
.alm-err { font-size: 10.5px; color: #ef4444; margin-top: 2px; }
.alm-note {
  font-size: 11.5px; color: #155e75; background: #ecfeff;
  border: 1px solid #a5f3fc; border-radius: 8px; padding: 8px 10px;
}
.alm-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
  border-radius: 0 0 14px 14px;
}
.alm-btn {
  padding: 8px 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1.5px solid transparent; transition: all .15s;
}
.alm-btn:disabled { opacity: .55; cursor: not-allowed; }
.alm-btn-ghost { background: #fff; border-color: #cbd5e1; color: #475569; }
.alm-btn-ghost:hover:not(:disabled) { background: #f1f5f9; }
.alm-btn-primary {
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
}
.alm-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }

/* SearchableSelect */
.alm-ss { position: relative; }
.alm-ss-trigger {
  width: 100%; height: 38px; padding: 0 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border: 1.5px solid #cbd5e1; border-radius: 8px; background: #fff;
  font-size: 12.5px; color: #0f172a; cursor: pointer; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.alm-ss-trigger:hover { border-color: #94a3b8; }
.alm-ss-trigger:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.alm-ss-trigger:disabled { opacity: .55; cursor: not-allowed; background: #f8fafc; }
.alm-ss-err .alm-ss-trigger { border-color: #ef4444; }
.alm-ss-val { font-weight: 500; }
.alm-ss-placeholder { color: #94a3b8; }
.alm-ss-pop {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 30;
  background: #fff; border: 1.5px solid #cbd5e1; border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15,23,42,.18);
  overflow: hidden; max-height: 280px; display: flex; flex-direction: column;
}
.alm-ss-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0; background: #f8fafc;
}
.alm-ss-search input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 12.5px; color: #0f172a;
}
.alm-ss-list { flex: 1; overflow-y: auto; padding: 4px; }
.alm-ss-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 14px 8px; font-size: 12px; }
.alm-ss-item {
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  transition: background .12s;
}
.alm-ss-item:hover { background: #f1f5f9; }
.alm-ss-item.on { background: #ecfeff; }
.alm-ss-item-label { font-size: 12.5px; color: #0f172a; font-weight: 500; }
.alm-ss-item-sub { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }

/* DateInput */
.alm-date {
  height: 38px; padding: 0 12px; display: flex; align-items: center; gap: 8px;
  border: 1.5px solid #cbd5e1; border-radius: 8px; background: #fff;
  transition: border-color .15s, box-shadow .15s;
}
.alm-date:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.alm-date-err { border-color: #ef4444; }
.alm-date input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 12.5px; color: #0f172a; font-family: inherit;
}
.alm-date input::-webkit-calendar-picker-indicator {
  filter: invert(38%) sepia(95%) saturate(602%) hue-rotate(155deg);
  cursor: pointer;
}

[data-bs-theme="dark"] .alm-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .alm-label { color: #cbd5e1; }
[data-bs-theme="dark"] .alm-foot { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .alm-btn-ghost { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .alm-note { background: rgba(8,145,178,.18); border-color: rgba(34,211,238,.3); color: #67e8f9; }
[data-bs-theme="dark"] .alm-ss-trigger,
[data-bs-theme="dark"] .alm-date { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .alm-ss-pop { background: #0f172a; border-color: #334155; }
[data-bs-theme="dark"] .alm-ss-search { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .alm-ss-search input,
[data-bs-theme="dark"] .alm-date input { color: #e2e8f0; }
[data-bs-theme="dark"] .alm-ss-item:hover { background: #1e293b; }
[data-bs-theme="dark"] .alm-ss-item.on { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .alm-ss-item-label { color: #e2e8f0; }

/* Phone — single-column date range, fewer side paddings, full-width buttons */
@media (max-width: 520px) {
  .alm-backdrop { padding: 12px; }
  .alm-modal { width: 100%; }
  .alm-head { padding: 14px 16px; }
  .alm-head-title { font-size: 15px; }
  .alm-body { padding: 16px; gap: 12px; }
  .alm-grid-2 { grid-template-columns: 1fr; }
  .alm-foot { padding: 12px 16px; flex-direction: column-reverse; }
  .alm-foot .alm-btn { width: 100%; }
}
`;
