// P2P → Order: purchase order list. Uses static SAMPLE_ROWS until the API is connected.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import WorklistPager from '../../../../components/ui/WorklistPager';
import Badge, { type BadgeVariant } from '../../../../components/ui/Badge';
import CreatePoModal from './CreatePoModal';
// The PO form is a screen of its own: loaded only when one is being created,
// so the list page doesn't carry it. The type import costs nothing at runtime.
import type { PoLink } from './create-po/CreatePoForm';
import type { InspectionDraft, InspectionRecord } from './inspection-shared';
const CreatePoForm = lazy(() => import('./create-po/CreatePoForm'));
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './order.css';

const ManagePaymentRequestsModal = lazy(() => import('./ManagePaymentRequestsModal'));
const PhysicalInspectionModal = lazy(() => import('./PhysicalInspectionModal'));

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

type TabKey = 'all' | 'with' | 'without' | 'cancelinit' | 'cancelclosed';

/* `sub` is the parenthetical half of a tab label. It renders quieter than the
   label so "PO Cancellation Initiated" reads first and "(Recovery Pending)"
   qualifies it, rather than the two competing. */
type ListTab = { key: TabKey; label: string; sub?: string; danger?: boolean; icon: ReactNode };

const tabIconProps = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

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
    key: 'with', label: "With Shipment ID PO's",
    icon: (
      <svg {...tabIconProps}>
        <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    key: 'without', label: "All Other PO's", sub: '(Without Shipment ID)',
    icon: (
      <svg {...tabIconProps}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    key: 'cancelinit', label: 'PO Cancellation Initiated', sub: '(Recovery Pending)', danger: true,
    icon: (
      <svg {...tabIconProps}>
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
      </svg>
    ),
  },
  {
    key: 'cancelclosed', label: 'PO Cancellation Closed', sub: '(Recovery Completed)',
    icon: (
      <svg {...tabIconProps} strokeWidth={2.2}>
        <circle cx="12" cy="12" r="9" /><polyline points="8 12.4 11 15.4 16 9.6" />
      </svg>
    ),
  },
];

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
  { label: 'Advance Receipt Refund Adjustment', width: 238 },
  { label: 'Payment Recovery Status',    width: 246 },
  { label: 'Action',                     width: 412 },
];

const TABLE_WIDTH = COLUMNS.reduce((total, col) => total + col.width, 0);

type PaymentStatus = 'full' | 'partial' | 'pending';

type InvoiceLine = {
  spi: string; spiDate: string;
  amount: number; paid: number; due: number; status: PaymentStatus;
  grn: string; grnDate: string;
  qa: string; qaDate: string;
};

type PoType = 'materials' | 'ffd' | 'services';
type DocType = 'International' | 'Domestics';
type SupplierCategory = 'star' | 'regular' | 'high' | 'blacklisted';
type RiskLevel = 'high' | 'medium' | 'low';

type PaymentNote = { kind: 'ready' | 'waiting'; amount: number };

export type AdvanceRefund = {
  /** Latest note number; older ones are counted, not listed. */
  no: string;
  date: string;
  count: number;
  /** What went out to the supplier as an advance. */
  paid: number;
  /** What the credit note brings back. */
  credited: number;
};

export type OrderRow = {
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
  zohoSynced: boolean;
  inspectionDone: boolean;
  paymentRequests: number;
  paymentNote?: PaymentNote;
  cancelled?: boolean;
  cancelReason?: string;
  /* The advance-receipt refund adjustment raised when the PO is cancelled.
     Absent until one exists — a PO that never took an advance owes nothing. */
  adr?: AdvanceRefund;
  /* Amounts recovered from the supplier so far, one per recovery entry. */
  recoveries?: number[];
  /* Cancellation runs in two stages: initiating the refund adjustment moves the
     PO to "Recovery Pending", and it moves itself to "Recovery Completed" once
     every rupee released against it has been recovered. */
  cancelStage?: 'initiated' | 'closed';
};

export const PO_TYPE: Record<PoType, { label: string; icon: ReactNode }> = {
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

const SUPPLIER_CATEGORY: Record<SupplierCategory, { label: string; variant: BadgeVariant; icon: ReactNode }> = {
  star: {
    label: 'Star Supplier', variant: 'gold',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95z" />
      </svg>
    ),
  },
  regular: { label: 'Regular Supplier', variant: 'info', icon: ICON_CHECK },
  high: { label: 'High Risk Supplier', variant: 'danger', icon: ICON_WARN },
  blacklisted: {
    label: 'Blacklisted Supplier', variant: 'dark',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
      </svg>
    ),
  },
};

const RISK_LEVEL: Record<RiskLevel, { label: string; variant: BadgeVariant; icon: ReactNode }> = {
  high: { label: 'High', variant: 'danger', icon: ICON_WARN },
  medium: { label: 'Medium', variant: 'warning', icon: ICON_CLOCK },
  low: { label: 'Low', variant: 'success', icon: ICON_CHECK },
};

