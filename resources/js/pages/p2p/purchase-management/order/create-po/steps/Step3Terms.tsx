// Create PO — Step 03: PO Terms & Conditions.
// The recap of stages 01 and 02, then the terms the PO is issued under.
import { useState } from 'react';
import StageSummary from './StageSummary';
import type { PoDraft, SetDraft } from '../po-draft';
import { IcoChevron, IcoDocSm } from '../../icons';

export default function Step3Terms({ draft, set }: { draft: PoDraft; set: SetDraft }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <StageSummary draft={draft} upto={2} />

      <div className={`spi-dt-sec cpf-fill ${open ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head cpf-clickable" onClick={() => setOpen((o) => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoDocSm /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Terms</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">PO Terms &amp; Conditions</span>
            </div>
            <div className="spi-dt-sec-sub">Define the terms &amp; conditions for this purchase order</div>
          </div>
          <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body cpd-body">
          <div className="cpt-title">Terms &amp; Condition</div>
          <textarea
            className="spi-dt-textarea cpt-terms"
            placeholder="Enter purchase order terms & conditions…"
            value={draft.terms}
            onChange={(e) => set({ terms: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}
