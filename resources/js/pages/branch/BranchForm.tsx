import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Input, Label,
  Spinner, Form, FormFeedback,
} from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';
import { validatePhone } from '../../utils/validatePhone';
import { Shimmer } from '../../components/ui/Shimmer';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { readBranchFormBundle, writeBranchFormBundle } from './branchFormBundleCache';

interface Props {
  onBack: () => void;
  editId?: number;
}

const empty = {
  name: '', code: '', email: '', phone: '', website: '',
  contact_person: '', branch_type: '', industry: '', description: '',
  gst_number: '', pan_number: '', registration_number: '',
  // Letterhead / export-house compliance fields — all optional, surface
  // on the Quotation/PI PDF letterhead block when populated.
  gst_state_code: '', cin: '', iec: '',
  drug_license: '', pcpndt_no: '', aeo_code: '',
  one_star_file_no: '', one_star_udin_no: '',
  address: '', city: '', district: '', taluka: '', pincode: '',
  state: '', country: '',
  is_main: 'false', max_users: '0',
  established_at: '', status: 'active', notes: '',
  primary_color: '#4F46E5', secondary_color: '#10B981',
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
  website: 'Website',
  pincode: 'Pincode',
  gst_number: 'GST Number',
  pan_number: 'PAN Number',
  // Letterhead / export-house compliance — used by the error-summary
  // toast so the user sees "GST State Code" instead of "gst_state_code".
  gst_state_code: 'GST State Code',
  cin: 'CIN',
  iec: 'IEC',
  drug_license: 'Drug License',
  pcpndt_no: 'PCPNDT No',
  aeo_code: 'AEO Code',
  one_star_file_no: 'One Star File No',
  one_star_udin_no: 'One Star UDIN No',
  max_users: 'Max Users',
  user_name: 'User Full Name',
  user_email: 'User Email',
  user_phone: 'User Phone',
  user_password: 'Password',
  user_password_confirmation: 'Confirm Password',
};

