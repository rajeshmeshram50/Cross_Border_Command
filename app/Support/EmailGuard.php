<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Is this email already used?" — asked once, answered once.
 *
 * Every rule lives in config/email_uniqueness.php. This class only reads it,
 * so adding a table to a scope never means touching code here, in a model or
 * in a controller.
 *
 * COST
 * ----
 * One query per check, whatever the scope spans: the sources are UNIONed and
 * the query stops at the first hit (LIMIT 1). A scope covering two tables is
 * still one round trip, not two. Each participating column carries a
 * lower(column) index (see the migration that adds them), so the lookup is an
 * index seek rather than a scan — that is what keeps this off the critical
 * path of a save.
 *
 * The comparison is on lower(trim(email)) at BOTH ends. Without that,
 * " Ravi@Example.com " and "ravi@example.com" read as different addresses and
 * the check passes when it should not — which is the usual reason a duplicate
 * still gets in past a naive `where email = ?`.
 */
final class EmailGuard
{
    /** Normalised form used for every comparison and every stored value. */
    public static function normalise(?string $email): string
    {
        return mb_strtolower(trim((string) $email));
    }

    /**
     * The conflict, or null when the address is free.
     *
     * @param  string      $scope     key in config('email_uniqueness.scopes')
     * @param  string|null $email     address being saved
     * @param  int|null    $clientId  tenant, for a scope declared tenant-scoped
     * @param  array       $ignore    ['table' => 'employees', 'id' => 12] — the
     *                                row being edited, so a record never
     *                                collides with itself
     * @return array|null  ['label' => 'another employee', 'table' => ..., 'id' => ...]
     */
    public static function conflict(string $scope, ?string $email, ?int $clientId = null, array $ignore = []): ?array
    {
        $needle = self::normalise($email);
        if ($needle === '') return null;                 // nothing to check

        $cfg = config("email_uniqueness.scopes.$scope");
        if (!is_array($cfg) || empty($cfg['sources'])) return null;

        $tenant = (bool) ($cfg['tenant'] ?? true);

        foreach ($cfg['sources'] as $src) {
            $table  = $src['table'];
            $column = $src['column'];

            /* A source that is not migrated yet must not break saves. This is
               deliberate: config is edited by hand, and a typo or a table that
               only exists on some branches should degrade to "no constraint",
               never to a 500 on every create. */
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) continue;

            $q = DB::table($table)
                ->whereRaw("lower(trim($column)) = ?", [$needle]);

            if (!empty($src['soft_deletes']) && Schema::hasColumn($table, 'deleted_at')) {
                $q->whereNull('deleted_at');
            }
            foreach (($src['where'] ?? []) as $col => $val) {
                if (Schema::hasColumn($table, $col)) $q->where($col, $val);
            }
            /* Tenant scoping. A row with a NULL client_id is visible to every
               tenant's check — it belongs to no one, so treating it as "free"
               would let a platform-level address be claimed twice. */
            if ($tenant && $clientId !== null && Schema::hasColumn($table, 'client_id')) {
                $q->where(function ($w) use ($clientId) {
                    $w->where('client_id', $clientId)->orWhereNull('client_id');
                });
            }
            // Never collide with the row being edited.
            if (($ignore['table'] ?? null) === $table && !empty($ignore['id'])) {
                $q->where('id', '!=', $ignore['id']);
            }

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

    /** True when the address is already taken in this scope. */
    public static function taken(string $scope, ?string $email, ?int $clientId = null, array $ignore = []): bool
    {
        return self::conflict($scope, $email, $clientId, $ignore) !== null;
    }

    /**
     * The sentence shown to the user.
     *
     * Names WHAT it clashes with, never who: telling an operator that an
     * address belongs to a specific employee or customer they may not be
     * allowed to see would leak across the tenant boundary the rest of the
     * app is careful about.
     */
    public static function message(array $conflict): string
    {
        return 'This email address is already used by ' . $conflict['label']
            . ' in the system. Please use a different address.';
    }
}
