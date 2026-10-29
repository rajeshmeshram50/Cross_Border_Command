import axios from 'axios';
import api from '../../../../../api';

export class PoApiError extends Error {
  constructor(
    public action: string,
    public status: number | null,
    message: string,
    public fieldErrors: Record<string, string[]> = {},
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'PoApiError';
  }

  get firstError(): string {
    const first = Object.values(this.fieldErrors)[0]?.[0];
    return first ?? this.message;
  }
}

async function call<T>(action: string, run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    const res = await run();
    return pick(res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      const e = new PoApiError(action, err.response?.status ?? null,
        body?.message || err.message || 'Request failed', body?.errors ?? {}, body ?? null);
      console.error(`[PO API] ${action} failed (${e.status ?? 'network'}): ${e.message}`, e.fieldErrors);
      throw e;
    }
    throw err;
  }
}

const dataOf = <T>(body: unknown): T => (body as { data?: T } | null)?.data as T;
const listOf = <T>(body: unknown): T[] =>
  (Array.isArray(body) ? body : ((body as { data?: T[] } | null)?.data ?? [])) as T[];

export type YesNo = 'yes' | 'no';
export type PoStatus = 'draft' | 'submitted' | 'cancelled';
export type PoTypeKey = 'material_goods' | 'services' | 'ffd_transporter';
export type DocTypeKey = 'domestic' | 'international';
export type LinkType = 'with_shipment' | 'standalone';
export type TaxMode = 'intra' | 'inter' | 'export';
export type GstGate = 'clear' | 'approval_required' | 'blocked';
export type GstApprovalStatus = 'pending' | 'approved' | 'rejected';

export type PoLinkRefs = {
  shipment_code: string | null; shipment_date: string | null;
  pi_code: string | null; pi_date: string | null;
  customer_name: string | null; opportunity_code: string | null;
};

export type PoListRow = PoLinkRefs & {
  id: number; code: string; po_date: string | null; status: PoStatus; current_step: number | null;
  po_type: PoTypeKey | null; document_type: DocTypeKey | null;
  vendor_id: number | null; supplier_code: string | null; supplier_name: string | null;
  supplier_risk: string | null; supplier_category: string | null;
  link_type: LinkType | null; shipment_order_id: number | null;
  link_procurement: YesNo | null;
  procurement_request_id: number | null; procurement_request_code: string | null;
  expected_delivery_date: string | null; grand_total: number;
  currency_code: string | null;
  taxable_total: number; gst_total: number; charges_total: number;
  tds_amount: number; paid_amount: number; balance_amount: number;
  payment_requests_count: number; pending_request_amount: number; ready_to_pay_amount: number;
  physical_inspection: YesNo | null; inspection_status: 'not_required' | 'pending' | 'completed' | null;
  cancel_reason: string | null; items_count: number | null; created_at: string | null;
  signing_started: boolean;
  cancel_stage: PoCancelStage | null;
  refund: PoListRefund | null;
  zoho_status: 'synced' | 'failed' | null; zoho_bill_number: string | null; zoho_error: string | null;
  zoho_started: boolean;
  zoho_unposted_payments: number;
};

export type PoCancelStage = 'initiated' | 'closed';
export type RefundStatus = 'pending' | 'partial' | 'recovered';
export type PoListRefund = {
  id: number; code: string; date: string | null; paid: number; refund: number; retained: number;
  recovered: number; balance: number; status: RefundStatus;
  zoho_synced: boolean;
};

export type PoListTab = 'all' | 'with' | 'without' | 'cancelinit' | 'cancelclosed';

export type PoListMeta = { total: number; page: number; per_page: number; last_page: number; counts: Record<PoListTab, number> };

export type PoItem = {
  id: number; line_no: number; pi_item_id: number | null; product_id: number | null; description: string | null;
  quantity: string; rate: string; gst_pct: string;
  taxable_amount: string; cgst_amount: string; sgst_amount: string; igst_amount: string; line_total: string;
  product_code: string | null; product_name: string | null; hsn_code: string | null; uom: string | null;
  pi_product_id: number | null; pi_product_code: string | null; pi_product_name: string | null;
  pi_quantity: number | null; pi_rate: number | null;
  cgst_pct: number; sgst_pct: number; igst_pct: number; gst_amount: number;
  pending_before_this_po: number | null; missing_qty: number | null;
};

export type PoDocument = {
  id: number; code: string; name: string; doc_kind: 'purchase_order' | 'agreement' | 'other';
  source_type: 'trade' | 'agreement' | null; source_id: number | null;
  doc_sub: string | null;
  master_code: string | null;
  is_required: YesNo; generated_on: string | null; valid_up_to: string | null;
  needed: YesNo | null;
  file_path: string | null; original_name: string | null; file_url: string | null;
  status: 'pending' | 'sent' | 'signed'; sent_at: string | null; signed_at: string | null;
  signature_request_id: number | null; signature_status: string | null; signature_index: number | null;
};

