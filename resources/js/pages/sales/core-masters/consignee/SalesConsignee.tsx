import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import './SalesConsignee.css';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useTheme } from '../../../../contexts/ThemeContext';
import BaseTooltip from '../../../../components/ui/Tooltip';
// Consignee tooltips follow the active app theme (light pill in light mode)
// instead of the shared component's always-dark default — QA #34.
const Tooltip = (props: ComponentProps<typeof BaseTooltip>) => <BaseTooltip themed {...props} />;
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { type ConsigneeRow } from './AddConsigneeModal';
import { type ConsigneeVaultTarget } from './ConsigneeEvidenceVaultModal';
import { ShimmerTable } from '../../../../components/ui/Shimmer';
import api from '../../../../api';
import TableContainer from '../../../../velzon/Components/Common/TableContainerReactTable';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import PartyFilterModal, {
  applyPartyFilters,
  countPartyFilterValues,
  isDomesticParty,
  CONSIGNEE_FACETS,
  type PartyFilters,
} from '../PartyFilterModal';

// The two heavy consignee modals are code-split — their chunks download only
// when first opened, not on the list's first paint. (DeleteConfirmModal stays
// eager: it's a small shared dialog and should appear instantly.)
const AddConsigneeModal = lazy(() => import('./AddConsigneeModal'));
const ConsigneeEvidenceVaultModal = lazy(() => import('./ConsigneeEvidenceVaultModal'));
import { readCustomerMasterBundle, writeCustomerMasterBundle } from '../customer/customerBundleCache';
const RISK_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
  'Low':    { bg:'rgba(34,197,94,0.12)',  color:'#16a34a', dot:'#10b981' },
  'Medium': { bg:'rgba(245,158,11,0.14)', color:'#d97706', dot:'#f59e0b' },
  'High':   { bg:'rgba(239,68,68,0.12)',  color:'#dc2626', dot:'#ef4444' },
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

