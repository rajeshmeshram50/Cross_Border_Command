<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

class InventoryCodeAllocator
{
    public const PREFIX = [
        'inventory_warehouses'    => 'WH-',
        'inventory_zones'         => 'ZN-',
        'inventory_racks'         => 'RC-',
        'inventory_product_flags' => 'PF-',
    ];

    private const COUNTS_PLATFORM = ['inventory_product_flags'];

    public function next(string $table, ?int $clientId, ?int $branchId): string
    {
        $prefix = self::PREFIX[$table] ?? abort(500, "No code prefix for {$table}.");

        if ($branchId !== null) {
            DB::table('branches')->where('id', $branchId)->lockForUpdate()->first();
        } elseif ($clientId !== null) {
            DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        }

        return $this->build($table, $prefix, $clientId, $branchId);
    }

    public function peek(string $table, ?int $clientId, ?int $branchId): string
    {
        $prefix = self::PREFIX[$table] ?? abort(500, "No code prefix for {$table}.");

        return $this->build($table, $prefix, $clientId, $branchId);
    }

    private function build(string $table, string $prefix, ?int $clientId, ?int $branchId): string
    {
        $q = DB::table($table)->whereNotNull('code');

        $ownedByCaller = in_array($table, self::COUNTS_PLATFORM, true) && $clientId !== null;
        $ownedByCaller
            ? $q->where(fn ($w) => $w
                ->where(fn ($own) => $this->scopeOwn($own, $clientId, $branchId))
                ->orWhere(fn ($plat) => $plat->whereNull('client_id')->whereNull('branch_id')))
            : $this->scopeOwn($q, $clientId, $branchId);

        $codes = $q->pluck('code');

        $max   = 0;
        $regex = '/^' . preg_quote($prefix, '/') . '(\d+)$/i';

        foreach ($codes as $code) {
            if (preg_match($regex, (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return $prefix . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    private function scopeOwn($q, ?int $clientId, ?int $branchId)
    {
        return $q
            ->when($clientId === null,
                fn ($w) => $w->whereNull('client_id'),
                fn ($w) => $w->where('client_id', $clientId))
            ->when($branchId === null,
                fn ($w) => $w->whereNull('branch_id'),
                fn ($w) => $w->where('branch_id', $branchId));
    }
}
