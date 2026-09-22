import { Suspense, lazy, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { ProductDto } from '../../../p2p-master-management/product-management/ProductView';
import type { InspectionProduct } from './inspection-shared';
import './physical-inspection.css';

const ProductView = lazy(() => import('../../../p2p-master-management/product-management/ProductView'));

function toProductDto(p: InspectionProduct): ProductDto {
  const gstAmount = Math.round(p.price * p.gst) / 100;
  return {
    id: Number(p.code.replace(/\D/g, '')) || 0,
    product_code: p.code,
    name: p.name,
    generic_name: null,
    description: p.desc,
    brand: p.brand,
    haz_type: 'non-haz',
    confidential_info: null,
    primary_image: null,
    primary_image_url: null,
    secondary_images: null,
    secondary_images_url: null,
    base_price: p.price,
    gst_amount: gstAmount,
    total_price: p.price + gstAmount,
    mark_bottom: null,
    net_weight: null,
    gross_weight: null,
    length_cm: null,
    width_cm: null,
    height_cm: null,
    batch_no: null,
    serial_no: null,
    cat_no: null,
    lot_no: null,
    status: 'active',
    step_completed: 4,
    segment: { title: p.segment },
    haz_class: null,
    uom: { title: p.uom, short_code: p.uomShort },
    hsn: { hsn_code: p.hsn },
    condition: { title: p.condition },
    packaging_material: { title: p.packaging },
    gst_percentage: { percentage: p.gst },
    qc_records: [],
    vendor_maps: [{}],
  };
}

/** Opens a sample product (`product`) or a real product master record (`productId`). */
export default function InspectionProductView({ product, productId, onClose }: {
  product?: InspectionProduct; productId?: number; onClose: () => void;
}) {
  useScrollLock(true, '.pins-pv');
  const dto = useMemo(() => (product ? toProductDto(product) : undefined), [product]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <Suspense
      fallback={(
        <div className="spi-mdl-backdrop pins-layer" aria-busy="true">
          <span className="spinner-border text-light" role="status" />
        </div>
      )}
    >
      <div className="prd-detail-overlay pins-layer pins-pv">
        <div className="prd-detail-modal">
          <ProductView productId={productId ?? dto?.id} preview={dto} onClose={onClose} readOnly />
        </div>
      </div>
    </Suspense>,
    document.body,
  );
}
