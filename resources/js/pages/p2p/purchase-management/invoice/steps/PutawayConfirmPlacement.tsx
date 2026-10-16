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
const IcoCheckSq = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export default function PutawayConfirmPlacement({
  box, spot, warehouse, assigned, awaitingScan = false, qr, onChange, onMethod, onViewProducts,
}: {
  box: ConfirmBox;
  spot: ConfirmSpot | null;
  warehouse?: string | null;
  /** True once the placement has actually been committed. */
  assigned: boolean;
  /** A Zebra scan task has been raised, so the floor still has to verify it.
   *  Deliberately NOT the same as assigned: the box is not on the shelf until
   *  the scan comes back, and a screen that said "Placed" here would be
   *  claiming something nobody has checked. */
  awaitingScan?: boolean;
  /** The box's QR, rendered by the parent so there is one QR component. */
  qr: ReactNode;
  onChange: () => void;
  onMethod: () => void;
  onViewProducts: () => void;
}) {
  const [cond, condNote] = CONDITION[box.condition] ?? CONDITION.perfect;
  const sh = spot?.shelf;
  const adds = sh ? Math.max(0, sh.used_pct_after - sh.used_pct) : 0;

  return (
    <div className="s4cp">
      {/* ── From here, to there ── The whole step in one line. */}
      <div className="s4cp-route">
        <div className="s4cp-route__side">
          <span className="s4cp-route__ic"><IcoBox size={17} /></span>
          <div>
            <div className="s4cp-route__k">Placing box</div>
            <span className="s4cp-route__code">{box.code}</span>
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
        <div className={`s4cp-route__state${assigned ? ' is-done' : ''}`}>
          <b>{assigned ? '✓' : '?'}</b>
          <span>{assigned ? 'Placed' : 'Yet to decide'}</span>
        </div>
      </div>

      <div className={`s4cp-status${assigned ? ' is-done' : ''}`}>
        <span className="s4cp-status__l">
          <IcoPin />
          {assigned ? 'Location assigned'
            : awaitingScan ? 'Awaiting Zebra scan on the floor'
            : 'No location assigned yet'}
        </span>
        <span className="s4cp-status__r">
          {spot
            ? <>Step 02 location <b>{shortCode(spot.shelf.code)}</b> · {assigned ? 'confirmed' : 'click Putaway Method to confirm'}</>
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
          <span className={`s4cp-join__dot${assigned ? ' is-done' : ''}`}><IcoArrowR size={15} /></span>
          <span className={`s4cp-join__tag${assigned ? ' is-done' : ''}`}>{assigned ? 'Placed' : 'Pending'}</span>
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

              <button
                type="button"
                className={`s4cp-method${assigned ? ' is-done' : ''}${awaitingScan && !assigned ? ' is-queued' : ''}`}
                onClick={onMethod}
              >
                <IcoCheckSq />
                {assigned ? 'Placement confirmed'
                  : awaitingScan ? 'Scan task raised · change method'
                  : 'Putaway Method'}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** "RC-001-SH-105" -> "SH-105": the rack is already named beside it. */
const shortCode = (c: string) => c.replace(/^.*?-(SH-\d+)$/, '$1');
