import { useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { IcoCheck, IcoChevron, IcoHistory } from '../../../icons';
import type { InvoiceDraft } from '../invoice-draft';

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
 */
export default function StageSummary({ draft, upto }: { draft: InvoiceDraft; upto: 1 | 2 | 3 }) {
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
                <span className="spi-dt-sumstep-title">Invoice &amp; Product Details (3-Way Match)</span>
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
