import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SalesCustomers.css';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import Tooltip from '../../../../components/ui/Tooltip';
import { type EditCustomer } from './AddCustomerModal';
import { type CustomerLite } from './CustomerConsigneesModal';
import { type CustomerVaultTarget } from './CustomerEvidenceVaultModal';
import { ShimmerTable } from '../../../../components/ui/Shimmer';
import { useIsClipped } from '../../../../components/ui/DataTable';
import api from '../../../../api';
import TableContainer from '../../../../velzon/Components/Common/TableContainerReactTable';
import { readCustomerMasterBundle, writeCustomerMasterBundle } from './customerBundleCache';
import PartyFilterModal, {
  applyPartyFilters,
  countPartyFilterValues,
  isDomesticParty,
  CUSTOMER_FACETS,
  type PartyFilters,
} from '../PartyFilterModal';

// Heavy modals are code-split: their chunks (and TipTap/face-api/pdf deps)
// download only when first opened, not on the customer list's first paint.
const AddCustomerModal = lazy(() => import('./AddCustomerModal'));
const CustomerConsigneesModal = lazy(() => import('./CustomerConsigneesModal'));
const CustomerEvidenceVaultModal = lazy(() => import('./CustomerEvidenceVaultModal'));

/* A segment pill that reveals its full name on hover — but ONLY when the label
 * is actually cut by .smc-seg's 150px cap. The clip is measured from the DOM
 * (scrollWidth vs clientWidth) instead of guessed from a character count: the
 * old `length > 18` test both missed short-but-wide names and hung a pointless
 * tooltip on names that fit. Used by the table cell AND the "+N" popover — the
 * popover pills had no hover reveal at all, so a long name like
 * "Travel & Luggagewww…" was unreadable there. */
function SegChip({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const clipped = useIsClipped(ref, name);
  const chip = <span ref={ref} className="smc-seg">{name}</span>;
  return clipped ? <Tooltip label={name}>{chip}</Tooltip> : chip;
}

type Customer = {
  id: string; db_id?: number;
  company: string; type: string; segment: string;
  country: string; country_iso?: string | null; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No'; consignees: number;
  // True = Recurring (has ≥1 lead), false = Fresh. Drives the tab split and
  // counts client-side. See CustomerController::index().
  recurring?: boolean;
  hasSameAsCustomerConsignees?: boolean;
  sameAsCustomerConsigneeCount?: number;
};
const TYPE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  'Retailer':     { bg:'rgba(59,130,246,0.14)',  color:'#2563eb', border:'rgba(59,130,246,0.38)' },
  'Exporter':     { bg:'rgba(34,197,94,0.14)',   color:'#16a34a', border:'rgba(34,197,94,0.38)' },
  'Reseller':     { bg:'rgba(239,68,68,0.14)',   color:'#dc2626', border:'rgba(239,68,68,0.38)' },
  'Wholesaler':   { bg:'rgba(245,158,11,0.16)',  color:'#d97706', border:'rgba(245,158,11,0.40)' },
  'Manufacturer': { bg:'rgba(124,58,237,0.16)',  color:'#7c3aed', border:'rgba(124,58,237,0.40)' },
  'Trader':       { bg:'rgba(6,182,212,0.16)',   color:'#0891b2', border:'rgba(6,182,212,0.40)' },
  'Distributor':  { bg:'rgba(219,39,119,0.16)',  color:'#db2777', border:'rgba(219,39,119,0.40)' },
  'Importer':     { bg:'rgba(13,148,136,0.16)',  color:'#0d9488', border:'rgba(13,148,136,0.40)' },
};

