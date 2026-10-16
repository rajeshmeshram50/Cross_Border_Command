import type { ReactNode } from 'react';
import type { PutawayLocations, PutawayRack, PutawayShelf, PutawayZone } from '../spi-api';

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 04 · STEP 03 — Confirm Placement.
 *
 * The box on the left, the shelf it is going to on the right, and the arrow
 * between them. Nothing here is a new decision: Step 01 chose the box and
 * Step 02 chose the shelf, so this step exists to show both at once and let
 * the operator commit them — by scanner or by hand.
 *
 * Until they do, the strip says so in as many words. A screen that shows a
 * location without saying whether it has been ASSIGNED is the one way this
 * step could mislead, since the two look identical.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ConfirmBox {
  code: string;
  scenario: string;
  skus: number;
  qty: number;
  uom: string | null;
  dims: string | null;
  netKg: string | null;
  grossKg: string | null;
  condition: string;
  products: number;
}

/** The chosen shelf with the rack and zone it sits in. */
export interface ConfirmSpot {
  shelf: PutawayShelf;
  rack: PutawayRack;
  zone: PutawayZone;
}

/** Find the picked shelf and the branch it hangs off. Returns null when the
 *  tree has not loaded or nothing is picked, which the caller renders as the
 *  "no location" state rather than an error. */
export function findSpot(data: PutawayLocations | null, shelfId: number | null): ConfirmSpot | null {
  if (!data || shelfId == null) return null;
  for (const zone of data.zones) {
    for (const rack of zone.racks ?? []) {
      const shelf = rack.shelves.find(s => s.id === shelfId);
      if (shelf) return { shelf, rack, zone };
    }
  }
  return null;
}

const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="s4cp-kv"><span>{k}</span><b>{v}</b></div>
);

