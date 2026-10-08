import { useRef, useState } from 'react';
import { Field } from '../../order/create-po/form-fields';
import { HeadPill } from '../../order/create-po/CreatePoForm';
import { IcoBox, IcoChevron, IcoDoc, IcoLines, IcoPaperclip, IcoPin, IcoUser } from '../../../icons';
import StageSummary from './StageSummary';
import ProductTable from './ProductTable';
import type { ProductLine } from '../invoice-products';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';

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
              <FilePick value={draft.invoiceFile} onPick={name => set({ invoiceFile: name })} />
            </Field>
            <Field label="E-WAY BILL ATTACHMENT">
              <FilePick value={draft.ewayBillFile} onPick={name => set({ ewayBillFile: name })} />
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
          <ProductTable lines={lines} onChange={onChangeLine} onRemove={onRemoveLine} />
        </div>
      </div>
    </>
  );
}

/**
 * A file field: the chosen name on the left, a Browse button on the right.
 *
 * The real `<input type="file">` is hidden rather than styled — browsers give
 * almost no control over its own button, and every attempt to restyle it ends
 * up looking different in one of them. The visible row is ordinary markup, and
 * the button forwards the click.
 *
 * Only the file NAME is kept. There is no upload endpoint yet, and holding a
 * File object that cannot be sent anywhere would pin the whole file in memory
 * for the life of the form.
 */
function FilePick({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  const pick = () => ref.current?.click();

  return (
    /* The whole row is the hit area, not just the button — that is how the
       SPI wizard's own file field behaves, and a 60px button beside a wide
       empty row invites clicking the row. */
    <div
      className="spi-dt-file is-clickable"
      role="button"
      tabIndex={0}
      onClick={pick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
    >
      <span className="spi-dt-file-txt"><IcoPaperclip /> {value || 'Choose file…'}</span>
      {/* tabIndex -1: the row already takes the focus, and a nested button
          would make the same control stop twice on the way through. */}
      <button type="button" className="spi-dt-file-btn" tabIndex={-1}>Browse</button>
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
    </div>
  );
}
