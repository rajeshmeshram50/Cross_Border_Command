<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One address, one login — anywhere in the system (#221).
 *
 * The existing users_email_client_unique index is scoped to the tenant:
 * COALESCE(client_id, 0) + email. It was deliberate (#15 let the same person
 * hold an account at two client organisations, with the login org picker to
 * tell them apart), and it is what the application rules have now been changed
 * away from. An application rule alone leaves a window: two concurrent
 * registrations both read "free" and both insert. This closes it in the one
 * place that cannot be raced.
 *
 * Case and padding are folded, the same as every rule above it — without that
 * " Ravi@x.com " and "ravi@x.com" are two different rows to Postgres and the
 * index enforces nothing that matters.
 *
 * Soft-deleted rows are excluded: deleting a user frees the address, which is
 * long-standing behaviour the restore guard in EnforcesUniqueEmail already
 * accounts for. `email_active` is NOT excluded, unlike the per-tenant index it
 * joins: an exited employee keeps holding their address so that a rehire finds
 * it, and the create-side rule sends anyone else to a different one.
 *
 * Verified before writing this: no address is used twice anywhere in `users`,
 * so the index builds without a data fix.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("
            CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_unique
            ON users (lower(trim(email)))
            WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> ''
        ");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS users_email_global_unique');
    }
};
