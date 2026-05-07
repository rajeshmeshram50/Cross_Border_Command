<?php

namespace App\Traits;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Password-history policy enforcement.
 *
 * Used by ForgotPasswordController::resetPassword and
 * AuthController::changePassword to:
 *
 *   1. Reject any new password that matches the user's CURRENT password
 *      OR any of the last HISTORY_LIMIT historical hashes.
 *   2. After a successful change, push the OLD hash into history and
 *      prune to keep only the most recent HISTORY_LIMIT entries.
 *
 * HISTORY_LIMIT = 2 means we block the last 3 passwords total
 * (current + 2 historical).
 */
trait PasswordHistory
{
    /** Number of historical hashes kept per user. */
    private const HISTORY_LIMIT = 2;

    /**
     * Returns true if the proposed plain password matches the user's
     * current password OR any of their stored history entries.
     */
    protected function isPasswordReused(User $user, string $newPlain): bool
    {
        // 1) Current password (the one still in users.password)
        if (Hash::check($newPlain, $user->password)) {
            return true;
        }

        // 2) Recent historical hashes
        $hashes = DB::table('password_histories')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(self::HISTORY_LIMIT)
            ->pluck('password_hash');

        foreach ($hashes as $hash) {
            if (Hash::check($newPlain, $hash)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Records the user's CURRENT password hash into history, then prunes
     * older entries so the table stays bounded per user.
     *
     * Call this BEFORE updating the user's password — we want to capture
     * the old hash, not the new one.
     */
    protected function recordPasswordHistory(User $user): void
    {
        // Save current hash as the most recent historical entry
        DB::table('password_histories')->insert([
            'user_id'       => $user->id,
            'password_hash' => $user->password,
            'created_at'    => now(),
        ]);

        // Prune anything older than the most recent HISTORY_LIMIT entries
        $idsToKeep = DB::table('password_histories')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(self::HISTORY_LIMIT)
            ->pluck('id');

        if ($idsToKeep->isNotEmpty()) {
            DB::table('password_histories')
                ->where('user_id', $user->id)
                ->whereNotIn('id', $idsToKeep)
                ->delete();
        }
    }

    /**
     * Friendly error message HR pages and the reset/change flows render to
     * the user when they pick a recently-used password.
     */
    protected function passwordReuseMessage(): string
    {
        $blocked = self::HISTORY_LIMIT + 1; // current + history
        return "New password cannot match any of your last {$blocked} passwords. Please choose a different password.";
    }
}
