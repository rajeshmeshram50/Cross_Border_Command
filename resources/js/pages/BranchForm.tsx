import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner, Alert, Form, FormFeedback } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  name: '', code: '', email: '', phone: '', website: '',
  contact_person: '', branch_type: '', industry: '', description: '',
  gst_number: '', pan_number: '', registration_number: '',
  address: '', city: '', district: '', taluka: '', pincode: '',
  state: '', country: 'India',
  is_main: 'false', max_users: '0',
  established_at: '', status: 'active', notes: '',
  user_name: '', user_email: '', user_phone: '',
  user_designation: '', user_password: '', user_password_confirmation: '',
  user_status: 'active',
};

type FormState = typeof empty;

// Human-readable field labels used for error summaries / toasts
const FIELD_LABELS: Record<string, string> = {
  name: 'Branch Name',
  email: 'Branch Email',
  phone: 'Branch Phone',
  pincode: 'Pincode',
  gst_number: 'GST Number',
  pan_number: 'PAN Number',
  max_users: 'Max Users',
  user_name: 'User Full Name',
  user_email: 'User Email',
  user_password: 'Password',
  user_password_confirmation: 'Confirm Password',
};

function validateBranchForm(form: FormState, isEdit: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.name?.trim()) e.name = 'Branch name is required';
  else if (form.name.length < 2) e.name = 'Minimum 2 characters';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email format';
  if (form.phone && !/^[+\d\s\-()]{7,15}$/.test(form.phone)) e.phone = 'Invalid phone number';
  if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = 'Must be 6 digits';
  if (form.country === 'India') {
    if (form.gst_number && !/^[0-9A-Z]{15}$/.test(form.gst_number)) e.gst_number = '15 alphanumeric characters';
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)) e.pan_number = 'Invalid PAN format';
  }
  if (form.max_users && parseInt(form.max_users) < 0) e.max_users = 'Cannot be negative';
  if (!isEdit) {
    if (!form.user_name?.trim()) e.user_name = 'User name is required';
    if (!form.user_email?.trim()) e.user_email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.user_email)) e.user_email = 'Invalid email format';
    if (!form.user_password) e.user_password = 'Password is required';
    else if (form.user_password.length < 6) e.user_password = 'Minimum 6 characters';
  } else if (form.user_password && form.user_password.length < 6) {
    e.user_password = 'Minimum 6 characters';
  }
  if (form.user_password && form.user_password !== form.user_password_confirmation)
    e.user_password_confirmation = 'Passwords do not match';
  return e;
}

