import { memo, useCallback } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { IcoCheck, IcoX } from '../../../icons';
import { DESC_MAX, truncateDesc, type ProductLine } from '../invoice-products';

/**
 * The identifiers printed on one product inside a box.
 *
 * Per product, not per box. A master carton holding four SKUs holds four
 * batches, four expiry dates and four lot numbers, so one box-level set could
 * only ever describe one of them — and on a recall the other three would be
 * untraceable. A box holding one product has exactly one of each, which is the
 * same rule with one row rather than a different rule.
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

/** One line of a box's contents: the product, and how many of it are in THIS box. */
export interface BoxContent {
  line: ProductLine;
  /** This box's share, which in a split is not the product's full quantity. */
  qty: number;
}

/** The identity columns, in the order the prototype's Advanced Details listed them. */
const IDENTITY_COLUMNS: {
  key: keyof ProductIdentity; label: string; placeholder: string; type: 'text' | 'date';
}[] = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
  /* Last, and wider: it is a sentence rather than a code, and the one field
     here whose length is not known in advance. */
  { key: 'remarks', label: 'Remarks', placeholder: 'Any note about this product…', type: 'text' },
];

/**
 * What is inside one box, and the identifiers belonging to each thing in it.
 *
 * Every box panel shows this, whatever the scenario: one row for a box holding
 * a single product, several for a mixed carton. That is the point of it — the
 * identifiers used to live in a box-level "Advanced Details" panel, which a
 * mixed carton cannot answer, so there was one place to type a batch number
 * for some boxes and another for the rest.
 */
function SelectedProducts({
  rows, identities, onIdentityChange, onRemove, onClear,
}: {
  rows: BoxContent[];
  identities: Record<string, ProductIdentity>;
  onIdentityChange: (code: string, patch: Partial<ProductIdentity>) => void;
  /** Given only where a product can be taken back out — a mixed carton. */
  onRemove?: (code: string) => void;
  onClear?: () => void;
}) {
  /* A selection, not a row count: packing ONE product into a mixed carton is
     still a selection, and reading "Box Contents" there would deny the Clear
     Selection button sitting beside it. */
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
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One product in the box.
 *
 * Memoised: there are seven inputs per row, and without this every keystroke in
 * any of them would re-render every other row's seven as well.
 */
const IdentityRow = memo(function IdentityRow({
  index, row, identity, onChange, onRemove,
}: {
  index: number;
  row: BoxContent;
  identity: ProductIdentity;
  onChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove?: (code: string) => void;
}) {
  const { line, qty } = row;

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
      <td className="vti-desc">
        {/* Only once it is actually cut — a tooltip repeating text you can
            already read in full is noise. */}
        <Tooltip label={line.description} disabled={line.description.length <= DESC_MAX}>
          <span className="vti-desc__wrap">{truncateDesc(line.description)}</span>
        </Tooltip>
      </td>
      <td><span className="vti-qty-badge">{qty}</span></td>

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
