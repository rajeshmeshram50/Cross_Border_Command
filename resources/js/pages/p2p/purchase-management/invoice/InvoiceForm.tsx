import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import '../../p2p-detail.css';
import '../order/create-po/create-po.css';
import './invoice-form.css';
import { HeadPill } from '../order/create-po/CreatePoForm';
import {
  IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLines, IcoUser, IcoWarehouse, IcoX,
} from '../../icons';
import Step1SupplierDetails from './steps/Step1SupplierDetails';
import Step2InvoiceProducts from './steps/Step2InvoiceProducts';
import Step3BoxPackaging from './steps/Step3BoxPackaging';
import { draftFromPo, useInvoiceDraft } from './invoice-draft';
import { PoApiError, poApi, poLookupApi } from '../order/api/po-api';
import { legalFromVault } from '../order/create-po/supplier-checks';
import { useToast } from '../../../../contexts/ToastContext';
import { spiApi } from './spi-api';
import {
  DEFAULT_HOME_STATE_CODE, PRODUCT_LINES, itemsPayload, linesFromPo, taxModeFor, type ProductLine,
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
  poId?: number;
  poNo?: string;
  supplier: string;
  storage: StorageChoice;
  invoiceNo?: string;
}

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
          setReached(Math.min(Math.max(0, existing.stage_completed), STAGES.length - 1));
        }
        if (!poId) {
          setPoError('This invoice is not linked to a purchase order.');
          return;
        }
        const [po, openLines] = await Promise.all([
          poApi.show(poId),
          spiApi.poLines(poId, existing?.id).catch(() => []),
        ]);
        const open: Record<number, number> = {};
        for (const l of openLines) open[l.po_item_id] = l.qty_open;
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

  const goNext = () => {
    if (stage >= STAGES.length - 1) return;
    if (stage === 0) { void saveStage1(); return; }
    if (stage === 1) { void saveStage2(); return; }
    advance();
  };
  const nextBlocked = saving || (stage === 0 && (poLoading || !!poError));
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
                <div className="spi-dt-head-sub">Draft · not yet mapped</div>
              </div>
            </div>

            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="INVOICE NO" value={spiCode ?? invoiceNo} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value={input.poNo ?? '—'} alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={draft.supplier || input.supplier} />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={warehouseLabel(input.storage)} alt />
            </div>

            <div className="spi-dt-head-r">
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>

          <div className="spi-dt-steps cpf-steps4">
            {STAGES.map((s, i) => (
              <div
                key={s.title}
                className={`spi-dt-step spi-dt-step--nav ${i === stage ? 'is-active' : ''} ${i < stage ? 'is-done' : ''}`}
                role="button"
                tabIndex={0}
                title={i <= reached ? `Go to Step ${i + 1}` : 'Finish the current step first'}
                onClick={() => goTo(i)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } }}
              >
                <div className="spi-dt-step-top">
                  <span className="spi-dt-step-lbl">STEP {pad2(i + 1)}</span>
                  {i === stage && <span className="spi-dt-step-badge">ACTIVE</span>}
                  {i < stage && <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
                </div>
                <div className="spi-dt-step-big">{pad2(i + 1)}</div>
                <div className="spi-dt-step-title">{s.title}</div>
                <div className="spi-dt-step-desc">{s.desc}</div>
                <span className="spi-dt-step-ghost">{pad2(i + 1)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spi-dt-body" inert={saving}>
          {poLoading ? (
            <StageSkeleton stage={stage} />
          ) : (
            <>
              {saving && <StageSkeleton stage={stage + 1} />}
              <div className="cpf-stepwrap" hidden={saving}>
                {stage === 0 && <Step1SupplierDetails draft={draft} set={set} error={poError} />}
                {stage === 1 && (
                  <Step2InvoiceProducts draft={draft} set={set} lines={lines} taxMode={taxMode} onPickFile={pickFile}
                    onChangeLine={changeLine} />
                )}
                {stage === 2 && <Step3BoxPackaging draft={draft} lines={lines} />}
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
            <button type="button" className="spi-dt-btn-ghost" onClick={goBack}>
              <IcoChevronL /> {stage === 0 ? 'Change Selection' : 'Back'}
            </button>
            <button
              type="button"
              className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
              disabled={nextBlocked}
            >
              {isLast && <IcoCheck />}
              {isLast ? 'Map Invoice' : saving ? 'Saving…' : 'Save & Next'}
              {!isLast && <IcoChevronR />}
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
  if (stage >= 3) {
    return (
      <>
        <SkRecap />
        <SkSection><SkRows count={4} /></SkSection>
      </>
    );
  }
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
