import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

export default function Login() {
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
    <AuthLayout>
      <h1 className="text-[22px] font-bold text-text tracking-tight mb-1.5">Welcome back</h1>
      <p className="text-sm text-secondary mb-7">Sign in to your account to continue</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 mb-6">
        <Input label="Email Address" required type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
        <Input label="Password" required type="password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[13px] text-secondary cursor-pointer">
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary rounded" /> Remember me
          </label>
          <a href="#" className="text-[13px] font-semibold text-primary hover:underline">Forgot password?</a>
        </div>

        <Button size="lg" className="w-full justify-center" type="submit" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>

      <div className="text-center text-[11.5px] text-muted">
        Contact your administrator if you don't have an account
      </div>
    </AuthLayout>
  );
}
