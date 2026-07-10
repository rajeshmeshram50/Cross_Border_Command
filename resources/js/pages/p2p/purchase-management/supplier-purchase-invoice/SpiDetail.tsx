import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import SupplierEvidenceVaultModal from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';
import api from '../../../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * SPI Detail wizard — Step 1 "PO Link Supplier Details" + Step 2 "Invoice &
 * Product Details (3-Way Match)". Opens after Confirm in the Map-SPI modal.
 *
 * With-PO: fetches the linked PO (supplier + items) to pre-fill both steps and
 * seed the 3-way match rows. Save POSTs a real SupplierPurchaseInvoice. No
 * hard-coded data — every value comes from the API.
 * ───────────────────────────────────────────────────────────────────────── */

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Linked-PO detail fetched to pre-fill Step 1 (supplier + PO context). */
type SpiSupplier = {
  code: string | null; name: string | null; type: string | null; addr: string | null;
  country: string | null; state: string | null; stateCode: string | null; city: string | null;
  contact: string | null; desig: string | null; phone: string | null; email: string | null;
  scrutiny: string | null; gstNo: string | null; gstStatus: string | null; filing: string | null; remarks: string | null;
};
type SpiPoItem = {
  product_id: number | null; code: string | null;
  pi_name: string | null; pi_qty: number | null;
  po_name: string | null; po_qty: number; invoiced_qty: number; remaining_qty: number;
  rate_po: number; hsn: string | null; gst: number;
};
type SpiPoDetail = {
  id: number; code: string; po_type: string | null; document_type: string | null;
  mode_of_transport: string | null; po_date: string | null; expected_delivery_date: string | null;
  delivery_location: string | null; payment_type: string | null; physical_inspection: boolean;
  currency?: string | null; exchange_rate?: number | null; inco_term?: string | null;
  port_of_loading?: string | null; port_of_discharge?: string | null; final_destination?: string | null; country_of_origin?: string | null;
  supplier_name: string | null; pi_number: string | null; next_spi_code: string | null;
  vendor_id?: number | null;
  supplier: SpiSupplier | null; items: SpiPoItem[];
};

/* An editable 3-way-match row: PI/PO columns are read-only snapshots from the
   PO; the spi* fields are what the user enters for this invoice. */
type SpiRow = {
  productId: number | null; code: string;
  piName: string; piQty: number | null;
  poName: string; poQty: number; invoiced: number; ratePo: number; gst: number;
  spiName: string; spiQty: string; hsn: string; spiRate: string;
};

const dash = (v: string | null | undefined) => (v && v !== '' ? v : '—');

/* Normalise a product code so the trailing number is always 3 digits
   (P-06 → P-006, P-1 → P-001) — matches the Product Management display. */
function formatProductCode(raw: string): string {
  const m = raw.match(/^(.*?)(\d+)\s*$/);
  if (!m) return raw;
  return `${m[1] || 'P-'}${m[2].padStart(3, '0')}`;
}

// GST scrutiny is "old" when the last scrutiny date is older than this many months (mirrors the PO wizard).
const SCRUTINY_STALE_MONTHS = 3;
const isScrutinyOld = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - SCRUTINY_STALE_MONTHS);
  return d < cutoff;
};

/* Basic-detail option lists — mirror the PO wizard (hardcoded constants, not masters). */
const PO_TYPES = ['Material / Goods', 'Services', 'FFD / Transporter'];
const DOC_TYPES = ['Domestics', 'International'];
const TRANSPORTS = ['By Road', 'By Sea', 'By Air'];
const PAY_TYPES = ['Advanced Payment', 'Full Payment', 'Letter of Credit'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'JPY', 'CNY', 'SGD', 'INR'];
const INCO = ['FOB', 'CIF', 'EXW', 'C&F'];
const todayDisp = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const todayIso = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local) — min for future-dated pickers

/* Optional per-option meta for EditSelect (warehouse code + own/third badge). */
type DdMeta = { code?: string; badge?: string; tone?: 'own' | 'third' };

/* A product-master option for the standalone (Direct) product picker. */
type ProdOpt = { id: number | null; code: string; name: string; price: number; gst: number; hsn: string };

/* Supplier Legal Status — the 5-parameter compliance breakdown is derived from
 * the vendor's Evidence Vault (/segment-uploads/supplier/{id}/vault). Mirrors
 * the PO wizard exactly: KYC/DD/licenses/docs from upload buckets (Verified =
 * done), Agreements from signature status (Signed = done). */
type LegalCard = { name: string; t: number; d: number; st: 'full' | 'part' | 'none'; pc: number };
type LegalView = { cards: LegalCard[]; p: number; done: number; tot: number };
const LEGAL_DONE = ['Verified', 'Signed', 'Approved'];
const buildLegalFromVault = (v: Record<string, unknown>): LegalView => {
  const rowsOf = (k: string) => (Array.isArray(v[k]) ? (v[k] as { status?: string }[]) : []);
  const defs: [string, { status?: string }[]][] = [
    ['Company Due Diligence', rowsOf('company_dd')],
    ['Owner KYC Documents', rowsOf('owner_kyc')],
    ['Trade Licenses', rowsOf('trade_licenses')],
    ['Trade Documents', rowsOf('trade_documents')],
    ['Agreements', rowsOf('agreements')],
  ];
  let tot = 0, done = 0;
  const cards: LegalCard[] = defs.map(([name, rows]) => {
    const t = rows.length;
    const d = rows.filter(r => LEGAL_DONE.includes(String(r.status))).length;
    tot += t; done += d;
    const st: LegalCard['st'] = t > 0 && d >= t ? 'full' : (d > 0 ? 'part' : 'none');
    return { name, t, d, st, pc: t ? Math.round(d / t * 100) : 0 };
  });
  return { cards, p: tot ? Math.round(done / tot * 100) : 0, done, tot };
};

