<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Make user email unique PER TENANT instead of globally.
 *
 * Previously `users_email_unique` (a partial unique index on `email WHERE
 * deleted_at IS NULL`, see 2026_06_22_000001) enforced one email across the
 * WHOLE platform — so the same person could not be an employee in two
 * different clients. Per product decision (2026-06-25, bug #15), email is now
 * the login ID WITHIN a client, and the same email may exist in different
 * clients.
 *
 * We key the new index on COALESCE(client_id, 0) so that:
 *   - rows that share a client_id must have distinct emails (per-tenant unique);
 *   - super-admins / system rows (client_id IS NULL) collapse to bucket 0 and
 *     therefore stay globally unique among themselves (NULLs are otherwise
 *     treated as distinct by Postgres, which would let two null-client rows
 *     share an email — not what we want for platform admins).
 *
 * Login disambiguation for a duplicated email is handled in AuthController /
 * ForgotPasswordController (resolve by password / face / explicit client_id).
 */
return new class extends Migration
{
    public function up(): void
    {
        // Drop the global form, whichever shape it currently exists as.
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique');
        DB::statement('DROP INDEX IF EXISTS users_email_unique');

        // Per-tenant partial unique index (ignores soft-deleted rows).
        DB::statement('CREATE UNIQUE INDEX users_email_client_unique ON users (COALESCE(client_id, 0), email) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        // Revert to the global per-email unique. NOTE: this only succeeds if no
        // email is currently duplicated across clients — if it is, the duplicates
        // must be resolved by hand before rolling back.
        DB::statement('DROP INDEX IF EXISTS users_email_client_unique');
        DB::statement('CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL');
    }
};
