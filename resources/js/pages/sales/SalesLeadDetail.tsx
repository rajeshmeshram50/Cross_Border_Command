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

const STAGES: { key: StageKey; label: string; desc: string; icon: ReactNode }[] = [
  { key: 'inquiry',   label: 'Inquiry Received',     desc: 'Lead inquiry captured',     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> },
  { key: 'lead_ack',  label: 'Lead Acknowledgement', desc: 'Qualification confirmed',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> },
  { key: 'sourcing',  label: 'Product Sourcing',     desc: 'Product/vendor sourcing',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> },
  { key: 'price',     label: 'Price Shared',         desc: 'Price shared with customer',icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
  { key: 'quotation', label: 'Quotation vs PI',      desc: 'Quotation/PI comparison',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { key: 'victory',   label: 'Victory Stage',        desc: 'Deal successfully won',     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg> },
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

      {/* Stepper + action buttons share one container */}
      <div className="ld-stepper-card">
        {/* Stage stepper — STEP 0X cards with chevron arrows */}
        <div className="ld-stage-bar">
          {STAGES.map((s, i) => {
            const num = String(i + 1).padStart(2, '0');
            const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'upcoming';
            const isLast = i === STAGES.length - 1;
            return (
              <div key={s.key} className="ld-stage-wrap">
                <div
                  className={`ld-stage ${state}`}
                  onClick={() => setStage(s.key)}
                  title={s.label}
                >
                  <div className="ld-stage-step">STEP {num}</div>
                  <div className="ld-stage-num">{num}</div>
                  <div className="ld-stage-title">{s.label}</div>
                  <div className="ld-stage-desc">{s.desc}</div>
                  <div className="ld-stage-ghost" aria-hidden>{num}</div>
                  {state === 'active' && (
                    <div className="ld-stage-chip">
                      <span className="ld-stage-chip-dot" />ACTIVE
                    </div>
                  )}
                  {state === 'done' && (
                    <div className="ld-stage-chip">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>DONE
                    </div>
                  )}
                </div>
                {!isLast && (
                  <div className={`ld-stage-arrow ${state}`} aria-hidden>
                    <svg viewBox="0 0 12 100" preserveAspectRatio="none"><polygon points="0,0 12,50 0,100" /></svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action button row — inside the same container */}
        <div className="ld-actions-row">
          {[
            { key: 'customer',   label: 'Customer',          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,                                          toast: 'Customer details modal' },
            { key: 'consignee',  label: 'Consignee',         icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>, toast: 'Consignee details modal' },
            { key: 'add-prod',   label: 'Add Product',       icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,                  toast: 'Add Product modal' },
            { key: 'prod-dir',   label: 'Product Directory', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/></svg>,                                       toast: 'Product Directory modal' },
            { key: 'owner',      label: 'Change Owner',      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>,                       toast: 'Change Owner modal' },
            { key: 'remark',     label: 'Remark',            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,                                                              toast: 'Remark modal' },
            { key: 'opp',        label: 'Key Opportunity',   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,                       toast: 'Key Opportunity modal' },
            { key: 'reminder',   label: 'Reminder',          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,                                          toast: 'Reminder modal' },
            { key: 'meetings',   label: 'Meetings',          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, toast: 'Meetings modal' },
            { key: 'prices',     label: 'Share Prices',      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,                                       toast: 'Share Prices modal' },
            { key: 'whatsapp',   label: 'WhatsApp Status',   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>, toast: 'WhatsApp Status modal', accent: 'whatsapp' as const },
          ].map(b => (
            <button
              key={b.key}
              type="button"
              className={`ld-action-pill ${b.accent ?? ''}`}
              onClick={() => toast.info('Coming next', b.toast)}
            >
              <span className="ld-action-icon">{b.icon}</span>
              <span>{b.label}</span>
            </button>
          ))}
        </div>
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

/* ────── Wrapper that hosts the stepper + the action pills ────── */
.ld-stepper-card {
  background: #fff;
  border: 1px solid #e9d5ff;
  border-radius: 16px;
  padding: 18px 18px 14px;
  box-shadow: 0 4px 18px rgba(124,58,237,.08);
  display: flex; flex-direction: column; gap: 14px;
}

/* Action pill row */
.ld-actions-row {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding-top: 6px;
  border-top: 1px solid #f3e8ff;
}
.ld-action-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1.5px solid #ddd6fe;
  color: #5b21b6;
  font-family: inherit;
  font-size: 12.5px; font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s, transform .15s, box-shadow .15s;
}
.ld-action-pill:hover {
  background: #f5f3ff;
  border-color: #a78bfa;
  color: #4c1d95;
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(124,58,237,.14);
}
.ld-action-pill .ld-action-icon {
  display: inline-flex; align-items: center; justify-content: center;
  color: #7c3aed;
}
.ld-action-pill.whatsapp {
  background: linear-gradient(135deg, #d1fae5, #a7f3d0);
  border-color: #6ee7b7;
  color: #065f46;
}
.ld-action-pill.whatsapp .ld-action-icon { color: #10b981; }
.ld-action-pill.whatsapp:hover {
  background: linear-gradient(135deg, #a7f3d0, #6ee7b7);
  border-color: #10b981;
  box-shadow: 0 3px 10px rgba(16,185,129,.20);
}

/* ────── STEP-card stage bar (square = dark, triangle = faint) ────── */
.ld-stage-bar {
  display: flex; align-items: stretch; gap: 4px;
  width: 100%; min-width: 0;
}
.ld-stage-wrap {
  flex: 1; min-width: 0;
  display: flex; align-items: stretch;
}
.ld-stage {
  flex: 1; min-width: 0;
  border-radius: 12px;
  padding: 10px 14px 12px 14px;
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
  min-height: 88px;
  cursor: pointer;
  transition: transform .17s ease, box-shadow .17s ease;
}

/* Typography inside cards */
.ld-stage-step {
  font-size: 9px; font-weight: 800;
  letter-spacing: .2em; text-transform: uppercase;
  line-height: 1; margin-bottom: 4px;
  position: relative; z-index: 2;
}
.ld-stage .ld-stage-num {
  font-size: 30px; font-weight: 900;
  line-height: 1; letter-spacing: -.04em;
  margin-bottom: 4px;
  position: relative; z-index: 2;
  width: auto; height: auto; border: none; background: none; display: block;
}
.ld-stage-title {
  font-size: 12.5px; font-weight: 800;
  line-height: 1.25;
  position: relative; z-index: 2;
}
.ld-stage-desc {
  font-size: 10px; font-weight: 500;
  line-height: 1.35; margin-top: 2px;
  position: relative; z-index: 2;
}

/* Ghost watermark number — big, bottom-right */
.ld-stage-ghost {
  position: absolute; right: 0; bottom: -10px;
  font-size: 56px; font-weight: 900; line-height: 1;
  letter-spacing: -.05em;
  pointer-events: none; user-select: none;
  z-index: 1;
}

/* Status chip — top-right */
.ld-stage-chip {
  position: absolute; top: 6px; right: 8px;
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 20px;
  padding: 2px 8px;
  font-size: 8px; font-weight: 800;
  letter-spacing: .07em;
  z-index: 10;
}
.ld-stage-chip-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  animation: ld-pulse 1.2s ease-in-out infinite;
}
@keyframes ld-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .55; transform: scale(.75); }
}

/* ── ACTIVE (square = dark purple) ── */
.ld-stage.active {
  background: linear-gradient(150deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  border: 1px solid #6d28d9;
  box-shadow:
    0 6px 20px rgba(124,58,237,.40),
    0 1px 0 rgba(255,255,255,.13) inset;
}
.ld-stage.active .ld-stage-step  { color: rgba(255,255,255,.55); }
.ld-stage.active .ld-stage-num   { color: #fff; }
.ld-stage.active .ld-stage-title { color: #fff; }
.ld-stage.active .ld-stage-desc  { color: rgba(255,255,255,.72); }
.ld-stage.active .ld-stage-ghost { color: rgba(255,255,255,.10); }
.ld-stage.active .ld-stage-chip  {
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.30);
  color: #fff;
}
.ld-stage.active:hover {
  transform: translateY(-2px);
  box-shadow:
    0 10px 26px rgba(124,58,237,.50),
    0 1px 0 rgba(255,255,255,.13) inset;
}

/* ── DONE (square = mint dark) ── */
.ld-stage.done {
  background: linear-gradient(150deg, #10B981 0%, #059669 55%, #047857 100%);
  border: 1px solid #059669;
  box-shadow:
    0 4px 14px rgba(16,185,129,.32),
    0 1px 0 rgba(255,255,255,.14) inset;
}
.ld-stage.done .ld-stage-step  { color: rgba(255,255,255,.60); }
.ld-stage.done .ld-stage-num   { color: #fff; }
.ld-stage.done .ld-stage-title { color: #fff; }
.ld-stage.done .ld-stage-desc  { color: rgba(255,255,255,.78); }
.ld-stage.done .ld-stage-ghost { color: rgba(255,255,255,.12); }
.ld-stage.done .ld-stage-chip  {
  background: rgba(255,255,255,.20);
  border: 1px solid rgba(255,255,255,.32);
  color: #fff;
}
.ld-stage.done:hover {
  transform: translateY(-2px);
  box-shadow:
    0 7px 18px rgba(16,185,129,.40),
    0 1px 0 rgba(255,255,255,.14) inset;
}

/* ── UPCOMING (square = dark slate, still readable) ── */
.ld-stage.upcoming {
  background: linear-gradient(150deg, #475569 0%, #334155 55%, #1e293b 100%);
  border: 1px solid #334155;
  box-shadow:
    0 3px 10px rgba(15,23,42,.18),
    0 1px 0 rgba(255,255,255,.06) inset;
  cursor: pointer;
}
.ld-stage.upcoming .ld-stage-step  { color: rgba(203,213,225,.55); }
.ld-stage.upcoming .ld-stage-num   { color: rgba(226,232,240,.85); }
.ld-stage.upcoming .ld-stage-title { color: #e2e8f0; }
.ld-stage.upcoming .ld-stage-desc  { color: rgba(203,213,225,.65); }
.ld-stage.upcoming .ld-stage-ghost { color: rgba(255,255,255,.06); }
.ld-stage.upcoming:hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 16px rgba(15,23,42,.28),
    0 1px 0 rgba(255,255,255,.10) inset;
}

/* ── Chevron arrow between cards (triangle = faint) ── */
.ld-stage-arrow {
  flex-shrink: 0; width: 14px;
  display: flex; align-items: stretch;
}
.ld-stage-arrow svg {
  display: block; width: 14px; flex: 1; min-height: 70px;
}
.ld-stage-arrow.active   svg polygon { fill: #c4b5fd; opacity: .55; }
.ld-stage-arrow.done     svg polygon { fill: #6ee7b7; opacity: .55; }
.ld-stage-arrow.upcoming svg polygon { fill: #cbd5e1; opacity: .35; }

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

/* Opp ID bar — white pill row */
.ld-opp-bar {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 13px;
  color: #6b7280;
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.ld-opp-bar strong { color: #1e1b4b; font-weight: 700; }
.ld-sep { color: #d1d5db; }

/* Back button — blue gradient pill */
.ld-back-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px;
  background: linear-gradient(135deg, #0284c7, #0ea5e9);
  color: #fff;
  border: none; border-radius: 8px;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer;
  transition: all .18s;
  box-shadow: 0 2px 6px rgba(14,165,233,.30);
}
.ld-back-btn:hover {
  background: linear-gradient(135deg, #0369a1, #0284c7);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14,165,233,.40);
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
