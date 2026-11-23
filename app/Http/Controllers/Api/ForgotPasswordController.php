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
    private const MAX_OTP_ATTEMPTS = 5;
    private const RESEND_COOLDOWN_SECONDS = 60;

    public function sendOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $email = strtolower(trim($request->email));

        $user = User::where('email', $email)->where('status', 'active')->first()
            ?? User::where('email', $email)->first();
        if (!$user) {
            return response()->json([
                'message' => 'No account found with this email address. Please check and try again.',
            ], 422);
        }

        if ($user->status !== 'active') {
            return response()->json([
                'message' => 'Your account is not active. Please contact administrator.',
            ], 422);
        }

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

        DB::table('password_reset_otps')->where('email', $email)->delete();

        $otp = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        DB::table('password_reset_otps')->insert([
            'email' => $email,
            'otp' => Hash::make($otp),
            'attempts' => 0,
            'verified' => false,
            'expires_at' => now()->addMinutes(self::OTP_EXPIRY_MINUTES),
            'created_at' => now(),
        ]);

        if (!Settings::shouldSendMail()) {
            return response()->json([
                'message' => 'Email is disabled by platform admin. Contact support.',
            ], 503);
        }
        try {
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
            'resend_after' => self::RESEND_COOLDOWN_SECONDS,
        ]);
    }

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

        if (now()->greaterThan($record->expires_at)) {
            DB::table('password_reset_otps')->where('id', $record->id)->delete();
            return response()->json([
                'message' => 'Verification code has expired. Please request a new one.',
                'expired' => true,
            ], 422);
        }

        if ($record->attempts >= self::MAX_OTP_ATTEMPTS) {
            DB::table('password_reset_otps')->where('id', $record->id)->delete();
            return response()->json([
                'message' => 'Too many failed attempts. Please request a new code.',
                'max_attempts' => true,
            ], 422);
        }

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

        DB::table('password_reset_otps')
            ->where('id', $record->id)
            ->update(['verified' => true]);

        return response()->json([
            'message' => 'Code verified successfully. You can now reset your password.',
        ]);
    }

    public function resetPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string|min:8|confirmed',
            'client_id' => 'nullable|integer',
        ]);

        $email = strtolower(trim($request->email));

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

        if (now()->greaterThan(now()->parse($record->expires_at)->addMinutes(5))) {
            DB::table('password_reset_otps')->where('email', $email)->delete();
            return response()->json([
                'message' => 'Session expired. Please start the process again.',
                'expired' => true,
            ], 422);
        }

        $users = User::where('email', $email)->get();
        if ($users->isEmpty()) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($users->count() > 1) {
            $selectedClientId = $request->input('client_id');
            if ($selectedClientId === null || $selectedClientId === '') {
                return response()->json([
                    'needs_org_selection' => true,
                    'message' => 'This email is registered with more than one organization. Choose which one to reset.',
                    'organizations' => $users->map(fn ($u) => [
                        'client_id' => $u->client_id,
                        'name'      => $u->effectiveClient()?->org_name
                            ?? ($u->user_type === 'super_admin' ? 'Platform Admin' : 'Organization'),
                    ])->values(),
                ], 409);
            }
            $user = $users->firstWhere('client_id', (int) $selectedClientId);
            if (!$user) {
                return response()->json(['message' => 'Please choose a valid organization.'], 422);
            }
        } else {
            $user = $users->first();
        }

        if ($this->isPasswordReused($user, $request->password)) {
            return response()->json([
                'message' => $this->passwordReuseMessage(),
            ], 422);
        }

        $this->recordPasswordHistory($user);

        $newPassword = $request->password;

        $user->update([
            'password' => Hash::make($newPassword),
            'must_reset_password' => false,
        ]);

        DB::table('password_reset_otps')->where('email', $email)->delete();

        $user->tokens()->delete();

        if (Settings::shouldSendMail()) try {
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
