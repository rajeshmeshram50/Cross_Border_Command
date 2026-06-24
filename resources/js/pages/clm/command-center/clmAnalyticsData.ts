/* ─────────────────────────────────────────────────────────────────────────
 * CLM Analytics — mock dataset (faithful port of the `rAnalytics()` view from
 * the CLM_(28) prototype). There is no `/clm/analytics` API yet, so the page
 * renders from this embedded dataset exactly as the prototype did.
 *
 * Doc-completion totals are fixed across With-Shipment rows
 * (KYC 4, DD 3, TL 3, TD 4, AGR 2); only the "done" counts vary. Without-
 * Shipment rows match the same totals except some have no agreement
 * obligation (AGR 0/0), so that total is supplied per row.
 * ───────────────────────────────────────────────────────────────────────── */

export type DocProg = { d: number; t: number };
export type DocKey = 'kyc' | 'dd' | 'tl' | 'td' | 'agr';
export const DOC_KEYS: DocKey[] = ['kyc', 'dd', 'tl', 'td', 'agr'];

export type WsRow = {
  shp: string; opp: string; customer: string;
  kyc: DocProg; dd: DocProg; tl: DocProg; td: DocProg; agr: DocProg;
};
export type WosRow = { kyc: DocProg; dd: DocProg; tl: DocProg; td: DocProg; agr: DocProg };
export type Party = { id: string; name: string };

const ws = (shp: string, opp: string, customer: string, k: number, d: number, t: number, td: number, a: number): WsRow =>
  ({ shp, opp, customer, kyc: { d: k, t: 4 }, dd: { d, t: 3 }, tl: { d: t, t: 3 }, td: { d: td, t: 4 }, agr: { d: a, t: 2 } });

const wos = (k: number, d: number, t: number, td: number, a: number, at: number): WosRow =>
  ({ kyc: { d: k, t: 4 }, dd: { d, t: 3 }, tl: { d: t, t: 3 }, td: { d: td, t: 4 }, agr: { d: a, t: at } });

/* With Shipment ID — Equal (buyer == consignee) transactions. */
const WS_EQ: WsRow[] = [
  ws('SHP-001', 'OPP-101', 'Shree Exports Pvt Ltd',    4, 3, 3, 4, 2),
  ws('SHP-002', 'OPP-102', 'GreenHarvest Global',       4, 3, 3, 3, 2),
  ws('SHP-003', 'OPP-103', 'GreenHarvest Agri-Exports', 0, 0, 0, 0, 0),
  ws('SHP-004', 'OPP-104', 'Fit Nation Pvt Ltd',        4, 3, 3, 4, 2),
  ws('SHP-005', 'OPP-105', 'FreshMart Retailers',       4, 2, 2, 2, 1),
  ws('SHP-006', 'OPP-106', 'QuickTrade Resellers',      1, 0, 0, 0, 0),
  ws('SHP-007', 'OPP-107', 'Manoj Jacob Foods',         4, 1, 1, 1, 1),
  ws('SHP-008', 'OPP-108', 'Bharat Agro Traders',       4, 3, 3, 1, 1),
  ws('SHP-009', 'OPP-109', 'Sunrise Food Products',     2, 0, 0, 1, 0),
  ws('SHP-010', 'OPP-110', 'EastCoast Commodities',     4, 2, 1, 2, 1),
  ws('SHP-011', 'OPP-111', 'International Buyer LLC',    2, 1, 0, 1, 0),
  ws('SHP-012', 'OPP-112', 'NatureFresh Exports',       4, 3, 3, 4, 2),
  ws('SHP-013', 'OPP-113', 'AgriWorld Trading Co.',     3, 2, 2, 2, 1),
  ws('SHP-014', 'OPP-114', 'PrimeTrade International',   4, 3, 3, 4, 2),
  ws('SHP-015', 'OPP-115', 'GlobalGrain Suppliers',     4, 3, 3, 3, 2),
  ws('SHP-016', 'OPP-116', 'Gulf Foods Trading LLC',    4, 3, 3, 3, 2),
  ws('SHP-017', 'OPP-117', 'Rotterdam Agri B.V.',       4, 2, 2, 2, 1),
  ws('SHP-018', 'OPP-118', 'Singapore Spice House Pte', 4, 3, 3, 4, 2),
  ws('SHP-019', 'OPP-119', 'Hamburg Commodities GmbH',  3, 2, 1, 2, 1),
  ws('SHP-020', 'OPP-120', 'London Organics Ltd',       4, 3, 3, 3, 2),
];

