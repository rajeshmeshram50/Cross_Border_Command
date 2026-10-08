import { memo } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import type { InvoiceRow } from '../types';

/**
 * What a row can be asked to do.
 *
 * A union rather than three separate callbacks: the table threads ONE handler
 * down instead of three, and adding a fourth action later does not change a
 * single component signature between here and the page.
 */
export type InvoiceAction = 'edit' | 'summary' | 'vault' | 'zoho-sync' | 'payment-requests';

const EditIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

const VaultIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
  </svg>
);

/**
 * The three document actions on a row.
 *
 * Deliberately NOT four: raising a payment request and reviewing the ones
 * already raised are the same story from either end, and both open from
 * "Manage Payment Requests" under Payment Progress. What is left here is
 * document work on the invoice itself.
 */
function RowActionsBase({
  row, onAction,
}: {
  row: InvoiceRow;
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
}) {
  return (
    /* The shared <Tooltip>, not the native `title` attribute. The Order module
       — the in-repo standard for a P2P row-action button — uses it, and it is
       the product's dark pill rather than the browser's grey OS box after a
       second's delay. It also portals to document.body, so it is never clipped
       by the table's overflow-x. */
    <span className="ord-actions">
      <Tooltip label={`Edit ${row.invoiceNo}`}>
        <button type="button" className="ord-btn ord-btn--edit" onClick={() => onAction('edit', row)}>
          <EditIcon /><span>Edit SPI</span>
        </button>
      </Tooltip>

      <Tooltip label={`Summary for ${row.invoiceNo}`}>
        <button type="button" className="ord-btn ord-btn--vault" onClick={() => onAction('summary', row)}>
          <EyeIcon /><span>SPI Summary</span>
        </button>
      </Tooltip>

      <Tooltip label="Evidence Vault — order, invoice, trade documents and payment proofs">
        <button type="button" className="ord-btn ord-btn--vault" onClick={() => onAction('vault', row)}>
          <VaultIcon /><span>Evidence Vault</span>
        </button>
      </Tooltip>
    </span>
  );
}

export const RowActions = memo(RowActionsBase);
