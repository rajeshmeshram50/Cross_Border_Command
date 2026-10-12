import { memo, useCallback } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import { IcoCheck, IcoX } from '../../../icons';
import { DESC_MAX, truncateDesc, type ProductLine } from '../invoice-products';

export interface ProductIdentity {
  serial: string;
  lot: string;
  batch: string;
  cat: string;
  expiry: string;
  mfg: string;
  remarks: string;
}

export const EMPTY_IDENTITY: ProductIdentity = {
  serial: '', lot: '', batch: '', cat: '', expiry: '', mfg: '', remarks: '',
};

export interface BoxContent {
  line: ProductLine;
  qty: number;
}

const IDENTITY_COLUMNS: {
  key: keyof ProductIdentity; label: string; placeholder: string; type: 'text' | 'date';
}[] = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
  { key: 'remarks', label: 'Remarks', placeholder: 'Any note about this product…', type: 'text' },
];

function SelectedProducts({
  rows, identities, onIdentityChange, onRemove, onClear, onQtyChange,
}: {
  rows: BoxContent[];
  onQtyChange?: (code: string, qty: number) => void;
  identities: Record<string, ProductIdentity>;
  onIdentityChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove?: (code: string) => void;
  onClear?: () => void;
}) {
  const isSelection = !!onClear;

  const totalUnits = rows.reduce((n, r) => n + r.qty, 0);

  return (
    <div className="vti-box invf-selprod">
      <div className="vti-header">
        <div className="vti-header-ico"><IcoCheck size={18} stroke={2.6} /></div>
        <div className="vti-header-text">
          <div className="vti-header-title">
            {isSelection ? `Selected Products (${rows.length})` : 'Box Contents'}
          </div>
          <div className="vti-header-sub">
            {isSelection ? 'Everything going into this carton' : 'What this box holds'}
            &nbsp;·&nbsp; identifiers are per product
          </div>
        </div>
        <div className="vti-header-stats">
          <div className="vti-stat-pill total">
            <div className="vti-stat-dot" />Total: {totalUnits} unit{totalUnits === 1 ? '' : 's'}
          </div>
          {onClear && (
            <button type="button" className="invf-selprod__clear" onClick={onClear}>
              <IcoX size={11} stroke={2.6} /> Clear Selection
            </button>
          )}
        </div>
      </div>

      <div className="vti-table-wrap">
        <table className="vti-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Code</th>
              <th className="vti-desc-h">Description</th>
              <th>Qty in Box</th>
              {IDENTITY_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
              {onRemove && <th>Remove</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <IdentityRow
                key={row.line.code}
                index={i}
                row={row}
                identity={identities[row.line.code] ?? EMPTY_IDENTITY}
                onChange={onIdentityChange}
                onRemove={onRemove}
                onQtyChange={onQtyChange}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const IdentityRow = memo(function IdentityRow({
  index, row, identity, onChange, onRemove, onQtyChange,
}: {
  index: number;
  row: BoxContent;
  onQtyChange?: (code: string, qty: number) => void;
  identity: ProductIdentity;
  onChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove?: (code: string) => void;
}) {
  const { line, qty } = row;

  const patch = useCallback(
    (p: Partial<ProductIdentity>) => onChange(line.code, p),
    [line.code, onChange],
  );

  return (
    <tr className="vti-prod-row">
      <td><span className="invf-selprod__no">{index + 1}</span></td>
      <td>
        <div className="vti-prod-cell">
          <div>
            <div className="vti-prod-name">{line.spiName}</div>
            <div className="vti-prod-sku">HSN {line.hsn}</div>
          </div>
        </div>
      </td>
      <td><span className="vti-code">{line.code}</span></td>
      <td className="vti-desc">
        <Tooltip label={line.description} disabled={line.description.length <= DESC_MAX}>
          <span className="vti-desc__wrap">{truncateDesc(line.description)}</span>
        </Tooltip>
      </td>
      <td>
        {onQtyChange ? (
          <input
            type="number" min={0} step="any" className="vti-subbox-inp"
            aria-label={`Units of ${line.spiName} in this carton`}
            value={qty}
            onChange={e => onQtyChange(line.code, Math.max(0, Number(e.target.value) || 0))}
          />
        ) : (
          <span className="vti-qty-badge">{qty}</span>
        )}
      </td>

      {IDENTITY_COLUMNS.map(c => (
        <td key={c.key}>
          {c.type === 'date' ? (
            <MasterDatePicker
              value={identity[c.key]}
              onChange={v => patch({ [c.key]: v })}
              placeholder={c.label}
            />
          ) : (
            <input
              className={`cpd-in invf-selprod__in${c.key === 'remarks' ? ' invf-selprod__in--note' : ''}`}
              type={c.type}
              placeholder={c.placeholder}
              value={identity[c.key]}
              onChange={e => patch({ [c.key]: e.target.value })}
              aria-label={`${c.label} for ${line.spiName}`}
            />
          )}
        </td>
      ))}

      {onRemove && (
        <td>
          <Tooltip label={`Take ${line.spiName} out of this carton`}>
            <button
              type="button"
              className="invf-selprod__rm"
              onClick={() => onRemove(line.code)}
              aria-label={`Remove ${line.spiName}`}
            >
              <IcoX size={12} stroke={2.6} />
            </button>
          </Tooltip>
        </td>
      )}
    </tr>
  );
});

export default memo(SelectedProducts);
