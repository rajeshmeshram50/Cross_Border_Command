import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import Tooltip from '../../../components/ui/Tooltip';
import WorklistPager from '../../../components/ui/WorklistPager';
import '../../p2p/p2p-common.css';
import '../warehouse/warehouse-master.css';
import { ShimmerTableRows } from '../../../components/ui/Shimmer';
import '../zone/zone.css';
import './rack.css';
import './rack-shelves.css';
import type { Zone, ZoneWarehouse } from '../zone/zone-data';
import { InventoryApiError, type Rack } from './rack-data';
import {
  rackTotals, shelfApi, shelfPct, shelfState, shelfVolumeM3,
  SHELF_STATE_LABEL, type Shelf,
} from './shelf-data';

const AddShelfModal = lazy(() => import('./AddShelfModal'));
const ShelfQrModal = lazy(() => import('./ShelfQrModal'));

const nf = (v: number, dp = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: dp });

/* The shelf name is cut at 15 characters rather than left to the CSS ellipsis.
   The CSS stopped the column moving, but a name long enough to fill 220px was
   still painted to the very edge of the cell with no visible sign it had been
   cut - "The invisible iconThe invisible ico" simply ran into the column
   beside it. Cutting the string itself puts the "…" inside the text, where it
   reads as truncation; the full value stays on the row's title. */
const NAME_MAX = 15;
const clip = (s: string, max = NAME_MAX) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return MONTHS[Number(m) - 1] ? `${d} ${MONTHS[Number(m) - 1]} ${y}` : iso;
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const PAGE_SIZE = 5;

const svg = (d: ReactNode, size = 14, width = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoRack = (p: { size?: number }) => svg(
  <><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" />
    <line x1="4" y1="14" x2="20" y2="14" /></>, p.size ?? 14,
);
const IcoArea = (p: { size?: number }) => svg(
  <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>, p.size ?? 14,
);
const IcoLayers = (p: { size?: number }) => svg(
  <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" /></>, p.size ?? 14,
);
const IcoWeight = (p: { size?: number }) => svg(
  <><circle cx="12" cy="5" r="3" /><path d="M6.5 8h11l2.5 13H4z" /></>, p.size ?? 14,
);
const IcoGauge = (p: { size?: number }) => svg(
  <><path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>, p.size ?? 14,
);
const IcoBox = (p: { size?: number }) => svg(
  <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  p.size ?? 14,
);
const IcoShelf = (p: { size?: number }) => svg(
  <><rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="10" x2="21" y2="10" />
    <line x1="3" y1="15" x2="21" y2="15" /></>, p.size ?? 14,
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
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 14,
);
const IcoQr = () => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>, 14,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 14,
);
const IcoX = () => svg(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, 15);

const COLUMNS = [
  'Sr. No', 'Shelf Code', 'Shelf', 'Shelf Level', 'Maximum Shelf Wt. (Kg)', 'Shelf Dimensions',
  'Shelf Area', 'Shelf Volume', 'Cold Chain', 'Hazardous', 'Total Boxes', 'Utilization Status', 'Action',
];

