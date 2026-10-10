import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
/* The shared P2P wizard chrome, and nothing of our own.
   `p2p-detail.css` carries the spi-dt-* shell — overlay, head
   strip, pills, step cards, body and footer. `create-po.css` is imported for
   `.cpf-steps4`, the four-column step grid: the shared grid is two columns
   because the old SPI wizard has two stages, and the Create PO form already
   solved this exact problem. Between them there is nothing left for this form
   to define, which is why there is no invoice-form.css. */
import '../../p2p-detail.css';
import '../order/create-po/create-po.css';
/* Last, so it wins: the few places this form is deliberately not the PO. */
import './invoice-form.css';
import { HeadPill } from '../order/create-po/CreatePoForm';
import {
  IcoCheck, IcoChevronL, IcoChevronR, IcoDoc, IcoLines, IcoUser, IcoWarehouse, IcoX,
} from '../../icons';
import Step1SupplierDetails from './steps/Step1SupplierDetails';
import Step2InvoiceProducts from './steps/Step2InvoiceProducts';
import Step3BoxPackaging from './steps/Step3BoxPackaging';
import { useInvoiceDraft } from './invoice-draft';
import { PRODUCT_LINES, type ProductLine } from './invoice-products';
import type { StorageChoice } from './StorageSelectionModal';

/** The four stages of raising a supplier purchase invoice. */
const STAGES = [
  { title: 'Supplier Details', desc: 'Link the PO and confirm supplier details' },
  { title: 'Invoice & Product Details (3-Way Match)', desc: 'Enter invoice details & match products against the PO & GRN' },
  { title: 'Temporary Box Packaging', desc: 'Choose a packaging scenario and generate labelled, verified boxes' },
  { title: 'Temporary Putaway Allocation', desc: 'Assign a temporary putaway location for each product' },
] as const;

/** Two digits, as every label on this screen is written: "01", not "1". */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** What the storage wizard hands this form once it finishes. */
export interface InvoiceFormInput {
  /** The PO this invoice is matched against, when there is one. */
  poNo?: string;
  /** The supplier it belongs to. Always known: a standalone invoice is
   *  anchored to a supplier instead of a PO. */
  supplier: string;
  storage: StorageChoice;
  /** Set when an existing invoice is being edited; a new one has no number
   *  until the server allocates it. */
  invoiceNo?: string;
}

/**
 * Supplier Purchase Invoice — the four-step form.
 *
 * Opens once the storage wizard completes. Every class is `spi-dt-*` from the
 * shared P2P wizard chrome, laid out exactly as the Create PO form lays out
 * its own four stages, so the two wizards are the same object with different
 * words rather than two implementations of one design.
 *
 * Portalled to document.body: it is a full-screen overlay, and anything
 * rendered inside the list page would sit within `.ord-table-scroll` and be
 * clipped at the table's edge.
 */
