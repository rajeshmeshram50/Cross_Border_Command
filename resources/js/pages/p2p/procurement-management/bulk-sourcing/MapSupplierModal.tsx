import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import api from '../../../../api';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterMultiSelect } from '../../../../components/ui/MasterMultiSelect';
import { SegmentTags } from './SegmentTags';
import { useModalGuard } from './useModalGuard';
import Tooltip from '../../../../components/ui/Tooltip';
import './bulk-sourcing.css';

/* Map Supplier Directory — 2-step.
 *  Step 1: choose Supplier Master vs New Supplier.
 *  Step 2 (master): pick from the verified supplier list (GET /p2p/suppliers).
 *  Step 2 (new):    register a supplier (info + address + docs).
 * On confirm → POST /p2p/sourcing-targets/{targetId}/products/{productId}/suppliers,
 * then onMapped(name). Static supplier data removed (see API.md). */

export type SupplierMaster = { id: string; code: string; name: string; segment: string; contact: string; mobile: string; email: string };
// Master-backed dropdowns for the New Supplier form, from GET /p2p/form-masters.
type FormMasters = {
  segments: { id: number; name: string }[];
  countries: { id: number; name: string }[];
  states: { id: number; country_id: number; name: string }[];
  stateCodes: { id: number; state_id: number; state_code: string }[];
};

export type MapProduct = { name: string; code?: string; segment?: string; price?: string; supplierCount: number };
const tInit = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
/* Show Target Price in INR — master rows already carry ₹; manual ones are plain. */
const fmtPrice = (p?: string) => {
  if (!p && p !== '0') return '—';
  if (String(p).trim().startsWith('₹')) return p;
  const n = Number(String(p).replace(/,/g, ''));
  return isNaN(n) ? p : `₹${n.toLocaleString('en-IN')}`;
};

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
        <div className="smp-ppill-sep" /><div className="smp-ppill"><div className="smp-ppill-lbl">Segment</div><div className="smp-ppill-val">{p.segment || '—'}</div></div>
        <div className="smp-ppill-sep" /><div className="smp-ppill pill-price"><div className="smp-ppill-lbl">Target Price</div><div className="smp-ppill-val amber">{fmtPrice(p.price)}</div></div>
        <div className="smp-ppill-sep" />
        <div className="smp-ppill pill-sup"><div className="smp-ppill-lbl">Suppliers Mapped</div><div className="smp-ppill-val green">{p.supplierCount} Supplier{p.supplierCount !== 1 ? 's' : ''}</div></div>
      </div>
    </div>
  );
}

/* Shimmer skeleton shaped like the New Supplier form — shown while the
 * /p2p/form-masters dropdowns are loading, so the user sees the form's shape
 * instead of empty inputs / "No options". */
function NewSupplierSkeleton() {
  const field = (w = '100%') => (
    <div className="nss-field"><span className="nss-lbl" /><span className="nss-input" style={{ width: w }} /></div>
  );
  return (
    <div className="smp-body snf-body">
      <style>{NSS_CSS}</style>
      <div className="snf-section">
        <div className="nss-hdr"><span className="nss-ico" /><span className="nss-title" /></div>
        <div className="nss-row nss-row-1">{field()}</div>
        <div className="nss-row nss-row-3">{field()}{field()}{field()}</div>
        <div className="nss-row nss-row-2">{field()}{field()}</div>
      </div>
      <div className="snf-section">
        <div className="nss-hdr"><span className="nss-ico" /><span className="nss-title" /></div>
        <div className="nss-row nss-row-1">{field()}</div>
        <div className="nss-row nss-row-4">{field()}{field()}{field()}{field()}</div>
      </div>
      <div className="snf-section snf-last">
        <div className="nss-hdr"><span className="nss-ico" /><span className="nss-title" /></div>
        <span className="nss-upload" />
      </div>
      <div className="snf-foot">
        <span className="nss-btn" style={{ width: 84 }} />
        <span className="nss-btn nss-btn-primary" style={{ width: 138 }} />
      </div>
    </div>
  );
}

