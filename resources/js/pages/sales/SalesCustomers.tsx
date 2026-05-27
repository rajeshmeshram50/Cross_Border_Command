import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddCustomerModal, { type EditCustomer } from './AddCustomerModal';
import CustomerConsigneesModal, { type CustomerLite } from './CustomerConsigneesModal';
import CustomerEvidenceVaultModal, { type CustomerVaultTarget } from './CustomerEvidenceVaultModal';
import { ShimmerTable } from '../../components/ui/Shimmer';
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

/* Tinted-glass tokens — semi-transparent backgrounds so the pill
 * inherits the surface tone and reads cleanly on both light and dark
 * themes. Each entry pairs a brand-saturated text colour with a soft
 * tinted bg + matching border so the badge feels modern rather than
 * pastel-flat. */
const TYPE_COLORS: Record<string, { bg: string; color: string; border: string; dot: string }> = {
  'Retailer':   { bg:'rgba(59,130,246,0.12)',  color:'#2563eb', border:'rgba(59,130,246,0.35)',  dot:'#3b82f6' },
  'Exporter':   { bg:'rgba(34,197,94,0.12)',   color:'#16a34a', border:'rgba(34,197,94,0.35)',   dot:'#22c55e' },
  'Reseller':   { bg:'rgba(239,68,68,0.12)',   color:'#dc2626', border:'rgba(239,68,68,0.35)',   dot:'#ef4444' },
  'Wholesaler': { bg:'rgba(245,158,11,0.14)',  color:'#d97706', border:'rgba(245,158,11,0.38)',  dot:'#f59e0b' },
};

const ROWS_PER_PAGE = 5;

/* Display the first alphabetic letter as upper-case so company /
 * contact entries that were saved lowercase (e.g. "tcs", "igc")
 * still render as "Tcs", "Igc" in the list. Skips ALL-CAPS values
 * so identifiers like "AAAA" don't get downcased. Hoisted to module
 * scope so the function reference stays stable across renders — the
 * `columns` useMemo below depends on it via the cell renderers, and
 * a per-render closure would bust the memo every time. */
