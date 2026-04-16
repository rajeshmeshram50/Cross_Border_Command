import { useState, useRef, useEffect } from 'react';
import AuthLayout from '../layouts/AuthLayout';
import Button from '../components/ui/Button';
import { AlertCircle, Loader2, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import api from '../api';

interface VerifyOTPProps {
  email: string;
  onBackToForgotPassword: () => void;
  onOTPVerified?: (otp: string) => void;
}

export default function VerifyOTP({ email, onBackToForgotPassword, onOTPVerified }: VerifyOTPProps) {
  const toast = useToast();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendTimer > 0) {
      timer = setInterval(() => setResendTimer(prev => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendTimer]);

  const handleInputChange = (index: number, value: string) => {
    // Only allow digits
    if (!/^\d*$/.test(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto move to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '');
    const newOtp = pastedData.split('').slice(0, 6);
    
    setOtp([
      newOtp[0] || '',
      newOtp[1] || '',
      newOtp[2] || '',
      newOtp[3] || '',
      newOtp[4] || '',
      newOtp[5] || '',
    ]);

    if (newOtp.length === 6) {
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter all 6 digits');
      toast.warning('Incomplete OTP', 'Please enter all 6 digits');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await api.post('/forgot-password/verify-otp', { email, otp: otpCode });
      toast.success('Verified!', 'Verification code verified successfully');
      onOTPVerified?.(otpCode);
    } catch (err: any) {
      const data = err.response?.data;
      const msg = data?.message || 'Invalid verification code. Please try again.';
      setError(msg);
      if (data?.expired || data?.max_attempts) {
        toast.error('Code Invalid', msg);
      } else {
        toast.warning('Wrong Code', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await api.post('/forgot-password/send-otp', { email });
      setResendTimer(60);
      setOtp(['', '', '', '', '', '']);
      setError('');
      inputRefs.current[0]?.focus();
      toast.success('Code sent', 'New verification code sent to your email');
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to resend code';
      toast.error('Error', msg);
    }
  };

  return (
    <AuthLayout>
      <div className="text-center">
        {/* Icon */}
        <div className="mb-5 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
            <ShieldCheck size={32} className="text-primary" />
          </div>
        </div>

        <h1 className="text-[22px] font-bold text-text tracking-tight mb-2">Verify Code</h1>
        <p className="text-sm text-secondary mb-7">
          Enter the 6-digit code sent to <br />
          <span className="font-semibold text-text">{email}</span>
        </p>

        {error && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* OTP Input Boxes */}
          <div className="flex gap-2.5 justify-center">
            {otp.map((digit, index) => (
              <input
                key={index}
                ref={el => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleInputChange(index, e.target.value)}
                onKeyDown={e => handleKeyDown(index, e)}
                onPaste={handlePaste}
                className={`w-12 h-14 text-center text-[20px] font-bold rounded-lg border-[1.5px] bg-surface text-text outline-none transition-all duration-200 ${
                  error ? 'border-red-400' : 'border-border'
                } focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted hover:border-border/80`}
                placeholder="•"
              />
            ))}
          </div>

          {/* Resend Link */}
          <div className="text-center text-[12px] text-muted">
            {resendTimer > 0 ? (
              <>Didn't receive code? <span className="font-semibold text-primary">Resend in {resendTimer}s</span></>
            ) : (
              <>
                Didn't receive code?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  className="font-semibold text-primary hover:underline transition-all duration-200"
                >
                  Resend OTP
                </button>
              </>
            )}
          </div>

          <Button size="lg" className="w-full justify-center" type="submit" disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : 'Verify OTP'}
          </Button>
        </form>

        <button
          onClick={onBackToForgotPassword}
          className="flex items-center justify-center gap-2 w-full mt-6 text-[13px] font-semibold text-primary hover:underline transition-all duration-200"
        >
          <ArrowLeft size={14} />
          Back to email
        </button>
      </div>
    </AuthLayout>
  );
}