/* With Shipment ID — Not-Equal (buyer != consignee) transactions. */
const WS_NEQ: WsRow[] = [
  ws('SHP-101', 'OPP-201', 'Shree Exports Pvt Ltd',     4, 3, 3, 4, 2),
  ws('SHP-102', 'OPP-202', 'GreenHarvest Global',        4, 3, 2, 3, 1),
  ws('SHP-103', 'OPP-203', 'Fit Nation Pvt Ltd',         3, 2, 2, 2, 1),
  ws('SHP-104', 'OPP-204', 'FreshMart Retailers',        4, 3, 3, 4, 2),
  ws('SHP-105', 'OPP-205', 'Bharat Agro Traders',        4, 2, 1, 2, 1),
  ws('SHP-106', 'OPP-206', 'Manoj Jacob Foods',          4, 3, 3, 3, 2),
  ws('SHP-107', 'OPP-207', 'Sunrise Food Products',      2, 1, 1, 1, 0),
  ws('SHP-108', 'OPP-208', 'EastCoast Commodities',      4, 3, 2, 2, 1),
  ws('SHP-109', 'OPP-209', 'QuickTrade Resellers',       1, 0, 0, 0, 0),
  ws('SHP-110', 'OPP-210', 'GreenHarvest Agri-Exports',  4, 3, 3, 3, 2),
  ws('SHP-111', 'OPP-211', 'Bharat Agro Traders',        4, 3, 3, 4, 2),
  ws('SHP-112', 'OPP-212', 'PrimeTrade International',    4, 3, 2, 3, 1),
  ws('SHP-113', 'OPP-213', 'GlobalGrain Suppliers',      4, 3, 3, 4, 2),
  ws('SHP-114', 'OPP-214', 'Sunrise Food Products',      2, 1, 0, 1, 0),
  ws('SHP-115', 'OPP-215', 'AgriWorld Trading Co.',      4, 3, 3, 4, 2),
  ws('SHP-116', 'OPP-216', 'International Buyer LLC',     4, 2, 2, 2, 1),
  ws('SHP-117', 'OPP-217', 'NatureFresh Exports',        4, 3, 3, 3, 2),
  ws('SHP-118', 'OPP-218', 'Gulf Foods Trading LLC',     3, 2, 1, 2, 1),
  ws('SHP-119', 'OPP-219', 'Singapore Spice House Pte',  4, 3, 3, 4, 2),
  ws('SHP-120', 'OPP-220', 'London Organics Ltd',        4, 3, 2, 3, 1),
];

export const WS_ROWS: WsRow[] = [...WS_EQ, ...WS_NEQ];   // 40

/* Without Shipment ID — only doc-completion is needed for the header stats. */
const WOS_EQ: WosRow[] = [
  wos(4, 3, 3, 4, 2, 2), wos(4, 3, 3, 3, 0, 0), wos(0, 0, 0, 0, 0, 2), wos(4, 3, 3, 4, 2, 2),
  wos(4, 2, 2, 2, 0, 0), wos(1, 0, 0, 0, 0, 2), wos(4, 1, 1, 1, 1, 2), wos(4, 3, 3, 1, 0, 0),
  wos(2, 0, 0, 1, 0, 2), wos(4, 2, 1, 2, 1, 2), wos(2, 1, 0, 1, 1, 2), wos(4, 3, 3, 4, 0, 0),
  wos(3, 2, 2, 2, 1, 2), wos(4, 3, 3, 4, 2, 2), wos(4, 3, 3, 3, 0, 0), wos(4, 3, 3, 3, 2, 2),
  wos(4, 2, 2, 2, 1, 2), wos(4, 3, 3, 4, 0, 0), wos(3, 2, 1, 2, 1, 2), wos(4, 3, 3, 3, 2, 2),
];
const WOS_NEQ: WosRow[] = [
  wos(4, 3, 3, 4, 2, 2), wos(4, 2, 2, 3, 0, 0), wos(3, 2, 2, 2, 1, 2), wos(4, 3, 3, 4, 2, 2),
  wos(4, 2, 1, 2, 0, 0), wos(4, 3, 3, 3, 2, 2), wos(2, 1, 1, 1, 0, 2), wos(4, 3, 2, 2, 0, 0),
  wos(1, 0, 0, 0, 0, 2), wos(4, 3, 3, 3, 2, 2), wos(4, 3, 3, 4, 2, 2), wos(4, 3, 2, 3, 0, 0),
  wos(4, 3, 3, 4, 2, 2), wos(2, 1, 0, 1, 1, 2), wos(4, 3, 3, 4, 0, 0), wos(4, 2, 2, 2, 1, 2),
  wos(4, 3, 3, 3, 2, 2), wos(3, 2, 1, 2, 0, 0), wos(4, 3, 3, 4, 2, 2), wos(4, 3, 2, 3, 1, 2),
];
export const WOS_ROWS: WosRow[] = [...WOS_EQ, ...WOS_NEQ];   // 40

