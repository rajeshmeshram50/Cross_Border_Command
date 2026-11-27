<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
