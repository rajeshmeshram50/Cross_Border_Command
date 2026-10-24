import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import Tooltip from '../../../../components/ui/Tooltip';
import '../../p2p-detail.css';
import '../order/create-po/create-po.css';
import './invoice-form.css';
import { HeadPill } from '../order/create-po/CreatePoForm';
import { WizSpinner } from '../order/create-po/form-fields';
import {
  IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLines, IcoLock, IcoUser, IcoWarehouse, IcoX,
} from '../../icons';
import Step1SupplierDetails from './steps/Step1SupplierDetails';
import Step2InvoiceProducts from './steps/Step2InvoiceProducts';
import Step3BoxPackaging from './steps/Step3BoxPackaging';
import Step4PutawayAllocation from './steps/Step4PutawayAllocation';
import { draftFromPo, useInvoiceDraft } from './invoice-draft';
import { PoApiError, poApi, poLookupApi } from '../order/api/po-api';
import { legalFromVault } from '../order/create-po/supplier-checks';
import { useToast } from '../../../../contexts/ToastContext';
import { putId, spiApi, type ProductFlagOption, type SpiBox, type SpiBoxBody, type WarehouseDetail } from './spi-api';
import { SPI_STATUS_LABELS, spiViewOnlyReason } from './types';
import {
  DEFAULT_HOME_STATE_CODE, PRODUCT_LINES, itemsPayload, linesFromPo, taxModeFor,
  type ProductLine, type SpiPoOpen,
} from './invoice-products';
import type { StorageChoice } from './StorageSelectionModal';

