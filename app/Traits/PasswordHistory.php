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
     *
     * It also stamps users.password_change_count / password_changed_at. That
     * lives HERE rather than in the callers on purpose: all three paths that
     * change a password (EmployeeController::setPassword,
     * AuthController::changePassword, ForgotPasswordController::resetPassword)
     * already call this method, so one increment keeps every path counted. Put
     * it in the callers and the count silently drifts the day a fourth path is
     * added and someone forgets.
     */
    protected function recordPasswordHistory(User $user): void
    {
        $changedAt = now();

        // Save current hash as the most recent historical entry
        DB::table('password_histories')->insert([
            'user_id'       => $user->id,
            'password_hash' => $user->password,
            'created_at'    => $changedAt,
        ]);

        // The counter is what survives the pruning below — history itself is
        // capped at HISTORY_LIMIT rows and cannot answer "how many times".
        // Written with the query builder (not $user->increment) so the change
        // does not also bump users.updated_at, which every other edit moves.
        DB::table('users')
            ->where('id', $user->id)
            ->update([
                'password_change_count' => DB::raw('COALESCE(password_change_count, 0) + 1'),
                'password_changed_at'   => $changedAt,
            ]);

        // The in-memory $user is deliberately left alone. Every caller follows
        // this with $user->update(['password' => ...]), and save() persists all
        // DIRTY attributes — so stamping them here would only queue an
        // identical second write. No caller serialises $user afterwards either;
        // all three return a plain message.

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