export default function InvoiceForm({
  input, invoiceNo, onClose,
}: {
  input: InvoiceFormInput;
  /** The code this invoice will carry. Allocated by the server in the end;
   *  passed in so the form never invents one. */
  invoiceNo: string;
  onClose: () => void;
}) {
  /* Everything the four steps collect. Held here, not inside a step, because
     Step 02 opens with a read-only recap of Step 01 — a step cannot summarise
     state it does not own. */
  const { draft, set } = useInvoiceDraft({
    supplier: input.supplier, invoiceNo, poNo: input.poNo,
    warehouse: warehouseLabel(input.storage),
  });

  /* The invoice's product lines. Step 02 edits them and Step 03 turns them
     into boxes, so they belong to the form rather than to either step. Kept
     out of the draft because they are a list edited in place — threading
     every keystroke through one draft object would re-render every field in
     the wizard. */
  const [lines, setLines] = useState<ProductLine[]>(PRODUCT_LINES);

  /* Stable, which is what makes `memo` on the table row worth having: a fresh
     function each render would re-render every row on every keystroke. */
  const changeLine = useCallback((index: number, patch: Partial<ProductLine>) => {
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const [stage, setStage] = useState(0);
  /* The furthest step reached. The stepper is clickable backwards but not
     forwards — jumping ahead would skip the save the next step depends on. */
  const [reached, setReached] = useState(0);

  /* `.spi-dt-overlay` scrolls its own body, so the page behind it is locked
     while that one element stays scrollable. */
  useScrollLock(true, '.spi-dt-overlay');

  const goTo = (i: number) => { if (i <= reached) setStage(i); };
  const goNext = () => {
    if (stage >= STAGES.length - 1) return;
    const next = stage + 1;
    setStage(next);
    setReached(r => Math.max(r, next));
  };
  /* Back off step 01 leaves the form entirely — that is where the storage
     wizard was, which is why the label says "Change Selection" rather than
     "Back". */
  const goBack = () => (stage === 0 ? onClose() : setStage(stage - 1));

  const isLast = stage === STAGES.length - 1;

  return createPortal(
    /* `cpf-form` is not decoration: create-po.css scopes SIXTY refinements
       under it — the overlay's own layout, and the real look of the legal bar,
       the risk rows, the guideline block and the GST banner. Without it the
       page falls back to the unscoped base rules and renders a thicker bar and
       flatter badges than the design. The PO form carries the same class. */
    <div className="spi-dt-overlay cpf-form">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Supplier Purchase Invoice</div>
                <div className="spi-dt-head-sub">Draft · not yet mapped</div>
              </div>
            </div>

            {/* The four references this invoice is being raised against. The
                ⋮ between them is the chrome's own separator, not a character
                in any value. */}
            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="INVOICE NO" value={invoiceNo} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value={input.poNo ?? '—'} alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={input.supplier} />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={warehouseLabel(input.storage)} alt />
            </div>

            <div className="spi-dt-head-r">
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
                title={i <= reached ? `Go to Step ${i + 1}` : 'Finish the current step first'}
                onClick={() => goTo(i)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } }}
              >
                <div className="spi-dt-step-top">
                  <span className="spi-dt-step-lbl">STEP {pad2(i + 1)}</span>
                  {i === stage && <span className="spi-dt-step-badge">ACTIVE</span>}
                  {i < stage && <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
                </div>
                <div className="spi-dt-step-big">{pad2(i + 1)}</div>
                <div className="spi-dt-step-title">{s.title}</div>
                <div className="spi-dt-step-desc">{s.desc}</div>
                {/* The oversized number bled into the card's corner. */}
                <span className="spi-dt-step-ghost">{pad2(i + 1)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spi-dt-body">
          {/* Step 04 is the next piece of work. Each step is its own file
              under steps/, the way the Create PO form splits its four. */}
          {stage === 0 && <Step1SupplierDetails draft={draft} set={set} />}
          {stage === 1 && (
            <Step2InvoiceProducts draft={draft} set={set} lines={lines}
              onChangeLine={changeLine} />
          )}
          {stage === 2 && <Step3BoxPackaging draft={draft} lines={lines} />}
        </div>

        <div className="spi-dt-foot">
          <div className="spi-dt-foot-l">
            <div>
              <div className="spi-dt-foot-step">STEP {pad2(stage + 1)} OF {pad2(STAGES.length)}</div>
              <div className="spi-dt-foot-name">{STAGES[stage].title}</div>
            </div>
            <div className="spi-dt-dots">
              {STAGES.map((s, i) => (
                <span key={s.title} className={i === stage ? 'on' : i < stage ? 'done' : ''} />
              ))}
            </div>
          </div>
          <div className="spi-dt-foot-r">
            <button type="button" className="spi-dt-btn-ghost" onClick={goBack}>
              <IcoChevronL /> {stage === 0 ? 'Change Selection' : 'Back'}
            </button>
            {/* The last step maps the invoice rather than moving on, so it is
                the green button with a tick — every other step is teal. This is
                how the Create PO form marks its own submit. */}
            <button
              type="button"
              className={isLast ? 'spi-dt-btn-map' : 'spi-dt-btn-next'}
              onClick={goNext}
            >
              {isLast && <IcoCheck />}
              {isLast ? 'Map Invoice' : 'Save & Next'}
              {!isLast && <IcoChevronR />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What the WAREHOUSE pill shows: our chosen site, or that it is external. */
function warehouseLabel(storage: StorageChoice): string {
  if (storage.type === 'third-party') return 'Third Party Warehouse';
  return storage.warehouse?.name ?? '—';
}
