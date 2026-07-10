import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useQpiMasters } from '../../SalesQPI';

/* Ensure a pre-filled value (carried over from the PI/quotation) still
 * renders in a MasterSelect even if it isn't an exact option in the
 * loaded master list. */
const withCurrent = (opts: { value: string; label: string }[], value: string) =>
  value && !opts.some(o => o.value === value) ? [...opts, { value, label: value }] : opts;

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 6 → Create Shipment Order modal.
 *
 *  Ported from IDIMS BT (Business Task) Modal. Amber/orange theme.
 *  Fills in the shipping + logistics block once the deal is won so the
 *  operations team can dispatch. One shipment per opportunity.
 * ───────────────────────────────────────────────────────────────────── */

export type ShipmentInitialContext = {
  oppCode:         string;
  oppDate:         string;
  piCode?:         string | null;
  piDate?:         string | null;
  piId?:           number | null;
  piCurrency?:     string | null;   // currency from the PI — drives the Freight Cost prefix
  /* PI's Domestic / International type. Domestic hides INCO Term and makes the
   * ports optional; International keeps INCO + both ports mandatory. */
  docType?:        string | null;
  customerCode?:   string | null;
  customerName?:   string | null;
  consigneeCode?:  string | null;
  consigneeName?:  string | null;
  /* Pre-fills carried over from the PI / quotation if available. */
  incoTerm?:       string | null;
  portOfLoading?:  string | null;
  portOfDischarge?: string | null;   // → seeds Port of Unloading
  finalDestination?: string | null;
  originCountry?:  string | null;
  shippingCost?:   number | string | null;   // PI shipping cost → seeds Freight Cost (editable)
};

type Props = {
  open:    boolean;
  leadId:  number | null;
  context: ShipmentInitialContext;
  onClose:   () => void;
  onCreated: () => void;
};

const LIABILITY_OPTIONS = [
  { value: 'Seller',  label: 'Seller'  },
  { value: 'Buyer',   label: 'Customer'   },
];

const COLD_CHAIN_OPTIONS = [
  { value: 'yes', label: 'Yes — Required' },
  { value: 'no',  label: 'No — Not Required' },
];

