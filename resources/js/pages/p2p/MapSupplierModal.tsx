import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';

/* Map Supplier Directory — 2-step (static port).
 *  Step 1: choose Supplier Master vs New Supplier.
 *  Step 2 (master): pick from the verified supplier list → Map Supplier.
 *  Step 2 (new):    register a supplier (info + address + docs) → Save Supplier.
 * onMapped(name) is called with the chosen/created supplier's name. */

export type SupplierMaster = { id: string; name: string; segment: string; contact: string; mobile: string; email: string };
export const SUPPLIER_MASTER: SupplierMaster[] = [
  { id: 'S-001', name: 'TechParts India Pvt Ltd', segment: 'Mechanical', contact: 'Rahul Shah', mobile: '9876543210', email: 'rahul@techparts.in' },
  { id: 'S-002', name: 'Electro Components Co', segment: 'Electrical', contact: 'Priya Mehta', mobile: '9876501234', email: 'priya@electrocomp.in' },
  { id: 'S-003', name: 'Fluid Systems Ltd', segment: 'Hydraulics', contact: 'Amit Kumar', mobile: '9812345678', email: 'amit@fluidsys.in' },
  { id: 'S-004', name: 'Instrumentation Hub', segment: 'Instrumentation', contact: 'Neha Patel', mobile: '9823456789', email: 'neha@insthub.in' },
  { id: 'S-005', name: 'Pneumo Tech India', segment: 'Pneumatics', contact: 'Sanjay Rao', mobile: '9834567890', email: 'sanjay@pneumotech.in' },
  { id: 'S-006', name: 'AutoMation Supplies Pvt', segment: 'Automation', contact: 'Divya Singh', mobile: '9845678901', email: 'divya@automation.in' },
  { id: 'S-007', name: 'Valve World India', segment: 'Valves', contact: 'Ravi Joshi', mobile: '9856789012', email: 'ravi@valveworld.in' },
  { id: 'S-008', name: 'RawMat Solutions Ltd', segment: 'Raw Material', contact: 'Anita Gupta', mobile: '9867890123', email: 'anita@rawmat.in' },
  { id: 'S-009', name: 'FastenersPlus Pvt Ltd', segment: 'Fasteners', contact: 'Vijay Nair', mobile: '9878901234', email: 'vijay@fastplus.in' },
  { id: 'S-010', name: 'PipeLine Systems Co', segment: 'Piping', contact: 'Sunita Verma', mobile: '9889012345', email: 'sunita@pipeline.in' },
];
const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

export type MapProduct = { name: string; code?: string; segment?: string; price?: string; supplierCount: number };
const tInit = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

function Header({ p, step }: { p: MapProduct; step?: string }) {
  return (
    <div className="smp-header">
      <div className="smp-hrow">
        <div className="smp-title-wrap">
          <div className="smp-hicon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>
          <div className="smp-title-block">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h3 className="smp-title">Map Supplier Directory</h3>{step && <span className="smp-step-badge">{step}</span>}</div>
            <p className="smp-sub">Sourcing Supplier Mapping &nbsp;·&nbsp; Product Procurement</p>
          </div>
        </div>
      </div>
      <div className="smp-prod-strip">
        <div className="smp-ppill"><div className="smp-ppill-lbl">Product Name</div><div className="smp-ppill-val">{p.name}</div></div>
        <div className="smp-ppill-sep" />
        <div className="smp-ppill"><div className="smp-ppill-lbl">Product Code</div><div className="smp-ppill-val cyan">{p.code || '—'}</div></div>
        {p.segment && <><div className="smp-ppill-sep" /><div className="smp-ppill"><div className="smp-ppill-lbl">Segment</div><div className="smp-ppill-val">{p.segment}</div></div></>}
        {p.price && <><div className="smp-ppill-sep" /><div className="smp-ppill pill-price"><div className="smp-ppill-lbl">Target Price</div><div className="smp-ppill-val amber">{p.price}</div></div></>}
        <div className="smp-ppill-sep" />
        <div className="smp-ppill pill-sup"><div className="smp-ppill-lbl">Suppliers Mapped</div><div className="smp-ppill-val green">{p.supplierCount} Supplier{p.supplierCount !== 1 ? 's' : ''}</div></div>
      </div>
    </div>
  );
}

