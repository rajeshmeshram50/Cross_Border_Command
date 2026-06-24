<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Mail\PasswordResetOtpMail;
use App\Models\User;
use App\Support\BrandingResolver;
use App\Support\Settings;
use App\Traits\PasswordHistory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

class ForgotPasswordController extends Controller
{
    use PasswordHistory;

    private const OTP_EXPIRY_MINUTES = 10;
    private const MAX_OTP_ATTEMPTS = 500;
    private const RESEND_COOLDOWN_SECONDS = 1;

    /**
     * Step 1: Send OTP to email
     */
    public function sendOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $email = strtolower(trim($request->email));

        // Check if user exists
        $user = User::where('email', $email)->first();
        if (!$user) {
            return response()->json([
                'message' => 'No account found with this email address. Please check and try again.',
            ], 422);
        }

        // Check if user account is active
        if ($user->status !== 'active') {
            return response()->json([
                'message' => 'Your account is not active. Please contact administrator.',
            ], 422);
        }

        // Check resend cooldown — prevent spam
        $lastOtp = DB::table('password_reset_otps')
            ->where('email', $email)
            ->orderBy('created_at', 'desc')
            ->first();

        $secondsSinceLastOtp = $lastOtp ? (int) now()->diffInSeconds($lastOtp->created_at, true) : 9999;
        if ($lastOtp && $secondsSinceLastOtp < self::RESEND_COOLDOWN_SECONDS) {
            $remaining = self::RESEND_COOLDOWN_SECONDS - $secondsSinceLastOtp;
            return response()->json([
                'message' => "Please wait {$remaining} seconds before requesting a new code.",
                'retry_after' => $remaining,
            ], 429);
        }

        // Delete old OTPs for this email
        DB::table('password_reset_otps')->where('email', $email)->delete();

        // Generate 6-digit OTP
        $otp = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        // Store OTP
        DB::table('password_reset_otps')->insert([
            'email' => $email,
            'otp' => Hash::make($otp),
            'attempts' => 0,
            'verified' => false,
            'expires_at' => now()->addMinutes(self::OTP_EXPIRY_MINUTES),
            'created_at' => now(),
        ]);

        // Send email — master email toggle applies even to OTPs. If admin
        // globally disables email they accept that password reset breaks.
        if (!Settings::shouldSendMail()) {
            return response()->json([
                'message' => 'Email is disabled by platform admin. Contact support.',
            ], 503);
        }
        try {
            // Branding is recipient-aware: BrandingResolver returns IGC
            // platform defaults for super_admin AND client_admin users, and
            // the parent client's own brand for branch users / employees.
            // Keeps the OTP/credentials email contextual — client admins
            // managed by us see "INORBVICT / GROUP OF COMPANIES"; branch
            // users managed by their client see their client's wordmark.
            Mail::to($email)->cc('php@inhpl.com')->send(new PasswordResetOtpMail(
                $otp,
                $user->name,
                $email,
                self::OTP_EXPIRY_MINUTES,
                BrandingResolver::forUser($user),
            ));
        } catch (\Exception $e) {
            \Log::error('Failed to send password reset OTP: ' . $e->getMessage());
            return response()->json([
                'message' => 'Failed to send verification code. Please try again later.',
            ], 500);
        }

