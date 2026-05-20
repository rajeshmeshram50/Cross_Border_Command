import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
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
      <div className="pv2-root">
        <style>{SCOPED_CSS}</style>
        <div className="pv2-loading">Loading product…</div>
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
                <button className="pv2-back" onClick={() => navigate('/products')}>
                  <i className="ri-arrow-left-s-line" /> Back
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
                  <Row k="Batch No"  v="—" />
                  <Row k="Serial No" v="—" />
                  <Row k="Cat No"    v="—" />
                  <Row k="Lot No"    v="—" />
                </div>
              </div>

              {/* Pricing */}
              <div className="pv2-info-block">
                <h6 className="pv2-info-heading">Product Pricing Details:</h6>
                <div className="pv2-info-body">
                  <Row k="Product Base Price" v={fmtMoney(product.base_price)} />
                  <Row k="GST %"              v={gstPct ? `${gstPct}%` : '—'} />
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
              product.qc_records.length === 0 ? (
                <p className="pv2-tab-text"><em className="pv2-muted">No QC records.</em></p>
              ) : (
                <div className="table-responsive">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>SR</th><th>QC Name</th><th>Purpose</th><th>Issued By</th><th>Testing</th><th>Min Acceptance</th>
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

        <div className="pv2-card pv2-vendors-card">
          <div className="pv2-vendors-head">
            <i className="ri-links-line" />
            Product Vendors
            <span className="pv2-vendors-count">{product.vendor_maps.length}</span>
          </div>
          {product.vendor_maps.length === 0 ? (
            <div className="pv2-vendors-empty">No vendors mapped to this product.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle table-nowrap mb-0">
                <thead className="table-light pv2-vendors-thead">
                  <tr>
                    <th>SR</th>
                    <th>CODE</th>
                    <th>COMPANY</th>
                    <th>CONTACT</th>
                    <th>PHONE</th>
                    <th>PRICE</th>
                    <th>GST%</th>
                    <th>TOTAL</th>
                    <th>ACT</th>
                  </tr>
                </thead>
                <tbody>
                  {product.vendor_maps.map((v, i) => (
                    <tr key={String(v.id ?? i)}>
                      <td>{i + 1}</td>
                      <td><span className="fw-medium text-primary font-monospace fs-13">{String(v.vendor_code ?? '—')}</span></td>
                      <td>{String(v.vendor_name ?? '—')}</td>
                      <td>{String(v.contact_person ?? '—')}</td>
                      <td><span className="font-monospace fs-13">{String(v.contact_no ?? '—')}</span></td>
                      <td><span className="fs-13">₹{Number(v.purchase_price ?? 0).toLocaleString('en-IN')}</span></td>
                      <td><span className="fs-13">{Number(v.gst_percentage ?? 0)}%</span></td>
                      <td><span className="text-success fw-semibold fs-13">₹{Number(v.total_amount ?? 0).toLocaleString('en-IN')}</span></td>
                      <td>
                        <div className="hstack gap-1">
                          <button className="btn btn-sm btn-soft-info"    type="button" title="View"><i className="ri-eye-line" /></button>
                          <button className="btn btn-sm btn-soft-primary" type="button" title="Edit"><i className="ri-pencil-line" /></button>
                        </div>
                      </td>
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
            if (finalised) setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
function Row(props: { k: string; v: string; accent?: 'success' | 'danger' }) {
  return (
    <div className="pv2-info-row">
      <span className="pv2-info-key">{props.k}</span>
      <span className={`pv2-info-val${props.accent ? ` pv2-info-val-${props.accent}` : ''}`}>{props.v}</span>
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
/* Edit Product — dark navy block button matching the design */
.pv2-edit {
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: #fff; border: none;
  box-shadow: 0 4px 12px rgba(15,23,42,.3);
}
.pv2-edit:hover {
  transform: translateY(-1px);
  background: linear-gradient(135deg, #334155, #1e293b);
  box-shadow: 0 6px 18px rgba(15,23,42,.45);
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
.pv2-info-key { color: #5b21b6; font-weight: 700; }
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
[data-bs-theme="dark"] .pv2-edit { background: linear-gradient(135deg, #334155, #1e293b); }
[data-bs-theme="dark"] .pv2-edit:hover { background: linear-gradient(135deg, #475569, #334155); }
[data-bs-theme="dark"] .pv2-info-grid { border-top-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .pv2-info-heading { color: #c4b5fd; }
[data-bs-theme="dark"] .pv2-info-row .pv2-info-key { color: #c4b5fd; }
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
[data-bs-theme="dark"] .pv2-status.is-active { background: rgba(34,197,94,.12); color: #4ade80; border-color: rgba(34,197,94,.3); }
[data-bs-theme="dark"] .pv2-status.is-inactive { background: rgba(245,158,11,.12); color: #fcd34d; border-color: rgba(245,158,11,.3); }
`;
