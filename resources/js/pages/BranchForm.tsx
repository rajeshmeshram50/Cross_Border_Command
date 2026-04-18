import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import Button from '../components/ui/Button';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Save, RotateCcw, GitBranch, MapPin, FileText,
  User, Lock, Loader2, AlertCircle,
  Phone, Mail, Briefcase, Info, Calendar,
} from 'lucide-react';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  name: '',
  code: '',
  email: '',
  phone: '',
  website: '',
  contact_person: '',
  branch_type: '',
  industry: '',
  description: '',
  gst_number: '',
  pan_number: '',
  registration_number: '',
  address: '',
  city: '',
  district: '',
  taluka: '',
  pincode: '',
  state: '',
  country: 'India',
  is_main: 'false',
  max_users: '0',
  established_at: '',
  status: 'active',
  notes: '',
  user_name: '',
  user_email: '',
  user_phone: '',
  user_designation: '',
  user_password: '',
  user_password_confirmation: '',
  user_status: 'active',
};

type FormState = typeof empty;

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
  if (!isEdit) {
    if (!form.user_name?.trim()) e.user_name = 'User name is required';
    if (!form.user_email?.trim()) e.user_email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.user_email)) e.user_email = 'Invalid email format';
    if (!form.user_password) e.user_password = 'Password is required';
    else if (form.user_password.length < 6) e.user_password = 'Minimum 6 characters';
  } else {
    if (form.user_password && form.user_password.length < 6) e.user_password = 'Minimum 6 characters';
  }
  if (form.user_password && form.user_password !== form.user_password_confirmation)
    e.user_password_confirmation = 'Passwords do not match';
  return e;
}

const inputCls = 'w-full bg-bg text-[12.5px] text-text placeholder:text-muted/40 rounded-lg border border-border px-3 py-2.5 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all hover:border-border/80';

