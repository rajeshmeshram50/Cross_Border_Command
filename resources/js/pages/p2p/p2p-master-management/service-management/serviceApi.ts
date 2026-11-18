import api from '../../../../api';
import type { MappedSupplier, OtherType, ServiceKind, ServiceRecord, ServiceTab } from './serviceData';

export type ApiServiceType = 'self_consumable' | 'soft_digital' | 'other_operational';

export const TAB_TO_TYPE: Record<ServiceTab, ApiServiceType> = {
  material: 'self_consumable',
  soft: 'soft_digital',
  other: 'other_operational',
};

export interface ApiServiceRow {
  id: number;
  code: string;
  created_at: string;
  name: string;
  description: string | null;
  service_type: ApiServiceType;
  classification: string | null;
  category: string | null;
  segment: string | null;
  provider_brand: string | null;
  delivery_type: string | null;
  billing_frequency: string | null;
  department: string | null;
  hsn_code: string | null;
  uom: string | null;
  condition: string | null;
  contract_required: boolean;
  status: 'draft' | 'active' | 'inactive';
  step_completed: number;
  primary_image: string | null;
  suppliers_count: number;
  supplier_names: string[];
}

type TypeCounts = { total: number } & Record<string, number>;
export interface ServiceCounts {
  self_consumable: TypeCounts;
  soft_digital: TypeCounts;
  other_operational: TypeCounts;
  all: number;
}

export interface ServiceListResponse {
  data: ApiServiceRow[];
  total: number;
  current_page: number;
  last_page: number;
  per_page: number;
  counts: ServiceCounts;
}

export interface ServiceListParams {
  tab: ServiceTab;
  sub: string;
  q: string;
  page: number;
  perPage: number;
}

export async function fetchServiceList(p: ServiceListParams, signal?: AbortSignal): Promise<ServiceListResponse> {
  const res = await api.get<ServiceListResponse>('/p2p/services', {
    params: {
      service_type: TAB_TO_TYPE[p.tab],
      classification: p.sub !== 'all' ? p.sub : undefined,
      q: p.q.trim() || undefined,
      page: p.page,
      per_page: p.perPage,
    },
    signal,
  });
  return res.data;
}

const kindOf = (r: ApiServiceRow): ServiceKind => {
  if (r.service_type === 'soft_digital') return 'soft';
  if (r.service_type === 'other_operational') return 'other';
  return r.classification === 'consumable' ? 'consumable' : 'trackable';
};

export function rowToRecord(r: ApiServiceRow): ServiceRecord {
  const kind = kindOf(r);
  const provider = r.provider_brand ?? undefined;
  return {
    id: r.id,
    code: r.code,
    kind,
    created: r.created_at,
    status: r.status,
    active: r.status !== 'inactive',
    suppliers: [],
    suppliersCount: Number(r.suppliers_count) || 0,
    supplierNames: r.supplier_names ?? [],
    vals: {
      name: r.name,
      desc: r.description ?? '',
      category: r.category ?? undefined,
      segment: r.segment ?? undefined,
      provider,
      make: provider,
      delivery: r.delivery_type ?? undefined,
      billing: r.billing_frequency ?? undefined,
      dept: r.department ?? undefined,
      hsn: r.hsn_code ?? undefined,
      uom: r.uom ?? undefined,
      condition: r.condition ?? undefined,
      contract: r.contract_required ? 'Required' : 'Not Required',
      otype: kind === 'other' ? ((r.classification ?? 'professional') as OtherType) : undefined,
    },
  };
}

export async function setServiceStatus(id: number, status: 'active' | 'inactive'): Promise<void> {
  await api.patch(`/p2p/services/${id}/status`, { status });
}

interface ApiSupplierRow {
  id: number;
  vendor_id: number;
  vendor_code: string | null;
  vendor_name: string | null;
  supplier_type: string | null;
  origin: 'domestic' | 'international';
  country: string | null;
  state: string | null;
  city: string | null;
  contact_person: string | null;
  currency: string;
  price: number;
  exchange_rate: number | null;
  gst_percentage: number;
  gst_amount: number;
  total_amount: number;
  inr_amount: number;
  status: 'active' | 'inactive';
}

export async function fetchServiceSuppliers(id: number): Promise<MappedSupplier[]> {
  const res = await api.get<{ data: ApiSupplierRow[] }>(`/p2p/services/${id}/suppliers`);
  return (res.data?.data ?? [])
    .filter(s => s.status !== 'inactive')
    .map((s): MappedSupplier => {
      const intl = s.origin === 'international';
      return {
        vendorId: String(s.vendor_id),
        code: s.vendor_code ?? '',
        name: s.vendor_name ?? '',
        type: s.supplier_type ?? '',
        state: (intl ? s.city : s.state) ?? '',
        contact: s.contact_person ?? '',
        country: s.country ?? undefined,
        origin: s.origin,
        currency: s.currency,
        fx: s.exchange_rate ?? undefined,
        price: Number(s.price) || 0,
        gst: Number(s.gst_percentage) || 0,
        gstAmt: Number(s.gst_amount) || 0,
        total: Number(s.total_amount) || 0,
        inr: Number(s.inr_amount) || 0,
      };
    });
}

export const apiError = (e: unknown, fallback: string): string => {
  const d = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
  const first = d?.errors ? Object.values(d.errors)[0]?.[0] : undefined;
  return first || d?.message || fallback;
};
