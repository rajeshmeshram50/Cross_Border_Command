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

const supplierFromApi = (s: ApiSupplierRow): MappedSupplier => {
  const intl = s.origin === 'international';
  return {
    mapId: s.id,
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
};

export async function fetchServiceSuppliers(id: number): Promise<MappedSupplier[]> {
  const res = await api.get<{ data: ApiSupplierRow[] }>(`/p2p/services/${id}/suppliers`);
  return (res.data?.data ?? []).filter(s => s.status !== 'inactive').map(supplierFromApi);
}

export interface BundleVendor {
  id: number;
  vendor_code: string | null;
  company_name: string | null;
  status: string | null;
  supplier_type: string | null;
  origin: 'domestic' | 'international';
  country: string | null;
  state: string | null;
  gst_state_code: string | null;
  city: string | null;
  currency: string | null;
  contact_person: string | null;
}

export interface ServiceBundle {
  service_categories: Array<{ id: number; name: string; service_type: ApiServiceType; classification: string | null }>;
  segments: Array<{ id: number; name: string; regulatory_status?: string | null }>;
  hsn_codes: Array<{ id: number; hsn_code: string; description: string | null }>;
  uom: Array<{ id: number; title: string; short_code: string | null }>;
  haz_class: Array<{ id: number; name: string }>;
  conditions: Array<{ id: number; title: string }>;
  packaging_material: Array<{ id: number; title: string }>;
  departments: Array<{ id: number; name: string; code: string | null }>;
  gst_percentage: Array<{ id: number; percentage: string | number }>;
  delivery_types: string[];
  billing_frequencies: string[];
  haz_types: string[];
  vendors?: BundleVendor[];
  currencies: Array<{ id: number; code: string; name: string; symbol: string | null; exchange_rate: string | number }>;
}

let bundlePromise: Promise<ServiceBundle> | null = null;
export function loadServiceBundle(force = false): Promise<ServiceBundle> {
  if (!bundlePromise || force) {
    const p = api.get<ServiceBundle>('/p2p/services/master-bundle').then(r => r.data);
    p.catch(() => { if (bundlePromise === p) bundlePromise = null; });
    bundlePromise = p;
  }
  return bundlePromise;
}

export async function loadSupplierPool(): Promise<BundleVendor[]> {
  const out: BundleVendor[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await api.get<{ data: BundleVendor[]; last_page: number }>('/p2p/services/supplier-pool', {
      params: { per_page: 100, page },
    });
    out.push(...(res.data?.data ?? []));
    if (page >= (Number(res.data?.last_page) || 1)) break;
  }
  return out;
}

export const segmentReg = (v?: string | null): 'highly' | 'less' | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'high' || s === 'highly') return 'highly';
  if (s === 'low' || s === 'less') return 'less';
  return null;
};

export type Opt = { value: string; label: string; badges?: Array<{ text: string; reg?: string | null }> };

interface ApiDetail {
  id: number;
  code: string;
  created_at: string;
  name: string;
  description: string | null;
  service_type: ApiServiceType;
  classification: string | null;
  category_id: number | null;
  segment_id: number | null;
  hsn_id: number | null;
  uom_id: number | null;
  haz_class_id: number | null;
  condition_id: number | null;
  packaging_id: number | null;
  department_id: number | null;
  provider_brand: string | null;
  delivery_type: string | null;
  haz_type: string | null;
  billing_frequency: string | null;
  gst_id?: number | null;
  gst_percentage: string | number | null;
  contract_required: boolean;
  remark: string | null;
  confidential_info: string | null;
  status: 'draft' | 'active' | 'inactive';
  step_completed: number;
  images?: Array<{ id: number; is_primary: boolean; original_name: string | null; file_path: string }>;
  attachments?: Array<{ id: number; original_name: string | null; file_path?: string; size?: number | null }>;
  suppliers?: ApiSupplierRow[];
}

export interface ExistingImage { id: number; isPrimary: boolean; name: string; path: string }

const toImages = (rows?: ApiDetail['images']): ExistingImage[] =>
  (rows ?? []).map(i => ({ id: i.id, isPrimary: !!i.is_primary, name: i.original_name ?? 'image', path: i.file_path }));

