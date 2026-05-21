import { useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateContext } from '../../../components/App';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import EntityPickerModal, { type PickerOption } from '../EntityPickerModal';
import AddCustomerModal, { type EditCustomer } from '../AddCustomerModal';
import AddConsigneeModal from '../AddConsigneeModal';
import AddProductModal from '../../products/AddProductModal';
import ProductDirectoryModal from './ProductDirectoryModal';
import { SALES_MATRIX_DETAIL_CSS } from './salesMatrixDetail.styles';
import Stage1InquiryReceived     from './stages/Stage1InquiryReceived';
import Stage2LeadAcknowledgement from './stages/Stage2LeadAcknowledgement';
import Stage3ProductSourcing     from './stages/Stage3ProductSourcing';
import Stage4PriceShared         from './stages/Stage4PriceShared';
import Stage5QuotationVsPI       from './stages/Stage5QuotationVsPI';
import Stage6VictoryStage        from './stages/Stage6VictoryStage';

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
  { n: 3, title: 'Product Sourcing',     sub: 'Product/vendor sourcing' },
  { n: 4, title: 'Price Shared',         sub: 'Price shared with customer' },
  { n: 5, title: 'Quotation vs PI',      sub: 'Quotation/PI comparison' },
  { n: 6, title: 'Victory Stage',        sub: 'Deal successfully won' },
];

