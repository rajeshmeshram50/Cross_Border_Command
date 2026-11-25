import { useCallback, useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateContext } from '../../../../components/App';
import api from '../../../../api';
import { decodeOppId, decodeStage } from '../../../../utils/oppCrypto';
import { useToast } from '../../../../contexts/ToastContext';
import EntityPickerModal, { type PickerOption } from '../EntityPickerModal';
import AddCustomerModal, { type EditCustomer } from '../../core-masters/customer/AddCustomerModal';
import CustomerConsigneesModal, { type CustomerLite } from '../../core-masters/customer/CustomerConsigneesModal';
import LeadEvidenceVaultModal, { type LeadVaultTarget } from '../LeadEvidenceVaultModal';
import AddProductModal from '../../../p2p/p2p-master-management/product-management/AddProductModal';
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


export type StageNum = 1 | 2 | 3 | 4 | 5 | 6;

const STAGES: { n: StageNum; title: string; sub: string }[] = [
  { n: 1, title: 'Inquiry Received',     sub: 'Lead inquiry captured' },
  { n: 2, title: 'Lead Acknowledgement', sub: 'Qualification confirmed' },
  { n: 3, title: 'Product Sourcing',     sub: 'Product/supplier sourcing' },
  { n: 4, title: 'Price Shared',         sub: 'Quoted prices shared with customer' },
  { n: 5, title: 'Quotation vs PI',      sub: 'Quotation/PI comparison' },
  { n: 6, title: 'Victory Stage',        sub: 'Deal successfully won' },
];

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
  leadId?: number;
  oppId: string;
  customer: string;
  customerCode: string;
  oppDate: string;
  country: string;
  qualified?:    boolean;
  disqualified?: boolean;
  downstreamWork?: string[];
  taskManager?: StageTaskManager | null;
  acknowledgements?: StageAcknowledgement[];
  customerId?:        number | null;
  customerRow?:       Record<string, unknown> | null;
  lockedCurrency?:    string | null;
  consigneeId?:       number | null;
  consigneeRow?:      Record<string, unknown> | null;
  leadStageId?:       number;
  salespersonId?:     number | null;
  salespersonName?:   string;
  remark?:            string | null;
  whatsappStatus?:     'connected' | 'pending' | 'not_connected' | 'opted_out' | null;
  whatsappReason?:     string | null;
  whatsappScreenshot?: string | null;
};

const DEFAULT_HEADER: OppHeaderData = {
  oppId:        'OPP-001',
  customer:     '—',
  customerCode: '',
  oppDate:      '—',
  country:      '—',
};

