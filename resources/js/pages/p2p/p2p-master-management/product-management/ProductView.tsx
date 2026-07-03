import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './product-management.css';
import { useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import AddProductModal from './AddProductModal';


type AnyRec = Record<string, unknown>;

// Zero-pad the trailing number in a product code to 3 digits (e.g. P-1 -> P-001),
// matching the list cards. Keeps any non-numeric code untouched.
function formatProductCode(raw: string): string {
  const m = raw.match(/^(.*?)(\d+)\s*$/);
  if (!m) return raw;
  const prefix = m[1] || 'P-';
  return `${prefix}${m[2].padStart(3, '0')}`;
}

// A mapping's stored vendor_code can be stale (captured at map time). Resolve
// the supplier code live from the linked vendor — same rule the supplier list
// uses (vendor_code ?? S-<id>) — so renames/code changes always propagate.
function resolveSupplierCode(v: Record<string, unknown>): string {
  const vendor = v.vendor as { vendor_code?: string | null } | null | undefined;
  const vendorId = v.vendor_id as number | null | undefined;
  const raw =
    (vendor?.vendor_code && String(vendor.vendor_code)) ||
    (vendorId ? `S-${String(vendorId).padStart(3, '0')}` : '') ||
    (v.vendor_code ? String(v.vendor_code) : '');
  return raw ? formatProductCode(raw) : '—';
}

type ProductDto = {
  id: number;
  product_code: string;
  name: string;
  generic_name: string | null;
  description: string | null;
  brand: string | null;
  haz_type: string | null;
  confidential_info: string | null;
  primary_image: string | null;
  primary_image_url: string | null;
  secondary_images: string[] | null;
  secondary_images_url: string[] | null;
  base_price: string | number | null;
  gst_amount: string | number | null;
  total_price: string | number | null;
  mark_bottom: string | null;
  net_weight: string | number | null;
  gross_weight: string | number | null;
  length_cm: string | number | null;
  width_cm: string | number | null;
  height_cm: string | number | null;
  batch_no: string | null;
  serial_no: string | null;
  cat_no: string | null;
  lot_no: string | null;
  status: string;
  step_completed: number;
  segment: AnyRec | null;
  haz_class: AnyRec | null;
  uom: AnyRec | null;
  hsn: AnyRec | null;
  condition: AnyRec | null;
  packaging_material: AnyRec | null;
  gst_percentage: AnyRec | null;
  qc_records: AnyRec[];
  vendor_maps: AnyRec[];
  created_at?: string | null;
  updated_at?: string | null;
};

export default function ProductView(props: { productId?: number; onClose?: () => void } = {}) {
  // Dual-mode: as a route it reads the :id param and "Back" navigates to the
  // list; as a popup (opened from a product card) it takes `productId` and
  // `onClose`, so it renders over the list instead of full-screen.
  const params = useParams<{ id: string }>();
  const id = props.productId != null ? String(props.productId) : params.id;
  const navigate = useNavigate();
  const goBack = () => { if (props.onClose) props.onClose(); else navigate('/products'); };
  const toast = useToast();

  const [product, setProduct] = useState<ProductDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'desc' | 'brand' | 'confidential' | 'qc' | 'suppliers'>('desc');
  const [activeImg, setActiveImg] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  // Qty stepper for the buy bar (presentation only — mirrors the prototype).
  // Declared with the other hooks so it always runs before any early return.
  const [qty, setQty] = useState(1);
  // Mapped Suppliers popup (opened from the header button).
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  // When true, the Edit modal opens straight into the Map Supplier form.
  const [supplierMapMode, setSupplierMapMode] = useState(false);
  // Inline price-edit for a single mapped-supplier row. Only the purchase
  // price is editable; GST amount and total recompute live from the row's
  // fixed GST %.
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceEditVal, setPriceEditVal] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);

  /* QC documents come from the same `segment_doc_uploads` table the Add
   * Product wizard writes to (category = 'qc'). Surfaced here so the
   * read-only product view shows what's been attached against each
   * QC slot from the product's segment rule. */
  type QcUpload = { id: number; doc_code: string; doc_name: string; attachment_name: string | null; attachment_url: string | null; requirement: 'M' | 'O' | null };
  const [qcUploads, setQcUploads] = useState<QcUpload[]>([]);

  /* Map a raw segment_uploads row (server shape) into the QcUpload UI shape.
   * Shared between the bundled extract inside load() and the standalone
   * loadQcUploads() fallback used by onReload after individual QC uploads. */
  const mapQcRow = (r: any): QcUpload => ({
    id:              Number(r.id),
    doc_code:        String(r.doc_code ?? ''),
    doc_name:        String(r.doc_name ?? ''),
    attachment_name: r.attachment_name ?? null,
    attachment_url:  r.attachment_url ?? null,
    requirement:     r.requirement ?? null,
  });

  /* Standalone QC reload — kept as the `onReload` callback for individual
   * QC upload actions (QcRowActions). The initial page load no longer
   * calls this — segment_uploads now arrives bundled in /products/{id}
   * (see load() below), saving one round-trip on first paint. */
  const loadQcUploads = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get(`/segment-uploads/product/${id}?category=qc`);
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      setQcUploads(rows.map(mapQcRow));
    } catch {
      /* silent — empty table just means "no QC docs uploaded yet" */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const load = async (silent = false) => {
    if (!id) return;
    // Silent reloads (triggered from inside the edit modal's Save & Next)
    // must NOT flip the shimmer flag — doing so swaps the whole page out
    // for the placeholder, unmounts the open <AddProductModal>, and then
    // re-mounts it fresh after the fetch. That re-mount resets the
    // wizard's local tab state back to 'core', which manifested as
    // "Save & Next on Product Core re-renders the same step".
    if (!silent) setLoading(true);
    try {
      const res = await api.get<ProductDto & { segment_uploads?: { data?: any[] } }>(`/products/${id}`);
      setProduct(res.data);
      setActiveImg(0);
      /* QC uploads embedded in the same response — drop the separate
       * GET /segment-uploads/product/{id}?category=qc round-trip.
       * Production network panel showed that call costing ~1.7s on
       * cbc.idims.in (boot tax + network latency). Backwards-compat:
       * if the server hasn't been deployed with the bundled key yet,
       * segment_uploads is undefined and we fall back to the standalone
       * fetch so the QC table still hydrates. */
      const bundled = res.data?.segment_uploads?.data;
      if (Array.isArray(bundled)) {
        setQcUploads(bundled.map(mapQcRow));
      } else {
        void loadQcUploads();
      }
    } catch {
      toast.error('Not Found', 'Product not available');
      goBack();
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const images = useMemo(() => {
    if (!product) return [] as string[];
    const list: (string | null | undefined)[] = [
      product.primary_image_url ?? product.primary_image,
      ...((product.secondary_images_url ?? product.secondary_images ?? []) as string[]),
    ];
    return list
      .map(p => (typeof p === 'string' && p.startsWith('blob:') ? '' : p))
      .map(p => (p ? resolveFileUrl(p) : ''))
      .filter((s): s is string => Boolean(s));
  }, [product]);

  // Auto-advance the hero gallery every 4s, looping through all images.
  // Pauses while the user hovers the main image so they can inspect it.
  const [galleryPaused, setGalleryPaused] = useState(false);
  useEffect(() => {
    if (images.length < 2 || galleryPaused) return;
    const t = setInterval(() => setActiveImg(i => (i + 1) % images.length), 4000);
    return () => clearInterval(t);
  }, [images.length, galleryPaused]);

  if (loading) {
    // Shimmer placeholder that mirrors the actual layout: image strip
    // on the left, header + info blocks on the right. Beats a single
    // "Loading…" message because the user sees the page structure
    // immediately and the perceived load time drops sharply.
    return (
      <div className="pv2-root">
        <div className="pv2-shell">
          <div className="pv2-grid">
            <div className="pv2-gallery">
              <div className="pv2-thumbs">
                <div className="pv2-shimmer" style={{ height: 60, borderRadius: 8 }} />
                <div className="pv2-shimmer" style={{ height: 60, borderRadius: 8 }} />
                <div className="pv2-shimmer" style={{ height: 60, borderRadius: 8 }} />
              </div>
              <div className="pv2-shimmer pv2-main-shimmer" />
            </div>
            <div className="pv2-info">
              <div className="pv2-shimmer" style={{ height: 32, width: '60%', marginBottom: 12, borderRadius: 6 }} />
              <div className="pv2-shimmer" style={{ height: 18, width: '40%', marginBottom: 24, borderRadius: 4 }} />
              <div className="pv2-info-grid">
                <div className="pv2-info-block">
                  <div className="pv2-shimmer" style={{ height: 16, width: 140, marginBottom: 12, borderRadius: 4 }} />
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="pv2-shimmer" style={{ height: 14, width: i % 2 ? '70%' : '85%', marginBottom: 10, borderRadius: 4 }} />
                  ))}
                </div>
                <div className="pv2-info-block">
                  <div className="pv2-shimmer" style={{ height: 16, width: 140, marginBottom: 12, borderRadius: 4 }} />
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="pv2-shimmer" style={{ height: 14, width: i % 2 ? '60%' : '80%', marginBottom: 10, borderRadius: 4 }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!product) return null;

  // Active / Inactive mirrors the product list: a product is "Active" once it
  // has at least one mapped supplier, "Inactive" otherwise. (Basing it on the
  // raw `status` column drifted from the list, which shows every stale-status
  // product as Active regardless of supplier mapping.)
  const isActive = product.vendor_maps.length > 0;
  const statusText = isActive ? 'Active' : 'Inactive';
  const isHaz = String(product.haz_type ?? '').toLowerCase() === 'haz';

  const segmentName    = (product.segment?.title as string) ?? '—';
  const hazClassName   = (product.haz_class?.name as string) ?? '—';
  const uomName        = (product.uom?.short_code as string) ?? (product.uom?.title as string) ?? '—';
  const hsnCode        = (product.hsn?.hsn_code as string) ?? '—';
  const conditionName  = (product.condition?.title as string) ?? '—';
  const packagingName  = (product.packaging_material?.title as string) ?? '—';
  const gstPct         = Number(product.gst_percentage?.percentage ?? 0);

  const fmtMoney = (v: string | number | null | undefined) =>
    v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const gstAmtStr = fmtMoney(product.gst_amount);
  const baseStr   = fmtMoney(product.base_price);
  const totalStr  = fmtMoney(product.total_price);

  const startPriceEdit = (mapId: number, current: string | number | null) => {
    setPriceEditId(mapId);
    setPriceEditVal(current == null || current === '' ? '' : String(Number(current)));
  };
  const cancelPriceEdit = () => { setPriceEditId(null); setPriceEditVal(''); };
  const savePriceEdit = async (mapId: number) => {
    const price = Number(priceEditVal);
    if (priceEditVal.trim() === '' || !Number.isFinite(price) || price < 0) {
      toast.error('Invalid price', 'Enter a purchase price of 0 or more.');
      return;
    }
    setPriceSaving(true);
    try {
      const res = await api.patch(`/products/${product.id}/vendor-maps/${mapId}`, { purchase_price: price });
      // The PATCH response only carries vendorMaps/qcRecords, not the
      // display relations (segment, hsn, uom, …). Merge just the refreshed
      // mappings so the rest of the loaded product stays intact.
      const fresh = res.data as ProductDto;
      setProduct(prev => (prev ? { ...prev, vendor_maps: fresh.vendor_maps ?? prev.vendor_maps } : prev));
      cancelPriceEdit();
      toast.success('Price updated', 'Purchase price, GST and total have been recalculated.');
    } catch {
      toast.error('Update failed', 'Could not update the purchase price. Please try again.');
    } finally {
      setPriceSaving(false);
    }
  };

  return (
    <div className="pv2-root pv2pd-root">

      {/* ─── HERO ─── */}
      <div className="pv2pd-hero">
        <div className="pv2pd-hero-row">
          <div className="pv2pd-hero-main">
            <h2 className="pv2pd-title">
              <span className="pv2pd-code">{formatProductCode(product.product_code)}</span>
              <span className="pv2pd-title-sep">|</span> {product.name}
            </h2>
          </div>
          <div className="pv2pd-hero-btns">
            <button className="pv2pd-hbtn pv2pd-hbtn--edit" onClick={() => setEditOpen(true)}>
              {/* Exact prototype icon (Feather "edit" — pen-to-square). */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> Edit Product
            </button>
            <button className="pv2pd-hbtn pv2pd-hbtn--suppliers" onClick={() => setSuppliersOpen(true)}>
              {/* Exact prototype icon (Feather "users" — two people). */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> Mapped Suppliers
            </button>
            <button className="pv2pd-hbtn pv2pd-hbtn--ghost" onClick={goBack}>
              <i className="ri-arrow-left-s-line" /> Back to Product List
            </button>
          </div>
        </div>
      </div>

      {/* ─── BODY ─── */}
      <div className="pv2pd-body">
        {/* LEFT: gallery + price card + buy bar */}
        <div className="pv2pd-gallery">
          <div
            className="pv2pd-main-img"
            onMouseEnter={() => setGalleryPaused(true)}
            onMouseLeave={() => setGalleryPaused(false)}
          >
            {images.length > 0 ? (
              <img src={images[activeImg]} alt={product.name} />
            ) : (
              <span className="pv2pd-main-empty">{product.name?.charAt(0)?.toUpperCase() || 'P'}</span>
            )}
            <span className={`pv2pd-chip pv2pd-chip--onimg pv2pd-chip--${isActive ? 'active' : 'inactive'}`}>
              <span className="pv2pd-chip-dot" />{statusText}
            </span>
          </div>

          {images.length > 0 && (
            <div className="pv2pd-thumbs">
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`pv2pd-thumb ${i === activeImg ? 'is-active' : ''}`}
                  onClick={() => setActiveImg(i)}
                  aria-label={`Thumbnail ${i + 1}`}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}

          {/* Dark purple price card */}
          <div className="pv2pd-pricecard">
            <div className="pv2pd-pc-top">
              <div>
                <div className="pv2pd-pc-label">Selling Price</div>
                <div className="pv2pd-pc-price">{baseStr}<small>/-</small></div>
                <div className="pv2pd-pc-uom">per {uomName}</div>
              </div>
              <div className="pv2pd-pc-break">
                Base {baseStr}<br />GST {gstPct.toFixed(0)}% &nbsp;{gstAmtStr}
              </div>
            </div>
            <div className="pv2pd-pc-total">
              <span>Total incl. GST</span><b>{totalStr}/-</b>
            </div>
          </div>

          {/* Buy bar (presentation only) */}
          <div className="pv2pd-buybar">
            <div className="pv2pd-qty">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Decrease">−</button>
              <input value={qty} readOnly />
              <button onClick={() => setQty(q => q + 1)} aria-label="Increase">+</button>
            </div>
            <button className="pv2pd-act pv2pd-act--wish" onClick={() => toast.info('Wishlist', `${product.name} added to wishlist`)}>
              <i className="ri-heart-line" /> Add to Wishlist
            </button>
            <button className="pv2pd-act pv2pd-act--cart" onClick={() => toast.success('Cart', `${product.name} added to cart`)}>
              <i className="ri-shopping-cart-2-line" /> Add to Cart
            </button>
          </div>
        </div>

        {/* RIGHT: Product Details highlights + tabs */}
        <div className="pv2pd-infocol">
          <div className="pv2pd-info">
            {/* Product Details card */}
            <div className="pv2pd-sec pv2pd-details">
              <div className="pv2pd-sec__title">
                <span className="pv2pd-sec__ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></span>
                Product Details
              </div>
              <div className="pv2pd-highlights">
                {/* Tile icons are the EXACT Feather SVGs from the P2P Figma
                  prototype (.pd-hl__ico): briefcase / tag / check-circle
                  (or alert-triangle when hazardous) / box / tag / package. */}
                <div className="pv2pd-hl pv2pd-hl--v">
                  <span className="pv2pd-hl__ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">HSN Code</span><span className="pv2pd-hl__v" title={hsnCode}>{hsnCode}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--g">
                  <span className="pv2pd-hl__ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">Segment</span><span className="pv2pd-hl__v" title={segmentName}>{segmentName}</span></span>
                </div>
                <div className={`pv2pd-hl ${isHaz ? 'pv2pd-hl--h' : 'pv2pd-hl--c'}`}>
                  <span className="pv2pd-hl__ico">{isHaz
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}</span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">{isHaz ? 'Hazardous' : 'Non-Hazardous'}</span><span className="pv2pd-hl__v" title={isHaz ? hazClassName : 'No'}>{isHaz ? (hazClassName !== '—' ? hazClassName : 'Yes') : 'No'}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--c">
                  <span className="pv2pd-hl__ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">UOM</span><span className="pv2pd-hl__v" title={uomName}>{uomName}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--a">
                  <span className="pv2pd-hl__ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">Condition</span><span className="pv2pd-hl__v" title={conditionName}>{conditionName}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--p">
                  <span className="pv2pd-hl__ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">Packaging Material</span><span className="pv2pd-hl__v" title={packagingName}>{packagingName}</span></span>
                </div>
              </div>
            </div>

            {/* Tabs card */}
            <div className="pv2pd-sec pv2pd-sec--tabs">
              <div className="pv2pd-tabs">
                <button className={`pv2pd-tab ${tab === 'desc' ? 'is-active' : ''}`}         onClick={() => setTab('desc')}>Product Description</button>
                <button className={`pv2pd-tab ${tab === 'brand' ? 'is-active' : ''}`}        onClick={() => setTab('brand')}>Make / Brand / Specifications</button>
                <button className={`pv2pd-tab ${tab === 'confidential' ? 'is-active' : ''}`} onClick={() => setTab('confidential')}>Confidential Info</button>
              </div>
              <div className="pv2pd-tab-body">
                {tab === 'desc' && (
                  <p className="pv2pd-tab-text">{product.description || <em className="pv2pd-muted">No description provided.</em>}</p>
                )}
                {tab === 'brand' && (
                  <div className="pv2pd-tab-rich">
                    <p className="pv2pd-tab-text">{product.brand || <em className="pv2pd-muted">No make / brand / specifications recorded.</em>}</p>
                  </div>
                )}
                {tab === 'confidential' && (
                  <div className="pv2pd-tab-rich">
                    <p className="pv2pd-tab-text">{product.confidential_info || <em className="pv2pd-muted">No confidential info recorded.</em>}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editOpen && (
        <AddProductModal
          productId={product.id}
          /* Hand the already-loaded product so the modal can skip its
           * own /products/{id} refetch. Production network panel
           * showed that duplicate call costing ~2 sec. */
          initialProduct={product}
          openSupplierMap={supplierMapMode}
          onClose={() => { setEditOpen(false); setSupplierMapMode(false); }}
          onSaved={(_pid, finalised) => {
            // Silent refresh — see load()'s note. We want the underlying
            // ProductView card to reflect the new data once the user
            // closes the modal, but we must NOT unmount the modal while
            // it's still mid-wizard, or its local tab/step state resets.
            void load(true);
            if (finalised) setEditOpen(false);
          }}
        />
      )}

      {/* Mapped Suppliers popup — opened from the header "Mapped Suppliers"
          button. Lists this product's vendor mappings (prototype design). */}
      {suppliersOpen && createPortal((
        <div className="pv2pd-sup-overlay" onClick={() => setSuppliersOpen(false)}>
          <div className="pv2pd-sup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pv2pd-sup-head">
              <div className="pv2pd-sup-head-ico"><i className="ri-team-line" /></div>
              <div className="pv2pd-sup-head-txt">
                <div className="pv2pd-sup-title">Mapped Suppliers</div>
                <div className="pv2pd-sup-sub">Suppliers linked to this product with purchase price &amp; GST</div>
              </div>
              <button className="pv2pd-sup-close" onClick={() => setSuppliersOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="pv2pd-sup-body">
              <div className="pv2pd-sup-bar">
                <span className="pv2pd-sup-countpill">{product.vendor_maps.length} supplier{product.vendor_maps.length !== 1 ? 's' : ''} mapped</span>
                <button className="pv2pd-sup-map" onClick={() => { setSuppliersOpen(false); setSupplierMapMode(true); setEditOpen(true); }}>
                  <i className="ri-add-line" /> Map Supplier
                </button>
              </div>
              {product.vendor_maps.length === 0 ? (
                <div className="pv2pd-sup-empty">No suppliers mapped yet. Click "Map Supplier" to begin.</div>
              ) : (
                <div className="pv2pd-sup-tablewrap">
                  <table className="pv2pd-sup-table">
                    <thead>
                      <tr>
                        <th>Sr No</th><th>Supplier</th><th>Code</th><th>Type</th><th>State</th><th>Contact</th>
                        <th>Price (₹)</th><th>GST %</th><th>GST (₹)</th><th>Total (₹)</th><th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.vendor_maps.map((v, i) => {
                        const mapId = Number(v.id);
                        const rowGstPct = Number(v.gst_percentage ?? 0);
                        return (
                        <tr key={String((v.id as number | string) ?? i)}>
                          <td><span className="pv2pd-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                          <td className="pv2pd-sup-cname">{String(v.vendor_name ?? '—')}</td>
                          <td><span className="pv2pd-sup-code">{resolveSupplierCode(v)}</span></td>
                          <td>{String(v.vendor_type ?? v.type ?? '—')}</td>
                          <td>{String(v.state ?? '—')}</td>
                          <td className="pv2pd-sup-cperson">{String(v.contact_person ?? '—')}</td>
                          <td>{fmtMoney(v.purchase_price as string | number | null)}</td>
                          <td>{`${rowGstPct.toFixed(0)}%`}</td>
                          <td>{fmtMoney(v.gst_amount as string | number | null)}</td>
                          <td className="pv2pd-sup-ctotal">{fmtMoney(v.total_amount as string | number | null)}</td>
                          <td>
                            <button
                              className="pv2pd-sup-edit"
                              title="Edit purchase price"
                              onClick={() => startPriceEdit(mapId, v.purchase_price as string | number | null)}
                            >
                              <i className="ri-pencil-line" /> Edit
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="pv2pd-sup-foot">
              <button className="pv2pd-sup-closebtn" onClick={() => setSuppliersOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Edit Mapped Supplier — the same Map Supplier form (apm-mv design)
          re-opened in edit mode. Everything is read-only except the purchase
          price; GST amount and total recompute live from the row's fixed
          GST %. Save posts only the price to the per-row PATCH endpoint so
          the other columns can't be clobbered. Backdrop click does NOT close
          (matches the Map Supplier form) — header ✕ / Cancel only. */}
      {priceEditId != null && (() => {
        const editRow = product.vendor_maps.find(v => Number(v.id) === priceEditId);
        if (!editRow) return null;
        const mapId = priceEditId;
        const rowGstPct = Number(editRow.gst_percentage ?? 0);
        const p = Number(priceEditVal);
        const valid = priceEditVal.trim() !== '' && Number.isFinite(p) && p >= 0;
        const gstAmt = valid ? (p * rowGstPct) / 100 : 0;
        const total = valid ? p + gstAmt : 0;
        return createPortal((
          <div className="apm-mv-backdrop">
            <div className="apm-mv-popup">
              <div className="apm-mv-popup-head">
                <div className="apm-mv-popup-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  <div>
                    <div className="apm-mv-popup-title-main">Edit Mapped Supplier</div>
                    <div className="apm-mv-popup-title-sub">Update the purchase price — GST &amp; total recalculate automatically</div>
                  </div>
                </div>
                <button className="apm-close apm-mv-close" onClick={cancelPriceEdit} aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>

              <div className="apm-mv-popup-body">
                <div className="apm-grid-3">
                  <div className="apm-field">
                    <span className="apm-field-label">Supplier Name</span>
                    <input className="apm-input apm-readonly" value={String(editRow.vendor_name ?? '')} readOnly />
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">Supplier Code</span>
                    <input className="apm-input apm-readonly" value={resolveSupplierCode(editRow)} readOnly placeholder="—" />
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">Supplier Type</span>
                    <input className="apm-input apm-readonly" value={String(editRow.vendor_type ?? editRow.type ?? '—')} readOnly />
                  </div>

                  <div className="apm-field">
                    <span className="apm-field-label">State</span>
                    <input className="apm-input apm-readonly" value={String(editRow.state ?? '—')} readOnly />
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">Contact Person</span>
                    <input className="apm-input apm-readonly" value={String(editRow.contact_person ?? '—')} readOnly />
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">Purchase Price (₹) <span className="apm-req">*</span></span>
                    <div className="apm-input-icon">
                      <span className="apm-input-icon-prefix">₹</span>
                      <input
                        className="apm-input has-prefix"
                        type="number" min="0" step="0.01" autoFocus
                        placeholder="Enter purchase price"
                        value={priceEditVal}
                        disabled={priceSaving}
                        onChange={(e) => setPriceEditVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') savePriceEdit(mapId); if (e.key === 'Escape') cancelPriceEdit(); }}
                      />
                    </div>
                  </div>

                  <div className="apm-field">
                    <span className="apm-field-label">GST %</span>
                    <input className="apm-input apm-readonly" value={rowGstPct ? `${rowGstPct.toFixed(0)}%` : '—'} readOnly title="GST % comes from the product's Sales Config" />
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">GST Amount (₹)</span>
                    <div className="apm-input-icon">
                      <span className="apm-input-icon-prefix">₹</span>
                      <input className="apm-input has-prefix apm-readonly" value={valid ? gstAmt.toFixed(2) : ''} readOnly placeholder="Auto-computed" />
                    </div>
                  </div>
                  <div className="apm-field">
                    <span className="apm-field-label">Total Amount (₹)</span>
                    <div className="apm-input-icon">
                      <span className="apm-input-icon-prefix">₹</span>
                      <input className="apm-input has-prefix apm-readonly apm-total" value={valid ? total.toFixed(2) : ''} readOnly placeholder="Auto-computed" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="apm-mv-popup-foot">
                <button className="apm-btn-ghost" onClick={cancelPriceEdit} disabled={priceSaving}>Cancel</button>
                <button className="apm-btn-primary" onClick={() => savePriceEdit(mapId)} disabled={priceSaving || !valid}>
                  {priceSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        ), document.body);
      })()}
    </div>
  );
}

/* View / Download / Re-upload — mirrors the Evidence Vault action set so
 * the read-only product page can swap a QC attachment without bouncing
 * through the full Add Product wizard. Re-upload posts to the same
 * segment-uploads endpoint that the wizard writes to. */
function QcRowActions({ doc, productId, onReload, toast }: {
  doc: { id: number; doc_code: string; doc_name: string; attachment_name: string | null; attachment_url: string | null };
  productId: number;
  onReload: () => Promise<void> | void;
  toast: ReturnType<typeof useToast>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const canViewOrDownload = !!doc.attachment_url;

  const download = () => {
    if (!doc.attachment_url) return;
    const a = document.createElement('a');
    a.href = doc.attachment_url;
    a.download = doc.attachment_name || '';
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  };

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('category', 'qc');
      fd.append('doc_code', doc.doc_code);
      fd.append('doc_name', doc.doc_name || doc.doc_code);
      fd.append('attachment', f);
      await api.post(`/segment-uploads/product/${productId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await onReload();
      toast.success('Re-uploaded', f.name);
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message ?? 'Could not save the QC document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d-inline-flex align-items-center gap-1">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        onChange={e => { void onPick(e.target.files?.[0] ?? undefined); e.currentTarget.value = ''; }}
      />
      <Tooltip label={canViewOrDownload ? `View ${doc.attachment_name}` : 'No attachment yet'}>
        <a
          href={canViewOrDownload ? doc.attachment_url! : undefined}
          target={canViewOrDownload ? '_blank' : undefined}
          rel="noreferrer"
          aria-disabled={!canViewOrDownload}
          className={`btn btn-sm btn-soft-info ${!canViewOrDownload ? 'disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) e.preventDefault(); }}
          aria-label="View"
        >
          <i className="ri-eye-line" />
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? `Download ${doc.attachment_name}` : 'No attachment yet'}>
        <button
          type="button"
          disabled={!canViewOrDownload}
          onClick={download}
          className="btn btn-sm btn-soft-secondary"
          aria-label="Download"
        >
          <i className="ri-download-2-line" />
        </button>
      </Tooltip>
      <Tooltip label={busy ? 'Uploading…' : (doc.attachment_name ? 'Re-upload (replace file)' : 'Upload')}>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn btn-sm btn-soft-primary"
          aria-label={doc.attachment_name ? 'Re-upload' : 'Upload'}
        >
          <i className={busy ? 'ri-loader-4-line' : (doc.attachment_name ? 'ri-refresh-line' : 'ri-upload-2-line')} />
        </button>
      </Tooltip>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
