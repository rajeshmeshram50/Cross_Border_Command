import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AuthCardLayout from '../../layouts/AuthCardLayout';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { LogIn, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
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

  // Load Google Identity Services script once, initialize, and render the official Google button.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const renderBtn = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      googleBtnRef.current.innerHTML = '';
      const measured = googleBtnRef.current.offsetWidth;
      // Google button max width is 400; clamp here.
      const width = Math.min(Math.max(measured || 320, 200), 400);
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
    if (ro && googleBtnRef.current) ro.observe(googleBtnRef.current);
    return () => { ro?.disconnect(); };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email || !password) { toast.warning('Missing fields', 'Please enter email and password'); return; }
    const result = await login(email, password);
    if (!result.success) {
      toast.error('Login Failed', result.error || 'Invalid credentials');
    } else {
      toast.success('Welcome back!', 'You have been logged in successfully');
    }
  };

  // Updated each render so the GIS callback captures the latest closures.
  handleCredentialRef.current = async (resp) => {
    if (!resp?.credential) {
      toast.error('Google Sign-In', 'No credential returned from Google');
      return;
    }
    const result = await googleLogin(resp.credential);
    if (!result.success) {
      toast.error('Google Sign-In Failed', result.error || 'Could not sign in with Google');
    } else {
      toast.success('Welcome back!', 'You have been logged in successfully');
    }
  };

  return (
    <AuthCardLayout
      title="Access Command Center"
      subtitle="Enter your secure credentials to manage your global operations."
    >
      <div className="space-y-3">
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-primary-hover ml-0.5">Email Id</label>
            <Input
              required
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-10 px-3 text-[13px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[10px] hover:border-primary/30"
            />
          </div>

          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-primary-hover ml-0.5">Password</label>
            {/* Custom show/hide toggle. Edge auto-injects its own ::-ms-reveal
                eye button on every <input type="password">, which collided
                with our custom one (two eye icons in Edge, none in Chrome).
                The inline <style> below hides Edge's native reveal so the
                custom button below behaves identically across browsers. */}
            <style>{`
              input[type="password"]::-ms-reveal,
              input[type="password"]::-ms-clear {
                display: none !important;
                width: 0;
                height: 0;
              }
            `}</style>
            <div className="relative">
              <Input
                required
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-10 px-3 text-[13px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[10px] hover:border-primary/30 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors p-0 bg-transparent border-0"
                style={{ lineHeight: 0 }}
              >
                {showPassword
                  ? <EyeOff size={17} strokeWidth={2} />
                  : <Eye size={17} strokeWidth={2} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            {/* Custom-styled Remember Me — replaces the default browser
                checkbox with a polished inset square + amber check tick
                that animates in on toggle. Whole label is the hit target. */}
            <label className="cbc-remember">
              <input type="checkbox" className="cbc-remember-input" />
              <span className="cbc-remember-box" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="cbc-remember-text">Remember Me</span>
              <style>{`
                .cbc-remember {
                  display: inline-flex;
                  align-items: center;
                  gap: 9px;
                  cursor: pointer;
                  user-select: none;
                  -webkit-tap-highlight-color: transparent;
                }
                .cbc-remember-input {
                  position: absolute;
                  opacity: 0;
                  pointer-events: none;
                }
                .cbc-remember-box {
                  width: 18px;
                  height: 18px;
                  border-radius: 5px;
                  background: rgba(255,255,255,0.65);
                  border: 1.5px solid rgba(99,102,241,0.30);
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  flex-shrink: 0;
                  color: transparent;
                  transition:
                    background 180ms ease,
                    border-color 180ms ease,
                    color 180ms ease,
                    transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
                    box-shadow 180ms ease;
                }
                .cbc-remember-box svg { width: 12px; height: 12px; }
                .cbc-remember:hover .cbc-remember-box {
                  border-color: rgba(99,102,241,0.55);
                  background: #ffffff;
                }
                .cbc-remember-input:focus-visible + .cbc-remember-box {
                  box-shadow: 0 0 0 3px rgba(99,102,241,0.25);
                }
                .cbc-remember-input:checked + .cbc-remember-box {
                  background: linear-gradient(135deg, #6366f1, #8b5cf6);
                  border-color: transparent;
                  color: #ffffff;
                  transform: scale(1.05);
                  box-shadow: 0 4px 12px rgba(99,102,241,0.30);
                }
                .cbc-remember-text {
                  font-size: 12.5px;
                  font-weight: 600;
                  color: #475569;
                  letter-spacing: -0.005em;
                  transition: color 180ms ease;
                }
                .cbc-remember:hover .cbc-remember-text {
                  color: #6366f1;
                }
              `}</style>
            </label>
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-[12px] font-bold text-primary hover:underline hover-scale transition-all"
            >
              Forgot password?
            </button>
          </div>

          <div className="pt-1">
            <button
              disabled={loading}
              className="w-full btn-gradient-primary h-11 rounded-full  text-white text-[14px] font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover hover-lift hover-scale transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              type="submit"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Logging In...' : 'Log In'}
            </button>
          </div>
        </form>

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">or continue with</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <div ref={googleBtnRef} className="w-full flex justify-center min-h-[44px]" />

        {/* Face-based sign-in. Visually distinct from the email + Google
            paths so it reads as the "premium" option — gradient pill with
            a pulsing scanner-style face icon, brand-coloured glow shadow,
            and a lift on hover. Backend still demands an email so the
            descriptor compare is scoped to ONE enrolled user — there's
            no "any face wins" attack surface. */}
        <button
          type="button"
          onClick={() => setFaceOpen(true)}
          className="cbc-face-btn w-full mt-2 h-12 rounded-full text-[13.5px] font-bold text-white flex items-center justify-center gap-3"
        >
          <span className="cbc-face-icon">
            <i className="ri-user-smile-line" />
            <span className="cbc-face-pulse" />
          </span>
          Sign in with Face
        </button>
        <style>{`
          .cbc-face-btn {
            position: relative;
            border: 0;
            background: linear-gradient(135deg,
              #0ea5e9 0%,
              #6366f1 35%,
              #a855f7 65%,
              #ec4899 100%);
            background-size: 200% 200%;
            background-position: 0% 50%;
            box-shadow:
              0 12px 28px rgba(99,102,241,0.32),
              0 4px 10px rgba(168,85,247,0.20),
              inset 0 1px 0 rgba(255,255,255,0.25);
            letter-spacing: 0.01em;
            transition: transform 220ms ease, box-shadow 220ms ease, background-position 600ms ease;
            overflow: hidden;
          }
          .cbc-face-btn::before {
            /* Soft moving sheen so the button feels alive without being noisy. */
            content: '';
            position: absolute;
            top: 0; left: -60%;
            width: 50%; height: 100%;
            background: linear-gradient(120deg,
              transparent 0%,
              rgba(255,255,255,0.22) 50%,
              transparent 100%);
            transform: skewX(-20deg);
            transition: left 700ms ease;
          }
          .cbc-face-btn:hover {
            transform: translateY(-1px) scale(1.01);
            background-position: 100% 50%;
            box-shadow:
              0 16px 36px rgba(99,102,241,0.42),
              0 6px 14px rgba(236,72,153,0.28),
              inset 0 1px 0 rgba(255,255,255,0.30);
          }
          .cbc-face-btn:hover::before { left: 130%; }
          .cbc-face-btn:active { transform: translateY(0) scale(0.99); }

          .cbc-face-icon {
            position: relative;
            width: 28px; height: 28px;
            border-radius: 999px;
            background: rgba(255,255,255,0.18);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 15px;
            color: #ffffff;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.40);
          }
          .cbc-face-pulse {
            position: absolute;
            inset: -4px;
            border-radius: 999px;
            border: 2px solid rgba(255,255,255,0.55);
            opacity: 0;
            animation: cbcFacePulse 1.8s ease-out infinite;
            pointer-events: none;
          }
          @keyframes cbcFacePulse {
            0%   { transform: scale(0.85); opacity: 0.85; }
            70%  { transform: scale(1.35); opacity: 0;    }
            100% { transform: scale(1.35); opacity: 0;    }
          }
        `}</style>
      </div>

      <FaceLoginModal
        open={faceOpen}
        onClose={() => setFaceOpen(false)}
        initialEmail={email}
        onSubmit={faceLogin}
      />
    </AuthCardLayout>
  );
}
      