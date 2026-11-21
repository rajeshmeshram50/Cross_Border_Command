import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import WorklistPager from '../../../../../components/ui/WorklistPager';
import SearchClear from '../../../../../components/ui/SearchClear';
import Badge, { type BadgeVariant } from '../../../../../components/ui/Badge';
import CreatePoModal from '../create-po/CreatePoModal';
import { FitTip } from '../create-po/form-fields';
import { PoApiError, poApi, type PoListRow } from '../api/po-api';
import { useDebouncedValue } from '../../../../../hooks/useDebouncedValue';
import Tooltip from '../../../../../components/ui/Tooltip';
import { useServerList } from '../../../../../hooks/useServerList';
import { useFitPageSize } from '../../../../../hooks/useFitPageSize';
import { useToast } from '../../../../../contexts/ToastContext';
import { ccyCode, ccySymbol } from '../../../../../utils/currency';
import Amount from '../../../../../components/ui/Amount';
const RecoverPaymentModal = lazy(() => import('../../../payment-management/advance-refund/RecoverPaymentModal'));
import type { PoLink } from '../create-po/CreatePoForm';
const CreatePoForm = lazy(() => import('../create-po/CreatePoForm'));
const PhysicalInspectionModal = lazy(() => import('../physical-inspection/PhysicalInspectionModal'));
const CancelPoModal = lazy(() => import('../cancel-po/CancelPoModal'));
const ZohoTrackerModal = lazy(() => import('./ZohoTrackerModal'));
const PoEvidenceVaultModal = lazy(() => import('../evidence-vault/PoEvidenceVaultModal'));
const ManagePaymentRequestsModal = lazy(() => import('../manage-payment/ManagePaymentRequestsModal'));
import '../../../p2p-detail.css';
import './order.css';

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

export type Column = { label: string; width: number; groupEnd?: boolean };

export const ORDER_COLUMNS: Column[] = [
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
  { label: 'Total PO Amount',            width: 126 },
  { label: 'Net Payable Amount',         width: 130 },
  { label: 'Total Paid Amount',          width: 122 },
  { label: 'Balance Amount',             width: 126, groupEnd: true },
  { label: "Mapped SPI's",               width: 188 },
  { label: "GRN ID's",                   width: 158 },
  { label: "QA ID's",                    width: 158 },
  { label: 'Zohobook Status',            width: 134 },
  { label: 'Physical Inspection Status', width: 190 },
  { label: 'Payment Progress Status',    width: 246 },
  { label: 'Advance Receipt Refund Adjustment', width: 238 },
  { label: 'Payment Recovery Status',    width: 246 },
  { label: 'PO Status',                  width: 118 },
  { label: 'Action',                     width: 530 },
];

const TABLE_WIDTH = ORDER_COLUMNS.reduce((total, col) => total + col.width, 0);

type PaymentStatus = 'full' | 'partial' | 'pending';

export type InvoiceLine = {
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
  no: string;
  date: string;
  count: number;
  paid: number;
  credited: number;
};

export type OrderRow = {
  id?: number;
  draft?: boolean;
  po: string; poDate: string; physicalInspection: boolean;
  type: PoType; docType: DocType;
  currency?: string | null;
  shipment: string | null; shipmentDate: string;
  opportunity: string; opportunityDate: string;
  procurement: string; procurementDate: string;
  supplier: string; supplierCategory: SupplierCategory;
  supplierCategoryText?: string;
  risk: RiskLevel | null;
  expectedDelivery: string;
  total: number; net: number; paid: number; balance: number;
  breakdown?: { base: number; gst: number; extra: number };
  supplierCode?: string;
  invoices: InvoiceLine[];
  spis?: { code: string; date: string }[];
  zohoSynced: boolean;
  zohoStarted: boolean;
  inspectionDone: boolean;
  paymentRequests: number;
  paymentNote?: PaymentNote;
  cancelled?: boolean;
  cancelReason?: string;
  signingStarted?: boolean;
  adr?: AdvanceRefund;
  recoveries?: number[];
  cancelStage?: 'initiated' | 'closed';
  refundId?: number;
  recoveredAmt?: number;
  zohoError?: string;
  zohoUnposted?: number;
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

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  full: 'Fully Paid',
  partial: 'Partially Paid',
  pending: 'Payment Not Initiated',
};

const seqOf = (id: string) => id.match(/(\d+)$/)?.[1] ?? id;

const formatMoney = (value: number, ccy?: string | null) => {
  const code = ccyCode(ccy);
  return ccySymbol(code) + (value || 0).toLocaleString(code === 'INR' ? 'en-IN' : 'en-US');
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  const monthName = MONTHS[Number(month) - 1];
  if (!year || !day || !monthName) return iso;
  return `${day}-${monthName}-${year}`;
}

function categoryOf(row: OrderRow) {
  if (row.supplierCategoryText) return { label: row.supplierCategoryText, variant: 'info' as BadgeVariant, icon: ICON_CHECK };
  return SUPPLIER_CATEGORY[row.supplierCategory];
}

const API_PO_TYPE: Record<string, PoType> = { material_goods: 'materials', services: 'services', ffd_transporter: 'ffd' };

function riskOf(name: string | null): RiskLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('high')) return 'high';
  if (n.includes('medium')) return 'medium';
  if (n.includes('low')) return 'low';
  return null;
}