/* Buyers (customers) — id + name; used for the Buyer-scope code lookup. */
export const BUYERS: Party[] = [
  { id: 'C-001', name: 'Shree Exports Pvt Ltd' },     { id: 'C-002', name: 'GreenHarvest Global' },
  { id: 'C-003', name: 'GreenHarvest Agri-Exports' }, { id: 'C-004', name: 'International Buyer LLC' },
  { id: 'C-005', name: 'QuickTrade Resellers' },      { id: 'C-006', name: 'Fit Nation Pvt Ltd' },
  { id: 'C-007', name: 'Manoj Jacob Foods' },         { id: 'C-008', name: 'FreshMart Retailers' },
  { id: 'C-009', name: 'Bharat Agro Traders' },       { id: 'C-010', name: 'NatureFresh Exports' },
  { id: 'C-011', name: 'AgriWorld Trading Co.' },     { id: 'C-012', name: 'PrimeTrade International' },
  { id: 'C-013', name: 'Sunrise Food Products' },     { id: 'C-014', name: 'GlobalGrain Suppliers' },
  { id: 'C-015', name: 'EastCoast Commodities' },     { id: 'C-016', name: 'Gulf Foods Trading LLC' },
  { id: 'C-017', name: 'Rotterdam Agri B.V.' },       { id: 'C-018', name: 'Singapore Spice House Pte' },
  { id: 'C-019', name: 'Hamburg Commodities GmbH' },  { id: 'C-020', name: 'London Organics Ltd' },
];

/* Consignees — id + name; Consignee scope maps txn → consignee by index. */
export const CONSIGNEES: Party[] = [
  { id: 'CS-001', name: 'Dubai Trade Hub LLC' },       { id: 'CS-002', name: 'Al Reem Distributors' },
  { id: 'CS-003', name: 'Khalid & Sons Trading' },     { id: 'CS-004', name: 'Amsterdam Fresh BV' },
  { id: 'CS-005', name: 'GreenCargo Rotterdam' },      { id: 'CS-006', name: 'EuroAgri Imports GmbH' },
  { id: 'CS-007', name: 'Antwerp Commodities SA' },    { id: 'CS-008', name: 'Nordic Trade Partners' },
  { id: 'CS-009', name: 'Dhaka Grain Corp.' },         { id: 'CS-010', name: 'Bengal Export House' },
  { id: 'CS-011', name: 'Gulf Spice Trading LLC' },    { id: 'CS-012', name: 'Muscat Commodity House' },
  { id: 'CS-013', name: 'Sharjah Food Traders' },      { id: 'CS-014', name: 'Bahrain Imports Co.' },
  { id: 'CS-015', name: 'Mumbai Resale Hub' },         { id: 'CS-016', name: 'London Health Foods Ltd' },
  { id: 'CS-017', name: 'Paris Organic Imports' },     { id: 'CS-018', name: 'Singapore Coconut Trading' },
  { id: 'CS-019', name: 'KL Food Industries Sdn Bhd' },{ id: 'CS-020', name: 'Jakarta Agro Processors' },
  { id: 'CS-021', name: 'Tokyo Rice Importers KK' },   { id: 'CS-022', name: 'Riyadh Grain Traders' },
  { id: 'CS-023', name: 'Jeddah Food Distribution' },  { id: 'CS-024', name: 'Dammam Wholesale Co.' },
  { id: 'CS-025', name: 'Abu Dhabi Commodities LLC' }, { id: 'CS-026', name: 'Berlin Organic Hub GmbH' },
  { id: 'CS-027', name: 'Delhi Distribution Center' }, { id: 'CS-028', name: 'Pune Agro Warehouse' },
  { id: 'CS-029', name: 'Nagpur Cold Storage Co.' },   { id: 'CS-030', name: 'Kolkata Grain Depot' },
  { id: 'CS-031', name: 'Chennai Health Foods' },      { id: 'CS-032', name: 'Kochi Coconut Distributors' },
  { id: 'CS-033', name: 'Hyderabad Rice Traders' },    { id: 'CS-034', name: 'Indore Millet Suppliers' },
  { id: 'CS-035', name: 'Ahmedabad Pulse Mart' },
];

