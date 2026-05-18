import { Fragment, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
<<<<<<< HEAD
import { useAuth } from '../../contexts/AuthContext';
=======
import Tooltip from '../../components/ui/Tooltip';
>>>>>>> cbde0625864e6e411a1aa9ed113266185ee80e0f
import AddCustomerModal, { type EditCustomer } from './AddCustomerModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Customers
 *
 * Native React port of the customer list page from Customer_Flow.html.
 * Visual fidelity to the original: purple-gradient hero strip, "What We Are
 * Doing Here" 4-step explainer, Fresh/Recurring tab pills, search, premium
 * table with row chips, and footer pagination. Action buttons render but
 * surface a "coming next" toast — the 3-stage Add Customer modal, Map
 * Consignee modal, and Evidence Vault drawer ship in follow-up passes.
 *
 * No DB yet: rows below mirror the dataset in the design and the API stub
 * at CustomerController. Swap for `api.get('/customers')` once the table
 * migration lands.
 * ──────────────────────────────────────────────────────────────────────── */

type Customer = {
  id: string; company: string; type: string; segment: string;
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No'; consignees: number;
};

const FRESH: Customer[] = [
  { id:'C-001', company:'Shree Exports Pvt Ltd',      type:'Retailer',   segment:'Dry Fruits',     country:'India', contact:'Yash Mote',        phone:'+91-9011033444', email:'yash@shreeexports.com',       whatsapp:'Yes', consignees:3 },
  { id:'C-002', company:'GreenHarvest Global',         type:'Exporter',   segment:'Agro',           country:'India', contact:'Ravi Vardhan',     phone:'+91-9123456789', email:'ravi@greenharvestglobal.com', whatsapp:'Yes', consignees:5 },
  { id:'C-003', company:'GreenHarvest Agri-Exports',   type:'Exporter',   segment:'Rice & Grains',  country:'India', contact:'Ravi Mishra',      phone:'+91-9898989800', email:'ravi@greenharvest.com',       whatsapp:'No',  consignees:2 },
  { id:'C-004', company:'International Buyer LLC',     type:'Wholesaler', segment:'Spices',         country:'UAE',   contact:'Ahmed Al-Farsi',   phone:'+971-501234567', email:'ahmed@intlbuyer.ae',          whatsapp:'Yes', consignees:4 },
  { id:'C-005', company:'QuickTrade Resellers',        type:'Reseller',   segment:'Pulses',         country:'India', contact:'Deepak Jain',      phone:'+91-9001122334', email:'deepak@quicktrade.com',       whatsapp:'No',  consignees:1 },
  { id:'C-006', company:'Fit Nation Pvt Ltd',          type:'Wholesaler', segment:'Dry Fruits',     country:'India', contact:'Durgesh Urkude',   phone:'+91-7218663502', email:'durgesh@fitnation.in',        whatsapp:'Yes', consignees:2 },
  { id:'C-007', company:'Manoj Jacob Foods',           type:'Exporter',   segment:'Coconut Oil',    country:'India', contact:'Manoj Jacob',      phone:'+91-9876543210', email:'manoj@mjfoods.in',            whatsapp:'No',  consignees:3 },
  { id:'C-008', company:'FreshMart Retailers',         type:'Retailer',   segment:'Basmati Rice',   country:'India', contact:'Ankit Sharma',     phone:'+91-9876512345', email:'ankit@freshmart.com',         whatsapp:'Yes', consignees:1 },
  { id:'C-009', company:'Bharat Agro Traders',         type:'Wholesaler', segment:'Millets',        country:'India', contact:'Suresh Patil',     phone:'+91-9765432109', email:'suresh@bharatagro.com',       whatsapp:'Yes', consignees:4 },
  { id:'C-010', company:'Eastern Harvest Co.',         type:'Exporter',   segment:'Coffee Beans',   country:'India', contact:'Priya Nair',       phone:'+91-9654321098', email:'priya@easternharvest.in',     whatsapp:'No',  consignees:2 },
  { id:'C-011', company:'Sun Agri Exports',            type:'Exporter',   segment:'Turmeric',       country:'India', contact:'Vikram Desai',     phone:'+91-9543210987', email:'vikram@sunagri.com',          whatsapp:'Yes', consignees:3 },
  { id:'C-012', company:'Prime Foods UAE',             type:'Retailer',   segment:'Spices',         country:'UAE',   contact:'Khalid Mansoor',   phone:'+971-561234567', email:'khalid@primefoods.ae',        whatsapp:'Yes', consignees:2 },
  { id:'C-013', company:'KM Naturals',                 type:'Retailer',   segment:'Cashew',         country:'India', contact:'Kavitha Menon',    phone:'+91-9432109876', email:'kavitha@kmnaturals.in',       whatsapp:'No',  consignees:1 },
  { id:'C-014', company:'Horizon Agro Pvt Ltd',        type:'Wholesaler', segment:'Rice & Grains',  country:'India', contact:'Rohit Singh',      phone:'+91-9321098765', email:'rohit@horizonagro.com',       whatsapp:'Yes', consignees:5 },
  { id:'C-015', company:'NatureFirst Exports',         type:'Exporter',   segment:'Organic Spices', country:'India', contact:'Sneha Kulkarni',   phone:'+91-9210987654', email:'sneha@naturefirst.com',       whatsapp:'Yes', consignees:3 },
];

const RECURRING: Customer[] = [
  { id:'C-016', company:'Apex Food Processors',        type:'Reseller',   segment:'Spices',         country:'India', contact:'Rajesh Varma',     phone:'+91-9825012345', email:'procurement@apexfoods.in',    whatsapp:'No',  consignees:6 },
  { id:'C-017', company:'Spice Route Traders',         type:'Exporter',   segment:'Spices',         country:'India', contact:'Meena Iyer',       phone:'+91-9123456780', email:'meena@spiceroute.com',        whatsapp:'Yes', consignees:8 },
  { id:'C-018', company:'Delta Agro Exports',          type:'Wholesaler', segment:'Pulses',         country:'India', contact:'Ramesh Kulkarni',  phone:'+91-9234567891', email:'ramesh@deltaagro.in',         whatsapp:'No',  consignees:4 },
  { id:'C-019', company:'Sunrise Foods International', type:'Retailer',   segment:'Coconut Oil',    country:'India', contact:'Kavitha Nair',     phone:'+91-9345678902', email:'kavitha@sunrisefoods.com',    whatsapp:'Yes', consignees:7 },
  { id:'C-020', company:'Global Grain Co.',            type:'Exporter',   segment:'Rice & Grains',  country:'India', contact:'Arjun Pillai',     phone:'+91-9456789013', email:'arjun@globalgrains.com',      whatsapp:'No',  consignees:5 },
  { id:'C-021', company:'Pacific Traders FZE',         type:'Wholesaler', segment:'Agro',           country:'China', contact:'Zhang Wei',        phone:'+86-1381234567', email:'zhang@pacifictraders.cn',     whatsapp:'Yes', consignees:9 },
  { id:'C-022', company:'Al-Hassan Foods LLC',         type:'Exporter',   segment:'Dry Fruits',     country:'UAE',   contact:'Fatima Al-Hassan', phone:'+971-551234567', email:'fatima@alhassanfoods.ae',     whatsapp:'Yes', consignees:6 },
  { id:'C-023', company:'Raza Exports',                type:'Exporter',   segment:'Basmati Rice',   country:'India', contact:'Ayesha Raza',      phone:'+91-9567890124', email:'ayesha@razaexports.com',      whatsapp:'Yes', consignees:4 },
  { id:'C-024', company:'Bianchi Imports',             type:'Wholesaler', segment:'Coffee Beans',   country:'Italy', contact:'Luca Bianchi',     phone:'+39-0212345678', email:'luca@bianchiimports.it',      whatsapp:'No',  consignees:3 },
  { id:'C-025', company:'Wei Imports Shanghai',        type:'Retailer',   segment:'Spices',         country:'China', contact:'Wei Xiaoming',     phone:'+86-2112345678', email:'wei@weiimports.cn',           whatsapp:'Yes', consignees:5 },
  { id:'C-026', company:'Martinez Trading Co.',        type:'Exporter',   segment:'Mango Pulp',     country:'Spain', contact:'Jose Martinez',    phone:'+34-911234567',  email:'jose@martineztrading.es',     whatsapp:'No',  consignees:2 },
  { id:'C-027', company:'Agro Fresh Ltd',              type:'Retailer',   segment:'Organic Spices', country:'India', contact:'Priya Sharma',     phone:'+91-9678901235', email:'priya@agrofresh.in',          whatsapp:'Yes', consignees:7 },
  { id:'C-028', company:'Gulf Food Traders LLC',       type:'Wholesaler', segment:'Dry Fruits',     country:'UAE',   contact:'Omar Al-Rashid',   phone:'+971-571234567', email:'omar@gulffood.ae',            whatsapp:'Yes', consignees:8 },
  { id:'C-029', company:'Nwosu Agro Industries',       type:'Exporter',   segment:'Cashew',         country:'Nigeria', contact:'Amara Nwosu',    phone:'+234-8012345678',email:'amara@nwosuagro.ng',          whatsapp:'No',  consignees:3 },
  { id:'C-030', company:'BrightHarvest Global',        type:'Exporter',   segment:'Turmeric',       country:'India', contact:'Carlos Rivera',    phone:'+91-9789012346', email:'carlos@brightharvest.com',    whatsapp:'Yes', consignees:6 },
];

const TYPE_COLORS: Record<string, { bg: string; color: string; border: string; dot: string }> = {
  'Retailer':   { bg:'#eff6ff', color:'#1e40af', border:'#bfdbfe', dot:'#3b82f6' },
  'Exporter':   { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0', dot:'#22c55e' },
  'Reseller':   { bg:'#fef3f2', color:'#b91c1c', border:'#fecaca', dot:'#ef4444' },
  'Wholesaler': { bg:'#fffbeb', color:'#b45309', border:'#fed7aa', dot:'#f59e0b' },
};

const ROWS_PER_PAGE = 10;

export default function SalesCustomers() {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  // Match the Permissions sheet exactly: the row is keyed by the leaf slug
  // `sales.customers` and exposes can_view/add/edit/delete/etc. as booleans.
  // Super_admin bypasses (they hold the master grant).
  const customerPerm = user?.permissions?.['sales.customers'];
  const canView   = isSuperAdmin || !!customerPerm?.can_view;
  const canAdd    = isSuperAdmin || !!customerPerm?.can_add;
  const canEdit   = isSuperAdmin || !!customerPerm?.can_edit;

  const [tab, setTab] = useState<'fresh' | 'recurring'>('fresh');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [wdhOpen, setWdhOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditCustomer | null>(null);

  // Inject Google Fonts (DM Sans, Inter) once on mount so the design renders
  // with its intended typography even on a fresh install.
  useEffect(() => {
    const id = 'sm-customers-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = useMemo(() => {
    const src = tab === 'fresh' ? FRESH : RECURRING;
    if (!q) return src;
    const lo = q.toLowerCase();
    return src.filter(c =>
      c.company.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.contact.toLowerCase().includes(lo) ||
      c.email.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo),
    );
  }, [tab, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * ROWS_PER_PAGE;
  const rows = filtered.slice(startIdx, startIdx + ROWS_PER_PAGE);

  const switchTab = (next: 'fresh' | 'recurring') => { setTab(next); setPage(1); };
  const onSearch = (v: string) => { setQ(v); setPage(1); };

  const soon = (label: string) => toast.info(label, 'Coming in next phase');

  // Hard-stop direct URL access for users whose Permissions sheet doesn't
  // include sales.customers.can_view. The Sidebar already hides the link, but
  // this catches /sales/customers typed straight into the address bar.
  if (!canView) {
    return (
      <div className="smc-root">
        <style>{SCOPED_CSS}</style>
        <div className="smc-cstrip">
          <div className="smc-cstrip-left">
            <div>
              <div className="smc-title">No access</div>
              <div className="smc-sub">You don't have permission to view Customers. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → Customers.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="smc-root">
      <style>{SCOPED_CSS}</style>

      {/* Hero strip */}
      <div className="smc-cstrip">
        <span className="smc-accent" />
        <span className="smc-glow" />
        <span className="smc-sheen" />
        <div className="smc-cstrip-left">
          <div className="smc-avatar-wrap">
            <div className="smc-avatar"><IconUsers /></div>
            <span className="smc-online-dot" />
          </div>
          <div>
            <div className="smc-title">Customers</div>
            <div className="smc-sub">Manage customer onboarding and lifecycle with strict compliance, KYC verification, and product mapping for sales readiness.</div>
          </div>
        </div>
        <div className="smc-cstrip-right">
          {canAdd && (
            <button className="smc-add-btn" onClick={() => { setEditing(null); setAddOpen(true); }}>
              <span className="smc-add-sheen" />
              <IconPlus />
              Add Customer
            </button>
          )}
        </div>
      </div>

      {/* What We Are Doing Here */}
      <div className="smc-wdh">
        <div className="smc-wdh-header" onClick={() => setWdhOpen(o => !o)} role="button">
          <div className="smc-wdh-head-left">
            <div className="smc-wdh-icon"><IconUsers /></div>
            <span className="smc-wdh-title">Customers — What We Are Doing Here:</span>
          </div>
          <button className="smc-wdh-toggle" onClick={(e) => { e.stopPropagation(); setWdhOpen(o => !o); }}>
            {wdhOpen ? <IconChevronUp /> : <IconChevronDown />}
          </button>
        </div>
        {wdhOpen && (
          <div className="smc-wdh-body">
            {STEPS.map((s, i) => (
              <Fragment key={s.n}>
                <div className="smc-step">
                  <div className="smc-step-head">
                    <div className="smc-step-num">{s.n}</div>
                    <span className="smc-step-name">{s.name}</span>
                  </div>
                  <p className="smc-step-desc">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="smc-step-arrow"><div className="smc-step-arrow-dot"><IconChevronRight /></div></div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Table card */}
      <div className="smc-table-card">
        <div className="smc-tabs-bar">
          <div className="smc-pill-group">
            <button className={`smc-pill ${tab === 'fresh' ? 'on' : 'off'}`} onClick={() => switchTab('fresh')}>
              <IconUserPlus /> Fresh Customers
            </button>
            <button className={`smc-pill ${tab === 'recurring' ? 'on' : 'off'}`} onClick={() => switchTab('recurring')}>
              <IconRepeat /> Recurring Customers
            </button>
          </div>
          <div className="smc-search">
            <IconSearch />
            <input
              type="text"
              placeholder="Search by name, ID, company, email, segment..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="smc-table-wrap">
          <table className="smc-table">
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Customer ID</th>
                <th>Company Name</th>
                <th>Customer Type</th>
                <th>Segment</th>
                <th>Country</th>
                <th>Contact Person</th>
                <th>Contact No</th>
                <th>Email</th>
                <th className="ta-c">WhatsApp</th>
                <th className="ta-c">Consignees</th>
                <th className="ta-c">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} className="smc-empty">No customers found</td></tr>
              )}
              {rows.map((c, i) => {
                const t = TYPE_COLORS[c.type] || { bg:'#f3f0ff', color:'#6d28d9', border:'#ddd6fe', dot:'#7c3aed' };
                return (
                  <tr key={c.id} className={i % 2 === 0 ? 'even' : 'odd'}>
                    <td><span className="smc-srno">{startIdx + i + 1}</span></td>
                    <td><span className="smc-id-chip">{c.id}</span></td>
                    <td><span className="smc-company">{c.company}</span></td>
                    <td>
                      <span className="smc-type-pill" style={{ background:t.bg, color:t.color, borderColor:t.border }}>
                        <span className="smc-type-dot" style={{ background:t.dot, boxShadow:`0 0 4px ${t.dot}66` }} />
                        {c.type}
                      </span>
                    </td>
                    <td><span className="smc-seg">{c.segment}</span></td>
                    <td className="smc-country">{c.country}</td>
                    <td className="smc-contact">{c.contact}</td>
                    <td className="smc-mono">{c.phone}</td>
                    <td className="smc-email">{c.email}</td>
                    <td className="ta-c">
                      {c.whatsapp === 'Yes'
                        ? <span className="smc-wa yes"><span className="smc-wa-dot" />Yes</span>
                        : <span className="smc-wa no"><span className="smc-wa-dot" />No</span>}
                    </td>
                    <td className="ta-c"><span className="smc-cons">{c.consignees}</span></td>
                    <td className="ta-c">
                      <div className="smc-actions">
<<<<<<< HEAD
                        {canEdit && (
                          <button title="Edit Customer" className="smc-act smc-act-edit" onClick={() => { setEditing(c); setAddOpen(true); }}><IconEdit /></button>
                        )}
                        <button title="Map Consignee" className="smc-act smc-act-map"  onClick={() => soon('Map Consignee')}><IconUsersSm /></button>
                        <button title="Customer Evidence Vault" className="smc-act smc-act-vault" onClick={() => soon('Evidence Vault')}><IconFile /></button>
=======
                        <Tooltip label="Edit Customer">
                          <button aria-label="Edit Customer" className="smc-act smc-act-edit" onClick={() => { setEditing(c); setAddOpen(true); }}><IconEdit /></button>
                        </Tooltip>
                        <Tooltip label="Map Consignee">
                          <button aria-label="Map Consignee" className="smc-act smc-act-map"  onClick={() => soon('Map Consignee')}><IconUsersSm /></button>
                        </Tooltip>
                        <Tooltip label="Customer Evidence Vault">
                          <button aria-label="Customer Evidence Vault" className="smc-act smc-act-vault" onClick={() => soon('Evidence Vault')}><IconFile /></button>
                        </Tooltip>
>>>>>>> cbde0625864e6e411a1aa9ed113266185ee80e0f
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="smc-pagination">
          <span className="smc-pag-info">
            {total === 0 ? 'No records' : `Showing ${startIdx + 1}–${Math.min(startIdx + ROWS_PER_PAGE, total)} of ${total}`}
          </span>
          <div className="smc-pag-right">
            <span className="smc-pag-range">{safePage} / {pages}</span>
            <button className="smc-pag-btn" disabled={safePage <= 1}  onClick={() => setPage(p => Math.max(1, p - 1))}><IconChevronLeft /></button>
            <button className="smc-pag-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}><IconChevronRight /></button>
          </div>
        </div>
      </div>

      <AddCustomerModal
        open={addOpen}
        customer={editing}
        onClose={() => { setAddOpen(false); setEditing(null); }}
      />
    </div>
  );
}

/* ─── 4-step "What we are doing here" content ─── */
const STEPS: { n: number; name: string; desc: string }[] = [
  { n: 1, name: 'Create Customer',  desc: 'Add basic company, contact, and legal details to create the customer profile.' },
  { n: 2, name: 'Customer KYC',     desc: 'Check documents, identity, GST scrutiny & compliance to validate customer authenticity.' },
  { n: 3, name: 'Trade Document',   desc: 'Execute agreements digitally to make the customer legally approved for trade.' },
  { n: 4, name: 'Product Mapping',  desc: 'Link customer with products, pricing, and tax details for sales use.' },
];

/* ─── Inline SVG icons (Lucide-style stroke) ─── */
const IconUsers = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconUsersSm = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 11 12 6 17 11" /><polyline points="7 18 12 13 17 18" />
  </svg>
);
const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
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
const IconUserPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconRepeat = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.1" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconEdit = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);
const IconFile = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

/* ─── Scoped page CSS (all rules under .smc-root) ─── */
const SCOPED_CSS = `
.smc-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 40%, #ede9fe 100%);
  padding: 14px 18px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 10px;
  color: #1e293b;
}
.smc-root *, .smc-root *::before, .smc-root *::after { box-sizing: border-box; }

/* ─── Hero strip ─── */
.smc-cstrip {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  min-height: 66px; padding: 0 18px;
  border: 1px solid #c4b5fd; border-radius: 16px;
  background: linear-gradient(110deg, #faf5ff 0%, #f3e8ff 25%, #ede9fe 55%, #ddd6fe 85%, #c4b5fd 100%);
  box-shadow:
    0 2px 0 rgba(255,255,255,.85) inset,
    0 8px 28px rgba(139,92,246,.2),
    0 2px 8px rgba(0,0,0,.06);
  flex-shrink: 0;
}
.smc-accent {
  position: absolute; left:0; top:0; bottom:0; width:4px;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
  border-radius: 16px 0 0 16px;
}
.smc-glow {
  position: absolute; inset:0; pointer-events:none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(196,181,253,.45) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(167,139,250,.25) 0%, transparent 55%);
}
.smc-sheen {
  position: absolute; top:0; left:0; right:0; height:50%; pointer-events:none;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
  border-radius: 16px 16px 0 0;
}
.smc-cstrip-left  { display:flex; align-items:center; gap:13px; z-index:1; padding-left:4px; }
.smc-avatar-wrap  { position: relative; flex-shrink: 0; }
.smc-avatar {
  width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%);
  box-shadow: 0 0 0 3px rgba(139,92,246,.25), 0 4px 14px rgba(124,58,237,.45);
}
.smc-online-dot {
  position:absolute; bottom:-1px; right:-1px;
  width:10px; height:10px; border-radius:50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border:2px solid #f3e8ff; box-shadow:0 2px 4px rgba(34,197,94,.4);
}
.smc-title { font-size:14.5px; font-weight:800; color:#3b0764; letter-spacing:-.4px; line-height:1.2; }
.smc-sub   { font-size:11.5px; color:#6b7280; font-weight:400; margin-top:2px; line-height:1.4; }

.smc-cstrip-right { display:flex; align-items:center; gap:7px; z-index:1; flex-shrink:0; }
.smc-add-btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 26px; height: 44px;
  border: none; border-radius: 14px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  color: #fff; letter-spacing: .01em; white-space: nowrap; cursor: pointer;
  background: #7c3aed;
  box-shadow:
    0 6px 20px rgba(124,58,237,.5),
    0 2px 6px rgba(91,33,182,.3),
    0 1px 0 rgba(255,255,255,.18) inset;
  transition: background .18s, transform .18s, box-shadow .18s;
}
.smc-add-btn:hover {
  background: #6d28d9; transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(124,58,237,.6), 0 3px 8px rgba(91,33,182,.35), 0 1px 0 rgba(255,255,255,.18) inset;
}
.smc-add-btn:active { transform: translateY(0); background: #5b21b6; }
.smc-add-sheen {
  position: absolute; top:0; left:0; right:0; height:48%; pointer-events:none;
  background: linear-gradient(180deg, rgba(255,255,255,.15), transparent);
  border-radius: 14px 14px 0 0;
}

/* ─── What We Are Doing Here ─── */
.smc-wdh {
  position: relative;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(139,92,246,.1);
  flex-shrink: 0;
}
.smc-wdh-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; min-height: 46px;
  cursor: pointer; user-select: none; position: relative; z-index: 1;
}
.smc-wdh-head-left { display:flex; align-items:center; gap:9px; }
.smc-wdh-icon {
  width:28px; height:28px; border-radius:8px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  display:flex; align-items:center; justify-content:center;
  color:#fff; flex-shrink:0; box-shadow:0 3px 10px rgba(124,58,237,.4);
}
.smc-wdh-title { font-size:13px; font-weight:800; color:#3b0764; letter-spacing:-.3px; }
.smc-wdh-toggle {
  width:28px; height:28px; border-radius:50%;
  border:1.5px solid rgba(124,58,237,.25); background: rgba(255,255,255,.7);
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; transition: background .15s;
}
.smc-wdh-toggle:hover { background: rgba(255,255,255,.95); }
.smc-wdh-body {
  display:flex; align-items:stretch; gap:0; padding: 7px 14px 9px;
  position: relative; z-index: 1;
}
.smc-step {
  flex:1; min-width:0;
  background:#fff; border:1.5px solid #e8e4f9; border-left:3px solid #7c3aed;
  border-radius:10px; padding:9px 12px;
  display:flex; flex-direction:column; gap:4px;
}
.smc-step-head { display:flex; align-items:center; gap:8px; }
.smc-step-num {
  width:22px; height:22px; border-radius:50%;
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  display:flex; align-items:center; justify-content:center;
  color:#fff; font-size:10px; font-weight:800; line-height:1;
  flex-shrink:0; box-shadow:0 2px 6px rgba(124,58,237,.3);
}
.smc-step-name { font-size:11.5px; font-weight:700; color:#5b21b6; letter-spacing:-.2px; line-height:1.2; }
.smc-step-desc { font-size:10.5px; color:#6b7280; font-weight:400; line-height:1.45; margin:0; }
.smc-step-arrow {
  display:flex; align-items:center; justify-content:center; flex-shrink:0; width:24px;
}
.smc-step-arrow-dot {
  width:20px; height:20px; border-radius:50%;
  background:#fff; border:1.5px solid #ddd6fe;
  display:flex; align-items:center; justify-content:center;
  color:#a78bfa;
  box-shadow:0 1px 4px rgba(124,58,237,.08);
}

/* ─── Table card ─── */
.smc-table-card {
  background: #fff;
  border: 1.5px solid #c4b5fd; border-radius: 18px;
  box-shadow: 0 8px 32px rgba(109,40,217,.13), 0 2px 8px rgba(109,40,217,.07);
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.smc-tabs-bar {
  padding: 10px 16px;
  border-bottom: 2px solid #c4b5fd;
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(110deg, #f5f0ff 0%, #ede9fe 50%, #ddd6fe 100%);
}
.smc-pill-group {
  display:flex; align-items:center; gap:2px;
  background: rgba(255,255,255,.5);
  border: 1.5px solid #c4b5fd; border-radius: 12px;
  padding: 4px; backdrop-filter: blur(4px);
  box-shadow: 0 2px 8px rgba(109,40,217,.1);
  flex-shrink: 0;
}
.smc-pill {
  display:inline-flex; align-items:center; gap:6px;
  padding: 7px 18px; height: 32px;
  border: none; border-radius: 9px;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .2s cubic-bezier(.22,1,.36,1);
  letter-spacing: -.1px; white-space: nowrap;
}
.smc-pill.on  { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.smc-pill.off { background: transparent; color: #5b21b6; }
.smc-pill.off:hover { background: rgba(255,255,255,.6); }

.smc-search {
  flex: 1;
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,.85);
  border: 1.5px solid #c4b5fd; border-radius: 12px;
  padding: 8px 16px;
  box-shadow: 0 2px 8px rgba(109,40,217,.08), 0 1px 0 rgba(255,255,255,.9) inset;
  backdrop-filter: blur(4px);
  transition: border-color .2s, box-shadow .2s;
}
.smc-search:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.15), 0 2px 8px rgba(109,40,217,.1);
}
.smc-search input {
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12.5px; color: #3b0764;
  width: 100%; font-weight: 500;
}
.smc-search input::placeholder { color: #a78bfa; }

/* ─── Table ─── */
.smc-table-wrap { overflow: auto; flex: 1; min-height: 0; }
.smc-table {
  width: 100%; min-width: 1100px;
  border-collapse: collapse;
  font-size: 12px;
}
.smc-table thead tr {
  background: linear-gradient(110deg, #6d28d9 0%, #7c3aed 40%, #8b5cf6 75%, #a78bfa 100%);
  box-shadow: 0 2px 8px rgba(109,40,217,.2);
}
.smc-table thead th {
  padding: 9px 8px;
  font-size: 9.5px; font-weight: 800;
  color: rgba(255,255,255,.95);
  text-transform: uppercase; letter-spacing: .08em;
  text-align: left; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.smc-table thead th:first-child { padding-left: 14px; }
.smc-table thead th.ta-c { text-align: center; }
.smc-table tbody td {
  padding: 7px 8px;
  font-size: 11.5px;
  border-bottom: 1px solid #e8e0ff;
  vertical-align: middle;
  white-space: nowrap;
}
.smc-table tbody td:first-child { padding-left: 14px; }
.smc-table tbody td.ta-c { text-align: center; }
.smc-table tbody tr.odd  td { background: linear-gradient(180deg, rgba(237,233,254,.35), rgba(221,214,254,.25)); }
.smc-table tbody tr.even td { background: rgba(250,245,255,.6); }
.smc-table tbody tr:hover td { background: linear-gradient(90deg, rgba(196,181,253,.25), rgba(167,139,250,.2), rgba(196,181,253,.25)) !important; }
.smc-table tbody tr:last-child td { border-bottom: none; }
.smc-empty { text-align: center; padding: 32px !important; color: #a78bfa; font-size: 12px; font-style: italic; }

.smc-srno {
  display:inline-flex; align-items:center; justify-content:center;
  width:20px; height:20px; border-radius:6px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color:#fff; font-size:9px; font-weight:800;
  box-shadow: 0 2px 6px rgba(109,40,217,.3);
}
.smc-id-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 800; color: #5b21b6;
  background: linear-gradient(135deg, #faf5ff, #ede9fe);
  padding: 2px 8px; border-radius: 6px;
  border: 1px solid #c4b5fd; letter-spacing: .02em;
}
.smc-company { font-weight:700; color:#1e1b4b; letter-spacing:-.1px; }
.smc-type-pill {
  display:inline-flex; align-items:center; gap:4px;
  padding:2px 9px; border-radius:20px;
  font-size:9.5px; font-weight:800;
  border:1px solid; white-space:nowrap;
  box-shadow:0 1px 3px rgba(0,0,0,.06);
}
.smc-type-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
.smc-seg {
  display:inline-flex; align-items:center; gap:4px;
  font-size:10.5px; font-weight:600; color:#5b21b6;
  background: linear-gradient(135deg, rgba(237,233,254,.8), rgba(221,214,254,.6));
  border:1px solid #c4b5fd; border-radius:20px; padding:2px 9px; white-space:nowrap;
}
.smc-seg::before { content:''; width:4px; height:4px; border-radius:50%; background:#7c3aed; flex-shrink:0; }
.smc-country { color:#475569; font-weight:500; }
.smc-contact { font-weight:600; color:#4b5563; }
.smc-mono    { font-family: monospace; color:#64748b; font-size:11px; }
.smc-email   { color:#6d28d9; font-size:10.5px; font-weight:500; }
.smc-wa {
  display:inline-flex; align-items:center; gap:4px;
  padding:2px 9px; border-radius:20px;
  font-size:10px; font-weight:700;
}
.smc-wa.yes { background: linear-gradient(135deg, #dcfce7, #bbf7d0); color:#047857; border:1px solid #6ee7b7; }
.smc-wa.no  { background: linear-gradient(135deg, #fee2e2, #fecaca); color:#b91c1c; border:1px solid #fca5a5; }
.smc-wa-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; background: currentColor; }
.smc-cons {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:24px; height:20px; border-radius:20px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color:#fff; font-size:10px; font-weight:800; padding:0 7px;
  box-shadow:0 2px 6px rgba(109,40,217,.3); letter-spacing:.02em;
}
.smc-actions { display:flex; align-items:center; justify-content:center; gap:4px; flex-wrap:nowrap; }
.smc-act {
  width:24px; height:24px; border-radius:7px;
  display:inline-flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; padding:0;
  transition: all .18s cubic-bezier(.22,1,.36,1);
  border: 1.5px solid;
}
.smc-act-edit  { border-color:#93c5fd; background: linear-gradient(135deg, #eff6ff, #dbeafe); color:#1d4ed8; }
.smc-act-map   { border-color:#6ee7b7; background: linear-gradient(135deg, #ecfdf5, #d1fae5); color:#047857; }
.smc-act-vault { border-color:#d8b4fe; background: linear-gradient(135deg, #faf5ff, #ede9fe); color:#7c3aed; }
.smc-act-edit:hover  { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(29,78,216,.4); transform:translateY(-2px) scale(1.08); }
.smc-act-map:hover   { background: linear-gradient(135deg, #34d399, #059669); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(5,150,105,.4);  transform:translateY(-2px) scale(1.08); }
.smc-act-vault:hover { background: linear-gradient(135deg, #a855f7, #6d28d9); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(109,40,217,.5); transform:translateY(-2px) scale(1.08); }

/* ─── Pagination ─── */
.smc-pagination {
  display:flex; align-items:center; justify-content:space-between;
  padding: 9px 16px;
  border-top: 1.5px solid #ede9fe;
  background: linear-gradient(180deg, #faf5ff, #f5f3ff);
  flex-shrink: 0;
}
.smc-pag-info {
  font-size: 11.5px; font-weight: 600; color: #7c3aed;
  background: #fff; border: 1.5px solid #ddd6fe;
  padding: 3px 12px; border-radius: 20px;
}
.smc-pag-right { display:flex; align-items:center; gap:6px; }
.smc-pag-range {
  font-size: 11.5px; font-weight: 700; color: #5b21b6;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border: 1.5px solid #c4b5fd;
  padding: 3px 14px; border-radius: 20px; white-space: nowrap;
}
.smc-pag-btn {
  width:28px; height:28px; border-radius:50%;
  border:1.5px solid #ddd6fe; background:#fff;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  color:#7c3aed; transition: all .15s;
}
.smc-pag-btn:hover:not(:disabled) { background:#7c3aed; color:#fff; }
.smc-pag-btn:disabled { opacity:.4; cursor:not-allowed; }

@media (max-width: 900px) {
  .smc-wdh-body { flex-wrap: wrap; }
  .smc-step { flex: 1 1 calc(50% - 12px); }
  .smc-step-arrow { display: none; }
}
`;
