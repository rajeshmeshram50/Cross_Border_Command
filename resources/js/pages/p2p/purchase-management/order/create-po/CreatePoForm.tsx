// Create PO — full-page form shell. The wizard chrome reuses the shared
// spi-dt-* classes; create-po.css holds only what differs for this form.
// Each "Save & Next" saves its stage through po-api before moving on, so a PO
// is a real draft from Step 01 onwards and Edit PO reopens exactly what was saved.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import Step1LinkSupplier from './steps/Step1LinkSupplier';
import Step2ProductDetails from './steps/Step2ProductDetails';
import Step3Terms from './steps/Step3Terms';
import Step4Documents from './steps/Step4Documents';
import { draftFromDetail, itemsBody, rowFromPi, stage1Body, usePoDraft } from './po-draft';
import { gstCheck } from './gst-check';
import { legalFromVault, vaultTargetOf } from './supplier-checks';
import SupplierDocsNoticeModal, { type SupplierDocsNotice } from './SupplierDocsNoticeModal';
import { usePoLookups, type PoLookups } from './use-po-lookups';
import { FitTip } from './form-fields';
import {
  linesFromServer, scrollToFirstError, stage1FromServer, validateLines, validateStage1,
  type FieldErrors, type LineErrors,
} from './validation';
import type { PoDraft, PoLineRow } from './po-draft';
import type { SupplierDetail } from '../api/po-api';
import GstNoticeModal, { type GstNotice } from './GstNoticeModal';
// The supplier master's wizard, opened on its GST Scrutiny tab when scrutiny is missing or stale.
const AddVendorModal = lazy(() => import('../../../p2p-master-management/supplier-management/AddVendorModal'));
/* Also opened from the Step 03 footer, so the missing paperwork can be filled
   in before the submit is even tried — the popup is not the only way in. */
