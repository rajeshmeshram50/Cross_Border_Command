import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import Button from '../components/ui/Button';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Save, RotateCcw, GitBranch, MapPin, FileText,
  Building2, Users, Star, Loader2, AlertCircle, Lock, User,
  Mail, Phone, Briefcase, Shield, Info, Globe, Hash, Calendar,
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

const inputBase =
  'w-full bg-transparent outline-none text-[11px] text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 py-[2px] border-b border-slate-200 dark:border-slate-700 focus:border-blue-500 dark:focus:border-blue-400 transition-colors';
const LABEL_W = 'min-w-[62px] shrink-0';

interface InputProps {
  label: string;
  required?: boolean;
  icon?: React.ElementType;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  error?: string;
  type?: string;
  maxLength?: number;
  helperText?: string;
}

const LabelRightInput = memo(({
  label, required, icon: Icon, placeholder, value, onChange, onBlur,
  error, type = 'text', maxLength, helperText,
}: InputProps) => (
  <div className="flex flex-col">
    <div className="flex items-center gap-[4px]">
      <span className={`${LABEL_W} text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-none`}>
        {label}{required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
      </span>
      <div className="flex-1 relative min-w-0">
        {Icon && <Icon size={10} className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          maxLength={maxLength}
          className={`${inputBase} ${Icon ? 'pl-[14px]' : 'pl-0'} ${error ? '!border-red-500 dark:!border-red-400' : ''}`}
        />
      </div>
    </div>
    {error && <p className="text-[9px] text-red-500 dark:text-red-400 leading-tight mt-0.5 pl-[66px]">{error}</p>}
    {helperText && !error && <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight mt-0.5 pl-[66px]">{helperText}</p>}
  </div>
));

interface SelectProps {
  label: string;
  required?: boolean;
  icon?: React.ElementType;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
  children: React.ReactNode;
}

const LabelRightSelect = memo(({ label, required, icon: Icon, value, onChange, error, children }: SelectProps) => (
  <div className="flex flex-col">
    <div className="flex items-center gap-[4px]">
      <span className={`${LABEL_W} text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-none`}>
        {label}{required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
      </span>
      <div className="flex-1 relative min-w-0">
        {Icon && <Icon size={10} className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />}
        <select
          value={value}
          onChange={onChange}
          className={`${inputBase} ${Icon ? 'pl-[14px]' : 'pl-0'} cursor-pointer appearance-none ${error ? '!border-red-500 dark:!border-red-400' : ''}`}
        >
          {children}
        </select>
      </div>
    </div>
    {error && <p className="text-[9px] text-red-500 dark:text-red-400 leading-tight mt-0.5 pl-[66px]">{error}</p>}
  </div>
));

interface TextareaProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
}

const LabelRightTextarea = memo(({ label, placeholder, value, onChange, rows = 2 }: TextareaProps) => (
  <div className="flex items-start gap-1">
    <span className={`${LABEL_W} text-[10px] font-medium text-slate-500 dark:text-slate-400 pt-[2px] leading-none`}>{label}</span>
    <div className="flex-1 min-w-0">
      <textarea placeholder={placeholder} value={value} onChange={onChange} rows={rows} className={`${inputBase} resize-none leading-relaxed`} />
    </div>
  </div>
));

const SectionHeader = ({ num, title }: { num: string; title: string }) => (
  <div className="flex items-center gap-2 mb-2">
    <span className="w-[20px] h-[20px] rounded-md bg-blue-600 dark:bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0"> {num} </span>
    <h3 className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
    <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
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
    if (Object.keys(errs).length) {
      setValidationErrors(errs);
      toast.error('Validation Error', 'Please fix the highlighted fields');
      return;
    }
    setServerErrors({});
    setSaving(true);
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
      setTimeout(() => onBack(), 1500);
    } catch (err: any) {
      if (err.response?.status === 422) {
        setServerErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        setServerErrors({ general: [err.response?.data?.message || 'Something went wrong'] });
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  }, [form, isEdit, editId, onBack, toast]);

  const handleReset = useCallback(() => {
    setForm(empty);
    setValidationErrors({});
    touchedRef.current = {};
  }, []);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-blue-600 dark:text-blue-400" />
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Loading branch data…</p>
      </div>
    );
  }

  const { inputChange, selectChange, textareaChange, blurKey } = handlers;
  const grid3 = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2';
  const grid2 = 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-16">
      <div className="flex items-center justify-between mb-3 px-4 pt-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <GitBranch size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
              {isEdit ? 'Edit Branch / Company' : 'Add New Branch / Company'}
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {isEdit ? 'Update branch details and credentials' : 'Register a new branch or company with login credentials'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack} className="rounded-lg text-[11px]">
            <ArrowLeft size={13} className="mr-1" />Back
          </Button>
          {!isEdit && (
            <Button size="sm" onClick={handleSubmit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px]">
              {saving ? <Loader2 size={13} className="animate-spin mr-1" /> : <Save size={13} className="mr-1" />}Create Branch
            </Button>
          )}
        </div>
      </div>

      <div className="w-full px-4">
        {serverErrors.general && (
          <div className="mb-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[11px] text-red-600 dark:text-red-400">
            <AlertCircle size={13} className="shrink-0" /><span>{serverErrors.general[0]}</span>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/40">
            <div>
              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Branch Registration Form</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Fields marked <span className="text-red-500">*</span> are required</p>
            </div>
            <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md px-2 py-0.5">
              {isEdit ? 'Edit Mode' : 'New Branch'}
            </span>
          </div>

          <div className="p-5 space-y-2">
            {/* 01. Branch Details */}
            <section>
              <SectionHeader num="01" title="Branch / Company Details" />
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-800">
                <Info size={11} className="text-sky-600 dark:text-sky-400 shrink-0" />
                <p className="text-[10px] text-sky-700 dark:text-sky-300">A branch represents a company or division under your organization group</p>
              </div>
              <div className={grid3}>
                <LabelRightInput
                  label="Branch Name"
                  required
                  placeholder="e.g., Inorbvict Agrotech Pvt. Ltd."
                  value={form.name}
                  onChange={inputChange('name')}
                  onBlur={blurKey('name')}
                  error={fieldError('name')}
                />
                <LabelRightInput
                  label="Branch Code"
                  
                  placeholder="e.g., AGRO, HQ, EAST"
                  value={form.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                />
                <LabelRightSelect
                  label="Branch Type"
                  value={form.branch_type}
                  onChange={selectChange('branch_type')}
                >
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
                <LabelRightInput
                  label="Industry / Sector"
                  placeholder="e.g., Healthcare, Agriculture, IT"
                  value={form.industry}
                  onChange={inputChange('industry')}
                />
                <LabelRightSelect
                  label="Status"
                  required
                  value={form.status}
                  onChange={selectChange('status')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </LabelRightSelect>
                <LabelRightInput
                  label="Established Date"
                  type="date"
                  
                  value={form.established_at}
                  onChange={inputChange('established_at')}
                />
                <LabelRightInput
                  label="Max Users"
                  type="number"
                  placeholder="0 = unlimited"
                  value={form.max_users}
                  onChange={inputChange('max_users')}
                />
                <LabelRightSelect
                  label="Main Branch"
                  
                  value={form.is_main}
                  onChange={selectChange('is_main')}
                >
                  <option value="false">No</option>
                  <option value="true">Yes — Main Branch</option>
                </LabelRightSelect>
              </div>
              <div className="mt-2">
                <LabelRightTextarea
                  label="Description"
                  placeholder="Brief description of this branch/company..."
                  value={form.description}
                  onChange={textareaChange('description')}
                  rows={1}
                />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 02. Contact Information */}
            <section>
              <SectionHeader num="02" title="Contact Information" />
              <div className={grid3}>
                <LabelRightInput
                  label="Contact Person"
                  
                  placeholder="e.g., Rajesh Meshram"
                  value={form.contact_person}
                  onChange={inputChange('contact_person')}
                />
                <LabelRightInput
                  label="Email"
                  type="email"
                  
                  placeholder="branch@company.com"
                  value={form.email}
                  onChange={inputChange('email')}
                  onBlur={blurKey('email')}
                  error={fieldError('email')}
                />
                <LabelRightInput
                  label="Phone"
                  type="tel"
                 
                  placeholder="+91 9876543210"
                  value={form.phone}
                  onChange={inputChange('phone')}
                  onBlur={blurKey('phone')}
                  error={fieldError('phone')}
                />
                <LabelRightInput
                  label="Website"
                  type="url"
                 
                  placeholder="www.branch.com"
                  value={form.website}
                  onChange={inputChange('website')}
                />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 03. Address Details */}
            <section>
              <SectionHeader num="03" title="Address Details" />
              <div className="mb-2"><LabelRightTextarea label="Street Addr." placeholder="Plot No, Street, Landmark…" value={form.address} onChange={textareaChange('address')} rows={1} /></div>
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

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 04. Legal & Tax */}
            <section>
              <SectionHeader num="04" title="Legal & Tax Information" />
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800">
                <Info size={11} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-[10px] text-amber-700 dark:text-amber-300">Each branch/company may have its own GST, PAN, and registration number</p>
              </div>
              <div className={grid2}>
                <LabelRightInput label="GST Number" placeholder="27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={setUpper('gst_number')} onBlur={blurKey('gst_number')} error={fieldError('gst_number')} />
                <LabelRightInput label="PAN Number" placeholder="AABCU9603R" maxLength={10} value={form.pan_number} onChange={setUpper('pan_number')} onBlur={blurKey('pan_number')} error={fieldError('pan_number')} />
                <LabelRightInput label="Registration / CIN" placeholder="U01100MH2020PTC123456" value={form.registration_number} onChange={inputChange('registration_number')} />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 05. Branch User Credentials */}
            <section>
              <SectionHeader num="05" title="Branch User — Login Credentials" />
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <Lock size={11} className="text-slate-500 dark:text-slate-400 shrink-0" />
                <p className="text-[10px] text-slate-600 dark:text-slate-400">Creates the login user (Branch User) for this branch</p>
              </div>
              <div className={grid3}>
                <LabelRightInput label="Full Name" required={!isEdit} icon={User} placeholder="e.g., Rajesh Meshram" value={form.user_name} onChange={inputChange('user_name')} onBlur={blurKey('user_name')} error={fieldError('user_name')} />
                <LabelRightInput label="Email (Login)" required={!isEdit} type="email" icon={Mail} placeholder="user@branch.com" value={form.user_email} onChange={inputChange('user_email')} onBlur={blurKey('user_email')} error={fieldError('user_email')} />
                <LabelRightInput label="Phone" type="tel" icon={Phone} placeholder="+91 9876543210" value={form.user_phone} onChange={inputChange('user_phone')} />
                <LabelRightInput label="Designation" icon={Briefcase} placeholder="e.g., Manager, Director" value={form.user_designation} onChange={inputChange('user_designation')} />
                <LabelRightInput label={isEdit ? 'New Password' : 'Password'} type="password" required={!isEdit} icon={Lock} placeholder={isEdit ? 'Leave blank' : 'Min. 6 chars'} value={form.user_password} onChange={inputChange('user_password')} onBlur={blurKey('user_password')} error={fieldError('user_password')} helperText={isEdit ? 'Leave blank to keep' : 'Minimum 6 characters'} />
                <LabelRightInput label="Confirm Pwd" type="password" required={!isEdit && !!form.user_password} icon={Lock} placeholder="Confirm password" value={form.user_password_confirmation} onChange={inputChange('user_password_confirmation')} onBlur={blurKey('user_password_confirmation')} error={fieldError('user_password_confirmation')} />
                <LabelRightSelect label="User Status" value={form.user_status} onChange={selectChange('user_status')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending Activation</option>
                </LabelRightSelect>
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 06. Additional Notes */}
            <section>
              <SectionHeader num="06" title="Additional Notes" />
              <LabelRightTextarea label="Internal Notes" placeholder="Any internal notes about this branch..." value={form.notes} onChange={textareaChange('notes')} rows={2} />
            </section>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button type="button" onClick={onBack} className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" onClick={handleReset} className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <RotateCcw size={11} />Reset
              </button>
              <div className="flex-1" />
              <button type="button" onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:opacity-60 px-4 py-1.5 rounded-lg shadow-sm transition-colors">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving…' : isEdit ? 'Update Branch' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}