export const SAMPLE_ROWS: OrderRow[] = [
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
        spi: 'SPI/2025-26/051', spiDate: '2026-03-10',
        amount: 259500, paid: 129800, due: 129700, status: 'partial',
        grn: 'GRN-051', grnDate: '2026-03-14',
        qa: 'QA-051', qaDate: '2026-03-16',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'ready', amount: 71300 },
    // Values from the prototype's own row. ₹20,800 of the ₹1,29,800 paid is
    // held back, so ₹1,09,000 is recoverable; ₹49,100 of it is in (45%).
    adr: { no: 'ADR/2025-26/026', date: '2026-04-02', count: 1, paid: 129800, credited: 109000 },
    recoveries: [49100],
  },
  {
    po: 'PO/2025-26/004', poDate: '2026-06-10', physicalInspection: true,
    type: 'materials', docType: 'International',
    shipment: 'SHP-014', shipmentDate: '2026-05-29',
    opportunity: 'OPP-006', opportunityDate: '2026-05-01',
    procurement: 'PROC-009', procurementDate: '2026-05-16',
    supplier: 'Adani Enterprises', supplierCategory: 'high',
    risk: 'high',
    expectedDelivery: '2026-07-22',
    total: 255500, net: 247800, paid: 0, balance: 247800,
    // No supplier invoice raised yet, so SPI / GRN / QA all read "—".
    invoices: [],
    zohoSynced: false, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'ready', amount: 116500 },
  },
  {
    po: 'PO/2025-26/007', poDate: '2026-05-28', physicalInspection: false,
    type: 'services', docType: 'Domestics',
    shipment: 'SHP-021', shipmentDate: '2026-05-16',
    opportunity: 'OPP-011', opportunityDate: '2026-04-18',
    procurement: 'PROC-015', procurementDate: '2026-05-03',
    supplier: 'Mahindra Logistics', supplierCategory: 'regular',
    risk: 'medium',
    expectedDelivery: '2026-06-30',
    total: 121500, net: 120300, paid: 60200, balance: 60100,
    invoices: [
      {
        spi: 'SPI/2025-26/022', spiDate: '2026-06-04',
        amount: 40100, paid: 40100, due: 0, status: 'full',
        grn: 'GRN-022', grnDate: '2026-06-08',
        qa: 'QA-022', qaDate: '2026-06-10',
      },
      {
        spi: 'SPI/2025-26/023', spiDate: '2026-06-13',
        amount: 40100, paid: 20100, due: 20000, status: 'partial',
        grn: 'GRN-023', grnDate: '2026-06-17',
        qa: 'QA-023', qaDate: '2026-06-19',
      },
      {
        spi: 'SPI/2025-26/024', spiDate: '2026-06-22',
        amount: 40100, paid: 0, due: 40100, status: 'pending',
        grn: 'GRN-024', grnDate: '2026-06-26',
        qa: 'QA-024', qaDate: '2026-06-28',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 2,
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
        spi: 'SPI/2025-26/025', spiDate: '2026-06-27',
        amount: 129200, paid: 0, due: 129200, status: 'pending',
        grn: 'GRN-025', grnDate: '2026-07-01',
        qa: 'QA-025', qaDate: '2026-07-03',
      },
      {
        spi: 'SPI/2025-26/026', spiDate: '2026-07-06',
        amount: 129200, paid: 0, due: 129200, status: 'pending',
        grn: 'GRN-026', grnDate: '2026-07-10',
        qa: 'QA-026', qaDate: '2026-07-12',
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
        spi: 'SPI/2025-26/066', spiDate: '2026-04-23',
        amount: 102400, paid: 102400, due: 0, status: 'full',
        grn: 'GRN-066', grnDate: '2026-04-27',
        qa: 'QA-066', qaDate: '2026-04-29',
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
        spi: 'SPI/2025-26/043', spiDate: '2026-06-06',
        amount: 247400, paid: 247400, due: 0, status: 'full',
        grn: 'GRN-043', grnDate: '2026-06-10',
        qa: 'QA-043', qaDate: '2026-06-12',
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
        spi: 'SPI/2025-26/004', spiDate: '2026-06-26',
        amount: 124600, paid: 62300, due: 62300, status: 'partial',
        grn: 'GRN-004', grnDate: '2026-06-30',
        qa: 'QA-004', qaDate: '2026-07-02',
      },
      {
        spi: 'SPI/2025-26/005', spiDate: '2026-07-05',
        amount: 124500, paid: 0, due: 124500, status: 'pending',
        grn: 'GRN-005', grnDate: '2026-07-09',
        qa: 'QA-005', qaDate: '2026-07-11',
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
        spi: 'SPI/2025-26/046', spiDate: '2026-06-18',
        amount: 42800, paid: 0, due: 42800, status: 'pending',
        grn: 'GRN-046', grnDate: '2026-06-22',
        qa: 'QA-046', qaDate: '2026-06-24',
      },
      {
        spi: 'SPI/2025-26/047', spiDate: '2026-06-27',
        amount: 42800, paid: 0, due: 42800, status: 'pending',
        grn: 'GRN-047', grnDate: '2026-07-01',
        qa: 'QA-047', qaDate: '2026-07-03',
      },
      {
        spi: 'SPI/2025-26/048', spiDate: '2026-07-06',
        amount: 42900, paid: 0, due: 42900, status: 'pending',
        grn: 'GRN-048', grnDate: '2026-07-10',
        qa: 'QA-048', qaDate: '2026-07-12',
      },
    ],
    zohoSynced: false, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'ready', amount: 69400 },
  },
  {
    po: 'PO/2025-26/005', poDate: '2026-06-02', physicalInspection: false,
    type: 'services', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-008', opportunityDate: '2026-04-23',
    procurement: 'PROC-011', procurementDate: '2026-05-08',
    supplier: 'Larsen & Toubro', supplierCategory: 'star',
    risk: 'low',
    expectedDelivery: '2026-07-01',
    total: 135000, net: 132300, paid: 66200, balance: 66100,
    invoices: [
      {
        spi: 'SPI/2025-26/016', spiDate: '2026-06-09',
        amount: 132300, paid: 66200, due: 66100, status: 'partial',
        grn: 'GRN-016', grnDate: '2026-06-13',
        qa: 'QA-016', qaDate: '2026-06-15',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
    cancelled: true, cancelReason: 'Budget not approved for this quarter', cancelStage: 'initiated',
    // Part of the ₹66,200 paid is held back against cancellation charges, so
    // "Not Refunded" shows. Two notes raised; one recovery logged so far (45%).
    adr: { no: 'ADR/2025-26/031', date: '2026-07-04', count: 2, paid: 66200, credited: 56000 },
    recoveries: [25200],
  },
  {
    po: 'PO/2025-26/009', poDate: '2026-06-21', physicalInspection: true,
    type: 'materials', docType: 'Domestics',
    shipment: 'SHP-025', shipmentDate: '2026-06-09',
    opportunity: 'OPP-013', opportunityDate: '2026-05-12',
    procurement: 'PROC-018', procurementDate: '2026-05-27',
    supplier: 'JSW Steel', supplierCategory: 'regular',
    risk: 'medium',
    expectedDelivery: '2026-07-15',
    total: 270500, net: 270500, paid: 0, balance: 270500,
    invoices: [
      {
        spi: 'SPI/2025-26/028', spiDate: '2026-06-28',
        amount: 135300, paid: 0, due: 135300, status: 'pending',
        grn: 'GRN-028', grnDate: '2026-07-02',
        qa: 'QA-028', qaDate: '2026-07-04',
      },
      {
        spi: 'SPI/2025-26/029', spiDate: '2026-07-07',
        amount: 135200, paid: 0, due: 135200, status: 'pending',
        grn: 'GRN-029', grnDate: '2026-07-11',
        qa: 'QA-029', qaDate: '2026-07-13',
      },
    ],
    zohoSynced: false, inspectionDone: false, paymentRequests: 0,
    cancelled: true, cancelReason: 'Supplier unable to meet delivery timeline', cancelStage: 'initiated',
    // Cancelled before anything was paid: no note to raise, nothing to recover.
  },
  {
    po: 'PO/2025-26/020', poDate: '2026-05-21', physicalInspection: false,
    type: 'materials', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-026', opportunityDate: '2026-04-11',
    procurement: 'PROC-036', procurementDate: '2026-04-26',
    supplier: 'Godrej Industries', supplierCategory: 'regular',
    risk: 'low',
    expectedDelivery: '2026-06-27',
    total: 277500, net: 263600, paid: 263600, balance: 0,
    invoices: [
      {
        spi: 'SPI/2025-26/061', spiDate: '2026-05-28',
        amount: 87900, paid: 87900, due: 0, status: 'full',
        grn: 'GRN-061', grnDate: '2026-06-01',
        qa: 'QA-061', qaDate: '2026-06-03',
      },
      {
        spi: 'SPI/2025-26/062', spiDate: '2026-06-06',
        amount: 87900, paid: 87900, due: 0, status: 'full',
        grn: 'GRN-062', grnDate: '2026-06-10',
        qa: 'QA-062', qaDate: '2026-06-12',
      },
      {
        spi: 'SPI/2025-26/063', spiDate: '2026-06-15',
        amount: 87800, paid: 87800, due: 0, status: 'full',
        grn: 'GRN-063', grnDate: '2026-06-19',
        qa: 'QA-063', qaDate: '2026-06-21',
      },
    ],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
    cancelled: true, cancelReason: 'Supplier pricing revised beyond approved limit', cancelStage: 'closed',
    // Everything paid comes back and has been recovered in two entries — which
    // is exactly what put this PO in the Closed tab.
    adr: { no: 'ADR/2025-26/019', date: '2026-06-10', count: 1, paid: 263600, credited: 263600 },
    recoveries: [150000, 113600],
  },
];

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  full: 'Fully Paid',
  partial: 'Partially Paid',
  pending: 'Payment Not Initiated',
};