export default function RackShelvesModal({ rack: r, warehouse: w, zone: z, onClose }: {
  rack: Rack;
  warehouse?: ZoneWarehouse;
  zone?: Zone;
  onClose: () => void;
}) {
  useScrollLock(true, '.rks-mdl');
  const toast = useToast();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [freeCm, setFreeCm] = useState(0);
  const [nextLevel, setNextLevel] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  /* `state` describes what the table HAS; this describes what it is doing.
     load() is called again after a shelf is saved, and it never returned
     state to 'loading' - deliberately, so a failed refresh keeps the rows
     it already had rather than blanking the popup. The cost was that a
     SUCCESSFUL refresh showed nothing either: the old rows sat there until
     the new ones replaced them (CS-942 #17). A separate flag gives the
     shimmer something to key off without touching the failure behaviour. */
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    shelfApi.list(r.apiId)
      .then(res => {
        setShelves(res.shelves);
        setFreeCm(res.freeHeightCm);
        setNextLevel(res.nextLevel);
        setState('ready');
      })
      .catch(e => {
        setState(st => (st === 'ready' ? st : 'failed'));
        toast.error('Could not load the shelves', e instanceof InventoryApiError ? e.message : 'Please try again.');
      })
      .finally(() => setBusy(false));
  }, [r.apiId, toast]);
  useEffect(() => { load(); }, [load]);

  const [formFor, setFormFor] = useState<Shelf | 'new' | null>(null);
  const [qrFor, setQrFor] = useState<Shelf | null>(null);

  const rackOff = r.status === 'inactive';
  /* Optimistic (CS-942 #20): the switch flips on the click and the save runs
     behind it — it used to wait for the PUT and then refetch the whole rack.
     The totals above are worked out from these rows, so updating the one row
     is enough; the server's row replaces the guess, a refusal flips it back.
     Busy is per shelf, so one pending save does not swallow other clicks. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());
  const toggle = async (s: Shelf) => {
    if (rackOff || busyIds.has(s.apiId)) return;
    const activate = s.status !== 'active';
    const put = (row: Shelf) => setShelves(ss => ss.map(x => (x.apiId === s.apiId ? row : x)));
    setBusyIds(b => new Set(b).add(s.apiId));
    put({ ...s, status: activate ? 'active' : 'inactive' });
    if (activate) toast.success(`${s.id} marked Active`);
    else toast.warning(`${s.id} marked Inactive`, 'Its capacity leaves the rack totals above.');
    try {
      put(await shelfApi.setStatus(s.apiId, activate));
    } catch (e) {
      put(s);
      toast.error('Could not change the status', e instanceof InventoryApiError ? e.message : 'Please try again.');
    } finally {
      setBusyIds(b => { const n = new Set(b); n.delete(s.apiId); return n; });
    }
  };

  const t = useMemo(() => rackTotals(shelves), [shelves]);
  const canAdd = state === 'ready' && !rackOff && freeCm > 0;

  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(shelves.length / PAGE_SIZE));
  const start = (Math.min(page, pages) - 1) * PAGE_SIZE;
  const paged = shelves.slice(start, start + PAGE_SIZE);

  const u = r.dims.unit;

  const ringState = t.pct >= 100 ? 'max' : t.pct >= 90 ? 'full' : 'ok';
  const RING: Record<string, [string, string]> = {
    ok: ['#0891b2', '#dff3f7'], full: ['#f59e0b', '#fdf0d5'], max: ['#ef4444', '#fde2e2'],
  };
  const [ink, rest] = RING[ringState];

  return createPortal(
    /* No backdrop-click close — the dialog closes only through the X or
       Cancel, matching every other dialog in Inventory Management. */
    <div className="spi-mdl-backdrop whm-backdrop">
      <div
        className="spi-mdl rks-mdl whm-page"
        role="dialog" aria-modal="true" aria-labelledby="rks-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoRack size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="rks-title">
                Shelves in {r.id} | {r.name}
              </div>
              <div className="spi-mdl-sub">
                {w?.id ?? ''} {w?.name || r.whName} · {z?.id ?? ''} {z?.name || r.zoneName}
              </div>
            </div>
          </div>
          {/* The wrapper, not the button, is what the header flexes against.
              Tooltip slips a span around a DISABLED trigger so the hover still
              fires, and that span would become the flex item — leaving the
              button's own auto margin with nothing to push against, so it
              drifted out of the corner the moment it went disabled. */}
          <div className="rks-addwrap">
            <Tooltip label={canAdd
              ? `Add a shelf to ${r.id}`
              : rackOff ? 'Activate the rack to add shelves' : 'No rack height left for another shelf'}>
              <button type="button" className="rks-add" disabled={!canAdd}
                onClick={() => setFormFor('new')}>
                <IcoPlus /> Add Shelf
              </button>
            </Tooltip>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body rks-body">

          <div className="rks-kpis">
            <Kpi icon={<IcoRack size={17} />} mark={<IcoRack size={64} />} label="Rack ID | Name"
              value={<span className="rks-k__mono">{r.id}</span>} sub={<b>{r.name}</b>} />
            <Kpi icon={<IcoArea size={17} />} mark={<IcoArea size={64} />} label="Rack Area"
              value={<>{nf(r.dims.area, 2)} <em>{u}²</em></>} sub={`≈ ${nf(r.areaSqft, 2)} Sq. Ft`} />
            <Kpi icon={<IcoLayers size={17} />} mark={<IcoLayers size={64} />} label="Total Shelves"
              value={shelves.length} sub={`${t.active} active · ${t.inactive} inactive`} />
            <Kpi icon={<IcoWeight size={17} />} mark={<IcoWeight size={64} />} label="Total Rack Capacity"
              value={<>{nf(t.capacity)} <em>kg</em></>}
              sub={`Across ${t.active} active shelf${t.active === 1 ? '' : 'ves'}`} />
            <Kpi
              className="rks-k--util"
              side={
                <div className={`rks-k__ring rks-k__ring--${ringState}`}
                  style={{ backgroundImage: `conic-gradient(${ink} 0 ${Math.min(100, t.pct)}%, ${rest} ${Math.min(100, t.pct)}% 100%)` }}>
                  <span>{t.pct}<em>%</em></span>
                </div>
              }
              label="Total Rack Utilized"
              value={<>{nf(t.used)} <em>kg</em></>} sub={`${nf(t.free)} kg free`} />
            <Kpi icon={<IcoBox size={17} />} mark={<IcoBox size={64} />} label="Total Boxes"
              value={nf(t.boxes)}
              sub={`Stored across ${t.shelvesWithBoxes} shelf${t.shelvesWithBoxes === 1 ? '' : 'ves'}`} />
          </div>

          <div className="rks-scroll">
            <table className="ord-table rks-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {busy ? (
                  /* The <thead> above stays put, so only the rows are stand-ins
                     and nothing in the popup moves between load and result. */
                  <ShimmerTableRows rows={4} cols={COLUMNS.length} height={13} />
                ) : state !== 'ready' || paged.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length}>
                      <div className="ord-empty">
                        {state === 'failed' ? 'Could not load the shelves.'
                          : 'No shelves in this rack yet.'}
                      </div>
                    </td>
                  </tr>
                ) : paged.map((s, i) => (
                  <ShelfRow
                    key={s.apiId} s={s} sr={start + i + 1}
                    rackOff={rackOff} busy={busyIds.has(s.apiId)} onToggle={() => void toggle(s)}
                    onEdit={() => setFormFor(s)}
                    onQr={() => setQrFor(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>

        </div>

        <div className="spi-mdl-foot rks-foot">
          <WorklistPager
            loading={busy}
            className="wl-teal rks-pager"
            total={shelves.length}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={setPage}
            note={`${freeCm} cm of rack height free`}
            hideNavWhenSinglePage
          />
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>

      {formFor && (
        <Suspense fallback={null}>
          <AddShelfModal
            rack={r}
            freeCm={freeCm}
            nextLevel={nextLevel}
            shelf={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
            onSaved={load}
          />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <ShelfQrModal shelf={qrFor} rack={r} warehouse={w} zone={z} onClose={() => setQrFor(null)} />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}

function Kpi({ icon, mark, side, label, value, sub, className }: {
  icon?: ReactNode; mark?: ReactNode; side?: ReactNode; label: string;
  value: ReactNode; sub: ReactNode; className?: string;
}) {
  return (
    <div className={`rks-k${className ? ` ${className}` : ''}`}>
      {mark && <span className="rks-k__wm" aria-hidden="true">{mark}</span>}
      {side ?? <span className="rks-k__ico">{icon}</span>}
      <div className="rks-k__b">
        <span className="rks-k__l">{label}</span>
        <b className="rks-k__v">{value}</b>
        <small className="rks-k__s">{sub}</small>
      </div>
    </div>
  );
}

function ShelfRow({ s, sr, rackOff, busy, onToggle, onEdit, onQr }: {
  s: Shelf; sr: number; rackOff: boolean; busy: boolean;
  onToggle: () => void; onEdit: () => void; onQr: () => void;
}) {
  const st = shelfState(s);
  const p = shelfPct(s);
  const soff = s.status === 'inactive';
  const u = s.dims.unit;

  return (
    <tr className={soff ? 'is-off' : undefined}>
      <td><span className="whm-sr">{sr}</span></td>

      <td>
        <div className="whm-idcell">
          <span className="whm-idpill">{s.id}</span>
          <span className="whm-iddate">{formatDate(s.date)}</span>
        </div>
      </td>

      <td>
        {/* The name and type can now ellipsise, so the hover has to carry them
            as well as the purpose - otherwise a clipped shelf name is lost. */}
        <div className="whm-namecell" title={`${s.name} — ${s.type}\nPurpose: ${s.purpose}`}>
          <span className="whm-namecell__ico"><IcoShelf size={14} /></span>
          <div className="whm-namecell__t">
            <b>{clip(s.name)}</b>
            <span className="rks-typetxt">{s.type}</span>
          </div>
        </div>
      </td>

      <td><span className="rks-lvlb">{s.level}</span></td>

      <td><b className="rks-num">{nf(s.max)}</b> <small className="rks-u">kg</small></td>

      <td>
        <span className="rkm-dimcell">
          <b>{nf(s.dims.length, 2)}</b><i>×</i>
          <b>{nf(s.dims.width, 2)}</b><i>×</i>
          <b>{nf(s.dims.height, 2)}</b>
          <small>{u}</small>
        </span>
      </td>

      <td><b className="rks-num">{nf(s.dims.area, 2)}</b> <small className="rks-u">{u}²</small></td>

      <td><b className="rks-num">{nf(shelfVolumeM3(s), 3)}</b> <small className="rks-u">m³</small></td>

      <td>
        <div className="znm-flagcell">
          {s.cold ? (
            <>
              <span className="znm-flag znm-flag--cold"><IcoSnow />Allowed</span>
              {s.tempRange && (
                <span className="znm-rng">
                  {signed(s.tempRange.min)} to {signed(s.tempRange.max)} °C
                </span>
              )}
            </>
          ) : <span className="znm-flag znm-flag--no">Not Allowed</span>}
        </div>
      </td>

      <td>
        <div className="znm-flagcell">
          {s.haz
            ? <span className="znm-flag znm-flag--haz"><IcoHaz />Allowed</span>
            : <span className="znm-flag znm-flag--no">Not Allowed</span>}
        </div>
      </td>

      <td><span className="rkm-lvl rks-boxb">{s.boxes}</span></td>

      <td>
        <div className={`rks-ut rks-ut--${st}`}>
          <div className="rks-ut__top">
            <span className={`rks-st rks-st--${st}`}><i />{SHELF_STATE_LABEL[st]}</span>
            <b>{soff ? '—' : `${p}%`}</b>
          </div>
          <div className="rks-ut__bar"><i style={{ width: `${soff ? 0 : Math.max(p, p ? 2 : 0)}%` }} /></div>
          <div className="rks-ut__leg">
            <span className="rks-ut__u"><i />{nf(s.used)} kg used</span>
            <span className="rks-ut__f"><i />{nf(Math.max(0, s.max - s.used))} kg free</span>
          </div>
        </div>
      </td>

      <td>
        <div className="whm-acts">
          <Tooltip label={rackOff ? 'Activate the rack to edit its shelves' : `Edit ${s.id}`}>
            <button type="button" className="whm-act" disabled={rackOff}
              aria-label={`Edit ${s.id}`} onClick={onEdit}>
              <IcoEdit />
            </button>
          </Tooltip>
          <Tooltip label={rackOff
            ? 'Activate the rack first'
            : soff ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
            <button
              type="button"
              className={`whm-toggle${soff ? '' : ' is-on'}`}
              role="switch" aria-checked={!soff} disabled={rackOff} aria-busy={busy}
              aria-label={`Toggle status of ${s.id}`}
              onClick={onToggle}
            >
              <span />
            </button>
          </Tooltip>
          <Tooltip label={`Shelf QR for ${s.id}`}>
            <button type="button" className="whm-act" aria-label={`Shelf QR for ${s.id}`}
              onClick={onQr}>
              <IcoQr />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
