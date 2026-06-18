import { useCallback, useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateContext } from '../../../components/App';
import api from '../../../api';
import { decodeOppId, decodeStage } from '../../../utils/oppCrypto';
import { useToast } from '../../../contexts/ToastContext';
import EntityPickerModal, { type PickerOption } from '../EntityPickerModal';
import AddCustomerModal, { type EditCustomer } from '../AddCustomerModal';
import CustomerConsigneesModal, { type CustomerLite } from '../CustomerConsigneesModal';
import LeadEvidenceVaultModal, { type LeadVaultTarget } from '../LeadEvidenceVaultModal';
import AddProductModal from '../../products/AddProductModal';
import ProductDirectoryModal from './ProductDirectoryModal';
import StageEmbedModal from './StageEmbedModal';
import ChangeOwnerModal from './ChangeOwnerModal';
import RemarksModal from './RemarksModal';
import KeyOpportunityModal from './KeyOpportunityModal';
import { SALES_MATRIX_DETAIL_CSS } from './salesMatrixDetail.styles';
import Stage1InquiryReceived     from './stages/Stage1InquiryReceived';
import Stage2LeadAcknowledgement from './stages/Stage2LeadAcknowledgement';
import Stage3ProductSourcing     from './stages/Stage3ProductSourcing';
import Stage4PriceShared         from './stages/Stage4PriceShared';
import Stage5QuotationVsPI       from './stages/Stage5QuotationVsPI';
import Stage6VictoryStage        from './stages/Stage6VictoryStage';
import TaskManagerPanel, { type TaskManagerRow } from './TaskManagerPanel';
import WhatsAppStatusModal from './WhatsAppStatusModal';
import RemindersListModal from './RemindersListModal';
import MeetingsListModal from './MeetingsListModal';
import LeadAgreementSendModal, { type ApplicablePayload as AgreementApplicablePayload } from './LeadAgreementSendModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Opportunity Detail
 *
 * Wrapper that renders the customer banner, 6-step tracker, action toolbar,
 * left CLM panel, and right Deal Execution panel. The middle column is
 * supplied by one of the six stage components depending on the URL param.
 *
 * Route shape: /sales/matrix/:oppId/stage-:n  (n = 1..6)
 * ──────────────────────────────────────────────────────────────────────── */

export type StageNum = 1 | 2 | 3 | 4 | 5 | 6;

const STAGES: { n: StageNum; title: string; sub: string }[] = [
  { n: 1, title: 'Inquiry Received',     sub: 'Lead inquiry captured' },
  { n: 2, title: 'Lead Acknowledgement', sub: 'Qualification confirmed' },
  { n: 3, title: 'Product Sourcing',     sub: 'Product/supplier sourcing' },
  { n: 4, title: 'Price Shared',         sub: 'Quoted prices shared with customer' },
  { n: 5, title: 'Quotation vs PI',      sub: 'Quotation/PI comparison' },
  { n: 6, title: 'Victory Stage',        sub: 'Deal successfully won' },
];

/* Task-manager row shape mirrored from the server response. Kept here
 * (rather than imported from TaskManagerPanel) so the stage components
 * don't depend on the panel module. */
export type StageTaskManager = {
  id?:                 number;
  order_value?:        string | number | null;
  buying_plan?:        string | null;
  name?:               string | null;
  mobile_no?:          string | null;
  email?:              string | null;
  attachment?:         string | null;
  attachment_original?: string | null;
};

export type StageAcknowledgement = {
  id:                 number;
  lead_ack_reason_id: number;
  opportunity_type:   'qualified' | 'disqualified' | 'clarity_pending';
  dq_status:          'positive' | 'negative' | null;
  reason_snapshot:    string;
  created_at:         string;
};

export type OppHeaderData = {
  /* DB primary key of the lead row. Optional because the page can be
   * deep-linked by oppCode alone — when missing the stage components
   * gracefully degrade to read-only (no backend calls fire). */
  leadId?: number;
  oppId: string;
  customer: string;
  customerCode: string;
  oppDate: string;
  country: string;
  /* Lead pipeline state — drives the QUALIFIED/DISQUALIFIED/PENDING
   * badge in Stage 1's header. */
  qualified?:    boolean;
  disqualified?: boolean;
  /* Latest persisted Task Manager row, hydrated by the parent on
   * fetch + after every save. Stage 1 reads this for its read-only
   * display; the right-side TaskManagerPanel reads the same value
   * to seed its form. */
  taskManager?: StageTaskManager | null;
  /* Stage 2 activity log — latest first. Cached by the parent so the
   * stage component can render immediately without an extra fetch. */
  acknowledgements?: StageAcknowledgement[];
  /* Mapped customer / consignee — read by the toolbar to decide
   * whether the Customer / Consignee buttons open Edit or Picker. */
  customerId?:        number | null;
  customerRow?:       Record<string, unknown> | null;
  consigneeId?:       number | null;
  consigneeRow?:      Record<string, unknown> | null;
  /* Owner + ad-hoc notes — drive the Change Owner / Remark modals. */
  salespersonId?:     number | null;
  salespersonName?:   string;
  remark?:            string | null;
  /* WhatsApp panel state. */
  whatsappStatus?:     'connected' | 'pending' | 'not_connected' | 'opted_out' | null;
  whatsappReason?:     string | null;
  whatsappScreenshot?: string | null;
};

const DEFAULT_HEADER: OppHeaderData = {
  oppId:        'OPP-001',
  customer:     'GreenHarvest Global',
  customerCode: 'C-001',
  oppDate:      '10/04/2026',
  country:      'IN',
};

/* Full-page loading shimmer for the Sales Matrix detail page — banner +
 * 6-step stepper + toolbar + the three panels (CLM / Stage / Deal Engine).
 * Self-contained (inline styles + one keyframe) so it needs no extra CSS. */
