import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import { useToast } from '../../../../../contexts/ToastContext';
import { createPortal } from 'react-dom';
import { Field } from '../../order/create-po/form-fields';
import { HeadPill } from '../../order/create-po/CreatePoForm';
import { IcoBox, IcoChevron, IcoDoc, IcoLines, IcoPaperclip, IcoPin, IcoPlus, IcoUndo, IcoUser, IcoVan } from '../../../icons';
import StageSummary from './StageSummary';
import ProductTable from './ProductTable';
import type { ProductLine, TaxMode } from '../invoice-products';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';
import { today } from '../invoice-draft';

const CameraCaptureModal = lazy(() => import('../../order/physical-inspection/CameraCaptureModal'));

const FILE_NAME_MAX = 25;

/* The server's own rule for invoice_file / eway_file (SupplierInvoiceController,
   mimes:pdf,jpg,jpeg,png,webp max:10240). Checked here too, at the pick, so a
   Word or Excel file is refused before it is ever attached rather than at
   Update & Next. */
const ATTACH_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const ATTACH_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const ATTACH_MAX_MB = 10;

function attachProblem(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ATTACH_EXT.includes(ext)) return `"${file.name}" is not allowed. Attach a PDF or an image (JPG, PNG, WEBP).`;
  if (file.size > ATTACH_MAX_MB * 1024 * 1024) return `"${file.name}" is larger than ${ATTACH_MAX_MB} MB.`;
  return null;
}

/** What Stage 02 still lacks, field by field. Rows are keyed by line index. */
export interface Stage2Issues {
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceFile?: string;
  rows: Record<number, { product?: string; qty?: string }>;
}

/* Everything that turns red on this step, in the order it appears on the
   page — querySelector returns the first in document order, which is the
   one to take the user to. */
const INVALID_SEL = [
  '.spi-invform .spi-dt-inp.is-invalid',
  '.spi-invform .master-datepicker-wrap.invalid',
  '.spi-invform .spi-dt-file.is-invalid',
  '.spi-invform .cpd-cell-err',
].join(', ');

/** Scrolls the first flagged field to the middle of the view and puts the
 *  cursor in it — an input directly, a picker or file row by its own control. */
