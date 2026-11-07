import { useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type Loose } from '../cvApi';
import { CvPortal, Svg, errMsg, useCvMeta } from '../shared';
import { IR_I, ImportVeil } from './irShared';

/* Download backup popup — the prototype's irBackupHtml / bkCreate; the file is built and locked on the API
   (a locked backup is an .xlsx with Excel's own password, no zip; a CSV cannot hold a password). */

type Fmt = 'xlsx' | 'csv';
type Scope = 'mine' | 'team' | 'all';
const FMTS: [Fmt, string, string, string, string][] = [
  ['xlsx', 'Excel', '.xlsx', 'Opens in Excel & Google Sheets', IR_I.sheet],
  ['csv', 'CSV', '.csv', 'For other password managers', IR_I.file],
];
const SCOPES: [Scope, string, string, string][] = [
  ['mine', 'My Vault', 'Credentials you own', IR_I.user],
  ['team', 'Team Vault', 'Shared with your teams', IR_I.team],
  ['all', 'All vaults', 'Everything you manage', IR_I.db],
];
const LV = ['none', 'weak', 'fair', 'good', 'strong'];
const LBL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/** A quick 0–4 score for the meter; the API enforces the real minimum (8 characters). */
function pwScore(p: string): number {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  if (p.length < 8) s = Math.min(s, 1);
  if (p.length >= 14 && s === 3) s = 4;
  return Math.max(1, s);
}

export interface BackupInfo { scopes: Loose[]; columns: Loose | null; lock_note: string }

