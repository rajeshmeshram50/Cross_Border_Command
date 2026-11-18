import { useCallback, useEffect, useState, type ReactNode } from 'react';
import '../../p2p-common.css';
import '../../purchase-management/order/po-list/order.css';
import './service-management.css';
import WorklistPager from '../../../../components/ui/WorklistPager';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { formatDmy } from '../../../../utils/formatDmy';
import api from '../../../../api';
import {
  subLabel, subOf, SVC_TYPES, tabOfKind,
  type MappedSupplier, type OtherType, type ServiceKind, type ServiceRecord, type ServiceTab,
} from './serviceData';
import {
  TAB_TO_TYPE, apiError, fetchServiceList, fetchServiceSuppliers, rowToRecord, setServiceStatus,
  type ServiceCounts,
} from './serviceApi';
import { SVC_ICONS } from './serviceIcons';
import ServiceTypeGate from './ServiceTypeGate';
import ServiceFormModal, { type ServiceFormInput } from './ServiceFormModal';
import ServiceSupplierModal from './ServiceSupplierModal';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const STEPS = [
  { no: '01', title: 'Create Service', desc: 'Define service name, code, scope and description.', icon: SVC_ICONS.tag },
  { no: '02', title: 'Service Classification', desc: 'Classify as Self-Consumable, Soft / Digital or Other Operational.', icon: SVC_ICONS.layers },
  { no: '03', title: 'SLA & Pricing Terms', desc: 'Set SLAs, billing cycle, renewal and pricing terms.', icon: SVC_ICONS.note },
  { no: '04', title: 'Supplier Mapping', desc: 'Link services with eligible service providers.', icon: SVC_ICONS.link },
];

const TABS: Array<{ key: ServiceTab; label: string; icon: ReactNode }> = [
  { key: 'material', label: SVC_TYPES.material.l, icon: SVC_ICONS.self },
  { key: 'soft', label: SVC_TYPES.soft.l, icon: SVC_ICONS.soft },
  { key: 'other', label: SVC_TYPES.other.l, icon: SVC_ICONS.other },
];

type ColKey =
  | 'sr' | 'code' | 'name' | 'desc' | 'otype' | 'kind' | 'category' | 'hsn' | 'provider'
  | 'segment' | 'delivery' | 'billing' | 'uom' | 'condition' | 'contract' | 'mapped' | 'action';
type Col = { key: ColKey; header: string; width: number };

const C = {
  sr: { key: 'sr', header: 'Sr. No', width: 58 },
  code: { key: 'code', header: 'Service Code', width: 104 },
  name: { key: 'name', header: 'Service Name', width: 220 },
  desc: { key: 'desc', header: 'Service Description', width: 230 },
  hsn: { key: 'hsn', header: 'HSN / SAC Code', width: 100 },
  uom: { key: 'uom', header: 'UOM', width: 96 },
  contract: { key: 'contract', header: 'Contract Required', width: 120 },
  mapped: { key: 'mapped', header: 'Mapped Supplier', width: 104 },
  action: { key: 'action', header: 'Action', width: 112 },
} satisfies Record<string, Col>;

const COLUMNS: Record<ServiceTab, Col[]> = {
  material: [
    C.sr, { ...C.name, header: 'Service Name' }, C.desc,
    { key: 'kind', header: 'Service Category', width: 116 }, C.hsn,
    { key: 'provider', header: 'Service Provider / Brand', width: 170 },
    { key: 'segment', header: 'Segment', width: 150 }, C.uom,
    { key: 'condition', header: 'Condition', width: 108 }, { ...C.mapped, header: 'Mapped Suppliers' }, C.action,
  ],
  soft: [
    C.sr, C.code, C.name, C.desc, { key: 'category', header: 'Service Category', width: 170 }, C.hsn,
    { key: 'provider', header: 'Service Provider / Brand', width: 150 },
    { key: 'segment', header: 'Service Segment', width: 140 },
    { key: 'delivery', header: 'Service Delivery Type', width: 130 }, C.uom, C.contract, C.mapped, C.action,
  ],
  other: [
    C.sr, C.code, C.name, C.desc, { key: 'otype', header: 'Service Type', width: 124 },
    { key: 'category', header: 'Service Category', width: 170 }, C.hsn,
    { key: 'provider', header: 'Service Provider / Vendor', width: 170 },
    { key: 'billing', header: 'Billing Frequency', width: 108 }, C.uom, C.contract, C.mapped, C.action,
  ],
};

