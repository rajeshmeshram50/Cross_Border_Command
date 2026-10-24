import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { putId, type PutawayFloorZone, type PutawayLocations, type PutawayShelf, type PutawayZone } from '../spi-api';

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 04 · STEP 02 — Select Putaway Location.
 *
 * Built to the prototype's own structure: the warehouse this invoice stages
 * into, then two sections side by side.
 *
 *   Section A  the engine's pick, and the arithmetic behind it — the match
 *              ring, what the shelf holds now, what this box adds, and the
 *              four conditions the engine refuses on.
 *   Section B  the browsable Zone › Rack › Shelf tree, split per rack into
 *              what can take the box and what cannot.
 *
 * Everything printed is the server's. The card restates the engine's reasoning
 * so an operator can disagree with it on the evidence rather than being handed
 * a shelf and left to guess why.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A box as this step needs it. Kept to what the pane prints so the component
 *  does not depend on the whole of the parent's PickBox. */
export interface SelectLocationBox {
  code: string;
  qty: number;
  uom: string | null;
  dims: string | null;
  haz: boolean;
  cold: boolean;
  scenario?: string;
  status?: string;
}

/** The site the invoice stages into. Every line the card prints comes off the
 *  warehouse row; a line with nothing behind it is dropped rather than left
 *  as an empty row. */
export interface SelectLocationWarehouse {
  code?: string | null;
  /** The day the site was added — what sits under its code on the card. */
  since?: string | null;
  name: string;
  address?: string | null;
  /** Town, state and pincode, already joined. */
  location?: string | null;
  typeLabel?: string | null;
  areaSqft?: number | null;
  own?: boolean;
}

/* ── icons ───────────────────────────────────────────────────────────────── */
const svg = (d: ReactNode, size: number, w = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const IcoStar = ({ size = 15 }: { size?: number }) =>
  svg(<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />, size);
const IcoPen = () => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, 15);
const IcoRack = ({ size = 13 }: { size?: number }) =>
  svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></>, size);
const IcoMap = ({ size = 13 }: { size?: number }) =>
  svg(<><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>, size);
const IcoChev = () => svg(<polyline points="6 9 12 15 18 9" />, 12, 2.6);
const IcoCheck = ({ size = 11 }: { size?: number }) => svg(<polyline points="20 6 9 17 4 12" />, size, 3.4);
const IcoLock = () => svg(<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>, 11, 2.4);
const IcoLayers = () => svg(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>, 14);
const IcoPin = ({ size = 14 }: { size?: number }) =>
  svg(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>, size);
const IcoWh = () => svg(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>, 16);
/** A zone you park a box in, as opposed to a shelf you place it on. */
const IcoHome = ({ size = 14 }: { size?: number }) =>
  svg(<><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-6h6v6" /></>, size);
/** Floor area — the figure a rack warehouse states as a rack count. */
const IcoArea = () => svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>, 14);

/** "RC-D02-SH-03" -> "SH-03". The rack is the heading directly above, so
 *  repeating its code on every tile underneath says nothing. */
const shortCode = (c: string) => { const m = String(c).match(/SH-\d+$/); return m ? m[0] : c; };

/** A percentage without a precision the server did not send: 87.1 stays 87.1,
 *  100.0 reads 100. */
