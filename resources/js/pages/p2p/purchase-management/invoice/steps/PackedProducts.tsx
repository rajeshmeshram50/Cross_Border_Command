import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../../components/ui/Tooltip';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoBox, IcoCheck, IcoEye, IcoPencil, IcoX } from '../../../icons';
import { lineTotals, truncateDesc, DESC_MAX, type ProductLine } from '../invoice-products';

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

/** The products that share one set of cartons, shown as a single row. */
interface PackedGroup {
  key: string;
  boxIds: string[];
  scenario: string;
  rows: PackedRow[];
}

/**
 * Products that went into the same cartons, collapsed into one row.
 *
 * The grouping key is the set of box ids, not the product: two products in
 * B-001 share one key and become one row, while a product split across five
 * cartons keeps its own. That is what makes the table read as a list of boxes
 * -- which is what it is, since every action on it acts on a carton.
 */
function groupByBoxes(rows: PackedRow[]): PackedGroup[] {
  const out: PackedGroup[] = [];
  const byKey = new Map<string, PackedGroup>();
  for (const row of rows) {
    const boxIds = row.boxes.map(b => b.id);
    const key = [...boxIds].sort().join('|') || row.line.code;
    const hit = byKey.get(key);
    if (hit) { hit.rows.push(row); continue; }
    const group: PackedGroup = { key, boxIds, scenario: row.scenario, rows: [row] };
    byKey.set(key, group);
    out.push(group);
  }
  return out;
}

/**
 * Packed Products — everything that has been boxed.
 *
 * A packed row LEAVES the table above and appears here, so the top table is
 * always the work still to do and this one is the work already done. The two
 * never show the same product at once.
 *
 * One row is one carton. The box id leads it and the products inside stack
 * within the row, because every action here is box-level: a mixed carton
 * cannot be opened for one of its products, and two separate rows saying
 * "1 box" each hid the fact that it was the same box.
 */
