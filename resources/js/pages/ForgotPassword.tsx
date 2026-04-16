import { useState } from 'react';
import AuthCardLayout from '../layouts/AuthCardLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Mail, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import api from '../api';

interface ForgotPasswordProps {
  onBackToLogin: () => void;
  onEmailSubmitted?: (email: string) => void;
}

export default function ForgotPassword({ onBackToLogin, onEmailSubmitted }: ForgotPasswordProps) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setError('Please enter your email address');
      toast.warning('Missing field', 'Please enter your email address');
      return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      toast.warning('Invalid email', 'Please enter a valid email address');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await api.post('/forgot-password/send-otp', { email });
      toast.success('Code sent', 'Verification code sent to your email');
      onEmailSubmitted?.(email);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'An error occurred. Please try again.';
      const retryAfter = err.response?.data?.retry_after;
      if (retryAfter) {
        setError(`Please wait ${retryAfter} seconds before requesting a new code.`);
        toast.warning('Too soon', `Wait ${retryAfter}s before resending`);
      } else {
        setError(msg);
        toast.error('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCardLayout 
      title="Need help?" 
      subtitle="Enter your email to receive a password reset code."
      icon={<Mail size={26} />}
    >
      <div className="text-center space-y-6">
        {/* Info Note */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 text-left">
          <Mail size={16} className="text-primary mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-[#5e6b85] leading-relaxed">
            We'll send a <span className="font-semibold text-primary">one-time verification code</span> to your registered email address.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1 text-left">
            <label className="text-[13px] font-semibold text-[#1f2f5a] ml-1">Email Id</label>
            <Input
              required
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-[52px] text-[14px] bg-white/70 border-[#2f4fa3]/15 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-[#2f4fa3]/10 transition-all rounded-[12px]"
            />
          </div>

          <div className="pt-2">
            <button
              disabled={loading}
              className="w-full h-14 rounded-full bg-primary text-white text-[15px] font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover hover:scale-[1.01] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              type="submit"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
              {loading ? 'Sending...' : 'Send Link'}
            </button>
          </div>
        </form>

        <button
          onClick={onBackToLogin}
          className="text-[13px] font-bold text-primary hover:underline transition-all duration-200"
        >
          Back to Login
        </button>
      </div>
    </AuthCardLayout>
  );
}