const pct = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}%`;
const round = (n: number) => Math.round(n);

/** "1 shelf" / "7 shelves" — an irregular plural, which an "s" cannot do. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** What the door says, in the sub-line under a zone's name. */
const zoneSub = (z: PutawayZone, shelves: number) =>
  [(z.purpose ?? '').trim() || 'Rack Storage',
    z.cold_chain ? 'Cold Chain' : null,
    z.hazardous ? 'Hazardous' : null,
    many(z.racks.length, 'rack', 'racks'),
    many(shelves, 'shelf', 'shelves')].filter(Boolean).join(' · ');

/** How full a set of shelves is, by weight: what is used against what they
 *  hold. Derived here rather than sent, because the payload already carries
 *  both halves per shelf and a second server number could disagree with them. */
function fillOf(shelves: PutawayShelf[]): number {
  const cap = shelves.reduce((t, s) => t + s.max_weight_kg, 0);
  if (!cap) return 0;
  const used = shelves.reduce((t, s) => t + Math.max(0, s.max_weight_kg - s.free_weight_kg), 0);
  return Math.round(used / cap * 100);
}

/** The small bar-and-number that follows a zone or rack heading. */
const Meter = ({ p }: { p: number }) => (
  <span className="s4cl-meter">
    <span className="s4cl-meter__bar"><i style={{ width: `${Math.max(2, Math.min(100, p))}%` }} /></span>
    <b>{p}%</b>
  </span>
);

/** "2025-06-03" -> "03/06/2025", the way the card writes a date. */
function dmy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** The warehouse this invoice stages into. */
function WarehouseCard({ wh }: { wh: SelectLocationWarehouse | null }) {
  if (!wh) return <div className="s4rl-empty">No warehouse selected for this invoice.</div>;
  const since = dmy(wh.since);
  return (
    <div className="s4rl-wh">
      {(wh.code || since) && (
        <span className="spiwh-idc">
          {wh.code && <span className="spiwh-code">{wh.code}</span>}
          {since && <span className="spiwh-date">{since}</span>}
        </span>
      )}
      <span className="spiwh-ico"><IcoWh /></span>
      <span className="spiwh-main">
        <span className="spiwh-nm">{wh.name}</span>
        {wh.address && <span className="spiwh-ad">{wh.address}</span>}
        {wh.location && <span className="spiwh-loc"><IcoPin size={11} />{wh.location}</span>}
      </span>
      {(wh.typeLabel || wh.own !== false) && (
        <span className="spiwh-type"><IcoWh />{wh.typeLabel || 'Own Warehouse'}</span>
      )}
      {wh.areaSqft ? (
        <span className="spiwh-area"><b>{wh.areaSqft.toLocaleString('en-IN')}</b> Sq. Ft</span>
      ) : null}
    </div>
  );
}

/** Section A and Section B share a shell: a header strip and a body. */
function Section({ kind, k, title, sub, pill, children }: {
  kind: 'a' | 'b';
  k: string; title: string; sub: string;
  pill?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`s4rx s4rx--${kind}`}>
      <div className="s4rx-hd">
        <span className="s4rx-ico">{kind === 'a' ? <IcoStar /> : <IcoPen />}</span>
        <div className="s4rx-tx">
          <span className="s4rx-k">{k}</span>
          <b>{title}</b>
          <em>{sub}</em>
        </div>
        {pill}
      </div>
      <div className={`s4rx-bd${kind === 'b' ? ' s4cl' : ''}`}>{children}</div>
    </div>
  );
}

export default function PutawaySelectLocation({ box, mode, state, spot, onSpot, warehouse = null }: {
  box: SelectLocationBox;
  mode: 'rack' | 'norack' | null;
  state: { loading: boolean; data: PutawayLocations | null; error: string | null };
  /** The shelf the operator has settled on; null until they choose. */
  spot: number | null;
  onSpot: (id: number | null) => void;
  warehouse?: SelectLocationWarehouse | null;
}) {
  const rec = state.data?.recommended ?? null;
  const need = state.data?.box ?? null;
  const taken = rec !== null && spot === rec.id;
  /** What this box adds, which is the gap between the two occupancies. */
  const adds = rec ? Math.max(0, rec.used_pct_after - rec.used_pct) : 0;

  const [openZones, setOpenZones] = useState<Set<number>>(new Set());
  const [openRacks, setOpenRacks] = useState<Set<number>>(new Set());
  /* Each heading opens and shuts on its own — no accordion. Comparing two
     racks, or two zones, means having both on screen; an accordion makes that
     impossible and there is nothing gained by it. */
  const flip = (set: (f: (s: Set<number>) => Set<number>) => void) => (id: number) =>
    set(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleZone = flip(setOpenZones);
  const toggleRack = flip(setOpenRacks);

  /* The tree opens on one zone — the one holding the engine's pick, else the
   * first with anything eligible. Its RACKS stay shut: a rack opened for you
   * is a wall of shelf tiles between the zone headings and the next zone,
   * which is the thing you are still choosing between at this point. */
  const openTo = useMemo(() => {
    if (!state.data) return null;
    if (rec) return rec.zone_id;
    return state.data.zones.find(x => x.eligible > 0)?.id ?? null;
  }, [state.data, rec]);

  useEffect(() => {
    if (openTo === null || mode === 'norack') return;
    setOpenZones(new Set([openTo]));
    setOpenRacks(new Set());
  }, [openTo]);

  /* Picking a shelf reveals it: the zone and rack holding the selection open,
   * whether it was chosen here or by "Use Recommended Spot" over in Section A.
   * Anything already open stays open. */
  useEffect(() => {
    if (spot === null || !state.data) return;
    for (const z of state.data.zones) {
      for (const r of z.racks) {
        if (!r.shelves.some(s => s.id === spot)) continue;
        setOpenZones(prev => (prev.has(z.id) ? prev : new Set(prev).add(z.id)));
        setOpenRacks(prev => (prev.has(r.id) ? prev : new Set(prev).add(r.id)));
        return;
      }
    }
  }, [spot, state.data]);

  if (mode === 'norack') {
    return <FloorSelect box={box} state={state} spot={spot} onSpot={onSpot} need={need} warehouse={warehouse} />;
  }

  const zones = state.data?.zones ?? [];
  const racks = zones.reduce((t, z) => t + z.racks.length, 0);
  const nAvail = state.data?.eligible ?? 0;
  const nFull = Math.max(0, (state.data?.total ?? 0) - nAvail);

  /** One shelf tile — a choice, or a frozen one that says why. */
  const tile = (sh: PutawayShelf) => {
    if (sh.eligible) {
      const on = spot === sh.id;
      const after = Math.max(0, sh.used_pct_after - sh.used_pct);
      return (
        <div
          key={sh.id}
          className={`s4cl-sh is-av${on ? ' is-on' : ''}`}
          role="radio" tabIndex={0} aria-checked={on}
          onClick={() => onSpot(on ? null : sh.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSpot(on ? null : sh.id); } }}
        >
          <div className="s4cl-sh__top">
            <span className="s4cl-sh__code">{shortCode(sh.code)}</span>
            <span className="s4cl-sh__rad"><IcoCheck size={9} /></span>
          </div>
          <div className="s4cl-sh__nm">{sh.name || `Level ${sh.level_no}`} · L{sh.level_no}</div>
          <div className="s4cl-sh__bar g">
            <i className="o" style={{ width: `${Math.min(100, sh.used_pct)}%` }} />
            <i className="n" style={{ width: `${Math.max(1.5, Math.min(100, after))}%` }} />
          </div>
          <div className="s4cl-sh__ft">
            <span>{pct(sh.used_pct)} → <b>{pct(sh.used_pct_after)}</b></span>
            <em>{pct(Math.max(0, 100 - sh.used_pct))} free</em>
          </div>
        </div>
      );
    }
    /* The legend's two frozen bands: amber is a shelf filling up, red is one
       at 90 %+ or refused on a condition that is not occupancy at all. */
    const full = sh.used_pct >= 75;
    const red = sh.used_pct >= 90 || !full;
    return (
      <div key={sh.id} className="s4cl-sh is-fu" aria-disabled="true" title={sh.reason_label || 'Not available'}>
        <div className="s4cl-sh__top">
          <span className="s4cl-sh__code">{shortCode(sh.code)}</span>
          <span className="s4cl-sh__lock"><IcoLock /></span>
        </div>
        <div className="s4cl-sh__nm">{sh.name || `Level ${sh.level_no}`} · L{sh.level_no}</div>
        <div className={`s4cl-sh__bar ${red ? 'r' : 'a'}`}>
          <i className="f" style={{ width: `${Math.max(4, Math.min(100, sh.used_pct))}%` }} />
        </div>
        <div className="s4cl-sh__ft">
          {/* A shelf frozen because it is FULL says how full; one frozen for
              any other reason says the reason, which the number would hide. */}
          <span className={red ? 'r' : 'a'}>
            {full ? `${pct(sh.used_pct)} used` : (sh.reason_label || 'Not available')}
          </span>
          <em>Frozen</em>
        </div>
      </div>
    );
  };

  return (
    <div className="s4rl">
      <WarehouseCard wh={warehouse} />

      <div className="s4rl-cols">
        {/* ── Section A · the engine's pick ── */}
        <Section
          kind="a" k="Section A"
          title="System Recommended Location"
          sub="Highest-ranked eligible spot for this box"
          pill={rec && (
            <span className={`s4rx-pill${taken ? ' is-use' : ''}`}>
              <IcoStar size={11} />{taken ? 'In Use' : 'Recommended'}
            </span>
          )}
        >
          {state.error ? (
            <div className="s4rl-empty">{state.error}</div>
          ) : state.loading ? (
            <div className="s4rl-empty">Ranking the shelves for this box…</div>
          ) : !rec ? (
            /* Nowhere eligible is an ANSWER, not an error, and the tree beside
               it says which condition each shelf failed. */
            <div className="s4rl-empty">
              No eligible shelf in this warehouse can take this box.
              {state.data ? ` ${state.data.eligible} of ${state.data.total} shelves eligible.` : ''}
            </div>
          ) : (
            <>
              <div className="s4ra-top">
                {/* The weights the engine scores with sum to 100, so the score
                    IS the percentage the ring sweeps. */}
                <div
                  className="s4ra-ring"
                  /* Only the SWEEP is set here. The track behind it comes from
                     the stylesheet, so dark mode can dim it — an inline
                     background cannot be overridden by a theme rule. */
                  style={{ ['--deg' as string]: `${Math.max(0, Math.min(100, rec.score ?? 0)) * 3.6}deg` }}
                >
                  <div><b>{pct(rec.score ?? 0)}</b><span>Match</span></div>
                </div>
                <div className="s4ra-id">
                  <span className="s4ra-kind"><IcoRack />Rack &amp; Shelf</span>
                  <div className="s4ra-nm">{rec.name || `Shelf level ${rec.level_no}`}</div>
                  <div className="s4ra-path">
                    {rec.zone_name} › {rec.rack_name} › {rec.name || `Level ${rec.level_no}`}
                  </div>
                  <div className="s4ra-codes">
                    <span className="c-z">{rec.zone_code}</span><i>›</i>
                    <span className="c-r">{rec.rack_code}</span><i>›</i>
                    <span className="c-s">{shortCode(rec.code)}</span>
                  </div>
                </div>
              </div>

              {/* The three numbers that decide it, and the single bar they add
                  up to — stated, rather than left to be inferred from a fill. */}
              <div className="s4ra-cap">
                <div className="s4ra-cap__row">
                  <div><span>Available Now</span><b>{pct(100 - rec.used_pct)}</b></div>
                  <div><span>This Box Uses</span><b>{pct(adds)}</b></div>
                  <div>
                    <span>Occupancy After</span>
                    <b className="g">{pct(rec.used_pct_after)}</b>
                    <em>{pct(rec.used_pct)} + {pct(adds)}</em>
                  </div>
                </div>
                <div className="s4ra-bar">
                  <span className="o" style={{ width: `${Math.min(100, rec.used_pct)}%` }} />
                  <span className="n" style={{ width: `${Math.max(1, Math.min(100, adds))}%` }} />
                </div>
                <div className="s4ra-leg">
                  <span><i className="o" />Occupied {pct(rec.used_pct)}</span>
                  <span><i className="n" />This box</span>
                  <span>{pct(Math.max(0, 100 - rec.used_pct_after))} free after</span>
                </div>
              </div>

              <div className="s4ra-grid s4ra-grid--3">
                {([
                  ['Zone', rec.zone_name || '—'],
                  ['Rack', rec.rack_name || '—'],
                  ['Shelf', `${rec.name || `Level ${rec.level_no}`} · L${rec.level_no}`],
                  ['Available Capacity', `${rec.free_weight_kg.toLocaleString('en-IN')} kg`],
                  ['Cold Chain', need?.cold_chain ? 'Yes' : 'No'],
                  ['Hazardous', need?.hazardous ? 'Yes' : 'No'],
                ] as const).map(([k, v]) => (
                  <div key={k}><span>{k}</span><b>{v}</b></div>
                ))}
              </div>

              {/* The engine refuses a shelf for exactly these reasons, so a
                  shelf it did NOT refuse has passed exactly these. */}
              <div className="s4ra-pl">Parameter Checks</div>
              <div className="s4ra-chks">
                {([
                  ['Dimensions fit', need?.volume_cm3
                    ? `Box ${Number((need.volume_cm3 / 1_000_000).toFixed(3))} m³ · fits this shelf`
                    : 'Box fits within the shelf'],
                  ['Weight within limit', `Box ${need?.weight_kg ?? 0} kg ≤ Shelf ${rec.free_weight_kg.toLocaleString('en-IN')} kg`],
                  ['Stackable', need?.is_stackable ? 'Yes · can be stacked' : 'Non-stackable · placed on top'],
                  ['Storage condition', `Cold chain: ${need?.cold_chain ? 'Yes' : 'No'} · Hazardous: ${need?.hazardous ? 'Yes' : 'No'}`],
                ] as const).map(([k, v]) => (
                  <div className="s4ra-chk" key={k}>
                    <span className="s4ra-chk__i"><IcoCheck /></span>
                    <div><b>{k}</b><em>{v}</em></div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className={`s4ra-use${taken ? ' is-on' : ''}`}
                onClick={() => onSpot(taken ? null : rec.id)}
              >
                {taken ? <><IcoCheck />Recommended Spot Selected</> : <><IcoPin />Use Recommended Spot</>}
              </button>
            </>
          )}
        </Section>

        {/* ── Section B · the Zone › Rack › Shelf tree ── */}
        <Section
          kind="b" k="Section B"
          title="Custom Location Selection"
          sub="Storage Zones with Rack · Zone › Rack › Shelf"
        >
          {state.error ? (
            <div className="s4rl-empty">{state.error}</div>
          ) : state.loading ? (
            <div className="s4rl-empty">Reading the warehouse layout…</div>
          ) : zones.length === 0 ? (
            <div className="s4rl-empty">No storage zones with racks in this warehouse.</div>
          ) : (
            <>
              <div className="s4cl-kpis">
                <div><span className="s4cl-kpi__i z"><IcoMap /></span><b>{zones.length}</b><em>Zones</em></div>
                <div><span className="s4cl-kpi__i r"><IcoRack /></span><b>{racks}</b><em>Racks</em></div>
                <div><span className="s4cl-kpi__i g"><IcoCheck /></span><b>{nAvail}</b><em>Available</em></div>
                <div><span className="s4cl-kpi__i x"><IcoLock /></span><b>{nFull}</b><em>Fully Utilized</em></div>
              </div>

              <div className="s4cl-leg">
                <span className="s4cl-leg__t"><IcoLayers /> Legend</span>
                <span><i className="g" />Available · selectable</span>
                <span><i className="a" />75–89% · frozen</span>
                <span><i className="r" />90–100% / not fit · frozen</span>
              </div>

              <div className="s4cl-list">
                {zones.map((z, zi) => {
                  const shelves = z.racks.flatMap(r => r.shelves);
                  const open = openZones.has(z.id);
                  const hasSel = shelves.some(s => s.id === spot);
                  return (
                    <div className={`s4cl-zn${open ? ' is-open' : ''}${hasSel ? ' has-sel' : ''}`} key={z.id}>
                      <div className="s4cl-zn__hd" role="button" tabIndex={0}
                        aria-expanded={open} onClick={() => toggleZone(z.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleZone(z.id); } }}>
                        <span className="s4cl-zn__no">{String(zi + 1).padStart(2, '0')}</span>
                        <span className="s4cl-zn__i"><IcoMap /></span>
                        <div className="s4cl-zn__tx">
                          <div>
                            <span className="s4cl-code s4cl-code--z">{z.code}</span>
                            <b>{z.name || 'Unnamed zone'}</b>
                          </div>
                          <em>{zoneSub(z, shelves.length)}</em>
                        </div>
                        <span className="s4cl-pill s4cl-pill--g">{z.eligible} available</span>
                        <Meter p={fillOf(shelves)} />
                        <span className="s4cl-chev"><IcoChev /></span>
                      </div>

                      {open && (
                        <div className="s4cl-zn__bd">
                          {z.racks.map(r => {
                            const ropen = openRacks.has(r.id);
                            const rSel = r.shelves.some(s => s.id === spot);
                            /* The engine's pick first, then the rest of what
                               fits. Raw server order put a choice fifth. */
                            const av = [
                              ...r.shelves.filter(s => s.eligible && rec?.id === s.id),
                              ...r.shelves.filter(s => s.eligible && rec?.id !== s.id),
                            ];
                            const fu = r.shelves.filter(s => !s.eligible);
                            return (
                              <div className={`s4cl-rk${ropen ? ' is-open' : ''}${rSel ? ' has-sel' : ''}`} key={r.id}>
                                <div className="s4cl-rk__hd" role="button" tabIndex={0}
                                  aria-expanded={ropen} onClick={() => toggleRack(r.id)}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRack(r.id); } }}>
                                  <span className="s4cl-rk__i"><IcoRack /></span>
                                  <span className="s4cl-code s4cl-code--r">{r.code}</span>
                                  <b className="s4cl-rk__nm">{r.name || 'Unnamed rack'}</b>
                                  <span className="s4cl-rk__meta">{many(r.total, 'shelf', 'shelves')}</span>
                                  <span className="s4cl-pill s4cl-pill--g">{av.length} available</span>
                                  {fu.length > 0 && <span className="s4cl-pill s4cl-pill--r">{fu.length} full</span>}
                                  <Meter p={fillOf(r.shelves)} />
                                  <span className="s4cl-chev"><IcoChev /></span>
                                </div>

                                {ropen && (
                                  <div className="s4cl-rk__bd">
                                    <div className="s4cl-grp s4cl-grp--av">
                                      <div className="s4cl-grp__hd"><i />Available Locations<span>{av.length}</span></div>
                                      {av.length
                                        ? <div className="s4cl-grid">{av.map(tile)}</div>
                                        : <div className="s4cl-none">No available shelf in this rack for this box.</div>}
                                    </div>
                                    <div className="s4cl-grp s4cl-grp--fu">
                                      <div className="s4cl-grp__hd"><i><IcoLock /></i>Fully Utilized Locations<span>{fu.length}</span></div>
                                      {fu.length
                                        ? <div className="s4cl-grid">{fu.map(tile)}</div>
                                        : <div className="s4cl-none">No fully utilized shelf in this rack.</div>}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The same step for a box going into a zone WITHOUT racks.
 *
 * There is no tree to walk — a zone IS the destination — so Section B is a
 * flat list, split the same way the rack flow splits its shelves: what can
 * take the box, and what is frozen and why.
 *
 * Section A reads the same as the rack flow, with the rack and shelf lines
 * struck through as Not applicable rather than quietly dropped: the operator
 * should see that this placement has no rack, not wonder where it went.
 * ═══════════════════════════════════════════════════════════════════════════ */
function FloorSelect({ box, state, spot, onSpot, need, warehouse }: {
  box: SelectLocationBox;
  state: { loading: boolean; data: PutawayLocations | null; error: string | null };
  spot: number | null;
  onSpot: (id: number | null) => void;
  need: PutawayLocations['box'] | null;
  warehouse: SelectLocationWarehouse | null;
}) {
  const zones: PutawayFloorZone[] = state.data?.floor ?? [];
  const rec = state.data?.floorPick ?? null;
  const avail = zones.filter(z => z.eligible);
  const frozen = zones.filter(z => !z.eligible);
  const taken = rec !== null && spot === rec.id;
  const adds = rec ? Math.max(0, rec.used_pct_after - rec.used_pct) : 0;
  const m3 = (v: number) => `${Number.isInteger(v) ? v : Number(v.toFixed(3))} m³`;
  const sqft = (v: number | null) => (v ? `${v.toLocaleString('en-IN')} sq ft` : null);
  /** "Dispatch / Staging · Ambient · 3,315 sq ft" — what the zone is, in the
   *  order the design reads it. A missing part is dropped, not left blank. */
  const zoneMeta = (z: PutawayFloorZone) => [
    (z.purpose ?? '').trim() || 'Floor zone',
    z.cold_chain ? 'Cold' : 'Ambient',
    sqft(z.area_sqft),
    `${m3(z.free_m3)} free`,
  ].filter(Boolean).join(' · ');

  /** One zone, as a card: the engine's pick, a choice, or a frozen one. */
  const zcard = (z: PutawayFloorZone) => {
    const on = spot === z.id;
    const after = Math.max(0, z.used_pct_after - z.used_pct);
    if (z.eligible) {
      return (
        <div
          key={z.id}
          className={`s4cn is-av${on ? ' is-on' : ''}`}
          role="radio" tabIndex={0} aria-checked={on}
          title={`Put ${putId(box.code)} in ${z.code}`}
          onClick={() => onSpot(on ? null : z.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSpot(on ? null : z.id); } }}
        >
          <span className="s4cn-ico"><IcoHome /></span>
          <div className="s4cn-tx">
            <div className="s4cn-t">
              <span className="s4cl-code s4cl-code--z">{z.code}</span>
              <b>{z.name || 'Unnamed zone'}</b>
              {rec?.id === z.id && <span className="s4cn-rec">&#9733; Recommended</span>}
            </div>
            <div className="s4cn-s">{zoneMeta(z)}</div>
            <div className="s4cl-sh__bar g">
              <i className="o" style={{ width: `${Math.min(100, z.used_pct)}%` }} />
              <i className="n" style={{ width: `${Math.max(1.5, Math.min(100, after))}%` }} />
            </div>
            <div className="s4cn-ft">
              <span>{pct(z.used_pct)} → <b>{pct(z.used_pct_after)}</b> after this box</span>
            </div>
          </div>
          <div className="s4cn-r">
            <span>Floor Free</span>
            <b>{pct(Math.max(0, 100 - z.used_pct))}</b>
            <em>{pct(z.used_pct)} occupied</em>
          </div>
          <span className="s4cl-sh__rad"><IcoCheck size={9} /></span>
        </div>
      );
    }
    /* Amber is a zone filling up, red is one at 90 %+ or refused on a
       condition that is not occupancy at all — the legend's two bands. */
    const full = z.used_pct >= 75;
    const red = z.used_pct >= 90 || !full;
    return (
      <div key={z.id} className="s4cn is-fu" aria-disabled="true" title={z.reason_label || 'Not available'}>
        <span className="s4cn-ico"><IcoHome /></span>
        <div className="s4cn-tx">
          <div className="s4cn-t">
            <span className="s4cl-code s4cl-code--z">{z.code}</span>
            <b>{z.name || 'Unnamed zone'}</b>
            <span className="s4cn-frz"><IcoLock />Frozen</span>
          </div>
          <div className="s4cn-s">{zoneMeta(z)}</div>
          <div className={`s4cl-sh__bar ${red ? 'r' : 'a'}`}>
            <i className="f" style={{ width: `${Math.max(4, Math.min(100, z.used_pct))}%` }} />
          </div>
          <div className="s4cn-ft">
            <span className={red ? 'r' : 'a'}>
              {full ? `${pct(z.used_pct)} used · fully utilised` : (z.reason_label || 'Not available')}
            </span>
          </div>
        </div>
        <div className="s4cn-r is-fu">
          <span>Floor Free</span>
          <b>{pct(Math.max(0, 100 - z.used_pct))}</b>
          <em>{pct(z.used_pct)} occupied</em>
        </div>
        <span className="s4cl-sh__lock"><IcoLock /></span>
      </div>
    );
  };

  const totalArea = zones.reduce((t, z) => t + (z.area_sqft ?? 0), 0);

  return (
    <div className="s4rl">
      <WarehouseCard wh={warehouse} />

      <div className="s4rl-cols">
        <Section
          kind="a" k="Section A"
          title="System Recommended Location"
          sub="Highest-ranked eligible spot for this box"
          pill={rec && (
            <span className={`s4rx-pill${taken ? ' is-use' : ''}`}>
              <IcoStar size={11} />{taken ? 'In Use' : 'Recommended'}
            </span>
          )}
        >
          {state.error ? (
            <div className="s4rl-empty">{state.error}</div>
          ) : state.loading ? (
            <div className="s4rl-empty">Ranking the zones for this box…</div>
          ) : !rec ? (
            <div className="s4rl-empty">
              No eligible floor zone in this warehouse can take this box.
              {state.data ? ` ${avail.length} of ${zones.length} zones eligible.` : ''}
            </div>
          ) : (
            <>
              <div className="s4ra-top">
                {/* The ring reads how much of the zone is left after this box,
                    which for a floor zone is the whole of the decision. */}
                <div
                  className="s4ra-ring"
                  style={{ ['--deg' as string]: `${Math.max(0, Math.min(100, 100 - rec.used_pct_after)) * 3.6}deg` }}
                >
                  <div><b>{pct(Math.max(0, 100 - rec.used_pct_after))}</b><span>Free After</span></div>
                </div>
                <div className="s4ra-id">
                  <span className="s4ra-kind s4ra-kind--zone"><IcoHome />Direct Storage Zone</span>
                  <div className="s4ra-nm">{rec.name || 'Unnamed zone'}</div>
                  <div className="s4ra-path">
                    {(rec.purpose ?? '').trim() || 'Floor zone'} · box parks directly in the zone
                  </div>
                  <div className="s4ra-codes">
                    <span className="c-z">{rec.code}</span>
                    <span className="c-n">No rack · No shelf</span>
                  </div>
                </div>
              </div>

              <div className="s4ra-cap">
                <div className="s4ra-cap__row">
                  <div><span>Available Now</span><b>{pct(100 - rec.used_pct)}</b></div>
                  <div><span>This Box Uses</span><b>{pct(adds)}</b></div>
                  <div>
                    <span>Occupancy After</span>
                    <b className="g">{pct(rec.used_pct_after)}</b>
                    <em>{pct(rec.used_pct)} + {pct(adds)}</em>
                  </div>
                </div>
                <div className="s4ra-bar">
                  <span className="o" style={{ width: `${Math.min(100, rec.used_pct)}%` }} />
                  <span className="n" style={{ width: `${Math.max(1, Math.min(100, adds))}%` }} />
                </div>
                <div className="s4ra-leg">
                  <span><i className="o" />Occupied {pct(rec.used_pct)}</span>
                  <span><i className="n" />This box</span>
                  <span>{pct(Math.max(0, 100 - rec.used_pct_after))} free after</span>
                </div>
              </div>

              {/* Eight cells in four columns, as the design has them. Rack and
                  Shelf stay in the grid, struck as Not applicable: this
                  placement HAS no rack, which is worth stating. */}
              <div className="s4ra-grid s4ra-grid--4">
                {([
                  ['Zone Type', (rec.purpose ?? '').trim() || 'Floor zone'],
                  ['Floor Area', sqft(rec.area_sqft) ?? 'Not measured'],
                  ['Free Space', m3(rec.free_m3)],
                  ['Capacity', rec.capacity_m3 ? m3(rec.capacity_m3) : 'Not measured'],
                  ['Cold Chain', rec.cold_chain ? 'Yes' : 'No'],
                  ['Hazardous', rec.hazardous ? 'Yes' : 'No'],
                  ['Rack', null],
                  ['Shelf', null],
                ] as const).map(([k, v]) => (
                  <div key={k}><span>{k}</span><b>{v ?? <i>Not applicable</i>}</b></div>
                ))}
              </div>

              {/* The four conditions the engine actually refuses a ZONE on.
                  A shelf is also checked for weight and stack height; a zone
                  is not, so those are not claimed here. */}
              <div className="s4ra-pl">Parameter Checks</div>
              <div className="s4ra-chks">
                {([
                  ['Space available', `Box ${need?.volume_cm3 ? m3(need.volume_cm3 / 1_000_000) : '—'} ≤ Zone ${m3(rec.free_m3)} free`],
                  ['Cold chain', rec.cold_chain ? 'Zone is cold chain' : `Cold chain: ${need?.cold_chain ? 'Yes' : 'No'}`],
                  ['Hazardous', rec.hazardous ? 'Zone takes hazardous goods' : `Hazardous: ${need?.hazardous ? 'Yes' : 'No'}`],
                  ['Temperature', rec.temp_min_c != null && rec.temp_max_c != null
                    ? `Zone holds ${rec.temp_min_c}–${rec.temp_max_c} °C`
                    : 'Ambient · no range required'],
                ] as const).map(([k, v]) => (
                  <div className="s4ra-chk" key={k}>
                    <span className="s4ra-chk__i"><IcoCheck /></span>
                    <div><b>{k}</b><em>{v}</em></div>
                  </div>
                ))}
              </div>

              <button type="button" className={`s4ra-use${taken ? ' is-on' : ''}`}
                onClick={() => onSpot(taken ? null : rec.id)}>
                {taken ? <><IcoCheck />Recommended Zone Selected</> : <><IcoPin />Use Recommended Zone</>}
              </button>
            </>
          )}
        </Section>

        <Section
          kind="b" k="Section B"
          title="Custom Location Selection"
          sub="Storage Zones without Rack · box parks directly in the zone"
        >
          {state.error ? (
            <div className="s4rl-empty">{state.error}</div>
          ) : state.loading ? (
            <div className="s4rl-empty">Reading the zones…</div>
          ) : zones.length === 0 ? (
            <div className="s4rl-empty">No direct storage zones (without rack) in this warehouse.</div>
          ) : (
            <>
              {/* Four tiles, as the rack flow has — but a floor warehouse is
                  measured in area, so Racks becomes Sq Ft. */}
              <div className="s4cl-kpis">
                <div><span className="s4cl-kpi__i z"><IcoHome /></span><b>{zones.length}</b><em>Zones</em></div>
                <div>
                  <span className="s4cl-kpi__i r"><IcoArea /></span>
                  <b>{totalArea ? Math.round(totalArea).toLocaleString('en-IN') : '—'}</b><em>Sq Ft</em>
                </div>
                <div><span className="s4cl-kpi__i g"><IcoCheck /></span><b>{avail.length}</b><em>Available</em></div>
                <div><span className="s4cl-kpi__i x"><IcoLock /></span><b>{frozen.length}</b><em>Fully Utilized</em></div>
              </div>

              <div className="s4cl-leg">
                <span className="s4cl-leg__t"><IcoLayers /> Legend</span>
                <span><i className="g" />Available · selectable</span>
                <span><i className="a" />75–89% · frozen</span>
                <span><i className="r" />90–100% / not fit · frozen</span>
              </div>

              <div className="s4cl-grp s4cl-grp--av">
                <div className="s4cl-grp__hd"><i />Available Locations<span>{avail.length}</span></div>
                {avail.length
                  ? <div className="s4cn-list">{avail.map(zcard)}</div>
                  : <div className="s4cl-none">No zone without rack can take this box right now.</div>}
              </div>
              <div className="s4cl-grp s4cl-grp--fu">
                <div className="s4cl-grp__hd"><i><IcoLock /></i>Fully Utilized Locations<span>{frozen.length}</span></div>
                {frozen.length
                  ? <div className="s4cn-list">{frozen.map(zcard)}</div>
                  : <div className="s4cl-none">No fully utilized zone in this warehouse.</div>}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
