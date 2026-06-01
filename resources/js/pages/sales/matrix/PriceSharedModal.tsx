import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Price Shared — Stage 4 quick-action modal.
 *
 * Tab 1 (Price To Be Share):
 *   Lists every product mapped to the lead with an inline "Enter price"
 *   input + Submit pill + eye history toggle. Pulls from
 *   GET /sales/leads/{id}/products and POSTs each entry to
 *   POST /sales/leads/{id}/products/{mapping}/shared-prices.
 *
 *   Multiple prices CAN be shared for the same product — the backend
 *   keeps history. The eye button expands an inline strip showing the
 *   prior entries for that row.
 *
 * Tab 2 (Shared Price):
 *   Chronological list of every shared price already submitted on this
 *   lead. Pulls from GET /sales/leads/{id}/shared-prices.
 *
 * Business rule mirrored from the backend (see
 * SalesLeadController::storeSharedPrice): inactive / draft / pending
 * products cannot receive a shared price. The input + Submit pill are
 * disabled for those rows so the user never trips the 422.
 * ───────────────────────────────────────────────────────────────────────── */

type ProductRow = {
  id:               number;
  product_id:       number;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  product_category: string | null;
  currency:         string;
  quantity:         string | number | null;
  target_price:     string | number | null;
};

type SharedPriceRow = {
  id:               number;
  lead_product_id:  number;
  product_id:       number | null;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  product_category: string | null;
  currency:         string | null;
  quantity:         string | number | null;
  target_price:     string | number | null;
  quoted_price:     string | number;
  shared_at:        string;
};

type HistoryEntry = {
  id:           number;
  quoted_price: string | number;
  shared_at:    string;
};

