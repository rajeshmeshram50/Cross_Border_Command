import { memo } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';

/**
 * A reference cell: the id as a mono chip, its date underneath.
 *
 * Classes are the Order module's — `.ord-idcell`, `.ord-idpill`,
 * `.ord-idcell__date`, `.ord-dash`. The PO list renders the same chip for the
 * same kind of value, so there is nothing here to define.
 *
 * Used by six columns (invoice, PO, shipment, opportunity, procurement, and the
 * chain ids), which is why it is a component: six copies of the same two spans
 * would be six places to change when the chip design moves.
 *
 * `memo` because it is rendered six times per row across 60 rows. Its props are
 * two strings, so React's shallow comparison is exactly right: the cell
 * re-renders only when its own id or date changes.
 */
function IdCellBase({ id, date }: { id?: string; date?: string }) {
  /* An absent reference is a dash, not an empty cell. A blank box reads as
     "something failed to load"; a dash reads as "there is none", which is what
     a direct invoice with no PO actually means. */
  if (!id) return <span className="ord-dash">—</span>;

  return (
    <div className="ord-idcell">
      <span className="ord-idpill">{id}</span>
      <span className="ord-idcell__date">{formatDmy(date)}</span>
    </div>
  );
}

export const IdCell = memo(IdCellBase);
