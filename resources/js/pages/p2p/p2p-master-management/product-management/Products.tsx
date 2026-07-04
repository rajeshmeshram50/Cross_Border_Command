import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import './product-management.css';
import { readProductMasterBundle, writeProductMasterBundle } from './productBundleCache';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import AddProductModal from './AddProductModal';
import ProductView from './ProductView';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import Tooltip from '../../../../components/ui/Tooltip';

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

/* Per-card accent colour (drives the thumb tint + segment badge), keyed
   off the numeric id so a product keeps the same accent across reloads.
   Palette mirrors the agriculture greens/ambers of the P2P prototype. */
const PRODUCT_ACCENTS = ['#16a34a', '#ca8a04', '#eab308', '#f59e0b', '#65a30d', '#d97706', '#84cc16', '#dc2626', '#22c55e', '#a16207', '#0891b2', '#7c3aed'];

/* Sample a loaded image's average colour so the segment badge can tint to
   match the product photo. Returns null if the canvas is tainted (cross-origin
   image without CORS headers) or the read fails — caller falls back to --acc. */
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
      if (data[i + 3] < 125) continue; // skip transparent pixels
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return null;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    // Darken very light averages so the white badge text stays legible.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 160) { const f = 160 / lum; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

/* Normalize a product code so the trailing number is always 3 digits
   (P-1 → P-001, P-03 → P-003, P-119 stays P-119). Codes without a trailing
   number are shown untouched. */
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
  const toast = useToast();
  const navigate = useNavigate();
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
  /* Product detail opens as a popup over the list (not a full-screen route).
     Clicking a card sets this; the ProductView renders inside a modal. */
  const [detailId, setDetailId] = useState<number | null>(null);
  const [brefOpen, setBrefOpen] = useState(false);

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
  const [hazClassOpts, setHazClassOpts] = useState<string[]>([]);
  const [vendorOpts,  setVendorOpts]    = useState<string[]>(VENDORS);
  const [gstRateOpts, setGstRateOpts]   = useState<string[]>(GST_RATES);
  /* Product Owner options — sourced from /products/owners. The endpoint
     scopes the list to the caller's own branch users (every branch is an
     isolated peer). The old `PRODUCT_OWNERS` const was generic role labels
     (Branch Admin, Inventory Manager…) that never matched a real
     `created_by` row, so the filter never selected anything. */
  type OwnerOpt = { id: number; name: string; branchId: number | null; branchName: string };
  const [ownerOpts, setOwnerOpts] = useState<OwnerOpt[]>([]);

  useEffect(() => {
    /* Filter dropdowns source from the SAME /products/master-bundle
     * payload the Add Product modal uses. Previously this effect fired
     * 5 separate /master/* calls (segments, hsn_codes, uom, conditions,
     * gst_percentage) plus /vendors?per_page=200 — six round-trips on
     * every Products page load. The page already preloads the bundle
     * into sessionStorage on mount (see the warm-bundle useEffect
     * below), so reading from cache is usually instant; on cache miss
     * we fetch the bundle ourselves and write it back so the modal
     * benefits too.
     *
     * /products/owners stays a separate call — it's not master data
     * and the list shape (branch metadata) doesn't fit the bundle.
     */
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

    const applyBundle = (b: Bundle) => {
      const seg  = (b.segments  ?? []).map(r => r.title ?? r.name ?? '').filter(Boolean);
      const hsn  = (b.hsn_codes ?? []).map(r => r.hsn_code ?? '').filter(Boolean);
      // UOM options must mirror what the product card actually shows.
      // apiToCard maps p.uom = short_code ?? title (e.g. "kg" for the
      // "Kilogram" master row), so the filter has to do the same.
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
      if (gst.length)  setGstRateOpts(dedupe(gst));
      if (ven.length)  setVendorOpts(dedupe(ven));
    };

    (async () => {
      // Try cache first — the page-mount preload usually populates it.
      const cached = readProductMasterBundle<Bundle>();
      if (cached) {
        applyBundle(cached);
      } else {
        // Cache miss → fetch and persist. The modal's own effect will
        // hit the same cache, so even on first load the bundle fires
        // at most once.
        try {
          const res = await api.get<Bundle>('/products/master-bundle');
          applyBundle(res.data);
          writeProductMasterBundle(res.data);
        } catch { /* leave dropdowns on their hardcoded defaults */ }
      }

      // Product Owner dropdown — pulls the user list the backend says
      // is in scope (the caller's own branch users). Empty list means the
      // role has no use for the filter (e.g. client_admin) and the panel
      // will just render empty. Kept as a separate fetch because the shape
      // doesn't fit the master bundle.
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
    // Lock the page scroll while the filter drawer is open so the list
    // behind it can't scroll under the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
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

  /* ─── Load list ───
   * We deliberately fetch BOTH active + inactive products in one call
   * (no `status` query param) so the Active / Inactive tab counts can
   * be derived live from the filter-applied set. The previous version
   * filtered server-side by the selected tab and the stats endpoint
   * returned org-wide totals, so applying any sidebar filter never
   * moved the badge numbers. */
  const refresh = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const params: Record<string, string | number> = { per_page: 200 };
      // Vendor deep-link narrows the universe but still loads every
      // status under that vendor.
      if (vendorFilterId) params.vendor_id = vendorFilterId;

      const list = await api.get<{ data: Record<string, unknown>[] }>('/products', { params });
      setProducts(list.data.data.map(apiToCard));
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, vendorFilterId]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Lock the page scroll while the detail popup is open so the list behind
     it stays put instead of scrolling under the fixed overlay. */
  useEffect(() => {
    if (detailId == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [detailId]);

  // NOTE: previously there was a separate `requestIdleCallback` preload
  // here that warmed /products/master-bundle for the Add Product modal.
  // It was removed because the filter-dropdowns useEffect above already
  // fetches the same bundle (cache-first + writes sessionStorage on
  // miss), and the AddProductModal reads from that same cache. Keeping
  // both effects fired the network request TWICE on first page load —
  // both effects checked the empty cache, both raced to fetch. Now the
  // filter effect is the single source of truth that fills the cache.

  /* Everything-except-status filter. Drives both the visible grid
   * (after we further narrow by the Active/Inactive tab) and the
   * counts on those two tabs — so applying any sidebar filter (Vendor,
   * GST, Created Date, etc.) updates both tab numbers, not just the
   * currently-shown rows. */
  const filteredAllStatus = useMemo(() => {
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
    if (filters.hazClass.length) src = src.filter(p => filters.hazClass.includes(p.hazClassName));
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
    return src;
  }, [products, q, segment, statusFilter, filters]);

  /* Tab counts derived from the filter-applied set. The two tabs split
   * the catalogue by supplier mapping (matches the shared design):
   *   • "Supplier Mapped Products"  → at least one vendor mapped
   *   • "Zero Supplier Products"    → no vendor mapped yet
   * The green/red "Active / Inactive" pills describe each bucket's
   * procurement readiness, not the product's own status column. */
  const stats = useMemo(() => ({
    active:   filteredAllStatus.filter(p => p.vendorCount > 0).length,
    inactive: filteredAllStatus.filter(p => p.vendorCount === 0).length,
  }), [filteredAllStatus]);

  const filtered = useMemo(() => {
    let src = statusTab === 'active'
      ? filteredAllStatus.filter(p => p.vendorCount > 0)
      : filteredAllStatus.filter(p => p.vendorCount === 0);

    const sorted = [...src];
    if (sort === 'price-asc')  sorted.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    if (sort === 'rating')     sorted.sort((a, b) => b.rating - a.rating);

    if (filters.topProducts) {
      const n = parseInt(filters.topProducts.replace(/\D/g, ''), 10);
      return [...sorted].sort((a, b) => b.rating - a.rating).slice(0, n);
    }

    return sorted;
  }, [filteredAllStatus, statusTab, sort, filters.topProducts]);

  /* ─── Dynamic pagination ───
   * Mirrors the Customers / TableContainer behaviour: the page size is
   * computed to FIT the viewport instead of being a fixed number, so the
   * card grid (or list) never spills past the bottom of the screen — the
   * overflow rolls onto the next page. We measure the results container's
   * top offset, the real card/row height, and (for the grid) how many
   * columns the CSS auto-fill produced, then pageSize = cols × rows that
   * fit. Recomputed on resize, view switch, data load, and filter change. */
  const resultsRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  /* Auto-fit on by default: the page size is computed to show 2 rows of
     cards (grid) / a viewport-fit number of rows (list). The moment the
     user picks an explicit value from the "Rows per page" dropdown we flip
     this off and respect their choice until the next view switch. */
  const autoFitRef = useRef(true);

  // Any change to the visible set jumps back to page 1 so the user never
  // lands on a now-empty trailing page after filtering. Switching view
  // also re-enables auto-fit (grid and list want different row counts).
  useEffect(() => { setPage(1); }, [q, segment, statusFilter, statusTab, sort, filters, vendorFilterId, view]);
  useEffect(() => { autoFitRef.current = true; }, [view]);

  useEffect(() => {
    if (loading) return;
    const el = resultsRef.current;
    if (!el) return;
    const fit = () => {
      if (!autoFitRef.current) return;
      // Measure the grid/list region's OWN height — it's a fixed flex body
      // inside the fixed-height panel (see .prd-panel CSS), exactly like the
      // My Workplace worksheet measures its scroll wrap's clientHeight. This
      // is more robust than viewport math: the pager is pinned below, so
      // whatever height the container has, we fill it with rows that fit and
      // the overflow rolls onto the next page.
      const cs = getComputedStyle(el);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const avail = el.clientHeight - padY;
      if (avail <= 0) return;
      if (view === 'list') {
        const rowH = (el.querySelector('.prd-row') as HTMLElement | null)?.offsetHeight || 84;
        const rowGap = parseFloat(cs.rowGap) || 10;
        const rows = Math.max(4, Math.floor(avail / (rowH + rowGap)));
        setPageSize(rows);
      } else {
        // Show exactly TWO rows of cards. The column count stays dynamic (CSS
        // auto-fit produces N columns at the current width), so the page size =
        // cols × 2 and the number of products adjusts automatically as the grid
        // re-flows on zoom / resize.
        const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length || 4);
        const rows = 2;
        setPageSize(cols * rows);
      }
    };
    // ResizeObserver keeps the fit correct as the container resizes (window
    // resize, brief-box collapse/expand, layout switch) without listening to
    // window forever. The container height is fixed by flex, so setPageSize
    // can't feed back into a resize loop.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    const t = window.setTimeout(fit, 120);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [loading, view, filtered.length]);

  const setRowsPerPage = (n: number) => { autoFitRef.current = false; setPageSize(n); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamp if the page count shrank below the current page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

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

      {/* Header strip — purple "Product Management" hero (ported from the
          P2P prototype .cstrip design). */}
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

      {/* WHAT WE ARE DOING HERE — collapsible 5-step guide (ported .bref-box) */}
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

      {/* Product panel — toolbar + card grid + pagination in ONE container
          (matches the prototype .pl-panel). */}
      <div className="prd-panel">
      {/* Toolbar — supplier-mapping tabs + search + Filter (ported .pl-toolbar) */}
      <div className="prd-toolbar">
        <div className="prd-tabs">
          <button
            type="button"
            className={`prd-tab ${statusTab === 'active' ? 'is-active' : ''}`}
            onClick={() => setStatusTab('active')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            <span>Supplier Mapped Products</span>
            <span className="prd-tab-badge prd-tab-badge--active"><span className="prd-tab-badge-dot" />Active<span className="prd-tab-badge-count">{stats.active}</span></span>
          </button>
          <button
            type="button"
            className={`prd-tab ${statusTab === 'inactive' ? 'is-active' : ''}`}
            onClick={() => setStatusTab('inactive')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /><line x1="3.5" y1="20.5" x2="20.5" y2="3.5" /></svg>
            <span>Zero Supplier Products</span>
            <span className="prd-tab-badge prd-tab-badge--inactive"><span className="prd-tab-badge-dot" />Inactive<span className="prd-tab-badge-count">{stats.inactive}</span></span>
          </button>
        </div>
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

      {/* Vendor deep-link banner — shown only when the page is
          filtered to a specific vendor's mapped products. Clearing
          it pops the query params off the URL and restores the
          status-tab default list. */}
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

      {/* Active-filter chips — only rendered when at least one is set, so the
          panel shows no empty gap between the toolbar and the card grid. */}
      {(q || segment !== 'All Segments' || statusFilter !== 'All Status') && (
        <div className="prd-meta">
          {q && <span className="prd-meta-chip">Search: <strong>{q}</strong></span>}
          {segment !== 'All Segments' && <span className="prd-meta-chip">Segment: <strong>{segment}</strong></span>}
          {statusFilter !== 'All Status' && <span className="prd-meta-chip">Status: <strong>{statusFilter}</strong></span>}
        </div>
      )}

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
                onAction={(act) => {
                  if (act === 'View')        setDetailId(p.apiId);
                  else if (act === 'Edit')   handleEdit(p);
                  else if (act === 'Delete') handleDelete(p);
                  else                       toast.info(act, `${act}: ${p.name}`);
                }}
              />
            ))}
          </div>
          <ProductPagination page={page} totalPages={totalPages} pageSize={pageSize} total={filtered.length} onPage={setPage} onRowsPerPage={setRowsPerPage} />
        </>
      ) : (
        <>
          <div className="prd-list" ref={resultsRef}>
            {paged.map(p => (
              <ProductRow
                key={p.apiId}
                product={p}
                onAction={(act) => {
                  if (act === 'View')        setDetailId(p.apiId);
                  else if (act === 'Edit')   handleEdit(p);
                  else if (act === 'Delete') handleDelete(p);
                  else                       toast.info(act, `${act}: ${p.name}`);
                }}
              />
            ))}
          </div>
          <ProductPagination page={page} totalPages={totalPages} pageSize={pageSize} total={filtered.length} onPage={setPage} onRowsPerPage={setRowsPerPage} />
        </>
      )}
      </div>{/* /prd-panel */}

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

      {/* Product detail — opens as a popup over the list (not a full page). */}
      {detailId != null && createPortal((
        <div className="prd-detail-overlay" onClick={() => setDetailId(null)}>
          <div className="prd-detail-modal" onClick={(e) => e.stopPropagation()}>
            <ProductView
              productId={detailId}
              onClose={() => { setDetailId(null); refresh(); }}
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
          <FilterPanel label="Product GST Rate" panelKey="gstRate" open={expandedPanel === 'gstRate'} onToggle={togglePanel} count={filters.gstRate.length}>
            {gstRateOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.gstRate.includes(v)} onChange={() => toggleMulti('gstRate', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Segment" panelKey="segment" open={expandedPanel === 'segment'} onToggle={togglePanel} count={filters.segment.length}>
            {segmentOpts.filter(s => s !== 'All Segments').map(v => (
              <CheckRow key={v} label={v} checked={filters.segment.includes(v)} onChange={() => toggleMulti('segment', v)} />
            ))}
          </FilterPanel>

          {/* Created Date pulled up to position 3.
              Its calendar popup is portalled & fixed-positioned, but when
              the trigger sits near the bottom of the long sidebar the
              floating month grid renders OVER the subsequent collapsible
              panels — Product Owner / Inward Count read as "ghosting"
              behind the calendar. Moving the panel near the top means
              the popup has the full sidebar height below it to expand
              into without overlapping any unrelated controls. */}
          <FilterPanel label="Product Creation Date" panelKey="createdDate" open={expandedPanel === 'createdDate'} onToggle={togglePanel} count={(filters.createdFrom ? 1 : 0) + (filters.createdTo ? 1 : 0)}>
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

          <FilterPanel label="Product HSN/SAC Code" panelKey="hsn" open={expandedPanel === 'hsn'} onToggle={togglePanel} count={filters.hsn.length}>
            {hsnOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.hsn.includes(v)} onChange={() => toggleMulti('hsn', v)} />
            ))}
          </FilterPanel>

          {/* Hazard Type is mutually exclusive — a product is either HAZ
              or NON HAZ, never both. Render as radio rows so the user
              can only pick one; clicking the active row again clears
              it (returns to "any"). The underlying filters.hazType
              stays a string[] for type consistency with the other
              multi-select filters, but it never holds more than one
              entry, so the include() match in filtered still works. */}
          <FilterPanel label="Product Hazard Type" panelKey="hazType" open={expandedPanel === 'hazType'} onToggle={togglePanel} count={filters.hazType.length}>
            {HAZ_TYPES.map(v => {
              const selected = filters.hazType[0] === v;
              return (
                <label key={v} className="prd-filter-row">
                  <input
                    type="radio"
                    name="hazType"
                    checked={selected}
                    onChange={() => setFilters(prev => ({ ...prev, hazType: [v] }))}
                    onClick={() => {
                      // Click on the already-selected radio clears it,
                      // giving the user a way to drop the filter without
                      // hunting for a separate Reset.
                      if (selected) setFilters(prev => ({ ...prev, hazType: [] }));
                    }}
                  />
                  <span>{v}</span>
                </label>
              );
            })}
            {filters.hazType.length > 0 && (
              <button className="prd-filter-clear-mini" onClick={() => setFilters(prev => ({ ...prev, hazType: [] }))}>Clear selection</button>
            )}
          </FilterPanel>

          {/* Haz Classification — the master haz_class the product carries
              (e.g. "Class 3 — Flammable Liquid"). Multi-select against the
              product's hazClassName. Only HAZ products carry one. */}
          <FilterPanel label="Product Haz Classification" panelKey="hazClass" open={expandedPanel === 'hazClass'} onToggle={togglePanel} count={filters.hazClass.length}>
            {hazClassOpts.length === 0 ? (
              <div className="prd-filter-empty">No haz classifications available</div>
            ) : hazClassOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.hazClass.includes(v)} onChange={() => toggleMulti('hazClass', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Unit of Measurement" panelKey="uom" open={expandedPanel === 'uom'} onToggle={togglePanel} count={filters.uom.length}>
            {uomOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.uom.includes(v)} onChange={() => toggleMulti('uom', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Condition" panelKey="condition" open={expandedPanel === 'condition'} onToggle={togglePanel} count={filters.condition.length}>
            {conditionOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.condition.includes(v)} onChange={() => toggleMulti('condition', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Supplier" panelKey="vendor" open={expandedPanel === 'vendor'} onToggle={togglePanel} count={filters.vendor.length}>
            {vendorOpts.map(v => (
              <CheckRow key={v} label={v} checked={filters.vendor.includes(v)} onChange={() => toggleMulti('vendor', v)} />
            ))}
          </FilterPanel>

          <FilterPanel label="Product Score Range" panelKey="scoreRange" open={expandedPanel === 'scoreRange'} onToggle={togglePanel} count={filters.scoreRange.length}>
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

          <FilterPanel label="Product Owner" panelKey="productOwner" open={expandedPanel === 'productOwner'} onToggle={togglePanel} count={filters.productOwner.length}>
            {ownerOpts.length === 0 ? (
              <div className="prd-filter-empty">No owners available</div>
            ) : ownerOpts.map(o => {
              /* Append the branch suffix only when the list spans more
                 than one branch, so two people named "Ravi" in different
                 branches stay distinguishable; redundant noise otherwise. */
              const showBranch = ownerOpts.some(x => x.branchId !== o.branchId);
              const label = showBranch && o.branchName ? `${o.name} · ${o.branchName}` : o.name;
              const id = String(o.id);
              return (
                <CheckRow key={id} label={label} checked={filters.productOwner.includes(id)} onChange={() => toggleMulti('productOwner', id)} />
              );
            })}
          </FilterPanel>

          <FilterPanel label="Product Inward Count" panelKey="inwardCount" open={expandedPanel === 'inwardCount'} onToggle={togglePanel} count={filters.inwardCount.length}>
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
 * Pagination footer
 *
 * Mirrors the Sales Lead Worksheet pager (Showing X–Y of Z · Rows per page ·
 * page / total pill · circular prev/next arrows), tinted to the Products
 * page's violet palette. Lives as a footer band inside the same card as the
 * grid / list, so list + pagination read as one container.
 * ════════════════════════════════════════════════════════════════════════ */
const ROWS_PER_PAGE_OPTIONS = [8, 12, 16, 24, 48];

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

/* ════════════════════════════════════════════════════════════════════════════
 * Product Card (Amazon / Flipkart style)
 * ════════════════════════════════════════════════════════════════════════ */
function ProductCard(props: {
  product: Product;
  onAction: (label: string) => void;
}) {
  const { product, onAction } = props;
  // Show the primary image; drop to the tinted-icon fallback if it 404s.
  const [imgOk, setImgOk] = useState(true);
  // Segment badge colour sampled from the product image (falls back to --acc).
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
        <span className="prd-pcard-thumb-seg" style={segColor ? { background: segColor } : undefined}>{product.segment}</span>
        <span className={`prd-pcard-status prd-pcard-status--${isActive ? 'active' : 'inactive'}`}>
          <span className="prd-pcard-status-dot" />{isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="prd-pcard-body">
        <div className="prd-pcard-title" title={`${product.id} | ${product.name}`} onClick={() => onAction('View')} style={{ cursor: 'pointer' }}>
          <span className="prd-pcard-code">{product.id}</span>
          <span className="prd-pcard-sep">|</span>
          {product.name}
        </div>

        <div className="prd-pcard-info">
          <span className="prd-pcard-info-item"><span className="prd-pcard-info-k">HSN</span><span className="prd-pcard-info-v">{product.hsn}</span></span>
          <span className="prd-pcard-info-div" />
          <span className="prd-pcard-info-item"><span className="prd-pcard-info-k">GST</span><span className="prd-pcard-info-v">{product.gstRate}%</span></span>
          <span className="prd-pcard-info-div" />
          <span className="prd-pcard-info-item prd-pcard-info-item--supplier">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
            {suppliers} Supplier{suppliers !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="prd-pcard-line3">
          {product.hazClass === 'HAZ' ? (
            <span className="prd-pcard-haz prd-pcard-haz--yes" title={product.hazClassName ? `Hazardous: ${product.hazClassName}` : 'Hazardous'}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <span className="prd-pcard-haz-txt">{product.hazClassName ? `Hazardous: ${product.hazClassName}` : 'Hazardous'}</span>
            </span>
          ) : (
            <span className="prd-pcard-haz prd-pcard-haz--no" title="Non-Hazardous">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span className="prd-pcard-haz-txt">Non-Hazardous</span>
            </span>
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
        <Tooltip label="Delete product">
          <button className="prd-card-hover-btn danger" aria-label="Delete product" onClick={(e) => { e.stopPropagation(); onAction('Delete'); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </Tooltip>
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
