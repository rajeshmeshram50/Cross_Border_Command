// Every API call the Purchase Order screens make, in one place.
// Screens call these functions, never `api` directly, so a failure always
// names the action it came from (see PoApiError).
import axios from 'axios';
import api from '../../../../../api';

/* ══════════════════════════ Errors ══════════════════════════ */

/** A failed PO call: which action, the HTTP status, the server message and 422 field errors. */
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

  /** First field error, else the message — what a toast should show. */
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
// Masters come back as a bare array or wrapped in { data }.
const listOf = <T>(body: unknown): T[] =>
  (Array.isArray(body) ? body : ((body as { data?: T[] } | null)?.data ?? [])) as T[];

/* ══════════════════════════ Types ══════════════════════════ */

export type YesNo = 'yes' | 'no';
export type PoStatus = 'draft' | 'submitted' | 'cancelled';
export type PoTypeKey = 'material_goods' | 'services' | 'ffd_transporter';
export type DocTypeKey = 'domestic' | 'international';
export type LinkType = 'with_shipment' | 'standalone';
export type TaxMode = 'intra' | 'inter';
export type GstGate = 'clear' | 'approval_required' | 'blocked';
export type GstApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Link and supplier codes the server adds to list rows and the detail. */
export type PoLinkRefs = {
  shipment_code: string | null; shipment_date: string | null;
  pi_code: string | null; pi_date: string | null;
  customer_name: string | null; opportunity_code: string | null;
};

/** One row of GET /p2p/orders. */
export type PoListRow = PoLinkRefs & {
  id: number; code: string; po_date: string | null; status: PoStatus; current_step: number | null;
  po_type: PoTypeKey | null; document_type: DocTypeKey | null;
  vendor_id: number | null; supplier_code: string | null; supplier_name: string | null;
  supplier_risk: string | null; supplier_category: string | null;
  link_type: LinkType | null; shipment_order_id: number | null;
  procurement_request_id: number | null; procurement_request_code: string | null;
  expected_delivery_date: string | null; grand_total: number;
  physical_inspection: YesNo | null; inspection_status: 'not_required' | 'pending' | 'completed' | null;
  cancel_reason: string | null; items_count: number | null; created_at: string | null;
};

export type PoListTab = 'all' | 'with' | 'without' | 'cancelinit' | 'cancelclosed';

/** Paging for the current tab, plus every tab's total (same search and filters). */
export type PoListMeta = { total: number; page: number; per_page: number; last_page: number; counts: Record<PoListTab, number> };

export type PoItem = {
  id: number; line_no: number; pi_item_id: number | null; product_id: number | null; description: string | null;
  quantity: string; rate: string; gst_pct: string;
  taxable_amount: string; cgst_amount: string; sgst_amount: string; igst_amount: string; line_total: string;
  // Read live from products / PI items
  product_code: string | null; product_name: string | null; hsn_code: string | null; uom: string | null;
  pi_product_id: number | null; pi_product_code: string | null; pi_product_name: string | null;
  pi_quantity: number | null; pi_rate: number | null;
  // Derived
  cgst_pct: number; sgst_pct: number; igst_pct: number; gst_amount: number;
  pending_before_this_po: number | null; missing_qty: number | null;
};

export type PoDocument = {
  id: number; code: string; name: string; doc_kind: 'purchase_order' | 'agreement' | 'other';
  /** The CLM library the row came from — null for the Purchase Order itself. */
  source_type: 'trade' | 'agreement' | null; source_id: number | null;
  /** The library's own sub-title: document type / agreement type. */
  doc_sub: string | null;
  is_required: YesNo; generated_on: string | null; valid_up_to: string | null;
  /** This PO's own answer. null = nobody decided yet, which is not the same as 'no'. */
  needed: YesNo | null;
  file_path: string | null; original_name: string | null; file_url: string | null;
  status: 'pending' | 'sent' | 'signed'; sent_at: string | null; signed_at: string | null;
  /** Zoho Sign request (shared /clm/signature-requests) and this file's place in it. */
  signature_request_id: number | null; signature_status: string | null; signature_index: number | null;
};

/** GET /p2p/orders/{id} and every stage save. */
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
  /** The latest senior-approval request on this PO. */
  gst_approval: { id: number; status: GstApprovalStatus; reason: string | null; requested_to_name: string | null;
    requested_at: string | null; decided_at: string | null } | null;
  taxable_total: string; total_cgst: string; total_sgst: string; total_igst: string;
  shipping_charges: string; packaging_charges: string; other_charges: string; grand_total: string;
  terms: string | null; submitted_at: string | null; cancel_reason: string | null;
  inspection_status: 'not_required' | 'pending' | 'completed' | null;
  created_by: number | null; created_by_name: string | null;
  supplier: { vendor_id: number; supplier_code: string; supplier_name: string; supplier_gstin: string | null; supplier_state_code: string | null } | null;
  items: PoItem[];
  documents: PoDocument[];
};

