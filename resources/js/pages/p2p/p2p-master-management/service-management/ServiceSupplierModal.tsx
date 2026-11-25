import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../supplier-management/SupplierScopeGate';
import {
  GST_RATES, fmtCurrency, isIntl, makeIntlSupplier, makeSupplier,
  type MappedSupplier, type SupplierOrigin,
} from './serviceData';
import { loadServiceBundle, loadSupplierPool, type ApiServiceType, type BundleVendor, type ServiceBundle, type SupplierBucket } from './serviceApi';
import { SVC_ICONS } from './serviceIcons';
import { SavingLock, ShimSupplierRows } from './serviceLoading';
import { supplierTypeForBucket } from '../supplier-management/serviceMapping';
import '../product-management/product-management.css';
import './service-management.css';
import './service-suppliers.css';

const AddVendorModal = lazyPage(() => import('../supplier-management/AddVendorModal'));

const SUP_VISIBLE_ROWS = 4;

type VendorOpt = {
  id: string; code: string; name: string; type: string; state: string; contact: string;
  origin: SupplierOrigin; country: string; city: string; gstStateCode: string; currency: string;
  /** The service bucket this supplier's type serves — null when unclassified. */
  serviceType: ApiServiceType | null; classification: string | null;
};

type CurrencyOpt = { code: string; rate: number };

const toVendors = (list: BundleVendor[]): VendorOpt[] => list.map(v => ({
  id: String(v.id),
  code: String(v.vendor_code ?? ''),
  name: String(v.company_name ?? ''),
  type: String(v.supplier_type ?? ''),
  state: String(v.state ?? ''),
  contact: String(v.contact_person ?? ''),
  serviceType: (v.supplier_service_type ?? null) as ApiServiceType | null,
  classification: v.supplier_classification ?? null,
  origin: v.origin === 'international' ? 'international' : 'domestic',
  country: String(v.country ?? ''),
  city: String(v.city ?? ''),
  gstStateCode: String(v.gst_state_code ?? ''),
  currency: String(v.currency ?? ''),
}));

const toCurrencies = (b: ServiceBundle): CurrencyOpt[] => (b.currencies ?? [])
  .map(c => ({ code: String(c.code).toUpperCase(), rate: Number(c.exchange_rate) || 0 }))
  .filter(c => c.code && c.code !== 'INR');

export const formatSupplierCode = (raw: string): string => {
  const m = String(raw ?? '').match(/(\d+)\s*$/);
  return m ? `S-${m[1].padStart(3, '0')}` : String(raw ?? '');
};

/* Same caps as the API (SupplierPricing::MAX_PRICE / MAX_RATE). */
const MAX_PRICE = 9999999999.99;
const MAX_RATE = 99999.9999;

