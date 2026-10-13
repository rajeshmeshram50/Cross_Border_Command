import axios from 'axios';
import api from '../../../api';
import type { ServerPageMeta } from '../../../hooks/useServerList';

export interface ProductFlag {
  apiId: number;
  id: string;
  date: string;
  name: string;
  purpose: string;
  status: 'active' | 'inactive';
}

export type ProductFlagTab = 'all' | 'active' | 'inactive';
export type ProductFlagTabs = Record<ProductFlagTab, number>;
export type ProductFlagMeta = ServerPageMeta & { tabs: ProductFlagTabs };

type ApiRow = {
  id: number;
  flag_code: string | null;
  flag_name: string | null;
  purpose: string | null;
  status: number;
  created_at: string | null;
};

export class ProductFlagApiError extends Error {
  constructor(message: string, public status: number | null, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ProductFlagApiError';
  }
}

async function call<T>(run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new ProductFlagApiError(body?.message || err.message || 'Request failed', err.response?.status ?? null, body?.errors ?? {});
    }
    throw err;
  }
}

const toFlag = (r: ApiRow): ProductFlag => ({
  apiId: r.id,
  id: r.flag_code || `PF-${String(r.id).padStart(3, '0')}`,
  date: r.created_at ?? '',
  name: r.flag_name ?? '',
  purpose: r.purpose ?? '',
  status: Number(r.status) === 1 ? 'active' : 'inactive',
});

const one = (b: unknown) => toFlag((b as { data: ApiRow }).data);

export const productFlagApi = {
  list: (q: { tab?: ProductFlagTab; search?: string; page?: number; per_page?: number }) =>
    call(() => api.get('/inventory/product-flags', {
      params: { tab: q.tab ?? 'all', q: q.search || undefined, page: q.page, per_page: q.per_page },
    }), (b) => {
      const body = b as { data?: ApiRow[]; tabs?: ProductFlagTabs; meta?: ServerPageMeta } | null;
      return {
        rows: (body?.data ?? []).map(toFlag),
        meta: body?.meta && body.tabs ? { ...body.meta, tabs: body.tabs } : null,
      };
    }),

  nextCode: () => call(
    () => api.get('/inventory/product-flags/next-code'),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),

  create: (data: { flag_name: string; purpose: string }) =>
    call(() => api.post('/inventory/product-flags', data), one),

  update: (apiId: number, data: { flag_name: string; purpose: string }) =>
    call(() => api.put(`/inventory/product-flags/${apiId}`, data), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/product-flags/${apiId}/status`, { status: active ? 1 : 0 }), one),
};
