import axios from 'axios';
import api from '../../../api';
import type { ServerPageMeta } from '../../../hooks/useServerList';
import { zoneApi, type Zone, type ZoneWarehouse } from '../zone/zone-data';

export interface RackDims {
  unit: 'm' | 'cm';
  length: number;
  width: number;
  height: number;
  area: number;
}

export interface Rack {
  apiId: number;
  id: string;
  date: string;
  warehouseId: number | null;
  zoneId: number | null;
  whName: string;
  zoneName: string;
  name: string;
  cold: boolean;
  tempRange: { min: number; max: number } | null;
  haz: boolean;
  dims: RackDims;
  areaSqft: number;
  heightCm: number;
  shelves: number;
  capacityKg: number;
  usedKg: number;
  loadPct: number;
  status: 'active' | 'inactive';
}

export type RackTab = 'all' | 'active' | 'inactive';
export type RackTabs = Record<RackTab, number>;
export type RackMeta = ServerPageMeta & { tabs: RackTabs };

export interface RackPayload {
  zone_id: number;
  rack_name: string;
  cold_chain: 0 | 1;
  hazardous: 0 | 1;
  dim_unit: 'cm' | 'm';
  length: number;
  width: number;
  height: number;
}

export interface RackDetail extends Rack {
  freeHeightCm: number;
  nextLevel: number;
}

export interface InventoryLookups {
  warehouses: ZoneWarehouse[];
  zones: Zone[];
}

type RackRow = {
  id: number;
  rack_code: string | null;
  rack_name: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  zone_id: number | null;
  zone_name: string | null;
  cold_chain: number;
  hazardous: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  dim_unit: 'cm' | 'm' | null;
  length: number | null;
  width: number | null;
  height: number | null;
  height_cm: number | null;
  area_sqft: number | null;
  shelves_count: number | null;
  capacity_kg: number | null;
  used_kg: number | null;
  load_pct: number | null;
  status: number;
  created_at: string | null;
  free_height_cm?: number;
  next_level_no?: number;
};

export class InventoryApiError extends Error {
  constructor(message: string, public status: number | null, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'InventoryApiError';
  }
}

export async function call<T>(run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new InventoryApiError(body?.message || err.message || 'Request failed', err.response?.status ?? null, body?.errors ?? {});
    }
    throw err;
  }
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

const toRack = (r: RackRow): Rack => {
  const unit = r.dim_unit === 'm' ? 'm' : 'cm';
  const length = num(r.length), width = num(r.width), height = num(r.height);
  return {
    apiId: r.id,
    id: r.rack_code || `RC-${String(r.id).padStart(3, '0')}`,
    date: r.created_at ?? '',
    warehouseId: r.warehouse_id,
    zoneId: r.zone_id,
    whName: r.warehouse_name ?? '',
    zoneName: r.zone_name ?? '',
    name: r.rack_name ?? '',
    cold: Number(r.cold_chain) === 1,
    tempRange: Number(r.cold_chain) === 1 && r.temp_min_c != null && r.temp_max_c != null
      ? { min: Number(r.temp_min_c), max: Number(r.temp_max_c) }
      : null,
    haz: Number(r.hazardous) === 1,
    dims: { unit, length, width, height, area: Math.round(length * width * 1e4) / 1e4 },
    areaSqft: num(r.area_sqft),
    heightCm: r.height_cm != null ? num(r.height_cm) : height * (unit === 'm' ? 100 : 1),
    shelves: num(r.shelves_count),
    capacityKg: num(r.capacity_kg),
    usedKg: num(r.used_kg),
    loadPct: num(r.load_pct),
    status: Number(r.status) === 1 ? 'active' : 'inactive',
  };
};

const one = (b: unknown) => toRack((b as { data: RackRow }).data);

export const rackApi = {
  list: (q: { tab?: RackTab; search?: string; page?: number; per_page?: number }) =>
    call(() => api.get('/inventory/racks', {
      params: { tab: q.tab ?? 'all', q: q.search || undefined, page: q.page, per_page: q.per_page },
    }), (b) => {
      const body = b as { data?: RackRow[]; tabs?: RackTabs; meta?: ServerPageMeta } | null;
      return {
        rows: (body?.data ?? []).map(toRack),
        meta: body?.meta && body.tabs ? { ...body.meta, tabs: body.tabs } : null,
      };
    }),

  show: (apiId: number) => call(() => api.get(`/inventory/racks/${apiId}`), (b): RackDetail => {
    const row = (b as { data: RackRow }).data;
    return { ...toRack(row), freeHeightCm: num(row.free_height_cm), nextLevel: num(row.next_level_no) || 1 };
  }),

  create: (data: RackPayload) => call(() => api.post('/inventory/racks', data), one),

  update: (apiId: number, data: RackPayload) => call(() => api.put(`/inventory/racks/${apiId}`, data), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/racks/${apiId}/status`, { status: active ? 1 : 0 }), one),

  nextCode: () => call(
    () => api.get('/inventory/racks/next-code'),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),

  preview: (apiId: number) => call(
    () => api.get(`/inventory/racks/${apiId}/preview`),
    (b) => {
      const d = (b as { data?: { code?: string; scan?: string } } | null)?.data;
      return { code: String(d?.code ?? ''), scan: String(d?.scan ?? d?.code ?? '') };
    },
  ),
};

export async function loadInventoryLookups(): Promise<InventoryLookups> {
  const zones: Zone[] = [];
  const first = await zoneApi.list({ tab: 'all', page: 1, per_page: 100 });
  zones.push(...first.rows);
  for (let page = 2; page <= (first.meta?.last_page ?? 1); page++) {
    zones.push(...(await zoneApi.list({ tab: 'all', page, per_page: 100 })).rows);
  }
  const warehouses = await zoneApi.warehouses();
  return { warehouses, zones };
}

export function rackKind(r: Rack): string {
  if (r.cold && r.haz) return 'Cold chain · Hazardous';
  if (r.cold) return 'Cold chain rack';
  if (r.haz) return 'Hazardous rack';
  return 'Standard rack';
}

/**
 * onKeyDown for a positive number field. A number input lets "e", "+" and "-"
 * through (scientific notation, sign) and then reports the half-typed value
 * as "", so "456e" read as an empty field and was told "Required" (QA CS-942
 * #10). None of them belongs in a length or a weight.
 */
export const blockNonNumericKeys = (e: { key: string; preventDefault: () => void }) => {
  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') e.preventDefault();
};
