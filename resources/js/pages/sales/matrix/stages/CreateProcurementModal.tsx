import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';

/* ─────────────────────────────────────────────────────────────────────────
 * Create Procurement modal — Sales Matrix → Stage 3 (Required tab).
 *
 *  Ported from New_IDIMS_6.0's CreateProcurementModal.tsx. Multi-product
 *  form with per-product qty / target price / attachments, plus a
 *  procurement-level TAT date, "assign to" salesperson, and shared
 *  attachments. Posts multipart to POST /procurements.
 *
 *  Mandatory: TAT, Assign To, qty + target_price for every selected row.
 *  Attachments are optional at both levels. Status defaults to in-progress.
 * ───────────────────────────────────────────────────────────────────── */

export type SelectedProduct = {
  /* lead_product row id — sent as products[n][lead_product_id] */
  id:           number;
  /* underlying product master id — products[n][product_id] */
  product_id:   number;
  product_code: string | null;
  product_name: string | null;
  status:       string | null;
  /* Pre-fill defaults from the lead_product row — user can override. */
  default_qty:  number | string | null;
  default_target_price: number | string | null;
  currency:     string;
};

type Salesperson = { id: number; name: string; code: string };

type Props = {
  open:             boolean;
  leadId:           number | null;
  /* Pulled from the matrix-detail header so the modal can echo Opp ID /
   * Date / Customer without re-fetching the lead. */
  leadContext?: {
    oppId?:        string;
    oppDate?:      string;
    customer?:     string;
    customerCode?: string;
  };
  selectedProducts: SelectedProduct[];
  onClose:          () => void;
  onCreated:        () => void;
};

type ProductDraft = {
  qty:          string;
  target_price: string;
  attachments:  File[];
};