export function categoryKeyOf(text: string | null): SupplierCategory | null {
  const t = (text ?? '').toLowerCase();
  if (t.includes('blacklist')) return 'blacklisted';
  if (t.includes('high')) return 'high';
  if (t.includes('star')) return 'star';
  if (t.includes('regular')) return 'regular';
  return null;
}

export function toOrderRow(r: PoListRow): OrderRow {
  const catKey = categoryKeyOf(r.supplier_category);
  return {
    id: r.id,
    draft: r.status === 'draft',
    po: r.code, poDate: r.po_date ?? '',
    physicalInspection: r.physical_inspection === 'yes',
    type: API_PO_TYPE[r.po_type ?? ''] ?? 'materials',
    docType: r.document_type === 'international' ? 'International' : 'Domestics',
    currency: r.currency_code,
    shipment: r.link_type === 'with_shipment' ? (r.shipment_code ?? '') : null,
    shipmentDate: r.shipment_date ?? '',
    opportunity: r.opportunity_code ?? '', opportunityDate: r.pi_date ?? '',
    procurement: r.procurement_request_code ?? '', procurementDate: '',
    supplier: r.supplier_name ?? '—',
    supplierCode: r.supplier_code ?? undefined,
    supplierCategory: catKey ?? 'regular',
    supplierCategoryText: catKey ? undefined : (r.supplier_category || undefined),
    risk: riskOf(r.supplier_risk),
    expectedDelivery: r.expected_delivery_date ?? '',
    total: Number(r.grand_total) || 0,
    net: Math.max(0, (Number(r.grand_total) || 0) - (Number(r.tds_amount) || 0)),
    paid: Number(r.paid_amount) || 0,
    balance: Number(r.balance_amount) || 0,
    breakdown: { base: Number(r.taxable_total) || 0, gst: Number(r.gst_total) || 0, extra: Number(r.charges_total) || 0 },
    invoices: (r.spis ?? []).map((s): InvoiceLine => {
      const amount = Number(s.amount) || 0;
      const paid = Number(s.paid) || 0;
      return {
        spi: s.code, spiDate: s.date ?? '',
        amount, paid, due: Math.max(0, amount - paid),
        status: paid <= 0 ? 'pending' : paid >= amount ? 'full' : 'partial',
        grn: '', grnDate: '', qa: '', qaDate: '',
      };
    }),
    spis: (r.spis ?? []).map(s => ({ code: s.code, date: s.date ?? '' })),
    zohoSynced: r.zoho_status === 'synced' && !r.zoho_unposted_payments && (!r.refund || r.refund.zoho_synced),
    zohoStarted: !!r.zoho_started,
    zohoError: r.zoho_status === 'failed' ? (r.zoho_error ?? undefined)
      : r.zoho_status === 'synced' && r.zoho_unposted_payments ? `${r.zoho_unposted_payments} payment(s) not posted to bill ${r.zoho_bill_number ?? ''}` : undefined,
    zohoUnposted: Number(r.zoho_unposted_payments) || 0,
    inspectionDone: r.inspection_status === 'completed',
    paymentRequests: Number(r.payment_requests_count) || 0,
    paymentNote: Number(r.ready_to_pay_amount) > 0 ? { kind: 'ready', amount: Number(r.ready_to_pay_amount) }
      : Number(r.pending_request_amount) > 0 ? { kind: 'waiting', amount: Number(r.pending_request_amount) } : undefined,
    cancelled: r.status === 'cancelled',
    cancelReason: r.cancel_reason ?? undefined,
    signingStarted: !!r.signing_started,
    cancelStage: r.status === 'cancelled' ? (r.cancel_stage ?? 'closed') : undefined,
    adr: r.refund ? { no: r.refund.code, date: r.refund.date ?? '', count: 1, paid: r.refund.paid, credited: r.refund.refund } : undefined,
    refundId: r.refund?.id,
    recoveredAmt: r.refund?.recovered,
  };
}

