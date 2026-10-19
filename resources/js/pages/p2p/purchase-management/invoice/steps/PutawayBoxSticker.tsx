/**
 * Stage 04 — Temporary Putaway Sticker.
 *
 * What gets printed and stuck on the carton, previewed before it is: the SPI
 * and box number, what is inside, and the QR a scanner reads to confirm the
 * two match. Opened from the "{box} Sticker" button on a box card and in the
 * Review pane.
 *
 * It replaces a plain "Box QR Code" dialog that showed the code and the box id
 * and nothing else — enough to scan, not enough to check you are labelling the
 * right carton.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';

const IcoTag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const IcoDown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IcoPrint = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);
const IcoTickSm = () => (
  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);

export default function PutawayBoxSticker({
  boxId, spiNumber, scenario, product, code, mode, condition,
  sku, qty, date, qr, onClose, onPdf, onPrint,
}: {
  boxId: string;
  spiNumber: string;
  /** "S1 — Single", and so on — the short form the label carries. */
  scenario: string;
  product: string;
  code: string;
  mode: string;
  condition: string;
  sku: string;
  qty: number;
  date: string;
  qr: ReactNode;
  onClose: () => void;
  onPdf?: () => void;
  onPrint?: () => void;
}) {
  useScrollLock(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="vsm-bd"
      /* Only a press that starts AND ends on the backdrop closes it, so
         releasing a drag begun inside the card does not dismiss it. */
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="vsm-box" role="dialog" aria-modal="true" aria-label="Temporary putaway sticker" tabIndex={-1} ref={ref}>
        <div className="vsm-head">
          <div className="vsm-hl">
            <div className="vsm-ico"><IcoTag /></div>
            <div>
              <div className="vsm-ht">Temporary Putaway Sticker</div>
              <div className="vsm-hs">
                <span>{boxId}</span><span className="vsm-hsd" />
                <span>{scenario}</span><span className="vsm-hsd" />
                <span className="vsm-hb"><IcoTickSm /> Temporary</span>
              </div>
            </div>
          </div>
          <button type="button" className="vsm-cl" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {/* The label itself, drawn as it will print. */}
        <div className="vsm-body">
          <div className="vsm-card">
            <div className="vsm-strip">
              <div className="vsm-sl"><span className="vsm-ll">SPI Number</span><span className="vsm-sv">{spiNumber}</span></div>
              <div className="vsm-sr"><span className="vsm-ll">Box No.</span><span className="vsm-bv">{boxId}</span></div>
            </div>
            <div className="vsm-info">
              <div className="vsm-pn">{product}</div>
              <div className="vsm-tags">
                <span className="vsm-tag vsm-tc">{code}</span>
                <span className="vsm-tag vsm-tm">{mode}</span>
                <span className="vsm-tag vsm-tg"><IcoTickSm /> {condition}</span>
              </div>
            </div>
            <div className="vsm-qr">
              <div className="vsm-qf"><div className="vsm-qi">{qr}</div></div>
              <div className="vsm-qr-right">
                <div className="vsm-scl">Scan to Verify</div>
                <div className="vsm-dr"><span className="vsm-dl">SKU</span><span className="vsm-dvm">{sku}</span></div>
                <div className="vsm-dr"><span className="vsm-dl">Quantity</span><span className="vsm-dv">{qty} Units</span></div>
                <div className="vsm-dr"><span className="vsm-dl">Date</span><span className="vsm-dv">{date}</span></div>
                <div className="vsm-dr"><span className="vsm-dl">Scenario</span><span className="vsm-dv">{scenario}</span></div>
              </div>
            </div>
            <div className="vsm-ft">
              <div className="vsm-qty"><span className="vsm-dot" />Qty: {qty} u</div>
              <span className="vsm-dt">{date}</span>
            </div>
          </div>
        </div>

        <div className="vsm-mft">
          <span className="vsm-hint">{spiNumber}</span>
          <div className="vsm-acts">
            <button type="button" className="vsm-bpdf" onClick={onPdf ?? onClose}><IcoDown />PDF</button>
            <button type="button" className="vsm-bprint" onClick={onPrint ?? (() => window.print())}>
              <IcoPrint />Print Label
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
