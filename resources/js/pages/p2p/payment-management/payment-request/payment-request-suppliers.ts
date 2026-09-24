// The supplier's legal-status checklist for the Payment Request view. The labels and
// how they roll up live here; every count comes from the supplier's own vault.
import type { RiskSubject } from '../../purchase-management/order/create-po/supplier-checks';
export { RISK_GUIDELINES, isRiskMandatory } from '../../purchase-management/order/create-po/supplier-checks';

/* The five checklists the supplier vault keeps, in the order of VAULT_KEYS. Only the
   labels live here — which documents each one needs comes from the vault itself, so
   the counts follow the DCP rules for that supplier rather than a list written here. */
export const LEGAL_PARAMS: { name: string }[] = [
  { name: 'Company Due Diligence' },
  { name: 'Owner KYC Documents' },
  { name: 'Trade Licenses' },
  { name: 'Trade Documents' },
  { name: 'Agreements' },
];

// Those five roll up into the two sections shown on the PO form.
export const LEGAL_SECTIONS: { name: string; sub: string; params: number[] }[] = [
  { name: 'Standard Documents', sub: 'One Time · KYC, DD & Licenses', params: [0, 1, 2] },
  { name: 'Case to Case Documents & Agreements', sub: 'Per Deal · Trade Docs & Agreements', params: [3, 4] },
];

export type Supplier = {
  key: string;
  code: string;
  legalName: string;
  type: string;
  risk: 'Low Risk' | 'Medium Risk' | 'High Risk';
  category: string;
  segment: string;
  // Address & contact
  addr: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  contact: string;
  desig: string;
  phone: string;
  email: string;
  // GST scrutiny
  scrutiny: string;
  gstNo: string;
  gstStatus: string;
  filing: string;
  remarks: string;
  // Documents completed and required for each LEGAL_PARAMS entry, in the same order.
  // Both come from the supplier's vault — nothing here is assumed.
  legalDone: number[];
  legalTotal: number[];
};

const need = (s: Supplier, i: number) => s.legalTotal?.[i] ?? 0;
const have = (s: Supplier, i: number) => Math.min(s.legalDone[i] ?? 0, need(s, i));
// Nothing required is nothing outstanding, so an empty checklist reads as complete.
const ratio = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 100);

export function legalSections(s: Supplier) {
  return LEGAL_SECTIONS.map((sec) => {
    const total = sec.params.reduce((sum, i) => sum + need(s, i), 0);
    const done = sec.params.reduce((sum, i) => sum + have(s, i), 0);
    const pct = ratio(done, total);
    return { ...sec, done, total, pct, tone: pct === 100 ? 'ok' : pct >= 60 ? 'warn' : 'bad' };
  });
}

/** Overall documents completed across all five checklists. */
export function legalTotals(s: Supplier) {
  const total = LEGAL_PARAMS.reduce((sum, _p, i) => sum + need(s, i), 0);
  const done = LEGAL_PARAMS.reduce((sum, _p, i) => sum + have(s, i), 0);
  return { done, total, pct: ratio(done, total) };
}

/** What the shared risk checks read from a supplier. */
export const toRiskSubject = (s: Supplier): RiskSubject => ({
  risk: s.risk, category: s.category, gstStatus: s.gstStatus, gstNo: s.gstNo,
  filing: s.filing, scrutiny: s.scrutiny, legal: legalTotals(s),
});

