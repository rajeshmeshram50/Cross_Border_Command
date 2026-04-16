import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthCardLayout from '../layouts/AuthCardLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface LoginProps {
  onForgotPassword?: () => void;
}

export default function Login({ onForgotPassword }: LoginProps) {
  const { login, loading } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email || !password) { setError('Please enter email and password'); toast.warning('Missing fields', 'Please enter email and password'); return; }
    setError('');
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error || 'Login failed');
      toast.error('Login Failed', result.error || 'Invalid credentials');
    } else {
      toast.success('Welcome back!', 'You have been logged in successfully');
    }
  };

  return (
    <AuthCardLayout 
      title="Getting Started Now!" 
      subtitle="Let's activate your account and set up your secure access."
    >
      <div className="space-y-8">
        {error && (
          <div className="flex items-center gap-3 px-5 py-4 rounded-[20px] bg-red-50 border border-red-100 text-[13px] text-red-600 animate-in fade-in zoom-in-95">
            <AlertCircle size={18} className="shrink-0" />
            <span className="font-semibold">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label className="text-[13px] font-semibold text-[#1f2f5a] ml-1">Email Id</label>
            <Input
              required
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-[52px] text-[14px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[12px]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[13px] font-semibold text-[#1f2f5a] ml-1">Password</label>
            <Input
              required
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-[52px] text-[14px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[12px]"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                defaultChecked
                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer"
              />
              <span className="text-[13px] font-medium text-slate-500 group-hover:text-slate-700 transition-colors">Remember Me</span>
            </label>
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-[13px] font-bold text-primary hover:underline transition-colors"
            >
              Forgot password?
            </button>
          </div>

          <div className="pt-2">
            <button
              disabled={loading}
              className="w-full h-14 rounded-full bg-primary text-white text-[15px] font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover hover:scale-[1.01] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              type="submit"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? 'Logging In...' : 'Log In'}
            </button>
          </div>
        </form>

        <div className="text-center">
          <p className="text-[13px] text-slate-400 font-medium">
            Don’t have an account? <a href="#" className="text-primary font-bold hover:underline">Contact Support</a>
          </p>
        </div>
      </div>
    </AuthCardLayout>
  );
}
