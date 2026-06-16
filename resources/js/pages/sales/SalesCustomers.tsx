import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddCustomerModal, { type EditCustomer } from './AddCustomerModal';
import CustomerConsigneesModal, { type CustomerLite } from './CustomerConsigneesModal';
import CustomerEvidenceVaultModal, { type CustomerVaultTarget } from './CustomerEvidenceVaultModal';
import { ShimmerTable } from '../../components/ui/Shimmer';
import api from '../../api';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import { readCustomerMasterBundle, writeCustomerMasterBundle } from './customerBundleCache';

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
/* Every entry uses an rgba tint + a mid-saturated text colour that reads on
 * BOTH light and dark surfaces (solid hex backgrounds would glare as bright
 * pills in dark mode). New types map here too so they don't fall through to a
 * solid fallback. */
const TYPE_COLORS: Record<string, { bg: string; color: string; border: string; dot: string }> = {
  'Retailer':     { bg:'rgba(59,130,246,0.14)',  color:'#2563eb', border:'rgba(59,130,246,0.38)',  dot:'#3b82f6' },
  'Exporter':     { bg:'rgba(34,197,94,0.14)',   color:'#16a34a', border:'rgba(34,197,94,0.38)',   dot:'#22c55e' },
  'Reseller':     { bg:'rgba(239,68,68,0.14)',   color:'#dc2626', border:'rgba(239,68,68,0.38)',   dot:'#ef4444' },
  'Wholesaler':   { bg:'rgba(245,158,11,0.16)',  color:'#d97706', border:'rgba(245,158,11,0.40)',  dot:'#f59e0b' },
  'Manufacturer': { bg:'rgba(124,58,237,0.16)',  color:'#7c3aed', border:'rgba(124,58,237,0.40)',  dot:'#7c3aed' },
  'Trader':       { bg:'rgba(6,182,212,0.16)',   color:'#0891b2', border:'rgba(6,182,212,0.40)',   dot:'#06b6d4' },
  'Distributor':  { bg:'rgba(219,39,119,0.16)',  color:'#db2777', border:'rgba(219,39,119,0.40)',  dot:'#ec4899' },
  'Importer':     { bg:'rgba(13,148,136,0.16)',  color:'#0d9488', border:'rgba(13,148,136,0.40)',  dot:'#14b8a6' },
};

