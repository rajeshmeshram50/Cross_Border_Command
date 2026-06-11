import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Product Directory — lists every product mapped to the current
 * opportunity with an inline Map / Edit / Delete row form.
 *
 * Picks the product from the live /products master, captures quantity /
 * currency / target price / notes, and persists to /sales/leads/{id}/
 * products. Duplicate (lead, product) pairs are rejected server-side
 * via the lead_products composite unique.
 *
 * The "+ Map Product" header button toggles a sub-form row at the top
 * of the table. Existing rows can be edited inline; pressing Save
 * promotes the draft into the table.
 * ───────────────────────────────────────────────────────────────────────── */

type DirectoryRow = {
  id:               number;
  product_id:       number;
  product_code:     string | null;
  product_name:     string | null;
  product_status:   string | null;
  /* Segment name surfaced as category — rendered as the small badge
   * under the product name (e.g. "VEGETABLES", "GRAINS"). May be null
   * if the product master has no segment assigned. */
  product_category: string | null;
  currency:         string;
  quantity:         string | number | null;
  target_price:     string | number | null;
  notes:            string | null;
};

type ProductOpt = {
  id:           number;
  product_code: string;
  name:         string;
};

type CurrencyOpt = {
  code:   string;
  name:   string | null;
  symbol: string | null;
};

/* Fallback list — used only when the Currency master can't be reached
 * or returns zero active rows. The picker should normally render from
 * the live /master/currencies feed below so tenants can manage their
 * own list. */
