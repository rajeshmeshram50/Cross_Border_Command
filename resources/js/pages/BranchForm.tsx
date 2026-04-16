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

// ─── Memoized field components ────────────────────────────────────────────────
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
    <div className="flex items-center justify-between gap-2 mb-0.5">
      <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {label}{required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
      </label>
      <div className="flex-1 relative">
        {Icon && <Icon size={12} className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          maxLength={maxLength}
          className={`w-full ${Icon ? 'pl-4' : 'pl-0'} pr-0 py-0.5 text-xs border-0 border-b ${
            error ? 'border-red-500 dark:border-red-400' : 'border-gray-200 dark:border-gray-700'
          } focus:border-sky-500 dark:focus:border-sky-400 focus:ring-0 bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500`}
        />
      </div>
    </div>
    {error && <p className="text-xs text-red-500 dark:text-red-400 mt-0 text-right">{error}</p>}
    {helperText && !error && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0 text-right">{helperText}</p>}
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
    <div className="flex items-center justify-between gap-2 mb-0.5">
      <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {label}{required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
      </label>
      <div className="flex-1 relative">
        {Icon && <Icon size={12} className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />}
        <select
          value={value}
          onChange={onChange}
          className={`w-full ${Icon ? 'pl-4' : 'pl-0'} pr-0 py-0.5 text-xs border-0 border-b ${
            error ? 'border-red-500 dark:border-red-400' : 'border-gray-200 dark:border-gray-700'
          } focus:border-sky-500 dark:focus:border-sky-400 focus:ring-0 bg-transparent outline-none cursor-pointer text-gray-900 dark:text-gray-100`}
        >
          {children}
        </select>
      </div>
    </div>
    {error && <p className="text-xs text-red-500 dark:text-red-400 mt-0 text-right">{error}</p>}
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
  <div className="flex flex-col">
    <div className="flex items-center justify-between gap-2 mb-0.5">
      <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{label}</label>
      <div className="flex-1">
        <textarea
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          rows={rows}
          className="w-full px-0 py-0.5 text-xs border-0 border-b border-gray-200 dark:border-gray-700 focus:border-sky-500 dark:focus:border-sky-400 focus:ring-0 bg-transparent outline-none resize-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        />
      </div>
    </div>
  </div>
));

// ─── Main Component ───────────────────────────────────────────────────────────
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
    setValidationErrors(e => {
      if (!e[key]) return e;
      const n = { ...e }; delete n[key]; return n;
    });
  }, []);

  const touch = useCallback((key: string) => {
    touchedRef.current[key] = true;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setForm(current => {
        const liveErrors = validateBranchForm(current, isEdit);
        setValidationErrors(prev => {
          const next = { ...prev };
          Object.keys(touchedRef.current).forEach(k => {
            if (liveErrors[k]) next[k] = liveErrors[k];
            else delete next[k];
          });
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

  const setUpper = useCallback(
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value.toUpperCase()),
    [set]
  );

  const fieldError = useCallback(
    (key: string) => serverErrors[key]?.[0] || validationErrors[key],
    [serverErrors, validationErrors]
  );

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
        setTimeout(() => onBack(), 1500);
      }
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
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-sky-600 dark:text-sky-400" />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading branch data...</p>
      </div>
    );
  }

  const { inputChange, selectChange, textareaChange, blurKey } = handlers;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-cyan-50/30 to-blue-50/20 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 pb-24">
      {/* Ambient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-sky-300/20 to-cyan-300/20 dark:from-sky-900/10 dark:to-cyan-900/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-cyan-300/20 to-blue-300/20 dark:from-cyan-900/10 dark:to-blue-900/10 rounded-full blur-3xl" />
      </div>

      {/* Page Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-lg">
            <GitBranch size={18} className="text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {isEdit ? 'Edit Branch / Company' : 'Add New Branch / Company'}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isEdit ? 'Update branch details and credentials' : 'Register a new branch or company with login credentials'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onBack} className="rounded-lg">
          <ArrowLeft size={14} className="mr-1" />
          Back
        </Button>
      </div>

      <div className="w-full px-3 sm:px-2 py-2">
        {serverErrors.general && (
          <div className="mb-3 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-sm text-red-700 dark:text-red-300">
            <AlertCircle size={16} />
            {serverErrors.general[0]}
          </div>
        )}

        {/* ─── Single Unified Card ─── */}
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-3xl shadow-xl border border-white/50 dark:border-gray-700/50 overflow-hidden">

          {/* Card header strip */}
          <div className="px-4 py-2 bg-gradient-to-r from-blue-500/50 via-dark-500/30 to-blue-500/20 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-sky-800 to-cyan-900 rounded-md">
                <GitBranch size={14} className="text-white" />
              </div>
              <div className="leading-tight">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Branch Registration Form</h3>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Complete all required fields <span className="text-red-500">*</span>
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-5">

            {/* ─── 1. Branch Details ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-sky-100 dark:border-sky-900">
                <div className="p-1.5 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg shadow-sm">
                  <Building2 size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">1. Branch / Company Details</h3>
              </div>

              <div className="mb-3 p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800">
                <p className="text-xs text-sky-700 dark:text-sky-300 flex items-center gap-2">
                  <Info size={12} />
                  A branch represents a company or division under your organization group (e.g., IGC Group → Healthcare Pvt. Ltd., Agrotech Pvt. Ltd.)
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                <LabelRightInput
                  label="Branch / Company Name"
                  required
                  placeholder="e.g., Inorbvict Agrotech Pvt. Ltd."
                  value={form.name}
                  onChange={inputChange('name')}
                  onBlur={blurKey('name')}
                  error={fieldError('name')}
                />
                <LabelRightInput
                  label="Branch Code"
                  icon={Hash}
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
                  icon={Calendar}
                  value={form.established_at}
                  onChange={inputChange('established_at')}
                />
                <LabelRightInput
                  label="Max Users Allowed"
                  type="number"
                  placeholder="0 = unlimited"
                  value={form.max_users}
                  onChange={inputChange('max_users')}
                />
                <LabelRightSelect
                  label="Main Branch"
                  icon={Star}
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
                  placeholder="Brief description of this branch/company and its operations..."
                  value={form.description}
                  onChange={textareaChange('description')}
                  rows={1}
                />
              </div>
            </div>

            {/* ─── 2. Contact Information ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-emerald-100 dark:border-emerald-900">
                <div className="p-1.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-sm">
                  <Users size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">2. Contact Information</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                <LabelRightInput
                  label="Contact Person"
                  icon={User}
                  placeholder="e.g., Durgesh Urkude"
                  value={form.contact_person}
                  onChange={inputChange('contact_person')}
                />
                <LabelRightInput
                  label="Email"
                  type="email"
                  icon={Mail}
                  placeholder="branch@company.com"
                  value={form.email}
                  onChange={inputChange('email')}
                  onBlur={blurKey('email')}
                  error={fieldError('email')}
                />
                <LabelRightInput
                  label="Phone"
                  type="tel"
                  icon={Phone}
                  placeholder="+91 9876543210"
                  value={form.phone}
                  onChange={inputChange('phone')}
                  onBlur={blurKey('phone')}
                  error={fieldError('phone')}
                />
                <LabelRightInput
                  label="Website"
                  type="url"
                  icon={Globe}
                  placeholder="www.branch.com"
                  value={form.website}
                  onChange={inputChange('website')}
                />
              </div>
            </div>

            {/* ─── 3. Address Details ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-violet-100 dark:border-violet-900">
                <div className="p-1.5 bg-gradient-to-br from-violet-500 to-violet-600 rounded-lg shadow-sm">
                  <MapPin size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">3. Address Details</h3>
              </div>
              <div className="mb-2">
                <LabelRightTextarea
                  label="Street Address"
                  placeholder="Plot No, Street, Landmark..."
                  value={form.address}
                  onChange={textareaChange('address')}
                  rows={1}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                <LabelRightInput label="City" placeholder="e.g., Nagpur" value={form.city} onChange={inputChange('city')} />
                <LabelRightInput label="District" placeholder="e.g., Nagpur" value={form.district} onChange={inputChange('district')} />
                <LabelRightInput label="Taluka" placeholder="e.g., Nagpur" value={form.taluka} onChange={inputChange('taluka')} />
                <LabelRightInput
                  label="Pincode"
                  placeholder="440001"
                  maxLength={6}
                  value={form.pincode}
                  onChange={inputChange('pincode')}
                  onBlur={blurKey('pincode')}
                  error={fieldError('pincode')}
                />
                <LabelRightSelect label="State" value={form.state} onChange={selectChange('state')}>
                  <option value="">Select State</option>
                  {['Andhra Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana',
                    'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra',
                    'Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim',
                    'Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
                  ].map(s => <option key={s} value={s}>{s}</option>)}
                </LabelRightSelect>
                <LabelRightSelect label="Country" value={form.country} onChange={selectChange('country')}>
                  <option value="India">India</option>
                  <option value="USA">USA</option>
                  <option value="UK">UK</option>
                  <option value="UAE">UAE</option>
                  <option value="Other">Other</option>
                </LabelRightSelect>
              </div>
            </div>

            {/* ─── 4. Legal & Tax ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-amber-100 dark:border-amber-900">
                <div className="p-1.5 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg shadow-sm">
                  <Shield size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">4. Legal & Tax Information</h3>
              </div>
              <div className="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <Info size={12} />
                  Each branch/company may have its own GST, PAN, and registration number
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                <LabelRightInput
                  label="GST Number"
                  placeholder="27AABCU9603R1ZM"
                  maxLength={15}
                  value={form.gst_number}
                  onChange={setUpper('gst_number')}
                  onBlur={blurKey('gst_number')}
                  error={fieldError('gst_number')}
                />
                <LabelRightInput
                  label="PAN Number"
                  placeholder="AABCU9603R"
                  maxLength={10}
                  value={form.pan_number}
                  onChange={setUpper('pan_number')}
                  onBlur={blurKey('pan_number')}
                  error={fieldError('pan_number')}
                />
                <LabelRightInput
                  label="Registration / CIN"
                  placeholder="U01100MH2020PTC123456"
                  value={form.registration_number}
                  onChange={inputChange('registration_number')}
                />
              </div>
            </div>

            {/* ─── 5. Branch User Credentials ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-red-100 dark:border-red-900">
                <div className="p-1.5 bg-gradient-to-br from-red-500 to-red-600 rounded-lg shadow-sm">
                  <Lock size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">5. Branch User — Login Credentials</h3>
              </div>
              <div className="mb-3 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                  <Lock size={12} />
                  Creates the login user (Branch User) for this branch — they use these credentials to sign in and manage branch data
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                <LabelRightInput
                  label="Full Name"
                  required={!isEdit}
                  icon={User}
                  placeholder="e.g., Durgesh Urkude"
                  value={form.user_name}
                  onChange={inputChange('user_name')}
                  onBlur={blurKey('user_name')}
                  error={fieldError('user_name')}
                />
                <LabelRightInput
                  label="Email (Login)"
                  required={!isEdit}
                  type="email"
                  icon={Mail}
                  placeholder="user@branch.com"
                  value={form.user_email}
                  onChange={inputChange('user_email')}
                  onBlur={blurKey('user_email')}
                  error={fieldError('user_email')}
                />
                <LabelRightInput
                  label="Phone"
                  type="tel"
                  icon={Phone}
                  placeholder="+91 9876543210"
                  value={form.user_phone}
                  onChange={inputChange('user_phone')}
                />
                <LabelRightInput
                  label="Designation"
                  icon={Briefcase}
                  placeholder="e.g., Manager, Director"
                  value={form.user_designation}
                  onChange={inputChange('user_designation')}
                />
                <LabelRightInput
                  label={isEdit ? 'New Password' : 'Password'}
                  type="password"
                  required={!isEdit}
                  icon={Lock}
                  placeholder={isEdit ? 'Leave blank to keep' : 'Min. 8 characters'}
                  value={form.user_password}
                  onChange={inputChange('user_password')}
                  onBlur={blurKey('user_password')}
                  error={fieldError('user_password')}
                  helperText={isEdit ? 'Leave blank to keep current' : 'Minimum 8 characters'}
                />
                <LabelRightInput
                  label="Confirm Password"
                  type="password"
                  required={!isEdit && !!form.user_password}
                  icon={Lock}
                  placeholder="Confirm password"
                  value={form.user_password_confirmation}
                  onChange={inputChange('user_password_confirmation')}
                  onBlur={blurKey('user_password_confirmation')}
                  error={fieldError('user_password_confirmation')}
                />
                <LabelRightSelect
                  label="User Status"
                  value={form.user_status}
                  onChange={selectChange('user_status')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending Activation</option>
                </LabelRightSelect>
              </div>
            </div>

            {/* ─── 6. Additional Notes ─── */}
            <div>
              <div className="flex items-center gap-2 mb-3 pb-1 border-b-2 border-gray-100 dark:border-gray-700">
                <div className="p-1.5 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg shadow-sm">
                  <FileText size={12} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">6. Additional Notes</h3>
              </div>
              <LabelRightTextarea
                label="Internal Notes"
                placeholder="Any internal notes about this branch..."
                value={form.notes}
                onChange={textareaChange('notes')}
                rows={2}
              />
            </div>

            {/* ─── Form Actions ─── */}
            <div className="flex gap-2 sm:gap-3 pt-4 mt-2 border-t border-gray-200 dark:border-gray-700">
              <Button variant="ghost" size="lg" onClick={onBack}>
                Cancel
              </Button>
              <Button variant="outline" size="lg" onClick={handleReset}>
                <RotateCcw size={12} className="mr-1" />
                Reset
              </Button>
              <Button
                size="lg"
                onClick={handleSubmit}
                disabled={saving}
                className="bg-gradient-to-r from-blue-600 via-blue-600"
              >
                {saving
                  ? <Loader2 size={14} className="animate-spin mr-1" />
                  : <Save size={14} className="mr-1" />
                }
                {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
              </Button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
