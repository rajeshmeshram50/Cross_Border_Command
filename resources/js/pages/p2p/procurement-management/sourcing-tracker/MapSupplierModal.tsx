import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { apiErrorMessage, apiFieldErrors } from './apiError';
import { uploadP2pFile } from './upload';
import type { ReportProduct } from './targetProducts';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { useSaveGuard } from './useSaveGuard';
import { inr } from './format';
import { usePopup } from './popupHooks';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import SupplierMasterForm from './SupplierMasterForm';
import SupplierTypeChooser from './SupplierTypeChooser';
import NewSupplierForm, { type NewSupplierValues } from './NewSupplierForm';
import './map-supplier-modal.css';
import { IcoCheck, IcoDb, IcoNext, IcoPin, IcoUserPlus, IcoX } from './icons';

/* Map Supplier Directory popup. Step 1: choose Supplier Master or New Supplier. Each opens the
   Figma's Domestic / International step (SupplierTypeChooser: "Supplier Master — Choose the
   supplier type" with the available counts, or "New Supplier"), then SupplierMasterForm in this
   popup's place, or NewSupplierForm in its body. Both forms hand their mapping here, and this popup saves it:
     POST /p2p/upload (kind = card)  → a New Supplier's business card, first
     POST /p2p/sourcing-targets/{id}/products/{product}/suppliers → the mapping (assignee only).
   Edit (assignee only) opens straight on the form the supplier was mapped with:
     a New Supplier  → NewSupplierForm with its saved values, saved with PUT …/suppliers/{mapping};
     a Supplier Master supplier → SupplierMasterForm with the supplier locked and only its price
       editable, saved with PATCH …/suppliers/{mapping}/price. */

/** A mapped Supplier Master supplier's saved quote (its Edit changes only the price). */
export type MasterQuote = {
  supplierId: string; price: number | null; gst: number; currency: string; fx: number | null; validTill: string | null;
};
/** Edit a mapped supplier: its mapping id and origin; a New Supplier's saved values and stored business
    card, or (master set) a Supplier Master supplier's quote. */
export type MapEdit = { mappingId: string; scope: SupplierScope; values: NewSupplierValues; card: string; master?: MasterQuote };

/** A mapping a form asks to save: the request body (supplier_id or new_supplier, plus the price
    fields), the supplier's name for the toast, and a New Supplier's business card to upload. */
export type MapRequest = { body: Record<string, unknown>; supplierName: string; card?: File | null };

type Props = {
  /** The sourcing target the product belongs to. */
  targetCode: string;
  product: ReportProduct;
  /** Set to edit a mapped New Supplier instead of mapping a new one. */
  edit?: MapEdit | null;
  onClose: () => void;
  onMapped: (supplier: string) => void;
};
type Step = 'choose' | 'masterType' | 'master' | 'newType' | 'new';

const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span className={`stmap-ocpill ${cls}`}><IcoCheck size={8} sw={3} />{children}</span>
);


