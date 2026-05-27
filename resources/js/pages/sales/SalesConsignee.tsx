import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import AddConsigneeModal, { type ConsigneeRow } from './AddConsigneeModal';
import ConsigneeEvidenceVaultModal, { type ConsigneeVaultTarget } from './ConsigneeEvidenceVaultModal';
import { ShimmerTable } from '../../components/ui/Shimmer';
import api from '../../api';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import { readCustomerMasterBundle, writeCustomerMasterBundle } from './customerBundleCache';

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

/* Risk pill palette. Master-defined risk levels usually come back as
 * Low / Medium / High but other tiers (Tier-1, Critical, …) can land
 * too — anything not in the lookup falls back to the Low style. */
/* Tinted-glass tokens — semi-transparent backgrounds so the pill
 * inherits the surface tone and reads cleanly on both light and dark
 * themes (parallels the Customer Type pills on SalesCustomers). */
const RISK_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
  'Low':    { bg:'rgba(34,197,94,0.12)',  color:'#16a34a', dot:'#10b981' },
  'Medium': { bg:'rgba(245,158,11,0.14)', color:'#d97706', dot:'#f59e0b' },
  'High':   { bg:'rgba(239,68,68,0.12)',  color:'#dc2626', dot:'#ef4444' },
};

const ROWS_PER_PAGE = 5;

/* titleCase + TruncatedCell are module-level so the function refs
 * stay stable across renders. The page's `columns` useMemo captures
 * them via the cell renderers; a per-render closure would bust the
 * memo every time and force TanStack Table to rebuild its column
 * model on every parent re-render. */
