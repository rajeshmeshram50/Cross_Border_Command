import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import Button from '../components/ui/Button';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Save, RotateCcw, Building2, MapPin, FileText,
  Palette, User, Lock, Loader2, AlertCircle, CheckCircle2,
  Phone, Mail, Calendar, Briefcase, Shield, Crown, Info, Upload, X,
} from 'lucide-react';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  org_name: '',
  org_type: '',
  email: '',
  phone: '',
  website: '',
  status: 'inactive',
  sports: '',
  industry: '',
  address: '',
  city: '',
  district: '',
  taluka: '',
  pincode: '',
  state: '',
  country: 'India',
  gst_number: '',
  pan_number: '',
  plan_id: '',
  plan_type: 'free',
  plan_expires_at: '',
  primary_color: '#1D4ED8',
  secondary_color: '#0F766E',
  notes: '',
  admin_name: '',
  admin_email: '',
  admin_phone: '',
  admin_designation: '',
  admin_password: '',
  admin_password_confirmation: '',
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
  if (form.phone && !/^[+\d\s\-()]{7,15}$/.test(form.phone)) e.phone = 'Invalid phone number';
  if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = 'Must be 6 digits';
  if (form.country === 'India') {
    if (form.gst_number && !/^[0-9A-Z]{15}$/.test(form.gst_number)) e.gst_number = '15 alphanumeric characters';
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)) e.pan_number = 'Invalid PAN format';
  }
  if (!isEdit) {
    if (!form.admin_name?.trim()) e.admin_name = 'Admin name is required';
    if (!form.admin_email?.trim()) e.admin_email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) e.admin_email = 'Invalid email format';
    if (!form.admin_password) e.admin_password = 'Password is required';
    else if (form.admin_password.length < 6) e.admin_password = 'Minimum 6 characters';
  } else {
    if (form.admin_password && form.admin_password.length < 6) e.admin_password = 'Minimum 6 characters';
  }
  if (form.admin_password && form.admin_password !== form.admin_password_confirmation)
    e.admin_password_confirmation = 'Passwords do not match';
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
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
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
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
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

// SectionHeader component - without numbers
const SectionHeader = ({ title }: { title: string }) => (
  <div className="flex items-center gap-2 mb-2">
    <h3 className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
    <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
  </div>
);

interface FileUploadProps {
  label: string;
  accept?: string;
  hint?: string;
  preview: string | null;
  onFileChange: (file: File | null) => void;
}

