import type { GstScrutinyRow } from './invoice-draft';
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

export type SpiPoLine = {
  po_item_id: number; pi_item_id: number | null; product_id: number | null; description: string | null;
  qty_po: number; qty_open: number; rate: number; gst_pct: number | null;
};

export type SpiInvoiceDetails = {
  invoice_no: string;
  invoice_date: string;
  currency_code?: string | null;
  exchange_rate?: number | string | null;
};

export type SpiSavedItem = { id: number; line_no: number; po_item_id: number | null; product_id: number };

export type SpiItemsResult = {
  invoice: SpiHeader & { items: SpiSavedItem[]; invoice_file_name: string | null; eway_file_name: string | null };
  match: { lines: number; qty_po: number; qty_spi: number; missing_qty: number; extra_qty: number; matched: boolean };
  warnings: string[];
};

function toFormData(body: Record<string, unknown>, files: Record<string, File | null | undefined>): FormData {
  const fd = new FormData();
  const put = (key: string, v: unknown) => {
    if (v === null || v === undefined) { fd.append(key, ''); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => put(`${key}[${i}]`, x)); return; }
    if (typeof v === 'object') { Object.entries(v as Record<string, unknown>).forEach(([k, x]) => put(`${key}[${k}]`, x)); return; }
    fd.append(key, String(v));
  };
  Object.entries(body).forEach(([k, v]) => put(k, v));
  Object.entries(files).forEach(([k, f]) => { if (f) fd.append(k, f); });
  return fd;
}

export type SpiDetailItem = SpiSavedItem & { qty_spi: string; rate: string; extra_qty: string | null };

export type SpiDetail = {
  invoice: SpiHeader & {
    purchase_order_id: number | null;
    vendor_id: number;
    document_type: 'domestic' | 'international';
    invoice_no: string | null;
    invoice_date: string | null;
    invoice_file_name: string | null;
    eway_file_name: string | null;
    items: SpiDetailItem[];
    warehouse: { id: number; wh_id: string | null; wh_name: string; wh_type: string | null } | null;
  };
};

export type ProductRefresh = {
  id: number; code: string; name: string; description: string; hsn: string; gst: number; uom: string | null;
};

export type SpiBoxScenario = 's1' | 's2' | 's3';

export type SpiBoxItemBody = {
  supplier_invoice_item_id: number;
  quantity: number;
  is_stackable: boolean;
  remark: 'correct' | 'damaged' | 'mismatched' | 'extra';
  remark_note: string | null;
  flags: number[];
  serial_no: string | null;
  lot_no: string | null;
  batch_no: string | null;
  cat_no: string | null;
  expiry_date: string | null;
  mfg_date: string | null;
};

export type SpiBoxBody = {
  scenario: SpiBoxScenario;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  condition: 'perfect' | 'minor' | 'major' | 'severe';
  items: SpiBoxItemBody[];
};

/* The list endpoint returns the whole row, so a saved box can be read back
   into the drawer that made it. Everything past `quantity` is what an edit
   needs and a create does not. */
export type SpiBoxItem = {
  id: number;
  supplier_invoice_item_id: number;
  quantity: string;
  is_stackable?: boolean;
  remark?: 'correct' | 'damaged' | 'mismatched' | 'extra';
  remark_note?: string | null;
  flags?: number[] | null;
  serial_no?: string | null;
  lot_no?: string | null;
  batch_no?: string | null;
  cat_no?: string | null;
  /** Date-cast on the server, so it arrives as a full ISO timestamp. */
  expiry_date?: string | null;
  mfg_date?: string | null;
};

export type SpiBox = {
  id: number;
  box_code: string;
  scenario: SpiBoxScenario;
  condition: string;
  sticker_printed_at: string | null;
  /** Decimal-cast, so these arrive as strings like "40.00". */
  length_cm?: string | number | null;
  width_cm?: string | number | null;
  height_cm?: string | number | null;
  weight_kg?: string | number | null;
  net_weight_kg?: string | number | null;
  gross_weight_kg?: string | number | null;
  items: SpiBoxItem[];
};

export type SpiPackingTotals = {
  lines: number; qty_spi: number; qty_packed: number; qty_pending: number; lines_done: number; fully_packed: boolean;
};

