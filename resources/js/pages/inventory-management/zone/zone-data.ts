import axios from 'axios';
import api from '../../../api';
import type { ServerPageMeta } from '../../../hooks/useServerList';

export type ZoneType = 'rack' | 'norack';

export type ZoneStorage = '' | 'regular' | 'fridge';

export interface ZoneDims {
  unit: 'm' | 'cm';
  length: number;
  width: number;
  height: number;
  usablePct: number;
  floorArea: number;
  volume: number;
  usableVolume: number;
}

export interface Zone {
  apiId?: number;
  warehouseId?: number | null;
  whName?: string;
  id: string;
  date: string;
  type: ZoneType;
  name: string;
  wh: string;
  area: number;
  purpose: string;
  cold: boolean;
  tempRange: { min: number; max: number } | null;
  haz: boolean;
  storage: ZoneStorage;
  litres: number | null;
  dims: ZoneDims | null;
  status: 'active' | 'inactive';
}

export interface ZoneWarehouse {
  apiId: number;
  id: string;
  name: string;
  type: 'own' | 'tpl';
  area: number;
  /** Sq. ft already claimed by its zones — the form shows area minus this. */
  used: number;
  city: string;
  state: string;
  pin: string;
  map: string;
  active: boolean;
}

export type ZoneTab = 'all' | ZoneType;

export function uniqueLabels<T>(
  items: T[], key: (t: T) => number, base: (t: T) => string, hint: (t: T) => string,
): Map<number, string> {
  const seen = new Map<string, number>();
  for (const t of items) seen.set(base(t), (seen.get(base(t)) ?? 0) + 1);
  const used = new Set<string>();
  const out = new Map<number, string>();
  for (const t of items) {
    let label = base(t);
    if ((seen.get(label) ?? 0) > 1) {
      const h = hint(t).trim();
      if (h) label = `${label} (${h})`;
    }
    if (used.has(label)) label = `${label} #${key(t)}`;
    used.add(label);
    out.set(key(t), label);
  }
  return out;
}
export type ZoneCounts = Record<ZoneTab, number>;

export interface ZonePayload {
  warehouse_id: number;
  zone_name: string;
  rack_mode: ZoneType;
  area_sqft: number;
  purpose: string;
  cold_chain: 0 | 1;
  temp_min_c: number | null;
  temp_max_c: number | null;
  hazardous: 0 | 1;
  storage_mode: 'regular' | 'fridge' | null;
  capacity_litres: number | null;
  dim_unit: 'm' | 'cm' | null;
  length: number | null;
  width: number | null;
  height: number | null;
  usable_pct: number | null;
  floor_area: number | null;
  volume: number | null;
  usable_volume: number | null;
}

type ZoneRow = {
  id: number;
  zone_code: string | null;
  zone_name: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  rack_mode: ZoneType;
  area_sqft: number | null;
  purpose: string | null;
  cold_chain: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  hazardous: number;
  storage_mode: 'regular' | 'fridge' | null;
  capacity_litres: number | null;
  dim_unit: 'm' | 'cm' | null;
  length: number | null;
  width: number | null;
  height: number | null;
  usable_pct: number | null;
  floor_area: number | null;
  volume: number | null;
  usable_volume: number | null;
  status: number;
  created_at: string | null;
};

type WarehouseRow = {
  id: number;
  wh_code: string | null;
  wh_name: string | null;
  wh_type: 'own' | 'tpl';
  area_sqft: number | null;
  zones_area_sqft?: number | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  map_url: string | null;
  status: number;
};

export class ZoneApiError extends Error {
  constructor(message: string, public status: number | null, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ZoneApiError';
  }
}

async function call<T>(run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new ZoneApiError(body?.message || err.message || 'Request failed', err.response?.status ?? null, body?.errors ?? {});
    }
    throw err;
  }
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