export default function SpiDetail({ onClose, onChangeSelection, withPo = true, poId, supplierId, editId, onSaved }: { onClose: () => void; onChangeSelection?: () => void; withPo?: boolean; poId?: number; supplierId?: number; editId?: number; onSaved?: () => void }) {
  useScrollLock();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [physInsp, setPhysInsp] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);
  const [po, setPo] = useState<SpiPoDetail | null>(null);
  // Shimmer while the wizard pulls its data (linked PO / supplier / the SPI being edited).
  const [loading, setLoading] = useState<boolean>(!!editId || (withPo ? !!poId : !!supplierId));
  // Standalone (Without-PO) basic details the user fills in when there's no PO to pull from.
  const [basic, setBasic] = useState({
    poType: PO_TYPES[0], docType: DOC_TYPES[0], transport: TRANSPORTS[0], edd: '', deliveryLoc: '', payType: '',
    // International-only extras (shown when docType === 'International')
    currency: 'USD', exRate: '', inco: 'FOB', portLoad: '', portDischarge: '', finalDest: '', origin: '',
  });
  // Standalone supplier picker: dropdown list + the fetched detail of the chosen supplier.
  const [supList, setSupList] = useState<{ id: number; code: string | null; name: string | null }[]>([]);
  const [stdSup, setStdSup] = useState<SpiSupplier | null>(null);
  const [stdSupName, setStdSupName] = useState('');
  const [stdVendorId, setStdVendorId] = useState<number | null>(null);
  const [stdCode, setStdCode] = useState('');
  const [errs, setErrs] = useState<{ supplier?: boolean; edd?: boolean; deliveryLoc?: boolean; invoiceNo?: boolean; invoiceDate?: boolean; file?: boolean }>({});
  const [warehouses, setWarehouses] = useState<{ id: number; name: string; code: string; type: string }[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [prodOpts, setProdOpts] = useState<ProdOpt[]>([]);
  const [supLegal, setSupLegal] = useState<LegalView | null>(null);
  const [supLegalLoading, setSupLegalLoading] = useState(false);

  // Invoice header the user fills in.
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [existingAttach, setExistingAttach] = useState<string | null>(null); // edit: attachment already on file
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Editable 3-way-match rows (seeded from the PO's items).
  const [rows, setRows] = useState<SpiRow[]>([]);
  const [charges, setCharges] = useState({ ship: '', pack: '', other: '' });
  const [savingDetails, setSavingDetails] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nexting, setNexting] = useState(false); // brief loader on Save & Next
  const [vaultOpen, setVaultOpen] = useState(false); // Supplier Evidence Vault modal

  // Fetch the linked PO's detail to pre-fill Step 1 + seed the product rows.
  useEffect(() => {
    if (!withPo || !poId) return;
    const ctrl = new AbortController();
    let alive = true;
    api.get(`/p2p/supplier-purchase-invoices/purchase-orders/${poId}`, { signal: ctrl.signal })
      .then(r => {
        if (!alive) return;
        const d = r.data?.data as SpiPoDetail;
        setPo(d);
        setPhysInsp(!!d?.physical_inspection);
        // Seed each SPI row from the PO line — SPI qty/rate default to the PO's.
        setRows((d.items ?? []).map(it => ({
          productId: it.product_id, code: formatProductCode(it.code ?? ''),
          piName: it.pi_name ?? '', piQty: it.pi_qty,
          poName: it.po_name ?? '', poQty: it.po_qty, invoiced: it.invoiced_qty ?? 0, ratePo: it.rate_po, gst: it.gst,
          // Default the invoice qty to what's still uninvoiced on the PO.
          spiName: it.po_name ?? '', spiQty: String(it.remaining_qty ?? it.po_qty), hsn: it.hsn ?? '', spiRate: String(it.rate_po),
        })));
      })
      .catch(() => {})
      .finally(() => { if (alive && !editId) setLoading(false); });
    return () => { alive = false; ctrl.abort(); };
  }, [withPo, poId, editId]);

  // Standalone: load the supplier dropdown list + warehouses (delivery location).
  useEffect(() => {
    if (withPo) return;
    let alive = true;
    api.get('/p2p/supplier-purchase-invoices/suppliers').then(r => { if (alive) setSupList(r.data?.data ?? []); }).catch(() => {});
    api.get('/master/warehouse_master').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const w = arr
        .map((x: Record<string, unknown>) => ({ id: Number(x.id), name: String(x.wh_name ?? x.name ?? ''), code: String(x.wh_id ?? x.code ?? ''), type: String(x.wh_type ?? '') }))
        .filter((x: { id: number; name: string }) => x.name && x.id);
      if (alive) setWarehouses(w);
    }).catch(() => {});
    api.get('/master/currencies').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const c = arr.filter((x: { status?: string }) => (x.status ?? 'Active') === 'Active').map((x: Record<string, unknown>) => String(x.code ?? '')).filter(Boolean);
      if (alive && c.length) setCurrencies(c);
    }).catch(() => {});
    api.get('/p2p/supplier-purchase-invoices/preview-code').then(r => { if (alive && !editId) setStdCode(r.data?.data?.code || ''); }).catch(() => {});
    api.get('/products', { params: { status: 'active' } }).then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const opts: ProdOpt[] = arr.map((p: Record<string, unknown>) => {
        const n = (v: unknown) => { const x = parseFloat(String(v)); return isNaN(x) ? 0 : x; };
        const base = n(p.base_price ?? p.price ?? 0);
        const gstAmt = n(p.gst_amount ?? 0);
        // hsn may be the eager-loaded relation object ({ hsn_code }) or a plain value.
        const h = p.hsn;
        const hsn = (h && typeof h === 'object') ? String((h as { hsn_code?: string }).hsn_code ?? '') : String(p.hsn_code ?? h ?? '');
        return {
          id: p.id != null ? Number(p.id) : null,
          name: String(p.name ?? p.product_name ?? p.title ?? ''),
          code: formatProductCode(String(p.product_code ?? p.code ?? p.sku ?? '')),
          price: n(p.total_price ?? p.base_price ?? p.price ?? p.rate ?? 0),
          gst: base > 0 && gstAmt > 0 ? Math.round((gstAmt / base) * 100) : n(p.gst ?? p.gst_rate ?? 0),
          hsn,
        };
      }).filter((o: ProdOpt) => o.name);
      if (alive && opts.length) setProdOpts(opts);
    }).catch(() => {});
    return () => { alive = false; };
  }, [withPo]);

  // Warehouse dropdown meta: code + Own/Third-party badge (mirrors the PO wizard).
  const whMeta: Record<string, DdMeta> = {};
  warehouses.forEach(w => { const third = /third/i.test(w.type || ''); whMeta[w.name] = { code: w.code || undefined, badge: third ? 'Third Party' : 'Own', tone: third ? 'third' : 'own' }; });
  // Product picker meta: show the product code alongside the name.
  const prodMeta: Record<string, DdMeta> = {};
  prodOpts.forEach(p => { prodMeta[p.name] = { code: p.code || undefined }; });

  // Standalone: prefill the supplier chosen back in the Map modal + its legal status.
  useEffect(() => {
    if (withPo || !supplierId) return;
    let alive = true;
    setStdVendorId(supplierId);
    setSupLegal(null);
    setSupLegalLoading(true);
    api.get(`/p2p/supplier-purchase-invoices/suppliers/${supplierId}`).then(r => {
      if (!alive) return;
      const d = (r.data?.data ?? null) as SpiSupplier | null;
      setStdSup(d);
      if (d?.name) setStdSupName(d.name);
    }).catch(() => {}).finally(() => { if (alive && !editId) setLoading(false); });
    api.get(`/segment-uploads/supplier/${supplierId}/vault`)
      .then(r => { if (alive && r.data?.data) setSupLegal(buildLegalFromVault(r.data.data)); })
      .catch(() => { if (alive) setSupLegal(null); })
      .finally(() => { if (alive) setSupLegalLoading(false); });
    return () => { alive = false; };
  }, [withPo, supplierId]);

  // Edit mode: load the saved SPI and prefill every field (both steps).
  useEffect(() => {
    if (!editId) return;
    let alive = true;
    api.get(`/p2p/supplier-purchase-invoices/${editId}`).then(r => {
      if (!alive) return;
      const d = r.data?.data;
      if (!d) return;
      setInvoiceNo(d.invoice_no ?? '');
      setInvoiceDate(d.invoice_date ?? '');
      setExistingAttach(d.attachment_path ?? null);
      setStdCode(d.spiNo ?? '');
      setCharges({ ship: '', pack: '', other: d.additional_charges ? String(d.additional_charges) : '' });
      setPhysInsp(!!d.physical_inspection);
      setStdVendorId(d.vendor_id ?? null);
      const supDetail = (d.supplier_detail ?? null) as SpiSupplier | null;
      if (supDetail) { setStdSup(supDetail); setStdSupName(supDetail.name ?? ''); }
      setBasic(b => ({
        poType: d.po_type ?? b.poType, docType: d.document_type ?? b.docType, transport: d.mode_of_transport ?? b.transport,
        edd: d.expected_delivery_date ?? '', deliveryLoc: d.delivery_location ?? '', payType: d.payment_type ?? '',
        currency: d.currency ?? b.currency, exRate: d.exchange_rate != null ? String(d.exchange_rate) : '',
        inco: d.inco_term ?? b.inco, portLoad: d.port_of_loading ?? '', portDischarge: d.port_of_discharge ?? '',
        finalDest: d.final_destination ?? '', origin: d.country_of_origin ?? '',
      }));
      // With-PO editing keeps the read-only header/basic display driven by `po`.
      if (d.purchase_order_id) {
        setPo({
          id: d.purchase_order_id, code: d.poNo, po_type: d.po_type, document_type: d.document_type,
          mode_of_transport: d.mode_of_transport, po_date: null, expected_delivery_date: d.expected_delivery_date,
          delivery_location: d.delivery_location, payment_type: d.payment_type, physical_inspection: !!d.physical_inspection,
          currency: d.currency, exchange_rate: d.exchange_rate, inco_term: d.inco_term,
          port_of_loading: d.port_of_loading, port_of_discharge: d.port_of_discharge, final_destination: d.final_destination, country_of_origin: d.country_of_origin,
          supplier_name: d.supplier, pi_number: d.piNo, next_spi_code: d.spiNo, supplier: supDetail, items: [],
        });
      }
      setRows((d.items ?? []).map((it: Record<string, unknown>) => ({
        productId: (it.product_id as number) ?? null, code: (it.code as string) ?? '',
        piName: (it.piName as string) ?? '', piQty: (it.piQty as number) ?? null,
        poName: (it.poName as string) ?? '', poQty: (it.poQty as number) ?? 0, invoiced: 0,
        ratePo: (it.ratePo as number) ?? 0, gst: (it.gst as number) ?? 0,
        spiName: (it.name as string) ?? '', spiQty: String((it.qty as number) ?? ''), hsn: (it.hsn as string) ?? '', spiRate: String((it.rate as number) ?? ''),
      })));
      if (d.vendor_id) {
        api.get(`/segment-uploads/supplier/${d.vendor_id}/vault`)
          .then(vr => { if (alive && vr.data?.data) setSupLegal(buildLegalFromVault(vr.data.data)); }).catch(() => {});
      }
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [editId]);

  // In the Without-PO flow the supplier comes from the picker, not a linked PO.
  const sup = po?.supplier ?? stdSup;
  const scrutinyOld = isScrutinyOld(sup?.scrutiny);
  const vendorDbId = po?.vendor_id ?? stdVendorId ?? undefined; // real vendor id → live Evidence-Vault fetch

  // Pull the vendor's real 5-parameter Evidence-Vault breakdown for the legal card.
  const loadSupplierLegal = (vendorId: number) => {
    setSupLegal(null);
    setSupLegalLoading(true);
    api.get(`/segment-uploads/supplier/${vendorId}/vault`)
      .then(r => { const v = r.data?.data; if (v) setSupLegal(buildLegalFromVault(v)); })
      .catch(() => setSupLegal(null))
      .finally(() => setSupLegalLoading(false));
  };

  // Pick a supplier in the standalone flow → fetch its detail + legal status.
  const pickSupplier = async (name: string) => {
    setStdSupName(name);
    const s = supList.find(x => (x.name || '') === name);
    if (!s) { setStdSup(null); setSupLegal(null); setStdVendorId(null); return; }
    setStdVendorId(s.id);
    setErrs(e => ({ ...e, supplier: false }));
    loadSupplierLegal(s.id);
    try {
      const r = await api.get(`/p2p/supplier-purchase-invoices/suppliers/${s.id}`);
      const d = (r.data?.data ?? null) as SpiSupplier | null;
      setStdSup(d);
      if (isScrutinyOld(d?.scrutiny)) toast.warning('GST scrutiny date is old', `It is more than ${SCRUTINY_STALE_MONTHS} months old — do the scrutiny for this supplier.`);
    } catch { setStdSup(null); }
  };

  // Patch a single field of one row (immutably).
  const setRow = (i: number, patch: Partial<SpiRow>) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Standalone (Direct) product rows: add a blank line, remove one, or fill a
  // line from a product-master pick (code / rate / gst / hsn auto-populate).
  const addRow = () => setRows(rs => [...rs, {
    productId: null, code: '', piName: '', piQty: null, poName: '', poQty: 0, invoiced: 0, ratePo: 0, gst: 0,
    spiName: '', spiQty: '', hsn: '', spiRate: '',
  }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));
  const pickProduct = (i: number, name: string) => {
    const p = prodOpts.find(x => x.name === name);
    if (!p) { setRow(i, { spiName: name }); return; }
    setRow(i, { productId: p.id, code: p.code, spiName: p.name, hsn: p.hsn, spiRate: String(p.price || ''), gst: p.gst });
  };

  // Live tax + cost — intra-state (state code 27) → CGST/SGST 9/9, else split
  // the product GST. Mirrors the backend so the preview matches the saved row.
  const intra = (sup?.stateCode ?? '27') === '27';
  const rowCost = (r: SpiRow) => {
    const base = Number(r.spiQty || 0) * Number(r.spiRate || 0);
    const cgstA = (base * (intra ? 9 : r.gst / 2)) / 100;
    const sgstA = (base * (intra ? 9 : r.gst / 2)) / 100;
    return { cgstA, sgstA, cost: base + cgstA + sgstA };
  };
  const addlCharges = Number(charges.ship || 0) + Number(charges.pack || 0) + Number(charges.other || 0);
  const totals = rows.reduce((a, r) => { const c = rowCost(r); a.prod += c.cost; a.cgst += c.cgstA; a.sgst += c.sgstA; return a; }, { prod: 0, cgst: 0, sgst: 0 });
  const grandTotal = totals.prod + addlCharges;

  // Products whose PO quantity is still not fully covered after this invoice.
  const missingRows = rows
    .map(r => ({ code: r.code, name: r.poName || r.spiName, poQty: r.poQty, spiQty: Number(r.spiQty || 0), miss: r.poQty - r.invoiced - Number(r.spiQty || 0) }))
    .filter(m => m.miss > 0);

  // Scroll the first highlighted (empty) field into view after a validation fail.
  const scrollToFirstError = () => {
    setTimeout(() => {
      const el = document.querySelector('.spi-dt .spi-dt-select-edit.is-invalid, .spi-dt .master-datepicker-wrap.invalid, .spi-dt .spi-dt-inp.is-invalid, .spi-dt .spi-dt-file.is-invalid');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  // Step 1 → Step 2: highlight any empty standalone mandatory fields (no toast) and block.
  const goStep2 = () => {
    if (nexting) return;
    if (!withPo) {
      const e = { supplier: !stdVendorId, edd: !basic.edd, deliveryLoc: !basic.deliveryLoc };
      setErrs(e);
      if (e.supplier || e.edd || e.deliveryLoc) { toast.error('Required fields missing', 'Please complete the highlighted fields.'); scrollToFirstError(); return; }
    }
    setNexting(true);
    setTimeout(() => { setNexting(false); setStep(2); }, 400);
  };

  // Save the invoice: POST to the SPI create endpoint.
  const handleSave = async () => {
    if (saving) return;
    // Invoice number, date & attachment are mandatory — highlight (no toast) and block.
    // On edit, an attachment already on file counts (no re-upload required).
    const ie = { invoiceNo: !invoiceNo.trim(), invoiceDate: !invoiceDate, file: !file && !(editId && existingAttach) };
    setErrs(prev => ({ ...prev, ...ie }));
    if (ie.invoiceNo || ie.invoiceDate || ie.file) {
      setInvOpen(true); // expand the invoice section so the errors are visible
      toast.error('Required fields missing', 'Invoice number, date & attachment are mandatory.');
      scrollToFirstError();
      return;
    }
    setSaving(true);
    try {
      // If a new attachment was chosen, upload it; otherwise keep the existing one (edit).
      let attachmentPath: string | null = existingAttach;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await api.post('/p2p/supplier-purchase-invoices/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        attachmentPath = up.data?.data?.path ?? null;
      }
      // Standalone (Without-PO): the basic + supplier details come from the form,
      // not a linked PO. Omitted for With-PO so the backend inherits the PO's.
      const stdFields = withPo ? {} : {
        vendor_id: stdVendorId,
        document_type: basic.docType,
        po_type: basic.poType,
        mode_of_transport: basic.transport,
        payment_type: basic.payType || null,
        delivery_location: basic.deliveryLoc || null,
        expected_delivery_date: basic.edd || null,
        physical_inspection: physInsp,
        supplier_type: sup?.type || null,
        ...(basic.docType === 'International' ? {
          currency: basic.currency || null,
          exchange_rate: basic.exRate === '' ? null : Number(basic.exRate),
          inco_term: basic.inco || null,
          port_of_loading: basic.portLoad || null,
          port_of_discharge: basic.portDischarge || null,
          final_destination: basic.finalDest || null,
          country_of_origin: basic.origin || null,
        } : {}),
      };
      const payload = {
        purchase_order_id: po?.id ?? null,
        ...stdFields,
        invoice_no: invoiceNo || null,
        invoice_date: invoiceDate || null,
        attachment_path: attachmentPath,
        shipping_charges: Number(charges.ship || 0),
        packaging_charges: Number(charges.pack || 0),
        other_charges: Number(charges.other || 0),
        items: rows.map(r => ({
          product_id: r.productId,
          product_code: r.code || null,
          pi_product_name: r.piName || null,
          pi_quantity: r.piQty,
          po_product_name: r.poName || null,
          po_quantity: r.poQty,
          rate_po: r.ratePo,
          product_name: r.spiName || null,
          quantity: r.spiQty === '' ? 0 : Number(r.spiQty),
          hsn_code: r.hsn || null,
          rate: r.spiRate === '' ? 0 : Number(r.spiRate),
          gst_pct: r.gst,
        })),
      };
      if (editId) await api.put(`/p2p/supplier-purchase-invoices/${editId}`, payload);
      else await api.post('/p2p/supplier-purchase-invoices', payload);
      toast.success(editId ? 'Supplier purchase invoice updated' : 'Supplier purchase invoice saved');
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Save failed', msg ?? 'Could not save the invoice. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="spi-dt-overlay">
    <div className="spi-dt">
      {/* Header + stepper live in ONE card (Figma) */}
      <div className="spi-dt-topcard">
      {/* ── Header ── */}
      <div className="spi-dt-head">
        <div className="spi-dt-head-l">
          <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
          <div>
            <div className="spi-dt-head-title">Supplier Purchase Invoice</div>
            <div className="spi-dt-head-sub">{po ? `Draft · linked to ${po.code}` : (stdSupName ? `Draft · Direct — ${stdSupName}` : 'Draft · not yet mapped')}</div>
          </div>
        </div>
        <div className="spi-dt-pills">
          <HeadPill icon={<IcoLines />} label="INVOICE NO" value={dash(po?.next_spi_code ?? (stdCode || null))} mono />
          <span className="spi-dt-dots">⋮</span>
          {withPo && (<>
            <HeadPill icon={<IcoLines />} label="PO NUMBER" value={dash(po?.code)} alt mono />
            <span className="spi-dt-dots">⋮</span>
          </>)}
          <HeadPill icon={<IcoUser />} label="SUPPLIER" value={dash(withPo ? po?.supplier_name : (stdSupName || sup?.name))} />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoLines />} label="GSTIN" value={dash(sup?.gstNo)} alt mono />
        </div>
        <div className="spi-dt-head-r">
          <span className="spi-dt-divider" />
          <button type="button" className="spi-dt-btn-pay"><IcoCard /> SPI Payment</button>
          <span className="spi-dt-divider" />
          <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
        </div>
      </div>

      {/* ── Step tabs ── */}
      <div className="spi-dt-steps">
        <div className={`spi-dt-step ${step === 1 ? 'is-active' : 'is-done'}`}>
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 01</span>
            {step === 1
              ? <span className="spi-dt-step-badge">ACTIVE</span>
              : <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
          </div>
          <div className="spi-dt-step-big">01</div>
          <div className="spi-dt-step-title">PO Link Supplier Details</div>
          <div className="spi-dt-step-desc">Link the PO and confirm supplier details</div>
          <span className="spi-dt-step-ghost">01</span>
        </div>
        <div className={`spi-dt-step ${step === 2 ? 'is-active' : ''}`}>
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 02</span>
            {step === 2 && <span className="spi-dt-step-badge">ACTIVE</span>}
          </div>
          <div className="spi-dt-step-big">02</div>
          <div className="spi-dt-step-title">Invoice &amp; Product Details (3-Way Match)</div>
          <div className="spi-dt-step-desc">Enter invoice details &amp; match products against the PO &amp; GRN</div>
          <span className="spi-dt-step-ghost">02</span>
        </div>
      </div>
      </div>

      {/* ── Body (Step 1) ── */}
      {step === 1 && loading && <SpiFormSkeleton />}
      {step === 1 && !loading && (
      <div className="spi-dt-body">
        {/* Purchase Order section */}
        <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setPoOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoDocSm /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Purchase Order</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Basic Purchase Order Details</span></div>
              <div className="spi-dt-sec-sub">Core details that identify this purchase order.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-grid4">
              {withPo ? (<>
                <Field label="PO TYPE"><Select value={dash(po?.po_type)} /></Field>
                <Field label="DOCUMENT TYPE"><Select value={dash(po?.document_type)} /></Field>
                <Field label="MODE OF TRANSPORT"><Select value={dash(po?.mode_of_transport)} /></Field>
                <Field label="PO DATE"><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={dash(po?.po_date)} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="EXPECTED DELIVERY DATE"><input className="spi-dt-inp" value={dash(po?.expected_delivery_date)} readOnly /></Field>
                <Field label="DELIVERY LOCATION"><input className="spi-dt-inp" value={po?.delivery_location ?? ''} placeholder="Enter delivery location" readOnly /></Field>
                <Field label="PAYMENT TYPE"><Select value={dash(po?.payment_type)} /></Field>
              </>) : (<>
                <Field label="PO TYPE" req><EditSelect value={basic.poType} options={PO_TYPES} onChange={v => { if (v !== PO_TYPES[0]) { toast.info('Coming soon', `${v} PO type is currently in development. Only ${PO_TYPES[0]} is available.`); return; } setBasic(b => ({ ...b, poType: v })); }} /></Field>
                <Field label="DOCUMENT TYPE" req><EditSelect value={basic.docType} options={DOC_TYPES} onChange={v => setBasic(b => ({ ...b, docType: v }))} /></Field>
                <Field label="MODE OF TRANSPORT" req><EditSelect value={basic.transport} options={TRANSPORTS} onChange={v => setBasic(b => ({ ...b, transport: v }))} /></Field>
                <Field label="PO DATE" req><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={todayDisp} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="EXPECTED DELIVERY DATE" req><MasterDatePicker value={basic.edd} onChange={v => { setBasic(b => ({ ...b, edd: v })); setErrs(e => ({ ...e, edd: false })); }} minDate={todayIso} invalid={!!errs.edd} placeholder="Select date" /></Field>
                <Field label="DELIVERY LOCATION" req><EditSelect value={basic.deliveryLoc} options={warehouses.map(w => w.name)} meta={whMeta} invalid={!!errs.deliveryLoc} placeholder="— Select Warehouse —" onChange={v => { setBasic(b => ({ ...b, deliveryLoc: v })); setErrs(e => ({ ...e, deliveryLoc: false })); }} /></Field>
                <Field label="PAYMENT TYPE"><EditSelect value={basic.payType} options={PAY_TYPES} placeholder="— Select —" onChange={v => setBasic(b => ({ ...b, payType: v }))} /></Field>
              </>)}
              <Field label="PHYSICAL INSPECTION REQUIRED">
                <button type="button" className="spi-dt-toggle" onClick={() => setPhysInsp(v => !v)}>
                  <span className={`spi-dt-toggle-sw ${physInsp ? 'on' : ''}`}><span className="spi-dt-toggle-knob" /></span>
                  <span className="spi-dt-toggle-txt">{physInsp ? 'Yes' : 'No'}</span>
                </button>
              </Field>
              {!withPo && basic.docType === 'International' && (<>
                <Field label="CURRENCY"><EditSelect value={basic.currency} options={currencies.length ? currencies : CURRENCIES} onChange={v => setBasic(b => ({ ...b, currency: v }))} /></Field>
                <Field label="EXCHANGE RATE"><input className="spi-dt-inp" value={basic.exRate} onChange={e => setBasic(b => ({ ...b, exRate: e.target.value }))} placeholder="e.g. 83.25" /></Field>
                <Field label="INCO TERM"><EditSelect value={basic.inco} options={INCO} onChange={v => setBasic(b => ({ ...b, inco: v }))} /></Field>
                <Field label="PORT OF LOADING"><input className="spi-dt-inp" value={basic.portLoad} onChange={e => setBasic(b => ({ ...b, portLoad: e.target.value }))} placeholder="e.g. Nhava Sheva" /></Field>
                <Field label="PORT OF DISCHARGE"><input className="spi-dt-inp" value={basic.portDischarge} onChange={e => setBasic(b => ({ ...b, portDischarge: e.target.value }))} placeholder="e.g. Jebel Ali" /></Field>
                <Field label="FINAL DESTINATION"><input className="spi-dt-inp" value={basic.finalDest} onChange={e => setBasic(b => ({ ...b, finalDest: e.target.value }))} placeholder="Enter final destination" /></Field>
                <Field label="COUNTRY OF ORIGIN"><input className="spi-dt-inp" value={basic.origin} onChange={e => setBasic(b => ({ ...b, origin: e.target.value }))} placeholder="e.g. India" /></Field>
              </>)}
              {withPo && po?.document_type === 'International' && (<>
                <Field label="CURRENCY"><input className="spi-dt-inp" value={dash(po?.currency)} readOnly /></Field>
                <Field label="EXCHANGE RATE"><input className="spi-dt-inp" value={po?.exchange_rate != null ? String(po.exchange_rate) : ''} placeholder="—" readOnly /></Field>
                <Field label="INCO TERM"><input className="spi-dt-inp" value={dash(po?.inco_term)} readOnly /></Field>
                <Field label="PORT OF LOADING"><input className="spi-dt-inp" value={po?.port_of_loading ?? ''} placeholder="—" readOnly /></Field>
                <Field label="PORT OF DISCHARGE"><input className="spi-dt-inp" value={po?.port_of_discharge ?? ''} placeholder="—" readOnly /></Field>
                <Field label="FINAL DESTINATION"><input className="spi-dt-inp" value={po?.final_destination ?? ''} placeholder="—" readOnly /></Field>
                <Field label="COUNTRY OF ORIGIN"><input className="spi-dt-inp" value={po?.country_of_origin ?? ''} placeholder="—" readOnly /></Field>
              </>)}
            </div>
          </div>
        </div>

        {/* Supplier section */}
        <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Basic Supplier Details</span></div>
              <div className="spi-dt-sec-sub">Primary information about the supplier this PO is issued to.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
                <span className="spi-dt-fields-badge">4 FIELDS</span>
              </div>
              <div className="spi-dt-grid4">
                <Field label="SELECT SUPPLIER" req={!withPo}>{withPo
                  ? <Select value={po?.supplier_name ?? '— Select Supplier —'} muted={!po?.supplier_name} />
                  : <EditSelect value={stdSupName} options={supList.map(s => s.name || '')} placeholder="— Select Supplier —" invalid={!!errs.supplier} onChange={pickSupplier} />}
                </Field>
                <Field label="SUPPLIER CODE"><input className="spi-dt-inp" value={dash(sup?.code)} readOnly /></Field>
                <Field label="COMPANY NAME"><input className="spi-dt-inp" value={dash(sup?.name)} title={sup?.name ?? ''} readOnly /></Field>
                <Field label="SUPPLIER TYPE"><Select value={dash(sup?.type)} /></Field>
              </div>
            </div>
            <div className="spi-dt-card">
              <div className="spi-dt-card-head" style={{ cursor: 'pointer' }} onClick={() => setLegalOpen(o => !o)}>
                <div className="spi-dt-card-title">
                  <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
                  {supLegal && <span className={`spi-dt-legal-badge ${supLegal.p === 100 ? 'ok' : 'warn'}`}>{supLegal.p === 100 ? '100% Compliant' : `${supLegal.p}% · Needs Review`}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {vendorDbId && sup && (
                    <button type="button" className="spi-dt-vault-btn" onClick={e => { e.stopPropagation(); setVaultOpen(true); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg>
                      <span>Supplier Legal Status</span>
                    </button>
                  )}
                  <span className="spi-dt-minus">{legalOpen ? '–' : '+'}</span>
                </div>
              </div>
              {legalOpen && (
                <div className="spi-dt-legal">
                  <div className="spi-dt-legal-top">
                    <div className="spi-dt-legal-bar"><span className="spi-dt-legal-fill" style={{ width: `${supLegal?.p || 0}%`, background: supLegal ? (supLegal.p === 100 ? 'linear-gradient(90deg,#0e7490,#0891b2 55%,#06b6d4)' : supLegal.p >= 60 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#dc2626,#ef4444)') : undefined }} /></div>
                    <div className="spi-dt-legal-pct">{supLegal?.p || 0}%</div>
                  </div>
                  {supLegal ? (<>
                    <div className="spi-dt-legal-summary"><strong>{supLegal.done}</strong> of <strong>{supLegal.tot}</strong> documents completed across all 5 parameters</div>
                    <div className="spi-dt-legal-grid">
                      {supLegal.cards.map(c => (
                        <div key={c.name} className={`spi-dt-legal-pcard spi-dt-legal-pcard--${c.st}`}>
                          <div className="spi-dt-legal-pcard-hd"><span className="spi-dt-legal-pcard-ico"><IcoCheck /></span><span className="spi-dt-legal-pcard-nm">{c.name}</span><span className="spi-dt-legal-pcard-cnt">{c.d} / {c.t}</span></div>
                          <div className="spi-dt-legal-pcard-bar"><div className="spi-dt-legal-pcard-fill" style={{ width: `${c.pc}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </>) : supLegalLoading
                    ? <div className="spi-dt-legal-note">Loading compliance status…</div>
                    : <div className="spi-dt-legal-note">Select a supplier to view legal &amp; compliance status.</div>}
                </div>
              )}
            </div>

            {/* Address & Contact Details */}
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
                <span className="spi-dt-fields-badge">9 FIELDS</span>
              </div>
              <div className="spi-dt-grid4">
                <Field label="REGISTERED OFFICE ADDRESS" full><input className="spi-dt-inp" value={sup?.addr ?? ''} placeholder="Building / street / area / landmark, with PIN code" readOnly /></Field>
                <Field label="COUNTRY"><Select value={dash(sup?.country)} /></Field>
                <Field label="STATE"><Select value={dash(sup?.state)} /></Field>
                <Field label="STATE CODE"><input className="spi-dt-inp" value={sup?.stateCode ?? ''} placeholder="e.g. 27" readOnly /></Field>
                <Field label="CITY"><input className="spi-dt-inp" value={sup?.city ?? ''} placeholder="Enter city" readOnly /></Field>
                <Field label="CONTACT PERSON NAME"><input className="spi-dt-inp" value={sup?.contact ?? ''} placeholder="Full name" readOnly /></Field>
                <Field label="DESIGNATION"><input className="spi-dt-inp" value={sup?.desig ?? ''} placeholder="e.g. Procurement Manager" readOnly /></Field>
                <Field label="CONTACT NUMBER"><input className="spi-dt-inp" value={sup?.phone ?? ''} placeholder="+91" readOnly /></Field>
                <Field label="EMAIL ID"><input className="spi-dt-inp" value={sup?.email ?? ''} placeholder="name@company.com" readOnly /></Field>
              </div>
            </div>

            {/* GST Scrutiny Details */}
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details
                  {scrutinyOld && <span className="spi-dt-scrutiny-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> Scrutiny Overdue</span>}
                </div>
                <span className="spi-dt-fields-badge">5 FIELDS</span>
              </div>
              {scrutinyOld && (
                <div className="spi-dt-scrutiny-warn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span><b>GST scrutiny date is old</b> (more than {SCRUTINY_STALE_MONTHS} months). Please do the scrutiny for this supplier before raising the invoice.</span></div>
              )}
              <div className="spi-dt-grid4">
                <Field label="SCRUTINY DATE"><input className="spi-dt-inp" value={sup?.scrutiny ?? ''} placeholder="—" readOnly /></Field>
                <Field label="GST NUMBER"><input className="spi-dt-inp" value={sup?.gstNo ?? ''} placeholder="15-digit GSTIN" readOnly /></Field>
                <Field label="GST STATUS"><Select value={dash(sup?.gstStatus)} /></Field>
                <Field label="LAST FILING DATE"><input className="spi-dt-inp" value={sup?.filing ?? ''} placeholder="—" readOnly /></Field>
                <Field label="PREV. INVOICE / REMARKS" full><textarea className="spi-dt-textarea" value={sup?.remarks ?? ''} placeholder="Notes on previous invoices, filing history or scrutiny remarks…" readOnly /></Field>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── Body (Step 2) — read-only summary of the completed Step 1 ── */}
      {step === 2 && (
      <div className="spi-dt-body">
        <div className={`spi-dt-sec ${sumOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setSumOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoHistory /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Summary</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">What We Did in the Previous Stages</span></div>
              <div className="spi-dt-sec-sub">Read-only summary of all completed stages so far — 1 stage done.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-sumstep">
              <div className="spi-dt-sumstep-hd">
                <div className="spi-dt-sumstep-hd-l">
                  <span className="spi-dt-sumstep-num">01</span>
                  <span className="spi-dt-sumstep-title">PO Link Supplier Details</span>
                </div>
                <span className="spi-dt-sumstep-done"><IcoCheck /> COMPLETED</span>
              </div>
              <div className="spi-dt-sumstep-body">
                <ROGroup label="Basic Purchase Order Details">
                  <RO label="PO TYPE" value={dash(withPo ? po?.po_type : basic.poType)} />
                  <RO label="DOCUMENT TYPE" value={dash(withPo ? po?.document_type : basic.docType)} />
                  <RO label="MODE OF TRANSPORT" value={dash(withPo ? po?.mode_of_transport : basic.transport)} />
                  <RO label="PO DATE" value={dash(withPo ? po?.po_date : todayDisp)} />
                  <RO label="EXPECTED DELIVERY DATE" value={(withPo ? po?.expected_delivery_date : basic.edd) || '— Not provided'} muted={!(withPo ? po?.expected_delivery_date : basic.edd)} />
                  <RO label="DELIVERY LOCATION" value={(withPo ? po?.delivery_location : basic.deliveryLoc) || '— Not provided'} muted={!(withPo ? po?.delivery_location : basic.deliveryLoc)} />
                  <RO label="PAYMENT TYPE" value={(withPo ? po?.payment_type : basic.payType) || '— Not provided'} muted={!(withPo ? po?.payment_type : basic.payType)} />
                  <RO label="PHYSICAL INSPECTION REQUIRED" value={physInsp ? 'Yes' : 'No'} />
                </ROGroup>
                {((withPo && po?.document_type === 'International') || (!withPo && basic.docType === 'International')) && (
                  <ROGroup label="International Details">
                    <RO label="CURRENCY" value={dash(withPo ? po?.currency : basic.currency)} />
                    <RO label="EXCHANGE RATE" value={(withPo ? (po?.exchange_rate != null ? String(po.exchange_rate) : '') : basic.exRate) || '— Not provided'} muted={!(withPo ? po?.exchange_rate : basic.exRate)} />
                    <RO label="INCO TERM" value={dash(withPo ? po?.inco_term : basic.inco)} />
                    <RO label="PORT OF LOADING" value={(withPo ? po?.port_of_loading : basic.portLoad) || '— Not provided'} muted={!(withPo ? po?.port_of_loading : basic.portLoad)} />
                    <RO label="PORT OF DISCHARGE" value={(withPo ? po?.port_of_discharge : basic.portDischarge) || '— Not provided'} muted={!(withPo ? po?.port_of_discharge : basic.portDischarge)} />
                    <RO label="FINAL DESTINATION" value={(withPo ? po?.final_destination : basic.finalDest) || '— Not provided'} muted={!(withPo ? po?.final_destination : basic.finalDest)} />
                    <RO label="COUNTRY OF ORIGIN" value={(withPo ? po?.country_of_origin : basic.origin) || '— Not provided'} muted={!(withPo ? po?.country_of_origin : basic.origin)} />
                  </ROGroup>
                )}
                <ROGroup label="Supplier Details">
                  <RO label="SELECT SUPPLIER" value={dash(withPo ? po?.supplier_name : (stdSupName || sup?.name))} />
                  <RO label="SUPPLIER CODE" value={dash(sup?.code)} />
                  <RO label="COMPANY NAME" value={dash(sup?.name)} />
                  <RO label="SUPPLIER TYPE" value={dash(sup?.type)} />
                </ROGroup>
                <ROGroup label="Supplier Legal Status">
                  <RO label="COMPLIANCE" value={supLegal ? `${supLegal.p}% — ${supLegal.done} of ${supLegal.tot} documents completed` : '— Not available'} muted={!supLegal} full />
                </ROGroup>
                <ROGroup label="Address & Contact Details">
                  <RO label="REGISTERED OFFICE ADDRESS" value={sup?.addr || '— Not provided'} muted={!sup?.addr} full />
                  <RO label="COUNTRY" value={dash(sup?.country)} />
                  <RO label="STATE" value={dash(sup?.state)} />
                  <RO label="STATE CODE" value={dash(sup?.stateCode)} />
                  <RO label="CITY" value={dash(sup?.city)} />
                  <RO label="CONTACT PERSON NAME" value={dash(sup?.contact)} />
                  <RO label="DESIGNATION" value={dash(sup?.desig)} />
                  <RO label="CONTACT NUMBER" value={dash(sup?.phone)} />
                  <RO label="EMAIL ID" value={dash(sup?.email)} />
                </ROGroup>
                <ROGroup label="GST Scrutiny Details">
                  <RO label="SCRUTINY DATE" value={dash(sup?.scrutiny)} />
                  <RO label="GST NUMBER" value={dash(sup?.gstNo)} />
                  <RO label="GST STATUS" value={dash(sup?.gstStatus)} />
                  <RO label="LAST FILING DATE" value={dash(sup?.filing)} />
                  <RO label="PREV. INVOICE / REMARKS" value={sup?.remarks || '— Not provided'} muted={!sup?.remarks} full />
                </ROGroup>
              </div>
            </div>
          </div>
        </div>

        {/* Invoice section */}
        <div className={`spi-dt-sec ${invOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setInvOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoDocSm /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Invoice</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Supplier Purchase Invoice Details</span></div>
              <div className="spi-dt-sec-sub">Enter invoice number, date &amp; attachment</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-grid3">
              <Field label="PURCHASE INVOICE NUMBER" req><input className={`spi-dt-inp ${errs.invoiceNo ? 'is-invalid' : ''}`} value={invoiceNo} onChange={e => { setInvoiceNo(e.target.value); setErrs(x => ({ ...x, invoiceNo: false })); }} placeholder="e.g. INV-2025-001" /></Field>
              <Field label="PURCHASE INVOICE DATE" req><MasterDatePicker value={invoiceDate} onChange={v => { setInvoiceDate(v); setErrs(x => ({ ...x, invoiceDate: false })); }} invalid={!!errs.invoiceDate} placeholder="Select date" /></Field>
              <Field label="PURCHASE INVOICE ATTACHMENT" req>
                <div className={`spi-dt-file ${errs.file ? 'is-invalid' : ''}`}>
                  <span className="spi-dt-file-txt"><IcoClip /> {file ? file.name : (existingAttach ? (existingAttach.split('/').pop() || 'Attached file') : 'Choose file…')}</span>
                  <button type="button" className="spi-dt-file-btn" onClick={() => fileRef.current?.click()}>Browse</button>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={e => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 2 * 1024 * 1024) { toast.error('File too large', 'The attachment must be 2 MB or smaller.'); e.target.value = ''; return; }
                    setFile(f); setErrs(x => ({ ...x, file: false }));
                  }} />
                </div>
              </Field>
            </div>
          </div>
        </div>

        {/* Products — 3-way match (With PO) OR standalone tax & cost (Direct/Without PO) */}
        {withPo ? (
        <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoBox /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Product Details</span></div>
              <div className="spi-dt-sec-sub">PI vs PO vs SPI product mapping &amp; 3-way match</div>
            </div>
            <div className="spi-dt-secpills">
              <HeadPill icon={<IcoDocSm />} label="SUPPLIER CODE" value={dash(sup?.code)} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value={dash(po?.supplier_name)} />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoPin />} label="STATE CODE" value={dash(sup?.stateCode)} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoDocSm />} label="PO NUMBER" value={dash(po?.code)} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoDocSm />} label="PI NUMBER" value={dash(po?.pi_number)} mono />
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-mtable-wrap">
              <table className="spi-dt-mtable">
                <colgroup>
                  <col style={{ width: '3.5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '15%' }} />
                  <col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '6%' }} />
                  <col style={{ width: '8.5%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '8.5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="spi-dt-mc-c">SR NO</th>
                    <th>PRODUCT CODE</th>
                    <th>PRODUCT NAME (PI)</th>
                    <th>PRODUCT NAME (PO)</th>
                    <th>PRODUCT NAME (SPI)</th>
                    <th>QUANTITY (PI)</th>
                    <th>QUANTITY (PO)</th>
                    <th>QUANTITY (SPI)</th>
                    <th>MISSING QTY</th>
                    <th>HSN CODE</th>
                    <th>RATE (PO)</th>
                    <th>RATE (SPI)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={12} className="spi-dt-mc-c" style={{ padding: '20px', color: '#94a3b8' }}>No products on this purchase order.</td></tr>
                  ) : rows.map((r, i) => {
                    // Uncovered PO qty after prior invoices + this one.
                    const missing = r.poQty - r.invoiced - Number(r.spiQty || 0);
                    return (
                    <tr key={i}>
                      <td className="spi-dt-mc-c">{i + 1}</td>
                      <td><span className="spi-dt-mcode">{r.code || '—'}</span></td>
                      <td className="spi-dt-mname">{r.piName || '—'}</td>
                      <td className="spi-dt-mname">{r.poName || '—'}</td>
                      <td><input className="spi-dt-minp" value={r.spiName} onChange={e => setRow(i, { spiName: e.target.value })} /></td>
                      <td>{r.piQty ?? '—'}</td>
                      <td>{r.poQty}</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" value={r.spiQty} onChange={e => setRow(i, { spiQty: e.target.value })} /></td>
                      <td>{Number.isFinite(missing) ? missing : 0}</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" value={r.hsn} onChange={e => setRow(i, { hsn: e.target.value })} /></td>
                      <td className="spi-dt-amt">{inr(r.ratePo)}</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" value={r.spiRate} onChange={e => setRow(i, { spiRate: e.target.value })} /></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="spi-dt-sum">
              <div className="spi-dt-sumleft">
                <div className="spi-dt-sum-charges">
                  <div className="spi-dt-sum-hd">Additional Charges</div>
                  <div className="spi-dt-chg-grid">
                    {([['Shipping Charges', 'ship'], ['Packaging Charges', 'pack'], ['Other Charges', 'other']] as const).map(([lbl, key]) => (
                      <div className="spi-dt-chg-f" key={key}>
                        <label>{lbl}</label>
                        <div className="spi-dt-chg-inwrap"><span className="spi-dt-chg-cur">₹</span><input className="spi-dt-chg-in" type="number" min={0} step="0.01" placeholder="0.00" value={charges[key]} onChange={e => setCharges(c => ({ ...c, [key]: e.target.value }))} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="button" className="spi-dt-save-btn" disabled={savingDetails} onClick={() => {
                  if (savingDetails) return;
                  setSavingDetails(true);
                  setTimeout(() => { setSavingDetails(false); setShowMissing(true); toast.success('Product details saved'); }, 500);
                }}>
                  {savingDetails ? (<><Spinner /> Saving…</>) : (<><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Save Details</>)}
                </button>
              </div>
              <div className="spi-dt-totbox">
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total Product Cost</span><span className="spi-dt-totrow-v">{inr(totals.prod)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total CGST Amount</span><span className="spi-dt-totrow-v">{inr(totals.cgst)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total SGST Amount</span><span className="spi-dt-totrow-v">{inr(totals.sgst)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Additional Charges</span><span className="spi-dt-totrow-v">{inr(addlCharges)}</span></div>
                <div className="spi-dt-totrow spi-dt-totrow-grand"><span className="spi-dt-totrow-k">Grand Total</span><span className="spi-dt-totrow-v">{inr(grandTotal)}</span></div>
              </div>
            </div>
          </div>
        </div>
        ) : (
        <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoBox /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Product Details</span></div>
              <div className="spi-dt-sec-sub">Supplier invoice products with tax &amp; cost computation</div>
            </div>
            <div className="spi-dt-secpills">
              <HeadPill icon={<IcoDocSm />} label="SUPPLIER CODE" value={dash(sup?.code)} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value={dash(sup?.name)} />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoPin />} label="STATE CODE" value={dash(sup?.stateCode)} mono />
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-mtable-wrap">
              <table className="spi-dt-mtable">
                <colgroup>
                  <col style={{ width: '5%' }} /><col style={{ width: '9%' }} /><col style={{ width: '21%' }} /><col style={{ width: '9%' }} /><col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="spi-dt-mc-c">SR NO</th>
                    <th>PRODUCT CODE</th>
                    <th>PRODUCT NAME</th>
                    <th>PRODUCT QUANTITY</th>
                    <th>HSN CODE</th>
                    <th>PRODUCT RATE</th>
                    <th className="spi-dt-mc-r">CGST</th>
                    <th className="spi-dt-mc-r">SGST</th>
                    <th className="spi-dt-mc-r">PRODUCT COST</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={10} className="spi-dt-mc-c" style={{ padding: '20px', color: '#94a3b8' }}>No products added yet — click <b>Add Product</b> below.</td></tr>
                  ) : rows.map((r, i) => {
                    const c = rowCost(r);
                    return (
                    <tr key={i}>
                      <td className="spi-dt-mc-c">{i + 1}</td>
                      <td><span className="spi-dt-mcode">{r.code || '—'}</span></td>
                      <td><EditSelect value={r.spiName} options={prodOpts.map(p => p.name)} meta={prodMeta} placeholder="— Select Product —" onChange={v => pickProduct(i, v)} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" min={0} value={r.spiQty} onChange={e => setRow(i, { spiQty: e.target.value })} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" value={r.hsn} onChange={e => setRow(i, { hsn: e.target.value })} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" min={0} value={r.spiRate} onChange={e => setRow(i, { spiRate: e.target.value })} /></td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(c.cgstA)}</td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(c.sgstA)}</td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(c.cost)}</td>
                      <td className="spi-dt-mc-c"><button type="button" className="spi-dt-rowdel" onClick={() => removeRow(i)} title="Remove product"><IcoX /></button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="spi-dt-addrow" onClick={addRow}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Product
            </button>
            <div className="spi-dt-sum">
              <div className="spi-dt-sumleft">
                <div className="spi-dt-sum-charges">
                  <div className="spi-dt-sum-hd">Additional Charges</div>
                  <div className="spi-dt-chg-grid">
                    {([['Shipping Charges', 'ship'], ['Packaging Charges', 'pack'], ['Other Charges', 'other']] as const).map(([lbl, key]) => (
                      <div className="spi-dt-chg-f" key={key}>
                        <label>{lbl}</label>
                        <div className="spi-dt-chg-inwrap"><span className="spi-dt-chg-cur">₹</span><input className="spi-dt-chg-in" type="number" min={0} step="0.01" placeholder="0.00" value={charges[key]} onChange={e => setCharges(cs => ({ ...cs, [key]: e.target.value }))} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="button" className="spi-dt-save-btn" disabled={savingDetails} onClick={() => {
                  if (savingDetails) return;
                  setSavingDetails(true);
                  setTimeout(() => { setSavingDetails(false); setShowMissing(true); toast.success('Product details saved'); }, 500);
                }}>
                  {savingDetails ? (<><Spinner /> Saving…</>) : (<><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Save Details</>)}
                </button>
              </div>
              <div className="spi-dt-totbox">
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total Product Cost</span><span className="spi-dt-totrow-v">{inr(totals.prod)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total CGST Amount</span><span className="spi-dt-totrow-v">{inr(totals.cgst)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total SGST Amount</span><span className="spi-dt-totrow-v">{inr(totals.sgst)}</span></div>
                <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Additional Charges</span><span className="spi-dt-totrow-v">{inr(addlCharges)}</span></div>
                <div className="spi-dt-totrow spi-dt-totrow-grand"><span className="spi-dt-totrow-k">Grand Total</span><span className="spi-dt-totrow-v">{inr(grandTotal)}</span></div>
              </div>
            </div>
          </div>
        </div>
        )}
        <div className="spi-dt-sec">
          <div className="spi-dt-sec-head" style={{ cursor: 'default' }}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-warn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Missing Product Details</span></div>
              <div className="spi-dt-sec-sub">{withPo ? 'PO quantities not fully covered by this invoice' : 'Products captured on this direct invoice'}</div>
            </div>
            {showMissing && <span className={`spi-dt-misscount ${missingRows.length === 0 ? 'is-zero' : ''}`}>{missingRows.length} Missing</span>}
          </div>
          <div className="spi-dt-sec-body">
            {!showMissing ? (
              <div className="spi-dt-miss-empty"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Click <b>&nbsp;Save Details&nbsp;</b> above to check missing product quantities.</div>
            ) : missingRows.length === 0 ? (
              <div className="spi-dt-miss-empty spi-dt-miss-ok"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg> {withPo ? 'No missing quantities — every PO quantity is fully covered.' : 'All invoice products captured — no purchase order to reconcile against.'}</div>
            ) : (
              <div className="spi-dt-misstbl-wrap">
                <table className="spi-dt-misstbl">
                  <thead><tr><th className="spi-dt-mc-c">SR NO</th><th>PRODUCT CODE</th><th>PRODUCT NAME</th><th>QUANTITY (PO)</th><th>QUANTITY (SPI)</th><th>MISSING QTY</th></tr></thead>
                  <tbody>
                    {missingRows.map((m, idx) => (
                      <tr key={idx}>
                        <td className="spi-dt-mc-c">{idx + 1}</td>
                        <td><span className="spi-dt-mcode">{m.code || '—'}</span></td>
                        <td className="spi-dt-mname">{m.name || '—'}</td>
                        <td>{m.poQty}</td>
                        <td>{m.spiQty}</td>
                        <td style={{ color: '#dc2626', fontWeight: 800 }}>{m.miss}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Footer ── */}
      {step === 1 ? (
      <div className="spi-dt-foot">
        <div className="spi-dt-foot-l">
          <div>
            <div className="spi-dt-foot-step">STEP 01 OF 02</div>
            <div className="spi-dt-foot-name">PO Link Supplier Details</div>
          </div>
          <div className="spi-dt-dots"><span className="on" /><span /></div>
        </div>
        <div className="spi-dt-foot-r">
          <button type="button" className="spi-dt-btn-ghost" onClick={onChangeSelection ?? onClose}><IcoChevronL /> Change Selection</button>
          <button type="button" className="spi-dt-btn-next" onClick={goStep2} disabled={nexting}>{nexting ? <><Spinner /> Loading…</> : <>Save &amp; Next <IcoChevronR /></>}</button>
        </div>
      </div>
      ) : (
      <div className="spi-dt-foot">
        <div className="spi-dt-foot-l">
          <div>
            <div className="spi-dt-foot-step">STEP 02 OF 02</div>
            <div className="spi-dt-foot-name">Invoice &amp; Product Details (3-Way Match)</div>
          </div>
          <div className="spi-dt-dots"><span className="done" /><span className="on" /></div>
        </div>
        <div className="spi-dt-foot-r">
          <button type="button" className="spi-dt-btn-ghost" onClick={() => setStep(1)}><IcoChevronL /> Back</button>
          <button type="button" className="spi-dt-btn-map" onClick={handleSave} disabled={saving}>{saving ? <><Spinner /> Saving…</> : <><IcoCheck /> Map Invoice</>}</button>
        </div>
      </div>
      )}
    </div>

    <SupplierEvidenceVaultModal
      open={vaultOpen}
      supplier={{
        id: sup?.code || 'S-000',
        db_id: vendorDbId,
        company: sup?.name || stdSupName || 'Supplier',
        country: sup?.country || 'India',
        contact: sup?.contact || undefined,
        contactCity: sup?.city || undefined,
        email: sup?.email && sup.email !== '—' ? sup.email : undefined,
        risk: 'Compliant',
      }}
      onClose={() => setVaultOpen(false)}
    />
    </div>,
    document.body,
  );
}

/* ── Small sub-components ── */
function HeadPill({ icon, label, value, alt, mono }: { icon: React.ReactNode; label: string; value: string; alt?: boolean; mono?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div className="spi-dt-pill-txt"><div className="spi-dt-pill-lbl">{label}</div><div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`} title={value}>{value}</div></div>
    </div>
  );
}
function IcoLines() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/></svg>; }
function Spinner() { return <svg className="spi-dt-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>; }
function Field({ label, children, full, req }: { label: string; children: React.ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}
/* Shimmer skeleton shown while the wizard fetches its data (PO / supplier / edit). */
function SpiFormSkeleton() {
  return (
    <div className="spi-dt-body">
      {[0, 1].map(s => (
        <div className="spi-dt-sec" key={s}>
          <div className="spi-dt-sec-head" style={{ cursor: 'default' }}>
            <div className="spi-dt-sk spi-dt-sk-ico" />
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 200 }} />
              <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 280, height: 8, marginTop: 7 }} />
            </div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-grid4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>
                  <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 84, height: 8, marginBottom: 9 }} />
                  <div className="spi-dt-sk spi-dt-sk-field" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
function Select({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <div className={`spi-dt-select ${muted ? 'is-muted' : ''}`} title={value}>
      <span>{value}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </div>
  );
}
/* Render an option label, optionally with a code prefix + own/third badge. */
function eselLabel(o: string, m?: DdMeta) {
  if (!m) return <span>{o}</span>;
  return (
    <span className="spi-dt-esel-lbl">
      {m.code && <span className="spi-dt-esel-code">{m.code}:</span>}
      <span className="spi-dt-esel-name">{o}</span>
      {m.badge && <span className={`spi-dt-esel-badge spi-dt-esel-badge--${m.tone || 'own'}`}>{m.badge}</span>}
    </span>
  );
}
/* Editable styled dropdown (standalone Step-1 basic details). The popup is
   portalled to <body> so the section card's overflow:hidden can't clip it. */
function EditSelect({ value, options, onChange, placeholder, meta, invalid }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; meta?: Record<string, DdMeta>; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  // Position under the button, flipping up if it would overflow the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(224, Math.max(options.length, 1) * 38 + 10);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.spi-dt-esel-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={btnRef} title={value || undefined} className={`spi-dt-select spi-dt-select-edit ${open ? 'is-open' : ''} ${!value ? 'is-muted' : ''} ${invalid ? 'is-invalid' : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{value ? eselLabel(value, meta?.[value]) : (placeholder || '— Select —')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="spi-dt-esel-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map(o => (
            <div key={o} className={`spi-dt-esel-opt ${o === value ? 'is-active' : ''}`} onClick={() => { onChange(o); setOpen(false); }}>{eselLabel(o, meta?.[o])}</div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
/* read-only recap field + group (Step 2 Summary) */
function RO({ label, value, full, muted }: { label: string; value: string; full?: boolean; muted?: boolean }) {
  return <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}><div className="spi-dt-ro-lbl">{label}</div><div className={`spi-dt-ro-val ${muted ? 'is-muted' : ''}`}>{value}</div></div>;
}
function ROGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="spi-dt-rogroup"><div className="spi-dt-rogroup-hd">{label}</div><div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div></div>;
}

/* ── Icons ── */
function IcoDoc() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoDocSm() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>; }
function IcoHash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>; }
function IcoUser() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IcoShield() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IcoCard() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoX() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoChevron() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoChevronL() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>; }
function IcoChevronR() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function IcoLock() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function IcoCal() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function IcoPin() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoCheck() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoHistory() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>; }
function IcoClip() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>; }
function IcoBox() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
