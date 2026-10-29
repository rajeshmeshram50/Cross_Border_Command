import { useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { IcoCheck, IcoChevron, IcoHistory } from '../../../icons';
import type { InvoiceDraft } from '../invoice-draft';
import type { SpiBox } from '../spi-api';
import { SCN_LABEL } from './Step3BoxPackaging';

/** A blank reads as "nothing was entered", not as an empty box. */
const dash = (x: string) => (x && x.trim() !== '' ? x : '— Not provided');

/**
 * "What We Did in the Previous Stages" — the read-only recap every step after
 * the first opens with.
 *
 * Closed on arrival: it repeats what the user has just filled in, so it is
 * reference rather than something to read again. The Create PO form's own
 * summary behaves the same way.
 *
 * `upto` is how many stages are done, so Step 02 shows stage 01 only and the
 * later steps will add their own blocks beneath it.
 *
 * `direct` drops what a Direct SPI has no answer for. The summary recaps what
 * each stage recorded, and stage 01 of a Direct SPI never asks the purchase
 * order questions - the whole Purchase Order section is absent from that step
 * - so repeating them here produced eight rows of "Not provided" above the
 * first thing the user actually filled in.
 */
export default function StageSummary({ draft, upto, direct = false, boxes = [] }: {
  draft: InvoiceDraft; upto: 1 | 2 | 3; direct?: boolean; boxes?: SpiBox[];
}) {
  /* Stage 03's recap. The stage records cartons, not fields, so it is counted
     rather than read off the draft — the draft never held any of this. */
  const units = boxes.reduce(
    (n, b) => n + b.items.reduce((m, i) => m + (Number(i.quantity) || 0), 0),
    0,
  );
  const packedItems = new Set(boxes.flatMap(b => b.items.map(i => i.supplier_invoice_item_id))).size;
  const scenarios = [...new Set(boxes.map(b => b.scenario))]
    .sort()
    .map(s => `${SCN_LABEL[s][0]} · ${SCN_LABEL[s][1]}`)
    .join(', ');
  const [open, setOpen] = useState(false);

  return (
    <div className={`spi-dt-sec ${open ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setOpen(o => !o)}>
        <div className="spi-dt-sec-ico"><IcoHistory /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Summary</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">What We Did in the Previous Stages</span>
          </div>
          <div className="spi-dt-sec-sub">
            Read-only summary of all completed stages so far — {upto} stage{upto === 1 ? '' : 's'} done.
          </div>
        </div>
        <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-sumstep">
          <div className="spi-dt-sumstep-hd">
            <div className="spi-dt-sumstep-hd-l">
              <span className="spi-dt-sumstep-num">01</span>
              <span className="spi-dt-sumstep-title">Supplier Details</span>
            </div>
            <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
          </div>

          <div className="spi-dt-sumstep-body">
            {!direct && (
              <Group label="Basic Purchase Order Details">
                <RO label="PO Type" value={dash(draft.poType)} />
                <RO label="Document Type" value={dash(draft.docType)} />
                <RO label="Mode of Transport" value={dash(draft.transport)} />
                <RO label="PO Date" value={dash(formatDmy(draft.poDate))} />
                <RO label="Expected Delivery Date" value={dash(formatDmy(draft.deliveryDate))} />
                <RO label="Delivery Location" value={dash(draft.deliveryLocation)} />
                <RO label="Payment Type" value={dash(draft.paymentType)} />
                {/* A boolean has no blank state, so it is never "Not provided". */}
                <RO label="Physical Inspection Status" value={draft.physInspection ? 'Required' : 'Not Applicable'} />
              </Group>
            )}

            <Group label="Supplier Details">
              <RO label="Select Supplier" value={dash(`${draft.supplierCode} — ${draft.supplier}`)} />
              <RO label="Company Legal Name" value={dash(draft.legalName)} />
              <RO label="Supplier Type" value={dash(draft.supplierType)} />
              <RO label="Risk Level" value={dash(draft.riskLevel)} />
              <RO label="Supplier Category" value={dash(draft.category)} />
            </Group>

            <Group label="Address & Contact Details">
              <RO label="Registered Office Address" value={dash(draft.address)} full />
              <RO label="Country" value={dash(draft.country)} />
              <RO label="State" value={dash(draft.state)} />
              <RO label="State Code" value={dash(draft.stateCode)} />
              <RO label="City" value={dash(draft.city)} />
              <RO label="Contact Person Name" value={dash(draft.contactName)} />
              <RO label="Designation" value={dash(draft.designation)} />
              <RO label="Contact Number" value={dash(draft.contactNumber)} />
              <RO label="Email ID" value={dash(draft.email)} />
            </Group>

            <Group label="GST Scrutiny Details">
              <RO label="Scrutiny Date" value={dash(formatDmy(draft.scrutinyDate))} />
              <RO label="GST Number" value={dash(draft.gstNumber)} />
              <RO label="GST Status" value={dash(draft.gstStatus)} />
              <RO label="Last Filing Date" value={dash(formatDmy(draft.filingDate))} />
              <RO label="Prev. Invoice / Remarks" value={dash(draft.remarks)} full />
            </Group>
          </div>
        </div>

        {/* Stage 02 appears only once it is behind the user. `upto` is what
            each step passes, so a step never summarises itself. */}
        {upto >= 2 && (
          <div className="spi-dt-sumstep">
            <div className="spi-dt-sumstep-hd">
              <div className="spi-dt-sumstep-hd-l">
                <span className="spi-dt-sumstep-num">02</span>
                <span className="spi-dt-sumstep-title">
                  {/* The stage rail already names the match this invoice is
                      making; the recap of that stage must not name a
                      different one. */}
                  Invoice &amp; Product Details ({direct ? '2' : '3'}-Way Match)
                </span>
              </div>
              <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
            </div>
            <div className="spi-dt-sumstep-body">
              <Group label="Supplier Purchase Invoice & E-Way Bill Details">
                <RO label="Purchase Invoice Number" value={dash(draft.invoiceNumber)} />
                <RO label="Purchase Invoice Date" value={dash(formatDmy(draft.invoiceDate))} />
                <RO label="Purchase Invoice Attachment" value={dash(draft.invoiceFile)} />
                <RO label="E-Way Bill Attachment" value={dash(draft.ewayBillFile)} />
              </Group>
            </div>
          </div>
        )}

        {/* Stage 03. The header has always counted this stage in "3 stages
            done", but the body stopped at stage 02 — so stage 04 opened on a
            recap that was short of the stage immediately behind it, which is
            the one the operator is about to put away. */}
        {upto >= 3 && (
          <div className="spi-dt-sumstep">
            <div className="spi-dt-sumstep-hd">
              <div className="spi-dt-sumstep-hd-l">
                <span className="spi-dt-sumstep-num">03</span>
                <span className="spi-dt-sumstep-title">Temporary Box Packaging</span>
              </div>
              <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
            </div>
            <div className="spi-dt-sumstep-body">
              <Group label="Box Packaging Summary">
                <RO label="Boxes Packed" value={boxes.length ? String(boxes.length) : dash('')} />
                <RO label="Products Packed" value={packedItems ? String(packedItems) : dash('')} />
                <RO label="Units Packed" value={units ? String(units) : dash('')} />
                <RO label="Packaging Scenarios Used" value={dash(scenarios)} full />
              </Group>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="spi-dt-rogroup-hd">{label}</div>
      <div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div>
    </div>
  );
}

function RO({ label, value, full }: { label: string; value: string; full?: boolean }) {
  /* The dash prefix is the one marker of a missing value, so the muted style
     is derived from it rather than passed separately — the two cannot
     disagree about whether a field was filled. */
  const missing = value.startsWith('—');
  return (
    <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}>
      <div className="spi-dt-ro-lbl">{label}</div>
      <div className={`spi-dt-ro-val ${missing ? 'is-muted' : ''}`}>{value}</div>
    </div>
  );
}
