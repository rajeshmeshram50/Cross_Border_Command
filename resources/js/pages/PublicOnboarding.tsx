import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Row, Col } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';

interface InvitePreview {
  invitee_name: string;
  invitee_email: string;
  department_id: number | null;
  expected_join_date: string | null;
  expires_at: string | null;
  org_name: string;
  logo_url: string | null;
  website: string | null;
}

interface MasterOption { id: number; name: string; country_id?: number }
interface LegalEntityOption { id: number; entity_name: string; city?: string | null }

type StepNum = 1 | 2 | 3;

/**
 * Prefix-icon wrapper for form fields — mirrors masterFormKit's `.master-field`
 * pattern. Defined at module scope (NOT inside the component) so React keeps
 * the same component identity across re-renders. If this were declared inline
 * inside `PublicOnboarding`, every keystroke would re-create the component
 * type, unmount the input, and clobber focus after a single character.
 */
function IconField({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="onb-field">
      <i className={`onb-field-icon ${icon}`} />
      {children}
    </div>
  );
}

export default function PublicOnboarding() {
  const { token } = useParams<{ token: string }>();
  const toast = useToast();
  const draftKey = token ? `cbc:public-onboarding-draft:${token}` : '';

  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]        = useState<{ emp_code: string; display_name: string } | null>(null);

  const [invite, setInvite]    = useState<InvitePreview | null>(null);
  const [countries, setCountries]       = useState<MasterOption[]>([]);
  const [states, setStates]             = useState<MasterOption[]>([]);
  const [departments, setDepartments]   = useState<MasterOption[]>([]);
  const [designations, setDesignations] = useState<MasterOption[]>([]);
  const [roles, setRoles]               = useState<MasterOption[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntityOption[]>([]);

  // Wizard step
  const [step, setStep] = useState<StepNum>(1);

  // Latest allowed DOB = today − 18 years. Caps the picker so candidates
  // can't even pick a date that would make them under 18 (the validator
  // re-checks on submit). ISO yyyy-mm-dd format matches MasterDatePicker.
  const dobMaxDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().slice(0, 10);
  })();

  // ── Step 1 — Personal
  const [firstName,  setFirstName]  = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName,   setLastName]   = useState('');
  const [gender,     setGender]     = useState('');
  const [dob,        setDob]        = useState('');
  const [mobile,     setMobile]     = useState('');
  const [altMobile,  setAltMobile]  = useState('');
  const [workCountry, setWorkCountry] = useState('');
  const [nationality, setNationality] = useState('');

  // ── Step 2 — Address
  const [curAddr1, setCurAddr1] = useState('');
  const [curAddr2, setCurAddr2] = useState('');
  const [curCity,  setCurCity]  = useState('');
  const [curState, setCurState] = useState('');
  const [curCountry, setCurCountry] = useState('');
  const [curPin,   setCurPin]   = useState('');
  const [sameAsCurrent, setSameAsCurrent] = useState(false);
  const [permAddr1, setPermAddr1] = useState('');
  const [permAddr2, setPermAddr2] = useState('');
  const [permCity,  setPermCity]  = useState('');
  const [permState, setPermState] = useState('');
  const [permCountry, setPermCountry] = useState('');
  const [permPin,   setPermPin]   = useState('');

  // ── Step 3 — Job
  const [departmentId,  setDepartmentId]  = useState('');
  const [designationId, setDesignationId] = useState('');
  const [primaryRoleId, setPrimaryRoleId] = useState('');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [location,      setLocation]      = useState('');
  const [joiningDate,   setJoiningDate]   = useState('');

  const [errs, setErrs] = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrs(prev => {
    if (!prev[k]) return prev;
    const n = { ...prev }; delete n[k]; return n;
  });

  // Hydrate invite + masters, AND restore any saved draft for this token.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/onboarding/${encodeURIComponent(token)}`)
      .then(r => {
        if (cancelled) return;
        const data = r.data;
        const inv: InvitePreview = data.invite;
        setInvite(inv);
        setCountries(data.masters?.countries ?? []);
        setStates(data.masters?.states ?? []);
        setDepartments(data.masters?.departments ?? []);
        setDesignations(data.masters?.designations ?? []);
        setRoles(data.masters?.roles ?? []);
        setLegalEntities(data.masters?.legal_entities ?? []);

        // Pre-fill name from invite (only used as default — draft overrides
        // below if the candidate already started filling).
        const parts = (inv.invitee_name || '').trim().split(/\s+/);
        const inviteFirst  = parts[0] || '';
        const inviteMiddle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        const inviteLast   = parts.length >= 2 ? parts[parts.length - 1] : '';
        setFirstName(inviteFirst);
        setMiddleName(inviteMiddle);
        setLastName(inviteLast);
        if (inv.department_id) setDepartmentId(String(inv.department_id));
        if (inv.expected_join_date) setJoiningDate(inv.expected_join_date.slice(0, 10));

        // Restore draft AFTER setting invite defaults so user-typed values
        // win over invite pre-fill.
        try {
          const raw = draftKey ? localStorage.getItem(draftKey) : null;
          if (raw) {
            const d = JSON.parse(raw);
            if (d && typeof d === 'object') applyDraftFields(d);
            // Resume at the step they last reached.
            if (d?.step === 2 || d?.step === 3) setStep(d.step);
          }
        } catch { /* corrupt draft — start fresh */ }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Could not load this onboarding link.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /** Apply a draft snapshot back onto state. Skips unknown / null fields. */
  const applyDraftFields = (d: Record<string, any>) => {
    if (typeof d.firstName  === 'string') setFirstName(d.firstName);
    if (typeof d.middleName === 'string') setMiddleName(d.middleName);
    if (typeof d.lastName   === 'string') setLastName(d.lastName);
    if (typeof d.gender     === 'string') setGender(d.gender);
    if (typeof d.dob        === 'string') setDob(d.dob);
    if (typeof d.mobile     === 'string') setMobile(d.mobile);
    if (typeof d.altMobile  === 'string') setAltMobile(d.altMobile);
    if (typeof d.workCountry === 'string') setWorkCountry(d.workCountry);
    if (typeof d.nationality === 'string') setNationality(d.nationality);
    if (typeof d.curAddr1 === 'string') setCurAddr1(d.curAddr1);
    if (typeof d.curAddr2 === 'string') setCurAddr2(d.curAddr2);
    if (typeof d.curCity  === 'string') setCurCity(d.curCity);
    if (typeof d.curState === 'string') setCurState(d.curState);
    if (typeof d.curCountry === 'string') setCurCountry(d.curCountry);
    if (typeof d.curPin   === 'string') setCurPin(d.curPin);
    if (typeof d.sameAsCurrent === 'boolean') setSameAsCurrent(d.sameAsCurrent);
    if (typeof d.permAddr1 === 'string') setPermAddr1(d.permAddr1);
    if (typeof d.permAddr2 === 'string') setPermAddr2(d.permAddr2);
    if (typeof d.permCity  === 'string') setPermCity(d.permCity);
    if (typeof d.permState === 'string') setPermState(d.permState);
    if (typeof d.permCountry === 'string') setPermCountry(d.permCountry);
    if (typeof d.permPin   === 'string') setPermPin(d.permPin);
    if (typeof d.departmentId  === 'string') setDepartmentId(d.departmentId);
    if (typeof d.designationId === 'string') setDesignationId(d.designationId);
    if (typeof d.primaryRoleId === 'string') setPrimaryRoleId(d.primaryRoleId);
    if (typeof d.legalEntityId === 'string') setLegalEntityId(d.legalEntityId);
    if (typeof d.location === 'string') setLocation(d.location);
    if (typeof d.joiningDate === 'string') setJoiningDate(d.joiningDate);
  };

  // Persist draft on every change. Skipped while loading (to avoid
  // overwriting the saved draft with empty defaults before hydration) and
  // after success.
  useEffect(() => {
    if (loading || done || !draftKey) return;
    const draft = {
      step,
      firstName, middleName, lastName, gender, dob, mobile, altMobile,
      workCountry, nationality,
      curAddr1, curAddr2, curCity, curState, curCountry, curPin,
      sameAsCurrent,
      permAddr1, permAddr2, permCity, permState, permCountry, permPin,
      departmentId, designationId, primaryRoleId, legalEntityId, location, joiningDate,
      _ts: Date.now(),
    };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* quota — skip */ }
  }, [
    loading, done, draftKey, step,
    firstName, middleName, lastName, gender, dob, mobile, altMobile,
    workCountry, nationality,
    curAddr1, curAddr2, curCity, curState, curCountry, curPin,
    sameAsCurrent,
    permAddr1, permAddr2, permCity, permState, permCountry, permPin,
    departmentId, designationId, primaryRoleId, legalEntityId, location, joiningDate,
  ]);

  // Country-filtered states for the two address rows.
  const statesFor = (countryId: string) => countryId
    ? states.filter(s => String(s.country_id) === String(countryId))
    : [];
  const curStates  = useMemo(() => statesFor(curCountry),  [curCountry, states]);
  const permStates = useMemo(() => statesFor(permCountry), [permCountry, states]);

  const countryOpts     = countries.map(c => ({ value: String(c.id), label: c.name }));
  const departmentOpts  = departments.map(d => ({ value: String(d.id), label: d.name }));
  const designationOpts = designations.map(d => ({ value: String(d.id), label: d.name }));
  const roleOpts        = roles.map(r => ({ value: String(r.id), label: r.name }));
  const legalEntityOpts = legalEntities.map(l => ({ value: String(l.id), label: l.entity_name }));
  // Backend enum is (Male, Female, Other) — keep options aligned so the
  // submit doesn't fail validation. "Prefer not to say" was rejected server-
  // side and surfaced as a generic "invalid" error.
  const genderOpts = [
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Other', label: 'Other' },
  ];

  // Names accept letters, spaces, apostrophes, hyphens, periods only — no
  // digits. Anchored so the WHOLE value is checked (a single digit anywhere
  // fails). Used for first/middle/last in validateStep1.
  const nameRe = /^[A-Za-z][A-Za-z\s'\-.]*$/;
  // E.164-style mobile: 7-15 digits. Optional leading + or 0 stripped before
  // checking so users can type +91 9876543210 / 09876543210 / 9876543210.
  const isValidMobile = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    return /^\d{7,15}$/.test(digits);
  };
  // Pincode: 4-10 digits (covers India 6, US 5/9, UK alphanumeric is rare
  // here and the field is a "pincode" in IN context).
  const isValidPincode = (raw: string) => /^\d{4,10}$/.test(raw.trim());

  // Per-step validators
  const validateStep1 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!firstName.trim())             e.first_name  = 'First name is required';
    else if (!nameRe.test(firstName.trim())) e.first_name = 'First name cannot contain numbers';
    if (middleName.trim() && !nameRe.test(middleName.trim()))
      e.middle_name = 'Middle name cannot contain numbers';
    if (!lastName.trim())              e.last_name   = 'Last name is required';
    else if (!nameRe.test(lastName.trim())) e.last_name = 'Last name cannot contain numbers';
    if (!gender)            e.gender      = 'Gender is required';
    if (!dob) {
      e.date_of_birth = 'Date of birth is required';
    } else {
      // Onboardee must be at least 18 — same minimum age the internal Add
      // Employee form enforces. Compare in days to avoid timezone drift.
      const d = new Date(dob);
      if (Number.isNaN(d.getTime())) {
        e.date_of_birth = 'Enter a valid date of birth';
      } else {
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
        if (d > today)  e.date_of_birth = 'Date of birth cannot be in the future';
        else if (age < 18) e.date_of_birth = 'You must be at least 18 years old';
      }
    }
    if (!nationality)       e.nationality_country_id = 'Nationality is required';
    if (!workCountry)       e.work_country_id = 'Work country is required';
    if (!mobile.trim())            e.mobile = 'Mobile is required';
    else if (!isValidMobile(mobile)) e.mobile = 'Enter 7–15 digits';
    if (altMobile.trim() && !isValidMobile(altMobile))
      e.alt_mobile = 'Enter 7–15 digits';
    return e;
  };
  const validateStep2 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!curAddr1.trim())   e.address_line1 = 'Address Line 1 is required';
    if (!curCity.trim())    e.city          = 'City is required';
    if (!curCountry)        e.country_id    = 'Country is required';
    if (!curState)          e.state_id      = 'State is required';
    if (!curPin.trim())     e.pincode       = 'Pincode is required';
    else if (!isValidPincode(curPin)) e.pincode = 'Pincode must be 4–10 digits';
    // Permanent pincode is optional UNLESS the candidate explicitly typed
    // one. Only validate the format when present, since the field is
    // hidden (and treated as null) when "Same as current" is checked.
    if (!sameAsCurrent && permPin.trim() && !isValidPincode(permPin))
      e.perm_pincode = 'Pincode must be 4–10 digits';
    return e;
  };

  const intOrNull = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const goNext = () => {
    const e = step === 1 ? validateStep1() : step === 2 ? validateStep2() : {};
    if (Object.keys(e).length > 0) {
      setErrs(e);
      const n = Object.keys(e).length;
      toast.error('Please fix the highlighted fields', `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention before continuing.`);
      return;
    }
    setErrs({});
    setStep(s => (s < 3 ? ((s + 1) as StepNum) : s));
  };
  const goBack = () => setStep(s => (s > 1 ? ((s - 1) as StepNum) : s));

  const handleSubmit = async () => {
    if (submitting) return;
    // Final pass: re-run step 1 + 2 validators in case the candidate jumped
    // back and broke something.
    const e = { ...validateStep1(), ...validateStep2() };
    if (Object.keys(e).length > 0) {
      setErrs(e);
      // Jump to the earliest step with an error.
      const step1Keys = ['first_name','last_name','gender','date_of_birth','nationality_country_id','work_country_id','mobile'];
      const step2Keys = ['address_line1','city','country_id','state_id','pincode'];
      if (step1Keys.some(k => e[k])) setStep(1);
      else if (step2Keys.some(k => e[k])) setStep(2);
      const n = Object.keys(e).length;
      toast.error('Please fix the highlighted fields', `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention.`);
      return;
    }

    const payload = {
      first_name:  firstName.trim(),
      middle_name: middleName.trim() || null,
      last_name:   lastName.trim(),
      gender,
      date_of_birth: dob,
      nationality_country_id: intOrNull(nationality),
      work_country_id:        intOrNull(workCountry),
      mobile:    mobile.trim(),
      alt_mobile: altMobile.trim() || null,

      address_line1: curAddr1.trim(),
      address_line2: curAddr2.trim() || null,
      city:          curCity.trim(),
      state_id:      intOrNull(curState),
      country_id:    intOrNull(curCountry),
      pincode:       curPin.trim(),

      perm_address_line1: (sameAsCurrent ? curAddr1 : permAddr1).trim() || null,
      perm_address_line2: (sameAsCurrent ? curAddr2 : permAddr2).trim() || null,
      perm_city:          (sameAsCurrent ? curCity  : permCity).trim()  || null,
      perm_state_id:      intOrNull(sameAsCurrent ? curState   : permState),
      perm_country_id:    intOrNull(sameAsCurrent ? curCountry : permCountry),
      perm_pincode:       (sameAsCurrent ? curPin  : permPin).trim()    || null,

      department_id:   intOrNull(departmentId),
      designation_id:  intOrNull(designationId),
      primary_role_id: intOrNull(primaryRoleId),
      legal_entity_id: intOrNull(legalEntityId),
      location:        location || null,
      date_of_joining: joiningDate || null,
    };

    setSubmitting(true);
    try {
      const r = await api.post(`/onboarding/${encodeURIComponent(token!)}/complete`, payload);
      // Wipe the draft so a refresh on the success card doesn't restore
      // the form (the invite is one-shot, the URL is no longer usable).
      try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ }
      setDone({ emp_code: r?.data?.employee?.emp_code, display_name: r?.data?.employee?.display_name });
      toast.success('Onboarding complete', 'We emailed your login credentials. You can close this page.');
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors) {
        const flat: Record<string, string> = {};
        for (const k of Object.keys(apiErrors)) {
          flat[k] = Array.isArray(apiErrors[k]) ? apiErrors[k][0] : String(apiErrors[k]);
        }
        setErrs(flat);
      }
      const msg = err?.response?.data?.message || err?.message || 'Submit failed';
      toast.error('Could not submit', String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f0ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#5a3fd1', fontSize: 14, fontWeight: 600 }}>Loading invitation…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, padding: 32, border: '1px solid #f3d7c5', background: '#fff5ec', borderRadius: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 12, marginBottom: 6, color: '#a04419' }}>Onboarding link unavailable</h2>
          <p style={{ fontSize: 14, color: '#7a3811', margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 480, padding: 36, border: '1px solid #c5e3d4', background: '#ecfaf3', borderRadius: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 14, marginBottom: 8, color: '#0a8a78' }}>Welcome aboard!</h2>
          <p style={{ fontSize: 14, color: '#0a6e5d', margin: '0 0 12px' }}>Your employee profile has been created.</p>
          <div style={{ display: 'inline-block', padding: '6px 14px', background: '#fff', borderRadius: 999, color: '#0a8a78', fontWeight: 700, fontSize: 13 }}>
            {done.emp_code} · {done.display_name}
          </div>
          <p style={{ fontSize: 12, color: '#0a6e5d', marginTop: 16 }}>Login credentials have been emailed to {invite?.invitee_email}.</p>
        </div>
      </div>
    );
  }

  // Allow clicking earlier (already-visited) steps to jump back. Forward
  // jumps still go through goNext() so validators run.
  const jumpToStep = (n: StepNum) => { if (n < step) setStep(n); };

  // Sidebar step config — title + description shown in the left rail.
  const SIDE_STEPS: { n: StepNum; icon: string; title: string; sub: string }[] = [
    { n: 1, icon: 'ri-user-3-line',     title: 'Your personal details', sub: 'Name, gender, contact info' },
    { n: 2, icon: 'ri-map-pin-line',    title: 'Address details',       sub: 'Current & permanent address' },
    { n: 3, icon: 'ri-briefcase-line',  title: 'Job details',           sub: 'Confirm role & joining date' },
  ];
  const stepCopy: Record<StepNum, { title: string; description: string }> = {
    1: { title: 'Basic Info',        description: `Tell us a bit about yourself to get started with your ${invite?.org_name ?? ''} account.`.trim() },
    2: { title: 'Address Details',   description: 'Where you currently live and your permanent address on record.' },
    3: { title: 'Job Details',       description: 'These were set by HR when you were invited — confirm them or make small updates.' },
  };
  const current = stepCopy[step];

  return (
    <>
      <MasterFormStyles />
      <style>{`
        .emp-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; width: 100%; }
        .emp-input::placeholder { color: #9ca3af; }
        .emp-input:focus { outline: none; border-color: #1d4fc4; box-shadow: 0 0 0 3px rgba(29,79,196,0.15); }
        .emp-input.is-readonly { background: #eef4ff; border-color: #c9d8f7; color: #1d4fc4; font-weight: 600; }
        .emp-input.is-invalid { border-color: #f06548; box-shadow: 0 0 0 3px rgba(240,101,72,0.12); }
        .emp-err { display: block; color: #c43d20; font-size: 11px; font-weight: 500; margin-top: 4px; }
        [data-bs-theme="dark"] .emp-input { background: #1c2531; border-color: var(--vz-border-color); color: var(--vz-body-color); }
        [data-bs-theme="dark"] .emp-input::placeholder { color: var(--vz-secondary-color); }
        .emp-label { font-size: 12px; font-weight: 600; color: var(--vz-heading-color, #374151); letter-spacing: 0; text-transform: none; margin-bottom: 5px; display: block; }
        [data-bs-theme="dark"] .emp-label { color: var(--vz-body-color); }
        .emp-label .req { color: #f06548; margin-left: 2px; }

        /* Prefix-icon wrapper for fields — mirrors masterFormKit's .master-field */
        .onb-field { position: relative; }
        .onb-field-icon {
          position: absolute; left: 12px; top: 50%;
          transform: translateY(-50%);
          font-size: 15px; color: #9ca3af;
          pointer-events: none; z-index: 3; line-height: 1;
          transition: color .18s ease, transform .18s ease;
        }
        .onb-field .emp-input { padding-left: 36px; }
        .onb-field .emp-input:focus ~ .onb-field-icon,
        .onb-field:focus-within > .onb-field-icon { color: #1d4fc4; transform: translateY(-50%) scale(1.08); }
        /* MasterSelect toggle inside an .onb-field — push the toggle's text past the icon */
        .onb-field .master-select-toggle { padding-left: 36px !important; }
        /* MasterDatePicker toggle inside an .onb-field */
        .onb-field .master-datepicker-toggle { padding-left: 36px !important; }

        /* ── Split-view layout (Convertico-style) ─────────────────────── */
        /* Outer page — soft blue-tinted backdrop matching the reference's
           ambient background, with two decorative quarter-circle arcs in
           the top-right and bottom-right corners. */
        .onb-page-bg {
          position: fixed; inset: 0;
          background:
            radial-gradient(900px 700px at 100% -20%,  rgba(59,130,246,0.10) 0%, transparent 60%),
            radial-gradient(700px 900px at 100% 120%, rgba(29,79,196,0.10)  0%, transparent 60%),
            linear-gradient(135deg, #eef3fb 0%, #e6ecf7 100%);
          z-index: 0;
          pointer-events: none;
        }
        [data-bs-theme="dark"] .onb-page-bg {
          background:
            radial-gradient(900px 700px at 100% -20%,  rgba(59,130,246,0.18) 0%, transparent 60%),
            radial-gradient(700px 900px at 100% 120%, rgba(29,79,196,0.18)  0%, transparent 60%),
            linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        }
        /* Decorative arc rings — mimics the quarter-circle motifs in the
           reference template's corners. Pure CSS borders so no SVG dep. */
        .onb-arc {
          position: fixed;
          border: 60px solid rgba(59,130,246,0.06);
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
        }
        .onb-arc-tr {
          width: 360px; height: 360px;
          top: -180px; right: -180px;
        }
        .onb-arc-br {
          width: 420px; height: 420px;
          bottom: -210px; right: -210px;
          border-color: rgba(29,79,196,0.07);
          border-width: 80px;
        }
        @media (max-width: 900px) { .onb-arc { display: none; } }

        .onb-layout {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          /* Contained card feel — page edges have padding so the white
             form pane reads as a card on top of the tinted backdrop. */
          margin: 0 auto;
          max-width: 1440px;
          padding: 28px;
          gap: 0;
          position: relative;
          z-index: 1;
          background: transparent;
        }
        @media (max-width: 900px) {
          .onb-layout { grid-template-columns: 1fr; padding: 0; }
        }
        /* Curved transition between the blue sidebar and the white form
           pane — matches the reference template's notched ribbon edge.
           A small white tab on the inside of the sidebar's right edge
           so the form card "tucks into" the sidebar. */
        .onb-layout::before {
          content: '';
          position: absolute;
          top: 28px; bottom: 28px;
          left: calc(28px + 300px - 1px);
          width: 28px;
          background: #ffffff;
          border-top-left-radius: 28px;
          border-bottom-left-radius: 28px;
          pointer-events: none;
          z-index: 2;
        }
        [data-bs-theme="dark"] .onb-layout::before { background: var(--vz-card-bg); }
        @media (max-width: 900px) { .onb-layout::before { display: none; } }

        /* SVG wave-edge overlay — extends the blue sidebar into the
           form area along an S-curve silhouette. The bulges at top and
           bottom (with a concave middle) match the reference template's
           distinctive wave shape. Sits behind the form content (z:2)
           but above the page background (z:0). */
        .onb-wave {
          position: absolute;
          top: 28px; bottom: 28px;
          left: calc(28px + 300px - 1px);
          width: 60px;
          z-index: 2;
          pointer-events: none;
          overflow: visible;
        }
        .onb-wave svg {
          width: 100%; height: 100%;
          display: block;
          filter: drop-shadow(6px 0 16px rgba(13,38,76,0.18));
        }
        @media (max-width: 900px) { .onb-wave { display: none; } }

        /* Vertical brand label on the sidebar's outer-right edge — the
           "DiveShop360" rotated text in the reference template. Uses
           the tenant org name so each customer's white-label name shows. */
        .onb-side-vlabel {
          position: absolute;
          top: 50%;
          right: -10px;
          transform: translateY(-50%) rotate(90deg);
          transform-origin: center;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.55);
          white-space: nowrap;
          z-index: 1;
        }
        @media (max-width: 900px) { .onb-side-vlabel { display: none; } }

        /* Left rail — deep blue gradient, sticky so only the right side scrolls */
        .onb-side {
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,0.16) 0%, transparent 38%),
            radial-gradient(circle at 0% 100%, rgba(96,165,250,0.32) 0%, transparent 48%),
            linear-gradient(165deg, #0b2545 0%, #133e8c 45%, #1e62d6 100%);
          color: #fff;
          padding: 32px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 40px;
          /* Rounded card-style sidebar matching the reference template
             where the blue panel sits inside the page with corner radii. */
          border-radius: 20px 0 0 20px;
          height: calc(100vh - 56px);
          position: sticky;
          top: 28px;
          align-self: start;
          overflow: hidden auto;
          box-shadow: 0 18px 40px -10px rgba(13,38,76,0.35);
        }
        @media (max-width: 900px) {
          .onb-side { border-radius: 0; height: auto; position: static; }
        }
        .onb-side::before, .onb-side::after {
          content: ''; position: absolute; pointer-events: none;
          border: 1.5px solid rgba(255,255,255,0.10);
        }
        .onb-side::before { width: 380px; height: 380px; border-radius: 50%; bottom: -160px; left: -120px; }
        .onb-side::after  { width: 240px; height: 240px; border-radius: 50%; top: -90px; right: -90px; }

        .onb-side-brand {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 8px; position: relative; z-index: 1;
        }
        .onb-side-brand-logo {
          display: inline-flex; align-items: center; justify-content: center;
          backdrop-filter: blur(22px) ;
          
          padding: 14px 18px;
          height: 90px; max-width: 100%;
          
        }
        .onb-side-brand-logo img {
          max-width: 100%; max-height: 100%;
          width: auto; height: auto;
          object-fit: contain;
        }
        .onb-side-brand-fallback {
          color: #fff;
          font-weight: 800; font-size: 64px; letter-spacing: -0.04em;
          line-height: 1;
          text-shadow: 0 6px 14px rgba(0,0,0,0.30);
          padding: 4px 0;
        }
        .onb-side-brand-name {
          font-size: 24px; font-weight: 800; letter-spacing: -0.01em;
          line-height: 1.2; word-break: break-word; color: #fff;
        }

        .onb-side-steps { display: flex; flex-direction: column; position: relative; z-index: 1; margin-top: 4px; gap: 6px; }
        .onb-step {
          position: relative;
          display: flex; align-items: flex-start; gap: 14px;
          background: transparent; border: 0; padding: 16px 0;
          color: inherit; text-align: left; width: 100%;
          cursor: pointer; transition: opacity .15s ease;
        }
        .onb-step:disabled { cursor: default; }
        .onb-step:not(:disabled):hover .onb-step-title { color: #fff; }
        .onb-step-circle {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.85);
          border: 1.5px solid rgba(255,255,255,0.30);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; font-size: 14px; z-index: 2;
          transition: all .2s ease;
        }
        /* Step NUMBER inside the circle — bold, slightly larger so it
           reads as a "1", "2", "3" badge (matches the reference). */
        .onb-step-num {
          font-size: 13.5px;
          font-weight: 800;
          letter-spacing: -0.01em;
          font-feature-settings: 'tnum';
        }
        /* Current step — solid white-on-blue gradient ring with a soft
           outer glow, matches the active node in the reference. */
        .onb-step.is-active .onb-step-circle {
          background: linear-gradient(135deg, #3b82f6 0%, #1d4fc4 100%);
          color: #fff;
          border-color: rgba(255,255,255,0.55);
          box-shadow: 0 0 0 4px rgba(255,255,255,0.18), 0 8px 20px rgba(29,79,196,0.45);
        }
        /* Done step — solid green badge with the check icon. */
        .onb-step.is-done .onb-step-circle {
          background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 6px 16px rgba(16,185,129,0.35);
        }
        .onb-step-text { display: flex; flex-direction: column; padding-top: 5px; }
        .onb-step-title { font-size: 14.5px; font-weight: 600; color: rgba(255,255,255,0.88); line-height: 1.25; }
        .onb-step.is-active .onb-step-title { color: #fff; font-weight: 700; }
        .onb-step-sub { font-size: 12px; color: rgba(255,255,255,0.62); margin-top: 3px; }
        .onb-step-line {
          position: absolute; left: 17.25px; top: 56px;
          width: 1.5px; height: 38px;
          background: rgba(255,255,255,0.22);
        }
        .onb-step.is-done .onb-step-line { background: rgba(10,179,156,0.55); }

        .onb-side-foot {
          margin-top: auto; position: relative; z-index: 1;
          display: flex; flex-direction: column; gap: 6px;
        }
        .onb-side-foot-copy { font-size: 11.5px; color: rgba(255,255,255,0.55); }
        .onb-side-foot-site {
          font-size: 12.5px; font-weight: 600; color: #fff;
          text-decoration: none;
          display: inline-flex; align-items: center; gap: 6px;
          word-break: break-all;
        }
        .onb-side-foot-site:hover { color: #fff; text-decoration: underline; }
        .onb-side-foot-site i { color: rgba(255,255,255,0.75); }

        /* Right pane */
        .onb-main {
          /* White card matching the reference template — rounded right
             corners, soft shadow, sits flush with the blue sidebar's
             rounded left edge to form one continuous interlocked card. */
          background: #ffffff;
          border-radius: 0 20px 20px 0;
          box-shadow: 0 18px 40px -10px rgba(13,38,76,0.18);
          min-width: 0;
          padding: 36px 44px 28px;
          display: flex; justify-content: center; align-items: flex-start;
        }
        [data-bs-theme="dark"] .onb-main { background: var(--vz-card-bg); }
        .onb-main-inner {
          width: 100%;
          max-width: 1000px;
          background: transparent;
        }
        @media (max-width: 900px) {
          .onb-main { padding: 24px 20px 22px; border-radius: 0; }
        }
        /* Form field rhythm — make every input/select/datepicker the same
           40px height and the same 10px corner radius so a Step 1 with 8
           fields reads as a unified grid instead of an uneven stack. The
           .emp-input global may not match on this page (it's used across
           several modules), so we scope to .onb-main and override. */
        .onb-main .emp-input,
        .onb-main .emp-input.form-control,
        .onb-main .form-select,
        .onb-main .master-select-toggle,
        .onb-main .master-datepicker-toggle {
          height: 40px;
          min-height: 40px;
          padding-top: 8px;
          padding-bottom: 8px;
          font-size: 13.5px;
          border-radius: 10px;
        }
        /* Bring the field icon up a notch so it centers in the taller input */
        .onb-main .onb-field-icon { top: 50%; }
        /* Label-to-input gap — tighter, consistent. */
        .onb-main .emp-label { margin-bottom: 6px; font-size: 12.5px; }
        /* Inline error text — slim red helper aligned to the field. */
        .onb-main .emp-err { display: block; margin-top: 4px; font-size: 11.5px; color: #b1401d; }

        /* Welcome banner at the very top of the right pane */
        /* Slim welcome strip — compact greeting above the form title,
           takes ~50px instead of 80px+ so the actual fields sit higher
           on the page. Matches the reference template's "no big banner"
           treatment while preserving the tenant context. */
        .onb-welcome {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px; border-radius: 10px;
          background: linear-gradient(120deg, rgba(29,79,196,0.06) 0%, rgba(96,165,250,0.07) 100%);
          border: 1px solid rgba(29,79,196,0.10);
          margin-bottom: 14px;
        }
        .onb-welcome-icon {
          width: 32px; height: 32px; border-radius: 8px;
          background: linear-gradient(135deg, #1d4fc4, #3b82f6);
          color: #fff; display: flex; align-items: center; justify-content: center;
          font-size: 15px; flex-shrink: 0;
          box-shadow: 0 4px 10px rgba(29,79,196,0.28);
        }
        .onb-welcome-title { font-size: 13px; font-weight: 700; letter-spacing: -0.005em; color: var(--vz-heading-color, #0b2545); line-height: 1.2; }
        .onb-welcome-sub { font-size: 11.5px; color: var(--vz-secondary-color, #6b7280); margin-top: 1px; }
        .onb-welcome-sub strong { color: var(--vz-heading-color, #374151); font-weight: 600; }

        .onb-step-pill {
          display: inline-block;
          font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em;
          color: #1d4fc4; background: rgba(29,79,196,0.10);
          padding: 4px 10px; border-radius: 999px; margin-bottom: 10px;
          text-transform: uppercase;
        }

        /* Horizontal step indicator — slim circle-line-circle progress
           strip sitting just below the welcome banner. Mirrors what the
           user sketched: each step is a small circle, completed steps
           filled, current step highlighted with a glowing ring, future
           steps dimmed. The connector line tints in proportion to
           progress so the strip works as both a step indicator AND a
           progress meter. */
        .onb-stepper {
          display: flex;
          align-items: center;
          gap: 0;
          margin: 0 0 22px;
          padding: 14px 18px;
          background: linear-gradient(120deg, rgba(29,79,196,0.04), rgba(96,165,250,0.05));
          border: 1px solid rgba(29,79,196,0.10);
          border-radius: 12px;
        }
        .onb-stepper-node {
          display: flex; flex-direction: column;
          align-items: center; gap: 6px;
          flex-shrink: 0;
          position: relative;
        }
        .onb-stepper-dot {
          width: 28px; height: 28px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 800;
          background: #ffffff;
          border: 2px solid var(--vz-border-color, #e5e7eb);
          color: var(--vz-secondary-color, #94a3b8);
          transition: all .25s ease;
        }
        .onb-stepper-node.is-done .onb-stepper-dot {
          background: linear-gradient(135deg, #10b981, #34d399);
          border-color: transparent;
          color: #fff;
        }
        .onb-stepper-node.is-current .onb-stepper-dot {
          background: linear-gradient(135deg, #1d4fc4, #3b82f6);
          border-color: transparent;
          color: #fff;
          box-shadow: 0 0 0 4px rgba(29,79,196,0.18), 0 4px 12px rgba(29,79,196,0.30);
        }
        .onb-stepper-label {
          font-size: 11px; font-weight: 600;
          color: var(--vz-secondary-color, #94a3b8);
          text-align: center;
          line-height: 1.2;
          max-width: 110px;
        }
        .onb-stepper-node.is-done .onb-stepper-label,
        .onb-stepper-node.is-current .onb-stepper-label {
          color: var(--vz-heading-color, #0f172a);
        }
        .onb-stepper-line {
          flex: 1; height: 2px;
          background: var(--vz-border-color, #e5e7eb);
          margin: 0 6px; margin-bottom: 22px;
          align-self: center;
          position: relative;
          overflow: hidden;
        }
        .onb-stepper-line::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, #10b981, #34d399);
          width: var(--fill, 0%);
          transition: width .35s ease;
        }

        /* Bottom progress bar — slim track + filled gradient with the
           "X of Y · NN% complete" label next to it. Sits inside the
           foot row, replaces the lonely Next button at the bottom. */
        .onb-progress {
          display: flex; align-items: center; gap: 12px;
          flex: 1; max-width: 380px;
        }
        .onb-progress-track {
          flex: 1; height: 6px;
          background: var(--vz-secondary-bg, #eef2f6);
          border-radius: 999px;
          overflow: hidden;
        }
        .onb-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #1d4fc4, #3b82f6 60%, #34d399);
          border-radius: 999px;
          transition: width .35s ease;
        }
        .onb-progress-label {
          font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em;
          color: var(--vz-secondary-color, #6b7280);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .onb-main-title {
          font-size: 26px; font-weight: 800; letter-spacing: -0.02em;
          color: var(--vz-heading-color, #0f172a); margin: 0 0 6px;
          line-height: 1.15;
        }
        .onb-main-sub {
          font-size: 13.5px; color: var(--vz-secondary-color, #6b7280);
          margin: 0 0 14px; line-height: 1.55; max-width: 680px;
        }
        .onb-main-divider { height: 1px; background: var(--vz-border-color, #e5e7eb); margin-bottom: 18px; }

        /* Title row — title block on the left, "Approx Time" badge on
           the right (matches the reference template's top-right corner
           approx-time chip). Stacks on mobile so the title doesn't
           wrap awkwardly. */
        .onb-title-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .onb-title-block { flex: 1; min-width: 0; }
        .onb-approx-time {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(29,79,196,0.06);
          border: 1px solid rgba(29,79,196,0.18);
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--vz-secondary-color, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .onb-approx-time i { color: #1d4fc4; font-size: 14px; }
        .onb-approx-time strong { color: var(--vz-heading-color, #0f172a); font-weight: 700; }

        /* Foot buttons — match the reference template's uppercase
           Previous (outlined) and Next (solid blue) treatment. */
        .onb-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 22px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border-radius: 10px;
          cursor: pointer;
          transition: all .18s ease;
          border: none;
        }
        .onb-btn-ghost {
          background: #ffffff;
          color: #475569;
          border: 1.5px solid #cbd5e1;
        }
        .onb-btn-ghost:hover:not(:disabled) {
          border-color: #1d4fc4;
          color: #1d4fc4;
          background: rgba(29,79,196,0.04);
        }
        .onb-btn-primary {
          background: linear-gradient(135deg, #1d4fc4 0%, #3b82f6 100%);
          color: #ffffff;
          box-shadow: 0 6px 16px rgba(29,79,196,0.32);
        }
        .onb-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(29,79,196,0.42);
          filter: brightness(1.05);
        }
        .onb-btn-success {
          background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
          color: #ffffff;
          box-shadow: 0 6px 16px rgba(16,185,129,0.32);
        }
        .onb-btn-success:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(16,185,129,0.42);
          filter: brightness(1.05);
        }
        .emp-spin {
          display: inline-block;
          animation: emp-spin-rotate 0.7s linear infinite;
        }
        @keyframes emp-spin-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .onb-subhead {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 700; color: var(--vz-heading-color, #111827);
          margin: 4px 0 12px;
        }
        .onb-subhead i { color: #1d4fc4; font-size: 16px; }
        .onb-subhead-row { display: flex; justify-content: space-between; align-items: center; margin: 4px 0 12px; }
        .onb-subhead-row .onb-subhead { margin: 0; }

        .onb-main-foot {
          display: flex; align-items: center; justify-content: space-between;
          padding-top: 18px; margin-top: 22px;
          border-top: 1px solid var(--vz-border-color, #e5e7eb);
        }

        /* Compact density for Step 3 — shrinks field height, label gap and
           row spacing so the 6 Job-details fields plus chrome (welcome
           banner, title, footer) fit in one viewport without scroll. */
        .onb-main .onb-compact .emp-input,
        .onb-main .onb-compact .emp-input.form-control,
        .onb-main .onb-compact .form-select,
        .onb-main .onb-compact .master-select-toggle,
        .onb-main .onb-compact .master-datepicker-toggle {
          height: 34px;
          min-height: 34px;
          padding-top: 6px;
          padding-bottom: 6px;
          font-size: 12.5px;
          border-radius: 8px;
        }
        .onb-main .onb-compact .emp-label {
          margin-bottom: 3px;
          font-size: 11.5px;
        }
        .onb-main .onb-compact .row { --bs-gutter-y: 8px; }
        .onb-main .onb-compact .onb-field .emp-input { padding-left: 32px; }
        .onb-main .onb-compact .onb-field-icon { font-size: 13px; }
        /* On step 3 also shrink the chrome above the form so the whole
           pane fits in one viewport. */
        .onb-main-inner.is-compact .onb-welcome { margin-bottom: 10px; padding: 6px 12px; }
        .onb-main-inner.is-compact .onb-welcome-icon { width: 28px; height: 28px; font-size: 13px; }
        .onb-main-inner.is-compact .onb-welcome-title { font-size: 12.5px; }
        .onb-main-inner.is-compact .onb-welcome-sub { font-size: 11px; }
        .onb-main-inner.is-compact .onb-main-title { font-size: 22px; margin-bottom: 4px; }
        .onb-main-inner.is-compact .onb-main-sub { font-size: 12.5px; margin-bottom: 10px; }
        .onb-main-inner.is-compact .onb-main-divider { margin-bottom: 12px; }
        .onb-main-inner.is-compact .onb-main-foot { padding-top: 12px; margin-top: 14px; }

        @media (max-width: 900px) {
          .onb-side { padding: 20px 20px 16px; gap: 18px; }
          .onb-side-brand-logo, .onb-side-brand-fallback { width: 94px; height: 64px; }
          .onb-main { padding: 24px 20px 22px; }
          .onb-main-title { font-size: 22px; }
          .onb-welcome { padding: 12px 14px; }
          .onb-welcome-icon { width: 38px; height: 38px; font-size: 18px; }
        }
      `}</style>

      {/* Tinted backdrop + decorative quarter-circle arcs that mimic
          the reference template's outer corner motifs. Sit on top of
          the page bg with z-index: 0 so all content layers above. */}
      <div className="onb-page-bg" aria-hidden />
      <div className="onb-arc onb-arc-tr" aria-hidden />
      <div className="onb-arc onb-arc-br" aria-hidden />

      <div className="onb-layout">
        {/* SVG wave silhouette extending the sidebar's blue color into
            the form area along an S-curve. The two bulges + middle
            concave dent recreate the reference template's distinctive
            wave-edge motif. SVG path is normalized to 100x800 viewBox
            and stretches with preserveAspectRatio="none". */}
        <div className="onb-wave" aria-hidden>
          <svg viewBox="0 0 100 800" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="onb-wave-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0b2545" />
                <stop offset="45%" stopColor="#133e8c" />
                <stop offset="100%" stopColor="#1e62d6" />
              </linearGradient>
            </defs>
            <path
              d="
                M 0 0
                L 0 800
                L 0 800
                Q 0 800 0 780
                C 30 720, 70 700, 60 620
                C 50 540, 0 520, 0 460
                C 0 400, 60 380, 60 300
                C 60 220, 0 200, 0 140
                Q 0 80 30 40
                L 0 0
                Z
              "
              fill="url(#onb-wave-grad)"
            />
          </svg>
        </div>

        {/* ── Left rail — brand + step breadcrumbs ─────────────────────── */}
        <aside className="onb-side">
          <span className="onb-side-vlabel">{invite?.org_name || 'CrossBorder'}</span>
          <div className="onb-side-brand">
            {invite?.logo_url ? (
              <span className="onb-side-brand-logo"><img src={invite.logo_url} alt={invite.org_name} /></span>
            ) : (
              <span className="onb-side-brand-fallback">
                {(invite?.org_name || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'CB'}
              </span>
            )}
            {/* <span className="onb-side-brand-name">{invite?.org_name}</span> */}
          </div>

          <nav className="onb-side-steps" aria-label="Onboarding steps">
            {SIDE_STEPS.map((s, idx) => {
              const active  = step === s.n;
              const done2   = step > s.n;
              const canJump = s.n < step;
              return (
                <button
                  key={s.n}
                  type="button"
                  className={`onb-step${active ? ' is-active' : ''}${done2 ? ' is-done' : ''}`}
                  onClick={() => jumpToStep(s.n)}
                  disabled={!canJump && !active}
                  aria-current={active ? 'step' : undefined}
                >
                  <span className="onb-step-circle">
                    {done2
                      ? <i className="ri-check-line" />
                      : <span className="onb-step-num">{s.n}</span>}
                  </span>
                  <span className="onb-step-text">
                    <span className="onb-step-title">{s.title}</span>
                    <span className="onb-step-sub">{s.sub}</span>
                  </span>
                  {idx < SIDE_STEPS.length - 1 && <span className="onb-step-line" />}
                </button>
              );
            })}
          </nav>

          <div className="onb-side-foot">
            <div className="onb-side-foot-copy">All rights reserved © {invite?.org_name}</div>
            {invite?.website && (() => {
              const raw = invite.website.trim();
              const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
              const display = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
              return (
                <a className="onb-side-foot-site" href={href} target="_blank" rel="noopener noreferrer">
                  <i className="ri-global-line" /> {display}
                </a>
              );
            })()}
          </div>
        </aside>

        {/* ── Right pane — current step's form ─────────────────────────── */}
        <main className="onb-main">
          <div className={`onb-main-inner${step === 3 ? ' is-compact' : ''}`}>

            {/* Welcome banner — sits above the per-step heading */}
            <div className="onb-welcome">
              <span className="onb-welcome-icon"><i className="ri-hand-heart-line" /></span>
              <div className="min-w-0 flex-grow-1">
                <div className="onb-welcome-title">Welcome to {invite?.org_name} · Onboarding Form</div>
                <div className="onb-welcome-sub">
                  Hi <strong>{invite?.invitee_name}</strong> · {invite?.invitee_email}
                </div>
              </div>
            </div>

            {/* Horizontal stepper removed — the left sidebar already
                shows the step list (Personal / Address / Job) with the
                done-check and current-highlight states, so duplicating
                it at the top of the form was visual noise that pushed
                the actual fields below the fold. */}

            <div className="onb-title-row">
              <div className="onb-title-block">
                <h1 className="onb-main-title">{current.title}</h1>
                <p className="onb-main-sub">{current.description}</p>
              </div>
              <div className="onb-approx-time" aria-label="Approximate time to complete this step">
                <i className="ri-time-line" />
                <span>Approx Time:</span>
                <strong>2 Mins</strong>
              </div>
            </div>
            <div className="onb-main-divider" />

          {step === 1 && (
            <div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="emp-label">First Name<span className="req">*</span></label>
                  <IconField icon="ri-user-line">
                    <input className={`emp-input${errs.first_name ? ' is-invalid' : ''}`} placeholder="e.g. Aarav" value={firstName} onChange={e => { setFirstName(e.target.value); clearErr('first_name'); }} />
                  </IconField>
                  {errs.first_name && <small className="emp-err">{errs.first_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Middle Name</label>
                  <IconField icon="ri-user-line">
                    <input className={`emp-input${errs.middle_name ? ' is-invalid' : ''}`} placeholder="Middle name (optional)" value={middleName} onChange={e => { setMiddleName(e.target.value); clearErr('middle_name'); }} />
                  </IconField>
                  {errs.middle_name && <small className="emp-err">{errs.middle_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Last Name<span className="req">*</span></label>
                  <IconField icon="ri-user-line">
                    <input className={`emp-input${errs.last_name ? ' is-invalid' : ''}`} placeholder="e.g. Kale" value={lastName} onChange={e => { setLastName(e.target.value); clearErr('last_name'); }} />
                  </IconField>
                  {errs.last_name && <small className="emp-err">{errs.last_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Gender<span className="req">*</span></label>
                  <IconField icon="ri-user-2-line">
                    <MasterSelect value={gender} onChange={v => { setGender(v); clearErr('gender'); }} options={genderOpts} placeholder="Select gender" invalid={!!errs.gender} />
                  </IconField>
                  {errs.gender && <small className="emp-err">{errs.gender}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Date of Birth<span className="req">*</span></label>
                  <MasterDatePicker value={dob} onChange={v => { setDob(v); clearErr('date_of_birth'); }} placeholder="dd-mm-yyyy" invalid={!!errs.date_of_birth} maxDate={dobMaxDate} />
                  {errs.date_of_birth && <small className="emp-err">{errs.date_of_birth}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Nationality<span className="req">*</span></label>
                  <IconField icon="ri-flag-line">
                    <MasterSelect value={nationality} onChange={v => { setNationality(v); clearErr('nationality_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.nationality_country_id} />
                  </IconField>
                  {errs.nationality_country_id && <small className="emp-err">{errs.nationality_country_id}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Work Country<span className="req">*</span></label>
                  <IconField icon="ri-earth-line">
                    <MasterSelect value={workCountry} onChange={v => { setWorkCountry(v); clearErr('work_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.work_country_id} />
                  </IconField>
                  {errs.work_country_id && <small className="emp-err">{errs.work_country_id}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Mobile Number<span className="req">*</span></label>
                  <IconField icon="ri-phone-line">
                    <input className={`emp-input${errs.mobile ? ' is-invalid' : ''}`} value={mobile} onChange={e => { setMobile(e.target.value); clearErr('mobile'); }} placeholder="10-digit mobile" />
                  </IconField>
                  {errs.mobile && <small className="emp-err">{errs.mobile}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Alternate Mobile</label>
                  <IconField icon="ri-phone-line">
                    <input className={`emp-input${errs.alt_mobile ? ' is-invalid' : ''}`} value={altMobile} onChange={e => { setAltMobile(e.target.value); clearErr('alt_mobile'); }} placeholder="(optional)" />
                  </IconField>
                  {errs.alt_mobile && <small className="emp-err">{errs.alt_mobile}</small>}
                </Col>
              </Row>
            </div>
          )}

          {step === 2 && (
            <>
              <div>
                <div className="onb-subhead"><i className="ri-map-pin-line" /> Current Address</div>
                <Row className="g-2">
                  <Col md={8}>
                    <label className="emp-label">Address Line 1<span className="req">*</span></label>
                    <IconField icon="ri-road-map-line">
                      <input className={`emp-input${errs.address_line1 ? ' is-invalid' : ''}`} value={curAddr1} onChange={e => { setCurAddr1(e.target.value); clearErr('address_line1'); }} />
                    </IconField>
                    {errs.address_line1 && <small className="emp-err">{errs.address_line1}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Address Line 2</label>
                    <IconField icon="ri-road-map-line">
                      <input className="emp-input" value={curAddr2} onChange={e => setCurAddr2(e.target.value)} placeholder="(optional)" />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">City<span className="req">*</span></label>
                    <IconField icon="ri-building-2-line">
                      <input className={`emp-input${errs.city ? ' is-invalid' : ''}`} value={curCity} onChange={e => { setCurCity(e.target.value); clearErr('city'); }} />
                    </IconField>
                    {errs.city && <small className="emp-err">{errs.city}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Country<span className="req">*</span></label>
                    <IconField icon="ri-earth-line">
                      <MasterSelect value={curCountry} onChange={v => { setCurCountry(v); if (curState) setCurState(''); clearErr('country_id'); clearErr('state_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.country_id} />
                    </IconField>
                    {errs.country_id && <small className="emp-err">{errs.country_id}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">State<span className="req">*</span></label>
                    <IconField icon="ri-map-pin-line">
                      <MasterSelect value={curState} onChange={v => { setCurState(v); clearErr('state_id'); }} options={curStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={curCountry ? 'Select state' : 'Pick country first'} disabled={!curCountry} invalid={!!errs.state_id} />
                    </IconField>
                    {errs.state_id && <small className="emp-err">{errs.state_id}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Pincode<span className="req">*</span></label>
                    <IconField icon="ri-mail-send-line">
                      <input className={`emp-input${errs.pincode ? ' is-invalid' : ''}`} value={curPin} onChange={e => { setCurPin(e.target.value); clearErr('pincode'); }} />
                    </IconField>
                    {errs.pincode && <small className="emp-err">{errs.pincode}</small>}
                  </Col>
                </Row>
              </div>

              <div style={{ marginTop: 24 }}>
                <div className="onb-subhead-row">
                  <div className="onb-subhead"><i className="ri-home-4-line" /> Permanent Address</div>
                  <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={sameAsCurrent} onChange={e => {
                      const c = e.target.checked;
                      setSameAsCurrent(c);
                      if (c) { setPermAddr1(curAddr1); setPermAddr2(curAddr2); setPermCity(curCity); setPermCountry(curCountry); setPermState(curState); setPermPin(curPin); }
                    }} /> Same as Current Address
                  </label>
                </div>
                <Row className="g-2">
                  <Col md={8}>
                    <label className="emp-label">Address Line 1</label>
                    <IconField icon="ri-road-map-line">
                      <input className="emp-input" value={permAddr1} onChange={e => setPermAddr1(e.target.value)} disabled={sameAsCurrent} />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Address Line 2</label>
                    <IconField icon="ri-road-map-line">
                      <input className="emp-input" value={permAddr2} onChange={e => setPermAddr2(e.target.value)} disabled={sameAsCurrent} />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">City</label>
                    <IconField icon="ri-building-2-line">
                      <input className="emp-input" value={permCity} onChange={e => setPermCity(e.target.value)} disabled={sameAsCurrent} />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Country</label>
                    <IconField icon="ri-earth-line">
                      <MasterSelect value={permCountry} onChange={v => { setPermCountry(v); if (permState) setPermState(''); }} options={countryOpts} placeholder="Select country" disabled={sameAsCurrent} />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">State</label>
                    <IconField icon="ri-map-pin-line">
                      <MasterSelect value={permState} onChange={setPermState} options={permStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={permCountry ? 'Select state' : 'Pick country first'} disabled={sameAsCurrent || !permCountry} />
                    </IconField>
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Pincode</label>
                    <IconField icon="ri-mail-send-line">
                      <input className={`emp-input${errs.perm_pincode ? ' is-invalid' : ''}`} value={permPin} onChange={e => { setPermPin(e.target.value); clearErr('perm_pincode'); }} disabled={sameAsCurrent} />
                    </IconField>
                    {errs.perm_pincode && <small className="emp-err">{errs.perm_pincode}</small>}
                  </Col>
                </Row>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="onb-compact">
              <Row className="g-2">
                <Col md={4}>
                  <label className="emp-label">Department</label>
                  <IconField icon="ri-organization-chart">
                    <MasterSelect value={departmentId} onChange={setDepartmentId} options={departmentOpts} placeholder="Select department" />
                  </IconField>
                </Col>
                <Col md={4}>
                  <label className="emp-label">Designation</label>
                  <IconField icon="ri-medal-line">
                    <MasterSelect value={designationId} onChange={setDesignationId} options={designationOpts} placeholder="Select designation" />
                  </IconField>
                </Col>
                <Col md={4}>
                  <label className="emp-label">Primary Role</label>
                  <IconField icon="ri-shield-user-line">
                    <MasterSelect value={primaryRoleId} onChange={setPrimaryRoleId} options={roleOpts} placeholder="Select role" />
                  </IconField>
                </Col>
                <Col md={4}>
                  <label className="emp-label">Legal Entity</label>
                  <IconField icon="ri-building-line">
                    <MasterSelect value={legalEntityId} onChange={v => {
                      setLegalEntityId(v);
                      const ent = legalEntities.find(le => String(le.id) === String(v));
                      setLocation(ent?.city || '');
                    }} options={legalEntityOpts} placeholder="Select entity" />
                  </IconField>
                </Col>
                <Col md={4}>
                  <label className="emp-label">Location</label>
                  <IconField icon="ri-map-pin-2-line">
                    <input
                      className={`emp-input${legalEntityId ? ' is-readonly' : ''}`}
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      placeholder={legalEntityId ? 'Set by legal entity' : 'Select a legal entity'}
                      disabled={!!legalEntityId}
                      readOnly={!!legalEntityId}
                    />
                  </IconField>
                </Col>
                <Col md={4}>
                  <label className="emp-label">Joining Date</label>
                  <MasterDatePicker value={joiningDate} onChange={setJoiningDate} placeholder="dd-mm-yyyy" />
                </Col>
              </Row>
            </div>
          )}

            {/* Footer — Back / Next / Submit */}
            <div className="onb-main-foot">
              {step > 1 ? (
                <button
                  type="button" onClick={goBack}
                  className="onb-btn onb-btn-ghost"
                >
                  <i className="ri-arrow-left-line" /> PREVIOUS
                </button>
              ) : <span />}

              {/* Inline progress bar — shows the user how much of the
                  3-step flow is done. Sits between Back and Next so it
                  centers naturally inside the foot row. */}
              <div className="onb-progress">
                <div className="onb-progress-track">
                  <div
                    className="onb-progress-fill"
                    style={{ width: `${Math.round(((step - 1) / 3) * 100)}%` }}
                  />
                </div>
                <div className="onb-progress-label">
                  {100 - Math.round(((step - 1) / 3) * 100)}% Left
                </div>
              </div>
              {step < 3 ? (
                <button
                  type="button" onClick={goNext}
                  className="onb-btn onb-btn-primary"
                >
                  NEXT <i className="ri-arrow-right-line" />
                </button>
              ) : (
                <button
                  type="button" disabled={submitting} onClick={handleSubmit}
                  className="onb-btn onb-btn-success"
                  style={{ opacity: submitting ? 0.6 : 1 }}
                >
                  <i className={submitting ? 'ri-loader-4-line emp-spin' : 'ri-check-line'} />
                  {submitting ? 'SUBMITTING…' : 'SUBMIT'}
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
