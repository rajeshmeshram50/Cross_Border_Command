// What the user has filled in so far. The form shell owns it so a later step
// can read earlier answers — each step opens with a recap of the ones before.
import { useState } from 'react';
import { PI_PRODUCTS } from './sample-products';
import { supplierByName, supplierOption, type Supplier } from './sample-suppliers';
import type { PoLineRow } from './steps/ProductTable';
import { EMPTY_CHARGES, type Charges } from './steps/ChargesSummary';

export type PoDraft = {
  // Step 01 · basic purchase order details
  poType: string;
  docType: string;
  transport: string;
  deliveryDate: string;
  deliveryLocation: string;
  paymentType: string;
  physInsp: boolean;
  // International only
  currency: string;
  exchangeRate: string;
  incoTerm: string;
  portLoading: string;
  portDischarge: string;
  finalDestination: string;
  countryOrigin: string;
  // Step 01 · supplier
  supplier: string;
  legalName: string;
  supType: string;
  risk: string;
  category: string;
  // Step 01 · address & contact
  address: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  contact: string;
  designation: string;
  phone: string;
  email: string;
  // Step 01 · GST scrutiny
  scrutinyDate: string;
  gstNo: string;
  gstStatus: string;
  filingDate: string;
  remarks: string;
  // Step 02 · product lines and the extra charges
  lines: PoLineRow[];
  charges: Charges;
  // Step 03 · terms
  terms: string;
};

// The prototype opens a fresh draft with these already chosen.
const EMPTY_DRAFT: PoDraft = {
  poType: 'Material / Goods',
  docType: 'Domestics',
  transport: 'Road',
  deliveryDate: '',
  deliveryLocation: '',
  paymentType: 'Advance',
  physInsp: false,
  currency: '',
  exchangeRate: '',
  incoTerm: '',
  portLoading: '',
  portDischarge: '',
  finalDestination: '',
  countryOrigin: '',
  supplier: '',
  legalName: '',
  supType: 'Manufacturer',
  risk: 'High Risk',
  category: 'Star Supplier',
  address: '',
  country: 'India',
  state: 'Maharashtra',
  stateCode: '',
  city: '',
  contact: '',
  designation: '',
  phone: '',
  email: '',
  scrutinyDate: '',
  gstNo: '',
  gstStatus: 'Active',
  filingDate: '',
  remarks: '',
  // The PO starts as a copy of the PI: same products, quantities and rates.
  lines: PI_PRODUCTS.map((pi) => ({ pi, poCode: pi.code, qtyPo: pi.qtyPi, rate: pi.rate })),
  charges: EMPTY_CHARGES,
  terms: '',
};

export type SetDraft = (patch: Partial<PoDraft>) => void;

/** Everything a supplier's master record fills in. Used both when a supplier
 *  is picked by hand and when an existing PO is opened, so the two can't drift. */
export function supplierFields(s: Supplier): Partial<PoDraft> {
  return {
    legalName: s.legalName,
    supType: s.type,
    risk: s.risk,
    category: s.category,
    address: s.addr,
    country: s.country,
    state: s.state,
    stateCode: s.stateCode,
    city: s.city,
    contact: s.contact,
    designation: s.desig,
    phone: s.phone,
    email: s.email,
    scrutinyDate: s.scrutiny,
    gstNo: s.gstNo,
    gstStatus: s.gstStatus,
    filingDate: s.filing,
    remarks: s.remarks,
  };
}

/** An existing PO opened for editing: what its list row already knows. */
export type PoEdit = {
  po: string;
  opportunity: string;
  procurement: string;
  supplier: string;
  poType: string;
  docType: string;
  deliveryDate: string;
  physInsp: boolean;
};

/* Step 01 as the saved PO left it. The supplier is matched to the master so
   every supplier field fills exactly as picking it by hand would; one that
   isn't in the master keeps just its name, as in the prototype. */
function draftFromEdit(e: PoEdit): PoDraft {
  const s = supplierByName(e.supplier);
  return {
    ...EMPTY_DRAFT,
    poType: e.poType,
    docType: e.docType,
    deliveryDate: e.deliveryDate,
    physInsp: e.physInsp,
    ...(s ? { supplier: supplierOption(s), ...supplierFields(s) } : { supplier: e.supplier, legalName: e.supplier }),
  };
}

export function usePoDraft(edit?: PoEdit): { draft: PoDraft; set: SetDraft } {
  // Lazy initialiser: the edit draft is built once, on open, not every render.
  const [draft, setDraft] = useState<PoDraft>(() => (edit ? draftFromEdit(edit) : EMPTY_DRAFT));
  const set: SetDraft = (patch) => setDraft((current) => ({ ...current, ...patch }));
  return { draft, set };
}
