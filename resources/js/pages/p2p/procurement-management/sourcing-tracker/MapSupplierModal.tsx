import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ReportProduct } from './targetProducts';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { useSaveGuard } from './useSaveGuard';
import { inr } from './format';
import { usePopup } from './popupHooks';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import SupplierMasterForm from './SupplierMasterForm';
import SupplierTypeChooser from './SupplierTypeChooser';
import NewSupplierForm from './NewSupplierForm';
import './map-supplier-modal.css';
import { IcoCheck, IcoDb, IcoNext, IcoPin, IcoUserPlus, IcoX } from './icons';

/* Map Supplier Directory popup. Step 1: choose Supplier Master or New Supplier. Supplier Master
   opens the app's Domestic / International gate, then SupplierMasterForm in this popup's place;
   New Supplier opens the teal Domestic / International chooser, then NewSupplierForm in this
   popup's body. Suppliers are dummy data until the API lands. */

type Props = {
  product: ReportProduct;
  onClose: () => void;
  onMapped: (supplier: string) => void;
};
type Step = 'choose' | 'master' | 'newType' | 'new';

const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span className={`stmap-ocpill ${cls}`}><IcoCheck size={8} sw={3} />{children}</span>
);

// The app's existing Domestic / International chooser (Supplier Master), used as-is.
const SupplierScopeGate = lazyPage(() => import('../../p2p-master-management/supplier-management/SupplierScopeGate'));

export default function MapSupplierModal({ product, onClose, onMapped }: Props) {
  const [step, setStep] = useState<Step>('choose');
  // Supplier Master: the existing Domestic / International gate opens first; the chosen scope
  // decides the form that follows.
  const [gateOpen, setGateOpen] = useState(false);
  const [scope, setScope] = useState<SupplierScope | null>(null);
  // New Supplier: Domestic / International, chosen on the teal chooser before the form.
  const [newScope, setNewScope] = useState<SupplierScope>('domestic');
  const [formDirty, setFormDirty] = useState(false);
  // One save at a time: spinner on Map / Save Supplier, form locked, × / Back / Esc off while it runs (V-C01).
  const { saving, busy, run } = useSaveGuard();

  // Scroll lock, Esc (this is the top popup, so the report behind stays open; not while saving) and focus.
  const dialogRef = useRef<HTMLDivElement>(null);
  // Esc closes the popup only before anything is picked or typed; after that only × closes it.
  const dirty = formDirty;
  // While the gate is open it owns Esc (it closes itself on Esc and on its backdrop).
  usePopup(dialogRef, { onClose, blocked: () => busy.current || dirty || gateOpen });
  // Keyboard focus goes onto the gate's first card when it opens (it does not move focus itself).
  useEffect(() => {
    if (!gateOpen) return;
    const id = window.setTimeout(() => document.querySelector<HTMLElement>('.supch-card')?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [gateOpen]);
  const chooseScope = (s: SupplierScope) => { setScope(s); setGateOpen(false); setStep('master'); };
  // Back from the form returns to the Domestic / International gate (as the design does).
  const backToGate = () => { setStep('choose'); setFormDirty(false); setGateOpen(true); };
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
      {step === 'newType' ? (
        <SupplierTypeChooser productName={product.name} dialogRef={dialogRef}
          onChoose={s => { setNewScope(s); setStep('new'); }} onBack={() => setStep('choose')} onCancel={onClose} />
      ) : step === 'master' && scope ? (
        <SupplierMasterForm key={scope} scope={scope} productName={product.name} saving={saving} dialogRef={dialogRef}
          onDirty={setFormDirty} onBack={backToGate} onCancel={onClose}
          onSave={name => { void run(() => onMapped(name)); }} />
      ) : (
      <div ref={dialogRef} className={`stmap-box${step === 'new' ? ' stmap-box--wide' : ''}${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true"
        aria-busy={saving || undefined} aria-label="Map Supplier Directory" inert={gateOpen}>

        <div className="stmap-header">
          <div className="stmap-hrow">
            <div className="stmap-title-wrap">
              <div className="stmap-hicon"><IcoPin size={20} sw={2.1} /></div>
              <div className="stmap-title-block">
                <div className="stmap-title-line">
                  <h3 className="stmap-title">Map Supplier Directory</h3>
                  {step === 'new' && <span className="stmap-step">New · {newScope === 'domestic' ? 'Domestic' : 'International'}</span>}
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
              <div className="stmap-ppill"><div className="stmap-ppill-lbl">Segment</div><div className="stmap-ppill-val">{product.segment}</div></div>
            </>)}
            <div className="stmap-ppill-sep" />
            <div className="stmap-ppill"><div className="stmap-ppill-lbl">Target Price</div><div className="stmap-ppill-val amber">{inr(product.targetPrice)}</div></div>
            <div className="stmap-ppill-sep" />
            <div className="stmap-ppill"><div className="stmap-ppill-lbl">Suppliers Mapped</div><div className="stmap-ppill-val green">{product.suppliers} Supplier{product.suppliers === 1 ? '' : 's'}</div></div>
          </div>
        </div>

        {step === 'choose' && (
          <div className="stmap-choose-body sct-scroller">
            <div className="stmap-opt-grid">
              <div className="stmap-ocard stmap-master-card" role="button" tabIndex={0} onClick={() => setGateOpen(true)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGateOpen(true); } }}>
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
          <NewSupplierForm product={product} saving={saving} onDirty={setFormDirty}
            onBack={() => { setFormDirty(false); setStep('newType'); }}
            onSave={name => { void run(() => onMapped(name)); }} />
        )}
      </div>
      )}

      {/* Rendered inside this overlay so it stacks above the popup (its own z-index is lower). */}
      {gateOpen && (
        <Suspense fallback={null}>
          {/* Like every popup in this module, the gate closes only with × or Cancel: a click on its
              backdrop is stopped here (capture phase) before the gate's own backdrop handler sees it. */}
          <div className="stmap-gate" onClickCapture={e => { if ((e.target as Element).classList.contains('supch-ov')) e.stopPropagation(); }}>
            <SupplierScopeGate onChoose={chooseScope} onClose={() => setGateOpen(false)} />
          </div>
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