const titleCase = (s: string): string => {
  if (!s) return s;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s;
  const idx = s.search(/[a-zA-Z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
};

const TruncatedCell = ({ value, className, max = 22, caseSensitive = false }: { value?: string | null; className?: string; max?: number; caseSensitive?: boolean }) => {
  const raw = (value ?? '').trim();
  if (!raw) return <span className="text-muted">—</span>;
  const v = caseSensitive ? raw : titleCase(raw);
  const needsTooltip = v.length > max;
  const display = needsTooltip ? v.slice(0, max) + '…' : v;
  const inner = <span className={className} style={{ maxWidth: 220, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{display}</span>;
  return needsTooltip ? <Tooltip label={v}>{inner}</Tooltip> : inner;
};

export default function SalesConsignee() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.user_type === 'super_admin';
  // Permission row for sales.consignee. Backend-authoritative; we just gate
  // the UI affordances. Super_admin bypasses.
  const perm = user?.permissions?.['sales.consignee'];
  const canView = isSuperAdmin || !!perm?.can_view;
  const canAdd  = isSuperAdmin || !!perm?.can_add;
  const canEdit = isSuperAdmin || !!perm?.can_edit;

  const [q, setQ] = useState('');
  const [wdhOpen, setWdhOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);

  /* Live data from /consignees. Replaces the ROWS mock — kept around
   * (un-referenced) so a designer can still eyeball the empty state
   * without the API; tests/seeders will populate the real list. */
  const [rows, setRows] = useState<ConsigneeRow[]>([]);
  /* Initialise to TRUE so the shimmer shows from frame 1 — the
   * fetch effect below flips it true then false; the default needed
   * to start at true to avoid an empty-state flash before mount. */
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<ConsigneeRow | null>(null);
  /* Evidence Vault — read-only compliance archive for a single
   * consignee. Opens via the row's vault button. Backend wiring
   * lands later; the modal renders the demo dataset until then. */
  const [vaultTarget, setVaultTarget] = useState<ConsigneeVaultTarget | null>(null);
  /* In-flight flag for the delete confirm — drives the spinner +
   * disabled state on the confirm dialog so the user has a visual
   * cue that the DELETE request is still going. */
  const [deleting, setDeleting] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const r = await api.get('/consignees');
      const data: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
      setRows(data.map((d: any): ConsigneeRow => ({
        id:             String(d.id ?? ''),
        db_id:          typeof d.db_id === 'number' ? d.db_id : undefined,
        customerId:     String(d.customer_code ?? d.customer_id ?? ''),
        customer_db_id: typeof d.customer_id === 'number' ? d.customer_id : undefined,
        company:        d.company ?? '',
        segment:        d.segment ?? '',
        risk:           d.riskLevel ?? '',
        contact:        d.contact ?? '',
        email:          d.email ?? '',
        phone:          d.phone ?? '',
        country:        d.country ?? '',
        // Server returns the prepared "city, state, country" string.
        // Use it directly — keeps the list page in sync with whatever
        // shape ConsigneeController::shape() decides to expose.
        countryDetail:  d.countryDetail ?? d.city ?? '',
      })));
    } catch (e: any) {
      toast.error('Failed to load consignees', e?.response?.data?.message ?? 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  /* Warm the customer/consignee master bundle in the background.
   *
   * The Add Consignee modal — and the Add Customer modal on the sibling
   * page — both consume /customers/master-bundle. Preloading on this
   * page's idle time ensures the modal hydrates synchronously from
   * sessionStorage when the user clicks "Add Consignee".
   *
   * Skips when a fresh cached copy is already present (likely when the
   * user navigated here from Customers, since both pages share the
   * cache key). */
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

  const handleDelete = async () => {
    if (!delTarget?.db_id) { setDelTarget(null); return; }
    setDeleting(true);
    try {
      await api.delete(`/consignees/${delTarget.db_id}`);
      toast.success('Consignee deleted', delTarget.company);
      setDelTarget(null);
      fetchRows();
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Please try again.');
    } finally {
      setDeleting(false);
    }
  };

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
    if (!q) return rows;
    const lo = q.toLowerCase();
    return rows.filter(c =>
      c.company.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.customerId.toLowerCase().includes(lo) ||
      c.contact.toLowerCase().includes(lo) ||
      c.email.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo) ||
      c.country.toLowerCase().includes(lo) ||
      String(c.risk).toLowerCase().includes(lo),
    );
  }, [q, rows]);

  // TableContainer manages its own pagination — the page-local
  // slice variables used by the old custom table are gone now.
  const onSearch = (v: string) => { setQ(v); };
  const soon = (label: string) => toast.info(label, 'Coming in next phase');

  /* ── Project-standard action button (same recipe as HR Employees /
   * SalesCustomers). 30×30 tile using vz-* tokens that auto-adapt to
   * light/dark mode; on hover border + icon shift to the column-
   * specific accent. Always wrapped in <Tooltip>. */
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
   * of this file so the function references stay stable across
   * renders — see the comment block above the page component. */

  /* ── TanStack column defs. Cell renderers keep the emerald-themed
   * pills/chips (ID chip, risk pill, country sub-text) so the page
   * palette stays intact; only the table chrome + actions switch to
   * project standards. */
  const columns = useMemo<any[]>(() => [
    {
      header: 'Sr No',
      id: '__sr',
      meta: { align: 'center' },
      cell: (info: any) => <span className="smcg-srno">{info.row.index + 1}</span>,
      enableSorting: false,
    },
    {
      header: 'Consignee ID',
      accessorKey: 'id',
      cell: (info: any) => <span className="smcg-id-chip">{info.getValue()}</span>,
    },
    {
      header: 'Customer ID',
      accessorKey: 'customerId',
      cell: (info: any) => <span className="smcg-cust-chip">{info.getValue()}</span>,
    },
    {
      header: 'Company Name',
      accessorKey: 'company',
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smcg-company" max={16} />,
    },
    {
      header: 'Segment',
      accessorKey: 'segment',
      cell: (info: any) => info.getValue() ? <span className="smcg-seg">{info.getValue()}</span> : <span className="text-muted">—</span>,
    },
    {
      header: 'Risk Level',
      accessorKey: 'risk',
      cell: (info: any) => {
        const v = String(info.getValue() ?? '');
        const r = RISK_COLORS[v] || RISK_COLORS['Low'];
        return (
          <span className="smcg-risk-pill" style={{ background: r.bg, color: r.color, borderColor: r.bg.replace('0.12)','0.35)').replace('0.14)','0.38)') }}>
            {v}
          </span>
        );
      },
    },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smcg-contact" max={16} /> },
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <TruncatedCell value={i.getValue()} className="smcg-email" max={18} caseSensitive /> },
    { header: 'Contact No',     accessorKey: 'phone',   cell: (i: any) => <span className="smcg-mono">{i.getValue() || '—'}</span> },
    {
      header: 'Country',
      accessorKey: 'country',
      cell: (info: any) => {
        const c = info.row.original as Consignee;
        const country = (c.country ?? '').trim();
        if (!country) return <span className="text-muted">—</span>;
        /* Country-only display per the cleaner-list UX. City/state are
         * still on the row (countryDetail) but stay surfaced inside the
         * Edit modal — the list column was getting noisy with all three
         * stacked horizontally. */
        return (
          <span className="smcg-country" style={{ whiteSpace: 'nowrap' }}>
            {country}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      meta: { align: 'center' },
      enableSorting: false,
      cell: (info: any) => {
        const c = info.row.original as ConsigneeRow;
        return (
          <div className="d-inline-flex align-items-center gap-1">
            {canEdit && <ActionBtn title="Edit Consignee"          icon="ri-pencil-line"      color="primary" onClick={() => { setEditing(c); setAddOpen(true); }} />}
                       <ActionBtn title="Evidence Vault"           icon="ri-file-shield-line" color="info"    onClick={() => setVaultTarget({
                         id: c.id,
                         db_id: c.db_id,
                         company: c.company,
                         risk: c.risk,
                         segment: c.segment,
                         country: c.country,
                         contact: c.contact,
                         contactCity: c.countryDetail,
                         customerId: c.customerId,
                       })} />
            {canEdit && <ActionBtn title="Delete Consignee"        icon="ri-delete-bin-line"  color="danger"  onClick={() => setDelTarget(c)} />}
          </div>
        );
      },
    },
  ], [canEdit]);

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

      {/* ── Hero strip — solid emerald gradient with truck icon, page
            title + description, and the primary "Add Consignee" CTA.
            Brings back the bold "ultra HD" look the page had before;
            sharp white text on a saturated green background pops
            against the page chrome instead of blending with it. */}
      <div className="smcg-cstrip">
        <div className="smcg-cstrip-left">
          <div className="smcg-cstrip-icon">
            <i className="ri-truck-line" />
          </div>
          <div>
            <div className="smcg-cstrip-title">Consignee</div>
            <div className="smcg-cstrip-sub">
              Manage consignee identity, shipment delivery ownership, compliance readiness, and customer-linked destination mapping for export execution.
            </div>
          </div>
        </div>
        {canAdd && (
          <button
            type="button"
            className="smcg-cstrip-add"
            onClick={() => { setEditing(null); setAddOpen(true); }}
          >
            <i className="ri-add-line" />
            Add Consignee
          </button>
        )}
      </div>

      {/* ── Slim "What we are doing here" banner — light emerald
            gradient with the 4 colorful step tiles inside. */}
      <div className={`smcg-wdh-card ${wdhOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          className="smcg-wdh-toggle-row"
          onClick={() => setWdhOpen(o => !o)}
        >
          <div className="smcg-wdh-heading">
            <span className="smcg-wdh-bulb">
              <i className="ri-lightbulb-flash-line" />
            </span>
            <div>
              <div className="smcg-wdh-title">Consignee — What we are doing here</div>
              <small className="smcg-wdh-sub">4 steps to complete consignee setup</small>
            </div>
          </div>
          <span className={`smcg-wdh-chev ${wdhOpen ? 'is-open' : ''}`}>
            <i className="ri-arrow-down-s-line" />
          </span>
        </button>

        <div className="smcg-wdh-body-wrap" style={{ maxHeight: wdhOpen ? 600 : 0 }}>
          <div className="smcg-wdh-body">
            {STEPS.map((s, i) => {
              const isLast = i === STEPS.length - 1;
              return (
                <Fragment key={s.n}>
                  <div className="smcg-step" data-n={i}>
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
                  {!isLast && (
                    <div className="smcg-step-arrow"><i className="ri-arrow-right-s-line" /></div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main card — toolbar (search + Add Consignee) + table + pagination ── */}
      <div className="smcg-table-card">

        {/* Toolbar — search only (Add Consignee lives in the hero strip). */}
        <div className="smcg-toolbar">
          <div className="smcg-search">
            <i className="ri-search-line smcg-search-icon" />
            <input
              type="text"
              placeholder="Search by consignee ID, customer, company, country, risk..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          {/* Add button moved to the emerald hero strip above. The block
              below is kept commented in case we ever want it back. */}
          {false && canAdd && (
            <button
              type="button"
              className="smcg-add-btn"
              onClick={() => { setEditing(null); setAddOpen(true); }}
            >
              <i className="ri-add-line" />
              Add Consignee
            </button>
          )}
        </div>

        <div className="smcg-table-wrap">
          {loading && rows.length === 0 ? (
            /* Canonical ShimmerTable from the shared Shimmer component
               — matches the skeleton used on Dashboard + Master pages.
               cols=12 matches the live header strip (Sr No, Consignee ID,
               Customer ID, Company, Segment, Risk Level, Contact,
               Email, Contact No, Country, Actions, +1 buffer). */
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
              SearchPlaceholder="Search consignees..."
            />
          )}
          {!loading && filtered.length === 0 && (
            <div className="smcg-empty py-4">No consignees found</div>
          )}
        </div>
      </div>

      <AddConsigneeModal
        open={addOpen}
        consignee={editing}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSaved={() => { fetchRows(); }}
      />

      <DeleteConfirmModal
        open={!!delTarget}
        title="Delete Consignee"
        itemName={delTarget?.company}
        subMessage="This will permanently delete the consignee and all linked addresses. The action cannot be undone."
        onClose={() => { if (!deleting) setDelTarget(null); }}
        onConfirm={handleDelete}
        loading={deleting}
      />

      <ConsigneeEvidenceVaultModal
        open={!!vaultTarget}
        consignee={vaultTarget}
        onClose={() => setVaultTarget(null)}
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

/* The page-specific list-shimmer has been removed — the canonical
 * `ShimmerTable` from components/ui/Shimmer is now used inline at
 * the table render site, matching the loading look on Dashboard and
 * Master pages. */

/* ─── Scoped page CSS (all rules under .smcg-root) ─── */
const SCOPED_CSS = `
.smcg-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: transparent;
  padding: 0;
  margin: 0;
  display: flex; flex-direction: column; gap: 14px;
  color: var(--vz-body-color);
}
.smcg-root *, .smcg-root *::before, .smcg-root *::after { box-sizing: border-box; }

/* ─── Hero strip ─── */
/* ─── Hero strip — light mint→teal gradient (Figma spec). Soft,
   minty background with a dark-emerald icon + dark-emerald primary
   button on top. Reads "ultra HD" without being a heavy solid bar. */
.smcg-cstrip {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-radius: 16px;
  background: linear-gradient(110deg, #f0fdf9 0%, #ccfbf1 25%, #99f6e4 55%, #5eead4 85%, #2dd4bf 100%);
  border: 1px solid #5eead4;
  box-shadow:
    0 2px 0 rgba(255,255,255,0.85) inset,
    0 8px 28px rgba(45,212,191,0.20),
    0 2px 8px rgba(0,0,0,0.06);
  overflow: hidden;
  flex-shrink: 0;
}
.smcg-cstrip::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(255,255,255,0.40) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(94,234,212,0.22) 0%, transparent 55%);
}
.smcg-cstrip-left {
  display: flex; align-items: center; gap: 16px;
  position: relative; z-index: 1;
  min-width: 0;
  flex: 1;
}
.smcg-cstrip-icon {
  position: relative;
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #10b981, #047857);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 22px;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(5,150,105,0.40), 0 0 0 3px rgba(255,255,255,0.50);
}
.smcg-cstrip-icon::after {
  /* small green "online" dot to keep the visual rhythm of the design */
  content: '';
  position: absolute;
  bottom: -2px; right: -2px;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #ecfdf5;
  box-shadow: 0 2px 4px rgba(34,197,94,0.40);
}
.smcg-cstrip-title {
  font-size: 18px;
  font-weight: 800;
  color: #064e3b;
  letter-spacing: -.3px;
  line-height: 1.2;
}
.smcg-cstrip-sub {
  font-size: 12px;
  color: #134e3a;
  font-weight: 400;
  margin-top: 4px;
  line-height: 1.5;
  max-width: 760px;
  opacity: 0.85;
}
.smcg-cstrip-add {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 44px;
  border: 0;
  border-radius: 12px;
  font-family: inherit;
  font-size: 14px; font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(5,150,105,0.40), 0 1px 0 rgba(255,255,255,0.20) inset;
  transition: transform .18s, box-shadow .18s, background .18s;
}
.smcg-cstrip-add:hover {
  transform: translateY(-2px);
  background: linear-gradient(135deg, #065f46 0%, #064e3b 100%);
  box-shadow: 0 10px 28px rgba(5,150,105,0.50), 0 1px 0 rgba(255,255,255,0.20) inset;
}
.smcg-cstrip-add:active { transform: translateY(0); }
.smcg-cstrip-add i { font-size: 16px; }
[data-bs-theme="dark"] .smcg-cstrip {
  background: linear-gradient(110deg, #0d2f25 0%, #114a3a 30%, #0f6b54 60%, #138671 85%, #14a78a 100%);
  border-color: rgba(94,234,212,0.40);
  box-shadow:
    0 2px 0 rgba(255,255,255,0.05) inset,
    0 8px 28px rgba(0,0,0,0.50),
    0 2px 8px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .smcg-cstrip::before {
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(94,234,212,0.18) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(45,212,191,0.15) 0%, transparent 55%);
}
[data-bs-theme="dark"] .smcg-cstrip-title { color: #f0fdfa; }
[data-bs-theme="dark"] .smcg-cstrip-sub   { color: #ccfbf1; opacity: 0.92; }
[data-bs-theme="dark"] .smcg-cstrip-icon  {
  background: linear-gradient(135deg, #10b981, #34d399);
  box-shadow: 0 4px 14px rgba(16,185,129,0.50), 0 0 0 3px rgba(94,234,212,0.18);
}
[data-bs-theme="dark"] .smcg-cstrip-icon::after { border-color: #0d2f25; }
[data-bs-theme="dark"] .smcg-cstrip-add {
  background: linear-gradient(135deg, #14b89a 0%, #10b981 100%);
  color: #fff;
  box-shadow: 0 6px 18px rgba(20,184,154,0.50), 0 1px 0 rgba(255,255,255,0.18) inset;
}
[data-bs-theme="dark"] .smcg-cstrip-add:hover {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  box-shadow: 0 10px 28px rgba(20,184,154,0.60), 0 1px 0 rgba(255,255,255,0.18) inset;
}

/* ─── Slim "What you are doing here" banner ──────────────────────
 * Mint→teal gradient wash that matches the hero strip palette so
 * the two sections feel like a single visual block. */
.smcg-wdh-card {
  position: relative;
  background: linear-gradient(110deg, #f0fdf9 0%, #ccfbf1 25%, #99f6e4 55%, #5eead4 85%, #2dd4bf 100%);
  border: 1px solid #5eead4;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 2px 0 rgba(255,255,255,0.85) inset,
    0 4px 16px rgba(45,212,191,0.18),
    0 1px 3px rgba(0,0,0,0.04);
}
.smcg-wdh-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #047857 0%, #059669 35%, #10b981 70%, #34d399 100%);
  z-index: 1;
}
.smcg-wdh-toggle-row {
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
.smcg-wdh-toggle-row:hover { background: rgba(255,255,255,0.15); }
.smcg-wdh-card.is-open .smcg-wdh-toggle-row {
  background: linear-gradient(135deg, rgba(255,255,255,0.20), rgba(255,255,255,0.05));
  border-bottom: 1px solid rgba(255,255,255,0.45);
}
.smcg-wdh-heading { display: flex; align-items: center; gap: 12px; }
.smcg-wdh-bulb {
  width: 40px; height: 40px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #10b981, #047857);
  box-shadow: 0 4px 10px rgba(16,185,129,0.25);
  color: #fff; font-size: 18px; flex-shrink: 0;
}
.smcg-wdh-title {
  font-size: 15px; font-weight: 800;
  color: #064e3b;
  line-height: 1.2;
}
.smcg-wdh-sub {
  color: #047857;
  font-size: 12px;
  opacity: 0.85;
}
.smcg-wdh-chev {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(5,150,105,0.20);
  color: #047857;
  font-size: 18px; flex-shrink: 0;
  transition: transform .25s ease, background .15s ease;
}
.smcg-wdh-chev:hover { background: rgba(255,255,255,0.85); }
.smcg-wdh-chev.is-open { transform: rotate(180deg); }
.smcg-wdh-body-wrap {
  overflow: hidden;
  transition: max-height .35s ease;
}
.smcg-wdh-body {
  display: flex; align-items: stretch;
  gap: 8px;
  padding: 14px 18px 18px;
  flex-wrap: wrap;
}
/* Step tiles — solid WHITE background with a colored left-side
   accent stripe per step (emerald / blue / amber / violet). The
   per-tile color also tints the number badge, title text, and tag
   dot — but the card body itself stays clean white so the tiles
   pop against the mint→teal banner behind them. */
.smcg-step {
  flex: 1 1 0;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid rgba(16,185,129,0.18);
  border-left: 4px solid #10b981;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 2px 8px rgba(16,185,129,0.06);
  cursor: default;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.smcg-step:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(16,185,129,0.20), 0 2px 6px rgba(16,185,129,0.12);
}
/* WDH tile palette — flat solid colors (no gradients) so each tile
   reads as one cohesive accent rather than a two-tone fade. Number
   badge, border-left, name + tag all share the same solid hue. */

/* Tile 1 — Emerald (matches the page brand color). */
.smcg-step[data-n="0"] {
  border-color: rgba(16,185,129,0.20);
  border-left-color: #10b981;
}
.smcg-step[data-n="0"]:hover { box-shadow: 0 8px 22px rgba(16,185,129,0.22), 0 2px 6px rgba(16,185,129,0.14); }
.smcg-step[data-n="0"] .smcg-step-num  { background: #10b981; box-shadow: 0 3px 8px rgba(16,185,129,0.30); }
.smcg-step[data-n="0"] .smcg-step-name { color: #047857; }
.smcg-step[data-n="0"] .smcg-step-tag-dot { background: #10b981; }
.smcg-step[data-n="0"] .smcg-step-tag { color: #047857; }

/* Tile 2 — Blue (Customer & Trade Linkage). */
.smcg-step[data-n="1"] {
  border-color: rgba(64,81,137,0.20);
  border-left-color: #405189;
}
.smcg-step[data-n="1"]:hover { box-shadow: 0 8px 22px rgba(64,81,137,0.22), 0 2px 6px rgba(64,81,137,0.14); }
.smcg-step[data-n="1"] .smcg-step-num  { background: #405189; box-shadow: 0 3px 8px rgba(64,81,137,0.30); }
.smcg-step[data-n="1"] .smcg-step-name { color: #405189; }
.smcg-step[data-n="1"] .smcg-step-tag-dot { background: #405189; }
.smcg-step[data-n="1"] .smcg-step-tag { color: #405189; }

/* Tile 3 — Indigo (Compliance & Risk Details — formal, professional
   tone that sits between tile 2's navy blue and tile 4's violet
   without using the harsher red the previous palette had). */
.smcg-step[data-n="2"] {
  border-color: rgba(79,70,229,0.22);
  border-left-color: #4f46e5;
}
.smcg-step[data-n="2"]:hover { box-shadow: 0 8px 22px rgba(79,70,229,0.22), 0 2px 6px rgba(79,70,229,0.14); }
.smcg-step[data-n="2"] .smcg-step-num  { background: #4f46e5; box-shadow: 0 3px 8px rgba(79,70,229,0.30); }
.smcg-step[data-n="2"] .smcg-step-name { color: #3730a3; }
.smcg-step[data-n="2"] .smcg-step-tag-dot { background: #4f46e5; }
.smcg-step[data-n="2"] .smcg-step-tag { color: #3730a3; }

/* Tile 4 — Violet (Shipment & Export Readiness — "final execution"). */
.smcg-step[data-n="3"] {
  border-color: rgba(124,58,237,0.22);
  border-left-color: #7c3aed;
}
.smcg-step[data-n="3"]:hover { box-shadow: 0 8px 22px rgba(124,58,237,0.22), 0 2px 6px rgba(124,58,237,0.14); }
.smcg-step[data-n="3"] .smcg-step-num  { background: #7c3aed; box-shadow: 0 3px 8px rgba(124,58,237,0.30); }
.smcg-step[data-n="3"] .smcg-step-name { color: #6d28d9; }
.smcg-step[data-n="3"] .smcg-step-tag-dot { background: #7c3aed; }
.smcg-step[data-n="3"] .smcg-step-tag { color: #6d28d9; }
.smcg-step-head { display: flex; align-items: center; gap: 8px; }
.smcg-step-num {
  width: 24px; height: 24px; border-radius: 50%;
  /* Default flat emerald — each per-tile rule above overrides this
     with its own solid colour. No more two-stop gradients. */
  background: #10b981;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(16,185,129,0.30);
}
.smcg-step-name {
  font-size: 14px; font-weight: 700;
  color: #047857;
  line-height: 1.2;
}
.smcg-step-desc {
  font-size: 12px; color: var(--vz-secondary-color);
  line-height: 1.45;
  margin: 0;
}
.smcg-step-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 700;
  color: #047857;
  margin-top: 4px;
}
.smcg-step-tag-dot { width: 5px; height: 5px; border-radius: 50%; background: #10b981; }
.smcg-step-arrow {
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  width: 24px;
  color: var(--vz-secondary-color);
  font-size: 18px;
}

/* ─── Toolbar — search + Add Consignee inside the main card. */
.smcg-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(16,185,129,0.05), rgba(52,211,153,0.02));
  border-bottom: 1px solid rgba(16,185,129,0.15);
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
.smcg-toolbar .smcg-search {
  position: relative;
  flex: 1; min-width: 240px;
  background: rgba(255,255,255,0.85);
  border: 1px solid rgba(16,185,129,0.22);
  border-radius: 10px;
  padding: 0 14px 0 38px;
  height: 42px;
  display: flex; align-items: center;
  box-shadow: 0 1px 3px rgba(16,185,129,0.06);
  transition: border-color .15s, box-shadow .15s;
}
.smcg-toolbar .smcg-search:focus-within {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
}
.smcg-toolbar .smcg-search-icon {
  position: absolute; left: 14px;
  color: #059669;
  font-size: 16px;
}
.smcg-toolbar .smcg-search input {
  flex: 1; border: 0; outline: 0; background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--vz-body-color);
  font-weight: 500;
}
.smcg-toolbar .smcg-search input::placeholder { color: var(--vz-secondary-color); }

.smcg-add-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 42px;
  border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff;
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(16,185,129,0.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.smcg-add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16,185,129,0.40);
}
.smcg-add-btn:active { transform: translateY(0); }
.smcg-add-btn i { font-size: 16px; }

/* ─── Main card — neutral border + top emerald gradient accent. */
.smcg-table-card {
  position: relative;
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color);
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.smcg-table-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #047857 0%, #059669 35%, #10b981 70%, #34d399 100%);
  z-index: 1;
}

/* ─── Table ─── */
.smcg-table-wrap {
  /* Only vertical scroll on the wrap; the inner .table-responsive
     handles horizontal scroll. Prevents stacked scrollbars. */
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1; min-height: 0;
  padding: 14px 14px 12px;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.smcg-table-wrap::-webkit-scrollbar,
.smcg-table-wrap .table-responsive::-webkit-scrollbar { width: 8px; height: 8px; }
.smcg-table-wrap::-webkit-scrollbar-track,
.smcg-table-wrap .table-responsive::-webkit-scrollbar-track { background: transparent; }
.smcg-table-wrap::-webkit-scrollbar-thumb,
.smcg-table-wrap .table-responsive::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 10px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.smcg-table-wrap::-webkit-scrollbar-thumb:hover,
.smcg-table-wrap .table-responsive::-webkit-scrollbar-thumb:hover { background: #9ca3af; background-clip: padding-box; }
.smcg-table-wrap .table-responsive { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
[data-bs-theme="dark"] .smcg-table-wrap,
[data-bs-theme="dark"] .smcg-table-wrap .table-responsive {
  scrollbar-color: rgba(110,231,183,0.30) transparent;
}
[data-bs-theme="dark"] .smcg-table-wrap::-webkit-scrollbar-thumb,
[data-bs-theme="dark"] .smcg-table-wrap .table-responsive::-webkit-scrollbar-thumb {
  background: rgba(110,231,183,0.30);
}

/* Table chrome — neutral border (so bottom doesn't read as a hard
   emerald line), soft emerald gradient on the header. */
.smcg-table-wrap .table-responsive {
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid var(--vz-border-color) !important;
  border-radius: 10px !important;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
}
.smcg-table-wrap .table { --bs-table-bg: transparent; margin-bottom: 0 !important; }

/* Header — same mint→teal gradient as the hero strip + WDH banner
   so all three sections feel like one connected block. Dark-emerald
   column text reads cleanly against the teal wash. */
.smcg-table-wrap .table thead.table-light tr {
  background: linear-gradient(110deg, #f0fdf9 0%, #ccfbf1 25%, #99f6e4 55%, #5eead4 85%, #2dd4bf 100%) !important;
}
/* Typography matches the HR Employees / Master pages — header reads
   at 12px (was 13px which looked oversized next to 13px body cells
   because of the uppercase + letter-spacing). Tighter padding keeps
   the strip slim. */
.smcg-table-wrap .table thead.table-light th {
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  background: transparent !important;
  color: #064e3b !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  letter-spacing: .02em !important;
  padding: 10px 14px !important;
  line-height: 1.3 !important;
  border-bottom: 1px solid #5eead4 !important;
  white-space: nowrap;
  text-transform: uppercase;
  vertical-align: middle !important;
}
.smcg-table-wrap .table thead th i { font-size: 12px; opacity: 0.7; color: #047857; }

/* Body — white rows with soft emerald hover. */
.smcg-table-wrap .table tbody tr { background: transparent; transition: background .12s ease; }
.smcg-table-wrap .table tbody tr:hover { background: #f0fdf4 !important; }
.smcg-table-wrap .table tbody td {
  --bs-table-bg: transparent !important;
  background: transparent !important;
  padding: 12px 14px !important;
  font-size: 13px;
  font-weight: 500;
  color: var(--vz-body-color);
  vertical-align: middle;
  line-height: 1.45;
  border-bottom: 1px solid rgba(16,185,129,0.08) !important;
  white-space: nowrap;
}
.smcg-table-wrap .table tbody tr:last-child td { border-bottom: none !important; }

/* Pagination strip — emerald-tinted pills with a green gradient on
   the active page.
   Fixed 36×36 box on every button (numbers AND chevrons) so the row
   aligns cleanly. Bootstrap's default page-link padding caused the
   numbered button to render slightly taller than the chevrons. */
.smcg-table-wrap .pagination { align-items: center; gap: 4px; }
.smcg-table-wrap .pagination .page-item { display: inline-flex; }
.smcg-table-wrap .pagination .page-link {
  border-radius: 8px !important;
  margin: 0;
  padding: 0;
  height: 36px;
  min-width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #047857;
  border: 1px solid #d1fae5;
  font-weight: 600;
  line-height: 1;
}
.smcg-table-wrap .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #10b981, #047857);
  border-color: #10b981;
  color: #fff;
  box-shadow: 0 2px 6px rgba(16,185,129,.25);
}
.smcg-table-wrap .pagination .page-item.disabled .page-link { color: #6ee7b7; background: #f0fdf4; }

/* Dark mode: table chrome inherits vz tokens above so it flips
   automatically. We only override pagination active to keep the
   emerald gradient consistent with the rest of the page. */
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-link {
  background: var(--vz-secondary-bg);
  color: #6ee7b7;
  border-color: var(--vz-border-color);
}
/* Active page — force emerald in both modes. The TableContainer
   sets backgroundColor / borderColor via an INLINE style that
   resolves to var(--vz-secondary) (which is red in dark mode), so
   we need !important to beat it. */
.smcg-table-wrap .pagination .page-item.active .page-link,
.smcg-table-wrap .pagination .page-link.active {
  background: linear-gradient(135deg, #10b981, #047857) !important;
  border-color: #10b981 !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(16,185,129,.25);
}
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item.active .page-link,
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-link.active {
  background: linear-gradient(135deg, #059669, #064e3b) !important;
  border-color: #10b981 !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(16,185,129,.35);
}

/* Pagination arrows (prev / next) — distinct from the numbered
   buttons. Light: soft mint wash, emerald chevron. Dark: a raised
   slate tile with a clear emerald chevron so the arrow reads as
   an action button instead of a black square. */
.smcg-table-wrap .pagination .page-item:first-child .page-link,
.smcg-table-wrap .pagination .page-item:last-child .page-link {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #047857;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
}
.smcg-table-wrap .pagination .page-item:first-child .page-link i,
.smcg-table-wrap .pagination .page-item:last-child .page-link i {
  font-size: 16px;
  line-height: 1;
}
.smcg-table-wrap .pagination .page-item:first-child:not(.disabled) .page-link:hover,
.smcg-table-wrap .pagination .page-item:last-child:not(.disabled) .page-link:hover {
  background: #d1fae5;
  border-color: #6ee7b7;
  color: #065f46;
}
.smcg-table-wrap .pagination .page-item.disabled:first-child .page-link,
.smcg-table-wrap .pagination .page-item.disabled:last-child .page-link {
  background: #fafafa;
  border-color: #ececec;
  color: #cbd5e1;
}

[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item:first-child .page-link,
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item:last-child .page-link {
  background: rgba(16,185,129,0.14);
  border-color: rgba(110,231,183,0.35);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item:first-child:not(.disabled) .page-link:hover,
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item:last-child:not(.disabled) .page-link:hover {
  background: rgba(16,185,129,0.28);
  border-color: rgba(110,231,183,0.55);
  color: #ecfdf5;
}
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item.disabled:first-child .page-link,
[data-bs-theme="dark"] .smcg-table-wrap .pagination .page-item.disabled:last-child .page-link {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.28);
}

/* Legacy .smcg-table rules below — no longer apply since tableClass
   uses "table …" (not smcg-table). Safe to delete in cleanup. */
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

/* List-page shimmer wrapper. Uses a CSS grid for the row layout so
 * each shimmer cell auto-fits to its column. Matches the live table's
 * 12-column count + emerald-tinted header strip. */
.smcg-shimmer-wrap {
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color, #e9ecef);
  border-radius: 8px;
  overflow: hidden;
}
.smcg-shimmer-head {
  display: grid;
  grid-template-columns: 60px 110px 100px minmax(160px, 1.5fr) 120px 110px 130px 1.5fr 120px 100px 100px 90px;
  gap: 16px;
  padding: 14px 16px;
  background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
  border-bottom: 1px solid rgba(16,185,129,.25);
}
.smcg-shimmer-row {
  display: grid;
  grid-template-columns: 60px 110px 100px minmax(160px, 1.5fr) 120px 110px 130px 1.5fr 120px 100px 100px 90px;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--vz-border-color, #f3f4f6);
  align-items: center;
}
.smcg-shimmer-row:last-child { border-bottom: none; }
[data-bs-theme="dark"] .smcg-shimmer-wrap { background: var(--vz-card-bg, #1e2837); border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .smcg-shimmer-head { background: linear-gradient(180deg, rgba(16,185,129,.18) 0%, rgba(16,185,129,.10) 100%); border-bottom-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .smcg-shimmer-row  { border-bottom-color: rgba(255,255,255,.06); }

/* Sr No — plain dark text (no bubble), matching SalesCustomers. */
.smcg-srno { color: #495057; font-weight: 600; font-size: 13px; }

/* Consignee ID — soft emerald mono chip (flat, no gradient). */
.smcg-id-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600; color: #047857;
  background: #ecfdf5;
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid #a7f3d0;
  letter-spacing: .02em;
}
/* Customer ID linkage — soft violet mono chip so the cross-reference
   reads as a distinct "this points back to a customer" affordance. */
.smcg-cust-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600; color: #6d28d9;
  background: #f3eeff;
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid #e0d9f7;
  letter-spacing: .02em;
}
.smcg-company { font-weight: 600; color: #064e3b; }

/* Flat solid pills — no gradients, no leading dots. Same density
   and weight as SalesCustomers so the row reads as a tidy strip. */
.smcg-seg {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 600; color: #047857;
  background: #ecfdf5;
  border: 1px solid #a7f3d0; border-radius: 20px;
  padding: 3px 10px; white-space: nowrap;
}
/* Segment chip leading dot removed — matches the SalesCustomers
   cleanup where pill badges don't carry a leading dot indicator. */
.smcg-risk-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px 4px 11px;
  border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  letter-spacing: .02em;
  border: 1px solid; white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(15,23,42,.06);
  transition: filter .15s ease, transform .15s ease;
}
.smcg-risk-pill:hover { filter: brightness(1.05); transform: translateY(-1px); }
[data-bs-theme="dark"] .smcg-risk-pill {
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.25);
}
/* Legacy .smcg-risk-dot kept as a no-op (markup removed). */
.smcg-risk-dot { display: none; }

.smcg-country { color: #064e3b; font-weight: 600; font-size: 13px; }
.smcg-country-sub { color: #6b7280; font-weight: 500; font-size: 11.5px; }
.smcg-contact { color: #495057; font-weight: 500; }
.smcg-mono    { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #495057; font-size: 12px; }
.smcg-email   { color: #059669; font-size: 12px; font-weight: 500; }

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
  background: transparent;
  color: var(--vz-body-color);
}

/* Slim WDH banner — dark variant of the mint→teal wash with brighter
   teal accents so the gradient is visible (was too close to pure
   black before, killed the gradient feel). */
[data-bs-theme="dark"] .smcg-wdh-card {
  background: linear-gradient(110deg, #0d2f25 0%, #114a3a 30%, #0f6b54 60%, #138671 85%, #14a78a 100%);
  border-color: rgba(94,234,212,0.35);
  box-shadow:
    0 2px 0 rgba(255,255,255,0.05) inset,
    0 4px 16px rgba(0,0,0,0.35),
    0 1px 3px rgba(45,212,191,0.12);
}
[data-bs-theme="dark"] .smcg-wdh-toggle-row { background: transparent; }
[data-bs-theme="dark"] .smcg-wdh-toggle-row:hover { background: rgba(255,255,255,0.06); }
[data-bs-theme="dark"] .smcg-wdh-card.is-open .smcg-wdh-toggle-row {
  background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  border-bottom-color: rgba(94,234,212,0.30);
}
[data-bs-theme="dark"] .smcg-wdh-bulb {
  background: linear-gradient(135deg, #10b981, #34d399);
  box-shadow: 0 4px 10px rgba(16,185,129,0.45);
}
[data-bs-theme="dark"] .smcg-wdh-title { color: #f0fdfa; font-weight: 800; }
[data-bs-theme="dark"] .smcg-wdh-sub   { color: #ccfbf1; opacity: 0.92; }
[data-bs-theme="dark"] .smcg-wdh-chev {
  background: rgba(255,255,255,0.12);
  border-color: rgba(94,234,212,0.30);
  color: #ccfbf1;
}
[data-bs-theme="dark"] .smcg-wdh-chev:hover { background: rgba(255,255,255,0.20); }
/* Step tiles in dark mode — keep the white-card-on-colored-banner
   look by using a slightly translucent dark surface (lets the
   banner gradient peek through) with crisp readable text. */
[data-bs-theme="dark"] .smcg-step {
  background: rgba(15, 23, 33, 0.78);
  border-color: rgba(16,185,129,0.30);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
[data-bs-theme="dark"] .smcg-step[data-n="0"] { border-color: rgba(16,185,129,0.40); border-left-color: #10b981; }
[data-bs-theme="dark"] .smcg-step[data-n="1"] { border-color: rgba(102,145,231,0.40); border-left-color: #6691e7; }
/* Tile 3 (Compliance & Risk) — Indigo palette in dark mode. Flat
   solid accent (no gradient) that sits between tile 2's blue and
   tile 4's violet, formal/professional feel without the harshness
   of the previous red. */
[data-bs-theme="dark"] .smcg-step[data-n="2"] { border-color: rgba(129,140,248,0.45); border-left-color: #818cf8; }
[data-bs-theme="dark"] .smcg-step[data-n="3"] { border-color: rgba(167,139,250,0.40); border-left-color: #a78bfa; }
[data-bs-theme="dark"] .smcg-step[data-n="0"] .smcg-step-name { color: #6ee7b7; }
[data-bs-theme="dark"] .smcg-step[data-n="1"] .smcg-step-name { color: #93b4f0; }
[data-bs-theme="dark"] .smcg-step[data-n="2"] .smcg-step-name { color: #c7d2fe; }
[data-bs-theme="dark"] .smcg-step[data-n="3"] .smcg-step-name { color: #c4b5fd; }
[data-bs-theme="dark"] .smcg-step[data-n="0"] .smcg-step-tag     { color: #6ee7b7; }
[data-bs-theme="dark"] .smcg-step[data-n="1"] .smcg-step-tag     { color: #93b4f0; }
[data-bs-theme="dark"] .smcg-step[data-n="2"] .smcg-step-tag     { color: #c7d2fe; }
/* Badge "3" number tile + tag dot — solid indigo so the whole tile
   reads as one cohesive professional accent in dark mode. */
[data-bs-theme="dark"] .smcg-step[data-n="2"] .smcg-step-num    { background: #818cf8; box-shadow: 0 3px 8px rgba(129,140,248,0.40); }
[data-bs-theme="dark"] .smcg-step[data-n="2"] .smcg-step-tag-dot { background: #818cf8; }
[data-bs-theme="dark"] .smcg-step[data-n="3"] .smcg-step-tag     { color: #c4b5fd; }
[data-bs-theme="dark"] .smcg-step-desc { color: #cbd5e1; }
[data-bs-theme="dark"] .smcg-step-arrow { color: #ccfbf1; }

/* Toolbar — dark emerald wash on the toolbar background. */
[data-bs-theme="dark"] .smcg-toolbar {
  background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(52,211,153,0.04));
  border-bottom-color: rgba(16,185,129,0.20);
}
[data-bs-theme="dark"] .smcg-toolbar .smcg-search {
  background: rgba(255,255,255,0.04);
  border-color: rgba(16,185,129,0.25);
  box-shadow: 0 1px 3px rgba(0,0,0,0.20);
}
[data-bs-theme="dark"] .smcg-toolbar .smcg-search:focus-within {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,0.20);
}
[data-bs-theme="dark"] .smcg-toolbar .smcg-search input { color: var(--vz-body-color); }
[data-bs-theme="dark"] .smcg-toolbar .smcg-search input::placeholder { color: var(--vz-secondary-color); }
[data-bs-theme="dark"] .smcg-toolbar .smcg-search-icon { color: #6ee7b7; }

[data-bs-theme="dark"] .smcg-table-card {
  background: var(--vz-card-bg);
  border-color: rgba(16,185,129,0.25);
  box-shadow: 0 4px 16px rgba(0,0,0,0.30), 0 1px 3px rgba(16,185,129,0.10);
}

/* Table chrome in dark mode — translucent emerald wash on the
   header, dark slate body. */
[data-bs-theme="dark"] .smcg-table-wrap .table-responsive {
  background: var(--vz-card-bg) !important;
  border-color: var(--vz-border-color) !important;
}
[data-bs-theme="dark"] .smcg-table-wrap .table thead.table-light tr {
  background: linear-gradient(110deg, rgba(15,42,35,0.55) 0%, rgba(19,78,58,0.45) 25%, rgba(6,95,70,0.40) 55%, rgba(4,120,87,0.35) 85%, rgba(45,212,191,0.20) 100%) !important;
}
[data-bs-theme="dark"] .smcg-table-wrap .table thead.table-light th {
  color: #99f6e4 !important;
  border-bottom-color: rgba(94,234,212,0.30) !important;
}
[data-bs-theme="dark"] .smcg-table-wrap .table thead th i { color: #99f6e4 !important; opacity: 0.7; }
[data-bs-theme="dark"] .smcg-table-wrap .table tbody tr:hover { background: rgba(16,185,129,0.08) !important; }
[data-bs-theme="dark"] .smcg-table-wrap .table tbody td {
  color: var(--vz-body-color);
  border-bottom-color: rgba(16,185,129,0.10) !important;
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

/* ============================================================
 *  RESPONSIVE — tablet & mobile
 *  Mirrors SalesCustomers' responsive block. Emerald-themed
 *  class names (smcg-*). Same reflow strategy: hero stacks,
 *  "what we are doing" cards wrap, search row collapses, table
 *  keeps horizontal scroll via .table-responsive.
 * ============================================================ */
/* Compact laptop — 4-col WDH tiles get squeezed past 1280 with
   long titles, drop to 2x2 grid which reads more cleanly. */
@media (max-width: 1280px) {
  .smcg-wdh-cards { grid-template-columns: repeat(2, 1fr); }
  .smcg-wdh-arrow { display: none; }
  /* Page padding tightens slightly on narrower laptops so the table
     gets more room before horizontal scroll kicks in. */
  .smcg-root { padding: 12px 14px; }
}
@media (max-width: 1024px) {
  .smcg-wdh-cards { grid-template-columns: repeat(2, 1fr); }
  .smcg-wdh-arrow { display: none; }
  /* Tighter spacing on tablet so the table card gets max usable
     width before forcing horizontal scroll. */
  .smcg-cstrip { padding: 14px 16px; }
  .smcg-wdh, .smcg-tabs-row { padding: 12px 14px; }
}
@media (max-width: 768px) {
  .smcg-cstrip { flex-direction: column; align-items: stretch; gap: 14px; padding: 14px; }
  .smcg-cstrip-right { width: 100%; }
  .smcg-add-btn { width: 100%; justify-content: center; }
  .smcg-title { font-size: 18px; }
  .smcg-sub   { font-size: 12.5px; }
  .smcg-wdh-cards { grid-template-columns: 1fr; }
  .smcg-wdh-header { flex-wrap: wrap; gap: 8px; }
  .smcg-tabs-row { flex-direction: column; align-items: stretch; gap: 10px; }
  .smcg-search-wrap { max-width: 100%; }
}
@media (max-width: 480px) {
  .smcg-root { padding: 0; }
  .smcg-cstrip, .smcg-wdh, .smcg-tabs-row { border-radius: 12px; }
  .smcg-avatar-wrap, .smcg-back-btn { flex-shrink: 0; }
  .smcg-wdh-card { padding: 12px; }
  .smcg-shimmer-head, .smcg-shimmer-row {
    grid-template-columns: repeat(12, minmax(64px, 1fr));
    overflow-x: auto;
  }
}
`;
