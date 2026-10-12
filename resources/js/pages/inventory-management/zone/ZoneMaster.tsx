import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServerList } from '../../../hooks/useServerList';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { ReactNode } from 'react';
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import '../warehouse/warehouse-master.css';
import './zone.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import Tooltip from '../../../components/ui/Tooltip';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { ZoneApiError, zoneApi, type Zone, type ZoneCounts, type ZoneTab, type ZoneWarehouse } from './zone-data';

const ZoneQrModal = lazy(() => import('./ZoneQrModal'));
const AddZoneModal = lazy(() => import('./AddZoneModal'));

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : iso;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const svg = (d: ReactNode, size = 14, width = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoZone = (p: { size?: number }) => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  p.size ?? 14,
);
const IcoRack = (p: { size?: number }) => svg(
  <><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" />
    <line x1="4" y1="14" x2="20" y2="14" /></>,
  p.size ?? 14,
);
const IcoFloor = (p: { size?: number }) => svg(
  <><rect x="3" y="10" width="5" height="11" /><rect x="10" y="6" width="5" height="15" />
    <rect x="17" y="13" width="4" height="8" /><line x1="2" y1="21" x2="22" y2="21" /></>,
  p.size ?? 14,
);
const IcoFridge = (p: { size?: number }) => svg(
  <><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="5" y1="10" x2="19" y2="10" />
    <line x1="9" y1="5" x2="9" y2="7" /><line x1="9" y1="13" x2="9" y2="16" /></>,
  p.size ?? 14,
);
const IcoSnow = () => svg(
  <><line x1="12" y1="2" x2="12" y2="22" /><line x1="4.9" y1="7" x2="19.1" y2="17" />
    <line x1="4.9" y1="17" x2="19.1" y2="7" /><polyline points="9 4 12 6 15 4" />
    <polyline points="9 20 12 18 15 20" /></>, 11,
);
const IcoHaz = () => svg(
  <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>, 11,
);
const IcoPin = (p: { size?: number }) => svg(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  p.size ?? 14,
);
const IcoExt = () => svg(
  <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>, 10,
);
const IcoTag = () => svg(
  <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" /></>, 11,
);
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 15,
);
const IcoQr = () => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>, 15,
);
const IcoWarehouse = () => svg(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>, 11,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 13,
);
const IcoChevron = () => svg(<polyline points="6 9 12 15 18 9" />, 10);

const STEPS: Array<{ no: string; icon: ReactNode; title: string; desc: string }> = [
  {
    no: '01', icon: <IcoWarehouse />, title: 'Select Warehouse',
    desc: 'Choose the warehouse — its type, area and location are fetched automatically.',
  },
  {
    no: '02', icon: <IcoZone size={11} />, title: 'Create Zone Record',
    desc: 'Auto-generate the Zone ID and enter the zone name and area in Sq. Ft.',
  },
  {
    no: '03', icon: <IcoTag />, title: 'Define Zone Type',
    desc: 'With Rack or Without Rack — Without Rack zones capture refrigerator litres or regular floor dimensions.',
  },
  {
    no: '04', icon: <IcoSnow />, title: 'Set Zone Flags',
    desc: 'Mark Cold Chain (with temperature range) and Hazardous handling, and set the zone purpose.',
  },
];

type Tab = ZoneTab;

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Zones', icon: <IcoZone size={15} /> },
  { key: 'rack', label: 'Storage Zone (With Rack)', icon: <IcoRack size={15} /> },
  { key: 'norack', label: 'Storage Zone (Without Rack)', icon: <IcoFloor size={15} /> },
];

const COLUMNS = [
  'Sr. No', 'Zone ID', 'Zone', 'Zone Type', 'Zone Area', 'Cold Chain', 'Hazardous',
  'Warehouse', 'Warehouse Location', 'Zone Status', 'Action',
];

