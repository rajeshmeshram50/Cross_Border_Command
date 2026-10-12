/**
 * Product Flags — the prototype's own twelve, verbatim.
 *
 * Static, like the warehouse rows: this screen is being designed before it
 * is wired. Replace what this module exports when an endpoint lands; the
 * page only ever reads PRODUCT_FLAGS.
 */
export interface ProductFlag {
  /** PF-001 … */
  id: string;
  /** Created on. ISO; the list does not show it, the form does. */
  date: string;
  name: string;
  /** What the flag means for handling and storage. */
  purpose: string;
  status: 'active' | 'inactive';
}

export const PRODUCT_FLAGS: ProductFlag[] = [
  {
    id: 'PF-001',
    date: '2025-04-08',
    name: 'Standard',
    purpose: 'Normal product with no special handling',
    status: 'active',
  },
  {
    id: 'PF-002',
    date: '2025-04-17',
    name: 'Fragile',
    purpose: 'Requires careful handling',
    status: 'active',
  },
  {
    id: 'PF-003',
    date: '2025-04-26',
    name: 'Hazardous',
    purpose: 'Dangerous or regulated material',
    status: 'active',
  },
  {
    id: 'PF-004',
    date: '2025-05-05',
    name: 'Cold Chain',
    purpose: 'Requires controlled cold temperature',
    status: 'active',
  },
  {
    id: 'PF-005',
    date: '2025-05-14',
    name: 'Temperature Sensitive',
    purpose: 'Requires a specified temperature range',
    status: 'active',
  },
  {
    id: 'PF-006',
    date: '2025-05-23',
    name: 'Humidity Sensitive',
    purpose: 'Requires humidity control',
    status: 'active',
  },
  {
    id: 'PF-007',
    date: '2025-06-01',
    name: 'Flammable',
    purpose: 'Fire-risk material requiring suitable storage',
    status: 'active',
  },
  {
    id: 'PF-008',
    date: '2025-06-10',
    name: 'Heavy Load',
    purpose: 'Requires suitable rack load capacity',
    status: 'active',
  },
  {
    id: 'PF-009',
    date: '2025-06-19',
    name: 'Oversized / Bulky',
    purpose: 'May require floor storage instead of a rack',
    status: 'active',
  },
  {
    id: 'PF-010',
    date: '2025-06-28',
    name: 'Non-Stackable',
    purpose: 'Cannot have other boxes stacked on top',
    status: 'active',
  },
  {
    id: 'PF-011',
    date: '2025-07-07',
    name: 'Perishable',
    purpose: 'Requires expiry and shelf-life controls',
    status: 'active',
  },
  {
    id: 'PF-012',
    date: '2025-07-16',
    name: 'Keep Upright',
    purpose: 'Must remain in a specified orientation',
    status: 'active',
  },
];
