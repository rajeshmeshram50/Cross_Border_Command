import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import { createPortal } from 'react-dom';
import { Field } from '../../order/create-po/form-fields';
import { HeadPill } from '../../order/create-po/CreatePoForm';
import { IcoBox, IcoChevron, IcoDoc, IcoLines, IcoPaperclip, IcoPin, IcoPlus, IcoUndo, IcoUser, IcoVan } from '../../../icons';
import StageSummary from './StageSummary';
import ProductTable from './ProductTable';
import type { ProductLine, TaxMode } from '../invoice-products';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';

const CameraCaptureModal = lazy(() => import('../../order/physical-inspection/CameraCaptureModal'));

const ICON_PICK_UPLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const ICON_PICK_CAMERA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
  </svg>
);

export default function Step2InvoiceProducts({
  draft, set, lines, onChangeLine, onRemoveLine, onAddLine, removedCount = 0, onRestoreLines,
  taxMode, onPickFile, readOnly = false, direct = false, matched = true,
}: {
  draft: InvoiceDraft;
  set: SetDraft;
  lines: ProductLine[];
  onChangeLine: (index: number, patch: Partial<ProductLine>) => void;
  /** Drop a line the supplier did not invoice. The design's Action column. */
  onRemoveLine?: (index: number) => void;
  /** There is a proforma invoice behind this table to match against. */
  matched?: boolean;
  /** Add one the PI never carried. Omitted when read-only. */
  onAddLine?: () => void;
  /** How many lines have been taken off, and the way to put them all back. */
  removedCount?: number;
  onRestoreLines?: () => void;
  taxMode: TaxMode;
  onPickFile: (kind: 'invoice' | 'eway', file: File) => void;
  readOnly?: boolean;
  /* A Direct SPI matches the shipment's proforma invoice against the
     supplier's own — there is no purchase order in between. */
  direct?: boolean;
}) {
  const [invOpen, setInvOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);

  return (
    <>
      <StageSummary draft={draft} upto={1} />

      <div className={`spi-dt-sec ${invOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head cpf-clickable" onClick={() => setInvOpen(o => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoDoc /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Invoice</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Supplier Purchase Invoice &amp; E-Way Bill Details</span>
            </div>
            <div className="spi-dt-sec-sub">
              Enter invoice number, date, invoice &amp; e-way bill attachments
            </div>
          </div>
          <span className={`cpf-chev ${invOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body">
          <div className="spi-dt-grid4">
            <Field label="PURCHASE INVOICE NUMBER" req>
              <input className="spi-dt-inp" placeholder="Supplier's own invoice number" readOnly={readOnly}
                value={draft.invoiceNumber} onChange={e => set({ invoiceNumber: e.target.value })} />
            </Field>
            <Field label="PURCHASE INVOICE DATE" req>
              <MasterDatePicker value={draft.invoiceDate} onChange={v => set({ invoiceDate: v })} disabled={readOnly} />
            </Field>
            <Field label="PURCHASE INVOICE ATTACHMENT" req>
              <FilePick label="Purchase Invoice" value={draft.invoiceFile} onPick={f => onPickFile('invoice', f)} disabled={readOnly} />
            </Field>
            <Field label="E-WAY BILL ATTACHMENT">
              <FilePick label="E-Way Bill" value={draft.ewayBillFile} onPick={f => onPickFile('eway', f)} disabled={readOnly} />
            </Field>
          </div>
        </div>
      </div>

      <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head cpf-clickable" onClick={() => setProdOpen(o => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-3"><IcoBox /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Products</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Product Details ({direct ? '2' : '3'}-Way Match)</span>
            </div>
            <div className="spi-dt-sec-sub">
              {direct ? 'PI vs SPI product mapping & 2-way match' : 'PI vs PO vs SPI product mapping & 3-way match'}
            </div>
          </div>
          <div className="spi-dt-pills">
            <HeadPill icon={<IcoLines />} label="SUPPLIER CODE" value={draft.supplierCode} mono />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value={draft.supplier} alt />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoPin />} label="STATE CODE" value={draft.stateCode || '—'} mono />
            <span className="spi-dt-dots">⋮</span>
            {/* A Direct SPI has no purchase order to name here. The shipment
                is what took its place as the thing this invoice belongs to,
                so the slot carries that instead of an empty PO chip. */}
            {direct
              ? <HeadPill icon={<IcoVan />} label="SHIPMENT ID" value={draft.shipmentId || '—'} alt mono />
              : <HeadPill icon={<IcoLines />} label="PO NUMBER" value={draft.poNumber || '—'} alt mono />}
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoDoc />} label="PI NUMBER" value={draft.piNumber || '—'} mono />
          </div>
          <span className={`cpf-chev ${prodOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body">
          <ProductTable lines={lines} onChange={onChangeLine} onRemove={onRemoveLine} taxMode={taxMode} readOnly={readOnly}
            twoWay={direct} matched={matched}
            sourceNote={direct && draft.shipmentId ? `the PI of shipment ${draft.shipmentId}` : undefined} />
          {/* Directly under the totals, because it is a statement about the
              figures above it: they are short of a product the PI carried.
              It stays for as long as anything is missing, rather than passing
              like the toast does — the person who saves this invoice may not
              be the person who removed the line.

              `matched` is the condition it hangs on, and the sentence above is
              why: the bar reports a difference from the PI. With no shipment
              there is no PI, every line was typed in here by hand, and a
              deleted line is simply a line someone decided against — not
              something the invoice is now short of. "Restore all" there would
              offer to put back a document's products on an invoice that never
              had a document behind it. The toast still covers the undo for a
              mistaken click; it is the standing claim that does not hold. */}
          {matched && removedCount > 0 && onRestoreLines && !readOnly && (
            <div className="invf-removed">
              <span className="invf-removed__txt">
                {removedCount} product{removedCount === 1 ? '' : 's'} removed from this invoice
              </span>
              <button type="button" className="invf-removed__btn" onClick={onRestoreLines}>
                <IcoUndo /> Restore {removedCount === 1 ? 'it' : 'all'}
              </button>
            </div>
          )}
          {/* Under the table, at the end of the row of controls it belongs to
              — it undoes the Action column, so it sits on that side. */}
          {onAddLine && !readOnly && (
            <button type="button" className="cpf-addbtn invf-addprod" onClick={onAddLine}>
              <IcoPlus /> Add Product
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function FilePick({ label, value, onPick, disabled = false }: { label: string; value: string; onPick: (file: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  const openMenu = () => {
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    const H = 158;
    const below = r.bottom + 6 + H <= window.innerHeight - 12;
    setPickAt({
      top: below ? r.bottom + 6 : Math.max(12, r.top - H - 6),
      left: r.left,
      width: Math.min(320, Math.max(268, r.width)),
    });
  };

  useEffect(() => {
    if (!pickAt) return;
    const close = () => setPickAt(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.arf-att') || (t && btnRef.current?.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickAt]);

  return (
    <div ref={rowRef} className="spi-dt-file">
      <span className="spi-dt-file-txt"><IcoPaperclip /> {value || 'Choose file…'}</span>
      <button
        type="button"
        ref={btnRef}
        className="spi-dt-file-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!pickAt}
        onClick={openMenu}
      >
        Browse
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />

      {pickAt && createPortal(
        <div className="arf-att" role="menu" onClick={e => e.stopPropagation()}
          style={{ top: pickAt.top, left: pickAt.left, width: pickAt.width }}>
          <div className="arf-att__hd">Add attachment</div>
          <button type="button" className="arf-att__opt" role="menuitem"
            onClick={() => { setPickAt(null); ref.current?.click(); }}>
            <span className="arf-att__ico">{ICON_PICK_UPLOAD}</span>
            <span><b>Upload file</b><i>Choose from this device</i></span>
          </button>
          <button type="button" className="arf-att__opt" role="menuitem"
            onClick={() => { setPickAt(null); setCamOpen(true); }}>
            <span className="arf-att__ico arf-att__ico--cam">{ICON_PICK_CAMERA}</span>
            <span><b>Take photo</b><i>Capture with the camera</i></span>
          </button>
        </div>,
        document.body,
      )}

      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal
            title={`Photograph the ${label.toLowerCase()}`}
            subject={label}
            namePrefix={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
            max={1}
            onAttach={shots => { if (shots[0]) onPick(shots[0]); setCamOpen(false); }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
