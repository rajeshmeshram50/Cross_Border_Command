import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner, Alert, Form, FormFeedback } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props {
  onBack: () => void;
  editId?: number;
}

interface OrgType {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
}

interface PlanOption {
  id: number;
  name: string;
  price: number | string;
  period: string;
  status: string;
}

const formatPlanLabel = (p: PlanOption): string => {
  const price = Number(p.price);
  const periodShort: Record<string, string> = { month: 'mo', quarter: 'qtr', year: 'yr' };
  const per = periodShort[p.period] || p.period;
  const priceText = price > 0 ? `₹${price.toLocaleString('en-IN')}/${per}` : 'Free';
  return `${p.name} — ${priceText}`;
};

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

export default function ClientForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState<FormState>(empty);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});
  const [orgTypes, setOrgTypes] = useState<OrgType[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/organization-types', { params: { active_only: 1 } }).catch(() => ({ data: [] })),
      api.get('/plans').catch(() => ({ data: [] })),
    ]).then(([otRes, planRes]) => {
      setOrgTypes(Array.isArray(otRes.data) ? otRes.data : []);
      const allPlans: PlanOption[] = Array.isArray(planRes.data) ? planRes.data : [];
      setPlans(allPlans.filter(p => p.status === 'active'));
    }).finally(() => setLoadingLookups(false));
  }, []);

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
        Object.keys(touchedRef.current).forEach(k => { if (liveErrors[k]) next[k] = liveErrors[k]; else delete next[k]; });
        return next;
      });
      return current;
    });
  }, [isEdit]);

  const fieldError = useCallback((key: string) => serverErrors[key]?.[0] || validationErrors[key], [serverErrors, validationErrors]);
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
      const c = res.data.client;
      const admin = res.data.admin_user;
      setForm({
        org_name: c.org_name || '', org_type: c.org_type || '', email: c.email || '',
        phone: c.phone || '', website: c.website || '', status: c.status || 'inactive',
        sports: c.sports || '', industry: c.industry || '', address: c.address || '',
        city: c.city || '', district: c.district || '', taluka: c.taluka || '',
        pincode: c.pincode || '', state: c.state || '', country: c.country || 'India',
        gst_number: c.gst_number || '', pan_number: c.pan_number || '',
        plan_id: c.plan_id?.toString() || '', plan_type: c.plan_type || 'free',
        plan_expires_at: c.plan_expires_at || '', primary_color: c.primary_color || '#4F46E5',
        secondary_color: c.secondary_color || '#10B981', notes: c.notes || '',
        admin_name: admin?.name || '', admin_email: admin?.email || '',
        admin_phone: admin?.phone || '', admin_designation: admin?.designation || '',
        admin_password: '', admin_password_confirmation: '', admin_status: admin?.status || 'active',
      });
      if (c.logo) setLogoPreview(c.logo);
      if (c.favicon) setFaviconPreview(c.favicon);
    }).catch(() => {}).finally(() => setLoadingData(false));
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
          if (logoFile) fd.append('logo', logoFile);
          if (faviconFile) fd.append('favicon', faviconFile);
          await api.post(`/clients/${editId}?_method=PUT`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else {
          await api.put(`/clients/${editId}`, payload);
        }
        toast.success('Updated', 'Client updated successfully');
      } else {
        const fd = new FormData();
        Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
        if (logoFile) fd.append('logo', logoFile);
        if (faviconFile) fd.append('favicon', faviconFile);
        await api.post('/clients', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Created', 'Client registered successfully');
      }
      setTimeout(() => onBack(), 1200);
    } catch (err: any) {
      if (err.response?.status === 422) {
        setServerErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally { setSaving(false); }
  };

  const handleReset = () => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
    setLogoFile(null); setLogoPreview(null); setFaviconFile(null); setFaviconPreview(null);
  };

  if (loadingData) {
    return (
      <div className="text-center py-5">
        <Spinner color="primary" />
        <p className="text-muted mt-3">Loading client data...</p>
      </div>
    );
  }

  const SectionHeader = ({ icon, title, badge }: { icon: string; title: string; badge: string }) => (
    <div className="d-flex align-items-center gap-2 mb-3 pb-2 border-bottom">
      <div className="avatar-xs">
        <span className="avatar-title rounded bg-primary-subtle text-primary fs-4">
          <i className={icon}></i>
        </span>
      </div>
      <h5 className="fs-15 mb-0 flex-grow-1">{title}</h5>
      <span className="badge bg-primary-subtle text-primary">{badge}</span>
    </div>
  );

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              {isEdit ? 'Edit Client' : 'Register New Client'}
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Clients</a></li>
                <li className="breadcrumb-item active">{isEdit ? 'Edit' : 'New'}</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {serverErrors.general && (
        <Alert color="danger">
          <i className="ri-error-warning-line me-1"></i>{serverErrors.general[0]}
        </Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="d-flex align-items-center justify-content-between">
            <div>
              <h5 className="card-title mb-0">Client Registration Form</h5>
              <p className="text-muted mb-0 fs-13">Fields marked <span className="text-danger">*</span> are required</p>
            </div>
            <span className="badge bg-primary-subtle text-primary">{isEdit ? 'Edit Mode' : 'New Client'}</span>
          </CardHeader>

          <CardBody>
            {/* ═ Section A: Organization ═ */}
            <SectionHeader icon="ri-building-line" title="Organization Details" badge="Section A" />
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Org. Name <span className="text-danger">*</span></Label>
                <Input value={form.org_name} invalid={fieldInvalid('org_name')}
                  onChange={e => set('org_name', e.target.value)} onBlur={() => touch('org_name')}
                  placeholder="e.g., Inorbvict Technologies" />
                <FormFeedback>{fieldError('org_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Org. Type <span className="text-danger">*</span></Label>
                <Input type="select" value={form.org_type} invalid={fieldInvalid('org_type')}
                  onChange={e => set('org_type', e.target.value)} onBlur={() => touch('org_type')}
                  disabled={loadingLookups}>
                  <option value="">{loadingLookups ? 'Loading…' : 'Select type'}</option>
                  {orgTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </Input>
                <FormFeedback>{fieldError('org_type')}</FormFeedback>
              </Col>
              <Col md={4}>
                {form.org_type === 'Sports' ? (
                  <>
                    <Label>Sport Name</Label>
                    <Input value={form.sports} onChange={e => set('sports', e.target.value)} placeholder="e.g., Hockey, Boxing" />
                  </>
                ) : (
                  <>
                    <Label>Industry</Label>
                    <Input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="e.g., Agriculture, IT" />
                  </>
                )}
              </Col>
              <Col md={4}>
                <Label>Status <span className="text-danger">*</span></Label>
                <Input type="select" value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Email <span className="text-danger">*</span></Label>
                <Input type="email" value={form.email} invalid={fieldInvalid('email')}
                  onChange={e => set('email', e.target.value)} onBlur={() => touch('email')}
                  placeholder="contact@company.com" />
                <FormFeedback>{fieldError('email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Phone <span className="text-danger">*</span></Label>
                <Input type="tel" value={form.phone} invalid={fieldInvalid('phone')}
                  onChange={e => set('phone', e.target.value)} onBlur={() => touch('phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback>{fieldError('phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Website</Label>
                <Input type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="www.company.com" />
              </Col>
            </Row>

            {/* ═ Section B: Address ═ */}
            <SectionHeader icon="ri-map-pin-line" title="Address Details" badge="Section B" />
            <Row className="g-3 mb-4">
              <Col xs={12}>
                <Label>Street Address <span className="text-danger">*</span></Label>
                <Input type="textarea" rows={1} value={form.address} invalid={fieldInvalid('address')}
                  onChange={e => set('address', e.target.value)} onBlur={() => touch('address')}
                  placeholder="Plot No, Street, Landmark..." />
                <FormFeedback>{fieldError('address')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>City <span className="text-danger">*</span></Label>
                <Input value={form.city} invalid={fieldInvalid('city')}
                  onChange={e => set('city', e.target.value)} onBlur={() => touch('city')} placeholder="e.g., Nagpur" />
                <FormFeedback>{fieldError('city')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>District</Label>
                <Input value={form.district} onChange={e => set('district', e.target.value)} placeholder="e.g., Nagpur" />
              </Col>
              <Col md={4}>
                <Label>Taluka</Label>
                <Input value={form.taluka} onChange={e => set('taluka', e.target.value)} placeholder="e.g., Nagpur" />
              </Col>
              <Col md={4}>
                <Label>Pincode</Label>
                <Input value={form.pincode} invalid={fieldInvalid('pincode')} maxLength={6}
                  onChange={e => set('pincode', e.target.value)} onBlur={() => touch('pincode')} placeholder="440001" />
                <FormFeedback>{fieldError('pincode')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>State <span className="text-danger">*</span></Label>
                <Input type="select" value={form.state} invalid={fieldInvalid('state')}
                  onChange={e => set('state', e.target.value)}>
                  <option value="">Select state</option>
                  {['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','Telangana','West Bengal'].map(s => <option key={s} value={s}>{s}</option>)}
                </Input>
                <FormFeedback>{fieldError('state')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Country <span className="text-danger">*</span></Label>
                <Input type="select" value={form.country} onChange={e => set('country', e.target.value)}>
                  <option value="India">India</option>
                  <option value="USA">USA</option>
                  <option value="UK">UK</option>
                </Input>
              </Col>
            </Row>

            {/* ═ Section C: Legal & Tax ═ */}
            <SectionHeader icon="ri-file-text-line" title="Legal & Tax Information" badge="Section C" />
            {form.country === 'India' && (
              <Alert color="warning" className="d-flex align-items-center py-2">
                <i className="ri-information-line me-2"></i>
                GST and PAN are recommended for Indian organizations.
              </Alert>
            )}
            <Row className="g-3 mb-4">
              <Col md={6}>
                <Label>GST Number</Label>
                <Input value={form.gst_number} invalid={fieldInvalid('gst_number')} maxLength={15}
                  onChange={e => set('gst_number', e.target.value.toUpperCase())} onBlur={() => touch('gst_number')}
                  placeholder="27AABCU9603R1ZM" />
                <FormFeedback>{fieldError('gst_number')}</FormFeedback>
              </Col>
              <Col md={6}>
                <Label>PAN Number</Label>
                <Input value={form.pan_number} invalid={fieldInvalid('pan_number')} maxLength={10}
                  onChange={e => set('pan_number', e.target.value.toUpperCase())} onBlur={() => touch('pan_number')}
                  placeholder="AABCU9603R" />
                <FormFeedback>{fieldError('pan_number')}</FormFeedback>
              </Col>
            </Row>

            {/* ═ Section D: Plan ═ */}
            <SectionHeader icon="ri-shield-check-line" title="Plan & Billing" badge="Section D" />
            <Alert color="success" className="d-flex align-items-center py-2">
              <i className="ri-checkbox-circle-line me-2"></i>
              Client must complete payment after creation to activate.
            </Alert>
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Assign Plan <span className="text-danger">*</span></Label>
                <Input type="select" value={form.plan_id} invalid={fieldInvalid('plan_id')}
                  onChange={e => {
                    const id = e.target.value;
                    set('plan_id', id);
                    const picked = plans.find(p => String(p.id) === id);
                    if (picked) set('plan_type', Number(picked.price) > 0 ? 'paid' : 'free');
                  }}
                  disabled={loadingLookups}>
                  <option value="">{loadingLookups ? 'Loading…' : 'Select plan'}</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{formatPlanLabel(p)}</option>
                  ))}
                </Input>
                <FormFeedback>{fieldError('plan_id')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Plan Type <span className="text-danger">*</span></Label>
                <Input type="select" value={form.plan_type} onChange={e => set('plan_type', e.target.value)}>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Expires At</Label>
                <Input type="date" value={form.plan_expires_at} onChange={e => set('plan_expires_at', e.target.value)} />
              </Col>
            </Row>

            {/* ═ Section E: Admin ═ */}
            <SectionHeader icon="ri-user-line" title="Admin Credentials" badge="Section E" />
            <Alert color="info" className="d-flex align-items-center py-2">
              <i className="ri-lock-line me-2"></i>
              Creates the first login user (Client Admin) for this organization.
            </Alert>
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Full Name <span className="text-danger">*</span></Label>
                <Input value={form.admin_name} invalid={fieldInvalid('admin_name')}
                  onChange={e => set('admin_name', e.target.value)} onBlur={() => touch('admin_name')}
                  placeholder="Rajesh Meshram" />
                <FormFeedback>{fieldError('admin_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Email <span className="text-danger">*</span></Label>
                <Input type="email" value={form.admin_email} invalid={fieldInvalid('admin_email')}
                  onChange={e => set('admin_email', e.target.value)} onBlur={() => touch('admin_email')}
                  placeholder="admin@company.com" />
                <FormFeedback>{fieldError('admin_email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Phone {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input type="tel" value={form.admin_phone} invalid={fieldInvalid('admin_phone')}
                  onChange={e => set('admin_phone', e.target.value)} onBlur={() => touch('admin_phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback>{fieldError('admin_phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Designation</Label>
                <Input value={form.admin_designation} onChange={e => set('admin_designation', e.target.value)}
                  placeholder="CEO / Director" />
              </Col>
              <Col md={4}>
                <Label>{isEdit ? 'New Password' : 'Password'} {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input type="password" value={form.admin_password} invalid={fieldInvalid('admin_password')}
                  onChange={e => set('admin_password', e.target.value)} onBlur={() => touch('admin_password')}
                  placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} />
                <FormFeedback>{fieldError('admin_password')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Confirm Password {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input type="password" value={form.admin_password_confirmation}
                  invalid={fieldInvalid('admin_password_confirmation')}
                  onChange={e => set('admin_password_confirmation', e.target.value)}
                  onBlur={() => touch('admin_password_confirmation')} placeholder="Re-enter password" />
                <FormFeedback>{fieldError('admin_password_confirmation')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Admin Status <span className="text-danger">*</span></Label>
                <Input type="select" value={form.admin_status} onChange={e => set('admin_status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                </Input>
              </Col>
            </Row>

            {/* ═ Section F: Branding ═ */}
            <SectionHeader icon="ri-palette-line" title="Branding" badge="Section F" />
            <Row className="g-3 mb-4">
              <Col md={6}>
                <Label>Primary Color</Label>
                <div className="d-flex gap-2">
                  <Input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} style={{ width: 48, height: 38 }} />
                  <Input value={form.primary_color} onChange={e => set('primary_color', e.target.value)} className="font-monospace" />
                </div>
              </Col>
              <Col md={6}>
                <Label>Secondary Color</Label>
                <div className="d-flex gap-2">
                  <Input type="color" value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)} style={{ width: 48, height: 38 }} />
                  <Input value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)} className="font-monospace" />
                </div>
              </Col>
              <Col md={6}>
                <Label>Organization Logo</Label>
                <div className="d-flex gap-3 align-items-center">
                  {logoPreview && <img src={logoPreview} alt="logo" className="rounded border" style={{ width: 56, height: 56, objectFit: 'cover' }} />}
                  <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleLogoChange(e.target.files?.[0] || null)} />
                </div>
                <small className="text-muted">PNG, JPG — Max 2MB</small>
              </Col>
              <Col md={6}>
                <Label>Favicon</Label>
                <div className="d-flex gap-3 align-items-center">
                  {faviconPreview && <img src={faviconPreview} alt="favicon" className="rounded border" style={{ width: 56, height: 56, objectFit: 'cover' }} />}
                  <Input type="file" accept="image/x-icon,image/png" onChange={e => handleFaviconChange(e.target.files?.[0] || null)} />
                </div>
                <small className="text-muted">PNG, ICO — Max 512KB</small>
              </Col>
            </Row>

            {/* ═ Section G: Notes ═ */}
            <SectionHeader icon="ri-sticky-note-line" title="Additional Notes" badge="Section G" />
            <Row className="g-3 mb-3">
              <Col xs={12}>
                <Label>Internal Notes</Label>
                <Input type="textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="Any internal notes about this client..." />
              </Col>
            </Row>

            {/* Actions */}
            <div className="d-flex justify-content-between pt-3 border-top">
              <Button color="light" type="button" onClick={onBack}>Cancel</Button>
              <div className="d-flex gap-2">
                {!isEdit && (
                  <Button color="light" type="button" onClick={handleReset}>
                    <i className="ri-restart-line me-1"></i> Reset
                  </Button>
                )}
                <Button color="success" type="submit" disabled={saving}>
                  {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
                  {saving ? 'Saving...' : isEdit ? 'Update Client' : 'Create Client'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </Form>
    </>
  );
}
