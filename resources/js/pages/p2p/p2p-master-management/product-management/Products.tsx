import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import './product-management.css';
import { readProductMasterBundle, writeProductMasterBundle } from './productBundleCache';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
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

const GST_RATES = ['0%', '5%', '12%', '18%', '28%'];
const HSN_CODES = ['08013100', '10063020', '09103030', '15131100', '12074090', '09011190', '07136000', '08045010', '09042120', '09041110', '10082930', '22072000'];
const HAZ_TYPES = ['HAZ', 'NON HAZ'];
const UOMS = ['Kg', 'L', 'g', 'mL', 'Pcs', 'Box', 'Tonne'];
const CONDITIONS = ['New', 'Refurbished', 'Open Box', 'Second Hand'];
const VENDORS = ['GreenHarvest', 'Shree Exports', 'Sun Agri', 'MJ Foods', 'BrightHarvest', 'Eastern Harvest', 'Delta Agro', 'Apex Foods', 'Spice Route', 'Bharat Agro', 'SunGrow'];
const SCORE_RANGES = ['0 – 1', '1 – 2', '2 – 3', '3 – 4', '4 – 5'];
const TOP_PRODUCTS = ['Top 10', 'Top 25', 'Top 50', 'Top 100'];
const INWARD_BUCKETS = ['0 – 50', '51 – 200', '201 – 500', '501 – 1000', '1000+'];

type FilterState = {
  gstRate: string[];
  segment: string[];
  hsn: string[];
  hazType: string[];
  hazClass: string[];
  uom: string[];
  condition: string[];
  vendor: string[];
  scoreRange: string[];
  topProducts: string;
  createdFrom: string;
  createdTo: string;
  productOwner: string[];
  inwardCount: string[];
};