const seqOf = (id: string) => id.match(/(\d+)$/)?.[1] ?? id;

const formatMoney = (value: number) => '₹' + value.toLocaleString('en-IN');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-03-03" → "03-Mar-2026". Splits the text instead of new Date(), which reads
// the string as UTC and can show the previous day in timezones behind UTC.
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  const monthName = MONTHS[Number(month) - 1];
  if (!year || !day || !monthName) return iso;
  return `${day}-${monthName}-${year}`;
}

function IdCell({ id, date }: { id: string; date: string }) {
  return (
    <div className="ord-idcell">
      <span className="ord-idpill">{id}</span>
      <span className="ord-idcell__date">{formatDate(date)}</span>
    </div>
  );
}

function PoCell({ span, groupEnd, children }: { span: number; groupEnd?: boolean; children: ReactNode }) {
  const className = groupEnd ? 'ord-po-cell ord-table__group-end' : 'ord-po-cell';
  return <td rowSpan={span} className={className}>{children}</td>;
}

function DocTop({ label, index, count, id }: { label: string; index: number; count: number; id: string }) {
  return (
    <div className="ord-doc__top">
      <span className="ord-doc__seq">{label} {index + 1}/{count}</span>
      <span className="ord-idpill">{id}</span>
    </div>
  );
}

