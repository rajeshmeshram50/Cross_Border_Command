import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Detail (Lead Inside View)
 *
 * Combined port of prototype `#leadDetailPage` (line 10644) and
 * `#lwLeadInsidePage` (line 81064) — both render a single-lead workflow
 * view with a stage stepper, opportunity bar, sublinks, and stage-body
 * content panes.
 *
 * Reached via /sales/lead-detail/:oppId. URL param defaults to a sample
 * lead if no param is given.
 * ──────────────────────────────────────────────────────────────────────── */

type StageKey = 'inquiry' | 'lead_ack' | 'sourcing' | 'price' | 'quotation' | 'victory';

const STAGES: { key: StageKey; label: string; icon: ReactNode }[] = [
  { key: 'inquiry',   label: 'Inquiry Received',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> },
  { key: 'lead_ack',  label: 'Lead Acknowledgement', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> },
  { key: 'sourcing',  label: 'Product Sourcing',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> },
  { key: 'price',     label: 'Price Shared',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
  { key: 'quotation', label: 'Quotation vs PI',     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { key: 'victory',   label: 'Victory Stage',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg> },
];

const SAMPLE_LEAD = {
  oppId:    'OPP-001',
  oppDate:  '10/04/2026',
  customer: 'GreenHarvest Global',
  email:    'r.vardhan@gmail.com',
  phone:    '+91 91234 56789',
  product:  'Cashew W320 — 20 MT',
  country:  'India',
  source:   'Offline',
  assigned: 'Shreeyash Rajaram Mote',
};

export default function SalesLeadDetail() {
  const navigate = useNavigate();
  const toast = useToast();
  const { oppId } = useParams();
  const [stage, setStage] = useState<StageKey>('inquiry');

  useEffect(() => {
    const id = 'sm-ld-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const lead = { ...SAMPLE_LEAD, oppId: oppId || SAMPLE_LEAD.oppId };
  const currentIdx = STAGES.findIndex(s => s.key === stage);

  return (
    <div className="ld-root">
      <style>{SCOPED_CSS}</style>

      {/* Stage stepper */}
      <div className="ld-stage-bar">
        {STAGES.map((s, i) => (
          <div
            key={s.key}
            className={`ld-stage ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'active' : ''} ${i > currentIdx ? 'upcoming' : ''}`}
            onClick={() => setStage(s.key)}
            title={s.label}
          >
            <div className="ld-stage-num">{s.icon}</div>
            <div className="ld-stage-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Sublinks */}
      <div className="ld-sublinks">
        <span className="ld-sublink" onClick={() => toast.info('Coming next', 'Customer Details modal')}>Customer Details ✎</span>
        <span className="ld-sublink" onClick={() => toast.info('Coming next', 'Contact Person modal')}>Contact Person ✎</span>
        <span className="ld-sublink" onClick={() => toast.info('Coming next', 'Contact Directory modal')}>Contact Directory ✎</span>
        <span className="ld-sublink" onClick={() => toast.info('Coming next', 'Consignee Details modal')}>Consignee Details ✎</span>
        <span className="ld-sublink" onClick={() => toast.info('Coming next', 'Consignee Directory modal')}>Consignee Directory ✎</span>
      </div>

      {/* Opportunity bar */}
      <div className="ld-opp-bar">
        <span>Opp ID: <strong>{lead.oppId}</strong></span>
        <span className="ld-sep">|</span>
        <span>Opp Date: <strong>{lead.oppDate}</strong></span>
        <span className="ld-sep">|</span>
        <span>Customer: <strong>{lead.customer}</strong></span>
        <div style={{ flex: 1 }} />
        <button className="ld-back-btn" onClick={() => navigate('/sales/lead-worksheet')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          Back to Workplace
        </button>
      </div>

      {/* Stage content card */}
      <div className="ld-stage-card">
        <div className="ld-stage-card-header">
          <div className="ld-stage-card-title">{STAGES[currentIdx].label}</div>
          <div className="ld-stage-card-sub">Stage {currentIdx + 1} of {STAGES.length}</div>
        </div>

        <div className="ld-stage-body">
          {stage === 'inquiry' && <InquiryPane lead={lead} />}
          {stage === 'lead_ack' && <PlaceholderPane label="Lead Acknowledgement — qualify or disqualify with reason. Modal flow lands next." />}
          {stage === 'sourcing' && <PlaceholderPane label="Product Sourcing — supplier comparison, vendor RFQ, cost evaluation. Module ships next." />}
          {stage === 'price' && <PlaceholderPane label="Price Shared — pricing matrix, currency conversion, freight + insurance line items." />}
          {stage === 'quotation' && <PlaceholderPane label="Quotation vs PI — see the dedicated QPI page for the full workflow." />}
          {stage === 'victory' && <PlaceholderPane label="Victory Stage — deal won, contract upload, BT (booking thread) generation." />}
        </div>
      </div>
    </div>
  );
}

function InquiryPane({ lead }: { lead: typeof SAMPLE_LEAD }) {
  return (
    <div className="ld-grid">
      <KV label="Opportunity ID" value={lead.oppId} mono />
      <KV label="Opportunity Date" value={lead.oppDate} />
      <KV label="Customer Name" value={lead.customer} />
      <KV label="Country" value={lead.country} />
      <KV label="Email" value={lead.email} />
      <KV label="Phone" value={lead.phone} />
      <KV label="Product Interest" value={lead.product} />
      <KV label="Lead Source" value={lead.source} />
      <KV label="Assigned To" value={lead.assigned} />
    </div>
  );
}

function PlaceholderPane({ label }: { label: string }) {
  return (
    <div className="ld-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.6">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p>{label}</p>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="ld-kv">
      <div className="ld-kv-label">{label}</div>
      <div className={`ld-kv-value ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}

const SCOPED_CSS = `
.ld-root {
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 50%, #ede9fe 100%);
  padding: 16px 22px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 12px;
}
.ld-root *, .ld-root *::before, .ld-root *::after { box-sizing: border-box; }

.ld-stage-bar {
  display: flex; align-items: center; gap: 0;
  background: #fff; border: 1px solid #ddd6fe;
  border-radius: 14px; padding: 12px 14px;
  box-shadow: 0 2px 10px rgba(124,58,237,.08);
  overflow-x: auto;
}
.ld-stage {
  flex: 1; min-width: 120px;
  padding: 8px 12px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: all .15s;
  position: relative;
}
.ld-stage:not(:last-child)::after {
  content: ""; position: absolute;
  right: -8px; top: 18px; width: 16px; height: 2px;
  background: #ddd6fe;
}
.ld-stage-num {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #f5f3ff; color: #a78bfa;
  border: 2px solid #ddd6fe;
  transition: all .15s;
}
.ld-stage-label {
  font-size: 11px; font-weight: 700;
  color: #6b7280; text-align: center;
  white-space: nowrap;
}
.ld-stage.done .ld-stage-num   { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: #16a34a; }
.ld-stage.done .ld-stage-label { color: #16a34a; }
.ld-stage.active .ld-stage-num  { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border-color: #7c3aed; box-shadow: 0 4px 12px rgba(124,58,237,.4); transform: scale(1.05); }
.ld-stage.active .ld-stage-label{ color: #6d28d9; }

.ld-sublinks {
  display: flex; flex-wrap: wrap; gap: 12px;
  padding: 8px 4px;
}
.ld-sublink {
  font-size: 12px; font-weight: 600;
  color: #7c3aed; cursor: pointer;
  padding: 5px 12px; border-radius: 6px;
  background: rgba(255,255,255,.7);
  border: 1px solid #ddd6fe;
  transition: all .15s;
}
.ld-sublink:hover { background: #fff; box-shadow: 0 2px 6px rgba(124,58,237,.15); }

.ld-opp-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  border: 1px solid #c4b5fd; border-radius: 10px;
  font-size: 12px; color: #4c1d95;
  box-shadow: 0 2px 8px rgba(124,58,237,.1);
}
.ld-opp-bar strong { color: #1e1b4b; }
.ld-sep { color: #a78bfa; }
.ld-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border: none; border-radius: 7px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; box-shadow: 0 3px 10px rgba(124,58,237,.35);
}

.ld-stage-card {
  background: #fff; border: 1px solid #ddd6fe;
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 4px 16px rgba(124,58,237,.1);
}
.ld-stage-card-header {
  padding: 14px 20px;
  background: linear-gradient(90deg, #8b5cf6, #7c3aed);
  color: #fff;
}
.ld-stage-card-title { font-size: 15px; font-weight: 800; letter-spacing: -.3px; }
.ld-stage-card-sub   { font-size: 11px; font-weight: 500; opacity: .85; margin-top: 2px; }
.ld-stage-body { padding: 20px 24px; }
.ld-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.ld-kv {
  background: #fafafa; padding: 10px 14px; border-radius: 8px;
  border: 1px solid #f3f4f6;
}
.ld-kv-label { font-size: 9.5px; font-weight: 800; color: #7c3aed; letter-spacing: .08em; text-transform: uppercase; }
.ld-kv-value { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 4px; }
.ld-kv-value.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #7c3aed; }
.ld-placeholder {
  padding: 40px 20px; text-align: center; color: #6b7280;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.ld-placeholder p { font-size: 13px; max-width: 480px; line-height: 1.6; }
`;
