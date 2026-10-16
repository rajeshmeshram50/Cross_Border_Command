import { useEffect, useMemo, useState } from 'react';
import type { PutawayLocations, PutawayShelf, PutawayZone } from '../spi-api';

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 04 · STEP 02 — Select Location.
 *
 * Two sections side by side. Section A is the engine's own pick with the
 * arithmetic behind it; Section B is the browsable Zone > Rack > Shelf tree.
 *
 * Everything shown here is the server's: the score, the occupancy before and
 * after, the free weight, and the four conditions the engine refuses on. The
 * card restates that reasoning so an operator can disagree with it on the
 * evidence, instead of being handed a shelf and left to guess why.
 *
 * Section B is the next piece; its header is here so the two-column layout can
 * be judged now.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A box as this step needs it. Kept to what the card prints so the component
 *  does not depend on the whole of the parent's PickBox. */
export interface SelectLocationBox {
  code: string;
  qty: number;
  uom: string | null;
  dims: string | null;
  haz: boolean;
  cold: boolean;
  /** Both absorbed from the hero band this bar replaced on Step 02. */
  scenario?: string;
  status?: string;
}

/** "RC-D02-SH-03" -> "SH-03". The rack is the heading directly above, so
 *  repeating its code on every card underneath says nothing. */
const shortCode = (c: string) => c.replace(/^.*?-(SH-\d+)$/, '$1');

/** "Cold Chain · 2–8 °C" / "Dry Storage · Ambient" - what the door says.
 *  A temperature range beats the word "cold" where one is recorded. */
/** The single reason a whole zone is out, when its shelves all agree. With
 *  mixed reasons there is no one sentence to write, so none is written. */
function oneReason(z: PutawayZone): string | null {
  const reasons = new Set(z.racks.flatMap(r => r.shelves).map(s => s.reason_label ?? ''));
  return reasons.size === 1 ? ([...reasons][0] || null) : null;
}

function zoneSub(z: PutawayZone): string {
  const what = (z.purpose ?? '').trim() || (z.cold_chain ? 'Cold storage' : 'Storage');
  const lo = z.temp_min_c, hi = z.temp_max_c;
  const cond = lo != null && hi != null ? `${lo}–${hi} °C`
    : z.cold_chain ? 'Cold chain'
    : 'Ambient';
  return `${what} · ${cond}${z.hazardous ? ' · Hazardous' : ''}`;
}

/** "1 shelf" / "7 shelves" - an irregular plural, which an "s" cannot do. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** A percentage without a precision the server did not send: 87.1 stays 87.1,
 *  100.0 reads 100. */
