import api from '../../../api';
import { call } from './rack-data';

export const SHELF_TYPES = [
  'Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf',
];

export const SHELF_PURPOSES = [
  'Fast-Moving Picking', 'Bulk / Reserve Storage', 'Small Parts & Bins', 'Cold Chain Stock',
  'Hazardous Goods', 'Returns / QC Hold', 'Kitting & Assembly', 'Dispatch Staging', 'Other',
];

export interface ShelfDims {
  unit: 'm' | 'cm';
  length: number;
  width: number;
  height: number;
  area: number;
  volume: number;
  heightCm: number;
}

export interface Shelf {
  apiId: number;
  level: number;
  id: string;
  name: string;
  type: string;
  max: number;
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

export interface ShelfPayload {
  shelf_name: string;
  level_no: number;
  shelf_type: string;
  max_weight_kg: number;
  purpose: string;
  cold_chain: 0 | 1;
  hazardous: 0 | 1;
  dim_unit: 'cm' | 'm';
  length: number;
  width: number;
  height: number;
  area: number;
  volume: number;
}

export interface RackShelves {
  shelves: Shelf[];
  freeHeightCm: number;
  nextLevel: number;
}

type ShelfRow = {
  id: number;
  shelf_code: string | null;
  shelf_name: string | null;
  level_no: number;
  shelf_type: string | null;
  purpose: string | null;
  max_weight_kg: number | null;
  used_weight_kg: number | null;
  boxes_count: number | null;
  cold_chain: number;
  hazardous: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  dim_unit: 'cm' | 'm' | null;
  length: number | null;
  width: number | null;
  height: number | null;
  height_cm: number | null;
  area: number | null;
  volume: number | null;
  status: number;
  created_at: string | null;
};

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

const toShelf = (r: ShelfRow): Shelf => {
  const unit = r.dim_unit === 'm' ? 'm' : 'cm';
  const length = num(r.length), width = num(r.width), height = num(r.height);
  return {
    apiId: r.id,
    level: num(r.level_no),
    id: r.shelf_code || `SH-${r.id}`,
    name: r.shelf_name ?? '',
    type: r.shelf_type ?? '',
    max: num(r.max_weight_kg),
    used: num(r.used_weight_kg),
    boxes: num(r.boxes_count),
    dims: {
      unit, length, width, height,
      area: r.area != null ? num(r.area) : Math.round(length * width * 1e4) / 1e4,
      volume: r.volume != null ? num(r.volume) : Math.round(length * width * height * 1e6) / 1e6,
      heightCm: r.height_cm != null ? num(r.height_cm) : height * (unit === 'm' ? 100 : 1),
    },
    cold: Number(r.cold_chain) === 1,
    tempRange: Number(r.cold_chain) === 1 && r.temp_min_c != null && r.temp_max_c != null
      ? { min: Number(r.temp_min_c), max: Number(r.temp_max_c) }
      : null,
    haz: Number(r.hazardous) === 1,
    purpose: r.purpose ?? '',
    status: Number(r.status) === 1 ? 'active' : 'inactive',
    date: r.created_at ?? '',
  };
};

const one = (b: unknown) => toShelf((b as { data: ShelfRow }).data);

export const shelfApi = {
  list: (rackId: number) => call(() => api.get(`/inventory/racks/${rackId}/shelves`), (b): RackShelves => {
    const body = b as { data?: ShelfRow[]; rack?: { free_height_cm?: number; next_level_no?: number } } | null;
    return {
      shelves: (body?.data ?? []).map(toShelf),
      freeHeightCm: num(body?.rack?.free_height_cm),
      nextLevel: num(body?.rack?.next_level_no) || 1,
    };
  }),

  nextCode: (rackId: number) => call(
    () => api.get(`/inventory/racks/${rackId}/shelves/next-code`),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),

  create: (rackId: number, data: ShelfPayload) => call(() => api.post(`/inventory/racks/${rackId}/shelves`, data), one),

  update: (apiId: number, data: ShelfPayload) => call(() => api.put(`/inventory/shelves/${apiId}`, data), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/shelves/${apiId}/status`, { status: active ? 1 : 0 }), one),

  preview: (apiId: number) => call(
    () => api.get(`/inventory/shelves/${apiId}/preview`),
    (b) => {
      const d = (b as { data?: { code?: string; scan?: string } } | null)?.data;
      return { code: String(d?.code ?? ''), scan: String(d?.scan ?? d?.code ?? '') };
    },
  ),
};

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
    shelvesWithBoxes: active.filter(s => s.boxes > 0).length,
  };
}
