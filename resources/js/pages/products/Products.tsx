import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import AddProductModal, { type AddProductPayload } from './AddProductModal';

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
  id: string;
  name: string;
  genericName: string;
  brand: string;
  segment: string;
  price: number;
  currency: string;
  rating: number;
  reviews: number;
  status: 'Active' | 'Inactive' | 'Out of Stock';
  hsn: string;
  uom: string;
  hazClass: 'HAZ' | 'NON HAZ';
  badge?: 'Best Seller' | 'New' | 'Trending' | 'Top Rated';
  thumb: string; // gradient label fallback used as a tile background
};

/* ─── Seed data ─── */
const SEED: Product[] = [
  { id:'P-001', name:'Cashew W320 Premium',     genericName:'Cashew Nuts',     brand:'GreenHarvest',  segment:'Dry Fruits',     price:1850, currency:'₹', rating:4.7, reviews:124, status:'Active',       hsn:'08013100', uom:'Kg',  hazClass:'NON HAZ', badge:'Best Seller', thumb:'linear-gradient(135deg,#fef3c7,#fbbf24)' },
  { id:'P-002', name:'Basmati Rice 1121 Premium', genericName:'Long Grain Rice', brand:'Shree Exports', segment:'Rice & Grains',  price:120,  currency:'₹', rating:4.5, reviews:287, status:'Active',       hsn:'10063020', uom:'Kg',  hazClass:'NON HAZ', badge:'Top Rated',   thumb:'linear-gradient(135deg,#dcfce7,#22c55e)' },
  { id:'P-003', name:'Turmeric Powder (Organic)', genericName:'Turmeric',        brand:'Sun Agri',      segment:'Spices',         price:240,  currency:'₹', rating:4.8, reviews:96,  status:'Active',       hsn:'09103030', uom:'Kg',  hazClass:'NON HAZ', badge:'Trending',    thumb:'linear-gradient(135deg,#fef9c3,#eab308)' },
  { id:'P-004', name:'Cold-Pressed Coconut Oil',  genericName:'Coconut Oil',     brand:'MJ Foods',      segment:'Coconut Oil',    price:450,  currency:'₹', rating:4.6, reviews:158, status:'Active',       hsn:'15131100', uom:'L',   hazClass:'NON HAZ',                       thumb:'linear-gradient(135deg,#e0f2fe,#0ea5e9)' },
  { id:'P-005', name:'Sesame Seeds (Hulled)',     genericName:'Sesame',          brand:'BrightHarvest', segment:'Seeds',          price:180,  currency:'₹', rating:4.4, reviews:64,  status:'Out of Stock', hsn:'12074090', uom:'Kg',  hazClass:'NON HAZ',                       thumb:'linear-gradient(135deg,#fef3c7,#f97316)' },
  { id:'P-006', name:'Arabica Coffee Beans',      genericName:'Coffee',          brand:'Eastern Harvest', segment:'Coffee Beans', price:680,  currency:'₹', rating:4.9, reviews:412, status:'Active',       hsn:'09011190', uom:'Kg',  hazClass:'NON HAZ', badge:'Best Seller', thumb:'linear-gradient(135deg,#fce7f3,#a16207)' },
  { id:'P-007', name:'Toor Dal Premium Grade',    genericName:'Pigeon Pea',      brand:'Delta Agro',    segment:'Pulses',         price:130,  currency:'₹', rating:4.3, reviews:78,  status:'Active',       hsn:'07136000', uom:'Kg',  hazClass:'NON HAZ',                       thumb:'linear-gradient(135deg,#fef9c3,#facc15)' },
  { id:'P-008', name:'Mango Pulp (Alphonso)',     genericName:'Mango Pulp',      brand:'Apex Foods',    segment:'Mango Pulp',     price:320,  currency:'₹', rating:4.7, reviews:189, status:'Active',       hsn:'08045010', uom:'Kg',  hazClass:'NON HAZ', badge:'New',         thumb:'linear-gradient(135deg,#fed7aa,#f97316)' },
  { id:'P-009', name:'Red Chilli Powder Spicy',   genericName:'Chilli',          brand:'Spice Route',   segment:'Spices',         price:280,  currency:'₹', rating:4.6, reviews:142, status:'Active',       hsn:'09042120', uom:'Kg',  hazClass:'NON HAZ',                       thumb:'linear-gradient(135deg,#fee2e2,#dc2626)' },
  { id:'P-010', name:'Black Pepper (Whole)',      genericName:'Black Pepper',    brand:'Spice Route',   segment:'Spices',         price:850,  currency:'₹', rating:4.8, reviews:203, status:'Active',       hsn:'09041110', uom:'Kg',  hazClass:'NON HAZ', badge:'Top Rated',   thumb:'linear-gradient(135deg,#1f2937,#374151)' },
  { id:'P-011', name:'Foxtail Millet Organic',    genericName:'Millets',         brand:'Bharat Agro',   segment:'Millets',        price:160,  currency:'₹', rating:4.4, reviews:55,  status:'Active',       hsn:'10082930', uom:'Kg',  hazClass:'NON HAZ',                       thumb:'linear-gradient(135deg,#fef3c7,#d97706)' },
  { id:'P-012', name:'Industrial Ethanol 99%',    genericName:'Ethanol',         brand:'SunGrow',       segment:'Chemicals',      price:95,   currency:'₹', rating:4.2, reviews:18,  status:'Active',       hsn:'22072000', uom:'L',   hazClass:'HAZ',                          thumb:'linear-gradient(135deg,#fecaca,#ef4444)' },
];

