import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Svg } from '../shared';
import CrdSelect, { type CrdOption } from './CrdSelect';

/* ─────────────────────────────────────────────────────────────────────────
 * Critical Access Protection (the prototype's cpFormSection) and the
 * "Link your authenticator app" box (cpAuthHtml). Ported markup, class for
 * class; state lives in CredentialFormModal.
 * ───────────────────────────────────────────────────────────────────────── */

export const CP_I = {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  mgr: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
};

/** One "Required / Off" switch of the protection steps. */
function StepToggle({ on, onChange, disabled, title }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className={`crd-tg${on ? ' is-on' : ''}`} title={title}
      style={disabled ? { opacity: .55, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="crd-tg__sw"><i /></span>
      <span className="crd-tg__st">{on ? 'Required' : 'Off'}</span>
    </label>
  );
}

function Row({ n, ico, t, d, extra, toggle, panel }: { n: number; ico: string; t: string; d: string; extra?: ReactNode; toggle?: ReactNode; panel?: ReactNode }) {
  return (
    <div className="cp-fcard">
      <div className="cp-frow">
        <span className="cp-frow__n">{n}</span>
        <span className="cp-frow__ico"><Svg d={ico} size={16} /></span>
        <div className="cp-frow__t"><b>{t}</b><span>{d}</span></div>
        <div className="cp-frow__x">{extra}</div>
        <div className="cp-frow__tg">{toggle}</div>
      </div>
      {panel}
    </div>
  );
}

export interface AuthState {
  secret: string | null; display: string; uri: string; loading: boolean; failed: string | null;
  /** linked already on the server (edit) and not being re-linked */
  linkedOnServer: boolean;
  /** a fresh secret whose code checked out in the browser — sent on save */
  verified: boolean;
  /** six positions, a space where no digit is typed yet */
  code: string;
  error: string;
}
export const AUTH_EMPTY: AuthState = { secret: null, display: '', uri: '', loading: false, failed: null, linkedOnServer: false, verified: false, code: '', error: '' };

export const authLinked = (a: AuthState) => a.linkedOnServer || a.verified;

export function AuthChip({ a, id }: { a: AuthState; id?: string }) {
  const ok = authLinked(a);
  return (
    <span className={`cp-chip ${ok ? 'is-ok' : 'is-no'}`} id={id}>
      {ok ? <><Svg d={CP_I.check} size={11} />App linked</> : 'Not linked yet'}
    </span>
  );
}

/** The QR, setup key and 6-digit verify card — or the "linked" line once linked. */
export function AuthBox({ a, onCode, onVerify, onRelink, onRetry, onCopyKey }: {
  a: AuthState; onCode: (code: string) => void; onVerify: () => void; onRelink: () => void; onRetry: () => void; onCopyKey: () => void;
}) {
  const [svg, setSvg] = useState('');
  const [bad, setBad] = useState(false);
  const digs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let on = true;
    if (!a.uri) { setSvg(''); return; }
    QRCode.toString(a.uri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then(s => { if (on) setSvg(s); }).catch(() => { if (on) setSvg(''); });
    return () => { on = false; };
  }, [a.uri]);

  // A refused code shakes the digits and clears them, as cpAuthVerify did.
  useEffect(() => {
    if (!a.error || a.code.replace(/\s/g, '').length !== 6) return;
    setBad(true);
    const t = setTimeout(() => { setBad(false); onCode(''); digs.current[0]?.focus(); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.error]);

  if (authLinked(a)) {
    return (
      <div className="cp-auth">
        <div className="cp-linked cp-auth__full">
          <span className="cp-linked__ico"><Svg d={CP_I.check} size={16} /></span>
          <div>
            <b>Authenticator app linked</b>
            <span>{a.verified
              ? 'Code verified — the app is linked to this credential when you save. A 6-digit code will then be required each time it is revealed.'
              : 'A 6-digit code from your authenticator app will be required each time this credential is revealed.'}</span>
          </div>
          <button type="button" className="cp-btn cp-btn--ghost" onClick={onRelink}>Re-link app</button>
        </div>
      </div>
    );
  }
  if (a.loading || (!a.secret && !a.failed)) {
    return <div className="cp-auth"><div className="cp-auth__full cv-auth-wait">Preparing a setup key for your authenticator app…</div></div>;
  }
  if (a.failed) {
    return (
      <div className="cp-auth">
        <div className="cp-auth__full cv-auth-wait">
          <span className="cp-err">{a.failed}</span>
          <button type="button" className="cp-btn cp-btn--ghost" onClick={onRetry}>Try again</button>
        </div>
      </div>
    );
  }

  const code = a.code.padEnd(6, ' ').slice(0, 6).split('');
  const setAt = (i: number, ch: string) => {
    const arr = a.code.padEnd(6, ' ').slice(0, 6).split('');
    arr[i] = ch || ' ';
    onCode(arr.join(''));
  };
  const step = (n: number, h: string, t: ReactNode) => (
    <li className="cp-stp"><span className="cp-stp__n">{n}</span><div><b>{h}</b><span>{t}</span></div></li>
  );

  return (
    <div className="cp-auth">
      <div className="cp-auth__qrcol">
        <div className="cp-qrframe"><i /><i /><i /><i />
          <div className="cp-qrframe__in" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <span className="cp-auth__cap">
          <Svg d='<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/>' size={12} />
          Scan with your app
        </span>
      </div>
      <div className="cp-auth__steps">
        <div className="cp-auth__title">Link your authenticator app</div>
        <div className="cp-auth__tag">Works with Google Authenticator, Microsoft Authenticator, Authy and any TOTP app</div>
        <ol className="cp-stps">
          {step(1, 'Open your app', <>Tap <b>+</b> or <b>Add account</b></>)}
          {step(2, 'Scan the QR code', 'Or enter the setup key manually')}
          {step(3, 'Enter the 6-digit code', <>Then press <b>Verify &amp; link</b></>)}
        </ol>
        <div className="cp-keybar">
          <span className="cp-keybar__ico"><Svg d='<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="M17 6l3 3"/>' size={14} /></span>
          <div className="cp-keybar__t"><span>Setup key</span><code>{a.display}</code></div>
          <button type="button" className="cp-keybar__cp" onClick={onCopyKey} title="Copy key">
            <Svg d='<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' size={13} />Copy
          </button>
        </div>
      </div>
      <div className="cp-vcard" data-f="totp_code">
        <div className="cp-vcard__hd">
          <span className="cp-vcard__ico"><Svg d={CP_I.phone} size={16} /></span>
          <div><b>Verify your app</b><span>Enter the code shown in the app</span></div>
        </div>
        <div className="cp-digs">
          {code.map((ch, i) => (
            <span key={i} style={{ display: 'contents' }}>
              <input ref={el => { digs.current[i] = el; }} className={`cp-d${ch.trim() ? ' is-f' : ''}${bad ? ' is-bad' : ''}`}
                type="text" inputMode="numeric" autoComplete="off" maxLength={1} aria-label={`Digit ${i + 1}`}
                value={ch.trim()}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9]/g, '').slice(-1);
                  setAt(i, v);
                  if (v) digs.current[i + 1]?.focus();
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !ch.trim() && i > 0) { e.preventDefault(); setAt(i - 1, ''); digs.current[i - 1]?.focus(); }
                  else if (e.key === 'ArrowLeft') digs.current[i - 1]?.focus();
                  else if (e.key === 'ArrowRight') digs.current[i + 1]?.focus();
                  else if (e.key === 'Enter') { e.preventDefault(); onVerify(); }
                }}
                onPaste={e => {
                  const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
                  if (!t) return;
                  e.preventDefault();
                  onCode(t.padEnd(6, ' '));
                  digs.current[Math.min(t.length, 5)]?.focus();
                }} />
              {i === 2 && <span className="cp-d__sep" />}
            </span>
          ))}
        </div>
        <button type="button" className="cp-btn cp-btn--pri cp-btn--block" onClick={onVerify}>
          <Svg d={CP_I.check} size={13} /> Verify &amp; link
        </button>
        <div className="cp-err cp-err--c">{a.error}</div>
        <div className="cp-vcard__ft"><Svg d={CP_I.clock} size={11} />Codes refresh every 30 seconds</div>
      </div>
    </div>
  );
}