export default function MapSupplierModal({ product, onClose, onMapped }: { product: MapProduct; onClose: () => void; onMapped: (name: string) => void }) {
  const toast = useToast();
  const [step, setStep] = useState<'choose' | 'master' | 'new'>('choose');
  const [sel, setSel] = useState('');
  const [co, setCo] = useState(''); const [contact, setContact] = useState(''); const [mobile, setMobile] = useState('');
  const [seg, setSeg] = useState(''); const [email, setEmail] = useState(''); const [gmaps, setGmaps] = useState('');
  const [addr, setAddr] = useState(''); const [state, setState] = useState(''); const [stateCode, setStateCode] = useState(''); const [city, setCity] = useState('');
  const [card, setCard] = useState('');

  const supplier = SUPPLIER_MASTER.find(s => s.id === sel);
  const saveMaster = () => { if (!supplier) { toast.warning('Select a supplier', 'Please pick a supplier from the list.'); return; } onMapped(supplier.name); };
  const saveNew = () => { if (!co.trim()) { toast.warning('Company name', 'Please enter the supplier company name.'); return; } onMapped(co.trim()); };

  return createPortal(
    <div id="smp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="smp-box">
        <Header p={product} step={step === 'choose' ? undefined : 'Step 2 of 2'} />
        <button className="smp-close" style={{ position: 'absolute', top: 18, right: 22 }} onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>

        {step === 'choose' && (
          <div className="smp-choose-body">
            <div className="smp-opt-grid">
              <div className="smp-ocard" onClick={() => setStep('master')}>
                <div className="smp-oc-glow master-glow" />
                <div className="smp-oc-top"><div className="smp-oc-iconbox master-iconbox"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg></div></div>
                <div className="smp-oc-title">Supplier Master</div>
                <div className="smp-oc-desc">Select from your pre-verified supplier database</div>
                <div className="smp-oc-divider" />
                <div className="smp-oc-footer">
                  <div className="smp-oc-pills">{['Verified', 'Instant', 'Pre-filled'].map(t => <span key={t} className="smp-ocpill master-pill"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{t}</span>)}</div>
                  <div className="smp-oc-cta master-cta"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></div>
                </div>
              </div>
              <div className="smp-ocard new-ocard" onClick={() => setStep('new')}>
                <div className="smp-oc-glow new-glow" />
                <div className="smp-oc-top"><div className="smp-oc-iconbox new-iconbox"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg></div></div>
                <div className="smp-oc-title">New Supplier</div>
                <div className="smp-oc-desc">Register a new supplier with full details &amp; documents</div>
                <div className="smp-oc-divider" />
                <div className="smp-oc-footer">
                  <div className="smp-oc-pills">{['Register', 'Docs', 'Location'].map(t => <span key={t} className="smp-ocpill new-pill"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{t}</span>)}</div>
                  <div className="smp-oc-cta new-cta"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></div>
                </div>
              </div>
            </div>
            <div className="smp-cancel-row"><button className="smp-cancel-sm" onClick={onClose}>Cancel</button></div>
          </div>
        )}

        {step === 'master' && (
          <div className="smp-body" style={{ padding: '20px 22px 16px' }}>
            <div className="smp-field" style={{ marginBottom: 14 }}>
              <select className="smp-select smp-select-lg" value={sel} onChange={e => setSel(e.target.value)}>
                <option value="">Select supplier...</option>
                {SUPPLIER_MASTER.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name} ({s.segment})</option>)}
              </select>
            </div>
            {supplier && (
              <div className="smp-sc-wrap">
                <div className="smp-sc-left"><div className="smp-sc-av">{tInit(supplier.name)}</div></div>
                <div className="smp-sc-main">
                  <div className="smp-sc-top">
                    <div className="smp-sc-name">{supplier.name}</div>
                    <div className="smp-sc-tags"><span className="smp-sc-tag id-tag">{supplier.id}</span><span className="smp-sc-tag seg-tag">{supplier.segment}</span></div>
                  </div>
                  <div className="smp-sc-contacts">
                    {[['Contact', supplier.contact], ['Mobile', supplier.mobile], ['Email', supplier.email]].map(([l, v]) => (
                      <div className="smp-sc-contact" key={l}>
                        <div className="smp-sc-ci"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></div>
                        <div><div className="smp-sc-cl">{l}</div><div className="smp-sc-cv">{v}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="smp-form-foot">
              <button className="smp-btn-back" onClick={() => setStep('choose')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>Back</button>
              <button className="smp-btn-save smp-btn-map" onClick={saveMaster}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>Map Supplier</button>
            </div>
          </div>
        )}

        {step === 'new' && (
          <div className="smp-body snf-body">
            <div className="snf-section">
              <div className="snf-sec-hdr"><div className="snf-sec-icon teal-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div><span>Supplier Information</span></div>
              <div className="snf-row snf-row-1"><div className="snf-field"><label className="snf-lbl">Supplier Company Name <span className="snf-req">*</span></label><input className="snf-inp" value={co} onChange={e => setCo(e.target.value)} placeholder="e.g. TechParts India Pvt Ltd" /></div></div>
              <div className="snf-row snf-row-3">
                <div className="snf-field"><label className="snf-lbl">Contact Person <span className="snf-req">*</span></label><input className="snf-inp" value={contact} onChange={e => setContact(e.target.value)} placeholder="Full name" /></div>
                <div className="snf-field"><label className="snf-lbl">Mobile Number <span className="snf-req">*</span></label><input className="snf-inp" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="10-digit mobile" /></div>
                <div className="snf-field"><label className="snf-lbl">Segment <span className="snf-req">*</span></label><select className="snf-sel" value={seg} onChange={e => setSeg(e.target.value)}><option value="">Select segment...</option>{['Mechanical', 'Electrical', 'Instrumentation', 'Pneumatics', 'Hydraulics', 'Automation', 'Valves', 'Raw Material', 'Fasteners', 'Piping'].map(s => <option key={s}>{s}</option>)}</select></div>
              </div>
              <div className="snf-row snf-row-2">
                <div className="snf-field"><label className="snf-lbl">Email ID <span className="snf-req">*</span></label><input className="snf-inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="supplier@company.com" /></div>
                <div className="snf-field"><label className="snf-lbl">Google Location Link</label><input className="snf-inp" value={gmaps} onChange={e => setGmaps(e.target.value)} placeholder="https://maps.google.com/..." /></div>
              </div>
            </div>
            <div className="snf-section">
              <div className="snf-sec-hdr"><div className="snf-sec-icon blue-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div><span>Address</span></div>
              <div className="snf-row snf-row-1"><div className="snf-field"><label className="snf-lbl">Street Address <span className="snf-req">*</span></label><input className="snf-inp" value={addr} onChange={e => setAddr(e.target.value)} placeholder="e.g. 101, Business Park, MG Road" /></div></div>
              <div className="snf-row snf-row-4">
                <div className="snf-field"><label className="snf-lbl">Country <span className="snf-req">*</span></label><input className="snf-inp" defaultValue="India" /></div>
                <div className="snf-field"><label className="snf-lbl">State <span className="snf-req">*</span></label><select className="snf-sel" value={state} onChange={e => setState(e.target.value)}><option value="">Select state...</option>{STATES.map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="snf-field"><label className="snf-lbl">State Code</label><input className="snf-inp" value={stateCode} onChange={e => setStateCode(e.target.value)} placeholder="MH" style={{ textTransform: 'uppercase' }} /></div>
                <div className="snf-field"><label className="snf-lbl">City <span className="snf-req">*</span></label><input className="snf-inp" value={city} onChange={e => setCity(e.target.value)} placeholder="City name" /></div>
              </div>
            </div>
            <div className="snf-section snf-last">
              <div className="snf-sec-hdr"><div className="snf-sec-icon amber-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div><span>Documents</span></div>
              <label className="snf-upload">
                <input type="file" style={{ display: 'none' }} accept="image/*,.pdf" onChange={e => setCard(e.target.files?.[0]?.name ?? '')} />
                <div className="snf-upload-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg></div>
                <div className="snf-upload-text"><span className="snf-upload-main" style={card ? { color: '#0891b2' } : undefined}>{card ? `✓ ${card}` : 'Click to upload Business Card'}</span><span className="snf-upload-sub">PDF, JPG, PNG &nbsp;·&nbsp; Max 5 MB</span></div>
              </label>
            </div>
            <div className="snf-foot">
              <button className="smp-btn-back" onClick={() => setStep('choose')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>Back</button>
              <button className="smp-btn-save smp-btn-map" onClick={saveNew}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>Save Supplier</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const CSS = `
#smp-overlay{position:fixed;inset:0;z-index:10000000;display:flex;align-items:center;justify-content:center;background:rgba(4,14,32,.7);backdrop-filter:blur(12px);padding:20px;box-sizing:border-box;font-family:'DM Sans','Inter',system-ui,sans-serif;}
.smp-box{position:relative;background:#f8fafc;border-radius:24px;width:min(760px,calc(100vw - 28px));max-height:calc(100vh - 44px);display:flex;flex-direction:column;box-shadow:0 40px 100px -16px rgba(0,20,50,.5),0 0 0 1px rgba(34,211,238,.18);overflow:hidden;}
.smp-header{background:linear-gradient(135deg,#042838 0%,#083d56 40%,#0c6080 80%,#0e7490 100%);flex-shrink:0;position:relative;overflow:hidden;}
.smp-header::before{content:'';position:absolute;top:-60px;right:-60px;width:220px;height:220px;background:radial-gradient(circle,rgba(34,211,238,.12) 0%,transparent 70%);pointer-events:none;}
.smp-hrow{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 12px;position:relative;z-index:1;}
.smp-title-wrap{display:flex;align-items:center;gap:14px;}
.smp-hicon{width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 16px rgba(0,0,0,.2),0 1px 0 rgba(255,255,255,.18) inset;}
.smp-title-block{display:flex;flex-direction:column;gap:3px;}
.smp-title{font-size:16px;font-weight:600;color:#fff;margin:0;letter-spacing:-.3px;text-shadow:0 1px 6px rgba(0,0,0,.25);}
.smp-sub{font-size:10.5px;color:rgba(180,230,255,.7);margin:0;font-weight:500;}
.smp-close{width:34px;height:34px;border-radius:10px;border:1.5px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s;flex-shrink:0;z-index:2;}
.smp-close:hover{background:rgba(239,68,68,.65);}
.smp-step-badge{font-size:9.5px;font-weight:600;color:#67e8f9;background:rgba(103,232,249,.14);border:1px solid rgba(103,232,249,.3);border-radius:6px;padding:2px 8px;}
.smp-prod-strip{display:flex;align-items:center;padding:0 22px 14px;gap:0;position:relative;z-index:1;flex-wrap:wrap;}
.smp-ppill{display:flex;flex-direction:column;gap:2px;padding:0 16px;}
.smp-ppill:first-child{padding-left:0;}
.smp-ppill-sep{width:1px;height:32px;background:rgba(255,255,255,.1);flex-shrink:0;align-self:center;}
.smp-ppill-lbl{font-size:7.5px;font-weight:600;color:rgba(150,210,255,.55);text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}
.smp-ppill-val{font-size:12.5px;font-weight:600;color:#fff;white-space:nowrap;}
.smp-ppill-val.cyan{color:#67e8f9;font-family:ui-monospace,Menlo,monospace;font-size:12px;}
.smp-ppill-val.amber{color:#fcd34d;}
.smp-ppill-val.green{color:#6ee7b7;}
.smp-choose-body{padding:10px 12px 0;background:#f8fafc;}
.smp-opt-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.smp-ocard{border-radius:12px;padding:13px 14px;cursor:pointer;border:1.5px solid #e8edf2;background:#fff;transition:all .22s cubic-bezier(.34,1.4,.64,1);display:flex;flex-direction:column;gap:8px;position:relative;overflow:hidden;}
.smp-oc-glow{position:absolute;width:120px;height:120px;border-radius:50%;opacity:0;transition:opacity .3s;pointer-events:none;top:-30px;right:-30px;}
.master-glow{background:radial-gradient(circle,rgba(34,211,238,.18) 0%,transparent 70%);}
.new-glow{background:radial-gradient(circle,rgba(52,211,153,.18) 0%,transparent 70%);}
.smp-ocard:hover .smp-oc-glow{opacity:1;}
.smp-ocard:hover{border-color:#22d3ee;box-shadow:0 10px 28px rgba(8,145,178,.15),0 2px 6px rgba(8,145,178,.08);transform:translateY(-3px);}
.smp-ocard.new-ocard:hover{border-color:#34d399;box-shadow:0 10px 28px rgba(22,163,74,.13),0 2px 6px rgba(22,163,74,.07);}
.smp-oc-top{display:flex;align-items:center;justify-content:space-between;}
.smp-oc-iconbox{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .22s cubic-bezier(.34,1.56,.64,1);}
.smp-ocard:hover .smp-oc-iconbox{transform:scale(1.1) rotate(-4deg);}
.master-iconbox{background:linear-gradient(135deg,#cffafe,#7dd3fc);color:#0891b2;box-shadow:0 4px 14px rgba(8,145,178,.25);}
.new-iconbox{background:linear-gradient(135deg,#d1fae5,#6ee7b7);color:#16a34a;box-shadow:0 4px 14px rgba(22,163,74,.22);}
.smp-oc-title{font-size:13px;font-weight:600;color:#0f172a;letter-spacing:-.2px;line-height:1.2;}
.smp-oc-desc{font-size:10.5px;color:#64748b;font-weight:500;line-height:1.3;}
.smp-oc-divider{height:1px;background:linear-gradient(90deg,#f0f4f8,#e2e8f0,#f0f4f8);border-radius:1px;}
.smp-oc-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.smp-oc-pills{display:flex;gap:4px;flex-wrap:wrap;}
.smp-ocpill{display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:999px;}
.master-pill{background:#f0fdff;color:#0891b2;border:1px solid #b2ebf2;}
.new-pill{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
.smp-oc-cta{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;}
.master-cta{background:#e0f7fa;color:#0891b2;border:1.5px solid #b2ebf2;}
.new-cta{background:#d1fae5;color:#16a34a;border:1.5px solid #bbf7d0;}
.smp-ocard:hover .master-cta{background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;border-color:transparent;}
.smp-ocard.new-ocard:hover .new-cta{background:linear-gradient(135deg,#34d399,#16a34a);color:#fff;border-color:transparent;}
.smp-cancel-row{display:flex;justify-content:center;padding:8px 0 12px;background:#f8fafc;}
.smp-cancel-sm{font-size:11.5px;color:#94a3b8;background:transparent;border:none;cursor:pointer;font-weight:600;padding:5px 14px;border-radius:7px;transition:color .15s,background .15s;}
.smp-cancel-sm:hover{color:#64748b;background:#e2e8f0;}
.smp-body{flex:1;overflow-y:auto;background:#fff;scrollbar-width:thin;scrollbar-color:rgba(8,145,178,.25) transparent;}
.smp-field{display:flex;flex-direction:column;gap:4px;}
.smp-select{font-size:12px;color:#0f172a;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 11px;outline:none;cursor:pointer;width:100%;box-sizing:border-box;font-family:inherit;}
.smp-select-lg{font-size:12.5px;padding:10px 14px;border-radius:10px;border:2px solid #e2e8f0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.04);}
.smp-select-lg:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.1);}
.smp-form-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;}
.smp-btn-back{display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:12px;font-weight:600;color:#64748b;background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:9px;padding:9px 16px;cursor:pointer;transition:all .14s;}
.smp-btn-back:hover{background:#e2e8f0;color:#334155;}
.smp-btn-save{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:12px;font-weight:600;color:#fff;background:linear-gradient(135deg,#22d3ee,#0891b2);border:none;border-radius:9px;padding:9px 18px;cursor:pointer;box-shadow:0 4px 12px rgba(8,145,178,.4);transition:filter .14s;}
.smp-btn-save:hover{filter:brightness(1.08);}
.smp-btn-map{padding:10px 20px;font-size:12.5px;border-radius:10px;box-shadow:0 6px 18px rgba(8,145,178,.4);}
.smp-sc-wrap{display:flex;gap:14px;background:linear-gradient(135deg,#f0fdff 0%,#f8feff 100%);border:1.5px solid #b2ebf2;border-radius:14px;padding:16px;margin-bottom:4px;position:relative;overflow:hidden;}
.smp-sc-wrap::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#22d3ee,#0891b2);}
.smp-sc-left{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;}
.smp-sc-av{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(8,145,178,.4);letter-spacing:-.5px;}
.smp-sc-main{flex:1;min-width:0;}
.smp-sc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;}
.smp-sc-name{font-size:14px;font-weight:600;color:#0e7490;letter-spacing:-.2px;}
.smp-sc-tags{display:flex;gap:5px;flex-wrap:wrap;}
.smp-sc-tag{font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:6px;}
.smp-sc-tag.id-tag{background:#e0f7fa;color:#0891b2;border:1px solid #b2ebf2;font-family:ui-monospace,monospace;}
.smp-sc-tag.seg-tag{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
.smp-sc-contacts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.smp-sc-contact{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid #e0f7fa;border-radius:8px;padding:7px 10px;}
.smp-sc-ci{width:24px;height:24px;border-radius:7px;background:#e0f7fa;color:#0891b2;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.smp-sc-cl{font-size:8px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:1px;}
.smp-sc-cv{font-size:11px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.snf-body{padding:0 !important;overflow-y:auto;}
.snf-section{padding:16px 22px 12px;border-bottom:1px solid #f1f5f9;}
.snf-last{border-bottom:none;padding-bottom:4px;}
.snf-sec-hdr{display:flex;align-items:center;gap:8px;margin-bottom:12px;}
.snf-sec-hdr span{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#0891b2;}
.snf-sec-icon{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.teal-icon{background:linear-gradient(135deg,#cffafe,#a5f3fc);color:#0891b2;}
.blue-icon{background:linear-gradient(135deg,#dbeafe,#bfdbfe);color:#2563eb;}
.amber-icon{background:linear-gradient(135deg,#fef3c7,#fde68a);color:#d97706;}
.snf-row{display:grid;gap:10px;margin-bottom:10px;}
.snf-row:last-child{margin-bottom:0;}
.snf-row-1{grid-template-columns:1fr;}
.snf-row-2{grid-template-columns:1fr 1fr;}
.snf-row-3{grid-template-columns:1fr 1fr 1fr;}
.snf-row-4{grid-template-columns:1fr 1.6fr 0.6fr 1fr;}
.snf-field{display:flex;flex-direction:column;gap:4px;}
.snf-lbl{font-size:10.5px;font-weight:600;color:#475569;}
.snf-req{color:#ef4444;margin-left:1px;}
.snf-inp{font-size:12px;font-weight:500;color:#0f172a;background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;padding:0 11px;height:38px;outline:none;width:100%;box-sizing:border-box;transition:border-color .14s,box-shadow .14s;font-family:inherit;}
.snf-inp:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.1);}
.snf-inp::placeholder{color:#c0ccd8;font-weight:400;}
.snf-sel{font-size:12px;font-weight:500;color:#0f172a;background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;padding:0 11px;height:38px;outline:none;width:100%;box-sizing:border-box;cursor:pointer;font-family:inherit;}
.snf-sel:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.1);}
.snf-upload{display:flex;align-items:center;gap:14px;background:#fafffe;border:2px dashed #b2ebf2;border-radius:10px;padding:14px 18px;cursor:pointer;transition:border-color .15s,background .15s;}
.snf-upload:hover{border-color:#22d3ee;background:#f0fdff;}
.snf-upload-icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#e0f7fa,#b2ebf2);display:flex;align-items:center;justify-content:center;color:#0891b2;flex-shrink:0;}
.snf-upload-text{display:flex;flex-direction:column;gap:2px;}
.snf-upload-main{font-size:12px;font-weight:600;color:#0891b2;}
.snf-upload-sub{font-size:10.5px;color:#94a3b8;font-weight:500;}
.snf-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 22px 16px;border-top:1px solid #f1f5f9;}
@media(max-width:680px){.smp-opt-grid{grid-template-columns:1fr;}.snf-row-3,.snf-row-4,.snf-row-2{grid-template-columns:1fr;}.smp-sc-contacts{grid-template-columns:1fr;}}
`;
