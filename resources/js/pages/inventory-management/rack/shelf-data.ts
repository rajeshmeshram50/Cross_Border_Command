/**
 * Shelves — derived from the rack, not stored.
 *
 * The prototype computes them from the rack's own height and id, so the same
 * rack always produces the same shelves without a table behind it. Ported
 * figure for figure: RC-001 (240 × 100 × 300 cm) comes out as 4 shelves,
 * 2,550 kg capacity, 1,210 kg used, 49 boxes and 60 cm of height left over,
 * which is what the design shows.
 *
 * When an endpoint lands, replace `shelvesOf`; everything else here reads the
 * shelves it returns.
 */
import { rackHeightCm, rackLevels, type Rack } from './rack-data';

export type ShelfType =
  | 'Pallet Level' | 'Heavy Duty Shelf' | 'Standard Shelf' | 'Bin Shelf' | 'Wire Mesh Shelf';

export interface ShelfDims {
  unit: 'm' | 'cm';
  length: number;
  width: number;
  /** Clear height of this level, in the rack's unit. */
  height: number;
  /** Footprint, in that unit squared. */
  area: number;
  /** Volume in the unit cubed — cm³ for a cm rack, m³ for a metre one. */
  volume: number;
  /** The same clear height in centimetres, which is how levels are spaced. */
  heightCm: number;
}

export interface Shelf {
  /** 1 is the bottom. */
  level: number;
  /** RC-001-SH-01 … */
  id: string;
  /** Shelf A, Shelf B … */
  name: string;
  type: ShelfType;
  /** What it can hold, in kg. */
  max: number;
  /** What is on it, in kg. */
  used: number;
  boxes: number;
  dims: ShelfDims;
  cold: boolean;
  tempRange: { min: number; max: number } | null;
  haz: boolean;
  purpose: string;
  status: 'active' | 'inactive';
  date: string;
}

/** `RC-001-SH-01` — the rack's code, then the level, two digits. */
export const shelfCode = (r: Rack, level: number) => `${r.id}-SH-${String(level).padStart(2, '0')}`;

/* The occupancy pattern. A fixed ring rather than random, so a rack looks the
   same every time it is opened — the screen is a design, and a number that
   moves on reload cannot be checked against the prototype. */
const FILL = [0, 0.35, 0.6, 0.82, 0.95, 0.48, 0.2, 0.72, 1, 0.55];

const PURPOSES = [
  'Bulk / Reserve Storage', 'Fast-Moving Picking', 'Small Parts & Bins',
  'Kitting & Assembly', 'Dispatch Staging', 'Returns / QC Hold',
];

/** What a level of this kind holds, in kg. */
const CAPACITY: Record<ShelfType, number> = {
  'Pallet Level': 1000,
  'Heavy Duty Shelf': 800,
  'Bin Shelf': 250,
  'Standard Shelf': 500,
  'Wire Mesh Shelf': 500,
};

/** Roughly what one box weighs on a level of this kind, in kg. */
const BOX_KG = (t: ShelfType) => (t === 'Pallet Level' ? 45 : t === 'Bin Shelf' ? 12 : 27);

/**
 * The clear height of one level, in centimetres.
 *
 * Four fifths of the rack divided between its levels, rounded down to 5cm —
 * the last fifth is the beams and the clearance over the top, which is why a
 * rack always has some height left after its shelves.
 */
export const shelfHeightCm = (r: Rack) =>
  Math.floor((rackHeightCm(r) * 0.8) / rackLevels(r) / 5) * 5;

/** Rack height not taken by shelves, in centimetres. */
export const rackHeightFreeCm = (r: Rack) =>
  Math.max(0, Math.round(rackHeightCm(r) - rackLevels(r) * shelfHeightCm(r)));

