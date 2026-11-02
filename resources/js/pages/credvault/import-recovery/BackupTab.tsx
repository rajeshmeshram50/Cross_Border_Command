import { useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type Loose, type TransferRow } from '../cvApi';
import { Svg, bytes, errMsg, timeAgo, useCvMeta } from '../shared';
import { IR_I, IrCard } from './irShared';

/* Backup tab — the prototype's irBackupHtml / bkCreate; the file is built and locked (AES-256) on the API. */

type Fmt = 'xlsx' | 'csv' | 'json';
type Scope = 'mine' | 'team' | 'all';
const FMTS: [Fmt, string, string, string, string][] = [
  ['xlsx', 'Excel', '.xlsx', 'Opens in Excel & Google Sheets', IR_I.sheet],
  ['csv', 'CSV', '.csv', 'For other password managers', IR_I.file],
  ['json', 'JSON', '.json', 'For developers & tools', IR_I.code],
];
const SCOPES: [Scope, string, string, string][] = [
  ['mine', 'My Vault', 'Credentials you own', IR_I.user],
  ['team', 'Team Vault', 'Shared with your teams', IR_I.team],
  ['all', 'All vaults', 'Everything you manage', IR_I.db],
];
const DEFAULT_COLS = ['Name', 'Type', 'Category', 'Website', 'Username', 'Password', 'Owner', 'Vault', 'Risk', '2FA', 'Rotation', 'Notes', 'Updated'];
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

