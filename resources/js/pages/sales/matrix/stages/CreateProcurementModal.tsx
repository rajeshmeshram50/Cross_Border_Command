import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';

/* ─────────────────────────────────────────────────────────────────────────
 * Create Product Sourcing modal — Sales Matrix → Stage 3 (Required tab).
 *
 *  Cream/amber-themed CBC design.
 *  Three sections inside a single dialog:
 *    1. OPPORTUNITY SUMMARY   — read-only echo of the lead context
 *    2. Basic Information     — TAT + Assign To + frozen "Draft" status
 *                               + Notes/Remarks
 *    3. Sourcing Product Details — dynamic table of products with a
 *       SELECT PRODUCT dropdown per row, QTY + Target Price + Attachment,
 *       plus an "Add Product Row" button to append more.
 *  Persists via POST /procurements (same endpoint as before).
 * ───────────────────────────────────────────────────────────────────── */

export type SelectedProduct = {
  id:           number;            // lead_product_id
  product_id:   number;            // product master id
  product_code: string | null;
  product_name: string | null;
  status:       string | null;
  default_qty:  number | string | null;
  default_target_price: number | string | null;
  currency:     string;
};

type Salesperson = { id: number; name: string; code: string };

type Props = {
  open:    boolean;
  leadId:  number | null;
  /* Extended context from the matrix-detail header — drives the
   * Opportunity Summary 4×2 grid at the top of the modal. */
  leadContext?: {
    oppId?:        string;
    oppDate?:      string;
    customer?:     string;
    customerCode?: string;
    country?:      string;
    assignedTo?:   string;
    status?:       string;
  };
  /* Rows the user kicked off the modal with — either one from a per-row
   * "+ Create" click or multiple from a Group Create. */
  preSelectedProducts: SelectedProduct[];
  /* All other Sourcing Required + no-procurement-yet rows — the
   * SELECT PRODUCT dropdown picks from this pool plus the pre-selected
   * row itself. */
  availableProducts:   SelectedProduct[];
  onClose:   () => void;
  onCreated: () => void;
};

type Draft = {
  /* Local id only — for stable React keys. Negative numbers so it never
   * collides with a real lead_product_id. */
  key:           number;
  lead_product_id: number | null;   // FK into lead_products
  product_id:    number | null;     // mirrored from the selected product
  qty:           string;
  target_price:  string;
  attachments:   File[];
};

let nextKey = -1;
const mkDraft = (sp?: SelectedProduct): Draft => ({
  key:             nextKey--,
  lead_product_id: sp?.id          ?? null,
  product_id:      sp?.product_id  ?? null,
  qty:             sp?.default_qty != null ? String(sp.default_qty) : '',
  target_price:    sp?.default_target_price != null ? String(sp.default_target_price) : '',
  attachments:     [],
});