const dash = (v?: string) => (!v || /^select\b/i.test(v.trim()) ? <span className="ord-dash">—</span> : v);

export default function ServiceManagement() {
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<ServiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ServiceCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const [briefOpen, setBriefOpen] = useState(false);
  const [tab, setTab] = useState<ServiceTab>('material');
  const [subs, setSubs] = useState<Record<ServiceTab, string>>({ material: 'all', soft: 'all', other: 'all' });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [gateOpen, setGateOpen] = useState(false);
  const [formFor, setFormFor] = useState<ServiceFormInput | null>(null);
  const [mapFor, setMapFor] = useState<ServiceRecord | null>(null);

  const sub = subs[tab];

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchServiceList({ tab, sub, q: debouncedQuery, page, perPage: pageSize }, ctrl.signal)
      .then(res => {
        setRows((res.data ?? []).map(rowToRecord));
        setTotal(Number(res.total) || 0);
        setCounts(res.counts ?? null);
        const last = Math.max(1, Number(res.last_page) || 1);
        if (page > last) setPage(last);
      })
      .catch(e => {
        if (ctrl.signal.aborted) return;
        setRows([]);
        setTotal(0);
        toast.error('Could not load services', apiError(e, 'Please refresh and try again.'));
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [tab, sub, debouncedQuery, page, pageSize, reloadKey, toast]);

  const tabCounts: Record<ServiceTab, number> = {
    material: counts?.self_consumable?.total ?? 0,
    soft: counts?.soft_digital?.total ?? 0,
    other: counts?.other_operational?.total ?? 0,
  };
  const typeCounts = counts?.[TAB_TO_TYPE[tab]];
  const subCounts: Record<string, number> = { ...(typeCounts ?? {}), all: typeCounts?.total ?? 0 };

  const pageSafe = page;
  const start = (pageSafe - 1) * pageSize;
  const pageRows = rows;
  const columns = COLUMNS[tab];
  const tableWidth = columns.reduce((w, c) => w + c.width, 0);

  const selectTab = (k: ServiceTab) => { setTab(k); setPage(1); };
  const selectSub = (k: string) => { setSubs(s => ({ ...s, [tab]: k })); setPage(1); };

  const chooseType = useCallback((kind: ServiceKind, otype?: OtherType) => {
    setGateOpen(false);
    api.get<{ code?: string }>('/p2p/services/next-code')
      .then(res => res.data?.code || 'SVC-NEW')
      .catch(() => 'SVC-NEW')
      .then(code => setFormFor({ kind, otype, code }));
  }, []);

  const edit = (r: ServiceRecord) => setFormFor({ kind: r.kind, record: r, code: r.code });

  const submitForm = (rec: ServiceRecord, isEdit: boolean) => {
    setRows(prev => (isEdit ? prev.map(r => (r.code === rec.code ? rec : r)) : [...prev, rec]));
    const t = tabOfKind(rec.kind);
    setTab(t);
    if (!isEdit) { setSubs(s => ({ ...s, [t]: 'all' })); setPage(1); }
    setFormFor(null);
    toast.success(`Service ${rec.code} ${isEdit ? 'updated' : 'created'}`, rec.vals.name);
  };

  const saveMap = (next: MappedSupplier[]) => {
    if (!mapFor) return;
    const code = mapFor.code;
    setRows(prev => prev.map(r => (r.code === code ? { ...r, suppliers: next } : r)));
    setMapFor({ ...mapFor, suppliers: next });
  };

  const openMap = async (r: ServiceRecord) => {
    if (r.id == null) { setMapFor(r); return; }
    try {
      const suppliers = await fetchServiceSuppliers(r.id);
      setMapFor({ ...r, suppliers });
    } catch (e) {
      toast.error('Could not load mapped suppliers', apiError(e, 'Please try again.'));
    }
  };

  const toggleActive = async (r: ServiceRecord) => {
    const next = r.status ? r.status !== 'active' : !r.active;
    const ok = await confirm({
      title: next ? 'Activate service?' : 'Deactivate service?',
      message: next
        ? <>Service <strong>{r.code}</strong> — {r.vals.name} will be active again and can be edited and mapped to suppliers.</>
        : <>Service <strong>{r.code}</strong> — {r.vals.name} will be marked inactive. It stays in the list, but it can’t be edited or mapped to suppliers until it’s activated again.</>,
      tone: next ? 'teal' : 'warning',
      confirmLabel: next ? 'Activate' : 'Deactivate',
      icon: next ? 'checkbox-circle-line' : 'forbid-line',
    });
    if (!ok) return;
    if (r.id == null) {
      setRows(prev => prev.map(x => (x.code === r.code ? { ...x, active: next } : x)));
      toast.success(`Service ${r.code} ${next ? 'activated' : 'deactivated'}`, r.vals.name);
      return;
    }
    try {
      await setServiceStatus(r.id, next ? 'active' : 'inactive');
      toast.success(`Service ${r.code} ${next ? 'activated' : 'deactivated'}`, r.vals.name);
      reload();
    } catch (e) {
      toast.error(`Could not ${next ? 'activate' : 'deactivate'} ${r.code}`, apiError(e, 'Please try again.'));
    }
  };

  const subTabs = SVC_TYPES[tab].subs;
  const curSubLabel = sub === 'all'
    ? SVC_TYPES[tab].l
    : `${subTabs.find(s => s.k === sub)?.l ?? ''} services`;

  return (
    <div className="spi-root ord-page spi-list svm-page">
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon">{SVC_ICONS.wrench}</div>
          <div>
            <div className="spi-head-title">Service Management</div>
            <div className="spi-head-sub">
              Manage the service catalogue, service classification, SLA &amp; pricing terms, and supplier mapping for service procurement.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setGateOpen(true)}>
          {SVC_ICONS.plus} Add Service
        </button>
      </div>

      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico">{SVC_ICONS.maintenance}</div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Service Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating services, classifying them, setting SLA &amp; pricing terms, and mapping service providers for procurement.
            </div>
          </div>
          <div className="spi-bref-toggle">{SVC_ICONS.chevron}</div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(step => (
            <div className="spi-step" key={step.no}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{step.icon}</span>
                <span className="spi-step-num">STEP {step.no}</span>
              </div>
              <div className="spi-step-title">{step.title}</div>
              <div className="spi-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Service type">
            {TABS.map(t => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`} onClick={() => selectTab(t.key)}>
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                <span className="spi-seg-c">{tabCounts[t.key]}</span>
              </button>
            ))}
          </div>

          <form role="search" autoComplete="off" noValidate className="cv-search-form" onSubmit={e => e.preventDefault()}>
            <div className="bst-search parch-search whm-main-search">
              {SVC_ICONS.search}
              <input type="search" name="svm-search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}
                placeholder="Search by service ID, name, category or supplier..." aria-label="Search services"
                autoComplete="off" autoCorrect="off" spellCheck={false} />
              {query ? (
                <button type="button" className="bst-search-clear" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">
                  {SVC_ICONS.x}
                </button>
              ) : null}
            </div>
          </form>
        </div>

        {subTabs.length > 0 && (
          <div className="spi-sub">
            <div className="spi-subtabs" role="tablist" aria-label="Classification">
              <button type="button" role="tab" aria-selected={sub === 'all'}
                className={`spi-subtab ${sub === 'all' ? 'is-active' : ''}`} onClick={() => selectSub('all')}>
                {SVC_ICONS.all} All {SVC_TYPES[tab].l}
                <span className="spi-subtab-c">{subCounts.all ?? 0}</span>
              </button>
              {subTabs.map(s => (
                <button key={s.k} type="button" role="tab" aria-selected={sub === s.k}
                  className={`spi-subtab ${sub === s.k ? 'is-active' : ''}`} onClick={() => selectSub(s.k)}>
                  {SVC_ICONS[s.k as keyof typeof SVC_ICONS]} {tab === 'material' ? s.full : `${s.l} Services`}
                  <span className="spi-subtab-c">{subCounts[s.k] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="tvc-list">
          <div className="whm-tblwrap">
            <table className={`whm-tbl mv-tbl svm-table${pageRows.length === 0 ? ' is-empty' : ''}`} style={{ minWidth: Math.max(1180, tableWidth) }}>
              <colgroup>{columns.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
              <thead>
                <tr>{columns.map((c, i) => <th key={c.key} className={`mv-th-${i}`} scope="col">{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {loading && pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="mv-empty">
                      <div className="mv-empty__box">
                        <div className="mv-empty__ico">{SVC_ICONS.wrench}</div>
                        <div className="mv-empty__t">Loading services…</div>
                      </div>
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="mv-empty">
                      <div className="mv-empty__box">
                        <div className="mv-empty__ico">{SVC_ICONS.wrench}</div>
                        <div className="mv-empty__t">
                          {query.trim() ? 'No services match your search' : `No ${curSubLabel.replace(/^All /, '').toLowerCase()} yet`}
                        </div>
                        <div className="mv-empty__s">{query.trim()
                          ? 'Try a different code, name, category or supplier.'
                          : 'Services added with Add Service will be listed here.'}</div>
                      </div>
                    </td>
                  </tr>
                ) : pageRows.map((r, i) => (
                  <tr key={r.id ?? r.code} className={r.active ? undefined : 'is-off'}>
                    {columns.map(c => (
                      <td key={c.key} data-col={c.key}>{renderCell(c.key, r, start + i, { edit, map: openMap, toggle: toggleActive })}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <WorklistPager
          className="wl-teal"
          total={total}
          page={pageSafe}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {gateOpen && <ServiceTypeGate onClose={() => setGateOpen(false)} onChoose={chooseType} />}

      {formFor && (
        <ServiceFormModal input={formFor} onClose={() => setFormFor(null)} onSubmit={submitForm} />
      )}

      {mapFor && (
        <ServiceSupplierModal
          code={mapFor.code}
          serviceName={mapFor.vals.name}
          defaultGst={mapFor.vals.gstPct}
          suppliers={mapFor.suppliers}
          onClose={() => setMapFor(null)}
          onChange={saveMap}
        />
      )}
    </div>
  );
}

type Actions = {
  edit: (r: ServiceRecord) => void;
  map: (r: ServiceRecord) => void;
  toggle: (r: ServiceRecord) => void;
};

function renderCell(key: ColKey, r: ServiceRecord, index: number, act: Actions): ReactNode {
  const v = r.vals;
  const tab = tabOfKind(r.kind);
  const sub = subOf(r);
  switch (key) {
    case 'sr':
      return <span className="ord-srnum">{index + 1}</span>;
    case 'code':
      return (
        <div className="ord-idcell">
          <span className="ord-idpill">{r.code}</span>
          <span className="ord-idcell__date">{formatDmy(r.created)}</span>
        </div>
      );
    case 'name':
      return (
        <div className="svm-name">
          <span className="svm-name-ico">{SVC_ICONS[(r.kind === 'other' ? sub : r.kind === 'soft' ? 'soft' : r.kind) as keyof typeof SVC_ICONS]}</span>
          <span className="svm-name-txt">
            <span className="svm-name-main">{v.name}</span>
            {tab === 'material' && <span className="svm-name-code">{r.code}</span>}
          </span>
        </div>
      );
    case 'desc':
      return v.desc
        ? <Tooltip label={v.desc}><span className="svm-desc">{v.desc}</span></Tooltip>
        : <span className="ord-dash">—</span>;
    case 'kind':
    case 'otype': {
      const tone = sub === 'trackable' || sub === 'professional' || sub === 'facility' || sub === 'outsourcing' ? 'cyan' : 'teal';
      return (
        <span className={`svm-kind svm-kind--${tone}`}>
          {SVC_ICONS[sub as keyof typeof SVC_ICONS]} {subLabel(tab, sub)}
        </span>
      );
    }
    case 'category':
      return v.category ? <span className="svm-badge">{v.category}</span> : <span className="ord-dash">—</span>;
    case 'hsn':
      return v.hsn ? <span className="ord-idpill svm-hsn">{v.hsn}</span> : <span className="ord-dash">—</span>;
    case 'provider':
      return <span className="svm-strong">{dash(tab === 'material' ? v.make : v.provider)}</span>;
    case 'segment':
      return tab === 'material'
        ? (v.segment ? <span className="svm-badge">{v.segment}</span> : <span className="ord-dash">—</span>)
        : <span className="svm-plain">{dash(v.segment)}</span>;
    case 'delivery':
      return <span className="svm-plain">{dash(v.delivery)}</span>;
    case 'billing':
      return <span className="svm-plain">{dash(v.billing)}</span>;
    case 'uom':
      return <span className="svm-plain">{dash(v.uom)}</span>;
    case 'condition':
      return v.condition
        ? <span className={`svm-flag${v.condition === 'New' ? ' svm-flag--yes' : ''}`}><i />{v.condition}</span>
        : <span className="ord-dash">—</span>;
    case 'contract': {
      const yes = v.contract === 'Required';
      return <span className={`svm-flag${yes ? ' svm-flag--yes' : ''}`}><i />{yes ? 'Required' : 'Not Required'}</span>;
    }
    case 'mapped': {
      const n = r.suppliersCount ?? r.suppliers.length;
      const names = r.supplierNames ?? r.suppliers.map(s => s.name);
      return (
        <Tooltip label={n ? names.join(', ') : 'No suppliers mapped'}>
          <button type="button" className={`svm-cnt${n ? '' : ' is-zero'}`} disabled={!r.active} onClick={() => act.map(r)} aria-label={`${n} mapped suppliers`}>
            {n}
          </button>
        </Tooltip>
      );
    }
    case 'action':
      return (
        <span className="whm-acts">
          <Tooltip label={r.active ? `Edit ${r.code}` : 'Activate this service to edit it'}>
            <button type="button" className="whm-act whm-act--edit" aria-label={`Edit ${r.code}`} disabled={!r.active} onClick={() => act.edit(r)}>
              {SVC_ICONS.edit}
            </button>
          </Tooltip>
          <Tooltip label={r.active ? `Map suppliers to ${r.code}` : 'Activate this service to map suppliers'}>
            <button type="button" className="whm-act" aria-label={`Map suppliers to ${r.code}`} disabled={!r.active} onClick={() => act.map(r)}>
              {SVC_ICONS.mapUser}
            </button>
          </Tooltip>
          <Tooltip label={r.status === 'draft'
            ? 'Draft — map suppliers (Stage 2) to activate'
            : r.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}>
            <button type="button" className={`whm-toggle${(r.status ? r.status === 'active' : r.active) ? ' is-on' : ''}`}
              role="switch" aria-checked={r.status ? r.status === 'active' : r.active} aria-label={`Toggle status of ${r.code}`}
              onClick={() => act.toggle(r)}>
              <span />
            </button>
          </Tooltip>
        </span>
      );
    default:
      return null;
  }
}
