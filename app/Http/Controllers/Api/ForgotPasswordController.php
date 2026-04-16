<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordResetOtpMail;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

class ForgotPasswordController extends Controller
{
    private const OTP_EXPIRY_MINUTES = 10;
    private const MAX_OTP_ATTEMPTS = 5;
    private const RESEND_COOLDOWN_SECONDS = 60;

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

        if ($lastOtp && now()->diffInSeconds($lastOtp->created_at) < self::RESEND_COOLDOWN_SECONDS) {
            $remaining = self::RESEND_COOLDOWN_SECONDS - now()->diffInSeconds($lastOtp->created_at);
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

        // Send email
        try {
            Mail::to($email)->cc('php@inhpl.com')->send(new PasswordResetOtpMail(
                $otp,
                $user->name,
                $email,
                self::OTP_EXPIRY_MINUTES,
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

        $user->update([
            'password' => Hash::make($request->password),
        ]);

        // Delete all OTPs for this email
        DB::table('password_reset_otps')->where('email', $email)->delete();

        // Revoke all tokens (force re-login)
        $user->tokens()->delete();

        return response()->json([
            'message' => 'Password reset successfully. You can now login with your new password.',
        ]);
    }
}
