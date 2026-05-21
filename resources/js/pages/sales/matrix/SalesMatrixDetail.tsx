import { useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateContext } from '../../../components/App';
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
      <style>{SCOPED_CSS}</style>

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
        <ActionBtn icon={<IconUser />}     label="Customer"       trailing="edit" />
        <ActionBtn icon={<IconTruck />}    label="Consignee"      trailing="edit" />
        <ActionBtn icon={<IconPlusSq />}   label="Add Product" />
        <ActionBtn icon={<IconBook />}     label="Product Directory" />
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

function ActionBtn({ icon, label, trailing, className }: {
  icon: React.ReactNode; label: string; trailing?: 'edit'; className?: string;
}) {
  return (
    <button className={`smd-act ${className || ''}`}>
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

/* ─── Scoped CSS ─── */
const SCOPED_CSS = `
.smd-root {
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  background: linear-gradient(160deg,#faf5ff 0%,#f5f3ff 35%,#fafafa 100%);
  padding: 10px 14px 18px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  font-size: 12px;
}
.smd-root *,.smd-root *::before,.smd-root *::after { box-sizing: border-box; }

/* ── Customer banner ── */
.smd-cust-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px 10px 22px; margin-bottom: 10px;
  border: 1px solid #e9d5ff; border-radius: 14px;
  background: linear-gradient(110deg,#f5f3ff 0%,#ede9fe 60%,#e9d5ff 100%);
  box-shadow: 0 2px 10px rgba(124,58,237,.06);
}
.smd-cust-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg,#7c3aed 0%,#6d28d9 50%,#5b21b6 100%);
  border-radius: 14px 0 0 14px;
}
.smd-cust-left { display: flex; align-items: center; gap: 10px; flex-shrink: 0; z-index: 1; }
.smd-cust-avatar {
  position: relative; width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  box-shadow: 0 3px 12px rgba(124,58,237,.35);
}
.smd-cust-avatar svg { width: 18px; height: 18px; }
.smd-cust-avatar-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 9px; height: 9px; border-radius: 50%;
  background: linear-gradient(135deg,#4ade80,#22c55e);
  border: 2px solid #ede9fe;
}
.smd-cust-name { font-size: 14px; font-weight: 800; color: #4c1d95; letter-spacing: -.3px; line-height: 1.1; }
.smd-cust-tag {
  display: inline-block; margin-top: 3px;
  font-size: 8px; font-weight: 800; letter-spacing: .12em; color: #7c3aed;
  padding: 1px 8px; background: #fff; border: 1px solid #ddd6fe; border-radius: 20px;
}
.smd-cust-meta { display: flex; align-items: center; gap: 0; flex: 1; justify-content: flex-end; flex-wrap: wrap; z-index: 1; }
/* Vertical ':' dot divider between chips */
.smd-cust-sep {
  width: 14px; height: 22px; margin: 0 4px;
  background-image: radial-gradient(circle, #a78bfa 1.4px, transparent 1.8px);
  background-size: 4px 6px;
  background-repeat: no-repeat;
  background-position: center top 5px, center bottom 5px;
  background-image:
    radial-gradient(circle at center 6px, #a78bfa 1.6px, transparent 2px),
    radial-gradient(circle at center 16px, #a78bfa 1.6px, transparent 2px);
}
.smd-meta {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px 4px 4px;
  background: #fff; border: 1px solid #ddd6fe; border-radius: 12px;
}
.smd-meta-icon {
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(124,58,237,.3);
}
.smd-meta-icon svg { width: 13px; height: 13px; }
.smd-meta-label { font-size: 8px; font-weight: 800; letter-spacing: .12em; color: #94a3b8; line-height: 1.2; text-transform: uppercase; }
.smd-meta-value { font-size: 12px; font-weight: 800; color: #4c1d95; line-height: 1.2; letter-spacing: .02em; }
.smd-back-btn {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 8px 16px; border-radius: 11px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  border: none; color: #fff;
  font-weight: 700; font-size: 12px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(124,58,237,.4);
  transition: all .15s;
  z-index: 1;
}
.smd-back-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(124,58,237,.5); }

/* ── Stepper card (its own container) ── */
.smd-stepper-card {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(124,58,237,.05);
}

/* ── Stepper — chevron-arrow process flow ── */
.smd-stepper {
  display: grid; grid-template-columns: repeat(6,1fr); gap: 0;
}
.smd-step {
  position: relative; isolation: isolate; overflow: hidden;
  padding: 10px 26px 10px 32px;
  background: #f5f3ff;
  cursor: pointer; transition: filter .2s, transform .2s;
  min-height: 92px;
  /* Right edge: arrow point. Left edge: matching V-notch so the
     previous card's arrow nestles inside. */
  clip-path: polygon(
    0 0,
    calc(100% - 18px) 0,
    100% 50%,
    calc(100% - 18px) 100%,
    0 100%,
    18px 50%
  );
  margin-right: -16px;
}
.smd-step:first-child {
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%);
  padding-left: 16px;
  border-top-left-radius: 12px; border-bottom-left-radius: 12px;
}
.smd-step:last-child {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%);
  padding-right: 16px;
  margin-right: 0;
  border-top-right-radius: 12px; border-bottom-right-radius: 12px;
}
.smd-step:hover { filter: brightness(0.98); }
.smd-step-active {
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 60%,#5b21b6 100%);
  color: #fff;
  box-shadow: 0 6px 20px rgba(124,58,237,.35);
  z-index: 3;
}
.smd-step-done { background: #ffffff; z-index: 2; }
.smd-step-idle { background: #f5f3ff; z-index: 1; }

.smd-step-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.smd-step-num  { font-size: 8.5px; font-weight: 800; letter-spacing: .15em; color: #94a3b8; }
.smd-step-active .smd-step-num { color: rgba(255,255,255,.85); }
.smd-step-badge {
  font-size: 8.5px; font-weight: 800; letter-spacing: .06em;
  padding: 2px 7px; border-radius: 20px; white-space: nowrap;
}
.smd-step-badge-active { background: rgba(255,255,255,.22); color: #fff; }
.smd-step-badge-done   { background: #d1fae5; color: #047857; }
.smd-step-big {
  font-size: 30px; font-weight: 800; line-height: 1; letter-spacing: -1px;
  margin-top: 4px; color: #1e293b;
}
.smd-step-idle .smd-step-big { color: #cbd5e1; }
.smd-step-active .smd-step-big { color: #fff; }
.smd-step-title { font-size: 12px; font-weight: 700; margin-top: 4px; color: #1e293b; line-height: 1.15; }
.smd-step-idle .smd-step-title { color: #475569; }
.smd-step-active .smd-step-title { color: #fff; }
.smd-step-sub   { font-size: 9.5px; color: #94a3b8; line-height: 1.3; margin-top: 1px; }
.smd-step-active .smd-step-sub { color: rgba(255,255,255,.78); }
.smd-step-ghost {
  position: absolute; right: 22px; bottom: -14px;
  font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -2px;
  color: rgba(15,23,42,.05); pointer-events: none;
}
.smd-step-active .smd-step-ghost { color: rgba(255,255,255,.18); }

/* ── Action toolbar (own white card) ── */
.smd-toolbar {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fff; border: 1px solid #e9d5ff; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(124,58,237,.05);
}
.smd-act {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 11px; border-radius: 9px;
  background: #fff; border: 1px solid #e9d5ff; color: #6d28d9;
  font-weight: 600; font-size: 11.5px; cursor: pointer;
  transition: all .15s;
}
.smd-act:hover { border-color: #c4b5fd; background: #faf5ff; }
.smd-act-icon { display: inline-flex; align-items: center; color: #7c3aed; }
.smd-act-icon svg { width: 12px; height: 12px; }
.smd-act-label { line-height: 1; }
.smd-act-trail {
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 1px; color: #a78bfa;
}
.smd-act-trail svg { width: 10px; height: 10px; }
.smd-act-wa { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
.smd-act-wa .smd-act-icon { color: #10b981; }
.smd-act-wa:hover { background: #d1fae5; border-color: #6ee7b7; }

/* ── Body grid ── */
.smd-body {
  display: grid; grid-template-columns: 240px minmax(0,1fr) 300px; gap: 10px;
  align-items: stretch;
}
.smd-clm-card, .smd-deal-card, .smd-stage-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
  overflow: hidden; display: flex; flex-direction: column;
  min-width: 0;
}

/* ── CLM panel ── */
.smd-clm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
}
.smd-clm-header-left { display: flex; align-items: center; gap: 8px; }
.smd-clm-header-icon { width: 24px; height: 24px; border-radius: 7px; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; }
.smd-clm-title { font-size: 12px; font-weight: 800; }
.smd-clm-sub   { font-size: 9px; opacity: .85; }
.smd-clm-collapse {
  width: 22px; height: 22px; border-radius: 6px;
  background: rgba(255,255,255,.18); border: none; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.smd-clm-group { padding: 8px 10px; border-top: 1px solid #f1f5f9; }
.smd-clm-group:first-of-type { border-top: none; }
.smd-clm-group-head { display: flex; align-items: center; gap: 8px; padding: 3px 0 8px; }
.smd-clm-group-icon { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.smd-clm-group-icon-violet  { background: linear-gradient(135deg,#7c3aed,#6d28d9); }
.smd-clm-group-icon-emerald { background: linear-gradient(135deg,#10b981,#047857); }
.smd-clm-group-title { font-size: 11.5px; font-weight: 700; color: #1e293b; line-height: 1.2; }
.smd-clm-group-sub   { font-size: 9px; color: #94a3b8; }

.smd-clm-row {
  position: relative;
  padding: 7px 9px; border-radius: 10px;
  background: #fafbff; border: 1px solid #eef2ff;
  margin-bottom: 6px;
}
.smd-clm-row-head { display: flex; align-items: center; gap: 8px; }
.smd-clm-row-icon { width: 22px; height: 22px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.smd-clm-row-icon-amber   { background: linear-gradient(135deg,#f59e0b,#d97706); }
.smd-clm-row-icon-emerald { background: linear-gradient(135deg,#10b981,#047857); }
.smd-clm-row-icon-rose    { background: linear-gradient(135deg,#f43f5e,#e11d48); }
.smd-clm-row-icon-orange  { background: linear-gradient(135deg,#fb923c,#ea580c); }
.smd-clm-row-text { flex: 1; min-width: 0; }
.smd-clm-row-title { font-size: 10.5px; font-weight: 700; color: #1e293b; line-height: 1.2; }
.smd-clm-row-sub   { font-size: 9px; color: #94a3b8; }
.smd-clm-row-go {
  width: 20px; height: 20px; border-radius: 6px;
  background: #fff; border: 1px solid #e5e7eb; color: #6d28d9;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.smd-clm-progress {
  margin-top: 6px; height: 5px; background: #f1f5f9; border-radius: 4px; overflow: hidden;
}
.smd-clm-progress-fill { height: 100%; border-radius: 4px; }
.smd-clm-progress-fill-amber   { background: linear-gradient(90deg,#f59e0b,#fbbf24); }
.smd-clm-progress-fill-emerald { background: linear-gradient(90deg,#10b981,#34d399); }
.smd-clm-progress-fill-rose    { background: linear-gradient(90deg,#f43f5e,#fb7185); }
.smd-clm-progress-fill-orange  { background: linear-gradient(90deg,#fb923c,#fdba74); }
.smd-clm-progress-label { font-size: 9px; font-weight: 700; color: #64748b; text-align: right; margin-top: 2px; }

/* ── Deal panel ── */
.smd-deal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px;
  background: linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);
  color: #fff;
}
.smd-deal-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.smd-deal-header-icon { width: 24px; height: 24px; border-radius: 7px; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.smd-deal-title { font-size: 11.5px; font-weight: 800; line-height: 1.2; }
.smd-deal-sub   { font-size: 9px; opacity: .85; margin-top: 1px; }
.smd-deal-tabs { display: flex; gap: 3px; padding: 8px 10px 0; border-bottom: 1px solid #f1f5f9; }
.smd-deal-tab {
  position: relative; flex: 1;
  padding: 6px 4px; border-radius: 8px 8px 0 0;
  background: transparent; border: none;
  font-size: 9.5px; font-weight: 700; color: #64748b;
  cursor: pointer;
}
.smd-deal-tab-active { background: #7c3aed; color: #fff; }
.smd-deal-tab:disabled { opacity: .55; cursor: not-allowed; }
.smd-deal-tab-soon {
  position: absolute; top: -4px; right: 2px;
  font-size: 6.5px; font-weight: 800; letter-spacing: .08em;
  padding: 1px 3px; background: #f59e0b; color: #fff; border-radius: 5px;
}

.smd-deal-form { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 9px; }
.smd-deal-row  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.smd-field     { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.smd-field-label { font-size: 8.5px; font-weight: 800; letter-spacing: .08em; color: #64748b; text-transform: uppercase; }
.smd-input     {
  width: 100%; padding: 6px 9px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; font-size: 11px; color: #1e293b; font-family: inherit;
  transition: border-color .15s; min-width: 0;
}
.smd-input:focus { outline: none; border-color: #7c3aed; }
.smd-input-file { text-align: left; cursor: pointer; color: #64748b; }
.smd-req       { color: #ef4444; }
.smd-deal-section-label {
  font-size: 8.5px; font-weight: 800; letter-spacing: .12em; color: #94a3b8;
  text-align: center; padding-top: 4px; margin-top: 2px;
  text-transform: uppercase; border-top: 1px dashed #e5e7eb;
}
.smd-deal-save-wrap { display: flex; justify-content: center; margin-top: 2px; }
.smd-deal-save-btn {
  padding: 7px 28px; border-radius: 9px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  color: #fff; font-weight: 700; font-size: 11.5px; border: none; cursor: pointer;
  box-shadow: 0 3px 10px rgba(124,58,237,.3);
}
.smd-deal-save-btn:hover { transform: translateY(-1px); }

/* ── Stage card (middle column shell) ── */
.smd-stage-card { min-height: 420px; }

@media (max-width: 1500px) {
  .smd-body { grid-template-columns: 220px minmax(0,1fr) 280px; }
}
@media (max-width: 1280px) {
  .smd-body { grid-template-columns: 200px minmax(0,1fr) 260px; }
  .smd-stepper-card { padding: 8px 10px; }
  .smd-toolbar { padding: 8px 10px; }
}
@media (max-width: 1100px) {
  .smd-body { grid-template-columns: 1fr; }
  .smd-stepper { grid-template-columns: repeat(3,1fr); gap: 4px; }
  .smd-step { margin-right: 0; }
  .smd-step, .smd-step:first-child, .smd-step:last-child {
    clip-path: none; border-radius: 10px; border: 1px solid #e5e7eb; padding: 8px 12px;
  }
}
`;