export type OppHeaderData = {
  oppId: string;
  customer: string;
  customerCode: string;
  oppDate: string;
  country: string;
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
    if (consigneeOpts.length > 0) return;
    setConsigneeLoading(true);
    try {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const res = await api.get<{ data?: any[] } | any[]>('/consignees');
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

  // Header data — pulled from row state if present, falls back to default sample.
  const header: OppHeaderData = useMemo(() => {
    const fromState = (location.state as any)?.row;
    if (fromState) {
      return {
        oppId:        fromState.oppId        || oppId,
        customer:     fromState.customer     || DEFAULT_HEADER.customer,
        customerCode: fromState.customerCode || `C-${oppId.replace(/^OPP-/, '')}`,
        oppDate:      fromState.date         || DEFAULT_HEADER.oppDate,
        country:      fromState.country      || DEFAULT_HEADER.country,
      };
    }
    return { ...DEFAULT_HEADER, oppId };
  }, [location.state, oppId]);

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
        <div className="smd-cust-left">
          <div className="smd-cust-avatar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="smd-cust-avatar-dot" />
          </div>
          <div>
            <div className="smd-cust-name">{header.customer}</div>
            <div className="smd-cust-tag">● CUSTOMER</div>
          </div>
        </div>
        <div className="smd-cust-meta">
          <Meta icon={<IconBriefcase />} label="CUSTOMER CODE"   value={header.customerCode} />
          <span className="smd-cust-sep" />
          <Meta icon={<IconListLines />} label="OPPORTUNITY ID"   value={header.oppId} />
          <span className="smd-cust-sep" />
          <Meta icon={<IconCalendar />}  label="OPPORTUNITY DATE" value={header.oppDate} />
          <span className="smd-cust-sep" />
          <Meta icon={<IconGlobe />}     label="COUNTRY"          value={header.country} />
        </div>
        <button className="smd-back-btn" onClick={goBack}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to My Workplace
        </button>
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
                  <span className="smd-step-num">STEP 0{s.n}</span>
                  {state === 'active' && <span className="smd-step-badge smd-step-badge-active">● ACTIVE</span>}
                  {state === 'done'   && <span className="smd-step-badge smd-step-badge-done">✓ DONE</span>}
                </div>
                <div className="smd-step-big">0{s.n}</div>
                <div className="smd-step-title">{s.title}</div>
                <div className="smd-step-sub">{s.sub}</div>
                <span className="smd-step-ghost">0{s.n}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Action Toolbar (separate white card) ─── */}
      <div className="smd-toolbar">
        <ActionBtn icon={<IconUser />}     label="Customer"       trailing="edit"
          onClick={() => { void fetchCustomers(); setCustomerPickerOpen(true); }} />
        <ActionBtn icon={<IconTruck />}    label="Consignee"      trailing="edit"
          onClick={() => { void fetchConsignees(); setConsigneePickerOpen(true); }} />
        <ActionBtn icon={<IconPlusSq />}   label="Add Product"
          onClick={() => setProductAddOpen(true)} />
        <ActionBtn icon={<IconBook />}     label="Product Directory"
          onClick={() => setProductDirectoryOpen(true)} />
        <ActionBtn icon={<IconUserCog />}  label="Change Owner" />
        <ActionBtn icon={<IconMsg />}      label="Remark" />
        <ActionBtn icon={<IconStar />}     label="Key Opportunity" />
        <ActionBtn icon={<IconBell />}     label="Reminder" />
        <ActionBtn icon={<IconCalSmall />} label="Meetings" />
        <ActionBtn icon={<IconDollar />}   label="Share Prices" />
        <ActionBtn icon={<IconWhats />}    label="WhatsApp Status" className="smd-act-wa" />
      </div>

      {/* ─── Three-column body ─── */}
      <div className="smd-body">
        {/* Left — CLM Details */}
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
            <button className="smd-clm-collapse" aria-label="Collapse">
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

        {/* Middle — stage-specific content */}
        <section className="smd-stage-card">
          <StageComponent
            header={header}
            stage={stage}
            onPrev={goPrev}
            onNext={goNext}
          />
        </section>

        {/* Right — Deal Execution & Decision Engine */}
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
            <button className="smd-clm-collapse" aria-label="Expand">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="smd-deal-tabs">
            <button className="smd-deal-tab smd-deal-tab-active">✓ Task Manager</button>
            <button className="smd-deal-tab" disabled>
              ⚡ Chanakya
              <span className="smd-deal-tab-soon">SOON</span>
            </button>
            <button className="smd-deal-tab" disabled>
              ◎ Sarthi
              <span className="smd-deal-tab-soon">SOON</span>
            </button>
            <button className="smd-deal-tab" disabled>
              ◆ Chat View
              <span className="smd-deal-tab-soon">SOON</span>
            </button>
          </div>

          {/* Task Manager form */}
          <div className="smd-deal-form">
            <div className="smd-deal-row">
              <Field label="SALES PERSON NAME">
                <input className="smd-input" defaultValue="Shreeyash Rajaram Mote" />
              </Field>
              <Field label="CHOOSE FILE">
                <button type="button" className="smd-input smd-input-file">📎 Attach File</button>
              </Field>
            </div>
            <div className="smd-deal-row">
              <Field label="BUYING PLAN">
                <input className="smd-input" type="date" />
              </Field>
              <Field label="ORDER VALUE">
                <input className="smd-input" placeholder="Enter order value" />
              </Field>
            </div>

            <div className="smd-deal-section-label">PURCHASE DECISION MAKER</div>

            <div className="smd-deal-row">
              <Field label={<>NAME <span className="smd-req">*</span></>}>
                <input className="smd-input" placeholder="Enter name" />
              </Field>
              <Field label={<>MOBILE NUMBER <span className="smd-req">*</span></>}>
                <input className="smd-input" placeholder="Enter mobile" />
              </Field>
            </div>
            <div className="smd-deal-row">
              <Field label={<>EMAIL <span className="smd-req">*</span></>}>
                <input className="smd-input" placeholder="Enter email address" />
              </Field>
            </div>

            <div className="smd-deal-save-wrap">
              <button className="smd-deal-save-btn">Save</button>
            </div>
          </div>
        </aside>
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
        onEdit={(opt) => {
          setCustomerPickerOpen(false);
          const row = customerRows[opt.value];
          if (row) { setCustomerEditing(row); setCustomerAddOpen(true); }
          else toast.error('Customer missing', 'Could not load the picked customer');
        }}
      />
      <AddCustomerModal
        open={customerAddOpen}
        customer={customerEditing}
        onClose={() => { setCustomerAddOpen(false); setCustomerEditing(null); }}
        onSaved={() => {
          setCustomerOpts([]); setCustomerRows({});
          setCustomerAddOpen(false); setCustomerEditing(null);
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
        onEdit={(opt) => {
          setConsigneePickerOpen(false);
          const row = consigneeRows[opt.value];
          if (row) { setConsigneeEditing(row); setConsigneeAddOpen(true); }
          else toast.error('Consignee missing', 'Could not load the picked consignee');
        }}
      />
      <AddConsigneeModal
        open={consigneeAddOpen}
        consignee={consigneeEditing}
        onClose={() => { setConsigneeAddOpen(false); setConsigneeEditing(null); }}
        onSaved={() => {
          setConsigneeOpts([]); setConsigneeRows({});
          setConsigneeAddOpen(false); setConsigneeEditing(null);
        }}
      />

      {/* ── Add Product modal ── */}
      {productAddOpen && (
        <AddProductModal
          productId={null}
          onClose={() => setProductAddOpen(false)}
          onSaved={(_pid, finalised) => { if (finalised) setProductAddOpen(false); }}
        />
      )}

      {/* ── Product Directory popup (mapped-products table) ── */}
      <ProductDirectoryModal
        open={productDirectoryOpen}
        onClose={() => setProductDirectoryOpen(false)}
        onMapProduct={() => {
          /* "Map Product" inside the directory chains into the
             same Add Product wizard the toolbar pill opens. */
          setProductDirectoryOpen(false);
          setProductAddOpen(true);
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

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="smd-field">
      <label className="smd-field-label">{label}</label>
      {children}
    </div>
  );
}

/* ─── Inline icon set (keeps wrapper self-contained) ─── */

const IconBriefcase = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);
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