type Props = {
  open:    boolean;
  leadId:  number | null;
  onClose: () => void;
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

const formatPrice = (val: string | number | null | undefined, currency?: string | null): string => {
  if (val == null || val === '') return '—';
  const num = Number(val);
  if (!isFinite(num)) return '—';
  const sym = currencySymbol(currency);
  return `${sym ? sym + ' ' : ''}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatSharedAt = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd  = String(d.getDate()).padStart(2, '0');
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const yy  = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
};

function StatusPill({ status }: { status: string | null | undefined }) {
  const norm = String(status ?? '').toLowerCase();
  const isActive = norm === 'active' || norm === '1' || norm === 'true';
  return (
    <span className={`prs-status-pill ${isActive ? 'prs-status-on' : 'prs-status-off'}`}>
      <span className="prs-status-dot" />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

type TabKey = 'to_share' | 'shared';

export default function PriceSharedModal({ open, leadId, onClose, onChanged }: Props) {
  const toast = useToast();

  const [tab, setTab]                     = useState<TabKey>('to_share');
  const [rows, setRows]                   = useState<ProductRow[]>([]);
  const [shared, setShared]               = useState<SharedPriceRow[]>([]);
  const [loadingRows, setLoadingRows]     = useState(false);
  const [loadingShared, setLoadingShared] = useState(false);
  const [drafts, setDrafts]               = useState<Record<number, string>>({});
  const [savingId, setSavingId]           = useState<number | null>(null);
  const [historyOpen, setHistoryOpen]     = useState<number | null>(null);
  const [historyData, setHistoryData]     = useState<Record<number, HistoryEntry[]>>({});
  const [historyLoadingId, setHLId]       = useState<number | null>(null);

  /* Refresh the mapped-products list whenever the modal opens. */
  useEffect(() => {
    if (!open || !leadId) {
      setRows([]); setShared([]); setDrafts({}); setHistoryOpen(null); setHistoryData({}); setTab('to_share');
      return;
    }
    setLoadingRows(true);
    api.get<{ status: boolean; data: ProductRow[] }>(`/sales/leads/${leadId}/products`)
      .then(({ data }) => setRows(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load mapped products'))
      .finally(() => setLoadingRows(false));
  }, [open, leadId, toast]);

  /* Lazily fetch the chronological shared-price history the first time
   * the user switches to that tab — and whenever a new submission lands. */
  const reloadShared = () => {
    if (!leadId) return;
    setLoadingShared(true);
    api.get<{ status: boolean; data: SharedPriceRow[] }>(`/sales/leads/${leadId}/shared-prices`)
      .then(({ data }) => setShared(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load shared-price history'))
      .finally(() => setLoadingShared(false));
  };
  useEffect(() => {
    if (open && leadId && tab === 'shared' && shared.length === 0 && !loadingShared) {
      reloadShared();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId, tab]);

  if (!open) return null;

  const submitPrice = async (row: ProductRow) => {
    if (!leadId) return;
    const raw = drafts[row.id] ?? '';
    const num = Number(raw);
    if (!raw || !isFinite(num) || num <= 0) {
      toast.warning('Enter a price', 'Quoted price must be greater than zero');
      return;
    }
    setSavingId(row.id);
    try {
      await api.post(`/sales/leads/${leadId}/products/${row.id}/shared-prices`, {
        quoted_price: num,
      });
      toast.success('Price shared', `${row.product_name ?? 'Product'} — ${formatPrice(num, row.currency)}`);
      // Clear the input + invalidate caches so they refetch when the
      // user looks at history or switches to Shared Price.
      setDrafts(p => ({ ...p, [row.id]: '' }));
      setHistoryData(p => { const c = { ...p }; delete c[row.id]; return c; });
      setShared([]);
      onChanged?.();
    } catch (e: any) {
      toast.error('Submit failed', e?.response?.data?.message ?? 'Could not save shared price');
    } finally {
      setSavingId(null);
    }
  };

  const toggleHistory = async (row: ProductRow) => {
    if (historyOpen === row.id) {
      setHistoryOpen(null);
      return;
    }
    setHistoryOpen(row.id);
    if (historyData[row.id]) return;          // already cached
    if (!leadId) return;
    setHLId(row.id);
    try {
      const { data } = await api.get<{ status: boolean; data: HistoryEntry[] }>(
        `/sales/leads/${leadId}/products/${row.id}/shared-prices`,
      );
      setHistoryData(p => ({ ...p, [row.id]: data.data ?? [] }));
    } catch {
      toast.error('Load failed', 'Could not load price history for this product');
    } finally {
      setHLId(null);
    }
  };

  const sharedCount = shared.length;

  return createPortal((
    <div className="prs-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="prs-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="prs-head">
          <div className="prs-head-left">
            <div className="prs-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <div className="prs-head-title">Stage 4: Price Shared</div>
              <div className="prs-head-sub">
                <span className="prs-head-dot" />
                Share prices with customers and track quotations
              </div>
            </div>
          </div>
          <button className="prs-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="prs-tabs">
          <button
            type="button"
            className={`prs-tab prs-tab-to ${tab === 'to_share' ? 'prs-tab-active' : ''}`}
            onClick={() => setTab('to_share')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Price To Be Share
          </button>
          <button
            type="button"
            className={`prs-tab prs-tab-shared ${tab === 'shared' ? 'prs-tab-active' : ''}`}
            onClick={() => setTab('shared')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
            </svg>
            Shared Price
            {sharedCount > 0 && <span className="prs-tab-count">{sharedCount}</span>}
          </button>
        </div>

        {/* ── Body ── */}
        <div className="prs-body">
          {tab === 'to_share' ? (
            <ToShareTable
              rows={rows}
              loading={loadingRows}
              drafts={drafts}
              setDrafts={setDrafts}
              savingId={savingId}
              onSubmit={submitPrice}
              historyOpen={historyOpen}
              historyData={historyData}
              historyLoadingId={historyLoadingId}
              onToggleHistory={toggleHistory}
            />
          ) : (
            <SharedTable rows={shared} loading={loadingShared} onRefresh={reloadShared} />
          )}

          {/* Footer note — matches the prototype helper text */}
          <div className="prs-foot-note">
            <span className="prs-foot-dot" />
            {tab === 'to_share'
              ? 'Enter a quoted price per product and click Submit. You can share multiple prices for the same product — the eye button shows history.'
              : 'Chronological list of every price already shared on this opportunity. Newest first.'}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Tab 1 table ─────────────────────────────────────────────────────── */
function ToShareTable({
  rows, loading, drafts, setDrafts, savingId, onSubmit,
  historyOpen, historyData, historyLoadingId, onToggleHistory,
}: {
  rows: ProductRow[];
  loading: boolean;
  drafts: Record<number, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  savingId: number | null;
  onSubmit: (row: ProductRow) => void;
  historyOpen: number | null;
  historyData: Record<number, HistoryEntry[]>;
  historyLoadingId: number | null;
  onToggleHistory: (row: ProductRow) => void;
}) {
  return (
    <div className="prs-table-wrap">
      <table className="prs-table">
        <thead>
          <tr>
            <th style={{ width: 60  }}>SR NO</th>
            <th style={{ width: 110 }}>PRODUCT CODE</th>
            <th>PRODUCT NAME</th>
            <th style={{ width: 110 }}>STATUS</th>
            <th style={{ width: 90  }}>QUANTITY</th>
            <th style={{ width: 140 }}>TARGET PRICE</th>
            <th style={{ width: 160 }}>QUOTED PRICE</th>
            <th style={{ width: 170 }}>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={8} className="prs-status-row">Loading mapped products…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={8} className="prs-status-row">
              No products mapped to this opportunity yet.
            </td></tr>
          )}
          {rows.map((r, i) => {
            const statusNorm = String(r.product_status ?? '').toLowerCase();
            const isLocked   = statusNorm === 'draft' || statusNorm === 'inactive' || statusNorm === 'pending';
            const isSaving   = savingId === r.id;
            const isOpenHist = historyOpen === r.id;
            const draft      = drafts[r.id] ?? '';
            const sym        = currencySymbol(r.currency) || '$';
            return (
              <>
                <tr key={r.id}>
                  <td><span className="prs-sr-pill">{i + 1}</span></td>
                  <td>
                    <span className="prs-code-chip">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <rect x="3" y="3"  width="7" height="7" rx="1" />
                        <rect x="14" y="3"  width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                      {r.product_code ?? '—'}
                    </span>
                  </td>
                  <td>
                    <div className="prs-name-cell">
                      <span className="prs-prod-name">{r.product_name ?? '—'}</span>
                      {r.product_category && (
                        <span className="prs-cat-badge">{r.product_category.toUpperCase()}</span>
                      )}
                    </div>
                  </td>
                  <td><StatusPill status={r.product_status} /></td>
                  <td className="prs-num">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                  <td className="prs-num prs-price">{formatPrice(r.target_price, r.currency)}</td>
                  <td>
                    <div className="prs-input-wrap">
                      <span className="prs-input-pre">{sym}</span>
                      <input
                        type="number" min="0" step="any"
                        className="prs-input"
                        placeholder="Enter price"
                        value={draft}
                        disabled={isLocked || isSaving}
                        onChange={e => setDrafts(p => ({ ...p, [r.id]: e.target.value }))}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="prs-act-cell">
                      <button
                        type="button"
                        className="prs-submit-btn"
                        disabled={isLocked || isSaving || !draft}
                        onClick={() => onSubmit(r)}
                        title={isLocked ? 'Activate this product master before sharing a price' : 'Submit quoted price'}
                      >
                        {isSaving ? (
                          <>Saving…</>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Submit
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className={`prs-eye-btn ${isOpenHist ? 'prs-eye-btn-on' : ''}`}
                        onClick={() => onToggleHistory(r)}
                        title="View shared-price history for this product"
                        aria-label="View history"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>

                {isOpenHist && (
                  <tr className="prs-hist-row">
                    <td colSpan={8}>
                      <div className="prs-hist-strip">
                        <div className="prs-hist-label">
                          Previously shared for <strong>{r.product_name ?? '—'}</strong>
                        </div>
                        {historyLoadingId === r.id ? (
                          <span className="prs-hist-empty">Loading…</span>
                        ) : (historyData[r.id]?.length ?? 0) === 0 ? (
                          <span className="prs-hist-empty">No prior shared prices for this product.</span>
                        ) : (
                          <div className="prs-hist-pills">
                            {historyData[r.id].map(h => (
                              <span key={h.id} className="prs-hist-pill" title={formatSharedAt(h.shared_at)}>
                                <span className="prs-hist-pill-price">{formatPrice(h.quoted_price, r.currency)}</span>
                                <span className="prs-hist-pill-at">{formatSharedAt(h.shared_at)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Tab 2 table ─────────────────────────────────────────────────────── */
function SharedTable({
  rows, loading, onRefresh,
}: {
  rows: SharedPriceRow[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="prs-table-wrap">
      <table className="prs-table">
        <thead>
          <tr>
            <th style={{ width: 60  }}>SR NO</th>
            <th style={{ width: 110 }}>PRODUCT CODE</th>
            <th>PRODUCT NAME</th>
            <th style={{ width: 110 }}>STATUS</th>
            <th style={{ width: 140 }}>TARGET PRICE</th>
            <th style={{ width: 140 }}>QUOTED PRICE</th>
            <th style={{ width: 170 }}>SHARED ON</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={7} className="prs-status-row">Loading shared-price history…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="prs-status-row">
                No prices shared on this opportunity yet.{' '}
                <button className="prs-link-btn" onClick={onRefresh}>Refresh</button>
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td><span className="prs-sr-pill">{i + 1}</span></td>
              <td>
                <span className="prs-code-chip">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <rect x="3" y="3"  width="7" height="7" rx="1" />
                    <rect x="14" y="3"  width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  {r.product_code ?? '—'}
                </span>
              </td>
              <td>
                <div className="prs-name-cell">
                  <span className="prs-prod-name">{r.product_name ?? '—'}</span>
                  {r.product_category && (
                    <span className="prs-cat-badge">{r.product_category.toUpperCase()}</span>
                  )}
                </div>
              </td>
              <td><StatusPill status={r.product_status} /></td>
              <td className="prs-num prs-price">{formatPrice(r.target_price, r.currency)}</td>
              <td className="prs-num prs-quoted">{formatPrice(r.quoted_price, r.currency)}</td>
              <td className="prs-num">{formatSharedAt(r.shared_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCOPED_CSS = `
.prs-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.prs-modal {
  width: min(1200px, 100%); max-height: 92vh;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  font-family: inherit;
}

/* ── Header — light violet wash matching Stage 4 ── */
.prs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  background: linear-gradient(135deg, #ede9fe 0%, #c4b5fd 50%, #a78bfa 100%);
  color: #1e1b4b;
  position: relative; overflow: hidden;
}
.prs-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.prs-head-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.prs-head-title {
  font-size: 16px; font-weight: 800; line-height: 1.2;
  color: #1e1b4b; letter-spacing: -.2px;
}
.prs-head-sub {
  font-size: 11.5px; font-weight: 600; color: #5b21b6;
  margin-top: 4px;
  display: inline-flex; align-items: center; gap: 6px;
}
.prs-head-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, .25);
}
.prs-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.55); color: #4c1d95; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.prs-close:hover { background: rgba(255,255,255,.85); }