const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isIndiaCountry = (c?: string | null): boolean => {
  const v = (c ?? '').trim().toLowerCase();
  return v === 'india' || v === 'in' || v === 'ind';
};
const fmtDmy = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getDate()).padStart(2, '0')}-${DMY_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

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

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerRows, setCustomerRows] = useState<Record<string, EditCustomer>>({});
  const [customerEditing, setCustomerEditing] = useState<EditCustomer | null>(null);
  const [customerAddOpen, setCustomerAddOpen] = useState(false);

  const [manageConsigneesTarget, setManageConsigneesTarget] = useState<CustomerLite | null>(null);

  const [leadVaultTarget, setLeadVaultTarget] = useState<LeadVaultTarget | null>(null);
  const [leadVaultConsignees, setLeadVaultConsignees] = useState<LeadVaultTarget[] | null>(null);
  const [leadVaultBackTo, setLeadVaultBackTo] = useState<LeadVaultTarget | null>(null);


  const [productAddOpen, setProductAddOpen] = useState(false);
  const [productDirectoryOpen, setProductDirectoryOpen] = useState(false);
  const [productsTick, setProductsTick]                 = useState(0);
  const [priceTick, setPriceTick]                       = useState(0);
  const [productSourcingOpen, setProductSourcingOpen]   = useState(false);
  const [priceSharedOpen, setPriceSharedOpen]           = useState(false);
  const [changeOwnerOpen, setChangeOwnerOpen] = useState(false);
  const [remarksOpen, setRemarksOpen] = useState(false);
  const [keyOppOpen, setKeyOppOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [ownerOpts, setOwnerOpts] = useState<Array<{ value: string; label: string }>>([]);

  const [agreementApplicable, setAgreementApplicable] = useState<AgreementApplicablePayload | null>(null);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [agreementModalView, setAgreementModalView] = useState<'trade' | 'agreements'>('agreements');

  const [clmCollapsed, setClmCollapsed] = useState(false);
  const [dealCollapsed, setDealCollapsed] = useState(false);

  type ClmTally = { total: number; verified: number; catalog?: number; catalogVerified?: number; error?: boolean; loading?: boolean } | null;
  const [custTally, setCustTally] = useState<ClmTally>(null);
  const [consTally, setConsTally] = useState<ClmTally>(null);
  const [custRefreshTick, setCustRefreshTick] = useState(0);
  const [consRefreshTick, setConsRefreshTick] = useState(0);
  const [agreementRefreshTick, setAgreementRefreshTick] = useState(0);
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
    setCustomerLoading(true);
    try {
      type Row = EditCustomer & { db_id?: number };
      const res = await api.get<{ data?: Row[] } | Row[]>('/customers', { params: { tab: 'all' } });
      const rows = Array.isArray(res.data) ? res.data : ((res.data as { data?: Row[] })?.data ?? []);
      const cache: Record<string, EditCustomer> = {};
      rows.forEach(r => { if (r.id) cache[r.id] = r; });
      setCustomerRows(cache);
    } catch {
      toast.error('Failed to load customers', 'Could not reach the Customer API');
    } finally {
      setCustomerLoading(false);
    }
  };

  const oppId = params.oppId ? decodeOppId(params.oppId) : DEFAULT_HEADER.oppId;
  const stage = Math.min(6, Math.max(1, decodeStage(params.stage || '1'))) as StageNum;

  const seedHeader: OppHeaderData = useMemo(() => {
    const fromState = (location.state as any)?.row;
    if (fromState && fromState.oppId === oppId) {
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

  const [serverHeader, setServerHeader] = useState<{
    qualified?:           boolean;
    disqualified?:        boolean;
    downstreamWork?:      string[];
    readOnly?:            boolean;
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
    piSentForSignatureAt?: string | null;
    oppDateIso?:          string | null;
    leadSenderName?:      string | null;
    leadSenderCompany?:   string | null;
    leadCountry?:         string | null;
    lockedCurrency?:      string | null;
  }>({});

  const [resolvedLeadId, setResolvedLeadId] = useState<number | undefined>(seedHeader.leadId);

  useEffect(() => {
    if (seedHeader.leadId !== undefined) setResolvedLeadId(seedHeader.leadId);
  }, [seedHeader.leadId]);

  const [leadIdResolved, setLeadIdResolved] = useState<boolean>(!!seedHeader.leadId);

  useEffect(() => {
    if (resolvedLeadId || !oppId) { setLeadIdResolved(true); return; }
    let cancelled = false;
    api.get<{ data: Array<{ id: number; opp_code: string }> }>('/sales/leads', {
      params: { search: oppId, status: 'all', per_page: 5, page: 1, with_counts: 0 },
    })
      .then(({ data }) => {
        const exact = (data.data ?? []).find(r => r.opp_code === oppId);
        if (exact) setResolvedLeadId(exact.id);
      })
      .catch(() => {  })
      .finally(() => { if (!cancelled) setLeadIdResolved(true); });
    return () => { cancelled = true; };
  }, [resolvedLeadId, oppId]);

  const [headerLoaded, setHeaderLoaded] = useState(false);

  const reloadLead = useCallback(() => {
    if (!resolvedLeadId) return;
    return api.get<{ status: boolean; data: {
      qualified: boolean;
      disqualified: boolean;
      downstream_work?: string[];
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
      read_only: boolean;

      pi_signed_at: string | null;
      pi_sent_for_signature_at: string | null;
      opportunity_date_iso: string | null;
      locked_currency: string | null;
      sender_name: string | null;
      sender_company: string | null;
      sender_country_iso: string | null;
      sender_country_name: string | null;
    }}>(`/sales/leads/${resolvedLeadId}`)
      .then(({ data }) => {
        const d = data.data;
        setServerHeader({
          qualified:           d.qualified,
          disqualified:        d.disqualified,
          downstreamWork:      d.downstream_work ?? [],
          keyOpportunity:      !!d.key_opportunity,
          taskManager:         d.task_manager,
          acknowledgements:    d.acknowledgements ?? [],
          salespersonId:       d.salesperson_id,
          salespersonName:     d.salesperson?.name ?? '',
          leadStageId:         d.lead_stage_id,
          customerId:          d.customer_id,
          customerRow:         d.customer,
          lockedCurrency:      d.locked_currency ?? null,
          consigneeId:         d.consignee_id,
          consigneeRow:        d.consignee,
          remark:              d.remark,
          whatsappStatus:      d.whatsapp_status,
          whatsappReason:      d.whatsapp_reason,
          whatsappScreenshot:  d.whatsapp_screenshot_url ?? d.whatsapp_screenshot,
          readOnly:            !!d.read_only,

          piSignedAt:          d.pi_signed_at,
          piSentForSignatureAt: d.pi_sent_for_signature_at,
          oppDateIso:          d.opportunity_date_iso,
          leadSenderName:      d.sender_name,
          leadSenderCompany:   d.sender_company,
          leadCountry:         d.sender_country_iso || d.sender_country_name,
        });
      })
      .catch(() => toast.error('Load failed', 'Could not load this lead'))
      .finally(() => setHeaderLoaded(true));
  }, [resolvedLeadId, toast, productsTick]);

  useEffect(() => { reloadLead(); }, [reloadLead]);

  type VaultResponse = {
    data?: {
      total_documents?: number;
      verified_signed?: number;
      core_total_documents?: number;
      core_verified_signed?: number;
      core_catalog_documents?: number;
      core_catalog_verified?: number;
    };
  };

  useEffect(() => {
    const cid = serverHeader.customerId;
    if (!cid) { setCustTally(null); return; }
    setCustTally({ total: 0, verified: 0, loading: true });
    let cancelled = false;
    api.get<VaultResponse>(`/segment-uploads/customer/${cid}/vault`, { params: { tally: 1 } })
      .then(res => {
        if (cancelled) return;
        const d = res.data?.data;
        setCustTally({
          total:    Number(d?.core_total_documents ?? d?.total_documents ?? 0),
          verified: Number(d?.core_verified_signed ?? d?.verified_signed ?? 0),
          catalog:         Number(d?.core_catalog_documents ?? d?.total_documents ?? 0),
          catalogVerified: Number(d?.core_catalog_verified ?? d?.verified_signed ?? 0),
        });
      })
      .catch(() => { if (!cancelled) setCustTally({ total: 0, verified: 0, error: true }); });
    return () => { cancelled = true; };
  }, [serverHeader.customerId, custRefreshTick]);

  useEffect(() => {
    const directId = serverHeader.consigneeId;
    const custId   = serverHeader.customerId;
    if (!directId && !custId) { setConsTally(null); return; }
    let cancelled = false;
    setConsTally({ total: 0, verified: 0, loading: true });

    type VaultTally = {
      total: number; verified: number; catalog: number; catalogVerified: number;
    };
    const fetchVault = (consigneeDbId: number): Promise<VaultTally> =>
      api.get<VaultResponse>(`/segment-uploads/consignee/${consigneeDbId}/vault`,
        { params: { tally: 1, ...(custId ? { scope_customer_id: custId } : {}) } })
        .then(res => {
          const d = res.data?.data;
          return {
            total:    Number(d?.core_total_documents ?? d?.total_documents ?? 0),
            verified: Number(d?.core_verified_signed ?? d?.verified_signed ?? 0),
            catalog:         Number(d?.core_catalog_documents ?? d?.total_documents ?? 0),
            catalogVerified: Number(d?.core_catalog_verified ?? d?.verified_signed ?? 0),
          };
        });

    if (directId) {
      fetchVault(directId)
        .then(t => { if (!cancelled) setConsTally({ total: t.total, verified: t.verified, catalog: t.catalog, catalogVerified: t.catalogVerified }); })
        .catch(() => { if (!cancelled) setConsTally({ total: 0, verified: 0, error: true }); });
    } else {
      api.get('/consignees', { params: { customer_id: custId } })
        .then(async r => {
          if (cancelled) return;
          const rows: Array<{ db_id?: number }> = Array.isArray(r.data?.data) ? r.data.data : [];
          const ids = rows
            .map(x => x.db_id)
            .filter((x): x is number => typeof x === 'number');
          if (ids.length === 0) { setConsTally({ total: 0, verified: 0 }); return; }

          const settled = await Promise.all(ids.map(id => fetchVault(id).catch(() => null)));
          if (cancelled) return;
          const loaded = settled.filter((t): t is VaultTally => t !== null);
          if (loaded.length === 0) { setConsTally({ total: 0, verified: 0, error: true }); return; }

          setConsTally({
            total:           loaded.reduce((s, t) => s + t.total, 0),
            verified:        loaded.reduce((s, t) => s + t.verified, 0),
            catalog:         loaded.reduce((s, t) => s + t.catalog, 0),
            catalogVerified: loaded.reduce((s, t) => s + t.catalogVerified, 0),
          });
        })
        .catch(() => { if (!cancelled) setConsTally({ total: 0, verified: 0, error: true }); });
    }
    return () => { cancelled = true; };
  }, [serverHeader.consigneeId, serverHeader.customerId, consRefreshTick]);

  useEffect(() => {
    if (!resolvedLeadId) { setAgreementApplicable(null); return; }
    let cancelled = false;
    api.get(`/clm/leads/${resolvedLeadId}/agreement-applicable`, { params: { light: 1 } })
      .then(res => {
        if (cancelled) return;
        setAgreementApplicable((res.data?.data ?? null) as AgreementApplicablePayload | null);
      })
      .catch(() => { if (!cancelled) setAgreementApplicable(null); });
    return () => { cancelled = true; };
  }, [resolvedLeadId, custRefreshTick, consRefreshTick, agreementRefreshTick, stage]);

  const segDocTallies = useMemo(() => {
    const segs = agreementApplicable?.segments ?? [];
    const buyerEqualsConsignee = !!agreementApplicable?.buyerEqualsConsignee;
    const partyBucket = (party: string | null | undefined): 'buyer' | 'consignee' | 'both' => {
      const tokens = String(party ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const b = tokens.includes('buyer'), c = tokens.includes('consignee');
      if (b && c) return 'both';
      if (b) return 'buyer';
      if (c) return 'consignee';
      return 'both';
    };
    const agrSeen = new Map<string, boolean>();
    const tdSeen  = new Map<string, boolean>();
    const agrAny  = new Set<string>();
    const tdAny   = new Set<string>();
    for (const s of segs) {
      for (const a of s.agreements) {
        if (buyerEqualsConsignee && partyBucket(a.party) !== 'buyer') continue;
        const key  = a.id != null ? `id:${a.id}` : `code:${a.code ?? ''}|title:${a.title ?? ''}`;
        agrAny.add(key);
        if (a.needed !== true && !a.signature_request) continue;
        const done = a.signature_request?.status === 'completed';
        agrSeen.set(key, (agrSeen.get(key) ?? false) || done);
      }
      for (const td of s.trade_documents) {
        if (buyerEqualsConsignee && !td.for_buyer) continue;
        const key  = td.db_id != null ? `id:${td.db_id}` : `code:${td.doc_code}|ref:${td.reference}|name:${td.name}`;
        tdAny.add(key);
        if (td.needed !== true && !td.signature_request && td.status !== 'Verified') continue;
        const done = td.status === 'Verified' || td.signature_request?.status === 'completed';
        tdSeen.set(key, (tdSeen.get(key) ?? false) || done);
      }
    }
    const piDoc = agreementApplicable?.pi_document ?? null;
    if (piDoc) {
      const key = `pi:${piDoc.pi_id}`;
      tdAny.add(key);
      tdSeen.set(key, piDoc.signature_request?.status === 'completed');
    }

    const agrTotal = agrSeen.size;
    const agrDone  = Array.from(agrSeen.values()).filter(Boolean).length;
    const tdTotal  = tdSeen.size;
    const tdDone   = Array.from(tdSeen.values()).filter(Boolean).length;
    return { agrTotal, agrDone, tdTotal, tdDone, agrAny: agrAny.size, tdAny: tdAny.size };
  }, [agreementApplicable]);

  const isKeyOpportunity = !!serverHeader.keyOpportunity;
  const customerSegments = useMemo(() => {
    const raw = serverHeader.customerRow?.segment;
    return typeof raw === 'string'
      ? raw.split(',').map(s => s.trim()).filter(Boolean)
      : [];
  }, [serverHeader.customerRow]);
  const customerSegmentIds = useMemo<number[]>(() => {
    const ids = (serverHeader.customerRow as { segment_ids?: unknown } | null | undefined)?.segment_ids;
    return Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];
  }, [serverHeader.customerRow]);
  const customerOpts = useMemo<PickerOption[]>(() => {
    const lc = (serverHeader.lockedCurrency ?? '').trim().toUpperCase();
    const wantDomestic = lc === 'INR';
    const out: PickerOption[] = [];
    for (const r of Object.values(customerRows)) {
      if (!r.id) continue;
      const domestic = isIndiaCountry((r as { country?: string | null }).country);
      if (lc && wantDomestic !== domestic) continue;
      out.push({
        value: r.id,
        label: `${r.id} — ${r.company}`,
        badge: { text: domestic ? 'Domestic' : 'International', tone: domestic ? 'green' : 'violet' },
      });
    }
    return out;
  }, [customerRows, serverHeader.lockedCurrency]);

  const customerCountry = useMemo<string | null>(() => {
    const pa = serverHeader.customerRow?.primary_address as Record<string, unknown> | null | undefined;
    const c = pa?.country;
    return typeof c === 'string' && c.trim() ? c.trim() : null;
  }, [serverHeader.customerRow]);
  const isSigned = !!serverHeader.piSignedAt;
  const onLockedClick = useCallback(() => {
    toast.warning('PI is signed', 'You cannot edit anything — this opportunity is read-only.');
  }, [toast]);

  const isReadOnlyLead = !!serverHeader.readOnly;
  const onReadOnlyClick = useCallback(() => {
    toast.warning(
      'View only',
      'This opportunity has been reassigned to another user. You can still follow its history and progress, but not change it.',
    );
  }, [toast]);

  const writeLocked   = isSigned || isReadOnlyLead;
  const onWriteLocked = isReadOnlyLead ? onReadOnlyClick : onLockedClick;

  const isPiSent     = !!serverHeader.piSentForSignatureAt;
  const ownerLocked  = writeLocked || isPiSent;
  const onOwnerLocked = useCallback(() => {
    if (isReadOnlyLead) { onReadOnlyClick(); return; }
    if (isSigned)       { onLockedClick();   return; }
    toast.warning(
      'Owner is fixed',
      'The Proforma Invoice has been sent for signature, so this opportunity cannot be reassigned. Recall the PI first if the owner has to change.',
    );
  }, [isReadOnlyLead, isSigned, onReadOnlyClick, onLockedClick, toast]);

  const header: OppHeaderData = {
    ...seedHeader,
    oppDate:            serverHeader.oppDateIso
                          ? (fmtDmy(serverHeader.oppDateIso) || seedHeader.oppDate)
                          : seedHeader.oppDate,
    customer:           (serverHeader.customerRow?.company_name as string | undefined)?.trim()
                          || serverHeader.leadSenderCompany?.trim()
                          || serverHeader.leadSenderName?.trim()
                          || seedHeader.customer,
    country:            customerCountry || serverHeader.leadCountry?.trim() || seedHeader.country,
    leadId:             resolvedLeadId,
    leadStageId:        serverHeader.leadStageId,
    qualified:          serverHeader.qualified,
    disqualified:       serverHeader.disqualified,
    downstreamWork:     serverHeader.downstreamWork ?? [],
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

  useEffect(() => {
    const id = 'sm-detail-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const furthestStage = Math.max(stage, serverHeader.leadStageId ?? 0);

  const veilWheelRef = useCallback((veil: HTMLDivElement | null) => {
    if (!veil) return;
    const onWheel = (e: WheelEvent) => {
      veil.style.pointerEvents = 'none';
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      veil.style.pointerEvents = '';
      for (; el && el !== veil.parentElement; el = el.parentElement) {
        const s = getComputedStyle(el);
        const canY = /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
        const canX = /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
        if ((canY && e.deltaY) || (canX && e.deltaX)) {
          e.preventDefault();
          el.scrollBy(e.deltaX, e.deltaY);
          return;
        }
      }
    };
    veil.addEventListener('wheel', onWheel, { passive: false });
  }, []);

  const navStage = (n: StageNum) => navigate('sales.matrix_detail', { oppId, stage: n });

  const requireSalespersonForSourcing = (): boolean => {
    if ((serverHeader.salespersonName ?? '').trim()) return true;
    toast.error('Sales Person Name required', 'Assign a salesperson (Change Owner) before moving to Product Sourcing.');
    return false;
  };

  const openCustomerVault = (backTo: LeadVaultTarget | null = null) => {
    const row = (serverHeader.customerRow ?? {}) as Record<string, unknown>;
    setLeadVaultBackTo(backTo);
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
  };

  const requireQualifiedForSourcing = (): boolean => {
    if (serverHeader.qualified && !serverHeader.disqualified) return true;
    toast.error(
      serverHeader.disqualified ? 'Lead is disqualified' : 'Lead is not qualified yet',
      'Mark the lead Qualified in Lead Acknowledgement before sourcing products.',
    );
    return false;
  };

  const goToStage = (n: StageNum) => {
    if (n > furthestStage) return;
    if (n >= 3 && !requireQualifiedForSourcing()) return;
    if (n === 3 && !requireSalespersonForSourcing()) return;
    navStage(n);
  };

  const goPrev = () => stage > 1 && navStage((stage - 1) as StageNum);
  const goNext = () => {
    if (stage >= 6) return;
    if (stage === 2 && !requireQualifiedForSourcing()) return;
    if (stage === 2 && !requireSalespersonForSourcing()) return;
    if (stage === 5 && resolvedLeadId) {
      try { sessionStorage.setItem('cbc_celebrate_victory', String(resolvedLeadId)); } catch {  }
    }
    navStage((stage + 1) as StageNum);
  };

  const goBack = () => navigate('sales.lead_worksheet');

  const onCustomerClick = async () => {
    if (serverHeader.customerId && !serverHeader.customerRow) {
      setCustomerEditing({
        company: header.customer || '',
        id: header.customerCode || `C-${String(serverHeader.customerId).padStart(3, '0')}`,
        db_id: serverHeader.customerId,
      } as unknown as EditCustomer);
      setCustomerAddOpen(true);
      return;
    }
    if (serverHeader.customerId && serverHeader.customerRow) {
      const row = serverHeader.customerRow as unknown as Record<string, unknown>;
      setCustomerEditing({
        ...row,
        company: (row.company_name as string | undefined) || header.customer || '',
        id: (row.customer_code as string | undefined) || header.customerCode || `C-${String(serverHeader.customerId).padStart(3, '0')}`,
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
    const row = (serverHeader.customerRow ?? {}) as Record<string, unknown>;
    setManageConsigneesTarget({
      id:      (row.customer_code as string | undefined)
                 ?? `C-${String(serverHeader.customerId).padStart(3, '0')}`,
      db_id:   serverHeader.customerId,
      company: (row.company_name as string | undefined) ?? header.customer ?? '',
      country: (row.country as string | undefined) ?? header.country ?? undefined,
    });
  };

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
        if (!hasMapped) setLeadVaultTarget(targets[0]);
        setLeadVaultConsignees(targets.length > 1 ? targets : null);
      })
      .catch(() => setLeadVaultConsignees(null));
  };

  const StageComponent = (
    stage === 1 ? Stage1InquiryReceived :
    stage === 2 ? Stage2LeadAcknowledgement :
    stage === 3 ? Stage3ProductSourcing :
    stage === 4 ? Stage4PriceShared :
    stage === 5 ? Stage5QuotationVsPI :
                  Stage6VictoryStage
  );

  if (!leadIdResolved || (resolvedLeadId && !headerLoaded)) return <MatrixPageSkeleton />;

  return (
    <div className="smd-root">
      <style>{SALES_MATRIX_DETAIL_CSS}</style>

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

      <div className="smd-stepper-card">
        <div className="smd-stepper">
          {STAGES.map(s => {
            const state = s.n < stage ? 'done' : s.n === stage ? 'active' : 'idle';
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

        <div className="smd-stepper-divider" aria-hidden="true" />

        <div className="smd-toolbar">
        <ActionBtn icon={<IconUser />}     label="Customer" trailing="edit"          onClick={onCustomerClick} />
        <ActionBtn icon={<IconTruck />}    label="Consignees" trailing="edit"
          className={!serverHeader.customerId ? 'smd-act-disabled' : ''}          onClick={onConsigneeClick} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconPlusSq />}   label="Add Product"
          locked={writeLocked} onLocked={onWriteLocked}          onClick={() => setProductAddOpen(true)} />
        <ActionBtn icon={<IconBook />}     label="Product Directory"
          locked={isSigned} onLocked={onLockedClick}          onClick={() => setProductDirectoryOpen(true)} />
        <ActionBtn icon={<IconSourcing />} label="Product Sourcing"
          locked={writeLocked} onLocked={onWriteLocked}          onClick={() => setProductSourcingOpen(true)} />
        <ActionBtn icon={<IconDollar />}   label="Share Prices"
          locked={writeLocked} onLocked={onWriteLocked}          onClick={() => setPriceSharedOpen(true)} />
        <ActionBtn icon={<IconUserCog />}  label="Change Owner"
          locked={ownerLocked} onLocked={onOwnerLocked}         onClick={() => setChangeOwnerOpen(true)} />
        <ActionBtn icon={<IconMsg />}      label="Remark"
          locked={isReadOnlyLead} onLocked={onReadOnlyClick}          onClick={() => setRemarksOpen(true)} />
        <ActionBtn icon={<IconStar />}     label="Key Opportunity"
          locked={isReadOnlyLead} onLocked={onReadOnlyClick}
          className={isKeyOpportunity ? 'smd-act-key' : ''}          onClick={() => setKeyOppOpen(true)} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconBell />}     label="Reminder"          onClick={() => setRemindersOpen(true)} />
        <ActionBtn icon={<IconCalSmall />} label="Meetings"          onClick={() => setMeetingsOpen(true)} />
        </div>
      </div>

      <div
        className={`smd-body${clmCollapsed ? ' smd-body-clm-collapsed' : ''}${dealCollapsed ? ' smd-body-deal-collapsed' : ''}`}
      >
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
                  openCustomerVault();
                }}
              />
            )}
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
            {!serverHeader.customerId && (
              <div className="smd-clm-empty">
                Map a customer from the toolbar above to track its KYC + Trade documents here.
              </div>
            )}
          </div>

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

            {agreementApplicable?.pi ? (
              <>
                <ClmRow
                  icon={<IconShieldSm />}
                  tone="emerald"
                  title="Trade Documents"
                  sub={segDocTallies.tdTotal < 1
                    ? (segDocTallies.tdAny > 0 ? 'None marked necessary' : 'No trade documents')
                    : `${segDocTallies.tdDone} of ${segDocTallies.tdTotal} uploaded`}
                  progress={segDocTallies.tdTotal > 0
                    ? Math.round((segDocTallies.tdDone / segDocTallies.tdTotal) * 100)
                    : 0}
                  onClick={() => {
                    if (segDocTallies.tdAny < 1) {
                      toast.warning('No trade documents', 'No product on this PI maps to a segment with trade documents.');
                      return;
                    }
                    setAgreementModalView('trade'); setAgreementModalOpen(true);
                  }}
                />
                <ClmRow
                  icon={<IconShieldSm />}
                  tone="rose"
                  title="Agreements"
                  sub={segDocTallies.agrTotal < 1
                    ? (segDocTallies.agrAny > 0 ? 'None marked necessary' : 'No agreements')
                    : `${segDocTallies.agrDone} of ${segDocTallies.agrTotal} signed`}
                  progress={segDocTallies.agrTotal > 0
                    ? Math.round((segDocTallies.agrDone / segDocTallies.agrTotal) * 100)
                    : 0}
                  onClick={() => {
                    if (segDocTallies.agrAny < 1) {
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

        <section className={`smd-stage-card${(isSigned && stage <= 2) ? ' smd-stage-card-locked' : ''}`}>
          {isSigned && stage <= 2 && (
            <div
              className="smd-stage-veil"
              onClick={onLockedClick}
              ref={veilWheelRef}
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
            canEnterNextStage={() => (stage === 2 ? requireSalespersonForSourcing() : true)}
            reloadLead={reloadLead}
            refreshTick={productsTick}
            onProductsChanged={() => setProductsTick(t => t + 1)}
            priceRefreshTick={priceTick}
            onPricesChanged={() => setPriceTick(t => t + 1)}
            locked={isSigned && stage <= 5}
            piDocGate={
              !custTally          ? 'ok'
              : custTally.loading ? 'checking'
              : custTally.error   ? 'error'
              : custTally.total > 0 && custTally.verified < custTally.total
                                  ? 'incomplete'
              :                     'ok'
            }
            onPiChange={() => setAgreementRefreshTick(t => t + 1)}
          />
          </div>
        </section>

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
              setServerHeader(prev => ({ ...prev, taskManager: row }));
            }}
          />
        </aside>
        )}
      </div>

      <EntityPickerModal
        open={customerPickerOpen}
        title="Customer"
        subtitle={
          !serverHeader.lockedCurrency
            ? 'Pick an existing customer to edit, or click + to register a new one'
            : (serverHeader.lockedCurrency.toUpperCase() === 'INR'
                ? 'This opportunity is in INR (domestic) — showing Indian customers only.'
                : `This opportunity is in ${serverHeader.lockedCurrency} (export) — showing customers outside India only.`)
        }
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
          const dbId = (row as EditCustomer & { db_id?: number }).db_id;
          const alreadyLinked = !!serverHeader.customerId && serverHeader.customerId !== dbId;
          if (alreadyLinked) {
            toast.error(
              'Customer already linked',
              'This opportunity is already mapped to a customer. Open it from the Customer button to edit it.',
            );
            return;
          }
          if (resolvedLeadId && dbId && !serverHeader.customerId) {
            try {
              await api.put(`/sales/leads/${resolvedLeadId}`, { customer_id: dbId });
              toast.success('Customer mapped', `Linked to this opportunity`);
              await reloadLead();
            } catch (e: any) {
              toast.error('Mapping failed', e?.response?.data?.message ?? 'Could not link this customer to the lead');
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
        leadCurrency={serverHeader.lockedCurrency}
        onClose={() => { setCustomerAddOpen(false); setCustomerEditing(null); setClmInitialStage(undefined); }}
        onSaved={(savedId) => {
          setCustomerRows({});
          setCustomerAddOpen(false); setCustomerEditing(null); setClmInitialStage(undefined);
          setCustRefreshTick(t => t + 1);
          setConsRefreshTick(t => t + 1);
          void (async () => {
            if (savedId && resolvedLeadId && savedId !== serverHeader.customerId) {
              try {
                await api.put(`/sales/leads/${resolvedLeadId}`, { customer_id: savedId });
                toast.success('Customer mapped', 'Linked to this opportunity');
              } catch (e: any) {
                toast.error('Mapping failed', e?.response?.data?.message ?? 'Could not link this customer to the lead');
              }
            }
            await reloadLead();
          })();
        }}
      />

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

      <ProductDirectoryModal
        open={productDirectoryOpen}
        leadId={resolvedLeadId ?? null}
        leadStage={furthestStage}
        customerSegments={customerSegments}
        customerSegmentIds={customerSegmentIds}
        customerCountry={customerCountry}
        readOnly={isReadOnlyLead}
        onClose={() => setProductDirectoryOpen(false)}
        onChanged={() => setProductsTick(t => t + 1)}
        onAddProduct={() => {
          setProductDirectoryOpen(false);
          setProductAddOpen(true);
        }}
      />

      <StageEmbedModal open={productSourcingOpen} onClose={() => setProductSourcingOpen(false)}>
        <Stage3ProductSourcing
          header={header}
          stage={3}
          onPrev={() => {}}
          onNext={() => {}}
          reloadLead={reloadLead}
          refreshTick={productsTick}
          onProductsChanged={() => setProductsTick(t => t + 1)}
          embedded
        />
      </StageEmbedModal>

      <StageEmbedModal open={priceSharedOpen} onClose={() => setPriceSharedOpen(false)}>
        <Stage4PriceShared
          header={header}
          stage={4}
          onPrev={() => {}}
          onNext={() => {}}
          reloadLead={reloadLead}
          priceRefreshTick={priceTick}
          onPricesChanged={() => setPriceTick(t => t + 1)}
          embedded
        />
      </StageEmbedModal>

      <ChangeOwnerModal
        open={changeOwnerOpen}
        currentOwner={serverHeader.salespersonName || 'Unassigned'}
        owners={ownerOpts.filter(o => Number(o.value) !== Number(serverHeader.salespersonId ?? -1))}
        onClose={() => setChangeOwnerOpen(false)}
        onUpdate={async (opt) => {
          if (!resolvedLeadId) return;
          try {
            await api.put(`/sales/leads/${resolvedLeadId}`, { salesperson_id: Number(opt.value) });
            await reloadLead();
            toast.success('Owner updated', `Reassigned to ${opt.label}`);
          } catch (e: any) {
            toast.error('Update failed', e?.response?.data?.message ?? 'Could not reassign the lead');
            throw e;
          }
        }}
      />

      <RemarksModal
        open={remarksOpen}
        currentRemark={serverHeader.remark ?? ''}
        onClose={() => setRemarksOpen(false)}
        onSave={async (text) => {
          if (!resolvedLeadId) return;
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

      <WhatsAppStatusModal
        open={whatsappOpen}
        leadId={resolvedLeadId ?? null}
        currentStatus={serverHeader.whatsappStatus ?? null}
        currentReason={serverHeader.whatsappReason ?? null}
        currentScreenshot={serverHeader.whatsappScreenshot ?? null}
        onClose={() => setWhatsappOpen(false)}
        onSaved={() => { setWhatsappOpen(false); void reloadLead(); }}
      />

      <RemindersListModal
        open={remindersOpen}
        oppId={header.oppId}
        oppDate={header.oppDate}
        onClose={() => setRemindersOpen(false)}
      />

      <MeetingsListModal
        open={meetingsOpen}
        oppId={header.oppId}
        oppDate={header.oppDate}
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
          const addr = (row?.primary_address ?? row?.primaryAddress) as Record<string, unknown> | null | undefined;
          return (addr?.cp_contact as string | undefined) ?? undefined;
        })()}
        onClose={() => setMeetingsOpen(false)}
      />

      <LeadAgreementSendModal
        open={agreementModalOpen}
        leadId={resolvedLeadId}
        view={agreementModalView}
        data={agreementApplicable}
        onClose={() => {
          setAgreementModalOpen(false);
          setAgreementRefreshTick(t => t + 1);
        }}
        onSent={() => setAgreementRefreshTick(t => t + 1)}
      />

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

      <LeadEvidenceVaultModal
        open={!!leadVaultTarget}
        target={leadVaultTarget}
        consignees={leadVaultConsignees}
        mappedConsigneeId={serverHeader.consigneeId}
        scopeCustomerId={serverHeader.customerId}
        onOpenCustomer={serverHeader.customerId
          ? () => openCustomerVault(leadVaultTarget)
          : undefined}
        onBack={leadVaultBackTo
          ? () => { setLeadVaultTarget(leadVaultBackTo); setLeadVaultBackTo(null); }
          : undefined}
        backLabel={leadVaultBackTo
          ? `${leadVaultBackTo.id}${leadVaultBackTo.company ? ` ${leadVaultBackTo.company}` : ''}`
          : undefined}
        onClose={() => {
          setCustRefreshTick(t => t + 1);
          setConsRefreshTick(t => t + 1);
          setLeadVaultTarget(null);
          setLeadVaultConsignees(null);
          setLeadVaultBackTo(null);
        }}
      />
    </div>
  );
}


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

type ClmTallyState = { total: number; verified: number; catalog?: number; catalogVerified?: number; error?: boolean; loading?: boolean } | null;
function renderClmSub(t: ClmTallyState): string {
  if (t == null || t.loading) return 'Loading documents…';
  if (t.error)                return 'Couldn’t load — tap to retry';
  if (t.total > 0)            return `${t.verified} of ${t.total} documents`;
  if (t.catalog && t.catalog > 0) return `${t.catalogVerified ?? 0} of ${t.catalog} documents`;
  return 'No segment rules set';
}
function renderClmProgress(t: ClmTallyState): number {
  if (t == null || t.loading || t.error) return 0;
  if (t.total > 0) return Math.min(100, Math.round((t.verified / t.total) * 100));
  if (t.catalog && t.catalog > 0) return Math.min(100, Math.round(((t.catalogVerified ?? 0) / t.catalog) * 100));
  return 0;
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
