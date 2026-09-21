// Create Purchase Order — step 1: choose how the PO links to the procurement workflow.
// Reuses the SPI "Map Invoice" modal styles (spi-mdl-*) and the app's MasterSelect
// dropdown. Where the prototype differs, order.css overrides them under .ord-cpo only.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import type { PoLink } from './CreatePoForm';
import { poLookupApi, type ShipmentOption } from '../api/po-api';
import { useToast } from '../../../../../contexts/ToastContext';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import { IcoCheck, IcoChevronR, IcoClock, IcoDoc, IcoLink, IcoWarn, IcoX } from '../shared/icons';

type PoMode = 'with' | 'without';


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
  const toast = useToast();
  const [shipment, setShipment] = useState(initial?.shipment ? String(initial.shipment.id) : '');
  // Only shipments that have a PI can take a PO — its lines are ordered against the PI.
  const [shipments, setShipments] = useState<ShipmentOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    poLookupApi.shipments()
      .then((rows) => { if (alive) setShipments(rows.filter((r) => r.proforma_invoice_id)); })
      .catch((e) => { if (alive) { setShipments([]); toast.error('Could not load shipments', e.firstError); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shipmentOptions = (shipments ?? []).map((s) => ({
    value: String(s.id), label: `${s.code} — ${s.customer ?? 'No customer'}${s.pi_number ? ` · ${s.pi_number}` : ''}`,
  }));

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
    const picked = shipments?.find((s) => String(s.id) === shipment);
    if (picked) onConfirm({ mode, shipment: picked });
  };

  // No close on backdrop click: a stray click must not lose the user's choices.
  return createPortal(
    <div className="spi-mdl-backdrop">
      {/* ord-cpo scopes this popup's Figma values; the base spi-mdl styles are shared with SPI. */}
      <div className="spi-mdl ord-cpo" role="dialog" aria-modal="true" aria-labelledby="cpo-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoDoc size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="cpo-title">Create Purchase Order</div>
              <div className="spi-mdl-sub">Choose how to link this PO to your procurement workflow.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={15} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="spi-mdl-seclabel">LINK TO PROCUREMENT WORKFLOW</div>

          <button type="button" className={`spi-mdl-card ${mode === 'with' ? 'is-sel is-teal' : ''}`} onClick={() => setMode('with')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-teal"><IcoLink size={20} /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">With Shipment ID <span className="spi-mdl-badge spi-mdl-badge-teal">RECOMMENDED</span></div>
              <div className="spi-mdl-card-desc">3-way match &amp; complete audit trail.</div>
            </div>
            <span className={`spi-mdl-radio ${mode === 'with' ? 'is-on-teal' : ''}`}>{mode === 'with' && <IcoCheck size={13} />}</span>
          </button>

          {mode === 'with' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel"><IcoLink size={20} /> SELECT SHIPMENT ID <span className="spi-mdl-req">*</span></label>
              <MasterSelect
                value={shipment}
                placeholder={shipments === null ? 'Loading shipments…' : shipmentOptions.length ? 'Select Shipment ID…' : 'No shipment with a PI yet'}
                options={shipmentOptions}
                onChange={setShipment}
              />
            </div>
          )}

          <button type="button" className={`spi-mdl-card ${mode === 'without' ? 'is-sel is-amber' : ''}`} onClick={() => setMode('without')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-amber"><IcoWarn size={20} /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">All Other PO’s (Without Shipment ID) <span className="spi-mdl-badge spi-mdl-badge-amber">STANDALONE</span></div>
              <div className="spi-mdl-card-desc">Create a PO not linked to any shipment.</div>
            </div>
            <span className={`spi-mdl-radio ${mode === 'without' ? 'is-on-amber' : ''}`}>{mode === 'without' && <IcoCheck size={13} />}</span>
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

