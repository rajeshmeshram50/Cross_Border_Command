import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import AddProductModal from './AddProductModal';


type AnyRec = Record<string, unknown>;

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

  if (loading) {
    // Shimmer placeholder that mirrors the actual layout: image strip
    // on the left, header + info blocks on the right. Beats a single
    // "Loading…" message because the user sees the page structure
    // immediately and the perceived load time drops sharply.
    return (
      <div className="pv2-root">
        <style>{SCOPED_CSS}</style>
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

  return (
    <div className="pv2-root pv2pd-root">
      <style>{SCOPED_CSS}</style>

      {/* ─── HERO ─── */}
      <div className="pv2pd-hero">
        <div className="pv2pd-hero-row">
          <div className="pv2pd-hero-main">
            <h2 className="pv2pd-title">
              <span className="pv2pd-code">{product.product_code}</span>
              <span className="pv2pd-title-sep">|</span> {product.name}
            </h2>
          </div>
          <div className="pv2pd-hero-btns">
            <button className="pv2pd-hbtn pv2pd-hbtn--edit" onClick={() => setEditOpen(true)}>
              <i className="ri-edit-box-line" /> Edit Product
            </button>
            <button className="pv2pd-hbtn pv2pd-hbtn--suppliers" onClick={() => setSuppliersOpen(true)}>
              <i className="ri-team-line" /> Mapped Suppliers
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
          <div className="pv2pd-main-img">
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
                <span className="pv2pd-sec__ico"><i className="ri-file-list-3-line" /></span>
                Product Details
              </div>
              <div className="pv2pd-highlights">
                <div className="pv2pd-hl pv2pd-hl--v">
                  <span className="pv2pd-hl__ico"><i className="ri-price-tag-3-line" /></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">HSN Code</span><span className="pv2pd-hl__v" title={hsnCode}>{hsnCode}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--g">
                  <span className="pv2pd-hl__ico"><i className="ri-price-tag-line" /></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">Segment</span><span className="pv2pd-hl__v" title={segmentName}>{segmentName}</span></span>
                </div>
                <div className={`pv2pd-hl ${isHaz ? 'pv2pd-hl--h' : 'pv2pd-hl--c'}`}>
                  <span className="pv2pd-hl__ico"><i className={isHaz ? 'ri-alarm-warning-line' : 'ri-checkbox-circle-line'} /></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">{isHaz ? 'Hazardous' : 'Non-Hazardous'}</span><span className="pv2pd-hl__v" title={isHaz ? hazClassName : 'No'}>{isHaz ? (hazClassName !== '—' ? hazClassName : 'Yes') : 'No'}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--c">
                  <span className="pv2pd-hl__ico"><i className="ri-scales-3-line" /></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">UOM</span><span className="pv2pd-hl__v" title={uomName}>{uomName}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--a">
                  <span className="pv2pd-hl__ico"><i className="ri-shield-check-line" /></span>
                  <span className="pv2pd-hl__txt"><span className="pv2pd-hl__k">Condition</span><span className="pv2pd-hl__v" title={conditionName}>{conditionName}</span></span>
                </div>
                <div className="pv2pd-hl pv2pd-hl--p">
                  <span className="pv2pd-hl__ico"><i className="ri-archive-line" /></span>
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
                    <h4 className="pv2pd-tab-h">Make / Brand</h4>
                    <p className="pv2pd-tab-text">{product.brand || <em className="pv2pd-muted">No brand / make / specifications recorded.</em>}</p>
                    <h4 className="pv2pd-tab-h">Specifications</h4>
                    <div className="pv2pd-tab-rows">
                      <SpecRow k="Generic Name"       v={product.generic_name || '—'} />
                      <SpecRow k="Segment"            v={segmentName} />
                      <SpecRow k="HSN Code"           v={hsnCode} />
                      <SpecRow k="UOM"                v={uomName} />
                      <SpecRow k="Condition"          v={conditionName} />
                      <SpecRow k="Packaging Material" v={packagingName} />
                      <SpecRow k="Hazard"             v={isHaz ? (hazClassName !== '—' ? hazClassName : 'Hazardous') : 'Non-Hazardous'} accent={isHaz ? 'amber' : 'green'} />
                    </div>
                  </div>
                )}
                {tab === 'confidential' && (
                  <div className="pv2pd-tab-rich">
                    <h4 className="pv2pd-tab-h">Restricted Information</h4>
                    <p className="pv2pd-tab-text">{product.confidential_info || 'Confidential pricing, margin structure and preferred-supplier terms are restricted to authorised procurement users only.'}</p>
                    <h4 className="pv2pd-tab-h">Commercials</h4>
                    <div className="pv2pd-tab-rows">
                      <SpecRow k="Base Price"       v={baseStr} />
                      <SpecRow k="GST"              v={gstPct ? `${gstPct.toFixed(2)}%` : '—'} />
                      <SpecRow k="Mapped Suppliers" v={String(product.vendor_maps.length)} />
                    </div>
                    <h4 className="pv2pd-tab-h">Notes</h4>
                    <p className="pv2pd-tab-text">Negotiated rates, rebate slabs and exclusive supplier agreements are visible only to users with procurement-admin access. Do not share outside the authorised group.</p>
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
                        <th>Price (₹)</th><th>GST %</th><th>GST (₹)</th><th>Total (₹)</th><th aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {product.vendor_maps.map((v, i) => (
                        <tr key={String((v.id as number | string) ?? i)}>
                          <td><span className="pv2pd-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                          <td className="pv2pd-sup-cname">{String(v.vendor_name ?? '—')}</td>
                          <td><span className="pv2pd-sup-code">{String(v.vendor_code ?? '—')}</span></td>
                          <td>{String(v.vendor_type ?? v.type ?? '—')}</td>
                          <td>{String(v.state ?? '—')}</td>
                          <td className="pv2pd-sup-cperson">{String(v.contact_person ?? '—')}</td>
                          <td>{fmtMoney(v.purchase_price as string | number | null)}</td>
                          <td>{`${Number(v.gst_percentage ?? 0).toFixed(0)}%`}</td>
                          <td>{fmtMoney(v.gst_amount as string | number | null)}</td>
                          <td className="pv2pd-sup-ctotal">{fmtMoney(v.total_amount as string | number | null)}</td>
                          <td>
                            <button
                              className="pv2pd-sup-del"
                              title="Manage mappings from Edit Product"
                              onClick={() => toast.info('Manage suppliers', 'Add or remove supplier mappings from Edit Product.')}
                            >×</button>
                          </td>
                        </tr>
                      ))}
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
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Spec / commercial key-value row — matches the prototype's .pd-tab-row. */
function SpecRow(props: { k: string; v: string; accent?: 'green' | 'amber' }) {
  const hasValue = props.v && props.v !== '—';
  const val = <span className={`pv2pd-tab-row__v${props.accent ? ` pv2pd-tab-row__v--${props.accent}` : ''}`}>{props.v}</span>;
  return (
    <div className="pv2pd-tab-row">
      <span className="pv2pd-tab-row__k">{props.k}</span>
      {hasValue ? <Tooltip label={props.v} position="top" maxWidth={320}>{val}</Tooltip> : val}
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
const SCOPED_CSS = `
.pv2-root {
  font-family: var(--font-sans);
  background: #f8fafc;
  padding: 14px 18px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  display: flex; flex-direction: column; gap: 14px;
}
.pv2-root *, .pv2-root *::before, .pv2-root *::after { box-sizing: border-box; }
.pv2-loading { padding: 60px 20px; text-align: center; color: #6b7280; font-weight: 600; }

/* Shimmer placeholder — animated gradient sweep that approximates the
   loaded layout. Mirrors the .pv2-grid two-column structure. */
@keyframes pv2-shimmer-sweep {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.pv2-shimmer {
  background: linear-gradient(90deg, #f5f3ff 25%, #ede9fe 37%, #f5f3ff 63%);
  background-size: 200% 100%;
  animation: pv2-shimmer-sweep 1.4s ease-in-out infinite;
  border-radius: 6px;
}
.pv2-main-shimmer { flex: 1; min-height: 280px; border-radius: 12px; }
[data-bs-theme="dark"] .pv2-shimmer,
[data-layout-mode="dark"] .pv2-shimmer {
  background: linear-gradient(90deg, #1a1430 25%, #2a1d5c 37%, #1a1430 63%);
  background-size: 200% 100%;
}

/* Surface card */
.pv2-card {
  background: #fff;
  border: 1px solid var(--vz-border-color, #e9ebec);
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,.04);
  position: relative;
  overflow: hidden;
}

/* ── Top card ── */
.pv2-top { padding: 0; }
.pv2-top-grid {
  /* Shared hero height — image (left) and info column (right) both pin to
     this so they end at the same baseline. Tune here to change both. */
  --pv2-hero-h: 400px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 24px;
  padding: 18px 20px 20px;
}

/* Gallery */
.pv2-gallery { display: grid; grid-template-columns: 110px 1fr; gap: 12px; min-width: 0; align-items: start; }
.pv2-thumbs {
  display: flex; flex-direction: column; gap: 10px;
  width: 110px;
  max-height: var(--pv2-hero-h, 400px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: #c4b5fd transparent;
  scrollbar-gutter: stable;
}
.pv2-thumbs::-webkit-scrollbar { width: 6px; height: 0; }
.pv2-thumbs::-webkit-scrollbar:horizontal { display: none; height: 0; }
.pv2-thumbs::-webkit-scrollbar-track { background: transparent; }
.pv2-thumbs::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #a78bfa, #7c3aed);
  border-radius: 99px;
}
.pv2-thumbs::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #7c3aed, #5b21b6); }
.pv2-thumb {
  width: 110px; height: 90px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #f8fafc;
  cursor: pointer; padding: 0; overflow: hidden; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: border-color .15s, transform .12s;
}
.pv2-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pv2-thumb.on { border-color: #7c3aed; transform: scale(1.03); }
.pv2-thumb:hover { border-color: #c4b5fd; }
.pv2-thumb-empty { color: #94a3b8; font-size: 22px; font-weight: 800; }

.pv2-main-image {
  /* Fixed hero height — the right-side info column is pinned to this same
     value (--pv2-hero-h) so the two columns end at the same baseline and
     the product info is arranged within the image's height. */
  height: var(--pv2-hero-h, 400px);
  border-radius: 12px; overflow: hidden;
  border: 1.5px solid #e2e8f0;
  background: #f8fafc;
  display: flex; align-items: center; justify-content: center;
  min-width: 0;
}
.pv2-main-image img { width: 100%; height: 100%; object-fit: cover; }
.pv2-main-empty { font-size: 80px; font-weight: 800; color: #c4b5fd; }

/* Head row */
.pv2-right {
  display: flex; flex-direction: column; gap: 14px; min-width: 0;
  /* Same height as the hero image so the info column ends at the same
     baseline; the info-grid below flexes to fill the leftover space. */
  height: var(--pv2-hero-h, 400px);
  min-height: 0;
}
.pv2-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.pv2-head-text { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pv2-title {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-size: 17px; font-weight: 800; color: #1e293b;
}
.pv2-code { color: #5b21b6; }
.pv2-sep  { color: #cbd5e1; }
.pv2-name { color: #1e293b; }

/* "Sold N — This product sold out N times" */
.pv2-meta-row { display: inline-flex; align-items: center; gap: 8px; }
.pv2-sold-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 99px;
  background: linear-gradient(135deg, #22c55e, #15803d);
  color: #fff;
  font-size: 11px; font-weight: 700;
}
.pv2-sold-chip i { font-size: 11px; }
.pv2-sold-text { font-size: 12px; color: #6b7280; }

/* "Total Selling Price: ₹900  ● Active" */
.pv2-price-row { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pv2-price-label { font-size: 14px; font-weight: 800; color: #1e293b; }
.pv2-price-val   { font-size: 16px; font-weight: 800; color: #5b21b6; }
.pv2-status-text { font-size: 12px; font-weight: 700; }
.pv2-status-text.is-active   { color: #16a34a; }
.pv2-status-text.is-inactive { color: #b45309; }

.pv2-head-actions { display: inline-flex; gap: 8px; flex-shrink: 0; }
.pv2-back, .pv2-edit {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 18px;
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  border-radius: 8px;
  transition: transform .15s, box-shadow .15s, background .15s, border-color .15s;
}
.pv2-back i, .pv2-edit i { font-size: 15px; }
.pv2-back {
  background: #fff;
  border: 1.5px solid var(--vz-border-color, #e9ebec);
  color: #475569;
}
.pv2-back:hover {
  background: #f5f7fb;
  border-color: #c0cffb;
  color: #405189;
  transform: translateY(-1px);
}
/* Edit Product — matches the rounded gradient "Add Product" button */
.pv2-edit {
  background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
  color: #fff; border: none;
  border-radius: 99px;
  box-shadow: 0 4px 12px rgba(64,81,137,.3);
}
.pv2-edit:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(64,81,137,.4);
}
.pv2-edit:active { transform: translateY(0); }

/* Info grid — flat text-heading style (no coloured header strips).
   Three side-by-side columns of key/value rows separated by light
   dividers. Each column scrolls internally if rows overflow. */
.pv2-info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
  /* Fill the space under the head block; no scrollbars — the rows are
     spaced to fit the hero height naturally. */
  flex: 1; min-height: 0;
}
.pv2-info-block {
  display: flex; flex-direction: column;
  min-height: 0; height: 100%;
  min-width: 0;
}
.pv2-info-heading {
  font-size: 14px; font-weight: 800; color: #5b21b6;
  margin: 0 0 8px 0;
  letter-spacing: -.01em;
}
.pv2-info-heading-sub { margin-top: 14px; }
.pv2-info-body {
  display: flex; flex-direction: column; gap: 0;
  overflow: visible;
}
/* Each label : value pair sits on a row with a faint dotted separator so
   values line up in a clean right-hand column and the eye can track
   across long rows. */
.pv2-info-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed #eef2f7;
}
.pv2-info-row:last-child { border-bottom: none; }
.pv2-info-key { color: #64748b; font-weight: 500; flex-shrink: 0; }
.pv2-info-val {
  color: #1e293b; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 60%;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pv2-info-val-success { color: #16a34a; font-weight: 700; }
.pv2-info-val-danger  { color: #dc2626; font-weight: 700; }
.pv2-info-divider { height: 1px; background: #e2e8f0; margin: 6px 0; }
.pv2-total-line { border-bottom: none; }
.pv2-total-line .pv2-info-key { font-weight: 800; color: #1e293b; }
.pv2-total-strong { color: #5b21b6; font-size: 15px; font-weight: 800; text-align: right; }

/* ── Bottom row ── */
.pv2-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 14px;
}
.pv2-tabs-card, .pv2-vendors-card { padding: 14px 16px; }
.pv2-tabs {
  display: flex; gap: 4px; flex-wrap: wrap;
  border-bottom: 1.5px solid #e2e8f0;
  margin-bottom: 14px;
}
.pv2-tab {
  background: none; border: none; padding: 8px 14px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.pv2-tab:hover { color: #4f46e5; }
.pv2-tab.on { color: #4f46e5; border-bottom-color: #4f46e5; }
.pv2-tab-body { min-height: 80px; }
.pv2-tab-text { font-size: 13px; color: #475569; line-height: 1.55; margin: 0; }
.pv2-tab-rich { display: flex; flex-direction: column; gap: 8px; }
.pv2-tab-h { font-size: 12px; font-weight: 800; letter-spacing: .01em; color: #4338ca; margin: 8px 0 2px; }
.pv2-tab-rich .pv2-tab-h:first-child { margin-top: 0; }
.pv2-tab-rich .pv2-info-body { margin-top: 2px; }
.pv2-muted { color: #94a3b8; font-style: italic; }

.pv2-vendors-head {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 800; color: #1e293b;
  margin-bottom: 12px;
}
.pv2-vendors-head i { color: #4f46e5; font-size: 18px; }
.pv2-vendors-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 8px; border-radius: 99px;
  background: #4f46e5; color: #fff;
  font-size: 11px; font-weight: 800;
}
.pv2-vendors-empty {
  padding: 22px; text-align: center; color: #94a3b8; font-size: 12.5px;
  border: 1.5px dashed #e2e8f0; border-radius: 10px;
}

/* Vendor table — flat list of every mapped vendor (replaces the
   per-vendor cards). Header gets the navy/indigo strip used on the
   list pages for visual continuity. */
.pv2-vendor-table-wrap {
  border: 1px solid #e2e8f0; border-radius: 10px;
  /* The Product Vendors table carries 10 columns (Sr · Code · Name ·
     Contact Person · Contact No · Purchase Price · GST % · GST Amount ·
     Total · Map Date) — on narrow card widths that overflows. Switch
     the wrapper to a horizontal scroller and pin a min table width
     so columns never crush into a single character each. */
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #c7d2fe transparent;
}
.pv2-vendor-table-wrap::-webkit-scrollbar { height: 8px; }
.pv2-vendor-table-wrap::-webkit-scrollbar-track { background: transparent; }
.pv2-vendor-table-wrap::-webkit-scrollbar-thumb {
  background: #c7d2fe; border-radius: 99px;
}
.pv2-vendor-table-wrap::-webkit-scrollbar-thumb:hover { background: #818cf8; }
.pv2-vendor-table {
  width: 100%; min-width: 980px;
  border-collapse: separate; border-spacing: 0;
  font-size: 12px;
}
.pv2-vendor-table thead th {
  background: linear-gradient(180deg, #2b3a85 0%, #1e2a5f 100%);
  color: #fff; font-weight: 700; letter-spacing: .02em;
  padding: 8px 10px; text-align: left; white-space: nowrap;
  border-bottom: 1px solid #1e2a5f;
}
.pv2-vendor-table tbody td { white-space: nowrap; }
.pv2-vendor-table tbody td {
  padding: 8px 10px; color: #1e293b; border-top: 1px solid #eef2ff;
  background: #fff;
}
.pv2-vendor-table tbody tr:nth-child(even) td { background: #faf9ff; }
.pv2-vendor-table tbody tr:hover td { background: #f5f3ff; }
.pv2-vendor-table .pv2-vt-num { text-align: center; white-space: nowrap; }
.pv2-vendor-table .pv2-vt-strong { font-weight: 700; color: #4338ca; }
.pv2-vendor-table .pv2-vt-total  { font-weight: 800; color: #5b21b6; }
.pv2-vendor-table .pv2-vendor-code {
  color: #5b21b6; font-family: ui-monospace, monospace; font-weight: 700;
}

[data-bs-theme="dark"] .pv2-vendor-table-wrap { border-color: #1f2937; }
[data-bs-theme="dark"] .pv2-vendor-table tbody td { background: #0f172a; color: #e5e7eb; border-top-color: #1f2937; }
[data-bs-theme="dark"] .pv2-vendor-table tbody tr:nth-child(even) td { background: #111827; }
[data-bs-theme="dark"] .pv2-vendor-table tbody tr:hover td { background: #1e293b; }
[data-bs-theme="dark"] .pv2-vendor-table .pv2-vt-strong { color: #a5b4fc; }
[data-bs-theme="dark"] .pv2-vendor-table .pv2-vt-total  { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-vendor-table .pv2-vendor-code { color: #c4b5fd; }

/* Vendor cards — show every mapped-vendor field */
.pv2-vendor-cards {
  display: flex; flex-direction: column; gap: 10px;
  max-height: 500px; overflow-y: auto; padding-right: 4px;
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.pv2-vendor-cards::-webkit-scrollbar { width: 6px; }
.pv2-vendor-cards::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
.pv2-vendor-card {
  border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px;
  background: #fafbff;
}
.pv2-vendor-card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px;
  padding-bottom: 8px; border-bottom: 1px dashed #e2e8f0;
}
.pv2-vendor-card-title {
  display: inline-flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-size: 13px; font-weight: 700;
}
.pv2-vendor-sr {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 22px; padding: 0 6px; border-radius: 99px;
  background: #ede9fe; color: #5b21b6; font-size: 11px; font-weight: 800;
}
.pv2-vendor-code { color: #5b21b6; font-family: ui-monospace, monospace; font-size: 12.5px; }
.pv2-vendor-name { color: #1e293b; }
.pv2-vendor-card-total {
  display: inline-flex; align-items: baseline; gap: 6px; flex-shrink: 0;
}
.pv2-vendor-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 14px;
}
.pv2-vendor-remarks {
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;
  font-size: 12px;
}
.pv2-vendor-remarks-text { color: #475569; margin-left: 6px; }
.pv2-vendor-attach { margin-top: 8px; }

/* Attachment link (QC + vendor) */
.pv2-attach-link {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #4f46e5;
  text-decoration: none;
}
.pv2-attach-link:hover { color: #3730a3; text-decoration: underline; }

/* QC Auto-Code badge — Bootstrap's bg-light/text-dark goes muddy on the
 * dark-theme card (light grey on near-black) and the code becomes hard
 * to read. Custom class so the dark-mode override below can give it
 * proper contrast. */
.pv2-qc-code {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11.5px; font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  letter-spacing: 0.02em;
  background: #f3f4f6; color: #1f2937;
  border: 1px solid #e5e7eb;
}

@media (max-width: 1200px) {
  .pv2-top-grid { grid-template-columns: 1fr; }
  .pv2-bottom   { grid-template-columns: 1fr; }
  /* Stacked layout — drop the equal-height pin so the info column can grow
     naturally below the image instead of being clipped/scrolled. */
  .pv2-right     { height: auto; }
  .pv2-info-grid { overflow: visible; flex: none; }
  .pv2-info-block { height: auto; }
}
@media (max-width: 720px) {
  .pv2-info-grid { grid-template-columns: 1fr; }
  .pv2-gallery   { grid-template-columns: 56px 1fr; }
  .pv2-thumb     { width: 56px; height: 56px; }
}

/* ════════════════════════════════════════════════════════════════════════
 * Dark mode
 * ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .pv2-root { background: #161c24; color: #ced4da; }
[data-bs-theme="dark"] .pv2-card { background: #1c2531; border-color: rgba(255,255,255,.08); box-shadow: 0 2px 12px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .pv2-thumb { background: #161c24; border-color: rgba(255,255,255,.1); }
[data-bs-theme="dark"] .pv2-thumbs { scrollbar-color: #4c1d95 transparent; }
[data-bs-theme="dark"] .pv2-thumbs::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #a78bfa, #6d28d9);
}
[data-bs-theme="dark"] .pv2-main-image { background: #161c24; border-color: rgba(255,255,255,.1); }
[data-bs-theme="dark"] .pv2-name { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-code { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-sep  { color: rgba(255,255,255,.2); }
[data-bs-theme="dark"] .pv2-back { background: #1c2531; border-color: rgba(255,255,255,.1); color: #ced4da; }
[data-bs-theme="dark"] .pv2-back:hover { background: #232c38; }
[data-bs-theme="dark"] .pv2-sold-text { color: #adb5bd; }
[data-bs-theme="dark"] .pv2-price-label { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-price-val   { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-edit { box-shadow: 0 4px 12px rgba(64,81,137,.45); }
[data-bs-theme="dark"] .pv2-edit:hover { box-shadow: 0 6px 18px rgba(64,81,137,.55); }
/* Back-to-Products — the base rule is background:#fff, which rendered as a
   bright/near-white pill in dark mode. Give it the violet-dark surface used
   across the product pages, with a clearly visible hover. */
[data-bs-theme="dark"] .pv2-back {
  background: #1a1430;
  border-color: #3b2a6b;
  color: #c4b5fd;
}
[data-bs-theme="dark"] .pv2-back:hover {
  background: #221852;
  border-color: #4c1d95;
  color: #ddd6fe;
}
[data-bs-theme="dark"] .pv2-info-grid { border-top-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-info-heading { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-info-row { border-bottom-color: rgba(255,255,255,.06); }
[data-bs-theme="dark"] .pv2-info-row .pv2-info-key { color: #94a3b8; font-weight: 500; }
[data-bs-theme="dark"] .pv2-info-row .pv2-info-val { color: #f1f5f9; font-weight: 700; }
[data-bs-theme="dark"] .pv2-info-divider { background: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-total-line .pv2-info-key { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-total-strong { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-tabs { border-bottom-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-tab { color: #6b7280; }
[data-bs-theme="dark"] .pv2-tab:hover { color: #a8b6e9; }
[data-bs-theme="dark"] .pv2-tab.on { color: #a8b6e9; border-bottom-color: #6366f1; }
[data-bs-theme="dark"] .pv2-tab-text { color: #ced4da; }
[data-bs-theme="dark"] .pv2-tab-h { color: #a5b4fc; }
[data-bs-theme="dark"] .pv2-vendors-head { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-vendors-empty { border-color: rgba(255,255,255,.08); color: #6b7280; }
[data-bs-theme="dark"] .pv2-vendor-card { background: #161c24; border-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-vendor-card-head { border-bottom-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-vendor-sr { background: rgba(139,92,246,.15); color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-vendor-code { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-vendor-name { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-vendor-remarks { border-top-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-vendor-remarks-text { color: #ced4da; }
[data-bs-theme="dark"] .pv2-attach-link { color: #a8b6e9; }
[data-bs-theme="dark"] .pv2-attach-link:hover { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-qc-code {
  background: rgba(139, 92, 246, .18);
  color: #ddd6fe;
  border-color: rgba(167, 139, 250, .35);
}
[data-bs-theme="dark"] .pv2-status.is-active { background: rgba(34,197,94,.12); color: #4ade80; border-color: rgba(34,197,94,.3); }
[data-bs-theme="dark"] .pv2-status.is-inactive { background: rgba(245,158,11,.12); color: #fcd34d; border-color: rgba(245,158,11,.3); }

/* ═══ Product detail — prototype pd-* popup design (ported as pv2pd-*) ═══ */
.pv2pd-root { padding: 0; gap: 0; min-height: 0; background: linear-gradient(160deg,#f5f1fe 0%,#efe7fc 45%,#e9dcf8 100%); }
.pv2pd-hero { position: relative; padding: 13px 22px; background: linear-gradient(120deg,#4c1d95 0%,#6d28d9 48%,#7c3aed 100%); overflow: hidden; }
.pv2pd-hero::before { content: ''; position: absolute; top: -60%; right: -10%; width: 320px; height: 320px; background: radial-gradient(circle,rgba(255,255,255,.16),transparent 70%); pointer-events: none; }
.pv2pd-hero::after { content: ''; position: absolute; bottom: -50%; left: -5%; width: 260px; height: 260px; background: radial-gradient(circle,rgba(6,182,212,.22),transparent 70%); pointer-events: none; }
.pv2pd-hero-row { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 14px; z-index: 1; }
.pv2pd-hero-main { min-width: 0; }
.pv2pd-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.25; margin: 0; }
.pv2pd-code { color: #c4b5fd; font-weight: 900; }
.pv2pd-title-sep { color: rgba(255,255,255,.4); font-weight: 400; margin: 0 1px; }
.pv2pd-hero-btns { display: flex; gap: 8px; flex-shrink: 0; z-index: 1; }
.pv2pd-hbtn { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 11px; font-weight: 700; border-radius: 9px; padding: 7px 13px; cursor: pointer; transition: all .15s; white-space: nowrap; }
.pv2pd-hbtn--ghost { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.25); }
.pv2pd-hbtn--ghost:hover { background: rgba(255,255,255,.24); }
.pv2pd-hbtn--edit { background: #fff; color: #6d28d9; border: none; box-shadow: 0 5px 14px rgba(0,0,0,.16); }
.pv2pd-hbtn--edit:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0,0,0,.22); }
.pv2pd-hbtn--suppliers { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.3); }
.pv2pd-hbtn--suppliers:hover { background: rgba(255,255,255,.24); transform: translateY(-1px); }
.pv2pd-body { display: grid; grid-template-columns: minmax(250px,.82fr) 1.5fr; gap: 16px; padding: 16px 18px 18px; align-items: start; }
@media (max-width: 860px) { .pv2pd-body { grid-template-columns: 1fr; } }
.pv2pd-infocol { min-width: 0; }
.pv2pd-info { display: flex; flex-direction: column; }
.pv2pd-gallery { display: flex; flex-direction: column; gap: 8px; }
.pv2pd-main-img { position: relative; border-radius: 14px; overflow: hidden; background: #f1edfa; aspect-ratio: 1/.72; box-shadow: 0 10px 26px rgba(76,29,149,.15); display: flex; align-items: center; justify-content: center; }
.pv2pd-main-img img { width: 100%; height: 100%; object-fit: fill; transition: transform .5s cubic-bezier(.22,1,.36,1); }
.pv2pd-main-img:hover img { transform: scale(1.05); }
.pv2pd-main-empty { font-size: 44px; font-weight: 800; color: #a78bfa; }
.pv2pd-thumbs { display: flex; gap: 8px; }
.pv2pd-thumb { width: 50px; height: 50px; border-radius: 11px; overflow: hidden; border: 2px solid transparent; cursor: pointer; background: #f1edfa; transition: border-color .18s, transform .18s; box-shadow: 0 2px 8px rgba(76,29,149,.1); padding: 0; }
.pv2pd-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pv2pd-thumb.is-active { border-color: #7c3aed; }
.pv2pd-thumb:hover { transform: translateY(-2px); }
.pv2pd-chip { font-size: 10px; font-weight: 800; border-radius: 6px; padding: 3px 9px; display: inline-flex; align-items: center; gap: 5px; }
.pv2pd-chip-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.pv2pd-chip--onimg { position: absolute; top: 9px; right: 9px; z-index: 3; padding: 3px 9px 3px 7px; font-size: 9.5px; letter-spacing: .03em; text-transform: uppercase; border-radius: 999px; gap: 4px; backdrop-filter: blur(8px) saturate(1.2); box-shadow: 0 3px 10px rgba(0,0,0,.22),0 1px 0 rgba(255,255,255,.4) inset; }
.pv2pd-chip--onimg .pv2pd-chip-dot { width: 6px; height: 6px; }
.pv2pd-chip--onimg.pv2pd-chip--active { color: #047857; background: linear-gradient(135deg,rgba(209,250,229,.95),rgba(167,243,208,.95)); border: 1px solid rgba(16,185,129,.45); }
.pv2pd-chip--onimg.pv2pd-chip--active .pv2pd-chip-dot { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.28); }
.pv2pd-chip--onimg.pv2pd-chip--inactive { color: #b91c1c; background: linear-gradient(135deg,rgba(254,226,226,.95),rgba(254,202,202,.95)); border: 1px solid rgba(239,68,68,.45); }
.pv2pd-chip--onimg.pv2pd-chip--inactive .pv2pd-chip-dot { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.28); }
.pv2pd-pricecard { background: linear-gradient(135deg,#1e1b4b,#4c1d95); border-radius: 14px; padding: 12px 14px; color: #fff; box-shadow: 0 10px 26px rgba(76,29,149,.26); position: relative; overflow: hidden; }
.pv2pd-pricecard::before { content: ''; position: absolute; top: -50%; right: -20%; width: 180px; height: 180px; background: radial-gradient(circle,rgba(139,92,246,.4),transparent 70%); pointer-events: none; }
.pv2pd-pc-top { display: flex; justify-content: space-between; align-items: flex-end; position: relative; z-index: 1; }
.pv2pd-pc-label { font-size: 8.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #c4b5fd; }
.pv2pd-pc-price { font-size: 23px; font-weight: 900; letter-spacing: -1px; line-height: 1; margin-top: 2px; }
.pv2pd-pc-price small { font-size: 13px; font-weight: 800; color: #ddd6fe; }
.pv2pd-pc-uom { font-size: 10px; color: #c4b5fd; font-weight: 600; margin-top: 2px; }
.pv2pd-pc-break { text-align: right; font-size: 9.5px; color: #c4b5fd; font-weight: 600; line-height: 1.55; }
.pv2pd-pc-total { display: flex; justify-content: space-between; align-items: center; margin-top: 9px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,.16); position: relative; z-index: 1; }
.pv2pd-pc-total span { font-size: 10.5px; font-weight: 700; color: #ddd6fe; }
.pv2pd-pc-total b { font-size: 18px; font-weight: 900; color: #6ee7b7; letter-spacing: -.5px; }
.pv2pd-buybar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.pv2pd-qty { display: inline-flex; align-items: center; border: 1.5px solid #e2d4fa; border-radius: 11px; overflow: hidden; background: #fff; height: 42px; }
.pv2pd-qty button { width: 34px; height: 100%; border: none; background: #f6f2ff; color: #6d28d9; font-size: 17px; font-weight: 800; cursor: pointer; }
.pv2pd-qty button:hover { background: #ede4fc; }
.pv2pd-qty input { width: 40px; height: 100%; border: none; text-align: center; font-family: inherit; font-size: 13px; font-weight: 800; color: #1e1b4b; background: transparent; }
.pv2pd-act { flex: 1; min-width: 120px; height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; font-family: inherit; font-size: 12px; font-weight: 800; border-radius: 11px; padding: 0 11px; cursor: pointer; transition: all .16s; border: none; }
.pv2pd-act--wish { background: #fff; color: #7c3aed; border: 1.5px solid #d8cef0; }
.pv2pd-act--wish:hover { background: #f6f2ff; transform: translateY(-1px); }
.pv2pd-act--cart { flex: 1 1 100%; background: linear-gradient(135deg,#8b5cf6,#7c3aed,#6d28d9); color: #fff; box-shadow: 0 7px 18px rgba(124,58,237,.38); }
.pv2pd-act--cart:hover { background: linear-gradient(135deg,#7c3aed,#6d28d9,#5b21b6); transform: translateY(-1px); box-shadow: 0 10px 24px rgba(124,58,237,.48); }
.pv2pd-sec { background: #fff; border: 1px solid #efeafa; border-radius: 13px; padding: 11px 14px; margin-bottom: 9px; box-shadow: 0 2px 9px rgba(76,29,149,.04); }
.pv2pd-sec__title { display: flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 800; color: #4c1d95; margin-bottom: 9px; }
.pv2pd-sec__ico { width: 23px; height: 23px; border-radius: 7px; background: linear-gradient(135deg,#8b5cf6,#7c3aed); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.pv2pd-highlights { display: grid; grid-template-columns: repeat(3,1fr); gap: 9px; margin-bottom: 0; }
@media (max-width: 560px) { .pv2pd-highlights { grid-template-columns: repeat(2,1fr); } }
/* ─── Detail popup — tablet / mobile ─── */
@media (max-width: 820px) {
  .pv2pd-hero { padding: 12px 16px; }
  .pv2pd-hero-row { flex-wrap: wrap; }
  .pv2pd-title { font-size: 14px; }
  .pv2pd-hero-btns { width: 100%; flex-wrap: wrap; }
  .pv2pd-hbtn { flex: 1 1 auto; justify-content: center; }
  .pv2pd-body { padding: 14px; gap: 14px; }
}
@media (max-width: 520px) {
  .pv2pd-highlights { grid-template-columns: 1fr; }
  .pv2pd-buybar { flex-direction: column; align-items: stretch; }
  .pv2pd-qty { width: 100%; justify-content: center; }
  .pv2pd-act { width: 100%; }
  .pv2pd-tab { min-width: 0; padding: 7px 6px; font-size: 10px; }
  .pv2pd-tab-body { height: 260px; }
  .pv2pd-sup-modal { max-width: 100%; }
  .pv2pd-sup-body { padding: 12px 14px; }
}
.pv2pd-hl { --acc: #7c3aed; --acc2: #8b5cf6; display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #efe9fb; border-radius: 13px; padding: 10px 12px 10px 13px; position: relative; overflow: hidden; box-shadow: 0 1px 2px rgba(76,29,149,.05),0 4px 12px rgba(76,29,149,.05); transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s, border-color .2s; }
.pv2pd-hl::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg,var(--acc2),var(--acc)); opacity: .9; }
.pv2pd-hl:hover { transform: translateY(-2px); box-shadow: 0 2px 4px rgba(76,29,149,.06),0 10px 22px rgba(76,29,149,.14); }
.pv2pd-hl__ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; background: linear-gradient(140deg,var(--acc2),var(--acc)); box-shadow: 0 4px 10px rgba(76,29,149,.3), inset 0 1px 0 rgba(255,255,255,.4); }
.pv2pd-hl--v { --acc: #7c3aed; --acc2: #a78bfa; }
.pv2pd-hl--c { --acc: #0891b2; --acc2: #22d3ee; }
.pv2pd-hl--g { --acc: #059669; --acc2: #34d399; }
.pv2pd-hl--a { --acc: #d97706; --acc2: #fbbf24; }
.pv2pd-hl--h { --acc: #dc2626; --acc2: #f87171; }
.pv2pd-hl--p { --acc: #4f46e5; --acc2: #818cf8; }
.pv2pd-hl__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pv2pd-hl__k { font-size: 8px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: #a99cc4; line-height: 1.1; }
.pv2pd-hl__v { font-size: 13.5px; font-weight: 800; color: #2e1065; letter-spacing: -.3px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv2pd-sec--tabs { margin-bottom: 0; }
.pv2pd-tabs { display: flex; gap: 5px; background: #f3eefc; border-radius: 10px; padding: 4px; margin-bottom: 10px; flex-wrap: wrap; }
.pv2pd-tab { flex: 1; min-width: 100px; text-align: center; font-size: 11px; font-weight: 700; color: #7c6fa0; padding: 7px 10px; border-radius: 8px; cursor: pointer; transition: all .15s; border: none; background: transparent; }
.pv2pd-tab.is-active { color: #fff; background: linear-gradient(135deg,#8b5cf6,#7c3aed); box-shadow: 0 3px 10px rgba(124,58,237,.3); }
.pv2pd-tab:not(.is-active):hover { color: #6d28d9; background: rgba(255,255,255,.6); }
.pv2pd-tab-body { font-size: 11.5px; color: #475569; line-height: 1.65; height: 360px; overflow-y: auto; padding-right: 6px; }
.pv2pd-tab-body::-webkit-scrollbar { width: 7px; }
.pv2pd-tab-body::-webkit-scrollbar-thumb { background: #d8cef0; border-radius: 6px; }
.pv2pd-tab-body::-webkit-scrollbar-track { background: transparent; }
[data-bs-theme="dark"] .pv2pd-tab-body::-webkit-scrollbar-thumb { background: rgba(167,139,250,.3); }
.pv2pd-tab-text { margin: 0 0 9px; }
.pv2pd-muted { color: #94a3b8; }
.pv2pd-tab-rich { display: flex; flex-direction: column; }
.pv2pd-tab-h { font-size: 11.5px; font-weight: 800; color: #4c1d95; margin: 12px 0 5px; }
.pv2pd-tab-rich .pv2pd-tab-h:first-child { margin-top: 0; }
.pv2pd-tab-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px dashed #eee6fa; font-size: 11.5px; }
.pv2pd-tab-row:last-child { border-bottom: none; }
.pv2pd-tab-row__k { color: #7c8499; font-weight: 600; }
.pv2pd-tab-row__v { color: #1e1b4b; font-weight: 800; text-align: right; }
.pv2pd-tab-row__v--green { color: #059669; }
.pv2pd-tab-row__v--amber { color: #b45309; }
.pv2pd-supplier { border: 1px solid #efe9fb; border-radius: 11px; padding: 10px 12px; margin-bottom: 9px; }
.pv2pd-supplier-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; color: #1e1b4b; font-size: 12.5px; }
.pv2pd-supplier-code { font-size: 10px; font-weight: 800; color: #5b21b6; background: #f5f1fe; border: 1px solid #e2d4fa; border-radius: 6px; padding: 2px 7px; }
/* Dark mode */
[data-bs-theme="dark"] .pv2pd-root { background: #1c1633; }
[data-bs-theme="dark"] .pv2pd-sec,
[data-bs-theme="dark"] .pv2pd-hl,
[data-bs-theme="dark"] .pv2pd-supplier { background: #241a47; border-color: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .pv2pd-hl__v { color: #ede9fe; }
[data-bs-theme="dark"] .pv2pd-sec__title,
[data-bs-theme="dark"] .pv2pd-tab-h { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2pd-tabs { background: rgba(124,58,237,.14); }
[data-bs-theme="dark"] .pv2pd-tab-body { color: #ced4da; }
[data-bs-theme="dark"] .pv2pd-tab-row__k { color: #9a93b3; }
[data-bs-theme="dark"] .pv2pd-tab-row__v { color: #ede9fe; }
[data-bs-theme="dark"] .pv2pd-qty { background: #1a1430; border-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .pv2pd-qty button { background: rgba(124,58,237,.2); color: #c4b5fd; }
[data-bs-theme="dark"] .pv2pd-qty input { color: #ede9fe; }
[data-bs-theme="dark"] .pv2pd-act--wish { background: rgba(124,58,237,.16); border-color: rgba(167,139,250,.3); color: #d6c9f5; }

/* ═══ Mapped Suppliers popup ═══ */
.pv2pd-sup-overlay { position: fixed; inset: 0; z-index: 1060; background: rgba(66, 65, 71, 0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 24px; overflow-y: auto; font-family: var(--font-sans); }
.pv2pd-sup-modal { width: 100%; max-width: 1060px; margin: auto; background: linear-gradient(180deg,#fbf9ff,#f5f1fe); border: 1px solid rgba(196,181,253,.6); border-radius: 18px; overflow: hidden; box-shadow: 0 30px 80px rgba(20,10,60,.45); animation: pv2pdSupPop .24s cubic-bezier(.22,1,.36,1); }
@keyframes pv2pdSupPop { from { transform: translateY(16px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
.pv2pd-sup-head { position: relative; display: flex; align-items: center; gap: 12px; padding: 15px 20px; background: linear-gradient(115deg,#4c1d95 0%,#6d28d9 50%,#8b5cf6 100%); color: #fff; }
.pv2pd-sup-head-ico { width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.25); display: flex; align-items: center; justify-content: center; font-size: 18px; }
.pv2pd-sup-head-txt { flex: 1; min-width: 0; }
.pv2pd-sup-title { font-size: 16px; font-weight: 800; letter-spacing: -.2px; }
.pv2pd-sup-sub { font-size: 11.5px; color: rgba(255,255,255,.82); margin-top: 1px; }
.pv2pd-sup-close { width: 32px; height: 32px; border-radius: 9px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.14); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background .15s; }
.pv2pd-sup-close:hover { background: rgba(255,255,255,.26); }
.pv2pd-sup-body { padding: 16px 20px; background: #fff; }
.pv2pd-sup-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.pv2pd-sup-countpill { font-size: 12px; font-weight: 700; color: #6d28d9; background: #f5f1fe; border: 1px solid #e2d4fa; border-radius: 20px; padding: 6px 14px; }
.pv2pd-sup-map { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 12.5px; font-weight: 700; color: #fff; border: none; border-radius: 10px; padding: 8px 16px; cursor: pointer; background: linear-gradient(135deg,#8b5cf6,#7c3aed,#6d28d9); box-shadow: 0 5px 14px rgba(124,58,237,.4); transition: transform .15s, box-shadow .15s; }
.pv2pd-sup-map:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(124,58,237,.5); }
.pv2pd-sup-empty { text-align: center; color: #7c3aed; font-weight: 600; font-size: 13px; padding: 34px 16px; border: 1.5px dashed #d6cbf7; border-radius: 12px; background: #fbf9ff; }
.pv2pd-sup-tablewrap { overflow-x: auto; border: 1px solid #efe9fb; border-radius: 12px; }
.pv2pd-sup-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.pv2pd-sup-table thead th { text-align: left; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; padding: 10px 14px; border-bottom: 1px solid #efe9fb; }
.pv2pd-sup-table tbody td { padding: 11px 14px; border-bottom: 1px solid #f4f0fc; color: #334155; font-weight: 600; vertical-align: middle; }
.pv2pd-sup-table tbody tr:last-child td { border-bottom: none; }
.pv2pd-sup-table tbody tr:hover { background: #faf8ff; }
.pv2pd-sup-sr { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border-radius: 6px; font-size: 10.5px; font-weight: 800; color: #6d28d9; background: #f5f1fe; border: 1px solid #e2d4fa; }
.pv2pd-sup-cname { font-weight: 800; color: #1e1b4b; }
.pv2pd-sup-cperson { color: #7c3aed; font-weight: 700; }
.pv2pd-sup-code { font-size: 10.5px; font-weight: 800; color: #5b21b6; background: #f5f1fe; border: 1px solid #e2d4fa; border-radius: 6px; padding: 2px 8px; }
.pv2pd-sup-ctotal { font-weight: 800; color: #0f172a; }
.pv2pd-sup-del { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #fecaca; background: #fef2f2; color: #dc2626; font-size: 15px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .14s, color .14s; }
.pv2pd-sup-del:hover { background: #dc2626; color: #fff; border-color: transparent; }
.pv2pd-sup-foot { display: flex; justify-content: flex-end; padding: 12px 20px; background: #faf8ff; border-top: 1px solid #efe9fb; }
.pv2pd-sup-closebtn { font-family: inherit; font-size: 13px; font-weight: 700; color: #475569; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 9px 22px; cursor: pointer; transition: background .15s, border-color .15s; }
.pv2pd-sup-closebtn:hover { background: #f8fafc; border-color: #cbd5e1; }
[data-bs-theme="dark"] .pv2pd-sup-modal { background: #1c1633; border-color: rgba(167,139,250,.28); }
[data-bs-theme="dark"] .pv2pd-sup-body { background: #1a1430; }
[data-bs-theme="dark"] .pv2pd-sup-table thead th { color: #9a93b3; border-bottom-color: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .pv2pd-sup-table tbody td { color: #cbd5e1; border-bottom-color: rgba(167,139,250,.1); }
[data-bs-theme="dark"] .pv2pd-sup-table tbody tr:hover { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .pv2pd-sup-cname { color: #f1f5f9; }
[data-bs-theme="dark"] .pv2pd-sup-ctotal { color: #f1f5f9; }
[data-bs-theme="dark"] .pv2pd-sup-foot { background: rgba(255,255,255,.03); border-top-color: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .pv2pd-sup-closebtn { background: #241a47; color: #cbd5e1; border-color: rgba(167,139,250,.25); }
`;
