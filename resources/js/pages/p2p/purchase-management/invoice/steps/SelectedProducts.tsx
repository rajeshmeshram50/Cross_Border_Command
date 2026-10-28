import { memo, useCallback } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import { IcoTrash, IcoX } from '../../../icons';
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

/* The design's own mark for this section: a tick leaving a box, for details
   recorded against what is going in. Inline, because it is used nowhere else
   and the shared IcoCheck is a bare tick. */
/* A speech bubble — the mark a remark carries elsewhere in the flow. */
const IcoNote = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </svg>
);

const IcoCheckBox = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

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
];

function SelectedProducts({
  rows, identities, onIdentityChange, onRemove, onClear, onQtyChange, qtyMaxOf,
  remark, onRemarkChange,
}: {
  rows: BoxContent[];
  /* The box's note. It belongs to the carton rather than to any row, but it
     sits in THIS card because it is read along with the contents — given a
     card of its own it looked like a second box's worth of detail. */
  remark?: string;
  onRemarkChange?: (value: string) => void;
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

  /* ONE table for both jobs, as the design has it. Choosing what goes into a
     carton and editing a carton already packed ask the same questions — which
     products, how many of each, and the identifiers that will be printed — so
     they are the same rows. Only the heading differs: picking adds the
     running total and a way to start over, while a packed box already shows
     its total in the strip overhead and has nothing to clear.

     We had a second, wider table here with Code and Description as columns of
     their own and a plain number for the quantity. It said the same things in
     more space and left no room for the stepper, so the quantity could not be
     adjusted while picking — the one place you most want to. */
  return (
    <div className="vti-dw-section">
      <div className="vti-dw-section-hd">
        {/* The mark belongs to the picking state only, as the design has it:
            there it says these details are being recorded against a choice
            you are still making. On a box already packed the heading is bare
            — nothing is being chosen, so nothing is being ticked off. */}
        <div className="vti-dw-section-title">
          {isSelection && IcoCheckBox} Product Advance Details ({rows.length})
        </div>
        {isSelection && (
          <div className="invf-selprod__stats">
            {/* A quiet running total, not a status chip. The dotted pills in
                the Box Generation header stand for counts that change state —
                boxed, pending — and this one only adds up what is on screen,
                so the design leaves it as plain text beside the button. */}
            <span className="invf-selprod__total">
              Total: {totalUnits} unit{totalUnits === 1 ? '' : 's'}
            </span>
            <button type="button" className="invf-selprod__clear" onClick={onClear}>
              <IcoX size={11} stroke={2.6} /> Clear Selection
            </button>
          </div>
        )}
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

      {onRemarkChange && (
        <div className="vs3-rmk">
          <div className="vs3-rmk__hd">
            <span className="vs3-rmk__ico">{IcoNote}</span>
            Box Remark
          </div>
          <div className="vs3-rmk__body">
            <input
              className="vs3-rmk__in"
              type="text"
              placeholder="Any additional notes about this box…"
              value={remark ?? ''}
              onChange={e => onRemarkChange(e.target.value)}
            />
          </div>
        </div>
      )}
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
              {/* A bin, matching the action column everywhere else in the
                  app. This was a cross on the argument that the product is
                  only taken OUT of this box - it returns to Pending and can
                  be packed again - but an action column that uses a different
                  glyph from every other table costs more in recognition than
                  the distinction buys. The tooltip still says what it does. */}
              <IcoTrash size={15} stroke={2.2} />
            </button>
          </Tooltip>
        ) : (
          <span className="spk-dash">—</span>
        )}
      </td>
    </tr>
  );
});

export default memo(SelectedProducts);