const ROWS_PER_PAGE = 10;
const titleCase = (s: string): string => {
  if (!s) return s;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s;
  const idx = s.search(/[a-zA-Z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
};

const TruncatedCell = ({ value, className, max = 60, caseSensitive = false, maxWidth = '100%' }: { value?: string | null; className?: string; max?: number; caseSensitive?: boolean; maxWidth?: number | string }) => {
  const raw = (value ?? '').trim();
  if (!raw) return <span className="text-muted">—</span>;
  const v = caseSensitive ? raw : titleCase(raw);
  const needsTooltip = v.length > max;
  const display = needsTooltip ? v.slice(0, max) + '…' : v;
  const inner = <span className={className} style={{ maxWidth, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{display}</span>;
  return needsTooltip ? <Tooltip label={v}>{inner}</Tooltip> : inner;
};

function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function SalesCustomers() {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const customerPerm = user?.permissions?.['sales.customers'];
  const canView   = isSuperAdmin || !!customerPerm?.can_view;
  const canAdd    = isSuperAdmin || !!customerPerm?.can_add;
  const canEdit   = isSuperAdmin || !!customerPerm?.can_edit;

  const [tab, setTab] = useState<'all' | 'fresh' | 'recurring'>('all');
  /* Customer Type (Domestic/India vs International), Segment, Country and
   * Whatsapp — a separate axis from the Fresh/Recurring tabs, so they're
   * filters rather than more pills; the two combine.
   *
   * Applied client-side: /customers returns the whole list in one response and
   * the table paginates it locally, so there's nothing to ask the server for.
   * (Replaces the old standalone "Region" dropdown, which is now the modal's
   * Customer Type facet — same rule, same client-side application.) */
  const [filters, setFilters] = useState<PartyFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const [tabSwitching, setTabSwitching] = useState(false);
  const [q, setQ] = useState('');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [segOpen, setSegOpen] = useState<{ id: string | number; names: string[]; x: number; y: number } | null>(null);
  // The segments popover is pinned to fixed x/y captured on click; a resize
  // (maximize/minimize/zoom) or scroll makes those coords stale and the popover
  // drifts away from its badge. Close it on either so it never shows stranded —
  // the user reopens it cleanly at the new position.
  useEffect(() => {
    if (!segOpen) return;
    const close = () => setSegOpen(null);
    // Close on a PAGE/table scroll (coords go stale), but NOT when the user is
    // scrolling the long list INSIDE the popover itself.
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('.smc-seg-pop')) return;
      setSegOpen(null);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [segOpen]);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditCustomer | null>(null);

  const [mapTarget, setMapTarget] = useState<CustomerLite | null>(null);
  const [vaultTarget, setVaultTarget] = useState<CustomerVaultTarget | null>(null);
  const [pendingEdit, setPendingEdit] = useState<Customer | null>(null);
  useEffect(() => {
    if (!pendingEdit) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [pendingEdit]);
  const [customers, setCustomers] = useState<(Customer & { db_id?: number })[]>([]);
  const [loading, setLoading]     = useState(true);
  const tableCardRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
  // Once the user picks a Rows-per-page value, stop the viewport auto-fit from
  // overriding it so the manual choice sticks.
  const [manualSize, setManualSize] = useState(false);
  useEffect(() => {
    const el = tableCardRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const h = Math.max(240, window.innerHeight - top - 15);
      el.style.flex = 'none';
      el.style.height = `${h}px`;
      el.style.maxHeight = `${h}px`;

      if (manualSize) return;   // user chose a Rows-per-page value — don't override it
      const toolbarH = (el.querySelector('.smc-toolbar') as HTMLElement | null)?.offsetHeight || 0;
      /* The filter-chips bar only exists when filters are active. It sits above
       * the table and used to be left OUT of the subtraction, so turning a
       * filter on pushed the last row under the pager (over-count by one). */
      const filterbarH = (el.querySelector('.smc-filterbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('.smc-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;
      /* Footer is the worklist pager `.tc-wl-pag` (TableContainerReactTable);
       * the old `.smc-table-wrap > .row` selector matched the non-worklist
       * pager, which this table doesn't render — so footerH came back 0 and the
       * auto-fit over-counted rows by one (QA #31). Measure the real pager. */
      const footerH  = (el.querySelector('.tc-wl-pag, .smc-table-wrap > .row') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('.smc-table-wrap tbody tr') as HTMLElement | null)?.offsetHeight || 44;
      const avail = h - toolbarH - filterbarH - theadH - footerH - 8;
      /* The page size is EXACTLY how many rows fit — not `max(10, fit)`. Flooring
       * at 10 was the "always 10" bug: on a screen that fits 8 it still asked for
       * 10 (so 2 rows sat under the pager and it never looked full), and it
       * masked the real fit on taller screens too. Now it shrinks and grows with
       * the viewport like the Lead Worksheet. Floor of 5 just avoids a silly
       * 1–2-row page on a very short window. */
      const rowsFit = Math.max(5, Math.floor(avail / rowH));
      setPageSize(rowsFit);
    };
    fit();
    const t = window.setTimeout(fit, 120);
    window.addEventListener('resize', fit);
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
  }, [wdhOpen, loading, manualSize]);

  const debouncedQ = useDebouncedValue(q, 300);
  /* Monotonic request id — only the newest in-flight fetch may write state.
   * Rapidly clicking All → Fresh → Recurring fires overlapping requests, and
   * without this an earlier/slower response could land last and paint the
   * wrong tab's rows (and drop the shimmer early). */
  const reqIdRef = useRef(0);
  /* Always fetch the FULL set (no tab param) — the tabs, facet filters and all
   * pill counts are derived from it client-side, so switching tabs or filters
   * is instant and never needs another round-trip. Only the search box hits the
   * server, so this re-runs on search alone. */
  const fetchCustomers = useCallback(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    api.get('/customers', { params: { tab: 'all', q: debouncedQ } })
      .then(r => {
        if (reqId !== reqIdRef.current) return;
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setCustomers(list);
      })
      .catch(() => { if (reqId === reqIdRef.current) setCustomers([]); })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setLoading(false);
        setTabSwitching(false);
      });
  }, [debouncedQ]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  /* Matches on `country` (the full name, e.g. "India") — the same field the
   * Add/Edit form and the consignee mapping guard key off. Not country_iso:
   * that's null whenever the stored country doesn't resolve to a master row,
   * which would silently drop those rows from EVERY filter.
   *
   * The predicate lives in PartyFilterModal (applyPartyFilters) so the
   * modal that collects the selections and the page that applies them can't
   * drift on what a filter means. */
  /* Facet filters apply FIRST, across every tab; the pill counts are then the
     Fresh/Recurring split of that filtered set, and the visible rows are the
     active tab's slice of it. Doing it in this order is what makes the counts
     react to the filters — apply International and every pill drops to its
     International total. */
  const facetFiltered = useMemo(
    () => applyPartyFilters(customers, filters),
    [customers, filters],
  );
  const tabCounts = useMemo(() => {
    const recurring = facetFiltered.filter(c => c.recurring).length;
    return { all: facetFiltered.length, recurring, fresh: facetFiltered.length - recurring };
  }, [facetFiltered]);
  const visibleCustomers = useMemo(() => {
    if (tab === 'fresh')     return facetFiltered.filter(c => !c.recurring);
    if (tab === 'recurring') return facetFiltered.filter(c => c.recurring);
    return facetFiltered;
  }, [facetFiltered, tab]);
  const activeFilterCount = countPartyFilterValues(filters);

  // Active filters as removable chips (shown above the table with a Clear all,
  // like the My Workplace / Lead Worksheet filter bar). Customer has no
  // "Same as Customer" facet, so it's not chipped here.
  const filterChips: { label: string; onRemove: () => void }[] = [];
  if (filters.region) filterChips.push({ label: `Customer Type: ${filters.region === 'domestic' ? 'Domestic' : 'International'}`, onRemove: () => setFilters(f => ({ ...f, region: undefined })) });
  (filters.segments ?? []).forEach(s => filterChips.push({ label: `Segment: ${s}`, onRemove: () => setFilters(f => ({ ...f, segments: (f.segments ?? []).filter(x => x !== s) })) }));
  (filters.countries ?? []).forEach(c => filterChips.push({ label: `Country: ${c}`, onRemove: () => setFilters(f => ({ ...f, countries: (f.countries ?? []).filter(x => x !== c) })) }));
  if (filters.whatsapp) filterChips.push({ label: `Whatsapp: ${filters.whatsapp}`, onRemove: () => setFilters(f => ({ ...f, whatsapp: undefined })) });

  useEffect(() => {
    if (readCustomerMasterBundle()) return;
    const warm = () => {
      api.get('/customers/master-bundle')
        .then(res => writeCustomerMasterBundle(res.data))
        .catch(() => {  });
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

  const switchTab = (next: 'all' | 'fresh' | 'recurring') => {
    if (next === tab) return;
    // Instant — tabs slice the already-loaded set client-side now, so there's
    // no fetch to wait on and no shimmer to show.
    setTab(next);
  };
  const onSearch = (v: string) => { setQ(v); };

  const ActionBtn = ({ title, icon, color, onClick }: { title: string; icon: string; color: 'primary'|'success'|'info'|'danger'|'warning'; onClick: () => void }) => {
    const variant = color === 'success' ? 'smc-act-map' : color === 'info' ? 'smc-act-vault' : 'smc-act-edit';
    return (
      <Tooltip label={title}>
        <button
          type="button"
          aria-label={title}
          className={`smc-act ${variant} d-inline-flex align-items-center justify-content-center`}
          onClick={onClick}
        >
          {icon === 'edit-svg'
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            : <i className={`${icon} fs-14`} />}
        </button>
      </Tooltip>
    );
  };

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
      meta: { align: 'center' },
      cell: (info: any) => <span className="smc-id-chip">{info.getValue()}</span>,
    },
    {
      header: 'Company Name',
      accessorKey: 'company',
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smc-company" />,
    },
    {
      /* Retailer / Wholesaler — was headed "Customer Type" until that name was
         handed to the Domestic/International column below. Only the header
         changed; the accessor is still `type`.
         Abbreviated to "Cust Category": every column is sized to its content
         now, so the full header was the widest thing in the column and set its
         width all by itself — the values ("Retailer") are far shorter. */
      header: 'Cust Category',
      accessorKey: 'type',
      meta: { align: 'start' },
      cell: (info: any) => {
        const v = info.getValue() as string | null;
        if (!v) return <span className="text-muted">—</span>;
        const t = TYPE_COLORS[v] || { bg: 'rgba(124,58,237,0.14)', color: '#7c3aed', border: 'rgba(124,58,237,0.40)' };
        return (
          <span className="smc-type-pill" style={{ background: t.bg, color: t.color, borderColor: t.border }}>
            {v}
          </span>
        );
      },
    },
    {
      /* Domestic vs International — DERIVED from the country, not a stored
         column, so it always agrees with the address on the form and with the
         filter's Customer Type facet (both call isDomesticParty). Sorting and
         the global search work off `country` for the same reason. */
      header: 'Customer Type',
      id: 'tradeType',
      accessorFn: (row: Customer) => (isDomesticParty(row) ? 'Domestic' : 'International'),
      meta: { align: 'start' },
      cell: (info: any) => {
        const domestic = info.getValue() === 'Domestic';
        return (
          <span className={`smc-trade-pill ${domestic ? 'is-domestic' : 'is-intl'}`}>
            {info.getValue()}
          </span>
        );
      },
    },
    {
      header: 'Segment',
      accessorKey: 'segment',
      meta: { align: 'start' },
      cell: (info: any) => {
        const segList = String(info.getValue() ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
        if (segList.length === 0) return <span className="text-muted">—</span>;
        const extra = segList.length - 1;
        const rowId = (info.row.original as Customer).id;
        return (
          <span className="d-inline-flex align-items-center" style={{ gap: 4, maxWidth: '100%', minWidth: 0 }}>
            {/* Pill truncates via CSS (.smc-seg); SegChip hangs the hover
                reveal on it when the name is really cut (QA #39 / #43). */}
            <SegChip name={segList[0]} />
            {extra > 0 && (
              <Tooltip label={`View ${extra} more`}>
                <button
                  type="button"
                  className="smc-seg-more"
                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(prev => prev?.id === rowId ? null : { id: rowId, names: segList, x: b.left, y: b.bottom + 4 }); }}
                >+{extra}</button>
              </Tooltip>
            )}
          </span>
        );
      },
    },
    { header: 'Country',        accessorKey: 'country', meta: { align: 'center' }, cell: (i: any) => {
        // Show the short ISO code (aligned, compact) with the full name on
        // hover; fall back to the raw name when the master has no match (QA #20).
        const name = i.getValue() as string | null;
        const iso  = (i.row.original as Customer).country_iso;
        if (iso) return <span className="smc-country" title={name || undefined}>{iso}</span>;
        return <TruncatedCell value={name} className="smc-country" max={16} />;
      } },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-contact" max={16} /> },
    { header: 'Contact No',     accessorKey: 'phone',   meta: { align: 'start' }, cell: (i: any) => <span className="smc-mono">{i.getValue() || '—'}</span> },
    /* Email is the ONE column left free to absorb the table's leftover width
       (see SalesCustomers.css). Its caps are raised to match: at 18 chars /
       220px it truncated long before the column ran out, so the width it soaked
       up showed as blank space instead of address. */
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-email" caseSensitive /> },
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

  if (!canView) {
    return (
      <div className="smc-root">

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
              <small className="smc-wdh-sub">4 steps to complete customer setup</small>
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

      <div className="smc-table-card" ref={tableCardRef}>

        <div className="smc-toolbar">
          <div className="smc-pill-group">
            <button className={`smc-pill ${tab === 'all' ? 'on' : 'off'}`} onClick={() => switchTab('all')}>
              <i className="ri-list-check-2" /> All Customers
              <span className="smc-pill-count">{tabCounts.all}</span>
            </button>
            <button className={`smc-pill ${tab === 'fresh' ? 'on' : 'off'}`} onClick={() => switchTab('fresh')}>
              <i className="ri-group-line" /> Fresh Customers
              <span className="smc-pill-count">{tabCounts.fresh}</span>
            </button>
            <button className={`smc-pill ${tab === 'recurring' ? 'on' : 'off'}`} onClick={() => switchTab('recurring')}>
              <i className="ri-refresh-line" /> Recurring Customers
              <span className="smc-pill-count">{tabCounts.recurring}</span>
            </button>
          </div>
          {/* Filter — independent of the tabs above (a customer is Fresh OR
              Recurring, and separately Domestic OR International), so it sits
              beside them rather than becoming a fourth pill. Opens the same
              two-pane modal the Lead Worksheet uses. The badge shows how many
              values are active, so a filtered table is never mistaken for an
              empty one. */}
          <button
            type="button"
            className={`smc-filter-btn ${activeFilterCount > 0 ? 'on' : ''}`}
            onClick={() => setFilterOpen(true)}
          >
            <i className="ri-equalizer-line" />
            Filter
            {activeFilterCount > 0 && <span className="smc-filter-badge">{activeFilterCount}</span>}
          </button>
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

        {/* Active filter chips + Clear all — applied filters shown outside the
            modal, each removable, mirroring the My Workplace filter bar. */}
        {filterChips.length > 0 && (
          <div className="smc-filterbar">
            <span className="smc-filterbar-lbl">Filters:</span>
            {filterChips.map((chip, i) => (
              <span key={i} className="smc-filterchip">
                {chip.label}
                <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label}`}>×</button>
              </span>
            ))}
            <button type="button" className="smc-filterbar-clear" onClick={() => setFilters({})}>Clear all</button>
          </div>
        )}

        <div className="smc-table-wrap">
          {(loading && customers.length === 0) || tabSwitching ? (
            <ShimmerTable rows={pageSize} cols={13} />
          ) : (
            <TableContainer
              columns={columns}
              data={visibleCustomers}
              isGlobalFilter={false}
              customPageSize={pageSize}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive"
              SearchPlaceholder="Search customers..."
              worklistPagination
              pageSizeOptions={[5, 10, 15, 25, 50]}
              onPageSizeChange={(n) => { setManualSize(true); setPageSize(n); }}
            />
          )}
          {/* Says WHY the table is empty — a bare "No customers found" while a
              filter is on reads as "there is no data" rather than "nothing
              matches this filter", and the user can't see the selections from
              here (they live inside the modal). Offers the way out too. */}
          {!loading && !tabSwitching && visibleCustomers.length === 0 && (
            <div className="smc-empty py-4">
              {customers.length > 0 && activeFilterCount > 0 ? (
                <>
                  No customers match the {activeFilterCount} selected filter{activeFilterCount > 1 ? 's' : ''}
                  {' — '}
                  <button type="button" className="smc-empty-link" onClick={() => setFilters({})}>clear filters</button>
                </>
              ) : 'No customers found'}
            </div>
          )}
        </div>
      </div>

      {/* Options are derived from `customers` (the whole loaded tab), NOT
          visibleCustomers — deriving from the already-filtered rows would make
          each pick narrow the choices left, so a user could never widen a
          filter without resetting it first. */}
      <PartyFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
        initial={filters}
        rows={customers}
        facets={CUSTOMER_FACETS}
        title="Filter Customers"
        typeLabel="Customer Type"
        theme="purple"
      />

      {addOpen && (
        <Suspense fallback={null}>
          <AddCustomerModal
            open={addOpen}
            customer={editing}
            onClose={() => { setAddOpen(false); setEditing(null); }}
            onSaved={() => { fetchCustomers(); toast.success(editing ? 'Customer updated' : 'Customer added'); }}
          />
        </Suspense>
      )}

      {!!mapTarget && (
        <Suspense fallback={null}>
          <CustomerConsigneesModal
            open={!!mapTarget}
            customer={mapTarget}
            onClose={() => { setMapTarget(null); fetchCustomers(); }}
          />
        </Suspense>
      )}

      {!!vaultTarget && (
        <Suspense fallback={null}>
          <CustomerEvidenceVaultModal
            open={!!vaultTarget}
            customer={vaultTarget}
            onClose={() => setVaultTarget(null)}
          />
        </Suspense>
      )}

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

      {segOpen && (() => {
        // Keep the popover fully on-screen — clamp its anchor so it never bleeds
        // below the fold when the "+N" is near the bottom of the list. The box
        // is at most 280px tall (maxHeight, then it scrolls); reserve the real
        // height (short lists) or that cap so the bottom rows stay visible.
        // Show ~3 segment rows at a time; the rest go behind the scrollbar.
        // Title stays pinned — only the rows list scrolls.
        const ROWS_MAX_H = 108;            // ≈ 3 rows (~34px each)
        const estH = Math.min(24 + ROWS_MAX_H + 16, 40 + segOpen.names.length * 34);
        const left = Math.max(8, Math.min(segOpen.x, window.innerWidth - 230));
        const top  = Math.max(8, Math.min(segOpen.y, window.innerHeight - estH - 8));
        return createPortal(
          <>
            <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
            <div className="smc-seg-pop" style={{ position: 'fixed', left, top, zIndex: 1091, width: 210, borderRadius: 12, padding: 8 }}>
              <div className="smc-seg-pop-title">Segments ({segOpen.names.length})</div>
              <div style={{ maxHeight: ROWS_MAX_H, overflowY: 'auto' }}>
                {segOpen.names.map((name, i) => (
                  <div key={i} className={`smc-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                    <SegChip name={name} />
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body
        );
      })()}
    </div>
  );
}

const STEPS: { n: number; name: string; desc: string }[] = [
  { n: 1, name: 'Create Customer',  desc: 'Add basic company, contact, and legal details to create the customer profile.' },
  { n: 2, name: 'Customer KYC',     desc: 'Check documents, identity, GST scrutiny & compliance to validate customer authenticity.' },
  { n: 3, name: 'Trade Document',   desc: 'Execute agreements digitally to make the customer legally approved for trade.' },
  { n: 4, name: 'Product Mapping',  desc: 'Link customer with products, pricing, and tax details for sales use.' },
];
