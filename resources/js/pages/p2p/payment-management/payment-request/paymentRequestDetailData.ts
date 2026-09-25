/* Everything behind one payment request's view, assembled from the live APIs:
   the request and its PO ledger (GET /p2p/orders/payment-requests/{id}) plus the
   existing supplier, PO list, document and inspection endpoints — no duplicate APIs. */
import { categoryLabel } from '../../purchase-management/order/create-po/supplier-checks';
import type { OrderRow } from '../../purchase-management/order/po-list/Order';
import { toOrderRow } from '../../purchase-management/order/po-list/Order';
import type { Supplier } from './payment-request-suppliers';
import type { InspectionProduct } from '../../purchase-management/order/physical-inspection/inspection-shared';
import {
  PoApiError, poApi, poDocumentApi, poInspectionApi, poLookupApi, poPaymentApi,
  type PoPayRequest, type SupplierDetail,
} from '../../purchase-management/order/api/po-api';
import { toRequestRow, type PaymentRequestRow } from './paymentRequestData';

export type PaymentRelease = {
  requestId: string;
  requestDate: string;
  /** The PO or SPI the request was raised against. */
  doc: string;
  docDate: string;
  amount: number;
  bank: string;
  mode: string;
  /** UTR for a transfer, instrument number for a cheque. */
  ref: string;
  date: string;
  /** The proof filed with the release; absent when none was attached. */
  proofName: string;
  proofUrl: string | null;
};

export type LinkedRequest = PaymentRequestRow & { paid: number };

export type TradeDoc = {
  /** The PO document row, so the vault can fetch the file itself. */
  id: number;
  code: string;
  name: string;
  generated: string;
  valid: string;
  status: 'signed' | 'sent' | 'pending';
  attachment: string;
  /** No file on record yet — View and Download have nothing to open. */
  hasFile: boolean;
  signatureRequestId: number | null;
  signatureIndex: number | null;
};

export type PaymentRequestDetail = {
  row: PaymentRequestRow;
  supplier: Supplier;
  /** The document the request was raised against — the SPI when there is one. */
  doc: { id: string; date: string; kind: 'po' | 'spi' };
  /** The document's position today, across every request raised on it. */
  ledger: {
    total: number; net: number; paid: number; balance: number;
    approvedTotal: number; available: number; prevRequested: number;
  };
  /** Every request on the same document, the open one first. */
  linked: LinkedRequest[];
  payments: PaymentRelease[];
  /** The order behind the request; null for an SPI raised without a PO. */
  po: OrderRow | null;
  inspection: { required: boolean; completed: boolean; products: InspectionProduct[] };
  /** Other orders with this supplier, most recent first. */
  history: OrderRow[];
  tradeDocs: TradeDoc[];
};

/** The document a request was raised against: the SPI when it has one. */
export function docOf(r: PaymentRequestRow): { id: string; date: string; kind: 'po' | 'spi' } {
  if (r.spi) return { id: r.spi.id, date: r.spi.date, kind: 'spi' };
  return { id: r.po?.id ?? '—', date: r.po?.date ?? '', kind: 'po' };
}

// Vault groups counted by the Legal Status panel, in LEGAL_PARAMS order; agreements have no vault group yet.
const VAULT_KEYS = ['company_dd', 'owner_kyc', 'trade_licenses', 'trade_documents', 'agreements'];
const DONE = ['verified', 'signed', 'approved'];

function toSupplier(d: SupplierDetail | null, row: PaymentRequestRow, vault: Record<string, unknown> | null): Supplier {
  const risk = (d?.risk ?? '').toLowerCase();
  const rows = (key: string) => (Array.isArray(vault?.[key]) ? (vault![key] as { status?: unknown }[]) : []);
  // What the vault lists for this supplier IS the requirement - the DCP rules decide it.
  const required = (key: string) => rows(key).length;
  const done = (key: string) => rows(key)
    .filter((x) => DONE.includes(String(x.status ?? '').toLowerCase())).length;
  return {
    key: d?.name ?? row.supplier, code: d?.code ?? row.supplierCode ?? '—', legalName: d?.legalName ?? d?.name ?? row.supplier,
    type: d?.type ?? '—',
    risk: risk.includes('high') ? 'High Risk' : risk.includes('medium') ? 'Medium Risk' : 'Low Risk',
    category: categoryLabel(d?.category) || '—', segment: d?.segments?.join(', ') || '—',
    addr: d?.addr ?? '—', country: d?.country ?? '—', state: d?.state ?? '—', stateCode: d?.stateCode ?? '—', city: d?.city ?? '—',
    contact: d?.contact ?? '—', desig: d?.desig ?? '—', phone: d?.phone ?? '—', email: d?.email ?? '—',
    scrutiny: d?.scrutiny ?? '', gstNo: d?.gstNo ?? '—', gstStatus: d?.gstStatus ?? '—', filing: d?.filing ?? '', remarks: d?.remarks ?? '',
    legalDone: VAULT_KEYS.map(done),
    legalTotal: VAULT_KEYS.map(required),
  };
}