const NSS_CSS = `
.nss-row { display: grid; gap: 14px; margin-bottom: 14px; }
.nss-row-1 { grid-template-columns: 1fr; }
.nss-row-2 { grid-template-columns: 1fr 1fr; }
.nss-row-3 { grid-template-columns: 1fr 1fr 1fr; }
.nss-row-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
.nss-field { display: flex; flex-direction: column; gap: 7px; }
.nss-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.nss-lbl { height: 9px; width: 90px; border-radius: 5px; }
.nss-input { height: 38px; border-radius: 10px; }
.nss-ico { width: 22px; height: 22px; border-radius: 6px; }
.nss-title { height: 12px; width: 150px; border-radius: 6px; }
.nss-upload { display: block; height: 74px; border-radius: 12px; }
.nss-btn { height: 38px; border-radius: 9px; }
.nss-lbl, .nss-input, .nss-ico, .nss-title, .nss-upload, .nss-btn {
  background: linear-gradient(90deg, #eef0f3 25%, #e2e6ea 37%, #eef0f3 63%);
  background-size: 400% 100%;
  animation: nss-shimmer 1.3s ease-in-out infinite;
}
.nss-btn-primary { background: linear-gradient(90deg, #dfe0fb 25%, #c9cbf7 37%, #dfe0fb 63%); background-size: 400% 100%; }
@keyframes nss-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
[data-bs-theme="dark"] .nss-lbl, [data-bs-theme="dark"] .nss-input, [data-bs-theme="dark"] .nss-ico,
[data-bs-theme="dark"] .nss-title, [data-bs-theme="dark"] .nss-upload, [data-bs-theme="dark"] .nss-btn {
  background: linear-gradient(90deg, #2a2f34 25%, #363b41 37%, #2a2f34 63%);
  background-size: 400% 100%;
}
`;

