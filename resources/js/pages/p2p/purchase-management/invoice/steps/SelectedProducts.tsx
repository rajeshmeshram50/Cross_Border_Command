import { memo, useCallback } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import { IcoCheck, IcoX } from '../../../icons';
import { DESC_MAX, NAME_MAX, truncateDesc, truncateName, type ProductLine } from '../invoice-products';

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

type IdentityColumn = {
  key: keyof ProductIdentity; label: string; placeholder: string; type: 'text' | 'date';
};

const IDENTITY_COLUMNS: IdentityColumn[] = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
  /* Short enough to fit the same box as the codes beside it — the field still
     takes a full sentence, it just no longer asks for a wider column to say
     so while empty. */
  { key: 'remarks', label: 'Remarks', placeholder: 'Add a note…', type: 'text' },
];

const putUnits = (n: number) => `${Math.round(n * 1000) / 1000} unit${n === 1 ? '' : 's'}`;

/* The advance-details columns of the box editor, in the design's order: the
   two dates read manufactured-then-expires, which is the order they happen in.
   Remarks is ours, not the design's — the prototype has no column for it, but
   the field is saved per item (it composes the item's remark_note), so taking
   the column away took away the only place to write one. It goes last, after
   the identifiers that will be printed. */
const ADV_COLUMNS: IdentityColumn[] = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'LOT No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'CAT No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'remarks', label: 'Remarks', placeholder: 'Add a note…', type: 'text' },
];

