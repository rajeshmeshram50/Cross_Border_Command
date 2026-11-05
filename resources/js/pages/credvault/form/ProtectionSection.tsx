import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Svg } from '../shared';


export const CP_I = {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  mgr: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
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

/** The six digit boxes, with paste, arrows, Backspace and Enter. */
function Digits({ code, onCode, onEnter, bad }: { code: string; onCode: (c: string) => void; onEnter: () => void; bad: boolean }) {
  const digs = useRef<(HTMLInputElement | null)[]>([]);
  const arr = code.padEnd(6, ' ').slice(0, 6).split('');
  const setAt = (i: number, ch: string) => { const n = [...arr]; n[i] = ch || ' '; onCode(n.join('')); };
  return (
    <div className="cp-digs">
      {arr.map((ch, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <input ref={el => { digs.current[i] = el; }} className={`cp-d${ch.trim() ? ' is-f' : ''}${bad ? ' is-bad' : ''}`}
            type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label={`Digit ${i + 1}`}
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
              else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
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
  );
}

/** Six digit boxes and a button in one bar — the Gmail code check before the save links 2FA. */
export function CodeRow({ ico, title, label, code, onCode, onSubmit, btn, busy, error }: {
  ico: string; title: string; label: ReactNode; code: string; onCode: (c: string) => void; onSubmit: () => void; btn: string; busy?: boolean; error?: string;
}) {
  return (
    <div className={`k2-code${error ? ' has-err' : ''}`}>
      <div className="k2-code__bar">
        <span className="cp-keybar__ico"><Svg d={ico} size={14} /></span>
        <div className="k2-code__t"><span>{title}</span><small>{label}</small></div>
        <Digits code={code} onCode={onCode} onEnter={onSubmit} bad={!!error} />
        <button type="button" className="cp-btn cp-btn--pri k2-code__btn" onClick={onSubmit} disabled={busy}>
          <Svg d={CP_I.check} size={13} /> {busy ? 'Checking…' : btn}
        </button>
      </div>
      {error && <div className="k2-code__err">{error}</div>}
    </div>
  );
}

/** The QR, setup key and the code check — or the "linked" line once linked. */
export function AuthBox({ a, onRelink, onRetry, onCopyKey, onCode, onVerify, verifying }: {
  a: AuthState; onRelink: () => void; onRetry: () => void; onCopyKey: () => void;
  onCode: (c: string) => void; onVerify: () => void; verifying: boolean;
}) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let on = true;
    if (!a.uri) { setSvg(''); return; }
    QRCode.toString(a.uri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then(s => { if (on) setSvg(s); }).catch(() => { if (on) setSvg(''); });
    return () => { on = false; };
  }, [a.uri]);

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
        <Digits code={a.code} onCode={onCode} onEnter={onVerify} bad={!!a.error} />
        <button type="button" className="cp-btn cp-btn--pri cp-btn--block" onClick={onVerify} disabled={verifying}>
          <Svg d={CP_I.check} size={13} /> {verifying ? 'Checking…' : 'Verify & link'}
        </button>
        <div className="cp-err cp-err--c">{a.error}</div>
        <div className="cp-vcard__ft"><Svg d={CP_I.clock} size={11} />Codes refresh every 30 seconds</div>
      </div>
    </div>
  );
}

/**
 * "Two-factor authentication on Kryptone" — under the 2FA switch of a critical credential.
 * The method is chosen when the credential is added; on edit a linked method is shown read-only.
 */
export interface GmailState {
  /** from POST two-step/email/send; the save sends it as email_otp_token once verified */
  token: string | null; sentTo: string; sending: boolean; wait: number;
  code: string; verifying: boolean; verified: boolean; error: string;
}
export const GMAIL_EMPTY: GmailState = { token: null, sentTo: '', sending: false, wait: 0, code: '', verifying: false, verified: false, error: '' };

export function TwofaCard({ method, readOnly, authBox, chip, onMethod, gmail, gmailOk, gmailErr, onGmail, gm, onSend, onGmCode, onGmVerify }: {
  method: 'google' | 'email'; readOnly: boolean; authBox: ReactNode;
  chip: { ok: boolean; text: string };
  onMethod: (m: 'google' | 'email') => void;
  gmail: string; gmailOk: boolean; gmailErr?: string; onGmail: (v: string) => void;
  gm: GmailState; onSend: () => void; onGmCode: (c: string) => void; onGmVerify: () => void;
}) {
  const step = (n: number, h: string, t: string) => (
    <li className="cp-stp"><span className="cp-stp__n">{n}</span><div><b>{h}</b><span>{t}</span></div></li>
  );
  const opts: { m: 'google' | 'email'; t: string; d: string; ro: string; ico: string }[] = [
    { m: 'google', t: 'Authenticator app', d: 'Scan a QR code once — Google / Microsoft Authenticator, Authy …', ro: 'Code from the linked authenticator app', ico: CP_I.phone },
    { m: 'email', t: 'Gmail', d: 'A 6-digit code is emailed to a Gmail address each time', ro: 'Code emailed to a Gmail address', ico: CP_I.mail },
  ];
  return (
    <div className="cp-fcard cp-fcard--main" id="cpMainCard">
      <div className="cp-frow cp-frow--main">
        <span className="cp-frow__ico"><Svg d={CP_I.admin} size={16} /></span>
        <div className="cp-frow__t">
          <b>Two-factor authentication on Kryptone</b>
          <span>Each time someone opens this credential or copies its password, Kryptone asks for a 6-digit code — from an authenticator app or sent to Gmail.</span>
        </div>
        <span className={`cp-chip ${readOnly || chip.ok ? 'is-ok' : 'is-no'}`} id="cpAuthChip">
          {readOnly
            ? <><Svg d={CP_I.lock} size={11} />{method === 'email' ? 'Gmail' : 'Authenticator app'} · selected</>
            : <>{chip.ok && <Svg d={CP_I.check} size={11} />}{chip.text}</>}
        </span>
      </div>
      <div className="cp-auth k2-auth">
        <div className={`k2-pick${readOnly ? ' k2-pick--ro' : ''}`}>
          {!readOnly && <div className="k2-pick__t">How should Kryptone ask for the code? Choose one</div>}
          <div className="k2-pick__g" role="radiogroup">
            {opts.map(o => {
              const on = o.m === method;
              return (
                <button key={o.m} type="button" data-h40="skip" role="radio" aria-checked={on} disabled={readOnly}
                  onClick={() => { if (!on) onMethod(o.m); }}
                  className={`k2-opt${on ? ' is-on' : ''}${readOnly ? ' k2-opt--ro' : ''}${readOnly && !on ? ' is-off' : ''}`}>
                  <span className="k2-opt__r" />
                  <span className="k2-opt__i"><Svg d={o.ico} size={16} /></span>
                  <span className="k2-opt__t"><b>{o.t}</b><small>{readOnly ? o.ro : o.d}</small></span>
                  {readOnly && on && <span className="k2-opt__sel"><Svg d={CP_I.check} size={11} />Selected</span>}
                </button>
              );
            })}
          </div>
        </div>
        {!readOnly && method === 'google' && (
          <div className="k2-sec">
            <div className="k2-sec__t"><Svg d={CP_I.phone} size={13} />Authenticator app</div>
            {authBox}
          </div>
        )}
        {!readOnly && method === 'email' && (
          <div className="k2-sec">
            <div className="k2-sec__t"><Svg d={CP_I.mail} size={13} />Gmail</div>
            <div className="k2-gm">
              <div className={`k2-gm__f${gmailErr ? ' is-err' : ''}`} data-f="twofa_email">
                <label className="k2-gm__lbl" htmlFor="k2Gmail">Gmail address <i>*</i></label>
                <div className="mapsup-inputwrap">
                  <span className="mapsup-input-ico"><Svg d={CP_I.mail} size={13} /></span>
                  <input id="k2Gmail" className="mapsup-finput has-ico" type="email" placeholder="name@gmail.com" autoComplete="off" maxLength={191}
                    value={gmail} onChange={e => onGmail(e.target.value)} />
                  {!gm.verified && (
                    <button type="button" className="cp-btn cp-btn--ghost k2-gm__send" onClick={onSend}
                      disabled={!gmailOk || gm.sending || gm.wait > 0}>
                      {gm.sending ? 'Sending…' : gm.wait > 0 ? `Resend in ${gm.wait}s` : gm.token ? 'Resend code' : 'Send code'}
                    </button>
                  )}
                </div>
                <div className="cp-err">{gmailErr}</div>
                {gm.verified ? (
                  <div className="k2-gm__ok"><Svg d={CP_I.check} size={13} /><span><b>Gmail verified</b> — {gm.sentTo} is linked when you save.</span></div>
                ) : gm.token && (
                  <div data-f="email_otp_code">
                    <CodeRow ico={CP_I.mail} title="Verify Gmail" label={<>Code sent to <b>{gm.sentTo}</b></>} code={gm.code} onCode={onGmCode} onSubmit={onGmVerify}
                      btn="Verify" busy={gm.verifying} error={gm.error} />
                  </div>
                )}
              </div>
              <ol className="cp-stps">
                {step(1, 'Someone opens or copies this credential', 'Kryptone sends a 6-digit code to this Gmail inbox')}
                {step(2, 'They enter the code', 'It works once and expires after 5 minutes')}
                {step(3, 'The credential opens for 5 minutes', 'Every code sent and used is logged')}
              </ol>
              <div className="k2-note">
                <Svg d={CP_I.users} size={13} />
                <span><b>Shared with a team?</b> Use a Gmail inbox everyone who opens this credential can read.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ProtectionValue {
  admin: boolean; manager: boolean; otp: boolean;
}

/** The three steps. `hasMain`: the type's own 2FA switch stands in for step 3. */
export function ProtectionBody({ v, set, policy, hasMain, twofaOn, mainChip, auth, authBox, errors }: {
  v: ProtectionValue; set: (p: Partial<ProtectionValue>) => void;
  policy: { admin: boolean; manager: boolean; otp: boolean };
  hasMain: boolean; twofaOn: boolean;
  /** step 3's chip when the type's 2FA switch stands in for it — mirrors the 2FA card */
  mainChip: { ok: boolean; text: string };
  auth: AuthState; authBox: ReactNode;
  errors: Record<string, string>;
}) {
  const off = 'Turned off by the CredVault policy — a Vault Admin can allow it under Policies';
  const step3Chip = hasMain
    ? <span className={`cp-chip ${!twofaOn ? 'is-off' : mainChip.ok ? 'is-ok' : 'is-no'}`} id="cpStep3Chip">
        {!twofaOn ? '2FA field is off' : <>{mainChip.ok && <Svg d={CP_I.check} size={11} />}{mainChip.text}</>}
      </span>
    : (v.otp ? <AuthChip a={auth} id="cpAuthChip" /> : null);

  return (
    <div className="cp-form mapsup-span-full" style={{ gridColumn: '1/-1' }}>
      <div data-f="lock_admin">
        <Row n={1} ico={CP_I.admin} t="Request access to Vault Admin"
          d="The Vault Admin for this credential's branch (the Branch Admin) must approve, with a reason and a time window. Resolved when access is requested."
          toggle={<StepToggle on={v.admin && policy.admin} disabled={!policy.admin} title={policy.admin ? undefined : off} onChange={x => set({ admin: x })} />} />
      </div>
      <div data-f="lock_manager">
        <Row n={2} ico={CP_I.mgr} t="Request approval from Manager"
          d="After the Vault Admin approves, the requester's own reporting manager must also approve. Resolved per requester when access is requested."
          toggle={<StepToggle on={v.manager && policy.manager} disabled={!policy.manager} title={policy.manager ? undefined : off} onChange={x => set({ manager: x })} />} />
      </div>
      {hasMain ? (
        <Row n={3} ico={CP_I.phone} t="2FA — Authenticator app or Gmail"
          d="Uses the “2FA” field in this form — switch it on and choose an authenticator app or Gmail. A 6-digit code is then needed before this credential opens."
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