/* Suppliers — concatenated material + logistics + service + WOS material/logistics
 * (matches the prototype's supplier roll-up of 46). Supplier scope maps txn →
 * supplier name by index; the code/procurement id are generated per row. */
export const SUPPLIERS: Party[] = [
  // Material (12)
  { id: 'S-001', name: 'Raipur Agro Supplies Pvt Ltd' }, { id: 'S-002', name: 'Nashik Fresh Produce Ltd' },
  { id: 'S-003', name: 'Punjab Grain Traders Co.' },     { id: 'S-004', name: 'Rajasthan Spice Exports' },
  { id: 'S-005', name: 'MP Pulses & Grains Pvt Ltd' },   { id: 'S-006', name: 'Kerala Coconut Industries' },
  { id: 'S-007', name: 'Haryana Basmati Millers' },      { id: 'S-008', name: 'Gujarat Organic Farms Pvt Ltd' },
  { id: 'S-009', name: 'Andhra Chilli & Spices Co.' },   { id: 'S-010', name: 'Tamil Nadu Oil Mills Ltd' },
  { id: 'S-011', name: 'UP Agri Processing Pvt Ltd' },   { id: 'S-012', name: 'Karnataka Horticulture Pvt Ltd' },
  // Logistics (8)
  { id: 'S-046', name: 'Maersk India Logistics Pvt Ltd' }, { id: 'S-047', name: 'Allcargo Logistics Ltd' },
  { id: 'S-048', name: 'TCI Freight Solutions' },          { id: 'S-049', name: 'Blue Dart Express Ltd' },
  { id: 'S-050', name: 'Container Corp of India' },        { id: 'S-051', name: 'Jeena & Company Pvt Ltd' },
  { id: 'S-052', name: 'Radhakrishna Foodland Pvt Ltd' },  { id: 'S-053', name: 'Navata Road Transport' },
  // Service (10)
  { id: 'S-021', name: 'SGS India Pvt Ltd' },             { id: 'S-022', name: 'Bureau Veritas India Pvt Ltd' },
  { id: 'S-023', name: 'Intertek India Pvt Ltd' },        { id: 'S-024', name: 'FSSAI Consultant Group' },
  { id: 'S-025', name: 'AgriCert India Pvt Ltd' },        { id: 'S-026', name: 'National Test House' },
  { id: 'S-027', name: 'APEDA Approved Surveyor Ltd' },   { id: 'S-028', name: 'TÜV Rheinland India Pvt Ltd' },
  { id: 'S-029', name: 'Spices Board Certified Labs' },   { id: 'S-030', name: 'IndiaFirst Legal & Compliance LLP' },
  // WOS Material (10)
  { id: 'S-031', name: 'Coimbatore Textile Mills Ltd' },  { id: 'S-032', name: 'Ludhiana Steel Fabricators' },
  { id: 'S-033', name: 'Pune Chemical Supplies Pvt Ltd' },{ id: 'S-034', name: 'Jaipur Craft & Packaging Co.' },
  { id: 'S-035', name: 'Hyderabad Lab Instruments Ltd' }, { id: 'S-041', name: 'Surat Fabric Exports Pvt Ltd' },
  { id: 'S-042', name: 'Bhopal Agri Input Suppliers' },   { id: 'S-045', name: 'Kochi Bio-Tech Solutions Ltd' },
  { id: 'S-054', name: 'Nagpur Orange Processing Co.' },  { id: 'S-055', name: 'Indore Grain Storage & Supply' },
  // WOS Logistics (6)
  { id: 'S-036', name: 'DHL Supply Chain India Pvt Ltd' },{ id: 'S-037', name: 'FedEx Express India Pvt Ltd' },
  { id: 'S-038', name: 'Safexpress Pvt Ltd' },            { id: 'S-039', name: 'GATI-KWE Pvt Ltd' },
  { id: 'S-040', name: 'Snowman Logistics Ltd' },         { id: 'S-043', name: 'V-Trans (India) Ltd' },
];

/* Without-Shipment supplier rosters per category. The WOS list maps each of
 * the 40 transactions to a supplier name by index (cycling the roster), and
 * generates the Procurement ID / Supplier Code from a per-category offset
 * (Service 0, Material 100, Logistics 200). */