        return response()->json([
            'message' => 'Verification code sent to your email.',
            'expires_in' => self::OTP_EXPIRY_MINUTES * 60,
            // Backend is the source of truth for the resend cooldown so the
            // VerifyOTP screen can't show "Resend in 0s" while the API is
            // still throttling — fixes the timer-mismatch bug.
            'resend_after' => self::RESEND_COOLDOWN_SECONDS,
        ]);
    }

    /**
     * Step 2: Verify OTP
     */
    public function verifyOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'otp' => 'required|string|size:6',
        ]);

        $email = strtolower(trim($request->email));

        $record = DB::table('password_reset_otps')
            ->where('email', $email)
            ->where('verified', false)
            ->orderBy('created_at', 'desc')
            ->first();

        if (!$record) {
            return response()->json([
                'message' => 'No pending verification found. Please request a new code.',
            ], 422);
        }

        // Check if expired
        if (now()->greaterThan($record->expires_at)) {
            DB::table('password_reset_otps')->where('id', $record->id)->delete();
            return response()->json([
                'message' => 'Verification code has expired. Please request a new one.',
                'expired' => true,
            ], 422);
        }

        // Check max attempts
        if ($record->attempts >= self::MAX_OTP_ATTEMPTS) {
            DB::table('password_reset_otps')->where('id', $record->id)->delete();
            return response()->json([
                'message' => 'Too many failed attempts. Please request a new code.',
                'max_attempts' => true,
            ], 422);
        }

        // Verify OTP
        if (!Hash::check($request->otp, $record->otp)) {
            $attemptsLeft = self::MAX_OTP_ATTEMPTS - $record->attempts - 1;
            DB::table('password_reset_otps')
                ->where('id', $record->id)
                ->increment('attempts');

            return response()->json([
                'message' => "Invalid code. {$attemptsLeft} attempt(s) remaining.",
                'attempts_left' => $attemptsLeft,
            ], 422);
        }

        // Mark as verified
        DB::table('password_reset_otps')
            ->where('id', $record->id)
            ->update(['verified' => true]);

        return response()->json([
            'message' => 'Code verified successfully. You can now reset your password.',
        ]);
    }

    /**
     * Step 3: Reset password
     */
    public function resetPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $email = strtolower(trim($request->email));

        // Check for verified OTP
        $record = DB::table('password_reset_otps')
            ->where('email', $email)
            ->where('verified', true)
            ->orderBy('created_at', 'desc')
            ->first();

        if (!$record) {
            return response()->json([
                'message' => 'Please verify your OTP first before resetting password.',
            ], 422);
        }

        // Check if verification hasn't expired (extra 5 min grace after OTP verify)
        if (now()->greaterThan(now()->parse($record->expires_at)->addMinutes(5))) {
            DB::table('password_reset_otps')->where('email', $email)->delete();
            return response()->json([
                'message' => 'Session expired. Please start the process again.',
                'expired' => true,
            ], 422);
        }

        // Find user and update password
        $user = User::where('email', $email)->first();
        if (!$user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        // Block re-use of the last 3 passwords (current + 2 historical).
        // See App\Traits\PasswordHistory for the full policy.
        if ($this->isPasswordReused($user, $request->password)) {
            return response()->json([
                'message' => $this->passwordReuseMessage(),
            ], 422);
        }

        // Save the OLD hash to history BEFORE we overwrite it on the user.
        $this->recordPasswordHistory($user);

        // Capture the plaintext password BEFORE hashing — the confirmation
        // mail surfaces it so the user can recover their new credentials from
        // their inbox if they forget what they just set. Mirrors the existing
        // WelcomeCredentialsMail pattern. Drop this if policy ever bans
        // emailing plaintext passwords.
        $newPassword = $request->password;

        $user->update([
            'password' => Hash::make($newPassword),
            // Clear any forced-reset flag (e.g. set after an email change) so
            // the user can sign in again now that they've set a new password.
            'must_reset_password' => false,
        ]);

        // Delete all OTPs for this email
        DB::table('password_reset_otps')->where('email', $email)->delete();

        // Revoke all tokens (force re-login)
        $user->tokens()->delete();

        // Confirmation mail — gated by master emailNotif. Non-fatal so a
        // transient SMTP hiccup never blocks the password reset itself
        // (the password IS already saved).
        if (Settings::shouldSendMail()) try {
            // Same recipient-aware branding rule as the OTP send above.
            Mail::to($user->email)->send(new PasswordChangedMail(
                $user->name,
                $user->email,
                $newPassword,
                PasswordChangedMail::resolveLoginUrl($request),
                BrandingResolver::forUser($user),
            ));
        } catch (\Throwable $e) {
            \Log::warning('Password-changed confirmation mail failed', [
                'user_id' => $user->id,
                'email'   => $user->email,
                'error'   => $e->getMessage(),
            ]);
        }

        return response()->json([
            'message' => 'Password reset successfully. You can now login with your new password.',
        ]);
    }

}