export interface ProtectionValue {
  admin: boolean; manager: boolean; otp: boolean;
  adminUserId: string; managerUserId: string;
}

/** The three steps. `hasMain`: the type's own 2FA switch stands in for step 3. */
export function ProtectionBody({ v, set, policy, hasMain, twofaOn, adminOptions, managerOptions, auth, authBox, errors }: {
  v: ProtectionValue; set: (p: Partial<ProtectionValue>) => void;
  policy: { admin: boolean; manager: boolean; otp: boolean };
  hasMain: boolean; twofaOn: boolean;
  adminOptions: CrdOption[]; managerOptions: CrdOption[];
  auth: AuthState; authBox: ReactNode;
  errors: Record<string, string>;
}) {
  const off = 'Turned off by the CredVault policy — a Vault Admin can allow it under Policies';
  const step3Chip = hasMain
    ? <span className={`cp-chip ${!twofaOn ? 'is-off' : authLinked(auth) ? 'is-ok' : 'is-no'}`} id="cpStep3Chip">
        {!twofaOn ? '2FA field is off' : authLinked(auth) ? <><Svg d={CP_I.check} size={11} />App linked</> : 'Not linked yet'}
      </span>
    : (v.otp ? <AuthChip a={auth} id="cpAuthChip" /> : null);

  return (
    <div className="cp-form mapsup-span-full" style={{ gridColumn: '1/-1' }}>
      <div data-f="lock_admin">
        <Row n={1} ico={CP_I.admin} t="Request access to Vault Admin"
          d="User must ask the Vault Admin for access, with a reason and a time window."
          extra={<div className="mapsup-inputwrap" data-f="lock_admin_user_id">
            <span className="mapsup-input-ico"><Svg icon="user" size={13} /></span>
            <CrdSelect value={v.adminUserId} options={adminOptions} onChange={x => set({ adminUserId: x })} disabled={!v.admin} />
          </div>}
          toggle={<StepToggle on={v.admin && policy.admin} disabled={!policy.admin} title={policy.admin ? undefined : off} onChange={x => set({ admin: x })} />} />
      </div>
      <div data-f="lock_manager">
        <Row n={2} ico={CP_I.mgr} t="Request approval from Manager"
          d="After the Vault Admin approves, the manager must also approve the request."
          extra={<div className="mapsup-inputwrap" data-f="lock_manager_user_id">
            <span className="mapsup-input-ico"><Svg icon="user" size={13} /></span>
            <CrdSelect value={v.managerUserId} options={managerOptions} onChange={x => set({ managerUserId: x })} disabled={!v.manager} />
          </div>}
          toggle={<StepToggle on={v.manager && policy.manager} disabled={!policy.manager} title={policy.manager ? undefined : off} onChange={x => set({ manager: x })} />} />
      </div>
      {hasMain ? (
        <Row n={3} ico={CP_I.phone} t="2FA — Authenticator app"
          d="Uses the “2FA” field in this form — switch it on and link your authenticator app. A 6-digit code is then needed before this credential opens."
          extra={step3Chip} />
      ) : (
        <Row n={3} ico={CP_I.phone} t="2FA — Authenticator app"
          d="A 6-digit code from Google / Microsoft Authenticator is needed before the credential opens. Link the app below."
          extra={step3Chip}
          toggle={<StepToggle on={v.otp && policy.otp} disabled={!policy.otp} title={policy.otp ? undefined : off} onChange={x => set({ otp: x })} />}
          panel={v.otp && policy.otp ? authBox : null} />
      )}
      {(errors.lock_admin || errors.lock_admin_user_id || errors.lock_manager_user_id) && (
        <span className="crd-err cv-ferr">{errors.lock_admin || errors.lock_admin_user_id || errors.lock_manager_user_id}</span>
      )}
      <div className="cp-form__ft">
        <Svg d={CP_I.lock} size={12} /> Steps run in this order every time someone tries to reveal or copy this credential. Access locks again when the approved window ends.
      </div>
    </div>
  );
}