export type PoDetail = PoLinkRefs & {
  id: number; code: string; po_date: string | null; status: PoStatus; current_step: number | null;
  po_type: PoTypeKey | null; document_type: DocTypeKey | null;
  mode_of_transport: string | null; expected_delivery_date: string | null; delivery_location: string | null;
  payment_type: string | null; physical_inspection: YesNo | null;
  currency_code: string | null; exchange_rate: string | null; inco_term: string | null;
  port_of_loading: string | null; port_of_discharge: string | null;
  final_destination: string | null; country_of_origin: string | null;
  link_type: LinkType | null; link_procurement: YesNo | null;
  procurement_request_id: number | null; procurement_request_code: string | null;
  shipment_order_id: number | null; proforma_invoice_id: number | null; lead_id: number | null;
  vendor_id: number | null; home_state_code: string | null; tax_mode: TaxMode | null;
  gst_gate: GstGate | null; gst_scrutiny_date: string | null; gst_last_filing_date: string | null;
  gst_approval_status: GstApprovalStatus | null; gst_approval_note: string | null;
  gst_approval: { id: number; status: GstApprovalStatus; reason: string | null; requested_to_name: string | null;
    requested_at: string | null; decided_at: string | null } | null;
  taxable_total: string; total_cgst: string; total_sgst: string; total_igst: string;
  shipping_charges: string; packaging_charges: string; other_charges: string; grand_total: string;
  terms: string | null; submitted_at: string | null; cancel_reason: string | null;
  inspection_status: 'not_required' | 'pending' | 'completed' | null;
  created_by: number | null; created_by_name: string | null;
  payments_started: boolean;
  signing_started: boolean;
  terms_layers?: {
    typed: string;
    global: string[];
    segment: Array<{ code?: string; category?: string; segment?: string; content?: string }>;
  } | null;
  supplier: { vendor_id: number; supplier_code: string; supplier_name: string; supplier_gstin: string | null; supplier_state_code: string | null } | null;
  items: PoItem[];
  documents: PoDocument[];
};

export type PoStage1Body = {
  po_type: PoTypeKey; document_type: DocTypeKey;
  mode_of_transport?: string | null; expected_delivery_date?: string | null; delivery_location?: string | null;
  payment_type?: string | null; physical_inspection?: YesNo;
  currency_code?: string | null; exchange_rate?: number | string | null; inco_term?: string | null;
  port_of_loading?: string | null; port_of_discharge?: string | null;
  final_destination?: string | null; country_of_origin?: string | null;
  link_type: LinkType; shipment_order_id?: number | null;
  link_procurement?: YesNo | null; procurement_request_id?: number | null; procurement_request_code?: string | null;
  vendor_id: number;
};

export type PoItemsBody = {
  lines: { pi_item_id?: number | null; product_id?: number | null; quantity: number; rate: number; description?: string | null }[];
  shipping_charges?: number; packaging_charges?: number; other_charges?: number;
};

export type PoQtyHistoryRow = {
  id: number; purchase_order_item_id: number | null; pi_item_id: number | null; product_id: number | null;
  event: 'added' | 'updated' | 'removed' | 'cancelled' | 'deleted';
  pi_quantity: string | null; previous_qty: string | null; current_qty: string | null;
  change_qty: string | null; pending_after: string | null;
  changed_by: { id: number; name: string } | null; created_at: string;
};

export type PiLine = {
  pi_item_id: number; product_id: number | null; product_code: string | null; product_name: string | null;
  hsn_code: string | null; uom: string | null; rate: number;
  gst_pct: number | null; description: string | null;
  pi_quantity: number; ordered_qty: number; pending_qty: number;
};

export type InspectionFile = { index: number; path: string; name: string; mime: string; size: number; url: string };

export type InspectionVerdict = 'correct' | 'damaged' | 'mismatched';

export type InspectionSummary = {
  purchase_order_id: number; code: string; po_date: string | null; status: PoStatus;
  shipment_code: string | null; shipment_date: string | null;
  pi_code: string | null; pi_date: string | null;
  opportunity_code: string | null; procurement_request_code: string | null;
  supplier_code: string | null; supplier_name: string | null; grand_total: number;
  physical_inspection: YesNo | null;
  inspection_status: 'not_required' | 'pending' | 'completed' | null;
  lines_total: number; lines_marked: number;
  inspection_note: string | null; inspection_note_files: InspectionFile[];
  inspected_by: number | null; inspected_by_name: string | null; inspected_at: string | null;
  lines: {
    purchase_order_item_id: number; line_no: number; product_id: number | null;
    product_code: string | null; product_name: string | null; hsn_code: string | null; uom: string | null;
    gst_pct: number; description: string | null; quantity: number;
    verdict: InspectionVerdict | null; remark: string | null;
    proof_files: InspectionFile[];
    inspected_by_name: string | null; inspected_at: string | null;
  }[];
};

export type ShipmentOption = {
  id: number; code: string; shipment_date?: string | null; customer: string | null; consignee: string | null;
  opportunity_id: number | null; opportunity_code: string | null;
  proforma_invoice_id: number | null; pi_number: string | null;
};
export type PoProofFile = {
  id: number; amount: number; date: string | null; ref: string;
  name: string | null; url: string | null;
};

export type PoProofAdjustment = {
  id: number; code: string; date: string | null; refund_amount: number;
  attachment_name: string | null; attachment_url: string | null;
};

