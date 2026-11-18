import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePopup } from './popupHooks';
import { IcoPen, IcoX } from './icons';
import './popup-shell.css';
import './assign-target-modal.css';

/* Read a product's clarity note (Text clarity): the full note, its line breaks kept, in the same
   small popup as the Product Clarity dialog. Opened from the "Text note" chip in the Edit form's
   product list and in the Sourcing Target Report. Edit (when given) opens the Clarity dialog. */

export default function ClarityNoteView({ productName, note, onClose, onEdit }: {
  productName: string; note: string; onClose: () => void; onEdit?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose });   // Esc / × / Close; a click on the backdrop does nothing
  return createPortal(
    <div className="sta-overlay sta-overlay--top">
      <div ref={dialogRef} className="sta-modal sta-modal--sm" role="dialog" aria-modal="true" aria-label={`Clarity note — ${productName}`}>
        <div className="sta-head sta-head--sm">
          <div className="sta-head-ico"><IcoPen size={16} stroke="#fff" /></div>
          <div className="sta-head-txt">
            <div className="sta-title">Clarity Note</div>
            <div className="sta-sub">{productName}</div>
          </div>
          <button type="button" className="sta-close sta-close--sm" aria-label="Close" onClick={onClose}><IcoX size={14} /></button>
        </div>
        <div className="sta-pop-body sct-scroller">
          <div className="sta-note-view">{note}</div>
          <div className="sta-pop-foot">
            <button type="button" className="sta-btn sta-btn-ghost" onClick={onClose}>Close</button>
            {onEdit && <button type="button" className="sta-btn sta-btn-primary" onClick={onEdit}>Edit Clarity</button>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