export default function SalesConsignee() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // Theme-aware palette for the Mapped Customers popup (portaled → inline styles).
  const mc = {
    card:      isDark ? '#0f1420' : '#ffffff',
    rowBase:   isDark ? '#141a28' : '#ffffff',
    rowAlt:    isDark ? 'rgba(124,58,237,.10)' : '#faf5ff',
    border:    isDark ? 'rgba(148,163,184,.16)' : '#f1ebfb',
    textStrong:isDark ? '#e2e8f0' : '#334155',
    textMuted: isDark ? '#94a3b8' : '#475569',
    chipBg:    isDark ? 'rgba(124,58,237,.28)' : '#ede9fe',
    chipFg:    isDark ? '#c4b5fd' : '#5b21b6',
    segBg:     isDark ? 'rgba(148,163,184,.14)' : '#f1f5f9',
    popBg:     isDark ? '#141a28' : '#ffffff',
  };
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.consignee'];
  const canView = isSuperAdmin || !!perm?.can_view;
  const canAdd  = isSuperAdmin || !!perm?.can_add;
  const canEdit = isSuperAdmin || !!perm?.can_edit;

  const [q, setQ] = useState('');
  /* Customer Type (Domestic/India vs International), Segment, Country, Whatsapp
   * and Same as Customer. Applied client-side: /consignees returns the whole
   * list in one response and the table paginates it locally, so there's nothing
   * to ask the server for.
   * (Replaces the old standalone "Same as Customer: All" dropdown, which is now
   * this modal's Same as Customer facet — same rule, same client-side pass.) */
  const [filters, setFilters] = useState<PartyFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [wdhOpen, setWdhOpen] = useState(false);
  // Shared "chips overflow" popover — used by BOTH the Segment "+N" and the
  // Customer ID "+N" (the latter shows only the mapped customer IDs, not the
  // full Map-Customer popup — QA #22). `title` labels the popover header.
  const [segOpen, setSegOpen] = useState<{ id: string | number; names: string[]; x: number; y: number; title?: string } | null>(null);
  // The segments popover is pinned to fixed x/y captured on click; a resize
  // (maximize/minimize/zoom) or scroll makes those coords stale and the popover
  // drifts away from its badge. Close it on either so it never shows stranded.
  useEffect(() => {
    if (!segOpen) return;
    const close = () => setSegOpen(null);
    // Close on a PAGE/table scroll (coords go stale), but NOT when the user is
    // scrolling the long list INSIDE the popover itself.
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('.smcg-seg-pop')) return;
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
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);
  const [rows, setRows] = useState<ConsigneeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<ConsigneeRow | null>(null);
  const [vaultTarget, setVaultTarget] = useState<ConsigneeVaultTarget | null>(null);
  // Consignee whose "Mapped Customers" list popup is open.
  const [mappedTarget, setMappedTarget] = useState<ConsigneeRow | null>(null);
  // "+N" segment overflow popover inside the Mapped Customers modal.
  const [mappedSeg, setMappedSeg] = useState<{ names: string[]; x: number; y: number } | null>(null);
  // "Map Customer" flow inside the Mapped Customers modal.
  const [custMapOpen, setCustMapOpen] = useState(false);
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [custMapId, setCustMapId] = useState('');
  const [custMapping, setCustMapping] = useState(false);

  // Freeze the page behind the Mapped Customers popup so the parent body can't
  // scroll while it's open (lock both <html> and <body> to cover whichever owns
  // the viewport scroll).
  useEffect(() => {
    if (!mappedTarget) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [mappedTarget]);

  const openCustMap = async () => {
    setCustMapId('');
    setCustMapOpen(true);
    try {
      const r = await api.get('/customers', { params: { tab: 'all' } });
      setAllCustomers(Array.isArray(r.data?.data) ? r.data.data : []);
    } catch { setAllCustomers([]); }
  };

  const doMapCustomer = async () => {
    if (!custMapId || !mappedTarget?.db_id) return;
    setCustMapping(true);
    try {
      const r = await api.post(`/consignees/${mappedTarget.db_id}/map-customer`, { customer_id: Number(custMapId) });
      toast.success('Customer mapped', 'The customer is now linked to this consignee.');
      const updated = r.data?.data;
      if (updated) {
        setMappedTarget(prev => (prev ? { ...prev, customers: updated.customers ?? prev.customers, segment: updated.segment ?? prev.segment } : prev));
      }
      setCustMapOpen(false);
      fetchRows();
    } catch (e: any) {
      toast.error('Map failed', e?.response?.data?.message ?? 'Please try again.');
    } finally { setCustMapping(false); }
  };
  const [deleting, setDeleting] = useState(false);

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

      const toolbarH = (el.querySelector('.smcg-toolbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('.smcg-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;
      const footerH  = (el.querySelector('.smcg-table-wrap > .row') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('.smcg-table-wrap tbody tr') as HTMLElement | null)?.offsetHeight || 40;
      const avail = h - toolbarH - theadH - footerH - 26;
      const rowsFit = Math.floor(avail / rowH);
      if (!manualSize) setPageSize(Math.max(ROWS_PER_PAGE, rowsFit));
    };
    fit();
    const t = window.setTimeout(fit, 120);
    window.addEventListener('resize', fit);
    let ro: ResizeObserver | undefined;
    const banner = document.querySelector('.smcg-wdh-body-wrap');
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
        customers:      Array.isArray(d.customers) ? d.customers : [],
        company:        d.company ?? '',
        segment:        d.segment ?? '',
        risk:           d.riskLevel ?? '',
        contact:        d.contact ?? '',
        email:          d.email ?? '',
        phone:          d.phone ?? '',
        country:        d.country ?? '',
        country_iso:    d.country_iso ?? null,
        countryDetail:  d.countryDetail ?? d.city ?? '',
        same_as_customer: !!d.same_as_customer,
      })));
    } catch (e: any) {
      toast.error('Failed to load consignees', e?.response?.data?.message ?? 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
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

  const filtered = useMemo(() => {
    /* Facet filters first, then the free-text search — the predicate lives in
     * PartyFilterModal (applyPartyFilters) so the modal that collects the
     * selections and this page can't drift on what a filter means. */
    let base = applyPartyFilters(rows, filters);
    const lo = q.trim().toLowerCase();
    if (!lo) return base;
    const m = (v: unknown) => String(v ?? '').toLowerCase();
    return base.filter(c =>
      m(c.company).includes(lo)        ||
      m(c.id).includes(lo)             ||
      m(c.customerId).includes(lo)     ||
      m(c.contact).includes(lo)        ||
      m(c.email).includes(lo)          ||
      m(c.phone).includes(lo)          ||
      m(c.segment).includes(lo)        ||
      m(c.country).includes(lo)        ||
      m(c.countryDetail).includes(lo)  ||
      m(c.risk).includes(lo),
    );
  }, [q, rows, filters]);
  const activeFilterCount = countPartyFilterValues(filters);

  const onSearch = (v: string) => { setQ(v); };
  const soon = (label: string) => toast.info(label, 'Coming in next phase');

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
      meta: { align: 'center' },
      cell: (info: any) => <span className="smcg-id-chip">{info.getValue()}</span>,
    },
    {
      header: 'Customer ID',
      accessorKey: 'customerId',
      meta: { align: 'start' },
      cell: (info: any) => {
        const row = info.row.original as ConsigneeRow;
        const list = (row.customers ?? []).map(c => c.code || `C-${c.id}`);
        // Fall back to the single primary code for rows loaded before the
        // many-to-many payload existed.
        const chips = list.length > 0 ? list : [String(info.getValue() ?? '')].filter(Boolean);
        if (chips.length === 0) return <span className="text-muted">—</span>;
        // Show the first customer + a "+N" chip; clicking "+N" reveals a compact
        // popover of just the mapped customer IDs (QA #22) — it no longer opens
        // the full Map-Customer popup (still reachable from the Actions column).
        const custPopId = `cust-${row.id}`;
        return (
          <span className="d-inline-flex align-items-center" style={{ gap: 4, justifyContent: 'flex-start' }}>
            <span className="smcg-cust-chip">{chips[0]}</span>
            {chips.length > 1 && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSegOpen(prev => prev?.id === custPopId ? null : { id: custPopId, names: chips, x: b.left, y: b.bottom + 4, title: 'Customer IDs' });
                }}
                className="smcg-cust-chip"
                style={{ cursor: 'pointer', background: '#ede9fe', color: '#5b21b6', fontWeight: 700 }}
                title="View all mapped customer IDs"
              >
                +{chips.length - 1}
              </span>
            )}
          </span>
        );
      },
    },
    {
      header: 'Company Name',
      accessorKey: 'company',
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smcg-company" max={16} />,
    },
    {
      header: 'Segment',
      accessorKey: 'segment',
      meta: { align: 'start' },
      cell: (info: any) => {
        const segList = String(info.getValue() ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
        if (segList.length === 0) return <span className="text-muted">—</span>;
        const extra = segList.length - 1;
        const rowId = (info.row.original as ConsigneeRow).id;
        return (
          <span className="d-inline-flex align-items-center" style={{ gap: 4 }}>
            <span className="smcg-seg">{segList[0]}</span>
            {extra > 0 && (
              <button
                type="button"
                className="smcg-seg-more"
                title="View all segments"
                onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(prev => prev?.id === rowId ? null : { id: rowId, names: segList, x: b.left, y: b.bottom + 4 }); }}
              >+{extra}</button>
            )}
          </span>
        );
      },
    },
    {
      /* Domestic vs International — DERIVED from the consignee's own country
         (the one shown in the Country column), not stored, so it always agrees
         with the address and with the filter's Consignee Type facet (both call
         isDomesticParty). */
      header: 'Consignee Type',
      id: 'tradeType',
      accessorFn: (row: ConsigneeRow) => (isDomesticParty(row) ? 'Domestic' : 'International'),
      meta: { align: 'start' },
      cell: (info: any) => {
        const domestic = info.getValue() === 'Domestic';
        return (
          <span className={`smcg-trade-pill ${domestic ? 'is-domestic' : 'is-intl'}`}>
            {info.getValue()}
          </span>
        );
      },
    },
    {
      header: 'Risk Level',
      accessorKey: 'risk',
      meta: { align: 'start' },
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
    {
      header: 'Same as Customer',
      accessorKey: 'same_as_customer',
      meta: { align: 'center' },
      cell: (info: any) => {
        const yes = !!info.getValue();
        return (
          <span className={`smcg-sac-pill ${yes ? 'is-yes' : 'is-no'}`}>{yes ? 'Yes' : 'No'}</span>
        );
      },
    },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smcg-contact" max={16} /> },
    /* Email absorbs the table's leftover width (see SalesConsignee.css); its
       caps are raised so that width shows address rather than blank space. */
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <TruncatedCell value={i.getValue()} className="smcg-email" caseSensitive /> },
    { header: 'Contact No',     accessorKey: 'phone',   meta: { align: 'center' }, cell: (i: any) => <span className="smcg-mono">{i.getValue() || '—'}</span> },
    {
      header: 'Country',
      accessorKey: 'country',
      meta: { align: 'center' },
      cell: (info: any) => {
        const c = info.row.original as Consignee;
        const country = (c.country ?? '').trim();
        if (!country) return <span className="text-muted">—</span>;
        // Show the short ISO code (aligned) with the full name on hover; fall
        // back to the raw name when the master has no match (QA #20).
        const iso = c.country_iso;
        return (
          <span className="smcg-country" style={{ whiteSpace: 'nowrap' }} title={iso ? country : undefined}>
            {iso || country}
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
          <div className="smcg-actions">
            {canEdit && (
              <Tooltip label="Edit Consignee">
                <button type="button" className="smcg-act smcg-act-edit" onClick={() => { setEditing(c); setAddOpen(true); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
              </Tooltip>
            )}
            <Tooltip label="Evidence Vault">
              <button
                type="button"
                className="smcg-act smcg-act-vault"
                onClick={() => setVaultTarget({
                  id: c.id,
                  db_id: c.db_id,
                  company: c.company,
                  risk: c.risk,
                  segment: c.segment,
                  country: c.country,
                  contact: c.contact,
                  contactCity: c.countryDetail,
                  customerId: c.customerId,
                })}
              >
                <i className="ri-archive-line" />
              </button>
            </Tooltip>
            <Tooltip label="Mapped Customers">
              <button type="button" className="smcg-act smcg-act-vault" onClick={() => setMappedTarget(c)}>
                <i className="ri-links-line" />
              </button>
            </Tooltip>
          </div>
        );
      },
    },
  ], [canEdit]);
  if (!canView) {
    return (
      <div className="smcg-root">

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

      <div className="smcg-cstrip">
        <span className="smcg-cstrip__accent" />
        <span className="smcg-cstrip__glow" />
        <span className="smcg-cstrip__sheen" />
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

      <div className="smcg-table-card" ref={tableCardRef}>

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
          {/* Filter — opens the same two-pane modal the Lead Worksheet and the
              Customer list use. The badge shows how many values are active, so
              a filtered table is never mistaken for an empty one. */}
          <button
            type="button"
            className={`smcg-filter-btn ${activeFilterCount > 0 ? 'on' : ''}`}
            onClick={() => setFilterOpen(true)}
          >
            <i className="ri-equalizer-line" />
            Filter
            {activeFilterCount > 0 && <span className="smcg-filter-badge">{activeFilterCount}</span>}
          </button>
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
            <ShimmerTable rows={pageSize} cols={13} />
          ) : (
            <TableContainer
              key={q.trim() ? 'search-mode' : 'all-mode'}
              columns={columns}
              data={filtered}
              isGlobalFilter={false}
              customPageSize={pageSize}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card border rounded"
              SearchPlaceholder="Search consignees..."
              worklistPagination
              pageSizeOptions={[5, 10, 15, 25, 50]}
              onPageSizeChange={(n) => { setManualSize(true); setPageSize(n); }}
            />
          )}
          {/* Says WHY the table is empty — a bare "No consignees found" while a
              filter is on reads as "there is no data" rather than "nothing
              matches this filter", and the selections live inside the modal
              where the user can't see them from here. */}
          {!loading && filtered.length === 0 && (
            <div className="smcg-empty py-4">
              {rows.length > 0 && activeFilterCount > 0 ? (
                <>
                  No consignees match the {activeFilterCount} selected filter{activeFilterCount > 1 ? 's' : ''}
                  {' — '}
                  <button type="button" className="smcg-empty-link" onClick={() => setFilters({})}>clear filters</button>
                </>
              ) : 'No consignees found'}
            </div>
          )}
        </div>
      </div>

      {/* Options derive from `rows` (everything loaded), NOT `filtered` —
          deriving from already-filtered rows would make each pick narrow the
          choices left, so a user could never widen a filter without resetting. */}
      <PartyFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
        initial={filters}
        rows={rows}
        facets={CONSIGNEE_FACETS}
        title="Filter Consignees"
        typeLabel="Consignee Type"
        theme="emerald"
      />

      {addOpen && (
        <Suspense fallback={null}>
          <AddConsigneeModal
            open={addOpen}
            consignee={editing}
            onClose={() => { setAddOpen(false); setEditing(null); }}
            onSaved={() => { fetchRows(); }}
          />
        </Suspense>
      )}

      <DeleteConfirmModal
        open={!!delTarget}
        title="Delete Consignee"
        itemName={delTarget?.company}
        subMessage="This will permanently delete the consignee and all linked addresses. The action cannot be undone."
        onClose={() => { if (!deleting) setDelTarget(null); }}
        onConfirm={handleDelete}
        loading={deleting}
      />

      {!!vaultTarget && (
        <Suspense fallback={null}>
          <ConsigneeEvidenceVaultModal
            open={!!vaultTarget}
            consignee={vaultTarget}
            onClose={() => setVaultTarget(null)}
          />
        </Suspense>
      )}

      {segOpen && (() => {
        // Keep the popover fully on-screen — clamp its anchor so it never bleeds
        // below the fold when the "+N" is near the bottom of the list (mirrors
        // the customer list fix). Reserve the real height (short lists) or the
        // 280px scroll cap so the bottom rows stay visible.
        // Show ~3 segment rows at a time; the rest go behind the scrollbar.
        // Title stays pinned — only the rows list scrolls.
        const ROWS_MAX_H = 108;            // ≈ 3 rows (~34px each)
        const estH = Math.min(24 + ROWS_MAX_H + 16, 40 + segOpen.names.length * 34);
        const left = Math.max(8, Math.min(segOpen.x, window.innerWidth - 230));
        const top  = Math.max(8, Math.min(segOpen.y, window.innerHeight - estH - 8));
        return createPortal(
          <>
            <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
            <div className="smcg-seg-pop" style={{ position: 'fixed', left, top, zIndex: 1091, width: 210, borderRadius: 12, padding: 8 }}>
              <div className="smcg-seg-pop-title">{segOpen.title ?? 'Segments'} ({segOpen.names.length})</div>
              <div style={{ maxHeight: ROWS_MAX_H, overflowY: 'auto' }}>
                {segOpen.names.map((name, i) => (
                  <div key={i} className={`smcg-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                    {/* Customer-ID chips keep the violet customer palette;
                        segment chips stay green. */}
                    <span className={segOpen.title === 'Customer IDs' ? 'smcg-cust-chip' : 'smcg-seg'}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body
        );
      })()}

      {/* Mapped Customers — table modal styled like the customer module
          (purple palette), full column set. */}
      {mappedTarget && createPortal(
        <div onMouseDown={() => { setMappedTarget(null); setMappedSeg(null); setCustMapOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 1096, background: 'rgba(46,16,101,.50)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: '96vw', maxWidth: 1280, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: mc.card, borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.45)' }}>
            {/* Header — purple gradient (customer module palette) + dotted texture. */}
            <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '20px', background: 'linear-gradient(135deg,#4c1d95 0%,#6d28d9 50%,#7c3aed 100%)', color: '#fff', flexShrink: 0 }}>
              {/* Dotted overlay effect. */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: .5, backgroundImage: 'radial-gradient(rgba(255,255,255,.35) 1.4px, transparent 1.5px)', backgroundSize: '16px 16px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <i className="ri-links-line" style={{ fontSize: 20 }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>Mapped Customers</div>
                  <div style={{ fontSize: 12.5, opacity: .9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Customers linked to <strong>{mappedTarget.id}</strong> · {mappedTarget.company}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {canEdit && (() => {
                  // A "Same as Customer" consignee mirrors exactly ONE customer,
                  // so it can't be mapped to more — disable Map Customer and
                  // explain why on click.
                  const sac = !!mappedTarget.same_as_customer;
                  return (
                    <button
                      type="button"
                      aria-disabled={sac}
                      onClick={() => {
                        if (sac) { toast.warning('Same as Customer', 'This consignee is “Same as Customer”, so it can be linked to only one customer. Turn off Same as Customer to map more.'); return; }
                        custMapOpen ? setCustMapOpen(false) : openCustMap();
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, background: '#fff', color: '#6d28d9', border: 'none', borderRadius: 9, padding: '7px 13px', cursor: sac ? 'not-allowed' : 'pointer', opacity: sac ? 0.5 : 1 }}
                    >
                      <i className="ri-link" /> Map Customer
                    </button>
                  );
                })()}
                <span style={{ fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,.16)', borderRadius: 20, padding: '3px 12px' }}>{(mappedTarget.customers ?? []).length} {(mappedTarget.customers ?? []).length === 1 ? 'customer' : 'customers'}</span>
                <button type="button" onClick={() => setMappedTarget(null)} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            </div>

            {/* Map Customer — its own centered popup (above the Mapped
                Customers modal). Pick a customer NOT already mapped; the
                consignee's segments update with the customer's. */}
            {custMapOpen && (() => {
              // mappedTarget.customers[].id is the numeric DB id; the /customers
              // list exposes the numeric id as `db_id` (its `id` is the display
              // code). Match + send the numeric db_id, not the code.
              const mappedIds = new Set((mappedTarget.customers ?? []).map(c => c.id));
              const options = allCustomers
                .filter(c => typeof c.db_id === 'number' && !mappedIds.has(c.db_id))
                .map(c => ({ value: String(c.db_id), label: `${c.id} — ${c.company ?? ''}` }));
              return (
                <div onMouseDown={() => !custMapping && setCustMapOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1099, background: 'rgba(46,16,101,.55)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                  <div onMouseDown={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 470, background: mc.card, borderRadius: 16, overflow: 'visible', boxShadow: '0 26px 64px rgba(0,0,0,.45)' }}>
                    <div style={{ padding: '17px 20px', background: 'linear-gradient(135deg,#4c1d95,#6d28d9 55%,#7c3aed)', color: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800 }}>Map Customer</div>
                      <div style={{ fontSize: 12.5, opacity: .92, marginTop: 2 }}>Link a customer to <strong>{mappedTarget.id}</strong> · {mappedTarget.company}. Its segments update accordingly.</div>
                    </div>
                    <div style={{ padding: 18 }}>
                      <label style={{ fontSize: 11.5, fontWeight: 700, color: mc.textStrong, textTransform: 'uppercase', letterSpacing: .4, display: 'block', marginBottom: 6 }}>Customer</label>
                      <MasterSelect value={custMapId} onChange={(v) => setCustMapId(v)} placeholder="Select a customer to map…" options={options} />
                      {options.length === 0 && (
                        <div style={{ fontSize: 12, color: mc.textMuted, marginTop: 8 }}>No other customers available to map.</div>
                      )}
                    </div>
                    <div style={{ padding: '0 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" onClick={() => setCustMapOpen(false)} disabled={custMapping} style={{ border: `1px solid ${mc.border}`, background: mc.card, color: mc.textStrong, borderRadius: 9, padding: '8px 16px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                      <button type="button" onClick={doMapCustomer} disabled={!custMapId || custMapping} style={{ border: 'none', background: custMapId && !custMapping ? 'linear-gradient(135deg,#6d28d9,#7c3aed)' : (isDark ? 'rgba(124,58,237,.3)' : '#ddd6fe'), color: '#fff', borderRadius: 9, padding: '8px 18px', fontWeight: 700, fontSize: 12.5, cursor: custMapId && !custMapping ? 'pointer' : 'not-allowed' }}>{custMapping ? 'Mapping…' : 'Map Customer'}</button>
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Table — ~5 rows visible, the rest scroll (header ~44px + 5×~46px). */}
            <div style={{ padding: '12px 18px 18px', maxHeight: 320, overflowX: 'auto', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, borderRadius: 10, overflow: 'hidden', minWidth: 780 }}>
                <thead>
                  <tr style={{ background: 'linear-gradient(110deg,#6d28d9 0%,#7c3aed 55%,#5b21b6 100%)' }}>
                    {['SR NO', 'CUSTOMER ID', 'COMPANY NAME', 'SEGMENT', 'TYPE', 'COUNTRY', 'CONTACT PERSON', 'CONTACT NO'].map((h, i) => (
                      <th key={h} style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, letterSpacing: .3, textAlign: i === 0 ? 'center' : 'left', padding: '11px 14px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(mappedTarget.customers ?? []).length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: mc.textMuted, padding: '26px 0', fontSize: 13 }}>Not mapped to any customer yet.</td></tr>
                  ) : (
                    (mappedTarget.customers ?? []).map((cu, i) => {
                      const segList = String(cu.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
                      return (
                        <tr key={cu.id} style={{ background: i % 2 ? mc.rowAlt : mc.rowBase }}>
                          <td style={{ textAlign: 'center', padding: '10px 14px', fontSize: 13, color: mc.textMuted, borderBottom: `1px solid ${mc.border}` }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', borderBottom: `1px solid ${mc.border}` }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: mc.chipFg, background: mc.chipBg, borderRadius: 8, padding: '2px 9px', whiteSpace: 'nowrap' }}>{cu.code || `C-${cu.id}`}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: mc.textStrong, borderBottom: `1px solid ${mc.border}`, whiteSpace: 'nowrap' }}>{cu.name || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12.5, color: mc.textMuted, borderBottom: `1px solid ${mc.border}` }}>
                            {segList.length === 0 ? '—' : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ background: mc.chipBg, color: mc.chipFg, borderRadius: 6, padding: '1px 8px', fontSize: 11.5, fontWeight: 600 }}>{segList[0]}</span>
                                {segList.length > 1 && (
                                  <span
                                    role="button"
                                    onClick={(e) => { e.stopPropagation(); setMappedSeg({ names: segList, x: e.clientX, y: e.clientY }); }}
                                    style={{ cursor: 'pointer', fontSize: 11, color: mc.chipFg, fontWeight: 700, background: mc.chipBg, borderRadius: 6, padding: '1px 6px' }}
                                    title="Show all segments"
                                  >
                                    +{segList.length - 1}
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#475569', borderBottom: `1px solid ${mc.border}`, whiteSpace: 'nowrap' }}>{cu.type || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12.5, color: mc.textMuted, borderBottom: `1px solid ${mc.border}`, whiteSpace: 'nowrap' }}>{cu.country || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12.5, color: mc.textMuted, borderBottom: `1px solid ${mc.border}`, whiteSpace: 'nowrap' }}>{cu.contact || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12.5, color: mc.textMuted, borderBottom: `1px solid ${mc.border}`, whiteSpace: 'nowrap' }}>{cu.phone || '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* "+N" segment overflow popover for the Mapped Customers modal. */}
      {mappedSeg && createPortal(
        <>
          <div onClick={() => setMappedSeg(null)} style={{ position: 'fixed', inset: 0, zIndex: 1097 }} />
          <div style={{ position: 'fixed', left: Math.min(mappedSeg.x, window.innerWidth - 220), top: mappedSeg.y + 10, zIndex: 1098, width: 200, maxHeight: 260, overflowY: 'auto', background: mc.popBg, borderRadius: 10, boxShadow: '0 14px 34px rgba(0,0,0,.35)', padding: 8, border: `1px solid ${mc.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: mc.chipFg, marginBottom: 6, textTransform: 'uppercase', letterSpacing: .3 }}>Segments ({mappedSeg.names.length})</div>
            {mappedSeg.names.map((n, i) => (
              <div key={i} style={{ fontSize: 12.5, color: mc.textStrong, padding: '5px 7px', borderRadius: 6, background: i % 2 ? mc.rowAlt : 'transparent' }}>{n}</div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

const STEPS: { n: number; name: string; desc: string; tag: string }[] = [
  { n: 1, name: 'Create Consignee',           desc: 'Add consignee company, address, country, and contact details.',                tag: 'Foundation Step' },
  { n: 2, name: 'Customer & Trade Linkage',   desc: 'Map consignee with the correct customer and trade flow.',                       tag: 'Relationship Mapping' },
  { n: 3, name: 'Compliance & Risk Details',  desc: 'Capture compliance, country risk, and required document details.',              tag: 'Risk & Compliance' },
  { n: 4, name: 'Shipment & Export Readiness',desc: 'Prepare consignee for PI, shipment, export, and execution workflows.',          tag: 'Final Execution' },
];

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
