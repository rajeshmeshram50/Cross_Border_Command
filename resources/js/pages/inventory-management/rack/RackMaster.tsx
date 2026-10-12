import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
/* Page chrome, then the warehouse master's cells and the zone master's flag
   and warehouse cells — the prototype shares those across these four masters,
   so this page carries all three roots the way the zone list carries two. */
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone.css';
import './rack.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import Tooltip from '../../../components/ui/Tooltip';
import { useIsClipped } from '../../../components/ui/DataTable';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { RACKS, rackKind, rackLevels, type Rack } from './rack-data';
import { ZONES } from '../zone/zone-data';
import { WAREHOUSES } from '../warehouse/warehouse-data';

const RackQrModal = lazy(() => import('./RackQrModal'));
const AddRackModal = lazy(() => import('./AddRackModal'));
const RackShelvesModal = lazy(() => import('./RackShelvesModal'));

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* Built once at module scope — the table formats three figures per row. */
const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : iso;
}

/* The warehouse and zone each rack sits in, by code. Built once: the list
   joins on both for every row, and a linear search per row would be 50 × 24
   and 50 × 81. */
const WAREHOUSE_BY_CODE = new Map(WAREHOUSES.map(w => [w.id, w]));
const ZONE_BY_CODE = new Map(ZONES.map(z => [z.id, z]));

/** `+15 to +25 °C` — a signed range, as the design writes it. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/* ── Icons: the prototype's own paths ─────────────────────────────────── */
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

type Tab = 'all' | 'active' | 'inactive';

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Racks', icon: <IcoRack size={15} /> },
  { key: 'active', label: 'Active Racks', icon: <IcoOk size={15} /> },
  { key: 'inactive', label: 'Inactive Racks', icon: <IcoOff size={15} /> },
];

const COLUMNS = [
  'Sr. No', 'Rack ID', 'Rack', 'Rack Dimensions', 'Rack Area', 'Cold Chain', 'Hazardous',
  'Warehouse', 'Zone', 'Total Shelves', 'Rack Status', 'Action',
];

/**
 * Rack Master.
 *
 * Design only, on static rows, sharing its chrome with the warehouse, zone and
 * product-flag lists. The status switch changes what the row says; nothing is
 * persisted.
 *
 * Unlike the other three, its tabs split on STATUS rather than on a fixed
 * property — so the counts move as rows are switched, and they are computed
 * from the live map rather than once at mount.
 */
