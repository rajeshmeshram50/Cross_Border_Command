import { useState } from 'react';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Mail, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

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
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Frontend only - send verification code
      toast.success('Code sent', 'Verification code sent to your email');
      onEmailSubmitted?.(email);
    } catch (err) {
      setError('An error occurred. Please try again.');
      toast.error('Error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-bold text-text tracking-tight mb-1.5">Forgot your password?</h1>
      <p className="text-sm text-secondary mb-7">Enter your email address and we'll send you a verification code to reset your password.</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 mb-6">
        <Input
          label="Email"
          required
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <Button size="lg" className="w-full justify-center" type="submit" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
          {loading ? 'Sending...' : 'Send Verification Code'}
        </Button>
      </form>

      <button
        onClick={onBackToLogin}
        className="flex items-center justify-center gap-2 w-full text-[13px] font-semibold text-primary hover:underline transition-all duration-200"
      >
        <ArrowLeft size={14} />
        Back to login
      </button>
    </AuthLayout>
  );
}
