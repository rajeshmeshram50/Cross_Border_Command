import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddCustomerModal, { type EditCustomer } from './AddCustomerModal';
import CustomerConsigneesModal, { type CustomerLite } from './CustomerConsigneesModal';
import { Shimmer } from '../../components/ui/Shimmer';
import api from '../../api';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';

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
  id: string; db_id?: number;
  company: string; type: string; segment: string;
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No'; consignees: number;
  /* Set when at least one consignee linked to this customer was
   * created with "Same as Customer" on. Drives the warning popup
   * on the Edit Customer action. */
  hasSameAsCustomerConsignees?: boolean;
  sameAsCustomerConsigneeCount?: number;
};

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
  const navigate = useNavigate();
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
  const [wdhOpen, setWdhOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditCustomer | null>(null);
  /* "Map Consignee" popup — opened from the row action; shows every
   * consignee linked to the picked customer and lets the user add
   * more without leaving the customer list. */
  const [mapTarget, setMapTarget] = useState<CustomerLite | null>(null);
  /* Linked-consignee warning. When the user clicks Edit on a customer
   * that has at least one same-as-customer consignee mirroring its
   * Stage 1 data, we ask for confirmation before opening the wizard.
   * Empty = no popup; otherwise holds the customer being asked about. */
  const [pendingEdit, setPendingEdit] = useState<Customer | null>(null);

  /* ── Live customer list pulled from /api/customers. The previous
   * hardcoded FRESH/RECURRING arrays were a stub while the DB tables
   * didn't exist; now the table is backed by Customer + CustomerAddress
   * Eloquent models and tenant-scoped server-side. */
  const [customers, setCustomers] = useState<(Customer & { db_id?: number })[]>([]);
  const [loading, setLoading]     = useState(false);

  const fetchCustomers = useCallback(() => {
    setLoading(true);
    api.get('/customers', { params: { tab, q } })
      .then(r => {
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setCustomers(list);
      })
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [tab, q]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

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

  // The backend already filters by `q` and groups by `tab`, so the
  // page-side filter just relays whatever the API returned.
  const filtered = useMemo<Customer[]>(() => customers, [customers]);

  // TableContainer manages its own pagination, so the page-side
  // state used by the old custom table is gone now.
  const switchTab = (next: 'fresh' | 'recurring') => { setTab(next); };
  const onSearch = (v: string) => { setQ(v); };

  const soon = (label: string) => toast.info(label, 'Coming in next phase');

  /* ── Project-standard action button — same recipe as HR Employees,
   * Clients, Branches. 30×30 tile using vz-* tokens so it adapts to
   * light/dark mode automatically; on hover the border + icon shift
   * to the column-specific accent (primary / success / info / etc.).
   * Always wrapped in <Tooltip> for consistent hover hints. */
  const ActionBtn = ({ title, icon, color, onClick }: { title: string; icon: string; color: 'primary'|'success'|'info'|'danger'|'warning'; onClick: () => void }) => (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        className="btn p-0 d-inline-flex align-items-center justify-content-center"
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--vz-secondary-bg)',
          border: '1px solid var(--vz-border-color)',
          color: 'var(--vz-secondary-color)',
          transition: 'all .15s ease',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.borderColor = `var(--vz-${color})`;
          el.style.color = `var(--vz-${color})`;
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.borderColor = 'var(--vz-border-color)';
          el.style.color = 'var(--vz-secondary-color)';
        }}
        onClick={onClick}
      >
        <i className={`${icon} fs-14`} />
      </button>
    </Tooltip>
  );

  /* ── TanStack table columns. Cell renderers preserve the existing
   * type-color pills, segment chips, WhatsApp pill, and customer-ID
   * mono chip so the look stays consistent with the previous design;
   * what changes is sortable headers + standard action tiles + the
   * built-in pagination from TableContainer. */
  const columns = useMemo<any[]>(() => [
    {
      header: 'Sr No',
      id: '__sr',
      accessorFn: (_row: any, i: number) => i + 1,
      meta: { align: 'center' },
      cell: (info: any) => <span className="smc-srno">{info.row.index + 1}</span>,
      enableSorting: false,
    },
    {
      header: 'Customer ID',
      accessorKey: 'id',
      cell: (info: any) => <span className="smc-id-chip">{info.getValue()}</span>,
    },
    {
      header: 'Company Name',
      accessorKey: 'company',
      cell: (info: any) => <span className="smc-company">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Customer Type',
      accessorKey: 'type',
      cell: (info: any) => {
        const v = info.getValue() as string | null;
        if (!v) return <span className="text-muted">—</span>;
        const t = TYPE_COLORS[v] || { bg: '#f3f0ff', color: '#6d28d9', border: '#ddd6fe', dot: '#7c3aed' };
        return (
          <span className="smc-type-pill" style={{ background: t.bg, color: t.color, borderColor: t.border }}>
            {v}
          </span>
        );
      },
    },
    {
      header: 'Segment',
      accessorKey: 'segment',
      cell: (info: any) => info.getValue() ? <span className="smc-seg">{info.getValue()}</span> : <span className="text-muted">—</span>,
    },
    { header: 'Country',        accessorKey: 'country', cell: (i: any) => <span className="smc-country">{i.getValue() || '—'}</span> },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <span className="smc-contact">{i.getValue() || '—'}</span> },
    { header: 'Contact No',     accessorKey: 'phone',   cell: (i: any) => <span className="smc-mono">{i.getValue() || '—'}</span> },
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <span className="smc-email">{i.getValue() || '—'}</span> },
    {
      header: () => <div className="text-center">WhatsApp</div>,
      accessorKey: 'whatsapp',
      meta: { align: 'center' },
      cell: (info: any) => info.getValue() === 'Yes'
        ? <span className="smc-wa yes">Yes</span>
        : <span className="smc-wa no">No</span>,
    },
    {
      header: () => <div className="text-center">Consignees</div>,
      accessorKey: 'consignees',
      meta: { align: 'center' },
      cell: (info: any) => <span className="smc-cons">{Number(info.getValue() ?? 0)}</span>,
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      meta: { align: 'center' },
      enableSorting: false,
      cell: (info: any) => {
        const c = info.row.original as Customer;
        return (
          <div className="d-inline-flex align-items-center gap-2 justify-content-center">
            {canEdit && <ActionBtn title="Edit Customer"           icon="ri-pencil-line"     color="primary" onClick={() => {
              /* If the customer has any consignees mapped to it,
               * prompt before opening edit — changes here can
               * affect every downstream consignee. Customers with no
               * mapped consignees jump straight into the wizard. */
              if ((c.consignees ?? 0) > 0) {
                setPendingEdit(c);
              } else {
                setEditing(c);
                setAddOpen(true);
              }
            }} />}
                       <ActionBtn title="Map Consignee"            icon="ri-team-line"       color="success" onClick={() => {
                         if (!c.db_id) { toast.info('Save customer first', 'Map Consignee needs a saved customer record.'); return; }
                         setMapTarget({ id: c.id, db_id: c.db_id, company: c.company, country: c.country });
                       }} />
                       <ActionBtn title="Customer Evidence Vault"  icon="ri-file-shield-line" color="info"   onClick={() => soon('Evidence Vault')} />
          </div>
        );
      },
    },
  ], [canEdit]);

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
          {/* Back button — routes to the Sales Matrix landing. Falls
              back to browser history when there's no /sales route
              registered (defensive — keeps the button useful even
              outside the normal nav flow). */}
          <button
            type="button"
            className="smc-back-btn"
            aria-label="Back"
            onClick={() => navigate(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
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
          {/* Project-standard TanStack table — sortable headers + built-in
              pagination + Bootstrap row chrome. Cell renderers preserve
              the purple-themed pills / chips / mono fonts from the
              original design via the .smc-* class on tableClass. */}
          {/* Standard project table look: Bootstrap `table-light` thead,
              `align-middle table-nowrap` body. Cell renderers still
              produce the colored type pills + segment chips so the
              row reads with personality, but the chrome is the same
              clean look used in HR Employees, Clients, etc. */}
          {loading && customers.length === 0 ? (
            <CustomerListShimmer rows={ROWS_PER_PAGE} />
          ) : (
            <TableContainer
              columns={columns}
              data={filtered}
              isGlobalFilter={false}
              customPageSize={ROWS_PER_PAGE}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card border rounded"
              SearchPlaceholder="Search customers..."
            />
          )}
          {!loading && filtered.length === 0 && (
            <div className="smc-empty py-4">No customers found</div>
          )}
        </div>
      </div>

      <AddCustomerModal
        open={addOpen}
        customer={editing}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSaved={() => { fetchCustomers(); toast.success(editing ? 'Customer updated' : 'Customer added'); }}
      />

      <CustomerConsigneesModal
        open={!!mapTarget}
        customer={mapTarget}
        onClose={() => { setMapTarget(null); fetchCustomers(); }}
      />

      {/* Linked-consignee warning — appears only when the user clicks
          Edit on a customer that has at least one same-as-customer
          consignee mirroring its Stage 1 data. Confirm = open the
          wizard. Cancel = drop the pending edit, nothing else. */}
      {pendingEdit && (
        <div className="smc-confirm-overlay" onMouseDown={() => setPendingEdit(null)}>
          <div className="smc-confirm-card" onMouseDown={e => e.stopPropagation()}>
            <div className="smc-confirm-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="smc-confirm-title">Linked Consignee Alert</div>
            <div className="smc-confirm-body">
              This customer has{' '}
              {pendingEdit.consignees && pendingEdit.consignees > 1
                ? <><strong>{pendingEdit.consignees}</strong> consignees mapped to it.</>
                : <>a consignee mapped to it.</>}
              <br />
              Updating <strong>{pendingEdit.company}</strong> may also affect{' '}
              {pendingEdit.consignees && pendingEdit.consignees > 1 ? 'those linked consignees' : 'the linked consignee'}.
              <br />
              Do you want to continue?
            </div>
            <div className="smc-confirm-actions">
              <button type="button" className="smc-confirm-cancel" onClick={() => setPendingEdit(null)}>Cancel</button>
              <button
                type="button"
                className="smc-confirm-ok"
                onClick={() => { const c = pendingEdit; setPendingEdit(null); setEditing(c); setAddOpen(true); }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
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
/* ─── List-page shimmer ─────
 * Drop-in replacement for the empty TableContainer while the initial
 * /customers fetch is in flight. Mirrors the live column count + the
 * lavender header strip so the layout doesn't reflow when the real
 * data lands. Light + dark mode both inherit from app.css's
 * `.shimmer` token. */
function CustomerListShimmer({ rows = 10 }: { rows?: number }) {
  // 11 columns to match the live table: Sr No, Customer ID, Company,
  // Type, Segment, Country, Contact, Phone, Email, WhatsApp,
  // Consignees, Actions.
  const cols = 12;
  return (
    <div className="smc-shimmer-wrap">
      <div className="smc-shimmer-head">
        {Array.from({ length: cols }).map((_, i) => (
          <Shimmer key={i} height={10} width="65%" radius={4} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="smc-shimmer-row">
          {Array.from({ length: cols }).map((_, c) => (
            <Shimmer key={c} height={14} radius={6} />
          ))}
        </div>
      ))}
    </div>
  );
}

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
.smc-back-btn {
  flex-shrink: 0;
  width: 34px; height: 34px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.75);
  border: 1px solid rgba(124,58,237,.20);
  color: #6d28d9; cursor: pointer;
  transition: all .18s ease;
  box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
.smc-back-btn:hover  { background: #fff; border-color: #7c3aed; transform: translateX(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.18); }
.smc-back-btn:active { transform: translateX(-1px) scale(.97); }
[data-bs-theme="dark"] .smc-back-btn         { background: rgba(255,255,255,.06); border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .smc-back-btn:hover   { background: rgba(124,58,237,.18); border-color: #a78bfa; color: #ddd6fe; }
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

/* ─── Table ───
 * The page uses the project-standard TableContainer with
 *   tableClass="table align-middle table-nowrap"
 *   theadClass="table-light"
 * (same as HR Employees / Clients). The rules below scope a soft
 * lavender-tinted header + clean body styling so the table feels
 * integrated with the purple page chrome without going back to the
 * heavy gradient header. */
.smc-table-wrap {
  overflow: auto; flex: 1; min-height: 0;
  /* Breathing room so the table-responsive card doesn't sit flush
     against the tabs/search bar above and the pagination doesn't
     touch the bottom edge of .smc-table-card. */
  padding: 14px 14px 12px;
}

/* Card wrapper produced by divClass "table-responsive table-card border rounded".
 * Header uses a soft lavender tint that ties to the page's purple
 * chrome (hero, WDH cards, tabs bar). The cell content chips
 * provide the cell-level color; the chrome stays light + airy. */
/* ─── Table chrome — neutral, same look as Clients / HR Employees.
   The violet aesthetic comes back inside the cells via the chips
   (.smc-id-chip, .smc-type-pill, .smc-seg, .smc-wa, etc.) so the
   page still reads violet without the table itself being violet. */
.smc-table-wrap .table-responsive {
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid var(--vz-border-color) !important;
  border-radius: 10px !important;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
}
.smc-table-wrap .table {
  --bs-table-bg: transparent;
  margin-bottom: 0 !important;
}
/* Header — neutral table-light (Velzon default), matches every
   other list page in the app. */
.smc-table-wrap .table thead.table-light tr {
  background: var(--vz-light) !important;
}
.smc-table-wrap .table thead.table-light th {
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  background: transparent !important;
  color: var(--vz-secondary-color) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  letter-spacing: .02em !important;
  padding: 10px 14px !important;
  line-height: 1.3 !important;
  border-bottom: 1px solid var(--vz-border-color) !important;
  white-space: nowrap;
  text-transform: uppercase;
  vertical-align: middle !important;
}
.smc-table-wrap .table thead th i { font-size: 12px; opacity: 0.55; }
/* Body — neutral rows + neutral hover (light gray instead of lavender). */
.smc-table-wrap .table tbody tr {
  background: transparent;
  transition: background .12s ease;
}
.smc-table-wrap .table tbody tr:hover {
  background: var(--vz-light) !important;
}
.smc-table-wrap .table tbody td {
  --bs-table-bg: transparent !important;
  background: transparent !important;
  padding: 12px 14px !important;
  font-size: 13px;
  color: var(--vz-body-color);
  vertical-align: middle;
  border-bottom: 1px solid var(--vz-border-color) !important;
  white-space: nowrap;
}
.smc-table-wrap .table tbody tr:last-child td { border-bottom: none !important; }

/* Pagination strip below the table (from TableContainer) — pull the
   buttons into the purple aesthetic too. */
.smc-table-wrap .pagination .page-link {
  border-radius: 8px !important;
  margin: 0 2px;
  color: #6d28d9;
  border: 1px solid #e0d9f7;
  font-weight: 600;
}
.smc-table-wrap .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: #7c3aed;
  color: #fff;
  box-shadow: 0 2px 6px rgba(109,40,217,.25);
}
.smc-table-wrap .pagination .page-item.disabled .page-link {
  color: #c4b5fd;
  background: #faf7ff;
}

/* Dark-mode: table chrome inherits vz tokens above so it flips
   automatically. We only override the pagination active state to
   keep the violet gradient consistent with the rest of the page. */
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-link {
  background: var(--vz-secondary-bg);
  color: #c4b5fd;
  border-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item.active .page-link {
  background: linear-gradient(135deg,#6d28d9,#4c1d95);
  border-color: #7c3aed;
  color: #fff;
}
/* Action button tiles in dark mode — lavender border/icon on a
   slate background so they pop against the dark row. Inline styles
   on the button set the base; these overrides use !important to
   beat the inline values. */
[data-bs-theme="dark"] .smc-table-wrap .btn[aria-label="Edit Customer"],
[data-bs-theme="dark"] .smc-table-wrap .btn[aria-label="Map Consignee"],
[data-bs-theme="dark"] .smc-table-wrap .btn[aria-label="Customer Evidence Vault"] {
  background: #1c2531 !important;
  border-color: rgba(167,139,250,0.40) !important;
  color: #c4b5fd !important;
}

/* Legacy .smc-table rules (purple-gradient header) kept below for
   reference but no longer apply since tableClass uses "table …"
   (not smc-table) now. Safe to delete in a future cleanup. */
.smc-table {
  width: 100%; min-width: 1100px;
  border-collapse: collapse;
  font-size: 12px;
}
.smc-table thead tr,
.smc-table .smc-thead tr {
  background: linear-gradient(110deg, #6d28d9 0%, #7c3aed 40%, #8b5cf6 75%, #a78bfa 100%) !important;
  box-shadow: 0 2px 8px rgba(109,40,217,.2);
}
.smc-table thead th,
.smc-table .smc-thead th {
  padding: 12px 12px !important;
  font-size: 10px; font-weight: 800;
  color: rgba(255,255,255,.95) !important;
  background: transparent !important;
  text-transform: uppercase; letter-spacing: .08em;
  text-align: left; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
  border-bottom: none !important;
}
/* TanStack sort icons sit at the right of each header cell — keep
   them visible against the purple header. */
.smc-table .smc-thead th .ri-arrow-up-line,
.smc-table .smc-thead th .ri-arrow-down-line { color: rgba(255,255,255,.7); }
.smc-table thead th:first-child { padding-left: 14px; }
.smc-table thead th.ta-c { text-align: center; }
.smc-table tbody td {
  padding: 12px 12px;
  font-size: 12px;
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

/* List-page shimmer wrapper. CSS grid keeps each shimmer cell
 * aligned with the live column count + lavender header strip. */
.smc-shimmer-wrap {
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color, #e9ecef);
  border-radius: 8px;
  overflow: hidden;
}
.smc-shimmer-head {
  display: grid;
  grid-template-columns: 60px 110px minmax(160px, 1.5fr) 110px 130px 100px 1fr 120px 1.5fr 90px 110px 90px;
  gap: 16px;
  padding: 14px 16px;
  background: linear-gradient(180deg, #f5f0ff 0%, #ede9fe 100%);
  border-bottom: 1px solid rgba(167,139,250,.30);
}
.smc-shimmer-row {
  display: grid;
  grid-template-columns: 60px 110px minmax(160px, 1.5fr) 110px 130px 100px 1fr 120px 1.5fr 90px 110px 90px;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--vz-border-color, #f3f4f6);
  align-items: center;
}
.smc-shimmer-row:last-child { border-bottom: none; }
[data-bs-theme="dark"] .smc-shimmer-wrap { background: var(--vz-card-bg, #1e2837); border-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .smc-shimmer-head { background: linear-gradient(180deg, rgba(124,58,237,.18) 0%, rgba(124,58,237,.10) 100%); border-bottom-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .smc-shimmer-row  { border-bottom-color: rgba(255,255,255,.06); }

/* ─── Linked-consignee warning popup ─────
 * Sits above the wizard band so it can't be hidden by an open
 * AddCustomerModal. Amber accent because this is a destructive-
 * adjacent action (will propagate to children) — not the standard
 * "all good, proceed" purple. */
.smc-confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(46,16,101,.55);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
}
.smc-confirm-card {
  width: min(460px, 100%);
  background: #fff;
  border-radius: 16px;
  padding: 22px 22px 18px;
  box-shadow: 0 24px 60px rgba(46,16,101,.32);
  text-align: center;
}
.smc-confirm-icon {
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  color: #b45309;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(245,158,11,.25);
}
.smc-confirm-title {
  font-size: 17px; font-weight: 800; color: #111827; margin-bottom: 8px;
}
.smc-confirm-body {
  font-size: 13.5px; color: #4b5563; line-height: 1.55; margin-bottom: 18px;
}
.smc-confirm-body strong { color: #6d28d9; font-weight: 700; }
.smc-confirm-actions {
  display: flex; gap: 10px; justify-content: center;
}
.smc-confirm-cancel,
.smc-confirm-ok {
  flex: 1 1 0;
  padding: 10px 16px; border-radius: 10px;
  font-weight: 700; font-size: 13px;
  cursor: pointer; transition: all .15s ease;
  border: 1px solid transparent;
}
.smc-confirm-cancel {
  background: #fff; color: #4b5563;
  border-color: #e5e7eb;
}
.smc-confirm-cancel:hover { background: #f9fafb; border-color: #d1d5db; }
.smc-confirm-ok {
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
}
.smc-confirm-ok:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124,58,237,.40); }
[data-bs-theme="dark"] .smc-confirm-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .smc-confirm-card    { background: #1e1b4b; }
[data-bs-theme="dark"] .smc-confirm-title   { color: #ede9fe; }
[data-bs-theme="dark"] .smc-confirm-body    { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-confirm-body strong { color: #ddd6fe; }
[data-bs-theme="dark"] .smc-confirm-cancel  { background: #2e1065; color: #c4b5fd; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .smc-confirm-cancel:hover { background: rgba(124,58,237,.18); }

/* Sr No + Consignees — plain dark text (no badge bubble). Matches
   the Admin Clients table where the row number is rendered as a
   simple numeric value, not a colored chip. */
.smc-srno { color: #495057; font-weight: 600; font-size: 13px; }
.smc-cons { color: #495057; font-weight: 600; font-size: 13px; }

/* Customer ID — soft violet mono chip. Restrained — no gradient or
   heavy shadow, just a clean pill so the ID stays readable but
   doesn't dominate the row. */
.smc-id-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600; color: #6d28d9;
  background: #f3eeff;
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid #e0d9f7;
  letter-spacing: .02em;
}

.smc-company { font-weight: 600; color: #212529; }

/* Type / Segment / WhatsApp pills — flat solid colors, no gradients,
   subtle borders. Same density and weight across all three so the
   row reads as a tidy strip. */
.smc-type-pill {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 600;
  border: 1px solid; white-space: nowrap;
}
.smc-seg {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 600; color: #5b21b6;
  background: #f3eeff;
  border: 1px solid #ddd6fe; border-radius: 20px;
  padding: 3px 10px; white-space: nowrap;
}

.smc-country { color: #495057; font-weight: 500; }
.smc-contact { color: #495057; font-weight: 500; }
.smc-mono    { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #495057; font-size: 12px; }
.smc-email   { color: #6d28d9; font-size: 12px; font-weight: 500; }

.smc-wa {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 600;
}
.smc-wa.yes { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.smc-wa.no  { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
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

/* ─── Dark mode overrides ───
   Velzon toggles dark mode via [data-bs-theme="dark"] on <html>. The default
   palette above is hardcoded light-purple, so without this block the page
   stays bright when the user switches theme. Keep the purple accent identity
   (buttons, headers, chips) but recolour every surface, border, and body text
   so the page actually reads as dark. */
[data-bs-theme="dark"] .smc-root {
  background: linear-gradient(160deg, #14101d 0%, #1a1530 40%, #15122a 100%);
  color: #d4d1de;
}
[data-bs-theme="dark"] .smc-cstrip {
  border-color: rgba(167,139,250,.30);
  background: linear-gradient(110deg, #1c1432 0%, #221839 25%, #2a1d49 55%, #3a2467 85%, #4c2d8a 100%);
  box-shadow:
    0 2px 0 rgba(167,139,250,.08) inset,
    0 8px 28px rgba(0,0,0,.45),
    0 2px 8px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .smc-glow { opacity: .55; }
[data-bs-theme="dark"] .smc-sheen { background: linear-gradient(180deg, rgba(255,255,255,.06), transparent); }
[data-bs-theme="dark"] .smc-online-dot { border-color: #2a1d49; }
[data-bs-theme="dark"] .smc-title { color: #e9d5ff; }
[data-bs-theme="dark"] .smc-sub   { color: #9aa0b4; }

[data-bs-theme="dark"] .smc-wdh {
  background: linear-gradient(110deg, #1c1432 0%, #221839 50%, #2a1d49 100%);
  border-color: rgba(167,139,250,.25);
  box-shadow: 0 2px 8px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .smc-wdh-title { color: #e9d5ff; }
[data-bs-theme="dark"] .smc-wdh-toggle {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.30);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .smc-wdh-toggle:hover { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .smc-wdh-toggle svg { stroke: #c4b5fd; }
[data-bs-theme="dark"] .smc-step {
  background: #1a1530;
  border-color: rgba(167,139,250,.20);
  border-left-color: #a78bfa;
}
[data-bs-theme="dark"] .smc-step-name { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-step-desc { color: #9aa0b4; }
[data-bs-theme="dark"] .smc-step-arrow-dot {
  background: #1a1530;
  border-color: rgba(167,139,250,.30);
  color: #a78bfa;
}

[data-bs-theme="dark"] .smc-table-card {
  background: #1a1530;
  border-color: rgba(167,139,250,.25);
  box-shadow: 0 8px 32px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .smc-tabs-bar {
  border-bottom-color: rgba(167,139,250,.25);
  background: linear-gradient(110deg, #1c1432 0%, #221839 50%, #2a1d49 100%);
}
[data-bs-theme="dark"] .smc-pill-group {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
  box-shadow: 0 2px 8px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .smc-pill.off       { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-pill.off:hover { background: rgba(255,255,255,.06); }

[data-bs-theme="dark"] .smc-search {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
  box-shadow: 0 2px 8px rgba(0,0,0,.30), 0 1px 0 rgba(255,255,255,.04) inset;
}
[data-bs-theme="dark"] .smc-search:focus-within {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20), 0 2px 8px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .smc-search input { color: #e9d5ff; }
[data-bs-theme="dark"] .smc-search input::placeholder { color: #7a6b9a; }

[data-bs-theme="dark"] .smc-table thead tr {
  background: linear-gradient(110deg, #4c2d8a 0%, #5b21b6 40%, #6d28d9 75%, #7c3aed 100%);
}
[data-bs-theme="dark"] .smc-table tbody td {
  border-bottom-color: rgba(167,139,250,.15);
  color: #d4d1de;
}
[data-bs-theme="dark"] .smc-table tbody tr.odd  td { background: rgba(76,45,138,.15); }
[data-bs-theme="dark"] .smc-table tbody tr.even td { background: rgba(28,20,50,.45); }
[data-bs-theme="dark"] .smc-table tbody tr:hover td {
  background: linear-gradient(90deg, rgba(124,58,237,.20), rgba(167,139,250,.18), rgba(124,58,237,.20)) !important;
}
[data-bs-theme="dark"] .smc-empty { color: #7a6b9a; }
/* Action tiles keep their white background in dark mode too — the
   higher contrast against dark rows actually reads cleaner than a
   slate-tinted variant, and the colored hover tints stay vivid. */
[data-bs-theme="dark"] .smc-srno { color: #e2e8f0; }
[data-bs-theme="dark"] .smc-cons { color: #e2e8f0; }
[data-bs-theme="dark"] .smc-id-chip {
  color: #c4b5fd;
  background: rgba(124,58,237,0.18);
  border-color: rgba(167,139,250,.35);
}
[data-bs-theme="dark"] .smc-company { color: #f1ecff; }
[data-bs-theme="dark"] .smc-seg {
  color: #c4b5fd;
  background: rgba(124,58,237,0.18);
  border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .smc-country { color: #cbd5e1; }
[data-bs-theme="dark"] .smc-contact { color: #cbd5e1; }
[data-bs-theme="dark"] .smc-mono    { color: #cbd5e1; }
[data-bs-theme="dark"] .smc-email   { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-wa.yes {
  background: rgba(34,197,94,0.18);
  color: #86efac; border-color: rgba(34,197,94,.40);
}
[data-bs-theme="dark"] .smc-wa.no {
  background: rgba(239,68,68,0.18);
  color: #fca5a5; border-color: rgba(239,68,68,.40);
}

/* Action button surfaces — dim the light pastel fills so the icons read on dark.
   Hover gradients stay vibrant so the affordance is still obvious. */
[data-bs-theme="dark"] .smc-act-edit  {
  border-color: rgba(96,165,250,.40);
  background: linear-gradient(135deg, rgba(30,64,175,.22), rgba(29,78,216,.30));
  color: #93c5fd;
}
[data-bs-theme="dark"] .smc-act-map   {
  border-color: rgba(52,211,153,.40);
  background: linear-gradient(135deg, rgba(5,150,105,.22), rgba(4,120,87,.30));
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smc-act-vault {
  border-color: rgba(167,139,250,.40);
  background: linear-gradient(135deg, rgba(124,58,237,.22), rgba(91,33,182,.30));
  color: #c4b5fd;
}

[data-bs-theme="dark"] .smc-pagination {
  border-top-color: rgba(167,139,250,.20);
  background: linear-gradient(180deg, #14101d, #1a1530);
}
[data-bs-theme="dark"] .smc-pag-info {
  color: #c4b5fd;
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .smc-pag-range {
  color: #e9d5ff;
  background: linear-gradient(135deg, rgba(76,45,138,.40), rgba(45,27,86,.55));
  border-color: rgba(167,139,250,.35);
}
[data-bs-theme="dark"] .smc-pag-btn {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .smc-pag-btn:hover:not(:disabled) {
  background: #7c3aed; color: #fff;
}

/* ============================================================
 *  RESPONSIVE — tablet & mobile
 *  Hero strip is the most reflow-sensitive piece: the avatar +
 *  title go above the "Add Customer" button on narrow viewports.
 *  The "What we are doing here" 4-card strip wraps. The table
 *  scrolls horizontally inside its existing .table-responsive
 *  wrapper, so no special table treatment is needed.
 * ============================================================ */
@media (max-width: 1024px) {
  /* "What we are doing here" — 4 cards across become 2x2 */
  .smc-wdh-cards { grid-template-columns: repeat(2, 1fr); }
  .smc-wdh-arrow { display: none; }
}
@media (max-width: 768px) {
  /* Hero strip: stack the right-side Add button under the title */
  .smc-cstrip { flex-direction: column; align-items: stretch; gap: 14px; padding: 14px; }
  .smc-cstrip-right { width: 100%; }
  .smc-add-btn { width: 100%; justify-content: center; }
  .smc-title { font-size: 18px; }
  .smc-sub   { font-size: 12.5px; }
  /* What-we-are-doing collapses to single column */
  .smc-wdh-cards { grid-template-columns: 1fr; }
  .smc-wdh-header { flex-wrap: wrap; gap: 8px; }
  /* Fresh/Recurring tabs + search row stack */
  .smc-tabs-row { flex-direction: column; align-items: stretch; gap: 10px; }
  .smc-search-wrap { max-width: 100%; }
}
@media (max-width: 480px) {
  /* Smaller mobile — tighten paddings */
  .smc-root { padding: 0; }
  .smc-cstrip, .smc-wdh, .smc-tabs-row { border-radius: 12px; }
  .smc-avatar-wrap, .smc-back-btn { flex-shrink: 0; }
  .smc-wdh-card { padding: 12px; }
  /* Shimmer header grid — let the cells just flow with min widths */
  .smc-shimmer-head, .smc-shimmer-row {
    grid-template-columns: repeat(12, minmax(64px, 1fr));
    overflow-x: auto;
  }
}
`;
