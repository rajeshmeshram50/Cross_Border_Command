import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 4: Price Shared
 *
 *   Two-tab view:
 *     · Price To Be Share — every mapped product on the lead with an
 *       inline Quoted Price input + Submit. Drafts / inactive products
 *       are blocked at the controller (mirrors IDIMS).
 *     · Shared Price      — append-only history of every quoted price
 *       across the lead, with View / Download PDF actions.
 *
 *   A nested history view (replaces the Price To Be Share table) opens
 *   when the eye icon next to a product is clicked, showing every
 *   quotation submitted for that specific product mapping.
 *
 *   Save & Next: at least one shared price must exist before advancing
 *   to Stage 5.
 * ───────────────────────────────────────────────────────────────────── */

type Tab = 'to_share' | 'shared';
type ViewMode = 'list' | 'history';

type LeadProductRow = {
  id:               number;
  product_id:       number;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  currency:         string;
  quantity:         number | string | null;
  target_price:     number | string | null;
  sourcing_status:  'required' | 'not_required' | null;
};

type SharedRow = {
  id:               number;
  lead_product_id:  number;
  product_id:       number | null;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  currency:         string | null;
  quantity:         number | string | null;
  target_price:     number | string | null;
  quoted_price:     number | string | null;
  shared_at:        string;
};

type HistoryRow = {
  id:           number;
  quoted_price: number | string | null;
  shared_at:    string;
};

const isIncompleteStatus = (s: string | null): boolean => {
  const lc = (s ?? '').toLowerCase().trim();
  return lc === 'draft' || lc === 'inactive' || lc === 'pending';
};