export interface SavedAttachment { id: number; name: string; path: string; size?: number }

const toAttachments = (rows?: ApiDetail['attachments']): SavedAttachment[] =>
  (rows ?? []).filter(a => a.file_path).map(a => ({ id: a.id, name: a.original_name ?? 'attachment', path: a.file_path!, size: a.size ?? undefined }));

export interface ServiceDetail {
  record: ServiceRecord;
  attachments: SavedAttachment[];
  attachmentIds: number[];
  hasPrimaryImage: boolean;
  images: ExistingImage[];
}

export async function loadServiceFile(path: string): Promise<string> {
  const res = await api.get<Blob>('/p2p/files/download', { params: { path }, responseType: 'blob' });
  return URL.createObjectURL(res.data);
}

export async function fetchServiceDetail(id: number): Promise<ServiceDetail> {
  const d = (await api.get<ApiDetail>(`/p2p/services/${id}`)).data;
  const s = (v: number | null | undefined) => (v == null ? undefined : String(v));
  const kind: ServiceKind = d.service_type === 'soft_digital' ? 'soft'
    : d.service_type === 'other_operational' ? 'other'
      : d.classification === 'consumable' ? 'consumable' : 'trackable';
  const gst = d.gst_percentage == null || d.gst_percentage === '' ? undefined : Number(d.gst_percentage);
  const atts = d.attachments ?? [];
  return {
    attachmentIds: atts.map(a => a.id),
    attachments: toAttachments(d.attachments),
    hasPrimaryImage: (d.images ?? []).some(i => i.is_primary),
    images: toImages(d.images),
    record: {
      id: d.id,
      code: d.code,
      kind,
      created: d.created_at,
      status: d.status,
      active: d.status !== 'inactive',
      suppliers: (d.suppliers ?? []).filter(x => x.status !== 'inactive').map(supplierFromApi),
      vals: {
        name: d.name ?? '',
        desc: d.description ?? '',
        provider: d.provider_brand ?? undefined,
        make: d.provider_brand ?? undefined,
        category: s(d.category_id),
        segment: s(d.segment_id),
        hsn: s(d.hsn_id),
        uom: s(d.uom_id),
        dept: s(d.department_id),
        hazClass: s(d.haz_class_id),
        condition: s(d.condition_id),
        packaging: s(d.packaging_id),
        delivery: d.delivery_type ?? undefined,
        billing: d.billing_frequency ?? undefined,
        haz: d.haz_type ?? undefined,
        contract: d.contract_required ? 'Required' : 'Not Required',
        remark: d.remark ?? undefined,
        confidential: d.confidential_info ?? undefined,
        otype: kind === 'other' ? ((d.classification ?? 'professional') as OtherType) : undefined,
        gstPct: gst,
        gstId: d.gst_id != null ? String(d.gst_id) : undefined,
        att: atts[0]?.original_name ?? undefined,
      },
    },
  };
}

export interface CoreFiles { att?: File; img1?: File[]; img2?: File[] }

