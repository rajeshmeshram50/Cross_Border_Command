import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
import AddProductModal from './AddProductModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Product Detail view (route: /products/:id)
 *
 * Two-card layout (matches the shared design):
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ Image gallery │ Product header + 3 info columns │ Edit button       │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌──────────────────────────────────────┐ ┌────────────────────────────┐
 *   │ Tabs + content                       │ │ Product Vendors table      │
 *   └──────────────────────────────────────┘ └────────────────────────────┘
 *
 * Tabs:
 *   • Product Printable Description
 *   • Make/Brand/Specifications
 *   • Confidential Information
 *   • QC & Compliance
 *
 * The detail page loads the product via GET /products/{id} and surfaces all
 * relations (segment, uom, hsn, condition, packaging_material, gst_percentage,
 * qc_records, vendor_maps).
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

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get<ProductDto>(`/products/${id}`);
      setProduct(res.data);
      setActiveImg(0);
    } catch {
      toast.error('Not Found', 'Product not available');
      navigate('/products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  /* ─── Image list — prefer the *_url accessors, fall back to raw paths
     resolved client-side. Filters out anything blank/blob: garbage. ─── */
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
    return (
      <div className="pv-root">
        <style>{SCOPED_CSS}</style>
        <div className="pv-loading">Loading product…</div>
      </div>
    );
  }
  if (!product) return null;

  const statusText = (product.status || 'draft').replace(/^./, c => c.toUpperCase());
  const isActive = product.status === 'active';
  const isHaz = String(product.haz_type ?? '').toLowerCase() === 'haz';

  const segmentName = (product.segment?.title as string) ?? '—';
  const hazClassName = (product.haz_class?.name as string) ?? '—';
  const uomName = (product.uom?.short_code as string) ?? (product.uom?.title as string) ?? '—';
  const hsnCode = (product.hsn?.hsn_code as string) ?? '—';
  const conditionName = (product.condition?.title as string) ?? '—';
  const packagingName = (product.packaging_material?.title as string) ?? '—';
  const gstPct = Number(product.gst_percentage?.percentage ?? 0);

  const fmtNum = (v: string | number | null | undefined, unit = '') =>
    v == null || v === '' ? '—' : `${Number(v).toLocaleString('en-IN')}${unit ? ' ' + unit : ''}`;
  const fmtMoney = (v: string | number | null | undefined) =>
    v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <div className="pv-root">
      <style>{SCOPED_CSS}</style>

      <div className="pv-toolbar">
        <button className="pv-back" onClick={() => navigate('/products')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Products
        </button>
      </div>

      {/* ─── Top card: gallery + info columns ─── */}
      <div className="pv-card pv-top">
        <div className="pv-top-left">
          <div className="pv-gallery">
            <div className="pv-thumbs">
              {images.length === 0 && (
                <div className="pv-thumb pv-thumb-empty">
                  {product.name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`pv-thumb ${i === activeImg ? 'on' : ''}`}
                  onClick={() => setActiveImg(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
            <div className="pv-main-image">
              {images.length > 0 ? (
                <img src={images[activeImg]} alt={product.name} />
              ) : (
                <div className="pv-main-empty">
                  {product.name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              {images.length > 1 && (
                <div className="pv-dots">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      className={`pv-dot ${i === activeImg ? 'on' : ''}`}
                      onClick={() => setActiveImg(i)}
                      aria-label={`Image ${i + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        <div className="pv-top-right">
          <div className="pv-head">
            <div className="pv-head-text">
              <div className="pv-title">
                <span className="pv-code">{product.product_code}</span>
                <span className="pv-sep">|</span>
                <span className="pv-name">{product.name}</span>
              </div>
              <div className="pv-meta-row">
                <span className="pv-sold-chip">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20.59 13.41 12 22l-9-9V4h9z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  10
                </span>
                <span className="pv-sold-text">This product sold out 10 times</span>
              </div>
              <div className="pv-price-row">
                <span className="pv-price-key">Total Selling Price:</span>
                <span className="pv-price-val">{fmtMoney(product.total_price)}</span>
                <span className={`pv-status ${isActive ? 'is-active' : 'is-inactive'}`}>{statusText}</span>
              </div>
            </div>
            <button className="pv-edit" onClick={() => setEditOpen(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Product
            </button>
          </div>

          <div className="pv-info-grid">
            {/* Product Details column */}
            <div className="pv-info-col">
              <div className="pv-info-title">Product Details:</div>
              <Field k="Product Generic Name" v={product.generic_name || '—'} />
              <Field k="HSN / SAC" v={hsnCode} />
              <Field k="Segment" v={segmentName} />
              <Field k="Haz / Non-Haz" v={product.haz_type || '—'} />
              <Field k="Haz Class" v={isHaz ? hazClassName : '—'} />
              <Field k="Unit Of Measurement" v={uomName} />
              <Field k="Condition" v={conditionName} />
              <Field k="Packaging Material" v={packagingName} />
              <Field k="Bottom / Non-Bottom" v={product.mark_bottom || '—'} />
            </div>

            {/* Box Matrix + Inventory column */}
            <div className="pv-info-col">
              <div className="pv-info-title">Box Matrix Details:</div>
              <Field k="Per Box Net Weight"   v={fmtNum(product.net_weight, 'kg')} />
              <Field k="Per Box Gross Weight" v={fmtNum(product.gross_weight, 'kg')} />
              <Field k="Per Box Length"       v={fmtNum(product.length_cm, 'cm')} />
              <Field k="Per Box Width"        v={fmtNum(product.width_cm, 'cm')} />
              <Field k="Per Box Height"       v={fmtNum(product.height_cm, 'cm')} />

              <div className="pv-info-title pv-info-title-sub">Inventory Details:</div>
              <Field k="Batch No"  v="—" />
              <Field k="Serial No" v="—" />
              <Field k="Cat No"    v="—" />
              <Field k="Lot No"    v="—" />
            </div>

            {/* Pricing column */}
            <div className="pv-info-col">
              <div className="pv-info-title">Product Pricing Details:</div>
              <Field k="Product Base Price" v={fmtMoney(product.base_price)} />
              <Field k="GST %"              v={gstPct ? `${gstPct}%` : '—'} />
              <Field k="GST Amount"         v={fmtMoney(product.gst_amount)} />
              <div className="pv-info-divider" />
              <div className="pv-info-row pv-total-row">
                <span className="pv-info-key">Total Selling Price:</span>
                <span className="pv-total-val">{fmtMoney(product.total_price)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom row: Tabs + Vendors table ─── */}
      <div className="pv-bottom">
        <div className="pv-card pv-tabs-card">
          <div className="pv-tabs">
            <button className={`pv-tab ${tab === 'desc' ? 'on' : ''}`}         onClick={() => setTab('desc')}>Product Printable Description</button>
            <button className={`pv-tab ${tab === 'brand' ? 'on' : ''}`}        onClick={() => setTab('brand')}>Make/Brand/Specifications</button>
            <button className={`pv-tab ${tab === 'confidential' ? 'on' : ''}`} onClick={() => setTab('confidential')}>Confidential Information</button>
            <button className={`pv-tab ${tab === 'qc' ? 'on' : ''}`}           onClick={() => setTab('qc')}>QC &amp; Compliance</button>
          </div>
          <div className="pv-tab-body">
            {tab === 'desc' && (
              <p className="pv-tab-text">{product.description || <em className="pv-muted">No description provided.</em>}</p>
            )}
            {tab === 'brand' && (
              <p className="pv-tab-text">{product.brand || <em className="pv-muted">No brand / make / specifications recorded.</em>}</p>
            )}
            {tab === 'confidential' && (
              <p className="pv-tab-text">{product.confidential_info || <em className="pv-muted">No confidential information.</em>}</p>
            )}
            {tab === 'qc' && (
              product.qc_records.length === 0 ? (
                <p className="pv-tab-text"><em className="pv-muted">No QC records.</em></p>
              ) : (
                <div className="table-responsive">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Sr No</th>
                        <th>QC Name</th>
                        <th>Purpose</th>
                        <th>Issued By</th>
                        <th>Testing Parameter</th>
                        <th>Min Acceptance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.qc_records.map((q, i) => (
                        <tr key={String(q.id ?? i)}>
                          <td>{i + 1}</td>
                          <td><strong>{String(q.qc_name ?? '')}</strong></td>
                          <td>{String(q.qc_purpose ?? '—')}</td>
                          <td>{String(q.issued_by ?? '—')}</td>
                          <td>{String(q.qa_testing_parameter ?? '—')}</td>
                          <td>{String(q.min_acceptance_criteria ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>

        <div className="pv-card pv-vendors-card">
          <div className="pv-vendors-head">Product Vendors</div>
          {product.vendor_maps.length === 0 ? (
            <div className="pv-vendors-empty">No vendors mapped to this product.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle table-nowrap mb-0">
                <thead className="table-light pv-vendors-thead">
                  <tr>
                    <th>Sr No</th>
                    <th>Vendor Code</th>
                    <th>Vendor Company Name</th>
                    <th>Contact Person Name</th>
                    <th>Contact No</th>
                  </tr>
                </thead>
                <tbody>
                  {product.vendor_maps.map((v, i) => (
                    <tr key={String(v.id ?? i)}>
                      <td>{i + 1}</td>
                      <td><span className="fw-medium text-primary font-monospace fs-13">{String(v.vendor_code ?? '—')}</span></td>
                      <td>{String(v.vendor_name ?? '—')}</td>
                      <td>{String(v.contact_person ?? '—')}</td>
                      <td>{String(v.contact_no ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <AddProductModal
          productId={product.id}
          onClose={() => setEditOpen(false)}
          onSaved={(_pid, finalised) => {
            load();
            if (finalised) { setEditOpen(false); }
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
function Field(props: { k: string; v: string }) {
  return (
    <div className="pv-info-row">
      <span className="pv-info-key">{props.k}:</span>
      <span className="pv-info-val">{props.v}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
const SCOPED_CSS = `
.pv-root {
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  background: #ffffff;
  padding: 14px 18px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 14px;
}
.pv-root *, .pv-root *::before, .pv-root *::after { box-sizing: border-box; }

.pv-loading { padding: 60px 20px; text-align: center; color: #6b7280; font-weight: 600; }

/* Back button */
.pv-toolbar { display: flex; align-items: center; }
.pv-back {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px;
  border: 1.5px solid #e2e8f0; background: #fff; color: #475569;
  border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s, color .15s;
}
.pv-back:hover { background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6; }

/* Card surface — mirrors the Velzon table-card chrome used elsewhere */
.pv-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 2px 10px rgba(0,0,0,.04);
}

/* ─── Top card ─── */
.pv-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 24px;
}
.pv-top-left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pv-top-right { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* Gallery */
.pv-gallery { display: grid; grid-template-columns: 88px 1fr; gap: 12px; min-width: 0; }
.pv-thumbs { display: flex; flex-direction: column; gap: 8px; }
.pv-thumb {
  width: 88px; height: 88px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #f8fafc;
  cursor: pointer; padding: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  transition: border-color .15s, transform .12s;
}
.pv-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pv-thumb.on { border-color: #7c3aed; transform: scale(1.03); }
.pv-thumb:hover { border-color: #c4b5fd; }
.pv-thumb-empty {
  color: #94a3b8; font-size: 24px; font-weight: 800;
}

.pv-main-image {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 12px; overflow: hidden;
  border: 1.5px solid #e2e8f0;
  background: #f8fafc;
  display: flex; align-items: center; justify-content: center;
  min-width: 0;
}
.pv-main-image img { width: 100%; height: 100%; object-fit: contain; }
.pv-main-empty {
  font-size: 110px; font-weight: 800; color: #c4b5fd; letter-spacing: -2px;
}
.pv-dots {
  position: absolute; left: 0; right: 0; bottom: 10px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.pv-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(15, 23, 42, .25); border: none; cursor: pointer; padding: 0;
  transition: background .15s, transform .15s;
}
.pv-dot.on { background: #7c3aed; transform: scale(1.25); }

/* Head row (right side) */
.pv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.pv-head-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pv-title {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 18px; font-weight: 800; color: #1e1b4b;
  min-width: 0; flex-wrap: wrap;
}
.pv-code { color: #5b21b6; flex-shrink: 0; }
.pv-sep  { color: #c4b5fd; }
.pv-name { color: #1e1b4b; }
.pv-meta-row { display: inline-flex; align-items: center; gap: 8px; }
.pv-sold-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 99px;
  background: linear-gradient(135deg, #22c55e, #15803d);
  color: #fff; font-size: 11px; font-weight: 800;
}
.pv-sold-text { font-size: 12px; color: #6b7280; }
.pv-price-row { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pv-price-key { font-size: 13px; font-weight: 800; color: #1e1b4b; }
.pv-price-val { font-size: 17px; font-weight: 800; color: #5b21b6; }
.pv-status {
  padding: 2px 9px; border-radius: 99px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .02em;
}
.pv-status.is-active   { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.pv-status.is-inactive { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }

.pv-edit {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 16px;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: #fff; border: none; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 12px rgba(15,23,42,.3);
  transition: transform .12s, box-shadow .15s;
  flex-shrink: 0;
}
.pv-edit:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,.45); }

/* Info grid */
.pv-info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
}
.pv-info-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pv-info-title {
  font-size: 13.5px; font-weight: 800; color: #1e1b4b;
  margin-bottom: 4px;
}
.pv-info-title-sub { margin-top: 12px; }
.pv-info-row {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12.5px;
  min-width: 0;
}
.pv-info-key { color: #1e1b4b; font-weight: 700; flex-shrink: 0; }
.pv-info-val {
  color: #6b7280; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; flex: 1;
}
.pv-info-divider { height: 1px; background: #e2e8f0; margin: 8px 0; }
.pv-total-row .pv-info-key { color: #1e1b4b; }
.pv-total-val { color: #5b21b6; font-size: 17px; font-weight: 800; }

/* ─── Bottom row ─── */
.pv-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 18px;
}
.pv-tabs-card,
.pv-vendors-card { min-width: 0; }
.pv-tabs {
  display: flex; gap: 4px; flex-wrap: wrap;
  border-bottom: 1.5px solid #e2e8f0;
  margin-bottom: 14px;
}
.pv-tab {
  background: none; border: none; padding: 8px 14px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.pv-tab:hover { color: #6d28d9; }
.pv-tab.on { color: #5b21b6; border-bottom-color: #7c3aed; }
.pv-tab-body { min-height: 80px; }
.pv-tab-text { font-size: 13px; color: #475569; line-height: 1.55; margin: 0; }
.pv-muted { color: #94a3b8; font-style: italic; }

/* Vendors card */
.pv-vendors-head {
  font-size: 14px; font-weight: 800; color: #1e1b4b;
  margin-bottom: 12px;
}
.pv-vendors-empty {
  padding: 24px; text-align: center; color: #94a3b8; font-size: 12.5px;
  border: 1.5px dashed #e2e8f0; border-radius: 10px;
}
.pv-vendors-thead th {
  background: linear-gradient(135deg, #312e81, #4338ca) !important;
  color: #fff !important; font-weight: 700; font-size: 11.5px;
  letter-spacing: .02em;
}

@media (max-width: 1100px) {
  .pv-top { grid-template-columns: 1fr; }
  .pv-bottom { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .pv-info-grid { grid-template-columns: 1fr; }
  .pv-gallery { grid-template-columns: 64px 1fr; }
  .pv-thumb { width: 64px; height: 64px; }
}

/* ════════════════════════════════════════════════════════════════════════
 * Dark mode
 * ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .pv-root {
  background: #0f0d1f;
  color: #ede9fe;
}
[data-bs-theme="dark"] .pv-back {
  background: #1a1430; border-color: #3b2a6b; color: #c4b5fd;
}
[data-bs-theme="dark"] .pv-back:hover { background: #221852; border-color: #4c1d95; color: #ede9fe; }
[data-bs-theme="dark"] .pv-card {
  background: #1a1430; border-color: #3b2a6b;
  box-shadow: 0 2px 10px rgba(0,0,0,.4);
}
[data-bs-theme="dark"] .pv-thumb { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .pv-thumb.on { border-color: #a78bfa; }
[data-bs-theme="dark"] .pv-main-image { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .pv-main-empty { color: #4c1d95; }
[data-bs-theme="dark"] .pv-dot { background: rgba(255,255,255,.25); }
[data-bs-theme="dark"] .pv-dot.on { background: #a78bfa; }
[data-bs-theme="dark"] .pv-title,
[data-bs-theme="dark"] .pv-name,
[data-bs-theme="dark"] .pv-info-title,
[data-bs-theme="dark"] .pv-info-key,
[data-bs-theme="dark"] .pv-vendors-head { color: #ede9fe; }
[data-bs-theme="dark"] .pv-code { color: #c4b5fd; }
[data-bs-theme="dark"] .pv-sep  { color: #4c1d95; }
[data-bs-theme="dark"] .pv-sold-text,
[data-bs-theme="dark"] .pv-info-val { color: #a89fc7; }
[data-bs-theme="dark"] .pv-price-val,
[data-bs-theme="dark"] .pv-total-val { color: #c4b5fd; }
[data-bs-theme="dark"] .pv-info-divider { background: #3b2a6b; }
[data-bs-theme="dark"] .pv-info-grid { border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .pv-status.is-active   { background: #14241a; color: #4ade80; border-color: #14532d; }
[data-bs-theme="dark"] .pv-status.is-inactive { background: #3f2c0a; color: #fde68a; border-color: #78350f; }
[data-bs-theme="dark"] .pv-edit {
  background: linear-gradient(135deg, #4338ca, #312e81);
  box-shadow: 0 4px 12px rgba(67,56,202,.4);
}
[data-bs-theme="dark"] .pv-tabs { border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .pv-tab { color: #6d6391; }
[data-bs-theme="dark"] .pv-tab:hover { color: #c4b5fd; }
[data-bs-theme="dark"] .pv-tab.on { color: #c4b5fd; border-bottom-color: #a78bfa; }
[data-bs-theme="dark"] .pv-tab-text { color: #a89fc7; }
[data-bs-theme="dark"] .pv-vendors-empty { border-color: #3b2a6b; color: #6d6391; }
`;