const SEGMENTS = ['All Segments', 'Dry Fruits', 'Rice & Grains', 'Spices', 'Coconut Oil', 'Seeds', 'Coffee Beans', 'Pulses', 'Mango Pulp', 'Millets', 'Chemicals'];
const STATUSES = ['All Status', 'Active', 'Inactive', 'Out of Stock'];

export default function Products() {
  const { user } = useAuth();
  const toast = useToast();

  const [products, setProducts] = useState<Product[]>(SEED);
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('All Segments');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'recent' | 'price-asc' | 'price-desc' | 'rating'>('recent');
  const [addOpen, setAddOpen] = useState(false);

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

    const sorted = [...src];
    if (sort === 'price-asc')  sorted.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    if (sort === 'rating')     sorted.sort((a, b) => b.rating - a.rating);
    return sorted;
  }, [products, q, segment, statusFilter, sort]);

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

  // Build a Product card from the wizard payload — segment, pricing,
  // dimensions etc. all flow through so the new card actually reflects
  // what the user typed (instead of placeholder defaults).
  const onSaved = (p: AddProductPayload) => {
    const id = `P-${String(products.length + 1).padStart(3, '0')}`;
    const thumbGradients = [
      'linear-gradient(135deg,#e9d5ff,#a78bfa)',
      'linear-gradient(135deg,#dcfce7,#22c55e)',
      'linear-gradient(135deg,#fef3c7,#f59e0b)',
      'linear-gradient(135deg,#dbeafe,#3b82f6)',
      'linear-gradient(135deg,#fecaca,#ef4444)',
    ];
    const newProd: Product = {
      id,
      name: p.name || 'Untitled Product',
      genericName: p.genericName || '—',
      brand: p.brand || '—',
      segment: p.segment || 'Dry Fruits',
      price: p.totalPrice || p.basePrice || 0,
      currency: '₹',
      rating: 0,
      reviews: 0,
      status: 'Active',
      hsn: p.hsn || '—',
      uom: p.uom || '—',
      hazClass: p.hazType === 'HAZ' ? 'HAZ' : 'NON HAZ',
      badge: 'New',
      thumb: thumbGradients[products.length % thumbGradients.length],
    };
    setProducts(prev => [newProd, ...prev]);
    toast.success('Product Created', `${newProd.name} added to catalog`);
  };

  return (
    <div className="prd-root">
      <style>{SCOPED_CSS}</style>

      {/* Hero header */}
      <div className="prd-header">
        <span className="prd-accent" />
        <span className="prd-glow" />
        <div className="prd-header-left">
          <div className="prd-avatar-wrap">
            <div className="prd-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <span className="prd-online-dot" />
          </div>
          <div>
            <div className="prd-header-title">Products</div>
            <div className="prd-header-sub">Manage your product catalog — pricing, compliance, vendors and documents in one place</div>
          </div>
        </div>
        <button className="prd-add-btn" onClick={() => setAddOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add Product
        </button>
      </div>

      {/* Filters bar */}
      <div className="prd-filters">
        <div className="prd-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input
            type="text"
            placeholder="Search products by name, brand, HSN, segment…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="prd-select" value={segment} onChange={(e) => setSegment(e.target.value)}>
          {SEGMENTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="prd-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="prd-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">Sort: Recent</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="rating">Top Rated</option>
        </select>
        <div className="prd-view-toggle">
          <button className={`prd-view-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')} aria-label="Grid view" title="Grid view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
          </button>
          <button className={`prd-view-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} aria-label="List view" title="List view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1.2" /><circle cx="4" cy="12" r="1.2" /><circle cx="4" cy="18" r="1.2" /></svg>
          </button>
        </div>
      </div>

      {/* Result count */}
      <div className="prd-meta">
        <span className="prd-meta-count">{filtered.length} {filtered.length === 1 ? 'product' : 'products'}</span>
        {q && <span className="prd-meta-chip">Search: <strong>{q}</strong></span>}
        {segment !== 'All Segments' && <span className="prd-meta-chip">Segment: <strong>{segment}</strong></span>}
        {statusFilter !== 'All Status' && <span className="prd-meta-chip">Status: <strong>{statusFilter}</strong></span>}
      </div>

      {/* Grid / List view */}
      {filtered.length === 0 ? (
        <div className="prd-empty">
          <div className="prd-empty-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          </div>
          <div className="prd-empty-title">No products found</div>
          <div className="prd-empty-desc">Try clearing filters, or click "Add Product" to create a new one.</div>
        </div>
      ) : view === 'grid' ? (
        <div className="prd-grid">
          {filtered.map(p => <ProductCard key={p.id} product={p} onAction={(act) => toast.info(act, `${act}: ${p.name}`)} />)}
        </div>
      ) : (
        <div className="prd-list">
          {filtered.map(p => <ProductRow key={p.id} product={p} onAction={(act) => toast.info(act, `${act}: ${p.name}`)} />)}
        </div>
      )}

      {addOpen && (
        <AddProductModal
          onClose={() => setAddOpen(false)}
          onSubmit={(payload) => { setAddOpen(false); onSaved(payload); }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Product Card (Amazon / Flipkart style)
 * ════════════════════════════════════════════════════════════════════════ */
function ProductCard(props: { product: Product; onAction: (label: string) => void }) {
  const { product, onAction } = props;
  return (
    <div className="prd-card">
      {product.badge && <span className={`prd-card-badge prd-badge-${product.badge.replace(/\s+/g, '').toLowerCase()}`}>{product.badge}</span>}
      <div className="prd-card-thumb" style={{ background: product.thumb }}>
        <div className="prd-card-thumb-letter">{product.name.charAt(0).toUpperCase()}</div>
        <div className="prd-card-hover">
          <button className="prd-card-hover-btn" onClick={() => onAction('View')}>View</button>
          <button className="prd-card-hover-btn primary" onClick={() => onAction('Edit')}>Edit</button>
          <button className="prd-card-hover-btn danger" onClick={() => onAction('Delete')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </div>
        {product.hazClass === 'HAZ' && <span className="prd-card-haz">HAZ</span>}
      </div>
      <div className="prd-card-body">
        <div className="prd-card-id">{product.id} · {product.hsn}</div>
        <div className="prd-card-name" title={product.name}>{product.name}</div>
        <div className="prd-card-brand">by {product.brand} · {product.segment}</div>
        <div className="prd-card-meta">
          <span className="prd-card-rating">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            {product.rating.toFixed(1)}
          </span>
          <span className="prd-card-reviews">({product.reviews})</span>
          <span className={`prd-card-status status-${product.status.replace(/\s+/g, '').toLowerCase()}`}>{product.status}</span>
        </div>
        <div className="prd-card-pricerow">
          <span className="prd-card-price">{product.currency}{product.price.toLocaleString()}</span>
          <span className="prd-card-uom">/ {product.uom}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── List view row ─── */
function ProductRow(props: { product: Product; onAction: (label: string) => void }) {
  const { product, onAction } = props;
  return (
    <div className="prd-row">
      <div className="prd-row-thumb" style={{ background: product.thumb }}>{product.name.charAt(0).toUpperCase()}</div>
      <div className="prd-row-info">
        <div className="prd-card-id">{product.id} · HSN {product.hsn}</div>
        <div className="prd-row-name">{product.name}</div>
        <div className="prd-card-brand">by {product.brand} · {product.segment} · {product.genericName}</div>
      </div>
      <div className="prd-row-rating">
        <span className="prd-card-rating">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          {product.rating.toFixed(1)}
        </span>
        <span className="prd-card-reviews">({product.reviews})</span>
      </div>
      <div className="prd-row-status">
        <span className={`prd-card-status status-${product.status.replace(/\s+/g, '').toLowerCase()}`}>{product.status}</span>
        {product.hazClass === 'HAZ' && <span className="prd-row-haz">HAZ</span>}
      </div>
      <div className="prd-row-price">
        <div className="prd-card-price">{product.currency}{product.price.toLocaleString()}</div>
        <div className="prd-card-uom">per {product.uom}</div>
      </div>
      <div className="prd-row-actions">
        <button className="prd-card-hover-btn" onClick={() => onAction('View')}>View</button>
        <button className="prd-card-hover-btn primary" onClick={() => onAction('Edit')}>Edit</button>
        <button className="prd-card-hover-btn danger" onClick={() => onAction('Delete')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
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
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 40%, #ede9fe 100%);
  padding: 14px 18px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 14px;
}
.prd-root *, .prd-root *::before, .prd-root *::after { box-sizing: border-box; }

/* Hero header */
.prd-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 18px; min-height: 66px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 40%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 16px;
  box-shadow: 0 2px 0 rgba(255,255,255,.85) inset, 0 8px 28px rgba(139,92,246,.2);
}
.prd-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 16px 0 0 16px; }
.prd-glow { position: absolute; right: -20px; top: -20px; width: 130px; height: 130px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.prd-header-left { display: flex; align-items: center; gap: 13px; z-index: 1; padding-left: 6px; }
.prd-avatar-wrap { position: relative; flex-shrink: 0; }
.prd-header-icon {
  width: 44px; height: 44px; border-radius: 13px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 14px rgba(124,58,237,.4), 0 0 0 3px rgba(139,92,246,.18);
}
.prd-online-dot { position: absolute; bottom: -1px; right: -1px; width: 11px; height: 11px; border-radius: 50%; background: linear-gradient(135deg,#4ade80,#22c55e); border: 2px solid #f3e8ff; }
.prd-header-title { font-size: 16px; font-weight: 800; color: #3b0764; letter-spacing: -.3px; }
.prd-header-sub { font-size: 11.5px; color: #7c3aed; margin-top: 2px; font-weight: 500; }

.prd-add-btn {
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px; border-radius: 12px; border: none;
  background: #7c3aed; color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
  box-shadow: 0 6px 20px rgba(124,58,237,.5), 0 1px 0 rgba(255,255,255,.18) inset;
  transition: transform .15s, background .15s, box-shadow .15s;
  z-index: 1;
}
.prd-add-btn:hover { background: #6d28d9; transform: translateY(-2px); box-shadow: 0 10px 28px rgba(124,58,237,.6); }
.prd-add-btn:active { transform: translateY(0); }

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

.prd-select {
  height: 40px; padding: 0 12px;
  border: 1.5px solid #ddd6fe; border-radius: 10px;
  background: #fff; color: #5b21b6;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  outline: none;
}
.prd-select:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }

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

/* ─── Grid ─── */
.prd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(238px, 1fr));
  gap: 16px;
}
.prd-card {
  position: relative;
  background: #fff; border: 1.5px solid #e8e4f9;
  border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: column;
  transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s, border-color .15s;
  cursor: pointer;
}
.prd-card:hover {
  transform: translateY(-6px) scale(1.01);
  border-color: #c4b5fd;
  box-shadow: 0 18px 36px rgba(124,58,237,.22);
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

.prd-card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 5px; }
.prd-card-id { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #94a3b8; text-transform: uppercase; }
.prd-card-name { font-size: 13.5px; font-weight: 800; color: #1e1b4b; line-height: 1.3; min-height: 35px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.prd-card-brand { font-size: 11px; color: #6b7280; }
.prd-card-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.prd-card-rating { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 800; color: #b45309; padding: 2px 7px; border-radius: 6px; background: #fef3c7; border: 1px solid #fde68a; }
.prd-card-reviews { font-size: 10.5px; color: #94a3b8; font-weight: 600; }
.prd-card-status { margin-left: auto; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 800; letter-spacing: .02em; }
.status-active   { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.status-inactive { background: #f3f4f6; color: #475569; border: 1px solid #e2e8f0; }
.status-outofstock { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.prd-card-pricerow { display: flex; align-items: baseline; gap: 5px; margin-top: 4px; padding-top: 8px; border-top: 1px dashed #ede9fe; }
.prd-card-price { font-size: 17px; font-weight: 800; color: #5b21b6; }
.prd-card-uom { font-size: 10.5px; color: #6b7280; font-weight: 600; }

/* ─── List view ─── */
.prd-list { display: flex; flex-direction: column; gap: 10px; }
.prd-row {
  display: grid;
  grid-template-columns: 80px 1fr 130px 130px 130px auto;
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
`;
