// Create PO — full-page form shell. The wizard chrome reuses the shared
// spi-dt-* classes; create-po.css holds only what differs for this form.
// Each "Save & Next" saves its stage through po-api before moving on, so a PO
// is a real draft from Step 01 onwards and Edit PO reopens exactly what was saved.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import Step1LinkSupplier from './steps/Step1LinkSupplier';
import Step2ProductDetails from './steps/Step2ProductDetails';
import Step3Terms from './steps/Step3Terms';
import Step4Documents from './steps/Step4Documents';
import { draftFromDetail, itemsBody, rowFromPi, stage1Body, usePoDraft } from './po-draft';
import { gstCheck } from './gst-check';
import { legalFromVault } from './supplier-checks';
import { usePoLookups, type PoLookups } from './use-po-lookups';
import GstNoticeModal, { type GstNotice } from './GstNoticeModal';
import { PoApiError, poApi, poLookupApi, type PoDetail, type ShipmentOption, type TaxMode } from '../api/po-api';
import { useToast } from '../../../../../contexts/ToastContext';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './create-po.css';
import { IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLines, IcoShip, IcoTarget, IcoUser, IcoX } from '../shared/icons';

// What the Create PO popup passes in: how this PO is linked. `editId` is set
// when Edit PO opens an existing order in this same form.
export type PoLink = {
  mode: 'with' | 'without';
  shipment?: ShipmentOption;
  editId?: number;
};

/** What every step needs besides the draft. */
export type StepCtx = {
  lookups: PoLookups;
  /** Decided by the server on Stage 01 save (supplier state vs branch state). */
  taxMode: TaxMode;
  piCode: string | null;
  detail: PoDetail | null;
};

type Stage = { title: string; desc: string };

const STAGES: Stage[] = [
  { title: 'PO Link Supplier Details', desc: 'Confirm the supplier for this PO' },
  { title: 'PO Product Details', desc: 'Add products, quantities & pricing' },
  { title: 'PO Terms & Conditions', desc: 'Define payment & delivery terms' },
  { title: 'Post PO Trade Document Management', desc: 'Generate, e-sign & track documents' },
];

// The primary button changes meaning on the last two stages.
const NEXT_LABEL = ['Save & Next', 'Save & Next', 'Submit PO & Next', 'Generate Purchase Order'];

type Props = {
  link: PoLink;
  onClose: () => void;
  onChangeLink: () => void;
};