const SHIPPING_MODE_OPTIONS = [
  { value: 'Air',     label: 'Air' },
  { value: 'Water',   label: 'Water' },
  { value: 'By Road', label: 'By Road' },
  { value: 'Train',   label: 'Train' },
];

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : formatDmy(d);
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CreateShipmentOrderModal({
  open, leadId, context, onClose, onCreated,
}: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Freeze background page scroll while the modal is open (locks html + body).
  useScrollLock(open);

  const [shippingLiability, setLiability] = useState('');
  const [coldChain, setColdChain]         = useState('');
  const [zipCode, setZipCode]             = useState('');
  const [freightCost, setFreightCost]     = useState('');
  const [shippingMode, setShippingMode]   = useState('');
  const [incoTerm, setIncoTerm]           = useState('');
  const [portOfLoading, setPOL]           = useState('');
  const [portOfUnloading, setPOU]         = useState('');
  const [finalDestination, setFinalDest]  = useState('');
  const [originCountry, setOrigin]        = useState('');
  const [remarks, setRemarks]             = useState('');
  const [attachments, setAttachments]     = useState<File[]>([]);
  const [errors, setErrors]               = useState<Record<string, string>>({});
  const [submitting, setSubmitting]       = useState(false);

  /* Domestic PIs get a lighter logistics form: INCO Term is hidden, and Port
   * of Loading / Port of Unloading are optional. International keeps INCO +
   * both ports mandatory. Anything other than an explicit "Domestic" (incl.
   * a missing type) is treated as International so behaviour never silently
   * loosens. */
  const isDomestic = (context.docType ?? '').trim().toLowerCase() === 'domestic';

  /* Reset + seed every time modal opens */
  useEffect(() => {
    if (!open) return;
    setLiability(''); setColdChain(''); setZipCode('');
    // Freight Cost seeds from the PI's Shipping Cost (stays editable).
    setFreightCost(
      context.shippingCost != null && Number(context.shippingCost) > 0
        ? String(context.shippingCost)
        : '',
    );
    setShippingMode('');
    setIncoTerm(context.incoTerm ?? '');
    setPOL(context.portOfLoading ?? '');
    setPOU(context.portOfDischarge ?? '');
    setFinalDest(context.finalDestination ?? '');
    setOrigin(context.originCountry ?? '');
    setRemarks('');
    setAttachments([]);
    setErrors({});
  }, [open, context]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!shippingLiability) e.shippingLiability = 'Required';
    if (!coldChain)         e.coldChain         = 'Required';
    if (!zipCode.trim())    e.zipCode           = 'Required';
    else if (zipCode.trim().length > 12) e.zipCode = 'Must be 12 characters or fewer';
    if (!freightCost || !Number.isFinite(Number(freightCost)) || Number(freightCost) < 0)
      e.freightCost = 'Positive number required';
    if (!shippingMode)      e.shippingMode      = 'Required';
    // INCO Term + both ports are International-only requirements. For a
    // Domestic PI the INCO field is hidden and the two ports are optional.
    if (!isDomestic && !incoTerm.trim())        e.incoTerm        = 'Required';
    if (!isDomestic && !portOfLoading.trim())   e.portOfLoading   = 'Required';
    if (!isDomestic && !portOfUnloading.trim()) e.portOfUnloading = 'Required';
    if (!finalDestination.trim()) e.finalDestination = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter Stage 6 from the Lead Worksheet first.');
      return;
    }
    if (!validate()) {
      // validate() already set the inline red errors under each field (incl.
      // the ZIP "Must be 12 characters or fewer" message). Show them inline
      // only — no top-right toast — to match the other forms (QA #34).
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('lead_id', String(leadId));
      if (context.piId) fd.append('proforma_invoice_id', String(context.piId));
      fd.append('shipping_liability', shippingLiability);
      fd.append('cold_chain',         coldChain === 'yes' ? '1' : '0');
      fd.append('zip_code',           zipCode.trim());
      fd.append('freight_cost',       freightCost);
      fd.append('shipping_mode',      shippingMode);
      // INCO Term is International-only (hidden for Domestic) → send only when set.
      if (!isDomestic && incoTerm.trim()) fd.append('inco_term', incoTerm.trim());
      if (portOfLoading.trim())    fd.append('port_of_loading',   portOfLoading.trim());
      if (portOfUnloading.trim())  fd.append('port_of_unloading', portOfUnloading.trim());
      fd.append('final_destination', finalDestination.trim());
      if (originCountry.trim())   fd.append('origin_country',    originCountry.trim());
      if (remarks.trim())         fd.append('remarks',           remarks.trim());
      attachments.forEach((f, i) => fd.append(`attachments[${i}]`, f));

      await api.post('/sales/shipment-orders', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Shipment Order created', 'Logistics team can now pick this up for dispatch.');
      onCreated();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      const fieldErrs = e?.response?.data?.errors as Record<string, string[]> | undefined;
      // Map Laravel's snake_case validation keys back to this form's fields so
      // the message renders INLINE under the offending input (red highlight +
      // helper text) instead of only as a top-right toast.
      const KEY_MAP: Record<string, string> = {
        zip_code: 'zipCode', shipping_liability: 'shippingLiability', cold_chain: 'coldChain',
        freight_cost: 'freightCost', shipping_mode: 'shippingMode', inco_term: 'incoTerm',
        port_of_loading: 'portOfLoading', port_of_unloading: 'portOfUnloading',
        final_destination: 'finalDestination', origin_country: 'originCountry', remarks: 'remarks',
      };
      const inline: Record<string, string> = {};
      if (fieldErrs) {
        for (const [k, v] of Object.entries(fieldErrs)) {
          const key = KEY_MAP[k] ?? k;
          inline[key] = Array.isArray(v) ? v[0] : String(v);
        }
      }
      if (Object.keys(inline).length) {
        setErrors(prev => ({ ...prev, ...inline }));
        toast.warning('Please fix the highlighted fields', 'Check the fields marked in red below.');
      } else {
        toast.error('Save failed', msg ?? 'Could not save the shipment order.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* MUST stay above the early-return below — Hooks must run in the
   * same order on every render. Moving this useMemo after `if (!open)
   * return null` caused React to detect a hook-count change when the
   * modal first opened (closed render = N hooks, open render = N+1)
   * and crashed the Stage 6 page with the "change in the order of
   * Hooks" warning. */
  /* Real next Shipment ID from the server (per-BRANCH sequential, SHP-001…),
   * fetched when the modal opens. The actual code is allocated on save.
   * Pass lead_id so the preview is scoped to the opportunity's branch. */
  const [previewShpCode, setPreviewShpCode] = useState('…');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.get<{ status: boolean; code: string }>('/sales/shipment-orders/next-code', { params: { lead_id: leadId ?? undefined } })
      .then(({ data }) => { if (!cancelled) setPreviewShpCode(data.code || '—'); })
      .catch(() => { if (!cancelled) setPreviewShpCode('—'); });
    return () => { cancelled = true; };
  }, [open, leadId]);

  /* Master-backed dropdown options (INCO Term / Ports / Origin Country).
   * Reuses the cached QPI masters loader, so this is a no-op fetch when
   * the user already opened a Create Quotation/PI in the session. */
  const masters = useQpiMasters(open);

  /* The PI stores currency as a full label ("SGD – Singapore Dollar"); show
   * just the short code ("SGD") on the Freight Cost field. */
  const curCode = (() => {
    const raw = (context.piCurrency || '').trim();
    if (!raw) return '';
    return raw.split(/[–-]/)[0].trim().split(/\s+/)[0] || raw;
  })();

  if (!open) return null;

  return createPortal((
    <div className="cso-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="cso-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header — amber gradient */}
        <div className="cso-head">
          <div className="cso-head-left">
            <span className="cso-head-ico">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </span>
            <div>
              <div className="cso-head-title">Create Shipment ID</div>
              <div className="cso-head-sub">Fill in shipping &amp; logistics details to generate Shipment ID</div>
            </div>
          </div>
          <div className="cso-head-right">
            <span className="cso-pill">
              <span className="cso-pill-label">SHIPMENT ID</span>
              <span className="cso-pill-val">{previewShpCode}</span>
            </span>
            <span className="cso-pill">
              <span className="cso-pill-label">SHIPMENT DATE</span>
              <span className="cso-pill-val">{formatDmy(new Date())}</span>
            </span>
            <button className="cso-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="cso-body">
          {/* Opportunity / PI / Customer / Consignee strip */}
          <div className="cso-strip">
            <Cell label="OPPORTUNITY ID"  value={context.oppCode || '—'}  highlight />
            <Cell label="OPPORTUNITY DATE" value={fmtDate(context.oppDate)} />
            <Cell label="PI NO"           value={context.piCode || '—'}    highlight />
            <Cell label="PI DATE"         value={fmtDate(context.piDate)} />
            <Cell label="CUSTOMER ID"     value={context.customerCode || '—'} highlight />
            <Cell label="CUSTOMER NAME"   value={context.customerName || '—'} />
            <Cell label="CONSIGNEE ID"    value={context.consigneeCode || '—'} highlight />
            <Cell label="CONSIGNEE NAME"  value={context.consigneeName || '—'} />
          </div>

          {/* Shipping & Logistics section */}
          <div className="cso-section-head">
            <span className="cso-section-bar" />
            <span className="cso-section-title">SHIPPING &amp; LOGISTICS DETAILS</span>
          </div>

          {masters.loading ? <ShipmentFormSkeleton /> : (<>
          <div className="cso-grid">
            <Field label="Shipping Liability" required error={errors.shippingLiability}>
              <MasterSelect
                value={shippingLiability}
                onChange={(v) => { setLiability(String(v)); if (errors.shippingLiability) setErrors(p => ({ ...p, shippingLiability: '' })); }}
                options={LIABILITY_OPTIONS}
                placeholder="— Select —"
              />
            </Field>
            <Field label="Cold Chain" required error={errors.coldChain}>
              <MasterSelect
                value={coldChain}
                onChange={(v) => { setColdChain(String(v)); if (errors.coldChain) setErrors(p => ({ ...p, coldChain: '' })); }}
                options={COLD_CHAIN_OPTIONS}
                placeholder="— Select —"
              />
            </Field>
            <Field label="Zip Code" required error={errors.zipCode}>
              <input className={`cso-input ${errors.zipCode ? 'cso-input-err' : ''}`}
                value={zipCode} onChange={(e) => { setZipCode(e.target.value); if (errors.zipCode) setErrors(p => ({ ...p, zipCode: '' })); }} placeholder="Enter zip code" />
            </Field>

            <Field label={`Freight Cost${curCode ? ` (${curCode})` : ''}`} required error={errors.freightCost}>
              <div className="cso-input-prefix">
                {/* Currency follows the PI — short code only (e.g. SGD), not $. */}
                <span className="cso-input-cur">{curCode || '—'}</span>
                <input className={`cso-input cso-input-prefix-input ${errors.freightCost ? 'cso-input-err' : ''}`}
                  type="number" min="0" step="any"
                  value={freightCost} onChange={(e) => setFreightCost(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <Field label="Shipping Mode" required error={errors.shippingMode}>
              <MasterSelect
                value={shippingMode}
                onChange={(v) => { setShippingMode(String(v)); if (errors.shippingMode) setErrors(p => ({ ...p, shippingMode: '' })); }}
                options={SHIPPING_MODE_OPTIONS}
                placeholder="— Select —"
              />
            </Field>
            {/* INCO Term is International-only — hidden entirely for Domestic PIs. */}
            {!isDomestic && (
            <Field label="INCO Term" required error={errors.incoTerm}>
              <MasterSelect
                key={`inco-${masters.incoterms.length}`}
                value={incoTerm}
                loading={masters.loading}
                placeholder="— Select INCO Term —"
                options={withCurrent(masters.incoterms, incoTerm)}
                onChange={(v) => { setIncoTerm(String(v)); if (errors.incoTerm) setErrors(p => ({ ...p, incoTerm: '' })); }}
              />
            </Field>
            )}

            {/* Ports are mandatory (*) for International, optional for Domestic. */}
            <Field label="Port of Loading" required={!isDomestic} error={errors.portOfLoading}>
              <MasterSelect
                key={`pol-${masters.ports.length}`}
                value={portOfLoading}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.ports, portOfLoading)}
                onChange={(v) => { setPOL(String(v)); if (errors.portOfLoading) setErrors(p => ({ ...p, portOfLoading: '' })); }}
              />
            </Field>
            <Field label="Port of Unloading" required={!isDomestic} error={errors.portOfUnloading}>
              <MasterSelect
                key={`pou-${masters.ports.length}`}
                value={portOfUnloading}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.ports, portOfUnloading)}
                onChange={(v) => { setPOU(String(v)); if (errors.portOfUnloading) setErrors(p => ({ ...p, portOfUnloading: '' })); }}
              />
            </Field>
            <Field label="Final Destination" required error={errors.finalDestination}>
              <input className={`cso-input ${errors.finalDestination ? 'cso-input-err' : ''}`}
                value={finalDestination}
                onChange={(e) => setFinalDest(e.target.value)} placeholder="e.g. Dubai, UAE" />
            </Field>

            <Field label="Origin Country">
              <MasterSelect
                key={`oc-${masters.countries.length}`}
                value={originCountry}
                loading={masters.loading}
                placeholder="— Select Country —"
                options={withCurrent(masters.countries, originCountry)}
                onChange={(v) => setOrigin(String(v))}
              />
            </Field>
            <Field label="Attachment">
              <div className="cso-att-row">
                <button type="button" className="cso-att-btn" onClick={() => fileRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Attach File
                </button>
                <input type="file" multiple hidden ref={fileRef}
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx"
                  onChange={(e) => {
                    if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                    e.target.value = '';
                  }} />
                {attachments.length > 0 && (
                  <div className="cso-att-chips">
                    {attachments.map((f, i) => (
                      <span key={i} className="cso-att-chip" title={f.name}>
                        <span className="cso-att-name">{f.name}</span>
                        <button type="button" onClick={() => downloadFile(f)} className="cso-att-dl" title="Download">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </button>
                        <button type="button" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="cso-att-x" title="Remove">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>

          <div className="cso-remarks">
            <Field label="Remarks">
              <textarea className="cso-textarea" rows={3} maxLength={2000}
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any additional notes or remarks for this Shipment ID…" />
            </Field>
          </div>
          </>)}
        </div>

        <div className="cso-foot">
          <span className="cso-foot-note"><span className="cso-foot-dot" />Required fields</span>
          <div className="cso-foot-actions">
            <button type="button" className="cso-btn cso-btn-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="cso-btn cso-btn-primary" onClick={() => void onSubmit()} disabled={submitting}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" style={{ marginRight: 6 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              {submitting ? 'Saving…' : 'Save Shipment ID'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="cso-field">
      <label className="cso-flabel">
        {label}{required && <span className="cso-req">*</span>}
      </label>
      {children}
      {error && <div className="cso-err">{error}</div>}
    </div>
  );
}

/* Shimmer skeleton for the shipping/logistics field grid — shown while
 * the master dropdown options (INCO Term / Ports / Country) load. */
function ShipmentFormSkeleton() {
  return (
    <>
      <div className="cso-grid">
        {Array.from({ length: 11 }).map((_, i) => (
          <div className="cso-field" key={i}>
            <span className="cso-skel cso-skel-label" />
            <span className="cso-skel cso-skel-input" />
          </div>
        ))}
      </div>
      <div className="cso-remarks">
        <span className="cso-skel cso-skel-label" style={{ width: 80 }} />
        <span className="cso-skel cso-skel-area" />
      </div>
    </>
  );
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="cso-strip-cell">
      <div className="cso-strip-label">{label}</div>
      <div className={`cso-strip-val ${highlight ? 'cso-strip-val-highlight' : ''}`}>{value}</div>
    </div>
  );
}

const SCOPED_CSS = `
.cso-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.cso-modal {
  width: min(1100px, 100%); max-height: 92vh;
  background: #fffaf0;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.30);
  overflow: hidden; display: flex; flex-direction: column;
}

/* Header — amber */
.cso-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 22px;
  background: linear-gradient(180deg, #b45309 0%, #d97706 100%);
  color: #fff;
  gap: 14px;
}
.cso-head-left { display: flex; gap: 12px; align-items: center; }
.cso-head-ico {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center;
}
.cso-head-title { font-size: 16px; font-weight: 800; }
.cso-head-sub   { font-size: 11px; opacity: .85; margin-top: 2px; }
.cso-head-right { display: flex; gap: 10px; align-items: center; }
.cso-pill {
  display: inline-flex; flex-direction: column; gap: 2px;
  padding: 4px 12px; border-radius: 8px;
  background: rgba(255,255,255,.18);
  font-size: 10.5px; line-height: 1.2;
}
.cso-pill-label { font-weight: 700; letter-spacing: .04em; color: rgba(255,255,255,.85); }
.cso-pill-val   { font-weight: 800; color: #fff; font-family: 'Inter', monospace; }
.cso-close {
  width: 32px; height: 32px;
  background: rgba(255,255,255,.18); border: none; color: #fff;
  border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.cso-close:hover { background: rgba(255,255,255,.32); }

.cso-body { flex: 1; overflow-y: auto; padding: 16px 22px; background: #fffaf0; }

/* Top strip — 4×2 fact box */
.cso-strip {
  display: grid; grid-template-columns: repeat(4, 1fr);
  background: #fef3c7;
  border: 1.5px solid #fde68a;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 18px;
}
.cso-strip-cell {
  padding: 10px 14px;
  border-right: 1px solid #fde68a;
  border-bottom: 1px solid #fde68a;
}
.cso-strip-cell:nth-child(4n)   { border-right: none; }
.cso-strip-cell:nth-last-child(-n+4) { border-bottom: none; }
.cso-strip-label {
  font-size: 10px; font-weight: 800; letter-spacing: .08em;
  color: #92400e; text-transform: uppercase;
  margin-bottom: 3px;
}
.cso-strip-val { font-size: 12.5px; font-weight: 700; color: #1e293b; }
.cso-strip-val-highlight { color: #b45309; }

/* Section header */
.cso-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cso-section-bar  { display: inline-block; width: 3px; height: 16px; background: #d97706; border-radius: 2px; }
.cso-section-title { font-size: 11.5px; font-weight: 800; color: #b45309; letter-spacing: .06em; }

/* Form grid */
.cso-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 16px 18px;
}
.cso-field { display: flex; flex-direction: column; gap: 5px; }
.cso-flabel {
  font-size: 11px; font-weight: 800; letter-spacing: .04em;
  color: #b45309; text-transform: uppercase;
}
.cso-req { color: #dc2626; margin-left: 2px; }
.cso-input {
  height: 36px; padding: 0 12px;
  border: 1.5px solid #fde68a; border-radius: 8px;
  background: #fffef9; font-size: 12.5px; color: #1e293b;
  outline: none; font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
}
.cso-input:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.16); }
.cso-input-err   { border-color: #ef4444 !important; }

/* Dropdowns (MasterSelect) match the amber input border within this form. */
.cso-grid .master-select-toggle {
  border: 1.5px solid #fde68a; border-radius: 8px;
  height: 36px; background: #fffef9;
}
.cso-grid .master-select-toggle:hover:not(:disabled) {
  border-color: #fcd34d; box-shadow: none;
}
.cso-grid .master-select-wrap.show .master-select-toggle {
  border-color: #d97706 !important; box-shadow: 0 0 0 3px rgba(217,119,6,.16) !important;
}
.cso-err { font-size: 10.5px; color: #dc2626; font-weight: 600; }

/* Master-load shimmer */
@keyframes cso-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.cso-skel {
  display: block; border-radius: 8px;
  background: linear-gradient(90deg, #fef3c7 0%, #fffbeb 50%, #fef3c7 100%);
  background-size: 800px 100%; animation: cso-shimmer 1.3s ease-in-out infinite;
}
.cso-skel-label { width: 42%; height: 9px; border-radius: 4px; margin-bottom: 6px; }
.cso-skel-input { width: 100%; height: 36px; }
.cso-skel-area  { width: 100%; height: 60px; margin-top: 6px; }
@media (prefers-reduced-motion: reduce) { .cso-skel { animation: none; } }
[data-bs-theme="dark"] .cso-skel {
  background: linear-gradient(90deg, rgba(252,191,36,.10) 0%, rgba(252,191,36,.22) 50%, rgba(252,191,36,.10) 100%);
  background-size: 800px 100%;
}

.cso-input-prefix { display: flex; align-items: center; gap: 0; position: relative; }
.cso-input-prefix > span {
  position: absolute; left: 12px;
  font-size: 11px; color: #b45309; font-weight: 800;
  pointer-events: none; letter-spacing: .02em;
}
/* Wider left pad so a 3-letter currency code (e.g. SGD) clears the input text. */
.cso-input-prefix-input { padding-left: 46px; }

/* Attach */
.cso-att-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 36px; }
.cso-att-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px;
  border: 1.5px dashed #d97706; border-radius: 8px;
  background: #fffaf0; color: #b45309;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; transition: all .12s;
}
.cso-att-btn:hover { background: #fef3c7; border-style: solid; }
.cso-att-chips { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.cso-att-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 5px 3px 9px; border-radius: 999px;
  background: #fef3c7; color: #92400e; border: 1px solid #fde68a;
  font-size: 10.5px; font-weight: 600;
  max-width: 160px;
}
.cso-att-name { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cso-att-dl, .cso-att-x {
  background: transparent; border: none; cursor: pointer;
  color: #92400e; padding: 1px 3px; line-height: 1;
  display: inline-flex; align-items: center; border-radius: 4px;
}
.cso-att-dl:hover { background: rgba(217,119,6,.18); }
.cso-att-x { font-weight: 800; font-size: 12px; }
.cso-att-x:hover { background: rgba(239,68,68,.18); color: #dc2626; }

/* Remarks (full-width) */
.cso-remarks { margin-top: 16px; }
.cso-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #fde68a; border-radius: 8px;
  background: #fffef9; font-size: 12.5px; color: #1e293b;
  outline: none; font-family: inherit;
  resize: vertical; min-height: 60px;
  transition: border-color .15s, box-shadow .15s;
}
.cso-textarea:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.16); }

/* Footer */
.cso-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; gap: 12px;
  background: #fffaf0;
  border-top: 1px solid #fde68a;
}
.cso-foot-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #b45309; font-weight: 600;
}
.cso-foot-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #dc2626;
}
.cso-foot-actions { display: flex; gap: 10px; }
.cso-btn {
  padding: 9px 22px; border-radius: 8px;
  font-family: inherit; font-weight: 700; font-size: 12.5px; cursor: pointer;
  border: 1.5px solid transparent;
  min-width: 130px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.cso-btn-cancel {
  background: #fff; border-color: #cbd5e1; color: #475569;
}
.cso-btn-cancel:hover:not(:disabled) { background: #f1f5f9; }
.cso-btn-primary {
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  box-shadow: 0 4px 12px rgba(217,119,6,.35);
}
.cso-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #d97706, #b45309);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(217,119,6,.50);
}
.cso-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }

/* Dark mode */
[data-bs-theme="dark"] .cso-modal { background: #1a1538; }
[data-bs-theme="dark"] .cso-body  { background: #1a1538; }
[data-bs-theme="dark"] .cso-strip {
  background: rgba(252,191,36,.10); border-color: rgba(252,191,36,.30);
}
[data-bs-theme="dark"] .cso-strip-cell {
  border-right-color: rgba(252,191,36,.20);
  border-bottom-color: rgba(252,191,36,.20);
}
[data-bs-theme="dark"] .cso-strip-label { color: #fde68a; }
[data-bs-theme="dark"] .cso-strip-val   { color: #ede9fe; }
[data-bs-theme="dark"] .cso-strip-val-highlight { color: #fbbf24; }
[data-bs-theme="dark"] .cso-flabel { color: #fde68a; }
[data-bs-theme="dark"] .cso-section-title { color: #fde68a; }
[data-bs-theme="dark"] .cso-input,
[data-bs-theme="dark"] .cso-textarea {
  background: rgba(252,191,36,.06); border-color: rgba(252,191,36,.30); color: #ede9fe;
}
/* Dark-mode dropdown (MasterSelect) toggles + currency prefix — without these
   the form forced a near-white toggle in dark mode and the value was unreadable. */
[data-bs-theme="dark"] .cso-grid .master-select-toggle {
  background: rgba(252,191,36,.06); border-color: rgba(252,191,36,.30);
}
[data-bs-theme="dark"] .cso-grid .master-select-toggle:hover:not(:disabled) {
  border-color: rgba(252,191,36,.5);
}
[data-bs-theme="dark"] .cso-input-prefix > span { color: #fbbf24; }
[data-bs-theme="dark"] .cso-att-btn {
  background: rgba(252,191,36,.10); color: #fde68a; border-color: rgba(252,191,36,.45);
}
[data-bs-theme="dark"] .cso-att-btn:hover { background: rgba(252,191,36,.20); }
[data-bs-theme="dark"] .cso-att-chip {
  background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.40);
}
[data-bs-theme="dark"] .cso-att-dl,
[data-bs-theme="dark"] .cso-att-x { color: #fde68a; }
[data-bs-theme="dark"] .cso-foot { background: #1a1538; border-top-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .cso-foot-note { color: #fde68a; }
[data-bs-theme="dark"] .cso-btn-cancel {
  background: #1f1845; border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
[data-bs-theme="dark"] .cso-btn-cancel:hover:not(:disabled) { background: #2a2150; }

@media (max-width: 1000px) {
  .cso-strip { grid-template-columns: repeat(2, 1fr); }
  .cso-strip-cell:nth-child(4n) { border-right: 1px solid #fde68a; }
  .cso-strip-cell:nth-child(2n) { border-right: none; }
  .cso-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .cso-grid { grid-template-columns: 1fr; }
  .cso-head { flex-direction: column; align-items: flex-start; }
  .cso-head-right { width: 100%; flex-wrap: wrap; }
}
`;
