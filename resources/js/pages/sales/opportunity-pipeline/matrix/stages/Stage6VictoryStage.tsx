import { useEffect, useMemo, useState } from 'react';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import CreateShipmentOrderModal, { type ShipmentInitialContext } from './CreateShipmentOrderModal';
import RupeeRain from './RupeeRain';
import { resolveFileUrl } from '../../../../../utils/resolveFileUrl';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 6: Victory Stage
 *
 *  Celebration view + Shipment Order flow:
 *   1. Initial visit  → confetti burst + "Create Shipment ID" CTA
 *   2. Click CTA      → opens the amber Shipment Order modal (ported
 *                       from IDIMS's BT module)
 *   3. After save     → CTA replaced by SHP-### details card with the
 *                       full shipping + logistics block
 *
 *  Data sources:
 *   GET /sales/leads/{id}                           lead + won_at
 *   GET /sales/quotations?opp_id={id}&per_page=1    latest quote
 *   GET /sales/proforma-invoices?opp_id={id}&p=1    latest PI
 *   GET /sales/leads/{id}/shipment-order            shipment (if any)
 * ───────────────────────────────────────────────────────────────────── */

type LeadDetail = {
  id:            number;
  won_at:        string | null;
  created_at?:   string | null;
  opportunity_date_iso?: string | null;  // ISO opportunity date (query_time ?? created_at)
  pi_signed_at?: string | null;   // when the PI was e-signed (null = not signed)
  pi_sent_at?:   string | null;   // when the PI was sent for signature (fallback end-date)
  qualified:     boolean;
  lead_stage_id: number;
  sender_country_iso?: string | null;
  customer?:     { id: number; company_name: string | null; customer_code: string | null; gst_number?: string | null } | null;
  consignee?:    { id: number; company_name: string | null; consignee_code?: string | null } | null;
};

type DealDoc = {
  id:         number;
  code:       string | null;
  currency:   string | null;
  grand_total:number | string | null;
  created_at: string;
  // Domestic / International — drives the Create-Shipment form's conditional
  // fields (INCO Term hidden + ports optional for Domestic).
  doc_type?:          string | null;
  /* Place of supply — REQUIRED on a Domestic PI, and the authority for the
   * shipment header's State Code. Stored as the full label ("27 – Maharashtra"). */
  state_code?:        string | null;
  // Logistics fields carried over to the Create-Shipment form (PI rows
  // return the full model, so these are present on the latest PI).
  inco_term?:         string | null;
  port_of_loading?:   string | null;
  port_of_discharge?: string | null;
  final_destination?: string | null;
  origin_country?:    string | null;
  shipping?:          number | string | null;   // PI shipping cost → seeds Freight Cost
  /* Domestic PI fields — seed the shipment's Place of Dispatch / Delivery and
   * (preferred over the customer relation) the header GST number. */
  dispatch_from?:     string | null;
  deliver_to?:        string | null;
  customer_gst_no?:   string | null;
};

type Shipment = {
  id:                   number;
  // Real, per-client sequential Shipment ID (e.g. "SHP-258"). Display THIS —
  // never fabricate one from the primary key `id`, which gives the wrong code.
  shipment_code:        string | null;
  lead_id:              number;
  proforma_invoice_id:  number | null;
  shipping_liability:   string | null;
  cold_chain:           boolean;
  // Labelled "Mode of Transport" — one column, both flows.
  shipping_mode:        string | null;
  /* A row populates the export set OR the domestic set, never both — decided by
   * its PI's doc_type. See the add_domestic_fields_to_shipment_orders migration. */
  // International only
  zip_code:             string | null;
  freight_cost:         number | string | null;
  inco_term:            string | null;
  port_of_loading:      string | null;
  port_of_unloading:    string | null;
  final_destination:    string | null;
  origin_country:       string | null;
  // Domestic only
  pin_code?:            string | null;
  shipping_cost?:       number | string | null;
  place_of_dispatch?:   string | null;
  place_of_delivery?:   string | null;
  remarks:              string | null;
  attachments:          string[] | null;
  /* Absolute URLs built server-side (file_url). Prefer these over resolving the
     bare `attachments` path on the client — a client-built URL resolves against
     the SPA origin and gets bounced to the dashboard by the router (QA #55). */
  attachments_url?:     string[] | null;
  created_at:           string;
  proforma_invoice?:    { id: number; code: string | null; created_at: string } | null;
  creator?:             { id: number; name: string } | null;
};

const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  // DD-Mon-YYYY (e.g. 04-Jul-2026)
  return `${String(d.getDate()).padStart(2, '0')}-${DMY_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

const fmtMoney = (v: number | string | null | undefined, ccy: string | null | undefined): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return `${ccy ?? ''} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};