/** Stage 01 body — create and update take the same fields. */
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

/** Stage 02 body — a line is a PI line (pi_item_id), a manual product (product_id), or a PI line with a replacement product. */
export type PoItemsBody = {
  lines: { pi_item_id?: number | null; product_id?: number | null; quantity: number; rate: number; description?: string | null }[];
  shipping_charges?: number; packaging_charges?: number; other_charges?: number;
};

export type PoQtyHistoryRow = {
  id: number; purchase_order_item_id: number | null; pi_item_id: number | null; product_id: number | null;
  event: 'added' | 'updated' | 'removed' | 'cancelled' | 'deleted';
  pi_quantity: string | null; previous_qty: string | null; current_qty: string | null;
  change_qty: string | null; pending_after: string | null;
  /** The user who made the change (the relation replaces the id). */
  changed_by: { id: number; name: string } | null; created_at: string;
};

export type PiLine = {
  pi_item_id: number; product_id: number | null; product_code: string | null; product_name: string | null;
  hsn_code: string | null; uom: string | null; rate: number;
  /** From the product master; null = not set there, the line cannot be ordered. */
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

// Existing shared endpoints (/p2p/purchase-orders/…) reused by the new PO.
export type ShipmentOption = {
  id: number; code: string; customer: string | null; consignee: string | null;
  opportunity_id: number | null; opportunity_code: string | null;
  proforma_invoice_id: number | null; pi_number: string | null;
};
export type SupplierOption = { id: number; code: string; name: string; document_type: DocTypeKey };
export type SupplierDetail = {
  id: number; code: string; name: string; legalName: string | null; type: string | null;
  risk: string | null; category: string | null; segments: string[];
  addr: string | null; country: string | null; state: string | null; stateCode: string | null; city: string | null;
  contact: string | null; desig: string | null; phone: string | null; email: string | null;
  scrutiny: string | null; gstNo: string | null; gstStatus: string | null; filing: string | null; remarks: string | null;
};

/* ══════════════════════════ Purchase order ══════════════════════════ */

export const poApi = {
  /** Preview of the next PO code; the real one is allocated on create. */
  nextCode: () =>
    call('PO next code', () => api.get('/p2p/orders/next-code'), dataOf<{ code: string; financial_year: string }>),

  /** Server-paged: `per_page` defaults to 10 on the server. */
  list: (params: { tab?: PoListTab; status?: PoStatus; search?: string; link_type?: LinkType; shipment_order_id?: number; procurement_request_id?: number; vendor_id?: number; per_page?: number; page?: number } = {}) =>
    call('PO list', () => api.get('/p2p/orders', { params }), (b) => {
      const body = b as { data?: PoListRow[]; meta?: PoListMeta } | null;
      return { rows: body?.data ?? [], meta: body?.meta ?? null };
    }),

  show: (id: number) =>
    call('PO detail', () => api.get(`/p2p/orders/${id}`), dataOf<PoDetail>),

  /** Stage 01 — creates the draft. */
  create: (body: PoStage1Body) =>
    call('PO create (Stage 01)', () => api.post('/p2p/orders', body), dataOf<PoDetail>),

  updateStage1: (id: number, body: PoStage1Body) =>
    call('PO update (Stage 01)', () => api.put(`/p2p/orders/${id}/stage-1`, body), dataOf<PoDetail>),

  /** Stage 02 — product lines and charges. */
  saveItems: (id: number, body: PoItemsBody) =>
    call('PO product lines (Stage 02)', () => api.put(`/p2p/orders/${id}/items`, body), dataOf<PoDetail>),

  /** Stage 03 — terms; submit = 'yes' submits the PO. */
  saveTerms: (id: number, body: { terms?: string | null; submit?: YesNo }) =>
    call(body.submit === 'yes' ? 'PO submit (Stage 03)' : 'PO terms (Stage 03)', () => api.put(`/p2p/orders/${id}/terms`, body), dataOf<PoDetail>),

  qtyHistory: (id: number) =>
    call('PO qty history', () => api.get(`/p2p/orders/${id}/qty-history`), dataOf<PoQtyHistoryRow[]>),

  cancel: (id: number, reason: string) =>
    call('PO cancel', () => api.post(`/p2p/orders/${id}/cancel`, { reason }), dataOf<PoDetail>),

  /** Drafts only. */
  remove: (id: number) =>
    call('PO delete', () => api.delete(`/p2p/orders/${id}`), dataOf<{ id: number; deleted: boolean }>),

  /** PI lines of a shipment with ordered / pending qty; excludePo = the PO being edited. */
  piLines: (shipmentId: number, excludePo?: number) =>
    call('PO PI lines', () => api.get(`/p2p/orders/shipments/${shipmentId}/pi-lines`, { params: excludePo ? { exclude_po: excludePo } : {} }),
      dataOf<{ proforma_invoice_id: number | null; lines: PiLine[] }>),
};

/* ══════════════════════════ Documents (Stage 04) ══════════════════════════ */

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const poDocumentApi = {
  /** Mark documents Necessary / Not necessary on this PO — one call for the set. */
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

  /** The file as a Blob, for saving. */
  download: (poId: number, docId: number) =>
    call('PO document download', () => api.get(`/p2p/orders/${poId}/documents/${docId}/download`, { responseType: 'blob' }), (b) => b as Blob),

  /** Re-render the Purchase Order PDF (pending documents only). */
  generate: (poId: number, docId: number) =>
    call('PO document generate', () => api.post(`/p2p/orders/${poId}/documents/${docId}/generate`), dataOf<PoDocument>),

  /** Send documents to the supplier for e-signature (Zoho Sign). */
  sign: (poId: number, documentIds: number[], opts: { signer_name?: string; signer_email?: string; notes?: string; expiry_days?: number } = {}) =>
    call('PO documents e-sign', () => api.post(`/p2p/orders/${poId}/documents/sign`, { document_ids: documentIds, ...opts }),
      dataOf<{ signature_request_id: number; signer: { name: string; email: string }; documents: PoDocument[] }>),

  /** Email documents to the supplier (or `to`). */
  email: (poId: number, documentIds: number[], to?: string) =>
    call('PO documents email', () => api.post(`/p2p/orders/${poId}/documents/email`, { document_ids: documentIds, to }), dataOf<{ to: string; count: number }>),

  remove: (poId: number, docId: number) =>
    call('PO document delete', () => api.delete(`/p2p/orders/${poId}/documents/${docId}`), dataOf<{ id: number; deleted: boolean }>),
};

/* ══════════════════════════ Signatures (shared CLM endpoints) ══════════════════════════ */

export const poSignatureApi = {
  /** The signed copy of one document of a request. */
  signedFile: (sigId: number, index: number) =>
    call('PO signed document', () => api.get(`/clm/signature-requests/${sigId}/download-file/${index}`, { responseType: 'blob' }), (b) => b as Blob),

  /** Zoho Sign's completion certificate. */
  certificate: (sigId: number) =>
    call('PO signing certificate', () => api.get(`/clm/signature-requests/${sigId}/certificate`, { responseType: 'blob' }), (b) => b as Blob),
};

/* ══════════════════════════ Physical inspection ══════════════════════════ */

export const poInspectionApi = {
  show: (poId: number) =>
    call('PO inspection', () => api.get(`/p2p/orders/${poId}/inspection`), dataOf<InspectionSummary>),

  /** Verdict and/or proof for one line — saved immediately; files are added to what is there. */
  markLine: (poId: number, itemId: number, line: { verdict?: InspectionVerdict; remark?: string; files?: File[] }) => {
    const fd = new FormData();
    if (line.verdict) fd.append('verdict', line.verdict);
    if (line.remark) fd.append('remark', line.remark);
    (line.files ?? []).forEach((f) => fd.append('files[]', f));
    return call('PO inspection line', () => api.post(`/p2p/orders/${poId}/inspection/lines/${itemId}`, fd, multipart), dataOf<InspectionSummary>);
  },

  removeFile: (poId: number, itemId: number, index: number) =>
    call('PO inspection file remove', () => api.delete(`/p2p/orders/${poId}/inspection/lines/${itemId}/files/${index}`), dataOf<InspectionSummary>),

  signOff: (poId: number, note?: string, files: File[] = []) => {
    const fd = new FormData();
    if (note) fd.append('note', note);
    files.forEach((f) => fd.append('files[]', f));
    return call('PO inspection sign-off', () => api.post(`/p2p/orders/${poId}/inspection/sign-off`, fd, multipart), dataOf<InspectionSummary>);
  },

  withdraw: (poId: number) =>
    call('PO inspection withdraw', () => api.post(`/p2p/orders/${poId}/inspection/withdraw`), dataOf<InspectionSummary>),
};

/* ══════════════════════════ Lookups the PO form uses ══════════════════════════ */

export const poLookupApi = {
  /** Shipment dropdown (existing endpoint). */
  shipments: () =>
    call('PO shipments', () => api.get('/p2p/purchase-orders/shipments'), dataOf<ShipmentOption[]>),

  /** Supplier dropdown (existing endpoint). */
  suppliers: () =>
    call('PO suppliers', () => api.get('/p2p/purchase-orders/suppliers'), dataOf<SupplierOption[]>),

  /** Supplier detail for Stage 01 (existing endpoint). */
  supplier: (vendorId: number) =>
    call('PO supplier detail', () => api.get(`/p2p/purchase-orders/suppliers/${vendorId}`), dataOf<SupplierDetail>),

  /** Supplier Evidence Vault — also drives the legal status panel. */
  supplierVault: (vendorId: number) =>
    call('PO supplier vault', () => api.get(`/segment-uploads/supplier/${vendorId}/vault`), dataOf<Record<string, unknown>>),

  /** Product master for the PO product picker (lite = id, code, name, HSN, segment, GST). */
  products: (perPage = 200) =>
    call('PO products', () => api.get('/products', { params: { lite: 1, per_page: perPage } }), (b) => listOf<Record<string, unknown>>(b)),

  /** Any master list by slug: currencies, incoterms, countries, port_of_loading, port_of_discharge. */
  master: (slug: string) =>
    call(`PO master ${slug}`, () => api.get(`/master/${slug}`), (b) => listOf<Record<string, unknown>>(b)),
};

/* ══════════════════════════ Senior GST approval ══════════════════════════ */

/** A user who can be asked to approve; department / designation come from their employee record. */
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

/** One Inbox row: the request with its PO and supplier. */
export type GstApprovalInboxRow = {
  id: number; purchase_order_id: number; status: GstApprovalStatus;
  request_note: string | null; reason: string | null; requested_at: string | null; decided_at: string | null;
  po_code: string; po_date: string | null; po_status: PoStatus; currency_code: string | null; grand_total: number;
  gst_last_filing_date: string | null; supplier_code: string | null; supplier_name: string | null;
  requested_by_name: string | null; requested_by_designation: string | null; requested_by_department: string | null;
};
export type GstApprovalInboxMeta = { total: number; per_page: number; current_page: number; last_page: number };

/** Everything the senior's review page shows. */
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
  supplier: { code: string | null; name: string | null; gstin: string | null; state_code: string | null; risk: string | null; category: string | null } | null;
  gst: { gate: GstGate; scrutiny_date: string | null; filing_date: string | null; gstin: string | null; stale_months: number } | null;
  lines: { line_no: number; product_code: string | null; product_name: string | null; hsn_code: string | null; uom: string | null;
    quantity: number; rate: number; gst_pct: number; taxable_amount: number; gst_amount: number; line_total: number }[];
  tax_label: string;
  history: GstApprovalRequest[];
};

