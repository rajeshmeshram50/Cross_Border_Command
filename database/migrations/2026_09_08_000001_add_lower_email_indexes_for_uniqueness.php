<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
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