export type PoProofs = {
  adjustment: PoProofAdjustment | null;
  payments: PoProofFile[];
  recoveries: PoProofFile[];
};

export type ZohoTrackerStep = {
  key: 'purchase_order' | 'bill' | 'payments' | 'vendor_credit' | 'refunds';
  title: string; sub: string;
  state: 'done' | 'pending' | 'failed';
  ref: string | null;
  at: string | null;
  note: string | null;
  amount: number | null;
  items: ZohoTrackerItem[];
  error: string | null;
};

export type ZohoTrackerItem = {
  label: string; amount: number;
  state: 'done' | 'pending' | 'failed';
  ref: string | null; at: string | null; error: string | null;
};

export type ZohoTracker = {
  po_code: string; currency: string; cancelled: boolean;
  done: number; total: number;
  steps: ZohoTrackerStep[];
};

export type SupplierOption = {
  id: number; code: string; name: string; document_type: DocTypeKey;
  supplier_type?: string | null;
  supplier_category?: string | null;
};
export type SupplierDetail = {
  id: number; code: string; name: string; legalName: string | null; type: string | null;
  risk: string | null; category: string | null; segments: string[];
  mapped_product_ids?: number[];
  product_rates?: Record<number, number>;
  addr: string | null; country: string | null; state: string | null; stateCode: string | null; city: string | null;
  contact: string | null; desig: string | null; phone: string | null; email: string | null;
  scrutiny: string | null; gstNo: string | null; gstStatus: string | null; filing: string | null; remarks: string | null;
  zohoCurrency?: string | null;
  zohoCurrencySettled?: boolean;
  zohoCurrencyPo?: string | null;
  zohoCurrencies?: string[];
};

export const poApi = {
  nextCode: () =>
    call('PO next code', () => api.get('/p2p/orders/next-code'), dataOf<{ code: string; financial_year: string }>),

  list: (params: { tab?: PoListTab; status?: PoStatus; search?: string; link_type?: LinkType; shipment_order_id?: number; procurement_request_id?: number; vendor_id?: number; per_page?: number; page?: number } = {}) =>
    call('PO list', () => api.get('/p2p/orders', { params }), (b) => {
      const body = b as { data?: PoListRow[]; meta?: PoListMeta } | null;
      return { rows: body?.data ?? [], meta: body?.meta ?? null };
    }),

  show: (id: number) =>
    call('PO detail', () => api.get(`/p2p/orders/${id}`), dataOf<PoDetail>),

  create: (body: PoStage1Body) =>
    call('PO create (Stage 01)', () => api.post('/p2p/orders', body), dataOf<PoDetail>),

  updateStage1: (id: number, body: PoStage1Body) =>
    call('PO update (Stage 01)', () => api.put(`/p2p/orders/${id}/stage-1`, body), dataOf<PoDetail>),

  saveItems: (id: number, body: PoItemsBody) =>
    call('PO product lines (Stage 02)', () => api.put(`/p2p/orders/${id}/items`, body), dataOf<PoDetail>),

  saveTerms: (id: number, body: { terms?: string | null; submit?: YesNo }) =>
    call(body.submit === 'yes' ? 'PO submit (Stage 03)' : 'PO terms (Stage 03)', () => api.put(`/p2p/orders/${id}/terms`, body), dataOf<PoDetail>),

  qtyHistory: (id: number) =>
    call('PO qty history', () => api.get(`/p2p/orders/${id}/qty-history`), dataOf<PoQtyHistoryRow[]>),

  cancel: (id: number, reason: string) =>
    call('PO cancel', () => api.post(`/p2p/orders/${id}/cancel`, { reason }), dataOf<PoDetail>),

  proofs: (id: number) =>
    call('PO proofs', () => api.get(`/p2p/orders/${id}/proofs`), dataOf<PoProofs>),

  zohoTracker: (id: number) =>
    call('PO Zoho tracker', () => api.get(`/p2p/orders/${id}/zoho-tracker`), dataOf<ZohoTracker>),

  zohoSync: (id: number) =>
    call('PO Zoho sync', () => api.post(`/p2p/orders/${id}/zoho-sync`), (b) => ({ message: (b as { message?: string } | null)?.message ?? 'Synced to Zoho Books.' })),

  remove: (id: number) =>
    call('PO delete', () => api.delete(`/p2p/orders/${id}`), dataOf<{ id: number; deleted: boolean }>),

  piLines: (shipmentId: number, excludePo?: number) =>
    call('PO PI lines', () => api.get(`/p2p/orders/shipments/${shipmentId}/pi-lines`, { params: excludePo ? { exclude_po: excludePo } : {} }),
      dataOf<{ proforma_invoice_id: number | null; lines: PiLine[]; held_by?: PiHolder[] }>),
};

