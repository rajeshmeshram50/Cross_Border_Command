import type { PutawayLocations, PutawayRack, PutawayShelf, PutawayZone } from '../spi-api';

/* ═══════════════════════════════════════════════════════════════════════════
 * Stage 04 · Step 02 — the static warehouse the design is drawn against.
 *
 * This screen is being designed, not wired. A real warehouse master is a
 * separate piece of work, and a page that cannot be seen cannot be reviewed:
 * every fill band, every refusal wording and the zone-wide banner need a
 * layout that actually exercises them.
 *
 * Shaped exactly like the server's payload, so turning this off later is one
 * constant in PutawaySelectLocation and nothing else.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** This box: 120 x 80 x 60 cm, 48 kg, ordinary handling. */
const BOX_KG = 48;

/** `used` and `cap` are kilos; the percentages are derived from them so the
 *  bars, the counts and the before/after can never disagree. */
function shelf(id: number, code: string, name: string, level: number,
               cap: number, used: number, why?: string): PutawayShelf {
  const pctOf = (kg: number) => Math.round(kg / cap * 1000) / 10;
  return {
    id, code, name, level_no: level,
    /* The demo warehouse is all ordinary racking — a cold or heavy-duty shelf
       would change which boxes are eligible, which this fixture is not for. */
    shelf_type: 'Standard Shelf',
    max_weight_kg: cap, free_weight_kg: cap - used, boxes: used > 0 ? 1 : 0,
    used_pct: pctOf(used), used_pct_after: pctOf(used + BOX_KG),
    eligible: !why, reason: why ? 'demo' : null, reason_label: why ?? null,
    held_by: null, ...(why ? {} : { score: 0 }),
  };
}

const rack = (id: number, code: string, name: string, shelves: PutawayShelf[]): PutawayRack => ({
  id, code, name, shelves,
  total: shelves.length, eligible: shelves.filter(s => s.eligible).length,
});

const zone = (
  id: number, code: string, name: string, purpose: string,
  temps: [number, number] | null, haz: boolean, racks: PutawayRack[],
): PutawayZone => ({
  id, code, name, rack_mode: 'rack',
  cold_chain: temps ? 1 : 0, hazardous: haz ? 1 : 0,
  purpose, temp_min_c: temps?.[0] ?? null, temp_max_c: temps?.[1] ?? null,
  racks,
  total: racks.reduce((t, r) => t + r.total, 0),
  eligible: racks.reduce((t, r) => t + r.eligible, 0),
});

