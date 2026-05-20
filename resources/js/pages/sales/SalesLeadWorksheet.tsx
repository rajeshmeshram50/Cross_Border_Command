import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Worksheet (My Workplace)
 *
 * Faithful port of the prototype's `#lwPage` (SalesMatrix_v4_9, line 9239) —
 * the cyan/teal "My Workplace" landing page that lists all leads with bulk
 * selection, per-row actions, and a CTQ ("Convert to Qualified") flow for
 * disqualified leads.
 *
 * Data: mock for now — 27 sample leads matching prototype `window.LW_LEADS`
 * (line 21402). Wire to `api.get('/sales/leads')` once the table migration
 * lands.
 *
 * Perm-gated on `sales.lead_worksheet` — super_admin bypasses. The permission
 * key needs to exist in the seeder for non-admin users to view this page.
 * ──────────────────────────────────────────────────────────────────────── */

type LeadStatus = 'qualified' | 'disqualified';
type TabKey     = 'qualified' | 'disqualified' | 'all';

type Lead = {
  type: string;
  date: string;
  source: string;
  assigned: string;       // 'Unassigned' or a person's name
  oppId: string;          // OPP-001
  customer: string;
  phone: string;
  email: string;
  product: string;        // '—' for empty
  company: string;        // '—' for empty
  country: string;        // ISO-2 code
  status: LeadStatus;
};

const TAB_LABELS: Record<TabKey, string> = {
  qualified:    'Qualified Leads',
  disqualified: 'Disqualified Leads',
  all:          'All Leads',
};