function MatrixPageSkeleton() {
  return (
    <div className="smd-root" style={{ padding: 4 }}>
      <style>{`
        @keyframes smdpgskel { 0%{background-position:100% 0} 100%{background-position:-100% 0} }
        .smdpgskel { border-radius: 8px; background: linear-gradient(90deg,#ece9f5 25%,#f6f3fb 37%,#ece9f5 63%); background-size:400% 100%; animation: smdpgskel 1.2s ease-in-out infinite; }
        .smdpgskel-card { background:#fff; border:1px solid #ede9fe; border-radius:14px; padding:16px; }
        [data-bs-theme="dark"] .smdpgskel,
        [data-layout-mode="dark"] .smdpgskel { background: linear-gradient(90deg,#241c3a 25%,#322750 37%,#241c3a 63%); background-size:400% 100%; }
        [data-bs-theme="dark"] .smdpgskel-card,
        [data-layout-mode="dark"] .smdpgskel-card { background: rgba(28,20,50,0.55); border-color: rgba(167,139,250,.18); }
      `}</style>
      <div className="smdpgskel" style={{ height: 64, marginBottom: 14 }} />
      {/* Stepper — one card per step mirroring the real layout:
          small "Step 0N" label, big number, title line, sub line, badge. */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="smdpgskel-card" style={{ flex: 1, padding: 12, position: 'relative', minHeight: 86 }}>
            <div className="smdpgskel" style={{ height: 9, width: 44, marginBottom: 8 }} />
            <div className="smdpgskel" style={{ height: 24, width: 32, marginBottom: 9 }} />
            <div className="smdpgskel" style={{ height: 11, width: '78%', marginBottom: 7 }} />
            <div className="smdpgskel" style={{ height: 8, width: '58%' }} />
            <div className="smdpgskel" style={{ position: 'absolute', top: 12, right: 12, height: 16, width: 42, borderRadius: 10 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className="smdpgskel" style={{ height: 30, width: 108 }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr', gap: 14 }}>
        {Array.from({ length: 3 }).map((_, c) => (
          <div key={c} className="smdpgskel-card">
            <div className="smdpgskel" style={{ height: 40, marginBottom: 16 }} />
            {Array.from({ length: 6 }).map((_, r) => (
              <div key={r} className="smdpgskel" style={{ height: 16, marginBottom: 12, width: `${92 - r * 9}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SalesMatrixDetail() {
  const params   = useParams();
  const location = useLocation();
  const { navigate } = useNavigateContext();
  const toast = useToast();

  /* ─── Customer / Consignee picker + add-edit modal state ─── */
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerOpts, setCustomerOpts] = useState<PickerOption[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerRows, setCustomerRows] = useState<Record<string, EditCustomer>>({});
  const [customerEditing, setCustomerEditing] = useState<EditCustomer | null>(null);
  const [customerAddOpen, setCustomerAddOpen] = useState(false);

  /* "Manage Consignees" popup — lists every consignee mapped to the
   * lead's customer (same CustomerConsigneesModal used on the Sales
   * Customers list). Opened from the Consignee toolbar button. */
  const [manageConsigneesTarget, setManageConsigneesTarget] = useState<CustomerLite | null>(null);

  /* Evidence Vault popups — opened from the left CLM card's Customer /
   * Consignee rows. Same standalone vault modal used on the Sales
   * Customers / Consignee list pages: it fetches the live
   * /segment-uploads/{party}/{id}/vault payload, shows DD / KYC / Trade
   * License / Trade Documents in tabs, and lets the user send any
   * missing / unsigned document for e-signature. */
  const [leadVaultTarget, setLeadVaultTarget] = useState<LeadVaultTarget | null>(null);
  /* Every consignee mapped to the lead's customer — handed to the Lead
   * Evidence Vault so it can render a consignee-wise tab strip when the
   * customer has more than one. Null/single ⇒ the modal shows just the
   * one `leadVaultTarget`. */
  const [leadVaultConsignees, setLeadVaultConsignees] = useState<LeadVaultTarget[] | null>(null);

  const [productAddOpen, setProductAddOpen] = useState(false);
  const [productDirectoryOpen, setProductDirectoryOpen] = useState(false);
  const [productSourcingOpen, setProductSourcingOpen]   = useState(false);
  const [priceSharedOpen, setPriceSharedOpen]           = useState(false);
  const [changeOwnerOpen, setChangeOwnerOpen] = useState(false);
  const [remarksOpen, setRemarksOpen] = useState(false);
  const [keyOppOpen, setKeyOppOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [ownerOpts, setOwnerOpts] = useState<Array<{ value: string; label: string }>>([]);

  /* Agreement send-for-signature popup. Powered by
   * GET /api/clm/leads/{leadId}/agreement-applicable — fetched once
   * per lead so the Segment Details card can show real counts and
   * the popup opens instantly on row click. */
  const [agreementApplicable, setAgreementApplicable] = useState<AgreementApplicablePayload | null>(null);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  /* Which document type the Segment Details popup opens on. The card now
   * splits by document TYPE (Trade Documents vs Agreements) rather than by
   * regulatory tier — both pull from the same PI-derived segment payload. */
  const [agreementModalView, setAgreementModalView] = useState<'trade' | 'agreements'>('agreements');

  /* Side-rail collapsing — clicking the chevron in either side card collapses
   * it to a thin vertical rail so the stage form gets more breathing room.
   * Clicking the rail (or its expand chevron) restores the full card. */
  const [clmCollapsed, setClmCollapsed] = useState(false);
  const [dealCollapsed, setDealCollapsed] = useState(false);

  /* CLM doc counts — pulled live from /customers/{id}/documents and
   * /consignees/{id}/documents (sum of dd + tl rows). Falls back to 0
   * when the row hasn't loaded yet so the progress bar starts empty
   * instead of stale. Total is 14 = 6 DD + 8 TL per party — must match
   * the DD_DOCS + TL_DOCS catalogs in AddCustomerModal / AddConsigneeModal. */
  /* CLM doc tally — sourced from /segment-uploads/{customer|consignee}/{id}/vault
   * which is the SAME endpoint Stage 3 Evidence Vault uses. It returns
   * `total_documents` (the catalog: Company DD + Owner KYC + Trade Licence
   * + Trade Documents, expanded from the party's segment rules) and
   * `verified_signed` (how many of those have an actual upload on file).
   * `error` distinguishes a failed fetch from a legitimate empty catalog —
   * without it the UI conflates "server failed" with "no segments yet". */
  type ClmTally = { total: number; verified: number; error?: boolean; loading?: boolean } | null;
  const [custTally, setCustTally] = useState<ClmTally>(null);
  const [consTally, setConsTally] = useState<ClmTally>(null);
  /* Refetch triggers — bumped after a modal SAVE (not just close) so the
   * tally effects re-run even though the customer/consignee FK hasn't
   * changed. Without these the CLM panel would keep showing the pre-upload
   * count until the user navigates away and back.
   *
   * Split per party (was a single shared tick): a consignee save must not
   * re-fire the customer vault fetch — the customer record wasn't touched
   * and the extra concurrent request races against the consignee vault +
   * reloadLead. On slower servers the spurious customer fetch was timing
   * out at 8s and flipping the Customer Details row into the red
   * "Couldn't load — tap to retry" state right after a consignee save. */
  const [custRefreshTick, setCustRefreshTick] = useState(0);
  const [consRefreshTick, setConsRefreshTick] = useState(0);
  /* Agreement-applicable card has its own tick so a Send/Recall inside
   * the agreement modal refreshes the card without re-hitting the heavy
   * customer + consignee vault endpoints. */
  const [agreementRefreshTick, setAgreementRefreshTick] = useState(0);
  /* Click → open the existing Customer/Consignee modal pre-positioned at
   * the requested stage (2 = KYC, 3 = Trade Docs / Evidence Vault). Stage
   * selection comes from which CLM row the user clicked — both currently
   * deep-link to Stage 2 since the panel labels them "KYC / DD / Trade". */
  // Customer/Consignee modals are 2-stage now (Evidence Vault / Stage 3 was
  // removed from the customer form), so this deep-link tops out at Stage 2.
  const [clmInitialStage, setClmInitialStage] = useState<1 | 2 | undefined>(undefined);

  useEffect(() => {
    if (!changeOwnerOpen || ownerOpts.length > 0) return;
    api.get<{ status: boolean; data: Array<{ id: number; name: string; code: string; subtitle: string }> }>(
      '/sales/leads/salespeople',
    )
      .then(({ data }) => {
        setOwnerOpts((data.data ?? []).map(sp => ({
          value: String(sp.id),
          label: `${sp.code} · ${sp.name}${sp.subtitle ? ` — ${sp.subtitle}` : ''}`,
        })));
      })
      .catch(() => toast.error('Load failed', 'Could not load salespeople'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeOwnerOpen]);

  const fetchCustomers = async () => {
    // Always refetch (no length cache) so newly-added customers and any
    // customers mapped elsewhere are always reflected.
    setCustomerLoading(true);
    try {
      type Row = EditCustomer & { db_id?: number };
      // tab=all → every customer, INCLUDING those already attached to an
      // opportunity: a single customer may be used across multiple
      // opportunities, so the picker must not hide already-used customers.
      const res = await api.get<{ data?: Row[] } | Row[]>('/customers', { params: { tab: 'all' } });
      const rows = Array.isArray(res.data) ? res.data : ((res.data as { data?: Row[] })?.data ?? []);
      const cache: Record<string, EditCustomer> = {};
      const opts: PickerOption[] = [];
      rows.forEach(r => {
        if (!r.id) return;
        cache[r.id] = r;
        opts.push({ value: r.id, label: `${r.id} — ${r.company}` });
      });
      setCustomerRows(cache);
      setCustomerOpts(opts);
    } catch {
      toast.error('Failed to load customers', 'Could not reach the Customer API');
    } finally {
      setCustomerLoading(false);
    }
  };

  // The URL carries an encrypted token; decode back to the plain OPP code so
  // all internal logic (lead resolution, headers, navStage) works unchanged.
  const oppId = params.oppId ? decodeOppId(params.oppId) : DEFAULT_HEADER.oppId;
  const stage = Math.min(6, Math.max(1, decodeStage(params.stage || '1'))) as StageNum;

  /* Header from router state — seed; the server fetch below hydrates the
   * lead-pipeline fields (qualified/disqualified/taskManager). */
  const seedHeader: OppHeaderData = useMemo(() => {
    const fromState = (location.state as any)?.row;
    if (fromState) {
      return {
        leadId:       typeof fromState.id === 'number' ? fromState.id : undefined,
        oppId:        fromState.oppId        || oppId,
        customer:     fromState.customer     || DEFAULT_HEADER.customer,
        customerCode: fromState.customerCode || `C-${oppId.replace(/^OPP-/, '')}`,
        oppDate:      fromState.date         || DEFAULT_HEADER.oppDate,
        country:      fromState.country      || DEFAULT_HEADER.country,
      };
    }
    return { ...DEFAULT_HEADER, oppId };
  }, [location.state, oppId]);

  /* Server-side lead extras — qualified flag, salesperson, and the
   * task-manager row that both Stage 1 (display) and TaskManagerPanel
   * (form) read from. Fetched once per leadId; refreshed in-place after
   * a task-manager save so the read-only display stays in sync without a
   * full refetch. */
  const [serverHeader, setServerHeader] = useState<{
    qualified?:           boolean;
    disqualified?:        boolean;
    keyOpportunity?:      boolean;
    taskManager?:         StageTaskManager | null;
    acknowledgements?:    StageAcknowledgement[];
    salespersonId?:       number | null;
    salespersonName?:     string;
    leadStageId?:         number;
    customerId?:          number | null;
    customerRow?:         Record<string, unknown> | null;
    consigneeId?:         number | null;
    consigneeRow?:        Record<string, unknown> | null;
    remark?:              string | null;
    whatsappStatus?:      'connected' | 'pending' | 'not_connected' | 'opted_out' | null;
    whatsappReason?:      string | null;
    whatsappScreenshot?:  string | null;
    piSignedAt?:          string | null;
    oppDateIso?:          string | null;
  }>({});

  /* Resolved leadId — initially the one passed via router state. If that's
   * missing (e.g. the user reached this page via the stage tracker rather
   * than from the worksheet, so `location.state` is empty), we resolve it
   * by searching `/sales/leads` for the opp code. Once known we cache it
   * here so all downstream calls (reload + Stage 1/2 saves) work. */
  const [resolvedLeadId, setResolvedLeadId] = useState<number | undefined>(seedHeader.leadId);

  useEffect(() => {
    setResolvedLeadId(seedHeader.leadId);
  }, [seedHeader.leadId]);

  useEffect(() => {
    if (resolvedLeadId || !oppId) return;
    // Best-effort lookup by opp_code (the existing /sales/leads search
    // hits opp_code via LIKE). We pass status=all + with_counts=0 so the
    // lookup is fast and bucket-agnostic.
    api.get<{ data: Array<{ id: number; opp_code: string }> }>('/sales/leads', {
      params: { search: oppId, status: 'all', per_page: 5, page: 1, with_counts: 0 },
    })
      .then(({ data }) => {
        const exact = (data.data ?? []).find(r => r.opp_code === oppId);
        if (exact) setResolvedLeadId(exact.id);
      })
      .catch(() => { /* silent — Stage components show their own degraded state */ });
  }, [resolvedLeadId, oppId]);

  // Page-level loading flag — drives the full-page shimmer until the lead
  // (serverHeader) has loaded, so the 7-stage page doesn't flash empty.
  const [headerLoaded, setHeaderLoaded] = useState(false);

  const reloadLead = useCallback(() => {
    if (!resolvedLeadId) return;
    return api.get<{ status: boolean; data: {
      qualified: boolean;
      disqualified: boolean;
      key_opportunity: boolean;
      lead_stage_id: number;
      salesperson_id: number | null;
      salesperson: { id: number; name: string } | null;
      customer_id: number | null;
      customer: Record<string, unknown> | null;
      consignee_id: number | null;
      consignee: Record<string, unknown> | null;
      remark: string | null;
      has_whatsapp: boolean;
      whatsapp_status: 'connected' | 'pending' | 'not_connected' | 'opted_out' | null;
      whatsapp_reason: string | null;
      whatsapp_screenshot: string | null;
      whatsapp_screenshot_url: string | null;
      task_manager: StageTaskManager | null;
      acknowledgements: StageAcknowledgement[];
      pi_signed_at: string | null;
      opportunity_date_iso: string | null;
    }}>(`/sales/leads/${resolvedLeadId}`)
      .then(({ data }) => {
        const d = data.data;
        setServerHeader({
          qualified:           d.qualified,
          disqualified:        d.disqualified,
          keyOpportunity:      !!d.key_opportunity,
          taskManager:         d.task_manager,
          acknowledgements:    d.acknowledgements ?? [],
          salespersonId:       d.salesperson_id,
          salespersonName:     d.salesperson?.name ?? '',
          leadStageId:         d.lead_stage_id,
          customerId:          d.customer_id,
          customerRow:         d.customer,
          consigneeId:         d.consignee_id,
          consigneeRow:        d.consignee,
          remark:              d.remark,
          whatsappStatus:      d.whatsapp_status,
          whatsappReason:      d.whatsapp_reason,
          // Prefer the server-resolved URL (points at the real file host);
          // fall back to the raw path for older API responses.
          whatsappScreenshot:  d.whatsapp_screenshot_url ?? d.whatsapp_screenshot,
          piSignedAt:          d.pi_signed_at,
          oppDateIso:          d.opportunity_date_iso,
        });
      })
      .catch(() => toast.error('Load failed', 'Could not load this lead'))
      .finally(() => setHeaderLoaded(true));
  }, [resolvedLeadId, toast]);

  useEffect(() => { reloadLead(); }, [reloadLead]);

  /* Vault-tally fetch — one call per party, hitting the same endpoint
   * the Stage 3 Evidence Vault uses. `data.total_documents` is the
   * catalog size (driven by the party's segment rules: DD + Owner KYC
   * + TL + Trade Docs combined); `data.verified_signed` is how many of
   * those have an actual upload. */
  type VaultResponse = {
    data?: {
      total_documents?: number;
      verified_signed?: number;
      /* CORE tally = Company DD + Owner KYC + Trade Licences only (excludes
       * Trade Documents, which were removed from the customer/consignee form).
       * The CLM panel card uses these; falls back to the all-inclusive
       * total_documents/verified_signed for older API responses. */
      core_total_documents?: number;
      core_verified_signed?: number;
    };
  };

  useEffect(() => {
    const cid = serverHeader.customerId;
    if (!cid) { setCustTally(null); return; }
    /* Reset to loading state on every effect-fire so a customer-switch
     * (re-mapped in the toolbar) doesn't leave the previous customer's
     * count visible while the new fetch is in flight. */
    setCustTally({ total: 0, verified: 0, loading: true });
    let cancelled = false;
    /* No per-request timeout — a cold hard-refresh fires a big burst of API
     * calls and the single-threaded dev server processes them serially, so this
     * heavier vault query can sit queued for several seconds. A fixed timeout
     * (8s) was cutting it off mid-flight (axios aborts → DevTools "(canceled)"),
     * leaving the card in error state. We rely on the request completing; the
     * catch still handles a genuine network/server failure. */
    api.get<VaultResponse>(`/segment-uploads/customer/${cid}/vault`)
      .then(res => {
        if (cancelled) return;
        const d = res.data?.data;
        setCustTally({
          total:    Number(d?.core_total_documents ?? d?.total_documents ?? 0),
          verified: Number(d?.core_verified_signed ?? d?.verified_signed ?? 0),
        });
      })
      .catch(() => { if (!cancelled) setCustTally({ total: 0, verified: 0, error: true }); });
    return () => { cancelled = true; };
  }, [serverHeader.customerId, custRefreshTick]);

  useEffect(() => {
    const directId = serverHeader.consigneeId;   // consignee mapped to the lead
    const custId   = serverHeader.customerId;
    // Neither a mapped consignee nor a customer → nothing to tally.
    if (!directId && !custId) { setConsTally(null); return; }
    let cancelled = false;
    setConsTally({ total: 0, verified: 0, loading: true });

    const loadVault = (consigneeDbId: number) =>
      api.get<VaultResponse>(`/segment-uploads/consignee/${consigneeDbId}/vault`)
        .then(res => {
          if (cancelled) return;
          const d = res.data?.data;
          setConsTally({
            total:    Number(d?.core_total_documents ?? d?.total_documents ?? 0),
            verified: Number(d?.core_verified_signed ?? d?.verified_signed ?? 0),
          });
        });

    if (directId) {
      loadVault(directId)
        .catch(() => { if (!cancelled) setConsTally({ total: 0, verified: 0, error: true }); });
    } else {
      // No consignee mapped to the lead — resolve one from the customer's
      // consignees (the SAME one the card's click opens). This is what fixes
      // the stuck "Loading documents…": a Same-as-Customer consignee now
      // mirrors the customer's tally instead of hanging. No consignees at all
      // → an empty (0-doc) tally, not a perpetual spinner.
      api.get('/consignees', { params: { customer_id: custId } })
        .then(r => {
          if (cancelled) return undefined;
          const rows: Array<{ db_id?: number }> = Array.isArray(r.data?.data) ? r.data.data : [];
          const firstId = rows.find(x => typeof x.db_id === 'number')?.db_id;
          if (!firstId) { setConsTally({ total: 0, verified: 0 }); return undefined; }
          return loadVault(firstId);
        })
        .catch(() => { if (!cancelled) setConsTally({ total: 0, verified: 0, error: true }); });
    }
    return () => { cancelled = true; };
  }, [serverHeader.consigneeId, serverHeader.customerId, consRefreshTick]);

  /* Applicable agreements for this lead → drives the Segment Details
   * card counts + powers LeadAgreementSendModal. Refetched whenever
   * EITHER party's tally tick bumps so a successful Send / Recall or a
   * customer/consignee KYC change ripples back into the card.
   * `stage` is in the deps too: the Segment Details card gates on a PI
   * existing, so navigating to / landing on Stage 5 must pull fresh PI
   * state — otherwise a PI created in another tab (or before this view
   * mounted) leaves the card showing its empty-state until a manual
   * reload. */
  useEffect(() => {
    if (!resolvedLeadId) { setAgreementApplicable(null); return; }
    let cancelled = false;
    api.get(`/clm/leads/${resolvedLeadId}/agreement-applicable`)
      .then(res => {
        if (cancelled) return;
        setAgreementApplicable((res.data?.data ?? null) as AgreementApplicablePayload | null);
      })
      .catch(() => { if (!cancelled) setAgreementApplicable(null); });
    return () => { cancelled = true; };
  }, [resolvedLeadId, custRefreshTick, consRefreshTick, agreementRefreshTick, stage]);

  /* Segment Details card tallies — collapse the PI-derived segments into two
   * document-type rollups (Trade Documents + Agreements) regardless of
   * regulatory tier. "done" = the trade doc is uploaded/verified or the
   * agreement signature request has completed; drives the row progress bar. */
  const segDocTallies = useMemo(() => {
    const segs = agreementApplicable?.segments ?? [];
    const buyerEqualsConsignee = !!agreementApplicable?.buyerEqualsConsignee;
    /* Party bucket for an agreement's `party` CSV — mirrors the agreement
     * popup's partyBucket(). When buyer == consignee the popup shows ONLY
     * buyer-only agreements (a Buyer+Consignee or Consignee-only agreement is
     * redundant with a single party), so the card count must exclude the same
     * rows — otherwise the card said "0 of 2" while the popup listed 1. */
    const partyBucket = (party: string | null | undefined): 'buyer' | 'consignee' | 'both' => {
      const tokens = String(party ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const b = tokens.includes('buyer'), c = tokens.includes('consignee');
      if (b && c) return 'both';
      if (b) return 'buyer';
      if (c) return 'consignee';
      return 'both';
    };
    // ONE entry per unique document — a trade doc / agreement applicable to
    // multiple segments is counted once (not once per segment), matching the
    // de-duped Trade Documents / Agreements send popup. Each Map value is the
    // "done" flag, unioned across segments (done in ANY segment ⇒ done).
    const agrSeen = new Map<string, boolean>();
    const tdSeen  = new Map<string, boolean>();
    for (const s of segs) {
      for (const a of s.agreements) {
        // buyer == consignee → count ONLY pure buyer agreements (the Consignee
        // and Buyer+Consignee categories are redundant for a single party).
        // Must match activeAgreements in the send popup.
        if (buyerEqualsConsignee && partyBucket(a.party) !== 'buyer') continue;
        const key  = a.id != null ? `id:${a.id}` : `code:${a.code ?? ''}|title:${a.title ?? ''}`;
        const done = a.signature_request?.status === 'completed';
        agrSeen.set(key, (agrSeen.get(key) ?? false) || done);
      }
      // A trade doc counts as "done" when it's uploaded/verified OR signed
      // (its signature request reached completed) — same way agreements count
      // a completed e-signature.
      for (const td of s.trade_documents) {
        // When buyer == consignee the popup lists every trade doc that involves
        // the buyer (buyer-only AND buyer+consignee "both" docs) — only pure
        // consignee-only mirror copies are excluded (see tdBuckets.all in
        // LeadAgreementSendModal). The card count must match: keep anything with
        // for_buyer, drop pure consignee-only, so a "both" doc still counts once.
        if (buyerEqualsConsignee && !td.for_buyer) continue;
        const key  = td.db_id != null ? `id:${td.db_id}` : `code:${td.doc_code}|ref:${td.reference}|name:${td.name}`;
        const done = td.status === 'Verified' || td.signature_request?.status === 'completed';
        tdSeen.set(key, (tdSeen.get(key) ?? false) || done);
      }
    }
    const agrTotal = agrSeen.size;
    const agrDone  = Array.from(agrSeen.values()).filter(Boolean).length;
    const tdTotal  = tdSeen.size;
    const tdDone   = Array.from(tdSeen.values()).filter(Boolean).length;
    return { agrTotal, agrDone, tdTotal, tdDone };
  }, [agreementApplicable]);

  /* "Marked as key" is sourced live from the server (leads.key_opportunity)
   * so it survives navigation / refresh. Toggling fires a PUT and the
   * follow-up reloadLead() refreshes the toolbar from authoritative
   * server state instead of optimistic-toggling. */
  const isKeyOpportunity = !!serverHeader.keyOpportunity;
  /* Deal lock — once the Proforma Invoice is e-signed, ONLY the centre stage
   * column (2nd column / StageComponent) becomes read-only. The action toolbar
   * and the right-hand Deal Execution panel (3rd column) stay fully usable, and
   * the user can still navigate stages via the stepper / Save & Next. */
  const isSigned = !!serverHeader.piSignedAt;
  /* Shown when the user clicks anywhere on the locked (signed-PI) stage area. */
  const onLockedClick = useCallback(() => {
    toast.warning('PI is signed', 'You cannot edit anything — this opportunity is read-only.');
  }, [toast]);

  const header: OppHeaderData = {
    ...seedHeader,
    /* Opportunity date from the SERVER (the authoritative source, same as the
     * lead worksheet: query_time ?? created_at). The router-state seed only
     * survives the first hop from the worksheet — navigating between stages
     * loses location.state, so seedHeader.oppDate fell back to the hardcoded
     * DEFAULT (10/04/2026). Preferring the loaded server date fixes that. */
    oppDate:            serverHeader.oppDateIso
                          ? new Date(serverHeader.oppDateIso).toLocaleDateString('en-GB')
                          : seedHeader.oppDate,
    /* Customer name from the SERVER (mapped customer's company_name) for the
     * same reason — the seed is lost on stage navigation and fell back to the
     * hardcoded DEFAULT ('GreenHarvest Global'). Stage 1's Opportunity Details
     * reads header.customer, so override it centrally (the top banner already
     * did this inline). */
    customer:           (serverHeader.customerRow?.company_name as string | undefined)?.trim()
                          || seedHeader.customer,
    leadId:             resolvedLeadId,
    qualified:          serverHeader.qualified,
    disqualified:       serverHeader.disqualified,
    taskManager:        serverHeader.taskManager,
    acknowledgements:   serverHeader.acknowledgements,
    customerId:         serverHeader.customerId,
    customerRow:        serverHeader.customerRow,
    consigneeId:        serverHeader.consigneeId,
    consigneeRow:       serverHeader.consigneeRow,
    salespersonId:      serverHeader.salespersonId,
    salespersonName:    serverHeader.salespersonName,
    remark:             serverHeader.remark,
    whatsappStatus:     serverHeader.whatsappStatus,
    whatsappReason:     serverHeader.whatsappReason,
    whatsappScreenshot: serverHeader.whatsappScreenshot,
  };

  // Inject Google Fonts once (matches the other sales pages).
  useEffect(() => {
    const id = 'sm-detail-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  // Furthest stage the user is allowed to jump to via the tracker: the
  // lead's stored stage (lead_stage_id, 1..6) — but never less than the
  // stage currently being viewed, so a deep-linked URL still works. Steps
  // beyond this are LOCKED: you can step back to completed stages but can't
  // skip ahead to a stage you haven't reached yet (the stage must be
  // completed first — advance with the stage's own "Save & Next").
  const furthestStage = Math.max(stage, serverHeader.leadStageId ?? 0);

  // Unlocked navigation primitive — used by the stage components' own
  // "Save & Next" / "Previous" buttons, which gate forward movement
  // themselves (e.g. Stage 4 requires a customer + consignee before
  // advancing). These must always navigate.
  const navStage = (n: StageNum) => navigate('sales.matrix_detail', { oppId, stage: n });

  // Stage tracker click → navigate to the same opportunity at a new stage.
  // No-op for locked (not-yet-reached) future steps: you can step back to
  // completed stages but can't skip ahead to one you haven't reached.
  const goToStage = (n: StageNum) => {
    if (n > furthestStage) return;
    navStage(n);
  };

  // Save & Next  /  Previous helpers (bypass the tracker lock).
  const goPrev = () => stage > 1 && navStage((stage - 1) as StageNum);
  const goNext = () => {
    if (stage >= 6) return;
    // Crossing 5 → 6 via Save & Next is a "deal won" moment — drop a one-shot
    // session flag so the Victory stage celebrates EVERY time it's reached this
    // way (its localStorage gate otherwise only confetti's once per lead ever).
    if (stage === 5 && resolvedLeadId) {
      try { sessionStorage.setItem('cbc_celebrate_victory', String(resolvedLeadId)); } catch { /* private mode → skip */ }
    }
    navStage((stage + 1) as StageNum);
  };

  const goBack = () => navigate('sales.lead_worksheet');

  /* Toolbar handlers — Customer / Consignee route smart based on
   * what's already mapped on the lead. Picker = unmapped, Edit form
   * = already mapped. */
  const onCustomerClick = async () => {
    if (serverHeader.customerId && serverHeader.customerRow) {
      // Eager-loaded server row has `id` (the DB pk) but no `db_id`
      // (the public-API field name). Shim it here so AddCustomerModal,
      // which reads `db_id` for its detail fetch, finds it.
      const row = serverHeader.customerRow as unknown as Record<string, unknown>;
      setCustomerEditing({
        ...row,
        db_id: typeof row.id === 'number' ? (row.id as number) : serverHeader.customerId,
      } as unknown as EditCustomer);
      setCustomerAddOpen(true);
      return;
    }
    await fetchCustomers();
    setCustomerPickerOpen(true);
  };
  const onConsigneeClick = () => {
    if (!serverHeader.customerId) {
      toast.warning('Customer required first', 'Pick or add a customer before managing consignees');
      return;
    }
    // Open the "Manage Consignees" popup — lists every consignee mapped
    // to this lead's customer (and lets the user add / edit them). Same
    // CustomerConsigneesModal used on the Sales Customers list.
    const row = (serverHeader.customerRow ?? {}) as Record<string, unknown>;
    setManageConsigneesTarget({
      id:      (row.customer_code as string | undefined)
                 ?? `C-${String(serverHeader.customerId).padStart(3, '0')}`,
      db_id:   serverHeader.customerId,
      company: (row.company_name as string | undefined) ?? header.customer ?? '',
      country: (row.country as string | undefined) ?? header.country ?? undefined,
    });
  };

  /* Open the Consignee Evidence Vault from the CLM card's Consignee Details
   * row. Opens on the lead's mapped consignee when there is one (immediately,
   * from the eager-loaded row); otherwise it lists the customer's consignees
   * and opens on the first. A consignee-wise tab strip is shown when the
   * customer has more than one. */
  const openConsigneeVault = () => {
    if (customerAddOpen || manageConsigneesTarget) return;
    const custId = serverHeader.customerId;
    if (!custId) return;

    const toTarget = (d: Record<string, unknown>): LeadVaultTarget => ({
      ownerType:   'consignee',
      id:          String(d.id ?? d.consignee_code ?? ''),
      db_id:       typeof d.db_id === 'number' ? d.db_id : undefined,
      company:     (d.company as string | undefined) ?? '',
      segment:     (d.segment as string | undefined) ?? undefined,
      country:     (d.country as string | undefined) ?? header.country,
      risk:        (d.riskLevel as string | undefined) ?? undefined,
      contact:     (d.contact as string | undefined) ?? undefined,
      contactCity: (d.city as string | undefined) ?? undefined,
    });

    // Lead already has a mapped consignee → open on it right away.
    const hasMapped = !!(serverHeader.consigneeId && serverHeader.consigneeRow);
    if (hasMapped) {
      const raw = serverHeader.consigneeRow as Record<string, unknown>;
      setLeadVaultTarget({
        ownerType:   'consignee',
        id:          (raw.consignee_code as string | undefined) ?? `CN-${String(serverHeader.consigneeId).padStart(3, '0')}`,
        db_id:       serverHeader.consigneeId ?? undefined,
        company:     (raw.company_name as string | undefined) ?? '',
        type:        (raw.type    as string | undefined) ?? undefined,
        segment:     (raw.segment as string | undefined) ?? undefined,
        country:     (raw.country as string | undefined) ?? header.country,
        risk:        (raw.risk    as string | undefined) ?? undefined,
        contact:     (raw.contact_person as string | undefined) ?? undefined,
        contactCity: (raw.city as string | undefined) ?? undefined,
      });
    }

    /* Fetch all consignees under the customer — for the tab strip, and (when
     * none is mapped) to pick the first one to open the vault on. */
    setLeadVaultConsignees(null);
    api.get('/consignees', { params: { customer_id: custId } })
      .then(r => {
        const rows: Record<string, unknown>[] = Array.isArray(r.data?.data) ? r.data.data : [];
        if (rows.length === 0) {
          if (!hasMapped) toast.warning('No consignees yet', 'Add a consignee for this customer to track its documents.');
          setLeadVaultConsignees(null);
          return;
        }
        const targets = rows.map(toTarget);
        // No mapped consignee → open on the first one.
        if (!hasMapped) setLeadVaultTarget(targets[0]);
        // Strip only when there's more than one to switch between.
        setLeadVaultConsignees(targets.length > 1 ? targets : null);
      })
      .catch(() => setLeadVaultConsignees(null));
  };

  // Render the active stage in the middle column.
  const StageComponent = (
    stage === 1 ? Stage1InquiryReceived :
    stage === 2 ? Stage2LeadAcknowledgement :
    stage === 3 ? Stage3ProductSourcing :
    stage === 4 ? Stage4PriceShared :
    stage === 5 ? Stage5QuotationVsPI :
                  Stage6VictoryStage
  );

  // Full-page shimmer until the lead data arrives (only when there is a
  // lead to load — never blocks if the id can't be resolved).
  if (resolvedLeadId && !headerLoaded) return <MatrixPageSkeleton />;

  return (
    <div className="smd-root">
      <style>{SALES_MATRIX_DETAIL_CSS}</style>

      {/* ─── Customer Banner ─── */}
      <div className="smd-cust-banner">
        <span className="smd-cust-accent" />
        <span className="smd-cust-glow"  aria-hidden="true" />
        <span className="smd-cust-sheen" aria-hidden="true" />
        <div className="smd-cust-left">
          <div className="smd-cust-avatar-wrap">
            <div className="smd-cust-avatar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <span className="smd-cust-avatar-dot" />
          </div>
          <div>
            {/* Once a customer is mapped to the lead, show the mapped customer's
                company name here; otherwise fall back to the lead/buyer name. */}
            <div className="smd-cust-name">{(serverHeader.customerRow?.company_name as string | undefined)?.trim() || header.customer}</div>
            <span className="smd-cust-tag">
              <span className="smd-cust-tag-dot" />
              <span className="smd-cust-tag-text">Customer</span>
            </span>
          </div>
        </div>
        <div className="smd-cust-meta">
          <button
            type="button"
            className={`smd-hdr-wa ${serverHeader.whatsappStatus === 'connected' ? 'smd-hdr-wa-on' : ''}`}
            onClick={() => setWhatsappOpen(true)}
            aria-label="WhatsApp Status"
          >
            <span className="smd-hdr-wa-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.149-.197.297-.767.967-.94 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>
              </svg>
            </span>
            <span className="smd-hdr-wa-text">WhatsApp Status</span>
          </button>
          <span className="smd-cust-sep" aria-hidden="true"><i /><i /><i /></span>
          <Meta icon={<IconListLines />} label="OPPORTUNITY ID"   value={header.oppId} />
          <span className="smd-cust-sep" aria-hidden="true"><i /><i /><i /></span>
          <Meta icon={<IconCalendar />}  label="OPPORTUNITY DATE" value={header.oppDate} />
          <span className="smd-cust-sep" aria-hidden="true"><i /><i /><i /></span>
          <Meta icon={<IconGlobe />}     label="COUNTRY"          value={header.country} />
          <span className="smd-cust-line" aria-hidden="true" />
        <button className="smd-back-btn" onClick={goBack}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to My Workplace
        </button>
                </div>

      </div>

      {/* ─── 6-step Tracker (own white card) ─── */}
      <div className="smd-stepper-card">
        <div className="smd-stepper">
          {STAGES.map(s => {
            const state = s.n < stage ? 'done' : s.n === stage ? 'active' : 'idle';
            // A step is locked when it's beyond the furthest stage reached —
            // clicking it must not navigate (the stage isn't completed yet).
            const locked = s.n > furthestStage;
            return (
              <div
                key={s.n}
                className={`smd-step smd-step-${state}${locked ? ' smd-step-locked' : ''}`}
                onClick={() => goToStage(s.n)}
                title={locked ? 'Complete the current stage to unlock this step' : undefined}
              >
                <div className="smd-step-head">
                  <span className="smd-step-num">Step 0{s.n}</span>
                </div>
                <div className="smd-step-big">0{s.n}</div>
                <div className="smd-step-title">{s.title}</div>
                <div className="smd-step-sub">{s.sub}</div>
                <span className="smd-step-ghost">0{s.n}</span>
                {state === 'active' && (
                  <span className="smd-step-badge smd-step-badge-active">
                    <span className="smd-step-badge-dot" />
                    <span className="smd-step-badge-text">Active</span>
                  </span>
                )}
                {state === 'done' && (
                  <span className="smd-step-badge smd-step-badge-done">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="smd-step-badge-text">Done</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── Divider between stepper and action toolbar ─── */}
        <div className="smd-stepper-divider" aria-hidden="true" />

        {/* ─── Action Toolbar — same container as the stepper ─── */}
        <div className="smd-toolbar">
        <ActionBtn icon={<IconUser />}     label="Customer" trailing="edit"          onClick={onCustomerClick} />
        <ActionBtn icon={<IconTruck />}    label="Consignees" trailing="edit"
          className={!serverHeader.customerId ? 'smd-act-disabled' : ''}          onClick={onConsigneeClick} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconPlusSq />}   label="Add Product"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setProductAddOpen(true)} />
        <ActionBtn icon={<IconBook />}     label="Product Directory"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setProductDirectoryOpen(true)} />
        <ActionBtn icon={<IconSourcing />} label="Product Sourcing"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setProductSourcingOpen(true)} />
        <ActionBtn icon={<IconDollar />}   label="Share Prices"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setPriceSharedOpen(true)} />
        <ActionBtn icon={<IconUserCog />}  label="Change Owner"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setChangeOwnerOpen(true)} />
        <ActionBtn icon={<IconMsg />}      label="Remark"          onClick={() => setRemarksOpen(true)} />
        <ActionBtn icon={<IconStar />}     label="Key Opportunity"
          className={isKeyOpportunity ? 'smd-act-key' : ''}          onClick={() => setKeyOppOpen(true)} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconBell />}     label="Reminder"          onClick={() => setRemindersOpen(true)} />
        <ActionBtn icon={<IconCalSmall />} label="Meetings"          onClick={() => setMeetingsOpen(true)} />
        </div>
      </div>

      {/* ─── Three-column body ─── */}
      <div
        className={`smd-body${clmCollapsed ? ' smd-body-clm-collapsed' : ''}${dealCollapsed ? ' smd-body-deal-collapsed' : ''}`}
      >
        {/* Left — CLM Details (or thin rail when collapsed) */}
        {clmCollapsed ? (
          <aside
            className="smd-rail smd-rail-left"
            onClick={() => setClmCollapsed(false)}
            role="button"
            tabIndex={0}
            aria-label="Expand CLM Details"
          >
            <button
              className="smd-rail-btn"
              onClick={(e) => { e.stopPropagation(); setClmCollapsed(false); }}
              aria-label="Expand"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div className="smd-rail-label">CLM DETAILS</div>
          </aside>
        ) : (
        <aside className="smd-clm-card">
          <div className="smd-clm-header">
            <div className="smd-clm-header-left">
              <div className="smd-clm-header-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div>
                <div className="smd-clm-title">CLM Details</div>
                <div className="smd-clm-sub"><span className="smd-clm-dot" />Active</div>
              </div>
            </div>
            <button
              className="smd-clm-collapse"
              aria-label="Collapse"
              onClick={() => setClmCollapsed(true)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          {/* KYC group */}
          <div className="smd-clm-group">
            <div className="smd-clm-group-head">
              <div className="smd-clm-group-icon smd-clm-group-icon-violet">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div>
                <div className="smd-clm-group-title">Standard Documents</div>
                <div className="smd-clm-group-sub">One Time · KYC, DD & Licenses</div>
              </div>
            </div>

            {/* Customer row — only renders when a customer is mapped
             *  to this lead. Click opens AddCustomerModal at Stage 3
             *  (Evidence Vault) — that's the stage whose uploads feed
             *  the same `segment_doc_uploads` table the CLM count reads
             *  from. Landing on Stage 2 instead would let users upload
             *  via the "Add Document" button without ever moving the
             *  count, since Stage 2's primary button writes to a
             *  different table (`customer_documents`). */}
            {serverHeader.customerId && serverHeader.customerRow && (
              <ClmRow
                icon={<IconUserSm />}
                tone="amber"
                title="Customer Details"
                sub={renderClmSub(custTally)}
                progress={renderClmProgress(custTally)}
                state={custTally?.error ? 'error' : custTally?.loading ? 'loading' : 'ready'}
                onRetry={custTally?.error ? () => setCustRefreshTick(t => t + 1) : undefined}
                disabled={customerAddOpen || !!manageConsigneesTarget}
                onClick={() => {
                  if (customerAddOpen || manageConsigneesTarget) return;
                  /* Open the standalone Evidence Vault popup — DD / KYC /
                   * Trade License / Trade Documents in tabs with the
                   * send-for-signature action for any missing / unsigned
                   * doc. Built from the eager-loaded customer row. */
                  const row = serverHeader.customerRow as Record<string, unknown>;
                  setLeadVaultTarget({
                    ownerType:   'customer',
                    id:          (row.customer_code as string) || header.customerCode || `C-${String(serverHeader.customerId).padStart(3, '0')}`,
                    db_id:       serverHeader.customerId ?? undefined,
                    company:     (row.company_name as string) || header.customer,
                    type:        (row.type    as string | undefined) ?? undefined,
                    segment:     (row.segment as string | undefined) ?? undefined,
                    country:     (row.country as string | undefined) ?? header.country,
                    risk:        (row.risk    as string | undefined) ?? undefined,
                    contact:     (row.contact_person as string | undefined) ?? (row.primary_contact as string | undefined) ?? undefined,
                    contactCity: (row.city as string | undefined) ?? undefined,
                  });
                }}
              />
            )}
            {/* Consignee row — renders as soon as a CUSTOMER is mapped,
             *  regardless of whether a consignee is mapped to the lead yet.
             *  The count aggregates every consignee under the customer (see
             *  consTally effect). Clicking opens the vault on the lead's
             *  mapped consignee when there is one, else on the customer's
             *  first consignee — with a tab strip when there's more than
             *  one. consignee_code fallbacks use the REAL value from the
             *  eager-loaded row only. */}
            {serverHeader.customerId && (
              <ClmRow
                icon={<IconTruckSm />}
                tone="emerald"
                title="Consignee Details"
                sub={renderClmSub(consTally)}
                progress={renderClmProgress(consTally)}
                state={consTally?.error ? 'error' : consTally?.loading ? 'loading' : 'ready'}
                onRetry={consTally?.error ? () => setConsRefreshTick(t => t + 1) : undefined}
                disabled={customerAddOpen || !!manageConsigneesTarget}
                onClick={openConsigneeVault}
              />
            )}
            {/* Empty-state hint — shown only when no customer is mapped yet,
             *  so the user knows what unlocks this panel. Once a customer is
             *  mapped, the Customer + Consignee rows replace it. */}
            {!serverHeader.customerId && (
              <div className="smd-clm-empty">
                Map a customer from the toolbar above to track its KYC + Trade documents here.
              </div>
            )}
          </div>

          {/* Segment group */}
          <div className="smd-clm-group">
            <div className="smd-clm-group-head">
              <div className="smd-clm-group-icon smd-clm-group-icon-emerald">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                </svg>
              </div>
              <div>
                <div className="smd-clm-group-title">Case to Case Agreements</div>
                <div className="smd-clm-group-sub">Per Deal · Trade Docs & Agreements</div>
              </div>
            </div>

            {/* Agreement send is unlocked when a Proforma Invoice has
                been mapped to the lead — without a PI we don't know
                which products (and therefore which segments) apply, so
                the segment rows would have nothing to filter on. While
                no PI is mapped we show the same dashed empty-state
                pattern the KYC/DD group uses above; once a PI exists
                the two regulatory rows render with live counts and the
                row click opens the agreement send modal. */}
            {agreementApplicable?.pi ? (
              <>
                {/* Trade Documents — every segment-applicable trade doc for
                    the PI's products, across both regulatory tiers. */}
                <ClmRow
                  icon={<IconShieldSm />}
                  tone="emerald"
                  title="Trade Documents"
                  sub={segDocTallies.tdTotal < 1
                    ? 'No trade documents'
                    : `${segDocTallies.tdDone} of ${segDocTallies.tdTotal} uploaded`}
                  progress={segDocTallies.tdTotal > 0
                    ? Math.round((segDocTallies.tdDone / segDocTallies.tdTotal) * 100)
                    : 0}
                  onClick={() => {
                    if (segDocTallies.tdTotal < 1) {
                      toast.warning('No trade documents', 'No product on this PI maps to a segment with trade documents.');
                      return;
                    }
                    setAgreementModalView('trade'); setAgreementModalOpen(true);
                  }}
                />
                {/* Agreements — every segment-applicable agreement for the
                    PI's products, across both regulatory tiers. */}
                <ClmRow
                  icon={<IconShieldSm />}
                  tone="rose"
                  title="Agreements"
                  sub={segDocTallies.agrTotal < 1
                    ? 'No agreements'
                    : `${segDocTallies.agrDone} of ${segDocTallies.agrTotal} signed`}
                  progress={segDocTallies.agrTotal > 0
                    ? Math.round((segDocTallies.agrDone / segDocTallies.agrTotal) * 100)
                    : 0}
                  onClick={() => {
                    if (segDocTallies.agrTotal < 1) {
                      toast.warning('No agreements', 'No product on this PI maps to a segment with agreements to send.');
                      return;
                    }
                    setAgreementModalView('agreements'); setAgreementModalOpen(true);
                  }}
                />
              </>
            ) : (
              <div className="smd-clm-empty">
                Create a proforma invoice on this lead to fetch segment-applicable trade documents and agreements here.
              </div>
            )}
          </div>
        </aside>
        )}

        {/* Middle — stage-specific content. The inner .smd-stg-scroll wrapper
            scrolls internally when a stage's content (e.g. Stage 6's shipment
            summary) is taller than the column, so the centre matches the side
            panels' height instead of stretching the whole row. */}
        <section className={`smd-stage-card${(isSigned && stage <= 2) ? ' smd-stage-card-locked' : ''}`}>
          {/* Signed-PI lock tiers:
              · Stages 1-2 → COMPLETELY OFF: a translucent veil covers the whole
                stage and raises the "PI is signed" toaster on any click.
              · Stages 3-4 → READ-ONLY: no veil, so the user can switch the
                stage's inner tabs and view data, but every submit / action
                control is disabled via the `locked` prop.
              · Stage 5 → view-only (create/edit disabled via `locked`).
              · Stage 6 → fully editable (work happens there after signing). */}
          {isSigned && stage <= 2 && (
            <div
              className="smd-stage-veil"
              onClick={onLockedClick}
              role="button"
              tabIndex={-1}
              aria-label="PI signed — read-only"
            >
              <span className="smd-stage-veil-badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                PI signed — read-only
              </span>
            </div>
          )}
          <div className="smd-stg-scroll">
          <StageComponent
            header={header}
            stage={stage}
            onPrev={goPrev}
            onNext={goNext}
            reloadLead={reloadLead}
            /* Stage 5 keeps its in-stage create/edit lock; Stage 6 stays fully
               editable so the user can work there after the PI is signed. */
            locked={isSigned && stage <= 5}
            /* Create-PI gate for Stage 5, derived from the vault tallies this
               parent already fetches (custTally / consTally) — saves Stage 5
               from re-calling /segment-uploads/{party}/vault. A party with
               total>0 and verified<total still has Standard Documents pending. */
            mandatoryIncomplete={
              (!!custTally && custTally.total > 0 && custTally.verified < custTally.total) ||
              (!!consTally && consTally.total > 0 && consTally.verified < consTally.total)
            }
            // Stage 5 calls this after a PI is created or edited so
            // the Segment Details card unlocks immediately instead of
            // waiting for the user to click Save & Next (the only
            // other path that previously re-rendered with fresh
            // server state). The tick triggers the
            // /clm/leads/{id}/agreement-applicable refetch — when its
            // `pi` field flips from null to populated, the card
            // becomes enabled with live segment counts.
            onPiChange={() => setAgreementRefreshTick(t => t + 1)}
          />
          </div>
        </section>

        {/* Right — Deal Execution & Decision Engine (or thin rail when collapsed) */}
        {dealCollapsed ? (
          <aside
            className="smd-rail smd-rail-right"
            onClick={() => setDealCollapsed(false)}
            role="button"
            tabIndex={0}
            aria-label="Expand Deal Execution & Decision Engine"
          >
            <button
              className="smd-rail-btn"
              onClick={(e) => { e.stopPropagation(); setDealCollapsed(false); }}
              aria-label="Expand"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="smd-rail-label">DECISION ENGINE</div>
          </aside>
        ) : (
        <aside className="smd-deal-card">
          <div className="smd-deal-header">
            <div className="smd-deal-header-left">
              <div className="smd-deal-header-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <div className="smd-deal-title">Deal Execution &amp; Decision Engine</div>
                <div className="smd-deal-sub"><span className="smd-deal-dot" />Control execution and track deal progress.</div>
              </div>
            </div>
            <button
              className="smd-clm-collapse"
              aria-label="Collapse"
              onClick={() => setDealCollapsed(true)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <TaskManagerPanel
            leadId={resolvedLeadId}
            salespersonName={serverHeader.salespersonName || ''}
            initial={serverHeader.taskManager ?? null}
            onSaved={(row: TaskManagerRow) => {
              // Refresh in-place — Stage 1's read-only display reads from
              // serverHeader.taskManager so this is all it takes to push
              // the freshly saved row to the left card.
              setServerHeader(prev => ({ ...prev, taskManager: row }));
            }}
          />
        </aside>
        )}
      </div>

      {/* ── Customer picker + edit/create modal ── */}
      <EntityPickerModal
        open={customerPickerOpen}
        title="Customer"
        subtitle="Pick an existing customer to edit, or click + to register a new one"
        fieldLabel="Select Customer"
        placeholder="Choose a customer"
        emptyHint="No customers yet — click + to add the first"
        addLabel="Add new customer"
        options={customerOpts}
        loading={customerLoading}
        onClose={() => setCustomerPickerOpen(false)}
        onAdd={() => {
          setCustomerPickerOpen(false);
          setCustomerEditing(null);
          setCustomerAddOpen(true);
        }}
        onEdit={async (opt) => {
          setCustomerPickerOpen(false);
          const row = customerRows[opt.value];
          if (!row) {
            toast.error('Customer missing', 'Could not load the picked customer');
            return;
          }
          // Pick → bind the customer to this lead so subsequent visits
          // open the Edit form directly. db_id is the row's primary key
          // (set in fetchCustomers); the public_id stays for display.
          const dbId = (row as EditCustomer & { db_id?: number }).db_id;
          if (resolvedLeadId && dbId) {
            try {
              await api.put(`/sales/leads/${resolvedLeadId}`, { customer_id: dbId });
              toast.success('Customer mapped', `Linked to this opportunity`);
              await reloadLead();
            } catch (e: any) {
              // Surface the backend's 422 message (e.g. the Customer ↔ Product
              // segment-match guard) so the user sees WHY the mapping failed
              // rather than a generic error.
              toast.error('Mapping failed', e?.response?.data?.message ?? 'Could not link this customer to the lead');
              // Don't open the edit form when the bind was rejected — the
              // customer isn't linked, so fall through with the picker closed.
              return;
            }
          }
          setCustomerEditing(row);
          setCustomerAddOpen(true);
        }}
      />
      <AddCustomerModal
        open={customerAddOpen}
        customer={customerEditing}
        initialStage={clmInitialStage}
        /* onClose intentionally does NOT bump the refresh tick — closing
         * without saving can't have changed any uploads, so a refetch
         * would just be a wasted round-trip. The tick only fires on
         * onSaved below. */
        onClose={() => { setCustomerAddOpen(false); setCustomerEditing(null); setClmInitialStage(undefined); }}
        onSaved={() => {
          setCustomerOpts([]); setCustomerRows({});
          setCustomerAddOpen(false); setCustomerEditing(null); setClmInitialStage(undefined);
          /* Bump BOTH ticks: editing the customer's Stage-3 docs here must
           * also move a "Same as Customer" consignee's bar (it mirrors the
           * customer). Consignee-side refetch is harmless when not mirrored. */
          setCustRefreshTick(t => t + 1);
          setConsRefreshTick(t => t + 1);
          void reloadLead();
        }}
      />

      {/* ── Manage Consignees popup ──
          Opened from the Consignee toolbar button. Lists every consignee
          mapped to this lead's customer and lets the user add / edit them
          (it embeds AddConsigneeModal internally, pre-locked to the
          customer). On close we refresh the lead header + Consignee
          Details tally in case the set changed. */}
      <CustomerConsigneesModal
        open={!!manageConsigneesTarget}
        customer={manageConsigneesTarget}
        title="Manage Consignees"
        onClose={() => {
          setManageConsigneesTarget(null);
          setConsRefreshTick(t => t + 1);
          void reloadLead();
        }}
      />

      {/* ── Add Product modal ──
          Creates a brand-new product in the global Product master only.
          It is NOT auto-mapped to this opportunity — the Product Directory
          should list only products the user explicitly maps via
          "Map Product". To attach this product, open the Product Directory
          and map it there. */}
      {productAddOpen && (
        <AddProductModal
          productId={null}
          onClose={() => setProductAddOpen(false)}
          onSaved={(_pid, finalised) => {
            if (!finalised) return;
            setProductAddOpen(false);
            toast.success('Product created', 'Map it from the Product Directory to attach it to this opportunity');
          }}
        />
      )}

      {/* ── Product Directory popup (mapped-products table) ── */}
      <ProductDirectoryModal
        open={productDirectoryOpen}
        leadId={resolvedLeadId ?? null}
        leadStage={furthestStage}
        onClose={() => setProductDirectoryOpen(false)}
        onAddProduct={() => {
          /* "+ New Master" inside the directory chains into the same
             Add Product wizard the toolbar pill opens; once the new
             master is saved, return to the directory so the user can
             map it. */
          setProductDirectoryOpen(false);
          setProductAddOpen(true);
        }}
      />

      {/* ── Product Sourcing (Stage 3) popup — embeds the REAL Stage 3 so
              the toolbar action is identical to the inline pipeline view
              (single source of truth; pipeline footer suppressed). ── */}
      <StageEmbedModal open={productSourcingOpen} onClose={() => setProductSourcingOpen(false)}>
        <Stage3ProductSourcing
          header={header}
          stage={3}
          onPrev={() => {}}
          onNext={() => {}}
          reloadLead={reloadLead}
          embedded
        />
      </StageEmbedModal>

      {/* ── Price Shared (Stage 4) popup — embeds the REAL Stage 4. ── */}
      <StageEmbedModal open={priceSharedOpen} onClose={() => setPriceSharedOpen(false)}>
        <Stage4PriceShared
          header={header}
          stage={4}
          onPrev={() => {}}
          onNext={() => {}}
          reloadLead={reloadLead}
          embedded
        />
      </StageEmbedModal>

      {/* ── Change Lead Owner popup ── */}
      <ChangeOwnerModal
        open={changeOwnerOpen}
        currentOwner={serverHeader.salespersonName || 'Unassigned'}
        owners={ownerOpts}
        onClose={() => setChangeOwnerOpen(false)}
        onUpdate={async (opt) => {
          if (!resolvedLeadId) return;
          try {
            await api.put(`/sales/leads/${resolvedLeadId}`, { salesperson_id: Number(opt.value) });
            toast.success('Owner updated', `Reassigned to ${opt.label}`);
            await reloadLead();
          } catch {
            toast.error('Update failed', 'Could not reassign the lead');
          }
        }}
      />

      {/* ── Remarks popup ── */}
      <RemarksModal
        open={remarksOpen}
        currentRemark={serverHeader.remark ?? ''}
        onClose={() => setRemarksOpen(false)}
        onSave={async (text) => {
          if (!resolvedLeadId) return;
          // Empty string is the explicit "Clear" path from the modal —
          // server treats null as the wipe value so we pass null instead
          // of "".
          const payload = { remark: text.length > 0 ? text : null };
          try {
            await api.put(`/sales/leads/${resolvedLeadId}`, payload);
            toast.success(
              text.length > 0 ? 'Remark saved' : 'Remark cleared',
              text.length > 0 ? 'Note attached to this opportunity' : 'Note removed from this opportunity',
            );
            await reloadLead();
            setRemarksOpen(false);
          } catch {
            toast.error('Save failed', 'Could not save the remark');
          }
        }}
      />

      {/* ── WhatsApp Status popup ── */}
      <WhatsAppStatusModal
        open={whatsappOpen}
        leadId={resolvedLeadId ?? null}
        currentStatus={serverHeader.whatsappStatus ?? null}
        currentReason={serverHeader.whatsappReason ?? null}
        currentScreenshot={serverHeader.whatsappScreenshot ?? null}
        onClose={() => setWhatsappOpen(false)}
        onSaved={() => { setWhatsappOpen(false); void reloadLead(); }}
      />

      {/* ── Reminders directory (list + child Add form) ── */}
      <RemindersListModal
        open={remindersOpen}
        oppId={header.oppId}
        oppDate={header.oppDate}
        onClose={() => setRemindersOpen(false)}
      />

      {/* ── Meetings directory (list + child Add form) ── */}
      <MeetingsListModal
        open={meetingsOpen}
        oppId={header.oppId}
        oppDate={header.oppDate}
        /* Pre-fill the Add form with the lead's mapped customer + their
         * primary email and primary contact so the user doesn't retype them. */
        defaultCustomer={
          (serverHeader.customerRow as Record<string, unknown> | null | undefined)?.company_name as string | undefined
          ?? header.customer
        }
        defaultEmail={
          (serverHeader.customerRow as Record<string, unknown> | null | undefined)?.primary_email as string | undefined
          ?? undefined
        }
        defaultContact={(() => {
          const row = serverHeader.customerRow as Record<string, unknown> | null | undefined;
          // Relation may serialize as primary_address (snake) or primaryAddress.
          const addr = (row?.primary_address ?? row?.primaryAddress) as Record<string, unknown> | null | undefined;
          return (addr?.cp_contact as string | undefined) ?? undefined;
        })()}
        onClose={() => setMeetingsOpen(false)}
      />

      {/* ── Lead-scoped trade-document / agreement popup ──
          Opened from the left CLM card's "Trade Documents" and
          "Agreements" rows. `view` selects which document type the
          popup lands on. Pre-loaded payload is passed through so the
          modal renders instantly; the modal also re-fetches after
          each Send so the row status badges stay live. */}
      <LeadAgreementSendModal
        open={agreementModalOpen}
        leadId={resolvedLeadId}
        view={agreementModalView}
        data={agreementApplicable}
        onClose={() => {
          setAgreementModalOpen(false);
          // Re-pull so the Segment Details card reflects any status that
          // changed while the popup was open — e.g. a trade doc / agreement
          // that got signed via the popup's live Zoho poll.
          setAgreementRefreshTick(t => t + 1);
        }}
        onSent={() => setAgreementRefreshTick(t => t + 1)}
      />

      {/* ── Key Opportunity confirm popup ──
          Persists to `leads.key_opportunity` via the existing PUT
          endpoint. The toolbar pill's `smd-act-key` highlight is
          driven by serverHeader, so the flag survives close+reopen. */}
      <KeyOpportunityModal
        open={keyOppOpen}
        isKey={isKeyOpportunity}
        onClose={() => setKeyOppOpen(false)}
        onConfirm={async () => {
          if (!resolvedLeadId) {
            toast.warning('No lead in context', 'Open this opportunity from the Lead Worksheet to mark it');
            return;
          }
          const next = !isKeyOpportunity;
          try {
            await api.put(`/sales/leads/${resolvedLeadId}`, { key_opportunity: next });
            toast.success(
              next ? 'Marked as Key Opportunity' : 'Unmarked Key Opportunity',
              next ? 'This deal is now flagged as high-priority' : 'Removed the key-opportunity flag',
            );
            await reloadLead();
          } catch {
            toast.error('Save failed', 'Could not update the key-opportunity flag');
          }
        }}
      />

      {/* ── Lead Evidence Vault popup ──
          Opened from the left CLM card's Customer Details / Consignee
          Details rows. Dedicated lead-scoped vault: four document tabs
          (Due Diligence / KYC / Trade License / Trade Documents) with
          live data + per-document View / Download / Upload-replace /
          Certificate actions. On close, refresh the matching party's
          CLM tally so the panel progress bars reflect any upload. */}
      <LeadEvidenceVaultModal
        open={!!leadVaultTarget}
        target={leadVaultTarget}
        consignees={leadVaultConsignees}
        mappedConsigneeId={serverHeader.consigneeId}
        onClose={() => {
          /* Refresh BOTH party tallies, not just the one whose vault was
           * open. A "Same as Customer" consignee mirrors the customer's
           * docs, so a customer-side upload must also move the consignee
           * bar — bumping only the customer tick left the consignee bar
           * stale (it showed the old %, while the customer bar updated).
           * For a normal consignee this just re-fetches its own unchanged
           * data, which is harmless. */
          setCustRefreshTick(t => t + 1);
          setConsRefreshTick(t => t + 1);
          setLeadVaultTarget(null);
          setLeadVaultConsignees(null);
        }}
      />
    </div>
  );
}

/* ─── Tiny presentational helpers ─── */

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="smd-meta">
      <div className="smd-meta-icon">{icon}</div>
      <div>
        <div className="smd-meta-label">{label}</div>
        <div className="smd-meta-value">{value}</div>
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, trailing, className, onClick, locked, onLocked }: {
  icon: React.ReactNode; label: string; trailing?: 'edit'; className?: string; onClick?: () => void; locked?: boolean; onLocked?: () => void;
}) {
  return (
    <button
      /* When locked we DON'T disable the button — it stays clickable so a tap
         raises the "deal locked" toast. The colour is unchanged; a translucent
         veil (.smd-act-locked::after) signals the locked state. */
      className={`smd-act ${className || ''}${locked ? ' smd-act-locked' : ''}`}
      onClick={locked ? onLocked : onClick}
      title={locked ? 'Locked — the Proforma Invoice has been signed' : undefined}
      type="button"
    >
      <span className="smd-act-icon">{icon}</span>
      <span className="smd-act-label">{label}</span>
      {trailing === 'edit' && (
        <span className="smd-act-trail" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </span>
      )}
    </button>
  );
}

/* Helpers for the CLM row sub-text + progress — kept module-scope so
 * the JSX above stays readable. `tally === null` = no party mapped
 * (row shouldn't render at all); `error` = fetch failed; `loading` =
 * fetch in flight; otherwise the catalog tally. */
type ClmTallyState = { total: number; verified: number; error?: boolean; loading?: boolean } | null;
function renderClmSub(t: ClmTallyState): string {
  if (t == null || t.loading) return 'Loading documents…';
  if (t.error)                return 'Couldn’t load — tap to retry';
  if (t.total === 0)          return 'No segment rules set';
  return `${t.verified} of ${t.total} documents`;
}
function renderClmProgress(t: ClmTallyState): number {
  if (t == null || t.loading || t.error || t.total === 0) return 0;
  return Math.min(100, Math.round((t.verified / t.total) * 100));
}

function ClmRow({ icon, tone, title, sub, progress, state, onClick, onRetry, disabled }: {
  icon: React.ReactNode; tone: 'amber'|'emerald'|'rose'|'orange';
  title: string; sub: string; progress: number;
  state?: 'ready' | 'loading' | 'error';
  onClick?: () => void;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  const clickable = typeof onClick === 'function' && !disabled;
  const handleClick = onRetry ? onRetry : onClick;
  return (
    <div
      className={[
        'smd-clm-row',
        clickable ? 'smd-clm-row-clickable' : '',
        disabled  ? 'smd-clm-row-disabled' : '',
        state === 'error'   ? 'smd-clm-row-error'   : '',
        state === 'loading' ? 'smd-clm-row-loading' : '',
      ].filter(Boolean).join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick?.(); } } : undefined}
    >
      <div className="smd-clm-row-head">
        <div className={`smd-clm-row-icon smd-clm-row-icon-${tone}`}>{icon}</div>
        <div className="smd-clm-row-text">
          <div className="smd-clm-row-title">{title}</div>
          <div className="smd-clm-row-sub">{sub}</div>
        </div>
        <button
          className="smd-clm-row-go"
          aria-label={state === 'error' ? 'Retry' : 'Open'}
          disabled={disabled}
          onClick={clickable ? (e) => { e.stopPropagation(); handleClick?.(); } : undefined}
        >
          {state === 'error' ? (
            // Retry / refresh icon
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M7 17 17 7M7 7h10v10" />
            </svg>
          )}
        </button>
      </div>
      <div className="smd-clm-progress">
        <div className={`smd-clm-progress-fill smd-clm-progress-fill-${tone}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="smd-clm-progress-label">{progress}%</div>
    </div>
  );
}

/* ─── Inline icon set (keeps wrapper self-contained) ─── */

const IconListLines = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>);
const IconCalendar = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>);
const IconGlobe    = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12 15.3 15.3 0 0 1 12 2z"/></svg>);

const IconUser     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconTruck    = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>);
const IconPlusSq   = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>);
const IconBook     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>);
const IconSourcing = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>);
const IconUserCog  = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="11" r="2"/></svg>);
const IconMsg      = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);
const IconStar     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2"/></svg>);
const IconBell     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>);
const IconCalSmall = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>);
const IconDollar   = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>);

const IconUserSm   = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconTruckSm  = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/></svg>);
const IconShieldSm = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);
