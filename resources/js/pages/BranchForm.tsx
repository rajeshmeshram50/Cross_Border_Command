import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Input, { Select, Textarea } from '../components/ui/Input';
import Button from '../components/ui/Button';
import api from '../api';
import {
  ArrowLeft, Save, RotateCcw, GitBranch, MapPin, FileText,
  Building, Users, Star, Loader2, CheckCircle, AlertCircle, Lock, User
} from 'lucide-react';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  name: '', code: '', email: '', phone: '', website: '', contact_person: '',
  branch_type: '', industry: '', description: '',
  gst_number: '', pan_number: '', registration_number: '',
  address: '', city: '', district: '', taluka: '', pincode: '', state: '', country: 'India',
  is_main: false, max_users: '0', established_at: '',
  status: 'active', notes: '',
  // Branch user credentials
  user_name: '', user_email: '', user_phone: '', user_designation: '',
  user_password: '', user_password_confirmation: '', user_status: 'active',
};

export default function BranchForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState('');

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/branches/${editId}`).then(res => {
      const b = res.data.branch;
      const u = res.data.branch_user;
      setForm({
        name: b.name || '', code: b.code || '', email: b.email || '',
        phone: b.phone || '', website: b.website || '', contact_person: b.contact_person || '',
        branch_type: b.branch_type || '', industry: b.industry || '', description: b.description || '',
        gst_number: b.gst_number || '', pan_number: b.pan_number || '', registration_number: b.registration_number || '',
        address: b.address || '', city: b.city || '', district: b.district || '',
        taluka: b.taluka || '', pincode: b.pincode || '', state: b.state || '', country: b.country || 'India',
        is_main: b.is_main || false, max_users: String(b.max_users ?? 0), established_at: b.established_at || '',
        status: b.status || 'active', notes: b.notes || '',
        user_name: u?.name || '', user_email: u?.email || '',
        user_phone: u?.phone || '', user_designation: u?.designation || '',
        user_password: '', user_password_confirmation: '', user_status: u?.status || 'active',
      });
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleSubmit = async () => {
    setErrors({});
    setSuccess('');
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      // Remove confirmation field
      delete payload.user_password_confirmation;
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      payload.name = form.name;
      payload.status = form.status;
      payload.is_main = form.is_main;
      payload.max_users = parseInt(form.max_users) || 0;
      if (!isEdit) {
        payload.user_name = form.user_name;
        payload.user_email = form.user_email;
        payload.user_password = form.user_password;
      }

      if (isEdit) {
        await api.put(`/branches/${editId}`, payload);
        setSuccess('Branch updated successfully!');
      } else {
        await api.post('/branches', payload);
        setSuccess('Branch created successfully!');
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
        <Loader2 size={20} className="animate-spin mr-2" /> Loading branch data...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Page Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <GitBranch size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-extrabold text-text tracking-tight">
              {isEdit ? 'Edit Branch / Company' : 'Add New Branch / Company'}
            </h1>
            <p className="text-[12px] text-muted mt-0.5">
              {isEdit ? 'Update branch details and user credentials' : 'Register a new branch or company with login credentials'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={13} /> Back to Branches</Button>
      </div>

      {/* Banners */}
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

        {/* ═══ SECTION A: Branch / Company Details ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center"><Building size={14} className="text-sky-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Branch / Company Details</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section A</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-2 text-[12px] text-sky-700">
              <Building size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                <strong>Branch represents a company or division</strong> under your organization group.
                E.g., IGC Group → Healthcare Pvt. Ltd., Agrotech Pvt. Ltd., Trading Co.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Input label="Branch / Company Name" required placeholder="e.g. Inorbvict Agrotech Pvt. Ltd." value={form.name} onChange={e => set('name', e.target.value)} error={fieldError('name')} />
              <Input label="Branch Code" placeholder="e.g. AGRO, HQ, EAST" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} />
              <Select label="Branch Type" value={form.branch_type} onChange={e => set('branch_type', e.target.value)}>
                <option value="">Select Type</option>
                <option value="company">Company / Subsidiary</option>
                <option value="division">Division</option>
                <option value="unit">Unit</option>
                <option value="office">Office</option>
                <option value="warehouse">Warehouse</option>
                <option value="factory">Factory / Plant</option>
                <option value="showroom">Showroom</option>
                <option value="other">Other</option>
              </Select>
              <Input label="Industry / Sector" placeholder="e.g. Healthcare, Agriculture, IT" value={form.industry} onChange={e => set('industry', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select label="Status" required value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Input label="Established Date" type="date" value={form.established_at} onChange={e => set('established_at', e.target.value)} />
              <Input label="Max Users Allowed" type="number" placeholder="0 = unlimited" value={form.max_users} onChange={e => set('max_users', e.target.value)} />
              <div className="flex flex-col gap-1">
                <label className="text-[11.5px] font-semibold text-text">Main Branch</label>
                <div className="flex items-center gap-3 h-[38px]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_main}
                      onChange={e => set('is_main', e.target.checked)}
                      className="w-4.5 h-4.5 accent-amber-500 rounded"
                    />
                    <div className="flex items-center gap-1.5">
                      <Star size={12} className={form.is_main ? 'text-amber-500' : 'text-muted'} />
                      <span className={`text-[12px] font-semibold ${form.is_main ? 'text-amber-600' : 'text-muted'}`}>
                        {form.is_main ? 'This is the Main Branch' : 'Set as Main Branch'}
                      </span>
                    </div>
                  </label>
                </div>
                {form.is_main && (
                  <span className="text-[10px] text-amber-600">Main branch users can see all branches data</span>
                )}
              </div>
            </div>
            <div className="mt-4">
              <Textarea label="Description" placeholder="Brief description of this branch/company and its operations..." rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {/* ═══ SECTION B: Contact Information ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Users size={14} className="text-emerald-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Contact Information</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section B</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label="Contact Person" placeholder="e.g. Durgesh Urkude" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
              <Input label="Email" type="email" placeholder="branch@company.com" value={form.email} onChange={e => set('email', e.target.value)} error={fieldError('email')} />
              <Input label="Phone" type="tel" placeholder="+91 9876543210" value={form.phone} onChange={e => set('phone', e.target.value)} />
              <Input label="Website" type="url" placeholder="www.branch.com" value={form.website} onChange={e => set('website', e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {/* ═══ SECTION C: Address Details ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center"><MapPin size={14} className="text-violet-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Address Details</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section C</span>
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

        {/* ═══ SECTION D: Legal & Tax ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center"><FileText size={14} className="text-amber-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Legal & Tax Information</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section D — Optional</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-4 flex items-center gap-2 text-[12px] text-amber-700">
              <FileText size={14} />
              Each branch/company may have its own GST, PAN, and registration number.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label="GST Number" placeholder="e.g. 27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={e => set('gst_number', e.target.value)} />
              <Input label="PAN Number" placeholder="e.g. AABCU9603R" maxLength={10} value={form.pan_number} onChange={e => set('pan_number', e.target.value)} />
              <Input label="Registration / CIN Number" placeholder="e.g. U01100MH2020PTC123456" value={form.registration_number} onChange={e => set('registration_number', e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {/* ═══ SECTION E: Branch User Login Credentials ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center"><Lock size={14} className="text-red-500" /></div>
              <div>
                <span className="text-[13px] font-bold text-text">Branch User — Login Credentials</span>
                <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section E</span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-2 text-[12px] text-primary">
              <User size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                <strong>This creates the login user (Branch User)</strong> for this branch/company.
                The branch user will use these credentials to sign in and manage their branch data and employees.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Input label="User Full Name" required={!isEdit} placeholder="e.g. Durgesh Urkude" value={form.user_name} onChange={e => set('user_name', e.target.value)} error={fieldError('user_name')} />
              <Input label="User Email (Login)" required={!isEdit} type="email" placeholder="user@branch.com" value={form.user_email} onChange={e => set('user_email', e.target.value)} error={fieldError('user_email')} />
              <Input label="User Phone" type="tel" placeholder="+91 9876543210" value={form.user_phone} onChange={e => set('user_phone', e.target.value)} />
              <Input label="Designation" placeholder="e.g. Manager, Head, Director" value={form.user_designation} onChange={e => set('user_designation', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label={isEdit ? 'New Password (leave blank to keep)' : 'Password'} required={!isEdit} type="password" placeholder="Set initial password" value={form.user_password} onChange={e => set('user_password', e.target.value)} error={fieldError('user_password')} />
              <Input label="Confirm Password" required={!isEdit} type="password" placeholder="Confirm password" value={form.user_password_confirmation} onChange={e => set('user_password_confirmation', e.target.value)} />
              <Select label="User Status" value={form.user_status} onChange={e => set('user_status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending Activation</option>
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* ═══ SECTION F: Additional Notes ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-500/10 flex items-center justify-center"><FileText size={14} className="text-slate-500" /></div>
              <span className="text-[13px] font-bold text-text">Additional Notes</span>
            </div>
          </CardHeader>
          <CardBody>
            <Textarea label="Internal Notes" placeholder="Any internal notes about this branch..." rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </CardBody>
        </Card>

        {/* ═══ FOOTER ═══ */}
        <div className="sticky bottom-0 left-0 right-0 bg-surface border-t border-border px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between z-[50]">
          <div className="text-[12px] text-muted flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            All changes saved only when you click <strong className="ml-0.5">{isEdit ? 'Update' : 'Create'} Branch</strong>
          </div>
          <div className="flex gap-2.5">
            <Button variant="ghost" size="sm" onClick={onBack}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={() => setForm(empty)}><RotateCcw size={12} /> Reset</Button>
            <Button size="md" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