/** The shelves inside one rack, bottom first. */
export function shelvesOf(r: Rack): Shelf[] {
  const n = rackLevels(r);
  const hCm = shelfHeightCm(r);
  const perCm = r.dims.unit === 'm' ? 100 : 1;
  const idn = Number(r.id.replace(/\D/g, '')) || 1;
  const off = r.status === 'inactive';

  const out: Shelf[] = [];
  for (let i = 1; i <= n; i++) {
    /* The bottom level takes pallets, a cold rack is wire mesh throughout so
       air moves, the top is bins, and every third is heavy duty. */
    const type: ShelfType = i === 1
      ? 'Pallet Level'
      : r.cold ? 'Wire Mesh Shelf'
        : i === n ? 'Bin Shelf'
          : i % 3 === 0 ? 'Heavy Duty Shelf' : 'Standard Shelf';

    const max = CAPACITY[type];
    const pct = off ? 0 : FILL[(idn * 3 + i * 7) % FILL.length];
    /* To the nearest 5kg: a weight read off a floor scale is not precise to
       the kilo, and 357.4 kg on a label would be pretending otherwise. */
    const used = Math.round((max * pct) / 5) * 5;

    const { length: L, width: W } = r.dims;
    const h = hCm / perCm;

    out.push({
      level: i,
      id: shelfCode(r, i),
      name: `Shelf ${String.fromCharCode(64 + i)}`,
      type,
      max,
      used,
      /* An occupied shelf always holds at least one box — a shelf with weight
         on it and no boxes is a contradiction the figure should not state. */
      boxes: used ? Math.max(1, Math.round(used / BOX_KG(type))) : 0,
      dims: {
        unit: r.dims.unit,
        length: L,
        width: W,
        height: h,
        area: Math.round(L * W * 1e4) / 1e4,
        volume: Math.round(L * W * h * 1e6) / 1e6,
        heightCm: hCm,
      },
      cold: r.cold,
      tempRange: r.cold ? r.tempRange : null,
      /* Hazardous goods go on the bottom level only — nothing that can leak
         belongs above head height. */
      haz: r.haz && i === 1,
      purpose: r.cold
        ? 'Cold Chain Stock'
        : r.haz && i === 1 ? 'Hazardous Goods' : PURPOSES[(idn + i) % PURPOSES.length],
      status: off ? 'inactive' : 'active',
      date: r.date,
    });
  }
  return out;
}

/** A shelf's volume in cubic metres, whichever unit it was measured in. */
export const shelfVolumeM3 = (s: Shelf) =>
  s.dims.volume > 0 ? (s.dims.unit === 'm' ? s.dims.volume : s.dims.volume / 1e6) : 0;

export const shelfPct = (s: Shelf) => (s.max ? Math.round((s.used / s.max) * 100) : 0);

export type ShelfState = 'off' | 'max' | 'full' | 'near' | 'empty' | 'ok';

export function shelfState(s: Shelf): ShelfState {
  if (s.status === 'inactive') return 'off';
  const p = shelfPct(s);
  if (p >= 100) return 'max';
  if (p >= 90) return 'full';
  if (p >= 75) return 'near';
  return p === 0 ? 'empty' : 'ok';
}

export const SHELF_STATE_LABEL: Record<ShelfState, string> = {
  ok: 'Available', near: 'Near Full', full: 'Full',
  max: 'Fully Used', empty: 'Empty', off: 'Inactive',
};

/** What the rack adds up to, counting only the shelves that are switched on. */
export function rackTotals(shelves: Shelf[]) {
  const active = shelves.filter(s => s.status !== 'inactive');
  const capacity = active.reduce((t, s) => t + s.max, 0);
  const used = active.reduce((t, s) => t + s.used, 0);
  const boxes = active.reduce((t, s) => t + s.boxes, 0);
  return {
    active: active.length,
    inactive: shelves.length - active.length,
    capacity,
    used,
    free: Math.max(0, capacity - used),
    pct: capacity ? Math.round((used / capacity) * 100) : 0,
    boxes,
    /* How many shelves actually carry the boxes, which is the fact the card
       under the total is making. */
    shelvesWithBoxes: active.filter(s => s.boxes > 0).length,
  };
}
