import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import Tooltip from '../../../../components/ui/Tooltip';
import '../../p2p-detail.css';
import '../order/create-po/create-po.css';
import './invoice-form.css';
import { HeadPill } from '../order/create-po/CreatePoForm';
import { WizSpinner } from '../order/create-po/form-fields';
import {
  IcoBriefcase, IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLock, IcoRefLines,
  IcoShield, IcoUser, IcoVan, IcoWarehouse, IcoX,
} from '../../icons';
import Step1SupplierDetails from './steps/Step1SupplierDetails';
import Step2InvoiceProducts from './steps/Step2InvoiceProducts';
import Step3BoxPackaging from './steps/Step3BoxPackaging';
import Step4PutawayAllocation from './steps/Step4PutawayAllocation';
import { draftFromPo, draftFromScrutiny, draftFromSupplier, newestScrutiny, useInvoiceDraft } from './invoice-draft';
import { PoApiError, poApi, poLookupApi, type PoDetail } from '../order/api/po-api';

type GstApproval = NonNullable<PoDetail['gst_approval']>;
import { gstState, legalFromVault, pendingCaseToCase, vaultTargetOf } from '../order/create-po/supplier-checks';
import SupplierDocsNoticeModal, { type SupplierDocsNotice } from '../order/create-po/SupplierDocsNoticeModal';

