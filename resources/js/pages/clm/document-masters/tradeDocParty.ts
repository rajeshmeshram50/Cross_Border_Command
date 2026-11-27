/* Applicable Party for CLM trade documents: the stored values and their labels, shared by the
   Draft New Trade Document form and the Trade Documents list.

   The Supplier side follows the Supplier Type list of the Supplier Management Add Supplier form
   (Material / Goods, FFD / Transporter, Soft Service Provider, and the two service groups).

   Stored values are kept SHORT on purpose: the party is a CSV in a varchar(255) column (and the
   API validates max:255). Every supplier type plus Customer and Consignee selected stays at about
   230 characters; the full "Supplier-Professional Services" style names would pass 300 and fail.
   The backend only checks that a token starts with "Supplier", so any Supplier-* value works. */

export type PartyOpt = { value: string; label: string; icon: string };

export const PARTY_BUYER_CONSIGNEE: PartyOpt[] = [
  { value: 'Buyer',     label: 'Customer',  icon: '👤' },
  { value: 'Consignee', label: 'Consignee', icon: '🚚' },
];

/** Supplier types, grouped as in the Supplier Type dropdown (a null group = top-level types). */
export const PARTY_SUPPLIER_GROUPS: { group: string | null; items: PartyOpt[] }[] = [
  {
    group: null,
    items: [
      { value: 'Supplier-Material / Goods',  label: 'Material / Goods',      icon: '📦' },
      { value: 'Supplier-FFD / Transporter', label: 'FFD / Transporter',     icon: '🚛' },
      { value: 'Supplier-Soft Service',      label: 'Soft Service Provider', icon: '🧩' },
    ],
  },
  {
    group: 'Self Consumable Service Provider',
    items: [
      { value: 'Supplier-Trackable',  label: 'Trackable Services',  icon: '📍' },
      { value: 'Supplier-Consumable', label: 'Consumable Services', icon: '🧴' },
    ],
  },
  {
    group: 'Other Operational Service Provider',
    items: [
      { value: 'Supplier-Professional', label: 'Professional Services', icon: '💼' },
      { value: 'Supplier-Utility',      label: 'Utility Services',      icon: '⚡' },
      { value: 'Supplier-Facility',     label: 'Facility Services',     icon: '🏢' },
      { value: 'Supplier-Maintenance',  label: 'Maintenance Services',  icon: '🔧' },
      { value: 'Supplier-Outsourcing',  label: 'Outsourcing Services',  icon: '🤝' },
    ],
  },
];

export const PARTY_SUPPLIER: PartyOpt[] = PARTY_SUPPLIER_GROUPS.flatMap(g => g.items);

/** Every service type: what the old single "Services" choice covered. */
const ALL_SERVICES = PARTY_SUPPLIER.filter(p => p.value !== 'Supplier-Material / Goods' && p.value !== 'Supplier-FFD / Transporter').map(p => p.value);

/* Older stored supplier values → today's values, so a saved document still shows its supplier
   choice when it is opened for edit. The old "Services" (and the even older Tech / Advisory /
   Strategic Risk) meant every kind of service, so it opens with every service type ticked. */
const LEGACY_SUPPLIER: Record<string, string[]> = {
  'Supplier':                ['Supplier-Material / Goods'],
  'Supplier-Material':       ['Supplier-Material / Goods'],
  'Supplier-Logistic':       ['Supplier-FFD / Transporter'],
  'Supplier-Services':       ALL_SERVICES,
  'Supplier-Tech':           ALL_SERVICES,
  'Supplier-Advisory':       ALL_SERVICES,
  'Supplier-Strategic Risk': ALL_SERVICES,
};

/** One stored party token → the value(s) the form ticks for it. */
export const expandParty = (v: string): string[] => LEGACY_SUPPLIER[v] ?? [v];

/** Stored value → the label the list shows (old values keep their old names). */
export const PARTY_LABELS: Record<string, string> = {
  ...Object.fromEntries([...PARTY_BUYER_CONSIGNEE, ...PARTY_SUPPLIER].map(p => [p.value, p.label])),
  'Supplier-Material': 'Material',
  'Supplier-Logistic': 'Logistic',
  'Supplier-Services': 'Services',
  'Supplier-Tech': 'Tech',
  'Supplier-Advisory': 'Advisory',
  'Supplier-Strategic Risk': 'Strategic Risk',
};
