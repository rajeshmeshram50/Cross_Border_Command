<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One address, one login — anywhere in the system (#221).
 *
 * The application already refuses a duplicate on every write path (the scopes
 * in config/email_uniqueness.php, read by EnforcesUniqueEmail on every save,
 * plus the controller rules). This index is the backstop those rules cannot
 * be: two concurrent registrations can both read "free" and both insert, and
 * only the database can refuse the second one.
 *
 * IT DOES NOT FAIL ON EXISTING DUPLICATES.
 *
 * The first version did, and it stopped a production migrate dead on an
 * address that was created years before the rule existed — a deploy blocked by
 * historical data, with no way forward but a hand-written DELETE on `users` at
 * the console. That is the wrong order of events: nobody should be editing
 * logins under deploy pressure.
 *
 * So the index is created only when the data can carry it. When it cannot, the
 * duplicates are printed and the migration completes: new duplicates are
 * already impossible (the app refuses them), the existing ones keep working,
 * and the index can be added by re-running this migration once they have been
 * dealt with deliberately.
 *
 *   php artisan email:duplicates                 — what is duplicated, and where
 *   php artisan email:duplicates --create-index  — the index, once that is clean
 *
 * The second one is how the index gets added later: a migration that skipped is
 * still a migration that ran, and `migrate` will not revisit it.
 *
 * Case and padding are folded, as every rule above it does — without that
 * " Ravi@x.com " and "ravi@x.com" are two rows to Postgres and the index
 * enforces nothing that matters. Soft-deleted rows are excluded: deleting a
 * user frees the address, which is long-standing behaviour the restore guard
 * in EnforcesUniqueEmail already accounts for.
 */
return new class extends Migration
{
    public function up(): void
    {
        $duplicates = DB::select("
            SELECT lower(trim(email)) AS email, count(*) AS holders
            FROM users
            WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> ''
            GROUP BY 1
            HAVING count(*) > 1
            ORDER BY count(*) DESC, 1
        ");

        if ($duplicates !== []) {
            $n = count($duplicates);
            echo PHP_EOL;
            echo "  Skipped: users_email_global_unique was NOT created.\n";
            echo "  {$n} address" . ($n === 1 ? ' is' : 'es are') . " already held by more than one live user:\n";
            foreach (array_slice($duplicates, 0, 10) as $d) {
                echo "    - {$d->email}  ({$d->holders} accounts)\n";
            }
            if ($n > 10) {
                echo "    ... and " . ($n - 10) . " more\n";
            }
            echo "\n  New duplicates are already refused by the application, so nothing is\n";
            echo "  getting worse. To add the database backstop as well:\n";
            echo "      php artisan email:duplicates                 # full report, every table\n";
            echo "      php artisan email:duplicates --create-index  # once that is clean\n\n";
            return;
        }

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