function formatDdMmYyyy(s: string | undefined): string {
  if (!s) return '—';
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
  open, leadId, leadContext, preSelectedProducts, availableProducts, onClose, onCreated,
}: Props) {
  const toast = useToast();
  const { user } = useAuth();

  const [procDate, setProcDate]      = useState('');
  const [assignTo, setAssignTo]      = useState('');
  const [notes, setNotes]            = useState('');
  const [drafts, setDrafts]          = useState<Draft[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [nextCode, setNextCode]      = useState<string>('PROC-NEW');
  const [submitting, setSubmitting]  = useState(false);
  const [errors, setErrors]          = useState<Record<string, string>>({});

  /* Notes / Remarks length bounds. The field is optional, but once filled it
   * must sit within [min, max] characters. Max is also enforced as a hard
   * maxLength on the textarea. */
  const NOTES_MIN = 5;
  const NOTES_MAX = 250;
  const notesError = (() => {
    const t = notes.trim();
    if (t.length === 0)         return '';
    if (t.length < NOTES_MIN)   return `Notes must be at least ${NOTES_MIN} characters`;
    if (notes.length > NOTES_MAX) return `Notes must be ${NOTES_MAX} characters or fewer`;
    return '';
  })();

  /* Reset on every open */
  useEffect(() => {
    if (!open) return;
    setProcDate('');
    setAssignTo('');
    setNotes('');
    setErrors({});
    setDrafts(preSelectedProducts.length > 0 ? preSelectedProducts.map(mkDraft) : [mkDraft()]);

    api.get<{ status: boolean; data: Salesperson[] }>('/sales/leads/salespeople')
      .then(({ data }) => setSalespeople(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load assignable users'));
    api.get<{ status: boolean; data: { next_code: string } }>('/procurements/next-number')
      .then(({ data }) => setNextCode(data.data?.next_code ?? 'PROC-NEW'))
      .catch(() => { /* silent — preview only */ });
  }, [open, preSelectedProducts, toast]);

  const spOptions = useMemo(
    () => salespeople.map(sp => ({ value: String(sp.id), label: `${sp.code} · ${sp.name}` })),
    [salespeople],
  );

  /* Build the SELECT PRODUCT pool — pre-selected + available, minus rows
   * already picked in OTHER drafts (so the same product can't appear
   * twice in this procurement). */
  const productPool: SelectedProduct[] = useMemo(() => {
    const seen = new Set<number>();
    const out: SelectedProduct[] = [];
    for (const p of [...preSelectedProducts, ...availableProducts]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [preSelectedProducts, availableProducts]);

  const productById = useMemo(() => {
    const m = new Map<number, SelectedProduct>();
    for (const p of productPool) m.set(p.id, p);
    return m;
  }, [productPool]);

  const usedLpIds = useMemo(
    () => new Set(drafts.map(d => d.lead_product_id).filter(Boolean) as number[]),
    [drafts],
  );

  const setDraft = (key: number, patch: Partial<Draft>) => {
    setDrafts(prev => prev.map(d => d.key === key ? { ...d, ...patch } : d));
  };

  const addRow    = () => setDrafts(prev => [...prev, mkDraft()]);
  const removeRow = (key: number) => setDrafts(prev => prev.length > 1 ? prev.filter(d => d.key !== key) : prev);

  /* When the user picks a different product from the dropdown, refresh
   * the row's product_id + default qty / price (only if empty so they
   * don't lose typed values). */
  const onProductPick = (key: number, lpId: number) => {
    const sp = productById.get(lpId);
    setDraft(key, {
      lead_product_id: lpId,
      product_id:      sp?.product_id ?? null,
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!procDate) next.procDate = 'Required';
    if (!assignTo) next.assignTo = 'Required';
    if (notesError) next.notes = notesError;
    drafts.forEach(d => {
      if (!d.lead_product_id) next[`prod_${d.key}`]  = 'Pick a product';
      if (!d.qty || Number(d.qty) <= 0)               next[`qty_${d.key}`]  = 'Required';
      if (!d.target_price || Number(d.target_price) <= 0) next[`price_${d.key}`] = 'Required';
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet first');
      return;
    }
    if (drafts.length === 0) {
      toast.warning('Add a product', 'At least one product is required');
      return;
    }
    if (!validate()) {
      toast.warning('Fill required fields', 'TAT, Assign To, product, qty and target price are mandatory');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('lead_id', String(leadId));
      fd.append('procurement_date', procDate);
      fd.append('assign_id', assignTo);
      fd.append('status', 'inprogress');
      if (notes.trim()) fd.append('notes', notes.trim());

      drafts.forEach((d, idx) => {
        fd.append(`products[${idx}][lead_product_id]`, String(d.lead_product_id));
        fd.append(`products[${idx}][product_id]`,      String(d.product_id));
        fd.append(`products[${idx}][qty]`,             String(d.qty));
        fd.append(`products[${idx}][target_price]`,    String(d.target_price));
        d.attachments.forEach((f, fi) => fd.append(`products[${idx}][attachment][${fi}]`, f));
      });

      await api.post('/procurements', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Procurement created', `${drafts.length} product(s) added`);
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

  /* Compute first selected product for the OPP SUMMARY "Product" cell. Must
   * stay ABOVE the `open` early-return so the hook count never changes
   * between renders (rules of hooks). */
  const firstProductName = useMemo(() => {
    const first = drafts.find(d => d.lead_product_id);
    if (!first?.lead_product_id) return '—';
    return productById.get(first.lead_product_id)?.product_name ?? '—';
  }, [drafts, productById]);

  if (!open) return null;

  return createPortal((
    <div className="cps-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="cps-modal" onClick={(e) => e.stopPropagation()}>
        {/* Title row */}
        <div className="cps-title-row">
          <div className="cps-title-left">
            <span className="cps-title-ico">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
              </svg>
            </span>
            <h5 className="cps-title">Create Product Sourcing</h5>
          </div>
          <button className="cps-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="cps-body">
          {/* ─── SECTION 1 — OPPORTUNITY SUMMARY ─── */}
          <div className="cps-section">
            <div className="cps-section-head">
              <span className="cps-section-ico cps-section-ico-amber">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
                </svg>
              </span>
              <span className="cps-section-title">OPPORTUNITY SUMMARY</span>
            </div>
            <div className="cps-opp-grid">
              <Field label="OPP ID"        value={leadContext?.oppId ?? '—'}                tone="amber" mono />
              <Field label="CUSTOMER"      value={leadContext?.customer ?? '—'}             bold />
              <Field label="PRODUCT"       value={firstProductName}                          bold />
              <Field label="COUNTRY"       value={leadContext?.country ?? '—'}              bold />
              <Field label="SOURCE"        value="Offline" />
              <Field label="ASSIGNED TO"   value={leadContext?.assignedTo ?? 'Assigned User'} />
              <Field label="DATE"          value={formatDdMmYyyy(leadContext?.oppDate)} />
              <Field label="STATUS"        value={<StatusPill text={leadContext?.status ?? 'Qualified'} />} />
            </div>
          </div>

          {/* ─── SECTION 2 — BASIC INFORMATION ─── */}
          <div className="cps-section">
            <div className="cps-section-head">
              <span className="cps-section-ico cps-section-ico-amber">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
                </svg>
              </span>
              <span className="cps-section-title">Basic Information</span>
              <span className="cps-section-hint">— Core details for this sourcing request</span>
            </div>

            <div className="cps-basic-grid">
              <div className="cps-field">
                <label className="cps-flabel">PROCUREMENT TAT <span className="cps-req">*</span></label>
                <MasterDatePicker
                  value={procDate}
                  onChange={setProcDate}
                  invalid={!!errors.procDate}
                  placeholder="dd-mm-yyyy"
                />
              </div>
              <div className="cps-field">
                <label className="cps-flabel">ASSIGN TO <span className="cps-req">*</span></label>
                <MasterSelect
                  value={assignTo}
                  onChange={(v) => setAssignTo(String(v))}
                  options={spOptions}
                  placeholder="Assigned User"
                />
              </div>
              <div className="cps-field">
                <label className="cps-flabel">PROCUREMENT STATUS</label>
                <div className="cps-status-locked" title="Status starts as Draft and updates via the procurement lifecycle">
                  <span className="cps-status-dot" />
                  <div>
                    <div className="cps-status-main">Draft — System Controlled</div>
                    <div className="cps-status-sub">⊙ Auto-managed by lifecycle</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="cps-field cps-field-full">
              <label className="cps-flabel">NOTES / REMARKS</label>
              <textarea
                className={`cps-textarea ${notesError ? 'cps-input-err' : ''}`}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={`Add any notes or remarks (${NOTES_MIN}–${NOTES_MAX} characters)…`}
                rows={3}
                maxLength={NOTES_MAX}
              />
              <div className="cps-notes-meta">
                <span className="cps-notes-err">{notesError}</span>
                <span className="cps-notes-count">{notes.length}/{NOTES_MAX}</span>
              </div>
            </div>
          </div>

          {/* ─── SECTION 3 — SOURCING PRODUCT DETAILS ─── */}
          <div className="cps-section">
            <div className="cps-section-head">
              <span className="cps-section-ico cps-section-ico-amber">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              <span className="cps-section-title">Sourcing Product Details</span>
              <span className="cps-section-count">{drafts.length}</span>
              <span className="cps-section-hint">— Add products with qty and target price</span>
            </div>

            <div className="cps-prods-wrap">
              <table className="cps-prods-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>SR</th>
                    <th>SELECT PRODUCT</th>
                    <th style={{ width: 90 }}>STATUS</th>
                    <th style={{ width: 130 }}>QTY</th>
                    <th style={{ width: 140 }}>TARGET PRICE</th>
                    <th style={{ width: 110 }}>ATTACH</th>
                    <th style={{ width: 90 }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, idx) => {
                    const sel = d.lead_product_id != null ? productById.get(d.lead_product_id) : undefined;
                    const statusLc = (sel?.status ?? '').toLowerCase();
                    const opts = productPool
                      .filter(p => p.id === d.lead_product_id || !usedLpIds.has(p.id))
                      .map(p => ({ value: String(p.id), label: `(${p.product_code ?? `P-${p.product_id}`}) ${p.product_name ?? ''}`.trim() }));
                    return (
                      <tr key={d.key}>
                        <td><span className="cps-sr">{idx + 1}</span></td>
                        <td>
                          <MasterSelect
                            value={d.lead_product_id != null ? String(d.lead_product_id) : ''}
                            onChange={(v) => onProductPick(d.key, Number(v))}
                            options={opts}
                            placeholder="Select Product"
                          />
                        </td>
                        <td>
                          {sel ? (
                            <span className={`cps-status-pill ${statusLc === 'active' ? 'cps-st-active' : statusLc === 'draft' ? 'cps-st-draft' : 'cps-st-inactive'}`}>
                              ● {statusLc || '—'}
                            </span>
                          ) : <span className="cps-muted">—</span>}
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any"
                            className={`cps-row-input ${errors[`qty_${d.key}`] ? 'cps-input-err' : ''}`}
                            value={d.qty}
                            onChange={e => setDraft(d.key, { qty: e.target.value })}
                            placeholder="Qty"
                          />
                        </td>
                        <td>
                          <div className="cps-price-wrap">
                            <span className="cps-price-prefix">$</span>
                            <input
                              type="number" min="0" step="any"
                              className={`cps-row-input cps-row-price ${errors[`price_${d.key}`] ? 'cps-input-err' : ''}`}
                              value={d.target_price}
                              onChange={e => setDraft(d.key, { target_price: e.target.value })}
                              placeholder="Price"
                            />
                          </div>
                        </td>
                        <td>
                          <RowAttach
                            files={d.attachments}
                            onAdd={(files) => setDraft(d.key, { attachments: [...d.attachments, ...files] })}
                            onRemove={(i) => setDraft(d.key, { attachments: d.attachments.filter((_, idx) => idx !== i) })}
                          />
                        </td>
                        <td>
                          {drafts.length > 1 ? (
                            <button type="button" className="cps-row-del" onClick={() => removeRow(d.key)} title="Remove row">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          ) : (
                            <button type="button" className="cps-row-add" onClick={addRow} title="Add row">
                              + Add
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="cps-addrow-wrap">
                <button type="button" className="cps-addrow-btn" onClick={addRow}>+ Add Product Row</button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cps-foot">
          <div className="cps-foot-note">
            <span className="cps-foot-dot" />
            Saving will generate a unique PROC ID
            <span className="cps-foot-next">{nextCode}</span>
            <span className="cps-foot-author"> · by {user?.name ?? 'You'}</span>
          </div>
          <div className="cps-foot-actions">
            <button type="button" className="cps-btn cps-btn-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="cps-btn cps-btn-primary" onClick={() => void onSubmit()} disabled={submitting}>
              <span className="cps-btn-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              {submitting ? 'Saving…' : 'Save Product Sourcing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function Field({ label, value, tone, mono, bold }: { label: string; value: React.ReactNode; tone?: 'amber'; mono?: boolean; bold?: boolean }) {
  return (
    <div className="cps-opp-cell">
      <div className="cps-opp-label">{label}</div>
      <div className={`cps-opp-val ${tone === 'amber' ? 'cps-opp-val-amber' : ''} ${mono ? 'cps-mono' : ''} ${bold ? 'cps-bold' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ text }: { text: string }) {
  const t = text.toLowerCase();
  const cls = t === 'qualified' ? 'cps-stp-q' : t === 'disqualified' ? 'cps-stp-d' : 'cps-stp-c';
  return <span className={`cps-stp ${cls}`}>● {text}</span>;
}

function RowAttach({ files, onAdd, onRemove }: { files: File[]; onAdd: (f: File[]) => void; onRemove: (i: number) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className="cps-attach-cell">
      <button type="button" className="cps-attach-btn" onClick={() => ref.current?.click()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        Attach
      </button>
      <input
        type="file" multiple hidden ref={ref}
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        onChange={e => {
          if (e.target.files) onAdd(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <div className="cps-attach-chips">
          {files.map((f, i) => (
            <span key={i} className="cps-attach-chip" title={f.name}>
              <span className="cps-attach-name">{f.name}</span>
              <button type="button" className="cps-chip-dl" onClick={() => downloadFile(f)} title="Download">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <button type="button" className="cps-chip-x" onClick={() => onRemove(i)} title="Remove">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const SCOPED_CSS = `
.cps-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.cps-modal {
  width: min(1180px, 100%); max-height: 92vh;
  background: #fffef9;
  border-radius: 18px;
  border: 2px solid #fde68a;
  box-shadow: 0 18px 56px rgba(15,23,42,.30);
  overflow: hidden; display: flex; flex-direction: column;
}

/* ─── Title row ─── */
.cps-title-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  background: #fffef9;
  border-bottom: 1px solid #fef3c7;
}
.cps-title-left { display: flex; align-items: center; gap: 10px; }
.cps-title-ico {
  width: 30px; height: 30px; border-radius: 50%;
  background: #fef3c7;
  display: inline-flex; align-items: center; justify-content: center;
  color: #d97706;
}
.cps-title { margin: 0; font-size: 16px; font-weight: 700; color: #4c1d95; }
.cps-close {
  width: 30px; height: 30px;
  background: #fef3c7; border: none; color: #b45309;
  border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.cps-close:hover { background: #fde68a; }

.cps-body { flex: 1; overflow-y: auto; padding: 18px 22px; background: #fffef9; }

/* ─── Section card ─── */
.cps-section {
  background: linear-gradient(180deg, #fef9c3, #fffef9);
  border: 1.5px solid #fde68a;
  border-radius: 14px;
  margin-bottom: 14px;
  overflow: hidden;
}
.cps-section-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 16px;
  background: linear-gradient(180deg, #fef3c7, #fef9c3);
  border-bottom: 1px solid #fde68a;
  font-size: 12px; color: #78350f;
}
.cps-section-ico {
  width: 20px; height: 20px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
}
.cps-section-ico-amber { background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff; }
.cps-section-title { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #78350f; text-transform: uppercase; }
.cps-section-hint  { font-size: 11px; font-weight: 500; color: #b45309; font-style: italic; }
.cps-section-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
  background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff;
  font-size: 10.5px; font-weight: 700;
}

/* ─── OPP grid (4×2) ─── */
.cps-opp-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 0; background: #fff;
}
.cps-opp-cell {
  padding: 12px 16px;
  border-right: 1px solid #fef3c7;
  border-bottom: 1px solid #fef3c7;
}
.cps-opp-cell:nth-child(4n)   { border-right: none; }
.cps-opp-cell:nth-last-child(-n+4) { border-bottom: none; }
.cps-opp-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em;
  color: #b45309; margin-bottom: 4px; text-transform: uppercase;
}
.cps-opp-val { font-size: 12.5px; color: #1e293b; font-weight: 500; }
.cps-opp-val-amber { color: #d97706; }
.cps-mono { font-family: 'Inter', monospace; font-weight: 700; }
.cps-bold { font-weight: 700; color: #0f172a; }

/* Status pill */
.cps-stp {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; border: 1.5px solid;
}
.cps-stp-q { background: #fef3c7; color: #b45309; border-color: #fcd34d; }
.cps-stp-d { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
.cps-stp-c { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }

/* ─── Basic Information grid ─── */
.cps-basic-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 14px; padding: 14px 16px;
  background: #fff;
}
.cps-field { display: flex; flex-direction: column; gap: 5px; }
.cps-field-full { padding: 0 16px 16px; background: #fff; }
.cps-flabel { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; color: #b45309; text-transform: uppercase; }
.cps-req { color: #dc2626; }

.cps-input {
  height: 38px; padding: 7px 12px;
  border: 1.5px solid #94a3b8; border-radius: 10px;
  background: #fff; font-size: 13px; font-weight: 500; color: #1e293b;
  outline: none; font-family: inherit;
  transition: border-color .18s, box-shadow .18s;
}
.cps-input:focus { border-color: #6691e7; box-shadow: 0 0 0 3px rgba(102,145,231,.18); }
.cps-input-err   { border-color: #ef4444 !important; }

.cps-textarea {
  padding: 10px 12px;
  border: 1.5px solid #fde68a; border-radius: 8px;
  background: #fffef9; font-size: 12.5px; color: #1e293b;
  outline: none; font-family: inherit;
  width: 100%; resize: vertical; min-height: 60px;
  transition: border-color .15s, box-shadow .15s;
}
.cps-textarea:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.16); }
.cps-notes-meta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-top: 4px; min-height: 15px;
}
.cps-notes-err   { font-size: 11.5px; font-weight: 600; color: #ef4444; }
.cps-notes-count { font-size: 10.5px; font-weight: 600; color: #94a3b8; margin-left: auto; }

/* Status locked card */
.cps-status-locked {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  border: 1.5px solid #fcd34d; border-radius: 10px;
  background: linear-gradient(180deg, #fef9c3, #fef3c7);
  color: #92400e;
  cursor: not-allowed;
}
.cps-status-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245,158,11,.55);
  flex-shrink: 0;
}
.cps-status-main { font-size: 12px; font-weight: 600; color: #78350f; }
.cps-status-sub  { font-size: 10px;   font-weight: 600; color: #b45309; margin-top: 1px; }

/* ─── Sourcing Product Details ─── */
.cps-prods-wrap { background: #fff; }
.cps-prods-table { width: 100%; border-collapse: collapse; min-width: 760px; }
.cps-prods-table thead th {
  padding: 10px 12px; text-align: left;
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; color: #78350f;
  background: linear-gradient(180deg, #fef3c7, #fef9c3);
  border-bottom: 1px solid #fde68a; white-space: nowrap;
}
.cps-prods-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #fef3c7; vertical-align: middle;
}
.cps-prods-table tbody tr:last-child td { border-bottom: none; }

.cps-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: #fef3c7; color: #b45309;
  font-size: 11px; font-weight: 700;
}

.cps-status-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.cps-st-active   { background: #d1fae5; color: #047857; }
.cps-st-inactive { background: #fee2e2; color: #dc2626; }
.cps-st-draft    { background: #fef3c7; color: #b45309; }
.cps-muted { color: #94a3b8; font-style: italic; }

.cps-row-input {
  width: 100%; height: 30px; padding: 0 10px;
  border: 1.5px solid #fde68a; border-radius: 8px;
  background: #fffef9; font-size: 12px; color: #1e293b;
  outline: none; font-family: inherit;
}
.cps-row-input:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.16); }
.cps-price-wrap { position: relative; }
.cps-price-prefix {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  font-size: 12px; color: #b45309; font-weight: 700;
}
.cps-row-price { padding-left: 22px; }

/* Attach */
.cps-attach-cell { display: flex; flex-direction: column; gap: 5px; }
.cps-attach-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  border: 1.5px solid #fde68a; border-radius: 7px;
  background: #fffef9; color: #b45309;
  font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: all .12s;
}
.cps-attach-btn:hover { background: #fef3c7; border-color: #fcd34d; }
.cps-attach-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.cps-attach-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 5px 2px 8px; border-radius: 999px;
  background: #fef3c7; color: #b45309; border: 1px solid #fde68a;
  font-size: 10px; font-weight: 600;
  max-width: 140px;
}
.cps-attach-name { max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cps-chip-dl, .cps-chip-x {
  background: transparent; border: none; cursor: pointer;
  color: #b45309; padding: 1px 2px; line-height: 1;
  display: inline-flex; align-items: center; border-radius: 3px;
}
.cps-chip-dl:hover { background: rgba(217,119,6,.18); }
.cps-chip-x { font-weight: 700; font-size: 12px; }
.cps-chip-x:hover { background: rgba(239,68,68,.18); color: #dc2626; }

/* Row add / del */
.cps-row-add {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 6px 14px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff; font-family: inherit;
  font-size: 11px; font-weight: 700;
  border-radius: 7px;
  box-shadow: 0 2px 6px rgba(217,119,6,.30);
}
.cps-row-add:hover { background: linear-gradient(135deg, #d97706, #b45309); transform: translateY(-1px); }
.cps-row-del {
  background: transparent; border: 1.5px solid #fca5a5;
  color: #dc2626; padding: 5px 8px; border-radius: 7px;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.cps-row-del:hover { background: #fee2e2; }

.cps-addrow-wrap { padding: 12px 16px; background: #fffef9; border-top: 1px dashed #fde68a; }
.cps-addrow-btn {
  padding: 8px 16px;
  border: 1.5px dashed #d97706; border-radius: 8px;
  background: transparent; color: #b45309;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .12s;
}
.cps-addrow-btn:hover { background: #fef3c7; border-color: #b45309; }

/* ─── Footer ─── */
.cps-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; flex-wrap: wrap; gap: 10px;
  background: #fffef9;
  border-top: 1px solid #fef3c7;
}
.cps-foot-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #b45309; font-weight: 600;
}
.cps-foot-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 5px rgba(245,158,11,.55);
}
.cps-foot-next   { font-family: 'Inter',monospace; font-weight: 700; color: #d97706; padding: 0 6px; }
.cps-foot-author { color: #94a3b8; font-weight: 500; }
.cps-foot-actions { display: flex; gap: 10px; }

.cps-btn {
  padding: 9px 22px; border-radius: 8px;
  font-family: inherit; font-weight: 600; font-size: 12px; cursor: pointer;
  border: 1.5px solid transparent;
  min-width: 130px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: all .15s;
}
.cps-btn-cancel {
  background: #fff; border-color: #cbd5e1; color: #475569;
}
.cps-btn-cancel:hover:not(:disabled) { background: #f1f5f9; }
.cps-btn-primary {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  box-shadow: 0 4px 12px rgba(217,119,6,.35);
}
.cps-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #d97706, #b45309);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(217,119,6,.50);
}
.cps-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.cps-btn-ico {
  width: 17px; height: 17px; border-radius: 50%;
  background: rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
}

/* Dark mode */
[data-bs-theme="dark"] .cps-modal { background: #1a1538; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .cps-title-row { background: #1a1538; border-bottom-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-title { color: #c4b5fd; }
[data-bs-theme="dark"] .cps-title-ico { background: rgba(252,191,36,.20); color: #fde68a; }
[data-bs-theme="dark"] .cps-close { background: rgba(252,191,36,.20); color: #fde68a; }
[data-bs-theme="dark"] .cps-close:hover { background: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-body { background: #1a1538; }
[data-bs-theme="dark"] .cps-section { background: rgba(252,191,36,.06); border-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-section-head { background: rgba(252,191,36,.10); border-bottom-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-section-title, [data-bs-theme="dark"] .cps-section-hint { color: #fde68a; }
[data-bs-theme="dark"] .cps-opp-grid { background: #14102a; }
[data-bs-theme="dark"] .cps-opp-cell { border-right-color: rgba(252,191,36,.20); border-bottom-color: rgba(252,191,36,.20); }
[data-bs-theme="dark"] .cps-opp-label { color: #fde68a; }
[data-bs-theme="dark"] .cps-opp-val { color: #ede9fe; }
[data-bs-theme="dark"] .cps-opp-val-amber { color: #fbbf24; }
[data-bs-theme="dark"] .cps-bold { color: #ede9fe; }
[data-bs-theme="dark"] .cps-basic-grid, [data-bs-theme="dark"] .cps-field-full { background: #14102a; }
[data-bs-theme="dark"] .cps-flabel { color: #fde68a; }
[data-bs-theme="dark"] .cps-input, [data-bs-theme="dark"] .cps-textarea, [data-bs-theme="dark"] .cps-row-input {
  background: rgba(252,191,36,.06); border-color: rgba(252,191,36,.30); color: #ede9fe;
}
[data-bs-theme="dark"] .cps-status-locked { background: rgba(252,191,36,.14); border-color: rgba(252,191,36,.40); color: #fde68a; }
[data-bs-theme="dark"] .cps-status-main { color: #fde68a; }
[data-bs-theme="dark"] .cps-status-sub  { color: rgba(252,191,36,.60); }
[data-bs-theme="dark"] .cps-prods-wrap { background: #14102a; }
[data-bs-theme="dark"] .cps-prods-table thead th { background: rgba(252,191,36,.14); color: #fde68a; border-bottom-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-prods-table tbody td { color: #ede9fe; border-bottom-color: rgba(252,191,36,.18); }
[data-bs-theme="dark"] .cps-sr { background: rgba(252,191,36,.18); color: #fde68a; }
[data-bs-theme="dark"] .cps-attach-btn { background: rgba(252,191,36,.10); border-color: rgba(252,191,36,.40); color: #fde68a; }
[data-bs-theme="dark"] .cps-attach-btn:hover { background: rgba(252,191,36,.20); }
[data-bs-theme="dark"] .cps-attach-chip { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .cps-chip-dl, [data-bs-theme="dark"] .cps-chip-x { color: #fde68a; }
[data-bs-theme="dark"] .cps-addrow-wrap { background: #1a1538; border-top-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-addrow-btn { color: #fde68a; border-color: rgba(252,191,36,.45); }
[data-bs-theme="dark"] .cps-addrow-btn:hover { background: rgba(252,191,36,.12); }
[data-bs-theme="dark"] .cps-foot { background: #1a1538; border-top-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cps-foot-note { color: #fde68a; }
[data-bs-theme="dark"] .cps-btn-cancel { background: #1f1845; border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .cps-btn-cancel:hover:not(:disabled) { background: #2a2150; }
/* Status badges — translucent fills so they read on the dark surface instead
   of sitting as bright light pills. */
[data-bs-theme="dark"] .cps-st-active   { background: rgba(34,197,94,.18);  color: #86efac; }
[data-bs-theme="dark"] .cps-st-inactive { background: rgba(239,68,68,.18);  color: #fca5a5; }
[data-bs-theme="dark"] .cps-st-draft    { background: rgba(245,158,11,.18); color: #fcd34d; }
/* Delete (remove row) button — tinted border/icon + a dark-friendly hover
   instead of the bright #fee2e2 wash. */
[data-bs-theme="dark"] .cps-row-del        { border-color: rgba(239,68,68,.45); color: #fca5a5; }
[data-bs-theme="dark"] .cps-row-del:hover  { background: rgba(239,68,68,.20); border-color: rgba(239,68,68,.65); }

@media (max-width: 900px) {
  .cps-opp-grid, .cps-basic-grid { grid-template-columns: repeat(2, 1fr); }
  .cps-opp-cell:nth-child(2n)        { border-right: none; }
  .cps-opp-cell:nth-child(2n+1)      { border-right: 1px solid #fef3c7; }
  .cps-opp-cell:nth-last-child(-n+2) { border-bottom: none; }
}
@media (max-width: 580px) {
  .cps-opp-grid, .cps-basic-grid { grid-template-columns: 1fr; }
}
`;
