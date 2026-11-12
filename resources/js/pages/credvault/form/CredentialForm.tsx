import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type Attachment, type CredentialDetail, type FieldDef, type Loose, type Meta, type Risk, type TypeDef } from '../cvApi';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';
import ExpiryPicker from './ExpiryPicker';
import { Svg, bytes, cap, copyText, errMsg } from '../shared';
import CrdSelect, { type CrdOption } from './CrdSelect';
import {
  DOMAIN_CHARS, HOLDER_CHARS, HOST_CHARS, PHONE_CHARS, STR_LBL, checkField, emailError, fieldMax, fieldSpan, fillRows, hasTwofaSwitch, phoneError,
  policyStrengthMsg, secretIsPassword, strengthOf, typeColor,
} from './formHelpers';
import { quickPassword } from '../generator';
import {
  AUTH_EMPTY, AuthBox, CP_I, GMAIL_EMPTY, ProtectionBody, TwofaCard, TwofaPicker, authLinked,
  type AuthState, type GmailState, type ProtectionValue,
} from './ProtectionSection';

export interface FormInit {
  critical?: boolean; prefillPassword?: string; scope?: 'personal' | 'team'; departmentId?: number | null;
}

const SHIELD_CHECK = '<path d="M9 12l2 2 4-4M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22"/>';
const KEEP = 'Leave blank to keep the saved value';

function normKey(k: string): string {
  if (k.startsWith('files.')) return 'fields.' + k.slice(6);
  if (/^attachments\.\d+$/.test(k) || k.startsWith('remove_attachments')) return 'attachments';
  if (k === 'totp_secret') return 'totp_code';
  return k;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD day moved by n days, in the same format. */
const shiftDay = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Today 18 years ago (YYYY-MM-DD): the latest Date of Birth an adult can have. 29 Feb falls back to 28 Feb. */
const adultCutoff = () => {
  const t = new Date();
  const d = new Date(t.getFullYear() - 18, t.getMonth(), t.getDate());
  if (d.getMonth() !== t.getMonth()) d.setDate(0);
  return isoOf(d);
};
/** Date of Birth (CS-1437): not today or later, and at least 18 years ago. */
const dobError = (v: string) =>
  !ISO_DAY.test(v) ? null
    : v >= isoOf(new Date()) ? 'Date of birth cannot be today or a future date'
    : v > adultCutoff() ? 'You must be at least 18 years old' : null;

/** Date of Expiry on or before Date of Issue is a clash (both YYYY-MM-DD, which compare as text). */
const expiryError = (issue: string, expiry: string) =>
  ISO_DAY.test(issue) && ISO_DAY.test(expiry) && expiry <= issue
    ? (expiry === issue ? 'Date of Expiry cannot be the same as the Date of Issue' : 'Date of Expiry must be later than the Date of Issue')
    : null;

/**
 * ID-number rules (CS-1437, My Vault): Driver License number, and the SSN / Aadhaar / PAN number by its ID Type.
 * Each has a typing filter (`clean`), a length cap and a check. Spaces are separators and are not counted.
 */
type IdRule = { clean: (raw: string) => string; max: number; numeric?: boolean; ph?: string; error: (v: string) => string | null };
const oneSpace = (s: string) => s.replace(/^ +/, '').replace(/ {2,}/g, ' ');
const ID_RULES: Record<string, IdRule> = {
  driver: {
    clean: raw => oneSpace(raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '')), max: 19,
    error: v => {
      const c = v.replace(/\s/g, '');
      if (!/^[A-Za-z0-9]+$/.test(c)) return 'License number can have letters and numbers only';
      if (c.length < 15 || c.length > 16) return 'License number must be 15–16 characters, e.g. MH12 20110012345';
      if (!/[A-Za-z]/.test(c) || !/\d/.test(c)) return 'License number must include both letters and numbers';
      return null;
    },
  },
  Aadhaar: {
    clean: raw => oneSpace(raw.replace(/[^\d ]/g, '')), max: 14, numeric: true, ph: 'e.g. 1234 5678 9012',
    error: v => {
      const c = v.replace(/\s/g, '');
      if (!/^\d+$/.test(c)) return 'Aadhaar number can have digits only';
      return c.length === 12 ? null : 'Aadhaar number must be exactly 12 digits';
    },
  },
  PAN: {
    clean: raw => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), max: 10, ph: 'e.g. ABCDE1234F',
    error: v => {
      if (!/^[A-Za-z0-9]+$/.test(v)) return 'PAN can have letters and numbers only';
      if (v.length !== 10) return 'PAN must be exactly 10 characters, e.g. ABCDE1234F';
      return /^[A-Z]{5}\d{4}[A-Z]$/i.test(v) ? null : 'PAN must be 5 letters, 4 digits and 1 letter, e.g. ABCDE1234F';
    },
  },
};
const idRuleFor = (type: string, key: string, idtype?: string): IdRule | null =>
  key !== 'number' ? null : type === 'driver' ? ID_RULES.driver : type === 'govid' && idtype ? ID_RULES[idtype] ?? null : null;

function Lbl({ text, req, badge }: { text: string; req?: boolean; badge?: ReactNode }) {
  return <label className="mapsup-flabel">{text}{req && <> <span className="req">*</span></>}{badge && <> {badge}</>}</label>;
}
const Opt = () => <span className="crd-opt">Optional</span>;
const Err = ({ msg }: { msg?: string }) => <span className="crd-err cv-ferr">{msg ?? ''}</span>;

function Section({ ico, title, sub, items, wide, after }: {
  ico: string; title: string; sub: string; wide: boolean; after?: ReactNode;
  items: { span: number; render: (style: CSSProperties | undefined) => ReactNode }[];
}) {
  const spans = wide ? fillRows(items.map(i => i.span)) : null;
  return (
    <div className="mapsup-section">
      <div className="mapsup-seccard">
        <div className="mapsup-sechead">
          <span className="mapsup-sechead__ico"><Svg icon={ico} d={ico.startsWith('<') ? ico : undefined} size={14} /></span>
          <div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">{title}</span><span className="mapsup-sechead__sub">{sub}</span></div>
          <span className="mapsup-sechead__line" />
        </div>
        <div className="mapsup-fgrid">
          {items.map((it, i) => <span key={i} style={{ display: 'contents' }}>{it.render(spans ? { gridColumn: `span ${spans[i]}` } : undefined)}</span>)}
        </div>
        {after}
      </div>
    </div>
  );
}

/* The 2FA "Gmail" inbox can be any real mailbox (dev@inhpl.com, a team inbox…), not only
   @gmail.com: the API sends the code to whatever passes email:rfc. Same check as every other
   email field in the form. */
const OTP_EMAIL_MSG = 'Enter a valid email address, e.g. name@company.com';
const otpEmailOk = (v: string) => !!v.trim() && !emailError(v);
const PROTECT_HINT ='Only the owner or a Vault Admin can change this.';
const LOCKED_STYLE: CSSProperties = { opacity: .6, cursor: 'not-allowed' };

const fileIco = (n: string) => {
  const e = (n.split('.').pop() || '').toLowerCase();
  return /^(png|jpe?g|gif|webp)$/.test(e) ? 'img' : e === 'pdf' ? 'pdf' : /^(xlsx?|csv)$/.test(e) ? 'xls' : 'doc';
};