const SAMPLE_LEADS: Lead[] = [
  // QUALIFIED
  { type:'Manual',          date:'10/04/2026', source:'Offline',  assigned:'Shreeyash Rajaram Mote', oppId:'OPP-001', customer:'GreenHarvest Global',  phone:'+91 91234 56789', email:'r.vardhan@gmail.com',         product:'—',                       company:'GreenHarvest Global', country:'IN', status:'qualified' },
  { type:'Manual',          date:'07/04/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-002', customer:'Shree Exports',         phone:'9011033444',      email:'shreeyashmote@gmail.com',     product:'—',                       company:'Shree',               country:'IN', status:'qualified' },
  { type:'PNS Calls',       date:'07/04/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-003', customer:'Aadi Trading',          phone:'+91-9315093788',  email:'N/A',                         product:'1 Kg Jasmine Rice',       company:'—',                   country:'IN', status:'qualified' },
  { type:'Direct Enquiries',date:'06/04/2026', source:'Agrotech', assigned:'Durgesh Urkude',         oppId:'OPP-004', customer:'Abdelrahman Mujahed',   phone:'+962-786919870',  email:'aboodmujahed6@gmail.com',     product:'Natural Turkish Dry Fig', company:'—',                   country:'JO', status:'qualified' },
  { type:'Direct Enquiries',date:'06/04/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-005', customer:'Dharminder Singh',      phone:'+61-422930900',   email:'dsarpanch55@gmail.com',       product:'Mushroom',                company:'—',                   country:'AU', status:'qualified' },
  { type:'Direct Enquiries',date:'06/04/2026', source:'Agrotech', assigned:'Bhavika',                oppId:'OPP-006', customer:'UDAY PATEL',            phone:'+44-7984011050',  email:'N/A',                         product:'Suvin Cotton',            company:'—',                   country:'UK', status:'qualified' },
  { type:'Direct Enquiries',date:'06/04/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-007', customer:'Bittu Kumar Chaudhari', phone:'N/A',             email:'bittu89035@gmail.com',        product:'Mushroom',                company:'—',                   country:'US', status:'qualified' },
  { type:'Direct Enquiries',date:'05/04/2026', source:'Agrotech', assigned:'Rahul Sharma',           oppId:'OPP-008', customer:'Zhang Wei',             phone:'+86-13812345678', email:'zhangwei@example.com',        product:'Basmati Rice',            company:'Wei Imports',         country:'CN', status:'qualified' },
  { type:'PNS Calls',       date:'05/04/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-009', customer:'James Okoye',           phone:'+234-8012345678', email:'james.okoye@mail.com',        product:'Cashew',                  company:'—',                   country:'NG', status:'qualified' },
  { type:'Manual',          date:'04/04/2026', source:'Agrotech', assigned:'Priya Mehta',            oppId:'OPP-010', customer:'Ayesha Raza',           phone:'+92-3012345678',  email:'ayesha.raza@pk.com',          product:'Mango Pulp',              company:'Raza Exports',        country:'PK', status:'qualified' },
  { type:'PNS Calls',       date:'03/04/2026', source:'Agrotech', assigned:'Ankit Verma',            oppId:'OPP-011', customer:'Fatima Al-Hassan',      phone:'+966-512345678',  email:'fatima.hassan@sa.com',        product:'Brown Rice',              company:'Al-Hassan Foods',     country:'SA', status:'qualified' },
  { type:'Direct Enquiries',date:'02/04/2026', source:'Offline',  assigned:'Sneha Patil',            oppId:'OPP-012', customer:'Luca Bianchi',          phone:'+39-3456789012',  email:'luca.bianchi@it.com',         product:'Organic Turmeric',        company:'Bianchi Imports',     country:'IT', status:'qualified' },
  { type:'Manual',          date:'01/04/2026', source:'Agrotech', assigned:'Vikram Desai',           oppId:'OPP-013', customer:'Ahmed Al-Farsi',        phone:'+971-501234567',  email:'ahmed.farsi@ae.com',          product:'Saffron Grade A',         company:'Al-Farsi Trading',    country:'AE', status:'qualified' },
  { type:'PNS Calls',       date:'31/03/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-014', customer:'Park Ji-Young',         phone:'+82-1012345678',  email:'jiyoung.park@kr.com',         product:'Black Sesame Seeds',      company:'—',                   country:'KR', status:'qualified' },
  // DISQUALIFIED
  { type:'Direct Enquiries',date:'04/04/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-015', customer:'Karl Hofmann',          phone:'+49-17612345678', email:'karl.hofmann@de.com',         product:'Spices Mix',              company:'—',                   country:'DE', status:'disqualified' },
  { type:'PNS Calls',       date:'03/04/2026', source:'Agrotech', assigned:'Durgesh Urkude',         oppId:'OPP-016', customer:'Sarah Patel',           phone:'+1-4155551234',   email:'sarah.patel@us.com',          product:'Turmeric Powder',         company:'Patel Foods',         country:'US', status:'disqualified' },
  { type:'Manual',          date:'03/04/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-017', customer:'Mohamed Aziz',          phone:'+20-1012345678',  email:'m.aziz@eg.net',               product:'Cotton Yarn',             company:'—',                   country:'EG', status:'disqualified' },
  { type:'Direct Enquiries',date:'02/04/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-018', customer:'Ivan Petrov',           phone:'+7-9123456789',   email:'ivan.petrov@ru.com',          product:'Wheat Flour',             company:'—',                   country:'RU', status:'disqualified' },
  { type:'Manual',          date:'01/04/2026', source:'Offline',  assigned:'Rahul Sharma',           oppId:'OPP-019', customer:'Amara Nwosu',           phone:'+234-9087654321', email:'amara.nwosu@ng.com',          product:'Palm Oil',                company:'Nwosu Agro',          country:'NG', status:'disqualified' },
  { type:'PNS Calls',       date:'31/03/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-020', customer:'Mei Ling',              phone:'+86-13998765432', email:'mei.ling@cn.com',             product:'Green Tea',               company:'—',                   country:'CN', status:'disqualified' },
  { type:'Direct Enquiries',date:'30/03/2026', source:'Offline',  assigned:'Priya Mehta',            oppId:'OPP-021', customer:'Jose Martinez',         phone:'+52-5512345678',  email:'jose.martinez@mx.com',        product:'Coffee Beans',            company:'Martinez Trading',    country:'MX', status:'disqualified' },
  { type:'Manual',          date:'29/03/2026', source:'Agrotech', assigned:'Unassigned',             oppId:'OPP-022', customer:'Olga Kowalski',         phone:'+48-501234567',   email:'olga.kowalski@pl.com',        product:'Rye Flour',               company:'—',                   country:'PL', status:'disqualified' },
  { type:'PNS Calls',       date:'28/03/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-023', customer:'Hassan El-Amin',        phone:'+216-20123456',   email:'hassan.elamin@tn.com',        product:'Olive Oil',               company:'El-Amin Exports',     country:'TN', status:'disqualified' },
  { type:'Direct Enquiries',date:'27/03/2026', source:'Agrotech', assigned:'Bhavika',                oppId:'OPP-024', customer:'Nadia Bouchard',        phone:'+33-612345678',   email:'nadia.bouchard@fr.com',       product:'Lavender Oil',            company:'—',                   country:'FR', status:'disqualified' },
  { type:'Manual',          date:'26/03/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-025', customer:'Tariq Al-Rashid',       phone:'+965-51234567',   email:'tariq.rashid@kw.com',         product:'Dates Premium',           company:'Al-Rashid Group',     country:'KW', status:'disqualified' },
  { type:'PNS Calls',       date:'25/03/2026', source:'Agrotech', assigned:'Ankit Verma',            oppId:'OPP-026', customer:'Sofia Andersen',        phone:'+45-20123456',    email:'sofia.andersen@dk.com',       product:'Barley Malt',             company:'—',                   country:'DK', status:'disqualified' },
  { type:'Direct Enquiries',date:'24/03/2026', source:'Offline',  assigned:'Unassigned',             oppId:'OPP-027', customer:'Ravi Krishnamurthy',    phone:'+91-9987654321',  email:'ravi.km@in.com',              product:'Coconut Oil',             company:'KM Naturals',         country:'IN', status:'disqualified' },
];

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

const initials = (name: string): string => {
  if (!name || name === 'Unassigned') return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
};

