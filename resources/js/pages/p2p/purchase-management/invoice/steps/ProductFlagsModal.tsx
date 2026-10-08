import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoList, IcoPlus, IcoTag, IcoTrash, IcoX } from '../../../icons';

/** A flag someone added, beyond the three standing ones. */
export interface CustomFlag {
  id: string;
  name: string;
  color: string;
}

/**
 * The colours a custom flag can take.
 *
 * A fixed set rather than a picker: these read against the drawer's pale
 * background and against each other, which a free colour cannot be trusted to
 * do. Slate is last because it is the one that means "no particular urgency".
 */
export const FLAG_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#ec4899', '#64748b'];

/**
 * Product Flags — create and remove the flags beyond Hazardous, Cold Chain
 * and Fragile.
 *
 * Portalled to document.body: the drawer it opens from sits inside a table
 * cell, and `.vti-table-wrap`'s `overflow-x: auto` clips any descendant.
 */
export default function ProductFlagsModal({
  flags, onAdd, onRemove, onClose,
}: {
  flags: CustomFlag[];
  onAdd: (flag: CustomFlag) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(FLAG_COLORS[3]);

  useScrollLock(true);

  const trimmed = name.trim();
  /* A duplicate name would give two indistinguishable chips, so the same name
     cannot be added twice — compared case-insensitively, because "Fumigated"
     and "fumigated" are the same flag to everyone but the computer. */
  const duplicate = flags.some(f => f.name.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed.length > 0 && !duplicate;

  const add = () => {
    if (!canAdd) return;
    onAdd({ id: `cf-${Date.now()}`, name: trimmed, color });
    setName('');
  };

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl invf-flags" role="dialog" aria-modal="true" aria-labelledby="invf-flags-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoTag size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-flags-title">Product Flags</div>
              <div className="spi-mdl-sub">Add a custom flag for box packaging</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="invf-flags__card">
            <div className="invf-flags__cardhd">
              <span className="invf-flags__cardico"><IcoTag size={14} stroke={2.2} /></span>
              Create a New Flag
            </div>

            <label className="invf-flags__lbl" htmlFor="invf-flag-name">Flag Name</label>
            <div className="invf-flags__field">
              <span className="invf-flags__fieldico"><IcoTag size={13} stroke={2.2} /></span>
              <input
                id="invf-flag-name"
                className="invf-flags__inp"
                placeholder="e.g. Fumigated, Perishable, High Value…"
                value={name}
                maxLength={28}
                onChange={e => setName(e.target.value)}
                /* Enter adds, so a flag can be typed and created without
                   reaching for the button. */
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              />
            </div>
            {duplicate && <div className="invf-flags__err">A flag called “{trimmed}” already exists.</div>}

            <div className="invf-flags__lbl">Color</div>
            <div className="invf-flags__swatches" role="radiogroup" aria-label="Flag colour">
              {FLAG_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`invf-flags__swatch${color === c ? ' is-on' : ''}`}
                  style={{ background: c }}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            <button type="button" className="invf-flags__add" disabled={!canAdd} onClick={add}>
              <IcoPlus size={13} stroke={2.6} /> Add Flag
            </button>
          </div>

          <div className="invf-flags__listhd">
            <span className="invf-flags__cardico"><IcoList size={14} stroke={2.2} /></span>
            Existing Flags
          </div>
          <div className="invf-flags__list">
            {flags.length === 0 ? (
              <div className="invf-flags__empty">No custom flags yet — add one above.</div>
            ) : (
              flags.map(f => (
                <div className="invf-flags__row" key={f.id}>
                  {/* The chip is tinted from the flag's own colour, so the row
                      shows exactly what it will look like on a box. */}
                  <span
                    className="invf-flags__chip"
                    style={{ color: f.color, borderColor: `${f.color}66`, background: `${f.color}14` }}
                  >
                    <IcoTag size={11} stroke={2.4} /> {f.name}
                  </span>
                  <button type="button" className="invf-flags__del" onClick={() => onRemove(f.id)}
                    aria-label={`Remove ${f.name}`} title={`Remove ${f.name}`}>
                    <IcoTrash size={13} stroke={2.2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">
            {flags.length} custom flag{flags.length === 1 ? '' : 's'} added
          </span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-confirm" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
