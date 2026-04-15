import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Input, { Select, Textarea, FileUpload } from '../components/ui/Input';
import Button from '../components/ui/Button';
import api from '../api';
import {
  ArrowLeft, Save, RotateCcw, Building2, MapPin,
  FileText, CreditCard, Palette, User, Lock, Loader2, CheckCircle, AlertCircle
} from 'lucide-react';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  org_name: '', org_type: '', email: '', phone: '', website: '', status: 'inactive',
  sports: '', industry: '',
  address: '', city: '', district: '', taluka: '', pincode: '', state: '', country: 'India',
  gst_number: '', pan_number: '',
  plan_id: '', plan_type: 'free', plan_expires_at: '',
  primary_color: '#4F46E5', secondary_color: '#10B981',
  notes: '',
  admin_name: '', admin_email: '', admin_phone: '', admin_designation: '',
  admin_password: '', admin_password_confirmation: '', admin_status: 'active',
};

export default function ClientForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState(empty);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState('');

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  // Load existing client for edit
  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/clients/${editId}`).then(res => {
      const c = res.data.client;
      const admin = res.data.admin_user;
      setForm({
        org_name: c.org_name || '', org_type: c.org_type || '', email: c.email || '',
        phone: c.phone || '', website: c.website || '', status: c.status || 'inactive',
        sports: c.sports || '', industry: c.industry || '',
        address: c.address || '', city: c.city || '', district: c.district || '',
        taluka: c.taluka || '', pincode: c.pincode || '', state: c.state || '', country: c.country || 'India',
        gst_number: c.gst_number || '', pan_number: c.pan_number || '',
        plan_id: c.plan_id?.toString() || '', plan_type: c.plan_type || 'free',
        plan_expires_at: c.plan_expires_at || '',
        primary_color: c.primary_color || '#4F46E5', secondary_color: c.secondary_color || '#10B981',
        notes: c.notes || '',
        admin_name: admin?.name || '', admin_email: admin?.email || '',
        admin_phone: admin?.phone || '', admin_designation: admin?.designation || '',
        admin_password: '', admin_password_confirmation: '', admin_status: admin?.status || 'active',
      });
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    setErrors({});
    setSuccess('');
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      // Clean empty strings to null for optional fields
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      // Required fields back to string
      payload.org_name = form.org_name;
      payload.org_type = form.org_type;
      payload.email = form.email;
      payload.status = form.status;
      if (!isEdit) {
        payload.admin_name = form.admin_name;
        payload.admin_email = form.admin_email;
        payload.admin_password = form.admin_password;
      }

      if (isEdit) {
        await api.put(`/clients/${editId}`, payload);
        setSuccess('Client updated successfully!');
      } else {
        await api.post('/clients', payload);
        setSuccess('Client created successfully!');
        setTimeout(() => onBack(), 1500);
      }
    } catch (err: any) {
      if (err.response?.status === 422) {
        setErrors(err.response.data.errors || {});
      } else {
        setErrors({ general: [err.response?.data?.message || 'Something went wrong'] });
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => errors[key]?.[0];

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-20 text-muted text-[13px]">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading client data...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Page Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-400 flex items-center justify-center shadow-lg shadow-primary/20">
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-extrabold text-text tracking-tight">
              {isEdit ? 'Edit Client' : 'Add New Client'}
            </h1>
            <p className="text-[12px] text-muted mt-0.5">
              {isEdit ? 'Update organization details' : 'Register a new organization with login credentials'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={13} /> Back to Clients</Button>
        </div>
      </div>

      {/* Success / Error banners */}
      {success && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
          <CheckCircle size={14} /> {success}
        </div>
      )}
      {errors.general && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600">
          <AlertCircle size={14} /> {errors.general[0]}
        </div>
      )}

      <div className="space-y-5">

        {/* SECTION 1: Organization Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center"><Building2 size={14} className="text-primary" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Organization Details</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section A</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Input label="Organization Name" required placeholder="e.g. Rajesh Meshram Enterprises" value={form.org_name} onChange={e => set('org_name', e.target.value)} error={fieldError('org_name')} />
              <Input label="Unique Number" placeholder="Auto-generated" disabled className="bg-bg" />
              <Select label="Organization Type" required value={form.org_type} onChange={e => set('org_type', e.target.value)}>
                <option value="">Select Type</option>
                <option value="Business">Business</option>
                <option value="Sports">Sports</option>
                <option value="Education">Education</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Government">Government</option>
                <option value="NGO">NGO / Non-Profit</option>
                <option value="Other">Other</option>
              </Select>
              {form.org_type === 'Sports' ? (
                <Input label="Sport Name" placeholder="e.g. Hockey, Boxing" value={form.sports} onChange={e => set('sports', e.target.value)} />
              ) : (
                <Input label="Industry" placeholder="e.g. Agriculture, IT" value={form.industry} onChange={e => set('industry', e.target.value)} />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label="Email" required type="email" placeholder="admin@company.com" value={form.email} onChange={e => set('email', e.target.value)} error={fieldError('email')} />
              <Input label="Phone" type="tel" placeholder="+91 9876543210" value={form.phone} onChange={e => set('phone', e.target.value)} />
              <Input label="Website" type="url" placeholder="www.company.com" value={form.website} onChange={e => set('website', e.target.value)} />
              <Select label="Status" required value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="">Select Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* SECTION 2: Address Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center"><MapPin size={14} className="text-sky-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Address Details</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section B</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Textarea label="Full Address" placeholder="Plot No, Street, Landmark..." rows={2} value={form.address} onChange={e => set('address', e.target.value)} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="City" placeholder="e.g. Nagpur" value={form.city} onChange={e => set('city', e.target.value)} />
                <Input label="District" placeholder="e.g. Nagpur" value={form.district} onChange={e => set('district', e.target.value)} />
                <Input label="Taluka" placeholder="e.g. Nagpur" value={form.taluka} onChange={e => set('taluka', e.target.value)} />
                <Input label="Pincode" placeholder="e.g. 440001" maxLength={6} value={form.pincode} onChange={e => set('pincode', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select label="State" value={form.state} onChange={e => set('state', e.target.value)}>
                <option value="">Select State</option>
                {['Andhra Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh',
                  'Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
                  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
                  'Uttarakhand','West Bengal'].map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select label="Country" value={form.country} onChange={e => set('country', e.target.value)}>
                <option value="India">India</option>
                <option value="USA">USA</option>
                <option value="UK">UK</option>
                <option value="UAE">UAE</option>
                <option value="Other">Other</option>
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* SECTION 3: Legal & Tax */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center"><FileText size={14} className="text-amber-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Legal & Tax Information</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section C</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label="GST Number" placeholder="e.g. 27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={e => set('gst_number', e.target.value)} />
              <Input label="PAN Number" placeholder="e.g. AABCU9603R" maxLength={10} value={form.pan_number} onChange={e => set('pan_number', e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {/* SECTION 4: Plan & Billing */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CreditCard size={14} className="text-emerald-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Plan & Billing</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section D</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-4 flex items-center gap-2 text-[12px] text-amber-700">
              <CreditCard size={14} />
              Client must complete payment after creation to activate their account. Default status: <strong className="ml-1">Inactive</strong>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select label="Assign Plan" value={form.plan_id} onChange={e => set('plan_id', e.target.value)}>
                <option value="">No Plan (Free)</option>
                <option value="1">Starter — ₹0/mo</option>
                <option value="2">Basic — ₹1,999/mo</option>
                <option value="3">Pro — ₹4,999/mo</option>
                <option value="4">Business — ₹9,999/mo</option>
                <option value="5">Enterprise — ₹14,999/mo</option>
                <option value="6">Custom</option>
              </Select>
              <Select label="Plan Type" value={form.plan_type} onChange={e => set('plan_type', e.target.value)}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </Select>
              <Input label="Plan Expires At" type="date" value={form.plan_expires_at} onChange={e => set('plan_expires_at', e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {/* SECTION 5: Client Admin Login Credentials */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center"><Lock size={14} className="text-red-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Client Admin — Login Credentials</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section E</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-2 text-[12px] text-primary">
              <User size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                <strong>This creates the first login user (Client Admin)</strong> for the organization.
                The client will use these credentials to sign in and manage their branches, users, and data.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Input label="Admin Full Name" required={!isEdit} placeholder="e.g. Rajesh Meshram" value={form.admin_name} onChange={e => set('admin_name', e.target.value)} error={fieldError('admin_name')} />
              <Input label="Admin Email (Login)" required={!isEdit} type="email" placeholder="admin@company.com" value={form.admin_email} onChange={e => set('admin_email', e.target.value)} error={fieldError('admin_email')} />
              <Input label="Admin Phone" type="tel" placeholder="+91 9876543210" value={form.admin_phone} onChange={e => set('admin_phone', e.target.value)} />
              <Input label="Designation" placeholder="e.g. Owner, CEO, Director" value={form.admin_designation} onChange={e => set('admin_designation', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label={isEdit ? 'New Password (leave blank to keep)' : 'Password'} required={!isEdit} type="password" placeholder="Set initial password" value={form.admin_password} onChange={e => set('admin_password', e.target.value)} error={fieldError('admin_password')} />
              <Input label="Confirm Password" required={!isEdit} type="password" placeholder="Confirm password" value={form.admin_password_confirmation} onChange={e => set('admin_password_confirmation', e.target.value)} />
              <Select label="Admin Status" value={form.admin_status} onChange={e => set('admin_status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending Activation</option>
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* SECTION 6: Branding */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center"><Palette size={14} className="text-purple-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Branding & White Label</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section F — Optional</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11.5px] font-semibold text-text">Primary Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5" />
                  <Input placeholder="#4F46E5" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} className="flex-1" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11.5px] font-semibold text-text">Secondary Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5" />
                  <Input placeholder="#10B981" value={form.secondary_color} onChange={e => set('secondary_color', e.target.value)} className="flex-1" />
                </div>
              </div>
              <FileUpload label="Organization Logo" hint="PNG, JPG — Max 2MB" accept="image/*" onChange={handleLogoChange} />
              <div className="flex flex-col gap-1">
                <label className="text-[11.5px] font-semibold text-text">Logo Preview</label>
                <div className="w-full h-[88px] rounded-xl border-2 border-dashed border-border bg-surface-2 flex items-center justify-center overflow-hidden">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Preview" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <span className="text-[11px] text-muted">No logo uploaded</span>
                  )}
                </div>
              </div>
            </div>
            <FileUpload label="Favicon" hint="ICO, PNG — 32×32 recommended" accept="image/*" />
          </CardBody>
        </Card>

        {/* SECTION 7: Notes */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-500/10 flex items-center justify-center"><FileText size={14} className="text-slate-500" /></div>
              <span className="text-[13px] font-bold text-text">Additional Notes</span>
            </div>
          </CardHeader>
          <CardBody>
            <Textarea label="Internal Notes" placeholder="Any internal notes about this client (not visible to client)..." rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </CardBody>
        </Card>

        {/* FOOTER */}
        <div className="sticky bottom-0 left-0 right-0 bg-surface border-t border-border px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between z-[50]">
          <div className="text-[12px] text-muted flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            All changes saved only when you click <strong className="ml-0.5">{isEdit ? 'Update' : 'Create'} Client</strong>
          </div>
          <div className="flex gap-2.5">
            <Button variant="ghost" size="sm" onClick={onBack}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={() => setForm(empty)}><RotateCcw size={12} /> Reset</Button>
            <Button size="md" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving...' : isEdit ? 'Update Client' : 'Create Client'}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