function SelectedProducts({
  rows, identities, onIdentityChange, onRemove, onClear, onQtyChange, qtyMaxOf,
}: {
  rows: BoxContent[];
  onQtyChange?: (code: string, qty: number) => void;
  /** Ceiling for a row's stepper. Defaults to the line's whole SPI quantity,
   *  which is only right when no other box holds any of it. */
  qtyMaxOf?: (code: string) => number;
  identities: Record<string, ProductIdentity>;
  onIdentityChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove?: (code: string) => void;
  onClear?: () => void;
}) {
  const isSelection = !!onClear;

  const totalUnits = rows.reduce((n, r) => n + r.qty, 0);

  /* Editing a box that is already packed is a different job from choosing what
     goes into one, and the design gives it its own table: the identifiers that
     will be printed, each product's SPI allowance beside what this box holds.
     The selection screen above keeps the wider table it has always had. */
  if (!isSelection) {
    return (
      <div className="vti-dw-section">
        {/* No icon and no total here, unlike the sections around it: the
            design leaves this heading bare, and the box's own total already
            sits in the strip overhead. */}
        <div className="vti-dw-section-hd">
          <div className="vti-dw-section-title">Product Advance Details ({rows.length})</div>
        </div>

        <div className="vs3-wrap">
          <table className="vs3t">
            <thead>
              <tr>
                <th>Sr. No</th>
                <th>Product</th>
                <th>SPI Quantity</th>
                <th>Box Quantity</th>
                {ADV_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <AdvRow
                  key={row.line.code}
                  index={i}
                  row={row}
                  identity={identities[row.line.code] ?? EMPTY_IDENTITY}
                  onChange={onIdentityChange}
                  onRemove={onRemove}
                  onQtyChange={onQtyChange}
                  max={qtyMaxOf?.(row.line.code) ?? row.line.spiQty}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="vti-box invf-selprod">
      <div className="vti-header">
        <div className="vti-header-ico"><IcoCheck size={18} stroke={2.6} /></div>
        <div className="vti-header-text">
          <div className="vti-header-title">Selected Products ({rows.length})</div>
          <div className="vti-header-sub">
            Everything going into this carton
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
              {/* "Sr No", not "#": every other table in the flow names this
                  column, and a lone glyph is the only header you have to
                  work out. */}
              <th>Sr No</th>
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

const AdvRow = memo(function AdvRow({
  index, row, identity, onChange, onRemove, onQtyChange, max,
}: {
  index: number;
  row: BoxContent;
  onQtyChange?: (code: string, qty: number) => void;
  /** What this box may hold of this product: what it holds now plus whatever
   *  of the line is still unpacked. */
  max: number;
  identity: ProductIdentity;
  onChange: (code: string, patch: Partial<ProductIdentity>) => void;
  onRemove?: (code: string) => void;
}) {
  const { line, qty } = row;

  const patch = useCallback(
    (p: Partial<ProductIdentity>) => onChange(line.code, p),
    [line.code, onChange],
  );

  const step = (d: number) => {
    if (!onQtyChange) return;
    onQtyChange(line.code, Math.min(max, Math.max(1, qty + d)));
  };

  return (
    <tr>
      <td><span className="bst-sr">{index + 1}</span></td>
      <td className="vs3-prod">
        <div className="cpd-prod spk-prod">
          <Tooltip label={line.spiName} disabled={line.spiName.length <= NAME_MAX}>
            <div className="cpd-prod__nm">{truncateName(line.spiName)}</div>
          </Tooltip>
          <div className="cpd-prod__meta">
            <span className="cpd-code">{line.code || '—'}</span>
            <span className="cpd-kv">HSN <b>{line.hsn || '—'}</b></span>
            <span className="cpd-prod__dot" />
            <span className="cpd-kv">GST <b>{line.gst}%</b></span>
          </div>
        </div>
      </td>
      <td>
        <span className="vti-s3-prod-qty">
          <span className="vti-s3-prod-qty-dot" />{line.spiQty} u
        </span>
      </td>
      <td>
        {/* The ceiling is rarely the SPI quantity — the rest of the line is
            usually sitting in other boxes — so the pill says where it came
            from rather than leaving a button that refuses without a reason. */}
        <Tooltip label={!onQtyChange
          ? 'This box cannot be changed'
          : max < line.spiQty
            ? `${putUnits(max)} of ${putUnits(line.spiQty)} can go in this box — the other ${putUnits(line.spiQty - max)} are already in other boxes.`
            : `All ${putUnits(line.spiQty)} of this product can go in this box.`}>
          <span className="vqe">
            <button type="button" className="vqe-btn"
              onClick={() => step(-1)} disabled={!onQtyChange || qty <= 1} aria-label="Decrease">−</button>
            <input className="vqe-inp" type="number" min={1} max={max} step={1} value={qty}
              readOnly={!onQtyChange}
              onChange={e => onQtyChange?.(line.code, Math.min(max, Math.max(1, Number(e.target.value) || 1)))}
              aria-label={`Units of ${line.spiName} in this box`} />
            <button type="button" className="vqe-btn"
              onClick={() => step(1)} disabled={!onQtyChange || qty >= max} aria-label="Increase">+</button>
            <span className="vqe-max">/ <b>{max}</b></span>
          </span>
        </Tooltip>
      </td>

      {ADV_COLUMNS.map(c => (
        <td key={c.key}>
          {c.type === 'date' ? (
            <MasterDatePicker
              value={identity[c.key]}
              onChange={v => patch({ [c.key]: v })}
              placeholder={c.label}
            />
          ) : (
            <input
              className={`vs3-in${c.key === 'remarks' ? ' vs3-in--note' : ''}`}
              type="text"
              placeholder={c.placeholder}
              value={identity[c.key]}
              onChange={e => patch({ [c.key]: e.target.value })}
              aria-label={`${c.label} for ${line.spiName}`}
            />
          )}
        </td>
      ))}

      <td>
        {onRemove ? (
          <Tooltip label={`Take ${line.spiName} out of this box`}>
            <button
              type="button"
              className="vs3-rm"
              onClick={() => onRemove(line.code)}
              aria-label={`Remove ${line.spiName}`}
            >
              {/* A cross, not a bin. This takes the product out of THIS box —
                  it goes back to Pending and can be packed again. A bin says
                  the thing is being destroyed, which is a different promise
                  from the one the button keeps. */}
              <IcoX size={15} stroke={2.8} />
            </button>
          </Tooltip>
        ) : (
          <span className="spk-dash">—</span>
        )}
      </td>
    </tr>
  );
});

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
            <Tooltip label={line.spiName} disabled={line.spiName.length <= NAME_MAX}>
              <div className="vti-prod-name">{truncateName(line.spiName)}</div>
            </Tooltip>
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
