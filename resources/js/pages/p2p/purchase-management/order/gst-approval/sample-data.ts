// SAMPLE DATA — the Inbox section and review page render this until they are
// wired to the approval API (GET/PUT /p2p/orders/gst-approvals…); the types are in po-api.ts.
import type { GstApprovalInboxRow, GstApprovalReview } from '../api/po-api';

export const SAMPLE_INBOX: GstApprovalInboxRow[] = [
  {
    id: 1, purchase_order_id: 101, status: 'pending',
    request_note: 'Supplier confirmed GSTR-3B for last quarter is being filed this week.', reason: null,
    requested_at: '2026-09-21T10:15:00+05:30', decided_at: null,
    po_code: 'PO/2026-27/003', po_date: '2026-09-21', po_status: 'draft', currency_code: 'INR', grand_total: 485600,
    gst_last_filing_date: '2026-05-10', supplier_code: 'S-003', supplier_name: 'Shree Agro Traders',
    requested_by_name: 'Vikram Malhotra', requested_by_designation: 'Executive', requested_by_department: 'Purchase',
  },
  {
    id: 2, purchase_order_id: 102, status: 'pending',
    request_note: 'Urgent shipment — customer PI already confirmed.', reason: null,
    requested_at: '2026-09-20T16:40:00+05:30', decided_at: null,
    po_code: 'PO/2026-27/002', po_date: '2026-09-20', po_status: 'draft', currency_code: 'INR', grand_total: 128350,
    gst_last_filing_date: '2026-04-28', supplier_code: 'S-007', supplier_name: 'Kaveri Rice Mills',
    requested_by_name: 'Amit Jain', requested_by_designation: 'Team Leader', requested_by_department: 'Warehouse',
  },
];

export const SAMPLE_HISTORY: GstApprovalInboxRow[] = [
  {
    id: 3, purchase_order_id: 99, status: 'approved',
    request_note: 'Long-standing supplier.', reason: 'One-time approval — filing proof to follow this week.',
    requested_at: '2026-09-15T11:00:00+05:30', decided_at: '2026-09-15T15:20:00+05:30',
    po_code: 'PO/2026-27/001', po_date: '2026-09-15', po_status: 'submitted', currency_code: 'INR', grand_total: 76200,
    gst_last_filing_date: '2026-05-02', supplier_code: 'S-002', supplier_name: 'Deccan Spices Co.',
    requested_by_name: 'Vikram Malhotra', requested_by_designation: 'Executive', requested_by_department: 'Purchase',
  },
  {
    id: 4, purchase_order_id: 98, status: 'rejected',
    request_note: null, reason: 'Ask the supplier to file the pending return first.',
    requested_at: '2026-09-12T09:30:00+05:30', decided_at: '2026-09-12T12:05:00+05:30',
    po_code: 'PO/2025-26/118', po_date: '2026-09-12', po_status: 'draft', currency_code: 'USD', grand_total: 18400,
    gst_last_filing_date: '2026-03-30', supplier_code: 'S-011', supplier_name: 'Global Ethanol LLP',
    requested_by_name: 'Arjun Kumar', requested_by_designation: 'Executive', requested_by_department: 'Export-Import',
  },
];

/** The review page for any sample row id. */
export function sampleReview(id: number): GstApprovalReview | null {
  const row = [...SAMPLE_INBOX, ...SAMPLE_HISTORY].find((r) => r.id === id);
  if (!row) return null;
  const lines = [
    { line_no: 1, product_code: 'P-84', product_name: 'Basmati Rice 1121 Sella', hsn_code: '10063020', uom: 'MT', quantity: 20, rate: 18000, gst_pct: 5 },
    { line_no: 2, product_code: 'P-83', product_name: 'Jute Bags 50 kg', hsn_code: '63051040', uom: 'PCS', quantity: 400, rate: 42, gst_pct: 12 },
  ].map((l) => {
    const taxable = l.quantity * l.rate;
    const gst = Math.round(taxable * l.gst_pct) / 100;
    return { ...l, taxable_amount: taxable, gst_amount: gst, line_total: taxable + gst };
  });
  const taxable = lines.reduce((s, l) => s + l.taxable_amount, 0);
  const gst = lines.reduce((s, l) => s + l.gst_amount, 0);
  const request = {
    id: row.id, purchase_order_id: row.purchase_order_id, status: row.status,
    requested_by: 7, requested_by_name: row.requested_by_name, requested_to: 5, requested_to_name: 'Aarav Sharma',
    request_note: row.request_note, requested_at: row.requested_at, reason: row.reason, decided_at: row.decided_at,
  };
  return {
    request,
    can_decide: row.status === 'pending',
    po: {
      id: row.purchase_order_id, code: row.po_code, po_date: row.po_date, status: row.po_status,
      po_type: 'material_goods', document_type: 'domestic', link_type: 'with_shipment',
      currency_code: row.currency_code, exchange_rate: 1,
      mode_of_transport: 'Road', expected_delivery_date: '2026-10-05', delivery_location: 'Pune Warehouse', payment_type: 'Advance',
      inco_term: null, port_of_loading: null, port_of_discharge: null,
      tax_mode: 'intra', physical_inspection: 'yes',
      taxable_total: taxable, total_cgst: gst / 2, total_sgst: gst / 2, total_igst: 0,
      shipping_charges: 2500, packaging_charges: 0, other_charges: 0, grand_total: taxable + gst + 2500,
      created_by_name: row.requested_by_name,
      shipment_code: 'SHP-2026-014', pi_code: 'PI/26-27/0031', customer_name: 'Al Noor Foodstuff LLC', opportunity_code: 'OPP-0192',
    },
    supplier: { code: row.supplier_code, name: row.supplier_name, gstin: '27AAACS1234F1Z5', state_code: '27', risk: 'Medium', category: 'Regular Supplier' },
    gst: { gate: 'approval_required', scrutiny_date: '2026-09-12', filing_date: row.gst_last_filing_date, gstin: '27AAACS1234F1Z5', stale_months: 3 },
    lines,
    tax_label: 'CGST + SGST',
    history: [request],
  };
}
