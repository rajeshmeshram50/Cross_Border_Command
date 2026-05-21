import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';
import AddProductModal from './AddProductModal';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Products
 *
 * Branch-and-employee Products list (Amazon / Flipkart-style card grid)
 * with an "Add Product" 6-step wizard. Visible only to branch_user and
 * employee user types — admins / super_admin don't see the sidebar entry.
 *
 * Mock data for now; the Add Product flow validates locally and surfaces a
 * toast on Save. Wire the POST once the products API ships.
 * ──────────────────────────────────────────────────────────────────────── */

export type Product = {
  apiId: number;                               // numeric DB id (for edit / delete)
  id: string;                                  // display code e.g. "P-001"
  name: string;
  genericName: string;
  brand: string;
  segment: string;
  price: number;
  currency: string;
  rating: number;
  reviews: number;
  status: 'Active' | 'Inactive' | 'Draft';     // server canonical status
  hsn: string;
  uom: string;
  hazClass: 'HAZ' | 'NON HAZ';
  hazClassName: string;                        // master haz_class.name when product is HAZ
  gstRate: number;
  condition: string;
  vendors: string[];                           // company_name of every mapped vendor
  vendorCount: number;
  /** Creator (product owner). Sourced from products.created_by joined to users
   *  on the API. Drives the Product Owner filter and the "Created by" line on
   *  the card. ownerId is null only for legacy rows where the user was deleted. */
  ownerId: number | null;
  ownerName: string;
  ownerBranchId: number | null;
  ownerBranchName: string;
  /** ISO timestamp of when the product was created. */
  createdAt: string;
  stepCompleted: number;                       // 0..4 — wizard re-entry hint
  badge?: 'Best Seller' | 'New' | 'Trending' | 'Top Rated';
  thumb: string;                               // gradient fallback when no real image
  images: string[];                            // primary first, then secondaries — cycled on the card
};

/* Predictable per-id gradient so reload-order doesn't shuffle card colours. */
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
  // Prefer the absolute *_url accessors so cards work in any environment
  // (local /storage, Azure CDN, etc.); fall back to the raw path resolved
  // client-side if older rows don't have the accessor yet.
  const primaryUrl = (row.primary_image_url as string | null) || (row.primary_image as string | null) || '';
  const secondaryUrls = Array.isArray(row.secondary_images_url)
    ? (row.secondary_images_url as string[])
    : (Array.isArray(row.secondary_images) ? (row.secondary_images as string[]) : []);
  const images = [primaryUrl, ...secondaryUrls].filter(Boolean);
  return {
    apiId: idNum,
    id: String(row.product_code ?? `P-${idNum}`),
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
    vendorCount: vendorMaps.length,
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
const STATUSES = ['All Status', 'Active', 'Inactive', 'Draft'];

/* ─── Sidebar filter options ─── */
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
  gstRate: [], segment: [], hsn: [], hazType: [], uom: [], condition: [],
  vendor: [], scoreRange: [], topProducts: '', createdFrom: '', createdTo: '',
  productOwner: [], inwardCount: [],
};