function formatDateTime(s: string | null | undefined): { date: string; time: string } {
  if (!s) return { date: '—', time: '—' };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

export default function Stage4PriceShared({ header, onPrev, onNext, reloadLead, embedded }: StageProps) {
  const toast = useToast();
  const leadId = header.leadId ?? null;

  const [tab, setTab]         = useState<Tab>('to_share');
  const [view, setView]       = useState<ViewMode>('list');
  const [loading, setLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const [products, setProducts]     = useState<LeadProductRow[]>([]);
  const [sharedRows, setSharedRows] = useState<SharedRow[]>([]);
  const [quotedDraft, setQuotedDraft] = useState<Record<number, string>>({});

  /* History sub-view state */
  const [historyHeader, setHistoryHeader] = useState<LeadProductRow | null>(null);
  const [historyRows, setHistoryRows]     = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* Search on Shared Price tab */
  const [sharedQuery, setSharedQuery] = useState('');

  /* Both fetches kicked off in parallel via Promise.allSettled so a single
   * failure doesn't block the other from rendering — and the loading
   * spinner only flips off once BOTH have settled. */
  const fetchAll = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    const [productsRes, sharedRes] = await Promise.allSettled([
      api.get<{ status: boolean; data: LeadProductRow[] }>(`/sales/leads/${leadId}/products`),
      api.get<{ status: boolean; data: SharedRow[] }>(`/sales/leads/${leadId}/shared-prices`),
    ]);
    if (productsRes.status === 'fulfilled') setProducts(productsRes.value.data.data ?? []);
    else toast.error('Load failed', 'Could not load the lead’s products');
    if (sharedRes.status === 'fulfilled')   setSharedRows(sharedRes.value.data.data ?? []);
    else toast.error('Load failed', 'Could not load shared price history');
    setLoading(false);
  }, [leadId, toast]);

  /* Lightweight reload for after a successful submit — only the shared
   * price list needs refetching since products haven't changed. */
  const reloadShared = useCallback(async () => {
    if (!leadId) return;
    try {
      const { data } = await api.get<{ status: boolean; data: SharedRow[] }>(`/sales/leads/${leadId}/shared-prices`);
      setSharedRows(data.data ?? []);
    } catch {
      toast.error('Load failed', 'Could not refresh shared price history');
    }
  }, [leadId, toast]);

  useEffect(() => {
    if (!leadId) return;
    void fetchAll();
  }, [leadId, fetchAll]);

  /* ── Submit a quoted price ───────────────────────────────────────── */
  /* Frontend validation mirrors IDIMS exactly: required + numeric. Backend
   * `min:0` handles negative-number rejection so the surface still refuses
   * those — direct API hits get a 422. */
  const onSubmitQuoted = async (row: LeadProductRow) => {
    if (!leadId) return;
    if (isIncompleteStatus(row.product_status)) {
      toast.warning('Activate this product first', 'Drafts and inactive products cannot have a shared price.');
      return;
    }
    const raw = (quotedDraft[row.id] ?? '').trim();
    if (!raw) {
      toast.warning('Type a quoted price', 'Enter a price in the input box before submitting.');
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) {
      toast.warning('Numbers only', 'Quoted price must be a number — remove any letters or symbols.');
      return;
    }
    setSubmittingId(row.id);
    try {
      await api.post(`/sales/leads/${leadId}/products/${row.id}/shared-prices`, { quoted_price: num });
      toast.success('Quoted price recorded', `${row.product_name ?? 'Product'} · ${row.currency} ${num.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      setQuotedDraft(prev => ({ ...prev, [row.id]: '' }));
      await reloadShared();
    } catch (e: any) {
      toast.error('Submit failed', e?.response?.data?.message ?? 'Could not record the quoted price');
    } finally {
      setSubmittingId(null);
    }
  };

  /* ── Open per-product history view ──────────────────────────────── */
  const openHistory = async (row: LeadProductRow) => {
    if (!leadId) return;
    if (isIncompleteStatus(row.product_status)) {
      toast.warning('Action not allowed', 'Complete the product status first');
      return;
    }
    setHistoryHeader(row);
    setHistoryRows([]);
    setView('history');
    setHistoryLoading(true);
    try {
      const { data } = await api.get<{ status: boolean; data: HistoryRow[] }>(
        `/sales/leads/${leadId}/products/${row.id}/shared-prices`,
      );
      setHistoryRows(data.data ?? []);
    } catch {
      toast.error('Load failed', 'Could not load product price history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const goBackToList = () => {
    setView('list');
    setHistoryHeader(null);
    setHistoryRows([]);
  };

  /* ── PDF actions ─────────────────────────────────────────────────── */
  const fetchPdfBlob = async (entryId: number): Promise<Blob> => {
    const res = await api.get(`/sales/shared-prices/${entryId}/pdf`, { responseType: 'blob' });
    return new Blob([res.data as BlobPart], { type: 'application/pdf' });
  };

  const onViewPdf = async (entryId: number) => {
    try {
      const blob = await fetchPdfBlob(entryId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error('Open failed', 'Could not open the quotation PDF');
    }
  };

  const onDownloadPdf = async (entryId: number) => {
    try {
      const blob = await fetchPdfBlob(entryId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quotation_${String(entryId).padStart(5, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed', 'Could not download the quotation PDF');
    }
  };

  /* ── Save & Next ─────────────────────────────────────────────────── */
  const onSaveAndNext = async () => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to save your progress.');
      return;
    }
    /* A customer must be mapped (via the toolbar above) before advancing to
     * Stage 5. The consignee is NOT required here — it can be picked/mapped
     * directly in the Create Quotation form on Stage 5. */
    if (!header.customerId) {
      toast.warning('Map a customer first', 'Add a customer from the toolbar above before advancing to Stage 5.');
      return;
    }
    if (sharedRows.length === 0) {
      toast.warning('Share a price first', 'Submit at least one quoted price before advancing to Stage 5.');
      setTab('to_share');
      return;
    }
    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${leadId}`, { lead_stage_id: 5 });
      toast.success('Stage advanced', 'Moving to Quotation vs PI (Stage 5)…');
      reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Could not advance', e?.response?.data?.message ?? 'Network or server error — please try again.');
    } finally {
      setAdvancing(false);
    }
  };

  /* ── Search filter for Shared tab ─────────────────────────────── */
  const filteredShared = useMemo(() => {
    const q = sharedQuery.trim().toLowerCase();
    if (!q) return sharedRows;
    return sharedRows.filter(r => {
      const hay = [r.product_code, r.product_name, formatDateTime(r.shared_at).date].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [sharedRows, sharedQuery]);

  const sharedCount = sharedRows.length;
  const toShareCount = products.length;

  /* ──────────────────────────── render ──────────────────────────── */
  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE4_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">{embedded ? 'Price Shared' : 'Stage 4: Price Shared'}</div>
            <div className="smd-stg-head-sub">
              {tab === 'to_share'
                ? `● ${toShareCount} ${toShareCount === 1 ? 'product' : 'products'} to be priced`
                : `● ${sharedCount} ${sharedCount === 1 ? 'shared price' : 'shared prices'}`}
            </div>
          </div>
        </div>
        <span className="smd-stg-head-badge">ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* ── HISTORY VIEW ── */}
        {view === 'history' && (
          <div className="s4-card s4-card-navy smd-fade-in" key="history">
            <div className="s4-card-head s4-card-head-navy">
              <button type="button" className="s4-back-btn" onClick={goBackToList}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                </svg>
                Back
              </button>
              <div className="s4-card-head-titlewrap">
                <div className="s4-card-title">Price History</div>
                <div className="s4-card-sub">
                  <span className="s4-history-code">{historyHeader?.product_code ?? '—'}</span>
                  <span>{historyHeader?.product_name ?? '—'}</span>
                </div>
              </div>
              <span className="s4-card-count s4-card-count-navy">{historyRows.length}</span>
            </div>

            <div className="s4-table-wrap">
              <table className="s4-table">
                <thead className="s4-thead-navy">
                  <tr>
                    <th style={{ width: 50 }}>Sr No</th>
                    <th style={{ width: 110 }}>Product Code</th>
                    <th>Product Name</th>
                    <th style={{ width: 150 }}>Date &amp; Time</th>
                    <th style={{ width: 80 }}>Quantity</th>
                    <th style={{ width: 130 }}>Target Price</th>
                    <th style={{ width: 130 }}>Quoted Price</th>
                    <th style={{ width: 100 }}>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading && Array.from({ length: 2 }).map((_, i) => (
                    <tr key={`skh-${i}`} className="smd-fade-in">
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-chip" /></td>
                      <td><span className="smd-skel smd-skel-name" /></td>
                      <td><span className="smd-skel" style={{ maxWidth: 110 }} /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-btn" /></td>
                    </tr>
                  ))}
                  {!historyLoading && historyRows.length === 0 && (
                    <tr><td colSpan={8} className="s4-empty">No price history for this product yet.</td></tr>
                  )}
                  {!historyLoading && historyRows.map((h, idx) => {
                    const { date, time } = formatDateTime(h.shared_at);
                    return (
                      <tr key={h.id}>
                        <td><span className="s4-sr s4-sr-navy">{idx + 1}</span></td>
                        <td><span className="s4-code s4-code-navy">{historyHeader?.product_code ?? '—'}</span></td>
                        <td><div className="s4-prod-name">{historyHeader?.product_name ?? '—'}</div></td>
                        <td><span className="s4-dt">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                          {date} <span className="s4-dt-sep">/</span> {time}
                        </span></td>
                        <td>{historyHeader?.quantity != null ? Number(historyHeader.quantity).toLocaleString() : '—'}</td>
                        <td className="s4-price">
                          {historyHeader?.target_price != null
                            ? `${historyHeader.currency} ${Number(historyHeader.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="s4-quoted">
                          {h.quoted_price != null
                            ? `${historyHeader?.currency ?? ''} ${Number(h.quoted_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td>
                          <div className="s4-pdf-actions">
                            <button type="button" className="s4-icon-btn" title="View PDF" onClick={() => void onViewPdf(h.id)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                            </button>
                            <button type="button" className="s4-icon-btn" title="Download PDF" onClick={() => void onDownloadPdf(h.id)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'list' && (
          <>
            {/* Pill tabs + Map Product CTA (always visible — mirrors IDIMS) */}
            <div className="s4-tab-row">
              <div className="s4-tabs">
                <button
                  type="button"
                  className={`s4-tab s4-tab-toshare ${tab === 'to_share' ? 'active' : ''}`}
                  onClick={() => setTab('to_share')}
                >
                  <span className="s4-tab-ico">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </span>
                  Price To Be Share
                  <span className="s4-tab-count">{toShareCount}</span>
                </button>
                <button
                  type="button"
                  className={`s4-tab s4-tab-toshare ${tab === 'shared' ? 'active' : ''}`}
                  onClick={() => setTab('shared')}
                >
                  <span className="s4-tab-ico">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  Shared Price
                  <span className="s4-tab-count">{sharedCount}</span>
                </button>
              </div>
              {/* Search sits to the RIGHT of the tabs row (space-between).
                  Shown on the Shared Price tab, which it filters. */}
              {tab === 'shared' && (
                <div className="s4-search">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search code, name or date…"
                    value={sharedQuery}
                    onChange={(e) => setSharedQuery(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* ── PRICE TO BE SHARE TAB ── */}
            {tab === 'to_share' && (
              <div className="s4-card s4-card-navy smd-fade-in" key="t-share">
                {/* No banner header here — the figma goes straight from the
                    tabs into the table. (History view keeps its own header.) */}
                <div className="s4-table-wrap">
                  <table className="s4-table">
                    <thead className="s4-thead-navy">
                      <tr>
                        <th style={{ width: 50 }}>Sr No</th>
                        <th style={{ width: 110 }}>Product Code</th>
                        <th>Product Name</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th style={{ width: 80 }}>Quantity</th>
                        <th style={{ width: 140 }}>Target Price</th>
                        <th style={{ width: 170 }}>Quoted Price</th>
                        <th style={{ width: 140 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`skt-${i}`} className="smd-fade-in">
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-chip" /></td>
                          <td><span className="smd-skel smd-skel-name" /></td>
                          <td><span className="smd-skel smd-skel-pill" /></td>
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-input" /></td>
                          <td><span className="smd-skel smd-skel-btn" /></td>
                        </tr>
                      ))}
                      {!loading && products.length === 0 && (
                        <tr><td colSpan={8} className="s4-empty">No products mapped to this lead yet.</td></tr>
                      )}
                      {!loading && products.map((r, idx) => {
                        const blocked = isIncompleteStatus(r.product_status);
                        const statusLc = (r.product_status ?? '').toLowerCase();
                        const isSubmitting = submittingId === r.id;
                        return (
                          <tr key={r.id} className={blocked ? 's4-row-blocked' : ''}>
                            <td><span className="s4-sr s4-sr-navy">{idx + 1}</span></td>
                            <td><span className="s4-code s4-code-navy">{r.product_code ?? `P-${String(r.product_id).padStart(3,'0')}`}</span></td>
                            <td><div className="s4-prod-name">{r.product_name ?? '—'}</div></td>
                            <td>
                              <span className={`s4-pill ${statusLc === 'active' ? 's4-pill-active' : statusLc === 'draft' ? 's4-pill-draft' : 's4-pill-inactive'}`}>
                                ● {statusLc ? statusLc.charAt(0).toUpperCase() + statusLc.slice(1) : '—'}
                              </span>
                            </td>
                            <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                            <td className="s4-price">
                              {r.target_price != null
                                ? `${r.currency} ${Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : '—'}
                            </td>
                            <td>
                              {/* Currency lives in a separate chip beside the
                               *  input — the previous absolute-positioned
                               *  prefix overlapped the typed value (e.g.
                               *  "USD 0" with no clear separation). Now the
                               *  user sees "[USD] [12345.00]" with the chip
                               *  visually decoupled from the editable field. */}
                              <div className="s4-quote-group">
                                <span className={`s4-quote-curr ${blocked ? 's4-quote-curr-disabled' : ''}`}>
                                  {r.currency || 'USD'}
                                </span>
                                <input
                                  type="number" min="0" step="any"
                                  className={`s4-quote-num ${blocked ? 's4-quote-disabled' : ''}`}
                                  value={quotedDraft[r.id] ?? ''}
                                  disabled={blocked}
                                  onChange={(e) => setQuotedDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                                  onClick={() => {
                                    if (blocked) toast.warning('Status incomplete', 'Activate the product master before sharing a price');
                                  }}
                                  placeholder="0.00"
                                />
                              </div>
                            </td>
                            <td>
                              <div className="s4-row-actions">
                                <button
                                  type="button"
                                  className={`s4-submit-btn ${blocked ? 's4-submit-disabled' : ''}`}
                                  disabled={isSubmitting}
                                  onClick={() => void onSubmitQuoted(r)}
                                >
                                  {isSubmitting ? 'Submitting…' : 'Submit'}
                                </button>
                                <button
                                  type="button"
                                  className="s4-icon-btn"
                                  title={blocked ? 'Complete product status first' : 'View price history'}
                                  onClick={() => void openHistory(r)}
                                  disabled={blocked}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── SHARED PRICE TAB ── */}
            {tab === 'shared' && (
              <div className="s4-card s4-card-navy smd-fade-in" key="t-shared">
                {/* No banner header — search moved up beside the tabs row. */}
                <div className="s4-table-wrap">
                  <table className="s4-table">
                    <thead className="s4-thead-navy">
                      <tr>
                        <th style={{ width: 50 }}>Sr No</th>
                        <th style={{ width: 110 }}>Product Code</th>
                        <th>Product Name</th>
                        <th style={{ width: 150 }}>Date &amp; Time</th>
                        <th style={{ width: 80 }}>Quantity</th>
                        <th style={{ width: 140 }}>Target Price</th>
                        <th style={{ width: 140 }}>Quoted Price</th>
                        <th style={{ width: 90 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`sks-${i}`} className="smd-fade-in">
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-chip" /></td>
                          <td><span className="smd-skel smd-skel-name" /></td>
                          <td><span className="smd-skel" style={{ maxWidth: 110 }} /></td>
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-num" /></td>
                          <td><span className="smd-skel smd-skel-btn" /></td>
                        </tr>
                      ))}
                      {!loading && filteredShared.length === 0 && (
                        <tr><td colSpan={8} className="s4-empty">
                          {sharedRows.length === 0 ? 'No prices shared yet.' : 'No rows match this search.'}
                        </td></tr>
                      )}
                      {!loading && filteredShared.map((r, idx) => {
                        const { date, time } = formatDateTime(r.shared_at);
                        return (
                          <tr key={r.id}>
                            <td><span className="s4-sr s4-sr-navy">{idx + 1}</span></td>
                            <td><span className="s4-code s4-code-navy">{r.product_code ?? `P-${String(r.product_id ?? 0).padStart(3,'0')}`}</span></td>
                            <td><div className="s4-prod-name">{r.product_name ?? '—'}</div></td>
                            <td><span className="s4-dt">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                          {date} <span className="s4-dt-sep">/</span> {time}
                        </span></td>
                            <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                            <td className="s4-price">
                              {r.target_price != null
                                ? `${r.currency} ${Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : '—'}
                            </td>
                            <td className="s4-quoted">
                              {r.quoted_price != null
                                ? `${r.currency} ${Number(r.quoted_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : '—'}
                            </td>
                            <td>
                              <div className="s4-pdf-actions">
                                <button type="button" className="s4-icon-btn" title="View PDF" onClick={() => void onViewPdf(r.id)}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                  </svg>
                                </button>
                                <button type="button" className="s4-icon-btn" title="Download PDF" onClick={() => void onDownloadPdf(r.id)}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer — pipeline navigation; hidden when opened as a toolbar popup. */}
      {!embedded && (
      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ <strong>Note :</strong> Map a customer and share at least one quoted price before advancing to Stage 5. The consignee can be set in the Create Quotation form.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev} type="button">← Previous</button>
          <button
            className="smd-stg-btn smd-stg-btn-primary"
            onClick={() => void onSaveAndNext()}
            disabled={advancing}
            type="button"
          >
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>
      )}

    </>
  );
}

const STAGE4_CSS = `
/* ═══════════════════════════════ TAB ROW ═══════════════════════════════ */
.s4-tab-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
}
.s4-map-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px;
  background: linear-gradient(135deg, #5b21b6, #7c3aed);
  color: #fff; border: none; cursor: pointer;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
  transition: all .15s;
}
.s4-map-btn:hover { background: linear-gradient(135deg, #7c3aed, #8b5cf6); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(124,58,237,.40); }

/* ═══════════════════════════ TABS — segmented control ═══════════════════════════
   A single rounded "track" holds both tabs. The active tab is a filled,
   slightly-raised pill; the inactive tab is flat text inside the track.
   Clean, modern, premium — one cohesive control instead of two pills. */
.s4-tabs {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px; border-radius: 13px;
  background: #f5f3ff; border: 1px solid #e9e3ff;
  flex-wrap: wrap;
}
.s4-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 13px; border-radius: 9px;
  border: none; background: transparent;
  color: #6d28d9;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  transition: background .18s ease, color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.s4-tab:hover:not(.active) { background: rgba(124,58,237,.08); }
.s4-tab.active {
  background: linear-gradient(135deg, #6d28d9, #7c3aed);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.32), inset 0 1px 0 rgba(255,255,255,.18);
}
.s4-tab-ico { display: inline-flex; align-items: center; justify-content: center; }
.s4-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; font-weight: 800;
  background: rgba(124,58,237,.12); color: #6d28d9;
  transition: background .18s ease, color .18s ease;
}
.s4-tab.active .s4-tab-count { background: rgba(255,255,255,.25); color: #fff; }

/* ═══════════════════════════════ CARDS ═══════════════════════════════ */
.s4-card {
  background: #fff;
  border: 1.5px solid; border-radius: 14px;
  overflow: hidden;
}
.s4-card-navy    { border-color: #ddd6fe; }
.s4-card-emerald { border-color: #a7f3d0; }

.s4-card-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 13px 18px;
  gap: 12px; flex-wrap: wrap;
  border-bottom: 1.5px solid;
}
.s4-card-head-navy {
  background: linear-gradient(180deg, #f5f3ff, #ede9fe);
  border-bottom-color: #ddd6fe;
}
.s4-card-head-emerald {
  background: linear-gradient(180deg, #d1fae5, #ecfdf5);
  border-bottom-color: #a7f3d0;
}
.s4-card-head-titlewrap { display: flex; gap: 10px; align-items: center; }
.s4-card-icon {
  width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.s4-card-icon-navy    { background: linear-gradient(135deg,#5b21b6,#7c3aed); }
.s4-card-icon-emerald { background: linear-gradient(135deg,#10b981,#047857); }
.s4-card-title {
  font-size: 13.5px; font-weight: 800;
  display: flex; align-items: center; gap: 8px;
}
.s4-card-head-navy .s4-card-title    { color: #5b21b6; }
.s4-card-head-emerald .s4-card-title { color: #064e3b; }
.s4-card-sub {
  font-size: 11px; color: #64748b; margin-top: 2px;
  display: flex; align-items: center; gap: 8px;
}
.s4-history-code {
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 800;
  padding: 2px 9px; border-radius: 6px;
  background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe;
}

.s4-card-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; color: #fff;
}
.s4-card-count-navy    { background: linear-gradient(135deg,#5b21b6,#7c3aed); }
.s4-card-count-emerald { background: linear-gradient(135deg,#10b981,#047857); }

.s4-back-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 8px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-weight: 700; font-size: 12px;
  cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.s4-back-btn:hover { background: #f5f3ff; border-color: #5b21b6; }

/* Search box */
.s4-search {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #6d28d9;
}
.s4-search input {
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12px; color: #0f172a;
  min-width: 180px;
}
.s4-search input::placeholder { color: #94a3b8; }

/* ═══════════════════════════════ TABLE ═══════════════════════════════ */
.s4-table-wrap { overflow-x: auto; background: #fff; }
.s4-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.s4-thead-navy th {
  padding: 12px 14px; text-align: left;
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: #7c3aed;
  white-space: nowrap;
}
.s4-thead-emerald th {
  padding: 12px 14px; text-align: left;
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: #047857;
  white-space: nowrap;
}
.s4-table tbody td {
  padding: 12px 14px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.s4-table tbody tr:hover { background: #f8fafc; }
.s4-row-blocked { opacity: .7; }
.s4-empty { text-align: center; padding: 26px 14px; color: #94a3b8; font-style: italic; }

.s4-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  font-size: 11.5px; font-weight: 800;
}
.s4-sr-navy    { background: #ede9fe; color: #5b21b6; }
.s4-sr-emerald { background: #d1fae5; color: #047857; }

.s4-code {
  display: inline-block;
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 8px; border: 1.5px solid;
}
.s4-code-navy    { background: #f5f3ff; color: #5b21b6; border-color: #ddd6fe; }
.s4-code-emerald { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }

.s4-prod-name { font-weight: 700; color: #1e293b; font-size: 12.5px; }

.s4-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 11px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800;
  white-space: nowrap; line-height: 1;
}
.s4-pill-active   { background: #d1fae5; color: #047857; }
.s4-pill-inactive { background: #fee2e2; color: #dc2626; }
.s4-pill-draft    { background: #fef3c7; color: #b45309; }

/* Both prices read green in the Figma. */
.s4-price  { font-weight: 700; color: #047857; }
.s4-quoted { font-weight: 800; color: #047857; }

/* Date & Time → rounded chip with a clock icon (Figma), single line. */
.s4-dt {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 999px;
  background: #f5f3ff; border: 1px solid #e9e3ff;
  color: #6d28d9; font-weight: 700; font-size: 11px;
  white-space: nowrap;
}
.s4-dt svg { flex-shrink: 0; opacity: .85; }
.s4-dt-sep { color: #c4b5fd; margin: 0 2px; font-weight: 600; }

/* Quoted price input — currency chip + numeric input live side-by-side
 * so the user reads them as two distinct fields. The chip is pinned to
 * the row's currency master value; the input takes a clean number. */
.s4-quote-group {
  display: inline-flex; align-items: stretch; gap: 6px;
}
.s4-quote-curr {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 46px; height: 32px;
  padding: 0 10px; border-radius: 8px;
  background: #f5f3ff; color: #5b21b6;
  border: 1.5px solid #ddd6fe;
  font-family: 'Inter', monospace; font-size: 11px; font-weight: 800;
  letter-spacing: .04em;
  user-select: none;
}
.s4-quote-curr-disabled {
  background: #f1f5f9; color: #94a3b8; border-color: #e2e8f0;
  border-style: dashed;
}
.s4-quote-num {
  width: 110px; height: 32px;
  padding: 0 10px;
  border: 1.5px solid #ddd6fe; border-radius: 8px;
  background: #fff; font-size: 12px; color: #1e293b;
  outline: none; font-family: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  transition: border-color .15s, box-shadow .15s;
}
.s4-quote-num:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.16); }
.s4-quote-disabled {
  background: #f1f5f9; cursor: not-allowed; color: #94a3b8;
  border-style: dashed;
}

.s4-row-actions { display: flex; align-items: center; gap: 8px; }
.s4-submit-btn {
  padding: 6px 14px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #5b21b6, #7c3aed);
  color: #fff;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(124,58,237,.30);
  transition: all .12s;
}
.s4-submit-btn:hover:not(:disabled) { background: linear-gradient(135deg, #7c3aed, #8b5cf6); transform: translateY(-1px); }
.s4-submit-btn:disabled { opacity: .55; cursor: not-allowed; }
.s4-submit-disabled {
  background: linear-gradient(135deg, #94a3b8, #64748b);
}

.s4-icon-btn {
  width: 30px; height: 30px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; cursor: pointer;
  border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .12s;
}
.s4-icon-btn:hover:not(:disabled) {
  background: #f5f3ff; border-color: #7c3aed;
}
.s4-icon-btn:disabled { opacity: .35; cursor: not-allowed; }
.s4-pdf-actions { display: flex; gap: 6px; }

/* Dark mode */
/* Segmented control on dark — the track is a subtle translucent panel,
   the active tab a bright purple pill that clearly stands out. */
[data-bs-theme="dark"] .s4-tabs { background: rgba(167,139,250,.10); border-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .s4-tab { color: #c4b5fd; background: transparent; }
[data-bs-theme="dark"] .s4-tab:hover:not(.active) { background: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .s4-tab.active {
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  color: #fff;
  box-shadow: 0 4px 16px rgba(124,58,237,.55), inset 0 1px 0 rgba(255,255,255,.18);
}
[data-bs-theme="dark"] .s4-tab-count { background: rgba(167,139,250,.20); color: #c4b5fd; }
[data-bs-theme="dark"] .s4-tab.active .s4-tab-count { background: rgba(0,0,0,.28); color: #fff; }
[data-bs-theme="dark"] .s4-card { background: #14102a; }
[data-bs-theme="dark"] .s4-card-navy    { border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .s4-card-emerald { border-color: rgba(110,231,183,.30); }
[data-bs-theme="dark"] .s4-card-head-navy {
  background: rgba(124,58,237,.18); border-bottom-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .s4-card-head-emerald {
  background: rgba(16,185,129,.14); border-bottom-color: rgba(110,231,183,.30);
}
[data-bs-theme="dark"] .s4-card-head-navy .s4-card-title { color: #ddd6fe; }
[data-bs-theme="dark"] .s4-card-head-emerald .s4-card-title { color: #6ee7b7; }
[data-bs-theme="dark"] .s4-card-sub { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s4-history-code { background: rgba(167,139,250,.18); color: #ddd6fe; border-color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .s4-back-btn { background: #1f1845; border-color: rgba(167,139,250,.35); color: #ddd6fe; }
[data-bs-theme="dark"] .s4-back-btn:hover { background: #2a2150; }
[data-bs-theme="dark"] .s4-search { background: #1f1845; border-color: rgba(167,139,250,.35); color: #c4b5fd; }
[data-bs-theme="dark"] .s4-search input { color: #ede9fe; }
[data-bs-theme="dark"] .s4-table-wrap { background: #14102a; }
[data-bs-theme="dark"] .s4-thead-navy th    { background: #5b21b6; }
[data-bs-theme="dark"] .s4-thead-emerald th { background: #065f46; }
[data-bs-theme="dark"] .s4-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .s4-table tbody tr:hover { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .s4-empty { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s4-sr-navy    { background: rgba(167,139,250,.22); color: #ddd6fe; }
[data-bs-theme="dark"] .s4-sr-emerald { background: rgba(110,231,183,.22); color: #6ee7b7; }
[data-bs-theme="dark"] .s4-code-navy    { background: rgba(167,139,250,.18); color: #ddd6fe; border-color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .s4-code-emerald { background: rgba(110,231,183,.18); color: #6ee7b7; border-color: rgba(110,231,183,.40); }
[data-bs-theme="dark"] .s4-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .s4-pill-active   { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .s4-pill-inactive { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .s4-pill-draft    { background: rgba(245,158,11,.18); color: #fde68a; }
[data-bs-theme="dark"] .s4-price  { color: #6ee7b7; }
[data-bs-theme="dark"] .s4-quoted { color: #6ee7b7; }
[data-bs-theme="dark"] .s4-dt { background: rgba(167,139,250,.12); border-color: rgba(167,139,250,.25); color: #c4b5fd; }
[data-bs-theme="dark"] .s4-dt-sep { color: rgba(167,139,250,.5); }
[data-bs-theme="dark"] .s4-quote-curr {
  background: rgba(167,139,250,.14); color: #ddd6fe; border-color: rgba(167,139,250,.40);
}
[data-bs-theme="dark"] .s4-quote-curr-disabled {
  background: rgba(167,139,250,.08); color: rgba(196,181,253,.45); border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .s4-quote-num {
  background: rgba(167,139,250,.06); border-color: rgba(167,139,250,.35); color: #ede9fe;
}
[data-bs-theme="dark"] .s4-quote-num:focus { border-color: #a78bfa; }
[data-bs-theme="dark"] .s4-quote-disabled { background: rgba(167,139,250,.10); color: rgba(196,181,253,.45); }
[data-bs-theme="dark"] .s4-icon-btn { background: #1f1845; border-color: rgba(167,139,250,.35); color: #ddd6fe; }
[data-bs-theme="dark"] .s4-icon-btn:hover:not(:disabled) { background: #2a2150; border-color: #a78bfa; }

@media (max-width: 900px) {
  .s4-card-head { flex-direction: column; align-items: flex-start; }
  .s4-search { width: 100%; }
  .s4-search input { width: 100%; }
}

/* ═══════════════════════════════ MAP PRODUCT MODAL ═══════════════════════════════ */
.s4-mp-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.s4-mp-modal {
  width: min(480px, 100%); max-height: 90vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.s4-mp-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  background: linear-gradient(180deg, #5b21b6, #7c3aed); color: #fff;
}
.s4-mp-head-left { display: flex; gap: 9px; align-items: center; font-size: 14px; font-weight: 700; }
.s4-mp-head-ico {
  width: 26px; height: 26px; border-radius: 8px;
  background: rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center;
}
.s4-mp-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff;
  border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
}
.s4-mp-close:hover { background: rgba(255,255,255,.32); }

.s4-mp-body { padding: 16px 18px; flex: 1; overflow-y: auto; background: #f8fafc; display: flex; flex-direction: column; gap: 12px; }
.s4-mp-field { display: flex; flex-direction: column; gap: 5px; }
.s4-mp-field-full { }
.s4-mp-label { font-size: 11px; font-weight: 700; color: #5b21b6; letter-spacing: .04em; text-transform: uppercase; }
.s4-mp-req { color: #dc2626; }
.s4-mp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.s4-mp-input {
  height: 34px; padding: 0 11px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; font-size: 12.5px; color: #0f172a;
  outline: none; font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
}
.s4-mp-input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.16); }
.s4-mp-input-err { border-color: #ef4444 !important; }
.s4-mp-err { color: #dc2626; font-size: 10.5px; font-weight: 600; }

.s4-mp-foot {
  padding: 12px 18px; display: flex; justify-content: flex-end; gap: 10px;
  background: #fff; border-top: 1px solid #e2e8f0;
}
.s4-mp-btn {
  padding: 8px 18px; border-radius: 8px;
  font-family: inherit; font-weight: 700; font-size: 12.5px; cursor: pointer;
  border: 1.5px solid transparent;
  min-width: 110px;
  transition: all .15s;
}
.s4-mp-btn-cancel { background: #fff; border-color: #cbd5e1; color: #475569; }
.s4-mp-btn-cancel:hover:not(:disabled) { background: #f1f5f9; }
.s4-mp-btn-primary {
  background: linear-gradient(135deg, #5b21b6, #7c3aed); color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
}
.s4-mp-btn-primary:hover:not(:disabled) { background: linear-gradient(135deg, #7c3aed, #8b5cf6); transform: translateY(-1px); }
.s4-mp-btn:disabled { opacity: .6; cursor: not-allowed; }

[data-bs-theme="dark"] .s4-mp-modal { background: #14102a; }
[data-bs-theme="dark"] .s4-mp-body  { background: #1a1538; }
[data-bs-theme="dark"] .s4-mp-label { color: #c4b5fd; }
[data-bs-theme="dark"] .s4-mp-input { background: rgba(167,139,250,.06); border-color: rgba(167,139,250,.30); color: #ede9fe; }
[data-bs-theme="dark"] .s4-mp-input:focus { border-color: #a78bfa; }
[data-bs-theme="dark"] .s4-mp-foot  { background: #1a1538; border-top-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .s4-mp-btn-cancel { background: #1f1845; border-color: rgba(167,139,250,.30); color: #ddd6fe; }
[data-bs-theme="dark"] .s4-mp-btn-cancel:hover:not(:disabled) { background: #2a2150; }
`;
