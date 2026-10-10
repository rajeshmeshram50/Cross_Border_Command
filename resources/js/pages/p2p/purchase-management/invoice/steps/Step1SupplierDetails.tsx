import { useMemo, useState } from 'react';
import { EditSelect, Field } from '../../order/create-po/form-fields';
/* The compliance rules themselves, shared with the Create PO form. This step
   calls them rather than restating them, so the two screens cannot drift apart
   on what "stale scrutiny" or "high risk" means. */
import {
  SevIcon, gstState, isRiskMandatory, monthsAgo, riskItems, type Severity,
} from '../../order/create-po/supplier-checks';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { formatDmy } from '../../../../../utils/formatDmy';
import {
  IcoAlert, IcoCheck, IcoChevron, IcoClock, IcoDocSm, IcoFile, IcoLock, IcoOk, IcoPin,
  IcoPlus, IcoShield, IcoStop, IcoUser, IcoWarn,
} from '../../../icons';
import { SUPPLIER_LEGAL } from '../data';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';

/* The option lists. At module scope because they never change — rebuilding
   four arrays on every keystroke in the address field would be waste. */
const PO_TYPES = ['Material / Goods', 'Services'];
const DOC_TYPES = ['Domestics', 'International'];
const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Sea'];
const PAYMENT_TYPES = ['Advance', 'Credit', 'Partial Advance'];
const SUPPLIER_TYPES = ['Manufacturer', 'Trader', 'Distributor', 'Service Provider'];
const RISK_LEVELS = ['Low Risk', 'Medium Risk', 'High Risk'];
const SUPPLIER_CATEGORIES = ['Star Supplier', 'Regular Supplier', 'High Risk Supplier', 'Blacklisted'];
const GST_STATUSES = ['Active', 'Suspended', 'Cancelled'];
const COUNTRIES = ['India', 'United Arab Emirates', 'Singapore', 'United States'];
const STATES = ['Maharashtra', 'Gujarat', 'Karnataka', 'Delhi', 'Tamil Nadu'];

/**
 * The checklist shown once the supplier's rating or category forces it.
 *
 * Stated here rather than taken from the PO form's `RISK_GUIDELINES`, whose
 * wording was softened to "recommended / switched on by default". The design
 * is firmer — these are rules, not advice — and the PO form's own copy is left
 * alone rather than changed underneath it.
 */
const GUIDELINES = [
  {
    title: 'Physical inspection is mandatory',
    note: 'Goods must be physically inspected and cleared by QA before the GRN is accepted into inventory.',
  },
  {
    title: 'Payment against milestones only',
    note: 'Release payment strictly against installation, goods delivery and 100% GST scrutiny — no advance.',
  },
];

/**
 * Step 01 — Supplier Details.
 *
 * Two sections: the purchase order's own details, then the supplier this
 * invoice is for. Every class belongs to the shared P2P wizard chrome or to
 * the Create PO form's additions, both of which the shell already imports —
 * this file adds no CSS.
 *
 * The fields hold local state and no API. The endpoint does not exist yet, so
 * the screen is built against the design first; when it lands, this component
 * takes a draft and a setter the way the PO form's steps do, and nothing about
 * the markup changes.
 */
