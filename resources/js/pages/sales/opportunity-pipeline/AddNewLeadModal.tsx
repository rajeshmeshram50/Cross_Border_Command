import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect, MasterFormStyles } from '../../master/masterFormKit';


export type LeadFormValues = {
  customerName: string;
  mobileNumber: string;
  customerEmail: string;
  companyName: string;
  customerAddress: string;
  customerCity: string;
  pincode: string;
  country: string;
  state: string;
};

const EMPTY_LEAD: LeadFormValues = {
  customerName: '',
  mobileNumber: '',
  customerEmail: '',
  companyName: '',
  customerAddress: '',
  customerCity: '',
  pincode: '',
  country: '',
  state: '',
};

type CustomerOption = {
  id: string;
  dbId: number;
  company: string;
  legalName: string;
  country: string;
};

const COUNTRY_OPTIONS = ['India', 'United States', 'United Kingdom', 'Australia', 'Italy', 'Pakistan', 'China', 'Saudi Arabia', 'Nigeria'];
const STATE_BY_COUNTRY: Record<string, string[]> = {
  India:           ['Maharashtra', 'Gujarat', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Uttar Pradesh', 'West Bengal'],
  'United States': ['California', 'Texas', 'New York', 'Florida'],
  'United Kingdom':['England', 'Scotland', 'Wales', 'Northern Ireland'],
  Australia:       ['New South Wales', 'Victoria', 'Queensland', 'Western Australia'],
  Italy:           ['Lombardy', 'Lazio', 'Sicily', 'Veneto'],
  Pakistan:        ['Sindh', 'Punjab', 'Balochistan', 'KPK'],
  China:           ['Guangdong', 'Shanghai', 'Beijing', 'Zhejiang'],
  'Saudi Arabia':  ['Riyadh', 'Makkah', 'Eastern', 'Madinah'],
  Nigeria:         ['Lagos', 'Abuja', 'Kano', 'Rivers'],
};

const digitsOnly = (raw: string): string => (raw ?? '').replace(/\D/g, '').slice(0, 15);

const isDomesticCountry = (country?: string) => (country ?? '').trim() === 'India';
const PIN_DOMESTIC_RE = /^[0-9]{6}$/;
const ZIP_INTL_RE = /^[A-Za-z0-9\s\-]+$/;

const pinLabel = (country?: string) => (isDomesticCountry(country) ? 'PIN Code' : 'Zip Code');
const pinMaxLen = (country?: string) => (isDomesticCountry(country) ? 6 : 12);
const pinPlaceholder = (country?: string) =>
  isDomesticCountry(country) ? '6-digit PIN' : 'Enter zip code';

const pinSanitize = (v: string, country?: string) =>
  isDomesticCountry(country)
    ? (v ?? '').replace(/\D/g, '').slice(0, 6)
    : (v ?? '').replace(/[^A-Za-z0-9\s\-]/g, '').slice(0, 12);

function pinError(v: string, country?: string): string | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  if (isDomesticCountry(country)) {
    return PIN_DOMESTIC_RE.test(s) ? undefined : 'PIN Code must be exactly 6 digits';
  }
  if (s.length < 3)  return 'Zip Code must be at least 3 characters';
  if (s.length > 12) return 'Zip Code must be 12 characters or fewer';
  return ZIP_INTL_RE.test(s)
    ? undefined
    : 'Zip Code can contain only letters, digits, spaces and hyphens';
}

