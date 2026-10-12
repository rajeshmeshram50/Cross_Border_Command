import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../../components/ui/Tooltip';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoBox, IcoCheck, IcoEye, IcoPencil, IcoX } from '../../../icons';
import { lineTotals, truncateDesc, DESC_MAX, type ProductLine } from '../invoice-products';

/** One product inside a carton, and how much of it is in THIS carton. */
export interface PackedItem {
  line: ProductLine;
  qty: number;
}

/** A carton that has been saved, with its contents. */
export interface PackedBox {
  /** B-001 … */
  code: string;
  /** "1 Product → 1 Box", and so on. */
  scenario: string;
  /** Scenario 01 / 02 / 03. */
  scenarioNo: string;
  items: PackedItem[];
}

/**
 * Packed Products — every carton that has been boxed, one row each.
 *
 * A packed product LEAVES the table above and appears here, so the top table
 * is always the work still to do and this one is the work already done.
 *
 * The row is the CARTON, not the product. A product-first list has to say
 * "P-104, and its five boxes", which puts the same five cartons down one cell
 * and leaves nothing on the row to act on — while a mixed carton appears twice
 * with no way to tell it is one box. One row per box answers the question the
 * floor actually asks: what is in B-001?
 */
export default function PackedProducts({
  boxes, onEditBox, editingBoxId = null,
}: {
  boxes: PackedBox[];
  /** Open a saved carton. Unambiguous now: the row IS the carton. */
  onEditBox?: (boxId: string) => void;
  /** Which carton is open in the drawer above, so its row can say so. */
  editingBoxId?: string | null;
}) {
  /* Which carton's contents are being looked at. Null is closed — one piece of
     state rather than an open flag that could disagree with the row. */
  const [showing, setShowing] = useState<PackedBox | null>(null);

  if (boxes.length === 0) return null;

  /* Products, not rows: one product split across five cartons is one product
     packed, and the header would otherwise claim five. */
  const productCount = new Set(boxes.flatMap(b => b.items.map(i => i.line.code))).size;

  return (
    <div className="vti-box invf-packed">
      <div className="vti-header">
        <div className="vti-header-ico"><IcoCheck size={18} stroke={2.6} /></div>
        <div className="vti-header-text">
          <div className="vti-header-title">Packed Products</div>
          <div className="vti-header-sub">
            Boxed and labelled &nbsp;·&nbsp; {boxes.length} box{boxes.length === 1 ? '' : 'es'} holding {productCount} product{productCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="vti-header-stats">
          <div className="vti-stat-pill boxed">
            <div className="vti-stat-dot" /><IcoCheck size={11} stroke={2.8} />{productCount} Packed
          </div>
          <div className="vti-stat-pill total">
            <div className="vti-stat-dot" /><IcoBox size={11} stroke={2.2} />{boxes.length} Box{boxes.length === 1 ? '' : 'es'}
          </div>
        </div>
      </div>

      <div className="vti-table-wrap">
        <table className="vti-table invf-packed-table">
          <thead>
            <tr>
              <th>Sr No</th>
              <th>Box ID</th>
              <th>Product (SPI)</th>
              <th>Code</th>
              <th className="vti-desc-h">Description</th>
              <th>Qty in Box</th>
              <th>Missing Qty</th>
              <th>Extra Qty</th>
              <th>Box Packaging Scenario</th>
              <th>Products in Box</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b, i) => {
              const open = b.code === editingBoxId;
              const mixed = b.items.length > 1;
              return (
                <tr className={`vti-prod-row invf-grp-row${open ? ' is-open' : ''}`} key={b.code}>
                  <td><span className="invf-sr">{String(i + 1).padStart(2, '0')}</span></td>

                  {/* The id is the way in: pressing it opens this carton. */}
                  <td>
                    <span className="invf-boxids">
                      <Tooltip label={onEditBox
                        ? `Open ${b.code} — its size, weight, flags and the ${mixed ? 'products' : 'product'} inside it`
                        : `Carton ${b.code}`}>
                        {onEditBox ? (
                          <button
                            type="button"
                            className="vti-code invf-boxid-btn"
                            onClick={() => onEditBox(b.code)}
                            aria-label={`Open box ${b.code}`}
                          >
                            {b.code}
                          </button>
                        ) : (
                          <span className="vti-code">{b.code}</span>
                        )}
                      </Tooltip>
                    </span>
                  </td>

                  {/* The contents stack inside the row, because the row is the
                      box and what is in it is a list. */}
                  <td>
                    <Stack items={b.items} render={it => (
                      <div className="vti-prod-cell">
                        <div>
                          <div className="vti-prod-name">{it.line.spiName}</div>
                          <div className="vti-prod-sku">HSN {it.line.hsn}</div>
                        </div>
                      </div>
                    )} />
                  </td>
                  <td>
                    <Stack items={b.items} render={it => <span className="vti-code">{it.line.code}</span>} />
                  </td>
                  <td className="vti-desc">
                    <Stack items={b.items} render={it => (
                      <Tooltip label={it.line.description} disabled={it.line.description.length <= DESC_MAX}>
                        <span className="vti-desc__wrap">{truncateDesc(it.line.description)}</span>
                      </Tooltip>
                    )} />
                  </td>
                  {/* This carton's share, not the product's whole SPI quantity:
                      a split puts 48 of 96 in each box, and showing 96 on both
                      rows would double the invoice. */}
                  <td>
                    <Stack items={b.items} render={it => <span className="vti-qty-badge">{it.qty}</span>} />
                  </td>
                  <td>
                    <Stack items={b.items} render={it => {
                      const { missing } = lineTotals(it.line);
                      return <span className={`cpd-qtypill${missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{missing}</span>;
                    }} />
                  </td>
                  <td>
                    <Stack items={b.items} render={it => {
                      const { extra } = lineTotals(it.line);
                      return <span className={`cpd-qtypill${extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{extra}</span>;
                    }} />
                  </td>
                  <td><span className="invf-scn-tag">{b.scenario}</span></td>
                  <td><span className="vti-qty-badge">{b.items.length}</span></td>
                  <td>
                    <span className="vti-packed-acts">
                      <Tooltip label={`See what is inside ${b.code}`}>
                        <button
                          type="button"
                          className="vti-btn-single vti-btn-single--ico"
                          onClick={() => setShowing(b)}
                          aria-label={`View the contents of ${b.code}`}
                        >
                          <IcoEye size={14} />
                        </button>
                      </Tooltip>
                      {onEditBox && (
                        <Tooltip label={`Edit ${b.code} — its size, weight, flags${mixed ? ', and which products stay in it' : ''}`}>
                          <button
                            type="button"
                            className={`vti-btn-single vti-btn-single--ico vti-btn-single--edit${open ? ' is-on' : ''}`}
                            onClick={() => onEditBox(b.code)}
                            aria-label={`Edit ${b.code}`}
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

      {showing && <BoxContentsModal box={showing} onClose={() => setShowing(null)} />}
    </div>
  );
}

/** One cell's worth of a carton's contents: a value per product, divided. */
function Stack({ items, render }: { items: PackedItem[]; render: (it: PackedItem) => ReactNode }) {
  if (items.length === 1) return <>{render(items[0])}</>;
  return (
    <div className="invf-stack">
      {items.map(it => <div className="invf-stack__cell" key={it.line.code}>{render(it)}</div>)}
    </div>
  );
}

/**
 * What one carton holds.
 *
 * Portalled to document.body: inside the page it would sit within
 * `.vti-table-wrap`, whose `overflow-x: auto` clips any descendant.
 */
function BoxContentsModal({ box, onClose }: { box: PackedBox; onClose: () => void }) {
  useScrollLock(true);

  const units = box.items.reduce((n, i) => n + i.qty, 0);

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl spi-mdl--wide" role="dialog" aria-modal="true" aria-labelledby="invf-boxes-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoBox size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-boxes-title">{box.code}</div>
              <div className="spi-mdl-sub">
                {box.scenario} · {box.items.length} product{box.items.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="invf-boxlist">
            {box.items.map(it => (
              <div className="invf-boxchip" key={it.line.code}>
                <span className="invf-boxchip__id">{it.line.code}</span>
                <span className="invf-boxchip__qty">{it.qty} unit{it.qty === 1 ? '' : 's'}</span>
                <span className="invf-boxchip__mix">{it.line.spiName}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">
            <IcoCheck size={13} /> {units} unit{units === 1 ? '' : 's'} in this carton
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