export type WosScope = 'svc' | 'mat' | 'logi';
export const WOS_SUPPLIERS: Record<WosScope, string[]> = {
  svc: [
    'SGS India Pvt Ltd', 'Bureau Veritas India Pvt Ltd', 'Intertek India Pvt Ltd',
    'FSSAI Consultant Group', 'AgriCert India Pvt Ltd', 'National Test House',
    'APEDA Approved Surveyor Ltd', 'TÜV Rheinland India Pvt Ltd',
    'Spices Board Certified Labs', 'IndiaFirst Legal & Compliance LLP',
  ],
  mat: [
    'Coimbatore Textile Mills Ltd', 'Ludhiana Steel Fabricators', 'Pune Chemical Supplies Pvt Ltd',
    'Jaipur Craft & Packaging Co.', 'Hyderabad Lab Instruments Ltd', 'Surat Fabric Exports Pvt Ltd',
    'Bhopal Agri Input Suppliers', 'Kochi Bio-Tech Solutions Ltd', 'Nagpur Orange Processing Co.',
    'Indore Grain Storage & Supply',
  ],
  logi: [
    'DHL Supply Chain India Pvt Ltd', 'FedEx Express India Pvt Ltd', 'Safexpress Pvt Ltd',
    'GATI-KWE Pvt Ltd', 'Snowman Logistics Ltd', 'V-Trans (India) Ltd',
  ],
};
export const WOS_OFFSET: Record<WosScope, number> = { svc: 0, mat: 100, logi: 200 };

/* Party Overview panels (Buyer / Consignee / Supplier) — aggregate roll-ups
 * shown below the transactions table. These are fixed mock figures matching
 * the prototype; `pend` holds the per-document *pending* count (done = total
 * − pending). `geo` is omitted for suppliers (all domestic). */
export type PartyOverview = {
  noun: string;
  total: number;
  compliant: number;
  geo?: { intl: number; dom: number };
  pend: { kyc: number; dd: number; tl: number; td: number; agr: number };
};
export const BUYER_OVERVIEW: PartyOverview = {
  noun: 'Customers', total: 20, compliant: 4,
  geo: { intl: 10, dom: 10 },
  pend: { kyc: 5, dd: 8, tl: 10, td: 15, agr: 16 },
};
export const CONSIGNEE_OVERVIEW: PartyOverview = {
  noun: 'Consignees', total: 35, compliant: 6,
  geo: { intl: 25, dom: 10 },
  pend: { kyc: 11, dd: 15, tl: 21, td: 26, agr: 28 },
};
export const SUPPLIER_OVERVIEW: PartyOverview = {
  noun: 'Suppliers', total: 46, compliant: 16,
  // suppliers are all domestic — no geographic split
  pend: { kyc: 11, dd: 17, tl: 22, td: 28, agr: 29 },
};

/* Case-to-Case contracts — only the fields the header stats read. */
export type CtcLite = { status: 'signed' | 'inprogress' | 'rejected'; approval: 'approved' | 'pending' | 'rejected'; endDate: string };
export const CTC: CtcLite[] = [
  { status: 'signed',     approval: 'approved', endDate: '31 Dec 2026' },
  { status: 'inprogress', approval: 'pending',  endDate: '31 May 2027' },
  { status: 'inprogress', approval: 'approved', endDate: '14 Jun 2027' },
  { status: 'rejected',   approval: 'rejected', endDate: '30 Nov 2026' },
  { status: 'inprogress', approval: 'pending',  endDate: '30 Jun 2027' },
  { status: 'signed',     approval: 'approved', endDate: '31 Mar 2027' },
  { status: 'inprogress', approval: 'approved', endDate: '31 May 2028' },
  { status: 'inprogress', approval: 'pending',  endDate: '14 Jun 2027' },
  { status: 'inprogress', approval: 'pending',  endDate: '31 Jul 2031' },
  { status: 'rejected',   approval: 'rejected', endDate: '31 May 2027' },
  { status: 'signed',     approval: 'approved', endDate: '28 Feb 2027' },
  { status: 'inprogress', approval: 'approved', endDate: '30 Jun 2028' },
  { status: 'inprogress', approval: 'pending',  endDate: '31 May 2027' },
  { status: 'rejected',   approval: 'rejected', endDate: '30 Jun 2028' },
  { status: 'signed',     approval: 'approved', endDate: '31 Jan 2027' },
];

/* Contracts under clarification in the Agreements-To-Approve queue (5). */
export const ATA_CLARIFICATIONS = 5;

/* A doc obligation is "done" only when it has a non-zero total fully met. */
export const docDone = (o: DocProg): boolean => o.t > 0 && o.d >= o.t;
