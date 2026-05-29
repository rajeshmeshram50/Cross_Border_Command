import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label,
  Spinner, Form, FormFeedback,
  Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import { Shimmer } from '../../components/ui/Shimmer';
import { readClientFormBundle, writeClientFormBundle } from './clientFormBundleCache';

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
  status: 'active', sports: '', industry: '', address: '', city: '',
  district: '', taluka: '', pincode: '', state: '', country: '',
  gst_number: '', pan_number: '', plan_id: '', plan_type: 'free',
  plan_expires_at: '', primary_color: '#4F46E5', secondary_color: '#10B981',
  notes: '', admin_name: '', admin_email: '', admin_phone: '',
  admin_designation: '', admin_password: '', admin_password_confirmation: '',
  admin_status: 'active',
};

type FormState = typeof empty;

const PW_RULES = [
  'At least 8 characters',
  'One uppercase letter',
  'One lowercase letter',
  'One number',
] as const;

function validatePasswordRules(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('One number');
  return errors;
}

function computePasswordStrength(pw: string) {
  if (!pw) return { level: 0, text: '', color: '', barColor: '' };
  const errors = validatePasswordRules(pw);
  const level = 4 - errors.length;
  const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const barColors = ['', '#ef4444', '#f97316', '#eab308', '#10b981'];
  const textColors = ['', 'text-danger', 'text-warning', 'text-warning', 'text-success'];
  return { level, text: levels[level], color: textColors[level], barColor: barColors[level] };
}

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
    if (form.gst_number) {
      if (form.gst_number.length !== 15) {
        e.gst_number = `GSTIN must be exactly 15 characters (you entered ${form.gst_number.length})`;
      } else if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gst_number)) {
        e.gst_number = 'Invalid GSTIN format. Example: 27AADCI6120M1ZH';
      }
    }
    if (form.pan_number) {
      if (form.pan_number.length !== 10) {
        e.pan_number = `PAN must be exactly 10 characters (you entered ${form.pan_number.length})`;
      } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)) {
        e.pan_number = 'Invalid PAN format. Example: AADCI6120M (5 letters + 4 digits + 1 letter)';
      }
    }
  }
  if (!form.plan_id) e.plan_id = 'Plan is required';
  if (!form.plan_type) e.plan_type = 'Plan type is required';
  if (!isEdit) {
    if (!form.admin_name?.trim()) e.admin_name = 'Admin name is required';
    if (!form.admin_email?.trim()) e.admin_email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) e.admin_email = 'Invalid email format';
    if (!form.admin_phone?.trim()) e.admin_phone = 'Phone is required';
    if (!form.admin_password) e.admin_password = 'Password is required';
    else {
      const errs = validatePasswordRules(form.admin_password);
      if (errs.length) e.admin_password = errs.join(', ');
    }
  } else {
    if (form.admin_password) {
      const errs = validatePasswordRules(form.admin_password);
      if (errs.length) e.admin_password = errs.join(', ');
    }
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
    fontSize: '13px', padding: '7px 11px', height: '38px',
    borderRadius: '10px',
  } as React.CSSProperties,
  textarea: {
    fontSize: '13px', padding: '8px 11px', borderRadius: '10px',
  } as React.CSSProperties,
  ddToggle: {
    fontSize: '13px', height: '38px', padding: '0 11px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', textAlign: 'left' as const, background: 'var(--vz-card-bg)',
    borderRadius: '10px',
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
  const [profilePhotoFile, setProfilePhotoFile]       = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const toast = useToast();
  const [saving, setSaving]           = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  // Snapshot of the password as it was loaded from the server. If the admin
  // leaves the field unchanged we skip sending admin_password on submit so
  // the backend won't re-hash and won't fire the password-changed email.
  const [originalAdminPassword, setOriginalAdminPassword] = useState('');
  const [serverErrors, setServerErrors]         = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});
  const [orgTypes, setOrgTypes] = useState<OrgType[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  // Geography lookups for the cascading Country -> State dropdowns. Both lists
  // come from the master tables seeded by GeographySeeder so every form picks
  // from the same canonical dataset.
  const [countries, setCountries] = useState<Array<{ id: number; name: string; iso_code: string; status: string }>>([]);
  const [statesAll, setStatesAll] = useState<Array<{ id: number; country_id: string; name: string; status: string }>>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  /* Bundled form fetch — /clients/form-bundle returns organization_types,
   * plans, and countries in ONE round-trip. States are NO LONGER bundled
   * because the master table has ~1797 rows (was 87% of the old payload)
   * and the user only ever sees states for one country at a time. States
   * are now fetched lazily by the country-change effect below.
   *
   * Caching: the bundle is read from sessionStorage first (5-min TTL).
   * Cache hit ⇒ synchronous hydration, 0 API calls. Cache miss ⇒ fetch
   * + persist for next time. */
  useEffect(() => {
    type Bundle = {
      organization_types: OrgType[];
      plans: PlanOption[];
      countries: Array<{ id: number; name: string; iso_code: string; status: string }>;
    };

    const hydrate = (b: Bundle) => {
      setOrgTypes(Array.isArray(b.organization_types) ? b.organization_types : []);
      // Server already returns active plans only.
      setPlans(Array.isArray(b.plans) ? b.plans : []);
      // Server already returns active+sorted countries.
      setCountries(Array.isArray(b.countries) ? b.countries : []);
    };

    // Cache hit — hydrate immediately, skip the network entirely.
    const cached = readClientFormBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setLoadingLookups(false);
      return;
    }

    api.get<Bundle>('/clients/form-bundle')
      .then(res => {
        hydrate(res.data);
        writeClientFormBundle(res.data);
      })
      .catch(() => { /* dropdowns stay empty on failure */ })
      .finally(() => setLoadingLookups(false));
  }, []);

  /* Lazy states fetch — fires whenever the selected country changes.
   *
   * Was: all 1797 states shipped in /clients/form-bundle on every modal
   * open (~122 KB / 87% of payload).
   *
   * Now: states for ONE country only, fetched after the country is picked.
   * Typical country has 20-50 states → 1-2 KB payload. ClientForm stores
   * country/state by NAME (not id) for legacy reasons, so the resolver
   * below converts the picked country name → id → states query.
   *
   * In-flight requests get cancelled on rapid country switches so we
   * never end up rendering states for the previous country. */
  useEffect(() => {
    if (!form.country) {
      setStatesAll([]);
      return;
    }
    if (countries.length === 0) return; // wait until country list lands
    const selected = countries.find(c => c.name === form.country);
    if (!selected) {
      setStatesAll([]);
      return;
    }
    const controller = new AbortController();
    api.get<Array<{ id: number; country_id: string | number; name: string; status: string }>>(
      '/master/states',
      { params: { country_id: selected.id }, signal: controller.signal }
    )
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : [];
        const active = rows
          .filter(s => String(s.status ?? '').toLowerCase() === 'active')
          .map(s => ({ ...s, country_id: String(s.country_id) }));
        setStatesAll(active);
      })
      .catch(err => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        setStatesAll([]);
      });
    return () => controller.abort();
  }, [form.country, countries]);

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

  // Country options from the canonical master list. Backwards compat: legacy
  // string values like 'USA' / 'UK' were used before the master table existed,
  // so we map them to their full ISO names so existing rows still render.
  const countryOptions = useMemo(
    () => countries.map(c => ({ label: c.name, value: c.name })),
    [countries]
  );

  // State options filtered by the currently-selected country. Country values
  // stored on the form are NAMES (not ids), so we resolve back to the country
  // id and then keep only the states that match.
  const stateOptions = useMemo(() => {
    if (!form.country || countries.length === 0) return [];
    const selected = countries.find(c => c.name === form.country);
    if (!selected) return [];
    return statesAll
      .filter(s => Number(s.country_id) === selected.id)
      .map(s => ({ label: s.name, value: s.name }));
  }, [form.country, countries, statesAll]);

  // Password strength meter (mirrors Profile.tsx). Drives the colored bar,
  // label (Weak/Fair/Good/Strong) and the rule checklist under the field.
  const pwStrength = useMemo(() => computePasswordStrength(form.admin_password || ''), [form.admin_password]);

  // When the country changes, drop a previously-picked state that doesn't
  // belong to the new country. Avoids the "Maharashtra, USA" inconsistency.
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

  const handleLogoChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
      // Client-side guardrail — backend also validates. 2MB max + image types only.
      const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!okTypes.includes(file.type)) {
        toast.error('Invalid logo', 'Logo must be PNG, JPG or WebP.');
        if (inputEl) inputEl.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Logo too large', 'Logo must be 2MB or smaller.');
        if (inputEl) inputEl.value = '';
        return;
      }
    }
    setLogoFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setLogoPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setLogoPreview(null);
  };
  const handleFaviconChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
      // Favicon validation — match backend `mimes:jpg,jpeg,png,ico,svg,webp` rule
      // plus the 512KB cap so we surface the error before the upload round-trips.
      const okTypes = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
      const okExt = /\.(ico|png|jpe?g|svg|webp)$/i.test(file.name);
      if (!okTypes.includes(file.type) && !okExt) {
        toast.error('Invalid favicon', 'Favicon must be ICO, PNG, JPG, SVG or WebP.');
        if (inputEl) inputEl.value = '';
        return;
      }
      if (file.size > 512 * 1024) {
        toast.error('Favicon too large', 'Favicon must be 512KB or smaller.');
        if (inputEl) inputEl.value = '';
        return;
      }
      // Recommend square dimensions — non-blocking warning so admin can still use rectangles.
      const img = new Image();
      img.onload = () => {
        if (img.width !== img.height) {
          toast.info('Favicon tip', 'Favicons render best when square (e.g. 32×32 or 64×64).');
        }
      };
      img.src = URL.createObjectURL(file);
    }
    setFaviconFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setFaviconPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setFaviconPreview(null);
  };
  const handleProfilePhotoChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
      // Match backend `mimes:jpg,jpeg,png|max:2048` — surface the failure as a
      // toast before the upload round-trips and 422s.
      const okTypes = ['image/jpeg', 'image/png'];
      if (!okTypes.includes(file.type)) {
        toast.error('Invalid photo', 'Profile photo must be JPG or PNG.');
        if (inputEl) inputEl.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Photo too large', 'Profile photo must be 2MB or smaller.');
        if (inputEl) inputEl.value = '';
        return;
      }
    }
    setProfilePhotoFile(file);
    if (file) { const r = new FileReader(); r.onload = ev => setProfilePhotoPreview(ev.target?.result as string); r.readAsDataURL(file); }
    else setProfilePhotoPreview(null);
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
        pincode: c.pincode||'', state: c.state||'', country: c.country||'',
        gst_number: c.gst_number||'', pan_number: c.pan_number||'',
        plan_id: c.plan_id?.toString()||'', plan_type: c.plan_type||'free',
        plan_expires_at: c.plan_expires_at||'', primary_color: c.primary_color||'#4F46E5',
        secondary_color: c.secondary_color||'#10B981', notes: c.notes||'',
        admin_name: admin?.name||'', admin_email: admin?.email||'',
        admin_phone: admin?.phone||'', admin_designation: admin?.designation||'',
        // Backend decrypts `password_encrypted` for super admins and returns it
        // as `password_plain` — pre-fill both fields so the admin can SEE the
        // current password (per QA request) and edit if they want to change it.
        admin_password: admin?.password_plain || '',
        admin_password_confirmation: admin?.password_plain || '',
        admin_status: admin?.status||'active',
      });
      setOriginalAdminPassword(admin?.password_plain || '');
      // If we successfully retrieved the original password, reveal it by
      // default so the super admin sees it immediately on the edit screen
      // (matches the QA request — "should be able to see the password").
      if (admin?.password_plain) setShowPassword(true);
      // Prefer the accessor URLs (`logo_url`, `favicon_url`) which the Client
      // model appends — those resolve to a public Storage URL. Fall back to
      // the raw path for older API responses.
      if (c.logo_url    || c.logo)    setLogoPreview(c.logo_url    || c.logo);
      if (c.favicon_url || c.favicon) setFaviconPreview(c.favicon_url || c.favicon);
      if (c.profile_photo_url || c.profile_photo) setProfilePhotoPreview(c.profile_photo_url || c.profile_photo);
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
      // On edit, skip the password fields if they match the originally-loaded
      // value — otherwise every save would re-hash the password and fire the
      // password-changed email to the client admin.
      if (isEdit && form.admin_password === originalAdminPassword) {
        payload.admin_password = null;
        payload.admin_password_confirmation = null;
      }
      if (isEdit) {
        if (logoFile || faviconFile || profilePhotoFile) {
          const fd = new FormData();
          Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
          if (logoFile)         fd.append('logo', logoFile);
          if (faviconFile)      fd.append('favicon', faviconFile);
          if (profilePhotoFile) fd.append('profile_photo', profilePhotoFile);
          await api.post(`/clients/${editId}?_method=PUT`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else { await api.put(`/clients/${editId}`, payload); }
        toast.success('Updated', 'Client updated successfully');
      } else {
        const fd = new FormData();
        Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, payload[k]); });
        if (logoFile)         fd.append('logo', logoFile);
        if (faviconFile)      fd.append('favicon', faviconFile);
        if (profilePhotoFile) fd.append('profile_photo', profilePhotoFile);
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

  /* Form-shaped shimmer — fires while EITHER the edit-mode entity
   * prefill (/clients/{id}) OR the master bundle (/clients/form-bundle)
   * is in flight. Previously only edit mode showed shimmer, so new-add
   * mode flashed empty dropdowns. Extending the condition to
   * `loadingLookups` covers both flows: header banner + four sections
   * × three field rows mirror the real form layout the user is about
   * to interact with. Cache-hit (sessionStorage) flips loadingLookups
   * false immediately, so the shimmer barely appears on warm reopens. */
  if (loadingData || loadingLookups) return (
    <div className="p-3">
      <div
        style={{
          background: 'var(--shim-card-bg, #fff)',
          border: '1px solid var(--shim-border, #e5e7eb)',
          borderRadius: 16,
          padding: 24,
          marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 18,
        }}
      >
        <Shimmer width={64} height={64} radius={14} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Shimmer width={220} height={18} />
          <Shimmer width={320} height={12} />
        </div>
        <Shimmer width={120} height={36} radius={10} />
      </div>
      {Array.from({ length: 4 }).map((_, sectionIdx) => (
        <div
          key={sectionIdx}
          style={{
            background: 'var(--shim-card-bg, #fff)',
            border: '1px solid var(--shim-border, #e5e7eb)',
            borderRadius: 16,
            padding: 20,
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Shimmer width={32} height={32} radius={8} />
            <Shimmer width={180} height={14} />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 14,
            }}
          >
            {Array.from({ length: 6 }).map((__, fieldIdx) => (
              <div key={fieldIdx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Shimmer width={`${50 + (fieldIdx % 4) * 10}%`} height={10} />
                <Shimmer width="100%" height={38} radius={8} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ── SelectDD — thin wrapper that delegates to MasterSelect so every ────
  //   dropdown in this form matches the master / OrganizationTypes dropdown.
  //   Legacy props (isOpen, toggle, dotColor) are accepted for backwards
  //   compatibility with existing call sites but ignored — MasterSelect manages
  //   its own open state and doesn't render status dots.
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
            {/* Header: month nav */}
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

            {/* Weekday labels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-center" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', padding: '2px 0', letterSpacing: '0.03em' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
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

            {/* Footer: today + clear */}
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
        .cf-wrap .form-control,
        .cf-wrap .form-select,
        .cf-wrap .dropdown-toggle.btn-light {
          border: 1px solid var(--vz-border-color);
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
          background: var(--vz-card-bg);
        }
        /* Uniform 38px height + 10px corners across every form control on
           this page so single-line Inputs, InputGroup prefixes, MasterSelect
           dropdowns and the Bootstrap dropdown all line up across the grid.
           Was visually mismatched because bsSize="sm" inputs rendered ~31px
           with 4px corners while MasterSelect rendered 38px with 10px. */
        .cf-wrap .form-control,
        .cf-wrap .form-select,
        .cf-wrap .dropdown-toggle.btn-light,
        .cf-wrap .input-group-sm > .form-control,
        .cf-wrap .input-group-sm > .input-group-text,
        .cf-wrap .input-group > .input-group-text {
          height: 38px;
          min-height: 38px;
          padding-top: 7px;
          padding-bottom: 7px;
          font-size: 13px;
          line-height: 1.4;
          border-radius: 10px;
        }
        .cf-wrap textarea.form-control {
          height: auto;
          min-height: 56px;
          border-radius: 10px;
        }
        .cf-wrap .input-group > .input-group-text:first-child {
          border-top-left-radius: 10px;
          border-bottom-left-radius: 10px;
        }
        .cf-wrap .input-group > .form-control:last-child {
          border-top-right-radius: 10px;
          border-bottom-right-radius: 10px;
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
                <Input style={css.input} type="text" value={form.website} onChange={e => set('website', e.target.value)} placeholder="www.company.com or https://company.com" />
              </Col>
            </Row>

            {/* ══ B: Address ══ */}
            {/* Order: Street -> Country -> State -> City -> District -> Taluka -> Pincode.
                Country drives the State dropdown (cascading from master data). */}
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
                <Lbl>Country <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddCountry} toggle={() => setDdCountry(o => !o)}
                  value={form.country} placeholder="Select country" fieldKey="country"
                  options={countryOptions}
                />
              </Col>
              <Col md={4}>
                <Lbl>State <span className="text-danger">*</span></Lbl>
                <SelectDD
                  isOpen={ddState} toggle={() => setDdState(o => !o)}
                  value={form.state}
                  placeholder={form.country ? (stateOptions.length ? 'Select state' : 'No states for this country') : 'Pick a country first'}
                  fieldKey="state"
                  options={stateOptions}
                />
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
            </Row>

            {/* ══ C: Legal & Tax ══ */}
            <SectionHeader icon="ri-file-text-line" title="Legal & Tax Information" badge="C" />
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
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Lbl>Assign Plan <span className="text-danger">*</span></Lbl>
                <MasterSelect
                  value={form.plan_id}
                  placeholder={loadingLookups ? 'Loading…' : 'Select plan'}
                  options={plans.map(p => ({ label: formatPlanLabel(p), value: String(p.id) }))}
                  invalid={fieldInvalid('plan_id')}
                  onChange={val => { set('plan_id', val); touch('plan_id'); }}
                />
              </Col>
              <Col md={4}>
                <Lbl>Plan Type <span className="text-danger">*</span></Lbl>
                <MasterSelect
                  value={form.plan_type}
                  placeholder="Select type"
                  options={[
                    { label: 'Free', value: 'free' },
                    { label: 'Paid', value: 'paid' },
                  ]}
                  invalid={fieldInvalid('plan_type')}
                  onChange={val => { set('plan_type', val); touch('plan_type'); }}
                />
              </Col>
              {/* "Expires At" field removed per product call — expiry is
                  now driven server-side by the selected Plan's duration,
                  not by a manually-picked date. The form state still
                  carries plan_expires_at as an empty string so the
                  payload shape stays unchanged and any existing rows
                  with a stored expiry continue to round-trip. */}
            </Row>

            {/* ══ E: Admin ══ */}
            <SectionHeader icon="ri-user-line" title="Admin Credentials" badge="E" />
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
                <Lbl>{isEdit ? 'Password' : 'Password'} {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <div style={{ position: 'relative' }}>
                  <Input
                    style={{ ...css.input, paddingRight: 36 }}
                    type={showPassword ? 'text' : 'password'}
                    value={form.admin_password}
                    invalid={fieldInvalid('admin_password')}
                    autoComplete="new-password"
                    onChange={e => set('admin_password', e.target.value)}
                    onBlur={() => touch('admin_password')}
                    placeholder={isEdit ? 'Enter new password to change' : 'Minimum 8 characters'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="btn btn-link p-0 position-absolute"
                    style={{
                      top: '50%', right: 10, transform: 'translateY(-50%)',
                      color: 'var(--vz-secondary-color)', textDecoration: 'none',
                      lineHeight: 1, fontSize: 16,
                    }}
                  >
                    <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
                {/* In edit mode, tell the admin which state they're in: either
                    the original password is loaded (toggle the eye to read it)
                    or the client was created before the encrypted mirror was
                    added — in which case the password can no longer be
                    retrieved and a new one must be set. */}
                {isEdit && (
                  <small style={{ ...css.small, color: originalAdminPassword ? '#10b981' : '#f59e0b', marginTop: 4, display: 'block' }}>
                    {originalAdminPassword
                      ? <><i className="ri-shield-check-line" style={{ marginRight: 4 }} />Original password loaded — click the eye to view.</>
                      : <><i className="ri-information-line" style={{ marginRight: 4 }} />Stored before password recovery was enabled. Set a new password to make it visible on next edit.</>}
                  </small>
                )}
                <FormFeedback style={css.formFeedback}>{fieldError('admin_password')}</FormFeedback>
                {form.admin_password && (
                  <div className="mt-2">
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <div style={{ flex: 1, height: 6, background: 'var(--vz-secondary-bg)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{
                          width: `${(pwStrength.level / 4) * 100}%`,
                          height: '100%',
                          background: pwStrength.barColor,
                          transition: 'width .25s ease, background .25s ease',
                        }} />
                      </div>
                      <span className={`fs-11 fw-bold ${pwStrength.color}`} style={{ minWidth: 44, textAlign: 'right' }}>
                        {pwStrength.text}
                      </span>
                    </div>
                    <ul className="list-unstyled mb-0 mt-2" style={{ fontSize: 11 }}>
                      {PW_RULES.map(rule => {
                        const passed = !validatePasswordRules(form.admin_password).includes(rule);
                        return (
                          <li key={rule} className={`d-inline-flex align-items-center gap-1 me-3 ${passed ? 'text-success fw-semibold' : 'text-muted'}`}>
                            <i className={passed ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} style={{ fontSize: 12 }} />
                            {rule}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Col>
              <Col md={4}>
                <Lbl>Confirm Password {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <div style={{ position: 'relative' }}>
                  <Input
                    style={{ ...css.input, paddingRight: 36 }}
                    type={showPasswordConfirm ? 'text' : 'password'}
                    value={form.admin_password_confirmation}
                    invalid={fieldInvalid('admin_password_confirmation')}
                    autoComplete="new-password"
                    onChange={e => set('admin_password_confirmation', e.target.value)}
                    onBlur={() => touch('admin_password_confirmation')}
                    placeholder="Re-enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordConfirm(s => !s)}
                    aria-label={showPasswordConfirm ? 'Hide password' : 'Show password'}
                    className="btn btn-link p-0 position-absolute"
                    style={{
                      top: '50%', right: 10, transform: 'translateY(-50%)',
                      color: 'var(--vz-secondary-color)', textDecoration: 'none',
                      lineHeight: 1, fontSize: 16,
                    }}
                  >
                    <i className={showPasswordConfirm ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
                {form.admin_password_confirmation && (
                  <div className="mt-2 d-inline-flex align-items-center gap-1 fs-11 fw-semibold">
                    {form.admin_password === form.admin_password_confirmation ? (
                      <span className="text-success d-inline-flex align-items-center gap-1">
                        <i className="ri-checkbox-circle-fill" style={{ fontSize: 12 }}></i>
                        Passwords match
                      </span>
                    ) : (
                      <span className="text-danger d-inline-flex align-items-center gap-1">
                        <i className="ri-close-circle-fill" style={{ fontSize: 12 }}></i>
                        Passwords do not match
                      </span>
                    )}
                  </div>
                )}
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
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleLogoChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>PNG, JPG, WebP &middot; Recommended 200&times;400 px &middot; Max 2 MB</small>
              </Col>
              <Col md={6}>
                <Lbl>Favicon</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {faviconPreview && <img src={faviconPreview} alt="favicon" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/x-icon,image/png,image/jpeg,image/svg+xml,image/webp,.ico" onChange={e => handleFaviconChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>ICO, PNG, JPG, SVG, WebP &middot; Recommended 32&times;32 or 64&times;64 px &middot; Max 512 KB</small>
              </Col>
              <Col md={6}>
                <Lbl>Profile Photo</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {profilePhotoPreview && <img src={profilePhotoPreview} alt="profile" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '50%', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png" onChange={e => handleProfilePhotoChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>JPG, PNG — Max 2MB</small>
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