export type PiHolder = {
  id: number; code: string; status: PoStatus; lines: number; qty: number;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
};

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const poDocumentApi = {
  markSent: (poId: number, documentIds: number[], signatureRequestId: number) =>
    call('PO documents sent', () => api.post(`/p2p/orders/${poId}/documents/mark-sent`,
      { document_ids: documentIds, signature_request_id: signatureRequestId }), dataOf<PoDocument[]>),

  setNeeds: (poId: number, items: { id: number; needed: boolean }[]) =>
    call('PO document decisions', () => api.post(`/p2p/orders/${poId}/documents/needs`, { items }), dataOf<PoDocument[]>),

  list: (poId: number) =>
    call('PO documents', () => api.get(`/p2p/orders/${poId}/documents`), dataOf<PoDocument[]>),

  add: (poId: number, doc: { name: string; doc_kind?: PoDocument['doc_kind']; is_required?: YesNo; valid_up_to?: string; file?: File | null }) => {
    const fd = new FormData();
    fd.append('name', doc.name);
    if (doc.doc_kind) fd.append('doc_kind', doc.doc_kind);
    if (doc.is_required) fd.append('is_required', doc.is_required);
    if (doc.valid_up_to) fd.append('valid_up_to', doc.valid_up_to);
    if (doc.file) fd.append('file', doc.file);
    return call('PO document add', () => api.post(`/p2p/orders/${poId}/documents`, fd, multipart), dataOf<PoDocument>);
  },

  uploadFile: (poId: number, docId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call('PO document upload', () => api.post(`/p2p/orders/${poId}/documents/${docId}/file`, fd, multipart), dataOf<PoDocument>);
  },

  setStatus: (poId: number, docId: number, status: 'sent' | 'signed') =>
    call('PO document status', () => api.patch(`/p2p/orders/${poId}/documents/${docId}/status`, { status }), dataOf<PoDocument>),

  download: (poId: number, docId: number) =>
    call('PO document download', () => api.get(`/p2p/orders/${poId}/documents/${docId}/download`, { responseType: 'blob' }), (b) => b as Blob),

  generate: (poId: number, docId: number) =>
    call('PO document generate', () => api.post(`/p2p/orders/${poId}/documents/${docId}/generate`), dataOf<PoDocument>),

  sign: (poId: number, documentIds: number[], opts: { signer_name?: string; signer_email?: string; notes?: string; expiry_days?: number } = {}) =>
    call('PO documents e-sign', () => api.post(`/p2p/orders/${poId}/documents/sign`, { document_ids: documentIds, ...opts }),
      dataOf<{ signature_request_id: number; signer: { name: string; email: string }; documents: PoDocument[] }>),

  email: (poId: number, documentIds: number[], to?: string) =>
    call('PO documents email', () => api.post(`/p2p/orders/${poId}/documents/email`, { document_ids: documentIds, to }), dataOf<{ to: string; count: number }>),

  remove: (poId: number, docId: number) =>
    call('PO document delete', () => api.delete(`/p2p/orders/${poId}/documents/${docId}`), dataOf<{ id: number; deleted: boolean }>),
};

export const poSignatureApi = {
  draft: (kind: 'trade' | 'agreement', libraryId: number, supplierId: number) =>
    call('PO draft document', () => api.post(
      '/clm/signature-requests/preview',
      { ...(kind === 'trade' ? { trade_doc_id: libraryId } : { agreement_id: libraryId }), party_id: supplierId, model_name: 'Vendor' },
      { responseType: 'blob' },
    ), (b) => b as Blob),

  signedFile: (sigId: number, index: number) =>
    call('PO signed document', () => api.get(`/clm/signature-requests/${sigId}/download-file/${index}`, { responseType: 'blob' }), (b) => b as Blob),

  certificate: (sigId: number) =>
    call('PO signing certificate', () => api.get(`/clm/signature-requests/${sigId}/certificate`, { responseType: 'blob' }), (b) => b as Blob),

  remind: (sigId: number) =>
    call('PO signing reminder', () => api.post(`/clm/signature-requests/${sigId}/remind`), (d) => d),
};

export const poInspectionApi = {
  show: (poId: number) =>
    call('PO inspection', () => api.get(`/p2p/orders/${poId}/inspection`), dataOf<InspectionSummary>),

  markLine: (poId: number, itemId: number, line: { verdict?: InspectionVerdict; remark?: string; files?: File[] }) => {
    const fd = new FormData();
    if (line.verdict) fd.append('verdict', line.verdict);
    if (line.remark) fd.append('remark', line.remark);
    (line.files ?? []).forEach((f) => fd.append('files[]', f));
    return call('PO inspection line', () => api.post(`/p2p/orders/${poId}/inspection/lines/${itemId}`, fd, multipart), dataOf<InspectionSummary>);
  },

  removeFile: (poId: number, itemId: number, index: number) =>
    call('PO inspection file remove', () => api.delete(`/p2p/orders/${poId}/inspection/lines/${itemId}/files/${index}`), dataOf<InspectionSummary>),

  proofFile: (poId: number, itemId: number | null, index: number) =>
    call('Proof file', () => api.get(
      itemId === null
        ? `/p2p/orders/${poId}/inspection/files/${index}`
        : `/p2p/orders/${poId}/inspection/lines/${itemId}/files/${index}`,
      { responseType: 'blob' },
    ), (b) => b as Blob),

  signOff: (poId: number, note?: string, files: File[] = []) => {
    const fd = new FormData();
    if (note) fd.append('note', note);
    files.forEach((f) => fd.append('files[]', f));
    return call('PO inspection sign-off', () => api.post(`/p2p/orders/${poId}/inspection/sign-off`, fd, multipart), dataOf<InspectionSummary>);
  },

  withdraw: (poId: number) =>
    call('PO inspection withdraw', () => api.post(`/p2p/orders/${poId}/inspection/withdraw`), dataOf<InspectionSummary>),
};