function focusFirstInvalid() {
  const el = document.querySelector<HTMLElement>(INVALID_SEL);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  const target = el.matches('input')
    ? el
    : el.querySelector<HTMLElement>('input:not([type="hidden"]):not([hidden]), button:not(:disabled), [tabindex="0"]');
  target?.focus({ preventScroll: true });
}

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
  taxMode, onPickFile, readOnly = false, direct = false, matched = true, issues, check = 0,
}: {
  /** Shown only after an Update & Next has been refused; undefined before. */
  issues?: Stage2Issues;
  /** Goes up on every refused Update & Next — each one takes the user to the
   *  first missing field again, even when the list itself has not changed. */
  check?: number;
  draft: InvoiceDraft;
  set: SetDraft;
  lines: ProductLine[];
  onChangeLine: (index: number, patch: Partial<ProductLine>) => void;
  onRemoveLine?: (index: number) => void;
  matched?: boolean;
  onAddLine?: () => void;
  removedCount?: number;
  onRestoreLines?: () => void;
  taxMode: TaxMode;
  onPickFile: (kind: 'invoice' | 'eway', file: File) => void;
  readOnly?: boolean;
  direct?: boolean;
}) {
  const [invOpen, setInvOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);

  const openRef = useRef({ invOpen, prodOpen });
  openRef.current = { invOpen, prodOpen };
  useEffect(() => {
    if (!check || !issues) return;
    const inHead = !!(issues.invoiceNumber || issues.invoiceDate || issues.invoiceFile);
    const inRows = Object.keys(issues.rows).length > 0;
    let wait = 30;
    if (inHead && !openRef.current.invOpen) { setInvOpen(true); wait = 320; }
    else if (!inHead && inRows && !openRef.current.prodOpen) { setProdOpen(true); wait = 320; }
    const t = window.setTimeout(focusFirstInvalid, wait);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const poHasPi = !!draft.piNumber || lines.some(l => l.piItemId != null);
  const headPills = [
    <HeadPill key="code" icon={<IcoLines />} label="SUPPLIER CODE" value={draft.supplierCode} mono />,
    <HeadPill key="name" icon={<IcoUser />} label="SUPPLIER NAME" value={draft.supplier} alt />,
    <HeadPill key="state" icon={<IcoPin />} label="STATE CODE" value={draft.stateCode || '—'} mono />,
  ];
  if (!direct) {
    headPills.push(
      <HeadPill key="po" icon={<IcoLines />} label="PO NUMBER" value={draft.poNumber || '—'} alt mono />,
      ...(poHasPi ? [<HeadPill key="pi" icon={<IcoDoc />} label="PI NUMBER" value={draft.piNumber || '—'} mono />] : []),
    );
  } else if (draft.shipmentId) {
    headPills.push(
      <HeadPill key="ship" icon={<IcoVan />} label="SHIPMENT ID" value={draft.shipmentId} alt mono />,
      <HeadPill key="pi" icon={<IcoDoc />} label="PI NUMBER" value={draft.piNumber || '—'} mono />,
    );
  }

  return (
    <>
      <StageSummary draft={draft} upto={1} direct={direct} />

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
            <Field label="PURCHASE INVOICE NUMBER" req error={issues?.invoiceNumber}>
              <input className={`spi-dt-inp${issues?.invoiceNumber ? ' is-invalid' : ''}`}
                placeholder="Supplier's own invoice number" readOnly={readOnly}
                aria-invalid={!!issues?.invoiceNumber || undefined}
                value={draft.invoiceNumber} onChange={e => set({ invoiceNumber: e.target.value })} />
            </Field>
            <Field label="PURCHASE INVOICE DATE" req error={issues?.invoiceDate}>
              {/* The supplier cannot bill before the order was placed. A Direct
                  SPI has no purchase order, so nothing to hold it to. */}
              <MasterDatePicker value={draft.invoiceDate} onChange={v => set({ invoiceDate: v })} disabled={readOnly}
                invalid={!!issues?.invoiceDate}
                minDate={!direct && draft.poDate ? draft.poDate : undefined} maxDate={today()} />
            </Field>
            <Field label="PURCHASE INVOICE ATTACHMENT" req error={issues?.invoiceFile}>
              <FilePick label="Purchase Invoice" value={draft.invoiceFile} onPick={f => onPickFile('invoice', f)} disabled={readOnly}
                invalid={!!issues?.invoiceFile} />
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
              <span className="spi-dt-sec-title">Product Details ({direct || !poHasPi ? '2' : '3'}-Way Match)</span>
            </div>
            <div className="spi-dt-sec-sub">
              {direct ? 'PI vs SPI product mapping & 2-way match'
                : poHasPi ? 'PI vs PO vs SPI product mapping & 3-way match'
                : 'PO vs SPI product mapping & 2-way match'}
            </div>
          </div>
          <div className="spi-dt-pills">
            {headPills.map((pill, i) => (
              <Fragment key={pill.key}>
                {i > 0 && <span className="spi-dt-dots">⋮</span>}
                {pill}
              </Fragment>
            ))}
          </div>
          <span className={`cpf-chev ${prodOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body">
          <ProductTable lines={lines} onChange={onChangeLine} onRemove={onRemoveLine} taxMode={taxMode} readOnly={readOnly}
            twoWay={direct} matched={matched} hasPi={direct || poHasPi} rowIssues={issues?.rows}
            supplierSegments={draft.supplierDetail?.segments ?? null}
            supplierProducts={draft.supplierDetail?.mapped_product_ids ?? null}
            sourceNote={direct && draft.shipmentId ? `the PI of shipment ${draft.shipmentId}` : undefined} />
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
          {/* Only a Direct SPI without a shipment can add lines. A With-PO
              invoice bills what the PO ordered, and a shipment-linked one
              bills its PI, so both take their products from the source. */}
          {onAddLine && !readOnly && direct && !draft.shipmentId && (
            <button type="button" className="cpf-addbtn invf-addprod" onClick={onAddLine}>
              <IcoPlus /> Add Product
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function FilePick({ label, value, onPick, disabled = false, invalid = false }: { label: string; value: string; onPick: (file: File) => void; disabled?: boolean; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const toast = useToast();
  const take = (f: File) => {
    const problem = attachProblem(f);
    if (problem) { toast.error('File type not allowed', problem); return; }
    onPick(f);
  };

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
    <div ref={rowRef} className={`spi-dt-file${invalid ? ' is-invalid' : ''}`}>
      {/* Long names are cut at 25 characters; the full one is in the tooltip. */}
      <Tooltip label={value && value.length > FILE_NAME_MAX ? value : undefined}>
        <span className="spi-dt-file-txt">
          <IcoPaperclip /> {value ? (value.length > FILE_NAME_MAX ? `${value.slice(0, FILE_NAME_MAX)}…` : value) : 'Choose file…'}
        </span>
      </Tooltip>
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
        accept={ATTACH_ACCEPT}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) take(f);
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
            onAttach={shots => { if (shots[0]) take(shots[0]); setCamOpen(false); }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