export default function Products() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  /* Vendor deep-link filter — populated when the Vendors page Map
     Products action navigates to /products?vendor_id=…. While set,
     the list only shows products mapped to that vendor and a chip
     header surfaces the active filter so the user can clear it. */
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorFilterId   = searchParams.get('vendor_id');
  const vendorFilterCode = searchParams.get('vendor_code') ?? '';
  const vendorFilterName = searchParams.get('vendor_name') ?? '';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ active: number; inactive: number }>({ active: 0, inactive: 0 });
  const [statusTab, setStatusTab] = useState<'active' | 'inactive'>('active');
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('All Segments');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'recent' | 'price-asc' | 'price-desc' | 'rating'>('recent');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  /* ─── Filter sidebar ─── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expandedPanel, setExpandedPanel] = useState<string | null>(null);

  /* Filter dropdown options live in state so they can be refreshed
     from the master APIs on mount. The hardcoded `SEGMENTS` /
     `HSN_CODES` / `UOMS` / `CONDITIONS` / `VENDORS` constants are
     fallbacks that ship until the fetch resolves — keeps the panel
     usable even with a slow or unreachable backend. */
  const [segmentOpts, setSegmentOpts]   = useState<string[]>(SEGMENTS);
  const [hsnOpts,     setHsnOpts]       = useState<string[]>(HSN_CODES);
  const [uomOpts,     setUomOpts]       = useState<string[]>(UOMS);
  const [conditionOpts, setConditionOpts] = useState<string[]>(CONDITIONS);
  const [vendorOpts,  setVendorOpts]    = useState<string[]>(VENDORS);
  const [gstRateOpts, setGstRateOpts]   = useState<string[]>(GST_RATES);
  /* Product Owner options — sourced from /products/owners. The endpoint
     scopes the list per user_type:
       • main-branch user → every branch_user / employee across the client
       • sub-branch user  → only their own branch's users
     The old `PRODUCT_OWNERS` const was generic role labels (Branch Admin,
     Inventory Manager…) that never matched a real `created_by` row, so the
     filter never selected anything. */
  type OwnerOpt = { id: number; name: string; branchId: number | null; branchName: string; isMainBranch: boolean };
  const [ownerOpts, setOwnerOpts] = useState<OwnerOpt[]>([]);

  useEffect(() => {
    type MasterRow = { id: number | string; status?: string; name?: string; title?: string; short_code?: string; hsn_code?: string; percentage?: number | string };
    const active = (r: MasterRow) => String(r.status ?? 'Active').toLowerCase() !== 'inactive';
    const fetchMaster = async <T,>(slug: string, map: (r: MasterRow) => T | null): Promise<T[]> => {
      try {
        const res = await api.get<MasterRow[]>(`/master/${slug}`);
        const rows = Array.isArray(res.data) ? res.data : [];
        return rows.filter(active).map(map).filter((v): v is T => v !== null && v !== '');
      } catch { return []; }
    };
    /* Master endpoints are branch-scoped, so the same logical name
       (e.g. "Handicrafts") can come back multiple times when the user
       has visibility into more than one (client, branch) tuple. The
       filter dropdowns key on the string itself, so duplicates blow up
       with "Encountered two children with the same key" warnings.
       dedupe collapses repeats while preserving the first-seen order. */
    const dedupe = (arr: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of arr) {
        if (!seen.has(v)) { seen.add(v); out.push(v); }
      }
      return out;
    };
    (async () => {
      const [seg, hsn, uom, cond, gst] = await Promise.all([
        fetchMaster<string>('segments',       r => r.title ?? null),
        fetchMaster<string>('hsn_codes',      r => r.hsn_code ?? null),
        // UOM options must mirror what the product card actually shows.
        // apiToCard maps p.uom = short_code ?? title (e.g. "kg" for the
        // "Kilogram" master row), so the filter has to do the same — fetching
        // by `title` alone made "Kilogram" never match the "kg" on the card.
        fetchMaster<string>('uom',            r => r.short_code ?? r.title ?? null),
        fetchMaster<string>('conditions',     r => r.title ?? null),
        fetchMaster<string>('gst_percentage', r => (r.percentage != null ? `${r.percentage}%` : null)),
      ]);
      if (seg.length)  setSegmentOpts(dedupe(seg));
      if (hsn.length)  setHsnOpts(dedupe(hsn));
      if (uom.length)  setUomOpts(dedupe(uom));
      if (cond.length) setConditionOpts(dedupe(cond));
      if (gst.length)  setGstRateOpts(dedupe(gst));

      // Vendor dropdown — sources from the vendor directory rather than
      // a master so the filter matches what the user can actually
      // associate with a product.
      try {
        type VendorRow = { id: number; company_name?: string; vendor_code?: string };
        const res = await api.get<{ data?: VendorRow[] } | VendorRow[]>('/vendors?per_page=200');
        const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        const names = rows.map(v => v.company_name ?? '').filter(Boolean);
        if (names.length) setVendorOpts(dedupe(names));
      } catch { /* fall back to hardcoded */ }

      // Product Owner dropdown — pulls the user list the backend says
      // is in scope (main branch → whole client, sub branch → own
      // branch only). Empty list means the role has no use for the
      // filter (e.g. client_admin) and the panel will just render
      // empty.
      try {
        type OwnerRow = { id: number; name: string; branch_id: number | null; branch_name: string | null; is_main_branch: boolean };
        const res = await api.get<{ data?: OwnerRow[] }>('/products/owners');
        const rows = Array.isArray(res.data?.data) ? res.data!.data! : [];
        setOwnerOpts(rows.map(r => ({
          id:           r.id,
          name:         r.name,
          branchId:     r.branch_id,
          branchName:   r.branch_name ?? '',
          isMainBranch: !!r.is_main_branch,
        })));
      } catch { /* leave panel empty on error */ }
    })();
  }, []);

  /* Escape-to-close — a second exit path beyond the backdrop click and
     the close button. Bound only while the drawer is open so we don't
     listen forever. */
  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filterOpen]);

  const togglePanel = (key: string) =>
    setExpandedPanel(prev => (prev === key ? null : key));

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

  // Hard guard — even if someone types /products directly, only branch_user
  // and employee can use the module.
  const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  useEffect(() => {
    const id = 'sm-products-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  /* ─── Load list (re-runs when the status tab flips) ─── */
  const refresh = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const params: Record<string, string | number> = { per_page: 100 };
      // When a vendor filter is active, drop the status tab so the
      // user sees every mapped product (inactive drafts included) —
      // otherwise an Active-only filter could mask the very rows
      // they came here to see.
      if (vendorFilterId) {
        params.vendor_id = vendorFilterId;
      } else {
        params.status = statusTab;
      }
      // Stats endpoint mirrors the vendor filter so the
      // Active / Inactive tab badges show counts scoped to the
      // vendor's mapped products instead of the org-wide totals.
      const statsParams: Record<string, string> = {};
      if (vendorFilterId) statsParams.vendor_id = vendorFilterId;

      const [list, st] = await Promise.all([
        api.get<{ data: Record<string, unknown>[] }>('/products', { params }),
        api.get<{ active: number; inactive: number }>('/products/stats', { params: statsParams }),
      ]);
      setProducts(list.data.data.map(apiToCard));
      setStats({ active: st.data.active, inactive: st.data.inactive });
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, statusTab, vendorFilterId]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    let src = products;
    const lo = q.trim().toLowerCase();
    if (lo) {
      src = src.filter(p =>
        p.name.toLowerCase().includes(lo) ||
        p.brand.toLowerCase().includes(lo) ||
        p.genericName.toLowerCase().includes(lo) ||
        p.segment.toLowerCase().includes(lo) ||
        p.id.toLowerCase().includes(lo) ||
        p.hsn.toLowerCase().includes(lo)
      );
    }
    if (segment !== 'All Segments')  src = src.filter(p => p.segment === segment);
    if (statusFilter !== 'All Status') src = src.filter(p => p.status === statusFilter);

    if (filters.segment.length)  src = src.filter(p => filters.segment.includes(p.segment));
    if (filters.hsn.length)      src = src.filter(p => filters.hsn.includes(p.hsn));
    if (filters.hazType.length)  src = src.filter(p => filters.hazType.includes(p.hazClass));
    if (filters.uom.length)      src = src.filter(p => filters.uom.includes(p.uom));
    /* GST filter values arrive as strings ("5%", "18%"); the product's
       gstRate is a number. Normalize both sides so comparison is
       strictly on the numeric percent. */
    if (filters.gstRate.length) {
      const allowedPcts = new Set(filters.gstRate.map(s => Number(s.replace(/[^\d.]/g, ''))));
      src = src.filter(p => allowedPcts.has(p.gstRate));
    }
    if (filters.condition.length) src = src.filter(p => filters.condition.includes(p.condition));
    /* Vendor filter checks the list of mapped vendor company names on
       the product (vendor_maps.vendor_name). Previously this matched
       against p.brand, which is a free-text brand field unrelated to
       the mapped-vendor directory — so nothing ever matched. */
    if (filters.vendor.length) {
      src = src.filter(p => p.vendors.some(v => filters.vendor.includes(v)));
    }
    if (filters.scoreRange.length) {
      src = src.filter(p => filters.scoreRange.some(r => {
        const [lo, hi] = r.split('–').map(s => parseFloat(s.trim()));
        return p.rating >= lo && p.rating <= hi;
      }));
    }
    /* Product Owner — the dropdown values are user IDs (as strings) from
       /products/owners, and p.ownerId is the row's created_by joined to
       users on the API. */
    if (filters.productOwner.length) {
      const ownerSet = new Set(filters.productOwner);
      src = src.filter(p => p.ownerId != null && ownerSet.has(String(p.ownerId)));
    }
    /* Created Date — inclusive From/To window on the product's created_at
       timestamp. Empty strings mean unbounded on that side. */
    if (filters.createdFrom) {
      const from = new Date(filters.createdFrom + 'T00:00:00').getTime();
      src = src.filter(p => {
        const t = Date.parse(p.createdAt);
        return Number.isFinite(t) && t >= from;
      });
    }
    if (filters.createdTo) {
      const to = new Date(filters.createdTo + 'T23:59:59').getTime();
      src = src.filter(p => {
        const t = Date.parse(p.createdAt);
        return Number.isFinite(t) && t <= to;
      });
    }

    const sorted = [...src];
    if (sort === 'price-asc')  sorted.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    if (sort === 'rating')     sorted.sort((a, b) => b.rating - a.rating);

    if (filters.topProducts) {
      const n = parseInt(filters.topProducts.replace(/\D/g, ''), 10);
      return [...sorted].sort((a, b) => b.rating - a.rating).slice(0, n);
    }

    return sorted;
  }, [products, q, segment, statusFilter, sort, filters]);

  if (!allowed) {
    return (
      <div className="prd-root">
        <style>{SCOPED_CSS}</style>
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

  // Refetch from the API after any step is saved. The wizard does its own
  // POST/PUT for each step AND fires its own step-specific toast
  // (`Core saved`, `Sales saved`, `Quality saved`, `Product saved`), so
  // this handler only mirrors server state — no extra toast or the user
  // sees two stacked notifications for the same action.
  const handleSaved = (_productId: number, _finalised: boolean) => {
    refresh();
  };

  const handleEdit = (p: Product) => {
    setEditingId(p.apiId);
    setAddOpen(true);
  };

  /* Delete confirmation — mirrors the modal used on Clients and HR
     Employees. Two-stage flow: click "Delete" in the row action ->
     opens DeleteConfirmModal -> Confirm -> hits the API. Server-side
     this is a soft delete (Product uses SoftDeletes), so the row only
     disappears from the active list and can be restored from the
     trashed rows later if a recovery flow ever ships. */
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
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Please try again';
      toast.error('Delete failed', msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="prd-root">
      <style>{SCOPED_CSS}</style>

      {/* Header — white surface card matching the HR Employees page style */}
      <div className="prd-header">
        <div className="prd-header-left">
          <span className="prd-header-icon">
            <i className="ri-box-3-line" />
          </span>
          <div>
            <h5 className="prd-header-title">Products</h5>
            <div className="prd-header-sub">Manage your product catalog — pricing, compliance, vendors and documents in one place</div>
          </div>
        </div>
        <button className="prd-add-btn" onClick={() => { setEditingId(null); setAddOpen(true); }}>
          <i className="ri-add-line" />
          Add Product
        </button>
      </div>

      {/* Status tab strip — Active / Inactive */}
      <div className="prd-status-tabs">
        <button
          className={`prd-status-tab ${statusTab === 'active' ? 'on' : ''}`}
          onClick={() => setStatusTab('active')}
        >
          <span className="prd-status-dot is-active" />
          Active
          <span className="prd-status-count">{stats.active}</span>
        </button>
        <button
          className={`prd-status-tab ${statusTab === 'inactive' ? 'on' : ''}`}
          onClick={() => setStatusTab('inactive')}
        >
          <span className="prd-status-dot is-inactive" />
          Inactive
          <span className="prd-status-count">{stats.inactive}</span>
        </button>
      </div>

      {/* Filters bar */}
      <div className="prd-filters">
        <button
          className={`prd-filter-toggle ${filterOpen ? 'on' : ''}`}
          onClick={() => setFilterOpen(o => !o)}
          aria-label="Open filters"
          title="Open filters"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filters
          {activeFilterCount > 0 && <span className="prd-filter-toggle-badge">{activeFilterCount}</span>}
        </button>
        <div className="prd-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input
            type="text"
            placeholder="Search products by name, brand, HSN, segment…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="prd-ms-wrap">
          <MasterSelect
            value={segment}
            onChange={setSegment}
            placeholder="All Segments"
            options={['All Segments', ...segmentOpts.filter(s => s !== 'All Segments')].map(s => ({ value: s, label: s }))}
          />
        </div>
        <div className="prd-ms-wrap">
          <MasterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All Status"
            options={STATUSES.map(s => ({ value: s, label: s }))}
          />
        </div>
        <div className="prd-ms-wrap">
          <MasterSelect
            value={sort}
            onChange={(v) => setSort(v as typeof sort)}
            placeholder="Sort"
            options={[
              { value: 'recent',     label: 'Sort: Recent' },
              { value: 'price-asc',  label: 'Price: Low to High' },
              { value: 'price-desc', label: 'Price: High to Low' },
              { value: 'rating',     label: 'Top Rated' },
            ]}
          />
        </div>
        <div className="prd-view-toggle">
          <button className={`prd-view-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')} aria-label="Grid view" title="Grid view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
          </button>
          <button className={`prd-view-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} aria-label="List view" title="List view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1.2" /><circle cx="4" cy="12" r="1.2" /><circle cx="4" cy="18" r="1.2" /></svg>
          </button>
        </div>
      </div>

      {/* Vendor deep-link banner — shown only when the page is
          filtered to a specific vendor's mapped products. Clearing
          it pops the query params off the URL and restores the
          status-tab default list. */}
      {vendorFilterId && (
        <div className="prd-vendor-banner">
          <i className="ri-links-line" />
          <span className="prd-vendor-banner-text">
            Showing products mapped to vendor
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

      {/* Result count */}
      <div className="prd-meta">
        <span className="prd-meta-count">{filtered.length} {filtered.length === 1 ? 'product' : 'products'}</span>
        {q && <span className="prd-meta-chip">Search: <strong>{q}</strong></span>}
        {segment !== 'All Segments' && <span className="prd-meta-chip">Segment: <strong>{segment}</strong></span>}
        {statusFilter !== 'All Status' && <span className="prd-meta-chip">Status: <strong>{statusFilter}</strong></span>}
      </div>

      {/* Grid / List view */}
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
      ) : filtered.length === 0 ? (
        <div className="prd-empty">
          <div className="prd-empty-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          </div>
          <div className="prd-empty-title">
            {vendorFilterId ? 'No products mapped to this vendor yet' : 'No products found'}
          </div>
          <div className="prd-empty-desc">
            {vendorFilterId
              ? `Open any product and map ${vendorFilterCode || 'this vendor'} on Step 2 — or clear the filter to browse all products.`
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
        <div className="prd-grid">
          {filtered.map(p => (
            <ProductCard
              key={p.apiId}
              product={p}
              onAction={(act) => {
                if (act === 'View')        navigate(`/products/${p.apiId}`);
                else if (act === 'Edit')   handleEdit(p);
                else if (act === 'Delete') handleDelete(p);
                else                       toast.info(act, `${act}: ${p.name}`);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="prd-list">
          {filtered.map(p => (
            <ProductRow
              key={p.apiId}
              product={p}
              onAction={(act) => {
                if (act === 'View')        navigate(`/products/${p.apiId}`);
                else if (act === 'Edit')   handleEdit(p);
                else if (act === 'Delete') handleDelete(p);
                else                       toast.info(act, `${act}: ${p.name}`);
              }}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddProductModal
          productId={editingId}
          onClose={() => { setAddOpen(false); setEditingId(null); }}
          onSaved={(id, finalised) => {
            handleSaved(id, finalised);
            if (finalised) { setAddOpen(false); setEditingId(null); }
            else           { setEditingId(id); }
          }}
        />
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        itemName={deleteTarget?.name}
        title="Delete Product"
        subMessage="This action moves the product to the deleted state. Its vendor mappings and QC records remain linked and can be restored if you bring the product back."
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
      />

      {/* Filter sidebar — slides in from the left.
          Portalled to <body> so the fixed positioning escapes the
          page-content stacking context. Without the portal the drawer's
          z-index loses to Velzon's #page-topbar (z-index 1002) in
          horizontal layout and outside-clicks on the topbar area never
          reach the overlay. */}
      {createPortal((
        <>
      <div
        className={`prd-filter-overlay ${filterOpen ? 'open' : ''}`}
        onClick={() => setFilterOpen(false)}
        aria-hidden={!filterOpen}
      />
      <aside className={`prd-filter-drawer ${filterOpen ? 'open' : ''}`} aria-hidden={!filterOpen}>
        <div className="prd-filter-head">
          <div className="prd-filter-head-title">Filters</div>
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

        <div className="prd-filter-body">
          <FilterPanel label="GST Rate" panelKey="gstRate" open={expandedPanel === 'gstRate'} onToggle={togglePanel} count={filters.gstRate.length}>
            {gstRateOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.gstRate.includes(v)} onChange={() => toggleMulti('gstRate', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Segment" panelKey="segment" open={expandedPanel === 'segment'} onToggle={togglePanel} count={filters.segment.length}>
            {segmentOpts.filter(s => s !== 'All Segments').map(v => (
              <CheckRow key={v} label={v} checked={filters.segment.includes(v)} onChange={() => toggleMulti('segment', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="HSN/SAC Code" panelKey="hsn" open={expandedPanel === 'hsn'} onToggle={togglePanel} count={filters.hsn.length}>
            {hsnOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.hsn.includes(v)} onChange={() => toggleMulti('hsn', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Hazard Type" panelKey="hazType" open={expandedPanel === 'hazType'} onToggle={togglePanel} count={filters.hazType.length}>
            {HAZ_TYPES.map(v => (
              <CheckRow key={v} label={v} checked={filters.hazType.includes(v)} onChange={() => toggleMulti('hazType', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Unit of Measurement" panelKey="uom" open={expandedPanel === 'uom'} onToggle={togglePanel} count={filters.uom.length}>
            {uomOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.uom.includes(v)} onChange={() => toggleMulti('uom', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Condition" panelKey="condition" open={expandedPanel === 'condition'} onToggle={togglePanel} count={filters.condition.length}>
            {conditionOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.condition.includes(v)} onChange={() => toggleMulti('condition', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Vendor" panelKey="vendor" open={expandedPanel === 'vendor'} onToggle={togglePanel} count={filters.vendor.length}>
            {vendorOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.vendor.includes(v)} onChange={() => toggleMulti('vendor', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Score Range" panelKey="scoreRange" open={expandedPanel === 'scoreRange'} onToggle={togglePanel} count={filters.scoreRange.length}>
            {SCORE_RANGES.map(v => (
              <CheckRow key={v} label={v} checked={filters.scoreRange.includes(v)} onChange={() => toggleMulti('scoreRange', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Top Products" panelKey="topProducts" open={expandedPanel === 'topProducts'} onToggle={togglePanel} count={filters.topProducts ? 1 : 0}>
            {TOP_PRODUCTS.map(v => (
              <label key={v} className="prd-filter-row">
                <input
                  type="radio"
                  name="topProducts"
                  checked={filters.topProducts === v}
                  onChange={() => setFilters(prev => ({ ...prev, topProducts: v }))}
                />
                <span>{v}</span>
              </label>
            ))}
            {filters.topProducts && (
              <button className="prd-filter-clear-mini" onClick={() => setFilters(prev => ({ ...prev, topProducts: '' }))}>Clear selection</button>
            )}
          </FilterPanel>

          <FilterPanel label="Created Date" panelKey="createdDate" open={expandedPanel === 'createdDate'} onToggle={togglePanel} count={(filters.createdFrom ? 1 : 0) + (filters.createdTo ? 1 : 0)}>
            <div className="prd-filter-date-grid">
              <label className="prd-filter-date-field">
                <span>From</span>
                <div className="prd-filter-date-picker">
                  <MasterDatePicker
                    value={filters.createdFrom}
                    onChange={(v) => setFilters(prev => ({ ...prev, createdFrom: v }))}
                    placeholder="Select date"
                    maxDate={filters.createdTo || undefined}
                  />
                </div>
              </label>
              <label className="prd-filter-date-field">
                <span>To</span>
                <div className="prd-filter-date-picker">
                  <MasterDatePicker
                    value={filters.createdTo}
                    onChange={(v) => setFilters(prev => ({ ...prev, createdTo: v }))}
                    placeholder="Select date"
                    minDate={filters.createdFrom || undefined}
                  />
                </div>
              </label>
            </div>
          </FilterPanel>

          <FilterPanel label="Product Owner" panelKey="productOwner" open={expandedPanel === 'productOwner'} onToggle={togglePanel} count={filters.productOwner.length}>
            {ownerOpts.length === 0 ? (
              <div className="prd-filter-empty">No owners available</div>
            ) : ownerOpts.map(o => {
              /* Main-branch user sees rows from every branch — append
                 the branch suffix so two people named "Ravi" in
                 different branches stay distinguishable. Sub-branch
                 user only ever sees their own branch, so the suffix
                 would be redundant noise. */
              const showBranch = ownerOpts.some(x => x.branchId !== o.branchId);
              const label = showBranch && o.branchName ? `${o.name} · ${o.branchName}` : o.name;
              const id = String(o.id);
              return (
                <CheckRow key={id} label={label} checked={filters.productOwner.includes(id)} onChange={() => toggleMulti('productOwner', id)} />
              );
            })}
          </FilterPanel>

          <FilterPanel label="Inward Count" panelKey="inwardCount" open={expandedPanel === 'inwardCount'} onToggle={togglePanel} count={filters.inwardCount.length}>
            {INWARD_BUCKETS.map(v => (
              <CheckRow key={v} label={v} checked={filters.inwardCount.includes(v)} onChange={() => toggleMulti('inwardCount', v)} />
            ))}
          </FilterPanel>
        </div>

        <div className="prd-filter-footer">
          <button className="prd-filter-btn ghost" onClick={resetFilters}>Reset</button>
          <button className="prd-filter-btn primary" onClick={() => setFilterOpen(false)}>
            Apply {activeFilterCount > 0 && <span className="prd-filter-btn-count">{activeFilterCount}</span>}
          </button>
        </div>
      </aside>
        </>
      ), document.body)}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Sidebar helper components
 * ════════════════════════════════════════════════════════════════════════ */
function FilterPanel(props: {
  label: string;
  panelKey: string;
  open: boolean;
  count: number;
  onToggle: (k: string) => void;
  children: ReactNode;
}) {
  const { label, panelKey, open, count, onToggle, children } = props;
  return (
    <div className={`prd-filter-panel ${open ? 'open' : ''}`}>
      <button className="prd-filter-panel-head" onClick={() => onToggle(panelKey)}>
        <span className="prd-filter-panel-label">{label}</span>
        <span className="prd-filter-panel-right">
          {count > 0 && <span className="prd-filter-panel-count">{count}</span>}
          <svg
            className="prd-filter-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && <div className="prd-filter-panel-body">{children}</div>}
    </div>
  );
}

function CheckRow(props: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="prd-filter-row">
      <input type="checkbox" checked={props.checked} onChange={props.onChange} />
      <span>{props.label}</span>
    </label>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Product Card (Amazon / Flipkart style)
 * ════════════════════════════════════════════════════════════════════════ */
function ProductCard(props: {
  product: Product;
  onAction: (label: string) => void;
}) {
  const { product, onAction } = props;
  // Auto-cycle the carousel every 1.8s when 2+ images exist.
  const [imgIndex, setImgIndex] = useState(0);
  useEffect(() => {
    if (product.images.length < 2) return;
    const t = setInterval(() => {
      setImgIndex(i => (i + 1) % product.images.length);
    }, 1800);
    return () => clearInterval(t);
  }, [product.images.length]);
  const hasImage = product.images.length > 0;

  return (
    <div
      className="prd-card prd-card-clickable"
      role="link"
      tabIndex={0}
      onClick={() => onAction('View')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAction('View'); } }}
    >
      {/* Active / Inactive / Draft pill in the top-right corner of the image */}
      <span className={`prd-card-status-pill status-${product.status.replace(/\s+/g, '').toLowerCase()}`}>
        <span className="prd-card-status-dot" /> {product.status}
      </span>
      {product.badge && <span className={`prd-card-badge prd-badge-${product.badge.replace(/\s+/g, '').toLowerCase()}`}>{product.badge}</span>}
      <div className="prd-card-thumb" style={{ background: hasImage ? '#f5f3ff' : product.thumb }}>
        {hasImage ? (
          <div className="prd-card-thumb-slider">
            {product.images.map((src, i) => (
              <img
                key={`${product.apiId}-${i}`}
                src={src}
                alt={product.name}
                className={`prd-card-thumb-img ${i === imgIndex ? 'on' : ''}`}
                draggable={false}
              />
            ))}
            {product.images.length > 1 && (
              <div className="prd-card-thumb-dots">
                {product.images.map((_, i) => (
                  <span key={i} className={`prd-card-thumb-dot ${i === imgIndex ? 'on' : ''}`} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="prd-card-thumb-letter">{product.name.charAt(0).toUpperCase()}</div>
        )}
        <div className="prd-card-hover">
          <button className="prd-card-hover-btn" onClick={(e) => { e.stopPropagation(); onAction('View'); }}>View</button>
          <button className="prd-card-hover-btn primary" onClick={(e) => { e.stopPropagation(); onAction('Edit'); }}>Edit</button>
          <button className="prd-card-hover-btn danger" onClick={(e) => { e.stopPropagation(); onAction('Delete'); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </div>
      </div>

      <div className="prd-card-body">
        {/* ID|Name as a single line link */}
        <button className="prd-card-title-link" title={product.name} onClick={(e) => { e.stopPropagation(); onAction('View'); }}>
          <span className="prd-card-id-inline">{product.id}</span>
          <span className="prd-card-id-sep">|</span>
          <span className="prd-card-name-inline">{product.name}</span>
        </button>

        {/* HSN / GST / vendor count row */}
        <div className="prd-card-info-row">
          <span className="prd-card-info-cell">
            <span className="prd-card-info-key">HSN/SAC:</span>
            <span className="prd-card-info-val">{product.hsn}</span>
          </span>
          <span className="prd-card-info-cell">
            <span className="prd-card-info-key">GST:</span>
            <span className="prd-card-info-val">{product.gstRate}%</span>
          </span>
          <span className="prd-card-info-cell prd-card-vendor-cell" title={`${product.vendorCount} linked vendor${product.vendorCount === 1 ? '' : 's'}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{product.vendorCount}</span>
          </span>
        </div>

        {/* Haz status as text — green for safe, red for hazardous (with class) */}
        <div className={`prd-card-haz-text ${product.hazClass === 'HAZ' ? 'is-haz' : 'is-nonhaz'}`}>
          {product.hazClass === 'HAZ'
            ? (product.hazClassName ? `Hazardous: ${product.hazClassName}` : 'Hazardous')
            : 'Non-Hazardous'}
        </div>

        {/* Segment — small grey "Segment: Rice" line */}
        <div className="prd-card-segment">
          <span className="prd-card-info-key">Segment:</span>
          <span className="prd-card-info-val">{product.segment}</span>
        </div>

        {/* (kept for hazClassName chip slot, hidden) */}
        <div className="prd-card-haz-row" style={{ display: 'none' }}>
          <span className={`prd-card-haz-pill ${product.hazClass === 'HAZ' ? 'is-haz' : 'is-nonhaz'}`}>
            {product.hazClass === 'HAZ' ? 'HAZ' : 'Non-Haz'}
          </span>
          {product.hazClass === 'HAZ' && product.hazClassName && (
            <span className="prd-card-haz-class">
              <span className="prd-card-haz-class-key">Haz:</span>
              <span className="prd-card-haz-class-val">{product.hazClassName}</span>
            </span>
          )}
        </div>

        {/* Selling price */}
        <div className="prd-card-buyrow">
          <div className="prd-card-price-block">
            <span className="prd-card-price-label">Selling Price:</span>
            <span className="prd-card-price">{product.currency}{product.price.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── List view row ─── */
function ProductRow(props: {
  product: Product;
  onAction: (label: string) => void;
}) {
  const { product, onAction } = props;
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
          <span className="prd-card-info-cell prd-card-vendor-cell">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{product.vendorCount}</span>
          </span>
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
        {/* Status pill intentionally hidden — the status tabs at the top
            already segment Active vs Inactive, no need to repeat it here. */}
      </div>
      <div className="prd-row-price">
        <div className="prd-card-price-label">Selling Price</div>
        <div className="prd-card-price">{product.currency}{product.price.toLocaleString()}</div>
      </div>
      <div className="prd-row-actions">
        <button className="prd-card-hover-btn" onClick={(e) => { e.stopPropagation(); onAction('View'); }}>View</button>
        <button className="prd-card-hover-btn primary" onClick={(e) => { e.stopPropagation(); onAction('Edit'); }}>Edit</button>
        <button className="prd-card-hover-btn danger" onClick={(e) => { e.stopPropagation(); onAction('Delete'); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Shimmer placeholders — matches card / row geometry so the loading state
 * doesn't shift the layout when the real data lands.
 * ════════════════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════════════════════
 * Scoped CSS
 * ════════════════════════════════════════════════════════════════════════ */
const SCOPED_CSS = `
.prd-root {
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  background: #ffffff;
  padding: 14px 18px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 14px;
}
.prd-root *, .prd-root *::before, .prd-root *::after { box-sizing: border-box; }

/* Hero header */
/* Header — white surface card with a blue Velzon-primary gradient icon
   tile, matching the HR Employees / Clients master shell exactly. */
.prd-header {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 18px 20px;
  background: #fff;
  border: 1px solid var(--vz-border-color, #e9ebec);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,.05);
}
.prd-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.prd-header-icon {
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #405189 0%, #6691e7 100%);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 21px;
  box-shadow: 0 4px 10px rgba(64,81,137,.25);
  flex-shrink: 0;
}
.prd-header-title { font-size: 17px; font-weight: 700; color: #1e293b; margin: 0; letter-spacing: -.01em; }
.prd-header-sub   { font-size: 12.5px; color: #6b7280; margin-top: 2px; font-weight: 500; }

.prd-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 99px; border: none;
  background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
  color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: 0 4px 12px rgba(64,81,137,.3);
  transition: transform .15s, box-shadow .15s;
}
.prd-add-btn i { font-size: 16px; }
.prd-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(64,81,137,.4); }
.prd-add-btn:active { transform: translateY(0); }

/* Status tabs */
.prd-status-tabs {
  display: inline-flex; gap: 4px; padding: 4px;
  background: #fff;
  border: 1.5px solid #ddd6fe;
  border-radius: 12px;
  align-self: flex-start;
  box-shadow: 0 2px 8px rgba(124,58,237,.08);
}
.prd-status-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px;
  background: transparent; border: none;
  border-radius: 9px;
  font-family: inherit; font-size: 12.5px; font-weight: 800;
  color: #6b7280; cursor: pointer;
  transition: background .15s, color .15s;
}
.prd-status-tab:hover { background: #f5f3ff; color: #5b21b6; }
.prd-status-tab.on {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.prd-status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.prd-status-dot.is-active   { background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,.25); }
.prd-status-dot.is-inactive { background: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,.25); }
.prd-status-tab.on .prd-status-dot.is-active   { background: #4ade80; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
.prd-status-tab.on .prd-status-dot.is-inactive { background: #fbbf24; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
.prd-status-count {
  min-width: 22px; height: 20px; padding: 0 8px; border-radius: 99px;
  background: #ede9fe; color: #5b21b6;
  font-size: 10.5px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.prd-status-tab.on .prd-status-count { background: rgba(255,255,255,.25); color: #fff; }
/* Shimmer placeholders — light theme. The animated gradient is shared with
   the rest of the app via the global .shimmer class in app.css, but the
   product page renders enough cards that a local rule keeps the bundle
   self-contained. */
@keyframes prd-shim {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
.prd-shim-thumb,
.prd-shim-bar,
.prd-shim-pill {
  background: linear-gradient(90deg, #f5f3ff 0%, #ede9fe 50%, #f5f3ff 100%);
  background-size: 800px 100%;
  animation: prd-shim 1.2s linear infinite;
  border-radius: 8px;
}
.prd-shim-thumb { aspect-ratio: 4 / 3; width: 100%; height: 100%; border-radius: 0; }
.prd-shim-bar  { height: 14px; }
.prd-shim-pill { width: 56px; height: 18px; border-radius: 99px; }
.prd-shim-row  { display: flex; gap: 8px; align-items: center; }

.prd-card-clickable { cursor: pointer; }
.prd-card-clickable:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
.prd-card-shimmer { cursor: default; pointer-events: none; }
.prd-card-shimmer:hover { transform: none; border-color: #e8e4f9; box-shadow: none; }
.prd-card-shimmer .prd-card-body { gap: 10px; }

/* Filters */
.prd-filters {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #ddd6fe; border-radius: 12px;
  box-shadow: 0 2px 8px rgba(124,58,237,.08);
  flex-wrap: wrap;
}
.prd-search {
  flex: 1; min-width: 220px; position: relative;
  display: flex; align-items: center;
  background: #faf5ff; border: 1.5px solid #ddd6fe;
  border-radius: 10px; padding: 0 12px 0 36px; height: 40px;
}
.prd-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); }
.prd-search input { flex: 1; height: 100%; border: none; outline: none; background: transparent; font-family: inherit; font-size: 12.5px; color: #1e1b4b; }
.prd-search input::placeholder { color: #94a3b8; }

/* MasterSelect — sized to fit the 40px filter row, with the same violet
   accent as the other prd-* controls. Same chrome the master modal uses. */
.prd-ms-wrap { min-width: 160px; }
.prd-ms-wrap .master-select-wrap .master-select-toggle {
  min-height: 40px !important; height: 40px;
  padding: 0 32px 0 12px !important;
  font-size: 12px !important;
  font-weight: 700;
  background: #fff !important;
  border: 1.5px solid #ddd6fe !important;
  border-radius: 10px !important;
  color: #5b21b6 !important;
}
.prd-ms-wrap .master-select-wrap .master-select-toggle:hover {
  border-color: #c4b5fd !important;
}
.prd-ms-wrap .master-select-wrap.show .master-select-toggle {
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important;
}
.prd-ms-wrap .master-select-placeholder { color: #94a3b8 !important; font-weight: 700 !important; }

.prd-view-toggle {
  display: inline-flex; gap: 4px; padding: 4px;
  background: #faf5ff; border: 1.5px solid #ddd6fe; border-radius: 10px;
  height: 40px;
}
.prd-view-btn {
  width: 32px; height: 100%; border-radius: 7px; border: none;
  background: transparent; color: #7c3aed; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.prd-view-btn.on { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 6px rgba(124,58,237,.4); }

/* Meta */
.prd-meta { display: flex; align-items: center; gap: 10px; padding: 0 4px; flex-wrap: wrap; }
.prd-meta-count { font-size: 13px; font-weight: 800; color: #5b21b6; }
.prd-meta-chip { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 99px; background: #ede9fe; border: 1px solid #c4b5fd; color: #6d28d9; font-size: 11px; font-weight: 600; }
.prd-meta-chip strong { font-weight: 800; margin-left: 4px; }

/* Vendor deep-link filter banner */
.prd-vendor-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin: 4px 0;
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  border: 1px solid #a78bfa; border-radius: 12px;
  color: #4c1d95; font-size: 13px; font-weight: 600;
  box-shadow: 0 2px 8px rgba(124, 58, 237, .12);
}
.prd-vendor-banner i { font-size: 18px; color: #7c3aed; flex-shrink: 0; }
.prd-vendor-banner-text { flex: 1; line-height: 1.4; }
.prd-vendor-banner-text strong { color: #5b21b6; font-weight: 800; }
.prd-vendor-banner-clear {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 99px;
  background: #fff; border: 1.5px solid #c4b5fd;
  color: #7c3aed; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.prd-vendor-banner-clear i { font-size: 14px; color: inherit; }
.prd-vendor-banner-clear:hover {
  background: #7c3aed; border-color: #7c3aed; color: #fff;
}

.prd-empty-cta {
  margin-top: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px; border-radius: 99px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff; border: none; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 3px 10px rgba(124, 58, 237, .35);
}
.prd-empty-cta:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(124, 58, 237, .45); }

/* ─── Grid ─── */
.prd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
/* ─── Product card surface — ported from the Plans pricing card system
   so the two grids feel like the same component family. Layers:
   1. Soft white→violet gradient surface (light-mode) / deep accent
      mesh (dark-mode).
   2. Conic-gradient spinning border via ::before — same trick as
      .plan-card-animated, paused on hover so users don't get motion
      sickness while reading.
   3. translateY lift + multi-stop shadow halo on hover, intensity
      driven by --prd-accent (color-mix). */
@property --prd-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
@keyframes prd-border-spin { to { --prd-angle: 360deg; } }

.prd-card {
  --prd-accent: #7c3aed;
  position: relative;
  background:
    linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 22%),
    linear-gradient(180deg, color-mix(in srgb, var(--prd-accent) 9%, #ffffff) 0%, #ffffff 50%);
  border: 1px solid color-mix(in srgb, var(--prd-accent) 28%, transparent);
  border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: column;
  transition: transform .28s cubic-bezier(.4,0,.2,1),
              box-shadow .28s ease,
              border-color .28s ease;
  cursor: pointer;
  box-shadow:
    0 1px 0 rgba(255,255,255,.95) inset,
    0 1px 2px rgba(15,23,42,.04),
    0 10px 22px -6px  color-mix(in srgb, var(--prd-accent) 22%, transparent),
    0 22px 38px -14px color-mix(in srgb, var(--prd-accent) 16%, transparent);
}
.prd-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.5px;
  background:
    conic-gradient(
      from var(--prd-angle),
      transparent 0deg,
      var(--prd-accent) 40deg,
      rgba(255,255,255,.95) 80deg,
      var(--prd-accent) 120deg,
      transparent 200deg,
      transparent 360deg
    );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  animation: prd-border-spin 4s linear infinite;
  pointer-events: none;
  z-index: 5;
  opacity: 0;
  transition: opacity .25s ease;
}
.prd-card:hover {
  transform: translateY(-6px);
  border-color: color-mix(in srgb, var(--prd-accent) 58%, transparent);
  box-shadow:
    0 1px 0 rgba(255,255,255,.95) inset,
    0 2px 4px rgba(15,23,42,.06),
    0 16px 32px -6px  color-mix(in srgb, var(--prd-accent) 38%, transparent),
    0 28px 50px -12px color-mix(in srgb, var(--prd-accent) 28%, transparent);
}
.prd-card:hover::before {
  opacity: .85;
  animation-play-state: running;
}
.prd-card-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.prd-card-thumb-letter {
  font-size: 64px; font-weight: 800; color: rgba(255,255,255,.92);
  text-shadow: 0 4px 14px rgba(0,0,0,.15);
  letter-spacing: -1px;
}

/* Image carousel — primary → secondary → … on a 1.8s loop.
   All <img> are stacked; only the one with .on is opaque, the rest fade out. */
.prd-card-thumb-slider { position: absolute; inset: 0; }
.prd-card-thumb-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity .55s ease;
  pointer-events: none;
  user-select: none;
}
.prd-card-thumb-img.on { opacity: 1; }
.prd-card-thumb-dots {
  position: absolute; left: 0; right: 0; bottom: 8px;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  z-index: 2;
}
.prd-card-thumb-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,.55);
  border: 1px solid rgba(0,0,0,.08);
  transition: background .25s, transform .25s;
}
.prd-card-thumb-dot.on { background: #fff; transform: scale(1.25); }
.prd-row-thumb-img {
  width: 100%; height: 100%; object-fit: cover; border-radius: inherit;
  display: block;
  user-select: none;
}
.prd-card-hover {
  position: absolute; inset: 0;
  background: rgba(15, 23, 42, .55);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  opacity: 0; transition: opacity .22s;
}
.prd-card:hover .prd-card-hover { opacity: 1; }
.prd-card-hover-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px;
  border: 1.5px solid rgba(255,255,255,.4);
  background: rgba(255,255,255,.92); color: #5b21b6;
  font-family: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer;
  transition: transform .12s, background .12s;
}
.prd-card-hover-btn:hover { transform: translateY(-2px); background: #fff; }
.prd-card-hover-btn.primary { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border-color: transparent; }
.prd-card-hover-btn.danger { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

.prd-card-badge {
  position: absolute; top: 10px; left: 10px;
  padding: 4px 10px; border-radius: 99px;
  font-size: 10px; font-weight: 800; letter-spacing: .04em;
  background: #fff; color: #5b21b6;
  text-transform: uppercase;
  box-shadow: 0 4px 10px rgba(0,0,0,.18);
  z-index: 2;
}
.prd-badge-bestseller { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; }
.prd-badge-new        { background: linear-gradient(135deg, #22c55e, #15803d); color: #fff; }
.prd-badge-trending   { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; }
.prd-badge-toprated   { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: #fff; }

.prd-card-haz {
  position: absolute; bottom: 10px; right: 10px;
  padding: 3px 9px; border-radius: 6px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
  background: #fecaca; color: #b91c1c;
  border: 1px solid #f87171;
  z-index: 2;
}

.prd-card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; }

/* ID|Name link */
.prd-card-title-link {
  display: flex; align-items: baseline; gap: 6px;
  background: none; border: none; padding: 0;
  font-family: inherit; cursor: pointer; text-align: left;
  color: #5b21b6; font-size: 13.5px; font-weight: 700;
  line-height: 1.3;
  width: 100%; min-width: 0;
}
.prd-card-title-link:hover .prd-card-name-inline { text-decoration: underline; }
.prd-card-id-inline { color: #5b21b6; font-weight: 800; flex-shrink: 0; }
.prd-card-id-sep    { color: #c4b5fd; font-weight: 700; flex-shrink: 0; }
.prd-card-name-inline {
  color: #1e1b4b; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0; flex: 1;
}

/* HSN / GST / vendor row */
.prd-card-info-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 11.5px;
}
.prd-card-info-cell { display: inline-flex; align-items: center; gap: 4px; }
.prd-card-info-key { color: #7c3aed; font-weight: 700; }
.prd-card-info-val { color: #1e1b4b; font-weight: 700; font-variant-numeric: tabular-nums; }
.prd-card-vendor-cell {
  color: #16a34a;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.prd-card-vendor-cell svg { color: #16a34a; }

/* Haz pill */
.prd-card-haz-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.prd-card-haz-pill {
  display: inline-flex; align-items: center;
  padding: 2px 9px; border-radius: 6px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .04em;
}
.prd-card-haz-pill.is-haz    { background: #fecaca; color: #b91c1c; border: 1px solid #f87171; }
.prd-card-haz-pill.is-nonhaz { background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; }

.prd-card-haz-class { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; min-width: 0; }
.prd-card-haz-class-key { color: #b91c1c; font-weight: 800; letter-spacing: .02em; flex-shrink: 0; }
.prd-card-haz-class-val { color: #1e1b4b; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Haz status as text under the info row — green for non-haz, red for haz */
.prd-card-haz-text {
  font-size: 12px; font-weight: 700;
  margin-top: 2px;
}
.prd-card-haz-text.is-nonhaz { color: #16a34a; }
.prd-card-haz-text.is-haz    { color: #dc2626; }

/* Small "Segment: Rice" line */
.prd-card-segment {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px;
  margin-top: 2px;
}
.prd-card-segment .prd-card-info-key { color: #6b7280; font-weight: 700; }
.prd-card-segment .prd-card-info-val { color: #1e1b4b; font-weight: 700; }

/* Active / Inactive / Draft pill that sits on top of the image */
.prd-card-status-pill {
  position: absolute; top: 10px; right: 10px;
  z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 99px;
  font-size: 10.5px; font-weight: 800;
  box-shadow: 0 2px 8px rgba(15,23,42,.08);
}
.prd-card-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
}
.prd-card-status-pill.status-active   { background: #fff; color: #16a34a; border: 1px solid #bbf7d0; }
.prd-card-status-pill.status-inactive { background: #fff; color: #b45309; border: 1px solid #fde68a; }
.prd-card-status-pill.status-draft    { background: #fff; color: #475569; border: 1px solid #e2e8f0; }

/* Buy row */
.prd-card-buyrow {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 4px; padding-top: 10px;
  border-top: 1px dashed #ede9fe;
}
.prd-card-price-block { display: flex; flex-direction: column; gap: 1px; }
.prd-card-price-label { font-size: 10.5px; font-weight: 700; color: #6b7280; letter-spacing: .02em; }


.prd-card-id { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #94a3b8; text-transform: uppercase; }
.prd-card-name { font-size: 13.5px; font-weight: 800; color: #1e1b4b; line-height: 1.3; min-height: 35px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.prd-card-brand { font-size: 11px; color: #6b7280; }
.prd-card-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.prd-card-rating { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 800; color: #b45309; padding: 2px 7px; border-radius: 6px; background: #fef3c7; border: 1px solid #fde68a; }
.prd-card-reviews { font-size: 10.5px; color: #94a3b8; font-weight: 600; }
.prd-card-status { margin-left: auto; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 800; letter-spacing: .02em; }
.status-active   { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.status-inactive { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.status-draft    { background: #f3f4f6; color: #475569; border: 1px solid #e2e8f0; }
.prd-card-pricerow { display: flex; align-items: baseline; gap: 5px; margin-top: 4px; padding-top: 8px; border-top: 1px dashed #ede9fe; }
.prd-card-price { font-size: 17px; font-weight: 800; color: #5b21b6; }
.prd-card-uom { font-size: 10.5px; color: #6b7280; font-weight: 600; }

/* ─── List view ─── */
.prd-list { display: flex; flex-direction: column; gap: 10px; }
.prd-row {
  display: grid;
  grid-template-columns: 72px 1fr 120px 140px auto;
  gap: 14px; align-items: center;
  padding: 12px 16px;
  background: #fff; border: 1.5px solid #e8e4f9; border-radius: 12px;
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.prd-row:hover { border-color: #c4b5fd; box-shadow: 0 6px 18px rgba(124,58,237,.15); transform: translateY(-1px); }
.prd-row-thumb {
  width: 64px; height: 64px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 800; color: #fff;
}
.prd-row-info { min-width: 0; }
.prd-row-name { font-size: 13.5px; font-weight: 800; color: #1e1b4b; margin: 2px 0; }
.prd-row-rating { display: flex; align-items: center; gap: 6px; }
.prd-row-status { display: flex; align-items: center; gap: 6px; }
.prd-row-haz { padding: 2px 7px; border-radius: 6px; font-size: 9.5px; font-weight: 800; background: #fecaca; color: #b91c1c; border: 1px solid #f87171; }
.prd-row-price { text-align: right; }
.prd-row-actions { display: flex; align-items: center; gap: 6px; }

/* Empty */
.prd-empty {
  background: #fff; border: 1.5px dashed #c4b5fd; border-radius: 14px;
  padding: 36px 20px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.prd-empty-icon { width: 64px; height: 64px; border-radius: 16px; background: #ede9fe; display: flex; align-items: center; justify-content: center; }
.prd-empty-title { font-size: 15px; font-weight: 800; color: #5b21b6; }
.prd-empty-desc { font-size: 12px; color: #6b7280; }

/* No-access screen */
.prd-noaccess {
  background: #fff; border: 1.5px solid #fecaca; border-radius: 16px;
  padding: 36px 20px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.prd-noaccess-icon { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg,#ef4444,#b91c1c); display: flex; align-items: center; justify-content: center; }
.prd-noaccess-title { font-size: 16px; font-weight: 800; color: #b91c1c; }
.prd-noaccess-desc { font-size: 12.5px; color: #6b7280; max-width: 520px; }

@media (max-width: 920px) {
  .prd-row { grid-template-columns: 64px 1fr auto; gap: 10px; }
  .prd-row-rating, .prd-row-status, .prd-row-price { grid-column: 2 / -1; }
  .prd-row-actions { grid-column: 1 / -1; justify-content: flex-end; }
}

/* ─── Filter sidebar ─── */
.prd-filter-toggle {
  position: relative;
  display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 14px;
  border-radius: 10px; border: 1.5px solid #ddd6fe;
  background: #fff; color: #5b21b6;
  font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  transition: background .15s, border-color .15s, box-shadow .15s, transform .12s;
}
.prd-filter-toggle:hover { background: #f5f3ff; border-color: #c4b5fd; box-shadow: 0 4px 10px rgba(124,58,237,.18); transform: translateY(-1px); }
.prd-filter-toggle.on { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,58,237,.35); }
.prd-filter-toggle-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px;
  background: #fef3c7; color: #b45309; font-size: 10px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.prd-filter-toggle.on .prd-filter-toggle-badge { background: #fff; color: #5b21b6; }

.prd-filter-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, .35);
  backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none;
  transition: opacity .25s ease;
  /* Sit above Velzon's #page-topbar (z-index 1002) so clicks anywhere
     outside the drawer — including the topbar/navbar area — close it. */
  z-index: 1090;
}
.prd-filter-overlay.open { opacity: 1; pointer-events: auto; }

.prd-filter-drawer {
  position: fixed; top: 0; bottom: 0;
  /* Modal-style drawer: anchored to the viewport's left edge regardless
     of sidebar layout. The overlay (z-index 1090) covers everything
     beneath, including any visible sidebar/topbar, so the user has a
     clear "you're in a focused filter flow, click anywhere to dismiss"
     mental model. Earlier attempts to offset by --vz-vertical-menu-width
     fought every Velzon layout variant (lg / md / sm / sm-hover /
     horizontal / mobile) and broke in subtle ways — flat 0 is the only
     position that's correct in all of them. */
  left: 0;
  width: 340px; max-width: 88vw;
  background: #fff;
  border-right: 1.5px solid #ddd6fe;
  box-shadow: 14px 0 36px rgba(76, 29, 149, .18);
  transform: translateX(-100%);
  transition: transform .28s cubic-bezier(.4, 0, .2, 1);
  /* Has to sit above the overlay (1090) and Velzon's topbar (1002). */
  z-index: 1091;
  display: flex; flex-direction: column;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  overflow: hidden;       /* hard-clip anything that tries to grow past the drawer */
  box-sizing: border-box;
}
.prd-filter-drawer *,
.prd-filter-drawer *::before,
.prd-filter-drawer *::after { box-sizing: border-box; }
.prd-filter-drawer.open { transform: translateX(0); }

.prd-filter-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%);
  border-bottom: 1px solid #ddd6fe;
}
.prd-filter-head-title { font-size: 16px; font-weight: 800; color: #3b0764; letter-spacing: -.3px; }
.prd-filter-head-actions { display: inline-flex; gap: 6px; }
.prd-filter-icon-btn {
  width: 32px; height: 32px; border-radius: 9px;
  border: 1.5px solid #ddd6fe; background: #fff; color: #5b21b6;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s;
}
.prd-filter-icon-btn:hover { background: #f5f3ff; border-color: #c4b5fd; transform: translateY(-1px); }
.prd-filter-icon-btn.close:hover { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

.prd-filter-body {
  flex: 1; min-height: 0; min-width: 0;
  width: 100%;
  overflow-y: scroll;        /* always-visible track */
  overflow-x: hidden;        /* never grow horizontally */
  padding: 14px 14px 8px;
  display: flex; flex-direction: column; gap: 8px;
  scrollbar-width: thin; scrollbar-color: #8b5cf6 #ede9fe;
  scrollbar-gutter: stable;
}
.prd-filter-body::-webkit-scrollbar { width: 10px; }
.prd-filter-body::-webkit-scrollbar-track {
  background: #f5f3ff;
  border-left: 1px solid #ede9fe;
}
.prd-filter-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #a78bfa, #7c3aed);
  border-radius: 99px;
  border: 2px solid #f5f3ff;
  min-height: 40px;
}
.prd-filter-body::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #7c3aed, #5b21b6);
}

.prd-filter-panel {
  width: 100%; min-width: 0;
  background: #f5f3ff;
  border: 1px solid #ede9fe;
  border-radius: 10px;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
  flex-shrink: 0;     /* don't expand into siblings */
}
.prd-filter-panel.open { border-color: #c4b5fd; box-shadow: 0 2px 8px rgba(124,58,237,.1); }
.prd-filter-panel-head {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  background: transparent; border: none;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  color: #3b0764; cursor: pointer; text-align: left;
}
.prd-filter-panel-head:hover { background: #ede9fe; }
.prd-filter-panel-label { letter-spacing: -.1px; }
.prd-filter-panel-right { display: inline-flex; align-items: center; gap: 8px; color: #7c3aed; }
.prd-filter-panel-count {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px;
  background: #7c3aed; color: #fff;
  font-size: 10px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.prd-filter-chevron { transition: transform .22s ease; }
.prd-filter-panel.open .prd-filter-chevron { transform: rotate(180deg); }

.prd-filter-panel-body {
  width: 100%; min-width: 0;
  padding: 4px 10px 10px;
  background: #fff;
  border-top: 1px solid #ede9fe;
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: #ddd6fe transparent;
}
.prd-filter-panel-body::-webkit-scrollbar { width: 6px; }
.prd-filter-panel-body::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 99px; }

.prd-filter-row {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 8px;
  border-radius: 7px;
  font-size: 12px; color: #1e1b4b; font-weight: 500;
  cursor: pointer;
  transition: background .12s;
}
.prd-filter-row:hover { background: #f5f3ff; }
.prd-filter-empty {
  padding: 10px 8px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
}
.prd-filter-row input[type="checkbox"],
.prd-filter-row input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border: 1.5px solid #c4b5fd;
  background: #fff;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: background .12s, border-color .12s;
}
.prd-filter-row input[type="checkbox"] { border-radius: 4px; }
.prd-filter-row input[type="radio"] { border-radius: 50%; }
.prd-filter-row input[type="checkbox"]:checked,
.prd-filter-row input[type="radio"]:checked {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  border-color: #7c3aed;
}
.prd-filter-row input[type="checkbox"]:checked::after {
  content: ''; position: absolute; left: 4px; top: 1px;
  width: 5px; height: 9px;
  border: solid #fff; border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.prd-filter-row input[type="radio"]:checked::after {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 6px; height: 6px; border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
}

.prd-filter-clear-mini {
  margin-top: 4px;
  padding: 6px 10px;
  border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c;
  border-radius: 7px;
  font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
  align-self: flex-start;
}
.prd-filter-clear-mini:hover { background: #fee2e2; }

/* minmax(0, 1fr) instead of plain 1fr — without it, a grid track's
 * floor is min-content, so the date toggle (calendar icon + clear "×"
 * + the value text on a nowrap line) forces the TO column wider than
 * its share and bleeds past the right edge of the filter panel. */
.prd-filter-date-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 6px 4px 4px; min-width: 0; }
.prd-filter-date-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 10.5px; font-weight: 700; color: #6d28d9; letter-spacing: .04em; text-transform: uppercase; }

/* MasterDatePicker wrapper — sized to fit the compact filter row and
   tinted with the page's violet accent (same chrome the other filter
   controls use). */
.prd-filter-date-picker { width: 100%; min-width: 0; }
.prd-filter-date-picker .master-date-input,
.prd-filter-date-picker input.form-control {
  height: 34px !important;
  padding: 0 32px 0 10px !important;
  border: 1.5px solid #ddd6fe !important;
  border-radius: 8px !important;
  background: #faf5ff !important;
  color: #1e1b4b !important;
  font-size: 12px !important;
  font-family: inherit !important;
}
.prd-filter-date-picker .master-date-input:focus {
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important;
}

.prd-filter-footer {
  display: flex; gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #ede9fe;
  background: #faf5ff;
}
.prd-filter-btn {
  flex: 1;
  height: 40px; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: transform .12s, background .15s, box-shadow .15s;
}
.prd-filter-btn.ghost { background: #fff; color: #5b21b6; border: 1.5px solid #ddd6fe; }
.prd-filter-btn.ghost:hover { background: #ede9fe; border-color: #c4b5fd; }
.prd-filter-btn.primary { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border: none; box-shadow: 0 4px 12px rgba(124,58,237,.4); }
.prd-filter-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124,58,237,.5); }
.prd-filter-btn-count {
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 99px;
  background: rgba(255,255,255,.22); color: #fff;
  font-size: 10.5px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}

@media (max-width: 480px) {
  .prd-filter-drawer { width: 88vw; }
}

/* ════════════════════════════════════════════════════════════════════════════
 * Dark mode — flips backgrounds, borders, and text while keeping the violet
 * accent on the per-card chrome. The page background falls back to the
 * Velzon body color (--vz-body-bg) so the Products page reads the same as
 * the Vendors list — a plain dark slate, not a violet gradient panel.
 * ════════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .prd-root {
  background: transparent;
  color: #e9e5ff;
}

/* Header — dark */
[data-bs-theme="dark"] .prd-header {
  background: #1c2531;
  border-color: rgba(255,255,255,.08);
  box-shadow: 0 2px 12px rgba(0,0,0,.4);
}
[data-bs-theme="dark"] .prd-header-title { color: #ede9fe; }
[data-bs-theme="dark"] .prd-header-sub   { color: #a8a8a8; }

/* Status tabs — dark */
[data-bs-theme="dark"] .prd-status-tabs { background: #1a1430; border-color: #3b2a6b; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .prd-status-tab { color: #a89fc7; }
[data-bs-theme="dark"] .prd-status-tab:hover { background: #221852; color: #c4b5fd; }
[data-bs-theme="dark"] .prd-status-count { background: #2a1d5c; color: #c4b5fd; }
[data-bs-theme="dark"] .prd-shim-thumb,
[data-bs-theme="dark"] .prd-shim-bar,
[data-bs-theme="dark"] .prd-shim-pill {
  background: linear-gradient(90deg, #1a1430 0%, #221852 50%, #1a1430 100%);
  background-size: 800px 100%;
}
[data-bs-theme="dark"] .prd-card-shimmer:hover { border-color: #3b2a6b; }

/* Top filters bar */
[data-bs-theme="dark"] .prd-filters {
  background: #1a1430;
  border-color: #3b2a6b;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
[data-bs-theme="dark"] .prd-search {
  background: #110c25;
  border-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-search input { color: #ede9fe; }
[data-bs-theme="dark"] .prd-search input::placeholder { color: #6d6391; }
[data-bs-theme="dark"] .prd-ms-wrap .master-select-wrap .master-select-toggle {
  background: #110c25 !important;
  border-color: #3b2a6b !important;
  color: #d8c9ff !important;
}
[data-bs-theme="dark"] .prd-ms-wrap .master-select-wrap .master-select-toggle:hover {
  border-color: #4c1d95 !important;
}
[data-bs-theme="dark"] .prd-ms-wrap .master-select-wrap.show .master-select-toggle {
  background: #1a1430 !important;
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.18) !important;
}
[data-bs-theme="dark"] .prd-ms-wrap .master-select-placeholder { color: #6d6391 !important; }
[data-bs-theme="dark"] .prd-view-toggle {
  background: #110c25;
  border-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-view-btn { color: #c4b5fd; }

/* Meta */
[data-bs-theme="dark"] .prd-meta-count { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-meta-chip {
  background: #2a1d5c;
  border-color: #4c1d95;
  color: #ddd6fe;
}

/* Grid cards — dark variant mirrors .plan-card-v2's deep accent mesh
   so the spinning border still pops against a near-black surface. */
[data-bs-theme="dark"] .prd-card {
  background:
    linear-gradient(180deg, rgba(255,255,255,.05) 0%, transparent 18%),
    linear-gradient(180deg, color-mix(in srgb, var(--prd-accent) 16%, transparent) 0%, transparent 38%),
    radial-gradient(ellipse at top, color-mix(in srgb, var(--prd-accent) 10%, transparent) 0%, transparent 50%),
    #0f1216;
  border-color: color-mix(in srgb, var(--prd-accent) 50%, transparent);
  box-shadow:
    0 1px 0 rgba(255,255,255,.10) inset,
    0 4px 10px rgba(0,0,0,.50),
    0 14px 32px -10px color-mix(in srgb, var(--prd-accent) 55%, transparent),
    0 26px 48px -16px color-mix(in srgb, var(--prd-accent) 38%, transparent);
}
[data-bs-theme="dark"] .prd-card:hover {
  border-color: color-mix(in srgb, var(--prd-accent) 78%, transparent);
  box-shadow:
    0 1px 0 rgba(255,255,255,.16) inset,
    0 6px 14px rgba(0,0,0,.55),
    0 22px 44px -8px  color-mix(in srgb, var(--prd-accent) 75%, transparent),
    0 36px 60px -14px color-mix(in srgb, var(--prd-accent) 50%, transparent);
}
[data-bs-theme="dark"] .prd-card:hover::before { opacity: 1; }
[data-bs-theme="dark"] .prd-card-name { color: #ede9fe; }
[data-bs-theme="dark"] .prd-card-brand { color: #a89fc7; }
[data-bs-theme="dark"] .prd-card-id { color: #8579b5; }
[data-bs-theme="dark"] .prd-card-uom { color: #a89fc7; }
[data-bs-theme="dark"] .prd-card-price { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-card-pricerow { border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .prd-card-reviews { color: #8579b5; }
[data-bs-theme="dark"] .prd-card-hover-btn { background: rgba(26,20,48,.92); color: #ddd6fe; border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .prd-card-hover-btn:hover { background: #1a1430; }

/* New card pieces — dark */
[data-bs-theme="dark"] .prd-card-title-link { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-card-id-inline { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-card-id-sep    { color: #4c1d95; }
[data-bs-theme="dark"] .prd-card-name-inline { color: #ede9fe; }
[data-bs-theme="dark"] .prd-card-info-key { color: #a78bfa; }
[data-bs-theme="dark"] .prd-card-info-val { color: #ede9fe; }
[data-bs-theme="dark"] .prd-card-vendor-cell,
[data-bs-theme="dark"] .prd-card-vendor-cell svg { color: #4ade80; }
[data-bs-theme="dark"] .prd-card-haz-pill.is-nonhaz {
  background: #2a1d5c; color: #c4b5fd; border-color: #4c1d95;
}
[data-bs-theme="dark"] .prd-card-haz-pill.is-haz {
  background: #3f1d1d; color: #fca5a5; border-color: #7f1d1d;
}
[data-bs-theme="dark"] .prd-card-haz-class-key { color: #fca5a5; }
[data-bs-theme="dark"] .prd-card-haz-class-val { color: #ede9fe; }
[data-bs-theme="dark"] .prd-card-haz-text.is-nonhaz { color: #4ade80; }
[data-bs-theme="dark"] .prd-card-haz-text.is-haz    { color: #fca5a5; }
[data-bs-theme="dark"] .prd-card-segment .prd-card-info-key { color: #a89fc7; }
[data-bs-theme="dark"] .prd-card-segment .prd-card-info-val { color: #ede9fe; }
[data-bs-theme="dark"] .prd-card-status-pill { box-shadow: 0 2px 8px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .prd-card-status-pill.status-active   { background: #14241a; color: #4ade80; border-color: #14532d; }
[data-bs-theme="dark"] .prd-card-status-pill.status-inactive { background: #3f2c0a; color: #fde68a; border-color: #78350f; }
[data-bs-theme="dark"] .prd-card-status-pill.status-draft    { background: #1a1430; color: #c4b5fd; border-color: #3b2a6b; }
[data-bs-theme="dark"] .prd-card-buyrow { border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .prd-card-price-label { color: #a89fc7; }

/* List rows */
[data-bs-theme="dark"] .prd-row {
  background: #1a1430;
  border-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-row:hover { border-color: #7c3aed; box-shadow: 0 6px 18px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .prd-row-name { color: #ede9fe; }

/* Empty + no-access */
[data-bs-theme="dark"] .prd-empty {
  background: #1a1430;
  border-color: #4c1d95;
}
[data-bs-theme="dark"] .prd-empty-icon { background: #2a1d5c; }
[data-bs-theme="dark"] .prd-empty-title { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-empty-desc  { color: #a89fc7; }
[data-bs-theme="dark"] .prd-noaccess { background: #1a1430; border-color: #7f1d1d; }
[data-bs-theme="dark"] .prd-noaccess-desc { color: #a89fc7; }

/* ─── Filter sidebar — dark mode ─── */
[data-bs-theme="dark"] .prd-filter-toggle {
  background: #1a1430;
  border-color: #3b2a6b;
  color: #c4b5fd;
}
[data-bs-theme="dark"] .prd-filter-toggle:hover {
  background: #221852;
  border-color: #7c3aed;
}
[data-bs-theme="dark"] .prd-filter-toggle-badge { background: #4c1d95; color: #ede9fe; }

[data-bs-theme="dark"] .prd-filter-overlay { background: rgba(0,0,0,.6); }

[data-bs-theme="dark"] .prd-filter-drawer {
  background: #110c25;
  border-right-color: #3b2a6b;
  box-shadow: 14px 0 36px rgba(0,0,0,.7);
}
[data-bs-theme="dark"] .prd-filter-head {
  background: linear-gradient(110deg, #1c1438 0%, #2a1d5c 100%);
  border-bottom-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-filter-head-title { color: #ede9fe; }
[data-bs-theme="dark"] .prd-filter-icon-btn {
  background: #1a1430;
  border-color: #3b2a6b;
  color: #c4b5fd;
}
[data-bs-theme="dark"] .prd-filter-icon-btn:hover {
  background: #221852;
  border-color: #7c3aed;
}
[data-bs-theme="dark"] .prd-filter-icon-btn.close:hover {
  background: #3f1d1d;
  color: #fca5a5;
  border-color: #7f1d1d;
}

[data-bs-theme="dark"] .prd-filter-body { scrollbar-color: #a78bfa #221852; }
[data-bs-theme="dark"] .prd-filter-body::-webkit-scrollbar-track {
  background: #14102a;
  border-left-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-filter-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #a78bfa, #6d28d9);
  border-color: #14102a;
}
[data-bs-theme="dark"] .prd-filter-body::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #c4b5fd, #7c3aed);
}

[data-bs-theme="dark"] .prd-filter-panel {
  background: #1a1430;
  border-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-filter-panel.open {
  border-color: #7c3aed;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
[data-bs-theme="dark"] .prd-filter-panel-head { color: #ede9fe; }
[data-bs-theme="dark"] .prd-filter-panel-head:hover { background: #221852; }
[data-bs-theme="dark"] .prd-filter-panel-right { color: #c4b5fd; }

[data-bs-theme="dark"] .prd-filter-panel-body {
  background: #14102a;
  border-top-color: #3b2a6b;
  scrollbar-color: #4c1d95 transparent;
}
[data-bs-theme="dark"] .prd-filter-panel-body::-webkit-scrollbar-thumb { background: #4c1d95; }

[data-bs-theme="dark"] .prd-filter-row { color: #ddd6fe; }
[data-bs-theme="dark"] .prd-filter-row:hover { background: #221852; }
[data-bs-theme="dark"] .prd-filter-row input[type="checkbox"],
[data-bs-theme="dark"] .prd-filter-row input[type="radio"] {
  background: #110c25;
  border-color: #4c1d95;
}

[data-bs-theme="dark"] .prd-filter-clear-mini {
  background: #3f1d1d;
  border-color: #7f1d1d;
  color: #fca5a5;
}
[data-bs-theme="dark"] .prd-filter-clear-mini:hover { background: #4f1d1d; }

[data-bs-theme="dark"] .prd-filter-date-field { color: #c4b5fd; }
[data-bs-theme="dark"] .prd-filter-date-picker .master-date-input,
[data-bs-theme="dark"] .prd-filter-date-picker input.form-control {
  background: #110c25 !important;
  border-color: #3b2a6b !important;
  color: #ede9fe !important;
}
[data-bs-theme="dark"] .prd-filter-date-picker .master-date-input:focus {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.18) !important;
}
[data-bs-theme="dark"] .prd-filter-date-field input {
  background: #110c25;
  border-color: #3b2a6b;
  color: #ede9fe;
  color-scheme: dark;
}
[data-bs-theme="dark"] .prd-filter-date-field input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.18);
}

[data-bs-theme="dark"] .prd-filter-footer {
  background: #14102a;
  border-top-color: #3b2a6b;
}
[data-bs-theme="dark"] .prd-filter-btn.ghost {
  background: #1a1430;
  border-color: #3b2a6b;
  color: #c4b5fd;
}
[data-bs-theme="dark"] .prd-filter-btn.ghost:hover {
  background: #221852;
  border-color: #7c3aed;
}
`;
