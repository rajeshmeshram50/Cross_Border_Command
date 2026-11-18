import { Suspense, useEffect, useMemo, useState, type ReactNode, type Ref } from 'react';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { useToast } from '../../../../contexts/ToastContext';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import { CURRENCY_OPTIONS, COUNTRY_CURRENCY, FX, money } from './currency';
import { IcoBack, IcoCheck, IcoFlag, IcoGlobe, IcoPlus, IcoUserPlus, IcoX } from './icons';
import './supplier-master-form.css';

/* Map Supplier → Supplier Master → Domestic / International form. Opens after the app's
   Domestic / International gate. Domestic: price in ₹ with GST %; International: price in the
   supplier's currency at an exchange rate, no GST. Suppliers are dummy data until the API lands. */

type Supplier = {
  code: string; name: string; type: string; contact: string;
  state: string;        // Domestic: state · International: city / region
  gstCode?: string;     // Domestic only
  country?: string;     // International only
};

const DOMESTIC: Supplier[] = [
  { code: 'S-001', name: 'Shree Metals Pvt Ltd', type: 'Manufacturer', state: 'Maharashtra', gstCode: '27', contact: 'Rajesh Kulkarni' },
  { code: 'S-002', name: 'Bharat Alloys & Steel', type: 'Trader', state: 'Gujarat', gstCode: '24', contact: 'Amit Shah' },
  { code: 'S-003', name: 'Kalyani Forge Components', type: 'Manufacturer', state: 'Karnataka', gstCode: '29', contact: 'Suresh Rao' },
  { code: 'S-004', name: 'Precision Cast Industries', type: 'Manufacturer', state: 'Tamil Nadu', gstCode: '33', contact: 'Priya Natarajan' },
  { code: 'S-005', name: 'Deccan Engineering Works', type: 'Service Provider', state: 'Telangana', gstCode: '36', contact: 'Kiran Reddy' },
];
const INTERNATIONAL: Supplier[] = [
  { code: 'S-101', name: 'Gulf Valve Trading LLC', type: 'Trader', country: 'UAE', state: 'Dubai', contact: 'Omar Haddad' },
  { code: 'S-102', name: 'Meridian Instruments Inc', type: 'Manufacturer', country: 'USA', state: 'Texas', contact: 'Laura Bennett' },
  { code: 'S-103', name: 'Rhein Flow Technik GmbH', type: 'Manufacturer', country: 'Germany', state: 'Bavaria', contact: 'Jonas Weber' },
  { code: 'S-104', name: 'Lion City Automation Pte', type: 'Distributor', country: 'Singapore', state: 'Singapore', contact: 'Wei Ming Tan' },
];

// The app's Add Supplier wizard (Supplier Master), opened by "+" beside Supplier Name. Large: loaded on demand.
const AddVendorModal = lazyPage(() => import('../../p2p-master-management/supplier-management/AddVendorModal'));
/** The fields this form needs from the wizard's saved supplier. */
type AddedSupplier = { companyName: string; vendorType: string; contactName: string; state: string; stateCode: string; country: string; city: string };

const GST_RATES = ['0', '5', '12', '18', '28'];
const toNum = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const numeric = (v: string) => v.replace(/[^\d.]/g, '');

const Auto = () => <span className="stsm-auto">Auto</span>;
const Req = () => <span className="stsm-req" aria-hidden>*</span>;

/** A locked field filled from the picked supplier (or computed). */
function ReadOnly({ id, label, value, placeholder, calc }: { id: string; label: ReactNode; value: string; placeholder: string; calc?: boolean }) {
  return (
    <div className="stsm-f">
      <label className="stsm-l" htmlFor={id}>{label}<Auto /></label>
      <input id={id} className={`stsm-i ${calc ? 'is-calc' : 'is-ro'}`} value={value} placeholder={placeholder} readOnly tabIndex={-1} />
    </div>
  );
}

type Props = {
  scope: SupplierScope;
  productName: string;
  saving: boolean;
  dialogRef: Ref<HTMLDivElement>;
  /** Tells the parent whether anything was picked or typed (Esc must not lose it). */
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
  onCancel: () => void;
  onSave: (supplierName: string) => void;
};

