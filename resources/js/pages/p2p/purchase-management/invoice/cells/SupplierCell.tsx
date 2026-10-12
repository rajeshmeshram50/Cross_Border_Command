import { memo } from 'react';
import { SupplierCategoryBadge } from './Pills';
import type { InvoiceSupplierCategory } from '../types';

function SupplierCellBase({
  name, category,
}: { name: string; category?: InvoiceSupplierCategory }) {
  return (
    <div className="ord-supplier">
      <span className="ord-supplier__name" title={name}>{name}</span>
      {category && <SupplierCategoryBadge category={category} />}
    </div>
  );
}

export const SupplierCell = memo(SupplierCellBase);
