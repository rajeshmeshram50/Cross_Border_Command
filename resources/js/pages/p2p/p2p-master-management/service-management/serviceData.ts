export type ServiceTab = 'material' | 'soft' | 'other';
export type ServiceKind = 'soft' | 'trackable' | 'consumable' | 'other';
export type OtherType = 'professional' | 'utility' | 'facility' | 'maintenance' | 'outsourcing';
export type MaterialSub = 'trackable' | 'consumable';

export type SupplierOrigin = 'domestic' | 'international';

export interface MappedSupplier {
  mapId?: number;
  vendorId?: string;
  code: string;
  name: string;
  type: string;
  state: string;
  contact: string;
  price: number;
  gst: number;
  gstAmt: number;
  total: number;
  origin?: SupplierOrigin;
  gstStateCode?: string;
  country?: string;
  currency?: string;
  fx?: number;
  inr?: number;
}

export interface ServiceVals {
  name: string;
  desc: string;
  category?: string;
  provider?: string;
  hsn?: string;
  uom?: string;
  contract?: 'Required' | 'Not Required';
  att?: string;
  remark?: string;
  segment?: string;
  delivery?: string;
  otype?: OtherType;
  dept?: string;
  billing?: string;
  make?: string;
  haz?: string;
  hazClass?: string;
  condition?: string;
  packaging?: string;
  img1?: string;
  img2?: string;
  confidential?: string;
  gstId?: string;
  gstPct?: number;
}

export interface ServiceRecord {
  code: string;
  kind: ServiceKind;
  created: string;
  vals: ServiceVals;
  suppliers: MappedSupplier[];
  active: boolean;
  id?: number;
  status?: 'draft' | 'active' | 'inactive';
  suppliersCount?: number;
  supplierNames?: string[];
}

export interface SubType { k: string; l: string; full: string; d: string }

export const SVC_TYPES: Record<ServiceTab, {
  l: string; short: string; cls: string; desc: string; subs: SubType[];
}> = {
  material: {
    l: 'Self-Consumable Services', short: 'Self-Consumable', cls: 'Trackable & Consumable',
    desc: 'Physical goods, equipment, assets and consumable materials purchased for internal use.',
    subs: [
      { k: 'trackable', l: 'Trackable', full: 'Trackable Material / Goods', d: 'Laptops, desktops, printers, monitors, furniture — tracked one by one.' },
      { k: 'consumable', l: 'Consumable', full: 'Consumable Material / Goods', d: 'Stationery, pantry supplies, cleaning materials, printer paper — tracked by quantity.' },
    ],
  },
  soft: {
    l: 'Soft / Digital Services', short: 'Soft / Digital', cls: 'Software & Digital',
    desc: 'Software, digital platforms, subscriptions, APIs, licences, cloud and other digitally delivered services.',
    subs: [],
  },
  other: {
    l: 'Other Operational Services', short: 'Other Operational',
    cls: 'Professional, Consultancy, Utility, Facility, Maintenance & Outsourcing',
    desc: 'Professional, consultancy, utility, facility, maintenance and outsourced services that run the organisation.',
    subs: [
      { k: 'professional', l: 'Professional', full: 'Professional Service', d: 'CA, legal consultancy, accounting, HR consultancy.' },
      { k: 'utility', l: 'Utility', full: 'Utility Service', d: 'Electricity, water supply, internet connectivity.' },
      { k: 'facility', l: 'Facility', full: 'Facility Service', d: 'Housekeeping, security, pantry management.' },
      { k: 'maintenance', l: 'Maintenance', full: 'Maintenance Service', d: 'AC maintenance, electrical repair, equipment AMC.' },
      { k: 'outsourcing', l: 'Outsourcing', full: 'Outsourcing Service', d: 'Recruitment, payroll processing, courier, transportation.' },
    ],
  },
};

export const tabOfKind = (k: ServiceKind): ServiceTab =>
  k === 'trackable' || k === 'consumable' ? 'material' : k;

export const subOf = (r: ServiceRecord): string =>
  r.kind === 'other' ? (r.vals.otype ?? 'professional') : r.kind;

export const subLabel = (tab: ServiceTab, sub: string): string =>
  SVC_TYPES[tab].subs.find(s => s.k === sub)?.l ?? '';

export const OTHER_TYPES: Array<{ value: OtherType; label: string }> = [
  { value: 'professional', label: 'Professional' },
  { value: 'utility', label: 'Utility' },
  { value: 'facility', label: 'Facility' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'outsourcing', label: 'Outsourcing' },
];

export const OTHER_NAME_PH: Record<OtherType, string> = {
  professional: 'e.g. Statutory Audit',
  utility: 'e.g. Office Electricity',
  facility: 'e.g. Office Housekeeping',
  maintenance: 'e.g. AC Annual Maintenance',
  outsourcing: 'e.g. Payroll Processing',
};

export const MATERIAL_NAME_PH: Record<MaterialSub, string> = {
  trackable: 'e.g. CT Scanner AMC',
  consumable: 'e.g. Lab Reagent Supply',
};

export const GST_RATES = [0, 5, 12, 18, 28];

export const KIND_TITLE: Record<ServiceKind, string> = {
  soft: 'Soft / Digital Service',
  trackable: 'Trackable Self-Consumable Service',
  consumable: 'Consumable Self-Consumable Service',
  other: 'Other Operational Service',
};
export const KIND_SUB: Record<ServiceKind, string> = {
  soft: 'Create software, subscription and SaaS services and map the suppliers who deliver them.',
  trackable: 'Create services for serial / asset-tracked goods and map the suppliers who deliver them.',
  consumable: 'Create services for consumable goods and map the suppliers who deliver them.',
  other: 'Create professional, utility, facility, maintenance and outsourced services and map the vendors who deliver them.',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const makeSupplier = (
  s: Omit<MappedSupplier, 'gstAmt' | 'total' | 'price' | 'gst'>, price: number, gst: number,
): MappedSupplier => {
  const gstAmt = round2(price * gst / 100);
  return { ...s, price, gst, gstAmt, total: round2(price + gstAmt) };
};

const CUR_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', SAR: 'SAR ', OMR: 'OMR ',
  CNY: '¥', JPY: '¥', KRW: '₩', MYR: 'RM ', INR: '₹ ',
};
export const fmtCurrency = (cur: string, n: number): string => {
  const d = cur === 'JPY' || cur === 'KRW' ? 0 : 2;
  return (CUR_SYMBOL[cur] ?? `${cur} `) + (Number(n) || 0).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
};
export const isIntl = (s: Pick<MappedSupplier, 'origin'>) => s.origin === 'international';

export const makeIntlSupplier = (
  v: { code: string; name: string; type: string; city: string; contact: string; country: string; vendorId?: string },
  price: number, currency: string, fx: number,
): MappedSupplier => ({
  vendorId: v.vendorId, code: v.code, name: v.name, type: v.type, state: v.city, contact: v.contact,
  country: v.country, origin: 'international', currency, fx,
  price: round2(price), gst: 0, gstAmt: 0, total: round2(price), inr: round2(price * fx),
});