export type ProductFlagOption = { id: number; flag_name: string | null };

export const spiApi = {
  boxes: (spiId: number) =>
    call('SPI boxes', () => api.get(`/p2p/spi/${spiId}/boxes`),
      (b) => ((b as { data?: { boxes?: SpiBox[] } } | null)?.data?.boxes ?? [])),

  nextBoxCodes: (spiId: number, count = 20) =>
    call('SPI next box codes', () => api.get(`/p2p/spi/${spiId}/boxes/next-codes`, { params: { count } }),
      (b) => ((b as { data?: { next_codes?: string[] } } | null)?.data?.next_codes ?? [])),

  createBox: (spiId: number, body: SpiBoxBody) =>
    call('SPI box save', () => api.post(`/p2p/spi/${spiId}/boxes`, body),
      (b) => (b as { data?: { box: SpiBox; totals: SpiPackingTotals } } | null)?.data?.box as SpiBox),

  /* Replaces a saved box in place: same box_code, new dimensions and new
     contents. The server swaps the items wholesale, so dropping one product
     out of a mixed carton is an edit here rather than a delete-and-rebuild. */
  updateBox: (spiId: number, boxId: number, body: SpiBoxBody) =>
    call('SPI box update', () => api.put(`/p2p/spi/${spiId}/boxes/${boxId}`, body),
      (b) => (b as { data?: { box: SpiBox } } | null)?.data?.box as SpiBox),

  deleteBox: (spiId: number, boxId: number) =>
    call('SPI box delete', () => api.delete(`/p2p/spi/${spiId}/boxes/${boxId}`), () => true),

  packingTotals: (spiId: number) =>
    call('SPI packing summary', () => api.get(`/p2p/spi/${spiId}/packing-summary`),
      (b) => (b as { data?: { totals?: SpiPackingTotals } } | null)?.data?.totals ?? null),

  productFlags: () =>
    call('Product flags', () => api.get('/inventory/product-flags/options'),
      (b) => ((b as { data?: ProductFlagOption[] } | null)?.data ?? [])),

  product: (id: number) =>
    call('Product detail', () => api.get(`/products/${id}`), (b) => {
      const d = ((b as { data?: Record<string, unknown> } | null)?.data ?? b ?? {}) as {
        id: number; product_code?: string; name?: string; description?: string | null;
        hsn?: { hsn_code?: string } | null; gst_percentage?: { percentage?: string | number } | null;
        uom?: { short_code?: string; title?: string } | null;
      };
      return {
        id: d.id,
        code: d.product_code ?? '',
        name: d.name ?? '',
        description: d.description ?? '',
        hsn: d.hsn?.hsn_code ?? '',
        gst: Number(d.gst_percentage?.percentage ?? 0) || 0,
        uom: d.uom?.short_code ?? d.uom?.title ?? null,
      } as ProductRefresh;
    }),

  vendorScrutiny: (vendorId: number) =>
    call('Supplier GST scrutiny', () => api.get(`/vendors/${vendorId}`),
      (b) => ((b as { data?: { gst_scrutiny?: GstScrutinyRow[] } } | null)?.data?.gst_scrutiny ?? [])),

  show: (id: number) =>
    call('SPI detail', () => api.get(`/p2p/spi/${id}`), (b) => (b as { data?: SpiDetail } | null)?.data as SpiDetail),

  poLines: (poId: number, excludeSpiId?: number | null) =>
    call('SPI PO lines', () => api.get(`/p2p/spi/orders/${poId}/lines`, {
      params: excludeSpiId ? { exclude_spi: excludeSpiId } : undefined,
    }), (b) => ((b as { data?: { lines?: SpiPoLine[] } } | null)?.data?.lines ?? [])),

  saveItems: (spiId: number, body: Record<string, unknown>, files: { invoice_file?: File | null; eway_file?: File | null } = {}) =>
    call('SPI save (Stage 02)', () => (files.invoice_file || files.eway_file
      ? api.post(`/p2p/spi/${spiId}/items`, toFormData(body, files), { headers: { 'Content-Type': 'multipart/form-data' } })
      : api.post(`/p2p/spi/${spiId}/items`, body)),
    (b) => (b as { data?: SpiItemsResult } | null)?.data as SpiItemsResult),

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
