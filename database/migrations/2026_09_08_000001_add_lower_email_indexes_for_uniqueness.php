<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Functional indexes on lower(trim(email)) for every column that takes part in
 * the uniqueness check (config/email_uniqueness.php).
 *
 * The guard compares lower(trim(col)) so that " Ravi@X.com " and "ravi@x.com"
 * are one address. Postgres cannot use a plain btree on `col` for that
 * predicate — it would sequential-scan the table on every save, which is
 * exactly the cost the request asked to avoid. A matching EXPRESSION index
 * turns each check into an index seek.
 *
 * Non-unique on purpose. The data already holds legitimate duplicates within
 * some of these columns, so a unique index could not be created without
 * failing the migration or silently dropping rows. Enforcement lives in the
 * application, where it can tell a real clash from a historic one and explain
 * itself to the user; this index only makes asking cheap.
 */
return new class extends Migration
{
    /** Kept in step with config/email_uniqueness.php. */
    private function targets(): array
    {
        $out = [];
        foreach ((array) config('email_uniqueness.scopes', []) as $scope) {
            foreach (($scope['sources'] ?? []) as $src) {
                $out[$src['table'] . '.' . $src['column']] = [$src['table'], $src['column']];
            }
        }
        return array_values($out);
    }

    private function indexName(string $table, string $column): string
    {
        // Postgres caps identifiers at 63 chars.
        return substr("{$table}_{$column}_lower_idx", 0, 63);
    }

    public function up(): void
    {
        foreach ($this->targets() as [$table, $column]) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) continue;
            $idx = $this->indexName($table, $column);
            DB::statement("CREATE INDEX IF NOT EXISTS {$idx} ON {$table} (lower(trim({$column})))");
        }
    }

    public function down(): void
    {
        foreach ($this->targets() as [$table, $column]) {
            if (!Schema::hasTable($table)) continue;
            DB::statement('DROP INDEX IF EXISTS ' . $this->indexName($table, $column));
        }
    }
};
