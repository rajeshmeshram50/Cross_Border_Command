import { useCallback, useState } from 'react';

/**
 * Everything the four steps collect, in one object.
 *
 * It lives in InvoiceForm rather than inside each step, because Step 02 opens
 * with a read-only recap of Step 01 — a step cannot summarise state it does
 * not hold. The Create PO form holds its draft the same way, for the same
 * reason.
 */
export interface InvoiceDraft {
  /* ── Step 01: the purchase order ─────────────────────────────────────── */
  poType: string;
  docType: string;
  transport: string;
  poDate: string;
  deliveryDate: string;
  deliveryLocation: string;
  paymentType: string;
  /** Decided on the order, reported here. */
  physInspection: boolean;

  /* ── Step 01: the supplier ───────────────────────────────────────────── */
  supplier: string;
  supplierCode: string;
  /** The order and proforma this invoice is matched against, shown on the
   *  product section's head. */
  poNumber: string;
  piNumber: string;
  legalName: string;
  supplierType: string;
  riskLevel: string;
  category: string;

  address: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  contactName: string;
  designation: string;
  contactNumber: string;
  email: string;

  scrutinyDate: string;
  gstNumber: string;
  gstStatus: string;
  filingDate: string;
  remarks: string;

  /* ── Step 02: the invoice itself ─────────────────────────────────────── */
  invoiceNumber: string;
  invoiceDate: string;
  /** File names only — the upload endpoint does not exist yet. */
  invoiceFile: string;
  ewayBillFile: string;
}

/** A date that many months in the past, for the prefilled compliance dates. */
const monthsBack = (months: number) => {
  const d = new Date();
  d.setDate(d.getDate() - Math.round(months * 30.44));
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

/** `iso` plus n days, as an ISO date. Used for the PO's delivery window. */
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The draft, plus a setter that merges a patch.
 *
 * `set` is wrapped in useCallback and never depends on the draft, so it keeps
 * one identity for the life of the form. A setter that changed on every
 * keystroke would be a new prop for every step and every memoised child below.
 */
export function useInvoiceDraft(seed: {
  supplier: string; invoiceNo: string; poNo?: string;
  /** Where the goods are being staged — the PO's delivery location. */
  warehouse?: string;
}) {
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    poType: 'Material / Goods',
    docType: 'Domestics',
    transport: 'Road',
    poDate: today(),
    /* An invoice raised against a PO inherits the order's own terms — it does
       not restate them. Blank here meant the two fields opened on placeholders
       as if waiting for input, on a block that is a read-back of the order.
       Without a PO there is nothing to inherit and they stay empty. */
    deliveryDate: seed.poNo ? addDays(today(), 14) : '',
    deliveryLocation: seed.poNo ? (seed.warehouse ?? '') : '',
    paymentType: 'Advance',
    physInspection: false,

    supplier: seed.supplier,
    supplierCode: 'S-001',
    poNumber: seed.poNo ?? '',
    /* Derived from the order: a PO raised from PI/2025-26/001 carries it. */
    piNumber: seed.poNo ? seed.poNo.replace(/^PO/, 'PI') : '',
    legalName: '',
    supplierType: 'Manufacturer',
    riskLevel: 'High Risk',
    category: 'Star Supplier',

    address: '',
    country: 'India',
    state: 'Maharashtra',
    /* The GST state code for Maharashtra. It belongs with the state it
       describes, so the two are seeded together rather than leaving the
       product table's STATE CODE pill showing a dash. */
    stateCode: '27',
    city: '',
    contactName: '',
    designation: '',
    contactNumber: '',
    email: '',

    /* Both inside the 3-month window, so the GST card opens on its cleared
       verdict rather than on a failure the user did nothing to cause. */
    scrutinyDate: monthsBack(1.8),
    gstNumber: '27AAACR5055K1Z5',
    gstStatus: 'Active',
    filingDate: monthsBack(1.6),
    remarks: '',

    invoiceNumber: seed.invoiceNo,
    invoiceDate: today(),
    invoiceFile: '',
    ewayBillFile: '',
  }));

  const set = useCallback((patch: Partial<InvoiceDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
  }, []);

  return { draft, set };
}

/** How a step's setter is passed down. */
export type SetDraft = (patch: Partial<InvoiceDraft>) => void;
