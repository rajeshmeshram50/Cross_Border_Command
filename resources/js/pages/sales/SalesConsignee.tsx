import { Fragment, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddConsigneeModal, { type ConsigneeRow } from './AddConsigneeModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Consignee
 *
 * Mirrors SalesCustomers in structure but uses an emerald/teal palette and
 * the consignee-specific columns (Consignee ID, Customer ID linkage, Risk
 * Level pill, Country). Permission-gated on sales.consignee per the
 * permissions sheet — super_admin bypasses; everyone else is gated by
 * user.permissions['sales.consignee'].can_view / can_add / can_edit.
 *
 * No DB yet: rows mirror the dataset in the design. Replace with
 * api.get('/consignees') once the table migration lands.
 * ──────────────────────────────────────────────────────────────────────── */

type RiskLevel = 'Low' | 'Medium' | 'High';
type Consignee = {
  id: string;          // CGN-001
  customerId: string;  // C-001
  company: string;
  segment: string;
  risk: RiskLevel;
  contact: string;
  email: string;
  phone: string;
  country: string;
  countryDetail: string; // (Dubai), (London) — bracketed sub-text
};

const ROWS: Consignee[] = [
  { id:'CGN-001', customerId:'C-001', company:'Shree Gulf Trading LLC',     segment:'Dry Fruits',   risk:'Low',    contact:'Yash Mote',      email:'yash.gulf@shree.ae',         phone:'+971-501234567',  country:'UAE',         countryDetail:'Dubai' },
  { id:'CGN-002', customerId:'C-001', company:'Shree UK Imports',           segment:'Dry Fruits',   risk:'Medium', contact:'Priya Nair',     email:'priya@shreeuk.co.uk',        phone:'+44-7911123456',  country:'UK',          countryDetail:'London' },
  { id:'CGN-003', customerId:'C-002', company:'GreenHarvest Rotterdam BV',  segment:'Agro',         risk:'Low',    contact:'Jan Verbeke',    email:'jan@greenharvestrdam.nl',    phone:'+31-612345678',   country:'Netherlands', countryDetail:'Rotterdam' },
  { id:'CGN-004', customerId:'C-002', company:'GreenHarvest Canada Inc.',   segment:'Agro',         risk:'Low',    contact:'Sarah Oakes',    email:'sarah@ghcanada.ca',          phone:'+1-6135550199',   country:'Canada',      countryDetail:'Ontario' },
  { id:'CGN-005', customerId:'C-002', company:'GreenHarvest Singapore Pte', segment:'Agro',         risk:'Medium', contact:'Tan Wei Lin',    email:'wei@ghsg.com.sg',            phone:'+65-81234567',    country:'Singapore',   countryDetail:'Central' },
  { id:'CGN-006', customerId:'C-003', company:'Agri Export GmbH',           segment:'Rice & Grains',risk:'High',   contact:'Klaus Weber',    email:'klaus@agriexport.de',        phone:'+49-1712345678',  country:'Germany',     countryDetail:'Bavaria' },
  { id:'CGN-007', customerId:'C-003', company:'Grain Partners Poland',      segment:'Rice & Grains',risk:'Medium', contact:'Andrzej Nowak',  email:'andrzej@grainpl.eu',         phone:'+48-501234567',   country:'Poland',      countryDetail:'Masovia' },
  { id:'CGN-008', customerId:'C-004', company:'Int. Buyer Dubai Hub',       segment:'Spices',       risk:'Low',    contact:'Ahmed Al-Farsi', email:'ahmed.hub@intlbuyer.ae',     phone:'+971-502345678',  country:'UAE',         countryDetail:'Abu Dhabi' },
  { id:'CGN-009', customerId:'C-004', company:'Int. Buyer USA Corp.',       segment:'Spices',       risk:'Low',    contact:'Mike Thompson',  email:'mike@intlbuyerusa.com',      phone:'+1-2125551234',   country:'USA',         countryDetail:'New York' },
  { id:'CGN-010', customerId:'C-004', company:'Int. Buyer KSA LLC',         segment:'Spices',       risk:'High',   contact:'Khalid Al-Rashid', email:'khalid@intlksa.com',        phone:'+966-501234567',  country:'Saudi Arabia',countryDetail:'Riyadh' },
  { id:'CGN-011', customerId:'C-005', company:'QuickTrade Egypt',           segment:'Pulses',       risk:'Medium', contact:'Mahmoud Fahmy',  email:'mahmoud@quicktrade.eg',      phone:'+20-1001234567',  country:'Egypt',       countryDetail:'Cairo' },
  { id:'CGN-012', customerId:'C-006', company:'Fit Nation Singapore',       segment:'Dry Fruits',   risk:'Low',    contact:'Lim Yong',       email:'lim@fitnation.sg',           phone:'+65-90123456',    country:'Singapore',   countryDetail:'East' },
  { id:'CGN-013', customerId:'C-007', company:'MJ Coconut Spain',           segment:'Coconut Oil',  risk:'Medium', contact:'Carla Ruiz',     email:'carla@mjspain.es',           phone:'+34-911234567',   country:'Spain',       countryDetail:'Valencia' },
  { id:'CGN-014', customerId:'C-008', company:'FreshMart UAE Hub',          segment:'Basmati Rice', risk:'Low',    contact:'Sana Khan',      email:'sana@freshmart.ae',          phone:'+971-561234567',  country:'UAE',         countryDetail:'Sharjah' },
  { id:'CGN-015', customerId:'C-009', company:'Bharat Agro Kenya',          segment:'Millets',      risk:'High',   contact:'Wanjiru Kimani', email:'wanjiru@bharatagrokenya.co', phone:'+254-712345678',  country:'Kenya',       countryDetail:'Nairobi' },
  { id:'CGN-016', customerId:'C-010', company:'Eastern Harvest Japan',      segment:'Coffee Beans', risk:'Low',    contact:'Hiro Tanaka',    email:'hiro@easternjp.co.jp',       phone:'+81-9012345678',  country:'Japan',       countryDetail:'Osaka' },
  { id:'CGN-017', customerId:'C-011', company:'Sun Agri Morocco',           segment:'Turmeric',     risk:'Medium', contact:'Yousef Idrissi', email:'yousef@sunagri.ma',          phone:'+212-661234567',  country:'Morocco',     countryDetail:'Casablanca' },
  { id:'CGN-018', customerId:'C-012', company:'Prime Foods Qatar',          segment:'Spices',       risk:'Low',    contact:'Hamad Al-Thani', email:'hamad@primefoods.qa',        phone:'+974-33123456',   country:'Qatar',       countryDetail:'Doha' },
];

const RISK_COLORS: Record<RiskLevel, { bg: string; color: string; dot: string }> = {
  'Low':    { bg:'#ecfdf5', color:'#047857', dot:'#10b981' },
  'Medium': { bg:'#fffbeb', color:'#b45309', dot:'#f59e0b' },
  'High':   { bg:'#fef2f2', color:'#b91c1c', dot:'#ef4444' },
};

const ROWS_PER_PAGE = 10;

export default function SalesConsignee() {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  // Permission row for sales.consignee. Backend-authoritative; we just gate
  // the UI affordances. Super_admin bypasses.
  const perm = user?.permissions?.['sales.consignee'];
  const canView = isSuperAdmin || !!perm?.can_view;
  const canAdd  = isSuperAdmin || !!perm?.can_add;
  const canEdit = isSuperAdmin || !!perm?.can_edit;

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [wdhOpen, setWdhOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);

  // Inject Google Fonts (DM Sans, Inter) once on mount — same pattern as
  // SalesCustomers so the page renders with its intended typography.
  useEffect(() => {
    const id = 'sm-consignee-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = useMemo(() => {
    if (!q) return ROWS;
    const lo = q.toLowerCase();
    return ROWS.filter(c =>
      c.company.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.customerId.toLowerCase().includes(lo) ||
      c.contact.toLowerCase().includes(lo) ||
      c.email.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo) ||
      c.country.toLowerCase().includes(lo) ||
      c.risk.toLowerCase().includes(lo),
    );
  }, [q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * ROWS_PER_PAGE;
  const rows = filtered.slice(startIdx, startIdx + ROWS_PER_PAGE);

  const onSearch = (v: string) => { setQ(v); setPage(1); };
  const soon = (label: string) => toast.info(label, 'Coming in next phase');

  // Hard-stop direct URL access for users whose Permissions sheet doesn't
  // include sales.consignee.can_view. Sidebar already hides the link, but
  // this catches /sales/consignee typed straight into the address bar.
  if (!canView) {
    return (
      <div className="smcg-root">
        <style>{SCOPED_CSS}</style>
        <div className="smcg-cstrip">
          <div className="smcg-cstrip-left">
            <div>
              <div className="smcg-title">No access</div>
              <div className="smcg-sub">You don't have permission to view Consignees. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → Consignee.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="smcg-root">
      <style>{SCOPED_CSS}</style>

      {/* Hero strip — emerald gradient, truck icon, add button */}
      <div className="smcg-cstrip">
        <span className="smcg-accent" />
        <span className="smcg-glow" />
        <span className="smcg-sheen" />
        <div className="smcg-cstrip-left">
          <div className="smcg-avatar-wrap">
            <div className="smcg-avatar"><IconTruck /></div>
          </div>
          <div>
            <div className="smcg-title">Consignee</div>
            <div className="smcg-sub">Manage consignee identity, shipment delivery ownership, compliance readiness, and customer-linked destination mapping for export execution.</div>
          </div>
        </div>
        <div className="smcg-cstrip-right">
          {canAdd && (
            <button className="smcg-add-btn" onClick={() => { setEditing(null); setAddOpen(true); }}>
              <span className="smcg-add-sheen" />
              <IconPlus />
              Add Consignee
            </button>
          )}
        </div>
      </div>

      {/* What We Are Doing Here — 4 emerald cards */}
      <div className="smcg-wdh">
        <div className="smcg-wdh-header" onClick={() => setWdhOpen(o => !o)} role="button">
          <div className="smcg-wdh-head-left">
            <div className="smcg-wdh-icon"><IconTruck /></div>
            <div>
              <div className="smcg-wdh-title">Consignee — What We Are Doing Here</div>
              <div className="smcg-wdh-subtitle">4 steps to complete consignee setup</div>
            </div>
          </div>
          <button className="smcg-wdh-toggle" onClick={(e) => { e.stopPropagation(); setWdhOpen(o => !o); }}>
            {wdhOpen ? <IconChevronUp /> : <IconChevronDown />}
          </button>
        </div>
        {wdhOpen && (
          <div className="smcg-wdh-body">
            {STEPS.map((s, i) => (
              <Fragment key={s.n}>
                <div className="smcg-step">
                  <div className="smcg-step-head">
                    <div className="smcg-step-num">{s.n}</div>
                    <span className="smcg-step-name">{s.name}</span>
                  </div>
                  <p className="smcg-step-desc">{s.desc}</p>
                  <div className="smcg-step-tag">
                    <span className="smcg-step-tag-dot" />
                    {s.tag}
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="smcg-step-arrow"><div className="smcg-step-arrow-dot"><IconChevronRight /></div></div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="smcg-search-bar">
        <div className="smcg-search">
          <IconSearch />
          <input
            type="text"
            placeholder="Search by consignee ID, customer, company, country, risk..."
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table card */}
      <div className="smcg-table-card">
        <div className="smcg-table-wrap">
          <table className="smcg-table">
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Consignee ID</th>
                <th>Customer ID</th>
                <th>Company Name</th>
                <th>Segment</th>
                <th>Risk Level</th>
                <th>Contact Person</th>
                <th>Email</th>
                <th>Contact No</th>
                <th>Country</th>
                <th className="ta-c">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="smcg-empty">No consignees found</td></tr>
              )}
              {rows.map((c, i) => {
                const r = RISK_COLORS[c.risk];
                return (
                  <tr key={c.id} className={i % 2 === 0 ? 'even' : 'odd'}>
                    <td><span className="smcg-srno">{startIdx + i + 1}</span></td>
                    <td><span className="smcg-id-chip">{c.id}</span></td>
                    <td><span className="smcg-cust-chip">{c.customerId}</span></td>
                    <td><span className="smcg-company">{c.company}</span></td>
                    <td><span className="smcg-seg">{c.segment}</span></td>
                    <td>
                      <span className="smcg-risk-pill" style={{ background:r.bg, color:r.color }}>
                        <span className="smcg-risk-dot" style={{ background:r.dot }} />
                        {c.risk}
                      </span>
                    </td>
                    <td className="smcg-contact">{c.contact}</td>
                    <td className="smcg-email">{c.email}</td>
                    <td className="smcg-mono">{c.phone}</td>
                    <td className="smcg-country">{c.country} <span className="smcg-country-sub">({c.countryDetail})</span></td>
                    <td className="ta-c">
                      <div className="smcg-actions">
                        {canEdit && (
                          <Tooltip label="Edit Consignee">
                            <button aria-label="Edit Consignee" className="smcg-act smcg-act-edit" onClick={() => { setEditing(c); setAddOpen(true); }}><IconEdit /></button>
                          </Tooltip>
                        )}
                        <Tooltip label="Evidence Vault">
                          <button aria-label="Evidence Vault" className="smcg-act smcg-act-vault" onClick={() => soon('Evidence Vault')}>
                            <IconVault /> Vault
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="smcg-pagination">
          <span className="smcg-pag-pages">{safePage} / {pages}</span>
          <span className="smcg-pag-info">
            {total === 0 ? 'No records' : `Showing ${startIdx + 1}–${Math.min(startIdx + ROWS_PER_PAGE, total)} of ${total}`}
          </span>
          <div className="smcg-pag-right">
            <button className="smcg-pag-btn" disabled={safePage <= 1}  onClick={() => setPage(p => Math.max(1, p - 1))}><IconChevronLeft /></button>
            <button className="smcg-pag-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}><IconChevronRight /></button>
          </div>
        </div>
      </div>

      <AddConsigneeModal
        open={addOpen}
        consignee={editing}
        onClose={() => { setAddOpen(false); setEditing(null); }}
      />
    </div>
  );
}

/* ─── 4-step "What we are doing here" content ─── */
const STEPS: { n: number; name: string; desc: string; tag: string }[] = [
  { n: 1, name: 'Create Consignee',           desc: 'Add consignee company, address, country, and contact details.',                tag: 'Foundation Step' },
  { n: 2, name: 'Customer & Trade Linkage',   desc: 'Map consignee with the correct customer and trade flow.',                       tag: 'Relationship Mapping' },
  { n: 3, name: 'Compliance & Risk Details',  desc: 'Capture compliance, country risk, and required document details.',              tag: 'Risk & Compliance' },
  { n: 4, name: 'Shipment & Export Readiness',desc: 'Prepare consignee for PI, shipment, export, and execution workflows.',          tag: 'Final Execution' },
];

/* ─── Inline SVG icons (Lucide-style stroke) ─── */
const IconTruck = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5" />
    <path d="M14 17h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.5">
    <polyline points="7 11 12 6 17 11" /><polyline points="7 18 12 13 17 18" />
  </svg>
);
const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.5">
    <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
  </svg>
);
const IconChevronLeft = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconEdit = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);
const IconVault = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M5 8h14M5 8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2" />
    <path d="M5 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
  </svg>
);

/* ─── Scoped page CSS (all rules under .smcg-root) ─── */
const SCOPED_CSS = `
.smcg-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #ecfdf5 0%, #d1fae5 40%, #a7f3d0 100%);
  padding: 14px 18px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 10px;
  color: #064e3b;
}
.smcg-root *, .smcg-root *::before, .smcg-root *::after { box-sizing: border-box; }

/* ─── Hero strip ─── */
.smcg-cstrip {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  min-height: 76px; padding: 0 22px;
  border: 1px solid rgba(16,185,129,.40); border-radius: 16px;
  background: linear-gradient(110deg, #10b981 0%, #059669 45%, #047857 100%);
  box-shadow:
    0 2px 0 rgba(255,255,255,.30) inset,
    0 8px 28px rgba(16,185,129,.30),
    0 2px 8px rgba(0,0,0,.06);
  flex-shrink: 0;
  color: #fff;
}
.smcg-accent {
  position: absolute; left:0; top:0; bottom:0; width:4px;
  background: linear-gradient(180deg, #6ee7b7, #10b981, #047857);
  border-radius: 16px 0 0 16px;
}
.smcg-glow {
  position: absolute; inset:0; pointer-events:none;
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(255,255,255,.18) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 50%, rgba(167,243,208,.20) 0%, transparent 55%);
}
.smcg-sheen {
  position: absolute; top:0; left:0; right:0; height:48%; pointer-events:none;
  background: linear-gradient(180deg, rgba(255,255,255,.22), transparent);
  border-radius: 16px 16px 0 0;
}
.smcg-cstrip-left  { display:flex; align-items:center; gap:14px; z-index:1; padding-left:4px; }
.smcg-avatar-wrap  { position: relative; flex-shrink: 0; }
.smcg-avatar {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.30);
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
}
.smcg-title { font-size:18px; font-weight:800; color:#fff; letter-spacing:-.4px; line-height:1.2; }
.smcg-sub   { font-size:11.5px; color:rgba(255,255,255,.85); font-weight:400; margin-top:2px; line-height:1.4; max-width: 760px; }

.smcg-cstrip-right { display:flex; align-items:center; gap:7px; z-index:1; flex-shrink:0; }
.smcg-add-btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 46px;
  border: 1px solid rgba(255,255,255,.30); border-radius: 12px;
  font-family: inherit; font-size: 14px; font-weight: 700;
  color: #047857; letter-spacing: .01em; white-space: nowrap; cursor: pointer;
  background: #fff;
  box-shadow:
    0 6px 18px rgba(0,0,0,.15),
    0 1px 0 rgba(255,255,255,.40) inset;
  transition: transform .18s, box-shadow .18s, color .18s, background .18s;
}
.smcg-add-btn:hover {
  transform: translateY(-2px);
  background: #f0fdf4;
  color: #064e3b;
  box-shadow: 0 10px 28px rgba(0,0,0,.20), 0 1px 0 rgba(255,255,255,.40) inset;
}
.smcg-add-btn:active { transform: translateY(0); }
.smcg-add-sheen {
  position: absolute; top:0; left:0; right:0; height:48%; pointer-events:none;
  background: linear-gradient(180deg, rgba(255,255,255,.55), transparent);
  border-radius: 12px 12px 0 0;
}

/* ─── What We Are Doing Here ─── */
.smcg-wdh {
  position: relative;
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%);
  border: 1px solid rgba(16,185,129,.30); border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(16,185,129,.10);
  flex-shrink: 0;
}
.smcg-wdh-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 16px; min-height: 56px;
  cursor: pointer; user-select: none; position: relative; z-index: 1;
}
.smcg-wdh-head-left { display:flex; align-items:center; gap:11px; }
.smcg-wdh-icon {
  width:34px; height:34px; border-radius:9px;
  background: linear-gradient(135deg, #10b981, #047857);
  display:flex; align-items:center; justify-content:center;
  color:#fff; flex-shrink:0; box-shadow:0 3px 10px rgba(5,150,105,.40);
}
.smcg-wdh-title { font-size:14px; font-weight:800; color:#064e3b; letter-spacing:-.3px; }
.smcg-wdh-subtitle { font-size:11px; color:#047857; font-weight:500; margin-top:1px; }
.smcg-wdh-toggle {
  width:30px; height:30px; border-radius:50%;
  border:1.5px solid rgba(5,150,105,.30); background: rgba(255,255,255,.7);
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; transition: background .15s;
}
.smcg-wdh-toggle:hover { background: rgba(255,255,255,.95); }
.smcg-wdh-body {
  display:flex; align-items:stretch; gap:0; padding: 4px 14px 12px;
  position: relative; z-index: 1;
}
.smcg-step {
  flex:1; min-width:0;
  background:#fff; border:1.5px solid #d1fae5; border-left:3px solid #10b981;
  border-radius:10px; padding:11px 13px;
  display:flex; flex-direction:column; gap:5px;
  box-shadow: 0 1px 4px rgba(16,185,129,.08);
}
.smcg-step-head { display:flex; align-items:center; gap:8px; }
.smcg-step-num {
  width:24px; height:24px; border-radius:6px;
  background: linear-gradient(135deg, #10b981, #047857);
  display:flex; align-items:center; justify-content:center;
  color:#fff; font-size:11px; font-weight:800; line-height:1;
  flex-shrink:0; box-shadow:0 2px 6px rgba(5,150,105,.30);
}
.smcg-step-name { font-size:12.5px; font-weight:700; color:#064e3b; letter-spacing:-.2px; line-height:1.2; }
.smcg-step-desc { font-size:11px; color:#475569; font-weight:400; line-height:1.45; margin:0; }
.smcg-step-tag {
  display:inline-flex; align-items:center; gap:5px;
  font-size:10.5px; font-weight:700; color:#047857;
  margin-top: 4px;
}
.smcg-step-tag-dot { width:5px; height:5px; border-radius:50%; background:#10b981; }
.smcg-step-arrow {
  display:flex; align-items:center; justify-content:center; flex-shrink:0; width:28px;
}
.smcg-step-arrow-dot {
  width:22px; height:22px; border-radius:50%;
  background:#fff; border:1.5px solid #a7f3d0;
  display:flex; align-items:center; justify-content:center;
  color:#10b981;
  box-shadow:0 1px 4px rgba(16,185,129,.10);
}

/* ─── Search bar (standalone) ─── */
.smcg-search-bar { display:flex; flex-shrink:0; }
.smcg-search {
  flex: 1;
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,.85);
  border: 1.5px solid rgba(16,185,129,.30); border-radius: 12px;
  padding: 9px 16px;
  box-shadow: 0 2px 8px rgba(16,185,129,.08), 0 1px 0 rgba(255,255,255,.9) inset;
  backdrop-filter: blur(4px);
  transition: border-color .2s, box-shadow .2s;
}
.smcg-search:focus-within {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,.15), 0 2px 8px rgba(16,185,129,.10);
}
.smcg-search input {
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 13px; color: #064e3b;
  width: 100%; font-weight: 500;
}
.smcg-search input::placeholder { color: #6ee7b7; }

/* ─── Table card ─── */
.smcg-table-card {
  background: #fff;
  border: 1.5px solid rgba(16,185,129,.30); border-radius: 18px;
  box-shadow: 0 8px 32px rgba(5,150,105,.12), 0 2px 8px rgba(5,150,105,.06);
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}

/* ─── Table ─── */
.smcg-table-wrap { overflow: auto; flex: 1; min-height: 0; }
.smcg-table {
  width: 100%; min-width: 1200px;
  border-collapse: collapse;
  font-size: 12px;
}
.smcg-table thead tr {
  background: linear-gradient(110deg, #047857 0%, #059669 40%, #10b981 75%, #34d399 100%);
  box-shadow: 0 2px 8px rgba(5,150,105,.20);
}
.smcg-table thead th {
  padding: 9px 8px;
  font-size: 9.5px; font-weight: 800;
  color: rgba(255,255,255,.95);
  text-transform: uppercase; letter-spacing: .08em;
  text-align: left; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.smcg-table thead th:first-child { padding-left: 14px; }
.smcg-table thead th.ta-c { text-align: center; }
.smcg-table tbody td {
  padding: 9px 8px;
  font-size: 12px;
  border-bottom: 1px solid #d1fae5;
  vertical-align: middle;
  white-space: nowrap;
  color: #064e3b;
}
.smcg-table tbody td:first-child { padding-left: 14px; }
.smcg-table tbody td.ta-c { text-align: center; }
.smcg-table tbody tr.odd  td { background: linear-gradient(180deg, rgba(209,250,229,.30), rgba(167,243,208,.22)); }
.smcg-table tbody tr.even td { background: rgba(236,253,245,.50); }
.smcg-table tbody tr:hover td { background: linear-gradient(90deg, rgba(110,231,183,.25), rgba(52,211,153,.20), rgba(110,231,183,.25)) !important; }
.smcg-table tbody tr:last-child td { border-bottom: none; }
.smcg-empty { text-align: center; padding: 32px !important; color: #10b981; font-size: 12px; font-style: italic; }

.smcg-srno {
  display:inline-flex; align-items:center; justify-content:center;
  width:22px; height:22px; border-radius:6px;
  background: #f0fdf4;
  color:#047857; font-size:10px; font-weight:800;
  border: 1px solid #a7f3d0;
}
.smcg-id-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 800; color: #047857;
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid #a7f3d0; letter-spacing: .02em;
}
.smcg-cust-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 800; color: #6d28d9;
  background: linear-gradient(135deg, #faf5ff, #ede9fe);
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid #ddd6fe; letter-spacing: .02em;
}
.smcg-company { font-weight:700; color:#064e3b; letter-spacing:-.1px; }
.smcg-seg {
  display:inline-flex; align-items:center; gap:4px;
  font-size:10.5px; font-weight:600; color:#047857;
  background: linear-gradient(135deg, rgba(209,250,229,.85), rgba(167,243,208,.65));
  border:1px solid #a7f3d0; border-radius:20px; padding:3px 10px; white-space:nowrap;
}
.smcg-seg::before { content:''; width:4px; height:4px; border-radius:50%; background:#10b981; flex-shrink:0; }
.smcg-risk-pill {
  display:inline-flex; align-items:center; gap:5px;
  padding:3px 10px; border-radius:20px;
  font-size:10.5px; font-weight:700;
  white-space:nowrap;
}
.smcg-risk-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.smcg-country { color:#064e3b; font-weight:600; }
.smcg-country-sub { color:#6b7280; font-weight:500; font-size:11px; }
.smcg-contact { font-weight:600; color:#1f2937; }
.smcg-mono    { font-family: 'JetBrains Mono', monospace; color:#374151; font-size:11.5px; }
.smcg-email   { color:#059669; font-size:11px; font-weight:500; }

.smcg-actions { display:flex; align-items:center; justify-content:center; gap:6px; flex-wrap:nowrap; }
.smcg-act {
  display:inline-flex; align-items:center; justify-content:center; gap:5px;
  height:28px; padding: 0 10px;
  border-radius:8px;
  cursor:pointer; flex-shrink:0;
  font-family: inherit; font-size: 11px; font-weight: 700;
  transition: all .18s cubic-bezier(.22,1,.36,1);
  border: 1.5px solid;
}
.smcg-act-edit  { border-color:#a7f3d0; background:#fff; color:#047857; }
.smcg-act-vault { border-color:#a7f3d0; background:#fff; color:#047857; }
.smcg-act-edit:hover  { background: linear-gradient(135deg, #34d399, #047857); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(5,150,105,.4); transform:translateY(-2px); }
.smcg-act-vault:hover { background: linear-gradient(135deg, #34d399, #047857); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(5,150,105,.4); transform:translateY(-2px); }

/* ─── Pagination ─── */
.smcg-pagination {
  display:flex; align-items:center; justify-content:space-between;
  padding: 10px 18px;
  border-top: 1.5px solid #d1fae5;
  background: linear-gradient(180deg, #ecfdf5, #f0fdf4);
  flex-shrink: 0;
  gap: 12px;
}
.smcg-pag-pages {
  font-size: 11.5px; font-weight: 700; color: #047857;
  background: #fff; border: 1.5px solid #a7f3d0;
  padding: 4px 14px; border-radius: 20px; white-space: nowrap;
}
.smcg-pag-info {
  font-size: 11.5px; font-weight: 600; color: #047857;
  background: #fff; border: 1.5px solid #a7f3d0;
  padding: 4px 14px; border-radius: 20px; white-space: nowrap;
  margin-left: auto;
}
.smcg-pag-right { display:flex; align-items:center; gap:6px; }
.smcg-pag-btn {
  width:32px; height:32px; border-radius:50%;
  border:1.5px solid #a7f3d0; background:#fff;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  color:#047857; transition: all .15s;
}
.smcg-pag-btn:hover:not(:disabled) { background:#10b981; color:#fff; border-color:#10b981; }
.smcg-pag-btn:disabled { opacity:.4; cursor:not-allowed; }

@media (max-width: 900px) {
  .smcg-wdh-body { flex-wrap: wrap; }
  .smcg-step { flex: 1 1 calc(50% - 12px); }
  .smcg-step-arrow { display: none; }
}

/* ─── Dark mode overrides ─── */
[data-bs-theme="dark"] .smcg-root {
  background: linear-gradient(160deg, #0a1f1a 0%, #0f2a23 40%, #103129 100%);
  color: #d1fae5;
}
[data-bs-theme="dark"] .smcg-cstrip {
  background: linear-gradient(110deg, #064e3b 0%, #047857 45%, #059669 100%);
  border-color: rgba(16,185,129,.40);
  box-shadow: 0 2px 0 rgba(255,255,255,.10) inset, 0 8px 28px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .smcg-wdh {
  background: linear-gradient(110deg, #0f2a23 0%, #103129 50%, #134e3a 100%);
  border-color: rgba(16,185,129,.30);
}
[data-bs-theme="dark"] .smcg-wdh-title { color: #ecfdf5; }
[data-bs-theme="dark"] .smcg-wdh-subtitle { color: #6ee7b7; }
[data-bs-theme="dark"] .smcg-wdh-toggle {
  background: rgba(255,255,255,.06);
  border-color: rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .smcg-step {
  background: #103129;
  border-color: rgba(16,185,129,.25);
  border-left-color: #10b981;
}
[data-bs-theme="dark"] .smcg-step-name { color: #ecfdf5; }
[data-bs-theme="dark"] .smcg-step-desc { color: #9aa9a4; }
[data-bs-theme="dark"] .smcg-step-tag  { color: #6ee7b7; }
[data-bs-theme="dark"] .smcg-step-arrow-dot {
  background: #103129;
  border-color: rgba(16,185,129,.40);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smcg-search {
  background: rgba(255,255,255,.04);
  border-color: rgba(16,185,129,.30);
}
[data-bs-theme="dark"] .smcg-search input { color: #ecfdf5; }
[data-bs-theme="dark"] .smcg-search input::placeholder { color: #6b8a7e; }
[data-bs-theme="dark"] .smcg-table-card {
  background: #103129;
  border-color: rgba(16,185,129,.30);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .smcg-table thead tr {
  background: linear-gradient(110deg, #064e3b 0%, #047857 40%, #059669 75%, #10b981 100%);
}
[data-bs-theme="dark"] .smcg-table tbody td {
  border-bottom-color: rgba(16,185,129,.18);
  color: #d1fae5;
}
[data-bs-theme="dark"] .smcg-table tbody tr.odd  td { background: rgba(6,78,59,.30); }
[data-bs-theme="dark"] .smcg-table tbody tr.even td { background: rgba(15,42,35,.50); }
[data-bs-theme="dark"] .smcg-table tbody tr:hover td {
  background: linear-gradient(90deg, rgba(16,185,129,.18), rgba(52,211,153,.15), rgba(16,185,129,.18)) !important;
}
[data-bs-theme="dark"] .smcg-srno {
  background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .smcg-id-chip {
  background: linear-gradient(135deg, rgba(6,78,59,.45), rgba(4,120,87,.50));
  color: #6ee7b7; border-color: rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .smcg-cust-chip {
  background: linear-gradient(135deg, rgba(76,45,138,.45), rgba(45,27,86,.50));
  color: #c4b5fd; border-color: rgba(167,139,250,.40);
}
[data-bs-theme="dark"] .smcg-company { color: #f0fdf4; }
[data-bs-theme="dark"] .smcg-seg {
  background: linear-gradient(135deg, rgba(6,78,59,.40), rgba(4,120,87,.50));
  color: #6ee7b7; border-color: rgba(16,185,129,.30);
}
[data-bs-theme="dark"] .smcg-country     { color: #ecfdf5; }
[data-bs-theme="dark"] .smcg-country-sub { color: #94a3b8; }
[data-bs-theme="dark"] .smcg-contact { color: #e2e8f0; }
[data-bs-theme="dark"] .smcg-mono    { color: #94a3b8; }
[data-bs-theme="dark"] .smcg-email   { color: #6ee7b7; }
[data-bs-theme="dark"] .smcg-act-edit,
[data-bs-theme="dark"] .smcg-act-vault {
  background: rgba(255,255,255,.04);
  border-color: rgba(16,185,129,.35);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smcg-pagination {
  background: linear-gradient(180deg, #0a1f1a, #0f2a23);
  border-top-color: rgba(16,185,129,.20);
}
[data-bs-theme="dark"] .smcg-pag-pages,
[data-bs-theme="dark"] .smcg-pag-info {
  background: rgba(255,255,255,.04);
  border-color: rgba(16,185,129,.30);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smcg-pag-btn {
  background: rgba(255,255,255,.04);
  border-color: rgba(16,185,129,.30);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smcg-pag-btn:hover:not(:disabled) {
  background: #10b981; color: #fff; border-color: #10b981;
}
`;
