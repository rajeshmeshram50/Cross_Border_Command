import { useEffect, useRef, useState } from 'react';
import { useAuth, type LoginOrg, type LoginResult } from '../../contexts/AuthContext';
import AuthCardLayout from '../../layouts/AuthCardLayout';
import { Loader2, Eye, EyeOff, Mail, Lock, ArrowRight, ScanFace } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import FaceLoginModal from '../../components/FaceLoginModal';

interface LoginProps {
  onForgotPassword?: () => void;
}

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export default function Login({ onForgotPassword }: LoginProps) {
  const { login, googleLogin, faceLogin, loading } = useAuth();
  // Face-login modal state. The modal handles its own email field + face
  // capture; we just pipe its result through AuthContext.faceLogin.
  const [faceOpen, setFaceOpen] = useState(false);
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const handleCredentialRef = useRef<(resp: { credential?: string }) => void>(() => {});
  // Organization picker — shown when an email exists in more than one client
  // and the backend asks which one to sign in to. `retry` re-runs the same
  // login (password or Google) with the chosen client_id.
  const [orgPrompt, setOrgPrompt] = useState<{ organizations: LoginOrg[]; message?: string; retry: (clientId: number | null) => Promise<void> } | null>(null);
  /* WHICH organization is signing in, not merely THAT one is. (#19)
   *
   * A single boolean put the spinner on every row at once, so the dialog said
   * all of them were being signed into. The key identifies the chosen row;
   * null means idle, and every row stays disabled while one is in flight. */
  const [orgBusyKey, setOrgBusyKey] = useState<string | null>(null);
  const orgBusy = orgBusyKey !== null;

  /* Say WHY the user is looking at a login form they didn't ask for.
   *
   * api.ts writes `cbc_last_auth_error` whenever a 401 forces a logout — the
   * usual cause being a tab left idle until its token expired. Nothing read
   * that key, so the user was simply thrown back to /login mid-task with no
   * explanation, which reads as the app having crashed.
   *
   * Cleared on read: it explains THIS redirect only, and must not resurface on
   * the next manual visit to /login. Wrapped in try/catch because storage
   * access throws in private-browsing modes, and a diagnostic must never be
   * the thing that breaks sign-in. */
  useEffect(() => {
    let stale: string | null = null;
    try {
      stale = localStorage.getItem('cbc_last_auth_error');
      if (stale) localStorage.removeItem('cbc_last_auth_error');
    } catch { /* no storage — nothing to explain */ }
    if (!stale) return;
    toast.warning('Session expired', 'You were signed out for security. Please sign in again.');
    // toast identity is stable for the life of the provider; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Common handling for a final (non-org-prompt) login result.
  const applyResult = (result: LoginResult, failTitle: string) => {
    if (result.success) {
      setOrgPrompt(null);
      toast.success('Welcome back!', 'You have been logged in successfully');
    } else {
      toast.error(failTitle, result.error || 'Could not sign in');
    }
  };

  // Load Google Identity Services script once, initialize, and render the official Google button.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    /* Width the button was last drawn at. The guard below is what stops the
       ResizeObserver from feeding itself: clearing the host collapses it to its
       44px min-height and Google's iframe grows it back, and ResizeObserver
       fires on HEIGHT as well as width — so an unguarded re-render triggered
       the next one and the page downloaded a fresh 56 kB button iframe, its
       avatar and its font on a loop until the tab was closed. */
    let lastWidth = -1;

    const renderBtn = (force = false) => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      // Measured BEFORE clearing — the host is w-full, so this is the layout
      // width and does not depend on what is currently inside it.
      // Measured on the pill's wrapper: the host itself is sized to Google's
      // button and scaled up over the pill (below).
      const pill = googleBtnRef.current.parentElement ?? googleBtnRef.current;
      const measured = pill.offsetWidth;
      // Google button max width is 400; clamp here.
      const width = Math.min(Math.max(measured || 320, 200), 400);
      // Google's button is invisible and stretched over our own pill (see the
      // markup below), so it must cover the pill at any size: Google draws it
      // 200-400 x 40, and these factors scale it to the pill's box.
      const pillH = pill.offsetHeight || 44;
      googleBtnRef.current.style.setProperty('--kx-gw', `${width}px`);
      googleBtnRef.current.style.setProperty('--kx-gsx', String((measured || width) / width));
      googleBtnRef.current.style.setProperty('--kx-gsy', String(pillH / 40));
      // Nothing the button would be drawn differently for. Return before
      // touching the DOM, so this callback causes no resize of its own.
      if (!force && width === lastWidth) return;
      lastWidth = width;
      googleBtnRef.current.innerHTML = '';
      // Always the white 'outline' pill: the sign-in card is dark glass in
      // both themes now, and the design pairs a white Google pill with the
      // white Microsoft one beside it.
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'left',
        width,
      });
    };

    const init = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp: { credential?: string }) => handleCredentialRef.current(resp),
        ux_mode: 'popup',
        use_fedcm_for_prompt: false,
      });
      renderBtn();
    };

    if (window.google?.accounts?.id) {
      init();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', init);
      } else {
        const script = document.createElement('script');
        script.src = GOOGLE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = init;
        document.head.appendChild(script);
      }
    }

    // Re-render the Google button when its container width changes (responsive).
    const ro = googleBtnRef.current && 'ResizeObserver' in window
      ? new ResizeObserver(() => renderBtn())
      : null;
    if (ro && googleBtnRef.current) ro.observe(googleBtnRef.current.parentElement ?? googleBtnRef.current);
    return () => { ro?.disconnect(); };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email || !password) { toast.warning('Missing fields', 'Please enter email and password'); return; }
    const result = await login(email, password);
    if (result.needsOrgSelection) {
      setOrgPrompt({
        organizations: result.organizations || [],
        message: result.message,
        retry: async (clientId) => { applyResult(await login(email, password, clientId), 'Login Failed'); },
      });
      return;
    }
    applyResult(result, 'Login Failed');
  };

  // Updated each render so the GIS callback captures the latest closures.
  handleCredentialRef.current = async (resp) => {
    if (!resp?.credential) {
      toast.error('Google Sign-In', 'No credential returned from Google');
      return;
    }
    const credential = resp.credential;
    const result = await googleLogin(credential);
    if (result.needsOrgSelection) {
      setOrgPrompt({
        organizations: result.organizations || [],
        message: result.message,
        retry: async (clientId) => { applyResult(await googleLogin(credential, clientId), 'Google Sign-In Failed'); },
      });
      return;
    }
    applyResult(result, 'Google Sign-In Failed');
  };

  return (
    <AuthCardLayout
      title="Welcome Back"
      subtitle="Access your unified enterprise workspace."
    >
      <form onSubmit={handleSubmit} className="kx-form">
        <label className="kx-field">
          <Mail className="kx-field-ico" strokeWidth={1.6} />
          <span className="kx-field-body">
            <span className="kx-field-label">Email ID</span>
            <input
              required
              type="email"
              autoComplete="username"
              className="kx-input"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </span>
        </label>

        <label className="kx-field">
          <Lock className="kx-field-ico" strokeWidth={1.6} />
          <span className="kx-field-body">
            <span className="kx-field-label">Password</span>
            <input
              required
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="kx-input"
              placeholder="•••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </span>
          <button
            type="button"
            className="kx-eye"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
          </button>
        </label>

        <div className="kx-row">
          <label className="kx-remember">
            <input type="checkbox" defaultChecked />
            <span className="kx-check" aria-hidden>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Remember Me
          </label>
          <button type="button" className="kx-link" onClick={onForgotPassword}>
            Forgot password?
          </button>
        </div>

        {/* Loading keeps the button at full colour and the same size: a light
            sweeps across it and a thin ring replaces the arrow. */}
        <button type="submit" className={`kx-submit${loading ? ' is-loading' : ''}`} disabled={loading} aria-busy={loading}>
          <span className="kx-submit-label">{loading ? 'Signing in' : 'Log In'}</span>
          {loading
            ? <span className="kx-spin" aria-hidden />
            : <ArrowRight className="kx-submit-arrow" strokeWidth={1.8} />}
        </button>
      </form>

      <div className="kx-or">OR CONTINUE WITH</div>

      <div className="kx-social">
        {GOOGLE_CLIENT_ID ? (
          /* Our pill is what shows, so it matches the Face pill at every zoom
             and screen size. Google's own button (an iframe) is laid invisibly
             over it and takes the click, so sign-in is Google's official flow.
             If Google never loads, the click reaches our pill instead. */
          <div className="kx-google-wrap">
            <button
              type="button"
              className="kx-social-btn"
              tabIndex={-1}
              onClick={() => toast.error('Google Sign-In', 'Google sign-in could not load. Check your connection, or allow third-party cookies for accounts.google.com, then refresh.')}
            >
              <GoogleGlyph />Sign in with Google
            </button>
            <div ref={googleBtnRef} className="cbc-google-btn kx-google" />
          </div>
        ) : (
          <button
            type="button"
            className="kx-social-btn"
            onClick={() => toast.info('Google Sign-In', 'Google sign-in is not configured for this environment.')}
          >
            <GoogleGlyph />Sign in with Google
          </button>
        )}
        {/* Face sign-in — the existing FaceLoginModal flow. */}
        <button type="button" className="kx-social-btn" onClick={() => setFaceOpen(true)}>
          <ScanFace className="kx-face-ico" strokeWidth={2} />Sign in with Face
        </button>
      </div>

      <FaceLoginModal
        open={faceOpen}
        onClose={() => setFaceOpen(false)}
        initialEmail={email}
        onSubmit={faceLogin}
      />

      {orgPrompt && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => { if (!orgBusy) setOrgPrompt(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-slate-800 mb-1">Choose your organization</h3>
            <p className="text-[12.5px] text-slate-500 mb-4">
              {orgPrompt.message || 'This email is registered with more than one organization. Pick which one to sign in to.'}
            </p>
            <div className="space-y-2">
              {orgPrompt.organizations.map((org, i) => {
                const key = `${org.client_id ?? 'null'}-${i}`;
                const isBusy = orgBusyKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={orgBusy}
                    aria-busy={isBusy}
                    onClick={async () => {
                      setOrgBusyKey(key);
                      try { await orgPrompt.retry(org.client_id); } finally { setOrgBusyKey(null); }
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-primary hover:bg-primary/5 transition-all text-[13px] font-semibold text-slate-700 disabled:opacity-60 flex items-center justify-between gap-2"
                  >
                    <span>{org.name}</span>
                    {/* Only the row being signed into spins. The others stay
                        disabled — a second choice mid-request would race the
                        first — but they are not pretending to be busy. */}
                    {isBusy ? <Loader2 size={15} className="animate-spin text-slate-400" /> : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={orgBusy}
              onClick={() => setOrgPrompt(null)}
              className="mt-4 w-full text-[12px] font-semibold text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-0"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </AuthCardLayout>
  );
}

/* Google's mark for the fallback sign-in pill, in its official colours. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
