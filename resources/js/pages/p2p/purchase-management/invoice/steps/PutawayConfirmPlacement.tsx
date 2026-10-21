import type { ReactNode } from 'react';
import type { PutawayFloorZone, PutawayLocations, PutawayRack, PutawayShelf, PutawayZone } from '../spi-api';

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 04 · STEP 03 — Confirm Putaway Allocation.
 *
 * The box on the left, the place it is going on the right, and one action
 * under them. Nothing here is a new decision: Step 01 chose the box and Step
 * 02 chose the location, so this step exists to show both in full and let the
 * operator commit them — by handheld or by hand.
 *
 * Until they do, the action area says so in as many words. A screen that shows
 * a location without saying whether it has been COMMITTED is the one way this
 * step could mislead, since the two look identical.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ConfirmBox {
  code: string;
  /** "Scenario 01" and what it means, as Step 01's card words them. */
  scenarioNo: string;
  scenario: string;
  /** "Single Box" / "Box 2 of 4" / "Mixed Carton"; null when unknown. */
  modeLabel: string | null;
  /** Which list the box came from, and its label on the card's pill. */
  sectionKey: string;
  sectionLabel: string;
  packedOn: string | null;
  skus: number;
  qty: number;
  uom: string | null;
  dims: string | null;
  netKg: string | null;
  grossKg: string | null;
  remark: string | null;
  condition: string | null;
  flags: string[];
  products: number;
}

/** Where the box is going — a shelf on a rack, or a zone floor. */
export type ConfirmSpot =
  | { kind: 'shelf'; shelf: PutawayShelf; rack: PutawayRack; zone: PutawayZone }
  | { kind: 'zone'; zone: PutawayFloorZone };

/**
 * Resolve what Step 02 picked.
 *
 * This used to walk zones → racks → shelves and nothing else, so a box sent to
 * a FLOOR zone resolved to null and this step reported that nothing had been
 * chosen — after the operator had just chosen it. The floor list is searched
 * too now.
 */
export function findSpot(data: PutawayLocations | null, id: number | null): ConfirmSpot | null {
  if (!data || id == null) return null;
  for (const zone of data.zones ?? []) {
    for (const rack of zone.racks ?? []) {
      const shelf = rack.shelves.find(s => s.id === id);
      if (shelf) return { kind: 'shelf', shelf, rack, zone };
    }
  }
  const floor = (data.floor ?? []).find(z => z.id === id);
  return floor ? { kind: 'zone', zone: floor } : null;
}

/** "RC-D02-SH-03" -> "SH-03". */
const shortCode = (c: string) => { const m = String(c).match(/SH-\d+$/); return m ? m[0] : c; };
const m3 = (v: number) => `${Number.isInteger(v) ? v : Number(v.toFixed(3))} m³`;

/* ── icons ───────────────────────────────────────────────────────────────── */
const svg = (d: ReactNode, size: number, w = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const IcoBox = ({ size = 16 }: { size?: number }) => svg(<>
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>, size);
const IcoPin = ({ size = 16 }: { size?: number }) =>
  svg(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>, size);
const IcoPrn = () => svg(<><polyline points="6 9 6 2 18 2 18 9" />
  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
  <rect x="6" y="14" width="12" height="8" /></>, 12);
const IcoCal = () => svg(<><rect x="3" y="4" width="18" height="18" rx="2" />
  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>, 12);
const IcoWh = () => svg(<><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-6h6v6" /></>, 13);
const IcoMap = () => svg(<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />, 13);
const IcoRack = () => svg(<><rect x="3" y="3" width="18" height="18" rx="2" />
  <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></>, 13);
const IcoLyr = () => svg(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /></>, 13);
const IcoEdit = () => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, 12);
const IcoTick = ({ size = 14 }: { size?: number }) => svg(<polyline points="20 6 9 17 4 12" />, size, 3);
const IcoList = () => svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
  <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
  <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>, 13);
