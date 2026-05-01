import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';

/**
 * PublicOnboarding — the page candidates land on when they click the link
 * from the invite email. Three-step wizard:
 *
 *   Step 1: Personal
 *   Step 2: Address (current + permanent)
 *   Step 3: Job Details + Submit
 *
 * Draft persistence keyed by token: if the candidate fills step 1 and
 * closes the tab, reopening the link resumes them at the step they left
 * (state is restored, step pointer too). On successful submit the draft is
 * wiped so a refresh on the success card doesn't restore stale state.
 *
 * Rendered OUTSIDE the auth wrapper — no logged-in user; the URL token is
 * the only credential.
 */

interface InvitePreview {
  invitee_name: string;
  invitee_email: string;
  department_id: number | null;
  expected_join_date: string | null;
  expires_at: string | null;
  org_name: string;
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
  const genderOpts = [
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Other', label: 'Other' },
    { value: 'Prefer not to say', label: 'Prefer not to say' },
  ];

  // Per-step validators
  const validateStep1 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!firstName.trim())  e.first_name  = 'First name is required';
    if (!lastName.trim())   e.last_name   = 'Last name is required';
    if (!gender)            e.gender      = 'Gender is required';
    if (!dob)               e.date_of_birth = 'Date of birth is required';
    if (!nationality)       e.nationality_country_id = 'Nationality is required';
    if (!workCountry)       e.work_country_id = 'Work country is required';
    if (!mobile.trim())     e.mobile      = 'Mobile is required';
    return e;
  };
  const validateStep2 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!curAddr1.trim())   e.address_line1 = 'Address Line 1 is required';
    if (!curCity.trim())    e.city          = 'City is required';
    if (!curCountry)        e.country_id    = 'Country is required';
    if (!curState)          e.state_id      = 'State is required';
    if (!curPin.trim())     e.pincode       = 'Pincode is required';
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

  // Step indicator
  const stepIndicator = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderBottom: '1px solid #eef0f4', background: '#fff' }}>
      {([1, 2, 3] as StepNum[]).map((n, i) => {
        const active = step === n;
        const done2  = step > n;
        const labels: Record<StepNum, string> = { 1: 'PERSONAL', 2: 'ADDRESS', 3: 'JOB & SUBMIT' };
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800,
              background: done2 ? '#0ab39c' : active ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : '#f1f3f7',
              color: done2 || active ? '#fff' : '#9ca3af',
              border: done2 || active ? 'none' : '2px solid #e5e7eb',
            }}>
              {done2 ? '✓' : n}
            </div>
            <span style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
              color: active ? '#5a3fd1' : done2 ? '#0a8a78' : '#9ca3af',
              textTransform: 'uppercase',
            }}>{labels[n]}</span>
            {i < 2 && <div style={{ width: 32, height: 2, background: done2 ? '#0ab39c' : '#e5e7eb', margin: '0 4px' }} />}
          </div>
        );
      })}
    </div>
  );

  const sectionStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #eef0f4', borderRadius: 12,
    padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
  };
  const sectionTitleStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 13.5, fontWeight: 700, color: '#1f2937', marginBottom: 14,
  };

  return (
    <>
      <MasterFormStyles />
      <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
        <style>{`
          .onb-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: #1f2937; width: 100%; transition: border-color .15s ease, box-shadow .15s ease; }
          .onb-input::placeholder { color: #9ca3af; }
          .onb-input:focus { outline: none; border-color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.18); }
          .onb-input.is-invalid { border-color: #f06548; box-shadow: 0 0 0 3px rgba(240,101,72,0.12); }
          .onb-label { font-size: 10.5px; font-weight: 700; color: #5a3fd1; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 5px; display: block; }
          .onb-label .req { color: #f06548; margin-left: 2px; }
          .onb-err { display: block; color: #c43d20; font-size: 11px; font-weight: 500; margin-top: 4px; }
          .onb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
          @media (max-width: 720px) { .onb-grid { grid-template-columns: 1fr; } }
        `}</style>

        {/* Hero */}
        <div style={{ padding: '20px 22px', background: 'linear-gradient(120deg,#5a3fd1 0%,#7c5cfc 55%,#a78bfa 100%)', color: '#fff' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👋</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Welcome to {invite?.org_name}</h1>
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                Hi {invite?.invitee_name} · <strong>{invite?.invitee_email}</strong> · Step {step} of 3
              </p>
            </div>
          </div>
        </div>

        {/* Step indicator strip */}
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>{stepIndicator}</div>

        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 22px 24px' }}>

          {step === 1 && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}><i className="ri-user-line" style={{ color: '#7c5cfc', fontSize: 16 }} /> Personal Details</div>
              <div className="onb-grid">
                <div>
                  <label className="onb-label">First Name<span className="req">*</span></label>
                  <input className={`onb-input${errs.first_name ? ' is-invalid' : ''}`} value={firstName} onChange={e => { setFirstName(e.target.value); clearErr('first_name'); }} />
                  {errs.first_name && <small className="onb-err">{errs.first_name}</small>}
                </div>
                <div>
                  <label className="onb-label">Middle Name</label>
                  <input className="onb-input" value={middleName} onChange={e => setMiddleName(e.target.value)} />
                </div>
                <div>
                  <label className="onb-label">Last Name<span className="req">*</span></label>
                  <input className={`onb-input${errs.last_name ? ' is-invalid' : ''}`} value={lastName} onChange={e => { setLastName(e.target.value); clearErr('last_name'); }} />
                  {errs.last_name && <small className="onb-err">{errs.last_name}</small>}
                </div>
                <div>
                  <label className="onb-label">Gender<span className="req">*</span></label>
                  <MasterSelect value={gender} onChange={v => { setGender(v); clearErr('gender'); }} options={genderOpts} placeholder="Select gender" invalid={!!errs.gender} />
                  {errs.gender && <small className="onb-err">{errs.gender}</small>}
                </div>
                <div>
                  <label className="onb-label">Date of Birth<span className="req">*</span></label>
                  <MasterDatePicker value={dob} onChange={v => { setDob(v); clearErr('date_of_birth'); }} placeholder="dd-mm-yyyy" invalid={!!errs.date_of_birth} />
                  {errs.date_of_birth && <small className="onb-err">{errs.date_of_birth}</small>}
                </div>
                <div>
                  <label className="onb-label">Nationality<span className="req">*</span></label>
                  <MasterSelect value={nationality} onChange={v => { setNationality(v); clearErr('nationality_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.nationality_country_id} />
                  {errs.nationality_country_id && <small className="onb-err">{errs.nationality_country_id}</small>}
                </div>
                <div>
                  <label className="onb-label">Work Country<span className="req">*</span></label>
                  <MasterSelect value={workCountry} onChange={v => { setWorkCountry(v); clearErr('work_country_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.work_country_id} />
                  {errs.work_country_id && <small className="onb-err">{errs.work_country_id}</small>}
                </div>
                <div>
                  <label className="onb-label">Mobile Number<span className="req">*</span></label>
                  <input className={`onb-input${errs.mobile ? ' is-invalid' : ''}`} value={mobile} onChange={e => { setMobile(e.target.value); clearErr('mobile'); }} placeholder="10-digit mobile" />
                  {errs.mobile && <small className="onb-err">{errs.mobile}</small>}
                </div>
                <div>
                  <label className="onb-label">Alternate Mobile</label>
                  <input className="onb-input" value={altMobile} onChange={e => setAltMobile(e.target.value)} placeholder="(optional)" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <>
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}><i className="ri-map-pin-line" style={{ color: '#7c5cfc', fontSize: 16 }} /> Current Address</div>
                <div className="onb-grid">
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="onb-label">Address Line 1<span className="req">*</span></label>
                    <input className={`onb-input${errs.address_line1 ? ' is-invalid' : ''}`} value={curAddr1} onChange={e => { setCurAddr1(e.target.value); clearErr('address_line1'); }} />
                    {errs.address_line1 && <small className="onb-err">{errs.address_line1}</small>}
                  </div>
                  <div>
                    <label className="onb-label">Address Line 2</label>
                    <input className="onb-input" value={curAddr2} onChange={e => setCurAddr2(e.target.value)} placeholder="(optional)" />
                  </div>
                  <div>
                    <label className="onb-label">City<span className="req">*</span></label>
                    <input className={`onb-input${errs.city ? ' is-invalid' : ''}`} value={curCity} onChange={e => { setCurCity(e.target.value); clearErr('city'); }} />
                    {errs.city && <small className="onb-err">{errs.city}</small>}
                  </div>
                  <div>
                    <label className="onb-label">Country<span className="req">*</span></label>
                    <MasterSelect value={curCountry} onChange={v => { setCurCountry(v); if (curState) setCurState(''); clearErr('country_id'); clearErr('state_id'); }} options={countryOpts} placeholder="Select country" invalid={!!errs.country_id} />
                    {errs.country_id && <small className="onb-err">{errs.country_id}</small>}
                  </div>
                  <div>
                    <label className="onb-label">State<span className="req">*</span></label>
                    <MasterSelect value={curState} onChange={v => { setCurState(v); clearErr('state_id'); }} options={curStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={curCountry ? 'Select state' : 'Pick country first'} disabled={!curCountry} invalid={!!errs.state_id} />
                    {errs.state_id && <small className="onb-err">{errs.state_id}</small>}
                  </div>
                  <div>
                    <label className="onb-label">Pincode<span className="req">*</span></label>
                    <input className={`onb-input${errs.pincode ? ' is-invalid' : ''}`} value={curPin} onChange={e => { setCurPin(e.target.value); clearErr('pincode'); }} />
                    {errs.pincode && <small className="onb-err">{errs.pincode}</small>}
                  </div>
                </div>
              </div>

              <div style={{ ...sectionStyle, marginTop: 14 }}>
                <div style={{ ...sectionTitleStyle, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i className="ri-home-4-line" style={{ color: '#7c5cfc', fontSize: 16 }} /> Permanent Address</div>
                  <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={sameAsCurrent} onChange={e => {
                      const c = e.target.checked;
                      setSameAsCurrent(c);
                      if (c) { setPermAddr1(curAddr1); setPermAddr2(curAddr2); setPermCity(curCity); setPermCountry(curCountry); setPermState(curState); setPermPin(curPin); }
                    }} /> Same as Current Address
                  </label>
                </div>
                <div className="onb-grid">
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="onb-label">Address Line 1</label>
                    <input className="onb-input" value={permAddr1} onChange={e => setPermAddr1(e.target.value)} disabled={sameAsCurrent} />
                  </div>
                  <div>
                    <label className="onb-label">Address Line 2</label>
                    <input className="onb-input" value={permAddr2} onChange={e => setPermAddr2(e.target.value)} disabled={sameAsCurrent} />
                  </div>
                  <div>
                    <label className="onb-label">City</label>
                    <input className="onb-input" value={permCity} onChange={e => setPermCity(e.target.value)} disabled={sameAsCurrent} />
                  </div>
                  <div>
                    <label className="onb-label">Country</label>
                    <MasterSelect value={permCountry} onChange={v => { setPermCountry(v); if (permState) setPermState(''); }} options={countryOpts} placeholder="Select country" disabled={sameAsCurrent} />
                  </div>
                  <div>
                    <label className="onb-label">State</label>
                    <MasterSelect value={permState} onChange={setPermState} options={permStates.map(s => ({ value: String(s.id), label: s.name }))} placeholder={permCountry ? 'Select state' : 'Pick country first'} disabled={sameAsCurrent || !permCountry} />
                  </div>
                  <div>
                    <label className="onb-label">Pincode</label>
                    <input className="onb-input" value={permPin} onChange={e => setPermPin(e.target.value)} disabled={sameAsCurrent} />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}><i className="ri-briefcase-line" style={{ color: '#7c5cfc', fontSize: 16 }} /> Job Details (set by HR — confirm or update)</div>
              <div className="onb-grid">
                <div>
                  <label className="onb-label">Department</label>
                  <MasterSelect value={departmentId} onChange={setDepartmentId} options={departmentOpts} placeholder="Select department" />
                </div>
                <div>
                  <label className="onb-label">Designation</label>
                  <MasterSelect value={designationId} onChange={setDesignationId} options={designationOpts} placeholder="Select designation" />
                </div>
                <div>
                  <label className="onb-label">Primary Role</label>
                  <MasterSelect value={primaryRoleId} onChange={setPrimaryRoleId} options={roleOpts} placeholder="Select role" />
                </div>
                <div>
                  <label className="onb-label">Legal Entity</label>
                  <MasterSelect value={legalEntityId} onChange={v => {
                    setLegalEntityId(v);
                    const ent = legalEntities.find(le => String(le.id) === String(v));
                    setLocation(ent?.city || '');
                  }} options={legalEntityOpts} placeholder="Select entity" />
                </div>
                <div>
                  <label className="onb-label">Location</label>
                  <input className="onb-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="City / office" />
                </div>
                <div>
                  <label className="onb-label">Joining Date</label>
                  <MasterDatePicker value={joiningDate} onChange={setJoiningDate} placeholder="dd-mm-yyyy" />
                </div>
              </div>
            </div>
          )}

          {/* Footer — Back / Next / Submit */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 0 8px', marginTop: 14,
          }}>
            {step > 1 ? (
              <button
                type="button" onClick={goBack}
                className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                style={{ fontSize: 13, background: '#fff', color: '#475569', border: '1px solid #e5e7eb', padding: '8px 16px' }}
              >
                <i className="ri-arrow-left-s-line" /> Back
              </button>
            ) : <span />}
            {step < 3 ? (
              <button
                type="button" onClick={goNext}
                className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                style={{
                  fontSize: 13, color: '#fff', border: 'none',
                  background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                  boxShadow: '0 6px 16px rgba(124,92,252,0.30)', padding: '10px 20px',
                }}
              >
                Next <i className="ri-arrow-right-s-line" />
              </button>
            ) : (
              <button
                type="button" disabled={submitting} onClick={handleSubmit}
                className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                style={{
                  fontSize: 13, color: '#fff', border: 'none',
                  background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                  boxShadow: '0 6px 16px rgba(10,179,156,0.30)', padding: '10px 22px',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                <i className={submitting ? 'ri-loader-4-line' : 'ri-check-line'} /> {submitting ? 'Submitting…' : 'Submit Onboarding'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
