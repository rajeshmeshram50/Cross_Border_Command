import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Input, Label,
  Spinner, Form, FormFeedback,
} from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';

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

// ── Section palette (AddPlan-style tints + gradients) ──
const SECTION_STYLE: Record<string, { gradTint: string; border: string; iconGrad: string; pillBg: string; pillText: string; pillBorder: string; iconShadow: string }> = {
  A: { gradTint: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.02))', border: 'rgba(99,102,241,0.20)',  iconGrad: 'linear-gradient(135deg, #6366f1, #8b5cf6)', pillBg: 'rgba(99,102,241,0.15)', pillText: '#6366f1', pillBorder: 'rgba(99,102,241,0.30)', iconShadow: '0 4px 12px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  B: { gradTint: 'linear-gradient(135deg, rgba(14,165,233,0.10), rgba(14,165,233,0.02))', border: 'rgba(14,165,233,0.20)',  iconGrad: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', pillBg: 'rgba(14,165,233,0.15)', pillText: '#0ea5e9', pillBorder: 'rgba(14,165,233,0.30)', iconShadow: '0 4px 12px rgba(14,165,233,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  C: { gradTint: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.02))', border: 'rgba(245,158,11,0.22)',  iconGrad: 'linear-gradient(135deg, #f59e0b, #f7b84b)', pillBg: 'rgba(245,158,11,0.15)', pillText: '#d97a08', pillBorder: 'rgba(245,158,11,0.30)', iconShadow: '0 4px 12px rgba(245,158,11,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  D: { gradTint: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.02))', border: 'rgba(16,185,129,0.20)',  iconGrad: 'linear-gradient(135deg, #10b981, #14c9b1)', pillBg: 'rgba(16,185,129,0.15)', pillText: '#10b981', pillBorder: 'rgba(16,185,129,0.30)', iconShadow: '0 4px 12px rgba(16,185,129,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  E: { gradTint: 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(139,92,246,0.02))', border: 'rgba(139,92,246,0.20)',  iconGrad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', pillBg: 'rgba(139,92,246,0.15)', pillText: '#8b5cf6', pillBorder: 'rgba(139,92,246,0.30)', iconShadow: '0 4px 12px rgba(139,92,246,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
  F: { gradTint: 'linear-gradient(135deg, rgba(100,116,139,0.10), rgba(100,116,139,0.02))', border: 'rgba(100,116,139,0.20)', iconGrad: 'linear-gradient(135deg, #64748b, #94a3b8)', pillBg: 'rgba(100,116,139,0.15)', pillText: '#475569', pillBorder: 'rgba(100,116,139,0.30)', iconShadow: '0 4px 12px rgba(100,116,139,0.40), inset 0 1px 0 rgba(255,255,255,0.22)' },
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

export default function BranchForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const [form, setForm] = useState<FormState>(empty);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});

  // ── one state per dropdown ──────────────────────────────────────────────────
  const [ddBranchType, setDdBranchType] = useState(false);
  const [ddStatus,     setDdStatus]     = useState(false);
  const [ddIsMain,     setDdIsMain]     = useState(false);
  const [ddState,      setDdState]      = useState(false);
  const [ddCountry,    setDdCountry]    = useState(false);
  const [ddUserStatus, setDdUserStatus] = useState(false);

  // Geography lookups for the cascading Country -> State dropdowns. Sourced
  // from the master tables seeded by GeographySeeder so every form picks from
  // the same canonical dataset.
  const [countries, setCountries] = useState<Array<{ id: number; name: string; iso_code: string; status: string }>>([]);
  const [statesAll, setStatesAll] = useState<Array<{ id: number; country_id: string; name: string; status: string }>>([]);

  useEffect(() => {
    Promise.all([
      api.get('/master/countries').catch(() => ({ data: [] })),
      api.get('/master/states').catch(() => ({ data: [] })),
    ]).then(([countryRes, stateRes]) => {
      setCountries(Array.isArray(countryRes.data) ? countryRes.data.filter((c: any) => c.status === 'Active') : []);
      setStatesAll(Array.isArray(stateRes.data) ? stateRes.data.filter((s: any) => s.status === 'Active') : []);
    });
  }, []);

  const set = useCallback((key: keyof FormState, val: string) => {
    setForm(f => (f[key] === val ? f : { ...f, [key]: val }));
    setValidationErrors(e => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });
  }, []);

  // Country options from the canonical master list.
  const countryOptions = useMemo(
    () => countries.map(c => ({ label: c.name, value: c.name })),
    [countries]
  );

  // State options filtered by the currently-selected country. The form stores
  // country/state by NAME (not id), so we resolve back to the id and then
  // keep only the states that match.
  const stateOptions = useMemo(() => {
    if (!form.country || countries.length === 0) return [];
    const selected = countries.find(c => c.name === form.country);
    if (!selected) return [];
    return statesAll
      .filter(s => Number(s.country_id) === selected.id)
      .map(s => ({ label: s.name, value: s.name }));
  }, [form.country, countries, statesAll]);

  // When the country changes, drop a previously-picked state that doesn't
  // belong to the new country.
  useEffect(() => {
    if (!form.state) return;
    if (stateOptions.length === 0) return;
    if (!stateOptions.some(o => o.value === form.state)) {
      setForm(f => ({ ...f, state: '' }));
    }
  }, [form.country, stateOptions, form.state]);

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

  const fieldError = useCallback((key: string) => serverErrors[key]?.[0] || validationErrors[key], [serverErrors, validationErrors]);
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
    for (const k of keys) {
      const el = document.querySelector<HTMLElement>(`[name="${k}"], #branch-field-${k}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { try { (el as HTMLInputElement).focus?.(); } catch {} }, 350);
        return;
      }
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
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

  if (loadingData) return (
    <div className="text-center py-5">
      <Spinner color="primary" />
      <p className="text-muted mt-2" style={{ fontSize: '12px' }}>Loading branch data...</p>
    </div>
  );

  // ── SelectDD — thin wrapper that delegates to MasterSelect so every ────
  //   dropdown in this form matches the master / client-form dropdown.
  //   Legacy props (isOpen, toggle, dotColor) are kept for backwards
  //   compatibility with existing call sites but ignored — MasterSelect
  //   manages its own open state and doesn't render status dots.
  const SelectDD = (props: {
    isOpen?: boolean;
    toggle?: () => void;
    value: string;
    placeholder?: string;
    options: { label: string; value: string }[];
    fieldKey: string;
    dotColor?: boolean;
  }) => {
    const { value, placeholder = 'Select', options, fieldKey } = props;
    const invalid = fieldInvalid(fieldKey);
    return (
      <>
        <MasterSelect
          value={value}
          placeholder={placeholder}
          options={options}
          invalid={invalid}
          onChange={val => { set(fieldKey as keyof FormState, val); touch(fieldKey); }}
        />
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
              top: 'calc(100% + 5px)',
              left: 0,
              minWidth: 240,
              maxWidth: 240,
              background: 'var(--vz-card-bg)',
              border: '1px solid var(--vz-border-color)',
              borderRadius: 12,
              boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
              padding: 10,
              zIndex: 1050,
            }}
          >
            <div className="d-flex align-items-center justify-content-between mb-1">
              <button
                type="button"
                onClick={prev}
                className="btn p-0 d-inline-flex align-items-center justify-content-center"
                style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
              >
                <i className="ri-arrow-left-s-line" style={{ fontSize: 13 }} />
              </button>
              <div className="fw-bold" style={{ fontSize: 12, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                {viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </div>
              <button
                type="button"
                onClick={next}
                className="btn p-0 d-inline-flex align-items-center justify-content-center"
                style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
              >
                <i className="ri-arrow-right-s-line" style={{ fontSize: 13 }} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-center" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', padding: '2px 0', letterSpacing: '0.03em' }}>
                  {d}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
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
                      height: 26,
                      borderRadius: 6,
                      fontSize: 11.5,
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
                      boxShadow: isSelected ? '0 3px 8px rgba(106,90,205,0.3)' : 'none',
                      opacity: disabled ? 0.35 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div
              className="d-flex justify-content-between align-items-center pt-1 mt-1"
              style={{ borderTop: '1px solid var(--vz-border-color)' }}
            >
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="btn p-0"
                style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--vz-secondary-color)', border: 'none', background: 'transparent' }}
              >
                <i className="ri-close-line me-1" />Clear
              </button>
              <button
                type="button"
                onClick={() => { onChange(fmt(today)); setViewDate(today); setOpen(false); }}
                className="btn p-0 d-inline-flex align-items-center gap-1"
                style={{ fontSize: 10.5, fontWeight: 700, color: '#6a5acd', border: 'none', background: 'transparent' }}
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
      <MasterFormStyles />
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
        .bf-wrap .form-control,
        .bf-wrap .form-select,
        .bf-wrap .dropdown-toggle.btn-light {
          border: 1px solid var(--vz-border-color);
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
          background: var(--vz-card-bg);
        }
        .bf-wrap .form-control:hover,
        .bf-wrap .form-select:hover,
        .bf-wrap .dropdown-toggle.btn-light:hover {
          border-color: rgba(99,102,241,0.45);
        }
        .bf-wrap .form-control:focus,
        .bf-wrap .form-select:focus,
        .bf-wrap .dropdown-toggle.btn-light:focus,
        .bf-wrap .show > .dropdown-toggle.btn-light {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }
        .bf-wrap .form-control.is-invalid,
        .bf-wrap .form-control.is-invalid:focus {
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
      <div className="bf-wrap">
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
                <i className={isEdit ? 'ri-edit-2-line' : 'ri-git-branch-line'} style={{ color: '#fff', fontSize: 20 }} />
              </span>
              <div>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 15 }}>Branch Registration Form</h6>
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
              {isEdit ? 'Edit Mode' : 'New Branch'}
            </span>
          </CardHeader>

          <CardBody style={css.cardBody}>

            {/* ══ A: Branch Details ══ */}
            <SectionHeader icon="ri-git-branch-line" title="Branch Details" badge="A" />
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Branch Name <span className="text-danger">*</span></Lbl>
                <Input name="name" style={css.input} value={form.name} invalid={fieldInvalid('name')}
                  onChange={e => set('name', e.target.value)} onBlur={() => touch('name')}
                  placeholder="e.g., Head Office" />
                <FormFeedback style={css.formFeedback}>{fieldError('name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Branch Code</Lbl>
                <Input style={css.input} value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
                  placeholder="HO-MUM" maxLength={20} />
              </Col>
              <Col md={4}>
                <Lbl>Branch Type</Lbl>
                <SelectDD
                  isOpen={ddBranchType} toggle={() => setDdBranchType(o => !o)}
                  value={form.branch_type} placeholder="Select type" fieldKey="branch_type"
                  options={[
                    { label: 'Company',   value: 'company' },
                    { label: 'Division',  value: 'division' },
                    { label: 'Factory',   value: 'factory' },
                    { label: 'Warehouse', value: 'warehouse' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Industry</Lbl>
                <Input style={css.input} value={form.industry} onChange={e => set('industry', e.target.value)}
                  placeholder="e.g., Manufacturing" />
              </Col>
              <Col md={4}>
                <Lbl>Contact Person</Lbl>
                <Input style={css.input} value={form.contact_person} onChange={e => set('contact_person', e.target.value)}
                  placeholder="Name of contact person" />
              </Col>
              <Col md={4}>
                <Lbl>Status</Lbl>
                <SelectDD
                  isOpen={ddStatus} toggle={() => setDdStatus(o => !o)}
                  value={form.status} fieldKey="status" dotColor
                  options={[
                    { label: 'Active',   value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Email</Lbl>
                <Input name="email" style={css.input} type="email" value={form.email} invalid={fieldInvalid('email')}
                  onChange={e => set('email', e.target.value)} onBlur={() => touch('email')}
                  placeholder="branch@company.com" />
                <FormFeedback style={css.formFeedback}>{fieldError('email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Phone</Lbl>
                <Input name="phone" style={css.input} type="tel" value={form.phone} invalid={fieldInvalid('phone')}
                  onChange={e => set('phone', e.target.value)} onBlur={() => touch('phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback style={css.formFeedback}>{fieldError('phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Website</Lbl>
                <Input style={css.input} type="url" value={form.website} onChange={e => set('website', e.target.value)}
                  placeholder="www.branch.com" />
              </Col>
              <Col xs={12}>
                <Lbl>Description</Lbl>
                <Input style={css.textarea} type="textarea" rows={2} value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Short description of this branch..." />
              </Col>
            </Row>

            {/* ══ B: Main Branch & Limits ══ */}
            <SectionHeader icon="ri-star-line" title="Main Branch & Limits" badge="B" />
            <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(255,212,122,0.05))', border: '1px solid rgba(245,158,11,0.28)', color: '#B45309' }}>
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#f7b84b,#ffd47a)', boxShadow: '0 3px 8px rgba(247,184,75,0.3)' }}
              >
                <i className="ri-information-line" style={{ color: '#fff', fontSize: 13 }} />
              </span>
              <span>Main Branch users can view all branches data. Only one branch can be main at a time.</span>
            </div>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Is Main Branch?</Lbl>
                <SelectDD
                  isOpen={ddIsMain} toggle={() => setDdIsMain(o => !o)}
                  value={form.is_main} fieldKey="is_main"
                  options={[
                    { label: 'No (Regular Branch)',       value: 'false' },
                    { label: 'Yes (Main / Head Office)',  value: 'true' },
                  ]}
                />
              </Col>
              <Col md={4}>
                <Lbl>Max Users (0 = unlimited)</Lbl>
                <Input name="max_users" style={css.input} type="number" min={0} value={form.max_users}
                  invalid={fieldInvalid('max_users')}
                  onChange={e => set('max_users', e.target.value)} onBlur={() => touch('max_users')} />
                <FormFeedback style={css.formFeedback}>{fieldError('max_users')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Established Date</Lbl>
                <div style={{ maxWidth: 240 }}>
                  <ThemedDatePicker
                    value={form.established_at}
                    onChange={v => set('established_at', v)}
                    placeholder="Select date"
                  />
                </div>
              </Col>
            </Row>

            {/* ══ C: Address ══ */}
            {/* Order: Street -> Country -> State -> City -> District -> Taluka -> Pincode.
                Country drives the State dropdown (cascading from master data). */}
            <SectionHeader icon="ri-map-pin-line" title="Address Details" badge="C" />
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <Lbl>Street Address</Lbl>
                <Input style={css.textarea} type="textarea" rows={1} value={form.address}
                  onChange={e => set('address', e.target.value)}
                  placeholder="Plot No, Street, Landmark..." />
              </Col>
              <Col md={4}>
                <Lbl>Country</Lbl>
                <SelectDD
                  isOpen={ddCountry} toggle={() => setDdCountry(o => !o)}
                  value={form.country} placeholder="Select country" fieldKey="country"
                  options={countryOptions}
                />
              </Col>
              <Col md={4}>
                <Lbl>State</Lbl>
                <SelectDD
                  isOpen={ddState} toggle={() => setDdState(o => !o)}
                  value={form.state}
                  placeholder={form.country ? (stateOptions.length ? 'Select state' : 'No states for this country') : 'Pick a country first'}
                  fieldKey="state"
                  options={stateOptions}
                />
              </Col>
              <Col md={4}>
                <Lbl>City</Lbl>
                <Input style={css.input} value={form.city} onChange={e => set('city', e.target.value)}
                  placeholder="e.g., Mumbai" />
              </Col>
              <Col md={4}>
                <Lbl>District</Lbl>
                <Input style={css.input} value={form.district} onChange={e => set('district', e.target.value)}
                  placeholder="e.g., Mumbai" />
              </Col>
              <Col md={4}>
                <Lbl>Taluka</Lbl>
                <Input style={css.input} value={form.taluka} onChange={e => set('taluka', e.target.value)} />
              </Col>
              <Col md={4}>
                <Lbl>Pincode</Lbl>
                <Input name="pincode" style={css.input} value={form.pincode} invalid={fieldInvalid('pincode')} maxLength={6}
                  onChange={e => set('pincode', e.target.value)} onBlur={() => touch('pincode')}
                  placeholder="400001" />
                <FormFeedback style={css.formFeedback}>{fieldError('pincode')}</FormFeedback>
              </Col>
            </Row>

            {/* ══ D: Legal & Registration ══ */}
            <SectionHeader icon="ri-file-text-line" title="Legal & Registration" badge="D" />
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>GST Number</Lbl>
                <Input name="gst_number" style={css.input} value={form.gst_number} invalid={fieldInvalid('gst_number')} maxLength={15}
                  onChange={e => set('gst_number', e.target.value.toUpperCase())} onBlur={() => touch('gst_number')}
                  placeholder="27AABCU9603R1ZM" />
                <FormFeedback style={css.formFeedback}>{fieldError('gst_number')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>PAN Number</Lbl>
                <Input name="pan_number" style={css.input} value={form.pan_number} invalid={fieldInvalid('pan_number')} maxLength={10}
                  onChange={e => set('pan_number', e.target.value.toUpperCase())} onBlur={() => touch('pan_number')}
                  placeholder="AABCU9603R" />
                <FormFeedback style={css.formFeedback}>{fieldError('pan_number')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Registration Number</Lbl>
                <Input style={css.input} value={form.registration_number}
                  onChange={e => set('registration_number', e.target.value)}
                  placeholder="REG-XXXX-XXXX" />
              </Col>
            </Row>

            {/* ══ E: Branch User Credentials ══ */}
            <SectionHeader icon="ri-user-line" title={isEdit ? 'Branch User Credentials' : 'Branch User Credentials (Required)'} badge="E" />
            <div style={{ ...css.alert, background: 'linear-gradient(135deg, rgba(106,90,205,0.10), rgba(167,139,250,0.05))', border: '1px solid rgba(106,90,205,0.28)', color: '#4c3fb1' }}>
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#6a5acd,#a78bfa)', boxShadow: '0 3px 8px rgba(106,90,205,0.3)' }}
              >
                <i className={isEdit ? 'ri-lock-line' : 'ri-error-warning-line'} style={{ color: '#fff', fontSize: 13 }} />
              </span>
              <span>
                {isEdit
                  ? 'Update the login user for this branch. Leave password blank to keep current.'
                  : 'Name, Email and Password are required — this creates the first login user for this branch.'}
              </span>
            </div>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Full Name {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input name="user_name" style={css.input} value={form.user_name} invalid={fieldInvalid('user_name')}
                  onChange={e => set('user_name', e.target.value)} onBlur={() => touch('user_name')}
                  placeholder="User full name" />
                <FormFeedback style={css.formFeedback}>{fieldError('user_name')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Email {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input name="user_email" style={css.input} type="email" value={form.user_email} invalid={fieldInvalid('user_email')}
                  onChange={e => set('user_email', e.target.value)} onBlur={() => touch('user_email')}
                  placeholder="user@branch.com" />
                <FormFeedback style={css.formFeedback}>{fieldError('user_email')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Phone</Lbl>
                <Input style={css.input} type="tel" value={form.user_phone}
                  onChange={e => set('user_phone', e.target.value)}
                  placeholder="+91 9876543210" />
              </Col>
              <Col md={4}>
                <Lbl>Designation</Lbl>
                <Input style={css.input} value={form.user_designation}
                  onChange={e => set('user_designation', e.target.value)}
                  placeholder="Branch Manager" />
              </Col>
              <Col md={4}>
                <Lbl>{isEdit ? 'New Password' : 'Password'} {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input name="user_password" style={css.input} type="password" value={form.user_password}
                  invalid={fieldInvalid('user_password')}
                  onChange={e => set('user_password', e.target.value)} onBlur={() => touch('user_password')}
                  placeholder={isEdit ? 'Leave blank to keep' : 'Min. 6 characters'} />
                <FormFeedback style={css.formFeedback}>{fieldError('user_password')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Confirm Password {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <Input name="user_password_confirmation" style={css.input} type="password"
                  value={form.user_password_confirmation}
                  invalid={fieldInvalid('user_password_confirmation')}
                  onChange={e => set('user_password_confirmation', e.target.value)}
                  onBlur={() => touch('user_password_confirmation')}
                  placeholder="Re-enter password" />
                <FormFeedback style={css.formFeedback}>{fieldError('user_password_confirmation')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>User Status</Lbl>
                <SelectDD
                  isOpen={ddUserStatus} toggle={() => setDdUserStatus(o => !o)}
                  value={form.user_status} fieldKey="user_status" dotColor
                  options={[
                    { label: 'Active',   value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                  ]}
                />
              </Col>
            </Row>

            {/* ══ F: Notes ══ */}
            <SectionHeader icon="ri-sticky-note-line" title="Notes" badge="F" />
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <Lbl>Internal Notes</Lbl>
                <Input style={css.textarea} type="textarea" rows={2} value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Any internal notes about this branch..." />
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
                    {isEdit ? 'Review changes before saving' : 'Ready to create branch'}
                    {form.name && <> · <span style={{ color: '#6366f1' }}>{form.name}</span></>}
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
                  {saving ? 'Saving...' : isEdit ? 'Update Branch' : 'Create Branch'}
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