export default function BackupTab({ info, history, infoError = '', infoLoading = false, onRetry, onDone }: {
  info: BackupInfo | null; history: TransferRow[];
  /** Set when GET /backups failed before any backup options arrived — Download stays off until a retry succeeds. */
  infoError?: string; infoLoading?: boolean; onRetry?: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { meta } = useCvMeta();
  const [fmt, setFmt] = useState<Fmt>('xlsx');
  const [scope, setScope] = useState<Scope>('mine');
  const [withPw, setWithPw] = useState(true);
  const [lock, setLock] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [acct, setAcct] = useState('');
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<CvApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const F = FMTS.find(f => f[0] === fmt)!;
  const S = SCOPES.find(s => s[0] === scope)!;
  const countOf = (k: Scope): number | null => {
    const s = info?.scopes.find(x => x.scope === k);
    return s ? Number(s.count) : null;
  };
  const n = countOf(scope);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = `credvault-${scope}-backup-${stamp}`;
  const fname = lock ? `${base}.zip` : base + F[2];
  const cols: string[] = (withPw ? info?.columns?.with_passwords : info?.columns?.without_passwords) ?? DEFAULT_COLS.filter(c => withPw || c !== 'Password');
  const score = pwScore(pw);
  const needAcct = withPw && !lock;
  const recent = history.filter(h => h.by_me).slice(0, 3);
  const ferr = (k: string) => err?.field(k);
  const clearErr = () => setErr(null);

  const create = async () => {
    setErr(null);
    if (lock && pw.length < 8) { setErr(new CvApiError('Choose a password of at least 8 characters.', 422, { password: ['Choose a password of at least 8 characters.'] })); return; }
    setBusy(true);
    try {
      const r = await cvApi.backup({
        format: fmt, scope, include_passwords: withPw, lock,
        ...(lock ? { password: pw, password_confirmation: pw2 } : {}),
        ...(needAcct ? { account_password: acct } : {}),
      });
      const code = r.headers['x-credvault-code'] ?? '';
      const items = Number(r.headers['x-credvault-items'] ?? n ?? 0);
      const withheld = Number(r.headers['x-credvault-withheld'] ?? 0);
      toast.success(`${code ? `${code} · ` : ''}${items} credentials downloaded as ${F[1]}${lock ? ' · password locked' : ''}`,
        withheld ? `${withheld} protected secret${withheld > 1 ? 's were' : ' was'} left out — they open through an unlock, not a file.` : undefined);
      setPw(''); setPw2(''); setAcct('');
    } catch (e) {
      const ae = e instanceof CvApiError ? e : new CvApiError(errMsg(e));
      if (ae.field('password_confirmation')) ae.message = 'The two passwords don’t match. This attempt was recorded.';
      setErr(ae);
    } finally {
      setBusy(false);
      onDone(); // failed attempts are recorded in the history too
    }
  };

  const eyeBtn = (k: string) => (
    <button type="button" data-h40="skip" aria-label={show[k] ? 'Hide' : 'Show'} onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}>
      <Svg d={show[k] ? IR_I.eyeoff : IR_I.eye} size={14} />
    </button>
  );
  const sec = (num: number, t: string, s: string) => <div className="ix-sec"><span>{num}</span><div><b>{t}</b><small>{s}</small></div></div>;

  return (
    <div className="ix-grid ix-grid--bk">
      <IrCard icon={IR_I.db} title="Backup settings" sub="Choose the format, the vault and how to protect the file">
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
        <label className={`ix-sw ix-sw--lock${lock ? ' is-on' : ''}`}>
          <input type="checkbox" checked={lock} onChange={e => { setLock(e.target.checked); clearErr(); }} />
          <span className="ix-sw__t"><i /></span>
          <span><b>{lock ? 'Password lock is on' : 'Password lock is off'}</b><small>{lock ? `Your ${F[1]} file is placed in a password-protected .zip` : 'The file can be opened by anyone who has it'}</small></span>
          <Svg d={lock ? IR_I.lock : IR_I.unlock} size={16} />
        </label>

        {lock ? (
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
            {needAcct && (
              <div className="ix-pwrow">
                <div className="ix-f">
                  <label>Your account password <i>*</i></label>
                  <div className="ix-in">
                    <input type={show.acct ? 'text' : 'password'} placeholder="Confirm it’s you" autoComplete="current-password" value={acct} onChange={e => { setAcct(e.target.value); clearErr(); }} />
                    {eyeBtn('acct')}
                  </div>
                  {ferr('account_password') && <span className="cv-ferr">{ferr('account_password')}</span>}
                </div>
              </div>
            )}
          </>
        )}
        <div className="ir-err">{err?.message ?? ''}</div>
      </IrCard>

      <IrCard icon={IR_I.down} title="Your backup" sub="Check what you are about to download" className="ix-sum">
        <div className="ix-file">
          <div className={`ix-file__ico${lock ? ' is-lock' : ''}`}>
            <Svg d={lock ? IR_I.zip : F[4]} size={28} />
            {lock && <span><Svg d={IR_I.lock} size={12} /></span>}
          </div>
          <div className="ix-file__t"><small>You will download</small><b>{fname}</b><em>{lock ? `Contains ${base}${F[2]}` : `${F[1]} file`}</em></div>
        </div>
        <div className="ix-sumg">
          {([['Credentials', n ?? '—'], ['Vault', S[1]], ['Format', F[1]], ['Passwords', withPw ? 'Included' : 'Left out']] as const).map(([l, v]) => (
            <div key={l}><small>{l}</small><b>{v}</b></div>
          ))}
        </div>
        <div className={`ix-prot ${lock ? 'is-on' : withPw ? 'is-bad' : 'is-warn'}`}>
          <Svg d={lock ? IR_I.shield : IR_I.warn} size={18} />
          <div>
            <b>{lock ? 'Protected with a password' : 'Not protected'}</b>
            <small>{lock ? (info?.lock_note || 'Locked with AES-256 — open it with 7-Zip, WinRAR or another AES-capable zip tool.') : 'Turn on the password lock for any backup that contains passwords'}</small>
          </div>
        </div>
        <div className="ix-colsl"><small>Columns in the file</small><div>{cols.map(c => <span key={c} className={c === 'Password' ? 'is-pw' : undefined}>{c}</span>)}</div></div>
        <div className="ix-rec">
          <small>Your recent downloads</small>
          {recent.length ? recent.map(h => {
            const failed = h.status === 'failed';
            return (
              <div className="ix-rec__i" key={h.id}>
                <span className={failed ? 'is-bad' : h.locked ? 'is-on' : 'is-warn'}><Svg d={failed ? IR_I.warn : h.locked ? IR_I.lock : IR_I.unlock} size={12} /></span>
                <div>
                  <b>{h.code} · {h.format_label} · {h.scope_label}</b>
                  <small>{timeAgo(h.at)} · {failed ? `Failed — ${h.failure_reason ?? ''}` : `${h.items} items · ${bytes(h.size_bytes)}${h.locked ? ' · locked' : ' · not locked'}`}</small>
                </div>
              </div>
            );
          }) : <em>No downloads yet</em>}
        </div>
        {!info && infoError && (
          <div className="ir-err">
            Could not load the backup options — {infoError}{' '}
            {onRetry && <button type="button" data-h40="skip" className="ir-btn" onClick={onRetry} disabled={infoLoading}>{infoLoading ? 'Retrying…' : 'Retry'}</button>}
          </div>
        )}
        <button type="button" data-h40="skip" className="ir-btn ir-btn--pri ir-btn--full ix-dl" onClick={create} disabled={!n || busy}>
          <Svg d={IR_I.down} size={15} />{busy ? 'Preparing…' : `Download ${F[1]} Backup${lock ? ' · Locked' : ''}`}
        </button>
        <small className="ix-logged"><Svg d={IR_I.hist} size={11} />Every download is recorded in the history below and in Audit Logs</small>
      </IrCard>
    </div>
  );
}
