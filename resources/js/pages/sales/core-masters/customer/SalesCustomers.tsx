import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SegmentBadge, { SegmentNameBadge } from '../../../../components/ui/SegmentBadge';
import '../../../../components/ui/DataTable.css';
import '../../../p2p/p2p-master-management/supplier-management/supplier-management.css';
import './SalesCustomers.css';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import Tooltip from '../../../../components/ui/Tooltip';
import { type EditCustomer } from './AddCustomerModal';
import { type CustomerLite } from './CustomerConsigneesModal';
import { type CustomerVaultTarget } from './CustomerEvidenceVaultModal';
import { ShimmerTable } from '../../../../components/ui/Shimmer';
import FilterChipsBar from '../FilterChipsBar';
import useDismissPopover from '../../../../hooks/useDismissPopover';
import AddCustomerModalShimmer from './AddCustomerModalShimmer';
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
import { lazyPage } from '../../../../utils/lazyPage';

const AddCustomerModal = lazyPage(() => import('./AddCustomerModal'));
const CustomerConsigneesModal = lazyPage(() => import('./CustomerConsigneesModal'));
const CustomerEvidenceVaultModal = lazyPage(() => import('./CustomerEvidenceVaultModal'));
function SegChip({ name, status, split = false }: { name: string; status?: string | null; split?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const clipped = useIsClipped(ref, name);
  if (split) {
    const pill = <span ref={ref} className="smc-seg">{name}</span>;
    return (
      <>
        {clipped ? <Tooltip label={name}>{pill}</Tooltip> : pill}
        {status !== undefined
          ? <SegmentBadge status={status} style={{ marginLeft: 'auto', flexShrink: 0 }} />
          : <SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      </>
    );
  }
  const chip = (
    <span className="smc-seg smc-seg--withbadge">
      <span ref={ref} className="smc-seg-name">{name}</span>
      {status !== undefined
        ? <SegmentBadge status={status} style={{ marginLeft: 0, flexShrink: 0 }} />
        : <SegmentNameBadge name={name} style={{ marginLeft: 0 }} />}
    </span>
  );
  return clipped ? <Tooltip label={name}>{chip}</Tooltip> : chip;
}

type Customer = {
  id: string; db_id?: number;
  company: string; type: string; segment: string;
  /** Each segment with its own Reg status — two may share a name. */
  segments?: { id: number; code?: string | null; name: string; regulatory_status?: string | null }[];
  country: string; country_iso?: string | null; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No'; consignees: number;
  riskLevel?: string | null; city?: string | null;
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
  const ref = useRef<HTMLSpanElement>(null);

  const raw = (value ?? '').trim();
  const v = raw ? (caseSensitive ? raw : titleCase(raw)) : '';
  const clipped = useIsClipped(ref, v);
  if (!raw) return <span className="text-muted">—</span>;
  const jsTrunc = v.length > max;
  const display = jsTrunc ? v.slice(0, max) + '…' : v;
  const inner = <span ref={ref} className={className} style={{ maxWidth, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{display}</span>;
  return (jsTrunc || clipped) ? <Tooltip label={v}>{inner}</Tooltip> : inner;
};

function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}


const bottomReserve = (): number => {
  if (typeof document === 'undefined') return 15;
  const f = document.querySelector('footer.footer') as HTMLElement | null;
  // Reserve the footer height + 8px so the card ends above it (see DataTable).
  const fh = f?.offsetHeight ?? 0;
  return fh > 0 ? fh + 8 : 15;
};

export default function SalesCustomers() {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const customerPerm = user?.permissions?.['sales.customers'];
  const canView   = isSuperAdmin || !!customerPerm?.can_view;
  const canAdd    = isSuperAdmin || !!customerPerm?.can_add;
  const canEdit   = isSuperAdmin || !!customerPerm?.can_edit;

  const [tab, setTab] = useState<'all' | 'fresh' | 'recurring'>('all');

  const [filters, setFilters] = useState<PartyFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const [tabSwitching, setTabSwitching] = useState(false);

  useEffect(() => {
    setTabSwitching(true);
    const t = window.setTimeout(() => setTabSwitching(false), 450);
    return () => window.clearTimeout(t);
  }, [tab]);
  const [q, setQ] = useState('');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [segOpen, setSegOpen] = useState<{ id: string | number; items: { name: string; status?: string | null }[]; x: number; y: number } | null>(null);

  useDismissPopover(!!segOpen, () => setSegOpen(null), { inside: '.smc-seg-pop', watch: tab });
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
  const [manualSize, setManualSize] = useState(false);
  useEffect(() => {
    const el = tableCardRef.current;
    if (!el) return;
    const fit = (heightOnly = false) => {

      const headH = (el.querySelector('.smc-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;
      if (headH) el.style.setProperty('--smc-thead-h', `${headH}px`);
      const footH = (el.querySelector('.smc-table-wrap .tc-wl-pag') as HTMLElement | null)?.offsetHeight || 0;
      if (footH) el.style.setProperty('--smc-foot-h', `${footH}px`);


      const scroller = (el.closest('.main-content') as HTMLElement | null) ?? null;
      const offsetTop = scroller
        ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : el.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0);
      const spaceH = scroller ? scroller.clientHeight : window.innerHeight;
      const cardSpace = spaceH - offsetTop - bottomReserve();

      delete el.dataset.unpinned;
      const h = Math.max(240, cardSpace);

      const next = `${h}px`;
      if (el.style.height !== next) {
        el.style.flex = 'none';
        el.style.height = next;
        el.style.maxHeight = next;
      }

      if (heightOnly || manualSize) return;   // user chose a Rows-per-page value — don't override it
      const toolbarH = (el.querySelector('.smc-toolbar') as HTMLElement | null)?.offsetHeight || 0;

      const filterbarH = (el.querySelector('.smc-filterbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('.smc-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;

      const footerH  = (el.querySelector('.tc-wl-pag, .smc-table-wrap > .row') as HTMLElement | null)?.offsetHeight || 0;
      const rowEl    = el.querySelector('.smc-table-wrap tbody tr') as HTMLElement | null;
      const rowH     = rowEl?.getBoundingClientRect().height || 44;

      const scrollBox = el.querySelector('.smc-table-wrap .table-responsive') as HTMLElement | null;
      const avail = scrollBox
        ? scrollBox.clientHeight - theadH
        : h - toolbarH - filterbarH - theadH - footerH - 8;

      const rowsFit = Math.max(5, Math.floor((avail + 2) / rowH));
      setPageSize(rowsFit);
    };
    const onResize = () => fit();
    fit();
    const t = window.setTimeout(onResize, 120);
    window.addEventListener('resize', onResize);
    let ro: ResizeObserver | undefined;
    let roSettle: (() => void) | undefined;
    const banner = document.querySelector('.smc-bref');
    if (banner && typeof ResizeObserver !== 'undefined') {

      let lastH = (banner as HTMLElement).getBoundingClientRect().height;

      let settle: number | undefined;
      ro = new ResizeObserver(entries => {
        const h = entries[0]?.contentRect.height ?? 0;
        if (Math.abs(h - lastH) < 1) return;
        lastH = h;
        fit(true);
        window.clearTimeout(settle);
        settle = window.setTimeout(onResize, 180);
      });
      ro.observe(banner);
      roSettle = () => window.clearTimeout(settle);
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      roSettle?.();
      ro?.disconnect();
    };
  }, [wdhOpen, loading, manualSize]);

  const debouncedQ = useDebouncedValue(q, 300);

  const reqIdRef = useRef(0);

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
    setTab(next);   // the shimmer rides the `tab` effect above
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
      cell: (info: any) => <span className="dt-serial">{info.row.index + 1}</span>,
      enableSorting: false,
    },
    {
      header: 'Customer ID',
      accessorKey: 'id',
      meta: { align: 'center' },
      cell: (info: any) => <span className="dt-id-chip">{info.getValue()}</span>,
    },
    {
      header: 'Company Name',
      accessorKey: 'company',
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smc-company" />,
    },
    {
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
        const row = info.row.original as Customer;
        const segList: { name: string; status?: string | null }[] = row.segments?.length
          ? row.segments.map(s => ({ name: s.name, status: s.regulatory_status ?? null }))
          : String(info.getValue() ?? '').split(',').map((s: string) => s.trim()).filter(Boolean).map((name: string) => ({ name }));
        if (segList.length === 0) return <span className="text-muted">—</span>;
        const extra = segList.length - 1;
        const rowId = row.id;
        return (
          <span className="d-inline-flex align-items-center" style={{ gap: 4, maxWidth: '100%', minWidth: 0 }}>
            {/* Pill truncates via CSS (.smc-seg); SegChip hangs the hover
                reveal on it when the name is really cut (QA #39 / #43). */}
            <SegChip name={segList[0].name} status={segList[0].status} />
            {extra > 0 && (
              <Tooltip label={`View ${extra} more`}>
                <button
                  type="button"
                  className="smc-seg-more"
                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(prev => prev?.id === rowId ? null : { id: rowId, items: segList, x: b.left, y: b.bottom + 4 }); }}
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
                         contactCity: c.city ?? undefined,
                         risk: c.riskLevel ?? undefined,
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

      <div className="sup-fig">
        <div className="cstrip">
          <span className="cstrip__accent" />
          <span className="cstrip__glow" />
          <span className="cstrip__sheen" />
          <div className="cstrip__left">
            <div className="cstrip__avatar-wrap">
              <div className="cstrip__avatar"><i className="ri-group-line" style={{ fontSize: 17, color: '#fff' }} /></div>
              <span className="cstrip__online-dot" />
            </div>
            <div className="min-w-0">
              <div className="cstrip__title">Customers</div>
              <div className="cstrip__sub">Manage customer onboarding and lifecycle with strict compliance, KYC verification, and product mapping for sales readiness.</div>
            </div>
          </div>
          {canAdd && (
            <div className="cstrip__right">
              <button
                type="button"
                className="cstrip__action-btn"
                onClick={() => { setEditing(null); setAddOpen(true); }}
              >
                <span className="cstrip__action-btn-sheen" />
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Customer
              </button>
            </div>
          )}
        </div>
        <div className={`bref-box smc-bref ${wdhOpen ? '' : 'is-collapsed'}`}>
          <div className="bref-box__header" onClick={() => setWdhOpen(o => !o)} role="button">
            <div className="bref-box__header-ico"><i className="ri-group-line" style={{ fontSize: 15 }} /></div>
            <div className="bref-box__header-mid">
              <div className="bref-box__header-row">
                <div className="bref-box__header-label">Customers</div>
                <div className="bref-box__header-sep" />
                <div className="bref-box__header-title">What We Are Doing Here</div>
              </div>
              <div className="bref-box__header-sub">4 steps to complete customer setup.</div>
            </div>
            <div className="bref-box__header-right">
              <div className="bref-box__toggle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
          </div>
          <div className="bref-box__body">
            {STEPS.map(s => (
              <div className="bref-item" key={s.n}>
                <div className="bref-item__top">
                  <div className="bref-item__ico"><i className={s.icon} style={{ fontSize: 12 }} /></div>
                  <span className="bref-item__num">Step {String(s.n).padStart(2, '0')}</span>
                </div>
                <div className="bref-item__title">{s.name}</div>
                <div className="bref-item__desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="smc-table-card dt-root hr-dt" data-accent="violet" ref={tableCardRef}>

        <div className="smc-toolbar">
          <div className="dt-tabrail hr-dt flex-shrink-0" data-accent="violet">
            <div className="dt-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'all'} className={`dt-tab ${tab === 'all' ? 'on' : 'off'}`} onClick={() => switchTab('all')}>
                <i className="ri-list-check-2" /> All Customers
                <span className="dt-tab-count">{tabCounts.all}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'fresh'} className={`dt-tab ${tab === 'fresh' ? 'on' : 'off'}`} onClick={() => switchTab('fresh')}>
                <i className="ri-group-line" /> Fresh Customers
                <span className="dt-tab-count">{tabCounts.fresh}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'recurring'} className={`dt-tab ${tab === 'recurring' ? 'on' : 'off'}`} onClick={() => switchTab('recurring')}>
                <i className="ri-refresh-line" /> Recurring Customers
                <span className="dt-tab-count">{tabCounts.recurring}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`dt-filter-btn ${activeFilterCount > 0 ? 'on' : ''}`}
            onClick={() => setFilterOpen(true)}
          >
            <i className="ri-equalizer-line" />
            Filter
            {activeFilterCount > 0 && <span className="dt-filter-badge">{activeFilterCount}</span>}
          </button>
          <div className="dt-search">
            <i className="ri-search-line dt-search-icon" />
            <input
              type="search"
              name="customer-list-search"
              autoComplete="new-password"
              data-lpignore="true"
              data-form-type="other"
              placeholder="Search by name, ID, company, email, segment..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
            {q && (
              <button type="button" className="dt-search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                <i className="ri-close-line" />
              </button>
            )}
          </div>
        </div>

        <FilterChipsBar chips={filterChips} onClearAll={() => setFilters({})} prefix="smc" />

        <div className="smc-table-wrap">
          {(loading && customers.length === 0) || tabSwitching ? (
            <ShimmerTable rows={pageSize} cols={13} />
          ) : (
            <TableContainer
              columns={columns}
              data={visibleCustomers}
              isGlobalFilter={false}
              customPageSize={pageSize}
              tableClass="table align-middle table-nowrap mb-0 dt-table"
              theadClass="table-light"
              divClass="table-responsive"
              SearchPlaceholder="Search customers..."
              worklistPagination
              pageSizeOptions={[5, 10, 15, 25, 50]}
              onPageSizeChange={(n) => { setManualSize(true); setPageSize(n); }}
            />
          )}

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
        className="smc-filter-modal"
      />

      {addOpen && (
        <Suspense fallback={<AddCustomerModalShimmer title={editing ? `Edit Customer — ${editing.company || editing.id}` : 'Add Customer'} />}>
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
        const ROWS_MAX_H = 108;            // ≈ 3 rows (~34px each)
        const estH = Math.min(24 + ROWS_MAX_H + 16, 40 + segOpen.items.length * 34);
        const left = Math.max(8, Math.min(segOpen.x, window.innerWidth - 230));
        const top  = Math.max(8, Math.min(segOpen.y, window.innerHeight - estH - 8));
        return createPortal(
          <>
            <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
            <div className="smc-seg-pop" style={{ position: 'fixed', left, top, zIndex: 1091, width: 268, borderRadius: 12, padding: 8 }}>
              <div className="smc-seg-pop-title">Segments ({segOpen.items.length})</div>
              <div style={{ maxHeight: ROWS_MAX_H, overflowY: 'auto' }}>
                {segOpen.items.map((it, i) => (
                  <div key={i} className={`smc-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                    <SegChip name={it.name} status={it.status} split />
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

const STEPS: { n: number; name: string; desc: string; icon: string }[] = [
  { n: 1, name: 'Create Customer',  desc: 'Add basic company, contact, and legal details to create the customer profile.', icon: 'ri-user-add-line' },
  { n: 2, name: 'Customer KYC',     desc: 'Check documents, identity, GST scrutiny & compliance to validate customer authenticity.', icon: 'ri-shield-check-line' },
  { n: 3, name: 'Trade Document',   desc: 'Execute agreements digitally to make the customer legally approved for trade.', icon: 'ri-file-text-line' },
  { n: 4, name: 'Product Mapping',  desc: 'Link customer with products, pricing, and tax details for sales use.', icon: 'ri-links-line' },
];