const FileUploadField = memo(({ label, accept = 'image/*', hint = 'PNG, JPG — Max 2MB', preview, onFileChange }: FileUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => onFileChange(e.target.files?.[0] || null);
  const handleClear = (e: React.MouseEvent) => { e.stopPropagation(); onFileChange(null); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) onFileChange(file); };

  return (
    <div>
      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <div className="w-[72px] h-[64px] flex flex-col items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 relative overflow-hidden shrink-0">
          {preview ? (
            <>
              <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'repeating-conic-gradient(#94a3b8 0% 25%, transparent 0% 50%)', backgroundSize: '8px 8px' }} />
              <img src={preview} alt="preview" className="relative z-10 max-w-[80%] max-h-[48px] object-contain" />
              <button type="button" onClick={handleClear} className="absolute top-1 right-1 z-20 p-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-500 hover:bg-red-200 dark:hover:bg-red-800/50">
                <X size={8} />
              </button>
            </>
          ) : (
            <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center px-1">No file</p>
          )}
        </div>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors ${dragging
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/20 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/10'}`}
        >
          <Upload size={12} className={dragging ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'} />
          <p className="text-[9px] font-medium text-slate-600 dark:text-slate-300">Click or drop file</p>
          <p className="text-[9px] text-slate-400 dark:text-slate-500">{hint}</p>
          <input ref={fileInputRef} type="file" accept={accept} onChange={handleFileSelect} className="hidden" />
        </div>
      </div>
    </div>
  );
});

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
        const liveErrors = validateClientForm(current, isEdit);
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

  const handleLogoChange = useCallback((file: File | null) => {
    setLogoFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setLogoPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setLogoPreview(null);
  }, []);

  const handleFaviconChange = useCallback((file: File | null) => {
    setFaviconFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setFaviconPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setFaviconPreview(null);
  }, []);

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
        plan_expires_at: c.plan_expires_at || '', primary_color: c.primary_color || '#1D4ED8',
        secondary_color: c.secondary_color || '#0F766E', notes: c.notes || '',
        admin_name: admin?.name || '', admin_email: admin?.email || '',
        admin_phone: admin?.phone || '', admin_designation: admin?.designation || '',
        admin_password: '', admin_password_confirmation: '', admin_status: admin?.status || 'active',
      });
      if (c.logo) setLogoPreview(c.logo);
      if (c.favicon) setFaviconPreview(c.favicon);
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleSubmit = useCallback(async () => {
    const allKeys = Object.keys(empty) as (keyof FormState)[];
    allKeys.forEach(k => { touchedRef.current[k] = true; });
    const errs = validateClientForm(form, isEdit);
    if (Object.keys(errs).length) { setValidationErrors(errs); toast.error('Validation Error', 'Please fix the highlighted fields'); return; }
    setServerErrors({});
    setSaving(true);
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
        toast.success('Client Updated', 'Organization details have been updated successfully');
      } else {
        const fd = new FormData();
        Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
        if (logoFile) fd.append('logo', logoFile);
        if (faviconFile) fd.append('favicon', faviconFile);
        await api.post('/clients', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Client Created', 'New organization has been registered successfully');
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
    } finally { setSaving(false); }
  }, [form, isEdit, editId, onBack, toast, logoFile, faviconFile]);

  const handleReset = useCallback(() => {
    setForm(empty);
    setValidationErrors({});
    touchedRef.current = {};
    setLogoFile(null); setLogoPreview(null);
    setFaviconFile(null); setFaviconPreview(null);
  }, []);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-blue-600 dark:text-blue-400" />
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Loading client data…</p>
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
            <Building2 size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
              {isEdit ? 'Edit Client' : 'Register New Client'}
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {isEdit ? 'Update client details' : 'Add a new organization to your system'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack} className="rounded-lg text-[11px]">
            <ArrowLeft size={13} className="mr-1" />Back
          </Button>
          {!isEdit && (
            <Button size="sm" onClick={handleSubmit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px]">
              {saving ? <Loader2 size={13} className="animate-spin mr-1" /> : <Save size={13} className="mr-1" />}Create Client
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
              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Client Registration Form</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Fields marked <span className="text-red-500">*</span> are required</p>
            </div>
            <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md px-2 py-0.5">
              {isEdit ? 'Edit Mode' : 'New Client'}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* 01. Organization Details */}
            <section>
              <SectionHeader  title="Organization Details" />
              <div className={grid3}>
                <LabelRightInput label="Org. Name" required placeholder="e.g., Inorbvict Technologies" value={form.org_name} onChange={inputChange('org_name')} onBlur={blurKey('org_name')} error={fieldError('org_name')} />
                <LabelRightSelect label="Org. Type" required value={form.org_type} onChange={selectChange('org_type')} error={fieldError('org_type')}>
                  <option value="">Select type</option>
                  {['Business','Sports','Education','Healthcare','Government','NGO','Other'].map(t => <option key={t} value={t}>{t}</option>)}
                </LabelRightSelect>
                {form.org_type === 'Sports'
                  ? <LabelRightInput label="Sport Name" placeholder="e.g., Hockey, Boxing" value={form.sports} onChange={inputChange('sports')} />
                  : <LabelRightInput label="Industry" placeholder="e.g., Agriculture, IT" value={form.industry} onChange={inputChange('industry')} />
                }
                <LabelRightSelect label="Status" required value={form.status} onChange={selectChange('status')}>
                  <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
                </LabelRightSelect>
                <LabelRightInput label="Email" required type="email" placeholder="contact@company.com" value={form.email} onChange={inputChange('email')} onBlur={blurKey('email')} error={fieldError('email')} />
                <LabelRightInput label="Phone" type="tel" placeholder="+91 9876543210" value={form.phone} onChange={inputChange('phone')} onBlur={blurKey('phone')} error={fieldError('phone')} />
                <LabelRightInput label="Website" type="url" placeholder="www.company.com" value={form.website} onChange={inputChange('website')} />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 02. Address Details */}
            <section>
              <SectionHeader  title="Address Details" />
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
                  <option value="India">India</option><option value="USA">USA</option><option value="UK">UK</option>
                </LabelRightSelect>
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 03. Legal & Tax */}
            <section>
              <SectionHeader  title="Legal & Tax Information" />
              {form.country === 'India' && (
                <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800">
                  <Info size={11} className="text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">GST and PAN are recommended for Indian organizations.</p>
                </div>
              )}
              <div className={grid2}>
                <LabelRightInput label="GST Number" placeholder="27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={setUpper('gst_number')} onBlur={blurKey('gst_number')} error={fieldError('gst_number')} />
                <LabelRightInput label="PAN Number" placeholder="AABCU9603R" maxLength={10} value={form.pan_number} onChange={setUpper('pan_number')} onBlur={blurKey('pan_number')} error={fieldError('pan_number')} />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 04. Plan & Billing */}
            <section>
              <SectionHeader  title="Plan & Billing" />
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 size={11} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300">Client must complete payment after creation to activate their account.</p>
              </div>
              <div className={grid3}>
                <LabelRightSelect label="Assign Plan" value={form.plan_id} onChange={selectChange('plan_id')}>
                  <option value="">Select plan</option>
                  <option value="1">Starter — ₹0/mo</option><option value="2">Basic — ₹1,999/mo</option>
                  <option value="3">Pro — ₹4,999/mo</option><option value="4">Business — ₹9,999/mo</option>
                </LabelRightSelect>
                <LabelRightSelect label="Plan Type" value={form.plan_type} onChange={selectChange('plan_type')}>
                  <option value="free">Free</option><option value="paid">Paid</option>
                </LabelRightSelect>
                <LabelRightInput label="Expires At" type="date" icon={Calendar} value={form.plan_expires_at} onChange={inputChange('plan_expires_at')} />
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 05. Admin Credentials */}
            <section>
              <SectionHeader  title="Admin Credentials" />
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <Lock size={11} className="text-slate-500 dark:text-slate-400 shrink-0" />
                <p className="text-[10px] text-slate-600 dark:text-slate-400">Creates the first login user (Client Admin) for this organization.</p>
              </div>
              <div className={grid3}>
                <LabelRightInput label="Full Name" required={!isEdit} icon={User} placeholder="Rajesh Meshram" value={form.admin_name} onChange={inputChange('admin_name')} onBlur={blurKey('admin_name')} error={fieldError('admin_name')} />
                <LabelRightInput label="Email" required={!isEdit} type="email" icon={Mail} placeholder="admin@company.com" value={form.admin_email} onChange={inputChange('admin_email')} onBlur={blurKey('admin_email')} error={fieldError('admin_email')} />
                <LabelRightInput label="Phone" type="tel" icon={Phone} placeholder="+91 9876543210" value={form.admin_phone} onChange={inputChange('admin_phone')} />
                <LabelRightInput label="Designation" icon={Briefcase} placeholder="CEO / Director" value={form.admin_designation} onChange={inputChange('admin_designation')} />
                <LabelRightInput label={isEdit ? 'New Password' : 'Password'} type="password" required={!isEdit} icon={Lock} placeholder={isEdit ? 'Leave blank' : 'Min. 6 chars'} value={form.admin_password} onChange={inputChange('admin_password')} onBlur={blurKey('admin_password')} error={fieldError('admin_password')} helperText={isEdit ? 'Leave blank to keep' : 'Minimum 6 characters'} />
                <LabelRightInput label="Confirm Pwd" type="password" required={!isEdit && !!form.admin_password} icon={Lock} placeholder="Re-enter password" value={form.admin_password_confirmation} onChange={inputChange('admin_password_confirmation')} onBlur={blurKey('admin_password_confirmation')} error={fieldError('admin_password_confirmation')} />
                <LabelRightSelect label="Admin Status" value={form.admin_status} onChange={selectChange('admin_status')}>
                  <option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending</option>
                </LabelRightSelect>
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 06. Branding */}
            <section>
              <SectionHeader  title="Branding" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">Theme Colors</p>
                  <div className="space-y-2">
                    {(['primary_color', 'secondary_color'] as const).map(key => (
                      <div key={key} className="flex items-center gap-3">
                        <input type="color" value={form[key]} onChange={inputChange(key)} className="w-7 h-6 rounded border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent p-0.5" />
                        <input type="text" value={form[key]} onChange={inputChange(key)} className="w-[90px] bg-transparent outline-none font-mono text-[10px] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 focus:border-blue-500 py-[2px]" />
                        <div className="w-4 h-4 rounded-full border border-slate-200 dark:border-slate-600" style={{ backgroundColor: form[key] }} />
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{key === 'primary_color' ? 'Primary' : 'Secondary'}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <FileUploadField label="Organization Logo" accept="image/jpeg,image/png,image/webp" hint="PNG, JPG — Max 2MB" preview={logoPreview} onFileChange={handleLogoChange} />
                  <FileUploadField label="Favicon" accept="image/x-icon,image/png" hint="PNG, ICO — Max 512KB" preview={faviconPreview} onFileChange={handleFaviconChange} />
                </div>
              </div>
            </section>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            {/* 07. Notes */}
            <section>
              <SectionHeader  title="Additional Notes" />
              <LabelRightTextarea label="Internal Notes" placeholder="Any internal notes about this client…" value={form.notes} onChange={textareaChange('notes')} rows={2} />
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
              <button type="button" onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-1.5 rounded-lg shadow-sm">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving…' : isEdit ? 'Update Client' : 'Create Client'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}