const pct = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}%`;

/** The expand/collapse chevron. U+2303/U+2304 were being used as the arrows,
 *  and they are typographic marks, not icons: they sit on the text baseline,
 *  carry the font's own weight and render at whatever size the row's font is,
 *  which is why they read as specks. One SVG that rotates instead. */
const Chevron = ({ open }: { open: boolean }) => (
  <span className={`s4sl-cv${open ? ' is-open' : ''}`} aria-hidden>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </span>
);

const IcoBox = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

/** How full a set of shelves is, by weight: what is used against what they
 *  hold. Derived here rather than sent, because the payload already carries
 *  both halves per shelf and a second server number could disagree with them. */
function fillOf(shelves: PutawayShelf[]): number {
  const cap = shelves.reduce((t, s) => t + s.max_weight_kg, 0);
  if (!cap) return 0;
  const used = shelves.reduce((t, s) => t + Math.max(0, s.max_weight_kg - s.free_weight_kg), 0);
  return Math.round(used / cap * 100);
}

/** The fill bar, in the four bands the legend names. One component, so a zone,
 *  a rack and a shelf can never band the same number differently. */
function Fill({ pct: p, thin }: { pct: number; thin?: boolean }) {
  const band = p >= 100 ? 'full' : p >= 75 ? 'high' : p >= 45 ? 'med' : 'low';
  return (
    <span className={`s4sl-fill s4sl-fill--${band}${thin ? ' s4sl-fill--thin' : ''}`}>
      <i style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      {!thin && <em>{p}% used</em>}
    </span>
  );
}

export default function PutawaySelectLocation({ box, mode, state, spot, onSpot }: {
  box: SelectLocationBox;
  mode: 'rack' | 'norack' | null;
  state: { loading: boolean; data: PutawayLocations | null; error: string | null };
  /** The shelf the operator has settled on; null until they choose. */
  spot: number | null;
  onSpot: (id: number | null) => void;
}) {
  const rec = state.data?.recommended ?? null;
  const need = state.data?.box ?? null;
  const taken = rec !== null && spot === rec.id;
  /** What this box adds, which is the gap between the two occupancies. */
  const adds = rec ? Math.max(0, rec.used_pct_after - rec.used_pct) : 0;

  const [openZones, setOpenZones] = useState<Set<number>>(new Set());
  const [openRacks, setOpenRacks] = useState<Set<number>>(new Set());
  /** Blocked shelves, per rack. Shut by default: a shelf that cannot take the
   *  box is not a choice, and on a full rack they outnumber the ones that are.
   *  The reason stays one click away, never deleted. */
  const [openBlocked, setOpenBlocked] = useState<Set<number>>(new Set());
  const toggle = (set: (f: (s: Set<number>) => Set<number>) => void) => (id: number) =>
    set(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleBlocked = toggle(setOpenBlocked);
  /** Zones are an accordion too. Two zones open is two warehouses of shelves
   *  in one column, and the box only goes to one of them. Opening a zone also
   *  drops the rack open inside the previous one - otherwise its rack would
   *  reappear expanded the next time the zone is opened. */
  const toggleZone = (id: number) => setOpenZones(prev => {
    if (prev.has(id)) return new Set<number>();
    setOpenRacks(new Set<number>());
    return new Set([id]);
  });
  /** Racks are an accordion: opening one closes the other. Several open at
   *  once pushed the zone's own header off the screen and turned the card back
   *  into the wall of shelves it was meant to replace - and only one rack can
   *  be compared against the recommendation at a time anyway. */
  const toggleRack = (id: number) =>
    setOpenRacks(prev => (prev.has(id) ? new Set<number>() : new Set([id])));

  /* Open straight onto the engine's pick. The tree exists to be disagreed
   * with, and an operator cannot disagree with a branch they have to find
   * first. Zones with nothing eligible stay shut - there is nothing to pick. */
  const openTo = useMemo(() => {
    if (!state.data) return null;
    if (rec) return { zone: rec.zone_id, rack: rec.rack_id };
    const z = state.data.zones.find(x => x.eligible > 0);
    const r = z?.racks.find(x => x.eligible > 0);
    return z ? { zone: z.id, rack: r?.id ?? null } : null;
  }, [state.data, rec]);

  useEffect(() => {
    if (!openTo) return;
    setOpenZones(new Set([openTo.zone]));
    setOpenRacks(openTo.rack ? new Set([openTo.rack]) : new Set());
  }, [openTo?.zone, openTo?.rack]);

  return (
    <div className="s4sl">
      {/* The only teal band on this step. It used to sit under a hero band
          that named the same box and carried the same status, and to its
          right was a second copy of the legend that now lives in Section B's
          header, beside the colours it explains. */}
      <div className="s4sl-bar">
        <span className="s4sl-bar__ic"><IcoBox size={17} /></span>
        <div className="s4sl-bar__tx">
          <div className="s4sl-bar__k">
            Where should this box go?
            {box.scenario && <i className="s4sl-bar__scn">{box.scenario}</i>}
          </div>
          <div className="s4sl-bar__v">
            <span className="s4sl-bar__code">{box.code}</span>
            <span>
              {box.qty} {box.uom || 'units'}
              {' · Handling '}{box.haz ? 'Hazardous' : box.cold ? 'Cold chain' : 'Standard'}
              {box.dims ? ` · ${box.dims}` : ''}
              {need?.weight_kg ? ` · ${need.weight_kg} kg` : ''}
            </span>
          </div>
        </div>
        {box.status && <span className="s4sl-bar__st"><i />{box.status}</span>}
      </div>

      <div className="s4sl-cols">
        {/* ── Section A · the engine's pick ── */}
        <section className="s4sl-sec s4sl-sec--a">
          <div className="s4sl-sec__hd">
            <span className="s4sl-sec__ic">&#9733;</span>
            <div className="s4sl-sec__tx">
              <div className="s4sl-sec__k">Section A</div>
              <div className="s4sl-sec__t">System Recommended Location</div>
              <div className="s4sl-sec__s">Highest-ranked eligible spot for this box</div>
            </div>
            <span className={`s4sl-rec${taken ? ' is-used' : ''}`}>
              {taken ? '✓ In use' : '☆ Recommended'}
            </span>
          </div>

          {state.error ? (
            <div className="s4vp-none">{state.error}</div>
          ) : state.loading ? (
            <div className="s4vp-none">Ranking the shelves for this box…</div>
          ) : !rec ? (
            /* Nowhere eligible is an ANSWER, not an error, and the tree beside
               it says which condition each shelf failed. */
            <div className="s4vp-none">
              No shelf in this warehouse can take this box.
              {state.data ? ` ${state.data.eligible} of ${state.data.total} shelves eligible.` : ''}
            </div>
          ) : (
            <>
              <span className="s4sl-kind">{mode === 'rack' ? 'Rack & shelf' : 'Zone floor'}</span>

              <div className="s4sl-pick">
                {/* --p drives the ring's conic fill. The weights the engine
                    scores with sum to 100, so the score IS the percentage. */}
                <div className="s4sl-match" style={{ ['--p' as string]: Math.max(0, Math.min(100, Math.round(rec.score ?? 0))) }}>
                  <b>{pct(rec.score ?? 0)}</b>
                  <span>Match</span>
                </div>
                <div className="s4sl-pick__tx">
                  <div className="s4sl-pick__t">{rec.name || `Shelf level ${rec.level_no}`}</div>
                  <div className="s4sl-pick__p">
                    {rec.zone_name} › {rec.rack_name} › {rec.name || `Level ${rec.level_no}`}
                  </div>
                  <div className="s4sl-codes">
                    <span className="s4sl-code s4sl-code--z">{rec.zone_code}</span><i>›</i>
                    <span className="s4sl-code s4sl-code--r">{rec.rack_code}</span><i>›</i>
                    <span className="s4sl-code s4sl-code--s">{rec.code}</span>
                  </div>
                </div>
              </div>

              {/* The three numbers that decide it, and the single bar they add
                  up to - stated, rather than left to be inferred from a fill. */}
              <div className="s4sl-occ">
                <div className="s4sl-occ__row">
                  <div><span>Available now</span><b>{pct(100 - rec.used_pct)}</b></div>
                  <div><span>This box uses</span><b>{pct(adds)}</b></div>
                  <div>
                    <span>Occupancy after</span>
                    <b className="s4sl-occ__after">{pct(rec.used_pct_after)}</b>
                    <em>{pct(rec.used_pct)} + {pct(adds)}</em>
                  </div>
                </div>
                <div className="s4sl-bar2">
                  <i className="s4sl-bar2__used" style={{ width: `${Math.min(100, rec.used_pct)}%` }} />
                  <i className="s4sl-bar2__this" style={{ width: `${Math.min(100, adds)}%` }} />
                </div>
                <div className="s4sl-bar2__k">
                  <span className="s4sl-bar2__ku">Occupied {pct(rec.used_pct)}</span>
                  <span className="s4sl-bar2__kt">This box</span>
                  <span>{pct(Math.max(0, 100 - rec.used_pct_after))} free after</span>
                </div>
              </div>

              <div className="s4sl-grid">
                {([
                  ['Zone', rec.zone_name],
                  ['Rack', rec.rack_name],
                  ['Shelf name', rec.name],
                  ['Shelf level', `L${rec.level_no}`],
                  ['Free weight on shelf', `${rec.free_weight_kg} kg`],
                  ['Shelf capacity', `${rec.max_weight_kg} kg`],
                  ['Cold chain', need?.cold_chain ? 'Yes' : 'No'],
                  ['Hazardous', need?.hazardous ? 'Yes' : 'No'],
                ] as const).map(([k, v]) => (
                  <div className="s4sl-f" key={k}>
                    <span>{k}</span>
                    <b>{v || <em className="s4pd-na">Not named</em>}</b>
                  </div>
                ))}
              </div>

              {/* The engine refuses a shelf for exactly these reasons, so a
                  shelf it did NOT refuse has passed exactly these. */}
              <div className="s4sl-checks__t">Parameter checks</div>
              <div className="s4sl-checks">
                {([
                  ['Dimensions fit', 'Box fits within the shelf'],
                  ['Weight within limit', `Box ${need?.weight_kg ?? 0} kg ≤ ${rec.free_weight_kg} kg free`],
                  ['Stackable', need?.is_stackable ? 'Yes · can be stacked' : 'Not required here'],
                  ['Storage condition', `Cold chain: ${need?.cold_chain ? 'Yes' : 'No'} · Hazardous: ${need?.hazardous ? 'Yes' : 'No'}`],
                ] as const).map(([k, v]) => (
                  <div className="s4sl-chk" key={k}>
                    <i>&#10003;</i>
                    <div><b>{k}</b><span>{v}</span></div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className={`s4sl-take${taken ? ' is-taken' : ''}`}
                onClick={() => onSpot(taken ? null : rec.id)}
              >
                {taken ? '✓ Recommended spot selected' : '◉ Use recommended spot'}
              </button>
            </>
          )}
        </section>

        {/* ── Section B · the tree. Header only; the next piece. ── */}
        <section className="s4sl-sec s4sl-sec--b">
          <div className="s4sl-sec__hd">
            <span className="s4sl-sec__ic s4sl-sec__ic--b">&#9998;</span>
            <div className="s4sl-sec__tx">
              <div className="s4sl-sec__k">Section B</div>
              <div className="s4sl-sec__t">Custom Location Selection</div>
              <div className="s4sl-sec__s">
                Showing only Storage Zones {mode === 'rack' ? 'with' : 'without'} Rack — as chosen before Step 02
              </div>
            </div>
          </div>

          {state.error ? (
            <div className="s4vp-none">{state.error}</div>
          ) : state.loading ? (
            <div className="s4vp-none">Reading the warehouse layout…</div>
          ) : !state.data || state.data.zones.length === 0 ? (
            <div className="s4vp-none">
              This warehouse has no storage zones {mode === 'rack' ? 'with racks' : 'without racks'}.
            </div>
          ) : (
            <div className="s4sl-tree">
              {/* One header, not three. The title card, the legend and the
                  "expand…" note were three bordered bands stacked on each
                  other, all of them context for the same tree - so they cost
                  three borders and three gaps to say one thing. */}
              <div className="s4sl-tree__hd">
                <div className="s4sl-tree__top">
                  <span className="s4sl-tree__ic"><IcoBox size={15} /></span>
                  <div className="s4sl-tree__tx">
                    <b>{mode === 'rack' ? 'With Rack' : 'Without Rack'}</b>
                    <span>
                      {mode === 'rack' ? 'Zone › Rack › Shelf' : 'Zone'} · expand to a shelf.
                      Only eligible shelves can be selected — a greyed one says why.
                    </span>
                  </div>
                  <span className="s4sl-elig">{state.data.eligible} / {state.data.total} eligible</span>
                </div>

                <div className="s4sl-legend s4sl-legend--light">
                  <span className="s4sl-legend__k">Shelf space used</span>
                  {([['low', 'Low', 'under 45%'], ['med', 'Medium', '45–74%'],
                     ['high', 'High', '75–99%'], ['full', 'Full', '100%']] as const).map(([k, t, r]) => (
                    <span className={`s4sl-lg s4sl-lg--${k}`} key={k}><i />{t} <em>{r}</em></span>
                  ))}
                </div>
              </div>

              {state.data.zones.map(z => {
                const zf = fillOf(z.racks.flatMap(r => r.shelves));
                const open = openZones.has(z.id);
                return (
                  <div className={`s4sl-z${open ? ' is-open' : ''}`} key={z.id}>
                    <button type="button" className="s4sl-row s4sl-row--z" onClick={() => toggleZone(z.id)} aria-expanded={open}>
                      <span className="s4sl-row__ic s4sl-row__ic--z">&#9873;</span>
                      <span className="s4sl-chip s4sl-chip--z">{z.code}</span>
                      <span className="s4sl-row__tx">
                        <b>{z.name || 'Unnamed zone'}</b>
                        <span>{zoneSub(z)}</span>
                      </span>
                      <Fill pct={zf} />
                      <span className="s4sl-row__n">
                        {many(z.racks.length, 'rack', 'racks')} · {many(z.total, 'shelf', 'shelves')}
                        {' · '}<b className={z.eligible ? 'is-ok' : ''}>{z.eligible} eligible</b>
                      </span>
                      <Chevron open={open} />
                    </button>

                    {/* An open zone OWNS what is under it. Without a body to
                        hold them, its racks and shelves were loose rows that
                        looked no different from the next zone's, and the only
                        thing saying where ZN-002 ended was an icon. */}
                    {open && (
                    <div className="s4sl-zb">
                    {z.eligible === 0 && oneReason(z) && (
                      <div className="s4sl-zwhy"><i>&#9940;</i>{oneReason(z)}</div>
                    )}

                    {z.racks.map(r => {
                      const rf = fillOf(r.shelves);
                      const ropen = openRacks.has(r.id);
                      return (
                        <div className={`s4sl-r${ropen ? ' is-open' : ''}`} key={r.id}>
                          <button type="button" className="s4sl-row s4sl-row--r" onClick={() => toggleRack(r.id)} aria-expanded={ropen}>
                            <span className="s4sl-row__ic s4sl-row__ic--r">&#9636;</span>
                            <span className="s4sl-chip s4sl-chip--r">{r.code}</span>
                            <span className="s4sl-row__tx"><b>{r.name || 'Unnamed rack'}</b></span>
                            <Fill pct={rf} />
                            <span className="s4sl-row__n">
                              {many(r.total, 'shelf', 'shelves')}
                              {' · '}<b className={r.eligible ? 'is-ok' : ''}>{r.eligible} eligible</b>
                            </span>
                            <Chevron open={ropen} />
                          </button>

                          {ropen && (() => {
                            /* Three groups, in the order they are worth
                               reading: the engine's pick, then the rest of
                               what fits, then what does not. Raw server order
                               interleaved them, so a blocked shelf sat between
                               two choices and the recommendation was fifth. */
                            const card = (sh: PutawayShelf) => (
                              <button
                                type="button"
                                key={sh.id}
                                className={`s4sl-sh${sh.eligible ? '' : ' is-out'}${spot === sh.id ? ' is-on' : ''}${rec?.id === sh.id ? ' is-rec' : ''}`}
                                disabled={!sh.eligible}
                                aria-pressed={spot === sh.id}
                                onClick={() => onSpot(spot === sh.id ? null : sh.id)}
                              >
                                <span className="s4sl-sh__hd">
                                  <span className="s4sl-sh__code">{shortCode(sh.code)}</span>
                                  {rec?.id === sh.id && <span className="s4sl-sh__star" title="Recommended">&#9733;</span>}
                                  <span className="s4sl-sh__radio" aria-hidden />
                                </span>
                                <span className="s4sl-sh__nm">{sh.name || `Level ${sh.level_no}`}</span>
                                <Fill pct={sh.used_pct} thin />
                                {sh.eligible ? (
                                  /* Before and after, because the number that
                                     matters is what this box leaves behind. */
                                  <span className="s4sl-sh__pct">{pct(sh.used_pct)} → {pct(sh.used_pct_after)}</span>
                                ) : (
                                  <span className="s4sl-sh__why">{sh.reason_label || 'Not available'}</span>
                                )}
                              </button>
                            );
                            const fits = [
                              ...r.shelves.filter(s => s.eligible && rec?.id === s.id),
                              ...r.shelves.filter(s => s.eligible && rec?.id !== s.id),
                            ];
                            const blocked = r.shelves.filter(s => !s.eligible);
                            const bOpen = openBlocked.has(r.id);
                            return (
                              <div className="s4sl-rb">
                                {fits.length > 0
                                  ? <div className="s4sl-shelves">{fits.map(card)}</div>
                                  : <div className="s4sl-rb__none">No shelf on this rack can take the box.</div>}

                                {blocked.length > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      className={`s4sl-blk${bOpen ? ' is-open' : ''}`}
                                      onClick={() => toggleBlocked(r.id)}
                                      aria-expanded={bOpen}
                                    >
                                      <i aria-hidden>&#9940;</i>
                                      {many(blocked.length, 'blocked shelf', 'blocked shelves')}
                                      <span>{bOpen ? 'Hide' : 'Show'}</span>
                                    </button>
                                    {bOpen && <div className="s4sl-shelves s4sl-shelves--blk">{blocked.map(card)}</div>}
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