export default function RackMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const [inactive, setInactive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(RACKS.filter(r => r.status === 'inactive').map(r => [r.id, true])),
  );
  const toggle = useCallback((id: string) => {
    const next = !inactive[id];
    setInactive(m => ({ ...m, [id]: next }));
    /* Outside the updater: React may run one twice, and the toast with it. */
    if (next) toast.warning(`${id} marked Inactive`, 'It stays in the list, dimmed.');
    else toast.success(`${id} marked Active`);
  }, [inactive, toast]);

  const [qrFor, setQrFor] = useState<Rack | null>(null);
  /* 'new' is Add; a row is Edit; null is closed. */
  const [formFor, setFormFor] = useState<Rack | 'new' | null>(null);
  const [shelvesFor, setShelvesFor] = useState<Rack | null>(null);

  /* Counts come from the whole set, never the searched one — a count that
     shrinks as you type reads as data disappearing. They DO follow the status
     switch, because that is what the tabs split on. */
  const counts = useMemo(() => {
    const off = RACKS.filter(r => inactive[r.id]).length;
    return { all: RACKS.length, active: RACKS.length - off, inactive: off };
  }, [inactive]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RACKS.filter(r => {
      const off = !!inactive[r.id];
      if (tab === 'active' && off) return false;
      if (tab === 'inactive' && !off) return false;
      if (!q) return true;
      const w = WAREHOUSE_BY_CODE.get(r.wh);
      const z = ZONE_BY_CODE.get(r.zone);
      return [
        r.id, r.name, r.wh, r.zone, z?.name,
        w?.name, w?.city, w?.state, w?.pin,
        rackKind(r), off ? 'inactive' : 'active',
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [tab, query, inactive]);

  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);
  useEffect(() => { if (rows.length) refitPageSize(); }, [rows.length, refitPageSize]);
  useEffect(() => { setPage(1); }, [tab, query]);

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);
  const changePageSize = useCallback((n: number) => { choosePageSize(n); setPage(1); }, [choosePageSize]);

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
              placeholder="Search by rack ID, rack name, zone or warehouse..."
              aria-label="Search racks"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {total === 0 ? (
          <div className="ord-empty">
            {query.trim() ? 'No racks match your search.' : 'No racks in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {paged.map((r, i) => (
                <tbody key={r.id}>
                  <Row
                    r={r} sr={start + i + 1} off={!!inactive[r.id]}
                    onToggle={toggle} onQr={setQrFor} onEdit={setFormFor} onShelves={setShelvesFor}
                  />
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
          onPage={setPage}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {formFor && (
        <Suspense fallback={null}>
          <AddRackModal
            rack={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
          />
        </Suspense>
      )}

      {shelvesFor && (
        <Suspense fallback={null}>
          <RackShelvesModal rack={shelvesFor} onClose={() => setShelvesFor(null)} />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <RackQrModal rack={qrFor} onClose={() => setQrFor(null)} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * A warehouse or zone name, with the whole of it on hover when the column has
 * cut it.
 *
 * The clip here comes from the column's width, not from a character count —
 * `.znm-whcell b` caps at 170px and ellipsises — so whether to offer a tooltip
 * is measured from the DOM rather than guessed from the string's length. A
 * short name in a narrow column is cut; a long one in a wide column is not.
 *
 * `title` would have done the same job, but the app's own Tooltip is what
 * every other truncation in this flow uses, and the two look nothing alike.
 */
function ClipName({ value, className }: { value?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const clipped = useIsClipped(ref, value);
  return (
    <Tooltip label={value ?? ''} disabled={!clipped || !value}>
      <b ref={ref} className={className}>{value ?? '—'}</b>
    </Tooltip>
  );
}

/** One rack. */
function Row({ r, sr, off, onToggle, onQr, onEdit, onShelves }: {
  r: Rack;
  sr: number;
  off: boolean;
  onToggle: (id: string) => void;
  onQr: (r: Rack) => void;
  onEdit: (r: Rack) => void;
  onShelves: (r: Rack) => void;
}) {
  const w = WAREHOUSE_BY_CODE.get(r.wh);
  const z = ZONE_BY_CODE.get(r.zone);
  const u = r.dims.unit;
  const levels = rackLevels(r);

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
            <ClipName value={r.name} className="pts-trunc" />
            <span className="whm-namecell__loc">
              {r.cold ? <IcoSnow /> : r.haz ? <IcoHaz /> : <IcoRack size={11} />}
              {rackKind(r)}
            </span>
          </div>
        </div>
      </td>

      {/* Length × width × height, with the unit said once at the end — three
          units on one line is the same word three times. */}
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
          <span className="whm-idpill znm-whid">{r.wh}</span>
          <ClipName value={w?.name} />
          <span className="rkm-whcity">
            <IcoPin size={10} />{w?.city ?? ''}{w?.state ? `, ${w.state}` : ''}
          </span>
        </div>
      </td>

      <td>
        <div className="znm-whcell">
          <span className="whm-idpill znm-whid">{r.zone}</span>
          <ClipName value={z?.name} />
        </div>
      </td>

      {/* Derived from the rack's height, not stored — so it is a count, and
          the button is the way into the shelves it counts. */}
      <td>
        <Tooltip label={`View the ${levels} shelves in ${r.id}`}>
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
              onClick={() => onEdit(r)}>
              <IcoEdit />
            </button>
          </Tooltip>
          <Tooltip label={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
            <button
              type="button"
              className={`whm-toggle${off ? '' : ' is-on'}`}
              role="switch" aria-checked={!off}
              aria-label={`Toggle status of ${r.id}`}
              onClick={() => onToggle(r.id)}
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