export const poLookupApi = {
  shipments: () =>
    call('PO shipments', () => api.get('/p2p/orders/shipments'), dataOf<ShipmentOption[]>),

  suppliers: () =>
    call('PO suppliers', () => api.get('/p2p/orders/suppliers'), dataOf<SupplierOption[]>),

  supplier: (vendorId: number, refreshCurrencies = false) =>
    call('PO supplier detail', () => api.get(`/p2p/orders/suppliers/${vendorId}`, {
      params: refreshCurrencies ? { refresh_currencies: 1 } : undefined,
    }), dataOf<SupplierDetail>),

  supplierVault: (vendorId: number) =>
    call('PO supplier vault', () => api.get(`/segment-uploads/supplier/${vendorId}/vault`), dataOf<Record<string, unknown>>),

  products: (perPage = 200) =>
    call('PO products', () => api.get('/products', { params: { lite: 1, per_page: perPage } }), (b) => listOf<Record<string, unknown>>(b)),

  master: (slug: string) =>
    call(`PO master ${slug}`, () => api.get(`/master/${slug}`), (b) => listOf<Record<string, unknown>>(b)),
};

export type GstApprover = {
  id: number; name: string; email: string | null; user_type: string | null;
  employee_id: number | null; emp_code: string | null; department: string | null; designation: string | null;
};

export type GstApprovalRequest = {
  id: number; purchase_order_id: number; status: GstApprovalStatus;
  requested_by: number; requested_by_name: string | null;
  requested_to: number; requested_to_name: string | null;
  request_note: string | null; requested_at: string | null;
  reason: string | null; decided_at: string | null;
};

export type GstApprovalInboxRow = {
  id: number; purchase_order_id: number; status: GstApprovalStatus;
  request_note: string | null; reason: string | null; requested_at: string | null; decided_at: string | null;
  po_code: string; po_date: string | null; po_status: PoStatus; currency_code: string | null; grand_total: number;
  gst_last_filing_date: string | null; supplier_code: string | null; supplier_name: string | null;
  requested_by_name: string | null; requested_by_designation: string | null; requested_by_department: string | null;
};
export type GstApprovalInboxMeta = { total: number; per_page: number; current_page: number; last_page: number };

export type GstApprovalReview = {
  request: GstApprovalRequest;
  can_decide: boolean;
  po: {
    id: number; code: string; po_date: string | null; status: PoStatus | 'deleted';
    po_type: PoTypeKey | null; document_type: DocTypeKey | null; link_type: LinkType | null;
    currency_code: string | null; exchange_rate: number;
    mode_of_transport: string | null; expected_delivery_date: string | null; delivery_location: string | null; payment_type: string | null;
    inco_term: string | null; port_of_loading: string | null; port_of_discharge: string | null;
    tax_mode: TaxMode | null; physical_inspection: YesNo | null;
    taxable_total: number; total_cgst: number; total_sgst: number; total_igst: number;
    shipping_charges: number; packaging_charges: number; other_charges: number; grand_total: number;
    created_by_name: string | null;
    shipment_code: string | null; pi_code: string | null; customer_name: string | null; opportunity_code: string | null;
  };
  supplier: {
    id: number; code: string | null; name: string | null; company_name: string | null;
    gstin: string | null; gst_applicable: string | null;
    state_code: string | null; state: string | null; city: string | null; address: string | null;
    email: string | null; contact_name: string | null; contact_no: string | null;
    type: string | null; status: string | null; website: string | null;
    risk: string | null; category: string | null;
  } | null;
  gst: { gate: GstGate; scrutiny_date: string | null; filing_date: string | null; gstin: string | null; stale_months: number } | null;
  lines: { line_no: number; product_code: string | null; product_name: string | null; hsn_code: string | null; uom: string | null;
    quantity: number; rate: number; gst_pct: number; taxable_amount: number; gst_amount: number; line_total: number }[];
  tax_label: string;
  history: GstApprovalRequest[];
};

export const poApprovalApi = {
  approvers: (self = false) =>
    call('GST approvers', () => api.get('/p2p/orders/gst-approvals/approvers', { params: self ? { include_self: 1 } : undefined }), dataOf<GstApprover[]>),

  request: (poId: number, body: { requested_to?: number; note?: string }) =>
    call('GST approval request', () => api.post(`/p2p/orders/${poId}/gst-approval/request`, body), dataOf<GstApprovalRequest>),

  inbox: (params: { history: boolean; page?: number; per_page?: number }) =>
    call('PO approvals', () => api.get('/p2p/orders/gst-approvals', {
      params: { history: params.history ? 1 : 0, page: params.page ?? 1, per_page: params.per_page ?? 10 },
    }), (b) => {
      const body = b as { data?: GstApprovalInboxRow[]; meta?: GstApprovalInboxMeta } | null;
      return { rows: body?.data ?? [], meta: body?.meta ?? null };
    }),

  show: (id: number) =>
    call('PO approval', () => api.get(`/p2p/orders/gst-approvals/${id}`), dataOf<GstApprovalReview>),

  decide: (id: number, body: { decision: 'approved' | 'rejected'; reason: string }) =>
    call('PO approval decision', () => api.put(`/p2p/orders/gst-approvals/${id}`, body), dataOf<GstApprovalRequest>),
};

