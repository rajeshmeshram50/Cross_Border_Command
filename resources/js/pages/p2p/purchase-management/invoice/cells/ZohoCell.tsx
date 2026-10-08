import { memo } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { ZohoStatusPill } from './Pills';
import type { InvoiceAction } from './RowActions';
import type { InvoiceRow } from '../types';

const SyncIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
    <polyline points="21 3 18.7 6 15.6 5.4" /><polyline points="3 21 5.3 18 8.4 18.6" />
  </svg>
);

/**
 * Zohobook status, and the control that changes it.
 *
 * The Sync button sits in this column rather than with the row's other actions,
 * because syncing is not a thing you do to an invoice alongside editing it — it
 * IS this status changing. Putting the control directly under the pill it acts
 * on means the cause and the effect are the same cell.
 *
 * It appears only when the invoice is out of sync: a button that does nothing
 * for two thirds of the rows is noise, and "sync an already-synced invoice" is
 * not an action a user needs offered.
 */
function ZohoCellBase({
  row, onAction,
}: {
  row: InvoiceRow;
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
}) {
  return (
    <div className="ord-statcell">
      <ZohoStatusPill status={row.zohoStatus} />
      {row.zohoStatus === 'not-synced' && (
        <Tooltip label={`Post ${row.invoiceNo} to Zohobook`}>
          <button type="button" className="ord-btn ord-btn--zoho"
            onClick={() => onAction('zoho-sync', row)}>
            <SyncIcon /><span>Zoho Sync</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export const ZohoCell = memo(ZohoCellBase);
