import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import './bulk-sourcing.css';

/* Map Supplier Directory — 2-step.
 *  Step 1: choose Supplier Master vs New Supplier.
 *  Step 2 (master): pick from the verified supplier list (GET /p2p/suppliers).
 *  Step 2 (new):    register a supplier (info + address + docs).
 * On confirm → POST /p2p/sourcing-targets/{targetId}/products/{productId}/suppliers,
 * then onMapped(name). Static supplier data removed (see API.md). */

export type SupplierMaster = { id: string; name: string; segment: string; contact: string; mobile: string; email: string };
// Indian states — reference data for the New Supplier address dropdown.
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

export default function MapSupplierModal({ product, targetId, productId, onClose, onMapped }: { product: MapProduct; targetId?: string; productId?: string | number; onClose: () => void; onMapped: (name: string) => void }) {
  const toast = useToast();
  const [step, setStep] = useState<'choose' | 'master' | 'new'>('choose');
  const [sel, setSel] = useState('');
  const [co, setCo] = useState(''); const [contact, setContact] = useState(''); const [mobile, setMobile] = useState('');
  const [seg, setSeg] = useState(''); const [email, setEmail] = useState(''); const [gmaps, setGmaps] = useState('');
  const [addr, setAddr] = useState(''); const [state, setState] = useState(''); const [stateCode, setStateCode] = useState(''); const [city, setCity] = useState('');
  const [card, setCard] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get<{ data: SupplierMaster[] }>('/p2p/suppliers').then(r => setSuppliers(r.data?.data ?? [])).catch(() => {}); }, []);

  const supplier = suppliers.find(s => s.id === sel);
  const mapUrl = `/p2p/sourcing-targets/${targetId}/products/${productId}/suppliers`;
  const doMap = (payload: object, name: string) => {
    if (!targetId || productId == null) { onMapped(name); return; }   // graceful until backend
    setSaving(true);
    api.post(mapUrl, payload)
      .then(() => onMapped(name))
      .catch(() => toast.error('Map failed', 'Please try again.'))
      .finally(() => setSaving(false));
  };
  const saveMaster = () => { if (!supplier) { toast.warning('Select a supplier', 'Please pick a supplier from the list.'); return; } doMap({ supplier_id: supplier.id }, supplier.name); };
  const saveNew = () => {
    if (!co.trim()) { toast.warning('Company name', 'Please enter the supplier company name.'); return; }
    doMap({ new_supplier: { name: co.trim(), contact, mobile, segment: seg, email, gmaps, address: addr, country: 'India', state, state_code: stateCode, city, card } }, co.trim());
  };

  return createPortal(
    <div id="smp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
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
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name} ({s.segment})</option>)}
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
              <button className="smp-btn-save smp-btn-map" onClick={saveMaster} disabled={saving}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>{saving ? 'Mapping…' : 'Map Supplier'}</button>
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
              <button className="smp-btn-save smp-btn-map" onClick={saveNew} disabled={saving}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>{saving ? 'Saving…' : 'Save Supplier'}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
