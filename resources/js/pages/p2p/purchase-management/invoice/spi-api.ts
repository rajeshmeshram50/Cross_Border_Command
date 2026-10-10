import axios from 'axios';
import api from '../../../../api';
import { PoApiError } from '../order/api/po-api';
import type { ServerPageMeta } from '../../../../hooks/useServerList';
import type {
  InvoiceInspectionStatus, InvoicePoType, InvoiceRiskLevel, InvoiceRow,
  InvoiceScope, InvoiceShipmentScope, InvoiceSupplierCategory,
} from './types';

async function call<T>(action: string, run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    const res = await run();
    return pick(res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      const e = new PoApiError(action, err.response?.status ?? null,
        body?.message || err.message || 'Request failed', body?.errors ?? {}, body ?? null);
      console.error(`[SPI API] ${action} failed (${e.status ?? 'network'}): ${e.message}`, e.fieldErrors);
      throw e;
    }
    throw err;
  }
}
export type SpiListRow = {
  id: number;
  spi_number: string;
  spi_date: string | null;
  invoice_no: string | null;
  is_direct: boolean;
  po_number: string | null;
  po_date: string | null;
  po_type: string | null;
  physical_inspection: 'yes' | 'no' | null;
  document_type: 'domestic' | 'international';
  shipment_id: string | null;
  shipment_date: string | null;
  opportunity_id: string | null;
  opportunity_date: string | null;
  procurement_id: string | null;
  supplier: {
    id: number | null; code: string | null; name: string | null;
    risk_level_id: number | null; risk: string | null; category: string | null;
  };
  expected_delivery_date: string | null;
  zoho_status: string | null;
  inspection_status: 'completed' | 'pending' | 'not_required' | 'not_applicable';
  pending_payment_requests: number;
  approved_unpaid_amount: number;
  total_po_amount: number | null;
  net_payable_amount: number | null;
  total_paid_amount: number | null;
  balance_amount: number | null;
  total_spi_amount: number;
  warehouse: { id: number; code: string | null; name: string; is_own: boolean } | null;
  status: string;
  status_label: string;
  stage_completed: number;
};

export type SpiTabCounts = {
  all_spi: number; with_po: number; direct_spi: number;
  with_shipment: number; without_shipment: number;
};

export type SpiListMeta = ServerPageMeta & { tabs: SpiTabCounts };

export type SpiListQuery = {
  scope?: InvoiceScope;
  shipScope?: InvoiceShipmentScope;
  search?: string;
  page?: number;
  per_page?: number;
};

const PO_MODE: Record<InvoiceScope, string | undefined> = {
  all: undefined, 'with-po': 'with_po', 'without-po': 'without_po',
};
const SHIPMENT_MODE: Record<InvoiceShipmentScope, string> = {
  'with-shipment': 'with_shipment', 'without-shipment': 'without_shipment',
};

export type SpiStage1Body = {
  purchase_order_id: number | null;
  vendor_id: number;
  document_type: 'domestic' | 'international';
};

export type SpiHeader = { id: number; code: string; status: string; stage_completed: number };

export const spiApi = {
  nextCode: () =>
    call('SPI next code', () => api.get('/p2p/spi/next-code'),
      (b) => (b as { data?: { code: string; financial_year: string } } | null)?.data ?? null),

  create: (body: SpiStage1Body) =>
    call('SPI create (Stage 01)', () => api.post('/p2p/spi', body),
      (b) => (b as { data?: SpiHeader } | null)?.data as SpiHeader),

  list: ({ scope = 'all', shipScope, search, page, per_page }: SpiListQuery = {}) =>
    call('SPI list', () => api.get('/p2p/spi', {
      params: {
        po_mode: PO_MODE[scope],
        shipment_mode: shipScope ? SHIPMENT_MODE[shipScope] : undefined,
        q: search || undefined,
        page,
        per_page,
      },
    }), (b) => {
      const body = b as { data?: SpiListRow[]; tabs?: SpiTabCounts; meta?: ServerPageMeta } | null;
      return {
        rows: body?.data ?? [],
        meta: body?.meta && body.tabs ? { ...body.meta, tabs: body.tabs } : null,
      };
    }),
};

const PO_TYPE: Record<string, InvoicePoType> = { material_goods: 'material', services: 'services' };

function riskOf(name: string | null): InvoiceRiskLevel | undefined {
  const n = (name ?? '').toLowerCase();
  if (n.includes('high')) return 'high';
  if (n.includes('medium')) return 'medium';
  if (n.includes('low')) return 'low';
  return undefined;
}

function categoryOf(text: string | null): InvoiceSupplierCategory | undefined {
  const t = (text ?? '').toLowerCase();
  if (t.includes('blacklist')) return 'blacklisted';
  if (t.includes('high')) return 'high-risk';
  if (t.includes('star')) return 'star';
  if (t.includes('regular')) return 'regular';
  return undefined;
}

const INSPECTION: Record<SpiListRow['inspection_status'], InvoiceInspectionStatus> = {
  completed: 'completed', pending: 'pending', not_required: 'not-applicable', not_applicable: 'not-applicable',
};

export function toInvoiceRow(r: SpiListRow): InvoiceRow {
  const net = r.net_payable_amount ?? r.total_spi_amount;
  const orUndef = (v: string | null) => v ?? undefined;

  return {
    id: String(r.id),
    apiId: r.id,
    status: r.status,
    statusLabel: r.status_label,

    invoiceNo: r.spi_number,
    invoiceDate: r.spi_date ?? '',

    poNo: orUndef(r.po_number),
    poDate: orUndef(r.po_date),
    poType: r.po_type ? PO_TYPE[r.po_type] : undefined,
    poPhysicalInspection: r.physical_inspection === 'yes',

    documentType: r.document_type,

    shipmentId: orUndef(r.shipment_id),
    shipmentDate: orUndef(r.shipment_date),

    opportunityId: orUndef(r.opportunity_id),
    opportunityDate: orUndef(r.opportunity_date),
    procurementId: orUndef(r.procurement_id),

    supplierName: r.supplier.name ?? '—',
    supplierCategory: categoryOf(r.supplier.category),
    riskLevel: riskOf(r.supplier.risk),

    expectedDeliveryDate: orUndef(r.expected_delivery_date),

    totalPoAmount: r.total_po_amount ?? r.total_spi_amount,
    netPayable: net,
    totalPaid: r.total_paid_amount ?? 0,

    warehouseName: r.warehouse?.name,
    warehouseKind: r.warehouse ? (r.warehouse.is_own ? 'own' : 'third-party') : undefined,

    zohoStatus: r.zoho_status === 'synced' ? 'synced' : 'not-synced',
    inspectionStatus: INSPECTION[r.inspection_status] ?? 'not-applicable',
    pendingPaymentRequests: r.pending_payment_requests,
    approvedForPayment: r.approved_unpaid_amount > 0 ? r.approved_unpaid_amount : undefined,
  };
}