function formatDdMmYyyy(s: string | undefined): string {
  if (!s) return '—';
  // Already DD/MM/YYYY? pass through.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB');
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CreateProcurementModal({
  open, leadId, leadContext, selectedProducts, onClose, onCreated,
}: Props) {
  const toast = useToast();
  const { user } = useAuth();

  const [procDate, setProcDate]            = useState('');
  const [assignTo, setAssignTo]            = useState('');
  // IDIMS freezes status to 'inprogress' on create; we mirror that —
  // completion is a separate flow once the assignee finishes sourcing.
  const status = 'inprogress';
  const [procAttachments, setProcAtt]      = useState<File[]>([]);
  const [productDrafts, setProductDrafts]  = useState<Record<number, ProductDraft>>({});
  const [salespeople, setSalespeople]      = useState<Salesperson[]>([]);
  const [nextCode, setNextCode]            = useState<string>('PROC-NEW');
  const [submitting, setSubmitting]        = useState(false);
  const [errors, setErrors]                = useState<Record<string, string>>({});

  const procFileRef = useRef<HTMLInputElement | null>(null);

  /* ── Reset every time the modal opens ───────────────────────────── */
  useEffect(() => {
    if (!open) return;
    setProcDate('');
    setAssignTo('');
    setProcAtt([]);
    setErrors({});
    const drafts: Record<number, ProductDraft> = {};
    for (const p of selectedProducts) {
      drafts[p.id] = {
        qty:          p.default_qty != null ? String(p.default_qty) : '',
        target_price: p.default_target_price != null ? String(p.default_target_price) : '',
        attachments:  [],
      };
    }
    setProductDrafts(drafts);

    // Salespeople + preview PROC code in parallel.
    api.get<{ status: boolean; data: Salesperson[] }>('/sales/leads/salespeople')
      .then(({ data }) => setSalespeople(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load assignable users'));
    api.get<{ status: boolean; data: { next_code: string } }>('/procurements/next-number')
      .then(({ data }) => setNextCode(data.data?.next_code ?? 'PROC-NEW'))
      .catch(() => { /* preview only — silent */ });
  }, [open, selectedProducts, toast]);

  const spOptions = useMemo(
    () => salespeople.map(sp => ({ value: String(sp.id), label: `${sp.code} · ${sp.name}` })),
    [salespeople],
  );

  const setDraft = (id: number, patch: Partial<ProductDraft>) => {
    setProductDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  /* ── Validation mirrors IDIMS validateForm ─────────────────────── */
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!procDate) next.procDate = 'Pick a TAT date';
    if (!assignTo) next.assignTo = 'Choose someone to assign this to';
    for (const p of selectedProducts) {
      const d = productDrafts[p.id];
      if (!d || !d.qty || Number(d.qty) <= 0)               next[`qty_${p.id}`]   = 'Required';
      if (!d || !d.target_price || Number(d.target_price) <= 0) next[`price_${p.id}`] = 'Required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet first');
      return;
    }
    if (selectedProducts.length === 0) {
      toast.warning('No products selected', 'Pick at least one Sourcing Required row first');
      return;
    }
    if (!validate()) {
      toast.warning('Fill required fields', 'TAT, Assign To, and per-row Qty + Target Price are mandatory');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('lead_id', String(leadId));
      fd.append('procurement_date', procDate);
      fd.append('assign_id', assignTo);
      fd.append('status', status);
      procAttachments.forEach((f, i) => fd.append(`attachments[${i}]`, f));

      selectedProducts.forEach((p, idx) => {
        const d = productDrafts[p.id];
        fd.append(`products[${idx}][lead_product_id]`, String(p.id));
        fd.append(`products[${idx}][product_id]`,      String(p.product_id));
        fd.append(`products[${idx}][qty]`,             String(d.qty));
        fd.append(`products[${idx}][target_price]`,    String(d.target_price));
        d.attachments.forEach((f, fi) => fd.append(`products[${idx}][attachment][${fi}]`, f));
      });

      await api.post('/procurements', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Procurement created', `${selectedProducts.length} product(s) added`);
      onCreated();
      onClose();
    } catch (e: any) {
      const data = e?.response?.data;
      const fieldErrs = data?.errors as Record<string, string[]> | undefined;
      const msg = fieldErrs ? Object.values(fieldErrs).flat().join(' ') : (data?.message ?? 'Could not create procurement');
      toast.error('Create failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal((
    <div className="cpm-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cpm-head">
          <div className="cpm-head-left">
            <div className="cpm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <div>
              <div className="cpm-head-title">Create Procurement</div>
              <div className="cpm-head-sub">{nextCode} · {selectedProducts.length} product{selectedProducts.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <button className="cpm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="cpm-body">
          {/* Lead detail strip — echoes the matrix-detail header so the
              user keeps context while filling in the procurement form. */}
          <div className="cpm-leadbar">
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">Opportunity ID</div>
              <div className="cpm-leadbar-val">{leadContext?.oppId ?? '—'}</div>
            </div>
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">Opportunity Date</div>
              <div className="cpm-leadbar-val">{formatDdMmYyyy(leadContext?.oppDate)}</div>
            </div>
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">Customer</div>
              <div className="cpm-leadbar-val">{leadContext?.customerCode ?? '—'}</div>
            </div>
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">Customer Name</div>
              <div className="cpm-leadbar-val">{leadContext?.customer ?? '—'}</div>
            </div>
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">Created By</div>
              <div className="cpm-leadbar-val">{user?.name ?? 'Current User'}</div>
            </div>
            <div className="cpm-leadbar-cell">
              <div className="cpm-leadbar-label">PROC ID</div>
              <div className="cpm-leadbar-val cpm-leadbar-mono">{nextCode}</div>
            </div>
          </div>

          {/* Procurement-level fields */}
          <div className="cpm-grid">
            <div className="cpm-field">
              <label className="cpm-label">Procurement TAT *</label>
              <input
                type="date"
                className={`cpm-input ${errors.procDate ? 'cpm-input-err' : ''}`}
                value={procDate}
                onChange={e => setProcDate(e.target.value)}
              />
              {errors.procDate && <div className="cpm-err">{errors.procDate}</div>}
            </div>
            <div className="cpm-field">
              <label className="cpm-label">Assign To *</label>
              <MasterSelect
                value={assignTo}
                onChange={(v) => setAssignTo(String(v))}
                options={spOptions}
                placeholder="Select user…"
              />
              {errors.assignTo && <div className="cpm-err">{errors.assignTo}</div>}
            </div>
            <div className="cpm-field">
              <label className="cpm-label">Status</label>
              {/* Frozen on create — mirrors IDIMS behaviour where the
                  procurement starts In Progress and the assignee flips it
                  to Completed from the procurement workspace. */}
              <div className="cpm-status-locked" title="Status is set on create and updated from the procurement workspace">
                <span className="cpm-status-dot" />
                In Progress
              </div>
            </div>
            <div className="cpm-field cpm-field-wide">
              <label className="cpm-label">Procurement Attachments (optional)</label>
              <div className="cpm-att-row">
                <button type="button" className="cpm-att-btn" onClick={() => procFileRef.current?.click()}>
                  + Add files
                </button>
                <input
                  type="file"
                  multiple
                  hidden
                  ref={procFileRef}
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={e => {
                    if (e.target.files) setProcAtt(prev => [...prev, ...Array.from(e.target.files!)]);
                    e.target.value = '';
                  }}
                />
                <div className="cpm-att-list">
                  {procAttachments.length === 0
                    ? <span className="cpm-att-empty">No files</span>
                    : procAttachments.map((f, i) => (
                        <span key={i} className="cpm-att-chip">
                          <span className="cpm-att-name" title={f.name}>{f.name}</span>
                          <button type="button" className="cpm-att-dl" title="Download" onClick={() => downloadFile(f)}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </button>
                          <button type="button" className="cpm-att-x" title="Remove" onClick={() => setProcAtt(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                        </span>
                      ))
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Per-product rows */}
          <div className="cpm-prods">
            <div className="cpm-prods-head">Products in this procurement</div>
            <div className="cpm-prods-wrap">
              <table className="cpm-prods-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>PRODUCT</th>
                    <th style={{ width: 110 }}>QTY *</th>
                    <th style={{ width: 130 }}>TARGET PRICE *</th>
                    <th style={{ width: 80 }}>CURRENCY</th>
                    <th>ATTACHMENTS</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.map((p, idx) => {
                    const d = productDrafts[p.id] ?? { qty: '', target_price: '', attachments: [] };
                    return (
                      <tr key={p.id}>
                        <td>{idx + 1}</td>
                        <td>
                          <div className="cpm-prod-cell">
                            <span className="cpm-prod-code">{p.product_code ?? `P-${p.product_id}`}</span>
                            <span className="cpm-prod-name">{p.product_name ?? '—'}</span>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any"
                            className={`cpm-input cpm-input-sm ${errors[`qty_${p.id}`] ? 'cpm-input-err' : ''}`}
                            value={d.qty}
                            onChange={e => setDraft(p.id, { qty: e.target.value })}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any"
                            className={`cpm-input cpm-input-sm ${errors[`price_${p.id}`] ? 'cpm-input-err' : ''}`}
                            value={d.target_price}
                            onChange={e => setDraft(p.id, { target_price: e.target.value })}
                            placeholder="0.00"
                          />
                        </td>
                        <td><span className="cpm-curr-pill">{p.currency}</span></td>
                        <td>
                          <ProductAttachmentCell
                            files={d.attachments}
                            onAdd={(files) => setDraft(p.id, { attachments: [...d.attachments, ...files] })}
                            onRemove={(i) => setDraft(p.id, { attachments: d.attachments.filter((_, idx) => idx !== i) })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="cpm-foot">
          <button type="button" className="cpm-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="cpm-btn cpm-btn-primary" onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Procurement'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

function ProductAttachmentCell({
  files, onAdd, onRemove,
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (idx: number) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className="cpm-att-row">
      <button type="button" className="cpm-att-btn cpm-att-btn-sm" onClick={() => ref.current?.click()}>+</button>
      <input
        type="file"
        multiple
        hidden
        ref={ref}
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        onChange={e => {
          if (e.target.files) onAdd(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <div className="cpm-att-list">
        {files.length === 0
          ? <span className="cpm-att-empty">—</span>
          : files.map((f, i) => (
              <span key={i} className="cpm-att-chip">
                <span className="cpm-att-name" title={f.name}>{f.name}</span>
                <button type="button" className="cpm-att-dl" title="Download" onClick={() => downloadFile(f)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </button>
                <button type="button" className="cpm-att-x" title="Remove" onClick={() => onRemove(i)}>×</button>
              </span>
            ))
        }
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.cpm-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.cpm-modal {
  width: min(960px, 100%); max-height: 92vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.cpm-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; color: #fff;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}
.cpm-head-left { display: flex; align-items: center; gap: 12px; }
.cpm-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.cpm-head-title { font-size: 15px; font-weight: 700; }
.cpm-head-sub   { font-size: 11px; opacity: .85; margin-top: 2px; }
.cpm-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.cpm-close:hover { background: rgba(255,255,255,.32); }

.cpm-body { flex: 1; overflow-y: auto; padding: 16px 20px; background: #f0fdf4; }

.cpm-leadbar {
  display: grid; grid-template-columns: repeat(6, 1fr);
  gap: 0; margin-bottom: 14px;
  background: #fff; border: 1px solid #a7f3d0; border-radius: 12px;
  overflow: hidden;
}
.cpm-leadbar-cell {
  padding: 8px 12px;
  border-right: 1px solid #d1fae5;
  background: linear-gradient(180deg, #ecfdf5, #fff);
}
.cpm-leadbar-cell:last-child { border-right: none; }
.cpm-leadbar-label {
  font-size: 9px; font-weight: 800; letter-spacing: .08em;
  color: #047857; text-transform: uppercase;
  margin-bottom: 2px;
}
.cpm-leadbar-val { font-size: 11.5px; font-weight: 700; color: #0f172a; }
.cpm-leadbar-mono { font-family: 'Inter', monospace; color: #047857; letter-spacing: .02em; }

.cpm-status-locked {
  display: inline-flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 12px;
  border: 1.5px solid #fcd34d; border-radius: 8px;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  color: #92400e;
  font-size: 11.5px; font-weight: 700; cursor: not-allowed;
}
.cpm-status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245,158,11,.55);
}

.cpm-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
  background: #fff; border: 1px solid #bbf7d0; border-radius: 12px;
  padding: 14px; margin-bottom: 14px;
}
.cpm-field { display: flex; flex-direction: column; gap: 5px; }
.cpm-field-wide { grid-column: 1 / -1; }
.cpm-label { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; color: #047857; text-transform: uppercase; }
.cpm-input {
  height: 34px; padding: 0 10px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; font-size: 12px; color: #0f172a;
  outline: none; font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
}
.cpm-input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
.cpm-input-err  { border-color: #ef4444; }
.cpm-input-sm   { height: 30px; padding: 0 8px; font-size: 11.5px; width: 100%; }
.cpm-err { color: #dc2626; font-size: 10.5px; }

.cpm-att-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cpm-att-btn {
  height: 32px; padding: 0 12px; border: 1.5px dashed #10b981;
  background: #ecfdf5; color: #047857;
  border-radius: 7px; font-size: 11.5px; font-weight: 700; cursor: pointer;
  font-family: inherit;
}
.cpm-att-btn:hover { background: #d1fae5; }
.cpm-att-btn-sm { height: 28px; padding: 0 8px; }
.cpm-att-list { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.cpm-att-empty { font-size: 10.5px; color: #94a3b8; font-style: italic; }
.cpm-att-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: #ecfdf5; color: #047857;
  border: 1px solid #a7f3d0;
  padding: 3px 6px 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 600;
  max-width: 220px;
}
.cpm-att-name {
  max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cpm-att-dl {
  background: transparent; border: none; cursor: pointer;
  color: #047857; padding: 2px 3px; display: inline-flex; align-items: center;
  border-radius: 4px;
}
.cpm-att-dl:hover { background: rgba(16,185,129,.15); }
.cpm-att-x {
  background: transparent; border: none; cursor: pointer;
  color: #047857; font-weight: 800; font-size: 13px; line-height: 1;
  padding: 0 4px;
  border-radius: 4px;
}
.cpm-att-x:hover { background: rgba(239,68,68,.15); color: #dc2626; }

.cpm-prods {
  background: #fff; border: 1px solid #bbf7d0; border-radius: 12px;
  overflow: hidden;
}
.cpm-prods-head {
  padding: 11px 14px; font-size: 12px; font-weight: 800; color: #047857;
  background: #ecfdf5; border-bottom: 1px solid #bbf7d0;
  text-transform: uppercase; letter-spacing: .06em;
}
.cpm-prods-wrap { overflow-x: auto; }
.cpm-prods-table { width: 100%; border-collapse: collapse; min-width: 720px; }
.cpm-prods-table thead th {
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280;
  background: #f0fdf4; border-bottom: 1px solid #bbf7d0;
  white-space: nowrap;
}
.cpm-prods-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.cpm-prod-cell { display: flex; flex-direction: column; gap: 2px; }
.cpm-prod-code { font-family: 'Inter',monospace; font-size: 10.5px; color: #047857; font-weight: 700; }
.cpm-prod-name { font-size: 12px; color: #0f172a; font-weight: 600; }
.cpm-curr-pill {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  background: #ecfdf5; color: #047857; font-size: 10.5px; font-weight: 700;
  border: 1px solid #a7f3d0;
}

.cpm-foot {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px;
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border-top: 1.5px solid #a7f3d0;
}
.cpm-btn {
  padding: 7px 16px; border-radius: 8px;
  background: #fff; border: 1.5px solid #cbd5e1;
  color: #475569; font-family: inherit;
  font-weight: 700; font-size: 12px; cursor: pointer;
}
.cpm-btn:hover:not(:disabled) { background: #f1f5f9; }
.cpm-btn:disabled { opacity: .6; cursor: not-allowed; }
.cpm-btn-primary {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff; border-color: transparent;
  box-shadow: 0 3px 10px rgba(16,185,129,.30);
}
.cpm-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669, #047857);
  transform: translateY(-1px);
}

/* Dark mode */
[data-bs-theme="dark"] .cpm-modal { background: #14102a; }
[data-bs-theme="dark"] .cpm-body  { background: #1a1538; }
[data-bs-theme="dark"] .cpm-grid,
[data-bs-theme="dark"] .cpm-prods { background: #14102a; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .cpm-prods-head { background: rgba(16,185,129,.12); color: #6ee7b7; border-bottom-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .cpm-prods-table thead th { background: rgba(16,185,129,.10); color: #6ee7b7; border-bottom-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .cpm-prods-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .cpm-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .cpm-prod-code { color: #6ee7b7; }
[data-bs-theme="dark"] .cpm-input {
  background: #1f1845; border-color: rgba(167,139,250,.30); color: #ede9fe;
}
[data-bs-theme="dark"] .cpm-input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.22); }
[data-bs-theme="dark"] .cpm-label { color: #6ee7b7; }
[data-bs-theme="dark"] .cpm-att-btn { background: rgba(16,185,129,.12); color: #6ee7b7; border-color: rgba(16,185,129,.45); }
[data-bs-theme="dark"] .cpm-att-btn:hover { background: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .cpm-att-chip {
  background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .cpm-att-x { color: #6ee7b7; }
[data-bs-theme="dark"] .cpm-curr-pill {
  background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .cpm-foot {
  background: linear-gradient(135deg, #1f1845, #2a2150);
  border-top-color: rgba(16,185,129,.30);
}
[data-bs-theme="dark"] .cpm-btn { background: #1f1845; border-color: rgba(167,139,250,.30); color: #d8b4fe; }
[data-bs-theme="dark"] .cpm-btn:hover:not(:disabled) { background: #2a2150; }

/* Lead bar — dark mode */
[data-bs-theme="dark"] .cpm-leadbar {
  background: #14102a; border-color: rgba(16,185,129,.30);
}
[data-bs-theme="dark"] .cpm-leadbar-cell {
  background: linear-gradient(180deg, rgba(16,185,129,.08), #14102a);
  border-right-color: rgba(16,185,129,.20);
}
[data-bs-theme="dark"] .cpm-leadbar-label { color: #6ee7b7; }
[data-bs-theme="dark"] .cpm-leadbar-val   { color: #ede9fe; }
[data-bs-theme="dark"] .cpm-leadbar-mono  { color: #6ee7b7; }

[data-bs-theme="dark"] .cpm-status-locked {
  background: linear-gradient(135deg, rgba(245,158,11,.14), rgba(245,158,11,.22));
  border-color: rgba(245,158,11,.45); color: #fbbf24;
}

@media (max-width: 1100px) {
  .cpm-leadbar { grid-template-columns: repeat(3, 1fr); }
  .cpm-leadbar-cell:nth-child(3n) { border-right: none; }
}
@media (max-width: 768px) {
  .cpm-grid    { grid-template-columns: 1fr; }
  .cpm-leadbar { grid-template-columns: repeat(2, 1fr); }
  .cpm-leadbar-cell { border-right: none !important; border-bottom: 1px solid #d1fae5; }
}
`;