export type PayRequestStatus = 'pending' | 'approved' | 'rejected';
export type PayPerson = { id: number; name: string | null; role: string | null };

export type PoPaymentPosition = {
  id: number; code: string; status: PoStatus; document_type: DocTypeKey | null;
  currency_code: string;
  base_amount: number; gst_amount: number; gst_pct: number; extra_charges: number; grand_total: number;
  tds_percentage: number; tds_amount: number; tds_saved: boolean; tds_locked: boolean; tds_applies: boolean;
  tds_locked_by?: 'payment' | 'approval' | null;
  net_payable: number; paid: number; balance: number; paid_pct: number; complete: boolean;
};

export type PoRequestsSummary = {
  total_requests: number; approved_count: number; pending_count: number; rejected_count: number;
  requested_amount: number; awaiting_amount: number; approved_amount: number;
  approved_unpaid: number; ready_count: number; paid: number; open_to_request: number;
};

export type PoPayRequest = {
  id: number; code: string; payment_type: string; percentage: number | null; requested_amount: number; reason: string | null;
  requested_by: PayPerson; requested_to: PayPerson; requested_at: string | null;
  status: PayRequestStatus; approved_amount: number | null; decision_note: string | null; decided_at: string | null;
  paid_amount: number; due: number | null;
  can_decide?: boolean;
};

export type PoPaymentsPayload = { po: PoPaymentPosition; requests_summary: PoRequestsSummary; requests: PoPayRequest[] };

export type PoPaymentRow = {
  id: number; amount: number; bank_name: string | null; utr_cheque_number: string | null; utr_cheque_date: string | null;
  proof_name: string | null; proof_url: string | null; created_at: string | null;
  zoho_synced?: boolean; zoho_sync_status?: 'synced' | 'failed' | null; zoho_error?: string | null;
};

export type PoPaymentBody = { amount: number; bank_name?: string; utr_cheque_number?: string; utr_cheque_date?: string; proof?: File | null };

export type PayRequestListRow = {
  id: number; code: string; purchase_order_id: number; payment_type: string; percentage: number | null;
  requested_amount: number; status: PayRequestStatus; approved_amount: number | null; paid_amount: number; due: number | null;
  requested_at: string | null; decided_at: string | null; decision_note: string | null;
  vendor_id: number | null; physical_inspection: YesNo | null; inspection_status: 'not_required' | 'pending' | 'completed' | null;
  shipment_code: string | null; shipment_date: string | null; opportunity_code: string | null; opportunity_date: string | null;
  procurement_code: string | null;
  po_code: string; po_date: string | null; po_status: PoStatus; link_type: LinkType | null;
  currency_code: string; document_type: DocTypeKey | null;
  po_total: number; po_net: number; po_paid: number; po_balance: number;
  supplier_code: string | null; supplier_name: string | null; supplier_category: string | null;
  requested_by: PayPerson; requested_to: PayPerson; can_decide: boolean;
};
export type BulkDecision = {
  decided: { id: number; code: string | null; amount: number | null }[];
  failed: { id: number; code: string | null; message: string }[];
};
export type PayRequestTab = 'all' | 'awaiting' | 'approved' | 'declined';
export type PayRequestListMeta = { total: number; page: number; per_page: number; last_page: number; counts: Record<PayRequestTab, number> };
export type PayRequestDetail = {
  request: PayRequestListRow & { reason: string | null };
  po: PoPaymentsPayload;
  payments: (PoPaymentRow & { payment_request_id: number })[];
};

const paymentForm = (b: PoPaymentBody) => {
  const f = new FormData();
  f.append('amount', String(b.amount));
  if (b.bank_name) f.append('bank_name', b.bank_name);
  if (b.utr_cheque_number) f.append('utr_cheque_number', b.utr_cheque_number);
  if (b.utr_cheque_date) f.append('utr_cheque_date', b.utr_cheque_date);
  if (b.proof) f.append('proof', b.proof);
  return f;
};

