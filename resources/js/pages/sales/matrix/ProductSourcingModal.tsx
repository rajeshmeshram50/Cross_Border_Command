import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Product Sourcing — Stage 3 quick-action modal.
 *
 * Pulls every product mapped to the opportunity from
 * GET /sales/leads/{id}/products, lets the salesperson tag each as either
 * `required` (needs procurement) or `not_required` (already has live
 * pricing), and persists changes through PATCH
 * /sales/leads/{id}/products/{mapping}/sourcing-status.
 *
 * Three tabs let the user pivot the same dataset:
 *   - Product Details      → every mapped row
 *   - Sourcing Required    → only rows tagged `required`
 *   - Sourcing Not Required → only rows tagged `not_required`
 *
 * Business rule mirrored from the backend (see
 * SalesLeadController::updateLeadProductSourcingStatus): inactive / draft
 * product masters MUST be marked Required because they have no current
 * selling price. The "Sourcing Not Required" dropdown option is disabled
 * for those rows so the user can't trigger a 422.
 * ───────────────────────────────────────────────────────────────────────── */

type SourcingStatus = 'required' | 'not_required';

type SourcingRow = {
  id:               number;
  product_id:       number;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  product_category: string | null;
  currency:         string;
  quantity:         string | number | null;
  target_price:     string | number | null;
  sourcing_status:  SourcingStatus | null;
};

type Props = {
  open:    boolean;
  leadId:  number | null;
  onClose: () => void;
  /** Fired after any successful sourcing change so the parent can refresh
   *  Stage 3 progress indicators or unlock Stage 4. */
  onChanged?: () => void;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', AUD: 'A$', SGD: 'S$',
};
const currencySymbol = (code: string | null | undefined): string => {
  if (!code) return '';
  const c = String(code).toUpperCase();
  return CURRENCY_SYMBOLS[c] ?? c;
};

/* Uses the same Bootstrap badge classes as the Clients table and
 * Product Directory so organisation/status pills stay consistent
 * across the product. *-subtle utilities adapt to dark mode too. */
