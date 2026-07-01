import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  // Active sub-tab within each step — mirrors the reference design's
  // top tab strip (General | Address | Contact | ...). Each step has
  // its own tab set; see STEP_TABS below.
  const [tab, setTab] = useState<string>('general');

  // Reset scroll to the top whenever the user moves between steps so each
  // new step opens at its heading instead of inheriting the previous step's
  // scroll offset (otherwise Step 2's address fields land mid-page). Also
  // reset to the first sub-tab so the new step opens on its first section.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.documentElement?.scrollTo?.({ top: 0, behavior: 'auto' });
    document.body?.scrollTo?.({ top: 0, behavior: 'auto' });
    setTab('general');
  }, [step]);

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
        // Countries/states sorted A→Z so dropdowns read alphabetically.
        const byName = (a: MasterOption, b: MasterOption) => a.name.localeCompare(b.name);
        setCountries([...(data.masters?.countries ?? [])].sort(byName));
        setStates([...(data.masters?.states ?? [])].sort(byName));
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

  // While "Same as Current Address" stays checked, keep the permanent
  // address mirrored to the current address live — so edits to the
  // current address flow through instead of leaving a stale snapshot.
  useEffect(() => {
    if (!sameAsCurrent) return;
    setPermAddr1(curAddr1);
    setPermAddr2(curAddr2);
    setPermCity(curCity);
    setPermState(curState);
    setPermCountry(curCountry);
    setPermPin(curPin);
  }, [sameAsCurrent, curAddr1, curAddr2, curCity, curState, curCountry, curPin]);

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
  // Pincode: exactly 6 digits. Leading zero IS allowed — some regions/PINs
  // legitimately start with 0 (and non-IN postal codes do too), so we only
  // enforce the 6-digit length, not a non-zero first digit.
  const isValidPincode = (raw: string) => /^\d{6}$/.test(raw.trim());
  // A street address must look real: contain at least one letter AND at least
  // one digit or space (a building/house number or multiple words). This
  // rejects meaningless input — "@@@@@", "#####", "$$$$$", "-----", ".....",
  // "12345", "asdfgh", "@@@123" — while still accepting "12 MG Road",
  // "Flat 4B, Park Lane", "Plot No 7, Sector 21". Minimum 5 chars guards
  // against trivially short junk.
  const isValidAddress = (raw: string) => {
    const v = raw.trim();
    if (v.length < 5) return false;
    if (!/[A-Za-z]/.test(v)) return false; // needs a letter (street/building name)
    if (!/[\s\d]/.test(v)) return false;   // ...and a number or space (structure)
    return true;
  };
  const ADDRESS_MSG = 'Enter a valid address — include a house/building number and street name.';

  // Per-step validators
  const validateStep1 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!firstName.trim())             e.first_name  = 'First name is required';
    else if (firstName.trim().length < 3) e.first_name = 'First name must be at least 3 characters';
    else if (firstName.trim().length > 15) e.first_name = 'First name must be 15 characters or fewer';
    else if (!nameRe.test(firstName.trim())) e.first_name = 'First name can only contain letters (no numbers or special characters)';
    if (middleName.trim()) {
      if (middleName.trim().length > 15) e.middle_name = 'Middle name must be 15 characters or fewer';
      else if (!nameRe.test(middleName.trim())) e.middle_name = 'Middle name can only contain letters (no numbers or special characters)';
    }
    if (!lastName.trim())              e.last_name   = 'Last name is required';
    else if (lastName.trim().length > 15) e.last_name = 'Last name must be 15 characters or fewer';
    else if (!nameRe.test(lastName.trim())) e.last_name = 'Last name can only contain letters (no numbers or special characters)';
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
    else if (!isValidAddress(curAddr1)) e.address_line1 = ADDRESS_MSG;
    // Address Line 2 is optional, but if filled it must still be a real value.
    if (curAddr2.trim() && !isValidAddress(curAddr2)) e.address_line2 = ADDRESS_MSG;
    // City must be a real place name — letters, spaces and basic name
    // punctuation (- . ') only. Reuses the same pattern as the name fields so
    // "Pune123", "12345", "Pune@" and "-----" are all rejected.
    if (!curCity.trim())    e.city          = 'City is required';
    else if (!nameRe.test(curCity.trim())) e.city = 'Enter a valid city name (letters only — no numbers or special characters)';
    if (!curCountry)        e.country_id    = 'Country is required';
    if (!curState)          e.state_id      = 'State is required';
    if (!curPin.trim())     e.pincode       = 'Pincode is required';
    else if (!isValidPincode(curPin)) e.pincode = 'Pincode must be 6 digits';
    // Permanent address (only when NOT mirroring current). City, if provided,
    // follows the same name rule; pincode format is checked when present.
    if (!sameAsCurrent) {
      if (permAddr1.trim() && !isValidAddress(permAddr1))
        e.perm_address_line1 = ADDRESS_MSG;
      if (permAddr2.trim() && !isValidAddress(permAddr2))
        e.perm_address_line2 = ADDRESS_MSG;
      if (permCity.trim() && !nameRe.test(permCity.trim()))
        e.perm_city = 'Enter a valid city name (letters only — no numbers or special characters)';
      if (permPin.trim() && !isValidPincode(permPin))
        e.perm_pincode = 'Pincode must be 6 digits';
    }
    return e;
  };

  // Overall completion across the required fields of all three steps. Drives
  // the footer progress bar so it reflects the data actually entered (not just
  // which step you're on, which was the old step-number-only calculation).
  const completionPct = useMemo(() => {
    const required = [
      firstName, lastName, gender, dob, nationality, workCountry, mobile,      // Step 1 · Basic Info
      curAddr1, curCity, curCountry, curState, curPin,                         // Step 2 · Address
      departmentId, designationId, primaryRoleId, legalEntityId, joiningDate,  // Step 3 · Job Details
    ];
    const filled = required.filter(v => String(v ?? '').trim() !== '').length;
    return Math.round((filled / required.length) * 100);
  }, [firstName, lastName, gender, dob, nationality, workCountry, mobile,
      curAddr1, curCity, curCountry, curState, curPin,
      departmentId, designationId, primaryRoleId, legalEntityId, joiningDate]);

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
      const step2Keys = ['address_line1','address_line2','city','country_id','state_id','pincode','perm_address_line1','perm_address_line2','perm_city','perm_pincode'];
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
      <div style={{ minHeight: '100vh', background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#1d4ed8', fontSize: 14, fontWeight: 600 }}>Loading invitation…</div>
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
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #ccfbf1 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <style>{`
          @keyframes onb-pop {
            0%   { transform: scale(0);   opacity: 0; }
            60%  { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1);   opacity: 1; }
          }
          @keyframes onb-check {
            0%   { stroke-dashoffset: 48; }
            100% { stroke-dashoffset: 0; }
          }
          @keyframes onb-rise {
            0%   { transform: translateY(12px); opacity: 0; }
            100% { transform: translateY(0);    opacity: 1; }
          }
          @keyframes onb-pulse {
            0%   { box-shadow: 0 0 0 0 rgba(16,185,129,.55); }
            70%  { box-shadow: 0 0 0 22px rgba(16,185,129,0); }
            100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
          }
          .onb-done-card {
            animation: onb-rise .5s ease-out both;
            animation-delay: .15s;
          }
          .onb-done-badge {
            animation: onb-pop .55s cubic-bezier(.22,1.4,.36,1) both,
                       onb-pulse 2.2s ease-out 1s infinite;
          }
          .onb-done-check path {
            stroke-dasharray: 48;
            stroke-dashoffset: 48;
            animation: onb-check .45s ease-out .55s forwards;
          }
          .onb-done-line { animation: onb-rise .5s ease-out both; }
          .onb-done-blob {
            position: absolute;
            border-radius: 50%;
            filter: blur(60px);
            opacity: .55;
            pointer-events: none;
          }
        `}</style>

        {/* Soft background blobs to add depth without being noisy */}
        <div className="onb-done-blob" style={{ top: -120, left: -120, width: 320, height: 320, background: '#34d399' }} />
        <div className="onb-done-blob" style={{ bottom: -140, right: -140, width: 360, height: 360, background: '#5eead4' }} />

        <div
          className="onb-done-card"
          style={{
            position: 'relative',
            maxWidth: 520,
            width: '100%',
            padding: '44px 36px 36px',
            background: '#ffffff',
            borderRadius: 24,
            textAlign: 'center',
            boxShadow: '0 32px 80px -20px rgba(6,95,70,.25), 0 12px 30px rgba(6,95,70,.10)',
            border: '1px solid rgba(16,185,129,.18)',
          }}
        >
          {/* Animated check badge */}
          <div
            className="onb-done-badge"
            style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              margin: '0 auto 20px',
              background: 'linear-gradient(135deg,#10b981 0%,#059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg className="onb-done-check" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.2 4.2L19 7" />
            </svg>
          </div>

          <h2
            className="onb-done-line"
            style={{
              fontSize: 26,
              fontWeight: 800,
              margin: '0 0 6px',
              background: 'linear-gradient(135deg,#059669,#0d9488)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
              animationDelay: '.25s',
            }}
          >
            Welcome aboard!
          </h2>
          <p
            className="onb-done-line"
            style={{ fontSize: 14.5, color: '#475569', margin: '0 0 22px', animationDelay: '.32s' }}
          >
            Your employee profile has been created.
          </p>

          {/* Employee identity card */}
          <div
            className="onb-done-line"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 18px',
              background: 'linear-gradient(135deg, rgba(16,185,129,.10), rgba(20,184,166,.10))',
              border: '1px solid rgba(16,185,129,.30)',
              borderRadius: 14,
              animationDelay: '.4s',
            }}
          >
            <div
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg,#0d9488,#0f766e)',
                color: '#fff', fontWeight: 800, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                letterSpacing: '0.02em',
              }}
            >
              {(done.display_name || 'E').trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0d9488', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Employee Code
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: '#064e3b', lineHeight: 1.25 }}>
                {done.emp_code} · {done.display_name}
              </div>
            </div>
          </div>

          {/* Email confirmation strip */}
          <div
            className="onb-done-line"
            style={{
              marginTop: 24,
              padding: '12px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              animationDelay: '.48s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.45 }}>
              Your login credentials will be emailed to{' '}
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{invite?.invitee_email}</span>
              {' '}once your employee account is activated in the company system.
            </div>
          </div>

          {/* Footer note */}
          <p className="onb-done-line" style={{ fontSize: 12, color: '#94a3b8', margin: '20px 0 0', animationDelay: '.55s' }}>
            You can safely close this page.
          </p>
        </div>
      </div>
    );
  }

  // Allow clicking earlier (already-visited) steps to jump back. Forward
  // jumps still go through goNext() so validators run.
  const jumpToStep = (n: StepNum) => { if (n < step) setStep(n); };

  // Sidebar step config — title + description shown in the left rail.
  const SIDE_STEPS: { n: StepNum; title: string; sub: string }[] = [
    { n: 1, title: 'Your personal details', sub: 'Name, gender, contact info' },
    { n: 2, title: 'Address details',       sub: 'Current & permanent address' },
    { n: 3, title: 'Job details',           sub: 'Confirm role & joining date' },
  ];

  // Per-step tab strip — purely visual section header that matches
  // the reference design's top tab nav. We keep ALL fields visible
  // per step (no sub-tab filtering); the tab just labels the section.
  const STEP_TABS: Record<StepNum, { id: string; label: string }[]> = {
    1: [{ id: 'general', label: 'Personal Details' }],
    2: [{ id: 'general', label: 'Address Details' }],
    3: [{ id: 'general', label: 'Job Details' }],
  };
  const currentTabs = STEP_TABS[step];
  const activeTab = currentTabs.some(t => t.id === tab) ? tab : currentTabs[0].id;

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
        [data-bs-theme="dark"] .emp-input {
          background: #0f1623;
          border-color: rgba(255,255,255,0.14);
          color: #e5e7eb;
        }
        [data-bs-theme="dark"] .emp-input::placeholder { color: rgba(255,255,255,0.40); }
        [data-bs-theme="dark"] .emp-input:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(96,165,250,0.22);
        }
        .emp-label { font-size: 12px; font-weight: 600; color: var(--vz-heading-color, #374151); letter-spacing: 0; text-transform: none; margin-bottom: 5px; display: block; }
        [data-bs-theme="dark"] .emp-label { color: #e5e7eb; }
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
            radial-gradient(900px 700px at 100% -20%,  rgba(37,99,235,0.12) 0%, transparent 60%),
            radial-gradient(700px 900px at 100% 120%, rgba(29,78,216,0.10)  0%, transparent 60%),
            linear-gradient(135deg, #f0f5ff 0%, #e0e9fb 100%);
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
           reference template's corners. Pure CSS borders so no SVG dep.
           The reference has a thick blue ring + a thinner inner ring in
           the bottom-right corner, plus a thinner one in the top-right. */
        .onb-arc {
          position: fixed;
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
        }
        .onb-arc-tr {
          width: 380px; height: 380px;
          top: -190px; right: -190px;
          border: 50px solid rgba(37,99,235,0.10);
        }
        .onb-arc-br {
          width: 480px; height: 480px;
          bottom: -240px; right: -240px;
          border: 90px solid rgba(29,78,216,0.18);
        }
        .onb-arc-br-inner {
          position: fixed;
          width: 320px; height: 320px;
          bottom: -160px; right: -160px;
          border-radius: 50%;
          border: 30px solid rgba(37,99,235,0.10);
          pointer-events: none;
          z-index: 0;
        }
        @media (max-width: 1024px) { .onb-arc, .onb-arc-br-inner { display: none; } }

        /* Kill body default 8px margin + any inherited padding/scroll
           that would push min-height 100vh past the viewport and trigger
           an unwanted vertical scrollbar on short Step 3 forms. Scoped
           via :has so it only applies on pages that contain the shell. */
        html:has(.onb-shell), body:has(.onb-shell) {
          margin: 0;
          padding: 0;
        }
        body:has(.onb-shell) {
          overflow-x: hidden;
        }

        /* The onb-shell class is the OUTER vertical-centering frame.
           It owns min-height 100vh plus flex centering so the card
           sits in the middle of the viewport when content is short,
           and the page scrolls naturally when content is taller than
           the viewport. Centering is on this wrapper (not on the
           onb-layout itself) so the decorative ::before notch and
           the onb-wave SVG inside onb-layout track the card height,
           not the viewport height. */
        .onb-shell {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 1;
          /* Hard cap — anything inside that tries to extend past viewport
             width (decorative wave SVG, runaway long text, etc.) gets
             clipped instead of triggering a horizontal scrollbar.
             Use clip (NOT hidden): overflow-x hidden on this 100vh frame
             forces overflow-y to compute to auto, turning the shell into a
             SECOND vertical scroll container alongside the page — the
             duplicate-scrollbar bug. clip clips horizontally without that
             side-effect, leaving the body as the single scroller. */
          overflow-x: clip;
        }
        .onb-layout {
          /* Natural height — sizes to its content (sidebar + form).
             Decorative ::before + .onb-wave can now safely position
             themselves relative to this container without stretching
             across the full viewport. */
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          align-items: stretch;
          width: 100%;
          margin: 0 auto;
          padding: 28px;
          gap: 0;
          position: relative;
          z-index: 1;
          background: transparent;
          /* Hard guard — content can never push the layout horizontally
             off the viewport even if a child has runaway long text.
             clip (not hidden) so it never becomes a vertical scroller. */
          max-width: min(1440px, 100vw);
          overflow-x: clip;
        }
        /* Laptop screens (1024–1280px) — narrower sidebar so the form
           area gets more breathing room. */
        @media (max-width: 1280px) {
          .onb-layout { grid-template-columns: 260px minmax(0, 1fr); padding: 20px; }
          /* Re-align the decorative seam (white notch tab + blue wave) to the
             NARROWER 260px sidebar / 20px padding used at this breakpoint.
             Without this they stay pinned to the 300px desktop offset and
             slide ~48px into the form pane, overlapping the field content. */
          .onb-layout::before,
          .onb-wave { left: calc(20px + 260px - 1px); }
        }
        /* Tablets and below — collapse to single column. Sidebar stacks
           above the form. Removed at 1024px (was 900px) because 900-1024
           laptop screens felt cramped with the 2-col layout. */
        @media (max-width: 1024px) {
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
        @media (max-width: 1024px) { .onb-layout::before { display: none; } }

        /* SVG wave-edge overlay — extends the blue sidebar into the
           form area along an S-curve silhouette. The bulges at top and
           bottom (with a concave middle) match the reference template's
           distinctive wave shape. Sits behind the form content (z:2)
           but above the page background (z:0). */
        .onb-wave {
          position: absolute;
          top: 28px; bottom: 28px;
          left: calc(28px + 300px - 1px);
          width: 72px;
          z-index: 2;
          pointer-events: none;
          overflow: visible;
        }
        .onb-wave svg {
          width: 100%; height: 100%;
          display: block;
          filter: drop-shadow(8px 0 18px rgba(13,38,76,0.22));
        }
        @media (max-width: 1024px) { .onb-wave { display: none; } }

        /* Vertical brand label (.onb-form-vlabel) removed per QA feedback —
           the rotated wordmark was reading as a watermark obscuring the
           form on narrow viewports and was deemed unnecessary clutter
           on the public onboarding flow. */

        /* Left rail — bright blue gradient matching the reference
           template's vibrant blue sidebar. Sticky so only the right
           side scrolls. */
        .onb-side {
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,0.18) 0%, transparent 38%),
            radial-gradient(circle at 0% 100%, rgba(96,165,250,0.30) 0%, transparent 48%),
            linear-gradient(165deg, #1e3a8a 0%, #1d4ed8 35%, #2563eb 70%, #3b82f6 100%);
          color: #fff;
          padding: 32px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          /* Only the LEFT corners get rounded — the right side has its
             curved silhouette drawn by the wave SVG which overlays the
             seam (top-right and bottom-right stay flat so the wave's
             curves don't fight with a corner-radius curve). */
          border-radius: 20px 0 0 20px;
          /* Match the form pane's height naturally via grid stretch
             instead of forcing 100vh. With min-height set to a sensible
             floor (so the BH brand + 3 steps + footer fit), the sidebar
             grows only as tall as the form needs — no more giant empty
             blue rail next to a short form. */
          min-height: 540px;
          align-self: stretch;
          /* overflow visible so the step number circles can OVERLAP the
             seam between sidebar and form (matches the DiveShop360 ref).
             Brand + 3 steps + footer fit comfortably without scroll.
             z-index: 3 sits ABOVE the wave SVG (z:2) and the white notch
             tab (z:2) so the absolute-positioned circles that overflow
             the sidebar's right edge actually render on top of the wave. */
          overflow: visible;
          z-index: 3;
          box-shadow: 0 18px 40px -10px rgba(29,78,216,0.40);
        }
        @media (max-width: 1024px) {
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
          background: rgba(255,255,255,0.96);
          border-radius: 10px;
          padding: 10px 16px;
          height: 76px; max-width: 100%;
          box-shadow: 0 6px 16px rgba(13,38,76,0.18);
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
        .onb-side-steps {
          display: flex; flex-direction: column;
          position: relative; z-index: 1;
          gap: 28px;
          /* Push the step list into the middle of the sidebar so the empty
             space distributes evenly above (after the brand) and below
             (before the footer) instead of dumping it all at the bottom.
             Looks clean whether the page is short or scrolled. */
          margin: auto 0;
        }
        .onb-step {
          position: relative;
          display: flex; align-items: center; gap: 14px;
          background: transparent; border: 0; padding: 18px 0;
          color: inherit; text-align: left; width: 100%;
          cursor: pointer; transition: opacity .15s ease;
          /* Reserve room on the right for the floating circle which is
             absolute-positioned so it ACTUALLY extends past the sidebar's
             right edge (negative margin alone wouldn't visually move it). */
          padding-right: 36px;
          min-height: 56px;
        }
        .onb-step:disabled { cursor: default; }
        .onb-step:not(:disabled):hover .onb-step-title { color: #fff; }
        /* Step NUMBER badge — sits on the RIGHT side of each label (the
           reference template's "1 / 2 / 3 / 4 / 5" circles on the right
           edge of the sidebar). White circles with a faint outline by
           default; the active step gets a thick green ring; completed
           steps get a solid green fill with a check. */
        .onb-step-circle {
          /* Absolute-position the circle so its CENTER sits ON the seam
             between sidebar and form pane (half on blue, half on white).
             Sidebar has 24px right padding; circle is 48px wide, so
             right: -48px puts the right edge 48px past the .onb-step's
             content-box right edge — meaning the circle's center lands
             exactly on the sidebar's outer right edge. */
          position: absolute;
          right: -48px;
          top: 50%;
          transform: translateY(-50%);
          width: 48px; height: 48px; border-radius: 50%;
          background: #ffffff; color: #94a3b8;
          border: 1.5px solid rgba(255,255,255,0.85);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px;
          transition: all .2s ease;
          z-index: 4;
          box-shadow: 0 4px 12px rgba(15,23,42,0.18);
        }
        /* Step NUMBER inside the circle — bold, slightly larger so it
           reads as a "1", "2", "3" badge (matches the reference). */
        .onb-step-num {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.01em;
          font-feature-settings: 'tnum';
          color: inherit;
        }
        /* Current step — white circle with a bright GREEN outer ring,
           exactly as in the reference template. The number stays in the
           primary blue so it pops against the white pill. */
        .onb-step.is-active .onb-step-circle {
          background: #ffffff;
          color: #1d4ed8;
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34,197,94,0.35), 0 8px 18px rgba(34,197,94,0.32);
          transform: translateY(-50%) scale(1.04);
        }
        /* Done step — solid green badge with the check icon. */
        .onb-step.is-done .onb-step-circle {
          background: linear-gradient(135deg, #10b981 0%, #22c55e 100%);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 6px 16px rgba(16,185,129,0.35);
        }
        .onb-step-text {
          display: flex; flex-direction: column;
          min-width: 0; flex: 1 1 auto;
          /* Title/sub may be longer than the available column, so allow
             words to break and ellipsize gracefully instead of overflowing
             under the circle. */
          overflow: hidden;
        }
        .onb-step-title {
          font-size: 15px; font-weight: 600;
          color: rgba(255,255,255,0.85); line-height: 1.3;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .onb-step.is-active .onb-step-title { color: #ffffff; font-weight: 700; }
        .onb-step.is-done .onb-step-title { color: rgba(255,255,255,0.75); }
        .onb-step-sub {
          font-size: 11.5px; color: rgba(255,255,255,0.55); margin-top: 3px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        /* Vertical connector line — runs through the centers of the
           floating circles on the seam. Same x-offset as circle center:
           circle is margin-right: -48px with width 48px, so its center
           sits at right: -24px. Line is 1.5px wide, so right: -24.75px.
           z-index: 3 sits below the circles (z:4) but above the wave. */
        .onb-step-line {
          /* Bridges the visible gap from THIS circle's bottom edge to the
             NEXT circle's top edge. With .onb-side-steps gap: 28px and
             circle radius 24px, the line needs to extend ~52px below the
             current circle's center to reach the next circle's center,
             then we subtract another 24px so it stops at the next circle's
             top edge. So height = 52px - 24px = 28px below current circle. */
          position: absolute; right: -24.75px; top: calc(50% + 26px);
          width: 1.5px; height: calc(50% + 22px);
          background: rgba(255,255,255,0.45);
          z-index: 3;
        }
        .onb-step.is-done .onb-step-line { background: rgba(34,197,94,0.7); }
        /* Mobile (no form pane beside sidebar) — pull the floating circle
           and connector line back inside the sidebar so they don't hang
           off the right edge of the screen. */
        @media (max-width: 1024px) {
          .onb-step { padding-right: 64px; }
          .onb-step-circle { right: 8px; }
          .onb-step-line { right: 31.25px; }
        }

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
        @media (max-width: 1024px) {
          .onb-main { padding: 24px 20px 22px; border-radius: 0; }
        }
        /* True mobile (<=480px) — minimal padding so form fields use the
           full viewport width. Anything more breaks 40-column form rhythm
           on narrow phones. */
        @media (max-width: 480px) {
          .onb-main { padding: 18px 14px 16px; }
          .onb-welcome { padding: 8px 12px; gap: 8px; }
          .onb-welcome-icon { width: 30px; height: 30px; font-size: 14px; border-radius: 8px; }
          .onb-welcome-title { font-size: 12px; }
          .onb-welcome-sub { font-size: 11px; }
        }

        /* Global horizontal-overflow guard — last line of defence so a
           rogue child element (long token, runaway grid item, etc.) can
           never make the page scroll sideways on any screen size. */
        :where(.onb-page, .onb-layout, .onb-main, .onb-main-inner) {
          max-width: 100%;
          overflow-x: clip;
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
          padding: 10px 16px; border-radius: 12px;
          background: linear-gradient(120deg, rgba(37,99,235,0.06) 0%, rgba(59,130,246,0.08) 100%);
          border: 1px solid rgba(37,99,235,0.14);
          margin-bottom: 14px;
          /* overflow: hidden traps any rogue long text inside the card
             instead of letting it stretch the parent container off-screen. */
          overflow: hidden;
          max-width: 100%;
        }
        [data-bs-theme="dark"] .onb-welcome {
          background: linear-gradient(120deg, rgba(59,130,246,0.16) 0%, rgba(96,165,250,0.20) 100%);
          border-color: rgba(96,165,250,0.32);
        }
        .onb-welcome-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: #fff; display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(37,99,235,0.35);
        }
        /* The text wrapper — min-width: 0 lets it shrink inside the flex
           parent (default flex min-width is auto which would force it to
           grow with its content). Without this, a 200-char invitee name
           or org name balloons the welcome card off the right edge. */
        .onb-welcome > div:not(.onb-welcome-icon) {
          min-width: 0;
          flex: 1 1 auto;
        }
        .onb-welcome-title {
          font-size: 13px; font-weight: 700; letter-spacing: -0.005em;
          color: var(--vz-heading-color, #0f1e4b); line-height: 1.2;
          /* Long org names wrap onto a second line rather than stretching
             the card sideways. break-word handles unspaced gibberish too. */
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .onb-welcome-sub {
          font-size: 11.5px; color: var(--vz-secondary-color, #6b7280);
          margin-top: 1px;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .onb-welcome-sub strong { color: var(--vz-heading-color, #374151); font-weight: 600; }

        /* Bottom progress bar — slim track + filled gradient with the
           "X of Y · NN% complete" label next to it. Sits inside the
           foot row, replaces the lonely Next button at the bottom. */
        .onb-progress {
          display: flex; align-items: center; gap: 12px;
          flex: 1 1 auto; max-width: 420px; min-width: 180px;
        }
        /* Right-side button cluster — Previous (outlined) + Next (solid)
           grouped together, matching the reference template. */
        .onb-foot-actions {
          display: flex; align-items: center; gap: 12px;
          flex-shrink: 0;
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

        /* Title row — wraps the tab strip; kept as a flex row so future
           right-side content slots in without re-layouts. */
        .onb-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 22px;
          border-bottom: 1px solid var(--vz-border-color, #e5e7eb);
        }
        .onb-title-row .onb-tabs {
          flex: 1; min-width: 0;
          margin: 0;
          border-bottom: 0;
        }

        /* Top tab strip — mirrors the reference template's
           "General | Address | Contact | …" tab nav above the form.
           Underline-style tabs with a thick blue indicator on the
           active tab and muted labels on the inactive ones. */
        .onb-tabs {
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1px solid var(--vz-border-color, #e5e7eb);
          margin: 0 0 22px;
          padding: 0 4px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .onb-tabs::-webkit-scrollbar { display: none; }
        .onb-tab {
          position: relative;
          background: transparent;
          border: 0;
          padding: 10px 18px 12px;
          font-size: 13.5px;
          font-weight: 600;
          color: var(--vz-secondary-color, #94a3b8);
          cursor: pointer;
          white-space: nowrap;
          transition: color .18s ease;
        }
        .onb-tab:hover:not(:disabled) { color: var(--vz-heading-color, #1f2937); }
        .onb-tab:disabled { cursor: not-allowed; opacity: 0.55; }
        .onb-tab.is-active {
          color: #1d4ed8;
          font-weight: 700;
        }
        .onb-tab.is-active::after {
          content: '';
          position: absolute;
          left: 12px; right: 12px; bottom: -1px;
          height: 3px;
          background: linear-gradient(90deg, #2563eb, #3b82f6);
          border-radius: 3px 3px 0 0;
        }

        /* Stacked label rows — label sits ABOVE the input, matching the
           older IGC Basic Info layout and the 3-column grid below. */
        .onb-hrow {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .onb-hrow > .emp-label {
          margin: 0;
          text-align: left;
          font-size: 13px;
          font-weight: 600;
          color: var(--vz-heading-color, #374151);
        }
        .onb-hrow > .onb-hrow-input {
          min-width: 0;
        }
        .onb-hrow .emp-err {
          margin-top: 4px;
        }
        /* Three-column row grid so 9 fields fit in 3 tidy rows without
           scrolling — matches the older Basic Info / IGC layout where
           labels stack ABOVE inputs in compact column cells. */
        .onb-hgrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px 24px;
          max-width: 1100px;
          margin: 0 auto;
        }
        @media (max-width: 1024px) {
          .onb-hgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 600px) {
          .onb-hgrid { grid-template-columns: 1fr; }
        }
        /* Section title between groups of fields (e.g. "Current Address"
           / "Permanent Address" on step 2). Sits in the same centered
           column as the field grid. */
        .onb-section-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--vz-heading-color, #0f172a);
          margin: 6px auto 14px;
          /* Match the field grid's max-width (1100) so the heading's left edge
             lines up with the first field column instead of sitting ~40px
             indented (was 920, which left it misaligned with the grid). */
          max-width: 1100px;
          padding-left: 4px;
          letter-spacing: -0.005em;
        }
        .onb-section-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          /* Allow the toggle to drop onto its own line when the form pane
             gets narrow — without this the fixed-width "Same as Current
             Address" pill collides with the section title and the clipped
             overlap reads as broken text on smaller windows. */
          flex-wrap: wrap;
          gap: 8px 12px;
          /* Align with the field grid (1100) — see .onb-section-title note. */
          max-width: 1100px;
          margin: 22px auto 12px;
          padding-left: 4px;
        }
        .onb-section-title-row .onb-section-title {
          margin: 0;
          padding-left: 0;
          /* Let the title shrink inside the flex row instead of forcing the
             row wider than the pane (its default min-width: auto would). */
          min-width: 0;
        }
        /* Keep the toggle pill intact (never wrap its text mid-phrase) and
           let it move as a whole unit to the next line when space is tight. */
        .onb-section-title-row .onb-same-toggle {
          flex-shrink: 0;
          white-space: nowrap;
        }
        .onb-same-toggle {
          font-size: 12.5px;
          color: var(--vz-secondary-color, #6b7280);
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border: 1px solid rgba(37,99,235,0.18);
          border-radius: 999px;
          background: rgba(37,99,235,0.04);
          transition: background .15s ease, border-color .15s ease;
        }
        .onb-same-toggle:hover { background: rgba(37,99,235,0.08); border-color: rgba(37,99,235,0.28); }
        .onb-same-toggle input[type="checkbox"] { accent-color: #2563eb; margin: 0; }

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
          color: #2563eb;
          border: 1.5px solid #2563eb;
        }
        .onb-btn-ghost:hover:not(:disabled) {
          border-color: #1d4ed8;
          color: #1d4ed8;
          background: rgba(37,99,235,0.10);
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(37,99,235,0.20);
        }
        .onb-btn-ghost:active:not(:disabled) { transform: translateY(0); }
        .onb-btn-primary {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          color: #ffffff;
          box-shadow: 0 6px 16px rgba(37,99,235,0.35);
        }
        .onb-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(37,99,235,0.45);
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

        .onb-main-foot {
          display: flex; align-items: center; justify-content: space-between;
          gap: 24px;
          padding-top: 18px; margin-top: 22px;
          border-top: 1px solid var(--vz-border-color, #e5e7eb);
        }
        @media (max-width: 600px) {
          .onb-main-foot { flex-wrap: wrap; gap: 12px; }
          .onb-progress { max-width: 100%; }
          .onb-foot-actions { width: 100%; justify-content: flex-end; }
        }

        @media (max-width: 1024px) {
          .onb-side { padding: 20px 20px 16px; gap: 18px; }
          .onb-side-brand-logo, .onb-side-brand-fallback { width: 94px; height: 64px; }
          .onb-main { padding: 24px 20px 22px; }
          .onb-main-title { font-size: 22px; }
          .onb-welcome { padding: 12px 14px; }
          .onb-welcome-icon { width: 38px; height: 38px; font-size: 18px; }
        }

        /* ── Dark-mode overrides ────────────────────────────────────────
           Components that hardcode light-mode colors get explicit dark
           variants here so the page reads correctly under both themes. */
        [data-bs-theme="dark"] .onb-main { background: #131c2b; }
        [data-bs-theme="dark"] .onb-main-title { color: #f8fafc; }
        [data-bs-theme="dark"] .onb-main-sub { color: #94a3b8; }
        [data-bs-theme="dark"] .onb-section-title { color: #e2e8f0; }
        [data-bs-theme="dark"] .onb-welcome-title { color: #f1f5f9; }
        [data-bs-theme="dark"] .onb-welcome-sub { color: #94a3b8; }
        [data-bs-theme="dark"] .onb-welcome-sub strong { color: #e2e8f0; }
        [data-bs-theme="dark"] .onb-tab { color: #94a3b8; }
        [data-bs-theme="dark"] .onb-tab:hover:not(:disabled) { color: #e2e8f0; }
        [data-bs-theme="dark"] .onb-tab.is-active { color: #60a5fa; }
        [data-bs-theme="dark"] .onb-tab.is-active::after {
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
        }
        [data-bs-theme="dark"] .onb-tabs { border-bottom-color: rgba(255,255,255,0.12); }
        [data-bs-theme="dark"] .onb-main-foot { border-top-color: rgba(255,255,255,0.12); }
        [data-bs-theme="dark"] .onb-same-toggle {
          color: var(--vz-secondary-color);
          background: rgba(96,165,250,0.10);
          border-color: rgba(96,165,250,0.24);
        }
        [data-bs-theme="dark"] .onb-same-toggle:hover {
          background: rgba(96,165,250,0.16);
          border-color: rgba(96,165,250,0.34);
        }
        /* MasterSelect / MasterDatePicker share the input look — give
           them the same dark-mode treatment so dropdowns and pickers
           don't appear as blank white pills on the dark form. */
        [data-bs-theme="dark"] .onb-main .master-select-toggle,
        [data-bs-theme="dark"] .onb-main .master-datepicker-toggle {
          background: #0f1623 !important;
          border-color: rgba(255,255,255,0.14) !important;
          color: #e5e7eb !important;
        }
        [data-bs-theme="dark"] .onb-progress-track {
          background: var(--vz-border-color, #2b3445);
        }
        [data-bs-theme="dark"] .onb-progress-label {
          color: var(--vz-secondary-color);
        }
        /* Logo plate sits on dark navy in dark mode — slightly tinted so
           it doesn't glow as a pure-white rectangle. */
        [data-bs-theme="dark"] .onb-side-brand-logo {
          background: rgba(255,255,255,0.88);
          box-shadow: 0 6px 16px rgba(0,0,0,0.40);
        }
        /* Form input row error text — slightly different red for dark bg. */
        [data-bs-theme="dark"] .onb-main .emp-err { color: #f87171; }

        /* ── Final-touch polish ─────────────────────────────────────────
           Subtle entrance animation, smoother focus rings, and a small
           hover bounce on the step circles. */
        .onb-main-inner { animation: onb-fade-in .4s ease both; }
        @keyframes onb-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .onb-step:not(:disabled):hover .onb-step-circle {
          box-shadow: 0 6px 16px rgba(15,23,42,0.24);
        }
        .emp-input:focus,
        .onb-main .master-select-toggle:focus-within,
        .onb-main .master-datepicker-toggle:focus-within {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.18);
        }
      `}</style>

      {/* Tinted backdrop + decorative quarter-circle arcs that mimic
          the reference template's outer corner motifs. Sit on top of
          the page bg with z-index: 0 so all content layers above. */}
      <div className="onb-page-bg" aria-hidden />
      <div className="onb-arc onb-arc-tr" aria-hidden />
      <div className="onb-arc onb-arc-br" aria-hidden />
      <div className="onb-arc-br-inner" aria-hidden />

      {/* `.onb-shell` is a 100vh flex container that vertically centers
          the card. We do the centering on THIS wrapper (not on
          .onb-layout itself) so the decorative ::before notch and the
          .onb-wave SVG inside .onb-layout match the card's actual
          height — not the full viewport height. Without this wrapper
          the wave/notch were rendering as tall vertical stripes
          extending way above + below the card. */}
      <div className="onb-shell">
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
                <stop offset="0%" stopColor="#1e3a8a" />
                <stop offset="45%" stopColor="#1d4ed8" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <path
              d="
                M 0 0
                Q 32 0, 32 32
                L 32 768
                Q 32 800, 0 800
                L 0 0
                Z
              "
              fill="url(#onb-wave-grad)"
            />
          </svg>
        </div>

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
                  <span className="onb-step-text">
                    <span className="onb-step-title">{s.title}</span>
                    <span className="onb-step-sub">{s.sub}</span>
                  </span>
                  <span className="onb-step-circle">
                    {done2
                      ? <i className="ri-check-line" />
                      : <span className="onb-step-num">{s.n}</span>}
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

            {/* Welcome banner — greets the invitee by name and surfaces
                the tenant context. Only shown when we know who they are. */}
            {invite && (() => {
              // Trim runaway long org names / display names so the greeting
              // card never balloons. 80 chars is enough for "Acme Corporation,
              // Mumbai Branch Office, Andheri East" but caps the testing
              // gibberish ("ssssssss...") that QA pastes.
              const cap = (s: string, n: number) =>
                s.length > n ? s.slice(0, n).trim() + '…' : s;
              const orgName = cap((invite.org_name || '').trim(), 80);
              const displayHi = cap(
                (firstName || invite.invitee_email?.split('@')[0] || 'there').trim(),
                40
              );
              return (
                <div className="onb-welcome">
                  <div className="onb-welcome-icon"><i className="ri-hand-heart-line" /></div>
                  <div>
                    <div className="onb-welcome-title" title={invite.org_name || ''}>
                      Welcome to {orgName} · Onboarding Form
                    </div>
                    <div className="onb-welcome-sub">
                      Hi <strong>{displayHi}</strong>
                      {invite.invitee_email && <> · {invite.invitee_email}</>}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Per-step title + subtitle — gives the form section a clear
                heading like "Basic Info" / "Tell us a bit about yourself". */}
            <h1 className="onb-main-title">
              {step === 1 ? 'Basic Info' : step === 2 ? 'Address' : 'Job Details'}
            </h1>
            <p className="onb-main-sub">
              {step === 1
                ? `Tell us a bit about yourself to get started with your ${invite?.org_name || ''} account.`
                : step === 2
                  ? 'Where can we reach you? Add your current and permanent addresses.'
                  : 'Confirm your role and joining date to wrap up onboarding.'}
            </p>

            {/* Top row — tab strip on the left, "Approx Time" chip on
                the right. Mirrors the reference design where the tabs
                read across the top of the form pane and the time
                estimate sits in the top-right corner. */}
            <div className="onb-title-row">
              <nav className="onb-tabs" role="tablist" aria-label="Step sections">
                {currentTabs.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === activeTab}
                    className={`onb-tab${t.id === activeTab ? ' is-active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>

          {step === 1 && (
            <div className="onb-hgrid">
              <div className="onb-hrow">
                <label className="emp-label">First Name<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <input className={`emp-input${errs.first_name ? ' is-invalid' : ''}`} placeholder="e.g. Aarav" maxLength={15} value={firstName} onChange={e => { setFirstName(e.target.value); clearErr('first_name'); }} />
                  {errs.first_name && <small className="emp-err">{errs.first_name}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Middle Name</label>
                <div className="onb-hrow-input">
                  <input className={`emp-input${errs.middle_name ? ' is-invalid' : ''}`} placeholder="Middle name (optional)" maxLength={15} value={middleName} onChange={e => { setMiddleName(e.target.value); clearErr('middle_name'); }} />
                  {errs.middle_name && <small className="emp-err">{errs.middle_name}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Last Name<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <input className={`emp-input${errs.last_name ? ' is-invalid' : ''}`} placeholder="e.g. Kale" maxLength={15} value={lastName} onChange={e => { setLastName(e.target.value); clearErr('last_name'); }} />
                  {errs.last_name && <small className="emp-err">{errs.last_name}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Gender<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <MasterSelect value={gender} onChange={v => { setGender(v); clearErr('gender'); }} options={genderOpts} placeholder="Select gender" invalid={!!errs.gender} />
                  {errs.gender && <small className="emp-err">{errs.gender}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Date of Birth<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <MasterDatePicker value={dob} onChange={v => { setDob(v); clearErr('date_of_birth'); }} placeholder="dd-mm-yyyy" invalid={!!errs.date_of_birth} maxDate={dobMaxDate} />
                  {errs.date_of_birth && <small className="emp-err">{errs.date_of_birth}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Nationality<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <MasterSelect value={nationality} onChange={v => { setNationality(v); clearErr('nationality_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.nationality_country_id} />
                  {errs.nationality_country_id && <small className="emp-err">{errs.nationality_country_id}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Work Country<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <MasterSelect value={workCountry} onChange={v => { setWorkCountry(v); clearErr('work_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.work_country_id} />
                  {errs.work_country_id && <small className="emp-err">{errs.work_country_id}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Mobile Number<span className="req">*</span></label>
                <div className="onb-hrow-input">
                  <input className={`emp-input${errs.mobile ? ' is-invalid' : ''}`} value={mobile} onChange={e => { setMobile(e.target.value); clearErr('mobile'); }} placeholder="10-digit mobile" />
                  {errs.mobile && <small className="emp-err">{errs.mobile}</small>}
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Alternate Mobile</label>
                <div className="onb-hrow-input">
                  <input className={`emp-input${errs.alt_mobile ? ' is-invalid' : ''}`} value={altMobile} onChange={e => { setAltMobile(e.target.value); clearErr('alt_mobile'); }} placeholder="(optional)" />
                  {errs.alt_mobile && <small className="emp-err">{errs.alt_mobile}</small>}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <>
              <div className="onb-section-title">Current Address</div>
              <div className="onb-hgrid">
                <div className="onb-hrow">
                  <label className="emp-label">Address Line 1<span className="req">*</span></label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.address_line1 ? ' is-invalid' : ''}`} value={curAddr1} onChange={e => { setCurAddr1(e.target.value); clearErr('address_line1'); }} />
                    {errs.address_line1 && <small className="emp-err">{errs.address_line1}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Address Line 2</label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.address_line2 ? ' is-invalid' : ''}`} value={curAddr2} onChange={e => { setCurAddr2(e.target.value); clearErr('address_line2'); }} placeholder="(optional)" />
                    {errs.address_line2 && <small className="emp-err">{errs.address_line2}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">City<span className="req">*</span></label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.city ? ' is-invalid' : ''}`} value={curCity} onChange={e => { setCurCity(e.target.value); clearErr('city'); }} />
                    {errs.city && <small className="emp-err">{errs.city}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Country<span className="req">*</span></label>
                  <div className="onb-hrow-input">
                    <MasterSelect value={curCountry} onChange={v => { setCurCountry(v); if (curState) setCurState(''); clearErr('country_id'); clearErr('state_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.country_id} />
                    {errs.country_id && <small className="emp-err">{errs.country_id}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">State<span className="req">*</span></label>
                  <div className="onb-hrow-input">
                    <MasterSelect value={curState} onChange={v => { setCurState(v); clearErr('state_id'); }} options={curStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={curCountry ? 'Select state' : 'Pick country first'} disabled={!curCountry} invalid={!!errs.state_id} />
                    {errs.state_id && <small className="emp-err">{errs.state_id}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Pincode<span className="req">*</span></label>
                  <div className="onb-hrow-input">
                    <input
                      className={`emp-input${errs.pincode ? ' is-invalid' : ''}`}
                      value={curPin}
                      onChange={e => { setCurPin(e.target.value.replace(/\D/g, '').slice(0, 6)); clearErr('pincode'); }}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit PIN"
                    />
                    {errs.pincode && <small className="emp-err">{errs.pincode}</small>}
                  </div>
                </div>
              </div>
              <div className="onb-section-title-row">
                <div className="onb-section-title">Permanent Address</div>
                <label className="onb-same-toggle">
                  <input type="checkbox" checked={sameAsCurrent} onChange={e => {
                    const c = e.target.checked;
                    setSameAsCurrent(c);
                    if (c) { setPermAddr1(curAddr1); setPermAddr2(curAddr2); setPermCity(curCity); setPermCountry(curCountry); setPermState(curState); setPermPin(curPin); }
                    else { setPermAddr1(''); setPermAddr2(''); setPermCity(''); setPermCountry(''); setPermState(''); setPermPin(''); }
                  }} /> Same as Current Address
                </label>
              </div>
              <div className="onb-hgrid">
                <div className="onb-hrow">
                  <label className="emp-label">Address Line 1</label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.perm_address_line1 ? ' is-invalid' : ''}`} value={permAddr1} onChange={e => { setPermAddr1(e.target.value); clearErr('perm_address_line1'); }} disabled={sameAsCurrent} />
                    {errs.perm_address_line1 && <small className="emp-err">{errs.perm_address_line1}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Address Line 2</label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.perm_address_line2 ? ' is-invalid' : ''}`} value={permAddr2} onChange={e => { setPermAddr2(e.target.value); clearErr('perm_address_line2'); }} disabled={sameAsCurrent} />
                    {errs.perm_address_line2 && <small className="emp-err">{errs.perm_address_line2}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">City</label>
                  <div className="onb-hrow-input">
                    <input className={`emp-input${errs.perm_city ? ' is-invalid' : ''}`} value={permCity} onChange={e => { setPermCity(e.target.value); clearErr('perm_city'); }} disabled={sameAsCurrent} />
                    {errs.perm_city && <small className="emp-err">{errs.perm_city}</small>}
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Country</label>
                  <div className="onb-hrow-input">
                    <MasterSelect value={permCountry} onChange={v => { setPermCountry(v); if (permState) setPermState(''); }} options={countryOpts} placeholder="Select country" disabled={sameAsCurrent} />
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">State</label>
                  <div className="onb-hrow-input">
                    <MasterSelect value={permState} onChange={setPermState} options={permStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={permCountry ? 'Select state' : 'Pick country first'} disabled={sameAsCurrent || !permCountry} />
                  </div>
                </div>
                <div className="onb-hrow">
                  <label className="emp-label">Pincode</label>
                  <div className="onb-hrow-input">
                    <input
                      className={`emp-input${errs.perm_pincode ? ' is-invalid' : ''}`}
                      value={permPin}
                      onChange={e => { setPermPin(e.target.value.replace(/\D/g, '').slice(0, 6)); clearErr('perm_pincode'); }}
                      disabled={sameAsCurrent}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit PIN"
                    />
                    {errs.perm_pincode && <small className="emp-err">{errs.perm_pincode}</small>}
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="onb-hgrid">
              <div className="onb-hrow">
                <label className="emp-label">Department</label>
                <div className="onb-hrow-input">
                  <MasterSelect value={departmentId} onChange={setDepartmentId} options={departmentOpts} placeholder="Select department" />
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Designation</label>
                <div className="onb-hrow-input">
                  <MasterSelect value={designationId} onChange={setDesignationId} options={designationOpts} placeholder="Select designation" />
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Primary Role</label>
                <div className="onb-hrow-input">
                  <MasterSelect value={primaryRoleId} onChange={setPrimaryRoleId} options={roleOpts} placeholder="Select role" />
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Legal Entity</label>
                <div className="onb-hrow-input">
                  <MasterSelect value={legalEntityId} onChange={v => {
                    setLegalEntityId(v);
                    const ent = legalEntities.find(le => String(le.id) === String(v));
                    setLocation(ent?.city || '');
                  }} options={legalEntityOpts} placeholder="Select entity" />
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Location</label>
                <div className="onb-hrow-input">
                  <input
                    className={`emp-input${legalEntityId ? ' is-readonly' : ''}`}
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder={legalEntityId ? 'Set by legal entity' : 'Select a legal entity'}
                    disabled={!!legalEntityId}
                    readOnly={!!legalEntityId}
                  />
                </div>
              </div>
              <div className="onb-hrow">
                <label className="emp-label">Joining Date</label>
                <div className="onb-hrow-input">
                  <MasterDatePicker value={joiningDate} onChange={setJoiningDate} placeholder="dd-mm-yyyy" />
                </div>
              </div>
            </div>
          )}

            {/* Footer — Progress on left, Previous/Next grouped on right
                (matches the DiveShop360 reference layout). */}
            <div className="onb-main-foot">
              <div className="onb-progress">
                <div className="onb-progress-track">
                  <div
                    className="onb-progress-fill"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
                <div className="onb-progress-label">
                  {completionPct}% Completed
                </div>
              </div>

              <div className="onb-foot-actions">
                {step > 1 && (
                  <button
                    type="button" onClick={goBack}
                    className="onb-btn onb-btn-ghost"
                  >
                    <i className="ri-arrow-left-line" /> PREVIOUS
                  </button>
                )}
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
          </div>
        </main>
      </div>
      </div>
    </>
  );
}
