import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone.css';
import './rack.css';
import SearchClear from '../../../components/ui/SearchClear';
import { Shimmer, ShimmerTableRows } from '../../../components/ui/Shimmer';
import WorklistPager from '../../../components/ui/WorklistPager';
import Tooltip from '../../../components/ui/Tooltip';
import { useIsClipped } from '../../../components/ui/DataTable';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useServerList } from '../../../hooks/useServerList';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useToast } from '../../../contexts/ToastContext';
import {
  InventoryApiError, loadInventoryLookups, rackApi, rackKind,
  type InventoryLookups, type Rack, type RackTab,
} from './rack-data';
import type { Zone, ZoneWarehouse } from '../zone/zone-data';

const RackQrModal = lazy(() => import('./RackQrModal'));
const AddRackModal = lazy(() => import('./AddRackModal'));
const RackShelvesModal = lazy(() => import('./RackShelvesModal'));

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

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
const IcoRack = (p: { size?: number }) => svg(
  <><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" />
    <line x1="4" y1="14" x2="20" y2="14" /></>,
  p.size ?? 14,
);
const IcoZone = (p: { size?: number }) => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  p.size ?? 14,
);
const IcoOk = (p: { size?: number }) => svg(
  <><circle cx="12" cy="12" r="9" /><polyline points="8.5 12.5 11 15 15.5 9.5" /></>,
  p.size ?? 14,
);
const IcoOff = (p: { size?: number }) => svg(
  <><circle cx="12" cy="12" r="9" /><line x1="6" y1="18" x2="18" y2="6" /></>,
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
const IcoRuler = () => svg(
  <><path d="M3 15 15 3l6 6L9 21z" /><line x1="7" y1="11" x2="9" y2="13" />
    <line x1="10" y1="8" x2="12" y2="10" /><line x1="13" y1="5" x2="15" y2="7" /></>, 11,
);
const IcoWarehouse = () => svg(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>, 11,
);
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 15,
);
const IcoQr = () => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>, 15,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 13,
);
const IcoChevron = () => svg(<polyline points="6 9 12 15 18 9" />, 10);

const STEPS: Array<{ no: string; icon: ReactNode; title: string; desc: string }> = [
  {
    no: '01', icon: <IcoWarehouse />, title: 'Select Warehouse & Zone',
    desc: 'Choose the warehouse and a storage zone (with rack) — zone area and flags are fetched automatically.',
  },
  {
    no: '02', icon: <IcoRack size={11} />, title: 'Create Rack Record',
    desc: 'Auto-generate the Rack ID and enter the rack name.',
  },
  {
    no: '03', icon: <IcoSnow />, title: 'Set Rack Handling',
    desc: 'Mark Cold Chain and Hazardous for the rack, within what the zone allows.',
  },
  {
    no: '04', icon: <IcoRuler />, title: 'Record Rack Dimensions',
    desc: 'Enter length, width and height in cm or metres — the footprint area is calculated.',
  },
];

type Tab = RackTab;

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Racks', icon: <IcoRack size={15} /> },
  { key: 'active', label: 'Active Racks', icon: <IcoOk size={15} /> },
  { key: 'inactive', label: 'Inactive Racks', icon: <IcoOff size={15} /> },
];

const COLUMNS = [
  'Sr. No', 'Rack ID', 'Rack', 'Rack Dimensions', 'Rack Area', 'Cold Chain', 'Hazardous',
  'Warehouse', 'Zone', 'Total Shelves', 'Rack Status', 'Action',
];