const IcoScan = ({ size = 20 }: { size?: number }) => svg(<>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <line x1="7" y1="8" x2="7" y2="16" /><line x1="10" y1="8" x2="10" y2="16" />
  <line x1="13" y1="8" x2="13" y2="16" /><line x1="17" y1="8" x2="17" y2="16" /></>, size);
const IcoBan = () => svg(<><circle cx="12" cy="12" r="10" />
  <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>, 14);
const IcoChevR = () => svg(<polyline points="9 18 15 12 9 6" />, 14);

/** A remark or condition word, and the tone it carries. */
const TONE: Record<string, string> = {
  'Correct Product': 'ok', Perfect: 'ok',
  'Extra Quantity': 'info', Mismatched: 'warn', 'Minor Damage': 'warn',
  'Damaged / Rejected': 'bad', 'Major Damage': 'bad', 'Critical Damage': 'bad',
};

const stat = (k: string, v: ReactNode, u?: string) => (
  <div key={k}><span>{k}</span><b>{v}{u && <> <i>{u}</i></>}</b></div>
);
const kv = (k: string, v: ReactNode) => <div key={k}><span>{k}</span><b>{v}</b></div>;

export default function PutawayConfirmPlacement({
  box, spot, warehouse, warehouseCode = null, assigned, scan = null, placedVia = null,
  qr, locQr, onChange, onMethod, onViewProducts, onSticker, onCancelTask, onOpenScanTask,
}: {
  box: ConfirmBox;
  spot: ConfirmSpot | null;
  warehouse?: string | null;
  warehouseCode?: string | null;
  /** True once the placement has actually been committed. */
  assigned: boolean;
  /** The raised Zebra task, while one is outstanding.
   *  Deliberately NOT the same as assigned: the box is not in place until both
   *  scans come back, and a screen that said "Placed" here would be claiming
   *  something nobody has checked. */
  scan?: { id: string; at: string } | null;
  /** How a placed box got there, when it went through Zebra verification.
   *  Null after a manual confirmation, which has no device behind it. */
  placedVia?: { via: string; allocation: string } | null;
  /** Both QRs are rendered by the parent so there is one QR component. */
  qr: ReactNode;
  locQr: ReactNode;
  onChange: () => void;
  onMethod: () => void;
  onViewProducts: () => void;
  onSticker?: () => void;
  onCancelTask?: () => void;
  onOpenScanTask?: () => void;
}) {
  /** Outstanding: a task exists and the box is not in place yet. */
  const waiting = !!scan && !assigned;

  const isZone = spot?.kind === 'zone';
  const code = !spot ? null
    : spot.kind === 'zone' ? spot.zone.code : shortCode(spot.shelf.code);
  const title = !spot ? null
    : spot.kind === 'zone' ? (spot.zone.name || 'Unnamed zone')
    : `${spot.shelf.name || 'Shelf'} · Level ${spot.shelf.level_no}`;
  const path = !spot ? '' : [
    warehouse,
    spot.zone.name,
    ...(spot.kind === 'shelf' ? [spot.rack.name, spot.shelf.name] : []),
  ].filter(Boolean).join(' › ');

  /** The address, as the trail across the card reads it. */
  const trail: Array<[ReactNode, string, string]> = !spot ? [] : [
    [<IcoWh key="w" />, 'Warehouse', warehouseCode || '—'],
    [<IcoMap key="z" />, 'Zone', spot.zone.code],
    ...(spot.kind === 'shelf'
      ? ([[<IcoRack key="r" />, 'Rack', spot.rack.code],
          [<IcoLyr key="s" />, 'Shelf', shortCode(spot.shelf.code)]] as Array<[ReactNode, string, string]>)
      : ([[<IcoLyr key="p" />, 'Placement', 'Direct']] as Array<[ReactNode, string, string]>)),
  ];

  return (
    <div className="s4c3">
      <div className="s4c3-cols">
        {/* ── The box ── */}
        <div className="s4c3-card s4c3-card--box">
          <div className="s4c3-hd">
            <span className="s4c3-hd__i"><IcoBox /></span>
            <div className="s4c3-hd__tx"><b>Box Details</b><em>The packed box being put away</em></div>
            <span className={`s4c3-cat s4c3-cat--${box.sectionKey}`}>{box.sectionLabel}</span>
          </div>
          <div className="s4c3-bd">
            <div className="s4c3-hero">
              <div className="s4c3-qr">{qr}</div>
              <div className="s4c3-hero__tx">
                <span className="s4c3-k">Box ID</span>
                <div className="s4c3-id">{box.code}</div>
                <div className="s4c3-sub">
                  {box.scenarioNo} · {box.scenario}{box.modeLabel && <> · <b>{box.modeLabel}</b></>}
                </div>
                <div className="s4c3-meta">
                  {box.packedOn && <span><IcoCal /> Packed {box.packedOn}</span>}
                  <button type="button" className="s4c3-stk" onClick={onSticker}>
                    <IcoPrn /> {box.code} Sticker
                  </button>
                </div>
              </div>
            </div>

            <div className="s4c3-stats">
              {stat('Box Qty', box.qty, box.uom || 'units')}
              {stat('Dimensions', box.dims || '—')}
              {stat('Net Wt.', box.netKg || '—')}
              {stat('Gross Wt.', box.grossKg || '—')}
            </div>

            <div className="s4c3-attrs">
              <div>
                <span>Product Remark</span>
                <i className={`s4c3-pill s4c3-pill--${TONE[box.remark ?? ''] ?? 'info'}`}>{box.remark ?? '—'}</i>
              </div>
              <div>
                <span>Box Condition</span>
                <i className={`s4c3-pill s4c3-pill--${TONE[box.condition ?? ''] ?? 'info'}`}>{box.condition ?? '—'}</i>
              </div>
              <div className="s4c3-attrs__f">
                <span>Product Flags</span>
                <div>
                  {box.flags.length
                    ? box.flags.map(f => <span className="s4c3-pill s4c3-pill--flag" key={f}>{f}</span>)
                    : <span className="s4c3-na">No flags</span>}
                </div>
              </div>
            </div>

            <button type="button" className="s4c3-prodbtn" onClick={onViewProducts}>
              <IcoList />View Products<span>{box.products}</span>
            </button>
          </div>
        </div>

        {/* ── Where it is going ── */}
        <div className="s4c3-card s4c3-card--loc">
          <div className="s4c3-hd">
            <span className="s4c3-hd__i"><IcoPin /></span>
            <div className="s4c3-hd__tx">
              <b>Selected Location Details</b>
              <em>{!spot ? 'No location selected yet'
                : isZone ? 'Storage zone without rack · direct placement'
                : 'Storage zone with rack · Zone › Rack › Shelf'}</em>
            </div>
            {spot && (
              <button type="button" className="s4c3-chg" onClick={onChange}><IcoEdit /> Change</button>
            )}
          </div>
          <div className="s4c3-bd">
            {!spot ? (
              <div className="s4c3-na">Go back to Step 02 and pick a shelf or zone.</div>
            ) : (
              <>
                <div className="s4c3-hero s4c3-hero--loc">
                  <div className="s4c3-qr s4c3-qr--loc">{locQr}<span>{code}</span></div>
                  <div className="s4c3-hero__tx">
                    <span className="s4c3-kind">{isZone ? 'Direct Storage Zone' : 'Rack & Shelf'}</span>
                    <div className="s4c3-id s4c3-id--loc">{title}</div>
                    <div className="s4c3-sub">{path}</div>
                  </div>
                </div>

                <div className="s4c3-trk">
                  {trail.map(([ico, k, v], i) => (
                    <>
                      {i > 0 && <span className="s4c3-arr" key={`a${k}`}>›</span>}
                      <div className="s4c3-node" key={k}>
                        <span className="s4c3-node__i">{ico}</span><span>{k}</span><b>{v}</b>
                      </div>
                    </>
                  ))}
                </div>

                {/* Six figures. The design's Max Stack and Max Load are not
                    shown: nothing in the engine enforces either for a zone, so
                    the two capacities it DOES check stand in their place. */}
                <div className="s4c3-kv">
                  {spot.kind === 'zone' ? <>
                    {kv('Zone Type', (spot.zone.purpose ?? '').trim() || 'Floor zone')}
                    {kv('Floor Area', spot.zone.area_sqft ? `${spot.zone.area_sqft.toLocaleString('en-IN')} sq ft` : 'Not measured')}
                    {kv('Free Space', m3(spot.zone.free_m3))}
                    {kv('Capacity', spot.zone.capacity_m3 ? m3(spot.zone.capacity_m3) : 'Not measured')}
                    {kv('Cold Chain', spot.zone.cold_chain ? 'Yes' : 'No')}
                    {kv('Hazardous', spot.zone.hazardous ? 'Yes' : 'No')}
                  </> : <>
                    {kv('Zone', spot.zone.name || '—')}
                    {kv('Rack', spot.rack.name || '—')}
                    {kv('Shelf', `${spot.shelf.name || 'Shelf'} · L${spot.shelf.level_no}`)}
                    {kv('Available Capacity', `${spot.shelf.free_weight_kg.toLocaleString('en-IN')} kg`)}
                    {kv('Cold Chain', spot.zone.cold_chain ? 'Yes' : 'No')}
                    {kv('Hazardous', spot.zone.hazardous ? 'Yes' : 'No')}
                  </>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── One action, or the state that replaced it ── */}
      <div className={`s4c3-act${assigned || waiting ? ' is-banner' : ''}`}>
        {assigned ? (
          <div className="s4zb s4zb--done">
            <span className="s4zb-i"><IcoTick size={20} /></span>
            <div className="s4zb-tx">
              <b>Putaway Completed</b>
              <p>
                {box.code} is locked at <code>{code}</code>
                {placedVia?.allocation && <> · Allocation <code>{placedVia.allocation}</code></>}
                {' · '}{placedVia ? `Verified via ${placedVia.via}` : 'Manual confirmation'}.
              </p>
            </div>
          </div>
        ) : waiting && scan ? (
          <div className="s4zb">
            <span className="s4zb-i"><IcoScan size={22} /></span>
            <div className="s4zb-tx">
              <b>Awaiting Zebra scanning &amp; confirmation <i className="s4zb-pulse" /></b>
              <p>
                Task <code>{scan.id}</code> created for <code>{box.code} → {code}</code>. The box is
                placed only after the operator scans the <b>Box QR</b> and the{' '}
                <b>{isZone ? 'Zone' : 'Shelf'} QR</b> with a Zebra handheld.
              </p>
              <div className="s4zb-chips">
                <span>Box QR</span>
                <span>{isZone ? 'Zone' : 'Shelf'} QR</span>
                <span className="s4zb-cnt">0 / 2 scans</span>
                <span className="s4zb-time">Submitted {scan.at}</span>
              </div>
            </div>
            <div className="s4zb-btns">
              <button type="button" className="s4zb-cancel" onClick={onCancelTask}><IcoBan /> Cancel Task</button>
              <button type="button" className="s4zb-open" onClick={onOpenScanTask}>Open Scan Task <IcoChevR /></button>
            </div>
          </div>
        ) : (
          <button type="button" className="s4c3-pm" disabled={!spot} onClick={onMethod}
            title={spot ? undefined : 'Choose a location in Step 02 first'}>
            <IcoTick /> Putaway Method
          </button>
        )}
      </div>
    </div>
  );
}
