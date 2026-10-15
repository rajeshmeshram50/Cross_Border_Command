import axios from 'axios';
import api from '../../../api';
import type { ServerPageMeta } from '../../../hooks/useServerList';

export type WarehouseType = 'own' | 'tpl';

export interface Warehouse {
  apiId?: number;
  countryId?: number | null;
  stateId?: number | null;
  dial?: string;
  cardName?: string;
  cardUrl?: string;
  zones?: number;
  racks?: number;
  id: string;
  date: string;
  type: WarehouseType;
  name: string;
  area: number;
  address: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  map: string;
  contact: string;
  mobile: string;
  email: string;
  status: 'active' | 'inactive';
}

export type WarehouseTab = 'all' | WarehouseType;
export type WarehouseCounts = Record<WarehouseTab, number>;

export interface LookupOption { id: number; name: string }

export interface WarehousePayload {
  wh_name: string;
  wh_type: WarehouseType;
  area_sqft: number;
  address: string;
  country_id: number;
  state_id: number | null;
  state_name: string | null;
  city: string;
  pincode: string;
  map_url: string | null;
  contact_person: string;
  contact_dial: string | null;
  contact_mobile: string;
  contact_email: string;
  card?: File | null;
  /** Create only: the switcher's branch, which a client admin files the warehouse under. */
  branch_id?: number | null;
}

type WarehouseRow = {
  id: number;
  wh_code: string | null;
  wh_name: string | null;
  wh_type: WarehouseType;
  area_sqft: number | null;
  address: string | null;
  country_id: number | null;
  country: string | null;
  state_id: number | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  map_url: string | null;
  contact_person: string | null;
  contact_dial: string | null;
  contact_mobile: string | null;
  contact_email: string | null;
  card_name: string | null;
  card_url: string | null;
  zones_count: number | null;
  racks_count: number | null;
  status: number;
  created_at: string | null;
};

export interface WarehouseLabel {
  code: string;
  scan: string;
  title: string;
  subtitle: string | null;
  rows: Array<[string, string]>;
  flags: Array<{ text: string; tone: string }>;
  qr: string | null;
}

export class WarehouseApiError extends Error {
  constructor(message: string, public status: number | null, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'WarehouseApiError';
  }
}

async function call<T>(run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new WarehouseApiError(body?.message || err.message || 'Request failed', err.response?.status ?? null, body?.errors ?? {});
    }
    throw err;
  }
}

const toWarehouse = (r: WarehouseRow): Warehouse => ({
  apiId: r.id,
  countryId: r.country_id,
  stateId: r.state_id,
  dial: r.contact_dial ?? '',
  cardName: r.card_name ?? '',
  cardUrl: r.card_url ?? '',
  zones: Number(r.zones_count ?? 0),
  racks: Number(r.racks_count ?? 0),
  id: r.wh_code || `WH-${String(r.id).padStart(3, '0')}`,
  date: r.created_at ?? '',
  type: r.wh_type === 'tpl' ? 'tpl' : 'own',
  name: r.wh_name ?? '',
  area: Number(r.area_sqft ?? 0),
  address: r.address ?? '',
  country: r.country ?? '',
  state: r.state ?? '',
  city: r.city ?? '',
  pin: r.pincode ?? '',
  map: r.map_url ?? '',
  contact: r.contact_person ?? '',
  mobile: r.contact_mobile ?? '',
  email: r.contact_email ?? '',
  status: Number(r.status) === 1 ? 'active' : 'inactive',
});

const one = (b: unknown) => toWarehouse((b as { data: WarehouseRow }).data);

const toForm = (p: WarehousePayload) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(p)) {
    if (k === 'card') continue;
    fd.append(k, v == null ? '' : String(v));
  }
  if (p.card) fd.append('card', p.card);
  return fd;
};

const lookupRows = (b: unknown): LookupOption[] => {
  const raw = Array.isArray(b) ? b : Array.isArray((b as { data?: unknown })?.data) ? (b as { data: unknown[] }).data : [];
  return (raw as Array<{ id: number; name: string }>)
    .filter(r => r && r.id && r.name)
    .map(r => ({ id: Number(r.id), name: String(r.name) }))
    .sort((a, b2) => a.name.localeCompare(b2.name));
};

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const warehouseApi = {
  list: (q: { tab?: WarehouseTab; search?: string; page?: number; per_page?: number }) =>
    call(() => api.get('/inventory/warehouses', {
      params: {
        wh_type: q.tab && q.tab !== 'all' ? q.tab : undefined,
        q: q.search || undefined, page: q.page, per_page: q.per_page,
      },
    }), (b) => {
      const body = b as { data?: WarehouseRow[]; meta?: ServerPageMeta } | null;
      return { rows: (body?.data ?? []).map(toWarehouse), meta: body?.meta ?? null };
    }),

  counts: async (): Promise<WarehouseCounts> => {
    const total = (t: WarehouseType) => call(
      () => api.get('/inventory/warehouses', { params: { wh_type: t, per_page: 1 } }),
      (b) => Number((b as { meta?: ServerPageMeta } | null)?.meta?.total ?? 0),
    );
    const [own, tpl] = await Promise.all([total('own'), total('tpl')]);
    return { all: own + tpl, own, tpl };
  },

  countries: () => call(() => api.get('/master/countries', { params: { fields: 'id,name' } }), lookupRows),

  states: (countryId: number) =>
    call(() => api.get('/master/states', { params: { country_id: countryId, fields: 'id,name' } }), lookupRows),

  create: (data: WarehousePayload) => call(() => api.post('/inventory/warehouses', toForm(data), multipart), one),

  update: (apiId: number, data: WarehousePayload) =>
    call(() => api.post(`/inventory/warehouses/${apiId}`, toForm(data), multipart), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/warehouses/${apiId}/status`, { status: active ? 1 : 0 }), one),

  show: (apiId: number) => call(() => api.get(`/inventory/warehouses/${apiId}`), one),

  preview: (apiId: number) => call(() => api.get(`/inventory/warehouses/${apiId}/preview`), (b): WarehouseLabel => {
    const d = (b as { data?: Record<string, unknown> } | null)?.data ?? {};
    const rows = (d.rows && typeof d.rows === 'object' ? d.rows : {}) as Record<string, unknown>;
    return {
      code: String(d.code ?? ''),
      scan: String(d.scan ?? d.code ?? ''),
      title: String(d.title ?? ''),
      subtitle: d.subtitle ? String(d.subtitle) : null,
      rows: Object.entries(rows).map(([k, v]) => [k, String(v)] as [string, string]),
      flags: Array.isArray(d.flags) ? (d.flags as Array<{ text: string; tone: string }>) : [],
      qr: typeof d.qr === 'string' ? d.qr : null,
    };
  }),

  nextCode: () => call(
    () => api.get('/inventory/warehouses/next-code'),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),
};
