import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type Attachment, type CredentialDetail, type FieldDef, type Loose, type Meta, type Risk, type TypeDef } from '../cvApi';
import { Svg, bytes, cap, copyText, errMsg } from '../shared';
import CrdSelect, { type CrdOption } from './CrdSelect';
import {
  PHONE_RE, STR_LBL, checkField, fieldSpan, fillRows, generatePassword, hasTwofaSwitch, isEmail,
  policyStrengthMsg, secretIsPassword, strengthOf, typeColor, verifyTotp,
} from './formHelpers';
import { AUTH_EMPTY, AuthBox, AuthChip, CP_I, ProtectionBody, authLinked, type AuthState, type ProtectionValue } from './ProtectionSection';

/* ─────────────────────────────────────────────────────────────────────────
 * Step 2 of Add Credential, and Edit — crdOpenForm + crdSave + the Critical
 * Access Protection wrapper (cpBindForm / cpAuthInit / the crdSave override).
 *
 * Edit saves only what changed: the API keeps every field left out, so a
 * secret is never needed in the browser to save an unrelated change.
 * ───────────────────────────────────────────────────────────────────────── */

export interface FormInit {
  critical?: boolean; prefillPassword?: string; scope?: 'personal' | 'team'; departmentId?: number | null;
}

const SHIELD_CHECK = '<path d="M9 12l2 2 4-4M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22"/>';
const KEEP = 'Leave blank to keep the saved value';

/** Server error keys → the data-f key of the field they belong to. */
function normKey(k: string): string {
  if (k.startsWith('files.')) return 'fields.' + k.slice(6);
  if (/^attachments\.\d+$/.test(k) || k.startsWith('remove_attachments')) return 'attachments';
  if (k === 'totp_secret') return 'totp_code';
  return k;
}

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

// Risk and 2FA guard the credential; the server lets only the owner or a Vault Admin change them.
const PROTECT_HINT = 'Only the owner or a Vault Admin can change this.';
const LOCKED_STYLE: CSSProperties = { opacity: .6, cursor: 'not-allowed' };

const fileIco = (n: string) => {
  const e = (n.split('.').pop() || '').toLowerCase();
  return /^(png|jpe?g|gif|webp)$/.test(e) ? 'img' : e === 'pdf' ? 'pdf' : /^(xlsx?|csv)$/.test(e) ? 'xls' : 'doc';
};