export default function CredentialForm({ meta, T, detail, init, preview = false, onClose, onSaved, onChangeType }: {
  meta: Meta; T: TypeDef; detail: CredentialDetail | null; init: FormInit;
  preview?: boolean;
  onClose: () => void; onSaved: (c: CredentialDetail) => void; onChangeType?: () => void;
}) {
  const toast = useToast();
  const pol = meta.policy;
  const editing = !!detail;
  const locked = editing && !detail!.fields;
  const canProtect = !editing || !!detail!.can?.edit_protection;
  const isPw = secretIsPassword(T);
  const toggleField = T.fields.find(f => f.key === 'twofa' && f.kind === 'toggle');
  const ex = T.extras;
  const dField = useMemo(() => new Map((detail?.fields ?? []).map(f => [f.key, f])), [detail]);
  const prefillKey = !editing && init.prefillPassword
    ? (T.fields.find(f => f.kind === 'password') ?? T.fields.find(f => f.kind === 'secret'))?.key ?? null
    : null;
  const startCritical = !editing && !!init.critical;

  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    T.fields.forEach(f => {
      if (f.kind === 'file') return;
      if (f.kind === 'toggle') v[f.key] = detail?.twofa === 'yes' ? 'yes' : 'no';
      else v[f.key] = detail ? (detail.all_values?.[f.key] ?? (!f.secret || preview ? dField.get(f.key)?.value : null) ?? '') : '';
    });
    if (prefillKey) v[prefillKey] = init.prefillPassword!;
    return v;
  });
  const [name, setName] = useState(detail?.name ?? '');
  const [risk, setRisk] = useState<Risk>(detail?.risk ?? (init.critical ? 'critical' : T.risk === 'critical' ? 'high' : T.risk));
  const [rotation, setRotation] = useState(detail ? String(detail.rotation_days ?? '') : String(pol.rotation_default ?? ''));
  const [twofa, setTwofa] = useState(detail?.twofa === 'yes');
  const [notes, setNotes] = useState(detail?.notes ?? '');
  const [regEmail, setRegEmail] = useState(detail?.recovery?.reg_email ?? '');
  const [regPhone, setRegPhone] = useState(detail?.recovery?.reg_phone ?? '');
  const [rkey, setRkey] = useState(detail?.all_values?.recovery_key ?? detail?.recovery?.recovery_key ?? '');
  const scope: 'personal' | 'team' = detail?.scope ?? init.scope ?? 'personal';
  const deptId = String(detail?.department?.id ?? init.departmentId ?? meta.me.department_id ?? '');
  const [fieldFiles, setFieldFiles] = useState<Record<string, File>>({});
  const [attNew, setAttNew] = useState<{ file: File; url: string }[]>([]);
  const [attKeep, setAttKeep] = useState<Attachment[]>(detail?.attachments ?? []);
  const [attRemoved, setAttRemoved] = useState<string[]>([]);
  const [shown, setShown] = useState<Set<string>>(() => new Set(prefillKey ? [prefillKey] : []));
  const [generated, setGenerated] = useState<Set<string>>(() => new Set(prefillKey ? [prefillKey] : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [code, setCode] = useState(detail?.code ?? '');
  const [wide, setWide] = useState(() => window.innerWidth > 980);

  const wasCritical = detail?.risk === 'critical';
  const inCritical = !!init.critical || wasCritical;
  const addFromCritical = !!init.critical && !detail;
  // Searchable dropdowns with risk dots: only when the form is opened from the Critical Vault or the
  // Team Vault. My Vault and Password Health keep the plain list.
  const richSel = !!init.critical || init.scope === 'team';
  const P = detail?.protection;
  const [prot, setProt] = useState<ProtectionValue>(() => ({
    admin: wasCritical && P ? P.admin : true,
    manager: wasCritical && P ? P.manager : true,
    otp: wasCritical && P ? P.otp : true,
  }));
  const policyGate = { admin: pol.cp_admin, manager: pol.cp_manager, otp: pol.cp_otp };

  const twofaOn = T.twofa ? twofa : toggleField ? vals.twofa === 'yes' : false;
  const critical = risk === 'critical';
  const twofaLocks = critical && hasTwofaSwitch(T);
  const needAuth = critical && canProtect && (twofaLocks ? twofaOn : prot.otp && pol.cp_otp);
  const [auth, setAuth] = useState<AuthState>(() => ({ ...AUTH_EMPTY, linkedOnServer: !!(P?.otp && P?.otp_linked) }));
  const [method, setMethod] = useState<'google' | 'email'>(P?.otp_method === 'email' ? 'email' : 'google');
  const [gmail, setGmail] = useState(P?.otp_email ?? '');
  const gmailOk = otpEmailOk(gmail);
  const [gm, setGm] = useState<GmailState>(GMAIL_EMPTY);
  const [verifying, setVerifying] = useState(false);
  const verifiedAt = useRef(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const r = () => setWide(window.innerWidth > 980);
    window.addEventListener('resize', r);
    const t = setTimeout(() => nameRef.current?.focus(), 30);
    return () => { window.removeEventListener('resize', r); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (editing) return;
    let on = true;
    cvApi.nextCode(!!init.critical).then(c => { if (on) setCode(c); }).catch(() => { if (on) setCode('Auto'); });
    return () => { on = false; };
  }, [editing]);

  useEffect(() => {
    if (prefillKey === null && init.prefillPassword && !editing) {
      toast.warning(`${T.label} has no password field — generated password not used`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSecret = () => {
    setAuth(a => ({ ...a, loading: true, failed: null }));
    const label = `${code && code !== 'Auto' ? code : 'Credential'}${name.trim() ? ' · ' + name.trim() : ''}`;
    cvApi.newAuthenticator(label)
      .then(d => setAuth(a => ({ ...a, loading: false, secret: d.secret, display: d.secret_display, uri: d.otpauth_uri, code: '', error: '' })))
      .catch(e => setAuth(a => ({ ...a, loading: false, failed: errMsg(e, 'Could not prepare a setup key.') })));
  };
  useEffect(() => {
    if (needAuth && method === 'google' && !authLinked(auth) && !auth.secret && !auth.loading && !auth.failed) fetchSecret();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needAuth, method, auth.linkedOnServer, auth.verified, auth.secret, auth.loading, auth.failed]);

  const attUrls = useRef<{ url: string }[]>([]);
  attUrls.current = attNew;
  useEffect(() => () => attUrls.current.forEach(a => URL.revokeObjectURL(a.url)), []);

  const snap = (): Record<string, string> => {
    const s: Record<string, string> = {
      name, risk, rotation_days: rotation, twofa: String(twofa), notes, reg_email: regEmail, reg_phone: regPhone,
      recovery_key: rkey, scope, department_id: scope === 'team' ? deptId : '',
      attachments: `${attNew.length}/${attRemoved.length}`,
      lock_admin: String(prot.admin), lock_manager: String(prot.manager), lock_otp: String(prot.otp),
      totp_code: String(auth.verified), twofa_email: `${method}|${gmail.trim()}`,
    };
    T.fields.forEach(f => { s['fields.' + f.key] = f.kind === 'file' ? (fieldFiles[f.key]?.name ?? '') : (vals[f.key] ?? ''); });
    return s;
  };
  const orig = useRef<Record<string, string> | null>(null);
  const now = snap();
  if (!orig.current) orig.current = now;
  const changed = (k: string) => editing && orig.current![k] !== now[k];
  const changedCount = editing ? Object.keys(now).filter(k => orig.current![k] !== now[k]).length : 0;
  const dirty = Object.keys(now).some(k => orig.current![k] !== now[k]);
  const askClose = () => onClose();

  const clr = (k: string) => setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  const setVal = (k: string, v: string) => { setVals(s => ({ ...s, [k]: v })); clr('fields.' + k); };
  const ffCls = (k: string, extra = '') => `mapsup-ffield${extra}${errors[k] ? ' is-err' : ''}${changed(k) ? ' is-edited' : ''}`;
  const jump = (k: string) => {
    const el = bodyRef.current?.querySelector(`[data-f="${CSS.escape(k)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const copyField = (v: string, label?: string) => {
    if (!v) { toast.warning('Nothing to copy yet'); return; }
    copyText(v).then(() => toast.success(label && !inCritical ? `${label} copied` : 'Copied to clipboard')).catch(() => toast.error('Could not copy — your browser blocked the clipboard'));
  };

  const fieldItem = (f: FieldDef) => {
    const k = 'fields.' + f.key;
    const span = fieldSpan(f);
    const had = !!dField.get(f.key)?.has_value || locked;
    const keep = editing && f.secret && had;
    // Driver License / Aadhaar / PAN number (CS-1437): its own characters only — the rest are dropped as typed.
    // CS-1456: the Critical Vault runs the same field checks as My Vault (they were My-Vault-only).
    const idRule = idRuleFor(T.key, f.key, vals.idtype);
    const ph = keep ? KEEP : (idRule?.ph ?? f.placeholder ?? '');
    const cls = `mapsup-finput has-ico${f.mono ? ' crd-mono' : ''}`;
    const baseCls = span === 4 ? ' mapsup-span-full' : span === 2 ? ' crd-span2' : '';
    const val = vals[f.key] ?? '';
    const onText = (raw: string) => {
      // Account Number keeps digits only: letters, spaces and symbols are dropped as they are typed or pasted.
      const v = f.key === 'acno' ? raw.replace(/\D/g, '').slice(0, 18)
        // Card Number (CS-1456 #1): digits only, up to 19 — the spaces it is shown with are not stored, so
        // they no longer eat into the 19-character limit (a 19-digit card could not be typed with them).
        : f.key === 'cardno' ? raw.replace(/\D/g, '').slice(0, 19)
        : idRule ? idRule.clean(raw)
        // CS-1457 #12 / #14: Hostname / IP and the certificate domain drop _ and symbols as they are typed.
        : f.key === 'host' ? HOST_CHARS(raw)
        // CS-1456 #2: Account Holder / Cardholder take no digits — they are dropped as typed or pasted.
        : f.key === 'holder' ? HOLDER_CHARS(raw)
        : f.key === 'domain' && T.key === 'cert' ? DOMAIN_CHARS(raw)
        : f.kind === 'tel' ? PHONE_CHARS(raw) : f.upper ? raw.toUpperCase() : raw;
      setVal(f.key, v);
      if (errors[k] && (f.kind === 'email' || f.kind === 'tel')) {
        const m = v.trim() ? checkField(f, v.trim(), true) : null;
        if (m) setErrors(e => ({ ...e, [k]: m }));
      }
    };
    const onLeave = () => {
      const v = (vals[f.key] ?? '').trim();
      const m = !v ? null
        : f.kind === 'email' || f.kind === 'tel' || f.key === 'host' || (f.key === 'domain' && T.key === 'cert') ? checkField(f, v, true)
        : idRule ? idRule.error(v) : null;
      if (m) setErrors(e => ({ ...e, [k]: m }));
    };
    // The asterisk stays in Edit too (CS-1436): a saved secret or file still counts, so leaving it blank keeps it.
    const req = f.required && (!inCritical || !(editing && had && (f.secret || f.kind === 'file')));

    return {
      span,
      render: (style: CSSProperties | undefined) => {
        if (f.kind === 'toggle') {
          const on = val === 'yes';
          return (
            <div className={ffCls(k, baseCls)} data-f={k} style={style}>
              <Lbl text={f.label} req={f.required} />
              <label className={`crd-tg${on ? ' is-on' : ''}`} title={canProtect ? undefined : PROTECT_HINT} style={canProtect ? undefined : LOCKED_STYLE}>
                <input type="checkbox" checked={on} disabled={!canProtect} onChange={e => setVal(f.key, e.target.checked ? 'yes' : 'no')} />
                <span className="crd-tg__sw"><i /></span><span className="crd-tg__st">{on ? 'Enabled' : 'Disabled'}</span>
              </label>
              <Err msg={errors[k]} />
            </div>
          );
        }
        if (f.kind === 'file') {
          const picked = fieldFiles[f.key];
          const existing = dField.get(f.key)?.value;
          const txt = picked?.name ?? existing ?? 'Click to upload';
          const accept = meta.file_types.file_fields.map(x => '.' + x).join(',');
          return (
            <div className={ffCls(k, baseCls)} data-f={k} style={style}>
              <Lbl text={f.label} req={req} />
              <label className={`crd-file${picked || existing ? ' has-file' : ''}`}>
                <input type="file" accept={accept} onChange={e => {
                  const file = e.target.files?.[0];
                  if (file && file.size > meta.file_types.max_mb * 1048576) {
                    e.target.value = '';
                    setErrors(x => ({ ...x, [k]: `File must be ${meta.file_types.max_mb} MB or smaller` }));
                    toast.warning(`File must be ${meta.file_types.max_mb} MB or smaller`);
                    return;
                  }
                  setFieldFiles(s => { const n = { ...s }; if (file) n[f.key] = file; else delete n[f.key]; return n; });
                  clr(k);
                }} />
                <span className="crd-file__ico"><Svg icon="up" size={14} /></span>
                <span className="crd-file__txt">{txt}</span>
                <span className="crd-file__hint">{f.placeholder ?? ''}</span>
              </label>
              <Err msg={errors[k]} />
            </div>
          );
        }
        let ctl: ReactNode;
        let meter: ReactNode = null;
        let wrapCls = 'mapsup-inputwrap';
        if (f.kind === 'select') {
          ctl = (
            <CrdSelect id={`crdF_${f.key}`} value={val} onChange={v => setVal(f.key, v)}
              options={[{ value: '', label: 'Select…' }, ...(f.options ?? []).map(o => ({ value: o, label: o }))]} rich={richSel} />
          );
        } else if (f.kind === 'textarea') {
          // A masked textarea (Secure Note, Private Key, Seed…) gets the eye and copy buttons (CS-1438) — in the
          // Critical Vault too: typing into dots with no way to check them hid the note from its own author.
          const eye = !!f.secret;
          const vis = eye && shown.has(f.key);
          if (eye) wrapCls += ' crd-pw crd-pw--ta';
          ctl = (
            <>
              <textarea id={`crdF_${f.key}`} className={`${cls} crd-ta${f.secret && !vis ? ' crd-secret-ta' : ''}${eye ? ' crd-pw__in' : ''}`} rows={3} value={val}
                placeholder={ph} maxLength={fieldMax(f)} autoComplete="off" onChange={e => onText(e.target.value)} />
              {eye && (
                <span className="crd-pw__btns">
                  <button type="button" data-h40="skip" className={`crd-pw__b${vis ? ' is-on' : ''}`} title={vis ? `Hide ${f.label}` : `Show ${f.label}`}
                    onClick={() => setShown(s => { const n = new Set(s); if (vis) n.delete(f.key); else n.add(f.key); return n; })}>
                    <Svg icon={vis ? undefined : 'eye'} d={vis ? EYE_OFF : undefined} size={14} />
                  </button>
                  <button type="button" data-h40="skip" className="crd-pw__b" title={`Copy ${f.label}`} onClick={() => copyField(val, f.label)}><Svg icon="copy" size={14} /></button>
                </span>
              )}
            </>
          );
        } else if (f.kind === 'password' || f.kind === 'secret') {
          const vis = shown.has(f.key);
          wrapCls += ' crd-pw';
          ctl = (
            <>
              <input id={`crdF_${f.key}`} type={vis ? 'text' : 'password'} className={`${cls} crd-pw__in${f.kind === 'password' ? ' crd-pw__in--3' : ''}`}
                value={f.key === 'cardno' ? val.replace(/(\d{4})(?=\d)/g, '$1 ') : val} placeholder={ph}
                maxLength={f.key === 'acno' ? 18 : f.key === 'cardno' ? 23 /* 19 digits + 4 group spaces */ : idRule ? idRule.max : fieldMax(f)} autoComplete="new-password"
                inputMode={f.key === 'acno' || f.key === 'cardno' || idRule?.numeric ? 'numeric' : undefined}
                onBlur={onLeave}
                onChange={e => { onText(e.target.value); if (generated.has(f.key)) setGenerated(g => { const n = new Set(g); n.delete(f.key); return n; }); }} />
              <span className="crd-pw__btns">
                <button type="button" data-h40="skip" className={`crd-pw__b${vis ? ' is-on' : ''}`} title={vis ? 'Hide' : 'Show / hide'}
                  onClick={() => setShown(s => { const n = new Set(s); if (vis) n.delete(f.key); else n.add(f.key); return n; })}>
                  <Svg icon={vis ? undefined : 'eye'} d={vis ? EYE_OFF : undefined} size={14} />
                </button>
                <button type="button" data-h40="skip" className="crd-pw__b" title={inCritical ? 'Copy' : `Copy ${f.label}`} onClick={() => copyField(val, f.label)}><Svg icon="copy" size={14} /></button>
                {f.kind === 'password' && (
                  <button type="button" data-h40="skip" className="crd-pw__b crd-pw__b--gen" title="Generate a strong password"
                    onClick={() => {
                      setVal(f.key, quickPassword());
                      setShown(s => new Set(s).add(f.key));
                      setGenerated(g => new Set(g).add(f.key));
                    }}>
                    <Svg icon="gen" size={14} sw={2.4} />
                  </button>
                )}
              </span>
            </>
          );
          if (f.kind === 'password') {
            const sc = strengthOf(val);
            meter = (
              <div className="mv-meter crd-meter" data-s={sc}>
                <div className="mv-meter__bars"><i /><i /><i /><i /></div>
                <span className="mv-meter__lbl">{sc ? STR_LBL[sc] : 'Strength'}</span>
              </div>
            );
          }
        } else if (f.kind === 'date') {
          // Date of Issue → Date of Expiry (Passport, CS-1437): expiry must fall after issue, so each picker
          // greys out the other side's days and a clash is flagged at once. My Vault only.
          const paired = !inCritical && T.fields.some(x => x.key === 'issue') && T.fields.some(x => x.key === 'expiry')
            && (f.key === 'issue' || f.key === 'expiry');
          const other = paired ? vals[f.key === 'issue' ? 'expiry' : 'issue'] ?? '' : '';
          const bound = ISO_DAY.test(other) ? shiftDay(other, f.key === 'issue' ? -1 : 1) : undefined;
          // Date of Birth (CS-1437): 18 or older, so the latest day is today 18 years ago — Today and later are greyed out.
          const dob = !inCritical && f.key === 'dob';
          ctl = <MasterDatePicker value={val} placeholder={ph || 'Select date'} invalid={!!errors[k]} popupClassName="crd-cal"
            minDate={paired && f.key === 'expiry' ? bound : undefined}
            maxDate={dob ? adultCutoff() : paired && f.key === 'issue' ? bound : undefined}
            onChange={v => {
              onText(v);
              if (dob) { const m = dobError(v); if (m) setErrors(e => ({ ...e, [k]: m })); return; }
              if (!paired) return;
              const issue = f.key === 'issue' ? v : other, expiry = f.key === 'expiry' ? v : other;
              const m = expiryError(issue, expiry);
              if (m) setErrors(e => ({ ...e, 'fields.expiry': m })); else clr('fields.expiry');
            }} />;
        } else if (f.key === 'exp' && !inCritical) {
          // Credit Card expiry (MM/YY): typeable, and its calendar icon opens a month / year picker.
          ctl = <ExpiryPicker id={`crdF_${f.key}`} className={cls} value={val} placeholder={ph} onChange={onText} onBlur={onLeave} />;
        } else {
          ctl = (
            <input id={`crdF_${f.key}`} type={f.kind} className={cls} value={val} placeholder={ph}
              maxLength={f.kind === 'tel' ? 16 : f.kind === 'email' ? 191 : fieldMax(f)} autoComplete="off"
              inputMode={f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : undefined}
              onChange={e => onText(e.target.value)} onBlur={onLeave} />
          );
        }
        return (
          <div className={ffCls(k, baseCls + (generated.has(f.key) ? ' gp-filled' : ''))} data-f={k} style={style}>
            <Lbl text={f.label} req={req}
              badge={generated.has(f.key) && f.key === prefillKey
                ? <span className="mapsup-lock mapsup-lock--auto"><Svg icon="key" size={9} sw={2.6} /> Generated</span> : undefined} />
            <div className={wrapCls}>
              {f.kind !== 'date' && !(f.key === 'exp' && !inCritical) && <span className="mapsup-input-ico"><Svg icon={f.icon ?? 'tag'} size={13} /></span>}
              {ctl}
            </div>
            {meter}
            <Err msg={errors[k]} />
          </div>
        );
      },
    };
  };

  const frozen = (lbl: string, ico: string, value: string) => ({
    span: 1,
    render: (style: CSSProperties | undefined) => (
      <div className="mapsup-ffield" style={style}>
        <Lbl text={lbl} badge={<span className="mapsup-lock"><Svg icon="lock" size={9} sw={2.6} /> Auto</span>} />
        <div className={`mapsup-inputwrap is-frozen${inCritical ? '' : ' is-inert'}`}>
          <span className="mapsup-input-ico"><Svg icon={ico} size={13} /></span>
          <input className="mapsup-finput has-ico" type="text" value={value} readOnly tabIndex={inCritical ? undefined : -1} aria-readonly="true" />
          <span className="mapsup-freeze-ico"><Svg icon="lock" size={9} sw={2.6} /></span>
        </div>
      </div>
    ),
  });

  const selItem = (k: string, lbl: string, ico: string, req: boolean, value: string, options: CrdOption[], onChange: (v: string) => void, span = 1, lockedSel = false,
    onBlocked?: (o: { value: string; label: string }) => void) => ({
    span,
    render: (style: CSSProperties | undefined) => (
      <div className={ffCls(k)} data-f={k} style={style}>
        <Lbl text={lbl} req={req} />
        <div className="mapsup-inputwrap">
          <span className="mapsup-input-ico"><Svg icon={ico} size={13} /></span>
          <CrdSelect id={`crdF_${k}`} value={value} options={options} onChange={v => { onChange(v); clr(k); }} disabled={lockedSel} onBlocked={onBlocked} rich={richSel} />
        </div>
        {lockedSel ? <span className="cv-ferr" style={{ color: '#64748b' }}>{PROTECT_HINT}</span> : <Err msg={errors[k]} />}
      </div>
    ),
  });

  const s1 = [
    frozen('Credential ID', 'hash', code || '…'),
    {
      span: 1,
      render: (style: CSSProperties | undefined) => (
        <div className={ffCls('name')} data-f="name" style={style}>
          <Lbl text="Credential Name" req />
          <div className="mapsup-inputwrap">
            <span className="mapsup-input-ico"><Svg icon="tag" size={13} /></span>
            <input ref={nameRef} className="mapsup-finput has-ico" type="text" value={name} maxLength={150} autoComplete="off"
              placeholder={`e.g. ${T.key === 'login' ? 'Zoho Books Admin' : `${T.label} — ${T.key === 'bank' ? 'ICICI Current A/c' : 'Main'}`}`}
              onChange={e => { setName(e.target.value); clr('name'); }} />
          </div>
          <Err msg={errors.name} />
        </div>
      ),
    },
    frozen('Credential Category', 'folder', T.label),
    frozen('Owner', 'user', editing ? (detail!.owner.is_me ? meta.me.name : detail!.owner.name ?? '—') : meta.me.name),
  ];

  const maxAtt = meta.file_types.max_attachments;
  const attCount = attKeep.length + attNew.length;
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    clr('attachments');
    let count = attCount;
    const next: { file: File; url: string }[] = [];
    let err = '';
    Array.from(list).forEach(f => {
      if (count >= maxAtt) { err = `You can attach up to ${maxAtt} files`; return; }
      if (f.size > meta.file_types.max_mb * 1048576) { err = `“${f.name}” is larger than ${meta.file_types.max_mb} MB`; return; }
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!meta.file_types.attachments.includes(ext)) { err = `“${f.name}” is not a supported file type`; return; }
      if ([...attNew.map(a => a.file), ...next.map(a => a.file)].some(x => x.name === f.name && x.size === f.size)) return;
      next.push({ file: f, url: URL.createObjectURL(f) });
      count++;
    });
    if (next.length) setAttNew(a => [...a, ...next]);
    if (err) { setErrors(e => ({ ...e, attachments: err })); toast.warning(err); }
  };
  const xtItems: { span: number; render: (s: CSSProperties | undefined) => ReactNode }[] = [];
  const xtInp = (k: string, lbl: string, type: string, ph: string, ico: string, span: number, hint: string, value: string, set: (v: string) => void) => ({
    span,
    render: (style: CSSProperties | undefined) => (
      <div className={ffCls(k)} data-f={k} style={style}>
        <Lbl text={lbl} badge={<Opt />} />
        <div className="mapsup-inputwrap">
          <span className="mapsup-input-ico"><Svg icon={ico} size={13} /></span>
          <input className="mapsup-finput has-ico" type={type} value={value} placeholder={ph} autoComplete="off"
            maxLength={type === 'tel' ? 16 : 191} inputMode={type === 'tel' ? 'tel' : 'email'}
            onChange={e => {
              let v = type === 'tel' ? PHONE_CHARS(e.target.value) : e.target.value;
              // My Vault: spaces alone are not a value (no "Edited", no Update) — a phone can't start with or double a
              // space, and an email holds none at all.
              v = type === 'tel' ? v.replace(/^\s+/, '').replace(/\s{2,}/g, ' ') : v.replace(/\s/g, '');
              set(v);
              const m = errors[k] && v.trim() ? (type === 'tel' ? phoneError(v) : emailError(v)) : null;
              if (m) setErrors(x => ({ ...x, [k]: m })); else clr(k);
            }}
            onBlur={() => {
              const v = value.trim();
              const m = v ? (type === 'tel' ? phoneError(v) : emailError(v)) : null;
              if (m) setErrors(e => ({ ...e, [k]: m }));
            }} />
        </div>
        <span className="crd-hint">{hint}</span>
        <Err msg={errors[k]} />
      </div>
    ),
  });
  if (ex.reg_email) xtItems.push(xtInp('reg_email', 'Registered Email', 'email', 'e.g. accounts@inorbvict.com', 'mail', 2, 'The email this account is registered with', regEmail, setRegEmail));
  if (ex.reg_phone) xtItems.push(xtInp('reg_phone', 'Registered Phone', 'tel', '+91 98200 11223', 'phone', ex.reg_email ? 2 : 4,
    T.key === 'email' ? 'Phone linked to this mailbox for sign-in codes' : 'Mobile number that receives OTPs for this account', regPhone, setRegPhone));
  if (ex.recovery_key) {
    const vis = shown.has('_rkey');
    xtItems.push({
      span: 4,
      render: (style) => (
        <div className={ffCls('recovery_key')} data-f="recovery_key" style={style}>
          <Lbl text="Secret / Recovery Key" badge={<Opt />} />
          <div className="mapsup-inputwrap crd-pw">
            <span className="mapsup-input-ico"><Svg icon="key" size={13} /></span>
            <input type={vis ? 'text' : 'password'} className="mapsup-finput has-ico crd-pw__in crd-mono" value={rkey} autoComplete="new-password"
              placeholder={editing && (detail!.recovery?.has_recovery_key || locked) ? KEEP : 'Recovery key, backup code or security answer'}
              maxLength={500} onChange={e => { setRkey(e.target.value); clr('recovery_key'); }} />
            <span className="crd-pw__btns">
              <button type="button" data-h40="skip" className={`crd-pw__b${vis ? ' is-on' : ''}`} title={vis ? 'Hide' : 'Show / hide'}
                onClick={() => setShown(s => { const n = new Set(s); if (vis) n.delete('_rkey'); else n.add('_rkey'); return n; })}>
                <Svg icon={vis ? undefined : 'eye'} d={vis ? EYE_OFF : undefined} size={14} />
              </button>
              <button type="button" data-h40="skip" className="crd-pw__b" title={inCritical ? 'Copy' : 'Copy recovery key'} onClick={() => copyField(rkey, 'Recovery key')}><Svg icon="copy" size={14} /></button>
            </span>
          </div>
          <span className="crd-hint crd-hint--key"><Svg icon="shield" size={11} />Use this to get back into the account if the password is forgotten. It is encrypted like the password and every reveal is logged.</span>
          <Err msg={errors.recovery_key} />
        </div>
      ),
    });
  }
  if (ex.attachments) {
    xtItems.push({
      span: 4,
      render: () => (
        <div className={ffCls('attachments', ' mapsup-span-full')} style={{ gridColumn: '1/-1' }} data-f="attachments">
          <Lbl text="Attachments" badge={<span className="crd-opt">{attCount ? `${attCount} of ${maxAtt} files` : `Optional · up to ${maxAtt} files`}</span>} />
          <label className="crd-att"
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('is-over'); }}
            onDragLeave={e => e.currentTarget.classList.remove('is-over')}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); addFiles(e.dataTransfer.files); }}>
            <input type="file" multiple accept={meta.file_types.attachments.map(x => '.' + x).join(',')}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <span className="crd-att__ico"><Svg icon="up" size={16} /></span>
            <span className="crd-att__t">
              <b>Drop files or click to attach proof</b>
              <small>Screenshots, account letters, invoices or agreements · PDF, image, Word or Excel · up to {meta.file_types.max_mb} MB each</small>
            </span>
          </label>
          <div className="crd-att__list">
            {attKeep.map(a => {
              const k = fileIco(a.name);
              return (
                <div key={a.key} className={`crd-att__f crd-att__f--${k}`}>
                  <span className="crd-att__fi">{k.toUpperCase()}</span>
                  <div><b title={a.name}>{a.name}</b><small>{bytes(a.size)} · saved</small></div>
                  <button type="button" className="crd-att__b" title="Download"
                    onClick={() => cvApi.attachment(detail!.id, a.key).catch(e => toast.error('Download failed', errMsg(e)))}>
                    <Svg icon="eye" size={13} />
                  </button>
                  <button type="button" data-h40="skip" className="crd-att__b crd-att__b--x" title="Remove"
                    onClick={() => { setAttKeep(l => l.filter(x => x.key !== a.key)); setAttRemoved(r => [...r, a.key]); }}>
                    <Svg icon="x" size={12} sw={2.6} />
                  </button>
                </div>
              );
            })}
            {attNew.map((a, i) => {
              const k = fileIco(a.file.name);
              return (
                <div key={a.url} className={`crd-att__f crd-att__f--${k}`}>
                  <span className="crd-att__fi">{k.toUpperCase()}</span>
                  <div><b title={a.file.name}>{a.file.name}</b><small>{bytes(a.file.size)}</small></div>
                  <a className="crd-att__b" href={a.url} target="_blank" rel="noopener noreferrer" title="Open"><Svg icon="eye" size={13} /></a>
                  <button type="button" data-h40="skip" className="crd-att__b crd-att__b--x" title="Remove"
                    onClick={() => { URL.revokeObjectURL(a.url); setAttNew(l => l.filter((_, j) => j !== i)); }}>
                    <Svg icon="x" size={12} sw={2.6} />
                  </button>
                </div>
              );
            })}
          </div>
          <Err msg={errors.attachments} />
        </div>
      ),
    });
  }
  const xtParts: string[] = [];
  if (ex.reg_email || ex.reg_phone) xtParts.push('registered ' + (ex.reg_email ? 'email and phone' : 'phone'));
  if (ex.recovery_key) xtParts.push('a recovery key');
  if (ex.attachments) xtParts.push('supporting files');
  const xtSub = 'Optional — ' + xtParts.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' for this ' + T.label.toLowerCase();

  const nSec = 1 + (T.twofa ? 1 : 0) + (isPw ? 1 : 0);
  const s3 = [
    selItem('risk', 'Risk Level', 'shield', true, risk,
      // Adding from the Critical Vault offers every level, as the Figma (Critical is the default).
      // Editing in the Critical Vault lists every level too, but only Critical can be picked: the API
      // keeps a Critical Vault credential critical (CredVaultController:3186) and has no move to My Vault.
      // Elsewhere the form keeps its own vault's levels.
      meta.risks
        .filter(r => (addFromCritical || inCritical ? true : r.key !== 'critical'))
        .map(r => {
          const locked = inCritical && !addFromCritical && r.key !== 'critical';
          return { value: r.key, label: r.label, dot: r.key, disabled: locked, disabledReason: locked ? `${r.label} — only in My Vault` : undefined };
        }), v => setRisk(v as Risk), 1, !canProtect,
      // The lower levels read as normal rows; a click says why the level stays Critical here.
      o => toast.warning(`${o.label} risk is for My Vault`,
        'A Critical Vault credential always stays Critical. To keep it at a lower risk, add it to My Vault instead.')),
  ];
  if (isPw) {
    s3.push(selItem('rotation_days', 'Password Rotation', 'cal', false, rotation,
      meta.rotations.map(r => ({ value: String(r.days ?? ''), label: r.label })), setRotation));
  }
  if (T.twofa) {
    s3.push({
      span: 1,
      render: (style) => (
        <div className={ffCls('twofa')} data-f="twofa" style={style}>
          <Lbl text="2FA" />
          <label className={`crd-tg${twofa ? ' is-on' : ''}`} title={canProtect ? undefined : PROTECT_HINT} style={canProtect ? undefined : LOCKED_STYLE}>
            <input type="checkbox" checked={twofa} disabled={!canProtect} onChange={e => { setTwofa(e.target.checked); clr('twofa'); }} />
            <span className="crd-tg__sw"><i /></span><span className="crd-tg__st">{twofa ? 'Enabled' : 'Disabled'}</span>
          </label>
          <Err msg={errors.twofa} />
        </div>
      ),
    });
  }
  if (T.key !== 'note') {
    const sp = (4 - nSec) || 4;
    s3.push({
      span: sp,
      render: (style) => (
        <div className={ffCls('notes')} data-f="notes" style={style}>
          <Lbl text="Remark" />
          <div className="mapsup-inputwrap">
            <span className="mapsup-input-ico"><Svg icon="note" size={13} /></span>
            <textarea className="mapsup-finput has-ico crd-ta crd-ta--notes" rows={1} value={notes} maxLength={5000}
              placeholder={locked ? KEEP : 'Add a remark…'} onChange={e => { setNotes(e.target.value); clr('notes'); }} />
          </div>
          <Err msg={errors.notes} />
        </div>
      ),
    });
  }
  const secBits = ['risk level'];
  if (isPw) secBits.push('password rotation');
  if (T.twofa) secBits.push('2FA');
  secBits.push('remark');
  const secSub = secBits.slice(0, -1).join(', ').replace(/^./, c => c.toUpperCase()) + ' and ' + secBits[secBits.length - 1] + ' for this ' + T.label.toLowerCase();

  // POST two-step/google/verify — the save sends the same code again as totp_code.
  const verifyCode = async (): Promise<boolean> => {
    const c6 = auth.code.replace(/\s/g, '');
    if (!auth.secret) return false;
    if (c6.length !== 6) { setAuth(a => ({ ...a, error: 'Enter the 6-digit code shown in your authenticator app.' })); return false; }
    setVerifying(true);
    try {
      await cvApi.verifyAuthenticator(auth.secret, c6);
    } catch (e) {
      setAuth(a => ({ ...a, error: errMsg(e, 'That code is incorrect or expired. Check your app and try again.') }));
      return false;
    } finally {
      setVerifying(false);
    }
    verifiedAt.current = Date.now();
    setAuth(a => ({ ...a, verified: true, error: '' }));
    clr('totp_code');
    return true;
  };
  // POST two-step/email/send, then two-step/email/verify — the save sends the token as email_otp_token.
  const sendGmailCode = async () => {
    if (!gmailOk) { setErrors(e => ({ ...e, twofa_email: OTP_EMAIL_MSG })); return; }
    setGm(g => ({ ...g, sending: true, error: '' }));
    try {
      const d = await cvApi.emailSetupSend(gmail.trim().toLowerCase(), name.trim() || undefined);
      setGm({ ...GMAIL_EMPTY, token: d.token, sentTo: d.sent_to, wait: d.resend_in });
      toast.success(`Code sent to ${d.sent_to}`);
    } catch (e) {
      setGm(g => ({ ...g, sending: false }));
      setErrors(x => ({ ...x, twofa_email: errMsg(e, 'Could not send the code.') }));
    }
  };
  const verifyGmailCode = async () => {
    const c6 = gm.code.replace(/\s/g, '');
    if (!gm.token) return;
    if (c6.length !== 6) { setGm(g => ({ ...g, error: 'Enter the 6-digit code from the email.' })); return; }
    setGm(g => ({ ...g, verifying: true, error: '' }));
    try {
      const d = await cvApi.emailSetupVerify(gm.token, c6);
      setGm(g => ({ ...g, verifying: false, verified: true, sentTo: d.sent_to }));
      clr('email_otp_code');
    } catch (e) {
      setGm(g => ({ ...g, verifying: false, code: '', error: errMsg(e, 'Incorrect or expired code.') }));
    }
  };
  useEffect(() => {
    if (gm.wait <= 0) return;
    const t = setTimeout(() => setGm(g => ({ ...g, wait: Math.max(0, g.wait - 1) })), 1000);
    return () => clearTimeout(t);
  }, [gm.wait]);

  const authBox = (
    <AuthBox a={auth} verifying={verifying}
      onCode={c => setAuth(a => ({ ...a, code: c, error: '' }))}
      onVerify={() => { verifyCode().then(ok => { if (ok) toast.success('Authenticator app verified', 'It is linked to this credential when you save.'); }); }}
      onRelink={() => setAuth({ ...AUTH_EMPTY })}
      onRetry={fetchSecret}
      onCopyKey={() => { if (auth.secret) copyText(auth.secret).then(() => toast.success('Setup key copied')).catch(() => toast.error('Could not copy')); }} />
  );
  // The 2FA card sits under the section that holds the type's 2FA switch.
  const twofaReadOnly = editing && auth.linkedOnServer;
  const twofaChip = method === 'email'
    ? { ok: gm.verified, text: gm.verified ? 'Gmail verified' : gm.token ? 'Enter the code' : 'Gmail needed' }
    : { ok: authLinked(auth), text: authLinked(auth) ? 'App linked' : 'Scan to link' };
  // One Authenticator-or-Gmail picker: the Login-style 2FA card (types with a 2FA field) and
  // step 3 of Critical Access Protection (types without one) both use it, so every type offers Gmail.
  const pickerProps = {
    method, readOnly: twofaReadOnly, authBox,
    onMethod: (m: 'google' | 'email') => { setMethod(m); clr('twofa_email'); },
    gmail, gmailOk, gmailErr: errors.twofa_email,
    onGmail: (v: string) => { setGmail(v); setGm(GMAIL_EMPTY); if (otpEmailOk(v)) clr('twofa_email'); },
    gm, onSend: sendGmailCode, onGmCode: (c: string) => setGm(g => ({ ...g, code: c, error: '' })), onGmVerify: verifyGmailCode,
  };
  const twofaCard = twofaLocks && canProtect && twofaOn ? <TwofaCard {...pickerProps} chip={twofaChip} /> : null;
  const step3Picker = !twofaLocks ? <TwofaPicker {...pickerProps} /> : undefined;

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try { await submit(); } finally { savingRef.current = false; }
  };
  const submit = async () => {
    if (editing && !changedCount && !attNew.length && !attRemoved.length) { toast.info('No changes to update'); return; }
    const errs: Record<string, string> = {};
    const check = (k: string) => !editing || changed(k);
    if (!name.trim()) errs.name = 'Enter a name for this credential';
    else if (name.trim().length < 2) errs.name = 'The name needs at least 2 characters';
    // A name of symbols only (e.g. "@@@###") names nothing: it needs at least one letter or digit (any script).
    else if (!/[\p{L}\p{N}]/u.test(name)) errs.name = 'The name must include at least one letter or number';
    if (!risk) errs.risk = 'Select the risk level';
    T.fields.forEach(f => {
      const k = 'fields.' + f.key;
      if (f.kind === 'toggle') return;
      if (f.kind === 'file') {
        const had = !!dField.get(f.key)?.has_value || locked;
        if (f.required && !fieldFiles[f.key] && !had) errs[k] = `Upload ${f.label.toLowerCase()}`;
        return;
      }
      if (!check(k)) return;
      const v = (vals[f.key] ?? '').trim();
      const had = !!dField.get(f.key)?.has_value || locked;
      if (!v) {
        if (f.required && !(editing && f.secret && had)) errs[k] = `${f.kind === 'select' ? 'Select' : 'Enter'} ${f.label.toLowerCase()}`;
        return;
      }
      const m = checkField(f, v, true);
      if (m) errs[k] = m;
      // Login → Username (CS-1434): a single letter is not a username — at least 3 characters (an email passes).
      else if (T.key === 'login' && f.key === 'username' && [...v].length < 3) errs[k] = 'Username must be at least 3 characters';
      // Driver License / Aadhaar / PAN number (CS-1437).
      else if (idRuleFor(T.key, f.key, vals.idtype)) {
        const e = idRuleFor(T.key, f.key, vals.idtype)!.error(v);
        if (e) errs[k] = e;
      }
      // Date of Birth: 18 or older (CS-1437).
      else if (f.key === 'dob' && dobError(v)) errs[k] = dobError(v)!;
      // Date of Expiry must be later than Date of Issue (CS-1437).
      else if (f.key === 'expiry' && T.fields.some(x => x.key === 'issue')) {
        const e = expiryError((vals.issue ?? '').trim(), v);
        if (e) errs[k] = e;
      }
    });
    const regEmailErr = ex.reg_email && regEmail.trim() ? emailError(regEmail) : null;
    if (regEmailErr) errs.reg_email = regEmailErr;
    const regPhoneErr = ex.reg_phone && regPhone.trim() ? phoneError(regPhone) : null;
    if (regPhoneErr) errs.reg_phone = regPhoneErr;
    if (ex.recovery_key && check('recovery_key') && rkey.trim() && rkey.trim().length < 4) errs.recovery_key = 'The recovery key looks too short';
    if (isPw && T.sec) {
      const pw = vals[T.sec] ?? '';
      if (inCritical && pw && !errs['fields.' + T.sec] && strengthOf(pw) < pol.min_strength) errs['fields.' + T.sec] = policyStrengthMsg(pol);
    }
    if (canProtect && scope === 'team' && !deptId) {
      toast.warning('Pick a team in Team Vault first', 'A team credential needs a department — open that team in Team Vault and add it there.');
      return;
    }

    const firstOf = (e: Record<string, string>) => Object.keys(e)[0];
    if (Object.keys(errs).length) {
      setErrors(errs);
      const first = firstOf(errs);
      jump(first);
      // Name the actual reason (e.g. the card checksum) so the toast explains why the save was blocked.
      const only = Object.keys(errs).length === 1;
      toast.warning(only ? 'Can’t save yet' : 'Please complete the highlighted fields', errs[first]);
      return;
    }

    let sendTotp = false;
    let sendGmail = false;
    const toGmail = () => setTimeout(() => {
      const f = bodyRef.current?.querySelector<HTMLInputElement>('#k2Gmail');
      f?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      f?.focus({ preventScroll: true });
    }, 30);
    if (needAuth && !auth.linkedOnServer && method === 'email') {
      if (!gmailOk) {
        setErrors({ twofa_email: OTP_EMAIL_MSG });
        toast.warning('Add a valid email address for the 2FA code');
        toGmail();
        return;
      }
      if (!gm.verified || !gm.token) {
        if (gm.token) setGm(g => ({ ...g, error: g.error || 'Enter the code from the email and press Verify.' }));
        else setErrors({ twofa_email: 'Send a code to this Gmail and verify it, or turn 2FA off.' });
        toast.warning('Verify the Gmail address to save');
        toGmail();
        return;
      }
      sendGmail = true;
    } else if (needAuth && !auth.linkedOnServer) {
      let ok = auth.verified;
      if (auth.secret && auth.code.replace(/\s/g, '').length === 6 && !ok) ok = await verifyCode();
      if (!ok) {
        if (!auth.error) setAuth(a => ({ ...a, error: 'Scan the QR code and verify a code to link your authenticator app, or turn 2FA off.' }));
        toast.warning('Link your authenticator app to save');
        bodyRef.current?.querySelector('.k2-code')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      // The save checks the code again; a code older than ~25 s may have rolled over.
      if (Date.now() - verifiedAt.current > 25000) {
        setAuth(a => ({ ...a, verified: false, code: '', error: 'That code has expired. Enter the current 6-digit code from your app, then save again.' }));
        toast.warning('Enter a fresh authenticator code to save');
        setTimeout(() => {
          const box = bodyRef.current?.querySelector('.k2-code');
          box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          box?.querySelector<HTMLInputElement>('input.cp-d')?.focus({ preventScroll: true });
        }, 30);
        return;
      }
      sendTotp = true;
    }
    const lockAdmin = prot.admin;
    const lockManager = prot.manager;
    const lockOtp = twofaLocks ? twofaOn : prot.otp && pol.cp_otp;
    if (critical && canProtect && !lockAdmin && !lockManager && !lockOtp) {
      toast.warning('Turn on at least one protection step for a critical credential');
      bodyRef.current?.querySelector('#cpSec')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const body: Record<string, unknown> = {};
    const put = (k: string, v: unknown, snapKey = k) => { if (!editing || changed(snapKey)) body[k] = v; };
    if (!editing) body.type = T.key;
    put('name', name.trim());
    put('risk', risk);
    if (isPw) put('rotation_days', rotation ? Number(rotation) : null);
    if (T.twofa) put('twofa', twofa);
    if (T.key !== 'note') put('notes', notes.trim() || null);
    const fields: Record<string, string> = {};
    T.fields.forEach(f => {
      if (f.kind === 'file') return;
      const v = f.kind === 'toggle' ? (vals[f.key] ?? 'no') : (vals[f.key] ?? '').trim();
      if (editing) {
        if (!changed('fields.' + f.key)) return;
        if (f.secret && !v) return;
        fields[f.key] = v;
      } else if (v) fields[f.key] = v;
    });
    if (Object.keys(fields).length) body.fields = fields;
    if (ex.reg_email) put('reg_email', regEmail.trim() || null);
    if (ex.reg_phone) put('reg_phone', regPhone.trim() || null);
    if (ex.recovery_key && rkey.trim() && (!editing || changed('recovery_key'))) body.recovery_key = rkey.trim();
    if (canProtect) {
      put('scope', scope);
      if (scope === 'team') put('department_id', deptId ? Number(deptId) : null, 'department_id');
      else if (editing && changed('scope')) body.department_id = null;
      if (critical) {
        put('lock_admin', lockAdmin);
        put('lock_manager', lockManager);
        put('lock_otp', lockOtp);
        // Approvers are resolved when access is requested — Vault Admin = the
        // branch's Branch Admin (common), manager = the requester's own
        // reporting manager (individual). The form pins no specific person.
        put('lock_admin_user_id', null, 'lock_admin');
        put('lock_manager_user_id', null, 'lock_manager');
      }
    }
    if (sendTotp && auth.secret) {
      // As the Postman add: the method is named, not left for the server to infer from the secret.
      body.twofa_method = 'google';
      body.totp_secret = auth.secret;
      body.totp_code = auth.code.replace(/\s/g, '');
    }
    if (sendGmail) {
      // As the Postman "Create server · email 2-step": method, inbox and the verified token.
      body.twofa_method = 'email';
      body.twofa_email = gmail.trim().toLowerCase();
      body.email_otp_token = gm.token;
    }
    if (attRemoved.length) body.remove_attachments = attRemoved;

    const files = Object.entries(fieldFiles);
    let payload: Loose | FormData = body;
    if (files.length || attNew.length) {
      const fd = new FormData();
      Object.entries(body).forEach(([k, v]) => {
        if (v === null || v === undefined) fd.append(k, '');
        else if (typeof v === 'boolean') fd.append(k, v ? '1' : '0');
        else if (Array.isArray(v)) v.forEach(x => fd.append(`${k}[]`, String(x)));
        else if (typeof v === 'object') Object.entries(v as Record<string, string>).forEach(([k2, v2]) => fd.append(`${k}[${k2}]`, v2));
        else fd.append(k, String(v));
      });
      files.forEach(([k, f]) => fd.append(`files[${k}]`, f));
      attNew.forEach(a => fd.append('attachments[]', a.file));
      payload = fd;
    }

    if (preview) {
      toast.info('Design preview', 'This page is on dummy data - the changes were not saved.');
      onClose();
      return;
    }

    setSaving(true);
    try {
      // The Critical Vault API takes critical risk only (CredVaultController:3149), so a lower level
      // picked in the Critical Vault's Add form is saved to My Vault.
      const toMyVault = addFromCritical && !critical;
      const r = editing ? await cvApi.update(detail!.id, payload, inCritical) : await cvApi.create(payload, inCritical && !toMyVault);
      toast.success(`${r.data.code} · ${r.data.name} ${editing ? 'updated' : 'added'}`,
        toMyVault ? `Saved in My Vault — only critical credentials live in the Critical Vault.` : r.message);
      onSaved(r.data);
    } catch (e) {
      if (e instanceof CvApiError && Object.keys(e.errors).length) {
        const mapped: Record<string, string> = {};
        Object.entries(e.errors).forEach(([k, m]) => { const n = normKey(k); if (!mapped[n]) mapped[n] = m[0]; });
        if (mapped.totp_code) setAuth(a => ({ ...a, verified: false, error: mapped.totp_code }));
        // A used-up or expired email token: send a fresh code.
        if (mapped.email_otp_code) setGm(g => ({ ...g, verified: false, code: '', error: mapped.email_otp_code }));
        setErrors(mapped);
        const first = firstOf(mapped);
        if (first === 'totp_code') bodyRef.current?.querySelector('.cp-auth')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else jump(first);
        toast.warning('Please complete the highlighted fields', e.message);
      } else {
        toast.error(editing ? 'Could not update the credential' : 'Could not save the credential', errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const typeItems = T.fields.map(fieldItem);
  const l = T.label.toLowerCase();
  const updated = detail?.updated_at
    ? new Date(detail.updated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="mapsup-overlay">
      <div className="mapsup-box crd-box" role="dialog" aria-modal="true" aria-busy={saving} aria-label={`${editing ? 'Edit' : 'Add'} ${T.label} Credentials`}
        style={{ position: 'relative' }}>
        {/* My Vault: the Customer form's save lock — a blurred sheet, a big ring and the word under it, no card. */}
        {saving && !inCritical && (
          <div role="status" aria-live="polite" aria-busy="true" className="cv-lock">
            <div className="cv-lock__box"><span className="cv-lock__spin" />{editing ? 'Updating…' : 'Saving…'}</div>
          </div>
        )}
        {saving && inCritical && (
          <div role="status" style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit', background: 'rgba(8, 30, 40, .28)', backdropFilter: 'blur(1.5px)', cursor: 'progress' }}>
            <div className="mapsup-seccard cv-saving" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px' }}>
              <span className="cp-spin" />
              <b className="mapsup-sechead__title">{editing ? 'Updating credential…' : 'Saving credential…'}</b>
            </div>
          </div>
        )}
        <div className="mapsup-header">
          <div className="mapsup-hrow">
            <div className="mapsup-title-wrap">
              <div className="mapsup-hicon crd-hicon" style={{ '--tc': typeColor(T.key) } as CSSProperties}><Svg icon={T.icon} size={20} /></div>
              <div className="mapsup-title-block">
                <h3 className="mapsup-title">{editing ? 'Edit ' : 'Add '}{T.label} Credentials</h3>
                <p className="mapsup-sub">
                  {editing
                    ? <>Update <b>{detail!.name}</b> <span className="crd-edit-id">{detail!.code}</span> — every field is pre-filled, change only what you need.</>
                    : <>Save a {l} securely in your vault with its details, risk level and remark.</>}
                </p>
              </div>
            </div>
            <div className="crd-hbtns">
              <span className={`znm-flag mv-rk mv-rk--${risk}`} title="Risk level"><i />{cap(risk)}</span>
              <button type="button" className="mapsup-close" onClick={askClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
            </div>
          </div>
        </div>

        <div className="mapsup-body" ref={bodyRef}>
          <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}>
          {locked && (
            <div className="cv-form-note">
              <Svg d={CP_I.lock} size={14} />
              <span>This credential is locked, so its details are not shown. Anything you leave untouched keeps its saved value — fill in only what you want to change.</span>
            </div>
          )}
          <Section ico="lock" title="Credential Details" sub={`ID, name and category of this ${l} credential`} items={s1} wide={wide} />
          <Section ico={T.icon} title={`${T.label} Details`} sub={`${T.description || `Only the fields a ${l} needs`} — only what a ${l} needs`}
            items={typeItems} wide={wide} after={T.twofa ? undefined : twofaCard} />
          {xtItems.length > 0 && <Section ico={SHIELD_CHECK} title="Recovery & Proof" sub={xtSub} items={xtItems} wide={wide} />}
          <Section ico="shield" title="Security Details" sub={secSub} items={s3} wide={wide} after={T.twofa ? twofaCard : undefined} />
          {critical && canProtect && (
            <div id="cpSec">
              <Section ico="lock" title="Critical Access Protection" sub="Locks this credential behind approvals and 2FA — applied every time it is revealed" wide={false}
                items={[{
                  span: 4,
                  render: () => (
                    <ProtectionBody key="cp" v={prot} policy={policyGate} hasMain={twofaLocks} twofaOn={twofaOn} mainChip={twofaChip}
                      set={p => { setProt(s => ({ ...s, ...p })); clr('lock_admin'); }}
                      auth={auth} authBox={authBox} picker={step3Picker} errors={errors} />
                  ),
                }]} />
            </div>
          )}
          </fieldset>
        </div>

        <div className="mapsup-footer">
          <div className="mapsup-footer__info">
            {editing
              ? <><Svg d='<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2"/>' size={12} /> Last updated <b>{updated}</b> · <span>{changedCount ? <b className="crd-chg">{changedCount} field{changedCount === 1 ? '' : 's'} changed</b> : 'No changes yet'}</span></>
              : <>Adding a <b>{T.label}</b> to {canProtect && scope === 'team' ? 'Team Vault' : 'My Vault'} · fields marked <span style={{ color: '#e11d48', fontWeight: 800 }}>*</span> are required</>}
          </div>
          <div className="mapsup-footer__actions">
            {!editing && onChangeType && (
              <button type="button" data-h40="skip" className="mapsup-footer__btn mapsup-footer__btn--ghost crd-change-ft" onClick={onChangeType} disabled={saving}>
                <Svg icon="swap" size={13} />Change type
              </button>
            )}
            <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={askClose} disabled={saving}>Close</button>
            <button type="button" className={`mapsup-footer__btn mapsup-footer__btn--primary${editing && !changedCount ? ' is-dim' : ''}`}
              onClick={save} disabled={saving || (editing && !changedCount && !attNew.length && !attRemoved.length)}
              title={editing && !changedCount && !attNew.length && !attRemoved.length ? 'Change a field to update this credential' : undefined}>
              <Svg icon="check" size={13} sw={2.6} />{saving ? (editing ? 'Updating…' : 'Saving…') : editing ? 'Update Credential' : 'Save Credential'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
