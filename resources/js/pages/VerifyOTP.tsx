import { useState, useRef, useEffect } from 'react';
import AuthCardLayout from '../layouts/AuthCardLayout';
import Button from '../components/ui/Button';
import { AlertCircle, Loader2, Mail } from 'lucide-react';
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
    let timer: ReturnType<typeof setInterval>;
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
    <AuthCardLayout 
      title="Verify your email" 
      subtitle={`We have sent code to your email ${email}`}
    >
      <div className="text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail size={28} className="text-primary" />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          {/* OTP Input Boxes */}
          <div className="flex gap-2 justify-center">
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
                className={`w-[52px] h-14 text-center text-[20px] font-bold rounded-xl border-[1.5px] bg-white/70 text-[#1f2f5a] outline-none transition-all duration-200 ${
                  error ? 'border-red-400' : 'border-[#2f4fa3]/15'
                } focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-4 focus:ring-[#2f4fa3]/10 hover:border-[#2f4fa3]/30`}
                placeholder="0"
              />
            ))}
          </div>

          {/* Resend Link */}
          <div className="text-center text-[13px] font-medium text-[#5e6b85] pt-2">
            {resendTimer > 0 ? (
              <p>Resend code in <span className="font-bold text-primary">{resendTimer}s</span></p>
            ) : (
              <p>
                Didn't receive code?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  className="font-bold text-primary hover:underline transition-all duration-200"
                >
                  Resend
                </button>
              </p>
            )}
          </div>

          <div className="pt-2">
            <button
              disabled={loading}
              className="w-full h-14 rounded-full bg-primary text-white text-[15px] font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover hover:scale-[1.01] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              type="submit"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? 'Verifying...' : 'Verify Account'}
            </button>
          </div>
        </form>

        <button
          onClick={onBackToForgotPassword}
          className="text-[13px] font-bold text-primary hover:underline transition-all duration-200"
        >
          Back to Login
        </button>
      </div>
    </AuthCardLayout>
  );
}
