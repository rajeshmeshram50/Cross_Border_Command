import type { RiskSubject } from '../../purchase-management/order/create-po/supplier-checks';
export { RISK_GUIDELINES, isRiskMandatory } from '../../purchase-management/order/create-po/supplier-checks';

export const LEGAL_PARAMS: { name: string }[] = [
  { name: 'Company Due Diligence' },
  { name: 'Owner KYC Documents' },
  { name: 'Trade Licenses' },
  { name: 'Trade Documents' },
  { name: 'Agreements' },
];

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
  addr: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  contact: string;
  desig: string;
  phone: string;
  email: string;
  scrutiny: string;
  gstNo: string;
  gstStatus: string;
  filing: string;
  remarks: string;
  legalDone: number[];
  legalTotal: number[];
};

const need = (s: Supplier, i: number) => s.legalTotal?.[i] ?? 0;
const have = (s: Supplier, i: number) => Math.min(s.legalDone[i] ?? 0, need(s, i));
const ratio = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 100);

export function legalSections(s: Supplier) {
  return LEGAL_SECTIONS.map((sec) => {
    const total = sec.params.reduce((sum, i) => sum + need(s, i), 0);
    const done = sec.params.reduce((sum, i) => sum + have(s, i), 0);
    const pct = ratio(done, total);
    return { ...sec, done, total, pct, tone: pct === 100 ? 'ok' : pct >= 60 ? 'warn' : 'bad' };
  });
}

export function legalTotals(s: Supplier) {
  const total = LEGAL_PARAMS.reduce((sum, _p, i) => sum + need(s, i), 0);
  const done = LEGAL_PARAMS.reduce((sum, _p, i) => sum + have(s, i), 0);
  return { done, total, pct: ratio(done, total) };
}

export const toRiskSubject = (s: Supplier, international = false): RiskSubject => ({
  risk: s.risk, category: s.category, gstStatus: s.gstStatus, gstNo: s.gstNo,
  filing: s.filing, scrutiny: s.scrutiny, legal: legalTotals(s), international,
});

