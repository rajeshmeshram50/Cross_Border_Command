import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field } from '../../order/create-po/form-fields';
import { HeadPill } from '../../order/create-po/CreatePoForm';
import { IcoBox, IcoChevron, IcoCheck, IcoDoc, IcoLines, IcoPaperclip, IcoPin, IcoSave, IcoUser } from '../../../icons';
import StageSummary from './StageSummary';
import ProductTable from './ProductTable';
import { DEFAULT_HOME_STATE_CODE, taxModeFor, type ProductLine } from '../invoice-products';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';

/* The same camera sheet the payment screens use, loaded only once someone
   asks for it — it pulls in getUserMedia handling no other field needs. */
const CameraCaptureModal = lazy(() => import('../../order/physical-inspection/CameraCaptureModal'));

/* The menu's two glyphs, matching the payment screens' attachment menu. */
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

/**
 * Step 02 — Invoice & Product Details (3-Way Match).
 *
 * Three sections: the recap of Step 01, the invoice's own number, date and
 * attachments, then the PI vs PO vs SPI product table.
 */
export default function Step2InvoiceProducts({
  draft, set, lines, onChangeLine, onRemoveLine,
}: {
  draft: InvoiceDraft;
  set: SetDraft;
  /* The lines belong to the form, not to this step: Step 03 turns the same
     list into boxes, so neither step can be the one that owns it. */
  lines: ProductLine[];
  onChangeLine: (index: number, patch: Partial<ProductLine>) => void;
  onRemoveLine: (index: number) => void;
}) {
  const [invOpen, setInvOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);

  /* How this supplier's GST splits, from the two things that decide it: the
     country says whether Indian GST arises at all, and only then does the
     supplier's state against our own decide CGST+SGST or IGST. Derived here
     rather than stored, the way the purchase order derives it server-side.

     The home state is the fallback until the branch's own GSTIN is loaded —
     the same Maharashtra default `App\Support\Gst` uses when a branch carries
     neither a gst_state_code nor a GSTIN. */
  const taxMode = taxModeFor(draft.country, draft.stateCode, DEFAULT_HOME_STATE_CODE);

  /* Whether what is on screen has been saved. Reset on any edit below, because
     a button that still reads "Saved" over a changed table is worse than one
     that never said it. */
  const [saved, setSaved] = useState(false);
  const saveProducts = () => setSaved(true);

  /* The table's own handlers, wrapped so an edit un-saves the section. The
     wrapping happens here rather than in the table, which has no business
     knowing this section has a save button.

     Memoised on purpose: the form hands these down already wrapped in
     `useCallback` so `memo` on the table row is worth having, and a fresh
     function here each render would undo that and re-render every row on
     every keystroke. */
  const changeLine = useCallback((index: number, patch: Partial<ProductLine>) => {
    setSaved(false);
    onChangeLine(index, patch);
  }, [onChangeLine]);
  const removeLine = useCallback((index: number) => {
    setSaved(false);
    onRemoveLine(index);
  }, [onRemoveLine]);

  return (
    <>
      <StageSummary draft={draft} upto={1} />

      {/* ── Supplier Purchase Invoice & E-Way Bill ─────────────────────── */}
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
              <input className="spi-dt-inp" placeholder="Supplier's own invoice number"
                value={draft.invoiceNumber} onChange={e => set({ invoiceNumber: e.target.value })} />
            </Field>
            <Field label="PURCHASE INVOICE DATE" req>
              <input className="spi-dt-inp" type="date"
                value={draft.invoiceDate} onChange={e => set({ invoiceDate: e.target.value })} />
            </Field>
            <Field label="PURCHASE INVOICE ATTACHMENT" req>
              <FilePick label="Purchase Invoice" value={draft.invoiceFile} onPick={name => set({ invoiceFile: name })} />
            </Field>
            <Field label="E-WAY BILL ATTACHMENT">
              <FilePick label="E-Way Bill" value={draft.ewayBillFile} onPick={name => set({ ewayBillFile: name })} />
            </Field>
          </div>
        </div>
      </div>

      {/* ── Product Details (3-Way Match) ──────────────────────────────── */}
      <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head cpf-clickable" onClick={() => setProdOpen(o => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-3"><IcoBox /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Products</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Product Details (3-Way Match)</span>
            </div>
            <div className="spi-dt-sec-sub">PI vs PO vs SPI product mapping &amp; 3-way match</div>
          </div>
          {/* The five references the match is drawn from, in the section's own
              head rather than above the table — they qualify this section, not
              the step. */}
          <div className="spi-dt-pills">
            <HeadPill icon={<IcoLines />} label="SUPPLIER CODE" value={draft.supplierCode} mono />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value={draft.supplier} alt />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoPin />} label="STATE CODE" value={draft.stateCode || '—'} mono />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoLines />} label="PO NUMBER" value={draft.poNumber || '—'} alt mono />
            <span className="spi-dt-dots">⋮</span>
            <HeadPill icon={<IcoDoc />} label="PI NUMBER" value={draft.piNumber || '—'} mono />
          </div>
          <span className={`cpf-chev ${prodOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body">
          <ProductTable lines={lines} onChange={changeLine} onRemove={removeLine} taxMode={taxMode} />

          {/* The match can be saved without leaving the step. The footer's
              "Save & Next" commits the whole step and moves on, which is the
              wrong shape for a table someone edits a row at a time. The chrome
              already carries this pair — a right-aligned row and the save
              button itself — so there is nothing to style here. */}
          <div className="spi-dt-saverow-only">
            <button
              type="button"
              className="spi-dt-save-btn"
              onClick={saveProducts}
              disabled={saved}
              title={saved ? 'The 3-way match is saved' : 'Save the 3-way match and stay on this step'}
            >
              {saved ? <IcoCheck /> : <IcoSave />}
              {saved ? 'Saved' : 'Save Product Details'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * A file field: the chosen name on the left, a Browse button on the right.
 *
 * Browsing opens a small menu rather than the file dialog directly, because an
 * invoice or an e-way bill is as often a photo of a paper document as a PDF on
 * the machine. It is the same `.arf-att` menu and the same CameraCaptureModal
 * the payment screens use, so the two behave identically.
 *
 * The real `<input type="file">` is hidden rather than styled — browsers give
 * almost no control over its own button, and every attempt to restyle it ends
 * up looking different in one of them.
 *
 * Only the file NAME is kept. There is no upload endpoint yet, and holding a
 * File object that cannot be sent anywhere would pin the whole file in memory
 * for the life of the form.
 */
function FilePick({ label, value, onPick }: { label: string; value: string; onPick: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  /* The row positions the menu; the button opens it. Two refs because those
     are two different jobs — the menu lines up with the whole field, but only
     Browse is the control. */
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  /* Where the menu is pinned, or null when it is closed — one piece of state
     rather than an open flag that could disagree with the position. */
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  const openMenu = () => {
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    /* Flipped above the row when there is no room below, so the menu is never
       half off the bottom of a long form. */
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
      /* Only the menu and the button it came from are exempt. Guarding the
         whole row would leave a click on the placeholder unable to dismiss
         an open menu. */
      if (t?.closest?.('.arf-att') || (t && btnRef.current?.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    /* Capture on scroll: the menu is positioned in viewport coordinates, so it
       would otherwise sit still while the row it belongs to moves away. */
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
    /* Browse is the hit area, not the whole row. The row carried the click at
       first, which meant the menu also opened from the file name and from the
       empty space beside it — nowhere near where the control looks to be. */
    <div ref={rowRef} className="spi-dt-file">
      <span className="spi-dt-file-txt"><IcoPaperclip /> {value || 'Choose file…'}</span>
      <button
        type="button"
        ref={btnRef}
        className="spi-dt-file-btn"
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
          if (f) onPick(f.name);
          /* Cleared so picking the SAME file again still fires a change —
             the input keeps its value otherwise and the event never comes. */
          e.target.value = '';
        }}
      />

      {/* Portalled to the body: the field sits inside a card that clips, and
          a menu pinned to viewport coordinates must not be clipped by it. */}
      {pickAt && createPortal(
        /* A portal is outside this row in the DOM but still inside it in the
           React tree, so a click inside the menu still bubbles through the row
           on its way up. Nothing on the row listens any more — Browse is the
           only control — but the menu keeps its own clicks to itself so that
           stays true of whatever is added to the row later. */
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
          {/* Loaded only once someone asks for it: the sheet pulls in
              getUserMedia handling that no other field on this step needs. */}
          <CameraCaptureModal
            title={`Photograph the ${label.toLowerCase()}`}
            subject={label}
            namePrefix={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
            /* One shot: these fields hold a single document each. */
            max={1}
            onAttach={shots => { if (shots[0]) onPick(shots[0].name); setCamOpen(false); }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
