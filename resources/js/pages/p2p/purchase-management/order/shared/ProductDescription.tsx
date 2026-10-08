import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';

/** The Product Management detail view, opened by "Read more" on a description. */
const InspectionProductView = lazy(() => import('../physical-inspection/InspectionProductView'));

/* Hovering "Read more" starts the same downloads the click needs, so the view
   is already in memory when the click lands. */
export const warmProductView = () => {
  void import('../physical-inspection/InspectionProductView');
  void import('../../../p2p-master-management/product-management/ProductView');
};

/**
 * A product description in a table cell.
 *
 * Long trade descriptions are clipped to three lines; "Read more" opens the
 * product's own detail view rather than unfolding the cell, because a cell that
 * grows pushes every row below it down and the table stops being scannable.
 *
 * Shared by the purchase order's product table and the supplier invoice's
 * 3-way match, so a description reads the same on both and the clamp only has
 * to be right once.
 */
export default function ProductDescription({ text, onOpen }: {
  text: string;
  /** Omitted when there is no product to open; "Read more" is then not shown. */
  onOpen?: () => void;
}) {
  // Clamped only when the text really runs past 3 lines; then "Read more" ends the 3rd line.
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    /* The column is fixed, but the panel is not: a resize changes how many
       words fit, and with it whether there is anything left to read. */
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div className="cpd-desc">
      <span ref={ref} className={`cpd-desc__wrap${clamped ? ' is-clamped' : ''}`}>
        {text}
        {onOpen && (
          <button
            type="button"
            className="cpd-more"
            onClick={onOpen}
            onPointerEnter={warmProductView}
            title="Open the product details"
          >
            {clamped ? '… Read more' : 'Read more'}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The detail view "Read more" opens, mounted only once something asked for it.
 *
 * Kept beside the description so a table only has to hold the id it is showing,
 * not the loading and teardown of a view it may never open.
 */
export function ProductDetailView({ productId, onClose }: {
  productId: number | null;
  onClose: () => void;
}) {
  if (productId == null) return null;
  return (
    <Suspense fallback={null}>
      <InspectionProductView productId={productId} onClose={onClose} />
    </Suspense>
  );
}