const fmtCcy = (v: number | string | null | undefined, ccy = '$'): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  // Domestic shipping cost is in INR (₹); export freight cost in USD ($).
  return `${ccy} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* B28: persist "already celebrated" leads in localStorage so the
 *  confetti fires exactly once per lead across tab reloads / navigation
 *  away and back. The earlier module-Set lived only for the lifetime
 *  of the SPA session, so closing + reopening the tab re-confetti'd
 *  every won deal. */
const CELEBRATED_KEY = 'cbc_stage6_celebrated_leads';
const loadCelebrated = (): Set<number> => {
  try {
    const raw = localStorage.getItem(CELEBRATED_KEY);
    if (!raw) return new Set<number>();
    const arr = JSON.parse(raw);
    return new Set<number>(Array.isArray(arr) ? arr.filter(n => typeof n === 'number') : []);
  } catch {
    return new Set<number>();
  }
};
const persistCelebrated = (s: Set<number>): void => {
  try {
    /* Cap the stored list at 500 entries so a long-lived user doesn't
     *  bloat localStorage. FIFO eviction keeps the most recent N. */
    const arr = Array.from(s);
    const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify(trimmed));
  } catch {
    /* Quota errors or private-mode → silent no-op; worst case is the
     *  user re-sees confetti next session. Not worth blocking the UI. */
  }
};
const celebratedLeads = loadCelebrated();

export default function Stage6VictoryStage({ header, onPrev }: StageProps) {
  const toast = useToast();
  const leadId = header.leadId ?? null;

  const [loading, setLoading]       = useState(false);
  const [lead, setLead]             = useState<LeadDetail | null>(null);
  const [latestQt, setLatestQt]     = useState<DealDoc | null>(null);
  const [latestPi, setLatestPi]     = useState<DealDoc | null>(null);
  const [shipment, setShipment]     = useState<Shipment | null>(null);
  /* Which flow the SAVED shipment used — drives the Logistics Instructions
   * labels/fields below.
   *
   * The code prefix is the authority, not the PI: it was allocated from the
   * PI's doc_type at save time, so it can never drift from the columns that
   * were actually populated (a PI edited to a different doc_type afterwards
   * would otherwise make us render the wrong — all-empty — field set).
   * Fall back to the PI only for a legacy row with no recognisable code. */
  const shipmentIsDomestic = (() => {
    const code = (shipment?.shipment_code ?? '').toUpperCase();
    if (code.startsWith('DSHP-')) return true;
    if (code.startsWith('SHP-'))  return false;
    return (latestPi?.doc_type ?? '').trim().toLowerCase() === 'domestic';
  })();
  const [confetti, setConfetti]     = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // KPI counts shown above the Create-Shipment CTA (figma): how many
  // products / quotations / PIs the opportunity produced.
  const [counts, setCounts] = useState<{ products: number; quotations: number; pis: number }>(
    { products: 0, quotations: 0, pis: 0 });

  const fetchAll = async (silent = false) => {
    if (!leadId) return;
    if (!silent) setLoading(true);
    type Paged = { status: boolean; data: DealDoc[]; pagination?: { total: number } };
    const [leadRes, qtRes, piRes, shpRes, prodRes] = await Promise.allSettled([
      api.get<{ status: boolean; data: LeadDetail }>(`/sales/leads/${leadId}`),
      api.get<Paged>('/sales/quotations',        { params: { opp_id: leadId, per_page: 1 } }),
      api.get<Paged>('/sales/proforma-invoices', { params: { opp_id: leadId, per_page: 1 } }),
      api.get<{ status: boolean; data: Shipment | null }>(`/sales/leads/${leadId}/shipment-order`),
      api.get<{ status: boolean; data: unknown[] }>(`/sales/leads/${leadId}/products`),
    ]);
    if (leadRes.status === 'fulfilled') setLead(leadRes.value.data.data);
    else toast.error('Load failed', 'Could not load the lead summary.');
    if (qtRes.status === 'fulfilled')   setLatestQt(qtRes.value.data.data?.[0] ?? null);
    if (piRes.status === 'fulfilled')   setLatestPi(piRes.value.data.data?.[0] ?? null);
    if (shpRes.status === 'fulfilled')  setShipment(shpRes.value.data.data ?? null);
    // Counts: quotations / PIs come from pagination.total (the per_page:1
    // call still reports the full total); products from the array length.
    const qtTotal   = qtRes.status === 'fulfilled' ? (qtRes.value.data.pagination?.total ?? qtRes.value.data.data?.length ?? 0) : 0;
    const piTotal   = piRes.status === 'fulfilled' ? (piRes.value.data.pagination?.total ?? piRes.value.data.data?.length ?? 0) : 0;
    const prodTotal = prodRes.status === 'fulfilled' && Array.isArray(prodRes.value.data.data) ? prodRes.value.data.data.length : 0;
    setCounts({ products: prodTotal, quotations: qtTotal, pis: piTotal });
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    if (!leadId) return;
    void fetchAll(false);
    // A one-shot session flag set by Save & Next on Stage 5 forces the
    // celebration EVERY time the deal is freshly won — even for a lead that
    // already burst confetti before (the localStorage gate only fires once
    // per lead ever). Consume it so a later revisit / refresh doesn't re-fire.
    let forced = false;
    try {
      forced = sessionStorage.getItem('cbc_celebrate_victory') === String(leadId);
      if (forced) sessionStorage.removeItem('cbc_celebrate_victory');
    } catch { /* private mode → ignore */ }

    if (forced || !celebratedLeads.has(leadId)) {
      // Keep the once-per-lead gate in sync so the first-visit path doesn't
      // double-fire alongside a forced celebration.
      if (!celebratedLeads.has(leadId)) {
        celebratedLeads.add(leadId);
        persistCelebrated(celebratedLeads);
      }
      setConfetti(true);
      setTimeout(() => setConfetti(false), 15_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const wonOn = useMemo(() => fmtDate(lead?.won_at ?? null), [lead?.won_at]);

  // Opportunity date for the Shipment Details cell. `header.oppDate` is a
  // dd/mm/yyyy display string that fmtDate (new Date(...)) can't parse, so it
  // rendered as "—". Prefer the server's ISO opportunity date (query_time ??
  // created_at), then created_at, then fall back to the already-formatted
  // header string as-is.
  const oppDateText = useMemo(() => {
    const iso = lead?.opportunity_date_iso ?? lead?.created_at;
    if (iso) { const f = fmtDate(iso); if (f !== '—') return f; }
    return header.oppDate || '—';
  }, [lead?.opportunity_date_iso, lead?.created_at, header.oppDate]);

  // Days the deal took: from when the LEAD was created to the moment its PI
  // was SIGNED. Null (shows "—") until the PI is signed. Falls back to the
  // opportunity date if the lead's created_at isn't present.
  const days = useMemo(() => {
    /* Parse a date that may be ISO (from the server) OR a dd/mm/yyyy display
     * string (header.oppDate). `new Date('10/04/2026')` mis-reads dd/mm as
     * mm/dd, so reorder dd/mm/yyyy to yyyy-mm-dd before parsing. */
    const parse = (s?: string | null): Date | null => {
      if (!s) return null;
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
      const d = m ? new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00`)
                  : new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    // Start = opportunity date. Prefer the server's ISO opportunity date (the
    // SAME source the header shows — query_time ?? created_at), then created_at,
    // then the dd/mm/yyyy header string (which falls back to a hardcoded default
    // on a fresh page load). End = PI signed date, or — while the PI is still
    // pending — the date it was sent (pi_sent_at).
    const start = parse(lead?.opportunity_date_iso) ?? parse(lead?.created_at) ?? parse(header.oppDate);
    const end   = parse(lead?.pi_signed_at) ?? parse(lead?.pi_sent_at);
    if (!start || !end) return null;
    // Compare calendar dates only (ignore time-of-day) so the same date always
    // reads as 0 days, regardless of the timestamps' hours.
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay   = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    const d = Math.round((endDay - startDay) / 86_400_000);
    return d >= 0 ? d : null;
  }, [lead?.opportunity_date_iso, lead?.created_at, lead?.pi_signed_at, lead?.pi_sent_at, header.oppDate]);

  const dealValue = useMemo(() => {
    if (latestPi?.grand_total != null) return fmtMoney(latestPi.grand_total, latestPi.currency);
    if (latestQt?.grand_total != null) return fmtMoney(latestQt.grand_total, latestQt.currency);
    return '—';
  }, [latestPi, latestQt]);

  const shipmentInitialCtx: ShipmentInitialContext = useMemo(() => ({
    oppCode:         header.oppId,
    oppDate:         header.oppDate,
    piCode:          latestPi?.code ?? null,
    piDate:          latestPi?.created_at ?? null,
    piId:            latestPi?.id ?? null,
    piCurrency:      latestPi?.currency ?? null,
    // Domestic / International — gates the shipment form's INCO Term + ports.
    docType:         latestPi?.doc_type ?? null,
    customerCode:    lead?.customer?.customer_code ?? null,
    customerName:    lead?.customer?.company_name ?? header.customer,
    /* Domestic header only.
     * State Code comes from the PI's own `state_code` — that is the PLACE OF
     * SUPPLY the invoice was raised against (and what drives CGST/SGST vs
     * IGST), so it is the authority. Only fall back to deriving it from the
     * GSTIN's first 2 chars (27AADCI… → 27) on a legacy PI that has none. */
    /* Prefer the PI's own captured GST number; fall back to the customer
     * record. (The PI snapshots it at issue time, so it's the authority.) */
    customerGstNumber: latestPi?.customer_gst_no ?? lead?.customer?.gst_number ?? null,
    customerStateCode: latestPi?.state_code
      ?? ((latestPi?.customer_gst_no ?? lead?.customer?.gst_number ?? '').trim().slice(0, 2) || null),
    // PI dispatch_from / deliver_to → seed the shipment's dispatch/delivery.
    placeOfDispatch:   latestPi?.dispatch_from ?? null,
    placeOfDelivery:   latestPi?.deliver_to ?? null,
    consigneeCode:   lead?.consignee?.consignee_code ?? null,
    consigneeName:   lead?.consignee?.company_name ?? null,
    // Auto-fill the shipping/logistics fields shared with the Proforma
    // Invoice form so ops doesn't re-key them. PI's port_of_discharge maps
    // to the shipment's Port of Unloading.
    incoTerm:         latestPi?.inco_term ?? null,
    portOfLoading:    latestPi?.port_of_loading ?? null,
    portOfDischarge:  latestPi?.port_of_discharge ?? null,
    finalDestination: latestPi?.final_destination ?? null,
    originCountry:    latestPi?.origin_country ?? null,
    // PI's Shipping Cost pre-fills the shipment's Freight Cost (still editable).
    shippingCost:    latestPi?.shipping ?? null,
  }), [header.oppId, header.oppDate, header.customer, latestPi, lead]);

  const onShipmentCreated = () => {
    void fetchAll(true);
    /* Burst confetti again to celebrate the Shipment ID being created
     * (reuses the same one-shot effect as the initial victory landing). */
    setConfetti(true);
    setTimeout(() => setConfetti(false), 25_000);
  };

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE6_CSS}</style>

      <div className="smd-stg-head s6-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M6 9a6 6 0 0 0 12 0V3H6z" />
              <path d="M9 21h6M12 17v4" />
              <path d="M2 5h4M18 5h4" />
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 6: Victory Stage</div>
            <div className="smd-stg-head-sub">● Deal closed successfully</div>
          </div>
        </div>
        <span className="smd-stg-head-badge s6-badge">DEAL WON</span>
      </div>

      <div className="smd-stg-body s6-body">
        {confetti && <RupeeRain />}

        {/* ── A. Pre-shipment view: celebration + Create CTA + Deal Summary ── */}
        {!shipment && (
          <>
            <div className="s6-celebrate smd-fade-in">
              <div className="s6-trophy">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                  <path d="M6 9a6 6 0 0 0 12 0V3H6z" />
                  <path d="M9 21h6M12 17v4" />
                  <path d="M2 5h4M18 5h4" />
                </svg>
              </div>
              <div className="s6-title">Congratulations!</div>
              <div className="s6-quote">"Every win counts — keep the momentum going."</div>

              {loading ? (
                <span className="smd-skel" style={{ width: 160, height: 24, marginTop: 12, borderRadius: 999 }} />
              ) : (
                <span className="s6-won-stamp">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  Won on {wonOn}
                </span>
              )}

              <button type="button" className="s6-cta" onClick={() => setCreateOpen(true)} disabled={loading}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Create Shipment ID
              </button>
            </div>

            <DealSummary
              loading={loading}
              header={header}
              wonOn={wonOn}
              lead={lead}
              latestQt={latestQt}
              latestPi={latestPi}
              dealValue={dealValue}
            />

            {/* KPI strip (figma) — quick deal-effort metrics shown before
                the Shipment ID is created. */}
            <div className="s6-kpis smd-fade-in">
              <KpiTile tone="blue"    label="PRODUCTS"  value={counts.products}   loading={loading}
                icon={<><rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 8l2.5-5h13L21 8M12 3v5"/></>} />
              <KpiTile tone="violet"  label="QUOTATIONS" value={counts.quotations} loading={loading}
                icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>} />
              <KpiTile tone="green"   label="PI ISSUED"  value={counts.pis}        loading={loading}
                icon={<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v3H9zM8 11h8M8 15h5"/></>} />
              <KpiTile tone="amber"   label="DAYS"       value={days ?? '0'}       loading={loading}
                icon={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />
            </div>
          </>
        )}

        {/* ── B. Post-shipment view: success banner + details + logistics ── */}
        {shipment && (
          <div className="s6-shp-wrap smd-fade-in">
            <div className="s6-success-banner">
              <div className="s6-success-left">
                <span className="s6-success-ico">🏆</span>
                <div>
                  <div className="s6-success-title">Deal Successfully Won!</div>
                  <div className="s6-success-sub">Shipment ID created and saved</div>
                </div>
              </div>
              <span className="s6-shp-code">{shipment.shipment_code || `SHP-${String(shipment.id).padStart(3, '0')}`}</span>
            </div>

            {/* SHIPMENT DETAILS */}
            <div className="s6-shp-card">
              <div className="s6-shp-card-head s6-shp-head-amber">
                <span className="s6-shp-ico">📦</span>
                SHIPMENT DETAILS
              </div>
              <div className="s6-shp-grid s6-shp-grid-4">
                <Cell label="SHIPMENT ID"      value={shipment.shipment_code || `SHP-${String(shipment.id).padStart(3, '0')}`} amber />
                <Cell label="SHIPMENT DATE"    value={fmtDate(shipment.created_at)} />
                <Cell label="OPPORTUNITY ID"   value={header.oppId} amber />
                <Cell label="OPPORTUNITY DATE" value={oppDateText} />
                <Cell label="PI NUMBER"        value={shipment.proforma_invoice?.code ?? latestPi?.code ?? '—'} amber />
                <Cell label="PI DATE"          value={fmtDate(shipment.proforma_invoice?.created_at ?? latestPi?.created_at ?? null)} />
                <Cell label="CREATED BY"       value={shipment.creator?.name ?? '—'} />
                <Cell label="DEAL VALUE"       value={dealValue} amber />
              </div>
            </div>

            {/* INQUIRY DETAILS */}
            <div className="s6-shp-card">
              <div className="s6-shp-card-head s6-shp-head-blue">
                <span className="s6-shp-ico">🔍</span>
                INQUIRY DETAILS
              </div>
              <div className="s6-shp-grid s6-shp-grid-3">
                <Cell label="CUSTOMER ID"      value={lead?.customer?.customer_code ?? '—'} blue />
                <Cell label="CUSTOMER NAME"    value={lead?.customer?.company_name ?? header.customer ?? '—'} />
                <Cell label="CUSTOMER COUNTRY" value={lead?.sender_country_iso ?? '—'} blue />
                <Cell label="CONSIGNEE ID"     value={lead?.consignee?.consignee_code ?? '—'} blue />
                <Cell label="CONSIGNEE NAME"   value={lead?.consignee?.company_name ?? '—'} />
                <Cell label="CONSIGNEE COUNTRY" value={lead?.sender_country_iso ?? '—'} blue />
              </div>
            </div>

            {/* LOGISTICS INSTRUCTIONS */}
            <div className="s6-shp-card">
              <div className="s6-shp-card-head s6-shp-head-emerald">
                <span className="s6-shp-ico">🚢</span>
                LOGISTICS INSTRUCTIONS
              </div>
              {/* Mirrors the Create-Shipment form exactly: a Domestic shipment
                  stores pin_code / shipping_cost / place_* and leaves every
                  export column NULL, so rendering the export labels here would
                  just print a wall of "—". Labels follow the same rename
                  (PIN Code, Shipping Cost, Mode of Transport). */}
              <div className="s6-shp-grid s6-shp-grid-3">
                <Cell label="SHIPPING LIABILITY" value={shipment.shipping_liability ?? '—'} emerald />
                <Cell label="COLD CHAIN"         value={shipment.cold_chain ? 'Yes — Required' : 'No — Not Required'} emerald />
                {shipmentIsDomestic ? (
                  /* 9 cells → three even rows of 3 in the 3-col grid.
                     GST Number + State Code are the buyer's GST identity: the
                     GSTIN from the customer, and the place of supply from the
                     PI (what drives CGST/SGST vs IGST). Export shipments have
                     no Indian GST, so they're domestic-only. */
                  <>
                    <Cell label="PIN CODE"          value={shipment.pin_code ?? '—'} />
                    <Cell label="SHIPPING COST"     value={fmtCcy(shipment.shipping_cost, '₹')} emerald />
                    <Cell label="MODE OF TRANSPORT" value={shipment.shipping_mode ?? '—'} emerald />
                    <Cell label="STATE CODE"        value={latestPi?.state_code ?? '—'} emerald />
                    <Cell label="GST NUMBER"        value={lead?.customer?.gst_number ?? '—'} />
                    <Cell label="PLACE OF DISPATCH" value={shipment.place_of_dispatch ?? '—'} />
                    <Cell label="PLACE OF DELIVERY" value={shipment.place_of_delivery ?? '—'} amber />
                  </>
                ) : (
                  <>
                    <Cell label="ZIP CODE"           value={shipment.zip_code ?? '—'} />
                    <Cell label="FREIGHT COST"       value={fmtCcy(shipment.freight_cost)} emerald />
                    <Cell label="MODE OF TRANSPORT"  value={shipment.shipping_mode ?? '—'} emerald />
                    <Cell label="INCO TERM"          value={shipment.inco_term ?? '—'} emerald />
                    {/* Port of Loading on its own full-width row, then
                        Unloading / Final Destination / Origin Country below. */}
                    <Cell label="PORT OF LOADING"    value={shipment.port_of_loading ?? '—'} wide />
                    <Cell label="PORT OF UNLOADING"  value={shipment.port_of_unloading ?? '—'} />
                    <Cell label="FINAL DESTINATION"  value={shipment.final_destination ?? '—'} amber />
                    <Cell label="ORIGIN COUNTRY"     value={shipment.origin_country ?? '—'} />
                  </>
                )}
                {shipment.remarks && (
                  <div className="s6-shp-cell s6-shp-cell-wide">
                    <div className="s6-shp-label">REMARKS</div>
                    <div className="s6-shp-val">{shipment.remarks}</div>
                  </div>
                )}
                {shipment.attachments && shipment.attachments.length > 0 && (
                  <div className="s6-shp-cell s6-shp-cell-wide">
                    <div className="s6-shp-label">ATTACHMENTS</div>
                    <div className="s6-shp-attach">
                      {shipment.attachments.map((a, i) => {
                        // Prefer the server-built absolute URL (index-matched);
                        // fall back to client resolution only for legacy rows.
                        const href = shipment.attachments_url?.[i] ?? resolveFileUrl(a);
                        return (
                        <a key={i} href={href} target="_blank" rel="noreferrer"
                          // Open via window.open with a cache-bust, exactly like the
                          // customer/consignee document viewers — a re-uploaded file
                          // then never shows a stale cached copy. The href stays for
                          // middle-click / right-click.
                          onClick={(e) => {
                            if (!href) return;
                            e.preventDefault();
                            window.open(`${href}${href.includes('?') ? '&' : '?'}t=${Date.now()}`, '_blank', 'noopener,noreferrer');
                          }}
                          className="s6-shp-attach-chip" title={a.split('/').pop() ?? 'Attachment'}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                          <span className="s6-shp-attach-name">{a.split('/').pop() ?? 'Attachment'}</span>
                        </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          {shipment
            ? <>🏆 <strong>All set.</strong> Shipment order saved — logistics can dispatch.</>
            : <>⚠ <strong>Note :</strong> Congratulations! Create the Shipment ID to complete this opportunity.</>}
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev} type="button">← Previous</button>
        </div>
      </div>

      <CreateShipmentOrderModal
        open={createOpen}
        leadId={leadId}
        context={shipmentInitialCtx}
        onClose={() => setCreateOpen(false)}
        onCreated={onShipmentCreated}
      />
    </>
  );
}

/* ── Deal Summary card (pre-shipment view) ── */
function DealSummary({ loading, header, wonOn, lead, latestQt, latestPi, dealValue }: {
  loading: boolean;
  header: StageProps['header'];
  wonOn: string;
  lead: LeadDetail | null;
  latestQt: DealDoc | null;
  latestPi: DealDoc | null;
  dealValue: string;
}) {
  return (
    <div className="s6-summary smd-fade-in">
      <div className="s6-summary-head">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
        </svg>
        <span>DEAL SUMMARY</span>
      </div>
      <div className="s6-summary-grid">
        <SummaryCell tone="violet" label="OPPORTUNITY ID">
          {loading ? <span className="smd-skel smd-skel-chip" /> : (header.oppId || '—')}
        </SummaryCell>
        <SummaryCell tone="blue" label="CUSTOMER">
          {loading ? <span className="smd-skel smd-skel-name" /> : (lead?.customer?.company_name ?? header.customer ?? '—')}
        </SummaryCell>
        <SummaryCell tone="amber" label="WON DATE">
          {loading ? <span className="smd-skel" style={{ maxWidth: 90 }} /> : wonOn}
        </SummaryCell>
        <SummaryCell tone="rose" label="LATEST QUOTATION">
          {loading ? <span className="smd-skel smd-skel-chip" /> : (
            latestQt?.code ? <span className="s6-code">{latestQt.code}</span> : <span className="s6-muted">—</span>
          )}
        </SummaryCell>
        <SummaryCell tone="emerald" label="LATEST PI">
          {loading ? <span className="smd-skel smd-skel-chip" /> : (
            latestPi?.code ? <span className="s6-code s6-code-emerald">{latestPi.code}</span> : <span className="s6-muted">—</span>
          )}
        </SummaryCell>
        <SummaryCell tone="green" label="DEAL VALUE">
          {loading ? <span className="smd-skel" style={{ maxWidth: 110 }} /> : (
            <span className="s6-value">{dealValue}</span>
          )}
        </SummaryCell>
        <SummaryCell tone="cyan" label="CONSIGNEE">
          {loading ? <span className="smd-skel smd-skel-name" /> : (lead?.consignee?.company_name ?? '—')}
        </SummaryCell>
        <SummaryCell tone="slate" label="STATUS">
          {loading ? <span className="smd-skel smd-skel-pill" /> : (
            <span className="s6-status">● Won</span>
          )}
        </SummaryCell>
      </div>
    </div>
  );
}

function SummaryCell({ tone, label, children }: {
  tone: 'violet'|'blue'|'amber'|'rose'|'emerald'|'green'|'cyan'|'slate';
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`s6-cell s6-cell-${tone}`}>
      <div className="s6-cell-label">{label}</div>
      <div className="s6-cell-value">{children}</div>
    </div>
  );
}

/* ── KPI tile (pre-shipment metrics strip) ── */
function KpiTile({ tone, label, value, icon, loading }: {
  tone: 'blue' | 'violet' | 'green' | 'amber';
  label: string;
  value: number | string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className={`s6-kpi s6-kpi-${tone}`}>
      <div className="s6-kpi-ico">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </div>
      <div className="s6-kpi-num">{loading ? <span className="smd-skel" style={{ width: 28, height: 22, borderRadius: 6 }} /> : value}</div>
      <div className="s6-kpi-label">{label}</div>
    </div>
  );
}

function Cell({ label, value, amber, blue, emerald, wide }: {
  label: string; value: string;
  amber?: boolean; blue?: boolean; emerald?: boolean; wide?: boolean;
}) {
  const tone = amber ? 's6-shp-amber' : blue ? 's6-shp-blue' : emerald ? 's6-shp-emerald' : '';
  return (
    <div className={`s6-shp-cell ${wide ? 's6-shp-cell-wide' : ''}`}>
      <div className="s6-shp-label">{label}</div>
      <div className={`s6-shp-val ${tone}`}>{value}</div>
    </div>
  );
}

const STAGE6_CSS = `
/* Lavender header — matches the figma + the rest of the stage chrome /
   side panels (was a one-off green). */
.s6-head { background: linear-gradient(110deg, #ede9fe 0%, #ddd6fe 40%, #c4b5fd 100%); border-bottom: 1px solid #c4b5fd; }
.s6-head .smd-stg-head-icon  { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
.s6-head .smd-stg-head-title { color: #3b0764; }
.s6-head .smd-stg-head-sub   { color: #6d28d9; }
.s6-badge {
  background: linear-gradient(135deg, #7c3aed, #5b21b6) !important;
  box-shadow: 0 2px 10px rgba(124, 58, 237, .35) !important;
}

.s6-body {
  display: flex; flex-direction: column; align-items: center;
  padding: 12px 18px 12px;
  position: relative;
}

/* Money-rain celebration is now drawn on a <canvas> by the <RupeeRain />
   component (see RupeeRain.tsx) — no CSS particles needed here. */
.s6-celebrate {
  position: relative; z-index: 1;
  width: 100%; max-width: 560px;
  display: flex; flex-direction: column; align-items: center;
  padding: 4px 16px 8px;
}
@keyframes s6-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(-4px) rotate(2deg); }
}
.s6-trophy {
  width: 60px; height: 60px; border-radius: 18px;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 26px rgba(245, 158, 11, .42),
              inset 0 -3px 0 rgba(0,0,0,.12),
              inset 0 2px 0 rgba(255,255,255,.30);
  animation: s6-bob 3.2s ease-in-out infinite;
}
.s6-trophy svg { width: 28px; height: 28px; }
.s6-title {
  margin-top: 9px;
  font-size: 21px; font-weight: 800; letter-spacing: -.5px;
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.s6-quote { margin-top: 3px; font-size: 12px; font-style: italic; color: #64748b; text-align: center; }
.s6-won-stamp {
  margin-top: 9px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 13px; border-radius: 999px;
  background: #d1fae5; color: #047857;
  border: 1.5px solid #6ee7b7;
  font-size: 11px; font-weight: 800; letter-spacing: .02em;
}
.s6-cta {
  margin-top: 10px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 20px; border-radius: 11px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 800;
  border: none; cursor: pointer;
  box-shadow: 0 6px 18px rgba(245, 158, 11, .40);
  transition: all .15s;
}
.s6-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(245, 158, 11, .55); }
.s6-cta:disabled { opacity: .5; cursor: not-allowed; }

.s6-summary {
  width: 100%; max-width: 760px; margin-top: 10px;
  background: linear-gradient(180deg, #fffbeb, #ffffff);
  border: 1.5px solid #fde68a; border-radius: 12px; padding: 11px 14px;
}
.s6-summary-head { display: inline-flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 800; letter-spacing: .12em; color: #92400e; margin-bottom: 9px; }
.s6-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.s6-cell {
  padding: 7px 10px; border-radius: 9px;
  background: #fff;
  border: 1.5px solid;
  display: flex; flex-direction: column; gap: 3px;
  min-height: 48px;
}
.s6-cell-violet  { border-color: #ddd6fe; }
.s6-cell-blue    { border-color: #bfdbfe; }
.s6-cell-amber   { border-color: #fde68a; }
.s6-cell-rose    { border-color: #fecdd3; }
.s6-cell-emerald { border-color: #a7f3d0; }
.s6-cell-green   { border-color: #bbf7d0; }
.s6-cell-cyan    { border-color: #a5f3fc; }
.s6-cell-slate   { border-color: #cbd5e1; }
.s6-cell-label   { font-size: 9px; font-weight: 800; letter-spacing: .1em; color: #94a3b8; text-transform: uppercase; }
.s6-cell-value   { font-size: 12.5px; font-weight: 700; color: #1e293b; display: flex; align-items: center; min-height: 18px; }
.s6-code {
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 800;
  background: #fef3c7; color: #b45309;
  padding: 3px 9px; border-radius: 6px; border: 1px solid #fde68a;
}
.s6-code-emerald { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.s6-muted { color: #cbd5e1; font-weight: 600; }
.s6-value { font-variant-numeric: tabular-nums; color: #047857; font-weight: 800; }
.s6-status { display: inline-block; padding: 3px 11px; border-radius: 999px; background: #d1fae5; color: #047857; font-size: 10.5px; font-weight: 800; }

/* ── KPI strip (pre-shipment metrics, figma) — 4 pastel tiles each with
   an icon, a big number and an uppercase label. ── */
.s6-kpis {
  width: 100%; max-width: 760px; margin-top: 10px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
}
.s6-kpi {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border-radius: 12px;
  border: 1.5px solid; background: #fff;
}
.s6-kpi-ico {
  width: 34px; height: 34px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 2px;
}
.s6-kpi-num { font-size: 22px; font-weight: 800; line-height: 1; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.s6-kpi-label { font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.s6-kpi-blue   { background: linear-gradient(180deg,#eff6ff,#fff); border-color: #bfdbfe; }
.s6-kpi-blue   .s6-kpi-ico { background:#dbeafe; color:#2563eb; } .s6-kpi-blue   .s6-kpi-num { color:#1e40af; } .s6-kpi-blue   .s6-kpi-label { color:#2563eb; }
.s6-kpi-violet { background: linear-gradient(180deg,#f5f3ff,#fff); border-color: #ddd6fe; }
.s6-kpi-violet .s6-kpi-ico { background:#ede9fe; color:#7c3aed; } .s6-kpi-violet .s6-kpi-num { color:#5b21b6; } .s6-kpi-violet .s6-kpi-label { color:#7c3aed; }
.s6-kpi-green  { background: linear-gradient(180deg,#ecfdf5,#fff); border-color: #a7f3d0; }
.s6-kpi-green  .s6-kpi-ico { background:#d1fae5; color:#059669; } .s6-kpi-green  .s6-kpi-num { color:#047857; } .s6-kpi-green  .s6-kpi-label { color:#059669; }
.s6-kpi-amber  { background: linear-gradient(180deg,#fffbeb,#fff); border-color: #fde68a; }
.s6-kpi-amber  .s6-kpi-ico { background:#fef3c7; color:#d97706; } .s6-kpi-amber  .s6-kpi-num { color:#b45309; } .s6-kpi-amber  .s6-kpi-label { color:#d97706; }

/* ── Post-shipment view ── */
.s6-shp-wrap { width: 100%; display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

.s6-success-banner {
  display: flex; justify-content: space-between; align-items: center;
  padding: 13px 18px;
  background: linear-gradient(135deg, #d1fae5, #ecfdf5);
  border: 1.5px solid #6ee7b7; border-radius: 14px;
  gap: 14px; flex-wrap: wrap;
}
.s6-success-left { display: flex; align-items: center; gap: 12px; }
.s6-success-ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #10b981, #047857);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; box-shadow: 0 3px 10px rgba(16,185,129,.40);
}
.s6-success-title { font-size: 15px; font-weight: 800; color: #064e3b; }
.s6-success-sub   { font-size: 11.5px; color: #047857; margin-top: 2px; }
.s6-shp-code {
  font-family: 'Inter', monospace; font-size: 13px; font-weight: 800;
  padding: 6px 14px; border-radius: 8px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff; letter-spacing: .04em;
  box-shadow: 0 3px 10px rgba(217,119,6,.35);
}

.s6-shp-card {
  background: #fff;
  border: 1.5px solid #e2e8f0; border-radius: 14px; overflow: hidden;
}
.s6-shp-card-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  font-size: 11px; font-weight: 800; letter-spacing: .1em;
  border-bottom: 1.5px solid;
}
.s6-shp-head-amber {
  background: linear-gradient(180deg, #fef3c7, #fef9c3);
  color: #92400e; border-bottom-color: #fde68a;
}
.s6-shp-head-blue {
  background: linear-gradient(180deg, #dbeafe, #eff6ff);
  color: #1e40af; border-bottom-color: #bfdbfe;
}
/* Logistics card → lavender/purple to match the figma (was emerald). */
.s6-shp-head-emerald {
  background: linear-gradient(180deg, #ede9fe, #f5f3ff);
  color: #6d28d9; border-bottom-color: #ddd6fe;
}
.s6-shp-ico { font-size: 14px; }

.s6-shp-grid { display: grid; gap: 12px; padding: 14px 18px; }
.s6-shp-grid-3 { grid-template-columns: repeat(3, 1fr); }
.s6-shp-grid-4 { grid-template-columns: repeat(4, 1fr); }
.s6-shp-cell { display: flex; flex-direction: column; gap: 3px; }
.s6-shp-cell-wide { grid-column: 1 / -1; }
/* Attachment chips (shipment form uploads). */
.s6-shp-attach { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.s6-shp-attach-chip {
  display: inline-flex; align-items: center; gap: 6px; max-width: 260px;
  padding: 5px 11px; border-radius: 8px;
  background: #f5f3ff; border: 1.5px solid #ddd6fe; color: #6d28d9;
  font-size: 11.5px; font-weight: 700; text-decoration: none;
  transition: background .12s, border-color .12s;
}
.s6-shp-attach-chip:hover { background: #ede9fe; border-color: #c4b5fd; }
.s6-shp-attach-chip svg { flex-shrink: 0; }
.s6-shp-attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-bs-theme="dark"] .s6-shp-attach-chip { background: rgba(124,58,237,.14); border-color: rgba(167,139,250,.35); color: #c4b5fd; }
[data-bs-theme="dark"] .s6-shp-attach-chip:hover { background: rgba(124,58,237,.22); }
.s6-shp-label { font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #94a3b8; }
.s6-shp-val   { font-size: 12.5px; font-weight: 700; color: #1e293b; }
.s6-shp-val.s6-shp-amber   { color: #b45309; }
.s6-shp-val.s6-shp-blue    { color: #1e40af; }
.s6-shp-val.s6-shp-emerald { color: #6d28d9; }

/* Dark mode */
[data-bs-theme="dark"] .s6-head { background: linear-gradient(110deg, #1f1845 0%, #2a2150 40%, #3b2f6e 100%); border-bottom-color: rgba(167, 139, 250, .30); }
[data-bs-theme="dark"] .s6-head .smd-stg-head-title { color: #ede9fe; }
[data-bs-theme="dark"] .s6-head .smd-stg-head-sub   { color: #c4b5fd; }
[data-bs-theme="dark"] .s6-title { background: linear-gradient(135deg, #c4b5fd, #a78bfa); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
[data-bs-theme="dark"] .s6-quote { color: rgba(196, 181, 253, .60); }
[data-bs-theme="dark"] .s6-won-stamp { background: rgba(16, 185, 129, .18); color: #6ee7b7; border-color: rgba(110, 231, 183, .40); }
[data-bs-theme="dark"] .s6-summary { background: #1a1538; border-color: rgba(252, 191, 36, .30); }
[data-bs-theme="dark"] .s6-summary-head { color: #fde68a; }
[data-bs-theme="dark"] .s6-cell { background: #14102a; }
[data-bs-theme="dark"] .s6-cell-label { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .s6-cell-value { color: #ede9fe; }
[data-bs-theme="dark"] .s6-code { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .s6-code-emerald { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(110,231,183,.40); }
[data-bs-theme="dark"] .s6-muted { color: rgba(167, 139, 250, .45); }
[data-bs-theme="dark"] .s6-value { color: #6ee7b7; }
[data-bs-theme="dark"] .s6-status { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .s6-kpi { background: #14102a; }
[data-bs-theme="dark"] .s6-kpi-blue   { border-color: rgba(96,165,250,.35); }
[data-bs-theme="dark"] .s6-kpi-blue   .s6-kpi-ico { background: rgba(96,165,250,.18); color:#93c5fd; } [data-bs-theme="dark"] .s6-kpi-blue   .s6-kpi-num { color:#93c5fd; } [data-bs-theme="dark"] .s6-kpi-blue   .s6-kpi-label { color:#93c5fd; }
[data-bs-theme="dark"] .s6-kpi-violet { border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .s6-kpi-violet .s6-kpi-ico { background: rgba(124,58,237,.20); color:#c4b5fd; } [data-bs-theme="dark"] .s6-kpi-violet .s6-kpi-num { color:#c4b5fd; } [data-bs-theme="dark"] .s6-kpi-violet .s6-kpi-label { color:#c4b5fd; }
[data-bs-theme="dark"] .s6-kpi-green  { border-color: rgba(110,231,183,.35); }
[data-bs-theme="dark"] .s6-kpi-green  .s6-kpi-ico { background: rgba(16,185,129,.18); color:#6ee7b7; } [data-bs-theme="dark"] .s6-kpi-green  .s6-kpi-num { color:#6ee7b7; } [data-bs-theme="dark"] .s6-kpi-green  .s6-kpi-label { color:#6ee7b7; }
[data-bs-theme="dark"] .s6-kpi-amber  { border-color: rgba(252,191,36,.35); }
[data-bs-theme="dark"] .s6-kpi-amber  .s6-kpi-ico { background: rgba(252,191,36,.18); color:#fcd34d; } [data-bs-theme="dark"] .s6-kpi-amber  .s6-kpi-num { color:#fde68a; } [data-bs-theme="dark"] .s6-kpi-amber  .s6-kpi-label { color:#fcd34d; }
[data-bs-theme="dark"] .s6-success-banner { background: rgba(16,185,129,.14); border-color: rgba(110,231,183,.40); }
[data-bs-theme="dark"] .s6-success-title { color: #6ee7b7; }
[data-bs-theme="dark"] .s6-success-sub   { color: rgba(110,231,183,.75); }
[data-bs-theme="dark"] .s6-shp-card { background: #14102a; border-color: rgba(167, 139, 250, .25); }
[data-bs-theme="dark"] .s6-shp-head-amber  { background: rgba(252,191,36,.14); color: #fde68a; border-bottom-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .s6-shp-head-blue   { background: rgba(96,165,250,.14); color: #93c5fd; border-bottom-color: rgba(96,165,250,.30); }
[data-bs-theme="dark"] .s6-shp-head-emerald { background: rgba(124,58,237,.16); color: #c4b5fd; border-bottom-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .s6-shp-label { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s6-shp-val { color: #ede9fe; }
[data-bs-theme="dark"] .s6-shp-val.s6-shp-amber   { color: #fde68a; }
[data-bs-theme="dark"] .s6-shp-val.s6-shp-blue    { color: #93c5fd; }
[data-bs-theme="dark"] .s6-shp-val.s6-shp-emerald { color: #c4b5fd; }

@media (max-width: 900px) {
  .s6-summary-grid { grid-template-columns: 1fr 1fr; }
  .s6-shp-grid-3, .s6-shp-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .s6-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .s6-summary-grid, .s6-shp-grid-3, .s6-shp-grid-4 { grid-template-columns: 1fr; }
  .s6-kpis { grid-template-columns: repeat(2, 1fr); }
  .s6-title { font-size: 24px; }
}
`;
