import type { PickRow } from './DirectSpiPicker';
import type { SupplierRow } from './DirectSpiSupplierPicker';

/**
 * Static fixtures for the Direct SPI setup, matching the prototype's own rows.
 *
 * Design-only: there is no endpoint behind either list yet, and inventing one
 * would put a server contract in place before the screen it serves has been
 * agreed. Both are shaped like the pickers will consume them, so swapping a
 * fetch in later touches the source and nothing else.
 */

export const SHIPMENTS: PickRow[] = [
  { code: 'SHP-001', title: 'Reliance Retail Ltd',  sub: 'Basmati & Pulses · 12/04/2026' },
  { code: 'SHP-002', title: 'Adani Wilmar Ltd',     sub: 'Edible Oils · 18/04/2026' },
  { code: 'SHP-003', title: 'ITC Foods Division',   sub: 'Millets · 25/04/2026' },
  { code: 'SHP-004', title: 'BigBasket Retail',     sub: 'Mixed Agri · 02/05/2026' },
  { code: 'SHP-005', title: 'Patanjali Foods Ltd',  sub: 'Rice Bulk · 09/05/2026' },
];

const PEOPLE = [
  'Priya Sharma', 'Rohan Verma', 'Sneha Kulkarni', 'Vikram Singh', 'Ananya Iyer',
  'Karan Malhotra', 'Divya Nair', 'Arjun Mehta', 'Parth Lakare', 'Meera Joshi',
];
const TYPES = [
  { text: 'Material / Goods', tone: 'goods' as const },
  { text: 'FFD / Transporter', tone: 'ffd' as const },
  { text: 'Service', tone: 'service' as const },
];

/* 57, the count the prototype shows — enough that the search in the popover is
   doing real work rather than decorating a list you could read at a glance. */
export const PROCUREMENTS: PickRow[] = Array.from({ length: 57 }, (_, i) => {
  const n = i + 1;
  const owner = PEOPLE[i % PEOPLE.length];
  const raiser = PEOPLE[(i + 7) % PEOPLE.length];
  const day = String((i % 27) + 1).padStart(2, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  const pct = [100, 42, 100, 64, 100, 76, 88, 31, 100, 55][i % 10];
  return {
    code: `PC-${String(n).padStart(3, '0')}`,
    title: `Assigned to ${owner}`,
    sub: `Raised by ${raiser} · ${day}/${month}/2025 · ${pct}% complete`,
    tag: TYPES[i % TYPES.length],
  };
});

/** The id an auto-created case would take — one past the highest in the list. */
export const NEXT_PROCUREMENT = `PC-${String(PROCUREMENTS.length + 1).padStart(3, '0')}`;

/* The supplier rows the design lists, each with the four facts step 03 shows:
   code, segment, location and risk. */
export const SUPPLIERS: SupplierRow[] = [
  { code: 'S-001', name: 'Reliance Industries Ltd', kind: 'manufacturer', segment: 'Raw Material', location: 'Mumbai, Maharashtra',  risk: 'Low Risk' },
  { code: 'S-002', name: 'Tata Steel Ltd',          kind: 'manufacturer', segment: 'Raw Material', location: 'Mumbai, Maharashtra',  risk: 'Medium Risk' },
  { code: 'S-003', name: 'Adani Enterprises Ltd',   kind: 'trader',       segment: ['Trading', 'Logistics', 'Commodities'], location: 'Ahmedabad, Gujarat', risk: 'High Risk' },
  { code: 'S-004', name: 'Mahindra Logistics Ltd',  kind: 'service',      segment: 'Logistics',    location: 'Pune, Maharashtra',    risk: 'Low Risk' },
  { code: 'S-005', name: 'Godrej Agrovet Ltd',      kind: 'manufacturer', segment: ['Agri Inputs', 'Raw Material'], location: 'Nashik, Maharashtra', risk: 'Low Risk' },
  { code: 'S-006', name: 'Shakti Traders',          kind: 'trader',       segment: 'Commodities',  location: 'Indore, Madhya Pradesh', risk: 'Medium Risk' },
];