export default function PackedProducts({
  rows, onEditBox, editingBoxId = null,
}: {
  rows: PackedRow[];
  /**
   * Open a saved carton, by its box code.
   *
   * Box code rather than product code because the edit IS box-level: one
   * carton can hold two products, and "edit P-005" has no single answer when
   * P-005 is in B-001 with P-032.
   */
  onEditBox?: (boxId: string) => void;
  /**
   * Which carton is open for editing.
   *
   * The drawer itself opens above, in the slot a box is built in, so all this
   * row has to do is show which carton the drawer belongs to.
   */
  editingBoxId?: string | null;
}) {
  /* Which group's boxes are being looked at. Null is closed — one piece of
     state rather than an open flag that could disagree with the row. */
  const [showing, setShowing] = useState<PackedGroup | null>(null);

  if (rows.length === 0) return null;

  const groups = groupByBoxes(rows);
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
        <table className="vti-table invf-packed-table">
          <thead>
            {/* Box ID leads the row because the box is what the row is about:
                the edit opens a carton, not a product. */}
            <tr>
              <th>Sr No</th>
              <th>Box ID</th>
              <th>Product (SPI)</th>
              <th>Code</th>
              <th className="vti-desc-h">Description</th>
              <th>Qty (SPI)</th>
              <th>Missing Qty</th>
              <th>Extra Qty</th>
              <th>Box Packaging Scenario</th>
              <th>Generated Boxes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, i) => {
              const open = !!editingBoxId && group.boxIds.includes(editingBoxId);
              /* A carton holding more than one product. The sharers are
                 already on the row beside them, so the tag only has to say
                 that the row is a carton rather than a product. */
              const mixed = group.rows.length > 1;
              return (
                  <tr className={`vti-prod-row invf-grp-row${open ? ' is-open' : ''}`} key={group.key}>
                    {/* Counts cartons, not products: a mixed carton is one
                        line on this list however many things are inside it. */}
                    <td><span className="invf-sr">{String(i + 1).padStart(2, '0')}</span></td>
                    <td>
                      <span className="invf-boxids">
                        {group.boxIds.slice(0, 2).map(id => (
                          <Tooltip key={id} label={onEditBox
                            ? `Open ${id} — its size, weight, flags and the ${mixed ? 'products' : 'product'} inside it`
                            : `Carton ${id}`}>
                            {onEditBox ? (
                              <button
                                type="button"
                                className="vti-code invf-boxid-btn"
                                onClick={() => onEditBox(id)}
                                aria-label={`Open box ${id}`}
                              >
                                {id}
                              </button>
                            ) : (
                              <span className="vti-code">{id}</span>
                            )}
                          </Tooltip>
                        ))}
                        {group.boxIds.length > 2 && (
                          <Tooltip label={`${group.boxIds.length} boxes in all: ${group.boxIds.join(', ')} — press the eye to pick one`}>
                            <span className="vti-code invf-boxid--more">+{group.boxIds.length - 2}</span>
                          </Tooltip>
                        )}
                        {/* No "shared" tag: the row itself shows both products
                            against the one id, which says it already. */}
                      </span>
                    </td>

                    {/* The product columns stack instead of repeating the
                        carton on a second row: the box is the row, and what
                        is inside it is a list. */}
                    <td>
                      <Stack rows={group.rows} render={r => (
                        <div className="vti-prod-cell">
                          <div>
                            <div className="vti-prod-name">{r.line.spiName}</div>
                            <div className="vti-prod-sku">HSN {r.line.hsn}</div>
                          </div>
                        </div>
                      )} />
                    </td>
                    <td>
                      <Stack rows={group.rows} render={r => <span className="vti-code">{r.line.code}</span>} />
                    </td>
                    <td className="vti-desc">
                      <Stack rows={group.rows} render={r => (
                        <Tooltip label={r.line.description} disabled={r.line.description.length <= DESC_MAX}>
                          <span className="vti-desc__wrap">{truncateDesc(r.line.description)}</span>
                        </Tooltip>
                      )} />
                    </td>
                    <td>
                      <Stack rows={group.rows} render={r => <span className="vti-qty-badge">{r.line.spiQty}</span>} />
                    </td>
                    <td>
                      <Stack rows={group.rows} render={r => {
                        const { missing } = lineTotals(r.line);
                        return <span className={`cpd-qtypill${missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{missing}</span>;
                      }} />
                    </td>
                    <td>
                      <Stack rows={group.rows} render={r => {
                        const { extra } = lineTotals(r.line);
                        return <span className={`cpd-qtypill${extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{extra}</span>;
                      }} />
                    </td>
                    {/* The shape alone — "1 Product → Multiple Boxes" already
                        says which scenario it is, so the number was a label on
                        a label. */}
                    <td><span className="invf-scn-tag">{group.scenario}</span></td>
                    <td><span className="vti-qty-badge">{group.boxIds.length}</span></td>
                    <td>
                      <span className="vti-packed-acts">
                        {/* The box list is behind a popup rather than inline: a
                            split can produce a hundred cartons, and a cell cannot
                            hold them without setting the row's height. */}
                        <Tooltip label={`View the ${group.boxIds.length} box${group.boxIds.length === 1 ? '' : 'es'} in this row`}>
                          <button
                            type="button"
                            className="vti-btn-single vti-btn-single--ico"
                            onClick={() => setShowing(group)}
                            aria-label="View boxes"
                          >
                            <IcoEye size={14} />
                          </button>
                        </Tooltip>
                        {/* Opens the carton in place, under this row, the same
                            way packing one opens above. With several cartons
                            there is a choice to make, so the list asks. */}
                        {onEditBox && group.boxIds.length > 0 && (
                          <Tooltip label={group.boxIds.length === 1
                            ? `Edit ${group.boxIds[0]} — its size, weight, flags${mixed ? ', and which products stay in it' : ''}`
                            : `Edit one of these ${group.boxIds.length} boxes — pick which`}>
                            <button
                              type="button"
                              className={`vti-btn-single vti-btn-single--ico vti-btn-single--edit${open ? ' is-on' : ''}`}
                              onClick={() => (group.boxIds.length === 1 ? onEditBox(group.boxIds[0]) : setShowing(group))}
                              aria-label="Edit this box"
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

      {showing && (
        <BoxListModal
          group={showing}
          onEditBox={onEditBox && (id => { setShowing(null); onEditBox(id); })}
          onClose={() => setShowing(null)}
        />
      )}
    </div>
  );
}

/** One cell's worth of a grouped row: a value per product, divided. */
function Stack({ rows, render }: { rows: PackedRow[]; render: (row: PackedRow) => ReactNode }) {
  if (rows.length === 1) return <>{render(rows[0])}</>;
  return (
    <div className="invf-stack">
      {rows.map(r => <div className="invf-stack__cell" key={r.line.code}>{render(r)}</div>)}
    </div>
  );
}

/**
 * Every box in a grouped row.
 *
 * Portalled to document.body: inside the page it would sit within
 * `.vti-table-wrap`, whose `overflow-x: auto` clips any descendant.
 */
function BoxListModal({ group, onEditBox, onClose }: {
  group: PackedGroup;
  /** Pick one carton to edit. This is the only route in when a split made many. */
  onEditBox?: (boxId: string) => void;
  onClose: () => void;
}) {
  useScrollLock(true);

  /* Every box in the group, with what each holds. A split gives one product
     per box; a mixed carton gives several in one. */
  const boxes = group.boxIds.map(id => ({
    id,
    contents: group.rows
      .map(r => ({ code: r.line.code, qty: r.boxes.find(b => b.id === id)?.qty ?? 0 }))
      .filter(c => c.qty > 0 || group.rows.length === 1),
  }));
  const packed = boxes.reduce((n, b) => n + b.contents.reduce((m, c) => m + c.qty, 0), 0);
  const total = group.rows.reduce((n, r) => n + r.line.spiQty, 0);

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl spi-mdl--wide" role="dialog" aria-modal="true" aria-labelledby="invf-boxes-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoBox size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-boxes-title">Generated Boxes</div>
              <div className="spi-mdl-sub">
                {group.rows.map(r => r.line.spiName).join(', ')} · {group.scenario} · {group.boxIds.length} box{group.boxIds.length === 1 ? '' : 'es'}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="invf-boxlist">
            {boxes.map(b => {
              const qty = b.contents.reduce((n, c) => n + c.qty, 0);
              return (
                <div className="invf-boxchip" key={b.id}>
                  <span className="invf-boxchip__id">{b.id}</span>
                  {/* An empty carton is stated rather than shown as "0 units",
                      because it is a different thing from a box with nothing
                      counted in it yet. */}
                  <span className={`invf-boxchip__qty${qty === 0 ? ' is-empty' : ''}`}>
                    {qty === 0 ? 'Empty' : `${qty} unit${qty === 1 ? '' : 's'}`}
                  </span>
                  {b.contents.length > 1 && (
                    <span className="invf-boxchip__mix">
                      {b.contents.map(c => `${c.code} ×${c.qty}`).join(' · ')}
                    </span>
                  )}
                  {/* On the card rather than in a column of its own: with a
                      hundred cartons, the edit has to be where the carton is. */}
                  {onEditBox && (
                    <button
                      type="button"
                      className="invf-boxchip__edit"
                      onClick={() => onEditBox(b.id)}
                      aria-label={`Edit ${b.id}`}
                    >
                      <IcoPencil size={11} /> Edit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">
            <IcoCheck size={13} /> {packed} of {total} units packed
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
