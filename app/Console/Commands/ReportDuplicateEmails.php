<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which addresses are held more than once, and by whom.
 *
 * An email address belongs to one record anywhere in this system (#221). The
 * application enforces that on every write path, so nothing NEW can duplicate
 * an address. Data created before the rule existed is another matter: a
 * production database can hold pairs nobody has looked at in years, and the
 * unique index in 2026_10_01_000001 refuses to build until they are gone.
 *
 *   php artisan email:duplicates                 # every participating table
 *   php artisan email:duplicates --table=users
 *   php artisan email:duplicates --create-index  # build the index once clean
 *
 * The last one exists because a migration that SKIPPED is still a migration
 * that ran: `migrate` will not revisit it, so after the duplicates are cleaned
 * there would otherwise be no way to add the index short of rolling the
 * migration back. This builds exactly the same index, and refuses while any
 * duplicate remains.
 *
 * Report only. It never edits a row — deciding which of two accounts is the
 * real one is a human judgement, and on `users` it is the difference between
 * someone keeping their login and losing it.
 *
 * The columns come from config/email_uniqueness.php, so a table added to a
 * scope there appears here with no change to this file.
 */
class ReportDuplicateEmails extends Command
{
    protected $signature = 'email:duplicates
                            {--table= : Only this table}
                            {--create-index : When no duplicates remain, build the users unique index}';

    protected $description = 'Report email addresses held by more than one live record';

    public function handle(): int
    {
        $only  = $this->option('table');
        $pairs = $this->participatingColumns();

        $grandTotal = 0;

        foreach ($pairs as [$table, $column, $softDeletes]) {
            if ($only && $table !== $only) continue;
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) continue;

            $q = DB::table($table)
                ->selectRaw("lower(trim($column)) as email, count(*) as holders")
                ->whereNotNull($column)
                ->where($column, '<>', '')
                ->groupBy(DB::raw("lower(trim($column))"))
                ->havingRaw('count(*) > 1')
                ->orderByRaw('count(*) desc, 1');

            if ($softDeletes && Schema::hasColumn($table, 'deleted_at')) {
                $q->whereNull('deleted_at');
            }

            $rows = $q->get();
            if ($rows->isEmpty()) continue;

            $grandTotal += $rows->count();
            $this->newLine();
            $this->line("<fg=yellow>$table.$column</> — {$rows->count()} duplicated address(es)");

            $detail = [];
            foreach ($rows as $r) {
                /* The holders themselves, so whoever cleans this up can see
                   which record to keep without writing their own query. Only
                   the columns every one of these tables has. */
                $holders = DB::table($table)
                    ->whereRaw("lower(trim($column)) = ?", [$r->email])
                    ->when($softDeletes && Schema::hasColumn($table, 'deleted_at'),
                        fn($w) => $w->whereNull('deleted_at'))
                    ->orderBy('id')
                    ->get(['id'])
                    ->pluck('id')
                    ->implode(', ');

                $detail[] = [$r->email, $r->holders, $holders];
            }
            $this->table(['Address', 'Held by', 'Row ids'], $detail);
        }

        $this->newLine();
        if ($grandTotal === 0) {
            $this->info('No duplicates.');
            if ($this->option('create-index')) {
                DB::statement("
                    CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_unique
                    ON users (lower(trim(email)))
                    WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> ''
                ");
                $this->info('users_email_global_unique is in place.');
            } else {
                $this->line('Run with --create-index to add the users unique index.');
            }
            return self::SUCCESS;
        }

        $this->warn("$grandTotal duplicated address(es) in total.");
        $this->line('Nothing was changed. Decide which record keeps each address, then:');
        $this->line('    php artisan email:duplicates --create-index');
        if ($this->option('create-index')) {
            $this->error('Index NOT created — the duplicates above would make it invalid.');
        }
        return self::SUCCESS;
    }

    /** [table, column, soft_deletes] for every source in every scope, de-duplicated. */
    private function participatingColumns(): array
    {
        $seen = [];
        foreach ((array) config('email_uniqueness.scopes', []) as $scope) {
            foreach (($scope['sources'] ?? []) as $src) {
                $key = $src['table'] . '.' . $src['column'];
                $seen[$key] = [$src['table'], $src['column'], (bool) ($src['soft_deletes'] ?? false)];
            }
        }
        return array_values($seen);
    }
}
