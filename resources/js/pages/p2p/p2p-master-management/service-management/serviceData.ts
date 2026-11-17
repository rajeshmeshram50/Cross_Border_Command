export type ServiceTab = 'material' | 'soft' | 'other';
export type ServiceKind = 'soft' | 'trackable' | 'consumable' | 'other';
export type OtherType = 'professional' | 'utility' | 'facility' | 'maintenance' | 'outsourcing';
export type MaterialSub = 'trackable' | 'consumable';

export interface MappedSupplier {
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
  digital?: 'it' | 'nonit';
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
}

export interface ServiceRecord {
  code: string;
  kind: ServiceKind;
  created: string;
  vals: ServiceVals;
  suppliers: MappedSupplier[];
  active: boolean;
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
  r.kind === 'other' ? (r.vals.otype ?? 'professional')
    : r.kind === 'soft' ? (r.vals.digital ?? 'it')
      : r.kind;

export const subLabel = (tab: ServiceTab, sub: string): string =>
  SVC_TYPES[tab].subs.find(s => s.k === sub)?.l ?? '';

export const SOFT_CATEGORIES = [
  'Software Licence', 'SaaS Subscription', 'Cloud & Hosting', 'Website & Domain', 'Email & Collaboration',
  'Cybersecurity', 'API & Integration', 'AI Assistant', 'Design & Creative Tools', 'Digital Marketing Platform',
  'Online Learning', 'Productivity App', 'IT Support & Maintenance', 'Software Development',
];
export const SOFT_SEGMENTS = [
  'IT & Software', 'Cloud & Infrastructure', 'Communication', 'Security & Compliance', 'Marketing',
  'Design & Creative', 'Learning & Development', 'Finance & HR Tools', 'Professional Services',
];
export const SOFT_DELIVERY = ['Cloud / SaaS', 'On-Premise', 'Web / Browser', 'Mobile App', 'API', 'Remote Support', 'Hybrid'];
export const SOFT_HSN = ['997331', '998313', '998314', '998315', '998316', '998319', '998366', '999293'];
export const SOFT_UOM = ['User', 'Licence', 'Device', 'Month', 'Year', 'Hour', 'Project', 'GB (Storage)', 'API Calls', 'One-time'];

export const OTHER_TYPES: Array<{ value: OtherType; label: string }> = [
  { value: 'professional', label: 'Professional' },
  { value: 'utility', label: 'Utility' },
  { value: 'facility', label: 'Facility' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'outsourcing', label: 'Outsourcing' },
];
export const OTHER_OPTS: Record<OtherType, { cats: string[]; hsn: string[]; uom: string[]; ph: string }> = {
  professional: {
    cats: ['Chartered Accountant (CA)', 'Legal Consultancy', 'Accounting & Bookkeeping', 'HR Consultancy', 'Tax Advisory', 'Audit Services', 'Company Secretary'],
    hsn: ['998221', '998212', '998311', '998222', '998231'],
    uom: ['Month', 'Year', 'Hour', 'Assignment', 'Lump Sum'],
    ph: 'e.g. Statutory Audit',
  },
  utility: {
    cats: ['Electricity', 'Water Supply', 'Internet Connectivity', 'Telephone / Mobile', 'Gas Supply'],
    hsn: ['271600', '998422', '996921', '998411', '271121'],
    uom: ['Unit (kWh)', 'Kilolitre', 'Month', 'Connection', 'Year'],
    ph: 'e.g. Office Electricity',
  },
  facility: {
    cats: ['Housekeeping', 'Security Services', 'Pantry Management', 'Pest Control', 'Front Desk / Reception'],
    hsn: ['998533', '998521', '998535', '998531', '998599'],
    uom: ['Month', 'Person / Month', 'Shift', 'Visit', 'Year'],
    ph: 'e.g. Office Housekeeping',
  },
  maintenance: {
    cats: ['AC Maintenance', 'Electrical Repair', 'Equipment AMC', 'Plumbing', 'Lift / Elevator AMC', 'Civil & Carpentry'],
    hsn: ['998719', '998717', '998729', '998739', '995468'],
    uom: ['Visit', 'Year', 'Month', 'Job', 'Unit'],
    ph: 'e.g. AC Annual Maintenance',
  },
  outsourcing: {
    cats: ['Recruitment', 'Payroll Processing', 'Courier Services', 'Transportation', 'Event Management', 'Printing Services'],
    hsn: ['998512', '998514', '996812', '996412', '998596', '998912'],
    uom: ['Hire', 'Employee / Month', 'Shipment', 'Trip', 'Kg', 'Month'],
    ph: 'e.g. Payroll Processing',
  },
};
export const DEPARTMENTS = ['Administration', 'Finance & Accounts', 'HR', 'IT', 'Operations', 'Procurement', 'Warehouse', 'Sales & Marketing'];
export const BILLING_FREQ = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Per Use', 'One-time'];

export const MATERIAL_OPTS: Record<MaterialSub, { segments: string[]; uom: string[]; hsn: string[]; ph: string }> = {
  trackable: {
    segments: ['Medical Equipment', 'IT Hardware', 'Electrical Equipment', 'Lab Instruments', 'Furniture & Fixtures', 'Machinery'],
    uom: ['Nos', 'Set', 'Unit'],
    hsn: ['998717', '998719', '9018', '8471', '8517'],
    ph: 'e.g. CT Scanner AMC',
  },
  consumable: {
    segments: ['Medical Consumables', 'Lab Consumables', 'Office Consumables', 'Housekeeping', 'Printer Consumables', 'Packaging Material'],
    uom: ['Nos', 'Box', 'Pack', 'Kg', 'Litre', 'Roll', 'Strip', 'Vial'],
    hsn: ['3005', '3822', '4818', '3401', '8443'],
    ph: 'e.g. Lab Reagent Supply',
  },
};
export const HAZ_OPTS = ['Non Hazardous', 'Hazardous'];
export const HAZ_CLASSES = Array.from({ length: 9 }, (_, i) => `Class ${i + 1}`);
export const CONDITIONS = ['New', 'Refurbished', 'Used'];
export const PACKAGING = ['Carton', 'Wooden Crate', 'Plastic', 'Thermocol', 'Bubble Wrap'];
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

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const makeSupplier = (
  s: Omit<MappedSupplier, 'gstAmt' | 'total' | 'price' | 'gst'>, price: number, gst: number,
): MappedSupplier => {
  const gstAmt = round2(price * gst / 100);
  return { ...s, price, gst, gstAmt, total: round2(price + gstAmt) };
};

export const nextServiceCode = (rows: ServiceRecord[]): string => {
  const max = rows.reduce((m, r) => {
    const hit = /^SVC-(\d+)$/.exec(r.code);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `SVC-${String(max + 1).padStart(3, '0')}`;
};

export const formatInr = (n: number) =>
  `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PoolRow = [string, string, string, string, string];
const POOL: PoolRow[] = [
  ['S-004', 'Gulf Trade Services FZE', 'Service', 'Dubai', 'Ahmed Al-Farsi'],
  ['S-007', 'GreenField Consultants', 'Service', 'Delhi', 'Manoj Jacob'],
  ['S-011', 'Apex Audit Advisors', 'Service', 'Telangana', 'Sneha Reddy'],
  ['S-014', 'TradeBridge Consulting', 'Service', 'Maharashtra', 'Nilesh Patil'],
  ['S-026', 'Milano Design Consulting Srl', 'Service', 'Milan', 'Giulia Rossi'],
  ['S-103', 'Apex Advisory Services', 'Service', 'Karnataka', 'Rahul Menon'],
];
const sup = (q: PoolRow, price: number, gst: number) =>
  makeSupplier({ code: q[0], name: q[1], type: q[2], state: q[3], contact: q[4] }, price, gst);
const pool = (code: string) => POOL.find(p => p[0] === code)!;
const pick = (n: number, base: number, gst: number, seed: number): MappedSupplier[] =>
  Array.from({ length: n }, (_, k) => {
    const q = POOL[(seed + k * 2) % POOL.length];
    return sup(q, Math.round(base * (1 + (((seed + k) % 5) - 2) * 0.04)), gst);
  });

type SeedRecord = Omit<ServiceRecord, 'active'>;

export function buildSeed(): ServiceRecord[] {
  const D = 864e5;
  const now = Date.now();
  const at = (days: number) => new Date(now - days * D).toISOString();
  const out: SeedRecord[] = [];

  const SOFT_HEAD: Array<[string, number, ServiceVals, MappedSupplier[]]> = [
    ['SVC-001', 12, { name: 'Microsoft 365 Business Premium', desc: 'Email, Teams, OneDrive and Office apps for all staff with advanced security.', category: 'SaaS Subscription', provider: 'Microsoft', segment: 'IT & Software', delivery: 'Cloud / SaaS', hsn: '997331', uom: 'User', contract: 'Required' },
      [sup(pool('S-007'), 1850, 18), sup(pool('S-011'), 1790, 18)]],
    ['SVC-002', 9, { name: 'Zoho Books Professional', desc: 'Cloud accounting with GST invoicing, e-way bills and bank reconciliation.', category: 'Software Licence', provider: 'Zoho', segment: 'Finance & HR Tools', delivery: 'Cloud / SaaS', hsn: '997331', uom: 'Year', contract: 'Not Required' },
      [sup(pool('S-014'), 24000, 18)]],
    ['SVC-003', 6, { name: 'AWS Cloud Hosting', desc: 'EC2, S3 and RDS hosting for the IGC portal and internal tools.', category: 'Cloud & Hosting', provider: 'Amazon Web Services', segment: 'Cloud & Infrastructure', delivery: 'Cloud / SaaS', hsn: '998315', uom: 'Month', contract: 'Required' },
      [sup(pool('S-004'), 42000, 18), sup(pool('S-007'), 43500, 18), sup(pool('S-011'), 41200, 18)]],
    ['SVC-004', 3, { name: 'Quick Heal Endpoint Security', desc: 'Antivirus and endpoint protection for office laptops and desktops.', category: 'Cybersecurity', provider: 'Quick Heal', segment: 'Security & Compliance', delivery: 'On-Premise', hsn: '997331', uom: 'Device', contract: 'Not Required' }, []],
    ['SVC-005', 1, { name: 'Website AMC & Hosting', desc: 'Annual maintenance, updates and hosting for inorbvict.com.', category: 'Website & Domain', provider: 'GoDaddy', segment: 'Marketing', delivery: 'Remote Support', hsn: '998316', uom: 'Year', contract: 'Required' },
      [sup(pool('S-026'), 36000, 18)]],
  ];
  SOFT_HEAD.forEach(([code, d, vals, s]) => out.push({ code, kind: 'soft', created: at(d), vals: { ...vals, digital: 'it' }, suppliers: s }));

  const MAT_HEAD: Array<[string, MaterialSub, number, ServiceVals, MappedSupplier[]]> = [
    ['SVC-006', 'trackable', 8, { name: 'Office Laptops', make: 'Dell · Latitude 5440', segment: 'IT Hardware', desc: 'Laptops for office staff, tracked by serial number and asset tag.', haz: 'Non Hazardous', uom: 'Nos', hsn: '8471', condition: 'New', packaging: 'Carton' },
      [sup(pool('S-007'), 62000, 18), sup(pool('S-011'), 60500, 18)]],
    ['SVC-007', 'trackable', 4, { name: 'Office Printers', make: 'HP · LaserJet Pro M404', segment: 'IT Hardware', desc: 'Laser printers for each floor, tracked by serial number.', haz: 'Non Hazardous', uom: 'Nos', hsn: '8443', condition: 'New', packaging: 'Carton' },
      [sup(pool('S-014'), 18500, 18)]],
    ['SVC-008', 'consumable', 5, { name: 'Lab Reagent Supply', make: 'Roche · Cobas', segment: 'Lab Consumables', desc: 'Monthly supply of biochemistry reagents and controls for the diagnostic lab.', haz: 'Hazardous', hazClass: 'Class 6', uom: 'Box', hsn: '3822', condition: 'New', packaging: 'Thermocol' },
      [sup(pool('S-004'), 18500, 12), sup(pool('S-007'), 19200, 12), sup(pool('S-026'), 17900, 12)]],
    ['SVC-009', 'consumable', 2, { name: 'Housekeeping Supplies', make: 'Diversey · Taski', segment: 'Housekeeping', desc: 'Cleaning chemicals, mops and tissue rolls for office and warehouse.', haz: 'Non Hazardous', uom: 'Pack', hsn: '3401', condition: 'New', packaging: 'Carton' }, []],
  ];
  MAT_HEAD.forEach(([code, kind, d, vals, s]) => out.push({ code, kind, created: at(d), vals, suppliers: s }));

  let n = 10;
  const code = () => `SVC-${String(n++).padStart(3, '0')}`;

  type SoftRow = [string, string, string, string, string, string, string, string, 'Required' | 'Not Required', number, ('it' | 'nonit')?];
  const SOFT: SoftRow[] = [
    ['Tally Prime Gold Licence', 'Accounting software for GST returns, inventory and payroll.', 'Software Licence', 'Tally Solutions', 'Finance & HR Tools', 'On-Premise', '997331', 'Licence', 'Not Required', 54000],
    ['Google Workspace Business', 'Gmail, Drive, Meet and Docs for the marketing team.', 'Email & Collaboration', 'Google', 'Communication', 'Cloud / SaaS', '997331', 'User', 'Required', 1380],
    ['Salesforce Sales Cloud', 'CRM for leads, opportunities and customer accounts.', 'SaaS Subscription', 'Salesforce', 'IT & Software', 'Cloud / SaaS', '997331', 'User', 'Required', 6200],
    ['Zoom Business Plan', 'Video meetings and webinars for client calls.', 'Email & Collaboration', 'Zoom', 'Communication', 'Cloud / SaaS', '997331', 'User', 'Not Required', 1100],
    ['Azure Backup Vault', 'Daily cloud backup of file servers and ERP database.', 'Cloud & Hosting', 'Microsoft', 'Cloud & Infrastructure', 'Cloud / SaaS', '998315', 'GB (Storage)', 'Required', 9],
    ['Sophos Firewall Licence', 'Next-gen firewall subscription with intrusion prevention.', 'Cybersecurity', 'Sophos', 'Security & Compliance', 'On-Premise', '998316', 'Device', 'Required', 72000],
    ['Canva Teams', 'Design tool for social posts, brochures and presentations.', 'Design & Creative Tools', 'Canva', 'Marketing', 'Cloud / SaaS', '997331', 'User', 'Not Required', 4000, 'nonit'],
    ['SEO & Digital Campaign Retainer', 'Monthly SEO, Google Ads and social media management.', 'Digital Marketing Platform', 'Webxpert Digital', 'Marketing', 'Remote Support', '998366', 'Month', 'Required', 65000, 'nonit'],
    ['Custom Inventory App Development', 'Build of an Android app for warehouse barcode scanning.', 'Software Development', 'Codemonk Labs', 'Professional Services', 'Remote Support', '998314', 'Project', 'Required', 450000],
    ['IT Helpdesk AMC', 'On-call desktop, printer and network support for the office.', 'IT Support & Maintenance', 'NetCare Systems', 'IT & Software', 'Remote Support', '998313', 'Year', 'Required', 180000],
    ['Domain & SSL Renewal', 'Renewal of company domains and wildcard SSL certificates.', 'Website & Domain', 'GoDaddy', 'Marketing', 'Cloud / SaaS', '998316', 'Year', 'Not Required', 12000],
    ['ISO 27001 Awareness Training', 'Online information-security training for all employees.', 'Online Learning', 'TÜV SÜD', 'Security & Compliance', 'Remote Support', '999293', 'User', 'Not Required', 850, 'nonit'],
    ['Adobe Acrobat Pro', 'PDF editing and e-signature licences for admin staff.', 'Software Licence', 'Adobe', 'IT & Software', 'Cloud / SaaS', '997331', 'Licence', 'Not Required', 1600],
  ];
  const softRec = (x: SoftRow, days: number, digital: 'it' | 'nonit', s: MappedSupplier[]): SeedRecord => ({
    code: code(), kind: 'soft', created: at(days), suppliers: s,
    vals: { name: x[0], desc: x[1], category: x[2], provider: x[3], segment: x[4], delivery: x[5], hsn: x[6], uom: x[7], contract: x[8], digital },
  });
  SOFT.forEach((x, k) => out.push(softRec(x, 14 + k * 2, x[10] ?? 'it', pick(k % 4, x[9], 18, k))));

  type MatRow = [string, string, string, string, string, string, string, number];
  const TRK: MatRow[] = [
    ['Desktop Computers', 'Lenovo · ThinkCentre M70', 'IT Hardware', 'Desktop PCs for accounts and admin teams.', 'Nos', '8471', 'New', 48000],
    ['Computer Monitors', 'LG · 24MP400', 'IT Hardware', '24-inch monitors for staff workstations.', 'Nos', '8528', 'New', 9500],
    ['Mobile Phones', 'Samsung · Galaxy A35', 'IT Hardware', 'Company phones for the sales and field team.', 'Nos', '8517', 'New', 28000],
    ['Tablets', 'Apple · iPad 10th Gen', 'IT Hardware', 'Tablets for warehouse stock checks and demos.', 'Nos', '8471', 'New', 36000],
    ['Projector', 'Epson · EB-X51', 'Electrical Equipment', 'Projector for the main conference room.', 'Nos', '8528', 'New', 42000],
    ['Scanner', 'Canon · imageFORMULA DR-C230', 'IT Hardware', 'Document scanner for the records room.', 'Nos', '8471', 'New', 31000],
    ['Wi-Fi Routers', 'TP-Link · Archer AX55', 'IT Hardware', 'Office Wi-Fi routers and access points.', 'Nos', '8517', 'New', 6500],
    ['Network Switch', 'Cisco · CBS250-24T', 'IT Hardware', '24-port switch for the office network rack.', 'Nos', '8517', 'New', 28500],
    ['Office Chairs', 'Featherlite · Astra', 'Furniture & Fixtures', 'Ergonomic chairs for staff workstations.', 'Nos', '9401', 'New', 7800],
    ['Office Desks', 'Godrej Interio · Slimline', 'Furniture & Fixtures', 'Workstation desks with drawer pedestals.', 'Nos', '9403', 'New', 14500],
    ['Air Conditioners', 'Daikin · 1.5 Ton Split', 'Electrical Equipment', 'Split ACs for cabins and meeting rooms.', 'Nos', '8415', 'New', 46000],
    ['Water Dispenser', 'Blue Star · BWD3FMRGA', 'Electrical Equipment', 'Hot and cold water dispensers for each floor.', 'Nos', '8516', 'New', 11500],
    ['Biometric Attendance Device', 'eSSL · X990', 'Electrical Equipment', 'Fingerprint and face attendance terminals.', 'Nos', '8471', 'New', 8900],
    ['CCTV Cameras', 'Hikvision · DS-2CD1023', 'Electrical Equipment', 'IP cameras for office entrances and corridors.', 'Nos', '8525', 'New', 3400],
    ['UPS Units', 'APC · Back-UPS 1100VA', 'Electrical Equipment', 'Power backup for desktops and network rack.', 'Nos', '8504', 'Refurbished', 6800],
    ['Office Refrigerator', 'LG · 260L Frost Free', 'Electrical Equipment', 'Pantry refrigerator for the staff lunch area.', 'Nos', '8418', 'Used', 24000],
  ];
  const CON: MatRow[] = [
    ['Surgical Gloves Supply', 'Ansell · Gammex', 'Medical Consumables', 'Sterile latex surgical gloves for OT and wards.', 'Box', '3005', 'New', 1250],
    ['Printer Toner Supply', 'HP · 76A', 'Printer Consumables', 'Monthly replenishment of laser toner cartridges.', 'Nos', '8443', 'New', 5400],
    ['Packaging Tape & Stretch Film', '3M · Scotch', 'Packaging Material', 'Carton sealing tape and pallet stretch film for dispatch.', 'Roll', '4818', 'New', 85],
    ['Office Stationery Supply', 'Classmate · ITC', 'Office Consumables', 'Pens, files, A4 paper and notepads for all departments.', 'Pack', '4818', 'New', 650],
    ['Hand Sanitiser Refill', 'Dettol · Instant', 'Housekeeping', '5-litre sanitiser refills for wall dispensers.', 'Litre', '3401', 'New', 220],
    ['Lab Glassware Supply', 'Borosil · Beakers', 'Lab Consumables', 'Beakers, pipettes and test tubes for the QC lab.', 'Box', '3822', 'New', 3200],
    ['Syringes & Needles', 'BD · Emerald', 'Medical Consumables', 'Disposable syringes with needles in assorted sizes.', 'Box', '3005', 'New', 780],
    ['Floor Cleaning Chemicals', 'Diversey · Taski R2', 'Housekeeping', 'Concentrated floor cleaner for warehouse and office.', 'Litre', '3401', 'New', 310],
    ['Thermal Label Rolls', 'Zebra · 4x6', 'Printer Consumables', 'Shipping labels for warehouse thermal printers.', 'Roll', '4818', 'New', 140],
    ['Bubble Wrap Rolls', 'Supreme · Aircel', 'Packaging Material', 'Protective bubble wrap for fragile dispatches.', 'Roll', '3923', 'New', 420],
    ['Face Masks Supply', '3M · Aura 9320', 'Medical Consumables', 'N95 masks for lab and warehouse staff.', 'Box', '6307', 'New', 1900],
    ['Pantry Supplies', 'Nestlé · Everyday', 'Office Consumables', 'Tea, coffee, sugar and disposable cups for the pantry.', 'Pack', '2101', 'New', 1450],
    ['Lab Reagent Controls', 'Bio-Rad · Lyphochek', 'Lab Consumables', 'Quality-control sera for the analyser.', 'Vial', '3822', 'New', 2600],
    ['Garbage Bags Supply', 'Ezee · Biodegradable', 'Housekeeping', 'Large biodegradable garbage bags for all floors.', 'Pack', '3923', 'New', 260],
    ['Ink Cartridge Supply', 'Epson · 003', 'Printer Consumables', 'Ink bottles for colour inkjet printers.', 'Nos', '8443', 'New', 390],
    ['Corrugated Boxes', 'Packman · 5-Ply', 'Packaging Material', '5-ply corrugated boxes in standard sizes.', 'Nos', '4819', 'New', 55],
  ];
  const matRec = (x: MatRow, kind: MaterialSub, days: number, s: MappedSupplier[]): SeedRecord => ({
    code: code(), kind, created: at(days), suppliers: s,
    vals: { name: x[0], make: x[1], segment: x[2], desc: x[3], haz: 'Non Hazardous', uom: x[4], hsn: x[5], condition: x[6], packaging: 'Carton' },
  });
  TRK.forEach((x, k) => out.push(matRec(x, 'trackable', 10 + k * 2, pick((k + 1) % 4, x[7], 18, k + 1))));
  CON.forEach((x, k) => out.push(matRec(x, 'consumable', 9 + k * 2, pick((k + 2) % 4, x[7], 12, k + 2))));

  const NON: SoftRow[] = [
    ['Claude Team Plan', 'AI assistant for drafting, research and analysis across teams.', 'AI Assistant', 'Anthropic', 'IT & Software', 'Web / Browser', '997331', 'User', 'Required', 2500],
    ['ChatGPT Team', 'AI assistant for content writing and customer replies.', 'AI Assistant', 'OpenAI', 'IT & Software', 'Web / Browser', '997331', 'User', 'Not Required', 2100],
    ['Figma Professional', 'UI / UX design and prototyping for the product team.', 'Design & Creative Tools', 'Figma', 'Design & Creative', 'Web / Browser', '997331', 'User', 'Not Required', 1250],
    ['Adobe Creative Cloud', 'Photoshop, Illustrator and Premiere for marketing creatives.', 'Design & Creative Tools', 'Adobe', 'Design & Creative', 'Cloud / SaaS', '997331', 'Licence', 'Required', 4600],
    ['HubSpot Marketing Hub', 'Email campaigns, landing pages and lead nurturing.', 'Digital Marketing Platform', 'HubSpot', 'Marketing', 'Cloud / SaaS', '998366', 'Month', 'Required', 68000],
    ['LinkedIn Learning', 'Online courses for staff upskilling and compliance.', 'Online Learning', 'LinkedIn', 'Learning & Development', 'Web / Browser', '999293', 'User', 'Not Required', 2800],
    ['Coursera for Business', 'Professional certificates for managers and analysts.', 'Online Learning', 'Coursera', 'Learning & Development', 'Web / Browser', '999293', 'User', 'Required', 3300],
    ['Notion Plus', 'Team wiki, project notes and SOP documentation.', 'Productivity App', 'Notion Labs', 'IT & Software', 'Web / Browser', '997331', 'User', 'Not Required', 850],
    ['Grammarly Business', 'Writing assistant for proposals and client emails.', 'Productivity App', 'Grammarly', 'Communication', 'Web / Browser', '997331', 'User', 'Not Required', 1250],
    ['SurveyMonkey Team', 'Customer feedback and employee pulse surveys.', 'Survey & Forms Tool', 'SurveyMonkey', 'Marketing', 'Web / Browser', '997331', 'User', 'Not Required', 2000],
    ['Shutterstock Images', 'Stock photos and illustrations for campaigns.', 'Media & Content Subscription', 'Shutterstock', 'Marketing', 'Web / Browser', '998366', 'Month', 'Not Required', 14500],
    ['Canva Pro (Sales)', 'Sales collateral and social posts for the field team.', 'Design & Creative Tools', 'Canva', 'Design & Creative', 'Web / Browser', '997331', 'User', 'Not Required', 4000],
  ];
  NON.forEach((x, k) => out.push(softRec(x, 3 + k * 3, 'nonit', pick((k + 1) % 4, x[9], 18, k + 3))));

  type OthRow = [OtherType, string, string, string, string, string, string, string, string, 'Required' | 'Not Required', number];
  const OTH: OthRow[] = [
    ['professional', 'Statutory Audit', 'Annual statutory audit of financial statements.', 'Audit Services', 'Sharma & Associates CA', 'Finance & Accounts', 'Yearly', '998221', 'Assignment', 'Required', 350000],
    ['professional', 'Monthly Accounting & GST Filing', 'Bookkeeping, GSTR-1 / 3B and TDS returns every month.', 'Chartered Accountant (CA)', 'Mehta & Co. Chartered Accountants', 'Finance & Accounts', 'Monthly', '998221', 'Month', 'Required', 45000],
    ['professional', 'Legal Retainer', 'Contract review, notices and legal opinions on call.', 'Legal Consultancy', 'Khaitan Legal Associates', 'Administration', 'Monthly', '998212', 'Month', 'Required', 60000],
    ['professional', 'HR Policy Consultancy', 'Drafting HR policies, appraisal framework and handbook.', 'HR Consultancy', 'PeopleFirst Advisory', 'HR', 'One-time', '998311', 'Assignment', 'Required', 180000],
    ['professional', 'Company Secretarial Compliance', 'ROC filings, board minutes and MCA compliance.', 'Company Secretary', 'Desai CS & Co.', 'Administration', 'Yearly', '998222', 'Year', 'Required', 95000],
    ['utility', 'Office Electricity', 'Electricity supply for head office and warehouse.', 'Electricity', 'MSEDCL', 'Administration', 'Monthly', '271600', 'Unit (kWh)', 'Not Required', 9],
    ['utility', 'Office Water Supply', 'Municipal water and drinking-water cans for pantry.', 'Water Supply', 'Pune Municipal Corporation', 'Administration', 'Monthly', '996921', 'Kilolitre', 'Not Required', 45],
    ['utility', 'Leased Line Internet', '100 Mbps leased line with static IP for the office.', 'Internet Connectivity', 'Airtel Business', 'IT', 'Monthly', '998422', 'Month', 'Required', 18500],
    ['utility', 'Broadband Backup Line', 'Backup broadband connection for warehouse.', 'Internet Connectivity', 'JioFiber Business', 'IT', 'Monthly', '998422', 'Connection', 'Not Required', 2400],
    ['utility', 'Corporate Mobile Plans', 'Postpaid plans for sales and management staff.', 'Telephone / Mobile', 'Vodafone Idea Business', 'Administration', 'Monthly', '998411', 'Connection', 'Required', 599],
    ['facility', 'Office Housekeeping', 'Daily cleaning of office floors, cabins and washrooms.', 'Housekeeping', 'BVG India Ltd', 'Administration', 'Monthly', '998533', 'Person / Month', 'Required', 16500],
    ['facility', 'Security Guard Services', '24 x 7 guards for office and warehouse gates.', 'Security Services', 'SIS Security', 'Administration', 'Monthly', '998521', 'Person / Month', 'Required', 21000],
    ['facility', 'Pantry Management', 'Tea, coffee and snack service for staff.', 'Pantry Management', 'Sodexo Food Solutions', 'Administration', 'Monthly', '998535', 'Month', 'Required', 38000],
    ['facility', 'Pest Control', 'Quarterly pest and termite treatment.', 'Pest Control', 'HiCare Services', 'Warehouse', 'Quarterly', '998531', 'Visit', 'Not Required', 6500],
    ['maintenance', 'AC Annual Maintenance', 'Quarterly servicing of split and VRV air-conditioners.', 'AC Maintenance', 'Daikin Service Centre', 'Administration', 'Yearly', '998719', 'Year', 'Required', 96000],
    ['maintenance', 'Electrical Repair on Call', 'Wiring, DB and lighting repairs as needed.', 'Electrical Repair', 'PowerFix Electricals', 'Administration', 'Per Use', '998729', 'Job', 'Not Required', 1500],
    ['maintenance', 'Lift AMC', 'Comprehensive maintenance of passenger lift.', 'Lift / Elevator AMC', 'KONE Elevator India', 'Administration', 'Yearly', '998717', 'Year', 'Required', 72000],
    ['maintenance', 'Plumbing Maintenance', 'Leak repair and fixture replacement in washrooms.', 'Plumbing', 'QuickFix Plumbers', 'Administration', 'Per Use', '998729', 'Visit', 'Not Required', 800],
    ['outsourcing', 'Recruitment Agency', 'Hiring of sales and warehouse staff on success fee.', 'Recruitment', 'TeamLease Services', 'HR', 'Per Use', '998512', 'Hire', 'Required', 35000],
    ['outsourcing', 'Payroll Processing', 'Monthly salary processing, PF / ESI and payslips.', 'Payroll Processing', 'ADP India', 'HR', 'Monthly', '998514', 'Employee / Month', 'Required', 120],
    ['outsourcing', 'Courier Services', 'Document and sample courier across India.', 'Courier Services', 'Blue Dart Express', 'Operations', 'Per Use', '996812', 'Shipment', 'Not Required', 180],
    ['outsourcing', 'Staff Transportation', 'Pick-up and drop cabs for night-shift staff.', 'Transportation', 'Meru Cabs Corporate', 'Operations', 'Monthly', '996412', 'Trip', 'Required', 650],
  ];
  OTH.forEach((x, k) => out.push({
    code: code(), kind: 'other', created: at(1 + k * 2), suppliers: pick(k % 4, x[10], 18, k + 4),
    vals: { otype: x[0], name: x[1], desc: x[2], category: x[3], provider: x[4], dept: x[5], billing: x[6], hsn: x[7], uom: x[8], contract: x[9] },
  }));

  return out.map(r => ({ ...r, active: true }));
}