/* ── Tabs ── */
.prs-tabs {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 22px;
  background: #fff;
  border-bottom: 1px solid #f1f5f9;
}
.prs-tab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 18px;
  border: 1.5px solid transparent;
  border-radius: 10px;
  background: #fff; color: #475569;
  font-size: 12.5px; font-weight: 700; letter-spacing: .01em;
  cursor: pointer; transition: all .15s;
}
.prs-tab svg { flex-shrink: 0; }
.prs-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; padding: 1px 8px; border-radius: 999px;
  background: rgba(255, 255, 255, .35);
  font-size: 10.5px; font-weight: 800;
}
.prs-tab-to              { border-color: #ddd6fe; color: #6d28d9; }
.prs-tab-to.prs-tab-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.prs-tab-shared          { border-color: #c7d2fe; color: #4338ca; }
.prs-tab-shared:not(.prs-tab-active):hover { background: #eef2ff; }
.prs-tab-shared.prs-tab-active {
  background: linear-gradient(135deg, #6366f1, #4338ca);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, .35);
}
.prs-tab-shared .prs-tab-count           { background: #e0e7ff; color: #4338ca; }
.prs-tab-shared.prs-tab-active .prs-tab-count { background: rgba(255, 255, 255, .25); color: #fff; }

/* ── Body ── */
.prs-body  { flex: 1; overflow-y: auto; padding: 14px 22px 18px; background: #faf5ff; }

/* ── Table ── */
.prs-table-wrap   {
  background: #fff;
  border: 1.5px solid #e9d5ff;
  border-radius: 14px;
  overflow: auto;
  max-height: 58vh;
  box-shadow: 0 2px 12px rgba(124, 58, 237, .07);
}
.prs-table        { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1080px; }
/* Table header — gradient on the tr so a single sweep spans the
   whole row instead of each th rendering its own copy (which
   created visible stitch lines between columns). Uses the same
   light lavender wash as the popup header so the two surfaces
   flow as one continuous violet panel. Cells stay transparent so
   the row gradient shows through. */
.prs-table thead tr {
  background: linear-gradient(135deg, #f8f5ff, #ede9fe);
}
.prs-table thead th {
  background: transparent;
  color: #a78bfa;
  border-bottom: 1px solid #e9d5ff;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  text-align: left; padding: 11px 12px;
  position: sticky; top: 0; z-index: 2;
  white-space: nowrap;
}
.prs-table tbody tr        { border-bottom: 1px solid #f5f3ff; }
.prs-table tbody tr:last-child { border-bottom: none; }
.prs-table tbody tr:hover  { background: #faf5ff; }
.prs-table tbody td        { padding: 10px 12px; color: #1e293b; vertical-align: middle; }
.prs-num                   { font-variant-numeric: tabular-nums; }
.prs-status-row            {
  text-align: center; padding: 26px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}
.prs-link-btn {
  background: transparent; border: none; cursor: pointer;
  color: #7c3aed; font-weight: 700; padding: 0;
  text-decoration: underline; font-style: normal;
}

/* ── SR pill ── */
.prs-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; padding: 4px 10px;
  background: #f1f5f9; color: #475569;
  border-radius: 999px;
  font-size: 11.5px; font-weight: 700;
}

/* ── Code chip ── */
.prs-code-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 700; color: #1e293b;
}
.prs-code-chip svg { color: #64748b; flex-shrink: 0; }

/* ── Name + category ── */
.prs-name-cell { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.prs-prod-name { font-size: 12.5px; color: #0f172a; font-weight: 600; }
.prs-cat-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #ede9fe; color: #6d28d9;
  border-radius: 4px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
}

/* ── Status pill ── */
.prs-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.prs-status-dot   { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.prs-status-on    { background: #dcfce7; color: #15803d; }
.prs-status-off   { background: #fee2e2; color: #b91c1c; }

/* ── Target / Quoted price colours ── */
.prs-price        { color: #059669; font-weight: 800; }
.prs-quoted       { color: #6d28d9; font-weight: 800; }

/* ── Quoted-price input with currency prefix ── */
.prs-input-wrap {
  display: flex; align-items: center;
  background: #fff;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  transition: border-color .15s, box-shadow .15s;
}
.prs-input-wrap:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.prs-input-pre {
  padding: 0 8px 0 12px;
  font-size: 13px; font-weight: 700; color: #94a3b8;
}
.prs-input {
  flex: 1; min-width: 0;
  height: 32px; padding: 0 10px 0 0;
  border: none; outline: none; background: transparent;
  font-size: 12.5px; font-weight: 600; color: #1e293b;
  font-family: inherit;
}
.prs-input::placeholder { color: #cbd5e1; font-weight: 500; }
.prs-input:disabled     { color: #94a3b8; cursor: not-allowed; }
.prs-input-wrap:has(.prs-input:disabled) { background: #f8fafc; border-color: #e2e8f0; }

/* ── Submit + eye buttons ── */
.prs-act-cell { display: flex; gap: 6px; align-items: center; }
.prs-submit-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; padding: 0 14px;
  border: none; border-radius: 8px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
  font-size: 12px; font-weight: 700; letter-spacing: .01em;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(124, 58, 237, .25);
  font-family: inherit;
}
.prs-submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(124, 58, 237, .40);
}
.prs-submit-btn:disabled {
  opacity: .55; cursor: not-allowed; transform: none;
  box-shadow: none;
}
.prs-eye-btn {
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #ddd6fe; border-radius: 8px;
  background: #fff; color: #6d28d9;
  cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.prs-eye-btn:hover { background: #ede9fe; }
.prs-eye-btn-on    { background: #ede9fe; border-color: #a78bfa; color: #5b21b6; }

/* ── History strip (expanded under a row) ── */
.prs-hist-row > td { background: #faf5ff; padding: 12px 16px; }
.prs-hist-strip {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e9d5ff;
  border-radius: 10px;
}
.prs-hist-label { font-size: 11.5px; color: #475569; font-weight: 600; }
.prs-hist-label strong { color: #1e1b4b; }
.prs-hist-empty { font-size: 11.5px; color: #94a3b8; font-style: italic; }
.prs-hist-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.prs-hist-pill {
  display: inline-flex; flex-direction: column;
  padding: 5px 12px;
  border-radius: 8px;
  background: #ede9fe; border: 1px solid #c4b5fd;
}
.prs-hist-pill-price { font-size: 12px; font-weight: 800; color: #5b21b6; font-variant-numeric: tabular-nums; }
.prs-hist-pill-at    { font-size: 9.5px; color: #6d28d9; margin-top: 1px; letter-spacing: .02em; font-weight: 600; }

/* ── Footer note ── */
.prs-foot-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px 14px;
  margin-top: 12px;
  background: #f5f3ff;
  border: 1px solid #ede9fe;
  border-radius: 10px;
  font-size: 11.5px; color: #5b21b6; font-weight: 500;
  line-height: 1.55;
}
.prs-foot-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #7c3aed;
  flex-shrink: 0; margin-top: 5px;
}

/* ── Dark mode ── */
[data-bs-theme="dark"] .prs-modal       { background: #14102a; }
[data-bs-theme="dark"] .prs-head        {
  background: linear-gradient(135deg, #2a2150 0%, #3b2f6e 50%, #4c1d95 100%);
  color: #ede9fe;
}
[data-bs-theme="dark"] .prs-head-title  { color: #ede9fe; }
[data-bs-theme="dark"] .prs-head-sub    { color: #c4b5fd; }
[data-bs-theme="dark"] .prs-close       { background: rgba(255,255,255,.10); color: #ede9fe; }
[data-bs-theme="dark"] .prs-close:hover { background: rgba(255,255,255,.20); }
[data-bs-theme="dark"] .prs-tabs        { background: #14102a; border-bottom-color: rgba(167, 139, 250, .20); }
[data-bs-theme="dark"] .prs-tab         { background: #1f1845; color: #c4b5fd; }
[data-bs-theme="dark"] .prs-tab-to      { border-color: rgba(167, 139, 250, .30); }
[data-bs-theme="dark"] .prs-tab-shared  { border-color: rgba(165, 180, 252, .30); color: #c7d2fe; }
[data-bs-theme="dark"] .prs-body        { background: #1a1538; }
[data-bs-theme="dark"] .prs-table-wrap  { background: #14102a; border-color: rgba(167, 139, 250, .25); }
[data-bs-theme="dark"] .prs-table thead tr {
  background: linear-gradient(135deg, #20184a, #2a2150);
}
[data-bs-theme="dark"] .prs-table thead th {
  background: transparent;
  color: #c4b5fd;
}
[data-bs-theme="dark"] .prs-table tbody tr        { border-color: rgba(167, 139, 250, .15); }
[data-bs-theme="dark"] .prs-table tbody tr:hover  { background: rgba(124, 58, 237, .14); }
[data-bs-theme="dark"] .prs-table tbody td        { color: #ede9fe; }
[data-bs-theme="dark"] .prs-sr-pill   { background: rgba(167, 139, 250, .14); color: #c4b5fd; }
[data-bs-theme="dark"] .prs-code-chip {
  background: rgba(167, 139, 250, .10);
  border-color: rgba(167, 139, 250, .25);
  color: #ede9fe;
}
[data-bs-theme="dark"] .prs-code-chip svg { color: #a78bfa; }
[data-bs-theme="dark"] .prs-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .prs-cat-badge { background: rgba(167, 139, 250, .22); color: #d8b4fe; }
[data-bs-theme="dark"] .prs-status-on  { background: rgba(34, 197, 94, .18); color: #86efac; }
[data-bs-theme="dark"] .prs-status-off { background: rgba(239, 68, 68, .18); color: #fca5a5; }
[data-bs-theme="dark"] .prs-price      { color: #34d399; }
[data-bs-theme="dark"] .prs-quoted     { color: #c4b5fd; }
[data-bs-theme="dark"] .prs-input-wrap {
  background: #1f1845; border-color: rgba(167, 139, 250, .30);
}
[data-bs-theme="dark"] .prs-input-pre  { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .prs-input      { color: #ede9fe; }
[data-bs-theme="dark"] .prs-input::placeholder { color: rgba(196, 181, 253, .35); }
[data-bs-theme="dark"] .prs-input-wrap:has(.prs-input:disabled) {
  background: rgba(167, 139, 250, .08); border-color: rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .prs-submit-btn {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  box-shadow: 0 2px 8px rgba(124, 58, 237, .40);
}
[data-bs-theme="dark"] .prs-eye-btn    {
  background: #1f1845; border-color: rgba(167, 139, 250, .30); color: #d8b4fe;
}
[data-bs-theme="dark"] .prs-eye-btn:hover     { background: rgba(124, 58, 237, .20); }
[data-bs-theme="dark"] .prs-eye-btn-on        { background: rgba(124, 58, 237, .30); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .prs-hist-row > td     { background: rgba(124, 58, 237, .08); }
[data-bs-theme="dark"] .prs-hist-strip        { background: #14102a; border-color: rgba(167, 139, 250, .25); }
[data-bs-theme="dark"] .prs-hist-label        { color: rgba(196, 181, 253, .80); }
[data-bs-theme="dark"] .prs-hist-label strong { color: #ede9fe; }
[data-bs-theme="dark"] .prs-hist-empty        { color: rgba(196, 181, 253, .50); }
[data-bs-theme="dark"] .prs-hist-pill         { background: rgba(124, 58, 237, .22); border-color: rgba(167, 139, 250, .40); }
[data-bs-theme="dark"] .prs-hist-pill-price   { color: #ede9fe; }
[data-bs-theme="dark"] .prs-hist-pill-at      { color: #c4b5fd; }
[data-bs-theme="dark"] .prs-foot-note         {
  background: rgba(124, 58, 237, .12); border-color: rgba(167, 139, 250, .25); color: #d8b4fe;
}
[data-bs-theme="dark"] .prs-foot-dot          { background: #a78bfa; }
[data-bs-theme="dark"] .prs-status-row        { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .prs-link-btn          { color: #a78bfa; }

@media (max-width: 720px) {
  .prs-backdrop { padding: 0; }
  .prs-modal    { border-radius: 0; max-height: 100vh; }
  .prs-tabs     { overflow-x: auto; }
}
`;
