import { useCallback, useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateContext } from '../../../components/App';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import EntityPickerModal, { type PickerOption } from '../EntityPickerModal';
import AddCustomerModal, { type EditCustomer } from '../AddCustomerModal';
import AddConsigneeModal from '../AddConsigneeModal';
import AddProductModal from '../../products/AddProductModal';
import ProductDirectoryModal from './ProductDirectoryModal';
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
  { n: 4, title: 'Price Shared',         sub: 'Price shared with customer' },
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

  const [consigneePickerOpen, setConsigneePickerOpen] = useState(false);
  const [consigneeOpts, setConsigneeOpts] = useState<PickerOption[]>([]);
  const [consigneeLoading, setConsigneeLoading] = useState(false);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [consigneeRows, setConsigneeRows] = useState<Record<string, any>>({});
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [consigneeEditing, setConsigneeEditing] = useState<any | null>(null);
  const [consigneeAddOpen, setConsigneeAddOpen] = useState(false);

  const [productAddOpen, setProductAddOpen] = useState(false);
  const [productDirectoryOpen, setProductDirectoryOpen] = useState(false);
  const [changeOwnerOpen, setChangeOwnerOpen] = useState(false);
  const [remarksOpen, setRemarksOpen] = useState(false);
  const [keyOppOpen, setKeyOppOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [ownerOpts, setOwnerOpts] = useState<Array<{ value: string; label: string }>>([]);

  /* Side-rail collapsing — clicking the chevron in either side card collapses
   * it to a thin vertical rail so the stage form gets more breathing room.
   * Clicking the rail (or its expand chevron) restores the full card. */
  const [clmCollapsed, setClmCollapsed] = useState(false);
  const [dealCollapsed, setDealCollapsed] = useState(false);

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
    if (customerOpts.length > 0) return;
    setCustomerLoading(true);
    try {
      type Row = EditCustomer & { db_id?: number };
      const res = await api.get<{ data?: Row[] } | Row[]>('/customers');
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

  const fetchConsignees = async () => {
    // Always refetch — the picker is scoped by the lead's mapped
    // customer, so a session cache from one lead would leak rows to
    // the next.
    setConsigneeLoading(true);
    try {
      // Scope the picker to this lead's mapped customer when one
      // exists so the dropdown only shows relevant rows. The /consignees
      // index accepts ?customer_id=N for the same filter the legacy
      // ConsigneeDirectory used.
      const params: Record<string, unknown> = {};
      if (serverHeader.customerId) params.customer_id = serverHeader.customerId;

      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const res = await api.get<{ data?: any[] } | any[]>('/consignees', { params });
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const rows: any[] = Array.isArray(res.data) ? res.data : ((res.data as { data?: any[] })?.data ?? []);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const cache: Record<string, any> = {};
      const opts: PickerOption[] = [];
      rows.forEach(r => {
        const pid = String(r.id ?? r.public_id ?? '');
        if (!pid) return;
        cache[pid] = r;
        opts.push({ value: pid, label: `${pid} — ${r.consignee ?? r.company ?? r.name ?? '—'}` });
      });
      setConsigneeRows(cache);
      setConsigneeOpts(opts);
    } catch {
      toast.error('Failed to load consignees', 'Could not reach the Consignee API');
    } finally {
      setConsigneeLoading(false);
    }
  };

  const oppId = params.oppId || DEFAULT_HEADER.oppId;
  const stage = Math.min(6, Math.max(1, parseInt(params.stage || '1', 10))) as StageNum;

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
      task_manager: StageTaskManager | null;
      acknowledgements: StageAcknowledgement[];
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
          whatsappScreenshot:  d.whatsapp_screenshot,
        });
      })
      .catch(() => toast.error('Load failed', 'Could not load this lead'));
  }, [resolvedLeadId, toast]);

  useEffect(() => { reloadLead(); }, [reloadLead]);

  /* "Marked as key" is sourced live from the server (leads.key_opportunity)
   * so it survives navigation / refresh. Toggling fires a PUT and the
   * follow-up reloadLead() refreshes the toolbar from authoritative
   * server state instead of optimistic-toggling. */
  const isKeyOpportunity = !!serverHeader.keyOpportunity;

  const header: OppHeaderData = {
    ...seedHeader,
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

  // Stage tracker click → navigate to the same opportunity at a new stage.
  const goToStage = (n: StageNum) => navigate('sales.matrix_detail', { oppId, stage: n });

  // Save & Next  /  Previous helpers
  const goPrev = () => stage > 1 && goToStage((stage - 1) as StageNum);
  const goNext = () => stage < 6 && goToStage((stage + 1) as StageNum);

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
  const onConsigneeClick = async () => {
    if (!serverHeader.customerId) {
      toast.warning('Customer required first', 'Pick or add a customer before mapping a consignee');
      return;
    }
    if (serverHeader.consigneeId && serverHeader.consigneeRow) {
      // The eager-loaded consignee row is the raw Eloquent shape
      // (snake_case keys, numeric ids). AddConsigneeModal expects the
      // /consignees-index shape with camelCase fields + `db_id` + a
      // string `customerId` matching the customer's display code.
      // Re-key here so the modal's lookups (linked customer, doc fetch)
      // all hit. Falls back to a computed customer_code when the
      // server didn't surface it.
      const raw = serverHeader.consigneeRow as Record<string, unknown>;
      const customerCode =
        (serverHeader.customerRow as Record<string, unknown> | null | undefined)?.customer_code as string | undefined
        ?? (serverHeader.customerId ? `C-${String(serverHeader.customerId).padStart(3, '0')}` : undefined);
      const consigneeCode =
        (raw.consignee_code as string | undefined)
        ?? (typeof raw.id === 'number' ? `CN-${String(raw.id).padStart(3, '0')}` : '');
      // Cast through unknown because the modal's ConsigneeRow type is
      // strict and we're hydrating from a different shape; the modal
      // only consumes db_id + customerId + a few labels for the bar.
      setConsigneeEditing({
        id:             consigneeCode,
        db_id:          serverHeader.consigneeId,
        customerId:     customerCode ?? '',
        customer_db_id: serverHeader.customerId ?? undefined,
        initials:       String(raw.company_name ?? '?').slice(0, 2).toUpperCase(),
        name:           (raw.company_name as string | undefined) ?? '',
        legalName:      (raw.legal_name   as string | undefined) ?? '',
        segment:        (raw.segment      as string | undefined) ?? '',
        type:           (raw.type         as string | undefined) ?? '',
        classification: (raw.classification as string | undefined) ?? '',
      } as unknown as Parameters<typeof setConsigneeEditing>[0]);
      setConsigneeAddOpen(true);
      return;
    }
    await fetchConsignees();
    setConsigneePickerOpen(true);
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
            <div className="smd-cust-name">{header.customer}</div>
            <span className="smd-cust-tag">
              <span className="smd-cust-tag-dot" />
              <span className="smd-cust-tag-text">Customer</span>
            </span>
          </div>
        </div>
        <div className="smd-cust-meta">
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
            return (
              <div
                key={s.n}
                className={`smd-step smd-step-${state}`}
                onClick={() => goToStage(s.n)}
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
        <ActionBtn icon={<IconUser />}     label="Customer" trailing="edit"
          onClick={onCustomerClick} />
        <ActionBtn icon={<IconTruck />}    label="Consignee" trailing="edit"
          className={!serverHeader.customerId ? 'smd-act-disabled' : ''}
          onClick={onConsigneeClick} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconPlusSq />}   label="Add Product"
          onClick={() => setProductAddOpen(true)} />
        <ActionBtn icon={<IconBook />}     label="Product Directory"
          onClick={() => setProductDirectoryOpen(true)} />
        <ActionBtn icon={<IconUserCog />}  label="Change Owner"
          onClick={() => setChangeOwnerOpen(true)} />
        <ActionBtn icon={<IconMsg />}      label="Remark"
          onClick={() => setRemarksOpen(true)} />
        <span className="smd-act-sep" aria-hidden="true" />
        <ActionBtn icon={<IconStar />}     label="Key Opportunity"
          className={isKeyOpportunity ? 'smd-act-key' : ''}
          onClick={() => setKeyOppOpen(true)} />
        <ActionBtn icon={<IconBell />}     label="Reminder"
          onClick={() => setRemindersOpen(true)} />
        <ActionBtn icon={<IconCalSmall />} label="Meetings"
          onClick={() => setMeetingsOpen(true)} />
        <ActionBtn icon={<IconDollar />}   label="Share Prices"
          onClick={() => toast.info('Coming next', 'Share Prices flow ships in the Stage 4 (Price Shared) build')} />
        <ActionBtn icon={<IconWhats />}    label="WhatsApp Status"
          className={`smd-act-wa ${serverHeader.whatsappStatus === 'connected' ? 'smd-act-wa-on' : ''}`}
          onClick={() => setWhatsappOpen(true)} />
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
                <div className="smd-clm-sub">● Active</div>
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
                <div className="smd-clm-group-title">KYC / DD / Trade Documents</div>
                <div className="smd-clm-group-sub">View customer and consignee information</div>
              </div>
            </div>

            <ClmRow
              icon={<IconUserSm />}
              tone="amber"
              title="Customer Details"
              sub="8 of 12 documents"
              progress={67}
            />
            <ClmRow
              icon={<IconTruckSm />}
              tone="emerald"
              title="Consignee Details"
              sub="6 of 12 documents"
              progress={50}
            />
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
                <div className="smd-clm-group-title">Segment Details</div>
                <div className="smd-clm-group-sub">View consignee information</div>
              </div>
            </div>

            <ClmRow
              icon={<IconShieldSm />}
              tone="rose"
              title="Highly Regulated Segments"
              sub="3 of 6 segments"
              progress={50}
            />
            <ClmRow
              icon={<IconShieldSm />}
              tone="orange"
              title="Less Regulated Segments"
              sub="7 of 10 segments"
              progress={70}
            />
          </div>
        </aside>
        )}

        {/* Middle — stage-specific content */}
        <section className="smd-stage-card">
          <StageComponent
            header={header}
            stage={stage}
            onPrev={goPrev}
            onNext={goNext}
            reloadLead={reloadLead}
          />
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
                <div className="smd-deal-sub">● Control execution and track deal progress.</div>
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
            } catch {
              toast.error('Mapping failed', 'Could not link this customer to the lead');
            }
          }
          setCustomerEditing(row);
          setCustomerAddOpen(true);
        }}
      />
      <AddCustomerModal
        open={customerAddOpen}
        customer={customerEditing}
        onClose={() => { setCustomerAddOpen(false); setCustomerEditing(null); }}
        onSaved={() => {
          setCustomerOpts([]); setCustomerRows({});
          setCustomerAddOpen(false); setCustomerEditing(null);
          void reloadLead();
        }}
      />

      {/* ── Consignee picker + edit/create modal ── */}
      <EntityPickerModal
        open={consigneePickerOpen}
        title="Consignee"
        subtitle="Pick an existing consignee to edit, or click + to register a new one"
        fieldLabel="Select Consignee"
        placeholder="Choose a consignee"
        emptyHint="No consignees yet — click + to add the first"
        addLabel="Add new consignee"
        options={consigneeOpts}
        loading={consigneeLoading}
        onClose={() => setConsigneePickerOpen(false)}
        onAdd={() => {
          setConsigneePickerOpen(false);
          setConsigneeEditing(null);
          setConsigneeAddOpen(true);
        }}
        onEdit={async (opt) => {
          setConsigneePickerOpen(false);
          const row = consigneeRows[opt.value];
          if (!row) {
            toast.error('Consignee missing', 'Could not load the picked consignee');
            return;
          }
          const dbId = (row as { db_id?: number; id?: number }).db_id ?? (row as { id?: number }).id;
          if (resolvedLeadId && dbId) {
            try {
              await api.put(`/sales/leads/${resolvedLeadId}`, { consignee_id: dbId });
              toast.success('Consignee mapped', 'Linked to this opportunity');
              await reloadLead();
            } catch {
              toast.error('Mapping failed', 'Could not link this consignee to the lead');
            }
          }
          setConsigneeEditing(row); setConsigneeAddOpen(true);
        }}
      />
      <AddConsigneeModal
        open={consigneeAddOpen}
        consignee={consigneeEditing}
        /* When the lead already has a mapped customer, pre-select it so
         * the Add Consignee picker is skipped (and disabled). We pass
         * BOTH the display code (customer_code, e.g. C-001) and the
         * numeric DB id — the modal tries them in that order against
         * its loaded /customers list. The db_id fallback covers cases
         * where the eager-loaded customer is missing customer_code or
         * the field is stored in a non-default format. */
        preselectedCustomerId={
          !consigneeEditing && serverHeader.customerRow
            ? (((serverHeader.customerRow as Record<string, unknown>).customer_code as string | undefined) ?? undefined)
            : undefined
        }
        preselectedCustomerDbId={
          !consigneeEditing ? (serverHeader.customerId ?? undefined) : undefined
        }
        onClose={() => { setConsigneeAddOpen(false); setConsigneeEditing(null); }}
        onSaved={() => {
          setConsigneeOpts([]); setConsigneeRows({});
          setConsigneeAddOpen(false); setConsigneeEditing(null);
          void reloadLead();
        }}
      />

      {/* ── Add Product modal ──
          When a brand-new product master is finalised we auto-map it
          to this lead so the user doesn't have to repeat the pick step
          inside the Product Directory. Errors are silent — if the auto-
          map fails (e.g. duplicate), the user can still map manually. */}
      {productAddOpen && (
        <AddProductModal
          productId={null}
          onClose={() => setProductAddOpen(false)}
          onSaved={async (pid, finalised) => {
            if (!finalised) return;
            setProductAddOpen(false);
            if (resolvedLeadId && pid) {
              try {
                await api.post(`/sales/leads/${resolvedLeadId}/products`, { product_id: pid });
                toast.success('Mapped', 'New product mapped to this opportunity');
                setProductDirectoryOpen(true);
              } catch {
                /* silent — the user can map manually from the Directory */
              }
            }
          }}
        />
      )}

      {/* ── Product Directory popup (mapped-products table) ── */}
      <ProductDirectoryModal
        open={productDirectoryOpen}
        leadId={resolvedLeadId ?? null}
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
         * primary email so the user doesn't have to retype them. */
        defaultCustomer={
          (serverHeader.customerRow as Record<string, unknown> | null | undefined)?.company_name as string | undefined
          ?? header.customer
        }
        defaultEmail={
          (serverHeader.customerRow as Record<string, unknown> | null | undefined)?.primary_email as string | undefined
          ?? undefined
        }
        onClose={() => setMeetingsOpen(false)}
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

function ActionBtn({ icon, label, trailing, className, onClick }: {
  icon: React.ReactNode; label: string; trailing?: 'edit'; className?: string; onClick?: () => void;
}) {
  return (
    <button className={`smd-act ${className || ''}`} onClick={onClick} type="button">
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

function ClmRow({ icon, tone, title, sub, progress }: {
  icon: React.ReactNode; tone: 'amber'|'emerald'|'rose'|'orange';
  title: string; sub: string; progress: number;
}) {
  return (
    <div className="smd-clm-row">
      <div className="smd-clm-row-head">
        <div className={`smd-clm-row-icon smd-clm-row-icon-${tone}`}>{icon}</div>
        <div className="smd-clm-row-text">
          <div className="smd-clm-row-title">{title}</div>
          <div className="smd-clm-row-sub">{sub}</div>
        </div>
        <button className="smd-clm-row-go" aria-label="Open">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
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
const IconUserCog  = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="11" r="2"/></svg>);
const IconMsg      = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);
const IconStar     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2"/></svg>);
const IconBell     = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>);
const IconCalSmall = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>);
const IconDollar   = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>);
const IconWhats    = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>);

const IconUserSm   = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconTruckSm  = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/></svg>);
const IconShieldSm = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);
