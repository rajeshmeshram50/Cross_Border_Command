<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class EmailGuard
{
    private static array $columns = [];

    private static function columnsOf(string $table): array
    {
        if (!array_key_exists($table, self::$columns)) {
            try {
                self::$columns[$table] = array_flip(Schema::getColumnListing($table));
            } catch (\Throwable $e) {
                self::$columns[$table] = [];
            }
        }
        return self::$columns[$table];
    }

    private static function hasColumn(string $table, string $column): bool
    {
        return isset(self::columnsOf($table)[$column]);
    }

    public static function normalise(?string $email): string
    {
        return mb_strtolower(trim((string) $email));
    }

    public static function conflict(string $scope, ?string $email, ?int $clientId = null, array $ignore = []): ?array
    {
        $needle = self::normalise($email);
        if ($needle === '') return null;

        $cfg = config("email_uniqueness.scopes.$scope");
        if (!is_array($cfg) || empty($cfg['sources'])) return null;

        $tenant = (bool) ($cfg['tenant'] ?? true);

        $ignores = isset($ignore['table']) ? [$ignore] : $ignore;

        foreach ($cfg['sources'] as $src) {
            $q = self::sourceQuery($src, $needle, $tenant, $clientId, $ignores);
            if (!$q) continue;
            $table = $src['table'];

            $hit = $q->limit(1)->value('id');
            if ($hit !== null) {
                return [
                    'label' => $cfg['label'] ?? 'another record',
                    'table' => $table,
                    'id'    => $hit,
                ];
            }
        }

        return null;
    }

    private static function sourceQuery(array $src, string $needle, bool $tenant, ?int $clientId, array $ignores): ?\Illuminate\Database\Query\Builder
    {
        $table  = $src['table'];
        $column = $src['column'];

        if (!self::hasColumn($table, $column)) return null;

        $q = DB::table($table)->whereRaw("lower(trim($column)) = ?", [$needle]);

        if (!empty($src['soft_deletes']) && self::hasColumn($table, 'deleted_at')) {
            $q->whereNull('deleted_at');
        }
        foreach (($src['where'] ?? []) as $col => $val) {
            if (self::hasColumn($table, $col)) $q->where($col, $val);
        }
        $tenantColumn = $src['tenant_column'] ?? 'client_id';
        if ($tenant && $clientId !== null && self::hasColumn($table, $tenantColumn)) {
            $q->where(function ($w) use ($clientId, $tenantColumn) {
                $w->where($tenantColumn, $clientId)->orWhereNull($tenantColumn);
            });
        }
        foreach ($ignores as $ig) {
            if (($ig['table'] ?? null) === $table && !empty($ig['id'])) {
                $q->where('id', '!=', $ig['id']);
            }
        }

        return $q;
    }

    public static function firstConflictAcross(array $scopes, ?string $email, ?int $clientId = null, array $ignore = []): ?array
    {
        $needle = self::normalise($email);
        if ($needle === '') return null;

        $ignores = isset($ignore['table']) ? [$ignore] : $ignore;

        $parts = [];
        $bindings = [];
        $meta = [];

        foreach ($scopes as $scope) {
            $cfg = config("email_uniqueness.scopes.$scope");
            if (!is_array($cfg) || empty($cfg['sources'])) continue;
            $tenant = (bool) ($cfg['tenant'] ?? true);

            foreach ($cfg['sources'] as $src) {
                $q = self::sourceQuery($src, $needle, $tenant, $clientId, $ignores);
                if (!$q) continue;

                $sub = $q->select(DB::raw('1'));
                $i   = count($meta);
                $parts[]  = 'exists(' . $sub->toSql() . ') as h' . $i;
                $bindings = array_merge($bindings, $sub->getBindings());
                $meta[]   = ['scope' => $scope, 'label' => $cfg['label'] ?? 'another record', 'table' => $src['table']];
            }
        }

        if (!$parts) return null;

        $row = (array) DB::selectOne('select ' . implode(', ', $parts), $bindings);

        foreach ($meta as $i => $m) {
            if (!empty($row['h' . $i])) {
                return ['label' => $m['label'], 'table' => $m['table'], 'id' => null];
            }
        }

        return null;
    }

    public static function taken(string $scope, ?string $email, ?int $clientId = null, array $ignore = []): bool
    {
        return self::conflict($scope, $email, $clientId, $ignore) !== null;
    }

    public static function message(array $conflict): string
    {
        return 'This email address is already used by ' . $conflict['label']
            . ' in the system. Please use a different address.';
    }
}
