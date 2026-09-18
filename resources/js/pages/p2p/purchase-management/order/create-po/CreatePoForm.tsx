// Create PO — full-page form shell.
// The wizard chrome (overlay, header strip, stage cards, footer) is the shared
// P2P wizard design, so it reuses the existing spi-dt-* classes instead of
// repeating them. create-po.css only holds what is different for this form.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import Step1LinkSupplier from './steps/Step1LinkSupplier';
import Step2ProductDetails from './steps/Step2ProductDetails';
import { usePoDraft } from './po-draft';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './create-po.css';
import { IcoCard, IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLines, IcoShip, IcoTarget, IcoUser, IcoX } from '../icons';

// What the Create PO popup passes in: how this PO is linked.
export type PoLink = {
  mode: 'with' | 'without';
  shipmentId?: string;
  customer?: string;
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
  // The form owns what has been filled in, so each step can read the ones
  // before it (Step 02 recaps Step 01).
  const { draft, set } = usePoDraft();
  const [stage, setStage] = useState(0);
  // The body is the scroller now (the header strip stays put), so this is
  // what gets scrolled back to the top on a stage change.
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLast = stage === STAGES.length - 1;
  const goNext = () => { if (!isLast) setStage(stage + 1); };
  // On stage 1 the back button returns to the link popup, not to a previous stage.
  const goBack = () => { if (stage === 0) onChangeLink(); else setStage(stage - 1); };

  return createPortal(
    <div className="spi-dt-overlay cpf-form">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Purchase Order</div>
                <div className="spi-dt-head-sub">
                  {link.mode === 'with' ? 'Draft · not yet issued' : 'Draft · standalone, not yet issued'}
                </div>
              </div>
            </div>

            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value="PO/2025-26/001" mono />
              {link.mode === 'with' && (
                <>
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoShip />} label="SHIPMENT ID" value={link.shipmentId ?? '—'} alt mono />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoTarget />} label="OPPORTUNITY ID" value="OPP-001" mono />
                  <span className="spi-dt-dots">⋮</span>
                  <HeadPill icon={<IcoLines />} label="PI NUMBER" value="PI/2025-26/001" alt mono />
                  <span className="spi-dt-dots">⋮</span>
                  {/* A procurement is only linked once the PO is issued, so a
                      fresh draft doesn't show that pill yet. */}
                  <HeadPill icon={<IcoUser />} label="CUSTOMER NAME" value={link.customer ?? '—'} />
                </>
              )}
            </div>

            <div className="spi-dt-head-r">
              <span className="spi-dt-divider" />
              <button type="button" className="spi-dt-btn-pay"><IcoCard /> PO Payment</button>
              <span className="spi-dt-divider" />
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>

          <div className="spi-dt-steps cpf-steps4">
            {STAGES.map((s, i) => (
              <div
                key={s.title}
                className={`spi-dt-step spi-dt-step--nav ${i === stage ? 'is-active' : ''} ${i < stage ? 'is-done' : ''}`}
                role="button"
                tabIndex={0}
                title={`Go to Step ${i + 1}`}
                onClick={() => setStage(i)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStage(i); } }}
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

        <div className="spi-dt-body" ref={bodyRef}>
          {stage === 0 && <Step1LinkSupplier draft={draft} set={set} />}
          {stage === 1 && <Step2ProductDetails draft={draft} />}
          {stage > 1 && <div className="cpf-soon">{STAGES[stage].title} — coming next.</div>}
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
            <button type="button" className="spi-dt-btn-ghost" onClick={goBack}>
              <IcoChevronL /> {stage === 0 ? 'Change Link' : 'Back'}
            </button>
            <button type="button" className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'} onClick={goNext}>
              {NEXT_LABEL[stage]} <IcoChevronR />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HeadPill({ icon, label, value, mono, alt }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; alt?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div className="spi-dt-pill-txt">
        <div className="spi-dt-pill-lbl">{label}</div>
        <div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`} title={value}>{value}</div>
      </div>
    </div>
  );
}