const CURRENCIES_FALLBACK: CurrencyOpt[] = [
  { code: 'USD', name: 'US Dollar',          symbol: '$' },
  { code: 'INR', name: 'Indian Rupee',       symbol: '₹' },
  { code: 'EUR', name: 'Euro',               symbol: '€' },
  { code: 'GBP', name: 'British Pound',      symbol: '£' },
  { code: 'AED', name: 'UAE Dirham',         symbol: 'د.إ' },
  { code: 'SGD', name: 'Singapore Dollar',   symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar',  symbol: 'A$' },
  { code: 'CNY', name: 'Chinese Yuan',       symbol: '¥' },
  { code: 'JPY', name: 'Japanese Yen',       symbol: '¥' },
];

/* Maps a currency code to its display symbol — used to prefix the target
 * price column (e.g. "$ 290.00", "₹ 290.00"). Falls back to the raw code
 * (e.g. "AED 290.00") so unknown currencies still render meaningfully. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', AUD: 'A$', SGD: 'S$',
};
const currencySymbol = (code: string | null | undefined): string => {
  if (!code) return '';
  const c = String(code).toUpperCase();
  return CURRENCY_SYMBOLS[c] ?? c;
};

/* Renders the green Active / red Inactive pill in the STATUS column.
 * Uses the same Bootstrap badge classes the Clients table uses for
 * organisation status (see Clients.tsx), so the look stays consistent
 * across the product. Bootstrap's *-subtle utilities also adapt to
 * dark mode automatically. */
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

type DraftRow = {
  product_id:   number | null;
  currency:     string;
  quantity:     string;
  target_price: string;
  notes:        string;
};
const EMPTY_DRAFT: DraftRow = { product_id: null, currency: 'USD', quantity: '', target_price: '', notes: '' };

type Props = {
  open:    boolean;
  leadId:  number | null;
  onClose: () => void;
  onAddProduct?: () => void;   // header "+ Add Product Master" — opens AddProductModal
  /* Furthest stage the opportunity has reached (1..6). When Product Sourcing
   * (Stage 3) is complete — i.e. the lead is at Stage 4+ — the mapped products
   * feed downstream price/quotation/PI data and may no longer be unmapped. */
  leadStage?: number;
};

export default function ProductDirectoryModal({ open, leadId, onClose, onAddProduct, leadStage }: Props) {
  const toast = useToast();

  /* Sourcing complete → product list is locked from unmapping (and the
   * backend enforces the same rule with a 422). */
  const sourcingLocked = (leadStage ?? 0) >= 4;

  const [rows, setRows]               = useState<DirectoryRow[]>([]);
  const [page, setPage]               = useState(1);   // 4 products per page
  const [loading, setLoading]         = useState(false);
  const [products, setProducts]       = useState<ProductOpt[]>([]);
  const [productsLoading, setPL]      = useState(false);
  const [currencies, setCurrencies]   = useState<CurrencyOpt[]>([]);
  const [currenciesLoading, setCL]    = useState(false);
  const [draftOpen, setDraftOpen]     = useState(false);
  const [draft, setDraft]             = useState<DraftRow>(EMPTY_DRAFT);
  const [saving, setSaving]           = useState(false);
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DirectoryRow | null>(null);
  const [deleting, setDeleting]       = useState(false);

  /* Load mapped rows whenever the modal opens for a lead. */
  useEffect(() => {
    if (!open || !leadId) { setRows([]); setDraftOpen(false); setEditingId(null); return; }
    setLoading(true);
    api.get<{ status: boolean; data: DirectoryRow[] }>(`/sales/leads/${leadId}/products`)
      .then(({ data }) => setRows(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load mapped products'))
      .finally(() => setLoading(false));
  }, [open, leadId, toast]);

  /* Load the product master once per session. */
  useEffect(() => {
    if (!open || products.length > 0) return;
    setPL(true);
    api.get<{ data?: ProductOpt[] } | ProductOpt[]>('/products')
      .then(res => {
        const list = Array.isArray(res.data)
          ? res.data
          : ((res.data as { data?: ProductOpt[] })?.data ?? []);
        setProducts(list);
      })
      .catch(() => toast.error('Load failed', 'Could not load the products master'))
      .finally(() => setPL(false));
  }, [open, products.length, toast]);

  /* Load the Currency master once per session. The tenant manages
   * their own list under Masters → Currencies; we filter to active
   * rows only and fall back to the hardcoded list if the fetch fails
   * or the master is empty so the picker is never blank. */
  useEffect(() => {
    if (!open || currencies.length > 0) return;
    setCL(true);
    api.get<{ data?: any[] } | any[]>('/master/currencies')
      .then(res => {
        const raw = Array.isArray(res.data)
          ? res.data
          : ((res.data as { data?: any[] })?.data ?? []);
        const list: CurrencyOpt[] = raw
          .filter((r: any) => {
            const s = String(r?.status ?? 'active').toLowerCase();
            return s === '' || s === 'active' || s === '1' || s === 'true';
          })
          .map((r: any) => ({
            code:   String(r?.code ?? '').toUpperCase(),
            name:   r?.name   ?? null,
            symbol: r?.symbol ?? null,
          }))
          .filter((c: CurrencyOpt) => !!c.code);
        setCurrencies(list.length > 0 ? list : CURRENCIES_FALLBACK);
      })
      .catch(() => setCurrencies(CURRENCIES_FALLBACK))
      .finally(() => setCL(false));
  }, [open, currencies.length]);

  const productsById = useMemo(() => {
    const m = new Map<number, ProductOpt>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  /* Pagination — 4 products per page. safePage clamps when rows shrink
   * (e.g. after an unmap) so we never render an out-of-range empty page. */
  const PER_PAGE = 4;
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage  = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PER_PAGE;
  const pagedRows = rows.slice(pageStart, pageStart + PER_PAGE);
  // Reset to the first page whenever the modal (re)opens.
  useEffect(() => { if (open) setPage(1); }, [open]);

  // Body scroll lock — freeze the page behind the modal so the background
  // doesn't scroll under the overlay while the directory is open. Same idiom
  // as AddCustomerModal: stash the prior overflow and restore it on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /* Hide products that are already mapped — prevents 422 on save. */
  const mappedIds = useMemo(() => new Set(rows.map(r => r.product_id)), [rows]);
  const availableProducts = useMemo(
    () => products.filter(p => !mappedIds.has(p.id) || p.id === draft.product_id),
    [products, mappedIds, draft.product_id],
  );

  /* Single-currency-per-lead. The first product mapped sets the
   * currency for the whole opportunity; subsequent rows are pinned to
   * the same value. Returns `null` when the directory is empty so the
   * user is free to pick any currency for the first row. The backend
   * enforces the same rule and returns a 422 with `locked_currency`
   * if a mismatch slips through. */
  const lockedCurrency = useMemo<string | null>(() => {
    for (const r of rows) {
      if (r.currency) return String(r.currency).toUpperCase();
    }
    return null;
  }, [rows]);

  /* A fresh blank draft, but pre-pinned to the lead's locked currency when
   * one exists. Using this (instead of the raw EMPTY_DRAFT) wherever we open
   * the "Map Product" form guarantees draft.currency already matches the
   * locked value — otherwise the form would submit the EMPTY_DRAFT default
   * ('USD'), which the backend rejects with the "already using INR…" lock
   * error even though the user never changed the (disabled) picker. */
  const freshDraft = (): DraftRow => ({
    ...EMPTY_DRAFT,
    currency: lockedCurrency ?? EMPTY_DRAFT.currency,
  });

  /* Pre-seed the draft's currency to the locked value so the user doesn't
   * have to set it manually. Re-runs on `draftOpen` too: opening the
   * "+ Map Product" form for a 2nd product resets the draft to EMPTY_DRAFT
   * (currency 'USD'), but the locked options list only contains the locked
   * currency — so without re-seeding here the picker showed BLANK (the 'USD'
   * value had no matching option). */
  useEffect(() => {
    if (!lockedCurrency) return;
    setDraft(p => p.currency === lockedCurrency ? p : { ...p, currency: lockedCurrency });
  }, [lockedCurrency, draftOpen]);

  if (!open) return null;

  /* ── Save — shared by the popup form for BOTH mapping a new product
   * (POST) and editing an existing mapping (PUT). `editingId` decides
   * which; the product itself is fixed when editing (the PUT endpoint
   * only updates pricing). ─────────────────────────────────────────── */
  const saveDraft = async () => {
    if (!leadId) return;
    if (!draft.product_id) {
      toast.warning('Pick a product', 'Select a product from the dropdown first');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/sales/leads/${leadId}/products/${editingId}`, {
          currency:     draft.currency,
          quantity:     draft.quantity     ? Number(draft.quantity)     : null,
          target_price: draft.target_price ? Number(draft.target_price) : null,
          notes:        draft.notes || null,
        });
        setRows(prev => prev.map(r => r.id === editingId ? {
          ...r,
          currency:     draft.currency,
          quantity:     draft.quantity     ? Number(draft.quantity)     : null,
          target_price: draft.target_price ? Number(draft.target_price) : null,
          notes:        draft.notes || null,
        } : r));
        toast.success('Updated', 'Mapping updated');
      } else {
        const { data } = await api.post<{ status: boolean; data: { id: number; product: { product_code: string; name: string; status: string; segment?: { name: string | null } | null } } }>(
          `/sales/leads/${leadId}/products`,
          {
            product_id:   draft.product_id,
            currency:     draft.currency,
            quantity:     draft.quantity     ? Number(draft.quantity)     : null,
            target_price: draft.target_price ? Number(draft.target_price) : null,
            notes:        draft.notes || null,
          },
        );
        const created = data.data;
        const pmaster = productsById.get(draft.product_id);
        setRows(prev => [{
          id:               created.id,
          product_id:       draft.product_id!,
          product_code:     created.product?.product_code ?? pmaster?.product_code ?? null,
          product_name:     created.product?.name         ?? pmaster?.name         ?? null,
          product_status:   created.product?.status       ?? null,
          product_category: created.product?.segment?.name ?? null,
          currency:         draft.currency,
          quantity:         draft.quantity     ? Number(draft.quantity)     : null,
          target_price:     draft.target_price ? Number(draft.target_price) : null,
          notes:            draft.notes || null,
        }, ...prev]);
        toast.success('Product mapped', 'Added to the directory');
      }
      setDraft(EMPTY_DRAFT); setEditingId(null); setDraftOpen(false);
    } catch (e: any) {
      toast.error(editingId ? 'Update failed' : 'Save failed', e?.response?.data?.message ?? 'Could not save this product');
    } finally {
      setSaving(false);
    }
  };

  /* Edit a row → open the SAME popup form the "Map Product" button uses,
   * pre-filled with the row's values (no more inline-cell editing). The
   * product picker is locked since the PUT endpoint can't re-point a
   * mapping to a different product. */
  const startEdit = (row: DirectoryRow) => {
    setEditingId(row.id);
    setDraft({
      product_id:   row.product_id,
      currency:     row.currency,
      quantity:     row.quantity     != null ? String(row.quantity)     : '',
      target_price: row.target_price != null ? String(row.target_price) : '',
      notes:        row.notes ?? '',
    });
    setDraftOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || !leadId) return;
    const row = pendingDelete;
    setDeleting(true);
    try {
      await api.delete(`/sales/leads/${leadId}/products/${row.id}`);
      setRows(prev => prev.filter(r => r.id !== row.id));
      toast.success('Unmapped', 'Removed from the directory');
      setPendingDelete(null);
    } catch (e: any) {
      toast.error('Remove failed', e?.response?.data?.message ?? 'Could not unmap');
    } finally {
      setDeleting(false);
    }
  };

  return createPortal((
    <div className="pdm-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="pdm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdm-head">
          <div className="pdm-head-left">
            <div className="pdm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <div className="pdm-head-title">Product Directory</div>
              <div className="pdm-head-sub">
                {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'product' : 'products'} mapped to this opportunity`}
              </div>
            </div>
          </div>
          <div className="pdm-head-actions">
            <button
              className="pdm-map-btn"
              onClick={() => { setEditingId(null); setDraft(freshDraft()); setDraftOpen(o => !o); }}
              disabled={!leadId}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Map Product
            </button>
            {/* "+ Add Product" ghost button intentionally hidden — the
                prototype design (image 1) keeps the header to a single
                action (Map Product) plus the close pill. The toolbar's
                own "Add Product" button still covers the new-master
                flow, and the `onAddProduct` prop is preserved on the
                component API for future re-use. */}
            <button className="pdm-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pdm-body">
          {lockedCurrency && (
            <div className="pdm-curr-lock-banner" role="status">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>
                This opportunity is in <strong>{lockedCurrency}</strong>. All new mappings will be added in the same currency — remove every product first if you want to switch.
              </span>
            </div>
          )}
          <div className="pdm-table-wrap">
            <table className="pdm-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>SR NO</th>
                  <th style={{ width: 140 }}>PRODUCT CODE</th>
                  <th>PRODUCT NAME</th>
                  <th style={{ width: 120 }}>STATUS</th>
                  <th style={{ width: 110 }}>QUANTITY</th>
                  <th style={{ width: 150 }}>TARGET PRICE</th>
                  <th style={{ width: 100 }}>CURRENCY</th>
                  <th style={{ width: 110 }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {/* The Map-Product draft is no longer inline — it now lives in
                    the dedicated popup form (rendered below) so the table
                    stays clean and the form has room for proper labels. */}

                {/* While the API loads, shimmer the WHOLE table (skeleton rows)
                    instead of a "Loading…" line over stale rows. */}
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`pdm-sk-${i}`} className="pdm-skeleton-row">
                    {Array.from({ length: 8 }).map((__, c) => (
                      <td key={c}><span className="pdm-shimmer" /></td>
                    ))}
                  </tr>
                ))}
                {!loading && rows.length === 0 && !draftOpen && (
                  <tr>
                    <td colSpan={8} className="pdm-status">
                      No products mapped yet — click <strong>Map Product</strong> to add the first.
                    </td>
                  </tr>
                )}

                {!loading && pagedRows.map((r, i) => {
                  return (
                    <tr key={r.id}>
                      <td><span className="pdm-sr-pill">{pageStart + i + 1}</span></td>
                      <td>
                        <span className="pdm-code-chip" title={r.product_code ?? ''}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <rect x="4" y="4" width="16" height="16" rx="2.5" />
                          </svg>
                          {r.product_code ?? '—'}
                        </span>
                      </td>
                      <td>
                        <div className="pdm-name-cell">
                          <span className="pdm-prod-name">{r.product_name ?? '—'}</span>
                          {r.product_category && (
                            <span className="pdm-cat-badge">{r.product_category.toUpperCase()}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusPill status={r.product_status} />
                      </td>
                      <td className="pdm-num">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                      <td className="pdm-num pdm-price">
                        {r.target_price != null
                          ? `${currencySymbol(r.currency)} ${Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </td>
                      <td><span className="pdm-curr-pill">{r.currency}</span></td>
                      <td className="pdm-act-cell">
                        <button className="pdm-icon-btn pdm-icon-btn-edit" onClick={() => startEdit(r)} aria-label="Edit" title="Edit">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="pdm-icon-btn pdm-icon-btn-del"
                          onClick={() => setPendingDelete(r)}
                          disabled={sourcingLocked}
                          aria-label="Unmap"
                          title={sourcingLocked
                            ? "Can't unmap — Product Sourcing (Stage 3) is complete"
                            : 'Unmap'}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination — only when there's more than one page of products. */}
          {!loading && rows.length > PER_PAGE && (
            <div className="pdm-pager">
              <span className="pdm-pager-info">
                Showing {pageStart + 1}–{Math.min(pageStart + PER_PAGE, rows.length)} of {rows.length}
              </span>
              <div className="pdm-pager-ctrls">
                <button
                  type="button"
                  className="pdm-pager-btn"
                  disabled={safePage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`pdm-pager-num ${p === safePage ? 'on' : ''}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                ))}
                <button
                  type="button"
                  className="pdm-pager-btn"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  aria-label="Next page"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer — status text only. The redundant "Close" button was
            removed; the header ✕ is the single dismiss control. */}
        <div className="pdm-foot">
          <div className="pdm-foot-status">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            {loading
              ? 'Loading…'
              : rows.length === 0
                ? 'No products mapped yet for this opportunity'
                : 'Showing all products for this opportunity'}
          </div>
        </div>
      </div>

      {/* ── Map Product popup form ── opened by the header's "Map
          Product" button. Lives over the directory backdrop with a
          higher z-index so it sits on top of the directory body. */}
      {draftOpen && (
        <div className="pdm-form-backdrop" onClick={() => { setDraft(EMPTY_DRAFT); setEditingId(null); setDraftOpen(false); }}>
          <div className="pdm-form-modal" onClick={e => e.stopPropagation()}>
            <div className="pdm-form-head">
              <div className="pdm-form-head-left">
                <div className="pdm-form-head-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                    <circle cx="18" cy="5"  r="3" />
                    <circle cx="6"  cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </div>
                <div>
                  <div className="pdm-form-head-title">{editingId ? 'Edit Product Mapping' : 'Map Product to Lead'}</div>
                  <div className="pdm-form-head-sub">{editingId ? 'Update the pricing details for this product' : 'Select a product and define pricing details'}</div>
                </div>
              </div>
              <button
                className="pdm-form-close"
                onClick={() => { setDraft(EMPTY_DRAFT); setEditingId(null); setDraftOpen(false); }}
                disabled={saving}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="pdm-form-body">
              <div className="pdm-form-field">
                <label className="pdm-form-label">SELECT PRODUCT <span className="pdm-form-req">*</span></label>
                <MasterSelect
                  value={draft.product_id != null ? String(draft.product_id) : ''}
                  onChange={(v) => setDraft(p => ({ ...p, product_id: v ? Number(v) : null }))}
                  options={availableProducts.map(p => ({ value: String(p.id), label: `${p.product_code} · ${p.name}` }))}
                  placeholder={productsLoading ? 'Loading…' : 'Select product'}
                  /* Locked when editing — a mapping can't be re-pointed to a
                     different product (only its pricing is editable). */
                  disabled={productsLoading || !!editingId}
                />
              </div>

              <div className="pdm-form-grid-2">
                <div className="pdm-form-field">
                  <label className="pdm-form-label">QUANTITY <span className="pdm-form-req">*</span></label>
                  <div className="pdm-form-input-wrap">
                    <span className="pdm-form-input-icon" aria-hidden>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <rect x="3" y="3"  width="7" height="7" rx="1" />
                        <rect x="14" y="3"  width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </span>
                    <input
                      type="number" min="0" step="any"
                      className="pdm-form-input"
                      placeholder="Enter quantity"
                      value={draft.quantity}
                      onChange={e => setDraft(p => ({ ...p, quantity: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="pdm-form-field">
                  <label className="pdm-form-label">TARGET PRICE <span className="pdm-form-req">*</span></label>
                  {/* No currency symbol prefix here — the currency is chosen
                      separately below, so a hardcoded "$" was both redundant
                      and misleading (it showed $ even for INR/EUR/etc.). */}
                  <div className="pdm-form-input-wrap">
                    <input
                      type="number" min="0" step="any"
                      className="pdm-form-input"
                      placeholder="Enter target price"
                      value={draft.target_price}
                      onChange={e => setDraft(p => ({ ...p, target_price: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="pdm-form-field">
                <label className="pdm-form-label">CURRENCY <span className="pdm-form-req">*</span></label>
                {/* Single-currency-per-lead lock — see saveDraft comment
                    in the parent. When the lead already has a currency
                    set we limit the picker to that one option. */}
                <MasterSelect
                  value={draft.currency}
                  onChange={(v) => setDraft(p => ({ ...p, currency: v }))}
                  options={
                    lockedCurrency
                      ? [{ value: lockedCurrency, label: lockedCurrency }]
                      : currencies.map(c => ({
                          value: c.code,
                          label: c.name ? `${c.code} – ${c.name}` : c.code,
                        }))
                  }
                  placeholder="Select currency"
                  disabled={!!lockedCurrency}
                  loading={currenciesLoading && currencies.length === 0}
                />
              </div>

              <div className="pdm-form-note">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <circle cx="12" cy="8" r="0.5" fill="currentColor" />
                </svg>
                <span>
                  All fields marked <span className="pdm-form-req">*</span> are required to map the product.
                </span>
              </div>
            </div>

            <div className="pdm-form-foot">
              <button
                className="pdm-form-btn pdm-form-btn-ghost"
                onClick={() => { setDraft(EMPTY_DRAFT); setEditingId(null); setDraftOpen(false); }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="pdm-form-btn pdm-form-btn-primary"
                onClick={() => void saveDraft()}
                disabled={saving || !draft.product_id}
              >
                {saving ? 'Saving…' : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                      <circle cx="18" cy="5"  r="3" />
                      <circle cx="6"  cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                    {editingId ? 'Save Changes' : 'Map Product'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Themed delete (unmap) confirmation */}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Unmap Product"
        itemName={pendingDelete?.product_name ?? '—'}
        actionVerb="Unmap"
        confirmLabel="Unmap"
        confirmingLabel="Unmapping…"
        subMessage="This product will be removed from this opportunity's directory."
        loading={deleting}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.pdm-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.pdm-modal {
  width: min(1180px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.pdm-head {
  /* Prototype gradient — 115° sweep from deep violet at the top-left
     through soft lilac at the bottom-right, matching the HTML mockup.
     gap + flex-shrink lock the header to a single row so the title,
     map button and close pill stay aligned at any width. */
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-shrink: 0;
  padding: 16px 22px; color: #fff;
  position: relative; overflow: hidden;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
}
.pdm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pdm-head-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.pdm-head-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
.pdm-head-sub   { font-size: 11.5px; opacity: .85; margin-top: 3px; }
.pdm-head-actions { display: flex; gap: 8px; align-items: center; }
.pdm-map-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px; border: none;
  background: rgba(255,255,255,.18); color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s;
}
.pdm-map-btn:hover:not(:disabled) { background: rgba(255,255,255,.30); }
.pdm-map-btn:disabled { opacity: .55; cursor: not-allowed; }
.pdm-map-btn-ghost { background: transparent; border: 1.5px solid rgba(255,255,255,.32); }
.pdm-map-btn-ghost:hover { background: rgba(255,255,255,.12); }
.pdm-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.pdm-close:hover { background: rgba(255,255,255,.32); }

.pdm-body { flex: 1; overflow-y: auto; padding: 14px 20px; background: #faf5ff; }
.pdm-table-wrap {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: auto;
  /* Show ~5 product rows; the rest scroll inside (sticky header stays put). */
  max-height: 320px;
}
/* Loading shimmer — skeleton bar in each cell of the skeleton rows. The
   base is a clearly visible grey so the bar reads as a placeholder, with a
   brighter band sweeping across it for the shimmer. */
.pdm-skeleton-row td { padding: 14px 12px; }
.pdm-shimmer {
  display: block; height: 12px; width: 100%; border-radius: 6px;
  background: linear-gradient(90deg, #e2e0ec 0%, #e2e0ec 30%, #f4f1fb 50%, #e2e0ec 70%, #e2e0ec 100%);
  background-size: 200% 100%;
  animation: pdm-shimmer 1.3s ease-in-out infinite;
}
@keyframes pdm-shimmer { 0% { background-position: 150% 0; } 100% { background-position: -50% 0; } }
/* Dark mode — slate base with a lighter slate sweep so the shimmer stays
   visible against the dark modal surface (the light gradient looked white). */
[data-bs-theme="dark"] .pdm-shimmer,
[data-layout-mode="dark"] .pdm-shimmer {
  background: linear-gradient(90deg, rgba(148,163,184,.16) 0%, rgba(148,163,184,.16) 30%, rgba(196,181,253,.30) 50%, rgba(148,163,184,.16) 70%, rgba(148,163,184,.16) 100%);
  background-size: 200% 100%;
}
.pdm-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1000px; }
/* Table header — gradient lives on the <tr> so a single 90° sweep
   spans the whole row instead of each <th> rendering its own copy
   (which caused the visible "stitch" lines between columns). Cells
   stay transparent so they overlay the row gradient cleanly. */
.pdm-table thead tr {
  background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
}
.pdm-table thead th {
  background: transparent;
  color: #fff;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  text-align: left; padding: 11px 12px;
  position: sticky; top: 0; z-index: 2;
  white-space: nowrap;
}
.pdm-table tbody tr { border-bottom: 1px solid #f1f5f9; }
.pdm-table tbody tr:last-child { border-bottom: none; }
.pdm-table tbody tr:hover { background: #faf5ff; }
.pdm-table tbody td { padding: 10px 12px; color: #1e293b; vertical-align: middle; }
.pdm-draft-row { background: #fdf4ff !important; }

/* ── Pagination (4 products per page) ── */
.pdm-pager {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 16px; flex-wrap: wrap;
  border-top: 1px solid #ede9fe; background: #faf7ff;
}
.pdm-pager-info { font-size: 11.5px; font-weight: 600; color: #6d28d9; }
.pdm-pager-ctrls { display: inline-flex; align-items: center; gap: 5px; }
.pdm-pager-btn, .pdm-pager-num {
  min-width: 28px; height: 28px; padding: 0 7px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; border: 1.5px solid #e9d5ff; color: #6d28d9;
  font-family: inherit; font-size: 12px; font-weight: 700;
  transition: background .15s, border-color .15s, color .15s;
}
.pdm-pager-btn:hover:not(:disabled), .pdm-pager-num:hover:not(.on) { background: #f3e8ff; border-color: #c4b5fd; }
.pdm-pager-btn:disabled { opacity: .45; cursor: not-allowed; }
.pdm-pager-num.on { background: linear-gradient(135deg, #7c3aed, #6d28d9); border-color: #6d28d9; color: #fff; }
[data-bs-theme="dark"] .pdm-pager { background: #1f1635; border-top-color: rgba(167,139,250,.2); }
[data-bs-theme="dark"] .pdm-pager-info { color: #c4b5fd; }
[data-bs-theme="dark"] .pdm-pager-btn, [data-bs-theme="dark"] .pdm-pager-num { background: #2a2150; border-color: rgba(167,139,250,.3); color: #d8b4fe; }
[data-bs-theme="dark"] .pdm-pager-btn:hover:not(:disabled), [data-bs-theme="dark"] .pdm-pager-num:hover:not(.on) { background: #342861; }
[data-bs-theme="dark"] .pdm-pager-num.on { background: linear-gradient(135deg, #7c3aed, #6d28d9); border-color: #a78bfa; color: #fff; }
.pdm-prod-cell { display: flex; flex-direction: column; gap: 2px; }
.pdm-prod-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #7c3aed; font-weight: 700;
}
.pdm-prod-name { font-size: 13px; color: #0f172a; font-weight: 700; line-height: 1.3; }

/* ── SR NO badge ── compact pale-lilac chip with a soft violet
   outline. Squared corners (radius 8px) instead of the previous
   full-pill so it reads as a "chip" rather than a numeric pill. */
.pdm-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; padding: 3px 10px;
  background: #f5f3ff;
  color: #6d28d9;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  font-size: 11.5px; font-weight: 700;
}

/* ── PRODUCT CODE chip ── monospace code with the single-square
   icon. Shares the SR badge's lilac palette so the two leading
   columns read as one coherent chip family. */
.pdm-code-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: #f5f3ff; border: 1px solid #ddd6fe;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 700; color: #6d28d9;
}
.pdm-code-chip svg { color: #7c3aed; flex-shrink: 0; }

/* ── PRODUCT NAME cell — name + category badge stacked.
   Slightly larger gap so the badge breathes below the name. */
.pdm-name-cell { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }

/* Category badge sits as a quiet slate chip below the product name —
   muted on purpose so the product name reads first and the badge
   functions as a secondary tag (matches the prototype's restrained
   treatment, was a punchy violet that competed with the SR/code
   chips for attention). */
.pdm-cat-badge {
  display: inline-block;
  padding: 2px 9px;
  background: #f1f5f9; color: #475569;
  border-radius: 6px;
  font-size: 9.5px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase;
}

/* ── STATUS pill ── soft pastel pill with a leading dot — green
   for Active, red/pink for Inactive. Chunkier padding + slightly
   larger font so the badge reads as a confident state indicator
   matching the prototype. */
.pdm-status-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 14px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700;
  line-height: 1.1;
}
.pdm-status-pill .pdm-status-dot {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor;
}
.pdm-status-on  { background: #dcfce7; color: #15803d; }
.pdm-status-off { background: #fee2e2; color: #b91c1c; }

/* ── TARGET PRICE — vivid emerald green text. The .pdm-table tbody
   td rule below sets a cell-wide default of #1e293b (slate) with
   specificity (0,1,2); we mirror that scope here to win the cascade
   without resorting to !important. Same trick again for dark mode. */
.pdm-table tbody td.pdm-price { color: #16a34a; font-weight: 800; }
.pdm-table tbody td.pdm-price * { color: inherit; }

/* ── CURRENCY badge ── squared chip (radius 8px) instead of a
   full pill, sharing the SR / code chip shape so the row's chips
   are visually a family. Blue palette kept — only the geometry
   was changed. */
.pdm-curr-pill {
  display: inline-block; padding: 3px 12px; border-radius: 8px;
  background: #dbeafe; color: #1d4ed8;
  font-size: 11px; font-weight: 800; letter-spacing: .02em;
  border: 1px solid #bfdbfe;
}

/* ── Icon-only action buttons ── square chip the same size and
   radius as the SR badge so the row's chips stay one family.
   Edit uses the SR-badge lilac palette; Delete keeps a parallel
   red palette so destructive intent reads at a glance. */
.pdm-icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1px solid transparent;
  background: #fff; cursor: pointer;
  transition: all .12s;
}
.pdm-icon-btn-edit {
  background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe;
}
.pdm-icon-btn-edit:hover { background: #ede9fe; border-color: #c4b5fd; }
.pdm-icon-btn-del {
  background: #fef2f2; color: #b91c1c; border-color: #fecaca;
}
.pdm-icon-btn-del:hover:not(:disabled) { background: #fee2e2; border-color: #fca5a5; }
.pdm-icon-btn:disabled {
  opacity: .45; cursor: not-allowed;
  background: #f8fafc; color: #94a3b8; border-color: #e2e8f0;
}

/* ── Footer ── pinned below the body, status text + Close button */
.pdm-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: #fff; border-top: 1px solid #e2e8f0;
}
.pdm-foot-status {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; color: #64748b; font-weight: 500;
}
.pdm-foot-status svg { color: #94a3b8; flex-shrink: 0; }
.pdm-foot-close {
  padding: 8px 22px; border-radius: 8px;
  background: #fff; border: 1.5px solid #cbd5e1;
  font-size: 12.5px; font-weight: 700; color: #1e293b;
  cursor: pointer; transition: all .15s;
}
.pdm-foot-close:hover { background: #f8fafc; border-color: #94a3b8; }
/* Currency-lock banner — shown above the table when at least one
 * product is mapped, explaining why the currency picker is disabled. */
.pdm-curr-lock-banner {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px;
  padding: 9px 12px; border-radius: 8px;
  background: #fef3c7; border: 1px solid #fcd34d;
  color: #92400e; font-size: 11.5px; line-height: 1.45;
}
.pdm-curr-lock-banner svg { flex-shrink: 0; color: #b45309; }
.pdm-curr-lock-banner strong { color: #78350f; }
/* Dark mode — amber tint on the dark surface instead of a solid light strip. */
[data-bs-theme="dark"] .pdm-curr-lock-banner {
  background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.32); color: #fcd34d;
}
[data-bs-theme="dark"] .pdm-curr-lock-banner svg { color: #fbbf24; }
[data-bs-theme="dark"] .pdm-curr-lock-banner strong { color: #fde68a; }
.pdm-num { font-variant-numeric: tabular-nums; }
.pdm-status {
  text-align: center; padding: 24px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}
.pdm-act-cell { display: flex; gap: 6px; justify-content: flex-start; align-items: center; }
.pdm-row-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border: 1.5px solid #cbd5e1;
  background: #fff; color: #475569;
  border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: all .12s;
}
.pdm-row-btn:hover:not(:disabled) { background: #f1f5f9; }
.pdm-row-btn:disabled { opacity: .55; cursor: not-allowed; }
.pdm-row-btn-primary {
  border-color: transparent;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
}
.pdm-row-btn-primary:hover:not(:disabled) { filter: brightness(1.08); background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.pdm-row-btn-edit { color: #7c3aed; border-color: #ddd6fe; }
.pdm-row-btn-edit:hover { background: #ede9fe; }
.pdm-row-btn-del  { color: #dc2626; border-color: #fecaca; padding: 5px 8px; }
.pdm-row-btn-del:hover { background: #fee2e2; }

.pdm-input {
  width: 100%; height: 32px; padding: 0 8px;
  border: 1.5px solid #cbd5e1; border-radius: 7px;
  background: #fff; font-size: 12px; color: #0f172a;
  outline: none; font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
}
.pdm-input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.16); }

/* Dark mode */
[data-bs-theme="dark"] .pdm-modal { background: #14102a; }
[data-bs-theme="dark"] .pdm-body  { background: #1a1538; }
[data-bs-theme="dark"] .pdm-table-wrap {
  background: #14102a;
  border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .pdm-table thead {
  background: linear-gradient(135deg, #20184a, #2a2150);
}
[data-bs-theme="dark"] .pdm-table thead th {
  color: #c4b5fd;
  border-bottom-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .pdm-table tbody tr   { border-color: rgba(167, 139, 250, .18); }
[data-bs-theme="dark"] .pdm-table tbody tr:hover { background: rgba(124, 58, 237, .14); }
[data-bs-theme="dark"] .pdm-table tbody td   { color: #ede9fe; }
[data-bs-theme="dark"] .pdm-prod-name        { color: #ede9fe; }
[data-bs-theme="dark"] .pdm-prod-code        { color: #a78bfa; }
[data-bs-theme="dark"] .pdm-draft-row        { background: rgba(124, 58, 237, .18) !important; }
[data-bs-theme="dark"] .pdm-curr-pill {
  background: rgba(167, 139, 250, .22);
  color: #d8b4fe;
  border-color: rgba(167, 139, 250, .35);
}
[data-bs-theme="dark"] .pdm-input {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #ede9fe;
}
[data-bs-theme="dark"] .pdm-input::placeholder { color: rgba(196, 181, 253, .50); }
[data-bs-theme="dark"] .pdm-input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, .20);
}

/* Row action buttons — Edit (violet) + Delete (red) on dark. */
[data-bs-theme="dark"] .pdm-row-btn {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .pdm-row-btn:hover:not(:disabled) {
  background: #2a2150;
  border-color: rgba(167, 139, 250, .55);
}
[data-bs-theme="dark"] .pdm-row-btn-edit {
  background: rgba(124, 58, 237, .18);
  border-color: rgba(167, 139, 250, .40);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .pdm-row-btn-edit:hover:not(:disabled) {
  background: rgba(124, 58, 237, .30);
  border-color: #a78bfa;
  color: #ede9fe;
}
[data-bs-theme="dark"] .pdm-row-btn-del {
  background: rgba(239, 68, 68, .14);
  border-color: rgba(252, 165, 165, .40);
  color: #fca5a5;
}
[data-bs-theme="dark"] .pdm-row-btn-del:hover:not(:disabled) {
  background: rgba(239, 68, 68, .25);
  border-color: #fca5a5;
  color: #fecaca;
}
[data-bs-theme="dark"] .pdm-row-btn-primary {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(124, 58, 237, .40);
}
[data-bs-theme="dark"] .pdm-row-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
}

/* Header pill button "+ Add Product" (ghost variant). */
[data-bs-theme="dark"] .pdm-map-btn-ghost {
  background: rgba(255, 255, 255, .12);
  border-color: rgba(255, 255, 255, .25);
  color: #fff;
}
[data-bs-theme="dark"] .pdm-map-btn-ghost:hover { background: rgba(255, 255, 255, .22); }

/* Empty-state row */
[data-bs-theme="dark"] .pdm-status { color: rgba(196, 181, 253, .55); }

/* Dark-mode for the new visual chrome introduced for the redesign. */
[data-bs-theme="dark"] .pdm-sr-pill   { background: rgba(167, 139, 250, .22); color: #d8b4fe; }
[data-bs-theme="dark"] .pdm-code-chip {
  background: rgba(167, 139, 250, .15);
  border-color: rgba(167, 139, 250, .35);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .pdm-code-chip svg { color: #c4b5fd; }
[data-bs-theme="dark"] .pdm-cat-badge {
  background: rgba(148, 163, 184, .18);
  color: #cbd5e1;
}
[data-bs-theme="dark"] .pdm-status-on  { background: rgba(34, 197, 94, .18);  color: #86efac; }
[data-bs-theme="dark"] .pdm-status-off { background: rgba(239, 68, 68, .18);  color: #fca5a5; }
[data-bs-theme="dark"] .pdm-table tbody td.pdm-price      { color: #34d399; }
[data-bs-theme="dark"] .pdm-curr-pill  {
  background: rgba(59, 130, 246, .22);
  color: #93c5fd;
  border-color: rgba(59, 130, 246, .40);
}
[data-bs-theme="dark"] .pdm-icon-btn-edit {
  background: rgba(59, 130, 246, .22);
  border-color: rgba(59, 130, 246, .40);
  color: #93c5fd;
}
[data-bs-theme="dark"] .pdm-icon-btn-edit:hover { background: rgba(59, 130, 246, .35); }
[data-bs-theme="dark"] .pdm-icon-btn-del {
  background: rgba(239, 68, 68, .18);
  border-color: rgba(252, 165, 165, .40);
  color: #fca5a5;
}
[data-bs-theme="dark"] .pdm-icon-btn-del:hover { background: rgba(239, 68, 68, .28); }
[data-bs-theme="dark"] .pdm-foot {
  background: #14102a;
  border-top-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .pdm-foot-status      { color: #c4b5fd; }
[data-bs-theme="dark"] .pdm-foot-status svg  { color: #a78bfa; }
[data-bs-theme="dark"] .pdm-foot-close {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #ede9fe;
}
[data-bs-theme="dark"] .pdm-foot-close:hover { background: #2a2150; }

/* ════════════════════════════════════════════════════════════════════
 *  Map-Product popup form
 *  Opened by the directory header's "Map Product" button. Sits on top
 *  of the directory backdrop so the user can see context behind it.
 * ════════════════════════════════════════════════════════════════════ */
.pdm-form-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.30); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: pdmFormFade .15s ease-out;
}
@keyframes pdmFormFade { from { opacity: 0; } to { opacity: 1; } }
.pdm-form-modal {
  width: min(620px, 100%); max-height: 90vh;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 22px 56px rgba(15,23,42,.32);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: pdmFormPop .18s cubic-bezier(.34,1.4,.64,1);
}
@keyframes pdmFormPop {
  from { transform: scale(.94); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

/* ── Form header — same violet sweep as the directory popup ── */
.pdm-form-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-shrink: 0;
  padding: 16px 22px; color: #fff;
  position: relative; overflow: hidden;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
}
.pdm-form-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pdm-form-head-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255,255,255,.20);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pdm-form-head-title {
  font-size: 16px; font-weight: 800; line-height: 1.2;
  color: #fff; letter-spacing: -.2px;
}
.pdm-form-head-sub {
  font-size: 11.5px; font-weight: 500; color: rgba(255,255,255,.88);
  margin-top: 3px;
}
.pdm-form-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.20); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pdm-form-close:hover:not(:disabled) { background: rgba(255,255,255,.34); }
.pdm-form-close:disabled { opacity: .55; cursor: not-allowed; }

/* ── Body ── */
.pdm-form-body {
  flex: 1; overflow-y: auto;
  padding: 20px 22px;
  background: #faf5ff;
  display: flex; flex-direction: column; gap: 14px;
}
.pdm-form-field { display: flex; flex-direction: column; gap: 6px; }
.pdm-form-grid-2 {
  display: grid; gap: 14px;
  grid-template-columns: 1fr 1fr;
}
.pdm-form-label {
  font-size: 10.5px; font-weight: 800;
  color: #6d28d9; letter-spacing: .08em;
  text-transform: uppercase;
}
.pdm-form-req { color: #ef4444; font-weight: 800; margin-left: 2px; }

/* ── Input with icon prefix (quantity + target price) ── */
.pdm-form-input-wrap {
  display: flex; align-items: center;
  background: #fff;
  border: 1.5px solid #e9d5ff;
  border-radius: 10px;
  height: 40px;
  transition: border-color .15s, box-shadow .15s;
}
.pdm-form-input-wrap:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.16);
}
.pdm-form-input-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 100%;
  color: #7c3aed;
  font-size: 14px; font-weight: 700;
  border-right: 1px solid #f3e8ff;
}
.pdm-form-input {
  flex: 1; min-width: 0;
  height: 100%; padding: 0 12px;
  border: none; outline: none; background: transparent;
  font-size: 13px; font-weight: 500; color: #1e293b;
  font-family: inherit;
}
.pdm-form-input::placeholder { color: #cbd5e1; font-weight: 400; }

/* MasterSelect inside the form picks up the same chrome via its
   class. If your MasterSelect doesn't honour it, the violet border
   on the wrapper still hints at the form's design language. */

/* ── Helper note (info icon + asterisk reminder) ── */
.pdm-form-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 10px;
  font-size: 11.5px; color: #5b21b6; font-weight: 500;
  line-height: 1.55;
}
.pdm-form-note svg { color: #7c3aed; flex-shrink: 0; margin-top: 1px; }

/* ── Footer buttons ── */
.pdm-form-foot {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #f3e8ff;
}
.pdm-form-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px 22px;
  border: 1.5px solid transparent;
  border-radius: 10px;
  font-size: 13px; font-weight: 700;
  font-family: inherit; cursor: pointer;
  transition: all .15s;
}
.pdm-form-btn:disabled { opacity: .55; cursor: not-allowed; }
.pdm-form-btn-ghost {
  background: #fff; border-color: #cbd5e1; color: #1e293b;
  /* Lighter weight than the primary button — Cancel is secondary,
     so it shouldn't compete with Map Product for emphasis. */
  font-weight: 500;
}
.pdm-form-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.pdm-form-btn-primary {
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.pdm-form-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(124, 58, 237, .45);
}

/* ── Dark mode for the popup form ── */
[data-bs-theme="dark"] .pdm-form-modal { background: #14102a; }
[data-bs-theme="dark"] .pdm-form-body  { background: #1a1538; }
[data-bs-theme="dark"] .pdm-form-label { color: #c4b5fd; }
[data-bs-theme="dark"] .pdm-form-input-wrap {
  background: #1f1845; border-color: rgba(167, 139, 250, .30);
}
[data-bs-theme="dark"] .pdm-form-input-wrap:focus-within {
  border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .pdm-form-input-icon {
  color: #c4b5fd; border-right-color: rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .pdm-form-input { color: #ede9fe; }
[data-bs-theme="dark"] .pdm-form-input::placeholder { color: rgba(196, 181, 253, .45); }
[data-bs-theme="dark"] .pdm-form-note {
  background: #14102a; border-color: rgba(167, 139, 250, .25); color: #d8b4fe;
}
[data-bs-theme="dark"] .pdm-form-note svg { color: #a78bfa; }
[data-bs-theme="dark"] .pdm-form-foot {
  background: #14102a; border-top-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .pdm-form-btn-ghost {
  background: #1f1845; border-color: rgba(167, 139, 250, .30); color: #ede9fe;
}
[data-bs-theme="dark"] .pdm-form-btn-ghost:hover:not(:disabled) { background: #2a2150; }

@media (max-width: 640px) {
  .pdm-backdrop { padding: 0; }
  .pdm-modal { border-radius: 0; max-height: 100vh; }
  .pdm-head-actions { flex-wrap: wrap; }
  .pdm-foot { flex-direction: column-reverse; gap: 10px; align-items: stretch; }
  .pdm-foot-close { width: 100%; }
  .pdm-form-backdrop { padding: 0; }
  .pdm-form-modal { border-radius: 0; max-height: 100vh; }
  .pdm-form-grid-2 { grid-template-columns: 1fr; }
  .pdm-form-foot { flex-direction: column-reverse; gap: 8px; }
  .pdm-form-btn { width: 100%; }
}
`;
