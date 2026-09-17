/* ─────────────────────────────────────────────────────────────────────────
 * Order — Purchase Order list page (new build).
 *
 * Built from scratch against the Figma design. It does not import, reuse or
 * depend on the older purchase-order module in any way.
 *
 * Current stage: STEP 7 — status + action columns. Static design complete.
 * ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import WorklistPager from '../../../../components/ui/WorklistPager';

/* The five steps shown in the guide box.
 *
 * Kept as DATA rather than five hand-written cards. The markup for one card is
 * written once and repeated with .map(), so adding a sixth step, or changing
 * how every card looks, is a one-place change. */
type GuideStep = { num: string; title: string; desc: string; icon: ReactNode };

const iconProps = {
  width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const GUIDE_STEPS: GuideStep[] = [
  {
    num: 'Step 01',
    title: 'Link Supplier Details',
    desc: 'Link the supplier and verify their basic details.',
    icon: (
      <svg {...iconProps}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 11l-3 3-2-2" />
      </svg>
    ),
  },
  {
    num: 'Step 02',
    title: 'Product Details',
    desc: 'Add products with quantities and pricing.',
    icon: (
      <svg {...iconProps}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    num: 'Step 03',
    title: 'Terms & Conditions',
    desc: 'Define the rules and conditions for the order.',
    icon: (
      <svg {...iconProps}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    num: 'Step 04',
    title: 'Post-PO Trade Document Management',
    desc: 'Send for e-signature and track via Zoho Sign.',
    icon: (
      <svg {...iconProps}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    num: 'Step 05',
    title: 'Payment Management',
    desc: 'Complete payment and maintain records.',
    icon: (
      <svg {...iconProps}>
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
];

/* The four list tabs.
 *
 * TabKey is a TypeScript "union type": a value of this type can ONLY be one of
 * these four strings. Writing setActiveTab('withh') by mistake is caught while
 * you type, instead of silently selecting no tab at runtime. */
type TabKey = 'all' | 'with' | 'without' | 'cancelled';

type ListTab = { key: TabKey; label: string; danger?: boolean; icon: ReactNode };

const tabIconProps = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

/* No counts here: they are worked out from the rows (see tabCounts in the
   component), so a tab can never show a number that disagrees with its list. */
const LIST_TABS: ListTab[] = [
  {
    key: 'all', label: "All PO's",
    icon: (
      <svg {...tabIconProps}>
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  {
    key: 'with', label: 'With Shipment ID PO',
    icon: (
      <svg {...tabIconProps}>
        <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    key: 'without', label: "All Other PO's (Without Shipment ID)",
    icon: (
      <svg {...tabIconProps}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    key: 'cancelled', label: 'Cancelled PO', danger: true,
    icon: (
      <svg {...tabIconProps}>
        <circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * TABLE
 * ───────────────────────────────────────────────────────────────────────── */

/* The 21 columns, with their exact widths from the design (in px).
 *
 * groupEnd marks Balance Amount — the last column that describes the WHOLE
 * purchase order. Everything after it (SPI, GRN, QA) describes one invoice at
 * a time. A dashed line after that column shows where one kind of information
 * ends and the other begins. */
type Column = { label: string; width: number; groupEnd?: boolean };

const COLUMNS: Column[] = [
  { label: 'Sr. No',                     width: 44 },
  { label: 'PO Number',                  width: 150 },
  { label: 'PO Type',                    width: 132 },
  { label: 'Document Type',              width: 108 },
  { label: 'Shipment ID',                width: 112 },
  { label: 'Opportunity ID',             width: 112 },
  { label: 'Procurement ID',             width: 112 },
  { label: 'Supplier',                   width: 164 },
  { label: 'Risk Alert',                 width: 100 },
  { label: 'Expected Delivery Date',     width: 104 },
  { label: 'Total PO Amount',            width: 106 },
  { label: 'Net Payable Amount',         width: 112 },
  { label: 'Total Paid Amount',          width: 110 },
  { label: 'Balance Amount',             width: 106, groupEnd: true },
  { label: "Mapped SPI's",               width: 188 },
  { label: "GRN ID's",                   width: 158 },
  { label: "QA ID's",                    width: 158 },
  { label: 'Zohobook Status',            width: 134 },
  { label: 'Physical Inspection Status', width: 190 },
  { label: 'Payment Progress Status',    width: 246 },
  { label: 'Action',                     width: 360 },
];

/* The table is exactly as wide as its columns added together (3006px).
 * reduce() walks the array and keeps a running total, starting from 0. */
const TABLE_WIDTH = COLUMNS.reduce((total, col) => total + col.width, 0);

/* How the documents chain together:
 *   1 PO  →  many SPIs (supplier invoices)
 *   1 SPI →  exactly 1 GRN (goods received)  →  exactly 1 QA (quality check)
 * Because SPI, GRN and QA are always one-to-one, they travel together as ONE
 * object. A PO holds a list of these. */
type PaymentStatus = 'full' | 'partial' | 'pending';

type InvoiceLine = {
  spi: string; spiDate: string;
  amount: number; paid: number; due: number; status: PaymentStatus;
  grn: string; grnDate: string;
  qa: string; qaDate: string;
};

/* One purchase order. Real rows will come from the API later; the shape
 * stays the same. shipment is "string | null" because a PO raised without a
 * shipment has no Shipment ID — the type forces us to handle that case. */
/* Fixed sets of allowed values. A union type like 'ffd' | 'services' means
 * TypeScript rejects any other string, so a typo such as 'service' is caught
 * while writing the data, not discovered later as a wrongly coloured pill. */
type PoType = 'materials' | 'ffd' | 'services';
type DocType = 'International' | 'Domestics';
type SupplierCategory = 'star' | 'regular' | 'high' | 'blacklisted';
type RiskLevel = 'high' | 'medium' | 'low';

/* A note under the payment bar. "?" on the field in OrderRow means a PO may
 * have no note at all. */
type PaymentNote = { kind: 'ready' | 'waiting'; amount: number };

type OrderRow = {
  po: string; poDate: string; physicalInspection: boolean;
  type: PoType; docType: DocType;
  shipment: string | null; shipmentDate: string;
  opportunity: string; opportunityDate: string;
  procurement: string; procurementDate: string;
  supplier: string; supplierCategory: SupplierCategory;
  risk: RiskLevel;
  expectedDelivery: string;
  total: number; net: number; paid: number; balance: number;
  invoices: InvoiceLine[];
  zohoSynced: boolean;        // pushed to Zohobook yet?
  inspectionDone: boolean;    // only matters when physicalInspection is true
  paymentRequests: number;    // how many payment requests were raised
  paymentNote?: PaymentNote;  // optional
  cancelled?: boolean;        // optional; missing means "not cancelled"
};

/* LOOKUP TABLES — data describes WHAT a row is ('ffd', 'low'); these tables
 * say how each value LOOKS (label, colour class, icon). The JSX just reads
 * from them, so it needs no if/else chains, and adding a new variant means
 * adding one line here. */
const PO_TYPE: Record<PoType, { label: string; icon: ReactNode }> = {
  materials: {
    label: 'Material / Goods',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  ffd: {
    label: 'FFD / Transporter',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  services: {
    label: 'Services',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
};

const ICON_WARN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const ICON_CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const ICON_CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
  </svg>
);

const SUPPLIER_CATEGORY: Record<SupplierCategory, { label: string; tone: string; icon: ReactNode }> = {
  star: {
    label: 'Star Supplier', tone: 'gold',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95z" />
      </svg>
    ),
  },
  regular: { label: 'Regular Supplier', tone: 'blue', icon: ICON_CHECK },
  high: { label: 'High Risk Supplier', tone: 'red', icon: ICON_WARN },
  blacklisted: {
    label: 'Blacklisted Supplier', tone: 'dark',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
      </svg>
    ),
  },
};

const RISK_LEVEL: Record<RiskLevel, { label: string; tone: string; icon: ReactNode }> = {
  high: { label: 'High', tone: 'red', icon: ICON_WARN },
  medium: { label: 'Medium', tone: 'amber', icon: ICON_CLOCK },
  low: { label: 'Low', tone: 'green', icon: ICON_CHECK },
};

/* Six POs from the design, picked so every style appears at least once:
 *   049  International, High risk, 1 invoice, part paid
 *   008  no Shipment ID, 2 invoices, nothing paid, Not Sync
 *   054  FFD / Transporter, fully paid (100%)
 *   014  Regular supplier, Low risk, Not Applicable inspection
 *   001  Star supplier, payment awaiting approval
 *   015  Services, 3 invoices, approved and ready to pay */
const SAMPLE_ROWS: OrderRow[] = [
  {
    po: 'PO/2025-26/049', poDate: '2026-03-03', physicalInspection: true,
    type: 'materials', docType: 'International',
    shipment: 'SHP-086', shipmentDate: '2026-02-19',
    opportunity: 'OPP-060', opportunityDate: '2026-01-22',
    procurement: 'PROC-077', procurementDate: '2026-02-06',
    supplier: 'Adani Enterprises', supplierCategory: 'high',
    risk: 'high',
    expectedDelivery: '2026-04-20',
    total: 259500, net: 259500, paid: 129800, balance: 129700,
    invoices: [
      {
        spi: 'SPI/2025-26/051', spiDate: '10 Mar 2026',
        amount: 259500, paid: 129800, due: 129700, status: 'partial',
        grn: 'GRN-051', grnDate: '14 Mar 2026',
        qa: 'QA-051', qaDate: '16 Mar 2026',
      },
    ],
    zohoSynced: true, inspectionDone: true, paymentRequests: 2,
  },
  {
    po: 'PO/2025-26/008', poDate: '2026-06-20', physicalInspection: true,
    type: 'materials', docType: 'International',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-012', opportunityDate: '2026-05-11',
    procurement: 'PROC-016', procurementDate: '2026-05-26',
    supplier: 'Adani Enterprises', supplierCategory: 'high',
    risk: 'high',
    expectedDelivery: '2026-07-28',
    total: 261000, net: 258400, paid: 0, balance: 258400,
    invoices: [
      {
        spi: 'SPI/2025-26/025', spiDate: '27 Jun 2026',
        amount: 129200, paid: 0, due: 129200, status: 'pending',
        grn: 'GRN-025', grnDate: '01 Jul 2026',
        qa: 'QA-025', qaDate: '03 Jul 2026',
      },
      {
        spi: 'SPI/2025-26/026', spiDate: '06 Jul 2026',
        amount: 129200, paid: 0, due: 129200, status: 'pending',
        grn: 'GRN-026', grnDate: '10 Jul 2026',
        qa: 'QA-026', qaDate: '12 Jul 2026',
      },
    ],
    zohoSynced: false, inspectionDone: false, paymentRequests: 0,
  },
  {
    po: 'PO/2025-26/054', poDate: '2026-04-16', physicalInspection: true,
    type: 'ffd', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-065', opportunityDate: '2026-03-07',
    procurement: 'PROC-082', procurementDate: '2026-03-22',
    supplier: 'Adani Enterprises', supplierCategory: 'high',
    risk: 'high',
    expectedDelivery: '2026-05-22',
    total: 104500, net: 102400, paid: 102400, balance: 0,
    invoices: [
      {
        spi: 'SPI/2025-26/066', spiDate: '23 Apr 2026',
        amount: 102400, paid: 102400, due: 0, status: 'full',
        grn: 'GRN-066', grnDate: '27 Apr 2026',
        qa: 'QA-066', qaDate: '29 Apr 2026',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
  },
  {
    po: 'PO/2025-26/014', poDate: '2026-05-30', physicalInspection: false,
    type: 'materials', docType: 'Domestics',
    shipment: 'SHP-034', shipmentDate: '2026-05-18',
    opportunity: 'OPP-019', opportunityDate: '2026-04-20',
    procurement: 'PROC-026', procurementDate: '2026-05-05',
    supplier: 'Bharat Forge', supplierCategory: 'regular',
    risk: 'low',
    expectedDelivery: '2026-07-09',
    total: 252500, net: 247400, paid: 247400, balance: 0,
    invoices: [
      {
        spi: 'SPI/2025-26/043', spiDate: '06 Jun 2026',
        amount: 247400, paid: 247400, due: 0, status: 'full',
        grn: 'GRN-043', grnDate: '10 Jun 2026',
        qa: 'QA-043', qaDate: '12 Jun 2026',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 2,
  },
  {
    po: 'PO/2025-26/001', poDate: '2026-06-19', physicalInspection: true,
    type: 'materials', docType: 'Domestics',
    shipment: 'SHP-001', shipmentDate: '2026-06-07',
    opportunity: 'OPP-001', opportunityDate: '2026-05-10',
    procurement: 'PROC-001', procurementDate: '2026-05-25',
    supplier: 'Reliance Industries', supplierCategory: 'star',
    risk: 'low',
    expectedDelivery: '2026-07-05',
    total: 259500, net: 249100, paid: 62300, balance: 186800,
    invoices: [
      {
        spi: 'SPI/2025-26/004', spiDate: '26 Jun 2026',
        amount: 124600, paid: 62300, due: 62300, status: 'partial',
        grn: 'GRN-004', grnDate: '30 Jun 2026',
        qa: 'QA-004', qaDate: '02 Jul 2026',
      },
      {
        spi: 'SPI/2025-26/005', spiDate: '05 Jul 2026',
        amount: 124500, paid: 0, due: 124500, status: 'pending',
        grn: 'GRN-005', grnDate: '09 Jul 2026',
        qa: 'QA-005', qaDate: '11 Jul 2026',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 2,
    paymentNote: { kind: 'waiting', amount: 143800 },
  },
  {
    po: 'PO/2025-26/015', poDate: '2026-06-11', physicalInspection: false,
    type: 'services', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-021', opportunityDate: '2026-05-02',
    procurement: 'PROC-028', procurementDate: '2026-05-17',
    supplier: 'Infosys Ltd', supplierCategory: 'regular',
    risk: 'low',
    expectedDelivery: '2026-07-19',
    total: 132500, net: 128500, paid: 0, balance: 128500,
    invoices: [
      {
        spi: 'SPI/2025-26/046', spiDate: '18 Jun 2026',
        amount: 42800, paid: 0, due: 42800, status: 'pending',
        grn: 'GRN-046', grnDate: '22 Jun 2026',
        qa: 'QA-046', qaDate: '24 Jun 2026',
      },
      {
        spi: 'SPI/2025-26/047', spiDate: '27 Jun 2026',
        amount: 42800, paid: 0, due: 42800, status: 'pending',
        grn: 'GRN-047', grnDate: '01 Jul 2026',
        qa: 'QA-047', qaDate: '03 Jul 2026',
      },
      {
        spi: 'SPI/2025-26/048', spiDate: '06 Jul 2026',
        amount: 42900, paid: 0, due: 42900, status: 'pending',
        grn: 'GRN-048', grnDate: '10 Jul 2026',
        qa: 'QA-048', qaDate: '12 Jul 2026',
      },
    ],
    zohoSynced: false, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'ready', amount: 69400 },
  },
];

/* Label for each payment state. Record<PaymentStatus, string> means "an object
 * with exactly one entry per status" — forget one and TypeScript complains. */
const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  full: 'Fully Paid',
  partial: 'Partially Paid',
  pending: 'Payment Not Initiated',
};

/* "SPI/2025-26/051" → "051". The regex (\d+)$ grabs the digits at the END.
 * ?.[1] reads the captured group only if there was a match; ?? falls back to
 * the whole id when there wasn't. */
const seqOf = (id: string) => id.match(/(\d+)$/)?.[1] ?? id;

/* 259500 → "₹2,59,500".
 * 'en-IN' groups digits the Indian way (lakh, crore), not 259,500. */
const formatMoney = (value: number) => '₹' + value.toLocaleString('en-IN');

/* An ID pill with a date underneath — used by PO Number, Shipment,
 * Opportunity and Procurement. A small component, so the four columns
 * cannot drift apart in how they look. */
function IdCell({ id, date }: { id: string; date: string }) {
  return (
    <div className="ord-idcell">
      <span className="ord-idpill">{id}</span>
      <span className="ord-idcell__date">{date}</span>
    </div>
  );
}

/* A PO-level cell: it stretches down across ALL of the PO's invoice rows.
 *
 * rowSpan={3} tells the browser "this cell is 3 rows tall". The next 2 rows
 * must then SKIP this column — otherwise they would have one cell too many
 * and every column after it would shift right.
 *
 * children is whatever you put between <PoCell> and </PoCell>. */
function PoCell({ span, groupEnd, children }: { span: number; groupEnd?: boolean; children: ReactNode }) {
  const className = groupEnd ? 'ord-po-cell ord-table__group-end' : 'ord-po-cell';
  return <td rowSpan={span} className={className}>{children}</td>;
}

/* The small grey "SPI 1/2" chip plus the ID pill — the top line of every
 * SPI, GRN and QA card. */
function DocTop({ label, index, count, id }: { label: string; index: number; count: number; id: string }) {
  return (
    <div className="ord-doc__top">
      <span className="ord-doc__seq">{label} {index + 1}/{count}</span>
      <span className="ord-idpill">{id}</span>
    </div>
  );
}

/* The three cards for ONE invoice line: SPI, then its GRN, then its QA.
 * It returns three <td>s wrapped in <>...</> (a Fragment). A component must
 * return one thing; a Fragment groups siblings without adding an extra tag,
 * which matters here — a <div> between <tr> and <td> is invalid HTML. */
function InvoiceCells({ line, index, count }: { line: InvoiceLine; index: number; count: number }) {
  return (
    <>
      <td className="ord-doc ord-doc--spi">
        <div className="ord-doc__card">
          <DocTop label="SPI" index={index} count={count} id={line.spi} />
          <div className="ord-doc__meta">
            <span className="ord-doc__money">{formatMoney(line.amount)}</span>
            <span className="ord-doc__dot">·</span>
            <span>{line.spiDate}</span>
          </div>
          <div className="ord-doc__foot">
            <span className={`ord-pill ord-pill--${line.status}`}>
              <span className="ord-pill__dot" />{PAYMENT_LABEL[line.status]}
            </span>
            <span className="ord-doc__sub">
              <b className="ord-doc__paid">{formatMoney(line.paid)}</b> paid ·{' '}
              <b className="ord-doc__due">{formatMoney(line.due)}</b> due
            </span>
          </div>
        </div>
      </td>

      <td className="ord-doc ord-doc--grn">
        <div className="ord-doc__card">
          <DocTop label="GRN" index={index} count={count} id={line.grn} />
          <div className="ord-doc__meta">
            <span>Received</span>
            <span className="ord-doc__dot">·</span>
            <span>{line.grnDate}</span>
          </div>
          <div className="ord-doc__foot">
            <span className="ord-pill ord-pill--received"><span className="ord-pill__dot" />Goods Received</span>
            <span className="ord-doc__sub">Against {seqOf(line.spi)}</span>
          </div>
        </div>
      </td>

      <td className="ord-doc ord-doc--qa">
        <div className="ord-doc__card">
          <DocTop label="QA" index={index} count={count} id={line.qa} />
          <div className="ord-doc__meta">
            <span>Inspected</span>
            <span className="ord-doc__dot">·</span>
            <span>{line.qaDate}</span>
          </div>
          <div className="ord-doc__foot">
            <span className="ord-pill ord-pill--qa"><span className="ord-pill__dot" />QA Passed</span>
            <span className="ord-doc__sub">Against {seqOf(line.grn)}</span>
          </div>
        </div>
      </td>
    </>
  );
}

/* ── Icons for the status and action buttons ──
 * Stored as JSX in constants: an icon never changes, so there is no reason
 * to rebuild it inside a component on every render. */
const btnIconProps = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_SYNC = (
  <svg {...btnIconProps}>
    <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
    <polyline points="21 3 18.7 6 15.6 5.4" /><polyline points="3 21 5.3 18 8.4 18.6" />
  </svg>
);
const ICON_EYE = (
  <svg {...btnIconProps}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_TICK = (
  <svg {...btnIconProps} strokeWidth={2.8}><path d="M20 6 9 17l-5-5" /></svg>
);
const ICON_HISTORY = (
  <svg {...btnIconProps}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 7.5 12 12 15 13.6" />
  </svg>
);
const ICON_CANCEL = (
  <svg {...btnIconProps} strokeWidth={2.3}>
    <circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);
const ICON_EDIT = (
  <svg {...btnIconProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
);
const ICON_VAULT = (
  <svg {...btnIconProps} strokeWidth={2.1}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
  </svg>
);

/* 18 · Zohobook Status
 * Not synced → the red pill AND the button that syncs it.
 * Synced     → the green pill alone. The button would only repeat the pill. */
function ZohoCell({ synced }: { synced: boolean }) {
  if (synced) {
    return (
      <div className="ord-statcell">
        <span className="ord-status ord-status--ok"><span className="ord-status__dot" />Synced</span>
      </div>
    );
  }
  return (
    <div className="ord-statcell">
      <span className="ord-status ord-status--bad"><span className="ord-status__dot" />Not Sync</span>
      <button type="button" className="ord-btn ord-btn--zoho">{ICON_SYNC}<span>Zoho Sync</span></button>
    </div>
  );
}

/* 19 · Physical Inspection Status — THREE states, so an early return for the
 * simplest one keeps the rest easy to read. */
function InspectionCell({ required, done }: { required: boolean; done: boolean }) {
  if (!required) {
    return (
      <div className="ord-statcell">
        <span className="ord-status ord-status--na"><span className="ord-status__dot" />Not Applicable</span>
      </div>
    );
  }
  return (
    <div className="ord-statcell">
      {done
        ? <span className="ord-status ord-status--ok"><span className="ord-status__dot" />Completed</span>
        : <span className="ord-status ord-status--bad"><span className="ord-status__dot" />Pending</span>}
      <button type="button" className={`ord-btn ord-btn--insp${done ? ' is-done' : ''}`}>
        {done ? ICON_TICK : ICON_EYE}
        <span>{done ? 'Inspection Done' : 'Physical Inspection'}</span>
      </button>
    </div>
  );
}

/* 20 · Payment Progress Status
 * The percentage is DERIVED from paid and net, not stored. If it were stored
 * separately it could disagree with the amounts; calculated, it never can. */
function PaymentCell({ row }: { row: OrderRow }) {
  const pct = row.net > 0 ? Math.round((row.paid / row.net) * 100) : 0;
  const status: PaymentStatus = pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'pending';
  const label = status === 'full' ? 'Payment Completed' : PAYMENT_LABEL[status];
  const done = status === 'full';
  const isReady = row.paymentNote?.kind === 'ready';
  // Built once here, used twice below (the visible text and the hover title).
  const noteText = !row.paymentNote ? ''
    : row.paymentNote.kind === 'ready'
      ? `${formatMoney(row.paymentNote.amount)} approved · ready to pay`
      : `${formatMoney(row.paymentNote.amount)} awaiting approval`;

  return (
    <div className="ord-paycell">
      {/* The state class on the wrapper (is-full / is-partial / is-pending)
          recolours the %, the bar and the captions all at once. */}
      <div className={`ord-progress is-${status}`}>
        <div className="ord-progress__top">
          <span className={`ord-pill ord-pill--${status}`}><span className="ord-pill__dot" />{label}</span>
          <span className="ord-progress__pct">{pct}%</span>
        </div>
        <div className="ord-progress__bar">
          {/* Inline style because the width comes from data. */}
          <div className="ord-progress__fill" style={{ width: `${pct}%` }}>
            <span className="ord-progress__sheen" />
          </div>
        </div>
        <div className="ord-progress__meta">
          <span className="ord-progress__paid"><span className="ord-progress__mdot" />{formatMoney(row.paid)} paid</span>
          <span className="ord-progress__due"><span className="ord-progress__mdot" />{formatMoney(row.balance)} due</span>
        </div>

        {/* Optional note. row.paymentNote && (...) renders nothing when the
            PO has no note, because paymentNote is then undefined. */}
        {row.paymentNote && (
          <span
            className={`ord-paynote ord-paynote--${row.paymentNote.kind}`}
            title={noteText}
          >
            {row.paymentNote.kind === 'ready' ? ICON_TICK : ICON_CLOCK}
            {noteText}
          </span>
        )}
      </div>

      <button type="button" className={`ord-btn ord-btn--hist${done ? ' is-record' : ''}`}>
        {done ? ICON_EYE : ICON_HISTORY}
        <span>{done ? 'View Request Details' : 'Manage Payment Requests'}</span>
        {/* Show the count badge only when there is something to count.
            It turns green when approved money is ready to pay. */}
        {row.paymentRequests > 0 && (
          <i className={`ord-btn__count${isReady ? ' ord-btn__count--ready' : ''}`}>{row.paymentRequests}</i>
        )}
      </button>
    </div>
  );
}

/* 21 · Action — the three document actions on one row. */
function ActionCell() {
  return (
    <div className="ord-actions">
      <button type="button" className="ord-btn ord-btn--cancel">{ICON_CANCEL}<span>Cancel PO</span></button>
      <button type="button" className="ord-btn ord-btn--edit">{ICON_EDIT}<span>Edit PO</span></button>
      <button type="button" className="ord-btn ord-btn--vault">{ICON_VAULT}<span>Evidence Vault</span></button>
    </div>
  );
}

/* ── Filtering ──
 * Plain functions outside the component: they only take data and return an
 * answer, with no state or hooks, so they don't need to live inside it. */

/* Which rows belong to a tab. */
function inTab(row: OrderRow, tab: TabKey): boolean {
  if (tab === 'with') return row.shipment !== null;
  if (tab === 'without') return row.shipment === null;
  if (tab === 'cancelled') return !!row.cancelled;   // !! turns undefined into false
  return true;                                       // 'all'
}

/* Everything a user might type to find a PO, joined into one lowercase string.
 * It uses the LABELS people see ("Regular Supplier", "FFD / Transporter"),
 * not the internal keys ('regular', 'ffd'), because users search for what is
 * on screen. flatMap turns each invoice into its three IDs (SPI, GRN, QA) and
 * flattens them into the same list. */
function searchTextOf(row: OrderRow): string {
  return [
    row.po, row.poDate,
    PO_TYPE[row.type].label, row.docType,
    row.shipment ?? '', row.opportunity, row.procurement,
    row.supplier, SUPPLIER_CATEGORY[row.supplierCategory].label,
    RISK_LEVEL[row.risk].label, row.expectedDelivery,
    row.zohoSynced ? 'Synced' : 'Not Sync',
    ...row.invoices.flatMap((line) => [line.spi, line.grn, line.qa]),
  ].join(' ').toLowerCase();
}

/* ── Pagination ──
 * The footer itself is the app's shared WorklistPager component, so this page
 * pages exactly like Suppliers and the CLM lists. Only the numbers live here. */
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;   // as in the design

/* ── Phone detection ──
 * A CUSTOM HOOK: a function whose name starts with "use" and that uses other
 * hooks inside. It packages reusable logic; any component can call it.
 *
 * window.matchMedia runs the same test as a CSS media query, from JavaScript.
 * - useState(() => ...) reads the answer once, before the first render, so a
 *   phone gets the card view immediately (no flash of the table first).
 * - useEffect subscribes to changes (rotating the phone, resizing a window)
 *   and the returned function unsubscribes when the page is left. */
const PHONE_QUERY = '(max-width: 768px)';

function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isPhone;
}

/* ── One PO as a card (phones) ──
 * The same information as one table row, stacked top to bottom. It REUSES
 * the table's pieces (IdCell, badges, ZohoCell, PaymentCell, ActionCell…), so
 * the card and the table always show the same thing in the same colours. */
function OrderCard({ row, index }: { row: OrderRow; index: number }) {
  const category = SUPPLIER_CATEGORY[row.supplierCategory];
  const risk = RISK_LEVEL[row.risk];
  const count = row.invoices.length;

  return (
    <article className="ord-card">
      {/* Top: number, PO, type */}
      <div className="ord-card__head">
        <span className="ord-srnum">{index + 1}</span>
        <div className="ord-card__po">
          <span className="ord-idpill">{row.po}</span>
          <span className="ord-idcell__date">{row.poDate}</span>
        </div>
        <span className={`ord-typepill ord-typepill--${row.type}`}>
          <span className="ord-typepill__ico">{PO_TYPE[row.type].icon}</span>
          {PO_TYPE[row.type].label}
        </span>
      </div>

      <div className="ord-card__tags">
        <span className={`ord-doctype ord-doctype--${row.docType === 'International' ? 'intl' : 'dom'}`}>{row.docType}</span>
        {row.physicalInspection && (
          <span className="ord-badge ord-badge--red ord-physinsp">{ICON_WARN}Physical Inspection</span>
        )}
      </div>

      {/* Supplier on the left, risk on the right */}
      <div className="ord-card__split">
        <div className="ord-card__block">
          <span className="ord-card__label">Supplier</span>
          <span className="ord-supplier__name">{row.supplier}</span>
          <span className={`ord-badge ord-badge--${category.tone} ord-supplier__cat`}>{category.icon}{category.label}</span>
        </div>
        <div className="ord-card__block ord-card__block--end">
          <span className="ord-card__label">Risk Alert</span>
          <span className={`ord-badge ord-badge--${risk.tone} ord-risk`}>{risk.icon}{risk.label}</span>
        </div>
      </div>

      {/* <dl> is HTML's list of label/value pairs: <dt> = label, <dd> = value. */}
      <dl className="ord-card__grid">
        <div>
          <dt>Shipment ID</dt>
          <dd>{row.shipment ? <IdCell id={row.shipment} date={row.shipmentDate} /> : <span className="ord-dash">—</span>}</dd>
        </div>
        <div><dt>Opportunity ID</dt><dd><IdCell id={row.opportunity} date={row.opportunityDate} /></dd></div>
        <div><dt>Procurement ID</dt><dd><IdCell id={row.procurement} date={row.procurementDate} /></dd></div>
        <div><dt>Expected Delivery</dt><dd><span className="ord-edd">{row.expectedDelivery}</span></dd></div>
      </dl>

      <dl className="ord-card__grid">
        <div><dt>Total PO Amount</dt><dd><span className="ord-amt">{formatMoney(row.total)}</span></dd></div>
        <div><dt>Net Payable</dt><dd><span className="ord-amt ord-amt--net">{formatMoney(row.net)}</span></dd></div>
        <div><dt>Total Paid</dt><dd><span className="ord-amt ord-amt--paid">{formatMoney(row.paid)}</span></dd></div>
        <div><dt>Balance</dt><dd><span className="ord-amt ord-amt--bal">{formatMoney(row.balance)}</span></dd></div>
      </dl>

      {/* Each invoice: its SPI card, then the GRN and QA that belong to it. */}
      <div className="ord-card__section">
        <span className="ord-card__label">Mapped SPI / GRN / QA ({count})</span>
        {count === 0 && <span className="ord-dash">—</span>}
        {row.invoices.map((line, i) => (
          <div className="ord-card__invoice" key={line.spi}>
            <DocTop label="SPI" index={i} count={count} id={line.spi} />
            <div className="ord-doc__meta">
              <span className="ord-doc__money">{formatMoney(line.amount)}</span>
              <span className="ord-doc__dot">·</span>
              <span>{line.spiDate}</span>
            </div>
            <div className="ord-doc__foot">
              <span className={`ord-pill ord-pill--${line.status}`}><span className="ord-pill__dot" />{PAYMENT_LABEL[line.status]}</span>
              <span className="ord-doc__sub">
                <b className="ord-doc__paid">{formatMoney(line.paid)}</b> paid · <b className="ord-doc__due">{formatMoney(line.due)}</b> due
              </span>
            </div>
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.grn}</span>
              <span className="ord-doc__sub">Received · {line.grnDate}</span>
              <span className="ord-pill ord-pill--received"><span className="ord-pill__dot" />Goods Received</span>
            </div>
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.qa}</span>
              <span className="ord-doc__sub">Inspected · {line.qaDate}</span>
              <span className="ord-pill ord-pill--qa"><span className="ord-pill__dot" />QA Passed</span>
            </div>
          </div>
        ))}
      </div>

      <div className="ord-card__status">
        <div className="ord-card__block">
          <span className="ord-card__label">Zohobook Status</span>
          <ZohoCell synced={row.zohoSynced} />
        </div>
        <div className="ord-card__block">
          <span className="ord-card__label">Physical Inspection</span>
          <InspectionCell required={row.physicalInspection} done={row.inspectionDone} />
        </div>
      </div>

      <div className="ord-card__section">
        <span className="ord-card__label">Payment Progress</span>
        <PaymentCell row={row} />
      </div>

      <ActionCell />
    </article>
  );
}

export default function Order() {
  /* STATE — whether the guide box is open.
   *
   * useState returns two things: the current value, and a function to change
   * it. Calling setGuideOpen() tells React the value changed, and React draws
   * the component again with the new value. Starts CLOSED, so the PO list
   * gets the most room; the user opens it with the arrow when needed. */
  const [guideOpen, setGuideOpen] = useState(false);

  const toggleGuide = () => setGuideOpen((open) => !open);

  /* STATE — which tab is selected. Typed as TabKey, so only the four real
     tab names are accepted. Starts on "all", as in the design. */
  const [activeTab, setActiveTab] = useState<TabKey>('all');

  /* STATE — what is typed in the search box. */
  const [search, setSearch] = useState('');

  /* true on phone-width screens → render cards instead of the wide table. */
  const isPhone = useIsPhone();

  /* PAGINATION
   * Only the page NUMBER is state. Everything else is DERIVED from it on each
   * render: how many pages exist, where this page starts, which rows show.
   * Storing those too would risk them disagreeing with the page number. */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  /* FILTERING — tab first, then search.
   *
   * useMemo(() => work, [inputs]) remembers the result and redoes the work
   * ONLY when one of the inputs changes. Changing page or hovering a row
   * re-renders the component, but the filtered list is reused as-is.
   *
   * .trim() ignores spaces typed before/after; toLowerCase() on both sides
   * makes "adani" find "Adani Enterprises". */
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return SAMPLE_ROWS
      .filter((row) => inTab(row, activeTab))
      .filter((row) => term === '' || searchTextOf(row).includes(term));
  }, [activeTab, search]);

  /* Tab counts, worked out from the rows. They ignore the search on purpose,
   * so each tab keeps showing how many POs it holds in total. */
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { all: 0, with: 0, without: 0, cancelled: 0 };
    for (const row of SAMPLE_ROWS) {
      for (const tab of LIST_TABS) {
        if (inTab(row, tab.key)) counts[tab.key] += 1;
      }
    }
    return counts;
  }, []);

  const start = (page - 1) * pageSize;                 // page 2 of 10 → starts at 10
  const pageRows = rows.slice(start, start + pageSize); // slice(10, 20) → rows 11–20

  /* The list scrolls inside its card, so after any change of what is shown we
   * jump back to the top of the list — otherwise page 2 would open halfway
   * down. The "?." skips the call when that view is not on screen. */
  const cardsRef = useRef<HTMLDivElement>(null);
  const scrollListToTop = () => {
    scrollRef.current?.scrollTo({ top: 0 });
    cardsRef.current?.scrollTo({ top: 0 });
  };

  const goToPage = (next: number) => {
    setPage(next);
    scrollListToTop();
  };

  /* Every change that alters WHICH rows are listed goes back to page 1.
   * Example: on page 3, searching "infosys" leaves 1 result — page 3 of that
   * would be empty. That's why these handlers reset the page themselves,
   * right where the change happens. */
  const selectTab = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
    scrollListToTop();
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    scrollListToTop();
  };
  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
    scrollListToTop();
  };

  /* SMOOTH SCROLLING — switch hover effects off while the table is scrolling.
   *
   * During a sideways scroll the buttons slide under a still mouse pointer.
   * Each one it touches starts its hover animation (filter, lift, shadow),
   * which makes the browser repaint while it is also scrolling: that's the lag.
   * So while scrolling we add "is-scrolling" to the wrapper (CSS then ignores
   * the mouse), and remove it 150ms after the last scroll event.
   *
   * Why useRef and NOT useState? A scroll fires dozens of events per second.
   * Setting state would re-render the whole table on every one of them.
   * A ref is a box React does not watch: changing it causes no re-render.
   *   scrollRef   → the wrapper <div> itself, so we can toggle its class
   *   scrollTimer → the id of the pending "scrolling has stopped" timer */
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<number | undefined>(undefined);

  const onTableScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.add('is-scrolling');
    // Each new scroll event cancels the previous timer and starts a fresh one,
    // so the class is removed only once scrolling has really stopped.
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 150);
  };

  /* Cleanup: if the user leaves the page mid-scroll, cancel the pending timer
   * so it does not run against a table that no longer exists. The function
   * returned from useEffect runs when the component unmounts. */
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);

  /* The header behaves like a button, so it must also work from the keyboard:
     Enter or Space toggles it, the same as a real button. */
  const onGuideKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();          // stop Space from scrolling the page
      toggleGuide();
    }
  };

  return (
    <div className="ord-page">
      {/* The styles live with the component, so this page carries everything
          it needs and never depends on another module's stylesheet. */}
      <style>{ORDER_CSS}</style>

      {/* ── SECTION A · Header strip ─────────────────────────────────── */}
      <div className="ord-strip">
        {/* Three decorative layers, drawn behind the content:
            accent = teal bar down the left edge
            glow   = soft coloured light at both ends
            sheen  = white highlight across the top half */}
        <span className="ord-strip__accent" />
        <span className="ord-strip__glow" />
        <span className="ord-strip__sheen" />

        <div className="ord-strip__left">
          <div className="ord-strip__avatar-wrap">
            <div className="ord-strip__avatar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
            </div>
            <span className="ord-strip__online-dot" />
          </div>
          <div>
            <div className="ord-strip__title">Purchase Order (PO)</div>
            <div className="ord-strip__sub">
              Create and manage purchase orders to suppliers — from PO generation to e-signed documents and payment.
            </div>
          </div>
        </div>

        <div className="ord-strip__right">
          {/* No onClick yet: this is the design phase. The button will open
              the create form once we build that screen. */}
          <button type="button" className="ord-strip__btn">
            <span className="ord-strip__btn-sheen" />
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create PO
          </button>
        </div>
      </div>

      {/* ── SECTION B · What We Are Doing Here ──────────────────────── */}
      {/* The class is built from state. When guideOpen is false the box gets
          "is-collapsed", and the CSS for that class closes the body. */}
      <div className={`ord-guide${guideOpen ? '' : ' is-collapsed'}`}>
        <div
          className="ord-guide__header"
          role="button"
          tabIndex={0}
          aria-expanded={guideOpen}
          onClick={toggleGuide}
          onKeyDown={onGuideKey}
        >
          <div className="ord-guide__header-ico">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>

          <div className="ord-guide__header-mid">
            <div className="ord-guide__header-row">
              <div className="ord-guide__header-label">Purchase Order</div>
              <div className="ord-guide__header-sep" />
              <div className="ord-guide__header-title">What We Are Doing Here</div>
            </div>
            <div className="ord-guide__header-sub">
              Link the supplier, add products and terms, manage post-PO trade documents with e-signature, and complete payment — end to end in one place.
            </div>
          </div>

          <div className="ord-guide__toggle">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <div className="ord-guide__body">
          {/* One card's markup, repeated once per step.
              key tells React which card is which, so it can update the right
              one when the list changes. It must be unique within the list. */}
          {GUIDE_STEPS.map((step) => (
            <div className="ord-guide__item" key={step.num}>
              <div className="ord-guide__item-top">
                <div className="ord-guide__item-ico">{step.icon}</div>
                <span className="ord-guide__item-num">{step.num}</span>
              </div>
              <div className="ord-guide__item-title">{step.title}</div>
              <div className="ord-guide__item-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION C · PO list ─────────────────────────────────────── */}
      {/* One white card holds the toolbar now and the table in the next step. */}
      <div className="ord-list">
        <div className="ord-list__top">

          {/* role="tablist" / role="tab" / aria-selected tell screen readers
              these buttons are a set of tabs and which one is chosen. */}
          <div className="ord-tabs" role="tablist" aria-label="Purchase order views">
            {LIST_TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              const classes = [
                'ord-tabs__tab',
                tab.danger ? 'ord-tabs__tab--danger' : '',
                isActive ? 'is-active' : '',
              ].filter(Boolean).join(' ');

              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={classes}
                  onClick={() => selectTab(tab.key)}
                >
                  {tab.icon}
                  {tab.label}
                  <span className="ord-tabs__count">{tabCounts[tab.key]}</span>
                </button>
              );
            })}
          </div>

          <div className="ord-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {/* A CONTROLLED input: React owns the value.
                value={search} shows whatever is in state; onChange writes each
                keystroke back into state. The box and the state never disagree. */}
            <input
              type="text"
              aria-label="Search purchase orders"
              placeholder="Search PO, supplier, ID or status..."
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>

        </div>

        {/* PHONE → cards. Everything else → the table.
            isPhone ? A : B renders only ONE of them, so a phone never builds
            the 21-column table at all. */}
        {/* Nothing matches → a message instead of an empty table.
            Three possible views now: empty, phone cards, desktop table. */}
        {rows.length === 0 ? (
          <div className="ord-empty">
            {search.trim()
              ? 'No purchase orders match your search.'
              : 'No purchase orders to display in this category.'}
          </div>
        ) : isPhone ? (
          <div className="ord-cards" ref={cardsRef}>
            {/* index restarts at 0 on every page, so add start:
                page 2, first card → 10 + 0 + 1 = Sr. No 11. */}
            {pageRows.map((row, index) => (
              <OrderCard key={row.po} row={row} index={start + index} />
            ))}
          </div>
        ) : (
        /* ── The table ──
            The table is 3006px wide, far wider than the screen. The wrapper
            div scrolls sideways so the PAGE itself never scrolls sideways. */
        <div className="ord-table-scroll" ref={scrollRef} onScroll={onTableScroll}>
          <table className="ord-table" style={{ width: TABLE_WIDTH }}>

            {/* <colgroup> sets each column's width ONCE, here, instead of on
                every cell. With table-layout:fixed (see CSS) the browser uses
                these widths as they are and does not resize columns to fit
                their text, so a long supplier name cannot push columns around. */}
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.label} style={{ width: col.width }} />
              ))}
            </colgroup>

            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            {/* ONE <tbody> PER PO. A table may have many <tbody>s; each one
                groups the rows of one PO. That lets the CSS treat a whole PO as
                a unit: tint every second PO, and drop the bottom line under
                the last PO — with no extra JavaScript. */}
            {pageRows.map((row, poIndex) => {
              /* A PO with no invoices yet still needs ONE row, or it would
                 vanish from the table. [null] is that single empty row. */
              const lines = row.invoices.length > 0 ? row.invoices : [null];
              const span = lines.length;

              return (
                <tbody key={row.po}>
                  {lines.map((line, lineIndex) => {
                    const isFirst = lineIndex === 0;
                    const isLast = lineIndex === span - 1;
                    const rowClass = [isFirst ? 'is-first' : '', isLast ? 'is-last' : '']
                      .filter(Boolean).join(' ');

                    return (
                      <tr key={line ? line.spi : 'no-invoice'} className={rowClass || undefined}>

                        {/* Columns 1–14 appear ONLY in the first row, each
                            stretched down with rowSpan. Rows 2, 3... start
                            straight at the SPI column. */}
                        {isFirst && (
                          <>
                            {/* 1 · Sr. No — index starts at 0, people count from 1. */}
                            <PoCell span={span}><span className="ord-srnum">{start + poIndex + 1}</span></PoCell>

                            {/* 2 · PO Number, plus a red badge only when inspection is needed.
                                {condition && <X />} renders X when true and nothing when false. */}
                            <PoCell span={span}>
                              <IdCell id={row.po} date={row.poDate} />
                              {row.physicalInspection && (
                                <span className="ord-badge ord-badge--red ord-physinsp">{ICON_WARN}Physical Inspection</span>
                              )}
                            </PoCell>

                            {/* 3 · PO Type */}
                            {/* PO_TYPE[row.type] looks up this row's label and icon;
                                the modifier class picks the colours. */}
                            <PoCell span={span}>
                              <span className={`ord-typepill ord-typepill--${row.type}`}>
                                <span className="ord-typepill__ico">{PO_TYPE[row.type].icon}</span>
                                {PO_TYPE[row.type].label}
                              </span>
                            </PoCell>

                            {/* 4 · Document Type */}
                            <PoCell span={span}>
                              <span className={`ord-doctype ord-doctype--${row.docType === 'International' ? 'intl' : 'dom'}`}>
                                {row.docType}
                              </span>
                            </PoCell>

                            {/* 5, 6, 7 · the linked IDs. No shipment → a dash.
                                condition ? A : B picks one of two things to show. */}
                            <PoCell span={span}>
                              {row.shipment
                                ? <IdCell id={row.shipment} date={row.shipmentDate} />
                                : <span className="ord-dash">—</span>}
                            </PoCell>
                            <PoCell span={span}><IdCell id={row.opportunity} date={row.opportunityDate} /></PoCell>
                            <PoCell span={span}><IdCell id={row.procurement} date={row.procurementDate} /></PoCell>

                            {/* 8 · Supplier. title= shows the full name on hover when it is cut off. */}
                            <PoCell span={span}>
                              <div className="ord-supplier">
                                <span className="ord-supplier__name" title={row.supplier}>{row.supplier}</span>
                                <span className={`ord-badge ord-badge--${SUPPLIER_CATEGORY[row.supplierCategory].tone} ord-supplier__cat`}>
                                  {SUPPLIER_CATEGORY[row.supplierCategory].icon}
                                  {SUPPLIER_CATEGORY[row.supplierCategory].label}
                                </span>
                              </div>
                            </PoCell>

                            {/* 9 · Risk Alert */}
                            <PoCell span={span}>
                              <span className={`ord-badge ord-badge--${RISK_LEVEL[row.risk].tone} ord-risk`}>
                                {RISK_LEVEL[row.risk].icon}
                                {RISK_LEVEL[row.risk].label}
                              </span>
                            </PoCell>

                            {/* 10 · Expected Delivery Date */}
                            <PoCell span={span}><span className="ord-edd">{row.expectedDelivery}</span></PoCell>

                            {/* 11–14 · money. One base class + one colour modifier each. */}
                            <PoCell span={span}><span className="ord-amt">{formatMoney(row.total)}</span></PoCell>
                            <PoCell span={span}><span className="ord-amt ord-amt--net">{formatMoney(row.net)}</span></PoCell>
                            <PoCell span={span}><span className="ord-amt ord-amt--paid">{formatMoney(row.paid)}</span></PoCell>
                            <PoCell span={span} groupEnd>
                              <span className="ord-amt ord-amt--bal">{formatMoney(row.balance)}</span>
                            </PoCell>
                          </>
                        )}

                        {/* 15–17 · SPI / GRN / QA — one set in EVERY row. */}
                        {line ? (
                          <InvoiceCells line={line} index={lineIndex} count={span} />
                        ) : (
                          <>
                            <td className="ord-doc ord-doc--spi"><span className="ord-dash">—</span></td>
                            <td className="ord-doc ord-doc--grn"><span className="ord-dash">—</span></td>
                            <td className="ord-doc ord-doc--qa"><span className="ord-dash">—</span></td>
                          </>
                        )}

                        {/* 18–21 · PO-level again, so first row only. */}
                        {isFirst && (
                          <>
                            <PoCell span={span}><ZohoCell synced={row.zohoSynced} /></PoCell>
                            <PoCell span={span}>
                              <InspectionCell required={row.physicalInspection} done={row.inspectionDone} />
                            </PoCell>
                            <PoCell span={span}><PaymentCell row={row} /></PoCell>
                            <PoCell span={span}><ActionCell /></PoCell>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        )}

        {/* Outside the scroll area, as the card's last child: the rows scroll
            above it while the footer stays pinned to the bottom of the card. */}
        {/* Hidden when nothing matches — the empty message is enough. */}
        {rows.length > 0 && (
          <WorklistPager
            className="wl-teal"
            total={rows.length}
            page={page}
            pageSize={pageSize}
            onPage={goToPage}
            onPageSize={changePageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Styles
 *
 * Every class starts with "ord-" so nothing here can clash with any other
 * page in the app.
 *
 * Naming follows BEM: block__element--modifier.
 *   ord-strip            the block
 *   ord-strip__title     a part of that block
 *
 * All values are measured from the Figma export. The design defines a violet
 * base and a teal variant on top; this page is always teal, so the teal
 * values are written in directly instead of rebuilding both layers.
 * ───────────────────────────────────────────────────────────────────────── */
const ORDER_CSS = `
/* SPACING RULE: 8px everywhere.
   No padding here: the app layout (.page-content in app.css) already puts
   8px around every page. Adding more would double the edge gap.
   gap is the ONLY space between sections, so no section has its own margin. */
/* FIT THE SCREEN — only the list scrolls
   The page is exactly as tall as the space between the menu and the footer.
   The header strip, guide and tabs stay put; the rows scroll INSIDE the card.

   The chain has to be unbroken, parent to child:
     .main-content (fixed height, set by the layout)
       .page-content      height:100%        → exactly the full area
         .container-fluid   flex:1, min-h:0  → takes that height
           .ord-page          flex:1, min-h:0  → takes it again
             strip, guide       flex-shrink:0  → keep their natural height
             .ord-list          flex:1, min-h:0 → gets what is left
               .ord-table-scroll  flex:1, overflow:auto → scrolls the rows
   If one link is missing, the height stops there and the whole page scrolls.

   Why min-height:0 everywhere: a flex child is NOT allowed to be smaller than
   its content by default (min-height:auto). Without min-height:0 the list
   grows to fit all rows, and the page scrolls instead of the list.

   :has() limits the first two rules to the page that contains .ord-page, so
   the shared layout classes are not changed for any other page. */
.page-content:has(> .container-fluid > .ord-page) {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}
.page-content:has(> .container-fluid > .ord-page) > .container-fluid {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ord-strip,
.ord-guide { flex-shrink: 0; }

.ord-page {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'DM Sans', system-ui, sans-serif;
  /* The app's body sets letter-spacing: -0.02em, and every child inherits it,
     which squeezes all text slightly narrower than the design. The design has
     none, so reset it here. Elements that set their own spacing keep it. */
  letter-spacing: 0;
}

/* ── Section A · Header strip ── */
.ord-strip {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 58px;
  padding: 8px;
  border: 1px solid #9ce1ee;
  border-radius: 16px;
  background: linear-gradient(110deg, #f0fdff 0%, #e8fbfd 25%, #cffafe 55%, #bff0f7 85%, #a5e9f3 100%);
  box-shadow:
    0 2px 0 rgba(255, 255, 255, .85) inset,
    0 8px 28px rgba(6, 182, 212, .2),
    0 2px 8px rgba(0, 0, 0, .06);
}

/* Decorative layers. position:absolute takes them out of the layout, and
   pointer-events:none lets clicks pass straight through them. */
.ord-strip__accent {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  border-radius: 16px 0 0 16px;
  background: linear-gradient(180deg, #22d3ee, #0891b2, #0e7490);
}
.ord-strip__glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(103, 232, 249, .45) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(34, 211, 238, .28) 0%, transparent 55%);
}
.ord-strip__sheen {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 50%;
  pointer-events: none;
  border-radius: 16px 16px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, .5), transparent);
}

/* z-index:1 lifts the real content above the three decorative layers. */
.ord-strip__left {
  display: flex;
  align-items: center;
  gap: 13px;
  padding-left: 4px;   /* clears the 4px teal bar on the left edge */
  z-index: 1;
}
.ord-strip__right {
  display: flex;
  align-items: center;
  gap: 7px;
  z-index: 1;
}

.ord-strip__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.ord-strip__avatar {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  box-shadow:
    0 0 0 3px rgba(6, 182, 212, .25),
    0 4px 14px rgba(8, 145, 178, .45);
}
.ord-strip__avatar svg { display: block; }

/* The green dot sits on the tile's corner: the wrap is position:relative,
   so this absolute dot is placed relative to the wrap, not the page. */
.ord-strip__online-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #e8fbfd;
  box-shadow: 0 2px 4px rgba(34, 197, 94, .4);
}

.ord-strip__title {
  font-size: 14.5px;
  font-weight: 800;
  color: #0c4a6e;
  letter-spacing: -.4px;
  line-height: 1.2;
}
.ord-strip__sub {
  font-size: 10px;
  font-weight: 500;
  color: #0e7490;
  opacity: .85;
  margin-top: 2px;
  line-height: 1.3;
}

.ord-strip__btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: 12px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .02em;
  color: #fff;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .2);
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #06b6d4 100%);
  box-shadow:
    0 4px 16px rgba(8, 145, 178, .5),
    0 1px 3px rgba(14, 116, 144, .3),
    0 1px 0 rgba(255, 255, 255, .2) inset;
  transition: background .2s, transform .2s, box-shadow .2s;
}
.ord-strip__btn:hover {
  transform: translateY(-1.5px);
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 50%, #155e75 100%);
  box-shadow:
    0 8px 24px rgba(8, 145, 178, .6),
    0 2px 6px rgba(14, 116, 144, .35),
    0 1px 0 rgba(255, 255, 255, .2) inset;
}
.ord-strip__btn-sheen {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 50%;
  pointer-events: none;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent);
}

/* ── Section B · What We Are Doing Here ── */
.ord-guide {
  position: relative;
  overflow: hidden;
  background: #fff;
  border: 1px solid #9ce1ee;
  border-radius: 16px;
  box-shadow:
    0 2px 0 rgba(255, 255, 255, .9) inset,
    0 8px 28px rgba(6, 182, 212, .2),
    0 2px 8px rgba(0, 0, 0, .06);
}
/* ::before is a pseudo-element: a decoration CSS draws for us without an
   extra tag in the JSX. Here it is the teal bar down the left edge. */
.ord-guide::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  z-index: 10;
  border-radius: 16px 0 0 16px;
  background: linear-gradient(180deg, #22d3ee, #0891b2, #0e7490);
}

.ord-guide__header {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 8px 8px 8px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #9ce1ee;
  background: linear-gradient(110deg, #f0fdff 0%, #e8fbfd 25%, #cffafe 55%, #bff0f7 85%, #a5e9f3 100%);
}
/* A ring for keyboard users only. :focus-visible shows it after Tab, never
   after a mouse click, so it adds nothing to the design for mouse users. */
.ord-guide__header:focus-visible {
  outline: 2px solid #0891b2;
  outline-offset: -2px;
}
.ord-guide__header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(103, 232, 249, .45) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(34, 211, 238, .28) 0%, transparent 55%);
}
.ord-guide__header::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255, 255, 255, .5), transparent);
}

.ord-guide__header-ico {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  box-shadow:
    0 0 0 3px rgba(6, 182, 212, .25),
    0 4px 14px rgba(8, 145, 178, .45);
}

/* min-width:0 lets this column shrink below its text width. Without it a
   flex child refuses to shrink, and the ellipsis on the subtitle never fires. */
.ord-guide__header-mid {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ord-guide__header-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ord-guide__header-label {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: -.2px;
  line-height: 1;
  color: #0891b2;
  white-space: nowrap;
  flex-shrink: 0;
}
.ord-guide__header-sep {
  width: 1px;
  height: 13px;
  flex-shrink: 0;
  background: #9ce1ee;
}
.ord-guide__header-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -.2px;
  line-height: 1;
  color: #0c4a6e;
  white-space: nowrap;
}
.ord-guide__header-sub {
  font-size: 9.5px;
  font-weight: 500;
  color: #0e7490;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ord-guide__toggle {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0891b2;
  background: rgba(255, 255, 255, .8);
  border: 1.5px solid rgba(8, 145, 178, .22);
  box-shadow:
    0 1px 4px rgba(8, 145, 178, .10),
    inset 0 1px 0 rgba(255, 255, 255, .9);
  transition: transform .24s cubic-bezier(.22, 1, .36, 1);
}

/* The body is a grid. auto-fit with minmax(140px, 1fr) means: fit as many
   columns as the width allows, each at least 140px, sharing the spare space
   equally. On a wide screen the 5 cards sit in one row; on a narrow one they
   wrap onto more rows, with no media query needed. */
.ord-guide__body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  /* gap = space BETWEEN cards, padding = space around the outside.
     Both 8px, so every card has exactly 8px on all four sides. */
  gap: 8px;
  padding: 8px;
  overflow: hidden;
  max-height: 320px;
  opacity: 1;
  background: linear-gradient(180deg, #f0fdff 0%, #F8FAFC 100%);
  transition: max-height .3s cubic-bezier(.22, 1, .36, 1), opacity .22s, padding .3s;
}

/* COLLAPSED — everything the "is-collapsed" class changes.
   The body animates from max-height 320px to 0, which is why it slides shut
   instead of vanishing. The arrow turns to point sideways. */
/* padding must go to 0 too: max-height:0 hides the content, but padding
   would still leave a 16px strip showing. */
.ord-guide.is-collapsed .ord-guide__body {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
}
.ord-guide.is-collapsed .ord-guide__toggle {
  transform: rotate(-90deg);
}
.ord-guide.is-collapsed .ord-guide__header {
  border-bottom-color: transparent;
}

.ord-guide__item {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 11px 11px;
  background: #fff;
  border: 1.5px solid #ECE7F8;
  border-radius: 11px;
  box-shadow: 0 1px 4px rgba(15, 23, 42, .04);
  cursor: default;
  transition: box-shadow .18s, border-color .18s, transform .18s;
}
.ord-guide__item:hover {
  transform: translateY(-2px);
  border-color: #9ce1ee;
  box-shadow:
    0 6px 18px rgba(8, 145, 178, .14),
    0 1px 4px rgba(15, 23, 42, .04);
}
/* The 3px teal bar across the top of each card. */
.ord-guide__item::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  border-radius: 11px 11px 0 0;
  background: linear-gradient(90deg, #22d3ee, #0891b2);
}

.ord-guide__item-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ord-guide__item-ico {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0891b2;
}
.ord-guide__item-num {
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: .12em;
  line-height: 1;
  text-transform: uppercase;
  color: #94A3B8;
}
.ord-guide__item-title {
  margin-top: 5px;
  margin-bottom: 3px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -.2px;
  line-height: 1.25;
  color: #0F172A;
}
.ord-guide__item-desc {
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1.4;
  color: #94A3B8;
}

/* ── Section C · PO list card ── */
/* flex:1 takes the height left under the strip and guide; the column layout
   passes it on to the table's scroll area.
   min-height:320px is the safety net: on a short screen (or a phone with the
   guide open) the list never gets squeezed to nothing — the page scrolls a
   little instead, and the list still has room to show rows. */
.ord-list {
  flex: 1 1 auto;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e3eef3;
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(8, 80, 110, .06);
}

/* flex-wrap:wrap lets the search box drop BELOW the tabs when the screen is
   too narrow for both on one line, instead of squashing them together. */
.ord-list__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
}

/* ── Tabs ── */
/* The grey rounded tray the tabs sit in. */
.ord-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px;
  background: #eef5f9;
  border: 1px solid #dce9f0;
  border-radius: 14px;
}
.ord-tabs__tab {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  color: #6b8499;
  white-space: nowrap;
  cursor: pointer;
  transition: color .18s, background .18s, box-shadow .18s;
}
.ord-tabs__tab svg { flex-shrink: 0; }
.ord-tabs__tab:hover { color: #0e7490; }
.ord-tabs__tab:focus-visible {
  outline: 2px solid #0891b2;
  outline-offset: 2px;
}

/* The selected tab. */
.ord-tabs__tab.is-active {
  color: #fff;
  background: linear-gradient(135deg, #0e7490, #0891b2 55%, #06b6d4);
  box-shadow: 0 4px 12px rgba(8, 145, 178, .32);
}

/* Cancelled turns red, but ONLY while selected. Both classes are required:
   .ord-tabs__tab--danger alone changes nothing, so the tab looks like the
   others until it is clicked. */
.ord-tabs__tab--danger.is-active {
  color: #fff;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 3px 10px -2px rgba(185, 28, 28, .5);
}

.ord-tabs__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 800;
  color: #0e7490;
  background: #dce9f0;
}
/* Inside a selected tab (teal or red), the count turns translucent white. */
.ord-tabs__tab.is-active .ord-tabs__count {
  color: #fff;
  background: rgba(255, 255, 255, .24);
}

/* ── Search ── */
.ord-search {
  position: relative;
  flex: 1;
  min-width: 345px;
  max-width: 630px;
}
/* The magnifier is drawn ON TOP of the input, inside its left padding.
   pointer-events:none lets a click on the icon reach the input underneath,
   so clicking the icon still puts the cursor in the box. */
.ord-search svg {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: #9fb2c0;
  pointer-events: none;
}
/* padding-left 38px leaves room for the icon, so typed text never runs
   underneath it. box-sizing:border-box keeps width:100% INCLUDING padding. */
.ord-search input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 14px 11px 38px;
  border: 1.5px solid #e3edf2;
  border-radius: 12px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #0c4a6e;
  transition: border-color .15s, box-shadow .15s;
}
.ord-search input::placeholder {
  color: #9fb2c0;
  font-weight: 500;
}
.ord-search input:focus {
  outline: none;
  border-color: #22d3ee;
  box-shadow: 0 0 0 3px rgba(34, 211, 238, .12);
}

/* ── Table: scroll wrapper ── */
/* overflow-x:auto shows a sideways scrollbar only when the table is wider
   than the card (always, at 3006px). */
/* Three things keep the sideways scroll smooth:
   1. background:#fff — a solid background lets the browser scroll the table
      as one ready-made image on the GPU instead of repainting it each frame.
   2. No border-radius here — the card (.ord-list) already rounds and clips
      the corners. A second rounded clip on the scroller itself adds a mask
      the browser must redraw while scrolling.
   3. overscroll-behavior-x:contain — on a touchpad, hitting the end of the
      table no longer triggers the browser's swipe back/forward gesture. */
.ord-table-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;            /* both ways: sideways for columns, down for rows */
  background: #fff;
  overscroll-behavior: contain;
}
/* The tabs/search bar keeps its height; only the scroll area shrinks. */
.ord-list__top { flex-shrink: 0; }
.ord-table-scroll::-webkit-scrollbar { width: 9px; }
/* While scrolling (class set from JS), the table ignores the mouse, so no
   hover animation can start under the pointer. Clicks work again 150ms
   after scrolling stops. */
.ord-table-scroll.is-scrolling .ord-table { pointer-events: none; }
.ord-table-scroll::-webkit-scrollbar { height: 9px; }
.ord-table-scroll::-webkit-scrollbar-thumb {
  background: #bfe3ec;
  border-radius: 8px;
}

/* ── Table ── */
/* table-layout:fixed = obey the colgroup widths exactly.
   border-collapse:collapse = neighbouring cells share ONE border line. */
/* will-change:transform puts the whole table on its OWN GPU layer.
   The browser draws it once (all 21 header gradients, shadows, buttons) and
   then just slides that finished picture while scrolling. Without it, the
   header gradients and badges can be redrawn on every frame, which shows up
   as the header stuttering behind the scroll. */
.ord-table {
  table-layout: fixed;
  border-collapse: collapse;
  will-change: transform;
}
.ord-table th,
.ord-table td {
  overflow: hidden;
  text-align: center;
  vertical-align: middle;
}

/* Header labels may wrap onto two lines ("EXPECTED DELIVERY DATE"),
   because the columns are narrow. */
.ord-table th {
  padding: 8px 5px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .04em;
  line-height: 1.25;
  text-transform: uppercase;
  white-space: normal;
  color: #5b7d8c;
  background: linear-gradient(180deg, #f9feff, #edf9fc);
  border-bottom: 1.5px solid #dbf0f4;
  /* STICKY HEADER: while the rows scroll up, the header row stays pinned to
     the top of the scroll area. z-index keeps it above the rows under it.
     The inset shadow redraws the bottom line, because with
     border-collapse the real border scrolls away with the table. */
  position: sticky;
  top: 0;
  z-index: 2;
  box-shadow: inset 0 -1.5px 0 #dbf0f4;
}
.ord-table td {
  padding: 7px 5px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: #0f3a4d;
  border-bottom: 1px solid #f1f6f8;
}

/* ── Where one PO ends ──
   Extra room above the first row and below the last row of each PO, plus a
   thick teal line under it. The PO-level cells get that line directly: a
   rowSpan cell's bottom edge sits at the bottom of the whole PO. */
.ord-table tr.is-first td { padding-top: 10px; }
.ord-table tr.is-last td {
  padding-bottom: 10px;
  border-bottom: 2.5px solid #aee0e9;
}
.ord-table td.ord-po-cell { border-bottom: 2.5px solid #aee0e9; }

/* ── Row colours ──
   :nth-of-type(even) = every 2nd tbody, i.e. every 2nd PO. The whole PO is
   tinted together, not stripe by stripe. */
.ord-table tbody:nth-of-type(even) td { background: #f8fcfd; }
.ord-table tbody tr:hover td { background: #f4fbfd; }
.ord-table tbody:nth-of-type(even) tr:hover td { background: #eff9fb; }

/* The dashed divider after Balance Amount. */
.ord-table th.ord-table__group-end { border-right: 1.5px dashed #c7e9ee; }
.ord-table td.ord-table__group-end { border-right: 1.5px dashed #cdeef3; }

/* ── Cell: Sr. No ── */
.ord-srnum {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
  color: #fff;
  background: linear-gradient(135deg, #22d3ee, #0891b2);
  box-shadow: 0 2px 6px rgba(8, 145, 178, .3);
}

/* ── Cell: ID pill + date ── */
.ord-idcell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5px;
}
/* Shared by the ID cells and the SPI / GRN / QA cards. */
.ord-idpill {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 6px;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: -.3px;
  color: #0e7490;
  background: #e4f9fa;
  border: 1px solid #bfecef;
}
.ord-idcell__date {
  font-size: 8.5px;
  font-weight: 600;
  color: #5b8a99;
}

/* ── Badges ──
   Physical Inspection, the supplier category and the risk level are all the
   same shape: a rounded pill with an icon. .ord-badge holds that shape once.
   Each badge adds its own size, and a colour modifier picks the colours. */
.ord-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 20px;
  font-weight: 800;
  white-space: nowrap;
}
.ord-badge svg { flex-shrink: 0; }

.ord-badge--red   { color: #b91c1c; background: linear-gradient(180deg, #fff1f1, #fee2e2); border-color: #fca5a5; }
.ord-badge--amber { color: #b45309; background: linear-gradient(180deg, #fffbeb, #fef3c7); border-color: #fcd97a; }
.ord-badge--green { color: #15803d; background: linear-gradient(180deg, #f4fdf7, #dcfce7); border-color: #a7ecc0; }
.ord-badge--blue  { color: #1d4ed8; background: linear-gradient(180deg, #f5f9ff, #dbeafe); border-color: #a8c9f5; }
.ord-badge--gold  { color: #92400e; background: linear-gradient(180deg, #fffbeb, #fde68a); border-color: #f0c14b; }
.ord-badge--gold svg { color: #d97706; }
.ord-badge--dark  { color: #f8fafc; background: linear-gradient(180deg, #334155, #0f172a); border-color: #0f172a; }

.ord-physinsp {
  gap: 4px;
  margin-top: 5px;
  padding: 2px 8px;
  font-size: 8px;
  letter-spacing: .04em;
  line-height: 1.25;
  text-transform: uppercase;
  box-shadow: 0 1px 3px rgba(220, 38, 38, .14);
}
.ord-physinsp svg { width: 9px; height: 9px; color: #dc2626; }

/* ── Cell: PO Type ── */
.ord-typepill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  box-sizing: border-box;
  padding: 0 8px 0 3px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15, 58, 77, .06);
}
.ord-typepill__ico {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 6px;
  color: #fff;
  box-shadow: 0 2px 5px -1px rgba(0, 0, 0, .28), inset 0 1px 0 rgba(255, 255, 255, .4);
}
.ord-typepill__ico svg { width: 8.5px; height: 8.5px; }

/* One colour set per PO type: the pill, and the small square icon inside it. */
.ord-typepill--materials { color: #0e7490; background: linear-gradient(135deg, #f0fdff, #d6f6fa); border-color: #bfecef; }
.ord-typepill--materials .ord-typepill__ico { background: linear-gradient(135deg, #22d3ee, #0891b2); }
.ord-typepill--ffd { color: #6d28d9; background: linear-gradient(135deg, #f8f4ff, #ece1fd); border-color: #e2d4fa; }
.ord-typepill--ffd .ord-typepill__ico { background: linear-gradient(135deg, #a78bfa, #7c3aed); }
.ord-typepill--services { color: #b45309; background: linear-gradient(135deg, #fffaf0, #fef0d9); border-color: #fde3b8; }
.ord-typepill--services .ord-typepill__ico { background: linear-gradient(135deg, #fbbf24, #d97706); }

/* ── Cell: Document Type ── */
.ord-doctype {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 20px;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
.ord-doctype--intl { color: #6d28d9; background: #ede9fe; border: 1px solid #ddd6fe; }
.ord-doctype--dom  { color: #0e7490; background: #e0f5fa; border: 1px solid #bfe7f0; }

/* ── Cell: Supplier ── */
.ord-supplier {
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* Ellipsis needs all three: a width limit, overflow hidden, nowrap. */
.ord-supplier__name {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  color: #22414f;
}
.ord-supplier__cat {
  gap: 4px;
  margin-top: 5px;
  padding: 2px 8px;
  font-size: 8px;
  letter-spacing: .04em;
  line-height: 1.3;
  text-transform: uppercase;
}
.ord-supplier__cat svg { width: 9px; height: 9px; }

/* ── Cell: Risk Alert ── */
.ord-risk {
  gap: 5px;
  padding: 4px 11px;
  font-size: 9.5px;
  letter-spacing: .03em;
  line-height: 1.2;
}
.ord-risk svg { width: 11px; height: 11px; }

/* ── Cell: Expected Delivery Date ── */
/* tabular-nums gives every digit the same width, so dates in a column line
   up digit under digit. */
.ord-edd {
  font-size: 11px;
  font-weight: 700;
  color: #22414f;
  font-variant-numeric: tabular-nums;
}

/* ── Cells: money ── */
.ord-amt {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .01em;
  color: #22414f;
  font-variant-numeric: tabular-nums;
}
.ord-amt--net  { color: #0e7490; }
.ord-amt--paid { color: #047857; }
.ord-amt--bal  { color: #b45309; }

/* ── Cells: SPI / GRN / QA ──
   Each of the three columns is a lightly tinted lane, closed off by dashed
   lines on the outside, so the chain reads as one group. */
.ord-table tbody td.ord-doc {
  padding: 5px 7px;
  border-bottom: 1px solid #eef7fa;
}
/* Three class-level parts (ord-table, is-last, ord-doc) beat the two above,
   so the last invoice of a PO still gets the thick teal line. */
.ord-table tbody tr.is-last td.ord-doc { border-bottom: 2.5px solid #aee0e9; }

.ord-doc--spi { background: #fafdff; border-left: 1.5px dashed #cdeef3; }
.ord-doc--grn { background: #fafefb; }
.ord-doc--qa  { background: #fdfaff; border-right: 1.5px dashed #cdeef3; }

/* No line under the very last PO — the card's own edge is right there.
   Written last on purpose: equal strength, so the later rule wins. */
.ord-table tbody:last-child tr.is-last td,
.ord-table tbody:last-child td.ord-po-cell { border-bottom: none; }

/* The card inside each cell: left-aligned, stacked top to bottom.
   min-width:0 lets it shrink to the column instead of forcing it wider. */
.ord-doc__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  min-width: 0;
  padding: 2px 0;
  text-align: left;
}
.ord-doc__top,
.ord-doc__meta,
.ord-doc__foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.ord-doc__top  { gap: 6px; }
.ord-doc__meta { gap: 5px; font-size: 8.5px; font-weight: 600; color: #6b8d9c; }
.ord-doc__foot { gap: 7px; }

/* The grey "SPI 1/2" chip. */
.ord-doc__seq {
  padding: 2px 5px;
  border-radius: 5px;
  font-size: 7.5px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  white-space: nowrap;
  color: #93aebb;
  background: #f2f8fa;
  border: 1px solid #e6f1f5;
}
.ord-doc__money {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  color: #0c4a6e;
  font-variant-numeric: tabular-nums;
}
.ord-doc__dot { color: #b6cbd6; }
.ord-doc__sub {
  font-size: 8.5px;
  font-weight: 600;
  white-space: nowrap;
  color: #6b8d9c;
}
.ord-doc__paid { font-weight: 800; color: #047857; }
.ord-doc__due  { font-weight: 800; color: #b45309; }

/* ── Status pill (small) ──
   The dot uses background:currentColor — it copies the pill's text colour,
   so each modifier sets ONE colour and the dot follows automatically. */
.ord-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .02em;
  white-space: nowrap;
}
.ord-pill__dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.ord-pill--full,
.ord-pill--received { color: #047857; background: #dcfce7; border-color: #a7f3d0; }
.ord-pill--partial  { color: #b45309; background: #fef3c7; border-color: #fde68a; }
.ord-pill--pending  { color: #b91c1c; background: #fee2e2; border-color: #fecaca; }
.ord-pill--qa       { color: #6d28d9; background: #f1e9fd; border-color: #e2d4fa; }

/* ── Status cells: pill on top, button underneath ── */
.ord-statcell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}

/* Status pill (large). Here the dot has its OWN colour, a brighter shade than
   the text, so it is set per modifier instead of using currentColor. */
.ord-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .02em;
  white-space: nowrap;
}
.ord-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.ord-status--ok  { color: #15803d; background: #dcfce7; }
.ord-status--ok  .ord-status__dot { background: #22c55e; }
.ord-status--bad { color: #b91c1c; background: #fee2e2; }
.ord-status--bad .ord-status__dot { background: #ef4444; }
.ord-status--na  { color: #52708a; background: #eef2f6; }
.ord-status--na  .ord-status__dot { background: #94a8b8; }

/* ── Buttons ──
   One base class for size and shape. Each modifier only swaps the gradient.
   background-image holds TWO layers, and the first one is drawn on top:
     1. a white fade over the top half, which acts as the sheen
     2. the colour gradient underneath */
.ord-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  padding: 0 14px;
  box-sizing: border-box;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: -.1px;
  white-space: nowrap;
  color: #fff;
  cursor: pointer;
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .20), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #0e7490, #22b8d6 52%, #5ee0f2);
  background-origin: border-box;
  box-shadow: 0 3px 9px -3px rgba(12, 74, 110, .40), inset 0 1px 0 rgba(255, 255, 255, .18);
  transition: filter .15s, transform .12s, box-shadow .15s;
}
.ord-btn svg {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
}
.ord-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 5px 13px -3px rgba(12, 74, 110, .5), inset 0 1px 0 rgba(255, 255, 255, .22);
}
.ord-btn:active { transform: translateY(0); }
.ord-btn:focus-visible {
  outline: 2px solid #0891b2;
  outline-offset: 2px;
}

.ord-btn--zoho {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .20), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #0c4f63, #0891b2 52%, #22d3ee);
}
.ord-btn--insp {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .18), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #0d4d60, #0e7490 52%, #2aa8c4);
}
/* Done keeps the same teal. Only the tick turns green. */
.ord-btn--insp.is-done svg { color: #6ee7b7; }
.ord-btn--hist {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .17), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #08354f, #125e78 52%, #2b83a3);
}
.ord-btn--hist.is-record {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .20), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #2c5c74, #4a7f99 52%, #7fb0c6);
}
.ord-btn--edit {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #0e7490, #22b8d6 54%, #67e8f9);
}
.ord-btn--vault {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .18), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #17435c, #3b82a6 52%, #7ab8d2);
}
.ord-btn--cancel {
  background-image:
    linear-gradient(180deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, 0) 54%),
    linear-gradient(90deg, #991b1b, #e02424 52%, #f87171);
  box-shadow: 0 3px 9px -3px rgba(185, 28, 28, .5), inset 0 1px 0 rgba(255, 255, 255, .18);
}

/* The request count, cut into the button as a see-through chip. */
.ord-btn__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  font-style: normal;
  color: #fff;
  background: rgba(255, 255, 255, .24);
}
/* When approved money is ready to pay, the count turns green. */
.ord-btn__count--ready {
  color: #053b2b;
  background: #34d399;
}

/* ── Payment Progress cell ── */
.ord-paycell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ord-paycell .ord-btn { align-self: center; }

.ord-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  margin: 0 auto;
  text-align: left;
}
.ord-progress__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.ord-progress__pct {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: -.2px;
}
/* overflow:hidden on the track clips the fill to its rounded ends. */
.ord-progress__bar {
  position: relative;
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 20px;
  background: #e6f5f8;
  box-shadow: inset 0 1px 2px rgba(8, 145, 178, .12);
}
.ord-progress__fill {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: 20px;
  transition: width .3s cubic-bezier(.22, 1, .36, 1);
}
.ord-progress__sheen {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, .45), transparent);
}
.ord-progress__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 8.5px;
  font-weight: 700;
}
.ord-progress__paid,
.ord-progress__due {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}
/* One-line note under the bar: money approved and waiting (green), or money
   still waiting for approval (amber). max-width + ellipsis cut a long note
   with "…" instead of letting it widen the column. */
.ord-paynote {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 4px;
  max-width: 100%;
  margin-top: 5px;
  padding: 2px 8px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .01em;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ord-paynote svg { flex-shrink: 0; width: 10px; height: 10px; }
.ord-paynote--ready   { color: #15803d; background: #dcfce7; border: 1px solid #bbf7d0; }
.ord-paynote--waiting { color: #b45309; background: #fef3c7; border: 1px solid #fde68a; }

.ord-progress__mdot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

/* One class on the wrapper sets the colours of every part inside it. */
.ord-progress.is-full .ord-progress__pct  { color: #16a34a; }
.ord-progress.is-full .ord-progress__fill {
  background: linear-gradient(90deg, #4ade80, #16a34a);
  box-shadow: 0 1px 3px rgba(22, 163, 74, .4);
}
.ord-progress.is-full .ord-progress__paid { color: #0891b2; }
.ord-progress.is-full .ord-progress__due  { color: #94a3b8; }

.ord-progress.is-partial .ord-progress__pct  { color: #b45309; }
.ord-progress.is-partial .ord-progress__fill {
  background: linear-gradient(90deg, #fbbf24, #d97706);
  box-shadow: 0 1px 3px rgba(217, 119, 6, .4);
}
.ord-progress.is-partial .ord-progress__paid { color: #047857; }
.ord-progress.is-partial .ord-progress__due  { color: #d97706; }

.ord-progress.is-pending .ord-progress__pct { color: #b91c1c; }
.ord-progress.is-pending .ord-progress__bar {
  background: #fdeaea;
  box-shadow: inset 0 1px 2px rgba(220, 38, 38, .1);
}
.ord-progress.is-pending .ord-progress__paid { color: #a8b8c2; }
.ord-progress.is-pending .ord-progress__due  { color: #dc2626; }

/* ── Action cell ── */
.ord-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* Placeholder for columns not built yet. */
.ord-dash {
  font-weight: 700;
  color: #a8bcc7;
}

/* ══════════════════════════════════════════════════════════════════════
   DARK MODE
   The app's theme switch puts data-bs-theme="dark" on the <html> tag.
   [data-bs-theme="dark"] .ord-x  means ".ord-x, but only inside dark mode".

   Why it always wins: an attribute selector counts like a class. So every
   dark rule is its light rule PLUS one more part — stronger, no !important.

   The look follows CLM Segment Master:
   - surfaces: deep navy (#0f172a / #1e293b) with faint teal borders
   - accents:  the same colours as light mode, but as see-through tints
               (e.g. red at 14% opacity) with bright text on top
   - white sheens and glows: dimmed to almost nothing, or they glare
   ══════════════════════════════════════════════════════════════════════ */

[data-bs-theme="dark"] .ord-page { color: #e2e8f0; }

/* ── Header strip ── */
[data-bs-theme="dark"] .ord-strip {
  background: #102234;
  border-color: rgba(6, 182, 212, .25);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .ord-strip__glow {
  background-image: radial-gradient(ellipse at 10% 50%, rgba(34, 211, 238, .10) 0%, transparent 50%);
}
[data-bs-theme="dark"] .ord-strip__sheen { background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent); }
[data-bs-theme="dark"] .ord-strip__online-dot { border-color: #102234; }
[data-bs-theme="dark"] .ord-strip__title { color: #67e8f9; }
[data-bs-theme="dark"] .ord-strip__sub { color: #7dd3fc; }

/* ── Guide ── */
[data-bs-theme="dark"] .ord-guide {
  background: #0f172a;
  border-color: rgba(6, 182, 212, .25);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .ord-guide__header {
  background: #102234;
  border-bottom-color: rgba(6, 182, 212, .22);
}
[data-bs-theme="dark"] .ord-guide__header::before {
  background-image: radial-gradient(ellipse at 10% 50%, rgba(34, 211, 238, .10) 0%, transparent 50%);
}
[data-bs-theme="dark"] .ord-guide__header::after { background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent); }
[data-bs-theme="dark"] .ord-guide__header-label { color: #22d3ee; }
[data-bs-theme="dark"] .ord-guide__header-sep { background: rgba(6, 182, 212, .35); }
[data-bs-theme="dark"] .ord-guide__header-title { color: #67e8f9; }
[data-bs-theme="dark"] .ord-guide__header-sub { color: #7dd3fc; }
[data-bs-theme="dark"] .ord-guide__toggle {
  color: #67e8f9;
  background: rgba(255, 255, 255, .06);
  border-color: rgba(6, 182, 212, .30);
  box-shadow: none;
}
[data-bs-theme="dark"] .ord-guide__body { background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); }
[data-bs-theme="dark"] .ord-guide__item {
  background: #1e293b;
  border-color: rgba(6, 182, 212, .18);
  box-shadow: none;
}
[data-bs-theme="dark"] .ord-guide__item:hover {
  border-color: rgba(6, 182, 212, .45);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .ord-guide__item-ico { color: #22d3ee; }
[data-bs-theme="dark"] .ord-guide__item-title { color: #e2e8f0; }
[data-bs-theme="dark"] .ord-guide__item-num,
[data-bs-theme="dark"] .ord-guide__item-desc { color: #94a3b8; }

/* ── List card, tabs, search ── */
[data-bs-theme="dark"] .ord-list {
  background: #0f172a;
  border-color: rgba(6, 182, 212, .18);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
}
[data-bs-theme="dark"] .ord-tabs {
  background: #1e293b;
  border-color: rgba(6, 182, 212, .20);
}
/* :not(.is-active) keeps the selected tab's white text: without it this rule
   would also grey out the active tab (same strength, and it comes later). */
[data-bs-theme="dark"] .ord-tabs__tab:not(.is-active) { color: #94a3b8; }
[data-bs-theme="dark"] .ord-tabs__tab:not(.is-active):hover { color: #67e8f9; }
[data-bs-theme="dark"] .ord-tabs__tab:not(.is-active) .ord-tabs__count {
  color: #67e8f9;
  background: #0f172a;
}
[data-bs-theme="dark"] .ord-search svg { color: #64748b; }
[data-bs-theme="dark"] .ord-search input {
  color: #e2e8f0;
  background: #1e293b;
  border-color: rgba(6, 182, 212, .25);
}
[data-bs-theme="dark"] .ord-search input::placeholder { color: #64748b; }
/* Chrome paints autofilled inputs near-white and ignores background. A huge
   inset shadow is the only way to paint over it. */
[data-bs-theme="dark"] .ord-search input:-webkit-autofill {
  -webkit-text-fill-color: #e2e8f0;
  -webkit-box-shadow: 0 0 0 1000px #1e293b inset;
}

/* ── Table ── */
[data-bs-theme="dark"] .ord-table-scroll { background: #0f172a; }
[data-bs-theme="dark"] .ord-table-scroll::-webkit-scrollbar-thumb { background: rgba(6, 182, 212, .35); }

/* The header is sticky, so it must be SOLID or the rows would show through it
   while scrolling. Two layers: the see-through teal on top of the navy card. */
[data-bs-theme="dark"] .ord-table th {
  color: #cffafe;
  background: linear-gradient(rgba(8, 145, 178, .18), rgba(8, 145, 178, .18)), #0f172a;
  border-bottom-color: rgba(6, 182, 212, .30);
  box-shadow: inset 0 -1.5px 0 rgba(6, 182, 212, .30);
}
[data-bs-theme="dark"] .ord-table td {
  color: #e2e8f0;
  border-bottom-color: rgba(6, 182, 212, .10);
}
[data-bs-theme="dark"] .ord-table tr.is-last td,
[data-bs-theme="dark"] .ord-table td.ord-po-cell,
[data-bs-theme="dark"] .ord-table tbody tr.is-last td.ord-doc { border-bottom-color: rgba(6, 182, 212, .35); }
[data-bs-theme="dark"] .ord-table tbody td.ord-doc { border-bottom-color: rgba(6, 182, 212, .08); }
/* Still no line under the last PO. Needed again here because the dark doc
   rule above is stronger than the light "last PO" rule. */
[data-bs-theme="dark"] .ord-table tbody:last-child tr.is-last td,
[data-bs-theme="dark"] .ord-table tbody:last-child td.ord-po-cell { border-bottom: none; }

[data-bs-theme="dark"] .ord-table th.ord-table__group-end,
[data-bs-theme="dark"] .ord-table td.ord-table__group-end { border-right-color: rgba(6, 182, 212, .30); }

/* SPI / GRN / QA lanes: the same blue / green / purple hint, but faint. */
[data-bs-theme="dark"] .ord-doc--spi { background: rgba(56, 189, 248, .04); border-left-color: rgba(6, 182, 212, .25); }
[data-bs-theme="dark"] .ord-doc--grn { background: rgba(34, 197, 94, .04); }
[data-bs-theme="dark"] .ord-doc--qa  { background: rgba(168, 85, 247, .04); border-right-color: rgba(6, 182, 212, .25); }

/* Zebra and hover, written after the lanes so they win the same way they
   do in light mode. */
[data-bs-theme="dark"] .ord-table tbody:nth-of-type(even) td { background: rgba(8, 145, 178, .06); }
[data-bs-theme="dark"] .ord-table tbody tr:hover td,
[data-bs-theme="dark"] .ord-table tbody:nth-of-type(even) tr:hover td { background: rgba(8, 145, 178, .16); }

/* ── Cells ── */
[data-bs-theme="dark"] .ord-idpill {
  color: #67e8f9;
  background: rgba(8, 145, 178, .16);
  border-color: rgba(6, 182, 212, .35);
}
[data-bs-theme="dark"] .ord-idcell__date { color: #94a3b8; }

[data-bs-theme="dark"] .ord-badge--red   { color: #fca5a5; background: rgba(239, 68, 68, .14);  border-color: rgba(239, 68, 68, .40); }
[data-bs-theme="dark"] .ord-badge--amber { color: #fcd34d; background: rgba(245, 158, 11, .14); border-color: rgba(245, 158, 11, .40); }
[data-bs-theme="dark"] .ord-badge--green { color: #86efac; background: rgba(34, 197, 94, .14);  border-color: rgba(34, 197, 94, .38); }
[data-bs-theme="dark"] .ord-badge--blue  { color: #93c5fd; background: rgba(59, 130, 246, .16); border-color: rgba(59, 130, 246, .40); }
[data-bs-theme="dark"] .ord-badge--gold  { color: #fde68a; background: rgba(234, 179, 8, .16);  border-color: rgba(234, 179, 8, .45); }
[data-bs-theme="dark"] .ord-badge--gold svg { color: #fbbf24; }
[data-bs-theme="dark"] .ord-badge--dark  { color: #e2e8f0; background: #334155; border-color: rgba(148, 163, 184, .40); }
[data-bs-theme="dark"] .ord-physinsp { box-shadow: none; }
[data-bs-theme="dark"] .ord-physinsp svg { color: #f87171; }

[data-bs-theme="dark"] .ord-typepill { box-shadow: none; }
[data-bs-theme="dark"] .ord-typepill--materials { color: #67e8f9; background: rgba(8, 145, 178, .16);  border-color: rgba(6, 182, 212, .35); }
[data-bs-theme="dark"] .ord-typepill--ffd       { color: #c4b5fd; background: rgba(139, 92, 246, .16); border-color: rgba(139, 92, 246, .40); }
[data-bs-theme="dark"] .ord-typepill--services  { color: #fcd34d; background: rgba(245, 158, 11, .14); border-color: rgba(245, 158, 11, .40); }

[data-bs-theme="dark"] .ord-doctype--intl { color: #c4b5fd; background: rgba(139, 92, 246, .16); border-color: rgba(139, 92, 246, .35); }
[data-bs-theme="dark"] .ord-doctype--dom  { color: #67e8f9; background: rgba(8, 145, 178, .16);  border-color: rgba(6, 182, 212, .35); }

[data-bs-theme="dark"] .ord-supplier__name { color: #f1f5f9; }
[data-bs-theme="dark"] .ord-edd,
[data-bs-theme="dark"] .ord-amt { color: #e2e8f0; }
[data-bs-theme="dark"] .ord-amt--net  { color: #67e8f9; }
[data-bs-theme="dark"] .ord-amt--paid { color: #4ade80; }
[data-bs-theme="dark"] .ord-amt--bal  { color: #fbbf24; }

[data-bs-theme="dark"] .ord-doc__meta,
[data-bs-theme="dark"] .ord-doc__sub { color: #94a3b8; }
[data-bs-theme="dark"] .ord-doc__seq {
  color: #94a3b8;
  background: rgba(255, 255, 255, .05);
  border-color: rgba(148, 163, 184, .20);
}
[data-bs-theme="dark"] .ord-doc__money { color: #bae6fd; }
[data-bs-theme="dark"] .ord-doc__dot { color: #475569; }
[data-bs-theme="dark"] .ord-doc__paid { color: #4ade80; }
[data-bs-theme="dark"] .ord-doc__due  { color: #fbbf24; }

[data-bs-theme="dark"] .ord-pill--full,
[data-bs-theme="dark"] .ord-pill--received { color: #86efac; background: rgba(34, 197, 94, .14);  border-color: rgba(34, 197, 94, .35); }
[data-bs-theme="dark"] .ord-pill--partial  { color: #fcd34d; background: rgba(245, 158, 11, .14); border-color: rgba(245, 158, 11, .35); }
[data-bs-theme="dark"] .ord-pill--pending  { color: #fca5a5; background: rgba(239, 68, 68, .14);  border-color: rgba(239, 68, 68, .35); }
[data-bs-theme="dark"] .ord-pill--qa       { color: #c4b5fd; background: rgba(139, 92, 246, .16); border-color: rgba(139, 92, 246, .35); }

[data-bs-theme="dark"] .ord-status--ok  { color: #86efac; background: rgba(34, 197, 94, .14); }
[data-bs-theme="dark"] .ord-status--bad { color: #fca5a5; background: rgba(239, 68, 68, .14); }
[data-bs-theme="dark"] .ord-status--na  { color: #94a3b8; background: rgba(148, 163, 184, .12); }

/* Buttons keep their teal / red gradients (they already read well on dark);
   only the shadow gets darker so it doesn't glow blue. */
[data-bs-theme="dark"] .ord-btn { box-shadow: 0 3px 9px -3px rgba(0, 0, 0, .6), inset 0 1px 0 rgba(255, 255, 255, .12); }

[data-bs-theme="dark"] .ord-progress__bar { background: rgba(255, 255, 255, .08); box-shadow: none; }
[data-bs-theme="dark"] .ord-progress__sheen { background: linear-gradient(180deg, rgba(255, 255, 255, .25), transparent); }
[data-bs-theme="dark"] .ord-progress.is-full .ord-progress__pct     { color: #4ade80; }
[data-bs-theme="dark"] .ord-progress.is-full .ord-progress__paid    { color: #22d3ee; }
[data-bs-theme="dark"] .ord-progress.is-full .ord-progress__due     { color: #64748b; }
[data-bs-theme="dark"] .ord-progress.is-partial .ord-progress__pct  { color: #fbbf24; }
[data-bs-theme="dark"] .ord-progress.is-partial .ord-progress__paid { color: #4ade80; }
[data-bs-theme="dark"] .ord-progress.is-partial .ord-progress__due  { color: #fbbf24; }
[data-bs-theme="dark"] .ord-progress.is-pending .ord-progress__pct  { color: #f87171; }
[data-bs-theme="dark"] .ord-progress.is-pending .ord-progress__bar  { background: rgba(239, 68, 68, .14); }
[data-bs-theme="dark"] .ord-progress.is-pending .ord-progress__paid { color: #64748b; }
[data-bs-theme="dark"] .ord-progress.is-pending .ord-progress__due  { color: #f87171; }

[data-bs-theme="dark"] .ord-paynote--ready   { color: #86efac; background: rgba(34, 197, 94, .14);  border-color: rgba(34, 197, 94, .35); }
[data-bs-theme="dark"] .ord-paynote--waiting { color: #fcd34d; background: rgba(245, 158, 11, .14); border-color: rgba(245, 158, 11, .35); }

[data-bs-theme="dark"] .ord-dash { color: #475569; }

/* ══════════════════════════════════════════════════════════════════════
   RESPONSIVE
   Kept at the END on purpose: a later rule with the same strength wins, so
   these override the desktop values above without needing !important.

   A media query applies its rules only while the condition is true.
   max-width: 768px  →  "only when the screen is 768px wide or less".
   The breakpoints go from wide to narrow, so a phone gets ALL of them
   stacked: the 1400 rules, then 1024, then 768, then 480.
   ══════════════════════════════════════════════════════════════════════ */

/* Shown instead of the list when a tab or search has no results.
   flex:1 fills the card, so the pager area doesn't jump up. */
.ord-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 14px;
  font-size: 12.5px;
  font-weight: 600;
  text-align: center;
  color: #94a3b8;
}
[data-bs-theme="dark"] .ord-empty { color: #64748b; }

/* The shared WorklistPager (app.css) is built for pages where it sits at the
   end of a stretched card. Here it is the card's last row: no top margin,
   never squeezed, square corners (the card already rounds and clips them),
   and 8px padding like the rest of this page. */
.ord-list > .wl-pager {
  flex-shrink: 0;
  margin-top: 0;
  padding: 8px;
  border-radius: 0;
}

/* ── Phone card view ──
   Only rendered on phones (see useIsPhone), so these rules need no media
   query: on a desktop the elements simply don't exist. */
/* Same idea as the table: the cards scroll inside the list card. */
.ord-cards {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
}
.ord-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid #e3eef3;
  border-left: 3px solid #22d3ee;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(8, 80, 110, .06);
}
.ord-card:nth-child(even) { background: #f8fcfd; }

.ord-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* flex:1 takes the free middle space, pushing the type pill to the right. */
.ord-card__po {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.ord-card__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.ord-card__tags .ord-physinsp { margin-top: 0; }

.ord-card__label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #5b7d8c;
}

.ord-card__split {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.ord-card__block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.ord-card__block--end { align-items: flex-end; }
.ord-card .ord-supplier__name { white-space: normal; }
.ord-card .ord-supplier__cat { margin-top: 0; }

/* Two label/value columns. The <div> around each dt+dd pair is one grid cell. */
.ord-card__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  margin: 0;
  padding: 10px;
  background: #f7fbfc;
  border: 1px solid #edf4f7;
  border-radius: 10px;
}
.ord-card__grid dt {
  margin-bottom: 3px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #5b7d8c;
}
.ord-card__grid dd { margin: 0; }
.ord-card__grid .ord-idcell { align-items: flex-start; }

.ord-card__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ord-card__invoice {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  background: #fafdff;
  border: 1px dashed #cdeef3;
  border-radius: 10px;
}
.ord-card__chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

/* auto-fit + minmax: two columns when there is room, one when there isn't. */
.ord-card__status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.ord-card__status .ord-statcell { align-self: stretch; align-items: flex-start; }

/* The table versions are sized for fixed columns; in a card they fill the width. */
.ord-card .ord-progress { width: 100%; min-width: 0; margin: 0; }
.ord-card .ord-btn { height: 38px; padding: 0 12px; font-size: 11px; }
.ord-card .ord-paycell .ord-btn { align-self: stretch; }
.ord-card .ord-actions { flex-wrap: wrap; }
.ord-card .ord-actions .ord-btn { flex: 1 1 100px; }

[data-bs-theme="dark"] .ord-card {
  background: #1e293b;
  border-color: rgba(6, 182, 212, .18);
  border-left-color: #22d3ee;
  box-shadow: none;
}
[data-bs-theme="dark"] .ord-card:nth-child(even) { background: #1a2537; }
[data-bs-theme="dark"] .ord-card__label,
[data-bs-theme="dark"] .ord-card__grid dt { color: #94a3b8; }
[data-bs-theme="dark"] .ord-card__grid {
  background: rgba(255, 255, 255, .03);
  border-color: rgba(6, 182, 212, .12);
}
[data-bs-theme="dark"] .ord-card__invoice {
  background: rgba(56, 189, 248, .04);
  border-color: rgba(6, 182, 212, .25);
}

/* Always on: let the long strip text shrink instead of pushing the Create PO
   button off the card, and let the tabs scroll sideways when they don't fit. */
.ord-strip__left { min-width: 0; }
.ord-tabs {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}
.ord-tabs__tab { flex-shrink: 0; }

/* ≤1400px (laptops): tabs and search no longer fit on one line. Instead of
   the search dropping down at its desktop width, it takes the full row. */
@media (max-width: 1400px) {
  .ord-search {
    flex: 1 1 100%;
    max-width: none;
    min-width: 0;
  }
}

/* ≤1024px (tablets): smaller tabs, so more of them are visible at once. */
@media (max-width: 1024px) {
  .ord-tabs__tab {
    gap: 7px;
    padding: 9px 12px;
    font-size: 12px;
  }
  .ord-guide__header-sub {
    white-space: normal;   /* wrap the guide subtitle instead of cutting it */
  }
}

/* ≤768px (large phones): the header strip stacks, the button goes full width. */
@media (max-width: 768px) {
  .ord-strip {
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 8px 8px 8px;
  }
  .ord-strip__left { padding-left: 0; }
  .ord-strip__right,
  .ord-strip__btn { width: 100%; }
  /* 5 guide cards now stack in 2–3 rows and need more than the 320px the
     open/close animation allowed on desktop. */
  .ord-guide__body { max-height: 900px; }
}

/* ≤480px (small phones): one guide card per row, tighter text. */
@media (max-width: 480px) {
  .ord-strip__title { font-size: 13.5px; }
  .ord-guide__header-row { flex-wrap: wrap; }
  .ord-guide__body { grid-template-columns: 1fr; }
  .ord-tabs__tab {
    padding: 8px 10px;
    font-size: 11.5px;
  }
  .ord-search input { font-size: 12px; }
}
`;