// Website / URL validator. Accepts:
//   www.example.com         → ok
//   example.com             → ok
//   https://www.example.com → ok
//   http://sub.example.co.in/path?x=1 → ok
// Rejects bare words, missing TLD, spaces, or unsupported schemes.
function validateWebsite(raw: string): string {
  const v = raw.trim();
  if (/\s/.test(v)) return 'Website cannot contain spaces';
  if (v.length > 500) return 'Website is too long (max 500 characters)';

  // Strip optional scheme for the domain check
  const stripped = v.replace(/^https?:\/\//i, '');
  if (/^(ftp|file|javascript|mailto):/i.test(v)) {
    return 'Website must start with http:// or https://';
  }

  // domain.tld with optional subdomain, optional path/query/hash. TLD ≥ 2 chars.
  const re = /^(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i;
  if (!re.test(stripped)) {
    return 'Enter a valid website like www.example.com or https://example.com';
  }
  return '';
}

// ── Password strength rules (mirrors ClientForm + Profile) ──
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

function validateBranchForm(form: FormState, isEdit: boolean): Record<string, string> {
  const e: Record<string, string> = {};

  // ── Branch name ──
  if (!form.name?.trim()) {
    e.name = 'Branch name is required';
  } else if (form.name.trim().length < 2) {
    e.name = 'Branch name must be at least 2 characters';
  } else if (form.name.trim().length > 100) {
    e.name = 'Branch name cannot exceed 100 characters';
  }

  // ── Branch email ──
  if (form.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'Enter a valid email like: branch@company.com';
    } else if (form.email.length > 100) {
      e.email = 'Email is too long (max 100 characters)';
    }
  }

  // ── Branch phone ── (country-aware)
  if (form.phone) {
    const err = validatePhone(form.phone, form.country, 'Phone');
    if (err) e.phone = err;
  }

  // ── Website ──
  if (form.website) {
    const err = validateWebsite(form.website);
    if (err) e.website = err;
  }

  // ── Pincode ── (Indian PIN = 6 digits)
  if (form.pincode) {
    if (!/^\d{6}$/.test(form.pincode)) {
      e.pincode = `Pincode must be exactly 6 digits (you entered ${form.pincode.length})`;
    } else if (/^0/.test(form.pincode)) {
      e.pincode = 'Pincode cannot start with 0';
    }
  }

  // ── India-specific tax IDs ──
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

  // ── Max users ──
  if (form.max_users) {
    const n = parseInt(form.max_users);
    if (isNaN(n)) {
      e.max_users = 'Max users must be a number';
    } else if (n < 0) {
      e.max_users = 'Max users cannot be negative';
    } else if (n > 10000) {
      e.max_users = 'Max users seems too high (limit 10,000)';
    }
  }

  // ── Branch admin user fields (only when creating a new branch) ──
  if (!isEdit) {
    if (!form.user_name?.trim()) {
      e.user_name = 'Admin user name is required';
    } else if (form.user_name.trim().length < 2) {
      e.user_name = 'Admin name must be at least 2 characters';
    }

    if (!form.user_email?.trim()) {
      e.user_email = 'Admin email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.user_email)) {
      e.user_email = 'Enter a valid email like: admin@company.com';
    } else if (form.email && form.user_email.toLowerCase() === form.email.toLowerCase()) {
      e.user_email = 'Admin email should differ from the branch email';
    }

    if (!form.user_password) {
      e.user_password = 'Password is required';
    } else if (form.user_password.length > 64) {
      e.user_password = 'Password cannot exceed 64 characters';
    } else {
      const errs = validatePasswordRules(form.user_password);
      if (errs.length) e.user_password = errs.join(', ');
    }

    if (form.user_phone) {
      const err = validatePhone(form.user_phone, form.country, 'Admin phone');
      if (err) e.user_phone = err;
    }
  } else if (form.user_password) {
    const errs = validatePasswordRules(form.user_password);
    if (errs.length) e.user_password = errs.join(', ');
  }

  // ── Password confirmation ──
  if (form.user_password && form.user_password !== form.user_password_confirmation) {
    e.user_password_confirmation = 'Passwords do not match';
  }

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

export default function BranchForm({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [form, setForm] = useState<FormState>(empty);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  /* Confirmation gate when the user picks "Inactive" on the Status
   * dropdown. Deactivating a branch cascades — its login users get
   * disabled, its data hides from rollups, and sub-branch employees
   * lose access. The confirmation popup forces a deliberate click
   * before that happens, instead of a stray dropdown change wiping
   * out the branch silently on Save. */
  const [showInactiveConfirm, setShowInactiveConfirm] = useState(false);
  // Snapshot of the password as loaded from the server. If unchanged on
  // save we skip sending user_password so the backend won't re-hash and
  // won't fire the password-changed email.
  const [originalUserPassword, setOriginalUserPassword] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const touchedRef = useRef<Record<string, boolean>>({});

  // Branch logo upload — file is held in memory until save, then submitted
  // alongside the form via multipart/form-data. Preview is a data URL while
  // a new file is staged, or the saved /storage/... URL when editing.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  // Authorised-signatory image (signature + company stamp combined).
  // Goes on the with-signature variant of the Quotation/PI PDF in the
  // bottom-left "Authorized Signatory" block. PNG with transparent
  // background works best because it sits on the branded footer.
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);

  const handleLogoChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
      // Match backend image validation — surface failures as toast before
      // the upload round-trips.
      const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      if (!okTypes.includes(file.type)) {
        toast.error('Invalid logo', 'Logo must be PNG, JPG, WebP or SVG.');
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
    if (file) {
      const r = new FileReader();
      r.onload = ev => setLogoPreview(ev.target?.result as string);
      r.readAsDataURL(file);
    } else {
      setLogoPreview(null);
    }
  };

  const handleProfilePhotoChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
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
    if (file) {
      const r = new FileReader();
      r.onload = ev => setProfilePhotoPreview(ev.target?.result as string);
      r.readAsDataURL(file);
    } else {
      setProfilePhotoPreview(null);
    }
  };

  const handleSignatureChange = (file: File | null, inputEl?: HTMLInputElement) => {
    if (file) {
      const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!okTypes.includes(file.type)) {
        toast.error('Invalid signature', 'Signature must be PNG, JPG, or WebP.');
        if (inputEl) inputEl.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Signature too large', 'Signature image must be 2MB or smaller.');
        if (inputEl) inputEl.value = '';
        return;
      }
    }
    setSignatureFile(file);
    if (file) {
      const r = new FileReader();
      r.onload = ev => setSignaturePreview(ev.target?.result as string);
      r.readAsDataURL(file);
    } else {
      setSignaturePreview(null);
    }
  };

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
  /* True until /branches/form-bundle resolves (or the sessionStorage cache
   * hits). Drives the form shimmer below — flips to false the moment the
   * masters land OR cache hit fires (whichever comes first). */
  const [loadingLookups, setLoadingLookups] = useState(true);

  /* Bundled form fetch — /branches/form-bundle returns countries + states +
   * next_code in ONE round-trip, replacing the previous 3 separate calls
   * (/master/countries, /master/states, /branches/next-code).
   *
   * Caching strategy:
   *   • countries + states ARE cached in sessionStorage (5-min TTL via
   *     branchFormBundleCache) — they're static and worth deduplicating.
   *   • next_code is NOT cached — branch codes increment as new branches
   *     are created, so each new-add must fetch a fresh code. We still
   *     fire the network call on cache hit to get a fresh next_code,
   *     but countries/states paint instantly from cache so the dropdowns
   *     never look empty during the bundle fetch.
   */
  useEffect(() => {
    type Bundle = {
      countries: Array<{ id: number; name: string; iso_code: string; status: string }>;
      states: Array<{ id: number; country_id: string; name: string; status: string }>;
      next_code?: string;
      prefix?: string;
    };

    const hydrateMasters = (b: Pick<Bundle, 'countries' | 'states'>) => {
      // Server already returns active+sorted rows — no client filter/sort needed.
      setCountries(Array.isArray(b.countries) ? b.countries : []);
      setStatesAll(Array.isArray(b.states) ? b.states : []);
    };

    // Cache hit — populate dropdowns immediately so loadingLookups flips
    // false in the same tick. The fresh bundle call still fires below
    // (we need an up-to-date next_code), but the user already sees the
    // form ready for input.
    const cached = readBranchFormBundle<Pick<Bundle, 'countries' | 'states'>>();
    if (cached) {
      hydrateMasters(cached);
      setLoadingLookups(false);
    }

    api.get<Bundle>('/branches/form-bundle')
      .then(res => {
        hydrateMasters(res.data);
        // Persist only the static masters slice — next_code is mutable per-tenant.
        writeBranchFormBundle({
          countries: res.data.countries,
          states: res.data.states,
        });
        // Reuse the bundled next_code so we don't fire a second round-trip
        // to /branches/next-code (the legacy effect below is now removed).
        if (!isEdit && res.data.next_code) {
          setForm(prev => (prev.code ? prev : { ...prev, code: res.data.next_code! }));
        }
      })
      .catch(() => { /* dropdowns stay empty on failure */ })
      .finally(() => setLoadingLookups(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

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

  // Password strength meter for the branch admin password (mirrors ClientForm).
  const pwStrength = useMemo(() => computePasswordStrength(form.user_password || ''), [form.user_password]);

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

  // next_code is now served from /branches/form-bundle in the masters
  // effect above — the standalone /branches/next-code call has been
  // removed to save one round-trip per modal open. The server still
  // re-locks and re-allocates inside store(), so the previewed code
  // matches what gets persisted unless two creates race.

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
        gst_state_code:   b.gst_state_code   || '',
        cin:              b.cin              || '',
        iec:              b.iec              || '',
        drug_license:     b.drug_license     || '',
        pcpndt_no:        b.pcpndt_no        || '',
        aeo_code:         b.aeo_code         || '',
        one_star_file_no: b.one_star_file_no || '',
        one_star_udin_no: b.one_star_udin_no || '',
        address: b.address || '', city: b.city || '',
        district: b.district || '', taluka: b.taluka || '',
        pincode: b.pincode || '', state: b.state || '', country: b.country || '',
        is_main: b.is_main ? 'true' : 'false',
        max_users: String(b.max_users ?? 0),
        established_at: b.established_at || '', status: b.status || 'active',
        notes: b.notes || '',
        primary_color: b.primary_color || '#4F46E5',
        secondary_color: b.secondary_color || '#10B981',
        user_name: u?.name || '', user_email: u?.email || '',
        user_phone: u?.phone || '', user_designation: u?.designation || '',
        // Backend decrypts `password_encrypted` for super_admin / owning
        // client_admin and returns it as `password_plain` — pre-fill both
        // fields so the admin can SEE the current password and edit it.
        user_password: u?.password_plain || '',
        user_password_confirmation: u?.password_plain || '',
        user_status: u?.status || 'active',
      });
      setOriginalUserPassword(u?.password_plain || '');
      if (u?.password_plain) setShowPassword(true);
      // Prefer the `logo_url` accessor (resolves to a public Storage URL)
      // over the raw `logo` path — otherwise the <img> tries to load
      // "branches/logos/foo.png" relative to the SPA root and 404s.
      if (b.logo_url || b.logo) setLogoPreview(b.logo_url || b.logo);
      if (b.profile_photo_url || b.profile_photo) setProfilePhotoPreview(b.profile_photo_url || b.profile_photo);
      if (b.signature_path_url || b.signature_path) setSignaturePreview(b.signature_path_url || b.signature_path);
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
      // On edit, skip the password field if it matches the originally-loaded
      // value — otherwise every save would re-hash and fire the
      // password-changed email to the branch user.
      if (isEdit && form.user_password === originalUserPassword) {
        payload.user_password = null;
      }
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      // Serialize as '1'/'0' so the value survives multipart/form-data
      // (which only carries strings) — Laravel's `boolean` rule accepts
      // '1'/'0' but rejects 'true'/'false' string forms.
      payload.is_main = form.is_main === 'true' ? '1' : '0';
      payload.max_users = parseInt(form.max_users) || 0;

      if (isEdit) {
        if (logoFile || profilePhotoFile || signatureFile) {
          // Multipart upload — Laravel reads PUT only as application/x-www-form-urlencoded,
          // so use POST + _method=PUT spoofing (same trick ClientForm uses).
          const fd = new FormData();
          Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, String(payload[k])); });
          if (logoFile)         fd.append('logo', logoFile);
          if (profilePhotoFile) fd.append('profile_photo', profilePhotoFile);
          if (signatureFile)    fd.append('signature_path', signatureFile);
          await api.post(`/branches/${editId}?_method=PUT`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else {
          await api.put(`/branches/${editId}`, payload);
        }
        toast.success('Branch Updated', 'Branch details have been updated successfully');
      } else {
        let createRes;
        if (logoFile || profilePhotoFile || signatureFile) {
          const fd = new FormData();
          Object.keys(payload).forEach(k => { if (payload[k] !== null && payload[k] !== undefined) fd.append(k, String(payload[k])); });
          if (logoFile)         fd.append('logo', logoFile);
          if (profilePhotoFile) fd.append('profile_photo', profilePhotoFile);
          if (signatureFile)    fd.append('signature_path', signatureFile);
          createRes = await api.post('/branches', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else {
          createRes = await api.post('/branches', payload);
        }
        toast.success('Branch Created', 'New branch has been created with login credentials');
        // Surface the welcome-email outcome — if it couldn't be sent (e.g.
        // SMTP auth failure) the backend returns the exact reason here.
        const mailWarning = createRes?.data?.mail_warning;
        if (mailWarning) {
          toast.warning('Welcome email not sent', String(mailWarning));
        }
      }
      setTimeout(() => onBack(), 1200);
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data || {};
      const svErrs = data.errors || {};
      const hasFieldErrors = Object.keys(svErrs).length > 0;

      if (status === 422 && hasFieldErrors) {
        // Field-level validation errors from server
        setServerErrors(svErrs);
        const keys = Object.keys(svErrs);
        const missing = keys.slice(0, 3).map(k => FIELD_LABELS[k] || k).join(', ');
        const more = keys.length > 3 ? ` +${keys.length - 3} more` : '';
        toast.error('Fix these fields', `${missing}${more}`);
        focusFirstError(svErrs);
      } else if (status === 422 || status === 403 || status === 409) {
        // Business-rule rejection (plan limit, permission, conflict) — surface
        // the message under a `general` key so the banner at the top displays it.
        const msg = data.message || 'Request was rejected by the server.';
        setServerErrors({ general: [msg] });
        toast.error('Cannot save', msg);
        // Scroll the user back to the top of the form so they see the banner
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      } else {
        toast.error('Error', data.message || 'Something went wrong');
      }
    } finally { setSaving(false); }
  };

  const handleReset = () => {
    setForm(empty); setValidationErrors({}); touchedRef.current = {};
    setLogoFile(null); setLogoPreview(null);
  };

  /* Form-shaped shimmer — fires while EITHER the edit-mode entity
   * prefill (/branches/{id}) OR the master bundle (/branches/form-bundle)
   * is in flight. Previously only edit mode showed shimmer, so new-add
   * mode flashed empty country/state dropdowns. Extending the condition
   * to `loadingLookups` covers both flows: banner + four sections ×
   * six field cells mirror the real form layout the user is about to
   * interact with. Cache hit (sessionStorage) flips loadingLookups
   * false synchronously, so the shimmer barely appears on warm reopens.
   * Shimmer component uses the global .shimmer class which already
   * has light + dark variants in app.css via [data-bs-theme="dark"]. */
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
        /* Uniform 38px height + 10px corners across every form control on
           this page so single-line Inputs, InputGroup prefixes, MasterSelect
           dropdowns and the Bootstrap dropdown all line up across the grid.
           Was visually mismatched because bsSize="sm" inputs rendered ~31px
           with 4px corners while MasterSelect rendered 38px with 10px. */
        .bf-wrap .form-control,
        .bf-wrap .form-select,
        .bf-wrap .dropdown-toggle.btn-light,
        .bf-wrap .input-group-sm > .form-control,
        .bf-wrap .input-group-sm > .input-group-text,
        .bf-wrap .input-group > .input-group-text {
          height: 38px;
          min-height: 38px;
          padding-top: 7px;
          padding-bottom: 7px;
          font-size: 13px;
          line-height: 1.4;
          border-radius: 10px;
        }
        .bf-wrap textarea.form-control {
          height: auto;
          min-height: 56px;
          border-radius: 10px;
        }
        .bf-wrap .input-group > .input-group-text:first-child {
          border-top-left-radius: 10px;
          border-bottom-left-radius: 10px;
        }
        .bf-wrap .input-group > .form-control:last-child {
          border-top-right-radius: 10px;
          border-bottom-right-radius: 10px;
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
          <div className="frm-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-git-branch-line" /></div>
              <div className="min-w-0">
                <div className="frm-cstrip-title">{isEdit ? 'Edit Branch' : 'Add New Branch'}</div>
                <div className="frm-cstrip-sub">{isEdit ? 'Update branch office details' : 'Create a new branch office'}</div>
              </div>
            </div>
            <button type="button" className="frm-cstrip-back" onClick={onBack}>
              <i className="ri-arrow-left-line" />
              Back
            </button>
          </div>
        </Col>
      </Row>

      {serverErrors.general && (() => {
        const msg = serverErrors.general[0] || '';
        const isPlanLimit = /plan|limit|upgrade|allowed/i.test(msg);
        return (
          <div
            style={{
              ...css.alert,
              flexDirection: 'column',
              alignItems: 'stretch',
              padding: '14px 16px',
              gap: 10,
              background: isPlanLimit
                ? 'linear-gradient(135deg, rgba(247,184,75,0.12), rgba(245,158,11,0.05))'
                : 'linear-gradient(135deg, rgba(240,101,72,0.10), rgba(255,158,124,0.05))',
              border: isPlanLimit ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(240,101,72,0.30)',
              borderLeft: isPlanLimit ? '4px solid #f59e0b' : '4px solid #f06548',
              color: 'inherit',
            }}
          >
            <div className="d-flex align-items-start gap-2">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                style={{
                  width: 32,
                  height: 32,
                  background: isPlanLimit
                    ? 'linear-gradient(135deg,#f59e0b,#fbbf24)'
                    : 'linear-gradient(135deg,#f06548,#ff9e7c)',
                  boxShadow: isPlanLimit
                    ? '0 3px 10px rgba(245,158,11,0.35)'
                    : '0 3px 10px rgba(240,101,72,0.35)',
                }}
              >
                <i
                  className={isPlanLimit ? 'ri-vip-crown-line' : 'ri-error-warning-line'}
                  style={{ color: '#fff', fontSize: 16 }}
                />
              </span>
              <div className="flex-grow-1 min-w-0">
                <div style={{ fontSize: 13.5, fontWeight: 700, color: isPlanLimit ? '#d97a08' : '#f06548', marginBottom: 2 }}>
                  {isPlanLimit ? 'Plan limit reached' : 'Cannot save branch'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--vz-body-color)', lineHeight: 1.5 }}>
                  {msg}
                </div>
              </div>
            </div>
            {isPlanLimit && (
              <div className="d-flex flex-wrap gap-2 ps-md-5">
                <button
                  type="button"
                  className="btn btn-sm rounded-pill px-3 d-inline-flex align-items-center gap-1"
                  onClick={() => { try { window.location.href = '/plans'; } catch {} }}
                  style={{
                    background: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(245,158,11,0.32)',
                  }}
                >
                  <i className="ri-arrow-up-circle-line" />
                  Upgrade Plan
                </button>
                <button
                  type="button"
                  className="btn btn-sm rounded-pill px-3"
                  onClick={() => onBack()}
                  style={{
                    background: 'transparent',
                    color: 'var(--vz-body-color)',
                    border: '1px solid var(--vz-border-color)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Back to Branches
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Server-side validation summary — lists EVERY field that failed
          so the user can see exactly what's wrong instead of hunting. */}
      {Object.keys(serverErrors).filter(k => k !== 'general').length > 0 && (
        <div
          style={{
            ...css.alert,
            flexDirection: 'column',
            alignItems: 'stretch',
            background: 'linear-gradient(135deg, rgba(240,101,72,0.08), rgba(255,158,124,0.04))',
            border: '1px solid rgba(240,101,72,0.30)',
            borderLeft: '4px solid #f06548',
            color: 'inherit',
          }}
        >
          <div className="d-flex align-items-center gap-2 mb-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
              style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#f06548,#ff9e7c)', boxShadow: '0 3px 8px rgba(240,101,72,0.3)' }}
            >
              <i className="ri-error-warning-line" style={{ color: '#fff', fontSize: 13 }} />
            </span>
            <strong style={{ color: '#f06548', fontSize: 13.5 }}>
              Please fix the following {Object.keys(serverErrors).filter(k => k !== 'general').length} field{Object.keys(serverErrors).filter(k => k !== 'general').length === 1 ? '' : 's'}:
            </strong>
          </div>
          <ul className="mb-0 ps-4" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {Object.entries(serverErrors)
              .filter(([k]) => k !== 'general')
              .map(([key, msgs]) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => focusFirstError({ [key]: '' })}
                    className="btn btn-link p-0 align-baseline text-decoration-none"
                    style={{ color: '#f06548', fontWeight: 600 }}
                  >
                    {FIELD_LABELS[key] || key}
                  </button>
                  <span className="text-muted"> — </span>
                  <span>{Array.isArray(msgs) ? msgs[0] : String(msgs)}</span>
                </li>
              ))}
          </ul>
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
                <Lbl>
                  Branch Code
                  {!isEdit && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#7c5cfc', marginLeft: 6, padding: '1px 7px', borderRadius: 999, background: 'rgba(124,92,252,0.10)', border: '1px solid rgba(124,92,252,0.25)' }}>
                      auto-assigned
                    </span>
                  )}
                </Lbl>
                <Input
                  // Read-only at all times — the server is the source of
                  // truth for branch codes. On add: pre-filled with the
                  // next BR-### the API allocated; on edit: the existing
                  // code that this branch was assigned. Letting the user
                  // hand-edit it caused collisions with the auto sequence
                  // and broke the "Showing N of M" counter when an admin
                  // typed a custom string.
                  readOnly
                  style={{
                    ...css.input,
                    background: isDark ? 'rgba(124,92,252,0.14)' : '#f5f1ff',
                    color: isDark ? '#b9a8ff' : '#5a3fd1',
                    borderColor: isDark ? 'rgba(124,92,252,0.35)' : 'rgba(124,92,252,0.30)',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    cursor: 'not-allowed',
                  }}
                  value={form.code}
                  placeholder="BR-001"
                  maxLength={20}
                  title="Branch code is auto-assigned and cannot be edited"
                />
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
                {/* Status uses MasterSelect directly (not the SelectDD
                    wrapper) so we can intercept the value change. When
                    the user picks "Inactive" from an "Active" branch we
                    open a confirmation popup instead of writing the
                    change straight into form state — deactivating a
                    branch is a heavy side-effect operation (cascades
                    to users + data visibility), and the previous
                    silent dropdown made it too easy to flip
                    accidentally. */}
                <MasterSelect
                  value={form.status}
                  placeholder="Select"
                  invalid={fieldInvalid('status')}
                  options={[
                    { label: 'Active',   value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                  ]}
                  onChange={val => {
                    if (val === 'inactive' && form.status === 'active') {
                      setShowInactiveConfirm(true);
                      return;
                    }
                    set('status', val);
                    touch('status');
                  }}
                />
                {fieldInvalid('status') && (
                  <div style={{ fontSize: '10.5px', color: '#f06548', marginTop: '2px' }}>
                    {fieldError('status')}
                  </div>
                )}
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
                {/* type="text" not "url" — the browser's url validation
                    rejects bare-domain inputs like "www.branch.com" and
                    forces the user to type "http://..." even though our
                    own validateWebsite() (and the placeholder) accepts
                    the www. form. Keep our regex as the gate so the
                    UX stays consistent with the hint text. */}
                <Input name="website" style={css.input} type="text" value={form.website}
                  invalid={fieldInvalid('website')}
                  onChange={e => set('website', e.target.value)} onBlur={() => touch('website')}
                  placeholder="www.branch.com or https://branch.com" />
                <FormFeedback style={css.formFeedback}>{fieldError('website')}</FormFeedback>
              </Col>
              <Col md={8}>
                <Lbl>Description</Lbl>
                <Input style={css.textarea} type="textarea" rows={2} value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Short description of this branch..." />
              </Col>
              <Col md={4}>
                <Lbl>Branch Logo</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {logoPreview && <img src={logoPreview} alt="logo" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e => handleLogoChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>PNG, JPG, WebP, SVG &middot; Recommended 200&times;400 px &middot; Max 2 MB &middot; Falls back to client logo if blank</small>
              </Col>
              <Col md={4}>
                <Lbl>Profile Photo</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {profilePhotoPreview && <img src={profilePhotoPreview} alt="profile" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '50%', border: '1px solid rgba(128,128,128,0.2)', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png" onChange={e => handleProfilePhotoChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>JPG, PNG &middot; Square 200&times;200 px recommended &middot; Max 2 MB</small>
              </Col>
              <Col md={4}>
                <Lbl>Authorized Signatory (Stamp &amp; Signature)</Lbl>
                <div className="d-flex gap-2 align-items-center">
                  {signaturePreview && <img src={signaturePreview} alt="signature" style={{ width: 60, height: 40, objectFit: 'contain', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)', background: '#ffffff', padding: '2px', flexShrink: 0 }} />}
                  <Input style={{ fontSize: '11.5px' }} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleSignatureChange(e.target.files?.[0] || null, e.target as HTMLInputElement)} />
                </div>
                <small style={css.small}>PNG (transparent bg) preferred &middot; Appears on signed Quotation / PI PDFs &middot; Max 2 MB</small>
              </Col>
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
            </Row>

            {/* ══ B: Main Branch & Limits ══ */}
            <SectionHeader icon="ri-star-line" title="Main Branch & Limits" badge="B" />
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
                  {/* Swapped from the in-file ThemedDatePicker to the
                      shared MasterDatePicker so this calendar matches
                      every other date control across the app
                      (master forms, recruitment, products). The old
                      one had its own month/year drill-down that
                      diverged from the rest, so users said the calendar
                      "looked wrong" only on this page. */}
                  <MasterDatePicker
                    value={form.established_at}
                    onChange={v => set('established_at', v)}
                    placeholder="Select date"
                    maxDate={new Date().toISOString().slice(0, 10)}
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

              {/* ── Letterhead / export-house compliance fields ──
                  All optional. Show on the Quotation/PI PDF letterhead
                  block when populated. Two rows so the section doesn't
                  get visually overwhelming. */}
              <Col md={4}>
                <Lbl>GST State Code</Lbl>
                <Input style={css.input} value={form.gst_state_code}
                  onChange={e => set('gst_state_code', e.target.value.toUpperCase())}
                  maxLength={10} placeholder="27" />
              </Col>
              <Col md={4}>
                <Lbl>CIN</Lbl>
                <Input style={css.input} value={form.cin}
                  onChange={e => set('cin', e.target.value.toUpperCase())}
                  maxLength={30} placeholder="U85100PN2014PTC152252" />
              </Col>
              <Col md={4}>
                <Lbl>IEC</Lbl>
                <Input style={css.input} value={form.iec}
                  onChange={e => set('iec', e.target.value.toUpperCase())}
                  maxLength={30} placeholder="3114017398" />
              </Col>
              <Col md={4}>
                <Lbl>Drug License</Lbl>
                <Input style={css.input} value={form.drug_license}
                  onChange={e => set('drug_license', e.target.value)}
                  maxLength={60} placeholder="Optional" />
              </Col>
              <Col md={4}>
                <Lbl>PCPNDT No</Lbl>
                <Input style={css.input} value={form.pcpndt_no}
                  onChange={e => set('pcpndt_no', e.target.value)}
                  maxLength={60} placeholder="Optional" />
              </Col>
              <Col md={4}>
                <Lbl>AEO Code</Lbl>
                <Input style={css.input} value={form.aeo_code}
                  onChange={e => set('aeo_code', e.target.value.toUpperCase())}
                  maxLength={60} placeholder="Optional" />
              </Col>
              <Col md={6}>
                <Lbl>One Star Export House — File No</Lbl>
                <Input style={css.input} value={form.one_star_file_no}
                  onChange={e => set('one_star_file_no', e.target.value)}
                  maxLength={60} placeholder="Optional" />
              </Col>
              <Col md={6}>
                <Lbl>One Star Export House — UDIN No</Lbl>
                <Input style={css.input} value={form.one_star_udin_no}
                  onChange={e => set('one_star_udin_no', e.target.value)}
                  maxLength={60} placeholder="Optional" />
              </Col>
            </Row>

            {/* ══ E: Branch User Credentials ══ */}
            <SectionHeader icon="ri-user-line" title={isEdit ? 'Branch User Credentials' : 'Branch User Credentials (Required)'} badge="E" />
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
                <Input name="user_phone" style={css.input} type="tel" value={form.user_phone}
                  invalid={fieldInvalid('user_phone')}
                  onChange={e => set('user_phone', e.target.value)} onBlur={() => touch('user_phone')}
                  placeholder="+91 9876543210" />
                <FormFeedback style={css.formFeedback}>{fieldError('user_phone')}</FormFeedback>
              </Col>
              <Col md={4}>
                <Lbl>Designation</Lbl>
                <Input style={css.input} value={form.user_designation}
                  onChange={e => set('user_designation', e.target.value)}
                  placeholder="Branch Manager" />
              </Col>
              <Col md={4}>
                <Lbl>Password {!isEdit && <span className="text-danger">*</span>}</Lbl>
                <div style={{ position: 'relative' }}>
                  <Input
                    name="user_password"
                    style={{ ...css.input, paddingRight: 36 }}
                    type={showPassword ? 'text' : 'password'}
                    value={form.user_password}
                    invalid={fieldInvalid('user_password')}
                    autoComplete="new-password"
                    onChange={e => set('user_password', e.target.value)}
                    onBlur={() => touch('user_password')}
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
                <FormFeedback style={css.formFeedback}>{fieldError('user_password')}</FormFeedback>
                {isEdit && (
                  <small style={{ ...css.small, color: originalUserPassword ? '#10b981' : '#f59e0b', marginTop: 4, display: 'block' }}>
                    {originalUserPassword
                      ? <><i className="ri-shield-check-line" style={{ marginRight: 4 }} />Original password loaded — click the eye to view.</>
                      : <><i className="ri-information-line" style={{ marginRight: 4 }} />Stored before password recovery was enabled. Set a new password to make it visible on next edit.</>}
                  </small>
                )}
                {form.user_password && (
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
                        const passed = !validatePasswordRules(form.user_password).includes(rule);
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
                    name="user_password_confirmation"
                    style={{ ...css.input, paddingRight: 36 }}
                    type={showPasswordConfirm ? 'text' : 'password'}
                    value={form.user_password_confirmation}
                    invalid={fieldInvalid('user_password_confirmation')}
                    autoComplete="new-password"
                    onChange={e => set('user_password_confirmation', e.target.value)}
                    onBlur={() => touch('user_password_confirmation')}
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
                {form.user_password_confirmation && (
                  <div className="mt-2 d-inline-flex align-items-center gap-1 fs-11 fw-semibold">
                    {form.user_password === form.user_password_confirmation ? (
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

      {/* Confirmation popup for "Active → Inactive" status change.
          Confirming commits the change to local form state — the
          actual server-side cascade still fires from the normal Save
          flow at the bottom of the form, not from this dialog. */}
      <DeleteConfirmModal
        open={showInactiveConfirm}
        itemName={form.name || 'this branch'}
        title="Set Branch Inactive?"
        subMessage="Inactive branches disappear from rollups, their login users are disabled, and sub-branch employees lose access. You can re-activate later from the Branches list."
        onClose={() => setShowInactiveConfirm(false)}
        onConfirm={() => {
          set('status', 'inactive');
          touch('status');
          setShowInactiveConfirm(false);
        }}
      />
    </>
  );
}