export default function RackMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [searchArmed, setSearchArmed] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const debouncedQuery = useDebouncedValue(query.trim(), 400);

  const [lookups, setLookups] = useState<InventoryLookups>({ warehouses: [], zones: [] });
  const loadLookups = useCallback(() => {
    loadInventoryLookups().then(setLookups).catch(() => {
      toast.error('Could not load warehouses and zones', 'Names and locations may be missing.');
    });
  }, [toast]);
  useEffect(() => { loadLookups(); }, [loadLookups]);
  const warehouseById = useMemo(() => new Map(lookups.warehouses.map(w => [w.apiId, w])), [lookups]);
  const zoneById = useMemo(() => new Map(lookups.zones.filter(z => z.apiId).map(z => [z.apiId as number, z])), [lookups]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  const list = useServerList(
    (q) => rackApi.list({ tab: (q.tab as Tab) ?? 'all', search: q.search, page: q.page, per_page: q.per_page }),
    { perPage: pageSize, search: debouncedQuery, tab },
    (e) => toast.error('Could not load racks', e instanceof InventoryApiError ? e.message : 'Please refresh the page.'),
  );
  const reload = list.reload;

  const rowCount = list.rows.length;
  useEffect(() => { if (rowCount) refitPageSize(); }, [rowCount, refitPageSize]);

  /* Optimistic, like the warehouse and zone switches (CS-942 #19): flip now,
     save behind it, take the server's row when it lands, flip back if
     refused. Then a silent refresh — this list's tabs ARE Active/Inactive,
     so their counts and the filtered tab catch up without the skeleton. */
  const patchRows = list.patch;
  const refreshList = list.refresh;
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());
  const busyRef = useRef(busyIds);
  busyRef.current = busyIds;
  const toggle = useCallback(async (rk: Rack) => {
    const apiId = rk.apiId;
    if (!apiId || busyRef.current.has(apiId)) return;
    const activate = rk.status !== 'active';
    const put = (row: Rack) => patchRows(rs => rs.map(x => (x.apiId === apiId ? row : x)));
    setBusyIds(s => new Set(s).add(apiId));
    put({ ...rk, status: activate ? 'active' : 'inactive' });
    /* Toast with the switch, not after the PUT (2–3 s on live). A refused
       save flips it back and the error toast follows. */
    if (activate) toast.success(`${rk.id} marked Active`, 'Its shelves stay inactive until you switch them back on.');
    else toast.warning(`${rk.id} marked Inactive`, 'It stays in the list, dimmed. Its shelves are deactivated with it.');
    try {
      put(await rackApi.setStatus(apiId, activate));
      refreshList();
    } catch (e) {
      put(rk);
      toast.error('Could not change the status', e instanceof InventoryApiError ? e.message : 'Please try again.');
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(apiId); return n; });
    }
  }, [patchRows, refreshList, toast]);

  const [qrFor, setQrFor] = useState<Rack | null>(null);
  const [formFor, setFormFor] = useState<Rack | 'new' | null>(null);
  const [shelvesFor, setShelvesFor] = useState<Rack | null>(null);

  const [openingId, setOpeningId] = useState<number | null>(null);
  const openEdit = useCallback(async (rk: Rack) => {
    if (openingId) return;
    setOpeningId(rk.apiId);
    try {
      setFormFor(await rackApi.show(rk.apiId));
    } catch (e) {
      toast.error('Could not open the rack', e instanceof InventoryApiError ? e.message : 'Please try again.');
    } finally {
      setOpeningId(null);
    }
  }, [openingId, toast]);

  const onSaved = useCallback(() => {
    reload();
    loadLookups();
  }, [reload, loadLookups]);

  const tabs = list.meta?.tabs;
  const counts: Record<Tab, number> = { all: tabs?.all ?? 0, active: tabs?.active ?? 0, inactive: tabs?.inactive ?? 0 };

  const rows = list.rows;
  const total = list.meta?.total ?? 0;
  const page = list.page;
  const start = (page - 1) * pageSize;
  const changePageSize = useCallback((n: number) => choosePageSize(n), [choosePageSize]);
  const loading = list.loading || list.replacing;

  return (
    <div className="spi-root ord-page whm-page znm-page rkm-page">

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoRack size={17} /></div>
          <div>
            <div className="spi-head-title">Rack Management</div>
            <div className="spi-head-sub">
              Configure racks, shelf levels and bin locations inside rack-based zones for precise putaway and picking.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setFormFor('new')}>
          <IcoPlus /> Add Rack
        </button>
      </div>

      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoRack size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Rack Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating racks inside rack-based storage zones with handling flags and rack dimensions.
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
          <div className="spi-seg" role="tablist" aria-label="Rack status">
            {TABS.map(t => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={tab === t.key}
                className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                {/* The counts ride on the list meta, which is null until the
                    first response - `tabs?.all ?? 0` meant the rail showed
                    zeros meanwhile, and zero is a real count. */}
                <span className="spi-seg-c">
                  {list.meta ? counts[t.key] : <Shimmer width={14} height={10} radius={5}
                    style={{ backgroundColor: tab === t.key ? 'rgba(255,255,255,.5)' : '#b9ccd8' }} />}
                </span>
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
              name="rack-list-search"
              readOnly={!searchArmed}
              onFocus={() => setSearchArmed(true)}
              placeholder="Search by rack ID, rack name, zone or warehouse..."
              aria-label="Search racks"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {/* The shimmer goes INSIDE the real table: the same <thead> stays
            on screen and only the rows are stand-ins, so nothing moves
            between loading and result. Shown for any REPLACING load -
            first paint, search, tab switch, page change - not only when
            the rows happen to be empty: a tab switch keeps the previous
            rows until the response lands, so `rows.length === 0` was false
            and the table sat holding the old tab's rows (CS-939 #7/#8). */}
        {loading ? (
          <div className="ord-table-scroll">
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                <ShimmerTableRows rows={6} cols={COLUMNS.length} height={13} />
              </tbody>
            </table>
          </div>
        ) : total === 0 ? (
          <div className="ord-empty">
            {debouncedQuery ? 'No racks match your search.' : 'No racks in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {rows.map((r, i) => (
                <tbody key={r.apiId}>
                  <Row
                    r={r} sr={start + i + 1} off={r.status !== 'active'}
                    busy={busyIds.has(r.apiId)} opening={openingId === r.apiId}
                    w={r.warehouseId ? warehouseById.get(r.warehouseId) : undefined}
                    z={r.zoneId ? zoneById.get(r.zoneId) : undefined}
                    onToggle={t => void toggle(t)} onQr={setQrFor} onEdit={t => void openEdit(t)}
                    onShelves={setShelvesFor}
                  />
                </tbody>
              ))}
            </table>
          </div>
        )}

        <WorklistPager
          loading={loading}
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
          <AddRackModal
            rack={formFor === 'new' ? undefined : formFor}
            lookups={lookups}
            onClose={() => setFormFor(null)}
            onSaved={onSaved}
          />
        </Suspense>
      )}

      {shelvesFor && (
        <Suspense fallback={null}>
          <RackShelvesModal
            rack={shelvesFor}
            warehouse={shelvesFor.warehouseId ? warehouseById.get(shelvesFor.warehouseId) : undefined}
            zone={shelvesFor.zoneId ? zoneById.get(shelvesFor.zoneId) : undefined}
            onClose={() => { setShelvesFor(null); reload(); }}
          />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <RackQrModal
            rack={qrFor}
            warehouse={qrFor.warehouseId ? warehouseById.get(qrFor.warehouseId) : undefined}
            zone={qrFor.zoneId ? zoneById.get(qrFor.zoneId) : undefined}
            onClose={() => setQrFor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

function ClipName({ value, className }: { value?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const clipped = useIsClipped(ref, value);
  return (
    <Tooltip label={value ?? ''} disabled={!clipped || !value}>
      <b ref={ref} className={className}>{value ?? '—'}</b>
    </Tooltip>
  );
}

function Row({ r, sr, off, busy, opening, w, z, onToggle, onQr, onEdit, onShelves }: {
  r: Rack;
  sr: number;
  off: boolean;
  busy: boolean;
  opening: boolean;
  w: ZoneWarehouse | undefined;
  z: Zone | undefined;
  onToggle: (r: Rack) => void;
  onQr: (r: Rack) => void;
  onEdit: (r: Rack) => void;
  onShelves: (r: Rack) => void;
}) {
  const u = r.dims.unit;
  const levels = r.shelves;

  return (
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{sr}</span></td>

      <td>
        <div className="whm-idcell">
          <span className="whm-idpill">{r.id}</span>
          <span className="whm-iddate">{formatDate(r.date)}</span>
        </div>
      </td>

      <td>
        <div className="whm-namecell">
          <span className="whm-namecell__ico"><IcoRack size={15} /></span>
          <div className="whm-namecell__t">
            <ClipName value={r.name} className="inv-trunc" />
            <span className="whm-namecell__loc">
              {r.cold ? <IcoSnow /> : r.haz ? <IcoHaz /> : <IcoRack size={11} />}
              {rackKind(r)}
            </span>
          </div>
        </div>
      </td>

      <td>
        <span className="rkm-dimcell">
          <b>{inGrouping.format(r.dims.length)}</b><i>×</i>
          <b>{inGrouping.format(r.dims.width)}</b><i>×</i>
          <b>{inGrouping.format(r.dims.height)}</b>
          <small>{u}</small>
        </span>
      </td>

      <td>
        <span className="whm-area znm-area">
          <span><b>{inGrouping.format(r.dims.area)}</b><small>{u}²</small></span>
          <small>≈ {inGrouping.format(r.areaSqft)} Sq. Ft</small>
        </span>
      </td>

      <td>
        <div className="znm-flagcell">
          {r.cold ? (
            <>
              <span className="znm-flag znm-flag--cold"><IcoSnow />Allowed</span>
              {r.tempRange && (
                <span className="znm-rng">
                  {signed(r.tempRange.min)} to {signed(r.tempRange.max)} °C
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
          {r.haz
            ? <span className="znm-flag znm-flag--haz"><IcoHaz />Allowed</span>
            : <span className="znm-flag znm-flag--no">Not Allowed</span>}
        </div>
      </td>

      <td>
        <div className="znm-whcell">
          <span className="whm-idpill znm-whid">{w?.id ?? '—'}</span>
          <ClipName value={w?.name || r.whName || undefined} />
          <span className="rkm-whcity">
            <IcoPin size={10} />{w?.city ?? ''}{w?.state ? `, ${w.state}` : ''}
          </span>
        </div>
      </td>

      <td>
        <div className="znm-whcell">
          <span className="whm-idpill znm-whid">{z?.id ?? '—'}</span>
          <ClipName value={z?.name || r.zoneName || undefined} />
        </div>
      </td>

      <td>
        <Tooltip label={`View the ${levels} shel${levels === 1 ? 'f' : 'ves'} in ${r.id}`}>
          <button type="button" className="rkm-lvl" aria-label={`View shelves in ${r.id}`}
            onClick={() => onShelves(r)}>
            {levels}
          </button>
        </Tooltip>
      </td>

      <td>
        <span className={`whm-status whm-status--${off ? 'off' : 'on'}`}>
          <i />{off ? 'Inactive' : 'Active'}
        </span>
      </td>

      <td>
        <div className="whm-acts">
          <Tooltip label="Edit this rack">
            <button type="button" className="whm-act" aria-label={`Edit ${r.id}`}
              disabled={opening} onClick={() => onEdit(r)}>
              <IcoEdit />
            </button>
          </Tooltip>
          <Tooltip label={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
            <button
              type="button"
              className={`whm-toggle${off ? '' : ' is-on'}`}
              role="switch" aria-checked={!off}
              aria-label={`Toggle status of ${r.id}`}
              aria-busy={busy}
              onClick={() => onToggle(r)}
            >
              <span />
            </button>
          </Tooltip>
          <Tooltip label="Rack QR">
            <button type="button" className="whm-act" aria-label={`Rack QR for ${r.id}`}
              onClick={() => onQr(r)}>
              <IcoQr />
            </button>
          </Tooltip>
          <Tooltip label={`View and add shelves / levels for ${r.id}`}>
            <button type="button" className="rkm-shelfbtn" onClick={() => onShelves(r)}>
              Shelves/ Levels
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
