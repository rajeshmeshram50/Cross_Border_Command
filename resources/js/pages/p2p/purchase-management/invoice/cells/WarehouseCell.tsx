import { memo } from 'react';
import Badge from '../../../../../components/ui/Badge';
import type { InvoiceWarehouseKind } from '../types';

const HouseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" />
  </svg>
);

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" />
  </svg>
);

function WarehouseCellBase({
  name, kind,
}: { name?: string; kind?: InvoiceWarehouseKind }) {
  if (!name) return <span className="ord-dash">—</span>;
  const third = kind === 'third-party';
  return (
    <div className="ord-supplier">
      <span className="ord-supplier__name" title={name}>{name}</span>
      <Badge
        appearance="outline"
        variant={third ? 'gold' : 'info'}
        icon={third ? <PeopleIcon /> : <HouseIcon />}
        className="ord-supplier__cat"
        title={third ? 'Third-party warehouse' : 'Own warehouse'}
      >
        {third ? 'Third Party' : 'Own'}
      </Badge>
    </div>
  );
}

export const WarehouseCell = memo(WarehouseCellBase);
