import { useEffect, useMemo, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import CreateShipmentOrderModal, { type ShipmentInitialContext } from './CreateShipmentOrderModal';

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
  pi_signed_at?: string | null;   // when the PI was e-signed (null = not signed)
  qualified:     boolean;
  lead_stage_id: number;
  sender_country_iso?: string | null;
  customer?:     { id: number; company_name: string | null; customer_code: string | null } | null;
  consignee?:    { id: number; company_name: string | null; consignee_code?: string | null } | null;
};

type DealDoc = {
  id:         number;
  code:       string | null;
  currency:   string | null;
  grand_total:number | string | null;
  created_at: string;
};

type Shipment = {
  id:                   number;
  lead_id:              number;
  proforma_invoice_id:  number | null;
  shipping_liability:   string | null;
  cold_chain:           boolean;
  zip_code:             string | null;
  freight_cost:         number | string | null;
  shipping_mode:        string | null;
  inco_term:            string | null;
  port_of_loading:      string | null;
  port_of_unloading:    string | null;
  final_destination:    string | null;
  origin_country:       string | null;
  remarks:              string | null;
  attachments:          string[] | null;
  created_at:           string;
  proforma_invoice?:    { id: number; code: string | null; created_at: string } | null;
  creator?:             { id: number; name: string } | null;
};

const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
};

