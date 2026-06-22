<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * HRMS-BUG-047 — onboarding "complete" failed with "This email already has an
 * account" (and the new hire never appeared → Profile % stuck at 0%) whenever
 * the invite re-used an email that belonged to a SOFT-DELETED user.
 *
 * Root cause: `users.email` carried a plain UNIQUE constraint that counts
 * soft-deleted rows, but every app-level check (OnboardingController::createInvite
 * and EmployeeController's `Rule::unique('users','email')->whereNull('deleted_at')`)
 * deliberately ignores soft-deleted rows. So the validator/pre-check passed but
 * the INSERT blew up on the DB constraint (Postgres 23505).
 *
 * Fix: replace the constraint with a PARTIAL unique index that only applies to
 * live rows (deleted_at IS NULL). This makes the DB agree with the app's intent
 * — an email freed by a deleted user can be re-used, while two ACTIVE users can
 * still never share an address. Postgres-specific (the app runs on pgsql).
 */
return new class extends Migration
{
    public function up(): void
    {
        // `->unique()` in the original create migration made a UNIQUE CONSTRAINT
        // named users_email_unique. Drop whichever form exists, then rebuild it
        // as a partial unique index under the same name.
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique');
        DB::statement('DROP INDEX IF EXISTS users_email_unique');
        DB::statement('CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        // Revert to the all-rows unique. NOTE: this only succeeds if no email is
        // currently duplicated across live + soft-deleted rows (which can exist
        // once the partial index has been in effect). That's the inherent cost
        // of rolling back this relaxation.
        DB::statement('DROP INDEX IF EXISTS users_email_unique');
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email)');
    }
};