const pct = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}%`;

/** Step 03 records a condition word; the badge shows the verdict and its
 *  qualifier, the same pair Step 01's card uses. */
const CONDITION: Record<string, [string, string]> = {
  perfect: ['Perfect', 'No damage'],
  minor: ['Minor wear', 'Usable'],
  major: ['Damaged', 'Visible damage'],
  severe: ['Rejected', 'Critical damage'],
  mismatch: ['Mismatch', 'Wrong product'],
};

const IcoBox = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IcoShelf = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
  </svg>
);
const IcoPin = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const IcoArrowR = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
  </svg>
);
const IcoList = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const IcoScan = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const IcoBan = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IcoChev = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IcoCheckSq = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export default function PutawayConfirmPlacement({
  box, spot, warehouse, warehouseCode = null, assigned, scan = null, placedVia = null, qr,
  onChange, onMethod, onViewProducts, onCancelTask, onOpenScanTask,
}: {
  box: ConfirmBox;
  spot: ConfirmSpot | null;
  warehouse?: string | null;
  /** The warehouse's own code for the task's address line. */
  warehouseCode?: string | null;
  /** True once the placement has actually been committed. */
  assigned: boolean;
  /** The raised Zebra task, while one is outstanding.
   *  Deliberately NOT the same as assigned: the box is not on the shelf until
   *  both scans come back, and a screen that said "Placed" here would be
   *  claiming something nobody has checked. */
  scan?: { id: string; at: string } | null;
  /** How a placed box got there, when it went through Zebra verification.
   *  Null after a manual confirmation, which has no device behind it. */
  placedVia?: { via: string; allocation: string } | null;
  onCancelTask?: () => void;
  onOpenScanTask?: () => void;
  /** The box's QR, rendered by the parent so there is one QR component. */
  qr: ReactNode;
  onChange: () => void;
  onMethod: () => void;
  onViewProducts: () => void;
}) {
  const [cond, condNote] = CONDITION[box.condition] ?? CONDITION.perfect;
  const sh = spot?.shelf;
  const adds = sh ? Math.max(0, sh.used_pct_after - sh.used_pct) : 0;
  /** Outstanding: a task exists and the box is not on the shelf yet. */
  const waiting = !!scan && !assigned;
  /** The box's full address, as the task names it. */
  const addr = spot
    ? [warehouseCode, spot.zone.code, spot.rack.code, shortCode(spot.shelf.code)].filter(Boolean)
    : [];

  return (
    <div className="s4cp">
      {/* ── From here, to there ── The whole step in one line. */}
      <div className="s4cp-route">
        <div className="s4cp-route__side">
          <span className="s4cp-route__ic"><IcoBox size={17} /></span>
          <div>
            {/* "Verifying", not "placing": once a task is out, the box is not
                on its way to the shelf, it is waiting to be checked onto it. */}
            <div className="s4cp-route__k">{waiting ? 'Verifying box' : 'Placing box'}</div>
            <span className="s4cp-route__code">{box.code}</span>
            {/* Absorbed from the hero strip above, which this one replaced:
                it is the only thing that band said that is not already here. */}
            {box.scenario && <div className="s4cp-route__scn">{box.scenario}</div>}
          </div>
        </div>

        <span className="s4cp-route__arrow" aria-hidden><IcoArrowR size={18} /></span>

        <div className="s4cp-route__target">
          <div className="s4cp-route__k">
            <IcoPin />Placing into
            {spot && <span className="s4cp-route__kind">Rack shelf</span>}
          </div>
          {spot ? (
            <>
              <div className="s4cp-route__codes">
                <span className="s4sl-code s4sl-code--z">{spot.zone.code}</span><i>›</i>
                <span className="s4sl-code s4sl-code--r">{spot.rack.code}</span><i>›</i>
                <span className="s4sl-code s4sl-code--s">{shortCode(spot.shelf.code)}</span>
              </div>
              <div className="s4cp-route__path">
                {[warehouse, spot.zone.name, spot.rack.name, spot.shelf.name].filter(Boolean).join(' › ')}
              </div>
            </>
          ) : (
            <div className="s4cp-route__path">Nothing chosen in Step 02 yet.</div>
          )}
        </div>

        {/* The one thing this screen could get wrong is looking committed
            before it is, so the state is stated, not implied. */}
        <div className={`s4cp-route__state${assigned ? ' is-done' : ''}${waiting ? ' is-wait' : ''}`}>
          <b>{assigned && placedVia ? '2/2' : assigned ? '✓' : waiting ? '0/2' : '?'}</b>
          <span>{assigned && placedVia ? 'Scanned' : assigned ? 'Placed' : waiting ? 'Awaiting' : 'Yet to decide'}</span>
        </div>
      </div>

      {/* The task's own line, directly under the route it verifies. */}
      {waiting && scan && spot && (
        <div className="s4cp-task">
          <span className="s4cp-task__k"><IcoScan />Zebra task</span>
          <b className="s4cp-task__id">{scan.id}</b>
          <span className="s4cp-task__codes">
            <span className="s4sl-code s4sl-code--z">{spot.zone.code}</span><i>→</i>
            <span className="s4sl-code s4sl-code--r">{spot.rack.code}</span><i>→</i>
            <span className="s4sl-code s4sl-code--s">{shortCode(spot.shelf.code)}</span>
          </span>
          <span className="s4cp-task__r">Assigned · awaiting device scan</span>
        </div>
      )}

      <div className={`s4cp-status${assigned ? ' is-done' : ''}`}>
        <span className="s4cp-status__l">
          {assigned ? <IcoCheckSq size={13} /> : <IcoPin />}
          {assigned && placedVia ? 'Putaway completed'
            : assigned ? 'Location assigned'
            : waiting ? 'Awaiting Zebra scan on the floor'
            : 'No location assigned yet'}
          {assigned && placedVia && spot && (
            <span className="s4cp-task__codes">
              <span className="s4sl-code s4sl-code--z">{spot.zone.code}</span><i>→</i>
              <span className="s4sl-code s4sl-code--r">{spot.rack.code}</span><i>→</i>
              <span className="s4sl-code s4sl-code--s">{shortCode(spot.shelf.code)}</span>
            </span>
          )}
        </span>
        <span className="s4cp-status__r">
          {assigned && placedVia
            ? <span className="s4cp-via">Placed · {placedVia.via}</span>
            : spot
            /* Not "click Putaway Method" while that button is locked - the
               next move belongs to the floor, not to this screen. */
            ? <>Step 02 location <b>{shortCode(spot.shelf.code)}</b> · {
                assigned ? 'confirmed'
                  : waiting ? 'locked until both QR scans are verified'
                  : 'click Putaway Method to confirm'}</>
            : <>Go back to Step 02 and choose a shelf.</>}
        </span>
      </div>

      <div className="s4cp-cols">
        {/* ── The box ── */}
        <section className="s4cp-card">
          <div className="s4cp-card__hd">
            <span className="s4cp-card__ic s4cp-card__ic--box"><IcoBox size={15} /></span>
            <div>
              <div className="s4cp-card__t">Box Details</div>
              <div className="s4cp-card__s">The box being put away</div>
            </div>
          </div>

          <div className="s4cp-qr">{qr}</div>
          <div className="s4cp-qr__code">{box.code}</div>

          <div className="s4cp-kvs">
            <KV k="Box condition" v={<span className="s4bc s4bc--ok"><b>{cond}</b><i>{condNote}</i></span>} />
            <KV k="Packaging scenario" v={box.scenario} />
            <KV k="Total products in box" v={`${box.skus} Product${box.skus === 1 ? '' : 's'}`} />
            <KV k="Total quantity in box" v={`${box.qty} ${box.uom || 'units'}`} />
            <KV k="Dimensions (L×W×H)" v={box.dims || <em className="s4pd-na">Not available</em>} />
            <KV k="Net weight" v={box.netKg || <em className="s4pd-na">Not available</em>} />
            <KV k="Gross weight" v={box.grossKg || <em className="s4pd-na">Not available</em>} />
          </div>

          <button type="button" className="s4vp-btn" onClick={onViewProducts}>
            <IcoList />View Products<span className="s4vp-n">{box.products}</span>
          </button>
        </section>

        {/* The join between the two, carrying the same state as the strip. */}
        <div className="s4cp-join" aria-hidden>
          <span className={`s4cp-join__dot${assigned ? ' is-done' : ''}`}>
            {/* Its own element: the dot's two pseudo-elements are the rails,
                and the ring has to sit outside the white gap, not on it. */}
            <i className="s4cp-join__ring" aria-hidden />
            <IcoArrowR size={17} />
          </span>
          <span className={`s4cp-join__tag${assigned ? ' is-done' : ''}`}>
            {assigned ? 'Placed' : waiting ? 'Awaiting scan' : 'Pending'}
          </span>
        </div>

        {/* ── The shelf ── */}
        <section className="s4cp-card">
          <div className="s4cp-card__hd">
            <span className="s4cp-card__ic s4cp-card__ic--shelf"><IcoShelf size={15} /></span>
            <div>
              <div className="s4cp-card__t">Shelf Details</div>
              <div className="s4cp-card__s">Storage zone with rack · Zone › Rack › Shelf</div>
            </div>
            <button type="button" className="s4cp-change" onClick={onChange}>Change</button>
          </div>

          {!spot || !sh ? (
            <div className="s4vp-none">No shelf chosen. Step 02 is where that happens.</div>
          ) : (
            <>
              <div className="s4cp-shelf">
                <div className="s4cp-shelf__t">{sh.name || `Shelf level ${sh.level_no}`}</div>
                <div className="s4cp-shelf__p">{[spot.zone.name, spot.rack.name, sh.name].filter(Boolean).join(' › ')}</div>
                <div className="s4cp-route__codes">
                  <span className="s4sl-code s4sl-code--z">{spot.zone.code}</span><i>›</i>
                  <span className="s4sl-code s4sl-code--r">{spot.rack.code}</span><i>›</i>
                  <span className="s4sl-code s4sl-code--s">{shortCode(sh.code)}</span>
                </div>
              </div>

              <div className="s4cp-kvs">
                <KV k="Zone" v={spot.zone.name || <em className="s4pd-na">Not named</em>} />
                <KV k="Rack" v={spot.rack.name || <em className="s4pd-na">Not named</em>} />
                <KV k="Shelf" v={sh.name || <em className="s4pd-na">Not named</em>} />
                <KV k="Shelf level" v={`L${sh.level_no}`} />
                <KV k="Max load" v={`${sh.max_weight_kg} kg`} />
                <KV k="Available load" v={`${sh.free_weight_kg} kg`} />
                {/* Before and after, because what this box LEAVES is the number
                    that decides whether the shelf still works tomorrow. */}
                <KV k="Occupancy" v={
                  <span className="s4cp-occ">
                    <i><b style={{ width: `${Math.min(100, sh.used_pct)}%` }} /><em style={{ width: `${Math.min(100, adds)}%` }} /></i>
                    {pct(sh.used_pct)} → {pct(sh.used_pct_after)}
                  </span>
                } />
                <KV k="Cold chain" v={spot.zone.cold_chain ? 'Yes' : 'No'} />
                <KV k="Hazardous" v={spot.zone.hazardous ? 'Yes' : 'No'} />
              </div>

              {/* Locked while a task is out: the method was submitted with
                  the task, and changing it would leave the floor holding a
                  scan for a decision that no longer stands. Cancel the task
                  to get the choice back. */}
              <button
                type="button"
                className={`s4cp-method${assigned ? ' is-done' : ''}`}
                disabled={waiting}
                onClick={onMethod}
              >
                <IcoCheckSq />{assigned ? 'Placement confirmed' : 'Putaway Method'}
              </button>
            </>
          )}
        </section>
      </div>

      {/* The receipt: where it went, by what means, under which allocation.
          The same slot the outstanding task used, because it answers the
          question that one left open. */}
      {assigned && placedVia && (
        <div className="s4cp-await is-done">
          <span className="s4cp-await__ic"><IcoCheckSq size={19} /></span>
          <div className="s4cp-await__tx">
            <div className="s4cp-await__t">Putaway completed · PLACED</div>
            <p className="s4cp-await__s">
              <b>{box.code}</b> placed at <b>{addr.join(' → ')}</b> by {placedVia.via} (verified).
              Allocation <b>{placedVia.allocation}</b>.
            </p>
          </div>
        </div>
      )}

      {/* What is outstanding, who has it, and the two ways out of it. Below
          both cards because it is about the pair of them, not either one. */}
      {waiting && scan && (
        <div className="s4cp-await">
          <span className="s4cp-await__ic"><IcoScan size={18} /></span>
          <div className="s4cp-await__tx">
            <div className="s4cp-await__t">Awaiting Zebra confirmation <i /></div>
            <p className="s4cp-await__s">
              Task <b>{scan.id}</b> created for <b>{[box.code, ...addr].join(' → ')}</b>.
              The box is placed only after the warehouse operator scans the <b>Box QR</b> and
              the <b>Shelf QR</b> with a Zebra handheld.
            </p>
            <div className="s4cp-await__chips">
              <span className="s4cp-await__chip">Box QR</span>
              <span className="s4cp-await__chip">Shelf QR</span>
              <span className="s4cp-await__chip s4cp-await__chip--n">0 / 2 scans</span>
            </div>
          </div>
          <div className="s4cp-await__acts">
            <button type="button" className="s4cp-await__cancel" onClick={onCancelTask}>
              <IcoBan />Cancel task
            </button>
            <button type="button" className="s4cp-await__open" onClick={onOpenScanTask}>
              Open scan task <IcoChev />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "RC-001-SH-105" -> "SH-105": the rack is already named beside it. */
const shortCode = (c: string) => c.replace(/^.*?-(SH-\d+)$/, '$1');