export default function MapSupplierModal({ targetCode, product, edit, onClose, onMapped }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(edit?.master ? 'master' : edit ? 'new' : 'choose');
  // Supplier Master: the Figma's "Supplier Master — Choose the supplier type" step opens first; the
  // chosen scope decides the form that follows. Its cards show how many suppliers each origin has.
  const [scope, setScope] = useState<SupplierScope | null>(edit?.master ? edit.scope : null);
  const [masterCounts, setMasterCounts] = useState<Record<SupplierScope, number> | null>(null);
  useEffect(() => {
    if (step !== 'masterType' || masterCounts) return;
    api.get<{ data: { origin?: string }[] }>('/p2p/suppliers')
      .then(r => {
        const rows = r.data?.data ?? [];
        setMasterCounts({
          domestic: rows.filter(s => s.origin !== 'international').length,
          international: rows.filter(s => s.origin === 'international').length,
        });
      })
      .catch(() => setMasterCounts({ domestic: 0, international: 0 }));
  }, [step, masterCounts]);
  // New Supplier: Domestic / International, chosen on the teal chooser before the form.
  const [newScope, setNewScope] = useState<SupplierScope>(edit?.scope ?? 'domestic');
  const [formDirty, setFormDirty] = useState(false);
  // One save at a time: spinner on Map / Save Supplier, form locked, × / Back / Esc off while it runs (V-C01).
  const { saving, busy, run } = useSaveGuard();
  // The server's 422 field messages, shown under the form's fields until the form changes.
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const clearServerErrors = useCallback(() => setServerErrors({}), []);
  const save = (req: MapRequest) => {
    void run(async () => {
      try {
        let body = req.body;
        if (req.card) body = { ...body, new_supplier: { ...(body.new_supplier as object), card: await uploadP2pFile(req.card, 'card') } };
        const url = `/p2p/sourcing-targets/${encodeURIComponent(targetCode)}/products/${product.id}/suppliers`;
        if (edit?.master) await api.patch(`${url}/${encodeURIComponent(edit.mappingId)}/price`, body);
        else if (edit) await api.put(`${url}/${encodeURIComponent(edit.mappingId)}`, body);
        else await api.post(url, body);
        onMapped(req.supplierName);
      } catch (e) {
        setServerErrors(apiFieldErrors(e));
        toast.error(edit ? 'Supplier not updated' : 'Supplier not mapped', apiErrorMessage(e, 'Please try again.'));
      }
    });
  };

  // Scroll lock, Esc (this is the top popup, so the report behind stays open; not while saving) and focus.
  const dialogRef = useRef<HTMLDivElement>(null);
  // Esc closes the popup only before anything is picked or typed; after that only × closes it.
  const dirty = formDirty;
  usePopup(dialogRef, { onClose, blocked: () => busy.current || dirty });
  const chooseScope = (s: SupplierScope) => { setScope(s); setStep('master'); };
  // Back from the form returns to the Domestic / International step (as the design does).
  const backToGate = () => { setStep('masterType'); setFormDirty(false); setServerErrors({}); };
  // A step change removes the element that had focus (the chosen card, or Back): move focus to the
  // new step's first field, or to the dialog on the choose step.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const d = dialogRef.current;
    (d?.querySelector<HTMLElement>('.stsm-bd button, .stnf-body input, .stmap-ocard') ?? d)?.focus({ preventScroll: true });
  }, [step]);

  return createPortal(
    // A click on the backdrop does nothing. Esc closes only while nothing is picked or typed; × always closes.
    <div className="stmap-overlay">
      {step === 'masterType' ? (
        <SupplierTypeChooser mode="master" counts={masterCounts} productName={product.name} dialogRef={dialogRef}
          onChoose={chooseScope} onBack={() => setStep('choose')} onCancel={onClose} />
      ) : step === 'newType' ? (
        <SupplierTypeChooser productName={product.name} dialogRef={dialogRef}
          onChoose={s => { setNewScope(s); setStep('new'); }} onBack={() => setStep('choose')} onCancel={onClose} />
      ) : step === 'master' && scope ? (
        <SupplierMasterForm key={scope} scope={scope} targetCode={targetCode} productId={product.id} productName={product.name}
          saving={saving} dialogRef={dialogRef} serverErrors={serverErrors} onClearServerErrors={clearServerErrors}
          edit={edit?.master}
          // Edit has no chooser behind it: Back closes the popup.
          onDirty={setFormDirty} onBack={edit?.master ? onClose : backToGate} onCancel={onClose} onSave={save} />
      ) : (
      <div ref={dialogRef} className={`stmap-box${step === 'new' ? ' stmap-box--wide' : ''}${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true"
        aria-busy={saving || undefined} aria-label="Map Supplier Directory">

        <div className="stmap-header">
          <div className="stmap-hrow">
            <div className="stmap-title-wrap">
              <div className="stmap-hicon"><IcoPin size={20} sw={2.1} /></div>
              <div className="stmap-title-block">
                <div className="stmap-title-line">
                  <h3 className="stmap-title">Map Supplier Directory</h3>
                  {step === 'new' && <span className="stmap-step">{edit ? 'Edit' : 'New'} · {newScope === 'domestic' ? 'Domestic' : 'International'}</span>}
                </div>
                <p className="stmap-sub">Procurement Supplier Mapping&nbsp;·&nbsp;Product Procurement</p>
              </div>
            </div>
            <button type="button" className="stmap-close" aria-label="Close" onClick={onClose} disabled={saving}><IcoX size={13} sw={2.8} /></button>
          </div>

          <div className="stmap-prod-strip">
            <div className="stmap-ppill stmap-ppill--name"><div className="stmap-ppill-lbl">Product Name</div><FitTip label={product.name}><div className="stmap-ppill-val">{product.name}</div></FitTip></div>
            <div className="stmap-ppill-sep" />
            <div className="stmap-ppill"><div className="stmap-ppill-lbl">Product Code</div><div className="stmap-ppill-val cyan">{product.code || '—'}</div></div>
            {product.segment && product.segment !== '—' && (<>
              <div className="stmap-ppill-sep" />
              <div className="stmap-ppill stmap-ppill--seg"><div className="stmap-ppill-lbl">Segment</div><FitTip label={product.segment}><div className="stmap-ppill-val">{product.segment}</div></FitTip></div>
            </>)}
            <div className="stmap-ppill-sep" />
            <div className="stmap-ppill stmap-ppill--price"><div className="stmap-ppill-lbl">Target Price</div><FitTip label={inr(product.targetPrice)}><div className="stmap-ppill-val amber">{inr(product.targetPrice)}</div></FitTip></div>
            <div className="stmap-ppill-sep" />
            <div className="stmap-ppill"><div className="stmap-ppill-lbl">Suppliers Mapped</div><div className="stmap-ppill-val green">{product.suppliers} Supplier{product.suppliers === 1 ? '' : 's'}</div></div>
          </div>
        </div>

        {step === 'choose' && (
          <div className="stmap-choose-body sct-scroller">
            <div className="stmap-opt-grid">
              <div className="stmap-ocard stmap-master-card" role="button" tabIndex={0} onClick={() => setStep('masterType')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep('masterType'); } }}>
                <div className="stmap-oc-glow stmap-master-glow" />
                <div className="stmap-oc-top"><div className="stmap-oc-iconbox stmap-master-iconbox"><IcoDb size={20} sw={1.9} /></div></div>
                <div className="stmap-oc-title">Supplier Master</div>
                <div className="stmap-oc-desc">Select from your pre-verified supplier database</div>
                <div className="stmap-oc-divider" />
                <div className="stmap-oc-footer">
                  <div className="stmap-oc-pills"><Pill cls="stmap-master-pill">Verified</Pill><Pill cls="stmap-master-pill">Instant</Pill><Pill cls="stmap-master-pill">Pre-filled</Pill></div>
                  <div className="stmap-oc-cta stmap-master-cta"><IcoNext size={13} sw={2.5} /></div>
                </div>
              </div>

              <div className="stmap-ocard stmap-new-card" role="button" tabIndex={0} onClick={() => setStep('newType')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep('newType'); } }}>
                <div className="stmap-oc-glow stmap-new-glow" />
                <div className="stmap-oc-top"><div className="stmap-oc-iconbox stmap-new-iconbox"><IcoUserPlus size={20} sw={1.9} /></div></div>
                <div className="stmap-oc-title">New Supplier</div>
                <div className="stmap-oc-desc">Register a new supplier with full details &amp; documents</div>
                <div className="stmap-oc-divider" />
                <div className="stmap-oc-footer">
                  <div className="stmap-oc-pills"><Pill cls="stmap-new-pill">Register</Pill><Pill cls="stmap-new-pill">Docs</Pill><Pill cls="stmap-new-pill">Location</Pill></div>
                  <div className="stmap-oc-cta stmap-new-cta"><IcoNext size={13} sw={2.5} /></div>
                </div>
              </div>
            </div>
            <div className="stmap-cancel-row">
              <button type="button" className="stmap-btn-cancel" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'new' && (
          <NewSupplierForm key={newScope} scope={newScope} product={product} saving={saving} onDirty={setFormDirty}
            serverErrors={serverErrors} onClearServerErrors={clearServerErrors}
            // Edit has no chooser behind it: Back closes the popup.
            onBack={edit ? onClose : () => { setFormDirty(false); setServerErrors({}); setStep('newType'); }}
            initial={edit?.values} initialCard={edit?.card || undefined}
            onSave={save} />
        )}
      </div>
      )}

    </div>,
    document.body,
  );
}
