import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { useAuth } from '../../../../../contexts/AuthContext';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';

/* Target Price is a PROCUREMENT cost — what we pay the vendor — and it is
 * sourced from the Product Directory, whose base_price / total_price are INR
 * (the products table carries no currency column at all). So the prefix is
 * always the Rupee.
 *
 * It used to render the lead product's `currency`, but that is the SELL-side
 * currency the customer is quoted in — a lead quoted in CNY made the buy-side
 * target price read "¥ 223432.00" even though the figure is Rupees. Different
 * concept, wrong symbol. */
const PROCUREMENT_CURRENCY_SYMBOL = '₹';

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
  // Target Price starts BLANK — it's the procurement (buy-side) target the user
  // enters here, NOT the shared/sell price. Pre-filling it from the lead's
  // shared price was misleading (QA #119). Still mandatory (validated on save).
  target_price:    '',
  attachments:     [],
});

/* Numeric field validator — shared by the live per-row errors and the submit
 * validation. Returns '' when the value is empty or a valid positive number,
 * else a human message. Empty is treated as valid here; the "required" case is
 * enforced separately at submit time. Keeping the typed value (rather than
 * letting a type=number input silently blank it) is what lets us SHOW the
 * message instead of wiping the field. */
function numError(raw: string): string {
  if (raw.trim() === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a valid number';
  if (n <= 0)              return 'Must be greater than 0';
  return '';
}

function formatDdMmYyyy(s: string | undefined): string {
  if (!s) return '—';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatDmy(d);
}

/* Show the full country name. The lead carries an ISO-2 code (e.g. "IN");
   Intl.DisplayNames maps it to "India" (covers every ISO code, no lookup map).
   A value that's already a name is shown as-is. */
function countryLabel(v: string | undefined): string {
  if (!v) return '—';
  const s = String(v).trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(s.toUpperCase()) || s.toUpperCase();
    } catch { return s.toUpperCase(); }
  }
  return s;
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

  // Procurement TAT can't be in the past — disable earlier dates in the picker
  // so a "wrong" (past) date can't be chosen in the first place.
  const todayStr = new Date().toISOString().slice(0, 10);

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
    // Reset ONLY when the modal opens — NOT on every render. `toast` and
    // `preSelectedProducts` were in the deps before, so showing a validation
    // toast (or any parent re-render that recreated the props) re-ran this
    // effect and wiped everything the user had typed. Gating on `open` alone
    // keeps the typed data intact through validation + re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  /** Validate and return the error map (also pushed into state for inline
   *  rendering). Returning the map lets onSubmit build an accurate summary
   *  toast instead of always naming every field. */
  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!procDate) next.procDate = 'Required';
    if (!assignTo) next.assignTo = 'Required';
    if (notesError) next.notes = notesError;
    drafts.forEach(d => {
      if (!d.lead_product_id) next[`prod_${d.key}`] = 'Pick a product';
      const qtyMsg   = d.qty.trim() === ''          ? 'Qty is required'   : numError(d.qty);
      const priceMsg = d.target_price.trim() === '' ? 'Price is required' : numError(d.target_price);
      if (qtyMsg)   next[`qty_${d.key}`]   = qtyMsg;
      if (priceMsg) next[`price_${d.key}`] = priceMsg;
    });
    setErrors(next);
    return next;
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
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      // Name only the fields that actually failed, so the alert can't blame
      // TAT (or anything else) when that field is fine. Previously this was a
      // fixed "TAT, Assign To, …" string that misfired on a bad qty/price.
      const labels: string[] = [];
      if (errs.procDate) labels.push('TAT');
      if (errs.assignTo) labels.push('Assign To');
      if (Object.keys(errs).some(k => k.startsWith('prod_')))  labels.push('Product');
      if (Object.keys(errs).some(k => k.startsWith('qty_')))   labels.push('Qty');
      if (Object.keys(errs).some(k => k.startsWith('price_'))) labels.push('Target price');
      if (errs.notes) labels.push('Notes');
      toast.warning('Fix required fields', `Please correct: ${labels.join(', ')}.`);
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
      // Attachment errors come back as raw field paths ("products.0.attachment.0
      // has an unexpected file signature… must not be greater than 5120
      // kilobytes"). Surface a clean, actionable message instead of leaking the
      // internal field path / size wording.
      const entries = fieldErrs ? Object.entries(fieldErrs) : [];
      const isAttachErr = entries.some(([k, v]) =>
        k.includes('attachment') || (v ?? []).some(m => /file signature|kilobytes|mimes|must be a file|must be an image|jpg|jpeg|png|pdf|greater than 5120/i.test(m)));
      if (isAttachErr) {
        toast.error('File not supported', 'Please attach only JPG, PNG or PDF files (up to 5 MB).');
      } else {
        const msg = fieldErrs ? Object.values(fieldErrs).flat().join(' ') : (data?.message ?? 'Could not create procurement');
        toast.error('Create failed', msg);
      }
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

  // Body scroll lock — keep the page behind the modal from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return createPortal((
    <div className="cps-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <style>{SCOPED_CSS}</style>
      <div className="cps-modal" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        {/* Save lock — while the procurement is saving, blanket the whole modal
            so no field or button stays editable (QA #120). */}
        {submitting && (
          <div className="cps-save-lock" role="status" aria-live="polite">
            <span className="cps-save-spin" />
            <span className="cps-save-lock-txt">Saving…</span>
          </div>
        )}
        {/* Title row */}
        <div className="cps-title-row">
          <div className="cps-title-left">
            <span className="cps-title-ico">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </span>
            <div className="cps-title-text">
              <h5 className="cps-title">Create Procurement</h5>
              <div className="cps-subtitle">Define products, quantities and target pricing for this procurement case.</div>
            </div>
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
              <Field label="COUNTRY"       value={countryLabel(leadContext?.country)}        bold />
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
            </div>

            <div className="cps-basic-grid">
              <div className="cps-field">
                <label className="cps-flabel">PROCUREMENT ID</label>
                <div className="cps-procid" title="Auto-generated on save">
                  <span className="cps-procid-val">{nextCode}</span>
                  <span className="cps-procid-auto">AUTO</span>
                </div>
              </div>
              <div className="cps-field">
                <label className="cps-flabel">PROCUREMENT TAT <span className="cps-req">*</span></label>
                <MasterDatePicker
                  value={procDate}
                  onChange={setProcDate}
                  invalid={!!errors.procDate}
                  minDate={todayStr}
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
                  invalid={!!errors.assignTo}
                />
              </div>
              <div className="cps-field">
                <label className="cps-flabel">PROCUREMENT STATUS</label>
                <div className="cps-status-locked" title="Status starts as In Progress and updates via the procurement lifecycle">
                  <span className="cps-status-dot" />
                  <div className="cps-status-main">In Progress</div>
                </div>
              </div>
            </div>
          </div>

          {/* ─── SECTION 3 — SOURCING PRODUCT DETAILS ─── */}
          <div className="cps-section">
            <div className="cps-section-head">
              <span className="cps-section-ico cps-section-ico-amber">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </span>
              <span className="cps-section-title">Product Details</span>
              <span className="cps-section-count">{drafts.length} product{drafts.length === 1 ? '' : 's'}</span>
            </div>

            <div className="cps-prods-wrap">
              <table className="cps-prods-table">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>SR. NO</th>
                    {/* Pinned width: every other column is fixed, so an
                        unbounded PRODUCT NAME let a long name stretch the table
                        past the modal and push Target Price / Attachment /
                        Action out of view. Bounding it also finally gives
                        MasterSelect's own label ellipsis something to bite on. */}
                    <th style={{ width: 300 }}>PRODUCT NAME</th>
                    <th style={{ width: 130 }}>QUANTITY</th>
                    <th style={{ width: 150 }}>TARGET PRICE</th>
                    <th style={{ width: 160 }}>ATTACHMENT</th>
                    <th style={{ width: 90 }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, idx) => {
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
                          {(() => {
                            const qtyMsg = errors[`qty_${d.key}`] || numError(d.qty);
                            return (
                              <>
                                <input
                                  type="text" inputMode="decimal"
                                  className={`cps-row-input ${qtyMsg ? 'cps-input-err' : ''}`}
                                  value={d.qty}
                                  // Strip the minus sign on input — qty can't be
                                  // negative, so "-5" auto-converts to "5" rather
                                  // than failing the "> 0" check and blocking submit.
                                  onChange={e => setDraft(d.key, { qty: e.target.value.replace(/[^0-9.]/g, '') })}
                                  placeholder="Qty"
                                />
                                {qtyMsg && <div className="cps-row-err">{qtyMsg}</div>}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const priceMsg = errors[`price_${d.key}`] || numError(d.target_price);
                            return (
                              <>
                                <div className="cps-price-wrap">
                                  <span className="cps-price-prefix">{PROCUREMENT_CURRENCY_SYMBOL}</span>
                                  <input
                                    type="text" inputMode="decimal"
                                    className={`cps-row-input cps-row-price ${priceMsg ? 'cps-input-err' : ''}`}
                                    value={d.target_price}
                                    // Strip the minus sign on input — price can't be
                                    // negative, so "-5" auto-converts to "5" rather
                                    // than failing the "> 0" check and blocking submit.
                                    onChange={e => setDraft(d.key, { target_price: e.target.value.replace(/[^0-9.]/g, '') })}
                                    placeholder="Price"
                                  />
                                </div>
                                {priceMsg && <div className="cps-row-err">{priceMsg}</div>}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          <RowAttach
                            files={d.attachments}
                            onAdd={(files) => {
                              // Only JPG / PNG / PDF, max 5 MB (matches the backend
                              // mimes + 5120 KB rule). Reject the rest up front with
                              // a clear message instead of failing on Save.
                              const ok: File[] = [];
                              let badType = false, tooBig = false;
                              for (const f of files) {
                                const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
                                if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) { badType = true; continue; }
                                if (f.size > 5 * 1024 * 1024) { tooBig = true; continue; }
                                ok.push(f);
                              }
                              if (badType) toast.error('File not supported', 'Please attach only JPG, PNG or PDF files.');
                              else if (tooBig) toast.error('File too large', 'Each attachment must be 5 MB or smaller.');
                              if (ok.length) setDraft(d.key, { attachments: [...d.attachments, ...ok] });
                            }}
                            onRemove={(i) => setDraft(d.key, { attachments: d.attachments.filter((_, idx) => idx !== i) })}
                          />
                        </td>
                        <td>
                          <button type="button" className="cps-row-del" onClick={() => removeRow(d.key)} title="Remove row" disabled={drafts.length === 1}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="cps-addrow-wrap">
                <button type="button" className="cps-addrow-btn" onClick={addRow}>+ Add Another Product</button>
                <span className="cps-addrow-hint">You can add one or more products to this procurement</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cps-foot">
          <div className="cps-foot-note">
            <svg className="cps-foot-clock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            Saving will generate a unique PROC ID
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
      {/* The clamp above hides overflow, so the full string must stay reachable
          on hover. Use the app's themed Tooltip, not the native `title` — that
          renders the browser's black tooltip and ignores the active theme. It
          only wraps plain-text values (a node child may be interactive). */}
      <Tooltip label={typeof value === 'string' ? value : ''} themed maxWidth={420}>
        <div className={`cps-opp-val ${tone === 'amber' ? 'cps-opp-val-amber' : ''} ${mono ? 'cps-mono' : ''} ${bold ? 'cps-bold' : ''}`}>
          {value}
        </div>
      </Tooltip>
    </div>
  );
}

function StatusPill({ text }: { text: string }) {
  const t = text.toLowerCase();
  const cls = t === 'qualified' ? 'cps-stp-q' : t === 'disqualified' ? 'cps-stp-d' : 'cps-stp-c';
  return <span className={`cps-stp ${cls}`}>● {text}</span>;
}

/* Single attachment chip — reused for the inline first chip and every row in
 * the overflow popover. `block` makes it fill the popover width. */
function AttachChip({ file, onRemove, block }: { file: File; onRemove: () => void; block?: boolean }) {
  return (
    <span className={`cps-attach-chip ${block ? 'cps-attach-chip-block' : ''}`} title={file.name}>
      <span className="cps-attach-name">{file.name}</span>
      <button type="button" className="cps-chip-dl" onClick={() => downloadFile(file)} title="Download">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
      <button type="button" className="cps-chip-x" onClick={onRemove} title="Remove">×</button>
    </span>
  );
}

function RowAttach({ files, onAdd, onRemove }: { files: File[]; onAdd: (f: File[]) => void; onRemove: (i: number) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const popRef  = useRef<HTMLDivElement | null>(null);
  /* Overflow popover position (fixed, portalled to body so the scrolling
   * modal body can't clip it). null = closed. */
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  const overflow = files.slice(1);   // everything after the first chip

  const openPop = () => {
    const r = moreRef.current?.getBoundingClientRect();
    if (!r) return;
    // Below the badge, clamped so a wide popover can't run off the right edge.
    setPopPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 296) });
  };
  const closePop = () => setPopPos(null);

  /* Close on outside click / scroll / resize / Escape — a fixed popover would
   * otherwise float in the wrong spot once the modal body scrolls. */
  useEffect(() => {
    if (!popPos) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closePop();
    };
    const onMove = () => closePop();
    const onEsc  = (e: KeyboardEvent) => { if (e.key === 'Escape') closePop(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('keydown', onEsc);
    };
  }, [popPos]);

  /* Auto-close once the overflow is gone (user removed files down to ≤ 1). */
  useEffect(() => { if (files.length <= 1) closePop(); }, [files.length]);

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
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={e => {
          if (e.target.files) onAdd(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <div className="cps-attach-chips">
          {/* Only the first file shows inline; the rest collapse into "+N". */}
          <AttachChip file={files[0]} onRemove={() => onRemove(0)} />
          {overflow.length > 0 && (
            <button
              type="button" ref={moreRef}
              className={`cps-attach-more ${popPos ? 'cps-attach-more-on' : ''}`}
              onClick={() => (popPos ? closePop() : openPop())}
              title={`${overflow.length} more attachment${overflow.length === 1 ? '' : 's'}`}
            >
              +{overflow.length}
            </button>
          )}
        </div>
      )}

      {/* Overflow popover — lists every attachment past the first. */}
      {popPos && overflow.length > 0 && createPortal(
        <div ref={popRef} className="cps-attach-pop" style={{ top: popPos.top, left: popPos.left }}>
          <div className="cps-attach-pop-head">{overflow.length} more attachment{overflow.length === 1 ? '' : 's'}</div>
          {overflow.map((f, i) => (
            // realIdx = i + 1 — the overflow list starts at the second file, so
            // remove/download map back to the correct index in `files`.
            <AttachChip key={i + 1} file={f} onRemove={() => onRemove(i + 1)} block />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

const SCOPED_CSS = `
.cps-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.72); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.cps-modal {
  width: min(1180px, 100%); max-height: 88vh;
  background: #f7feff;
  border-radius: 18px;
  border: 2px solid #a5f3fc;
  box-shadow: 0 18px 56px rgba(15,23,42,.30);
  overflow: hidden; display: flex; flex-direction: column;
}

/* ─── Save lock overlay (QA #120) — blankets the modal while saving so every
   field + button is un-interactable, with a spinner. ─── */
.cps-save-lock {
  position: absolute; inset: 0; z-index: 60;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(240,253,255,.72); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  cursor: progress; border-radius: inherit;
}
.cps-save-lock-txt { font-size: 13px; font-weight: 800; color: #0e7490; letter-spacing: .02em; }
.cps-save-spin {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid rgba(8,145,178,.25); border-top-color: #0891b2;
  animation: cps-save-spin .7s linear infinite;
}
@keyframes cps-save-spin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .cps-save-lock { background: rgba(10,20,28,.74); }
[data-bs-theme="dark"] .cps-save-lock-txt { color: #67e8f9; }

/* ─── Title row ─── */
.cps-title-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  /* Deep-violet gradient header — matches the Product Directory / stage popups. */
  background: linear-gradient(115deg, #0891b2 0%, #06b6d4 45%, #22d3ee 80%, #67e8f9 100%);
  border-bottom: none;
}
.cps-title-left { display: flex; align-items: center; gap: 10px; }
.cps-title-ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
}
.cps-title-text { display: flex; flex-direction: column; }
.cps-title { margin: 0; font-size: 19px; font-weight: 700; color: #fff; letter-spacing: -.2px; }
.cps-subtitle { font-size: 11.5px; color: rgba(255,255,255,.85); font-weight: 500; margin-top: 2px; line-height: 1.3; }
.cps-close {
  width: 30px; height: 30px;
  background: rgba(255,255,255,.20); border: 1px solid rgba(255,255,255,.35); color: #fff;
  border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.cps-close:hover { background: rgba(255,255,255,.32); }

.cps-body {
  flex: 1; overflow-y: auto; padding: 10px 12px; background: #f0fdff;
  /* Plain neutral scrollbar (not the themed violet one). */
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.cps-body::-webkit-scrollbar { width: 9px; }
.cps-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.cps-body::-webkit-scrollbar-track { background: transparent; }
[data-bs-theme="dark"] .cps-body::-webkit-scrollbar-thumb { background: rgba(148,163,184,.45); }
[data-bs-theme="dark"] .cps-textarea::-webkit-scrollbar-thumb { background: rgba(148,163,184,.45); }

/* ─── Section card — clean white card, soft shadow, violet top strip ─── */
.cps-section {
  background: #fff;
  border: 1px solid #ececf3;       /* uniform border — no coloured top strip */
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(15,23,42,.05);
}
.cps-section-head {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  padding: 12px 16px;
  background: linear-gradient(110deg, #f4fdff, #eefbff);
  border-bottom: 1px solid #e6f5fb;
  font-size: 12px; color: #1e1b3a;
}
.cps-section-ico {
  width: 26px; height: 26px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
}
.cps-section-ico-amber { background: linear-gradient(135deg,#22d3ee,#0891b2); color: #fff; }
.cps-section-title { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; color: #0f172a; text-transform: uppercase; }
.cps-section-hint  { font-size: 11px; font-weight: 500; color: #0e7490; font-style: italic; }
.cps-section-count {
  display: inline-flex; align-items: center; justify-content: center;
  height: 22px; padding: 0 10px; border-radius: 999px;
  background: #cffafe; color: #0e7490; border: 1px solid #a5f3fc;
  font-size: 10.5px; font-weight: 700; white-space: nowrap;
}
[data-bs-theme="dark"] .cps-section-count { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(8,145,178,.4); }

/* ─── OPP grid (4×2) ─── */
.cps-opp-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 0; background: #fff;
}
/* No internal dividers — only the section card's outer border shows.
   Tight vertical padding so the two rows sit close together. */
.cps-opp-cell { padding: 4px 16px; }
.cps-opp-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em;
  color: #64748b; margin-bottom: 3px; text-transform: uppercase;
}
/* Clamp to 2 lines — a long PRODUCT name wrapped to 4+ lines and stretched
   the whole Opportunity Summary card. Full value stays on the title tooltip. */
.cps-opp-val {
  font-size: 12.5px; color: #0c4a6e; font-weight: 600;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere;
}
.cps-opp-val-amber { color: #0e7490; }
.cps-mono { font-family: 'Inter', monospace; font-weight: 600; }
.cps-bold { font-weight: 600; color: #155e75; }

/* Status pill */
.cps-stp {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; border: 1.5px solid;
}
.cps-stp-q { background: #cffafe; color: #0e7490; border-color: #67e8f9; }
.cps-stp-d { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
.cps-stp-c { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
[data-bs-theme="dark"] .cps-stp-q { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(8,145,178,.4); }
[data-bs-theme="dark"] .cps-stp-d { background: rgba(239,68,68,.18); color: #fca5a5; border-color: rgba(239,68,68,.4); }
[data-bs-theme="dark"] .cps-stp-c { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.4); }

/* ─── Basic Information grid ─── */
.cps-basic-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 14px; padding: 14px 16px 16px;   /* roomier bottom so the fields aren't tight against the card edge */
  background: #fff;
}
/* Procurement ID — read-only, auto-generated (matches the Figma's AUTO chip). */
.cps-procid {
  height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 10px 7px 12px;
  border: 1.5px solid #a5f3fc; border-radius: 10px;
  background: linear-gradient(180deg, #f0fdff, #e0f7fa);
}
.cps-procid-val { font-family: 'Inter', monospace; font-size: 13px; font-weight: 700; color: #0e7490; }
.cps-procid-auto {
  font-size: 9px; font-weight: 700; letter-spacing: .05em; color: #fff;
  background: linear-gradient(135deg, #22d3ee, #0891b2);
  border-radius: 999px; padding: 3px 9px;
}
[data-bs-theme="dark"] .cps-procid { background: rgba(8,145,178,.12); border-color: rgba(8,145,178,.4); }
[data-bs-theme="dark"] .cps-procid-val { color: #67e8f9; }
.cps-field { display: flex; flex-direction: column; gap: 5px; }
.cps-field-full { padding: 2px 16px 12px; background: #fff; }
.cps-flabel { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; color: #64748b; text-transform: uppercase; }
.cps-req { color: #dc2626; }

.cps-input {
  height: 38px; padding: 7px 12px;
  border: 1.5px solid #94a3b8; border-radius: 10px;
  background: #fff; font-size: 13px; font-weight: 500; color: #1e293b;
  outline: none; font-family: inherit;
  transition: border-color .18s, box-shadow .18s;
}
.cps-input:focus { border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,.18); }
.cps-input-err   { border-color: #ef4444 !important; }

.cps-textarea {
  padding: 10px 12px;
  border: 1.5px solid #a5f3fc; border-radius: 8px;
  background: #f2fdff; font-size: 12.5px; color: #1e293b;
  outline: none; font-family: inherit;
  width: 100%; resize: vertical; min-height: 60px;
  transition: border-color .15s, box-shadow .15s;
  /* Plain neutral scrollbar (not the themed colour). */
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.cps-textarea::-webkit-scrollbar { width: 8px; }
.cps-textarea::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.cps-textarea::-webkit-scrollbar-track { background: transparent; }
.cps-textarea:focus { border-color: #0e7490; box-shadow: 0 0 0 3px rgba(8,145,178,.16); }
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
  border: 1.5px solid #67e8f9; border-radius: 10px;
  background: linear-gradient(180deg, #ecfeff, #cffafe);
  color: #155e75;
  cursor: not-allowed;
}
.cps-status-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #0891b2;
  box-shadow: 0 0 6px rgba(8,145,178,.55);
  flex-shrink: 0;
}
.cps-status-main { font-size: 12px; font-weight: 600; color: #0c4a6e; }
.cps-status-sub  { font-size: 10px;   font-weight: 600; color: #0e7490; margin-top: 1px; }

/* ─── Sourcing Product Details ─── */
.cps-prods-wrap { background: #fff; }
.cps-prods-table { width: 100%; border-collapse: collapse; min-width: 760px; table-layout: fixed; }
/* Keep the pinned PRODUCT NAME column from being widened by its content. */
.cps-prods-table td:nth-child(2) { max-width: 300px; overflow: hidden; }
.cps-prods-table thead th {
  padding: 10px 12px; text-align: left;
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; color: #0c4a6e;
  background: linear-gradient(180deg, #cffafe, #ecfeff);
  border-bottom: 1px solid #a5f3fc; white-space: nowrap;
}
.cps-prods-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #cffafe; vertical-align: middle;
}
.cps-prods-table tbody tr:last-child td { border-bottom: none; }

.cps-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #22d3ee, #0891b2); color: #fff;
  font-size: 11px; font-weight: 700;
}

.cps-status-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.cps-st-active   { background: #d1fae5; color: #047857; }
.cps-st-inactive { background: #fee2e2; color: #dc2626; }
.cps-st-draft    { background: #cffafe; color: #0e7490; }
.cps-muted { color: #94a3b8; font-style: italic; }

.cps-row-input {
  width: 100%; height: 30px; padding: 0 10px;
  border: 1.5px solid #a5f3fc; border-radius: 8px;
  background: #f7feff; font-size: 12px; color: #1e293b;
  outline: none; font-family: inherit;
}
.cps-row-input:focus { border-color: #0e7490; box-shadow: 0 0 0 3px rgba(8,145,178,.16); }
/* Per-row validation message under QTY / TARGET PRICE — keeps the typed value
   visible and explains why it's invalid (negative / non-numeric / empty). */
.cps-row-err { margin-top: 3px; font-size: 10px; font-weight: 600; color: #ef4444; line-height: 1.25; }
.cps-price-wrap { position: relative; }
.cps-price-prefix {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  font-size: 12px; color: #0e7490; font-weight: 700;
}
.cps-row-price { padding-left: 22px; }

/* Attach */
.cps-attach-cell { display: flex; flex-direction: column; gap: 5px; }
.cps-attach-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  border: 1.5px solid #a5f3fc; border-radius: 7px;
  background: #f7feff; color: #0e7490;
  font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: all .12s;
}
.cps-attach-btn:hover { background: #cffafe; border-color: #67e8f9; }
/* Single line: the first chip + the "+N" badge sit side by side. The chip
   shrinks (ellipsis) so the badge always stays inline beside it, never wraps
   to a second row. */
.cps-attach-chips { display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; }
.cps-attach-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 5px 2px 8px; border-radius: 999px;
  background: #cffafe; color: #0e7490; border: 1px solid #a5f3fc;
  font-size: 10px; font-weight: 600;
  max-width: 112px; min-width: 0; flex: 0 1 auto;
}
.cps-attach-name { max-width: 62px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cps-chip-dl, .cps-chip-x {
  background: transparent; border: none; cursor: pointer;
  color: #0e7490; padding: 1px 2px; line-height: 1;
  display: inline-flex; align-items: center; border-radius: 3px;
}
.cps-chip-dl:hover { background: rgba(8,145,178,.18); }
.cps-chip-x { font-weight: 700; font-size: 12px; }
.cps-chip-x:hover { background: rgba(239,68,68,.18); color: #dc2626; }

/* "+N" overflow badge — collapses the extra attachments into one pill. */
.cps-attach-more {
  display: inline-flex; align-items: center; justify-content: center;
  height: 20px; padding: 0 9px; border-radius: 999px;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  border: 1px solid #0e7490;
  font-family: inherit; font-size: 10px; font-weight: 800;
  cursor: pointer; transition: filter .12s;
  flex: 0 0 auto; white-space: nowrap;   /* never shrinks; stays beside the chip */
}
.cps-attach-more:hover, .cps-attach-more-on { filter: brightness(1.08); }

/* Overflow popover — fixed + portalled to body so the scrolling modal
   never clips it. Position is set inline from the badge's rect. */
.cps-attach-pop {
  position: fixed; z-index: 1100;
  width: 280px; max-height: 240px; overflow-y: auto;
  background: #fff; border: 1.5px solid #a5f3fc; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15,23,42,.22);
  padding: 8px; display: flex; flex-direction: column; gap: 5px;
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.cps-attach-pop::-webkit-scrollbar { width: 8px; }
.cps-attach-pop::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.cps-attach-pop-head {
  font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: #0e7490; padding: 2px 4px 5px;
  border-bottom: 1px solid #cffafe; margin-bottom: 2px;
}
/* Block chip fills the popover row: the name takes all the slack so the
   download + remove buttons sit together at the right corner. */
.cps-attach-chip-block { max-width: none; width: 100%; }
.cps-attach-chip-block .cps-attach-name { max-width: none; flex: 1 1 auto; min-width: 0; }

[data-bs-theme="dark"] .cps-attach-more { background: linear-gradient(135deg, #0891b2, #0e7490); border-color: rgba(8,145,178,.6); }
[data-bs-theme="dark"] .cps-attach-pop { background: #0f1c25; border-color: rgba(8,145,178,.40); box-shadow: 0 12px 32px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .cps-attach-pop-head { color: #67e8f9; border-bottom-color: rgba(8,145,178,.30); }

/* Row add / del */
.cps-row-add {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 6px 14px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-family: inherit;
  font-size: 11px; font-weight: 700;
  border-radius: 7px;
  box-shadow: 0 2px 6px rgba(8,145,178,.30);
}
.cps-row-add:hover { background: linear-gradient(135deg, #0e7490, #0e7490); transform: translateY(-1px); }
.cps-row-del {
  background: transparent; border: 1.5px solid #fca5a5;
  color: #dc2626; padding: 5px 8px; border-radius: 7px;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.cps-row-del:hover:not(:disabled) { background: #fee2e2; }
.cps-row-del:disabled { opacity: .4; cursor: not-allowed; }

.cps-addrow-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: #f7feff; border-top: 1px dashed #a5f3fc; }
.cps-addrow-hint { font-size: 11.5px; color: #64748b; font-weight: 500; }
[data-bs-theme="dark"] .cps-addrow-hint { color: #94a3b8; }
.cps-addrow-btn {
  padding: 8px 16px;
  border: 1.5px dashed #0e7490; border-radius: 8px;
  background: transparent; color: #0e7490;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .12s;
}
.cps-addrow-btn:hover { background: #cffafe; border-color: #0e7490; }

/* ─── Footer ─── */
.cps-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; flex-wrap: wrap; gap: 10px;
  background: #f7feff;
  border-top: 1px solid #cffafe;
}
.cps-foot-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #0e7490; font-weight: 600;
}
.cps-foot-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #0891b2;
  box-shadow: 0 0 5px rgba(8,145,178,.55);
}
.cps-foot-next   { font-family: 'Inter',monospace; font-weight: 700; color: #0e7490; padding: 0 6px; }
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
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
  box-shadow: 0 4px 12px rgba(8,145,178,.35);
}
.cps-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0e7490, #0e7490);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(8,145,178,.50);
}
.cps-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.cps-btn-ico {
  width: 17px; height: 17px; border-radius: 50%;
  background: rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
}

/* Dark mode */
[data-bs-theme="dark"] .cps-modal { background: linear-gradient(160deg, #0e1b24 0%, #0b151c 100%); border: 1px solid rgba(255,255,255,.08); }
[data-bs-theme="dark"] .cps-title-row { background: linear-gradient(115deg, #0e7490 0%, #0891b2 45%, #06b6d4 80%, #22d3ee 100%); border-bottom: none; }
[data-bs-theme="dark"] .cps-title { color: #fff; }
[data-bs-theme="dark"] .cps-title-ico { background: rgba(255,255,255,.18); color: #fff; }
[data-bs-theme="dark"] .cps-close { background: rgba(255,255,255,.20); color: #fff; }
[data-bs-theme="dark"] .cps-close:hover { background: rgba(255,255,255,.32); }
[data-bs-theme="dark"] .cps-body { background: transparent; }
[data-bs-theme="dark"] .cps-section { background: linear-gradient(180deg, #13242e 0%, #0f1c25 100%); border: 1px solid rgba(34,211,238,.14); box-shadow: 0 2px 10px rgba(0,0,0,.30); }
/* Header bar is a notch DARKER than the card body so it reads as a header. */
[data-bs-theme="dark"] .cps-section-head { background: #0c1922; border-bottom-color: rgba(255,255,255,.07); }
[data-bs-theme="dark"] .cps-section-title { color: #e2faff; }
[data-bs-theme="dark"] .cps-section-hint { color: #7dd3fc; }
/* Card interiors are flat (inherit the card surface) — no internal colour blocks. */
[data-bs-theme="dark"] .cps-opp-grid,
[data-bs-theme="dark"] .cps-basic-grid,
[data-bs-theme="dark"] .cps-field-full { background: transparent; }
[data-bs-theme="dark"] .cps-opp-label { color: #7dd3fc; }
[data-bs-theme="dark"] .cps-opp-val { color: #e2f4f8; }
[data-bs-theme="dark"] .cps-opp-val-amber { color: #67e8f9; }
[data-bs-theme="dark"] .cps-bold { color: #e2faff; }
[data-bs-theme="dark"] .cps-flabel { color: #7dd3fc; }
[data-bs-theme="dark"] .cps-input, [data-bs-theme="dark"] .cps-textarea, [data-bs-theme="dark"] .cps-row-input {
  background: #13242e; border-color: rgba(255,255,255,.14); color: #e2f4f8;
}
[data-bs-theme="dark"] .cps-input::placeholder, [data-bs-theme="dark"] .cps-textarea::placeholder { color: #64748b; }
[data-bs-theme="dark"] .cps-status-locked { background: rgba(8,145,178,.14); border-color: rgba(8,145,178,.40); color: #a5f3fc; }
[data-bs-theme="dark"] .cps-status-main { color: #a5f3fc; }
[data-bs-theme="dark"] .cps-status-sub  { color: rgba(8,145,178,.60); }
[data-bs-theme="dark"] .cps-prods-wrap { background: #0c1820; }
[data-bs-theme="dark"] .cps-prods-table thead th { background: rgba(8,145,178,.14); color: #a5f3fc; border-bottom-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cps-prods-table tbody td { color: #cffafe; border-bottom-color: rgba(8,145,178,.18); }
[data-bs-theme="dark"] .cps-sr { background: linear-gradient(135deg, #22d3ee, #0891b2); color: #fff; }
[data-bs-theme="dark"] .cps-attach-btn { background: rgba(8,145,178,.10); border-color: rgba(8,145,178,.40); color: #a5f3fc; }
[data-bs-theme="dark"] .cps-attach-btn:hover { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .cps-attach-chip { background: rgba(8,145,178,.18); color: #a5f3fc; border-color: rgba(8,145,178,.40); }
[data-bs-theme="dark"] .cps-chip-dl, [data-bs-theme="dark"] .cps-chip-x { color: #a5f3fc; }
[data-bs-theme="dark"] .cps-addrow-wrap { background: #0e1b24; border-top-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cps-addrow-btn { color: #a5f3fc; border-color: rgba(8,145,178,.45); }
[data-bs-theme="dark"] .cps-addrow-btn:hover { background: rgba(8,145,178,.12); }
[data-bs-theme="dark"] .cps-foot { background: #0e1b24; border-top-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cps-foot-note { color: #a5f3fc; }
[data-bs-theme="dark"] .cps-btn-cancel { background: #13242e; border-color: rgba(34,211,238,.30); color: #67e8f9; }
[data-bs-theme="dark"] .cps-btn-cancel:hover:not(:disabled) { background: #16313c; }
/* Status badges — translucent fills so they read on the dark surface instead
   of sitting as bright light pills. */
[data-bs-theme="dark"] .cps-st-active   { background: rgba(34,197,94,.18);  color: #86efac; }
[data-bs-theme="dark"] .cps-st-inactive { background: rgba(239,68,68,.18);  color: #fca5a5; }
[data-bs-theme="dark"] .cps-st-draft    { background: rgba(8,145,178,.18); color: #67e8f9; }
/* Delete (remove row) button — tinted border/icon + a dark-friendly hover
   instead of the bright #fee2e2 wash. */
[data-bs-theme="dark"] .cps-row-del        { border-color: rgba(239,68,68,.45); color: #fca5a5; }
[data-bs-theme="dark"] .cps-row-del:hover  { background: rgba(239,68,68,.20); border-color: rgba(239,68,68,.65); }

@media (max-width: 900px) {
  .cps-opp-grid, .cps-basic-grid { grid-template-columns: repeat(2, 1fr); }
  .cps-opp-cell:nth-child(2n)        { border-right: none; }
  .cps-opp-cell:nth-child(2n+1)      { border-right: 1px solid #cffafe; }
  .cps-opp-cell:nth-last-child(-n+2) { border-bottom: none; }
}
@media (max-width: 580px) {
  .cps-opp-grid, .cps-basic-grid { grid-template-columns: 1fr; }
}
`;