export default function SalesLeadWorksheet() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.lead_worksheet'];
  // Until the permission is seeded, any authenticated user can preview the
  // new design. Once `sales.lead_worksheet` lands in the seeder, swap the
  // fallback for `false` to enforce the gate.
  const canView   = isSuperAdmin || perm?.can_view !== false;
  const canAdd    = isSuperAdmin || !!perm?.can_add;
  const canAssign = isSuperAdmin || !!perm?.can_edit;

  const [leads]         = useState<Lead[]>(SAMPLE_LEADS);
  const [tab, setTab]   = useState<TabKey>('qualified');
  const [q, setQ]       = useState('');
  const [rpp, setRpp]   = useState(10);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // CTQ confirmation modal
  const [ctqLead, setCtqLead] = useState<Lead | null>(null);

  // Inject Google Fonts (DM Sans + Inter) once on mount — matches the
  // pattern used by the other ported Sales pages.
  useEffect(() => {
    const id = 'sm-lwp-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  // Filter + paginate
  const filtered = useMemo(() => {
    let rows = leads;
    if (tab !== 'all') rows = rows.filter(l => l.status === tab);
    if (q) {
      const lo = q.toLowerCase();
      rows = rows.filter(l =>
        l.customer.toLowerCase().includes(lo) ||
        l.oppId.toLowerCase().includes(lo) ||
        l.assigned.toLowerCase().includes(lo) ||
        l.product.toLowerCase().includes(lo) ||
        l.email.toLowerCase().includes(lo)
      );
    }
    return rows;
  }, [leads, tab, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  // Page-level select-all checkbox state
  const pageIds = rows.map(r => r.oppId);
  const allChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked = pageIds.some(id => selected.has(id));

  const switchTab = (next: TabKey) => {
    setTab(next);
    setPage(1);
    setSelected(new Set());
  };

  const toggleRow = (oppId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(oppId)) next.delete(oppId);
      else next.add(oppId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) pageIds.forEach(id => next.add(id));
      else pageIds.forEach(id => next.delete(id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /* ── Stub action handlers (toast-only until real flows ship) ── */
  const stubToast = (msg: string) => toast.info('Coming next', msg);

  const onAddLead       = () => stubToast('Add New Lead modal — coming next');
  const onAssignLeads   = () => stubToast('Assign Leads — opens the Assign Leads modal');
  const onLeadDistr     = () => stubToast('Lead Distribution page — coming next');
  const onFilter        = () => stubToast('Filter modal — coming next');
  // Opens the Sales Matrix detail page (Stage 1) for this opportunity.
  // The clicked row travels in router state so the detail page can render
  // the customer header without a second fetch.
  const openMatrixDetail = (l: Lead) => {
    navigate(`/sales/matrix/${l.oppId}/stage/1`, {
      state: {
        row: {
          oppId:        l.oppId,
          customer:     l.customer,
          customerCode: `C-${l.oppId.replace(/^OPP-/, '')}`,
          date:         l.date,
          country:      l.country,
        },
      },
    });
  };

  const onViewLead      = (l: Lead) => openMatrixDetail(l);
  const onAssignOne     = (l: Lead) => stubToast(`Assign lead ${l.oppId} to a salesperson`);
  const onOpenLead      = (l: Lead) => openMatrixDetail(l);
  const onOpenOpp       = (oppId: string) => {
    const lead = SAMPLE_LEADS.find(l => l.oppId === oppId);
    if (lead) openMatrixDetail(lead);
  };
  const onBulkAssign    = () => stubToast(`Bulk-assign ${selected.size} leads`);
  const onBulkCTQ       = () => stubToast(`Bulk-convert ${selected.size} leads to Qualified`);

  // CTQ for disqualified — opens confirmation, then "converts" (toast).
  const onAskCTQ      = (l: Lead) => setCtqLead(l);
  const onConfirmCTQ  = () => {
    if (!ctqLead) return;
    toast.success('Converted', `${ctqLead.oppId} would be moved to Qualified`);
    setCtqLead(null);
  };

  /* ── No-access early return ── */
  if (!canView) {
    return (
      <div className="lwp-root">
        <style>{SCOPED_CSS}</style>
        <div className="lwp-no-access">
          <div className="lwp-no-access-title">No access</div>
          <div className="lwp-no-access-sub">
            You don't have permission to view the Lead Worksheet. Ask your branch admin to
            grant <strong>can_view</strong> on Sales Matrix → Lead Worksheet.
          </div>
        </div>
      </div>
    );
  }

  const showBulkCTQ = tab === 'disqualified' && selected.size > 0;

  return (
    <div className="lwp-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Page header banner ── */}
      <div className="lwp-banner">
        <span className="lwp-banner-accent" />
        <span className="lwp-banner-glow" />
        <span className="lwp-banner-sheen" />

        <div className="lwp-banner-left">
          <div className="lwp-banner-icon-wrap">
            <div className="lwp-banner-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <span className="lwp-banner-dot" />
          </div>
          <div>
            <div className="lwp-banner-title">My Workplace</div>
            <div className="lwp-banner-entity"><span>Sales Matrix</span></div>
          </div>
        </div>

        <div className="lwp-actions">
          {canAdd && (
            <button className="lwp-bact lwp-bact-primary" onClick={onAddLead}>
              <IconPlus />
              Add New Lead
            </button>
          )}
          {canAssign && (
            <button className="lwp-bact lwp-bact-assign" onClick={onAssignLeads}>
              <IconUsers />
              Assign Leads
            </button>
          )}
          <button className="lwp-bact lwp-bact-assigned" onClick={onLeadDistr}>
            <IconUserCheck />
            Lead Distribution
          </button>
          <span className="lwp-banner-divider" />
          <button className="lwp-bact lwp-bact-filter" title="Filter Leads" onClick={onFilter}>
            <IconFilter />
            Filter
          </button>
        </div>
      </div>

      {/* ── Tabs + Search ── */}
      <div className="lwp-pre-table">
        <div className="lwp-pills">
          {(Object.keys(TAB_LABELS) as TabKey[]).map(t => (
            <div
              key={t}
              className={`lwp-pill ${tab === t ? 'active' : ''}`}
              onClick={() => switchTab(t)}
            >
              {TAB_LABELS[t]}
            </div>
          ))}
        </div>
        <div className="lwp-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search ID / Product / Assignee…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="lwp-table-card">
        <div className="lwp-table-wrap">
          <table className="lwp-table">
            <colgroup>
              <col className="c-chk" /><col className="c-type" /><col className="c-date" /><col className="c-source" />
              <col className="c-assign" /><col className="c-wa" /><col className="c-opp" />
              <col className="c-cust" /><col className="c-phone" /><col className="c-email" />
              <col className="c-prod" /><col className="c-company" /><col className="c-country" />
              <col className="c-action" />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center', paddingLeft: 14 }}>
                  <input
                    type="checkbox"
                    title="Select all leads on this page"
                    className="lwp-chk"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={e => togglePage(e.target.checked)}
                  />
                </th>
                <th>Lead Type</th><th>Lead Date</th><th>Lead Source</th>
                <th>Assigned To</th><th>WhatsApp Status</th>
                <th style={{ textAlign: 'center' }}>Opportunity ID</th>
                <th>Customer Name</th><th>Customer Number</th><th>Customer Email</th>
                <th>Product Name</th><th>Company</th><th>Country</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="lwp-empty">No leads found</td>
                </tr>
              )}
              {rows.map(l => {
                const ua = l.assigned === 'Unassigned';
                const isChecked = selected.has(l.oppId);
                return (
                  <tr
                    key={l.oppId}
                    onClick={() => onOpenLead(l)}
                    style={isChecked ? { background: 'rgba(124,58,237,.05)' } : undefined}
                  >
                    <td style={{ textAlign: 'center', paddingLeft: 14 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="lwp-chk"
                        checked={isChecked}
                        onChange={() => toggleRow(l.oppId)}
                      />
                    </td>
                    <td style={{ color: '#64748b' }}>{l.type}</td>
                    <td style={{ color: '#64748b' }}>{l.date}</td>
                    <td style={{ color: '#64748b' }}>{l.source}</td>
                    <td>
                      <div className="lwp-asgn">
                        <div className={`lwp-av-xs ${ua ? 'u' : ''}`}>{initials(l.assigned)}</div>
                        <span style={{ color: ua ? '#94a3b8' : '#1e293b', fontWeight: ua ? 400 : 500 }}>
                          {ua ? 'Unassigned' : l.assigned}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="lwp-wa-badge"><span className="lwp-wa-dot" />Pending</span>
                    </td>
                    <td>
                      <span
                        className="lwp-opp-link"
                        onClick={e => { e.stopPropagation(); onOpenOpp(l.oppId); }}
                      >{l.oppId}</span>
                    </td>
                    <td><span className="lwp-cust-name">{l.customer}</span></td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>{l.phone}</td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>{l.email}</td>
                    <td style={{ color: '#64748b' }}>
                      {l.product === '—' ? <span style={{ color: '#cbd5e1' }}>—</span> : l.product}
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {l.company === '—' ? <span style={{ color: '#cbd5e1' }}>—</span> : l.company}
                    </td>
                    <td><span className="lwp-ctag">{l.country}</span></td>
                    <td>
                      <div className="lwp-action-btns">
                        <Tooltip label="View Lead Details">
                          <button
                            className="lwp-ab lwp-ab-view"
                            aria-label="View Lead Details"
                            onClick={e => { e.stopPropagation(); onViewLead(l); }}
                          >
                            <IconEye />
                          </button>
                        </Tooltip>
                        {canAssign && (
                          <Tooltip label="Assign Lead">
                            <button
                              className="lwp-ab lwp-ab-assign"
                              aria-label="Assign Lead"
                              onClick={e => { e.stopPropagation(); onAssignOne(l); }}
                            >
                              <IconAssign />
                            </button>
                          </Tooltip>
                        )}
                        {l.status === 'disqualified' && (
                          <Tooltip label="Convert to Qualified">
                            <button
                              className="lwp-ab-ctq"
                              aria-label="Convert to Qualified"
                              onClick={e => { e.stopPropagation(); onAskCTQ(l); }}
                            >
                              CTQ
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="lwp-pagination">
          <span className="lwp-pag-info">
            {total === 0
              ? 'No leads found'
              : <>Showing <span className="lwp-hl">{startIdx + 1}–{Math.min(startIdx + rpp, total)}</span> of <span className="lwp-hl">{total}</span></>}
          </span>
          <div className="lwp-pag-right">
            <div className="lwp-rows-sel">
              Rows per page:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="lwp-pag-range">{safePage} / {pages}</span>
            <div className="lwp-page-nav">
              <button className="lwp-pg-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button className="lwp-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating bulk action bar ── */}
      {selected.size > 0 && (
        <div className="lwp-bulk-bar">
          <div className="lwp-bulk-count-wrap">
            <div className="lwp-bulk-count-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <span className="lwp-bulk-count-text">{selected.size} lead{selected.size === 1 ? '' : 's'} selected</span>
          </div>
          <span className="lwp-bulk-divider" />
          <button className="lwp-bulk-btn-primary" onClick={onBulkAssign}>
            <IconUsers />
            Assign Selected Leads
          </button>
          {showBulkCTQ && (
            <button className="lwp-bulk-btn-ctq" onClick={onBulkCTQ}>
              <IconCheck />
              Convert to Qualified
            </button>
          )}
          <button className="lwp-bulk-btn-clear" onClick={clearSelection}>
            <IconX />
            Clear
          </button>
        </div>
      )}

      {/* ── CTQ Confirmation Modal ── */}
      {ctqLead && (
        <div className="lwp-ctq-overlay" onMouseDown={() => setCtqLead(null)}>
          <div className="lwp-ctq-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="lwp-ctq-header">
              <span className="lwp-ctq-header-glow" />
              <div className="lwp-ctq-header-left">
                <div className="lwp-ctq-header-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div className="lwp-ctq-header-title">Convert to Qualified</div>
                  <div className="lwp-ctq-header-sub">Lead qualification confirmation</div>
                </div>
              </div>
              <button className="lwp-ctq-close" onClick={() => setCtqLead(null)}>
                <IconX />
              </button>
            </div>
            <div className="lwp-ctq-body">
              <div className="lwp-ctq-row">
                <div className="lwp-ctq-row-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <div className="lwp-ctq-row-title">Convert this lead to Qualified?</div>
                  <div className="lwp-ctq-row-sub">
                    Lead <span className="lwp-ctq-opp">{ctqLead.oppId}</span> will be moved from{' '}
                    <span style={{ color: '#e11d48', fontWeight: 600 }}>Disqualified</span> to{' '}
                    <span style={{ color: '#059669', fontWeight: 600 }}>Qualified</span>. This action can be reversed.
                  </div>
                </div>
              </div>
              <div className="lwp-ctq-lead-info">
                <strong>{ctqLead.customer}</strong> · {ctqLead.product === '—' ? 'No product specified' : ctqLead.product} · {ctqLead.country}
              </div>
              <div className="lwp-ctq-actions">
                <button className="lwp-ctq-btn-cancel" onClick={() => setCtqLead(null)}>Cancel</button>
                <button className="lwp-ctq-btn-confirm" onClick={onConfirmCTQ}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 5, verticalAlign: 'middle' }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Convert to Qualified
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Icons ─── */
const IconPlus = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconUsers = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconUserCheck = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <line x1="17" y1="11" x2="22" y2="11" />
  </svg>
);
const IconFilter = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="5" x2="21" y2="5" /><circle cx="8" cy="5" r="2" fill="currentColor" stroke="none" />
    <line x1="3" y1="12" x2="21" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <line x1="3" y1="19" x2="21" y2="19" /><circle cx="10" cy="19" r="2" fill="currentColor" stroke="none" />
  </svg>
);
const IconEye = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconAssign = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ─── Scoped CSS — faithful port of prototype #lwPage block, rescoped to .lwp-root ─── */
const SCOPED_CSS = `
.lwp-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #f0fdfe 0%, #e8fafb 30%, #f5feff 60%, #ffffff 100%);
  padding: 12px 20px 12px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 0;
  color: #111827;
  font-size: 13.5px;
  position: relative;
}
.lwp-root *, .lwp-root *::before, .lwp-root *::after { box-sizing: border-box; }

.lwp-no-access {
  background: #fff; border: 1.5px solid #a5f3fc; border-radius: 14px;
  padding: 28px 24px; text-align: center;
  box-shadow: 0 2px 10px rgba(8,145,178,.08);
}
.lwp-no-access-title { font-size: 16px; font-weight: 800; color: #0e7490; }
.lwp-no-access-sub   { font-size: 12px; color: #64748b; margin-top: 8px; line-height: 1.55; max-width: 540px; margin-left: auto; margin-right: auto; }

/* ─── Banner ─── */
.lwp-root .lwp-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  min-height: 58px; padding: 0 20px; margin-bottom: 10px;
  border: 1px solid #cef3f9; border-radius: 16px;
  background: linear-gradient(110deg, #f0fdff 0%, #e6fafe 25%, #d0f5fb 55%, #bef0f8 85%, #a8eaf5 100%);
  box-shadow: 0 2px 0 rgba(255,255,255,.9) inset, 0 4px 16px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  flex-shrink: 0;
}
.lwp-root .lwp-banner-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #06b6d4, #0891b2, #0e7490);
  border-radius: 16px 0 0 16px;
}
.lwp-root .lwp-banner-glow {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(190,240,248,.35) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(168,234,245,.2) 0%, transparent 55%);
}
.lwp-root .lwp-banner-sheen {
  position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
  border-radius: 16px 16px 0 0;
}
.lwp-root .lwp-banner-left {
  display: flex; align-items: center; gap: 13px;
  z-index: 1; padding-left: 10px;
}
.lwp-root .lwp-banner-icon-wrap { position: relative; flex-shrink: 0; }
.lwp-root .lwp-banner-icon {
  width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  box-shadow: 0 0 0 3px rgba(8,145,178,.25), 0 4px 14px rgba(14,116,144,.45);
  border: none;
}
.lwp-root .lwp-banner-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #cffafe;
  box-shadow: 0 2px 4px rgba(34,197,94,.4);
}
.lwp-root .lwp-banner-title {
  font-size: 14.5px; font-weight: 800;
  color: #0c4a6e; letter-spacing: -.4px; line-height: 1.2;
}
.lwp-root .lwp-banner-entity {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px; padding: 1px 9px;
  background: rgba(255,255,255,.6);
  border: 1px solid rgba(8,145,178,.35);
  border-radius: 20px;
}
.lwp-root .lwp-banner-entity::before {
  content: ""; width: 4px; height: 4px; border-radius: 50%; background: #0891b2;
}
.lwp-root .lwp-banner-entity > span {
  font-size: 8.5px; color: #155e75;
  font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
}
.lwp-root .lwp-banner-divider {
  width: 1px; height: 30px; margin: 0 3px;
  background: linear-gradient(to bottom, transparent, rgba(8,145,178,.3) 40%, rgba(8,145,178,.3) 60%, transparent);
}
.lwp-root .lwp-actions {
  display: flex; align-items: center; gap: 7px;
  flex-shrink: 0; z-index: 1;
}
.lwp-root .lwp-bact {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 20px; border-radius: 12px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; white-space: nowrap; transition: all .22s;
  letter-spacing: .02em; min-height: 42px; border: none;
}
.lwp-root .lwp-bact-primary {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-primary:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.55), 0 3px 8px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.22) inset;
}
.lwp-root .lwp-bact-assign {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(8,145,178,.4), 0 2px 6px rgba(14,116,144,.22), 0 1px 0 rgba(255,255,255,.18) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-assign:hover {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(8,145,178,.5), 0 3px 8px rgba(14,116,144,.28), 0 1px 0 rgba(255,255,255,.18) inset;
}
.lwp-root .lwp-bact-assigned {
  background: linear-gradient(135deg, #0e7490 0%, #155e75 55%, #164e63 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(14,116,144,.4), 0 2px 6px rgba(21,94,117,.22), 0 1px 0 rgba(255,255,255,.15) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-assigned:hover {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(14,116,144,.5), 0 3px 8px rgba(21,94,117,.28), 0 1px 0 rgba(255,255,255,.15) inset;
}
.lwp-root .lwp-bact-filter {
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 40%, #06b6d4 100%);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(6,182,212,.4), 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.2) inset;
  position: relative; overflow: hidden;
  animation: lwpFilterPulse 2.5s ease-in-out infinite;
}
.lwp-root .lwp-bact-filter::before {
  content: '';
  position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);
  animation: lwpFilterShimmer 2.2s ease-in-out infinite;
}
@keyframes lwpFilterShimmer { 0%{left:-60%} 55%{left:120%} 100%{left:120%} }
@keyframes lwpFilterPulse {
  0%,100% { box-shadow: 0 0 0 2px rgba(6,182,212,.4), 0 4px 16px rgba(6,182,212,.45), 0 1px 0 rgba(255,255,255,.2) inset; }
  50%     { box-shadow: 0 0 0 4px rgba(6,182,212,.2), 0 6px 24px rgba(6,182,212,.6), 0 1px 0 rgba(255,255,255,.2) inset; }
}
.lwp-root .lwp-bact-filter:hover {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%);
  transform: translateY(-2px);
  box-shadow: 0 0 0 3px rgba(6,182,212,.5), 0 8px 28px rgba(6,182,212,.6), 0 1px 0 rgba(255,255,255,.2) inset;
}

/* ─── Pre-table: pills + search ─── */
.lwp-root .lwp-pre-table {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px; flex-shrink: 0;
}
.lwp-root .lwp-pills {
  display: flex; align-items: center; gap: 4px;
  background: linear-gradient(110deg, #ecfeff 0%, #cffafe 50%, #a5f3fc 100%);
  padding: 5px; border-radius: 14px;
  border: 1.5px solid #a5f3fc;
  box-shadow: 0 2px 10px rgba(8,145,178,.12), 0 1px 0 rgba(255,255,255,.9) inset;
  min-height: 50px;
}
.lwp-root .lwp-pill {
  padding: 9px 20px; border-radius: 10px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  background: transparent; color: #0e7490;
  border: none; transition: all .18s; white-space: nowrap;
  min-height: 40px; display: inline-flex; align-items: center; gap: 6px;
}
.lwp-root .lwp-pill:hover { color: #0891b2; background: rgba(255,255,255,.6); }
.lwp-root .lwp-pill.active {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  border-radius: 10px;
}
.lwp-root .lwp-search {
  display: flex; align-items: center;
  background: #ffffff;
  border: 1.5px solid #a5f3fc;
  border-radius: 14px; padding: 0 18px; gap: 10px;
  width: 380px; max-width: 100%; height: 50px;
  box-shadow: 0 2px 10px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
  transition: all .2s;
}
.lwp-root .lwp-search:focus-within {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8,145,178,.15), 0 4px 16px rgba(8,145,178,.15);
}
.lwp-root .lwp-search input {
  border: none; background: transparent; font-family: inherit;
  font-size: 12.5px; color: #0c4a6e; outline: none; width: 100%; font-weight: 500;
}
.lwp-root .lwp-search input::placeholder { color: #94a3b8; font-weight: 400; }

/* ─── Table card ─── */
.lwp-root .lwp-table-card {
  background: #fff;
  border: 1.5px solid #a5f3fc;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
}
.lwp-root .lwp-table-wrap {
  overflow-x: auto; overflow-y: auto; width: 100%;
  flex: 1; min-height: 0;
  scrollbar-width: thin;
}
.lwp-root .lwp-table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
.lwp-root .lwp-table col.c-chk    { width: 42px; }
.lwp-root .lwp-table col.c-type   { width: 110px; }
.lwp-root .lwp-table col.c-date   { width: 88px; }
.lwp-root .lwp-table col.c-source { width: 86px; }
.lwp-root .lwp-table col.c-assign { width: 130px; }
.lwp-root .lwp-table col.c-wa     { width: 100px; }
.lwp-root .lwp-table col.c-opp    { width: 96px; }
.lwp-root .lwp-table col.c-cust   { width: 140px; }
.lwp-root .lwp-table col.c-phone  { width: 118px; }
.lwp-root .lwp-table col.c-email  { width: 160px; }
.lwp-root .lwp-table col.c-prod   { width: 120px; }
.lwp-root .lwp-table col.c-company{ width: 100px; }
.lwp-root .lwp-table col.c-country{ width: 56px; }
.lwp-root .lwp-table col.c-action { width: 130px; }

.lwp-root .lwp-table thead tr {
  background: linear-gradient(90deg, #155e75 0%, #0e7490 25%, #0891b2 55%, #06b6d4 80%, #22d3ee 100%);
  box-shadow: 0 2px 10px rgba(8,145,178,.3);
}
.lwp-root .lwp-table thead th {
  color: #fff; font-size: 8px; font-weight: 700;
  text-align: left; padding: 10px 8px;
  white-space: nowrap; letter-spacing: .07em; text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,.2);
  overflow: hidden; text-overflow: ellipsis;
}
.lwp-root .lwp-table thead th:first-child { padding-left: 0; text-align: center; width: 42px; }
.lwp-root .lwp-table thead th:last-child  { text-align: center; }
.lwp-root .lwp-table tbody tr {
  border-bottom: 1px solid #ecfeff;
  transition: background .12s; cursor: pointer;
}
.lwp-root .lwp-table tbody tr:nth-child(even) { background: #f7fffe; }
.lwp-root .lwp-table tbody tr:last-child { border-bottom: none; }
.lwp-root .lwp-table tbody tr:hover { background: #ecfeff; }
.lwp-root .lwp-table tbody td {
  padding: 0 8px; color: #475569;
  height: 44px; vertical-align: middle; font-size: 10.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;
}
.lwp-root .lwp-table tbody td:first-child { padding: 0; text-align: center; }
.lwp-root .lwp-table tbody td:last-child  { overflow: visible; text-align: center; padding: 0 6px; }
.lwp-root .lwp-table tbody td:nth-child(13) { text-align: center; padding: 0 4px; }
.lwp-root .lwp-empty {
  text-align: center !important; padding: 40px 12px !important;
  color: #94a3b8 !important; font-style: italic;
}

.lwp-root .lwp-chk {
  width: 15px; height: 15px;
  accent-color: #7c3aed; cursor: pointer; border-radius: 4px;
}

/* ─── Row sub-elements ─── */
.lwp-root .lwp-opp-link { color: #0891b2; font-weight: 600; cursor: pointer; display: block; text-align: center; }
.lwp-root .lwp-opp-link:hover { text-decoration: underline; color: #0e7490; }
.lwp-root .lwp-cust-name { font-weight: 600; color: #0f172a; }
.lwp-root .lwp-wa-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: 20px; font-size: 10px; font-weight: 600;
  background: #fef3c7; color: #92400e;
}
.lwp-root .lwp-wa-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity:.8; flex-shrink:0; }
.lwp-root .lwp-asgn { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.lwp-root .lwp-asgn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.lwp-root .lwp-av-xs {
  width: 20px; height: 20px; border-radius: 50%;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-size: 7.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-root .lwp-av-xs.u { background: #e2e8f0; color: #94a3b8; }

.lwp-root .lwp-ctag {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 10px; border-radius: 8px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .04em;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff; border: none;
  box-shadow: 0 2px 8px rgba(8,145,178,.35), 0 1px 0 rgba(255,255,255,.2) inset;
  min-width: 32px;
}

.lwp-root .lwp-action-btns {
  display: flex; gap: 5px; flex-wrap: nowrap;
  align-items: center; justify-content: center;
}
.lwp-root .lwp-ab {
  width: 26px; height: 26px; border-radius: 7px; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .18s; flex-shrink: 0; padding: 0;
}
.lwp-root .lwp-ab-view {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff; box-shadow: 0 2px 6px rgba(6,182,212,.35);
}
.lwp-root .lwp-ab-view:hover {
  background: linear-gradient(135deg, #22d3ee, #06b6d4);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(6,182,212,.5);
}
.lwp-root .lwp-ab-assign {
  background: linear-gradient(135deg, #0e7490, #155e75);
  color: #fff; box-shadow: 0 2px 6px rgba(14,116,144,.35);
}
.lwp-root .lwp-ab-assign:hover {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(14,116,144,.5);
}
.lwp-root .lwp-ab-ctq {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff; border: none; border-radius: 7px;
  padding: 0 8px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .18s; flex-shrink: 0;
  font-size: 8.5px; font-weight: 800; white-space: nowrap; letter-spacing: .05em;
  box-shadow: 0 2px 6px rgba(245,158,11,.35);
}
.lwp-root .lwp-ab-ctq:hover {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(245,158,11,.5);
}

/* ─── Pagination ─── */
.lwp-root .lwp-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 2px solid #a5f3fc;
  flex-wrap: wrap; gap: 8px; flex-shrink: 0;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 40%, #ecfeff 100%);
  border-radius: 0 0 13px 13px;
}
.lwp-root .lwp-pag-info {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 500; color: #0e7490;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 5px 14px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lwp-root .lwp-pag-info .lwp-hl { color: #0891b2; font-weight: 800; font-size: 12px; }
.lwp-root .lwp-pag-right { display: flex; align-items: center; gap: 8px; }
.lwp-root .lwp-rows-sel {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #0e7490; font-weight: 500;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lwp-root .lwp-rows-sel select {
  border: none; background: transparent; font-family: inherit;
  font-size: 11.5px; color: #0891b2; font-weight: 700; cursor: pointer; outline: none;
}
.lwp-root .lwp-pag-range {
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border: none; padding: 5px 18px; border-radius: 20px;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  white-space: nowrap;
}
.lwp-root .lwp-page-nav { display: flex; gap: 5px; }
.lwp-root .lwp-pg-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1.5px solid #a5f3fc;
  background: rgba(255,255,255,.8);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #0891b2;
  transition: all .18s;
}
.lwp-root .lwp-pg-btn:hover:not(:disabled) {
  background: #fff; border-color: #0891b2;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8,145,178,.25);
}
.lwp-root .lwp-pg-btn:disabled { opacity: .4; cursor: not-allowed; }

/* ─── Floating bulk action bar ─── */
.lwp-root .lwp-bulk-bar {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  z-index: 8900;
  background: linear-gradient(135deg, #4c1d95, #7c3aed);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(124,58,237,.45), 0 4px 14px rgba(0,0,0,.18);
  padding: 12px 20px;
  display: flex; align-items: center; gap: 14px; white-space: nowrap;
  font-family: 'DM Sans', sans-serif;
  animation: lwpBulkBarIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpBulkBarIn {
  from { opacity: 0; transform: translateX(-50%) translateY(14px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.lwp-root .lwp-bulk-count-wrap { display: flex; align-items: center; gap: 8px; }
.lwp-root .lwp-bulk-count-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: rgba(255,255,255,.18);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-root .lwp-bulk-count-text {
  font-size: 13px; font-weight: 700; color: #fff; letter-spacing: -.1px;
}
.lwp-root .lwp-bulk-divider { width: 1px; height: 20px; background: rgba(255,255,255,.25); }
.lwp-root .lwp-bulk-btn-primary {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: #fff; color: #7c3aed;
  border: none; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
}
.lwp-root .lwp-bulk-btn-primary:hover { background: #f5f3ff; }
.lwp-root .lwp-bulk-btn-ctq {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: #fef3c7; color: #b45309;
  border: 1.5px solid #fde68a; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.10);
}
.lwp-root .lwp-bulk-btn-ctq:hover { background: #fde68a; }
.lwp-root .lwp-bulk-btn-clear {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px; background: rgba(255,255,255,.14); color: #fff;
  border: 1.5px solid rgba(255,255,255,.25); border-radius: 10px;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.lwp-root .lwp-bulk-btn-clear:hover { background: rgba(255,255,255,.22); }

/* ─── CTQ confirmation modal ─── */
.lwp-ctq-overlay {
  position: fixed; inset: 0; z-index: 9500;
  background: rgba(15,23,42,.45);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-modal {
  background: #fff; border-radius: 18px; width: min(92vw, 440px);
  box-shadow: 0 24px 60px rgba(8,145,178,.2), 0 8px 24px rgba(0,0,0,.1);
  overflow: hidden;
  font-family: 'DM Sans', 'Inter', sans-serif;
  animation: lwpCtqIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpCtqIn {
  from { opacity: 0; transform: scale(.93) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
.lwp-ctq-header {
  background: linear-gradient(135deg, #0891b2, #0e7490, #155e75);
  padding: 18px 22px;
  display: flex; align-items: center; justify-content: space-between;
  position: relative; overflow: hidden;
}
.lwp-ctq-header-glow {
  position: absolute; right: -20px; top: -20px;
  width: 90px; height: 90px; border-radius: 50%;
  background: rgba(255,255,255,.07); pointer-events: none;
}
.lwp-ctq-header-left {
  display: flex; align-items: center; gap: 12px; z-index: 1;
}
.lwp-ctq-header-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,.2);
  border: 1px solid rgba(255,255,255,.3);
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-header-title {
  font-size: 14px; font-weight: 800; color: #fff; letter-spacing: -.2px;
}
.lwp-ctq-header-sub {
  font-size: 10.5px; color: rgba(255,255,255,.7); margin-top: 2px;
}
.lwp-ctq-close {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.18); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center; z-index: 1;
}
.lwp-ctq-body { padding: 24px 22px; }
.lwp-ctq-row {
  display: flex; align-items: flex-start; gap: 14px; margin-bottom: 20px;
}
.lwp-ctq-row-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #ecfeff, #cffafe);
  border: 1.5px solid #a5f3fc;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-ctq-row-title {
  font-size: 13.5px; font-weight: 700; color: #0f172a; margin-bottom: 6px;
}
.lwp-ctq-row-sub {
  font-size: 12px; color: #64748b; line-height: 1.6;
}
.lwp-ctq-opp {
  font-weight: 700; color: #0891b2; font-family: 'JetBrains Mono', monospace;
}
.lwp-ctq-lead-info {
  background: linear-gradient(110deg, #f0fdfe, #ecfeff);
  border: 1px solid #a5f3fc; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 20px;
  font-size: 12px; color: #0e7490;
}
.lwp-ctq-actions {
  display: flex; gap: 10px; justify-content: flex-end;
}
.lwp-ctq-btn-cancel {
  padding: 10px 22px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #64748b; font-family: inherit;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.lwp-ctq-btn-cancel:hover { border-color: #94a3b8; }
.lwp-ctq-btn-confirm {
  padding: 10px 24px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 3px 12px rgba(8,145,178,.4);
  transition: all .15s;
}
.lwp-ctq-btn-confirm:hover { transform: translateY(-1px); }
`;
