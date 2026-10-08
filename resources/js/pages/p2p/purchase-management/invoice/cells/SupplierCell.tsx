import { memo } from 'react';
import { SupplierCategoryBadge } from './Pills';
import type { InvoiceSupplierCategory } from '../types';

/**
 * Supplier name with its standing underneath.
 *
 * `.ord-supplier` / `__name` — the PO list's own supplier cell, which already
 * truncates the name with an ellipsis while leaving the badge alone. In a 164px
 * column a long name must give way, but a half-rendered "High Risk Suppl…"
 * would be worse than useless.
 */
function SupplierCellBase({
  name, category,
}: { name: string; category: InvoiceSupplierCategory }) {
  return (
    <div className="ord-supplier">
      {/* title so the full name is reachable on hover when it is cut off. */}
      <span className="ord-supplier__name" title={name}>{name}</span>
      <SupplierCategoryBadge category={category} />
    </div>
  );
}

export const SupplierCell = memo(SupplierCellBase);
