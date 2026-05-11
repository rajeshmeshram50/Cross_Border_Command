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

        /* ── Split-view layout (Convertico-style) ─────────────────────── */
        .onb-layout {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          background: var(--vz-secondary-bg, #f5f7fb);
        }
        @media (max-width: 900px) { .onb-layout { grid-template-columns: 1fr; } }

        /* Left rail — deep blue gradient, sticky so only the right side scrolls */
        .onb-side {
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,0.16) 0%, transparent 38%),
            radial-gradient(circle at 0% 100%, rgba(96,165,250,0.32) 0%, transparent 48%),
            linear-gradient(165deg, #0b2545 0%, #133e8c 45%, #1e62d6 100%);
          color: #fff;
          padding: 32px 14px 24px;
          display: flex;
          flex-direction: column;
          gap: 40px;
          position: sticky;
          top: 0;
          align-self: start;
          height: 100vh;
          overflow: hidden auto;
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
          background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.80);
          border: 1.5px solid rgba(255,255,255,0.26);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; font-size: 16px; z-index: 2;
          transition: all .2s ease;
        }
        .onb-step.is-active .onb-step-circle {
          background: #fff; color: #0b2545; border-color: #fff;
          box-shadow: 0 10px 22px rgba(0,0,0,0.25);
        }
        .onb-step.is-done .onb-step-circle {
          background: #0ab39c; color: #fff; border-color: #0ab39c;
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
          padding: 36px 44px 32px;
          display: flex; justify-content: center; align-items: flex-start;
          background: #fff;
          min-width: 0;
        }
        [data-bs-theme="dark"] .onb-main { background: var(--vz-card-bg); }
        .onb-main-inner { width: 100%; max-width: 980px; }

        /* Welcome banner at the very top of the right pane */
        .onb-welcome {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 18px; border-radius: 14px;
          background: linear-gradient(120deg, rgba(29,79,196,0.08) 0%, rgba(96,165,250,0.10) 60%, rgba(13,148,136,0.06) 100%);
          border: 1px solid rgba(29,79,196,0.14);
          margin-bottom: 22px;
        }
        .onb-welcome-icon {
          width: 44px; height: 44px; border-radius: 12px;
          background: linear-gradient(135deg, #1d4fc4, #3b82f6);
          color: #fff; display: flex; align-items: center; justify-content: center;
          font-size: 22px; flex-shrink: 0;
          box-shadow: 0 8px 18px rgba(29,79,196,0.32);
        }
        .onb-welcome-title { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; color: var(--vz-heading-color, #0b2545); line-height: 1.2; }
        .onb-welcome-sub { font-size: 12.5px; color: var(--vz-secondary-color, #6b7280); margin-top: 2px; }
        .onb-welcome-sub strong { color: var(--vz-heading-color, #374151); font-weight: 600; }

        .onb-step-pill {
          display: inline-block;
          font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em;
          color: #1d4fc4; background: rgba(29,79,196,0.10);
          padding: 4px 10px; border-radius: 999px; margin-bottom: 10px;
          text-transform: uppercase;
        }
        .onb-main-title {
          font-size: 28px; font-weight: 800; letter-spacing: -0.02em;
          color: var(--vz-heading-color, #0f172a); margin: 0 0 8px;
          line-height: 1.15;
        }
        .onb-main-sub {
          font-size: 14px; color: var(--vz-secondary-color, #6b7280);
          margin: 0 0 18px; line-height: 1.6; max-width: 680px;
        }
        .onb-main-divider { height: 1px; background: var(--vz-border-color, #e5e7eb); margin-bottom: 18px; }

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
          padding-top: 22px; margin-top: 20px;
          border-top: 1px solid var(--vz-border-color, #e5e7eb);
        }

        @media (max-width: 900px) {
          .onb-side { padding: 20px 20px 16px; gap: 18px; }
          .onb-side-brand-logo, .onb-side-brand-fallback { width: 94px; height: 64px; }
          .onb-main { padding: 24px 20px 22px; }
          .onb-main-title { font-size: 22px; }
          .onb-welcome { padding: 12px 14px; }
          .onb-welcome-icon { width: 38px; height: 38px; font-size: 18px; }
        }
      `}</style>

      <div className="onb-layout">
        {/* ── Left rail — brand + step breadcrumbs ─────────────────────── */}
        <aside className="onb-side">
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
                    {done2 ? <i className="ri-check-line" /> : <i className={s.icon} />}
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
          <div className="onb-main-inner">

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

            <div className="onb-step-pill">Step {step} of 3</div>
            <h1 className="onb-main-title">{current.title}</h1>
            <p className="onb-main-sub">{current.description}</p>
            <div className="onb-main-divider" />

          {step === 1 && (
            <div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="emp-label">First Name<span className="req">*</span></label>
                  <input className={`emp-input${errs.first_name ? ' is-invalid' : ''}`} placeholder="e.g. Aarav" value={firstName} onChange={e => { setFirstName(e.target.value); clearErr('first_name'); }} />
                  {errs.first_name && <small className="emp-err">{errs.first_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Middle Name</label>
                  <input className={`emp-input${errs.middle_name ? ' is-invalid' : ''}`} placeholder="Middle name (optional)" value={middleName} onChange={e => { setMiddleName(e.target.value); clearErr('middle_name'); }} />
                  {errs.middle_name && <small className="emp-err">{errs.middle_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Last Name<span className="req">*</span></label>
                  <input className={`emp-input${errs.last_name ? ' is-invalid' : ''}`} placeholder="e.g. Kale" value={lastName} onChange={e => { setLastName(e.target.value); clearErr('last_name'); }} />
                  {errs.last_name && <small className="emp-err">{errs.last_name}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Gender<span className="req">*</span></label>
                  <MasterSelect value={gender} onChange={v => { setGender(v); clearErr('gender'); }} options={genderOpts} placeholder="Select gender" invalid={!!errs.gender} />
                  {errs.gender && <small className="emp-err">{errs.gender}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Date of Birth<span className="req">*</span></label>
                  <MasterDatePicker value={dob} onChange={v => { setDob(v); clearErr('date_of_birth'); }} placeholder="dd-mm-yyyy" invalid={!!errs.date_of_birth} maxDate={dobMaxDate} />
                  {errs.date_of_birth && <small className="emp-err">{errs.date_of_birth}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Nationality<span className="req">*</span></label>
                  <MasterSelect value={nationality} onChange={v => { setNationality(v); clearErr('nationality_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.nationality_country_id} />
                  {errs.nationality_country_id && <small className="emp-err">{errs.nationality_country_id}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Work Country<span className="req">*</span></label>
                  <MasterSelect value={workCountry} onChange={v => { setWorkCountry(v); clearErr('work_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.work_country_id} />
                  {errs.work_country_id && <small className="emp-err">{errs.work_country_id}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Mobile Number<span className="req">*</span></label>
                  <input className={`emp-input${errs.mobile ? ' is-invalid' : ''}`} value={mobile} onChange={e => { setMobile(e.target.value); clearErr('mobile'); }} placeholder="10-digit mobile" />
                  {errs.mobile && <small className="emp-err">{errs.mobile}</small>}
                </Col>
                <Col md={4}>
                  <label className="emp-label">Alternate Mobile</label>
                  <input className={`emp-input${errs.alt_mobile ? ' is-invalid' : ''}`} value={altMobile} onChange={e => { setAltMobile(e.target.value); clearErr('alt_mobile'); }} placeholder="(optional)" />
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
                    <input className={`emp-input${errs.address_line1 ? ' is-invalid' : ''}`} value={curAddr1} onChange={e => { setCurAddr1(e.target.value); clearErr('address_line1'); }} />
                    {errs.address_line1 && <small className="emp-err">{errs.address_line1}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Address Line 2</label>
                    <input className="emp-input" value={curAddr2} onChange={e => setCurAddr2(e.target.value)} placeholder="(optional)" />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">City<span className="req">*</span></label>
                    <input className={`emp-input${errs.city ? ' is-invalid' : ''}`} value={curCity} onChange={e => { setCurCity(e.target.value); clearErr('city'); }} />
                    {errs.city && <small className="emp-err">{errs.city}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Country<span className="req">*</span></label>
                    <MasterSelect value={curCountry} onChange={v => { setCurCountry(v); if (curState) setCurState(''); clearErr('country_id'); clearErr('state_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.country_id} />
                    {errs.country_id && <small className="emp-err">{errs.country_id}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">State<span className="req">*</span></label>
                    <MasterSelect value={curState} onChange={v => { setCurState(v); clearErr('state_id'); }} options={curStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={curCountry ? 'Select state' : 'Pick country first'} disabled={!curCountry} invalid={!!errs.state_id} />
                    {errs.state_id && <small className="emp-err">{errs.state_id}</small>}
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Pincode<span className="req">*</span></label>
                    <input className={`emp-input${errs.pincode ? ' is-invalid' : ''}`} value={curPin} onChange={e => { setCurPin(e.target.value); clearErr('pincode'); }} />
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
                    <input className="emp-input" value={permAddr1} onChange={e => setPermAddr1(e.target.value)} disabled={sameAsCurrent} />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Address Line 2</label>
                    <input className="emp-input" value={permAddr2} onChange={e => setPermAddr2(e.target.value)} disabled={sameAsCurrent} />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">City</label>
                    <input className="emp-input" value={permCity} onChange={e => setPermCity(e.target.value)} disabled={sameAsCurrent} />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Country</label>
                    <MasterSelect value={permCountry} onChange={v => { setPermCountry(v); if (permState) setPermState(''); }} options={countryOpts} placeholder="Select country" disabled={sameAsCurrent} />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">State</label>
                    <MasterSelect value={permState} onChange={setPermState} options={permStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={permCountry ? 'Select state' : 'Pick country first'} disabled={sameAsCurrent || !permCountry} />
                  </Col>
                  <Col md={4}>
                    <label className="emp-label">Pincode</label>
                    <input className={`emp-input${errs.perm_pincode ? ' is-invalid' : ''}`} value={permPin} onChange={e => { setPermPin(e.target.value); clearErr('perm_pincode'); }} disabled={sameAsCurrent} />
                    {errs.perm_pincode && <small className="emp-err">{errs.perm_pincode}</small>}
                  </Col>
                </Row>
              </div>
            </>
          )}

          {step === 3 && (
            <div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="emp-label">Department</label>
                  <MasterSelect value={departmentId} onChange={setDepartmentId} options={departmentOpts} placeholder="Select department" />
                </Col>
                <Col md={4}>
                  <label className="emp-label">Designation</label>
                  <MasterSelect value={designationId} onChange={setDesignationId} options={designationOpts} placeholder="Select designation" />
                </Col>
                <Col md={4}>
                  <label className="emp-label">Primary Role</label>
                  <MasterSelect value={primaryRoleId} onChange={setPrimaryRoleId} options={roleOpts} placeholder="Select role" />
                </Col>
                <Col md={4}>
                  <label className="emp-label">Legal Entity</label>
                  <MasterSelect value={legalEntityId} onChange={v => {
                    setLegalEntityId(v);
                    const ent = legalEntities.find(le => String(le.id) === String(v));
                    setLocation(ent?.city || '');
                  }} options={legalEntityOpts} placeholder="Select entity" />
                </Col>
                <Col md={4}>
                  <label className="emp-label">Location</label>
                  {/* Auto-filled from the selected legal entity's city. Locked
                      so candidates can't override it — pick a different
                      entity to change the location. */}
                  <input
                    className={`emp-input${legalEntityId ? ' is-readonly' : ''}`}
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder={legalEntityId ? 'Set by legal entity' : 'Select a legal entity'}
                    disabled={!!legalEntityId}
                    readOnly={!!legalEntityId}
                  />
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
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill"
                  style={{ fontSize: 13, padding: '8px 18px', background: '#fff', color: '#475569', border: '1px solid #e5e7eb' }}
                >
                  <i className="ri-arrow-left-s-line" /> Back
                </button>
              ) : <span />}
              {step < 3 ? (
                <button
                  type="button" onClick={goNext}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill"
                  style={{
                    fontSize: 13, color: '#fff', border: 'none',
                    background: 'linear-gradient(135deg,#1d4fc4,#3b82f6)',
                    boxShadow: '0 8px 18px rgba(29,79,196,0.32)', padding: '10px 26px',
                  }}
                >
                  Next <i className="ri-arrow-right-s-line" />
                </button>
              ) : (
                <button
                  type="button" disabled={submitting} onClick={handleSubmit}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill"
                  style={{
                    fontSize: 13, color: '#fff', border: 'none',
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    boxShadow: '0 8px 18px rgba(10,179,156,0.30)', padding: '10px 26px',
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  <i className={submitting ? 'ri-loader-4-line' : 'ri-check-line'} /> {submitting ? 'Submitting…' : 'Submit Onboarding'}
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
