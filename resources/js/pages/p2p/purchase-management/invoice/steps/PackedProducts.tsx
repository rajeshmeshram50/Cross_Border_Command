import { useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../../components/ui/Tooltip';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoBox, IcoCheck, IcoEye, IcoPencil, IcoX } from '../../../icons';
import { lineTotals, truncateDesc, DESC_MAX, type ProductLine } from '../invoice-products';
import type { SplitBox } from './MultiBoxPanel';

/** One carton a packed product produced. */
export interface GeneratedBox {
  id: string;
  qty: number;
  /** Set when the carton is shared with other products. */
  sharedWith?: string[];
}

/** A product that has been packed, with the boxes it produced. */
export interface PackedRow {
  line: ProductLine;
  /** "1 Product → 1 Box", and so on. */
  scenario: string;
  /** Scenario 01 / 02 / 03. */
  scenarioNo: string;
  boxes: GeneratedBox[];
}

/**
 * Packed Products — everything that has been boxed.
 *
 * A packed row LEAVES the table above and appears here, so the top table is
 * always the work still to do and this one is the work already done. The two
 * never show the same product at once.
 *
 * The product columns are the same six the table above shows, so a row reads
 * identically after it moves. What this table adds is how it was packed and
 * what came out: the scenario, the boxes generated, and a way to see them.
 */
export default function PackedProducts({ rows, onEdit }: {
  rows: PackedRow[];
  /** Send a packed product back to the box generator to be repacked. */
  onEdit?: (code: string) => void;
}) {
  /* Which row's boxes are being looked at. Null is closed — one piece of
     state rather than an open flag that could disagree with the row. */
  const [showing, setShowing] = useState<PackedRow | null>(null);

  if (rows.length === 0) return null;

  const totalBoxes = new Set(rows.flatMap(r => r.boxes.map(b => b.id))).size;

  return (
    <div className="vti-box invf-packed">
      <div className="vti-header">
        <div className="vti-header-ico"><IcoCheck size={18} stroke={2.6} /></div>
        <div className="vti-header-text">
          <div className="vti-header-title">Packed Products</div>
          <div className="vti-header-sub">
            Boxed and labelled &nbsp;·&nbsp; {rows.length} product{rows.length === 1 ? '' : 's'} in {totalBoxes} box{totalBoxes === 1 ? '' : 'es'}
          </div>
        </div>
        <div className="vti-header-stats">
          <div className="vti-stat-pill boxed">
            <div className="vti-stat-dot" /><IcoCheck size={11} stroke={2.8} />{rows.length} Packed
          </div>
          <div className="vti-stat-pill total">
            <div className="vti-stat-dot" /><IcoBox size={11} stroke={2.2} />{totalBoxes} Box{totalBoxes === 1 ? '' : 'es'}
          </div>
        </div>
      </div>

      <div className="vti-table-wrap">
        <table className="vti-table">
          <thead>
            <tr>
              <th>Product (SPI)</th>
              <th>Code</th>
              <th className="vti-desc-h">Description</th>
              <th>Qty (SPI)</th>
              <th>Missing Qty</th>
              <th>Extra Qty</th>
              <th>Box Packaging Scenario</th>
              <th>Generated Boxes</th>
              <th>View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const { missing, extra } = lineTotals(row.line);
              return (
                <tr className="vti-prod-row" key={row.line.code}>
                  <td>
                    <div className="vti-prod-cell">
                      <div>
                        <div className="vti-prod-name">{row.line.spiName}</div>
                        <div className="vti-prod-sku">HSN {row.line.hsn}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="vti-code">{row.line.code}</span></td>
                  <td className="vti-desc">
                    <Tooltip label={row.line.description} disabled={row.line.description.length <= DESC_MAX}>
                      <span className="vti-desc__wrap">{truncateDesc(row.line.description)}</span>
                    </Tooltip>
                  </td>
                  <td><span className="vti-qty-badge">{row.line.spiQty}</span></td>
                  <td><span className={`cpd-qtypill${missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{missing}</span></td>
                  <td><span className={`cpd-qtypill${extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{extra}</span></td>
                  {/* The shape alone — "1 Product → Multiple Boxes" already
                      says which scenario it is, so the number was a label on
                      a label. */}
                  <td><span className="invf-scn-tag">{row.scenario}</span></td>
                  <td><span className="vti-qty-badge">{row.boxes.length}</span></td>
                  <td>
                    <span className="vti-packed-acts">
                      {/* The box list is behind a popup rather than inline: a
                          split can produce a hundred cartons, and a cell cannot
                          hold them without setting the row's height. */}
                      <Tooltip label={`View the ${row.boxes.length} box${row.boxes.length === 1 ? '' : 'es'} for ${row.line.spiName}`}>
                        <button
                          type="button"
                          className="vti-btn-single vti-btn-single--ico"
                          onClick={() => setShowing(row)}
                          aria-label={`View boxes for ${row.line.spiName}`}
                        >
                          <IcoEye size={14} />
                        </button>
                      </Tooltip>
                      {/* Sends the product back to the table above with its
                          scenario and boxes intact, so repacking is a change
                          rather than a redo. Nothing is destroyed here, which
                          is why it needs no confirmation. */}
                      {onEdit && (
                        <Tooltip label={`Repack ${row.line.spiName} — returns it to the box generator with its ${row.scenarioNo.toLowerCase()} and boxes kept`}>
                          <button
                            type="button"
                            className="vti-btn-single vti-btn-single--ico vti-btn-single--edit"
                            onClick={() => onEdit(row.line.code)}
                            aria-label={`Repack ${row.line.spiName}`}
                          >
                            <IcoPencil size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showing && <BoxListModal row={showing} onClose={() => setShowing(null)} />}
    </div>
  );
}

/**
 * Every box one packed product produced.
 *
 * Portalled to document.body: inside the page it would sit within
 * `.vti-table-wrap`, whose `overflow-x: auto` clips any descendant.
 */
function BoxListModal({ row, onClose }: { row: PackedRow; onClose: () => void }) {
  useScrollLock(true);

  const packed = row.boxes.reduce((n, b) => n + b.qty, 0);
  const empty = row.boxes.filter(b => b.qty === 0).length;

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl spi-mdl--wide" role="dialog" aria-modal="true" aria-labelledby="invf-boxes-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoBox size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-boxes-title">Generated Boxes</div>
              <div className="spi-mdl-sub">
                {row.line.spiName} · {row.scenario} · {row.boxes.length} box{row.boxes.length === 1 ? '' : 'es'}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="invf-boxlist">
            {row.boxes.map(b => (
              <div className="invf-boxchip" key={b.id}>
                <span className="invf-boxchip__id">{b.id}</span>
                {/* An empty carton is stated rather than shown as "0 units",
                    because it is a different thing from a box with nothing
                    counted in it yet. */}
                <span className={`invf-boxchip__qty${b.qty === 0 ? ' is-empty' : ''}`}>
                  {b.qty === 0 ? 'Empty' : `${b.qty} unit${b.qty === 1 ? '' : 's'}`}
                </span>
                {b.sharedWith && b.sharedWith.length > 0 && (
                  <Tooltip label={`Shared with ${b.sharedWith.join(', ')}`}>
                    <span className="invf-boxchip__shared">
                      +{b.sharedWith.length} more
                    </span>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">
            <IcoCheck size={13} /> {packed} of {row.line.spiQty} units packed
            {empty > 0 && ` · ${empty} empty box${empty === 1 ? '' : 'es'}`}
          </span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