const ROWS_PER_PAGE = 10;

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
  // Brief skeleton flash when the Fresh/Recurring tab changes — the rows are
  // already in memory (client-side filter), so this just gives the switch a
  // smooth "loading new view" feel (same as the HR Employees tabs).
  const [tabSwitching, setTabSwitching] = useState(false);
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

  // Scroll lock for the inline "Linked Consignee Alert" confirm — lock BOTH
  // <html> and <body> so the page behind can't scroll. (The Add and Vault
  // modals lock themselves.)
  useEffect(() => {
    if (!pendingEdit) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [pendingEdit]);

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

  /* Fit the table card to the viewport: its bottom always lands 15px above the
   * page bottom, whatever the page height / zoom, so only the TABLE scrolls
   * internally instead of the whole page. Recomputed on resize and whenever
   * the layout above it changes (banner toggle, data load, tab switch). */
  const tableCardRef = useRef<HTMLDivElement>(null);
  /* Dynamic page size: on a tall screen we show the full ROWS_PER_PAGE (10);
   * on a short screen we drop to however many rows actually fit between the
   * toolbar/header and the footer, so the remaining customers spill onto the
   * next page (no internal scroll needed) instead of being hidden. */
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
  useEffect(() => {
    const el = tableCardRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const h = Math.max(240, window.innerHeight - top - 15);
      // Fixed height so the card bottom lands 15px above the viewport bottom;
      // the inner table-wrap (overflow-y:auto) scrolls. flex:none stops the
      // page-level flex from overriding the explicit height.
      el.style.flex = 'none';
      el.style.height = `${h}px`;
      el.style.maxHeight = `${h}px`;

      // How many rows fit in the remaining body height → page size.
      const toolbarH = (el.querySelector('.smc-toolbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('.smc-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;
      const footerH  = (el.querySelector('.smc-table-wrap > .row') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('.smc-table-wrap tbody tr') as HTMLElement | null)?.offsetHeight || 40;
      // 26px ≈ wrap vertical padding (14 top + 12 bottom) + footer top margin.
      const avail = h - toolbarH - theadH - footerH - 26;
      const rowsFit = Math.floor(avail / rowH);
      // 10 is the floor (always show at least the default page of 10). On a
      // taller screen where MORE than 10 rows fit, grow to fill the leftover
      // space; we never drop below 10 (the inner scroll covers any overflow).
      setPageSize(Math.max(ROWS_PER_PAGE, rowsFit));
    };
    fit();
    // Run again after the layout settles (banner animation / async rows).
    const t = window.setTimeout(fit, 120);
    window.addEventListener('resize', fit);
    // The "What We Are Doing Here" banner expands/collapses with a CSS
    // max-height transition. A single delayed measure catches the START of
    // the animation, not the end, so when the banner is collapsed the table
    // card stayed short and left a gap below the footer. Watch the banner
    // body with a ResizeObserver and re-fit on every frame of the animation
    // so the card grows into the freed space as soon as it settles.
    let ro: ResizeObserver | undefined;
    const banner = document.querySelector('.smc-wdh-body-wrap');
    if (banner && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(banner);
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', fit);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdhOpen, loading]);

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

  /* Warm the customer/consignee master bundle in the background.
   *
   * The Add Customer modal — and the Add Consignee modal one page over
   * — both consume /customers/master-bundle. By fetching it during the
   * Customers page's idle time, the data lands in sessionStorage before
   * the user clicks "Add Customer" so the modal hydrates synchronously
   * and the shimmer barely flashes.
   *
   * Skips when a fresh cached copy is already present. Uses
   * requestIdleCallback (with a setTimeout fallback) so the warm-up
   * never competes with the visible table render. */
  useEffect(() => {
    if (readCustomerMasterBundle()) return;
    const warm = () => {
      api.get('/customers/master-bundle')
        .then(res => writeCustomerMasterBundle(res.data))
        .catch(() => { /* silent — modal will retry on open */ });
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const handle = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 800);
    return () => {
      if (w.requestIdleCallback) w.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, []);

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
  const switchTab = (next: 'fresh' | 'recurring') => {
    if (next === tab) return;
    setTabSwitching(true);
    setTab(next);
    window.setTimeout(() => setTabSwitching(false), 450);
  };
  const onSearch = (v: string) => { setQ(v); };

  /* `soon()` helper removed — the only caller (Customer Evidence Vault)
   * now opens the real CustomerEvidenceVaultModal popup. */

  /* ── Project-standard action button — same recipe as HR Employees,
   * Clients, Branches. 30×30 tile using vz-* tokens so it adapts to
   * light/dark mode automatically; on hover the border + icon shift
   * to the column-specific accent (primary / success / info / etc.).
   * Always wrapped in <Tooltip> for consistent hover hints. */
  const ActionBtn = ({ title, icon, color, onClick }: { title: string; icon: string; color: 'primary'|'success'|'info'|'danger'|'warning'; onClick: () => void }) => {
    // Map the action tone to the colour-tinted smc-act variant (Figma):
    // edit = blue, map/consignee = green, vault/doc = purple.
    const variant = color === 'success' ? 'smc-act-map' : color === 'info' ? 'smc-act-vault' : 'smc-act-edit';
    return (
      <Tooltip label={title}>
        <button
          type="button"
          aria-label={title}
          className={`smc-act ${variant} d-inline-flex align-items-center justify-content-center`}
          onClick={onClick}
        >
          {/* 'edit-svg' → the shared edit-box SVG (same icon used on the
              Consignee list + Consignees popup); anything else → a remix icon. */}
          {icon === 'edit-svg'
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            : <i className={`${icon} fs-14`} />}
        </button>
      </Tooltip>
    );
  };

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
        const t = TYPE_COLORS[v] || { bg: 'rgba(124,58,237,0.14)', color: '#7c3aed', border: 'rgba(124,58,237,0.40)', dot: '#7c3aed' };
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
            {canEdit && <ActionBtn title="Edit Customer"           icon="edit-svg"           color="primary" onClick={() => {
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

      {/* ── Hero strip — solid violet/purple gradient with user icon,
            page title + description, and the primary "Add Customer" CTA.
            Mirrors the green hero on the Consignee page for visual
            parity across Sales Matrix top-level pages, but uses
            Customer's purple palette so the rest of the page (wdh
            banner, tabs, action accents) stays cohesive. */}
      <div className="smc-cstrip">
        <span className="cv-cstrip__accent"></span>
              <span className="cv-cstrip__glow"></span>
      <span className="cv-cstrip__sheen"></span>
        <div className="smc-cstrip-left">
           
          <div className="smc-cstrip-icon">
            <i className="ri-group-line" />
          </div>
          <div>
            <div className="smc-cstrip-title">Customers</div>
            <div className="smc-cstrip-sub">
              Manage customer onboarding and lifecycle with strict compliance, KYC verification, and product mapping for sales readiness.
            </div>
          </div>
        </div>
        {canAdd && (
          <button
            type="button"
            className="smc-cstrip-add"
            onClick={() => { setEditing(null); setAddOpen(true); }}
          >
            <i className="ri-add-line" />
            Add Customer
          </button>
        )}
      </div>

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
              <i className="ri-group-line" />
            </span>
            <div>
              <div className="smc-wdh-title">Customers — What We Are Doing Here:</div>
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

      {/* ── Single card: toolbar (tabs + search) + table together ── */}
      <div className="smc-table-card" ref={tableCardRef}>

        {/* One row: Fresh / Recurring tabs on the LEFT, search on the RIGHT. */}
        <div className="smc-toolbar">
          <div className="smc-pill-group">
            <button className={`smc-pill ${tab === 'fresh' ? 'on' : 'off'}`} onClick={() => switchTab('fresh')}>
              <i className="ri-group-line" /> Fresh Customers
            </button>
            <button className={`smc-pill ${tab === 'recurring' ? 'on' : 'off'}`} onClick={() => switchTab('recurring')}>
              <i className="ri-refresh-line" /> Recurring Customers
            </button>
          </div>
          <div className="smc-search">
            <i className="ri-search-line smc-search-icon" />
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
          {(loading && customers.length === 0) || tabSwitching ? (
            /* Canonical ShimmerTable from the shared Shimmer component
               — matches the skeleton used on Dashboard + Master pages
               for a consistent loading look across the app. cols=12
               matches the live header strip (Sr No, Customer ID, Company,
               Type, Segment, Country, Contact, Phone, Email, WhatsApp,
               Consignees, Actions). */
            <ShimmerTable rows={pageSize} cols={12} />
          ) : (
            <TableContainer
              columns={columns}
              data={filtered}
              isGlobalFilter={false}
              customPageSize={pageSize}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card border rounded"
              SearchPlaceholder="Search customers..."
              condensedPagination
              pageOfTotalPagination
            />
          )}
          {!loading && !tabSwitching && filtered.length === 0 && (
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

/* ─── Hero strip — violet/purple gradient header card at the top of
 * the page (mirrors the green hero on SalesConsignee). Holds the page
 * icon, title + subtitle, and the primary "Add Customer" CTA on the
 * right. The gradient + soft white overlays give it the same
 * "ultra HD" pop the Consignee page has. */
const CSTRIP_CSS = `
.smc-cstrip {
  /* Mirror of .cv-cstrip in salesMatrixDetail.styles.ts — same gradient
     degree (110deg), same stops, same shadow, same height. Kept in
     lockstep so the Customer list hero strip and the SalesMatrix
     detail header read as one design language. */
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 70px;
  padding: 12px 18px;
  margin-bottom: 0;
  /* Thin purple→blue→pink GRADIENT border via the padding-box / border-box
     double-background trick (transparent border lets the border-box gradient
     show through as a 1px glowing ring). */
  border: 1px solid #c4b5fd;
  border-radius: 16px;
  background:
    linear-gradient(110deg, #faf7ff 0%, #f4eeff 45%, #efe8ff 75%, #ece4ff 100%) padding-box,
    /* Stronger, more saturated violet on the LEFT edge (matches the Figma's
       bright purple left border), easing through blue into pink on the right. */
    linear-gradient(125deg, #7c3aed 0%, #8b5cf6 22%, #6366f1 48%, #d946ef 76%, #ec4899 100%) border-box;
  /* Subtle, soft glow — not a heavy drop shadow. */
  box-shadow:
    0 1px 0 rgba(255,255,255,0.70) inset,
    0 4px 18px rgba(124,58,237,0.16),
    0 1px 4px rgba(99,102,241,0.10);
  font-family: 'DM Sans', system-ui, sans-serif;
}
.smc-cstrip::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(255,255,255,0.40) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(167,139,250,0.20) 0%, transparent 55%);
}
/* Fine premium "glass reflection" shine line across the top of the card.
   Reads right-to-left: strong purple/lavender glow on the RIGHT, a soft
   white/pink highlight in the MIDDLE, fading smoothly to transparent on the
   LEFT. 1.5px tall — a subtle reflection, not a divider. */
.smc-cstrip::after {
  content: '';
  position: absolute;
  top: 0; left: 14px; right: 14px;
  height: 1.5px;
  border-radius: 2px;
  pointer-events: none;
  z-index: 3;
  background: linear-gradient(90deg,
    rgba(255,255,255,0)      0%,    /* left → transparent */
    rgba(147,197,253,0.30)  14%,    /* faint blue fade-in */
    rgba(196,181,253,0.55)  30%,    /* lavender */
    rgba(253,242,248,0.95)  50%,    /* soft white-pink highlight (middle) */
    rgba(232,193,255,0.80)  66%,    /* soft pink-lavender */
    rgba(168,85,247,0.95)   86%,    /* stronger purple (right) */
    rgba(124,58,237,0.92)  100%);   /* deep lavender/purple right edge */
  opacity: 0.9;
  filter: blur(0.4px);
}
.smc-cstrip-left {
  display: flex; align-items: center; gap: 16px;
  position: relative; z-index: 1;
  min-width: 0;
  flex: 1;
}
  .cv-cstrip__accent {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
    border-radius: 16px 0 0 16px;
}
    .cv-cstrip__glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(ellipse at 10% 50%, rgba(196, 181, 253, .45) 0%, transparent 50%), radial-gradient(ellipse at 90% 50%, rgba(167, 139, 250, .25) 0%, transparent 55%);
}
    cv-cstrip__sheen {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 50%;
    pointer-events: none;
    background: linear-gradient(180deg, rgba(255, 255, 255, .5), transparent);
    border-radius: 16px 16px 0 0;
}
.smc-cstrip-icon {
  position: relative;
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 22px;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(91,33,182,0.40), 0 0 0 3px rgba(255,255,255,0.50);
}
.smc-cstrip-icon::after {
  content: '';
  position: absolute;
  bottom: -2px; right: -2px;
  width: 11px; height: 11px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 1px rgba(34,197,94,0.25), 0 2px 5px rgba(34,197,94,0.45);
}
.smc-cstrip-title {
  font-size: 18px;
  font-weight: 800;
  color: #2e1065;
  letter-spacing: -.3px;
  line-height: 1.2;
}
.smc-cstrip-sub {
  font-size: 12px;
  color: #6b7280;
  font-weight: 400;
  margin-top: 4px;
  line-height: 1.5;
  max-width: 760px;
  opacity: 0.85;
}
/* Mirror of .cv-add-customer-btn in salesMatrixDetail.styles.ts —
   solid violet (#7c3aed), 44px tall, 14px radius, weighty shadow.
   Kept identical so the customer list CTA and the customer-view
   header CTA look like the same button. */
.smc-cstrip-add {
  position: relative; z-index: 1;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 26px;
  height: 44px;
  margin-top: 0;
  border: none;
  border-radius: 14px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  letter-spacing: .01em;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 45%, #6d28d9 100%);
  box-shadow:
    0 5px 16px rgba(124, 58, 237, .40),
    0 2px 5px rgba(91, 33, 182, .25),
    0 1px 0 rgba(255, 255, 255, .22) inset;
  text-shadow: none;
  transition: background .18s, transform .18s, box-shadow .18s, filter .18s;
  align-self: center;
}
.smc-cstrip-add:hover {
  transform: translateY(-2px);
  filter: brightness(1.05);
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 45%, #5b21b6 100%);
  box-shadow:
    0 9px 24px rgba(124, 58, 237, .48),
    0 2px 6px rgba(91, 33, 182, .30),
    0 1px 0 rgba(255, 255, 255, .22) inset;
}
.smc-cstrip-add:active { transform: translateY(0); }
.smc-cstrip-add i { font-size: 16px; }

/* Responsive — stack the button under the title block on narrow screens. */
@media (max-width: 640px) {
  .smc-cstrip {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 14px;
    min-height: 0;
  }
  .smc-cstrip-left { width: 100%; }
  .smc-cstrip-add { width: 100%; align-self: stretch; }
}

[data-bs-theme="dark"] .smc-cstrip {
  /* Keep the gradient ring; swap the padding-box fill for a deep violet. */
  border: 1px solid transparent;
  background:
    linear-gradient(110deg, #1e1b4b 0%, #2e1065 35%, #3b1675 70%, #4c1d95 100%) padding-box,
    linear-gradient(125deg, #7c3aed 0%, #8b5cf6 22%, #6366f1 48%, #d946ef 76%, #ec4899 100%) border-box;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.05) inset,
    0 6px 22px rgba(0,0,0,0.45),
    0 2px 8px rgba(124,58,237,0.20);
}
[data-bs-theme="dark"] .smc-cstrip::before {
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(167,139,250,0.18) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(124,58,237,0.15) 0%, transparent 55%);
}
[data-bs-theme="dark"] .smc-cstrip-title { color: #f5f3ff; }
[data-bs-theme="dark"] .smc-cstrip-sub   { color: #ede9fe; opacity: 0.92; }
[data-bs-theme="dark"] .smc-cstrip-icon  {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 4px 14px rgba(124,58,237,0.50), 0 0 0 3px rgba(167,139,250,0.18);
}
[data-bs-theme="dark"] .smc-cstrip-icon::after { border-color: #1e1b4b; }
[data-bs-theme="dark"] .smc-cstrip-add {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 45%, #6d28d9 100%);
  color: #fff;
  box-shadow:
    0 5px 16px rgba(124, 58, 237, .45),
    0 2px 5px rgba(91, 33, 182, .30),
    0 1px 0 rgba(255, 255, 255, .20) inset;
}
[data-bs-theme="dark"] .smc-cstrip-add:hover {
  background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%);
}
`;

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
${CSTRIP_CSS}
.smc-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: transparent;
  padding: 0;
  margin: 0;
  display: flex; flex-direction: column; gap: 10px;
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
/* Top gradient accent line removed per Figma — the banner has no separate
   top border colour. */
.smc-wdh-toggle-row {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 7px 18px 2px;
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: background .2s ease;
  text-align: left;
  position: relative;
  z-index: 1;
}
.smc-wdh-toggle-row:hover { background: rgba(124,58,237,0.05); }
/* Figma keeps the header strip and the content area as ONE colour — so the
   open header stays transparent (shows the card's lavender) with no divider,
   instead of getting its own darker violet band. */
.smc-wdh-card.is-open .smc-wdh-toggle-row {
  background: transparent;
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
  color:#3b0764;
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
  padding: 0 18px 14px;
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
  padding: 9px 16px;
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: 0 2px 8px rgba(18,38,63,0.04);
  cursor: default;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.smc-step:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(124,58,237,0.18), 0 2px 6px rgba(124,58,237,0.10);
}
/* All 4 steps share ONE purple/violet accent (matches the Figma) — the
   per-step navy / teal / orange variants were removed. The base .smc-step
   (purple left border) and .smc-step-num / .smc-step-name (purple) below
   now apply uniformly to every step. */
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
  /* Centre the circle vertically between the cards — the row uses
     align-items: stretch, so a fixed-height item pins to the top without this. */
  align-self: center;
  /* Chevron sits inside a soft white circle (matches the Figma) instead of
     being a bare gray arrow. */
  width: 28px; height: 28px;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid rgba(124,58,237,0.22);
  color: #7c3aed;
  font-size: 16px;
  box-shadow: 0 1px 4px rgba(124,58,237,0.12);
}

/* ─── Toolbar — search input + Add Customer button row inside
   the main card. Light violet gradient wash + tinted search box
   so the brand color carries through. */
.smc-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 1px;
  background: linear-gradient(110deg, #ede9fe 0%, #ddd6fe 50%, #c4b5fd 100%);
  border-bottom: 2px solid #a78bfa;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
.smc-toolbar .smc-search {
  position: relative;
  flex: 1; min-width: 240px;
  background: rgba(255,255,255,0.85);
  border: 1px solid rgba(124,58,237,0.20);
  border-radius: 12px;
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
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
/* Top accent stripe removed per request. */
.smc-tabs-bar {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(124,58,237,0.15);
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, rgba(124,58,237,0.04), rgba(167,139,250,0.02));
}
.smc-pill-group {
  display: inline-flex; align-items: center; gap: 2px;
  // background: var(--vz-secondary-bg);
  // border: 1px solid var(--vz-border-color);
  // border-radius: 12px;
  // padding: 4px;
  height: 50px;            /* match the search bar height */
  // flex-shrink: 0;
  background: rgba(255, 255, 255, .5);
    border: 1.5px solid #c4b5fd;
    border-radius: 12px;
    padding: 4px;
    flex-shrink: 0;
    backdrop-filter: blur(4px);
    box-shadow: 0 2px 8px rgba(109, 40, 217, .1);
}
.smc-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 16px; height: 34px;
  border: 0; border-radius: 9px;
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
.smc-pill.off { background: transparent; color: #6d28d9; }
.smc-pill.off:hover { background: rgba(124,58,237,0.08); color: #5b21b6; }
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
  /* The wrap itself does NOT scroll. It's a vertical flex column:
       [ .table-responsive  → flex:1, the ONLY vertical scroller ]
       [ .row (footer)      → flex:0, pinned below, never scrolls ]
     This keeps both the sticky header (top of .table-responsive) and
     the footer fixed while only the rows scroll between them. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1; min-height: 0;
  padding: 14px 14px 12px;
  /* Anchor for the empty-state overlay, which is centered in the table
     body region (between the sticky header and the footer). */
  position: relative;
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
  /* This is the ONLY vertical scroller — rows scroll here while the
     sticky thead (top:0) and the footer below stay put. */
  flex: 1; min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
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
  background: linear-gradient(110deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%) !important;
}
/* Typography matches the HR Employees / Master pages — every cell +
   header reads at 13px with header weight 600 so the table looks like
   a single grid (consistent with Clients / Branches / Employees). */
.smc-table-wrap .table thead.table-light th {
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  /* Solid violet so the header keeps a fill when STICKY (the row gradient
     can't ride along a sticky <th>). Sticky keeps it visible while the 10
     rows scroll. */
  background: #6d28d9 !important;
  position: sticky; top: 0; z-index: 3;
  color: #ffffff !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  letter-spacing: .03em !important;
  padding: 11px 14px !important;
  line-height: 1.3 !important;
  border-bottom: 0 !important;
  white-space: nowrap;
  text-transform: uppercase;
  vertical-align: middle !important;
}
.smc-table-wrap .table thead th i { font-size: 12px; opacity: 0.85; color: rgba(255,255,255,0.85); }
/* Body — white rows with soft lavender hover. */
.smc-table-wrap .table tbody tr {
  background: #ffffff;
  transition: background .12s ease;
}
/* Subtle zebra striping (prototype alternates #fff / #fdfaff). */
.smc-table-wrap .table tbody tr:nth-child(even) {
  background: #fdfaff;
}
.smc-table-wrap .table tbody tr:hover {
  background: #f5f0ff !important;
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

/* ── Table footer (TableContainer's "Showing X of Y" + pagination row) ──
   Figma look: soft lavender bar, "Showing…" as a white purple-bordered pill
   on the left, circular nav + light-violet active page on the right. */
.smc-table-wrap > .row {
  margin: 8px 0 0 !important;
  --bs-gutter-x: 0; --bs-gutter-y: 0;
  padding: 8px 4px 0;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
  /* Sits BELOW the scrolling .table-responsive as a fixed flex row — it
     never scrolls (scroll lives inside .table-responsive). FLAT + transparent:
     no border / no rounded box, so it doesn't read as a second panel nested
     "inside" the table. The pills below provide all the visual structure. */
  flex-shrink: 0;
  background: transparent;
}
.smc-table-wrap > .row > [class^="col-"] { padding: 0; width: auto; flex: 0 0 auto; }
.smc-table-wrap > .row .text-muted {
  /* inline-block (not flex) so the spaces between "Showing 1 of 1 Results"
     aren't collapsed into "1of1Results". */
  display: inline-block !important;
  background: #ffffff; border: 1.5px solid #ddd6fe;
  color: #6d28d9 !important; font-weight: 600; font-size: 12px;
  padding: 5px 14px; border-radius: 20px; line-height: 1.4;
}
.smc-table-wrap > .row .text-muted .fw-semibold { color: #5b21b6; font-weight: 800; }
/* "1 / 2" indicator → light-violet capsule pill (Figma). */
.smc-table-wrap .pagination .page-link.page-of-total {
  border-radius: 20px !important;
  padding: 0 16px !important;
  height: 32px; min-width: 52px;
  background: #ede9fe !important;
  border: 1.5px solid #c4b5fd !important;
  color: #5b21b6 !important;
  font-weight: 800; font-size: 12px;
  font-variant-numeric: tabular-nums;
}
/* Numbered page chips → light-violet pills (when not in 1/2 mode). */
.smc-table-wrap .pagination .page-link {
  background: rgba(255,255,255,0.7);
}
.smc-table-wrap .pagination .page-item.active .page-link {
  background: #ddd6fe !important;
  border-color: #c4b5fd !important;
  color: #5b21b6 !important;
  box-shadow: none !important;
}
/* prev / next → white circular buttons. */
.smc-table-wrap .pagination .page-item:first-child .page-link,
.smc-table-wrap .pagination .page-item:last-child .page-link {
  border-radius: 50% !important;
  width: 32px; min-width: 32px; height: 32px;
  background: #ffffff; border-color: #e0d9f7;
}
[data-bs-theme="dark"] .smc-table-wrap > .row {
  /* Flat + transparent (no box) — pills sit cleanly below the table. */
  background: transparent !important;
  border: none !important;
}
[data-bs-theme="dark"] .smc-table-wrap > .row .text-muted {
  background: rgba(255,255,255,0.05); border-color: rgba(167,139,250,0.30); color: #c4b5fd !important;
}
[data-bs-theme="dark"] .smc-table-wrap > .row .text-muted .fw-semibold { color: #e9d5ff; }
[data-bs-theme="dark"] .smc-table-wrap .pagination .page-link.page-of-total {
  background: rgba(167,139,250,0.18) !important;
  border-color: rgba(167,139,250,0.35) !important;
  color: #e9d5ff !important;
}

/* Dark-mode table chrome — flip the lavender thead wash to a deep
   purple-tinted dark slate so it reads cleanly on the dark canvas. */
[data-bs-theme="dark"] .smc-table-wrap .table-responsive {
  background: var(--vz-card-bg) !important;
  border-color: var(--vz-border-color) !important;
}
[data-bs-theme="dark"] .smc-table-wrap .table thead.table-light tr {
  background: linear-gradient(110deg, #5b21b6 0%, #4c1d95 55%, #3b1675 100%) !important;
}
[data-bs-theme="dark"] .smc-table-wrap .table thead.table-light th {
  color: #ffffff !important;
  border-bottom: 0 !important;
  background: #4c1d95 !important;   /* solid fill for the sticky header on dark */
}
[data-bs-theme="dark"] .smc-table-wrap .table thead th i { color: rgba(255,255,255,0.85) !important; opacity: 0.85; }
/* Dark: rows transparent (card shows through), faint violet zebra. */
[data-bs-theme="dark"] .smc-table-wrap .table tbody tr { background: transparent; }
[data-bs-theme="dark"] .smc-table-wrap .table tbody tr:nth-child(even) { background: rgba(167,139,250,0.05); }
[data-bs-theme="dark"] .smc-table-wrap .table tbody tr:hover { background: rgba(167,139,250,0.10) !important; }
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
/* Empty state — centered OVER the table body (between the sticky header and
   the footer) instead of dropping below the footer. The TableContainer still
   renders its header + footer; this overlays the blank body area. */
.smc-empty {
  position: absolute;
  left: 50%;
  top: calc(50% + 16px);            /* nudge below the sticky header band */
  transform: translate(-50%, -50%);
  text-align: center;
  color: #a78bfa; font-size: 12px; font-style: italic;
  pointer-events: none;
  z-index: 2;
}

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
/* SR No — purple ROUNDED-SQUARE badge (prototype: 7px radius). */
.smc-srno {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff; font-weight: 800; font-size: 11px;
  box-shadow: 0 2px 6px rgba(109,40,217,0.30);
}
/* Consignees — purple PILL (rounded-rectangle), not a square. */
.smc-cons {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 22px; padding: 0 8px; border-radius: 20px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff; font-weight: 800; font-size: 11px; letter-spacing: .02em;
  box-shadow: 0 2px 6px rgba(109,40,217,0.30);
}

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
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  letter-spacing: .02em;
  border: 1px solid; white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(15,23,42,.06);
  transition: filter .15s ease, transform .15s ease;
}
.smc-type-pill:hover { filter: brightness(1.05); transform: translateY(-1px); }
[data-bs-theme="dark"] .smc-type-pill {
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.25);
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
/* Colored leading dot inside the status pills (Figma) — uses the pill's own
   text colour, so Type/Segment/WhatsApp each get a matching dot. */
.smc-type-pill::before,
.smc-seg::before,
.smc-wa::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  margin-right: 6px;
  flex-shrink: 0;
}
.smc-actions { display:flex; align-items:center; justify-content:center; gap:4px; flex-wrap:nowrap; }
.smc-act {
  width:28px; height:28px; border-radius:8px;
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
/* Header strip + content are ONE colour (no separate band / divider). */
[data-bs-theme="dark"] .smc-wdh-card.is-open .smc-wdh-toggle-row {
  background: transparent;
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
/* All 4 steps share ONE purple accent in dark too (matches the light
   unification) — number circle, left border and title are all violet. */
[data-bs-theme="dark"] .smc-step { border-left-color: #a78bfa; }
[data-bs-theme="dark"] .smc-step-num  { background: linear-gradient(135deg, #a78bfa, #7c3aed); }
[data-bs-theme="dark"] .smc-step-name { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-step-desc { color: #cbd5e1; }
[data-bs-theme="dark"] .smc-step-arrow {
  background: rgba(167,139,250,0.12);
  border-color: rgba(167,139,250,0.30);
  color: #c4b5fd;
  box-shadow: none;
}

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
[data-bs-theme="dark"] .smc-pill.off       { color: #c4b5fd; }
[data-bs-theme="dark"] .smc-pill.off:hover { background: rgba(167,139,250,0.10); color: #c4b5fd; }

[data-bs-theme="dark"] .smc-toolbar {
  /* Solid violet bar to match the light toolbar's presence (light is a bold
     lavender gradient; dark gets a deep-violet equivalent). */
  background: linear-gradient(110deg, rgba(76,29,149,0.45) 0%, rgba(91,33,182,0.32) 50%, rgba(124,58,237,0.24) 100%);
  border-bottom: 2px solid rgba(167,139,250,0.35);
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