export default function CredentialForm({ meta, T, detail, init, onClose, onSaved, onChangeType }: {
  meta: Meta; T: TypeDef; detail: CredentialDetail | null; init: FormInit;
  onClose: () => void; onSaved: (c: CredentialDetail) => void; onChangeType?: () => void;
}) {
  const toast = useToast();
  const pol = meta.policy;
  const editing = !!detail;
  const locked = editing && !detail!.fields;
  const canProtect = !editing || !!detail!.can?.edit_protection;
  const isPw = secretIsPassword(T);
  const hasMain = hasTwofaSwitch(T);
  const toggleField = T.fields.find(f => f.key === 'twofa' && f.kind === 'toggle');
  const ex = T.extras;
  const dField = useMemo(() => new Map((detail?.fields ?? []).map(f => [f.key, f])), [detail]);
  const prefillKey = !editing && init.prefillPassword
    ? (T.fields.find(f => f.kind === 'password') ?? T.fields.find(f => f.kind === 'secret'))?.key ?? null
    : null;
  const startCritical = !editing && !!init.critical;

  /* ── state ── */
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    T.fields.forEach(f => {
      if (f.kind === 'file') return;
      if (f.kind === 'toggle') v[f.key] = detail ? (detail.twofa === 'yes' ? 'yes' : 'no') : (startCritical && pol.cp_otp ? 'yes' : 'no');
      else v[f.key] = detail && !f.secret ? (dField.get(f.key)?.value ?? '') : '';
    });
    if (prefillKey) v[prefillKey] = init.prefillPassword!;
    return v;
  });
  const [name, setName] = useState(detail?.name ?? '');
  const [risk, setRisk] = useState<Risk>(detail?.risk ?? (init.critical ? 'critical' : T.risk));
  const [rotation, setRotation] = useState(detail ? String(detail.rotation_days ?? '') : String(pol.rotation_default ?? ''));
  const [twofa, setTwofa] = useState(detail ? detail.twofa === 'yes' : startCritical && T.twofa && pol.cp_otp);
  const [notes, setNotes] = useState(detail?.notes ?? '');
  const [regEmail, setRegEmail] = useState(detail?.recovery?.reg_email ?? '');
  const [regPhone, setRegPhone] = useState(detail?.recovery?.reg_phone ?? '');
  const [rkey, setRkey] = useState('');
  const [scope, setScope] = useState<'personal' | 'team'>(detail?.scope ?? init.scope ?? 'personal');
  const [deptId, setDeptId] = useState(String(detail?.department?.id ?? init.departmentId ?? meta.me.department_id ?? ''));
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
  const [depts, setDepts] = useState<CrdOption[] | null>(null);
  const [approvers, setApprovers] = useState<Loose | null>(null);

  const wasCritical = detail?.risk === 'critical';
  const P = detail?.protection;
  const [prot, setProt] = useState<ProtectionValue>(() => ({
    admin: wasCritical && P ? P.admin : true,
    manager: wasCritical && P ? P.manager : true,
    otp: wasCritical && P ? P.otp : true,
    adminUserId: String(P?.admin_user?.id ?? ''),
    managerUserId: String(P?.manager_user?.id ?? ''),
  }));
  const protIdsTouched = useRef(editing && wasCritical);
  const policyGate = { admin: pol.cp_admin, manager: pol.cp_manager, otp: pol.cp_otp };

  const twofaOn = T.twofa ? twofa : toggleField ? vals.twofa === 'yes' : false;
  const critical = risk === 'critical';
  const needAuth = hasMain ? twofaOn : critical && canProtect && prot.otp && pol.cp_otp;
  const [auth, setAuth] = useState<AuthState>(() => ({ ...AUTH_EMPTY, linkedOnServer: !!(P?.otp && P?.otp_linked) }));
  const verifiedAt = useRef(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /* ── effects ── */
  useEffect(() => {
    const r = () => setWide(window.innerWidth > 980);
    window.addEventListener('resize', r);
    const t = setTimeout(() => nameRef.current?.focus(), 30);
    return () => { window.removeEventListener('resize', r); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (editing) return;
    let on = true;
    cvApi.nextCode().then(c => { if (on) setCode(c); }).catch(() => { if (on) setCode('Auto'); });
    return () => { on = false; };
  }, [editing]);

  useEffect(() => {
    if (prefillKey === null && init.prefillPassword && !editing) {
      toast.warning(`${T.label} has no password field — generated password not used`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scope !== 'team' || depts || !canProtect) return;
    let on = true;
    cvApi.departments().then(d => {
      if (on) setDepts(((d.departments ?? []) as Loose[]).map(x => ({ value: String(x.id), label: String(x.name) })));
    }).catch(() => { if (on) setDepts([]); });
    return () => { on = false; };
  }, [scope, depts, canProtect]);

  useEffect(() => {
    if (!critical || !canProtect || approvers) return;
    let on = true;
    cvApi.approvers().then(a => {
      if (!on) return;
      setApprovers(a);
      if (!protIdsTouched.current) {
        setProt(p => ({ ...p, adminUserId: String(a.defaults?.admin_user_id ?? ''), managerUserId: String(a.defaults?.manager_user_id ?? '') }));
      }
    }).catch(() => { if (on) setApprovers({ admins: [], managers: [], defaults: {} }); });
    return () => { on = false; };
  }, [critical, canProtect, approvers]);

  const fetchSecret = () => {
    setAuth(a => ({ ...a, loading: true, failed: null }));
    const label = `${code && code !== 'Auto' ? code : 'Credential'}${name.trim() ? ' · ' + name.trim() : ''}`;
    cvApi.newAuthenticator(label)
      .then(d => setAuth(a => ({ ...a, loading: false, secret: d.secret, display: d.secret_display, uri: d.otpauth_uri, code: '', error: '' })))
      .catch(e => setAuth(a => ({ ...a, loading: false, failed: errMsg(e, 'Could not prepare a setup key.') })));
  };
  useEffect(() => {
    if (needAuth && !authLinked(auth) && !auth.secret && !auth.loading && !auth.failed) fetchSecret();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needAuth, auth.linkedOnServer, auth.verified, auth.secret, auth.loading, auth.failed]);

  const attUrls = useRef<{ url: string }[]>([]);
  attUrls.current = attNew;
  useEffect(() => () => attUrls.current.forEach(a => URL.revokeObjectURL(a.url)), []);

  /* ── change tracking (crdTrackEdits) ── */
  const snap = (): Record<string, string> => {
    const s: Record<string, string> = {
      name, risk, rotation_days: rotation, twofa: String(twofa), notes, reg_email: regEmail, reg_phone: regPhone,
      recovery_key: rkey, scope, department_id: scope === 'team' ? deptId : '',
      attachments: `${attNew.length}/${attRemoved.length}`,
      lock_admin: `${prot.admin}|${prot.adminUserId}`, lock_manager: `${prot.manager}|${prot.managerUserId}`, lock_otp: String(prot.otp),
      totp_code: String(auth.verified),
    };
    T.fields.forEach(f => { s['fields.' + f.key] = f.kind === 'file' ? (fieldFiles[f.key]?.name ?? '') : (vals[f.key] ?? ''); });
    return s;
  };
  const orig = useRef<Record<string, string> | null>(null);
  const now = snap();
  if (!orig.current) orig.current = now;
  const changed = (k: string) => editing && orig.current![k] !== now[k];
  const changedCount = editing ? Object.keys(now).filter(k => orig.current![k] !== now[k]).length : 0;
  // Approver ids filled in from the server's defaults are not the user's change.
  const dirty = Object.keys(now).some(k => {
    if (orig.current![k] === now[k]) return false;
    if ((k === 'lock_admin' || k === 'lock_manager') && !protIdsTouched.current) return orig.current![k].split('|')[0] !== now[k].split('|')[0];
    return true;
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const askClose = () => { if (!dirtyRef.current || window.confirm('Discard your unsaved changes?')) onClose(); };

  // Esc on a form with changes asks first; capture runs before the portal's own Esc-to-close.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dirtyRef.current) return;
      e.stopPropagation();
      if (window.confirm('Discard your unsaved changes?')) onCloseRef.current();
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, []);

  /* ── helpers ── */
  const clr = (k: string) => setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  const setVal = (k: string, v: string) => { setVals(s => ({ ...s, [k]: v })); clr('fields.' + k); };
  const ffCls = (k: string, extra = '') => `mapsup-ffield${extra}${errors[k] ? ' is-err' : ''}${changed(k) ? ' is-edited' : ''}`;
  const jump = (k: string) => {
    const el = bodyRef.current?.querySelector(`[data-f="${CSS.escape(k)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const copyField = (v: string) => {
    if (!v) { toast.warning('Nothing to copy yet'); return; }
    copyText(v).then(() => toast.success('Copied to clipboard')).catch(() => toast.error('Could not copy — your browser blocked the clipboard'));
  };

  /* ── a type field (crdField) ── */
  const fieldItem = (f: FieldDef) => {
    const k = 'fields.' + f.key;
    const span = fieldSpan(f);
    const had = !!dField.get(f.key)?.has_value || locked;
    const keep = editing && f.secret && had;
    const ph = keep ? KEEP : (f.placeholder ?? '');
    const cls = `mapsup-finput has-ico${f.mono ? ' crd-mono' : ''}`;
    const baseCls = span === 4 ? ' mapsup-span-full' : span === 2 ? ' crd-span2' : '';
    const val = vals[f.key] ?? '';
    const onText = (v: string) => setVal(f.key, f.upper ? v.toUpperCase() : v);
    const req = f.required && !(editing && had && (f.secret || f.kind === 'file'));

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
              options={[{ value: '', label: 'Select…' }, ...(f.options ?? []).map(o => ({ value: o, label: o }))]} />
          );
        } else if (f.kind === 'textarea') {
          ctl = (
            <textarea id={`crdF_${f.key}`} className={`${cls} crd-ta${f.secret ? ' crd-secret-ta' : ''}`} rows={3} value={val}
              placeholder={ph} maxLength={f.max ?? undefined} autoComplete="off" onChange={e => onText(e.target.value)} />
          );
        } else if (f.kind === 'password' || f.kind === 'secret') {
          const vis = shown.has(f.key);
          wrapCls += ' crd-pw';
          ctl = (
            <>
              <input id={`crdF_${f.key}`} type={vis ? 'text' : 'password'} className={`${cls} crd-pw__in${f.kind === 'password' ? ' crd-pw__in--3' : ''}`}
                value={val} placeholder={ph} maxLength={f.max ?? undefined} autoComplete="new-password"
                onChange={e => { onText(e.target.value); if (generated.has(f.key)) setGenerated(g => { const n = new Set(g); n.delete(f.key); return n; }); }} />
              <span className="crd-pw__btns">
                <button type="button" data-h40="skip" className={`crd-pw__b${vis ? ' is-on' : ''}`} title={vis ? 'Hide' : 'Show / hide'}
                  onClick={() => setShown(s => { const n = new Set(s); if (vis) n.delete(f.key); else n.add(f.key); return n; })}>
                  <Svg icon={vis ? undefined : 'eye'} d={vis ? EYE_OFF : undefined} size={14} />
                </button>
                <button type="button" data-h40="skip" className="crd-pw__b" title="Copy" onClick={() => copyField(val)}><Svg icon="copy" size={14} /></button>
                {f.kind === 'password' && (
                  <button type="button" data-h40="skip" className="crd-pw__b crd-pw__b--gen" title="Generate a strong password"
                    onClick={() => {
                      setVal(f.key, generatePassword(pol.gen_length || 16, pol.gen_symbols ?? true));
                      setShown(s => new Set(s).add(f.key));
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
        } else {
          ctl = (
            <input id={`crdF_${f.key}`} type={f.kind} className={cls} value={val} placeholder={ph}
              maxLength={f.max ?? undefined} autoComplete="off" onChange={e => onText(e.target.value)} />
          );
        }
        return (
          <div className={ffCls(k, baseCls + (generated.has(f.key) ? ' gp-filled' : ''))} data-f={k} style={style}>
            <Lbl text={f.label} req={req}
              badge={generated.has(f.key) && f.key === prefillKey
                ? <span className="mapsup-lock mapsup-lock--auto"><Svg icon="key" size={9} sw={2.6} /> Generated</span> : undefined} />
            <div className={wrapCls}>
              <span className="mapsup-input-ico"><Svg icon={f.icon ?? 'tag'} size={13} /></span>
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
        <div className="mapsup-inputwrap is-frozen">
          <span className="mapsup-input-ico"><Svg icon={ico} size={13} /></span>
          <input className="mapsup-finput has-ico" type="text" value={value} readOnly />
          <span className="mapsup-freeze-ico"><Svg icon="lock" size={9} sw={2.6} /></span>
        </div>
      </div>
    ),
  });

  const selItem = (k: string, lbl: string, ico: string, req: boolean, value: string, options: CrdOption[], onChange: (v: string) => void, span = 1, lockedSel = false) => ({
    span,
    render: (style: CSSProperties | undefined) => (
      <div className={ffCls(k)} data-f={k} style={style}>
        <Lbl text={lbl} req={req} />
        <div className="mapsup-inputwrap">
          <span className="mapsup-input-ico"><Svg icon={ico} size={13} /></span>
          <CrdSelect id={`crdF_${k}`} value={value} options={options} onChange={v => { onChange(v); clr(k); }} disabled={lockedSel} />
        </div>
        {lockedSel ? <span className="cv-ferr" style={{ color: '#64748b' }}>{PROTECT_HINT}</span> : <Err msg={errors[k]} />}
      </div>
    ),
  });

  /* ── section 1: Credential Details ── */
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
  if (canProtect) {
    s1.push(selItem('scope', 'Vault', 'lock', true, scope,
      [{ value: 'personal', label: 'My Vault — personal' }, { value: 'team', label: 'Team Vault — shared with the department' }],
      v => setScope(v as 'personal' | 'team'), 2));
    if (scope === 'team') {
      s1.push(selItem('department_id', 'Team (Department)', 'user', true, deptId,
        depts === null ? [{ value: deptId, label: 'Loading…' }] : [{ value: '', label: 'Select…' }, ...depts],
        setDeptId, 2));
    }
  }

  /* ── section 3: Recovery & Proof (crdXtSection) ── */
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
    if (err) setErrors(e => ({ ...e, attachments: err }));
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
            maxLength={type === 'tel' ? 16 : 191} onChange={e => { set(e.target.value); clr(k); }} />
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
              <button type="button" data-h40="skip" className="crd-pw__b" title="Copy" onClick={() => copyField(rkey)}><Svg icon="copy" size={14} /></button>
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

  /* ── section 4: Security Details ── */
  const nSec = 1 + (T.twofa ? 1 : 0) + (isPw ? 1 : 0);
  const s3 = [
    selItem('risk', 'Risk Level', 'shield', true, risk,
      meta.risks.map(r => ({ value: r.key, label: r.label, dot: r.key })), v => setRisk(v as Risk), 1, !canProtect),
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

  /* ── authenticator ── */
  const verifyCode = async (): Promise<boolean> => {
    const c6 = auth.code.replace(/\s/g, '');
    if (!auth.secret) return false;
    if (c6.length !== 6) { setAuth(a => ({ ...a, error: 'Enter the 6-digit code shown in your authenticator app.' })); return false; }
    const ok = await verifyTotp(auth.secret, c6);
    if (ok === false) { setAuth(a => ({ ...a, error: 'That code is incorrect or expired. Check your app and try again.' })); return false; }
    verifiedAt.current = Date.now();
    setAuth(a => ({ ...a, verified: true, error: '' }));
    clr('totp_code');
    return true;
  };
  const authBox = (
    <AuthBox a={auth}
      onCode={c => setAuth(a => ({ ...a, code: c, error: '' }))}
      onVerify={() => { verifyCode().then(ok => { if (ok) toast.success('Authenticator app verified', 'It is linked to this credential when you save.'); }); }}
      onRelink={() => setAuth({ ...AUTH_EMPTY })}
      onRetry={fetchSecret}
      onCopyKey={() => { if (auth.secret) copyText(auth.secret).then(() => toast.success('Setup key copied')).catch(() => toast.error('Could not copy')); }} />
  );
  const mainCard = hasMain && T.twofa && twofaOn ? (
    <div className="cp-fcard cp-fcard--main" data-f="totp_code_main">
      <div className="cp-frow cp-frow--main">
        <span className="cp-frow__ico"><Svg d={CP_I.phone} size={16} /></span>
        <div className="cp-frow__t"><b>2FA — Authenticator app</b><span>Link your authenticator app. A 6-digit code from it will be needed to open this credential.</span></div>
        <AuthChip a={auth} />
      </div>
      {authBox}
    </div>
  ) : null;
  // The Password type keeps its 2FA switch among its fields: the authenticator card follows that section.
  const toggleCard = hasMain && !T.twofa && twofaOn ? (
    <div className="cp-fcard cp-fcard--main">
      <div className="cp-frow cp-frow--main">
        <span className="cp-frow__ico"><Svg d={CP_I.phone} size={16} /></span>
        <div className="cp-frow__t"><b>2FA — Authenticator app</b><span>Link your authenticator app. A 6-digit code from it will be needed to open this credential.</span></div>
        <AuthChip a={auth} />
      </div>
      {authBox}
    </div>
  ) : null;

  const adminOptions: CrdOption[] = [{ value: '', label: 'Any Vault Admin' },
    ...((approvers?.admins ?? []) as Loose[]).map(a => ({ value: String(a.id), label: String(a.name) }))];
  const managerOptions: CrdOption[] = [{ value: '', label: 'The requester’s reporting manager' },
    ...((approvers?.managers ?? []) as Loose[]).map(a => ({ value: String(a.id), label: `${a.name}${a.role ? ' · ' + a.role : ''}` }))];
  // Keep a saved approver selectable while the list loads (or if it has left the list).
  if (prot.adminUserId && !adminOptions.some(o => o.value === prot.adminUserId)) adminOptions.push({ value: prot.adminUserId, label: P?.admin_user?.name ?? 'Loading…' });
  if (prot.managerUserId && !managerOptions.some(o => o.value === prot.managerUserId)) managerOptions.push({ value: prot.managerUserId, label: P?.manager_user?.name ?? 'Loading…' });

  /* ── save (crdSave + the protection wrapper) ── */
  // Held from the first click, across the authenticator check, so a double click can't create twice.
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try { await submit(); } finally { savingRef.current = false; }
  };
  const submit = async () => {
    const errs: Record<string, string> = {};
    const check = (k: string) => !editing || changed(k);
    if (!name.trim()) errs.name = 'Enter a name for this credential';
    else if (name.trim().length < 2) errs.name = 'The name needs at least 2 characters';
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
      const m = checkField(f, v);
      if (m) errs[k] = m;
    });
    if (ex.reg_email && regEmail.trim() && !isEmail(regEmail.trim())) errs.reg_email = 'Enter a valid email address';
    if (ex.reg_phone && regPhone.trim() && !PHONE_RE.test(regPhone.trim())) errs.reg_phone = 'Enter a valid phone number, e.g. +91 98200 11223';
    if (ex.recovery_key && rkey.trim() && rkey.trim().length < 4) errs.recovery_key = 'The recovery key looks too short';
    if (isPw && T.sec) {
      const pw = vals[T.sec] ?? '';
      if (pw && !errs['fields.' + T.sec] && strengthOf(pw) < pol.min_strength) errs['fields.' + T.sec] = policyStrengthMsg(pol);
    }
    if (canProtect && scope === 'team' && !deptId) errs.department_id = 'Pick the team (department) this credential belongs to';

    const firstOf = (e: Record<string, string>) => Object.keys(e)[0];
    if (Object.keys(errs).length) {
      setErrors(errs);
      jump(firstOf(errs));
      toast.warning('Please complete the highlighted fields');
      return;
    }

    // The authenticator must be linked before a 2FA-locked credential is saved.
    let sendTotp = false;
    if (needAuth && !auth.linkedOnServer) {
      let ok = auth.verified;
      if (auth.secret && auth.code.replace(/\s/g, '').length === 6) ok = await verifyCode();
      if (!ok) {
        if (!auth.error) setAuth(a => ({ ...a, error: 'Scan the QR code and verify a code to link your authenticator app, or turn 2FA off.' }));
        toast.warning('Link your authenticator app to save');
        bodyRef.current?.querySelector('.cp-auth')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      // The server accepts a code within one 30 s step of now: an older verification needs a fresh code.
      if (Date.now() - verifiedAt.current > 25000) {
        setAuth(a => ({ ...a, verified: false, code: '', error: 'That code has expired. Enter the current 6-digit code from your app, then save again.' }));
        toast.warning('Enter a fresh authenticator code to save');
        setTimeout(() => {
          const box = bodyRef.current?.querySelector('.cp-auth');
          box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          box?.querySelector<HTMLInputElement>('input.cp-d')?.focus({ preventScroll: true });
        }, 30);
        return;
      }
      sendTotp = true;
    }
    // The raw choices: the policy's step switches are applied by the server each time the credential is opened.
    const lockAdmin = prot.admin;
    const lockManager = prot.manager;
    const lockOtp = hasMain ? twofaOn : prot.otp;
    if (critical && canProtect && !lockAdmin && !lockManager && !lockOtp) {
      toast.warning('Turn on at least one protection step for a critical credential');
      bodyRef.current?.querySelector('#cpSec')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    /* payload — edit sends only what changed */
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
        if (f.secret && !v) return; // blank secret = keep
        fields[f.key] = v;
      } else if (v) fields[f.key] = v;
    });
    if (Object.keys(fields).length) body.fields = fields;
    if (ex.reg_email) put('reg_email', regEmail.trim() || null);
    if (ex.reg_phone) put('reg_phone', regPhone.trim() || null);
    if (ex.recovery_key && rkey.trim()) body.recovery_key = rkey.trim();
    if (canProtect) {
      put('scope', scope);
      if (scope === 'team') put('department_id', deptId ? Number(deptId) : null, 'department_id');
      else if (editing && changed('scope')) body.department_id = null;
      if (critical) {
        put('lock_admin', lockAdmin);
        put('lock_manager', lockManager);
        if (!hasMain) put('lock_otp', lockOtp);
        put('lock_admin_user_id', lockAdmin && prot.adminUserId ? Number(prot.adminUserId) : null, 'lock_admin');
        put('lock_manager_user_id', lockManager && prot.managerUserId ? Number(prot.managerUserId) : null, 'lock_manager');
      }
    }
    if (sendTotp && auth.secret) {
      body.totp_secret = auth.secret;
      body.totp_code = auth.code.replace(/\s/g, '');
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

    setSaving(true);
    try {
      const r = editing ? await cvApi.update(detail!.id, payload) : await cvApi.create(payload);
      toast.success(`${r.data.code} · ${r.data.name} ${editing ? 'updated' : 'added'}`, r.message);
      onSaved(r.data);
    } catch (e) {
      if (e instanceof CvApiError && Object.keys(e.errors).length) {
        const mapped: Record<string, string> = {};
        Object.entries(e.errors).forEach(([k, m]) => { const n = normKey(k); if (!mapped[n]) mapped[n] = m[0]; });
        if (mapped.totp_code) {
          setAuth(a => ({ ...a, verified: false, error: mapped.totp_code }));
        }
        setErrors(mapped);
        const first = firstOf(mapped);
        if (first === 'totp_code') bodyRef.current?.querySelector('.cp-auth')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else jump(first);
        toast.error(editing ? 'Could not update the credential' : 'Could not save the credential', e.message);
      } else {
        toast.error(editing ? 'Could not update the credential' : 'Could not save the credential', errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── render ── */
  const typeItems = T.fields.map(fieldItem);
  const l = T.label.toLowerCase();
  const updated = detail?.updated_at
    ? new Date(detail.updated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="mapsup-overlay" onMouseDown={e => { if (e.target === e.currentTarget) askClose(); }}>
      <div className="mapsup-box crd-box" role="dialog" aria-modal="true" aria-label={`${editing ? 'Edit' : 'Add'} ${T.label} Credentials`}>
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
          {locked && (
            <div className="cv-form-note">
              <Svg d={CP_I.lock} size={14} />
              <span>This credential is locked, so its details are not shown. Anything you leave untouched keeps its saved value — fill in only what you want to change.</span>
            </div>
          )}
          <Section ico="lock" title="Credential Details" sub={`ID, name and category of this ${l} credential`} items={s1} wide={wide} />
          <Section ico={T.icon} title={`${T.label} Details`} sub={`${T.description || `Only the fields a ${l} needs`} — only what a ${l} needs`}
            items={typeItems} wide={wide} after={toggleCard} />
          {xtItems.length > 0 && <Section ico={SHIELD_CHECK} title="Recovery & Proof" sub={xtSub} items={xtItems} wide={wide} />}
          <Section ico="shield" title="Security Details" sub={secSub} items={s3} wide={wide} after={mainCard} />
          {critical && canProtect && (
            <div id="cpSec">
              <Section ico="lock" title="Critical Access Protection" sub="Locks this credential behind approvals and 2FA — applied every time it is revealed" wide={false}
                items={[{
                  span: 4,
                  render: () => (
                    <ProtectionBody key="cp" v={prot} policy={policyGate} hasMain={hasMain} twofaOn={twofaOn}
                      set={p => { if ('adminUserId' in p || 'managerUserId' in p) protIdsTouched.current = true; setProt(s => ({ ...s, ...p })); clr('lock_admin'); }}
                      adminOptions={adminOptions} managerOptions={managerOptions} auth={auth} authBox={authBox} errors={errors} />
                  ),
                }]} />
            </div>
          )}
        </div>

        <div className="mapsup-footer">
          <div className="mapsup-footer__info">
            {editing
              ? <><Svg d='<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2"/>' size={12} /> Last updated <b>{updated}</b> · <span>{changedCount ? <b className="crd-chg">{changedCount} field{changedCount === 1 ? '' : 's'} changed</b> : 'No changes yet'}</span></>
              : <>Adding a <b>{T.label}</b> to {canProtect && scope === 'team' ? 'Team Vault' : 'My Vault'} · fields marked <span style={{ color: '#e11d48', fontWeight: 800 }}>*</span> are required</>}
          </div>
          <div className="mapsup-footer__actions">
            {!editing && onChangeType && (
              <button type="button" data-h40="skip" className="mapsup-footer__btn mapsup-footer__btn--ghost crd-change-ft" onClick={onChangeType}>
                <Svg icon="swap" size={13} />Change type
              </button>
            )}
            <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={askClose}>Close</button>
            <button type="button" className={`mapsup-footer__btn mapsup-footer__btn--primary${editing && !changedCount ? ' is-dim' : ''}`}
              onClick={save} disabled={saving}>
              <Svg icon="check" size={13} sw={2.6} />{saving ? (editing ? 'Updating…' : 'Saving…') : editing ? 'Update Credential' : 'Save Credential'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
