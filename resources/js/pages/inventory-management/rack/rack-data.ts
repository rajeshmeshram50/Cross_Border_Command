/**
 * Racks — the prototype's own 50, verbatim.
 *
 * Static, like the warehouses, zones and flags: the screen is designed before
 * it is wired. Replace what this module exports when an endpoint lands; the
 * page only ever reads RACKS.
 */

/** The measured box of a rack, in the unit it was entered in. */
export interface RackDims {
  unit: 'm' | 'cm';
  length: number;
  width: number;
  height: number;
  /** Footprint — length × width, in that unit squared. */
  area: number;
}

export interface Rack {
  /** RC-001 … */
  id: string;
  /** Created on. ISO; formatted on render. */
  date: string;
  /** The warehouse, by its WH- code. */
  wh: string;
  /** The zone the rack stands in, by its ZN- code. Always a with-rack zone. */
  zone: string;
  name: string;
  /** Cold chain allowed, and between which temperatures. */
  cold: boolean;
  tempRange: { min: number; max: number } | null;
  /** Hazardous goods allowed. */
  haz: boolean;
  dims: RackDims;
  /** The footprint again in square feet, which is how warehouses are sized. */
  areaSqft: number;
  status: 'active' | 'inactive';
}

export const RACKS: Rack[] = [
  { id: 'RC-001', date: '2025-07-10', wh: 'WH-018', zone: 'ZN-002', name: 'Rack A-01', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 240, width: 100, height: 300, area: 24000 }, areaSqft: 25.8334, status: 'active' },
  { id: 'RC-002', date: '2025-07-16', wh: 'WH-018', zone: 'ZN-002', name: 'Rack A-02', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-003', date: '2025-07-22', wh: 'WH-001', zone: 'ZN-004', name: 'Rack B-01', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-004', date: '2025-07-28', wh: 'WH-001', zone: 'ZN-004', name: 'Rack B-02', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 3, width: 1.2, height: 4.5, area: 3.6 }, areaSqft: 38.75, status: 'active' },
  { id: 'RC-005', date: '2025-08-03', wh: 'WH-004', zone: 'ZN-006', name: 'Rack C-01', cold: true, tempRange: { min: 15, max: 25 }, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'inactive' },
  { id: 'RC-006', date: '2025-08-09', wh: 'WH-007', zone: 'ZN-010', name: 'Rack D-01', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 180, width: 90, height: 240, area: 16200 }, areaSqft: 17.4375, status: 'active' },
  { id: 'RC-007', date: '2025-08-15', wh: 'WH-007', zone: 'ZN-010', name: 'Rack D-02', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-008', date: '2025-08-21', wh: 'WH-009', zone: 'ZN-011', name: 'Rack E-01', cold: true, tempRange: { min: 15, max: 25 }, haz: false, dims: { unit: 'm', length: 2.5, width: 1, height: 3.3, area: 2.5 }, areaSqft: 26.9097, status: 'active' },
  { id: 'RC-009', date: '2025-08-27', wh: 'WH-009', zone: 'ZN-011', name: 'Rack E-02', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'active' },
  { id: 'RC-010', date: '2025-09-02', wh: 'WH-013', zone: 'ZN-012', name: 'Rack F-01', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'inactive' },
  { id: 'RC-011', date: '2025-09-08', wh: 'WH-002', zone: 'ZN-013', name: 'Rack G-01', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 240, width: 100, height: 300, area: 24000 }, areaSqft: 25.8334, status: 'active' },
  { id: 'RC-012', date: '2025-09-14', wh: 'WH-002', zone: 'ZN-013', name: 'Rack G-02', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 2.7, width: 1.1, height: 3.6, area: 2.97 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-013', date: '2025-09-20', wh: 'WH-005', zone: 'ZN-015', name: 'Rack H-01', cold: false, tempRange: null, haz: true, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-014', date: '2025-09-26', wh: 'WH-005', zone: 'ZN-015', name: 'Rack H-02', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'active' },
  { id: 'RC-015', date: '2025-10-02', wh: 'WH-011', zone: 'ZN-017', name: 'Rack A-03', cold: false, tempRange: null, haz: true, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'inactive' },
  { id: 'RC-016', date: '2025-10-08', wh: 'WH-017', zone: 'ZN-019', name: 'Rack B-03', cold: false, tempRange: null, haz: true, dims: { unit: 'm', length: 1.8, width: 0.9, height: 2.4, area: 1.62 }, areaSqft: 17.4375, status: 'active' },
  { id: 'RC-017', date: '2025-10-14', wh: 'WH-017', zone: 'ZN-019', name: 'Rack B-04', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-018', date: '2025-10-20', wh: 'WH-003', zone: 'ZN-022', name: 'Rack C-03', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-019', date: '2025-10-26', wh: 'WH-003', zone: 'ZN-022', name: 'Rack C-04', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'active' },
  { id: 'RC-020', date: '2025-11-01', wh: 'WH-008', zone: 'ZN-026', name: 'Rack D-03', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 3.6, width: 1.2, height: 4.8, area: 4.32 }, areaSqft: 46.5, status: 'inactive' },
  { id: 'RC-021', date: '2025-11-07', wh: 'WH-010', zone: 'ZN-027', name: 'Rack E-03', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 240, width: 100, height: 300, area: 24000 }, areaSqft: 25.8334, status: 'active' },
  { id: 'RC-022', date: '2025-11-13', wh: 'WH-010', zone: 'ZN-027', name: 'Rack E-04', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-023', date: '2025-11-19', wh: 'WH-015', zone: 'ZN-029', name: 'Rack F-03', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-024', date: '2025-11-25', wh: 'WH-015', zone: 'ZN-029', name: 'Rack F-04', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 3, width: 1.2, height: 4.5, area: 3.6 }, areaSqft: 38.75, status: 'active' },
  { id: 'RC-025', date: '2025-12-01', wh: 'WH-001', zone: 'ZN-037', name: 'Rack G-03', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'inactive' },
  { id: 'RC-026', date: '2025-12-07', wh: 'WH-001', zone: 'ZN-038', name: 'Rack H-03', cold: true, tempRange: { min: 15, max: 25 }, haz: false, dims: { unit: 'cm', length: 180, width: 90, height: 240, area: 16200 }, areaSqft: 17.4375, status: 'active' },
  { id: 'RC-027', date: '2025-12-13', wh: 'WH-001', zone: 'ZN-038', name: 'Rack H-04', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-028', date: '2025-12-19', wh: 'WH-001', zone: 'ZN-039', name: 'Rack A-05', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 2.5, width: 1, height: 3.3, area: 2.5 }, areaSqft: 26.9097, status: 'active' },
  { id: 'RC-029', date: '2025-12-25', wh: 'WH-001', zone: 'ZN-039', name: 'Rack A-06', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'active' },
  { id: 'RC-030', date: '2025-12-31', wh: 'WH-002', zone: 'ZN-040', name: 'Rack B-05', cold: false, tempRange: null, haz: true, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'inactive' },
  { id: 'RC-031', date: '2026-01-06', wh: 'WH-002', zone: 'ZN-041', name: 'Rack C-05', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 240, width: 100, height: 300, area: 24000 }, areaSqft: 25.8334, status: 'active' },
  { id: 'RC-032', date: '2026-01-12', wh: 'WH-002', zone: 'ZN-041', name: 'Rack C-06', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 2.7, width: 1.1, height: 3.6, area: 2.97 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-033', date: '2026-01-18', wh: 'WH-003', zone: 'ZN-042', name: 'Rack D-05', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'active' },
  { id: 'RC-034', date: '2026-01-24', wh: 'WH-003', zone: 'ZN-042', name: 'Rack D-06', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'active' },
  { id: 'RC-035', date: '2026-01-30', wh: 'WH-003', zone: 'ZN-043', name: 'Rack E-05', cold: true, tempRange: { min: 15, max: 25 }, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'inactive' },
  { id: 'RC-036', date: '2026-02-05', wh: 'WH-003', zone: 'ZN-044', name: 'Rack F-05', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 1.8, width: 0.9, height: 2.4, area: 1.62 }, areaSqft: 17.4375, status: 'active' },
  { id: 'RC-037', date: '2026-02-11', wh: 'WH-003', zone: 'ZN-044', name: 'Rack F-06', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-038', date: '2026-02-17', wh: 'WH-004', zone: 'ZN-045', name: 'Rack G-05', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'active' },
  { id: 'RC-039', date: '2026-02-23', wh: 'WH-004', zone: 'ZN-045', name: 'Rack G-06', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'active' },
  { id: 'RC-040', date: '2026-03-01', wh: 'WH-004', zone: 'ZN-046', name: 'Rack H-05', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 3.6, width: 1.2, height: 4.8, area: 4.32 }, areaSqft: 46.5, status: 'inactive' },
  { id: 'RC-041', date: '2026-03-07', wh: 'WH-014', zone: 'ZN-001', name: 'Rack A-07', cold: true, tempRange: { min: 15, max: 25 }, haz: false, dims: { unit: 'cm', length: 240, width: 100, height: 300, area: 24000 }, areaSqft: 25.8334, status: 'inactive' },
  { id: 'RC-042', date: '2026-03-13', wh: 'WH-014', zone: 'ZN-001', name: 'Rack A-08', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'inactive' },
  { id: 'RC-043', date: '2026-03-19', wh: 'WH-016', zone: 'ZN-018', name: 'Rack B-07', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 270, width: 110, height: 360, area: 29700 }, areaSqft: 31.9688, status: 'inactive' },
  { id: 'RC-044', date: '2026-03-25', wh: 'WH-016', zone: 'ZN-018', name: 'Rack B-08', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 3, width: 1.2, height: 4.5, area: 3.6 }, areaSqft: 38.75, status: 'inactive' },
  { id: 'RC-045', date: '2026-03-31', wh: 'WH-006', zone: 'ZN-025', name: 'Rack C-07', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 300, width: 120, height: 450, area: 36000 }, areaSqft: 38.7501, status: 'inactive' },
  { id: 'RC-046', date: '2026-04-06', wh: 'WH-012', zone: 'ZN-028', name: 'Rack D-07', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 180, width: 90, height: 240, area: 16200 }, areaSqft: 17.4375, status: 'inactive' },
  { id: 'RC-047', date: '2026-04-12', wh: 'WH-012', zone: 'ZN-028', name: 'Rack D-08', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 250, width: 100, height: 330, area: 25000 }, areaSqft: 26.9098, status: 'inactive' },
  { id: 'RC-048', date: '2026-04-18', wh: 'WH-012', zone: 'ZN-065', name: 'Rack E-07', cold: false, tempRange: null, haz: false, dims: { unit: 'm', length: 2.5, width: 1, height: 3.3, area: 2.5 }, areaSqft: 26.9097, status: 'inactive' },
  { id: 'RC-049', date: '2026-04-24', wh: 'WH-012', zone: 'ZN-065', name: 'Rack E-08', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'inactive' },
  { id: 'RC-050', date: '2026-04-30', wh: 'WH-012', zone: 'ZN-066', name: 'Rack F-07', cold: false, tempRange: null, haz: false, dims: { unit: 'cm', length: 360, width: 120, height: 480, area: 43200 }, areaSqft: 46.5001, status: 'inactive' },

];

/** Height in centimetres, whichever unit the rack was measured in. */
export const rackHeightCm = (r: Rack) => (r.dims.unit === 'm' ? r.dims.height * 100 : r.dims.height);

/**
 * How many shelf levels a rack holds.
 *
 * Derived from its height rather than stored, the way the prototype does it:
 * a level needs roughly 60cm, the top of the rack is not one, and the result
 * is held between 3 and 6 so a very tall rack does not become a ladder.
 */
export const rackLevels = (r: Rack) =>
  Math.max(3, Math.min(6, Math.floor(rackHeightCm(r) / 60) - 1));

/** What the rack is for, read off its flags — the line under its name. */
export function rackKind(r: Rack): string {
  if (r.cold && r.haz) return 'Cold chain · Hazardous';
  if (r.cold) return 'Cold chain rack';
  if (r.haz) return 'Hazardous rack';
  return 'Standard rack';
}