function StatusPill({ status }: { status: string | null | undefined }) {
  const norm = String(status ?? '').toLowerCase();
  const isActive = norm === 'active' || norm === '1' || norm === 'true';
  const color = isActive ? 'success' : 'danger';
  return (
    <span className={`badge rounded-pill bg-${color}-subtle text-${color} fw-semibold px-3 py-2 fs-13`}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

type TabKey = 'all' | 'required' | 'not_required';

export default function ProductSourcingModal({ open, leadId, onClose, onChanged }: Props) {
  const toast = useToast();

  const [rows, setRows]         = useState<SourcingRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState<TabKey>('all');
  const [savingId, setSavingId] = useState<number | null>(null);

  /* Reload the mapped products every time the modal opens for a lead.
   * Same endpoint as Product Directory; we just pivot on
   * sourcing_status for filtering. */
  useEffect(() => {
    if (!open || !leadId) {
      setRows([]);
      setTab('all');
      return;
    }
    setLoading(true);
    api.get<{ status: boolean; data: SourcingRow[] }>(`/sales/leads/${leadId}/products`)
      .then(({ data }) => setRows(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load mapped products'))
      .finally(() => setLoading(false));
  }, [open, leadId, toast]);

  const counts = useMemo(() => {
    const req = rows.filter(r => r.sourcing_status === 'required').length;
    const not = rows.filter(r => r.sourcing_status === 'not_required').length;
    return { all: rows.length, required: req, not_required: not, set: req + not };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (tab === 'required')     return rows.filter(r => r.sourcing_status === 'required');
    if (tab === 'not_required') return rows.filter(r => r.sourcing_status === 'not_required');
    return rows;
  }, [rows, tab]);

  if (!open) return null;

  const updateSourcing = async (row: SourcingRow, newStatus: SourcingStatus) => {
    if (!leadId) return;
    setSavingId(row.id);
    try {
      await api.patch(`/sales/leads/${leadId}/products/${row.id}/sourcing-status`, {
        sourcing_status: newStatus,
      });
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, sourcing_status: newStatus } : r));
      toast.success(
        'Sourcing updated',
        newStatus === 'required' ? 'Marked Sourcing Required' : 'Marked Sourcing Not Required',
      );
      onChanged?.();
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not update sourcing status');
    } finally {
      setSavingId(null);
    }
  };

  const progressPct = counts.all > 0 ? Math.round((counts.set / counts.all) * 100) : 0;

  return createPortal((
    <div className="psm-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="psm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header — violet gradient with hex icon ── */}
        <div className="psm-head">
          <div className="psm-head-left">
            <div className="psm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </div>
            <div>
              <div className="psm-head-title">Stage 3: Product Sourcing</div>
              <div className="psm-head-sub">
                <span className="psm-head-dot" />
                Product details and sourcing status
              </div>
            </div>
          </div>
          <button className="psm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Tabs row ── */}
        <div className="psm-tabs">
          <button
            type="button"
            className={`psm-tab psm-tab-all ${tab === 'all' ? 'psm-tab-active' : ''}`}
            onClick={() => setTab('all')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9"  x2="21" y2="9" />
              <line x1="9" y1="21" x2="9"  y2="9" />
            </svg>
            Product Details
            <span className="psm-tab-count">{counts.all}</span>
          </button>
          <button
            type="button"
            className={`psm-tab psm-tab-req ${tab === 'required' ? 'psm-tab-active' : ''}`}
            onClick={() => setTab('required')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="9" />
            </svg>
            Sourcing Required
            {counts.required > 0 && <span className="psm-tab-count">{counts.required}</span>}
          </button>
          <button
            type="button"
            className={`psm-tab psm-tab-not ${tab === 'not_required' ? 'psm-tab-active' : ''}`}
            onClick={() => setTab('not_required')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Sourcing Not Required
            {counts.not_required > 0 && <span className="psm-tab-count">{counts.not_required}</span>}
          </button>
        </div>

        {/* ── Body ── */}
        <div className="psm-body">
          <div className="psm-card">
            <div className="psm-card-head">
              <div className="psm-card-head-left">
                <div className="psm-card-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                  </svg>
                </div>
                <div>
                  <div className="psm-card-title">
                    All Mapped Products
                    <span className="psm-card-count">{visibleRows.length}</span>
                  </div>
                  <div className="psm-card-sub">Assign sourcing status to each product to proceed</div>
                </div>
              </div>
              <div className="psm-legend">
                <span className="psm-legend-pill psm-legend-on">
                  <span className="psm-legend-dot" />
                  Active: either tab
                </span>
                <span className="psm-legend-pill psm-legend-off">
                  <span className="psm-legend-dot" />
                  Inactive: Required only
                </span>
              </div>
            </div>

            <div className="psm-table-wrap">
              <table className="psm-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>SR</th>
                    <th style={{ width: 110 }}>CODE</th>
                    <th>PRODUCT NAME</th>
                    <th style={{ width: 110 }}>STATUS</th>
                    <th style={{ width: 80 }}>QTY</th>
                    <th style={{ width: 140 }}>TARGET PRICE</th>
                    <th style={{ width: 90 }}>CURRENCY</th>
                    <th style={{ width: 170 }}>SOURCING STATUS</th>
                    <th style={{ width: 110 }}>SET</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={9} className="psm-status-row">Loading mapped products…</td></tr>
                  )}
                  {!loading && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="psm-status-row">
                        {tab === 'all'
                          ? 'No products mapped yet — open Product Directory to map the first.'
                          : tab === 'required'
                            ? 'No products tagged as Sourcing Required.'
                            : 'No products tagged as Sourcing Not Required.'}
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((r, i) => {
                    const isInactive = String(r.product_status ?? '').toLowerCase() !== 'active';
                    const isSaving   = savingId === r.id;
                    return (
                      <tr key={r.id}>
                        <td><span className="psm-sr-pill">{i + 1}</span></td>
                        <td>
                          <span className="psm-code-chip" title={r.product_code ?? ''}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <rect x="4" y="4" width="16" height="16" rx="2.5" />
                            </svg>
                            {r.product_code ?? '—'}
                          </span>
                        </td>
                        <td>
                          <div className="psm-name-cell">
                            <span className="psm-prod-name">{r.product_name ?? '—'}</span>
                            {r.product_category && (
                              <span className="psm-cat-badge">{r.product_category.toUpperCase()}</span>
                            )}
                          </div>
                        </td>
                        <td><StatusPill status={r.product_status} /></td>
                        <td className="psm-num">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                        <td className="psm-num psm-price">
                          {r.target_price != null
                            ? `${currencySymbol(r.currency)} ${Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td><span className="psm-curr-pill">{r.currency}</span></td>
                        <td>
                          <select
                            className="psm-select"
                            value={r.sourcing_status ?? ''}
                            disabled={isSaving}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === 'required' || v === 'not_required') {
                                void updateSourcing(r, v);
                              }
                            }}
                          >
                            <option value="">— Select —</option>
                            <option value="required">Sourcing Required</option>
                            <option value="not_required" disabled={isInactive}>
                              Sourcing Not Required{isInactive ? ' (inactive)' : ''}
                            </option>
                          </select>
                        </td>
                        <td>
                          {isSaving ? (
                            <span className="psm-set psm-set-saving">saving…</span>
                          ) : r.sourcing_status === 'required' ? (
                            <span className="psm-set psm-set-req">
                              <span className="psm-set-dot" /> Required
                            </span>
                          ) : r.sourcing_status === 'not_required' ? (
                            <span className="psm-set psm-set-not">
                              <span className="psm-set-dot" /> Not Required
                            </span>
                          ) : (
                            <span className="psm-set psm-set-off">— not set</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Progress strip — count of rows with a sourcing decision over
                the total mapped count. Acts as the Stage 3 completion
                gauge; once every row is set the user can advance. */}
            <div className="psm-progress-row">
              <span className="psm-progress-label">PROGRESS</span>
              <div className="psm-progress-bar" role="progressbar"
                aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="psm-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="psm-progress-count">{counts.set} / {counts.all} set</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.psm-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.psm-modal {
  width: min(1180px, 100%); max-height: 92vh;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  font-family: inherit;
}

/* ── Header — 4-stop violet sweep matching the matrix-modal family
   (Product Directory, Map Product, Change Owner, Remarks, Key
   Opportunity, Reminders/Meetings list). */
.psm-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-shrink: 0;
  padding: 16px 22px;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
  color: #fff;
  position: relative; overflow: hidden;
}
.psm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.psm-head-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.psm-head-title {
  font-size: 16px; font-weight: 800; line-height: 1.2;
  color: #fff; letter-spacing: -.2px;
}
.psm-head-sub {
  font-size: 11.5px; font-weight: 500; color: rgba(255, 255, 255, .88);
  margin-top: 4px;
  display: inline-flex; align-items: center; gap: 6px;
}
.psm-head-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #4ade80; box-shadow: 0 0 0 2px rgba(255, 255, 255, .35);
}
.psm-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .20); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.psm-close:hover { background: rgba(255, 255, 255, .34); }

/* ── Tabs ── */
.psm-tabs {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 22px;
  background: #fff;
  border-bottom: 1px solid #f1f5f9;
}
.psm-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px;
  border: 1.5px solid transparent;
  border-radius: 9px;
  background: #fff; color: #475569;
  font-size: 12px; font-weight: 700; letter-spacing: .01em;
  cursor: pointer; transition: all .15s;
}
.psm-tab svg { flex-shrink: 0; }
.psm-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; padding: 1px 8px; border-radius: 999px;
  background: rgba(255, 255, 255, .35);
  font-size: 10.5px; font-weight: 800; color: inherit;
}

/* All tab — purple gradient when active */
.psm-tab-all          { border-color: #ddd6fe; color: #6d28d9; background: #fff; }
.psm-tab-all.psm-tab-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.psm-tab-all.psm-tab-active .psm-tab-count { background: rgba(255, 255, 255, .25); color: #fff; }
.psm-tab-all:not(.psm-tab-active) .psm-tab-count { background: #ede9fe; color: #6d28d9; }

/* Required tab — amber outline / solid */
.psm-tab-req          { border-color: #fed7aa; color: #c2410c; background: #fff; }
.psm-tab-req:not(.psm-tab-active):hover { background: #fff7ed; }
.psm-tab-req.psm-tab-active {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(245, 158, 11, .35);
}
.psm-tab-req .psm-tab-count        { background: #fed7aa; color: #c2410c; }
.psm-tab-req.psm-tab-active .psm-tab-count { background: rgba(255, 255, 255, .25); color: #fff; }

/* Not Required tab — emerald outline / solid */
.psm-tab-not          { border-color: #bbf7d0; color: #15803d; background: #fff; }
.psm-tab-not:not(.psm-tab-active):hover { background: #f0fdf4; }
.psm-tab-not.psm-tab-active {
  background: linear-gradient(135deg, #22c55e, #15803d);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(34, 197, 94, .35);
}
.psm-tab-not .psm-tab-count        { background: #bbf7d0; color: #15803d; }
.psm-tab-not.psm-tab-active .psm-tab-count { background: rgba(255, 255, 255, .25); color: #fff; }

/* ── Body ── */
.psm-body  { flex: 1; overflow-y: auto; padding: 14px 22px 18px; background: #faf5ff; }
.psm-card  {
  background: #fff;
  border: 1.5px solid #e9d5ff;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(124, 58, 237, .07);
  overflow: hidden;
}

/* Card header — title + legend pills */
.psm-card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid #f3e8ff;
  background: linear-gradient(180deg, #faf5ff, #fff);
}
.psm-card-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.psm-card-icon {
  width: 32px; height: 32px; border-radius: 9px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border: 1px solid #c4b5fd;
  display: flex; align-items: center; justify-content: center;
  color: #6d28d9;
}
.psm-card-title {
  font-size: 13.5px; font-weight: 800; color: #1e1b4b;
  display: inline-flex; align-items: center; gap: 8px;
}
.psm-card-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; padding: 1px 8px; border-radius: 999px;
  background: #ede9fe; color: #6d28d9;
  font-size: 10.5px; font-weight: 800;
}
.psm-card-sub  { font-size: 11.5px; color: #64748b; margin-top: 2px; font-weight: 500; }

.psm-legend       { display: flex; gap: 8px; flex-wrap: wrap; }
.psm-legend-pill  {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
}
.psm-legend-dot   { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.psm-legend-on    { background: #dcfce7; color: #15803d; }
.psm-legend-off   { background: #fee2e2; color: #b91c1c; }

/* ── Table ── */
.psm-table-wrap   { overflow: auto; max-height: 56vh; }
.psm-table        { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1080px; }
/* Table header — gradient on the tr so a single 90° sweep spans
   the whole row (matches Product Directory). */
.psm-table thead tr {
  background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
}
.psm-table thead th {
  background: transparent;
  color: #fff;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  text-align: left; padding: 11px 12px;
  position: sticky; top: 0; z-index: 2;
  white-space: nowrap;
}
.psm-table tbody tr        { border-bottom: 1px solid #f5f3ff; }
.psm-table tbody tr:last-child { border-bottom: none; }
.psm-table tbody tr:hover  { background: #faf5ff; }
.psm-table tbody td        { padding: 10px 12px; color: #1e293b; vertical-align: middle; }
.psm-num                   { font-variant-numeric: tabular-nums; }
.psm-status-row            {
  text-align: center; padding: 26px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* ── SR badge ── squared lilac chip matching Product Directory. */
.psm-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; padding: 3px 10px;
  background: #f5f3ff; color: #6d28d9;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  font-size: 11.5px; font-weight: 700;
}

/* ── CODE chip ── shares the SR badge's lilac palette. */
.psm-code-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: #f5f3ff; border: 1px solid #ddd6fe;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 700; color: #6d28d9;
}
.psm-code-chip svg { color: #7c3aed; flex-shrink: 0; }

/* ── Product name + category ── matches Product Directory. */
.psm-name-cell { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.psm-prod-name { font-size: 13px; color: #0f172a; font-weight: 700; line-height: 1.3; }
.psm-cat-badge {
  display: inline-block;
  padding: 2px 9px;
  background: #f1f5f9; color: #475569;
  border-radius: 6px;
  font-size: 9.5px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase;
}

/* ── Status pill ── */
.psm-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.psm-status-dot   { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.psm-status-on    { background: #dcfce7; color: #15803d; }
.psm-status-off   { background: #fee2e2; color: #b91c1c; }

/* ── Target price ── scoped selector wins over the cell-default
   .psm-table tbody td color rule. */
.psm-table tbody td.psm-price { color: #16a34a; font-weight: 800; }
.psm-table tbody td.psm-price * { color: inherit; }

/* ── Currency badge ── squared chip matching Product Directory. */
.psm-curr-pill {
  display: inline-block; padding: 3px 12px; border-radius: 8px;
  background: #dbeafe; color: #1d4ed8;
  font-size: 11px; font-weight: 800; letter-spacing: .02em;
  border: 1px solid #bfdbfe;
}

/* ── Sourcing dropdown ── */
.psm-select {
  width: 100%; height: 32px; padding: 0 10px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff;
  font-size: 12px; font-weight: 600; color: #1e293b;
  font-family: inherit; cursor: pointer;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.psm-select:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.psm-select:disabled { background: #f8fafc; cursor: wait; opacity: .7; }

/* ── SET indicator ── */
.psm-set {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700;
}
.psm-set-dot     { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.psm-set-off     { color: #94a3b8; font-style: italic; font-weight: 500; }
.psm-set-req     { color: #c2410c; }
.psm-set-not     { color: #15803d; }
.psm-set-saving  { color: #6d28d9; font-style: italic; font-weight: 500; }

/* ── Progress strip ── */
.psm-progress-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
  background: linear-gradient(180deg, #fff, #faf5ff);
  border-top: 1px solid #f3e8ff;
}
.psm-progress-label {
  font-size: 10px; font-weight: 800; color: #6d28d9;
  letter-spacing: .12em;
}
.psm-progress-bar {
  flex: 1; height: 6px; border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}
.psm-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #7c3aed, #5b21b6);
  border-radius: 999px;
  transition: width .25s ease-out;
}
.psm-progress-count {
  font-size: 11.5px; font-weight: 700; color: #475569;
  font-variant-numeric: tabular-nums;
}

/* ── Dark mode ── */
[data-bs-theme="dark"] .psm-modal       { background: #14102a; }
[data-bs-theme="dark"] .psm-head        {
  background: linear-gradient(135deg, #2a2150 0%, #3b2f6e 50%, #4c1d95 100%);
  color: #ede9fe;
}
[data-bs-theme="dark"] .psm-head-title  { color: #ede9fe; }
[data-bs-theme="dark"] .psm-head-sub    { color: #c4b5fd; }
[data-bs-theme="dark"] .psm-close       { background: rgba(255,255,255,.10); color: #ede9fe; }
[data-bs-theme="dark"] .psm-close:hover { background: rgba(255,255,255,.20); }
[data-bs-theme="dark"] .psm-tabs        { background: #14102a; border-bottom-color: rgba(167, 139, 250, .20); }
[data-bs-theme="dark"] .psm-tab         { background: #1f1845; color: #c4b5fd; }
[data-bs-theme="dark"] .psm-tab-all     { border-color: rgba(167, 139, 250, .30); }
[data-bs-theme="dark"] .psm-tab-req     { border-color: rgba(254, 215, 170, .30); color: #fdba74; }
[data-bs-theme="dark"] .psm-tab-not     { border-color: rgba(187, 247, 208, .30); color: #86efac; }
[data-bs-theme="dark"] .psm-body        { background: #1a1538; }
[data-bs-theme="dark"] .psm-card        {
  background: #14102a; border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .psm-card-head   {
  background: linear-gradient(180deg, #1a1538, #14102a);
  border-bottom-color: rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .psm-card-icon   {
  background: rgba(124, 58, 237, .22);
  border-color: rgba(167, 139, 250, .35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .psm-card-title  { color: #ede9fe; }
[data-bs-theme="dark"] .psm-card-count  { background: rgba(167, 139, 250, .22); color: #d8b4fe; }
[data-bs-theme="dark"] .psm-card-sub    { color: rgba(196, 181, 253, .65); }
[data-bs-theme="dark"] .psm-legend-on   { background: rgba(34, 197, 94, .18); color: #86efac; }
[data-bs-theme="dark"] .psm-legend-off  { background: rgba(239, 68, 68, .18); color: #fca5a5; }
[data-bs-theme="dark"] .psm-table thead th {
  background: #1a1538; color: #c4b5fd; border-bottom-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .psm-table tbody tr        { border-color: rgba(167, 139, 250, .15); }
[data-bs-theme="dark"] .psm-table tbody tr:hover  { background: rgba(124, 58, 237, .14); }
[data-bs-theme="dark"] .psm-table tbody td        { color: #ede9fe; }
[data-bs-theme="dark"] .psm-sr-pill   { background: rgba(167, 139, 250, .14); color: #c4b5fd; }
[data-bs-theme="dark"] .psm-code-chip {
  background: rgba(167, 139, 250, .10);
  border-color: rgba(167, 139, 250, .25);
  color: #ede9fe;
}
[data-bs-theme="dark"] .psm-code-chip svg { color: #a78bfa; }
[data-bs-theme="dark"] .psm-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .psm-cat-badge { background: rgba(167, 139, 250, .22); color: #d8b4fe; }
[data-bs-theme="dark"] .psm-status-on  { background: rgba(34, 197, 94, .18); color: #86efac; }
[data-bs-theme="dark"] .psm-status-off { background: rgba(239, 68, 68, .18); color: #fca5a5; }
[data-bs-theme="dark"] .psm-table tbody td.psm-price      { color: #34d399; }
[data-bs-theme="dark"] .psm-curr-pill  {
  background: rgba(59, 130, 246, .22);
  color: #93c5fd;
  border-color: rgba(59, 130, 246, .40);
}
[data-bs-theme="dark"] .psm-select {
  background: #1f1845; border-color: rgba(167, 139, 250, .30); color: #ede9fe;
}
[data-bs-theme="dark"] .psm-select:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .psm-set-req    { color: #fdba74; }
[data-bs-theme="dark"] .psm-set-not    { color: #86efac; }
[data-bs-theme="dark"] .psm-set-saving { color: #c4b5fd; }
[data-bs-theme="dark"] .psm-progress-row {
  background: linear-gradient(180deg, #14102a, #1a1538);
  border-top-color: rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .psm-progress-label { color: #c4b5fd; }
[data-bs-theme="dark"] .psm-progress-bar   { background: rgba(167, 139, 250, .14); }
[data-bs-theme="dark"] .psm-progress-fill  {
  background: linear-gradient(90deg, #a78bfa, #7c3aed);
}
[data-bs-theme="dark"] .psm-progress-count { color: #c4b5fd; }
[data-bs-theme="dark"] .psm-status-row     { color: rgba(196, 181, 253, .55); }

@media (max-width: 720px) {
  .psm-backdrop { padding: 0; }
  .psm-modal    { border-radius: 0; max-height: 100vh; }
  .psm-tabs     { overflow-x: auto; }
  .psm-card-head { flex-direction: column; align-items: flex-start; }
}
`;