export default function BackupModal({ info, infoError = '', infoLoading = false, onRetry, onDone, onClose }: {
  info: BackupInfo | null;
  /** Set when GET /backups failed before any backup options arrived — Download stays off until a retry succeeds. */
  infoError?: string; infoLoading?: boolean; onRetry?: () => void;
  /** After every attempt (failed ones are recorded too) — refreshes the history. */
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const { meta } = useCvMeta();
  const [fmt, setFmt] = useState<Fmt>('xlsx');
  const [scope, setScope] = useState<Scope>('mine');
  const [withPw, setWithPw] = useState(true);
  const [lock, setLock] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<CvApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const F = FMTS.find(f => f[0] === fmt)!;
  // Only Excel can carry a password; a CSV is always downloaded unlocked.
  const canLock = fmt === 'xlsx';
  const locked = lock && canLock;
  const countOf = (k: Scope): number | null => {
    const s = info?.scopes.find(x => x.scope === k);
    return s ? Number(s.count) : null;
  };
  const n = countOf(scope);
  const score = pwScore(pw);
  const ferr = (k: string) => err?.field(k);
  const clearErr = () => setErr(null);

  const create = async () => {
    setErr(null);
    if (locked && pw.length < 8) { setErr(new CvApiError('Choose a password of at least 8 characters.', 422, { password: ['Choose a password of at least 8 characters.'] })); return; }
    setBusy(true);
    try {
      const r = await cvApi.backup({
        format: fmt, scope, include_passwords: withPw, lock: locked,
        ...(locked ? { password: pw, password_confirmation: pw2 } : {}),
      });
      const code = r.headers['x-credvault-code'] ?? '';
      const items = Number(r.headers['x-credvault-items'] ?? n ?? 0);
      const withheld = Number(r.headers['x-credvault-withheld'] ?? 0);
      toast.success(`${code ? `${code} · ` : ''}${items} credentials downloaded as ${F[1]}${locked ? ' · password locked' : ''}`,
        withheld ? `${withheld} protected secret${withheld > 1 ? 's were' : ' was'} left out — they open through an unlock, not a file.` : undefined);
      setPw(''); setPw2('');
      onDone();
      onClose();
    } catch (e) {
      const ae = e instanceof CvApiError ? e : new CvApiError(errMsg(e));
      if (ae.field('password_confirmation')) ae.message = 'The two passwords don’t match. This attempt was recorded.';
      setErr(ae);
      setBusy(false);
      onDone(); // failed attempts are recorded in the history too
    }
  };
  const close = () => { if (!busy) onClose(); };

  const eyeBtn = (k: string) => (
    <button type="button" data-h40="skip" aria-label={show[k] ? 'Hide' : 'Show'} onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}>
      <Svg d={show[k] ? IR_I.eyeoff : IR_I.eye} size={14} />
    </button>
  );
  const sec = (num: number, t: string, s: string) => <div className="ix-sec"><span>{num}</span><div><b>{t}</b><small>{s}</small></div></div>;

  return (
    <CvPortal onClose={close}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box ir-bk-box" role="dialog" aria-modal="true" aria-label="Download backup">
            {busy && <ImportVeil label={`Preparing your ${F[1]} backup…`} />}
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={IR_I.db} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Download backup</h3>
                    <p className="mapsup-sub">Choose the format, the vault and how to protect the file.</p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={close} disabled={busy} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            {/* Its own <form> with a hidden username box: when a saved password is picked for the backup
                password, the browser fills that login's email in here — not into the page's search box. */}
            <form className="mapsup-body gp-body ir-imp-body ir-bk-body" autoComplete="off" noValidate onSubmit={e => e.preventDefault()}>
        <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="ir-ac-trap" />
        {sec(1, 'Choose a format', 'The file type you want to download')}
        <div className="ix-fmtc">
          {FMTS.map(f => (
            <button key={f[0]} type="button" data-h40="skip" className={fmt === f[0] ? 'is-on' : ''} onClick={() => { setFmt(f[0]); clearErr(); }}>
              <span className="ix-fmtc__ico"><Svg d={f[4]} size={18} /></span><b>{f[1]}</b><em>{f[2]}</em><small>{f[3]}</small>
              <i className="ix-fmtc__ck"><Svg d={IR_I.tick} size={10} /></i>
            </button>
          ))}
        </div>
        {ferr('format') && <span className="cv-ferr">{ferr('format')}</span>}

        {sec(2, 'Choose what to include', 'Pick the vault and whether passwords are in the file')}
        <div className="ix-scope">
          {SCOPES.map(s => {
            const c = countOf(s[0]);
            return (
              <button key={s[0]} type="button" data-h40="skip" className={scope === s[0] ? 'is-on' : ''} onClick={() => { setScope(s[0]); clearErr(); }}>
                <Svg d={s[3]} size={14} /><span><b>{s[1]}</b><small>{c === null ? s[2] : `${c} credentials`}</small></span>
              </button>
            );
          })}
        </div>
        {ferr('scope') && <span className="cv-ferr">{ferr('scope')}</span>}
        <label className={`ix-sw${withPw ? ' is-on' : ''}`}>
          <input type="checkbox" checked={withPw} onChange={e => { setWithPw(e.target.checked); clearErr(); }} />
          <span className="ix-sw__t"><i /></span>
          <span><b>Include passwords</b><small>{withPw ? 'Passwords are written into the file' : 'Only names, usernames and links — no passwords'}</small></span>
        </label>

        {sec(3, 'Lock the file with a password', 'Anyone opening the backup will be asked for it')}
        <label className={`ix-sw ix-sw--lock${locked ? ' is-on' : ''}${canLock ? '' : ' is-disabled'}`}>
          <input type="checkbox" checked={locked} disabled={!canLock} onChange={e => { setLock(e.target.checked); clearErr(); }} />
          <span className="ix-sw__t"><i /></span>
          <span>
            <b>{locked ? 'Password lock is on' : 'Password lock is off'}</b>
            <small>{!canLock ? 'A CSV file can’t hold a password — choose Excel to lock the backup' : locked ? 'The Excel file itself is locked — Excel asks for this password when it opens' : 'The file can be opened by anyone who has it'}</small>
          </span>
          <Svg d={locked ? IR_I.lock : IR_I.unlock} size={16} />
        </label>
        {ferr('lock') && <span className="cv-ferr">{ferr('lock')}</span>}

        {locked ? (
          <>
            <div className="ix-pwrow">
              <div className="ix-f">
                <label>Backup password <i>*</i></label>
                <div className="ix-in">
                  <input type={show.pw ? 'text' : 'password'} placeholder="At least 8 characters" autoComplete="new-password" value={pw} onChange={e => { setPw(e.target.value); clearErr(); }} />
                  {eyeBtn('pw')}
                </div>
                <div className={`ix-meter ix-meter--${LV[score]}`}><div><i /><i /><i /><i /></div><span>{pw ? (meta?.strengths?.[score] ?? LBL[score]) : 'Use 8+ characters with letters, numbers & symbols'}</span></div>
                {ferr('password') && <span className="cv-ferr">{ferr('password')}</span>}
              </div>
              <div className="ix-f">
                <label>Confirm password <i>*</i></label>
                <div className="ix-in">
                  <input type={show.pw2 ? 'text' : 'password'} placeholder="Type it again" autoComplete="new-password" value={pw2} onChange={e => { setPw2(e.target.value); clearErr(); }} />
                  {eyeBtn('pw2')}
                </div>
                <div className={`ix-match${pw2 ? (pw2 === pw ? ' is-ok' : ' is-bad') : ''}`}>{pw2 ? (pw2 === pw ? 'Passwords match' : 'Passwords don’t match') : ''}</div>
                {ferr('password_confirmation') && <span className="cv-ferr">{ferr('password_confirmation')}</span>}
              </div>
            </div>
            <div className="ix-note"><Svg d={IR_I.warn} size={13} /><span>Keep this password safe — CredVault does not store it, so a lost password cannot be recovered.</span></div>
          </>
        ) : (
          <>
            <div className="ix-note is-warn"><Svg d={IR_I.warn} size={13} /><span>{withPw ? 'Without a lock, the passwords in this file can be read by anyone who gets it.' : 'This file has no passwords, but it still lists your accounts and usernames.'}</span></div>
          </>
        )}
        <div className="ir-err">{err?.message ?? ''}</div>
        {!info && infoError && (
          <div className="ir-err">
            Could not load the backup options — {infoError}{' '}
            {onRetry && <button type="button" data-h40="skip" className="ir-btn" onClick={onRetry} disabled={infoLoading}>{infoLoading ? 'Retrying…' : 'Retry'}</button>}
          </div>
        )}
            </form>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg d={IR_I.hist} size={12} /> Every download is recorded in the backup history and in Audit Logs</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" onClick={create} disabled={!n || busy}>
                  <Svg d={IR_I.down} size={13} sw={2.1} />{busy ? 'Preparing…' : `Download ${F[1]} Backup${locked ? ' · Locked' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