const EMPTY_FILTERS: FilterState = {
  gstRate: [], segment: [], hsn: [], hazType: [], hazClass: [], uom: [], condition: [],
  vendor: [], scoreRange: [], topProducts: '', createdFrom: '', createdTo: '',
  productOwner: [], inwardCount: [],
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
  const [activeCategory, setActiveCategory] = useState<string>('gstRate');

  const [segmentOpts, setSegmentOpts]   = useState<string[]>(SEGMENTS);
  const [hsnOpts,     setHsnOpts]       = useState<string[]>(HSN_CODES);
  const [uomOpts,     setUomOpts]       = useState<string[]>(UOMS);
  const [conditionOpts, setConditionOpts] = useState<string[]>(CONDITIONS);
  const [hazClassOpts, setHazClassOpts] = useState<string[]>([]);
  const [vendorOpts,  setVendorOpts]    = useState<string[]>(VENDORS);
  const [gstRateOpts, setGstRateOpts]   = useState<string[]>(GST_RATES);
  type OwnerOpt = { id: number; name: string; branchId: number | null; branchName: string };
  const [ownerOpts, setOwnerOpts] = useState<OwnerOpt[]>([]);

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
      const uom  = (b.uom       ?? []).map(r => r.short_code ?? r.title ?? '').filter(Boolean);
      const cond = (b.conditions ?? []).map(r => r.title ?? '').filter(Boolean);
      const haz  = (b.haz_class ?? []).map(r => r.name ?? '').filter(Boolean);
      const gst  = (b.gst_percentage ?? [])
        .map(r => r.percentage != null ? `${r.percentage}%` : '')
        .filter(Boolean);
      const ven  = (b.vendors ?? []).map(v => v.company_name ?? '').filter(Boolean);
      if (seg.length)  setSegmentOpts(dedupe(seg));
      if (hsn.length)  setHsnOpts(dedupe(hsn));
      if (uom.length)  setUomOpts(dedupe(uom));
      if (cond.length) setConditionOpts(dedupe(cond));
      if (haz.length)  setHazClassOpts(dedupe(haz));
      if (gst.length)  setGstRateOpts(dedupe(gst).sort((a, b) => parseFloat(a) - parseFloat(b)));
      if (ven.length)  setVendorOpts(dedupe(ven));
    };

    (async () => {
      const cached = readProductMasterBundle<Bundle>();
      if (cached) applyBundle(cached);
      try {
        const res = await api.get<Bundle>('/products/master-bundle');
        applyBundle(res.data);
        writeProductMasterBundle(res.data);
      } catch {  }

      try {
        type OwnerRow = { id: number; name: string; branch_id: number | null; branch_name: string | null };
        const res = await api.get<{ data?: OwnerRow[] }>('/products/owners');
        const rows = Array.isArray(res.data?.data) ? res.data!.data! : [];
        setOwnerOpts(rows.map(r => ({
          id:           r.id,
          name:         r.name,
          branchId:     r.branch_id,
          branchName:   r.branch_name ?? '',
        })));
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

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    Object.entries(filters).forEach(([, v]) => {
      if (Array.isArray(v)) n += v.length;
      else if (typeof v === 'string' && v.trim()) n += 1;
    });
    return n;
  }, [filters]);

  type FilterChip = { id: string; group: string; label: string; onRemove: () => void };

  const appliedChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];

    const multi: Array<[keyof FilterState, string]> = [
      ['gstRate', 'GST Rate'], ['segment', 'Segment'], ['hsn', 'HSN/SAC'],
      ['hazType', 'Hazard'], ['hazClass', 'Haz Class'], ['uom', 'UOM'],
      ['condition', 'Condition'], ['vendor', 'Supplier'],
      ['scoreRange', 'Score'], ['inwardCount', 'Inward'],
    ];
    multi.forEach(([key, group]) => {
      (filters[key] as string[]).forEach(v => {
        out.push({ id: `${key}:${v}`, group, label: v, onRemove: () => toggleMulti(key, v) });
      });
    });

    filters.productOwner.forEach(id => {
      const owner = ownerOpts.find(o => String(o.id) === id);
      out.push({
        id: `productOwner:${id}`,
        group: 'Owner',
        label: owner?.name ?? `#${id}`,
        onRemove: () => toggleMulti('productOwner', id),
      });
    });

    if (filters.topProducts) {
      out.push({ id: 'topProducts', group: 'Top', label: filters.topProducts, onRemove: () => setFilters(p => ({ ...p, topProducts: '' })) });
    }
    if (filters.createdFrom) {
      out.push({ id: 'createdFrom', group: 'Created from', label: filters.createdFrom, onRemove: () => setFilters(p => ({ ...p, createdFrom: '' })) });
    }
    if (filters.createdTo) {
      out.push({ id: 'createdTo', group: 'Created to', label: filters.createdTo, onRemove: () => setFilters(p => ({ ...p, createdTo: '' })) });
    }
    return out;
  }, [filters, ownerOpts]);

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
    if (filters.uom.length)          p.uom          = filters.uom;
    if (filters.condition.length)    p.condition    = filters.condition;
    if (filters.hazClass.length)     p.haz_class    = filters.hazClass;
    if (filters.hazType.length)      p.haz_type     = filters.hazType;
    if (filters.gstRate.length)      p.gst_rate     = filters.gstRate;
    if (filters.vendor.length)       p.vendor       = filters.vendor;
    if (filters.productOwner.length) p.owner        = filters.productOwner;
    if (filters.createdFrom)         p.created_from = filters.createdFrom;
    if (filters.createdTo)           p.created_to   = filters.createdTo;
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



  const visible = useMemo(() => {
    let src = products;

    if (filters.scoreRange.length) {
      src = src.filter(p => filters.scoreRange.some(r => {
        const [lo, hi] = r.split('–').map(s => parseFloat(s.trim()));
        return p.rating >= lo && p.rating <= hi;
      }));
    }

    if (filters.topProducts) {
      const n = parseInt(filters.topProducts.replace(/\D/g, ''), 10);
      src = [...src].sort((a, b) => b.rating - a.rating).slice(0, n);
    }

    return src;
  }, [products, filters.scoreRange, filters.topProducts]);

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, segment, statusFilter, statusTab, sort, filters, vendorFilterId]);

  const setRowsPerPage = (n: number) => { setPageSize(n); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const paged = visible;

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
          <div className="prd-filter-head-left">
            <span className="prd-filter-head-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </span>
            <div className="prd-filter-head-titles">
              <div className="prd-filter-head-title">Filters</div>
              <div className="prd-filter-head-sub">Refine your product list</div>
            </div>
          </div>
          <div className="prd-filter-head-actions">
            <button
              className="prd-filter-icon-btn"
              onClick={resetFilters}
              aria-label="Reset filters"
              title="Reset filters"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button
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
            gstRate: filters.gstRate.length, segment: filters.segment.length,
            createdDate: (filters.createdFrom ? 1 : 0) + (filters.createdTo ? 1 : 0), hsn: filters.hsn.length,
            hazType: filters.hazType.length, hazClass: filters.hazClass.length, uom: filters.uom.length,
            condition: filters.condition.length, vendor: filters.vendor.length, scoreRange: filters.scoreRange.length,
            topProducts: filters.topProducts ? 1 : 0, productOwner: filters.productOwner.length, inwardCount: filters.inwardCount.length,
          };
          const activeMeta = PANEL_META[activeCategory];
          return (
            <div className="prd-filter-body prd-md">
              <div className="prd-md-rail">
                {CATEGORY_ORDER.map(k => {
                  const m = PANEL_META[k];
                  const c = counts[k] ?? 0;
                  return (
                    <Tooltip key={k} label={CATEGORY_LABELS[k]} position="right">
                      <button
                        type="button"
                        className={`prd-md-cat ${activeCategory === k ? 'active' : ''}`}
                        onClick={() => setActiveCategory(k)}
                        aria-label={CATEGORY_LABELS[k]}
                      >
                        <span className="prd-md-cat-ic" aria-hidden>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{m.path}</svg>
                        </span>
                        {c > 0 && <span className="prd-md-cat-ct">{c}</span>}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

              <div className="prd-md-detail">
                <div className="prd-md-dhead">
                  <span className="prd-md-dhead-ic" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{activeMeta.path}</svg>
                  </span>
                  <div className="prd-md-dhead-tx">
                    <div className="prd-md-dhead-title">{CATEGORY_LABELS[activeCategory]}</div>
                    <div className="prd-md-dhead-sub">{activeMeta.sub}</div>
                  </div>
                </div>

                <div className="prd-md-dbody" key={activeCategory}>
                  {activeCategory === 'gstRate' && gstRateOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.gstRate.includes(v)} onChange={() => toggleMulti('gstRate', v)} />
                  ))}

                  {activeCategory === 'segment' && segmentOpts.filter(s => s !== 'All Segments').map(v => (
                    <CheckRow key={v} label={v} checked={filters.segment.includes(v)} onChange={() => toggleMulti('segment', v)} />
                  ))}

                  {activeCategory === 'createdDate' && (
                    <div className="prd-filter-date-grid">
                      <label className="prd-filter-date-field">
                        <span>From</span>
                        <div className="prd-filter-date-picker">
                          <MasterDatePicker value={filters.createdFrom} onChange={(v) => setFilters(prev => ({ ...prev, createdFrom: v }))} placeholder="Select date" maxDate={filters.createdTo || undefined} />
                        </div>
                      </label>
                      <label className="prd-filter-date-field">
                        <span>To</span>
                        <div className="prd-filter-date-picker">
                          <MasterDatePicker value={filters.createdTo} onChange={(v) => setFilters(prev => ({ ...prev, createdTo: v }))} placeholder="Select date" minDate={filters.createdFrom || undefined} />
                        </div>
                      </label>
                    </div>
                  )}

                  {activeCategory === 'hsn' && hsnOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.hsn.includes(v)} onChange={() => toggleMulti('hsn', v)} />
                  ))}

                  {activeCategory === 'hazType' && (<>
                    {HAZ_TYPES.map(v => {
                      const selected = filters.hazType[0] === v;
                      return (
                        <label key={v} className="prd-filter-row">
                          <input type="radio" name="hazType" checked={selected}
                            onChange={() => setFilters(prev => ({ ...prev, hazType: [v], hazClass: v === 'NON HAZ' ? [] : prev.hazClass }))}
                            onClick={() => { if (selected) setFilters(prev => ({ ...prev, hazType: [] })); }} />
                          <span>{v}</span>
                        </label>
                      );
                    })}
                    {filters.hazType.length > 0 && (
                      <button className="prd-filter-clear-mini" onClick={() => setFilters(prev => ({ ...prev, hazType: [] }))}>Clear selection</button>
                    )}
                  </>)}

                  {activeCategory === 'hazClass' && (
                    filters.hazType.length === 1 && filters.hazType[0] === 'NON HAZ'
                      ? <div className="prd-filter-empty">Not applicable — "Non-Hazardous" is selected under Hazard Type. Switch it to "HAZ" or clear it to pick a classification.</div>
                      : hazClassOpts.length === 0
                        ? <div className="prd-filter-empty">No haz classifications available</div>
                        : hazClassOpts.map(v => (
                          <CheckRow key={v} label={v} checked={filters.hazClass.includes(v)} onChange={() => toggleMulti('hazClass', v)} />
                        )))}

                  {activeCategory === 'uom' && uomOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.uom.includes(v)} onChange={() => toggleMulti('uom', v)} />
                  ))}

                  {activeCategory === 'condition' && conditionOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.condition.includes(v)} onChange={() => toggleMulti('condition', v)} />
                  ))}

                  {activeCategory === 'vendor' && vendorOpts.map(v => (
                    <CheckRow key={v} label={v} checked={filters.vendor.includes(v)} onChange={() => toggleMulti('vendor', v)} />
                  ))}

                  {activeCategory === 'scoreRange' && SCORE_RANGES.map(v => (
                    <CheckRow key={v} label={v} checked={filters.scoreRange.includes(v)} onChange={() => toggleMulti('scoreRange', v)} />
                  ))}

                  {activeCategory === 'topProducts' && (<>
                    {TOP_PRODUCTS.map(v => (
                      <label key={v} className="prd-filter-row">
                        <input type="radio" name="topProducts" checked={filters.topProducts === v} onChange={() => setFilters(prev => ({ ...prev, topProducts: v }))} />
                        <span>{v}</span>
                      </label>
                    ))}
                    {filters.topProducts && (
                      <button className="prd-filter-clear-mini" onClick={() => setFilters(prev => ({ ...prev, topProducts: '' }))}>Clear selection</button>
                    )}
                  </>)}

                  {activeCategory === 'productOwner' && (ownerOpts.length === 0
                    ? <div className="prd-filter-empty">No owners available</div>
                    : ownerOpts.map(o => {
                      const showBranch = ownerOpts.some(x => x.branchId !== o.branchId);
                      const label = showBranch && o.branchName ? `${o.name} · ${o.branchName}` : o.name;
                      const id = String(o.id);
                      return (
                        <CheckRow key={id} label={label} checked={filters.productOwner.includes(id)} onChange={() => toggleMulti('productOwner', id)} />
                      );
                    }))}

                  {activeCategory === 'inwardCount' && INWARD_BUCKETS.map(v => (
                    <CheckRow key={v} label={v} checked={filters.inwardCount.includes(v)} onChange={() => toggleMulti('inwardCount', v)} />
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        <div className="prd-filter-footer">
          <button className="prd-fbtn ghost" onClick={resetFilters}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            Reset All
          </button>
          <button className="prd-fbtn primary" onClick={() => setFilterOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            Apply Filters {activeFilterCount > 0 && <span className="prd-fbtn-count">{activeFilterCount}</span>}
          </button>
        </div>
      </aside>
        </>
      ), document.body)}
    </div>
  );
}

