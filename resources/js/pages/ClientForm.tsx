import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label,
  Spinner, Form, FormFeedback,
  Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  org_name: '', org_type: '', email: '', phone: '', website: '',
  status: 'inactive', sports: '', industry: '', address: '', city: '',
  district: '', taluka: '', pincode: '', state: '', country: 'India',
  gst_number: '', pan_number: '', plan_id: '', plan_type: 'free',
  plan_expires_at: '', primary_color: '#4F46E5', secondary_color: '#10B981',
  notes: '', admin_name: '', admin_email: '', admin_phone: '',
  admin_designation: '', admin_password: '', admin_password_confirmation: '',
  admin_status: 'active',
};

type FormState = typeof empty;

function validateClientForm(form: FormState, isEdit: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.org_name?.trim()) e.org_name = 'Organization name is required';
  else if (form.org_name.length < 3) e.org_name = 'Minimum 3 characters';
  if (!form.org_type) e.org_type = 'Organization type is required';
  if (!form.email?.trim()) e.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email format';
  if (!form.phone?.trim()) e.phone = 'Phone is required';
  else if (!/^[+\d\s\-()]{7,15}$/.test(form.phone)) e.phone = 'Invalid phone number';
  if (!form.status) e.status = 'Status is required';
  if (!form.address?.trim()) e.address = 'Address is required';
  if (!form.city?.trim()) e.city = 'City is required';
  if (!form.state?.trim()) e.state = 'State is required';
  if (!form.country?.trim()) e.country = 'Country is required';
  if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = 'Must be 6 digits';
  if (form.country === 'India') {
    if (form.gst_number && !/^[0-9A-Z]{15}$/.test(form.gst_number)) e.gst_number = '15 alphanumeric characters';
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)) e.pan_number = 'Invalid PAN format';
  }
  if (!form.plan_id) e.plan_id = 'Plan is required';
  if (!form.plan_type) e.plan_type = 'Plan type is required';
  if (!isEdit) {
    if (!form.admin_name?.trim()) e.admin_name = 'Admin name is required';
    if (!form.admin_email?.trim()) e.admin_email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) e.admin_email = 'Invalid email format';
    if (!form.admin_phone?.trim()) e.admin_phone = 'Phone is required';
    if (!form.admin_password) e.admin_password = 'Password is required';
    else if (form.admin_password.length < 6) e.admin_password = 'Minimum 6 characters';
  } else {
    if (form.admin_password && form.admin_password.length < 6) e.admin_password = 'Minimum 6 characters';
  }
  if (!form.admin_status) e.admin_status = 'Status is required';
  if (form.admin_password && form.admin_password !== form.admin_password_confirmation)
    e.admin_password_confirmation = 'Passwords do not match';
  return e;
}

// ── Inline styles ─────────────────────────────────────────────────────────────
const css = {
  label: {
    fontSize: '11.5px', fontWeight: 600, letterSpacing: '0.02em',
    marginBottom: '3px', display: 'block', opacity: 0.8,
  } as React.CSSProperties,
  input: {
    fontSize: '12.5px', padding: '5px 10px', height: '32px',
  } as React.CSSProperties,
  textarea: {
    fontSize: '12.5px', padding: '5px 10px',
  } as React.CSSProperties,
  ddToggle: {
    fontSize: '12.5px', height: '32px', padding: '0 10px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', textAlign: 'left' as const, background: 'transparent',
  } as React.CSSProperties,
  ddMenu: {
    fontSize: '12.5px', minWidth: '100%', padding: '4px 0',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.2)',
  } as React.CSSProperties,
  ddItem: {
    fontSize: '12px', padding: '5px 12px', cursor: 'pointer',
  } as React.CSSProperties,
  sectionWrap: {
    display: 'flex', alignItems: 'center', gap: '8px',
    marginBottom: '10px', paddingBottom: '7px',
    borderBottom: '1px solid rgba(128,128,128,0.18)',
  } as React.CSSProperties,
  sectionIconWrap: {
    width: '26px', height: '26px', borderRadius: '6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(79,70,229,0.12)', flexShrink: 0,
  } as React.CSSProperties,
  sectionIcon: { fontSize: '13px', color: '#4F46E5' } as React.CSSProperties,
  sectionTitle: {
    fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.03em',
    margin: 0, flexGrow: 1, opacity: 0.85,
  } as React.CSSProperties,
  badge: {
    fontSize: '10px', fontWeight: 600, padding: '2px 7px',
    borderRadius: '20px', background: 'rgba(79,70,229,0.12)',
    color: '#4F46E5', letterSpacing: '0.04em',
  } as React.CSSProperties,
  alert: {
    fontSize: '11.5px', padding: '5px 10px', marginBottom: '10px',
    display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '6px',
  } as React.CSSProperties,
  cardHeader: {
    padding: '10px 16px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', borderBottom: '1px solid rgba(128,128,128,0.15)',
  } as React.CSSProperties,
  cardBody: { padding: '14px 16px' } as React.CSSProperties,
  formFeedback: { fontSize: '10.5px' } as React.CSSProperties,
  small: {
    fontSize: '10.5px', opacity: 0.6, marginTop: '2px', display: 'block',
  } as React.CSSProperties,
};