export default function Step1SupplierDetails({ draft, set }: { draft: InvoiceDraft; set: SetDraft }) {
  /* One flag per collapsible. Separate rather than one open-section id,
     because the design lets several be open at once. */
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [supCardOpen, setSupCardOpen] = useState(true);
  const [addrOpen, setAddrOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [gstOpen, setGstOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(true);

  /* Every field reads the form's draft. Destructured so the markup below stays
     the same length it was when each one was its own useState. */
  const {
    poType, docType, transport, poDate, deliveryDate, deliveryLocation, paymentType,
    physInspection, poNumber, supplier, legalName, supplierType, riskLevel, category,
    address, country, state, stateCode, city, contactName, designation, contactNumber, email,
    scrutinyDate, gstNumber, gstStatus, filingDate, remarks,
  } = draft;

  /* The supplier the chooser settled counts as chosen, so the compliance cards
     below know whether they have anything to report. */
  const hasSupplier = !!supplier;

  /* Linked to a purchase order: the order's own terms are read back here, not
     asked for again. A standalone invoice has none, so the block stays open. */
  const hasPo = !!poNumber;

  /* Read from the supplier's Evidence Vault. Same thresholds the PO form uses,
     so the two cards cannot disagree about what counts as compliant. */
  const legal = SUPPLIER_LEGAL;
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';

  /* The GST verdict and the risk checks are NOT written out here — they come
     from the same two functions the PO form calls, fed this step's own field
     values. Restating the rules would let the two screens drift apart on what
     "stale" or "high risk" means, and the server re-runs these anyway. */
  const gst = gstState(hasSupplier ? supplier : '', scrutinyDate, filingDate);
  const scrutinyAge = monthsAgo(scrutinyDate);
  const filingAge = monthsAgo(filingDate);

  const risks = useMemo(
    () => (hasSupplier
      ? riskItems({
        risk: riskLevel, category, gstStatus, gstNo: gstNumber,
        filing: filingDate, scrutiny: scrutinyDate,
        legal: { done: legal.done, total: legal.total },
        international: docType === 'International',
      }, physInspection)
      : []),
    [hasSupplier, riskLevel, category, gstStatus, gstNumber, filingDate, scrutinyDate, legal, docType],
  );

  const nHigh = risks.filter(r => r.sev === 'high').length;
  const nMed = risks.filter(r => r.sev === 'med').length;
  const nOk = risks.filter(r => r.sev === 'ok').length;
  const riskSev: Severity = nHigh ? 'high' : nMed ? 'med' : 'ok';
  const verdict = nHigh
    ? `${nHigh} critical issue${nHigh === 1 ? ' needs' : 's need'} attention${nMed ? ` · ${nMed} warning${nMed === 1 ? '' : 's'}` : ''}`
    : nMed
      ? `${nMed} warning${nMed === 1 ? '' : 's'} to review before release`
      : 'All checks passed';

  return (
    <>
      {/* ── Purchase Order ─────────────────────────────────────────────── */}
      <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head" onClick={() => setPoOpen(o => !o)}>
          <div className="spi-dt-sec-ico"><IcoFile /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Purchase Order</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Basic Purchase Order Details</span>
            </div>
            <div className="spi-dt-sec-sub">Core details that identify this purchase order.</div>
          </div>
          <div className="spi-dt-sec-toggle"><IcoChevron /></div>
        </div>

        <div className="spi-dt-sec-body">
          <div className="spi-dt-grid4">
            {/* Linked to a PO, this block reads the order back rather than
                asking for it again — the same way the supplier block below is
                read-only once a supplier is chosen. Editing them here would
                let an invoice disagree with the order it is matched against.
                A standalone invoice has no order to read, so they stay open. */}
            <Field label="PO Type" req>
              <EditSelect readOnly={hasPo} value={poType} options={PO_TYPES} onChange={v => set({ poType: v })} />
            </Field>
            <Field label="Document Type" req>
              <EditSelect readOnly={hasPo} value={docType} options={DOC_TYPES} onChange={v => set({ docType: v })} />
            </Field>
            <Field label="Mode of Transport" req>
              <EditSelect readOnly={hasPo} value={transport} options={TRANSPORT_MODES} onChange={v => set({ transport: v })} />
            </Field>
            <Field label="PO Date">
              {/* Never typed: the order's own date, carried over from the PO. */}
              <div className="spi-dt-inp-auto">
                <input className="spi-dt-inp" value={formatDmy(poDate)} readOnly />
                <span className="spi-dt-auto"><IcoLock /> AUTO</span>
              </div>
            </Field>
            <Field label="Expected Delivery Date" req>
              {/* Carried from the order as a formatted date, not a bare date
                  input: a read-only `type="date"` still shows its picker
                  affordance and reads as something to fill in. */}
              {hasPo
                ? <input className="spi-dt-inp" value={formatDmy(deliveryDate)} readOnly />
                : <input className="spi-dt-inp" type="date"
                  value={deliveryDate} onChange={e => set({ deliveryDate: e.target.value })} />}
            </Field>
            <Field label="Delivery Location" req>
              <input className="spi-dt-inp" readOnly={hasPo}
                placeholder={hasPo ? '—' : 'Enter delivery location'} maxLength={255}
                value={deliveryLocation} onChange={e => set({ deliveryLocation: e.target.value })} />
            </Field>
            <Field label="Payment Type" req>
              <EditSelect readOnly={hasPo} value={paymentType} options={PAYMENT_TYPES} onChange={v => set({ paymentType: v })} />
            </Field>
            {/* Read-only here, unlike the PO form's Yes/No toggle: by the time
                an invoice is raised the inspection was already decided on the
                order, so this reports it rather than asking again. */}
            <Field label="Physical Inspection Status">
              <div className="spi-dt-inp-auto">
                <input className="spi-dt-inp" value={physInspection ? 'Required' : 'Not Applicable'} readOnly />
                <span className="spi-dt-auto">{physInspection ? 'MANDATORY' : 'NOT REQUIRED'}</span>
              </div>
            </Field>
          </div>
        </div>
      </div>

      {/* ── Supplier ───────────────────────────────────────────────────── */}
      <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Supplier</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Basic Supplier Details</span>
            </div>
            <div className="spi-dt-sec-sub">Primary information about the supplier this PO is issued to.</div>
          </div>
          <div className="spi-dt-sec-toggle"><IcoChevron /></div>
        </div>

        <div className="spi-dt-sec-body">
          {/* Supplier Details */}
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setSupCardOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details
              </div>
              {/* stopPropagation, or opening the master would also collapse the
                  card the button sits in. */}
              <button type="button" className="cpf-addbtn" title="Onboard a supplier that is not in this list"
                onClick={e => e.stopPropagation()}>
                <IcoPlus /> Add Supplier
              </button>
              <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
              <span className={`cpf-chev ${supCardOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {supCardOpen && (
              <div className="spi-dt-grid4 cpf-grid5">
                <Field label="SELECT SUPPLIER" req>
                  {/* Frozen once chosen, as on the purchase order. The list
                      only ever holds the supplier already on the invoice, so
                      an open picker offered a choice that did not exist; the
                      footer's Change Selection is how it is swapped. */}
                  {hasSupplier ? (
                    <EditSelect readOnly value={supplier} options={[]} onChange={() => {}} />
                  ) : (
                    <MasterSelect
                      value={supplier}
                      options={[{ value: supplier, label: supplier }]}
                      placeholder="— Select Supplier —"
                      onChange={v => set({ supplier: v })}
                    />
                  )}
                </Field>
                <Field label="COMPANY LEGAL NAME">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Registered legal entity name"} readOnly={hasSupplier}
                    value={legalName} onChange={e => set({ legalName: e.target.value })} />
                </Field>
                <Field label="SUPPLIER TYPE">
                  <EditSelect readOnly={hasSupplier} value={supplierType} options={SUPPLIER_TYPES} onChange={v => set({ supplierType: v })} />
                </Field>
                <Field label="RISK LEVEL">
                  <EditSelect readOnly={hasSupplier} value={riskLevel} options={RISK_LEVELS} onChange={v => set({ riskLevel: v })} />
                </Field>
                <Field label="SUPPLIER CATEGORY">
                  <EditSelect readOnly={hasSupplier} value={category} options={SUPPLIER_CATEGORIES} onChange={v => set({ category: v })} />
                </Field>
              </div>
            )}
          </div>

          {/* Address & Contact Details */}
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setAddrOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details
              </div>
              <span className="spi-dt-fields-badge cpf-push">9 FIELDS</span>
              <span className={`cpf-chev ${addrOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {addrOpen && (
              <div className="spi-dt-grid4">
                {/* `full` spans the grid: an address needs the width, and a
                    quarter-width box would wrap a PIN code onto its own line. */}
                <Field label="REGISTERED OFFICE ADDRESS" full>
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Building / street / area / landmark, with PIN code"} readOnly={hasSupplier}
                    value={address} onChange={e => set({ address: e.target.value })} />
                </Field>
                <Field label="COUNTRY">
                  <EditSelect readOnly={hasSupplier} value={country} options={COUNTRIES} onChange={v => set({ country: v })} />
                </Field>
                <Field label="STATE">
                  <EditSelect readOnly={hasSupplier} value={state} options={STATES} onChange={v => set({ state: v })} />
                </Field>
                <Field label="STATE CODE">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "e.g. 27"} readOnly={hasSupplier}
                    value={stateCode} onChange={e => set({ stateCode: e.target.value })} />
                </Field>
                <Field label="CITY">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Enter city"} readOnly={hasSupplier}
                    value={city} onChange={e => set({ city: e.target.value })} />
                </Field>
                <Field label="CONTACT PERSON NAME">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Full name"} readOnly={hasSupplier}
                    value={contactName} onChange={e => set({ contactName: e.target.value })} />
                </Field>
                <Field label="DESIGNATION">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "e.g. Procurement Manager"} readOnly={hasSupplier}
                    value={designation} onChange={e => set({ designation: e.target.value })} />
                </Field>
                <Field label="CONTACT NUMBER">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "+91"} readOnly={hasSupplier}
                    value={contactNumber} onChange={e => set({ contactNumber: e.target.value })} />
                </Field>
                <Field label="EMAIL ID">
                  <input className="spi-dt-inp" type="email" placeholder={hasSupplier ? "—" : "name@company.com"} readOnly={hasSupplier}
                    value={email} onChange={e => set({ email: e.target.value })} />
                </Field>
              </div>
            )}
          </div>

          {/* Supplier Legal Status */}
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable cpf-lghead" onClick={() => setLegalOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
              </div>
              {hasSupplier ? (
                <>
                  <span className={`cpf-push spi-dt-legal-badge ${legal.pct === 100 ? 'ok' : 'warn'}`}>
                    {legal.pct === 100 ? '100% Compliant' : `${legal.pct}% · Needs Review`}
                  </span>
                  <button type="button" className="cpf-vault" onClick={e => e.stopPropagation()}>
                    <IcoShield /> <span>Visit Supplier Evidence Vault</span>
                  </button>
                  <span className="cpf-lgbar">
                    <span className={`cpf-lgbar__fill cpf-fill-${legalTone}`} style={{ width: `${legal.pct}%` }} />
                  </span>
                  <span className="cpf-lgpct">{legal.pct}%</span>
                </>
              ) : (
                <>
                  {/* The badge's slot still shows while there is nothing to
                      score, as a dash — an absent badge would shift the bar. */}
                  <span className="cpf-push spi-dt-legal-badge cpf-lgbadge--none">–</span>
                  <span className="cpf-lgbar"><span className="cpf-lgbar__fill is-empty" /></span>
                  <span className="cpf-lgpct">0%</span>
                </>
              )}
              <span className={`cpf-chev ${legalOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {legalOpen && (
              <div className="cpf-lg">
                {hasSupplier ? (
                  <div className="cpf-lg__tabs">
                    {legal.sections.map((sec, i) => (
                      /* `title` lists what the group counts, so the two-line
                         tile does not have to name all three sources. */
                      <div key={sec.name} className={`cpf-lg__tab cpf-lg__tab--${sec.tone}`} title={sec.parts.join(' · ')}>
                        <div className="cpf-lg__hd">
                          <span className="cpf-lg__ico">{i === 0 ? <IcoShield /> : <IcoDocSm />}</span>
                          <span className="cpf-lg__txt">
                            <span className="cpf-lg__nm">{sec.name}</span>
                            <span className="cpf-lg__sub">{sec.sub}</span>
                          </span>
                          <span className="cpf-lg__cnt">{sec.done} / {sec.total}</span>
                          <span className="cpf-lg__pct">{sec.pct}%</span>
                        </div>
                        <div className="cpf-lg__bar">
                          <span className="cpf-lg__fill" style={{ width: `${sec.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="spi-dt-legal-note">
                    Select a supplier to view legal &amp; compliance status.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* GST Scrutiny Details */}
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setGstOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details
              </div>
              <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
              <span className={`cpf-chev ${gstOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {gstOpen && (
              <>
                {/* The verdict for the two dates below. `idle` is the
                    unmodified tone: nothing to judge yet, so a clock rather
                    than a pass or a fail. */}
                <div className={`cpf-gst invf-gst${gst.tone === 'idle' ? '' : ` cpf-gst--${gst.tone}`}`}>
                  <span className="cpf-gst__ico">
                    {gst.tone === 'ok' ? <IcoOk />
                      : gst.tone === 'stop' ? <IcoStop />
                        : gst.tone === 'warn' ? <IcoWarn /> : <IcoClock />}
                  </span>
                  <span className="cpf-gst__txt">
                    <span className="cpf-gst__t">{gst.title}</span>
                    <span className="cpf-gst__s">{gst.note}</span>
                    {hasSupplier && docType !== 'International' && (
                      <span className="cpf-gst__meta">
                        Scrutiny <b>{scrutinyDate ? formatDmy(scrutinyDate) : '—'}</b>
                        {scrutinyAge !== null && <span className="cpf-gst__age">{scrutinyAge.toFixed(1)} mo ago</span>}
                        <span className="cpf-gst__sep" />
                        Last filing <b>{filingDate ? formatDmy(filingDate) : '—'}</b>
                        {filingAge !== null && <span className="cpf-gst__age">{filingAge.toFixed(1)} mo ago</span>}
                      </span>
                    )}
                  </span>
                </div>
                <div className="spi-dt-grid4">
                  {/* Plain date inputs, as the design draws them. MasterDatePicker
                      adds a clear button and a calendar chip inside the field,
                      which crowds a four-column row — and these two dates sit
                      next to a GSTIN and a status, so they have to read as
                      ordinary fields rather than as controls. */}
                  <Field label="SCRUTINY DATE">
                    <input className="spi-dt-inp" type="date"
                      value={scrutinyDate} onChange={e => set({ scrutinyDate: e.target.value })} />
                  </Field>
                  <Field label="GST NUMBER">
                    <input className="spi-dt-inp" placeholder="15-digit GSTIN" maxLength={15}
                      value={gstNumber} onChange={e => set({ gstNumber: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="GST STATUS">
                    <EditSelect value={gstStatus} options={GST_STATUSES} onChange={v => set({ gstStatus: v })} />
                  </Field>
                  <Field label="LAST FILING DATE">
                    <input className="spi-dt-inp" type="date"
                      value={filingDate} onChange={e => set({ filingDate: e.target.value })} />
                  </Field>
                  <Field label="PREV. INVOICE / REMARKS" full>
                    {/* No `rows`: the stylesheet's own min-height (74px) is the
                        design's height, and a rows count overrides it. */}
                    <textarea className="spi-dt-textarea"
                      placeholder="Notes on previous invoices, filing history or scrutiny remarks…"
                      value={remarks} onChange={e => set({ remarks: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </div>

          {/* Supplier Risk Alert */}
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setRiskOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoAlert /></span> Supplier Risk Alert
              </div>
              {/* `cpf-hide` keeps the slot's width while there is nothing to
                  say, so the chevron does not move once a verdict arrives. */}
              <span className={`cpf-risk__badge cpf-risk__badge--${riskSev} ${hasSupplier ? '' : 'cpf-hide'}`}>
                {!hasSupplier ? ''
                  : nHigh ? `${nHigh} critical${nMed ? ` · ${nMed} warning` : ''}`
                    : nMed ? `${nMed} warning${nMed === 1 ? '' : 's'}`
                      : 'All clear'}
              </span>
              <span className={`cpf-chev ${riskOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {riskOpen && (
              <div className="cpf-risk">
                {hasSupplier ? (
                  <>
                    <div className={`cpf-risk__sum cpf-risk__sum--${riskSev}`}>
                      <span className="cpf-risk__sum-ico"><SevIcon sev={riskSev} /></span>
                      <div className="cpf-risk__sum-txt">
                        <div className="cpf-risk__sum-t">{verdict}</div>
                        <div className="cpf-risk__sum-x">
                          {nOk} of {risks.length} checks passed · {docType === 'International'
                            ? 'risk rating, category and documents (GST not applicable)'
                            : 'risk rating, category, GST registration, filing, scrutiny and documents'}
                        </div>
                      </div>
                      {/* The same score as a figure, at the end of the row. */}
                      <span className="cpf-risk__sum-score">{nOk}/{risks.length}</span>
                    </div>
                    {/* Shown only when the supplier's own rating or category
                        forces them — otherwise they are not rules, just advice. */}
                    {isRiskMandatory({ risk: riskLevel, category }) && (
                      <div className="cpf-guide">
                        <div className="cpf-guide__hd">
                          <span className="cpf-guide__ico"><IcoLock /></span>
                          <span className="cpf-guide__t">Mandatory Guidelines</span>
                          <span className="cpf-guide__tag">Enforced on this PO</span>
                        </div>
                        <div className="cpf-guide__list">
                          {GUIDELINES.map(g => (
                            <div key={g.title} className="cpf-guide__row">
                              <span className="cpf-guide__ck"><IcoCheck /></span>
                              <div>
                                <div className="cpf-guide__rt">{g.title}</div>
                                <div className="cpf-guide__rx">{g.note}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="cpf-risk__list">
                      {risks.map(r => (
                        <div key={r.title} className={`cpf-risk__row cpf-risk__row--${r.sev}`}>
                          <span className="cpf-risk__dot"><SevIcon sev={r.sev} /></span>
                          <div className="cpf-risk__txt">
                            <div className="cpf-risk__t">{r.title}</div>
                            <div className="cpf-risk__d">{r.note}</div>
                          </div>
                          <span className="cpf-risk__tag">{r.tag}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="cpf-risk__empty">Select a supplier to view risk alerts.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