const PANEL_META: Record<string, { sub: string; bg: string; fg: string; solid: string; path: ReactNode }> = {
  gstRate:      { sub: 'Select GST rate',        bg: '#d1fae5', fg: '#059669', solid: '#10b981', path: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></> },
  segment:      { sub: 'Choose segment',         bg: '#fef3c7', fg: '#d97706', solid: '#f59e0b', path: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></> },
  createdDate:  { sub: 'Pick a date range',      bg: '#dbeafe', fg: '#2563eb', solid: '#3b82f6', path: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></> },
  hsn:          { sub: 'Enter HSN / SAC code',   bg: '#ede9fe', fg: '#7c3aed', solid: '#8b5cf6', path: <><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></> },
  hazType:      { sub: 'Select hazard type',     bg: '#fee2e2', fg: '#dc2626', solid: '#ef4444', path: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></> },
  hazClass:     { sub: 'Select classification',  bg: '#e0e7ff', fg: '#4f46e5', solid: '#6366f1', path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
  uom:          { sub: 'Select unit',            bg: '#cffafe', fg: '#0891b2', solid: '#06b6d4', path: <><path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z" /><path d="m14.5 12.5-2 2" /><path d="m11.5 9.5-2 2" /><path d="m8.5 6.5-2 2" /></> },
  condition:    { sub: 'Select condition',       bg: '#dcfce7', fg: '#16a34a', solid: '#22c55e', path: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></> },
  vendor:       { sub: 'Select supplier',        bg: '#e0f2fe', fg: '#0284c7', solid: '#0ea5e9', path: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
  scoreRange:   { sub: 'Set score range',        bg: '#fef9c3', fg: '#ca8a04', solid: '#eab308', path: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /> },
  topProducts:  { sub: 'Highlight top products', bg: '#fce7f3', fg: '#db2777', solid: '#ec4899', path: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></> },
  productOwner: { sub: 'Select owner',           bg: '#f3e8ff', fg: '#9333ea', solid: '#a855f7', path: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
  inwardCount:  { sub: 'Filter by inward count', bg: '#ffedd5', fg: '#ea580c', solid: '#f97316', path: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></> },
};

const CATEGORY_ORDER = ['gstRate', 'segment', 'createdDate', 'hsn', 'hazType', 'hazClass', 'uom', 'condition', 'vendor', 'scoreRange', 'topProducts', 'productOwner', 'inwardCount'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  gstRate: 'GST Rate', segment: 'Segment', createdDate: 'Creation Date', hsn: 'HSN / SAC',
  hazType: 'Hazard Type', hazClass: 'Haz Class', uom: 'Unit (UOM)', condition: 'Condition',
  vendor: 'Supplier', scoreRange: 'Score Range', topProducts: 'Top Products', productOwner: 'Owner', inwardCount: 'Inward Count',
};

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