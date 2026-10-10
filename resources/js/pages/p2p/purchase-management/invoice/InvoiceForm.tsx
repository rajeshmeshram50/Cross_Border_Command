import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import '../../p2p-detail.css';
import '../order/create-po/create-po.css';
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

const STAGES = [
  { title: 'Supplier Details', desc: 'Link the PO and confirm supplier details' },
  { title: 'Invoice & Product Details (3-Way Match)', desc: 'Enter invoice details & match products against the PO & GRN' },
  { title: 'Temporary Box Packaging', desc: 'Choose a packaging scenario and generate labelled, verified boxes' },
  { title: 'Temporary Putaway Allocation', desc: 'Assign a temporary putaway location for each product' },
] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface InvoiceFormInput {
  poId?: number;
  poNo?: string;
  supplier: string;
  storage: StorageChoice;
  invoiceNo?: string;
}

export default function InvoiceForm({
  input, invoiceNo, onClose,
}: {
  input: InvoiceFormInput;
  invoiceNo: string;
  onClose: () => void;
}) {
  const { draft, set } = useInvoiceDraft({
    supplier: input.supplier, invoiceNo, poNo: input.poNo,
    warehouse: warehouseLabel(input.storage),
  });

  const [lines, setLines] = useState<ProductLine[]>(PRODUCT_LINES);

  const changeLine = useCallback((index: number, patch: Partial<ProductLine>) => {
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const [stage, setStage] = useState(0);
  const [reached, setReached] = useState(0);

  useScrollLock(true, '.spi-dt-overlay');

  const goTo = (i: number) => { if (i <= reached) setStage(i); };
  const goNext = () => {
    if (stage >= STAGES.length - 1) return;
    const next = stage + 1;
    setStage(next);
    setReached(r => Math.max(r, next));
  };
  const goBack = () => (stage === 0 ? onClose() : setStage(stage - 1));

  const isLast = stage === STAGES.length - 1;

  return createPortal(
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
                <span className="spi-dt-step-ghost">{pad2(i + 1)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="spi-dt-body">
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

function warehouseLabel(storage: StorageChoice): string {
  if (storage.type === 'third-party') return 'Third Party Warehouse';
  return storage.warehouse?.name ?? '—';
}
