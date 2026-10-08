import type { ReactNode } from 'react';

/**
 * The five cards in the "What We Are Doing Here" panel.
 *
 * Data, not markup — the panel maps over this array. Written out as five copies
 * of the same JSX it would be 60 lines of near-identical blocks, and changing
 * the card design would mean editing five of them.
 *
 * It lives OUTSIDE the component, at module scope. Declared inside, the array
 * and all five SVG elements would be rebuilt on every render of the page —
 * including every keystroke in the search box once that exists — for content
 * that never changes.
 */
export interface InvoiceStep {
  no: string;
  title: string;
  desc: string;
  icon: ReactNode;
}

const ico = (d: ReactNode) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

export const INVOICE_STEPS: InvoiceStep[] = [
  {
    no: '01',
    title: 'PO Link Supplier Details',
    desc: 'Link the purchase order and confirm supplier details.',
    icon: ico(
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
  },
  {
    no: '02',
    title: 'Supplier Purchase Invoice Details',
    desc: 'Enter the invoice number, date, and details.',
    icon: ico(
      <>
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
        <line x1="8" y1="9" x2="16" y2="9" />
        <line x1="8" y1="13" x2="16" y2="13" />
      </>
    ),
  },
  {
    no: '03',
    title: 'Product Details (3-Way Match)',
    desc: 'Match products against the PO and GRN.',
    icon: ico(
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </>
    ),
  },
  {
    no: '04',
    title: 'Payment Processing',
    desc: 'Record advance and release the remaining payment.',
    icon: ico(
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </>
    ),
  },
  {
    no: '05',
    title: 'Sync with Zohobook',
    desc: 'Post the approved invoice and payment to Zohobook.',
    icon: ico(
      <>
        <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
        <polyline points="21 3 18.7 6 15.6 5.4" />
        <polyline points="3 21 5.3 18 8.4 18.6" />
      </>
    ),
  },
];