export async function saveServiceCore(args: {
  id?: number; kind: ServiceKind; vals: ServiceRecord['vals']; files: CoreFiles; replaceAttachmentIds?: number[];
  removeImageIds?: number[];
  removeAttachmentIds?: number[];
}): Promise<{ id: number; code: string; images: ExistingImage[]; attachmentIds: number[]; attachments: SavedAttachment[] }> {
  const { id, kind, vals, files } = args;
  const fd = new FormData();
  const put = (k: string, v: string | number | boolean | null | undefined) => {
    if (v === undefined || v === null) return;
    fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  };
  const type: ApiServiceType = kind === 'soft' ? 'soft_digital' : kind === 'other' ? 'other_operational' : 'self_consumable';
  if (id != null) put('id', id);
  put('service_type', type);
  put('name', vals.name.trim());
  put('description', vals.desc.trim());
  put('hsn_id', vals.hsn);
  put('uom_id', vals.uom);
  put('gst_id', vals.gstId);

  if (type === 'self_consumable') {
    put('classification', kind);
    put('provider_brand', (vals.make ?? '').trim());
    put('segment_id', vals.segment);
    put('haz_type', vals.haz);
    if (vals.haz === 'Hazardous') put('haz_class_id', vals.hazClass);
    put('condition_id', vals.condition);
    put('packaging_id', vals.packaging);
    put('confidential_info', vals.confidential ?? '');
    const primary = files.img1?.[0];
    if (primary) fd.append('primary_image_file', primary);
    (files.img2 ?? []).forEach(f => fd.append('secondary_image_files[]', f));
    (args.removeImageIds ?? []).forEach(i => fd.append('remove_image_ids[]', String(i)));
  } else {
    put('provider_brand', (vals.provider ?? '').trim());
    put('category_id', vals.category);
    put('contract_required', vals.contract === 'Required');
    put('remark', vals.remark ?? '');
    if (type === 'soft_digital') {
      put('segment_id', vals.segment);
      put('delivery_type', vals.delivery);
    } else {
      put('classification', vals.otype ?? 'professional');
      put('department_id', vals.dept);
      put('billing_frequency', vals.billing);
    }
  }
  if (files.att) fd.append('attachment_files[]', files.att);
  const dropAtt = new Set([...(files.att ? args.replaceAttachmentIds ?? [] : []), ...(args.removeAttachmentIds ?? [])]);
  dropAtt.forEach(a => fd.append('remove_attachment_ids[]', String(a)));
  const res = await api.post<ApiDetail>('/p2p/services/step/core', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return {
    id: res.data.id,
    code: res.data.code,
    images: toImages(res.data.images),
    attachmentIds: (res.data.attachments ?? []).map(a => a.id),
    attachments: toAttachments(res.data.attachments),
  };
}

const supplierPayload = (s: MappedSupplier) => {
  const intl = s.origin === 'international';
  return {
    vendor_id: Number(s.vendorId),
    origin: intl ? 'international' : 'domestic',
    price: s.price,
    ...(intl ? { currency: s.currency, exchange_rate: s.fx } : {}),
  };
};

export async function saveServiceSuppliersStep(id: number, suppliers: MappedSupplier[]): Promise<void> {
  await api.put(`/p2p/services/${id}/step/suppliers`, { suppliers: suppliers.map(supplierPayload) });
}

export async function addServiceSupplier(id: number, s: MappedSupplier): Promise<void> {
  await api.post(`/p2p/services/${id}/suppliers`, supplierPayload(s));
}

export async function unmapServiceSupplier(id: number, mapId: number): Promise<void> {
  await api.patch(`/p2p/services/${id}/suppliers/${mapId}/status`, { status: 'inactive' });
}

export const apiError = (e: unknown, fallback: string): string => {
  const d = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
  const first = d?.errors ? Object.values(d.errors)[0]?.[0] : undefined;
  return first || d?.message || fallback;
};

export async function syncServiceSuppliers(id: number, prev: MappedSupplier[], next: MappedSupplier[]): Promise<MappedSupplier[]> {
  const keep = new Set(next.filter(s => s.mapId != null).map(s => s.mapId));
  for (const s of prev) if (s.mapId != null && !keep.has(s.mapId)) await unmapServiceSupplier(id, s.mapId);
  for (const s of next) if (s.mapId == null) await addServiceSupplier(id, s);
  return fetchServiceSuppliers(id);
}

export type ServiceCategoryRow = ServiceBundle['service_categories'][number];

const categoryCache = new Map<string, Promise<ServiceCategoryRow[]>>();
export function loadServiceCategories(type: ApiServiceType, classification?: string, force = false): Promise<ServiceCategoryRow[]> {
  const key = `${type}:${classification ?? ''}`;
  if (!categoryCache.has(key) || force) {
    const p = api.get<Array<ServiceCategoryRow & { status?: string | null }>>('/master/service_categories', {
      params: { service_type: type, status: 'Active', ...(classification ? { classification } : {}) },
    }).then(r => (Array.isArray(r.data) ? r.data : [])
      .map(c => ({ id: c.id, name: c.name, service_type: c.service_type, classification: c.classification ?? null }))
      .sort((x, y) => x.name.localeCompare(y.name)));
    p.catch(() => { if (categoryCache.get(key) === p) categoryCache.delete(key); });
    categoryCache.set(key, p);
  }
  return categoryCache.get(key)!;
}
