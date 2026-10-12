import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useServerList } from '../../../hooks/useServerList';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { ReactNode } from 'react';
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import './warehouse-master.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { WarehouseApiError, warehouseApi, type Warehouse, type WarehouseCounts, type WarehouseTab } from './warehouse-data';
const WarehouseQrModal = lazy(() => import('./WarehouseQrModal'));
const AddWarehouseModal = lazy(() => import('./AddWarehouseModal'));

const inGrouping = new Intl.NumberFormat('en-IN');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : iso;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const svg = (d: ReactNode, size = 14, width = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const IcoWarehouse = (p: { size?: number }) => svg(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  p.size ?? 14,
);
const IcoOwn = (p: { size?: number }) => svg(
  <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  p.size ?? 14,
);
const IcoTpl = (p: { size?: number }) => svg(
  <><rect x="1" y="7" width="15" height="11" rx="1.5" /><path d="M16 10h4l3 3v5h-7" />
    <circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></>,
  p.size ?? 14,
);
const IcoPin = (p: { size?: number }) => svg(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  p.size ?? 14,
);
const IcoExt = () => svg(
  <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  10,
);
const IcoPhone = () => svg(
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  11,
);
const IcoMail = () => svg(
  <><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22 6 12 13 2 6" /></>, 11,
);
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 15,
);
const IcoQr = () => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  15,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 13,
);
const IcoGrid = () => svg(
  <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>, 11,
);
const IcoUser = () => svg(
  <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>, 11,
);
const IcoChevron = () => svg(<polyline points="6 9 12 15 18 9" />, 10);

const STEPS: Array<{ no: string; icon: ReactNode; title: string; desc: string }> = [
  {
    no: '01', icon: <IcoGrid />, title: 'Create Warehouse Record',
    desc: 'Generate and assign a unique Warehouse ID for warehouse identification and tracking.',
  },
  {
    no: '02', icon: <IcoOwn size={11} />, title: 'Define Warehouse Ownership Type',
    desc: 'Select whether the warehouse is an Own Warehouse or a Third-Party Warehouse.',
  },
  {
    no: '03', icon: <IcoPin size={11} />, title: 'Add Warehouse Location Details',
    desc: 'Capture warehouse city, state, pin code, and complete address information.',
  },
  {
    no: '04', icon: <IcoUser />, title: 'Add Warehouse Contact Person',
    desc: 'Save warehouse in-charge name and contact details for operational coordination.',
  },
];

type Tab = WarehouseTab;

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Warehouses', icon: <IcoWarehouse size={15} /> },
  { key: 'own', label: 'Own Warehouses', icon: <IcoOwn size={15} /> },
  { key: 'tpl', label: 'Third Party Warehouses', icon: <IcoTpl size={15} /> },
];

/* `left` marks the columns that hold a block of several lines — a name over
   an address, a city over a pin code, a person over their phone and email.
   The design aligns those to the column's left edge, header and all: a ragged
   block centred in its column has no edge to read down. */
const COLUMNS: Array<{ label: string; left?: boolean }> = [
  { label: 'Sr. No' },
  { label: 'Warehouse ID' },
  { label: 'Warehouse', left: true },
  { label: 'Warehouse Type' },
  { label: 'Warehouse Area (Sq. Ft)' },
  { label: 'Google Location', left: true },
  { label: 'Contact Person', left: true },
  { label: 'Warehouse Status' },
  { label: 'Action' },
];

