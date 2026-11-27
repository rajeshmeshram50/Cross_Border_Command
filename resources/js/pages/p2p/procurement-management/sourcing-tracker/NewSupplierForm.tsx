import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import type { ReportProduct } from './targetProducts';
import { todayIso } from './data';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import { COUNTRY_CURRENCY, money } from './currency';
import { limitNum, PRICE_DEC, PRICE_INT, RATE_DEC, RATE_INT } from './format';
import { gstTypeFor, indianStates, overseasCountries, rateOf, stateCodeOf, useFormMasters } from './formMasters';
import type { MapRequest } from './MapSupplierModal';
import AttachPicker from './AttachPicker';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { viewDocument } from './targetProducts';
import './attached-files.css';
import { IcoBack, IcoPin, IcoUpload, Svg } from './icons';

/* Map Supplier → New Supplier: register a supplier with its price for this product.
   Domestic: Indian address, price in ₹ with GST. International: overseas address, price in the
   supplier's currency at an exchange rate, no GST (₹ equivalent shown).
   Renders the body of the Map Supplier popup (its header and product strip stay above). Section
   cards, field icons and the price summary follow the design. Segments, countries, states, GST
   state codes, GST rates, currencies (+ default rates) and our own state come from
   GET /p2p/form-masters. Save hands { new_supplier, price … } and the business card to the Map
   Supplier popup, which uploads the card and POSTs the mapping. */

/** Business card: PDF, JPG or PNG, at most 5 MB (CS-2221 V-T21). */
const CARD_MAX_BYTES = 5 * 1024 * 1024;
const CARD_ACCEPT = '.pdf,.jpg,.jpeg,.png';
const CARD_EXT = /\.(pdf|jpe?g|png)$/i;
const CARD_ERR = 'PDF, JPG or PNG up to 5 MB.';

/** 18% is the default GST rate when the GST master has it. */
const DEFAULT_GST = 18;
type GstType = 'intra' | 'inter';

type NewForm = {
  coName: string; contact: string; mobile: string; segment: string; email: string; gmaps: string;
  addr: string; country: string; state: string; stateCode: string; city: string;
  price: string; gst: string; gstType: GstType; validTill: string;
  cur: string; fx: string;   // International only
};
/** A mapped New Supplier's saved values, to open the form for Edit. */
export type NewSupplierValues = Partial<NewForm>;
const emptyForm = (intl: boolean): NewForm => ({
  coName: '', contact: '', mobile: '', segment: '', email: '', gmaps: '', addr: '', country: intl ? '' : 'India', state: '', stateCode: '', city: '',
  price: '', gst: String(DEFAULT_GST), gstType: 'inter', validTill: '', cur: 'USD', fx: '',
});
const GST_TYPE_OPTIONS = [
  { value: 'intra', label: 'CGST + SGST (Intra-state)' },
  { value: 'inter', label: 'IGST (Inter-state)' },
];

/** Field → message for every invalid field (shown under the field after the first Save). */
const errors = (f: NewForm, intl: boolean) => {
  const e: Partial<Record<keyof NewForm, string>> = {};
  if (!f.coName.trim()) e.coName = 'Enter the supplier company name';
  if (!f.contact.trim()) e.contact = 'Enter the contact person';
  if (intl ? !/^\+?\d[\d\s-]{6,17}$/.test(f.mobile.trim()) : !/^\d{10}$/.test(f.mobile.trim())) {
    e.mobile = intl ? 'Enter the mobile number with its country code' : 'Enter a 10-digit mobile number';
  }
  if (!f.segment) e.segment = 'Select a segment';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email ID';
  if (!f.addr.trim()) e.addr = 'Enter the street address';
  if (!f.country.trim()) e.country = intl ? 'Select a country' : 'Enter the country';
  if (!intl && !f.state) e.state = 'Select a state';
  if (!f.city.trim()) e.city = 'Enter the city';
  if (!(parseFloat(f.price) > 0)) e.price = intl ? 'Enter the unit price' : 'Enter the unit price (excl. GST)';
  if (intl && !(parseFloat(f.fx) > 0)) e.fx = 'Enter the exchange rate';
  return e;
};

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The "vs Target Price" tile: how a ₹ unit price compares with the product's target price. */
function VsTarget({ value, target, empty }: { value: number; target: number; empty: string }) {
  const diff = value && target ? (value - target) / target * 100 : null;
  return (
    <div className="stnf-k">
      <span>vs Target Price</span>
      {diff === null ? <><b className="is-na">—</b><small>{empty}</small></>
        : Math.abs(diff) < 0.005 ? <><b className="is-eq">At target</b><small>Same as {rupees(target)}</small></>
        : diff < 0 ? <><b className="is-ok">{Math.abs(diff).toFixed(2)}% below</b><small>Saves {rupees(target - value)} / unit</small></>
        : <><b className="is-hi">{diff.toFixed(2)}% above</b><small>{rupees(value - target)} / unit over target</small></>}
    </div>
  );
}

