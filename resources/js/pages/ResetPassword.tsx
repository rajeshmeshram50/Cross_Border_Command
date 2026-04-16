import { useState } from 'react';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import SuccessModal from '../components/ui/SuccessModal';
import { AlertCircle, Loader2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import AuthCardLayout from '@/layouts/AuthCardLayout';

interface ResetPasswordProps {
  email: string;
  onPasswordReset?: () => void;
  onBackToVerifyOTP: () => void;
}

export default function ResetPassword({ email, onPasswordReset, onBackToVerifyOTP }: ResetPasswordProps) {
  const toast = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];
    if (password.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('One number');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      toast.warning('Missing fields', 'Please fill in all fields');
      return;
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      setError(`Password must contain: ${passwordErrors.join(', ')}`);
      toast.warning('Weak password', `Password must contain: ${passwordErrors.join(', ')}`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      toast.warning('Mismatch', 'New password and confirm password do not match');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await api.post('/forgot-password/reset', {
        email,
        password: newPassword,
        password_confirmation: confirmPassword,
      });
      setShowSuccessModal(true);
    } catch (err: any) {
      const data = err.response?.data;
      const msg = data?.message || 'Failed to reset password. Please try again.';
      if (data?.expired) {
        setError('Session expired. Please start over.');
        toast.error('Expired', 'Your session has expired. Please request a new code.');
      } else {
        setError(msg);
        toast.error('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContinueClick = () => {
    setShowSuccessModal(false);
    onPasswordReset?.();
  };

  const passwordStrength = () => {
    if (!newPassword) return { level: 0, text: '' };
    const errors = validatePassword(newPassword);
    const strength = 4 - errors.length;
    const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500'];
    return { level: strength, text: levels[strength], color: colors[strength] };
  };

  const strength = passwordStrength();


  return (
    <>
      {showSuccessModal && (
        <SuccessModal
          title="Successful"
          message="Congratulations! Your password has been changed. Click continue to login"
          buttonText="Continue"
          onContinue={handleContinueClick}
        />
      )}
      <AuthCardLayout
        title="Set a new password"
        subtitle="Your new password must be different from previous ones."
      >
        {error && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          {/* New Password */}
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-semibold text-[#1f2f5a] ml-1">
              New Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full h-12 px-4 pr-10 rounded-xl border-[1.5px] border-[#2f4fa3]/15 bg-white/70 text-[14px] text-[#1f2f5a] outline-none transition-all duration-200 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-4 focus:ring-[#2f4fa3]/10 placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Password Strength */}
            {newPassword && (
              <div className="mt-2 space-y-1.5 px-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${strength.color}`}
                      style={{ width: `${(strength.level / 4) * 100}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-bold ${strength.level >= 3 ? 'text-emerald-600' : strength.level >= 2 ? 'text-orange-600' : 'text-red-600'}`}>
                    {strength.text}
                  </span>
                </div>
                <p className="text-[10px] text-[#5e6b85] font-medium pt-1">Password must contain:</p>
                <ul className="text-[10.5px] space-y-1 pt-0.5">
                  <li className={`flex items-center gap-1.5 ${validatePassword(newPassword).includes('At least 8 characters') ? 'text-slate-400' : 'text-emerald-600 font-medium'}`}>
                    {validatePassword(newPassword).includes('At least 8 characters') ? '○' : '✓'} At least 8 characters
                  </li>
                  <li className={`flex items-center gap-1.5 ${validatePassword(newPassword).includes('One uppercase letter') ? 'text-slate-400' : 'text-emerald-600 font-medium'}`}>
                    {validatePassword(newPassword).includes('One uppercase letter') ? '○' : '✓'} One uppercase letter (A-Z)
                  </li>
                  <li className={`flex items-center gap-1.5 ${validatePassword(newPassword).includes('One lowercase letter') ? 'text-slate-400' : 'text-emerald-600 font-medium'}`}>
                    {validatePassword(newPassword).includes('One lowercase letter') ? '○' : '✓'} One lowercase letter (a-z)
                  </li>
                  <li className={`flex items-center gap-1.5 ${validatePassword(newPassword).includes('One number') ? 'text-slate-400' : 'text-emerald-600 font-medium'}`}>
                    {validatePassword(newPassword).includes('One number') ? '○' : '✓'} One number (0-9)
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-semibold text-[#1f2f5a] ml-1">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full h-12 px-4 pr-10 rounded-xl border-[1.5px] border-[#2f4fa3]/15 bg-white/70 text-[14px] text-[#1f2f5a] outline-none transition-all duration-200 focus:bg-white focus:border-[#2f4fa3]/60 focus:ring-4 focus:ring-[#2f4fa3]/10 placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {confirmPassword && newPassword !== confirmPassword && (
              <span className="text-[11px] font-medium text-red-500 animate-in px-1 pt-1">Passwords do not match</span>
            )}
            {confirmPassword && newPassword === confirmPassword && (
              <span className="text-[11px] font-medium text-emerald-600 animate-in px-1 pt-1">Passwords match ✓</span>
            )}
          </div>

          <div className="pt-2">
            <button
              disabled={loading}
              className="w-full h-14 rounded-full bg-primary text-white text-[15px] font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover hover:scale-[1.01] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              type="submit"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? 'Reseting...' : 'Reset Password'}
            </button>
          </div>
        </form>

        <button
          onClick={onBackToVerifyOTP}
          className="flex items-center justify-center gap-2 w-full text-[13px] font-bold text-primary hover:underline transition-all duration-200"
        >
          <ArrowLeft size={16} />
          Back to verification
        </button>
      </AuthCardLayout>
    </>
  );
}
