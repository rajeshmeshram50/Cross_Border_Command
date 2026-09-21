// "What We Did in the Previous Stages" — the read-only recap every step after
// the first opens with. `upto` says how many stages are done, so Step 02 shows
// stage 01 only and Step 03 adds the products, charges and cost summary.
import { useState } from 'react';
import { formatDmy } from '../../../../../../utils/formatDmy';
import type { PoDraft } from '../po-draft';
import type { StepCtx } from '../CreatePoForm';
import { riskLabel } from '../supplier-checks';
import ProductTable, { computeLine } from './ProductTable';
import { chargesTotal } from './ChargesSummary';
import { IcoCheck, IcoChevron, IcoHistory } from '../../shared/icons';

const dash = (x: string) => (x && x.trim() !== '' ? x : '— Not provided');
const v = (x: string | null | undefined) => x ?? '';
const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StageSummary({ draft, ctx, upto }: { draft: PoDraft; ctx: StepCtx; upto: 1 | 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const sup = draft.supplier;
  const legal = draft.legal;
  const { products } = ctx.lookups;

  const lines = draft.lines.map((l) => computeLine(l, products, ctx.taxMode));
  const base = lines.reduce((sum, l) => sum + l.base, 0);
  const gst = lines.reduce((sum, l) => sum + l.gstAmt, 0);
  const charges = chargesTotal(draft.charges);

  return (
    <div className={`spi-dt-sec ${open ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setOpen((o) => !o)}>
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
              <span className="spi-dt-sumstep-title">PO Link Supplier Details</span>
            </div>
            <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
          </div>

          <div className="spi-dt-sumstep-body">
            <Group label="Basic Purchase Order Details">
              <RO label="PO Type" value={dash(draft.poType)} />
              <RO label="Document Type" value={dash(draft.docType)} />
              <RO label="Mode of Transport" value={dash(draft.transport)} />
              <RO label="PO Date" value={formatDmy(ctx.detail?.po_date ?? new Date().toISOString().slice(0, 10))} />
              <RO label="Expected Delivery Date" value={draft.deliveryDate ? formatDmy(draft.deliveryDate) : dash('')} />
              <RO label="Delivery Location" value={dash(draft.deliveryLocation)} />
              <RO label="Payment Type" value={dash(draft.paymentType)} />
              <RO label="Physical Inspection Required" value={draft.physInsp ? 'Yes' : 'No'} />
              {draft.docType === 'International' && (
                <>
                  <RO label="Currency" value={dash(draft.currency)} />
                  <RO label="Exchange Rate" value={dash(draft.exchangeRate)} />
                  <RO label="INCO Term" value={dash(draft.incoTerm)} />
                  <RO label="Port of Loading" value={dash(draft.portLoading)} />
                  <RO label="Port of Discharge" value={dash(draft.portDischarge)} />
                  <RO label="Final Destination" value={dash(draft.finalDestination)} />
                  <RO label="Country of Origin" value={dash(draft.countryOrigin)} />
                </>
              )}
            </Group>

            <Group label="Supplier Details">
              <RO label="Select Supplier" value={dash(sup ? `${sup.code} — ${sup.name}` : '')} />
              <RO label="Company Legal Name" value={dash(v(sup?.legalName))} />
              <RO label="Supplier Type" value={dash(v(sup?.type))} />
              <RO label="Risk Level" value={dash(riskLabel(sup?.risk))} />
              <RO label="Supplier Category" value={dash(v(sup?.category))} />
            </Group>

            <Group label="Address & Contact Details">
              <RO label="Registered Office Address" value={dash(v(sup?.addr))} full />
              <RO label="Country" value={dash(v(sup?.country))} />
              <RO label="State" value={dash(v(sup?.state))} />
              <RO label="State Code" value={dash(v(sup?.stateCode))} />
              <RO label="City" value={dash(v(sup?.city))} />
              <RO label="Contact Person Name" value={dash(v(sup?.contact))} />
              <RO label="Designation" value={dash(v(sup?.desig))} />
              <RO label="Contact Number" value={dash(v(sup?.phone))} />
              <RO label="Email ID" value={dash(v(sup?.email))} />
            </Group>

            <Group label="Supplier Legal Status">
              {legal ? (
                <>
                  <RO label="Overall" value={`${legal.pct}% · ${legal.done} of ${legal.total} documents`} />
                  {legal.sections.map((sec) => (
                    <RO key={sec.name} label={sec.name} value={`${sec.done} / ${sec.total} · ${sec.pct}%`} />
                  ))}
                  <RO label="Parameters" value={legal.sections.flatMap((sec) => sec.parts).join(', ')} full />
                </>
              ) : (
                <RO label="" value={dash('')} full />
              )}
            </Group>

            <Group label="GST Scrutiny Details">
              <RO label="Scrutiny Date" value={sup?.scrutiny ? formatDmy(sup.scrutiny) : dash('')} />
              <RO label="GST Number" value={dash(v(sup?.gstNo))} />
              <RO label="GST Status" value={dash(v(sup?.gstStatus))} />
              <RO label="Last Filing Date" value={sup?.filing ? formatDmy(sup.filing) : dash('')} />
              <RO label="Prev. Invoice / Remarks" value={dash(v(sup?.remarks))} full />
            </Group>

            <Group label="Supplier Risk Alert">
              <RO label="Risk Level" value={dash(riskLabel(sup?.risk))} />
              <RO label="Supplier Category" value={dash(v(sup?.category))} />
              <RO label="GST Registration" value={dash(v(sup?.gstStatus))} />
            </Group>
          </div>
        </div>

        {upto >= 2 && (
          <div className="spi-dt-sumstep">
            <div className="spi-dt-sumstep-hd">
              <div className="spi-dt-sumstep-hd-l">
                <span className="spi-dt-sumstep-num">02</span>
                <span className="spi-dt-sumstep-title">PO Product Details</span>
              </div>
              <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
            </div>

            <div className="spi-dt-sumstep-body">
              <div>
                <div className="spi-dt-rogroup-hd">Product Details</div>
                <ProductTable rows={draft.lines} products={products} taxMode={ctx.taxMode} onChange={() => {}} readOnly />
              </div>

              <div>
                <div className="spi-dt-rogroup-hd">Additional Charges</div>
                <div className="spi-dt-robox"><div className="spi-dt-rogrid">
                  <RO label="Shipping Charges" value={money(Number(draft.charges.ship) || 0)} />
                  <RO label="Packaging Charges" value={money(Number(draft.charges.pack) || 0)} />
                  <RO label="Other Charges" value={money(Number(draft.charges.other) || 0)} />
                </div></div>
              </div>

              <div>
                <div className="spi-dt-rogroup-hd">Cost Summary</div>
                <div className="spi-dt-robox"><div className="spi-dt-rogrid">
                  <RO label="Product Cost (Without GST)" value={money(base)} />
                  <RO label="Total GST Amount" value={money(gst)} />
                  <RO label="Total Charges" value={money(charges)} />
                  <RO label="Grand Total" value={money(base + gst + charges)} />
                </div></div>
              </div>
            </div>
          </div>
        )}

        {upto >= 3 && (
          <div className="spi-dt-sumstep">
            <div className="spi-dt-sumstep-hd">
              <div className="spi-dt-sumstep-hd-l">
                <span className="spi-dt-sumstep-num">03</span>
                <span className="spi-dt-sumstep-title">PO Terms &amp; Conditions</span>
              </div>
              <span className="spi-dt-sumstep-done"><IcoCheck size={11} /> Completed</span>
            </div>
            <div className="spi-dt-sumstep-body">
              <Group label="PO Terms & Conditions">
                <RO label="Terms & Condition" value={dash(draft.terms)} full />
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
  const missing = value.startsWith('—');
  return (
    <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}>
      <div className="spi-dt-ro-lbl">{label}</div>
      <div className={`spi-dt-ro-val ${missing ? 'is-muted' : ''}`}>{value}</div>
    </div>
  );
}