export const poApprovalApi = {
  /** Users the request can be sent to. */
  approvers: () =>
    call('GST approvers', () => api.get('/p2p/orders/gst-approvals/approvers'), dataOf<GstApprover[]>),

  /** Raised from Step 03 when the supplier's GST return is overdue.
   *  On a re-send after a rejection the server keeps the same approver, so
   *  `requested_to` is left out then. */
  request: (poId: number, body: { requested_to?: number; note?: string }) =>
    call('GST approval request', () => api.post(`/p2p/orders/${poId}/gst-approval/request`, body), dataOf<GstApprovalRequest>),

  /* ── Approver side (the Inbox) ── */

  /** Requests sent to the signed-in user — pending, or already decided when `history`. Server-paged. */
  inbox: (params: { history: boolean; page?: number; per_page?: number }) =>
    call('PO approvals', () => api.get('/p2p/orders/gst-approvals', {
      params: { history: params.history ? 1 : 0, page: params.page ?? 1, per_page: params.per_page ?? 10 },
    }), (b) => {
      const body = b as { data?: GstApprovalInboxRow[]; meta?: GstApprovalInboxMeta } | null;
      return { rows: body?.data ?? [], meta: body?.meta ?? null };
    }),

  /** Everything the review page shows for one request. */
  show: (id: number) =>
    call('PO approval', () => api.get(`/p2p/orders/gst-approvals/${id}`), dataOf<GstApprovalReview>),

  /** Approve or reject — only the senior it was sent to; a reason is required either way. */
  decide: (id: number, body: { decision: 'approved' | 'rejected'; reason: string }) =>
    call('PO approval decision', () => api.put(`/p2p/orders/gst-approvals/${id}`, body), dataOf<GstApprovalRequest>),
};
