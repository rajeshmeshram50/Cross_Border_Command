import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import './product-management.css';
import { readProductMasterBundle, writeProductMasterBundle } from './productBundleCache';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
import AddProductModal from './AddProductModal';
import ProductView from './ProductView';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import Tooltip from '../../../../components/ui/Tooltip';


export type Product = {
  apiId: number;
  id: string;
  name: string;
  genericName: string;
  brand: string;
  segment: string;
  price: number;
  currency: string;
  rating: number;
  reviews: number;
  status: 'Active' | 'Inactive' | 'Draft';
  hsn: string;
  uom: string;
  hazClass: 'HAZ' | 'NON HAZ';
  hazClassName: string;
  gstRate: number;
  condition: string;
  vendors: string[];
  vendorCount: number;
  ownerId: number | null;
  ownerName: string;
  ownerBranchId: number | null;
  ownerBranchName: string;
  createdAt: string;
  stepCompleted: number;
  badge?: 'Best Seller' | 'New' | 'Trending' | 'Top Rated';
  thumb: string;
  images: string[];
};

const THUMB_GRADIENTS = [
  'linear-gradient(135deg,#fef3c7,#fbbf24)',
  'linear-gradient(135deg,#dcfce7,#22c55e)',
  'linear-gradient(135deg,#fef9c3,#eab308)',
  'linear-gradient(135deg,#e0f2fe,#0ea5e9)',
  'linear-gradient(135deg,#fce7f3,#a16207)',
  'linear-gradient(135deg,#fef3c7,#f97316)',
  'linear-gradient(135deg,#fee2e2,#dc2626)',
  'linear-gradient(135deg,#ede9fe,#7c3aed)',
  'linear-gradient(135deg,#fed7aa,#f97316)',
  'linear-gradient(135deg,#1f2937,#374151)',
];

const PRODUCT_ACCENTS = ['#16a34a', '#ca8a04', '#eab308', '#f59e0b', '#65a30d', '#d97706', '#84cc16', '#dc2626', '#22c55e', '#a16207', '#0891b2', '#7c3aed'];