function IdCell({ id, date }: { id: string; date: string }) {
  if (!id) return <span className="ord-dash">N/A</span>;
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

function InvoiceCells({ line, index, count, ccy }: { line: InvoiceLine; index: number; count: number; ccy?: string | null }) {
  return (
    <>
      <td className="ord-doc ord-doc--spi">
        <div className="ord-doc__card">
          <DocTop label="SPI" index={index} count={count} id={line.spi} />
          <div className="ord-doc__meta">
            <span className="ord-doc__money">{formatMoney(line.amount, ccy)}</span>
            <span className="ord-doc__dot">·</span>
            <span>{formatDate(line.spiDate)}</span>
          </div>
          <div className="ord-doc__foot">
            <span className={`ord-pill ord-pill--${line.status}`}>
              <span className="ord-pill__dot" />{PAYMENT_LABEL[line.status]}
            </span>
            <span className="ord-doc__sub">
              <b className="ord-doc__paid">{formatMoney(line.paid, ccy)}</b> paid ·{' '}
              <b className="ord-doc__due">{formatMoney(line.due, ccy)}</b> due
            </span>
          </div>
        </div>
      </td>

      <td className="ord-doc ord-doc--grn">
        {!line.grn ? <span className="ord-dash">N/A</span> : (
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
        )}
      </td>

      <td className="ord-doc ord-doc--qa">
        {!line.qa ? <span className="ord-dash">N/A</span> : (
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
        )}
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
const ICON_TRACK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="2.4" /><circle cx="5" cy="18" r="2.4" /><path d="M5 8.4v7.2" />
    <path d="M9.5 6H20" /><path d="M9.5 18H20" />
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

function ZohoCell({ synced, cancelled = false, unpaid = false, onSync, error, readOnly = false }: {
  synced: boolean; cancelled?: boolean; unpaid?: boolean;
  onSync?: () => void | Promise<void>; error?: string;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!onSync || busy) return;
    setBusy(true);
    try { await onSync(); } finally { setBusy(false); }
  };
  if (synced) {
    return (
      <div className="ord-statcell">
        <span className="ord-status ord-status--ok"><span className="ord-status__dot" />Synced</span>
      </div>
    );
  }
  if (cancelled && unpaid) {
    return (
      <div className="ord-statcell">
        <span className="ord-status ord-status--na" title="This PO was cancelled before any payment — nothing to send to Zoho Books">
          <span className="ord-status__dot" />Not Applicable
        </span>
      </div>
    );
  }
  return (
    <div className="ord-statcell">
      <span className="ord-status ord-status--bad" title={error}><span className="ord-status__dot" />Not Sync</span>
      {!readOnly && <button type="button" className={`ord-btn ord-btn--zoho${busy ? ' is-syncing' : ''}`}
        disabled={busy} onClick={() => void go()}
        title={busy ? 'Sending to Zoho Books…' : unpaid
          ? 'Record the first payment on this PO before syncing it to Zoho Books'
          : error || (cancelled
            ? 'Send this PO, its bill, payments, vendor credit and refunds to Zoho Books'
            : 'Send this PO, its bill and payments to Zoho Books')}>
        {ICON_SYNC}<span>{busy ? 'Syncing…' : 'Zoho Sync'}</span>
      </button>}
    </div>
  );
}

function InspectionCell({ required, done, cancelled = false, onOpen, readOnly = false }: {
  required: boolean; done: boolean; cancelled?: boolean; onOpen: () => void;
  readOnly?: boolean;
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
      {!readOnly && (
        <button type="button" className={`ord-btn ord-btn--insp${done ? ' is-done' : ''}`} disabled={cancelled} onClick={onOpen}>
          {done ? ICON_TICK : ICON_EYE}
          <span>{done ? 'Inspection Done' : 'Physical Inspection'}</span>
        </button>
      )}
    </div>
  );
}

function PaymentCell({ row, onManage, readOnly = false }: { row: OrderRow; onManage: (row: OrderRow) => void; readOnly?: boolean }) {
  const toast = useToast();
  const settled = row.paid > 0 && row.net - row.paid < 1;
  const pct = settled ? 100 : row.net > 0 ? Math.min(99, Math.floor((row.paid / row.net) * 100)) : 0;
  const due = settled ? 0 : row.balance;
  const status: PaymentStatus = settled ? 'full' : row.paid > 0 ? 'partial' : 'pending';
  const label = status === 'full' ? 'Payment Completed' : PAYMENT_LABEL[status];
  const done = status === 'full';

  const noteText = !row.paymentNote ? ''
    : row.paymentNote.kind === 'ready'
      ? `${formatMoney(row.paymentNote.amount, row.currency)} approved · ready to pay`
      : `${formatMoney(row.paymentNote.amount, row.currency)} awaiting approval`;

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
          <span className="ord-progress__paid"><span className="ord-progress__mdot" />{formatMoney(row.paid, row.currency)} paid</span>
          <span className="ord-progress__due"><span className="ord-progress__mdot" />{formatMoney(due, row.currency)} due</span>
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

      {!readOnly && (() => {
        const history = row.paymentRequests > 0 || row.paid > 0;
        const viewOnly = done || !!row.cancelled;
        const nothing = !!row.cancelled && !history;
        return (
          <button
            type="button"
            className={`ord-btn ord-btn--hist${viewOnly ? ' is-record' : ''}`}
            disabled={nothing}
            title={nothing ? 'This PO was cancelled before any payment request was raised.'
              : row.cancelled ? 'This PO is cancelled — its payment requests open to be read.' : undefined}
            onClick={() => {
              if (!viewOnly && !row.signingStarted) {
                toast.warning('PO not sent for signature',
                  `Send ${row.po} to the supplier from Stage 04 — payment requests open once the documents are out.`);
                return;
              }
              onManage(row);
            }}
          >
            {viewOnly ? ICON_EYE : ICON_HISTORY}
            <span>{viewOnly ? 'View Request Details' : 'Manage Payment Requests'}</span>

            {row.paymentRequests > 0 && (
              <i className="ord-btn__count">{row.paymentRequests}</i>
            )}
          </button>
        );
      })()}
    </div>
  );
}

function AdrCell({ adr, ccy }: { adr?: AdvanceRefund; ccy?: string | null }) {
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
        <AdrRow label="Paid" value={formatMoney(adr.paid, ccy)} />
        <AdrRow label="To Be Refunded" value={formatMoney(adr.credited, ccy)} tone="refund" />
        {notRefunded > 0 && <AdrRow label="Not Refunded" value={formatMoney(notRefunded, ccy)} tone="none" />}
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

function recoveryOf(row: OrderRow) {
  const target = row.adr ? row.adr.credited : 0;
  const entries = row.recoveries?.length ?? 0;
  const logged = row.recoveredAmt ?? (row.recoveries ?? []).reduce((sum, amount) => sum + amount, 0);
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
    started: entries > 0 || logged > 0,
    complete: target > 0 && recovered >= target,
  };
}

function RecoveryCell({ row, onRecover }: { row: OrderRow; onRecover?: (row: OrderRow) => void }) {
  const g = recoveryOf(row);
  const entryWord = (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`;

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
      : g.started ? `${formatMoney(g.pending, row.currency)} still to recover from the supplier`
        : `Nothing recovered yet — ${formatMoney(g.target, row.currency)} is recoverable under ${g.noteNo}`;

  const button = (
    <button
      type="button"
      className={`ord-btn ord-btn--hist${g.complete ? ' is-record' : ''}`}
      disabled={!g.noteRaised}
      title={tip}
      onClick={() => onRecover?.(row)}
    >
      {ICON_RECOVER}
      <span>{g.complete ? 'Recovery Complete' : 'Manage Recovery'}</span>
      {g.entries > 0 && (
        <i className="ord-btn__count">{g.entries}</i>
      )}
    </button>
  );

  if (!g.noteRaised) {
    return (
      <div className="ord-paycell">
        <div className="ord-progress">
          <div className="ord-progress__top">
            <span className="ord-pill ord-pill--await"><span className="ord-pill__dot" />Awaiting Credit Note</span>
          </div>
          <span className="ord-recnote" title={`The credit note sets how much of ${formatMoney(g.paid, row.currency)} paid out is recoverable`}>
            Credit note sets the recoverable amount
          </span>
        </div>
        {button}
      </div>
    );
  }

  const status: PaymentStatus = g.complete ? 'full' : g.started ? 'partial' : 'pending';
  const label = g.complete ? 'Fully Recovered' : g.started ? 'Partially Recovered' : 'Recovery Not Started';
  const noteTitle = `${formatMoney(g.target, row.currency)} recoverable under ${g.noteNo}`
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
          <span className="ord-progress__paid"><span className="ord-progress__mdot" />{formatMoney(g.recovered, row.currency)} recovered</span>
          <span className="ord-progress__due"><span className="ord-progress__mdot" />{formatMoney(g.pending, row.currency)} pending</span>
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

const paymentsStarted = (row: OrderRow) => row.paid > 0 || !!row.paymentNote;

const viewOnlyReason = (row: OrderRow) =>
  row.cancelled ? 'This PO is cancelled — it opens view-only'
    : paymentsStarted(row) ? 'Payments have started — the PO opens view-only'
      : row.signingStarted ? 'Documents sent for signature — view-only unless the request is declined or recalled'
        : undefined;

const recoverPendingOf = (row: OrderRow) =>
  (row.cancelStage === 'initiated' ? formatMoney(recoveryOf(row).pending, row.currency) : undefined);

function ActionCell({ cancelled = false, cancelReason, onEdit, onCancel, onTrack, trackable = false, onVault, viewOnly, recoverPending, onRecover }: {
  cancelled?: boolean; cancelReason?: string; onEdit: () => void; onCancel?: () => void; onTrack?: () => void;
  trackable?: boolean; onVault?: () => void;
  viewOnly?: string;
  recoverPending?: string;
  onRecover?: () => void;
}) {
  return (
    <div className="ord-actions">
      {recoverPending ? (
        <Tooltip label={`Cancellation initiated — ${recoverPending} still to recover. Opens Manage Recovery.`}>
          <button type="button" className="ord-btn ord-btn--cancel is-initiated" onClick={onRecover}>
            {ICON_CLOCK}<span>Recovery Pending</span>
          </button>
        </Tooltip>
      ) : cancelled ? (
        <Tooltip label={cancelReason || 'This PO has been cancelled'}>
          <button type="button" className="ord-btn ord-btn--cancel is-cancelled" disabled>
            {ICON_CANCEL}<span>Cancelled</span>
          </button>
        </Tooltip>
      ) : (
        <Tooltip label="Cancel this Purchase Order">
          <button type="button" className="ord-btn ord-btn--cancel" onClick={onCancel}>{ICON_CANCEL}<span>Cancel PO</span></button>
        </Tooltip>
      )}
      <Tooltip label={viewOnly || 'Open this Purchase Order'}>
        <button type="button" className="ord-btn ord-btn--edit" onClick={onEdit}>
          {viewOnly ? ICON_EYE : ICON_EDIT}<span>{viewOnly ? 'View PO' : 'Edit PO'}</span>
        </button>
      </Tooltip>
      <Tooltip label="Evidence Vault — the order, its documents and payment proofs">
        <button type="button" className="ord-btn ord-btn--vault" onClick={onVault}>{ICON_VAULT}<span>Evidence Vault</span></button>
      </Tooltip>
      {onTrack && (
        <Tooltip label={trackable
          ? 'PO Timeline — how far this PO has gone across to Zoho Books'
          : 'Nothing of this PO is in Zoho Books yet — sync it once to follow the timeline'}>
          <button type="button" className="ord-btn ord-btn--track" disabled={!trackable} onClick={onTrack}>
            {ICON_TRACK}<span>PO Timeline</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

const ICON_X_SM = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function CancelBadge({ reason }: { reason?: string }) {
  return <Badge appearance="outline" variant="danger" icon={ICON_X_SM} className="ord-cancelbadge" title={reason}>Cancelled</Badge>;
}

function StatusBadge({ row }: { row: OrderRow }) {
  if (row.cancelled) return <CancelBadge reason={row.cancelReason} />;
  if (row.draft) return <Badge appearance="outline" variant="warning" icon={ICON_CLOCK} className="ord-status-badge" title="Saved, not yet submitted">Draft</Badge>;
  return <Badge appearance="outline" variant="success" icon={ICON_CHECK} className="ord-status-badge" title="Submitted — the PO is issued">Submitted</Badge>;
}

function RiskBadge({ risk }: { risk: RiskLevel | null }) {
  if (!risk) return <span className="ord-dash">—</span>;
  return <Badge appearance="outline" variant={RISK_LEVEL[risk].variant} icon={RISK_LEVEL[risk].icon} className="ord-risk">{RISK_LEVEL[risk].label}</Badge>;
}

export function OrderRowBody({ row, sr, inspected, onInspect, onManage, onEdit, onZoho, onTrack, onCancel, onVault, onRecover, summary = false }: {
  row: OrderRow; sr: number; inspected: boolean;
  onInspect: (row: OrderRow) => void; onManage: (row: OrderRow) => void;
  onEdit?: (row: OrderRow) => void; onZoho?: (row: OrderRow) => void; onTrack?: (row: OrderRow) => void; onCancel?: (row: OrderRow) => void; onVault?: (row: OrderRow) => void; onRecover?: (row: OrderRow) => void;
  summary?: boolean;
}) {
  const lines = row.invoices.length > 0 ? row.invoices : [null];
  const span = lines.length;

  return (
    <tbody className={row.cancelled ? 'ord-po--cancelled' : undefined}>
      {lines.map((line, lineIndex) => {
        const isFirst = lineIndex === 0;
        const isLast = lineIndex === span - 1;
        const rowClass = [isFirst ? 'is-first' : '', isLast ? 'is-last' : '']
          .filter(Boolean).join(' ');

        return (
          <tr key={line ? line.spi : 'no-invoice'} className={rowClass || undefined}>

            {isFirst && (
              <>

                <PoCell span={span}><span className="ord-srnum">{sr}</span></PoCell>

                <PoCell span={span}>
                  <IdCell id={row.po} date={row.poDate} />
                  {row.physicalInspection && (
                    <Badge appearance="outline" variant="danger" icon={ICON_WARN} className="ord-physinsp">Physical Inspection</Badge>
                  )}
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
                  <IdCell id={row.shipment ?? ''} date={row.shipmentDate} />
                </PoCell>
                <PoCell span={span}><IdCell id={row.opportunity} date={row.opportunityDate} /></PoCell>
                <PoCell span={span}><IdCell id={row.procurement} date={row.procurementDate} /></PoCell>

                <PoCell span={span}>
                  <div className="ord-supplier">
                    <FitTip label={row.supplier}><span className="ord-supplier__name">{row.supplier}</span></FitTip>
                    <Badge
                      appearance="outline"
                      variant={categoryOf(row).variant}
                      icon={categoryOf(row).icon}
                      className="ord-supplier__cat"
                    >
                      {categoryOf(row).label}
                    </Badge>
                  </div>
                </PoCell>

                <PoCell span={span}>
                  <RiskBadge risk={row.risk} />
                </PoCell>

                <PoCell span={span}><span className="ord-edd">{row.expectedDelivery ? formatDate(row.expectedDelivery) : '—'}</span></PoCell>

                <PoCell span={span}><Amount className="ord-amt" text={formatMoney(row.total, row.currency)} /></PoCell>
                <PoCell span={span}><Amount className="ord-amt ord-amt--net" text={formatMoney(row.net, row.currency)} /></PoCell>
                <PoCell span={span}><Amount className="ord-amt ord-amt--paid" text={formatMoney(row.paid, row.currency)} /></PoCell>
                <PoCell span={span} groupEnd>
                  <Amount className="ord-amt ord-amt--bal" text={formatMoney(row.balance, row.currency)} />
                </PoCell>
              </>
            )}

            {line ? (
              <InvoiceCells line={line} index={lineIndex} count={span} ccy={row.currency} />
            ) : (
              <>
                <td className="ord-doc ord-doc--spi"><span className="ord-dash">N/A</span></td>
                <td className="ord-doc ord-doc--grn"><span className="ord-dash">N/A</span></td>
                <td className="ord-doc ord-doc--qa"><span className="ord-dash">N/A</span></td>
              </>
            )}

            {isFirst && (
              <>
                <PoCell span={span}><ZohoCell synced={row.zohoSynced} cancelled={row.cancelled} unpaid={row.paid <= 0} error={row.zohoError} onSync={onZoho && (() => onZoho(row))} readOnly={summary} /></PoCell>
                <PoCell span={span}>
                  <InspectionCell required={row.physicalInspection} done={inspected} cancelled={row.cancelled} onOpen={() => onInspect(row)} readOnly={summary} />
                </PoCell>
                <PoCell span={span}><PaymentCell row={row} onManage={onManage} readOnly={summary} /></PoCell>
                {!summary && <PoCell span={span}><AdrCell adr={row.adr} ccy={row.currency} /></PoCell>}
                {!summary && <PoCell span={span}><RecoveryCell row={row} onRecover={onRecover} /></PoCell>}
                {!summary && <PoCell span={span}><StatusBadge row={row} /></PoCell>}
                {!summary && <PoCell span={span}><ActionCell cancelled={row.cancelled} cancelReason={row.cancelReason} viewOnly={viewOnlyReason(row)} onEdit={() => onEdit?.(row)} onCancel={onCancel && (() => onCancel(row))} onTrack={onTrack && (() => onTrack(row))} trackable={row.zohoStarted} onVault={onVault && (() => onVault(row))} recoverPending={recoverPendingOf(row)} onRecover={onRecover && (() => onRecover(row))} /></PoCell>}
              </>
            )}
          </tr>
        );
      })}
    </tbody>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];
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

function OrderCard({ row, index, onManage, onInspect, onEdit, onZoho, onTrack, onCancel, onVault, onRecover, inspected }: {
  row: OrderRow; index: number; onManage: (row: OrderRow) => void; onInspect: (row: OrderRow) => void;
  onEdit: (row: OrderRow) => void; onZoho: (row: OrderRow) => void; onTrack: (row: OrderRow) => void; onCancel: (row: OrderRow) => void; onVault: (row: OrderRow) => void; onRecover: (row: OrderRow) => void; inspected: boolean;
}) {
  const category = categoryOf(row);
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
        <StatusBadge row={row} />
      </div>

      <div className="ord-card__split">
        <div className="ord-card__block">
          <span className="ord-card__label">Supplier</span>
          <FitTip label={row.supplier}><span className="ord-supplier__name">{row.supplier}</span></FitTip>
          <Badge appearance="outline" variant={category.variant} icon={category.icon} className="ord-supplier__cat">{category.label}</Badge>
        </div>
        <div className="ord-card__block ord-card__block--end">
          <span className="ord-card__label">Risk Alert</span>
          <RiskBadge risk={row.risk} />
        </div>
      </div>

      <dl className="ord-card__grid">
        <div>
          <dt>Shipment ID</dt>
          <dd><IdCell id={row.shipment ?? ''} date={row.shipmentDate} /></dd>
        </div>
        <div><dt>Opportunity ID</dt><dd><IdCell id={row.opportunity} date={row.opportunityDate} /></dd></div>
        <div><dt>Procurement ID</dt><dd><IdCell id={row.procurement} date={row.procurementDate} /></dd></div>
        <div><dt>Expected Delivery</dt><dd><span className="ord-edd">{row.expectedDelivery ? formatDate(row.expectedDelivery) : '—'}</span></dd></div>
      </dl>

      <dl className="ord-card__grid">
        <div><dt>Total PO Amount</dt><dd><span className="ord-amt">{formatMoney(row.total, row.currency)}</span></dd></div>
        <div><dt>Net Payable</dt><dd><span className="ord-amt ord-amt--net">{formatMoney(row.net, row.currency)}</span></dd></div>
        <div><dt>Total Paid</dt><dd><span className="ord-amt ord-amt--paid">{formatMoney(row.paid, row.currency)}</span></dd></div>
        <div><dt>Balance</dt><dd><span className="ord-amt ord-amt--bal">{formatMoney(row.balance, row.currency)}</span></dd></div>
      </dl>

      <div className="ord-card__section">
        <span className="ord-card__label">Mapped SPI / GRN / QA ({count})</span>
        {count === 0 && <span className="ord-dash">N/A</span>}
        {row.invoices.map((line, i) => (
          <div className="ord-card__invoice" key={line.spi}>
            <DocTop label="SPI" index={i} count={count} id={line.spi} />
            <div className="ord-doc__meta">
              <span className="ord-doc__money">{formatMoney(line.amount, row.currency)}</span>
              <span className="ord-doc__dot">·</span>
              <span>{formatDate(line.spiDate)}</span>
            </div>
            <div className="ord-doc__foot">
              <span className={`ord-pill ord-pill--${line.status}`}><span className="ord-pill__dot" />{PAYMENT_LABEL[line.status]}</span>
              <span className="ord-doc__sub">
                <b className="ord-doc__paid">{formatMoney(line.paid, row.currency)}</b> paid · <b className="ord-doc__due">{formatMoney(line.due, row.currency)}</b> due
              </span>
            </div>
            {line.grn && (
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.grn}</span>
              <span className="ord-doc__sub">Received · {formatDate(line.grnDate)}</span>
              <span className="ord-pill ord-pill--received"><span className="ord-pill__dot" />Goods Received</span>
            </div>
            )}
            {line.qa && (
            <div className="ord-card__chain">
              <span className="ord-idpill">{line.qa}</span>
              <span className="ord-doc__sub">Inspected · {formatDate(line.qaDate)}</span>
              <span className="ord-pill ord-pill--qa"><span className="ord-pill__dot" />QA Passed</span>
            </div>
            )}
          </div>
        ))}
      </div>

      <div className="ord-card__status">
        <div className="ord-card__block">
          <span className="ord-card__label">Zohobook Status</span>
          <ZohoCell synced={row.zohoSynced} cancelled={row.cancelled} unpaid={row.paid <= 0} error={row.zohoError} onSync={() => onZoho(row)} />
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

      {row.adr && (
        <div className="ord-card__section">
          <span className="ord-card__label">Advance Receipt Refund Adjustment</span>
          <AdrCell adr={row.adr} ccy={row.currency} />
        </div>
      )}

      <div className="ord-card__section">
        <span className="ord-card__label">Payment Recovery</span>
        <RecoveryCell row={row} onRecover={onRecover} />
      </div>

      <ActionCell cancelled={row.cancelled} cancelReason={row.cancelReason} viewOnly={viewOnlyReason(row)} onEdit={() => onEdit(row)} onCancel={() => onCancel(row)} onTrack={() => onTrack(row)} trackable={row.zohoStarted} onVault={() => onVault(row)} recoverPending={recoverPendingOf(row)} onRecover={onRecover && (() => onRecover(row))} />
    </article>
  );
}

export default function Order() {

  const [guideOpen, setGuideOpen] = useState(false);

  const toggleGuide = () => setGuideOpen((open) => !open);

  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const isPhone = useIsPhone();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize, refitSize] = useFitPageSize(scrollRef, { enabled: !isPhone });
  const pageSize = isPhone ? undefined : fitSize;

  const list = useServerList(
    (q) => poApi.list({ ...q, tab: q.tab as TabKey }).then(({ rows, meta }) => ({ rows: rows.map(toOrderRow), meta })),
    { perPage: pageSize, search: debouncedSearch, tab: activeTab, append: isPhone },
    (e) => toast.error('Could not load purchase orders', e instanceof PoApiError ? e.firstError : 'Please refresh the page.'),
  );
  const loadRows = list.reload;

  const comingSoon = (what: string) => () => toast.info('Feature coming soon', `${what} will be available shortly.`);
  const [manageRow, setManageRow] = useState<OrderRow | null>(null);
  const [raiseFor, setRaiseFor] = useState<OrderRow | null>(null);
  const onManage = (row: OrderRow) => {
    if (!row.id) return;
    if (row.draft) { toast.info('Submit the PO first', `${row.po} is still a draft — submit it before managing payments.`); return; }
    setManageRow(row);
  };
  const [inspectRow, setInspectRow] = useState<OrderRow | null>(null);
  const onInspect = (row: OrderRow) => {
    if (!row.id) return;
    if (row.draft) { toast.info('Submit the PO first', `${row.po} is still a draft — submit it before inspecting.`); return; }
    setInspectRow(row);
  };
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [trackRow, setTrackRow] = useState<OrderRow | null>(null);
  const onTrack = (row: OrderRow) => { if (row.id) setTrackRow(row); };

  const onZoho = async (row: OrderRow) => {
    if (!row.id || syncingId) return;
    if (row.draft) { toast.info('Submit the PO first', `${row.po} is still a draft — submit it before syncing to Zoho Books.`); return; }
    if (row.paid <= 0) {
      toast.warning('No payment found against this PO', `Nothing has been released on ${row.po} yet — record a payment, then sync.`);
      return;
    }
    setSyncingId(row.id);
    try {
      const r = await poApi.zohoSync(row.id);
      toast.success(`${row.po} synced`, r.message);
      loadRows();
    } catch (e) {
      toast.error('Zoho Books sync failed', e instanceof PoApiError ? e.firstError : 'Please try again.');
      loadRows();
    } finally {
      setSyncingId(null);
    }
  };
  const [recoverId, setRecoverId] = useState<number | null>(null);
  const onRecover = (row: OrderRow) => { if (row.refundId) setRecoverId(row.refundId); };
  const navigate = useNavigate();

  const [cancelRow, setCancelRow] = useState<OrderRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const onCancel = (row: OrderRow) => { if (row.id) setCancelRow(row); };
  const [vaultRow, setVaultRow] = useState<OrderRow | null>(null);
  const onVault = (row: OrderRow) => { if (row.id) setVaultRow(row); };
  const confirmCancel = async () => {
    if (!cancelRow?.id || cancelling) return;
    setCancelling(true);
    try {
      await poApi.cancel(cancelRow.id, 'Cancelled from the Purchase Order list');
      toast.success(`${cancelRow.po} cancelled`, 'Nothing to recover — moved to PO Cancellation Closed.');
      setCancelRow(null);
      if (activeTab === 'cancelclosed') loadRows(); else selectTab('cancelclosed');
    } catch (e) {
      toast.error('Could not cancel the PO', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [poLink, setPoLink] = useState<PoLink | null>(null);

  const openEdit = (row: OrderRow) => {
    if (row.id) setPoLink({ mode: row.shipment ? 'with' : 'without', editId: row.id });
  };


  const rows = list.rows;
  useEffect(() => { if (rows.length) refitSize(); }, [rows.length, refitSize]);
  const total = list.meta?.total ?? 0;
  const perPage = list.meta?.per_page ?? DEFAULT_PAGE_SIZE;
  const tabCounts: Record<TabKey, number> = { all: 0, with: 0, without: 0, cancelinit: 0, cancelclosed: 0, ...(list.meta?.counts ?? {}) };
  const start = isPhone ? 0 : (list.page - 1) * perPage;

  const cardsRef = useRef<HTMLDivElement>(null);
  const scrollListToTop = () => {
    scrollRef.current?.scrollTo({ top: 0 });
    cardsRef.current?.scrollTo({ top: 0 });
  };

  const goToPage = (next: number) => {
    list.goTo(next);
    scrollListToTop();
  };

  const selectTab = (tab: TabKey) => {
    setActiveTab(tab);
    scrollListToTop();
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    scrollListToTop();
  };
  const changePageSize = (size: number) => {
    setFitSize(size);
    scrollListToTop();
  };

  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!isPhone || !el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) list.loadMore(); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const scrollTimer = useRef<number | undefined>(undefined);
  const scrollLeft = useRef(0);
  useEffect(() => {
    if (!list.loading && !list.replacing && scrollRef.current) scrollRef.current.scrollLeft = scrollLeft.current;
  }, [list.loading, list.replacing]);

  const onTableScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    scrollLeft.current = el.scrollLeft;
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
            key={poLink.editId ?? 'new'}
            link={poLink}
            onClose={() => { setPoLink(null); loadRows(); }}
            onChangeLink={() => setCreateOpen(true)}
          />
        </Suspense>
      )}

      {manageRow && (
        <Suspense fallback={null}>
          <ManagePaymentRequestsModal row={manageRow} onClose={() => { setManageRow(null); loadRows(); }} />
        </Suspense>
      )}

      {raiseFor && (
        <Suspense fallback={null}>
          <ManagePaymentRequestsModal row={raiseFor} startWithRaise onClose={() => { setRaiseFor(null); loadRows(); }} />
        </Suspense>
      )}

      {vaultRow?.id && (
        <Suspense fallback={null}>
          <PoEvidenceVaultModal
            po={{ id: vaultRow.id, po: vaultRow.po, supplier: vaultRow.supplier, poDate: vaultRow.poDate }}
            onClose={() => setVaultRow(null)}
          />
        </Suspense>
      )}

      {trackRow?.id && (
        <Suspense fallback={null}>
          <ZohoTrackerModal poId={trackRow.id} poCode={trackRow.po} onClose={() => setTrackRow(null)} />
        </Suspense>
      )}

      {cancelRow && (
        <Suspense fallback={null}>
          <CancelPoModal
            target={{ po: cancelRow.po, supplier: cancelRow.supplier, balance: cancelRow.balance, paid: cancelRow.paid, currency: cancelRow.currency }}
            busy={cancelling}
            onClose={() => { if (!cancelling) setCancelRow(null); }}
            onConfirm={() => { void confirmCancel(); }}
            onCreateRefund={() => { const id = cancelRow.id; setCancelRow(null); navigate(`/p2p/advance-refund-adjustment?po=${id}`); }}
          />
        </Suspense>
      )}

      {recoverId && (
        <Suspense fallback={null}>
          <RecoverPaymentModal refundId={recoverId} onChanged={loadRows} onClose={() => setRecoverId(null)} />
        </Suspense>
      )}

      {inspectRow && (
        <Suspense fallback={null}>
          <PhysicalInspectionModal
            row={inspectRow}
            onClose={() => setInspectRow(null)}
            onChanged={loadRows}
            onContinueToPayment={() => { const r = inspectRow; setInspectRow(null); setRaiseFor(r); }}
          />
        </Suspense>
      )}

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
        <Tooltip label="Raise a new Purchase Order — with a Shipment ID or standalone" position="bottom">
        <button type="button" className="spi-head-btn" onClick={() => setCreateOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create PO
        </button>
        </Tooltip>
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
                  title={tab.sub ? `${tab.label} ${tab.sub}` : undefined}
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

          <div className="spi-search ui-search-abs">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>

            <input
              type="text"
              aria-label="Search purchase orders"
              placeholder="Search PO, supplier, ID or status…"
              title="Search by PO number, supplier, shipment / opportunity / PI id, PO type, document type or status"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
            <SearchClear show={search} onClear={() => changeSearch('')} />
          </div>

        </div>

        {list.loading || list.replacing ? (
          <OrderListSkeleton phone={isPhone} rows={fitSize || DEFAULT_PAGE_SIZE} />
        ) : rows.length === 0 ? (
          <div className="ord-empty">
            {search.trim()
              ? 'No purchase orders match your search.'
              : 'No purchase orders to display in this category.'}
          </div>
        ) : isPhone ? (
          <div className="ord-cards" ref={cardsRef}>

            {rows.map((row, index) => (
              <OrderCard
                key={row.po}
                row={row}
                index={start + index}
                onManage={onManage}
                onInspect={onInspect}
                onEdit={openEdit}
                onZoho={onZoho}
                onTrack={onTrack}
                onRecover={onRecover}
                onCancel={onCancel}
                onVault={onVault}
                inspected={row.inspectionDone}
              />
            ))}
            {list.hasMore && <div ref={moreRef} className="ord-more">{list.refreshing ? 'Loading more…' : ''}</div>}
          </div>
        ) : (

        <div className="ord-table-scroll" ref={scrollRef} onScroll={onTableScroll}>
          <table className="ord-table" style={{ width: TABLE_WIDTH }}>

            <colgroup>
              {ORDER_COLUMNS.map((col) => (
                <col key={col.label} style={{ width: col.width }} />
              ))}
            </colgroup>

            <thead>
              <tr>
                {ORDER_COLUMNS.map((col) => (
                  <th key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            {rows.map((row, poIndex) => (
              <OrderRowBody
                key={row.po}
                row={row}
                sr={start + poIndex + 1}
                inspected={row.inspectionDone}
                onInspect={onInspect}
                onManage={onManage}
                onEdit={openEdit}
                onZoho={onZoho}
                onTrack={onTrack}
                onRecover={onRecover}
                onCancel={onCancel}
                onVault={onVault}
              />
            ))}
          </table>
        </div>
        )}

        {rows.length > 0 && !isPhone && (
          <WorklistPager
            className="wl-teal"
            total={total}
            page={list.page}
            pageSize={perPage}
            onPage={goToPage}
            onPageSize={changePageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>
    </div>
  );
}

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

function OrderListSkeleton({ phone, rows = DEFAULT_PAGE_SIZE }: { phone: boolean; rows?: number }) {
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
          {ORDER_COLUMNS.map((col) => <col key={col.label} style={{ width: col.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {ORDER_COLUMNS.map((col) => (
              <th key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(1, rows) }).map((_, rowIndex) => (
            <tr key={rowIndex} className="ord-skel-tr">
              {ORDER_COLUMNS.map((col) => (
                <td key={col.label} className={col.groupEnd ? 'ord-table__group-end' : undefined}>
                  <span className="spi-sk-bar" style={{ width: Math.round(col.width * 0.6) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
