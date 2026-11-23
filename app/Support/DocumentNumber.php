<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

class DocumentNumber
{
    public static function next(
        string $modelClass,
        string $column,
        string $prefix,
        ?int $clientId,
        ?int $branchId,
        bool $withTrashed = false,
        int $pad = 4,
    ): string {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                static::class . '::next() must be called inside DB::transaction(). '
                . 'lockForUpdate() outside a transaction releases immediately, so two '
                . 'concurrent requests can allocate the same ' . $prefix . ' code.'
            );
        }

        $q = $modelClass::query();
        if ($withTrashed) {
            $q->withTrashed();
        }
        $q->lockForUpdate();

        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck($column) as $code) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) {
                    $max = $n;
                }
            }
        }

        return $prefix . '-' . str_pad((string) ($max + 1), $pad, '0', STR_PAD_LEFT);
    }
}