function averageImageColor(img: HTMLImageElement): string | null {
  try {
    const w = 12, h = 12;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return null;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 160) { const f = 160 / lum; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

function formatProductCode(raw: string): string {
  const m = raw.match(/^(.*?)(\d+)\s*$/);
  if (!m) return raw;
  const prefix = m[1] || 'P-';
  return `${prefix}${m[2].padStart(3, '0')}`;
}

function apiToCard(row: Record<string, unknown>): Product {
  const get = <T,>(k: string, fallback: T): T => (row[k] as T) ?? fallback;
  const segObj = row.segment as { title?: string } | null;
  const uomObj = row.uom as { title?: string; short_code?: string } | null;
  const hsnObj = row.hsn as { hsn_code?: string } | null;
  const gstObj = row.gst_percentage as { percentage?: number | string } | null;
  const hazClassObj = row.haz_class as { name?: string } | null;
  const condObj = row.condition as { title?: string } | null;
  const vendorMaps = Array.isArray(row.vendor_maps) ? (row.vendor_maps as { vendor_name?: string }[]) : [];
  const vendorNames = vendorMaps.map(v => v?.vendor_name ?? '').filter(Boolean);
  const creator = row.creator as { id?: number; name?: string; branch_id?: number | null; branch?: { id?: number; name?: string } | null } | null;
  const ownerBranch = creator?.branch ?? null;
  const apiStatus = String(row.status ?? 'draft').toLowerCase();
  const displayStatus: Product['status'] =
    apiStatus === 'active' ? 'Active' : apiStatus === 'inactive' ? 'Inactive' : 'Draft';
  const idNum = Number(row.id) || 0;
  const primaryUrl = (row.primary_image_url as string | null) || (row.primary_image as string | null) || '';
  const secondaryUrls = Array.isArray(row.secondary_images_url)
    ? (row.secondary_images_url as string[])
    : (Array.isArray(row.secondary_images) ? (row.secondary_images as string[]) : []);
  const images = [primaryUrl, ...secondaryUrls].filter(Boolean);
  return {
    apiId: idNum,
    id: formatProductCode(String(row.product_code ?? `P-${idNum}`)),
    name: get('name', ''),
    genericName: get('generic_name', '') as string,
    brand: get('brand', '—') as string,
    segment: segObj?.title ?? '—',
    price: Number(row.total_price ?? row.base_price ?? 0),
    currency: '₹',
    rating: 0,
    reviews: 0,
    status: displayStatus,
    hsn: hsnObj?.hsn_code ?? '—',
    uom: uomObj?.short_code ?? uomObj?.title ?? '—',
    hazClass: String(row.haz_type ?? '').toLowerCase().startsWith('haz') && !String(row.haz_type ?? '').toLowerCase().includes('non') ? 'HAZ' : 'NON HAZ',
    hazClassName: hazClassObj?.name ?? '',
    gstRate: Number(gstObj?.percentage ?? 0),
    condition: condObj?.title ?? '',
    vendors: vendorNames,
    vendorCount: row.vendor_count != null ? Number(row.vendor_count) : vendorMaps.length,
    ownerId: creator?.id ?? null,
    ownerName: creator?.name ?? '',
    ownerBranchId: creator?.branch_id ?? ownerBranch?.id ?? null,
    ownerBranchName: ownerBranch?.name ?? '',
    createdAt: String(row.created_at ?? ''),
    stepCompleted: Number(row.step_completed ?? 0),
    thumb: THUMB_GRADIENTS[idNum % THUMB_GRADIENTS.length],
    images,
  };
}

const SEGMENTS = ['All Segments', 'Dry Fruits', 'Rice & Grains', 'Spices', 'Coconut Oil', 'Seeds', 'Coffee Beans', 'Pulses', 'Mango Pulp', 'Millets', 'Chemicals'];

const HSN_CODES = ['08013100', '10063020', '09103030', '15131100', '12074090', '09011190', '07136000', '08045010', '09042120', '09041110', '10082930', '22072000'];
const CONDITIONS = ['New', 'Refurbished', 'Open Box', 'Second Hand'];

/* Creation date is picked as a relative window, not a calendar range. The keys
   travel to the API as ?created_bucket[]= and OR together there. 'custom' is
   the odd one out: it carries the typed day count and is sent as `last:<n>`. */
const CREATED_BUCKETS: Array<{ key: string; label: string }> = [
  { key: 'last_7',  label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'older',   label: 'Older' },
  { key: 'custom',  label: 'Custom' },
];

/* Inward / invoice counts per product have no API behind them yet, so both
   sections are frozen: fixed default buckets, shown but not selectable. */
const INWARD_BUCKETS  = ['0', '1–5', '6–20', '21+'];
const INVOICE_BUCKETS = ['0', '1–10', '11–50', '51+'];

type FilterState = {
  segment: string[];
  hsn: string[];
  hazClass: string[];
  condition: string[];
  createdBucket: string[];
  /* Days typed into the Custom row; only read while 'custom' is ticked. */
  createdCustomDays: string;
};

const EMPTY_FILTERS: FilterState = {
  segment: [], hsn: [], hazClass: [], condition: [], createdBucket: [], createdCustomDays: '',
};

export default function Products() {
  const { user } = useAuth();
  /* Sales can't see who the supplier is or the purchase price — the mapped
     supplier list stays hidden for them, exactly as on the product detail
     page (the API returns an empty list for Sales anyway). */
  const isSalesDept = (user?.department || '').trim().toLowerCase() === 'sales';
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorFilterId   = searchParams.get('vendor_id');
  const vendorFilterCode = searchParams.get('vendor_code') ?? '';
  const vendorFilterName = searchParams.get('vendor_name') ?? '';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<'active' | 'inactive'>('active');
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('All Segments');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'recent' | 'price-asc' | 'price-desc' | 'rating'>('recent');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  /* Mapped Suppliers is AddProductModal's own popup running in supplier-only
     mode (same entry point ProductView uses), so this page owns no second
     copy of the supplier list or the Map Supplier form. */
  const [supplierOnly, setSupplierOnly] = useState(false);
  /* Which card control is waiting on the modal. The modal fetches the product
     (and, cold, the master bundle) before it can show anything real, so the
     control that was clicked spins until AddProductModal reports ready. */
  const [booting, setBooting] = useState<{ id: number; act: 'Edit' | 'Suppliers' } | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [brefOpen, setBrefOpen] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  /* Which accordion section is expanded in the right-hand drawer — one at a
     time. Segment opens by default: it is the first thing users narrow by. */
  const [openPanel, setOpenPanel] = useState<string | null>('segment');

  const [segmentOpts, setSegmentOpts]   = useState<string[]>(SEGMENTS);
  const [hsnOpts,     setHsnOpts]       = useState<string[]>(HSN_CODES);
  const [conditionOpts, setConditionOpts] = useState<string[]>(CONDITIONS);
  const [hazClassOpts, setHazClassOpts] = useState<string[]>([]);

  useEffect(() => {
    type IdRow = { id: number | string; status?: string | null };
    type Bundle = {
      segments: Array<IdRow & { title?: string | null; name?: string | null }>;
      hsn_codes: Array<IdRow & { hsn_code?: string | null }>;
      uom: Array<IdRow & { title?: string | null; short_code?: string | null }>;
      conditions: Array<IdRow & { title?: string | null }>;
      haz_class: Array<IdRow & { name?: string | null }>;
      gst_percentage: Array<IdRow & { percentage?: number | string | null }>;
      vendors: Array<{ id: number | string; company_name?: string | null }>;
    };

    const dedupe = (arr: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of arr) {
        if (!seen.has(v)) { seen.add(v); out.push(v); }
      }
      return out;
    };

    const applyBundle = (b: Bundle) => {
      const seg  = (b.segments  ?? []).map(r => r.title ?? r.name ?? '').filter(Boolean);
      const hsn  = (b.hsn_codes ?? []).map(r => r.hsn_code ?? '').filter(Boolean);
      const cond = (b.conditions ?? []).map(r => r.title ?? '').filter(Boolean);
      const haz  = (b.haz_class ?? []).map(r => r.name ?? '').filter(Boolean);
      if (seg.length)  setSegmentOpts(dedupe(seg));
      if (hsn.length)  setHsnOpts(dedupe(hsn));
      if (cond.length) setConditionOpts(dedupe(cond));
      if (haz.length)  setHazClassOpts(dedupe(haz));
    };

    (async () => {
      const cached = readProductMasterBundle<Bundle>();
      if (cached) applyBundle(cached);
      try {
        const res = await api.get<Bundle>('/products/master-bundle');
        applyBundle(res.data);
        writeProductMasterBundle(res.data);
      } catch {  }
    })();
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [filterOpen]);

  const toggleMulti = (key: keyof FilterState, value: string) => {
    setFilters(prev => {
      const arr = prev[key] as string[];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  };

  /* Opening a section closes whichever one was open. */
  const togglePanel = (key: string) =>
    setOpenPanel(prev => (prev === key ? null : key));

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    Object.entries(filters).forEach(([key, v]) => {
      // The typed day count belongs to the Custom row, already counted above it.
      if (key === 'createdCustomDays') return;
      if (Array.isArray(v)) n += v.length;
      else if (typeof v === 'string' && v.trim()) n += 1;
    });
    return n;
  }, [filters]);

  type FilterChip = { id: string; group: string; label: string; onRemove: () => void };

  const appliedChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];

    const multi: Array<[keyof FilterState, string]> = [
      ['segment', 'Segment'], ['hsn', 'HSN/SAC'],
      ['hazClass', 'Haz Class'], ['condition', 'Condition'],
    ];
    multi.forEach(([key, group]) => {
      (filters[key] as string[]).forEach(v => {
        out.push({ id: `${key}:${v}`, group, label: v, onRemove: () => toggleMulti(key, v) });
      });
    });

    filters.createdBucket.forEach(key => {
      const bucket = CREATED_BUCKETS.find(b => b.key === key);
      const days = filters.createdCustomDays.trim();
      out.push({
        id: `createdBucket:${key}`,
        group: 'Created',
        label: key === 'custom'
          ? (days ? `Last ${days} days` : 'Custom')
          : (bucket?.label ?? key),
        onRemove: () => toggleMulti('createdBucket', key),
      });
    });
    return out;
  }, [filters]);

  const toolbarChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    if (q.trim())                    out.push({ id: 'q',       group: 'Search',  label: q,            onRemove: () => setQ('') });
    if (segment !== 'All Segments')  out.push({ id: 'segment', group: 'Segment', label: segment,      onRemove: () => setSegment('All Segments') });
    if (statusFilter !== 'All Status') out.push({ id: 'status', group: 'Status',  label: statusFilter, onRemove: () => setStatusFilter('All Status') });
    return out;
  }, [q, segment, statusFilter]);

  const allChips = useMemo(() => [...toolbarChips, ...appliedChips], [toolbarChips, appliedChips]);

  const clearAllFilters = () => {
    setFilters(EMPTY_FILTERS);
    setQ('');
    setSegment('All Segments');
    setStatusFilter('All Status');
  };

  const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  useEffect(() => {
    const id = 'sm-products-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [total, setTotal] = useState(0);

  const [stats, setStats] = useState({ active: 0, inactive: 0 });

  const listParams = useMemo(() => {
    const p: Record<string, string | string[]> = {};
    if (debouncedQ) p.q = debouncedQ;
    if (statusFilter !== 'All Status') p.status = statusFilter.toLowerCase();
    if (vendorFilterId) p.vendor_id = vendorFilterId;

    if (segment !== 'All Segments') p.segment_eq = segment;
    if (filters.segment.length)      p.segment      = filters.segment;
    if (filters.hsn.length)          p.hsn          = filters.hsn;
    if (filters.condition.length)    p.condition    = filters.condition;
    if (filters.hazClass.length)     p.haz_class    = filters.hazClass;
    /* 'custom' only means something once a day count is typed — it leaves as
       last:<n> so the API treats it like any other relative window. */
    const buckets = filters.createdBucket.flatMap(key => {
      if (key !== 'custom') return [key];
      const days = parseInt(filters.createdCustomDays, 10);
      return days > 0 ? [`last:${days}`] : [];
    });
    if (buckets.length) p.created_bucket = buckets;
    return p;
  }, [debouncedQ, segment, statusFilter, filters, vendorFilterId]);

  const listReqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    const token = ++listReqRef.current;
    setLoading(true);
    try {
      const res = await api.get<{ data?: Record<string, unknown>[]; total?: number }>('/products', {
        params: {
          ...listParams,
          supplier: statusTab === 'active' ? 'mapped' : 'zero',
          sort,
          page,
          per_page: pageSize,
        },
      });
      if (token !== listReqRef.current) return;
      const body = res.data ?? {};
      setProducts((Array.isArray(body.data) ? body.data : []).map(apiToCard));
      setTotal(Number(body.total ?? 0) || 0);
    } catch {
      if (token !== listReqRef.current) return;
      setProducts([]);
      setTotal(0);
    } finally {
      if (token === listReqRef.current) setLoading(false);
    }
  }, [allowed, listParams, statusTab, sort, page, pageSize]);

  useEffect(() => { refresh(); }, [refresh]);

  const refreshStats = useCallback(async () => {
    if (!allowed) return;
    try {
      const res = await api.get<{ active?: number; inactive?: number }>('/products/stats', { params: listParams });
      setStats({
        active:   Number(res.data?.active) || 0,
        inactive: Number(res.data?.inactive) || 0,
      });
    } catch {
    }
  }, [allowed, listParams]);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  const reload = useCallback(() => { refresh(); refreshStats(); }, [refresh, refreshStats]);

  useEffect(() => {
    if (detailId == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [detailId]);



  /* Every remaining filter is applied server-side, so the page the API returns
     is already the result set. */
  const visible = products;

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, segment, statusFilter, statusTab, sort, filters, vendorFilterId]);

  const setRowsPerPage = (n: number) => { setPageSize(n); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const paged = visible;

  const resultCount = total;

  if (!allowed) {
    return (
      <div className="prd-root">
        <div className="prd-noaccess">
          <div className="prd-noaccess-icon">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
          </div>
          <div className="prd-noaccess-title">Branch / Employee only</div>
          <div className="prd-noaccess-desc">The Products module is available only to branch users and employees. Ask your branch admin for access.</div>
        </div>
      </div>
    );
  }

  const handleSaved = (_productId: number, _finalised: boolean) => {
    reload();
  };

  const handleEdit = (p: Product) => {
    setSupplierOnly(false);
    setBooting({ id: p.apiId, act: 'Edit' });
    setEditingId(p.apiId);
    setAddOpen(true);
  };

  /* "N Suppliers" on a card → the Mapped Suppliers popup for that product. */
  const handleSuppliers = (p: Product) => {
    setSupplierOnly(true);
    setBooting({ id: p.apiId, act: 'Suppliers' });
    setEditingId(p.apiId);
    setAddOpen(true);
  };

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = (p: Product) => {
    setDeleteTarget(p);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/products/${deleteTarget.apiId}`);
      toast.success('Deleted', `${deleteTarget.name} moved to deleted state`);
      setDeleteTarget(null);
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Please try again';
      toast.error('Delete failed', msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="prd-root">

      <div className="prd-hero">
        <span className="prd-hero-accent" />
        <span className="prd-hero-glow" />
        <span className="prd-hero-sheen" />
        <div className="prd-hero-left">
          <div className="prd-hero-avatar-wrap">
            <div className="prd-hero-avatar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
            </div>
            <span className="prd-hero-dot" />
          </div>
          <div className="min-w-0">
            <div className="prd-hero-title">Product Management</div>
            <div className="prd-hero-sub">Create and manage products with pricing, compliance, quality controls, and supplier mapping for procurement and sales readiness.</div>
          </div>
        </div>
        <button type="button" className="prd-hero-btn" onClick={() => { setEditingId(null); setAddOpen(true); }}>
          <span className="prd-hero-btn-sheen" />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add Product
        </button>
      </div>

      <div className={`prd-bref ${brefOpen ? '' : 'is-collapsed'}`}>
        <div className="prd-bref-head" onClick={() => setBrefOpen(o => !o)}>
          <div className="prd-bref-head-ico">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
          </div>
          <div className="prd-bref-head-mid">
            <div className="prd-bref-head-row">
              <div className="prd-bref-head-label">Product Management</div>
              <div className="prd-bref-head-sep" />
              <div className="prd-bref-head-title">What We Are Doing Here</div>
            </div>
            <div className="prd-bref-head-sub">Manage product master records, pricing, compliance requirements, quality standards, and supplier mapping to ensure procurement, sales, and operational readiness.</div>
          </div>
          <div className="prd-bref-head-right">
            <div className="prd-bref-toggle">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
        </div>
        <div className="prd-bref-body">
          {[
            { svg: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>, num: 'Step 01', title: 'Product Registration',          desc: 'Create and manage product master records.' },
            { svg: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>, num: 'Step 02', title: 'Pricing & Sales Configuration',  desc: 'Configure pricing, GST, and sales details.' },
            { svg: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>, num: 'Step 03', title: 'Quality & Compliance Management', desc: 'Manage quality and regulatory requirements.' },
            { svg: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>, num: 'Step 04', title: 'Supplier Mapping & Sourcing',     desc: 'Link products with approved suppliers.' },
            { svg: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>, num: 'Step 05', title: 'Product Readiness & Activation',  desc: 'Approve products for operational use.' },
          ].map((s) => (
            <div className="prd-bref-item" key={s.num}>
              <div className="prd-bref-item-top">
                <div className="prd-bref-item-ico">{s.svg}</div>
                <span className="prd-bref-item-num">{s.num}</span>
              </div>
              <div className="prd-bref-item-title">{s.title}</div>
              <div className="prd-bref-item-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="prd-panel">
      <div className="prd-toolbar">
        <div className="prd-tabs">
          <button
            type="button"
            className={`prd-tab ${statusTab === 'active' ? 'is-active' : ''}`}
            onClick={() => setStatusTab('active')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            <span className="prd-tab-label">Supplier Mapped Products</span>
            <span className="prd-tab-badge prd-tab-badge--active"><span className="prd-tab-badge-dot" />Active<span className="prd-tab-badge-count">{stats.active}</span></span>
          </button>
          <button
            type="button"
            className={`prd-tab ${statusTab === 'inactive' ? 'is-active' : ''}`}
            onClick={() => setStatusTab('inactive')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /><line x1="3.5" y1="20.5" x2="20.5" y2="3.5" /></svg>
            <span className="prd-tab-label">Zero Supplier Products</span>
            <span className="prd-tab-badge prd-tab-badge--inactive"><span className="prd-tab-badge-dot" />Inactive<span className="prd-tab-badge-count">{stats.inactive}</span></span>
          </button>
        </div>
        <div className="prd-toolbar-find">
        <div className="prd-search">
          <svg className="prd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="text"
            placeholder="Search products by code, name, HSN or segment…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button type="button" className="prd-search-clear" title="Clear search" onClick={() => setQ('')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        <div className="prd-filter-wrap">
          <button
            type="button"
            className={`prd-filter-btn ${filterOpen ? 'is-active' : ''}`}
            onClick={() => setFilterOpen(o => !o)}
            aria-label="Open filters"
            title="Open filters"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            <span>Filter</span>
            {activeFilterCount > 0 && <span className="prd-filter-badge">{activeFilterCount}</span>}
          </button>
        </div>
        </div>
      </div>

      {vendorFilterId && (
        <div className="prd-vendor-banner">
          <i className="ri-links-line" />
          <span className="prd-vendor-banner-text">
            Showing products mapped to supplier
            {' '}<strong>{vendorFilterCode || `#${vendorFilterId}`}</strong>
            {vendorFilterName && <> — <strong>{vendorFilterName}</strong></>}
          </span>
          <button
            type="button"
            className="prd-vendor-banner-clear"
            onClick={() => setSearchParams({})}
          >
            <i className="ri-close-line" />
            Clear filter
          </button>
        </div>
      )}

      {allChips.length > 0 && (
        <div className="prd-meta">
          <span className="prd-meta-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            Applied
            <span className="prd-meta-label-n">{allChips.length}</span>
          </span>
          {allChips.map(chip => (
            <span key={chip.id} className="prd-meta-chip">
              <span className="prd-meta-chip-g">{chip.group}</span>
              <strong>{chip.label}</strong>
              <button
                type="button"
                className="prd-meta-chip-x"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.group} filter ${chip.label}`}
                title={`Remove ${chip.group}: ${chip.label}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </span>
          ))}
          <button type="button" className="prd-meta-clear" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {loading ? (
        view === 'grid' ? (
          <div className="prd-grid">
            {Array.from({ length: 8 }).map((_, i) => <ProductCardShimmer key={i} />)}
          </div>
        ) : (
          <div className="prd-list">
            {Array.from({ length: 6 }).map((_, i) => <ProductRowShimmer key={i} />)}
          </div>
        )
      ) : paged.length === 0 ? (
        <div className="prd-empty">
          <div className="prd-empty-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          </div>
          <div className="prd-empty-title">
            {vendorFilterId ? 'No products mapped to this supplier yet' : 'No products found'}
          </div>
          <div className="prd-empty-desc">
            {vendorFilterId
              ? `Open any product and map ${vendorFilterCode || 'this supplier'} on Step 2 — or clear the filter to browse all products.`
              : 'Try clearing filters, or click "Add Product" to create a new one.'}
          </div>
          {vendorFilterId && (
            <button
              type="button"
              className="prd-empty-cta"
              onClick={() => setSearchParams({})}
            >
              <i className="ri-close-line" /> Clear filter
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        <>
          <div className="prd-grid" ref={resultsRef}>
            {paged.map(p => (
              <ProductCard
                key={p.apiId}
                product={p}
                canViewSuppliers={!isSalesDept}
                busyAction={booting?.id === p.apiId ? booting.act : null}
                onAction={(act) => {
                  if (act === 'View')            setDetailId(p.apiId);
                  else if (act === 'Edit')       handleEdit(p);
                  else if (act === 'Suppliers')  handleSuppliers(p);
                  else if (act === 'Delete')     handleDelete(p);
                  else                           toast.info(act, `${act}: ${p.name}`);
                }}
              />
            ))}
          </div>
          <ProductPagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} onPage={setPage} onRowsPerPage={setRowsPerPage} />
        </>
      ) : (
        <>
          <div className="prd-list" ref={resultsRef}>
            {paged.map(p => (
              <ProductRow
                key={p.apiId}
                product={p}
                canViewSuppliers={!isSalesDept}
                busyAction={booting?.id === p.apiId ? booting.act : null}
                onAction={(act) => {
                  if (act === 'View')            setDetailId(p.apiId);
                  else if (act === 'Edit')       handleEdit(p);
                  else if (act === 'Suppliers')  handleSuppliers(p);
                  else if (act === 'Delete')     handleDelete(p);
                  else                           toast.info(act, `${act}: ${p.name}`);
                }}
              />
            ))}
          </div>
          <ProductPagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} onPage={setPage} onRowsPerPage={setRowsPerPage} />
        </>
      )}
      </div>

      {addOpen && (
        <AddProductModal
          productId={editingId}
          supplierOnly={supplierOnly}
          onReady={() => setBooting(null)}
          onClose={() => { setAddOpen(false); setEditingId(null); setSupplierOnly(false); setBooting(null); }}
          onSaved={(id, finalised) => {
            handleSaved(id, finalised);
            if (finalised) { setAddOpen(false); setEditingId(null); setSupplierOnly(false); setBooting(null); }
            else           { setEditingId(id); }
          }}
        />
      )}

      {detailId != null && createPortal((
        <div className="prd-detail-overlay">
          <div className="prd-detail-modal">
            <ProductView
              productId={detailId}
              onClose={() => { setDetailId(null); reload(); }}
            />
          </div>
        </div>
      ), document.body)}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        itemName={deleteTarget?.name}
        title="Delete Product"
        subMessage="This action moves the product to the deleted state. Its supplier mappings and QC records remain linked and can be restored if you bring the product back."
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
      />

      {createPortal((
        <>
      <div
        className={`prd-filter-overlay ${filterOpen ? 'open' : ''}`}
        onClick={() => setFilterOpen(false)}
        aria-hidden={!filterOpen}
      />
      <aside className={`prd-filter-drawer ${filterOpen ? 'open' : ''}`} aria-hidden={!filterOpen}>
        <div className="prd-filter-head">
          <span className="prd-filter-head-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </span>
          <div className="prd-filter-head-titles">
            <div className="prd-filter-head-title">Filters</div>
            <div className="prd-filter-head-sub">
              {activeFilterCount === 0
                ? 'No filters applied'
                : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied`}
            </div>
          </div>
          <div className="prd-filter-head-actions">
            <button
              type="button"
              className="prd-filter-clear-all"
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
            >
              Clear All
            </button>
            <button
              type="button"
              className="prd-filter-icon-btn close"
              onClick={() => setFilterOpen(false)}
              aria-label="Close filters"
              title="Close"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {(() => {
          const counts: Record<string, number> = {
            segment: filters.segment.length,
            hsn: filters.hsn.length,
            hazClass: filters.hazClass.length,
            condition: filters.condition.length,
            createdDate: filters.createdBucket.length,
          };

          const renderOptions = (key: string): ReactNode => {
            switch (key) {
              case 'segment':
                return segmentOpts.filter(s => s !== 'All Segments').map(v => (
                  <CheckRow key={v} label={v} checked={filters.segment.includes(v)} onChange={() => toggleMulti('segment', v)} />
                ));

              case 'hsn':
                return hsnOpts.map(v => (
                  <CheckRow key={v} label={v} checked={filters.hsn.includes(v)} onChange={() => toggleMulti('hsn', v)} />
                ));

              case 'hazClass':
                return hazClassOpts.length === 0
                  ? <div className="prd-filter-empty">No haz classifications available</div>
                  : hazClassOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.hazClass.includes(v)} onChange={() => toggleMulti('hazClass', v)} />
                  ));

              case 'condition':
                return conditionOpts.map(v => (
                  <CheckRow key={v} label={v} checked={filters.condition.includes(v)} onChange={() => toggleMulti('condition', v)} />
                ));

              case 'createdDate':
                return (<>
                  {CREATED_BUCKETS.map(b => (
                    <CheckRow
                      key={b.key}
                      label={b.label}
                      checked={filters.createdBucket.includes(b.key)}
                      onChange={() => {
                        toggleMulti('createdBucket', b.key);
                        // Leaving Custom drops the day count with it.
                        if (b.key === 'custom' && filters.createdBucket.includes('custom')) {
                          setFilters(prev => ({ ...prev, createdCustomDays: '' }));
                        }
                      }}
                    />
                  ))}
                  {filters.createdBucket.includes('custom') && (
                    <div className="prd-filter-days">
                      <span>Last</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={filters.createdCustomDays}
                        placeholder="e.g. 10"
                        aria-label="Number of days"
                        autoFocus
                        onChange={e => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setFilters(prev => ({ ...prev, createdCustomDays: digits }));
                        }}
                      />
                      <span>days</span>
                    </div>
                  )}
                </>);

              case 'inwardCount':
                return <FrozenRows options={INWARD_BUCKETS} />;

              case 'invoiceCount':
                return <FrozenRows options={INVOICE_BUCKETS} />;

              default:
                return null;
            }
          };

          return (
            <div className="prd-filter-body">
              {CATEGORY_ORDER.map(k => {
                const m = PANEL_META[k];
                const c = counts[k] ?? 0;
                const open = openPanel === k;
                return (
                  <section key={k} className={`prd-filter-panel ${open ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="prd-filter-panel-head"
                      onClick={() => togglePanel(k)}
                      aria-expanded={open}
                    >
                      <span className="prd-fp-icon" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{m.path}</svg>
                      </span>
                      <span className="prd-fp-titles">
                        <span className="prd-filter-panel-label">{CATEGORY_LABELS[k]}</span>
                        <span className="prd-fp-sub">{m.sub}</span>
                      </span>
                      <span className="prd-filter-panel-right">
                        {c > 0 && <span className="prd-filter-panel-count">{c}</span>}
                        <svg className="prd-filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </button>
                    <div className="prd-fp-collapse" data-open={open ? 1 : 0}>
                      <div className="prd-fp-collapse-inner">
                        <div className="prd-filter-panel-body">{open && renderOptions(k)}</div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          );
        })()}

        <div className="prd-filter-footer">
          <button className="prd-fbtn ghost" onClick={resetFilters}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            Reset
          </button>
          <button className="prd-fbtn primary" onClick={() => setFilterOpen(false)}>
            Show Results ({resultCount})
          </button>
        </div>
      </aside>
        </>
      ), document.body)}
    </div>
  );
}

