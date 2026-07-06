import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SalesConsignee.css';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import Tooltip from '../../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { type ConsigneeRow } from './AddConsigneeModal';
import { type ConsigneeVaultTarget } from './ConsigneeEvidenceVaultModal';
import { ShimmerTable } from '../../../../components/ui/Shimmer';
import api from '../../../../api';
import TableContainer from '../../../../velzon/Components/Common/TableContainerReactTable';
import { MasterSelect } from '../../../../components/ui/MasterSelect';

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
  const perm = user?.permissions?.['sales.consignee'];
  const canView = isSuperAdmin || !!perm?.can_view;
  const canAdd  = isSuperAdmin || !!perm?.can_add;
  const canEdit = isSuperAdmin || !!perm?.can_edit;

  const [q, setQ] = useState('');
  // "Same as Customer" filter (Yes / No / All).
  const [sacFilter, setSacFilter] = useState<'all'|'yes'|'no'>('all');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [segOpen, setSegOpen] = useState<{ id: string | number; names: string[]; x: number; y: number } | null>(null);
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
    let base = rows;
    if (sacFilter !== 'all') base = base.filter(c => sacFilter === 'yes' ? !!c.same_as_customer : !c.same_as_customer);
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
  }, [q, rows, sacFilter]);

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
      meta: { align: 'center' },
      cell: (info: any) => {
        const row = info.row.original as ConsigneeRow;
        const list = (row.customers ?? []).map(c => c.code || `C-${c.id}`);
        // Fall back to the single primary code for rows loaded before the
        // many-to-many payload existed.
        const chips = list.length > 0 ? list : [String(info.getValue() ?? '')].filter(Boolean);
        if (chips.length === 0) return <span className="text-muted">—</span>;
        return (
          <span className="d-inline-flex align-items-center flex-wrap" style={{ gap: 4, justifyContent: 'center' }}>
            {chips.map((code, i) => <span key={i} className="smcg-cust-chip">{code}</span>)}
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
      meta: { align: 'center' },
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
      header: 'Risk Level',
      accessorKey: 'risk',
      meta: { align: 'center' },
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
    { header: 'Email',          accessorKey: 'email',   cell: (i: any) => <TruncatedCell value={i.getValue()} className="smcg-email" max={18} caseSensitive /> },
    { header: 'Contact No',     accessorKey: 'phone',   meta: { align: 'center' }, cell: (i: any) => <span className="smcg-mono">{i.getValue() || '—'}</span> },
    {
      header: 'Country',
      accessorKey: 'country',
      meta: { align: 'center' },
      cell: (info: any) => {
        const c = info.row.original as Consignee;
        const country = (c.country ?? '').trim();
        if (!country) return <span className="text-muted">—</span>;
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
          <div className="smcg-sac-filter" style={{ width: 210, flexShrink: 0 }}>
            <MasterSelect
              value={sacFilter}
              placeholder="Same as Customer"
              options={[
                { value: 'all', label: 'Same as Customer: All' },
                { value: 'yes', label: 'Yes' },
                { value: 'no',  label: 'No' },
              ]}
              onChange={(v) => setSacFilter((v || 'all') as 'all'|'yes'|'no')}
            />
          </div>
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
            <ShimmerTable rows={pageSize} cols={12} />
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
          {!loading && filtered.length === 0 && (
            <div className="smcg-empty py-4">No consignees found</div>
          )}
        </div>
      </div>

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

      {segOpen && createPortal(
        <>
          <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
          <div className="smcg-seg-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 230), top: segOpen.y, zIndex: 1091, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="smcg-seg-pop-title">Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} className={`smcg-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                <span className="smcg-seg">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
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