const LabelRightInput = memo(({ label, required, icon: Icon, placeholder, value, onChange, onBlur, error, type = 'text', maxLength, helperText }: {
  label: string; required?: boolean; icon?: React.ElementType; placeholder?: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void; error?: string; type?: string; maxLength?: number; helperText?: string;
}) => (
  <div>
    <label className="text-[11px] font-semibold text-text mb-1 block">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="relative">
      {Icon && <Icon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />}
      <input type={type} placeholder={placeholder} value={value} onChange={onChange} onBlur={onBlur} maxLength={maxLength}
        className={`${inputCls} ${Icon ? 'pl-8' : ''} ${error ? '!border-red-400 !ring-red-100 focus:!border-red-400' : ''}`} />
    </div>
    {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
    {helperText && !error && <p className="text-[10px] text-muted mt-1">{helperText}</p>}
  </div>
));

const LabelRightSelect = memo(({ label, required, icon: Icon, value, onChange, error, children }: {
  label: string; required?: boolean; icon?: React.ElementType;
  value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  error?: string; children: React.ReactNode;
}) => (
  <div>
    <label className="text-[11px] font-semibold text-text mb-1 block">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="relative">
      {Icon && <Icon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />}
      <select value={value} onChange={onChange}
        className={`${inputCls} ${Icon ? 'pl-8' : ''} cursor-pointer appearance-none ${error ? '!border-red-400 !ring-red-100' : ''}`}>
        {children}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
    {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
  </div>
));

const LabelRightTextarea = memo(({ label, placeholder, value, onChange, rows = 2, required, error, onBlur }: {
  label: string; placeholder?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; rows?: number;
  required?: boolean; error?: string; onBlur?: () => void;
}) => (
  <div>
    <label className="text-[11px] font-semibold text-text mb-1 block">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <textarea placeholder={placeholder} value={value} onChange={onChange} onBlur={onBlur} rows={rows}
      className={`${inputCls} resize-none leading-relaxed ${error ? '!border-red-400 !ring-red-100' : ''}`} />
    {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
  </div>
));

const SectionHeader = ({ icon: Icon, title, badge }: { icon?: React.ElementType; title: string; badge?: string }) => (
  <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-border/50">
    {Icon && <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Icon size={15} className="text-primary" /></div>}
    <h3 className="text-[13px] font-bold text-text">{title}</h3>
    {badge && <span className="text-[9px] font-bold text-muted bg-surface-2 px-2 py-0.5 rounded-md border border-border/50">{badge}</span>}
  </div>
);

export default function BranchForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState<FormState>(empty);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const set = useCallback((key: keyof FormState, val: string) => {
    setForm(f => (f[key] === val ? f : { ...f, [key]: val }));
    setValidationErrors(e => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });
  }, []);

  const touch = useCallback((key: string) => {
    touchedRef.current[key] = true;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setForm(current => {
        const liveErrors = validateBranchForm(current, isEdit);
        setValidationErrors(prev => {
          const next = { ...prev };
          Object.keys(touchedRef.current).forEach(k => { if (liveErrors[k]) next[k] = liveErrors[k]; else delete next[k]; });
          return next;
        });
        return current;
      });
    }, 300);
  }, [isEdit]);

  const handlers = useMemo(() => {
    const inputChange = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value);
    const selectChange = (key: keyof FormState) => (e: React.ChangeEvent<HTMLSelectElement>) => set(key, e.target.value);
    const textareaChange = (key: keyof FormState) => (e: React.ChangeEvent<HTMLTextAreaElement>) => set(key, e.target.value);
    const blurKey = (key: string) => () => touch(key);
    return { inputChange, selectChange, textareaChange, blurKey };
  }, [set, touch]);

  const setUpper = useCallback((key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value.toUpperCase()), [set]);
  const fieldError = useCallback((key: string) => serverErrors[key]?.[0] || validationErrors[key], [serverErrors, validationErrors]);

  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/branches/${editId}`).then(res => {
      const b = res.data.branch;
      const u = res.data.branch_user;
      setForm({
        name: b.name || '',
        code: b.code || '',
        email: b.email || '',
        phone: b.phone || '',
        website: b.website || '',
        contact_person: b.contact_person || '',
        branch_type: b.branch_type || '',
        industry: b.industry || '',
        description: b.description || '',
        gst_number: b.gst_number || '',
        pan_number: b.pan_number || '',
        registration_number: b.registration_number || '',
        address: b.address || '',
        city: b.city || '',
        district: b.district || '',
        taluka: b.taluka || '',
        pincode: b.pincode || '',
        state: b.state || '',
        country: b.country || 'India',
        is_main: b.is_main ? 'true' : 'false',
        max_users: String(b.max_users ?? 0),
        established_at: b.established_at || '',
        status: b.status || 'active',
        notes: b.notes || '',
        user_name: u?.name || '',
        user_email: u?.email || '',
        user_phone: u?.phone || '',
        user_designation: u?.designation || '',
        user_password: '',
        user_password_confirmation: '',
        user_status: u?.status || 'active',
      });
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleSubmit = useCallback(async () => {
    const allKeys = Object.keys(empty) as (keyof FormState)[];
    allKeys.forEach(k => { touchedRef.current[k] = true; });
    const errs = validateBranchForm(form, isEdit);
    if (Object.keys(errs).length) { setValidationErrors(errs); toast.error('Validation Error', 'Please fix the highlighted fields'); return; }
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
        setServerErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally { setSaving(false); }
  }, [form, isEdit, editId, onBack, toast]);

  const handleReset = useCallback(() => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
  }, []);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="mt-3 text-[12px] text-muted">Loading branch data...</p>
      </div>
    );
  }

  const { inputChange, selectChange, textareaChange, blurKey } = handlers;
  const grid3 = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4';
  const grid2 = 'grid grid-cols-1 sm:grid-cols-2 gap-4';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <GitBranch size={16} className="text-sky-500" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">{isEdit ? 'Edit Branch' : 'Add New Branch'}</h1>
            <p className="text-[11px] text-muted mt-0.5">{isEdit ? 'Update branch details and credentials' : 'Register a new branch or company with login credentials'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEdit && <Button variant="outline" size="sm" onClick={handleReset}><RotateCcw size={12} /> Reset</Button>}
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
          </Button>
        </div>
      </div>

      {/* Server Error */}
      {serverErrors.general && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-600">
          <AlertCircle size={13} className="shrink-0" /><span>{serverErrors.general[0]}</span>
        </div>
      )}

      {/* Form Card */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between bg-surface-2/30">
          <div>
            <p className="text-[12px] font-bold text-text">Branch Registration Form</p>
            <p className="text-[10px] text-muted">Fields marked <span className="text-red-500">*</span> are required</p>
          </div>
          <span className="text-[9px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-md px-2 py-0.5">
            {isEdit ? 'Edit Mode' : 'New Branch'}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* Branch Details */}
          <section>
            <SectionHeader icon={GitBranch} title="Branch / Company Details" badge="Section A" />
            <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-sky-50 border border-sky-200/60 text-[11px] text-sky-700">
              <Info size={11} className="shrink-0" /> A branch represents a company or division under your organization group.
            </div>
            <div className={grid3}>
              <LabelRightInput label="Branch Name" required placeholder="e.g., Inorbvict Agrotech Pvt. Ltd." value={form.name} onChange={inputChange('name')} onBlur={blurKey('name')} error={fieldError('name')} />
              <LabelRightInput label="Branch Code" placeholder="e.g., AGRO, HQ, EAST" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
              <LabelRightSelect label="Branch Type" value={form.branch_type} onChange={selectChange('branch_type')}>
                <option value="">Select Type</option>
                <option value="company">Company / Subsidiary</option>
                <option value="division">Division</option>
                <option value="unit">Unit</option>
                <option value="office">Office</option>
                <option value="warehouse">Warehouse</option>
                <option value="factory">Factory / Plant</option>
                <option value="showroom">Showroom</option>
                <option value="other">Other</option>
              </LabelRightSelect>
              <LabelRightInput label="Industry / Sector" placeholder="e.g., Healthcare, Agriculture, IT" value={form.industry} onChange={inputChange('industry')} />
              <LabelRightSelect label="Status" required value={form.status} onChange={selectChange('status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </LabelRightSelect>
              <LabelRightInput label="Established Date" type="date" icon={Calendar} value={form.established_at} onChange={inputChange('established_at')} />
              <LabelRightInput label="Max Users" type="number" placeholder="0 = unlimited" value={form.max_users} onChange={inputChange('max_users')} />
              <LabelRightSelect label="Main Branch" value={form.is_main} onChange={selectChange('is_main')}>
                <option value="false">No</option>
                <option value="true">Yes — Main Branch</option>
              </LabelRightSelect>
            </div>
            <div className="mt-4">
              <LabelRightTextarea label="Description" placeholder="Brief description of this branch/company..." value={form.description} onChange={textareaChange('description')} rows={2} />
            </div>
          </section>

          {/* Contact Information */}
          <section>
            <SectionHeader icon={Phone} title="Contact Information" badge="Section B" />
            <div className={grid3}>
              <LabelRightInput label="Contact Person" placeholder="e.g., Rajesh Meshram" value={form.contact_person} onChange={inputChange('contact_person')} />
              <LabelRightInput label="Email" type="email" icon={Mail} placeholder="branch@company.com" value={form.email} onChange={inputChange('email')} onBlur={blurKey('email')} error={fieldError('email')} />
              <LabelRightInput label="Phone" type="tel" icon={Phone} placeholder="+91 9876543210" value={form.phone} onChange={inputChange('phone')} onBlur={blurKey('phone')} error={fieldError('phone')} />
              <LabelRightInput label="Website" type="url" placeholder="www.branch.com" value={form.website} onChange={inputChange('website')} />
            </div>
          </section>

          {/* Address Details */}
          <section>
            <SectionHeader icon={MapPin} title="Address Details" badge="Section C" />
            <div className="mb-4">
              <LabelRightTextarea label="Street Address" placeholder="Plot No, Street, Landmark..." value={form.address} onChange={textareaChange('address')} rows={1} />
            </div>
            <div className={grid3}>
              <LabelRightInput label="City" placeholder="e.g., Nagpur" value={form.city} onChange={inputChange('city')} />
              <LabelRightInput label="District" placeholder="e.g., Nagpur" value={form.district} onChange={inputChange('district')} />
              <LabelRightInput label="Taluka" placeholder="e.g., Nagpur" value={form.taluka} onChange={inputChange('taluka')} />
              <LabelRightInput label="Pincode" placeholder="440001" maxLength={6} value={form.pincode} onChange={inputChange('pincode')} onBlur={blurKey('pincode')} error={fieldError('pincode')} />
              <LabelRightSelect label="State" value={form.state} onChange={selectChange('state')}>
                <option value="">Select state</option>
                {['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','Telangana','West Bengal'].map(s => <option key={s} value={s}>{s}</option>)}
              </LabelRightSelect>
              <LabelRightSelect label="Country" value={form.country} onChange={selectChange('country')}>
                <option value="India">India</option><option value="USA">USA</option><option value="UK">UK</option><option value="UAE">UAE</option>
              </LabelRightSelect>
            </div>
          </section>

          {/* Legal & Tax */}
          <section>
            <SectionHeader icon={FileText} title="Legal & Tax Information" badge="Section D" />
            {form.country === 'India' && (
              <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200/60 text-[11px] text-amber-700">
                <Info size={11} className="shrink-0" /> Each branch/company may have its own GST, PAN, and registration number.
              </div>
            )}
            <div className={grid3}>
              <LabelRightInput label="GST Number" placeholder="27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={setUpper('gst_number')} onBlur={blurKey('gst_number')} error={fieldError('gst_number')} />
              <LabelRightInput label="PAN Number" placeholder="AABCU9603R" maxLength={10} value={form.pan_number} onChange={setUpper('pan_number')} onBlur={blurKey('pan_number')} error={fieldError('pan_number')} />
              <LabelRightInput label="Registration / CIN" placeholder="U01100MH2020PTC123456" value={form.registration_number} onChange={inputChange('registration_number')} />
            </div>
          </section>

          {/* Branch User Credentials */}
          <section>
            <SectionHeader icon={User} title="Branch User — Login Credentials" badge="Section E" />
            <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-[11px] text-secondary">
              <Lock size={11} className="shrink-0" /> Creates the login user (Branch User) for this branch.
            </div>
            <div className={grid3}>
              <LabelRightInput label="Full Name" required={!isEdit} icon={User} placeholder="e.g., Rajesh Meshram" value={form.user_name} onChange={inputChange('user_name')} onBlur={blurKey('user_name')} error={fieldError('user_name')} />
              <LabelRightInput label="Email (Login)" required={!isEdit} type="email" icon={Mail} placeholder="user@branch.com" value={form.user_email} onChange={inputChange('user_email')} onBlur={blurKey('user_email')} error={fieldError('user_email')} />
              <LabelRightInput label="Phone" type="tel" icon={Phone} placeholder="+91 9876543210" value={form.user_phone} onChange={inputChange('user_phone')} />
              <LabelRightInput label="Designation" icon={Briefcase} placeholder="e.g., Manager, Director" value={form.user_designation} onChange={inputChange('user_designation')} />
              <LabelRightInput label={isEdit ? 'New Password' : 'Password'} type="password" required={!isEdit} icon={Lock} placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} value={form.user_password} onChange={inputChange('user_password')} onBlur={blurKey('user_password')} error={fieldError('user_password')} helperText={isEdit ? 'Leave blank to keep current' : undefined} />
              <LabelRightInput label="Confirm Pwd" type="password" required={!isEdit && !!form.user_password} icon={Lock} placeholder="Re-enter password" value={form.user_password_confirmation} onChange={inputChange('user_password_confirmation')} onBlur={blurKey('user_password_confirmation')} error={fieldError('user_password_confirmation')} />
              <LabelRightSelect label="User Status" value={form.user_status} onChange={selectChange('user_status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending Activation</option>
              </LabelRightSelect>
            </div>
          </section>

          {/* Additional Notes */}
          <section>
            <SectionHeader title="Additional Notes" badge="Section F" />
            <LabelRightTextarea label="Internal Notes" placeholder="Any internal notes about this branch..." value={form.notes} onChange={textareaChange('notes')} rows={2} />
          </section>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={onBack}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
