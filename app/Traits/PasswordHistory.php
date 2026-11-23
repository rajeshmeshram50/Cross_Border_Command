<?php

namespace App\Traits;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

trait PasswordHistory
{
    private const HISTORY_LIMIT = 2;

    protected function isPasswordReused(User $user, string $newPlain): bool
    {
        if (Hash::check($newPlain, $user->password)) {
            return true;
        }

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

    protected function recordPasswordHistory(User $user): void
    {
        $changedAt = now();

        DB::table('password_histories')->insert([
            'user_id'       => $user->id,
            'password_hash' => $user->password,
            'created_at'    => $changedAt,
        ]);

        DB::table('users')
            ->where('id', $user->id)
            ->update([
                'password_change_count' => DB::raw('COALESCE(password_change_count, 0) + 1'),
                'password_changed_at'   => $changedAt,
            ]);

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

    protected function passwordReuseMessage(): string
    {
        $blocked = self::HISTORY_LIMIT + 1;
        return "New password cannot match any of your last {$blocked} passwords. Please choose a different password.";
    }
}
