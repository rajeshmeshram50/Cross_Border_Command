import { useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Product — 6-step wizard
 *
 * Steps:
 *   1. Product Information   (Core / Sales / Quality tab strip)
 *   2. Sales Configuration   (pricing + GST)
 *   3. Quality Compliance    (box matrix + QC list)
 *   4. Document Upload
 *   5. Review & Validation
 *   6. Vendor Mapping
 *
 * The form stays local — validation is light. `onSubmit` fires when the user
 * completes step 6 and clicks "Save Product".
 * ──────────────────────────────────────────────────────────────────────── */

export type AddProductPayload = {
  name: string;
  genericName: string;
  description: string;
  brand: string;
  segment: string;
  hazType: string;
  hazClass: string;
  uom: string;
  hsn: string;
  condition: string;
  packagingMaterial: string;
  confidential: string;
  basePrice: number;
  gstPct: number;
  gstAmt: number;
  totalPrice: number;
  markBottom: string;
  netWeight: number;
  grossWeight: number;
  length: number;
  width: number;
  height: number;
  qcRecords: QcRecord[];
  documents: Array<{ name: string; type: string }>;
  vendors: Array<{ name: string; price: number; lead: string }>;
};

type QcRecord = { id: number; name: string; standard: string; mandatory: boolean };

const STEP_LABELS: { n: number; title: string; sub: string }[] = [
  { n: 1, title: 'Product Information',  sub: 'Add basic product details' },
  { n: 2, title: 'Sales Configuration',  sub: 'Set price and GST' },
  { n: 3, title: 'Quality Compliance',   sub: 'Define quality rules' },
  { n: 4, title: 'Document Upload',      sub: 'Upload required documents' },
  { n: 5, title: 'Review & Validation',  sub: 'Check all details' },
  { n: 6, title: 'Vendor',               sub: 'Link vendors' },
];

type CoreTab = 'core' | 'sales' | 'quality';

export default function AddProductModal(props: { onClose: () => void; onSubmit: (payload: AddProductPayload) => void }) {
  const { onClose, onSubmit } = props;
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [coreTab, setCoreTab] = useState<CoreTab>('core');
  const [previousOpen, setPreviousOpen] = useState(true);

  /* ─── Form state ─── */
  const [name, setName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [segment, setSegment] = useState('');
  const [hazType, setHazType] = useState('');
  const [hazClass, setHazClass] = useState('');
  const [uom, setUom] = useState('');
  const [hsn, setHsn] = useState('');
  const [condition, setCondition] = useState('');
  const [packagingMaterial, setPackagingMaterial] = useState('');
  const [confidential, setConfidential] = useState('');

  const [basePrice, setBasePrice] = useState<number>(0);
  const [gstPct, setGstPct] = useState<number>(0);
  const [markBottom, setMarkBottom] = useState('');
  const gstAmt   = +(basePrice * (gstPct / 100)).toFixed(2);
  const totalPrice = +(basePrice + gstAmt).toFixed(2);

  const [netWeight, setNetWeight] = useState<number>(0);
  const [grossWeight, setGrossWeight] = useState<number>(0);
  const [length, setLength] = useState<number>(0);
  const [width, setWidth] = useState<number>(0);
  const [height, setHeight] = useState<number>(0);

  const [qcRecords, setQcRecords] = useState<QcRecord[]>([]);

  const [documents, setDocuments] = useState<Array<{ name: string; type: string }>>([]);
  const [vendors, setVendors] = useState<Array<{ name: string; price: number; lead: string }>>([]);
  const [vendorDraft, setVendorDraft] = useState({ name: '', price: 0, lead: '' });

  /* ─── Step navigation ─── */
  const next = () => setStep(s => (Math.min(6, s + 1) as 1 | 2 | 3 | 4 | 5 | 6));
  const prev = () => setStep(s => (Math.max(1, s - 1) as 1 | 2 | 3 | 4 | 5 | 6));

  const submitAll = () => onSubmit({
    name, genericName, description, brand, segment,
    hazType, hazClass, uom, hsn, condition, packagingMaterial, confidential,
    basePrice, gstPct, gstAmt, totalPrice, markBottom,
    netWeight, grossWeight, length, width, height,
    qcRecords, documents, vendors,
  });

  return (
    <div className="apm-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="apm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header (purple gradient) */}
        <div className="apm-head">
          <div className="apm-head-left">
            <div className="apm-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
            </div>
            <div>
              <div className="apm-title">Add Product</div>
              <div className="apm-sub">Add complete product details including pricing, compliance, and vendor details.</div>
            </div>
          </div>
          <div className="apm-head-right">
            <button className="apm-map-vendor">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Map Vendor
            </button>
            <button className="apm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* Stepper */}
        <div className="apm-stepper">
          {STEP_LABELS.map((s, i) => {
            const state = step > s.n ? 'done' : step === s.n ? 'active' : 'idle';
            return (
              <div key={s.n} className="apm-stepper-item-wrap">
                <div className={`apm-step apm-step-${state}`}>
                  <div className="apm-step-num">
                    {state === 'done'
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      : s.n}
                  </div>
                  <div>
                    <div className="apm-step-title">{s.title}</div>
                    <div className="apm-step-sub">{s.sub}</div>
                  </div>
                </div>
                {i < STEP_LABELS.length - 1 && <div className={`apm-step-line ${step > s.n ? 'done' : ''}`} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="apm-body">
          {/* Previous stages summary (steps 2+) */}
          {step > 1 && (
            <div className="apm-prev">
              <div className="apm-prev-head">
                <div className="apm-prev-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  What you did in previous stages
                  <span className="apm-prev-chip">Step 1–{step - 1} Complete</span>
                </div>
                <button className="apm-prev-toggle" onClick={() => setPreviousOpen(o => !o)}>{previousOpen ? 'Hide' : 'Show'}</button>
              </div>
              {previousOpen && (
                <>
                  <div className="apm-prev-section-label">⊕ PRODUCT CORE</div>
                  <div className="apm-prev-grid">
                    <PrevField label="Product Name" value={name || '—'} />
                    <PrevField label="Generic Name" value={genericName || '—'} />
                    <PrevField label="HSN/SAC" value={hsn || 'Select'} />
                    <PrevField label="Segment" value={segment || 'Select'} />
                    <PrevField label="HAZ/Non-HAZ" value={hazType || '—'} />
                    <PrevField label="UOM" value={uom || 'Select'} />
                  </div>
                  {step >= 3 && (
                    <>
                      <div className="apm-prev-section-label">⊕ SALES CONFIG</div>
                      <div className="apm-prev-grid apm-prev-grid-sales">
                        <PrevField label="Base Price" value={`₹${basePrice}`} />
                        <PrevField label="GST %" value={`${gstPct}%`} />
                        <PrevField label="GST Amt" value={`₹${gstAmt}`} />
                        <PrevField label="Total Price" value={`₹${totalPrice}`} />
                        <PrevField label="Bottom" value={markBottom || 'Select'} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step content */}
          {step === 1 && (
            <>
              <div className="apm-coretabs">
                <button className={`apm-coretab ${coreTab === 'core' ? 'on' : ''}`} onClick={() => setCoreTab('core')}>Product Core Information</button>
                <button className={`apm-coretab ${coreTab === 'sales' ? 'on' : ''}`} onClick={() => setCoreTab('sales')}>For Sales Department</button>
                <button className={`apm-coretab ${coreTab === 'quality' ? 'on' : ''}`} onClick={() => setCoreTab('quality')}>Quality &amp; Compliance</button>
              </div>

              {coreTab === 'core' && (
                <Step1ProductCore
                  name={name} setName={setName}
                  genericName={genericName} setGenericName={setGenericName}
                  description={description} setDescription={setDescription}
                  brand={brand} setBrand={setBrand}
                  segment={segment} setSegment={setSegment}
                  hazType={hazType} setHazType={setHazType}
                  hazClass={hazClass} setHazClass={setHazClass}
                  uom={uom} setUom={setUom}
                  hsn={hsn} setHsn={setHsn}
                  condition={condition} setCondition={setCondition}
                  packagingMaterial={packagingMaterial} setPackagingMaterial={setPackagingMaterial}
                  confidential={confidential} setConfidential={setConfidential}
                />
              )}
              {coreTab === 'sales'   && <Step1ForSales preview />}
              {coreTab === 'quality' && <Step1QualityPreview preview />}
            </>
          )}

          {step === 2 && (
            <>
              <div className="apm-coretabs">
                <button className="apm-coretab" onClick={() => { setStep(1); setCoreTab('core'); }}>Product Core Information</button>
                <button className="apm-coretab on">For Sales Department</button>
                <button className="apm-coretab" onClick={() => setStep(3)}>Quality &amp; Compliance</button>
              </div>

              <Step2Sales
                basePrice={basePrice} setBasePrice={setBasePrice}
                gstPct={gstPct} setGstPct={setGstPct}
                gstAmt={gstAmt} totalPrice={totalPrice}
                markBottom={markBottom} setMarkBottom={setMarkBottom}
              />
            </>
          )}

          {step === 3 && (
            <>
              <div className="apm-coretabs">
                <button className="apm-coretab" onClick={() => { setStep(1); setCoreTab('core'); }}>Product Core Information</button>
                <button className="apm-coretab" onClick={() => setStep(2)}>For Sales Department</button>
                <button className="apm-coretab on">Quality &amp; Compliance</button>
              </div>

              <Step3Quality
                netWeight={netWeight} setNetWeight={setNetWeight}
                grossWeight={grossWeight} setGrossWeight={setGrossWeight}
                length={length} setLength={setLength}
                width={width} setWidth={setWidth}
                height={height} setHeight={setHeight}
                qcRecords={qcRecords} setQcRecords={setQcRecords}
              />
            </>
          )}

          {step === 4 && <Step4Documents documents={documents} setDocuments={setDocuments} />}

          {step === 5 && (
            <Step5Review
              name={name} genericName={genericName} brand={brand} segment={segment}
              hsn={hsn} uom={uom} hazType={hazType} hazClass={hazClass}
              basePrice={basePrice} gstPct={gstPct} gstAmt={gstAmt} totalPrice={totalPrice}
              netWeight={netWeight} grossWeight={grossWeight} length={length} width={width} height={height}
              qcRecords={qcRecords} documents={documents}
            />
          )}

          {step === 6 && (
            <Step6Vendor
              vendors={vendors} setVendors={setVendors}
              draft={vendorDraft} setDraft={setVendorDraft}
            />
          )}
        </div>

        {/* Footer */}
        <div className="apm-foot">
          <button className="apm-btn-cancel" onClick={onClose}>Cancel</button>
          <div className="apm-foot-right">
            {step > 1 && (
              <button className="apm-btn-prev" onClick={prev}>← Previous</button>
            )}
            {step < 6 ? (
              <button className="apm-btn-next" onClick={next}>Save &amp; Next →</button>
            ) : (
              <button className="apm-btn-save" onClick={submitAll}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Save Product
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Subcomponents
 * ════════════════════════════════════════════════════════════════════════ */

function PrevField(props: { label: string; value: string }) {
  return (
    <div className="apm-prev-field">
      <div className="apm-prev-label">{props.label}</div>
      <div className="apm-prev-value">{props.value}</div>
    </div>
  );
}

/* ─── STEP 1 — Product Core Information ─── */
function Step1ProductCore(props: any) {
  const SEGMENTS = ['Dry Fruits', 'Rice & Grains', 'Spices', 'Coconut Oil', 'Seeds', 'Coffee Beans', 'Pulses', 'Mango Pulp', 'Millets', 'Chemicals'];
  const HAZ = ['HAZ', 'NON HAZ'];
  const HAZ_CLASSES = ['Class 1 - Explosives', 'Class 3 - Flammable Liquids', 'Class 4 - Flammable Solids', 'Class 8 - Corrosives', 'Class 9 - Misc Hazardous'];
  const UOMS = ['Kg', 'L', 'Box', 'Pcs', 'MT', 'Dozen'];
  const HSN = ['08013100', '10063020', '09103030', '15131100', '12074090', '09011190', '07136000', '08045010'];
  const CONDITIONS = ['New', 'Refurbished', 'Damaged', 'Used'];
  const PACKAGING = ['Carton Box', 'Plastic Pouch', 'Glass Jar', 'Drum', 'Sack/Bag', 'Pallet'];

  return (
    <div className="apm-panel">
      <div className="apm-panel-head">
        <div className="apm-panel-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        </div>
        <div>
          <div className="apm-panel-title">Product Core Information</div>
          <div className="apm-panel-sub">Basic identity, classification and media</div>
        </div>
      </div>

      <div className="apm-grid-2">
        <Field label="Product Name" required>
          <input className="apm-input" placeholder="Enter product name" value={props.name} onChange={(e) => props.setName(e.target.value)} />
        </Field>
        <Field label="Generic Name" required>
          <input className="apm-input" placeholder="Enter generic name" value={props.genericName} onChange={(e) => props.setGenericName(e.target.value)} />
        </Field>
        <Field label="Product Printable Description" required full>
          <textarea className="apm-textarea" placeholder="Enter printable description" value={props.description} onChange={(e) => props.setDescription(e.target.value)} />
        </Field>
        <Field label="Make / Brand / Specifications" required>
          <input className="apm-input" placeholder="Make / Brand / Specifications" value={props.brand} onChange={(e) => props.setBrand(e.target.value)} />
        </Field>
        <Field label="Segment" required addable>
          <select className="apm-input" value={props.segment} onChange={(e) => props.setSegment(e.target.value)}>
            <option value="">Select</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Product Primary Image" required>
          <div className="apm-upload">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            Click to upload primary image
          </div>
        </Field>
        <Field label="Product Secondary Images" required>
          <div className="apm-upload">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            You Can Add Multiple Attachments
          </div>
        </Field>
      </div>

      <div className="apm-subpanel">
        <div className="apm-subpanel-label">PRODUCT GENERAL INFORMATION</div>
        <div className="apm-grid-3">
          <Field label="HAZ / NON HAZ" required>
            <select className="apm-input" value={props.hazType} onChange={(e) => props.setHazType(e.target.value)}>
              <option value="">Select</option>
              {HAZ.map(h => <option key={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="HAZ Class" required addable>
            <select className="apm-input" value={props.hazClass} onChange={(e) => props.setHazClass(e.target.value)}>
              <option value="">Select</option>
              {HAZ_CLASSES.map(h => <option key={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="UOM" required addable>
            <select className="apm-input" value={props.uom} onChange={(e) => props.setUom(e.target.value)}>
              <option value="">Select</option>
              {UOMS.map(u => <option key={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="HSN / SAC Code" required addable>
            <select className="apm-input" value={props.hsn} onChange={(e) => props.setHsn(e.target.value)}>
              <option value="">Select</option>
              {HSN.map(h => <option key={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="Condition" required addable>
            <select className="apm-input" value={props.condition} onChange={(e) => props.setCondition(e.target.value)}>
              <option value="">Select</option>
              {CONDITIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Packaging Material" required addable>
            <select className="apm-input" value={props.packagingMaterial} onChange={(e) => props.setPackagingMaterial(e.target.value)}>
              <option value="">Select</option>
              {PACKAGING.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <Field label="Confidential Info" full>
        <textarea className="apm-textarea" placeholder="Confidential information" value={props.confidential} onChange={(e) => props.setConfidential(e.target.value)} />
      </Field>
    </div>
  );
}

function Step1ForSales(_props: { preview: boolean }) {
  return (
    <div className="apm-coretab-preview">
      <div className="apm-coretab-preview-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
      </div>
      <div className="apm-coretab-preview-title">For Sales Department</div>
      <div className="apm-coretab-preview-desc">Pricing &amp; GST configuration will open in <strong>Step 2</strong>. Complete Product Core Information first to continue.</div>
    </div>
  );
}

function Step1QualityPreview(_props: { preview: boolean }) {
  return (
    <div className="apm-coretab-preview">
      <div className="apm-coretab-preview-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
      </div>
      <div className="apm-coretab-preview-title">Quality &amp; Compliance</div>
      <div className="apm-coretab-preview-desc">Box matrix, QC records and compliance certifications will open in <strong>Step 3</strong>.</div>
    </div>
  );
}

/* ─── STEP 2 — Sales Configuration ─── */
function Step2Sales(props: {
  basePrice: number; setBasePrice: (n: number) => void;
  gstPct: number; setGstPct: (n: number) => void;
  gstAmt: number; totalPrice: number;
  markBottom: string; setMarkBottom: (s: string) => void;
}) {
  const GST_RATES = ['0', '5', '12', '18', '28'];
  return (
    <div className="apm-panel">
      <div className="apm-panel-head">
        <div className="apm-panel-icon apm-panel-icon-purple">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
        </div>
        <div>
          <div className="apm-panel-title">For Sales Department</div>
          <div className="apm-panel-sub">Pricing, GST and sales configuration</div>
        </div>
      </div>

      <div className="apm-grid-2">
        <Field label="Product Selling Price (Without GST)" required>
          <div className="apm-input-prefix">
            <span>₹</span>
            <input className="apm-input" type="number" min="0" placeholder="Enter base price" value={props.basePrice || ''} onChange={(e) => props.setBasePrice(Number(e.target.value))} />
          </div>
        </Field>
        <Field label="GST %" required addable>
          <select className="apm-input" value={props.gstPct} onChange={(e) => props.setGstPct(Number(e.target.value))}>
            <option value="0">Select</option>
            {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
        <Field label="GST Amount" required>
          <div className="apm-input-prefix apm-input-readonly">
            <span>₹</span>
            <input className="apm-input" value={props.gstAmt} readOnly />
          </div>
        </Field>
        <Field label="Total Selling Price" required>
          <div className="apm-input-prefix apm-input-total">
            <span>₹</span>
            <input className="apm-input" value={props.totalPrice} readOnly />
          </div>
        </Field>
        <Field label="Mark Bottom / Non Bottom" required full>
          <select className="apm-input" value={props.markBottom} onChange={(e) => props.setMarkBottom(e.target.value)}>
            <option value="">Select</option>
            <option>Bottom</option>
            <option>Non Bottom</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

/* ─── STEP 3 — Quality & Compliance ─── */
function Step3Quality(props: {
  netWeight: number; setNetWeight: (n: number) => void;
  grossWeight: number; setGrossWeight: (n: number) => void;
  length: number; setLength: (n: number) => void;
  width: number; setWidth: (n: number) => void;
  height: number; setHeight: (n: number) => void;
  qcRecords: QcRecord[]; setQcRecords: (q: QcRecord[]) => void;
}) {
  const [qcDraft, setQcDraft] = useState({ name: '', standard: '', mandatory: false });
  const addQc = () => {
    if (!qcDraft.name) return;
    props.setQcRecords([...props.qcRecords, { id: Date.now(), ...qcDraft }]);
    setQcDraft({ name: '', standard: '', mandatory: false });
  };
  const removeQc = (id: number) => props.setQcRecords(props.qcRecords.filter(q => q.id !== id));

  return (
    <>
      <div className="apm-panel apm-panel-orange">
        <div className="apm-panel-head">
          <div className="apm-panel-icon apm-panel-icon-orange">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" /></svg>
          </div>
          <div>
            <div className="apm-panel-title">Box Matrix Details</div>
            <div className="apm-panel-sub">Physical dimensions and weight specifications</div>
          </div>
        </div>
        <div className="apm-grid-5">
          <Field label="Net Weight (kg)">
            <input className="apm-input apm-input-orange" type="number" min="0" placeholder="Net Weight" value={props.netWeight || ''} onChange={(e) => props.setNetWeight(Number(e.target.value))} />
          </Field>
          <Field label="Gross Weight (kg)">
            <input className="apm-input apm-input-orange" type="number" min="0" placeholder="Gross Weight" value={props.grossWeight || ''} onChange={(e) => props.setGrossWeight(Number(e.target.value))} />
          </Field>
          <Field label="Length (cm)">
            <input className="apm-input apm-input-orange" type="number" min="0" placeholder="Length" value={props.length || ''} onChange={(e) => props.setLength(Number(e.target.value))} />
          </Field>
          <Field label="Width (cm)">
            <input className="apm-input apm-input-orange" type="number" min="0" placeholder="Width" value={props.width || ''} onChange={(e) => props.setWidth(Number(e.target.value))} />
          </Field>
          <Field label="Height (cm)">
            <input className="apm-input apm-input-orange" type="number" min="0" placeholder="Height" value={props.height || ''} onChange={(e) => props.setHeight(Number(e.target.value))} />
          </Field>
        </div>
      </div>

      <div className="apm-panel apm-panel-green">
        <div className="apm-panel-head">
          <div className="apm-panel-head-left-grouped">
            <div className="apm-panel-icon apm-panel-icon-green">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            </div>
            <div>
              <div className="apm-panel-title">QC &amp; Compliance</div>
              <div className="apm-panel-sub">Quality standards and compliance certifications</div>
            </div>
          </div>
          <button className="apm-add-qc" onClick={addQc} disabled={!qcDraft.name}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add QC
          </button>
        </div>

        <div className="apm-qc-form">
          <input className="apm-input" placeholder="QC name (e.g. Moisture, Aflatoxin)" value={qcDraft.name} onChange={(e) => setQcDraft({ ...qcDraft, name: e.target.value })} />
          <input className="apm-input" placeholder="Standard / threshold" value={qcDraft.standard} onChange={(e) => setQcDraft({ ...qcDraft, standard: e.target.value })} />
          <label className="apm-qc-mand">
            <input type="checkbox" checked={qcDraft.mandatory} onChange={(e) => setQcDraft({ ...qcDraft, mandatory: e.target.checked })} />
            Mandatory
          </label>
        </div>

        {props.qcRecords.length === 0 ? (
          <div className="apm-qc-empty">No QC records. Click "Add QC" to begin.</div>
        ) : (
          <table className="apm-qc-table">
            <thead><tr><th>Name</th><th>Standard</th><th>Mandatory</th><th></th></tr></thead>
            <tbody>
              {props.qcRecords.map(q => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td>{q.standard || '—'}</td>
                  <td>{q.mandatory ? <span className="apm-yes">Yes</span> : <span className="apm-no">No</span>}</td>
                  <td><button className="apm-row-del" onClick={() => removeQc(q.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ─── STEP 4 — Documents ─── */
function Step4Documents(props: { documents: Array<{ name: string; type: string }>; setDocuments: (d: Array<{ name: string; type: string }>) => void; }) {
  const TYPES = ['MSDS', 'COA', 'Phytosanitary', 'Fumigation', 'Insurance', 'Origin Certificate', 'Other'];
  const add = (type: string) => props.setDocuments([...props.documents, { name: `Sample ${type} Document.pdf`, type }]);
  const remove = (i: number) => props.setDocuments(props.documents.filter((_, idx) => idx !== i));
  return (
    <div className="apm-panel">
      <div className="apm-panel-head">
        <div className="apm-panel-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
        </div>
        <div>
          <div className="apm-panel-title">Document Upload</div>
          <div className="apm-panel-sub">Attach MSDS, COA, certificates and other compliance docs</div>
        </div>
      </div>

      <div className="apm-doc-types">
        {TYPES.map(t => (
          <button key={t} className="apm-doc-type" onClick={() => add(t)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {t}
          </button>
        ))}
      </div>

      {props.documents.length === 0 ? (
        <div className="apm-upload apm-upload-big">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          <div>
            <div className="apm-upload-big-title">Drop files here or click a document type above</div>
            <div className="apm-upload-big-sub">Accepted: PDF, JPG, PNG, DOCX · up to 10 MB each</div>
          </div>
        </div>
      ) : (
        <div className="apm-doc-list">
          {props.documents.map((d, i) => (
            <div key={i} className="apm-doc-row">
              <div className="apm-doc-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              </div>
              <div>
                <div className="apm-doc-name">{d.name}</div>
                <div className="apm-doc-meta">{d.type} · uploaded just now</div>
              </div>
              <button className="apm-row-del" onClick={() => remove(i)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── STEP 5 — Review ─── */
function Step5Review(props: any) {
  return (
    <div className="apm-panel">
      <div className="apm-panel-head">
        <div className="apm-panel-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>
        </div>
        <div>
          <div className="apm-panel-title">Review &amp; Validation</div>
          <div className="apm-panel-sub">Confirm every detail before saving</div>
        </div>
      </div>

      <div className="apm-review-grid">
        <ReviewRow label="Product Name" value={props.name} />
        <ReviewRow label="Generic Name" value={props.genericName} />
        <ReviewRow label="Brand" value={props.brand} />
        <ReviewRow label="Segment" value={props.segment} />
        <ReviewRow label="HSN/SAC" value={props.hsn} />
        <ReviewRow label="UOM" value={props.uom} />
        <ReviewRow label="HAZ / Non HAZ" value={props.hazType} />
        <ReviewRow label="HAZ Class" value={props.hazClass} />
        <ReviewRow label="Base Price" value={`₹${props.basePrice}`} />
        <ReviewRow label="GST %" value={`${props.gstPct}%`} />
        <ReviewRow label="GST Amount" value={`₹${props.gstAmt}`} />
        <ReviewRow label="Total Price" value={`₹${props.totalPrice}`} highlight />
        <ReviewRow label="Net Weight" value={`${props.netWeight} kg`} />
        <ReviewRow label="Gross Weight" value={`${props.grossWeight} kg`} />
        <ReviewRow label="Dimensions" value={`${props.length} × ${props.width} × ${props.height} cm`} />
        <ReviewRow label="QC Records" value={`${props.qcRecords.length}`} />
        <ReviewRow label="Documents Uploaded" value={`${props.documents.length}`} />
      </div>

      <div className="apm-review-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.3"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        All required fields look complete. Move to <strong>Vendor</strong> to link sourcing.
      </div>
    </div>
  );
}

function ReviewRow(props: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`apm-review-cell ${props.highlight ? 'highlight' : ''}`}>
      <div className="apm-review-label">{props.label}</div>
      <div className="apm-review-value">{props.value || '—'}</div>
    </div>
  );
}

/* ─── STEP 6 — Vendor ─── */
function Step6Vendor(props: {
  vendors: Array<{ name: string; price: number; lead: string }>;
  setVendors: (v: Array<{ name: string; price: number; lead: string }>) => void;
  draft: { name: string; price: number; lead: string };
  setDraft: (d: { name: string; price: number; lead: string }) => void;
}) {
  const add = () => {
    if (!props.draft.name) return;
    props.setVendors([...props.vendors, props.draft]);
    props.setDraft({ name: '', price: 0, lead: '' });
  };
  const remove = (i: number) => props.setVendors(props.vendors.filter((_, idx) => idx !== i));
  return (
    <div className="apm-panel">
      <div className="apm-panel-head">
        <div className="apm-panel-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="9" cy="7" r="4" /><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        </div>
        <div>
          <div className="apm-panel-title">Vendor Mapping</div>
          <div className="apm-panel-sub">Link approved vendors and their commercial terms</div>
        </div>
      </div>

      <div className="apm-vendor-form">
        <input className="apm-input" placeholder="Vendor name" value={props.draft.name} onChange={(e) => props.setDraft({ ...props.draft, name: e.target.value })} />
        <input className="apm-input" type="number" min="0" placeholder="Price per UOM" value={props.draft.price || ''} onChange={(e) => props.setDraft({ ...props.draft, price: Number(e.target.value) })} />
        <input className="apm-input" placeholder="Lead time (e.g. 7 days)" value={props.draft.lead} onChange={(e) => props.setDraft({ ...props.draft, lead: e.target.value })} />
        <button className="apm-add-qc" onClick={add} disabled={!props.draft.name}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Map Vendor
        </button>
      </div>

      {props.vendors.length === 0 ? (
        <div className="apm-qc-empty">No vendors mapped yet. Add at least one vendor to finish.</div>
      ) : (
        <table className="apm-qc-table">
          <thead><tr><th>Vendor</th><th>Price</th><th>Lead Time</th><th></th></tr></thead>
          <tbody>
            {props.vendors.map((v, i) => (
              <tr key={i}>
                <td>{v.name}</td>
                <td>₹{v.price}</td>
                <td>{v.lead || '—'}</td>
                <td><button className="apm-row-del" onClick={() => remove(i)}>Unmap</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── Field wrapper ─── */
function Field(props: { label: string; required?: boolean; addable?: boolean; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`apm-field ${props.full ? 'apm-field-full' : ''}`}>
      <label className="apm-field-label">
        {props.label}
        {props.required && <span className="apm-req-star"> *</span>}
        {props.addable && <span className="apm-addable">+</span>}
      </label>
      {props.children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Scoped CSS
 * ════════════════════════════════════════════════════════════════════════ */
const SCOPED_CSS = `
.apm-backdrop {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(15, 23, 42, .58);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.apm-backdrop *, .apm-backdrop *::before, .apm-backdrop *::after { box-sizing: border-box; }
.apm-modal {
  width: 100%; max-width: 1180px;
  background: #fff; border-radius: 18px;
  box-shadow: 0 28px 64px rgba(15, 23, 42, .38);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 48px); overflow: hidden;
}

/* Header */
.apm-head {
  padding: 18px 22px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  color: #fff;
  background: linear-gradient(110deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%);
}
.apm-head-left { display: flex; align-items: center; gap: 14px; }
.apm-head-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: rgba(255,255,255,.15); border: 1.5px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.apm-title { font-size: 17px; font-weight: 800; letter-spacing: -.3px; }
.apm-sub   { font-size: 12px; opacity: .85; margin-top: 2px; }

.apm-head-right { display: flex; align-items: center; gap: 10px; }
.apm-map-vendor {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 9px;
  background: rgba(255,255,255,.12); border: 1.5px solid rgba(255,255,255,.25);
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s;
}
.apm-map-vendor:hover { background: rgba(255,255,255,.22); }
.apm-close {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.12); border: 1.5px solid rgba(255,255,255,.25);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.apm-close:hover { background: rgba(255,255,255,.22); }

/* Stepper */
.apm-stepper {
  display: flex; align-items: stretch; gap: 0;
  padding: 14px 22px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  overflow-x: auto;
}
.apm-stepper-item-wrap { display: flex; align-items: center; flex: 1; min-width: 200px; }
.apm-step {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 12px;
  border: 1.5px solid transparent;
  background: #fff;
  transition: all .15s;
  flex: 1;
}
.apm-step-num {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
  flex-shrink: 0;
}
.apm-step-title { font-size: 12.5px; font-weight: 800; line-height: 1.2; }
.apm-step-sub   { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }

.apm-step-idle { background: #fff; border-color: #e2e8f0; }
.apm-step-idle .apm-step-num   { background: #f1f5f9; color: #94a3b8; }
.apm-step-idle .apm-step-title { color: #94a3b8; }

.apm-step-active { background: #f5f3ff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,58,237,.15); }
.apm-step-active .apm-step-num { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; }
.apm-step-active .apm-step-title { color: #6d28d9; }

.apm-step-done .apm-step-num { background: linear-gradient(135deg, #4ade80, #22c55e); color: #fff; }
.apm-step-done .apm-step-title { color: #15803d; }
.apm-step-done { background: #f0fdf4; border-color: #bbf7d0; }

.apm-step-line {
  flex: 0 0 20px; height: 2px;
  background: #e2e8f0;
  margin: 0 6px;
}
.apm-step-line.done { background: linear-gradient(90deg, #4ade80, #22c55e); }

/* Body */
.apm-body {
  padding: 18px 22px;
  overflow-y: auto;
  flex: 1;
  background: #fff;
  display: flex; flex-direction: column; gap: 14px;
}

/* Previous stages summary */
.apm-prev {
  background: linear-gradient(110deg, #f0fdf4 0%, #ecfdf5 100%);
  border: 1.5px solid #bbf7d0;
  border-radius: 12px;
  padding: 14px 16px;
}
.apm-prev-head { display: flex; align-items: center; justify-content: space-between; }
.apm-prev-title {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 13px; font-weight: 800; color: #15803d;
}
.apm-prev-title > svg {
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border-radius: 50%;
  padding: 4px;
  width: 22px; height: 22px;
}
.apm-prev-chip {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 99px;
  background: rgba(34,197,94,.15); border: 1px solid #86efac;
  font-size: 10.5px; font-weight: 800; color: #15803d;
}
.apm-prev-toggle {
  border: 1.5px solid #bbf7d0;
  background: #fff; color: #15803d;
  font-family: inherit; font-size: 11.5px; font-weight: 800;
  padding: 5px 14px; border-radius: 99px; cursor: pointer;
}
.apm-prev-section-label {
  font-size: 11px; font-weight: 800; letter-spacing: .06em;
  color: #2563eb; margin-top: 12px; margin-bottom: 8px;
}
.apm-prev-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;
}
.apm-prev-grid-sales { grid-template-columns: repeat(5, 1fr); }
.apm-prev-field {
  background: #fff;
  border: 1.5px solid #e2e8f0; border-radius: 9px;
  padding: 8px 10px;
}
.apm-prev-label { font-size: 9.5px; font-weight: 800; letter-spacing: .05em; color: #94a3b8; text-transform: uppercase; }
.apm-prev-value { font-size: 12px; font-weight: 800; color: #5b21b6; margin-top: 2px; }

/* Tabs inside step 1/2/3 */
.apm-coretabs {
  display: flex; align-items: center; gap: 0;
  border-bottom: 1.5px solid #e2e8f0;
}
.apm-coretab {
  padding: 10px 16px;
  border: none; background: transparent;
  color: #94a3b8;
  font-family: inherit; font-size: 13px; font-weight: 800;
  cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.apm-coretab:hover { color: #6d28d9; }
.apm-coretab.on {
  color: #7c3aed;
  border-bottom-color: #7c3aed;
}

/* Generic panel */
.apm-panel {
  border: 1.5px solid #ddd6fe;
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
  position: relative;
}
.apm-panel::before {
  content: '';
  position: absolute; left: 0; top: 16px; bottom: 16px;
  width: 3px; border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #a78bfa, #7c3aed);
}
.apm-panel-orange { border-color: #fed7aa; }
.apm-panel-orange::before { background: linear-gradient(180deg, #fbbf24, #d97706); }
.apm-panel-green  { border-color: #bbf7d0; }
.apm-panel-green::before  { background: linear-gradient(180deg, #4ade80, #15803d); }

.apm-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-left: 6px;
  margin-bottom: 14px;
}
.apm-panel-head-left-grouped { display: flex; align-items: center; gap: 10px; }
.apm-panel-icon {
  width: 32px; height: 32px; border-radius: 10px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.apm-panel-icon-purple { background: linear-gradient(135deg, #a78bfa, #7c3aed); }
.apm-panel-icon-orange { background: linear-gradient(135deg, #fbbf24, #d97706); }
.apm-panel-icon-green  { background: linear-gradient(135deg, #4ade80, #15803d); }
.apm-panel-title { font-size: 13.5px; font-weight: 800; color: #1e1b4b; }
.apm-panel-sub   { font-size: 11px; color: #6b7280; margin-top: 1px; }

/* Sub-panel inside step 1 (General Information) */
.apm-subpanel {
  margin-top: 6px;
  padding: 12px 14px;
  background: #faf5ff;
  border: 1.5px solid #ede9fe;
  border-radius: 10px;
}
.apm-subpanel-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  color: #5b21b6; margin-bottom: 10px;
}

/* Grids */
.apm-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 16px; }
.apm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 16px; }
.apm-grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px 14px; }

/* Field */
.apm-field { display: flex; flex-direction: column; gap: 4px; }
.apm-field-full { grid-column: 1 / -1; }
.apm-field-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 800; color: #5b21b6;
  letter-spacing: .04em; text-transform: uppercase;
}
.apm-req-star { color: #ef4444; }
.apm-addable {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 4px;
  background: #ede9fe; color: #7c3aed;
  font-weight: 800; font-size: 12px;
  cursor: pointer;
}

.apm-input {
  width: 100%; height: 38px; padding: 0 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  font-family: inherit; font-size: 12.5px; color: #1e1b4b;
  outline: none;
  transition: border .15s, box-shadow .15s;
}
.apm-input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
.apm-input-orange { border-color: #fed7aa; background: #fffaf0; }
.apm-input-orange:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,.12); }
.apm-textarea {
  width: 100%; min-height: 64px; padding: 8px 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  font-family: inherit; font-size: 12.5px; color: #1e1b4b;
  background: #fff;
  outline: none; resize: vertical;
}
.apm-textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }

.apm-input-prefix {
  display: flex; align-items: center;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  padding-left: 12px;
}
.apm-input-prefix span { color: #94a3b8; font-weight: 800; font-size: 13px; }
.apm-input-prefix .apm-input { border: none; background: transparent; height: 36px; padding-left: 6px; box-shadow: none; }
.apm-input-readonly { background: #f8fafc; }
.apm-input-readonly span { color: #475569; }
.apm-input-total { background: #f0fdf4; border-color: #bbf7d0; }
.apm-input-total span { color: #15803d; }
.apm-input-total .apm-input { color: #15803d; font-weight: 800; }

/* Upload tile */
.apm-upload {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 88px;
  border: 2px dashed #c4b5fd;
  border-radius: 10px;
  background: #faf5ff;
  color: #7c3aed; font-size: 12px; font-weight: 800;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.apm-upload:hover { background: #f5f3ff; border-color: #a78bfa; }
.apm-upload-big {
  height: 140px; flex-direction: column; gap: 6px; padding: 16px;
}
.apm-upload-big-title { font-size: 13px; color: #5b21b6; }
.apm-upload-big-sub { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 4px; }

/* Document types row */
.apm-doc-types { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.apm-doc-type {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 99px;
  background: #faf5ff; border: 1.5px solid #ddd6fe;
  color: #6d28d9; font-family: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer;
  transition: all .15s;
}
.apm-doc-type:hover { background: #ede9fe; transform: translateY(-1px); }

.apm-doc-list { display: flex; flex-direction: column; gap: 8px; }
.apm-doc-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  border: 1.5px solid #e8e4f9; border-radius: 10px;
  background: #fff;
}
.apm-doc-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: #ede9fe; color: #7c3aed;
  display: inline-flex; align-items: center; justify-content: center;
}
.apm-doc-name { font-size: 12.5px; font-weight: 700; color: #1e1b4b; }
.apm-doc-meta { font-size: 10.5px; color: #94a3b8; font-weight: 600; margin-top: 1px; }
.apm-doc-row > button { margin-left: auto; }

/* QC form */
.apm-add-qc {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #4ade80, #15803d);
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 800;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(34,197,94,.35);
  transition: transform .15s;
}
.apm-add-qc:hover:not(:disabled) { transform: translateY(-1px); }
.apm-add-qc:disabled { opacity: .55; cursor: not-allowed; }

.apm-qc-form, .apm-vendor-form {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 10px; align-items: center;
  margin-bottom: 12px;
}
.apm-vendor-form { grid-template-columns: 1.5fr 1fr 1fr auto; }
.apm-qc-mand {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #5b21b6;
  padding: 0 10px;
}
.apm-qc-mand input { width: 14px; height: 14px; accent-color: #7c3aed; }

.apm-qc-empty {
  text-align: center; padding: 18px;
  color: #94a3b8; font-size: 12.5px; font-weight: 600;
  background: #faf5ff; border: 1.5px dashed #ddd6fe;
  border-radius: 10px;
}

.apm-qc-table {
  width: 100%; border-collapse: collapse;
  font-size: 12px;
}
.apm-qc-table thead tr { background: linear-gradient(90deg, #6d28d9, #7c3aed); }
.apm-qc-table thead th { color: #fff; padding: 10px 12px; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; text-align: left; }
.apm-qc-table tbody td { padding: 9px 12px; border-bottom: 1px solid #f1f0fc; color: #475569; }
.apm-yes { padding: 2px 8px; border-radius: 99px; background: #dcfce7; color: #15803d; font-size: 10.5px; font-weight: 800; }
.apm-no  { padding: 2px 8px; border-radius: 99px; background: #f3f4f6; color: #475569; font-size: 10.5px; font-weight: 800; }
.apm-row-del {
  border: 1.5px solid #fecaca; background: #fef2f2; color: #dc2626;
  padding: 5px 12px; border-radius: 7px;
  font-family: inherit; font-size: 11px; font-weight: 800; cursor: pointer;
}

/* Coretab preview placeholder */
.apm-coretab-preview {
  background: #faf5ff;
  border: 1.5px dashed #ddd6fe;
  border-radius: 12px;
  padding: 36px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  text-align: center;
}
.apm-coretab-preview-icon {
  width: 50px; height: 50px; border-radius: 14px;
  background: #ede9fe;
  display: flex; align-items: center; justify-content: center;
}
.apm-coretab-preview-title { font-size: 14px; font-weight: 800; color: #5b21b6; }
.apm-coretab-preview-desc  { font-size: 12px; color: #6b7280; max-width: 480px; }

/* Review grid */
.apm-review-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
}
.apm-review-cell {
  padding: 9px 12px;
  border: 1.5px solid #e8e4f9;
  border-radius: 9px;
  background: #faf5ff;
}
.apm-review-cell.highlight {
  background: #ecfdf5;
  border-color: #86efac;
}
.apm-review-label { font-size: 9.5px; font-weight: 800; letter-spacing: .05em; color: #94a3b8; text-transform: uppercase; }
.apm-review-value { font-size: 12.5px; font-weight: 800; color: #5b21b6; margin-top: 3px; }
.apm-review-cell.highlight .apm-review-value { color: #15803d; }
.apm-review-note {
  display: flex; align-items: center; gap: 8px;
  margin-top: 14px;
  padding: 10px 14px;
  background: #ecfdf5; border: 1.5px solid #bbf7d0;
  border-radius: 10px;
  font-size: 12px; color: #15803d; font-weight: 700;
}

/* Footer */
.apm-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.apm-foot-right { display: flex; align-items: center; gap: 10px; }
.apm-btn-cancel {
  padding: 9px 22px; border-radius: 9px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
}
.apm-btn-cancel:hover { background: #f8fafc; }
.apm-btn-prev {
  padding: 9px 18px; border-radius: 9px;
  border: 1.5px solid #c4b5fd; background: #fff;
  color: #6d28d9; font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
}
.apm-btn-prev:hover { background: #faf5ff; }
.apm-btn-next {
  padding: 9px 22px; border-radius: 9px;
  border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 12px rgba(124,58,237,.4);
  transition: transform .15s;
}
.apm-btn-next:hover { transform: translateY(-1px); }
.apm-btn-save {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 22px; border-radius: 9px;
  border: none;
  background: linear-gradient(135deg, #4ade80, #15803d); color: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 12px rgba(34,197,94,.45);
  transition: transform .15s;
}
.apm-btn-save:hover { transform: translateY(-1px); }

@media (max-width: 1100px) {
  .apm-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .apm-grid-5 { grid-template-columns: repeat(3, 1fr); }
  .apm-prev-grid, .apm-prev-grid-sales { grid-template-columns: repeat(3, 1fr); }
  .apm-review-grid { grid-template-columns: repeat(2, 1fr); }
  .apm-stepper { gap: 6px; }
}
@media (max-width: 680px) {
  .apm-grid-2, .apm-grid-3, .apm-grid-5 { grid-template-columns: 1fr; }
  .apm-prev-grid, .apm-prev-grid-sales { grid-template-columns: repeat(2, 1fr); }
  .apm-qc-form, .apm-vendor-form { grid-template-columns: 1fr; }
  .apm-head { flex-direction: column; align-items: flex-start; gap: 12px; }
}
`;