export const poPaymentApi = {
  forPo: (poId: number) =>
    call('PO payment summary', () => api.get(`/p2p/orders/${poId}/payment-requests`), dataOf<PoPaymentsPayload>),

  saveTds: (poId: number, body: { tds_percentage?: number; tds_amount?: number }) =>
    call('PO TDS', () => api.put(`/p2p/orders/${poId}/tds`, body), dataOf<PoPaymentsPayload>),

  raise: (poId: number, body: { payment_type: string; percentage?: number; requested_amount: number; reason: string; requested_to: number }) =>
    call('Raise payment request', () => api.post(`/p2p/orders/${poId}/payment-requests`, body), dataOf<PoPaymentsPayload>),

  payments: (poId: number, requestId: number) =>
    call('Payment history', () => api.get(`/p2p/orders/${poId}/payment-requests/${requestId}/payments`),
      dataOf<{ request: PoPayRequest; payments: PoPaymentRow[] }>),

  addPayment: (poId: number, requestId: number, body: PoPaymentBody) =>
    call('Record payment', () => api.post(`/p2p/orders/${poId}/payment-requests/${requestId}/payments`, paymentForm(body), multipart),
      dataOf<{ payment: PoPaymentRow; summary: PoPaymentsPayload }>),

  updatePayment: (poId: number, requestId: number, paymentId: number, body: PoPaymentBody) =>
    call('Update payment', () => api.post(`/p2p/orders/${poId}/payment-requests/${requestId}/payments/${paymentId}`, paymentForm(body), multipart),
      dataOf<{ payment: PoPaymentRow; summary: PoPaymentsPayload }>),

  deletePayment: (poId: number, requestId: number, paymentId: number) =>
    call('Delete payment', () => api.delete(`/p2p/orders/${poId}/payment-requests/${requestId}/payments/${paymentId}`),
      dataOf<{ summary: PoPaymentsPayload }>),

  zohoSyncPayment: (poId: number, requestId: number, paymentId: number) =>
    call('Payment Zoho sync', () => api.post(`/p2p/orders/${poId}/payment-requests/${requestId}/payments/${paymentId}/zoho-sync`),
      (b) => {
        const body = b as { data?: { payment: PoPaymentRow; summary: PoPaymentsPayload }; message?: string } | null;
        return { ...(body?.data as { payment: PoPaymentRow; summary: PoPaymentsPayload }), message: body?.message ?? null };
      }),

  list: (q: { tab?: PayRequestTab; search?: string; page?: number; per_page?: number; mine?: boolean } = {}) =>
    call('Payment requests', () => api.get('/p2p/orders/payment-requests', {
      params: { tab: q.tab ?? 'all', search: q.search || undefined, page: q.page ?? 1, per_page: q.per_page, mine: q.mine ? 1 : undefined },
    }), (b) => {
      const body = b as { data?: PayRequestListRow[]; meta?: PayRequestListMeta } | null;
      return {
        rows: body?.data ?? [],
        meta: body?.meta ?? { total: 0, page: 1, per_page: 10, last_page: 1, counts: { all: 0, awaiting: 0, approved: 0, declined: 0 } },
      };
    }),

  detail: (requestId: number) =>
    call('Payment request details', () => api.get(`/p2p/orders/payment-requests/${requestId}`), dataOf<PayRequestDetail>),

  decide: (requestId: number, body: { decision: 'approved' | 'rejected'; approved_amount?: number; note?: string }) =>
    call('Payment request decision', () => api.put(`/p2p/orders/payment-requests/${requestId}/decision`, body), dataOf<PayRequestDetail>),

  decideMany: (body: { ids: number[]; decision: 'approved' | 'rejected'; note?: string }) =>
    call('Payment request decisions', () => api.put('/p2p/orders/payment-requests/decisions', body), (b) => {
      const body = b as { data?: BulkDecision; message?: string } | null;
      return { ...(body?.data ?? { decided: [], failed: [] }), message: body?.message ?? '' };
    }),
};

export type RefundPo = {
  id: number; code: string; po_date: string | null; po_type: string | null; document_type: DocTypeKey | null;
  expected_delivery_date: string | null; mode_of_transport: string | null; payment_type: string | null;
  physical_inspection: boolean; grand_total: number; tds_amount: number; net_payable: number;
  paid_amount: number; balance_amount: number; status: PoStatus; cancel_stage: PoCancelStage | null; cancel_reason: string | null;
  procurement_code: string | null; vendor_id: number | null; supplier_code: string | null; supplier_name: string | null;
  zoho_bill_number: string | null;
  currency_code?: string | null;
  shipment_code: string | null; shipment_date: string | null; opportunity_code: string | null; opportunity_date: string | null;
};
export type RefundRecoveryRow = {
  id: number; amount: number; recovered_date: string | null; reference_no: string | null;
  proof_name: string | null; proof_url: string | null;
  proofs?: { path: string; name: string; url: string; mime?: string | null; size?: number | null }[];
  zoho_sync_status: 'synced' | 'failed' | null; zoho_error: string | null; zoho_synced_at: string | null;
};
export type RefundRow = {
  id: number; code: string; refund_date: string | null; supplier_ref_no: string | null;
  attachment_name: string | null; attachment_url: string | null;
  refund_type: string; reason: string;
  paid_amount: number; refund_amount: number; retained_amount: number; retained_type: string | null; retained_remark: string | null;
  recovered_amount: number; balance_amount: number; status: RefundStatus; recoveries_count: number;
  zoho_pending_recoveries?: number;
  zoho_vendorcredit_number: string | null; zoho_sync_status: 'synced' | 'failed' | null; zoho_error: string | null; zoho_synced_at: string | null;
  amounts_locked: boolean;
  po: RefundPo | null;
};
export type RefundDetail = RefundRow & {
  recoveries: RefundRecoveryRow[];
  payments?: { id: number; amount: number; utr: string | null; date: string | null; proof_name: string | null; proof_url: string | null }[];
  documents?: { id: number; name: string; status: string | null; date: string | null; url: string | null }[];
};
export type RefundTab = 'all' | 'pending' | 'recovered';
export type RefundListMeta = { total: number; page: number; per_page: number; last_page: number; counts: Record<RefundTab, number> };
export type RefundEligiblePo = { id: number; code: string; po_date: string | null; supplier_name: string | null; supplier_code: string | null; paid_amount: number; currency_code?: string | null };
export type ZohoOutcome = { status: 'synced' | 'failed' | 'skipped'; message: string | null } | null;

