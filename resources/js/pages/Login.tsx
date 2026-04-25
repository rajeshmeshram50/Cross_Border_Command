import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthCardLayout from '../layouts/AuthCardLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

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
  const { login, googleLogin, loading } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <div className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-[14px] font-semibold text-primary-hover ml-1">Email Id</label>
            <Input
              required
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-11 text-[13px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[10px] hover:border-primary/30"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[14px] font-semibold text-primary-hover ml-1">Password</label>
            <Input
              required
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-11 text-[13px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[10px] hover:border-primary/30"
            />
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer group-hover:scale-110"
              />
              <span className="text-[12px] font-medium text-slate-500 group-hover:text-primary transition-colors">Remember Me</span>
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
      </div>
    </AuthCardLayout>
  );
}
      