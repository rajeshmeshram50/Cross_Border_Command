import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import Tooltip from '../../../../../components/ui/Tooltip';
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
  /* Domestic only — shown in the header next to the customer name.
   * `customerStateCode` is the PI's place-of-supply state_code (e.g.
   * "27 – Maharashtra"), falling back to the GSTIN's leading 2 digits. */
  customerGstNumber?: string | null;
  customerStateCode?: string | null;
  consigneeCode?:  string | null;
  consigneeName?:  string | null;
  /* Pre-fills carried over from the PI / quotation if available. */
  incoTerm?:       string | null;
  portOfLoading?:  string | null;
  portOfDischarge?: string | null;   // → seeds Port of Unloading
  finalDestination?: string | null;
  originCountry?:  string | null;
  shippingCost?:   number | string | null;   // PI shipping cost → seeds Freight Cost (editable)
  /* Domestic only — the PI's dispatch_from / deliver_to seed Place of Dispatch
   * / Place of Delivery on the form (editable). */
  placeOfDispatch?: string | null;
  placeOfDelivery?: string | null;
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

/* A shipment carries ONE attachment, capped at 2 MB (matches the backend rule
 * attachments.* max:2048). A single 2 MB file sits well under PHP's stock 8 MB
 * post_max_size, so no server config is needed and "Post data is too long" can't
 * happen through this form. */
const MAX_ATTACH_FILE = 2 * 1024 * 1024;    // 2 MB

const IcoDl = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

/* Attachment chips, collapsed: first file inline + a "+N" badge that opens a
 * portalled popover for the rest. Same behaviour as the Procurement modal —
 * auto-flips above the badge when there's no room below, caps its height to the
 * space available, and a scroll INSIDE the list doesn't dismiss it. */
function ShpAttachChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const popRef  = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const overflow = files.slice(1);

  const openPop = () => {
    const r = moreRef.current?.getBoundingClientRect();
    if (!r) return;
    const GAP = 6, MARGIN = 12, CAP = 260;
    const estH = Math.min(CAP, 30 + overflow.length * 30);
    const spaceBelow = window.innerHeight - r.bottom - GAP - MARGIN;
    const spaceAbove = r.top - GAP - MARGIN;
    const flipUp = spaceBelow < estH && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(CAP, flipUp ? spaceAbove : spaceBelow));
    const top = flipUp ? Math.max(MARGIN, r.top - GAP - maxHeight) : r.bottom + GAP;
    setPopPos({ top, left: Math.min(r.left, window.innerWidth - 296), maxHeight });
  };
  const closePop = () => setPopPos(null);

  useEffect(() => {
    if (!popPos) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closePop();
    };
    // A scroll inside the popover's own list must NOT close it.
    const onMove = (e: Event) => { if (e.target instanceof Node && popRef.current?.contains(e.target)) return; closePop(); };
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

  useEffect(() => { if (files.length <= 1) closePop(); }, [files.length]);

  if (files.length === 0) return null;

  const chip = (f: File, realIdx: number, block?: boolean) => (
    <span className={`cso-att-chip${block ? ' cso-att-chip-block' : ''}`} title={f.name}>
      <span className="cso-att-name">{f.name}</span>
      <button type="button" onClick={() => downloadFile(f)} className="cso-att-dl" title="Download"><IcoDl /></button>
      <button type="button" onClick={() => onRemove(realIdx)} className="cso-att-x" title="Remove">×</button>
    </span>
  );

  return (
    <div className="cso-att-chips">
      {chip(files[0], 0)}
      {overflow.length > 0 && (
        <button
          type="button" ref={moreRef}
          className={`cso-att-more ${popPos ? 'cso-att-more-on' : ''}`}
          onClick={() => (popPos ? closePop() : openPop())}
          title={`${overflow.length} more attachment${overflow.length === 1 ? '' : 's'}`}
        >
          +{overflow.length}
        </button>
      )}
      {popPos && overflow.length > 0 && createPortal(
        <div ref={popRef} className="cso-att-pop" style={{ top: popPos.top, left: popPos.left, maxHeight: popPos.maxHeight }}>
          <div className="cso-att-pop-head">{overflow.length} more attachment{overflow.length === 1 ? '' : 's'}</div>
          {/* realIdx = i + 1 — the overflow list starts at the second file. */}
          {overflow.map((f, i) => <div key={i + 1}>{chip(f, i + 1, true)}</div>)}
        </div>,
        document.body,
      )}
    </div>
  );
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
  /* Domestic-only fields. They persist to their OWN columns (pin_code /
   * place_of_dispatch / place_of_delivery) rather than reusing the export ones,
   * so the two flows' data can never blur together. */
  const [placeOfDispatch, setPlaceOfDispatch] = useState('');
  const [placeOfDelivery, setPlaceOfDelivery] = useState('');
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
    // Domestic: seed Place of Dispatch / Delivery from the PI (dispatch_from /
    // deliver_to) so ops doesn't re-key what the invoice already captured. Both
    // stay editable.
    setPlaceOfDispatch(context.placeOfDispatch ?? '');
    setPlaceOfDelivery(context.placeOfDelivery ?? '');
    setRemarks('');
    setAttachments([]);
    setErrors({});
  }, [open, context]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!shippingLiability) e.shippingLiability = 'Required';
    if (!coldChain)         e.coldChain         = 'Required';
    if (!shippingMode)      e.shippingMode      = 'Required';   // "Mode of Transport"
    // Cost is one required field in both flows, just under different labels
    // (Shipping Cost / Freight Cost) writing to different columns.
    if (!freightCost || !Number.isFinite(Number(freightCost)) || Number(freightCost) < 0)
      e.freightCost = 'Positive number required';

    if (isDomestic) {
      /* Domestic: PIN Code (strict Indian 6-digit, matching the server rule)
       * plus Place of Dispatch / Delivery. No INCO term, no ports, no origin
       * country — those fields aren't even rendered. */
      if (!zipCode.trim()) e.zipCode = 'Required';
      else if (!/^\d{6}$/.test(zipCode.trim())) e.zipCode = 'PIN Code must be exactly 6 digits';
      if (!placeOfDispatch.trim()) e.placeOfDispatch = 'Required';
      if (!placeOfDelivery.trim()) e.placeOfDelivery = 'Required';
    } else {
      // International: ZIP + the full export block.
      if (!zipCode.trim()) e.zipCode = 'Required';
      else if (zipCode.trim().length > 12) e.zipCode = 'Must be 12 characters or fewer';
      if (!incoTerm.trim())        e.incoTerm        = 'Required';
      if (!portOfLoading.trim())   e.portOfLoading   = 'Required';
      if (!portOfUnloading.trim()) e.portOfUnloading = 'Required';
      if (!finalDestination.trim()) e.finalDestination = 'Required';
    }
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
      // "Mode of Transport" — one column, both flows.
      fd.append('shipping_mode',      shippingMode);

      /* Post ONLY the fields belonging to this PI's doc type. The two flows
       * have their own columns (pin_code/shipping_cost/place_* vs
       * zip_code/freight_cost/port_*), so sending only one set keeps a row's
       * data where it belongs. The server derives doc_type from the PI and
       * ignores the other set anyway — this just avoids sending it at all. */
      if (isDomestic) {
        fd.append('pin_code',          zipCode.trim());        // PIN Code
        fd.append('shipping_cost',     freightCost);           // Shipping Cost
        fd.append('place_of_dispatch', placeOfDispatch.trim());
        fd.append('place_of_delivery', placeOfDelivery.trim());
      } else {
        fd.append('zip_code',           zipCode.trim());
        fd.append('freight_cost',       freightCost);
        /* INCO Term is stored by master id — the label goes along as the
         * historical snapshot so the row still reads correctly if the master
         * row is later deleted. A value carried over from the PI that no
         * longer matches a master option sends the label only. */
        if (incoTerm.trim()) {
          fd.append('inco_term', incoTerm.trim());
          const incoId = masters.incoterms.find(o => o.value === incoTerm)?.id;
          if (incoId) fd.append('inco_term_id', String(incoId));
        }
        if (portOfLoading.trim())    fd.append('port_of_loading',   portOfLoading.trim());
        if (portOfUnloading.trim())  fd.append('port_of_unloading', portOfUnloading.trim());
        fd.append('final_destination', finalDestination.trim());
        if (originCountry.trim())    fd.append('origin_country',    originCountry.trim());
      }
      if (remarks.trim())         fd.append('remarks',           remarks.trim());
      attachments.forEach((f, i) => fd.append(`attachments[${i}]`, f));

      await api.post('/sales/shipment-orders', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Shipment Order created', 'Logistics team can now pick this up for dispatch.');
      onCreated();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      /* Body-too-large: PHP rejects the POST before Laravel, so there's no JSON
         `errors`. Detect the 413 / post_max_size overflow and explain it in size
         terms instead of the generic "Save failed". The frontend guard above
         normally prevents this; this is the backstop if the server's limit is
         lower than ours (e.g. a mod_php host that ignores .user.ini). */
      const status = e?.response?.status;
      const raw = typeof e?.response?.data === 'string' ? e.response.data : '';
      if (status === 413 || /post ?data|content length|exceeds the limit|entity too large/i.test(`${msg ?? ''} ${raw}`)) {
        toast.error('Attachment too large', 'The attachment is over the server limit. Use a file under 2 MB.');
        return;
      }
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
    /* Send the PI id too: the prefix depends on its doc_type (DSHP- vs SHP-)
       and each has its own sequence, so without it the header would preview a
       code from the wrong series. */
    api.get<{ status: boolean; code: string }>('/sales/shipment-orders/next-code', {
      params: { lead_id: leadId ?? undefined, proforma_invoice_id: context.piId ?? undefined },
    })
      .then(({ data }) => { if (!cancelled) setPreviewShpCode(data.code || '—'); })
      .catch(() => { if (!cancelled) setPreviewShpCode('—'); });
    return () => { cancelled = true; };
  }, [open, leadId, context.piId]);

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
    <div className="cso-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <style>{SCOPED_CSS}</style>
      <div className="cso-modal" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        {/* Save lock — while saving, blanket the whole modal so no field,
            dropdown, attachment control or button stays interactive (QA #131). */}
        {submitting && (
          <div className="cso-save-lock" role="status" aria-live="polite">
            <span className="cso-save-spin" />
            <span className="cso-save-lock-txt">Saving…</span>
          </div>
        )}
        {/* Header — amber gradient */}
        <div className="cso-head">
          <div className="cso-head-left">
            <span className="cso-head-ico">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </span>
            <div>
              {/* Name the flow in the title — the form's fields, the ID prefix
                  (DSHP-/SHP-) and the columns written all differ by type, so
                  it should be obvious which one you're filling in. */}
              <div className="cso-head-title">Create Shipment — {isDomestic ? 'Domestic' : 'International'}</div>
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
          {/* 5 columns for Domestic (10 cells → 5×2), 4 for International
              (8 cells → 4×2). Either way the strip stays exactly 2 rows. */}
          <div className={`cso-strip ${isDomestic ? 'cso-strip-5' : ''}`}>
            <Cell label="OPPORTUNITY ID"  value={context.oppCode || '—'}  highlight />
            <Cell label="OPPORTUNITY DATE" value={fmtDate(context.oppDate)} />
            <Cell label="PI NO"           value={context.piCode || '—'}    highlight />
            <Cell label="PI DATE"         value={fmtDate(context.piDate)} />
            <Cell label="CUSTOMER ID"     value={context.customerCode || '—'} highlight />
            <Cell label="CUSTOMER NAME"   value={context.customerName || '—'} />
            {/* Domestic shipments carry the buyer's GST identity — the GSTIN and
                its place-of-supply state code. Read-only, straight from the
                customer record; export shipments have no Indian GST. */}
            {isDomestic && <Cell label="GST NUMBER" value={context.customerGstNumber || '—'} highlight />}
            {isDomestic && <Cell label="STATE CODE" value={context.customerStateCode || '—'} highlight />}
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
            {/* ZIP ⇄ PIN — same slot, different label + rule per doc type.
                Domestic writes pin_code, International writes zip_code. */}
            <Field label={isDomestic ? 'PIN Code' : 'Zip Code'} required error={errors.zipCode}>
              <input className={`cso-input ${errors.zipCode ? 'cso-input-err' : ''}`}
                value={zipCode}
                inputMode={isDomestic ? 'numeric' : 'text'}
                maxLength={isDomestic ? 6 : 12}
                onChange={(e) => {
                  // Domestic PIN is strictly 6 digits — block non-numeric input.
                  const v = isDomestic ? e.target.value.replace(/\D/g, '') : e.target.value;
                  setZipCode(v);
                  if (errors.zipCode) setErrors(p => ({ ...p, zipCode: '' }));
                }}
                placeholder={isDomestic ? 'Enter 6-digit PIN code' : 'Enter zip code'} />
            </Field>

            {/* Freight Cost ⇄ Shipping Cost — Domestic writes shipping_cost. */}
            <Field label={`${isDomestic ? 'Shipping Cost' : 'Freight Cost'}${curCode ? ` (${curCode})` : ''}`} required error={errors.freightCost}>
              <div className="cso-input-prefix">
                {/* Currency follows the PI — short code only (e.g. SGD), not $. */}
                <span className="cso-input-cur">{curCode || '—'}</span>
                <input className={`cso-input cso-input-prefix-input ${errors.freightCost ? 'cso-input-err' : ''}`}
                  type="number" min="0" step="any"
                  value={freightCost} onChange={(e) => setFreightCost(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <Field label="Mode of Transport" required error={errors.shippingMode}>
              <MasterSelect
                value={shippingMode}
                onChange={(v) => { setShippingMode(String(v)); if (errors.shippingMode) setErrors(p => ({ ...p, shippingMode: '' })); }}
                options={SHIPPING_MODE_OPTIONS}
                placeholder="— Select —"
              />
            </Field>

            {isDomestic ? (
              /* Domestic: the whole export block (INCO Term, both ports, Final
                 Destination, Origin Country) is replaced by these two. */
              <>
                <Field label="Place of Dispatch" required error={errors.placeOfDispatch}>
                  <input className={`cso-input ${errors.placeOfDispatch ? 'cso-input-err' : ''}`}
                    value={placeOfDispatch}
                    onChange={(e) => { setPlaceOfDispatch(e.target.value); if (errors.placeOfDispatch) setErrors(p => ({ ...p, placeOfDispatch: '' })); }}
                    placeholder="e.g. Pune, Maharashtra" />
                </Field>
                <Field label="Place of Delivery" required error={errors.placeOfDelivery}>
                  <input className={`cso-input ${errors.placeOfDelivery ? 'cso-input-err' : ''}`}
                    value={placeOfDelivery}
                    onChange={(e) => { setPlaceOfDelivery(e.target.value); if (errors.placeOfDelivery) setErrors(p => ({ ...p, placeOfDelivery: '' })); }}
                    placeholder="e.g. Delhi, Delhi" />
                </Field>
              </>
            ) : (
              <>
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
                <Field label="Port of Loading" required error={errors.portOfLoading}>
                  <MasterSelect
                    key={`pol-${masters.ports.length}`}
                    value={portOfLoading}
                    loading={masters.loading}
                    placeholder="— Select Port —"
                    options={withCurrent(masters.ports, portOfLoading)}
                    onChange={(v) => { setPOL(String(v)); if (errors.portOfLoading) setErrors(p => ({ ...p, portOfLoading: '' })); }}
                  />
                </Field>
                <Field label="Port of Unloading" required error={errors.portOfUnloading}>
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
              </>
            )}
            <Field label="Attachment">
              <div className="cso-att-row">
                <button type="button" className="cso-att-btn" onClick={() => fileRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Attach File
                </button>
                {/* SINGLE file only (no `multiple`): a shipment carries one
                    attachment. Picking a new file REPLACES the current one. */}
                <input type="file" hidden ref={fileRef}
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    // Only images + PDF (matches the backend magic_mime rule).
                    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
                    if (!['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
                      toast.error('File not supported', 'Please attach only JPG, PNG, WEBP or PDF files.');
                      return;
                    }
                    // Per-file cap = backend attachments.* max:2048 (2 MB).
                    if (f.size > MAX_ATTACH_FILE) {
                      toast.error('File too large', 'The attachment must be 2 MB or smaller.');
                      return;
                    }
                    setAttachments([f]);   // replace — only one attachment per shipment
                  }} />
                <ShpAttachChips
                  files={attachments}
                  onRemove={(i) => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                />
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
      {/* Values are clipped to one line (see .cso-strip-val) so a long company
          name can't stretch the strip — the full text is on the tooltip. No
          tooltip for an empty "—" placeholder: there's nothing to reveal. */}
      <Tooltip label={value && value !== '—' ? value : ''} themed maxWidth={420}>
        <div className={`cso-strip-val ${highlight ? 'cso-strip-val-highlight' : ''}`}>{value}</div>
      </Tooltip>
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

/* Save lock overlay (QA #131) — blankets the modal while saving so every
   field, dropdown, attachment control and button is un-interactable. */
.cso-save-lock {
  position: absolute; inset: 0; z-index: 60;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(255,250,240,.72); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  cursor: progress; border-radius: inherit;
}
.cso-save-lock-txt { font-size: 13px; font-weight: 800; color: #b45309; letter-spacing: .02em; }
.cso-save-spin {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid rgba(245,158,11,.28); border-top-color: #d97706;
  animation: cso-save-spin .7s linear infinite;
}
@keyframes cso-save-spin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .cso-save-lock { background: rgba(28,22,10,.74); }
[data-bs-theme="dark"] .cso-save-lock-txt { color: #fcd34d; }

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
  /* Grid items default to min-width:auto (= content width), which would let a
     long value push the column wider instead of ellipsising. */
  min-width: 0;
}
.cso-strip-cell:nth-child(4n)   { border-right: none; }
.cso-strip-cell:nth-last-child(-n+4) { border-bottom: none; }

/* Domestic adds GST Number + State Code = 10 cells. At 4 columns that spills to
   a 3rd row, so switch to 5 columns and it lands as a clean 5×2. International
   has 8 cells and stays 4×2. */
.cso-strip-5 { grid-template-columns: repeat(5, 1fr); }
.cso-strip-5 .cso-strip-cell:nth-child(4n)          { border-right: 1px solid #fde68a; }
.cso-strip-5 .cso-strip-cell:nth-last-child(-n+4)   { border-bottom: 1px solid #fde68a; }
.cso-strip-5 .cso-strip-cell:nth-child(5n)          { border-right: none; }
.cso-strip-5 .cso-strip-cell:nth-last-child(-n+5)   { border-bottom: none; }
.cso-strip-label {
  font-size: 10px; font-weight: 800; letter-spacing: .08em;
  color: #92400e; text-transform: uppercase;
  margin-bottom: 3px;
}
/* One line, ellipsis on overflow — a long customer/consignee name must not
   widen its column or wrap the strip taller. min-width:0 on the cell is what
   actually lets a grid item shrink below its content width. */
.cso-strip-val {
  font-size: 12.5px; font-weight: 700; color: #1e293b;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
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
/* Single line now: first chip + the "+N" badge. The chip shrinks (ellipsis) so
   the badge never wraps to a second row. */
.cso-att-chips { display: inline-flex; gap: 5px; flex-wrap: nowrap; align-items: center; min-width: 0; }
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

/* "+N" overflow badge — folds the extra attachments into one pill so the row
   stays a single line instead of a big wrapping grid. */
.cso-att-more {
  display: inline-flex; align-items: center; justify-content: center;
  height: 22px; padding: 0 10px; border-radius: 999px; flex: 0 0 auto;
  background: linear-gradient(135deg, #d97706, #b45309); color: #fff;
  border: 1px solid #b45309; white-space: nowrap;
  font-family: inherit; font-size: 10.5px; font-weight: 800;
  cursor: pointer; transition: filter .12s;
}
.cso-att-more:hover, .cso-att-more-on { filter: brightness(1.08); }
/* Overflow popover — fixed + portalled; position + max-height set inline from
   the badge's rect (auto-flips above when there's no room below). */
.cso-att-pop {
  position: fixed; z-index: 1100;
  width: 280px; overflow-y: auto; overscroll-behavior: contain;
  background: #fffdf7; border: 1.5px solid #fde68a; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15,23,42,.22);
  padding: 8px; display: flex; flex-direction: column; gap: 5px;
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.cso-att-pop::-webkit-scrollbar { width: 8px; }
.cso-att-pop::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.cso-att-pop-head {
  font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: #b45309; padding: 2px 4px 5px;
  border-bottom: 1px solid #fef3c7; margin-bottom: 2px;
}
/* Block chip fills the popover row so download + remove sit at the right. */
.cso-att-chip-block { display: flex; max-width: none; }
.cso-att-chip-block .cso-att-name { flex: 1 1 auto; max-width: none; }
[data-bs-theme="dark"] .cso-att-more { background: linear-gradient(135deg, #d97706, #b45309); border-color: rgba(217,119,6,.6); }
[data-bs-theme="dark"] .cso-att-pop { background: #221803; border-color: rgba(217,119,6,.40); box-shadow: 0 12px 32px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .cso-att-pop-head { color: #fbbf24; border-bottom-color: rgba(217,119,6,.30); }

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
