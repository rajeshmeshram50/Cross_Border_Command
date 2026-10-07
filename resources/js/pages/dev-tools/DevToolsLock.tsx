/* The password gate in front of Dev Tools.
 *
 * This modal is a courtesy, not the lock. The page ships in the bundle and the
 * /dev-tools endpoints answer on their own, so the real gate is server-side:
 * every data endpoint returns 423 until POST /dev-tools/unlock has succeeded on
 * this access token. Attempts are counted there too — a counter kept here would
 * reset with the page. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import api from '../../api';

type LockState = {
  unlocked: boolean;
  locked_out: boolean;
  retry_in_seconds: number;
  /** When the lockout ends, ISO8601 from the server. Null when not locked out. */
  retry_at?: string | null;
  /** False when no password is configured anywhere — nobody gets in, so say so. */
  configured: boolean;
  /** Minutes of inactivity before the password is asked for again. */
  idle_minutes: number;
};

const mmss = (s: number) => {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function DevToolsLock({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LockState | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The instant the lockout lifts (ms epoch), not a running number. The ticker
     below re-reads the clock each second, so a throttled background tab catches
     up on return instead of finishing late by however long it was asleep. */
  const [until, setUntil] = useState(0);
  const [wait, setWait] = useState(0);

  const armLockout = (retryAt?: string | null, seconds?: number) => {
    const end = retryAt ? Date.parse(retryAt) : Date.now() + (Number(seconds) || 0) * 1000;
    setUntil(Number.isFinite(end) ? end : 0);
  };
  const inputRef = useRef<HTMLInputElement>(null);

  const read = () => api.get('/dev-tools/lock-state')
    .then(r => {
      const d: LockState = r.data?.data ?? r.data;
      setState(d);
      if (d.locked_out) armLockout(d.retry_at, d.retry_in_seconds); else setUntil(0);
    })
    .catch(() => setState(s => s ?? { unlocked: false, locked_out: false, retry_in_seconds: 0, configured: true, idle_minutes: 3 }));

  useEffect(() => { void read(); }, []);

  /* The idle window runs out on the server, so the page has to find out two
     ways. Any request refused with 423 drops straight back to the prompt... */
  useEffect(() => {
    const id = api.interceptors.response.use(
      r => r,
      err => {
        if (err?.response?.status === 423) setState(s => (s ? { ...s, unlocked: false } : s));
        return Promise.reject(err);
      },
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  /* ...and coming back to the tab re-reads it, so an expired session shows the
     prompt on arrival rather than on the first thing the user clicks. */
  useEffect(() => {
    const onBack = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);

  // Count the lockout down so the box can unlock itself without a reload.
  useEffect(() => {
    if (!until) { setWait(0); return; }
    const tick = () => setWait(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);

  useEffect(() => { if (state && !state.unlocked && wait <= 0) inputRef.current?.focus(); }, [state, wait]);

  /* Start below the header so someone without the password is not trapped —
     they can still reach another module. Measured rather than hard-coded: the
     topbar is fixed at z-index 1002 but the horizontal nav under it is only
     100, so restacking alone would still bury the menu. Heights also differ
     between the horizontal and vertical layouts. */
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => setTop(Math.max(0, ...['#page-topbar', '.topnav']
      .map(s => document.querySelector(s)?.getBoundingClientRect().bottom ?? 0)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0 || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/dev-tools/unlock', { password });
      setState(s => (s ? { ...s, unlocked: true } : s));
      setPassword('');
    } catch (err: any) {
      const res = err?.response;
      setError(res?.data?.message || 'Could not verify that password.');
      if (res?.status === 429) armLockout(res.data?.retry_at, res.data?.retry_in_seconds);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;                 // one request; no flash of the form
  if (state.unlocked) return <>{children}</>;

  const lockedOut = wait > 0;

  return (
    <div className="dtl-backdrop" style={{ top }}>
      <form className="dtl-box" onSubmit={submit}>
        <div className="dtl-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className="dtl-title">Dev Tools is restricted</h2>
        <p className="dtl-sub">
          <b>Developers only.</b> The password is shared with the developer group.
        </p>

        {!state.configured && (
          <div className="dtl-warn" role="alert">
            No developer password is set, so nothing will open this.
            Set one in <code>config/devtools.php</code>.
          </div>
        )}

        <label className="dtl-label" htmlFor="dtl-pw">Developer password</label>
        <input
          id="dtl-pw"
          ref={inputRef}
          className={`dtl-input${error ? ' is-bad' : ''}`}
          type="password"
          autoComplete="off"
          placeholder={lockedOut ? 'Locked' : 'Enter the password'}
          value={password}
          disabled={busy || lockedOut}
          onChange={e => { setPassword(e.target.value); setError(null); }}
        />

        {lockedOut ? (
          <div className="dtl-err" role="alert">
            Too many wrong passwords.
            <span className="dtl-timer" aria-live="off">{mmss(wait)}</span>
          </div>
        ) : error ? (
          <div className="dtl-err" role="alert">{error}</div>
        ) : (
          <div className="dtl-hint">3 wrong answers locks this for 30 minutes.</div>
        )}

        <button type="submit" className="dtl-btn" disabled={busy || lockedOut || !password}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