const titleCase = (s: string): string => {
  if (!s) return s;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s;
  const idx = s.search(/[a-zA-Z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
};

/* Truncated cell — pure UI, hoisted out of the page component so it
 * doesn't capture parent state in a closure and isn't re-created on
 * every render. Used by Company / Contact Person / Email / Country
 * columns. */
const TruncatedCell = ({ value, className, max = 22, caseSensitive = false }: { value?: string | null; className?: string; max?: number; caseSensitive?: boolean }) => {
  const raw = (value ?? '').trim();
  if (!raw) return <span className="text-muted">—</span>;
  const v = caseSensitive ? raw : titleCase(raw);
  const needsTooltip = v.length > max;
  const display = needsTooltip ? v.slice(0, max) + '…' : v;
  const inner = <span className={className} style={{ maxWidth: 220, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{display}</span>;
  return needsTooltip ? <Tooltip label={v}>{inner}</Tooltip> : inner;
};

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
  const [wdhOpen, setWdhOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditCustomer | null>(null);
  /* "Map Consignee" popup — opened from the row action; shows every
   * consignee linked to the picked customer and lets the user add
   * more without leaving the customer list. */
  const [mapTarget, setMapTarget] = useState<CustomerLite | null>(null);
  /* Read-only compliance archive popup — opens from the third action
   * icon ("Customer Evidence Vault"). Backend wiring lands later;
   * for now the modal renders a realistic demo snapshot keyed off
   * the customer record so designers can sign off on the UX. */
  const [vaultTarget, setVaultTarget] = useState<CustomerVaultTarget | null>(null);
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
  /* Initialise to TRUE so the shimmer shows from frame 1. The
   * fetchCustomers effect below sets it true again before the API
   * call and flips it to false in finally, but the useState default
   * needed to start at true — otherwise the very first render before
   * the effect fires showed the empty-state UI for a frame. */
  const [loading, setLoading]     = useState(true);

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

  /* `soon()` helper removed — the only caller (Customer Evidence Vault)
   * now opens the real CustomerEvidenceVaultModal popup. */

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

  /* titleCase + TruncatedCell are hoisted to module scope at the top
   * of this file so they share a stable reference across renders.
   * Keep the imports at the call sites unchanged. */

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
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smc-company" max={16} />,
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
    { header: 'Country',        accessorKey: 'country', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-country" max={16} /> },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-contact" max={16} /> },
    { header: 'Contact No',     accessorKey: 'phone',   cell: (i: any) => <span className="smc-mono">{i.getValue() || '—'}</span> },
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-email" max={18} caseSensitive /> },
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
                       <ActionBtn title="Customer Evidence Vault"  icon="ri-file-shield-line" color="info"   onClick={() => setVaultTarget({
                         id: c.id,
                         db_id: c.db_id,
                         company: c.company,
                         type: c.type,
                         segment: c.segment,
                         country: c.country,
                         contact: c.contact,
                       })} />
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

      {/* ── Slim "What you are doing here" banner — same pattern as the
            Master/Countries page. Collapsed by default to give a clean
            list view; expanding reveals the 4-step guide cards. */}
      <div className={`smc-wdh-card ${wdhOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          className="smc-wdh-toggle-row"
          onClick={() => setWdhOpen(o => !o)}
        >
          <div className="smc-wdh-heading">
            <span className="smc-wdh-bulb">
              <i className="ri-lightbulb-flash-line" />
            </span>
            <div>
              <div className="smc-wdh-title">Customers — What you are doing here</div>
              <small className="smc-wdh-sub">Quick 4-step guide to set up a Customer record</small>
            </div>
          </div>
          <span className={`smc-wdh-chev ${wdhOpen ? 'is-open' : ''}`}>
            <i className="ri-arrow-down-s-line" />
          </span>
        </button>

        <div className="smc-wdh-body-wrap" style={{ maxHeight: wdhOpen ? 600 : 0 }}>
          <div className="smc-wdh-body">
            {STEPS.map((s, i) => {
              const isLast = i === STEPS.length - 1;
              return (
                <Fragment key={s.n}>
                  <div className="smc-step" data-n={i}>
                    <div className="smc-step-head">
                      <div className="smc-step-num">{s.n}</div>
                      <span className="smc-step-name">{s.name}</span>
                    </div>
                    <p className="smc-step-desc">{s.desc}</p>
                  </div>
                  {!isLast && (
                    <div className="smc-step-arrow"><i className="ri-arrow-right-s-line" /></div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main card — search + Add Customer + tabs + table + pagination ── */}
      <div className="smc-table-card">

        {/* Search row + Add Customer (Countries-style) */}
        <div className="smc-toolbar">
          <div className="smc-search">
            <i className="ri-search-line smc-search-icon" />
            <input
              type="text"
              placeholder="Search customers..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          {canAdd && (
            <button
              type="button"
              className="smc-add-btn"
              onClick={() => { setEditing(null); setAddOpen(true); }}
            >
              <i className="ri-add-line" />
              Add Customer
            </button>
          )}
        </div>

        {/* Fresh / Recurring tabs */}
        <div className="smc-tabs-bar">
          <div className="smc-pill-group">
            <button className={`smc-pill ${tab === 'fresh' ? 'on' : 'off'}`} onClick={() => switchTab('fresh')}>
              <i className="ri-user-add-line" /> Fresh Customers
            </button>
            <button className={`smc-pill ${tab === 'recurring' ? 'on' : 'off'}`} onClick={() => switchTab('recurring')}>
              <i className="ri-repeat-line" /> Recurring Customers
            </button>
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
            /* Canonical ShimmerTable from the shared Shimmer component
               — matches the skeleton used on Dashboard + Master pages
               for a consistent loading look across the app. cols=12
               matches the live header strip (Sr No, Customer ID, Company,
               Type, Segment, Country, Contact, Phone, Email, WhatsApp,
               Consignees, Actions). */
            <ShimmerTable rows={ROWS_PER_PAGE} cols={12} />
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

      {/* Read-only Evidence Vault popup — premium emerald layout with
          5 tabs (Company DD, Owner KYC, Trade Licenses, Trade Docs,
          Shipment Agreements). Demo data for now; the backend wiring
          (GET /api/customers/{id}/vault) lands in a follow-up pass —
          the modal's `data` prop accepts the exact shape so the swap
          is a one-line change. */}
      <CustomerEvidenceVaultModal
        open={!!vaultTarget}
        customer={vaultTarget}
        onClose={() => setVaultTarget(null)}
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

/* The page-specific list-shimmer has been removed — the canonical
 * `ShimmerTable` from components/ui/Shimmer is now used inline at
 * the table render site, matching the loading look on Dashboard and
 * Master pages. */

/* ─── Scoped page CSS (all rules under .smc-root) ─── */
const SCOPED_CSS = `
.smc-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: transparent;
  padding: 0;
  margin: 0;
  display: flex; flex-direction: column; gap: 14px;
  color: var(--vz-body-color);
}
.smc-root *, .smc-root *::before, .smc-root *::after { box-sizing: border-box; }

/* ─── Slim "What you are doing here" banner ──────────────────────
 * Mirrors the Master/Countries pattern: a compact card that shows
 * just a title + lightbulb icon + chevron when collapsed; expanding
 * reveals the 4-step guide. Soft violet gradient washes the banner
 * + a thin gradient accent line on top so the page feels branded
 * without going back to the heavy hero strip. */
.smc-wdh-card {
  position: relative;
  background:
    linear-gradient(135deg, #faf5ff 0%, #f3eaff 45%, #ede1ff 100%);
  border: 1px solid #d6c5ff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(124,58,237,0.10), 0 1px 3px rgba(124,58,237,0.06);
}
.smc-wdh-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #5b21b6 0%, #7c3aed 35%, #a78bfa 70%, #c4b5fd 100%);
  z-index: 1;
}
.smc-wdh-toggle-row {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: background .2s ease;
  text-align: left;
  position: relative;
  z-index: 1;
}
.smc-wdh-toggle-row:hover { background: rgba(124,58,237,0.05); }
.smc-wdh-card.is-open .smc-wdh-toggle-row {
  background: linear-gradient(135deg, rgba(124,58,237,0.10), rgba(167,139,250,0.05));
  border-bottom: 1px solid rgba(124,58,237,0.18);
}
.smc-wdh-heading { display: flex; align-items: center; gap: 12px; }
.smc-wdh-bulb {
  width: 40px; height: 40px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 4px 10px rgba(124,58,237,0.25);
  color: #fff; font-size: 18px; flex-shrink: 0;
}
.smc-wdh-title {
  font-size: 15px; font-weight: 700;
  color: var(--vz-heading-color, var(--vz-body-color));
  line-height: 1.2;
}
.smc-wdh-sub {
  color: var(--vz-secondary-color);
  font-size: 12px;
}
.smc-wdh-chev {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(124,58,237,0.10);
  color: #6d28d9;
  font-size: 18px; flex-shrink: 0;
  transition: transform .25s ease;
}
.smc-wdh-chev.is-open { transform: rotate(180deg); }
.smc-wdh-body-wrap {
  overflow: hidden;
  transition: max-height .35s ease;
}
.smc-wdh-body {
  display: flex; align-items: stretch;
  gap: 8px;
  padding: 14px 18px 18px;
  flex-wrap: wrap;
}
/* Step tiles — solid WHITE background with a colored left-side
   accent stripe per step (violet / blue / teal / amber). The
   per-tile color also tints the number badge and title text; the
   card body itself stays clean white so the tiles pop against the
   lavender banner behind them. */
.smc-step {
  flex: 1 1 0;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid rgba(124,58,237,0.18);
  border-left: 4px solid #7c3aed;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 2px 8px rgba(18,38,63,0.04);
  cursor: default;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.smc-step:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(124,58,237,0.18), 0 2px 6px rgba(124,58,237,0.10);
}
.smc-step[data-n="1"] { border-color: rgba(64,81,137,0.20); border-left-color: #405189; }
.smc-step[data-n="1"]:hover { box-shadow: 0 8px 22px rgba(64,81,137,0.20), 0 2px 6px rgba(64,81,137,0.12); }
.smc-step[data-n="1"] .smc-step-num  { background: linear-gradient(135deg, #405189, #6691e7); box-shadow: 0 3px 8px rgba(64,81,137,0.30); }
.smc-step[data-n="1"] .smc-step-name { color: #405189; }
.smc-step[data-n="2"] { border-color: rgba(10,179,156,0.22); border-left-color: #0ab39c; }
.smc-step[data-n="2"]:hover { box-shadow: 0 8px 22px rgba(10,179,156,0.22), 0 2px 6px rgba(10,179,156,0.12); }
.smc-step[data-n="2"] .smc-step-num  { background: linear-gradient(135deg, #0ab39c, #30d5b5); box-shadow: 0 3px 8px rgba(10,179,156,0.30); }
.smc-step[data-n="2"] .smc-step-name { color: #0ab39c; }
.smc-step[data-n="3"] { border-color: rgba(247,184,75,0.25); border-left-color: #d97a08; }
.smc-step[data-n="3"]:hover { box-shadow: 0 8px 22px rgba(247,184,75,0.25), 0 2px 6px rgba(247,184,75,0.14); }
.smc-step[data-n="3"] .smc-step-num  { background: linear-gradient(135deg, #f7b84b, #ffd47a); box-shadow: 0 3px 8px rgba(247,184,75,0.30); }
.smc-step[data-n="3"] .smc-step-name { color: #d97a08; }
.smc-step[data-n="0"] .smc-step-num  { background: linear-gradient(135deg, #7c3aed, #a78bfa); }
.smc-step[data-n="0"] .smc-step-name { color: #6d28d9; }
.smc-step[data-n="0"]:hover { box-shadow: 0 8px 22px rgba(124,58,237,0.22), 0 2px 6px rgba(124,58,237,0.12); }
.smc-step-head { display: flex; align-items: center; gap: 8px; }
.smc-step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(124,58,237,0.30);
}
.smc-step-name {
  font-size: 14px; font-weight: 700;
  color: #6d28d9;
  line-height: 1.2;
}
.smc-step-desc {
  font-size: 12px; color: var(--vz-secondary-color);
  line-height: 1.45;
  margin: 0;
}
.smc-step-arrow {
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  width: 24px;
  color: var(--vz-secondary-color);
  font-size: 18px;
}

/* ─── Toolbar — search input + Add Customer button row inside
   the main card. Light violet gradient wash + tinted search box
   so the brand color carries through. */
.smc-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(124,58,237,0.04), rgba(167,139,250,0.02));
  border-bottom: 1px solid rgba(124,58,237,0.15);
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
.smc-toolbar .smc-search {
  position: relative;
  flex: 1; min-width: 240px;
  background: rgba(255,255,255,0.85);
  border: 1px solid rgba(124,58,237,0.20);
  border-radius: 10px;
  padding: 0 14px 0 38px;
  height: 42px;
  display: flex; align-items: center;
  box-shadow: 0 1px 3px rgba(124,58,237,0.06);
  transition: border-color .15s, box-shadow .15s;
}
.smc-toolbar .smc-search:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
}
.smc-toolbar .smc-search-icon {
  position: absolute; left: 14px;
  color: var(--vz-secondary-color);
  font-size: 16px;
}
.smc-toolbar .smc-search input {
  flex: 1; border: 0; outline: 0; background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--vz-body-color);
  font-weight: 500;
}
.smc-toolbar .smc-search input::placeholder { color: var(--vz-secondary-color); }

.smc-add-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 42px;
  border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(124,58,237,0.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.smc-add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(124,58,237,0.40);
}
.smc-add-btn:active { transform: translateY(0); }
.smc-add-btn i { font-size: 16px; }

/* ─── Main card — neutral border (so bottom doesn't show as a
   violet line) with ONLY the top accent stripe carrying the brand. */
.smc-table-card {
  position: relative;
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color);
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.smc-table-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #5b21b6 0%, #7c3aed 35%, #a78bfa 70%, #c4b5fd 100%);
  z-index: 1;
}
.smc-tabs-bar {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(124,58,237,0.15);
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, rgba(124,58,237,0.04), rgba(167,139,250,0.02));
}
.smc-pill-group {
  display: inline-flex; align-items: center; gap: 2px;
  background: var(--vz-secondary-bg);
  border: 1px solid var(--vz-border-color);
  border-radius: 10px;
  padding: 4px;
  flex-shrink: 0;
}
.smc-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; height: 32px;
  border: 0; border-radius: 8px;
  font-family: inherit;
  font-size: 12.5px; font-weight: 600;
  cursor: pointer;
  transition: all .18s ease;
  letter-spacing: 0;
  white-space: nowrap;
}
.smc-pill.on  {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,0.30);
}
.smc-pill.off { background: transparent; color: var(--vz-secondary-color); }
.smc-pill.off:hover { background: rgba(124,58,237,0.06); color: #6d28d9; }
.smc-pill i { font-size: 14px; }

/* ─── Table ───
 * The page uses the project-standard TableContainer with
 *   tableClass="table align-middle table-nowrap"
 *   theadClass="table-light"
 * (same as HR Employees / Clients). The rules below scope a soft
 * lavender-tinted header + clean body styling so the table feels
 * integrated with the purple page chrome without going back to the
 * heavy gradient header. */
.smc-table-wrap {
  /* Only vertical scroll on the wrap; horizontal scroll is handled
     by the inner .table-responsive so we never get TWO horizontal
     scrollbars stacked (one on the outer wrap and one on the table). */
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1; min-height: 0;
  padding: 14px 14px 12px;
  /* Light, subtle scrollbar (Firefox). */
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
/* WebKit scrollbar — light treatment for Chrome/Edge/Safari. Applied
   to the inner .table-responsive (which holds the only horizontal
   scrollbar) plus the wrap's vertical bar. */
.smc-table-wrap::-webkit-scrollbar,
.smc-table-wrap .table-responsive::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.smc-table-wrap::-webkit-scrollbar-track,
.smc-table-wrap .table-responsive::-webkit-scrollbar-track {
  background: transparent;
}
.smc-table-wrap::-webkit-scrollbar-thumb,
.smc-table-wrap .table-responsive::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 10px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.smc-table-wrap::-webkit-scrollbar-thumb:hover,
.smc-table-wrap .table-responsive::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
  background-clip: padding-box;
}
.smc-table-wrap .table-responsive {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
[data-bs-theme="dark"] .smc-table-wrap,
[data-bs-theme="dark"] .smc-table-wrap .table-responsive {
  scrollbar-color: rgba(167,139,250,0.30) transparent;
}
[data-bs-theme="dark"] .smc-table-wrap::-webkit-scrollbar-thumb,
[data-bs-theme="dark"] .smc-table-wrap .table-responsive::-webkit-scrollbar-thumb {
  background: rgba(167,139,250,0.30);
}
[data-bs-theme="dark"] .smc-table-wrap::-webkit-scrollbar-thumb:hover,
[data-bs-theme="dark"] .smc-table-wrap .table-responsive::-webkit-scrollbar-thumb:hover {
  background: rgba(167,139,250,0.50);
}

/* Card wrapper produced by divClass "table-responsive table-card border rounded".
 * Header uses a soft lavender tint that ties to the page's purple
 * chrome (hero, WDH cards, tabs bar). The cell content chips
 * provide the cell-level color; the chrome stays light + airy. */
/* ─── Table chrome — soft violet wash on the header (Countries
   master uses the same lavender tint). Rows stay clean white,
   border stays neutral so it doesn't read as a violet edge at
   the bottom. */
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
/* Header — soft lavender wash (light, faint gradient — not the
   heavy dark violet bar). Violet column text reads well against
   the pale background and keeps the brand color present without
   making the row visually heavy. */
.smc-table-wrap .table thead.table-light tr {
  background: linear-gradient(110deg, #f5f0ff 0%, #ede9fe 50%, #e0d7fc 100%) !important;
}
/* Typography matches the HR Employees / Master pages — every cell +
   header reads at 13px with header weight 600 so the table looks like
   a single grid (consistent with Clients / Branches / Employees). */
.smc-table-wrap .table thead.table-light th {
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  background: transparent !important;
  color: #5b21b6 !important;
  /* Header reads at 12px so it sits as a muted label row above the
     13px body cells (was 13px + uppercase which looked heavier than
     the rest of the table). */
  font-size: 12px !important;
  font-weight: 600 !important;
  letter-spacing: .02em !important;
  padding: 10px 14px !important;
  line-height: 1.3 !important;
  border-bottom: 1px solid rgba(124,58,237,0.18) !important;
  white-space: nowrap;
  text-transform: uppercase;
  vertical-align: middle !important;
}
.smc-table-wrap .table thead th i { font-size: 12px; opacity: 0.55; color: #6d28d9; }
/* Body — white rows with soft lavender hover. */
.smc-table-wrap .table tbody tr {
  background: transparent;
  transition: background .12s ease;
}
.smc-table-wrap .table tbody tr:hover {
  background: #faf7ff !important;
}
.smc-table-wrap .table tbody td {
  --bs-table-bg: transparent !important;
  background: transparent !important;
  padding: 12px 14px !important;
  font-size: 13px;
  font-weight: 500;
  color: var(--vz-body-color);
  vertical-align: middle;
  line-height: 1.45;
  border-bottom: 1px solid rgba(124,58,237,0.08) !important;
  white-space: nowrap;
}
.smc-table-wrap .table tbody tr:last-child td { border-bottom: none !important; }

/* Pagination strip below the table (from TableContainer) — pull the
   buttons into the purple aesthetic too.
   Fixed 36×36 box on every button (numbers AND chevrons) so the row
   aligns cleanly. Bootstrap's default page-link padding caused the
   numbered button to render slightly taller than the chevrons. */
.smc-table-wrap .pagination { align-items: center; gap: 4px; }
.smc-table-wrap .pagination .page-item { display: inline-flex; }
.smc-table-wrap .pagination .page-link {
  border-radius: 8px !important;
  margin: 0;
  padding: 0;
  height: 36px;
  min-width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6d28d9;
  border: 1px solid #e0d9f7;
  font-weight: 600;
  line-height: 1;
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

/* Dark-mode table chrome — flip the lavender thead wash to a deep
   purple-tinted dark slate so it reads cleanly on the dark canvas. */
[data-bs-theme="dark"] .smc-table-wrap .table-responsive {
  background: var(--vz-card-bg) !important;
  border-color: var(--vz-border-color) !important;
}
[data-bs-theme="dark"] .smc-table-wrap .table thead.table-light tr {
  background: linear-gradient(110deg, rgba(76,29,149,0.22) 0%, rgba(109,40,217,0.16) 50%, rgba(124,58,237,0.12) 100%) !important;
}
[data-bs-theme="dark"] .smc-table-wrap .table thead.table-light th {
  color: #e9d5ff !important;
  border-bottom-color: rgba(167,139,250,0.25) !important;
}
[data-bs-theme="dark"] .smc-table-wrap .table thead th i { color: #c4b5fd !important; opacity: 0.7; }
[data-bs-theme="dark"] .smc-table-wrap .table tbody tr:hover { background: rgba(167,139,250,0.08) !important; }
[data-bs-theme="dark"] .smc-table-wrap .table tbody td {
  color: var(--vz-body-color);
  border-bottom-color: rgba(167,139,250,0.10) !important;
}

[data-bs-theme="dark"] .smc-table-wrap .pagination .page-link {
  background: var(--vz-secondary-bg);
  color: #c4b5fd;
  border-color: var(--vz-border-color);
}
/* Active page — force purple in both modes. The TableContainer
   sets backgroundColor / borderColor via an INLINE style that
   resolves to var(--vz-secondary) (which is red in dark mode), so
   we need !important to beat it. */
.smc-table-wrap .pagination .page-item.active .page-link,
.smc-table-wrap .pagination .page-link.active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
  border-color: #7c3aed !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(109,40,217,.25);
}
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item.active .page-link,
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-link.active {
  background: linear-gradient(135deg, #6d28d9, #4c1d95) !important;
  border-color: #7c3aed !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(124,58,237,.35);
}

/* Pagination arrows (prev / next) — distinct from the numbered
   buttons. Light: soft lavender wash, purple chevron. Dark: a
   raised slate tile with a clear lavender chevron so the arrow
   reads as an action button instead of a black square. */
.smc-table-wrap .pagination .page-item:first-child .page-link,
.smc-table-wrap .pagination .page-item:last-child .page-link {
  background: #f5f1ff;
  border-color: #d8ccff;
  color: #6d28d9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
}
.smc-table-wrap .pagination .page-item:first-child .page-link i,
.smc-table-wrap .pagination .page-item:last-child .page-link i {
  font-size: 16px;
  line-height: 1;
}
.smc-table-wrap .pagination .page-item:first-child:not(.disabled) .page-link:hover,
.smc-table-wrap .pagination .page-item:last-child:not(.disabled) .page-link:hover {
  background: #ede4ff;
  border-color: #c4b5fd;
  color: #5b21b6;
}
.smc-table-wrap .pagination .page-item.disabled:first-child .page-link,
.smc-table-wrap .pagination .page-item.disabled:last-child .page-link {
  background: #fafafa;
  border-color: #ececec;
  color: #cbd5e1;
}

[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item:first-child .page-link,
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item:last-child .page-link {
  background: rgba(124,58,237,0.14);
  border-color: rgba(167,139,250,0.35);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item:first-child:not(.disabled) .page-link:hover,
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item:last-child:not(.disabled) .page-link:hover {
  background: rgba(124,58,237,0.28);
  border-color: rgba(167,139,250,0.55);
  color: #ede9fe;
}
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item.disabled:first-child .page-link,
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-item.disabled:last-child .page-link {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.28);
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
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px 4px 11px;
  border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  letter-spacing: .02em;
  border: 1px solid; white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(15,23,42,.06);
  transition: filter .15s ease, transform .15s ease;
}
.smc-type-pill::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px rgba(255,255,255,.35);
  flex-shrink: 0;
}
.smc-type-pill:hover { filter: brightness(1.05); transform: translateY(-1px); }
[data-bs-theme="dark"] .smc-type-pill {
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.25);
}
[data-bs-theme="dark"] .smc-type-pill::before {
  box-shadow: 0 0 6px currentColor;
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
  background: transparent;
  color: var(--vz-body-color);
}

/* WDH banner — dark variant: brighter violet gradient so the wash
   is actually visible (the previous mix was so dark it looked solid
   black). Title + chevron stay readable, brand color is preserved. */
[data-bs-theme="dark"] .smc-wdh-card {
  background: linear-gradient(110deg, #1f1340 0%, #2d1a5a 30%, #3d2280 60%, #4b2aa6 85%, #5b21b6 100%);
  border-color: rgba(167,139,250,0.40);
  box-shadow:
    0 2px 0 rgba(255,255,255,0.05) inset,
    0 4px 16px rgba(0,0,0,0.35),
    0 1px 3px rgba(167,139,250,0.12);
}
[data-bs-theme="dark"] .smc-wdh-toggle-row { background: transparent; }
[data-bs-theme="dark"] .smc-wdh-toggle-row:hover { background: rgba(255,255,255,0.06); }
[data-bs-theme="dark"] .smc-wdh-card.is-open .smc-wdh-toggle-row {
  background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  border-bottom-color: rgba(167,139,250,0.30);
}
[data-bs-theme="dark"] .smc-wdh-bulb {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 4px 10px rgba(124,58,237,0.45);
}
[data-bs-theme="dark"] .smc-wdh-title { color: #faf5ff; font-weight: 800; }
[data-bs-theme="dark"] .smc-wdh-sub   { color: #e9d5ff; opacity: 0.92; }
[data-bs-theme="dark"] .smc-wdh-chev {
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(167,139,250,0.30);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .smc-wdh-chev:hover { background: rgba(255,255,255,0.20); }

/* Step tiles in dark mode — translucent dark surface so the violet
   banner glows through, crisp colored text per tile. */
[data-bs-theme="dark"] .smc-step {
  background: rgba(15, 23, 33, 0.78);
  border-color: rgba(167,139,250,0.30);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
[data-bs-theme="dark"] .smc-step[data-n="0"] { border-color: rgba(167,139,250,0.40); border-left-color: #a78bfa; }
[data-bs-theme="dark"] .smc-step[data-n="1"] { border-color: rgba(102,145,231,0.40); border-left-color: #6691e7; }
[data-bs-theme="dark"] .smc-step[data-n="2"] { border-color: rgba(48,213,181,0.40); border-left-color: #30d5b5; }
[data-bs-theme="dark"] .smc-step[data-n="3"] { border-color: rgba(255,212,122,0.40); border-left-color: #ffd47a; }
[data-bs-theme="dark"] .smc-step[data-n="0"] .smc-step-name { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-step[data-n="1"] .smc-step-name { color: #93b4f0; }
[data-bs-theme="dark"] .smc-step[data-n="2"] .smc-step-name { color: #5eead4; }
[data-bs-theme="dark"] .smc-step[data-n="3"] .smc-step-name { color: #fcd34d; }
[data-bs-theme="dark"] .smc-step-desc { color: #cbd5e1; }
[data-bs-theme="dark"] .smc-step-arrow { color: #e9d5ff; }

[data-bs-theme="dark"] .smc-table-card {
  background: var(--vz-card-bg);
  border-color: rgba(167,139,250,0.25);
  box-shadow: 0 4px 16px rgba(0,0,0,0.30), 0 1px 3px rgba(167,139,250,0.10);
}
[data-bs-theme="dark"] .smc-tabs-bar {
  background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(124,58,237,0.04));
  border-bottom-color: rgba(167,139,250,0.20);
}
[data-bs-theme="dark"] .smc-pill-group {
  background: var(--vz-secondary-bg);
  border-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .smc-pill.off       { color: var(--vz-secondary-color); }
[data-bs-theme="dark"] .smc-pill.off:hover { background: rgba(167,139,250,0.10); color: #c4b5fd; }

[data-bs-theme="dark"] .smc-toolbar {
  background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(124,58,237,0.04));
  border-bottom-color: rgba(167,139,250,0.20);
}
[data-bs-theme="dark"] .smc-toolbar .smc-search {
  background: rgba(255,255,255,0.04);
  border-color: rgba(167,139,250,0.25);
  box-shadow: 0 1px 3px rgba(0,0,0,0.20);
}
[data-bs-theme="dark"] .smc-toolbar .smc-search:focus-within {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,0.20);
}
[data-bs-theme="dark"] .smc-toolbar .smc-search input { color: var(--vz-body-color); }
[data-bs-theme="dark"] .smc-toolbar .smc-search input::placeholder { color: var(--vz-secondary-color); }
[data-bs-theme="dark"] .smc-toolbar .smc-search-icon { color: var(--vz-secondary-color); }

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
