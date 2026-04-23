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

// ── Section palette (AddPlan-style tints + gradients) ──
const SECTION_STYLE: Record<string, { gradTint: string; border: string; iconGrad: string; pillBg: string; pillText: string; pillBorder: string; iconShadow: string }> = {
  A: { gradTint: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.02))', border: 'rgba(99,102,241,0.20)',  iconGrad: 'linear-gradient(135deg, #6366f1, #8b5cf6)', pillBg: 'rgba(99,102,241,0.15)', pillText: '#6366f1', pillBorder: 'rgba(99,102,241,0.30)', iconShadow: '0 4px 12px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  B: { gradTint: 'linear-gradient(135deg, rgba(14,165,233,0.10), rgba(14,165,233,0.02))', border: 'rgba(14,165,233,0.20)',  iconGrad: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', pillBg: 'rgba(14,165,233,0.15)', pillText: '#0ea5e9', pillBorder: 'rgba(14,165,233,0.30)', iconShadow: '0 4px 12px rgba(14,165,233,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  C: { gradTint: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.02))', border: 'rgba(245,158,11,0.22)',  iconGrad: 'linear-gradient(135deg, #f59e0b, #f7b84b)', pillBg: 'rgba(245,158,11,0.15)', pillText: '#d97a08', pillBorder: 'rgba(245,158,11,0.30)', iconShadow: '0 4px 12px rgba(245,158,11,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  D: { gradTint: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.02))', border: 'rgba(16,185,129,0.20)',  iconGrad: 'linear-gradient(135deg, #10b981, #14c9b1)', pillBg: 'rgba(16,185,129,0.15)', pillText: '#10b981', pillBorder: 'rgba(16,185,129,0.30)', iconShadow: '0 4px 12px rgba(16,185,129,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  E: { gradTint: 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(139,92,246,0.02))', border: 'rgba(139,92,246,0.20)',  iconGrad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', pillBg: 'rgba(139,92,246,0.15)', pillText: '#8b5cf6', pillBorder: 'rgba(139,92,246,0.30)', iconShadow: '0 4px 12px rgba(139,92,246,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  F: { gradTint: 'linear-gradient(135deg, rgba(236,72,153,0.10), rgba(236,72,153,0.02))', border: 'rgba(236,72,153,0.20)',  iconGrad: 'linear-gradient(135deg, #ec4899, #f9a8d4)', pillBg: 'rgba(236,72,153,0.15)', pillText: '#db2777', pillBorder: 'rgba(236,72,153,0.30)', iconShadow: '0 4px 12px rgba(236,72,153,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  G: { gradTint: 'linear-gradient(135deg, rgba(100,116,139,0.10), rgba(100,116,139,0.02))', border: 'rgba(100,116,139,0.20)', iconGrad: 'linear-gradient(135deg, #64748b, #94a3b8)', pillBg: 'rgba(100,116,139,0.15)', pillText: '#475569', pillBorder: 'rgba(100,116,139,0.30)', iconShadow: '0 4px 12px rgba(100,116,139,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
};

