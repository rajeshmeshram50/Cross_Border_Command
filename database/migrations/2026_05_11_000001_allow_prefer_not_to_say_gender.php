<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The `employees.gender` column was created via Laravel's `enum()` helper
 * which on Postgres compiles to a CHECK constraint locked to:
 *   ('Male', 'Female', 'Other')
 *
 * The frontend GENDER_OPTIONS dropdown also offers "Prefer not to say".
 * Picking it surfaced as a hard 500 (check_violation) on save. The
 * controller validator was widened in a sibling change; this migration
 * widens the DB constraint to match so the value actually persists.
 *
 * Postgres-only DDL (the project runs on pgsql per the existing
 * migrations). Re-applies cleanly: we drop-if-exists before re-adding.
 */
return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_gender_check');
        DB::statement(
            "ALTER TABLE employees ADD CONSTRAINT employees_gender_check "
            . "CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other', 'Prefer not to say'))"
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // Any existing rows with 'Prefer not to say' would block the
        // tighter constraint from re-applying — coerce them to 'Other'
        // on rollback so the schema can be reverted cleanly.
        DB::statement("UPDATE employees SET gender = 'Other' WHERE gender = 'Prefer not to say'");

        DB::statement('ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_gender_check');
        DB::statement(
            "ALTER TABLE employees ADD CONSTRAINT employees_gender_check "
            . "CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other'))"
        );
    }
};
