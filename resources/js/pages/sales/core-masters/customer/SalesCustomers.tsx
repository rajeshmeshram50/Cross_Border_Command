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
import api from '../../../../api';
import TableContainer from '../../../../velzon/Components/Common/TableContainerReactTable';
import { readCustomerMasterBundle, writeCustomerMasterBundle } from './customerBundleCache';

// Heavy modals are code-split: their chunks (and TipTap/face-api/pdf deps)
// download only when first opened, not on the customer list's first paint.
const AddCustomerModal = lazy(() => import('./AddCustomerModal'));
const CustomerConsigneesModal = lazy(() => import('./CustomerConsigneesModal'));
const CustomerEvidenceVaultModal = lazy(() => import('./CustomerEvidenceVaultModal'));
type Customer = {
  id: string; db_id?: number;
  company: string; type: string; segment: string;
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No'; consignees: number;
  hasSameAsCustomerConsignees?: boolean;
  sameAsCustomerConsigneeCount?: number;
};
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

  const [tab, setTab] = useState<'fresh' | 'recurring'>('fresh');

  const [tabSwitching, setTabSwitching] = useState(false);
  const [q, setQ] = useState('');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [segOpen, setSegOpen] = useState<{ id: string | number; names: string[]; x: number; y: number } | null>(null);
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
  useEffect(() => {
    const el = tableCardRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const h = Math.max(240, window.innerHeight - top - 15);
      el.style.flex = 'none';
      el.style.height = `${h}px`;
      el.style.maxHeight = `${h}px`;

      const toolbarH = (el.querySelector('.smc-toolbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('.smc-table-wrap thead') as HTMLElement | null)?.offsetHeight || 0;
      const footerH  = (el.querySelector('.smc-table-wrap > .row') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('.smc-table-wrap tbody tr') as HTMLElement | null)?.offsetHeight || 40;
      const avail = h - toolbarH - theadH - footerH - 26;
      const rowsFit = Math.floor(avail / rowH);
      setPageSize(Math.max(ROWS_PER_PAGE, rowsFit));
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
  }, [wdhOpen, loading]);

  const debouncedQ = useDebouncedValue(q, 300);
  const fetchCustomers = useCallback(() => {
    setLoading(true);
    api.get('/customers', { params: { tab, q: debouncedQ } })
      .then(r => {
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setCustomers(list);
      })
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [tab, debouncedQ]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

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

  const switchTab = (next: 'fresh' | 'recurring') => {
    if (next === tab) return;
    setTabSwitching(true);
    setTab(next);
    window.setTimeout(() => setTabSwitching(false), 450);
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
      cell: (info: any) => <TruncatedCell value={info.getValue()} className="smc-company" max={16} />,
    },
    {
      header: 'Customer Type',
      accessorKey: 'type',
      meta: { align: 'center' },
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
      meta: { align: 'center' },
      cell: (info: any) => {
        const segList = String(info.getValue() ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
        if (segList.length === 0) return <span className="text-muted">—</span>;
        const extra = segList.length - 1;
        const rowId = (info.row.original as Customer).id;
        return (
          <span className="d-inline-flex align-items-center" style={{ gap: 4 }}>
            <span className="smc-seg">{segList[0]}</span>
            {extra > 0 && (
              <button
                type="button"
                className="smc-seg-more"
                title="View all segments"
                onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(prev => prev?.id === rowId ? null : { id: rowId, names: segList, x: b.left, y: b.bottom + 4 }); }}
              >+{extra}</button>
            )}
          </span>
        );
      },
    },
    { header: 'Country',        accessorKey: 'country', meta: { align: 'center' }, cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-country" max={16} /> },
    { header: 'Contact Person', accessorKey: 'contact', cell: (i: any) => <TruncatedCell value={i.getValue()} className="smc-contact" max={16} /> },
    { header: 'Contact No',     accessorKey: 'phone',   meta: { align: 'center' }, cell: (i: any) => <span className="smc-mono">{i.getValue() || '—'}</span> },
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
          {(loading && customers.length === 0) || tabSwitching ? (
            <ShimmerTable rows={pageSize} cols={12} />
          ) : (
            <TableContainer
              columns={columns}
              data={customers}
              isGlobalFilter={false}
              customPageSize={pageSize}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card border rounded "
              SearchPlaceholder="Search customers..."
              condensedPagination
              pageOfTotalPagination
            />
          )}
          {!loading && !tabSwitching && customers.length === 0 && (
            <div className="smc-empty py-4">No customers found</div>
          )}
        </div>
      </div>

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

      {segOpen && createPortal(
        <>
          <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
          <div className="smc-seg-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 230), top: segOpen.y, zIndex: 1091, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="smc-seg-pop-title">Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} className={`smc-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                <span className="smc-seg">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

const STEPS: { n: number; name: string; desc: string }[] = [
  { n: 1, name: 'Create Customer',  desc: 'Add basic company, contact, and legal details to create the customer profile.' },
  { n: 2, name: 'Customer KYC',     desc: 'Check documents, identity, GST scrutiny & compliance to validate customer authenticity.' },
  { n: 3, name: 'Trade Document',   desc: 'Execute agreements digitally to make the customer legally approved for trade.' },
  { n: 4, name: 'Product Mapping',  desc: 'Link customer with products, pricing, and tax details for sales use.' },
];