/* Icons: section headers (15px) and field icons (14px), drawn as in the design. */
const sec = (d: ReactNode) => <Svg size={15} sw={2.3}>{d}</Svg>;
const fld = (d: ReactNode) => <Svg size={14} sw={2}>{d}</Svg>;
const SEC_ICONS = {
  info: sec(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>),
  globe: sec(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
  price: sec(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  docs: sec(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>),
};
const FIELD_ICONS = {
  company: fld(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  user: fld(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  phone: fld(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />),
  mail: fld(<><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" /></>),
  map: fld(<><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>),
  home: fld(<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  globe: fld(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
  flag: fld(<><path d="M3 21V4" /><path d="M3 4h13l-2 4 2 4H3" /></>),
  fx: fld(<><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>),
  hash: fld(<><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></>),
  city: fld(<><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>),
};
const IcoSave = () => <Svg size={13} sw={2.3}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></Svg>;

/** Section card header: icon, title + subtitle, a fading rule, then optional extras on the right. */
function SecHead({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="stnf-sec-hdr">
      <div className="stnf-sec-icon">{icon}</div>
      <div className="stnf-sh__txt"><span className="stnf-sh__t">{title}</span><span className="stnf-sh__s">{sub}</span></div>
      <span className="stnf-sh__line" />
      {children}
    </div>
  );
}

type Props = {
  /** Domestic (₹ + GST) or International (currency, no GST). */
  scope: SupplierScope;
  product: ReportProduct;
  saving: boolean;
  /** Field messages the server sent back (422), by API field name. */
  serverErrors?: Record<string, string>;
  onClearServerErrors?: () => void;
  /** Tells the parent whether anything was typed (Esc must not lose it). */
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
  onSave: (req: MapRequest) => void;
  /** Edit a mapped New Supplier: the form opens with these values … */
  initial?: NewSupplierValues;
  /** … and its stored business card (a /storage path), if it has one. */
  initialCard?: string;
};

/** API field → form field, for the server's 422 messages. */
const SERVER_FIELD: Record<string, keyof NewForm> = {
  'new_supplier.name': 'coName', 'new_supplier.contact': 'contact', 'new_supplier.mobile': 'mobile', 'new_supplier.segment': 'segment',
  'new_supplier.email': 'email', 'new_supplier.gmaps': 'gmaps', 'new_supplier.address': 'addr', 'new_supplier.country': 'country',
  'new_supplier.state': 'state', 'new_supplier.state_code': 'stateCode', 'new_supplier.city': 'city',
  price: 'price', exchange_rate: 'fx', valid_till: 'validTill', currency: 'cur',
  // A duplicate email is caught when the supplier row is saved (EnforcesUniqueEmail), which keys
  // the 422 on the column name, not on the request field.
  email: 'email',
};

export default function NewSupplierForm({ scope, product, saving, serverErrors = {}, onClearServerErrors, onDirty, onBack, onSave, initial, initialCard }: Props) {
  const isEdit = !!initial;
  const intl = scope === 'international';
  const { masters } = useFormMasters();
  const segmentOptions = useMemo(() => (masters?.segments ?? []).map(sg => ({ value: sg.name, label: sg.name })), [masters]);
  const stateOptions = useMemo(() => (masters ? indianStates(masters) : []).map(st => ({ value: st.name, label: st.name })), [masters]);
  const countryOptions = useMemo(() => (masters ? overseasCountries(masters) : []).map(c => ({ value: c.name, label: c.name })), [masters]);
  const currencyOptions = useMemo(() => (masters?.currencies ?? []).map(c => ({ value: c.code.toUpperCase(), label: c.name ? `${c.code.toUpperCase()} · ${c.name}` : c.code.toUpperCase(), selectedLabel: c.code.toUpperCase() })), [masters]);
  const gstRates = useMemo(() => (masters?.gstRates.length ? masters.gstRates : [0, 5, 12, 18, 28]), [masters]);
  const gstOptions = useMemo(() => gstRates.map(r => ({ value: String(r), label: `${r}%${r === DEFAULT_GST ? ' (default)' : ''}` })), [gstRates]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const empty = useMemo(() => ({ ...emptyForm(intl), ...(initial ?? {}) }), [intl]);
  const [f, setF] = useState<NewForm>(empty);
  // Edit keeps the saved GST type; a new supplier's follows the state until picked by hand.
  const [gstTypeTouched, setGstTypeTouched] = useState(isEdit);
  const [tried, setTried] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Edit: the business card already stored with the supplier (kept unless replaced or removed).
  const [cardPath, setCardPath] = useState(initialCard ?? '');
  const [fileErr, setFileErr] = useState('');
  const toast = useToast();
  /** The attached card's name: a picked file, or the stored one (Edit). */
  const cardName = file ? file.name : cardPath ? (cardPath.split('/').pop() || 'Business card') : '';
  // Business card: the upload area opens the "Add attachment" menu (Upload file / Take photo).
  const cardRef = useRef<HTMLButtonElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const closeAttach = useCallback(() => setAttachOpen(false), []);
  const pickCard = (picked: File) => {
    if (!CARD_EXT.test(picked.name) || picked.size > CARD_MAX_BYTES) { setFileErr(CARD_ERR); return; }
    setFileErr(''); setFile(picked);
  };
  const today = useMemo(todayIso, []);

  const dirty = !!file || cardPath !== (initialCard ?? '') || JSON.stringify(f) !== JSON.stringify(empty);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  // The masters arrive after the form opens: the default GST rate and exchange rate follow them.
  useEffect(() => {
    if (!masters) return;
    setF(p => ({
      ...p,
      gst: gstRates.includes(Number(p.gst)) ? p.gst : String(gstRates.includes(DEFAULT_GST) ? DEFAULT_GST : gstRates[0] ?? 0),
      fx: p.fx || rateOf(masters, p.cur),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masters]);
  // A server message stays until the user changes the form.
  useEffect(() => { if (Object.keys(serverErrors).length) onClearServerErrors?.(); }, [f, file, cardPath]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof NewForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setF(p => ({ ...p, [k]: k === 'stateCode' ? e.target.value.toUpperCase() : e.target.value }));
  // The state fills its GST state code, and the GST type follows it (our own state = CGST + SGST)
  // until the user picks a type by hand.
  const pickState = (state: string) =>
    setF(p => ({
      ...p, state,
      stateCode: masters ? stateCodeOf(masters, state) || p.stateCode : p.stateCode,
      gstType: gstTypeTouched ? p.gstType : gstTypeFor(masters, state),
    }));
  // International: the country suggests its currency, with the Currency master's default rate
  // (both can still be changed). A country without a known currency keeps the current one.
  const pickCountry = (country: string) => {
    const known = COUNTRY_CURRENCY[country];
    const cur = known && currencyOptions.some(o => o.value === known) ? known : f.cur;
    setF(p => ({ ...p, country, cur, fx: cur === p.cur ? p.fx : rateOf(masters, cur) }));
  };
  const pickCurrency = (cur: string) => setF(p => ({ ...p, cur, fx: rateOf(masters, cur) }));
  const errs = useMemo(() => {
    const e = errors(f, intl);
    // The server's own messages (422) for fields the form did not already flag.
    for (const [k, v] of Object.entries(serverErrors)) { const fk = SERVER_FIELD[k]; if (fk && v && !e[fk]) e[fk] = v; }
    return e;
  }, [f, intl, serverErrors]);
  // Form checks show after the first Save; a server message shows at once.
  const fromServer = useMemo(() => new Set(Object.keys(serverErrors).map(k => SERVER_FIELD[k]).filter(Boolean)), [serverErrors]);
  const bad = (k: keyof NewForm) => !!errs[k] && (tried || fromServer.has(k));
  const cls = (base: string, k: keyof NewForm) => `${base}${bad(k) ? ' is-err' : ''}`;
  // Invalid-state props for an input, tied to its message below the field.
  const aria = (k: keyof NewForm) => ({ 'aria-invalid': bad(k), 'aria-describedby': bad(k) ? `stnf-${k}-err` : undefined });
  const msg = (k: keyof NewForm) => (bad(k) ? <div className="stnf-err" id={`stnf-${k}-err`}>{errs[k]}</div> : null);
  const withIcon = (icon: ReactNode, input: ReactNode) => <div className="stnf-iw"><span className="stnf-iw__ico">{icon}</span>{input}</div>;

  // Price summary (per unit).
  const price = round2(parseFloat(f.price) || 0);
  const rate = Number(f.gst);
  const gstAmt = round2(price * rate / 100);
  const half = round2(gstAmt / 2);
  const target = parseFloat(product.targetPrice) || 0;
  const fx = parseFloat(f.fx) || 0;
  const inrEquivalent = round2(price * fx);
  const gstLine = f.gstType === 'intra'
    ? `CGST ${rate / 2}% ${rupees(half)} · SGST ${rate / 2}% ${rupees(round2(gstAmt - half))}`
    : `IGST ${rate}% ${rupees(gstAmt)}`;
  const hsn = product.hsn && product.hsn !== '—' ? product.hsn : '';

  const save = () => {
    setTried(true);
    if (Object.keys(errors(f, intl)).length) return;
    const t = (v: string) => v.trim() || undefined;
    onSave({
      supplierName: f.coName.trim(),
      card: file,
      body: {
        new_supplier: {
          name: f.coName.trim(), segment: t(f.segment), contact: t(f.contact), mobile: t(f.mobile), email: t(f.email),
          gmaps: t(f.gmaps), address: t(f.addr), country: intl ? f.country : 'India', state: t(f.state),
          state_code: intl ? undefined : t(f.stateCode), city: t(f.city),
          // Edit: the stored card stays, or is cleared when removed (a new pick is uploaded first).
          ...(isEdit && !file ? { card: cardPath } : {}),
        },
        origin: intl ? 'international' : 'domestic',
        price,
        ...(intl
          ? { currency: f.cur, exchange_rate: fx }
          : { gst_percentage: rate, gst_type: f.gstType }),
        ...(f.validTill ? { valid_till: f.validTill } : {}),
      },
    });
  };

  return (
    <div className="stmap-body stnf-body sct-scroller">
      <div className="stnf-section" inert={saving}>
        <SecHead icon={SEC_ICONS.info} title="Supplier Information" sub="Company, contact & segment details" />
        <div className="stnf-row stnf-row-1">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-coName">Supplier Company Name <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.company, <input id="stnf-coName" className={cls('stnf-inp', 'coName')} placeholder="e.g. TechParts India Pvt Ltd" value={f.coName} onChange={set('coName')} {...aria('coName')} />)}{msg('coName')}</div>
        </div>
        <div className="stnf-row stnf-row-3">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-contact">Contact Person <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.user, <input id="stnf-contact" className={cls('stnf-inp', 'contact')} placeholder="Full name" value={f.contact} onChange={set('contact')} {...aria('contact')} />)}{msg('contact')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-mobile">Mobile Number <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.phone, <input id="stnf-mobile" className={cls('stnf-inp', 'mobile')} placeholder={intl ? 'With country code, e.g. +971 50...' : '10-digit mobile'} inputMode={intl ? 'tel' : 'numeric'} maxLength={intl ? 20 : 10}
              value={f.mobile} onChange={e => setF(p => ({ ...p, mobile: e.target.value.replace(intl ? /[^\d+\s-]/g : /\D/g, '') }))} {...aria('mobile')} />)}{msg('mobile')}</div>
          <div className="stnf-field"><span className="stnf-lbl">Segment <span className="stnf-req">*</span></span>
            <div className={cls('stnf-ms', 'segment')}>
              <MasterSelect menuClassName="stnf-ms-menu" value={f.segment} placeholder="Select segment..." invalid={bad('segment')}
                options={segmentOptions} searchable={segmentOptions.length > 8} searchPlaceholder="Search segment…" onChange={v => setF(p => ({ ...p, segment: v }))} />
            </div>{msg('segment')}</div>
        </div>
        <div className="stnf-row stnf-row-2">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-email">Email ID <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.mail, <input id="stnf-email" type="email" className={cls('stnf-inp', 'email')} placeholder="supplier@company.com" value={f.email} onChange={set('email')} {...aria('email')} />)}{msg('email')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-gmaps">Google Location Link</label>
            {withIcon(FIELD_ICONS.map, <input id="stnf-gmaps" className="stnf-inp" placeholder="https://maps.google.com/..." value={f.gmaps} onChange={set('gmaps')} />)}</div>
        </div>
      </div>

      <div className="stnf-section" inert={saving}>
        <SecHead icon={<IcoPin size={15} sw={2.3} />} title="Address" sub="Registered address of the supplier" />
        <div className="stnf-row stnf-row-1">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-addr">Street Address <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.home, <input id="stnf-addr" className={cls('stnf-inp', 'addr')} placeholder="e.g. 101, Business Park, MG Road" value={f.addr} onChange={set('addr')} {...aria('addr')} />)}{msg('addr')}</div>
        </div>
{intl ? (
        <div className="stnf-row stnf-row-3">
          <div className="stnf-field"><span className="stnf-lbl">Country <span className="stnf-req">*</span></span>
            <div className={cls('stnf-ms', 'country')}>
              <MasterSelect menuClassName="stnf-ms-menu" value={f.country} placeholder="Select country..." invalid={bad('country')} searchable
                searchPlaceholder="Search country…" options={countryOptions} onChange={pickCountry} />
            </div>{msg('country')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-province">State / Province</label>
            {withIcon(FIELD_ICONS.flag, <input id="stnf-province" className="stnf-inp" placeholder="e.g. Dubai, Bavaria" value={f.state} onChange={set('state')} />)}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-city">City <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.city, <input id="stnf-city" className={cls('stnf-inp', 'city')} placeholder="City name" value={f.city} onChange={set('city')} {...aria('city')} />)}{msg('city')}</div>
        </div>
        ) : (
        <div className="stnf-row stnf-row-4">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-country">Country <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.globe, <input id="stnf-country" className={cls('stnf-inp', 'country')} value={f.country} onChange={set('country')} {...aria('country')} />)}{msg('country')}</div>
          <div className="stnf-field"><span className="stnf-lbl">State <span className="stnf-req">*</span></span>
            <div className={cls('stnf-ms', 'state')}>
              <MasterSelect menuClassName="stnf-ms-menu" value={f.state} placeholder="Select state..." invalid={bad('state')} searchable
                searchPlaceholder="Search state…" options={stateOptions} onChange={pickState} />
            </div>{msg('state')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-stateCode">State Code</label>
            {withIcon(FIELD_ICONS.hash, <input id="stnf-stateCode" className="stnf-inp" placeholder="e.g. 27" maxLength={3} value={f.stateCode} onChange={set('stateCode')} />)}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-city">City <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.city, <input id="stnf-city" className={cls('stnf-inp', 'city')} placeholder="City name" value={f.city} onChange={set('city')} {...aria('city')} />)}{msg('city')}</div>
        </div>
        )}
      </div>

      {intl ? (
      <div className="stnf-section" inert={saving}>
        <SecHead icon={SEC_ICONS.globe} title="Supplier Price & Currency" sub="Price in supplier currency — no GST, ₹ equivalent auto-calculates">
          <span className="stnf-meta">
            <em className="stnf-hsn stnf-hsn--txt">No GST — overseas</em>
            {target > 0 && <em className="stnf-tgt">Target Price <b>{rupees(target)}</b></em>}
          </span>
        </SecHead>
        <div className="stnf-row stnf-row-4">
          <div className="stnf-field"><span className="stnf-lbl">Currency <span className="stnf-req">*</span></span>
            <div className="stnf-ms"><MasterSelect menuClassName="stnf-ms-menu" value={f.cur} options={currencyOptions} searchable={currencyOptions.length > 8} searchPlaceholder="Search currency…" onChange={pickCurrency} /></div>{msg('cur')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-price">Unit Price ({f.cur}) <span className="stnf-req">*</span></label>
            <input id="stnf-price" className={cls('stnf-inp stnf-inp--num', 'price')} inputMode="decimal" placeholder="Price in supplier currency"
              value={f.price} onChange={e => setF(p => ({ ...p, price: limitNum(e.target.value, PRICE_INT, PRICE_DEC) }))} {...aria('price')} />{msg('price')}</div>
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-fx">Exchange Rate (₹ per {f.cur}) <span className="stnf-req">*</span></label>
            {withIcon(FIELD_ICONS.fx, <input id="stnf-fx" className={cls('stnf-inp stnf-inp--num', 'fx')} inputMode="decimal"
              value={f.fx} onChange={e => setF(p => ({ ...p, fx: limitNum(e.target.value, RATE_INT, RATE_DEC) }))} {...aria('fx')} />)}{msg('fx')}</div>
          <div className="stnf-field"><span className="stnf-lbl">Price Valid Till</span>
            <div className="stnf-ms"><MasterDatePicker value={f.validTill} minDate={today} placeholder="dd/mm/yyyy" onChange={v => setF(p => ({ ...p, validTill: v }))} /></div>{msg('validTill')}</div>
        </div>
        <div className="stnf-sum stnf-sum--3">
          <div className="stnf-k"><span>Total Amount</span><b>{money(f.cur, price)}</b><small>per unit · {f.cur}</small></div>
          <div className="stnf-k"><span>GST</span><b>No GST</b><small>Overseas supplier</small></div>
          <div className="stnf-k stnf-k--tot"><span>INR Equivalent</span><b>{rupees(inrEquivalent)}</b><small>@ ₹{fx} / {f.cur}</small></div>
        </div>
      </div>
      ) : (
      <div className="stnf-section" inert={saving}>
        <SecHead icon={SEC_ICONS.price} title="Supplier Price & GST" sub="GST amount & total auto-calculate as you type">
          <span className="stnf-meta">
            {hsn && <em className="stnf-hsn">HSN {hsn}</em>}
            {target > 0 && <em className="stnf-tgt">Target Price <b>{rupees(target)}</b></em>}
          </span>
        </SecHead>
        <div className="stnf-row stnf-row-4">
          <div className="stnf-field"><label className="stnf-lbl" htmlFor="stnf-price">Unit Price (excl. GST) <span className="stnf-req">*</span></label>
            <div className="stnf-cur"><span aria-hidden>₹</span>
              <input id="stnf-price" className={cls('stnf-inp', 'price')} inputMode="decimal" placeholder={target ? target.toFixed(2) : '0.00'}
                value={f.price} onChange={e => setF(p => ({ ...p, price: limitNum(e.target.value, PRICE_INT, PRICE_DEC) }))} {...aria('price')} />
            </div>{msg('price')}</div>
          <div className="stnf-field"><span className="stnf-lbl">GST Rate <span className="stnf-req">*</span></span>
            <div className="stnf-ms"><MasterSelect menuClassName="stnf-ms-menu" value={f.gst} options={gstOptions} onChange={v => setF(p => ({ ...p, gst: v }))} /></div></div>
          <div className="stnf-field"><span className="stnf-lbl">GST Type <span className="stnf-req">*</span></span>
            <div className="stnf-ms"><MasterSelect menuClassName="stnf-ms-menu" value={f.gstType} options={GST_TYPE_OPTIONS}
              onChange={v => { setGstTypeTouched(true); setF(p => ({ ...p, gstType: v as GstType })); }} /></div></div>
          <div className="stnf-field"><span className="stnf-lbl">Price Valid Till</span>
            <div className="stnf-ms"><MasterDatePicker value={f.validTill} minDate={today} placeholder="dd/mm/yyyy" onChange={v => setF(p => ({ ...p, validTill: v }))} /></div>{msg('validTill')}</div>
        </div>
        <div className="stnf-sum">
          <div className="stnf-k"><span>Taxable Value</span><b>{rupees(price)}</b><small>per unit</small></div>
          <div className="stnf-k"><span>GST Amount</span><b>{rupees(gstAmt)}</b><small>{gstLine}</small></div>
          <div className="stnf-k stnf-k--tot"><span>Price incl. GST</span><b>{rupees(round2(price + gstAmt))}</b><small>per unit</small></div>
          <VsTarget value={price} target={target} empty="Enter the unit price" />
        </div>
      </div>
      )}

      <div className="stnf-section" inert={saving}>
        <SecHead icon={SEC_ICONS.docs} title="Documents" sub="Business card or company profile" />
        {cardName ? (
          // Attached: one row — the file (click it to replace) on the left, NEW · View · Remove on the right.
          <div className="stnf-upload is-attached">
            <button type="button" ref={cardRef} className="stnf-upload-pick" onClick={() => setAttachOpen(true)}
              aria-haspopup="menu" aria-expanded={attachOpen} aria-label={`Business card ${cardName} — replace`}
              aria-invalid={!!fileErr} aria-describedby={fileErr ? 'stnf-card-err' : undefined}>
              <span className="stnf-upload-icon"><Svg size={18} sw={2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Svg></span>
              <span className="stnf-upload-text">
                <span className="stnf-upload-main is-file">{cardName}</span>
                <span className="stnf-upload-sub">Business card · click to replace</span>
              </span>
            </button>
            <Tooltip label="View document">
              <button type="button" className="stfile__btn" aria-label={`View ${cardName}`}
                onClick={() => { const src = file ?? cardPath; if (src) viewDocument(src).catch(() => toast.error('Couldn’t open the document', 'Please try again.')); }}>
                <Svg size={14} sw={2.2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
              </button>
            </Tooltip>
            <Tooltip label="Remove document">
              <button type="button" className="stfile__btn is-del" aria-label={`Remove ${cardName}`} disabled={saving}
                onClick={() => { if (file) setFile(null); else setCardPath(''); setFileErr(''); }}>
                <Svg size={13} sw={2.2}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>
              </button>
            </Tooltip>
          </div>
        ) : (
          <button type="button" ref={cardRef} className="stnf-upload" onClick={() => setAttachOpen(true)}
            aria-haspopup="menu" aria-expanded={attachOpen} aria-invalid={!!fileErr} aria-describedby={fileErr ? 'stnf-card-err' : undefined}>
            <span className="stnf-upload-icon"><IcoUpload size={20} sw={1.8} /></span>
            <span className="stnf-upload-text">
              <span className="stnf-upload-main">Click to upload Business Card</span>
              <span className="stnf-upload-sub">PDF, JPG, PNG&nbsp;·&nbsp;Max 5 MB</span>
            </span>
          </button>
        )}
        <AttachPicker anchorRef={cardRef} open={attachOpen} onClose={closeAttach} accept={CARD_ACCEPT} onFile={pickCard}
          camera={{ title: 'Take a photo of the business card', subject: f.coName.trim() || product.name, namePrefix: 'business-card' }} />
        {fileErr && <div className="stnf-err" id="stnf-card-err" role="alert">{fileErr}</div>}

      </div>

      <div className="stnf-foot">
        <button type="button" className="stmap-btn-back" disabled={saving} onClick={onBack}><IcoBack size={12} sw={2.6} />Back</button>
        <button type="button" className="stmap-btn-primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>
          {saving ? <><span className="sct-spin" aria-hidden />Saving…</> : <><IcoSave />Save Supplier</>}
        </button>
      </div>
    </div>
  );
}
