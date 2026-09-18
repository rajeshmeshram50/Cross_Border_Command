// Static supplier records for the Create PO form.
// Frontend-only sample data — replaced by the suppliers API later.
// The five compliance checklists every supplier is measured against.
// Each parameter's document list is what makes up its "total".
export const LEGAL_PARAMS: { name: string; docs: string[] }[] = [
  { name: 'Company Due Diligence', docs: ['Certificate of Incorporation', 'MOA & AOA', 'GST Registration Certificate', 'PAN Card'] },
  { name: 'Owner KYC Documents', docs: ['Director / Owner PAN', 'Aadhaar / ID Proof', 'Address Proof', 'Passport-size Photograph'] },
  { name: 'Trade Licenses', docs: ['Import-Export Code (IEC)', 'Factory / Trade License', 'Udyam (MSME) Certificate'] },
  { name: 'Trade Documents', docs: ['Product Catalogue', 'ISO / Quality Certificate', 'Test Report / COA', 'Cancelled Cheque / Bank Proof'] },
  { name: 'Agreements', docs: ['Non-Disclosure Agreement', 'Supply Agreement (MSA)', 'Rate / Price Contract'] },
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
  // Documents completed for each LEGAL_PARAMS entry, in the same order.
  legalDone: number[];
};

export const SUPPLIERS: Supplier[] = [
  {
    key: 'Reliance Industries Ltd', code: 'S-001', legalName: 'Reliance Industries Limited', type: 'Manufacturer',
    risk: 'Low Risk', category: 'Star Supplier', segment: 'Raw Material',
    addr: 'Maker Chambers IV, 222 Nariman Point, Mumbai 400021', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Anil Mehta', desig: 'Procurement Head', phone: '+91 98200 11223', email: 'anil.mehta@ril.com',
    scrutiny: '2026-08-14', gstNo: '27AAACR5055K1Z5', gstStatus: 'Active', filing: '2026-08-20',
    remarks: 'Scrutiny completed 14 Aug 2026. GSTR-3B filed 20 Aug 2026 — all current.',
    legalDone: [4, 4, 3, 4, 3],
  },
  {
    key: 'Tata Steel Ltd', code: 'S-002', legalName: 'Tata Steel Limited', type: 'Manufacturer',
    risk: 'Medium Risk', category: 'Regular Supplier', segment: 'Raw Material',
    addr: 'Bombay House, 24 Homi Mody Street, Fort, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Rakesh Sharma', desig: 'Sr. Manager - Sales', phone: '+91 98330 44556', email: 'rakesh.sharma@tatasteel.com',
    scrutiny: '2026-07-05', gstNo: '27AAACT2727Q1ZW', gstStatus: 'Active', filing: '2026-04-18',
    remarks: 'Scrutiny current, but no GST return filed since 18 Apr 2026 — filing overdue.',
    legalDone: [4, 4, 3, 4, 3],
  },
  {
    key: 'Adani Enterprises Ltd', code: 'S-003', legalName: 'Adani Enterprises Limited', type: 'Trader',
    risk: 'High Risk', category: 'High Risk Supplier', segment: 'Trading',
    addr: 'Adani Corporate House, Shantigram, Ahmedabad 382421', country: 'India', state: 'Gujarat', stateCode: '24', city: 'Ahmedabad',
    contact: 'Priya Desai', desig: 'Key Account Manager', phone: '+91 99250 77889', email: 'priya.desai@adani.com',
    scrutiny: '2026-02-11', gstNo: '24AABCA1234R1Z8', gstStatus: 'Active', filing: '2026-08-02',
    remarks: 'Filings are current, but GST scrutiny has not been refreshed since 11 Feb 2026.',
    legalDone: [4, 4, 3, 2, 3],
  },
  {
    key: 'Mahindra Logistics Ltd', code: 'S-004', legalName: 'Mahindra Logistics Limited', type: 'Service Provider',
    risk: 'Medium Risk', category: 'Regular Supplier', segment: 'Transport',
    addr: 'Mahindra Towers, Worli, Mumbai 400018', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Vikram Nair', desig: 'Operations Lead', phone: '+91 98191 22334', email: 'vikram.nair@mahindra.com',
    scrutiny: '2026-05-29', gstNo: '27AAFCM5678P1ZK', gstStatus: 'Active', filing: '2026-07-11',
    remarks: 'Scrutiny lapsed by a few days — last reviewed 29 May 2026.',
    legalDone: [4, 4, 3, 4, 3],
  },
  {
    key: 'Larsen & Toubro Ltd', code: 'S-005', legalName: 'Larsen & Toubro Limited', type: 'Manufacturer',
    risk: 'Low Risk', category: 'Star Supplier', segment: 'Capital Equipment',
    addr: 'L&T House, Ballard Estate, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Sunil Kulkarni', desig: 'Procurement Manager', phone: '+91 98202 55667', email: 'sunil.kulkarni@lnt.com',
    scrutiny: '2026-08-01', gstNo: '27AAACL0140P1ZL', gstStatus: 'Active', filing: '2026-06-02',
    remarks: 'Scrutiny current. Last filing 02 Jun 2026 — just outside the 3-month window.',
    legalDone: [4, 3, 1, 4, 2],
  },
];

// Options read "S-001 — Reliance Industries Ltd" so the picker shows the code too.
export const SUPPLIER_OPTIONS = SUPPLIERS.map((s) => `${s.code} — ${s.key}`);

export const supplierByOption = (option: string) => SUPPLIERS.find((s) => `${s.code} — ${s.key}` === option);

/** Per-section completion, used by the Supplier Legal Status panel. */
export function legalSections(s: Supplier) {
  return LEGAL_SECTIONS.map((sec) => {
    const total = sec.params.reduce((sum, i) => sum + LEGAL_PARAMS[i].docs.length, 0);
    const done = sec.params.reduce((sum, i) => sum + Math.min(s.legalDone[i] ?? 0, LEGAL_PARAMS[i].docs.length), 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { ...sec, done, total, pct, tone: pct === 100 ? 'ok' : pct >= 60 ? 'warn' : 'bad' };
  });
}

/** Overall documents completed across all five checklists. */
export function legalTotals(s: Supplier) {
  const total = LEGAL_PARAMS.reduce((sum, p) => sum + p.docs.length, 0);
  const done = LEGAL_PARAMS.reduce((sum, p, i) => sum + Math.min(s.legalDone[i] ?? 0, p.docs.length), 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** A high-risk category together with a high/medium rating pins this PO:
 *  physical inspection becomes compulsory and the payment terms are fixed. */
export const isRiskMandatory = (s: Supplier) =>
  (s.category === 'Blacklisted Supplier' || s.category === 'High Risk Supplier')
  && (s.risk === 'High Risk' || s.risk === 'Medium Risk');

export const RISK_GUIDELINES = [
  { title: 'Physical inspection is mandatory', note: 'Goods must be physically inspected and cleared by QA before the GRN is accepted into inventory.' },
  { title: 'Payment against milestones only', note: 'Release payment strictly against installation, goods delivery and 100% GST scrutiny — no advance.' },
];

export const SUPPLIER_TYPES = ['Manufacturer', 'Distributor', 'Trader', 'Service Provider', 'Importer', 'Transporter'];
export const RISK_LEVELS = ['High Risk', 'Medium Risk', 'Low Risk'];
export const SUPPLIER_CATEGORIES = ['Star Supplier', 'Regular Supplier', 'High Risk Supplier', 'Blacklisted Supplier'];