export type RefundBody = {
  purchase_order_id?: number; supplier_ref_no?: string; attachment?: File | null;
  refund_type: string; reason: string; refund_amount: number; retained_type?: string; retained_remark?: string;
};
export type RecoveryBody = {
  amount: number; recovered_date: string; reference_no?: string;
  proofs?: File[];
  keep?: string[];
};

const refundForm = (b: RefundBody) => {
  const f = new FormData();
  if (b.purchase_order_id) f.append('purchase_order_id', String(b.purchase_order_id));
  if (b.supplier_ref_no) f.append('supplier_ref_no', b.supplier_ref_no);
  if (b.attachment) f.append('attachment', b.attachment);
  f.append('refund_type', b.refund_type);
  f.append('reason', b.reason);
  f.append('refund_amount', String(b.refund_amount));
  if (b.retained_type) f.append('retained_type', b.retained_type);
  if (b.retained_remark) f.append('retained_remark', b.retained_remark);
  return f;
};
const recoveryForm = (b: RecoveryBody) => {
  const f = new FormData();
  f.append('amount', String(b.amount));
  f.append('recovered_date', b.recovered_date);
  if (b.reference_no) f.append('reference_no', b.reference_no);
  (b.proofs ?? []).forEach((p) => f.append('proofs[]', p));
  if (b.keep) b.keep.length ? b.keep.forEach((p) => f.append('keep[]', p)) : f.append('keep[]', '');
  return f;
};
const withZoho = (b: unknown) => {
  const body = b as { data?: RefundDetail; zoho?: ZohoOutcome; message?: string } | null;
  return { refund: body?.data as RefundDetail, zoho: body?.zoho ?? null, message: body?.message ?? null };
};
const refundBase = '/p2p/orders/refund-adjustments';

export const refundApi = {
  list: (q: { tab?: RefundTab; search?: string; page?: number; per_page?: number } = {}) =>
    call('Refund adjustments', () => api.get(refundBase, {
      params: { tab: q.tab ?? 'all', search: q.search || undefined, page: q.page ?? 1, per_page: q.per_page },
    }), (b) => {
      const body = b as { data?: RefundRow[]; meta?: RefundListMeta } | null;
      return {
        rows: body?.data ?? [],
        meta: body?.meta ?? { total: 0, page: 1, per_page: 10, last_page: 1, counts: { all: 0, pending: 0, recovered: 0 } },
      };
    }),

  eligiblePos: (search?: string) =>
    call('Refundable POs', () => api.get(`${refundBase}/eligible-pos`, { params: { search: search || undefined } }), dataOf<RefundEligiblePo[]>),

  forPo: (poId: number) =>
    call('Refund PO details', () => api.get(`${refundBase}/po/${poId}`), dataOf<{ next_code: string; po: RefundPo }>),

  show: (id: number) =>
    call('Refund adjustment', () => api.get(`${refundBase}/${id}`), dataOf<RefundDetail>),

  create: (body: RefundBody) =>
    call('Raise refund adjustment', () => api.post(refundBase, refundForm(body), multipart), withZoho),

  update: (id: number, body: RefundBody) =>
    call('Update refund adjustment', () => api.post(`${refundBase}/${id}`, refundForm(body), multipart), withZoho),

  pdf: (id: number) =>
    call('Refund adjustment document', () => api.get(`${refundBase}/${id}/pdf`, { responseType: 'blob' }), (b) => b as Blob),

  zohoSync: (id: number) =>
    call('Refund Zoho sync', () => api.post(`${refundBase}/${id}/zoho-sync`), withZoho),

  addRecovery: (id: number, body: RecoveryBody) =>
    call('Record recovery', () => api.post(`${refundBase}/${id}/recoveries`, recoveryForm(body), multipart), withZoho),

  updateRecovery: (id: number, recId: number, body: RecoveryBody) =>
    call('Update recovery', () => api.post(`${refundBase}/${id}/recoveries/${recId}`, recoveryForm(body), multipart), withZoho),

  deleteRecovery: (id: number, recId: number) =>
    call('Delete recovery', () => api.delete(`${refundBase}/${id}/recoveries/${recId}`), withZoho),

  syncRecovery: (id: number, recId: number) =>
    call('Recovery Zoho sync', () => api.post(`${refundBase}/${id}/recoveries/${recId}/zoho-sync`), withZoho),
};