function InvoiceCells({ line, index, count }: { line: InvoiceLine; index: number; count: number }) {
  return (
    <>
      <td className="ord-doc ord-doc--spi">
        <div className="ord-doc__card">
          <DocTop label="SPI" index={index} count={count} id={line.spi} />
          <div className="ord-doc__meta">
            <span className="ord-doc__money">{formatMoney(line.amount)}</span>
            <span className="ord-doc__dot">·</span>
            <span>{formatDate(line.spiDate)}</span>
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
            <span>{formatDate(line.grnDate)}</span>
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
            <span>{formatDate(line.qaDate)}</span>
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
// Money coming back — the return arrow.
const ICON_RECOVER = (
  <svg {...btnIconProps} strokeWidth={2.2}>
    <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </svg>
);
const ICON_NOTE = (
  <svg {...btnIconProps} strokeWidth={2.6}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const ICON_VAULT = (
  <svg {...btnIconProps} strokeWidth={2.1}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
  </svg>
);

// Cancelled POs are read-only: their action buttons render disabled.
function ZohoCell({ synced, cancelled = false }: { synced: boolean; cancelled?: boolean }) {
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
      <button type="button" className="ord-btn ord-btn--zoho" disabled={cancelled}>{ICON_SYNC}<span>Zoho Sync</span></button>
    </div>
  );
}

function InspectionCell({ required, done, cancelled = false, onOpen }: {
  required: boolean; done: boolean; cancelled?: boolean; onOpen: () => void;
}) {
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
      <button type="button" className={`ord-btn ord-btn--insp${done ? ' is-done' : ''}`} disabled={cancelled} onClick={onOpen}>
        {done ? ICON_TICK : ICON_EYE}
        <span>{done ? 'Inspection Done' : 'Physical Inspection'}</span>
      </button>
    </div>
  );
}

function PaymentCell({ row, onManage }: { row: OrderRow; onManage: (row: OrderRow) => void }) {
  const pct = row.net > 0 ? Math.round((row.paid / row.net) * 100) : 0;
  const status: PaymentStatus = pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'pending';
  const label = status === 'full' ? 'Payment Completed' : PAYMENT_LABEL[status];
  const done = status === 'full';
  const isReady = row.paymentNote?.kind === 'ready';

  const noteText = !row.paymentNote ? ''
    : row.paymentNote.kind === 'ready'
      ? `${formatMoney(row.paymentNote.amount)} approved · ready to pay`
      : `${formatMoney(row.paymentNote.amount)} awaiting approval`;

  return (
    <div className="ord-paycell">

      <div className={`ord-progress is-${status}`}>
        <div className="ord-progress__top">
          <span className={`ord-pill ord-pill--${status}`}><span className="ord-pill__dot" />{label}</span>
          <span className="ord-progress__pct">{pct}%</span>
        </div>
        <div className="ord-progress__bar">

          <div className="ord-progress__fill" style={{ width: `${pct}%` }}>
            <span className="ord-progress__sheen" />
          </div>
        </div>
        <div className="ord-progress__meta">
          <span className="ord-progress__paid"><span className="ord-progress__mdot" />{formatMoney(row.paid)} paid</span>
          <span className="ord-progress__due"><span className="ord-progress__mdot" />{formatMoney(row.balance)} due</span>
        </div>

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

      <button
        type="button"
        className={`ord-btn ord-btn--hist${done ? ' is-record' : ''}`}
        disabled={!!row.cancelled}
        onClick={() => onManage(row)}
      >
        {done ? ICON_EYE : ICON_HISTORY}
        <span>{done ? 'View Request Details' : 'Manage Payment Requests'}</span>

        {row.paymentRequests > 0 && (
          <i className={`ord-btn__count${isReady ? ' ord-btn__count--ready' : ''}`}>{row.paymentRequests}</i>
        )}
      </button>
    </div>
  );
}

/* Advance Receipt Refund Adjustment — answers three things and no more: which
   note, what went out, and what is coming back. The shortfall is only named
   when the two don't match. The progress bar belongs to Payment Recovery
   Status, which is where the movement actually happens. */
function AdrCell({ adr }: { adr?: AdvanceRefund }) {
  if (!adr) return <span className="ord-dash">—</span>;

  const notRefunded = Math.max(0, adr.paid - adr.credited);
  const title = (adr.count > 1 ? `${adr.count} credit notes — latest shown. ` : '')
    + `Open ${adr.no} to view or update it`;

  return (
    <div className="ord-adr">
      <button type="button" className="ord-adr__ref" title={title}>
        <span className="ord-adr__no">{adr.no}</span>
        {adr.count > 1 && <span className="ord-adr__n">+{adr.count - 1}</span>}
      </button>
      <div className="ord-adr__dt">{formatDate(adr.date)}</div>
      <div className="ord-adr__fig">
        <AdrRow label="Paid" value={formatMoney(adr.paid)} />
        <AdrRow label="To Be Refunded" value={formatMoney(adr.credited)} tone="refund" />
        {notRefunded > 0 && <AdrRow label="Not Refunded" value={formatMoney(notRefunded)} tone="none" />}
      </div>
    </div>
  );
}

function AdrRow({ label, value, tone }: { label: string; value: string; tone?: 'refund' | 'none' }) {
  return (
    <div className={`ord-adr__row${tone ? ` ord-adr__row--${tone}` : ''}`}>
      <span className="ord-adr__l">{label}</span>
      <span className="ord-adr__v">{value}</span>
    </div>
  );
}

/* What the supplier owes back is what the credit note says, not everything
   that was paid — an amount retained against cancellation charges is never
   coming back. So the note sets the target, and until one exists there is
   nothing to recover against. */
function recoveryOf(row: OrderRow) {
  const target = row.adr ? row.adr.credited : 0;
  const entries = row.recoveries?.length ?? 0;
  const logged = (row.recoveries ?? []).reduce((sum, amount) => sum + amount, 0);
  const recovered = Math.min(logged, target);
  return {
    paid: row.paid,
    target,
    noteRaised: !!row.adr,
    noteNo: row.adr?.no ?? '',
    recovered,
    pending: Math.max(0, target - recovered),
    pct: target > 0 ? Math.round((recovered / target) * 100) : 0,
    entries,
    started: entries > 0,
    complete: target > 0 && recovered >= target,
  };
}

/* Payment Recovery Status — the mirror of Payment Progress for money coming
   back rather than going out. It reuses that cell's progress, pill and note
   styles; only the two states Payment Progress never has are new. */
function RecoveryCell({ row }: { row: OrderRow }) {
  const g = recoveryOf(row);
  const entryWord = (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`;

  // Nothing released → nothing to recover. Say so rather than draw an empty bar.
  if (g.paid <= 0) {
    return (
      <div className="ord-paycell">
        <div className="ord-progress ord-progress--na">
          <div className="ord-progress__top">
            <span className="ord-pill ord-pill--na"><span className="ord-pill__dot" />Not Applicable</span>
          </div>
          <span className="ord-recnote is-na">Nothing released on this PO</span>
        </div>
      </div>
    );
  }

  const tip = !g.noteRaised ? 'Raise the supplier credit note before recording any recovery'
    : g.complete ? `Fully recovered under ${g.noteNo} — open the record of ${entryWord(g.entries)}`
      : g.started ? `${formatMoney(g.pending)} still to recover from the supplier`
        : `Nothing recovered yet — ${formatMoney(g.target)} is recoverable under ${g.noteNo}`;

  const button = (
    <button
      type="button"
      className={`ord-btn ord-btn--hist${g.complete ? ' is-record' : ''}`}
      disabled={!g.noteRaised}
      title={tip}
    >
      {ICON_RECOVER}
      <span>{g.complete ? 'Recovery Complete' : 'Manage Recovery'}</span>
      {g.entries > 0 && (
        <i className={`ord-btn__count${g.complete ? ' ord-btn__count--ready' : ''}`}>{g.entries}</i>
      )}
    </button>
  );

  // Paid out, but no credit note yet — the note decides what is recoverable.
  if (!g.noteRaised) {
    return (
      <div className="ord-paycell">
        <div className="ord-progress">
          <div className="ord-progress__top">
            <span className="ord-pill ord-pill--await"><span className="ord-pill__dot" />Awaiting Credit Note</span>
          </div>
          <span className="ord-recnote" title={`The credit note sets how much of ${formatMoney(g.paid)} paid out is recoverable`}>
            Credit note sets the recoverable amount
          </span>
        </div>
        {button}
      </div>
    );
  }

  // Reuses Payment Progress's three states: full / partial / pending.
  const status: PaymentStatus = g.complete ? 'full' : g.started ? 'partial' : 'pending';
  const label = g.complete ? 'Fully Recovered' : g.started ? 'Partially Recovered' : 'Recovery Not Started';
  const noteTitle = `${formatMoney(g.target)} recoverable under ${g.noteNo}`
    + (g.entries ? ` · ${entryWord(g.entries)}` : '');

  return (
    <div className="ord-paycell">
      <div className={`ord-progress is-${status}`}>
        <div className="ord-progress__top">
          <span className={`ord-pill ord-pill--${status}`}><span className="ord-pill__dot" />{label}</span>
          <span className="ord-progress__pct">{g.pct}%</span>
        </div>
        <div className="ord-progress__bar">
          <div className="ord-progress__fill" style={{ width: `${g.pct}%` }}>
            <span className="ord-progress__sheen" />
          </div>
        </div>
        <div className="ord-progress__meta">
          <span className="ord-progress__paid"><span className="ord-progress__mdot" />{formatMoney(g.recovered)} recovered</span>
          <span className="ord-progress__due"><span className="ord-progress__mdot" />{formatMoney(g.pending)} pending</span>
        </div>
        <span className={`ord-paynote ord-paynote--${g.complete ? 'ready' : 'waiting'}`} title={noteTitle}>
          {ICON_NOTE}
          {g.noteNo}{g.entries > 0 && ` · ${entryWord(g.entries)}`}
        </span>
      </div>
      {button}
    </div>
  );
}

function ActionCell({ cancelled = false, cancelReason, onEdit }: {
  cancelled?: boolean; cancelReason?: string; onEdit: () => void;
}) {
  return (
    <div className="ord-actions">
      {cancelled ? (
        <button type="button" className="ord-btn ord-btn--cancel is-cancelled" disabled title={cancelReason || 'This PO has been cancelled'}>
          {ICON_CANCEL}<span>Cancelled</span>
        </button>
      ) : (
        <button type="button" className="ord-btn ord-btn--cancel" title="Cancel this Purchase Order">{ICON_CANCEL}<span>Cancel PO</span></button>
      )}
      <button type="button" className="ord-btn ord-btn--edit" disabled={cancelled} onClick={onEdit}>{ICON_EDIT}<span>Edit PO</span></button>
      <button type="button" className="ord-btn ord-btn--vault">{ICON_VAULT}<span>Evidence Vault</span></button>
    </div>
  );
}

const ICON_X_SM = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Red "Cancelled" chip under the PO number; hover shows the reason.
function CancelBadge({ reason }: { reason?: string }) {
  return <Badge appearance="outline" variant="danger" icon={ICON_X_SM} className="ord-cancelbadge" title={reason}>Cancelled</Badge>;
}

function inTab(row: OrderRow, tab: TabKey): boolean {
  if (tab === 'with') return row.shipment !== null;
  if (tab === 'without') return row.shipment === null;
  // A cancelled PO with no recorded stage is still awaiting recovery.
  if (tab === 'cancelinit') return !!row.cancelled && row.cancelStage !== 'closed';
  if (tab === 'cancelclosed') return !!row.cancelled && row.cancelStage === 'closed';
  return true;
}

function searchTextOf(row: OrderRow): string {
  return [

    row.po, row.poDate, formatDate(row.poDate), formatDate(row.expectedDelivery),
    PO_TYPE[row.type].label, row.docType,
    row.shipment ?? '', row.opportunity, row.procurement,
    row.supplier, SUPPLIER_CATEGORY[row.supplierCategory].label,
    RISK_LEVEL[row.risk].label, row.expectedDelivery,
    row.zohoSynced ? 'Synced' : 'Not Sync',
    ...row.invoices.flatMap((line) => [line.spi, line.grn, line.qa]),
  ].join(' ').toLowerCase();
}

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;

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

function OrderCard({ row, index, onManage, onInspect, onEdit, inspected }: {
  row: OrderRow; index: number; onManage: (row: OrderRow) => void; onInspect: (row: OrderRow) => void;
  onEdit: (row: OrderRow) => void; inspected: boolean;
}) {
  const category = SUPPLIER_CATEGORY[row.supplierCategory];
  const risk = RISK_LEVEL[row.risk];
  const count = row.invoices.length;

  return (
    <article className={`ord-card${row.cancelled ? ' ord-card--cancelled' : ''}`}>

      <div className="ord-card__head">
        <span className="ord-srnum">{index + 1}</span>
        <div className="ord-card__po">
          <span className="ord-idpill">{row.po}</span>
          <span className="ord-idcell__date">{formatDate(row.poDate)}</span>
        </div>
        <span className={`ord-typepill ord-typepill--${row.type}`}>
          <span className="ord-typepill__ico">{PO_TYPE[row.type].icon}</span>
          {PO_TYPE[row.type].label}
        </span>
      </div>

      <div className="ord-card__tags">
        <span className={`ord-doctype ord-doctype--${row.docType === 'International' ? 'intl' : 'dom'}`}>{row.docType}</span>
        {row.physicalInspection && (
          <Badge appearance="outline" variant="danger" icon={ICON_WARN} className="ord-physinsp">Physical Inspection</Badge>
        )}
        {row.cancelled && <CancelBadge reason={row.cancelReason} />}
      </div>

      <div className="ord-card__split">
        <div className="ord-card__block">
          <span className="ord-card__label">Supplier</span>
          <span className="ord-supplier__name">{row.supplier}</span>
          <Badge appearance="outline" variant={category.variant} icon={category.icon} className="ord-supplier__cat">{category.label}</Badge>
        </div>
        <div className="ord-card__block ord-card__block--end">
          <span className="ord-card__label">Risk Alert</span>
          <Badge appearance="outline" variant={risk.variant} icon={risk.icon} className="ord-risk">{risk.label}</Badge>
        </div>
      </div>

      <dl className="ord-card__grid">
        <div>
          <dt>Shipment ID</dt>
          <dd>{row.shipment ? <IdCell id={row.shipment} date={row.shipmentDate} /> : <span className="ord-dash">—</span>}</dd>
        </div>
        <div><dt>Opportunity ID</dt><dd><IdCell id={row.opportunity} date={row.opportunityDate} /></dd></div>
        <div><dt>Procurement ID</dt><dd><IdCell id={row.procurement} date={row.procurementDate} /></dd></div>
        <div><dt>Expected Delivery</dt><dd><span className="ord-edd">{formatDate(row.expectedDelivery)}</span></dd></div>
      </dl>

      <dl className="ord-card__grid">
        <div><dt>Total PO Amount</dt><dd><span className="ord-amt">{formatMoney(row.total)}</span></dd></div>
        <div><dt>Net Payable</dt><dd><span className="ord-amt ord-amt--net">{formatMoney(row.net)}</span></dd></div>
        <div><dt>Total Paid</dt><dd><span className="ord-amt ord-amt--paid">{formatMoney(row.paid)}</span></dd></div>
        <div><dt>Balance</dt><dd><span className="ord-amt ord-amt--bal">{formatMoney(row.balance)}</span></dd></div>
      </dl>

      <div className="ord-card__section">
        <span className="ord-card__label">Mapped SPI / GRN / QA ({count})</span>
        {count === 0 && <span className="ord-dash">—</span>}
        {row.invoices.map((line, i) => (
          <div className="ord-card__invoice" key={line.spi}>
            <DocTop label="SPI" index={i} count={count} id={line.spi} />
            <div className="ord-doc__meta">
              <span className="ord-doc__money">{formatMoney(line.amount)}</span>
              <span className="ord-doc__dot">·</span>
              <span>{formatDate(line.spiDate)}</span>
            </div>
            <div className="ord-doc__foot">
              <span className={`ord-pill ord-pill--${line.status}`}><span className="ord-pill__dot" />{PAYMENT_LABEL[line.status]}</span>
              <span className="ord-doc__sub">
                <b className="ord-doc__paid">{formatMoney(line.paid)}</b> paid · <b className="ord-doc__due">{formatMoney(line.due)}</b> due
              </span>
            </div>
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.grn}</span>
              <span className="ord-doc__sub">Received · {formatDate(line.grnDate)}</span>
              <span className="ord-pill ord-pill--received"><span className="ord-pill__dot" />Goods Received</span>
            </div>
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.qa}</span>
              <span className="ord-doc__sub">Inspected · {formatDate(line.qaDate)}</span>
              <span className="ord-pill ord-pill--qa"><span className="ord-pill__dot" />QA Passed</span>
            </div>
          </div>
        ))}
      </div>

      <div className="ord-card__status">
        <div className="ord-card__block">
          <span className="ord-card__label">Zohobook Status</span>
          <ZohoCell synced={row.zohoSynced} cancelled={row.cancelled} />
        </div>
        <div className="ord-card__block">
          <span className="ord-card__label">Physical Inspection</span>
          <InspectionCell required={row.physicalInspection} done={inspected} cancelled={row.cancelled} onOpen={() => onInspect(row)} />
        </div>
      </div>

      <div className="ord-card__section">
        <span className="ord-card__label">Payment Progress</span>
        <PaymentCell row={row} onManage={onManage} />
      </div>

      {/* Only worth a section on the card when a note actually exists. */}
      {row.adr && (
        <div className="ord-card__section">
          <span className="ord-card__label">Advance Receipt Refund Adjustment</span>
          <AdrCell adr={row.adr} />
        </div>
      )}

      <div className="ord-card__section">
        <span className="ord-card__label">Payment Recovery</span>
        <RecoveryCell row={row} />
      </div>

      <ActionCell cancelled={row.cancelled} cancelReason={row.cancelReason} onEdit={() => onEdit(row)} />
    </article>
  );
}

export default function Order() {

  const [guideOpen, setGuideOpen] = useState(false);

  const toggleGuide = () => setGuideOpen((open) => !open);

  // Rows are static sample data today, so this flag only covers the first
  // paint. When the list API is connected it becomes that request's state.
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Create PO runs in two screens: the link popup, then the full-page form.
  const [createOpen, setCreateOpen] = useState(false);
  const [poLink, setPoLink] = useState<PoLink | null>(null);

  // Edit PO opens the same form, straight past the link popup, pre-filled from
  // the row (the form matches the supplier and fills the rest itself).
  const openEdit = (row: OrderRow) => setPoLink({
    mode: row.shipment ? 'with' : 'without',
    shipmentId: row.shipment ?? undefined,
    edit: {
      po: row.po,
      opportunity: row.opportunity,
      procurement: row.procurement,
      supplier: row.supplier,
      poType: PO_TYPE[row.type].label,
      docType: row.docType,
      deliveryDate: row.expectedDelivery,
      physInsp: row.physicalInspection,
    },
  });

  const [payRow, setPayRow] = useState<OrderRow | null>(null);
  const [payStartRaise, setPayStartRaise] = useState(false);

  const [inspectRow, setInspectRow] = useState<OrderRow | null>(null);
  const [inspections, setInspections] = useState<Record<string, InspectionRecord | null>>({});
  const [inspDrafts, setInspDrafts] = useState<Record<string, InspectionDraft>>({});
  const inspectedOf = (r: OrderRow) => (r.po in inspections ? !!inspections[r.po] : r.inspectionDone);
  const inspectPo = inspectRow?.po ?? '';

  const [activeTab, setActiveTab] = useState<TabKey>('all');

  const [search, setSearch] = useState('');

  const isPhone = useIsPhone();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return SAMPLE_ROWS
      .filter((row) => inTab(row, activeTab))
      .filter((row) => term === '' || searchTextOf(row).includes(term));
  }, [activeTab, search]);

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { all: 0, with: 0, without: 0, cancelinit: 0, cancelclosed: 0 };
    for (const row of SAMPLE_ROWS) {
      for (const tab of LIST_TABS) {
        if (inTab(row, tab.key)) counts[tab.key] += 1;
      }
    }
    return counts;
  }, []);

  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const cardsRef = useRef<HTMLDivElement>(null);
  const scrollListToTop = () => {
    scrollRef.current?.scrollTo({ top: 0 });
    cardsRef.current?.scrollTo({ top: 0 });
  };

  const goToPage = (next: number) => {
    setPage(next);
    scrollListToTop();
  };

  // Anything that changes which rows are listed goes back to page 1.
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<number | undefined>(undefined);

  // Ignore the mouse while scrolling so hover animations don't repaint mid-scroll.
  // Refs, not state: scroll fires many times a second and must not re-render.
  const onTableScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.add('is-scrolling');

    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 150);
  };

  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);

  const onGuideKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleGuide();
    }
  };

  return (
    <div className="ord-page">

      {/* Mounted only while open, so the scroll lock and key listener exist only then. */}
      {createOpen && (
        <CreatePoModal
          initial={poLink}
          onClose={() => setCreateOpen(false)}
          onConfirm={(link) => { setPoLink(link); setCreateOpen(false); }}
        />
      )}

      {poLink && !createOpen && (
        <Suspense fallback={<CreatePoSkeleton />}>
          <CreatePoForm
            key={poLink.edit?.po ?? 'new'}
            link={poLink}
            onClose={() => setPoLink(null)}
            onChangeLink={() => setCreateOpen(true)}
          />
        </Suspense>
      )}

      {inspectRow && (
        <Suspense fallback={null}>
          <PhysicalInspectionModal
            row={inspectRow}
            record={inspectPo in inspections ? inspections[inspectPo] : undefined}
            draft={inspDrafts[inspectPo]}
            onDraftChange={(d) => setInspDrafts((prev) => ({ ...prev, [inspectPo]: d }))}
            onSignOff={(r) => {
              setInspections((prev) => ({ ...prev, [inspectPo]: r }));
              setInspectRow(null);
            }}
            onWithdraw={() => {
              setInspections((prev) => ({ ...prev, [inspectPo]: null }));
              setInspDrafts((prev) => {
                const next = { ...prev };
                delete next[inspectPo];
                return next;
              });
              setInspectRow(null);
            }}
            onContinue={() => {
              const r = inspectRow;
              setInspectRow(null);
              setPayStartRaise(true);
              setPayRow(r);
            }}
            onClose={() => setInspectRow(null)}
          />
        </Suspense>
      )}

      {payRow && (
        <Suspense fallback={null}>
          <ManagePaymentRequestsModal
            row={payRow}
            startWithRaise={payStartRaise}
            onClose={() => { setPayRow(null); setPayStartRaise(false); }}
          />
        </Suspense>
      )}

      {/* Header strip, guide, tabs and search use the shared SPI styles (spi-*). */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </div>
          <div>
            <div className="spi-head-title">Purchase Order (PO)</div>
            <div className="spi-head-sub">
              Create and manage purchase orders to suppliers — from PO generation to e-signed documents and payment.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setCreateOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create PO
        </button>
      </div>

      <div className={`spi-bref${guideOpen ? '' : ' is-collapsed'}`}>
        <div
          className="spi-bref-head"
          role="button"
          tabIndex={0}
          aria-expanded={guideOpen}
          onClick={toggleGuide}
          onKeyDown={onGuideKey}
        >
          <div className="spi-bref-ico">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Purchase Order</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Link the supplier, add products and terms, manage post-PO trade documents with e-signature, and complete payment — end to end in one place.
            </div>
          </div>
          <div className="spi-bref-toggle">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <div className="spi-bref-body">
          {GUIDE_STEPS.map((step) => (
            <div className="spi-step" key={step.num}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{step.icon}</span>
                <span className="spi-step-num">{step.num}</span>
              </div>
              <div className="spi-step-title">{step.title}</div>
              <div className="spi-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="spi-card ord-list">
        <div className="spi-segrow">

          <div className="spi-seg" role="tablist" aria-label="Purchase order views">
            {LIST_TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              const classes = [
                'spi-seg-btn',
                tab.danger ? 'ord-seg-danger' : '',
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
                  <span className="spi-seg-ico">{tab.icon}</span>
                  <span className="ord-seg-lbl">
                    {tab.label}
                    {tab.sub && <span className="ord-seg-sub">{tab.sub}</span>}
                  </span>
                  <span className="spi-seg-c">{tabCounts[tab.key]}</span>
                </button>
              );
            })}
          </div>

          <div className="spi-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>

            <input
              type="text"
              aria-label="Search purchase orders"
              placeholder="Search PO, supplier, ID or status..."
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>

        </div>

        {loading ? (
          <OrderListSkeleton phone={isPhone} />
        ) : rows.length === 0 ? (
          <div className="ord-empty">
            {search.trim()
              ? 'No purchase orders match your search.'
              : 'No purchase orders to display in this category.'}
          </div>
        ) : isPhone ? (
          <div className="ord-cards" ref={cardsRef}>

            {pageRows.map((row, index) => (
              <OrderCard
                key={row.po}
                row={row}
                index={start + index}
                onManage={setPayRow}
                onInspect={setInspectRow}
                onEdit={openEdit}
                inspected={inspectedOf(row)}
              />
            ))}
          </div>
        ) : (

        <div className="ord-table-scroll" ref={scrollRef} onScroll={onTableScroll}>
          <table className="ord-table" style={{ width: TABLE_WIDTH }}>

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

            {pageRows.map((row, poIndex) => {

              const lines = row.invoices.length > 0 ? row.invoices : [null];
              const span = lines.length;

              return (
                <tbody key={row.po} className={row.cancelled ? 'ord-po--cancelled' : undefined}>
                  {lines.map((line, lineIndex) => {
                    const isFirst = lineIndex === 0;
                    const isLast = lineIndex === span - 1;
                    const rowClass = [isFirst ? 'is-first' : '', isLast ? 'is-last' : '']
                      .filter(Boolean).join(' ');

                    return (
                      <tr key={line ? line.spi : 'no-invoice'} className={rowClass || undefined}>

                        {isFirst && (
                          <>

                            <PoCell span={span}><span className="ord-srnum">{start + poIndex + 1}</span></PoCell>

                            <PoCell span={span}>
                              <IdCell id={row.po} date={row.poDate} />
                              {row.physicalInspection && (
                                <Badge appearance="outline" variant="danger" icon={ICON_WARN} className="ord-physinsp">Physical Inspection</Badge>
                              )}
                              {row.cancelled && <CancelBadge reason={row.cancelReason} />}
                            </PoCell>

                            <PoCell span={span}>
                              <span className={`ord-typepill ord-typepill--${row.type}`}>
                                <span className="ord-typepill__ico">{PO_TYPE[row.type].icon}</span>
                                {PO_TYPE[row.type].label}
                              </span>
                            </PoCell>

                            <PoCell span={span}>
                              <span className={`ord-doctype ord-doctype--${row.docType === 'International' ? 'intl' : 'dom'}`}>
                                {row.docType}
                              </span>
                            </PoCell>

                            <PoCell span={span}>
                              {row.shipment
                                ? <IdCell id={row.shipment} date={row.shipmentDate} />
                                : <span className="ord-dash">—</span>}
                            </PoCell>
                            <PoCell span={span}><IdCell id={row.opportunity} date={row.opportunityDate} /></PoCell>
                            <PoCell span={span}><IdCell id={row.procurement} date={row.procurementDate} /></PoCell>

                            <PoCell span={span}>
                              <div className="ord-supplier">
                                <span className="ord-supplier__name" title={row.supplier}>{row.supplier}</span>
                                <Badge
                                  appearance="outline"
                                  variant={SUPPLIER_CATEGORY[row.supplierCategory].variant}
                                  icon={SUPPLIER_CATEGORY[row.supplierCategory].icon}
                                  className="ord-supplier__cat"
                                >
                                  {SUPPLIER_CATEGORY[row.supplierCategory].label}
                                </Badge>
                              </div>
                            </PoCell>

                            <PoCell span={span}>
                              <Badge appearance="outline" variant={RISK_LEVEL[row.risk].variant} icon={RISK_LEVEL[row.risk].icon} className="ord-risk">
                                {RISK_LEVEL[row.risk].label}
                              </Badge>
                            </PoCell>

                            <PoCell span={span}><span className="ord-edd">{formatDate(row.expectedDelivery)}</span></PoCell>

                            <PoCell span={span}><span className="ord-amt">{formatMoney(row.total)}</span></PoCell>
                            <PoCell span={span}><span className="ord-amt ord-amt--net">{formatMoney(row.net)}</span></PoCell>
                            <PoCell span={span}><span className="ord-amt ord-amt--paid">{formatMoney(row.paid)}</span></PoCell>
                            <PoCell span={span} groupEnd>
                              <span className="ord-amt ord-amt--bal">{formatMoney(row.balance)}</span>
                            </PoCell>
                          </>
                        )}

                        {line ? (
                          <InvoiceCells line={line} index={lineIndex} count={span} />
                        ) : (
                          <>
                            <td className="ord-doc ord-doc--spi"><span className="ord-dash">—</span></td>
                            <td className="ord-doc ord-doc--grn"><span className="ord-dash">—</span></td>
                            <td className="ord-doc ord-doc--qa"><span className="ord-dash">—</span></td>
                          </>
                        )}

                        {isFirst && (
                          <>
                            <PoCell span={span}><ZohoCell synced={row.zohoSynced} cancelled={row.cancelled} /></PoCell>
                            <PoCell span={span}>
                              <InspectionCell required={row.physicalInspection} done={inspectedOf(row)} cancelled={row.cancelled} onOpen={() => setInspectRow(row)} />
                            </PoCell>
                            <PoCell span={span}><PaymentCell row={row} onManage={setPayRow} /></PoCell>
                            <PoCell span={span}><AdrCell adr={row.adr} /></PoCell>
                            <PoCell span={span}><RecoveryCell row={row} /></PoCell>
                            <PoCell span={span}><ActionCell cancelled={row.cancelled} cancelReason={row.cancelReason} onEdit={() => openEdit(row)} /></PoCell>
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

/* Shown for the moment the PO form's code is being fetched. It mirrors the
   form's own layout — header, four step cards, two field sections — so the
   screen doesn't jump when the real thing arrives. Shimmer classes come from
   the shared P2P wizard styles this page already loads. */
function CreatePoSkeleton() {
  return (
    <div className="spi-dt-overlay ord-skl">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-sk spi-dt-sk-ico" />
            <div className="ord-skl-title">
              <div className="spi-dt-sk spi-dt-sk-line ord-skl-w180" />
              <div className="spi-dt-sk spi-dt-sk-line ord-skl-w120 ord-skl-thin" />
            </div>
          </div>
          <div className="spi-dt-steps ord-skl-steps">
            {[0, 1, 2, 3].map((i) => <div key={i} className="spi-dt-sk ord-skl-step" />)}
          </div>
        </div>
        {[0, 1].map((s) => (
          <div className="spi-dt-sec" key={s}>
            <div className="spi-dt-sec-head">
              <div className="spi-dt-sk spi-dt-sk-ico" />
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sk spi-dt-sk-line ord-skl-w200" />
                <div className="spi-dt-sk spi-dt-sk-line ord-skl-w280 ord-skl-thin" />
              </div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-grid4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}>
                    <div className="spi-dt-sk spi-dt-sk-line ord-skl-w84 ord-skl-thin" />
                    <div className="spi-dt-sk spi-dt-sk-field" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* List shimmer. Mirrors the real grid — same column widths, same two-line
   invoice rows — so the table doesn't jump when the rows arrive. On a phone it
   mirrors the cards instead. The shimmer bar is a shared P2P style. */
function OrderListSkeleton({ phone }: { phone: boolean }) {
  if (phone) {
    return (
      <div className="ord-cards">
        {Array.from({ length: 3 }).map((_, i) => (
          <div className="ord-card ord-skel-card" key={i}>
            <div className="ord-skel-row">
              <span className="spi-sk-bar ord-skel-w120" />
              <span className="spi-sk-bar ord-skel-w64" />
            </div>
            {Array.from({ length: 6 }).map((__, j) => (
              <div className="ord-skel-row" key={j}>
                <span className="spi-sk-bar ord-skel-w96" />
                <span className="spi-sk-bar ord-skel-w140" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ord-table-scroll">
      <table className="ord-table" style={{ width: TABLE_WIDTH }}>
        <colgroup>
          {COLUMNS.map((col) => <col key={col.label} style={{ width: col.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>{col.label}</th>
            ))}
          </tr>
        </thead>
        {Array.from({ length: 4 }).map((_, rowIndex) => (
          <tbody key={rowIndex}>
            {[0, 1].map((line) => (
              <tr key={line} className="ord-skel-tr">
                {COLUMNS.map((col) => (
                  <td key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>
                    <span className="spi-sk-bar" style={{ width: Math.round(col.width * 0.6) }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
