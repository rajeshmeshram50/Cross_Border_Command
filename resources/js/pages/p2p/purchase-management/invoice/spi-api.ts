import type { GstScrutinyRow } from './invoice-draft';
import axios from 'axios';
import api from '../../../../api';
import { PoApiError, type PoPaymentBody, type PoPaymentRow, type PoPaymentsPayload } from '../order/api/po-api';
import type { ServerPageMeta } from '../../../../hooks/useServerList';
import type {
  InvoiceInspectionStatus, InvoicePoType, InvoiceRiskLevel, InvoiceRow,
  InvoiceScope, InvoiceShipmentScope, InvoiceSupplierCategory, StorageWarehouse,
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
  warehouse_id?: number | null;
};

export type SpiHeader = {
  id: number; code: string; status: string; stage_completed: number;
  /** The branch the invoice belongs to — which decides whose masters apply. */
  branch_id?: number | null;
};

/**
 * A PO line as Stage 02 needs it.
 *
 * qty_po is what the order asked for ONCE. The grid works from qty_open — what
 * is left after every other invoice on this PO — because only the server can see
 * those other invoices. qty_open never goes negative; qty_over carries how far
 * earlier invoices already went past the order, which is context, not a column.
 */
export type SpiPoLine = {
  po_item_id: number; pi_item_id: number | null; product_id: number | null; description: string | null;
  qty_po: number; qty_billed: number; qty_open: number; qty_over: number; closed: boolean;
  rate: number; gst_pct: number | null;
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
    warehouse: { id: number; code: string | null; wh_name: string; wh_type: string | null } | null;
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
  /** 0 or 1 — whether another carton may sit on this one. */
  is_stackable: 0 | 1;
  /** Cold-chain range in °C; null when the box is not cold chain. */
  temp_min_c: number | null;
  temp_max_c: number | null;
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
  /** 0 or 1. Absent on boxes saved before the column existed. */
  is_stackable?: number | null;
  /** Decimal-cast, so these arrive as strings like "2.00". */
  temp_min_c?: string | number | null;
  temp_max_c?: string | number | null;
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

/** What the box itself demands, resolved server-side from its contents. */
export type PutawayNeed = {
  id: number; box_code: string;
  weight_kg: number; height_cm: number; footprint_cm2: number; volume_cm3: number;
  cold_chain: boolean; hazardous: boolean; fragile: boolean; is_stackable: boolean;
  temp_min_c: number | null; temp_max_c: number | null;
};

export type PutawayShelf = {
  id: number; name: string | null; code: string; level_no: number;
  max_weight_kg: number; free_weight_kg: number; boxes: number;
  used_pct: number; used_pct_after: number;
  eligible: boolean;
  /** Why it was refused, already worded by the engine; null when eligible. */
  reason: string | null; reason_label: string | null;
  held_by: number | null;
  /** Only on an eligible shelf — 0-100, the engine's weights summed. */
  score?: number;
};

export type PutawayRack = { id: number; name: string | null; code: string; shelves: PutawayShelf[]; total: number; eligible: number };

export type PutawayZone = {
  id: number; name: string | null; code: string; rack_mode: string | null;
  cold_chain: number; hazardous: number;
  /** What the zone is for, and the range it holds - what the door says. */
  purpose: string | null; temp_min_c: number | null; temp_max_c: number | null;
  racks: PutawayRack[]; total: number; eligible: number;
};

/** The engine's pick: the top shelf of the same ranked list, with the zone and
 *  rack it sits in folded in so the card can name the whole path. */
export type PutawayPick = PutawayShelf & {
  zone_id: number; zone_name: string | null; zone_code: string;
  rack_id: number; rack_name: string | null; rack_code: string;
};

export type PutawayLocations = {
  box: PutawayNeed;
  modes: { rack: number; norack: number };
  zones: PutawayZone[];
  total: number; eligible: number;
  recommended: PutawayPick | null;
};

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

  /* The flag master of the INVOICE'S branch, not the switcher's.
     Flag ids are per branch — branch 1's "Cold Chain" and branch 2's are
     different rows — and the options endpoint answers for whichever branch the
     switcher is on. Editing another branch's invoice therefore resolved the
     Cold Chain chip to the wrong branch's id, which the server now refuses as
     a flag that branch has never heard of. Asking for the invoice's own branch
     is what makes the chip resolve to an id the box may actually carry. */
  warehouses: () =>
    call('Warehouses', () => api.get('/inventory/warehouses/options'), (b) =>
      ((b as { data?: Array<{ id: number; wh_code: string | null; wh_name: string | null; wh_type: string; location: string | null }> } | null)?.data ?? [])
        .filter(w => w.wh_type === 'own')
        .map((w): StorageWarehouse => ({
          id: String(w.id),
          apiId: w.id,
          code: w.wh_code ?? undefined,
          name: w.wh_name ?? `Warehouse ${w.id}`,
          location: [w.wh_code, w.location].filter(Boolean).join(' · ') || '—',
        }))),

  /** Step 04 · Step 02 proper: the whole tree for one mode, plus the engine's
   *  pick. One call, because the recommendation IS the top of that same ranked
   *  list - asking twice would cost twice and could disagree with itself. */
  putawayLocations: (spiId: number, boxId: number, mode: 'rack' | 'norack') =>
    call('Putaway locations', () => api.get(`/p2p/spi/${spiId}/putaway/locations`, { params: { box_id: boxId, mode } }),
      (b) => ((b as { data?: PutawayLocations } | null)?.data ?? null)),

  /** Step 04 · Step 02's opening question: how many places of each kind this
   *  box may go. Without a mode the server returns only the two counts, which
   *  is all the chooser needs. */
  putawayModes: (spiId: number, boxId: number) =>
    call('Putaway locations', () => api.get(`/p2p/spi/${spiId}/putaway/locations`, { params: { box_id: boxId } }),
      (b) => {
        const m = (b as { data?: { modes?: { rack?: number; norack?: number } } } | null)?.data?.modes;
        return { rack: Number(m?.rack ?? 0), norack: Number(m?.norack ?? 0) };
      }),

  productFlags: (branchId?: number | null) =>
    call('Product flags', () => api.get('/inventory/product-flags/options',
      branchId ? { params: { branch_id: branchId } } : undefined),
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

export type SpiPaymentSummary = {
  spi: { id: number; code: string; base_amount: number; gst_amount: number; grand_total: number; paid_amount: number; balance: number };
  po: { id: number; code: string; grand_total: number; tds_amount: number; net_payable: number; paid_amount: number; balance_amount: number } | null;
  requests: Array<{ id: number; status: string }>;
};

export type SpiRaiseBody = {
  payment_type: string;
  percentage?: number;
  requested_amount: number;
  reason: string;
  requested_to: number;
};

const spiPaymentForm = (b: PoPaymentBody) => {
  const f = new FormData();
  f.append('amount', String(b.amount));
  if (b.bank_name) f.append('bank_name', b.bank_name);
  if (b.utr_cheque_number) f.append('utr_cheque_number', b.utr_cheque_number);
  if (b.utr_cheque_date) f.append('utr_cheque_date', b.utr_cheque_date);
  if (b.proof) f.append('proof', b.proof);
  return f;
};

export const spiPaymentApi = {
  summary: (spiId: number) =>
    call('SPI payment requests', () => api.get(`/p2p/spi/${spiId}/payment-requests`),
      (b) => (b as { data: SpiPaymentSummary }).data),

  raise: (spiId: number, body: SpiRaiseBody) =>
    call('Raise SPI payment request', () => api.post(`/p2p/spi/${spiId}/payment-requests`, body),
      (b) => (b as { data: PoPaymentsPayload }).data),

  addPayment: (spiId: number, requestId: number, body: PoPaymentBody) =>
    call('Record SPI payment', () => api.post(`/p2p/spi/${spiId}/payment-requests/${requestId}/payments`,
      spiPaymentForm(body), { headers: { 'Content-Type': 'multipart/form-data' } }),
      (b) => (b as { data: { payment: PoPaymentRow; summary: PoPaymentsPayload } }).data),
};

export type VaultDocument = {
  name: string;
  meta: string;
  kind: string;
  status: string;
  source: 'uploaded' | 'generated' | 'signed' | 'awaited' | string;
  file_url: string | null;
  url: string | null;
  modes: string[];
  action_url?: string | null;
  action?: string | null;
  signed_file_url?: string | null;
  amount?: number;
  required?: boolean;
};

export type VaultSection = { key: string; title: string; documents: VaultDocument[] };
export type VaultGroup = { key: string; title: string; subtitle: string; sections: VaultSection[] };
export type EvidenceVault = {
  subject: { kind: string; id: number; code: string };
  related: { purchase_order?: { id: number; code: string } };
  groups: VaultGroup[];
  totals: { documents: number; available: number; missing: number };
};

export const spiVaultApi = {
  vault: (spiId: number) =>
    call('Evidence vault', () => api.get(`/p2p/spi/${spiId}/evidence-vault`),
      (b) => (b as { data: EvidenceVault }).data),

  file: async (url: string, preview: boolean): Promise<Blob> => {
    const path = url.replace(/^\/api(?=\/)/, '');
    const full = preview ? `${path}${path.includes('?') ? '&' : '?'}mode=preview` : path;
    try {
      const res = await api.get(full, { responseType: 'blob' });
      return res.data as Blob;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        throw new PoApiError('Vault file', err.response?.status ?? null,
          err.response?.status === 404 ? 'The file is missing from storage.' : 'Could not open the file.', {}, null);
      }
      throw err;
    }
  },
};