const SupplierEvidenceVaultModal = lazy(() => import('../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { putId, spiApi, type ProductFlagOption, type SpiBox, type SpiBoxBody, type WarehouseDetail } from './spi-api';
import { SPI_STATUS_LABELS, spiViewOnlyReason } from './types';
import {
  DEFAULT_HOME_STATE_CODE, PRODUCT_LINES, blankLine, formatProductCode, itemsPayload, linesFromPo, taxModeFor, withoutCodePrefix,
  type ProductLine, type SpiPoOpen,
} from './invoice-products';
import type { StorageChoice } from './StorageSelectionModal';

const STAGES = [
  { title: 'Supplier Details', desc: 'Link the PO and confirm supplier details' },
  { title: 'Invoice & Product Details (3-Way Match)', desc: 'Enter invoice details & match products against the PO & GRN' },
  { title: 'Temporary Box Packaging', desc: 'Choose a packaging scenario and generate labelled, verified boxes' },
  { title: 'Temporary Putaway Allocation', desc: 'Assign a temporary putaway location for each product' },
] as const;

const DIRECT_STAGES: Record<number, { title: string; desc: string }> = {
  0: { title: 'Supplier Details', desc: 'Confirm the supplier this invoice is issued by' },
  1: {
    title: 'Invoice & Product Details (2-Way Match)',
    desc: 'Enter invoice details & match products against the PI of the shipment',
  },
};

const UNMATCHED_STAGES: Record<number, { title: string; desc: string }> = {
  0: DIRECT_STAGES[0],
  1: {
    title: 'Invoice & Product Details',
    desc: 'Enter invoice details & the products invoiced by the supplier',
  },
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface InvoiceFormInput {
  spiId?: number;
  status?: string;
  statusLabel?: string;
  poId?: number;
  poNo?: string;
  supplier: string;
  storage: StorageChoice;
  invoiceNo?: string;
  direct?: {
    shipmentId?: string; shipmentPi?: string; procurementCode?: string; supplierCode?: string;
    shipmentOrderId?: number; procurementRequestId?: number;
  };
  openAtStage1?: boolean;
}

const BOX_FIELD_LABEL: Record<string, string> = {
  flags: 'product flags', quantity: 'quantity in box', serial_no: 'serial no.', lot_no: 'lot no.', batch_no: 'batch no.',
  cat_no: 'cat no.', expiry_date: 'expiry date', mfg_date: 'MFG date', remark: 'product remark', remark_note: 'remark note',
  supplier_invoice_item_id: 'product', is_stackable: 'stackable setting', length_cm: 'length', width_cm: 'width',
  height_cm: 'height', weight_kg: 'weight', net_weight_kg: 'net weight', gross_weight_kg: 'gross weight',
  condition: 'box condition', temp_min_c: 'minimum temperature', temp_max_c: 'maximum temperature',
  scenario: 'packing scenario', items: 'products in the box',
};

export default function InvoiceForm({
  input, invoiceNo, onClose,
}: {
  input: InvoiceFormInput;
  invoiceNo: string;
  onClose: () => void;
}) {
  const { draft, set } = useInvoiceDraft({
    supplier: input.direct ? '' : input.supplier, poNo: input.poNo,
    shipmentId: input.direct?.shipmentId, procurementCode: input.direct?.procurementCode,
    piNumber: input.direct?.shipmentPi,
  });
  const toast = useToast();
  const confirm = useConfirm();

  const mappedSupplier = useRef(input.direct?.supplierCode ?? '');

  const [directSupLoading, setDirectSupLoading] = useState(!!input.direct?.supplierCode);

  const [supplierBusy, setSupplierBusy] = useState(false);

  const [noPo, setNoPo] = useState(!!input.direct);
  const isDirect = !!input.direct || noPo;
  const matchedToPi = !isDirect || !!draft.shipmentId;

  const [gstApproval, setGstApproval] = useState<GstApproval | null>(null);
  const savedVendor = useRef<number | null>(null);
  const directLinks = useRef({
    shipment_order_id: input.direct?.shipmentOrderId ?? null as number | null,
    procurement_request_id: input.direct?.procurementRequestId ?? null as number | null,
    procurement_request_code: input.direct?.procurementCode ?? null as string | null,
  });
  const latestSpiApproval = useCallback((id: number) => {
    spiApi.gstApprovals(id)
      .then(rows => {
        const r = rows[0];
        setGstApproval(r ? {
          id: r.id, status: r.status, reason: r.reason, requested_to_name: r.requested_to_name,
          requested_at: r.requested_at, decided_at: r.decided_at ?? null,
        } : null);
      })
      .catch(() => {});
  }, []);
  const reloadApproval = useCallback(() => {
    if (!input.poId) { if (spiIdRef.current) latestSpiApproval(spiIdRef.current); return; }
    poApi.show(input.poId)
      .then(po => setGstApproval(po.gst_approval ?? null))
      .catch(() => {});
  }, [input.poId]);

  const [poLoading, setPoLoading] = useState(!!(input.poId || input.spiId));
  const [poError, setPoError] = useState<string | null>(null);
  const [lines, setLines] = useState<ProductLine[]>(
    input.poId || input.spiId || input.direct ? [] : PRODUCT_LINES,
  );
  const [files, setFiles] = useState<{ invoice_file?: File | null; eway_file?: File | null }>({});
  const [uploaded, setUploaded] = useState<{ invoice?: string | null; eway?: string | null }>({});
  const [spiId, setSpiId] = useState<number | null>(null);
  const spiIdRef = useRef<number | null>(null);
  spiIdRef.current = spiId;
  const [spiCode, setSpiCode] = useState<string | null>(input.invoiceNo ?? null);
  const [saving, setSaving] = useState(false);
  const [putaway, setPutaway] = useState<{ placed: number; total: number } | null>(null);
  const onPutawayProgress = useCallback((placed: number, total: number) => setPutaway({ placed, total }), []);
  const [boxes, setBoxes] = useState<SpiBox[]>([]);
  const [flagMaster, setFlagMaster] = useState<ProductFlagOption[]>([]);
  const [boxesLoading, setBoxesLoading] = useState(false);
  const [savedWarehouse, setSavedWarehouse] = useState<string | null>(null);
  const [savedWarehouseId, setSavedWarehouseId] = useState<number | null>(null);
  const [warehouseRow, setWarehouseRow] = useState<WarehouseDetail | null>(null);
  const [spiBranchId, setSpiBranchId] = useState<number | null>(null);
  const [spiStatus, setSpiStatus] = useState<{ status?: string; label?: string }>({
    status: input.status, label: input.statusLabel,
  });
  const viewOnly = !!spiViewOnlyReason(spiStatus.status, spiStatus.label);
  const editing = !!input.spiId;

  useEffect(() => {
    if (input.invoiceNo) return;
    let live = true;
    spiApi.nextCode().then(c => { if (live && c) setSpiCode(cur => cur ?? c.code); }).catch(() => {});
    return () => { live = false; };
  }, [input.invoiceNo]);

  useEffect(() => {
    if (!input.poId && !input.spiId) return;
    let live = true;
    setPoLoading(true);
    setPoError(null);
    (async () => {
      try {
        const existing = input.spiId ? (await spiApi.show(input.spiId)).invoice : null;
        const poId = input.poId ?? existing?.purchase_order_id ?? null;
        if (!live) return;
        if (existing) {
          setSpiId(existing.id);
          setSpiCode(existing.code);
          if (!existing.purchase_order_id) latestSpiApproval(existing.id);
          if (existing.warehouse?.wh_name) setSavedWarehouse(existing.warehouse.wh_name);
          if (existing.warehouse?.id) setSavedWarehouseId(existing.warehouse.id);
          setSpiStatus({ status: existing.status, label: SPI_STATUS_LABELS[existing.status] ?? existing.status });
          setSpiBranchId(existing.branch_id ?? null);
          const resumeAt = Math.min(Math.max(0, existing.stage_completed), STAGES.length - 1);
          setReached(resumeAt);
          setStage(spiViewOnlyReason(existing.status) || input.openAtStage1 ? 0 : resumeAt);
          savedVendor.current = existing.vendor_id ?? null;
          if (!existing.purchase_order_id) {
            directLinks.current = {
              shipment_order_id: existing.shipment_order_id ?? directLinks.current.shipment_order_id,
              procurement_request_id: existing.procurement_request_id ?? directLinks.current.procurement_request_id,
              procurement_request_code: existing.procurement_request_code ?? directLinks.current.procurement_request_code,
            };
          }
        }
        if (!poId) {
          const standalone = !!input.direct || (!!existing && !existing.purchase_order_id);
          setNoPo(standalone);
          if (!standalone) setPoError('This invoice is not linked to a purchase order.');
          if (standalone && existing) {
            const so = existing.shipment_order ?? null;
            set({
              ...(so?.shipment_code ? { shipmentId: so.shipment_code } : {}),
              ...(so?.proforma_invoice?.code ? { piNumber: so.proforma_invoice.code } : {}),
              ...(existing.procurement_request_code ? { procurementCode: existing.procurement_request_code } : {}),
              invoiceNumber: existing.invoice_no ?? '',
              ...(existing.invoice_date ? { invoiceDate: existing.invoice_date.slice(0, 10) } : {}),
              invoiceFile: existing.invoice_file_name ?? '',
              ewayBillFile: existing.eway_file_name ?? '',
            });
            setUploaded({ invoice: existing.invoice_file_name, eway: existing.eway_file_name });
            if (!input.direct && existing.vendor_id) {
              const vid = existing.vendor_id;
              const [sup, scrutiny] = await Promise.all([
                poLookupApi.supplier(vid).catch(() => null),
                spiApi.vendorScrutiny(vid).catch(() => null),
              ]);
              if (!live) return;
              if (sup) {
                const gst = newestScrutiny(scrutiny);
                set({
                  vendorId: vid,
                  ...draftFromSupplier(sup),
                  ...(gst ? draftFromScrutiny(gst) : {}),
                  docType: existing.document_type === 'international' ? 'International' : 'Domestic',
                });
                mappedSupplier.current = sup.code;
              }
              poLookupApi.supplierVault(vid)
                .then(v => { if (live) set({ vault: v, legal: legalFromVault(v) }); })
                .catch(() => { if (live) set({ vault: null, legal: legalFromVault(null) }); });
            }
            if (existing.items.length) {
              const pi = existing.shipment_order_id
                ? await poApi.piLines(existing.shipment_order_id).then(r => r.lines).catch(() => [])
                : [];
              if (!live) return;
              const byPi = new Map(pi.map(l => [l.pi_item_id, l]));
              const byProduct = new Map(pi.map(l => [l.product_id, l]));
              setLines(existing.items.map(it => {
                const m = (it.pi_item_id != null ? byPi.get(it.pi_item_id) : undefined) ?? byProduct.get(it.product_id);
                const name = withoutCodePrefix(m?.product_name ?? '', m?.product_code) || formatProductCode(m?.product_code);
                return {
                  key: `saved:${it.id}`,
                  spiItemId: it.id,
                  piItemId: m?.pi_item_id ?? it.pi_item_id ?? null,
                  productId: it.product_id,
                  code: formatProductCode(m?.product_code),
                  hsn: it.hsn_code ?? m?.hsn_code ?? '',
                  piName: name, poName: name, spiName: name,
                  description: it.description ?? m?.description ?? '',
                  uom: it.uom ?? undefined,
                  piQty: Number(it.qty_pi ?? m?.pi_quantity) || 0, poQty: 0,
                  spiQty: Number(it.qty_spi) || 0,
                  spiRate: Number(it.rate) || 0, poRate: 0,
                  gst: Number(it.gst_pct) || 0,
                };
              }));
              setRemovedLines([]);
            }
          }
          return;
        }
        const [po, openLines] = await Promise.all([
          poApi.show(poId),
          spiApi.poLines(poId, existing?.id).catch(() => []),
        ]);
        const open: Record<number, SpiPoOpen> = {};
        for (const l of openLines) {
          open[l.po_item_id] = {
            qty_open: l.qty_open, qty_billed: l.qty_billed, qty_over: l.qty_over, closed: l.closed,
          };
        }
        const sup = po.vendor_id ? await poLookupApi.supplier(po.vendor_id).catch(() => null) : null;
        if (!live) return;
        set(draftFromPo(po, sup));
        setGstApproval(po.gst_approval ?? null);
        mappedSupplier.current = sup?.code ?? '';

        let rows = linesFromPo(po.items ?? [], open);
        if (existing) {
          const saved = new Map(existing.items.filter(i => i.po_item_id != null).map(i => [i.po_item_id!, i]));
          if (saved.size) {
            rows = rows.map(l => {
              const it = l.poItemId != null ? saved.get(l.poItemId) : undefined;
              return it
                ? { ...l, spiQty: Number(it.qty_spi) || 0, spiRate: Number(it.rate) || 0, productId: it.product_id, spiItemId: it.id }
                : { ...l, spiQty: 0 };
            });
          }
          set({
            invoiceNumber: existing.invoice_no ?? '',
            ...(existing.invoice_date ? { invoiceDate: existing.invoice_date.slice(0, 10) } : {}),
            invoiceFile: existing.invoice_file_name ?? '',
            ewayBillFile: existing.eway_file_name ?? '',
          });
          setUploaded({ invoice: existing.invoice_file_name, eway: existing.eway_file_name });
        }
        setLines(rows);
        setRemovedLines([]);

        if (po.vendor_id) {
          poLookupApi.supplierVault(po.vendor_id)
            .then(v => { if (live) set({ vault: v, legal: legalFromVault(v) }); })
            .catch(() => { if (live) set({ vault: null, legal: legalFromVault(null) }); });
        }
      } catch (e) {
        if (!live) return;
        const msg = e instanceof PoApiError ? e.firstError : 'Please try again.';
        setPoError(msg);
        toast.error(input.spiId ? 'Could not load the invoice' : 'Could not load the purchase order', msg);
      } finally {
        if (live) setPoLoading(false);
      }
    })();
    return () => { live = false; };
  }, [input.poId, input.spiId, set, toast]);

  const warehouseId = savedWarehouseId ?? input.storage.warehouse?.apiId ?? null;
  useEffect(() => {
    if (!warehouseId) { setWarehouseRow(null); return; }
    let live = true;
    spiApi.warehouseDetail(warehouseId)
      .then(w => { if (live) setWarehouseRow(w); })
      .catch(() => { if (live) setWarehouseRow(null); });
    return () => { live = false; };
  }, [warehouseId]);

  const [removedLines, setRemovedLines] = useState<{ at: number; line: ProductLine }[]>([]);

  const removeLine = useCallback((index: number) => {
    const line = lines[index];
    if (!line) return;
    setLines(ls => ls.filter((_, i) => i !== index));
    if (matchedToPi) setRemovedLines(r => [...r, { at: index, line }]);
  }, [lines, matchedToPi]);

  const restoreLines = useCallback(() => {
    setLines(ls => {
      const out = [...ls];
      for (const r of [...removedLines].sort((a, b) => a.at - b.at)) {
        out.splice(Math.min(r.at, out.length), 0, r.line);
      }
      return out;
    });
    setRemovedLines([]);
  }, [removedLines]);

  const changeLine = useCallback((index: number, patch: Partial<ProductLine>) => {
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const addLine = useCallback(() => {
    setLines(ls => [...ls, blankLine()]);
  }, []);

  const [stage, setStage] = useState(0);
  const [reached, setReached] = useState(0);

  useScrollLock(true, '.spi-dt-overlay');

  const goTo = (i: number) => { if (saving) return; if (i <= reached) setStage(i); };
  const advance = () => {
    const next = stage + 1;
    setStage(next);
    setReached(r => Math.max(r, next));
  };

  const requestSpiApproval = async (body: { requested_to?: number; note?: string }) => {
    if (!spiId) return;
    if (draft.vendorId && draft.vendorId !== savedVendor.current) {
      await spiApi.updateStage1(spiId, {
        purchase_order_id: null,
        vendor_id: draft.vendorId,
        document_type: draft.docType === 'International' ? 'international' : 'domestic',
        warehouse_id: savedWarehouseId ?? (input.storage.type === 'own' ? input.storage.warehouse?.apiId ?? null : null),
        ...directLinks.current,
      });
      savedVendor.current = draft.vendorId;
      mappedSupplier.current = draft.supplierCode;
    }
    return spiApi.gstApprovalRequest(spiId, body);
  };

  const saveStage1 = async () => {
    if (spiId) {
      if (!isDirect || viewOnly) { advance(); return; }
      if (!draft.vendorId) {
        toast.warning('Choose a supplier', 'Pick the supplier this invoice is issued by before continuing.');
        return;
      }
      setSaving(true);
      try {
        const { blockers } = await spiApi.updateStage1(spiId, {
          purchase_order_id: null,
          vendor_id: draft.vendorId,
          document_type: draft.docType === 'International' ? 'international' : 'domestic',
          warehouse_id: savedWarehouseId ?? (input.storage.type === 'own' ? input.storage.warehouse?.apiId ?? null : null),
          ...directLinks.current,
        });
        savedVendor.current = draft.vendorId;
        mappedSupplier.current = draft.supplierCode;
        if (blockers.length) {
          toast.warning('Stage 01 is not complete', blockers.map(b => b.message).join(' '));
          return;
        }
        const shipmentOrderId = directLinks.current.shipment_order_id;
        if (shipmentOrderId && !lines.some(l => l.spiItemId != null)) {
          const pi = await poApi.piLines(shipmentOrderId);
          setLines(pi.lines.map(l => {
            const name = withoutCodePrefix(l.product_name ?? '', l.product_code) || formatProductCode(l.product_code);
            return {
              key: `pi:${l.pi_item_id}`,
              piItemId: l.pi_item_id,
              productId: l.product_id ?? undefined,
              code: formatProductCode(l.product_code),
              hsn: l.hsn_code ?? '',
              uom: l.uom ?? undefined,
              piName: name, poName: name, spiName: name,
              description: l.description ?? '',
              piQty: Number(l.pi_quantity) || 0,
              poQty: 0,
              spiQty: Number(l.pending_qty) || 0,
              spiRate: Number(l.rate) || 0,
              poRate: Number(l.rate) || 0,
              gst: Number(l.gst_pct) || 0,
            };
          }));
          setRemovedLines([]);
        }
        advance();
      } catch (e) {
        toast.error('Could not save Stage 01', e instanceof PoApiError ? e.firstError : 'Please try again.');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!draft.vendorId) {
      if (isDirect) {
        toast.warning('Choose a supplier', 'Pick the supplier this invoice is issued by before continuing.');
      } else {
        toast.warning('Supplier not loaded', 'The purchase order has no supplier to raise this invoice against.');
      }
      return;
    }
    setSaving(true);
    try {
      const spi = await spiApi.create({
        purchase_order_id: input.poId ?? null,
        vendor_id: draft.vendorId,
        document_type: draft.docType === 'International' ? 'international' : 'domestic',
        warehouse_id: input.storage.type === 'own' ? input.storage.warehouse?.apiId ?? null : null,
      });
      setSpiId(spi.id);
      setSpiCode(spi.code);
      mappedSupplier.current = draft.supplierCode;
      toast.success(`${spi.code} created`, 'Saved as a draft — continue with the invoice details.');
      advance();
    } catch (e) {
      toast.error('Could not save Stage 01', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const taxMode = draft.taxMode ?? taxModeFor(draft.country, draft.stateCode, DEFAULT_HOME_STATE_CODE);

  const pickFile = useCallback((kind: 'invoice' | 'eway', file: File) => {
    setFiles(f => ({ ...f, [`${kind}_file`]: file }));
    set(kind === 'invoice' ? { invoiceFile: file.name } : { ewayBillFile: file.name });
  }, [set]);

  const saveStage2 = async () => {
    if (!spiId) { toast.warning('Save Stage 01 first', 'The invoice has not been created yet.'); return; }
    const missing = [
      !draft.invoiceNumber.trim() && 'the purchase invoice number',
      !draft.invoiceDate && 'the purchase invoice date',
      !files.invoice_file && !uploaded.invoice && 'the purchase invoice attachment',
    ].filter(Boolean);
    if (missing.length) {
      toast.warning('Fill in the invoice details', `Enter ${missing.join(', ')} before saving.`);
      return;
    }
    const payload = itemsPayload(lines, taxMode);
    if (payload.items.length === 0) {
      toast.warning('Nothing to invoice', 'Enter a quantity above zero on at least one product line.');
      return;
    }
    const international = draft.docType === 'International';
    setSaving(true);
    try {
      const res = await spiApi.saveItems(spiId, {
        ...payload,
        invoice_no: draft.invoiceNumber.trim(),
        invoice_date: draft.invoiceDate,
        ...(international ? { currency_code: draft.currency || null, exchange_rate: draft.exchangeRate || null } : {}),
      }, files);
      const saved = [...(res.invoice.items ?? [])].sort((a, b) => a.line_no - b.line_no);
      let n = 0;
      const withIds = lines.map(l => (l.spiQty > 0 && l.productId != null
        ? { ...l, spiItemId: saved[n++]?.id }
        : { ...l, spiItemId: undefined }));
      setLines(withIds);
      setRemovedLines([]);
      setUploaded({ invoice: res.invoice.invoice_file_name, eway: res.invoice.eway_file_name });
      setFiles({});
      if (res.warnings?.length) toast.warning('Billed above the order', res.warnings.join(' '));
      else toast.success('Invoice details saved', `${saved.length} product line${saved.length === 1 ? '' : 's'} matched against ${draft.poNumber || 'the order'}.`);
      advance();
    } catch (e) {
      toast.error('Could not save Stage 02', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const boxLines = lines.filter(l => l.spiItemId != null && l.spiQty > 0);

  const [nextBoxCodes, setNextBoxCodes] = useState<string[]>([]);

  const [placedBoxIds, setPlacedBoxIds] = useState<number[]>([]);
  const reloadBoxes = useCallback(async (id: number) => {
    const [list, codes, board] = await Promise.all([
      spiApi.boxes(id),
      spiApi.nextBoxCodes(id, 50).catch(() => [] as string[]),
      spiApi.putawayBoard(id).catch(() => null),
    ]);
    setBoxes(list);
    setNextBoxCodes(codes);
    setPlacedBoxIds((board?.boxes ?? []).filter(r => r.status === 'placed' || r.status === 'awaiting_scan').map(r => r.box_id));
    if (board) setPutaway({ placed: board.counts.placed, total: board.counts.total });
    return list;
  }, []);

  useEffect(() => {
    if (!spiId) return;
    let live = true;
    spiApi.putawayBoard(spiId)
      .then(b => { if (live) setPutaway({ placed: b.counts.placed, total: b.counts.total }); })
      .catch(() => {});
    return () => { live = false; };
  }, [spiId]);

  useEffect(() => {
    if (stage < 2 || !spiId) return;
    let live = true;
    setBoxesLoading(true);
    Promise.all([
      reloadBoxes(spiId),
      spiApi.productFlags(spiBranchId).then(f => { if (live) setFlagMaster(f); }).catch(() => {}),
    ])
      .catch(e => { if (live) toast.error('Could not load the boxes', e instanceof PoApiError ? e.firstError : 'Please try again.'); })
      .finally(() => { if (live) setBoxesLoading(false); });
    return () => { live = false; };
  }, [stage, spiId, spiBranchId, reloadBoxes, toast]);

  const boxLinesRef = useRef(boxLines);
  boxLinesRef.current = boxLines;
  const describeBoxField = (path: string, body?: SpiBoxBody) => {
    const parts = path.split('.');
    if (parts[0] === 'items' && /^\d+$/.test(parts[1] ?? '')) {
      const idx = Number(parts[1]);
      const item = body?.items[idx];
      const name = item ? boxLinesRef.current.find(l => l.spiItemId === item.supplier_invoice_item_id)?.spiName : undefined;
      const field = BOX_FIELD_LABEL[parts[2] ?? ''] ?? (parts[2] ?? 'details').replace(/_/g, ' ');
      return `${field} of ${name ? `"${name}"` : `product ${idx + 1}`}`;
    }
    return BOX_FIELD_LABEL[parts[0]] ?? parts[0].replace(/_/g, ' ');
  };
  const boxError = (e: unknown, body?: SpiBoxBody) => {
    if (!(e instanceof PoApiError)) return 'Please try again.';
    if ((e.status ?? 0) >= 500) return 'The server could not save it — nothing was changed. Please try again.';
    const [key, list] = Object.entries(e.fieldErrors ?? {})[0] ?? [];
    const raw = list?.[0] ?? e.message;
    const label = key ? describeBoxField(key, body) : null;
    if (!label) return raw;
    const cleaned = raw.replace(/^the\s+[\w.]+\s+field\s+/i, '').replace(/^the\s+[\w.]+\s+/i, '');
    return cleaned === raw ? `${label[0].toUpperCase()}${label.slice(1)}: ${raw}` : `The ${label} ${cleaned}`;
  };

  const createBox = useCallback(async (body: SpiBoxBody): Promise<SpiBox | null> => {
    if (!spiId) return null;
    try {
      const box = await spiApi.createBox(spiId, body);
      await reloadBoxes(spiId);
      toast.success(`${putId(box.box_code)} saved`, `${body.items.length} product${body.items.length === 1 ? '' : 's'} packed in this box.`);
      return box;
    } catch (e) {
      toast.error('Could not save the box', boxError(e, body));
      return null;
    }
  }, [spiId, reloadBoxes, toast]);

  const updateBox = useCallback(async (boxId: number, body: SpiBoxBody): Promise<SpiBox | null> => {
    if (!spiId) return null;
    try {
      const box = await spiApi.updateBox(spiId, boxId, body);
      await reloadBoxes(spiId);
      toast.success(`${putId(box.box_code)} updated`, `It now holds ${body.items.length} product${body.items.length === 1 ? '' : 's'}.`);
      return box;
    } catch (e) {
      toast.error('Could not update the box', boxError(e, body));
      return null;
    }
  }, [spiId, reloadBoxes, toast]);

  const loadBox = useCallback(async (boxId: number): Promise<SpiBox | null> => {
    if (!spiId) return null;
    try {
      const { box, flags } = await spiApi.box(spiId, boxId);
      if (box) setBoxes(list => list.map(b => (b.id === box.id ? box : b)));
      if (flags.length) {
        setFlagMaster(m => {
          const byId = new Map(m.map(f => [f.id, f]));
          for (const f of flags) byId.set(f.id, { ...byId.get(f.id), ...f });
          return [...byId.values()];
        });
      }
      return box;
    } catch {
      return null;
    }
  }, [spiId]);

  const deleteBoxPhoto = useCallback(async (boxId: number, attachmentId: number): Promise<boolean> => {
    if (!spiId) return false;
    try {
      await spiApi.deleteBoxPhoto(spiId, boxId, attachmentId);
      void reloadBoxes(spiId).catch(() => {});
      toast.success('Photo removed', 'It is no longer attached to this box.');
      return true;
    } catch (e) {
      toast.error('Could not remove the photo', boxError(e));
      return false;
    }
  }, [spiId, reloadBoxes, toast]);

  const deleteBoxes = useCallback(async (ids: number[]): Promise<boolean> => {
    if (!spiId) return false;
    let removed = 0;
    try {
      for (const id of ids) { await spiApi.deleteBox(spiId, id); removed++; }
      toast.success(`${removed} box${removed === 1 ? '' : 'es'} removed`, 'The product is back to Pending.');
      return true;
    } catch (e) {
      toast.error('Could not remove the box', boxError(e));
      return false;
    } finally {
      await reloadBoxes(spiId).catch(() => {});
    }
  }, [spiId, reloadBoxes, toast]);

  const unboxed = () => boxLines.filter(l => {
    const packed = boxes.reduce((n, b) => n + b.items
      .filter(i => i.supplier_invoice_item_id === l.spiItemId)
      .reduce((m, i) => m + (Number(i.quantity) || 0), 0), 0);
    return packed < l.spiQty - 0.0005;
  });

  const goNext = () => {
    if (viewOnly) {
      if (stage >= STAGES.length - 1) onClose(); else advance();
      return;
    }
    if (stage >= STAGES.length - 1) { void mapInvoice(); return; }
    if (putawayLocked) { advance(); return; }
    if (stage === 0) {
      if (isDirect && vaultTarget) {
        const supplierName = draft.legalName || draft.supplier;
        if (standardDocs && standardDocs.done < standardDocs.total) {
          setDocsNotice({ target: vaultTarget, supplier: supplierName, code: draft.supplierCode, section: standardDocs });
          return;
        }
        if (ctcPending.length) {
          setDocsNotice({ target: vaultTarget, supplier: supplierName, code: draft.supplierCode, pending: ctcPending });
          return;
        }
      }
      void saveStage1();
      return;
    }
    if (stage === 1) { void saveStage2(); return; }
    if (stage === 2) {
      const left = unboxed();
      if (left.length) {
        toast.warning(
          `${left.length} product${left.length === 1 ? ' is' : 's are'} not fully boxed`,
          `Box every unit before moving on: ${left.map(l => l.spiName).join(', ')}.`,
        );
        return;
      }
      if (spiId) { void finishStage3(); return; }
    }
    advance();
  };
  const allPlaced = !!putaway && putaway.total > 0 && putaway.placed >= putaway.total;
  const mapBlocked = !viewOnly && stage === STAGES.length - 1 && !allPlaced;
  const putawayLocked = !viewOnly && allPlaced;
  const mapHint = mapBlocked
    ? (putaway && putaway.total > 0
        ? `Put away every box first — ${putaway.placed} of ${putaway.total} placed`
        : 'Put away every box first')
    : stage === 1 && lines.length === 0
      ? 'Add at least one product before continuing'
      : undefined;

  const finishStage3 = async () => {
    if (!spiId || saving) return;
    setSaving(true);
    try {
      await spiApi.completeStage3(spiId);
      advance();
    } catch (e) {
      toast.error('Could not finish Stage 03', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const mapInvoice = async () => {
    if (!spiId || saving || !allPlaced) return;
    setSaving(true);
    try {
      await spiApi.submit(spiId);
      toast.success(`${spiCode ?? 'Invoice'} mapped`, 'Every box is put away and the invoice is closed for Stage 04.');
      onClose();
    } catch (e) {
      toast.error('Could not map the invoice', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const directDocsStage = isDirect && stage === 0 && !viewOnly;
  const standardDocs = draft.legal?.sections?.[0] ?? null;
  const vaultTarget = useMemo(
    () => (draft.supplierDetail ? vaultTargetOf(draft.supplierDetail) as SupplierDocsNotice['target'] : null),
    [draft.supplierDetail],
  );
  const ctcPending = useMemo(() => pendingCaseToCase(draft.vault ?? null, null), [draft.vault]);
  const docsPending = directDocsStage && !!standardDocs && standardDocs.done < standardDocs.total && !!vaultTarget?.db_id;
  const ctcFooter = directDocsStage && ctcPending.length > 0 && !!vaultTarget?.db_id;
  const [docsNotice, setDocsNotice] = useState<SupplierDocsNotice | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const refreshVault = useCallback(() => {
    if (!draft.vendorId) return;
    poLookupApi.supplierVault(draft.vendorId)
      .then(v => set({ vault: v, legal: legalFromVault(v) }))
      .catch(() => {});
  }, [draft.vendorId, set]);

  const stage1Gate = useMemo(() => {
    if (!isDirect || stage !== 0 || viewOnly || !draft.supplier) return null;
    const gst = gstState(draft.supplier, draft.scrutinyDate, draft.filingDate, 'invoice');
    if (gst.tone === 'stop') {
      return `${draft.supplier}'s GST scrutiny is out of date. Refresh it on the supplier record before this invoice can move on.`;
    }
    if (gst.tone === 'warn' && gstApproval?.status !== 'approved') {
      return gstApproval?.status === 'pending'
        ? `Waiting for ${gstApproval.requested_to_name ?? 'the senior'} to approve ${draft.supplier}'s overdue GST return.`
        : `${draft.supplier}'s last GST return is out of date. It needs a senior's approval before this invoice can move on.`;
    }
    return null;
  }, [isDirect, stage, viewOnly, draft.supplier, draft.scrutinyDate, draft.filingDate, draft.vault, gstApproval]);

  const noProducts = stage === 1 && lines.length === 0;
  const nextBlocked = viewOnly ? poLoading : saving || mapBlocked || !!stage1Gate || noProducts || (stage === 0 && (poLoading || directSupLoading || !!poError)) || (stage === 2 && boxesLoading);
  const closeForm = async () => {
    const picked = draft.supplierCode.trim();
    if (stage === 0 && !viewOnly && picked && picked !== mappedSupplier.current) {
      const supplierLine = draft.supplier ? `${picked} — ${draft.supplier}` : picked;
      const ok = await confirm({
        title: 'Close without mapping this supplier?',
        message: <>
          <span
            title={supplierLine}
            style={{
              display: 'block', margin: '0 0 9px', fontWeight: 700, color: '#0f172a',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >{supplierLine}</span>
          Selected but not saved, so it is not mapped to this invoice.
          Close now and the choice is discarded.
        </>,
        tone: 'danger',
        confirmLabel: 'Close anyway',
        cancelLabel: 'Keep editing',
      });
      if (!ok) return;
    }
    onClose();
  };

  const goBack = () => setStage(stage - 1);

  const step1Busy = stage === 0 && (directSupLoading || supplierBusy);

  /* Save & Next in flight — the step shows the form shimmer until the next
     one opens. This is the Create PO wizard's `advancing`, done its way:

       · ONE shimmer, not a skeleton of the step being opened. The PO draws
         the same two-section PoFormSkeleton every time, whichever step is
         coming, so it is always the right height for the body it fills. A
         per-stage skeleton is a different height from the step it replaces,
         which is how the page came to end halfway down.
       · no delay before it appears, and no moving the step rail. The PO does
         neither, and both were my inventions.

     It is derived rather than held in state: a save on any step but the last
     IS an advance. Only `mapInvoice` saves from the last step, and that one
     closes the form rather than opening another step, so it must not shimmer.

     The step stays mounted underneath (hidden, not removed), so a save that
     fails brings it back exactly as it was left — the PO's rule too. */
  const advancing = saving && stage < STAGES.length - 1;

  const isLast = stage === STAGES.length - 1;
  const stageLabel = (i: number) =>
    (isDirect && (matchedToPi ? DIRECT_STAGES[i] : UNMATCHED_STAGES[i])) || STAGES[i];

  return createPortal(
    <div className="spi-dt-overlay cpf-form spi-invform">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Supplier Purchase Invoice</div>
                <div className="spi-dt-head-sub">
                  {viewOnly
                    ? `Viewing ${spiCode ?? invoiceNo} · view only`
                    : editing
                      ? `Editing ${spiCode ?? invoiceNo}${spiStatus.label ? ` · ${spiStatus.label}` : ''}`
                      : 'Draft · not yet mapped'}
                </div>
              </div>
            </div>

            <div className="spi-dt-pills">
              <HeadPill icon={<IcoRefLines />} label="INVOICE NO" value={spiCode ?? invoiceNo} mono />
              <span className="spi-dt-dots">⋮</span>
              {isDirect ? (() => {
                const pills = [
                  draft.shipmentId
                    ? { key: 'ship', icon: <IcoVan />, label: 'SHIPMENT ID', value: draft.shipmentId, mono: true }
                    : null,
                  { key: 'proc', icon: <IcoBriefcase />, label: 'PROCUREMENT CASE ID', value: draft.procurementCode || '—', mono: true },
                  { key: 'sup', icon: <IcoUser />, label: 'SUPPLIER', value: draft.supplier || input.supplier },
                  { key: 'wh', icon: <IcoWarehouse />, label: 'WAREHOUSE', value: savedWarehouse ?? warehouseLabel(input.storage) },
                ].filter((p): p is NonNullable<typeof p> => p !== null);
                return pills.map((p, i) => (
                  <Fragment key={p.key}>
                    <HeadPill icon={p.icon} label={p.label} value={p.value} mono={p.mono} alt={i % 2 === 0} />
                    {i < pills.length - 1 && <span className="spi-dt-dots">⋮</span>}
                  </Fragment>
                ));
              })() : (
                <>
                  <HeadPill icon={<IcoRefLines />} label="PO NUMBER" value={input.poNo ?? '—'} alt mono />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoUser />} label="SUPPLIER" value={draft.supplier || input.supplier} />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={savedWarehouse ?? warehouseLabel(input.storage)} alt />
                </>
              )}
            </div>

            <div className="spi-dt-head-r">
              <button type="button" className="spi-dt-btn-close" onClick={() => void closeForm()} disabled={saving}
                title={saving ? 'Saving — please wait' : undefined}><IcoX /> Close</button>
            </div>
          </div>

          <div className="spi-dt-steps cpf-steps4">
            {STAGES.map((s, i) => (
              /* Off while saving: Tooltip wraps an aria-disabled trigger in an
                 inline-flex span, which pulls the card out of the grid (it
                 shrinks to its text) and makes it :last-child (it loses its
                 arrow) for the length of the save. */
              <Tooltip
                key={s.title}
                label={i <= reached ? `Go to Step ${i + 1}` : 'Finish the current step first'}
                position="bottom"
                disabled={saving}
              >
              <div
                className={`spi-dt-step spi-dt-step--nav ${i === stage ? 'is-active' : ''} ${i < stage ? 'is-done' : ''}${saving ? ' is-busy' : ''}`}
                role="button"
                aria-disabled={saving}
                tabIndex={saving ? -1 : 0}
                onClick={() => goTo(i)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } }}
              >
                <div className="spi-dt-step-top">
                  <span className="spi-dt-step-lbl">STEP {pad2(i + 1)}</span>
                  {i === stage && <span className="spi-dt-step-badge">ACTIVE</span>}
                  {i < stage && <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck size={9} stroke={3.2} /> DONE</span>}
                </div>
                <div className="spi-dt-step-big">{pad2(i + 1)}</div>
                <div className="spi-dt-step-title">{stageLabel(i).title}</div>
                <div className="spi-dt-step-desc">{stageLabel(i).desc}</div>
                <span className="spi-dt-step-ghost">{pad2(i + 1)}</span>
              </div>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="spi-dt-body" inert={saving}>
          {poLoading || (stage === 2 && boxesLoading) ? (
            <StageSkeleton stage={stage} />
          ) : (
            <>
              {(advancing || step1Busy) && <StageSkeleton stage={0} />}
              <div className="cpf-stepwrap" hidden={advancing || step1Busy}>
                {viewOnly && (
                  <div className="cpf-viewonly-banner">
                    <IcoLock /> <b>View only.</b>{' '}
                    This invoice is {spiStatus.label || spiStatus.status}, so it can no longer be changed — every step is still here to read.
                  </div>
                )}
                {putawayLocked && (
                  <div className="cpf-viewonly-banner">
                    <IcoLock /> <b>Put-away complete.</b>{' '}
                    Every box is on its shelf, so the invoice, its boxes and their locations are view only — Map Invoice to finish.
                  </div>
                )}
                {stage === 0 && (
                  <Step1SupplierDetails draft={draft} set={set} error={poError} readOnly={viewOnly} direct={isDirect}
                    directSupplier={input.direct
                      ? { code: input.direct.supplierCode, name: input.supplier }
                      : undefined}
                    onResolved={() => setDirectSupLoading(false)}
                    poId={input.poId ?? null}
                    approval={gstApproval}
                    onApprovalSent={reloadApproval}
                    onBusy={setSupplierBusy}
                    spiId={spiId}
                    onRequestApproval={spiId ? requestSpiApproval : undefined} />
                )}
                {stage === 1 && (
                  <Step2InvoiceProducts draft={draft} set={set} lines={lines} taxMode={taxMode} onPickFile={pickFile} readOnly={viewOnly || putawayLocked}
                    matched={matchedToPi}
                    onChangeLine={changeLine} onRemoveLine={removeLine} onAddLine={addLine}
                    removedCount={removedLines.length} onRestoreLines={restoreLines} direct={isDirect} />
                )}
                {stage === 2 && (
                  <Step3BoxPackaging
                    draft={draft}
                    direct={isDirect}
                    lines={spiId ? boxLines : lines}
                    boxes={boxes}
                    nextBoxCodes={nextBoxCodes}
                    flagMaster={flagMaster}
                    onFlagsChanged={() => { spiApi.productFlags().then(setFlagMaster).catch(() => {}); }}
                    readOnly={viewOnly || putawayLocked}
                    onCreateBox={spiId ? createBox : undefined}
                    onUpdateBox={spiId ? updateBox : undefined}
                    onDeleteBoxes={spiId ? deleteBoxes : undefined}
                    onDeleteBoxPhoto={spiId ? deleteBoxPhoto : undefined}
                    placedBoxIds={placedBoxIds}
                    onLoadBox={spiId ? loadBox : undefined}
                    spiId={spiId}
                    spiCode={spiCode}
                  />
                )}
                {stage === 3 && (
                  <Step4PutawayAllocation draft={draft} boxes={boxes} lines={spiId ? boxLines : lines}
                    flagMaster={flagMaster} spiId={spiId} direct={isDirect}
                    warehouse={savedWarehouse ?? warehouseLabel(input.storage)}
                    spiCode={spiCode}
                    onProgress={onPutawayProgress}
                    onLoadBox={spiId ? loadBox : undefined}
                    warehouseInfo={{
                      code: warehouseRow?.wh_code ?? input.storage.warehouse?.code ?? null,
                      since: warehouseRow?.created_at ?? null,
                      name: warehouseRow?.wh_name ?? savedWarehouse ?? warehouseLabel(input.storage),
                      address: warehouseRow?.address ?? null,
                      location: warehouseRow
                        ? [warehouseRow.city, warehouseRow.state, warehouseRow.pincode].filter(Boolean).join(', ') || null
                        : input.storage.warehouse?.location ?? null,
                      typeLabel: warehouseRow?.wh_type_label ?? null,
                      areaSqft: warehouseRow?.area_sqft ?? null,
                      own: input.storage.type === 'own',
                    }}
                    readOnly={viewOnly} />
                )}
              </div>
            </>
          )}
        </div>

        <div className="spi-dt-foot">
          <div className="spi-dt-foot-l">
            <div>
              <div className="spi-dt-foot-step">STEP {pad2(stage + 1)} OF {pad2(STAGES.length)}</div>
              <div className="spi-dt-foot-name">{stageLabel(stage).title}</div>
            </div>
            <div className="spi-dt-dots">
              {STAGES.map((s, i) => (
                <span key={s.title} className={i === stage ? 'on' : i < stage ? 'done' : ''} />
              ))}
            </div>
          </div>
          <div className="spi-dt-foot-r">
            {stage > 0 && (
              <button type="button" className="spi-dt-btn-ghost" onClick={goBack} disabled={saving}>
                <IcoChevronL /> Back
              </button>
            )}
            {docsPending && (
              <button type="button" className="spi-dt-btn-ghost cpf-foot-docs" onClick={() => setVaultOpen(true)} disabled={saving}>
                <IcoShield /> Evidence Vault
                <span className="cpf-foot-docs__n">{standardDocs!.total - standardDocs!.done} pending</span>
              </button>
            )}
            {!docsPending && ctcFooter && vaultTarget && (
              <button type="button" className="spi-dt-btn-ghost cpf-foot-docs" disabled={saving}
                title="Documents of this supplier's earlier orders are still unsigned"
                onClick={() => setDocsNotice({
                  target: vaultTarget, supplier: draft.legalName || draft.supplier,
                  code: draft.supplierCode, pending: ctcPending,
                })}>
                <IcoShield /> Case to Case
                <span className="cpf-foot-docs__n">{ctcPending.length} unsigned</span>
              </button>
            )}
            <button
              type="button"
              className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
              disabled={nextBlocked}
              title={stage1Gate ?? mapHint}
              aria-busy={saving}
            >
              {saving ? <WizSpinner /> : isLast ? <IcoCheck /> : null}
              {viewOnly ? (isLast ? 'Close' : 'Next')
                : isLast ? (editing ? 'Update Invoice' : 'Map Invoice')
                : saving ? 'Saving…' : putawayLocked ? 'Next' : editing ? 'Update & Next' : 'Save & Next'}
              {!isLast && !saving && <IcoChevronR />}
            </button>
          </div>
        </div>
      </div>
      {docsNotice && (
        <SupplierDocsNoticeModal notice={docsNotice} onClose={() => setDocsNotice(null)} onVaultChange={refreshVault} />
      )}
      {vaultOpen && vaultTarget && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal open supplier={vaultTarget as never} onVaultChange={refreshVault} onClose={() => setVaultOpen(false)} />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}

function SkHead() {
  return (
    <div className="spi-dt-sec-head" style={{ cursor: 'default' }}>
      <div className="spi-dt-sk spi-dt-sk-ico" />
      <div className="spi-dt-sec-mid">
        <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 200 }} />
        <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 280, height: 8, marginTop: 7 }} />
      </div>
    </div>
  );
}

function SkFields({ count }: { count: number }) {
  return (
    <div className="spi-dt-grid4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 84, height: 8, marginBottom: 9 }} />
          <div className="spi-dt-sk spi-dt-sk-field" />
        </div>
      ))}
    </div>
  );
}

function SkRows({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="spi-dt-sk spi-dt-sk-field" style={{ height: 34 }} />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="spi-dt-sk spi-dt-sk-field" style={{ height: 52 }} />
      ))}
    </div>
  );
}

function SkSection({ children }: { children: ReactNode }) {
  return (
    <div className="spi-dt-sec" aria-busy="true">
      <SkHead />
      <div className="spi-dt-sec-body">{children}</div>
    </div>
  );
}

function SkRecap() {
  return (
    <div className="spi-dt-sec" aria-busy="true">
      <SkHead />
    </div>
  );
}

function SkStage4() {
  return (
    <>
      <SkRecap />
      <SkRecap />
      <div className="spi-dt-sk-s4steps">
        {[0, 1, 2, 3].map(i => (
          <div className="spi-dt-sk-s4step" key={i}>
            <div className="spi-dt-sk" style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 46, height: 7 }} />
              <div className="spi-dt-sk spi-dt-sk-line" style={{ width: '62%', height: 10, marginTop: 8 }} />
              <div className="spi-dt-sk spi-dt-sk-line" style={{ width: '88%', height: 7, marginTop: 7 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="spi-dt-sk-s4rail">
        {[108, 196, 232, 198, 158].map((w, i) => (
          <div className="spi-dt-sk" key={i} style={{ width: w, height: 34, borderRadius: 999 }} />
        ))}
        <div className="spi-dt-sk spi-dt-sk-s4fv" />
      </div>
      <div className="spi-dt-sk-s4panels">
        <div className="spi-dt-sk-s4panel spi-dt-sk-s4panel--l">
          <div className="spi-dt-sk-s4head">
            <div className="spi-dt-sk" style={{ width: 26, height: 26, borderRadius: 8 }} />
            <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 90 }} />
            <div className="spi-dt-sk" style={{ width: 58, height: 20, borderRadius: 999, marginLeft: 'auto' }} />
          </div>
          <div className="spi-dt-sk-s4body">
            <div className="spi-dt-sk" style={{ height: 46, borderRadius: 10, flexShrink: 0 }} />
            {[0, 1, 2, 3].map(i => (
              <div className="spi-dt-sk" key={i} style={{ height: 118, borderRadius: 12, flexShrink: 0 }} />
            ))}
          </div>
        </div>
        <div className="spi-dt-sk-s4panel spi-dt-sk-s4panel--r">
          <div className="spi-dt-sk-s4head">
            <div className="spi-dt-sk" style={{ width: 26, height: 26, borderRadius: 8 }} />
            <div className="spi-dt-sk spi-dt-sk-line" style={{ width: 180 }} />
            <div className="spi-dt-sk" style={{ width: 102, height: 30, borderRadius: 9, marginLeft: 'auto' }} />
          </div>
          <div className="spi-dt-sk-s4band">
            {[0, 1, 2].map(i => <div className="spi-dt-sk spi-dt-sk-s4bandcard" key={i} />)}
          </div>
          <div className="spi-dt-sk-s4body">
            <div className="spi-dt-sk" style={{ height: 96, borderRadius: 12, flexShrink: 0 }} />
            <div className="spi-dt-sk" style={{ height: 150, borderRadius: 12, flexShrink: 0 }} />
            <div className="spi-dt-sk" style={{ height: 110, borderRadius: 12, flexShrink: 0 }} />
            <div className="spi-dt-sk" style={{ height: 132, borderRadius: 12, flexShrink: 0 }} />
          </div>
        </div>
      </div>
    </>
  );
}

function StageSkeleton({ stage }: { stage: number }) {
  if (stage === 1) {
    return (
      <>
        <SkRecap />
        <SkSection><SkFields count={4} /></SkSection>
        <SkSection><SkRows count={3} /></SkSection>
      </>
    );
  }
  if (stage === 2) {
    return (
      <>
        <SkRecap />
        <SkSection>
          <div className="spi-dt-grid4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[0, 1, 2].map(i => <div key={i} className="spi-dt-sk spi-dt-sk-field" style={{ height: 120 }} />)}
          </div>
        </SkSection>
        <SkSection><SkRows count={3} /></SkSection>
      </>
    );
  }
  if (stage >= 3) return <SkStage4 />;
  return (
    <>
      <SkSection><SkFields count={8} /></SkSection>
      <SkSection>
        <SkFields count={5} />
        <div style={{ height: 16 }} />
        <SkFields count={8} />
      </SkSection>
    </>
  );
}

function warehouseLabel(storage: StorageChoice): string {
  if (storage.type === 'third-party') return 'Third Party Warehouse';
  return storage.warehouse?.name ?? '—';
}
