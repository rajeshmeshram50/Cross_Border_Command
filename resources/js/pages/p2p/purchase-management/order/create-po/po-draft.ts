/* ─────────────────────────────────────────────────────────────────────────
 * What the user has filled in so far.
 *
 * The form shell owns it, so a later step can read what an earlier one
 * answered — Step 02 opens with a read-only summary of Step 01.
 * ───────────────────────────────────────────────────────────────────────── */
import { useState } from 'react';

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
};

export type SetDraft = (patch: Partial<PoDraft>) => void;

export function usePoDraft(): { draft: PoDraft; set: SetDraft } {
  const [draft, setDraft] = useState<PoDraft>(EMPTY_DRAFT);
  const set: SetDraft = (patch) => setDraft((current) => ({ ...current, ...patch }));
  return { draft, set };
}