const SupplierEvidenceVaultModal = lazy(() => import('../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
import { PoApiError, poApi, poLookupApi, type PiHolder, type PoDetail, type ShipmentOption, type TaxMode } from '../api/po-api';
import { useToast } from '../../../../../contexts/ToastContext';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './create-po.css';
import { IcoCheck, IcoChevronL, IcoLock, IcoChevronR, IcoDoc, IcoLines, IcoShield, IcoShip, IcoTarget, IcoX } from '../shared/icons';

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
  /** Saves Step 02's lines and charges without leaving the step. */
  saveLines: () => Promise<void>;
  saving: boolean;
  /** Re-read the supplier's vault after documents are uploaded from it. */
  refreshVault: () => void;
  /** Re-read the supplier after it is edited — its mapped products drive Stage 02. */
  reloadSupplier: (vendorId: number) => Promise<SupplierDetail | null>;
  /** Suppliers and products again, after one of them is edited from a step. */
  reloadSupplierList: () => void;
  /** Re-read the PO — after documents go out for signature, so Steps 01–03 lock at once. */
  reloadDetail: () => void;
  /** Inline errors — shown once the step has been saved (or failed on the server). */
  errors: FieldErrors;
  lineErrors: LineErrors;
  /** Step 02 lines as last saved; null until they have been saved once. */
  savedLines: PoLineRow[] | null;
  /** Other POs holding this PI's quantity — explains an empty Stage 02. */
  piHolders: PiHolder[];
  linesGeneral?: string;
  /* The form is open to be read only. A disabled fieldset covers the native
     controls; anything built from a div needs telling. */
  viewOnly: boolean;
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
  const { draft, set: setDraft, replace } = usePoDraft();
  // Errors appear after the first Save on a step, then follow the user's edits live.
  const [shown, setShown] = useState<[boolean, boolean]>([false, false]);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [serverLineErrors, setServerLineErrors] = useState<LineErrors>({});
  const set = (patch: Partial<PoDraft>) => {
    setDraft(patch);
    const keys = Object.keys(patch).map((k) => (k === 'vendorId' ? 'supplier' : k));
    if (keys.some((k) => k in serverErrors)) {
      setServerErrors((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !keys.includes(k))));
    }
    if ('lines' in patch && Object.keys(serverLineErrors).length) setServerLineErrors({});
  };
  const lookups = usePoLookups((what, message) => toast.error(`Could not load ${what.toLowerCase()}`, message));

  const isEdit = link.editId != null;
  const [poId, setPoId] = useState<number | null>(link.editId ?? null);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [nextCode, setNextCode] = useState('');
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  // Save & Next in flight — the step shows the form shimmer until the next one opens.
  const [advancing, setAdvancing] = useState(false);
  // Read by the Esc handler, which is bound once and would see a stale `saving`.
  const savingRef = useRef(false);
  savingRef.current = saving;
  const [supplierLoading, setSupplierLoading] = useState(false);
  // The lines as last saved — what Missing Product Details reports on.
  const [savedLines, setSavedLines] = useState<PoLineRow[] | null>(null);
  const [piHolders, setPiHolders] = useState<PiHolder[]>([]);
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
    /* Two reads, and only one of them the fields wait for. The Evidence Vault
       is the slower — it walks every document group — and only the legal
       status card needs it, so the supplier's own boxes fill as soon as its
       record lands instead of the whole form sitting on "Loading…". */
    const vault = poLookupApi.supplierVault(vendorId).catch(() => null);
    void vault.then((v) => set({ vault: v, legal: legalFromVault(v) }));
    try {
      const supplier = await poLookupApi.supplier(vendorId);
      set({ vendorId, supplier });
      return supplier;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setSupplierLoading(false);
    }
  };

  const refreshVault = () => {
    if (!draft.vendorId) return;
    poLookupApi.supplierVault(draft.vendorId)
      .then((vault) => set({ vault, legal: legalFromVault(vault) }))
      .catch(fail);
  };

  // Open: an edit loads the saved PO; a new PO previews its code and seeds the PI lines.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (link.editId != null) {
          const d = await poApi.show(link.editId);
          const piRes = d.shipment_order_id ? await poApi.piLines(d.shipment_order_id, d.id) : null;
          const pi = piRes?.lines ?? [];
          if (alive) setPiHolders(piRes?.held_by ?? []);
          if (!alive) return;
          const loaded = draftFromDetail(d, pi);
          replace(loaded);
          if (d.items.length) setSavedLines(loaded.lines);
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
          if (pi) {
            // Earlier POs on this shipment may have ordered some PI lines in full.
            const open = pi.lines.filter((l) => l.pending_qty > 0);
            set({ lines: open.map(rowFromPi) });
            setPiHolders(pi.held_by ?? []);
            if (pi.lines.length && !open.length) {
              const waiting = (pi.held_by ?? []).filter((h) => h.approval_status === 'pending').map((h) => h.code);
              toast.info('Nothing left to order on this PI', waiting.length
                ? `Its products are on ${waiting.join(', ')}, still awaiting senior approval.`
                : 'Every PI line is already on earlier POs — raise a standalone PO for anything extra.');
            }
          }
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
    const OVER_FORM = '.cgst-backdrop, .supch-ov, .avm-backdrop, .apm-backdrop, .sev-overlay, .prd-detail-overlay';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(OVER_FORM)) return;
      // Not mid-save: closing now would drop the response half-applied.
      if (savingRef.current) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLast = stage === STAGES.length - 1;
  const isSubmit = stage === 2;

  // The supplier's GST position gates the PO at submission, so its action sits
  // beside "Submit PO & Next" on Step 03 — only when the check calls for one.
  const gst = gstCheck(draft);
  const [gstNotice, setGstNotice] = useState<GstNotice | null>(null);
  /* The supplier's one-time paperwork (Company DD, Owner KYC, Trade Licenses),
     read from its Evidence Vault. Incomplete stops the submit on Step 03. */
  const standardDocs = draft.legal?.sections?.[0] ?? null;
  const vaultTarget = draft.supplier ? vaultTargetOf(draft.supplier) : null;
  const [docsNotice, setDocsNotice] = useState<SupplierDocsNotice | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [scrutinyFor, setScrutinyFor] = useState<number | null>(null);
  // After the supplier's scrutiny is updated, reload it so the GST check runs again.
  const closeScrutiny = () => {
    const id = scrutinyFor;
    setScrutinyFor(null);
    if (id) void loadSupplier(id);
  };
  // Payments have started on this PO: every step can be looked at, nothing can be saved.
  const paidView = isEdit && !!detail?.payments_started;
  /* A document has gone out for signature (or come back signed): the supplier
     is signing what was sent, so Steps 01–03 freeze until the request is
     declined / recalled. The PO is submitted by then, so every step can be
     browsed, and Step 04 keeps working — the rest still has to be sent. */
  const signView = !paidView && !!detail?.signing_started;
  // Cancelled: the server refuses every save, so the form opens to be read.
  const cancelledView = isEdit && detail?.status === 'cancelled';
  // The reason rides in one banner line, so a long one is cut rather than wrapped.
  const reason = (detail?.cancel_reason ?? '').trim();
  const cancelNote = reason.length > 90 ? `${reason.slice(0, 90)}…` : reason;
  /* A pending senior GST approval does NOT freeze the form: the PO stays
     editable, and only the submit is held back until the senior approves
     (the server's GST gate). */
  const viewOnly = paidView || signView || cancelledView;
  const showGstAction = stage === 2 && !!gst.notice && !viewOnly;
  /* Step 03 holds the submit while this supplier's standard documents are
     incomplete, so the way to fix that sits in the footer too — beside Back,
     reachable before the submit is pressed and while a senior GST approval is
     still pending. */
  const docsPending = stage === 2 && !viewOnly && !!standardDocs && standardDocs.done < standardDocs.total && !!vaultTarget?.db_id;
  // Only an overdue return can be approved past; a stale scrutiny always blocks.
  const approval = gst.notice?.tone === 'warn' ? detail?.gst_approval ?? null : null;
  const gstCleared = !gst.notice || approval?.status === 'approved';
  const gstActionLabel = approval?.status === 'pending' ? 'Awaiting senior approval'
    : approval?.status === 'approved' ? 'Senior approved'
      : approval?.status === 'rejected' ? 'Rejected — send again' : gst.state.action;
  /* The request is with the senior: nothing this screen does can submit the PO
     until they decide, so the submit is frozen rather than left to be pressed
     into a refusal. The rest of Step 03 stays editable. */
  const awaitingApproval = stage === 2 && !viewOnly && approval?.status === 'pending';

  /** After a request is sent: re-read the PO so Step 03 shows where it stands. */
  const reloadApproval = async () => {
    if (!poId) return;
    try { setDetail(await poApi.show(poId)); } catch (e) { fail(e); }
  };

  /* A pending request is decided on someone else's screen, so this one has to
     ask. While a request is waiting the PO is re-read every 20 seconds and
     whenever the tab comes back to the front — so an approval or a rejection
     shows up here on its own instead of on the next reload (QA #85). Quiet:
     one small GET, only while something is actually pending and the tab is
     visible, and it stops the moment a decision lands. */
  /* Read from the PO itself, not from the tone-filtered `approval` above: that
     one is null unless the supplier's GST reads as "approval required" on this
     screen, and a request can be waiting whatever this screen currently makes
     of the supplier. If the server says a decision is outstanding, this form
     watches for it. */
  const pendingApproval = detail?.gst_approval?.status === 'pending';
  useEffect(() => {
    if (!poId || !pendingApproval) return;
    let alive = true;
    const read = async () => {
      if (document.hidden || savingRef.current) return;
      try {
        const fresh = await poApi.show(poId);
        if (alive) setDetail(fresh);
      } catch { /* a background poll never interrupts the user */ }
    };
    const timer = window.setInterval(read, 20_000);
    const onVisible = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [poId, pendingApproval]);

  /* The decision itself, announced once. Without this the panel simply changed
     colour while the user was looking at another part of the form. */
  const lastApprovalStatus = useRef<string | null>(null);
  useEffect(() => {
    const now = detail?.gst_approval?.status ?? null;
    const before = lastApprovalStatus.current;
    lastApprovalStatus.current = now;
    if (!before || before !== 'pending' || now === 'pending' || !now) return;
    const who = detail?.gst_approval?.requested_to_name ?? 'The senior';
    if (now === 'approved') toast.success('Senior approved', `${who} approved this PO — you can submit it now.`);
    if (now === 'rejected') {
      toast.error('Senior rejected', detail?.gst_approval?.reason
        ? `${who}: “${detail.gst_approval.reason}”`
        : `${who} rejected this request. Send it again once the reason is addressed.`);
    }
  }, [approval?.status, detail?.gst_approval?.reason, detail?.gst_approval?.requested_to_name, toast]);

  /* ── Saving each stage ── */

  /** Marks the step's errors visible and says how many fields need attention. */
  const blockWith = (count: number, what: string): false => {
    toast.warning('Please fix the highlighted fields', `${count} ${what} need${count === 1 ? 's' : ''} attention.`);
    scrollToFirstError();
    return false;
  };

  const saveStage1 = async (): Promise<boolean> => {
    setShown(([, b]) => [true, b]);
    const e = validateStage1(draft);
    if (Object.keys(e).length) return blockWith(Object.keys(e).length, Object.keys(e).length === 1 ? 'field' : 'fields');
    const body = stage1Body(draft, shipmentId);
    let d: PoDetail;
    try {
      d = poId ? await poApi.updateStage1(poId, body) : await poApi.create(body);
    } catch (err) {
      const mapped = err instanceof PoApiError ? stage1FromServer(err.fieldErrors) : {};
      if (!Object.keys(mapped).length) throw err;
      setServerErrors(mapped);
      return blockWith(Object.keys(mapped).length, Object.keys(mapped).length === 1 ? 'field' : 'fields');
    }
    setPoId(d.id);
    setDetail(d);
    // A high-risk supplier makes the server force inspection on.
    if (d.physical_inspection === 'yes' && !draft.physInsp) set({ physInsp: true });
    if (!poId) toast.success(`${d.code} saved as draft`, 'Continue with the product lines.');
    return true;
  };

  /** Step 02 as it stands right now — the same check its own save runs. */
  const checkLines = () => validateLines(draft.lines, lookups.products, draft.supplier?.segments, draft.docType === 'International', draft.supplier?.mapped_product_ids);

  /* Step 02 is not something a later step can leave behind: the stepper lets an
     already-saved PO jump straight to Step 03, which would submit a PO whose
     lines are still wrong (a product no longer mapped to the supplier, a missing
     rate). Any forward move, and the submit itself, comes back here first. */
  const linesBlock = (): boolean => {
    if (viewOnly) return false;
    const v = checkLines();
    const bad = Object.keys(v.rows).length;
    if (!bad && !v.general) return false;
    setShown(([a]) => [a, true]);
    setStage(1);
    if (bad) toast.warning('Fix Step 02 first', `${bad} product ${bad === 1 ? 'line needs' : 'lines need'} attention — a PO cannot be submitted with ${bad === 1 ? 'it' : 'them'}.`);
    else toast.warning('No products ordered', v.general);
    // The step has to render before its first error can be scrolled to.
    setTimeout(scrollToFirstError, 150);
    return true;
  };

  const saveStage2 = async (): Promise<boolean> => {
    setShown(([a]) => [a, true]);
    const v = checkLines();
    const bad = Object.keys(v.rows).length;
    if (bad || v.general) {
      if (!bad) { toast.warning('No products ordered', v.general); return false; }
      return blockWith(bad, bad === 1 ? 'line' : 'lines');
    }
    try {
      setDetail(await poApi.saveItems(poId as number, itemsBody(draft)));
      setSavedLines(draft.lines);
    } catch (err) {
      const mapped = err instanceof PoApiError ? linesFromServer(err.fieldErrors, draft.lines) : {};
      if (!Object.keys(mapped).length) throw err;
      setServerLineErrors(mapped);
      return blockWith(Object.keys(mapped).length, Object.keys(mapped).length === 1 ? 'line' : 'lines');
    }
    return true;
  };

  const saveStage3 = async (): Promise<boolean> => {
    // The lines the PO is submitted with must still be valid, whatever route led here.
    if (linesBlock()) return false;
    // Same rule the server applies on submit; stopping here opens the matching popup.
    if (!gstCleared) { setGstNotice(gst.notice); return false; }
    const d = await poApi.saveTerms(poId as number, { terms: draft.terms, submit: 'yes' });
    setDetail(d);
    toast.success(isEdit ? `${d.code} updated` : `${d.code} submitted`, 'Documents are ready on the next step.');
    return true;
  };

  const goNext = async () => {
    if (saving || booting) return;
    if (viewOnly) {
      if (isLast) onClose(); else setStage(stage + 1);
      return;
    }
    if (isLast) {
      toast.success(isEdit ? 'Purchase order updated' : 'Purchase order generated', detail?.code ?? '');
      onClose();
      return;
    }
    // What is being ordered comes before whose paperwork is missing.
    if (isSubmit && linesBlock()) return;
    /* The supplier's one-time paperwork has to be complete before the PO is
       submitted. The popup names what is missing and opens the Evidence Vault,
       where it is fixed; the status re-reads on close, so submitting again
       goes straight through. */
    if (isSubmit && standardDocs && standardDocs.done < standardDocs.total) {
      setDocsNotice({
        target: vaultTarget as SupplierDocsNotice['target'],
        supplier: draft.supplier?.legalName || draft.supplier?.name || '',
        code: draft.supplier?.code ?? '',
        section: standardDocs,
      });
      return;
    }
    setSaving(true);
    setAdvancing(true);
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
      setAdvancing(false);
    }
  };

  // Step 02's own Save button: bank the lines without moving on.
  const saveLines = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (await saveStage2()) toast.success('Product details saved', `${itemsBody(draft).lines.length} line(s) on this PO.`);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const goTo = (target: number) => {
    if (target === stage || saving) return;
    if (target > reached && !paidView && !signView) { toast.info('Save this step first', 'Use the button below to save and continue.'); return; }
    /* Leaving Step 02 forward with broken lines is how a wrong PO reached the
       submit — but only on a PO still being raised. Once it is submitted its
       saved lines have already passed the server, and Step 04's documents must
       stay reachable whatever the draft on screen looks like; the submit itself
       is still checked. */
    if (target > 1 && stage <= 1 && detail?.status !== 'submitted' && linesBlock()) return;
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
  const nextLabel = viewOnly ? (isLast ? 'Close' : 'Next') : saving ? 'Saving…' : isLast && isEdit ? 'Update Purchase Order' : NEXT_LABEL[stage];

  const code = detail?.code ?? nextCode;
  const refs = {
    shipment: link.shipment?.code ?? detail?.shipment_code ?? null,
    opportunity: link.shipment?.opportunity_code ?? detail?.opportunity_code ?? null,
    pi: link.shipment?.pi_number ?? detail?.pi_code ?? null,
    procurement: detail?.procurement_request_code ?? null,
  };
  const ctx: StepCtx = { lookups, taxMode: draft.docType === 'International' ? 'export' : (detail?.tax_mode ?? 'intra'), piCode: refs.pi, detail, saveLines, saving, refreshVault, reloadSupplier: loadSupplier, reloadSupplierList: lookups.reloadSuppliers, reloadDetail: () => { void reloadApproval(); }, savedLines, piHolders, viewOnly,
    errors: shown[0] ? { ...serverErrors, ...validateStage1(draft) } : serverErrors,
    ...(() => {
      if (!shown[1]) return { lineErrors: serverLineErrors };
      const v = validateLines(draft.lines, lookups.products, draft.supplier?.segments, draft.docType === 'International', draft.supplier?.mapped_product_ids);
      return { lineErrors: { ...serverLineErrors, ...v.rows }, linesGeneral: v.general };
    })(),
  };

  return createPortal(
    <div className={`spi-dt-overlay cpf-form${saving ? ' is-saving' : ''}`} aria-busy={saving}>
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Purchase Order</div>
                <div className="spi-dt-head-sub">
                  {viewOnly ? `Viewing ${code || '…'} · view only` : isEdit ? `Editing ${code || '…'}`
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
                </>
              )}
            </div>

            <div className="spi-dt-head-r">
              <span className="spi-dt-divider" />
              <button type="button" className="spi-dt-btn-close" onClick={onClose} disabled={saving}><IcoX /> Close</button>
            </div>
          </div>

          {/* inert while saving: no clicks, focus or typing reach the stepper or
              the step's fields — nothing can change under the save in flight. */}
          <div className="spi-dt-steps cpf-steps4" inert={saving}>
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

        <div className="spi-dt-body" ref={bodyRef} inert={saving}>
          {booting ? (
            <PoFormSkeleton />
          ) : (
            <>
              {/* Save & Next shows the shimmer instead of a dimmed form. The step
                  stays mounted underneath (hidden, not removed), so a save that
                  fails brings it back exactly as it was left. */}
              {advancing && <PoFormSkeleton />}
              <div className="cpf-stepwrap" hidden={advancing}>
              {viewOnly && (
                <div className="cpf-viewonly-banner">
                  <IcoLock /> <b>View only.</b>{' '}
                  {cancelledView
                    ? `This PO has been cancelled, so nothing on it can change${cancelNote ? ` — ${cancelNote}` : ''}. Every step is still here to read.`
                    : signView
                      ? 'Documents on this PO have been sent for signature, so it cannot be edited — it opens for editing again only if the request is declined or recalled.'
                      : 'Payments have started on this PO, so it can no longer be edited — you can still look through every step.'}
                </div>
              )}
              {/* A disabled fieldset turns every field and button in Steps 01–03 off at once. */}
              {/* Step 04 stays live on a paid PO — documents still have to go out —
                  but a cancelled PO is frozen end to end. */}
              <fieldset className="cpf-viewonly" disabled={viewOnly && (stage < 3 || cancelledView)}>
                {stage === 0 && (
                  <Step1LinkSupplier draft={draft} set={set} ctx={ctx} supplierLoading={supplierLoading} onPickSupplier={loadSupplier} />
                )}
                {stage === 1 && <Step2ProductDetails draft={draft} set={set} ctx={ctx} />}
                {stage === 2 && <Step3Terms draft={draft} set={set} ctx={ctx} />}
              </fieldset>
              {stage === 3 && <Step4Documents draft={draft} ctx={ctx} poId={poId} />}
              </div>
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
            {docsPending && (
              <button type="button" className="spi-dt-btn-ghost cpf-foot-docs" onClick={() => setVaultOpen(true)} disabled={saving}>
                <IcoShield /> Evidence Vault
                <span className="cpf-foot-docs__n">{standardDocs!.total - standardDocs!.done} pending</span>
              </button>
            )}
            {showGstAction && (
              <button
                type="button"
                className={`spi-dt-btn-next cpf-foot-gst--${approval?.status === 'approved' ? 'ok' : gst.notice!.tone}`}
                onClick={() => setGstNotice(gst.notice)}
                disabled={saving}
              >
                {approval?.status === 'approved' && <IcoCheck />} {gstActionLabel}
              </button>
            )}
            {/* Step 03 is where the PO is actually submitted, so that button is
                the green one, with a tick — every other step is teal. */}
            <button
              type="button"
              className={isSubmit ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
              /* The supplier lands a moment after it is picked, and the PO
                 carries its id only then — saving in that window would store the
                 new document type against the old supplier (CS-403). */
              disabled={saving || booting || awaitingApproval || supplierLoading}
              title={awaitingApproval ? `Waiting for ${detail?.gst_approval?.requested_to_name ?? 'the senior'} to approve — the PO cannot be submitted yet.`
                : supplierLoading ? 'Applying the supplier — one moment.' : undefined}
            >
              {saving ? <CpfSpinner /> : isSubmit && <IcoCheck />}
              {nextLabel}
              {saving ? null : <IcoChevronR />}
            </button>
          </div>
        </div>
      </div>
      {scrutinyFor && (
        <Suspense fallback={null}>
          <AddVendorModal vendorId={scrutinyFor} initialStep={2} initialKycTab="gst" scope="domestic"
            onClose={closeScrutiny} onSubmit={closeScrutiny} />
        </Suspense>
      )}
      {gstNotice && (
        <GstNoticeModal notice={gstNotice} onClose={() => setGstNotice(null)} poId={poId} approval={approval} onSent={reloadApproval}
          onOpenScrutiny={draft.vendorId ? () => setScrutinyFor(draft.vendorId) : undefined} />
      )}
      {docsNotice && (
        <SupplierDocsNoticeModal notice={docsNotice} onClose={() => setDocsNotice(null)} onVaultChange={refreshVault} />
      )}
      {vaultOpen && vaultTarget && (
        <Suspense fallback={null}>
          {/* The same vault the popup opens — reached straight from the footer. */}
          <SupplierEvidenceVaultModal open supplier={vaultTarget as never} onVaultChange={refreshVault} onClose={() => setVaultOpen(false)} />
        </Suspense>
      )}
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
        <FitTip label={value}>
          <div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`}>{value}</div>
        </FitTip>
      </div>
    </div>
  );
}

/* The save in progress, said in the button itself. "Saving…" alone was a word
   change on a disabled button — easy to miss, and on a fast save easy to doubt
   it happened at all (QA #86). */
export function CpfSpinner() {
  return (
    <svg className="cpf-spin" width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/* Shimmer shown while an existing PO is fetched — the shared wizard skeleton
   (.spi-dt-sk, same as the SPI wizard), shaped like Step 01's sections. */
function PoFormSkeleton() {
  return (
    <>
      {[0, 1].map((s) => (
        <div className="spi-dt-sec" key={s} aria-busy="true">
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
    </>
  );
}