// ── Inline styles (AddPlan-aligned) ─────────────────────────────────────────
const css = {
  label: {
    fontSize: '11.5px', fontWeight: 600, letterSpacing: '0.01em',
    marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px',
    color: 'var(--vz-body-color)',
  } as React.CSSProperties,
  input: {
    fontSize: '13px', padding: '7px 11px', height: '34px',
    borderRadius: '6px',
  } as React.CSSProperties,
  textarea: {
    fontSize: '13px', padding: '8px 11px', borderRadius: '6px',
  } as React.CSSProperties,
  ddToggle: {
    fontSize: '13px', height: '34px', padding: '0 11px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', textAlign: 'left' as const, background: 'var(--vz-card-bg)',
  } as React.CSSProperties,
  ddMenu: {
    fontSize: '13px', minWidth: '100%', padding: '5px 0',
    boxShadow: '0 8px 22px rgba(0,0,0,0.12)', borderRadius: '8px',
    border: '1px solid var(--vz-border-color)',
  } as React.CSSProperties,
  ddItem: {
    fontSize: '12.5px', padding: '6px 12px', cursor: 'pointer',
  } as React.CSSProperties,
  alert: {
    fontSize: '12px', padding: '8px 12px', marginBottom: '12px',
    display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px',
  } as React.CSSProperties,
  cardBody: { padding: '16px 18px' } as React.CSSProperties,
  formFeedback: { fontSize: '10.5px', marginTop: '3px' } as React.CSSProperties,
  small: {
    fontSize: '10.5px', color: 'var(--vz-secondary-color)', marginTop: '3px', display: 'block',
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

  // Auto-sync plan_type (free/paid) when user picks a plan
  useEffect(() => {
    if (!form.plan_id || plans.length === 0) return;
    const picked = plans.find(p => String(p.id) === form.plan_id);
    if (!picked) return;
    const expected = Number(picked.price) > 0 ? 'paid' : 'free';
    setForm(f => f.plan_type === expected ? f : { ...f, plan_type: expected });
  }, [form.plan_id, plans]);

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
              border: `1px solid ${invalid ? '#f06548' : 'var(--vz-border-color)'}`,
              borderRadius: '8px',
              color: value ? 'var(--vz-heading-color, var(--vz-body-color))' : 'var(--vz-secondary-color)',
              boxShadow: invalid ? '0 0 0 2px rgba(240,101,72,0.15)' : 'none',
              fontWeight: value ? 500 : 400,
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

  const SectionHeader = ({ icon, title, subtitle, badge }: { icon: string; title: string; subtitle?: string; badge: string }) => {
    const s = SECTION_STYLE[badge] || SECTION_STYLE.A;
    return (
      <div
        className="section-head-premium"
        style={{
          background: s.gradTint,
          border: `1px solid ${s.border}`,
        }}
      >
        <span
          className="head-icon"
          style={{
            background: s.iconGrad,
            boxShadow: s.iconShadow,
          }}
        >
          <i className={icon} style={{ fontSize: 15 }} />
        </span>
        <div className="min-w-0 flex-grow-1">
          <div className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.07em', lineHeight: 1.2, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
    );
  };

  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <Label style={css.label}>{children}</Label>
  );

  // ── Themed date picker — click anywhere in field to open ─────────────────
  const ThemedDatePicker = ({
    value, onChange, placeholder, minDate,
  }: { value: string; onChange: (v: string) => void; placeholder?: string; minDate?: string }) => {
    const [open, setOpen] = useState(false);
    const [viewDate, setViewDate] = useState(() => value ? new Date(value) : new Date());
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', key);
      return () => {
        document.removeEventListener('mousedown', handler);
        document.removeEventListener('keydown', key);
      };
    }, [open]);

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const minD = minDate ? new Date(minDate) : null;
    const today = new Date();
    const selected = value ? new Date(value) : null;
    const display = value
      ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '';

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const prev = () => setViewDate(new Date(year, month - 1, 1));
    const next = () => setViewDate(new Date(year, month + 1, 1));

    const sameDay = (a: Date | null, b: Date | null) =>
      !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    return (
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
          style={{
            ...css.input,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            border: `1px solid ${open ? '#6a5acd' : 'var(--vz-border-color)'}`,
            background: 'var(--vz-card-bg)',
            transition: 'border-color .15s ease, box-shadow .15s ease',
            boxShadow: open ? '0 0 0 3px rgba(106,90,205,0.15)' : 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ flex: 1, color: value ? 'var(--vz-heading-color, var(--vz-body-color))' : 'var(--vz-secondary-color)', fontWeight: value ? 500 : 400 }}>
            {display || (placeholder || 'dd-mm-yyyy')}
          </span>
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="btn p-0 d-inline-flex align-items-center justify-content-center text-muted"
              style={{ border: 'none', background: 'transparent', fontSize: 14 }}
              title="Clear"
            >
              <i className="ri-close-line" />
            </button>
          )}
          <i className="ri-calendar-line" style={{ color: '#6a5acd', fontSize: 16 }} />
        </div>

        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              minWidth: 290,
              background: 'var(--vz-card-bg)',
              border: '1px solid var(--vz-border-color)',
              borderRadius: 14,
              boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
              padding: 14,
              zIndex: 1050,
            }}
          >
            {/* Header: month nav */}
            <div className="d-flex align-items-center justify-content-between mb-2">
              <button
                type="button"
                onClick={prev}
                className="btn p-0 d-inline-flex align-items-center justify-content-center"
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
              >
                <i className="ri-arrow-left-s-line" style={{ fontSize: 16 }} />
              </button>
              <div className="fw-bold" style={{ fontSize: 13.5, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                {viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </div>
              <button
                type="button"
                onClick={next}
                className="btn p-0 d-inline-flex align-items-center justify-content-center"
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
              >
                <i className="ri-arrow-right-s-line" style={{ fontSize: 16 }} />
              </button>
            </div>

            {/* Weekday labels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-center" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', padding: '4px 0', letterSpacing: '0.04em' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {Array.from({ length: firstDow }).map((_, i) => <div key={`blank-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const d = new Date(year, month, day);
                const isToday = sameDay(today, d);
                const isSelected = sameDay(selected, d);
                const disabled = minD ? d < new Date(minD.getFullYear(), minD.getMonth(), minD.getDate()) : false;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    onClick={() => { onChange(fmt(d)); setOpen(false); }}
                    className="btn p-0 d-inline-flex align-items-center justify-content-center"
                    style={{
                      height: 34,
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: isSelected ? 700 : 500,
                      background: isSelected
                        ? 'linear-gradient(135deg, #6a5acd, #a78bfa)'
                        : isToday
                        ? 'rgba(106,90,205,0.12)'
                        : 'transparent',
                      color: isSelected
                        ? '#fff'
                        : isToday
                        ? '#6a5acd'
                        : disabled
                        ? 'var(--vz-secondary-color)'
                        : 'var(--vz-heading-color, var(--vz-body-color))',
                      border: 'none',
                      boxShadow: isSelected ? '0 4px 10px rgba(106,90,205,0.3)' : 'none',
                      opacity: disabled ? 0.35 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Footer: today + clear */}
            <div
              className="d-flex justify-content-between align-items-center pt-2 mt-2"
              style={{ borderTop: '1px solid var(--vz-border-color)' }}
            >
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="btn p-0"
                style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--vz-secondary-color)', border: 'none', background: 'transparent' }}
              >
                <i className="ri-close-line me-1" />Clear
              </button>
              <button
                type="button"
                onClick={() => { onChange(fmt(today)); setViewDate(today); setOpen(false); }}
                className="btn p-0 d-inline-flex align-items-center gap-1"
                style={{ fontSize: 11.5, fontWeight: 700, color: '#6a5acd', border: 'none', background: 'transparent' }}
              >
                <i className="ri-focus-2-line" />Today
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        .stylish-label {
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: var(--vz-body-color);
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .stylish-label i { font-size: 13px; }
        .cf-wrap .form-control,
        .cf-wrap .form-select,
        .cf-wrap .dropdown-toggle.btn-light {
          border: 1px solid var(--vz-border-color);
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
          background: var(--vz-card-bg);
        }
        .cf-wrap .form-control:hover,
        .cf-wrap .form-select:hover,
        .cf-wrap .dropdown-toggle.btn-light:hover {
          border-color: rgba(99,102,241,0.45);
        }
        .cf-wrap .form-control:focus,
        .cf-wrap .form-select:focus,
        .cf-wrap .dropdown-toggle.btn-light:focus,
        .cf-wrap .show > .dropdown-toggle.btn-light {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }
        .cf-wrap .form-control.is-invalid,
        .cf-wrap .form-control.is-invalid:focus {
          border-color: #f06548;
          box-shadow: 0 0 0 3px rgba(240,101,72,0.15);
        }
        .section-head-premium {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          margin-bottom: 14px;
        }
        .section-head-premium .head-icon {
          width: 30px; height: 30px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
      `}</style>

      {/* Page Title */}
      <div className="cf-wrap">
      <Row className="mb-0">
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
                style={{ width: 32, height: 32 }}
                onClick={onBack}
                type="button"
              >
                <i className="ri-arrow-left-line" />
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
        <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(240,101,72,0.10), rgba(255,158,124,0.05))', border: '1px solid rgba(240,101,72,0.28)', color: '#f06548' }}>
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
            style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#f06548,#ff9e7c)', boxShadow: '0 3px 8px rgba(240,101,72,0.3)' }}
          >
            <i className="ri-error-warning-line" style={{ color: '#fff', fontSize: 13 }} />
          </span>
          <span>{serverErrors.general[0]}</span>
        </div>
      )}

      <Form onSubmit={handleSubmit}>
        <Card
          className="shadow-sm border-0 mb-3"
          style={{ borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 24px rgba(64,81,137,0.08)' }}
        >
          <CardHeader
            style={{
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--vz-border-color)',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.01))',
            }}
          >
            <div className="d-flex align-items-center gap-3">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{
                  width: 44, height: 44,
                  background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
                  boxShadow: '0 6px 16px rgba(64,81,137,0.28)',
                }}
              >
                <i className={isEdit ? 'ri-edit-2-line' : 'ri-user-add-line'} style={{ color: '#fff', fontSize: 20 }} />
              </span>
              <div>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 15 }}>Client Registration Form</h6>
                <p className="mb-0 text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Fields marked <span className="text-danger fw-bold">*</span> are required
                </p>
              </div>
            </div>
            <span
              className="rounded-pill fw-bold"
              style={{
                fontSize: 11,
                padding: '4px 10px',
                letterSpacing: '0.06em',
                background: isEdit
                  ? 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)'
                  : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: '#fff',
                boxShadow: isEdit
                  ? '0 4px 10px rgba(10,179,156,0.28)'
                  : '0 4px 10px rgba(99,102,241,0.28)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <i className={isEdit ? 'ri-edit-2-fill' : 'ri-add-circle-fill'} style={{ fontSize: 12 }} />
              {isEdit ? 'Edit Mode' : 'New Client'}
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
                  value={form.org_type}
                  placeholder={loadingLookups ? 'Loading…' : 'Select type'}
                  fieldKey="org_type"
                  options={orgTypes.map(t => ({ label: t.name, value: t.name }))}
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
              <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(255,212,122,0.05))', border: '1px solid rgba(245,158,11,0.28)', color: '#B45309' }}>
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                  style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#f7b84b,#ffd47a)', boxShadow: '0 3px 8px rgba(247,184,75,0.3)' }}
                >
                  <i className="ri-information-line" style={{ color: '#fff', fontSize: 13 }} />
                </span>
                <span>GST and PAN are recommended for Indian organizations.</span>
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
            <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(10,179,156,0.10), rgba(48,213,181,0.05))', border: '1px solid rgba(10,179,156,0.28)', color: '#059669' }}>
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#0ab39c,#30d5b5)', boxShadow: '0 3px 8px rgba(10,179,156,0.3)' }}
              >
                <i className="ri-checkbox-circle-line" style={{ color: '#fff', fontSize: 13 }} />
              </span>
              <span>Client must complete payment after creation to activate.</span>
            </div>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Assign Plan <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddPlan} toggle={() => setDdPlan(o => !o)}
                  value={form.plan_id}
                  placeholder={loadingLookups ? 'Loading…' : 'Select plan'}
                  fieldKey="plan_id"
                  options={plans.map(p => ({ label: formatPlanLabel(p), value: String(p.id) }))}
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
                <ThemedDatePicker
                  value={form.plan_expires_at}
                  onChange={v => set('plan_expires_at', v)}
                  placeholder="Select date"
                />
              </Col>
            </Row>

            {/* ══ E: Admin ══ */}
            <SectionHeader icon="ri-user-line" title="Admin Credentials" badge="E" />
            <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(106,90,205,0.10), rgba(167,139,250,0.05))', border: '1px solid rgba(106,90,205,0.28)', color: '#4c3fb1' }}>
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#6a5acd,#a78bfa)', boxShadow: '0 3px 8px rgba(106,90,205,0.3)' }}
              >
                <i className="ri-lock-line" style={{ color: '#fff', fontSize: 13 }} />
              </span>
              <span>Creates the first login user (Client Admin) for this organization.</span>
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

            {/* ══ Actions (AddPlan-style sticky footer) ══ */}
            <div
              className="d-flex justify-content-between align-items-center mt-3 px-3 py-2 rounded-3 flex-wrap gap-2"
              style={{
                background: 'var(--vz-card-bg)',
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 -4px 12px rgba(15,23,42,0.04)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                  style={{
                    width: 32, height: 32,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    boxShadow: '0 3px 10px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.22)',
                  }}
                >
                  <i className="ri-information-line" style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div>
                  <div className="fw-semibold" style={{ fontSize: 12.5, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                    {isEdit ? 'Review changes before saving' : 'Ready to create client'}
                    {form.org_name && <> · <span style={{ color: '#6366f1' }}>{form.org_name}</span></>}
                  </div>
                  <div className="text-muted" style={{ fontSize: 10.5 }}>
                    {Object.keys(validationErrors).length > 0
                      ? `${Object.keys(validationErrors).length} field${Object.keys(validationErrors).length === 1 ? '' : 's'} need attention`
                      : 'All required fields are validated on save'}
                  </div>
                </div>
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={onBack}
                  className="btn d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                  style={{
                    padding: '7px 16px',
                    fontSize: 12.5,
                    background: 'var(--vz-secondary-bg)',
                    color: 'var(--vz-body-color)',
                    border: '1px solid var(--vz-border-color)',
                    transition: 'all .18s ease',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--vz-secondary-color)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--vz-border-color)'; }}
                >
                  <i className="ri-arrow-left-line" />Cancel
                </button>
                {!isEdit && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                    style={{
                      padding: '7px 16px',
                      fontSize: 12.5,
                      background: 'rgba(245,158,11,0.10)',
                      color: '#f59e0b',
                      border: '1px solid rgba(245,158,11,0.30)',
                      transition: 'all .18s ease',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = '#f59e0b';
                      el.style.color = '#fff';
                      el.style.boxShadow = '0 6px 14px rgba(245,158,11,0.45)';
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = 'rgba(245,158,11,0.10)';
                      el.style.color = '#f59e0b';
                      el.style.boxShadow = 'none';
                    }}
                  >
                    <i className="ri-restart-line" />Reset
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="btn d-inline-flex align-items-center gap-1 rounded-pill fw-semibold"
                  style={{
                    padding: '7px 20px',
                    fontSize: 13,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 6px 18px rgba(99,102,241,0.45), inset 0 1px 0 rgba(255,255,255,0.22)',
                    transition: 'all .18s ease',
                    opacity: saving ? 0.7 : 1,
                    minWidth: 160,
                  }}
                  onMouseEnter={e => {
                    if (saving) return;
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.boxShadow = '0 10px 26px rgba(99,102,241,0.60), inset 0 1px 0 rgba(255,255,255,0.30)';
                    el.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.boxShadow = '0 6px 18px rgba(99,102,241,0.45), inset 0 1px 0 rgba(255,255,255,0.22)';
                    el.style.transform = 'translateY(0)';
                  }}
                >
                  {saving ? <Spinner size="sm" /> : <i className={isEdit ? 'ri-check-double-line' : 'ri-save-line'} />}
                  {saving ? 'Saving...' : isEdit ? 'Update Client' : 'Create Client'}
                </button>
              </div>
            </div>

          </CardBody>
        </Card>
      </Form>
      </div>
    </>
  );
}