const fmtMoney = (v: number | string | null | undefined, ccy: string | null | undefined): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return `${ccy ?? ''} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};

const fmtCcy = (v: number | string | null | undefined): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return `$ ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      setTimeout(() => setConfetti(false), 10_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const wonOn = useMemo(() => fmtDate(lead?.won_at ?? null), [lead?.won_at]);

  // Days the deal took: from when the LEAD was created to the moment its PI
  // was SIGNED. Null (shows "—") until the PI is signed. Falls back to the
  // opportunity date if the lead's created_at isn't present.
  const days = useMemo(() => {
    const startSrc = lead?.created_at ?? header.oppDate ?? null;
    const start = startSrc ? new Date(startSrc) : null;
    const end   = lead?.pi_signed_at ? new Date(lead.pi_signed_at) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const d = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    return d >= 0 ? d : null;
  }, [lead?.created_at, lead?.pi_signed_at, header.oppDate]);

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
    customerCode:    lead?.customer?.customer_code ?? null,
    customerName:    lead?.customer?.company_name ?? header.customer,
    consigneeCode:   lead?.consignee?.consignee_code ?? null,
    consigneeName:   lead?.consignee?.company_name ?? null,
  }), [header.oppId, header.oppDate, header.customer, latestPi, lead]);

  const onShipmentCreated = () => {
    void fetchAll(true);
    /* Burst confetti again to celebrate the Shipment ID being created
     * (reuses the same one-shot effect as the initial victory landing). */
    setConfetti(true);
    setTimeout(() => setConfetti(false), 10_000);
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
        {confetti && (
          <div className="s6-confetti" aria-hidden="true">
            {Array.from({ length: 170 }).map((_, i) => {
              const size  = 9 + (i % 5) * 4;            // 9…25px — bigger pieces
              const round = i % 3 === 0;                // every 3rd is a dot
              return (
                <span key={i} style={{
                  left: `${(i * 4.27) % 100}%`,
                  width: `${size}px`,
                  height: `${round ? size : size + (i % 4) * 5}px`,
                  borderRadius: round ? '50%' : '2px',
                  // Spread starts across ~5.4s and let each piece fall for
                  // ~3.6–5s so the burst keeps raining for the full 10s.
                  animationDelay: `${(i % 27) * 0.2}s`,
                  animationDuration: `${3.6 + (i % 5) * 0.5}s`,
                  background: ['#fbbf24','#a78bfa','#34d399','#f87171','#60a5fa','#f59e0b','#ec4899','#06b6d4','#fde047','#c084fc'][i % 10],
                }} />
              );
            })}
            <div className="s6-burst"><span className="s6-burst-emoji">🎉</span></div>
            <CornerCannon side="left" />
            <CornerCannon side="right" />
          </div>
        )}

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
              <KpiTile tone="amber"   label="DAYS"       value={days ?? '—'}       loading={loading}
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
              <span className="s6-shp-code">SHP-{String(shipment.id).padStart(3, '0')}</span>
            </div>

            {/* SHIPMENT DETAILS */}
            <div className="s6-shp-card">
              <div className="s6-shp-card-head s6-shp-head-amber">
                <span className="s6-shp-ico">📦</span>
                SHIPMENT DETAILS
              </div>
              <div className="s6-shp-grid s6-shp-grid-4">
                <Cell label="SHIPMENT ID"      value={`SHP-${String(shipment.id).padStart(3, '0')}`} amber />
                <Cell label="SHIPMENT DATE"    value={fmtDate(shipment.created_at)} />
                <Cell label="OPPORTUNITY ID"   value={header.oppId} amber />
                <Cell label="OPPORTUNITY DATE" value={fmtDate(header.oppDate)} />
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
              <div className="s6-shp-grid s6-shp-grid-3">
                <Cell label="SHIPPING LIABILITY" value={shipment.shipping_liability ?? '—'} emerald />
                <Cell label="COLD CHAIN"         value={shipment.cold_chain ? 'Yes — Required' : 'No — Not Required'} emerald />
                <Cell label="ZIP CODE"           value={shipment.zip_code ?? '—'} />
                <Cell label="FREIGHT COST"       value={fmtCcy(shipment.freight_cost)} emerald />
                <Cell label="SHIPPING MODE"      value={shipment.shipping_mode ?? '—'} emerald />
                <Cell label="INCO TERM"          value={shipment.inco_term ?? '—'} emerald />
                <Cell label="PORT OF LOADING"    value={shipment.port_of_loading ?? '—'} />
                <Cell label="PORT OF UNLOADING"  value={shipment.port_of_unloading ?? '—'} />
                <Cell label="FINAL DESTINATION"  value={shipment.final_destination ?? '—'} amber />
                <Cell label="ORIGIN COUNTRY"     value={shipment.origin_country ?? '—'} />
                {shipment.remarks && (
                  <div className="s6-shp-cell s6-shp-cell-wide">
                    <div className="s6-shp-label">REMARKS</div>
                    <div className="s6-shp-val">{shipment.remarks}</div>
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

function Cell({ label, value, amber, blue, emerald }: {
  label: string; value: string;
  amber?: boolean; blue?: boolean; emerald?: boolean;
}) {
  const tone = amber ? 's6-shp-amber' : blue ? 's6-shp-blue' : emerald ? 's6-shp-emerald' : '';
  return (
    <div className="s6-shp-cell">
      <div className="s6-shp-label">{label}</div>
      <div className={`s6-shp-val ${tone}`}>{value}</div>
    </div>
  );
}

/* Corner confetti cannon — a party-popper that keeps bursting from a bottom
 * corner, shooting particles diagonally up-inward in an arc. `left` fires
 * toward the upper-right, `right` toward the upper-left. Each particle's
 * trajectory (--tx / --ty) is fanned out by index; the burst repeats for the
 * lifetime of the confetti container (~10s). */
function CornerCannon({ side }: { side: 'left' | 'right' }) {
  const COLORS = ['#fbbf24', '#a78bfa', '#34d399', '#f87171', '#60a5fa', '#f59e0b', '#ec4899', '#06b6d4', '#fde047', '#c084fc'];
  const N = 46;
  return (
    <div className={`s6-cannon s6-cannon-${side}`} aria-hidden="true">
      {Array.from({ length: N }).map((_, i) => {
        const angle = ((12 + (i / N) * 76) * Math.PI) / 180;   // 12°…88° fan
        const dist  = 170 + (i % 6) * 52;                       // 170…430px
        const dx    = Math.cos(angle) * dist * (side === 'left' ? 1 : -1);
        const dy    = -Math.sin(angle) * dist;                  // up = negative
        const size  = 8 + (i % 4) * 4;
        return (
          <span key={i} style={{
            ['--tx' as string]: `${dx.toFixed(0)}px`,
            ['--ty' as string]: `${dy.toFixed(0)}px`,
            width: `${size}px`,
            height: `${i % 3 === 0 ? size : size + 4}px`,
            borderRadius: i % 3 === 0 ? '50%' : '2px',
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 5) * 0.06}s`,
            animationDuration: `${1.5 + (i % 4) * 0.28}s`,
          } as React.CSSProperties} />
        );
      })}
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

@keyframes s6-confetti-fall {
  0%   { transform: translateY(-30px) translateX(0) rotate(0deg); opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { transform: translateY(760px) translateX(46px) rotate(900deg); opacity: 0; }
}
.s6-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 10; }
.s6-confetti span {
  position: absolute; top: -12px;
  width: 10px; height: 16px; border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,.10);
  /* Base duration; per-piece overrides come from inline animationDuration so
     the rain staggers and keeps falling for the full ~10s celebration. */
  animation: s6-confetti-fall 4s cubic-bezier(.21,.62,.42,1) forwards;
}
/* Center burst emoji — a big pop that scales in then gently fades. */
@keyframes s6-burst-pop {
  0%   { transform: scale(.2) rotate(-12deg); opacity: 0; }
  18%  { transform: scale(1.3) rotate(7deg);  opacity: 1; }
  34%  { transform: scale(1)   rotate(0deg);  opacity: 1; }
  82%  { transform: scale(1)   rotate(0deg);  opacity: 1; }
  100% { transform: scale(1.15) rotate(0deg); opacity: 0; }
}
.s6-burst { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; pointer-events: none; }
.s6-burst-emoji {
  margin-top: 36px; font-size: 78px; line-height: 1;
  animation: s6-burst-pop 2.6s ease-out forwards;
  filter: drop-shadow(0 6px 14px rgba(0,0,0,.18));
}

/* ── Corner cannons — bottom-left + bottom-right party-poppers ── */
.s6-cannon { position: absolute; bottom: 8px; width: 0; height: 0; z-index: 11; pointer-events: none; }
.s6-cannon-left  { left: 18px; }
.s6-cannon-right { right: 18px; }
.s6-cannon span {
  position: absolute; bottom: 0; left: 0;
  width: 10px; height: 12px; border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,.12);
  animation: s6-cannon-burst 1.8s cubic-bezier(.15,.7,.35,1) infinite;
}
.s6-cannon-right span { left: auto; right: 0; }
@keyframes s6-cannon-burst {
  0%   { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
  10%  { opacity: 1; }
  55%  { transform: translate(calc(var(--tx) * .92), var(--ty)) rotate(360deg) scale(.95); opacity: 1; }
  100% { transform: translate(var(--tx), calc(var(--ty) * .25)) rotate(680deg) scale(.55); opacity: 0; }
}

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