export default function SupplierMasterForm({ scope, productName, saving, dialogRef, onDirty, onBack, onCancel, onSave }: Props) {
  const intl = scope === 'international';
  const toast = useToast();
  // Suppliers added with "+" in this session (the wizard saves them to Supplier Master).
  const [added, setAdded] = useState<Supplier[]>([]);
  const pool = useMemo(() => [...(intl ? INTERNATIONAL : DOMESTIC), ...added], [intl, added]);
  const [adding, setAdding] = useState(false);
  const options = useMemo(() => pool.map(s => ({
    value: s.code, code: s.code, label: intl ? `${s.name} · ${s.country}` : s.name, selectedLabel: `${s.code} · ${s.name}`,
  })), [pool, intl]);

  const [code, setCode] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState('18');
  const [cur, setCur] = useState('USD');
  const [fx, setFx] = useState(String(FX.USD));
  const [tried, setTried] = useState(false);

  const sup = pool.find(s => s.code === code);
  const dirty = !!code || !!price;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const pickSupplier = (c: string, picked?: Supplier) => {
    setCode(c);
    const country = (picked ?? pool.find(s => s.code === c))?.country;
    const auto = country ? COUNTRY_CURRENCY[country] : undefined;
    if (intl && auto) { setCur(auto); setFx(String(FX[auto])); }
  };
  const supplierAdded = (p: AddedSupplier) => {
    const s: Supplier = {
      code: `NEW-${added.length + 1}`, name: p.companyName, type: p.vendorType || '—', contact: p.contactName,
      ...(intl ? { country: p.country, state: p.city } : { state: p.state, gstCode: p.stateCode }),
    };
    setAdded(a => [...a, s]);
    setAdding(false);
    pickSupplier(s.code, s);
    toast.success(`${p.companyName} added to Supplier Master`, 'It is now selected in this form.');
  };
  const pickCurrency = (c: string) => { setCur(c); setFx(String(FX[c] ?? '')); };

  const p = toNum(price);
  const gstAmt = p * (Number(gst) / 100);
  const errs = { sup: !code, price: !p, fx: intl && !toNum(fx) };
  const bad = (k: keyof typeof errs) => tried && errs[k];
  const err = (k: keyof typeof errs, id: string) => (bad(k) ? <div className="stsm-err" id={id}>This field is required</div> : null);

  const save = () => {
    setTried(true);
    if (errs.sup || errs.price || errs.fx || !sup) return;
    onSave(sup.name);
  };

  return (
    <div ref={dialogRef} className={`stsm-box${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="stsm-title" aria-busy={saving || undefined}>
      <div className="stsm-hd">
        <div className="stsm-hd__ico"><IcoUserPlus size={18} sw={2.2} /></div>
        <div className="stsm-hd__txt">
          <div className="stsm-hd__t" id="stsm-title">
            Supplier Master
            <span className="stsm-hd__tag">{intl ? <><IcoGlobe size={11} sw={2.4} />International</> : <><IcoFlag size={11} sw={2.4} />Domestic</>}</span>
          </div>
          <div className="stsm-hd__s">
            {intl ? 'Link an overseas supplier with its price in foreign currency for ' : 'Link an Indian supplier with price & GST for '}
            <b>{productName}</b>
          </div>
        </div>
        <button type="button" className="stsm-x" aria-label="Close" onClick={onCancel} disabled={saving}><IcoX size={13} sw={2.8} /></button>
      </div>

      <div className="stsm-bd sct-scroller" inert={saving}>
        <div className="stsm-subhd">{intl ? <IcoGlobe size={11} sw={2.4} /> : <IcoFlag size={11} sw={2.4} />}Supplier Details</div>
        <div className="stsm-grid">
          <div className="stsm-f stsm-f--sup">
            <span className="stsm-l" id="stsm-sup-l">
              Supplier Name <Req />
              <button type="button" className="stsm-mini" aria-label="Add new supplier" title="Add new supplier" onClick={() => setAdding(true)}>
                <IcoPlus size={11} sw={3} />
              </button>
            </span>
            <div className={`stsm-ms${bad('sup') ? ' is-err' : ''}`} aria-labelledby="stsm-sup-l">
              <MasterSelect value={code} options={options} placeholder="Select Supplier Name" invalid={bad('sup')}
                searchable searchPlaceholder={intl ? 'Search supplier code, name or country' : 'Search supplier code, name'}
                onChange={c => pickSupplier(c)} />
            </div>
            {err('sup', 'stsm-sup-err')}
          </div>
          <ReadOnly id="stsm-code" label="Supplier Code" value={sup && !sup.code.startsWith('NEW-') ? sup.code : ''} placeholder="Auto-fills from supplier" />
          <ReadOnly id="stsm-type" label="Supplier Type" value={sup?.type ?? ''} placeholder="—" />
          {intl ? <>
            <ReadOnly id="stsm-country" label="Country" value={sup?.country ?? ''} placeholder="—" />
            <ReadOnly id="stsm-region" label="City / Region" value={sup?.state ?? ''} placeholder="—" />
          </> : <>
            <ReadOnly id="stsm-state" label="State" value={sup?.state ?? ''} placeholder="—" />
            <ReadOnly id="stsm-gstcode" label="GST State Code" value={sup?.gstCode ?? ''} placeholder="—" />
          </>}
          <ReadOnly id="stsm-contact" label="Contact Person" value={sup?.contact ?? ''} placeholder="—" />
        </div>

        {intl ? (
          <>
            <div className="stsm-subhd"><IcoGlobe size={11} sw={2.4} />Price &amp; Currency <span className="stsm-nogst">No GST — overseas supplier</span></div>
            <div className="stsm-grid stsm-grid--4">
              <div className="stsm-f">
                <span className="stsm-l" id="stsm-cur-l">Currency <Req /></span>
                <div className="stsm-ms" aria-labelledby="stsm-cur-l">
                  <MasterSelect value={cur} options={CURRENCY_OPTIONS} onChange={pickCurrency} />
                </div>
              </div>
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-price">Price ({cur}) <Req /></label>
                <input id="stsm-price" className={`stsm-i stsm-i--key${bad('price') ? ' is-err' : ''}`} inputMode="decimal" placeholder="Price in supplier currency"
                  value={price} onChange={e => setPrice(numeric(e.target.value))}
                  aria-invalid={bad('price')} aria-describedby={bad('price') ? 'stsm-price-err' : undefined} />
                {err('price', 'stsm-price-err')}
              </div>
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-fx">Exchange Rate (₹ per {cur}) <Req /></label>
                <input id="stsm-fx" className={`stsm-i${bad('fx') ? ' is-err' : ''}`} inputMode="decimal"
                  value={fx} onChange={e => setFx(numeric(e.target.value))}
                  aria-invalid={bad('fx')} aria-describedby={bad('fx') ? 'stsm-fx-err' : undefined} />
                {err('fx', 'stsm-fx-err')}
              </div>
              <ReadOnly id="stsm-total" label={`Total Amount (${cur})`} value={p ? money(cur, p) : ''} placeholder="Auto-computed" calc />
            </div>
          </>
        ) : (
          <>
            <div className="stsm-subhd">₹ Price &amp; GST</div>
            <div className="stsm-grid stsm-grid--4">
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-price">Price (₹) <Req /></label>
                <input id="stsm-price" className={`stsm-i stsm-i--key${bad('price') ? ' is-err' : ''}`} inputMode="decimal" placeholder="Enter unit price"
                  value={price} onChange={e => setPrice(numeric(e.target.value))}
                  aria-invalid={bad('price')} aria-describedby={bad('price') ? 'stsm-price-err' : undefined} />
                {err('price', 'stsm-price-err')}
              </div>
              <div className="stsm-f">
                <span className="stsm-l" id="stsm-gst-l">GST % <Req /></span>
                <div className="stsm-ms" aria-labelledby="stsm-gst-l">
                  <MasterSelect value={gst} options={GST_RATES.map(r => ({ value: r, label: r }))} onChange={setGst} />
                </div>
              </div>
              <ReadOnly id="stsm-gstamt" label="GST Amount (₹)" value={p ? money('INR', gstAmt) : ''} placeholder="Auto-computed" calc />
              <ReadOnly id="stsm-total" label="Total Amount (₹)" value={p ? money('INR', p + gstAmt) : ''} placeholder="Auto-computed" calc />
            </div>
          </>
        )}
      </div>

      <div className="stsm-ft">
        <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onBack} disabled={saving}><IcoBack size={12} sw={2.6} />Back</button>
        <span className="stsm-ft__sp" />
        <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="stsm-btn stsm-btn--primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>
          {saving ? <><span className="sct-spin" aria-hidden />Saving…</> : <><IcoCheck size={13} sw={2.6} />Save</>}
        </button>
      </div>

      {adding && (
        <Suspense fallback={null}>
          {/* Opened for the scope already chosen, so the type is not asked again. Mapping products
              from inside the wizard is off: the mapping is being made here. */}
          <AddVendorModal scope={scope} canMapProducts={false} onClose={() => setAdding(false)} onSubmit={supplierAdded} />
        </Suspense>
      )}
    </div>
  );
}