export default function AddNewLeadModal(props: {
  open: boolean;
  onClose: () => void;
  onSave: (lead: LeadFormValues, pickedCustomerDbId?: number | null) => void | Promise<void>;
}) {
  const { open, onClose, onSave } = props;
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  const [useExisting, setUseExisting] = useState(false);
  const [values, setValues] = useState<LeadFormValues>(EMPTY_LEAD);
  const [pickedCustomerId, setPickedCustomerId] = useState<string>('');
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  const [customerOpts, setCustomerOpts] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerFetching, setCustomerFetching] = useState(false);

  const [masterCountries, setMasterCountries] = useState<Array<{ id: number; name: string }>>([]);
  const [masterStates, setMasterStates] = useState<Array<{ id: number; name: string; country_id: number }>>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .get<{ countries?: any[]; states?: any[] }>('/customers/master-bundle')
      .then(r => {
        if (!alive) return;
        const cs = (r.data?.countries ?? [])
          .map((c: any) => ({ id: Number(c.id), name: String(c.name ?? '').trim() }))
          .filter((c: { name: string }) => c.name);
        const st = (r.data?.states ?? [])
          .map((s: any) => ({ id: Number(s.id), name: String(s.name ?? '').trim(), country_id: Number(s.country_id ?? 0) }))
          .filter((s: { name: string }) => s.name);
        setMasterCountries(cs);
        setMasterStates(st);
      })
      .catch(() => {  });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) { setCustomerOpts([]); return; }
    setCustomersLoading(true);
    api
      .get<{ data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>('/customers', { params: { tab: 'all' } })
      .then(r => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        const opts: CustomerOption[] = rows
          .map(c => ({
            id:        String((c as Record<string, unknown>).id ?? ''),
            dbId:      Number((c as Record<string, unknown>).db_id ?? (c as Record<string, unknown>).id_pk ?? 0),
            company:   String((c as Record<string, unknown>).company ?? (c as Record<string, unknown>).company_name ?? ''),
            legalName: String((c as Record<string, unknown>).legal_name ?? (c as Record<string, unknown>).legalName ?? (c as Record<string, unknown>).legal ?? ''),
            country:   String((c as Record<string, unknown>).country ?? (c as Record<string, unknown>).country_iso ?? (c as Record<string, unknown>).country_name ?? ''),
          }))
          .filter(c => c.dbId > 0 && c.company);
        setCustomerOpts(opts);
      })
      .catch(() => {
        toast.error('Failed to load customers', 'Could not reach the Customer API');
        setCustomerOpts([]);
      })
      .finally(() => setCustomersLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      setUseExisting(false);
      setValues(EMPTY_LEAD);
      setPickedCustomerId('');
      setErrors({});
      setSaving(false);
    }
  }, [open]);

  const set = <K extends keyof LeadFormValues>(key: K, v: LeadFormValues[K]) => {
    setValues(prev => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const onPickExisting = async (publicId: string) => {
    setPickedCustomerId(publicId);
    if (!publicId) return;
    const picked = customerOpts.find(c => c.id === publicId);
    if (!picked) return;
    setCustomerFetching(true);
    try {
      const res = await api.get<{ data?: Record<string, unknown> } | Record<string, unknown>>(`/customers/${picked.dbId}`);
      const raw = (res.data as { data?: Record<string, unknown> }).data ?? (res.data as Record<string, unknown>);
      const pa = (raw.primary_address as Record<string, unknown> | undefined) ?? null;
      setValues({
        customerName:    String(raw.company || picked.company || raw.legalName || picked.legalName || ''),
        mobileNumber:    String(pa?.cp_contact ?? raw.phone ?? ''),
        customerEmail:   String(pa?.cp_email   ?? raw.email ?? '').toLowerCase(),
        companyName:     String(raw.legalName || picked.legalName || raw.company || picked.company || ''),
        customerAddress: String(pa?.address_line ?? raw.addr ?? ''),
        customerCity:    String(pa?.city ?? raw.city ?? ''),
        pincode:         String(pa?.pin  ?? raw.pin  ?? ''),
        country:         String(pa?.country ?? raw.country ?? ''),
        state:           String(pa?.state   ?? raw.state   ?? ''),
      });
      setErrors({});
    } catch {
      toast.error('Failed to load customer', `Could not fetch ${picked.company}`);
    } finally {
      setCustomerFetching(false);
    }
  };

  const toggleUseExisting = (next: boolean) => {
    setUseExisting(next);
    setValues(EMPTY_LEAD);
    setPickedCustomerId('');
    setErrors({});
  };

  const countryOpts = useMemo(() => {
    const list = masterCountries.length ? masterCountries.map(c => c.name) : [...COUNTRY_OPTIONS];
    if (values.country && !list.includes(values.country)) list.unshift(values.country);
    return list;
  }, [values.country, masterCountries]);

  const stateOpts = useMemo(() => {
    let base: string[];
    if (masterStates.length && masterCountries.length) {
      const c = masterCountries.find(x => x.name === values.country);
      base = c ? masterStates.filter(s => s.country_id === c.id).map(s => s.name) : [];
    } else {
      base = STATE_BY_COUNTRY[values.country] ?? [];
    }
    const list = [...base];
    if (values.state && !list.includes(values.state)) list.unshift(values.state);
    return list;
  }, [values.country, values.state, masterCountries, masterStates]);

  const isIndiaMobile = (values.country ?? '').trim().toLowerCase() === 'india';
  useEffect(() => {
    if (!isIndiaMobile) return;
    setValues(v => (/\D/.test(v.mobileNumber) || v.mobileNumber.length > 10)
      ? { ...v, mobileNumber: v.mobileNumber.replace(/\D/g, '').slice(0, 10) } : v);
  }, [isIndiaMobile]);

  const validate = (): boolean => {
    const next: Partial<Record<keyof LeadFormValues, string>> = {};
    if (!values.customerName.trim())  next.customerName  = 'Customer Name is required';
    if (!values.mobileNumber.trim())  next.mobileNumber  = 'Mobile Number is required';
    else if (isIndiaMobile) { if (!/^\d{10}$/.test(values.mobileNumber)) next.mobileNumber = 'Enter a valid 10-digit mobile number'; }
    else if (values.mobileNumber.length < 6 || values.mobileNumber.length > 15) next.mobileNumber = 'Mobile Number must be 6 to 15 digits';
    if (!values.customerEmail.trim()) next.customerEmail = 'Customer Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customerEmail.trim())) next.customerEmail = 'Enter a valid email';
    if (!values.customerCity.trim())  next.customerCity  = 'City is required';
    if (!values.country.trim())       next.country       = 'Country is required';
    if (!values.state.trim())         next.state         = 'State is required';
    const pinMsg = pinError(values.pincode, values.country);
    if (pinMsg)                       next.pincode       = pinMsg;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!validate()) {
      toast.error('Missing details', 'Please complete the highlighted fields');
      return;
    }
    const pickedDbId = useExisting && pickedCustomerId
      ? customerOpts.find(c => c.id === pickedCustomerId)?.dbId ?? null
      : null;
    setSaving(true);
    try {
      await onSave(values, pickedDbId);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const lockCustomer = useExisting;

  const customerBusy = useExisting && (customersLoading || customerFetching);

  return createPortal((
    <div className="anl-backdrop master-modal">
      <style>{SCOPED_CSS}</style>
      <MasterFormStyles />
      <div className="anl-modal" onClick={(e) => e.stopPropagation()}>
        {saving && (
          <div className="busy-veil anl-saving-veil" role="status" aria-live="polite">
            <span className="busy-veil-spinner" />
            <span className="busy-veil-label">Saving lead…</span>
          </div>
        )}
        <div className="anl-head">
          <div className="anl-head-left">
            <div className="anl-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <div className="anl-head-title">Add New Lead</div>
              <div className="anl-head-sub">Complete the form below to register a new sales lead</div>
            </div>
          </div>
          <button className="anl-close" onClick={onClose} disabled={saving} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="anl-body" inert={saving}>
          <label className="anl-existing-toggle">
            <input
              type="checkbox"
              checked={useExisting}
              onChange={(e) => toggleUseExisting(e.target.checked)}
            />
            <span className="anl-existing-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span>
              <span className="anl-existing-title">Take customer from existing sales database</span>
              <span className="anl-existing-sub">Auto-fill customer details from your sales records</span>
            </span>
          </label>


          <div className={`anl-fill-zone${customerFetching ? ' is-loading' : ''}`}>
            {customerFetching && (
              <div className="anl-fill-overlay" role="status" aria-live="polite">
                <span className="anl-fill-spinner" aria-hidden="true" />
                <span>Loading customer details…</span>
              </div>
            )}
            <div className="anl-section-label">
              <span className="anl-section-icon">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              Customer Information
            </div>
            <div className="anl-grid-3">
              <Field label="Customer Name" required error={errors.customerName}>
                {useExisting ? (
                  <div className="master-field">
                    <i className="ri-user-line master-field-icon" />
                    <MasterSelect
                      value={pickedCustomerId}
                      fitWidth
                      onChange={(v) => { void onPickExisting(v); }}
                      placeholder={customersLoading ? 'Loading customers…' : 'Select a customer'}
                      options={customerOpts.map(c => {
                        const cy = c.country.trim().toLowerCase();
                        const badge = !cy ? undefined
                          : (cy === 'india' || cy === 'in')
                            ? { text: 'Dom', tone: 'green' as const, title: 'India — domestic' }
                            : { text: 'Int', tone: 'violet' as const, title: `${c.country} — international` };
                        return { value: c.id, label: `${c.id} — ${c.company || c.legalName}`, badge };
                      })}
                      disabled={customersLoading || customerFetching}
                    />
                  </div>
                ) : (
                  <TextInput
                    value={values.customerName}
                    onChange={(v) => set('customerName', v)}
                    placeholder="e.g. GreenHarvest Global"
                    iconLeft="ri-user-line"
                    error={!!errors.customerName}
                  />
                )}
              </Field>
              <Field label="Mobile Number" required error={errors.mobileNumber}>
                <TextInput
                  value={values.mobileNumber}
                  onChange={(v) => set('mobileNumber', isIndiaMobile ? digitsOnly(v).slice(0, 10) : digitsOnly(v))}
                  placeholder={isIndiaMobile ? '10-digit mobile' : '10-15 digit number'}
                  iconLeft={isIndiaMobile ? undefined : 'ri-smartphone-line'}
                  prefix={isIndiaMobile ? '+91' : undefined}
                  inputMode="numeric"
                  maxLength={isIndiaMobile ? 10 : 15}
                  error={!!errors.mobileNumber}
                  disabled={lockCustomer}
                />
              </Field>
              <Field label="Customer Email" required error={errors.customerEmail}>
                <TextInput
                  value={values.customerEmail}
                  onChange={(v) => set('customerEmail', v.toLowerCase())}
                  placeholder="Enter email address"
                  iconLeft="ri-mail-line"
                  error={!!errors.customerEmail}
                  disabled={lockCustomer}
                />
              </Field>
              <Field label="Company Name">
                <TextInput
                  value={values.companyName}
                  onChange={(v) => set('companyName', v)}
                  placeholder="Enter company name"
                  iconLeft="ri-briefcase-line"
                  disabled={lockCustomer}
                />
              </Field>
              <div className="anl-col-span-2">
                <Field label="Customer Address">
                  <TextInput
                    value={values.customerAddress}
                    onChange={(v) => set('customerAddress', v)}
                    placeholder="Enter complete address"
                    iconLeft="ri-map-pin-line"
                    disabled={lockCustomer}
                  />
                </Field>
              </div>
            </div>

            <div className="anl-section-label">
              <span className="anl-section-icon">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              Location Details
            </div>
            <div className="anl-grid-4">
              <Field label="Customer City" required error={errors.customerCity}>
                <TextInput
                  value={values.customerCity}
                  onChange={(v) => set('customerCity', v)}
                  placeholder="Enter city"
                  iconLeft="ri-building-2-line"
                  error={!!errors.customerCity}
                  disabled={lockCustomer}
                />
              </Field>
              <Field label="Country" required error={errors.country}>
                <div className="master-field">
                  <i className="ri-earth-line master-field-icon" />
                  <MasterSelect
                    value={values.country}
                    onChange={(v) => {
                      setValues(prev => ({ ...prev, country: v, state: '' }));
                      setErrors(prev => {
                        const n = { ...prev }; delete n.country; delete n.state;
                        const pinMsg = pinError(values.pincode, v);
                        if (pinMsg) n.pincode = pinMsg; else delete n.pincode;
                        return n;
                      });
                    }}
                    placeholder="Select country"
                    options={countryOpts.map(c => ({ value: c, label: c }))}
                    invalid={!!errors.country}
                    disabled={lockCustomer}
                  />
                </div>
              </Field>
              <Field label="State" required error={errors.state}>
                <div className="master-field">
                  <i className="ri-map-2-line master-field-icon" />
                  <MasterSelect
                    value={values.state}
                    onChange={(v) => set('state', v)}
                    placeholder={values.country ? 'Select state' : 'Select country first'}
                    options={stateOpts.map(s => ({ value: s, label: s }))}
                    disabled={lockCustomer || !values.country}
                    invalid={!!errors.state}
                  />
                </div>
              </Field>
              <Field label={pinLabel(values.country)} error={errors.pincode}>
                <TextInput
                  value={values.pincode}
                  onChange={(v) => set('pincode', pinSanitize(v, values.country))}
                  placeholder={pinPlaceholder(values.country)}
                  inputMode={isDomesticCountry(values.country) ? 'numeric' : 'text'}
                  maxLength={pinMaxLen(values.country)}
                  disabled={lockCustomer}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="anl-foot">
          <div className="anl-foot-hint">
            <span className="anl-req-dot" />
            <span>Fields marked with <span className="anl-req">*</span> are required</span>
          </div>
          <div className="anl-foot-actions">
            <button className="anl-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              className="anl-btn-primary"
              onClick={handleSave}
              disabled={saving || customerBusy}
              title={customerBusy ? 'Loading customer details…' : undefined}
            >
              {saving ? (
                <>
                  <span className="anl-spinner" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save Lead
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}


function Field(props: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className={`anl-field ${props.error ? 'has-error' : ''}`}>
      <label className="anl-label">
        {props.label}
        {props.required && <span className="anl-req"> *</span>}
      </label>
      {props.children}
      {props.error && <span className="anl-field-error">{props.error}</span>}
    </div>
  );
}

function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  iconLeft?: string;
  prefix?: string;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  error?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`anl-input-wrap ${props.iconLeft ? 'has-icon' : ''} ${props.prefix ? 'has-prefix' : ''} ${props.error ? 'has-error' : ''}`}>
      {props.iconLeft && <i className={`${props.iconLeft} anl-input-icon`} />}
      {props.prefix && <span className="anl-input-prefix">{props.prefix}</span>}
      <input
        type="text"
        className="anl-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        disabled={props.disabled}
      />
    </div>
  );
}

const SCOPED_CSS = `
.anl-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 36px 20px;
  overflow-y: auto;
  font-family: var(--font-sans);
}
.anl-modal {
  width: 100%; max-width: 820px;
  margin: auto;
  position: relative;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
  max-height: calc(100vh - 72px);
}
.anl-modal *, .anl-modal *::before, .anl-modal *::after { box-sizing: border-box; }
.anl-saving-veil {
  z-index: 20;
  border-radius: 20px;
  backdrop-filter: blur(2.5px);
  -webkit-backdrop-filter: blur(2.5px);
}
[data-bs-theme="dark"] .anl-saving-veil { background: rgba(6, 22, 33, .55); }

.anl-head {
  position: relative;
  padding: 16px 22px;
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 60%, #06b6d4 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  overflow: hidden;
}
.anl-head::before {
  content: '';
  position: absolute;
  right: -40px; top: -40px;
  width: 160px; height: 160px; border-radius: 50%;
  background: rgba(255,255,255,.06);
  pointer-events: none;
}
.anl-head::after {
  content: '';
  position: absolute;
  right: 80px; bottom: -50px;
  width: 120px; height: 120px; border-radius: 50%;
  background: rgba(255,255,255,.04);
  pointer-events: none;
}
.anl-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; position: relative; z-index: 1; }
.anl-head-icon {
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.anl-head-title { font-size: 15px; font-weight: 700; letter-spacing: -0.2px; }
.anl-head-sub   { font-size: 11px; font-weight: 500; color: rgba(255,255,255,.85); margin-top: 2px; }
.anl-close {
  box-sizing: border-box; width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
  position: relative; z-index: 1;
}
.anl-close:hover:not(:disabled) { background: rgba(255,255,255,.22); transform: rotate(90deg); }
.anl-close:disabled { opacity: .45; cursor: not-allowed; transform: none; }

.anl-body {
  padding: 16px 22px 18px;
  display: flex; flex-direction: column; gap: 14px;
  background: linear-gradient(180deg, #f0fdff 0%, #ffffff 100%);
  overflow-y: auto;
}
.anl-body[inert] { opacity: .6; cursor: wait; user-select: none; }

.anl-fill-zone { position: relative; display: flex; flex-direction: column; gap: 14px; }
.anl-fill-zone.is-loading > *:not(.anl-fill-overlay) {
  opacity: .4; pointer-events: none; user-select: none;
}
.anl-fill-overlay {
  position: absolute; inset: -6px -10px; z-index: 5;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.66);
  font-size: 12.5px; font-weight: 700; letter-spacing: .2px; color: #0e7490;
  cursor: wait;
}
.anl-fill-spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(8, 145, 178, 0.22);
  border-top-color: #0891b2;
  border-radius: 50%;
  animation: anl-spin 0.6s linear infinite;
}

.anl-existing-toggle {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px;
  border: 1.5px solid #0e7490 ;
  border-radius: 11px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.anl-existing-toggle:hover { border-color: #0e7490 ; background: #f8fdff; }
.anl-existing-toggle input[type="checkbox"] {
  width: 15px; height: 15px;
  accent-color: #0891b2;
  cursor: pointer; flex-shrink: 0;
}
.anl-existing-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: #cffafe; color: #0891b2;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.anl-existing-title {
  display: block;
  font-size: 12px; font-weight: 700; color: #155e75;
  letter-spacing: -0.01em;
}
.anl-existing-sub {
  display: block;
  font-size: 10px; color: #475569; font-weight: 400;
  margin-top: 1px;
}

.anl-section-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 9.5px; font-weight: 800;
  color: #0891b2;
  text-transform: uppercase; letter-spacing: 0.12em;
  margin-top: 2px; margin-bottom: -4px;
}
.anl-section-icon {
  width: 20px; height: 20px; border-radius: 6px;
  background: #cffafe; color: #0891b2;
  display: inline-flex; align-items: center; justify-content: center;
}

.anl-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.anl-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.anl-col-span-2 { grid-column: span 2; }

@media (max-width: 900px) {
  .anl-grid-3, .anl-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .anl-col-span-2 { grid-column: span 2; }
}
@media (max-width: 560px) {
  .anl-grid-3, .anl-grid-4 { grid-template-columns: 1fr; }
  .anl-col-span-2 { grid-column: span 1; }
}

.anl-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.anl-label {
  font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #0e7490;
  margin-bottom: 4px;
}
.anl-req { color: #f06548; font-weight: 600; }
.anl-field-error {
  font-size: 11px; color: #ef4444; font-weight: 500;
  margin-top: 2px;
}

.anl-input-wrap {
  position: relative;
  width: 100%;
}
.anl-input {
  width: 100%; height: 34px;
  padding: 8px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 9px;
  background: #fff;
  color: #0f172a;
  font-family: inherit; font-size: 12px; font-weight: 500;
  outline: none;
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
}
.anl-input::placeholder { color: #94a3b8; opacity: 0.85; font-weight: 400; }
.anl-input:hover { border-color: #cbd5e1; }
.anl-input:focus {
  background: #fff;
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8,145,178,0.15);
}
.anl-input:disabled {
  background: #f1f5f9; color: #94a3b8; cursor: not-allowed;
}
.anl-input-wrap.has-icon .anl-input { padding-left: 30px; }
.anl-input-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  font-size: 13px; color: #94a3b8; pointer-events: none;
  transition: color .18s ease;
}
.anl-input-wrap:focus-within .anl-input-icon { color: #0891b2; }
.anl-input-prefix {
  position: absolute; left: 1.5px; top: 1.5px; bottom: 1.5px;
  display: flex; align-items: center; padding: 0 9px;
  font-size: 12px; font-weight: 700; color: #0f172a;
  background: #f1f5f9; border-right: 1.5px solid #e2e8f0;
  border-radius: 8px 0 0 8px; pointer-events: none;
}
.anl-input-wrap.has-prefix .anl-input { padding-left: 48px; }
[data-bs-theme="dark"] .anl-input-prefix { background: transparent; color: #cffafe; border-right-color: rgba(34, 211, 238, 0.22); }

.anl-input-wrap.has-error .anl-input {
  border-color: #ef4444;
  background: #fef2f2;
}
.anl-input-wrap.has-error .anl-input:focus {
  box-shadow: 0 0 0 3px rgba(239,68,68,0.15);
}
.anl-field.has-error .anl-label { color: #ef4444; }

.anl-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #cffafe;
}
.anl-foot-hint {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: #64748b; font-weight: 400;
}
.anl-req-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #fecaca; border: 1.5px solid #f87171;
  display: inline-block;
}
.anl-foot-actions { display: flex; align-items: center; gap: 8px; }
.anl-btn-ghost, .anl-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  box-sizing: border-box; height: 40px; padding: 0 18px;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  border-radius: 10px;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s, box-shadow .15s;
}
.anl-btn-ghost {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
}
.anl-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.anl-btn-primary {
  border: none;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
  box-shadow: 0 4px 12px rgba(8, 145, 178, 0.30);
}
.anl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(8, 145, 178, 0.40); }
.anl-btn-ghost:disabled, .anl-btn-primary:disabled {
  opacity: 0.65; cursor: not-allowed; transform: none; box-shadow: none;
}
.anl-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.45);
  border-top-color: #fff;
  border-radius: 50%;
  display: inline-block;
  animation: anl-spin 0.6s linear infinite;
}
@keyframes anl-spin { to { transform: rotate(360deg); } }

[data-bs-theme="dark"] .anl-modal { background: #0c1f2e; color: #cffafe; box-shadow: 0 30px 80px rgba(0,0,0,0.75); }
[data-bs-theme="dark"] .anl-body  { background: linear-gradient(180deg, #0e2940 0%, #0c1f2e 100%); }
[data-bs-theme="dark"] .anl-fill-overlay { background: rgba(12, 31, 46, 0.72); color: #67e8f9; }
[data-bs-theme="dark"] .anl-fill-spinner { border-color: rgba(103, 232, 249, 0.22); border-top-color: #22d3ee; }
[data-bs-theme="dark"] .anl-foot  { background: #0e2940; border-top-color: #102a3a; }
[data-bs-theme="dark"] .anl-input { background: #102a3a; border-color: rgba(34, 211, 238, 0.22); color: #cffafe; }
[data-bs-theme="dark"] .anl-input:hover { border-color: rgba(34, 211, 238, 0.40); }
[data-bs-theme="dark"] .anl-input:focus { background: #0c1f2e; border-color: #06b6d4; box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.20); }
[data-bs-theme="dark"] .anl-input::placeholder { color: #94a3b8; opacity: 0.7; }
[data-bs-theme="dark"] .anl-input:disabled { background: #0e2940; color: #6b7280; }
[data-bs-theme="dark"] .anl-input-icon { color: #6b7280; }
[data-bs-theme="dark"] .anl-input-wrap:focus-within .anl-input-icon { color: #67e8f9; }
[data-bs-theme="dark"] .anl-label { color: #8aa1d9; }
[data-bs-theme="dark"] .anl-section-label { color: #67e8f9; }
[data-bs-theme="dark"] .anl-section-icon { background: rgba(8, 145, 178, 0.22); color: #67e8f9; }
[data-bs-theme="dark"] .anl-existing-toggle { background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.35); }
[data-bs-theme="dark"] .anl-existing-toggle:hover { background: rgba(34, 197, 94, 0.14); border-color: rgba(34, 197, 94, 0.55); }
[data-bs-theme="dark"] .anl-existing-title { color: #67e8f9; }
[data-bs-theme="dark"] .anl-existing-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .anl-existing-icon  { background: rgba(8, 145, 178, 0.22); color: #67e8f9; }
[data-bs-theme="dark"] .anl-foot-hint      { color: #94a3b8; }
[data-bs-theme="dark"] .anl-btn-ghost      { background: transparent; color: #cbd5e1; border-color: rgba(34, 211, 238, 0.22); }
[data-bs-theme="dark"] .anl-btn-ghost:hover{ background: #102a3a; border-color: rgba(34, 211, 238, 0.45); }
[data-bs-theme="dark"] .anl-input-wrap.has-error .anl-input { background: rgba(239, 68, 68, 0.12); border-color: #ef4444; color: #fecaca; }
[data-bs-theme="dark"] .anl-field-error    { color: #fca5a5; }

[data-bs-theme="dark"] .master-modal .anl-modal .master-field-icon { color: #6b7280; }
[data-bs-theme="dark"] .master-modal .anl-modal .master-field:focus-within .master-field-icon { color: #67e8f9; }

[data-bs-theme="dark"] .master-modal .anl-modal .master-select-toggle {
  background: #102a3a;
  border-color: rgba(34, 211, 238, 0.22);
  color: #cffafe;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-wrap:not(.show):not(.invalid) .master-select-toggle:is(:focus, :focus-visible, :active):not(:disabled) {
  background: #102a3a;
  color: #cffafe;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-toggle:hover:not(:disabled) {
  border-color: rgba(34, 211, 238, 0.40);
  box-shadow: none;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-wrap.show .master-select-toggle {
  background: #0c1f2e;
  border-color: #06b6d4 !important;
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.20) !important;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-wrap.invalid .master-select-toggle {
  background: rgba(239, 68, 68, 0.12);
  border-color: #ef4444 !important;
  color: #fecaca;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15) !important;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-toggle:disabled {
  background: #0e2940;
  color: #6b7280;
}
[data-bs-theme="dark"] .master-modal .anl-modal .master-select-placeholder {
  color: #94a3b8;
  opacity: 0.7;
}
`;
