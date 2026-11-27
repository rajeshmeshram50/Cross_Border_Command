import type { ComponentType, Ref } from 'react';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import { IcoBack, IcoCheck, IcoFlag, IcoGlobe, IcoNext, IcoUserPlus, IcoX } from './icons';
import './supplier-master-form.css';

/* Map Supplier → choose Domestic or International before the form (Figma):
     · New Supplier: "New Supplier — Register a new supplier for <product>", a New badge per card;
     · Supplier Master: "Supplier Master — Choose the supplier type for <product>", and how many
       Supplier Master suppliers each origin has ("51 available").
   Shares the Supplier Master form's header, footer and buttons (stsm-*); a card click goes on
   straight away (no Continue), as in the design. */


const CARDS: { scope: SupplierScope; icon: ComponentType; title: string; desc: string; pills: string[] }[] = [
  { scope: 'domestic', icon: () => <IcoFlag size={20} sw={2} />, title: 'Domestic Supplier', desc: 'Supplier based in India — price in ₹ with GST applied', pills: ['INR (₹)', 'GST %', 'State'] },
  { scope: 'international', icon: () => <IcoGlobe size={20} sw={2} />, title: 'International Supplier', desc: 'Overseas supplier — price in its currency, no GST charged', pills: ['Currency', 'Exchange Rate', 'No GST'] },
];

type Props = {
  /** 'new' (default) for New Supplier, 'master' for Supplier Master. */
  mode?: 'new' | 'master';
  /** Supplier Master: suppliers available per origin (null while loading). */
  counts?: Record<SupplierScope, number> | null;
  productName: string;
  dialogRef: Ref<HTMLDivElement>;
  onChoose: (scope: SupplierScope) => void;
  onBack: () => void;
  onCancel: () => void;
};

export default function SupplierTypeChooser({ mode = 'new', counts, productName, dialogRef, onChoose, onBack, onCancel }: Props) {
  const master = mode === 'master';
  return (
    <div ref={dialogRef} className="stsm-box stsm-box--choose" role="dialog" aria-modal="true" aria-labelledby="stsm-choose-title">
      <div className="stsm-hd">
        <div className="stsm-hd__ico"><IcoUserPlus size={18} sw={2.2} /></div>
        <div className="stsm-hd__txt">
          <div className="stsm-hd__t" id="stsm-choose-title">{master ? 'Supplier Master' : 'New Supplier'}</div>
          <div className="stsm-hd__s">{master ? 'Choose the supplier type for ' : 'Register a new supplier for '}<b>{productName}</b></div>
        </div>
        <button type="button" className="stsm-x" aria-label="Close" onClick={onCancel}><IcoX size={13} sw={2.8} /></button>
      </div>

      <div className="stsm-bd">
        <div className="stsm-ocgrid">
          {CARDS.map(c => (
            <button key={c.scope} type="button" className={`stsm-oc stsm-oc--${c.scope}`} onClick={() => onChoose(c.scope)}>
              <span className="stsm-oc__ico"><c.icon /></span>
              <span className="stsm-oc__t">{c.title}<em>{master ? (counts ? `${counts[c.scope]} available` : '…') : 'New'}</em></span>
              <span className="stsm-oc__d">{c.desc}</span>
              <span className="stsm-oc__ft">
                <span className="stsm-oc__pills">
                  {c.pills.map(p => <span key={p}><IcoCheck size={8} sw={3.4} />{p}</span>)}
                </span>
                <span className="stsm-oc__go" aria-hidden><IcoNext size={13} sw={2.6} /></span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="stsm-ft">
        <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onBack}><IcoBack size={12} sw={2.6} />Back</button>
        <span className="stsm-ft__sp" />
        <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
