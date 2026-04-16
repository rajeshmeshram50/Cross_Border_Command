import { useState } from 'react';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { AlertCircle, Loader2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

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
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Frontend only - password reset successful
      toast.success('Password reset!', 'Your password has been reset successfully');
      onPasswordReset?.();
    } catch (err) {
      setError('Failed to reset password. Please try again.');
      toast.error('Error', 'Failed to reset password');
    } finally {
      setLoading(false);
    }
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
    <AuthLayout>
      <h1 className="text-[22px] font-bold text-text tracking-tight mb-1.5">Reset your password</h1>
      <p className="text-sm text-secondary mb-7">Your new password must be different from previous used passwords.</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 mb-6">
        {/* New Password */}
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] font-semibold text-text">
            New Password <span className="text-red-500 ml-0.5">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 pr-10 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:shadow-sm placeholder:text-muted hover:border-border/80"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Password Strength */}
          {newPassword && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${strength.color}`}
                    style={{ width: `${(strength.level / 4) * 100}%` }}
                  />
                </div>
                <span className={`text-[10px] font-semibold ${strength.level >= 3 ? 'text-emerald-600' : strength.level >= 2 ? 'text-orange-600' : 'text-red-600'}`}>
                  {strength.text}
                </span>
              </div>
              <p className="text-[10px] text-muted">Password must contain:</p>
              <ul className="text-[10px] text-muted space-y-0.5">
                <li className={validatePassword(newPassword).includes('At least 8 characters') ? 'text-red-500' : 'text-emerald-600'}>
                  {validatePassword(newPassword).includes('At least 8 characters') ? '✗' : '✓'} At least 8 characters
                </li>
                <li className={validatePassword(newPassword).includes('One uppercase letter') ? 'text-red-500' : 'text-emerald-600'}>
                  {validatePassword(newPassword).includes('One uppercase letter') ? '✗' : '✓'} One uppercase letter (A-Z)
                </li>
                <li className={validatePassword(newPassword).includes('One lowercase letter') ? 'text-red-500' : 'text-emerald-600'}>
                  {validatePassword(newPassword).includes('One lowercase letter') ? '✗' : '✓'} One lowercase letter (a-z)
                </li>
                <li className={validatePassword(newPassword).includes('One number') ? 'text-red-500' : 'text-emerald-600'}>
                  {validatePassword(newPassword).includes('One number') ? '✗' : '✓'} One number (0-9)
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] font-semibold text-text">
            Confirm Password <span className="text-red-500 ml-0.5">*</span>
          </label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 pr-10 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:shadow-sm placeholder:text-muted hover:border-border/80"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary transition-colors"
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {confirmPassword && newPassword !== confirmPassword && (
            <span className="text-[10.5px] text-red-500 animate-in">Passwords do not match</span>
          )}
          {confirmPassword && newPassword === confirmPassword && (
            <span className="text-[10.5px] text-emerald-600 animate-in">Passwords match ✓</span>
          )}
        </div>

        <Button size="lg" className="w-full justify-center mt-6" type="submit" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : 'Reset Password'}
        </Button>
      </form>

      <button
        onClick={onBackToVerifyOTP}
        className="flex items-center justify-center gap-2 w-full text-[13px] font-semibold text-primary hover:underline transition-all duration-200"
      >
        <ArrowLeft size={14} />
        Back to verification
      </button>
    </AuthLayout>
  );
}
