// Create PO — Step 03: PO Terms & Conditions.
// The recap of stages 01 and 02, then the terms the PO is issued under.
import { useState } from 'react';
import StageSummary from './StageSummary';
import type { PoDraft, SetDraft } from '../po-draft';
import type { StepCtx } from '../CreatePoForm';
import { IcoChevron, IcoDocSm } from '../../shared/icons';

// Same limit the server enforces.
const TERMS_MAX = 20000;

export default function Step3Terms({ draft, set, ctx }: { draft: PoDraft; set: SetDraft; ctx: StepCtx }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <StageSummary draft={draft} ctx={ctx} upto={2} />

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
            maxLength={TERMS_MAX}
            value={draft.terms}
            onChange={(e) => set({ terms: e.target.value })}
          />
          <div className="cpt-count">{draft.terms.length.toLocaleString('en-IN')} / {TERMS_MAX.toLocaleString('en-IN')}</div>
        </div>
      </div>
    </>
  );
}
