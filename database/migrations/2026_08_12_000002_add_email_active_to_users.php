<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Email active" key on a user account.
 *
 * Email is unique PER ORGANIZATION, checked against the `users` table. When an
 * employee EXITS, the employee row is soft-deleted but the linked user is only
 * set to `status = 'inactive'` (deleted_at stays NULL), so the dup-email check
 * still matched it and the exited person's email could never be reused.
 *
 * `email_active` marks whether the account still holds its email slot:
 *   true  → active account, its email is taken (blocks reuse)
 *   false → the person has EXITED, the email is freed for reuse
 * Set false only on EXIT completion (not on a plain disable) and back to true on
 * rehire. The dup-email check now only considers `email_active = true` rows.
 *
 * Backfill: free the email for anyone whose exit is already completed (case
 * Closed and not rehired) so existing exited employees behave correctly.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'email_active')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('email_active')->default(true)->after('status');
            });
        }

        // Free the email of already-exited (completed, not rehired) employees.
        if (Schema::hasTable('employee_exits') && Schema::hasColumn('users', 'email_active')) {
            $userIds = DB::table('employees')
                ->join('employee_exits', 'employee_exits.employee_id', '=', 'employees.id')
                ->where('employee_exits.exit_case_status', 'Closed')
                ->whereNull('employee_exits.rehired_at')
                ->whereNotNull('employees.user_id')
                ->pluck('employees.user_id')
                ->all();

            if (!empty($userIds)) {
                DB::table('users')->whereIn('id', $userIds)->update(['email_active' => false]);
            }
        }

        // The DB-level per-tenant unique index must agree with the app rule:
        // only an ACTIVE account occupies the email slot. Rebuild the partial
        // index to also exclude exited rows (email_active = false) so a freed
        // email can be re-registered without hitting a 23505 at insert time.
        // (Postgres partial unique index — mirrors 2026_06_25_000001.)
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS users_email_client_unique');
            DB::statement('CREATE UNIQUE INDEX users_email_client_unique ON users (COALESCE(client_id, 0), email) WHERE deleted_at IS NULL AND email_active = true');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS users_email_client_unique');
            DB::statement('CREATE UNIQUE INDEX users_email_client_unique ON users (COALESCE(client_id, 0), email) WHERE deleted_at IS NULL');
        }
        if (Schema::hasColumn('users', 'email_active')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('email_active');
            });
        }
    }
};