export default function CreatePoForm({ link, onClose, onChangeLink }: Props) {
  // Freeze the page behind the form, but never the form's own scroller —
  // without the exception the hook locks this overlay too and nothing scrolls.
  useScrollLock(true, '.spi-dt-overlay');
  const toast = useToast();
  const { draft, set, replace } = usePoDraft();
  const lookups = usePoLookups((what, message) => toast.error(`Could not load ${what.toLowerCase()}`, message));

  const isEdit = link.editId != null;
  const [poId, setPoId] = useState<number | null>(link.editId ?? null);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [nextCode, setNextCode] = useState('');
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [stage, setStage] = useState(0);
  // The furthest stage the stepper may open — every stage before it is saved.
  const [reached, setReached] = useState(0);

  const shipmentId = link.shipment?.id ?? detail?.shipment_order_id ?? null;

  const fail = (e: unknown) => {
    if (e instanceof PoApiError) toast.error(`${e.action} failed`, e.firstError);
    else toast.error('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
  };

  // Supplier master record + Evidence Vault; the vault also feeds the legal status.
  const loadSupplier = async (vendorId: number) => {
    setSupplierLoading(true);
    try {
      const [supplier, vault] = await Promise.all([
        poLookupApi.supplier(vendorId),
        poLookupApi.supplierVault(vendorId).catch(() => null),
      ]);
      set({ vendorId, supplier, vault, legal: legalFromVault(vault) });
      return supplier;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setSupplierLoading(false);
    }
  };

  // Open: an edit loads the saved PO; a new PO previews its code and seeds the PI lines.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (link.editId != null) {
          const d = await poApi.show(link.editId);
          const pi = d.shipment_order_id ? (await poApi.piLines(d.shipment_order_id, d.id)).lines : [];
          if (!alive) return;
          replace(draftFromDetail(d, pi));
          setDetail(d);
          setReached(Math.min(3, d.current_step ?? 1));
          if (d.vendor_id) void loadSupplier(d.vendor_id);
          toast.info(`Editing ${d.code}`, 'Details loaded');
        } else {
          const [code, pi] = await Promise.all([
            poApi.nextCode(),
            link.shipment ? poApi.piLines(link.shipment.id) : Promise.resolve(null),
          ]);
          if (!alive) return;
          setNextCode(code.code);
          if (pi) set({ lines: pi.lines.map(rowFromPi) });
        }
      } catch (e) {
        if (alive) fail(e);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  useEffect(() => {
    // Esc closes the form — unless a popup is open over it (GST notice, the
    // supplier chooser or wizard, the Evidence Vault, a product's detail view):
    // those close themselves on the same key, and closing the whole form too
    // would throw away everything filled in.
    const OVER_FORM = '.cgst-backdrop, .supch-ov, .avm-backdrop, .sev-overlay, .prd-detail-overlay';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(OVER_FORM)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLast = stage === STAGES.length - 1;

  // The supplier's GST position gates the PO at submission, so its action sits
  // beside "Submit PO & Next" on Step 03 — only when the check calls for one.
  const gst = gstCheck(draft);
  const [gstNotice, setGstNotice] = useState<GstNotice | null>(null);
  const showGstAction = stage === 2 && !!gst.notice;

  /* ── Saving each stage ── */

  const saveStage1 = async (): Promise<boolean> => {
    if (!draft.vendorId) { toast.warning('Select a supplier', 'Pick the supplier this PO is issued to.'); return false; }
    if (draft.docType === 'International' && (!draft.currency || !draft.exchangeRate || !draft.incoTerm)) {
      toast.warning('International details missing', 'Currency, exchange rate and INCO term are required for an international PO.');
      return false;
    }
    const body = stage1Body(draft, shipmentId);
    const d = poId ? await poApi.updateStage1(poId, body) : await poApi.create(body);
    setPoId(d.id);
    setDetail(d);
    // A high-risk supplier makes the server force inspection on.
    if (d.physical_inspection === 'yes' && !draft.physInsp) set({ physInsp: true });
    if (!poId) toast.success(`${d.code} saved as draft`, 'Continue with the product lines.');
    return true;
  };

  const saveStage2 = async (): Promise<boolean> => {
    if (draft.lines.some((l) => !l.pi && !l.productId)) {
      toast.warning('Product missing', 'Pick a product on every added line, or remove the line.');
      return false;
    }
    const body = itemsBody(draft);
    if (body.lines.length === 0) { toast.warning('No products ordered', 'Enter a quantity on at least one line.'); return false; }
    setDetail(await poApi.saveItems(poId as number, body));
    return true;
  };

  const saveStage3 = async (): Promise<boolean> => {
    // Same rule the server applies on submit; stopping here opens the matching popup.
    if (gst.notice) { setGstNotice(gst.notice); return false; }
    const d = await poApi.saveTerms(poId as number, { terms: draft.terms, submit: 'yes' });
    setDetail(d);
    toast.success(isEdit ? `${d.code} updated` : `${d.code} submitted`, 'Documents are ready on the next step.');
    return true;
  };

  const goNext = async () => {
    if (saving || booting) return;
    if (isLast) {
      toast.success(isEdit ? 'Purchase order updated' : 'Purchase order generated', detail?.code ?? '');
      onClose();
      return;
    }
    setSaving(true);
    try {
      const saved = await [saveStage1, saveStage2, saveStage3][stage]();
      if (saved) {
        setStage(stage + 1);
        setReached((r) => Math.max(r, stage + 1));
      }
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const goTo = (target: number) => {
    if (target === stage) return;
    if (target > reached) { toast.info('Save this step first', 'Use the button below to save and continue.'); return; }
    setStage(target);
  };

  // On stage 1 the back button returns to the link popup — unless the PO is
  // already saved (an edit, or a draft created here): re-linking would start a
  // different PO, so it goes back to the list instead.
  const goBack = () => {
    if (stage > 0) setStage(stage - 1);
    else if (poId) onClose();
    else onChangeLink();
  };
  const backLabel = stage > 0 ? 'Back' : poId ? 'Back to List' : 'Change Link';
  const nextLabel = saving ? 'Saving…' : isLast && isEdit ? 'Update Purchase Order' : NEXT_LABEL[stage];

  const code = detail?.code ?? nextCode;
  const refs = {
    shipment: link.shipment?.code ?? detail?.shipment_code ?? null,
    opportunity: link.shipment?.opportunity_code ?? detail?.opportunity_code ?? null,
    pi: link.shipment?.pi_number ?? detail?.pi_code ?? null,
    customer: link.shipment?.customer ?? detail?.customer_name ?? null,
    procurement: detail?.procurement_request_code ?? null,
  };
  const ctx: StepCtx = { lookups, taxMode: detail?.tax_mode ?? 'intra', piCode: refs.pi, detail };

  return createPortal(
    <div className="spi-dt-overlay cpf-form">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Purchase Order</div>
                <div className="spi-dt-head-sub">
                  {isEdit ? `Editing ${code || '…'}`
                    : detail?.status === 'submitted' ? 'Submitted'
                      : shipmentId ? 'Draft · not yet issued' : 'Draft · standalone, not yet issued'}
                </div>
              </div>
            </div>

            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value={code || '—'} mono />
              {shipmentId && (
                <>
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoShip />} label="SHIPMENT ID" value={refs.shipment ?? '—'} alt mono />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoTarget />} label="OPPORTUNITY ID" value={refs.opportunity ?? '—'} mono />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoLines />} label="PI NUMBER" value={refs.pi ?? '—'} alt mono />
                  {refs.procurement && (
                    <>
                      <span className="spi-dt-dots">⋮</span>
                      <HeadPill icon={<IcoLines />} label="PROCUREMENT ID" value={refs.procurement} mono />
                    </>
                  )}
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoUser />} label="CUSTOMER NAME" value={refs.customer ?? '—'} />
                </>
              )}
            </div>

            <div className="spi-dt-head-r">
              <span className="spi-dt-divider" />
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
                title={i <= reached ? `Go to Step ${i + 1}` : 'Save the current step first'}
                onClick={() => goTo(i)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } }}
              >
                <div className="spi-dt-step-top">
                  <span className="spi-dt-step-lbl">STEP {String(i + 1).padStart(2, '0')}</span>
                  {i === stage && <span className="spi-dt-step-badge">ACTIVE</span>}
                  {i < stage && <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
                </div>
                <div className="spi-dt-step-big">{String(i + 1).padStart(2, '0')}</div>
                <div className="spi-dt-step-title">{s.title}</div>
                <div className="spi-dt-step-desc">{s.desc}</div>
                <span className="spi-dt-step-ghost">{String(i + 1).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spi-dt-body" ref={bodyRef}>
          {booting ? (
            <div className="cpf-loading"><span className="spinner-border spinner-border-sm" role="status" /> Loading purchase order…</div>
          ) : (
            <>
              {stage === 0 && (
                <Step1LinkSupplier draft={draft} set={set} ctx={ctx} supplierLoading={supplierLoading} onPickSupplier={loadSupplier} />
              )}
              {stage === 1 && <Step2ProductDetails draft={draft} set={set} ctx={ctx} />}
              {stage === 2 && <Step3Terms draft={draft} set={set} ctx={ctx} />}
              {stage === 3 && <Step4Documents draft={draft} ctx={ctx} poId={poId} />}
            </>
          )}
        </div>

        <div className="spi-dt-foot">
          <div className="spi-dt-foot-l">
            <div>
              <div className="spi-dt-foot-step">STEP {String(stage + 1).padStart(2, '0')} OF {String(STAGES.length).padStart(2, '0')}</div>
              <div className="spi-dt-foot-name">{STAGES[stage].title}</div>
            </div>
            <div className="spi-dt-dots">
              {STAGES.map((s, i) => (
                <span key={s.title} className={i === stage ? 'on' : (i < stage ? 'done' : '')} />
              ))}
            </div>
          </div>
          <div className="spi-dt-foot-r">
            <button type="button" className="spi-dt-btn-ghost" onClick={goBack} disabled={saving}>
              <IcoChevronL /> {backLabel}
            </button>
            {showGstAction && (
              <button
                type="button"
                className={`spi-dt-btn-next cpf-foot-gst--${gst.notice!.tone}`}
                onClick={() => setGstNotice(gst.notice)}
              >
                {gst.state.action}
              </button>
            )}
            <button
              type="button"
              className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
              disabled={saving || booting}
            >
              {nextLabel} <IcoChevronR />
            </button>
          </div>
        </div>
      </div>
      {gstNotice && <GstNoticeModal notice={gstNotice} onClose={() => setGstNotice(null)} />}
    </div>,
    document.body,
  );
}

export function HeadPill({ icon, label, value, mono, alt }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; alt?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div className="spi-dt-pill-txt">
        <div className="spi-dt-pill-lbl">{label}</div>
        <div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`} title={value}>{value}</div>
      </div>
    </div>
  );
}
