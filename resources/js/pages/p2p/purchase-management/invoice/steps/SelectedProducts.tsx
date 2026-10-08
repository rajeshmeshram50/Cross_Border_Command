import { memo, useCallback } from 'react';
import { IcoCheck, IcoX } from '../../../icons';
import { DESC_MAX, truncateDesc, type ProductLine } from '../invoice-products';

/**
 * The identifiers printed on one product inside a mixed carton.
 *
 * Per product, not per box. A master carton holding four SKUs holds four
 * batches, four expiry dates and four lot numbers, so one set of box-level
 * fields could only ever describe one of them — and on a recall the other
 * three would be untraceable. The prototype keeps these at box level; this is
 * a deliberate difference, and the reason the table is this wide.
 */
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

/** The identity columns, in the order the prototype's Advanced Details lists them. */
const IDENTITY_COLUMNS: {
  key: keyof ProductIdentity; label: string; placeholder: string; type: 'text' | 'date';
}[] = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
  /* Last, and wider: it is a sentence rather than a code, and it is the one
     field here whose length is not known in advance. */
  { key: 'remarks', label: 'Remarks', placeholder: 'Any note about this product…', type: 'text' },
];

/**
 * Selected Products — what is going into one mixed carton.
 *
 * Scenario 03 packs several SKUs into a single master carton under one shared
 * label, so this table is the carton's contents list: what is inside, how many
 * of each, and the identifiers that belong to each one.
 */
function SelectedProducts({
  lines, identities, onIdentityChange, onRemove, onClear,
}: {
  /** The ticked products, in the order they were ticked. */
  lines: ProductLine[];
  identities: Record<string, ProductIdentity>;
  onIdentityChange: (code: string, patch: Partial<ProductIdentity>) => void;
  /** Takes one product back out of the carton. */
  onRemove: (code: string) => void;
  onClear: () => void;
}) {
  const totalUnits = lines.reduce((n, l) => n + l.spiQty, 0);

  return (
    <div className="vti-box invf-selprod">
      <div className="vti-header">
        <div className="vti-header-ico"><IcoCheck size={18} stroke={2.6} /></div>
        <div className="vti-header-text">
          <div className="vti-header-title">Selected Products ({lines.length})</div>
          <div className="vti-header-sub">
            Everything going into this carton &nbsp;·&nbsp; identifiers are per product
          </div>
        </div>
        <div className="vti-header-stats">
          <div className="vti-stat-pill total">
            <div className="vti-stat-dot" />Total: {totalUnits} unit{totalUnits === 1 ? '' : 's'}
          </div>
          <button type="button" className="invf-selprod__clear" onClick={onClear}>
            <IcoX size={11} stroke={2.6} /> Clear Selection
          </button>
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
              <th>SPI Qty</th>
              {IDENTITY_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <IdentityRow
                key={line.code}
                index={i}
                line={line}
                identity={identities[line.code] ?? EMPTY_IDENTITY}
                onChange={onIdentityChange}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One product in the carton.
 *
 * Memoised: there are six inputs per row, and without this every keystroke in
 * any of them would re-render every other row's six as well.
 */
const IdentityRow = memo(function IdentityRow({
  index, line, identity, onChange, onRemove,
}: {
  index: number;
  line: ProductLine;
  identity: ProductIdentity;
  onChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove: (code: string) => void;
}) {
  /* Bound to this row's code, so each cell below passes only its own value. */
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
      <td className="vti-desc" title={line.description.length > DESC_MAX ? line.description : undefined}>
        <span className="vti-desc__wrap">{truncateDesc(line.description)}</span>
      </td>
      <td><span className="vti-qty-badge">{line.spiQty}</span></td>

      {IDENTITY_COLUMNS.map(c => (
        <td key={c.key}>
          <input
            className={`cpd-in invf-selprod__in${c.key === 'remarks' ? ' invf-selprod__in--note' : ''}`}
            type={c.type}
            placeholder={c.placeholder}
            value={identity[c.key]}
            onChange={e => patch({ [c.key]: e.target.value })}
            aria-label={`${c.label} for ${line.spiName}`}
          />
        </td>
      ))}

      <td>
        <button
          type="button"
          className="invf-selprod__rm"
          onClick={() => onRemove(line.code)}
          title={`Take ${line.spiName} out of this carton`}
          aria-label={`Remove ${line.spiName}`}
        >
          <IcoX size={12} stroke={2.6} />
        </button>
      </td>
    </tr>
  );
});

export default memo(SelectedProducts);