const toZone = (r: ZoneRow): Zone => {
  const storage: ZoneStorage = r.rack_mode === 'norack' && r.storage_mode ? r.storage_mode : '';
  return {
    apiId: r.id,
    warehouseId: r.warehouse_id,
    whName: r.warehouse_name ?? '',
    id: r.zone_code || `ZN-${String(r.id).padStart(3, '0')}`,
    date: r.created_at ?? '',
    type: r.rack_mode === 'norack' ? 'norack' : 'rack',
    name: r.zone_name ?? '',
    wh: '',
    area: num(r.area_sqft),
    purpose: r.purpose ?? '',
    cold: Number(r.cold_chain) === 1,
    tempRange: Number(r.cold_chain) === 1 && r.temp_min_c != null && r.temp_max_c != null
      ? { min: Number(r.temp_min_c), max: Number(r.temp_max_c) }
      : null,
    haz: Number(r.hazardous) === 1,
    storage,
    litres: storage === 'fridge' && r.capacity_litres != null ? Number(r.capacity_litres) : null,
    dims: storage === 'regular' && r.length != null && r.width != null && r.height != null
      ? {
        unit: r.dim_unit === 'cm' ? 'cm' : 'm',
        length: num(r.length),
        width: num(r.width),
        height: num(r.height),
        usablePct: num(r.usable_pct),
        floorArea: num(r.floor_area),
        volume: num(r.volume),
        usableVolume: num(r.usable_volume),
      }
      : null,
    status: Number(r.status) === 1 ? 'active' : 'inactive',
  };
};

const toWarehouse = (r: WarehouseRow): ZoneWarehouse => ({
  apiId: r.id,
  id: r.wh_code || `WH-${String(r.id).padStart(3, '0')}`,
  name: r.wh_name ?? '',
  type: r.wh_type === 'tpl' ? 'tpl' : 'own',
  area: num(r.area_sqft),
  used: num(r.zones_area_sqft),
  city: r.city ?? '',
  state: r.state ?? '',
  pin: r.pincode ?? '',
  map: r.map_url ?? '',
  active: Number(r.status) === 1,
});

const one = (b: unknown) => toZone((b as { data: ZoneRow }).data);

const listParams = (tab: ZoneTab | undefined) => (tab && tab !== 'all' ? { rack_mode: tab } : {});

export const zoneApi = {
  list: (q: { tab?: ZoneTab; search?: string; page?: number; per_page?: number }) =>
    call(() => api.get('/inventory/zones', {
      params: { ...listParams(q.tab), q: q.search || undefined, page: q.page, per_page: q.per_page },
    }), (b) => {
      const body = b as { data?: ZoneRow[]; meta?: ServerPageMeta } | null;
      return { rows: (body?.data ?? []).map(toZone), meta: body?.meta ?? null };
    }),

  counts: async (): Promise<ZoneCounts> => {
    const total = (tab: ZoneType) => call(
      () => api.get('/inventory/zones', { params: { rack_mode: tab, per_page: 1 } }),
      (b) => Number((b as { meta?: ServerPageMeta } | null)?.meta?.total ?? 0),
    );
    const [rack, norack] = await Promise.all([total('rack'), total('norack')]);
    return { all: rack + norack, rack, norack };
  },

  warehouses: async (): Promise<ZoneWarehouse[]> => {
    const out: ZoneWarehouse[] = [];
    for (let page = 1, last = 1; page <= last; page++) {
      const res = await call(
        () => api.get('/inventory/warehouses', { params: { tab: 'all', page, per_page: 100 } }),
        (b) => b as { data?: WarehouseRow[]; meta?: ServerPageMeta } | null,
      );
      out.push(...(res?.data ?? []).map(toWarehouse));
      last = res?.meta?.last_page ?? 1;
    }
    return out;
  },

  create: (data: ZonePayload) => call(() => api.post('/inventory/zones', data), one),

  update: (apiId: number, data: ZonePayload) => call(() => api.put(`/inventory/zones/${apiId}`, data), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/zones/${apiId}/status`, { status: active ? 1 : 0 }), one),

  show: (apiId: number) => call(() => api.get(`/inventory/zones/${apiId}`), one),

  preview: (apiId: number) => call(
    () => api.get(`/inventory/zones/${apiId}/preview`),
    (b) => {
      const d = (b as { data?: { code?: string; scan?: string } } | null)?.data;
      return { code: String(d?.code ?? ''), scan: String(d?.scan ?? d?.code ?? '') };
    },
  ),

  nextCode: () => call(
    () => api.get('/inventory/zones/next-code'),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),
};