export default function BranchForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState<FormState>(empty);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});

  const set = useCallback((key: keyof FormState, val: string) => {
    setForm(f => (f[key] === val ? f : { ...f, [key]: val }));
    setValidationErrors(e => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });
  }, []);

  const touch = useCallback((key: string) => {
    touchedRef.current[key] = true;
    setForm(current => {
      const liveErrors = validateBranchForm(current, isEdit);
      setValidationErrors(prev => {
        const next = { ...prev };
        Object.keys(touchedRef.current).forEach(k => { if (liveErrors[k]) next[k] = liveErrors[k]; else delete next[k]; });
        return next;
      });
      return current;
    });
  }, [isEdit]);

  const fieldError = (key: string) => serverErrors[key]?.[0] || validationErrors[key];
  const fieldInvalid = (key: string) => !!fieldError(key);

  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/branches/${editId}`).then(res => {
      const b = res.data.branch;
      const u = res.data.branch_user;
      setForm({
        name: b.name || '', code: b.code || '', email: b.email || '',
        phone: b.phone || '', website: b.website || '',
        contact_person: b.contact_person || '', branch_type: b.branch_type || '',
        industry: b.industry || '', description: b.description || '',
        gst_number: b.gst_number || '', pan_number: b.pan_number || '',
        registration_number: b.registration_number || '',
        address: b.address || '', city: b.city || '',
        district: b.district || '', taluka: b.taluka || '',
        pincode: b.pincode || '', state: b.state || '', country: b.country || 'India',
        is_main: b.is_main ? 'true' : 'false',
        max_users: String(b.max_users ?? 0),
        established_at: b.established_at || '', status: b.status || 'active',
        notes: b.notes || '',
        user_name: u?.name || '', user_email: u?.email || '',
        user_phone: u?.phone || '', user_designation: u?.designation || '',
        user_password: '', user_password_confirmation: '',
        user_status: u?.status || 'active',
      });
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  // Focus + scroll to first invalid field so user sees what's missing, even if it's far down the form
  const focusFirstError = (errs: Record<string, string | string[]>) => {
    const keys = Object.keys(errs);
    if (!keys.length) return;
    // Try each error key in order — use name/id selectors
    for (const k of keys) {
      const el = document.querySelector<HTMLElement>(`[name="${k}"], #branch-field-${k}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Delay focus slightly so scroll completes before focus jumps
        setTimeout(() => { try { (el as HTMLInputElement).focus?.(); } catch {} }, 350);
        return;
      }
    }
  };

  const handleSubmit = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    const allKeys = Object.keys(empty) as (keyof FormState)[];
    allKeys.forEach(k => { touchedRef.current[k] = true; });
    const errs = validateBranchForm(form, isEdit);
    if (Object.keys(errs).length) {
      setValidationErrors(errs);
      const missing = Object.keys(errs).slice(0, 3).map(k => FIELD_LABELS[k] || k).join(', ');
      const more = Object.keys(errs).length > 3 ? ` +${Object.keys(errs).length - 3} more` : '';
      toast.error('Fix these fields', `${missing}${more}`);
      focusFirstError(errs);
      return;
    }
    setServerErrors({}); setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      delete payload.user_password_confirmation;
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      payload.is_main = form.is_main === 'true';
      payload.max_users = parseInt(form.max_users) || 0;

      if (isEdit) {
        await api.put(`/branches/${editId}`, payload);
        toast.success('Branch Updated', 'Branch details have been updated successfully');
      } else {
        await api.post('/branches', payload);
        toast.success('Branch Created', 'New branch has been created with login credentials');
      }
      setTimeout(() => onBack(), 1200);
    } catch (err: any) {
      if (err.response?.status === 422) {
        const svErrs = err.response.data.errors || {};
        setServerErrors(svErrs);
        const keys = Object.keys(svErrs);
        const missing = keys.slice(0, 3).map(k => FIELD_LABELS[k] || k).join(', ');
        const more = keys.length > 3 ? ` +${keys.length - 3} more` : '';
        toast.error('Fix these fields', `${missing}${more}`);
        focusFirstError(svErrs);
      } else {
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally { setSaving(false); }
  };

  const handleReset = () => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
  };

  if (loadingData) {
    return (
      <div className="text-center py-5">
        <Spinner color="primary" />
        <p className="text-muted mt-3">Loading branch data...</p>
      </div>
    );
  }

  const SectionHeader = ({ icon, title, badge }: { icon: string; title: string; badge: string }) => (
    <div className="d-flex align-items-center gap-2 mb-3 pb-2 border-bottom">
      <div className="avatar-xs">
        <span className="avatar-title rounded bg-info-subtle text-info fs-4">
          <i className={icon}></i>
        </span>
      </div>
      <h5 className="fs-15 mb-0 flex-grow-1">{title}</h5>
      <span className="badge bg-info-subtle text-info">{badge}</span>
    </div>
  );

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-info me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              {isEdit ? 'Edit Branch' : 'Add New Branch'}
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Branches</a></li>
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

      {(Object.keys(validationErrors).length > 0 || Object.keys(serverErrors).filter(k => k !== 'general').length > 0) && (
        <Alert color="danger" className="d-flex align-items-start gap-2">
          <i className="ri-error-warning-line mt-1"></i>
          <div className="flex-grow-1">
            <strong className="d-block mb-1">
              {Object.keys({ ...validationErrors, ...serverErrors }).filter(k => k !== 'general').length} field{Object.keys({ ...validationErrors, ...serverErrors }).filter(k => k !== 'general').length !== 1 ? 's' : ''} need attention:
            </strong>
            <div className="d-flex flex-wrap gap-1">
              {Object.keys({ ...validationErrors, ...serverErrors }).filter(k => k !== 'general').map(k => (
                <span key={k} className="badge bg-danger-subtle text-danger fs-11 fw-medium">
                  {FIELD_LABELS[k] || k}
                </span>
              ))}
            </div>
          </div>
        </Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="d-flex align-items-center justify-content-between">
            <div>
              <h5 className="card-title mb-0">Branch Form</h5>
              <p className="text-muted mb-0 fs-13">{isEdit ? 'Update branch details' : 'Register a new branch with login credentials'}</p>
            </div>
            <span className="badge bg-info-subtle text-info">{isEdit ? 'Edit Mode' : 'New Branch'}</span>
          </CardHeader>

          <CardBody>
            {/* A: Branch details */}
            <SectionHeader icon="ri-git-branch-line" title="Branch Details" badge="Section A" />
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Branch Name <span className="text-danger">*</span></Label>
                <Input name="name" value={form.name} invalid={fieldInvalid('name')}
                  onChange={e => set('name', e.target.value)} onBlur={() => touch('name')} placeholder="e.g., Head Office" />
                <FormFeedback>{fieldError('name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Branch Code</Label>
                <Input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="HO-MUM" maxLength={20} />
              </Col>
              <Col md={4}>
                <Label>Branch Type</Label>
                <Input type="select" value={form.branch_type} onChange={e => set('branch_type', e.target.value)}>
                  <option value="">Select type</option>
                  <option value="company">Company</option>
                  <option value="division">Division</option>
                  <option value="factory">Factory</option>
                  <option value="warehouse">Warehouse</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Industry</Label>
                <Input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="e.g., Manufacturing" />
              </Col>
              <Col md={4}>
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={e => set('contact_person', e.target.value)} placeholder="Name of contact person" />
              </Col>
              <Col md={4}>
                <Label>Status</Label>
                <Input type="select" value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Email</Label>
                <Input name="email" type="email" value={form.email} invalid={fieldInvalid('email')}
                  onChange={e => set('email', e.target.value)} onBlur={() => touch('email')} placeholder="branch@company.com" />
                <FormFeedback>{fieldError('email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Phone</Label>
                <Input name="phone" type="tel" value={form.phone} invalid={fieldInvalid('phone')}
                  onChange={e => set('phone', e.target.value)} onBlur={() => touch('phone')} placeholder="+91 9876543210" />
                <FormFeedback>{fieldError('phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Website</Label>
                <Input type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="www.branch.com" />
              </Col>
              <Col xs={12}>
                <Label>Description</Label>
                <Input type="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description of this branch..." />
              </Col>
            </Row>

            {/* B: Main branch + limits */}
            <SectionHeader icon="ri-star-line" title="Main Branch & Limits" badge="Section B" />
            <Alert color="warning" className="d-flex align-items-center py-2">
              <i className="ri-information-line me-2"></i>
              Main Branch users can view all branches data. Only one branch can be main at a time.
            </Alert>
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Is Main Branch?</Label>
                <Input type="select" value={form.is_main} onChange={e => set('is_main', e.target.value)}>
                  <option value="false">No (Regular Branch)</option>
                  <option value="true">Yes (Main / Head Office)</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Max Users (0 = unlimited)</Label>
                <Input name="max_users" type="number" min={0} value={form.max_users} invalid={fieldInvalid('max_users')}
                  onChange={e => set('max_users', e.target.value)} onBlur={() => touch('max_users')} />
                <FormFeedback>{fieldError('max_users')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Established Date</Label>
                <Input type="date" value={form.established_at} onChange={e => set('established_at', e.target.value)} />
              </Col>
            </Row>

            {/* C: Address */}
            <SectionHeader icon="ri-map-pin-line" title="Address Details" badge="Section C" />
            <Row className="g-3 mb-4">
              <Col xs={12}>
                <Label>Street Address</Label>
                <Input type="textarea" rows={1} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Plot No, Street, Landmark..." />
              </Col>
              <Col md={4}>
                <Label>City</Label>
                <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="e.g., Mumbai" />
              </Col>
              <Col md={4}>
                <Label>District</Label>
                <Input value={form.district} onChange={e => set('district', e.target.value)} placeholder="e.g., Mumbai" />
              </Col>
              <Col md={4}>
                <Label>Taluka</Label>
                <Input value={form.taluka} onChange={e => set('taluka', e.target.value)} />
              </Col>
              <Col md={4}>
                <Label>Pincode</Label>
                <Input name="pincode" value={form.pincode} invalid={fieldInvalid('pincode')} maxLength={6}
                  onChange={e => set('pincode', e.target.value)} onBlur={() => touch('pincode')} placeholder="400001" />
                <FormFeedback>{fieldError('pincode')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>State</Label>
                <Input type="select" value={form.state} onChange={e => set('state', e.target.value)}>
                  <option value="">Select state</option>
                  {['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','Telangana','West Bengal'].map(s => <option key={s} value={s}>{s}</option>)}
                </Input>
              </Col>
              <Col md={4}>
                <Label>Country</Label>
                <Input type="select" value={form.country} onChange={e => set('country', e.target.value)}>
                  <option value="India">India</option>
                  <option value="USA">USA</option>
                  <option value="UK">UK</option>
                </Input>
              </Col>
            </Row>

            {/* D: Legal */}
            <SectionHeader icon="ri-file-text-line" title="Legal & Registration" badge="Section D" />
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>GST Number</Label>
                <Input name="gst_number" value={form.gst_number} invalid={fieldInvalid('gst_number')} maxLength={15}
                  onChange={e => set('gst_number', e.target.value.toUpperCase())} onBlur={() => touch('gst_number')} placeholder="27AABCU9603R1ZM" />
                <FormFeedback>{fieldError('gst_number')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>PAN Number</Label>
                <Input name="pan_number" value={form.pan_number} invalid={fieldInvalid('pan_number')} maxLength={10}
                  onChange={e => set('pan_number', e.target.value.toUpperCase())} onBlur={() => touch('pan_number')} placeholder="AABCU9603R" />
                <FormFeedback>{fieldError('pan_number')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Registration Number</Label>
                <Input value={form.registration_number} onChange={e => set('registration_number', e.target.value)} placeholder="REG-XXXX-XXXX" />
              </Col>
            </Row>

            {/* E: Branch user credentials */}
            <SectionHeader icon="ri-user-line" title={isEdit ? 'Branch User Credentials' : 'Branch User Credentials (Required)'} badge="Section E" />
            <Alert color={isEdit ? 'info' : 'warning'} className="d-flex align-items-center py-2">
              <i className={`${isEdit ? 'ri-lock-line' : 'ri-error-warning-line'} me-2`}></i>
              {isEdit
                ? 'Update the login user for this branch. Leave password blank to keep current.'
                : 'Name, Email and Password are required — this creates the first login user for this branch.'}
            </Alert>
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label>Full Name {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input name="user_name" value={form.user_name} invalid={fieldInvalid('user_name')}
                  onChange={e => set('user_name', e.target.value)} onBlur={() => touch('user_name')} placeholder="User full name" />
                <FormFeedback>{fieldError('user_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Email {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input name="user_email" type="email" value={form.user_email} invalid={fieldInvalid('user_email')}
                  onChange={e => set('user_email', e.target.value)} onBlur={() => touch('user_email')} placeholder="user@branch.com" />
                <FormFeedback>{fieldError('user_email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Phone</Label>
                <Input type="tel" value={form.user_phone} onChange={e => set('user_phone', e.target.value)} placeholder="+91 9876543210" />
              </Col>
              <Col md={4}>
                <Label>Designation</Label>
                <Input value={form.user_designation} onChange={e => set('user_designation', e.target.value)} placeholder="Branch Manager" />
              </Col>
              <Col md={4}>
                <Label>{isEdit ? 'New Password' : 'Password'} {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input name="user_password" type="password" value={form.user_password} invalid={fieldInvalid('user_password')}
                  onChange={e => set('user_password', e.target.value)} onBlur={() => touch('user_password')}
                  placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} />
                <FormFeedback>{fieldError('user_password')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>Confirm Password {!isEdit && <span className="text-danger">*</span>}</Label>
                <Input name="user_password_confirmation" type="password" value={form.user_password_confirmation}
                  invalid={fieldInvalid('user_password_confirmation')}
                  onChange={e => set('user_password_confirmation', e.target.value)}
                  onBlur={() => touch('user_password_confirmation')} placeholder="Re-enter password" />
                <FormFeedback>{fieldError('user_password_confirmation')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Label>User Status</Label>
                <Input type="select" value={form.user_status} onChange={e => set('user_status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Input>
              </Col>
            </Row>

            {/* F: Notes */}
            <SectionHeader icon="ri-sticky-note-line" title="Notes" badge="Section F" />
            <Row className="g-3 mb-3">
              <Col xs={12}>
                <Label>Internal Notes</Label>
                <Input type="textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any internal notes about this branch..." />
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
                  {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </Form>
    </>
  );
}
