import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect } from '../../../components/ui/MasterSelect';

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
  id:             number;
  product_id:     number;
  product_code:   string | null;
  product_name:   string | null;
  product_status: string | null;
  currency:       string;
  quantity:       string | number | null;
  target_price:   string | number | null;
  notes:          string | null;
};

type ProductOpt = {
  id:           number;
  product_code: string;
  name:         string;
};

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CNY', 'JPY'];

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
};

export default function ProductDirectoryModal({ open, leadId, onClose, onAddProduct }: Props) {
  const toast = useToast();

  const [rows, setRows]               = useState<DirectoryRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [products, setProducts]       = useState<ProductOpt[]>([]);
  const [productsLoading, setPL]      = useState(false);
  const [draftOpen, setDraftOpen]     = useState(false);
  const [draft, setDraft]             = useState<DraftRow>(EMPTY_DRAFT);
  const [saving, setSaving]           = useState(false);
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [editDraft, setEditDraft]     = useState<DraftRow>(EMPTY_DRAFT);

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

  const productsById = useMemo(() => {
    const m = new Map<number, ProductOpt>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  /* Hide products that are already mapped — prevents 422 on save. */
  const mappedIds = useMemo(() => new Set(rows.map(r => r.product_id)), [rows]);
  const availableProducts = useMemo(
    () => products.filter(p => !mappedIds.has(p.id) || p.id === editDraft.product_id),
    [products, mappedIds, editDraft.product_id],
  );

  if (!open) return null;

  /* ── Save (map new) ─────────────────────────────────────────── */
  const saveDraft = async () => {
    if (!leadId) return;
    if (!draft.product_id) {
      toast.warning('Pick a product', 'Select a product from the dropdown first');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<{ status: boolean; data: { id: number; product: { product_code: string; name: string; status: string } } }>(
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
        id:             created.id,
        product_id:     draft.product_id!,
        product_code:   created.product?.product_code ?? pmaster?.product_code ?? null,
        product_name:   created.product?.name         ?? pmaster?.name         ?? null,
        product_status: created.product?.status       ?? null,
        currency:       draft.currency,
        quantity:       draft.quantity     ? Number(draft.quantity)     : null,
        target_price:   draft.target_price ? Number(draft.target_price) : null,
        notes:          draft.notes || null,
      }, ...prev]);
      setDraft(EMPTY_DRAFT); setDraftOpen(false);
      toast.success('Product mapped', 'Added to the directory');
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not map this product');
    } finally {
      setSaving(false);
    }
  };

  /* ── Save (edit row) ────────────────────────────────────────── */
  const startEdit = (row: DirectoryRow) => {
    setEditingId(row.id);
    setEditDraft({
      product_id:   row.product_id,
      currency:     row.currency,
      quantity:     row.quantity     != null ? String(row.quantity)     : '',
      target_price: row.target_price != null ? String(row.target_price) : '',
      notes:        row.notes ?? '',
    });
  };
  const saveEdit = async () => {
    if (!leadId || !editingId) return;
    setSaving(true);
    try {
      await api.put(`/sales/leads/${leadId}/products/${editingId}`, {
        currency:     editDraft.currency,
        quantity:     editDraft.quantity     ? Number(editDraft.quantity)     : null,
        target_price: editDraft.target_price ? Number(editDraft.target_price) : null,
        notes:        editDraft.notes || null,
      });
      setRows(prev => prev.map(r => r.id === editingId ? {
        ...r,
        currency:     editDraft.currency,
        quantity:     editDraft.quantity     ? Number(editDraft.quantity)     : null,
        target_price: editDraft.target_price ? Number(editDraft.target_price) : null,
        notes:        editDraft.notes || null,
      } : r));
      setEditingId(null);
      toast.success('Updated', 'Mapping updated');
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not update this mapping');
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (row: DirectoryRow) => {
    if (!leadId) return;
    if (!confirm(`Unmap "${row.product_name ?? '—'}" from this opportunity?`)) return;
    try {
      await api.delete(`/sales/leads/${leadId}/products/${row.id}`);
      setRows(prev => prev.filter(r => r.id !== row.id));
      toast.success('Unmapped', 'Removed from the directory');
    } catch (e: any) {
      toast.error('Remove failed', e?.response?.data?.message ?? 'Could not unmap');
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
              onClick={() => { setDraft(EMPTY_DRAFT); setDraftOpen(o => !o); }}
              disabled={!leadId}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Map Product
            </button>
            {onAddProduct && (
              <button className="pdm-map-btn pdm-map-btn-ghost" onClick={onAddProduct}>
                + New Master
              </button>
            )}
            <button className="pdm-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pdm-body">
          <div className="pdm-table-wrap">
            <table className="pdm-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>PRODUCT</th>
                  <th style={{ width: 90 }}>CURRENCY</th>
                  <th style={{ width: 110 }}>QUANTITY</th>
                  <th style={{ width: 130 }}>TARGET PRICE</th>
                  <th style={{ width: 130 }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {/* New-mapping draft row */}
                {draftOpen && (
                  <tr className="pdm-draft-row">
                    <td>+</td>
                    <td>
                      <MasterSelect
                        value={draft.product_id != null ? String(draft.product_id) : ''}
                        onChange={(v) => setDraft(p => ({ ...p, product_id: v ? Number(v) : null }))}
                        options={availableProducts.map(p => ({ value: String(p.id), label: `${p.product_code} · ${p.name}` }))}
                        placeholder={productsLoading ? 'Loading…' : 'Select product…'}
                        disabled={productsLoading}
                      />
                    </td>
                    <td>
                      <MasterSelect
                        value={draft.currency}
                        onChange={(v) => setDraft(p => ({ ...p, currency: v }))}
                        options={CURRENCIES.map(c => ({ value: c, label: c }))}
                        placeholder="Currency"
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="any" className="pdm-input"
                        placeholder="0"
                        value={draft.quantity}
                        onChange={e => setDraft(p => ({ ...p, quantity: e.target.value }))}
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="any" className="pdm-input"
                        placeholder="0.00"
                        value={draft.target_price}
                        onChange={e => setDraft(p => ({ ...p, target_price: e.target.value }))}
                      />
                    </td>
                    <td className="pdm-act-cell">
                      <button className="pdm-row-btn pdm-row-btn-primary" onClick={() => void saveDraft()} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="pdm-row-btn" onClick={() => { setDraft(EMPTY_DRAFT); setDraftOpen(false); }} disabled={saving}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td colSpan={6} className="pdm-status">Loading mapped products…</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && !draftOpen && (
                  <tr>
                    <td colSpan={6} className="pdm-status">
                      No products mapped yet — click <strong>Map Product</strong> to add the first.
                    </td>
                  </tr>
                )}

                {rows.map((r, i) => {
                  const isEditing = editingId === r.id;
                  if (isEditing) {
                    return (
                      <tr key={r.id} className="pdm-draft-row">
                        <td>{i + 1}</td>
                        <td>
                          <div className="pdm-prod-cell">
                            <span className="pdm-prod-code">{r.product_code ?? '—'}</span>
                            <span className="pdm-prod-name">{r.product_name ?? '—'}</span>
                          </div>
                        </td>
                        <td>
                          <MasterSelect
                            value={editDraft.currency}
                            onChange={(v) => setEditDraft(p => ({ ...p, currency: v }))}
                            options={CURRENCIES.map(c => ({ value: c, label: c }))}
                            placeholder="Currency"
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any" className="pdm-input"
                            value={editDraft.quantity}
                            onChange={e => setEditDraft(p => ({ ...p, quantity: e.target.value }))}
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any" className="pdm-input"
                            value={editDraft.target_price}
                            onChange={e => setEditDraft(p => ({ ...p, target_price: e.target.value }))}
                          />
                        </td>
                        <td className="pdm-act-cell">
                          <button className="pdm-row-btn pdm-row-btn-primary" onClick={() => void saveEdit()} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button className="pdm-row-btn" onClick={() => setEditingId(null)} disabled={saving}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>
                        <div className="pdm-prod-cell">
                          <span className="pdm-prod-code">{r.product_code ?? '—'}</span>
                          <span className="pdm-prod-name">{r.product_name ?? '—'}</span>
                        </div>
                      </td>
                      <td><span className="pdm-curr-pill">{r.currency}</span></td>
                      <td className="pdm-num">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                      <td className="pdm-num">{r.target_price != null ? Number(r.target_price).toLocaleString() : '—'}</td>
                      <td className="pdm-act-cell">
                        <button className="pdm-row-btn pdm-row-btn-edit" onClick={() => startEdit(r)} title="Edit">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Edit
                        </button>
                        <button className="pdm-row-btn pdm-row-btn-del" onClick={() => void removeRow(r)} title="Unmap">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
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
        </div>
      </div>
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
  width: min(960px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.pdm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; color: #fff;
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
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
}
.pdm-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 760px; }
.pdm-table thead th {
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
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
.pdm-prod-cell { display: flex; flex-direction: column; gap: 2px; }
.pdm-prod-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #7c3aed; font-weight: 700;
}
.pdm-prod-name { font-size: 12.5px; color: #0f172a; font-weight: 600; }
.pdm-curr-pill {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  background: #ede9fe; color: #6d28d9; font-size: 10.5px; font-weight: 700;
}
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
[data-bs-theme="dark"] .pdm-modal { background: #0f172a; }
[data-bs-theme="dark"] .pdm-body  { background: #0b1226; }
[data-bs-theme="dark"] .pdm-table-wrap { background: #0f172a; border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .pdm-table tbody tr { border-color: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .pdm-table tbody tr:hover { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .pdm-table tbody td { color: #e2e8f0; }
[data-bs-theme="dark"] .pdm-prod-name      { color: #ede9fe; }
[data-bs-theme="dark"] .pdm-draft-row      { background: rgba(124,58,237,.16) !important; }
[data-bs-theme="dark"] .pdm-curr-pill { background: rgba(124,58,237,.22); color: #d8b4fe; }
[data-bs-theme="dark"] .pdm-input     { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .pdm-row-btn   { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .pdm-row-btn:hover:not(:disabled) { background: #0f172a; }

@media (max-width: 640px) {
  .pdm-backdrop { padding: 0; }
  .pdm-modal { border-radius: 0; max-height: 100vh; }
  .pdm-head-actions { flex-wrap: wrap; }
}
`;