export default function MapSupplierModal({ product, targetId, productId, onClose, onMapped }: { product: MapProduct; targetId?: string; productId?: string | number; onClose: () => void; onMapped: (name: string) => void }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const { pulse, guardOverlay } = useModalGuard();
  const [step, setStep] = useState<'choose' | 'master' | 'new'>('choose');
  const [sel, setSel] = useState('');
  const [co, setCo] = useState(''); const [contact, setContact] = useState(''); const [mobile, setMobile] = useState('');
  const [seg, setSeg] = useState<string[]>([]); const [email, setEmail] = useState(''); const [gmaps, setGmaps] = useState('');
  const [addr, setAddr] = useState(''); const [stateCode, setStateCode] = useState(''); const [city, setCity] = useState('');
  const [card, setCard] = useState(''); const [cardName, setCardName] = useState(''); const [cardUploading, setCardUploading] = useState(false);
  // Master-backed dropdowns + the selected country/state ids (names go to the API).
  const [masters, setMasters] = useState<FormMasters>({ segments: [], countries: [], states: [], stateCodes: [] });
  // True while /p2p/form-masters is in flight — drives the New Supplier form
  // shimmer + the segment dropdown's loading rows (instead of "No options").
  const [mastersLoading, setMastersLoading] = useState(true);
  const [countryId, setCountryId] = useState<number | ''>(''); const [stateId, setStateId] = useState<number | ''>('');
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { api.get<{ data: SupplierMaster[] }>('/p2p/suppliers').then(r => setSuppliers(r.data?.data ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    setMastersLoading(true);
    api.get<{ data: FormMasters }>('/p2p/form-masters').then(r => {
      const d = r.data?.data; if (!d) return;
      setMasters(d);
      // No default country — the user must pick one (which then enables the
      // State dropdown and drives the auto State Code). Avoids a misleading
      // pre-selected India with an empty/irrelevant state code.
    }).catch(() => {}).finally(() => setMastersLoading(false));
  }, []);

  // country_id / state_id come back from the API as strings (FK columns aren't
  // auto-cast like the primary `id`), so coerce before comparing to the numeric
  // selected id — otherwise "104" === 104 is false and the list looks empty.
  const statesForCountry = masters.states.filter(s => Number(s.country_id) === countryId);
  // Selecting a state auto-fills its GST state code from the state-codes master.
  const pickState = (id: number | '') => {
    setStateId(id);
    setStateCode(id === '' ? '' : (masters.stateCodes.find(c => Number(c.state_id) === id)?.state_code ?? ''));
  };
  const uploadCard = (f: File) => {
    const fd = new FormData(); fd.append('file', f); fd.append('kind', 'card');
    setCardUploading(true);
    // Don't set a bare 'multipart/form-data' — it strips the boundary and PHP
    // can't parse the body (file never arrives → "file is required"). Override
    // the api default of application/json with undefined so axios emits the
    // proper `multipart/form-data; boundary=...`. (Same fix as onboarding.)
    api.post<{ data: { path: string; name: string } }>('/p2p/upload', fd, { headers: { 'Content-Type': undefined as unknown as string } })
      .then(r => { setCard(r.data?.data?.path ?? ''); setCardName(r.data?.data?.name ?? f.name); })
      .catch((err) => toast.error('Upload failed', err?.response?.data?.message || 'Could not upload the file.'))
      .finally(() => setCardUploading(false));
  };

  const supplier = suppliers.find(s => s.id === sel);
  const mapUrl = `/p2p/sourcing-targets/${targetId}/products/${productId}/suppliers`;
  const doMap = (payload: object, name: string) => {
    if (!targetId || productId == null) { onMapped(name); return; }   // graceful until backend
    setSaving(true);
    api.post(mapUrl, payload)
      .then(() => onMapped(name))
      .catch((err) => {
        const errors = err?.response?.data?.errors as Record<string, string[]> | undefined;
        const msg = err?.response?.data?.message || (errors && Object.values(errors)[0]?.[0]);
        toast.error('Map failed', msg || 'Please try again.');
      })
      .finally(() => setSaving(false));
  };
  const saveMaster = () => { if (!supplier) { toast.warning('Select a supplier', 'Please pick a supplier from the list.'); return; } doMap({ supplier_id: supplier.id }, supplier.name); };
  // Inline required-field validation. Errors appear after the first save
  // attempt (`submitted`) and clear live as the user fills each field.
  const newSupplierErrors = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!co.trim()) e.co = 'Supplier company name is required.';
    if (!contact.trim()) e.contact = 'Contact person is required.';
    if (!mobile.trim()) e.mobile = 'Mobile number is required.';
    else if (!/^[0-9+\-\s()]{7,15}$/.test(mobile.trim())) e.mobile = 'Enter a valid mobile number.';
    if (!seg.length) e.seg = 'Segment is required.';
    if (!email.trim()) e.email = 'Email ID is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!addr.trim()) e.addr = 'Street address is required.';
    if (countryId === '') e.country = 'Country is required.';
    if (stateId === '') e.state = 'State is required.';
    if (!city.trim()) e.city = 'City is required.';
    return e;
  };
  const errs: Record<string, string> = submitted ? newSupplierErrors() : {};
  const invStyle = (m?: string) => m ? { borderColor: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,.12)' } : undefined;
  const errMsg = (m?: string) => m ? <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 600, marginTop: 4 }}>{m}</div> : null;

  const saveNew = () => {
    setSubmitted(true);
    const e = newSupplierErrors();
    if (Object.keys(e).length) { toast.warning('Missing details', 'Please fill all the required fields highlighted in red.'); return; }
    const countryName = masters.countries.find(c => c.id === countryId)?.name ?? '';
    const stateName = masters.states.find(s => s.id === stateId)?.name ?? '';
    doMap({ new_supplier: { name: co.trim(), contact, mobile, segment: seg.join(', '), email, gmaps, address: addr, country: countryName, state: stateName, state_code: stateCode, city, card } }, co.trim());
  };

  return createPortal(
    <div id="smp-overlay" onMouseDown={guardOverlay}>
      <div className={`smp-box${pulse ? ' bsm-pulse' : ''}`}>
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
              <MasterSelect
                value={sel}
                placeholder="Select supplier..."
                options={suppliers.map(s => ({ value: s.id, label: `${s.code || s.id} — ${s.name}` }))}
                onChange={setSel}
              />
            </div>
            {supplier && (
              <div className="smp-sc-wrap">
                <div className="smp-sc-left"><div className="smp-sc-av">{tInit(supplier.name)}</div></div>
                <div className="smp-sc-main">
                  <div className="smp-sc-top">
                    <div className="smp-sc-name">{supplier.name}</div>
                    <div className="smp-sc-tags"><span className="smp-sc-tag id-tag">{supplier.code || supplier.id}</span><SegmentTags segment={supplier.segment} tagClassName="smp-sc-tag seg-tag" /></div>
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

        {step === 'new' && mastersLoading && <NewSupplierSkeleton />}
        {step === 'new' && !mastersLoading && (
          <div className="smp-body snf-body">
            <div className="snf-section">
              <div className="snf-sec-hdr"><div className="snf-sec-icon teal-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div><span>Supplier Information</span></div>
              <div className="snf-row snf-row-1"><div className="snf-field"><label className="snf-lbl">Supplier Company Name <span className="snf-req">*</span></label><input className="snf-inp" style={invStyle(errs.co)} value={co} onChange={e => setCo(e.target.value)} placeholder="e.g. TechParts India Pvt Ltd" />{errMsg(errs.co)}</div></div>
              <div className="snf-row snf-row-3">
                <div className="snf-field"><label className="snf-lbl">Contact Person <span className="snf-req">*</span></label><input className="snf-inp" style={invStyle(errs.contact)} value={contact} onChange={e => setContact(e.target.value)} placeholder="Full name" />{errMsg(errs.contact)}</div>
                <div className="snf-field"><label className="snf-lbl">Mobile Number <span className="snf-req">*</span></label><input className="snf-inp" style={invStyle(errs.mobile)} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="10-digit mobile" />{errMsg(errs.mobile)}</div>
                <div className="snf-field"><label className="snf-lbl">Segment <span className="snf-req">*</span></label><MasterMultiSelect values={seg} invalid={!!errs.seg} collapse collapseNoun="segments" loading={mastersLoading} showDone placeholder="Select segment(s)..." options={masters.segments.map(s => ({ value: s.name, label: s.name }))} onChange={setSeg} />{errMsg(errs.seg)}</div>
              </div>
              <div className="snf-row snf-row-2">
                <div className="snf-field"><label className="snf-lbl">Email ID <span className="snf-req">*</span></label><input className="snf-inp" type="email" style={invStyle(errs.email)} value={email} onChange={e => setEmail(e.target.value)} placeholder="supplier@company.com" />{errMsg(errs.email)}</div>
                <div className="snf-field"><label className="snf-lbl">Google Location Link</label><input className="snf-inp" value={gmaps} onChange={e => setGmaps(e.target.value)} placeholder="https://maps.google.com/..." /></div>
              </div>
            </div>
            <div className="snf-section">
              <div className="snf-sec-hdr"><div className="snf-sec-icon blue-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div><span>Address</span></div>
              <div className="snf-row snf-row-1"><div className="snf-field"><label className="snf-lbl">Street Address <span className="snf-req">*</span></label><input className="snf-inp" style={invStyle(errs.addr)} value={addr} onChange={e => setAddr(e.target.value)} placeholder="e.g. 101, Business Park, MG Road" />{errMsg(errs.addr)}</div></div>
              <div className="snf-row snf-row-4">
                <div className="snf-field"><label className="snf-lbl">Country <span className="snf-req">*</span></label><MasterSelect value={countryId === '' ? '' : String(countryId)} invalid={!!errs.country} placeholder="Select country..." options={masters.countries.map(c => ({ value: String(c.id), label: c.name }))} onChange={v => { setCountryId(v ? Number(v) : ''); pickState(''); }} />{errMsg(errs.country)}</div>
                <div className="snf-field"><label className="snf-lbl">State <span className="snf-req">*</span></label><MasterSelect value={stateId === '' ? '' : String(stateId)} invalid={!!errs.state} placeholder={countryId === '' ? 'Select country first' : 'Select state...'} disabled={countryId === ''} options={statesForCountry.map(s => ({ value: String(s.id), label: s.name }))} onChange={v => pickState(v ? Number(v) : '')} />{errMsg(errs.state)}</div>
                <div className="snf-field"><label className="snf-lbl">State Code <span style={{ fontSize: 10, color: '#94a3b8' }}>(auto)</span></label><input className="snf-inp snf-inp-ro" value={stateCode} readOnly placeholder="—" style={{ textTransform: 'uppercase' }} /></div>
                <div className="snf-field"><label className="snf-lbl">City <span className="snf-req">*</span></label><input className="snf-inp" style={invStyle(errs.city)} value={city} onChange={e => setCity(e.target.value)} placeholder="City name" />{errMsg(errs.city)}</div>
              </div>
            </div>
            <div className="snf-section snf-last">
              <div className="snf-sec-hdr"><div className="snf-sec-icon amber-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div><span>Documents</span></div>
              {card ? (
                <div className="ast-pdf-file">
                  <div className="ast-pdf-file-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
                  <span className="ast-pdf-file-name">{cardName || 'Business Card'}</span>
                  <Tooltip label="Remove document"><button type="button" className="ast-pdf-del" onClick={async () => {
                    const ok = await confirmDialog({ title: 'Remove document?', message: <>Remove <strong>{cardName || 'this document'}</strong> from the supplier? You can upload a new one after.</>, tone: 'danger', confirmLabel: 'Remove', cancelLabel: 'Keep' });
                    if (!ok) return;
                    const removed = cardName || 'Business Card';
                    setCard(''); setCardName('');
                    toast.success('Document removed', `${removed} removed.`);
                  }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></Tooltip>
                </div>
              ) : (
                <label className="snf-upload">
                  <input type="file" style={{ display: 'none' }} accept="image/*,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCard(f); }} />
                  <div className="snf-upload-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg></div>
                  <div className="snf-upload-text"><span className="snf-upload-main">{cardUploading ? 'Uploading…' : 'Click to upload Business Card'}</span><span className="snf-upload-sub">PDF, JPG, PNG &nbsp;·&nbsp; Max 5 MB</span></div>
                </label>
              )}
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
