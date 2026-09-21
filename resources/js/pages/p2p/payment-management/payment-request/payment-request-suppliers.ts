// Static supplier records for the Payment Request page until it is wired to the
// suppliers API. The Create PO form reads real suppliers.
import type { SupplierVaultTarget, VaultData, VaultDoc } from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';
import { formatDmy } from '../../../../utils/formatDmy';
import type { RiskSubject } from '../../purchase-management/order/create-po/supplier-checks';
export { RISK_GUIDELINES, isRiskMandatory } from '../../purchase-management/order/create-po/supplier-checks';

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
export const supplierOption = (s: Supplier) => `${s.code} — ${s.key}`;

export const SUPPLIER_OPTIONS = SUPPLIERS.map(supplierOption);

export const supplierByOption = (option: string) => SUPPLIERS.find((s) => supplierOption(s) === option);

/** The list shows "Adani Enterprises"; the master holds "Adani Enterprises Ltd". */
export const supplierByName = (name: string) => {
  const wanted = name.trim().toLowerCase();
  // An empty name would "start" every key and match the first supplier.
  return wanted ? SUPPLIERS.find((s) => s.key.toLowerCase().startsWith(wanted)) : undefined;
};

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

/* The Supplier master's Evidence Vault, fed from the same checklist the Legal
   Status panel counts — so the vault's numbers match the panel it opens from.
   These suppliers have no database row, so there is nothing for the vault to
   fetch; the first `legalDone[i]` documents of each checklist are verified,
   the rest pending. A verified one carries a file name (that's what the vault
   counts as uploaded) but no link — there is no real file behind it. */
export function supplierVaultTarget(s: Supplier): SupplierVaultTarget {
  return {
    id: s.code, company: s.legalName, risk: s.risk, segment: s.segment, country: s.country,
    type: s.type, contact: s.contact, contactCity: s.city, email: s.email,
  };
}

export function supplierVaultData(s: Supplier): VaultData {
  let id = 0;
  const docs = (i: number, expiry: string): VaultDoc[] => LEGAL_PARAMS[i].docs.map((name, n) => {
    const ok = n < (s.legalDone[i] ?? 0);
    return {
      id: ++id, name, requirement: 'M',
      status: ok ? 'Verified' : 'Pending',
      issue_date: ok ? '02-Apr-2025' : null,
      expiry: ok ? expiry : null,
      attachment: ok ? `${name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.pdf` : null,
    };
  });
  const companyDd = docs(0, 'Lifetime');
  const ownerKyc = docs(1, 'Lifetime');
  const licenses = docs(2, '31-Mar-2028');
  const tradeDocs = [...docs(3, '31-Mar-2027'), ...docs(4, '31-Mar-2028')];
  const all = [...companyDd, ...ownerKyc, ...licenses, ...tradeDocs];
  const verified = all.filter((d) => d.status === 'Verified').length;
  return {
    total_documents: all.length,
    verified_signed: verified,
    pending: all.length - verified,
    company_dd_count: companyDd.length,
    owner_kyc_count: ownerKyc.length,
    trade_license_count: licenses.length,
    trade_documents_count: tradeDocs.length,
    total_shipments: 0,
    company_dd: companyDd,
    owner_kyc: ownerKyc,
    trade_licenses: licenses,
    trade_documents: tradeDocs,
    shipment_agreements: [],
    last_updated: formatDmy(new Date().toISOString().slice(0, 10)),
  };
}

/** What the shared risk checks read from a sample supplier. */
export const toRiskSubject = (s: Supplier): RiskSubject => ({
  risk: s.risk, category: s.category, gstStatus: s.gstStatus, gstNo: s.gstNo,
  filing: s.filing, scrutiny: s.scrutiny, legal: legalTotals(s),
});

export const SUPPLIER_TYPES = ['Manufacturer', 'Distributor', 'Trader', 'Service Provider', 'Importer', 'Transporter'];
export const RISK_LEVELS = ['High Risk', 'Medium Risk', 'Low Risk'];
export const SUPPLIER_CATEGORIES = ['Star Supplier', 'Regular Supplier', 'High Risk Supplier', 'Blacklisted Supplier'];
