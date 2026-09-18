// Create Purchase Order — step 1: choose how the PO links to the procurement workflow.
// Reuses the SPI "Map Invoice" modal styles (spi-mdl-*) and its dropdown; no CSS of its own.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { ModalSelect } from '../supplier-purchase-invoice/MapSupplierPurchaseInvoiceModal';
import type { PoLink } from './create-po/CreatePoForm';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

type PoMode = 'with' | 'without';

// Static sample data until the shipments API is connected.
const SHIPMENTS = [
  { id: 'SHP-001', customer: 'Reliance Retail Ltd' },
  { id: 'SHP-002', customer: 'Adani Wilmar Ltd' },
  { id: 'SHP-003', customer: 'ITC Foods Division' },
  { id: 'SHP-004', customer: 'BigBasket Retail' },
  { id: 'SHP-005', customer: 'Patanjali Foods Ltd' },
];

const SHIPMENT_OPTIONS = SHIPMENTS.map((s) => ({ value: s.id, label: `${s.id} — ${s.customer}` }));

type Props = {
  onClose: () => void;
  onConfirm: (link: PoLink) => void;
  // Set when the user came back here from the form's "Change Link", so the
  // earlier choice stays selected.
  initial?: PoLink | null;
};

export default function CreatePoModal({ onClose, onConfirm, initial }: Props) {
  useScrollLock();
  const [mode, setMode] = useState<PoMode | null>(initial?.mode ?? null);
  const [shipment, setShipment] = useState(initial?.shipmentId ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // "With Shipment ID" needs a shipment; "Without" can continue straight away.
  const canConfirm = mode === 'without' || (mode === 'with' && !!shipment);

  const confirm = () => {
    if (!mode) return;
    if (mode === 'without') { onConfirm({ mode }); return; }
    const picked = SHIPMENTS.find((s) => s.id === shipment);
    onConfirm({ mode, shipmentId: shipment, customer: picked?.customer });
  };

  // No close on backdrop click: a stray click must not lose the user's choices.
  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl" role="dialog" aria-modal="true" aria-labelledby="cpo-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoDoc /></div>
            <div>
              <div className="spi-mdl-title" id="cpo-title">Create Purchase Order</div>
              <div className="spi-mdl-sub">Choose how to link this PO to your procurement workflow.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="spi-mdl-seclabel">LINK TO PROCUREMENT WORKFLOW</div>

          <button type="button" className={`spi-mdl-card ${mode === 'with' ? 'is-sel is-teal' : ''}`} onClick={() => setMode('with')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-teal"><IcoLink /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">With Shipment ID <span className="spi-mdl-badge spi-mdl-badge-teal">RECOMMENDED</span></div>
              <div className="spi-mdl-card-desc">3-way match &amp; complete audit trail.</div>
            </div>
            <span className={`spi-mdl-radio ${mode === 'with' ? 'is-on-teal' : ''}`}>{mode === 'with' && <IcoCheck />}</span>
          </button>

          {mode === 'with' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel"><IcoLink size={13} /> SELECT SHIPMENT ID <span className="spi-mdl-req">*</span></label>
              <ModalSelect
                value={shipment}
                placeholder="Select Shipment ID…"
                options={SHIPMENT_OPTIONS}
                onChange={setShipment}
              />
            </div>
          )}

          <button type="button" className={`spi-mdl-card ${mode === 'without' ? 'is-sel is-amber' : ''}`} onClick={() => setMode('without')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-amber"><IcoWarn /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">All Other PO’s (Without Shipment ID) <span className="spi-mdl-badge spi-mdl-badge-amber">STANDALONE</span></div>
              <div className="spi-mdl-card-desc">Create a PO not linked to any shipment.</div>
            </div>
            <span className={`spi-mdl-radio ${mode === 'without' ? 'is-on-amber' : ''}`}>{mode === 'without' && <IcoCheck />}</span>
          </button>

          {mode === 'without' && (
            <div className="spi-mdl-warn">
              <IcoWarn size={14} />
              <span><b>Standalone purchase order</b> — won't be linked to any shipment. Proceed directly to the PO form.</span>
            </div>
          )}
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-audit"><IcoClock /> All POs are audit-tracked</div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" disabled={!canConfirm} onClick={confirm}>
              Confirm &amp; Continue <IcoArrow />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IcoDoc() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 12l1.6 1.6L14 10" /><line x1="8" y1="17" x2="16" y2="17" /></svg>; }
function IcoLink({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>; }
function IcoWarn({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function IcoClock() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
function IcoArrow() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>; }