const STAGES = [
  { title: 'Supplier Details', desc: 'Link the PO and confirm supplier details' },
  { title: 'Invoice & Product Details (3-Way Match)', desc: 'Enter invoice details & match products against the PO & GRN' },
  { title: 'Temporary Box Packaging', desc: 'Choose a packaging scenario and generate labelled, verified boxes' },
  { title: 'Temporary Putaway Allocation', desc: 'Assign a temporary putaway location for each product' },
] as const;

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
  const { draft, set } = useInvoiceDraft({ supplier: input.supplier, poNo: input.poNo });
  const toast = useToast();

  const [poLoading, setPoLoading] = useState(!!(input.poId || input.spiId));
  const [poError, setPoError] = useState<string | null>(null);
  const [lines, setLines] = useState<ProductLine[]>(input.poId || input.spiId ? [] : PRODUCT_LINES);
  const [files, setFiles] = useState<{ invoice_file?: File | null; eway_file?: File | null }>({});
  const [uploaded, setUploaded] = useState<{ invoice?: string | null; eway?: string | null }>({});
  const [spiId, setSpiId] = useState<number | null>(null);
  const [spiCode, setSpiCode] = useState<string | null>(input.invoiceNo ?? null);
  const [saving, setSaving] = useState(false);
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
          if (existing.warehouse?.wh_name) setSavedWarehouse(existing.warehouse.wh_name);
          if (existing.warehouse?.id) setSavedWarehouseId(existing.warehouse.id);
          setSpiStatus({ status: existing.status, label: SPI_STATUS_LABELS[existing.status] ?? existing.status });
          setSpiBranchId(existing.branch_id ?? null);
          /* Resume where the work stopped.

             stage_completed counts FINISHED stages, so it is also the index
             of the first unfinished one: 2 finished means index 2, Box
             Packaging. Clamped to the last stage for a submitted invoice
             (stage_completed 4), which has no index 4 to land on.

             Both pieces of state are set from it on purpose — `reached` is
             how far the user MAY jump, `stage` is where they ARE. Only the
             first was restored, so every reopen started at Supplier Details
             however much had been done. */
          const resumeAt = Math.min(Math.max(0, existing.stage_completed), STAGES.length - 1);
          setReached(resumeAt);
          setStage(resumeAt);
        }
        if (!poId) {
          setPoError('This invoice is not linked to a purchase order.');
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

        if (po.vendor_id) {
          poLookupApi.supplierVault(po.vendor_id)
            .then(v => { if (live) set({ legal: legalFromVault(v) }); })
            .catch(() => { if (live) set({ legal: legalFromVault(null) }); });
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

  const changeLine = useCallback((index: number, patch: Partial<ProductLine>) => {
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const [stage, setStage] = useState(0);
  const [reached, setReached] = useState(0);

  useScrollLock(true, '.spi-dt-overlay');

  const goTo = (i: number) => { if (i <= reached) setStage(i); };
  const advance = () => {
    const next = stage + 1;
    setStage(next);
    setReached(r => Math.max(r, next));
  };

  const saveStage1 = async () => {
    if (spiId) { advance(); return; }
    if (!draft.vendorId) {
      toast.warning('Supplier not loaded', 'The purchase order has no supplier to raise this invoice against.');
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

  const reloadBoxes = useCallback(async (id: number) => {
    const [list, codes] = await Promise.all([
      spiApi.boxes(id),
      spiApi.nextBoxCodes(id, 50).catch(() => [] as string[]),
    ]);
    setBoxes(list);
    setNextBoxCodes(codes);
    return list;
  }, []);

  useEffect(() => {
    if (stage !== 2 || !spiId) return;
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
    if (stage >= STAGES.length - 1) return;
    if (stage === 0) { void saveStage1(); return; }
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
    }
    advance();
  };
  const nextBlocked = viewOnly ? poLoading : saving || (stage === 0 && (poLoading || !!poError)) || (stage === 2 && boxesLoading);
  const goBack = () => (stage === 0 ? onClose() : setStage(stage - 1));

  const isLast = stage === STAGES.length - 1;

  return createPortal(
    <div className="spi-dt-overlay cpf-form">
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
              <HeadPill icon={<IcoLines />} label="INVOICE NO" value={spiCode ?? invoiceNo} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value={input.poNo ?? '—'} alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={draft.supplier || input.supplier} />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={savedWarehouse ?? warehouseLabel(input.storage)} alt />
            </div>

            <div className="spi-dt-head-r">
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>

          <div className="spi-dt-steps cpf-steps4">
            {STAGES.map((s, i) => (
              /* The shared pill, not the browser's own tooltip. `title` drew
                 the OS one — a plain white box in a different font, after the
                 browser's own delay — so this was the one control on the page
                 whose hover did not look like the rest of the app. */
              <Tooltip
                key={s.title}
                label={i <= reached ? `Go to Step ${i + 1}` : 'Finish the current step first'}
                position="bottom"
              >
              <div
                className={`spi-dt-step spi-dt-step--nav ${i === stage ? 'is-active' : ''} ${i < stage ? 'is-done' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => goTo(i)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } }}
              >
                <div className="spi-dt-step-top">
                  <span className="spi-dt-step-lbl">STEP {pad2(i + 1)}</span>
                  {i === stage && <span className="spi-dt-step-badge">ACTIVE</span>}
                  {i < stage && <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck size={9} stroke={3.2} /> DONE</span>}
                </div>
                <div className="spi-dt-step-big">{pad2(i + 1)}</div>
                <div className="spi-dt-step-title">{s.title}</div>
                <div className="spi-dt-step-desc">{s.desc}</div>
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
              {saving && <StageSkeleton stage={stage + 1} />}
              <div className="cpf-stepwrap" hidden={saving}>
                {viewOnly && (
                  <div className="cpf-viewonly-banner">
                    <IcoLock /> <b>View only.</b>{' '}
                    This invoice is {spiStatus.label || spiStatus.status}, so it can no longer be changed — every step is still here to read.
                  </div>
                )}
                {stage === 0 && <Step1SupplierDetails draft={draft} set={set} error={poError} />}
                {stage === 1 && (
                  <Step2InvoiceProducts draft={draft} set={set} lines={lines} taxMode={taxMode} onPickFile={pickFile} readOnly={viewOnly}
                    onChangeLine={changeLine} />
                )}
                {stage === 2 && (
                  <Step3BoxPackaging
                    draft={draft}
                    lines={spiId ? boxLines : lines}
                    boxes={boxes}
                    nextBoxCodes={nextBoxCodes}
                    flagMaster={flagMaster}
                    onFlagsChanged={() => { spiApi.productFlags().then(setFlagMaster).catch(() => {}); }}
                    readOnly={viewOnly}
                    onCreateBox={spiId ? createBox : undefined}
                    onUpdateBox={spiId ? updateBox : undefined}
                    onDeleteBoxes={spiId ? deleteBoxes : undefined}
                    spiId={spiId}
                    spiCode={spiCode}
                  />
                )}
                {stage === 3 && (
                  <Step4PutawayAllocation draft={draft} boxes={boxes} lines={spiId ? boxLines : lines}
                    flagMaster={flagMaster} spiId={spiId}
                    warehouse={savedWarehouse ?? warehouseLabel(input.storage)}
                    spiCode={spiCode}
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
              <div className="spi-dt-foot-name">{STAGES[stage].title}</div>
            </div>
            <div className="spi-dt-dots">
              {STAGES.map((s, i) => (
                <span key={s.title} className={i === stage ? 'on' : i < stage ? 'done' : ''} />
              ))}
            </div>
          </div>
          <div className="spi-dt-foot-r">
            {/* Leaving the step mid-save would walk away from a request that
                is still going to land, so Back waits with everything else. */}
            <button type="button" className="spi-dt-btn-ghost" onClick={goBack} disabled={saving}>
              <IcoChevronL /> {stage === 0 ? 'Change Selection' : 'Back'}
            </button>
            <button
              type="button"
              className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
              disabled={nextBlocked}
              aria-busy={saving}
            >
              {/* "Saving…" on its own is a word change on a button that has
                  just gone grey — easy to miss, and on a quick save easy to
                  doubt it happened. The button turns instead. */}
              {saving ? <WizSpinner /> : isLast ? <IcoCheck /> : null}
              {viewOnly ? (isLast ? 'Close' : 'Next')
                : isLast ? (editing ? 'Update Invoice' : 'Map Invoice')
                : saving ? 'Saving…' : editing ? 'Update & Next' : 'Save & Next'}
              {!isLast && !saving && <IcoChevronR />}
            </button>
          </div>
        </div>
      </div>
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