const PANEL_META: Record<string, { sub: string; path: ReactNode }> = {
  segment:      { sub: 'Choose segment',           path: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></> },
  hsn:          { sub: 'Enter HSN / SAC code',     path: <><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></> },
  hazClass:     { sub: 'Select classification',    path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
  condition:    { sub: 'Select condition',         path: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></> },
  createdDate:  { sub: 'Choose a time window',     path: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></> },
  inwardCount:  { sub: 'Default buckets (frozen)', path: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></> },
  invoiceCount: { sub: 'Default buckets (frozen)', path: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></> },
};

const CATEGORY_ORDER = ['segment', 'hsn', 'hazClass', 'condition', 'createdDate', 'inwardCount', 'invoiceCount'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  segment: 'Product Segment', hsn: 'HSN / SAC Code', hazClass: 'Haz Classification',
  condition: 'Product Condition', createdDate: 'Product Creation Date',
  inwardCount: 'Inward Count Per Product', invoiceCount: 'Invoice Count Per Product',
};

/* Read-only bucket list for a section that has no API behind it yet. */
function FrozenRows(props: { options: string[] }) {
  return (
    <>
      {props.options.map(v => (
        <label key={v} className="prd-filter-row is-frozen">
          <input type="checkbox" checked={false} disabled readOnly />
          <span className="prd-filter-row-txt">{v}</span>
        </label>
      ))}
      <div className="prd-filter-empty">Default buckets — not connected to product data yet.</div>
    </>
  );
}

function CheckRow(props: { label: string; checked: boolean; onChange: () => void }) {
  const long = props.label.length > 28;
  const span = <span className="prd-filter-row-txt">{props.label}</span>;
  return (
    <label className="prd-filter-row">
      <input type="checkbox" checked={props.checked} onChange={props.onChange} />
      {long ? <Tooltip label={props.label}>{span}</Tooltip> : span}
    </label>
  );
}

const ROWS_PER_PAGE_OPTIONS = [8, 12, 16, 24, 48];
const DEFAULT_PAGE_SIZE = 12;

function ProductPagination(props: {
  page: number; totalPages: number; pageSize: number; total: number;
  onPage: (p: number) => void; onRowsPerPage: (n: number) => void;
}) {
  const { page, totalPages, pageSize, total, onPage, onRowsPerPage } = props;
  const startIdx = (page - 1) * pageSize;
  const rowOptions = [...new Set([pageSize, ...ROWS_PER_PAGE_OPTIONS])].sort((a, b) => a - b);

  return (
    <div className="prd-pagination">
      <span className="prd-pag-info">
        {total === 0
          ? 'No products found'
          : <>Showing <span className="prd-hl">{startIdx + 1}–{Math.min(startIdx + pageSize, total)}</span> of <span className="prd-hl">{total}</span></>}
      </span>
      <div className="prd-pag-right">
        <div className="prd-rows-sel">
          Rows per page:
          <select value={pageSize} onChange={e => onRowsPerPage(parseInt(e.target.value, 10))}>
            {rowOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <span className="prd-pag-range">{page} / {totalPages}</span>
        <div className="prd-page-nav">
          <button className="prd-pg-btn" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} aria-label="Previous page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="prd-pg-btn" disabled={page >= totalPages || total === 0} onClick={() => onPage(Math.min(totalPages, page + 1))} aria-label="Next page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductCard(props: {
  product: Product;
  canViewSuppliers?: boolean;
  /** Which of this card's controls is waiting on its modal, if any. */
  busyAction?: 'Edit' | 'Suppliers' | null;
  onAction: (label: string) => void;
}) {
  const { product, onAction, canViewSuppliers = true, busyAction = null } = props;
  const editBusy = busyAction === 'Edit';
  const supBusy  = busyAction === 'Suppliers';
  const [imgOk, setImgOk] = useState(true);
  const [segColor, setSegColor] = useState<string | null>(null);
  const accent = PRODUCT_ACCENTS[product.apiId % PRODUCT_ACCENTS.length];
  const img = product.images[0] || '';
  const isActive = product.vendorCount > 0;
  const suppliers = product.vendorCount;
  const showImg = !!img && imgOk;

  return (
    <div className="prd-pcard" style={{ '--acc': accent } as CSSProperties}>
      <div className="prd-pcard-thumb" onClick={() => onAction('View')} style={{ cursor: 'pointer' }}>
        {showImg ? (
          <img className="prd-pcard-img" src={img} alt={product.name} loading="lazy" onError={() => setImgOk(false)} onLoad={(e) => setSegColor(averageImageColor(e.currentTarget))} />
        ) : (
          <span className="prd-pcard-thumb-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
          </span>
        )}
        <span className="prd-pcard-thumb-grad" />
        {(() => {
          const seg = product.segment ?? '';
          const short = seg.length > 30 ? `${seg.slice(0, 30)}…` : seg;
          const badge = (
            <span className="prd-pcard-thumb-seg" style={segColor ? { background: segColor } : undefined}>{short}</span>
          );
          return seg.length > 30 ? <Tooltip label={seg}>{badge}</Tooltip> : badge;
        })()}
        <span className={`prd-pcard-status prd-pcard-status--${isActive ? 'active' : 'inactive'}`}>
          <span className="prd-pcard-status-dot" />{isActive ? 'Active' : 'Inactive'}
        </span>
        <Tooltip label={editBusy ? 'Opening edit form...' : 'Edit product'}>
          <button
            type="button"
            className={`prd-pcard-edit${editBusy ? ' is-busy' : ''}`}
            aria-label="Edit product"
            aria-busy={editBusy}
            disabled={busyAction != null}
            onClick={(e) => { e.stopPropagation(); onAction('Edit'); }}
          >
            {editBusy
              ? <span className="prd-btn-spinner" />
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>}
          </button>
        </Tooltip>
      </div>

      <div className="prd-pcard-body">
        <Tooltip label={`${product.id} | ${product.name}`}>
          <div className="prd-pcard-title" onClick={() => onAction('View')} style={{ cursor: 'pointer' }}>
            <span className="prd-pcard-code">{product.id}</span>
            <span className="prd-pcard-sep">|</span>
            {product.name}
          </div>
        </Tooltip>

        <div className="prd-pcard-info">
          <span className="prd-pcard-info-item"><span className="prd-pcard-info-k">HSN</span><span className="prd-pcard-info-v">{product.hsn}</span></span>
          <span className="prd-pcard-info-div" />
          <span className="prd-pcard-info-item"><span className="prd-pcard-info-k">GST</span><span className="prd-pcard-info-v">{product.gstRate}%</span></span>
          <span className="prd-pcard-info-div" />
          {canViewSuppliers ? (
            <Tooltip label={supBusy ? 'Opening mapped suppliers...' : suppliers > 0 ? 'View mapped suppliers' : 'Map a supplier to this product'}>
              <button
                type="button"
                className={`prd-pcard-info-item prd-pcard-info-item--supplier prd-pcard-info-item--link${supBusy ? ' is-busy' : ''}`}
                aria-busy={supBusy}
                disabled={busyAction != null}
                onClick={(e) => { e.stopPropagation(); onAction('Suppliers'); }}
              >
                {supBusy
                  ? <span className="prd-btn-spinner" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>}
                {suppliers} Supplier{suppliers !== 1 ? 's' : ''}
              </button>
            </Tooltip>
          ) : (
            <span className="prd-pcard-info-item prd-pcard-info-item--supplier">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
              {suppliers} Supplier{suppliers !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="prd-pcard-line3">
          {product.hazClass === 'HAZ' ? (
            <Tooltip label={product.hazClassName ? `Hazardous: ${product.hazClassName}` : 'Hazardous'}>
            <span className="prd-pcard-haz prd-pcard-haz--yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <span className="prd-pcard-haz-txt">{product.hazClassName ? `Hazardous: ${product.hazClassName}` : 'Hazardous'}</span>
            </span>
            </Tooltip>
          ) : (
            <Tooltip label="Non-Hazardous">
            <span className="prd-pcard-haz prd-pcard-haz--no">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span className="prd-pcard-haz-txt">Non-Hazardous</span>
            </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="prd-pcard-foot">
        <button type="button" className="prd-pcard-cta prd-pcard-cta--wish" onClick={() => onAction('Wishlist')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          Add to Wishlist
        </button>
        <button type="button" className="prd-pcard-cta prd-pcard-cta--cart" onClick={() => onAction('Cart')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1.4" /><circle cx="19" cy="21" r="1.4" /><path d="M2.5 3h2.2l2.6 12.6a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.6-1.25l1.6-7.55H6" /></svg>
          Add to Cart
        </button>
      </div>
    </div>
  );
}

function ProductRow(props: {
  product: Product;
  canViewSuppliers?: boolean;
  busyAction?: 'Edit' | 'Suppliers' | null;
  onAction: (label: string) => void;
}) {
  const { product, onAction, canViewSuppliers = true, busyAction = null } = props;
  const editBusy = busyAction === 'Edit';
  const supBusy  = busyAction === 'Suppliers';
  return (
    <div
      className="prd-row prd-card-clickable"
      role="link"
      tabIndex={0}
      onClick={() => onAction('View')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAction('View'); } }}
    >
      <div className="prd-row-thumb" style={{ background: product.images.length ? '#f5f3ff' : product.thumb }}>
        {product.images.length ? (
          <img src={product.images[0]} alt={product.name} className="prd-row-thumb-img" draggable={false} />
        ) : (
          product.name.charAt(0).toUpperCase()
        )}
      </div>
      <div className="prd-row-info">
        <button className="prd-card-title-link" onClick={(e) => { e.stopPropagation(); onAction('View'); }}>
          <span className="prd-card-id-inline">{product.id}</span>
          <span className="prd-card-id-sep">|</span>
          <span className="prd-card-name-inline">{product.name}</span>
        </button>
        <div className="prd-card-info-row">
          <span className="prd-card-info-cell"><span className="prd-card-info-key">HSN/SAC:</span><span className="prd-card-info-val">{product.hsn}</span></span>
          <span className="prd-card-info-cell"><span className="prd-card-info-key">GST:</span><span className="prd-card-info-val">{product.gstRate}%</span></span>
          {canViewSuppliers ? (
            <Tooltip label={supBusy ? 'Opening mapped suppliers...' : product.vendorCount > 0 ? 'View mapped suppliers' : 'Map a supplier to this product'}>
              <button
                type="button"
                className={`prd-card-info-cell prd-card-vendor-cell prd-card-vendor-cell--link${supBusy ? ' is-busy' : ''}`}
                aria-busy={supBusy}
                disabled={busyAction != null}
                onClick={(e) => { e.stopPropagation(); onAction('Suppliers'); }}
              >
                {supBusy ? <span className="prd-btn-spinner" /> : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                )}
                <span>{product.vendorCount}</span>
              </button>
            </Tooltip>
          ) : (
            <span className="prd-card-info-cell prd-card-vendor-cell">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{product.vendorCount}</span>
            </span>
          )}
          <span className={`prd-card-haz-pill ${product.hazClass === 'HAZ' ? 'is-haz' : 'is-nonhaz'}`}>
            {product.hazClass === 'HAZ' ? 'HAZ' : 'Non-Haz'}
          </span>
          {product.hazClass === 'HAZ' && product.hazClassName && (
            <span className="prd-card-haz-class">
              <span className="prd-card-haz-class-val">{product.hazClassName}</span>
            </span>
          )}
        </div>
      </div>
      <div className="prd-row-status">
      </div>
      <div className="prd-row-price">
        <div className="prd-card-price-label">Selling Price</div>
        <div className="prd-card-price">{product.currency}{product.price.toLocaleString()}</div>
      </div>
      <div className="prd-row-actions">
        <button className="prd-card-hover-btn" onClick={(e) => { e.stopPropagation(); onAction('View'); }}>View</button>
        <button
          className={`prd-card-hover-btn primary${editBusy ? ' is-busy' : ''}`}
          aria-busy={editBusy}
          disabled={busyAction != null}
          onClick={(e) => { e.stopPropagation(); onAction('Edit'); }}
        >
          {editBusy && <span className="prd-btn-spinner" />}Edit
        </button>
        <Tooltip label="Delete product">
          <button className="prd-card-hover-btn danger" aria-label="Delete product" onClick={(e) => { e.stopPropagation(); onAction('Delete'); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ProductCardShimmer() {
  return (
    <div className="prd-card prd-card-shimmer">
      <div className="prd-card-thumb prd-shim-thumb" />
      <div className="prd-card-body">
        <div className="prd-shim-bar" style={{ width: '70%' }} />
        <div className="prd-shim-bar" style={{ width: '55%', height: 10 }} />
        <div className="prd-shim-row">
          <div className="prd-shim-pill" />
          <div className="prd-shim-pill" />
        </div>
        <div className="prd-card-buyrow">
          <div className="prd-shim-bar" style={{ width: 90, height: 18 }} />
        </div>
      </div>
    </div>
  );
}

function ProductRowShimmer() {
  return (
    <div className="prd-row prd-card-shimmer">
      <div className="prd-row-thumb prd-shim-thumb" />
      <div className="prd-row-info">
        <div className="prd-shim-bar" style={{ width: '60%', marginBottom: 6 }} />
        <div className="prd-shim-bar" style={{ width: '40%', height: 10 }} />
      </div>
      <div className="prd-shim-bar" style={{ width: 80, height: 18 }} />
      <div className="prd-shim-bar" style={{ width: 120, height: 18 }} />
      <div className="prd-shim-row">
        <div className="prd-shim-pill" />
        <div className="prd-shim-pill" />
      </div>
    </div>
  );
}