// dot colors for status-type fields
const statusColor: Record<string, string> = {
  active: '#10B981', inactive: '#6B7280', suspended: '#EF4444',
  free: '#6B7280',   paid: '#4F46E5',    pending: '#F59E0B',
};

export default function ClientForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState<FormState>(empty);
  const [logoFile, setLogoFile]       = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconFile, setFaviconFile]         = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview]   = useState<string | null>(null);
  const toast = useToast();
  const [saving, setSaving]           = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [serverErrors, setServerErrors]         = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});

  // ── one state per dropdown ──────────────────────────────────────────────────
  const [ddOrgType,     setDdOrgType]     = useState(false);
  const [ddStatus,      setDdStatus]      = useState(false);
  const [ddState,       setDdState]       = useState(false);
  const [ddCountry,     setDdCountry]     = useState(false);
  const [ddPlan,        setDdPlan]        = useState(false);
  const [ddPlanType,    setDdPlanType]    = useState(false);
  const [ddAdminStatus, setDdAdminStatus] = useState(false);

  const set = useCallback((key: keyof FormState, val: string) => {
    setForm(f => (f[key] === val ? f : { ...f, [key]: val }));
    setValidationErrors(e => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });
  }, []);

  const touch = useCallback((key: string) => {
    touchedRef.current[key] = true;
    setForm(current => {
      const liveErrors = validateClientForm(current, isEdit);
      setValidationErrors(prev => {
        const next = { ...prev };
        Object.keys(touchedRef.current).forEach(k => {
          if (liveErrors[k]) next[k] = liveErrors[k]; else delete next[k];
        });
        return next;
      });
      return current;
    });
  }, [isEdit]);

  const fieldError   = useCallback((key: string) => serverErrors[key]?.[0] || validationErrors[key], [serverErrors, validationErrors]);
  const fieldInvalid = (key: string) => !!fieldError(key);

  const handleLogoChange = (file: File | null) => {
    setLogoFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setLogoPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setLogoPreview(null);
  };
  const handleFaviconChange = (file: File | null) => {
    setFaviconFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setFaviconPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setFaviconPreview(null);
  };

  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/clients/${editId}`).then(res => {
      const c = res.data.client; const admin = res.data.admin_user;
      setForm({
        org_name: c.org_name||'', org_type: c.org_type||'', email: c.email||'',
        phone: c.phone||'', website: c.website||'', status: c.status||'inactive',
        sports: c.sports||'', industry: c.industry||'', address: c.address||'',
        city: c.city||'', district: c.district||'', taluka: c.taluka||'',
        pincode: c.pincode||'', state: c.state||'', country: c.country||'India',
        gst_number: c.gst_number||'', pan_number: c.pan_number||'',
        plan_id: c.plan_id?.toString()||'', plan_type: c.plan_type||'free',
        plan_expires_at: c.plan_expires_at||'', primary_color: c.primary_color||'#4F46E5',
        secondary_color: c.secondary_color||'#10B981', notes: c.notes||'',
        admin_name: admin?.name||'', admin_email: admin?.email||'',
        admin_phone: admin?.phone||'', admin_designation: admin?.designation||'',
        admin_password: '', admin_password_confirmation: '', admin_status: admin?.status||'active',
      });
      if (c.logo)    setLogoPreview(c.logo);
      if (c.favicon) setFaviconPreview(c.favicon);
    }).catch(()=>{}).finally(()=>setLoadingData(false));
  }, [editId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const allKeys = Object.keys(empty) as (keyof FormState)[];
    allKeys.forEach(k => { touchedRef.current[k] = true; });
    const errs = validateClientForm(form, isEdit);
    if (Object.keys(errs).length) { setValidationErrors(errs); toast.error('Validation Error', 'Please fix the highlighted fields'); return; }
    setServerErrors({}); setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (isEdit) {
        if (logoFile || faviconFile) {
          const fd = new FormData();
          Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
          if (logoFile)    fd.append('logo', logoFile);
          if (faviconFile) fd.append('favicon', faviconFile);
          await api.post(`/clients/${editId}?_method=PUT`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else { await api.put(`/clients/${editId}`, payload); }
        toast.success('Updated', 'Client updated successfully');
      } else {
        const fd = new FormData();
        Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
        if (logoFile)    fd.append('logo', logoFile);
        if (faviconFile) fd.append('favicon', faviconFile);
        await api.post('/clients', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Created', 'Client registered successfully');
      }
      setTimeout(() => onBack(), 1200);
    } catch (err: any) {
      if (err.response?.status === 422) {
        setServerErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else { toast.error('Error', err.response?.data?.message || 'Something went wrong'); }
    } finally { setSaving(false); }
  };

  const handleReset = () => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
    setLogoFile(null); setLogoPreview(null); setFaviconFile(null); setFaviconPreview(null);
  };

  if (loadingData) return (
    <div className="text-center py-5">
      <Spinner color="primary" />
      <p className="text-muted mt-2" style={{ fontSize: '12px' }}>Loading client data...</p>
    </div>
  );

  // ── Reusable SelectDD component ────────────────────────────────────────────
  const SelectDD = ({
    isOpen, toggle, value, placeholder = 'Select', options, fieldKey, dotColor = false,
  }: {
    isOpen: boolean; toggle: () => void; value: string; placeholder?: string;
    options: { label: string; value: string }[]; fieldKey: string; dotColor?: boolean;
  }) => {
    const invalid = fieldInvalid(fieldKey);
    const selectedLabel = options.find(o => o.value === value)?.label || placeholder;
    return (
      <>
        <Dropdown isOpen={isOpen} toggle={toggle} className="w-100">
          <DropdownToggle
            color="light"
            caret
            style={{
              ...css.ddToggle,
              border: `1px solid ${invalid ? '#f06548' : 'rgba(128,128,128,0.3)'}`,
              borderRadius: '4px',
              color: value ? 'inherit' : 'rgba(128,128,128,0.65)',
              boxShadow: invalid ? '0 0 0 2px rgba(240,101,72,0.15)' : 'none',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {dotColor && value && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: statusColor[value] || '#6B7280', display: 'inline-block' }} />
              )}
              {selectedLabel}
            </span>
          </DropdownToggle>
          <DropdownMenu style={css.ddMenu}>
            {options.map(o => (
              <DropdownItem
                key={o.value}
                active={value === o.value}
                style={css.ddItem}
                onClick={() => { set(fieldKey as keyof FormState, o.value); touch(fieldKey); }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {dotColor && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: statusColor[o.value] || '#6B7280', display: 'inline-block' }} />
                  )}
                  {o.label}
                </span>
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
        {invalid && (
          <div style={{ fontSize: '10.5px', color: '#f06548', marginTop: '2px' }}>
            {fieldError(fieldKey)}
          </div>
        )}
      </>
    );
  };

  const SectionHeader = ({ icon, title, badge }: { icon: string; title: string; badge: string }) => (
    <div style={css.sectionWrap}>
      <div style={css.sectionIconWrap}><i className={icon} style={css.sectionIcon} /></div>
      <h5 style={css.sectionTitle}>{title}</h5>
      <span style={css.badge}>{badge}</span>
    </div>
  );

  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <Label style={css.label}>{children}</Label>
  );

  return (
    <>
      {/* Page Title */}
      <Row className="mb-2">
        <Col xs={12}>
          <div className="d-sm-flex align-items-center justify-content-between">
            <h5 className="mb-sm-0" style={{ fontSize: '13.5px', fontWeight: 700 }}>
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack} style={{ fontSize: '11px', padding: '2px 8px' }}>
                <i className="ri-arrow-left-line" />
              </button>
              {isEdit ? 'Edit Client' : 'Register New Client'}
            </h5>
            <ol className="breadcrumb m-0" style={{ fontSize: '11px' }}>
              <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Clients</a></li>
              <li className="breadcrumb-item active">{isEdit ? 'Edit' : 'New'}</li>
            </ol>
          </div>
        </Col>
      </Row>

      {serverErrors.general && (
        <div style={{ ...css.alert, background: 'rgba(240,101,72,0.08)', border: '1px solid rgba(240,101,72,0.2)', color: '#f06548' }}>
          <i className="ri-error-warning-line" style={{ fontSize: '13px' }} />
          <span>{serverErrors.general[0]}</span>
        </div>
      )}

      <Form onSubmit={handleSubmit}>
        <Card className="shadow-sm">
          <CardHeader style={css.cardHeader}>
            <div>
              <h6 className="mb-0" style={{ fontSize: '12.5px', fontWeight: 700 }}>Client Registration Form</h6>
              <p className="mb-0" style={{ fontSize: '11px', opacity: 0.55, marginTop: '1px' }}>
                Fields marked <span className="text-danger">*</span> are required
              </p>
            </div>
            <span style={{ ...css.badge, background: isEdit ? 'rgba(16,185,129,0.12)' : 'rgba(79,70,229,0.12)', color: isEdit ? '#10B981' : '#4F46E5' }}>
              {isEdit ? '✏ Edit Mode' : '＋ New Client'}
            </span>
          </CardHeader>

          <CardBody style={css.cardBody}>

            {/* ══ A: Organization ══ */}
            <SectionHeader icon="ri-building-line" title="Organization Details" badge="A" />
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Org. Name <span className="text-danger">*</span></Lbl>
                <Input style={css.input} value={form.org_name} invalid={fieldInvalid('org_name')}
                  onChange={e => set('org_name', e.target.value)} onBlur={() => touch('org_name')}
                  placeholder="e.g., Inorbvict Technologies" />
                <FormFeedback style={css.formFeedback}>{fieldError('org_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Org. Type <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddOrgType} toggle={() => setDdOrgType(o => !o)}
                  value={form.org_type} placeholder="Select type" fieldKey="org_type"
                  options={['Business','Sports','Education','Healthcare','Government','NGO','Other']
                    .map(t => ({ label: t, value: t }))}
                />
              </Col>
              <Col md={4}>
                {form.org_type === 'Sports' ? (
                  <><Lbl>Sport Name</Lbl>
                    <Input style={css.input} value={form.sports} onChange={e => set('sports', e.target.value)} placeholder="e.g., Hockey, Boxing" /></>
                ) : (
                  <><Lbl>Industry</Lbl>
                    <Input style={css.input} value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="e.g., Agriculture, IT" /></>
                )}
              </Col>
              <Col md={4}>
                <Lbl>Status <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddStatus} toggle={() => setDdStatus(o => !o)}
                  value={form.status} fieldKey="status" dotColor
                  options={[
                    { label: 'Active',    value: 'active' },
                    { label: 'Inactive',  value: 'inactive' },
                    { label: 'Suspended', value: 'suspended' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Email <span className="text-danger">*</span></Lbl>
                <Input style={css.input} type="email" value={form.email} invalid={fieldInvalid('email')}
                  onChange={e => set('email', e.target.value)} onBlur={() => touch('email')}
                  placeholder="contact@company.com" />
                <FormFeedback style={css.formFeedback}>{fieldError('email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Phone <span className="text-danger">*</span></Lbl>
                <Input style={css.input} type="tel" value={form.phone} invalid={fieldInvalid('phone')}
                  onChange={e => set('phone', e.target.value)} onBlur={() => touch('phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback style={css.formFeedback}>{fieldError('phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Website</Lbl>
                <Input style={css.input} type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="www.company.com" />
              </Col>
            </Row>

            {/* ══ B: Address ══ */}
            <SectionHeader icon="ri-map-pin-line" title="Address Details" badge="B" />
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <Lbl>Street Address <span className="text-danger">*</span></Lbl>
                <Input style={css.textarea} type="textarea" rows={1} value={form.address} invalid={fieldInvalid('address')}
                  onChange={e => set('address', e.target.value)} onBlur={() => touch('address')}
                  placeholder="Plot No, Street, Landmark..." />
                <FormFeedback style={css.formFeedback}>{fieldError('address')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>City <span className="text-danger">*</span></Lbl>
                <Input style={css.input} value={form.city} invalid={fieldInvalid('city')}
                  onChange={e => set('city', e.target.value)} onBlur={() => touch('city')} placeholder="e.g., Nagpur" />
                <FormFeedback style={css.formFeedback}>{fieldError('city')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>District</Lbl>
                <Input style={css.input} value={form.district} onChange={e => set('district', e.target.value)} placeholder="e.g., Nagpur" />
              </Col>
              <Col md={4}>
                <Lbl>Taluka</Lbl>
                <Input style={css.input} value={form.taluka} onChange={e => set('taluka', e.target.value)} placeholder="e.g., Nagpur" />
              </Col>
              <Col md={4}>
                <Lbl>Pincode</Lbl>
                <Input style={css.input} value={form.pincode} invalid={fieldInvalid('pincode')} maxLength={6}
                  onChange={e => set('pincode', e.target.value)} onBlur={() => touch('pincode')} placeholder="440001" />
                <FormFeedback style={css.formFeedback}>{fieldError('pincode')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>State <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddState} toggle={() => setDdState(o => !o)}
                  value={form.state} placeholder="Select state" fieldKey="state"
                  options={['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','Telangana','West Bengal']
                    .map(s => ({ label: s, value: s }))}
                />
              </Col>
              <Col md={4}>
                <Lbl>Country <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddCountry} toggle={() => setDdCountry(o => !o)}
                  value={form.country} fieldKey="country"
                  options={[
                    { label: '🇮🇳 India', value: 'India' },
                    { label: '🇺🇸 USA',   value: 'USA' },
                    { label: '🇬🇧 UK',    value: 'UK' },
                  ]}
                />
              </Col>
            </Row>

            {/* ══ C: Legal & Tax ══ */}
            <SectionHeader icon="ri-file-text-line" title="Legal & Tax Information" badge="C" />
            {form.country === 'India' && (
              <div style={{ ...css.alert, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#B45309' }}>
                <i className="ri-information-line" style={{ fontSize: '13px' }} />
                <span style={{ fontSize: '11.5px' }}>GST and PAN are recommended for Indian organizations.</span>
              </div>
            )}
            <Row className="g-2 mb-3">
              <Col md={6}>
                <Lbl>GST Number</Lbl>
                <Input style={css.input} value={form.gst_number} invalid={fieldInvalid('gst_number')} maxLength={15}
                  onChange={e => set('gst_number', e.target.value.toUpperCase())} onBlur={() => touch('gst_number')}
                  placeholder="27AABCU9603R1ZM" />
                <FormFeedback style={css.formFeedback}>{fieldError('gst_number')}</FormFeedback>
              </Col>
              <Col md={6}>
                <Lbl>PAN Number</Lbl>
                <Input style={css.input} value={form.pan_number} invalid={fieldInvalid('pan_number')} maxLength={10}
                  onChange={e => set('pan_number', e.target.value.toUpperCase())} onBlur={() => touch('pan_number')}
                  placeholder="AABCU9603R" />
                <FormFeedback style={css.formFeedback}>{fieldError('pan_number')}</FormFeedback>
              </Col>
            </Row>

            {/* ══ D: Plan ══ */}
            <SectionHeader icon="ri-shield-check-line" title="Plan & Billing" badge="D" />
            <div style={{ ...css.alert, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#059669' }}>
              <i className="ri-checkbox-circle-line" style={{ fontSize: '13px' }} />
              <span style={{ fontSize: '11.5px' }}>Client must complete payment after creation to activate.</span>
            </div>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Assign Plan <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddPlan} toggle={() => setDdPlan(o => !o)}
                  value={form.plan_id} placeholder="Select plan" fieldKey="plan_id"
                  options={[
                    { label: 'Starter — ₹0/mo',     value: '1' },
                    { label: 'Basic — ₹1,999/mo',    value: '2' },
                    { label: 'Pro — ₹4,999/mo',      value: '3' },
                    { label: 'Business — ₹9,999/mo', value: '4' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Plan Type <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddPlanType} toggle={() => setDdPlanType(o => !o)}
                  value={form.plan_type} fieldKey="plan_type" dotColor
                  options={[
                    { label: 'Free', value: 'free' },
                    { label: 'Paid', value: 'paid' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Expires At</Lbl>
                <Input style={css.input} type="date" value={form.plan_expires_at} onChange={e => set('plan_expires_at', e.target.value)} />
              </Col>
            </Row>

            {/* ══ E: Admin ══ */}
            <SectionHeader icon="ri-user-line" title="Admin Credentials" badge="E" />
            <div style={{ ...css.alert, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#2563EB' }}>
              <i className="ri-lock-line" style={{ fontSize: '13px' }} />
              <span style={{ fontSize: '11.5px' }}>Creates the first login user (Client Admin) for this organization.</span>
            </div>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Full Name <span className="text-danger">*</span></Lbl>
                <Input style={css.input} value={form.admin_name} invalid={fieldInvalid('admin_name')}
                  onChange={e => set('admin_name', e.target.value)} onBlur={() => touch('admin_name')}
                  placeholder="Rajesh Meshram" />
                <FormFeedback style={css.formFeedback}>{fieldError('admin_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Email <span className="text-danger">*</span></Lbl>
                <Input style={css.input} type="email" value={form.admin_email} invalid={fieldInvalid('admin_email')}
                  onChange={e => set('admin_email', e.target.value)} onBlur={() => touch('admin_email')}
                  placeholder="admin@company.com" />
                <FormFeedback style={css.formFeedback}>{fieldError('admin_email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Phone {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input style={css.input} type="tel" value={form.admin_phone} invalid={fieldInvalid('admin_phone')}
                  onChange={e => set('admin_phone', e.target.value)} onBlur={() => touch('admin_phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback style={css.formFeedback}>{fieldError('admin_phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Designation</Lbl>
                <Input style={css.input} value={form.admin_designation} onChange={e => set('admin_designation', e.target.value)}
                  placeholder="CEO / Director" />
              </Col>
              <Col md={4}>
                <Lbl>{isEdit ? 'New Password' : 'Password'} {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input style={css.input} type="password" value={form.admin_password} invalid={fieldInvalid('admin_password')}
                  onChange={e => set('admin_password', e.target.value)} onBlur={() => touch('admin_password')}
                  placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} />
                <FormFeedback style={css.formFeedback}>{fieldError('admin_password')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Confirm Password {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input style={css.input} type="password" value={form.admin_password_confirmation}
                  invalid={fieldInvalid('admin_password_confirmation')}
                  onChange={e => set('admin_password_confirmation', e.target.value)}
                  onBlur={() => touch('admin_password_confirmation')} placeholder="Re-enter password" />
                <FormFeedback style={css.formFeedback}>{fieldError('admin_password_confirmation')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Admin Status <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddAdminStatus} toggle={() => setDdAdminStatus(o => !o)}
                  value={form.admin_status} fieldKey="admin_status" dotColor
                  options={[
                    { label: 'Active',   value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                    { label: 'Pending',  value: 'pending' },
                  ]}
                />
              </Col>
            </Row>

            {/* ══ F: Branding ══ */}
            <SectionHeader icon="ri-palette-line" title="Branding" badge="F" />
            <Row className="g-2 mb-3">
              <Col md={6}>
                <Lbl>Primary Color</Lbl>
                <div className="d-flex gap-2">
                  <Input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)}
                    style={{ width: 36, height: 32, padding: '2px', borderRadius: '5px', cursor: 'pointer' }} />
                  <Input style={{ ...css.input, fontFamily: 'monospace', fontSize: '12px' }} value={form.primary_color} onChange={e => set('primary_color', e.target.value)} />
                </div>
              </Col>
              <Col md={6}>
                <Lbl>Secondary Color</Lbl>
                <div className="d-flex gap-2">
                  <Input type="color" value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)}
                    style={{ width: 36, height: 32, padding: '2px', borderRadius: '5px', cursor: 'pointer' }} />
                  <Input style={{ ...css.input, fontFamily: 'monospace', fontSize: '12px' }} value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)} />
                </div>
              </Col>
              <Col md={6}>
                <Lbl>Organization Logo</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {logoPreview && <img src={logoPreview} alt="logo" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleLogoChange(e.target.files?.[0] || null)} />
                </div>
                <small style={css.small}>PNG, JPG — Max 2MB</small>
              </Col>
              <Col md={6}>
                <Lbl>Favicon</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {faviconPreview && <img src={faviconPreview} alt="favicon" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/x-icon,image/png" onChange={e => handleFaviconChange(e.target.files?.[0] || null)} />
                </div>
                <small style={css.small}>PNG, ICO — Max 512KB</small>
              </Col>
            </Row>

            {/* ══ G: Notes ══ */}
            <SectionHeader icon="ri-sticky-note-line" title="Additional Notes" badge="G" />
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <Lbl>Internal Notes</Lbl>
                <Input style={css.textarea} type="textarea" rows={2} value={form.notes}
                  onChange={e => set('notes', e.target.value)} placeholder="Any internal notes about this client..." />
              </Col>
            </Row>

            {/* ══ Actions ══ */}
            <div className="d-flex justify-content-between align-items-center pt-2 border-top" style={{ marginTop: '4px' }}>
              <Button color="light" type="button" onClick={onBack} size="sm" style={{ fontSize: '12px' }}>
                <i className="ri-arrow-left-line me-1" />Cancel
              </Button>
              <div className="d-flex gap-2">
                {!isEdit && (
                  <Button color="light" type="button" onClick={handleReset} size="sm" style={{ fontSize: '12px' }}>
                    <i className="ri-restart-line me-1" />Reset
                  </Button>
                )}
                <Button color="success" type="submit" disabled={saving} size="sm"
                  className="btn-label waves-effect right waves-light rounded-pill"
                  style={{ fontSize: '12px', minWidth: '140px' }}>
                  {saving ? (
                    <><Spinner size="sm" className="me-1" />Saving...</>
                  ) : (
                    <>
                      <i className={`label-icon align-middle rounded-pill fs-16 ms-2 ${isEdit ? 'ri-check-double-line' : 'ri-save-line'}`} />
                      {isEdit ? 'Update Client' : 'Create Client'}
                    </>
                  )}
                </Button>
              </div>
            </div>

          </CardBody>
        </Card>
      </Form>
    </>
  );
}
