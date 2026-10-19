<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ClmDocCode
{
    public static function allocate(string $prefix, string $modelClass, int $clientId, ?int $branchId, int $count = 1): array
    {
        $branchKey = (int) ($branchId ?? 0);

        $q = $modelClass::query()->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $maxRow = 0;
        $taken  = [];
        foreach ($q->pluck('code') as $c) {
            $c = (string) $c;
            $taken[$c] = true;
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', $c, $m) && (int) $m[1] > $maxRow) {
                $maxRow = (int) $m[1];
            }
        }

        $n = $maxRow;

        $hasCounter = Schema::hasTable('clm_doc_code_counters');
        if ($hasCounter) {
            $row = DB::table('clm_doc_code_counters')
                ->where(['client_id' => $clientId, 'branch_key' => $branchKey, 'prefix' => $prefix])
                ->lockForUpdate()
                ->first();

            if (!$row) {
                DB::table('clm_doc_code_counters')->insert([
                    'client_id'  => $clientId,
                    'branch_key' => $branchKey,
                    'prefix'     => $prefix,
                    'last_n'     => $maxRow,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $n = $maxRow;
            } else {
                $n = max((int) $row->last_n, $maxRow);
            }
        }

        $codes = [];
        for ($i = 0; $i < max(1, $count); $i++) {
            do {
                $n++;
                $code = sprintf('%s-%03d', $prefix, $n);
            } while (isset($taken[$code]));
            $taken[$code] = true;
            $codes[] = $code;
        }

        if ($hasCounter) {
            DB::table('clm_doc_code_counters')
                ->where(['client_id' => $clientId, 'branch_key' => $branchKey, 'prefix' => $prefix])
                ->update(['last_n' => $n, 'updated_at' => now()]);
        }

        return $codes;
    }

    public static function next(string $prefix, string $modelClass, int $clientId, ?int $branchId): string
    {
        return self::allocate($prefix, $modelClass, $clientId, $branchId, 1)[0];
    }

    public static function preview(string $prefix, string $modelClass, int $clientId, ?int $branchId): string
    {
        $q = $modelClass::query()->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $n = 0;
        $taken = [];
        foreach ($q->pluck('code') as $c) {
            $c = (string) $c;
            $taken[$c] = true;
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', $c, $m) && (int) $m[1] > $n) {
                $n = (int) $m[1];
            }
        }

        if (Schema::hasTable('clm_doc_code_counters')) {
            $last = DB::table('clm_doc_code_counters')
                ->where(['client_id' => $clientId, 'branch_key' => (int) ($branchId ?? 0), 'prefix' => $prefix])
                ->value('last_n');
            $n = max($n, (int) $last);
        }

        do {
            $n++;
            $code = sprintf('%s-%03d', $prefix, $n);
        } while (isset($taken[$code]));

        return $code;
    }
}