const money = (n: number) => `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Keyed by the service bucket: mapping a Trackable service must not reuse the
   pool fetched for a Utility one. '' is the unfiltered pool. */
const vendorCaches = new Map<string, VendorOpt[]>();
let currencyCache: CurrencyOpt[] = [];
const bucketKey = (b?: SupplierBucket | null) => (b ? `${b.service_type}:${b.classification ?? ''}` : '');

async function loadVendors(bucket?: SupplierBucket | null, force = false): Promise<VendorOpt[]> {
  const key = bucketKey(bucket);
  const hit = vendorCaches.get(key);
  if (hit && !force) return hit;
  const [b, pool] = await Promise.all([loadServiceBundle(force), loadSupplierPool(bucket)]);
  const list = toVendors(pool);
  vendorCaches.set(key, list);
  currencyCache = toCurrencies(b);
  return list;
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
  serviceName, suppliers, onChange, defaultGst, loading = false, bucket = null,
}: {
  serviceName: string;
  suppliers: MappedSupplier[];
  onChange: (next: MappedSupplier[]) => void;
  loading?: boolean;
  defaultGst?: number;
  /** The service's own type — the dropdown lists only suppliers that serve it. */
  bucket?: SupplierBucket | null;
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

  const bKey = bucketKey(bucket);
  const [vendors, setVendors] = useState<VendorOpt[]>(vendorCaches.get(bKey) ?? []);
  const [vendorsLoading, setVendorsLoading] = useState(!vendorCaches.has(bKey));
  useEffect(() => {
    let live = true;
    setVendorsLoading(!vendorCaches.has(bKey));
    loadVendors(bucket)
      .then(v => { if (live) { setVendors(v); setCurrencies(currencyCache); } })
      .catch(() => { if (live) toast.error('Could not load suppliers', 'Please refresh and try again.'); })
      .finally(() => { if (live) setVendorsLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, bKey]);

  const [supPage, setSupPage] = useState(1);
  const [supPageSize, setSupPageSize] = useState(10);
  const supPages = Math.max(1, Math.ceil(suppliers.length / supPageSize));
  const supPageSafe = Math.min(supPage, supPages);
  const supStart = (supPageSafe - 1) * supPageSize;
  const pageSuppliers = suppliers.slice(supStart, supStart + supPageSize);
  const overflow = pageSuppliers.length > SUP_VISIBLE_ROWS;

  const [step, setStep] = useState<'closed' | 'choose' | 'form'>('closed');
  const [origin, setOrigin] = useState<SupplierOrigin>('domestic');
  const intl = origin === 'international';
  const [selCode, setSelCode] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState(gstDefault);
  const [currency, setCurrency] = useState('USD');
  const [currencies, setCurrencies] = useState<CurrencyOpt[]>(currencyCache);
  const rateOf = (c: string) => currencies.find(x => x.code === c)?.rate ?? 0;
  const [fx, setFx] = useState('');
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
    () => vendors.filter(v => v.origin === 'domestic' && v.code && !mappedDom.has(formatSupplierCode(v.code))),
    [vendors, mappedDom],
  );
  const intlPool = useMemo(
    () => vendors.filter(v => v.origin === 'international' && v.code && !mappedIntl.has(formatSupplierCode(v.code))),
    [vendors, mappedIntl],
  );

  const toOpt = (v: VendorOpt, withCountry: boolean) => ({
    value: v.code,
    label: `${formatSupplierCode(v.code)}: ${v.name}${withCountry ? ` · ${v.country}` : ''}`,
  });
  const pickOpts = intl ? intlPool.map(v => toOpt(v, true)) : domPool.map(v => toOpt(v, false));

  const domSel = !intl ? domPool.find(v => v.code === selCode) ?? null : null;
  const intlSel = intl ? intlPool.find(v => v.code === selCode) ?? null : null;
  const selVendor = domSel ?? intlSel;
  const editableId = selVendor && /^\d+$/.test(selVendor.id) ? Number(selVendor.id) : null;

  /* The supplier wizard saves each stage as it goes, so a supplier can change
     even when the wizard is closed with Cancel. Every bucket's cached list is
     dropped, since an edit (name, type) can move a supplier between buckets. */
  const refreshVendors = (selectName?: string) => {
    vendorCaches.clear();
    setVendorsLoading(true);
    loadVendors(bucket, true)
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
    setSelCode(''); setPrice(''); setGst(gstDefault); setCurrency(currencies[0]?.code ?? 'USD'); setFx(currencies[0] ? String(currencies[0].rate) : ''); setErrors({});
  };
  const openChooser = () => { resetForm(); setStep('choose'); };
  const pickOrigin = (o: SupplierOrigin) => { resetForm(); setOrigin(o); setStep('form'); };
  const close = () => setStep('closed');

  const changeCurrency = (c: string) => {
    setCurrency(c);
    setFx(rateOf(c) ? String(rateOf(c)) : '');
    setErrors(e => ({ ...e, fx: undefined }));
  };

  const saveDraft = () => {
    const errs: typeof errors = {};
    if (!selCode) errs.supplier = 'This field is required';
    if (!(priceNum > 0)) errs.price = price.trim() === '' ? 'This field is required' : 'Price must be greater than 0';
    else if (priceNum > MAX_PRICE) errs.price = 'Price is too large (max 9,99,99,99,999.99)';
    if (intl && !(fxNum > 0)) errs.fx = fx.trim() === '' ? 'This field is required' : 'Exchange rate must be greater than 0';
    else if (intl && fxNum > MAX_RATE) errs.fx = 'Exchange rate is too large (max 99,999.9999)';
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
        origin: 'domestic', country: 'India', gstStateCode: domSel.gstStateCode || undefined,
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
          {!loading && suppliers.length > 0 && <span className="svs-card-count">{suppliers.length}</span>}
          <button type="button" className="svs-btn svs-btn--primary svs-card-act" onClick={openChooser} disabled={loading}>
            {SVC_ICONS.plus} Map Supplier
          </button>
        </div>

        {loading ? (
          <ShimSupplierRows />
        ) : suppliers.length === 0 ? (
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
                  <th>Sr. No</th><th className="is-l">Supplier</th><th className="is-l">Supplier Type</th><th>Supplier Origin</th>
                  <th className="is-l">State / Country</th><th className="is-l">Contact Person</th><th className="is-r">Price</th>
                  <th>GST (%)</th><th className="is-r">GST Value</th><th className="is-r">Total Service Cost</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageSuppliers.map((s, k) => {
                  const i = supStart + k;
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
                      <td className="is-l">{s.type && s.type !== '—' ? <span className="svs-pill">{s.type}</span> : <span className="svms-dash">—</span>}</td>
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
            <WorklistPager
              className="wl-teal svs-pager"
              total={suppliers.length}
              page={supPageSafe}
              pageSize={supPageSize}
              onPage={setSupPage}
              onPageSize={(n) => { setSupPageSize(n); setSupPage(1); }}
              pageSizeOptions={[10, 25, 50]}
            />
          </div>
        )}
      </div>

      {step === 'choose' && createPortal((
        <div className="apm-mv-backdrop svms-ov">
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
                <OriginCard origin="international" available={vendorsLoading ? 0 : intlPool.length} onPick={() => pickOrigin('international')} />
              </div>
            </div>
            <div className="svms-ft">
              <button type="button" className="svx-btn svx-btn--ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {step === 'form' && createPortal((
        <div className="apm-mv-backdrop svms-ov">
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
                      menuClassName="svf-select-menu"
                      value={selCode}
                      options={pickOpts}
                      placeholder="Select Supplier Name"
                      searchable
                      searchPlaceholder={intl ? 'Search supplier code, name or country' : 'Search supplier code or name'}
                      loading={vendorsLoading}
                      emptyText={bucket
                        ? 'No suppliers of this service type — add one, or set its Supplier Type.'
                        : 'No suppliers available'}
                      invalid={!!errors.supplier}
                      onChange={(v) => { setSelCode(v); setErrors(e => ({ ...e, supplier: undefined })); }}
                    />
                  </div>
                  {selCode && (
                    <Tooltip label="Edit the selected supplier">
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
                      <input className="svms-i is-ro" value={domSel ? (domSel.gstStateCode || '—') : ''} readOnly tabIndex={-1} placeholder="—" />
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
                          menuClassName="svf-select-menu"
                          value={currency}
                          options={currencies.map(c => ({ value: c.code, label: c.code }))}
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
                    {defaultGst != null ? (
                      <SvmsField label="GST %" auto>
                        <input className="svms-i is-calc" value={`${defaultGst}%`} readOnly tabIndex={-1}
                          title="GST % comes from the GST mapped on this service" />
                      </SvmsField>
                    ) : (
                      <SvmsField label="GST %" required>
                        <div className="svms-select is-key">
                          <MasterSelect
                            menuClassName="svf-select-menu"
                            value={gst}
                            options={gstOpts}
                            placeholder="Select GST %"
                            onChange={setGst}
                          />
                        </div>
                      </SvmsField>
                    )}
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
            initialSupplierType={bucket ? supplierTypeForBucket(bucket.service_type, bucket.classification) : null}
            onClose={() => { setAddScope(null); refreshVendors(); }}
            onSubmit={(payload) => {
              setAddScope(null);
              refreshVendors(String(payload.companyName ?? '').trim().toLowerCase());
            }}
          />
        </Suspense>
      ), document.body)}

      {editVendorId !== null && createPortal((
        <Suspense fallback={null}>
          <AddVendorModal
            vendorId={editVendorId}
            scope={origin}
            canMapProducts={false}
            onClose={() => { setEditVendorId(null); refreshVendors(); }}
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
  code, serviceName, suppliers, onClose, onChange, defaultGst, loading = false, busy = false, bucket = null,
}: {
  code: string;
  serviceName: string;
  defaultGst?: number;
  loading?: boolean;
  busy?: boolean;
  suppliers: MappedSupplier[];
  onClose: () => void;
  onChange: (next: MappedSupplier[]) => void;
  /** The row's own service type — passed straight to the supplier dropdown. */
  bucket?: SupplierBucket | null;
}) {

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.apm-mv-backdrop')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal((
    <div className="svs-overlay svs-teal">
      <div className="svs-modal" role="dialog" aria-modal="true" aria-label={`Map Service Suppliers · ${code}`}>
        {busy && <SavingLock label="Saving suppliers…" />}
        <div className="svs-head">
          <div className="svs-head-ico">{SVC_ICONS.mapUser}</div>
          <div className="svs-head-txt">
            <div className="svs-title">Map Service Suppliers · {code}</div>
            <div className="svs-sub">{serviceName} — link domestic or international suppliers with their price.</div>
          </div>
          <button type="button" className="svs-close" onClick={onClose} aria-label="Close">{SVC_ICONS.x}</button>
        </div>
        <div className="svs-body">
          <SupplierMapPanel serviceName={serviceName} suppliers={suppliers} onChange={onChange} defaultGst={defaultGst} loading={loading} bucket={bucket} />
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
