<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Hands out document codes (KYC-012, DD-007, TL-023, QC-004) that are never
 * reused.
 *
 * Segment rules and segment doc uploads point at a document by its code, and
 * deleting a document does not clear those references everywhere. While codes
 * were taken from "highest code in the table + 1", deleting the last document
 * freed its number, and the next document created — very often a fresh Excel
 * import — picked the number back up together with the old document's links.
 * It then showed as "in use by Segment Rules" the moment it was created.
 *
 * The counter row is the high-water mark for a client + branch + prefix. It is
 * seeded from the highest code that exists today, so nothing shifts for data
 * already in the system, and it only ever moves up.
 */
class ClmDocCode
{
    /**
     * Reserve $count codes for one scope and return them in order.
     *
     * Call inside a transaction — the counter row is locked for the duration,
     * which is what stops two imports from being handed the same number.
     *
     * @param  string  $modelClass  the document model, used to seed the counter
     * @return array<int, string>
     */
    public static function allocate(string $prefix, string $modelClass, int $clientId, ?int $branchId, int $count = 1): array
    {
        $branchKey = (int) ($branchId ?? 0);

        // Codes already on rows: the counter must clear them, and a code taken
        // by a row the counter does not know about must still be skipped.
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

        // The table is created by a migration; on an install that has not run it
        // yet the old behaviour still works, it just recycles as before.
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

    /** One code, for the Add form. */
    public static function next(string $prefix, string $modelClass, int $clientId, ?int $branchId): string
    {
        return self::allocate($prefix, $modelClass, $clientId, $branchId, 1)[0];
    }
}