export default function WarehouseMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const debouncedQuery = useDebouncedValue(query.trim(), 400);

  const [counts, setCounts] = useState<WarehouseCounts>({ all: 0, own: 0, tpl: 0 });
  const loadCounts = useCallback(() => {
    warehouseApi.counts().then(setCounts).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  const list = useServerList(
    (q) => warehouseApi.list({ tab: (q.tab as Tab) ?? 'all', search: q.search, page: q.page, per_page: q.per_page }),
    { perPage: pageSize, search: debouncedQuery, tab },
    (e) => toast.error('Could not load warehouses', e instanceof WarehouseApiError ? e.message : 'Please refresh the page.'),
  );
  const reload = list.reload;

  const rowCount = list.rows.length;
  useEffect(() => { if (rowCount) refitPageSize(); }, [rowCount, refitPageSize]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const toggle = useCallback(async (w: Warehouse) => {
    if (busyId || !w.apiId) return;
    const activate = w.status !== 'active';
    setBusyId(w.apiId);
    try {
      await warehouseApi.setStatus(w.apiId, activate);
      if (activate) toast.success(`${w.id} marked Active`, 'Its zones and racks stay inactive until you switch them back on.');
      else toast.warning(`${w.id} marked Inactive`, 'It stays in the list, dimmed. Its zones and racks are deactivated with it.');
      reload();
    } catch (e) {
      toast.error('Could not change the status', e instanceof WarehouseApiError ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [busyId, reload, toast]);

  const [qrFor, setQrFor] = useState<Warehouse | null>(null);
  const [formFor, setFormFor] = useState<Warehouse | 'new' | null>(null);

  const [openingId, setOpeningId] = useState<number | null>(null);
  const openEdit = useCallback(async (w: Warehouse) => {
    if (!w.apiId || openingId) return;
    setOpeningId(w.apiId);
    try {
      setFormFor(await warehouseApi.show(w.apiId));
    } catch (e) {
      toast.error('Could not open the warehouse', e instanceof WarehouseApiError ? e.message : 'Please try again.');
    } finally {
      setOpeningId(null);
    }
  }, [openingId, toast]);

  const onSaved = useCallback(() => {
    reload();
    loadCounts();
  }, [reload, loadCounts]);

  const rows = list.rows;
  const total = list.meta?.total ?? 0;
  const page = list.page;
  const start = (page - 1) * pageSize;
  const changePageSize = useCallback((n: number) => choosePageSize(n), [choosePageSize]);
  const loading = list.loading || list.replacing;

  return (
    <div className="spi-root ord-page whm-page">

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoWarehouse size={17} /></div>
          <div>
            <div className="spi-head-title">Warehouse Management</div>
            <div className="spi-head-sub">
              Manage warehouses, storage locations, ownership types, and warehouse operations.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setFormFor('new')}>
          <IcoPlus /> Add Warehouse
        </button>
      </div>

      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoWarehouse size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Warehouse Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating and configuring warehouse records with location, ownership type, and contact details.
            </div>
          </div>
          <div className="spi-bref-toggle"><IcoChevron /></div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(s => (
            <div className="spi-step" key={s.no}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{s.icon}</span>
                <span className="spi-step-num">STEP {s.no}</span>
              </div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Warehouse type">
            {TABS.map(t => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={tab === t.key}
                className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                <span className="spi-seg-c">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="spi-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, city, state or contact person..."
              aria-label="Search warehouses"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="ord-empty">Loading warehouses…</div>
        ) : total === 0 ? (
          <div className="ord-empty">
            {debouncedQuery ? 'No warehouses match your search.' : 'No warehouses in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>
                  {COLUMNS.map(c => (
                    <th key={c.label} scope="col" className={c.left ? 'whm-th-l' : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {rows.map((w, i) => (
                <tbody key={w.apiId ?? w.id}>
                  <Row w={w} sr={start + i + 1} off={w.status !== 'active'} busy={busyId === w.apiId}
                    opening={openingId === w.apiId}
                    onToggle={t => void toggle(t)} onQr={setQrFor} onEdit={t => void openEdit(t)} />
                </tbody>
              ))}
            </table>
          </div>
        )}

        <WorklistPager
          className="wl-teal"
          total={total}
          page={page}
          pageSize={pageSize}
          onPage={list.goTo}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {formFor && (
        <Suspense fallback={null}>
          <AddWarehouseModal
            warehouse={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
            onSaved={onSaved}
          />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <WarehouseQrModal warehouse={qrFor} onClose={() => setQrFor(null)} />
        </Suspense>
      )}
    </div>
  );
}

function Row({ w, sr, off, busy, opening, onToggle, onQr, onEdit }: {
  w: Warehouse;
  sr: number;
  off: boolean;
  busy: boolean;
  opening: boolean;
  onToggle: (w: Warehouse) => void;
  onQr: (w: Warehouse) => void;
  onEdit: (w: Warehouse) => void;
}) {
  const place = [w.city, w.state, w.pin].filter(Boolean).join(', ')
    + (w.country && w.country !== 'India' ? `, ${w.country}` : '');

  return (
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{sr}</span></td>

      <td>
        <div className="whm-idcell">
          <span className="whm-idpill">{w.id}</span>
          <span className="whm-iddate">{formatDate(w.date)}</span>
        </div>
      </td>

      <td className="whm-td-l">
        <div className="whm-namecell">
          <span className="whm-namecell__ico">
            {w.type === 'own' ? <IcoOwn size={15} /> : <IcoTpl size={15} />}
          </span>
          <div className="whm-namecell__t">
            <b>{w.name}</b>
            <span>{w.address}</span>
            <span className="whm-namecell__loc"><IcoPin size={11} />{place}</span>
          </div>
        </div>
      </td>

      <td>
        <span className={`whm-type whm-type--${w.type}`}>
          {w.type === 'own' ? <IcoOwn size={12} /> : <IcoTpl size={12} />}
          {w.type === 'own' ? 'Own Warehouse' : 'Third Party (3PL)'}
        </span>
      </td>

      <td>
        <span className="whm-area"><b>{inGrouping.format(w.area)}</b><small>Sq. Ft</small></span>
      </td>

      <td className="whm-td-l">
        <div className="whm-loc">
          <div className="whm-loc__city"><b>{w.city}</b>{w.state ? `, ${w.state}` : ''}</div>
          <div className="whm-loc__row">
            <span className="whm-loc__pin">{w.pin}</span>
            {w.map ? (
              <a className="whm-maplink" href={w.map} target="_blank" rel="noopener noreferrer"
                title="Open in Google Maps">
                <IcoPin size={11} />View Map<IcoExt />
              </a>
            ) : (
              <span className="whm-nomap">No map link</span>
            )}
          </div>
        </div>
      </td>

      <td className="whm-td-l">
        <div className="whm-contact">
          <b>{w.contact}</b>
          <span><IcoPhone />{[w.dial, w.mobile].filter(Boolean).join(' ')}</span>
          <span><IcoMail /><a href={`mailto:${w.email}`}>{w.email}</a></span>
        </div>
      </td>

      <td>
        <span className={`whm-status whm-status--${off ? 'off' : 'on'}`}>
          <i />{off ? 'Inactive' : 'Active'}
        </span>
      </td>

      <td>
        <div className="whm-acts">
          <button type="button" className="whm-act" aria-label={`Edit ${w.id}`}
            title="Edit this warehouse" disabled={opening} onClick={() => onEdit(w)}>
            <IcoEdit />
          </button>
          <button
            type="button"
            className={`whm-toggle${off ? '' : ' is-on'}`}
            role="switch" aria-checked={!off}
            aria-label={`Toggle status of ${w.id}`}
            title={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}
            disabled={busy}
            onClick={() => onToggle(w)}
          >
            <span />
          </button>
          <button type="button" className="whm-act" aria-label={`Warehouse QR for ${w.id}`}
            title="Warehouse QR" onClick={() => onQr(w)}>
            <IcoQr />
          </button>
        </div>
      </td>
    </tr>
  );
}
