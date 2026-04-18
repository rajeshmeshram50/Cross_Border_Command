import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import Button from '../components/ui/Button';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Save, RotateCcw, Building2, MapPin, FileText,
  Palette, User, Lock, Loader2, AlertCircle, CheckCircle2,
  Phone, Mail, Calendar, Briefcase, Shield, Info, Upload, X,
} from 'lucide-react';

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
  // Organization
  if (!form.org_name?.trim()) e.org_name = 'Organization name is required';
  else if (form.org_name.length < 3) e.org_name = 'Minimum 3 characters';
  if (!form.org_type) e.org_type = 'Organization type is required';
  if (!form.email?.trim()) e.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email format';
  if (!form.phone?.trim()) e.phone = 'Phone is required';
  else if (!/^[+\d\s\-()]{7,15}$/.test(form.phone)) e.phone = 'Invalid phone number';
  if (!form.status) e.status = 'Status is required';
  // Address
  if (!form.address?.trim()) e.address = 'Address is required';
  if (!form.city?.trim()) e.city = 'City is required';
  if (!form.state?.trim()) e.state = 'State is required';
  if (!form.country?.trim()) e.country = 'Country is required';
  if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = 'Must be 6 digits';
  // Legal
  if (form.country === 'India') {
    if (form.gst_number && !/^[0-9A-Z]{15}$/.test(form.gst_number)) e.gst_number = '15 alphanumeric characters';
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)) e.pan_number = 'Invalid PAN format';
  }
  // Plan
  if (!form.plan_id) e.plan_id = 'Plan is required';
  if (!form.plan_type) e.plan_type = 'Plan type is required';
  // Admin
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

