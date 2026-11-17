import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../supplier-management/SupplierScopeGate';
import {
  FX_DEFAULTS, GST_RATES, SAMPLE_INTL_VENDORS, SUPPLIER_CURRENCIES,
  fmtCurrency, isIntl, makeIntlSupplier, makeSupplier, supplierInr,
  type MappedSupplier, type SupplierOrigin,
} from './serviceData';
import { SVC_ICONS } from './serviceIcons';
import '../product-management/product-management.css';
import './service-management.css';
import './service-suppliers.css';

const AddVendorModal = lazyPage(() => import('../supplier-management/AddVendorModal'));

const SUP_VISIBLE_ROWS = 4;

type VendorOpt = { id: string; code: string; name: string; type: string; state: string; contact: string };

type BundleVendorRow = {
  id: number | string;
  vendor_code?: string | null;
  company_name?: string | null;
  vendor_type_name?: string | null;
  state?: string | null;
  primary_address?: { contact_name?: string | null } | null;
};

export const formatSupplierCode = (raw: string): string => {
  const m = String(raw ?? '').match(/(\d+)\s*$/);
  return m ? `S-${m[1].padStart(3, '0')}` : String(raw ?? '');
};

const money = (n: number) => `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const GST_STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05',
  haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11',
  'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16', meghalaya: '17',
  assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21', chhattisgarh: '22', 'madhya pradesh': '23',
  gujarat: '24', 'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29',
  goa: '30', lakshadweep: '31', kerala: '32', 'tamil nadu': '33', puducherry: '34',
  'andaman and nicobar islands': '35', telangana: '36', 'andhra pradesh': '37', ladakh: '38',
};
const gstStateCode = (state: string) => GST_STATE_CODES[String(state ?? '').trim().toLowerCase()] ?? '';

let vendorCache: VendorOpt[] | null = null;
async function loadVendors(force = false): Promise<VendorOpt[]> {
  if (vendorCache && !force) return vendorCache;
  const res = await api.get<{ vendors?: BundleVendorRow[] }>('/products/master-bundle');
  vendorCache = (res.data?.vendors ?? []).map(r => ({
    id: String(r.id),
    code: String(r.vendor_code ?? ''),
    name: String(r.company_name ?? ''),
    type: String(r.vendor_type_name ?? ''),
    state: String(r.state ?? ''),
    contact: String(r.primary_address?.contact_name ?? ''),
  }));
  return vendorCache;
}

const FLAG = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21V4" /><path d="M3 4h13l-2 4 2 4H3" /></svg>
);
const GLOBE = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
);

function SvmsField(props: { label: ReactNode; required?: boolean; auto?: boolean; extra?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className={`svms-f${props.error ? ' is-err' : ''}`}>
      <span className="svms-l">
        {props.label}
        {props.required && <span className="svms-req">*</span>}
        {props.auto && <span className="svms-auto">Auto</span>}
        {props.extra}
      </span>
      {props.children}
      {props.error && <span className="svms-err">{props.error}</span>}
    </div>
  );
}

function OriginCard({ origin, available, onPick }: { origin: SupplierOrigin; available: number; onPick: () => void }) {
  const intl = origin === 'international';
  const pills = intl ? ['Currency', 'Exchange Rate', 'No GST'] : ['INR (₹)', 'GST %', 'State'];
  return (
    <button type="button" className={`svms-oc svms-oc--${intl ? 'intl' : 'dom'}`} onClick={onPick}>
      <span className="svms-oc__ico">
        {intl ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21V4" /><path d="M3 4h13l-2 4 2 4H3" /></svg>
        )}
      </span>
      <span className="svms-oc__t">
        {intl ? 'International Supplier' : 'Domestic Supplier'}
        <em>{available} available</em>
      </span>
      <span className="svms-oc__d">
        {intl ? 'Overseas supplier — price in its currency, no GST charged' : 'Supplier based in India — price in ₹ with GST applied'}
      </span>
      <span className="svms-oc__ft">
        <span className="svms-oc__pills">
          {pills.map(p => <span key={p}>{SVC_ICONS.check}{p}</span>)}
        </span>
        <span className="svms-oc__go">{SVC_ICONS.chevron}</span>
      </span>
    </button>
  );
}

export function SupplierMapPanel({
  serviceName, suppliers, onChange, defaultGst,
}: {
  serviceName: string;
  suppliers: MappedSupplier[];
  onChange: (next: MappedSupplier[]) => void;
  /** GST % mapped on the service — prefills a domestic supplier's GST %. */
  defaultGst?: number;
}) {
  const toast = useToast();
  const gstDefault = String(defaultGst ?? 18);
  const gstOpts = useMemo(
    () => [...new Set([...GST_RATES, ...(defaultGst != null ? [defaultGst] : [])])]
      .sort((a, b) => a - b)
      .map(r => ({ value: String(r), label: String(r) })),
    [defaultGst],
  );
  const confirm = useConfirm();

  const [vendors, setVendors] = useState<VendorOpt[]>(vendorCache ?? []);
  const [vendorsLoading, setVendorsLoading] = useState(!vendorCache);
  useEffect(() => {
    let live = true;
    loadVendors()
      .then(v => { if (live) setVendors(v); })
      .catch(() => { if (live) toast.error('Could not load suppliers', 'Please refresh and try again.'); })
      .finally(() => { if (live) setVendorsLoading(false); });
    return () => { live = false; };
  }, [toast]);

  const overflow = suppliers.length > SUP_VISIBLE_ROWS;
  const grandTotal = suppliers.reduce((sum, s) => sum + supplierInr(s), 0);

  const [step, setStep] = useState<'closed' | 'choose' | 'form'>('closed');
  const [origin, setOrigin] = useState<SupplierOrigin>('domestic');
  const intl = origin === 'international';
  const [selCode, setSelCode] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState(gstDefault);
  const [currency, setCurrency] = useState('USD');
  const [fx, setFx] = useState(String(FX_DEFAULTS.USD));
  const [errors, setErrors] = useState<{ supplier?: string; price?: string; fx?: string }>({});

  const [addScope, setAddScope] = useState<SupplierScope | null>(null);
  const [editVendorId, setEditVendorId] = useState<number | null>(null);
  useEffect(() => {
    document.body.classList.toggle('apm-supplier-wizard-open', addScope !== null || editVendorId !== null);
    return () => document.body.classList.remove('apm-supplier-wizard-open');
  }, [addScope, editVendorId]);

  const mappedDom = useMemo(
    () => new Set(suppliers.filter(s => !isIntl(s)).map(s => formatSupplierCode(s.code))),
    [suppliers],
  );
  const mappedIntl = useMemo(
    () => new Set(suppliers.filter(isIntl).map(s => formatSupplierCode(s.code))),
    [suppliers],
  );
  const domPool = useMemo(
    () => vendors.filter(v => v.code && !mappedDom.has(formatSupplierCode(v.code))),
    [vendors, mappedDom],
  );
  const intlPool = useMemo(
    () => SAMPLE_INTL_VENDORS.filter(v => !mappedIntl.has(formatSupplierCode(v.code))),
    [mappedIntl],
  );

  const pickOpts = intl
    ? intlPool.map(v => ({ value: v.code, label: `${formatSupplierCode(v.code)}: ${v.name} · ${v.country}` }))
    : domPool.map(v => ({ value: v.code, label: `${formatSupplierCode(v.code)}: ${v.name}` }));

  const domSel = !intl ? domPool.find(v => v.code === selCode) ?? null : null;
  const intlSel = intl ? intlPool.find(v => v.code === selCode) ?? null : null;
  const editableId = domSel && /^d+$/.test(domSel.id) ? Number(domSel.id) : null;

  const refreshVendors = (selectName?: string) => {
    setVendorsLoading(true);
    loadVendors(true)
      .then(v => {
        setVendors(v);
        if (selectName) {
          const hit = v.find(o => o.name.trim().toLowerCase() === selectName);
          if (hit?.code) setSelCode(hit.code);
        }
      })
      .catch(() => {})
      .finally(() => setVendorsLoading(false));
  };

  const priceNum = parseFloat(price) || 0;
  const gstNum = Number(gst) || 0;
  const fxNum = parseFloat(fx) || 0;
  const gstAmt = +(priceNum * gstNum / 100).toFixed(2);
  const domTotal = +(priceNum + gstAmt).toFixed(2);

  const resetForm = () => {
    setSelCode(''); setPrice(''); setGst(gstDefault); setCurrency('USD'); setFx(String(FX_DEFAULTS.USD)); setErrors({});
  };
  const openChooser = () => { resetForm(); setStep('choose'); };
  const pickOrigin = (o: SupplierOrigin) => { resetForm(); setOrigin(o); setStep('form'); };
  const close = () => setStep('closed');

  const changeCurrency = (c: string) => {
    setCurrency(c);
    setFx(String(FX_DEFAULTS[c] ?? ''));
    setErrors(e => ({ ...e, fx: undefined }));
  };

  const saveDraft = () => {
    const errs: typeof errors = {};
    if (!selCode) errs.supplier = 'This field is required';
    if (!(priceNum > 0)) errs.price = 'This field is required';
    if (intl && !(fxNum > 0)) errs.fx = 'This field is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    let row: MappedSupplier;
    if (intl && intlSel) {
      row = makeIntlSupplier({ ...intlSel, vendorId: intlSel.id }, priceNum, currency, fxNum);
    } else if (domSel) {
      row = {
        ...makeSupplier({
          vendorId: domSel.id, code: domSel.code, name: domSel.name, type: domSel.type || '—',
          state: domSel.state || '—', contact: domSel.contact || '—',
        }, priceNum, gstNum),
        origin: 'domestic', country: 'India', gstStateCode: gstStateCode(domSel.state) || undefined,
      };
    } else {
      return;
    }

    onChange([...suppliers, row]);
    toast.success(
      'Supplier mapped',
      `${row.name} mapped as ${intl ? 'International' : 'Domestic'} supplier · ${intl ? fmtCurrency(row.currency!, row.price) : money(row.total)}`,
    );
    close();
  };

  const remove = async (i: number) => {
    const s = suppliers[i];
    const ok = await confirm({
      title: 'Unmap supplier?',
      message: <>“<strong>{s.name}</strong>” will be removed from this service.</>,
      confirmLabel: 'Unmap',
    });
    if (!ok) return;
    onChange(suppliers.filter((_, k) => k !== i));
  };

  const auto = (v?: string) => (v == null ? '' : (v || '—'));

  return (
    <>
      <div className="svs-card">
        <div className="svs-card-head">
          <span className="svs-card-ico">{SVC_ICONS.mapUser}</span>
          <span className="svs-card-title">Mapped Service Suppliers</span>
          {suppliers.length > 0 && <span className="svs-card-count">{suppliers.length}</span>}
          <button type="button" className="svs-btn svs-btn--primary svs-card-act" onClick={openChooser}>
            {SVC_ICONS.plus} Map Supplier
          </button>
        </div>

        {suppliers.length === 0 ? (
          <div className="svs-empty">
            <b>No suppliers mapped yet</b>
            <span>
              Use <b>Map Supplier</b> to link a <b>Domestic</b> supplier (price with GST) or an <b>International</b> supplier (price in its currency) to this service.
            </span>
          </div>
        ) : (
          <div className={`svs-tablewrap${overflow ? ' is-scroll' : ''}`}>
            <div className="svs-tablescroll">
            <table className="svs-table">
              <thead>
                <tr>
                  <th>Sr. No</th><th className="is-l">Supplier</th><th>Supplier Origin</th>
                  <th className="is-l">State / Country</th><th className="is-l">Contact Person</th><th className="is-r">Price</th>
                  <th>GST (%)</th><th className="is-r">GST Value</th><th className="is-r">Total Service Cost</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, i) => {
                  const foreign = isIntl(s);
                  return (
                    <tr key={`${s.code}-${i}`}>
                      <td><span className="svs-sr">{i + 1}</span></td>
                      <td className="is-l">
                        <span className="svs-sup">
                          <b title={s.name}>{s.name || '—'}</b>
                          <em>{formatSupplierCode(s.code)}</em>
                        </span>
                      </td>
                      <td>
                        <span className={`svms-org svms-org--${foreign ? 'intl' : 'dom'}`}>
                          {foreign ? GLOBE : FLAG}{foreign ? 'International' : 'Domestic'}
                        </span>
                      </td>
                      <td className="is-l">
                        {foreign ? (s.country || '—') : (s.state || '—')}
                        {foreign && s.state && <small className="svms-sub">{s.state}</small>}
                      </td>
                      <td className="is-l">{s.contact || '—'}</td>
                      <td className="is-r svms-num">
                        {foreign ? (
                          <>
                            {fmtCurrency(s.currency ?? 'USD', s.price)}
                            <small>@ ₹{(s.fx ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })} / {s.currency}</small>
                          </>
                        ) : money(s.price)}
                      </td>
                      <td>
                        {foreign
                          ? <span className="svs-gst svms-gst--na">No GST</span>
                          : <span className="svs-gst">{String(Number(s.gst.toFixed(2)))}%</span>}
                      </td>
                      <td className="is-r">{foreign ? <span className="svms-dash">—</span> : money(s.gstAmt)}</td>
                      <td className="is-r svms-num">
                        {foreign ? (
                          <>
                            <b className="svs-total">{fmtCurrency(s.currency ?? 'USD', s.total)}</b>
                            <small>≈ {money(s.inr ?? 0)}</small>
                          </>
                        ) : <b className="svs-total">{money(s.total)}</b>}
                      </td>
                      <td>
                        <Tooltip label="Unmap supplier">
                          <button type="button" className="svs-del" aria-label={`Unmap ${s.name}`} onClick={() => { void remove(i); }}>
                            {SVC_ICONS.trash}
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            {overflow && (
              <div className="svs-tablefoot">
                <span className="svs-tablefoot-count">
                  Showing <b>{suppliers.length}</b> mapped suppliers
                </span>
                <span className="svs-tablefoot-total">
                  Total Service Cost <b>{suppliers.some(isIntl) ? '≈ ' : ''}{money(grandTotal)}</b>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {step === 'choose' && createPortal((
        <div className="apm-mv-backdrop svms-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="svms-box svms-box--choose" role="dialog" aria-modal="true" aria-label="Map Supplier">
            <div className="svms-hd">
              <div className="svms-hd__ico">{SVC_ICONS.mapUser}</div>
              <div className="svms-hd__txt">
                <div className="svms-hd__t">Map Supplier</div>
                <div className="svms-hd__s">Choose the supplier type for <b>{serviceName || 'this service'}</b></div>
              </div>
              <button type="button" className="svms-x" onClick={close} aria-label="Close">{SVC_ICONS.x}</button>
            </div>
            <div className="svms-bd">
              <div className="svms-ocgrid">
                <OriginCard origin="domestic" available={vendorsLoading ? 0 : domPool.length} onPick={() => pickOrigin('domestic')} />
                <OriginCard origin="international" available={intlPool.length} onPick={() => pickOrigin('international')} />
              </div>
            </div>
            <div className="svms-ft">
              <button type="button" className="svx-btn svx-btn--ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {step === 'form' && createPortal((
        <div className="apm-mv-backdrop svms-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="svms-box" role="dialog" aria-modal="true" aria-label={`Map ${intl ? 'International' : 'Domestic'} Supplier`}>
            <div className="svms-hd">
              <div className="svms-hd__ico">{SVC_ICONS.mapUser}</div>
              <div className="svms-hd__txt">
                <div className="svms-hd__t">
                  Map Supplier
                  <span className={`svms-hd__tag svms-hd__tag--${intl ? 'intl' : 'dom'}`}>{intl ? GLOBE : FLAG}{intl ? 'International' : 'Domestic'}</span>
                </div>
                <div className="svms-hd__s">
                  {intl
                    ? <>Link an overseas supplier with its price in foreign currency for <b>{serviceName || 'this service'}</b></>
                    : <>Link an Indian supplier with price &amp; GST for <b>{serviceName || 'this service'}</b></>}
                </div>
              </div>
              <button type="button" className="svms-x" onClick={close} aria-label="Close">{SVC_ICONS.x}</button>
            </div>

            <div className="svms-bd">
              <div className="svms-subhd">{intl ? GLOBE : FLAG}Supplier Details</div>
              <div className="svms-grid">
                <SvmsField label="Supplier Name" required error={errors.supplier}
                  extra={(
                    <Tooltip label={`Add a new ${intl ? 'international' : 'domestic'} supplier`}>
                      <button type="button" className="svms-mini" aria-label="Add a new supplier" onClick={() => setAddScope(origin)}>{SVC_ICONS.plus}</button>
                    </Tooltip>
                  )}>
                  <div className="svms-selrow">
                  <div className="svms-select is-key">
                    <MasterSelect
                      value={selCode}
                      options={pickOpts}
                      placeholder="Select Supplier Name"
                      searchable
                      searchPlaceholder={intl ? 'Search supplier code, name or country' : 'Search supplier code or name'}
                      loading={!intl && vendorsLoading}
                      emptyText="No suppliers available"
                      invalid={!!errors.supplier}
                      onChange={(v) => { setSelCode(v); setErrors(e => ({ ...e, supplier: undefined })); }}
                    />
                  </div>
                  {selCode && (
                    <Tooltip label={editableId != null
                      ? 'Edit the selected supplier'
                      : 'Sample supplier — editable once international suppliers come from the API'}>
                      <button type="button" className="svms-editsq" aria-label="Edit the selected supplier"
                        disabled={editableId == null} onClick={() => setEditVendorId(editableId)}>
                        {SVC_ICONS.edit}
                      </button>
                    </Tooltip>
                  )}
                  </div>
                </SvmsField>
                <SvmsField label="Supplier Code" auto>
                  <input className="svms-i is-ro" value={selCode ? formatSupplierCode(selCode) : ''} readOnly tabIndex={-1} placeholder="Auto-fills from supplier" />
                </SvmsField>
                <SvmsField label="Supplier Type" auto>
                  <input className="svms-i is-ro" value={auto(intl ? intlSel?.type : domSel?.type)} readOnly tabIndex={-1} placeholder="—" />
                </SvmsField>
                {intl ? (
                  <>
                    <SvmsField label="Country" auto>
                      <input className="svms-i is-ro" value={auto(intlSel?.country)} readOnly tabIndex={-1} placeholder="—" />
                    </SvmsField>
                    <SvmsField label="City / Region" auto>
                      <input className="svms-i is-ro" value={auto(intlSel?.city)} readOnly tabIndex={-1} placeholder="—" />
                    </SvmsField>
                  </>
                ) : (
                  <>
                    <SvmsField label="State" auto>
                      <input className="svms-i is-ro" value={auto(domSel?.state)} readOnly tabIndex={-1} placeholder="—" />
                    </SvmsField>
                    <SvmsField label="GST State Code" auto>
                      <input className="svms-i is-ro" value={domSel ? (gstStateCode(domSel.state) || '—') : ''} readOnly tabIndex={-1} placeholder="—" />
                    </SvmsField>
                  </>
                )}
                <SvmsField label="Contact Person" auto>
                  <input className="svms-i is-ro" value={auto(intl ? intlSel?.contact : domSel?.contact)} readOnly tabIndex={-1} placeholder="—" />
                </SvmsField>
              </div>

              {intl ? (
                <>
                  <div className="svms-subhd">
                    {GLOBE}Price &amp; Currency
                    <span className="svms-nogst">No GST — overseas supplier</span>
                  </div>
                  <div className="svms-grid svms-grid--4">
                    <SvmsField label="Currency" required>
                      <div className="svms-select is-key">
                        <MasterSelect
                          value={currency}
                          options={SUPPLIER_CURRENCIES.map(c => ({ value: c, label: c }))}
                          placeholder="Select currency"
                          onChange={changeCurrency}
                        />
                      </div>
                    </SvmsField>
                    <SvmsField label={`Price (${currency})`} required error={errors.price}>
                      <input className="svms-i is-key" type="number" min={0} step={0.01} placeholder="Price in supplier currency"
                        value={price} onChange={e => { setPrice(e.target.value); setErrors(er => ({ ...er, price: undefined })); }} />
                    </SvmsField>
                    <SvmsField label={`Exchange Rate (₹ per ${currency})`} required error={errors.fx}>
                      <input className="svms-i is-key" type="number" min={0} step={0.0001}
                        value={fx} onChange={e => { setFx(e.target.value); setErrors(er => ({ ...er, fx: undefined })); }} />
                    </SvmsField>
                    <SvmsField label={`Total Amount (${currency})`} auto>
                      <input className="svms-i is-calc" readOnly tabIndex={-1} placeholder="Auto-computed"
                        value={price.trim() === '' ? '' : fmtCurrency(currency, priceNum)} />
                    </SvmsField>
                  </div>
                  {price.trim() !== '' && fxNum > 0 && (
                    <div className="svms-inr">≈ {money(+(priceNum * fxNum).toFixed(2))} at ₹{fxNum} / {currency}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="svms-subhd">₹ Price &amp; GST</div>
                  <div className="svms-grid svms-grid--4">
                    <SvmsField label="Price (₹)" required error={errors.price}>
                      <input className="svms-i is-key" type="number" min={0} step={0.01} placeholder="Enter service price"
                        value={price} onChange={e => { setPrice(e.target.value); setErrors(er => ({ ...er, price: undefined })); }} />
                    </SvmsField>
                    <SvmsField label="GST %" required>
                      <div className="svms-select is-key">
                        <MasterSelect
                          value={gst}
                          options={gstOpts}
                          placeholder="Select GST %"
                          onChange={setGst}
                        />
                      </div>
                    </SvmsField>
                    <SvmsField label="GST Amount (₹)" auto>
                      <input className="svms-i is-calc" value={price.trim() === '' ? '' : gstAmt.toFixed(2)} readOnly tabIndex={-1} placeholder="Auto-computed" />
                    </SvmsField>
                    <SvmsField label="Total Amount (₹)" auto>
                      <input className="svms-i is-calc" value={price.trim() === '' ? '' : domTotal.toFixed(2)} readOnly tabIndex={-1} placeholder="Auto-computed" />
                    </SvmsField>
                  </div>
                </>
              )}
            </div>

            <div className="svms-ft">
              <button type="button" className="svx-btn svx-btn--ghost svms-back" onClick={() => setStep('choose')}>
                <span className="svms-back__chev">{SVC_ICONS.chevron}</span> Back
              </button>
              <span className="svms-ft__sp" />
              <button type="button" className="svx-btn svx-btn--ghost" onClick={close}>Cancel</button>
              <button type="button" className="svx-btn svx-btn--primary" onClick={saveDraft}>
                {SVC_ICONS.check} Save
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {addScope !== null && createPortal((
        <Suspense fallback={null}>
          <AddVendorModal
            scope={addScope}
            canMapProducts={false}
            onClose={() => setAddScope(null)}
            onSubmit={(payload) => {
              const scope = addScope;
              setAddScope(null);
              if (scope === 'international') {
                toast.info('Supplier saved', 'International suppliers in this list are sample data until the supplier country API is connected.');
                return;
              }
              refreshVendors(String(payload.companyName ?? '').trim().toLowerCase());
            }}
          />
        </Suspense>
      ), document.body)}

      {editVendorId !== null && createPortal((
        <Suspense fallback={null}>
          <AddVendorModal
            vendorId={editVendorId}
            scope="domestic"
            canMapProducts={false}
            onClose={() => setEditVendorId(null)}
            onSubmit={() => {
              setEditVendorId(null);
              refreshVendors();
              toast.success('Supplier updated', 'The supplier details below are refreshed.');
            }}
          />
        </Suspense>
      ), document.body)}
    </>
  );
}

export default function ServiceSupplierModal({
  code, serviceName, suppliers, onClose, onChange, defaultGst,
}: {
  code: string;
  serviceName: string;
  defaultGst?: number;
  suppliers: MappedSupplier[];
  onClose: () => void;
  onChange: (next: MappedSupplier[]) => void;
}) {

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.apm-mv-backdrop')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal((
    <div className="svs-overlay svs-teal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="svs-modal" role="dialog" aria-modal="true" aria-label={`Map Service Suppliers · ${code}`}>
        <div className="svs-head">
          <div className="svs-head-ico">{SVC_ICONS.mapUser}</div>
          <div className="svs-head-txt">
            <div className="svs-title">Map Service Suppliers · {code}</div>
            <div className="svs-sub">{serviceName} — link domestic or international suppliers with their price.</div>
          </div>
          <button type="button" className="svs-close" onClick={onClose} aria-label="Close">{SVC_ICONS.x}</button>
        </div>
        <div className="svs-body">
          <SupplierMapPanel serviceName={serviceName} suppliers={suppliers} onChange={onChange} defaultGst={defaultGst} />
        </div>
        <div className="svs-foot">
          <span className="svs-note">{SVC_ICONS.info} Changes apply to <code>{code}</code></span>
          <div className="svs-foot-right">
            <button type="button" className="svs-btn svs-btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
