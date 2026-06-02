import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
import Tooltip from '../../components/ui/Tooltip';
import AddProductModal from './AddProductModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Product Detail view (route: /products/:id) — matches the shared design:
 *
 *   ┌─ rainbow accent bar ─────────────────────────────────────────────────┐
 *   │  thumbs │ main image    │  P-XXX | Name             Back   Edit     │
 *   │         │               │  [Sold N]  [Active]                       │
 *   │         │               │  Total: ₹X                                │
 *   │         │               │                                            │
 *   │         │               │  ┌─PRODUCT─┐  ┌─BOX MATRIX─┐  ┌─PRICING─┐ │
 *   │         │               │  │ ...     │  │ ...        │  │ ...     │ │
 *   │         │               │  └─────────┘  └────────────┘  └─────────┘ │
 *   │  Wishlist · Add to Cart                                              │
 *   └────────────────────────────────────────────────────────────────────────┘
 *   ┌─ Tabs (Description / Make / Confidential / QC) ─────┬─ Vendors table ┐
 *   └──────────────────────────────────────────────────────┴─────────────────┘
 * ──────────────────────────────────────────────────────────────────────── */

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

export default function ProductView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [product, setProduct] = useState<ProductDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'desc' | 'brand' | 'confidential' | 'qc'>('desc');
  const [activeImg, setActiveImg] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

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
      navigate('/products');
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

  const statusText = (product.status || 'draft').replace(/^./, c => c.toUpperCase());
  const isActive = product.status === 'active';
  const isHaz = String(product.haz_type ?? '').toLowerCase() === 'haz';

  const segmentName    = (product.segment?.title as string) ?? '—';
  const hazClassName   = (product.haz_class?.name as string) ?? '—';
  const uomName        = (product.uom?.short_code as string) ?? (product.uom?.title as string) ?? '—';
  const hsnCode        = (product.hsn?.hsn_code as string) ?? '—';
  const conditionName  = (product.condition?.title as string) ?? '—';
  const packagingName  = (product.packaging_material?.title as string) ?? '—';
  const gstPct         = Number(product.gst_percentage?.percentage ?? 0);

  const fmtNum = (v: string | number | null | undefined, unit = '') =>
    v == null || v === '' ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;
  const fmtMoney = (v: string | number | null | undefined) =>
    v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  // Mocked sold-count badge (no backend field yet). Replace with real value when available.
  const soldCount = '35,000';

  return (
    <div className="pv2-root">
      <style>{SCOPED_CSS}</style>

      {/* ─── Top card ─── */}
      <div className="pv2-card pv2-top">
        <div className="pv2-top-grid">
          {/* Left: gallery */}
          <div className="pv2-gallery">
            <div className="pv2-thumbs">
              {images.length === 0 && (
                <div className="pv2-thumb pv2-thumb-empty">{product.name?.charAt(0)?.toUpperCase() || 'P'}</div>
              )}
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`pv2-thumb ${i === activeImg ? 'on' : ''}`}
                  onClick={() => setActiveImg(i)}
                  aria-label={`Thumbnail ${i + 1}`}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
            <div className="pv2-main-image">
              {images.length > 0 ? (
                <img src={images[activeImg]} alt={product.name} />
              ) : (
                <div className="pv2-main-empty">{product.name?.charAt(0)?.toUpperCase() || 'P'}</div>
              )}
            </div>
          </div>

          {/* Right: header + 3 info columns */}
          <div className="pv2-right">
            <div className="pv2-head">
              <div className="pv2-head-text">
                <div className="pv2-title">
                  <span className="pv2-code">{product.product_code}</span>
                  <span className="pv2-sep">|</span>
                  <span className="pv2-name">{product.name}</span>
                </div>
                <div className="pv2-meta-row">
                  <span className="pv2-sold-chip">
                    <i className="ri-price-tag-3-fill" /> {soldCount}
                  </span>
                  <span className="pv2-sold-text">This product sold out {soldCount} times</span>
                </div>
                <div className="pv2-price-row">
                  <span className="pv2-price-label">Total Selling Price:</span>
                  <span className="pv2-price-val">{fmtMoney(product.total_price)}</span>
                  <span className={`pv2-status-text ${isActive ? 'is-active' : 'is-inactive'}`}>● {statusText}</span>
                </div>
              </div>
              <div className="pv2-head-actions">
                {/* Back-to-list pill — matches the master pages so the
                    visual language is consistent across detail screens. */}
                {/* Uses the .pv2-back class (which already defines a proper
                    hover: bg + border + colour + lift, plus a dark-mode
                    variant) instead of inline styles with a JS hover whose
                    8%->14% colour-mix delta was imperceptible — QA reported
                    "no hover effect". rounded-pill keeps the pill shape. */}
                <button
                  type="button"
                  onClick={() => navigate('/products')}
                  title="Back to Products"
                  className="pv2-back rounded-pill"
                >
                  <i className="ri-arrow-left-line"></i>
                  Back to Products
                </button>
                <button className="pv2-edit" onClick={() => setEditOpen(true)}>
                  <i className="ri-edit-box-line" /> Edit Product
                </button>
              </div>
            </div>

            <div className="pv2-info-grid">
              {/* Product Details */}
              <div className="pv2-info-block">
                <h6 className="pv2-info-heading">Product Details:</h6>
                <div className="pv2-info-body">
                  <Row k="Product Generic Name" v={product.generic_name || '—'} />
                  <Row k="HSN / SAC"            v={hsnCode} />
                  <Row k="Segment"              v={segmentName} />
                  <Row k="Haz / Non-Haz"        v={product.haz_type || '—'} accent={isHaz ? 'danger' : 'success'} />
                  <Row k="Haz Class"            v={isHaz ? hazClassName : '—'} />
                  <Row k="Unit Of Measurement"  v={uomName} />
                  <Row k="Condition"            v={conditionName} />
                  <Row k="Packaging Material"   v={packagingName} />
                  <Row k="Bottom / Non-Bottom"  v={product.mark_bottom || '—'} />
                </div>
              </div>

              {/* Box Matrix + Inventory (stacked in one column) */}
              <div className="pv2-info-block">
                <h6 className="pv2-info-heading">Box Matrix Details:</h6>
                <div className="pv2-info-body">
                  <Row k="Per Box Net Weight"   v={fmtNum(product.net_weight, 'kg')} />
                  <Row k="Per Box Gross Weight" v={fmtNum(product.gross_weight, 'kg')} />
                  <Row k="Per Box Length"       v={fmtNum(product.length_cm, 'cm')} />
                  <Row k="Per Box Width"        v={fmtNum(product.width_cm, 'cm')} />
                  <Row k="Per Box Height"       v={fmtNum(product.height_cm, 'cm')} />
                </div>

                <h6 className="pv2-info-heading pv2-info-heading-sub">Inventory Details:</h6>
                <div className="pv2-info-body">
                  <Row k="Batch No"  v={product.batch_no  || '—'} />
                  <Row k="Serial No" v={product.serial_no || '—'} />
                  <Row k="Cat No"    v={product.cat_no    || '—'} />
                  <Row k="Lot No"    v={product.lot_no    || '—'} />
                </div>
              </div>

              {/* Pricing */}
              <div className="pv2-info-block">
                <h6 className="pv2-info-heading">Product Pricing Details:</h6>
                <div className="pv2-info-body">
                  <Row k="Product Base Price" v={fmtMoney(product.base_price)} />
                  <Row k="GST %"              v={gstPct ? `${gstPct.toFixed(2)}%` : '—'} />
                  <Row k="GST Amount"         v={fmtMoney(product.gst_amount)} />
                  <div className="pv2-info-divider" />
                  <div className="pv2-info-row pv2-total-line">
                    <span className="pv2-info-key">Total Selling Price:</span>
                    <span className="pv2-total-strong">{fmtMoney(product.total_price)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom row: tabs + vendors table ─── */}
      <div className="pv2-bottom">
        <div className="pv2-card pv2-tabs-card">
          <div className="pv2-tabs">
            <button className={`pv2-tab ${tab === 'desc' ? 'on' : ''}`}         onClick={() => setTab('desc')}>Product Description</button>
            <button className={`pv2-tab ${tab === 'brand' ? 'on' : ''}`}        onClick={() => setTab('brand')}>Make / Brand / Specifications</button>
            <button className={`pv2-tab ${tab === 'confidential' ? 'on' : ''}`} onClick={() => setTab('confidential')}>Confidential Info</button>
            <button className={`pv2-tab ${tab === 'qc' ? 'on' : ''}`}           onClick={() => setTab('qc')}>QC &amp; Compliance</button>
          </div>
          <div className="pv2-tab-body">
            {tab === 'desc' && (
              <p className="pv2-tab-text">{product.description || <em className="pv2-muted">No description provided.</em>}</p>
            )}
            {tab === 'brand' && (
              <p className="pv2-tab-text">{product.brand || <em className="pv2-muted">No brand / make / specifications recorded.</em>}</p>
            )}
            {tab === 'confidential' && (
              <p className="pv2-tab-text">{product.confidential_info || <em className="pv2-muted">No confidential information.</em>}</p>
            )}
            {tab === 'qc' && (
              qcUploads.length === 0 ? (
                <p className="pv2-tab-text"><em className="pv2-muted">No QC documents uploaded yet.</em></p>
              ) : (
                <div className="table-responsive">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>SR</th>
                        <th>Auto Code</th>
                        <th>QC Document Name</th>
                        <th>Status</th>
                        <th>File</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qcUploads.map((q, i) => (
                        <tr key={q.id}>
                          <td>{String(i + 1).padStart(2, '0')}</td>
                          <td><span className="pv2-qc-code">{q.doc_code}</span></td>
                          <td><strong>{q.doc_name}</strong></td>
                          <td>
                            <span className={`badge ${q.requirement === 'M' ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}`}>
                              {q.requirement === 'M' ? '✓ Mandatory' : 'Optional'}
                            </span>
                          </td>
                          <td>
                            {q.attachment_url
                              ? <a href={q.attachment_url} target="_blank" rel="noreferrer" className="pv2-attach-link">{q.attachment_name || 'View attachment'}</a>
                              : <span className="pv2-muted">Not uploaded</span>}
                          </td>
                          <td>
                            <QcRowActions
                              doc={q}
                              productId={product.id}
                              onReload={loadQcUploads}
                              toast={toast}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>

        <div className="pv2-card pv2-vendors-card">
          <div className="pv2-vendors-head">
            <i className="ri-links-line" />
            Product Suppliers
            <span className="pv2-vendors-count">{product.vendor_maps.length}</span>
          </div>
          {product.vendor_maps.length === 0 ? (
            <div className="pv2-vendors-empty">No suppliers mapped to this product.</div>
          ) : (
            <div className="pv2-vendor-table-wrap">
              <table className="pv2-vendor-table">
                <thead>
                  <tr>
                    <th className="pv2-vt-num">Sr No</th>
                    <th>Supplier Code</th>
                    <th>Supplier Company Name</th>
                    <th>Contact Person Name</th>
                    <th>Contact No</th>
                    <th className="pv2-vt-num">Purchase Price</th>
                    <th className="pv2-vt-num">GST %</th>
                    <th className="pv2-vt-num">GST Amount</th>
                    <th className="pv2-vt-num">Total Amount</th>
                    <th>Map Date</th>
                  </tr>
                </thead>
                <tbody>
                  {product.vendor_maps.map((v, i) => {
                    const mapDate = (v.map_date as string | null) ?? '';
                    return (
                      <tr key={String(v.id ?? i)}>
                        <td className="pv2-vt-num">{i + 1}</td>
                        <td><span className="pv2-vendor-code">{String(v.vendor_code ?? '—')}</span></td>
                        <td className="pv2-vt-strong">{String(v.vendor_name ?? '—')}</td>
                        <td>{String(v.contact_person ?? '—')}</td>
                        <td>{String(v.contact_no ?? '—')}</td>
                        <td className="pv2-vt-num">{fmtMoney(v.purchase_price as string | number | null)}</td>
                        <td className="pv2-vt-num">{`${Number(v.gst_percentage ?? 0).toFixed(2)}%`}</td>
                        <td className="pv2-vt-num">{fmtMoney(v.gst_amount as string | number | null)}</td>
                        <td className="pv2-vt-num pv2-vt-total">{fmtMoney(v.total_amount as string | number | null)}</td>
                        <td>{mapDate
                          ? new Date(mapDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <AddProductModal
          productId={product.id}
          /* Hand the already-loaded product so the modal can skip its
           * own /products/{id} refetch. Production network panel
           * showed that duplicate call costing ~2 sec. */
          initialProduct={product}
          onClose={() => setEditOpen(false)}
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
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
function Row(props: { k: string; v: string; accent?: 'success' | 'danger' }) {
  const hasValue = props.v && props.v !== '—';
  return (
    <div className="pv2-info-row">
      <span className="pv2-info-key">{props.k}</span>
      {hasValue ? (
        <Tooltip label={props.v} position="top" maxWidth={320}>
          <span className={`pv2-info-val${props.accent ? ` pv2-info-val-${props.accent}` : ''}`}>{props.v}</span>
        </Tooltip>
      ) : (
        <span className={`pv2-info-val${props.accent ? ` pv2-info-val-${props.accent}` : ''}`}>{props.v}</span>
      )}
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
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
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
  max-height: 380px;
  overflow-y: scroll;
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
  aspect-ratio: 4 / 3;
  max-height: 380px;
  border-radius: 12px; overflow: hidden;
  border: 1.5px solid #e2e8f0;
  background: #f8fafc;
  display: flex; align-items: center; justify-content: center;
  min-width: 0;
}
.pv2-main-image img { width: 100%; height: 100%; object-fit: cover; }
.pv2-main-empty { font-size: 80px; font-weight: 800; color: #c4b5fd; }

/* Head row */
.pv2-right { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
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
}
.pv2-info-block {
  display: flex; flex-direction: column;
  max-height: 380px;
  min-width: 0;
}
.pv2-info-heading {
  font-size: 14px; font-weight: 800; color: #5b21b6;
  margin: 0 0 8px 0;
  letter-spacing: -.01em;
}
.pv2-info-heading-sub { margin-top: 14px; }
.pv2-info-body {
  display: flex; flex-direction: column; gap: 4px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
  padding-right: 4px;
}
.pv2-info-body::-webkit-scrollbar { width: 5px; }
.pv2-info-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
.pv2-info-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.pv2-info-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 12.5px;
  padding: 1px 0;
}
.pv2-info-key { color: #475569; font-weight: 500; }
.pv2-info-val {
  color: #94a3b8; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 55%;
  text-align: right;
}
.pv2-info-val-success { color: #16a34a; font-weight: 700; }
.pv2-info-val-danger  { color: #dc2626; font-weight: 700; }
.pv2-info-divider { height: 1px; background: #e2e8f0; margin: 6px 0; }
.pv2-total-line .pv2-info-key { font-weight: 800; color: #1e293b; }
.pv2-total-strong { color: #5b21b6; font-size: 15px; font-weight: 800; }

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
[data-bs-theme="dark"] .pv2-info-row .pv2-info-key { color: #adb5bd; font-weight: 500; }
[data-bs-theme="dark"] .pv2-info-row .pv2-info-val { color: #a89fc7; }
[data-bs-theme="dark"] .pv2-info-divider { background: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-total-line .pv2-info-key { color: #ede9fe; }
[data-bs-theme="dark"] .pv2-total-strong { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-tabs { border-bottom-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-tab { color: #6b7280; }
[data-bs-theme="dark"] .pv2-tab:hover { color: #a8b6e9; }
[data-bs-theme="dark"] .pv2-tab.on { color: #a8b6e9; border-bottom-color: #6366f1; }
[data-bs-theme="dark"] .pv2-tab-text { color: #ced4da; }
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
`;