/** A request of the same PO, shown in the linked list with the current row's PO context. */
function linkedRow(q: PoPayRequest, row: PaymentRequestRow): LinkedRequest {
  const status = q.status === 'pending' ? 'awaiting' : q.status === 'approved' ? 'approved' : 'declined';
  const to = { code: (q.requested_to.name ?? '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase(), name: q.requested_to.name ?? '—', role: q.requested_to.role ?? undefined };
  const by = { code: (q.requested_by.name ?? '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase(), name: q.requested_by.name ?? '—', role: q.requested_by.role ?? undefined };
  return {
    ...row,
    id: q.id, requestId: q.code, requestDate: q.requested_at ?? '', status,
    requestedAmount: q.requested_amount, approvedAmount: q.status === 'approved' ? q.approved_amount : null,
    approvedNote: status === 'awaiting' ? null : status === 'declined' ? 'declined'
      : (q.due ?? 0) > 0 ? `₹${(q.due ?? 0).toLocaleString('en-IN')} due` : 'released in full',
    paymentType: q.payment_type, requestedBy: by, requestedTo: to,
    percentOfTotal: q.percentage ?? 0,
    decline: status === 'declined' ? { on: q.decided_at ?? '', by: to, reason: q.decision_note ?? '' } : null,
    canDecide: row.canDecide && q.id === row.id,
    paid: q.paid_amount,
  };
}

/** GET /p2p/orders/payment-requests/{id} plus the supplier, its POs, documents and inspection. */
export async function fetchPaymentRequestDetail(requestId: number): Promise<PaymentRequestDetail | null> {
  let d;
  try {
    d = await poPaymentApi.detail(requestId);
  } catch (e) {
    if (e instanceof PoApiError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
  const row = toRequestRow(d.request);
  const vendorId = d.request.vendor_id;
  const needsInspection = d.request.physical_inspection === 'yes';

  // The side panels are extras: one failing leaves its panel empty, not the whole view.
  const [sup, vault, orders, docs, insp] = await Promise.allSettled([
    vendorId ? poLookupApi.supplier(vendorId) : Promise.resolve(null),
    vendorId ? poLookupApi.supplierVault(vendorId) : Promise.resolve(null),
    vendorId ? poApi.list({ vendor_id: vendorId, per_page: 20 }) : Promise.resolve(null),
    poDocumentApi.list(row.poId),
    needsInspection ? poInspectionApi.show(row.poId) : Promise.resolve(null),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

  const poRows = ok(orders)?.rows ?? [];
  const po = poRows.find((o) => o.id === row.poId);
  /* Every order actually raised on this supplier is a past transaction — a
     cancelled one counts, and often carries the money. Only drafts stay out. */
  const history = poRows
    .filter((o) => o.id !== row.poId && o.status !== 'draft')
    .map(toOrderRow)
    .sort((a, b) => b.poDate.localeCompare(a.poDate));

  const doc = docOf(row);
  const current = d.po.requests.find((q) => q.id === row.id);
  const others = d.po.requests.filter((q) => q.id !== row.id);
  const linked = [...(current ? [current] : []), ...others].map((q) => linkedRow(q, row));
  const codeOf = new Map(d.po.requests.map((q) => [q.id, q] as const));

  const inspection = ok(insp);
  const products: InspectionProduct[] = (inspection?.lines ?? []).map((l) => ({
    code: l.product_code ?? '—', name: l.product_name ?? '—', hsn: l.hsn_code ?? '—', qty: l.quantity,
    gst: l.gst_pct, price: 0, uom: l.uom ?? '', uomShort: l.uom ?? '', segment: '—', condition: '—',
    packaging: '—', brand: '—', desc: l.description ?? '',
  }));

  return {
    row,
    supplier: toSupplier(ok(sup), row, ok(vault)),
    doc,
    ledger: {
      total: d.po.po.grand_total, net: d.po.po.net_payable, paid: d.po.po.paid, balance: d.po.po.balance,
      approvedTotal: d.po.requests_summary.approved_amount,
      available: d.po.requests_summary.open_to_request,
      prevRequested: Math.max(0, d.po.requests_summary.requested_amount - row.requestedAmount),
    },
    linked,
    payments: d.payments.map((p) => {
      const q = codeOf.get(p.payment_request_id);
      return {
        requestId: q?.code ?? '—', requestDate: q?.requested_at ?? '', doc: doc.id, docDate: doc.date,
        amount: p.amount, bank: p.bank_name ?? '—', mode: '—', ref: p.utr_cheque_number ?? '—', date: p.utr_cheque_date ?? '',
        proofName: p.proof_name ?? '', proofUrl: p.proof_url ?? null,
      };
    }),
    po: po ? toOrderRow(po) : null,
    inspection: {
      required: needsInspection,
      completed: d.request.inspection_status === 'completed',
      products,
    },
    history,
    tradeDocs: (ok(docs) ?? []).map((x) => ({
      id: x.id, code: x.code, name: x.name, generated: x.generated_on ?? '', valid: x.valid_up_to ?? '',
      status: x.status, attachment: x.original_name ?? '',
      hasFile: !!x.file_path,
      signatureRequestId: x.signature_request_id ?? null,
      signatureIndex: x.signature_index ?? null,
    })),
  };
}