const ZONES: PutawayZone[] = [
  zone(2, 'ZN-002', 'Dry Storage Zone B', 'Dry Storage', null, false, [
    rack(1, 'RC-001', 'Main Shelf Bay A', [
      shelf(101, 'RC-001-SH-101', 'Shelf Level 1', 1, 2000, 300),
      shelf(102, 'RC-001-SH-102', 'Shelf Level 2', 2, 2000, 800),
      shelf(103, 'RC-001-SH-103', 'Shelf Level 3', 3, 2000, 2000, 'Full'),
      shelf(104, 'RC-001-SH-104', 'Shelf Level 4', 4, 2000, 1240),
      shelf(105, 'RC-001-SH-105', 'Shelf Level 5', 5, 2000, 0),
      shelf(106, 'RC-001-SH-106', 'Shelf Level 6', 6, 2000, 400),
      shelf(107, 'RC-001-SH-107', 'Bulk Deck Level 7', 7, 2000, 1900, 'No space'),
    ]),
    rack(2, 'RC-002', 'Secondary Shelf Bay', [
      shelf(201, 'RC-002-SH-201', 'Upper Deck A', 1, 1500, 675),
      shelf(202, 'RC-002-SH-202', 'Upper Deck B', 2, 1500, 1500, 'Full'),
      shelf(203, 'RC-002-SH-203', 'Lower Deck A', 3, 1500, 150),
      shelf(204, 'RC-002-SH-204', 'Lower Deck B', 4, 1500, 450),
    ]),
    rack(7, 'RC-007', 'Carton Flow Rack', [
      shelf(701, 'RC-007-SH-701', 'Flow Lane 1', 1, 800, 240, 'Too small'),
      shelf(702, 'RC-007-SH-702', 'Flow Lane 2', 2, 800, 560, 'Too small'),
      shelf(703, 'RC-007-SH-703', 'Flow Lane 3', 3, 800, 80, 'Too small'),
    ]),
  ]),
  /* Every shelf refused for one reason, which is what the zone-wide banner
     exists to say once instead of four times. */
  zone(1, 'ZN-001', 'Cold Storage Zone A', 'Cold Chain', [2, 8], false, [
    rack(4, 'RC-004', 'Cold Storage Rack 01', [
      shelf(401, 'RC-004-SH-401', 'Cold Shelf A', 1, 1000, 250, 'Not allowed'),
      shelf(402, 'RC-004-SH-402', 'Cold Shelf B', 2, 1000, 600, 'Not allowed'),
      shelf(403, 'RC-004-SH-403', 'Cold Shelf C', 3, 1000, 1000, 'Not allowed'),
      shelf(404, 'RC-004-SH-404', 'Cold Shelf D', 4, 1000, 180, 'Not allowed'),
    ]),
    rack(8, 'RC-008', 'Cold Storage Rack 02', [
      shelf(801, 'RC-008-SH-801', 'Vaccine Shelf A', 1, 600, 300, 'Not allowed'),
      shelf(802, 'RC-008-SH-802', 'Vaccine Shelf B', 2, 600, 390, 'Not allowed'),
      shelf(803, 'RC-008-SH-803', 'Reserve Shelf', 3, 600, 60, 'Not allowed'),
    ]),
  ]),
  zone(4, 'ZN-004', 'Bulk Storage Zone', 'Bulk', null, false, [
    rack(3, 'RC-003', 'Bulk Floor Section', [
      shelf(301, 'RC-003-SH-301', 'Heavy Base Shelf', 1, 3000, 2700),
      shelf(302, 'RC-003-SH-302', 'Heavy Storage Shelf', 2, 3000, 2400),
      shelf(303, 'RC-003-SH-303', 'Wire Storage Shelf', 3, 3000, 300),
    ]),
    rack(9, 'RC-009', 'Cantilever Rack 01', [
      shelf(901, 'RC-009-SH-901', 'Arm Level 1', 1, 1200, 180, 'Too small'),
      shelf(902, 'RC-009-SH-902', 'Arm Level 2', 2, 1200, 600, 'Too small'),
      shelf(903, 'RC-009-SH-903', 'Arm Level 3', 3, 1200, 1200, 'Full'),
      shelf(904, 'RC-009-SH-904', 'Arm Level 4', 4, 1200, 240, 'Too small'),
    ]),
    rack(10, 'RC-010', 'Drive-in Rack', [
      shelf(1001, 'RC-010-SH-1001', 'Lane 1', 1, 2500, 1625),
      shelf(1002, 'RC-010-SH-1002', 'Lane 2', 2, 2500, 500),
    ]),
  ]),
  /* Nothing eligible and nothing expanded - a zone that is simply not for
     this box still has to be listed, or its shelves go unaccounted for. */
  zone(7, 'ZN-007', 'Electronics Bay', 'ESD Safe', null, false, [
    rack(11, 'RC-011', 'ESD Rack A', [
      shelf(1101, 'RC-011-SH-1101', 'ESD Shelf 1', 1, 500, 215, 'Not allowed'),
      shelf(1102, 'RC-011-SH-1102', 'ESD Shelf 2', 2, 500, 110, 'Not allowed'),
      shelf(1103, 'RC-011-SH-1103', 'ESD Shelf 3', 3, 500, 400, 'Not allowed'),
      shelf(1104, 'RC-011-SH-1104', 'ESD Shelf 4', 4, 500, 90, 'Not allowed'),
    ]),
    rack(12, 'RC-012', 'ESD Rack B', [
      shelf(1201, 'RC-012-SH-1201', 'Static Safe 1', 1, 500, 300, 'Not allowed'),
      shelf(1202, 'RC-012-SH-1202', 'Static Safe 2', 2, 500, 125, 'Not allowed'),
      shelf(1203, 'RC-012-SH-1203', 'Static Safe 3', 3, 500, 60, 'Not allowed'),
      shelf(1204, 'RC-012-SH-1204', 'Static Safe 4', 4, 500, 420, 'Not allowed'),
    ]),
  ]),
];

const TOTAL = ZONES.reduce((t, z) => t + z.total, 0);
const ELIGIBLE = ZONES.reduce((t, z) => t + z.eligible, 0);

/** The engine's pick: Shelf Level 5, empty and at a comfortable height. */
const PICK = ZONES[0].racks[0].shelves[4];

export const DEMO_LOCATIONS: PutawayLocations = {
  box: {
    id: 1, box_code: 'PUT-B-001',
    weight_kg: BOX_KG, height_cm: 60, footprint_cm2: 9600, volume_cm3: 576000,
    cold_chain: false, hazardous: false, fragile: false, is_stackable: true,
    temp_min_c: null, temp_max_c: null,
  },
  modes: { rack: TOTAL, norack: 6 },
  zones: ZONES,
  total: TOTAL,
  eligible: ELIGIBLE,
  recommended: {
    ...PICK, score: 95,
    zone_id: 2, zone_name: 'Dry Storage Zone B', zone_code: 'ZN-002',
    rack_id: 1, rack_name: 'Main Shelf Bay A', rack_code: 'RC-001',
  },
};

/** The two counts the Step 01 → Step 02 chooser asks for. */
export const DEMO_MODES = DEMO_LOCATIONS.modes;
