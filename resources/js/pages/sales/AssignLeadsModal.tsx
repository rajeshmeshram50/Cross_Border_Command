import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';

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
  /* Single-mode context pills — customer name + Opp code shown beneath
   * the header so the user can confirm which lead they're assigning
   * without bouncing back to the table. Optional; ignored in bulk modes. */
  customerName?: string | null;
  oppCode?: string | null;
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
  open, onClose, onAssigned, mode, leadId, leadIds, customerName = null, oppCode = null, accountLabels = [], initialSalespersonId = null,
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

  const accountOptions = useMemo(() => {
    const opts = accountLabels.map(l => ({ value: l, label: l }));
    // Manual leads (captured via the "Add New Lead" modal) are stored with
    // platform = "Offline" (SalesLeadController::store). Always surface an
    // "Offline" option so they can be bulk-assigned the same way as the
    // .env-configured IndiaMart accounts. Guard against a duplicate in the
    // unlikely event an IndiaMart label is itself "Offline".
    if (!opts.some(o => o.value.toLowerCase() === 'offline')) {
      opts.push({ value: 'Offline', label: 'Offline (Manual)' });
    }
    return opts;
  }, [accountLabels]);
  const accountAvailable = accountOptions.length > 0;

  const spOptions = useMemo(
    () => salespeople.map(sp => ({
      value: String(sp.id),
      label: sp.subtitle
        ? `${sp.code} · ${sp.name} — ${sp.subtitle}`
        : `${sp.code} · ${sp.name}`,
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
    /* Backdrop click does NOT close the dialog — the user might be
     * mid-assignment when they brush off-canvas, and losing the picked
     * salesperson / lead selection felt unsafe. ✕ and Cancel only. */
    <div className="alm-backdrop">
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
              <div className="alm-head-title">
                {mode === 'single' ? 'Assign Lead to Salesperson' : 'Assign Leads'}
              </div>
              <div className="alm-head-sub">
                {mode === 'single'    && 'Assign this lead to a sales team member'}
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

        {/* Single-mode context strip — confirms which lead the user is
            about to reassign without making them close the modal and re-open
            from the right row. Only renders when the parent supplied data. */}
        {mode === 'single' && (customerName || oppCode) && (
          <div className="alm-context">
            {customerName && (
              <span className="alm-ctx-pill">
                <span className="alm-ctx-ico">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <span className="alm-ctx-text" title={customerName}>{customerName}</span>
              </span>
            )}
            {customerName && oppCode && <span className="alm-ctx-sep" aria-hidden="true">|</span>}
            {oppCode && (
              <span className="alm-ctx-pill">
                {/* Clipboard glyph — matches the Figma's opportunity icon
                    (and the OPP-ID card in the Lead Details modal). */}
                <span className="alm-ctx-ico">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  </svg>
                </span>
                <span className="alm-ctx-text">Opp: {oppCode}</span>
              </span>
            )}
          </div>
        )}

        <div className="alm-body">
          {mode === 'filters' && accountAvailable && (
            <div className="alm-field">
              <label className="alm-label alm-label-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
                Select Account <span className="alm-req">*</span>
              </label>
              <MasterSelect
                value={account}
                onChange={setAccount}
                options={accountOptions}
                placeholder="Select account"
                invalid={!!errors.account}
              />
              {errors.account && <div className="alm-err">{errors.account}</div>}
            </div>
          )}

          {mode === 'filters' && (
            <div className="alm-grid-2">
              <div className="alm-field">
                <label className="alm-label alm-label-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Start Date <span className="alm-req">*</span>
                </label>
                <MasterDatePicker
                  value={startDate}
                  maxDate={endDate || todayStr}
                  onChange={setStartDate}
                  placeholder="Select start date"
                  invalid={!!errors.startDate}
                />
                {errors.startDate && <div className="alm-err">{errors.startDate}</div>}
              </div>
              <div className="alm-field">
                <label className="alm-label alm-label-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  End Date <span className="alm-req">*</span>
                </label>
                <MasterDatePicker
                  value={endDate}
                  minDate={startDate || undefined}
                  maxDate={todayStr}
                  onChange={setEndDate}
                  placeholder="Select end date"
                  invalid={!!errors.endDate}
                />
                {errors.endDate && <div className="alm-err">{errors.endDate}</div>}
              </div>
            </div>
          )}

          <div className="alm-field">
            <label className="alm-label alm-label-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Select Salesperson <span className="alm-req">*</span>
            </label>
            <MasterSelect
              value={spId}
              onChange={setSpId}
              options={spOptions}
              placeholder={loadingSp ? 'Loading…' : 'Search by name or EMP code…'}
              disabled={loadingSp}
              invalid={!!errors.spId}
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
          <span className="alm-foot-hint">
            <span className="alm-foot-star" aria-hidden="true">*</span>
            {mode === 'filters' ? 'All fields are required' : 'Field is required'}
          </span>
          <div className="alm-foot-actions">
            <button className="alm-btn alm-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="alm-btn alm-btn-primary" onClick={onSubmit} disabled={submitting || loadingSp}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {submitting ? 'Assigning…' : (mode === 'single' ? 'Assign Lead' : 'Assign Leads')}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
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
  border-radius: 20px; box-shadow: 0 18px 48px rgba(15,23,42,.25);
  overflow: visible; display: flex; flex-direction: column;
  animation: alm-pop .18s ease-out;
}
@keyframes alm-pop { from { transform: scale(.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.alm-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: linear-gradient(135deg, #0e7490, #0891b2);
  color: #fff; border-radius: 20px 20px 0 0;
}
/* Decorative bubble orbs (figma) — soft white circles clipped by the header. */
.alm-head::before {
  content: ''; position: absolute; right: -40px; top: -40px;
  width: 160px; height: 160px; border-radius: 50%;
  background: rgba(255,255,255,.06); pointer-events: none;
}
.alm-head::after {
  content: ''; position: absolute; right: 80px; bottom: -50px;
  width: 120px; height: 120px; border-radius: 50%;
  background: rgba(255,255,255,.04); pointer-events: none;
}
.alm-head-left { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.alm-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.alm-head-title { font-size: 16px; font-weight: 600; line-height: 1.2; }
.alm-head-sub { font-size: 11px; opacity: .85; line-height: 1.3; margin-top: 2px; }
.alm-close {
  position: relative; z-index: 1;
  width: 28px; height: 28px; border: none; background: rgba(255,255,255,.15);
  color: #fff; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.alm-close:hover { background: rgba(255,255,255,.28); }

/* Single-mode context strip — sits between the teal header and the form
   body. Light cyan band with two pills showing customer + Opp code so
   the user can confirm what they're assigning. Re-tints in dark mode to
   sit cleanly against the slate body. */
.alm-context {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px;
  background: #ecfeff;
  border-bottom: 1px solid #cffafe;
  font-size: 12px;
}
.alm-ctx-pill {
  display: inline-flex; align-items: center; gap: 7px;
  color: #0e7490; font-weight: 600;
  min-width: 0;
}
/* Rounded icon tile around each context glyph (Figma). Tinted with the
   modal's own teal — colour unchanged from ours, only the tile added. */
.alm-ctx-ico {
  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(8,145,178,.12); color: #0891b2;
}
.alm-ctx-text {
  max-width: 240px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.alm-ctx-sep { color: #67e8f9; font-weight: 400; }
[data-bs-theme="dark"] .alm-context {
  background: rgba(8,145,178,.12);
  border-bottom-color: rgba(6,182,212,.25);
}
[data-bs-theme="dark"] .alm-ctx-pill { color: #67e8f9; }
[data-bs-theme="dark"] .alm-ctx-ico  { background: rgba(34,211,238,.16); color: #67e8f9; }
[data-bs-theme="dark"] .alm-ctx-sep  { color: rgba(103,232,249,.45); }

.alm-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.alm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.alm-field { display: flex; flex-direction: column; gap: 4px; position: relative; }
/* Match the figma field curve (10px) on the account / date / salesperson
   controls (MasterSelect + MasterDatePicker), scoped to this modal. */
.alm-modal .master-select-wrap .master-select-toggle,
.alm-modal .master-datepicker-wrap .master-datepicker-toggle { border-radius: 10px; }
.alm-label { font-size: 11.5px; font-weight: 600; color: #334155; }
/* Label with a leading icon (Select Salesperson) — uppercase to match Figma. */
.alm-label-icon {
  display: inline-flex; align-items: center; gap: 6px;
  text-transform: uppercase; letter-spacing: .04em;
}
.alm-label-icon svg { color: #0891b2; flex-shrink: 0; }
.alm-req { color: #ef4444; }
.alm-err { font-size: 10.5px; color: #ef4444; margin-top: 2px; }
.alm-note {
  font-size: 11.5px; color: #155e75; background: #ecfeff;
  border: 1px solid #a5f3fc; border-radius: 8px; padding: 8px 10px;
}
.alm-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
  border-radius: 0 0 20px 20px;
}
/* "Field is required" hint on the footer's left edge (Figma). */
.alm-foot-hint {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; color: #ef4444;
}
/* Required-fields marker — an asterisk (star), per the Figma, not a dot. */
.alm-foot-star { color: #ef4444; font-size: 15px; font-weight: 800; line-height: 1; flex-shrink: 0; }
.alm-foot-actions { display: flex; align-items: center; gap: 8px; }
.alm-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 10px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1.5px solid transparent; transition: all .18s ease;
}
.alm-btn:disabled { opacity: .55; cursor: not-allowed; }
.alm-btn-ghost { background: #fff; border-color: #cbd5e1; color: #475569; }
.alm-btn-ghost:hover:not(:disabled) {
  background: #f1f5f9; border-color: #94a3b8; color: #0f172a;
  transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,.10);
}
.alm-btn-primary {
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  box-shadow: 0 4px 14px rgba(8,145,178,.35);
}
.alm-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(8,145,178,.50);
}
.alm-btn-primary:active:not(:disabled),
.alm-btn-ghost:active:not(:disabled) { transform: translateY(0); }

[data-bs-theme="dark"] .alm-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .alm-label { color: #cbd5e1; }
[data-bs-theme="dark"] .alm-foot { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .alm-btn-ghost { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .alm-note { background: rgba(8,145,178,.18); border-color: rgba(34,211,238,.3); color: #67e8f9; }

/* Phone — single-column date range, fewer side paddings, full-width buttons */
@media (max-width: 520px) {
  .alm-backdrop { padding: 12px; }
  .alm-modal { width: 100%; }
  .alm-head { padding: 14px 16px; }
  .alm-head-title { font-size: 15px; }
  .alm-body { padding: 16px; gap: 12px; }
  .alm-grid-2 { grid-template-columns: 1fr; }
  .alm-foot { padding: 12px 16px; flex-direction: column-reverse; align-items: stretch; }
  .alm-foot-actions { width: 100%; }
  .alm-foot .alm-btn { flex: 1; justify-content: center; }
  .alm-foot-hint { justify-content: center; }
}
`;