export default function ZoneMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const debouncedQuery = useDebouncedValue(query.trim(), 400);

  const [warehouses, setWarehouses] = useState<ZoneWarehouse[]>([]);
  const loadWarehouses = useCallback(() => {
    zoneApi.warehouses().then(setWarehouses).catch(() => {
      toast.error('Could not load warehouses', 'Warehouse names and locations may be missing.');
    });
  }, [toast]);
  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.apiId, w])), [warehouses]);

  const [counts, setCounts] = useState<ZoneCounts>({ all: 0, rack: 0, norack: 0 });
  const loadCounts = useCallback(() => {
    zoneApi.counts().then(setCounts).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  const list = useServerList(
    (q) => zoneApi.list({ tab: (q.tab as Tab) ?? 'all', search: q.search, page: q.page, per_page: q.per_page }),
    { perPage: pageSize, search: debouncedQuery, tab },
    (e) => toast.error('Could not load zones', e instanceof ZoneApiError ? e.message : 'Please refresh the page.'),
  );
  const reload = list.reload;

  const rowCount = list.rows.length;
  useEffect(() => { if (rowCount) refitPageSize(); }, [rowCount, refitPageSize]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const toggle = useCallback(async (z: Zone) => {
    if (busyId || !z.apiId) return;
    const activate = z.status !== 'active';
    setBusyId(z.apiId);
    try {
      await zoneApi.setStatus(z.apiId, activate);
      if (activate) toast.success(`${z.id} marked Active`);
      else toast.warning(`${z.id} marked Inactive`, 'It stays in the list, dimmed. Its racks are deactivated with it.');
      reload();
    } catch (e) {
      toast.error('Could not change the status', e instanceof ZoneApiError ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [busyId, reload, toast]);

  const [qrFor, setQrFor] = useState<Zone | null>(null);
  const [formFor, setFormFor] = useState<Zone | 'new' | null>(null);

  const [openingId, setOpeningId] = useState<number | null>(null);
  const openEdit = useCallback(async (z: Zone) => {
    if (!z.apiId || openingId) return;
    setOpeningId(z.apiId);
    try {
      setFormFor(await zoneApi.show(z.apiId));
    } catch (e) {
      toast.error('Could not open the zone', e instanceof ZoneApiError ? e.message : 'Please try again.');
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
    <div className="spi-root ord-page whm-page znm-page">

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoZone size={17} /></div>
          <div>
            <div className="spi-head-title">Zone Management</div>
            <div className="spi-head-sub">
              Define and manage storage zones inside each warehouse for organised putaway and picking.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setFormFor('new')}>
          <IcoPlus /> Add Zone
        </button>
      </div>

      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoZone size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Zone Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating storage zones inside a warehouse with zone type, area and handling flags.
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
          <div className="spi-seg" role="tablist" aria-label="Zone type">
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
              placeholder="Search by zone name or purpose..."
              aria-label="Search zones"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="ord-empty">Loading zones…</div>
        ) : total === 0 ? (
          <div className="ord-empty">
            {debouncedQuery ? 'No zones match your search.' : 'No zones in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {rows.map((z, i) => (
                <tbody key={z.apiId ?? z.id}>
                  <Row z={z} sr={start + i + 1} off={z.status !== 'active'} busy={busyId === z.apiId}
                    w={z.warehouseId ? warehouseById.get(z.warehouseId) : undefined}
                    opening={openingId === z.apiId}
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
          <AddZoneModal
            zone={formFor === 'new' ? undefined : formFor}
            warehouses={warehouses}
            onClose={() => setFormFor(null)}
            onSaved={onSaved}
          />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <ZoneQrModal zone={qrFor}
            warehouse={qrFor.warehouseId ? warehouseById.get(qrFor.warehouseId) : undefined}
            onClose={() => setQrFor(null)} />
        </Suspense>
      )}
    </div>
  );
}

function Row({ z, sr, off, busy, opening, w, onToggle, onQr, onEdit }: {
  z: Zone;
  sr: number;
  off: boolean;
  busy: boolean;
  opening: boolean;
  w: ZoneWarehouse | undefined;
  onToggle: (z: Zone) => void;
  onQr: (z: Zone) => void;
  onEdit: (z: Zone) => void;
}) {
  const rack = z.type === 'rack';

  const areaSub = z.storage === 'fridge' && z.litres != null
    ? `${inGrouping.format(z.litres)} L capacity`
    : z.dims
      ? `${inGrouping.format(z.dims.usableVolume)} ${z.dims.unit}³ usable`
      : null;

  return (
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{sr}</span></td>

      <td>
        <div className="whm-idcell">
          <span className="whm-idpill">{z.id}</span>
          <span className="whm-iddate">{formatDate(z.date)}</span>
        </div>
      </td>

      <td>
        <div className="whm-namecell" title={z.name}>
          <span className="whm-namecell__ico">
            {rack ? <IcoRack size={15} />
              : z.storage === 'fridge' ? <IcoFridge size={15} /> : <IcoFloor size={15} />}
          </span>
          <div className="whm-namecell__t">
            <b className="pts-trunc">{z.name}</b>
            <span className="whm-namecell__loc"><IcoTag />{z.purpose}</span>
          </div>
        </div>
      </td>

      <td>
        <div className="znm-typecell">
          <span className={`whm-type ${rack ? 'whm-type--own' : 'whm-type--tpl'}`}>
            {rack ? <IcoRack size={12} /> : <IcoFloor size={12} />}
            {rack ? 'With Rack' : 'Without Rack'}
          </span>
          {!rack && (
            <span className="znm-sub2">
              {z.storage === 'fridge' ? <><IcoFridge size={11} />Refrigerator</> : <><IcoFloor size={11} />Regular floor</>}
            </span>
          )}
        </div>
      </td>

      <td>
        <span className="whm-area znm-area">
          <span><b>{inGrouping.format(z.area)}</b><small>Sq. Ft</small></span>
          {areaSub && <small>{areaSub}</small>}
        </span>
      </td>

      <td>
        <div className="znm-flagcell">
          {z.cold ? (
            <>
              <span className="znm-flag znm-flag--cold"><IcoSnow />Allowed</span>
              {z.tempRange && (
                <span className="znm-rng">
                  {signed(z.tempRange.min)} to {signed(z.tempRange.max)} °C
                </span>
              )}
            </>
          ) : (
            <span className="znm-flag znm-flag--no">Not Allowed</span>
          )}
        </div>
      </td>

      <td>
        <div className="znm-flagcell">
          {z.haz
            ? <span className="znm-flag znm-flag--haz"><IcoHaz />Allowed</span>
            : <span className="znm-flag znm-flag--no">Not Allowed</span>}
        </div>
      </td>

      <td>
        <div className="znm-whcell">
          <span className="whm-idpill znm-whid">{w?.id ?? z.wh}</span>
          <b title={w?.name ?? z.whName}>{w?.name || z.whName || '—'}</b>
        </div>
      </td>

      <td>
        <div className="whm-loc">
          <div className="whm-loc__city"><b>{w?.city ?? '—'}</b>{w?.state ? `, ${w.state}` : ''}</div>
          <div className="whm-loc__row">
            <span className="whm-loc__pin">{w?.pin ?? ''}</span>
            {w?.map ? (
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

      <td>
        <span className={`whm-status whm-status--${off ? 'off' : 'on'}`}>
          <i />{off ? 'Inactive' : 'Active'}
        </span>
      </td>

      <td>
        <div className="whm-acts">
          <Tooltip label="Edit this zone">
            <button type="button" className="whm-act" aria-label={`Edit ${z.id}`}
              disabled={opening} onClick={() => onEdit(z)}>
              <IcoEdit />
            </button>
          </Tooltip>
          <Tooltip label={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
            <button
              type="button"
              className={`whm-toggle${off ? '' : ' is-on'}`}
              role="switch" aria-checked={!off}
              aria-label={`Toggle status of ${z.id}`}
              disabled={busy}
              onClick={() => onToggle(z)}
            >
              <span />
            </button>
          </Tooltip>
          <Tooltip label="Zone QR">
            <button type="button" className="whm-act" aria-label={`Zone QR for ${z.id}`}
              onClick={() => onQr(z)}>
              <IcoQr />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
