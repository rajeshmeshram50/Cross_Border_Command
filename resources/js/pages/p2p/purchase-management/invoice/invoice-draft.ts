import { useCallback, useState } from 'react';
import type { PoDetail, SupplierDetail } from '../order/api/po-api';
import { DOC_TYPE_OPTIONS, PO_TYPE_OPTIONS } from '../order/create-po/po-draft';
import { categoryLabel, riskLabel, type LegalView } from '../order/create-po/supplier-checks';

export interface InvoiceDraft {
  poType: string;
  docType: string;
  transport: string;
  poDate: string;
  deliveryDate: string;
  deliveryLocation: string;
  paymentType: string;
  physInspection: boolean;

  vendorId: number | null;
  supplierDetail: SupplierDetail | null;
  legal: LegalView | null;

  supplier: string;
  supplierCode: string;
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

  invoiceNumber: string;
  invoiceDate: string;
  invoiceFile: string;
  ewayBillFile: string;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

export function draftFromSupplier(sup: SupplierDetail): Partial<InvoiceDraft> {
  return {
    supplierDetail: sup,
    supplier: sup.name,
    supplierCode: sup.code,
    legalName: sup.legalName ?? '',
    supplierType: sup.type ?? '',
    riskLevel: riskLabel(sup.risk),
    category: categoryLabel(sup.category),
    address: sup.addr ?? '',
    country: sup.country ?? '',
    state: sup.state ?? '',
    stateCode: sup.stateCode ?? '',
    city: sup.city ?? '',
    contactName: sup.contact ?? '',
    designation: sup.desig ?? '',
    contactNumber: sup.phone ?? '',
    email: sup.email ?? '',
    scrutinyDate: day(sup.scrutiny),
    gstNumber: sup.gstNo ?? '',
    gstStatus: sup.gstStatus ?? '',
    filingDate: day(sup.filing),
    remarks: sup.remarks ?? '',
  };
}

export function draftFromPo(po: PoDetail, sup: SupplierDetail | null): Partial<InvoiceDraft> {
  return {
    poType: PO_TYPE_OPTIONS.find(o => o.key === po.po_type)?.label ?? po.po_type ?? '',
    docType: DOC_TYPE_OPTIONS.find(o => o.key === po.document_type)?.label ?? po.document_type ?? '',
    transport: po.mode_of_transport ?? '',
    poDate: day(po.po_date),
    deliveryDate: day(po.expected_delivery_date),
    deliveryLocation: po.delivery_location ?? '',
    paymentType: po.payment_type ?? '',
    physInspection: po.physical_inspection === 'yes',

    vendorId: po.vendor_id,
    poNumber: po.code,
    piNumber: po.pi_code ?? '',

    supplierDetail: null,
    supplier: po.supplier?.supplier_name ?? '',
    supplierCode: po.supplier?.supplier_code ?? '',
    stateCode: po.supplier?.supplier_state_code ?? '',
    gstNumber: po.supplier?.supplier_gstin ?? '',
    ...(sup ? draftFromSupplier(sup) : {}),
    ...(!sup?.stateCode && po.supplier?.supplier_state_code ? { stateCode: po.supplier.supplier_state_code } : {}),
    ...(!sup?.gstNo && po.supplier?.supplier_gstin ? { gstNumber: po.supplier.supplier_gstin } : {}),

    scrutinyDate: day(po.gst_scrutiny_date ?? sup?.scrutiny),
    filingDate: day(po.gst_last_filing_date ?? sup?.filing),
  };
}

export function useInvoiceDraft(seed: { supplier: string; poNo?: string }) {
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    poType: '',
    docType: '',
    transport: '',
    poDate: '',
    deliveryDate: '',
    deliveryLocation: '',
    paymentType: '',
    physInspection: false,

    vendorId: null,
    supplierDetail: null,
    legal: null,

    supplier: seed.supplier,
    supplierCode: '',
    poNumber: seed.poNo ?? '',
    piNumber: '',
    legalName: '',
    supplierType: '',
    riskLevel: '',
    category: '',

    address: '',
    country: '',
    state: '',
    stateCode: '',
    city: '',
    contactName: '',
    designation: '',
    contactNumber: '',
    email: '',

    scrutinyDate: '',
    gstNumber: '',
    gstStatus: '',
    filingDate: '',
    remarks: '',

    invoiceNumber: '',
    invoiceDate: today(),
    invoiceFile: '',
    ewayBillFile: '',
  }));

  const set = useCallback((patch: Partial<InvoiceDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
  }, []);

  return { draft, set };
}

export type SetDraft = (patch: Partial<InvoiceDraft>) => void;
