// Create Purchase Order — step 1: choose how the PO links to the procurement workflow.
// Reuses the SPI "Map Invoice" modal styles (spi-mdl-*) and its dropdown; no CSS of its own.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { ModalSelect } from '../supplier-purchase-invoice/MapSupplierPurchaseInvoiceModal';
import type { PoLink } from './create-po/CreatePoForm';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import { IcoCheck, IcoChevronR, IcoClock, IcoDoc, IcoLink, IcoWarn, IcoX } from './icons';

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
            <IcoX />
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
              Confirm &amp; Continue <IcoChevronR />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