const FileUploadField = memo(({ label, accept = 'image/*', hint = 'PNG, JPG — Max 2MB', preview, onFileChange }: {
  label: string; accept?: string; hint?: string; preview: string | null; onFileChange: (file: File | null) => void;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <p className="text-[10.5px] font-medium text-muted mb-1.5">{label}</p>
      <div className="flex items-center gap-2.5">
        <div className="w-16 h-14 flex items-center justify-center rounded-lg border border-border bg-surface-2/50 relative overflow-hidden shrink-0">
          {preview ? (
            <>
              <img src={preview} alt="preview" className="max-w-[90%] max-h-[44px] object-contain" />
              <button type="button" onClick={e => { e.stopPropagation(); onFileChange(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-red-100 text-red-500 hover:bg-red-200">
                <X size={8} />
              </button>
            </>
          ) : (
            <p className="text-[9px] text-muted text-center px-1">No file</p>
          )}
        </div>
        <div onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFileChange(f); }}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 rounded-lg border border-dashed cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border bg-surface-2/30 hover:border-primary/40 hover:bg-primary/5'}`}>
          <Upload size={13} className={dragging ? 'text-primary' : 'text-muted'} />
          <p className="text-[9.5px] font-medium text-text">Click or drop</p>
          <p className="text-[8.5px] text-muted">{hint}</p>
          <input ref={fileInputRef} type="file" accept={accept} onChange={e => onFileChange(e.target.files?.[0] || null)} className="hidden" />
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

  const handleSubmit = useCallback(async () => {
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
  }, [form, isEdit, editId, onBack, toast, logoFile, faviconFile]);

  const handleReset = useCallback(() => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
    setLogoFile(null); setLogoPreview(null); setFaviconFile(null); setFaviconPreview(null);
  }, []);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="mt-3 text-[12px] text-muted">Loading client data...</p>
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
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">{isEdit ? 'Edit Client' : 'Register New Client'}</h1>
            <p className="text-[11px] text-muted mt-0.5">{isEdit ? 'Update organization details' : 'Add a new organization'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEdit && <Button variant="outline" size="sm" onClick={handleReset}><RotateCcw size={12} /> Reset</Button>}
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving...' : isEdit ? 'Update Client' : 'Create Client'}
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
            <p className="text-[12px] font-bold text-text">Client Registration Form</p>
            <p className="text-[10px] text-muted">Fields marked <span className="text-red-500">*</span> are required</p>
          </div>
          <span className="text-[9px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-md px-2 py-0.5">
            {isEdit ? 'Edit Mode' : 'New Client'}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* Organization Details */}
          <section>
            <SectionHeader icon={Building2} title="Organization Details" badge="Section A" />
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
              <LabelRightInput label="Email" required type="email" icon={Mail} placeholder="contact@company.com" value={form.email} onChange={inputChange('email')} onBlur={blurKey('email')} error={fieldError('email')} />
              <LabelRightInput label="Phone" required type="tel" icon={Phone} placeholder="+91 9876543210" value={form.phone} onChange={inputChange('phone')} onBlur={blurKey('phone')} error={fieldError('phone')} />
              <LabelRightInput label="Website" type="url" placeholder="www.company.com" value={form.website} onChange={inputChange('website')} />
            </div>
          </section>

          {/* Address */}
          <section>
            <SectionHeader icon={MapPin} title="Address Details" badge="Section B" />
            <div className="mb-4"><LabelRightTextarea label="Street Address" required placeholder="Plot No, Street, Landmark..." value={form.address} onChange={textareaChange('address')} onBlur={blurKey('address')} error={fieldError('address')} rows={1} /></div>
            <div className={grid3}>
              <LabelRightInput label="City" required placeholder="e.g., Nagpur" value={form.city} onChange={inputChange('city')} onBlur={blurKey('city')} error={fieldError('city')} />
              <LabelRightInput label="District" placeholder="e.g., Nagpur" value={form.district} onChange={inputChange('district')} />
              <LabelRightInput label="Taluka" placeholder="e.g., Nagpur" value={form.taluka} onChange={inputChange('taluka')} />
              <LabelRightInput label="Pincode" placeholder="440001" maxLength={6} value={form.pincode} onChange={inputChange('pincode')} onBlur={blurKey('pincode')} error={fieldError('pincode')} />
              <LabelRightSelect label="State" required value={form.state} onChange={selectChange('state')} error={fieldError('state')}>
                <option value="">Select state</option>
                {['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','Telangana','West Bengal'].map(s => <option key={s} value={s}>{s}</option>)}
              </LabelRightSelect>
              <LabelRightSelect label="Country" required value={form.country} onChange={selectChange('country')} error={fieldError('country')}>
                <option value="India">India</option><option value="USA">USA</option><option value="UK">UK</option>
              </LabelRightSelect>
            </div>
          </section>

          {/* Legal & Tax */}
          <section>
            <SectionHeader icon={FileText} title="Legal & Tax Information" badge="Section C" />
            {form.country === 'India' && (
              <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200/60 text-[11px] text-amber-700">
                <Info size={11} className="shrink-0" /> GST and PAN are recommended for Indian organizations.
              </div>
            )}
            <div className={grid2}>
              <LabelRightInput label="GST Number" placeholder="27AABCU9603R1ZM" maxLength={15} value={form.gst_number} onChange={setUpper('gst_number')} onBlur={blurKey('gst_number')} error={fieldError('gst_number')} />
              <LabelRightInput label="PAN Number" placeholder="AABCU9603R" maxLength={10} value={form.pan_number} onChange={setUpper('pan_number')} onBlur={blurKey('pan_number')} error={fieldError('pan_number')} />
            </div>
          </section>

          {/* Plan & Billing */}
          <section>
            <SectionHeader icon={Shield} title="Plan & Billing" badge="Section D" />
            <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-[11px] text-emerald-700">
              <CheckCircle2 size={11} className="shrink-0" /> Client must complete payment after creation to activate.
            </div>
            <div className={grid3}>
              <LabelRightSelect label="Assign Plan" required value={form.plan_id} onChange={selectChange('plan_id')} error={fieldError('plan_id')}>
                <option value="">Select plan</option>
                <option value="1">Starter — ₹0/mo</option><option value="2">Basic — ₹1,999/mo</option>
                <option value="3">Pro — ₹4,999/mo</option><option value="4">Business — ₹9,999/mo</option>
              </LabelRightSelect>
              <LabelRightSelect label="Plan Type" required value={form.plan_type} onChange={selectChange('plan_type')} error={fieldError('plan_type')}>
                <option value="free">Free</option><option value="paid">Paid</option>
              </LabelRightSelect>
              <LabelRightInput label="Expires At" type="date" icon={Calendar} value={form.plan_expires_at} onChange={inputChange('plan_expires_at')} />
            </div>
          </section>

          {/* Admin Credentials */}
          <section>
            <SectionHeader icon={User} title="Admin Credentials" badge="Section E" />
            <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-[11px] text-secondary">
              <Lock size={11} className="shrink-0" /> Creates the first login user (Client Admin) for this organization.
            </div>
            <div className={grid3}>
              <LabelRightInput label="Full Name" required icon={User} placeholder="Rajesh Meshram" value={form.admin_name} onChange={inputChange('admin_name')} onBlur={blurKey('admin_name')} error={fieldError('admin_name')} />
              <LabelRightInput label="Email" required type="email" icon={Mail} placeholder="admin@company.com" value={form.admin_email} onChange={inputChange('admin_email')} onBlur={blurKey('admin_email')} error={fieldError('admin_email')} />
              <LabelRightInput label="Phone" required={!isEdit} type="tel" icon={Phone} placeholder="+91 9876543210" value={form.admin_phone} onChange={inputChange('admin_phone')} onBlur={blurKey('admin_phone')} error={fieldError('admin_phone')} />
              <LabelRightInput label="Designation" icon={Briefcase} placeholder="CEO / Director" value={form.admin_designation} onChange={inputChange('admin_designation')} />
              <LabelRightInput label={isEdit ? 'New Pwd' : 'Password'} type="password" required={!isEdit} icon={Lock} placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} value={form.admin_password} onChange={inputChange('admin_password')} onBlur={blurKey('admin_password')} error={fieldError('admin_password')} helperText={isEdit ? 'Leave blank to keep current' : undefined} />
              <LabelRightInput label="Confirm Pwd" type="password" required={!isEdit} icon={Lock} placeholder="Re-enter password" value={form.admin_password_confirmation} onChange={inputChange('admin_password_confirmation')} onBlur={blurKey('admin_password_confirmation')} error={fieldError('admin_password_confirmation')} />
              <LabelRightSelect label="Admin Status" required value={form.admin_status} onChange={selectChange('admin_status')} error={fieldError('admin_status')}>
                <option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending</option>
              </LabelRightSelect>
            </div>
          </section>

          {/* Branding */}
          <section>
            <SectionHeader icon={Palette} title="Branding" badge="Section F" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(['primary_color', 'secondary_color'] as const).map(key => (
                <div key={key}>
                  <label className="text-[11px] font-semibold text-text mb-1 block">{key === 'primary_color' ? 'Primary Color' : 'Secondary Color'}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form[key]} onChange={inputChange(key)} className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5" />
                    <input type="text" value={form[key]} onChange={inputChange(key)}
                      className="flex-1 bg-bg font-mono text-[12.5px] text-text rounded-lg border border-border px-3 py-2.5 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all" />
                    <div className="w-8 h-8 rounded-lg border border-border shadow-sm" style={{ backgroundColor: form[key] }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <FileUploadField label="Organization Logo" accept="image/jpeg,image/png,image/webp" hint="PNG, JPG — Max 2MB" preview={logoPreview} onFileChange={handleLogoChange} />
              <FileUploadField label="Favicon" accept="image/x-icon,image/png" hint="PNG, ICO — Max 512KB" preview={faviconPreview} onFileChange={handleFaviconChange} />
            </div>
          </section>

          {/* Notes */}
          <section>
            <SectionHeader title="Additional Notes" badge="Section G" />
            <LabelRightTextarea label="Internal Notes" placeholder="Any internal notes about this client..." value={form.notes} onChange={textareaChange('notes')} rows={2} />
          </section>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={onBack}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving...' : isEdit ? 'Update Client' : 'Create Client'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
