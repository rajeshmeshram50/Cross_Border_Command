<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lets the Set/Reset Password screen say whether an employee's login password
 * has ever actually been changed, and when.
 *
 * Why new columns instead of reading `password_histories`: that table is a
 * SECURITY control, not an audit log — PasswordHistory::recordPasswordHistory()
 * prunes it to the last 2 hashes per user on every change, so a user who has
 * changed their password ten times still shows two rows. The count cannot be
 * recovered from it.
 *
 * Why on `users` and not a new audit table: `login_count` / `last_login_at`
 * already sit here for exactly this purpose, and every password path in the app
 * (EmployeeController::setPassword, AuthController::changePassword,
 * ForgotPasswordController::resetPassword) funnels through the same trait
 * method, so a single increment there keeps all three honest. A separate table
 * would need three call sites and would drift the first time one is missed.
 *
 * Note on `password_changed_at` vs `updated_at`: users.updated_at moves for any
 * edit (status flip, profile save, last_login stamp), so it cannot answer "when
 * was the password last changed".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Number of times this user's password has been REPLACED — the
            // password seeded at account creation is not a change, so a freshly
            // onboarded employee sits at 0.
            $table->unsignedInteger('password_change_count')->default(0)->after('login_count');

            // When the most recent change happened. Null = never changed.
            $table->timestamp('password_changed_at')->nullable()->after('password_change_count');
        });

        // ── Backfill ──────────────────────────────────────────────────────
        // Each password_histories row is one recorded change: the trait writes
        // the OLD hash at the moment of a change, so its created_at IS the
        // moment that change happened.
        //
        //   password_changed_at → EXACT for anyone with history (the newest row
        //                         is genuinely the last change).
        //   password_change_count → a FLOOR, not exact. Pruning caps it at 2, so
        //                         someone who changed ten times backfills as 2.
        //
        // That is deliberate. The question the screen asks is "has this ever
        // been changed, and when" — which the floor answers correctly — and
        // every change from here on is counted exactly. Backfilling 0 instead
        // would have been worse: it would read as "never changed" for users who
        // demonstrably have.
        $rows = DB::table('password_histories')
            ->selectRaw('user_id, COUNT(*) AS change_count, MAX(created_at) AS last_changed_at')
            ->groupBy('user_id')
            ->get();

        foreach ($rows as $row) {
            DB::table('users')
                ->where('id', $row->user_id)
                ->update([
                    'password_change_count' => (int) $row->change_count,
                    'password_changed_at'   => $row->last_changed_at,
                ]);
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['password_change_count', 'password_changed_at']);
        });
    }
};
